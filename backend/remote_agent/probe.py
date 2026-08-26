"""원격 호스트에서 도는 관찰자 — tmux 상태 변화만 올려보낸다.

**이 파일은 원격에서 실행된다.** `llm_usage/collect.py` 와 같은 규칙이다:

  - **stdlib only, 단일 파일.** SSH stdin 으로 통째로 밀어넣어 `python3 -` 로 돌린다.
    호스트에 설치되는 것이 없고, 그래서 원격이 **낡을 수가 없다** — 스크립트는 항상
    이 백엔드에서 나간다.
  - 아무것도 파싱해서 판단하지 않는다. 상태 판정은 백엔드의 `agent_status.py` 하나뿐이다.
    여기서 하는 일은 **바뀐 줄만 골라 보내는 것**이다.

왜 원격에서 골라야 하나: 브라유 스피너는 초당 10~12회 타이틀을 바꾼다. 원본 프레임을
그대로 흘리면 호스트 하나가 초당 10번 백엔드를 깨우고, 그 바이트가 공유 터널을 탄다.
그래서 **글리프만 다른 변화는 여기서 접는다.**

⚠️ 접는 규칙은 백엔드의 `is_spinner_only_change` 와 같아야 한다. 글리프 집합을 여기
적어 두면 두 벌이 되므로, 백엔드가 보낼 때 `__STATUS_GLYPHS__` 자리에 자기 것을
찍어 넣는다(`payload()`). 치환이 안 되면 시작하자마자 죽는다 — 조용히 다른 규칙으로
도는 것보다 낫다.

프로토콜은 줄 단위 JSON 이다(양방향).
  원격 → 백엔드 : {"t":"hello",...} {"t":"panes","lines":[...]} {"t":"excerpt",...}
  백엔드 → 원격 : {"t":"excerpt","session":"..."} {"t":"interval","seconds":N} {"t":"bye"}
"""
import json
import os
import re
import subprocess
import sys
import threading
import time

# 백엔드가 보낼 때 자기 글리프 집합으로 치환한다. 남아 있으면 그건 사고다.
STATUS_GLYPHS = "__STATUS_GLYPHS__"

DEFAULT_INTERVAL = 1.5
MIN_INTERVAL = 0.5
MAX_INTERVAL = 30.0
# 화면 발췌로 넘길 줄 수. 알림 본문에 쓸 만큼만 — 스크롤백을 옮기는 통로가 아니다.
EXCERPT_LINES = 40

PANE_FORMAT = (
    "#{session_name}\t#{?pane_active,1,0}\t#{pane_current_command}"
    "\t#{pane_current_path}\t#{pane_title}"
)


def _glyph_re():
    if "__STATUS" in STATUS_GLYPHS:
        raise SystemExit("probe: STATUS_GLYPHS not substituted by the backend")
    return re.compile("[" + STATUS_GLYPHS + "]")


GLYPH_RE = _glyph_re()
_WS_RE = re.compile(r"\s{2,}")


def display_title(title):
    """상태 글리프를 뗀 표시용 타이틀 — 백엔드 `display_title` 과 같은 규칙."""
    if not title:
        return ""
    cleaned = _WS_RE.sub(" ", GLYPH_RE.sub("", title)).strip()
    return cleaned or title


def fold_key(line):
    """스피너 프레임을 접은 비교용 열쇠.

    타이틀은 탭으로 구분된 **마지막** 칸이다(그 안의 탭은 maxsplit 이 흡수한다).
    글리프만 다른 두 줄은 같은 열쇠를 갖는다 → 보내지 않는다.
    """
    parts = line.split("\t", 4)
    if len(parts) < 5:
        return line
    head, title = parts[:4], parts[4]
    return "\t".join(head) + "\t" + display_title(title)


def changed_lines(prev, curr):
    """이번 폴에서 **실제로 달라진** 줄들.

    ⚠️ 사라진 pane 도 변화다. 새 줄만 비교하면 pane 이 닫혀도 백엔드는 마지막 상태를
    영원히 들고 있게 된다 — 그래서 열쇠 집합이 달라지면 전체를 보낸다.
    """
    prev_keys = {fold_key(x) for x in prev}
    curr_keys = {fold_key(x) for x in curr}
    if prev_keys != curr_keys:
        return list(curr)
    return []


def _tmux(args, socket_name):
    cmd = ["tmux"]
    if socket_name:
        cmd += ["-L", socket_name]
    return subprocess.run(cmd + args, capture_output=True, text=True, timeout=10)


def list_panes(socket_name):
    out = _tmux(["list-panes", "-a", "-F", PANE_FORMAT], socket_name)
    if out.returncode != 0:
        return None            # tmux 서버가 없다 — "pane 0개" 와는 다른 사건이다
    return [ln for ln in out.stdout.splitlines() if ln.strip()]


def capture(session, socket_name):
    out = _tmux(["capture-pane", "-p", "-t", session], socket_name)
    if out.returncode != 0:
        return ""
    lines = out.stdout.splitlines()
    return "\n".join(lines[-EXCERPT_LINES:])


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


class Control:
    """백엔드가 stdin 으로 보내는 지시. 별도 스레드가 읽는다.

    폴링 루프를 막지 않아야 한다 — 여기서 blocking read 를 하면 발췌 요청 하나가
    상태 스트림을 통째로 멈춘다.
    """

    def __init__(self, interval):
        self.interval = interval
        self.stop = False
        self.requests = []
        self._lock = threading.Lock()

    def take_requests(self):
        with self._lock:
            pending, self.requests = self.requests, []
        return pending

    def run(self):
        for raw in sys.stdin:
            try:
                msg = json.loads(raw)
            except (ValueError, TypeError):
                continue        # 쓰레기 한 줄이 관찰자를 죽이면 안 된다
            kind = msg.get("t")
            if kind == "bye":
                self.stop = True
                return
            if kind == "interval":
                try:
                    want = float(msg.get("seconds", DEFAULT_INTERVAL))
                except (TypeError, ValueError):
                    continue
                self.interval = max(MIN_INTERVAL, min(MAX_INTERVAL, want))
            elif kind == "excerpt" and msg.get("session"):
                with self._lock:
                    self.requests.append(msg["session"])
        self.stop = True        # stdin EOF = 백엔드가 사라졌다


def main():
    socket_name = os.environ.get("ITL_TMUX_SOCKET") or ""
    control = Control(DEFAULT_INTERVAL)
    threading.Thread(target=control.run, daemon=True).start()

    emit({"t": "hello", "pid": os.getpid(), "interval": control.interval})

    prev = []
    had_server = None
    while not control.stop:
        for session in control.take_requests():
            emit({"t": "excerpt", "session": session, "text": capture(session, socket_name)})

        curr = list_panes(socket_name)
        if curr is None:
            # tmux 서버 없음. **"pane 0개" 로 보고하지 않는다** — 백엔드가 그것을
            # "전부 끝났다" 로 읽으면 있지도 않은 완료 알림이 나간다.
            if had_server is not False:
                emit({"t": "no-server"})
                had_server = False
            prev = []
        else:
            if had_server is not True:
                emit({"t": "server"})
                had_server = True
            changed = changed_lines(prev, curr)
            if changed:
                emit({"t": "panes", "lines": changed})
            prev = curr

        time.sleep(control.interval)


if __name__ == "__main__":
    main()

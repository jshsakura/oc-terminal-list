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
                  {"t":"ran","id":N,"out":"...","ok":bool}
  백엔드 → 원격 : {"t":"excerpt","session":"..."} {"t":"interval","seconds":N}
                  {"t":"run","id":N,"cmd":"tmux …"} {"t":"bye"}

🔐 `run` 은 **tmux 전용 통로**다. 허브는 이미 이 호스트에 SSH 로 들어올 수 있지만(그렇게
설치했다), 그렇다고 이 소켓을 범용 셸로 열어 둘 이유는 없다 — 통로가 넓을수록 나중에
그 위에 무엇이 올라탈지 우리가 정하지 못하게 된다. 허용되지 않는 명령은 거절하고, 허브는
그때 SSH 로 폴백한다(실패가 아니라 경로 선택이다).
"""
import json
import os
import re
import shlex
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


def read_machine():
    """이 기계의 값 — **셸을 쓰지 않는다.**

    실행중 보드가 원하는 것(업타임·메모리·스왑·CPU)은 전부 `/proc` 에 있다. 예전에는
    그걸 셸 명령으로 받아왔는데, 그러면 `run` 통로를 tmux 밖으로 열어야 한다. 우리 코드가
    이미 그 기계 안에서 돌고 있으니 직접 읽으면 통로를 넓히지 않아도 된다.

    못 읽은 값은 **넣지 않는다** — 0 으로 채우면 "없다" 와 "모른다" 가 구별되지 않는다.

    ⚠️ 키 이름은 `itl_remote.parse_machine` 이 내는 것과 **똑같아야 한다**(snake_case).
    화면(`routes/fleet.py`)이 그 이름으로 읽으므로, 여기서 camelCase 로 내면 값이 조용히
    사라진다 — 실제로 그렇게 메모리가 안 보였다(`cpus` 만 우연히 이름이 같아서 나왔다).
    """
    out = {}
    try:
        with open("/proc/uptime", encoding="utf-8") as handle:
            out["uptime_seconds"] = float(handle.read().split()[0])
    except (OSError, ValueError, IndexError):
        pass
    try:
        fields = {}
        with open("/proc/meminfo", encoding="utf-8") as handle:
            for line in handle:
                key, _, rest = line.partition(":")
                if key in ("MemTotal", "MemAvailable", "SwapTotal", "SwapFree"):
                    fields[key] = int(rest.split()[0]) * 1024
        if "MemTotal" in fields:
            out["mem_total"] = fields["MemTotal"]
            if "MemAvailable" in fields:
                out["mem_used"] = max(0, fields["MemTotal"] - fields["MemAvailable"])
        if "SwapTotal" in fields:
            out["swap_total"] = fields["SwapTotal"]
            if "SwapFree" in fields:
                out["swap_used"] = max(0, fields["SwapTotal"] - fields["SwapFree"])
    except (OSError, ValueError, IndexError):
        pass
    try:
        out["cpus"] = os.cpu_count()
    except OSError:
        pass
    return out


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


# 🔐 `run` 으로 통과시킬 명령. 각 `&&` 조각의 **첫 낱말**이 여기 있어야 한다.
# `echo` 가 있는 이유: 배달 확인 표식(`&& echo ITL_SENT`)이 그것이다 — 표식이 없으면
# "SSH 가 돌았다" 와 "입력이 들어갔다" 를 구별할 수 없다는 그 규칙.
ALLOWED_COMMANDS = ("tmux", "echo")


def split_on_and(cmd):
    """셸 구분자(`&&` `;` 개행)로 쪼갠다. 인용부호 **안**의 것은 구분자가 아니다.

    ⚠️ 보내는 본문에 `&&` 나 `;` 가 들어 있을 수 있다(사람이 치는 텍스트다). 그걸
    구분자로 세면 멀쩡한 배달이 거절된다.

    ⚠️ 반대로 `;` 를 구분자로 **안 세면** 여러 명령이 한 덩어리로 통과해 첫 낱말 검사가
    무의미해진다 — 셸을 안 쓰므로 실행되지는 않지만, tmux 에게 엉뚱한 인자가 들어가
    "허용했는데 안 되는" 조용한 실패가 된다(실측: 실행중 보드의 스냅샷 명령).
    """
    segments, buf, quote, i = [], "", None, 0
    while i < len(cmd):
        ch = cmd[i]
        if quote:
            if ch == "\\" and quote == '"' and i + 1 < len(cmd):
                buf += cmd[i:i + 2]
                i += 2
                continue
            if ch == quote:
                quote = None
            buf += ch
        elif ch in "\"'":
            quote = ch
            buf += ch
        elif cmd.startswith("&&", i) or cmd.startswith("||", i):
            segments.append(buf)
            buf = ""
            i += 2
            continue
        elif ch in ";\n":
            segments.append(buf)
            buf = ""
        else:
            buf += ch
        i += 1
    if quote:
        return None                      # 안 닫힌 인용 — 무엇으로 쪼개질지 모른다
    segments.append(buf)
    return segments


def parse_chain(cmd):
    """명령 문자열 → argv 목록. 통과 못 하면 None.

    🔐 **셸을 쓰지 않는다.** `shell=True` 로 돌리면 첫 낱말만 검사해 봐야 소용없다 —
    `tmux ls | sh`, `tmux ls $(curl … | sh)`, `tmux ls > ~/.ssh/authorized_keys` 가 전부
    첫 낱말이 tmux 다. argv 로 넘기면 그 글자들은 tmux 에게 가는 **평범한 인자**가 되고,
    tmux 가 모르는 인자라며 거절할 뿐이다. 검사보다 통로를 좁히는 쪽이 안전하다.
    """
    if not cmd or not isinstance(cmd, str):
        return None
    segments = split_on_and(cmd)
    if segments is None:
        return None
    chain = []
    for segment in segments:
        if not segment.strip():
            continue
        try:
            argv = shlex.split(segment)
        except ValueError:
            return None
        if not argv or argv[0] not in ALLOWED_COMMANDS:
            return None
        chain.append(argv)
    return chain or None


def run_chain(chain):
    """`&&` 의 의미대로 앞이 성공해야 뒤가 돈다. (성공여부, 합친 stdout)."""
    out = []
    for argv in chain:
        if argv[0] == "echo":
            # echo 는 표식 출력이 전부다. 바이너리를 찾지 않는다 — 없는 기계도 있다.
            out.append(" ".join(argv[1:]))
            continue
        try:
            done = subprocess.run(argv, capture_output=True, text=True, timeout=15)
        except (OSError, subprocess.SubprocessError) as e:
            return False, "".join(out) + f"\n{e}"
        out.append(done.stdout)
        if done.returncode != 0:
            return False, "\n".join(x for x in out if x)
    return True, "\n".join(x for x in out if x)


class Control:
    """백엔드가 stdin 으로 보내는 지시. 별도 스레드가 읽는다.

    폴링 루프를 막지 않아야 한다 — 여기서 blocking read 를 하면 발췌 요청 하나가
    상태 스트림을 통째로 멈춘다.
    """

    def __init__(self, interval):
        self.interval = interval
        self.stop = False
        self.requests = []
        self.commands = []
        self.machine_requests = 0
        self._lock = threading.Lock()

    def take_requests(self):
        with self._lock:
            pending, self.requests = self.requests, []
        return pending

    def take_commands(self):
        with self._lock:
            pending, self.commands = self.commands, []
        return pending

    def take_machine_requests(self):
        with self._lock:
            count, self.machine_requests = self.machine_requests, 0
        return count

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
            elif kind == "machine":
                with self._lock:
                    self.machine_requests += 1
            elif kind == "run" and msg.get("id") is not None:
                with self._lock:
                    self.commands.append((msg["id"], msg.get("cmd") or ""))
        self.stop = True        # stdin EOF = 백엔드가 사라졌다


def main():
    socket_name = os.environ.get("ITL_TMUX_SOCKET") or ""
    control = Control(DEFAULT_INTERVAL)
    threading.Thread(target=control.run, daemon=True).start()

    emit({"t": "hello", "pid": os.getpid(), "interval": control.interval})

    prev = []
    had_server = None
    while not control.stop:
        for _ in range(control.take_machine_requests()):
            emit({"t": "machine", "machine": read_machine()})

        for cmd_id, cmd in control.take_commands():
            chain = parse_chain(cmd)
            if chain is None:
                emit({"t": "ran", "id": cmd_id, "ok": False, "out": "",
                      "error": "command-not-allowed"})
                continue
            ok, out = run_chain(chain)
            emit({"t": "ran", "id": cmd_id, "ok": ok, "out": out})

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

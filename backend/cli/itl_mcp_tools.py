#!/usr/bin/env python3
"""itl_mcp_tools — tool implementations for the itl MCP server.

Tool layer: knows how to talk to the backend and how to render results as
plain text. Knows nothing about JSON-RPC. The protocol layer (itl_mcp.py)
imports HANDLERS and ToolError from here.

Stdlib only, on purpose — same single-file-copy rule as backend/cli/itl.
All logs go to stderr; stdout is reserved for JSON-RPC by the caller.
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


def _from_tmux_env(name):
    """env 주입 이전에 켜진 pane 에서 뜬 MCP 서버는 ITL_* 이 비어 있다.

    tmux 세션 환경(앱이 심어 뒀다)에서 회복한다 — `cli/itl` 과 **같은 규칙**이다.
    한쪽만 회복하면 "CLI 는 되는데 MCP 도구는 안 된다" 가 되어 에이전트가 헤맨다.
    """
    if not os.environ.get("TMUX"):
        return ""
    try:
        out = subprocess.run(
            ["tmux", "show-environment", name],
            capture_output=True, text=True, timeout=3,
        ).stdout
    except Exception:
        return ""
    for line in out.splitlines():
        if line.startswith(name + "="):
            return line.split("=", 1)[1]
    return ""


API = (os.environ.get("ITL_API", "").rstrip("/")
       or _from_tmux_env("ITL_API").rstrip("/")
       or "http://127.0.0.1:38822")
TOKEN = os.environ.get("ITL_TOKEN", "") or _from_tmux_env("ITL_TOKEN")
SESSION = os.environ.get("ITL_SESSION", "") or _from_tmux_env("ITL_SESSION")

FANOUT_CONFIRM_THRESHOLD = 5
MAX_TEXT_CHARS = 8000
POLL_SEC = 2.0
# 원격 상태 조회는 호스트당 SSH 왕복이다 — 2초마다 두드릴 일이 아니다.
REMOTE_POLL_SEC = 5.0
# 원격 배달은 백엔드가 SSH 를 거는 시간까지 포함한다(itl_remote.HOST_DEADLINE=20s).
# 여기가 짧으면 배달은 됐는데 실패로 읽고, 모델이 재시도해 같은 말이 두 번 들어간다.
HTTP_TIMEOUT = 30

# skip 사유 → 사람말. 백엔드(routes/itl.py 의 REASON_*)와 CLI 의 표와 함께 움직인다.
SKIP_REASONS = {
    "remote-unsupported": "보낼 곳을 모르는 pane",
    "session-gone": "세션이 사라짐",
    "host-unreachable": "그 호스트에 못 닿음",
    "send-failed": "tmux 가 전달을 확인하지 않음",
    "deadline": "시간 안에 끝내지 못함",
}


class ToolError(Exception):
    """Recoverable failure the model should read and retry differently.

    Raised for: empty ITL_TOKEN, 401, backend unreachable, address mismatch,
    multi-match, remote-unsupported, etc. The protocol layer turns these into
    `result + isError:true` (never JSON-RPC error) so the model sees them.
    """


def _log(msg):
    if os.environ.get("ITL_MCP_DEBUG"):
        print(msg, file=sys.stderr, flush=True)


def _api(method, path, params=None, body=None):
    """HTTP to the backend. Raises ToolError with a sentence meant for the model.

    Empty ITL_TOKEN and 401 produce model-readable guidance (§5.2) — these are
    not protocol errors, they are states the model must react to.
    """
    if not TOKEN:
        raise ToolError("ITL_TOKEN이 없습니다. 이 도구는 Terminal List가 만든 터미널 안에서만 동작합니다.")
    url = f"{API}{path}"
    if params:
        url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {TOKEN}")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as res:
            return json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        if e.code == 401:
            raise ToolError("인증이 만료됐습니다. 사용자에게 이 터미널을 새로 열어달라고 요청하세요.") from e
        if e.code == 429:
            # Backend rate-limit on /send or /key (§6.4). Verbatim sentence per team lead.
            raise ToolError("보내기가 너무 잦습니다(분당 30회). 루프에 빠진 게 아닌지 확인하세요.") from e
        detail = ""
        try:
            detail = json.loads(e.read().decode()).get("detail", "")
        except Exception:
            pass
        raise ToolError(f"백엔드 오류 {e.code}: {detail or e.reason}") from e
    except urllib.error.URLError as e:
        raise ToolError(f"백엔드에 연결할 수 없습니다 ({API}): {e.reason}") from e


# --- helpers ---------------------------------------------------------------
def _is_self(target):
    """True if a target is this pane — match by sessionId or tmuxSession."""
    if not SESSION:
        return False
    return target.get("sessionId") == SESSION or target.get("tmuxSession") == SESSION


_STATUS_GROUPS = ("working", "idle", "permission")


def _references_status_group(to):
    """주소가 pane 의 **상태**로 대상을 고르는가? (`@working` `@idle` `@permission`)

    백엔드 `itl_targets.references_status_group` 의 거울이다. 여기서 판정하는 이유는
    이 값이 "원격 상태를 물어봐야 답이 맞는가" 를 결정하기 때문이다 — 안 물어보면
    상태가 빈 원격 pane 이 통째로 빠져서, 호출자는 "원격은 안 돌고 있다" 는 **틀린 답**을
    받는다. 불완전한 답이 아니라 틀린 답이다.
    """
    if not to:
        return False
    raw = str(to).strip()
    pos = max(raw.rfind("."), raw.rfind(":"))
    parts = [raw] if pos < 0 else [raw[:pos].strip(), raw[pos + 1:].strip()]
    return any(p.startswith("@") and p[1:].strip().lower() in _STATUS_GROUPS for p in parts)


def _resolve_targets(to, remote_status=False):
    """Resolve `to` against the backend. Raises ToolError on backend failure.

    `remote_status=True` 는 원격 pane 의 상태까지 채워 달라고 요청한다(호스트당 SSH 왕복
    한 번) — 기다림에만 쓴다.
    """
    params = {"to": to, "from_session": SESSION}
    if remote_status:
        params["remote_status"] = "true"
    data = _api("GET", "/api/itl/resolve", params)
    return data.get("matched", []) or []


def _wait_satisfied(status, until):
    """Per-target condition for terminal_wait. Blank status counts as idle."""
    if until == "idle":
        return not status or status == "idle"
    if until == "permission":
        return status == "permission"
    # not_working: anything other than 'working' (idle, permission, blank).
    return status != "working"


def _wait_reached(target, until):
    """조건을 만족했나 — **모르는 것은 만족이 아니다.**

    원격 pane 의 상태는 백엔드 워처가 볼 수 없어 비어 있고(`statusUnknown`), 빈 상태를
    "일 안 함" 으로 세면 `terminal_wait` 가 0 초에 "완료" 를 돌려준다. 실제로 그랬다 —
    원격에 일을 넘긴 뒤 기다린 에이전트가 즉시 "끝났다" 는 답을 받고 다음으로 넘어갔다.
    """
    if target.get("statusUnknown"):
        return False
    return _wait_satisfied(target.get("status"), until)


def _wait_state(target):
    if target.get("statusUnknown"):
        return "unknown"
    return target.get("status")


def _format_wait_targets(expected, gone, by_addr):
    out = []
    for addr in sorted(expected):
        if addr in gone or addr not in by_addr:
            out.append({"addr": addr, "status": "gone"})
        else:
            out.append({"addr": addr, "status": _wait_state(by_addr[addr])})
    return out


# --- tool implementations: each returns a plain string ---------------------
def tool_terminal_list(args):
    scope = args.get("scope", "same_tab")
    status = args.get("status")
    command = args.get("command")
    include_self = bool(args.get("include_self", True))
    if scope == "same_tab" and not SESSION:
        raise ToolError('내 터미널의 위치를 알 수 없습니다(ITL_SESSION 없음). scope="all"로 다시 시도하세요.')
    # 원격 pane 의 상태는 워처가 못 봐서 기본이 비어 있다(`?`). 물어보려면 호스트당 SSH 한
    # 번이라 목록 조회의 기본은 끈 채로 둔다 — 그게 값싸고, `?` 가 "모른다" 로 정직하다.
    #
    # ⚠️ 단 **status 필터를 걸면 이야기가 다르다.** 거른 목록은 상태에 대한 단언인데,
    # 물어보지도 않은 pane 에 대해 단언할 수는 없다. 안 물어보면 원격이 전부 조용히
    # 빠져서 "원격은 안 돌고 있다" 는 틀린 답이 된다. 그래서 필터가 있으면 기본을 켠다.
    # 명시로 준 값이 항상 이긴다(비용을 알고 끄고 싶을 수 있다).
    remote_status = args.get("remote_status")
    if remote_status is None:
        remote_status = status is not None
    remote_status = bool(remote_status)
    params = {
        "from_session": SESSION, "fmt": "table",
        "scope": scope, "status": status, "command": command,
        "exclude_self": not include_self,
    }
    if remote_status:
        params["remote_status"] = "true"
    table = _api("GET", "/api/itl/targets", params).get("table", "")
    return table or "열려 있는 터미널이 없습니다."


def tool_terminal_whoami(args):  # noqa: ARG001 — schema is empty, args unused by contract
    targets = _api("GET", "/api/itl/targets", {"from_session": SESSION}).get("targets", []) or []
    me = next((t for t in targets if _is_self(t)), None)
    if not me:
        raise ToolError("이 터미널의 주소를 찾지 못했습니다 (ITL_SESSION 미설정이거나 탭 상태가 아직 저장되지 않음).")
    # Siblings exclude self — must match @siblings (§4.2/§5.3) so the model sees consistent counts.
    siblings = sum(1 for t in targets if t.get("tabIndex") == me.get("tabIndex") and not _is_self(t))
    return json.dumps({
        "addr": me.get("addr"), "tabIndex": me.get("tabIndex"), "paneIndex": me.get("paneIndex"),
        "tabName": me.get("tabName"), "cwd": me.get("cwd"), "command": me.get("command"),
        "siblingCount": siblings,
    }, ensure_ascii=False)


def tool_terminal_resolve(args):
    to = args["to"]
    # `@working` 같은 상태 주소는 상태를 모르면 답할 수 없다 — tool_terminal_list 의 주석 참고.
    remote_status = args.get("remote_status")
    if remote_status is None:
        remote_status = _references_status_group(to)
    matched = _resolve_targets(to, remote_status=bool(remote_status))
    if not matched:
        raise ToolError(f"'{to}'에 해당하는 터미널이 없습니다. terminal_list로 주소를 확인하세요.")
    rows = []
    for t in matched:
        addr = t.get("addr")
        state = "?" if t.get("statusUnknown") else (t.get("status") or "-")
        row = f"{addr}  {t.get('tabName')} #{t.get('paneIndex')}  {t.get('command') or '-'}  {state}"
        rows.append(row)
    return "\n".join(rows)


def tool_terminal_send(args):
    to = args["to"]
    text = args.get("text", "")
    if not text:
        raise ToolError("text 가 비어 있습니다.")
    submit = bool(args.get("submit", False))
    include_self = bool(args.get("include_self", False))
    confirm = bool(args.get("confirm_fanout", False))
    # §5.3 step 1: resolve first to count, exclude self, and report.
    matched = _resolve_targets(to)
    if not matched:
        raise ToolError(f"'{to}'에 해당하는 터미널이 없습니다. terminal_list로 주소를 확인하세요.")
    if not include_self:
        matched = [t for t in matched if not _is_self(t)]
    if not matched:
        raise ToolError(f"'{to}'에 해당하는 터미널이 없습니다. terminal_list로 주소를 확인하세요.")
    # Step 4: fanout guard. Don't send; show the list so the model can narrow.
    if len(matched) > FANOUT_CONFIRM_THRESHOLD and not confirm:
        addrs = ", ".join(t.get("addr", "?") for t in matched)
        return (f"대상이 {len(matched)}개입니다 (상한 {FANOUT_CONFIRM_THRESHOLD}). "
                f"주소를 좁히거나 confirm_fanout=true로 다시 부르세요.\n대상: {addrs}")
    # Step 5: one POST. Backend filters the caller when exclude_self=True.
    result = _api("POST", "/api/itl/send", body={
        "to": to, "text": text, "submit": submit, "from_session": SESSION,
        "exclude_self": not include_self,
    })
    delivered = result.get("delivered", []) or []
    skipped = result.get("skipped", []) or []
    lines = [f"sent → {d.get('addr')}" for d in delivered]
    for s in skipped:
        lines.append(f"skip   {s.get('addr')} ({SKIP_REASONS.get(s.get('reason'), s.get('reason', '?'))})")
    if not delivered:
        raise ToolError("보냈으나 전달된 터미널이 없습니다. " + " | ".join(lines))
    return "\n".join(lines)


def tool_terminal_key(args):
    to = args["to"]
    key = args["key"]
    include_self = bool(args.get("include_self", False))
    confirm = bool(args.get("confirm_fanout", False))
    # Same 6-step flow as terminal_send (§5.3) — only the payload differs.
    matched = _resolve_targets(to)
    if not matched:
        raise ToolError(f"'{to}'에 해당하는 터미널이 없습니다. terminal_list로 주소를 확인하세요.")
    if not include_self:
        matched = [t for t in matched if not _is_self(t)]
    if not matched:
        raise ToolError(f"'{to}'에 해당하는 터미널이 없습니다. terminal_list로 주소를 확인하세요.")
    if len(matched) > FANOUT_CONFIRM_THRESHOLD and not confirm:
        addrs = ", ".join(t.get("addr", "?") for t in matched)
        return (f"대상이 {len(matched)}개입니다 (상한 {FANOUT_CONFIRM_THRESHOLD}). "
                f"주소를 좁히거나 confirm_fanout=true로 다시 부르세요.\n대상: {addrs}")
    result = _api("POST", "/api/itl/key", body={
        "to": to, "key": key, "from_session": SESSION,
        "exclude_self": not include_self,
    })
    delivered = result.get("delivered", []) or []
    skipped = result.get("skipped", []) or []
    lines = [f"key → {d.get('addr')} ({key})" for d in delivered]
    for s in skipped:
        lines.append(f"skip   {s.get('addr')} ({SKIP_REASONS.get(s.get('reason'), s.get('reason', '?'))})")
    if not delivered:
        raise ToolError("보냈으나 전달된 터미널이 없습니다. " + " | ".join(lines))
    return "\n".join(lines)


def tool_terminal_read(args):
    to = args["to"]
    lines_arg = int(args.get("lines", 40))
    mode = args.get("mode", "excerpt")
    matched = _resolve_targets(to)
    if not matched:
        raise ToolError(f"'{to}'에 해당하는 터미널이 없습니다. terminal_list로 주소를 확인하세요.")
    if len(matched) > 1:
        addrs = ", ".join(t.get("addr", "?") for t in matched)
        raise ToolError(f"'{to}'는 {len(matched)}개로 해소됩니다: {addrs}. 하나만 지정하세요.")
    # 원격 pane 도 읽는다 — 백엔드가 그 호스트로 SSH 를 걸어 캡처한다(itl_remote).
    data = _api("GET", "/api/itl/read", {
        "to": to, "from_session": SESSION, "lines": lines_arg, "mode": mode,
    })
    return data.get("text", "")


def tool_terminal_wait(args):
    to = args["to"]
    until = args.get("until", "not_working")
    timeout_sec = int(args.get("timeout_sec", 120))
    start = time.monotonic()
    deadline = start + timeout_sec
    # 상태 주소(`@working` 등)는 첫 해석부터 원격 상태를 물어봐야 한다. 안 그러면 원격이
    # 아예 안 잡혀 has_remote 가 False 가 되고, "원격에 넘긴 일" 을 기다리는 호출이
    # 로컬만 보고 즉시 끝난다 — 이 파일이 이미 한 번 밟은 사고와 같은 뿌리다.
    initial = _resolve_targets(to, remote_status=_references_status_group(to))
    if not initial:
        raise ToolError(f"'{to}'에 해당하는 터미널이 없습니다. terminal_list로 주소를 확인하세요.")
    # 원격이 하나라도 섞였으면 상태를 물어봐야 알 수 있고, 그 조회는 호스트당 SSH 왕복이라
    # 폴 간격도 늘린다. 로컬만이면 예전과 똑같이 2초 폴이다.
    has_remote = any(not t.get("sessionId") for t in initial)
    poll_sec = REMOTE_POLL_SEC if has_remote else POLL_SEC
    expected = {t.get("addr") for t in initial}
    gone = set()
    while True:
        matched = _resolve_targets(to, remote_status=has_remote or _references_status_group(to))
        by_addr = {t.get("addr"): t for t in matched}
        # Disappeared targets satisfy the condition (session-gone). Track once.
        for addr in list(expected):
            if addr not in by_addr:
                gone.add(addr)
        remaining = expected - gone
        all_ok = all(_wait_reached(by_addr[a], until) for a in remaining if a in by_addr)
        if all_ok:
            elapsed = int(time.monotonic() - start)
            payload = {"reached": True, "elapsed_sec": elapsed,
                       "targets": _format_wait_targets(expected, gone, by_addr)}
            return json.dumps(payload, ensure_ascii=False)
        if time.monotonic() >= deadline:
            elapsed = int(time.monotonic() - start)
            payload = {"reached": False, "elapsed_sec": elapsed,
                       "targets": _format_wait_targets(expected, gone, by_addr)}
            pending = sorted(
                a for a in remaining
                if a in by_addr and not _wait_reached(by_addr[a], until)
            )
            unknown = sorted(a for a in pending if by_addr[a].get("statusUnknown"))
            still = [a for a in pending if a not in unknown]
            notes = []
            if still:
                notes.append(f"아직 working 중입니다: {', '.join(still)}")
            if unknown:
                # 모른다고 말해야 모델이 다른 방법(terminal_read)으로 확인한다.
                notes.append(f"상태를 확인할 수 없었습니다(호스트 응답 없음): {', '.join(unknown)}")
            note = ("\n" + "\n".join(notes)) if notes else ""
            return json.dumps(payload, ensure_ascii=False) + note
        time.sleep(poll_sec)


HANDLERS = {
    "terminal_list": tool_terminal_list,
    "terminal_whoami": tool_terminal_whoami,
    "terminal_resolve": tool_terminal_resolve,
    "terminal_send": tool_terminal_send,
    "terminal_read": tool_terminal_read,
    "terminal_wait": tool_terminal_wait,
    "terminal_key": tool_terminal_key,
}

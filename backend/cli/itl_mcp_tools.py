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
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = os.environ.get("ITL_API", "http://127.0.0.1:38822").rstrip("/")
TOKEN = os.environ.get("ITL_TOKEN", "")
SESSION = os.environ.get("ITL_SESSION", "")

FANOUT_CONFIRM_THRESHOLD = 5
MAX_TEXT_CHARS = 8000
POLL_SEC = 2.0
HTTP_TIMEOUT = 15


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


def _resolve_targets(to):
    """Resolve `to` against the backend. Raises ToolError on backend failure."""
    data = _api("GET", "/api/itl/resolve", {"to": to, "from_session": SESSION})
    return data.get("matched", []) or []


def _wait_satisfied(status, until):
    """Per-target condition for terminal_wait. Blank status counts as idle."""
    if until == "idle":
        return not status or status == "idle"
    if until == "permission":
        return status == "permission"
    # not_working: anything other than 'working' (idle, permission, blank).
    return status != "working"


def _format_wait_targets(expected, gone, by_addr):
    out = []
    for addr in sorted(expected):
        if addr in gone or addr not in by_addr:
            out.append({"addr": addr, "status": "gone"})
        else:
            out.append({"addr": addr, "status": by_addr[addr].get("status")})
    return out


# --- tool implementations: each returns a plain string ---------------------
def tool_terminal_list(args):
    scope = args.get("scope", "same_tab")
    status = args.get("status")
    command = args.get("command")
    include_self = bool(args.get("include_self", True))
    if scope == "same_tab" and not SESSION:
        raise ToolError('내 터미널의 위치를 알 수 없습니다(ITL_SESSION 없음). scope="all"로 다시 시도하세요.')
    params = {
        "from_session": SESSION, "fmt": "table",
        "scope": scope, "status": status, "command": command,
        "exclude_self": not include_self,
    }
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
    matched = _resolve_targets(to)
    if not matched:
        raise ToolError(f"'{to}'에 해당하는 터미널이 없습니다. terminal_list로 주소를 확인하세요.")
    rows = []
    for t in matched:
        addr = t.get("addr")
        row = f"{addr}  {t.get('tabName')} #{t.get('paneIndex')}  {t.get('command') or '-'}  {t.get('status') or '-'}"
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
    reason_map = {"remote-unsupported": "원격 pane 은 아직 지원 안 함", "session-gone": "세션이 사라짐"}
    for s in skipped:
        lines.append(f"skip   {s.get('addr')} ({reason_map.get(s.get('reason'), s.get('reason', '?'))})")
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
    reason_map = {"remote-unsupported": "원격 pane 은 아직 지원 안 함", "session-gone": "세션이 사라짐"}
    for s in skipped:
        lines.append(f"skip   {s.get('addr')} ({reason_map.get(s.get('reason'), s.get('reason', '?'))})")
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
    target = matched[0]
    if not target.get("sessionId"):
        raise ToolError(f"{target.get('addr')}는 원격 호스트의 터미널이라 아직 읽을 수 없습니다.")
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
    initial = _resolve_targets(to)
    if not initial:
        raise ToolError(f"'{to}'에 해당하는 터미널이 없습니다. terminal_list로 주소를 확인하세요.")
    expected = {t.get("addr") for t in initial}
    gone = set()
    while True:
        matched = _resolve_targets(to)
        by_addr = {t.get("addr"): t for t in matched}
        # Disappeared targets satisfy the condition (session-gone). Track once.
        for addr in list(expected):
            if addr not in by_addr:
                gone.add(addr)
        remaining = expected - gone
        all_ok = all(_wait_satisfied(by_addr[a].get("status"), until) for a in remaining if a in by_addr)
        if all_ok:
            elapsed = int(time.monotonic() - start)
            payload = {"reached": True, "elapsed_sec": elapsed,
                       "targets": _format_wait_targets(expected, gone, by_addr)}
            return json.dumps(payload, ensure_ascii=False)
        if time.monotonic() >= deadline:
            elapsed = int(time.monotonic() - start)
            payload = {"reached": False, "elapsed_sec": elapsed,
                       "targets": _format_wait_targets(expected, gone, by_addr)}
            working = sorted(
                a for a in remaining
                if a in by_addr and not _wait_satisfied(by_addr[a].get("status"), until)
            )
            note = f"\n아직 working 중입니다: {', '.join(working)}" if working else ""
            return json.dumps(payload, ensure_ascii=False) + note
        time.sleep(POLL_SEC)


HANDLERS = {
    "terminal_list": tool_terminal_list,
    "terminal_whoami": tool_terminal_whoami,
    "terminal_resolve": tool_terminal_resolve,
    "terminal_send": tool_terminal_send,
    "terminal_read": tool_terminal_read,
    "terminal_wait": tool_terminal_wait,
    "terminal_key": tool_terminal_key,
}

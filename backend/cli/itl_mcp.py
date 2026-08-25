#!/usr/bin/env python3
"""itl_mcp — JSON-RPC server for the itl MCP.

Protocol layer only. Tool implementations live in itl_mcp_tools.py.
The split exists so neither layer knows about the other's internals
(§9 of the design doc).

Stdlib only, on purpose — same single-file-copy rule as backend/cli/itl.

Hard invariants (these break the client if broken):
- stdout is JSON-RPC only. All logs go to stderr, and only when
  ITL_MCP_DEBUG=1.
- Notifications (messages without an `id`) NEVER get a response. The
  dispatcher returns None at the top and the caller skips writing.
- json.dumps is always called without indent — line-delimited framing
  must not break across multiple lines.
"""
import json
import os
import sys

# Allow `import itl_mcp_tools` whether we run as `python3 itl_mcp.py` or
# `python3 -m cli.itl_mcp`. Done before the tool import below.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from itl_mcp_tools import HANDLERS, ToolError  # noqa: E402

# --- protocol constants ----------------------------------------------------
PROTOCOL_VERSIONS = {"2024-11-05", "2025-03-26", "2025-06-18"}
LATEST_PROTOCOL_VERSION = "2025-06-18"
SERVER_NAME = "itl"
SERVER_VERSION = "1.0.0"

# --- tool schemas (§5.3 — descriptions VERBATIM, do not edit) --------------
DESC_LIST = (
    "열려 있는 터미널(pane)과 그 주소를 표로 본다. 기본은 내가 속한 탭의 형제 터미널만 보여준다. "
    '다른 탭까지 보려면 scope="all". 각 행의 ADDR 값이 다른 도구의 to 인자로 그대로 들어간다. '
    "STATE 칸의 '?'는 '유휴'가 아니라 '모름'이다 — 원격 터미널은 물어봐야 알 수 있고 "
    "(remote_status), 안 물어본 상태다. '?'를 '안 돌고 있다'로 읽지 말 것."
)
DESC_WHOAMI = (
    "이 터미널 자신의 주소(탭 번호.pane 번호)와 탭 이름, 형제 터미널 수를 알려준다. "
    "다른 터미널에게 '나에게 답해줘'라고 할 때 이 주소를 알려주면 된다."
)
DESC_RESOLVE = (
    "주소가 어떤 터미널들로 해소되는지 미리 확인한다. 아무것도 보내지 않는다. "
    "여러 터미널에 보내기 전이나 주소가 확실하지 않을 때 먼저 부른다."
)
DESC_SEND = (
    "다른 터미널의 프롬프트에 텍스트를 입력한다. 기본은 엔터를 치지 않는다 — "
    "사람이 보고 직접 실행한다. 상대가 즉시 실행하길 원하면 submit=true. "
    "자기 자신에게는 보내지 않는다(무한 루프 방지). "
    "받는 쪽이 에이전트면 **답장 명령이 함께 전달**되므로, 상대가 끝나면 결과가 이 "
    "터미널로 직접 들어온다 — 되묻지 말고 턴을 마쳐라. 응답에 그렇게 됐는지 적힌다."
)
DESC_READ = (
    "다른 터미널의 현재 화면을 읽는다. 주소는 정확히 하나의 터미널로 해소되어야 한다. "
    "**반복해서 부르지 마라** — 되묻기 한 번마다 컨텍스트 전체가 다시 청구된다. "
    "답장이 오는 대상이면 그냥 기다리면 되고, 끝나는 시점이 필요하면 terminal_wait 가 "
    "한 번의 호출로 대신 기다려 준다."
)
DESC_WAIT = (
    "지정한 터미널이 작업을 마칠 때까지 기다린다. 최대 timeout_sec까지 기다리고, "
    "시간이 다 되면 마지막 상태를 알려준다. "
    "**terminal_send 응답에 '답장 경로가 함께 전달됐습니다' 가 있으면 부르지 마라** — "
    "결과가 알아서 이 터미널로 들어온다. 이건 답장할 수 없는 대상(셸 등)을 지켜보거나, "
    "끝나는 시점 자체가 필요할 때 쓴다. 기다리는 동안은 이 호출 하나로 끝나므로 "
    "직접 반복해서 되묻는 것보다 항상 싸다."
)
DESC_KEY = (
    "다른 터미널에 특수 키를 보낸다. 폭주하는 작업을 멈출 때 C-c를 쓴다."
)

TOOLS = [
    {
        "name": "terminal_list",
        "description": DESC_LIST,
        "inputSchema": {
            "type": "object",
            "properties": {
                "scope": {"type": "string", "enum": ["same_tab", "all"], "default": "same_tab",
                          "description": "same_tab = 내가 속한 탭만. all = 전체 탭."},
                "status": {"type": "string", "enum": ["working", "idle", "permission"],
                           "description": "이 상태인 터미널만."},
                "command": {"type": "string", "description": "이 명령이 돌고 있는 터미널만 (claude, glm, codex ...)."},
                "include_self": {"type": "boolean", "default": True,
                                 "description": "내 터미널도 목록에 포함할지. 목록은 기본 포함(> 표시가 붙는다)."},
                "remote_status": {
                    "type": "boolean",
                    "description": (
                        "원격 터미널의 상태까지 물어볼지 (호스트당 SSH 한 번). 생략하면 "
                        "status 필터가 있을 때만 자동으로 켜진다 — 안 물어보면 원격은 "
                        "STATE 가 '?' 라 어떤 상태 필터에도 안 걸려 통째로 빠진다. "
                        "값싼 목록만 원하면 false."
                    ),
                },
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "terminal_whoami",
        "description": DESC_WHOAMI,
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "terminal_resolve",
        "description": DESC_RESOLVE,
        "inputSchema": {
            "type": "object",
            "required": ["to"],
            "properties": {
                "to": {"type": "string",
                       "description": "주소. 예: 3 | 1.3 | @프론트 | @siblings | 2.@glm | @working | @all"},
                "remote_status": {
                    "type": "boolean",
                    "description": (
                        "원격 터미널의 상태까지 물어볼지 (호스트당 SSH 한 번). 생략하면 "
                        "주소가 @working/@idle/@permission 일 때만 자동으로 켜진다."
                    ),
                },
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "terminal_send",
        "description": DESC_SEND,
        "inputSchema": {
            "type": "object",
            "required": ["to", "text"],
            "properties": {
                "to": {"type": "string", "description": "주소. 예: 3 | 1.3 | @backend | @siblings | 2.@glm"},
                "text": {"type": "string", "maxLength": 8000, "description": "입력할 내용. 그대로 타이핑된다."},
                "submit": {
                    "type": "boolean", "default": False,
                    "description": (
                        "엔터까지 칠지. 기본 false — 대화형 앱 한가운데 엔터가 들어가면 "
                        "의도치 않게 실행된다."
                    ),
                },
                "include_self": {
                    "type": "boolean", "default": False,
                    "description": "자기 자신도 대상에 포함(기본 제외).",
                },
                "confirm_fanout": {
                    "type": "boolean", "default": False,
                    "description": (
                        "대상이 5개를 넘을 때 true여야 실제로 보낸다. "
                        "오타 하나로 전 터미널에 명령이 박히는 걸 막는다."
                    ),
                },
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "terminal_read",
        "description": DESC_READ,
        "inputSchema": {
            "type": "object",
            "required": ["to"],
            "properties": {
                "to": {"type": "string"},
                "lines": {"type": "integer", "default": 40, "minimum": 1, "maximum": 200,
                          "description": "화면 마지막 몇 줄을 읽을지."},
                "mode": {"type": "string", "enum": ["excerpt", "raw"], "default": "excerpt",
                         "description": "excerpt = 입력상자/상태줄 같은 UI 장식을 걷어낸 본문. raw = 있는 그대로."},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "terminal_wait",
        "description": DESC_WAIT,
        "inputSchema": {
            "type": "object",
            "required": ["to"],
            "properties": {
                "to": {"type": "string"},
                "until": {
                    "type": "string",
                    "enum": ["idle", "not_working", "permission"],
                    "default": "not_working",
                    "description": (
                        "not_working = working이 아니게 되면(권한 대기 포함). "
                        "idle = 완전히 쉬는 상태. permission = 권한 요청이 뜰 때."
                    ),
                },
                "timeout_sec": {"type": "integer", "default": 120, "minimum": 5, "maximum": 600},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "terminal_key",
        "description": DESC_KEY,
        "inputSchema": {
            "type": "object",
            "required": ["to", "key"],
            "properties": {
                "to": {"type": "string"},
                "key": {"type": "string", "enum": ["C-c", "Escape", "Enter", "q"]},
            },
            "additionalProperties": False,
        },
    },
]


# --- response builders -----------------------------------------------------
def _ok(msg_id, result):
    return {"jsonrpc": "2.0", "id": msg_id, "result": result}


def _rpc_error(msg_id, code, message):
    return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": code, "message": message}}


def _tool_result(msg_id, text, is_error):
    """Successful tool dispatch — isError distinguishes model-recoverable failures."""
    return _ok(msg_id, {"content": [{"type": "text", "text": text}], "isError": is_error})


# --- dispatcher ------------------------------------------------------------
def handle(msg):
    """Process one parsed JSON-RPC message.

    Returns a response dict, or None for notifications (no `id`).
    Protocol failures → JSON-RPC error. Tool failures → result + isError:true
    so the model can read them and recover. Never both at once.
    """
    # Per JSON-RPC 2.0: a message without `id` is a notification and must
    # never receive a response. This covers notifications/initialized and
    # every other notification the client may send.
    if "id" not in msg:
        return None

    msg_id = msg.get("id")
    method = msg.get("method")
    if not isinstance(method, str):
        return _rpc_error(msg_id, -32600, "Invalid Request")

    if method == "initialize":
        return _handle_initialize(msg_id, msg.get("params") or {})
    if method == "ping":
        return _ok(msg_id, {})
    if method == "tools/list":
        return _ok(msg_id, {"tools": TOOLS})
    if method == "tools/call":
        return _handle_tool_call(msg_id, msg.get("params") or {})
    return _rpc_error(msg_id, -32601, "Method not found")


def _handle_initialize(msg_id, params):
    client_pv = params.get("protocolVersion")
    pv = client_pv if client_pv in PROTOCOL_VERSIONS else LATEST_PROTOCOL_VERSION
    return _ok(msg_id, {
        "protocolVersion": pv,
        "capabilities": {"tools": {"listChanged": False}},
        "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
    })


def _handle_tool_call(msg_id, params):
    name = params.get("name")
    args = params.get("arguments") or {}
    handler = HANDLERS.get(name)
    # Unknown tool is NOT a protocol error — the model picked a bad name and
    # must read the message and pick again.
    if handler is None:
        return _tool_result(msg_id, f"알 수 없는 도구: {name}", is_error=True)
    try:
        text = handler(args)
        return _tool_result(msg_id, text, is_error=False)
    except ToolError as e:
        return _tool_result(msg_id, str(e), is_error=True)
    except Exception as e:  # noqa: BLE001 — never crash the server on a tool bug
        return _tool_result(msg_id, f"내부 오류: {e}", is_error=True)


# --- main loop -------------------------------------------------------------
def _write(obj):
    """One JSON-RPC message to stdout. No indent (line framing), ASCII-passable."""
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    """Read JSON-RPC lines from stdin until EOF."""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            # Parse error has no recoverable id (we couldn't read it).
            _write(_rpc_error(None, -32700, "Parse error"))
            continue
        if not isinstance(msg, dict):
            _write(_rpc_error(None, -32600, "Invalid Request"))
            continue
        response = handle(msg)
        if response is not None:
            _write(response)


if __name__ == "__main__":
    main()

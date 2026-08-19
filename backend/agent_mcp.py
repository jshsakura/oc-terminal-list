"""Register the itl MCP server with the coding agents that run inside our panes.

The app's differentiator is one agent handing work to another across machines. An agent
can only do that if it knows the tools exist — and until now that meant the user finding
`claude mcp add itl -- python3 <repo>/backend/cli/itl_mcp.py` in a README and running it
on every machine. So the feature was real and almost nobody had it.

Two rules shape this module:

1. **Never force.** `ITL_AUTO_MCP=0` turns it off, an entry the user has already written
   by hand is left exactly as it is, and removal is one line in their own config — this
   writes the same shape `claude mcp add` writes, nothing exotic.
2. **Never corrupt.** The user config is a large file holding unrelated state (onboarding
   flags, per-project history). Every write is: parse, copy, modify the copy, write a
   temp file in the same directory, `os.replace`. A failure at any step leaves the
   original untouched, and a config we cannot parse is left alone rather than rebuilt.
"""
from __future__ import annotations

import json
import logging
import os
import shlex
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

# The key an entry is filed under, in the agent's own config vocabulary.
MCP_KEY = "itl"
CONFIG_NAME = ".claude.json"

CLI_DIR = Path(__file__).resolve().with_name("cli")
MCP_SCRIPT = "itl_mcp.py"


def auto_mcp_enabled() -> bool:
    return os.getenv("ITL_AUTO_MCP", "1").strip() not in ("0", "false", "no")


def mcp_entry(script_path: str) -> dict:
    """The server definition, in the shape `claude mcp add` produces.

    No token here on purpose: the pane already carries `ITL_TOKEN` in its environment,
    and a copy written into a config file would outlive the session that owns it.
    """
    return {"command": "python3", "args": [script_path], "env": {}}


def merged_config(config: dict, entry: dict) -> dict | None:
    """A new config with our entry filed under user scope, or None when already correct.

    Returns a fresh object rather than mutating — the caller still holds the parsed
    original, and that is what it falls back to if the write fails.

    An existing entry is only replaced when it is one of ours pointing somewhere stale
    (the repo moved, the app was reinstalled). An entry a person wrote is left alone:
    they may have added flags, a wrapper, or a different interpreter on purpose.
    """
    servers = dict(config.get("mcpServers") or {})
    current = servers.get(MCP_KEY)
    if current == entry:
        return None
    if isinstance(current, dict) and not _is_ours(current):
        return None
    return {**config, "mcpServers": {**servers, MCP_KEY: entry}}


def _is_ours(entry: dict) -> bool:
    """True when this looks like an entry we wrote — a python3 run of our MCP script."""
    args = entry.get("args") or []
    return any(str(a).endswith(MCP_SCRIPT) for a in args)


def _atomic_write_json(path: Path, data: dict) -> None:
    """Write via temp file + rename, in the same directory so the rename is atomic."""
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".itl-mcp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def ensure_local_agent_mcp(home: str | None = None) -> bool:
    """Register the MCP server for agents running on this machine.

    Absent config means the agent was never run here; we do not create one, because a
    config we invented would be the first thing the agent's own onboarding overwrites.
    """
    if not auto_mcp_enabled():
        return False
    script = CLI_DIR / MCP_SCRIPT
    if not script.exists():
        return False
    path = Path(home or os.path.expanduser("~")) / CONFIG_NAME
    if not path.exists():
        return False
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        logger.info("에이전트 설정을 읽지 못해 MCP 자동 등록을 건너뜁니다: %s", e)
        return False
    if not isinstance(config, dict):
        return False
    updated = merged_config(config, mcp_entry(str(script)))
    if updated is None:
        return False
    try:
        _atomic_write_json(path, updated)
    except Exception as e:
        logger.warning("에이전트 MCP 등록 실패: %s", e)
        return False
    logger.info("itl MCP 를 에이전트 설정에 등록했습니다 (%s)", path)
    return True


# The remote half runs the same logic in the remote interpreter, because sending the
# whole config back and forth to edit it here would race with the agent writing it.
_REMOTE_MERGE = """
import json, os, sys, tempfile
entry = json.loads(sys.stdin.read())
# The path is written on this side, where ~ means something. A literal "$HOME" in a
# config file is not expanded by the agent that reads it.
entry["args"] = [os.path.expanduser(a) for a in entry.get("args") or []]
path = os.path.expanduser("~/.claude.json")
if not os.path.exists(path):
    print("MCP_NO_CONFIG"); raise SystemExit
try:
    config = json.load(open(path, encoding="utf-8"))
except Exception:
    print("MCP_UNREADABLE"); raise SystemExit
if not isinstance(config, dict):
    print("MCP_UNREADABLE"); raise SystemExit
servers = dict(config.get("mcpServers") or {})
current = servers.get("itl")
if current == entry:
    print("MCP_CURRENT"); raise SystemExit
if isinstance(current, dict) and not any(str(a).endswith("itl_mcp.py") for a in (current.get("args") or [])):
    print("MCP_USER_OWNED"); raise SystemExit
merged = dict(config)
merged["mcpServers"] = dict(servers, itl=entry)
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".itl-mcp-", suffix=".json")
with os.fdopen(fd, "w", encoding="utf-8") as f:
    json.dump(merged, f, ensure_ascii=False, indent=2)
os.replace(tmp, path)
print("MCP_REGISTERED")
"""


def build_remote_mcp_cmd() -> str:
    """Remote one-liner that merges the entry we hand it on stdin."""
    return f"python3 -c {shlex.quote(_REMOTE_MERGE)}"


def remote_mcp_entry() -> dict:
    """Where the MCP script lands on a host we set up (see itl_remote_setup).

    `~` is expanded by the remote script, which is the only side that knows the home
    directory — the local backend must not guess it.
    """
    return {"command": "python3", "args": [f"~/.local/bin/{MCP_SCRIPT}"], "env": {}}


async def ensure_remote_agent_mcp(host: dict, secrets: dict) -> str:
    """Register itl with the agent on a remote host. Returns the remote verdict.

    Never raises: a host with no agent installed, an unreadable config, or an entry the
    user wrote by hand are all ordinary answers, not failures. The terminal works either
    way — only the handoff is quieter.
    """
    if not auto_mcp_enabled():
        return "disabled"
    from host_common import run_remote_cmd
    try:
        out = await run_remote_cmd(
            host, secrets, build_remote_mcp_cmd(),
            timeout=15, stdin_data=json.dumps(remote_mcp_entry()),
        )
    except Exception as e:
        logger.info("원격 MCP 등록 건너뜀 (%s): %s", host.get("id"), e)
        return "unreachable"
    for verdict in ("MCP_REGISTERED", "MCP_CURRENT", "MCP_USER_OWNED", "MCP_NO_CONFIG", "MCP_UNREADABLE"):
        if verdict in (out or ""):
            return verdict.lower().removeprefix("mcp_")
    return "unknown"

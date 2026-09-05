"""What a host can have installed on it — the open list.

This app used to know how to install exactly two things, both of them its own. That is
backwards: the machines are the user's, the shell is the user's, and what belongs on them
is the user's call. So the catalog is data, not code — two built-in entries (tmux, the
multiplexer this app hands every session to, plus the itl CLI) and
however many the user writes. tmux is there because the app hands every session to it,
not because it is "ours". itl is a single file and is *pushed*, not typed — see its
catalog entry for why that is the one exception to rule 1.

Three rules hold this together:

1. **We do not run the install.** The command is typed into a real terminal pane on that
   host and the user presses Enter. An install asks for a sudo password, prints progress,
   and sometimes wants an answer; a headless `ssh host 'curl … | sh'` turns all three into
   a silent hang. It also means this feature grants nothing new — it types what the user
   could type, into a shell they already have.
2. **The status probe must not run the tool.** `command -v x` is the shape; `x --version`
   is not. An unrecognised flag makes many TUI programs start their interface instead of
   exiting, and with no tty on the far side that probe hangs until our timeout. Bare
   `tmux` is exactly such a program (it starts a server and a session).
3. **"Unknown" is an answer.** A probe that could not run leaves `installed = None`, not
   False. Drawing "not installed" for a host we failed to reach sends the user to press an
   install button that will also fail.
"""
from __future__ import annotations

import asyncio
import hashlib
import re
import secrets
import shlex
from pathlib import Path

# A tool the user writes is arbitrary shell. These caps exist so a paste accident cannot
# put a megabyte into the DB or the SSH command line, not as a security boundary — the
# boundary is that this is the user's own shell on the user's own host.
MAX_NAME = 200
MAX_COMMAND = 4000
MAX_DESCRIPTION = 500
MAX_DETAIL = 200

# Installs land in ~/.local/bin (almost everything that does not need root does). A
# non-interactive SSH shell does not have it on PATH —
# this repo already lost an afternoon to that with its own CLI — so the probe puts it back
# rather than asking the user to fix their rc files.
PROBE_PATH_PREFIX = 'PATH="$HOME/.local/bin:$PATH"; export PATH'

#: 확인 출력에 실리는 설치본 지문.
_FP_RE = re.compile(r"fp=([0-9a-f]{64})")

BUILTIN_TOOLS: tuple[dict, ...] = (
    {
        # tmux is here not because it is "ours" — rather the opposite. The app hands every
        # remote session to tmux, yet it used to warn when tmux was missing while offering
        # no way to install it.
        "id": "tmux",
        "name": "tmux",
        "description": (
            "터미널 멀티플렉서. 이 앱이 원격 세션을 붙잡아 두는 기본 방식이라, "
            "없으면 탭을 닫는 순간 작업이 끝납니다."
        ),
        "url": "https://github.com/tmux/tmux/wiki",
        # Bare `tmux` starts a server and creates a session — never what a probe should do.
        # `command -v` only looks at PATH.
        "check_command": "command -v tmux",
        # Package managers differ per distro, and the user reads this line before pressing
        # Enter — so a chain you can follow by eye beats a clever one-liner. A branch that
        # does not apply simply fails and the next one runs.
        "install_command": (
            "sudo apt-get install -y tmux "
            "|| sudo dnf install -y tmux "
            "|| sudo pacman -S --noconfirm tmux "
            "|| sudo apk add tmux "
            "|| brew install tmux"
        ),
    },
    {
        # itl is the one exception to rule 1, and a narrow one: it is a single stdlib-only
        # Python file that the backend already ships to hosts over stdin for every
        # delivery (itl_router). "Installing" it is placing that file under ~/.local/bin;
        # "removing" it is deleting that file. No sudo, no prompt, no network on the far
        # side, nothing an installer could hang on — so the backend does it directly
        # (`install_kind: "push"`), over the SSH it already holds, and the row offers a
        # remove button so it is as easy to take off as to put on.
        "id": "itl",
        "name": "itl",
        "description": (
            "탭 사이로 말을 옮기는 CLI. `itl list` 로 팬을 보고 `itl send 1.2 '…'` 로 "
            "다른 탭의 에이전트에게 지시합니다(다른 기계여도). 파일 하나라 언제든 지울 수 있습니다."
        ),
        "url": "",
        # ⚠️ 확인 명령은 그 도구를 **실행하지 않는다**(이 파일 머리말의 규칙 2). `command -v`
        # 로 자리만 찾고, 그 파일의 지문을 따로 찍는다 — 실행이 아니라 읽기다.
        # 지문이 없으면 "설치됨" 만 보이고 **낡았는지 알 길이 없다**(실제 신고).
        "check_command": (
            'command -v itl && { p=$(command -v itl); '
            'printf "fp=%s\n" "$(sha256sum "$p" 2>/dev/null | cut -c1-64)"; }'
        ),
        "install_command": "",
        "install_kind": "push",
        "install_path": "~/.local/bin/itl",
    },
)

BUILTIN_IDS = frozenset(t["id"] for t in BUILTIN_TOOLS)

# ── Push-installed tools (a file the backend places, not a command the user types) ──

_LOCAL_BIN = '"$HOME/.local/bin"'
_CLI_DIR = Path(__file__).resolve().parent / "cli"

#: tool id → the file that *is* the tool. Only stdlib-only single files belong here:
#: the whole point is that placing one file needs none of what rule 1 protects.
PUSHABLE: dict[str, Path] = {
    "itl": _CLI_DIR / "itl",
}


def is_pushable(tool_id: str) -> bool:
    return tool_id in PUSHABLE


def push_source(tool_id: str) -> str:
    return PUSHABLE[tool_id].read_text(encoding="utf-8")


def push_script(tool_id: str) -> str:
    """Place the file read from stdin at ~/.local/bin/<tool_id>, executable.

    `cat >` rather than an scp/sftp put: it works over every transport this app has
    (asyncssh, tailscale ssh) with the same stdin mechanism deliveries already use.
    """
    name = shlex.quote(tool_id)
    return (
        f"mkdir -p {_LOCAL_BIN} && cat > {_LOCAL_BIN}/{name} && chmod 755 {_LOCAL_BIN}/{name}"
    )


def remove_script(tool_id: str) -> str:
    """Delete exactly the file `push_script` placed. Nothing else is touched."""
    return f"rm -f {_LOCAL_BIN}/{shlex.quote(tool_id)}"


def install_path(tool_id: str) -> str:
    return f"~/.local/bin/{tool_id}"


def expected_fingerprint(tool_id: str) -> str:
    """지금 이 백엔드가 밀어 넣을 파일의 지문(sha256). 밀기 대상이 아니면 빈 문자열."""
    if not is_pushable(tool_id):
        return ""
    return hashlib.sha256(push_source(tool_id).encode("utf-8")).hexdigest()


def fingerprint_in(detail: str | None) -> str:
    """확인 출력에서 `fp=<sha256>` 을 뽑는다. 없으면 빈 문자열 = **모른다**."""
    m = _FP_RE.search(detail or "")
    return m.group(1) if m else ""


def is_outdated(tool_id: str, detail: str | None) -> bool | None:
    """설치본이 낡았나. **모르면 None** — "최신" 으로 그리면 갱신할 이유를 못 본다.

    지문을 못 읽는 경우가 실제로 있다(`sha256sum` 이 없는 기계, 권한). 그때는 모른다고
    적는 것이 이 저장소의 규칙이다(`installed: None` 과 같은 이유).
    """
    expected = expected_fingerprint(tool_id)
    found = fingerprint_in(detail)
    if not expected or not found:
        return None
    return found != expected


def local_tool_installed(tool_id: str) -> bool:
    """Is the pushed file present on *this* machine? (`which` misses ~/.local/bin under systemd.)"""
    return (Path.home() / ".local" / "bin" / tool_id).is_file()


def builtin_tools() -> list[dict]:
    """Copies — callers merge these with user rows and must not mutate the originals."""
    return [dict(tool, builtin=True) for tool in BUILTIN_TOOLS]


def merge_tools(custom_rows: list[dict]) -> list[dict]:
    """Built-ins first, then the user's own in their stored order.

    A user row whose id collides with a built-in wins: it means they edited that entry,
    and the edit is the more recent statement of what they want.
    """
    rows = [dict(row, builtin=False) for row in (custom_rows or [])]
    overridden = {row.get("id") for row in rows}
    return [t for t in builtin_tools() if t["id"] not in overridden] + rows


def build_check_script(tools: list[dict], marker: str) -> str:
    """One script that probes every tool, so a host costs one round trip and not N.

    Framing is a per-request random marker rather than a fixed string: a probe prints
    whatever the tool prints, and a fixed marker could be forged by that output into a
    wrong verdict for the *next* tool.
    """
    parts = [PROBE_PATH_PREFIX]
    for tool in tools:
        check = (tool.get("check_command") or "").strip()
        tool_id = (tool.get("id") or "").strip()
        if not check or not tool_id:
            continue
        head = shlex.quote(f"{marker} {tool_id}")
        ok = shlex.quote(f"{marker} ok")
        no = shlex.quote(f"{marker} no")
        parts.append(
            f"printf '%s\\n' {head}; "
            f"if _itl_o=$( {{ {check} ; }} 2>&1 ); "
            f"then printf '%s\\n' {ok}; else printf '%s\\n' {no}; fi; "
            f'printf \'%s\\n\' "$_itl_o" | head -3'
        )
    parts.append("unset _itl_o 2>/dev/null || true")
    return "\n".join(parts)


def parse_check_output(text: str | None, marker: str) -> dict[str, dict]:
    """`{tool_id: {"installed": bool|None, "detail": str}}`.

    A tool the output never mentions is simply absent from the result — the caller reports
    that as unknown. Half an answer is the normal case when a connection drops mid-probe.
    """
    results: dict[str, dict] = {}
    current: str | None = None
    prefix = f"{marker} "
    for line in (text or "").splitlines():
        if line.startswith(prefix):
            rest = line[len(prefix):].strip()
            if rest in ("ok", "no"):
                if current:
                    results[current]["installed"] = rest == "ok"
            else:
                current = rest
                results.setdefault(current, {"installed": None, "detail": []})
            continue
        if current and line.strip():
            results[current]["detail"].append(line.rstrip())
    return {
        tool_id: {
            "installed": value["installed"],
            "detail": " ".join(value["detail"]).strip()[:MAX_DETAIL],
        }
        for tool_id, value in results.items()
    }


def new_marker() -> str:
    return f"@@TOOL{secrets.token_hex(6)}"


async def run_local_script(script: str, timeout: float = 15.0) -> str:
    """The app's own machine is a target too — it is a host the user works on.

    Bounded like every other wait in this repo: a probe that hangs would hold the panel
    open with nothing on it.
    """
    _rc, out = await run_local_script_full(script, timeout=timeout)
    return out


async def run_local_script_full(script: str, timeout: float = 15.0,
                                stdin_data: str | None = None) -> tuple[int, str]:
    """`(exit_code, combined output)` — for callers that must know it succeeded."""
    proc = await asyncio.create_subprocess_exec(
        "/bin/sh", "-c", script,
        stdin=asyncio.subprocess.PIPE if stdin_data is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )
    payload = stdin_data.encode("utf-8") if stdin_data is not None else None
    try:
        stdout, _ = await asyncio.wait_for(proc.communicate(input=payload), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        raise
    return proc.returncode or 0, stdout.decode("utf-8", errors="replace")

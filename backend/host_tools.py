"""What a host can have installed on it — the open list.

This app used to know how to install exactly two things, both of them its own. That is
backwards: the machines are the user's, the shell is the user's, and what belongs on them
is the user's call. So the catalog is data, not code — two built-in entries (the
multiplexers this app can hand a session to: tmux and herdr) and however many the user
writes. Neither built-in is "ours"; they are there because the app offers to use them.

Three rules hold this together:

1. **We do not run the install.** The command is typed into a real terminal pane on that
   host and the user presses Enter. An install asks for a sudo password, prints progress,
   and sometimes wants an answer; a headless `ssh host 'curl … | sh'` turns all three into
   a silent hang. It also means this feature grants nothing new — it types what the user
   could type, into a shell they already have.
2. **The status probe must not run the tool.** `command -v x` is the shape; `x --version`
   is not. An unrecognised flag makes many TUI programs start their interface instead of
   exiting, and with no tty on the far side that probe hangs until our timeout. herdr is
   exactly such a program (bare `herdr` starts the multiplexer).
3. **"Unknown" is an answer.** A probe that could not run leaves `installed = None`, not
   False. Drawing "not installed" for a host we failed to reach sends the user to press an
   install button that will also fail.
"""
from __future__ import annotations

import asyncio
import secrets
import shlex

# A tool the user writes is arbitrary shell. These caps exist so a paste accident cannot
# put a megabyte into the DB or the SSH command line, not as a security boundary — the
# boundary is that this is the user's own shell on the user's own host.
MAX_NAME = 200
MAX_COMMAND = 4000
MAX_DESCRIPTION = 500
MAX_DETAIL = 200

# Installs land in ~/.local/bin (herdr's installer does, and so does almost everything
# else that does not need root). A non-interactive SSH shell does not have it on PATH —
# this repo already lost an afternoon to that with its own CLI — so the probe puts it back
# rather than asking the user to fix their rc files.
PROBE_PATH_PREFIX = 'PATH="$HOME/.local/bin:$PATH"; export PATH'

BUILTIN_TOOLS: tuple[dict, ...] = (
    {
        # tmux 가 여기 있는 이유는 "우리 것" 이어서가 아니다 — 오히려 그 반대다. 이 앱은
        # 원격 호스트에서 세션을 붙잡아 두는 데 tmux 를 쓸 수 있는데, **깔 방법은 주지
        # 않으면서 없으면 경고만 띄우고 있었다.** 고를 수 있게 만든 이상 깔 수도 있어야
        # 한다(멀티플렉서 선택은 backend/multiplexer.py).
        "id": "tmux",
        "name": "tmux",
        "description": (
            "터미널 멀티플렉서. 이 앱이 원격 세션을 붙잡아 두는 기본 방식이라, "
            "없으면 탭을 닫는 순간 작업이 끝납니다."
        ),
        "url": "https://github.com/tmux/tmux/wiki",
        # `tmux` 를 인자 없이 부르면 서버를 띄우고 세션을 만든다 — 확인이 목적인 자리에서
        # 그러면 안 된다. `command -v` 는 PATH 만 본다.
        "check_command": "command -v tmux",
        # 배포판마다 패키지 관리자가 다르고, 이 명령은 **사용자가 읽고 엔터를 누른다.**
        # 그래서 영리한 한 줄보다 눈으로 따라갈 수 있는 사슬이 낫다 — 안 맞는 갈래는
        # 그냥 실패하고 다음으로 넘어간다.
        "install_command": (
            "sudo apt-get install -y tmux "
            "|| sudo dnf install -y tmux "
            "|| sudo pacman -S --noconfirm tmux "
            "|| sudo apk add tmux "
            "|| brew install tmux"
        ),
    },
    {
        "id": "herdr",
        "name": "herdr",
        "description": (
            "에이전트를 아는 터미널 멀티플렉서. 세션이 끊겨도 살아 있고, "
            "세션끼리 서로 명령을 주고받습니다. 러스트 바이너리 하나라 의존성이 없습니다."
        ),
        "url": "https://herdr.dev",
        # Never `herdr --version`: bare herdr starts the multiplexer, and an unknown flag
        # can fall through to that. `command -v` only looks at PATH.
        "check_command": "command -v herdr",
        "install_command": "curl -fsSL https://herdr.dev/install.sh | sh",
    },
)

BUILTIN_IDS = frozenset(t["id"] for t in BUILTIN_TOOLS)


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
    proc = await asyncio.create_subprocess_exec(
        "/bin/sh", "-c", script,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )
    try:
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        raise
    return stdout.decode("utf-8", errors="replace")

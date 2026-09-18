"""Scroll the history of an owned tmux terminal without injecting shell input."""

from __future__ import annotations

import asyncio
import shlex

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from _deps import verify_auth_token
from host_common import resolve_host_with_secrets, run_remote_cmd_pooled
from sqlite_storage import storage
from terminal_prompt_context import prompt_context
from tmux_manager import tmux_manager

router = APIRouter(tags=["terminal"])
FORMAT = "#{pane_id}|#{history_size}|#{scroll_position}|#{pane_height}|#{pane_mode}"


class ScrollRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=256)
    host_id: str | None = None
    offset: int = Field(ge=0, le=10_000_000)
    include_input: bool = False


def scroll_script(base: list[str], session: str, offset: int | None = None, include_input: bool = False) -> str:
    """Resolve the active pane once, then use that exact pane for every operation."""
    tmux = shlex.join(base)
    target = shlex.quote(f"={session}:")
    script = f'pane=$({tmux} display-message -p -t {target} "#{{pane_id}}") || exit 1\n'
    script += 'case "$pane" in %*[!0-9]*|%|"") exit 1;; %*) ;; *) exit 1;; esac\n'
    if offset is not None:
        # Never cancel another tmux mode (choose-tree, prompts, etc.). No raw keys
        # are sent: even if the shell is active, -X only addresses copy-mode.
        script += f'mode=$({tmux} display-message -p -t "$pane" "#{{pane_mode}}")\n'
        script += 'case "$mode" in ""|copy-mode) ;; *) exit 1;; esac\n'
        if offset == 0:
            script += f'[ "$mode" != copy-mode ] || {tmux} send-keys -t "$pane" -X cancel\n'
        else:
            # Refresh the copy-mode snapshot for an explicit seek. New output
            # may have grown real history since the previous snapshot froze.
            script += f'[ "$mode" != copy-mode ] || {tmux} send-keys -t "$pane" -X cancel\n'
            script += f'history=$({tmux} display-message -p -t "$pane" "#{{history_size}}")\n'
            script += 'case "$history" in ""|*[!0-9]*) exit 1;; esac\n'
            script += f'count={int(offset)}; [ "$count" -le "$history" ] || count=$history\n'
            script += f'{tmux} copy-mode -e -t "$pane" && '
            script += f'{tmux} send-keys -t "$pane" -X history-bottom && '
            script += f'{{ if [ "$count" -ge "$history" ]; then {tmux} send-keys -t "$pane" -X history-top; '
            script += f'else {tmux} send-keys -t "$pane" -X -N "$count" scroll-up; fi; }} || exit 1\n'
    script += f'state=$({tmux} display-message -p -t "$pane" {shlex.quote(FORMAT)}) || exit 1\n'
    script += 'printf "%s\\n" "$state"'
    if include_input:
        # Read only while browsing history, and reuse the same owned pane.
        # Count logical rows through the viewport top, then capture a little
        # beyond it so a question crossing that edge is still complete. -J
        # preserves terminal wrapping, including wide Korean characters.
        script += '\nIFS="|" read -r pane history position rows mode <<EOF\n$state\nEOF\n'
        script += '[ "$mode" = copy-mode ] || exit 0\n'
        for name in ("history", "position", "rows"):
            script += f'case "${name}" in ""|*[!0-9]*) exit 0;; esac\n'
        script += '[ "$position" -gt 0 ] || exit 0\n'
        script += 'top=$((-position)); start=$((top-4000)); end=$((top+80))\n'
        script += '[ "$start" -ge "$((-history))" ] || start=$((-history))\n'
        script += '[ "$end" -lt "$rows" ] || end=$((rows-1))\n'
        capture = f'{tmux} capture-pane -p -J -t "$pane" -S "$start"'
        script += f'count=$({capture} -E "$top" | awk \'END {{print NR}}\')\n'
        # Pair physical rows with joined lines to locate the prompt after reflow.
        # Ignore whitespace padding introduced by wide-character terminal cells.
        script += f'raw=$({tmux} capture-pane -p -N -t "$pane" -S "$start" -E "$top" | head -c 1048576)\n'
        script += 'rawcount=$(printf "%s\\n" "$raw" | awk \'END {print NR}\')\n'
        script += 'printf "CONTEXT:%s:%s:%s\\n%s\\n" "$count" "$start" "$rawcount" "$raw"\n'
        # Bound output over SSH as well as locally. An incomplete tail fails
        # closed below rather than attributing an answer to an older question.
        script += f'{capture} -E "$end" | head -c 1048576'
        script += f'\nprintf "\\nCONTEXT-END:%s\\n" "$({tmux} display-message -p -t "$pane" {shlex.quote(FORMAT)})"'
    return script


def parse_state(output: str, include_input: bool = False) -> dict:
    try:
        lines = output.splitlines()
        pane, history, offset, rows, mode = lines[0].strip().split("|")
        history, offset, rows = int(history), int(offset or 0), int(rows)
        if not pane.startswith("%") or min(history, offset) < 0 or rows < 1:
            raise ValueError
        state = {
            "available": mode in ("", "copy-mode"),
            "history": history,
            "offset": min(history, offset),
            "rows": rows,
        }
        if include_input:
            state["input_context"] = None
            if (state["available"] and offset > 0 and len(lines) > 3 and lines[1].startswith("CONTEXT:")
                    and lines[-1] == "CONTEXT-END:" + lines[0]):
                try:
                    metadata = [int(value) for value in lines[1][8:].split(":")]
                    top = metadata[0] - 1
                    raw_count = metadata[2] if len(metadata) == 3 else 0
                    joined = lines[2 + raw_count:-1]
                    context = prompt_context(joined, top, include_position=True)
                    if context:
                        target = context.pop("line")
                        if len(metadata) == 3 and raw_count > 0:
                            physical = lines[2:2 + raw_count]
                            row = 0
                            for logical in joined[:target]:
                                logical = "".join(logical.split())
                                combined = ""
                                while row < len(physical):
                                    combined += "".join(physical[row].split())
                                    row += 1
                                    if combined == logical:
                                        break
                                else:
                                    row = len(physical)
                                    break
                            if (row < len(physical)
                                    and "".join(joined[target].split()).startswith("".join(physical[row].split()))
                                    and physical[row].lstrip().startswith(("› ", "❯ "))):
                                context["offset"] = min(history, max(0, -metadata[1] - row))
                        state["input_context"] = context
                except ValueError:
                    pass
        return state
    except (ValueError, TypeError, IndexError):
        return {"available": False}


async def scroll_terminal(username: str, session: str, host_id: str | None, offset: int | None = None,
                          include_input: bool = False):
    if host_id:
        host, secrets = await resolve_host_with_secrets(host_id, username)
        command = 'export PATH="$HOME/.local/bin:$PATH"; ' + scroll_script(["tmux"], session, offset, include_input)
        try:
            rc, out, _ = await run_remote_cmd_pooled(host, secrets, command, timeout=5)
        except Exception as exc:
            raise HTTPException(503, "스크롤 기록을 불러올 수 없습니다") from exc
    else:
        # Require a recorded owner; an unknown session must not expose an arbitrary
        # tmux session belonging to the backend's OS account.
        owner = await storage.get_session_owner(session)
        if owner != username:
            raise HTTPException(404, "터미널을 찾을 수 없습니다")
        proc = await asyncio.create_subprocess_exec(
            "sh",
            "-c",
            scroll_script(tmux_manager._base_args(), session, offset, include_input),
            env=tmux_manager._tmux_env(),
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=3)
        except TimeoutError as exc:
            raise HTTPException(503, "스크롤 기록을 불러올 수 없습니다") from exc
        finally:
            if proc.returncode is None:
                proc.kill()
                await proc.wait()
        rc, out = proc.returncode, stdout.decode("utf-8", errors="replace")
    if rc != 0:
        if offset is not None:
            raise HTTPException(409, "지금은 터미널 기록을 스크롤할 수 없습니다")
        return {"available": False}
    return parse_state(out, include_input)


@router.get("/api/terminal-scroll")
async def get_scroll(
    response: Response,
    session_id: str = Query(min_length=1, max_length=256),
    host_id: str | None = None,
    include_input: bool = False,
    username: str = Depends(verify_auth_token),
):
    response.headers["Cache-Control"] = "no-store"
    return await scroll_terminal(username, session_id, host_id, include_input=include_input)


@router.post("/api/terminal-scroll")
async def set_scroll(request: ScrollRequest, response: Response, username: str = Depends(verify_auth_token)):
    response.headers["Cache-Control"] = "no-store"
    return await scroll_terminal(username, request.session_id, request.host_id, request.offset, request.include_input)

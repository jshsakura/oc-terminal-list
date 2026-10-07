"""Scroll owned tmux history or deliver restricted application wheel events."""

from __future__ import annotations

import asyncio
import shlex
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator

from _deps import verify_auth_token
from host_common import force_shquote, resolve_host_with_secrets, run_remote_cmd_pooled
from sqlite_storage import storage
from terminal_prompt_context import prompt_context
from tmux_manager import tmux_manager

router = APIRouter(tags=["terminal"])
FORMAT = ("#{pane_id}|#{history_size}|#{scroll_position}|#{pane_height}|#{pane_mode}"
          "|#{mouse_any_flag}|#{mouse_sgr_flag}|#{pane_width}|#{mouse_utf8_flag}")


class ScrollRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str = Field(min_length=1, max_length=256)
    host_id: str | None = None
    offset: int | None = Field(default=None, ge=0, le=10_000_000)
    lines: int | None = Field(default=None, ge=-48, le=48)
    action: Literal["bottom"] | None = None
    col: int = Field(default=1, ge=1, le=10_000)
    row: int = Field(default=1, ge=1, le=10_000)
    include_input: bool = False

    @model_validator(mode="after")
    def validate_operation(self):
        if sum(value is not None for value in (self.offset, self.lines, self.action)) != 1 or self.lines == 0:
            raise ValueError("Provide an offset, nonzero relative lines or bottom action")
        return self


def scroll_script(base: list[str], session: str, offset: int | None = None, include_input: bool = False,
                  lines: int | None = None, col: int = 1, row: int = 1, action: str | None = None) -> str:
    """Resolve the active pane once, then use that exact pane for every operation."""
    if action is not None:
        if action != "bottom" or offset is not None or lines is not None:
            raise ValueError("Invalid bottom operation")
        offset = 0
    tmux = shlex.join(base)
    target = force_shquote(f"={session}:")
    script = f'state=$({tmux} display-message -p -t {target} {shlex.quote(FORMAT)}) || exit 1\n'
    script += 'IFS="|" read -r pane hist position rows mode mouse sgr cols utf8 <<EOF\n$state\nEOF\n'
    script += 'case "$pane" in %*[!0-9]*|%|"") exit 1;; %*) ;; *) exit 1;; esac\n'
    for name in ("hist", "rows"):
        script += f'case "${name}" in ""|*[!0-9]*) exit 1;; esac\n'
    script += 'case "$position" in "") position=0;; *[!0-9]*) exit 1;; esac\n'
    if lines is not None:
        if not -48 <= lines <= 48 or lines == 0 or not 1 <= col <= 10_000 or not 1 <= row <= 10_000:
            raise ValueError("Invalid wheel movement")
        for name in ("mouse", "sgr", "utf8"):
            script += f'case "${name}" in 0|1) ;; *) exit 1;; esac\n'
        script += 'if [ -z "$mode" ] && [ "$mouse" = 1 ]; then\n'
        script += '  case "$cols" in ""|*[!0-9]*) exit 1;; esac\n'
        script += '  [ "$cols" -gt 0 ] && [ "$rows" -gt 0 ] || exit 1\n'
        script += f'  col={col}; row={row}\n'
        script += '  [ "$col" -le "$cols" ] || col=$cols\n  [ "$row" -le "$rows" ] || row=$rows\n'
        script += '  if [ "$sgr" = 1 ]; then\n'
        script += f'    payload=$(printf "\\033[<{64 if lines < 0 else 65};%s;%sM" "$col" "$row"'
        script += ' | od -An -v -tx1 | tr \'\\n\' \' \')\n'
        script += '  else\n'
        script += '    if [ "$utf8" != 1 ]; then\n'
        script += '      [ "$col" -le 223 ] || col=223\n      [ "$row" -le 223 ] || row=223\n    fi\n'
        script += '    coord_hex() {\n      value=$1\n'
        script += '      if [ "$utf8" = 1 ] && [ "$value" -gt 2047 ]; then\n'
        script += '        printf \'%02x %02x %02x\' "$((224+value/4096))" "$((128+value/64%64))" "$((128+value%64))"\n'
        script += '      elif [ "$utf8" = 1 ] && [ "$value" -gt 127 ]; then\n'
        script += '        printf \'%02x %02x\' "$((192+value/64))" "$((128+value%64))"\n'
        script += '      else\n        printf \'%02x\' "$value"\n      fi\n    }\n'
        script += f'    payload="1b 5b 4d {96 if lines < 0 else 97:02x}'
        script += ' $(coord_hex "$((col+32))") $(coord_hex "$((row+32))")"\n'
        script += '  fi\n'
        script += '  condition="#{&&:#{==:#{pane_mode},},#{&&:#{mouse_any_flag},'
        script += '#{&&:#{==:#{mouse_sgr_flag},$sgr},#{==:#{mouse_utf8_flag},$utf8}}}}"\n'
        script += f'  {tmux} if-shell -F -t "$pane" "$condition"'
        script += f' "send-keys -t $pane -H -N {abs(lines)} $payload" || exit 1\n'
        script += f'  {tmux} display-message -p -t "$pane" {shlex.quote(FORMAT)}\n  exit $?\nfi\n'
    if offset is not None or lines is not None:
        script += 'case "$mode" in ""|copy-mode) ;; *) exit 1;; esac\n'
        script += f'count={int(offset)}\n' if offset is not None else f'count=$((position-({lines})))\n'
        script += '[ "$count" -ge 0 ] || count=0\n[ "$count" -le "$hist" ] || count=$hist\n'
        script += 'if [ "$count" -eq 0 ]; then\n'
        script += '  if [ "$mode" = copy-mode ]; then\n'
        script += f'    state=$({tmux} send-keys -t "$pane" -X cancel \\; '
        script += f'display-message -p -t "$pane" {shlex.quote(FORMAT)}) || exit 1\n'
        script += '  fi\nelse\n'
        script += 'run_seek() {\n'
        script += '  if [ "$mode" = copy-mode ]; then\n'
        script += f'    {tmux} send-keys -t "$pane" -X cancel \\; "$@"\n'
        script += '  else\n'
        script += f'    {tmux} "$@"\n'
        script += '  fi\n}\n'
        queue = 'copy-mode -e -t "$pane" \\; send-keys -t "$pane" -X history-bottom \\; '
        final = f' \\; display-message -p -t "$pane" {shlex.quote(FORMAT)}'
        script += 'if [ "$count" -ge "$hist" ]; then\n'
        script += f'  state=$(run_seek {queue}send-keys -t "$pane" -X history-top{final}) || exit 1\n'
        script += 'else\n'
        script += f'  state=$(run_seek {queue}send-keys -t "$pane" -X -N "$count" scroll-up{final}) || exit 1\n'
        script += 'fi\nfi\n'
    if action == "bottom":
        script += f'  {tmux} if-shell -F -t "$pane" \'#{{&&:#{{==:#{{pane_mode}},}},#{{mouse_any_flag}}}}\''
        script += ' "send-keys -t $pane -H 1b" || exit 1\n'
        script += f'state=$({tmux} display-message -p -t "$pane" {shlex.quote(FORMAT)}) || exit 1\n'
    script += 'printf "%s\\n" "$state"'
    if include_input:
        # Read only while browsing history, and reuse the same owned pane.
        # Count logical rows through the viewport top, then capture a little
        # beyond it so a question crossing that edge is still complete. -J
        # preserves terminal wrapping, including wide Korean characters.
        script += '\nIFS="|" read -r pane hist position rows mode mouse sgr cols utf8 <<EOF\n$state\nEOF\n'
        script += '[ "$mode" = copy-mode ] || exit 0\n'
        for name in ("hist", "position", "rows"):
            script += f'case "${name}" in ""|*[!0-9]*) exit 0;; esac\n'
        script += '[ "$position" -gt 0 ] || exit 0\n'
        script += 'top=$((-position)); start=$((top-4000)); end=$((top+80))\n'
        script += '[ "$start" -ge "$((-hist))" ] || start=$((-hist))\n'
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
        fields = lines[0].strip().split("|")
        pane, history, offset, rows, mode = fields[:5]
        history, offset, rows = int(history), int(offset or 0), int(rows)
        if not pane.startswith("%") or not pane[1:].isdigit() or min(history, offset) < 0 or rows < 1:
            raise ValueError
        state = {
            "available": mode in ("", "copy-mode"),
            "history": history,
            "offset": min(history, offset),
            "rows": rows,
        }
        if len(fields) == 9:
            mouse, sgr, cols, utf8 = fields[5:]
            if mouse not in ("0", "1") or sgr not in ("0", "1") or utf8 not in ("0", "1") or int(cols) < 1:
                raise ValueError
            state["target"] = "application" if mode == "" and mouse == "1" else "history"
        elif len(fields) != 5:
            raise ValueError
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
                          include_input: bool = False, lines: int | None = None, col: int = 1, row: int = 1,
                          action: str | None = None):
    if host_id:
        host, secrets = await resolve_host_with_secrets(host_id, username)
        command = 'export PATH="$HOME/.local/bin:$PATH"; ' + scroll_script(
            ["tmux"], session, offset, include_input, lines, col, row, action)
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
            scroll_script(tmux_manager._base_args(), session, offset, include_input, lines, col, row, action),
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
        if offset is not None or lines is not None or action is not None:
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
    return await scroll_terminal(username, request.session_id, request.host_id, request.offset, request.include_input,
                                 request.lines, request.col, request.row, request.action)

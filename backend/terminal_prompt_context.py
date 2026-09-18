"""Find the question preceding a viewport in rendered terminal history."""

import re

PROMPT = re.compile(r"^\s{0,2}[›❯] (\S.*)$")
CONTROL = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]|[\x00-\x08\x0b-\x1f\x7f]")
MAX_INPUT = 32768


def prompt_context(lines: list[str], top: int, *, include_position: bool = False) -> dict | None:
    """Use the last explicit agent prompt at/before the first visible line.

    A shell '$' or Markdown '>' in an answer is not evidence of a question.
    Wrapped physical rows must already be joined by the terminal.
    """
    if top < 0 or top >= len(lines):
        return None
    lines = [CONTROL.sub("", line).rstrip() for line in lines]
    start = next((row for row in range(top, -1, -1) if PROMPT.match(lines[row])), None)
    if start is None:
        return None
    text = PROMPT.match(lines[start]).group(1)
    for line in lines[start + 1:]:
        if not line.strip() or PROMPT.match(line) or not line.startswith("  "):
            break
        text += "\n" + line[2:]
        if len(text) >= MAX_INPUT:
            break
    return {"text": text[:MAX_INPUT], **({"line": start} if include_position else {})}

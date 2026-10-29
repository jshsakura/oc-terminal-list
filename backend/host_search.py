"""Remote host file search: builds one shell command and parses its stdout.

The search runs on the host (find / rg / grep) over the already-authenticated SSH
connection, so nothing is installed there. Everything here is pure so it can be
tested without a host.
"""
from __future__ import annotations

import shlex

MODE_NAME = "name"
MODE_CONTENT = "content"
MAX_QUERY_LEN = 200
MAX_RESULTS = 200
MAX_SNIPPET_LEN = 300
EXIT_BAD_ROOT = 3

IGNORED_DIRS = (
    ".git", "node_modules", ".venv", "venv", "__pycache__", ".cache",
    "dist", "build", ".next", ".mypy_cache", ".pytest_cache",
)

_GLOB_SPECIALS = "\\*?["


def escape_glob(text: str) -> str:
    """Make `text` literal inside a find -iname pattern."""
    return "".join(f"\\{c}" if c in _GLOB_SPECIALS else c for c in text)


def _root_prefix(root: str) -> str:
    """cd into root and pin its absolute path in $R. Empty / '~' means the home dir."""
    root = (root or "").strip()
    if root in ("", "~"):
        cd = "cd"
    elif root.startswith("~/"):
        cd = f"cd -- ~/{shlex.quote(root[2:])}"
    else:
        cd = f"cd -- {shlex.quote(root)}"
    return f'{cd} 2>/dev/null || exit {EXIT_BAD_ROOT}; R=$(pwd -P); '


def _find_command(query: str) -> str:
    prune = " -o ".join(f"-name {shlex.quote(d)}" for d in IGNORED_DIRS)
    pattern = shlex.quote(f"*{escape_glob(query)}*")
    expr = f'find "$R" \\( {prune} \\) -prune -o -iname {pattern}'
    # GNU find tags each hit with its type; other finds fall back to untyped paths ('?').
    return (
        f"if find \"$R\" -maxdepth 0 -printf '' >/dev/null 2>&1; "
        f"then {expr} -printf '%y\\t%p\\n'; "
        f"else {expr} -print | awk '{{print \"?\\t\" $0}}'; fi"
    )


def _content_command(query: str) -> str:
    q = shlex.quote(query)
    rg_ignores = " ".join(f"-g {shlex.quote('!' + d)}" for d in IGNORED_DIRS)
    grep_ignores = " ".join(f"--exclude-dir={shlex.quote(d)}" for d in IGNORED_DIRS)
    return (
        "if command -v rg >/dev/null 2>&1; then "
        f"rg -n --null --no-heading -i -F --max-count 10 --max-filesize 1M --max-columns {MAX_SNIPPET_LEN} "
        f"{rg_ignores} -e {q} -- \"$R\"; "
        f"else grep -rIinF --null -m 10 {grep_ignores} -e {q} -- \"$R\"; fi"
    )


def build_command(root: str, query: str, mode: str) -> str:
    body = _find_command(query) if mode == MODE_NAME else _content_command(query)
    return f"{_root_prefix(root)}{{ {body}; }} 2>/dev/null | head -n {MAX_RESULTS + 1}"


def _basename(path: str) -> str:
    return path.rstrip("/").rsplit("/", 1)[-1]


def parse_name_output(stdout: str) -> list[dict]:
    items = []
    for line in stdout.splitlines():
        kind, sep, path = line.partition("\t")
        if not sep or not path:
            continue
        items.append({
            "path": path,
            "name": _basename(path),
            "type": "directory" if kind == "d" else "file",
        })
    return items


def parse_content_output(stdout: str) -> list[dict]:
    items = []
    for line in stdout.splitlines():
        path, sep, rest = line.partition("\0")
        if not sep or not path:
            continue
        number, _, text = rest.partition(":")
        if not number.isdigit():
            continue
        items.append({
            "path": path,
            "name": _basename(path),
            "type": "file",
            "line": int(number),
            "text": text[:MAX_SNIPPET_LEN],
        })
    return items


def parse_output(stdout: str, mode: str) -> dict:
    """Parse and cap. We ask for one extra line so `truncated` is exact."""
    parse = parse_name_output if mode == MODE_NAME else parse_content_output
    items = parse(stdout)
    return {"items": items[:MAX_RESULTS], "truncated": len(items) > MAX_RESULTS}

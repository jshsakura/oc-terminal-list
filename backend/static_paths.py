"""Map a URL path onto a file inside the built frontend directory.

The SPA catch-all receives the decoded URL path, so it can climb with ".." or be
absolute (pathlib drops the left side of `root / "/etc/passwd"`). Both must stay
inside the static root, or an unauthenticated request reads any file on the box.
"""
from __future__ import annotations

from pathlib import Path


def resolve_static_file(static_dir: Path, request_path: str) -> Path | None:
    """Return the regular file under static_dir named by request_path, or None."""
    try:
        root = static_dir.resolve()
        candidate = (root / request_path).resolve()
        if not candidate.is_relative_to(root) or not candidate.is_file():
            return None
    except (OSError, ValueError):
        return None
    return candidate

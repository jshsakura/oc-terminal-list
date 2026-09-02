"""Per-session key for the itl marker channel — proves *where* a marker line came from.

The marker channel (itl_channel) picks `__ITL_SEND__ {...}` lines out of a pane's PTY
output. Without this key **any bytes that reach the PTY are a sender**: a `curl`ed web
page, a `cat`ed README, the shell of a compromised host. Each of those could type — and
submit — a command into any other pane of the user, including a shell on this server.

The key closes exactly that class. Code running *inside* the pane can read it (that code
already owns the pane); data merely printed *through* the pane cannot know it. It is not a
credential for anything else: knowing it grants nothing beyond what the pane already has,
so it does not violate the "no credentials on the host" rule the router is built on.

How it reaches the pane, per multiplexer:

| where                    | carrier                                      |
|--------------------------|----------------------------------------------|
| local tmux session       | tmux user option `@itl_key` (tmux_manager)   |
| remote tmux session      | same option, set by the SSH bootstrap        |
| local herdr / plain shell| env `ITL_KEY` on the spawned process         |

Remote herdr / plain-shell panes get no key and therefore cannot send through this
channel (herdr has its own remote). That is documented, not accidental.

Keys are derived, not stored: HMAC(secret, scope). tmux sessions outlive the backend
(`KillMode=process`), so a per-process random would strand every surviving session;
a stored table would need a migration. Derivation from one secret file needs neither.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re
import secrets
from pathlib import Path

logger = logging.getLogger(__name__)

#: tmux user option that carries the key. `backend/cli/itl` reads the same name.
KEY_OPTION = "@itl_key"
#: Environment variable for panes that are not tmux (local herdr / plain shell).
KEY_ENV = "ITL_KEY"
#: Hex chars of the derived key. 32 hex = 128 bits; the line is printed to a terminal,
#: so it stays short enough not to wrap on narrow panes.
KEY_HEX_LEN = 32

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_SECRET_PATH = _PROJECT_ROOT / "data" / ".itl-secret"
_cached_secret: bytes | None = None


def _secret_path() -> Path:
    return Path(os.getenv("ITL_SECRET_PATH") or _DEFAULT_SECRET_PATH)


def _load_secret() -> bytes:
    """Read the secret, creating it (0600) on first use. Cached for the process."""
    global _cached_secret
    if _cached_secret is not None:
        return _cached_secret
    path = _secret_path()
    try:
        raw = path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        raw = ""
    if not raw:
        raw = secrets.token_urlsafe(32)
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            os.write(fd, raw.encode("utf-8"))
        finally:
            os.close(fd)
        logger.info("itl secret created at %s", path)
    _cached_secret = raw.encode("utf-8")
    return _cached_secret


def reset_cache() -> None:
    """Tests only — forget the cached secret so a new path takes effect."""
    global _cached_secret
    _cached_secret = None


def local_scope(session_id: str) -> str:
    return f"local:{session_id}"


def host_scope(host_id: str, session_name: str) -> str:
    return f"host:{host_id}:{session_name}"


def key_for(scope: str) -> str:
    """Derived key for one scope. Same scope → same key across restarts."""
    digest = hmac.new(_load_secret(), scope.encode("utf-8"), hashlib.sha256).hexdigest()
    return digest[:KEY_HEX_LEN]


#: What a key looks like on the wire. Checked before comparing: `compare_digest` on str
#: raises on non-ASCII, and a raised exception inside the output pump kills the pane —
#: which would let any web page containing `"key":"é"` disconnect the viewer.
_KEY_RE = re.compile(rf"^[0-9a-f]{{{KEY_HEX_LEN}}}$")


def matches(expected: str | None, given: str | None) -> bool:
    """Constant-time compare; a missing or malformed side never matches, never raises."""
    if not isinstance(expected, str) or not isinstance(given, str):
        return False
    if not (_KEY_RE.match(expected) and _KEY_RE.match(given)):
        return False
    return hmac.compare_digest(expected.encode("ascii"), given.encode("ascii"))

"""Remote panes that are attached right now, so the backend can talk to their session.

The app address (`tab.pane`) is a fact this backend owns, and the tmux option `@pane_addr`
is only a cache of it inside the pane. For local sessions the cache is refreshed by
running tmux here (pane_addr). For a remote session there is no local tmux to run — but
while a pane is attached, its bridge is holding an authenticated SSH connection to that
exact machine, and running one more command on it is a new channel, not a new handshake.

So: a bridge registers itself while it lives, and `pane_addr` asks the registry to
re-stamp when the number shifts.

⚠️ **Only sessions held by tmux.** A remote plain-shell pane has no tmux option to stamp;
a registered bridge whose session turned out not to be tmux simply fails the stamp and is
ignored.

⚠️ **Unregister must check identity.** A reconnect creates the new bridge before the old
one tears down, so a blind `pop` on the old one's way out would erase the live entry and
the pane would go silently un-stampable until the next attach. This repo has lost
afternoons to exactly this shape of race.

Process-local, like `ws_clients` — it assumes the single backend process this app runs as.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Protocol

logger = logging.getLogger(__name__)


class RemotePane(Protocol):
    async def stamp_pane_addr(self, addr: str) -> bool:
        ...


#: (host_id, remote session name) → the bridge currently attached to it.
_live: dict[tuple[str, str], RemotePane] = {}


def key_of(host_id: str, session: str) -> tuple[str, str]:
    return (str(host_id or ""), str(session or ""))


def register(host_id: str, session: str, bridge: RemotePane) -> None:
    key = key_of(host_id, session)
    if not all(key):
        return
    _live[key] = bridge


def unregister(host_id: str, session: str, bridge: RemotePane) -> None:
    """Remove only if this bridge is still the registered one (see the race above)."""
    key = key_of(host_id, session)
    if _live.get(key) is bridge:
        _live.pop(key, None)


def live_keys() -> set[tuple[str, str]]:
    return set(_live)


async def stamp(host_id: str, session: str, addr: str) -> bool:
    """Ask the attached bridge to write `addr` on its remote session.

    False when nothing is attached (nothing to talk to), when the far side is not tmux,
    or when the command failed. The caller must not cache a False as "done" — the next
    attach, or the next number change, has to try again.
    """
    bridge = _live.get(key_of(host_id, session))
    if bridge is None:
        return False
    try:
        return await bridge.stamp_pane_addr(addr)
    except asyncio.CancelledError:
        raise
    except Exception as e:                       # noqa: BLE001 — a label must never break a save
        logger.debug("remote pane addr stamp failed (%s/%s): %s", host_id[:8], session, e)
        return False

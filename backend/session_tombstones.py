"""일부러 죽인 세션의 무덤 — **되살리지 않기 위해서.**

⚠️ 원격 브리지는 세션이 사라진 것을 보면 `create=1` 로 다시 만든다. 그건 호스트가
재부팅됐을 때를 위한 복구 장치인데, **사용자가 직접 지운 경우에는 정반대로 동작한다** —
지워도 곧바로 되살아나고, 화면에서는 "지워지지 않는다" 로 보인다.

우리 쪽에서 죽인 것과 저절로 사라진 것은 겉으로 구별되지 않으므로, 죽인 쪽이 표를 남긴다.

수명이 짧은 이유: 이건 **재접속 한 번을 막는 장치**지 영구 차단이 아니다. 나중에 같은
이름으로 새 세션을 여는 것은 정상적인 일이고 막으면 안 된다.
"""
from __future__ import annotations

import time

# 재접속 사다리(4→8→16→30s)를 덮을 만큼. 그 뒤의 생성은 사용자가 새로 여는 것으로 본다.
TOMBSTONE_TTL_SEC = 90.0

_graves: dict[tuple[str, str], float] = {}


def _sweep(now: float) -> None:
    for key in [k for k, at in _graves.items() if now - at > TOMBSTONE_TTL_SEC]:
        _graves.pop(key, None)


def mark_killed(host_id: str, session: str) -> None:
    """이 세션은 **일부러** 죽였다."""
    if not host_id or not session:
        return
    now = time.time()
    _sweep(now)
    _graves[(host_id, session)] = now


def was_killed(host_id: str, session: str) -> bool:
    if not host_id or not session:
        return False
    now = time.time()
    _sweep(now)
    return (host_id, session) in _graves


def forget(host_id: str, session: str) -> None:
    """사용자가 그 자리를 다시 열었다 — 무덤을 치운다."""
    _graves.pop((host_id, session), None)


def clear() -> None:
    _graves.clear()

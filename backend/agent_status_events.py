"""에이전트 상태가 **바뀌었다**는 신호 하나. 로컬·원격이 같은 자리에 알린다.

이게 있는 이유: `terminal_wait` 가 폴링이었다. 로컬 2초·원격 5초마다 다시 물었고 원격은
그때마다 SSH 왕복이었다 — 이 저장소가 토큰을 크게 태운 그 패턴이다. 기다리는 쪽이
**변화가 있을 때만** 깨면 조용한 동안의 비용이 0이 된다.

⚠️ 신호는 "무엇이 바뀌었는지" 를 나르지 않는다. 깨어난 쪽이 그때 다시 판정한다 —
신호에 내용을 실으면 받는 쪽마다 판정이 생기고, 이 저장소는 그 이중화로 여러 번 데었다.

⚠️ `asyncio.Event` 를 모듈 전역으로 두지 않는다. 그건 **처음 쓰인 루프에 묶여서**, 다른
루프에서 기다리면 `bound to a different event loop` 로 죽는다(테스트가 그걸 잡았다).
대신 기다리는 쪽이 **자기 루프에서** future 를 만들어 등록한다.
"""
from __future__ import annotations

import asyncio

_waiters: set[asyncio.Future] = set()


def wake() -> None:
    """상태가 바뀌었다 — 기다리던 것들을 깨운다."""
    for waiter in list(_waiters):
        if not waiter.done():
            waiter.set_result(True)
    _waiters.clear()


async def wait_for_change(timeout: float) -> bool:
    """다음 변화까지 기다린다. 변화가 없으면 **아무 일도 하지 않는다**(폴링의 반대).

    상한에 닿으면 False — 호출자가 이어 기다릴지 정한다.
    """
    waiter = asyncio.get_running_loop().create_future()
    _waiters.add(waiter)
    try:
        await asyncio.wait_for(waiter, timeout=timeout)
        return True
    except TimeoutError:
        return False
    finally:
        _waiters.discard(waiter)


def waiter_count() -> int:
    """지금 기다리는 수 — 새는지 보려는 테스트용."""
    return len(_waiters)

"""붙어 있는 리모트들 — 호스트 하나당 하나.

백엔드가 "그 호스트에 뭘 시켜라" 를 할 때 여기서 통로를 찾는다. 리모트가 없으면
**없다고 말한다** — 조용히 성공한 척하면 그 위에 올라탄 흐름(핸드오프·대기·알림)이
전부 거짓이 된다. 이 저장소가 원격 status 에서 이미 밟은 그 규칙이다.

⚠️ **호스트당 하나다.** 같은 호스트에서 리모트가 두 번 뜨면(재부팅 뒤 옛 프로세스가
남았다든가) 상태가 두 벌 들어와 전이가 덧그려진다. 나중 것이 이기고 앞엣것은 닫는다 —
"둘 다 받아 합치기" 는 어느 쪽이 진짜인지 알 방법이 없다.
"""
from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)


class RemoteConnection:
    """리모트 하나의 통로. 전송은 주입받는다 — 테스트에서 WebSocket 없이 검증한다."""

    def __init__(self, host_id: str, username: str, send):
        self.host_id = host_id
        self.username = username
        self._send = send                 # async (dict) -> None
        self.facts: dict = {}             # 리모트가 보고한 호스트 사실(OS·CPU·메모리…)
        self.closed = False
        self._pending: dict[str, asyncio.Future] = {}
        self._next_id = 0
        # 낡은 리모트는 `run` 을 모른다 — 무시하므로 답이 없고, 그때마다 상한을 다 태운다.
        # 한 번 겪으면 표시해 두고 다음부터는 곧장 SSH 로 간다(상태 보고는 계속 받는다).
        self.run_unsupported = False

    def next_command_id(self) -> int:
        self._next_id += 1
        return self._next_id

    async def send(self, message: dict) -> bool:
        if self.closed:
            return False
        try:
            await self._send(message)
            return True
        except Exception as e:
            logger.debug("remote %s send failed: %s", self.host_id, e)
            self.closed = True
            return False

    async def request(self, message: dict, key: str, timeout: float) -> dict | None:
        """답을 기다리는 요청. 상한이 **반드시** 있다 — 끊긴 리모트를 영원히 기다리면
        그 호출자(알림·wait)가 통째로 멈춘다."""
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        self._pending[key] = future
        try:
            if not await self.send(message):
                return None
            return await asyncio.wait_for(future, timeout=timeout)
        except (TimeoutError, asyncio.CancelledError):
            return None
        finally:
            self._pending.pop(key, None)

    def resolve(self, key: str, value: dict) -> bool:
        future = self._pending.get(key)
        if future is None or future.done():
            return False
        future.set_result(value)
        return True

    def abandon(self) -> None:
        """통로가 닫혔다 — 기다리던 요청을 **깨운다**. 안 깨우면 상한이 다 찰 때까지
        붙잡혀 있고, 그동안 호출자는 리모트가 살아 있다고 믿는다."""
        self.closed = True
        for future in list(self._pending.values()):
            if not future.done():
                future.set_result(None)
        self._pending.clear()


_connections: dict[str, RemoteConnection] = {}


def attach(connection: RemoteConnection) -> RemoteConnection | None:
    """등록. 같은 호스트의 이전 연결이 있으면 그것을 돌려준다(호출자가 닫는다)."""
    previous = _connections.get(connection.host_id)
    _connections[connection.host_id] = connection
    if previous is not None and previous is not connection:
        previous.abandon()
    return previous


def detach(connection: RemoteConnection) -> None:
    """⚠️ 자기 자신일 때만 지운다. 새 연결이 이미 들어온 뒤 옛 연결의 정리 코드가
    돌면, 무조건 지우는 판은 **살아 있는 새 통로를 지운다**."""
    connection.abandon()
    if _connections.get(connection.host_id) is connection:
        _connections.pop(connection.host_id, None)


def get(host_id: str) -> RemoteConnection | None:
    conn = _connections.get(host_id)
    return None if conn is None or conn.closed else conn


def connected_host_ids() -> list[str]:
    return [h for h, c in _connections.items() if not c.closed]


def clear() -> None:
    for conn in list(_connections.values()):
        conn.abandon()
    _connections.clear()

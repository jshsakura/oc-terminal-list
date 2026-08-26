"""붙어 있는 리모트를 통해 tmux 명령을 돌리는 채널.

**`itl_remote.RemoteChannel` 과 같은 인터페이스다** — `run(cmd) -> stdout` 하나뿐이다.
그래서 배달(`send_text`)·키(`send_key`)·존재확인(`probe`)·화면(`capture`)이 **한 줄도
바뀌지 않고** 이 경로를 탄다. 그게 이 파일이 존재하는 이유다: 갈래를 여기 하나로 두면
호출부마다 "리모트가 있나" 를 묻지 않아도 된다.

SSH 대비 얻는 것:
  - 왕복이 없다. 이미 열려 있는 소켓에 한 줄 쓰는 것이다(SSH 는 핸드셰이크부터다).
  - NAT 뒤 호스트에도 배달된다. 우리가 걸 수 없어도 그쪽이 붙어 있으므로.
  - 키가 필요 없다. 배달에 그 호스트의 SSH 자격증명을 꺼내지 않는다.

⚠️ 리모트가 없으면 **이 채널을 만들지 않는다.** 없는 것을 있는 척하면 배달이 조용히
사라진다 — 호출부는 `open_channel` 이 주는 것을 그냥 쓰고, 없으면 SSH 로 간다.
"""
from __future__ import annotations

import logging

from remote_agent import registry

logger = logging.getLogger(__name__)

# 한 명령의 상한. tmux 는 로컬 호출이라 빨라야 정상이고, 늦으면 그 호스트가 아픈 것이다.
# ⚠️ 호출자 상한(itl 은 30s)보다 작아야 한다 — 넘으면 **배달됐는데 실패로 읽혀 재시도가
# 중복 전송**이 된다(이 저장소가 SSH 경로에서 이미 밟았다).
COMMAND_TIMEOUT_SEC = 12.0


class RemoteAgentChannel:
    """리모트 하나로 가는 명령 통로."""

    def __init__(self, connection):
        self._connection = connection

    @property
    def host_name(self) -> str:
        return str(self._connection.facts.get("hostname") or "")

    async def run(self, cmd: str, timeout: float = COMMAND_TIMEOUT_SEC) -> str:
        command_id = self._connection.next_command_id()
        reply = await self._connection.request(
            {"t": "run", "id": command_id, "cmd": cmd},
            key=f"run:{command_id}",
            timeout=timeout,
        )
        if reply is None:
            # 통로가 끊겼거나 상한을 넘었다. **빈 문자열을 주지 않는다** — 호출부는
            # 표식이 없으면 실패로 세므로 그게 곧 "확인되지 않은 전송" 이 된다.
            raise RemoteChannelError("리모트가 응답하지 않았습니다")
        if not reply.get("ok"):
            raise RemoteChannelError(reply.get("error") or "리모트가 명령을 거절했습니다")
        return reply.get("out") or ""

    async def close(self) -> None:
        """소켓은 리모트의 것이라 여기서 닫지 않는다 — 명령 하나가 통로를 끊으면 안 된다."""
        return None

    async def __aenter__(self) -> RemoteAgentChannel:
        return self

    async def __aexit__(self, *exc) -> None:
        return None


class RemoteChannelError(RuntimeError):
    """리모트 경로가 답을 주지 못했다. 호출부는 SSH 로 물러설 수 있다."""


def channel_for(host_id: str):
    """붙어 있으면 채널, 아니면 None."""
    connection = registry.get(host_id)
    return RemoteAgentChannel(connection) if connection is not None else None

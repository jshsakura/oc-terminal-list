"""붙어 있는 리모트를 통해 tmux 명령을 돌리는 채널.

**`itl_remote.RemoteChannel` 과 같은 인터페이스다** — `run(cmd) -> stdout` 하나뿐이다.
그래서 배달(`send_text`)·키(`send_key`)·존재확인(`probe`)·화면(`capture`)이 **한 줄도
바뀌지 않고** 이 경로를 탄다. 그게 이 파일이 존재하는 이유다: 갈래를 여기 하나로 두면
호출부마다 "리모트가 있나" 를 묻지 않아도 된다.

SSH 를 안 쓴다:
  - 왕복이 없다. 이미 열려 있는 소켓에 한 줄 쓰는 것이다(SSH 는 핸드셰이크부터다).
  - NAT 뒤 호스트에도 배달된다. 우리가 걸 수 없어도 그쪽이 붙어 있으므로.
  - 키가 필요 없다. 배달에 그 호스트의 SSH 자격증명을 꺼내지 않는다.
  - **꺼진 기계를 찔러보지 않는다.** 없는 호스트에 SSH 를 걸어 15초를 태우는 것이
    홈 화면을 멈춰 세우던 원인이었다.

⚠️ 리모트가 없으면 **이 채널을 만들지 않는다.** 없는 것을 있는 척하면 배달이 조용히
사라진다 — 화면이 "리모트 설치" 를 권하는 것이 답이다.
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
    """리모트 하나로 가는 명령 통로. **경로는 이것 하나다.**

    ⚠️ 한때 실패하면 SSH 로 물러섰다. 없앤 이유는 경로가 둘이면 실패 방식도 둘이기
    때문이다 — 어느 쪽으로 갔는지에 따라 지연도 오류도 달라져 진단이 매번 새로 시작된다.
    낡은 리모트는 **다시 설치해서** 고친다(화면이 `outdated` 로 알려 준다). 숨기지 않는다.
    """

    def __init__(self, connection):
        self._connection = connection

    @property
    def host_id(self) -> str:
        """이 통로가 어느 호스트로 가는가 — 호출부가 스트림을 대신 볼 수 있게."""
        return self._connection.host_id

    @property
    def host_name(self) -> str:
        return str(self._connection.facts.get("hostname") or "")

    async def run(self, cmd: str, timeout: float = COMMAND_TIMEOUT_SEC) -> str:
        if self._connection.run_unsupported:
            raise RemoteChannelError(
                "리모트가 낡아 이 명령을 모릅니다 — 호스트 설정에서 다시 설치하세요"
            )
        command_id = self._connection.next_command_id()
        reply = await self._connection.request(
            {"t": "run", "id": command_id, "cmd": cmd},
            key=f"run:{command_id}",
            timeout=timeout,
        )
        if reply is None:
            # 통로가 끊겼거나 상한을 넘었다. **빈 문자열을 주지 않는다** — 호출부는
            # 표식이 없으면 실패로 세므로 그게 곧 "확인되지 않은 전송" 이 된다.
            #
            # 답이 아예 없다는 것은 대개 **리모트가 낡아 `run` 을 모른다**는 뜻이다.
            # 표시해 두고 다음부터는 상한을 다시 태우지 않는다(상태 보고는 계속 온다).
            self._connection.run_unsupported = True
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
        await self.close()


class RemoteChannelError(RuntimeError):
    """리모트 경로가 답을 주지 못했다. 호출부는 SSH 로 물러설 수 있다."""


def channel_for(host_id: str):
    """붙어 있으면 채널, 아니면 None."""
    connection = registry.get(host_id)
    return RemoteAgentChannel(connection) if connection is not None else None

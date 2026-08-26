"""리모트 WebSocket — 호스트에 심어 둔 관찰자가 **자기가 걸어 들어온다**.

방향이 중요하다. 우리가 SSH 로 나가는 게 아니라 리모트가 우리 쪽으로 붙는다:
호스트에 인바운드 포트를 열 필요가 없고, NAT 뒤에서도 되고, 붙어 있는 동안은
**양방향이 공짜**다(상태·완료가 올라오고, 명령·읽기가 내려간다).

인증은 자격증명 하나다 — `remote_agent/credentials` 참고. 로컬망 전제라 출처 대역은
검사하지 않는다.

⚠️ 자격증명은 **핸드셰이크 헤더로** 받는다. 쿼리스트링에 실으면 접근로그·리버스프록시
로그에 장기 토큰이 그대로 남는다(WS 티켓이 짧은 수명인 것과 대비된다 — 이건 90일짜리다).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from _deps import get_auth_manager, verify_auth_token
from remote_agent import registry
from remote_agent.credentials import verify_credential
from sqlite_storage import storage

logger = logging.getLogger(__name__)

router = APIRouter()

# 리모트가 보내오는 낱말. 화이트리스트다 — 모르는 것은 조용히 버린다.
# (클라이언트가 준 값으로 라우팅하지 않는다는 이 저장소의 규칙과 같다.)
INBOUND_KINDS = {"hello", "server", "no-server", "panes", "excerpt", "facts", "pong"}


def _bearer(websocket: WebSocket) -> str | None:
    raw = websocket.headers.get("authorization") or ""
    prefix = "bearer "
    return raw[len(prefix):].strip() if raw.lower().startswith(prefix) else None


@router.websocket("/api/remote/ws")
async def remote_ws(websocket: WebSocket):
    manager = get_auth_manager()
    identity = await verify_credential(manager, _bearer(websocket)) if manager else None
    if not identity:
        # 붙기 전에 거절한다 — accept 한 뒤 닫으면 리모트는 "붙었다" 를 한 번 보고
        # 백오프를 리셋한다(이 저장소가 두 번 밟은 그 함정).
        await websocket.close(code=1008)
        return
    username, host_id, epoch = identity

    # ⚠️ `get_host` 는 (host_id, username) 둘을 받는다 — 소유권 검사가 질의 안에 있다.
    # 하나만 넘기면 TypeError 다(목이 한 개짜리면 테스트는 통과하고 배포에서 터진다).
    host = await storage.get_host(host_id, username)
    if not host:
        # 호스트가 지워졌거나 남의 것이다. 자격증명이 살아 있어도 통로는 안 연다.
        await websocket.close(code=1008)
        return

    # 세대 대조 — 폐기된 자격증명은 서명이 멀쩡해도 여기서 막힌다.
    current = host.get("cred_epoch")
    if current is None or int(current) != epoch:
        logger.info("remote refused: revoked credential host=%s (epoch %s != %s)",
                    host_id, epoch, current)
        await websocket.close(code=1008)
        return

    await websocket.accept()

    async def send(message: dict) -> None:
        await websocket.send_json(message)

    connection = registry.RemoteConnection(host_id, username, send)
    previous = registry.attach(connection)
    if previous is not None:
        logger.info("remote replaced an earlier connection: host=%s", host_id)
    logger.info("remote attach: host=%s name=%s", host_id, host.get("name"))

    try:
        while True:
            message = await websocket.receive_json()
            kind = message.get("t")
            if kind not in INBOUND_KINDS:
                continue
            await _handle(connection, kind, message)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.info("remote stream ended: host=%s (%s)", host_id, e)
    finally:
        registry.detach(connection)
        logger.info("remote detach: host=%s", host_id)


async def _handle(connection, kind: str, message: dict) -> None:
    if kind == "facts":
        # 호스트가 자기를 소개한다 — OS·CPU·메모리·GPU. 주소를 자연어로 고를 수 있게
        # 하는 재료이고, 여기 없으면 "GPU 있는 데서 돌려" 는 영영 풀리지 않는다.
        connection.facts = message.get("facts") or {}
        return
    if kind == "excerpt":
        session = message.get("session")
        if session:
            connection.resolve(f"excerpt:{session}", message)
        return
    # 나머지(panes/server/no-server)는 상태 파이프라인이 가져간다. 다음 배선 단계.
    from remote_agent import ingest

    await ingest.handle_event(connection.host_id, kind, message)


@router.get("/api/remote/connected")
async def list_connected_remotes(username: str = Depends(verify_auth_token)):
    """지금 붙어 있는 리모트들 — **SSH 없이** 우리 쪽 사실만.

    화면의 호스트 목록이 호스트마다 상태를 물으면 그 자체로 SSH 가 행 수만큼 곱해진다
    (이 저장소가 `/api/git/status` 에서 이미 밟은 함정). 아이콘이 필요한 것은 "붙어
    있나" 하나뿐이고, 그건 우리가 이미 안다. 설치 여부·버전처럼 원격을 실제로 봐야
    아는 것은 사용자가 패널을 열 때만 묻는다.
    """
    hosts = {}
    for host_id in registry.connected_host_ids():
        connection = registry.get(host_id)
        if connection is None or connection.username != username:
            continue
        hosts[host_id] = {"facts": connection.facts}
    return {"connected": hosts}

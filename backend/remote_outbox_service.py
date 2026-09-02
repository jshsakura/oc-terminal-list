"""원격 우편함 드레이너 싱글턴 — 수집기와 앱 전역을 잇는 배선만.

`agent_status_service` 와 같은 모양이다: 수집기(`remote_outbox`)는 순수하게 두고,
"누구의 탭 상태를 볼 것인가" 와 "보는 사람이 있는가" 만 여기서 주입한다.

⚠️ 사용자는 `storage.get_admin()` 으로 찾는다. 이 앱은 관리자 한 명을 전제로 하고
(다른 배경 작업들도 같은 규칙이다), 주기 작업에는 요청 컨텍스트가 없다.
"""
from __future__ import annotations

import logging

from remote_outbox import RemoteOutboxDrainer
from sse_broadcast import _tab_state_sse_queues

logger = logging.getLogger(__name__)


async def _admin_username() -> str | None:
    from sqlite_storage import storage
    try:
        admin = await storage.get_admin()
    except Exception as e:                                   # noqa: BLE001
        logger.debug("원격 우편함: 관리자를 못 읽었다: %s", e)
        return None
    return (admin or {}).get("username") or None


remote_outbox_drainer = RemoteOutboxDrainer(
    username_of=_admin_username,
    # 앱을 보고 있으면 조인다. 안 보고 있어도 멈추지는 않는다 — 에이전트끼리의 회신은
    # 사람이 화면을 안 볼 때도 오가야 한다.
    has_listeners=lambda: any(_tab_state_sse_queues.values()),
)

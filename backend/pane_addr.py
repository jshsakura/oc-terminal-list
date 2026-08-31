"""pane 주소(`탭.pane`) — 번호 매기기 + tmux 상태바에 새기기.

**왜 필요한가:** 이 앱의 tmux 세션명은 UUID 라 순정 `status-left` 가 `[9bf9790d-` 로
잘려 아무 정보가 아니다. 같은 자리에 `[1.2]` 를 넣으면 "옆에 2번한테 이거 시켜" 라고
말할 수 있다 — 자기 주소를 자기가 볼 방법이 그것 말고는 없다.

⚠️ **번호는 밀린다.** pane 을 닫으면 뒤가 당겨진다. 그래서 번호가 바뀔 수 있는 **모든**
순간(`PUT /api/tab-state`)마다 다시 새기고, 바뀐 것만 tmux 를 부른다(탭 상태 저장은 잦다).

⚠️ **원격 pane 은 새기지 않는다** — 그쪽 tmux 는 그 호스트에 있다. 조건부 포맷의 else 로
떨어져 순정대로 세션 이름이 나오고, 원격 세션명(`mobile-abc`)은 그 자체로 읽을 만하다.
"""
from __future__ import annotations

import logging

from pane_targets import build_targets
from tmux_manager import tmux_manager

logger = logging.getLogger(__name__)

# tmux 사용자 옵션 이름. `status-left` 의 조건부 포맷이 이것을 읽는다 — 이름을 바꾸면
# tmux_manager · main.py lifespan · host_manager 의 포맷 문자열도 같이 바꿔야 한다.
ADDR_OPTION = "@pane_addr"
ADDR_FORMAT = f"#{{?{ADDR_OPTION},[#{{{ADDR_OPTION}}}] ,[#{{session_name}}] }}"

# sessionId → 마지막으로 새긴 주소. 탭 상태 저장마다 세션 수만큼 tmux 를 부르지 않기 위한 것.
_stamped: dict[str, str] = {}


def local_addresses(tabs: list) -> dict[str, str]:
    """저장된 탭 상태 → `{sessionId: "탭.pane"}`. 로컬 pane 만.

    ⚠️ 번호를 **여기서 다시 세지 않는다** — `pane_targets.build_targets` 하나가 센다.
    두 곳이 각자 세면 반드시 어긋난다(실제로 빈 picker pane 이 번호를 먹느냐에서 갈렸다).
    """
    return {
        t["sessionId"]: t["addr"]
        for t in build_targets(tabs)
        if t.get("kind") == "local" and t.get("sessionId")
    }


async def stamp_local_addresses(tabs: list) -> None:
    """바뀐 주소만 tmux 에 새긴다. 실패는 삼킨다 — 상태바 장식이 저장을 막으면 안 된다."""
    try:
        desired = local_addresses(tabs or [])
    except Exception:                       # 탭 상태가 깨졌어도 저장 흐름은 계속돼야 한다
        logger.debug("pane addr stamp: 주소 계산 실패", exc_info=True)
        return

    for session_id, addr in desired.items():
        if _stamped.get(session_id) == addr:
            continue
        rc, _, _ = await tmux_manager._run(
            "set-option", "-t", session_id, ADDR_OPTION, addr, check=False,
        )
        # rc != 0 이면 그 세션이 이미 없는 것 — 캐시에 넣지 않아 다음에 다시 시도한다.
        if rc == 0:
            _stamped[session_id] = addr

    for gone in [s for s in _stamped if s not in desired]:
        _stamped.pop(gone, None)


def forget(session_id: str) -> None:
    """세션이 죽었을 때 캐시에서 지운다(같은 id 가 재사용되는 경우의 stale 방지)."""
    _stamped.pop(session_id, None)

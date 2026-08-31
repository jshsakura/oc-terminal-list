"""pane 의 **자기 주소**를 그 pane 의 tmux 세션에 새긴다 — 하단 상태바가 그걸 그린다.

왜 필요한가: `itl` 로 옆 터미널을 부리려면 주소(`1.2`)를 알아야 하는데, **자기 주소를
자기가 볼 방법이 없었다.** MCP 를 쓰는 에이전트는 `terminal_whoami` 로 물어볼 수 있지만,
화면을 보는 사람과 셸은 알 길이 없다. "야 옆에 2번한테 이거 시켜" 가 안 되는 이유가 그것이다.

주소는 앱 쪽 개념(탭 순번 . pane 순번)이라 tmux 는 모른다. 그래서 백엔드가 탭 상태가
바뀔 때마다 각 세션에 tmux **사용자 옵션** `@itl_addr` 로 새겨 준다. 상태바는
`#{?@itl_addr,[#{@itl_addr}] ,}` 로 읽으므로, 안 새겨진 세션은 조용히 빈칸이다.

⚠️ **번호는 밀린다.** pane 을 닫으면 뒤 번호가 당겨지므로 새긴 값은 그때 낡는다. 그래서
탭 상태가 저장될 때마다(= 번호가 바뀔 수 있는 **모든** 순간) 다시 새긴다. 이 저장은
프론트가 변경 시마다 debounce 해서 부르고, 내용이 같으면 서버가 아예 저장하지 않는다
(user_state 의 no-op 차단) — 그래서 여기 호출도 실제 변화가 있을 때만 온다.

⚠️ **로컬 pane 만 새긴다.** 원격 pane 의 tmux 는 그 호스트에 있고 우리 tmux_manager 로는
닿지 않는다. 그쪽 상태바는 주소 없이 창 목록만 나온다 — 틀린 주소를 보여주느니 비운다.
"""
from __future__ import annotations

import logging

from itl_targets import build_targets
from tmux_manager import tmux_manager

logger = logging.getLogger(__name__)

# sessionId → 마지막으로 새긴 주소. 탭 상태 저장마다 세션 수만큼 tmux 를 부르지 않기 위한 것.
_stamped: dict[str, str] = {}


def _local_addresses(tabs: list) -> dict[str, str]:
    return {
        t["sessionId"]: t["addr"]
        for t in build_targets(tabs)
        if t.get("kind") == "local" and t.get("sessionId")
    }


async def stamp_local_addresses(tabs: list) -> None:
    """바뀐 주소만 tmux 에 새긴다. 실패는 삼킨다 — 상태바 장식이 저장을 막으면 안 된다."""
    try:
        desired = _local_addresses(tabs or [])
    except Exception:                       # 탭 상태가 깨졌어도 저장 흐름은 계속돼야 한다
        logger.debug("itl addr stamp: build_targets 실패", exc_info=True)
        return

    for session_id, addr in desired.items():
        if _stamped.get(session_id) == addr:
            continue
        rc, _, _ = await tmux_manager._run(
            "set-option", "-t", session_id, "@itl_addr", addr, check=False,
        )
        # rc != 0 이면 그 세션이 이미 없는 것 — 캐시에 넣지 않아 다음에 다시 시도한다.
        if rc == 0:
            _stamped[session_id] = addr

    for gone in [s for s in _stamped if s not in desired]:
        _stamped.pop(gone, None)


def forget(session_id: str) -> None:
    """세션이 죽었을 때 캐시에서 지운다(같은 id 가 재사용되는 경우의 stale 방지)."""
    _stamped.pop(session_id, None)

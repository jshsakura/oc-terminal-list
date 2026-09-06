"""pane 주소(`탭.pane`) — 번호 매기기 + tmux 상태바에 새기기.

**왜 필요한가:** 이 앱의 tmux 세션명은 UUID 라 순정 `status-left` 가 `[9bf9790d-` 로
잘려 아무 정보가 아니다. 같은 자리에 `[1.2]` 를 넣으면 "옆에 2번한테 이거 시켜" 라고
말할 수 있다 — 자기 주소를 자기가 볼 방법이 그것 말고는 없다.

⚠️ **번호는 밀린다.** pane 을 닫으면 뒤가 당겨진다. 그래서 번호가 바뀔 수 있는 **모든**
순간(`PUT /api/tab-state`)마다 다시 새기고, 바뀐 것만 tmux 를 부른다(탭 상태 저장은 잦다).

원격 pane 도 새긴다. 그쪽 tmux 는 그 호스트에 있지만, **붙어 있는 동안에는** 그 브리지가
바로 그 기계로 가는 인증된 SSH 연결을 쥐고 있다 — 거기서 명령 하나를 더 돌리는 것은 새
핸드셰이크가 아니라 채널 하나다(`remote_panes`). 두 시점에 새긴다:

  1. **붙을 때** — 부트스트랩 명령 문자열에 얹어 나간다. 왕복이 늘지 않는다.
  2. **번호가 바뀔 때** — 살아 있는 브리지에게 시킨다. 1번만으로는 pane 을 닫는 순간
     낡고, 반대로 2번만으로는 **갓 만든 pane** 이 빈 주소로 남는다(탭 상태 저장이 WS
     attach 보다 늦게 온다). 둘이 한 쌍이다.

⚠️ **원격 맨 셸(`none`) pane 은 대상이 아니다.** 새길 tmux 옵션이 없다. 그 세션에 건
stamp 는 그냥 실패한다.
"""
from __future__ import annotations

import logging

import remote_panes
from pane_targets import build_targets
from tmux_manager import tmux_manager

logger = logging.getLogger(__name__)

# tmux 사용자 옵션 이름. `status-left` 의 조건부 포맷이 이것을 읽는다 — 이름을 바꾸면
# tmux_manager · main.py lifespan · host_manager 의 포맷 문자열도 같이 바꿔야 한다.
ADDR_OPTION = "@pane_addr"
ADDR_FORMAT = f"#{{?{ADDR_OPTION},[#{{{ADDR_OPTION}}}] ,[#{{session_name}}] }}"

# sessionId → 마지막으로 새긴 주소. 탭 상태 저장마다 세션 수만큼 tmux 를 부르지 않기 위한 것.
_stamped: dict[str, str] = {}
# (hostId, 원격 세션명) → 같은 것. 여기 한 번이 SSH 채널 하나라 dedup 이 더 중요하다.
_stamped_remote: dict[tuple[str, str], str] = {}


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


def remote_addresses(tabs: list) -> dict[tuple[str, str], str]:
    """저장된 탭 상태 → `{(hostId, 원격 세션명): "탭.pane"}`. 원격 pane 만.

    로컬과 **같은 `build_targets`** 를 지난다 — 번호를 세는 곳이 둘이 되면 화면의 `[1.2]`
    와 원격 pane 이 아는 `[1.2]` 가 어긋난다.
    """
    return {
        (t["hostId"], t["tmuxSession"]): t["addr"]
        for t in build_targets(tabs)
        if t.get("kind") == "host" and t.get("hostId") and t.get("tmuxSession")
    }


def address_of(tabs: list, host_id: str, session: str) -> str:
    """이 원격 세션의 지금 주소. 모르면 빈 문자열 — **모른다고 적는다.**

    갓 만든 pane 은 탭 상태에 아직 없어 여기서 빈 값이 나온다(클라이언트가 WS 를 먼저
    연다). 그 pane 은 곧 오는 탭 상태 저장이 채운다.
    """
    return remote_addresses(tabs).get((str(host_id or ""), str(session or "")), "")


async def stamp_addresses(tabs: list) -> None:
    """로컬·원격 주소를 한 번에 새긴다 — **탭 상태가 바뀌는 모든 자리의 단일 진입점.**

    둘로 나눠 두면 호출부가 한쪽만 부르게 되고, 그러면 원격 pane 만 낡은 번호를 들고
    있는 상태가 조용히 생긴다.
    """
    await stamp_local_addresses(tabs)
    await stamp_remote_addresses(tabs)


async def stamp_remote_addresses(tabs: list) -> None:
    """바뀐 원격 주소만, 그것도 **지금 붙어 있는** pane 에만 새긴다."""
    try:
        desired = remote_addresses(tabs or [])
    except Exception:
        logger.debug("pane addr stamp: 원격 주소 계산 실패", exc_info=True)
        return

    for (host_id, session), addr in desired.items():
        if _stamped_remote.get((host_id, session)) == addr:
            continue
        # 실패는 캐시하지 않는다 — 안 붙어 있었거나 tmux 가 아니었다는 뜻이고, 다음 기회에
        # 다시 시도해야 한다(성공만 캐시하는 규칙은 로컬 쪽과 같다).
        if await remote_panes.stamp(host_id, session, addr):
            _stamped_remote[(host_id, session)] = addr

    for gone in [k for k in _stamped_remote if k not in desired]:
        _stamped_remote.pop(gone, None)


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


def note_attached(host_id: str, session: str, addr: str) -> None:
    """붙는 명령이 이미 새기고 갔다는 사실을 캐시에 적는다(또는 못 새겼으면 지운다).

    이게 없으면 두 가지가 어긋난다: 새 세션은 옵션을 안 들고 뜨는데 캐시가 "새김" 으로
    남아 영영 빈 주소가 되고, 반대로 방금 새긴 것을 모르면 다음 탭 상태 저장이 똑같은
    값을 SSH 채널 하나 써서 다시 쓴다.
    """
    key = (str(host_id or ""), str(session or ""))
    if addr:
        _stamped_remote[key] = addr
    else:
        _stamped_remote.pop(key, None)


async def remote_addresses_for_host(username: str, host_id: str) -> dict[str, str]:
    """이 사용자의 저장된 탭 상태에서 그 호스트의 `{원격 세션명: 주소}` 전부.

    원격 우편함 훑기가 같은 왕복에 주소를 다시 새기는 데 쓴다 — 붙어 있지 않은 팬과
    Tailscale 팬은 브리지 stamp 가 닿지 않아 번호가 밀리면 낡은 채 남았다.
    """
    from sqlite_storage import storage
    state = await storage.get_tab_state(username) or {}
    want = str(host_id or "")
    return {
        session: addr
        for (hid, session), addr in remote_addresses(state.get("tabs") or []).items()
        if hid == want
    }


async def remote_address_for(username: str, host_id: str, session: str) -> str:
    """이 사용자의 저장된 탭 상태에서 그 원격 세션의 주소를 찾는다. 모르면 빈 문자열."""
    from sqlite_storage import storage
    state = await storage.get_tab_state(username) or {}
    return address_of(state.get("tabs") or [], host_id, session)


def forget_remote(host_id: str, session: str) -> None:
    """원격 세션이 사라졌을 때. 새 세션은 옵션을 안 들고 뜨므로 캐시가 남으면 영영 빈 주소다."""
    _stamped_remote.pop((str(host_id or ""), str(session or "")), None)

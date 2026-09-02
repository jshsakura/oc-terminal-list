"""원격 pane 의 앱 주소 — 붙을 때 새기고, 번호가 밀리면 살아 있는 연결로 다시 쓴다.

이 경로의 사고는 조용하다: 주소가 안 새겨져도 아무것도 실패하지 않고, 그저 그 pane 안의
에이전트가 "나는 몇 번인가" 에 답하지 못할 뿐이다. 그래서 여기서 잠근다.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pane_addr
import remote_panes
from host_manager import _build_remote_command
from multiplexer import HERDR, TMUX

TABS = [
    {"panes": [{"sessionId": "local-a"}, {"hostId": "h1", "tmuxSessionName": "mobile-x"}]},
    {"panes": [{"hostId": "h2", "tmuxSessionName": "mobile-y"}]},
]


class FakeBridge:
    def __init__(self, ok: bool = True):
        self.ok = ok
        self.stamped: list[str] = []

    async def stamp_pane_addr(self, addr: str) -> bool:
        self.stamped.append(addr)
        return self.ok


class TestAddressComputation:
    def test_원격_주소는_로컬과_같은_번호를_쓴다(self):
        """번호를 세는 곳이 둘이 되면 화면의 `[1.2]` 와 pane 이 아는 값이 어긋난다."""
        assert pane_addr.remote_addresses(TABS) == {
            ("h1", "mobile-x"): "1.2",
            ("h2", "mobile-y"): "2.1",
        }
        assert pane_addr.local_addresses(TABS) == {"local-a": "1.1"}

    def test_모르는_세션은_빈_문자열(self):
        assert pane_addr.address_of(TABS, "h1", "mobile-x") == "1.2"
        assert pane_addr.address_of(TABS, "h9", "nope") == ""


class TestRegistry:
    def setup_method(self):
        remote_panes._live.clear()
        pane_addr._stamped_remote.clear()

    async def test_붙어_있는_pane_에만_새긴다(self):
        bridge = FakeBridge()
        remote_panes.register("h1", "mobile-x", bridge)
        await pane_addr.stamp_remote_addresses(TABS)
        assert bridge.stamped == ["1.2"]          # h2 는 안 붙어 있어 아무 일도 없다

    async def test_안_바뀌었으면_다시_안_쓴다(self):
        """한 번이 SSH 채널 하나다. 탭 상태 저장은 잦다."""
        bridge = FakeBridge()
        remote_panes.register("h1", "mobile-x", bridge)
        await pane_addr.stamp_remote_addresses(TABS)
        await pane_addr.stamp_remote_addresses(TABS)
        assert bridge.stamped == ["1.2"]

    async def test_번호가_밀리면_다시_쓴다(self):
        bridge = FakeBridge()
        remote_panes.register("h1", "mobile-x", bridge)
        await pane_addr.stamp_remote_addresses(TABS)
        shifted = [{"panes": [{"hostId": "h1", "tmuxSessionName": "mobile-x"}]}]
        await pane_addr.stamp_remote_addresses(shifted)
        assert bridge.stamped == ["1.2", "1.1"]

    async def test_실패는_캐시하지_않는다(self):
        """herdr 세션이거나 잠깐 못 닿은 것 — 다음 기회에 다시 해야 한다."""
        bridge = FakeBridge(ok=False)
        remote_panes.register("h1", "mobile-x", bridge)
        await pane_addr.stamp_remote_addresses(TABS)
        await pane_addr.stamp_remote_addresses(TABS)
        assert bridge.stamped == ["1.2", "1.2"]

    async def test_던지는_브리지가_저장을_막지_않는다(self):
        class Boom:
            async def stamp_pane_addr(self, addr):
                raise RuntimeError("boom")

        remote_panes.register("h1", "mobile-x", Boom())
        await pane_addr.stamp_remote_addresses(TABS)          # 안 던진다

    def test_재접속_경합_해제는_신원을_확인한다(self):
        """새 브리지가 먼저 등록되고 옛 브리지가 나중에 정리된다 — 여기서 blind pop 하면
        살아 있는 항목이 지워지고 그 pane 은 다음 attach 까지 주소를 못 받는다."""
        old, new = FakeBridge(), FakeBridge()
        remote_panes.register("h1", "mobile-x", old)
        remote_panes.register("h1", "mobile-x", new)
        remote_panes.unregister("h1", "mobile-x", old)
        assert remote_panes._live[("h1", "mobile-x")] is new
        remote_panes.unregister("h1", "mobile-x", new)
        assert ("h1", "mobile-x") not in remote_panes._live

    def test_사라진_pane_은_캐시에서_빠진다(self):
        pane_addr._stamped_remote[("h9", "gone")] = "9.9"
        remote_panes.register("h1", "mobile-x", FakeBridge())

    async def test_붙는_순간_캐시를_맞춘다(self):
        """새 세션은 옵션을 안 들고 뜬다 — "이미 새겼다" 가 남아 있으면 영영 빈 주소다."""
        pane_addr.note_attached("h1", "mobile-x", "1.2")
        bridge = FakeBridge()
        remote_panes.register("h1", "mobile-x", bridge)
        await pane_addr.stamp_remote_addresses(TABS)
        assert bridge.stamped == []               # 붙는 명령이 이미 새기고 갔다

        pane_addr.note_attached("h1", "mobile-x", "")     # 주소를 몰랐던 attach
        await pane_addr.stamp_remote_addresses(TABS)
        assert bridge.stamped == ["1.2"]


class TestBootstrapStamp:
    def test_붙는_명령이_주소를_새긴다(self):
        cmd = _build_remote_command(TMUX, "mobile", itl_pane_addr="1.2")
        assert "set-option -t mobile @pane_addr 1.2" in cmd

    def test_주소를_모르면_옵션도_없다(self):
        # `status-left` 포맷에도 `@pane_addr` 가 나오므로 set-option 쪽만 본다.
        assert "set-option -t mobile @pane_addr" not in _build_remote_command(TMUX, "mobile")

    def test_주소는_셸_인용을_지난다(self):
        assert "@pane_addr '1.2; rm -rf /'" in _build_remote_command(
            TMUX, "mobile", itl_pane_addr="1.2; rm -rf /")

    def test_herdr_갈래는_대상이_아니다(self):
        """herdr 에는 tmux 사용자 옵션이 없다 — 미지원이 결론이지 빠뜨린 것이 아니다."""
        cmd = _build_remote_command(HERDR, "mobile", itl_pane_addr="1.2")
        assert "exec herdr --session mobile" in cmd


class TestRouteHint:
    async def test_라우트는_저장된_탭_상태에서_주소를_찾는다(self):
        with patch("sqlite_storage.storage.get_tab_state",
                   AsyncMock(return_value={"tabs": TABS})):
            got = await pane_addr.remote_address_for("u", "h1", "mobile-x")
        assert got == "1.2"

"""pane 이 **자기 주소**를 하단 상태바로 볼 수 있어야 한다.

"옆에 2번한테 이거 시켜" 라고 말하려면 주소(`1.2`)가 필요한데, 이 앱의 tmux 세션명은
UUID 라 순정 상태바는 `[9bf9790d-` 로 잘려 아무 정보가 아니다. 그래서 백엔드가 탭 상태가
바뀔 때마다 각 세션에 tmux 사용자 옵션 `@pane_addr` 로 새긴다.
"""
import pytest

import pane_addr


class _FakeTmux:
    """`tmux_manager._run` 대역 — 호출된 인자만 기록한다."""

    def __init__(self, fail_for: set[str] | None = None):
        self.calls: list[tuple[str, ...]] = []
        self.fail_for = fail_for or set()

    async def _run(self, *args: str, check: bool = True):
        self.calls.append(args)
        # `set-option -t <sid> @pane_addr <addr>`
        sid = args[2] if len(args) > 2 else ""
        return (1 if sid in self.fail_for else 0), "", ""

    @property
    def stamps(self) -> dict[str, str]:
        return {c[2]: c[4] for c in self.calls if c[0] == "set-option"}


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    pane_addr._stamped.clear()
    yield
    pane_addr._stamped.clear()


def _tabs():
    return [
        {"name": "one", "panes": [
            {"id": "p1", "sessionId": "s-a"},
            {"id": "p2", "sessionId": "s-b"},
        ]},
        {"name": "two", "panes": [{"id": "p3", "sessionId": "s-c"}]},
    ]


def test_module_holds_the_tmux_singleton_not_the_module():
    """⚠️ `import tmux_manager` 는 **모듈**이고 `_run` 이 없다 — 싱글턴을 가져와야 한다.

    이 테스트가 없으면 나머지 전부가 대역을 꽂고 통과하는 동안 실제 경로만 조용히 죽는다
    (실제로 한 번 그렇게 썼다).
    """
    assert callable(getattr(pane_addr.tmux_manager, "_run", None))


@pytest.mark.anyio
async def test_each_local_session_gets_its_own_address(monkeypatch):
    fake = _FakeTmux()
    monkeypatch.setattr(pane_addr, "tmux_manager", fake)
    await pane_addr.stamp_local_addresses(_tabs())
    # 주소는 1부터, 탭.pane — 화면의 PaneAddressLabel 과 같은 규칙이어야 한다.
    assert fake.stamps == {"s-a": "1.1", "s-b": "1.2", "s-c": "2.1"}


@pytest.mark.anyio
async def test_unchanged_addresses_do_not_call_tmux_again(monkeypatch):
    """탭 상태는 자주 저장된다 — 매번 세션 수만큼 tmux 를 띄우면 안 된다."""
    fake = _FakeTmux()
    monkeypatch.setattr(pane_addr, "tmux_manager", fake)
    await pane_addr.stamp_local_addresses(_tabs())
    n = len(fake.calls)
    await pane_addr.stamp_local_addresses(_tabs())
    assert len(fake.calls) == n


@pytest.mark.anyio
async def test_numbers_shift_when_a_pane_closes(monkeypatch):
    """⚠️ 이게 이 모듈이 존재하는 이유다 — 앞 pane 이 닫히면 뒤 번호가 당겨진다.
    한 번 새기고 마는 구조였다면 상태바가 **틀린 주소**를 계속 보여준다."""
    fake = _FakeTmux()
    monkeypatch.setattr(pane_addr, "tmux_manager", fake)
    await pane_addr.stamp_local_addresses(_tabs())

    closed_first_pane = [
        {"name": "one", "panes": [{"id": "p2", "sessionId": "s-b"}]},
        {"name": "two", "panes": [{"id": "p3", "sessionId": "s-c"}]},
    ]
    await pane_addr.stamp_local_addresses(closed_first_pane)
    assert fake.stamps["s-b"] == "1.1"          # 1.2 → 1.1 로 당겨졌다


@pytest.mark.anyio
async def test_remote_panes_are_not_stamped(monkeypatch):
    """원격 tmux 는 그 호스트에 있다 — 우리 tmux_manager 로는 닿지 않는다.
    틀린 주소를 새기느니 비운다(상태바 포맷이 조건부라 조용히 빈칸이 된다)."""
    fake = _FakeTmux()
    monkeypatch.setattr(pane_addr, "tmux_manager", fake)
    await pane_addr.stamp_local_addresses([
        {"name": "r", "panes": [{"id": "p1", "hostId": "h1", "tmuxSessionName": "mobile"}]},
    ])
    assert fake.stamps == {}


@pytest.mark.anyio
async def test_a_failed_stamp_is_retried_next_time(monkeypatch):
    """세션이 막 죽었을 수 있다. 실패를 캐시하면 되살아나도 영영 안 새긴다."""
    fake = _FakeTmux(fail_for={"s-a"})
    monkeypatch.setattr(pane_addr, "tmux_manager", fake)
    await pane_addr.stamp_local_addresses(_tabs())
    before = len([c for c in fake.calls if c[2] == "s-a"])
    await pane_addr.stamp_local_addresses(_tabs())
    assert len([c for c in fake.calls if c[2] == "s-a"]) == before + 1


@pytest.mark.anyio
async def test_broken_tab_state_does_not_break_saving(monkeypatch):
    """상태바 장식이 탭 상태 저장을 막으면 안 된다."""
    fake = _FakeTmux()
    monkeypatch.setattr(pane_addr, "tmux_manager", fake)
    await pane_addr.stamp_local_addresses(["쓰레기", None, 42])   # 예외 없이 통과

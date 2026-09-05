"""로컬 pane 의 시작 경로 — **무엇이 붙잡든 고른 폴더에서 뜬다.**

한동안 cwd 해소가 tmux 분기 **안에** 있었다. 그래서 none 을 고른 사용자는 폴더를
골라도 매번 `$HOME` 에 붙었다. 아무 에러도 안 났고 로그에도 안 남았다 — 고른 것이
아무 데도 가 닿지 않는, 조용한 실패였다.

여기서 잠그는 것은 하나다: **bridge 가 받는 cwd.** none 은 이 파일의 bridge 가
프로세스를 직접 띄우므로 그 인자가 곧 셸이 서는 자리다. tmux 는 세션을 만들 때 `-c` 로
받으므로 bridge 쪽은 보지 않는다(원격은 host_manager._build_remote_command 가 담당).
"""
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import multiplexer as mux
import routes.terminal_ws as terminal_ws
from _deps import WORKSPACE_ROOT


@pytest.fixture
def workspace_dir(tmp_path, monkeypatch):
    """워크스페이스 루트를 tmp 로 옮기고 그 안에 고를 폴더 하나를 판다.

    `validate_path` 는 import 시점의 상수가 아니라 호출 시점의 모듈 전역을 읽으므로
    monkeypatch 로 갈아끼우면 그대로 먹는다.
    """
    picked = tmp_path / "picked-folder"
    picked.mkdir()
    monkeypatch.setattr("_deps.WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setattr("session_launch.WORKSPACE_ROOT", str(tmp_path))
    return tmp_path, picked


class _FakeWS:
    """WebSocket 최소 흉내 — accept/close 여부와 close 사유만 본다."""

    def __init__(self):
        self.accepted = False
        self.closed_with: tuple[int, str] | None = None
        self.sent_text: list[str] = []
        self.client_state = MagicMock(name="CONNECTED")

    async def accept(self):
        self.accepted = True

    async def close(self, code=1000, reason=""):
        self.closed_with = (code, reason)

    async def send_text(self, text):
        self.sent_text.append(text)


async def _connect(choice: str, *, cwd: str | None, create: bool = True, holder=None,
                   multiplexer: str | None = None):
    """WS 라우트를 한 번 태우고, bridge 가 받은 생성 인자를 돌려준다.

    실제 PTY 는 띄우지 않는다 — `run()` 이 바로 끝나는 가짜 bridge 를 꽂는다.
    """
    ws = _FakeWS()
    bridge_kwargs: dict = {}

    def _fake_bridge(**kwargs):
        bridge_kwargs.update(kwargs)
        bridge = MagicMock()
        bridge.run = AsyncMock(return_value=None)
        return bridge

    storage = MagicMock()
    storage.get_session_owner = AsyncMock(return_value=None)
    storage.create_session = AsyncMock(return_value=None)
    storage.update_session_activity = AsyncMock(return_value=None)
    storage.record_usage_start = AsyncMock(return_value=None)
    storage.record_usage_end = AsyncMock(return_value=None)

    with (
        patch.object(terminal_ws, "authenticate_ws", AsyncMock(return_value="tester")),
        patch.object(terminal_ws, "storage", storage),
        patch.object(terminal_ws, "TmuxClientBridge", _fake_bridge),
        patch.object(terminal_ws, "invalidate_session", AsyncMock(return_value=None)),
        patch.object(terminal_ws, "_register_ws_client", MagicMock(return_value="tok")),
        patch.object(terminal_ws, "_unregister_ws_client", MagicMock(return_value=None)),
        patch.object(terminal_ws, "_push_ws_tickets", AsyncMock(return_value=None)),
        patch.object(terminal_ws.local_mux, "choice_for", AsyncMock(return_value=choice)),
        # 이미 붙잡고 있는 쪽이 있으면 그것이 이긴다(설정은 새 세션에만 관여한다).
        # 목하지 않으면 진짜 tmux 소켓에 물으러 나간다.
        patch.object(terminal_ws.local_mux, "holder_of", AsyncMock(return_value=holder)),
        patch.object(terminal_ws.local_mux, "attach_argv", MagicMock(return_value=["/bin/sh", "-l"])),
        patch.object(terminal_ws.local_mux, "is_missing", MagicMock(return_value=False)),
    ):
        await terminal_ws.terminal_websocket(
            websocket=ws,
            session_id="sess-1",
            ticket="t",
            client_id="c",
            cols=80,
            rows=24,
            cwd=cwd,
            shell=None,
            multiplexer=multiplexer,
            create=create,
            reason="initial",
            prev_ms=None,
        )
    return ws, bridge_kwargs


class TestSpawnCwd:
    async def test_고른_폴더에서_뜬다(self, workspace_dir):
        """이 테스트가 도로 빨개지면 폴더 선택이 다시 무의미해진 것이다."""
        _root, picked = workspace_dir
        _ws, kwargs = await _connect(mux.NONE, cwd="picked-folder")
        assert kwargs["cwd"] == str(picked)

    async def test_경로가_없으면_워크스페이스_루트(self, workspace_dir):
        """`$HOME` 이 아니다 — 그게 "자꾸 루트로 붙는다" 의 그 루트였다."""
        root, _picked = workspace_dir
        _ws, kwargs = await _connect(mux.NONE, cwd=None)
        assert kwargs["cwd"] == os.path.abspath(str(root))
        assert kwargs["cwd"] != os.path.expanduser("~")

    async def test_새로_여는_자리의_잘못된_경로는_말해_준다(self, workspace_dir):
        ws, kwargs = await _connect(mux.NONE, cwd="없는-폴더", create=True)
        assert ws.closed_with is not None
        assert ws.closed_with[0] == 1008
        assert kwargs == {}   # bridge 까지 가지 않는다

    async def test_재접속은_사라진_경로를_경로_오류로_닫지_않는다(self, workspace_dir):
        """맨 셸은 붙잡는 쪽이 없으니 재접속은 "session not found" 로 닫힌다 — 경로가
        사라졌다는 1008 이 그 사실을 가리면 프론트가 `create=1` 전환을 못 탄다."""
        ws, kwargs = await _connect(mux.NONE, cwd="없는-폴더", create=False, holder=None)
        assert ws.closed_with == (1000, "session not found")
        assert kwargs == {}

    async def test_아무도_안_잡고_있으면_이어붙기는_닫는다(self, workspace_dir):
        """`create=0` 은 "만들지 말고 붙기만" 이다. 붙을 대상이 없으면 닫아야 프론트가
        `session-gone` → `create=1` 로 전환한다(호스트 재부팅 복구가 그 길이다)."""
        ws, kwargs = await _connect(mux.NONE, cwd=None, create=False, holder=None)
        assert ws.closed_with == (1000, "session not found")
        assert kwargs == {}

    async def test_설정이_none_이어도_tmux_가_잡고_있으면_tmux_로_붙는다(self, workspace_dir):
        """설정이 정하는 것은 새 세션뿐이다. 살아 있는 tmux 세션에는 tmux 로 붙어야 한다.

        관찰은 `term` 으로 한다. 라우트가 무엇이 도는지에 따라 고르는 값이라
        (tmux 면 `tmux-256color`) 실제로 어느 갈래를 탔는지의 지문이 된다.
        """
        with patch.object(terminal_ws.tmux_manager, "session_exists", AsyncMock(return_value=True)):
            _ws, kwargs = await _connect(mux.NONE, cwd=None, holder=mux.TMUX)
        assert kwargs["term"] == "tmux-256color"
        assert kwargs["cwd"] is None       # tmux 는 attach 라 시작 경로를 안 받는다

    async def test_tmux_는_bridge_에_경로를_주지_않는다(self, workspace_dir):
        """tmux 는 attach 다 — 시작 경로는 세션을 만들 때 `-c` 로 이미 정해졌다."""
        with (
            patch.object(terminal_ws.tmux_manager, "session_exists", AsyncMock(return_value=True)),
            patch.object(terminal_ws.tmux_manager, "_run", AsyncMock(return_value=None)),
        ):
            _ws, kwargs = await _connect(mux.TMUX, cwd="picked-folder")
        assert kwargs["cwd"] is None


def test_워크스페이스_루트가_홈과_다른_배포에서만_의미가_있다():
    """이 저장소의 기본 배포가 그렇다 — 둘이 같으면 위 회귀를 애초에 못 봤다."""
    assert isinstance(WORKSPACE_ROOT, str) and WORKSPACE_ROOT


class TestPerOpenMultiplexer:
    """폴더 픽커에서 이 pane 만 다른 것으로 열 수 있다 — **만들 때만** 쓰이는 값이다.

    bridge 가 `cwd` 를 받았는지가 곧 증거다: tmux 는 세션을 만들 때 `-c` 로 받으므로
    bridge 에 안 넘어가고, none 만 bridge 가 직접 띄우며 받는다.
    """

    async def test_고른_것이_전역_설정을_대신한다(self, workspace_dir):
        _ws, kwargs = await _connect("tmux", cwd=None, multiplexer="none")
        assert kwargs["cwd"] is not None

    async def test_이미_붙잡고_있는_쪽이_고른_것을_이긴다(self, workspace_dir):
        """살아 있는 세션에 다른 멀티플렉서로 붙으려 들면 빈 세션이 새로 뜬다."""
        _ws, kwargs = await _connect("none", cwd=None, holder="tmux", multiplexer="none")
        assert kwargs["cwd"] is None

    async def test_모르는_값은_기본으로_접힌다(self, workspace_dir):
        """쿼리는 클라이언트가 준 값이다 — 화이트리스트 밖은 조용히 기본(tmux)으로."""
        _ws, kwargs = await _connect("none", cwd=None, multiplexer="; rm -rf /")
        assert kwargs["cwd"] is None

    async def test_안_고르면_설정을_따른다(self, workspace_dir):
        _ws, kwargs = await _connect("none", cwd=None, multiplexer=None)
        assert kwargs["cwd"] is not None

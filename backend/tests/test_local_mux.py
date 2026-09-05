"""이 서버의 pane 을 무엇이 붙잡는가 — tmux 아니면 아무도.

가장 위험한 자리를 잠근다: **"살아있는 세션 목록"** 은 지우는 코드(탭 상태 sanitize ·
세션 행 prune)가 읽는 값이라, 빈 집합을 "전부 죽었다" 로 읽으면 사용자의 레이아웃이
통째로 날아간다.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

import local_mux
import multiplexer as mux


class TestAttachArgv:
    def test_tmux_는_우리_소켓에_붙는다(self):
        argv = local_mux.attach_argv(mux.TMUX, "sess-1")
        assert "attach-session" in argv and "sess-1" in argv
        assert "-L" in argv   # 시스템 tmux 와 격리된 우리 소켓

    def test_none_은_로그인_셸이다(self):
        assert local_mux.attach_argv(mux.NONE, "sess-1", shell="/bin/zsh") == ["/bin/zsh", "-l"]

    def test_모르는_값은_tmux_다(self):
        """걷어낸 값(herdr)이 옛 설정에 남아 있어도 셸로 떨어지지 않고 tmux 로 붙는다."""
        argv = local_mux.attach_argv("herdr", "sess-1")
        assert "attach-session" in argv


class TestSessionHolders:
    @staticmethod
    def _tmux(*names):
        return [SimpleNamespace(name=n) for n in names]

    @pytest.mark.anyio
    async def test_붙잡고_있는_쪽을_알려준다(self):
        """attach 는 설정이 아니라 이 답을 따른다."""
        with (
            patch.object(local_mux.tmux_manager, "list_sessions",
                         AsyncMock(return_value=self._tmux("t1"))),
            patch.object(local_mux.shutil, "which", return_value="/usr/bin/tmux"),
        ):
            assert await local_mux.holder_of("t1") == mux.TMUX
            assert await local_mux.holder_of("없는것") is None
            assert await local_mux.live_session_names() == {"t1"}

    @pytest.mark.anyio
    async def test_tmux_가_없으면_묻지_않는다(self):
        """안 깔린 도구에 묻는 건 탭 상태 저장마다 헛도는 프로세스 하나다."""
        with (
            patch.object(local_mux.tmux_manager, "list_sessions", AsyncMock()) as tmux,
            patch.object(local_mux.shutil, "which", return_value=None),
        ):
            assert await local_mux.live_session_names() == set()
        tmux.assert_not_awaited()

    @pytest.mark.anyio
    async def test_tmux_가_던져도_빈_집합이다(self):
        """빈 집합은 '전부 죽었다' 가 아니라 '판정 불가' — 지우는 코드는 손을 뗀다."""
        with (
            patch.object(local_mux.tmux_manager, "list_sessions",
                         AsyncMock(side_effect=RuntimeError("tmux down"))),
            patch.object(local_mux.shutil, "which", return_value="/usr/bin/tmux"),
        ):
            assert await local_mux.live_session_names() == set()


class TestChoiceFor:
    @pytest.mark.anyio
    async def test_설정을_못_읽으면_기본값이다(self):
        """⚠️ 여기서 `none` 으로 떨어지면 멀쩡한 tmux 세션이 전부 죽은 것으로 읽힌다."""
        with patch.object(local_mux.storage, "get_user_settings",
                          AsyncMock(side_effect=RuntimeError("db down"))):
            assert await local_mux.choice_for("u") == mux.DEFAULT

    @pytest.mark.anyio
    async def test_설정값을_따른다(self):
        with patch.object(local_mux.storage, "get_user_settings",
                          AsyncMock(return_value={"defaultMultiplexer": "none"})):
            assert await local_mux.choice_for("u") == mux.NONE

    @pytest.mark.anyio
    async def test_모르는_값은_기본으로_접는다(self):
        """걷어낸 herdr 를 저장해 둔 사용자도 여기서 tmux 로 돌아온다."""
        for stale in ("zellij", "herdr"):
            with patch.object(local_mux.storage, "get_user_settings",
                              AsyncMock(return_value={"defaultMultiplexer": stale})):
                assert await local_mux.choice_for("u") == mux.DEFAULT


class TestKillSession:
    """세션 재시작이 **붙잡고 있는 쪽에게** 가 닿는지."""

    @pytest.mark.anyio
    async def test_tmux_는_tmux_에게_보낸다(self):
        with patch.object(local_mux.tmux_manager, "kill_session", AsyncMock()) as killed:
            with patch.object(local_mux, "holder_of", AsyncMock(return_value=mux.TMUX)):
                await local_mux.kill_session("sess-1")
        killed.assert_awaited_once_with("sess-1")

    @pytest.mark.anyio
    async def test_none_은_죽일_것이_없다(self):
        """셸은 소켓이 닫히면 함께 끝난다 — tmux 를 건드리면 남의 세션을 죽인다."""
        with (
            patch.object(local_mux, "holder_of", AsyncMock(return_value=None)),
            patch.object(local_mux.tmux_manager, "kill_session", AsyncMock()) as killed,
        ):
            await local_mux.kill_session("sess-1")
        killed.assert_not_awaited()


class TestIsMissing:
    def test_tmux_가_없을_때만_알린다(self):
        with patch.object(local_mux.shutil, "which", return_value=None):
            assert local_mux.is_missing(mux.TMUX)
            assert not local_mux.is_missing(mux.NONE)
        with patch.object(local_mux.shutil, "which", return_value="/usr/bin/tmux"):
            assert not local_mux.is_missing(mux.TMUX)

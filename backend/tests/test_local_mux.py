"""이 서버의 pane 도 고른 것 하나만 쓴다 — tmux 를 밑에 깔지 않는다.

가장 위험한 자리를 잠근다: **"살아있는 세션 목록"** 은 지우는 코드(탭 상태 sanitize ·
세션 행 prune)가 읽는 값이라, 여기서 tmux 에게만 물으면 herdr 로 열어 둔 탭이 전부
"죽었다" 로 읽혀 사용자의 레이아웃이 통째로 날아간다.
"""
from unittest.mock import AsyncMock, patch

import pytest

import local_mux
import multiplexer as mux


class TestAttachArgv:
    def test_tmux_는_우리_소켓에_붙는다(self):
        argv = local_mux.attach_argv(mux.TMUX, "sess-1")
        assert "attach-session" in argv and "sess-1" in argv
        assert "-L" in argv   # 시스템 tmux 와 격리된 우리 소켓

    def test_herdr_는_herdr_를_직접_실행한다(self):
        """tmux 를 거치지 않는다 — 이게 이 변경의 핵심이다."""
        with patch.object(local_mux, "herdr_bin", return_value="/opt/herdr"):
            assert local_mux.attach_argv(mux.HERDR, "sess-1") == [
                "/opt/herdr", "--session", "sess-1",
            ]

    def test_herdr_가_없으면_셸로_떨어진다(self):
        """연결이 실패하는 것보다 낫다. 없다는 사실은 `is_missing` 이 따로 알린다."""
        with patch.object(local_mux, "herdr_bin", return_value=None):
            argv = local_mux.attach_argv(mux.HERDR, "sess-1", shell="/bin/zsh")
        assert argv == ["/bin/zsh", "-l"]

    def test_none_은_로그인_셸이다(self):
        assert local_mux.attach_argv(mux.NONE, "sess-1", shell="/bin/zsh") == ["/bin/zsh", "-l"]


class TestLiveSessionNames:
    @pytest.mark.anyio
    async def test_herdr_를_골랐으면_tmux_에게_묻지_않는다(self):
        """tmux 에게 물으면 herdr 세션이 전부 '죽은 것' 이 되고, 그 목록으로 탭을 지운다."""
        with patch.object(local_mux, "_herdr_session_names",
                          AsyncMock(return_value={"a", "b"})) as herdr, \
             patch.object(local_mux.tmux_manager, "list_sessions", AsyncMock()) as tmux:
            names = await local_mux.live_session_names(mux.HERDR)
        assert names == {"a", "b"}
        assert herdr.called and not tmux.called

    @pytest.mark.anyio
    async def test_none_은_항상_빈_집합(self):
        """빈 집합은 호출부에서 '판정 불가' 로 읽혀 아무것도 안 지운다."""
        assert await local_mux.live_session_names(mux.NONE) == set()


class TestParseHerdrSessions:
    def test_객체_배열에서_이름을_뽑는다(self):
        out = local_mux.parse_herdr_sessions('{"sessions":[{"name":"work"},{"name":"lab"}]}')
        assert out == {"work", "lab"}

    def test_최상위_배열도_받는다(self):
        assert local_mux.parse_herdr_sessions('[{"name":"work"}]') == {"work"}
        assert local_mux.parse_herdr_sessions('["work"]') == {"work"}

    def test_모양이_바뀌면_조용히_빈_집합(self):
        """⚠️ 여기서 던지거나 엉뚱한 값을 내면 **탭이 지워진다.** 빈 집합 = 판정 불가."""
        for bad in ("", "not json", "null", "42", '{"unexpected": 1}'):
            assert local_mux.parse_herdr_sessions(bad) == set()


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
                          AsyncMock(return_value={"defaultMultiplexer": "herdr"})):
            assert await local_mux.choice_for("u") == mux.HERDR

    @pytest.mark.anyio
    async def test_모르는_값은_기본으로_접는다(self):
        with patch.object(local_mux.storage, "get_user_settings",
                          AsyncMock(return_value={"defaultMultiplexer": "zellij"})):
            assert await local_mux.choice_for("u") == mux.DEFAULT

"""이 서버의 pane 도 고른 것 하나만 쓴다 — tmux 를 밑에 깔지 않는다.

가장 위험한 자리를 잠근다: **"살아있는 세션 목록"** 은 지우는 코드(탭 상태 sanitize ·
세션 행 prune)가 읽는 값이라, 여기서 tmux 에게만 물으면 herdr 로 열어 둔 탭이 전부
"죽었다" 로 읽혀 사용자의 레이아웃이 통째로 날아간다.
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


class TestSessionHolders:
    """**양자택일을 없앤 자리.**

    처음 판은 설정으로 갈라 고른 쪽 세션만 돌려줬다. 그래서 herdr 로 바꾸는 순간 멀쩡히
    살아 있는 tmux 세션이 전부 "죽었다" 로 읽혔고(그 목록으로 탭을 지운다), 이어할 수
    있는 세션 목록에서도 통째로 사라졌다. 지금은 **둘 다 묻고 합집합**이다.
    """

    @staticmethod
    def _tmux(*names):
        return [SimpleNamespace(name=n) for n in names]

    @pytest.mark.anyio
    async def test_둘을_섞어_보여준다(self):
        with (
            patch.object(local_mux, "_herdr_session_names", AsyncMock(return_value={"h1", "h2"})),
            patch.object(local_mux.tmux_manager, "list_sessions",
                         AsyncMock(return_value=self._tmux("t1"))),
            patch.object(local_mux.shutil, "which", return_value="/usr/bin/tmux"),
        ):
            assert await local_mux.live_session_names() == {"h1", "h2", "t1"}

    @pytest.mark.anyio
    async def test_붙잡고_있는_쪽을_알려준다(self):
        """attach 는 설정이 아니라 이 답을 따른다 — 그래야 섞여 있어도 제 세션에 붙는다."""
        with (
            patch.object(local_mux, "_herdr_session_names", AsyncMock(return_value={"h1"})),
            patch.object(local_mux.tmux_manager, "list_sessions",
                         AsyncMock(return_value=self._tmux("t1"))),
            patch.object(local_mux.shutil, "which", return_value="/usr/bin/tmux"),
        ):
            assert await local_mux.holder_of("t1") == mux.TMUX
            assert await local_mux.holder_of("h1") == mux.HERDR
            assert await local_mux.holder_of("없는것") is None

    @pytest.mark.anyio
    async def test_이름이_겹치면_tmux_가_이긴다(self):
        """전환기에 같은 이름이 양쪽에 생겼다. 사람이 쓰던 쪽은 tmux 였다."""
        with (
            patch.object(local_mux, "_herdr_session_names", AsyncMock(return_value={"dup"})),
            patch.object(local_mux.tmux_manager, "list_sessions",
                         AsyncMock(return_value=self._tmux("dup"))),
            patch.object(local_mux.shutil, "which", return_value="/usr/bin/tmux"),
        ):
            assert await local_mux.holder_of("dup") == mux.TMUX

    @pytest.mark.anyio
    async def test_tmux_가_없으면_묻지_않는다(self):
        """안 깔린 도구에 묻는 건 탭 상태 저장마다 헛도는 프로세스 하나다."""
        with (
            patch.object(local_mux, "_herdr_session_names", AsyncMock(return_value={"h1"})),
            patch.object(local_mux.tmux_manager, "list_sessions", AsyncMock()) as tmux,
            patch.object(local_mux.shutil, "which", return_value=None),
        ):
            assert await local_mux.live_session_names() == {"h1"}
        tmux.assert_not_awaited()

    @pytest.mark.anyio
    async def test_tmux_가_던져도_herdr_쪽은_살린다(self):
        """한쪽 실패로 빈 집합을 내면 그 순간 다른 쪽 탭이 전부 지워진다."""
        with (
            patch.object(local_mux, "_herdr_session_names", AsyncMock(return_value={"h1"})),
            patch.object(local_mux.tmux_manager, "list_sessions",
                         AsyncMock(side_effect=RuntimeError("tmux down"))),
            patch.object(local_mux.shutil, "which", return_value="/usr/bin/tmux"),
        ):
            assert await local_mux.live_session_names() == {"h1"}

    @pytest.mark.anyio
    async def test_둘_다_없으면_빈_집합(self):
        """빈 집합은 '전부 죽었다' 가 아니라 '판정 불가' — 지우는 코드는 손을 뗀다."""
        with (
            patch.object(local_mux, "_herdr_session_names", AsyncMock(return_value=set())),
            patch.object(local_mux.shutil, "which", return_value=None),
        ):
            assert await local_mux.live_session_names() == set()


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


class TestKillSession:
    """세션 재시작이 **붙잡고 있는 쪽에게** 가 닿는지.

    tmux 로 고정돼 있던 동안 herdr 사용자의 "세션 재시작" 은 조용한 무동작이었다 —
    죽일 tmux 세션이 없으니 kill 이 성공한 척 끝나고, 재접속은 멀쩡히 살아 있는 herdr
    세션에 그대로 다시 붙었다. 눌러도 아무 일이 안 나는데 에러도 없다.
    """

    @pytest.mark.anyio
    async def test_tmux_는_tmux_에게_보낸다(self):
        with patch.object(local_mux.tmux_manager, "kill_session", AsyncMock()) as killed:
            with patch.object(local_mux, "holder_of", AsyncMock(return_value=mux.TMUX)):
                await local_mux.kill_session("sess-1")
        killed.assert_awaited_once_with("sess-1")

    @pytest.mark.anyio
    async def test_herdr_는_stop_뒤_delete_다(self):
        """`stop` 만으로는 이름이 남아 같은 id 로 새 세션이 안 뜬다."""
        calls = []

        async def fake_exec(binary, *args, **kwargs):
            calls.append((binary, *args))
            proc = AsyncMock()
            proc.communicate = AsyncMock(return_value=(b"", b""))
            proc.returncode = 0
            return proc

        with (
            patch.object(local_mux, "herdr_bin", return_value="/opt/herdr"),
            patch("asyncio.create_subprocess_exec", side_effect=fake_exec),
            patch.object(local_mux.tmux_manager, "kill_session", AsyncMock()) as tmux_killed,
        ):
            with patch.object(local_mux, "holder_of", AsyncMock(return_value=mux.HERDR)):
                await local_mux.kill_session("sess-1")

        assert calls == [
            ("/opt/herdr", "session", "stop", "sess-1"),
            ("/opt/herdr", "session", "delete", "sess-1"),
        ]
        tmux_killed.assert_not_awaited()   # tmux 를 밑에 깔지 않는다

    @pytest.mark.anyio
    async def test_stop_이_실패해도_delete_는_한다(self):
        """이미 멈춰 있는 세션이 그 경우다 — 거기서 멈추면 이름이 영영 남는다."""
        calls = []

        async def fake_exec(binary, *args, **kwargs):
            calls.append(args)
            proc = AsyncMock()
            proc.communicate = AsyncMock(return_value=(b"", b"not running"))
            proc.returncode = 1
            return proc

        with (
            patch.object(local_mux, "herdr_bin", return_value="/opt/herdr"),
            patch("asyncio.create_subprocess_exec", side_effect=fake_exec),
        ):
            with patch.object(local_mux, "holder_of", AsyncMock(return_value=mux.HERDR)):
                await local_mux.kill_session("sess-1")

        assert [a[1] for a in calls] == ["stop", "delete"]

    @pytest.mark.anyio
    async def test_herdr_가_없으면_조용히_넘어간다(self):
        with patch.object(local_mux, "herdr_bin", return_value=None):
            with patch.object(local_mux, "holder_of", AsyncMock(return_value=mux.HERDR)):
                await local_mux.kill_session("sess-1")   # 던지지 않는다

    @pytest.mark.anyio
    async def test_none_은_죽일_것이_없다(self):
        """셸은 소켓이 닫히면 함께 끝난다 — tmux 를 건드리면 남의 세션을 죽인다."""
        with (
            patch.object(local_mux, "holder_of", AsyncMock(return_value=None)),
            patch.object(local_mux.tmux_manager, "kill_session", AsyncMock()) as killed,
        ):
            await local_mux.kill_session("sess-1")
        killed.assert_not_awaited()

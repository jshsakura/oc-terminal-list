"""원격 팬이 **보내는** 쪽 — 붙어 있지 않아도 걷어 온다.

이게 없으면 대화가 반쪽이다: 8.1 → 8.2 는 백엔드가 SSH 로 배달하니 되는데, 8.2 → 8.1
회신은 그 탭이 안 붙어 있으면 읽을 사람이 없어 영영 안 온다. 실제로 그 상태였다.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

import remote_outbox


class TestParseDrain:
    def test_세션과_페이로드로_나눈다(self):
        raw = 'mobile-a\t{"to":"1.1","text":"x"}\nmobile-b\t{"to":"2.1","text":"y"}\n'
        assert remote_outbox.parse_drain(raw) == [
            ("mobile-a", '{"to":"1.1","text":"x"}'),
            ("mobile-b", '{"to":"2.1","text":"y"}'),
        ]

    def test_빈_결과는_오류가_아니다(self):
        """대개의 주기가 이렇다 — 할 일이 없었다는 뜻."""
        assert remote_outbox.parse_drain("") == []
        assert remote_outbox.parse_drain(None) == []
        assert remote_outbox.parse_drain("\n\n") == []

    def test_모양이_아니면_버린다(self):
        assert remote_outbox.parse_drain("탭없는줄\n") == []
        assert remote_outbox.parse_drain("sess\t\n") == []
        assert remote_outbox.parse_drain("\t페이로드\n") == []

    def test_페이로드_속_탭은_살린다(self):
        """JSON 안에 리터럴 탭은 못 들어가지만, 나누는 것은 첫 탭 하나뿐이어야 한다."""
        assert remote_outbox.parse_drain("s\ta\tb")[0] == ("s", "a\tb")


class TestDrainCommand:
    def test_붙어_있어도_비운다(self):
        """⚠️ 한때 붙어 있으면 건너뛰었는데, `itl` 은 언제나 두 통로로 내보내므로 그 통이
        영영 안 비워졌다 — 나중에 옛말로 되살아난다. 겹치는 것은 nonce 가 접는다."""
        assert '"$a" = "0"' not in remote_outbox.DRAIN_CMD

    def test_구분자가_진짜_탭이다(self):
        """⚠️ tmux `-F` 는 `\t` 를 안 풀어 준다 — 두 글자로 나가면 `read` 가 못 쪼개
        **아무것도 안 걷힌다**(조용히). 실제로 이걸로 한 번 헛돌았다."""
        assert "\t#{session_attached}" in remote_outbox.DRAIN_CMD
        assert "\\t#{session_attached}" not in remote_outbox.DRAIN_CMD

    def test_비우는_것과_걷는_것이_한_명령_안에_있다(self):
        """⚠️ 나누면 그 사이에 다음 주기가 같은 통을 또 집는다."""
        cmd = remote_outbox.DRAIN_CMD
        assert "set-option -u" in cmd and "printf" in cmd
        assert cmd.index("set-option -u") < cmd.index('printf "%s\\t%s')

    def test_빈_우편함은_건너뛴다(self):
        assert '[ -n "$v" ] || continue' in remote_outbox.DRAIN_CMD


class TestDrainOnce:
    @pytest.fixture(autouse=True)
    def _no_ssh(self):
        with patch.object(remote_outbox, "_drain_host", AsyncMock()) as drain:
            self.drain = drain
            yield

    async def test_원격_팬이_있는_호스트만_훑는다(self):
        with patch.object(remote_outbox, "_hosts_with_remote_panes",
                          AsyncMock(return_value={"h1", "h2"})):
            n = await remote_outbox.drain_once("u")
        assert n == 2 and self.drain.await_count == 2

    async def test_원격_팬이_없으면_아무_데도_안_나간다(self):
        with patch.object(remote_outbox, "_hosts_with_remote_panes",
                          AsyncMock(return_value=set())):
            assert await remote_outbox.drain_once("u") == 0
        self.drain.assert_not_awaited()

    async def test_꺼진_호스트_하나가_나머지를_막지_않는다(self):
        self.drain.side_effect = [OSError("호스트가 꺼져 있다"), None]
        with patch.object(remote_outbox, "_hosts_with_remote_panes",
                          AsyncMock(return_value={"h1", "h2"})):
            await remote_outbox.drain_once("u")
        assert self.drain.await_count == 2

    async def test_주소록을_못_읽어도_던지지_않는다(self):
        with patch.object(remote_outbox, "_hosts_with_remote_panes",
                          AsyncMock(side_effect=RuntimeError("boom"))):
            assert await remote_outbox.drain_once("u") == 0


class TestDrainerLoop:
    async def test_사용자를_모르면_훑지_않는다(self):
        drain = AsyncMock()
        d = remote_outbox.RemoteOutboxDrainer(username_of=AsyncMock(return_value=None), drain=drain)
        await d._tick()
        drain.assert_not_awaited()

    async def test_보는_사람이_있으면_더_자주_돈다(self):
        assert remote_outbox.INTERVAL_ACTIVE_SEC < remote_outbox.INTERVAL_IDLE_SEC

    async def test_기다림에는_상한이_있다(self):
        assert 0 < remote_outbox.DRAIN_TIMEOUT_SEC <= 30

"""탭 번호 배달 — 표식 줍기(itl_channel)와 라우팅(itl_router).

이 경로의 사고는 전부 **조용하다.** 표식을 못 주우면 아무 일도 안 일어나고, 잘못 주우면
남의 팬에 임의 입력이 들어간다. 둘 다 에러를 안 낸다. 그래서 여기서 잠근다.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

import itl_channel
import itl_router
from itl_channel import MARKER, SentinelScanner, parse_sentinel


def line(to: str, text: str) -> bytes:
    import json
    return (MARKER + " " + json.dumps({"to": to, "text": text}, ensure_ascii=False) + "\n").encode()


class TestSentinelScanner:
    def test_한_줄을_줍는다(self):
        assert SentinelScanner().feed(line("1.2", "빌드 끝")) == [{"to": "1.2", "text": "빌드 끝"}]

    def test_청크_경계를_넘어_살아남는다(self):
        """⚠️ PTY 읽기는 개행 단위가 아니다. 이게 깨지면 긴 출력 중의 표식만 조용히 샌다."""
        raw = line("2.1", "안녕")
        sc = SentinelScanner()
        got = []
        for i in range(0, len(raw), 3):        # 3바이트씩 — UTF-8 문자도 쪼갠다
            got += sc.feed(raw[i:i + 3])
        assert got == [{"to": "2.1", "text": "안녕"}]

    def test_평범한_출력은_통과시킨다(self):
        sc = SentinelScanner()
        assert sc.feed(b"npm install\nadded 12 packages\n") == []

    def test_줄_가운데_표식도_줍는다(self):
        """에이전트가 프롬프트 뒤에 찍으면 줄 앞이 아니다."""
        sc = SentinelScanner()
        assert sc.feed(b"$ " + line("1.1", "x")) == [{"to": "1.1", "text": "x"}]

    def test_끝나지_않은_줄은_들고_있는다(self):
        sc = SentinelScanner()
        assert sc.feed(line("1.1", "x")[:-1]) == []          # 개행 없음
        assert sc.feed(b"\n") == [{"to": "1.1", "text": "x"}]

    def test_개행_없는_스트림이_버퍼를_못_키운다(self):
        """상한이 없으면 개행을 안 내는 프로그램 하나가 메모리를 먹는다."""
        sc = SentinelScanner()
        sc.feed(b"x" * (itl_channel.MAX_LINE_CHARS + 100))
        assert len(sc._carry) <= itl_channel.MAX_LINE_CHARS

    def test_서로_답하는_고리를_끊는다(self):
        """팬 둘이 서로에게 답하면 무한이다 — 상한이 그 고리의 유일한 출구다."""
        sc = SentinelScanner()
        got = []
        for _ in range(itl_channel.RATE_MAX_SENDS + 3):
            got += sc.feed(line("1.1", "ping"))
        assert len(got) == itl_channel.RATE_MAX_SENDS


class TestParseSentinel:
    @pytest.mark.parametrize("bad", [
        "", "not json", "null", "42", "[]",
        '{"to": "1.2"}',                 # text 없음
        '{"text": "x"}',                 # to 없음
        '{"to": 1.2, "text": "x"}',      # 문자열이 아님
        '{"to": "", "text": "x"}',
        '{"to": "1.2", "text": "   "}',
    ])
    def test_모양이_아니면_조용히_None(self, bad):
        """표식이 우연히 섞인 로그·소스코드에 대고 에러를 쏟으면 그게 소음이다."""
        assert parse_sentinel(bad) is None

    def test_공백은_다듬는다(self):
        assert parse_sentinel('  {"to": " 1.2 ", "text": " 안녕 "}  ') == {"to": "1.2", "text": "안녕"}


TARGETS = [
    {"addr": "1.1", "kind": "local", "sessionId": "sess-a", "tmuxSession": None, "hostId": None},
    {"addr": "2.1", "kind": "host", "sessionId": None, "tmuxSession": "mobile-x", "hostId": "h1"},
    {"addr": "2.2", "kind": "host", "sessionId": None, "tmuxSession": None, "hostId": "h1"},
]


class TestResolve:
    def test_주소로_찾는다(self):
        assert itl_router.resolve(TARGETS, "2.1")["hostId"] == "h1"

    @pytest.mark.parametrize("bad", ["", "abc", "1", "1.2.3", "a.b", "-1.2"])
    def test_탭_모양이_아니면_거절(self, bad):
        with pytest.raises(itl_router.DeliveryFailed):
            itl_router.resolve(TARGETS, bad)

    def test_없는_탭이면_지금_있는_것을_알려준다(self):
        """번호는 밀린다 — "없다" 만 말하면 보낸 쪽이 뭘 고쳐야 할지 모른다."""
        with pytest.raises(itl_router.DeliveryFailed) as e:
            itl_router.resolve(TARGETS, "9.9")
        assert "1.1" in str(e.value) and "2.1" in str(e.value)

    def test_native_addr_는_로컬과_원격을_같은_방식으로_낸다(self):
        assert itl_router.native_addr(TARGETS[0]) == "sess-a"
        assert itl_router.native_addr(TARGETS[1]) == "mobile-x"
        assert itl_router.native_addr(TARGETS[2]) == ""      # 붙을 세션이 없다


class TestDeliver:
    @pytest.fixture(autouse=True)
    def _targets(self):
        with patch.object(itl_router, "_targets_for", AsyncMock(return_value=TARGETS)):
            yield

    async def test_로컬은_로컬에서_돈다(self):
        with (
            patch.object(itl_router, "_run_local", AsyncMock(return_value="")) as local,
            patch.object(itl_router, "_run_remote", AsyncMock()) as remote,
        ):
            out = await itl_router.deliver("u", "1.1", "안녕")
        remote.assert_not_awaited()
        assert local.await_args.args[0] == ["send", "sess-a", "안녕"]
        assert out["ok"] and out["kind"] == "local"

    async def test_원격은_그_호스트에서_돈다(self):
        with (
            patch.object(itl_router, "_run_local", AsyncMock()) as local,
            patch.object(itl_router, "_run_remote", AsyncMock(return_value="")) as remote,
        ):
            await itl_router.deliver("u", "2.1", "안녕")
        local.assert_not_awaited()
        host_id, user, args = remote.await_args.args
        assert host_id == "h1" and user == "u"
        assert args == ["send", "mobile-x", "안녕"]

    async def test_보낸이_꼬리표는_주소_모양일_때만_붙는다(self):
        """🔐 임의 문자열이 새면 받는 에이전트에게 보내는 쪽을 사칭할 수 있다."""
        with patch.object(itl_router, "_run_local", AsyncMock(return_value="")) as local:
            await itl_router.deliver("u", "1.1", "x", sender="1.2")
            assert local.await_args.args[0][2] == "[from 1.2] x"
            await itl_router.deliver("u", "1.1", "x", sender="rm -rf /; echo")
            assert local.await_args.args[0][2] == "x"

    async def test_빈_팬에는_못_보낸다(self):
        with pytest.raises(itl_router.DeliveryFailed):
            await itl_router.deliver("u", "2.2", "안녕")

    async def test_빈_내용과_너무_긴_내용은_거절(self):
        for bad in ("", "   ", "x" * (itl_router.MAX_TEXT_BYTES + 1)):
            with pytest.raises(itl_router.DeliveryFailed):
                await itl_router.deliver("u", "1.1", bad)

    async def test_상한이_cli_와_같다(self):
        """⚠️ 여기서 통과시킨 것을 저쪽이 거절하면 보낸 쪽은 성공했다고 믿는다."""
        import importlib.machinery
        import importlib.util
        from pathlib import Path
        path = Path(itl_router.__file__).resolve().parent / "cli" / "itl"
        loader = importlib.machinery.SourceFileLoader("itl_cli_limits", str(path))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        mod = importlib.util.module_from_spec(spec)
        loader.exec_module(mod)
        assert mod.MAX_TEXT_BYTES == itl_router.MAX_TEXT_BYTES
        assert mod.SEND_MARKER == itl_channel.MARKER


class TestDeliverFromPane:
    async def test_보낸이는_페이로드가_아니라_세션에서_되짚는다(self):
        """팬이 자칭하게 두면 사칭이 공짜가 된다."""
        with (
            patch.object(itl_router, "_targets_for", AsyncMock(return_value=TARGETS)),
            patch.object(itl_router, "_run_local", AsyncMock(return_value="")) as local,
        ):
            # 표식에는 보낸이 칸이 아예 없다. 열쇠(mobile-x)로 2.1 을 되짚어야 한다.
            await itl_router.deliver_from_pane("u", "mobile-x", {"to": "1.1", "text": "보고"})
        assert local.await_args.args[0][2] == "[from 2.1] 보고"

    async def test_배달_실패는_보낸_팬에_알린다(self):
        """조용히 성공한 척하면 보낸 에이전트는 상대가 받았다고 믿는다."""
        sent: list[list[str]] = []

        async def fake_local(args):
            sent.append(args)
            return ""

        with (
            patch.object(itl_router, "_targets_for", AsyncMock(return_value=TARGETS)),
            patch.object(itl_router, "_run_local", fake_local),
        ):
            await itl_router.deliver_from_pane("u", "sess-a", {"to": "9.9", "text": "x"})
        assert len(sent) == 1 and "못 보냈다" in sent[0][2]
        assert sent[0][1] == "sess-a"          # 보낸 팬 자신에게

    async def test_주소록에_없는_팬이면_알릴_곳도_없다(self):
        with (
            patch.object(itl_router, "_targets_for", AsyncMock(return_value=TARGETS)),
            patch.object(itl_router, "_run_local", AsyncMock()) as local,
        ):
            await itl_router.deliver_from_pane("u", "모르는세션", {"to": "9.9", "text": "x"})
        local.assert_not_awaited()

    async def test_한_번의_실패가_브리지를_죽이지_않는다(self):
        with (
            patch.object(itl_router, "_targets_for", AsyncMock(return_value=TARGETS)),
            patch.object(itl_router, "_run_local", AsyncMock(side_effect=RuntimeError("boom"))),
        ):
            await itl_router.deliver_from_pane("u", "sess-a", {"to": "1.1", "text": "x"})

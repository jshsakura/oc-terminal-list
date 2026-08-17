"""원격 pane 으로 보내기 — 받는 쪽에 그 호스트의 열쇠가 없어도 되게.

네 가지를 잠근다:
  1. 세션 ID 로 주소를 잡을 수 있다 (번호는 밀리고, 죽은 세션 이름은 다른 세션으로
     오인된다 — 실제로 그렇게 엉뚱한 터미널에 명령이 박혔다).
  2. 원격 pane 이 `remote-unsupported` 로 조용히 버려지지 않고, 백엔드가 저장된
     자격증명으로 SSH 를 걸어 실제로 넣는다.
  3. **배달은 확인된 것만 배달이다.** tmux 가 거절했는데 delivered 로 세면, 보낸 쪽은
     기다리고 받은 쪽은 아무것도 못 받은 상태로 둘 다 멈춘다.
  4. **한 호스트에는 연결 하나.** 대상마다 핸드셰이크를 새로 하면 팬아웃이 호출자
     타임아웃을 넘기고, 그러면 배달은 되는데 실패로 읽혀 재시도가 중복 전송이 된다.
"""
import asyncio
import shlex

import pytest

import itl_remote
from itl_targets import build_targets, resolve

TABS = [
    {
        "name": "work",
        "activePaneId": "p1",
        "panes": [
            {"id": "p1", "sessionId": "46aca893-d0d6-4803-ba34-485055b4f922"},
            {"id": "p2", "hostId": "h1", "tmuxSessionName": "mobile-1ea43f8888f1"},
        ],
    },
]

# 두 호스트에 흩어진 원격 pane 들 — 연결 재사용과 격리를 재는 데 쓴다.
MULTI_TABS = [
    {
        "name": "fleet",
        "activePaneId": "p1",
        "panes": [
            {"id": "p1", "hostId": "h1", "tmuxSessionName": "a1"},
            {"id": "p2", "hostId": "h1", "tmuxSessionName": "a2"},
            {"id": "p3", "hostId": "h2", "tmuxSessionName": "b1"},
        ],
    },
]


def _targets():
    return build_targets(TABS)


class TestAddressByIdentity:
    def test_local_session_id(self):
        matched = resolve(_targets(), "46aca893-d0d6-4803-ba34-485055b4f922")
        assert [t["addr"] for t in matched] == ["1.1"]

    def test_remote_tmux_name(self):
        matched = resolve(_targets(), "mobile-1ea43f8888f1")
        assert [t["addr"] for t in matched] == ["1.2"]

    def test_needs_no_caller_anchor(self):
        """복사해 넘긴 핸들은 남의 탭에서 실행된다 — 기준점 없이도 닿아야 한다."""
        matched = resolve(_targets(), "mobile-1ea43f8888f1", None)
        assert [t["addr"] for t in matched] == ["1.2"]

    def test_identity_beats_the_dot_split(self):
        """원격 세션 이름에 점이 들어갈 수 있다 — "탭 mobile 의 2번" 으로 읽으면 안 된다."""
        tabs = [{"name": "t", "panes": [{"id": "p", "hostId": "h", "tmuxSessionName": "mobile.2"}]}]
        assert [t["addr"] for t in resolve(build_targets(tabs), "mobile.2")] == ["1.1"]

    def test_unknown_id_matches_nothing(self):
        assert resolve(_targets(), "not-a-session") == []


class TestRemoteCommands:
    """로컬 경로와 같은 규칙이어야 한다 — 어긋나면 원격에서만 조용히 깨진다."""

    def test_literal_and_flag_terminator(self):
        """원격 셸이 실제로 받는 argv 로 잠근다 — 인용 스타일이 아니라 의미가 계약이다."""
        first = itl_remote.build_send_cmd("mobile", "-x hello 'world'").split("&&")[0]
        assert shlex.split(first) == ["tmux", "send-keys", "-t", "=mobile:", "-l", "--",
                                      "-x hello 'world'"]

    def test_submit_is_a_separate_key(self):
        """Enter 를 -l 로 보내면 "Enter" 라는 글자가 찍힌다."""
        parts = itl_remote.build_send_cmd("mobile", "hi", submit=True).split("&&")
        assert shlex.split(parts[0]) == ["tmux", "send-keys", "-t", "=mobile:", "-l", "--", "hi"]
        assert shlex.split(parts[1]) == ["tmux", "send-keys", "-t", "=mobile:", "Enter"]

    def test_submit_is_chained_with_and(self):
        """`;` 로 이으면 본문이 실패했는데 Enter 만 들어가 프롬프트에 있던 것이 실행된다."""
        cmd = itl_remote.build_send_cmd("mobile", "hi", submit=True)
        assert ";" not in cmd
        assert cmd.count("&&") == 2          # 본문 && Enter && 표식

    def test_confirmation_marker_is_the_last_step(self):
        """표식이 없으면 delivered 로 세지 않는다 — check=False 는 exit code 를 안 본다."""
        assert itl_remote.build_send_cmd("mobile", "hi").endswith("echo ITL_SENT")
        assert itl_remote.build_key_cmd("mobile", "C-c").endswith("echo ITL_SENT")

    def test_no_submit_by_default(self):
        assert "Enter" not in itl_remote.build_send_cmd("mobile", "hi")

    def test_key_command_is_not_literal(self):
        first = itl_remote.build_key_cmd("mobile", "C-c").split("&&")[0]
        assert shlex.split(first) == ["tmux", "send-keys", "-t", "=mobile:", "C-c"]

    def test_pane_target_keeps_the_colon(self):
        """`=name` 만 쓰면 원격에서도 "can't find pane" 이다."""
        argv = shlex.split(itl_remote.build_send_cmd("mobile", "hi").split("&&")[0])
        assert argv[3] == "=mobile:"

    def test_target_is_always_quoted_for_zsh(self):
        """따옴표 없는 `=name` 은 zsh 의 equals 확장에 먹힌다 — 실호스트에서 밟았다.

        shlex.quote 는 `=mobile-x` 를 POSIX 안전으로 보고 그냥 둔다. 그러면 zsh 로그인
        셸에서 타깃이 통째로 망가져 has-session 이 조용히 실패한다.
        """
        for cmd in (itl_remote.build_send_cmd("mobile", "hi"),
                    itl_remote.build_key_cmd("mobile", "C-c"),
                    itl_remote.build_probe_cmd("mobile"),
                    itl_remote.build_capture_cmd("mobile", 20)):
            assert "'=mobile" in cmd
            assert " =mobile" not in cmd

    def test_odd_session_name_stays_one_argument(self):
        """공백·따옴표가 든 이름도 인자 하나여야 한다 — 아니면 엉뚱한 pane 을 친다."""
        argv = shlex.split(itl_remote.build_send_cmd("my sess'x", "hi").split("&&")[0])
        assert argv[3] == "=my sess'x:"


class TestProbe:
    """생사·무엇이 돌고 있나·itl 을 쓸 수 있나 — **한 번의 왕복**으로."""

    def test_one_round_trip_asks_everything(self):
        cmd = itl_remote.build_probe_cmd("s")
        assert "has-session" in cmd and "display-message" in cmd and "command -v itl" in cmd

    def test_gone_is_a_marker_not_an_empty_answer(self):
        """display-message 는 없는 타깃에도 rc=0 에 빈 값을 준다 — 빈 값으로 생사를 재면
        죽은 세션이 살아 있는 것으로 읽힌다."""
        assert itl_remote.parse_probe("ITL_GONE") is None
        assert itl_remote.parse_probe("") == itl_remote.PaneProbe("", "", "")

    def test_parses_command_title_and_itl(self):
        out = "ITL_INFO=claude\t✳ building\nITL_PATH"
        assert itl_remote.parse_probe(out) == itl_remote.PaneProbe("claude", "✳ building", "itl")

    def test_file_only_gets_the_absolute_path(self):
        """`command -v` 는 비대화형 셸 판정이라 ~/.local/bin 을 못 볼 수 있다.
        그때 답장 명령은 어느 셸에서든 도는 절대경로여야 한다."""
        assert itl_remote.parse_probe("ITL_INFO=zsh\t~\nITL_FILE").itl_cmd == "~/.local/bin/itl"

    def test_no_itl_means_no_reply_command(self):
        assert itl_remote.parse_probe("ITL_INFO=zsh\t~").itl_cmd == ""


class TestListStatus:
    def test_one_round_trip_for_every_session(self):
        assert "list-panes -a" in itl_remote.build_list_status_cmd()

    def test_parses_and_keeps_the_first_pane_of_a_session(self):
        out = "a1\tclaude\t✳ x\na1\tzsh\t~\nb1\tnode\ttitle"
        assert itl_remote.parse_list_status(out) == {
            "a1": ("claude", "✳ x"), "b1": ("node", "title"),
        }

    def test_junk_lines_are_ignored(self):
        assert itl_remote.parse_list_status("no tabs here\n\n") == {}


# --------------------------------------------------------------------------
# 배달 — 라우트가 채널 하나로 실제로 넣는가, 그리고 못 넣은 것을 정직하게 말하는가
# --------------------------------------------------------------------------

class FakeChannel:
    """`RemoteChannel` 자리에 끼워 넣는 가짜. 열린 횟수를 세는 것이 이 테스트의 핵심이다."""

    opened = 0

    def __init__(self, host_id="h1"):
        self.host_id = host_id
        self.closed = False
        FakeChannel.opened += 1

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        self.closed = True
        return None


@pytest.fixture(autouse=True)
def _reset_channel_counter():
    FakeChannel.opened = 0
    yield


def _probe(command="claude", title="✳ ready", itl_cmd=""):
    return itl_remote.PaneProbe(command, title, itl_cmd)


async def _targets_async(tabs=None):
    return build_targets(tabs or TABS)


def _patch_common(monkeypatch, itl_route, *, tabs=None):
    monkeypatch.setattr(itl_route, "_targets_for", lambda username: _targets_async(tabs))
    monkeypatch.setattr(itl_route, "get_server_identity", lambda: _identity_async())


class TestRemoteDelivery:
    """라우트가 원격 대상을 실제로 배달하는가 — 예전엔 remote-unsupported 로 버렸다."""

    @pytest.mark.asyncio
    async def test_remote_target_is_delivered(self, monkeypatch):
        import routes.itl as itl_route

        sent = []
        _patch_common(monkeypatch, itl_route)
        monkeypatch.setattr(itl_remote, "open_channel", _channel_opener())
        monkeypatch.setattr(itl_remote, "probe", _probe_returning(_probe()))
        monkeypatch.setattr(itl_remote, "send_text",
                           lambda ch, sess, text, **kw: _record(sent, (ch.host_id, sess, text)))

        result = await itl_route.itl_send(
            itl_route.SendRequest(to="mobile-1ea43f8888f1", text="go", origin=False),
            username="u",
        )
        assert result["skipped"] == []
        assert [d["addr"] for d in result["delivered"]] == ["1.2"]
        assert sent == [("h1", "mobile-1ea43f8888f1", "go")]

    @pytest.mark.asyncio
    async def test_dead_remote_session_is_never_reported_delivered(self, monkeypatch):
        import routes.itl as itl_route

        _patch_common(monkeypatch, itl_route)
        monkeypatch.setattr(itl_remote, "open_channel", _channel_opener())
        monkeypatch.setattr(itl_remote, "probe", _probe_returning(None))

        result = await itl_route.itl_send(
            itl_route.SendRequest(to="mobile-1ea43f8888f1", text="go"), username="u",
        )
        assert result["delivered"] == []
        assert result["skipped"] == [{"addr": "1.2", "reason": "session-gone"}]

    @pytest.mark.asyncio
    async def test_unreachable_host_is_skipped_not_delivered(self, monkeypatch):
        """호스트가 죽어 있으면 배달 실패다 — 팬아웃 전체를 500 으로 죽이지도 않는다."""
        import routes.itl as itl_route

        _patch_common(monkeypatch, itl_route)

        async def _boom(host_id, username):
            raise OSError("host down")

        monkeypatch.setattr(itl_remote, "open_channel", _boom)

        result = await itl_route.itl_send(
            itl_route.SendRequest(to="mobile-1ea43f8888f1", text="go"), username="u",
        )
        assert result["delivered"] == []
        assert result["skipped"] == [{"addr": "1.2", "reason": "host-unreachable"}]

    @pytest.mark.asyncio
    async def test_unconfirmed_send_is_not_delivered(self, monkeypatch):
        """tmux 가 표식을 안 주면 배달이 아니다 — check=False 는 실패를 조용히 넘긴다."""
        import routes.itl as itl_route

        _patch_common(monkeypatch, itl_route)
        monkeypatch.setattr(itl_remote, "open_channel", _channel_opener())
        monkeypatch.setattr(itl_remote, "probe", _probe_returning(_probe()))

        async def _unconfirmed(*a, **kw):
            raise itl_remote.RemoteSendError("no marker")

        monkeypatch.setattr(itl_remote, "send_text", _unconfirmed)

        result = await itl_route.itl_send(
            itl_route.SendRequest(to="mobile-1ea43f8888f1", text="go"), username="u",
        )
        assert result["delivered"] == []
        assert result["skipped"] == [{"addr": "1.2", "reason": "send-failed"}]

    @pytest.mark.asyncio
    async def test_one_connection_per_host(self, monkeypatch):
        """대상마다 핸드셰이크를 새로 열면 팬아웃이 호출자 타임아웃을 넘긴다.
        h1 의 두 세션은 **한 연결**을 나눠 쓰고, h2 는 자기 연결을 갖는다."""
        import routes.itl as itl_route

        sent = []
        _patch_common(monkeypatch, itl_route, tabs=MULTI_TABS)
        monkeypatch.setattr(itl_remote, "open_channel", _channel_opener())
        monkeypatch.setattr(itl_remote, "probe", _probe_returning(_probe()))
        monkeypatch.setattr(itl_remote, "send_text",
                           lambda ch, sess, text, **kw: _record(sent, (ch.host_id, sess)))

        result = await itl_route.itl_send(
            itl_route.SendRequest(to="@all", text="go", origin=False), username="u",
        )
        assert [d["addr"] for d in result["delivered"]] == ["1.1", "1.2", "1.3"]
        assert sorted(sent) == [("h1", "a1"), ("h1", "a2"), ("h2", "b1")]
        assert FakeChannel.opened == 2            # 호스트 수만큼만

    @pytest.mark.asyncio
    async def test_one_dead_host_does_not_sink_the_others(self, monkeypatch):
        """그리고 결과 순서는 주소 순서 그대로다 — 호스트별로 병렬이어도."""
        import routes.itl as itl_route

        _patch_common(monkeypatch, itl_route, tabs=MULTI_TABS)

        async def _opener(host_id, username):
            if host_id == "h1":
                raise OSError("h1 down")
            return FakeChannel(host_id)

        monkeypatch.setattr(itl_remote, "open_channel", _opener)
        monkeypatch.setattr(itl_remote, "probe", _probe_returning(_probe()))
        monkeypatch.setattr(itl_remote, "send_text", lambda *a, **kw: _noop())

        result = await itl_route.itl_send(
            itl_route.SendRequest(to="@all", text="go", origin=False), username="u",
        )
        assert [d["addr"] for d in result["delivered"]] == ["1.3"]
        assert [s["addr"] for s in result["skipped"]] == ["1.1", "1.2"]
        assert {s["reason"] for s in result["skipped"]} == {"host-unreachable"}

    @pytest.mark.asyncio
    async def test_slow_host_hits_the_deadline_and_says_so(self, monkeypatch):
        """호출자 타임아웃보다 먼저 우리가 끊는다 — 그래야 "배달됐는지 모름" 이 안 생긴다."""
        import routes.itl as itl_route

        _patch_common(monkeypatch, itl_route)
        monkeypatch.setattr(itl_remote, "HOST_DEADLINE", 0.05)
        monkeypatch.setattr(itl_remote, "open_channel", _channel_opener())

        async def _hang(*a, **kw):
            await asyncio.sleep(5)

        monkeypatch.setattr(itl_remote, "probe", _hang)

        result = await itl_route.itl_send(
            itl_route.SendRequest(to="mobile-1ea43f8888f1", text="go"), username="u",
        )
        assert result["delivered"] == []
        assert result["skipped"] == [{"addr": "1.2", "reason": "deadline"}]


class TestBoundaryRules:
    """CLI 를 지나지 않는 호출자(MCP·프론트)도 같은 규칙을 받아야 한다."""

    @pytest.mark.asyncio
    async def test_multiline_is_collapsed_at_the_boundary(self, monkeypatch):
        """개행은 `send-keys -l` 에서 Enter 다 — 그대로 보내면 줄마다 제출돼 조각난다."""
        import routes.itl as itl_route

        sent = []
        _patch_common(monkeypatch, itl_route)
        monkeypatch.setattr(itl_remote, "open_channel", _channel_opener())
        monkeypatch.setattr(itl_remote, "probe", _probe_returning(_probe()))
        monkeypatch.setattr(itl_remote, "send_text",
                           lambda ch, sess, text, **kw: _record(sent, text))

        await itl_route.itl_send(
            itl_route.SendRequest(to="mobile-1ea43f8888f1", text="첫 줄\n둘째 줄\n", origin=False),
            username="u",
        )
        assert sent == ["첫 줄 · 둘째 줄"]

    def test_collapse_matches_the_cli(self):
        """구현이 둘이면 어긋난다 — 같은 입력에 같은 답을 내는지 대조한다."""
        from routes.itl import collapse_lines
        cli = _load_cli()
        for raw in ("한 줄", "a\nb", "a\r\nb\r\n", " a \n\n b ", "trailing\n"):
            assert collapse_lines(raw) == (cli._single_line(raw) if "\n" in raw or "\r" in raw
                                          else raw)


class TestOriginTag:
    """받는 쪽은 어디서 온 말인지 알아야 한다 — 보내는 쪽에 그걸 맡기면 매번 빠진다."""

    def test_addr_machine_and_cwd(self):
        from itl_origin import format_origin
        sender = {"addr": "1.2", "tabName": "Cx4", "cwd": "/home/ubuntu/work/retro-go"}
        assert format_origin(sender, "a1-ubuntu") == "[from 1.2 · Cx4 · a1-ubuntu · /home/ubuntu/work/retro-go] "

    def test_single_line(self):
        """개행을 넣으면 `send-keys -l` 에서 그 자리가 Enter 가 되어 꼬리표만 실행된다."""
        from itl_origin import format_origin
        assert "\n" not in format_origin({"addr": "1.2", "cwd": "/x"}, "box")

    def test_long_path_keeps_the_tail(self):
        from itl_origin import format_origin
        tag = format_origin({"addr": "1.1", "cwd": "/very/deep/" + "x" * 80 + "/project"}, "")
        assert tag.startswith("[from 1.1 · …")
        assert tag.endswith("/project] ")

    def test_unknown_sender_adds_nothing(self):
        """모르는 건 지어내지 않는다."""
        from itl_origin import find_sender, format_origin
        assert format_origin(None, "box") == ""
        assert find_sender(_targets(), None) is None
        assert find_sender(_targets(), "nope") is None

    def test_finds_sender_by_either_identity(self):
        from itl_origin import find_sender
        assert find_sender(_targets(), "46aca893-d0d6-4803-ba34-485055b4f922")["addr"] == "1.1"
        assert find_sender(_targets(), "mobile-1ea43f8888f1")["addr"] == "1.2"

    @pytest.mark.asyncio
    async def test_agent_pane_gets_the_tag(self, monkeypatch):
        sent = await _send_to_remote(monkeypatch, probe=_probe("claude", "✳ ready"))
        assert sent == ["[from 1.1 · work · a1-ubuntu] 빌드 돌려줘"]

    # 셸에 꼬리표를 붙이면 `[from …] make` 가 되어 그 줄이 통째로 깨진 명령이 된다.
    @pytest.mark.asyncio
    async def test_plain_shell_gets_the_raw_text(self, monkeypatch):
        sent = await _send_to_remote(monkeypatch, probe=_probe("zsh", "ubuntu@box: ~"))
        assert sent == ["빌드 돌려줘"]

    @pytest.mark.asyncio
    async def test_unknown_pane_is_treated_as_a_shell(self, monkeypatch):
        """모르면 안 붙인다 — 잘못 붙이면 명령이 깨지고, 안 붙이면 문맥만 없다."""
        sent = await _send_to_remote(monkeypatch, probe=_probe("", ""))
        assert sent == ["빌드 돌려줘"]

    @pytest.mark.asyncio
    async def test_remote_receiver_with_itl_gets_a_reply_command(self, monkeypatch):
        """원격에 itl 이 깔려 있으면 답장 방법을 알려준다 — 한쪽으로만 흐르는 핸드오프는
        보낸 쪽이 기다리다 멈추는 그 사고를 그대로 재현한다."""
        sent = await _send_to_remote(monkeypatch, probe=_probe("claude", "✳ ready", "itl"))
        assert "답장: itl send 46aca893-d0d6-4803-ba34-485055b4f922 '<답장>' --submit" in sent[0]

    @pytest.mark.asyncio
    async def test_remote_receiver_without_itl_gets_no_reply_command(self, monkeypatch):
        """없는 명령을 답장 방법이라고 적어 보내면 "command not found" 를 답장이라고 믿는다."""
        sent = await _send_to_remote(monkeypatch, probe=_probe("claude", "✳ ready", ""))
        assert "답장:" not in sent[0]

    @pytest.mark.asyncio
    async def test_reply_command_uses_the_path_probe_reported(self, monkeypatch):
        """PATH 에 없고 파일만 있으면 절대경로로 알려준다."""
        sent = await _send_to_remote(monkeypatch,
                                     probe=_probe("claude", "✳ ready", "~/.local/bin/itl"))
        assert "답장: ~/.local/bin/itl send" in sent[0]

    @pytest.mark.asyncio
    async def test_origin_false_sends_the_raw_text(self, monkeypatch):
        sent = await _send_to_remote(monkeypatch, probe=_probe("claude", "✳ ready", "itl"),
                                     origin=False)
        assert sent == ["빌드 돌려줘"]


class TestLocalReply:
    """로컬 수신자는 답장 명령을 받는다 — 그게 없으면 받은 쪽이 조용해지고 보낸 쪽이 멈춘다."""

    @pytest.mark.asyncio
    async def test_agent_pane_gets_a_runnable_reply_command(self, monkeypatch):
        import routes.itl as itl_route
        from tmux_manager import tmux_manager

        sent = []
        _patch_common(monkeypatch, itl_route)
        monkeypatch.setattr(tmux_manager, "session_exists", lambda sid: _true_async())
        monkeypatch.setattr(tmux_manager, "pane_info", lambda sid: _value_async(("claude", "✳ ready")))
        monkeypatch.setattr(tmux_manager, "send_keys",
                            lambda sid, text, **kw: _record(sent, text))

        await itl_route.itl_send(
            itl_route.SendRequest(
                to="46aca893-d0d6-4803-ba34-485055b4f922", text="빌드 돌려줘",
                from_session="mobile-1ea43f8888f1",
            ),
            username="u",
        )
        # 답장 주소는 보낸 pane 의 세션 식별자다 — 번호는 pane 이 닫히면 밀린다.
        assert sent == ["[from 1.2 · work · 답장: itl send mobile-1ea43f8888f1 '<답장>' --submit] 빌드 돌려줘"]

    @pytest.mark.asyncio
    async def test_shell_pane_gets_nothing_prepended(self, monkeypatch):
        import routes.itl as itl_route
        from tmux_manager import tmux_manager

        sent = []
        _patch_common(monkeypatch, itl_route)
        monkeypatch.setattr(tmux_manager, "session_exists", lambda sid: _true_async())
        monkeypatch.setattr(tmux_manager, "pane_info", lambda sid: _value_async(("zsh", "~")))
        monkeypatch.setattr(tmux_manager, "send_keys",
                            lambda sid, text, **kw: _record(sent, text))

        await itl_route.itl_send(
            itl_route.SendRequest(
                to="46aca893-d0d6-4803-ba34-485055b4f922", text="make -j8",
                from_session="mobile-1ea43f8888f1",
            ),
            username="u",
        )
        assert sent == ["make -j8"]


# --- helpers ---------------------------------------------------------------

def _channel_opener():
    async def _open(host_id, username):
        return FakeChannel(host_id)
    return _open


def _probe_returning(value):
    async def _probe_fn(channel, tmux_session):
        return value
    return _probe_fn


async def _identity_async():
    return {"hostname": "a1-ubuntu", "ip": "100.109.62.68", "ip_kind": "tailscale", "itl_cmd": "itl"}


async def _record(bucket, item):
    bucket.append(item)


async def _noop():
    return None


async def _true_async():
    return True


async def _value_async(value):
    return value


async def _send_to_remote(monkeypatch, *, probe, origin=True):
    """원격 pane 하나에 보내고, 실제로 배달된 문자열을 돌려준다."""
    import routes.itl as itl_route

    sent = []
    _patch_common(monkeypatch, itl_route)
    monkeypatch.setattr(itl_remote, "open_channel", _channel_opener())
    monkeypatch.setattr(itl_remote, "probe", _probe_returning(probe))
    monkeypatch.setattr(itl_remote, "send_text",
                       lambda ch, sess, text, **kw: _record(sent, text))
    await itl_route.itl_send(
        itl_route.SendRequest(
            to="mobile-1ea43f8888f1", text="빌드 돌려줘", origin=origin,
            from_session="46aca893-d0d6-4803-ba34-485055b4f922",
        ),
        username="u",
    )
    return sent


def _load_cli():
    """`backend/cli/itl` 은 확장자가 없어 평범한 import 가 안 된다."""
    import importlib.machinery
    import importlib.util
    from pathlib import Path
    path = Path(__file__).resolve().parents[1] / "cli" / "itl"
    spec = importlib.util.spec_from_loader("itl_cli_probe",
                                           importlib.machinery.SourceFileLoader("itl_cli_probe", str(path)))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

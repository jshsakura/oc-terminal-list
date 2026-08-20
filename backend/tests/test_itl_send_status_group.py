"""`@working` 으로 **보내는** 것도 원격에 닿아야 한다 — 단, 왕복은 호스트당 한 번.

읽기 경로(`/targets` `/resolve`)를 고친 뒤에도 `/send` `/key` 는 매칭 전에 상태를 채우지
않아 원격을 통째로 빼먹고 있었다. 그대로 두면 "돌고 있는 것 전부 멈춰" 가 로컬만 멈춘다.

고칠 때의 제약이 이 파일의 본체다:

**상태 조회와 배달이 각자 SSH 를 열면 호스트당 왕복이 두 번**이 되고, 두 단계가 각자
`HOST_DEADLINE`(20s)을 쓰면 합이 호출자 상한(CLI·MCP = 30s)을 넘는다. 그러면 이 저장소가
이미 적어 둔 사고가 난다 — **배달은 됐는데 실패로 읽혀 재시도가 중복 전송**이 된다.
그래서 채널을 열어 배달까지 재사용하고, 예산 하나를 나눠 쓴다.
"""
from __future__ import annotations

import asyncio

import pytest

import routes.itl as itl


class _FakeChannel:
    """열린 SSH 채널 하나. 몇 번 열렸는지 세는 것이 이 테스트의 목적이다."""

    def __init__(self, host_id, opened):
        self.host_id = host_id
        self.commands = []
        self.closed = False
        opened.append(host_id)

    async def run(self, cmd):
        self.commands.append(cmd)
        # 이 호스트에는 mobile-remote 세션 하나가 있고, 그 pane 이 일하는 중이다.
        return "ITL_SECTION\nmobile-remote|claude|✳ Working…\n"

    async def close(self):
        self.closed = True

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        await self.close()


@pytest.fixture
def wired(monkeypatch):
    """원격 한 대(host-1)에 pane 하나, 로컬 pane 하나인 세계."""
    opened: list[str] = []
    channels: dict[str, _FakeChannel] = {}

    async def fake_open_channel(host_id, username):
        ch = _FakeChannel(host_id, opened)
        channels[host_id] = ch
        return ch

    def fake_parse(out):
        rows = {}
        for line in out.splitlines():
            if "|" in line:
                name, command, title = line.split("|", 2)
                rows[name] = (command, title)
        return rows

    monkeypatch.setattr(itl.itl_remote, "open_channel", fake_open_channel)
    monkeypatch.setattr(itl.itl_remote, "parse_list_status", fake_parse)
    monkeypatch.setattr(itl.itl_remote, "build_list_status_cmd", lambda: "LIST")
    monkeypatch.setattr(itl, "detect_status", lambda title: "working" if "Working" in title else "idle")
    monkeypatch.setattr(itl, "display_title", lambda title: title)

    targets = [
        {"addr": "1.1", "sessionId": "local-1", "hostId": None, "tmuxSession": None,
         "status": "idle", "command": "zsh", "tabIndex": 1, "paneIndex": 1,
         "tabName": "t", "cwd": "/"},
        {"addr": "1.2", "sessionId": None, "hostId": "host-1", "tmuxSession": "mobile-remote",
         "status": "", "command": "", "tabIndex": 1, "paneIndex": 2,
         "tabName": "t", "cwd": "/"},
    ]

    async def fake_targets_for(username):
        return [dict(t) for t in targets]

    monkeypatch.setattr(itl, "_targets_for", fake_targets_for)
    monkeypatch.setattr(itl, "check_rate_limit", lambda *a, **k: None)

    class _Tmux:
        async def session_exists(self, sid):
            return True

    monkeypatch.setattr(itl, "tmux_manager", _Tmux())
    return opened, channels


async def _fanout(to, delivered_to):
    async def deliver_local(session_id):
        delivered_to.append(("local", session_id))

    async def deliver_remote(channel, tmux_session, found):
        delivered_to.append(("remote", tmux_session))

    async def fake_probe(channel, tmux_session):
        return itl.itl_remote.PaneProbe(command="claude", title="✳ Working…", itl_cmd="itl")

    import unittest.mock as m
    with m.patch.object(itl.itl_remote, "probe", fake_probe):
        return await itl._fanout_deliver(
            to, "local-1", "u", bucket="test",
            deliver_local=deliver_local, deliver_remote=deliver_remote,
            exclude_self=False,
        )


@pytest.mark.asyncio
async def test_working_now_reaches_the_remote_pane(wired):
    """이게 버그의 본체 — 예전에는 원격이 매칭조차 안 돼 404 였다."""
    delivered_to = []
    result = await _fanout("@working", delivered_to)
    assert ("remote", "mobile-remote") in delivered_to, (
        "@working 이 원격 pane 에 닿지 않았다 — 상태를 매칭 전에 안 채운다"
    )
    assert [d["addr"] for d in result["delivered"]] == ["1.2"]


@pytest.mark.asyncio
async def test_one_ssh_visit_per_host_not_two(wired):
    """상태 조회와 배달이 채널을 나눠 쓰는지 — 이게 시간 예산을 지키는 유일한 방법이다."""
    opened, channels = wired
    await _fanout("@working", [])
    assert opened == ["host-1"], f"호스트당 SSH 가 {len(opened)}번 열렸다 (1번이어야 한다)"
    assert channels["host-1"].closed, "팬아웃이 끝나고 채널을 닫지 않았다"


@pytest.mark.asyncio
async def test_a_plain_address_does_not_pay_for_a_status_query(wired):
    """번호 주소는 매칭에 상태가 필요 없다 — 여기에 SSH 를 더 얹으면 순 손해다."""
    opened, channels = wired
    await _fanout("1.2", [])
    assert opened == ["host-1"]
    assert "LIST" not in channels["host-1"].commands, (
        "상태 그룹이 아닌 주소인데 상태 조회를 걸었다"
    )


@pytest.mark.asyncio
async def test_the_status_query_runs_for_a_status_address(wired):
    opened, channels = wired
    await _fanout("@working", [])
    assert "LIST" in channels["host-1"].commands


@pytest.mark.asyncio
async def test_a_host_that_never_answers_does_not_eat_the_whole_budget(monkeypatch, wired):
    """상태 조회가 매달려도 마감시한에 걸려 넘어가야 한다 — 못 물어본 것은 '모름' 이다."""
    async def hang(host_id, username):
        await asyncio.sleep(3600)

    monkeypatch.setattr(itl.itl_remote, "open_channel", hang)
    monkeypatch.setattr(itl, "STATUS_PHASE_BUDGET", 0.05)

    with pytest.raises(itl.HTTPException) as e:      # 상태를 모르니 @working 에 안 걸린다
        await _fanout("@working", [])
    assert e.value.status_code == 404


def test_the_two_phases_share_one_budget():
    """각자 HOST_DEADLINE 을 쓰면 합이 호출자 상한(30s)을 넘어 중복 전송이 난다."""
    assert itl.STATUS_PHASE_BUDGET < itl.itl_remote.HOST_DEADLINE
    assert itl.STATUS_PHASE_BUDGET + itl.itl_remote.HOST_DEADLINE <= 30
    assert itl.MIN_DELIVER_DEADLINE > 0, "상태 조회가 예산을 다 먹어도 배달은 시도해야 한다"


def test_both_fill_paths_share_one_verdict():
    """채우는 길이 둘이라(자기 연결 / 공유 채널) 판정이 갈리면 한쪽만 거짓말한다."""
    src = (itl.__file__)
    body = open(src, encoding="utf-8").read()
    assert body.count("def _apply_status_tables") == 1
    for fn in ("_fill_remote_status", "_fill_status_over"):
        seg = body[body.index(f"async def {fn}"):]
        seg = seg[:seg.index("\n\n\n")]
        assert "_apply_status_tables" in seg, f"{fn} 이 공용 판정을 안 쓴다"

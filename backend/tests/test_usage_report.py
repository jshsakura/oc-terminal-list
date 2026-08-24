"""하루 한 번 가는 사용량·누수 요약.

이 파일이 잠그는 선 셋. 전부 이 저장소가 이미 밟은 함정에서 나왔다.

  1. **할 말이 없으면 아무것도 보내지 않는다.** 매일 "0" 이 오면 그 채널은 읽히지 않게 되고,
     정작 신호가 왔을 때도 안 읽힌다.
  2. **"모른다" 를 "0" 으로 접지 않는다.** tmux 서버가 죽었을 때의 빈 목록을 "죽은 세션 0개"
     로 읽으면 화면이 조용히 거짓말을 한다(플릿 보드·terminal_wait 과 같은 규칙).
  3. **수집이 실패해도 누수 신호는 나간다.** 둘은 다른 출처이므로 하나가 다른 하나를
     죽이면 안 된다.
"""
from __future__ import annotations

import datetime

import pytest

import usage_report


# ---------------------------------------------------------------- render

def test_아무_일도_없으면_보낼_것이_없다():
    assert usage_report.render({"day": "2026-08-24", "usage": {}, "blocked": {}, "dead_sessions": 0}) == ""


def test_사용량이_있으면_요약을_만든다():
    text = usage_report.render({
        "day": "2026-08-24",
        "usage": {"enabled": True, "totals": {"tokens": 4.26e9, "cost": 12.5},
                  "by_host": [{"name": "ubuntu-lab", "tokens": 3.0e9},
                              {"name": "local", "tokens": 1.26e9}],
                  "by_agent": [{"name": "claude", "tokens": 4.0e9}]},
        "blocked": {}, "dead_sessions": 0,
    })
    assert "4.26G tok" in text
    assert "ubuntu-lab" in text
    assert "claude" in text
    assert "$12.50" in text


def test_차단된_폴링은_종류별로_말한다():
    text = usage_report.render({
        "day": "2026-08-24", "usage": {},
        "blocked": {"poll-loop": 7, "noop": 2}, "dead_sessions": 0,
    })
    assert "9건" in text
    assert "폴링 루프 7" in text


def test_죽은_세션을_모를_때는_그_줄이_없다():
    """None 은 '0개' 가 아니다 — 세지 못한 것을 '없다' 로 적으면 그건 틀린 답이다."""
    unknown = usage_report.render({"day": "d", "usage": {}, "blocked": {}, "dead_sessions": None})
    some = usage_report.render({"day": "d", "usage": {}, "blocked": {}, "dead_sessions": 45})
    assert unknown == ""
    assert "45개" in some


def test_수집이_실패해도_누수_신호는_나간다():
    text = usage_report.render({
        "day": "d", "usage": {}, "blocked": {"poll-loop": 3}, "dead_sessions": 12,
    })
    assert "폴링" in text and "12개" in text


def test_본문은_텔레그램_상한_안에_있다():
    text = usage_report.render({
        "day": "d",
        "usage": {"enabled": True, "totals": {"tokens": 1e9},
                  "by_host": [{"label": "h" * 500, "tokens": 1e6} for _ in range(50)]},
        "blocked": {}, "dead_sessions": 0,
    })
    assert len(text) <= usage_report.MAX_BODY


# ---------------------------------------------------------------- schedule

@pytest.mark.parametrize("now,hour,expected_hours", [
    (datetime.datetime(2026, 8, 24, 8, 0), 9, 1),
    (datetime.datetime(2026, 8, 24, 9, 30), 9, 23.5),   # 지났으면 내일
    (datetime.datetime(2026, 8, 24, 0, 0), 0, 24),      # 정각이어도 다음 것을 가리킨다
])
def test_다음_발송까지의_시간(now, hour, expected_hours):
    assert usage_report.seconds_until(hour, now) == pytest.approx(expected_hours * 3600)


# ---------------------------------------------------------------- gather

@pytest.mark.asyncio
async def test_수집이_터져도_gather_는_살아남는다(monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("host unreachable")

    async def no_tmux():
        return False

    monkeypatch.setattr(usage_report, "get_usage", boom)
    monkeypatch.setattr(usage_report.tmux_manager, "server_alive", no_tmux)
    data = await usage_report.gather("someone", day="2026-08-24")
    assert data["usage"] == {}
    assert data["dead_sessions"] is None      # 못 셌다 — 0 이 아니다


@pytest.mark.asyncio
async def test_tmux_가_비어_있으면_죽은_세션을_세지_않는다(monkeypatch):
    """서버는 살아있다는데 목록이 비었다 = 판정 불가. 전부 죽었다고 읽으면 안 된다."""
    async def alive():
        return True

    async def empty():
        return []

    monkeypatch.setattr(usage_report.tmux_manager, "server_alive", alive)
    monkeypatch.setattr(usage_report.tmux_manager, "list_sessions", empty)
    assert await usage_report._dead_session_count("someone") is None


@pytest.mark.asyncio
async def test_텔레그램이_없으면_보내지_않는다(monkeypatch):
    async def cfg():
        return {"token": "", "chat_id": ""}

    async def report_cfg():
        return {"enabled": True, "hour": 9, "from_env": False}

    monkeypatch.setattr(usage_report.telegram_service, "get_config", cfg)
    monkeypatch.setattr(usage_report, "get_report_config", report_cfg)
    assert (await usage_report.build_and_send("someone"))["status"] == "no-telegram"


@pytest.mark.asyncio
async def test_할_말이_없으면_전송을_시도조차_안_한다(monkeypatch):
    sent = []

    async def cfg():
        return {"token": "t", "chat_id": "c"}

    async def report_cfg():
        return {"enabled": True, "hour": 9, "from_env": False}

    async def gather(username, day=None):
        return {"day": "d", "usage": {}, "blocked": {}, "dead_sessions": 0}

    async def send(*a, **k):
        sent.append(a)

    monkeypatch.setattr(usage_report.telegram_service, "get_config", cfg)
    monkeypatch.setattr(usage_report, "get_report_config", report_cfg)
    monkeypatch.setattr(usage_report, "gather", gather)
    monkeypatch.setattr(usage_report.telegram_client, "send_message", send)
    assert (await usage_report.build_and_send("someone"))["status"] == "nothing-to-say"
    assert sent == []


@pytest.mark.asyncio
async def test_parse_mode_를_쓰지_않는다(monkeypatch):
    """본문에 경로·명령 조각이 그대로 들어간다 — Markdown 으로 파싱시키면 전송 전체가 실패한다."""
    calls = []

    async def cfg():
        return {"token": "t", "chat_id": "c"}

    async def report_cfg():
        return {"enabled": True, "hour": 9, "from_env": False}

    async def gather(username, day=None):
        return {"day": "d", "usage": {}, "blocked": {"poll-loop": 1}, "dead_sessions": 0}

    async def send(token, chat_id, text, *a, **kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(usage_report.telegram_service, "get_config", cfg)
    monkeypatch.setattr(usage_report, "get_report_config", report_cfg)
    monkeypatch.setattr(usage_report, "gather", gather)
    monkeypatch.setattr(usage_report.telegram_client, "send_message", send)
    result = await usage_report.build_and_send("someone")
    assert result["status"] == "sent"
    assert all("parse_mode" not in kw for kw in calls)


# ---------------------------------------------------------------- 실전에서 새던 것들
# 아래 셋은 테스트가 다 통과한 뒤 **실제로 한 번 렌더해 보고서야** 드러난 결함이다.
# 순수 함수 테스트만으로는 "필드명이 틀렸다" 를 못 잡는다 — 틀린 필드는 예외가 아니라
# 빈 값을 주기 때문이다.

def test_호스트와_에이전트는_이름으로_나온다():
    """UUID 가 찍히면 그 줄은 읽을 수 없다 — 어느 기계인지 말하는 게 이 줄의 전부다."""
    text = usage_report.render({
        "day": "d",
        "usage": {"enabled": True, "totals": {"tokens": 1e9},
                  "by_host": [{"source_id": "a2295ae4-a2ee-4d24-914e-ddffe2989096",
                               "name": "ubuntu-lab", "tokens": 1e9}],
                  "by_agent": [{"name": "claude", "tokens": 1e9}]},
        "blocked": {}, "dead_sessions": 0,
    })
    assert "ubuntu-lab" in text
    assert "a2295ae4" not in text


def test_이름이_없으면_물음표지_UUID_가_아니다():
    text = usage_report.render({
        "day": "d",
        "usage": {"enabled": True, "totals": {"tokens": 1e9},
                  "by_host": [{"source_id": "9f2c1b7e-dead-beef-0000-000000000000", "tokens": 1e9}]},
        "blocked": {}, "dead_sessions": 0,
    })
    assert "9f2c1b7e" not in text


def test_모르는_종류의_로그_줄은_세지_않는다(tmp_path, monkeypatch):
    """옛 형식의 로그는 2번 칸이 명령 전문이다 — 그게 종류 이름처럼 알림에 실려 나갔다."""
    log = tmp_path / "guard.log"
    log.write_text(
        "2026-08-24T09:00:00+09:00\tdeny\tpoll-loop\twhile true; do :; done\n"
        "2026-08-24T09:01:00+09:00\tcd /tmp/probe && claude -p \"...\"\n"   # 옛 형식
        "2026-08-24T09:02:00+09:00\tdeny\tnoop\ttrue\n"
        "2026-08-23T09:03:00+09:00\tdeny\tnoop\ttrue\n",                    # 다른 날
        encoding="utf-8")
    monkeypatch.setattr(usage_report, "POLL_GUARD_LOG", str(log))
    assert usage_report._count_blocked("2026-08-24") == {"poll-loop": 1, "noop": 1}


def test_로그가_없어도_조용히_넘어간다(monkeypatch):
    monkeypatch.setattr(usage_report, "POLL_GUARD_LOG", "/nonexistent/guard.log")
    assert usage_report._count_blocked("2026-08-24") == {}

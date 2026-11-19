"""Terminator help companion: reply parsing, the request it sends, memory and limits."""
from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from routes import terminator as t

POINTS = ["settings", "pane-split"]


def test_reply_reads_tags_keeps_only_known_ids_and_strips_them():
    data = {"content": [
        {"type": "thinking", "thinking": "…"},
        {"type": "text", "text": "오른쪽으로 나눴습니다.\n\n@do:split-right @offer:split-right, settings,rm-rf,hosts,home\n@point:<img>"},
    ]}
    assert t.read_reply(data, POINTS) == {"text": "오른쪽으로 나눴습니다.", "did": "split-right",
                                          "offer": ["settings", "hosts", "home"], "point": None}


def test_reply_without_tags_is_just_text():
    data = {"content": [{"type": "text", "text": "설정은 톱니바퀴입니다."}, "junk",
                        {"type": "tool_use", "name": "ui", "input": {"do": "new-tab"}}]}
    assert t.read_reply(data, POINTS) == {"text": "설정은 톱니바퀴입니다.", "did": None, "offer": [], "point": None}


def test_a_point_tag_must_name_a_guide_id():
    data = {"content": [{"type": "text", "text": "여기입니다.\n@point:settings"}]}
    assert t.read_reply(data, POINTS)["point"] == "settings"


def test_point_ids_come_from_the_guide():
    ids = t.guide_ids(t._guide())
    assert "settings" in ids and "pane-split" in ids


class _FakeResponse:
    def __init__(self, data):
        self._data = data

    def raise_for_status(self):
        return None

    def json(self):
        return self._data


@pytest.fixture
def fake_glm(monkeypatch):
    sent = []

    class Client:
        def __init__(self, timeout):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, json, headers):
            sent.append(json)
            return _FakeResponse({"content": [
                {"type": "text", "text": "새 터미널을 열었습니다.\n@do:new-tab"}],
                "usage": {"input_tokens": 1500, "output_tokens": 20}})

    monkeypatch.setattr(t.httpx, "AsyncClient", Client)
    monkeypatch.setattr(t, "_key", lambda: "k")
    for store in (t._history, t._shown, t._calls):
        store.clear()
    return sent


def _say(text, user="u"):
    return asyncio.run(t.terminator_say(t.SayRequest(text=text), username=user))


def test_one_request_per_message_with_thinking_off_and_no_tools(fake_glm):
    out = _say("터미널 하나 열어줘")
    assert out["reply"]["did"] == "new-tab"
    body = fake_glm[0]
    assert body["model"] == "glm-5.3-flash" and body["thinking"] == {"type": "disabled"}
    assert "tools" not in body                      # a tool definition tripled the latency
    assert "GUIDE:" in body["system"] and "new-tab" in body["system"]
    assert len(fake_glm) == 1


def test_the_model_sees_only_the_last_few_messages(fake_glm):
    for n in range(6):
        _say(f"질문 {n}")
    last = fake_glm[-1]["messages"]
    assert len(last) == t.HISTORY_MESSAGES + 1
    assert last[-1] == {"role": "user", "content": "질문 5"}
    assert all(isinstance(m["content"], str) for m in last)   # no tool_result rounds
    assert all("@do" not in m["content"] for m in last)       # tags never replayed


def test_conversations_are_per_user_and_reset_clears_them(fake_glm):
    _say("a", user="u1")
    _say("b", user="u2")
    assert len(asyncio.run(t.terminator_messages(username="u1"))["messages"]) == 2
    asyncio.run(t.terminator_reset(username="u1"))
    assert asyncio.run(t.terminator_messages(username="u1"))["messages"] == []
    assert len(asyncio.run(t.terminator_messages(username="u2"))["messages"]) == 2


def test_refuses_without_a_key_and_when_flooded(fake_glm, monkeypatch):
    monkeypatch.setattr(t, "_key", lambda: None)
    with pytest.raises(HTTPException) as exc:
        _say("hi")
    assert exc.value.status_code == 409
    monkeypatch.setattr(t, "_key", lambda: "k")
    for _ in range(t.RATE_MAX):
        _say("hi", user="flood")
    with pytest.raises(HTTPException) as exc:
        _say("hi", user="flood")
    assert exc.value.status_code == 429

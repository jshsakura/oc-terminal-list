"""Terminator's key and model: saved as private files, never read back, validated first."""
from __future__ import annotations

import asyncio
import stat

import pytest
from fastapi import HTTPException

import terminator_config as cfg
from routes import terminator as t

KEY = "abcd1234efgh5678.zyxw"


@pytest.fixture(autouse=True)
def config_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(cfg, "CONFIG_DIR", str(tmp_path / "zai"))
    return tmp_path / "zai"


def _put(**body):
    return asyncio.run(t.terminator_config_put(t.ConfigRequest(**body), username="u"))


def test_starts_unset_with_the_default_model():
    assert cfg.describe() == {"configured": False, "key_hint": None,
                              "model": "glm-5.3-flash", "default_model": "glm-5.3-flash"}


def test_key_is_written_private_and_only_its_tail_comes_back(config_dir):
    out = _put(api_key=f"  {KEY}\n")
    assert out["configured"] and out["key_hint"] == "zyxw" and KEY not in str(out)
    path = config_dir / "api_key"
    assert path.read_text().strip() == KEY
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert stat.S_IMODE(config_dir.stat().st_mode) == 0o700
    assert t._key() == KEY


def test_model_can_change_and_an_empty_field_goes_back_to_default():
    assert _put(model="GLM-5.3")["model"] == "glm-5.3"
    assert _put(model="")["model"] == "glm-5.3-flash"


def test_clearing_removes_the_key():
    _put(api_key=KEY)
    assert _put(clear_key=True)["configured"] is False


@pytest.mark.parametrize("body", [{"api_key": "short"}, {"api_key": "has space in it 1234567"},
                                  {"model": "rm -rf /"}, {"api_key": KEY, "model": "Bad Model!"}])
def test_bad_values_are_refused_and_nothing_is_half_saved(body):
    with pytest.raises(HTTPException) as exc:
        _put(**body)
    assert exc.value.status_code == 400
    assert cfg.describe()["configured"] is False


def test_say_uses_the_chosen_model(monkeypatch):
    sent = []

    class Resp:
        def raise_for_status(self):
            return None

        def json(self):
            return {"content": [{"type": "text", "text": "네."}]}

    class Client:
        def __init__(self, timeout):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, json, headers):
            sent.append((json, headers))
            return Resp()

    monkeypatch.setattr(t.httpx, "AsyncClient", Client)
    _put(api_key=KEY, model="glm-5.3")
    for store in (t._history, t._shown, t._calls):
        store.clear()
    asyncio.run(t.terminator_say(t.SayRequest(text="hi"), username="m"))
    out = asyncio.run(t.terminator_check(username="m"))
    assert [b["model"] for b, _ in sent] == ["glm-5.3", "glm-5.3"]
    assert sent[1][0]["max_tokens"] <= 8 and sent[0][1]["x-api-key"] == KEY
    assert out["ok"] and out["model"] == "glm-5.3"


def test_check_without_a_key_is_409():
    with pytest.raises(HTTPException) as exc:
        asyncio.run(t.terminator_check(username="n"))
    assert exc.value.status_code == 409

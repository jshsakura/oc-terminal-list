"""Exchange rates: fetched once a day, and never able to break the dashboard."""
import json
import time

import pytest

from llm_usage import fx


class FakeStorage:
    def __init__(self, initial=None):
        self.data = dict(initial or {})

    async def get_config(self, key):
        return self.data.get(key)

    async def set_config(self, key, value):
        self.data[key] = value


@pytest.fixture()
def store(monkeypatch):
    fake = FakeStorage()
    monkeypatch.setattr(fx, "storage", fake)
    return fake


@pytest.mark.anyio
async def test_fresh_cache_is_reused_without_fetching(store, monkeypatch):
    store.data[fx.FX_CONFIG_KEY] = json.dumps({"at": time.time(), "rates": {"KRW": 1400.0}})

    async def boom():
        raise AssertionError("must not hit the network while the cache is fresh")

    monkeypatch.setattr(fx, "_fetch", boom)
    assert await fx.get_rates() == {"KRW": 1400.0}


@pytest.mark.anyio
async def test_expired_cache_refetches_and_stores(store, monkeypatch):
    store.data[fx.FX_CONFIG_KEY] = json.dumps(
        {"at": time.time() - fx.FX_TTL_SECONDS - 1, "rates": {"KRW": 1000.0}}
    )

    async def fake_fetch():
        return {"KRW": 1423.6}

    monkeypatch.setattr(fx, "_fetch", fake_fetch)
    assert await fx.get_rates() == {"KRW": 1423.6}
    assert json.loads(store.data[fx.FX_CONFIG_KEY])["rates"] == {"KRW": 1423.6}


@pytest.mark.anyio
async def test_failed_fetch_falls_back_to_a_stale_rate(store, monkeypatch):
    """A day-old rate still shows the right order of magnitude. Bare USD is the
    fallback of last resort, not the first response to a flaky network."""
    store.data[fx.FX_CONFIG_KEY] = json.dumps(
        {"at": time.time() - fx.FX_TTL_SECONDS - 1, "rates": {"KRW": 1000.0}}
    )

    async def fake_fetch():
        return None

    monkeypatch.setattr(fx, "_fetch", fake_fetch)
    assert await fx.get_rates() == {"KRW": 1000.0}


@pytest.mark.anyio
async def test_no_cache_and_no_network_means_no_rates(store, monkeypatch):
    async def fake_fetch():
        return None

    monkeypatch.setattr(fx, "_fetch", fake_fetch)
    assert await fx.get_rates() == {}


@pytest.mark.anyio
async def test_corrupt_cache_is_ignored(store, monkeypatch):
    store.data[fx.FX_CONFIG_KEY] = "not json"

    async def fake_fetch():
        return {"KRW": 1400.0}

    monkeypatch.setattr(fx, "_fetch", fake_fetch)
    assert await fx.get_rates() == {"KRW": 1400.0}

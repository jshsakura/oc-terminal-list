from types import SimpleNamespace

from passkey import derive_rp_info
from rate_limit import client_ip_from_request


def _request(headers=None, client_host="10.0.0.10", scheme="http", netloc="app.local:38822"):
    return SimpleNamespace(
        headers=headers or {},
        client=SimpleNamespace(host=client_host),
        url=SimpleNamespace(scheme=scheme, netloc=netloc),
    )


def test_client_ip_ignores_forwarded_for_by_default(monkeypatch):
    monkeypatch.delenv("TRUST_PROXY_HEADERS", raising=False)
    req = _request(headers={"x-forwarded-for": "203.0.113.1"})

    assert client_ip_from_request(req) == "10.0.0.10"


def test_client_ip_uses_forwarded_for_when_enabled(monkeypatch):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    req = _request(headers={"x-forwarded-for": "203.0.113.1, 10.0.0.2"})

    assert client_ip_from_request(req) == "203.0.113.1"


def test_passkey_rp_info_ignores_forwarded_host_by_default(monkeypatch):
    monkeypatch.delenv("TRUST_PROXY_HEADERS", raising=False)
    req = _request(
        headers={
            "host": "app.local:38822",
            "x-forwarded-host": "evil.example",
            "x-forwarded-proto": "https",
        },
        scheme="http",
    )

    rp_id, origin = derive_rp_info(req)

    assert rp_id == "app.local"
    assert origin == "http://app.local:38822"


def test_passkey_rp_info_uses_forwarded_host_when_enabled(monkeypatch):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    req = _request(
        headers={
            "host": "internal:38822",
            "x-forwarded-host": "app.example.com",
            "x-forwarded-proto": "https",
        },
        scheme="http",
    )

    rp_id, origin = derive_rp_info(req)

    assert rp_id == "app.example.com"
    assert origin == "https://app.example.com"

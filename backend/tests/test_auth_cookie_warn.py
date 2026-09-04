"""기동 경고를 요청 시점으로 옮긴 것에 대한 회귀 테스트."""
import importlib
import logging
import sys
import types

sys.path.insert(0, "backend")


def _request(scheme="http", forwarded=None):
    headers = {"x-forwarded-proto": forwarded} if forwarded else {}
    return types.SimpleNamespace(
        url=types.SimpleNamespace(scheme=scheme),
        headers=types.SimpleNamespace(get=lambda k, d="": headers.get(k, d)),
    )


def _fresh(monkeypatch, **env):
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    import auth_cookie
    return importlib.reload(auth_cookie)


def test_the_default_deployment_is_silent_at_boot(monkeypatch, caplog):
    """auto + 프록시 미신뢰는 표준 배포의 기본값이다. 재시작마다 경고하면 안 읽힌다."""
    with caplog.at_level(logging.WARNING):
        _fresh(monkeypatch, AUTH_COOKIE_SECURE="auto", TRUST_PROXY_HEADERS="0")
    assert "TRUST_PROXY_HEADERS" not in caplog.text


def test_it_warns_when_a_proxy_actually_terminates_https(monkeypatch, caplog):
    """진짜 위험한 구성은 요청이 와야 보인다. 그때는 말해야 한다."""
    m = _fresh(monkeypatch, AUTH_COOKIE_SECURE="auto", TRUST_PROXY_HEADERS="0")
    with caplog.at_level(logging.WARNING):
        m._resolve_auth_cookie_secure(_request(forwarded="https"))
        m._resolve_auth_cookie_secure(_request(forwarded="https"))
    assert caplog.text.count("TRUST_PROXY_HEADERS=0") == 1   # 한 번만


def test_plain_http_without_a_proxy_stays_silent(monkeypatch, caplog):
    m = _fresh(monkeypatch, AUTH_COOKIE_SECURE="auto", TRUST_PROXY_HEADERS="0")
    with caplog.at_level(logging.WARNING):
        m._resolve_auth_cookie_secure(_request())
    assert caplog.text == ""

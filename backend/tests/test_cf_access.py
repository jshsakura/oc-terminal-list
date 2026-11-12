"""Real RSA signatures at the ASGI boundary; only the certs transport is replaced."""
from __future__ import annotations

import time

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Depends, FastAPI, WebSocket, WebSocketDisconnect
from starlette.testclient import TestClient, WebSocketDenialResponse

from _deps import verify_auth_token
from auth_sessions import current_session
from cf_access import AccessConfigurationError, AccessSettings, AccessVerifier, CloudflareAccessMiddleware
from routes.auth import router as auth_router
from ws_auth import authenticate_ws

ISSUER = 'https://test-team.cloudflareaccess.com'
AUDIENCE = 'test-application-audience'


@pytest.fixture(autouse=True)
def isolated_environment(monkeypatch):
    for name in ('CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'CF_ACCESS_ALLOWED_EMAILS', 'ALLOWED_ORIGINS'):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture(scope='module')
def keys():
    return [rsa.generate_private_key(public_exponent=65537, key_size=2048) for _ in range(2)]


def token(keys, *, signer=0, kid='first', remove=(), **changes):
    claims = {'iss': ISSUER, 'aud': [AUDIENCE], 'exp': int(time.time()) + 300,
              'email': 'owner@example.com', **changes}
    for name in remove:
        claims.pop(name, None)
    return jwt.encode(claims, keys[signer], algorithm='RS256', headers={'kid': kid})


class Certs:
    def __init__(self, keys):
        self.keys = keys
        self.visible = [(0, 'first')]
        self.calls = 0
        self.down = False

    def handle(self, request):
        assert str(request.url) == ISSUER + '/cdn-cgi/access/certs'
        self.calls += 1
        if self.down:
            return httpx.Response(503)
        jwks = [{**jwt.algorithms.RSAAlgorithm.to_jwk(self.keys[index].public_key(), as_dict=True),
                 'kid': kid, 'alg': 'RS256', 'use': 'sig'} for index, kid in self.visible]
        return httpx.Response(200, json={'keys': jwks})


def make_app(keys, *, allowed=frozenset(), root_path=''):
    certs = Certs(keys)

    async def admin():
        return 'existing-admin'

    verifier = AccessVerifier(AccessSettings(ISSUER, AUDIENCE, allowed),
                              transport=httpx.MockTransport(certs.handle), resolve_username=admin)
    app = FastAPI(root_path=root_path)
    app.include_router(auth_router)

    @app.get('/api/health')
    @app.get('/assets/test.js')
    async def health():
        return {'status': 'running'}

    @app.get('/api/private')
    @app.post('/api/mutate')
    async def private(username: str = Depends(verify_auth_token)):
        return {'username': username, 'session': current_session.get().session_id}

    @app.websocket('/ws/test')
    async def socket(ws: WebSocket):
        username = await authenticate_ws(ws, '/ws/test', ws.query_params.get('ticket'))
        if username is None:
            await ws.close(code=1008)
            return
        await ws.accept()
        await ws.send_json({'username': username, 'session': current_session.get().session_id})
        try:
            while True:
                await ws.receive_text()
        except WebSocketDisconnect:
            return

    app.add_middleware(CloudflareAccessMiddleware, verifier=verifier)
    return app, certs, verifier


@pytest.mark.parametrize('path', ['/api/health', '/api/private', '/assets/test.js', '/api/auth/status', '/', '/unknown'])
def test_missing_assertion_blocks_every_http_path(keys, path):
    app, certs, _ = make_app(keys)
    with TestClient(app) as client:
        response = client.get(path, headers={'authorization': 'Bearer local-token'},
                              cookies={'iterm_auth': 'local-cookie'})
    assert response.status_code == 401
    assert certs.calls == 0


@pytest.mark.parametrize('changes', [{'signer': 1}, {'exp': 1}, {'aud': ['wrong']}, {'iss': 'wrong'},
                                     {'remove': ['exp']}, {'remove': ['aud']}, {'remove': ['iss']}])
def test_invalid_assertions_reject_http_and_ws(keys, changes):
    app, _, _ = make_app(keys)
    headers = {'Cf-Access-Jwt-Assertion': token(keys, **changes)}
    with TestClient(app) as client:
        assert client.get('/api/private', headers=headers).status_code == 401
        with pytest.raises(WebSocketDenialResponse) as denied:
            with client.websocket_connect('/ws/test?ticket=local-ticket', headers=headers):
                pytest.fail('invalid assertion opened a WebSocket')
        assert denied.value.status_code == 401


def test_missing_assertion_rejects_ws_despite_local_cookie_and_ticket(keys):
    app, _, _ = make_app(keys)
    with TestClient(app) as client:
        client.cookies.set('iterm_auth', 'local-token')
        with pytest.raises(WebSocketDenialResponse) as denied:
            with client.websocket_connect('/ws/test?ticket=local-ticket'):
                pytest.fail('missing assertion opened a WebSocket')
        assert denied.value.status_code == 401


def test_verified_header_bootstraps_admin_without_setup_or_local_cookie(keys):
    app, certs, _ = make_app(keys)
    with TestClient(app) as client:
        client.headers['Cf-Access-Jwt-Assertion'] = token(keys)
        assert client.get('/api/auth/status').json() == {
            'setup_complete': True, 'passkey_available': False, 'auth_mode': 'cloudflare_access'}
        identity = client.get('/api/private').json()
        assert identity['username'] == 'existing-admin'
        assert identity['session'].startswith('cf:')
        assert client.get('/assets/test.js').status_code == 200
        assert client.get('/api/auth/verify').json()['username'] == 'existing-admin'
        assert client.post('/api/auth/refresh').json()['auth_mode'] == 'cloudflare_access'
        assert not client.cookies.get('iterm_auth')
        with client.websocket_connect('/ws/test') as ws:
            assert ws.receive_json() == identity
        assert certs.calls == 1


def test_cookie_fallback_never_overrides_a_present_invalid_header(keys):
    app, _, _ = make_app(keys)
    with TestClient(app) as client:
        client.cookies.set('CF_Authorization', token(keys))
        assert client.get('/api/private').status_code == 200
        with client.websocket_connect('/ws/test') as ws:
            assert ws.receive_json()['username'] == 'existing-admin'
        for value in ('', 'not-a-jwt'):
            assert client.get('/api/private', headers={'Cf-Access-Jwt-Assertion': value}).status_code == 401


def test_email_allowlist_uses_verified_claim_not_identity_header(keys):
    app, _, _ = make_app(keys, allowed=frozenset({'owner@example.com'}))
    with TestClient(app) as client:
        assert client.get('/api/private', headers={
            'Cf-Access-Jwt-Assertion': token(keys, email='OWNER@EXAMPLE.COM')}).status_code == 200
        for email in ('other@example.com', None):
            assert client.get('/api/private', headers={
                'Cf-Access-Jwt-Assertion': token(keys, email=email),
                'Cf-Access-Authenticated-User-Email': 'owner@example.com'}).status_code == 401


def test_unknown_kid_refreshes_and_cached_keys_avoid_network(keys):
    app, certs, _ = make_app(keys)
    with TestClient(app) as client:
        assert client.get('/api/private', headers={'Cf-Access-Jwt-Assertion': token(keys)}).status_code == 200
        certs.visible.append((1, 'second'))
        headers = {'Cf-Access-Jwt-Assertion': token(keys, signer=1, kid='second')}
        assert client.get('/api/private', headers=headers).status_code == 200
        assert client.get('/api/private', headers=headers).status_code == 200
        assert certs.calls == 2
        for index in range(5):
            assert client.get('/api/private', headers={
                'Cf-Access-Jwt-Assertion': token(keys, kid=f'unknown-{index}')}).status_code == 401
        assert certs.calls == 2


def test_certs_outage_after_cache_expiry_does_not_fail_open(keys):
    app, certs, verifier = make_app(keys)
    with TestClient(app) as client:
        headers = {'Cf-Access-Jwt-Assertion': token(keys)}
        assert client.get('/api/private', headers=headers).status_code == 200
        verifier._expires_at = 0
        certs.down = True
        assert client.get('/api/private', headers=headers).status_code == 401


@pytest.mark.parametrize('path', ['/api/auth/setup', '/api/auth/login', '/api/auth/otp/verify',
                                 '/api/auth/passkey/login/begin', '/api/auth/change-password'])
def test_local_authentication_routes_are_disabled(keys, path):
    app, _, _ = make_app(keys)
    with TestClient(app) as client:
        assert client.post(path, headers={'Cf-Access-Jwt-Assertion': token(keys)}, json={}).status_code == 403


def test_prefixed_auth_routes_cannot_bypass_external_auth_mode(keys):
    app, _, _ = make_app(keys, root_path='/terminal')
    with TestClient(app) as client:
        client.headers['Cf-Access-Jwt-Assertion'] = token(keys)
        assert client.get('/terminal/api/private').status_code == 200
        assert client.post('/terminal/api/auth/setup', json={
            'username': 'new-admin', 'password': 'synthetic-password'}).status_code == 403


def test_cross_origin_cookie_cannot_mutate_or_open_ws(keys):
    app, _, _ = make_app(keys)
    with TestClient(app) as client:
        client.cookies.set('CF_Authorization', token(keys))
        assert client.post('/api/mutate', headers={'Origin': 'https://evil.example'}).status_code == 403
        assert client.post('/api/mutate', headers={'Origin': 'https://testserver'}).status_code == 200
        with pytest.raises(WebSocketDenialResponse) as denied:
            with client.websocket_connect('/ws/test', headers={'Origin': 'https://evil.example'}):
                pytest.fail('cross-origin cookie opened a WebSocket')
        assert denied.value.status_code == 403


def test_ws_closes_when_assertion_expires(keys):
    app, _, _ = make_app(keys)
    with TestClient(app) as client:
        with client.websocket_connect('/ws/test', headers={
                'Cf-Access-Jwt-Assertion': token(keys, exp=int(time.time()) + 2)}) as ws:
            assert ws.receive_json()['username'] == 'existing-admin'
            assert ws.receive()['code'] == 1008


def test_unconfigured_middleware_preserves_plain_requests(monkeypatch):
    monkeypatch.delenv('CF_ACCESS_TEAM_DOMAIN', raising=False)
    monkeypatch.delenv('CF_ACCESS_AUD', raising=False)
    app = FastAPI()

    @app.get('/api/health')
    async def health():
        return {'status': 'running'}

    app.add_middleware(CloudflareAccessMiddleware)
    with TestClient(app) as client:
        assert client.get('/api/health').status_code == 200


@pytest.mark.parametrize('domain', ['http://test.cloudflareaccess.com', 'https://evil.example',
                                  'https://test.cloudflareaccess.com/path', 'https://user:pass@test.cloudflareaccess.com'])
def test_domain_cannot_be_an_arbitrary_key_url(monkeypatch, domain):
    monkeypatch.setenv('CF_ACCESS_TEAM_DOMAIN', domain)
    monkeypatch.setenv('CF_ACCESS_AUD', AUDIENCE)
    with pytest.raises(AccessConfigurationError):
        AccessSettings.from_env()


def test_partial_configuration_does_not_fall_back_to_local_auth(monkeypatch):
    monkeypatch.setenv('CF_ACCESS_TEAM_DOMAIN', 'test.cloudflareaccess.com')
    monkeypatch.delenv('CF_ACCESS_AUD', raising=False)
    with pytest.raises(AccessConfigurationError):
        AccessSettings.from_env()

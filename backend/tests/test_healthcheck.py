"""Health probing keeps Access protected; a local probe never needs a user JWT."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.error import HTTPError

import pytest

from healthcheck import check


@contextmanager
def server(status):
    paths = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 - HTTP handler API
            paths.append(self.path)
            self.send_response(status)
            self.end_headers()

        def log_message(self, *_args):
            return

    instance = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = Thread(target=instance.serve_forever, daemon=True)
    thread.start()
    try:
        yield instance.server_port, paths
    finally:
        instance.shutdown()
        instance.server_close()
        thread.join()


def test_local_mode_checks_the_health_endpoint(monkeypatch):
    monkeypatch.delenv('CF_ACCESS_TEAM_DOMAIN', raising=False)
    monkeypatch.delenv('CF_ACCESS_AUD', raising=False)
    with server(200) as (port, paths):
        monkeypatch.setenv('APP_PORT', str(port))
        check()
        assert paths == ['/api/health']


def test_local_mode_does_not_accept_an_http_failure(monkeypatch):
    monkeypatch.delenv('CF_ACCESS_TEAM_DOMAIN', raising=False)
    monkeypatch.delenv('CF_ACCESS_AUD', raising=False)
    with server(500) as (port, _paths):
        monkeypatch.setenv('APP_PORT', str(port))
        with pytest.raises(HTTPError):
            check()


def test_access_probe_uses_tcp_without_creating_an_unauthenticated_http_route(monkeypatch):
    monkeypatch.setenv('CF_ACCESS_TEAM_DOMAIN', 'test.cloudflareaccess.com')
    monkeypatch.setenv('CF_ACCESS_AUD', 'test-audience')
    with server(401) as (port, paths):
        monkeypatch.setenv('APP_PORT', str(port))
        check()
        assert paths == []

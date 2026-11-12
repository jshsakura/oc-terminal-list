"""Container liveness without exempting an HTTP route from Access validation."""
from __future__ import annotations

import os
import socket
import urllib.request
from urllib.error import HTTPError


def check() -> None:
    port = int(os.getenv("APP_PORT", "38822"))
    if os.getenv("CF_ACCESS_TEAM_DOMAIN", "").strip() and os.getenv("CF_ACCESS_AUD", "").strip():
        with socket.create_connection(("127.0.0.1", port), timeout=3):
            return
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=3) as response:
        if response.status != 200:
            raise HTTPError(response.url, response.status, "Application health endpoint failed", response.headers, None)


if __name__ == "__main__":
    check()

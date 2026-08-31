"""This server's own reachable address — for the pane's copyable session handle.

Why it cannot come from the browser: `window.location.hostname` is the address a
human opened in a browser. Behind the Cloudflare tunnel that is a public web domain
with no SSH on it, and on the loopback deploy it is literally `localhost` — pasting
either into another machine's agent points at the wrong box. The backend is the only
side that knows where it actually runs.

Tailscale wins when present: it is the address that works from anywhere on the tailnet,
which is exactly the situation where you paste a handle into a different machine. The
LAN address is the fallback, and it is honest about being LAN-only.
"""
from __future__ import annotations

import asyncio
import json
import logging
import shutil
import socket
import time

logger = logging.getLogger(__name__)

# Addresses change when an interface comes up or tailscale reconnects — rare, but not
# never. A short TTL keeps the handle correct without shelling out on every copy.
_TTL_SEC = 60.0
_TAILSCALE_TIMEOUT_SEC = 3.0
_cache: dict = {"at": 0.0, "value": None}
_lock = asyncio.Lock()


async def _tailscale_self_ip() -> str:
    """This node's tailnet IPv4, or '' when tailscale is absent/down."""
    if not shutil.which("tailscale"):
        return ""
    try:
        proc = await asyncio.create_subprocess_exec(
            "tailscale", "status", "--json",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            stdin=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=_TAILSCALE_TIMEOUT_SEC)
        if proc.returncode != 0:
            return ""
        data = json.loads(stdout.decode("utf-8", errors="replace"))
    except (TimeoutError, OSError, json.JSONDecodeError) as e:
        logger.debug("tailscale self ip lookup failed: %s", e)
        return ""
    ips = (data.get("Self") or {}).get("TailscaleIPs") or []
    # Prefer IPv4 — a bare IPv6 literal needs brackets in most places it gets pasted.
    return next((ip for ip in ips if ":" not in ip), ips[0] if ips else "")


def _lan_ip() -> str:
    """Primary outbound-facing IPv4. No packet is sent — connect() on UDP only picks a route."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return ""
    finally:
        sock.close()




async def get_server_identity() -> dict:
    """`{hostname, ip, ip_kind}` — ip_kind is 'tailscale' | 'lan' | ''.

    Never raises: a handle without an address is worse than none, but a failed copy is
    worse still.
    """
    now = time.monotonic()
    cached = _cache.get("value")
    if cached is not None and now - _cache["at"] < _TTL_SEC:
        return cached
    async with _lock:
        now = time.monotonic()
        cached = _cache.get("value")
        if cached is not None and now - _cache["at"] < _TTL_SEC:
            return cached
        try:
            ts_ip = await _tailscale_self_ip()
            ip = ts_ip or await asyncio.to_thread(_lan_ip)
            value = {
                "hostname": socket.gethostname(),
                "ip": ip,
                "ip_kind": "tailscale" if ts_ip else ("lan" if ip else ""),
            }
        except Exception as e:
            logger.debug("server identity lookup failed: %s", e)
            value = {"hostname": "", "ip": "", "ip_kind": ""}
        _cache["value"] = value
        _cache["at"] = now
        return value

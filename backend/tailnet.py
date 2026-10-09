"""Tailnet peer diagnosis — the other half of "no response".

When a connection to a 100.64.0.0/10 (CGNAT) address fails, whether that peer has
dropped out of the tailnet is answerable by asking the *local* tailscaled — no remote
round trip. Skip the question and all the user is left with is "응답 없음 (15초 시간
초과)", which says nothing about whether to look at the router, the password, the
firewall, or this app. A Raspberry Pi that fell off the tailnet on an expired node key
was undiagnosable from that sentence alone (2026-10-10).

Rules:
- Judge by ADDRESS, not by `auth_method`. Hosts registered as plain SSH can still be
  reached over the tailnet, and that was exactly the case that bit us.
- Unknown is None, never "fine". A failed diagnosis that reports health would bury the
  real reason.
- Never raise. This runs inside an error path; a broken diagnosis must not replace the
  error it was meant to explain.
"""
from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
from datetime import UTC, datetime

logger = logging.getLogger(__name__)

# The subprocess talks to a local unix socket, so this is a liveness bound, not a
# throughput one. It sits inside an error path that the user is already waiting on.
STATUS_TIMEOUT_SEC = 3.0

# When a host dies, every pane on it fails at roughly the same moment, so the same
# question arrives in a burst. A short TTL plus single-flight keeps that from becoming
# a subprocess storm.
CACHE_TTL_SEC = 10.0

_TAILNET_V4 = ipaddress.ip_network("100.64.0.0/10")
_TAILNET_V6 = ipaddress.ip_network("fd7a:115c:a1e0::/48")

_cache: tuple[float, dict | None] = (0.0, None)
_lock: asyncio.Lock | None = None


def is_tailnet_address(hostname: str | None) -> bool:
    """Does this address route over a tailnet?"""
    host = (hostname or "").strip().rstrip(".").lower()
    if not host:
        return False
    if host.endswith(".ts.net"):
        return True
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False
    return addr in _TAILNET_V4 or addr in _TAILNET_V6


def _normalize(value: str | None) -> str:
    return (value or "").strip().rstrip(".").lower()


def _matches(peer: dict, hostname: str) -> bool:
    wanted = _normalize(hostname)
    if not wanted:
        return False
    if wanted in {_normalize(ip) for ip in peer.get("TailscaleIPs") or ()}:
        return True
    dns_name = _normalize(peer.get("DNSName"))
    if dns_name and wanted == dns_name:
        return True
    # A bare MagicDNS label ("rpi-genie5") stands in for the full name.
    return bool(dns_name) and dns_name.split(".")[0] == wanted


def _format_last_seen(raw: str | None) -> str | None:
    if not raw:
        return None
    try:
        seen = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if seen.year < 2000:  # tailscale writes a zero time for "never"
        return None
    if seen.tzinfo is None:
        seen = seen.replace(tzinfo=UTC)
    return seen.astimezone().strftime("%m-%d %H:%M")


async def _run_status() -> dict | None:
    try:
        proc = await asyncio.create_subprocess_exec(
            "tailscale", "status", "--json",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
    except OSError:
        return None  # no tailscale on this box (or we cannot run it) — nothing to say
    try:
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=STATUS_TIMEOUT_SEC)
    except TimeoutError:
        # wait_for only cancels communicate(); an unkilled child defeats the bound.
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        logger.warning("tailscale status 가 %s초 안에 안 끝났습니다", STATUS_TIMEOUT_SEC)
        return None
    if proc.returncode != 0:
        return None
    try:
        parsed = json.loads(stdout.decode("utf-8", "replace"))
    except (ValueError, UnicodeError):
        return None
    return parsed if isinstance(parsed, dict) else None


async def _load_status() -> dict | None:
    global _cache, _lock
    now = asyncio.get_running_loop().time()
    stamp, cached = _cache
    if cached is not None and now - stamp < CACHE_TTL_SEC:
        return cached
    if _lock is None:
        _lock = asyncio.Lock()
    async with _lock:
        stamp, cached = _cache
        now = asyncio.get_running_loop().time()
        if cached is not None and now - stamp < CACHE_TTL_SEC:
            return cached
        status = await _run_status()
        if status is not None:
            _cache = (now, status)
        return status


def reason_from_status(status: dict | None, hostname: str) -> str | None:
    """Pure core: turn a `tailscale status --json` payload into a user-facing reason.

    Returns None whenever we cannot tell, including when the peer looks healthy — the
    SSH failure is then a real SSH failure and must not be papered over.
    """
    if not isinstance(status, dict):
        return None

    backend_state = status.get("BackendState")
    if backend_state and backend_state != "Running":
        return (
            f"이 서버의 Tailscale 이 멈춰 있습니다 (상태 {backend_state}). "
            "`sudo tailscale up` 으로 올려야 tailnet 주소에 닿습니다."
        )

    peers = status.get("Peer")
    if not isinstance(peers, dict):
        return None

    peer = next((p for p in peers.values() if isinstance(p, dict) and _matches(p, hostname)), None)
    if peer is None:
        return (
            "Tailscale tailnet 에 이 주소의 기기가 없습니다. "
            "tailnet 에서 제거됐는지 어드민 콘솔에서 확인합니다."
        )

    name = peer.get("HostName") or hostname
    if peer.get("Expired"):
        return (
            f"{name} 의 Tailscale 노드 키가 만료돼 tailnet 에서 빠져 있습니다. "
            "어드민 콘솔에서 키 만료를 끄거나 그 기기에서 `tailscale up` 을 실행합니다."
        )
    if peer.get("Online") is False:
        seen = _format_last_seen(peer.get("LastSeen"))
        when = f" (마지막 접속 {seen})" if seen else ""
        return (
            f"{name} 이 Tailscale tailnet 에서 오프라인입니다{when}. "
            "그 기기의 전원과 네트워크를 확인합니다."
        )
    return None


async def describe_peer(hostname: str | None) -> str | None:
    """Why a tailnet address is unreachable, or None when we cannot tell."""
    try:
        if not is_tailnet_address(hostname):
            return None
        return reason_from_status(await _load_status(), hostname or "")
    except Exception:  # never let the diagnosis replace the error it explains
        logger.debug("tailnet 진단 실패: %s", hostname, exc_info=True)
        return None


def reset_cache() -> None:
    """Tests only."""
    global _cache
    _cache = (0.0, None)

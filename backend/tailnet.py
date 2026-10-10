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


# Kinds where a connection attempt is **physically impossible**, so waiting out the TCP
# timeout buys nothing. `offline` is deliberately NOT one of them: Tailscale's Online flag
# tracks the control plane, and a peer can read offline while a direct path still works —
# short-circuiting on it would make a reachable host unusable.
DEFINITIVE_KINDS = frozenset({"expired", "missing"})


def classify_from_status(status: dict | None, hostname: str) -> tuple[str | None, str | None]:
    """Pure core: `tailscale status --json` → `(kind, 사람이 읽을 사유)`.

    `kind` is one of `backend` / `missing` / `expired` / `offline`, or None when we cannot
    tell — including when the peer looks healthy. An SSH failure against a healthy peer is
    a real SSH failure and must not be papered over.
    """
    if not isinstance(status, dict):
        return None, None

    backend_state = status.get("BackendState")
    if backend_state and backend_state != "Running":
        return "backend", (
            f"이 서버의 Tailscale 이 멈춰 있습니다 (상태 {backend_state}). "
            "`sudo tailscale up` 으로 올려야 tailnet 주소에 닿습니다."
        )

    peers = status.get("Peer")
    if not isinstance(peers, dict):
        return None, None

    peer = next((p for p in peers.values() if isinstance(p, dict) and _matches(p, hostname)), None)
    if peer is None:
        return "missing", (
            "Tailscale tailnet 에 이 주소의 기기가 없습니다. "
            "tailnet 에서 제거됐는지 어드민 콘솔에서 확인합니다."
        )

    name = peer.get("HostName") or hostname
    if peer.get("Expired"):
        return "expired", (
            f"{name} 의 Tailscale 노드 키가 만료돼 tailnet 에서 빠져 있습니다. "
            "어드민 콘솔에서 키 만료를 끄거나 그 기기에서 `tailscale up` 을 실행합니다."
        )
    if peer.get("Online") is False:
        seen = _format_last_seen(peer.get("LastSeen"))
        when = f" (마지막 접속 {seen})" if seen else ""
        return "offline", (
            f"{name} 이 Tailscale tailnet 에서 오프라인입니다{when}. "
            "그 기기의 전원과 네트워크를 확인합니다."
        )
    return None, None


def reason_from_status(status: dict | None, hostname: str) -> str | None:
    """`classify_from_status` 의 사유 절반. 모르면 None."""
    return classify_from_status(status, hostname)[1]


async def describe_peer(hostname: str | None) -> str | None:
    """Why a tailnet address is unreachable, or None when we cannot tell."""
    try:
        if not is_tailnet_address(hostname):
            return None
        return reason_from_status(await _load_status(), hostname or "")
    except Exception:  # never let the diagnosis replace the error it explains
        logger.debug("tailnet 진단 실패: %s", hostname, exc_info=True)
        return None


async def precheck(hostname: str | None) -> str | None:
    """붙어 볼 가치가 없는 경우의 사유, 아니면 None.

    노드 키가 만료됐거나 tailnet 에 아예 없는 기기는 **WireGuard 핸드셰이크 자체가
    불가능**하다. 그걸 알면서 TCP 타임아웃 15초를 기다리는 것은, 사용자에게 "곧 될 것처럼"
    로딩을 15초 보여준 뒤 실패를 말하는 것과 같다.

    ⚠️ **`offline` 로는 끊지 않는다.** 그 플래그는 컨트롤 플레인 기준이라 직접 경로가
       살아 있는데도 offline 으로 보일 수 있다 — 그걸로 끊으면 닿는 호스트를 못 쓰게 만든다.
       (그 경우는 평소대로 붙어 보고, 실패하면 `describe_peer` 가 사유를 붙인다.)
    ⚠️ 진단은 **절대 던지지 않는다.** 여기서 예외가 나면 멀쩡한 연결이 막힌다.
    """
    try:
        if not is_tailnet_address(hostname):
            return None
        kind, reason = classify_from_status(await _load_status(), hostname or "")
        return reason if kind in DEFINITIVE_KINDS else None
    except Exception:
        logger.debug("tailnet precheck 실패: %s", hostname, exc_info=True)
        return None


def reset_cache() -> None:
    """Tests only."""
    global _cache
    _cache = (0.0, None)

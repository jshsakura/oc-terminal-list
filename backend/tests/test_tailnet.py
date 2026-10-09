"""Tailnet 진단 — "응답 없음" 뒤에 왜 응답이 없는지를 붙인다.

노드 키가 만료돼 tailnet 에서 빠진 라즈베리파이를, 앱은 "응답 없음 (15초 시간 초과)"
한 줄로만 알렸다(2026-10-10). 그 문구만으로는 공유기·비밀번호·방화벽·앱 중 무엇을 봐야
하는지 알 수 없다. 여기서 잠그는 것은 셋이다:

1. 판정은 **주소**로 한다 — `auth_method == "tailscale"` 로 가르면 평범한 SSH 로 등록된
   tailnet 호스트를 놓친다(실제로 그 케이스였다).
2. **모르면 None** 이다. 진단 실패를 "정상" 으로 적으면 진짜 사유를 덮는다.
3. 진단은 **절대 던지지 않는다.** 설명하려던 에러를 진단이 대체하면 안 된다.
"""
from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest

import tailnet

# ── 1) 주소로 판정한다 ────────────────────────────────────────────────

@pytest.mark.parametrize("addr", [
    "100.90.58.69",          # CGNAT 범위
    "100.64.0.0",
    "100.127.255.255",
    "fd7a:115c:a1e0::434:3a46",
    "rpi-genie5.tail07bdf2.ts.net",
    "rpi-genie5.tail07bdf2.ts.net.",   # 끝 점 붙은 FQDN
    "RPI-GENIE5.TAIL07BDF2.TS.NET",    # 대문자
])
def test_tailnet_주소를_알아본다(addr):
    assert tailnet.is_tailnet_address(addr) is True


@pytest.mark.parametrize("addr", [
    "192.168.0.10",
    "10.0.0.1",
    "100.63.255.255",        # CGNAT 바로 아래
    "100.128.0.0",           # CGNAT 바로 위
    "8.8.8.8",
    "example.com",
    "",
    None,
])
def test_tailnet_아닌_주소는_안_건드린다(addr):
    assert tailnet.is_tailnet_address(addr) is False


# ── 2) 상태 → 사유 (순수 함수) ────────────────────────────────────────

def _status(peer: dict | None, *, backend_state: str = "Running") -> dict:
    peers = {"nodekey:abc": peer} if peer is not None else {}
    return {"BackendState": backend_state, "Peer": peers}


def _peer(**over) -> dict:
    base = {
        "HostName": "rpi-genie5",
        "DNSName": "rpi-genie5.tail07bdf2.ts.net.",
        "TailscaleIPs": ["100.90.58.69", "fd7a:115c:a1e0::434:3a46"],
        "Online": True,
        "LastSeen": "2026-10-10T02:40:39.867724693+09:00",
    }
    base.update(over)
    return base


def test_노드키_만료는_그렇게_말한다():
    reason = tailnet.reason_from_status(
        _status(_peer(Online=False, Expired=True)), "100.90.58.69")
    assert reason is not None
    assert "노드 키" in reason and "만료" in reason
    assert "rpi-genie5" in reason
    # 사용자가 다음에 할 일이 적혀 있어야 한다.
    assert "tailscale up" in reason or "키 만료" in reason


def test_그냥_오프라인은_마지막_접속을_붙인다():
    reason = tailnet.reason_from_status(
        _status(_peer(Online=False, LastSeen="2026-10-09T12:40:00.1Z")), "100.90.58.69")
    assert reason is not None
    assert "오프라인" in reason
    assert "10-09" in reason          # 마지막 접속이 보여야 한다
    assert "노드 키" not in reason     # 만료가 아닌데 만료로 말하면 안 된다


def test_마지막_접속을_모르면_그_칸만_빠진다():
    reason = tailnet.reason_from_status(
        _status(_peer(Online=False, LastSeen="0001-01-01T00:00:00Z")), "100.90.58.69")
    assert reason is not None
    assert "오프라인" in reason
    assert "마지막 접속" not in reason


def test_피어가_살아_있으면_아무_말도_안_한다():
    """SSH 가 실패했는데 피어가 멀쩡하면 그건 진짜 SSH 실패다 — 덮으면 안 된다."""
    assert tailnet.reason_from_status(_status(_peer(Online=True)), "100.90.58.69") is None


def test_v6_주소와_MagicDNS_이름으로도_찾는다():
    for addr in ("fd7a:115c:a1e0::434:3a46",
                 "rpi-genie5.tail07bdf2.ts.net",
                 "rpi-genie5"):
        reason = tailnet.reason_from_status(
            _status(_peer(Online=False, Expired=True)), addr)
        assert reason is not None, addr


def test_tailnet_에_없는_기기면_그렇게_말한다():
    reason = tailnet.reason_from_status(_status(_peer()), "100.90.58.70")
    assert reason is not None
    assert "없습니다" in reason


def test_이_서버의_tailscale_이_멈춰_있으면_그게_먼저다():
    """내 쪽이 내려가 있으면 모든 tailnet 주소가 실패한다 — 피어 탓으로 읽히면 안 된다."""
    reason = tailnet.reason_from_status(
        _status(_peer(Online=False), backend_state="Stopped"), "100.90.58.69")
    assert reason is not None
    assert "이 서버" in reason and "Stopped" in reason


@pytest.mark.parametrize("status", [None, {}, {"Peer": None}, "nope", 42])
def test_읽을_수_없는_상태는_모른다로_떨어진다(status):
    assert tailnet.reason_from_status(status, "100.90.58.69") is None


# ── 3) describe_peer — 묻지 않을 때는 묻지 않고, 던지지 않는다 ────────

@pytest.mark.asyncio
async def test_tailnet_아닌_주소면_tailscale_을_아예_안_부른다():
    with patch.object(tailnet, "_load_status") as load:
        assert await tailnet.describe_peer("192.168.0.10") is None
        load.assert_not_called()


@pytest.mark.asyncio
async def test_진단이_터져도_던지지_않는다():
    """이 함수는 에러 경로 안에서 돈다. 여기서 던지면 설명하려던 에러가 사라진다."""
    tailnet.reset_cache()
    with patch.object(tailnet, "_load_status", side_effect=RuntimeError("boom")):
        assert await tailnet.describe_peer("100.90.58.69") is None


@pytest.mark.asyncio
async def test_tailscale_이_없는_기계에서는_조용히_모른다():
    tailnet.reset_cache()
    with patch("asyncio.create_subprocess_exec", side_effect=FileNotFoundError):
        assert await tailnet.describe_peer("100.90.58.69") is None


# ── 4) 상한과 캐시 — 한 호스트가 죽으면 질문이 한꺼번에 몰린다 ────────

class _HangingProc:
    returncode = None

    def __init__(self):
        self.killed = False

    async def communicate(self, input=None):
        await asyncio.sleep(10)
        return b"", b""

    def kill(self):
        self.killed = True


@pytest.mark.asyncio
async def test_상한에_걸리면_프로세스를_죽인다():
    """`wait_for` 는 communicate 만 취소한다 — 안 죽이면 상한을 둔 뜻이 없다."""
    tailnet.reset_cache()
    proc = _HangingProc()
    with patch.object(tailnet, "STATUS_TIMEOUT_SEC", 0.01), \
         patch("asyncio.create_subprocess_exec", return_value=proc):
        assert await tailnet.describe_peer("100.90.58.69") is None
    assert proc.killed is True


class _OkProc:
    returncode = 0

    def __init__(self, payload: bytes):
        self.payload = payload

    async def communicate(self, input=None):
        return self.payload, b""


@pytest.mark.asyncio
async def test_동시에_몰려도_tailscale_을_한_번만_부른다():
    """호스트 하나가 죽으면 그 호스트의 pane 전부가 거의 동시에 실패한다."""
    import json as _json
    tailnet.reset_cache()
    calls = 0

    def spawn(*args, **kwargs):
        nonlocal calls
        calls += 1
        payload = _json.dumps(_status(_peer(Online=False, Expired=True))).encode()
        return _OkProc(payload)

    with patch("asyncio.create_subprocess_exec", side_effect=spawn):
        results = await asyncio.gather(*[
            tailnet.describe_peer("100.90.58.69") for _ in range(8)
        ])
    assert all(r and "노드 키" in r for r in results)
    assert calls == 1, f"tailscale status 를 {calls}번 불렀습니다"
    tailnet.reset_cache()


# ── 5) 배선 — 연결 실패 문구에 실제로 붙는가 ──────────────────────────

@pytest.mark.asyncio
async def test_연결_실패_문구에_tailnet_사유가_붙는다():
    """이 테스트가 잠그는 것이 이 기능의 전부다.

    `open_connection` 의 타임아웃 문구는 터미널의 `connect-failed` 와 SFTP 경고가
    **같이** 쓰는 하나의 funnel 이다. 여기에 안 붙으면 사용자는 "응답 없음" 만 본다.
    """
    import host_manager

    host = {
        "hostname": "100.90.58.69",
        "port": 22,
        "ssh_user": "pi",
        "auth_method": "password",
    }
    with patch.object(host_manager.asyncssh, "connect", side_effect=TimeoutError), \
         patch.object(host_manager.tailnet, "describe_peer",
                      return_value="rpi-genie5 의 Tailscale 노드 키가 만료됐습니다."):
        with pytest.raises(host_manager.HostConnectError) as err:
            await host_manager.open_connection(host, password="pw")

    message = str(err.value)
    assert "응답 없음" in message        # 원래 사유는 남아 있어야 한다
    assert "노드 키가 만료" in message    # 그리고 왜 응답이 없는지가 붙는다


@pytest.mark.asyncio
async def test_인증_실패에는_tailnet_진단을_안_붙인다():
    """인증까지 갔으면 닿은 것이다 — tailnet 은 범인이 아니다."""
    import asyncssh

    import host_manager

    host = {
        "hostname": "100.90.58.69",
        "port": 22,
        "ssh_user": "pi",
        "auth_method": "password",
    }
    with patch.object(host_manager.asyncssh, "connect",
                      side_effect=asyncssh.PermissionDenied("bad password")), \
         patch.object(host_manager.tailnet, "describe_peer") as describe:
        with pytest.raises(host_manager.HostConnectError):
            await host_manager.open_connection(host, password="pw")
        describe.assert_not_called()

"""VNC 라우트 계약 검증 — 소유권 거부 + 미설치 호스트 응답.

실제 SSH 는 치지 않는다: storage.get_host 와 runner 만들기를 mock 한다.
- 타인 소유 호스트 → 404 (기존 호스트 라우트와 동일한 경계).
- vncserver 미설치 호스트 → 500 이 아니라 available:true, installed:false.
- SSH 실패 → 500 이 아니라 available:false + error.
"""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from routes import vnc as vnc


def _host(host_id="h1", auth_method="key"):
    return {
        "id": host_id,
        "hostname": "example.com",
        "ssh_user": "ubuntu",
        "auth_method": auth_method,
        "key_id": None,
        "use_remote_tmux": 0,
    }


@pytest.mark.asyncio
async def test_other_users_host_rejected_404():
    """storage.get_host 가 None(타인 소유/존재 X) → 404."""
    with patch.object(vnc.storage, "get_host", AsyncMock(return_value=None)):
        with pytest.raises(HTTPException) as exc:
            await vnc.list_vnc_displays("h1", "alice")
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_uninstalled_returns_available_not_500():
    """vncserver/Xtigervnc 바이너리가 없으면 500 대신 available:true installed:false.

    UI 가 스스로 비활성화하는 데 필요한 계약 (tailscale.py 의 available:false 패턴과 동일).
    """
    host = _host()
    # runner 가 빈 통합 출력을 반환 → 설치도 아니고 디스플레이도 없음.
    fake_runner = AsyncMock(return_value="")
    with patch.object(vnc.storage, "get_host", AsyncMock(return_value=host)), \
         patch.object(vnc, "_make_runner_for", AsyncMock(return_value=fake_runner)):
        res = await vnc.list_vnc_displays("h1", "alice")
    assert res["available"] is True
    assert res["installed"] is False
    assert res["displays"] == []


@pytest.mark.asyncio
async def test_ssh_failure_returns_available_false():
    """runner 가 예외를 던지면 500 대신 available:false + error."""
    host = _host()
    fake_runner = AsyncMock(side_effect=TimeoutError("connect timed out"))
    with patch.object(vnc.storage, "get_host", AsyncMock(return_value=host)), \
         patch.object(vnc, "_make_runner_for", AsyncMock(return_value=fake_runner)):
        res = await vnc.list_vnc_displays("h1", "alice")
    assert res["available"] is False
    assert res["displays"] == []
    assert "timed out" in res["error"]


@pytest.mark.asyncio
async def test_list_passes_discovery_through_runner():
    """runner 결과가 discover() 를 거쳐 디스플레이 목록으로 내려온다."""
    host = _host()
    combined = (
        "__ITL_VNC_X11__\nX1\n"
        "__ITL_VNC_SS__\nLISTEN 0 128 127.0.0.1:5901 0.0.0.0:*\n"
        "__ITL_VNC_PS__\n1234 ubuntu Xtigervnc :1 -geometry 1920x1080\n"
        "__ITL_VNC_WHICH__\n/usr/bin/Xtigervnc\n"
    )
    fake_runner = AsyncMock(return_value=combined)
    with patch.object(vnc.storage, "get_host", AsyncMock(return_value=host)), \
         patch.object(vnc, "_make_runner_for", AsyncMock(return_value=fake_runner)):
        res = await vnc.list_vnc_displays("h1", "alice")
    assert res["installed"] is True
    assert len(res["displays"]) == 1
    assert res["displays"][0]["display"] == 1
    assert res["displays"][0]["geometry"] == "1920x1080"


@pytest.mark.asyncio
async def test_create_session_refuses_without_localhost_yes_injection():
    """geometry 에 셸 메타문자가 들어오면 400 — -localhost yes 가 고정이므로."""
    host = _host()
    fake_runner = AsyncMock(return_value="")
    with patch.object(vnc.storage, "get_host", AsyncMock(return_value=host)), \
         patch.object(vnc, "_make_runner_for", AsyncMock(return_value=fake_runner)):
        req = vnc.CreateSessionRequest(geometry="1280x800; rm -rf /")
        with pytest.raises(HTTPException) as exc:
            await vnc.create_vnc_session("h1", req, "alice")
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_create_session_uninstalled_returns_available():
    """미설치 호스트에서 세션 기동 시도 → 500 대신 installed:false."""
    host = _host()
    fake_runner = AsyncMock(return_value="")  # 아무것도 안 깔림
    with patch.object(vnc.storage, "get_host", AsyncMock(return_value=host)), \
         patch.object(vnc, "_make_runner_for", AsyncMock(return_value=fake_runner)):
        req = vnc.CreateSessionRequest(geometry="1280x800")
        res = await vnc.create_vnc_session("h1", req, "alice")
    assert res["installed"] is False
    assert "installed" in res.get("error", "")

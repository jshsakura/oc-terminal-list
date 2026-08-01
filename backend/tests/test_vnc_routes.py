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


def _turbovnc_combined():
    """TurboVNC 설치 + :1 실행 중인 호스트의 통합 출력."""
    return (
        "__ITL_VNC_X11__\nX1\n"
        "__ITL_VNC_SS__\nLISTEN 0 128 127.0.0.1:5901 0.0.0.0:*\n"
        "__ITL_VNC_PS__\n1234 ubuntu Xvnc :1 -geometry 1920x1080\n"
        "__ITL_VNC_WHICH__\n/opt/TurboVNC/bin/vncserver\n"
    )


def _tigervnc_combined():
    """TigerVNC 설치 + :1 실행 중인 호스트의 통합 출력."""
    return (
        "__ITL_VNC_X11__\nX1\n"
        "__ITL_VNC_SS__\nLISTEN 0 128 127.0.0.1:5901 0.0.0.0:*\n"
        "__ITL_VNC_PS__\n1234 ubuntu Xtigervnc :1 -geometry 1920x1080\n"
        "__ITL_VNC_WHICH__\n/usr/bin/Xtigervnc\n"
    )


@pytest.mark.asyncio
async def test_create_session_turbovnc_uses_boolean_localhost():
    """flavor=turbovnc → ``-localhost`` (불리언 플래그, yes 없음).

    TurboVNC 의 -localhost 는 인자를 받지 않는다. ``yes`` 를 붙이면 Xvnc 가
    ``Unrecognized option: yes`` 로 죽는다.
    """
    host = _host()
    captured = {}

    async def fake_run(cmd):
        captured["cmd"] = cmd
        return ""

    # 첫 호출(discovery)은 turbovnc 통합 출력, 두 번째(실제 기동)는 빈 출력.
    runner_calls = [_turbovnc_combined(), ""]

    async def two_phase_runner(cmd):
        captured["cmd"] = cmd
        return runner_calls.pop(0)

    with patch.object(vnc.storage, "get_host", AsyncMock(return_value=host)), \
         patch.object(vnc, "_make_runner_for", AsyncMock(return_value=two_phase_runner)):
        req = vnc.CreateSessionRequest(geometry="1920x1080", display=2)
        await vnc.create_vnc_session("h1", req, "alice")
    cmd = captured["cmd"]
    assert "-localhost " not in cmd or "-localhost yes" not in cmd  # yes 가 없어야
    assert "-localhost " in cmd or cmd.endswith("-localhost ") or "-localhost -geometry" in cmd
    # TurboVNC: -localhost 다음에 바로 -geometry 가 와야 함 (yes 없음)
    assert "-localhost -geometry" in cmd
    assert "-localhost yes" not in cmd


@pytest.mark.asyncio
async def test_create_session_tigervnc_uses_localhost_yes():
    """flavor=tigervnc → ``-localhost yes`` (TigerVNC 표준 형태)."""
    host = _host()
    captured = {}

    runner_calls = [_tigervnc_combined(), ""]

    async def two_phase_runner(cmd):
        captured["cmd"] = cmd
        return runner_calls.pop(0)

    with patch.object(vnc.storage, "get_host", AsyncMock(return_value=host)), \
         patch.object(vnc, "_make_runner_for", AsyncMock(return_value=two_phase_runner)):
        req = vnc.CreateSessionRequest(geometry="1280x800", display=2)
        await vnc.create_vnc_session("h1", req, "alice")
    cmd = captured["cmd"]
    assert "-localhost yes" in cmd


def test_localhost_flag_helper():
    """_localhost_flag 헬퍼 직접 검증."""
    assert vnc._localhost_flag("turbovnc") == "-localhost"
    assert vnc._localhost_flag("tigervnc") == "-localhost yes"
    assert vnc._localhost_flag("") == "-localhost yes"  # 알 수 없으면 TigerVNC 형태


# ---------------------- GPU 가속 (-vgl + VGL_DISPLAY=egl) ----------------------


def _turbovnc_with_vgl_combined():
    """TurboVNC + VirtualGL 설치된 호스트의 통합 출력."""
    return (
        "__ITL_VNC_X11__\nX1\n"
        "__ITL_VNC_SS__\nLISTEN 0 128 127.0.0.1:5901 0.0.0.0:*\n"
        "__ITL_VNC_PS__\n1234 ubuntu Xvnc :1 -geometry 1920x1080\n"
        "__ITL_VNC_WHICH__\n/opt/TurboVNC/bin/vncserver\n"
        "__ITL_VNC_GPU__\nVGL:/usr/bin/vglrun\nNSMI:yes\nVGA:NVIDIA Corporation ...\n"
    )


def _turbovnc_without_vgl_combined():
    """TurboVNC 설치, VirtualGL 없음."""
    return (
        "__ITL_VNC_X11__\nX1\n"
        "__ITL_VNC_SS__\nLISTEN 0 128 127.0.0.1:5901 0.0.0.0:*\n"
        "__ITL_VNC_PS__\n1234 ubuntu Xvnc :1 -geometry 1920x1080\n"
        "__ITL_VNC_WHICH__\n/opt/TurboVNC/bin/vncserver\n"
        "__ITL_VNC_GPU__\nVGL:\nNSMI:no\nVGA:\n"
    )


def _tigervnc_with_vgl_combined():
    """TigerVNC + VirtualGL — TigerVNC 는 -vgl 미지원."""
    return (
        "__ITL_VNC_X11__\nX1\n"
        "__ITL_VNC_SS__\nLISTEN 0 128 127.0.0.1:5901 0.0.0.0:*\n"
        "__ITL_VNC_PS__\n1234 ubuntu Xtigervnc :1 -geometry 1920x1080\n"
        "__ITL_VNC_WHICH__\n/usr/bin/Xtigervnc\n"
        "__ITL_VNC_GPU__\nVGL:/usr/bin/vglrun\nNSMI:yes\nVGA:NVIDIA Corporation ...\n"
    )


@pytest.mark.asyncio
async def test_create_session_turbovnc_with_vgl_adds_vgl():
    """virtualgl=true + turbovnc → ``-vgl`` + ``VGL_DISPLAY=egl`` + gpu_accelerated:true."""
    host = _host()
    captured = {}
    runner_calls = [_turbovnc_with_vgl_combined(), ""]

    async def two_phase_runner(cmd):
        captured["cmd"] = cmd
        return runner_calls.pop(0)

    with patch.object(vnc.storage, "get_host", AsyncMock(return_value=host)), \
         patch.object(vnc, "_make_runner_for", AsyncMock(return_value=two_phase_runner)):
        req = vnc.CreateSessionRequest(geometry="1920x1080", display=2)
        res = await vnc.create_vnc_session("h1", req, "alice")
    cmd = captured["cmd"]
    assert cmd.startswith("VGL_DISPLAY=egl ")
    assert "-vgl " in cmd
    assert res["gpu_accelerated"] is True


@pytest.mark.asyncio
async def test_create_session_turbovnc_without_vgl_omits_vgl():
    """virtualgl=false + turbovnc → ``-vgl`` 없음, gpu_accelerated:false."""
    host = _host()
    captured = {}
    runner_calls = [_turbovnc_without_vgl_combined(), ""]

    async def two_phase_runner(cmd):
        captured["cmd"] = cmd
        return runner_calls.pop(0)

    with patch.object(vnc.storage, "get_host", AsyncMock(return_value=host)), \
         patch.object(vnc, "_make_runner_for", AsyncMock(return_value=two_phase_runner)):
        req = vnc.CreateSessionRequest(geometry="1280x800", display=2)
        res = await vnc.create_vnc_session("h1", req, "alice")
    cmd = captured["cmd"]
    assert "VGL_DISPLAY" not in cmd
    assert "-vgl" not in cmd
    assert res["gpu_accelerated"] is False


@pytest.mark.asyncio
async def test_create_session_tigervnc_with_vgl_omits_vgl():
    """tigervnc + virtualgl → ``-vgl`` 없음 (TigerVNC 에는 -vgl 자체가 없다)."""
    host = _host()
    captured = {}
    runner_calls = [_tigervnc_with_vgl_combined(), ""]

    async def two_phase_runner(cmd):
        captured["cmd"] = cmd
        return runner_calls.pop(0)

    with patch.object(vnc.storage, "get_host", AsyncMock(return_value=host)), \
         patch.object(vnc, "_make_runner_for", AsyncMock(return_value=two_phase_runner)):
        req = vnc.CreateSessionRequest(geometry="1280x800", display=2)
        res = await vnc.create_vnc_session("h1", req, "alice")
    cmd = captured["cmd"]
    assert "VGL_DISPLAY" not in cmd
    assert "-vgl" not in cmd
    assert res["gpu_accelerated"] is False

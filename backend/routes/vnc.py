"""Xvnc 원격 데스크탑 — 디스커버리 + 세션 기동/종료.

VNC 는 항상 ``-localhost yes``(루프백 바인딩)로 띄운다. 우리는 SSH direct-tcpip
터널 안에서만 접속하므로 루프백이 정상 상태다. 이 플래그를 빼면 VNC 가 인터넷에
그대로 노출되므로 **어떤 경로로도 뺄 수 없게** 명령문에 고정한다.

응답 계약은 routes/tailscale.py 와 동일 — VNC 가 없거나 명령이 실패해도 500 대신
``{"available": false, "displays": [], "error": "..."}`` 로 내려 UI 가 스스로
비활성화하게 한다. 소유권 검증은 기존과 동일하게 ``storage.get_host(host_id, username)``.
"""
from __future__ import annotations

import asyncio
import logging
import re
import shlex

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from _deps import verify_auth_token
from host_manager import open_connection, resolve_host_secrets
from sqlite_storage import storage
from ssh_pool import ssh_pool
from vnc_discovery import gather_discovery

logger = logging.getLogger(__name__)

router = APIRouter(tags=["vnc"])

# -geometry 인자 형태만 허용 (명령 주입 차단).
_GEOMETRY_RE = re.compile(r"^\d+x\d+$")


# ---------------------- runner (key/pass vs tailscale) ----------------------

# 호스트 종류에 따라 runner 를 갈라 만든다. routes/hosts.py 의 분기와 동일.
#   key/password → ssh_pool.run (asyncssh conn 재사용)
#   tailscale    → `tailscale ssh` 서브프로세스 (asyncssh conn 이 없다)


def _make_pool_runner(host: dict, secrets: dict):
    """ssh_pool 기반 runner — key/pass 호스트."""

    async def run(cmd: str) -> str:
        async def _opener():
            return await open_connection(host, **secrets)

        result = await ssh_pool.run(host["id"], _opener, cmd, check=False)
        stdout = result.stdout
        if isinstance(stdout, str):
            return stdout
        return (stdout or b"").decode("utf-8", errors="replace")

    return run


def _make_tailscale_runner(host: dict):
    """`tailscale ssh target cmd` 서브프로세스 runner."""

    async def run(cmd: str) -> str:
        target = f"{host.get('ssh_user') or 'root'}@{host['hostname']}"
        proc = await asyncio.create_subprocess_exec(
            "tailscale", "ssh", target, cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _stderr = await asyncio.wait_for(proc.communicate(), timeout=15)
        return stdout.decode("utf-8", errors="replace")

    return run


async def _make_runner_for(host: dict, username: str):
    """호스트 auth_method 에 맞춰 runner 를 만든다."""
    if host.get("auth_method") == "tailscale":
        return _make_tailscale_runner(host)
    key_record = None
    if host.get("auth_method") == "key" and host.get("key_id"):
        key_record = await storage.get_ssh_key(host["key_id"], username)
    secrets = resolve_host_secrets(host, key_record)
    return _make_pool_runner(host, secrets)


async def _resolve_host_or_404(host_id: str, username: str) -> dict:
    host = await storage.get_host(host_id, username)
    if not host:
        raise HTTPException(status_code=404, detail="호스트를 찾을 수 없습니다")
    return host


# ---------------------- 엔드포인트 ----------------------


@router.get("/api/hosts/{host_id}/vnc/displays")
async def list_vnc_displays(host_id: str, username: str = Depends(verify_auth_token)):
    """해당 호스트의 Xvnc 디스플레이 목록 + 설치 여부.

    SSH 한 번으로 (X11 소켓 / 리스닝 포트 / VNC 프로세스 / 바이너리) 를 모두 긁어
    파싱한다. 응답 계약: ``{available, installed, displays: [...]}``. 실패 시
    ``available: false`` + ``error``.
    """
    host = await _resolve_host_or_404(host_id, username)
    runner = await _make_runner_for(host, username)
    return await gather_discovery(runner)


class CreateSessionRequest(BaseModel):
    geometry: str = "1280x800"
    display: int | None = None


@router.post("/api/hosts/{host_id}/vnc/sessions")
async def create_vnc_session(
    host_id: str,
    request: CreateSessionRequest,
    username: str = Depends(verify_auth_token),
):
    """새 가상 데스크탑 기동 — ``vncserver -localhost yes -geometry <WxH> :<N>``.

    display 를 주지 않으면 현재 사용 중인 번호를 피해 1..99 중 빈 번호를 고른다.
    ``-localhost yes`` 는 필수(인터넷 노출 차단)이므로 고정 문자열로 박아둔다.
    """
    host = await _resolve_host_or_404(host_id, username)

    geometry = (request.geometry or "1280x800").strip()
    if not _GEOMETRY_RE.fullmatch(geometry):
        # 입력 검증은 SSH 왕복 전에 — 잘못된 형식이면 명령 주입 위헌 원천 차단.
        raise HTTPException(status_code=400, detail="geometry 형식은 WxH 여야 합니다")

    runner = await _make_runner_for(host, username)

    state = await gather_discovery(runner)
    if not state.get("available"):
        return state  # available:false + error 그대로 전달
    if not state.get("installed"):
        return {
            "available": True,
            "installed": False,
            "error": "vncserver not installed on host",
        }

    used = {d["display"] for d in state.get("displays", [])}
    chosen = request.display
    if chosen is None:
        chosen = next((n for n in range(1, 100) if n not in used), None)
    if chosen is None:
        raise HTTPException(status_code=409, detail="사용 가능한 디스플레이 번호가 없습니다")
    chosen = int(chosen)

    # -localhost yes 는 절대 빠지면 안 된다 — 빠지면 VNC 가 인터넷에 노출된다.
    # TurboVNC 처럼 PATH 밖에 설치된 vncserver 도 잡기 위해 디스커버리에서
    # 찾은 경로를 쓰고, 없으면 폴백으로 "vncserver" 를 쓴다.
    safe_geom = shlex.quote(geometry)
    vncserver_path = state.get("vncserver_path") or "vncserver"
    cmd = f"{shlex.quote(vncserver_path)} -localhost yes -geometry {safe_geom} :{chosen}"
    try:
        output = await runner(cmd)
    except Exception as e:
        logger.warning("vnc create failed (%s:%s): %s", host_id, chosen, e)
        return {"available": False, "installed": True, "error": str(e)}

    return {
        "available": True,
        "installed": True,
        "display": chosen,
        "port": 5900 + chosen,
        "geometry": geometry,
        "output": output[-500:] if isinstance(output, str) else "",
    }


@router.delete("/api/hosts/{host_id}/vnc/sessions/{display}")
async def delete_vnc_session(
    host_id: str,
    display: int,
    username: str = Depends(verify_auth_token),
):
    """가상 데스크탑 종료 — ``vncserver -kill :<N>``."""
    host = await _resolve_host_or_404(host_id, username)
    if display < 0 or display > 99:
        raise HTTPException(status_code=400, detail="잘못된 디스플레이 번호")
    runner = await _make_runner_for(host, username)
    # TurboVNC 의 vncserver 가 PATH 에 없을 수 있으니 경로를 먼저 찾는다.
    state = await gather_discovery(runner)
    vncserver_path = state.get("vncserver_path") or "vncserver"
    # display 는 int 로 강제되므로 안전. 그래도 포맷 고정.
    cmd = f"{shlex.quote(vncserver_path)} -kill :{int(display)}"
    try:
        output = await runner(cmd)
    except Exception as e:
        logger.warning("vnc kill failed (%s:%s): %s", host_id, display, e)
        return {"available": False, "error": str(e)}
    return {
        "available": True,
        "display": int(display),
        "port": 5900 + int(display),
        "status": "killed",
        "output": output[-500:] if isinstance(output, str) else "",
    }

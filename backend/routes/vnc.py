"""Xvnc 원격 데스크탑 — 디스커버리 + 세션 기동/종료.

VNC 는 항상 루프백 바인딩으로 띄운다. 우리는 SSH direct-tcpip 터널 안에서만
접속하므로 루프백이 정상 상태다. 이 플래그를 빼면 VNC 가 인터넷에 그대로 노출되므로
**어떤 경로로도 뺄 수 없게** 명령문에 고정한다.

flavor 에 따라 표기가 다르다: TigerVNC 는 ``-localhost yes``, TurboVNC 는
``-localhost``(불리언 플래그, 인자 없음). 둘 다 127.0.0.1 전용 바인딩을 강제하므로
보안 의미는 동일하다. flavor 는 디스커버리가 이미 판정해 갖고 있다.

보안 타입: ``~/.vnc/passwd`` 가 있으면 기본 VncAuth 를 존중하고(비밀번호 입력 UI 가
받침됨), 없으면 ``-SecurityTypes None`` 로 세션을 띄운다. 어느 쪽이든 루프백 +
SSH 터널 안이므로 외부 접근은 불가하다. 단 같은 호스트 셸 사용자는 붙을 수 있다 —
실재하는 트레이드오프.

원격 명령은 항상 ``< /dev/null`` 로 stdin 을 막고 타임아웃을 건다. 원격에 사람이
없으니 대화형 프롬프트(vncpasswd 등)가 입력을 기다리며 영원히 멈추는 것을
원천 차단한다.

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


def _localhost_flag(flavor: str) -> str:
    """flavor 에 맞는 루프백 바인딩 플래그.

    TurboVNC 의 ``-localhost`` 는 인자 없는 불리언 플래그다 — ``yes`` 를 주면
    Xvnc 가 ``Unrecognized option: yes`` 로 죽는다. TigerVNC(및 구형 Xvnc) 는
    ``-localhost yes`` 형태를 쓴다. 어느 쪽이든 루프백 바인딩을 강제한다.
    """
    return "-localhost" if flavor == "turbovnc" else "-localhost yes"


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


def _make_local_runner():
    """이 서버 자신에서 실행하는 runner — SSH 를 타지 않는다.

    백엔드가 도는 기계가 곧 대상이므로 원격 호스트에 필요했던 SSH 채널·터널이
    전부 불필요하다. 디스커버리 명령은 원격과 **완전히 동일한 문자열**을 쓴다 —
    파싱 로직이 하나뿐이므로 여기서 명령을 바꾸면 두 경로가 갈라진다.
    """

    async def run(cmd: str) -> str:
        proc = await asyncio.create_subprocess_exec(
            "bash", "-lc", cmd,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _stderr = await asyncio.wait_for(proc.communicate(), timeout=20)
        return stdout.decode("utf-8", errors="replace")

    return run


async def _make_runner_for(host: dict, username: str):
    """호스트 auth_method 에 맞춰 runner 를 만든다."""
    if host.get("is_local"):
        return _make_local_runner()
    if host.get("auth_method") == "tailscale":
        return _make_tailscale_runner(host)
    key_record = None
    if host.get("auth_method") == "key" and host.get("key_id"):
        key_record = await storage.get_ssh_key(host["key_id"], username)
    secrets = resolve_host_secrets(host, key_record)
    return _make_pool_runner(host, secrets)


# 로컬(이 서버 자신)을 가리키는 예약 host_id. 프론트의 로컬 카드가 쓰는 값과 같다.
LOCAL_HOST_ID = "local"


async def _resolve_host_or_404(host_id: str, username: str) -> dict:
    """host_id 를 호스트 레코드로. ``local`` 은 DB 에 없는 가상 호스트다.

    백엔드가 도는 기계 자신이므로 SSH 자격증명도 소유권 검사 대상도 아니다 —
    로그인한 사용자는 이미 이 서버의 셸을 쓸 수 있다(터미널 pane 이 그것이다).
    """
    if host_id == LOCAL_HOST_ID:
        return {"id": LOCAL_HOST_ID, "name": "local", "is_local": True}
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
    """새 가상 데스크탑 기동 — ``vncserver -localhost ... -geometry <WxH> :<N>``.

    display 를 주지 않으면 현재 사용 중인 번호를 피해 1..99 중 빈 번호를 고른다.
    루프백 바인딩(``-localhost``)은 필수(인터넷 노출 차단)이므로 항상 들어간다.
    flavor 에 따라 ``-localhost``(TurboVNC) 또는 ``-localhost yes``(TigerVNC) 로 표기.
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

    # 루프백 바인딩은 절대 빠지면 안 된다 — 빠지면 VNC 가 인터넷에 노출된다.
    # TurboVNC 처럼 PATH 밖에 설치된 vncserver 도 잡기 위해 디스커버리에서
    # 찾은 경로를 쓰고, 없으면 폴백으로 "vncserver" 를 쓴다.
    # flavor 에 따라 -localhost 표기가 다르다: TurboVNC 는 불리언 플래그, TigerVNC 는 yes 인자.
    # GPU 가속: VirtualGL 이 있고 TurboVNC 일 때만 -vgl + VGL_DISPLAY=egl.
    # TigerVNC 에는 -vgl 이 없고, VirtualGL 이 없으면 -vgl 이 실패한다.
    # 보안 타입: ~/.vnc/passwd 가 있으면 기본 VncAuth 를 존중(비밀번호 입력 UI 있음).
    # 없으면 -SecurityTypes None — vncpasswd 대화형 프롬프트로 무한 대기하는 것을 막는다.
    safe_geom = shlex.quote(geometry)
    vncserver_path = state.get("vncserver_path") or "vncserver"
    localhost_flag = _localhost_flag(state.get("flavor", ""))
    gpu = state.get("gpu") or {}
    use_vgl = bool(gpu.get("virtualgl")) and state.get("flavor") == "turbovnc"
    has_vnc_passwd = state.get("has_vnc_passwd", False)
    security_flag = "" if has_vnc_passwd else " -SecurityTypes None"
    if use_vgl:
        cmd = (
            f"VGL_DISPLAY=egl {shlex.quote(vncserver_path)} {localhost_flag}"
            f" -vgl -geometry {safe_geom}{security_flag} :{chosen}"
        )
    else:
        cmd = f"{shlex.quote(vncserver_path)} {localhost_flag} -geometry {safe_geom}{security_flag} :{chosen}"
    # stdin 을 /dev/null 로 — 원격에 사람이 없으니 대화형 프롬프트(vncpasswd 등)가
    # 입력을 기다리며 영원히 멈추는 것을 원천 차단한다.
    cmd += " < /dev/null"
    try:
        output = await asyncio.wait_for(runner(cmd), timeout=30)
    except TimeoutError:
        logger.warning("vnc create timed out (%s:%s)", host_id, chosen)
        return {"available": False, "installed": True, "error": "vncserver 실행 시간 초과 (30초)"}
    except Exception as e:
        logger.warning("vnc create failed (%s:%s): %s", host_id, chosen, e)
        return {"available": False, "installed": True, "error": str(e)}

    return {
        "available": True,
        "installed": True,
        "display": chosen,
        "port": 5900 + chosen,
        "geometry": geometry,
        "gpu_accelerated": use_vgl,
        "password_required": has_vnc_passwd,
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
    # stdin 을 /dev/null 로 막아 kill 경로에서도 대화형 프롬프트가 뜨지 않게.
    cmd = f"{shlex.quote(vncserver_path)} -kill :{int(display)} < /dev/null"
    try:
        output = await asyncio.wait_for(runner(cmd), timeout=15)
    except TimeoutError:
        logger.warning("vnc kill timed out (%s:%s)", host_id, display)
        return {"available": False, "error": "vncserver 종료 시간 초과 (15초)"}
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


# ---------------------- 비밀번호 설정 ----------------------

# 고전 VNC 인증(VncAuth)은 비밀번호를 **8자까지만** 쓴다 — 9자 이상은 잘린다.
# 사용자가 긴 비밀번호를 넣고 "설정됐다" 고 믿게 두면 안 되므로 경계에서 막는다.
VNC_PASSWORD_MIN = 6
VNC_PASSWORD_MAX = 8


async def _write_vnc_password(host: dict, username: str, password: str) -> None:
    """호스트의 ``~/.vnc/passwd`` 를 만든다.

    비밀번호는 **stdin 으로만** 넘긴다. 명령줄 인자로 주면 원격의 ``ps`` 에 그대로
    노출된다. ``vncpasswd -f`` 는 stdin 의 평문을 읽어 난독화된 파일 내용을 stdout
    으로 낸다 — 그걸 리다이렉트하고 0600 으로 조인다.
    """
    runner = await _make_runner_for(host, username)
    state = await gather_discovery(runner)
    vnc_path = state.get("vncserver_path")
    # vncpasswd 는 vncserver 와 같은 디렉토리에 있다(TurboVNC 는 /opt/TurboVNC/bin).
    if vnc_path and "/" in vnc_path:
        passwd_bin = vnc_path.rsplit("/", 1)[0] + "/vncpasswd"
    else:
        passwd_bin = "vncpasswd"
    cmd = (
        f"mkdir -p ~/.vnc && umask 077 && {shlex.quote(passwd_bin)} -f > ~/.vnc/passwd "
        f"&& chmod 600 ~/.vnc/passwd && echo OK"
    )

    if host.get("is_local"):
        proc = await asyncio.create_subprocess_exec(
            "bash", "-lc", cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, err = await asyncio.wait_for(proc.communicate(input=password.encode()), timeout=20)
        ok = b"OK" in out
        detail = err.decode("utf-8", errors="replace")[:200]
    elif host.get("auth_method") == "tailscale":
        target = f"{host.get('ssh_user') or 'root'}@{host['hostname']}"
        proc = await asyncio.create_subprocess_exec(
            "tailscale", "ssh", target, cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, err = await asyncio.wait_for(proc.communicate(input=password.encode()), timeout=25)
        ok = b"OK" in out
        detail = err.decode("utf-8", errors="replace")[:200]
    else:
        key_record = None
        if host.get("auth_method") == "key" and host.get("key_id"):
            key_record = await storage.get_ssh_key(host["key_id"], username)
        secrets = resolve_host_secrets(host, key_record)
        conn = await open_connection(host, **secrets)
        try:
            result = await conn.run(cmd, input=password, check=False)
            out = result.stdout or ""
            ok = "OK" in (out if isinstance(out, str) else out.decode("utf-8", "replace"))
            stderr = result.stderr or ""
            detail = (stderr if isinstance(stderr, str) else stderr.decode("utf-8", "replace"))[:200]
        finally:
            conn.close()

    if not ok:
        # detail 에 비밀번호가 실릴 일은 없다(stdin 으로만 넘겼다).
        raise HTTPException(status_code=502, detail=f"비밀번호 설정 실패: {detail or 'unknown'}")


class SetPasswordRequest(BaseModel):
    password: str


@router.post("/api/hosts/{host_id}/vnc/password")
async def set_vnc_password(
    host_id: str,
    request: SetPasswordRequest,
    username: str = Depends(verify_auth_token),
):
    """호스트의 VNC 비밀번호를 설정한다.

    설정하면 이후 만드는 세션이 ``-SecurityTypes None`` 대신 VncAuth 로 뜨고,
    클라이언트가 비밀번호 입력을 받는다(백엔드는 ~/.vnc/passwd 유무로 분기한다).
    우리 DB 에는 저장하지 않는다 — 호스트의 passwd 파일이 유일한 보관처다.
    """
    pw = (request.password or "").strip()
    if not (VNC_PASSWORD_MIN <= len(pw) <= VNC_PASSWORD_MAX):
        raise HTTPException(
            status_code=400,
            detail=(
                f"비밀번호는 {VNC_PASSWORD_MIN}~{VNC_PASSWORD_MAX}자여야 합니다"
                " (VNC 규격상 8자 초과분은 무시됩니다)"
            ),
        )
    host = await _resolve_host_or_404(host_id, username)
    await _write_vnc_password(host, username, pw)
    return {"ok": True}

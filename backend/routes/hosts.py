"""SSH 호스트 관리 — CRUD/정렬 + 원격 tmux 세션 점검·정리.

원격 tmux 조회는 SSH 왕복이 500ms~2s 라 cache 를 끼고 돈다. 호스트를 고치면
invalidate_host 로 즉시 무효화해야 UI 가 옛 세션 목록을 물지 않는다.
호스트의 파일(SFTP)은 routes/host_files.py, git 은 routes/host_git.py.
"""
from __future__ import annotations

import asyncio
import logging
import os
import shlex

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

import host_tmux
import session_tombstones
from _deps import verify_auth_token
from remote_platform import PLATFORM_PROBE, classify_platform
from cache import cache, invalidate_host, key_host_tmux_clients, key_host_tmux_sessions
from host_manager import resolve_host_secrets
from vault import encrypt_str
from ws_clients import _client_identity_payload
from models import HostUpsertRequest
from sqlite_storage import storage
from ssh_pool import ssh_pool

logger = logging.getLogger(__name__)

router = APIRouter(tags=["hosts"])

# tmux 세션 목록 캐시 TTL(초). 성공과 실패를 따로 두는 이유는 `_fetch_host_tmux_sessions`
# 의 주석 참고 — 실패를 캐시하지 않으면 꺼진 호스트 하나가 홈 화면을 열 때마다
# SSH connect timeout(15초) 만큼 통째로 붙잡는다.
# 붙어 있는 세션을 지우려 할 때의 문구. **두 경로가 같은 말을 해야 한다** — 사용자에게는
# 리모트로 갔는지 SSH 로 갔는지가 보이지 않는데, 문구가 다르면 다른 고장으로 읽힌다.
SESSION_IN_USE_DETAIL = (
    "지금 사용 중인 세션입니다. 그 터미널을 먼저 닫으면 목록에서도 사라집니다."
)

HOST_TMUX_CACHE_TTL_SEC = 60
HOST_TMUX_ERROR_TTL_SEC = 30
# 여러 호스트를 한 번에 볼 때의 **전체** 마감. 살아 있는 호스트는 1초 안에 답하므로,
# 여기 걸리는 것은 꺼졌거나 아픈 호스트다 — 그것 하나 때문에 화면 전체가 기다릴 이유가 없다.
BATCH_TMUX_DEADLINE_SEC = float(os.getenv("BATCH_TMUX_DEADLINE_SEC", "6"))


@router.get("/api/hosts")
async def list_hosts(username: str = Depends(verify_auth_token)):
    return {"items": await storage.list_hosts(username)}


def _host_payload_to_fields(req: HostUpsertRequest) -> dict:
    fields = {
        "name": req.name,
        "hostname": req.hostname,
        "port": int(req.port or 22),
        "ssh_user": req.ssh_user,
        "auth_method": req.auth_method,
        "key_id": req.key_id,
        "color_index": int(req.color_index or 0),
        "group_name": req.group_name,
        "use_remote_tmux": 1 if req.use_remote_tmux else 0,
        "remote_tmux_session": req.remote_tmux_session or "mobile",
        "start_path": (req.start_path or "").strip() or None,
        "icon": (req.icon or "").strip() or None,
        "theme": (req.theme or "").strip() or None,
    }
    if req.auth_method == "password" and req.password:
        fields["password_enc"] = encrypt_str(req.password)
    return fields


@router.post("/api/hosts")
async def create_host(request: HostUpsertRequest, username: str = Depends(verify_auth_token)):
    import uuid
    host_id = str(uuid.uuid4())
    fields = _host_payload_to_fields(request)
    await storage.upsert_host(host_id, username, **fields)
    return {"id": host_id, "status": "created"}


@router.patch("/api/hosts/{host_id}")
async def update_host(host_id: str, request: HostUpsertRequest, username: str = Depends(verify_auth_token)):
    existing = await storage.get_host(host_id, username)
    if not existing:
        raise HTTPException(status_code=404, detail="호스트를 찾을 수 없습니다")
    fields = _host_payload_to_fields(request)
    await storage.upsert_host(host_id, username, **fields)
    return {"id": host_id, "status": "updated"}


class HostReorderRequest(BaseModel):
    ids: list[str]


@router.post("/api/hosts/reorder")
async def reorder_hosts(request: HostReorderRequest, username: str = Depends(verify_auth_token)):
    """홈 카드 DnD 순서 영속. ids 리스트 순서대로 sort_index 0..N-1 부여."""
    await storage.reorder_hosts(username, request.ids)
    return {"status": "ok", "count": len(request.ids)}


class HostLastCwdRequest(BaseModel):
    cwd: str | None = None


@router.post("/api/hosts/{host_id}/last-cwd")
async def update_host_last_cwd(
    host_id: str,
    request: HostLastCwdRequest,
    username: str = Depends(verify_auth_token),
):
    """호스트의 마지막 cwd 명시적으로 설정. 폴더 픽커에서 경로 고른 직후 호출."""
    existing = await storage.get_host(host_id, username)
    if not existing:
        raise HTTPException(status_code=404, detail="호스트를 찾을 수 없습니다")
    await storage.update_host_last_cwd(host_id, username, request.cwd)
    return {"id": host_id, "last_cwd": (request.cwd or "").strip() or None}


async def get_host_remote_status(host_id: str, username: str) -> dict:
    """리모트가 이 호스트에 깔려 있는가 · 돌고 있는가 · 지금 붙어 있는가.

    ⚠️ **라우트가 아니라 내부 함수다.** 공개 표면은 `agent-status` 하나뿐 — 리모트만
    묻는 길이 따로 있으면 그걸 부른 화면은 **반쪽 상태**를 보고 "준비됨" 이라고 적는다.

    ⚠️ **문서 정정: SSH 폴백은 없다.** 예전엔 "안 깔아도 백엔드가 SSH 로 관찰자를
    띄우는 경로가 그대로 있다" 였고 화면도 그렇게 적었는데, 그 경로를 없앤 뒤로 그건
    거짓이다 — 리모트가 없으면 그 호스트의 pane 은 `statusUnknown` 이고 명령을 받지
    못한다. 강요는 여전히 안 하지만, **없으면 없는 대로 사실을 적는다.**
    """
    from host_common import resolve_host_with_secrets, run_remote_cmd
    from remote_agent import registry
    from remote_agent.setup import (
        STATUS_SCRIPT,
        manual_start_command,
        parse_status,
        start_hint,
        version_hash,
    )

    host, secrets = await resolve_host_with_secrets(host_id, username)
    connection = registry.get(host_id)
    connected = connection is not None

    try:
        raw = await run_remote_cmd(host, secrets, STATUS_SCRIPT, timeout=15)
    except Exception as e:
        # ⚠️ 호스트에 못 닿는 것과 "안 깔렸다" 는 다른 사건이다. 못 닿았는데 "안 깔림"
        # 으로 그리면 설치 버튼을 누르게 되고 그것도 실패한다.
        logger.info("remote-status unreachable (%s): %s", host_id, e)
        return {"installed": None, "connected": connected, "running": connected,
                "reachable": False, "optional": True,
                "facts": connection.facts if connection else {}}

    status = parse_status(raw, connected, version_hash())
    status["reachable"] = True
    status["optional"] = True
    status["facts"] = connection.facts if connection else {}
    # 설치는 됐는데 안 붙은 이유와 할 일 — 없으면 None.
    status["hint"] = start_hint(status)
    status["start_command"] = manual_start_command() if status["hint"] == "manual" else None
    return status


async def install_host_remote(host_id: str, username: str) -> dict:
    """리모트를 이 호스트에 얹는다. 사람이 누를 때만 일어난다.

    ⚠️ **라우트가 아니라 내부 함수다.** 공개 표면은 `agent-setup` 하나뿐 — 리모트만
    까는 길이 따로 있으면 그 버튼으로 깐 호스트는 `itl` 이 없어 답장을 못 한다.
    실제로 홈 카드의 설치 버튼이 그 길로 가고 있었다(반쪽 설치).

    자격증명은 **stdin 으로만** 간다 — 명령 문자열은 원격 `ps` 에 그대로 보인다.
    """
    from _deps import get_auth_manager
    from host_common import resolve_host_with_secrets, run_remote_cmd
    from itl_remote_setup import _remote_api_base, get_server_identity
    from remote_agent.credentials import issue_credential
    from remote_agent.setup import build_install_script

    host, secrets = await resolve_host_with_secrets(host_id, username)

    identity = await get_server_identity()
    base = _remote_api_base(identity)
    if not base:
        raise HTTPException(
            status_code=409,
            detail="이 서버의 주소를 원격에서 찾을 수 없습니다 (사설망 주소 없음)",
        )
    ws_url = base.replace("https://", "wss://").replace("http://", "ws://") + "/api/remote/ws"

    manager = get_auth_manager()
    if not manager:
        raise HTTPException(status_code=503, detail="인증 관리자가 초기화되지 않았습니다")
    epoch = host.get("cred_epoch") or 1
    token = await issue_credential(manager, username, host_id, epoch=int(epoch))

    # ⚠️ 두 번째 인자는 tmux **소켓 이름**이지 세션 이름이 아니다. 한때 여기에
    # `remote_tmux_session`(예: `mobile`)을 넘겼는데, 그러면 리모트가 `tmux -L mobile` 을
    # 보고 **서버 없음**으로 판정해 pane 스트림이 아예 안 온다 — 상태는 영영 "모름" 이고
    # 배달·읽기는 셸 경로로 떨어져 거절된다(실측: statusUnknown 15/15, read 502).
    #
    # 원격 호스트의 우리 세션은 **기본 소켓**에 산다(host_manager 의 부트스트랩이 `-L`
    # 없이 tmux 를 부른다). 그래서 빈 값이 맞다.
    script = build_install_script(ws_url, "")
    try:
        out = await run_remote_cmd(host, secrets, script, timeout=60, stdin_data=token + "\n")
    except Exception as e:
        logger.warning("remote install failed (%s): %s", host_id, e)
        raise HTTPException(status_code=502, detail="원격 설치에 실패했습니다") from e
    if "ITL_REMOTE_INSTALLED" not in (out or ""):
        # ⚠️ 표식이 없으면 성공으로 세지 않는다. `run_remote_cmd` 는 exit code 를 보지
        # 않으므로, 표식 없이는 "SSH 가 돌았다" 와 "설치됐다" 를 구별할 수 없다.
        raise HTTPException(status_code=502, detail="원격 설치가 완료되지 않았습니다")

    service = "none"
    for line in (out or "").splitlines():
        if line.startswith("ITL_REMOTE_SERVICE="):
            service = line.split("=", 1)[1].strip()
    logger.info("remote installed: host=%s service=%s", host_id, service)
    return {"id": host_id, "installed": True, "service": service}


@router.post("/api/hosts/{host_id}/remote-uninstall")
async def uninstall_host_remote(host_id: str, username: str = Depends(verify_auth_token)):
    """리모트를 완전히 걷어낸다 — 서비스·파일·자격증명 전부.

    같이 **세대를 올린다**. 파일만 지우고 자격증명을 살려 두면, 어딘가 남아 있던 사본이
    계속 붙을 수 있다 — 제거했다는 말이 거짓이 된다.
    """
    from host_common import resolve_host_with_secrets, run_remote_cmd
    from remote_agent import registry
    from remote_agent.setup import UNINSTALL_SCRIPT

    host, secrets = await resolve_host_with_secrets(host_id, username)
    removed = False
    try:
        out = await run_remote_cmd(host, secrets, UNINSTALL_SCRIPT, timeout=30)
        removed = "ITL_REMOTE_REMOVED" in (out or "")
    except Exception as e:
        # 호스트에 못 닿아도 **우리 쪽은 끊고 폐기한다** — 꺼진 기계 때문에 자격증명이
        # 살아 있는 편이 더 나쁘다. 파일은 다음에 닿을 때 지운다.
        logger.info("remote uninstall could not reach host (%s): %s", host_id, e)

    connection = registry.get(host_id)
    if connection is not None:
        registry.detach(connection)
    await storage.revoke_host_credentials(host_id, username)
    logger.info("remote uninstalled: host=%s files_removed=%s", host_id, removed)
    return {"id": host_id, "files_removed": removed, "credentials_revoked": True}


@router.post("/api/hosts/{host_id}/credentials/revoke")
async def revoke_host_credentials(
    host_id: str,
    username: str = Depends(verify_auth_token),
):
    """이 호스트로 발급한 자격증명을 **전부** 무효화한다 (리모트 + 원격 tmux 의 ITL_TOKEN).

    JWT 는 서명만 맞으면 통과하므로 세대를 올리는 것이 유일한 폐기 장치다. 한 대가
    털렸을 때 사용자 토큰 전체를 갈지 않고 **그 호스트 것만** 죽이는 것이 요점이다.

    되돌릴 수 없다 — 그 호스트는 다시 설치(리모트)하거나 다음 attach(ITL_TOKEN)에서
    새 자격증명을 받는다. 그래서 호출자는 확인을 거쳐야 한다.
    """
    existing = await storage.get_host(host_id, username)
    if not existing:
        raise HTTPException(status_code=404, detail="호스트를 찾을 수 없습니다")

    epoch = await storage.revoke_host_credentials(host_id, username)
    if epoch is None:
        raise HTTPException(status_code=404, detail="호스트를 찾을 수 없습니다")

    # 지금 붙어 있는 리모트를 **즉시** 끊는다. 안 끊으면 이미 열린 통로는 폐기와 무관하게
    # 계속 살아 있어서, "폐기했다" 는 말이 다음 재연결까지 거짓이 된다.
    from remote_agent import registry
    connection = registry.get(host_id)
    if connection is not None:
        registry.detach(connection)

    # 다음 attach 때 새 토큰을 심도록 주입 캐시를 비운다 — 안 비우면 TTL 이 끝날 때까지
    # 옛(이제 죽은) 토큰을 그대로 두고 "이미 심었다" 로 건너뛴다.
    from itl_remote_setup import forget_injected
    forget_injected(host_id, str(existing.get("remote_tmux_session") or ""))

    logger.info("host credentials revoked: host=%s epoch=%s", host_id, epoch)
    return {"id": host_id, "cred_epoch": epoch, "remote_disconnected": connection is not None}


async def _stdout_of(awaitable) -> str:
    """asyncssh 결과의 stdout 을 문자열로. bytes/str 을 둘 다 받는다."""
    result = await awaitable
    out = result.stdout
    return out if isinstance(out, str) else (out or b"").decode("utf-8", errors="replace")


async def _kill_over_remote(host_id: str, username: str, session: str,
                            allow_attached: bool) -> bool:
    """리모트가 붙어 있으면 그 소켓으로 죽인다. 성공하면 True.

    ⚠️ **못 하면 조용히 False 를 준다** — 호출부가 SSH 로 이어간다. 리모트가 없는
    호스트도 종료는 되어야 하고, 그건 사람이 누른 한 번이라 SSH 를 열 만하다
    (`open_channel_on_demand` 와 같은 기준: 되풀이되는 일이 아니다).

    붙어 있음 판정만은 예외로 **위로 던진다.** 그건 "이 경로가 안 된다" 가 아니라
    "죽이면 안 된다" 이므로, SSH 로 물러서서 기어이 죽이면 이 수정이 무의미해진다.
    """
    from itl_remote import RemoteNotConnectedError, open_channel
    from remote_agent.channel import RemoteChannelError
    try:
        channel = await open_channel(host_id, username)
    except RemoteNotConnectedError:
        return False
    if not allow_attached:
        await host_tmux.assert_not_attached(
            lambda: channel.run(host_tmux.LIST_TMUX_CMD), session)
    try:
        await channel.run(host_tmux.kill_tmux_cmd(session, shell=False))
    except RemoteChannelError as e:
        # 없는 세션을 죽이면 tmux 가 0 이 아닌 코드로 끝난다 — 그건 실패가 아니라
        # **이미 없다**이다. 그 외 사유(낡은 리모트 등)는 SSH 로 물러선다.
        if "can't find session" in str(e) or "no server running" in str(e):
            return True
        logger.warning("remote kill fell back to ssh (%s): %s", host_id, e)
        return False
    return True


@router.post("/api/hosts/{host_id}/kill-tmux")
async def kill_host_tmux(
    host_id: str,
    force: bool = Query(False, description="true 면 tmux kill-server (전체 nuke)"),
    session: str | None = Query(None, description="특정 세션 이름 직접 지정 (예: mobile.2). 없으면 호스트 기본"),
    allow_attached: bool = Query(
        False,
        description="붙어 있는 세션도 죽인다. 세션 재시작·탭 닫기처럼 **그게 목적인** 곳만.",
    ),
    recreate: bool = Query(
        False,
        description="곧바로 다시 만들 것이다(세션 재시작). 무덤을 남기지 않는다.",
    ),
    username: str = Depends(verify_auth_token),
):
    """원격 tmux 세션 종료.

    - force=True: `tmux kill-server` (전체 nuke)
    - session 지정: 그 세션만 kill (분할 pane 의 자동 부여된 세션 정리용)
    - 둘 다 없으면 호스트의 기본 세션 kill

    ⚠️ **`recreate` 는 무덤을 남기지 않는다.** 무덤(`session_tombstones`)은 "사용자가
    지웠으니 되살리지 마라" 는 표다. 그런데 **세션 재시작은 정확히 그 되살리기가 목적**
    이다 — 죽이고, 재접속이 `create=1` 로 새로 만든다. 그런데도 표를 남기고 있어서
    그 재접속이 20초(`TOMBSTONE_TTL_SEC`) 동안 거절당했고, 거절은 `session-terminated`
    라 클라이언트에게는 "셸이 끝났다" 로 보인다. 그게 "원격 세션 재시작이 오래 걸린다"
    의 정체다(SSH 는 실측 0.34초로 범인이 아니었다).

    ⚠️ 이 저장소가 같은 가족의 사고를 네 번째 밟은 것이다: **우리가 죽인 것과 저절로
    죽은 것을 구별하지 못했다.** 구별은 의도를 아는 쪽(호출부)이 말해 주어야 한다.

    ⚠️ **붙어 있는 세션은 기본적으로 거절한다(409).** 붙어 있다는 건 쓰는 중이라는
    뜻이다. 사고 이력: 홈의 "이어할 수 있는 세션" 이 60초 캐시 위에서 판정하는 바람에
    쓰고 있던 세션이 목록에 남았고, 그걸 종료하자 **쓰던 세션이 같이 죽었다.**
    화면은 언제나 과거를 그리므로, 판정은 죽이기 직전에 여기서 한 번 더 한다.

    **리모트가 붙어 있으면 SSH 를 열지 않는다.** 예전에는 kill 마다 새 SSH 연결을
    맺었고(핸드셰이크+인증), 그게 "원격 세션 재시작이 오래 걸린다" 의 정체였다.
    이건 폴링이 아니라 사람이 누른 한 번이지만, 이미 열려 있는 소켓을 두고 새로
    연결할 이유는 없다.
    """
    from host_manager import DEFAULT_REMOTE_TMUX_SESSION, open_connection
    host = await storage.get_host(host_id, username)
    if not host:
        raise HTTPException(status_code=404, detail="호스트를 찾을 수 없습니다")
    if not bool(host.get("use_remote_tmux", 1)) and not force:
        return {"id": host_id, "status": "skipped", "reason": "tmux not used"}

    key_record = None
    if host.get("auth_method") == "key" and host.get("key_id"):
        key_record = await storage.get_ssh_key(host["key_id"], username)
    secrets = resolve_host_secrets(host, key_record)
    target_session = (session or "").strip() or host.get("remote_tmux_session") or DEFAULT_REMOTE_TMUX_SESSION

    if not force:
        try:
            killed = await _kill_over_remote(host_id, username, target_session, allow_attached)
        except host_tmux.SessionInUseError:
            raise HTTPException(status_code=409, detail=SESSION_IN_USE_DETAIL) from None
        if killed:
            if not recreate:
                session_tombstones.mark_killed(host_id, target_session)
            await invalidate_host(host_id)
            return {"id": host_id, "session": target_session, "status": "killed", "via": "remote"}

    cmd = "tmux kill-server 2>/dev/null; true" if force else host_tmux.kill_tmux_cmd(target_session, shell=True)
    try:
        # tailscale auth 면 일반 ssh open_connection 안 됨 → tailscale ssh exec
        if host.get("auth_method") == "tailscale":
            target = f"{host.get('ssh_user') or 'root'}@{host['hostname']}"

            async def _run_tailscale(one: str) -> str:
                proc = await asyncio.create_subprocess_exec(
                    "tailscale", "ssh", target, one,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
                return stdout.decode("utf-8", errors="replace")

            if not force and not allow_attached:
                await host_tmux.assert_not_attached(
                    lambda: _run_tailscale(host_tmux.LIST_SSH_CMD), target_session)
            await _run_tailscale(cmd)
        else:
            conn = await open_connection(
                host,
                private_key=secrets["private_key"],
                passphrase=secrets["passphrase"],
                password=secrets["password"],
            )
            try:
                # 목록과 kill 은 **같은 연결**에서 — 확인하려고 연결을 하나 더 열면
                # 이 엔드포인트가 느려진 원인(핸드셰이크)을 그대로 두 배로 만든다.
                if not force and not allow_attached:
                    await host_tmux.assert_not_attached(
                        lambda: _stdout_of(conn.run(host_tmux.LIST_SSH_CMD, check=False)),
                        target_session)
                await conn.run(cmd, check=False)
            finally:
                conn.close()
                await conn.wait_closed()
    except host_tmux.SessionInUseError:
        raise HTTPException(status_code=409, detail=SESSION_IN_USE_DETAIL) from None
    except Exception as e:
        logger.error("kill-tmux failed (%s, force=%s, session=%s): %s", host_id, force, target_session, e)
        raise HTTPException(status_code=500, detail="tmux 세션 종료에 실패했습니다.")
    if not force and not recreate:
        # ⚠️ **지우면 지워져야 한다.** 브리지는 세션이 사라진 것을 보면 `create=1` 로 다시
        # 만든다(호스트 재부팅 복구용). 사용자가 직접 지운 경우엔 그게 정반대로 작동해
        # 곧바로 되살아난다 — 표를 남겨 그 한 번을 막는다.
        #
        # `recreate` 면 표를 남기지 않는다. 재시작은 그 되살리기가 **목적**이라,
        # 표를 남기면 자기 재접속을 자기가 막는다.
        session_tombstones.mark_killed(host_id, target_session)
    await invalidate_host(host_id)  # 세션 목록·client 수 캐시 즉시 무효화
    await ssh_pool.invalidate(host_id)  # 풀의 살아있는 conn 도 끊어 새로 시작
    return {"id": host_id, "session": target_session, "status": "server_killed" if force else "killed"}


@router.get("/api/hosts/{host_id}/tmux-clients")
async def get_host_tmux_clients(
    request: Request,
    host_id: str,
    session: str = Query(..., description="원격 tmux 세션명"),
    client_id: str | None = Query(None),
    username: str = Depends(verify_auth_token),
):
    """원격 호스트의 특정 tmux 세션에 attach 된 클라이언트 수.
    takeover 프리플라이트 + 자동 재attach 폴링용. session 없으면 count=0 으로 통일.
    `tmux list-clients -t SESSION` 의 라인 수.
    여러 탭이 같은 세션을 polling 할 때 SSH 왕복을 줄이려고 5s TTL 캐시."""
    host = await storage.get_host(host_id, username)
    if not host:
        raise HTTPException(status_code=404, detail="호스트를 찾을 수 없습니다")

    cache_key = key_host_tmux_clients(host_id, session)
    cached = await cache.get(cache_key)
    if cached is not None:
        payload = dict(cached)
        payload.update(_client_identity_payload("host", f"{host_id}:{session}", client_id, request))
        return payload

    from host_manager import open_connection
    # Quote the whole exact tmux target. In zsh, a bare token starting with '='
    # triggers command-path expansion, so `-t =mobile-foo` can fail before tmux
    # runs. `'=mobile-foo'` works in sh/zsh and keeps tmux exact-match semantics.
    safe_session = shlex.quote(f"={session}")
    if safe_session.startswith("="):
        safe_session = "'" + safe_session.replace("'", "'\"'\"'") + "'"
    # `=` prefix → exact match (suffix 매치 방지). exists 도 같이 내려 refresh-only 재연결에 사용.
    cmd = (
        f"if tmux has-session -t {safe_session} 2>/dev/null; then "
        f"echo __EXISTS__1; tmux list-clients -t {safe_session} 2>/dev/null | wc -l; "
        f"else echo __EXISTS__0; echo 0; fi"
    )

    try:
        if host.get("auth_method") == "tailscale":
            target = f"{host.get('ssh_user') or 'root'}@{host['hostname']}"
            proc = await asyncio.create_subprocess_exec(
                "tailscale", "ssh", target, cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _stderr = await asyncio.wait_for(proc.communicate(), timeout=8)
            output = stdout.decode("utf-8", errors="replace")
        else:
            key_record = None
            if host.get("auth_method") == "key" and host.get("key_id"):
                key_record = await storage.get_ssh_key(host["key_id"], username)
            secrets = resolve_host_secrets(host, key_record)
            async def _opener():
                return await open_connection(
                    host,
                    private_key=secrets["private_key"],
                    passphrase=secrets["passphrase"],
                    password=secrets["password"],
                )
            result = await ssh_pool.run(host_id, _opener, cmd, check=False)
            output = result.stdout if isinstance(result.stdout, str) else (result.stdout or b"").decode("utf-8", errors="replace")
    except Exception as e:
        logger.warning("tmux-clients query failed (%s/%s): %s", host_id, session, e)
        # 실패 시 알 수 없음 — 0 으로 보내 프론트가 그냥 진행하게.
        payload = {"host_id": host_id, "session": session, "count": 0, "attached": False, "error": str(e)}
        payload.update(_client_identity_payload("host", f"{host_id}:{session}", client_id, request))
        return payload

    lines = (output or "0").strip().splitlines()
    exists = "__EXISTS__0" not in lines
    try:
        n = int(lines[-1])
    except (ValueError, IndexError):
        n = 0
    payload = {"host_id": host_id, "session": session, "exists": exists, "count": n, "attached": n > 0}
    await cache.set(cache_key, payload, ttl_seconds=1)
    payload = dict(payload)
    payload.update(_client_identity_payload("host", f"{host_id}:{session}", client_id, request))
    return payload


@router.get("/api/hosts/{host_id}/tmux-check")
async def check_host_tmux(
    host_id: str,
    username: str = Depends(verify_auth_token),
):
    """원격 호스트에 tmux 가 설치되어 있는지 사전 체크.
    설정 토글 전 프론트엔드에서 호출 → available=false 면 토글 차단/경고."""
    host = await storage.get_host(host_id, username)
    if not host:
        raise HTTPException(status_code=404, detail="호스트를 찾을 수 없습니다")

    # One probe answers both questions. `uname -s` runs first because a host that cannot
    # run it is not a POSIX host at all, and that is the more useful thing to report:
    # every remote feature here (tmux sessions, /tmp pastes, the itl CLI) assumes a POSIX
    # shell, and a Windows host used to fail one confusing symptom at a time.
    cmd = f"{PLATFORM_PROBE}; command -v tmux 2>/dev/null && echo YES || echo NO"
    try:
        if host.get("auth_method") == "tailscale":
            target = f"{host.get('ssh_user') or 'root'}@{host['hostname']}"
            proc = await asyncio.create_subprocess_exec(
                "tailscale", "ssh", target, cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=8)
            output = stdout.decode("utf-8", errors="replace")
        else:
            from host_manager import open_connection
            key_record = None
            if host.get("auth_method") == "key" and host.get("key_id"):
                key_record = await storage.get_ssh_key(host["key_id"], username)
            secrets = resolve_host_secrets(host, key_record)
            conn = await open_connection(
                host,
                private_key=secrets["private_key"],
                passphrase=secrets["passphrase"],
                password=secrets["password"],
            )
            try:
                result = await conn.run(cmd, check=False)
                output = result.stdout if isinstance(result.stdout, str) else (result.stdout or b"").decode("utf-8", errors="replace")
            finally:
                conn.close()
                await conn.wait_closed()
    except Exception as e:
        logger.warning("tmux-check failed (%s): %s", host_id, e)
        return {"host_id": host_id, "available": False, "error": str(e)}

    available = "YES" in (output or "").strip()
    platform = classify_platform(output)
    # A host we could not classify keeps the old contract exactly — `platform` is extra
    # information, never a new way for this endpoint to say no.
    return {"host_id": host_id, "available": available, "platform": platform}


async def _fetch_host_tmux_sessions(host: dict, host_id: str, username: str, refresh: bool) -> dict:
    """단일 호스트 tmux 세션 목록 조회. 캐시 + 에러 처리 포함.

    성공: {"id": host_id, "sessions": [...]}
    실패: {"id": host_id, "sessions": [], "error": "..."}  — generic 메시지로 raw SSH 에러 미노출.
    """
    cache_key = key_host_tmux_sessions(host_id)
    if not refresh:
        cached = await cache.get(cache_key)
        if cached is not None:
            return cached

    from host_manager import open_connection
    cmd = "tmux list-sessions -F '#{session_name}|#{session_created}|#{session_attached}' 2>/dev/null || true"

    try:
        if host.get("auth_method") == "tailscale":
            target = f"{host.get('ssh_user') or 'root'}@{host['hostname']}"
            proc = await asyncio.create_subprocess_exec(
                "tailscale", "ssh", target, cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
            output = stdout.decode("utf-8", errors="replace")
        else:
            key_record = None
            if host.get("auth_method") == "key" and host.get("key_id"):
                key_record = await storage.get_ssh_key(host["key_id"], username)
            secrets = resolve_host_secrets(host, key_record)
            async def _opener():
                return await open_connection(
                    host,
                    private_key=secrets["private_key"],
                    passphrase=secrets["passphrase"],
                    password=secrets["password"],
                )
            result = await ssh_pool.run(host_id, _opener, cmd, check=False)
            output = result.stdout if isinstance(result.stdout, str) else (result.stdout or b"").decode("utf-8", errors="replace")
    except Exception as e:
        # 자세한 사유는 로그에만 — 응답에는 generic 메시지로 누출 방지.
        logger.warning("list-tmux-sessions failed (%s): %s", host_id, e)
        # 실패도 캐시한다(성공보다 짧게). 안 하면 꺼진 호스트가 조회 때마다 SSH
        # connect timeout(15초)을 새로 태우고, batch 는 gather 라 그 15초가 홈 화면
        # 전체의 대기 시간이 된다 — 실측으로 죽은 RPi 한 대가 "이어할 수 있는 세션"
        # 구획을 매번 15초씩 붙잡고 있었다. 호스트가 살아 돌아왔을 때의 대기는
        # `refresh=true`(새로고침 버튼)가 캐시를 무시하므로 사용자가 직접 푼다.
        payload = {"id": host_id, "sessions": [], "error": "원격 tmux 세션 조회 실패"}
        await cache.set(cache_key, payload, ttl_seconds=HOST_TMUX_ERROR_TTL_SEC)
        return payload

    sessions = []
    for line in output.strip().splitlines():
        parts = line.split("|")
        if len(parts) >= 3:
            sessions.append({
                "name": parts[0],
                "created": int(parts[1]) if parts[1].isdigit() else None,
                "attached": parts[2] != "0",
            })
    payload = {"id": host_id, "sessions": sessions}
    await cache.set(cache_key, payload, ttl_seconds=HOST_TMUX_CACHE_TTL_SEC)
    return payload


@router.get("/api/hosts/tmux-sessions/batch")
async def batch_host_tmux_sessions(
    ids: str = Query("", description="콤마 구분 host_id. 비면 use_remote_tmux 모든 호스트."),
    refresh: bool = Query(False, description="강제 새로고침 — 캐시 무시"),
    username: str = Depends(verify_auth_token),
):
    """N개 호스트 tmux 세션을 한 번에 — HomeSessions 의 N+1 호출 제거용.

    asyncio.gather 로 병렬 조회. 한 호스트 실패가 다른 호스트 결과를 막지 않음.
    """
    all_hosts = await storage.list_hosts(username)
    if ids.strip():
        wanted = {s.strip() for s in ids.split(",") if s.strip()}
        picked = [h for h in all_hosts if h.get("id") in wanted]
    else:
        picked = [h for h in all_hosts if h.get("use_remote_tmux")]
    if not picked:
        return {"items": []}

    # `list_hosts` deliberately omits `password_enc` — it is the row that goes out to the
    # browser. Connecting needs the full record, so re-read the ones we are about to dial.
    # Without this every password-auth host failed here with "비밀번호 인증인데 비밀번호가
    # 없음" while its terminal connected fine, because the single-host route reads
    # `get_host`. The home screen simply never listed resumable sessions for those hosts.
    full = await asyncio.gather(*[storage.get_host(h["id"], username) for h in picked])
    hosts = [f or h for f, h in zip(full, picked)]

    # ⚠️ **가장 느린 호스트가 전체의 대기 시간이 된다.** gather 는 다 끝나야 돌아오므로,
    # 꺼진 호스트 하나가 "이어할 수 있는 세션" 구획을 통째로 붙잡는다(실측으로 겪은 그것).
    # 그래서 전체에 짧은 마감을 두고, 못 끝낸 것은 그때까지의 결과와 함께 오류로 돌려준다.
    # 오류는 캐시되므로(HOST_TMUX_ERROR_TTL_SEC) 다음 조회는 기다리지 않는다.
    tasks = {
        h["id"]: asyncio.ensure_future(
            _fetch_host_tmux_sessions(h, h["id"], username, refresh)
        )
        for h in hosts
    }
    done, pending = await asyncio.wait(tasks.values(), timeout=BATCH_TMUX_DEADLINE_SEC)
    for task in pending:
        task.cancel()      # 남겨 두면 아무도 안 보는 SSH 가 계속 돈다

    items: list[dict] = []
    for host_id, task in tasks.items():
        if task in pending:
            logger.info("batch tmux-sessions timed out (%s)", host_id)
            payload = {"id": host_id, "sessions": [], "error": "원격 tmux 세션 조회 실패"}
            # ⚠️ **여기서 실패를 캐시해야 한다.** `_fetch_host_tmux_sessions` 안의 캐시
            # 기록은 예외 경로에 있는데, 우리가 태스크를 취소하면 거기 도달하지 못한다 —
            # 그러면 열 때마다 마감(6초)을 처음부터 다시 태운다(실측: 두 번째 조회도 6초).
            await cache.set(key_host_tmux_sessions(host_id), payload,
                            ttl_seconds=HOST_TMUX_ERROR_TTL_SEC)
            items.append(payload)
            continue
        error = task.exception()
        if error is not None:
            logger.warning("batch tmux-sessions exception (%s): %s", host_id, error)
            items.append({"id": host_id, "sessions": [], "error": "원격 tmux 세션 조회 실패"})
        else:
            items.append(task.result())
    return {"items": items}


@router.get("/api/hosts/{host_id}/tmux-sessions")
async def list_host_tmux_sessions(
    host_id: str,
    refresh: bool = Query(False, description="강제 새로고침 — 캐시 무시"),
    username: str = Depends(verify_auth_token),
):
    """원격 tmux 서버의 세션 목록. 좀비 세션 청소용.

    SSH 왕복이 500ms~2s 라 60s TTL 로 캐시. 세션 kill/spawn 시 invalidate_host 로 즉시 무효화.
    여러 호스트 동시 조회는 /api/hosts/tmux-sessions/batch 사용.
    """
    host = await storage.get_host(host_id, username)
    if not host:
        raise HTTPException(status_code=404, detail="호스트를 찾을 수 없습니다")
    payload = await _fetch_host_tmux_sessions(host, host_id, username, refresh)
    if payload.get("error"):
        raise HTTPException(status_code=500, detail=payload["error"])
    return payload


# --- 한 기능의 두 반쪽: itl + 리모트 ---------------------------------------------
#
# 화면에는 오래 **두 구획**으로 있었다. 만들어진 순서가 그랬기 때문이지, 사용자가
# 따로 고를 일이 있어서가 아니다. 실제로는 어느 한쪽만으로 되는 일이 없다:
#
#   itl 만  → 그 호스트의 에이전트가 **보낼** 수는 있다. 그런데 이쪽에서 그 호스트의
#            pane 을 볼 수도(`?`) 거기로 보낼 수도 없다.
#   리모트만 → 이쪽에서 보고 보낼 수 있다. 그런데 그 호스트의 에이전트는 `itl` 이
#            없어서 **답장도 호출도 못 한다.**
#
# 그래서 하나로 묶는다. 묻는 것도 까는 것도 한 번이다.

def _agent_ready(remote: dict, itl: dict) -> bool:
    """양방향이 다 되는가. **한쪽만 되면 ready 가 아니다** — 반쪽인 채로 "준비 완료"
    라고 적으면 사용자는 안 되는 이유를 다른 데서 찾는다."""
    return bool(remote.get("connected")) and bool(itl.get("installed")) and bool(itl.get("pane_path"))


async def _agent_status(host_id: str, username: str) -> dict:
    """리모트 + itl 상태를 한 덩어리로.

    ⚠️ 둘을 **병렬로** 묻는다. 각각 SSH 왕복이라 순서대로 하면 호스트 편집기를 열 때의
    대기가 두 배가 된다 — 이 저장소가 계속 줄여 온 쪽이다.

    ⚠️ itl 쪽이 실패해도 **전체를 실패로 만들지 않는다.** 리모트만 물어서 알 수 있는
    것이 이미 있고, 하나가 넘어졌다고 화면이 통째로 "조회 실패" 가 되면 사용자는 무엇이
    되는지도 모른 채 남는다.
    """
    from host_common import resolve_host_with_secrets
    from itl_remote_setup import remote_itl_status

    remote_task = asyncio.create_task(get_host_remote_status(host_id, username))

    async def _itl() -> dict:
        try:
            host, secrets = await resolve_host_with_secrets(host_id, username)
            return await remote_itl_status(host, secrets)
        except Exception as e:                       # noqa: BLE001
            logger.info("agent-status: itl 조회 실패 (%s): %s", host_id, e)
            return {"installed": None, "pane_path": None, "platform": None, "error": str(e)[:200]}

    remote, itl = await asyncio.gather(remote_task, _itl())
    return {"remote": remote, "itl": itl, "ready": _agent_ready(remote, itl)}


@router.get("/api/hosts/{host_id}/agent-status")
async def get_host_agent_status(host_id: str, username: str = Depends(verify_auth_token)):
    """이 호스트가 터미널 간 명령 주고받기에 참여하고 있는가 — 한 번에."""
    return await _agent_status(host_id, username)


@router.post("/api/hosts/{host_id}/agent-setup")
async def setup_host_agent(host_id: str, username: str = Depends(verify_auth_token)):
    """리모트 + itl 을 한 번에 설치한다. **사람이 누를 때만 일어난다.**

    ⚠️ **순서대로** 한다. 병렬은 조회에서만 하는 선택이다 — 설치는 둘 다 원격 셸에
    파일을 쓰므로, 겹쳐 돌려 얻는 몇 초보다 "어느 쪽이 실패했는지" 가 분명한 편이 낫다.

    ⚠️ **한쪽이 실패해도 다른 쪽은 진행한다.** 리모트가 안 깔리는 호스트(예: python3
    없음)에서 itl 까지 못 깔면 그 호스트는 아무것도 못 하게 된다. 결과는 상태로 말한다.
    """
    from host_common import resolve_host_with_secrets
    from itl_remote_setup import install_remote_itl

    errors: dict[str, str] = {}
    try:
        await install_host_remote(host_id, username)
    except Exception as e:                           # noqa: BLE001
        logger.warning("agent-setup: 리모트 설치 실패 (%s): %s", host_id, e)
        errors["remote"] = _detail_of(e)
    try:
        host, secrets = await resolve_host_with_secrets(host_id, username)
        await install_remote_itl(host, secrets)
    except Exception as e:                           # noqa: BLE001
        logger.warning("agent-setup: itl 설치 실패 (%s): %s", host_id, e)
        errors["itl"] = _detail_of(e)

    status = await _agent_status(host_id, username)
    status["errors"] = errors
    return status


def _detail_of(e: Exception) -> str:
    """HTTPException 이면 사람이 읽을 detail, 아니면 예외 문자열(길이 제한)."""
    detail = getattr(e, "detail", None)
    return str(detail or e)[:200]


@router.delete("/api/hosts/{host_id}")
async def delete_host(host_id: str, username: str = Depends(verify_auth_token)):
    ok = await storage.delete_host(host_id, username)
    if not ok:
        raise HTTPException(status_code=404, detail="호스트를 찾을 수 없습니다")
    # 사용량은 같이 지우지 않는다 — 지난달 비용이 삭제 한 번으로 증발하면 되돌릴 수 없다.
    # 은퇴 표시만 남기고 보관 기간(llm_usage.service.RETIRED_RETENTION_DAYS) 뒤 자동 정리,
    # 그 전에 지우고 싶으면 대시보드의 삭제 버튼이 즉시 처리한다.
    await storage.retire_llm_source(username, host_id)
    return {"id": host_id, "status": "deleted"}



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


@router.get("/api/hosts/{host_id}/remote-status")
async def get_host_remote_status(host_id: str, username: str = Depends(verify_auth_token)):
    """리모트가 이 호스트에 깔려 있는가 · 돌고 있는가 · 지금 붙어 있는가.

    **설치는 선택이다.** 안 깔아도 백엔드가 SSH 로 관찰자를 띄우는 경로가 그대로 있고,
    이 응답의 `optional: True` 가 화면에 그 사실을 적게 한다 — 아이콘이 "안 깔림" 을
    경고처럼 보여 주면, 강요할 생각이 없는데도 강요처럼 읽힌다.
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


@router.post("/api/hosts/{host_id}/remote-install")
async def install_host_remote(host_id: str, username: str = Depends(verify_auth_token)):
    """리모트를 이 호스트에 얹는다. 사람이 누를 때만 일어난다.

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

    script = build_install_script(ws_url, str(host.get("remote_tmux_session") or ""))
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


@router.post("/api/hosts/{host_id}/kill-tmux")
async def kill_host_tmux(
    host_id: str,
    force: bool = Query(False, description="true 면 tmux kill-server (전체 nuke)"),
    session: str | None = Query(None, description="특정 세션 이름 직접 지정 (예: mobile.2). 없으면 호스트 기본"),
    username: str = Depends(verify_auth_token),
):
    """원격 tmux 세션 종료.

    - force=True: `tmux kill-server` (전체 nuke)
    - session 지정: 그 세션만 kill (분할 pane 의 자동 부여된 세션 정리용)
    - 둘 다 없으면 호스트의 기본 세션 kill
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
    safe = shlex.quote(target_session)
    cmd = "tmux kill-server 2>/dev/null; true" if force else f"tmux has-session -t {safe} 2>/dev/null && tmux kill-session -t {safe}"
    try:
        # tailscale auth 면 일반 ssh open_connection 안 됨 → tailscale ssh exec
        if host.get("auth_method") == "tailscale":
            target = f"{host.get('ssh_user') or 'root'}@{host['hostname']}"
            proc = await asyncio.create_subprocess_exec(
                "tailscale", "ssh", target, cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await asyncio.wait_for(proc.communicate(), timeout=10)
        else:
            conn = await open_connection(
                host,
                private_key=secrets["private_key"],
                passphrase=secrets["passphrase"],
                password=secrets["password"],
            )
            try:
                await conn.run(cmd, check=False)
            finally:
                conn.close()
                await conn.wait_closed()
    except Exception as e:
        logger.error("kill-tmux failed (%s, force=%s, session=%s): %s", host_id, force, target_session, e)
        raise HTTPException(status_code=500, detail="tmux 세션 종료에 실패했습니다.")
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


@router.get("/api/hosts/{host_id}/itl-status")
async def get_host_itl_status(host_id: str, username: str = Depends(verify_auth_token)):
    """원격 호스트의 itl CLI 설치 상태 + 수동 셋업 명령(비밀 미포함).

    - installed: ~/.local/bin/itl 파일 존재
    - pane_path: login shell(tmux pane 과 동일한 시작 방식)에서 itl 이 PATH 에 잡히는지
    """
    from host_common import resolve_host_with_secrets
    from itl_remote_setup import remote_itl_status
    host, secrets = await resolve_host_with_secrets(host_id, username)
    try:
        return await remote_itl_status(host, secrets)
    except Exception as e:
        logger.warning("itl-status failed (%s): %s", host_id, e)
        raise HTTPException(status_code=500, detail="itl 상태 조회에 실패했습니다")


@router.post("/api/hosts/{host_id}/itl-setup")
async def setup_host_itl(host_id: str, username: str = Depends(verify_auth_token)):
    """원격 호스트 ~/.local/bin/itl 영구 설치(멱등) + ~/.profile PATH 정리.

    CLI 본문은 배포 저장소의 backend/cli/itl 을 요청 시 읽어 stdin 으로 흘려보낸다
    — 사용자 입력이 원격 셸에 들어가는 경로가 없고, 비밀도 디스크에 안 남는다.
    """
    from host_common import resolve_host_with_secrets
    from itl_remote_setup import install_remote_itl
    host, secrets = await resolve_host_with_secrets(host_id, username)
    try:
        return await install_remote_itl(host, secrets)
    except Exception as e:
        logger.warning("itl-setup failed (%s): %s", host_id, e)
        raise HTTPException(status_code=500, detail="itl 설치에 실패했습니다")


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



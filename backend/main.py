"""
Terminal List - 백엔드 FastAPI 서버

세션 영속성은 호스트의 tmux 서버가 담당한다.
- 백엔드는 tmux 서버에 명령을 보내고, WebSocket↔tmux client PTY를 중계한다.
- 백엔드가 죽어도 tmux 서버가 살아있으면 세션은 유지된다.
- 동일 세션에 웹/SSH 등 여러 클라이언트가 동시 attach 가능하다.
"""
import asyncio
import json
import logging
import os
import shutil
import time
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv

# .env 로드 (프로젝트 루트)
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(_PROJECT_ROOT, ".env"))

from fastapi import (
    Depends, FastAPI, Header, HTTPException, Query, WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.types import Receive, Scope, Send

from auth_manager import AuthManager
from sqlite_storage import storage
from tmux_manager import tmux_manager
from ws_bridge import TmuxClientBridge
from host_manager import HostBridge, resolve_host_secrets
from vault import encrypt_str

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


# ---------------------- 앱 / 미들웨어 ----------------------

app = FastAPI(title="Terminal List", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)


class CachedStaticFiles(StaticFiles):
    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                headers = dict(message.get("headers", []))
                if scope["path"].endswith((".js", ".css")):
                    headers[b"cache-control"] = b"public, max-age=31536000, immutable"
                else:
                    headers[b"cache-control"] = b"public, max-age=3600"
                message["headers"] = list(headers.items())
            await send(message)

        await super().__call__(scope, receive, send_wrapper)


# ---------------------- 워크스페이스 ----------------------

# 호스트 설치 전제: 기본값은 프로젝트 루트의 workspace/.
# .env 의 WORKSPACE_ROOT 로 오버라이드 가능.
_DEFAULT_WORKSPACE = os.path.join(_PROJECT_ROOT, "workspace")
WORKSPACE_ROOT = os.path.abspath(os.getenv("WORKSPACE_ROOT") or _DEFAULT_WORKSPACE)
os.makedirs(WORKSPACE_ROOT, exist_ok=True)
logger.info("WORKSPACE_ROOT = %s", WORKSPACE_ROOT)


def validate_path(path) -> Path:
    """워크스페이스 외부 접근을 차단하며 안전한 절대 경로 반환."""
    workspace_abs = os.path.abspath(WORKSPACE_ROOT)
    if path is None or str(path).strip() in ("/", "", "None"):
        return Path(workspace_abs)
    clean = os.path.normpath(str(path).strip().lstrip("/")).replace("..", "")
    requested = os.path.abspath(os.path.join(workspace_abs, clean))
    if not requested.startswith(workspace_abs):
        return Path(workspace_abs)
    return Path(requested)


# ---------------------- 모델 ----------------------

class ResizeRequest(BaseModel):
    cols: int
    rows: int


class SessionCreateRequest(BaseModel):
    cols: int = 80
    rows: int = 24
    cwd: Optional[str] = None
    shell: Optional[str] = None


class SessionNameRequest(BaseModel):
    name: str


class SetupRequest(BaseModel):
    username: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


class FileWriteRequest(BaseModel):
    path: str
    content: str


class FileCreateRequest(BaseModel):
    path: str
    type: str  # "file" or "directory"


class FileMoveRequest(BaseModel):
    source: str
    destination: str


class SshKeyCreateRequest(BaseModel):
    name: str
    private_key: str
    passphrase: Optional[str] = None
    public_key: Optional[str] = None


class HostUpsertRequest(BaseModel):
    name: str
    hostname: str
    port: int = 22
    ssh_user: str
    auth_method: str = "key"        # 'key' | 'password'
    key_id: Optional[str] = None
    password: Optional[str] = None  # 평문으로 들어와서 vault 로 암호화 후 저장
    color_index: int = 0
    group_name: Optional[str] = None
    use_remote_tmux: bool = True
    remote_tmux_session: Optional[str] = "mobile"


# ---------------------- 시스템 모니터 ----------------------

class SystemMonitor:
    def __init__(self):
        self.last_cpu_time = 0
        self.last_idle_time = 0
        self.last_update = 0
        self.cached_cpu_percent = 0.0

    def get_stats(self):
        stats = {"cpu": 0, "ram": 0, "disk": 0}
        try:
            if os.path.exists("/proc/meminfo"):
                total = available = 0
                with open("/proc/meminfo") as f:
                    for line in f:
                        if line.startswith("MemTotal:"):
                            total = int(line.split()[1])
                        elif line.startswith("MemAvailable:"):
                            available = int(line.split()[1])
                if total > 0:
                    stats["ram"] = round((total - available) / total * 100, 1)

            try:
                usage = os.statvfs(WORKSPACE_ROOT)
                d_total = usage.f_blocks * usage.f_frsize
                d_free = usage.f_bfree * usage.f_frsize
                if d_total > 0:
                    stats["disk"] = round((d_total - d_free) / d_total * 100, 1)
            except Exception:
                pass

            now = time.time()
            if os.path.exists("/proc/stat") and now - self.last_update > 1.0:
                with open("/proc/stat") as f:
                    parts = f.readline().split()
                if len(parts) >= 5:
                    user = int(parts[1]); nice = int(parts[2]); system = int(parts[3])
                    idle = int(parts[4])
                    iowait = int(parts[5]) if len(parts) > 5 else 0
                    irq = int(parts[6]) if len(parts) > 6 else 0
                    softirq = int(parts[7]) if len(parts) > 7 else 0
                    total_cpu = user + nice + system + idle + iowait + irq + softirq
                    if self.last_cpu_time > 0:
                        diff_total = total_cpu - self.last_cpu_time
                        diff_idle = idle - self.last_idle_time
                        if diff_total > 0:
                            self.cached_cpu_percent = round((1 - diff_idle / diff_total) * 100, 1)
                    self.last_cpu_time = total_cpu
                    self.last_idle_time = idle
                    self.last_update = now

            stats["cpu"] = self.cached_cpu_percent
        except Exception as e:
            logger.error("system stats error: %s", e)
        return stats


system_monitor = SystemMonitor()


# ---------------------- 라이프사이클 ----------------------

auth_manager: Optional[AuthManager] = None


@app.on_event("startup")
async def startup_event():
    global auth_manager
    logger.info("=== Terminal List 시작 ===")
    await storage.connect()
    auth_manager = AuthManager(storage)
    if not shutil.which("tmux"):
        logger.error("tmux 바이너리를 찾을 수 없습니다. 호스트에 tmux를 설치해주세요.")


@app.on_event("shutdown")
async def shutdown_event():
    logger.info("=== Terminal List 종료 ===")
    await storage.close()


# ---------------------- 인증 ----------------------

async def verify_auth_token(
    authorization: Optional[str] = Header(None),
    token: Optional[str] = Query(None),
) -> str:
    actual = None
    if authorization and authorization.startswith("Bearer "):
        actual = authorization[len("Bearer "):]
    elif token:
        actual = token
    if not actual:
        raise HTTPException(status_code=401, detail="인증 토큰이 필요합니다")
    username = await auth_manager.verify_token(actual)
    if not username:
        raise HTTPException(status_code=401, detail="유효하지 않은 토큰입니다")
    return username


async def verify_auth_token_ws(token: str) -> Optional[str]:
    if not token or not auth_manager:
        return None
    return await auth_manager.verify_token(token)


# ---------------------- 인증 API ----------------------

@app.get("/api/health")
async def health_check():
    return {"service": "Terminal List", "status": "running", "version": "2.0.0"}


@app.get("/api/auth/status")
async def auth_status():
    if auth_manager is None:
        return {"setup_complete": False}
    return {"setup_complete": await auth_manager.is_setup_complete()}


@app.post("/api/auth/setup")
async def setup_admin(request: SetupRequest):
    if auth_manager is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    if await auth_manager.is_setup_complete():
        raise HTTPException(status_code=400, detail="이미 초기 설정이 완료되었습니다")
    if len(request.username) < 3:
        raise HTTPException(status_code=400, detail="사용자명은 3자 이상이어야 합니다")
    if len(request.password) < 8:
        raise HTTPException(status_code=400, detail="비밀번호는 8자 이상이어야 합니다")
    if not await auth_manager.create_admin(request.username, request.password):
        raise HTTPException(status_code=500, detail="관리자 계정 생성 실패")
    return {"success": True, "message": "관리자 계정이 생성되었습니다"}


@app.post("/api/auth/login")
async def login(request: LoginRequest):
    if auth_manager is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    if not await auth_manager.is_setup_complete():
        raise HTTPException(status_code=400, detail="초기 설정을 먼저 완료해주세요")
    if not await auth_manager.verify_admin(request.username, request.password):
        raise HTTPException(status_code=401, detail="사용자명 또는 비밀번호가 올바르지 않습니다")
    access_token = await auth_manager.create_access_token(request.username)
    return {"access_token": access_token, "token_type": "bearer", "username": request.username}


@app.get("/api/auth/verify")
async def verify_token(username: str = Depends(verify_auth_token)):
    return {"valid": True, "username": username}


@app.get("/api/system/stats")
async def get_system_stats(username: str = Depends(verify_auth_token)):
    return system_monitor.get_stats()


# ---------------------- 세션 API ----------------------

def _basename_or_none(p: Optional[str]) -> Optional[str]:
    return os.path.basename(p) if p else None


def _resolve_create_cwd(req_cwd: Optional[str]) -> str:
    """세션 생성 cwd 결정. 워크스페이스 외부는 차단."""
    if not req_cwd:
        return os.path.abspath(WORKSPACE_ROOT)
    target = validate_path(req_cwd)
    if not target.exists():
        raise HTTPException(status_code=400, detail=f"디렉토리가 존재하지 않습니다: {req_cwd}")
    if not target.is_dir():
        raise HTTPException(status_code=400, detail=f"디렉토리가 아닙니다: {req_cwd}")
    if not os.access(str(target), os.X_OK):
        raise HTTPException(status_code=400, detail=f"디렉토리에 접근 권한이 없습니다: {req_cwd}")
    return str(target.absolute())


def _resolve_shell(requested: Optional[str]) -> Optional[str]:
    """프론트가 보내는 'auto'/'bash'/'zsh'/'sh' 를 실제 실행 경로로 변환."""
    candidates = {
        "bash": ["/bin/bash", "/usr/bin/bash"],
        "zsh": ["/bin/zsh", "/usr/bin/zsh"],
        "sh": ["/bin/sh", "/usr/bin/sh"],
    }
    if not requested or requested.strip().lower() in ("auto", ""):
        return None  # tmux가 사용자 기본 셸 사용
    key = requested.strip().lower()
    for path in candidates.get(key, []):
        if os.path.exists(path) and os.access(path, os.X_OK):
            return path
    return None


@app.get("/api/sessions", response_model=List[dict])
async def list_sessions(username: str = Depends(verify_auth_token)):
    """DB에 기록된 사용자 세션 목록 (tmux에 살아있는지 여부와 무관)."""
    db_sessions = await storage.get_user_sessions(username)
    # tmux에 실제 살아있는 세션과 교차 참조
    live = {s.name for s in await tmux_manager.list_sessions()}
    return [{**s, "alive": s["id"] in live} for s in db_sessions]


@app.post("/api/sessions/{session_id}")
async def create_session(
    session_id: str,
    request: SessionCreateRequest,
    username: str = Depends(verify_auth_token),
):
    """tmux 세션 생성 + DB 등록."""
    logger.info("[API] create session %s (cwd=%s, shell=%s)", session_id, request.cwd, request.shell)

    safe_cwd = _resolve_create_cwd(request.cwd)
    shell_path = _resolve_shell(request.shell)

    try:
        await tmux_manager.create_session(
            session_id,
            cols=request.cols or 80,
            rows=request.rows or 24,
            cwd=safe_cwd,
            shell=shell_path,
        )
    except Exception as e:
        logger.error("tmux create failed (%s): %s", session_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"터미널 실행 실패: {e}")

    try:
        await storage.create_session(session_id, username, cwd=request.cwd or "")
    except Exception as e:
        logger.warning("session db record failed (%s): %s", session_id, e)

    return {
        "session_id": session_id,
        "status": "created",
        "cwd": safe_cwd,
        "shell": shell_path,
        "shell_name": _basename_or_none(shell_path),
    }


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str, username: str = Depends(verify_auth_token)):
    await tmux_manager.kill_session(session_id)
    await storage.delete_session(session_id)
    return {"session_id": session_id, "status": "deleted"}


@app.post("/api/sessions/{session_id}/resize")
async def resize_terminal(
    session_id: str,
    request: ResizeRequest,
    username: str = Depends(verify_auth_token),
):
    if not await tmux_manager.session_exists(session_id):
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    await tmux_manager.resize_window(session_id, request.cols, request.rows)
    return {"session_id": session_id, "cols": request.cols, "rows": request.rows, "status": "resized"}


@app.get("/api/sessions/{session_id}/cwd")
async def get_session_cwd(session_id: str, username: str = Depends(verify_auth_token)):
    """활성 pane 의 현재 작업 디렉토리. 워크스페이스 내부면 상대 경로도 같이 반환."""
    cwd = await tmux_manager.get_pane_cwd(session_id)
    if not cwd:
        return {"session_id": session_id, "cwd": None, "workspace_relative": None, "in_workspace": False}
    workspace_abs = os.path.abspath(WORKSPACE_ROOT)
    in_workspace = cwd == workspace_abs or cwd.startswith(workspace_abs + os.sep)
    workspace_relative = None
    if in_workspace:
        rel = os.path.relpath(cwd, workspace_abs).replace("\\", "/")
        workspace_relative = "" if rel == "." else rel
    return {
        "session_id": session_id,
        "cwd": cwd,
        "workspace_relative": workspace_relative,
        "in_workspace": in_workspace,
    }


@app.patch("/api/sessions/{session_id}/name")
async def update_session_name(
    session_id: str,
    request: SessionNameRequest,
    username: str = Depends(verify_auth_token),
):
    await storage.update_session_name(session_id, request.name)
    return {"session_id": session_id, "name": request.name, "status": "updated"}


# ---------------------- WebSocket 터미널 ----------------------

@app.websocket("/ws/{session_id}")
async def terminal_websocket(
    websocket: WebSocket,
    session_id: str,
    token: Optional[str] = Query(None),
    cols: int = Query(80),
    rows: int = Query(24),
    cwd: Optional[str] = Query(None),
    shell: Optional[str] = Query(None),
):
    username = await verify_auth_token_ws(token) if token else None
    if not username:
        username = "admin"  # 인증 실패해도 기본 사용자로 진행 (기존 동작 유지)

    await websocket.accept()
    logger.info("WS attach: session=%s user=%s", session_id, username)

    # 세션이 없으면 생성 (백엔드 재시작 후 첫 연결 또는 직접 WS로 진입한 경우)
    if not await tmux_manager.session_exists(session_id):
        try:
            safe_cwd = _resolve_create_cwd(cwd)
        except HTTPException as e:
            await websocket.close(code=1008, reason=e.detail)
            return
        try:
            await tmux_manager.create_session(
                session_id,
                cols=cols,
                rows=rows,
                cwd=safe_cwd,
                shell=_resolve_shell(shell),
            )
            try:
                await storage.create_session(session_id, username, cwd=cwd or "")
            except Exception:
                pass
        except Exception as e:
            logger.error("tmux create on WS failed (%s): %s", session_id, e)
            await websocket.close(code=1011, reason=f"tmux create failed: {e}")
            return
    else:
        try:
            await storage.update_session_activity(session_id)
        except Exception:
            pass

    bridge = TmuxClientBridge(
        websocket=websocket,
        session_id=session_id,
        attach_argv=tmux_manager.attach_argv(session_id),
        cols=cols,
        rows=rows,
    )
    try:
        await bridge.run()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("WS bridge error (%s): %s", session_id, e)


# ---------------------- SSH 키 API ----------------------

@app.get("/api/ssh-keys")
async def list_ssh_keys(username: str = Depends(verify_auth_token)):
    return {"items": await storage.list_ssh_keys(username)}


@app.post("/api/ssh-keys")
async def create_ssh_key(request: SshKeyCreateRequest, username: str = Depends(verify_auth_token)):
    import uuid
    key_id = str(uuid.uuid4())
    private_key_enc = encrypt_str(request.private_key)
    if private_key_enc is None:
        raise HTTPException(status_code=400, detail="개인키가 비어있습니다")
    passphrase_enc = encrypt_str(request.passphrase) if request.passphrase else None
    await storage.create_ssh_key(
        key_id=key_id,
        username=username,
        name=request.name,
        public_key=request.public_key,
        private_key_enc=private_key_enc,
        passphrase_enc=passphrase_enc,
    )
    return {"id": key_id, "name": request.name, "status": "created"}


@app.delete("/api/ssh-keys/{key_id}")
async def delete_ssh_key(key_id: str, username: str = Depends(verify_auth_token)):
    ok = await storage.delete_ssh_key(key_id, username)
    if not ok:
        raise HTTPException(status_code=404, detail="키를 찾을 수 없습니다")
    return {"id": key_id, "status": "deleted"}


# ---------------------- 호스트 API ----------------------

@app.get("/api/hosts")
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
    }
    if req.auth_method == "password" and req.password:
        fields["password_enc"] = encrypt_str(req.password)
    return fields


@app.post("/api/hosts")
async def create_host(request: HostUpsertRequest, username: str = Depends(verify_auth_token)):
    import uuid
    host_id = str(uuid.uuid4())
    fields = _host_payload_to_fields(request)
    await storage.upsert_host(host_id, username, **fields)
    return {"id": host_id, "status": "created"}


@app.patch("/api/hosts/{host_id}")
async def update_host(host_id: str, request: HostUpsertRequest, username: str = Depends(verify_auth_token)):
    existing = await storage.get_host(host_id, username)
    if not existing:
        raise HTTPException(status_code=404, detail="호스트를 찾을 수 없습니다")
    fields = _host_payload_to_fields(request)
    await storage.upsert_host(host_id, username, **fields)
    return {"id": host_id, "status": "updated"}


@app.delete("/api/hosts/{host_id}")
async def delete_host(host_id: str, username: str = Depends(verify_auth_token)):
    ok = await storage.delete_host(host_id, username)
    if not ok:
        raise HTTPException(status_code=404, detail="호스트를 찾을 수 없습니다")
    return {"id": host_id, "status": "deleted"}


# ---------------------- WebSocket: SSH 호스트 ----------------------

@app.websocket("/ws/host/{host_id}")
async def host_websocket(
    websocket: WebSocket,
    host_id: str,
    token: Optional[str] = Query(None),
    cols: int = Query(80),
    rows: int = Query(24),
):
    username = await verify_auth_token_ws(token) if token else None
    if not username:
        await websocket.close(code=1008, reason="인증 필요")
        return

    host = await storage.get_host(host_id, username)
    if not host:
        await websocket.close(code=1008, reason="호스트를 찾을 수 없음")
        return

    key_record = None
    if host.get("auth_method") == "key" and host.get("key_id"):
        key_record = await storage.get_ssh_key(host["key_id"], username)
        if not key_record:
            await websocket.close(code=1008, reason="연결된 SSH 키를 찾을 수 없음")
            return

    secrets = resolve_host_secrets(host, key_record)
    await websocket.accept()
    try:
        await storage.touch_host(host_id, username)
    except Exception:
        pass

    bridge = HostBridge(
        websocket=websocket,
        host=host,
        private_key=secrets["private_key"],
        passphrase=secrets["passphrase"],
        password=secrets["password"],
        cols=cols,
        rows=rows,
    )
    try:
        await bridge.run()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("host WS bridge error (%s): %s", host_id, e, exc_info=True)


# ---------------------- 파일 시스템 API ----------------------

async def get_git_status(_: Path) -> dict:
    try:
        proc = await asyncio.create_subprocess_exec(
            "git", "status", "--porcelain=v1", "-uall",
            cwd=os.path.abspath(WORKSPACE_ROOT),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _err = await proc.communicate()
        result: dict = {}
        if stdout:
            for line in stdout.decode().splitlines():
                if len(line) > 3:
                    result[line[3:].strip().strip('"')] = line[:2].strip()
        return result
    except Exception as e:
        logger.error("git status failed: %s", e)
        return {}


async def _find_repo_root(start_path: str) -> Optional[str]:
    """주어진 경로에서 위로 올라가며 git 저장소 루트를 찾는다. 없으면 None."""
    if not os.path.isdir(start_path):
        start_path = os.path.dirname(start_path) or start_path
    try:
        proc = await asyncio.create_subprocess_exec(
            "git", "-C", start_path, "rev-parse", "--show-toplevel",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await proc.communicate()
        if proc.returncode != 0:
            return None
        return out.decode("utf-8", errors="replace").strip() or None
    except FileNotFoundError:
        return None


@app.get("/api/git/status")
async def git_status(
    path: str = Query("", description="포커스된 폴더 경로 (워크스페이스 상대). 비우면 워크스페이스 루트."),
    username: str = Depends(verify_auth_token),
):
    """주어진 경로(또는 워크스페이스 루트)에서 발견한 git 저장소의 변경 사항을 반환.

    경로가 git 저장소가 아니면 위로 올라가며 자동 탐색. 그래도 없으면 빈 응답 + repo=None.
    """
    target = str(validate_path(path).absolute()) if path else os.path.abspath(WORKSPACE_ROOT)
    repo_root = await _find_repo_root(target)
    if not repo_root:
        return {"items": [], "branch": None, "repo": None, "error": None}

    try:
        proc = await asyncio.create_subprocess_exec(
            "git", "-C", repo_root, "status", "--porcelain=v1", "-uall",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            return {
                "items": [],
                "branch": None,
                "repo": repo_root,
                "error": stderr.decode("utf-8", errors="replace").strip() or "git status failed",
            }

        workspace_abs = os.path.abspath(WORKSPACE_ROOT)
        # 워크스페이스에 대한 상대 경로 prefix (FileTree 의 path 와 매칭하기 위해)
        repo_rel_prefix = os.path.relpath(repo_root, workspace_abs).replace("\\", "/")
        if repo_rel_prefix in (".", ""):
            repo_rel_prefix = ""

        items = []
        for line in stdout.decode().splitlines():
            if len(line) < 3:
                continue
            staged_code = line[0]
            unstaged_code = line[1]
            rel_to_repo = line[3:].strip().strip('"')
            kind = (
                "untracked" if line[:2] == "??"
                else "deleted" if "D" in line[:2]
                else "added" if "A" in line[:2]
                else "modified"
            )
            workspace_rel = (
                f"{repo_rel_prefix}/{rel_to_repo}" if repo_rel_prefix else rel_to_repo
            )
            items.append({
                "path": workspace_rel,            # FileTree 트리 path 매칭용
                "repo_path": rel_to_repo,         # diff 호출 시 사용
                "code": (staged_code + unstaged_code).strip(),
                "kind": kind,
                "staged": staged_code not in (" ", "?"),
            })

        branch_proc = await asyncio.create_subprocess_exec(
            "git", "-C", repo_root, "rev-parse", "--abbrev-ref", "HEAD",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        b_out, _ = await branch_proc.communicate()
        branch = b_out.decode().strip() if branch_proc.returncode == 0 else None

        return {
            "items": items,
            "branch": branch,
            "repo": repo_root,
            "repo_relative": repo_rel_prefix,
            "error": None,
        }
    except FileNotFoundError:
        return {"items": [], "branch": None, "repo": None, "error": "git binary not found"}
    except Exception as e:
        logger.error("git status endpoint failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/git/diff")
async def git_diff(
    path: str = Query(...),
    staged: bool = Query(False),
    username: str = Depends(verify_auth_token),
):
    """단일 파일의 git diff. path 는 워크스페이스 상대 경로."""
    safe = validate_path(path)
    repo_root = await _find_repo_root(str(safe))
    if not repo_root:
        raise HTTPException(status_code=404, detail="해당 파일이 속한 git 저장소를 찾을 수 없습니다")

    rel_to_repo = os.path.relpath(str(safe.absolute()), repo_root).replace("\\", "/")
    args = ["git", "-C", repo_root, "diff"]
    if staged:
        args.append("--cached")
    args += ["--no-color", "--", rel_to_repo]

    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            err = stderr.decode("utf-8", errors="replace").strip()
            raise HTTPException(status_code=500, detail=err or "git diff failed")
        return {
            "path": path,
            "repo": repo_root,
            "repo_path": rel_to_repo,
            "patch": stdout.decode("utf-8", errors="replace"),
            "staged": staged,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("git diff failed (%s): %s", path, e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/files/workspace")
async def get_workspace_info(username: str = Depends(verify_auth_token)):
    return {
        "root": os.path.abspath(WORKSPACE_ROOT),
        "name": os.path.basename(os.path.abspath(WORKSPACE_ROOT)),
    }


@app.get("/api/files")
async def list_files(
    path: str = Query(""),
    username: str = Depends(verify_auth_token),
):
    workspace_abs = os.path.abspath(WORKSPACE_ROOT)
    safe_path = validate_path(path)

    if not safe_path.exists():
        raise HTTPException(status_code=404, detail=f"Path not found: {safe_path}")
    if not safe_path.is_dir():
        raise HTTPException(status_code=400, detail="Not a directory")

    git_statuses = await get_git_status(safe_path)
    items = []
    for item in safe_path.iterdir():
        try:
            relative = os.path.relpath(os.path.abspath(str(item)), workspace_abs).replace("\\", "/")
            git_status = git_statuses.get(relative)
            if not git_status and item.is_dir():
                for f_path in git_statuses:
                    if f_path.startswith(relative + "/"):
                        git_status = "M"
                        break
            items.append({
                "name": item.name,
                "path": relative,
                "type": "directory" if item.is_dir() else "file",
                "size": item.stat().st_size if item.is_file() else None,
                "modified": item.stat().st_mtime,
                "git_status": git_status,
            })
        except Exception as e:
            logger.warning("Failed to read item %s: %s", item, e)
            continue

    items.sort(key=lambda x: (x["type"] == "file", x["name"].lower()))
    return {"items": items}


@app.get("/api/files/search")
async def search_files(
    q: str = Query("", min_length=0),
    limit: int = Query(200, ge=1, le=500),
    username: str = Depends(verify_auth_token),
):
    query = q.strip().lower()
    if not query:
        return {"items": []}

    workspace_abs = os.path.abspath(WORKSPACE_ROOT)
    ignored = {".git", "node_modules", "dist", "build", "coverage", "__pycache__",
               ".venv", "venv", ".next", ".turbo", ".idea", ".vscode"}
    matches = []
    try:
        for current_root, dirs, files in os.walk(workspace_abs):
            dirs[:] = [d for d in dirs if d not in ignored]
            for file_name in files:
                rel = os.path.relpath(os.path.join(current_root, file_name), workspace_abs).replace("\\", "/")
                if query not in f"{file_name} {rel}".lower():
                    continue
                matches.append({"name": file_name, "path": rel})
                if len(matches) >= limit:
                    break
            if len(matches) >= limit:
                break
        matches.sort(key=lambda item: (not item["name"].lower().startswith(query), item["path"].lower()))
        return {"items": matches}
    except Exception as e:
        logger.error("search files failed (q=%s): %s", q, e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/files/raw")
async def get_raw_file(path: str = Query(...), username: str = Depends(verify_auth_token)):
    safe = validate_path(path)
    if not safe.exists() or not safe.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(safe))


@app.get("/api/files/read")
async def read_file(path: str = Query(...), username: str = Depends(verify_auth_token)):
    safe = validate_path(path)
    if not safe.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if not safe.is_file():
        raise HTTPException(status_code=400, detail="Not a file")
    if safe.stat().st_size > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 10MB)")
    try:
        return {"content": safe.read_text(encoding="utf-8"), "path": path}
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Binary file not supported")


@app.post("/api/files/write")
async def write_file(request: FileWriteRequest, username: str = Depends(verify_auth_token)):
    safe = validate_path(request.path)
    safe.parent.mkdir(parents=True, exist_ok=True)
    safe.write_text(request.content, encoding="utf-8")
    return {"status": "written", "path": request.path}


@app.post("/api/files/move")
async def move_file(request: FileMoveRequest, username: str = Depends(verify_auth_token)):
    src = validate_path(request.source)
    dst = validate_path(request.destination)
    if not src.exists():
        raise HTTPException(status_code=404, detail="Source not found")
    if dst.exists():
        raise HTTPException(status_code=409, detail="Destination already exists")
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), str(dst))
    return {"status": "moved", "source": request.source, "destination": request.destination}


@app.post("/api/files/create")
async def create_file(request: FileCreateRequest, username: str = Depends(verify_auth_token)):
    safe = validate_path(request.path)
    if safe.exists():
        raise HTTPException(status_code=409, detail="Already exists")
    if request.type == "directory":
        safe.mkdir(parents=True, exist_ok=True)
    elif request.type == "file":
        safe.parent.mkdir(parents=True, exist_ok=True)
        safe.touch()
    else:
        raise HTTPException(status_code=400, detail="Invalid type (must be 'file' or 'directory')")
    return {"status": "created", "path": request.path, "type": request.type}


@app.delete("/api/files")
async def delete_file(path: str = Query(...), username: str = Depends(verify_auth_token)):
    safe = validate_path(path)
    if not safe.exists():
        raise HTTPException(status_code=404, detail="Not found")
    if safe.is_dir():
        shutil.rmtree(safe)
    else:
        safe.unlink()
    return {"status": "deleted", "path": path}


# ---------------------- 에러 / 정적 ----------------------

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.error("Unhandled exception: %s", exc, exc_info=True)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


STATIC_DIR = Path(__file__).parent / "static"
if STATIC_DIR.exists():
    app.mount("/assets", CachedStaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")

    @app.get("/")
    async def serve_frontend():
        return FileResponse(str(STATIC_DIR / "index.html"))

    @app.get("/{full_path:path}")
    async def catch_all(full_path: str):
        if full_path.startswith("api/") or full_path.startswith("ws/"):
            raise HTTPException(status_code=404, detail="Not found")
        file_path = STATIC_DIR / full_path
        if file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(STATIC_DIR / "index.html"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("APP_PORT", "8000")),
        reload=os.getenv("RELOAD", "true").lower() == "true",
        log_level=os.getenv("LOG_LEVEL", "info").lower(),
    )

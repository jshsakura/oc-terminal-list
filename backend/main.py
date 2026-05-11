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
import shlex
import shutil
import time
from pathlib import Path

from dotenv import load_dotenv
from fastapi import (
    Depends,
    FastAPI,
    Header,
    HTTPException,
    Query,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.types import Receive, Scope, Send

from auth_manager import AuthManager
from host_manager import HostBridge, resolve_host_secrets
from sqlite_storage import storage
from tmux_manager import tmux_manager
from vault import encrypt_str
from ws_bridge import TmuxClientBridge

# .env 로드 (프로젝트 루트). 실행 셸의 TMUX_SOCKET_NAME 이 앱 격리를 깨지 않도록 .env 를 우선한다.
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(_PROJECT_ROOT, ".env"), override=True)

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
    cwd: str | None = None
    shell: str | None = None


class SessionNameRequest(BaseModel):
    name: str


class SetupRequest(BaseModel):
    username: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


class OtpLoginRequest(BaseModel):
    pending_token: str
    code: str
    is_backup_code: bool = False


class OtpEnableRequest(BaseModel):
    code: str


class OtpDisableRequest(BaseModel):
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
    passphrase: str | None = None
    public_key: str | None = None


class SshKeyUpdateRequest(BaseModel):
    # 모든 필드 옵셔널. private_key 가 비어있으면 기존 키 유지 (보안: 평문 노출 방지를 위한 write-once 정책 유지).
    name: str | None = None
    private_key: str | None = None  # 새 키로 교체할 때만 채움
    passphrase: str | None = None
    clear_passphrase: bool = False     # passphrase 제거 의도 명시 (빈 문자열과 구분)
    public_key: str | None = None


class HostUpsertRequest(BaseModel):
    name: str
    hostname: str
    port: int = 22
    ssh_user: str
    auth_method: str = "key"        # 'key' | 'password'
    key_id: str | None = None
    password: str | None = None  # 평문으로 들어와서 vault 로 암호화 후 저장
    color_index: int = 0
    group_name: str | None = None
    use_remote_tmux: bool = True
    remote_tmux_session: str | None = "mobile"
    start_path: str | None = None
    icon: str | None = None
    theme: str | None = None  # pane.themeOverride 자동 적용용 (없으면 글로벌 settings.theme)


# ---------------------- 시스템 모니터 ----------------------

class SystemMonitor:
    def __init__(self):
        self.last_cpu_time = 0
        self.last_idle_time = 0
        self.last_update = 0
        self.cached_cpu_percent = 0.0

    def get_stats(self):
        # 백워드 호환 — 기존 'cpu/ram/disk' 퍼센트는 그대로 두고 절대값/load/uptime 을 추가.
        stats: dict = {"cpu": 0.0, "ram": 0.0, "disk": 0.0}
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
                    stats["mem_total"] = total * 1024            # bytes
                    stats["mem_used"] = (total - available) * 1024

            try:
                usage = os.statvfs(WORKSPACE_ROOT)
                d_total = usage.f_blocks * usage.f_frsize
                d_free = usage.f_bfree * usage.f_frsize
                if d_total > 0:
                    stats["disk"] = round((d_total - d_free) / d_total * 100, 1)
                    stats["disk_total"] = d_total
                    stats["disk_used"] = d_total - d_free
            except Exception:
                pass

            now = time.time()
            if os.path.exists("/proc/stat") and now - self.last_update > 1.0:
                with open("/proc/stat") as f:
                    parts = f.readline().split()
                if len(parts) >= 5:
                    user = int(parts[1])
                    nice = int(parts[2])
                    system = int(parts[3])
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

            # 부가 정보 — UI 패널이 풍부하게 보여줄 수 있게.
            try:
                stats["cpu_count"] = os.cpu_count() or 1
            except Exception:
                pass

            try:
                # /proc/loadavg → "1m 5m 15m running/total lastpid"
                with open("/proc/loadavg") as f:
                    la = f.read().split()[:3]
                stats["load_avg"] = [float(x) for x in la]
            except Exception:
                pass

            try:
                with open("/proc/uptime") as f:
                    stats["uptime"] = float(f.read().split()[0])
            except Exception:
                pass

            try:
                with open("/proc/sys/kernel/hostname") as f:
                    stats["hostname"] = f.read().strip()
            except Exception:
                pass
        except Exception as e:
            logger.error("system stats error: %s", e)
        return stats


system_monitor = SystemMonitor()


# ---------------------- 라이프사이클 ----------------------

auth_manager: AuthManager | None = None


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
    try:
        import host_sftp
        await host_sftp.close_pool()
    except Exception:
        pass
    await storage.close()


# ---------------------- 인증 ----------------------

async def verify_auth_token(
    authorization: str | None = Header(None),
    token: str | None = Query(None),
) -> str:
    actual = None
    if authorization and authorization.startswith("Bearer "):
        actual = authorization[len("Bearer "):]
    elif token:
        actual = token
    if not actual:
        raise HTTPException(status_code=401, detail="인증 토큰이 필요합니다")
    if not auth_manager:
        raise HTTPException(status_code=503, detail="인증 관리자가 초기화되지 않았습니다")
    username = await auth_manager.verify_token(actual)
    if not username:
        raise HTTPException(status_code=401, detail="유효하지 않은 토큰입니다")
    return username


async def verify_auth_token_ws(token: str) -> str | None:
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
    if await auth_manager.is_otp_enabled():
        pending = await auth_manager.create_otp_pending_token(request.username)
        return {
            "otp_required": True,
            "pending_token": pending,
            "username": request.username,
        }
    access_token = await auth_manager.create_access_token(request.username)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "username": request.username,
        "otp_required": False,
    }


@app.post("/api/auth/login/otp")
async def login_otp(request: OtpLoginRequest):
    if auth_manager is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    username = await auth_manager.verify_otp_pending_token(request.pending_token)
    if not username:
        raise HTTPException(status_code=401, detail="OTP 인증 시간이 만료되었습니다. 다시 로그인해주세요.")
    if request.is_backup_code:
        ok = await auth_manager.consume_backup_code(username, request.code)
    else:
        ok = await auth_manager.verify_otp_code(username, request.code)
    if not ok:
        raise HTTPException(status_code=401, detail="OTP 코드가 올바르지 않습니다")
    access_token = await auth_manager.create_access_token(username)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "username": username,
        "otp_required": False,
    }


@app.get("/api/auth/verify")
async def verify_token(username: str = Depends(verify_auth_token)):
    return {"valid": True, "username": username}


# ---------------------- OTP (TOTP) 관리 ----------------------

@app.get("/api/auth/otp/status")
async def otp_status(username: str = Depends(verify_auth_token)):
    if auth_manager is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    return await auth_manager.get_otp_status()


@app.post("/api/auth/otp/setup")
async def otp_setup(username: str = Depends(verify_auth_token)):
    """새 비밀키 발급 → provisioning URI 반환. 아직 활성화는 안 됨."""
    if auth_manager is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    if await auth_manager.is_otp_enabled():
        raise HTTPException(status_code=400, detail="이미 OTP가 활성화되어 있습니다. 먼저 비활성화 후 다시 설정하세요.")
    return await auth_manager.begin_otp_setup(username)


@app.post("/api/auth/otp/enable")
async def otp_enable(request: OtpEnableRequest, username: str = Depends(verify_auth_token)):
    """첫 OTP 코드 검증 → 활성화 + 백업코드 발급."""
    if auth_manager is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    backup_codes = await auth_manager.enable_otp(username, request.code)
    if backup_codes is None:
        raise HTTPException(status_code=400, detail="OTP 코드가 올바르지 않거나 setup 이 먼저 필요합니다")
    return {"enabled": True, "backup_codes": backup_codes}


@app.post("/api/auth/otp/disable")
async def otp_disable(request: OtpDisableRequest, username: str = Depends(verify_auth_token)):
    """비밀번호 재확인 후 OTP 비활성화 + 비밀키/백업코드 삭제."""
    if auth_manager is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    if not await auth_manager.verify_admin(username, request.password):
        raise HTTPException(status_code=401, detail="비밀번호가 올바르지 않습니다")
    await auth_manager.disable_otp(username)
    return {"enabled": False}


@app.post("/api/auth/otp/backup-codes/regenerate")
async def otp_regenerate_backup_codes(username: str = Depends(verify_auth_token)):
    """기존 백업코드 폐기 후 새로 10개 발급."""
    if auth_manager is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    if not await auth_manager.is_otp_enabled():
        raise HTTPException(status_code=400, detail="OTP가 활성화되지 않았습니다")
    codes = await auth_manager.issue_backup_codes(username)
    return {"backup_codes": codes}


@app.get("/api/system/stats")
async def get_system_stats(username: str = Depends(verify_auth_token)):
    return system_monitor.get_stats()


# ---------------------- Tailscale 연동 ----------------------
# `tailscale status --json` 으로 tailnet peers 조회 → 호스트 추가 시 picker 에 사용.
# tailscale 바이너리 없거나 실행 안 되면 빈 목록 반환 (UI 측에서 비활성).

@app.get("/api/tailscale/peers")
async def get_tailscale_peers(username: str = Depends(verify_auth_token)):
    if not shutil.which("tailscale"):
        return {"available": False, "peers": []}
    try:
        proc = await asyncio.create_subprocess_exec(
            "tailscale", "status", "--json",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _stderr = await asyncio.wait_for(proc.communicate(), timeout=5)
        if proc.returncode != 0:
            return {"available": True, "peers": [], "error": "tailscale status failed"}
        data = json.loads(stdout.decode("utf-8", errors="replace"))
    except (TimeoutError, json.JSONDecodeError, FileNotFoundError) as e:
        return {"available": False, "peers": [], "error": str(e)}

    peers_raw = data.get("Peer") or {}
    peers = []
    for p in peers_raw.values():
        ips = p.get("TailscaleIPs") or []
        peers.append({
            "id": p.get("ID"),
            "hostname": p.get("HostName") or "",
            "dns_name": (p.get("DNSName") or "").rstrip("."),
            "os": p.get("OS") or "",
            "ip": ips[0] if ips else "",
            "online": bool(p.get("Online")),
            "user_id": p.get("UserID"),
        })
    # 자기 자신
    self_node = data.get("Self") or {}
    me = {
        "id": self_node.get("ID"),
        "hostname": self_node.get("HostName") or "",
        "dns_name": (self_node.get("DNSName") or "").rstrip("."),
        "os": self_node.get("OS") or "",
        "ip": (self_node.get("TailscaleIPs") or [""])[0] or "",
        "online": True,
        "is_self": True,
    }
    peers.sort(key=lambda x: ((not x.get("online")), x.get("hostname", "").lower()))
    return {"available": True, "peers": peers, "self": me}


# ---------------------- 사용자 UI 설정 ----------------------
# 테마/폰트/언어 등 클라이언트 측 환경설정을 사용자별로 서버에 저장.
# 디바이스/브라우저 갈아탈 때도 동일 설정으로 들어오게.

class UserSettingsRequest(BaseModel):
    settings: dict


class TabStateRequest(BaseModel):
    tabs: list
    activeTabId: str | None = None


async def _sanitize_tab_state(tabs: list, active_tab_id: str | None) -> tuple[list, str | None]:
    """현재 앱 tmux 소켓에 살아있지 않은 local 탭은 저장/복원하지 않는다."""
    live_local_sessions = {session.name for session in await tmux_manager.list_sessions()}
    kept_tabs = []
    kept_tab_ids: set[str] = set()
    for tab in tabs:
        if not isinstance(tab, dict):
            continue
        tab_id = tab.get("id")
        if not isinstance(tab_id, str):
            continue
        if tab.get("type") == "local":
            session_id = tab.get("sessionId")
            if not isinstance(session_id, str) or session_id not in live_local_sessions:
                continue
        kept_tabs.append(tab)
        kept_tab_ids.add(tab_id)

    if active_tab_id not in kept_tab_ids:
        active_tab_id = kept_tabs[0].get("id") if kept_tabs else None
    return kept_tabs, active_tab_id


async def _has_stored_session(username: str, session_id: str) -> bool:
    return any(session["id"] == session_id for session in await storage.get_user_sessions(username))


@app.get("/api/user/settings")
async def get_user_settings(username: str = Depends(verify_auth_token)):
    saved = await storage.get_user_settings(username)
    return {"settings": saved or {}}


@app.put("/api/user/settings")
async def put_user_settings(
    request: UserSettingsRequest,
    username: str = Depends(verify_auth_token),
):
    if not isinstance(request.settings, dict):
        raise HTTPException(status_code=400, detail="settings must be an object")
    await storage.save_user_settings(username, request.settings)
    return {"status": "saved"}


@app.get("/api/tab-state")
async def get_tab_state(username: str = Depends(verify_auth_token)):
    """저장된 탭 전체 상태 조회 (순서/레이아웃/pane 구성 포함).
    updatedAt 은 기기 간 동기화 폴링에서 변경 감지용 ETag.
    """
    state = await storage.get_tab_state(username)
    if not state:
        return {"tabs": [], "activeTabId": None, "updatedAt": None}
    raw_tabs = state.get("tabs")
    tabs = raw_tabs if isinstance(raw_tabs, list) else []
    raw_active_tab_id = state.get("activeTabId")
    active_tab_id = raw_active_tab_id if isinstance(raw_active_tab_id, str) else None
    updated_at = state.get("updatedAt")
    sanitized_tabs, sanitized_active_tab_id = await _sanitize_tab_state(tabs, active_tab_id)
    if sanitized_tabs != tabs or sanitized_active_tab_id != active_tab_id:
        updated_at = await storage.save_tab_state(username, sanitized_tabs, sanitized_active_tab_id)
    return {
        "tabs": sanitized_tabs,
        "activeTabId": sanitized_active_tab_id,
        "updatedAt": updated_at,
    }


@app.get("/api/tab-state/version")
async def get_tab_state_version(username: str = Depends(verify_auth_token)):
    """폴링용 경량 엔드포인트 — updated_at 만 반환.
    프론트엔드는 이 값이 자기가 마지막으로 본 값과 다를 때만 전체 GET 을 호출한다.
    """
    return {"updatedAt": await storage.get_tab_state_updated_at(username)}


@app.put("/api/tab-state")
async def put_tab_state(
    request: TabStateRequest,
    username: str = Depends(verify_auth_token),
):
    """탭 전체 상태 저장. 프론트엔드가 변경 시마다 (debounced) 호출.
    응답의 updatedAt 을 클라이언트가 기억해 두면 자기 자신의 PUT 을 폴링에서 무시할 수 있다.
    """
    if not isinstance(request.tabs, list):
        raise HTTPException(status_code=400, detail="tabs must be an array")
    tabs, active_tab_id = await _sanitize_tab_state(request.tabs, request.activeTabId)
    updated_at = await storage.save_tab_state(username, tabs, active_tab_id)
    return {"status": "saved", "updatedAt": updated_at}


# ---------------------- 세션 API ----------------------

def _basename_or_none(p: str | None) -> str | None:
    return os.path.basename(p) if p else None


def _resolve_create_cwd(req_cwd: str | None) -> str:
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


def _resolve_shell(requested: str | None) -> str | None:
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


@app.get("/api/sessions", response_model=list[dict])
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


@app.get("/api/sessions/{session_id}/clients")
async def get_session_clients(session_id: str, username: str = Depends(verify_auth_token)):
    """세션에 현재 attach 된 tmux 클라이언트 수.
    프론트엔드 takeover 모델에서 "지금 누가 보고 있냐?" 프리플라이트 / 자동 재attach 폴링용.
    세션 자체가 없으면 attached=False 로 통일 (UI 가 그냥 신규 attach 진행하게)."""
    if not await tmux_manager.session_exists(session_id):
        return {"session_id": session_id, "exists": False, "count": 0, "attached": False}
    n = await tmux_manager.clients_count(session_id)
    return {"session_id": session_id, "exists": True, "count": n, "attached": n > 0}


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


@app.get("/api/sessions/{session_id}/activity")
async def get_session_activity(session_id: str, username: str = Depends(verify_auth_token)):
    """세션의 cwd 타임라인 + 워크스페이스 상대 경로 부가."""
    workspace_abs = os.path.abspath(WORKSPACE_ROOT)
    raw = tmux_manager.get_cwd_history(session_id)
    items = []
    for entry in raw:
        cwd = entry["cwd"]
        in_ws = cwd == workspace_abs or cwd.startswith(workspace_abs + os.sep)
        rel = ""
        if in_ws:
            r = os.path.relpath(cwd, workspace_abs).replace("\\", "/")
            rel = "" if r == "." else r
        items.append({
            "ts": entry["ts"],
            "cwd": cwd,
            "workspace_relative": rel if in_ws else None,
            "in_workspace": in_ws,
        })
    return {"session_id": session_id, "items": items}


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
    token: str | None = Query(None),
    cols: int = Query(80),
    rows: int = Query(24),
    cwd: str | None = Query(None),
    shell: str | None = Query(None),
):
    username = await verify_auth_token_ws(token) if token else None
    if not username:
        username = "admin"  # 인증 실패해도 기본 사용자로 진행 (기존 동작 유지)

    await websocket.accept()
    logger.info("WS attach: session=%s user=%s", session_id, username)

    # 세션이 없으면 생성 (백엔드 재시작 후 첫 연결 또는 새 세션 직접 WS 진입)
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
        # 기존 세션 mouse off 강제 — 직전에 mouse on 으로 올라간 세션 되돌림.
        # 드래그 native 선택을 위해선 DECSET 1000 안 보내야 함 → mouse off.
        # 휠은 frontend 의 attachCustomWheelEventHandler 가 PgUp 변환 → root binding 으로 copy-mode.
        try:
            await tmux_manager._run("set-option", "-t", session_id, "mouse", "off", check=False)
            # PageUp/Down root binding 보강 (휠 → PgUp 경로용). idempotent.
            await tmux_manager._run(
                "bind-key", "-T", "root", "PageUp",
                "if-shell", "-F", "#{alternate_on}",
                "send-keys PageUp", "copy-mode -eu",
                check=False,
            )
            await tmux_manager._run(
                "bind-key", "-T", "root", "PageDown",
                "if-shell", "-F", "#{alternate_on}",
                "send-keys PageDown", "",
                check=False,
            )
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


@app.put("/api/ssh-keys/{key_id}")
async def update_ssh_key(
    key_id: str,
    request: SshKeyUpdateRequest,
    username: str = Depends(verify_auth_token),
):
    private_key_enc = encrypt_str(request.private_key) if request.private_key else None
    passphrase_enc = encrypt_str(request.passphrase) if request.passphrase else None
    ok = await storage.update_ssh_key(
        key_id=key_id,
        username=username,
        name=request.name,
        public_key=request.public_key,
        private_key_enc=private_key_enc,
        passphrase_enc=passphrase_enc,
        clear_passphrase=request.clear_passphrase,
    )
    if not ok:
        raise HTTPException(status_code=404, detail="키를 찾을 수 없거나 변경할 내용이 없습니다")
    return {"id": key_id, "status": "updated"}


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
        "start_path": (req.start_path or "").strip() or None,
        "icon": (req.icon or "").strip() or None,
        "theme": (req.theme or "").strip() or None,
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


class HostReorderRequest(BaseModel):
    ids: list[str]


@app.post("/api/hosts/reorder")
async def reorder_hosts(request: HostReorderRequest, username: str = Depends(verify_auth_token)):
    """홈 카드 DnD 순서 영속. ids 리스트 순서대로 sort_index 0..N-1 부여."""
    await storage.reorder_hosts(username, request.ids)
    return {"status": "ok", "count": len(request.ids)}


class HostLastCwdRequest(BaseModel):
    cwd: str | None = None


@app.post("/api/hosts/{host_id}/last-cwd")
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


@app.post("/api/hosts/{host_id}/kill-tmux")
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
        raise HTTPException(status_code=500, detail=str(e))
    return {"id": host_id, "session": target_session, "status": "server_killed" if force else "killed"}


@app.get("/api/hosts/{host_id}/tmux-clients")
async def get_host_tmux_clients(
    host_id: str,
    session: str = Query(..., description="원격 tmux 세션명"),
    username: str = Depends(verify_auth_token),
):
    """원격 호스트의 특정 tmux 세션에 attach 된 클라이언트 수.
    takeover 프리플라이트 + 자동 재attach 폴링용. session 없으면 count=0 으로 통일.
    `tmux list-clients -t SESSION` 의 라인 수."""
    host = await storage.get_host(host_id, username)
    if not host:
        raise HTTPException(status_code=404, detail="호스트를 찾을 수 없습니다")

    from host_manager import open_connection
    safe_session = shlex.quote(session)
    # `=` prefix → exact match (suffix 매치 방지)
    cmd = f"tmux list-clients -t ={safe_session} 2>/dev/null | wc -l || echo 0"

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
        logger.warning("tmux-clients query failed (%s/%s): %s", host_id, session, e)
        # 실패 시 알 수 없음 — 0 으로 보내 프론트가 그냥 진행하게.
        return {"host_id": host_id, "session": session, "count": 0, "attached": False, "error": str(e)}

    try:
        n = int((output or "0").strip().splitlines()[-1])
    except (ValueError, IndexError):
        n = 0
    return {"host_id": host_id, "session": session, "count": n, "attached": n > 0}


@app.get("/api/hosts/{host_id}/tmux-sessions")
async def list_host_tmux_sessions(
    host_id: str,
    username: str = Depends(verify_auth_token),
):
    """원격 tmux 서버의 세션 목록. 좀비 세션 청소용.

    `tmux list-sessions -F '#{session_name}|#{session_created}|#{session_attached}'`
    """
    host = await storage.get_host(host_id, username)
    if not host:
        raise HTTPException(status_code=404, detail="호스트를 찾을 수 없습니다")

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
        logger.error("list-tmux-sessions failed (%s): %s", host_id, e)
        raise HTTPException(status_code=500, detail=str(e))

    sessions = []
    for line in output.strip().splitlines():
        parts = line.split("|")
        if len(parts) >= 3:
            sessions.append({
                "name": parts[0],
                "created": int(parts[1]) if parts[1].isdigit() else None,
                "attached": parts[2] != "0",
            })
    return {"id": host_id, "sessions": sessions}


@app.delete("/api/hosts/{host_id}")
async def delete_host(host_id: str, username: str = Depends(verify_auth_token)):
    ok = await storage.delete_host(host_id, username)
    if not ok:
        raise HTTPException(status_code=404, detail="호스트를 찾을 수 없습니다")
    return {"id": host_id, "status": "deleted"}


# ---------------------- 호스트 SFTP 파일 API ----------------------
# asyncssh SFTP 로 원격 호스트 파일 시스템 브라우징/읽기/쓰기.
# 연결은 host_sftp 풀에서 재사용.

import host_sftp


async def _resolve_host_with_secrets(host_id: str, username: str) -> tuple:
    host = await storage.get_host(host_id, username)
    if not host:
        raise HTTPException(status_code=404, detail="호스트를 찾을 수 없습니다")
    key_record = None
    if host.get("auth_method") == "key" and host.get("key_id"):
        key_record = await storage.get_ssh_key(host["key_id"], username)
        if not key_record:
            raise HTTPException(status_code=400, detail="연결된 SSH 키를 찾을 수 없음")
    secrets = resolve_host_secrets(host, key_record)
    return host, secrets


@app.get("/api/hosts/{host_id}/files")
async def list_host_files(
    host_id: str,
    path: str = Query("", description="원격 디렉토리 경로. 비우면 host start_path 또는 홈."),
    username: str = Depends(verify_auth_token),
):
    host, secrets = await _resolve_host_with_secrets(host_id, username)
    target = (path or "").strip()
    if not target:
        target = (host.get("start_path") or "").strip() or "."
    try:
        result = await host_sftp.list_directory(host, secrets, target)
        # 하위 호환: 예전 클라이언트는 path 만 봐도 동작 — resolved 가 새로 추가된 절대경로.
        return {
            "items": result["items"],
            "path": result["resolved"],
            "resolved": result["resolved"],
            "host_id": host_id,
        }
    except Exception as e:
        logger.warning("SFTP list failed (%s, %s): %s", host_id, target, e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/hosts/{host_id}/files/read")
async def read_host_file(
    host_id: str,
    path: str = Query(..., description="원격 파일 경로 (절대 권장)"),
    username: str = Depends(verify_auth_token),
):
    host, secrets = await _resolve_host_with_secrets(host_id, username)
    try:
        content = await host_sftp.read_file(host, secrets, path)
        return {"content": content, "path": path, "host_id": host_id}
    except Exception as e:
        logger.warning("SFTP read failed (%s, %s): %s", host_id, path, e)
        raise HTTPException(status_code=500, detail=str(e))


class HostFileWriteRequest(BaseModel):
    path: str
    content: str


@app.post("/api/hosts/{host_id}/files/write")
async def write_host_file(
    host_id: str,
    request: HostFileWriteRequest,
    username: str = Depends(verify_auth_token),
):
    host, secrets = await _resolve_host_with_secrets(host_id, username)
    try:
        await host_sftp.write_file(host, secrets, request.path, request.content)
        return {"status": "written", "path": request.path, "host_id": host_id}
    except Exception as e:
        logger.warning("SFTP write failed (%s, %s): %s", host_id, request.path, e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/hosts/{host_id}/files/create")
async def create_host_file(
    host_id: str,
    request: FileCreateRequest,
    username: str = Depends(verify_auth_token),
):
    host, secrets = await _resolve_host_with_secrets(host_id, username)
    try:
        await host_sftp.create_item(host, secrets, request.path, request.type)
        return {"status": "created", "path": request.path, "host_id": host_id}
    except Exception as e:
        logger.warning("SFTP create failed (%s, %s): %s", host_id, request.path, e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/hosts/{host_id}/files/move")
async def move_host_file(
    host_id: str,
    request: FileMoveRequest,
    username: str = Depends(verify_auth_token),
):
    host, secrets = await _resolve_host_with_secrets(host_id, username)
    try:
        await host_sftp.move_item(host, secrets, request.source, request.destination)
        return {"status": "moved", "source": request.source, "destination": request.destination, "host_id": host_id}
    except Exception as e:
        logger.warning("SFTP move failed (%s, %s -> %s): %s", host_id, request.source, request.destination, e)
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/hosts/{host_id}/files")
async def delete_host_file(
    host_id: str,
    path: str = Query(...),
    username: str = Depends(verify_auth_token),
):
    host, secrets = await _resolve_host_with_secrets(host_id, username)
    try:
        await host_sftp.delete_item(host, secrets, path)
        return {"status": "deleted", "path": path, "host_id": host_id}
    except Exception as e:
        logger.warning("SFTP delete failed (%s, %s): %s", host_id, path, e)
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------- WebSocket: SSH 호스트 ----------------------

@app.websocket("/ws/host/{host_id}")
async def host_websocket(
    websocket: WebSocket,
    host_id: str,
    token: str | None = Query(None),
    cols: int = Query(80),
    rows: int = Query(24),
    pane_index: int = Query(0, description="0 이면 base 세션, 1+ 면 base.N+1 세션"),
    cwd: str | None = Query(None, description="이 연결에서 사용할 시작 디렉토리. 비우면 host.last_cwd → host.start_path 순으로 폴백."),
    tmux_suffix: str | None = Query(None, description="새 호스트 탭마다 base session 분리용 suffix. 영문/숫자/하이픈만, 32자 이내."),
    tmux_session_name: str | None = Query(None, description="명시적 tmux 세션명 override (기존 영속 세션 Resume). 주어지면 base/suffix/pane 계산 무시."),
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

    effective_cwd = (cwd or "").strip() or None
    # cwd 가 명시적으로 들어왔으면 last_cwd 갱신 (다음 접속에서 폴백 기본값으로 사용)
    if effective_cwd:
        try:
            await storage.update_host_last_cwd(host_id, username, effective_cwd)
        except Exception as e:
            logger.warning("update_host_last_cwd failed (%s): %s", host_id, e)

    # tmux_suffix sanitize — 영문/숫자/하이픈만, 32자 이내. 호스트 새 탭마다
    # 이 값이 다르면 base session 자동 분리 (mobile-abc1, mobile-def2 ...).
    safe_suffix: str | None = None
    if tmux_suffix:
        import re as _re
        s = _re.sub(r"[^a-zA-Z0-9-]", "", tmux_suffix)[:32]
        if s:
            safe_suffix = s

    # tmux_session_name sanitize — tmux 세션명 허용 문자: 영문/숫자/하이픈/언더스코어/점, 64자 이내.
    # 점 (.) 은 base.N+1 같은 분할 세션명을 그대로 받기 위함.
    safe_session_name: str | None = None
    if tmux_session_name:
        import re as _re
        s = _re.sub(r"[^a-zA-Z0-9._-]", "", tmux_session_name)[:64]
        if s:
            safe_session_name = s

    # auth_method == 'tailscale' → tailscale ssh subprocess 로 연결 (SSH 키 불필요)
    if host.get("auth_method") == "tailscale":
        from host_manager import TailscaleHostBridge
        bridge = TailscaleHostBridge(
            websocket=websocket,
            host=host,
            cols=cols,
            rows=rows,
            pane_index=pane_index,
            cwd=effective_cwd,
            tmux_suffix=safe_suffix,
            tmux_session_name=safe_session_name,
        )
    else:
        bridge = HostBridge(
            websocket=websocket,
            host=host,
            private_key=secrets["private_key"],
            passphrase=secrets["passphrase"],
            password=secrets["password"],
            cols=cols,
            rows=rows,
            pane_index=pane_index,
            cwd=effective_cwd,
            tmux_suffix=safe_suffix,
            tmux_session_name=safe_session_name,
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


async def _find_repo_root(start_path: str) -> str | None:
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


REPO_ITEMS_CAP = 200       # repo 당 응답에 포함할 최대 항목 (over → truncated 플래그)
REPO_NOISE_THRESHOLD = 800 # 이 이상이면 repo 자체를 noisy 로 분류 → 메타만, items 비움


async def _collect_repo_status(repo_root: str, workspace_abs: str, items_cap: int = REPO_ITEMS_CAP) -> dict:
    """단일 repo 의 변경 사항 + 브랜치를 워크스페이스 상대 경로 기준으로 정리.

    repo 가 매우 크면 (예: 빌드 산출물 수천개) cap 까지만 자르고 truncated 표시.
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            "git", "-C", repo_root, "status", "--porcelain=v1", "-uall",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            return {"items": [], "branch": None, "error": stderr.decode("utf-8", "replace").strip() or "git status failed", "total": 0, "truncated": False}

        repo_rel_prefix = os.path.relpath(repo_root, workspace_abs).replace("\\", "/")
        if repo_rel_prefix in (".", ""):
            repo_rel_prefix = ""

        all_lines = [line for line in stdout.decode().splitlines() if len(line) >= 3]
        total = len(all_lines)
        # 너무 시끄러운 repo (gitignore 누락된 build/cache 등) 는 메타만 반환,
        # items 는 비워 응답 비대화 방지.
        noisy = total >= REPO_NOISE_THRESHOLD
        truncated = total > items_cap and not noisy
        lines = [] if noisy else all_lines[:items_cap]

        items = []
        for line in lines:
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
                "path": workspace_rel,
                "repo_path": rel_to_repo,
                "repo_root": repo_root,
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
            "error": None,
            "total": total,
            "truncated": truncated,
            "noisy": noisy,
        }
    except Exception as e:
        return {"items": [], "branch": None, "error": str(e), "total": 0, "truncated": False, "noisy": False}


# 워크스페이스 repo 스캔 결과 캐시 — fs 변동이 잦지 않으니 60초 캐시.
_REPO_SCAN_CACHE: dict = {"ts": 0.0, "roots": []}
_REPO_SCAN_TTL = 60.0


async def _scan_workspace_repos(workspace_abs: str, max_depth: int = 2) -> list[str]:
    """워크스페이스에서 git repo 들의 루트 경로를 탐색 (max_depth 까지). 60초 캐시."""
    now = time.time()
    if now - _REPO_SCAN_CACHE["ts"] < _REPO_SCAN_TTL and _REPO_SCAN_CACHE["roots"]:
        return list(_REPO_SCAN_CACHE["roots"])

    found: list[str] = []
    try:
        for entry in os.scandir(workspace_abs):
            if not entry.is_dir(follow_symlinks=False):
                continue
            if entry.name.startswith('.'):
                continue
            full = entry.path
            if os.path.isdir(os.path.join(full, '.git')):
                found.append(full)
                continue
            if max_depth > 1:
                try:
                    for sub in os.scandir(full):
                        if not sub.is_dir(follow_symlinks=False):
                            continue
                        if sub.name.startswith('.'):
                            continue
                        if os.path.isdir(os.path.join(sub.path, '.git')):
                            found.append(sub.path)
                except PermissionError:
                    pass
    except Exception as e:
        logger.warning("scan workspace repos failed: %s", e)
    _REPO_SCAN_CACHE["ts"] = now
    _REPO_SCAN_CACHE["roots"] = found
    return found


@app.get("/api/git/status")
async def git_status(
    path: str = Query("", description="포커스된 폴더 경로 (워크스페이스 상대). 비우면 워크스페이스 전체 repo 집계."),
    username: str = Depends(verify_auth_token),
):
    """경로 지정 시 그 repo 의 변경, 비우면 워크스페이스 내 모든 repo 의 변경을 집계."""
    workspace_abs = os.path.abspath(WORKSPACE_ROOT)

    # 경로 없음 → 워크스페이스 전체 집계 (병렬 git status)
    if not path:
        repo_roots = await _scan_workspace_repos(workspace_abs)
        if not repo_roots:
            return {"items": [], "branch": None, "repo": None, "repos": [], "error": None}
        results = await asyncio.gather(*[
            _collect_repo_status(r, workspace_abs) for r in repo_roots
        ], return_exceptions=False)
        repos_meta = []
        all_items = []
        for repo_root, r in zip(repo_roots, results):
            if r.get("error"):
                continue
            total = r.get("total", 0)
            # 변경 0 인 repo 는 응답에서 제외 (UI 노이즈 줄임)
            if total == 0:
                continue
            rel = os.path.relpath(repo_root, workspace_abs).replace("\\", "/")
            repos_meta.append({
                "root": repo_root,
                "rel": rel,
                "branch": r["branch"],
                "count": len(r["items"]),
                "total": total,
                "truncated": r.get("truncated", False),
                "noisy": r.get("noisy", False),
            })
            all_items.extend(r["items"])
        return {
            "items": all_items,
            "branch": None,
            "repo": None,
            "repos": repos_meta,
            "error": None,
        }

    # 경로 지정 → 단일 repo (기존 동작)
    target = str(validate_path(path).absolute())
    repo_root = await _find_repo_root(target)
    if not repo_root:
        return {"items": [], "branch": None, "repo": None, "repos": [], "error": None}

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


@app.get("/api/git/file-content")
async def git_file_content(
    path: str = Query(...),
    ref: str = Query("HEAD"),
    username: str = Depends(verify_auth_token),
):
    """파일의 특정 ref(기본 HEAD) 시점 내용. DiffEditor 좌측(원본)에 사용."""
    safe = validate_path(path)
    repo_root = await _find_repo_root(str(safe))
    if not repo_root:
        raise HTTPException(status_code=404, detail="해당 파일이 속한 git 저장소를 찾을 수 없습니다")

    rel_to_repo = os.path.relpath(str(safe.absolute()), repo_root).replace("\\", "/")
    try:
        proc = await asyncio.create_subprocess_exec(
            "git", "-C", repo_root, "show", f"{ref}:{rel_to_repo}",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            # untracked / 새 파일은 HEAD에 없음 → 빈 원본으로 응답
            err = stderr.decode("utf-8", errors="replace").strip().lower()
            if "exists on disk, but not in" in err or "does not exist" in err or "bad object" in err:
                return {"path": path, "ref": ref, "content": "", "exists": False}
            raise HTTPException(status_code=500, detail=err or "git show failed")
        return {
            "path": path,
            "ref": ref,
            "content": stdout.decode("utf-8", errors="replace"),
            "exists": True,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("git show failed (%s): %s", path, e)
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


# 워크스페이스 인덱스 캐시 — 모든 파일 path 를 한 번에 들고 와서 클라이언트가
# 직접 fuzzy 매칭하도록 한다 (서버 왕복 제거 → 즉시 반응).
# TTL 30s, 명시적 invalidate (mutating endpoint 들에서 호출) 가능.
_FILE_INDEX_IGNORED = {".git", "node_modules", "dist", "build", "coverage", "__pycache__",
                       ".venv", "venv", ".next", ".turbo", ".idea", ".vscode"}
_FILE_INDEX_TTL = 30.0
_FILE_INDEX_LIMIT = 50000  # 안전 cap — 워크스페이스가 미친듯이 크면 자르고 truncated 표시
_file_index_cache: dict = {"ts": 0.0, "files": [], "truncated": False}


def _build_file_index() -> dict:
    workspace_abs = os.path.abspath(WORKSPACE_ROOT)
    files: list[str] = []
    truncated = False
    for current_root, dirs, names in os.walk(workspace_abs):
        dirs[:] = [d for d in dirs if d not in _FILE_INDEX_IGNORED]
        for n in names:
            rel = os.path.relpath(os.path.join(current_root, n), workspace_abs).replace("\\", "/")
            files.append(rel)
            if len(files) >= _FILE_INDEX_LIMIT:
                truncated = True
                break
        if truncated:
            break
    return {"ts": time.time(), "files": files, "truncated": truncated}


def _invalidate_file_index() -> None:
    """mutating endpoint 가 호출 — 다음 요청에서 강제 리빌드."""
    _file_index_cache["ts"] = 0.0


@app.get("/api/files/index")
async def get_file_index(username: str = Depends(verify_auth_token)):
    """워크스페이스 전체 파일 path 목록 (한번에). 클라이언트가 fuzzy 매칭 직접 수행.
    응답 캐싱 (30s TTL) — 큰 워크스페이스에서도 두번째 호출부터는 즉시.
    """
    global _file_index_cache
    now = time.time()
    if now - _file_index_cache["ts"] > _FILE_INDEX_TTL:
        _file_index_cache = await asyncio.to_thread(_build_file_index)
    return {
        "files": _file_index_cache["files"],
        "truncated": _file_index_cache["truncated"],
        "ts": _file_index_cache["ts"],
    }


@app.get("/api/files/search")
async def search_files(
    q: str = Query("", min_length=0),
    limit: int = Query(200, ge=1, le=500),
    username: str = Depends(verify_auth_token),
):
    """레거시 — 클라이언트가 인덱스를 못 받았을 때 폴백. 서버에서 substring 매칭.
    신규 클라이언트는 /api/files/index 로 받은 캐시에서 직접 fuzzy 한다.
    """
    query = q.strip().lower()
    if not query:
        return {"items": []}

    workspace_abs = os.path.abspath(WORKSPACE_ROOT)
    matches = []
    try:
        for current_root, dirs, files in os.walk(workspace_abs):
            dirs[:] = [d for d in dirs if d not in _FILE_INDEX_IGNORED]
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
    _invalidate_file_index()
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
    _invalidate_file_index()
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
    _invalidate_file_index()
    return {"status": "deleted", "path": path}


# ---------------------- 에러 / 정적 ----------------------

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.error("Unhandled exception: %s", exc, exc_info=True)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


STATIC_DIR = Path(__file__).parent / "static"
NO_CACHE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}

if STATIC_DIR.exists():
    app.mount("/assets", CachedStaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")

    @app.get("/")
    async def serve_frontend():
        # index.html 은 항상 fresh — 새 빌드 chunk 해시 즉시 반영
        return FileResponse(str(STATIC_DIR / "index.html"), headers=NO_CACHE_HEADERS)

    @app.get("/{full_path:path}")
    async def catch_all(full_path: str):
        if full_path.startswith("api/") or full_path.startswith("ws/"):
            raise HTTPException(status_code=404, detail="Not found")
        file_path = STATIC_DIR / full_path
        if file_path.is_file():
            return FileResponse(str(file_path))
        # SPA fallback 도 no-cache (라우팅 경로 어디로 와도 최신 index)
        return FileResponse(str(STATIC_DIR / "index.html"), headers=NO_CACHE_HEADERS)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("APP_PORT", "8000")),
        reload=os.getenv("RELOAD", "true").lower() == "true",
        log_level=os.getenv("LOG_LEVEL", "info").lower(),
    )

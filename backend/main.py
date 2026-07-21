"""
Terminal List - 백엔드 FastAPI 서버

세션 영속성은 호스트의 tmux 서버가 담당한다.
- 백엔드는 tmux 서버에 명령을 보내고, WebSocket↔tmux client PTY를 중계한다.
- 백엔드가 죽어도 tmux 서버가 살아있으면 세션은 유지된다.
- 동일 세션에 웹/SSH 등 여러 클라이언트가 동시 attach 가능하다.
"""
import asyncio
import io
import json
import logging
import mimetypes
import os
import re
import secrets as secrets_mod
import shlex
import shutil
import signal as signal_mod
import stat
import time
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import quote

import anyio
from dotenv import load_dotenv
from fastapi import (
    Cookie,
    Depends,
    FastAPI,
    File as FastAPIFile,
    Form,
    Header,
    HTTPException,
    Query,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from starlette.datastructures import Headers
from starlette.types import Receive, Scope, Send

from _deps import (
    AUTH_COOKIE_NAME,
    GIT_COMMIT_TIMEOUT,
    GIT_DIFF_TIMEOUT,
    GIT_PUSH_TIMEOUT,
    GIT_QUICK_TIMEOUT,
    GIT_STATUS_TIMEOUT,
    WORKSPACE_ROOT,
    run_proc as _run_proc,
    set_auth_manager,
    validate_path,
    verify_auth_token,
)
from auth_manager import AuthManager
from cache import (
    cache,
    invalidate_host,
    invalidate_session,
    key_host_tmux_clients,
    key_host_tmux_sessions,
    key_local_clients,
)
from host_manager import HostBridge, HostConnectError, resolve_host_secrets
from sqlite_storage import storage
from ssh_pool import ssh_pool
from tmux_manager import tmux_manager
from agent_status_watcher import AgentStatusWatcher, PANE_FORMAT as AGENT_PANE_FORMAT
from rate_limit import check_rate_limit, client_ip_from_request, trust_proxy_headers
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
# asyncssh 는 접속/채널/인증 과정을 INFO 로 대량 출력 — WARNING 이상만 표시
logging.getLogger("asyncssh").setLevel(logging.WARNING)


from ws_clients import (  # noqa: E402
    _clean_client_id, _client_identity_payload, _client_ip_from_websocket,
    _register_ws_client, _unregister_ws_client, _ws_client_registry,
)


# Vite precompress 플러그인이 만들어 둔 사전압축 변형의 확장자/인코딩 매핑.
# 클라가 받아주면 .br > .gz 순으로 그대로 서빙 — 매 요청 재압축 CPU 0, brotli 는 더 작음.
_PRECOMPRESS_VARIANTS = ((".br", "br"), (".gz", "gzip"))
_PRECOMPRESS_EXTS = (".js", ".mjs", ".css", ".svg", ".json", ".wasm", ".map")


class CachedStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope: Scope) -> Response:
        # 압축 가능한 텍스트 자산이고 클라가 받아주면 사전압축본을 서빙.
        if scope["method"] in ("GET", "HEAD") and path.lower().endswith(_PRECOMPRESS_EXTS):
            accept = Headers(scope=scope).get("accept-encoding", "")
            for suffix, encoding in _PRECOMPRESS_VARIANTS:
                if encoding not in accept:
                    continue
                full_path, stat_result = await anyio.to_thread.run_sync(
                    self.lookup_path, path + suffix
                )
                if stat_result and stat.S_ISREG(stat_result.st_mode):
                    media_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
                    response = FileResponse(
                        full_path, stat_result=stat_result, media_type=media_type
                    )
                    response.headers["Content-Encoding"] = encoding
                    response.headers["Vary"] = "Accept-Encoding"
                    return response
        return await super().get_response(path, scope)

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


# ---------------------- 앱 / 미들웨어 ----------------------

auth_manager: AuthManager | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global auth_manager
    logger.info("=== Terminal List 시작 ===")
    await storage.connect()
    auth_manager = AuthManager(storage)
    set_auth_manager(auth_manager)
    if not shutil.which("tmux"):
        logger.error("tmux 바이너리를 찾을 수 없습니다. 호스트에 tmux를 설치해주세요.")
    elif await tmux_manager.server_alive():
        await tmux_manager._run("set-option", "-s", "escape-time", "0", check=False)
        # pane 타이틀 전달을 전역으로도 켠다. create_session 은 새 세션에만 거는데,
        # 그러면 백엔드 재시작 시점에 이미 돌고 있던 세션들은 영영 상태를 못 흘린다
        # (tmux 세션은 백엔드보다 오래 산다 — KillMode=process).
        await tmux_manager._run("set-option", "-g", "set-titles", "on", check=False)
        await tmux_manager._run("set-option", "-g", "set-titles-string", "#{pane_title}", check=False)
    # 서버 강제 종료로 detach hook 이 못 돈 orphan usage row 정리
    try:
        closed = await storage.close_orphan_usage_sessions()
        if closed:
            logger.info("usage: closed %d orphan session rows", closed)
    except Exception as e:
        logger.warning("usage orphan close failed: %s", e)
    # 30일 retention — 가벼우니 startup 마다 1회로 충분 (장기 가동 시 24h 주기 청소는 backlog 로 미룸).
    try:
        purged = await storage.cleanup_command_history(retention_days=30)
        if purged:
            logger.info("command_history: purged %d expired rows", purged)
    except Exception as e:
        logger.warning("command_history cleanup failed: %s", e)
    # 컨테이너 배포에서 BOOTSTRAP_HOST_* env 가 세팅돼있으면 호스트 자동 등록.
    # admin 미설정이거나 이미 같은 이름 host 있으면 silent skip (idempotent).
    try:
        from bootstrap import register_bootstrap_host
        await register_bootstrap_host()
    except Exception as e:
        logger.warning("bootstrap host registration failed: %s", e)
    ssh_pool.start_janitor(idle_timeout=300)
    agent_status_watcher.start()
    try:
        yield
    finally:
        logger.info("=== Terminal List 종료 ===")
        await agent_status_watcher.stop()
        ssh_pool.stop_janitor()
        try:
            await ssh_pool.close_all()
        except Exception:
            pass
        try:
            import host_sftp
            await host_sftp.close_pool()
        except Exception:
            pass
        await storage.close()


app = FastAPI(title="Terminal List", version="2.0.1", lifespan=lifespan)

# CORS — ALLOWED_ORIGINS env (콤마 구분) 가 있으면 그 origin 만 허용 + credentials 켬.
# 미설정 시 와일드카드 fallback (개발 호환) — 단 와일드카드 + credentials 는 브라우저가
# 차단하므로 credentials=False 로 둔다. JWT 는 Authorization 헤더라 credentials 불필요.
def _normalize_origin(raw: str) -> str | None:
    """trailing slash / path 제거. 스키마 없으면 무시. 와일드카드는 그대로."""
    s = raw.strip().rstrip("/")
    if not s:
        return None
    if s == "*":
        return s
    if "://" not in s:
        return None
    # path component (https://foo.com/api) 가 있으면 origin 만 남김.
    scheme, rest = s.split("://", 1)
    host = rest.split("/", 1)[0]
    return f"{scheme}://{host}" if host else None


_allowed_origins_raw = os.getenv("ALLOWED_ORIGINS", "").strip()
_allowed_origins = [
    o for o in (_normalize_origin(p) for p in _allowed_origins_raw.split(",")) if o
] or ["*"]
_cors_credentials = _allowed_origins != ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=_cors_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)
logger.info("CORS allowed_origins=%s credentials=%s", _allowed_origins, _cors_credentials)
app.add_middleware(GZipMiddleware, minimum_size=1000)


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; "
    "base-uri 'self'; "
    "object-src 'none'; "
    "frame-ancestors 'none'; "
    "form-action 'self'; "
    # 'wasm-unsafe-eval' — xterm image addon 이 WebAssembly(SIXEL/이미지 디코딩)를
    # 쓰므로 필요. WASM 컴파일만 허용하고 JS eval() 은 여전히 차단하는 좁은 범위 지시어
    # (구식 'unsafe-eval' 보다 안전). 없으면 모든 pane 에서 WASM CompileError 발생.
    "script-src 'self' 'wasm-unsafe-eval'; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "img-src 'self' data: blob: https://*.google-analytics.com https://*.googletagmanager.com; "
    "font-src 'self' data: https://cdn.jsdelivr.net; "
    # Cloudflare Zaraz 가 주입하는 분석 비콘(GA/doubleclick) 허용 — 콘솔 CSP 경고 무음화.
    "connect-src 'self' ws: wss: https://*.google-analytics.com https://*.analytics.google.com https://stats.g.doubleclick.net https://*.googletagmanager.com; "
    "worker-src 'self' blob:; "
    "media-src 'self' blob:"
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    for key, value in SECURITY_HEADERS.items():
        response.headers.setdefault(key, value)
    if os.getenv("ENABLE_CSP", "1").strip().lower() not in {"0", "false", "no", "off"}:
        response.headers.setdefault("Content-Security-Policy", CONTENT_SECURITY_POLICY)
    return response


# ---------------------- 워크스페이스 ----------------------

# WORKSPACE_ROOT / validate_path 는 _deps 모듈에서 import.
os.makedirs(WORKSPACE_ROOT, exist_ok=True)
logger.info("WORKSPACE_ROOT = %s", WORKSPACE_ROOT)

# 인증 쿠키 Secure 판정 — auth_cookie.py (여기가 틀리면 로그인이 통째로 깨진다)
from auth_cookie import (  # noqa: E402
    AUTH_COOKIE_MAX_AGE_SECONDS, _env_flag, _request_is_https,
    _resolve_auth_cookie_secure, _set_auth_cookie, _clear_auth_cookie,
)

# ---------------------- 모델 ----------------------
# 파일 관련 모델은 file_models.py 가 이미 소유 — 여기서 재수출하지 않는다.
from file_models import (  # noqa: E402
    FileCreateRequest,
    FileMoveRequest,
    FileWriteRequest,
    HostFileWriteRequest,
    MAX_FILE_WRITE_BYTES,
    MAX_PATH_FIELD_LEN,
)
# 나머지 요청 본문 모델 — models.py
from models import (  # noqa: E402
    CommandHistoryPushRequest, FileTicketRequest, HostUpsertRequest,
    ResizeRequest, SessionCreateRequest, SessionNameRequest,
    SshKeyCreateRequest, SshKeyUpdateRequest, WsTicketRequest,
)


# 시스템 모니터는 라우트가 아니라 순수 수집기 — system_monitor.py 로 분리.
from system_monitor import system_monitor  # noqa: E402

# ---------------------- ID 검증 ----------------------

# session_id / host_id 는 클라이언트가 UUID v4 로 생성하지만, 셸/tmux 메타문자
# (; | $ ` 공백 따옴표 등) 가 섞인 값을 거부해 명령 인젝션 여지를 원천 차단한다.
# UUID 외에도 영숫자·하이픈·언더스코어 조합이면 허용 (친화적 세션명 대비).
_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def is_safe_id(value: str | None) -> bool:
    return bool(value) and bool(_SAFE_ID_RE.match(value))


# 단명 티켓 3종(WS/파일/SSE) — tickets.py
from tickets import (  # noqa: E402
    WS_TICKET_TTL_SECONDS, FILE_TICKET_TTL_SECONDS, SSE_TICKET_TTL_SECONDS,
    WS_TICKET_PUSH_INTERVAL_SECONDS,
    _create_ws_ticket, _consume_ws_ticket, _push_ws_tickets,
    _create_file_ticket, _consume_file_ticket,
    _create_sse_ticket, _consume_sse_ticket,
)
# SSE 브로드캐스트 레지스트리 — sse_broadcast.py
from sse_broadcast import (  # noqa: E402
    _tab_state_sse_queues, _notify_tab_state_change, _broadcast_sse,
)


# ---------------------- 에이전트 상태 워처 ----------------------

async def _list_agent_panes() -> str:
    return await tmux_manager.list_panes_raw(AGENT_PANE_FORMAT)


async def _on_agent_status_change(changes: list[dict]) -> None:
    _broadcast_sse({"type": "agentStatus", "changes": changes})


agent_status_watcher = AgentStatusWatcher(
    list_panes=_list_agent_panes,
    on_change=_on_agent_status_change,
    has_listeners=lambda: any(_tab_state_sse_queues.values()),
)


# ---------------------- 인증 ----------------------

# verify_auth_token 은 _deps 모듈에서 import.


@app.post("/api/ws-ticket")
async def create_ws_ticket(
    request: WsTicketRequest,
    username: str = Depends(verify_auth_token),
):
    ticket, expires_at = _create_ws_ticket(username, request.path)
    return {"ticket": ticket, "expires_at": expires_at, "ttl": WS_TICKET_TTL_SECONDS}


@app.post("/api/files/raw-ticket")
async def create_raw_file_ticket(
    request: FileTicketRequest,
    username: str = Depends(verify_auth_token),
):
    ticket, expires_at = _create_file_ticket(username, request.path)
    return {"ticket": ticket, "expires_at": expires_at, "ttl": FILE_TICKET_TTL_SECONDS}


# ---------------------- 인증 API ----------------------

@app.get("/api/health")
async def health_check():
    return {"service": "Terminal List", "status": "running", "version": "2.0.1"}


# 서버 측 feature flag — 향후 추가될 토글의 진입점.
# 컨테이너 배포에서도 "이 머신" 은 그대로 컨테이너 셸로 동작 (샌드박스).
@app.get("/api/config")
async def app_config():
    return {}


# 인증 라우트(로그인/OTP/패스키) — routes/auth.py
from routes.auth import router as auth_router  # noqa: E402
app.include_router(auth_router)



# /api/system/stats 응답 TTL 캐시 — /proc 전수 스캔(수백 PID × 수 파일) 은 동기 I/O
# 라 async 핸들러를 블로킹하므로 to_thread + 짧은 캐시로 동시 폴링을 1회 스캔에 합친다.
_SYS_STATS_TTL = 2.0
_sys_stats_cache: dict = {"at": 0.0, "value": None}
_sys_stats_lock = asyncio.Lock()


async def _get_system_stats_cached() -> dict:
    now = time.time()
    cached_value = _sys_stats_cache.get("value")
    if cached_value is not None and now - _sys_stats_cache["at"] < _SYS_STATS_TTL:
        return cached_value
    async with _sys_stats_lock:
        now = time.time()
        cached_value = _sys_stats_cache.get("value")
        if cached_value is not None and now - _sys_stats_cache["at"] < _SYS_STATS_TTL:
            return cached_value
        stats = await asyncio.to_thread(system_monitor.get_stats)
        _sys_stats_cache["value"] = stats
        _sys_stats_cache["at"] = now
        return stats


@app.get("/api/system/stats")
async def get_system_stats(username: str = Depends(verify_auth_token)):
    return await _get_system_stats_cached()


class ProcessKillRequest(BaseModel):
    # 'term' = SIGTERM (정상 종료 요청), 'kill' = SIGKILL (강제). 외부 노출 화이트리스트만.
    signal: str = "term"


_PROTECTED_PIDS = {1}  # init


def _read_proc_uid(pid: int) -> int | None:
    try:
        with open(f"/proc/{pid}/status") as f:
            for line in f:
                if line.startswith("Uid:"):
                    return int(line.split()[1])
    except (FileNotFoundError, PermissionError, ValueError):
        return None
    return None


@app.post("/api/system/processes/{pid}/kill")
async def kill_process(
    pid: int,
    req: ProcessKillRequest,
    username: str = Depends(verify_auth_token),
):
    """Top processes 패널에서 호출. 백엔드 OS 사용자 소유 프로세스만 kill 허용.

    - pid <= 1, 백엔드 자신, init 등은 거부.
    - 시그널은 'term' | 'kill' 만 허용 — 외부 raw signum 미허용 (검증 우회 방지).
    """
    if pid <= 1 or pid in _PROTECTED_PIDS:
        raise HTTPException(status_code=400, detail="protected pid")
    if pid == os.getpid() or pid == os.getppid():
        raise HTTPException(status_code=400, detail="cannot kill self")

    sig_name = (req.signal or "term").lower()
    if sig_name == "term":
        sig = signal_mod.SIGTERM
    elif sig_name == "kill":
        sig = signal_mod.SIGKILL
    else:
        raise HTTPException(status_code=400, detail="unsupported signal")

    target_uid = _read_proc_uid(pid)
    if target_uid is None:
        raise HTTPException(status_code=404, detail="process not found")

    # 백엔드 실행 사용자의 프로세스만 — root 가 아닌 한 어차피 OS 가 막지만 명시적으로 거부.
    me_uid = os.getuid()
    if target_uid != me_uid and me_uid != 0:
        raise HTTPException(status_code=403, detail="not owner")

    try:
        os.kill(pid, sig)
    except ProcessLookupError:
        raise HTTPException(status_code=404, detail="process not found")
    except PermissionError:
        raise HTTPException(status_code=403, detail="permission denied")
    except OSError as e:
        logger.error("kill_process pid=%s signal=%s failed: %s", pid, sig_name, e)
        raise HTTPException(status_code=500, detail="프로세스 종료에 실패했습니다.")

    logger.info("kill_process pid=%s signal=%s by=%s", pid, sig_name, username)
    return {"ok": True, "pid": pid, "signal": sig_name}


@app.get("/api/usage/summary")
async def get_usage_summary(
    days: int = Query(7, ge=1, le=90),
    username: str = Depends(verify_auth_token),
):
    """최근 N일 사용 통계. 빈 패널 대시보드 카드용."""
    return await storage.get_usage_summary(username, days)


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
    # 클라이언트가 마지막으로 본 서버 updatedAt — optimistic locking.
    # 값이 주어졌는데 현재 서버 값과 다르면 PUT 거부(409) + 최신 상태 반환.
    # 다중 기기에서 stale 한 클라이언트가 더 풍부한 상태(분할 pane 등)를 덮어쓰는 사고 방지.
    ifMatch: str | None = None


async def _sanitize_tab_state(tabs: list, active_tab_id: str | None) -> tuple[list, str | None]:
    """모든 terminal 로컬 pane 이 죽은 local 탭만 정리한다 — pane 단위 생사 판정.

    탭 레벨 sessionId 는 첫 pane 생성 시점 값으로 고정이라, 분할 후 첫 pane 을 닫으면
    죽은 세션을 가리킨다. 이 값 하나로 탭을 통째로 지우면 살아있는 분할 pane 들이
    고아 세션이 되어 프론트가 단일탭으로 재입양 → "분할이 단일탭으로 풀리는" 사고.
    반드시 panes 를 훑어 하나라도 살아있으면 탭을 유지한다.

    tmux 확인 결과가 비어 있으면 정리를 통째로 건너뛴다 — list-sessions 는 일시
    오류(rc!=0)와 진짜 빈 상태를 구분할 수 없고, 잘못 지운 탭 레이아웃은 복구
    불가인 반면 죽은 탭을 남겨두면 프론트가 종료 pane 으로 표시할 뿐이다.
    """
    live_local_sessions = {session.name for session in await tmux_manager.list_sessions()}
    if not live_local_sessions:
        return tabs, active_tab_id

    def _is_tab_alive(tab: dict) -> bool:
        if tab.get("type") != "local":
            return True
        panes = tab.get("panes")
        if not isinstance(panes, list) or not panes:
            # 레거시(panes 없는 옛 포맷) — 탭 레벨 sessionId 로 판정.
            session_id = tab.get("sessionId")
            return isinstance(session_id, str) and session_id in live_local_sessions
        for pane in panes:
            if not isinstance(pane, dict):
                continue
            if pane.get("hostId"):  # 호스트 pane 은 로컬 tmux 로 생사 판정 불가 — 유지
                return True
            if pane.get("mode") not in (None, "terminal"):  # editor 등 비터미널 pane — 유지
                return True
            session_id = pane.get("sessionId")
            if isinstance(session_id, str) and session_id in live_local_sessions:
                return True
        return False

    kept_tabs = []
    kept_tab_ids: set[str] = set()
    for tab in tabs:
        if not isinstance(tab, dict):
            continue
        tab_id = tab.get("id")
        if not isinstance(tab_id, str):
            continue
        if not _is_tab_alive(tab):
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


# ---------------------- 명령 히스토리 ----------------------
# 디바이스 간 공유되는 터미널별 최근 명령. 30일 retention, infinite scroll 페이징.

@app.post("/api/command-history")
async def push_command_history(
    request: CommandHistoryPushRequest,
    username: str = Depends(verify_auth_token),
):
    await storage.push_command_history(username, request.terminal_key, request.text)
    return {"status": "ok"}


@app.get("/api/command-history")
async def get_command_history(
    terminal: str,
    before: int | None = None,
    limit: int = 20,
    username: str = Depends(verify_auth_token),
):
    key = (terminal or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="terminal required")
    items = await storage.get_command_history(
        username, key, before_ms=before, limit=limit,
    )
    has_more = len(items) >= max(1, min(int(limit or 20), 100))
    return {"items": items, "hasMore": has_more}


@app.delete("/api/command-history")
async def delete_command_history(
    terminal: str,
    text: str | None = None,
    username: str = Depends(verify_auth_token),
):
    key = (terminal or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="terminal required")
    if text is None:
        removed = await storage.clear_command_history(username, key)
        return {"status": "cleared", "removed": removed}
    ok = await storage.delete_command_history_entry(username, key, text)
    return {"status": "deleted" if ok else "missing"}


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
    """폴링용 경량 엔드포인트 — updated_at 만 반환 (SSE 미지원 환경 폴백용)."""
    return {"updatedAt": await storage.get_tab_state_updated_at(username)}


@app.get("/api/agent-status")
async def get_agent_status(username: str = Depends(verify_auth_token)):
    """세션ID → {status, title, command} 전체 스냅샷.

    SSE 는 변경분만 흘리므로, 새로 붙은 클라이언트는 여기서 한 번 하이드레이션한다.
    """
    return {"sessions": agent_status_watcher.snapshot()}


@app.post("/api/sse-ticket")
async def create_sse_ticket(username: str = Depends(verify_auth_token)):
    """EventSource 는 커스텀 헤더를 보낼 수 없으므로 일회용 티켓으로 인증."""
    return {"ticket": _create_sse_ticket(username)}


@app.get("/api/tab-state/events")
async def tab_state_events(ticket: str = Query(...)):
    """tab-state 변경을 Server-Sent Events 로 푸시.

    연결 즉시 현재 updatedAt 을 전송하고, PUT /api/tab-state 가 저장할 때마다
    새 updatedAt 을 emit. 30초마다 keepalive comment 로 프록시 타임아웃 방지.
    """
    username = _consume_sse_ticket(ticket)
    if not username:
        raise HTTPException(status_code=401, detail="SSE 티켓이 유효하지 않거나 만료됨")

    queue: asyncio.Queue = asyncio.Queue(maxsize=10)

    if username not in _tab_state_sse_queues:
        _tab_state_sse_queues[username] = []
    _tab_state_sse_queues[username].append(queue)

    async def event_stream():
        try:
            current = await storage.get_tab_state_updated_at(username)
            yield f"data: {json.dumps({'updatedAt': current})}\n\n"
            while True:
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"data: {json.dumps(payload)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            queues = _tab_state_sse_queues.get(username, [])
            if queue in queues:
                queues.remove(queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.put("/api/tab-state")
async def put_tab_state(
    request: TabStateRequest,
    username: str = Depends(verify_auth_token),
):
    """탭 전체 상태 저장. 프론트엔드가 변경 시마다 (debounced) 호출.
    응답의 updatedAt 을 클라이언트가 기억해 두면 자기 자신의 PUT 을 폴링에서 무시할 수 있다.

    Optimistic locking — request.ifMatch 가 주어졌고 현재 서버 updatedAt 과 다르면 409 + current.
    이렇게 해야 stale 한 두 번째 기기가 더 풍부한 첫 번째 기기 상태를 덮어쓰는 사고를 막는다.
    """
    if not isinstance(request.tabs, list):
        raise HTTPException(status_code=400, detail="tabs must be an array")
    if request.ifMatch:
        current_updated_at = await storage.get_tab_state_updated_at(username)
        if current_updated_at and request.ifMatch != current_updated_at:
            current_state = await storage.get_tab_state(username) or {"tabs": [], "activeTabId": None, "updatedAt": current_updated_at}
            return JSONResponse(
                status_code=409,
                content={"detail": "tab-state version mismatch", "current": current_state},
            )
    tabs, active_tab_id = await _sanitize_tab_state(request.tabs, request.activeTabId)
    updated_at = await storage.save_tab_state(username, tabs, active_tab_id)
    _notify_tab_state_change(username, updated_at)
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


async def _assert_session_owner(session_id: str, username: str) -> None:
    """세션 REST 엔드포인트 소유권 체크. WS attach 의 동일 로직(existing_owner 비교)을 재사용.
    세션이 DB 에 없으면(owner=None) 통과 — WS 쪽과 동일하게 신규/미기록 세션은 허용."""
    try:
        owner = await storage.get_session_owner(session_id)
    except Exception:
        owner = None
    if owner and owner != username:
        raise HTTPException(status_code=403, detail="세션 접근 권한 없음")


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
    if not is_safe_id(session_id):
        raise HTTPException(status_code=400, detail="유효하지 않은 세션 ID입니다.")
    # 사용자당 세션 생성 rate limit — 정상적인 멀티 pane/탭 사용(빠르게 여러 개 열기)은
    # 안 막히도록 넉넉하게. WS 쪽 신규 세션 생성과 버킷을 공유(아래 terminal_websocket).
    check_rate_limit(f"session:create:{username}", max_attempts=30, window_seconds=60)
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
        raise HTTPException(status_code=500, detail="터미널 실행에 실패했습니다.")

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
    await _assert_session_owner(session_id, username)
    await tmux_manager.kill_session(session_id)
    await storage.delete_session(session_id)
    await invalidate_session(session_id)
    return {"session_id": session_id, "status": "deleted"}


@app.get("/api/sessions/{session_id}/clients")
async def get_session_clients(
    request: Request,
    session_id: str,
    client_id: str | None = Query(None),
    username: str = Depends(verify_auth_token),
):
    """세션에 현재 attach 된 tmux 클라이언트 수.
    프론트엔드 takeover 모델에서 "지금 누가 보고 있냐?" 프리플라이트 / 자동 재attach 폴링용.
    세션 자체가 없으면 attached=False 로 통일 (UI 가 그냥 신규 attach 진행하게).
    여러 탭이 같은 세션을 polling 할 때 합치되, close 직후 자기 attach 를 takeover 로
    오판하지 않도록 TTL 은 짧게 유지."""
    await _assert_session_owner(session_id, username)
    cache_key = key_local_clients(session_id)
    base = await cache.get(cache_key)
    if base is None:
        if not await tmux_manager.session_exists(session_id):
            base = {"session_id": session_id, "exists": False, "count": 0, "attached": False}
        else:
            n = await tmux_manager.clients_count(session_id)
            base = {"session_id": session_id, "exists": True, "count": n, "attached": n > 0}
        await cache.set(cache_key, base, ttl_seconds=1)
    payload = dict(base)
    payload.update(_client_identity_payload("local", session_id, client_id, request))
    return payload


@app.post("/api/sessions/{session_id}/resize")
async def resize_terminal(
    session_id: str,
    request: ResizeRequest,
    username: str = Depends(verify_auth_token),
):
    await _assert_session_owner(session_id, username)
    if not await tmux_manager.session_exists(session_id):
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    await tmux_manager.resize_window(session_id, request.cols, request.rows)
    return {"session_id": session_id, "cols": request.cols, "rows": request.rows, "status": "resized"}


@app.get("/api/sessions/{session_id}/activity")
async def get_session_activity(session_id: str, username: str = Depends(verify_auth_token)):
    """세션의 cwd 타임라인 + 워크스페이스 상대 경로 부가."""
    await _assert_session_owner(session_id, username)
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
    await _assert_session_owner(session_id, username)
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
    await _assert_session_owner(session_id, username)
    await storage.update_session_name(session_id, request.name)
    return {"session_id": session_id, "name": request.name, "status": "updated"}


# ---------------------- WebSocket 터미널 ----------------------

@app.websocket("/ws/{session_id}")
async def terminal_websocket(
    websocket: WebSocket,
    session_id: str,
    ticket: str | None = Query(None),
    client_id: str | None = Query(None),
    cols: int = Query(80),
    rows: int = Query(24),
    cwd: str | None = Query(None),
    shell: str | None = Query(None),
    create: bool = Query(True, description="false면 없는 tmux 세션을 새로 만들지 않고 연결만 시도"),
):
    if not is_safe_id(session_id):
        await websocket.close(code=1008, reason="유효하지 않은 세션 ID")
        return

    ws_path = f"/ws/{session_id}"
    username = _consume_ws_ticket(ticket, ws_path) if ticket else None
    if not username:
        await websocket.close(code=1008, reason="인증 필요")
        return

    # 세션 소유권 체크 — DB 에 기록된 세션이면 owner 와 ticket username 이 같아야 함.
    # 등록되지 않은 신규 session_id 면 통과(아래에서 새로 생성하고 username 으로 등록됨).
    # 이게 없으면 사용자 A 가 사용자 B 의 session_id 를 추측해 ticket 발급 후 attach 가능.
    try:
        existing_owner = await storage.get_session_owner(session_id)
    except Exception:
        existing_owner = None
    if existing_owner and existing_owner != username:
        await websocket.close(code=1008, reason="세션 접근 권한 없음")
        return

    await websocket.accept()
    logger.info("WS attach: session=%s user=%s", session_id, username)

    # 세션이 없으면 생성 (백엔드 재시작 후 첫 연결 또는 새 세션 직접 WS 진입)
    if not await tmux_manager.session_exists(session_id):
        if not create:
            await websocket.close(code=1000, reason="session not found")
            return
        # 신규 세션 생성만 rate limit (기존 세션 재attach/재연결은 대상 아님) —
        # REST create_session 과 같은 버킷 공유.
        try:
            check_rate_limit(f"session:create:{username}", max_attempts=30, window_seconds=60)
        except HTTPException as e:
            await websocket.close(code=1013, reason=str(e.detail)[:120])
            return
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
            # 상세 예외는 서버 로그에만. 클라이언트엔 일반 메시지.
            await websocket.close(code=1011, reason="세션 초기화에 실패했습니다.")
            return
    else:
        try:
            await storage.update_session_activity(session_id)
        except Exception:
            pass
        # tmux mouse on — 브라우저는 wheel/touch 를 SGR mouse 이벤트로 전달하고,
        # tmux 가 copy-mode 스크롤을 담당한다. 드래그 선택은 frontend 가 plain drag
        # 임계값 이후 xterm selection 으로 보정하므로 스크롤과 선택을 함께 유지한다.
        try:
            await tmux_manager._run("set-option", "-t", session_id, "mouse", "on", check=False)
            # PageUp/Down 키보드 바인딩 — alternate buffer(vim 등) 이면 앱에 전달,
            # 아니면 tmux copy-mode 로 터미널 히스토리 탐색. 마우스 모드와 무관.
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
    usage_event_id = None
    client_token = _register_ws_client("local", session_id, client_id, websocket)
    try:
        usage_event_id = await storage.record_usage_start(
            username, "local", "local", session_id
        )
    except Exception as e:
        logger.warning("usage start record failed (local %s): %s", session_id, e)
    # attach/detach 가 일어났으니 client 수 캐시 즉시 무효화.
    await invalidate_session(session_id)
    ticket_pusher = asyncio.create_task(_push_ws_tickets(bridge, username, ws_path))
    try:
        await bridge.run()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("WS bridge error (%s): %s", session_id, e)
    finally:
        ticket_pusher.cancel()
        if usage_event_id is not None:
            try:
                await storage.record_usage_end(usage_event_id)
            except Exception as e:
                logger.warning("usage end record failed (local %s): %s", session_id, e)
        await invalidate_session(session_id)
        _unregister_ws_client("local", session_id, client_token)


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

from routes.hosts import router as hosts_router  # noqa: E402
app.include_router(hosts_router)

# ---------------------- 호스트 SFTP 파일 API ----------------------
# asyncssh SFTP 로 원격 호스트 파일 시스템 브라우징/읽기/쓰기.
# 연결은 host_sftp 풀에서 재사용.

import host_sftp


from host_common import (  # noqa: E402
    MAX_COMMIT_MESSAGE_LEN,
    MAX_REMOTE_PATH_LEN,
    MAX_UPLOAD_FILE_BYTES,
    MAX_UPLOAD_FILES,
    MAX_UPLOAD_TOTAL_BYTES,
    resolve_host_with_secrets as _resolve_host_with_secrets,
    run_remote_cmd as _run_remote_cmd,
)
from routes.host_git import router as host_git_router  # noqa: E402
from routes.host_files import router as host_files_router  # noqa: E402

app.include_router(host_git_router)
app.include_router(host_files_router)


# ---------------------- WebSocket: SSH 호스트 ----------------------

@app.websocket("/ws/host/{host_id}")
async def host_websocket(
    websocket: WebSocket,
    host_id: str,
    ticket: str | None = Query(None),
    client_id: str | None = Query(None),
    cols: int = Query(80),
    rows: int = Query(24),
    pane_index: int = Query(0, description="0 이면 base 세션, 1+ 면 base.N+1 세션"),
    cwd: str | None = Query(None, description="이 연결에서 사용할 시작 디렉토리. 비우면 host.last_cwd → host.start_path 순으로 폴백."),
    tmux_suffix: str | None = Query(None, description="새 호스트 탭마다 base session 분리용 suffix. 영문/숫자/하이픈만, 32자 이내."),
    tmux_session_name: str | None = Query(None, description="명시적 tmux 세션명 override (기존 영속 세션 Resume). 주어지면 base/suffix/pane 계산 무시."),
    create: bool = Query(True, description="false면 없는 원격 tmux 세션을 새로 만들지 않고 연결만 시도"),
):
    if not is_safe_id(host_id):
        await websocket.close(code=1008, reason="유효하지 않은 호스트 ID")
        return

    ws_path = f"/ws/host/{host_id}"
    username = _consume_ws_ticket(ticket, ws_path) if ticket else None
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

    from host_manager import DEFAULT_REMOTE_TMUX_SESSION, effective_tmux_session
    if safe_session_name:
        target_tmux_session = safe_session_name
    else:
        base_session = host.get("remote_tmux_session") or DEFAULT_REMOTE_TMUX_SESSION
        if safe_suffix:
            base_session = f"{base_session}-{safe_suffix}"
        target_tmux_session = effective_tmux_session(base_session, pane_index)

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
            create_session=create,
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
            create_session=create,
        )
    usage_event_id = None
    client_token = _register_ws_client("host", f"{host_id}:{target_tmux_session}", client_id, websocket)
    try:
        usage_event_id = await storage.record_usage_start(
            username, "host", host_id, target_tmux_session
        )
    except Exception as e:
        logger.warning("usage start record failed (host %s): %s", host_id, e)
    # 새 attach/spawn 으로 세션 목록/클라이언트 수가 바뀌었을 수 있음 — 캐시 무효화.
    await invalidate_host(host_id)
    ticket_pusher = asyncio.create_task(_push_ws_tickets(bridge, username, ws_path))
    try:
        await bridge.run()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("host WS bridge error (%s): %s", host_id, e, exc_info=True)
    finally:
        ticket_pusher.cancel()
        if usage_event_id is not None:
            try:
                await storage.record_usage_end(usage_event_id)
            except Exception as e:
                logger.warning("usage end record failed (host %s): %s", host_id, e)
        # 연결 종료 시 client 수가 바뀌었을 수 있음 — invalidate.
        await invalidate_host(host_id)
        _unregister_ws_client("host", f"{host_id}:{target_tmux_session}", client_token)


# ---------------------- 파일 시스템 API ----------------------

# GIT_*_TIMEOUT 과 _run_proc 은 _deps 모듈에서 import.
# local git endpoints 는 routes/local_git.py 로 분리됨.

from routes.local_git import (  # noqa: E402
    get_git_status_dict as get_git_status,
    router as local_git_router,
)

app.include_router(local_git_router)

from routes.snippets import router as snippets_router  # noqa: E402
app.include_router(snippets_router)


# 워크스페이스 파일 — 읽기/쓰기 책임 분리. 순서 유지를 위해 read 를 먼저 등록한다.
from routes.files_read import router as files_read_router  # noqa: E402
from routes.files_write import router as files_write_router  # noqa: E402
app.include_router(files_read_router)
app.include_router(files_write_router)

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

    @app.head("/", include_in_schema=False)
    async def head_frontend():
        return Response(status_code=200, headers=NO_CACHE_HEADERS)

    # /assets 외의 단순 정적파일(favicon, robots 등) — 변경 드물지만 immutable 까지는 아님.
    FILE_CACHE_HEADERS = {"Cache-Control": "public, max-age=86400"}

    # SPA fallback 으로 index.html 을 돌려주면 안 되는 확장자.
    # 옛 클라이언트 캐시/서비스워커가 잘못된 chunk URL 을 요청해도 200 HTML 이 자산 자리에
    # 끼면 브라우저가 MIME 깨진 채 Suspense fallback (로딩 스피너) 에 영구로 갇힘 — 그래서
    # 자산 류는 명시적 404 로 빠르게 실패시켜 ErrorBoundary 가 잡거나 디버깅이 가능하게 함.
    _ASSET_LIKE_EXTS = (
        ".js", ".mjs", ".cjs", ".css", ".map",
        ".json", ".wasm",
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".ico", ".bmp",
        ".woff", ".woff2", ".ttf", ".otf", ".eot",
        ".mp3", ".mp4", ".webm", ".ogg", ".wav", ".m4a", ".flac", ".mov",
    )

    def _is_asset_like(p: str) -> bool:
        lower = p.lower()
        return any(lower.endswith(ext) for ext in _ASSET_LIKE_EXTS)

    # SW 는 항상 최신이어야 — 갱신 지연(24h) 은 업데이트 정체/구 캐시 고착 원인.
    NO_CACHE_FILES = {"sw.js"}

    @app.get("/{full_path:path}")
    async def catch_all(full_path: str):
        if full_path.startswith("api/") or full_path.startswith("ws/"):
            raise HTTPException(status_code=404, detail="Not found")
        file_path = STATIC_DIR / full_path
        if file_path.is_file():
            headers = NO_CACHE_HEADERS if full_path in NO_CACHE_FILES else FILE_CACHE_HEADERS
            return FileResponse(str(file_path), headers=headers)
        if _is_asset_like(full_path):
            raise HTTPException(status_code=404, detail="Not found")
        # SPA fallback 도 no-cache (라우팅 경로 어디로 와도 최신 index)
        return FileResponse(str(STATIC_DIR / "index.html"), headers=NO_CACHE_HEADERS)

    @app.head("/{full_path:path}", include_in_schema=False)
    async def head_catch_all(full_path: str):
        if full_path.startswith("api/") or full_path.startswith("ws/"):
            raise HTTPException(status_code=404, detail="Not found")
        file_path = STATIC_DIR / full_path
        if file_path.is_file():
            headers = NO_CACHE_HEADERS if full_path in NO_CACHE_FILES else None
            return Response(status_code=200, headers=headers)
        if _is_asset_like(full_path):
            raise HTTPException(status_code=404, detail="Not found")
        return Response(status_code=200, headers=NO_CACHE_HEADERS)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("APP_PORT", "8000")),
        reload=os.getenv("RELOAD", "true").lower() == "true",
        log_level=os.getenv("LOG_LEVEL", "info").lower(),
        # WS heartbeat — 죽은 클라(네트워크 단절·웹뷰 freeze) 가 send buffer 를
        # 무한 누적시키지 않도록 ping/pong 으로 감지하고 자동 close.
        ws_ping_interval=20.0,
        ws_ping_timeout=20.0,
        # permessage-deflate 압축 — ANSI/반복 공백이 많은 터미널 출력에서 50-70% 절감.
        ws_per_message_deflate=True,
    )

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


# WebSocket client identity registry.
# tmux 의 client count 만 보면 같은 폰이 와이파이/LTE 전환 중 만든 오래된 attach 도
# "다른 기기"처럼 보인다. 브라우저가 보낸 안정 client_id 로 같은 기기 stale 연결과
# 진짜 다른 기기를 분리한다. 프로세스 로컬 registry 이므로 백엔드 단일 프로세스 기준이다.
_ws_client_registry: dict[tuple[str, str], dict[str, dict]] = {}


def _clean_client_id(client_id: str | None) -> str | None:
    if not client_id:
        return None
    cleaned = re.sub(r"[^a-zA-Z0-9._:-]", "", client_id.strip())[:96]
    return cleaned or None


def _client_ip_from_websocket(websocket: WebSocket) -> str:
    xff = websocket.headers.get("x-forwarded-for", "").split(",")[0].strip() if trust_proxy_headers() else ""
    if xff:
        return xff
    try:
        return websocket.client.host if websocket.client else "unknown"
    except Exception:
        return "unknown"


def _register_ws_client(kind: str, session_key: str, client_id: str | None, websocket: WebSocket) -> str | None:
    clean_id = _clean_client_id(client_id)
    if not clean_id:
        return None
    token = secrets_mod.token_urlsafe(12)
    key = (kind, session_key)
    bucket = _ws_client_registry.setdefault(key, {})
    bucket[token] = {
        "client_id": clean_id,
        "ip": _client_ip_from_websocket(websocket),
        "ua": websocket.headers.get("user-agent", "")[:160],
        "connected_at": time.time(),
    }
    return token


def _unregister_ws_client(kind: str, session_key: str, token: str | None) -> None:
    if not token:
        return
    key = (kind, session_key)
    bucket = _ws_client_registry.get(key)
    if not bucket:
        return
    bucket.pop(token, None)
    if not bucket:
        _ws_client_registry.pop(key, None)


def _client_identity_payload(kind: str, session_key: str, client_id: str | None, request: Request) -> dict:
    clean_id = _clean_client_id(client_id)
    entries = list(_ws_client_registry.get((kind, session_key), {}).values())
    if not clean_id:
        return {
            "same_client_count": 0,
            "other_client_count": len(entries),
            "same_client_active": False,
            "other_client_active": bool(entries),
            "network_changed": False,
        }
    same = [e for e in entries if e.get("client_id") == clean_id]
    other = [e for e in entries if e.get("client_id") != clean_id]
    current_ip = client_ip_from_request(request)
    same_ips = sorted({e.get("ip") or "unknown" for e in same})
    return {
        "same_client_count": len(same),
        "other_client_count": len(other),
        "same_client_active": bool(same),
        "other_client_active": bool(other),
        "network_changed": bool(same and current_ip not in same_ips),
        "client_ip": current_ip,
        "same_client_ips": same_ips,
    }


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
    try:
        yield
    finally:
        logger.info("=== Terminal List 종료 ===")
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


AUTH_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _request_is_https(request: Request) -> bool:
    if request.url.scheme == "https":
        return True
    if _env_flag("TRUST_PROXY_HEADERS"):
        return request.headers.get("x-forwarded-proto", "").split(",", 1)[0].strip().lower() == "https"
    return False


# AUTH_COOKIE_SECURE: "auto"(기본) | "1"(강제 secure) | "0"(강제 non-secure).
# 기본 배포 방식이 리버스 프록시 없이 http://<서버-IP>:<PORT> 로 직접 접속하는 것이라
# (README/deploy 문서 참고) "non-localhost 면 무조건 secure=True" 로 바꾸면 표준 배포에서
# 로그인 쿠키가 브라우저에 저장은 되지만 이후 요청에 재전송되지 않아 로그인이 깨진다.
# 그래서 auto 의 판정 로직 자체는 유지(scheme 기반) 하고, HTTPS 종료 리버스 프록시 뒤에
# 있는데 TRUST_PROXY_HEADERS 를 안 켠 애매한 구성만 기동 시 경고로 알린다.
_AUTH_COOKIE_SECURE_MODE = os.getenv("AUTH_COOKIE_SECURE", "auto").strip().lower()
if _AUTH_COOKIE_SECURE_MODE in {"0", "false", "no", "off"}:
    logger.warning(
        "[auth] AUTH_COOKIE_SECURE=%s — 인증 쿠키가 항상 secure=False 로 발급됩니다. "
        "localhost 개발 환경이 아니라면 위험합니다.",
        _AUTH_COOKIE_SECURE_MODE,
    )
elif _AUTH_COOKIE_SECURE_MODE not in {"1", "true", "yes", "on"} and not _env_flag("TRUST_PROXY_HEADERS"):
    logger.warning(
        "[auth] AUTH_COOKIE_SECURE=auto, TRUST_PROXY_HEADERS=0. "
        "HTTPS 를 종료하는 리버스 프록시 뒤에서 서비스한다면 요청 scheme 이 http 로 보여 "
        "인증 쿠키가 non-secure 로 발급될 수 있습니다. 그런 구성이면 TRUST_PROXY_HEADERS=1 "
        "또는 AUTH_COOKIE_SECURE=1 을 설정하세요."
    )


def _resolve_auth_cookie_secure(request: Request) -> bool:
    """쿠키 secure 플래그 결정.

    - AUTH_COOKIE_SECURE=1/0 이면 명시적으로 강제.
    - 기본값(auto)은 기존 동작 유지: request scheme(또는 신뢰된 X-Forwarded-Proto) 기반.
      표준 배포가 프록시 없이 http 로 직접 서비스되므로(README 참고) non-localhost 라고
      무조건 secure=True 로 바꾸면 그 표준 배포의 로그인이 깨진다 — 그래서 판정 로직은
      건드리지 않고, 애매한 구성은 기동 시 로그 경고로만 알린다.
    """
    if _AUTH_COOKIE_SECURE_MODE in {"1", "true", "yes", "on"}:
        return True
    if _AUTH_COOKIE_SECURE_MODE in {"0", "false", "no", "off"}:
        return False
    return _request_is_https(request)


def _set_auth_cookie(response: Response, request: Request, token: str) -> None:
    secure = _resolve_auth_cookie_secure(request)
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        max_age=AUTH_COOKIE_MAX_AGE_SECONDS,
        httponly=True,
        secure=secure,
        samesite="strict",
        path="/",
    )


def _clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(key=AUTH_COOKIE_NAME, path="/", samesite="strict")


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


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str


from file_models import (  # noqa: E402
    FileCreateRequest,
    FileMoveRequest,
    FileWriteRequest,
    HostFileWriteRequest,
    MAX_FILE_WRITE_BYTES,
    MAX_PATH_FIELD_LEN,
)


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


_HOSTNAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-:]{0,253}$")
_SSH_USER_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9._\-]{0,63}$")
_REMOTE_TMUX_SESSION_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_MAX_START_PATH_LEN = 4096


class HostUpsertRequest(BaseModel):
    name: str
    hostname: str
    port: int = 22
    ssh_user: str
    auth_method: str = "key"        # 'key' | 'password'

    @field_validator("hostname")
    @classmethod
    def _check_hostname(cls, v: str) -> str:
        # 선행 '-' 금지 — ssh argv 옵션처럼 해석되는 인자 인젝션 방어.
        # 영문/숫자/점/하이픈/언더스코어/콜론(IPv6 :) 만 허용. 길이 254.
        if not v or not _HOSTNAME_RE.match(v):
            raise ValueError("invalid hostname")
        return v

    @field_validator("ssh_user")
    @classmethod
    def _check_ssh_user(cls, v: str) -> str:
        if not v or not _SSH_USER_RE.match(v):
            raise ValueError("invalid ssh_user")
        return v

    @field_validator("port")
    @classmethod
    def _check_port(cls, v: int) -> int:
        if v < 1 or v > 65535:
            raise ValueError("invalid port")
        return v
    key_id: str | None = None
    password: str | None = None  # 평문으로 들어와서 vault 로 암호화 후 저장
    color_index: int = 0
    group_name: str | None = None
    use_remote_tmux: bool = True
    remote_tmux_session: str | None = "mobile"
    start_path: str | None = None
    icon: str | None = None
    theme: str | None = None  # pane.themeOverride 자동 적용용 (없으면 글로벌 settings.theme)

    @field_validator("remote_tmux_session")
    @classmethod
    def _check_remote_tmux_session(cls, v: str | None) -> str | None:
        # 원격 tmux 세션명으로 그대로 쓰이므로(effective_tmux_session 등) 영문/숫자/하이픈/
        # 언더스코어만 허용 — tmux 커맨드 인자 인젝션/구분자 오염 방지.
        if v is None or v == "":
            return v
        if not _REMOTE_TMUX_SESSION_RE.match(v):
            raise ValueError("invalid remote_tmux_session")
        return v

    @field_validator("start_path")
    @classmethod
    def _check_start_path(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return v
        if "\x00" in v:
            raise ValueError("invalid start_path: null byte")
        if len(v) >= _MAX_START_PATH_LEN:
            raise ValueError(f"start_path too long (>{_MAX_START_PATH_LEN} chars)")
        return v


class WsTicketRequest(BaseModel):
    path: str


class FileTicketRequest(BaseModel):
    path: str


class PasskeyRegisterBeginRequest(BaseModel):
    label: str | None = None  # 사용자 메모 (예: "MacBook Air")


class PasskeyRegisterCompleteRequest(BaseModel):
    label: str | None = None
    response: dict  # 브라우저 navigator.credentials.create() 결과 (JSON 직렬화된 PublicKeyCredential)


class PasskeyLoginCompleteRequest(BaseModel):
    challenge_id: str  # begin 단계에서 발급한 임시 ID (challenge 캐시 key)
    response: dict     # 브라우저 navigator.credentials.get() 결과


class PasskeyRenameRequest(BaseModel):
    label: str

    @field_validator("label")
    @classmethod
    def _check_label(cls, v: str) -> str:
        s = (v or "").strip()
        if not s or len(s) > 64:
            raise ValueError("label required (≤64 chars)")
        return s


class CommandHistoryPushRequest(BaseModel):
    terminal_key: str
    text: str

    @field_validator("terminal_key")
    @classmethod
    def _check_terminal_key(cls, v: str) -> str:
        s = (v or "").strip()
        if not s or len(s) > 128:
            raise ValueError("terminal_key required (≤128 chars)")
        return s

    @field_validator("text")
    @classmethod
    def _check_text(cls, v: str) -> str:
        # 빈/공백 only / 너무 긴 텍스트는 거절. 호출 측이 trim 했다고 가정하지만 방어.
        s = (v or "").replace("\r", "").rstrip("\n").strip()
        if not s:
            raise ValueError("text empty")
        if len(s) > 500:
            raise ValueError("text too long (>500)")
        return s


# ---------------------- 시스템 모니터 ----------------------

class SystemMonitor:
    # /proc 전수 스캔은 매번 비싸므로(800+ PID × 5파일 read) get_stats() 사이에 캐시.
    # CPU% 델타 계산에는 충분한 간격이 필요하므로 너무 짧으면 의미 없음 — 1.5s 가 절충.
    PROC_SCAN_CACHE_TTL = 1.5
    # RSS 가 이보다 작으면 잡벌레로 보고 cmdline/status/stat 읽기 전 컷.
    PROC_RSS_MIN_BYTES = 4 * 1024 * 1024  # 4 MB

    def __init__(self):
        self.last_cpu_time = 0
        self.last_idle_time = 0
        self.last_update = 0
        self.cached_cpu_percent = 0.0
        self.last_net_time = 0.0
        self.last_net_rx = 0
        self.last_net_tx = 0
        self.cached_net_rx_rate = 0.0
        self.cached_net_tx_rate = 0.0
        # pid → utime+stime ticks. get_stats() 호출 간 델타로 process CPU% 계산.
        self.last_proc_cpu: dict = {}
        self.last_proc_total_ticks = 0
        # process 스캔 캐시 — 짧은 시간 안에 여러 번 호출돼도 한 번만 한다.
        self.cached_top_processes: list = []
        self.last_proc_scan = 0.0
        # /proc/stat baseline priming — 첫 get_stats() 호출에서 cached_cpu_percent 가 0.0
        # 으로 보이지 않게, 모듈 import 시점에 한 번 sample 을 찍어 last_cpu_time/idle 을
        # 채워둔다. 첫 API 호출은 보통 import 후 수 초 이상 뒤이므로 그 사이 diff 로
        # 의미있는 값이 계산된다. Info 패널 "CPU 항상 바닥" 증상 방어.
        self._prime_cpu_sample()
        # 프로세스 CPU% baseline 도 동일하게 prime — 첫 scan 의 prev_ticks 가 self == current
        # 이라 모든 process cpu_percent 가 0 으로 떨어지는 문제를 import-time 한 번에 해결.
        self._prime_proc_cpu_sample()

    def _prime_cpu_sample(self):
        try:
            if not os.path.exists("/proc/stat"):
                return
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
                self.last_cpu_time = user + nice + system + idle + iowait + irq + softirq
                self.last_idle_time = idle
                self.last_update = time.time()
        except (OSError, ValueError):
            pass

    def _prime_proc_cpu_sample(self):
        """모든 pid 의 utime+stime 을 한 번 읽어 last_proc_cpu / last_proc_total_ticks 를 채운다.

        첫 _scan_top_processes() 호출에서 prev_ticks 가 self == current 로 떨어져 cpu_percent
        가 전부 0 으로 보이는 문제 방지. import 시점 한 번이라 비용은 OK (수백 pid × 1 file).
        """
        try:
            # /proc/stat 총 ticks baseline
            with open("/proc/stat") as f:
                parts = f.readline().split()
            if len(parts) >= 8:
                self.last_proc_total_ticks = sum(int(x) for x in parts[1:8])
        except (OSError, ValueError):
            pass
        try:
            for entry in os.scandir("/proc"):
                if not entry.name.isdigit():
                    continue
                pid = int(entry.name)
                try:
                    with open(os.path.join(entry.path, "stat")) as f:
                        raw = f.read()
                    rparen = raw.rfind(")")
                    if rparen == -1:
                        continue
                    tail = raw[rparen + 2:].split()
                    if len(tail) >= 13:
                        self.last_proc_cpu[pid] = int(tail[11]) + int(tail[12])
                except (OSError, ValueError):
                    continue
        except OSError:
            pass

    def get_stats(self):
        # 백워드 호환 — 기존 'cpu/ram/disk' 퍼센트는 그대로 두고 절대값/load/uptime 을 추가.
        stats: dict = {"cpu": 0.0, "ram": 0.0, "disk": 0.0}
        try:
            if os.path.exists("/proc/meminfo"):
                meminfo = {}
                with open("/proc/meminfo") as f:
                    for line in f:
                        parts = line.split()
                        if len(parts) >= 2:
                            meminfo[parts[0].rstrip(":")] = int(parts[1])
                total = meminfo.get("MemTotal", 0)
                available = meminfo.get("MemAvailable", 0)
                if total > 0:
                    mem_free = meminfo.get("MemFree", 0)
                    buffers = meminfo.get("Buffers", 0)
                    cached = max(0, meminfo.get("Cached", 0) + meminfo.get("SReclaimable", 0) - meminfo.get("Shmem", 0))
                    swap_total = meminfo.get("SwapTotal", 0)
                    swap_free = meminfo.get("SwapFree", 0)
                    swap_used = max(0, swap_total - swap_free)
                    stats["ram"] = round((total - available) / total * 100, 1)
                    stats["mem_total"] = total * 1024            # bytes
                    stats["mem_used"] = (total - available) * 1024
                    stats["mem_available"] = available * 1024
                    stats["mem_free"] = mem_free * 1024
                    stats["mem_buffers"] = buffers * 1024
                    stats["mem_cache"] = cached * 1024
                    stats["swap_total"] = swap_total * 1024
                    stats["swap_used"] = swap_used * 1024
                    stats["swap_free"] = swap_free * 1024
                    stats["swap"] = round(swap_used / swap_total * 100, 1) if swap_total > 0 else 0.0

            try:
                usage = os.statvfs(WORKSPACE_ROOT)
                d_total = usage.f_blocks * usage.f_frsize
                d_free = usage.f_bfree * usage.f_frsize
                if d_total > 0:
                    stats["disk"] = round((d_total - d_free) / d_total * 100, 1)
                    stats["disk_total"] = d_total
                    stats["disk_used"] = d_total - d_free
                    stats["disk_free"] = d_free
                    stats["disk_path"] = str(WORKSPACE_ROOT)
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
                with open("/proc/cpuinfo") as f:
                    for line in f:
                        if line.startswith("model name"):
                            stats["cpu_model"] = line.split(":", 1)[1].strip()
                            break
            except Exception:
                pass

            try:
                net_rx = net_tx = 0
                interfaces = []
                with open("/proc/net/dev") as f:
                    for line in f.readlines()[2:]:
                        if ":" not in line:
                            continue
                        name, data = line.split(":", 1)
                        iface = name.strip()
                        if iface == "lo":
                            continue
                        fields = data.split()
                        if len(fields) < 16:
                            continue
                        rx = int(fields[0])
                        tx = int(fields[8])
                        if rx == 0 and tx == 0:
                            continue
                        net_rx += rx
                        net_tx += tx
                        interfaces.append({"name": iface, "rx_bytes": rx, "tx_bytes": tx})
                elapsed = now - self.last_net_time if self.last_net_time else 0
                if elapsed >= 0.5 and self.last_net_time:
                    self.cached_net_rx_rate = max(0.0, (net_rx - self.last_net_rx) / elapsed)
                    self.cached_net_tx_rate = max(0.0, (net_tx - self.last_net_tx) / elapsed)
                if elapsed >= 0.5 or not self.last_net_time:
                    self.last_net_time = now
                    self.last_net_rx = net_rx
                    self.last_net_tx = net_tx
                stats["net_rx_bytes"] = net_rx
                stats["net_tx_bytes"] = net_tx
                stats["net_rx_rate"] = round(self.cached_net_rx_rate, 1)
                stats["net_tx_rate"] = round(self.cached_net_tx_rate, 1)
                stats["net_interfaces"] = sorted(interfaces, key=lambda item: item["rx_bytes"] + item["tx_bytes"], reverse=True)[:4]
            except Exception:
                pass

            # process 스캔은 비용이 크므로 캐시. TTL 안에서는 직전 결과 재사용.
            if now - self.last_proc_scan >= self.PROC_SCAN_CACHE_TTL:
                try:
                    self.cached_top_processes = self._scan_top_processes()
                    self.last_proc_scan = now
                except Exception as e:
                    logger.debug("process scan failed: %s", e)
            stats["top_processes"] = self.cached_top_processes

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

    def _scan_top_processes(self) -> list:
        """/proc 전수 스캔 — RSS 컷오프로 잡벌레 제거 후 상위 10개만 디테일 수집.

        호출자(get_stats)가 캐시한다. CPU% 는 마지막 스캔 이후 누적 ticks 델타로 계산.
        """
        page_size = os.sysconf("SC_PAGE_SIZE")
        cpu_count = os.cpu_count() or 1
        rss_min = self.PROC_RSS_MIN_BYTES

        # /proc/stat 총 jiffies 델타 (CPU% denominator)
        total_ticks_now = 0
        try:
            with open("/proc/stat") as f:
                parts = f.readline().split()
            if len(parts) >= 8:
                total_ticks_now = sum(int(x) for x in parts[1:8])
        except Exception:
            pass
        total_delta = max(0, total_ticks_now - (self.last_proc_total_ticks or total_ticks_now))
        self.last_proc_total_ticks = total_ticks_now

        # Phase 1: 가벼운 statm 만 읽어 RSS 컷오프 통과한 후보만 추림.
        candidates: list[tuple[int, str, int]] = []
        try:
            for entry in os.scandir("/proc"):
                if not entry.name.isdigit():
                    continue
                pid = int(entry.name)
                try:
                    with open(os.path.join(entry.path, "statm")) as f:
                        statm = f.read().split()
                    rss = int(statm[1]) * page_size if len(statm) > 1 else 0
                    if rss < rss_min:
                        continue
                    candidates.append((pid, entry.path, rss))
                except Exception:
                    continue
        except Exception:
            return self.cached_top_processes

        # RSS 기준 정렬 후 상위 N×3 만 디테일 수집(클립 후에도 충분한 여유).
        candidates.sort(key=lambda item: item[2], reverse=True)
        candidates = candidates[:30]

        llm_markers = (
            "ollama", "llama", "llamacpp", "vllm", "transformers",
            "torch", "cuda", "codex", "openai", "anthropic",
        )
        me_uid = os.getuid()
        try:
            import pwd as _pwd
        except ImportError:
            _pwd = None

        processes: list[dict] = []
        next_proc_cpu: dict = {}
        for pid, proc_dir, rss in candidates:
            try:
                with open(os.path.join(proc_dir, "comm")) as f:
                    name = f.read().strip()
                cmd = ""
                try:
                    with open(os.path.join(proc_dir, "cmdline"), "rb") as f:
                        cmd = f.read().replace(b"\x00", b" ").decode("utf-8", "ignore").strip()
                except Exception:
                    pass
                uid = None
                try:
                    with open(os.path.join(proc_dir, "status")) as f:
                        for line in f:
                            if line.startswith("Uid:"):
                                uid = int(line.split()[1])
                                break
                except Exception:
                    pass
                # /proc/<pid>/stat 의 utime(14) + stime(15). comm 에 공백/괄호 안전하게 ')' 기준 분할.
                proc_ticks = 0
                try:
                    with open(os.path.join(proc_dir, "stat")) as f:
                        raw = f.read()
                    rparen = raw.rfind(")")
                    if rparen != -1:
                        tail = raw[rparen + 2:].split()
                        if len(tail) >= 13:
                            proc_ticks = int(tail[11]) + int(tail[12])
                except Exception:
                    pass
                prev_ticks = self.last_proc_cpu.get(pid, proc_ticks)
                next_proc_cpu[pid] = proc_ticks
                cpu_percent = 0.0
                if total_delta > 0 and proc_ticks >= prev_ticks:
                    cpu_percent = round((proc_ticks - prev_ticks) / total_delta * 100 * cpu_count, 1)
                label = cmd or name
                lower_label = label.lower()
                owner_name = ""
                if uid is not None:
                    if _pwd is not None:
                        try:
                            owner_name = _pwd.getpwuid(uid).pw_name
                        except KeyError:
                            owner_name = str(uid)
                    else:
                        owner_name = str(uid)
                processes.append({
                    "pid": pid,
                    "name": name,
                    "cmd": label[:180],
                    "rss_bytes": rss,
                    "cpu_percent": cpu_percent,
                    "uid": uid,
                    "user": owner_name,
                    "is_mine": uid == me_uid if uid is not None else False,
                    "llm_like": any(marker in lower_label for marker in llm_markers),
                })
            except Exception:
                continue

        self.last_proc_cpu = next_proc_cpu
        processes.sort(key=lambda item: item["rss_bytes"], reverse=True)
        return processes[:10]


system_monitor = SystemMonitor()


# ---------------------- ID 검증 ----------------------

# session_id / host_id 는 클라이언트가 UUID v4 로 생성하지만, 셸/tmux 메타문자
# (; | $ ` 공백 따옴표 등) 가 섞인 값을 거부해 명령 인젝션 여지를 원천 차단한다.
# UUID 외에도 영숫자·하이픈·언더스코어 조합이면 허용 (친화적 세션명 대비).
_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def is_safe_id(value: str | None) -> bool:
    return bool(value) and bool(_SAFE_ID_RE.match(value))


# ---------------------- WebSocket ticket ----------------------

# 30s — 재연결용 사전 발급 티켓이 끊김~재접속 사이 유효하도록 약간 길게(단일 사용).
WS_TICKET_TTL_SECONDS = 30
# 연결된 WS 위로 다음 재연결용 티켓을 미리 밀어주는 주기. 클라가 stash 해 두면 재연결 때
# HTTP fetch 없이 바로 WebSocket 을 연다(= Jupyter 처럼 fresh TCP, wedge 된 연결 풀 우회).
WS_TICKET_PUSH_INTERVAL_SECONDS = 10
_ws_tickets: dict[str, dict] = {}
FILE_TICKET_TTL_SECONDS = 30
_file_tickets: dict[str, dict] = {}


def _cleanup_ws_tickets(now: float | None = None) -> None:
    now = now or time.time()
    expired = [ticket for ticket, meta in _ws_tickets.items() if meta.get("expires_at", 0) <= now]
    for ticket in expired:
        _ws_tickets.pop(ticket, None)


def _normalize_ws_path(path: str) -> str:
    path = (path or "").split("?", 1)[0].strip()
    if not path.startswith("/ws/"):
        raise HTTPException(status_code=400, detail="유효하지 않은 WebSocket 경로입니다")
    return path


def _create_ws_ticket(username: str, path: str) -> tuple[str, float]:
    now = time.time()
    _cleanup_ws_tickets(now)
    ticket = secrets_mod.token_urlsafe(32)
    expires_at = now + WS_TICKET_TTL_SECONDS
    _ws_tickets[ticket] = {"username": username, "path": _normalize_ws_path(path), "expires_at": expires_at}
    return ticket, expires_at


def _consume_ws_ticket(ticket: str | None, path: str) -> str | None:
    if not ticket:
        return None
    now = time.time()
    _cleanup_ws_tickets(now)
    meta = _ws_tickets.pop(ticket, None)
    if not meta or meta.get("expires_at", 0) <= now:
        return None
    if meta.get("path") != _normalize_ws_path(path):
        return None
    return meta.get("username")


async def _push_ws_tickets(bridge, username: str, ws_path: str) -> None:
    """연결된 WS 위로 다음 재연결용 단일사용 티켓을 주기적으로 밀어준다.

    클라가 이걸 stash 해 두면, 재연결 시 /api/ws-ticket fetch(공유 HTTP/2 연결을 재사용 —
    모바일 네트워크 전환 시 wedge 되는 주범) 없이 곧바로 새 WebSocket 을 연다. 새 WebSocket 은
    항상 fresh TCP 라 wedge 된 연결 풀을 우회한다(= JupyterLab 의 직접 연결과 동일한 회복력).
    """
    import json as _json
    try:
        while True:
            tk, exp = _create_ws_ticket(username, ws_path)
            await bridge.send_control(_json.dumps({"type": "ws_ticket", "ticket": tk, "expires_at": exp}))
            await asyncio.sleep(WS_TICKET_PUSH_INTERVAL_SECONDS)
    except asyncio.CancelledError:
        pass
    except Exception as e:
        # 티켓 payload(JSON) 를 보내다 실패한 예외라 str(e) 에 값이 실릴 수 있음 —
        # 로그에는 타입명만 남기고 티켓 자체는 절대 남기지 않는다.
        logger.debug("ws ticket push stopped (%s): %s", ws_path, type(e).__name__)


def _cleanup_file_tickets(now: float | None = None) -> None:
    now = now or time.time()
    expired = [ticket for ticket, meta in _file_tickets.items() if meta.get("expires_at", 0) <= now]
    for ticket in expired:
        _file_tickets.pop(ticket, None)


def _create_file_ticket(username: str, path: str) -> tuple[str, float]:
    now = time.time()
    _cleanup_file_tickets(now)
    safe = validate_path(path)
    ticket = secrets_mod.token_urlsafe(32)
    expires_at = now + FILE_TICKET_TTL_SECONDS
    _file_tickets[ticket] = {"username": username, "path": str(safe), "expires_at": expires_at}
    return ticket, expires_at


def _consume_file_ticket(ticket: str | None) -> str | None:
    if not ticket:
        return None
    now = time.time()
    _cleanup_file_tickets(now)
    meta = _file_tickets.pop(ticket, None)
    if not meta or meta.get("expires_at", 0) <= now:
        return None
    return meta.get("path")


# ---------------------- SSE ticket (tab-state EventSource 인증) ----------------------
# EventSource 는 커스텀 헤더 불가 → 일회용 티켓으로 초기 인증 후 스트림 유지.

SSE_TICKET_TTL_SECONDS = 30
_sse_tickets: dict[str, dict] = {}


def _create_sse_ticket(username: str) -> str:
    now = time.time()
    expired = [t for t, m in list(_sse_tickets.items()) if m["expires_at"] <= now]
    for t in expired:
        _sse_tickets.pop(t, None)
    ticket = secrets_mod.token_urlsafe(32)
    _sse_tickets[ticket] = {"username": username, "expires_at": now + SSE_TICKET_TTL_SECONDS}
    return ticket


def _consume_sse_ticket(ticket: str | None) -> str | None:
    if not ticket:
        return None
    meta = _sse_tickets.pop(ticket, None)
    if not meta or meta["expires_at"] <= time.time():
        return None
    return meta["username"]


# ---------------------- tab-state SSE 브로드캐스트 ----------------------
# username → 연결 중인 EventSource 클라이언트 큐 목록

_tab_state_sse_queues: dict[str, list[asyncio.Queue]] = {}


def _notify_tab_state_change(username: str, updated_at: str) -> None:
    """PUT /api/tab-state 저장 후 호출 — 모든 SSE 클라이언트에 버전 전파."""
    for q in list(_tab_state_sse_queues.get(username, [])):
        try:
            q.put_nowait(updated_at)
        except asyncio.QueueFull:
            pass


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


@app.get("/api/auth/status")
async def auth_status():
    if auth_manager is None:
        return {"setup_complete": False, "passkey_available": False}
    setup_complete = await auth_manager.is_setup_complete()
    passkey_available = False
    if setup_complete:
        admin = await storage.get_admin()
        if admin:
            creds = await storage.list_passkey_credentials(admin["username"])
            passkey_available = len(creds) > 0
    return {"setup_complete": setup_complete, "passkey_available": passkey_available}


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
async def login(request: LoginRequest, http_request: Request, response: Response):
    if auth_manager is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    # rate limit: IP 당 60초 10회, username 당 5분 20회.
    # IP 만 보면 NAT 뒤 여러 사용자가 같이 깎이고, username 만 보면 IP 분산 공격을 못 막음.
    ip = client_ip_from_request(http_request)
    check_rate_limit(f"login:ip:{ip}", max_attempts=10, window_seconds=60)
    check_rate_limit(f"login:user:{request.username}", max_attempts=20, window_seconds=300)
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
    _set_auth_cookie(response, http_request, access_token)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "username": request.username,
        "otp_required": False,
    }


@app.post("/api/auth/login/otp")
async def login_otp(request: OtpLoginRequest, http_request: Request, response: Response):
    if auth_manager is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    # OTP 무차별 대입 방지 — 6자리 코드(100만 조합)는 짧은 시간 안 5회 시도면
    # 통계적으로 위험. IP + pending_token 양쪽 limit.
    ip = client_ip_from_request(http_request)
    check_rate_limit(f"otp:ip:{ip}", max_attempts=5, window_seconds=60)
    check_rate_limit(f"otp:tok:{request.pending_token[:32]}", max_attempts=5, window_seconds=300)
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
    _set_auth_cookie(response, http_request, access_token)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "username": username,
        "otp_required": False,
    }


@app.get("/api/auth/verify")
async def verify_token(
    request: Request,
    response: Response,
    username: str = Depends(verify_auth_token),
    authorization: str | None = Header(None),
    auth_cookie: str | None = Cookie(None, alias=AUTH_COOKIE_NAME),
):
    # Smooth migration: an old localStorage Bearer token that still verifies is
    # promoted to the new HttpOnly cookie, then the frontend can delete it.
    if authorization and authorization.startswith("Bearer ") and not auth_cookie:
        bearer = authorization[len("Bearer "):].strip()
        if bearer and bearer.lower() not in {"null", "undefined"}:
            _set_auth_cookie(response, request, bearer)
    return {"valid": True, "username": username}


@app.post("/api/auth/refresh")
async def refresh_token(
    request: Request,
    response: Response,
    username: str = Depends(verify_auth_token),
):
    """현재 유효한 토큰으로 만료 시각을 새로 24h 미룬 토큰을 재발급.
    활동 중인 사용자가 24h 정각에 튕기지 않게 프론트가 주기적으로 호출한다.
    (만료된 토큰은 Depends 에서 401 → 프론트가 로그인 유도)"""
    if auth_manager is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    access_token = await auth_manager.create_access_token(username)
    _set_auth_cookie(response, request, access_token)
    return {"access_token": access_token, "token_type": "bearer", "username": username}


@app.post("/api/auth/logout")
async def logout(response: Response):
    _clear_auth_cookie(response)
    return {"success": True}


@app.post("/api/auth/change-password")
async def change_password(
    request: PasswordChangeRequest,
    response: Response,
    username: str = Depends(verify_auth_token),
):
    """현재 비밀번호 확인 후 새 비밀번호로 변경. 성공 시 세션 쿠키 무효화."""
    if auth_manager is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    if len(request.new_password) < 8:
        raise HTTPException(status_code=400, detail="비밀번호는 8자 이상이어야 합니다")
    if request.new_password == request.current_password:
        raise HTTPException(status_code=400, detail="새 비밀번호가 기존 비밀번호와 같습니다")
    changed = await auth_manager.change_password(
        username, request.current_password, request.new_password
    )
    if not changed:
        raise HTTPException(status_code=401, detail="현재 비밀번호가 올바르지 않습니다")
    # 비밀번호 변경 후 재로그인 강제 — 기존 세션 쿠키 제거
    _clear_auth_cookie(response)
    return {"success": True}


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


# ---------------------- 패스키 (WebAuthn) ----------------------
# RP ID / origin 은 들어오는 Request 의 Host 헤더에서 추출 (env 박지 않음).
# challenge 는 AuthManager 의 in-memory dict 에 5분만 보관.

from passkey import (  # noqa: E402
    derive_rp_info,
    make_authentication_options,
    make_registration_options,
    verify_authentication as _verify_authn,
    verify_registration as _verify_reg,
)


@app.post("/api/auth/passkey/register/begin")
async def passkey_register_begin(
    request: PasskeyRegisterBeginRequest,
    http_request: Request,
    username: str = Depends(verify_auth_token),
):
    """기존(비번/OTP) 인증을 통과한 사용자가 새 패스키를 등록하기 위한 challenge 발급."""
    if auth_manager is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    rp_id, _origin = derive_rp_info(http_request)
    existing = await storage.list_passkey_credentials(username)
    options, challenge = make_registration_options(
        rp_id=rp_id,
        username=username,
        existing_credential_ids=[c["credential_id"] for c in existing],
    )
    auth_manager._store_passkey_challenge("register", username, challenge)
    return {"options": options, "rp_id": rp_id}


@app.post("/api/auth/passkey/register/complete")
async def passkey_register_complete(
    request: PasskeyRegisterCompleteRequest,
    http_request: Request,
    username: str = Depends(verify_auth_token),
):
    if auth_manager is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    challenge = auth_manager._consume_passkey_challenge("register", username)
    if not challenge:
        raise HTTPException(status_code=400, detail="등록 세션이 만료되었습니다. 다시 시작해주세요.")
    rp_id, origin = derive_rp_info(http_request)
    verification = _verify_reg(
        response_dict=request.response,
        expected_challenge=challenge,
        expected_origin=origin,
        expected_rp_id=rp_id,
    )
    transports = []
    raw_transports = (request.response or {}).get("response", {}).get("transports")
    if isinstance(raw_transports, list):
        transports = [str(t) for t in raw_transports if t]
    label = (request.label or "").strip() or None
    row_id = await storage.add_passkey_credential(
        username=username,
        credential_id=verification.credential_id,
        public_key=verification.credential_public_key,
        sign_count=int(verification.sign_count or 0),
        transports=transports,
        label=label,
        aaguid=getattr(verification, "aaguid", None) and bytes(verification.aaguid) if hasattr(verification, "aaguid") else None,
        backup_eligible=bool(getattr(verification, "credential_backed_up", False)),
        backup_state=bool(getattr(verification, "credential_backed_up", False)),
    )
    return {"status": "registered", "id": row_id, "label": label}


@app.post("/api/auth/passkey/login/begin")
async def passkey_login_begin(http_request: Request):
    """로그인 challenge — 단일 admin 환경이라 allowCredentials 를 그 사용자의 자격증명으로 미리 채운다.
    setup 미완료면 거절. rate-limit IP 기준.
    """
    if auth_manager is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    ip = client_ip_from_request(http_request)
    check_rate_limit(f"passkey:ip:{ip}", max_attempts=20, window_seconds=60)
    if not await auth_manager.is_setup_complete():
        raise HTTPException(status_code=400, detail="초기 설정을 먼저 완료해주세요")
    rp_id, _ = derive_rp_info(http_request)
    # 단일 admin 가정. resident key 흐름 위해 list 가 비어도 동작은 가능하지만
    # 등록된 패스키가 하나도 없으면 명시적으로 안내한다.
    admin = await storage.get_admin()
    all_creds = await storage.list_passkey_credentials(admin["username"]) if admin else []
    if not all_creds:
        raise HTTPException(status_code=400, detail="등록된 패스키가 없습니다")
    options, challenge, challenge_id = make_authentication_options(
        rp_id=rp_id,
        allow_credential_ids=[c["credential_id"] for c in all_creds],
    )
    auth_manager._store_passkey_challenge("authenticate", challenge_id, challenge)
    return {"options": options, "challenge_id": challenge_id, "rp_id": rp_id}


@app.post("/api/auth/passkey/login/complete")
async def passkey_login_complete(request: PasskeyLoginCompleteRequest, http_request: Request, response: Response):
    if auth_manager is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    ip = client_ip_from_request(http_request)
    check_rate_limit(f"passkey:ip:{ip}", max_attempts=20, window_seconds=60)
    challenge = auth_manager._consume_passkey_challenge("authenticate", request.challenge_id)
    if not challenge:
        raise HTTPException(status_code=401, detail="인증 세션이 만료되었습니다. 다시 시도해주세요.")
    rp_id, origin = derive_rp_info(http_request)

    # 응답 객체의 rawId 또는 id (base64url) 에서 credential_id 추출 → DB 조회
    raw_id = (request.response or {}).get("rawId") or (request.response or {}).get("id")
    if not isinstance(raw_id, str) or not raw_id:
        raise HTTPException(status_code=400, detail="잘못된 패스키 응답")
    from passkey import _b64u_decode
    try:
        credential_id = _b64u_decode(raw_id)
    except Exception:
        raise HTTPException(status_code=400, detail="credential_id 디코딩 실패")
    cred = await storage.get_passkey_credential(credential_id)
    if not cred:
        raise HTTPException(status_code=401, detail="등록되지 않은 패스키입니다")

    verification = _verify_authn(
        response_dict=request.response,
        expected_challenge=challenge,
        expected_origin=origin,
        expected_rp_id=rp_id,
        credential_public_key=cred["public_key"],
        credential_current_sign_count=cred["sign_count"],
    )
    await storage.update_passkey_after_use(
        credential_id=cred["credential_id"],
        sign_count=int(verification.new_sign_count or 0),
    )
    access_token = await auth_manager.create_access_token(cred["username"])
    _set_auth_cookie(response, http_request, access_token)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "username": cred["username"],
        "otp_required": False,
    }


@app.get("/api/auth/passkey/list")
async def passkey_list(username: str = Depends(verify_auth_token)):
    rows = await storage.list_passkey_credentials(username)
    from passkey import _b64u_encode
    return {
        "items": [
            {
                "id": r["id"],
                "label": r["label"],
                "credential_id_b64": _b64u_encode(r["credential_id"]),
                "transports": r["transports"],
                "created_at": r["created_at"],
                "last_used_at": r["last_used_at"],
            }
            for r in rows
        ]
    }


@app.patch("/api/auth/passkey/{row_id}")
async def passkey_rename(row_id: int, request: PasskeyRenameRequest, username: str = Depends(verify_auth_token)):
    ok = await storage.rename_passkey_credential(row_id, username, request.label)
    if not ok:
        raise HTTPException(status_code=404, detail="패스키를 찾을 수 없습니다")
    return {"status": "renamed"}


@app.delete("/api/auth/passkey/{row_id}")
async def passkey_delete(row_id: int, username: str = Depends(verify_auth_token)):
    ok = await storage.delete_passkey_credential(row_id, username)
    if not ok:
        raise HTTPException(status_code=404, detail="패스키를 찾을 수 없습니다")
    return {"status": "deleted"}


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
                    updated_at = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"data: {json.dumps({'updatedAt': updated_at})}\n\n"
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
        raise HTTPException(status_code=500, detail="tmux 세션 종료에 실패했습니다.")
    await invalidate_host(host_id)  # 세션 목록·client 수 캐시 즉시 무효화
    await ssh_pool.invalidate(host_id)  # 풀의 살아있는 conn 도 끊어 새로 시작
    return {"id": host_id, "session": target_session, "status": "server_killed" if force else "killed"}


@app.get("/api/hosts/{host_id}/tmux-clients")
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


@app.get("/api/hosts/{host_id}/tmux-check")
async def check_host_tmux(
    host_id: str,
    username: str = Depends(verify_auth_token),
):
    """원격 호스트에 tmux 가 설치되어 있는지 사전 체크.
    설정 토글 전 프론트엔드에서 호출 → available=false 면 토글 차단/경고."""
    host = await storage.get_host(host_id, username)
    if not host:
        raise HTTPException(status_code=404, detail="호스트를 찾을 수 없습니다")

    cmd = "command -v tmux 2>/dev/null && echo YES || echo NO"
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
    return {"host_id": host_id, "available": available}


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
        return {"id": host_id, "sessions": [], "error": "원격 tmux 세션 조회 실패"}

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
    await cache.set(cache_key, payload, ttl_seconds=60)
    return payload


@app.get("/api/hosts/tmux-sessions/batch")
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
        hosts = [h for h in all_hosts if h.get("id") in wanted]
    else:
        hosts = [h for h in all_hosts if h.get("use_remote_tmux")]
    if not hosts:
        return {"items": []}

    tasks = [
        _fetch_host_tmux_sessions(h, h["id"], username, refresh) for h in hosts
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    items: list[dict] = []
    for h, r in zip(hosts, results):
        if isinstance(r, Exception):
            logger.warning("batch tmux-sessions exception (%s): %s", h.get("id"), r)
            items.append({"id": h["id"], "sessions": [], "error": "원격 tmux 세션 조회 실패"})
        else:
            items.append(r)
    return {"items": items}


@app.get("/api/hosts/{host_id}/tmux-sessions")
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

    git_statuses = await get_git_status()
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
        raise HTTPException(status_code=500, detail="파일 검색에 실패했습니다.")


@app.get("/api/files/grep")
async def grep_files(
    q: str = Query("", min_length=1, max_length=200),
    limit: int = Query(200, ge=1, le=500),
    username: str = Depends(verify_auth_token),
):
    """워크스페이스 전체 파일 내용 검색(ripgrep). 리터럴·대소문자 무시.
    반응성 우선: 파일당 max-count 10, 최대 1MB 파일, 8s 타임아웃, limit 로 총 결과 상한."""
    query = q.strip()
    if not query:
        return {"items": []}
    workspace_abs = os.path.abspath(WORKSPACE_ROOT)
    ignore_globs: list[str] = []
    for d in _FILE_INDEX_IGNORED:
        ignore_globs += ["-g", f"!{d}"]
    args = [
        "rg", "--json", "-i", "-F",
        "--max-count", "10", "--max-filesize", "1M", "--max-columns", "300",
        *ignore_globs,
        "-e", query, "--", workspace_abs,
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _stderr = await asyncio.wait_for(proc.communicate(), timeout=8)
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except Exception:
            pass
        raise HTTPException(status_code=504, detail="검색 시간이 초과되었습니다.")
    except FileNotFoundError:
        raise HTTPException(status_code=501, detail="ripgrep(rg) 가 설치되어 있지 않습니다.")
    except Exception as e:
        logger.error("grep failed (q=%s): %s", q, e)
        raise HTTPException(status_code=500, detail="검색에 실패했습니다.")

    items = []
    for raw in stdout.splitlines():
        if len(items) >= limit:
            break
        try:
            obj = json.loads(raw)
        except Exception:
            continue
        if obj.get("type") != "match":
            continue
        data = obj.get("data", {})
        abs_path = (data.get("path") or {}).get("text")
        if not abs_path:
            continue
        rel = os.path.relpath(abs_path, workspace_abs).replace("\\", "/")
        text = ((data.get("lines") or {}).get("text") or "").rstrip("\n")
        items.append({
            "path": rel,
            "name": os.path.basename(rel),
            "line": data.get("line_number"),
            "text": text[:300],
        })
    return {"items": items, "truncated": len(items) >= limit}


@app.get("/api/files/raw")
async def get_raw_file(
    path: str | None = Query(None),
    ticket: str | None = Query(None),
    authorization: str | None = Header(None),
):
    if ticket:
        ticket_path = _consume_file_ticket(ticket)
        if not ticket_path:
            raise HTTPException(status_code=401, detail="유효하지 않은 파일 티켓입니다")
        safe = Path(ticket_path)
    else:
        if not path:
            raise HTTPException(status_code=400, detail="파일 경로가 필요합니다")
        await verify_auth_token(authorization)
        safe = validate_path(path)
    if not safe.exists() or not safe.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    # 워크스페이스 안에 만들어진 심볼릭 링크로 외부 경로(/etc/passwd 등) 노출 차단.
    if safe.is_symlink():
        raise HTTPException(status_code=403, detail="Symlinks not allowed")
    return FileResponse(str(safe))


MAX_LOCAL_ZIP_BYTES = host_sftp.MAX_DOWNLOAD_BYTES
MAX_LOCAL_ZIP_FILES = host_sftp.MAX_DOWNLOAD_FILES


class _ZipTooLargeError(Exception):
    """워크스페이스 zip 다운로드가 크기/파일 수 제한을 초과."""


# 누적 크기/파일 수 한도를 공유 카운터로 추적하며 base(파일 또는 디렉터리)를 zip 에 추가.
# 단일/다중 다운로드가 같은 로직을 쓰도록 추출 — 한도 검사 드리프트 방지.
def _add_path_to_zip(zf: "zipfile.ZipFile", base: Path, counters: dict) -> None:
    def bump(size: int) -> None:
        counters["total"] += size
        counters["count"] += 1
        if counters["total"] > MAX_LOCAL_ZIP_BYTES or counters["count"] > MAX_LOCAL_ZIP_FILES:
            raise _ZipTooLargeError(
                f"download too large (>{MAX_LOCAL_ZIP_BYTES} bytes or "
                f"> {MAX_LOCAL_ZIP_FILES} files)"
            )

    if base.is_file():
        try:
            bump(base.stat().st_size)
        except OSError:
            return
        zf.write(base, base.name)
        return

    for current_root, dirs, files in os.walk(base, followlinks=False):
        # 심볼릭 링크 디렉토리는 따라가지 않음 — zip 폭탄/순환 방지.
        dirs[:] = [d for d in dirs if not (Path(current_root) / d).is_symlink()]
        current = Path(current_root)
        if not dirs and not files:
            zf.writestr(f"{current.relative_to(base.parent).as_posix()}/", b"")
        for file_name in files:
            file_path = current / file_name
            if file_path.is_symlink():
                continue
            try:
                size = file_path.stat().st_size
            except OSError:
                continue
            bump(size)
            zf.write(file_path, file_path.relative_to(base.parent).as_posix())


def _zip_directory_bytes(root: Path) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        _add_path_to_zip(zf, root, {"total": 0, "count": 0})
    return buffer.getvalue()


def _zip_paths_bytes(paths: list[Path]) -> bytes:
    buffer = io.BytesIO()
    counters = {"total": 0, "count": 0}
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for base in paths:
            _add_path_to_zip(zf, base, counters)
    return buffer.getvalue()


@app.get("/api/files/download")
async def download_workspace_item(
    path: str = Query(...),
    username: str = Depends(verify_auth_token),
):
    safe = validate_path(path)
    if not safe.exists():
        raise HTTPException(status_code=404, detail="Not found")
    if safe.is_symlink():
        raise HTTPException(status_code=403, detail="Symlinks not allowed")
    if safe.is_file():
        return FileResponse(str(safe), filename=safe.name)
    if safe.is_dir():
        filename = f"{safe.name or 'workspace'}.zip"
        quoted = quote(filename)
        try:
            data = await asyncio.to_thread(_zip_directory_bytes, safe)
        except _ZipTooLargeError as e:
            raise HTTPException(status_code=413, detail=str(e))
        return Response(
            content=data,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quoted}"},
        )
    raise HTTPException(status_code=400, detail="Unsupported file type")


class DownloadZipRequest(BaseModel):
    paths: list[str] = Field(..., min_length=1, max_length=500)


@app.post("/api/files/download-zip")
async def download_workspace_zip(
    body: DownloadZipRequest,
    username: str = Depends(verify_auth_token),
):
    """다중 선택 항목을 단일 zip 으로 묶어 다운로드 (로컬 워크스페이스)."""
    raw_paths = [p for p in body.paths if p and p.strip()]
    if not raw_paths:
        raise HTTPException(status_code=400, detail="No paths provided")
    safes: list[Path] = []
    for p in raw_paths:
        safe = validate_path(p)
        if not safe.exists():
            raise HTTPException(status_code=404, detail=f"Not found: {p}")
        if safe.is_symlink():
            raise HTTPException(status_code=403, detail="Symlinks not allowed")
        safes.append(safe)
    try:
        data = await asyncio.to_thread(_zip_paths_bytes, safes)
    except _ZipTooLargeError as e:
        raise HTTPException(status_code=413, detail=str(e))
    filename = f"download-{len(safes)}-items.zip"
    quoted = quote(filename)
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quoted}"},
    )


@app.head("/api/files/download", include_in_schema=False)
async def head_workspace_item_download(
    path: str = Query(...),
    username: str = Depends(verify_auth_token),
):
    safe = validate_path(path)
    if not safe.exists():
        raise HTTPException(status_code=404, detail="Not found")
    if safe.is_file():
        quoted = quote(safe.name)
        return Response(
            status_code=200,
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{quoted}",
                "Content-Length": str(safe.stat().st_size),
            },
        )
    if safe.is_dir():
        filename = f"{safe.name or 'workspace'}.zip"
        quoted = quote(filename)
        return Response(
            status_code=200,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quoted}"},
        )
    raise HTTPException(status_code=400, detail="Unsupported file type")


@app.get("/api/files/read")
async def read_file(path: str = Query(...), username: str = Depends(verify_auth_token)):
    safe = validate_path(path)
    if not safe.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if safe.is_symlink():
        raise HTTPException(status_code=403, detail="Symlinks not allowed")
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
    safe = validate_path(request.path, allow_root=False)
    safe.parent.mkdir(parents=True, exist_ok=True)
    safe.write_text(request.content, encoding="utf-8")
    return {"status": "written", "path": request.path}


@app.post("/api/files/move")
async def move_file(request: FileMoveRequest, username: str = Depends(verify_auth_token)):
    src = validate_path(request.source, allow_root=False)
    dst = validate_path(request.destination, allow_root=False)
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
    safe = validate_path(request.path, allow_root=False)
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


@app.post("/api/files/upload")
async def upload_files(
    files: list[UploadFile] = FastAPIFile(...),
    dest: str = Form(""),
    username: str = Depends(verify_auth_token),
):
    if len(files) > MAX_UPLOAD_FILES:
        raise HTTPException(status_code=413, detail=f"파일이 너무 많습니다 (최대 {MAX_UPLOAD_FILES}개)")
    workspace = Path(WORKSPACE_ROOT)
    dest_path = validate_path(dest) if dest else workspace
    if not dest_path.is_dir():
        raise HTTPException(status_code=400, detail="Destination is not a directory")
    results = []
    total = 0
    upload_chunk = 1024 * 1024  # 1 MB
    for f in files:
        filename = os.path.basename(f.filename or "")
        if not filename:
            continue
        target = dest_path / filename
        if not str(target.resolve()).startswith(str(workspace.resolve())):
            raise HTTPException(status_code=403, detail="Path outside workspace")
        target.parent.mkdir(parents=True, exist_ok=True)
        # 스트리밍 쓰기 — f.read() 로 전체 메모리 적재 시 200MB×N 업로드가 OOM 위험.
        # 청크 단위로 디스크에 직접 쓰고, 한도 초과 시 부분 파일 삭제.
        file_size = 0
        tmp = target.with_suffix(target.suffix + ".part")
        try:
            with open(tmp, "wb") as out:
                while True:
                    chunk = await f.read(upload_chunk)
                    if not chunk:
                        break
                    file_size += len(chunk)
                    if file_size > MAX_UPLOAD_FILE_BYTES:
                        raise HTTPException(
                            status_code=413,
                            detail=f"파일 '{filename}' 가 너무 큽니다 (최대 {MAX_UPLOAD_FILE_BYTES} bytes)",
                        )
                    total += len(chunk)
                    if total > MAX_UPLOAD_TOTAL_BYTES:
                        raise HTTPException(
                            status_code=413,
                            detail=f"업로드 합계가 너무 큽니다 (최대 {MAX_UPLOAD_TOTAL_BYTES} bytes)",
                        )
                    out.write(chunk)
            os.replace(tmp, target)
        except Exception:
            try:
                tmp.unlink()
            except OSError:
                pass
            raise
        rel = str(target.relative_to(workspace)).replace("\\", "/")
        results.append({"name": f.filename, "path": rel, "size": file_size})
    _invalidate_file_index()
    return {"status": "uploaded", "files": results}


# 클립보드 이미지 붙여넣기 전용 — 단일 이미지 저장 후 절대경로 반환.
# 터미널에서 paste 시 프론트가 이 경로를 입력으로 주입해 Claude Code 등이 바로 읽게 한다.
_PASTE_IMAGE_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/svg+xml": "svg",
}


@app.post("/api/terminal/paste-image")
async def paste_image(
    file: UploadFile = FastAPIFile(...),
    username: str = Depends(verify_auth_token),
):
    content_type = (file.content_type or "").lower()
    if content_type not in _PASTE_IMAGE_EXT:
        raise HTTPException(status_code=400, detail="이미지 파일만 붙여넣을 수 있습니다")

    workspace = Path(WORKSPACE_ROOT)
    dest_dir = workspace / ".pasted"
    dest_dir.mkdir(parents=True, exist_ok=True)

    ext = _PASTE_IMAGE_EXT[content_type]
    stamp = f"{time.strftime('%Y%m%d-%H%M%S')}-{int(time.time() * 1000) % 1000:03d}"
    target = dest_dir / f"pasted-{stamp}.{ext}"

    file_size = 0
    chunk_size = 1024 * 1024  # 1 MB
    tmp = target.with_suffix(target.suffix + ".part")
    try:
        with open(tmp, "wb") as out:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                file_size += len(chunk)
                if file_size > MAX_UPLOAD_FILE_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"이미지가 너무 큽니다 (최대 {MAX_UPLOAD_FILE_BYTES} bytes)",
                    )
                out.write(chunk)
        os.replace(tmp, target)
    except Exception:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise

    _invalidate_file_index()
    rel = str(target.relative_to(workspace)).replace("\\", "/")
    return {"status": "uploaded", "path": str(target), "rel_path": rel, "size": file_size}


@app.post("/api/terminal/paste-file")
async def paste_file(
    file: UploadFile = FastAPIFile(...),
    username: str = Depends(verify_auth_token),
):
    """터미널로 보낼 임의 파일 업로드 — .pasted/ 에 저장하고 경로를 돌려준다.
    이미지 전용 paste-image 의 일반판(사진/파일 아무거나 골라 보내기). 파일명은 basename+화이트리스트로
    정규화해 경로 traversal 을 원천 차단하고, 타임스탬프 prefix 로 충돌을 막는다."""
    workspace = Path(WORKSPACE_ROOT)
    dest_dir = workspace / ".pasted"
    dest_dir.mkdir(parents=True, exist_ok=True)

    raw_name = os.path.basename(file.filename or "file").strip() or "file"
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", raw_name)[:80].lstrip(".") or "file"
    stamp = f"{time.strftime('%Y%m%d-%H%M%S')}-{int(time.time() * 1000) % 1000:03d}"
    target = dest_dir / f"{stamp}-{safe_name}"

    file_size = 0
    chunk_size = 1024 * 1024  # 1 MB
    tmp = target.with_suffix(target.suffix + ".part")
    try:
        with open(tmp, "wb") as out:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                file_size += len(chunk)
                if file_size > MAX_UPLOAD_FILE_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"파일이 너무 큽니다 (최대 {MAX_UPLOAD_FILE_BYTES} bytes)",
                    )
                out.write(chunk)
        os.replace(tmp, target)
    except Exception:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise

    _invalidate_file_index()
    rel = str(target.relative_to(workspace)).replace("\\", "/")
    return {"status": "uploaded", "path": str(target), "rel_path": rel, "size": file_size}


@app.delete("/api/files")
async def delete_file(path: str = Query(...), username: str = Depends(verify_auth_token)):
    safe = validate_path(path, allow_root=False)
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

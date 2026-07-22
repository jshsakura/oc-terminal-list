"""
Terminal List - 백엔드 FastAPI 서버

세션 영속성은 호스트의 tmux 서버가 담당한다.
- 백엔드는 tmux 서버에 명령을 보내고, WebSocket↔tmux client PTY를 중계한다.
- 백엔드가 죽어도 tmux 서버가 살아있으면 세션은 유지된다.
- 동일 세션에 웹/SSH 등 여러 클라이언트가 동시 attach 가능하다.
"""
import logging
import mimetypes
import os
import shutil
import stat
from contextlib import asynccontextmanager
from pathlib import Path

import anyio
from dotenv import load_dotenv
from fastapi import (
    Depends,
    FastAPI,
    HTTPException,
    Request,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import Headers
from starlette.types import Receive, Scope, Send

from _deps import (
    WORKSPACE_ROOT,
    set_auth_manager,
    verify_auth_token,
)
from auth_manager import AuthManager
from sqlite_storage import storage
from ssh_pool import ssh_pool
from tmux_manager import tmux_manager

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
    # VAPID 키를 기동 시 만들어 둔다 — 지연 생성하면 권한/디스크 문제를 사용자가
    # "알림 켜기"를 누르는 순간에야 알게 된다. 실패해도 앱은 뜬다(푸시만 비활성).
    try:
        from push_keys import get_public_key
        get_public_key()
    except Exception as e:
        logger.warning("VAPID 키 준비 실패 — 웹 푸시가 비활성화됩니다: %s", e)
    ssh_pool.start_janitor(idle_timeout=300)
    agent_status_watcher.start()
    # 텔레그램 버튼 콜백 롱폴링 — 설정이 없으면 스스로 쉰다(연결 시도 안 함).
    telegram_worker.start()
    try:
        yield
    finally:
        logger.info("=== Terminal List 종료 ===")
        await agent_status_watcher.stop()
        await telegram_worker.stop()
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

# ---------------------- 모델 ----------------------
# 파일 관련 모델은 file_models.py 가 이미 소유 — 여기서 재수출하지 않는다.
# 나머지 요청 본문 모델 — models.py
from models import (  # noqa: E402
    FileTicketRequest, WsTicketRequest,
)


# 시스템 모니터는 라우트가 아니라 순수 수집기 — system_monitor.py 로 분리.

# ID 검증(is_safe_id)은 경계 검증이라 _deps 로 이관.

# 단명 티켓 3종(WS/파일/SSE) — tickets.py
from tickets import (  # noqa: E402
    WS_TICKET_TTL_SECONDS, FILE_TICKET_TTL_SECONDS, _create_ws_ticket, _create_file_ticket,
)
# SSE 브로드캐스트 레지스트리 — sse_broadcast.py
# 에이전트 상태 워처 배선 — agent_status_service.py
from agent_status_service import agent_status_watcher  # noqa: E402
from telegram_service import telegram_worker  # noqa: E402



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


# ---------------------- 라우터 등록 ----------------------
#
# ⚠️  이 순서가 곧 매칭 우선순위다 (FastAPI 는 먼저 등록된 라우트를 먼저 본다).
# 임의로 재배열하지 말 것 — 리터럴 경로와 `{param}` 경로가 겹치는 순간 조용히
# 엉뚱한 핸들러로 간다. 순서 회귀는 테스트로 안 잡히므로, 바꿀 일이 있으면
# 라우트 목록을 순서까지 포함해 이전 커밋과 대조하라.
#
# 파일 라우터는 read 를 먼저 등록한다(쓰기 쪽 경로가 읽기 쪽을 가리지 않도록).

from routes.auth import router as auth_router  # noqa: E402
from routes.system import router as system_router  # noqa: E402
from routes.tailscale import router as tailscale_router  # noqa: E402
from routes.user_state import router as user_state_router  # noqa: E402
from routes.sessions import router as sessions_router  # noqa: E402
from routes.terminal_ws import router as terminal_ws_router  # noqa: E402
from routes.ssh_keys import router as ssh_keys_router  # noqa: E402
from routes.hosts import router as hosts_router  # noqa: E402
from routes.host_git import router as host_git_router  # noqa: E402
from routes.host_files import router as host_files_router  # noqa: E402
from routes.host_ws import router as host_ws_router  # noqa: E402
from routes.local_git import router as local_git_router  # noqa: E402
from routes.snippets import router as snippets_router  # noqa: E402
from routes.files_read import router as files_read_router  # noqa: E402
from routes.files_write import router as files_write_router  # noqa: E402
from routes.push import router as push_router  # noqa: E402
from routes.itl import router as itl_router  # noqa: E402

for _router in (
    auth_router,          # 로그인 / OTP / 패스키
    system_router,        # 리소스 stats · 프로세스 kill · usage
    tailscale_router,     # 사설망 피어 조회
    user_state_router,    # UI 설정 · 명령 히스토리 · 탭 상태 · SSE
    sessions_router,      # 세션 REST
    terminal_ws_router,   # 로컬 터미널 WebSocket
    ssh_keys_router,      # SSH 개인키 보관
    hosts_router,         # 호스트 CRUD · 원격 tmux
    host_git_router,      # 원격 git
    host_files_router,    # 원격 SFTP 파일
    host_ws_router,       # 원격 셸 WebSocket
    local_git_router,     # 워크스페이스 git
    snippets_router,      # 명령 스니펫
    files_read_router,    # 워크스페이스 파일 읽기
    files_write_router,   # 워크스페이스 파일 쓰기
    push_router,          # 웹 푸시 구독
    itl_router,           # 세션 간 명령 전달 (itl CLI)
):
    app.include_router(_router)

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

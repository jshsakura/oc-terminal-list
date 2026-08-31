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

# ⚠️ .env 로드는 **앱 모듈 import 보다 먼저**여야 한다.
#
# 이 저장소의 여러 모듈이 import 시점에 os.getenv 를 읽는다 — sqlite_storage 의 DB_PATH,
# _deps 의 WORKSPACE_ROOT, tmux_manager 의 TMUX_SOCKET_NAME, ssh_pool 의 타임아웃들.
# load_dotenv 가 그 아래에 있으면 그 값들에는 .env 가 **영영 닿지 않는다.** 에러는 안 난다 —
# 조용히 기본값으로 뜬다.
#
# 프로덕션은 systemd 의 EnvironmentFile=.env 가 프로세스 환경에 미리 넣어 줘서 가려져
# 있었다. 드러나는 곳은 `python run.py`(dev) 다 — 거기서는 .env 가 무시되어
# TMUX_SOCKET_NAME 이 기본값(= 운영 소켓!)으로 떨어진다. 즉 개발용으로 띄운 인스턴스가
# 운영 tmux 서버와 DB 를 잡는다. 실제로 그렇게 붙어 버린 적이 있다(2026-08-31).
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(_PROJECT_ROOT, ".env"), override=True)
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

import access_log_filter
from _deps import (
    WORKSPACE_ROOT,
    set_auth_manager,
    verify_auth_token,
)
from auth_manager import AuthManager
from sqlite_storage import storage
from ssh_pool import ssh_pool
from tmux_manager import tmux_manager

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)
# asyncssh 는 접속/채널/인증 과정을 INFO 로 대량 출력 — WARNING 이상만 표시
logging.getLogger("asyncssh").setLevel(logging.WARNING)
# 폴링의 성공 응답을 솎아 WS attach/detach·경고가 보이게 한다(access_log_filter 참고).
access_log_filter.install()




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
        # 하단 상태바도 켠다. create_session 은 새 세션에만 걸므로, 이걸 안 하면 백엔드보다
        # 오래 산 세션들은 재시작할 때까지 바가 안 보인다. 값은 create_session 의 opts 와
        # **한 벌**이어야 한다.
        #
        # ⚠️ **전역(-g)만으로는 안 된다.** 옛 세션들은 `status off` 를 **세션 레벨**로 들고
        # 있고(그때의 create_session 이 그렇게 걸었다), 세션 값은 전역을 이긴다. 실측:
        # 전역 `status on` + 세션 `status off` → 그 세션은 계속 off. 그래서 전역을 깔고
        # 살아 있는 세션마다 다시 건다.
        _status_opts = (
            ("status", "on"),
            ("status-left", "#{?@itl_addr,[#{@itl_addr}] ,[#{session_name}] }"),
        )
        for _k, _v in _status_opts:
            await tmux_manager._run("set-option", "-g", _k, _v, check=False)
        # 한때 색·오른쪽 칸·갱신 주기까지 덮었다. 세션 값은 그대로 남으므로 코드에서
        # 빼는 것만으로는 안 돌아온다 — `-u` 로 명시적으로 떼야 tmux 순정이 된다.
        _drop = ("status-style", "window-status-current-style", "status-right", "status-interval")
        for _k in _drop:
            await tmux_manager._run("set-option", "-gu", _k, check=False)
        for _sess in await tmux_manager.list_sessions():
            for _k, _v in _status_opts:
                await tmux_manager._run("set-option", "-t", _sess.name, _k, _v, check=False)
            for _k in _drop:
                await tmux_manager._run("set-option", "-u", "-t", _sess.name, _k, check=False)
        # 저장된 탭 상태로 주소를 한 번 새긴다 — 백엔드가 재시작해도(세션은 살아남는다)
        # 상태바가 빈 주소로 남지 않게. 다음 갱신은 PUT /api/tab-state 가 한다.
        try:
            from itl_addr_stamp import stamp_local_addresses
            _admin = await storage.get_admin()
            if _admin and _admin.get("username"):
                _st = await storage.get_tab_state(_admin["username"])
                if _st:
                    await stamp_local_addresses(_st.get("tabs") or [])
        except Exception:
            logger.debug("itl addr stamp (startup) 실패", exc_info=True)
        # status off 시절에 서버 전역으로 풀어 둔 좌클릭을 되살린다(unbind 는 남는다).
        await tmux_manager._run(
            "bind-key", "-T", "root", "MouseDown1Status", "select-window -t =", check=False,
        )
    # 이 기계의 에이전트가 옆 터미널을 부릴 수 있게 itl MCP 를 등록해 둔다.
    # 설정 파일이 없거나(그 기계에서 에이전트를 쓴 적이 없다) 사람이 손으로 쓴 항목이
    # 있으면 아무것도 하지 않는다 — ITL_AUTO_MCP=0 으로 끈다.
    try:
        from agent_mcp import ensure_local_agent_mcp
        ensure_local_agent_mcp()
    except Exception as e:
        logger.warning("itl MCP 자동 등록 실패: %s", e)
    # tmux 에 없는 세션 행 정리. 세션은 `DELETE /api/sessions/{id}` 를 **안 거치고도** 죽는다
    # (기계 재부팅, tmux 서버 종료, OOM kill) — 그때 행은 영원히 남는다. 실측으로 45개가
    # 그렇게 쌓여 있었다.
    # ⚠️ 살아있는 목록이 비면 아무것도 지우지 않는다. "전부 죽었다" 와 "tmux 를 못 물어봤다"
    # 가 같은 모습이고, 살아있는 세션의 행을 지우면 소유권 조회가 None 이 되어 그 세션에
    # 다시 붙지 못한다. 재부팅 직후처럼 목록이 빈 경우는 다음 재시작에서 정리된다.
    try:
        live_ids = {s.name for s in await tmux_manager.list_sessions()}
        removed = await storage.prune_sessions_not_in(live_ids)
        if removed:
            logger.info("정리: tmux 에 없는 세션 행 %d개 삭제", removed)
    except Exception as e:
        logger.warning("session row prune skipped: %s", e)

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
    # 하루 한 번 사용량·누수 요약 — 크론이 아니라 서비스가 보낸다(자격증명과 수집기를
    # 이미 이 프로세스가 들고 있다). 텔레그램이 설정돼 있지 않으면 스스로 쉰다.
    usage_report_worker.start()
    try:
        yield
    finally:
        logger.info("=== Terminal List 종료 ===")
        await agent_status_watcher.stop()
        await telegram_worker.stop()
        await usage_report_worker.stop()
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


app = FastAPI(title="Terminal List", version="2.2.0", lifespan=lifespan)

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
from usage_report import usage_report_worker  # noqa: E402



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
    return {"service": "Terminal List", "status": "running", "version": "2.2.0"}


# 서버 측 feature flag — 향후 추가될 토글의 진입점.
# 컨테이너 배포에서도 "이 머신" 은 그대로 컨테이너 셸로 동작 (샌드박스).
@app.get("/api/config")
async def app_config():
    """부팅 직후 프론트가 1회 읽는 공개 설정.

    `tmux_socket` 은 비밀이 아니다 — 이 서버의 세션이 **어느 소켓에 있는지**이고,
    그걸 모르면 복사한 세션 이름으로 붙을 수가 없다(`tmux attach -t X` 는 기본 소켓을
    본다). 붙는 것은 여전히 그 머신의 셸 권한이 있어야 하는 일이다.
    """
    from tmux_manager import TMUX_SOCKET_NAME

    return {"tmux_socket": TMUX_SOCKET_NAME}


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
from routes.host_files_write import router as host_files_write_router  # noqa: E402
from routes.host_ws import router as host_ws_router  # noqa: E402
from routes.vnc import router as vnc_router  # noqa: E402
from routes.vnc_ws import router as vnc_ws_router  # noqa: E402
from routes.local_git import router as local_git_router  # noqa: E402
from routes.snippets import router as snippets_router  # noqa: E402
from routes.files_read import router as files_read_router  # noqa: E402
from routes.files_write import router as files_write_router  # noqa: E402
from routes.push import router as push_router  # noqa: E402
from routes.itl import router as itl_router  # noqa: E402
from routes.fleet import router as fleet_router  # noqa: E402
from routes.llm_usage import router as llm_usage_router  # noqa: E402
from routes.ws_tickets import router as ws_tickets_router  # noqa: E402
from routes.remote_ws import router as remote_ws_router  # noqa: E402

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
    host_files_router,    # 원격 SFTP 파일 — 읽기
    host_files_write_router,  # 원격 SFTP 파일 — 쓰기/전송
    host_ws_router,       # 원격 셸 WebSocket
    vnc_router,           # Xvnc 원격 데스크탑 디스커버리 / 세션
    vnc_ws_router,        # Xvnc RFB WebSocket 터널
    local_git_router,     # 워크스페이스 git
    snippets_router,      # 명령 스니펫
    files_read_router,    # 워크스페이스 파일 읽기
    files_write_router,   # 워크스페이스 파일 쓰기
    push_router,          # 웹 푸시 구독
    itl_router,           # 세션 간 명령 전달 (itl CLI)
    fleet_router,         # 실행 중 보드 — 기계별 상태 + 모든 pane (호스트당 왕복 1회)
    llm_usage_router,     # LLM 토큰·비용 (호스트별 llm-watcher 집계)
    ws_tickets_router,    # WS 티켓 배치 발급 (부팅 시 pane 수만큼 나가던 POST 를 1회로)
    remote_ws_router,     # 호스트에 심은 리모트가 걸어 들어오는 통로
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
        # 종료 상한 — 없으면 uvicorn 이 "Waiting for connections to close" 에서
        # **무한히** 기다린다. shutdown() 은 각 연결에 transport.close() 를 걸지만
        # asyncio transport 의 close 는 write buffer 를 먼저 비우므로, 멈춘 피어
        # (모바일 네트워크 전환·포화된 공유 터널)에 물린 터미널 WS 하나가 그 버퍼를
        # 영영 붙잡으면 connection_lost 가 오지 않는다. 그러면 systemd 의
        # TimeoutStopSec(15s) 가 만료돼 SIGKILL 이 오고 lifespan 의 정리
        # (SQLite close·SSH/SFTP 풀 정리)가 통째로 건너뛰어진다 — 실측으로 최근
        # 재시작 23회 중 13회가 이 경로였다. 5초면 살아있는 클라가 닫기에 충분하고,
        # 남은 10초는 lifespan 정리 몫이다.
        timeout_graceful_shutdown=5,
    )

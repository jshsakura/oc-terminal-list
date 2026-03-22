"""
iTerminaLlist - 백엔드 FastAPI 서버
모바일 최적화된 웹 터미널 에뮬레이터
"""
import logging
import os
import shutil
import json
import time
from pathlib import Path
from dotenv import load_dotenv

# .env 파일 로드 (프로젝트 루트 경로 명시)
_current_file = os.path.abspath(__file__)
_project_root = os.path.dirname(os.path.dirname(_current_file))
_env_path = os.path.join(_project_root, ".env")
load_dotenv(_env_path)
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Header, Depends, Query, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional
from starlette.types import Scope, Receive, Send

from pty_manager import pty_manager
from sqlite_storage import storage
from auth_manager import AuthManager

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# FastAPI 앱 생성
app = FastAPI(
    title="Terminal List",
    description="영속적 세션 지원 웹 터미널 에뮬레이터",
    version="1.0.0"
)

# CORS 설정 (프론트엔드 통신 허용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 프로덕션에서는 특정 도메인으로 제한
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Gzip 압축 미들웨어 (성능 향상)
app.add_middleware(GZipMiddleware, minimum_size=1000)


# 캐시 헤더를 추가하는 커스텀 StaticFiles
class CachedStaticFiles(StaticFiles):
    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        # 응답 헤더에 캐시 추가
        async def send_wrapper(message):
            if message['type'] == 'http.response.start':
                headers = dict(message.get('headers', []))
                # JS, CSS 파일은 1년 캐시 (immutable)
                if scope['path'].endswith(('.js', '.css')):
                    headers[b'cache-control'] = b'public, max-age=31536000, immutable'
                # 기타 정적 파일은 1시간 캐시
                else:
                    headers[b'cache-control'] = b'public, max-age=3600'
                message['headers'] = list(headers.items())
            await send(message)

        await super().__call__(scope, receive, send_wrapper)


# Pydantic 모델
class ResizeRequest(BaseModel):
    """터미널 크기 조정 요청"""
    cols: int
    rows: int


class SessionCreateRequest(BaseModel):
    """세션 생성 요청"""
    cols: int = 80
    rows: int = 24
    cwd: Optional[str] = None


class SetupRequest(BaseModel):
    """초기 관리자 설정 요청"""
    username: str
    password: str


class LoginRequest(BaseModel):
    """로그인 요청"""
    username: str
    password: str


class FileWriteRequest(BaseModel):
    """파일 쓰기 요청"""
    path: str
    content: str


class FileCreateRequest(BaseModel):
    """파일/폴더 생성 요청"""
    path: str
    type: str  # "file" or "directory"


class FileMoveRequest(BaseModel):
    """파일/폴더 이동(이름 변경 포함) 요청"""
    source: str
    destination: str


class SessionNameRequest(BaseModel):
    """세션 이름 변경 요청"""
    name: str


# Workspace 루트 디렉토리 결정 로직
_current_file = os.path.abspath(__file__)
_project_root = os.path.dirname(os.path.dirname(_current_file))
_local_workspace = os.path.join(_project_root, "workspace")

# 기본값은 /app/workspace (Docker 환경 권장), 없으면 로컬 workspace 폴더 사용
WORKSPACE_ROOT = os.getenv("WORKSPACE_ROOT", "/app/workspace")

# 만약 기본값이 /app/workspace인데 존재하지 않고 로컬 디렉토리가 있다면 로컬 사용
if WORKSPACE_ROOT == "/app/workspace" and not os.path.exists(WORKSPACE_ROOT) and os.path.exists(_local_workspace):
    WORKSPACE_ROOT = _local_workspace
    logger.info(f"Using local WORKSPACE_ROOT: {WORKSPACE_ROOT}")

# 디렉토리 존재 보장
os.makedirs(WORKSPACE_ROOT, exist_ok=True)
logger.info(f"WORKSPACE_ROOT configured as: {WORKSPACE_ROOT}")

# 인증 매니저 인스턴스
auth_manager: Optional[AuthManager] = None

# 시스템 모니터링 (Linux 전용, 오버헤드 최소화)
class SystemMonitor:
    def __init__(self):
        self.last_cpu_time = 0
        self.last_idle_time = 0
        self.last_update = 0
        self.cached_cpu_percent = 0

    def get_stats(self):
        stats = {"cpu": 0, "ram": 0, "disk": 0}
        try:
            # RAM 정보 추출
            if os.path.exists('/proc/meminfo'):
                with open('/proc/meminfo', 'r') as f:
                    meminfo = f.readlines()
                    total = 0
                    available = 0
                    for line in meminfo:
                        if line.startswith('MemTotal:'):
                            total = int(line.split()[1])
                        if line.startswith('MemAvailable:'):
                            available = int(line.split()[1])
                    if total > 0:
                        stats["ram"] = round((total - available) / total * 100, 1)

            # Disk 정보 추출
            try:
                usage = os.statvfs(WORKSPACE_ROOT)
                d_total = usage.f_blocks * usage.f_frsize
                d_free = usage.f_bfree * usage.f_frsize
                if d_total > 0:
                    stats["disk"] = round((d_total - d_free) / d_total * 100, 1)
            except:
                pass

            # CPU 정보 추출 (이전 값과의 차이로 계산)
            now = time.time()
            if os.path.exists('/proc/stat') and now - self.last_update > 1.0:
                with open('/proc/stat', 'r') as f:
                    line = f.readline()
                    parts = line.split()
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
        except Exception as e:
            logger.error(f"Error reading system stats: {e}")
        return stats

system_monitor = SystemMonitor()


# 시작/종료 이벤트
@app.on_event("startup")
async def startup_event():
    """서버 시작 시 초기화"""
    global auth_manager
    logger.info("=== iTerminaLlist 서버 시작 ===")
    
    # 워크스페이스 디렉토리 존재 보장 및 로깅
    try:
        if not os.path.exists(WORKSPACE_ROOT):
            os.makedirs(WORKSPACE_ROOT, exist_ok=True)
            logger.info(f"Created missing WORKSPACE_ROOT: {WORKSPACE_ROOT}")
        else:
            logger.info(f"Using existing WORKSPACE_ROOT: {WORKSPACE_ROOT}")
            # 현재 워크스페이스 내 파일 목록 출력 (디버깅용)
            files = os.listdir(WORKSPACE_ROOT)
            logger.info(f"Files in workspace: {len(files)} items found")
    except Exception as e:
        logger.error(f"Failed to initialize WORKSPACE_ROOT: {e}")

    try:
        await storage.connect()
        logger.info("SQLite 스토리지 초기화 완료")

        # PTY 매니저에 스토리지 주입
        pty_manager.storage = storage

        # 인증 매니저 초기화
        auth_manager = AuthManager(storage)
        logger.info("인증 매니저 초기화 완료")
    except Exception as e:
        logger.error(f"스토리지 초기화 실패: {e}")
        raise


@app.on_event("shutdown")
async def shutdown_event():
    """서버 종료 시 정리"""
    logger.info("=== iTerminaLlist 서버 종료 ===")
    await storage.close()


# 인증 의존성
async def verify_auth_token(
    authorization: Optional[str] = Header(None),
    token: Optional[str] = Query(None)
) -> str:
    """JWT 토큰 검증 의존성 (헤더 또는 쿼리 파라미터 지원)"""
    actual_token = None
    
    if authorization and authorization.startswith("Bearer "):
        actual_token = authorization.replace("Bearer ", "")
    elif token:
        actual_token = token
        
    if not actual_token:
        raise HTTPException(status_code=401, detail="인증 토큰이 필요합니다")

    username = await auth_manager.verify_token(actual_token)

    if username is None:
        raise HTTPException(status_code=401, detail="유효하지 않은 토큰입니다")

    return username


async def verify_auth_token_ws(token: str) -> str:
    """WebSocket용 JWT 토큰 검증"""
    username = await auth_manager.verify_token(token)

    if username is None:
        raise HTTPException(status_code=401, detail="유효하지 않은 토큰입니다")

    return username


# 헬스 체크
@app.get("/api/health")
async def health_check():
    """헬스 체크 엔드포인트"""
    return {
        "service": "iTerminaLlist",
        "status": "running",
        "version": "1.0.0"
    }


# 인증 API
@app.get("/api/auth/status")
async def auth_status():
    """
    인증 상태 확인 (초기 설정 완료 여부)

    Returns:
        setup_complete: 초기 설정 완료 여부
    """
    if auth_manager is None:
        return {"setup_complete": False}

    is_complete = await auth_manager.is_setup_complete()
    return {"setup_complete": is_complete}


@app.post("/api/auth/setup")
async def setup_admin(request: SetupRequest):
    """
    초기 관리자 계정 설정

    Args:
        request: 관리자 계정 정보 (username, password)

    Returns:
        설정 결과
    """
    if auth_manager is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")

    # 이미 설정된 경우 거부
    if await auth_manager.is_setup_complete():
        raise HTTPException(status_code=400, detail="이미 초기 설정이 완료되었습니다")

    # 사용자명/비밀번호 검증
    if len(request.username) < 3:
        raise HTTPException(status_code=400, detail="사용자명은 3자 이상이어야 합니다")

    if len(request.password) < 8:
        raise HTTPException(status_code=400, detail="비밀번호는 8자 이상이어야 합니다")

    # 관리자 생성
    success = await auth_manager.create_admin(request.username, request.password)

    if not success:
        raise HTTPException(status_code=500, detail="관리자 계정 생성에 실패했습니다")

    logger.info(f"초기 관리자 계정 생성 완료: {request.username}")

    return {
        "success": True,
        "message": "관리자 계정이 생성되었습니다"
    }


@app.post("/api/auth/login")
async def login(request: LoginRequest):
    """
    로그인

    Args:
        request: 로그인 정보 (username, password)

    Returns:
        access_token: JWT 토큰
    """
    if auth_manager is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")

    # 초기 설정이 완료되지 않은 경우
    if not await auth_manager.is_setup_complete():
        raise HTTPException(status_code=400, detail="초기 설정을 먼저 완료해주세요")

    # 사용자 인증
    is_valid = await auth_manager.verify_admin(request.username, request.password)

    if not is_valid:
        logger.warning(f"로그인 실패: {request.username}")
        raise HTTPException(status_code=401, detail="사용자명 또는 비밀번호가 올바르지 않습니다")

    # JWT 토큰 생성
    access_token = await auth_manager.create_access_token(request.username)

    logger.info(f"로그인 성공: {request.username}")

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "username": request.username
    }


@app.get("/api/auth/verify")
async def verify_token(username: str = Depends(verify_auth_token)):
    """
    토큰 검증

    Returns:
        사용자 정보
    """
    return {
        "valid": True,
        "username": username
    }


@app.get("/api/system/stats")
async def get_system_stats(username: str = Depends(verify_auth_token)):
    """시스템 리소스 사용량 조회"""
    return system_monitor.get_stats()


@app.get("/api/files/raw")
async def get_raw_file(
    path: str = Query(...),
    username: str = Depends(verify_auth_token)
):
    """파일 원본 반환 (이미지, HTML 프리뷰용)"""
    try:
        safe_path = validate_path(path)
        if not safe_path.exists() or not safe_path.is_file():
            raise HTTPException(status_code=404, detail="File not found")
        
        return FileResponse(str(safe_path))
    except Exception as e:
        logger.error(f"Failed to serve raw file {path}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# WebSocket: 터미널 세션
@app.websocket("/ws/{session_id}")
async def terminal_websocket(
    websocket: WebSocket,
    session_id: str,
    token: Optional[str] = Query(None),
    cols: int = Query(80),
    rows: int = Query(24),
    cwd: Optional[str] = Query(None)
):
    """
    터미널 WebSocket 연결 핸들러

    프로토콜:
    - 클라이언트 → 서버: 사용자 입력 (텍스트)
    - 서버 → 클라이언트: 터미널 출력 (텍스트)
    """
    # 인증 확인 (optional)
    username = "admin"  # 기본 사용자
    if token:
        try:
            username = await verify_auth_token_ws(token)
        except:
            pass  # 토큰 실패해도 기본 사용자로 진행

    await websocket.accept()
    logger.info(f"WebSocket 연결 요청: {session_id} (사용자: {username}, cwd: {cwd})")

    try:
        # 1. 세션 복원 또는 생성 (DB에 저장)
        is_new_session = not pty_manager.session_exists(session_id)
        
        if is_new_session:
            logger.info(f"새 세션 생성: {session_id} (cols={cols}, rows={rows}, cwd={cwd})")
            await pty_manager.create_session(session_id, cols=cols, rows=rows, cwd=cwd)
            await storage.create_session(session_id, username, cwd=cwd)
        else:
            logger.info(f"기존 세션 복원: {session_id}")
            await storage.update_session_activity(session_id)

        # 2. SQLite 히스토리 전송 (재접속 시에만 이전 상태 복원)
        # 세션에 이미 연결된 소켓이 있다면 히스토리를 보내지 않음 (중복 출력 방지)
        session_info = pty_manager.sessions.get(session_id)
        is_already_connected = session_info and session_info.connected_socket is not None
        
        if not is_new_session and not is_already_connected:
            history = await storage.get_history(session_id)
            if history:
                logger.info(f"히스토리 복원: {session_id} ({len(history)} 청크)")
                full_history = "".join(history)
                await websocket.send_text(full_history)

        # 3. WebSocket을 세션에 연결
        await pty_manager.attach_session(session_id, websocket)

        # 4. 사용자 입력 수신 루프
        while True:
            # WebSocket에서 데이터 수신 (사용자 키 입력 또는 제어 메시지)
            data = await websocket.receive_text()

            # 제어 메시지(JSON)인지 일반 입력인지 확인 (공백 제거 후 더 견고하게 체크)
            is_control = False
            stripped_data = data.strip()
            if stripped_data.startswith('{') and stripped_data.endswith('}'):
                try:
                    msg = json.loads(stripped_data)
                    if isinstance(msg, dict) and msg.get('type') == 'resize':
                        is_control = True
                        cols = msg.get('cols', 80)
                        rows = msg.get('rows', 24)
                        logger.info(f"WebSocket을 통한 터미널 리사이즈: {session_id} ({cols}x{rows})")
                        await pty_manager.resize(session_id, cols, rows)
                except (json.JSONDecodeError, TypeError, ValueError):
                    pass

            if is_control:
                continue

            # PTY에 입력 전송
            await pty_manager.write_input(session_id, data)

    except WebSocketDisconnect:
        # 클라이언트 연결 종료 (프로세스는 유지)
        logger.info(f"WebSocket 연결 해제: {session_id} (세션 유지)")
        await pty_manager.detach_session(session_id)

    except Exception as e:
        logger.error(f"WebSocket 에러 ({session_id}): {e}")
        await pty_manager.detach_session(session_id)


# REST API: 세션 관리
@app.get("/api/sessions", response_model=List[dict])
async def list_sessions(username: str = Depends(verify_auth_token)):
    """
    사용자의 세션 목록 조회 (DB에서)

    Returns:
        세션 정보 리스트
    """
    sessions = await storage.get_user_sessions(username)
    return sessions


@app.post("/api/sessions/{session_id}")
async def create_session(
    session_id: str,
    request: SessionCreateRequest,
    username: str = Depends(verify_auth_token)
):
    """
    새 세션 명시적 생성 (DB에 저장)

    Args:
        session_id: 세션 ID
        request: 터미널 크기 및 시작 디렉토리 정보

    Returns:
        생성된 세션 정보
    """
    if pty_manager.session_exists(session_id):
        raise HTTPException(status_code=409, detail="세션이 이미 존재합니다")

    try:
        await pty_manager.create_session(
            session_id, 
            cols=request.cols, 
            rows=request.rows, 
            cwd=request.cwd
        )
        await storage.create_session(session_id, username, cwd=request.cwd)
        return {
            "session_id": session_id,
            "status": "created",
            "cols": request.cols,
            "rows": request.rows,
            "cwd": request.cwd
        }
    except Exception as e:
        logger.error(f"세션 생성 실패 ({session_id}): {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str, username: str = Depends(verify_auth_token)):
    """
    세션 강제 종료 및 삭제 (DB에서도 삭제)

    Args:
        session_id: 세션 ID

    Returns:
        삭제 결과
    """
    if not pty_manager.session_exists(session_id):
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")

    try:
        await pty_manager.kill_session(session_id)
        await storage.delete_session(session_id)
        return {
            "session_id": session_id,
            "status": "deleted"
        }
    except Exception as e:
        logger.error(f"세션 삭제 실패 ({session_id}): {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/sessions/{session_id}/resize")
async def resize_terminal(
    session_id: str,
    request: ResizeRequest,
    username: str = Depends(verify_auth_token)
):
    """
    터미널 크기 조정

    Args:
        session_id: 세션 ID
        request: 새 크기 (cols, rows)

    Returns:
        조정 결과
    """
    if not pty_manager.session_exists(session_id):
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")

    try:
        await pty_manager.resize(session_id, request.cols, request.rows)
        return {
            "session_id": session_id,
            "cols": request.cols,
            "rows": request.rows,
            "status": "resized"
        }
    except Exception as e:
        logger.error(f"크기 조정 실패 ({session_id}): {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/api/sessions/{session_id}/name")
async def update_session_name(
    session_id: str,
    request: SessionNameRequest,
    username: str = Depends(verify_auth_token)
):
    """
    세션 이름 변경

    Args:
        session_id: 세션 ID
        request: 새 이름

    Returns:
        업데이트 결과
    """
    try:
        await storage.update_session_name(session_id, request.name)
        return {
            "session_id": session_id,
            "name": request.name,
            "status": "updated"
        }
    except Exception as e:
        logger.error(f"세션 이름 변경 실패 ({session_id}): {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/sessions/{session_id}/history")
async def get_session_history(session_id: str, username: str = Depends(verify_auth_token)):
    """
    세션 히스토리 조회

    Args:
        session_id: 세션 ID

    Returns:
        히스토리 텍스트
    """
    history = await storage.get_history(session_id)
    return {
        "session_id": session_id,
        "history": "".join(history),
        "chunks": len(history)
    }


# 파일 시스템 헬퍼 함수
def validate_path(path: str) -> Path:
    """
    경로 검증 및 정규화
    """
    # 1. 경로가 None이거나 슬래시만 있는 경우 빈 문자열로 처리
    if not path or path == "/":
        path = ""
    
    # 2. 앞뒤 공백 및 선행 슬래시 제거 (루트 기준 상대 경로로 통일)
    path = path.strip().lstrip("/")

    # 3. WORKSPACE_ROOT 기준 절대 경로 생성
    workspace_abs = os.path.abspath(WORKSPACE_ROOT)
    
    # 만약 path가 비어있다면 바로 workspace_abs 반환
    if not path:
        return Path(workspace_abs)
        
    requested_abs = os.path.abspath(os.path.join(workspace_abs, path))

    # 4. workspace 외부 접근 차단 (보안)
    if not requested_abs.startswith(workspace_abs):
        logger.warning(f"Path traversal attempt blocked: {path} (Resolved: {requested_abs})")
        raise HTTPException(status_code=403, detail="Access denied")

    return Path(requested_abs)


# 파일 시스템 API
@app.get("/api/files/workspace")
async def get_workspace_info(username: str = Depends(verify_auth_token)):
    """현재 워크스페이스 정보 조회"""
    return {
        "root": os.path.abspath(WORKSPACE_ROOT),
        "name": os.path.basename(os.path.abspath(WORKSPACE_ROOT))
    }


@app.get("/api/files")
async def list_files(
    path: str = Query(""),
    username: str = Depends(verify_auth_token)
):
    """
    디렉토리 내용 조회
    """
    try:
        workspace_abs = os.path.abspath(WORKSPACE_ROOT)
        safe_path = validate_path(path)
        
        logger.info(f"--- Explorer API Call ---")
        logger.info(f"User: {username}")
        logger.info(f"WORKSPACE_ROOT: {workspace_abs}")
        logger.info(f"Requested Path: '{path}'")
        logger.info(f"Resolved Safe Path: {safe_path}")

        if not safe_path.exists():
            logger.error(f"Path does not exist: {safe_path}")
            raise HTTPException(status_code=404, detail=f"Path not found: {safe_path}")

        if not safe_path.is_dir():
            logger.error(f"Path is not a directory: {safe_path}")
            raise HTTPException(status_code=400, detail="Not a directory")

        items = []
        for item in safe_path.iterdir():
            try:
                item_abs = os.path.abspath(str(item))
                relative_path = os.path.relpath(item_abs, workspace_abs)
                
                items.append({
                    "name": item.name,
                    "path": relative_path.replace('\\', '/'),
                    "type": "directory" if item.is_dir() else "file",
                    "size": item.stat().st_size if item.is_file() else None,
                    "modified": item.stat().st_mtime
                })
            except Exception as e:
                logger.warning(f"Failed to read item {item}: {e}")
                continue

        items.sort(key=lambda x: (x["type"] == "file", x["name"].lower()))
        logger.info(f"Found {len(items)} items. First few: {[i['name'] for i in items[:3]]}")
        
        return {"items": items}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"CRITICAL ERROR in list_files: {str(e)}")
        return JSONResponse(
            status_code=500, 
            content={"detail": str(e), "workspace": WORKSPACE_ROOT, "requested": path}
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to list directory {path}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/files/read")
async def read_file(
    path: str = Query(...),
    username: str = Depends(verify_auth_token)
):
    """
    파일 내용 읽기

    Args:
        path: 파일 경로

    Returns:
        파일 내용
    """
    try:
        safe_path = validate_path(path)

        if not safe_path.exists():
            raise HTTPException(status_code=404, detail="File not found")

        if not safe_path.is_file():
            raise HTTPException(status_code=400, detail="Not a file")

        # 파일 크기 제한 (10MB)
        if safe_path.stat().st_size > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="File too large (max 10MB)")

        try:
            content = safe_path.read_text(encoding='utf-8')
            return {"content": content, "path": path}
        except UnicodeDecodeError:
            raise HTTPException(status_code=400, detail="Binary file not supported")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to read file {path}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/files/write")
async def write_file(
    request: FileWriteRequest,
    username: str = Depends(verify_auth_token)
):
    """
    파일 쓰기

    Args:
        request: 파일 경로 및 내용

    Returns:
        작업 결과
    """
    try:
        safe_path = validate_path(request.path)

        # 부모 디렉토리가 없으면 생성
        safe_path.parent.mkdir(parents=True, exist_ok=True)

        safe_path.write_text(request.content, encoding='utf-8')

        logger.info(f"File written: {request.path} by {username}")
        return {"status": "written", "path": request.path}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to write file {request.path}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/files/move")
async def move_file(
    request: FileMoveRequest,
    username: str = Depends(verify_auth_token)
):
    """
    파일/폴더 이동 또는 이름 변경

    Args:
        request: 소스 및 대상 경로

    Returns:
        작업 결과
    """
    try:
        source_path = validate_path(request.source)
        destination_path = validate_path(request.destination)

        if not source_path.exists():
            raise HTTPException(status_code=404, detail="Source not found")

        if destination_path.exists():
            raise HTTPException(status_code=409, detail="Destination already exists")

        # 대상 상위 디렉토리가 없으면 생성
        destination_path.parent.mkdir(parents=True, exist_ok=True)

        shutil.move(str(source_path), str(destination_path))

        logger.info(f"Moved: {request.source} -> {request.destination} by {username}")
        return {"status": "moved", "source": request.source, "destination": request.destination}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to move {request.source} to {request.destination}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/files/create")
async def create_file(
    request: FileCreateRequest,
    username: str = Depends(verify_auth_token)
):
    """
    파일/폴더 생성

    Args:
        request: 경로 및 타입

    Returns:
        작업 결과
    """
    try:
        safe_path = validate_path(request.path)

        if safe_path.exists():
            raise HTTPException(status_code=409, detail="Already exists")

        if request.type == "directory":
            safe_path.mkdir(parents=True, exist_ok=True)
        elif request.type == "file":
            safe_path.parent.mkdir(parents=True, exist_ok=True)
            safe_path.touch()
        else:
            raise HTTPException(status_code=400, detail="Invalid type (must be 'file' or 'directory')")

        logger.info(f"{request.type.capitalize()} created: {request.path} by {username}")
        return {"status": "created", "path": request.path, "type": request.type}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create {request.type} {request.path}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/files")
async def delete_file(
    path: str = Query(...),
    username: str = Depends(verify_auth_token)
):
    """
    파일/폴더 삭제

    Args:
        path: 경로

    Returns:
        작업 결과
    """
    try:
        safe_path = validate_path(path)

        if not safe_path.exists():
            raise HTTPException(status_code=404, detail="Not found")

        if safe_path.is_dir():
            shutil.rmtree(safe_path)
        else:
            safe_path.unlink()

        logger.info(f"Deleted: {path} by {username}")
        return {"status": "deleted", "path": path}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete {path}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 에러 핸들러
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """전역 예외 핸들러"""
    logger.error(f"Unhandled exception: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"}
    )


# Static files for frontend (프로덕션 배포용)
# 정적 파일이 존재하는 경우에만 마운트
STATIC_DIR = Path(__file__).parent / "static"
if STATIC_DIR.exists():
    app.mount("/assets", CachedStaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")

    @app.get("/")
    async def serve_frontend():
        """프론트엔드 index.html 서빙"""
        return FileResponse(str(STATIC_DIR / "index.html"))

    @app.get("/{full_path:path}")
    async def catch_all(full_path: str):
        """SPA fallback - 모든 경로를 index.html로"""
        # API 경로는 제외
        if full_path.startswith("api/") or full_path.startswith("ws/"):
            raise HTTPException(status_code=404, detail="Not found")

        # 파일이 존재하면 반환
        file_path = STATIC_DIR / full_path
        if file_path.is_file():
            return FileResponse(str(file_path))

        # 그 외는 index.html 반환 (SPA routing)
        return FileResponse(str(STATIC_DIR / "index.html"))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )

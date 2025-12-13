#!/usr/bin/env python3
"""
iTerminaLlist 단독 실행 스크립트
Docker 없이 백엔드 + 프론트엔드 동시 실행
Ctrl+C로 종료
"""
import subprocess
import signal
import sys
import os
import time
from pathlib import Path

# 색상 코드
class Colors:
    PURPLE = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    END = '\033[0m'
    BOLD = '\033[1m'

def print_header():
    """시작 배너 출력"""
    print(f"""
{Colors.PURPLE}{Colors.BOLD}
╔═══════════════════════════════════════════════════╗
║                                                   ║
║              iTerminaLlist v1.0                   ║
║         Standalone Development Server             ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
{Colors.END}
""")

def print_info(msg):
    """정보 메시지"""
    print(f"{Colors.CYAN}[INFO]{Colors.END} {msg}")

def print_success(msg):
    """성공 메시지"""
    print(f"{Colors.GREEN}[SUCCESS]{Colors.END} {msg}")

def print_error(msg):
    """에러 메시지"""
    print(f"{Colors.RED}[ERROR]{Colors.END} {msg}")

def print_warning(msg):
    """경고 메시지"""
    print(f"{Colors.YELLOW}[WARNING]{Colors.END} {msg}")

# 프로세스 저장
processes = []

def signal_handler(sig, frame):
    """Ctrl+C 핸들러"""
    print(f"\n\n{Colors.YELLOW}[SHUTDOWN]{Colors.END} Ctrl+C 감지, 서버 종료 중...")

    for proc_info in processes:
        print_info(f"{proc_info['name']} 종료 중...")
        proc_info['process'].terminate()

    # 프로세스 종료 대기
    time.sleep(2)

    for proc_info in processes:
        if proc_info['process'].poll() is None:
            print_warning(f"{proc_info['name']} 강제 종료")
            proc_info['process'].kill()

    print_success("모든 서버가 종료되었습니다")
    sys.exit(0)

def check_dependencies():
    """의존성 확인"""
    print_info("의존성 확인 중...")

    # Python 버전 확인
    py_version = sys.version_info
    if py_version < (3, 8):
        print_error(f"Python 3.8 이상이 필요합니다 (현재: {py_version.major}.{py_version.minor})")
        sys.exit(1)
    print_success(f"Python {py_version.major}.{py_version.minor}.{py_version.micro}")

    # Node.js 확인
    try:
        result = subprocess.run(['node', '--version'], capture_output=True, text=True)
        if result.returncode == 0:
            print_success(f"Node.js {result.stdout.strip()}")
        else:
            print_error("Node.js를 찾을 수 없습니다")
            sys.exit(1)
    except FileNotFoundError:
        print_error("Node.js를 찾을 수 없습니다. 설치 필요: https://nodejs.org")
        sys.exit(1)

def install_backend_dependencies():
    """백엔드 의존성 설치"""
    print_info("백엔드 의존성 확인 중...")
    backend_dir = Path(__file__).parent / "backend"

    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "-q", "-r", "requirements.txt"],
            cwd=backend_dir,
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            print_success("백엔드 의존성 설치 완료")
        else:
            print_error(f"백엔드 의존성 설치 실패:\n{result.stderr}")
            sys.exit(1)
    except Exception as e:
        print_error(f"백엔드 의존성 설치 중 오류: {e}")
        sys.exit(1)

def install_frontend_dependencies():
    """프론트엔드 의존성 설치"""
    print_info("프론트엔드 의존성 확인 중...")
    frontend_dir = Path(__file__).parent / "frontend"

    # node_modules가 없으면 설치
    if not (frontend_dir / "node_modules").exists():
        print_info("node_modules가 없습니다. npm install 실행 중...")
        try:
            result = subprocess.run(
                ["npm", "install"],
                cwd=frontend_dir,
                capture_output=True,
                text=True
            )
            if result.returncode == 0:
                print_success("프론트엔드 의존성 설치 완료")
            else:
                print_error(f"프론트엔드 의존성 설치 실패:\n{result.stderr}")
                sys.exit(1)
        except Exception as e:
            print_error(f"프론트엔드 의존성 설치 중 오류: {e}")
            sys.exit(1)
    else:
        print_success("프론트엔드 의존성이 이미 설치되어 있습니다")

def start_backend():
    """백엔드 서버 시작"""
    print_info("백엔드 서버 시작 중...")
    backend_dir = Path(__file__).parent / "backend"

    # 데이터 디렉토리 생성
    data_dir = Path(__file__).parent / "data"
    data_dir.mkdir(exist_ok=True)

    # 환경 변수 설정
    env = os.environ.copy()
    env['PYTHONUNBUFFERED'] = '1'

    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"],
        cwd=backend_dir,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1
    )

    processes.append({
        'name': 'Backend',
        'process': proc
    })

    print_success("백엔드 서버 시작됨 (http://localhost:8000)")
    return proc

def start_frontend():
    """프론트엔드 서버 시작"""
    print_info("프론트엔드 서버 시작 중...")
    frontend_dir = Path(__file__).parent / "frontend"

    # 환경 변수 설정
    env = os.environ.copy()

    proc = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=frontend_dir,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1
    )

    processes.append({
        'name': 'Frontend',
        'process': proc
    })

    print_success("프론트엔드 서버 시작됨 (http://localhost:23232)")
    return proc

def main():
    """메인 실행 함수"""
    print_header()

    # Ctrl+C 핸들러 등록
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # 의존성 확인
    check_dependencies()

    # 의존성 설치
    install_backend_dependencies()
    install_frontend_dependencies()

    print(f"\n{Colors.BOLD}서버 시작 중...{Colors.END}\n")

    # 백엔드 시작
    backend_proc = start_backend()
    time.sleep(2)  # 백엔드가 먼저 시작되도록 대기

    # 프론트엔드 시작
    frontend_proc = start_frontend()
    time.sleep(2)

    print(f"""
{Colors.GREEN}{Colors.BOLD}
╔═══════════════════════════════════════════════════╗
║              🚀 서버가 시작되었습니다!                ║
╠═══════════════════════════════════════════════════╣
║                                                   ║
║  Frontend:  http://localhost:23232               ║
║  Backend:   http://localhost:8000                 ║
║  Database:  ./data/iterminallist.db               ║
║                                                   ║
║  Ctrl+C를 눌러 종료하세요                            ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
{Colors.END}
""")

    # 프로세스 모니터링
    try:
        while True:
            # 프로세스 상태 확인
            for proc_info in processes:
                if proc_info['process'].poll() is not None:
                    print_error(f"{proc_info['name']} 서버가 예기치 않게 종료되었습니다")
                    signal_handler(signal.SIGTERM, None)

            time.sleep(1)

    except KeyboardInterrupt:
        signal_handler(signal.SIGINT, None)

if __name__ == "__main__":
    main()

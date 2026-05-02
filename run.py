#!/usr/bin/env python3
"""
iTerminaLlist 호스트 실행 스크립트

백엔드 (FastAPI/uvicorn) + 프론트엔드 (Vite dev server) 동시 기동.
Ctrl+C 한 번으로 둘 다 종료.

사용법:
    python run.py              # 둘 다 기동
    python run.py --backend    # 백엔드만
    python run.py --frontend   # 프론트엔드만
"""
import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
BACKEND_DIR = PROJECT_ROOT / "backend"
FRONTEND_DIR = PROJECT_ROOT / "frontend"
VENV_PYTHON = PROJECT_ROOT / ".venv" / "bin" / "python"


def _python_bin() -> str:
    """프로젝트 venv가 있으면 그걸로, 없으면 현재 인터프리터로."""
    return str(VENV_PYTHON) if VENV_PYTHON.exists() else sys.executable


def start_backend() -> subprocess.Popen:
    print(f"[backend] starting uvicorn (cwd={BACKEND_DIR})")
    return subprocess.Popen(
        [_python_bin(), "main.py"],
        cwd=str(BACKEND_DIR),
        env={**os.environ},
    )


def start_frontend() -> subprocess.Popen:
    if not (FRONTEND_DIR / "node_modules").exists():
        print("[frontend] node_modules 없음 — npm install 먼저 수행")
        subprocess.run(["npm", "install"], cwd=str(FRONTEND_DIR), check=True)
    print(f"[frontend] starting vite dev server (cwd={FRONTEND_DIR})")
    return subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=str(FRONTEND_DIR),
        env={**os.environ},
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", action="store_true", help="백엔드만 실행")
    parser.add_argument("--frontend", action="store_true", help="프론트엔드만 실행")
    args = parser.parse_args()

    run_backend = not args.frontend or args.backend
    run_frontend = not args.backend or args.frontend

    procs: list[subprocess.Popen] = []
    try:
        if run_backend:
            procs.append(start_backend())
            time.sleep(0.5)
        if run_frontend:
            procs.append(start_frontend())

        def shutdown(_sig=None, _frame=None):
            print("\n[shutdown] 자식 프로세스 종료 중...")
            for p in procs:
                if p.poll() is None:
                    p.terminate()
            for p in procs:
                try:
                    p.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    p.kill()
            sys.exit(0)

        signal.signal(signal.SIGINT, shutdown)
        signal.signal(signal.SIGTERM, shutdown)

        # 자식이 죽으면 같이 종료
        while True:
            for p in procs:
                if p.poll() is not None:
                    print(f"[exit] 자식 프로세스 종료 (rc={p.returncode}) — 전체 종료")
                    shutdown()
            time.sleep(1)
    except KeyboardInterrupt:
        for p in procs:
            if p.poll() is None:
                p.terminate()


if __name__ == "__main__":
    main()

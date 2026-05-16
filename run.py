#!/usr/bin/env python3
"""
Terminal List 호스트 실행 스크립트 (개발용 supervisor)

백엔드 (FastAPI/uvicorn) + 프론트엔드 (Vite dev server) 동시 기동.
자식이 죽으면 자동 재시작 (지수 백오프, 짧은 시간 안에 반복 실패하면 포기).
Ctrl+C / SIGTERM 한 번으로 둘 다 깨끗하게 종료.

운영 환경에서는 deploy/iterminallist.service 를 systemd 에 등록해 사용한다.
이 스크립트는 frontend dev server 까지 함께 띄우는 개발용 래퍼.

사용법:
    python run.py              # 둘 다 기동
    python run.py --backend    # 백엔드만
    python run.py --frontend   # 프론트엔드만
    python run.py --no-restart # 자동 재시작 끄기 (디버깅 시)
"""
import argparse
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
BACKEND_DIR = PROJECT_ROOT / "backend"
FRONTEND_DIR = PROJECT_ROOT / "frontend"
VENV_PYTHON = PROJECT_ROOT / ".venv" / "bin" / "python"

BACKEND_PORT = int(os.getenv("APP_PORT", "38822"))
FRONTEND_PORT = int(os.getenv("FRONTEND_PORT", "5173"))

RESTART_BACKOFF_S = (1, 2, 5, 10, 30)
RESTART_FAILURE_WINDOW_S = 60
RESTART_FAILURE_LIMIT = 5


def _resolve_python_bin() -> str:
    """venv 우선. 없으면 시스템 python 으로 폴백하되 경고."""
    if VENV_PYTHON.exists():
        return str(VENV_PYTHON)
    print(
        f"[warn] venv 없음 ({VENV_PYTHON}). 시스템 python 사용 → 의존성 누락 시 즉시 종료됩니다.\n"
        f"       권장: python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt",
        file=sys.stderr,
    )
    return sys.executable


def _is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.2)
        return s.connect_ex(("127.0.0.1", port)) == 0


class Child:
    """단일 자식 프로세스를 감시하면서 죽으면 재시작."""

    def __init__(self, name: str, cmd: list[str], cwd: Path, *, restart: bool):
        self.name = name
        self.cmd = cmd
        self.cwd = cwd
        self.restart = restart
        self.proc: subprocess.Popen | None = None
        self._failures: list[float] = []

    def start(self) -> None:
        print(f"[{self.name}] starting (cwd={self.cwd}) → {' '.join(self.cmd)}")
        self.proc = subprocess.Popen(
            self.cmd,
            cwd=str(self.cwd),
            env={**os.environ},
        )

    def is_running(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def returncode(self) -> int | None:
        return self.proc.returncode if self.proc else None

    def terminate(self) -> None:
        if self.is_running():
            assert self.proc is not None
            self.proc.terminate()

    def wait(self, timeout: float) -> None:
        if self.proc is None:
            return
        try:
            self.proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            self.proc.kill()

    def maybe_restart(self) -> bool:
        """반환 True = 재시작했음, False = 포기/재시작 안 함."""
        if not self.restart:
            return False
        now = time.time()
        self._failures = [t for t in self._failures if now - t < RESTART_FAILURE_WINDOW_S]
        self._failures.append(now)
        if len(self._failures) > RESTART_FAILURE_LIMIT:
            print(
                f"[{self.name}] {RESTART_FAILURE_WINDOW_S}s 안에 {len(self._failures)}회 실패 — 재시작 포기",
                file=sys.stderr,
            )
            return False
        delay = RESTART_BACKOFF_S[min(len(self._failures) - 1, len(RESTART_BACKOFF_S) - 1)]
        print(f"[{self.name}] rc={self.returncode()} → {delay}s 후 재시작 (#{len(self._failures)})")
        time.sleep(delay)
        self.start()
        return True


def _build_backend_child(restart: bool) -> Child:
    if _is_port_in_use(BACKEND_PORT):
        print(
            f"[backend] 포트 {BACKEND_PORT} 이미 사용 중 — 다른 인스턴스가 떠있는지 확인하세요.\n"
            f"          ss -tlnp | grep :{BACKEND_PORT}",
            file=sys.stderr,
        )
        sys.exit(2)
    return Child("backend", [_resolve_python_bin(), "main.py"], BACKEND_DIR, restart=restart)


def _build_frontend_child(restart: bool) -> Child:
    if not (FRONTEND_DIR / "node_modules").exists():
        print("[frontend] node_modules 없음 — npm install 먼저 수행")
        subprocess.run(["npm", "install"], cwd=str(FRONTEND_DIR), check=True)
    if _is_port_in_use(FRONTEND_PORT):
        print(f"[frontend] 포트 {FRONTEND_PORT} 이미 사용 중 — vite 가 이미 떠있을 수 있음", file=sys.stderr)
        sys.exit(2)
    return Child("frontend", ["npm", "run", "dev"], FRONTEND_DIR, restart=restart)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", action="store_true", help="백엔드만 실행")
    parser.add_argument("--frontend", action="store_true", help="프론트엔드만 실행")
    parser.add_argument("--no-restart", action="store_true", help="자식 죽어도 재시작하지 않음")
    args = parser.parse_args()

    run_backend = not args.frontend or args.backend
    run_frontend = not args.backend or args.frontend
    restart = not args.no_restart

    children: list[Child] = []
    if run_backend:
        children.append(_build_backend_child(restart))
    if run_frontend:
        children.append(_build_frontend_child(restart))

    for c in children:
        c.start()
        time.sleep(0.3)

    shutting_down = {"flag": False}

    def shutdown(_sig=None, _frame=None):
        if shutting_down["flag"]:
            return
        shutting_down["flag"] = True
        print("\n[shutdown] 자식 프로세스 종료 중...")
        for c in children:
            c.terminate()
        for c in children:
            c.wait(timeout=5)
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        while True:
            for c in children:
                if not c.is_running():
                    if not c.maybe_restart():
                        print(f"[exit] {c.name} 종료 (rc={c.returncode()}) — 전체 종료")
                        shutdown()
            time.sleep(1)
    except KeyboardInterrupt:
        shutdown()


if __name__ == "__main__":
    main()

# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Terminal List — single-image deployment.
#
# Stage 1: Node 로 frontend 빌드 → /build/backend/static 출력 (vite outDir 이 ../backend/static).
# Stage 2: Python 런타임 + tmux + openssh-client + tini + backend + Stage 1 결과.
#
# "이 머신" 로컬 터미널 = 컨테이너 내부 셸 (샌드박스). /workspace 볼륨으로 작업물 영속.
# 실 호스트는 SSH 호스트로 등록 (Tailscale auth_method 도 지원).
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: frontend build ──────────────────────────────────────────────────
FROM node:22-alpine AS frontend-build
WORKDIR /build/frontend

# 의존성만 먼저 — package.json 변경 없으면 캐시 hit
COPY frontend/package.json frontend/package-lock.json* ./
# package-lock 없는 환경은 npm install 로 폴백
RUN if [ -f package-lock.json ]; then npm ci --prefer-offline --no-audit --no-fund; \
    else npm install --no-audit --no-fund; fi

COPY frontend/ ./
# vite outDir = ../backend/static → /build/backend/static
RUN npm run build


# ── Stage 2: python runtime ──────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

# tmux: 필수. openssh-client: SSH 호스트. tini: PID 1 시그널/좀비 처리.
# bcrypt/cryptography 휠 빌드용 build deps 는 설치 후 purge.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential gcc libffi-dev libssl-dev \
        tmux bash openssh-client sqlite3 ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt \
    && apt-get purge -y --auto-remove build-essential gcc libffi-dev libssl-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/ ./backend/
COPY run.py ./run.py

# `itl` 을 PATH 에 올린다 — pane 안의 에이전트가 형제 터미널을 부를 때 쓰는 이름이고,
# 복사되는 pane 핸들도 이 이름으로 찍힌다(server_identity._itl_cmd 가 PATH 를 본다).
# 절대경로로도 돌지만, 컨테이너마다 다른 긴 경로가 핸들에 실리는 것보다 낫다.
RUN chmod +x backend/cli/itl backend/cli/itl-mcp \
    && ln -sf /app/backend/cli/itl /usr/local/bin/itl \
    && ln -sf /app/backend/cli/itl-mcp /usr/local/bin/itl-mcp

# Stage 1 결과
COPY --from=frontend-build /build/backend/static ./backend/static/

# 영속 볼륨 — data: SQLite + vault, workspace: 사용자 작업물
# 런타임은 non-root 로 실행해 터미널/파일 기능 침해 시 컨테이너 권한 범위를 줄인다.
RUN useradd --create-home --uid 1000 --shell /bin/bash appuser \
    && mkdir -p /app/data /workspace \
    && chown -R appuser:appuser /app/data /workspace /app/backend
VOLUME ["/app/data", "/workspace"]

# 기본 env — docker-compose 가 덮어쓸 수 있음. REDIS_URL 은 compose 가 주입.
ENV HOST=0.0.0.0 \
    APP_PORT=38822 \
    DB_PATH=/app/data/iterminallist.db \
    WORKSPACE_ROOT=/workspace \
    RELOAD=false \
    TMUX_SOCKET_NAME=iterminallist-app \
    TMUX_HISTORY_LIMIT=100000 \
    LOG_LEVEL=INFO \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 38822
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:38822/api/health || exit 1

# tini 가 PID 1 → uvicorn 종료 시그널 정상 전파, tmux 좀비 청소.
ENTRYPOINT ["/usr/bin/tini", "--"]
WORKDIR /app/backend
USER appuser
CMD ["python", "main.py"]

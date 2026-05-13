# ── Stage 1: Frontend build ──────────────────────────────────────────
FROM node:20-slim AS frontend-build

WORKDIR /build/frontend

# Copy source and install deps + build
COPY frontend/ ./
RUN npm install && npm run build
# Output lands at /build/backend/static (vite.config.js outDir is ../backend/static)
# We'll reference it from the next stage via the absolute path.

# ── Stage 2: Python runtime ─────────────────────────────────────────
FROM python:3.12-slim AS runtime

# OS deps: tmux + shell utils + SSH client + sqlite3 + ca-certs.
# Also install build-essential & dev libs temporarily for pip wheels
# that may need compilation (bcrypt, cryptography), then remove them.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential gcc libffi-dev libssl-dev \
        tmux bash openssh-client sqlite3 ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt \
    && apt-get purge -y --auto-remove build-essential gcc libffi-dev libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Backend source
COPY backend/ ./backend/

# Built frontend assets (vite outputs to ../backend/static relative to frontend/)
COPY --from=frontend-build /build/backend/static ./backend/static/

# Persistent data & user workspace directories
RUN mkdir -p /app/data /workspace

# Defaults (can be overridden via env / compose)
ENV HOST=0.0.0.0 \
    APP_PORT=38822 \
    DB_PATH=/app/data/iterminallist.db \
    WORKSPACE_ROOT=/workspace \
    RELOAD=false \
    TMUX_SOCKET_NAME=iterminallist-app

EXPOSE 38822

WORKDIR /app/backend
CMD ["python", "main.py"]

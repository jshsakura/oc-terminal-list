# Terminal List — CLAUDE.md

Web-based multi-pane terminal manager. React (Vite) frontend + FastAPI backend. Two deployment modes:

- **Container** (recommended): `docker compose up -d`. Bundles app + Redis. Sandbox shell inside container; real host accessed as an SSH host (auto-registered if `secrets/ssh-key` is mounted).
- **Host systemd** (legacy): runs on the host directly with `KillMode=process` so tmux sessions survive backend restarts. Used during development on the maintainer's machine.

## Project layout

```
backend/        FastAPI app (main.py entry), Python, uvicorn
frontend/src/   React + xterm.js UI (Vite, JSX)
frontend/src/components/   UI components
frontend/src/hooks/        Custom React hooks
deploy/         systemd unit file + local-deploy.sh (host install)
Dockerfile, compose.yml          container deployment (single image from GHCR)
secrets/        SSH key for bootstrap host (gitignored; .gitkeep only)
data/           SQLite DB + vault key (not committed)
workspace/      User file workspace (not committed)
```

## Deploy (container — recommended)

```bash
# (one-time) drop your private key for the host you want to attach
cp ~/.ssh/id_ed25519 secrets/ssh-key && chmod 600 secrets/ssh-key

docker compose up -d
open http://localhost:38822
```

Bundle contents:
- `app` — backend + frontend (built into `backend/static` at image build time)
- `redis` — `redis:alpine` with AOF persistence, only reachable from `app` over the compose network

Volumes:
- `./data:/app/data` (bind) — SQLite DB + vault key, lives in repo's `data/`
- `./workspace:/workspace` (bind) — sandbox shell work files
- `oc-terminal-list-redis-data:/data` (named) — Redis AOF (separate UID, so named)
- `./secrets:/app/secrets:ro` (bind) — read-only SSH key for bootstrap host

CI: `.github/workflows/ghcr-publish.yml` pushes `ghcr.io/jshsakura/oc-terminal-list:latest` on every `main` push.

Host auto-register (see `backend/bootstrap.py`):
- Trigger: presence of `secrets/ssh-key` at startup
- Defaults: `host.docker.internal:22`, user `ubuntu`, auth=key, remote tmux ON
- `BOOTSTRAP_HOST_*` env vars override defaults if needed
- If host has no tmux installed, the host is still registered (use_remote_tmux=0); user SSHes in, installs tmux, flips toggle in host settings to gain persistent sessions
- Idempotent — same-name host not re-created on subsequent boots

## Deploy (host systemd — legacy / dev box)

**Standard update flow — always use this:**

```bash
git pull
./deploy/local-deploy.sh
```

`--auto` is the default: builds frontend, restarts the systemd service only if backend/deploy files changed.

Other modes when needed:

```bash
./deploy/local-deploy.sh --frontend-only  # frontend code changed only, no restart
./deploy/local-deploy.sh --restart        # force restart (backend code changed)
./deploy/local-deploy.sh --status         # check service status
```

**Never run `systemctl restart` directly** — always go through `local-deploy.sh` so the frontend is rebuilt first.

Service name: `iterminallist` (defined in `deploy/iterminallist.service`).

Logs: `journalctl -u iterminallist.service -f`

## Dev mode (no systemd)

```bash
sudo systemctl stop iterminallist.service
python run.py        # starts backend (reload=true) + vite dev server together
```

When done: `sudo systemctl start iterminallist.service`

## Key env vars (.env)

| Var | Default | Purpose |
|-----|---------|---------|
| `APP_PORT` | `38822` | HTTP listen port |
| `WORKSPACE_ROOT` | see .env | Root path for file tree/terminal |
| `DB_PATH` | see .env | SQLite database path |
| `TMUX_SOCKET_NAME` | `iterminallist-app` | Isolated tmux socket |
| `REDIS_URL` | _(empty)_ | If set, `backend/cache.py` uses Redis; empty falls back to in-memory. This server runs `iterminallist-redis` (Docker, `redis:alpine`, 127.0.0.1:6379). |

Do not put JWT or vault keys in `.env` — they are auto-managed.

## Architecture rules (do not break)

- **No LLM API calls from the backend.** The backend routes terminal stdin/stdout only. Vendor-neutral.
- **Agent features are opt-in.** Default UX is a generic terminal; agent layer sits on top.
- Backend talks to xterm.js frontend via WebSocket (`ws_bridge.py`).
- tmux sessions survive backend restarts (`KillMode=process` in the service unit).

## Settings persistence

User settings flow: `updateSetting()` → localStorage immediately → debounced PUT `/api/user/settings` (600 ms) → server (SQLite). On auth, GET `/api/user/settings` merges server values over localStorage cache.

Terminal picks up changed settings (theme/fontSize/fontFamily/smoothScroll) immediately via `useEffect` in `Terminal.jsx` without restart.

## Full ops guide

`deploy/README.md` — backup, JWT rotation, vault key, 2FA, troubleshooting.

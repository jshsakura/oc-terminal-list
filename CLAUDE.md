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

Two variants. Bridge network is the default; host network is the alternative for when you want the container to share the host's network namespace directly (no docker-proxy, sees Tailscale/private IPs as the host does).

```bash
# Bridge network (default — isolated, with bundled Redis):
docker compose up -d

# Host network (no port mapping, no docker-proxy, no bundled Redis):
docker compose -f compose.host.yml up -d

open http://localhost:38822
```

Register your SSH hosts through the UI ("Hosts" → add) — the standard path.

Bundle contents:
- `app` — backend + frontend (built into `backend/static` at image build time)
- `redis` — `redis:alpine` with AOF persistence, only reachable from `app` over the compose network

Volumes:
- `./data:/app/data` (bind) — SQLite DB + vault key, lives in repo's `data/`
- `./workspace:/workspace` (bind) — sandbox shell work files
- `oc-terminal-list-redis-data:/data` (named) — Redis AOF (separate UID, so named)

CI: `.github/workflows/ghcr-publish.yml` pushes `ghcr.io/jshsakura/oc-terminal-list:latest` on every `main` push.

Host auto-register (off by default, opt-in — see `backend/bootstrap.py`):
- Default: disabled. The standard path is registering hosts through the UI.
- Enable: set `BOOTSTRAP_HOST_ENABLE=1` and mount `./secrets:/app/secrets:ro` with `secrets/ssh-key`.
- Defaults when enabled: `host.docker.internal:22`, user `ubuntu`, auth=key, remote tmux ON.
- `BOOTSTRAP_HOST_*` env vars override defaults if needed.
- Idempotent — same-name host not re-created on subsequent boots.
- Caveat: re-running on every container restart can fight with tab-state restore (a renamed/deleted bootstrap host can be re-created with the default name), so prefer manual UI registration unless you understand the trade-off.

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
| `AUTH_COOKIE_SECURE` | `auto` | Auth cookie `Secure` flag. `auto` = detect from request scheme; `1` = force Secure (set this when behind an HTTPS-terminating reverse proxy); `0` = force off. Plain-http host deploys must stay `auto`/`0` or login breaks. |
| `TRUST_PROXY_HEADERS` | `0` | Trust `X-Forwarded-*` (host/proto) — only enable behind a trusted proxy; affects cookie Secure detection and WebAuthn RP-ID. |

Do not put JWT or vault keys in `.env` — they are auto-managed.

## Notable backend endpoints (added 2026-07)

- `POST /api/terminal/paste-file` — upload any file (right-click "Send file"), stored under `WORKSPACE_ROOT/.pasted/`, returns its path (image-only sibling: `/api/terminal/paste-image`).
- `GET /api/files/grep?q=` — ripgrep workspace content search (file explorer content-search toggle).
- Session REST endpoints (`/api/sessions/{id}/...`) enforce ownership via `_assert_session_owner` (same check as the WS route).

## Tab/session close model (as of 2026-07)

Closing a tab **terminates all its inner sessions** (no detach/keep-alive). `closeTab` always runs `closeAndTerminate`; there is no separate "kill session" menu item. Network-drop reconnection is unrelated resilience and still auto-recovers. See memory `project_close_session_model`.

## Reload vs Restart (pane `…` menu)

Two different things — don't conflate them:

- **Reload terminal** (`onRefreshTerminal`) — bumps `refreshNonce`, remounting xterm. It re-attaches to the **same live tmux session**, so the shell, its PATH/hash, and its processes are untouched.
- **Restart session** (`onRestartSession` → `utils/restartSession.js`) — **kills the tmux session** and reopens a fresh shell at the same cwd. Use when a just-installed binary isn't on PATH yet. Everything running inside dies, so it goes through a confirm dialog.

Restart only *kills*; recreation is done by the reconnect (the WS route creates the session when it's missing, using the `cwd` query as the start dir). **So the kill must complete before the remount** — reversed, you re-attach to the still-living session and nothing happens.

`cwd` format differs by pane type: **local = workspace-relative** (`validate_path()` strips a leading `/` and joins it onto the workspace, so an absolute path lands somewhere wrong), **remote = absolute** on the remote box.

## Service worker cache version

`frontend/public/sw.js` keeps `CACHE_VERSION = "dev"` as a placeholder. The `stampServiceWorker` plugin in `vite.config.js` overwrites it at build time with a hash of the `assets/` filenames.

Never hand-manage it. If `sw.js`'s bytes don't change on deploy, the browser never detects a service-worker update, `activate` never re-runs, and the old cache lives forever — holding hashed chunks that the next build deletes (`emptyOutDir: true`). The page then self-reloads via `LazyErrorBoundary` when a lazy chunk 404s.

The plugin must run **before** `precompressAssets`, or only the `.br`/`.gz` copies keep the stale bytes.

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

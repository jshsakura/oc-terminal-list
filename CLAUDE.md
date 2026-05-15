# iTerminaLlist — CLAUDE.md

Web-based multi-pane terminal manager. React (Vite) frontend + FastAPI backend. Runs on the host machine as a systemd service (not Docker) so it has direct access to the host shell, tmux, and workspace.

## Project layout

```
backend/        FastAPI app (main.py entry), Python, uvicorn
frontend/src/   React + xterm.js UI (Vite, JSX)
frontend/src/components/   UI components (49 files)
frontend/src/hooks/        Custom React hooks
deploy/         systemd unit file + local-deploy.sh
data/           SQLite DB + vault key (not committed)
workspace/      User file workspace (not committed)
```

## Deploy (systemd host install)

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

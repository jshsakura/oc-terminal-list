# Terminal List — CLAUDE.md

Web-based multi-pane terminal manager. React (Vite) frontend + FastAPI backend. Two deployment modes:

- **Container** (recommended): `docker compose up -d`. Bundles app + Redis. Sandbox shell inside container; real host accessed as an SSH host (auto-registered if `secrets/ssh-key` is mounted).
- **Host systemd** (legacy): runs on the host directly with `KillMode=process` so tmux sessions survive backend restarts. Used during development on the maintainer's machine.

## Project layout

```
backend/        FastAPI app (main.py = 앱/미들웨어/lifespan/라우터 등록만)
backend/routes/ 도메인별 APIRouter — 새 엔드포인트는 여기 추가
frontend/src/   React + xterm.js UI (Vite, JSX)
frontend/src/components/   UI components
frontend/src/hooks/        Custom React hooks
deploy/         systemd unit file + local-deploy.sh (host install)
Dockerfile, compose.yml          container deployment (single image from GHCR)
shared/         Cross-stack single-source fixtures (agent-title cases read by both test suites)
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

## Backend module layout

`main.py` owns only the app object, middleware, lifespan, and router registration. Endpoints live in `routes/*.py`; shared state lives in focused top-level modules. **Add new endpoints to a `routes/` module, never back into `main.py`.**

| Module | Owns |
|---|---|
| `routes/auth.py` | login/token, OTP, passkey |
| `routes/sessions.py` · `routes/terminal_ws.py` | session REST · local terminal WS |
| `routes/hosts.py` · `routes/host_ws.py` · `routes/host_files.py` · `routes/host_git.py` | SSH hosts |
| `routes/files_read.py` · `routes/files_write.py` | workspace files, split by side effects |
| `routes/user_state.py` | UI settings, command history, tab state, SSE |
| `_deps.py` | boundary validators (`validate_path`, `is_safe_id`), auth dependency |
| `tickets.py` | WS/file/SSE single-use tickets (together so their rules stay in lockstep) |
| `session_launch.py` | cwd/shell resolution + ownership check — REST and WS **must** share this |
| `ws_clients.py` · `sse_broadcast.py` · `file_index.py` · `system_monitor.py` · `auth_cookie.py` · `models.py` | shared state / helpers |

`sqlite_storage.py` composes per-domain mixins from `db/` (`db/schema.py` owns all DDL). Call sites are unchanged — it is still `storage.list_hosts(...)`. **A mixin left out of the composition still imports cleanly and passes lint**; it only fails at the call site, in production. `tests/test_storage_mixins.py` does one round-trip per domain to catch that.

**Router registration order is matching priority.** FastAPI takes the first route that matches, so reordering `main.py`'s registration list can silently route a literal path into a `{param}` handler. Tests do not catch this. When refactoring, diff the route list *including order* against the previous commit:

```python
[(sorted(r.methods), r.path) for r in main.app.routes]   # compare as a list, never sorted
```

Tests that reach into module internals (`patch.object(main, "storage")`, `main._zip_directory_bytes`) must follow the code when it moves — a stale patch target does not fail loudly, it silently patches nothing and hits the real dependency.

## Agent status detection (2026-07-21)

Terminal panes report agent state (`working` / `permission` / `idle`) with **no LLM call** — it is parsed from the tmux pane title.

**tmux already parses OSC 0/2 titles for us.** That is the whole trick: no PTY byte scanning, no chunk-boundary carry, no backpressure interaction. Two feeds:

| Feed | Covers | Latency |
|---|---|---|
| xterm `onTitleChange` (`createXtermInstance.js`) | any attached pane, **incl. remote SSH hosts** | instant |
| backend `tmux list-panes -a -F` poll (`agent_status_watcher.py`) | local sessions **with no client attached** | 1.5s active / 5s idle |

Remote panes live in the *remote* box's tmux, so the backend poll cannot see them — remote status depends entirely on the xterm feed.

Both feeds require `set-titles on` + `set-titles-string '#{pane_title}'`; tmux's default is **off**, which forwards nothing. Set in three places: `tmux_manager.create_session` (new local), `host_manager` remote bootstrap, and globally in `lifespan` (so sessions that outlived a backend restart still report).

Parser lives twice — `backend/agent_status.py` and `frontend/src/utils/agentTitle.js`. **They must agree**, so the case table is single-sourced at `shared/agent-title-cases.json` and both test suites read it. Add cases there, not in either test file.

Traps:
- Braille spinners change the title 10–12×/sec. Every layer folds spinner-only changes (`is_spinner_only_change`) — skip it and the SSE broadcast or React re-render storms.
- Agent names are matched as **whole tokens**. Substring matching made `android` ⊃ `droid`, `opencode-blinker` ⊃ `opencode`, `~/codex/ready` ⊃ `codex` all false-positive.
- Status rides the **existing** tab-state SSE as `{type:'agentStatus'}`. Never open a second EventSource — see `project_sse_reconnect_storm`.
- `idle` deliberately draws no tab badge; a dot on every agent tab is noise, not signal.

Detection rules ported from [stablyai/orca](https://github.com/stablyai/orca) (MIT), `src/shared/agent-title-status.ts`.

## Web push (agent-done notifications)

Fires on the watcher's `working → not-working` transition (`completed: true`), so it rides entirely on the tmux title feed — still no LLM call anywhere.

**The server decides whether to *send*; the service worker decides whether to *show*.** The server cannot know which pane you are looking at, so `sw.js` calls `clients.matchAll` and suppresses the notification when any window is focused. In-app, the tab status dot already carries the same signal more quietly.

- VAPID keys: `data/.vapid-key` (PEM, 0600), auto-created at startup. **Changing it invalidates every existing subscription** — browsers bind subscriptions to the public key. Never put it in `.env`.
- `py-vapid` wants the private key as **base64url of the raw 32-byte scalar**, not PEM. Passing PEM dies with "ASN.1 parsing error".
- Subscribing *is* the opt-in — there is no separate server-side setting. Unsubscribe to turn it off.
- A 60s per-session cooldown (`agent_status_service`) absorbs working↔idle flapping; without it a flickering title makes the phone buzz repeatedly and the user turns notifications off for good.
- Push services returning 404/410 mean the subscription is permanently dead — it is deleted on the spot rather than retried forever.
- **Requires a secure context.** `localhost` and HTTPS work; `http://<LAN-IP>:38822` does not — the browser hides the API entirely. `pushCapability()` reports `insecure` distinctly from `unsupported` so the UI can say "change how you connect", not "your browser is too old".

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

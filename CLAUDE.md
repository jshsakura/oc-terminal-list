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

- `POST /api/terminal/paste-file` / `paste-image` — upload a file for the terminal, returns the path to insert. Takes an optional `host_id` form field; see the rule below.
- `GET /api/files/grep?q=` — ripgrep workspace content search (file explorer content-search toggle).
- Session REST endpoints (`/api/sessions/{id}/...`) enforce ownership via `_assert_session_owner` (same check as the WS route).
- `GET /api/hosts/{id}/files/raw?path=` — inline preview stream for **remote** files (the editor's `<img>`/`<video>`/pdf `<iframe>` bites it directly, so cookie auth is the primary path). Same bytes as `/files/download`; the difference is the browser *renders* them, and that difference is the whole rule: only media that is safe to render inline passes (`inline_media_type`), plus `nosniff`. **SVG and HTML are refused on purpose** — a remote host's file rendered as a same-origin document is XSS, so remote HTML preview stays unsupported in `FileEditor.jsx` while images/video/audio/pdf work exactly like local ones. A directory whose name ends in `.png` comes back from `open_download` as a zip; it is refused **and the stream is closed**, or the SFTP context leaks.

## 에디터 미리보기 — 무엇이 열리고 무엇이 안 열리나 (2026-08-11)

| 종류 | 어떻게 | 원격도 |
|---|---|---|
| 이미지·동영상·오디오·PDF | raw 엔드포인트로 브라우저가 직접 렌더 | O |
| xlsx·xlsm | 바이트를 받아 프론트에서 파싱 → 표(시트 탭) | O |
| csv·tsv | 이미 텍스트로 들어와 있으므로 내용에서 표를 파생(추가 요청 0) | O |
| html | 로컬만 — 원격 문서를 same-origin 으로 띄우면 XSS | X |
| svg | 로컬만 이미지, 원격은 텍스트(Monaco xml) — 위와 같은 이유 | 텍스트 |
| .xls·doc·ppt | **계속 차단**. 리더가 OOXML 전용이라 열어봐야 깨진다 | — |

- **xlsx 리더는 lazy chunk 다**(`xlsx-reader`, 16KB gz). eager `vendor` 에 섞이면 전원이
  시작 로드에서 받는다 — vite `manualChunks` 에 prettier·noVNC 와 같은 이유로 따로 뺐다.
- 바이트는 `/files/raw` 가 아니라 **download 라우트**로 받는다. raw 는 *인라인 렌더* 경로라
  미디어만 통과시키는 게 규칙이고, 여기선 우리 파서가 읽을 바이트만 필요하다.
- 파싱은 메인 스레드다 → **크기 상한(12MB)** 을 두고 넘으면 거절한다. 미리보기는
  데이터 파이프라인이 아니다.
- 프론트의 `isRemoteInlinePreviewFile` 은 백엔드 `inline_media_type` 의 **거울**이다.
  어긋나면 프론트는 그리려 하고 서버는 415 를 주는 조합이 된다.

## WS reconnect auth — ticket first, same-origin cookie fallback (2026-07-24)

**The root cause of "all panes stuck on 다시 연결 중 until a refresh":** WS reconnect needed a `/api/ws-ticket` HTTP fetch to get a ticket, and that fetch reuses the browser's **shared HTTP/2 connection** — the one that wedges on mobile network switches / the Cloudflare single tunnel. When it wedges, no ticket → no reconnect → only a page reload (fresh connection pool) recovers. The pre-pushed ticket (`_push_ws_tickets`, 10s interval / 30s TTL) bypasses this, but only if a valid stash exists — it doesn't on first connect, after >30s disconnect (phone locked), or once burned by a failed attempt.

**Fix (`backend/ws_auth.py`):** the WS handshake authenticates by ticket **or**, if none, by the same-origin auth cookie (`iterm_auth`). A fresh WebSocket is always a fresh TCP connection, so it sidesteps the wedged HTTP/2 pool, and the cookie rides the handshake automatically — reconnect no longer depends on an HTTP fetch. Both `routes/terminal_ws.py` and `routes/host_ws.py` call `authenticate_ws()`.

- **CSWSH defense:** the cookie is `SameSite=Strict` (browser won't attach it cross-site) **plus** an Origin check — cookie fallback is refused unless `Origin` is in `ALLOWED_ORIGINS` (or, when that's unset/wildcard, `Origin` host == `Host`). No `Origin` header (non-browser) → cookie fallback refused. Tickets are unaffected by the Origin check.
- **Same trust as every cookie endpoint:** fallback uses `verify_token`, which rejects scoped (ITL) / otp_pending tokens — a leaked `ITL_TOKEN` can't attach a WS.
- **Client (`Terminal.jsx` `connect()`):** when the ticket fetch fails and it is **not** a 401 (i.e. the wedge case), it no longer bails — it opens the WS with no ticket and lets cookie auth bootstrap it. `buildWsUrl` omits the `ticket` param when falsy. Genuine auth expiry (401) still routes to the login screen; if the cookie is also dead the server closes 1008 and the next ticket fetch's 401 triggers login.

**SSE and raw-file tickets got the same cookie fallback (2026-07-24).** Same wedge, same cure — but simpler, because both are ordinary GET routes (not a WS handshake), so they reuse `verify_auth_token` directly instead of `ws_auth`:
- **SSE** (`/api/tab-state/events`, `useWorkspaceTabs.js`): the client now opens `new EventSource('/api/tab-state/events')` with **no** `/api/sse-ticket` POST — EventSource carries the same-origin cookie automatically. The endpoint takes ticket-or-cookie. This also removes the ticket POST that fed the SSE-reconnect storm.
- **Raw file** (`/api/files/raw`, `FileEditor.jsx`): the `<img>` preview loads `?path=…` directly (cookie) with **no** `/api/files/raw-ticket` POST. The endpoint's non-ticket branch now accepts the cookie (`verify_auth_token(authorization, auth_cookie)`); `validate_path` still scopes the path to the workspace.
- CSRF for these two is the app-wide convention — the cookie's `SameSite=Strict` — not a per-endpoint Origin check (a same-origin `<img>`/EventSource GET often sends no `Origin`, so requiring one would break it). The WS handshake keeps its stricter Origin check because browsers always send `Origin` there.
- Ticket endpoints stay for backward-compat with cached clients; new clients don't call them.

## Tab/session close model (as of 2026-07)

Closing a tab **terminates all its inner sessions** (no detach/keep-alive). `closeTab` always runs `closeAndTerminate`; there is no separate "kill session" menu item. Network-drop reconnection is unrelated resilience and still auto-recovers. See memory `project_close_session_model`.

## Multi-device tab-state sync (the echo rule, 2026-07-30)

Two clients open at once (PC + phone) share one server-side tab-state. The rule that keeps them from fighting:

**A no-op must produce no version.** `save_tab_state` stamps a fresh `updated_at` regardless of content, and that stamp is broadcast over SSE. Applying a received state used to hand `setTabs` a brand-new array, which re-armed the save effect, which PUT the *same* content back — so two devices bounced identical state off each other about once a second, forever. Three locks, all of which must stay:

1. `PUT /api/tab-state` compares the sanitized payload against the stored row and returns `{"status":"unchanged"}` without saving or notifying when they match (`routes/user_state.py`).
2. `applyServerTabState` returns the **previous array reference** when the incoming state is content-equal (`utils/tabStateSync.js` `areTabsEquivalent` — key-order-insensitive, so a server round-trip doesn't read as a change).
3. The save effect skips the PUT entirely when the tabs' fingerprint equals the last known-synced one.

Related behavior, same file:
- **`activeTabId` is never live-synced**, and on restore this device's remembered tab wins if it still exists — the server value is whatever device saved last, so adopting it unconditionally drags you to the PC's tab on every refresh.
- When the tab you're on disappears (another device closed it), you land on the **neighbor at that index**, not `tabs[0]`.
- The active-tab validator does nothing while `tabs` is empty. Boot order is: validator effect runs before restore, so clearing there would erase the remembered tab before the restore can match it.
- `localDirtyRef` (the "a save is pending, don't let SSE overwrite" latch) is released in the effect cleanup. It used to stick `true` when a pending save was cancelled — on mount that happens every time, and a stuck latch silently disables live sync until the next local change.

## 원격 세션 소멸 — 인과는 시간 창이 아니라 소켓에 묶는다 (2026-08-09)

호스트가 재부팅되면 원격 tmux 세션이 통째로 사라진다. 그때 `create=0` 재시도는 전부 같은
`exit 42` 로 끝나므로, 백엔드가 `{"type":"session-gone"}` 을 보내고 프론트가 **새 세션
생성(create=1)** 으로 전환한다. 그 전환이 안 걸려 `[session not found]` 가 **50초 간격으로
무한 반복**되던 버그가 있었다. 두 겹이었고, 둘 다 다시 밟기 쉽다:

- **원격 셸이 죽어도 WS 가 안 닫혔다.** `_stdout_pump` 의 `stdout.read()` EOF 만 믿었는데,
  **PTY 가 붙은 채널에서는 명령이 이미 exit 한 뒤에도 read 가 그대로 앉아 있을 수 있다.**
  결국 소켓이 죽은 걸 알아채는 건 클라이언트 하트비트(15s ping + 35s 임계 = **50s**)뿐이었다.
  지금은 `_watch_exit` 가 `process.wait_closed()` 를 기다렸다 브리지를 끝내고, 소켓은 SSH
  정리를 **기다리지 않고 먼저** 닫는다(`conn.wait_closed()` 에도 5s 상한 — 끊긴 망에서 무한히
  붙잡힌다). `TailscaleHostBridge` 는 `isalive()` 20ms 폴링이라 이 병이 없다.
- **판정을 15초 신선도 창으로 쟀다.** 신호와 close 사이 간격은 우리가 정하는 값이 아니다 —
  위처럼 50초가 걸리면 창이 만료돼 평범한 끊김으로 처리되고 다시 `create=0` 이 된다.
  지금은 신호를 보낸 **소켓**에 묶는다(`sessionGoneSocketRef`). 오래된 신호가 다음 소켓으로
  새지 않으면서 창이 필요 없다.

**일반화해서 기억할 것: 두 이벤트의 인과를 시간 창으로 재지 마라. 같은 객체에 묶어라.**
`Terminal.reconnect.test.jsx` 의 "close 가 한참 뒤에 와도(60s)" 케이스가 이 선을 지킨다.

### 도달 불가 호스트 — "열렸다" 는 연결 성공이 아니다 (2026-08-09)

바로 위와 **같은 뿌리의 두 번째 사례**다. 호스트가 꺼져 있으면 WS 핸드셰이크는 성공하고
그 **뒤에** SSH 가 15초 타임아웃으로 실패한다. 그런데 `onopen` 에서 백오프 라운드
(`outageRoundRef`)를 0 으로 되돌리고 있어서, 매 실패가 "첫 시도" 가 되어 150~300ms 만에
재시도 → 또 15초를 태움 → **15초 주기로 영원히**, 그때마다 같은 빨간 줄이 스크롤백에 쌓였다
(실측 로그가 평평한 15~16초 간격이었다 — 백오프가 전혀 안 걸렸다는 뜻).

- **백오프 리셋은 핸드셰이크가 아니라 "쓸 만한 연결" 이 기준이다.** `outageRoundRef` 리셋을
  `reconnectAttemptsRef` 와 **같은 자리**(`RECONNECT_STABLE_RESET_MS` 안정 타이머)로 옮겼다.
  attempts 에는 원래 flapping 가드가 있었는데 라운드에만 없었다.
- **실패 문구는 백엔드가 터미널에 직접 찍지 않는다.** `{"type":"connect-failed","detail":…}`
  컨트롤로 보내고 프론트가 쓴다. 백엔드는 연결마다 새 브리지라 자기가 이미 찍었는지 모른다 —
  **중복 판단은 상태를 가진 쪽이 해야 한다.** 프론트는 같은 사유면 한 번만 쓰고, 사유가 바뀌면
  (타임아웃 → 인증 거부) 새 정보라 다시 쓴다.
- 그 신호를 받은 소켓의 close 는 짧은 재시도 버스트를 건너뛰고 곧장 `keepReconnectingPill`
  사다리(4→8→16→30s)로 간다. TCP 단에서 15초를 기다려 실패한 호스트가 300ms 뒤에 살아날 리 없다.

**두 사례의 공통 교훈: "성공했다" 의 정의를 너무 이르게 잡지 마라.** 겉으로 열린 것과 실제로
쓸 수 있는 것은 다르다.

### 세 번째 사례 — 우리가 죽인 것을 exit 로 읽었다 (2026-08-10)

"세션 재시작" 은 tmux 를 **일부러** 죽이고 재접속이 `create=1` 로 새로 만들기를 기다리는
흐름이다. 그런데 그 죽음은 화면상 "셸이 exit 했다"(= pane 자동 닫기) 와 구별되지 않아서,
**재시작이 곧 pane 삭제**가 됐다 — 눌러도 아무 일 없어 보이고 새로고침해야 돌아왔다.
(진단은 로그가 했다: kill 뒤 그 세션으로 가는 WS 가 한 번도 없고 탭 상태에서도 사라졌다.)

- `Pane` 이 **kill 보다 먼저** `restartAt` 을 세워 `Terminal` 에 넘긴다. 그 뒤의 "세션 없음" 은
  닫는 대신 `create=1` 로 새로 만들어 붙는다.
- **래치는 시계가 아니라 성공으로 푼다** — 새 셸이 붙으면(`terminalReady`) 즉시 내린다.
  `RESTART_GRACE_MS` 는 영영 안 붙는 경우의 안전망일 뿐이다(위 규칙과 같은 이유).
- `forceReconnect` 에는 **지금 살아있는 소켓**(`wsRef.current`)을 넘겨야 한다. 옛 소켓을
  넘기면 이미 떠 있는 create=0 재시도 때문에 `connect()` 의 "연결 중이면 no-op" 가드에
  걸려 우리 create=1 이 조용히 버려진다.
- 예외를 넓히면 **반대 사고**(셸을 끝내도 pane 이 안 닫힘)가 난다. 테스트가 양쪽을 다 잠근다.

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
- Duplicate suppression is **by content, not by clock**. A completion is re-sent only when its signature (task title + screen excerpt) differs from the last one. An agent that answers briefly and pauses over and over does not buzz the phone each time. Crucially this is not a "waiting for you to press 계속" latch: the moment the content changes, the next notification fires immediately regardless of elapsed time — there is no held-back state. Spinner flapping never reaches here anyway; the watcher folds it before `completed` is emitted.
- Push services returning 404/410 mean the subscription is permanently dead — it is deleted on the spot rather than retried forever.
- **Requires a secure context.** `localhost` and HTTPS work; `http://<LAN-IP>:38822` does not — the browser hides the API entirely. `pushCapability()` reports `insecure` distinctly from `unsupported` so the UI can say "change how you connect", not "your browser is too old".

## Terminal-to-terminal messaging (`itl`)

An agent running inside one pane can drive another pane. `backend/cli/itl` is a single stdlib-only Python file; sessions learn their identity from env injected at `tmux new-session -e` time (`ITL_API` / `ITL_TOKEN` / `ITL_SESSION`, built in `itl_env.py`, wired into **both** creation paths — REST and WS attach).

Addresses (`itl list` prints the table that documents them):

| Form | Means |
|---|---|
| `3` | pane 3 of the caller's tab (needs `ITL_SESSION`; refuses rather than guessing globally) |
| `1.3` / `1:3` | tab 1, pane 3 |
| `@name` / `@name.2` | tab by name — its active pane, or pane 2 |
| `@working` `@idle` `@permission` | by agent status |
| `@claude` `@node` … | by running command |
| `@all` | everything (capped at `MAX_FANOUT`) |

**Numbers are what humans say; session IDs are identity.** Closing a pane shifts every later number, so an address is resolved to a session at call time and nothing downstream reuses the number. A **user-given tab name always beats a built-in group** — no exceptions, so naming a tab "working" can't turn `@working` into a trap.

Traps:
- `send-keys -t` takes a **pane** target. `=name` works for session targets but fails here with "can't find pane" — use `=name:` to keep exact matching while resolving to the session's current window.
- `--submit` is off by default. Text lands on the prompt and a human presses Enter; a stray Enter inside vim/claude executes something nobody asked for (same rule as terminal file drop).
- `ITL_TOKEN` is readable via `tmux show-environment`, so it is a **scoped** JWT (`scope: "itl"`). `verify_auth_token` rejects any token carrying a scope claim — a leaked ITL_TOKEN cannot read files or host secrets.
- Remote panes are addressable but **not yet sendable** (needs an SSH round trip); `send` reports them as `skipped: remote-unsupported` rather than silently dropping.
- Status groups only cover local sessions — the backend watcher cannot see remote tmux (see the agent-status section).

### MCP for AI agents

The same surface is exposed to agents over the Model Context Protocol (`backend/cli/itl_mcp.py`, stdlib only — `backend/cli/itl-mcp` is a one-line `exec` wrapper). An agent in one pane gets seven tools — `terminal_list` / `terminal_whoami` / `terminal_resolve` / `terminal_send` / `terminal_read` / `terminal_wait` / `terminal_key` — that drive its siblings by the address grammar above. Every tool auto-attaches `ITL_SESSION` as `from_session`, so address resolution, self-exclusion (`exclude_self`), and the fan-out limit (`MAX_FANOUT=20`) work the same way as the CLI.

The address grammar gains two caller-tab anchors that only resolve when `ITL_SESSION` is set; without one they return empty rather than guessing globally (same refusal as bare `3`):

| Form | Means |
|---|---|
| `@here` | every pane in the caller's tab, **including self** |
| `@siblings` | every pane in the caller's tab, **excluding self** |
| `2.@claude` / `@backend.@working` | tab qualifier + group/command word — same resolution order as the bare form |

Register with the agent (env is inherited from the pane — never put `ITL_TOKEN` in the config):

```bash
claude mcp add itl -- python3 <repo>/backend/cli/itl_mcp.py
```

Reading is gated by `ITL_READ_ENABLED` (default `1`). A leaked `ITL_TOKEN` with read+send is, in effect, an interactive shell — stronger than send alone. The reason this is still acceptable: to read `ITL_TOKEN` at all you must run `tmux show-environment`, which already means **the caller can execute commands as that user on that machine** — at that point typing into the pane directly is easier. The same argument the Xvnc password paragraph makes: a file's weakness does not enlarge the exposure surface.

Traps (MCP-specific):
- **stdout is JSON-RPC only.** A single stray `print()` makes the client treat the server as dead. All logs go to stderr, and only when `ITL_MCP_DEBUG=1`.
- **Never respond to a notification.** Messages without `id` (e.g. `notifications/initialized`) get `return None` at the top of the dispatcher — answering them is a protocol violation.
- **`send_keys -l "C-c"` types the literal `C-c`.** Special keys go through `tmux_manager.send_key`, which lets tmux interpret the key name. The Telegram stop button hit the same trap.

## iOS 주소창 밑 진행바 = 페이지가 소유한 "끝나지 않는 요청" (2026-08-11)

사파리에서 주소창 아래 파란 진행바가 10%쯤에서 멈춘 채 남고, **간헐적으로 다시 뜬다**.
브라우저 UI 라 우리 CSS 로는 못 건드린다. 원인은 EventSource — 응답이 끝나지 않는 HTTP
요청이라 사파리가 "아직 로딩 중인 서브리소스" 로 센다.

- **`load` 이후로 미루는 회피는 첫 연결만 덮는다.** 터널이 SSE 를 끊을 때마다 새 스트림이
  열리고 그때마다 바가 돌아온다 — "간헐적" 의 정체가 이것이다. 타이밍으로는 못 고친다.
- 그래서 **스트림을 워커가 든다**(`workers/sseWorker.js` + `utils/eventStream.js`).
  워커의 요청은 문서 로드 진행에 포함되지 않는다.
- ⚠️ **워커로 넘기는 것은 스트림뿐이다.** 티켓 발급·백오프·단일 연결 불변식은 메인
  스레드에 남는다 — [[project_sse_reconnect_storm]] 이력이 있는 로직이고, 스레드 경계로
  쪼개면 그게 **둘**이 된다(그게 정확히 그때 터진 사고다).
- 폴백은 조용히: Worker 없음 / 워커 안 EventSource 없음(사파리 16.4 이전) / 생성 차단이면
  예전처럼 페이지에서 연다. 한 번 실패하면 그 세션 동안 재시도하지 않는다.
  **진행바는 미관 문제지 동기화보다 우선일 수 없다.**

같은 함정의 일반형: **화면에 보이는 브라우저 UI 이상 증상을 CSS 문제로 보지 마라.**
대개는 우리가 연 연결·요청의 수명이 원인이다.

## 클립보드 · 팝업 닫기 — 모바일에서 조용히 죽던 두 규칙 (2026-08-11)

**클립보드 구현은 `utils/clipboard.js` 하나다.** 아이폰에서 "복사 눌러도 안 붙는다" 의 원인:

- `navigator.clipboard` 는 **비보안 오리진에서 아예 없다**(plain-http LAN 주소). 인앱
  웹뷰(텔레그램의 그 "열기" 버튼)에서는 있어도 reject 될 수 있다. 폴백 없이 부르면
  예외만 나고 화면은 아무 말도 안 한다 — 실제로 모바일 툴바 복사가 그 상태였다.
- **iOS 는 `textarea.select()` 를 무시한다.** `Range` + `setSelectionRange` 로 잡아야 하고,
  대상 요소가 **화면 밖(`top:-9999px`)이거나 완전 투명이면 복사 자체를 거부한다.**
  1×1 px, `opacity:0.01`, 뷰포트 안 — 이게 실제로 통과하는 조합이다.
- 결과를 **boolean 으로 돌려준다.** 실패했는데 "복사됨" 체크를 띄우면 거짓말이고, 사용자는
  붙여넣기를 시도한 뒤에야 안다. 전부 실패하면 텍스트를 선택해 두고 "길게 눌러 복사" 를 띄운다.

**팝업 바깥 닫기는 `hooks/useDismissOnOutside` 하나다 — `pointerdown` 을 캡처 단계에서 듣는다.**
`mousedown`/`touchstart` 는 document 까지 못 오는 길이 둘이나 있다: 터미널 오버레이가
`touchstart` 를 `preventDefault` 하면 합성 mousedown 이 통째로 사라지고, React 핸들러의
`stopPropagation()` 은 네이티브 이벤트까지 멈춘다. `pointerdown` 은 touchstart 와 별개
이벤트이고 document 캡처는 그 무엇보다 먼저 돌아, 어떤 컴포넌트도 실수로 메뉴를 못 닫게
만들 수 없다.

⚠️ **토글 버튼(`…`)은 스스로 닫아야 한다.** 바깥 감지는 그 버튼을 `ignoreSelector` 로
일부러 무시한다(안 그러면 눌러서 닫자마자 click 이 다시 연다). 그래서 핸들러가 열기만 하면
그 버튼으로는 **영영 못 닫는다** — 실제로 폰에서 그랬다. 열려 있으면 닫는 토글로 쓸 것.

**누른 표시는 전역 CSS 한 줄이다**(`main.jsx`). transform/filter 만 건드려 합성 단계에서
끝난다. iOS 는 페이지에 터치 리스너가 없으면 `:active` 를 **아예 적용하지 않으므로** 빈
`touchstart` 리스너를 하나 단다. 그리고 확인 모달은 idle 에 미리 받는다 — 탭 닫기처럼 흔한
동작이 첫 호출 때 청크를 기다리느라 "눌러도 한참 아무 일이 없어" 보였다.

## Terminal paste destination (the rule)

**Pasted files land in `/tmp/iterminallist-paste/` on the machine the pane lives on.** Local pane → this server's `/tmp`; remote pane → that host's `/tmp`, over SFTP.

The host half matters: a remote pane given a *local* path gets a file its shell cannot open, and the paste looks like it succeeded. The frontend threads the pane's `hostId` through all four upload call sites (clipboard paste, right-click send-file, drag-drop, mobile quick-input attach).

Why `/tmp` and not the workspace: `WORKSPACE_ROOT` is the jupyterLab/notebooks directory in this deployment. Pasted images accumulating there pollute the notebook folder, and inside a git repo they get swept into commits. `/tmp` is writable on any POSIX host, needs no cleanup (cleared on reboot), and can never touch project files. Trade-off accepted: pastes do not survive a reboot and are not browsable in the file explorer. Override the local dir with `PASTE_DIR` if a deployment needs it.

Filenames are `<timestamp>-<random>-<safe-basename>`. **The timestamp alone is not enough** — dropping several files at once puts them in the same millisecond and the earlier upload is silently overwritten.

**Broadcasting an attachment to panes on different hosts uploads to each host.** One path cannot be valid on two machines, but the send already fans out per pane, so the path is swapped per pane too (`useImageAttach.resolveTextForTargets`). The image goes up once when pasted (to the focused pane's host, so the user sees a real path) and again per additional host at send time, cached so a host is never hit twice. If one host's upload fails, only that pane keeps the unusable path — the rest still send. When there is no attachment the send stays **fully synchronous**; adding an `await` to the common path costs perceptible latency.

## Telegram notifications (buttons that work on iOS)

Web push delivers notifications, but **`showNotification` action buttons are not rendered on iOS** — on an iPhone the "계속" button simply does not appear. So Telegram carries the notifications that need buttons; web push stays for plain ones.

Flow: watcher sees `working → idle` → Telegram message with an inline keyboard → tap on the lock screen → long-poll worker receives `callback_query` → text injected into that pane.

- Config: `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` in `.env` (**env wins over the DB**, so secrets need not live in SQLite). The settings UI is the fallback path and vault-encrypts what it stores; it never returns the token.
- Buttons come from `TELEGRAM_ACTIONS` (comma-separated, e.g. `계속,테스트 돌려`); pressing one types that text into the pane and presses Enter. Default is a single `계속`. Action ids stay short (`a0`, `a1`) precisely so a long button label cannot push the session ID past Telegram's 64-byte `callback_data` limit.
- **중단 is always appended** and sends `C-c` as a *key*, not text — `send_keys -l "C-c"` would type the literal characters. A continue button without a stop button is half a tool: the point of watching from your phone is being able to halt a runaway agent.
- Notifications pack in everything already known — address, agent, elapsed time, host, cwd, task title, screen excerpt, and what the *other* terminals are doing (`notify_message.py`). One glance should answer "do I need to look at this now?". Empty fields are omitted rather than rendered blank; emoji are safe (they are plain text — only Markdown breaks).
- The heading is **main tab › sub tab** (`session_label.py`). The sub-tab slot shows the pane's *path tail* when that says something new, and the pane number when it does not — tab names usually come from the folder name, so printing both repeats the same word twice. The same de-duplication drops the `📁` line when the path adds nothing. Live cwd comes from `#{pane_current_path}` in the watcher's existing poll (free); tab-state's stored cwd is a save-time snapshot and goes stale.
- Elapsed time comes free from the watcher: it already sees the `working` transition, so `agent_status_service` just records the timestamp.
- Notifications carry a **screen excerpt** (`pane_excerpt.py`, no LLM). Naively tailing `capture-pane` yields UI chrome, because agent CLIs draw an input box and statusline at the bottom. The extractor judges by *shape*, not by matching known phrases — box-character ratio (catches `─ Worked for 8m 33s ────`), prompt-prefixed lines, and width-truncated `…` tails (every custom statusline gets clipped to terminal width). Phrase lists lose: each CLI and each user statusline breaks them anew. Expect one stray statusline line on unusual layouts; perfect stripping is not reachable without an LLM.
- **Every notification carries the pane address** (`1.3 · frontend`, from `session_label.py`, same numbering as `itl list`). Without it a "작업 완료" ping is useless once more than one terminal is running.
- **Long-poll, not webhook.** A webhook would mean opening another inbound door; `getUpdates` only makes outbound connections. Note that Telegram delivers each update **once** — if another integration polls the same bot, the two steal updates from each other.
- Two channels from Telegram back into a pane: **buttons** (callback, action id → whitelisted text) and **free text** (`telegram_command.py`). A message like `1.1 테스트 돌려` or `@claude 커밋해` routes through the same `itl_targets.resolve` addressing and injects the body (Enter pressed — a line from your phone means "run this"). Free text has no whitelist by design; that is the point. **The `chat_id` guard is therefore the only security boundary** — anyone in that chat can type into your terminals. `_handle_message` drops anything from another chat before doing anything, and does not even reply. Fan-out is capped (`MAX_MESSAGE_FANOUT`) so an `@all` typo cannot hit every session.
- Button callbacks are stricter: they carry an **action id only** — `push_actions.PUSH_ACTIONS` maps it to text, so a crafted callback cannot inject arbitrary strings.
- `callback_data` is capped at 64 bytes by Telegram; the format is `action:sessionId`.
- Discovering the chat ID needs the user to message the bot first — bots cannot start conversations. `discover_chats()` reads updates **without an offset** so it does not consume them; the normal poll filters to `callback_query`, which is why a plain message is invisible to it.
- **Never set `parse_mode`.** The body carries a raw terminal excerpt, so `*`, `_`, backticks and brackets appear arbitrarily; asking Telegram to parse it as Markdown fails the whole send with "unclosed entity" or silently drops characters. Plain text passes Korean, emoji and box-drawing through untouched (verified against the live API). Bodies are truncated to 4000 chars — over the limit Telegram rejects with 400 and the notification vanishes entirely.
- **열기 (Open) deep-link — an inline URL button (`🔗 열기`).** Each notification can carry a button linking to `<base>/?open=<sessionId>` that opens the web app straight to the pane that fired it. The frontend (`hooks/useDeepLinkOpen.js`) reads `?open=`, finds the tab/pane whose `sessionId` (local) or `id` (remote) matches, activates it, then strips the param. It waits for login+restore before giving up on a not-yet-loaded session; a session that's genuinely gone just clears the param quietly.
  - **Why a button, not a body-text link:** Telegram's push notification preview uses the message's **first line**, so a `🔗 https://…` line at the top mangles the notification title into a URL. The link lives in the inline keyboard instead. (Trade-off accepted: an inline URL button opens in Telegram's in-app WebView, which lacks the app's login cookies, and the Bot API can't force the external browser — the clean notification title won out.)
  - **Not full-width:** the open button shares one row with 계속·중단 (`telegram_client` renders all buttons in a single `inline_keyboard` row) so it renders compact, not as a big full-width button.
  - The base URL **must be configured** — a background worker has no request to derive it from. `PUBLIC_BASE_URL` env wins; otherwise the settings-UI value (`public_base_url` config key). **No base URL → no button** (a broken link is worse than none), so the notification still sends.
- This sends data outward: pane titles (your task text) and a few lines of screen content pass through Telegram's servers.

## Terminal file-path links (P4, from orca)

Clicking `src/components/Button.tsx:12:7` in terminal output opens that file in the editor. Ported from orca's `terminal-file-link-conformance.ts` cases. `utils/terminalFileLinks.js` is pure (17 tests); registration lives in `createXtermInstance` via `registerLinkProvider` (http links stay with `WebLinksAddon`).

- **Spaced paths are deliberately not matched.** xterm's link model is a contiguous character range on one line; deciding which space is inside a path vs. sentence separation needs the hover point (orca had it, our range model does not). Better to catch only the certain cases than to open the wrong file.
- URLs are excluded (scheme-prefixed) so `WebLinksAddon` owns them; bare words without a `dir/` segment are not paths (avoids linking "Button", "config").
- Only **local** panes register the provider — remote panes have a different workspace root, so `onFileLinkClick` is null there and no dead underline appears.
- `resolveWorkspacePath` maps the clicked path to a workspace-relative one: absolute paths must be inside `WORKSPACE_ROOT`, relative paths resolve against the pane cwd, `..` escaping the root → null (ignored). `~/` paths cannot be opened this way → null.
- App↔Terminal use a `window` CustomEvent (`iterm:open-file`) rather than threading a prop 6 levels — same pattern as `iterm:activity` / `iterm:auth-prompt`.
- **Not yet wired: line navigation.** `handleFileOpen(path, hostId)` takes no line arg; the parsed `line`/`column` are passed in the event but dropped. Monaco's `revealLineInCenter` makes this a small follow-up.

## Terminal.jsx — what can and cannot move

Terminal.jsx is dominated by a single ~919-line `useEffect` (`[connectionKey, updateEdgeGutter]`). Not all of it is equal:

- `connect()` and the `socket.onmessage/onclose/onerror` handlers capture **effect-local variables** (`socket`, `cancelled`) and are the home of the hard-to-reproduce reconnect bugs. **Do not move these.** Tests cover state transitions, not timing.
- The **fit/resize cluster** captures only **refs** (`fitAddonRef`, `wsRef`, `lastDimsRef`, …), which never go stale, so it moves out safely — `createFitController.js`. `computeFitResize` is the pure "when do we send a resize" core (send only when WS is open *and* dims changed); the controller owns the listeners and returns a dispose. This is the pattern for thinning Terminal.jsx further: move ref-only clusters, leave closure-capturing ones.

⚠️ Resize/fit is a real-device concern (mobile keyboard, visualViewport). The 67 Terminal tests are the only net; after any change here, confirm on an actual device that resizing the window and opening/closing the editor still refit cleanly.

## 렌더 상한 — 출력 싱크가 곧 fps다 (2026-08-07)

`createOutputSink.js` 의 코얼레싱 창이 그 pane 의 렌더 주기다. WS 바이트가 여기서 묶여
`term.write` 로 가고, 그 write 하나가 xterm 파싱 + WebGL 드로우 한 프레임이다. **"터미널이
버벅인다 / 기기가 뜨겁다" 는 거의 항상 이 상수 이야기다.**

- **리딩엣지 + 코얼레싱.** 창이 비었으면 타이머 없이 그 자리에서 쓰고, 지속 출력 중에는
  창 주기로만 쓴다. 예전의 트레일링 16ms 배치는 정확히 반대였다 — 조용하다 온 한 글자도
  16ms 늦고, 출력이 이어지는 동안은 **초당 60회** 파싱+GPU 드로우가 돌았다. 사람이 기다리는
  건 앞의 첫 바이트뿐이고 지속 출력의 중간 프레임은 읽지도 못한다.
- **분할 그리드에서는 형제 pane 이 전부 `isActive=true`다** (`Terminal.jsx` 의 그 주석).
  그래서 이 창은 pane 수만큼 곱해진다 — 4분할 동시 출력이면 옛 값으로 초당 240 프레임이었다.
  `isFocused` 를 따로 받아 보고 있는 pane 만 33ms(~30fps), 나머지 보이는 형제는 50ms(~20fps).
- 배치 주기를 올릴 때 **에코 지연 걱정은 리딩엣지가 이미 막았다.** 창을 늘려도 조용하다
  들어온 첫 바이트는 항상 즉시 그려진다. 늘어나는 건 지속 출력 중의 병합 폭뿐이다.
- `flush()` 는 **실제로 쓰지 않는 경로(비활성 버퍼링)에서도 `lastFlushAt` 를 찍는다.** 안
  찍으면 비활성 pane 의 매 push 가 리딩엣지로 떨어져 `dropOldestIfOverCap`(버퍼 전체 순회)이
  청크마다 돈다.

### 발열 원인을 지목하기 전에 소스를 읽어라

읽지 않고 지목했다가 틀린 것들이다. 다시 밟지 말 것:

- **`cursorBlink` 는 발열 원인이 아니다.** `CursorBlinkStateManager` 는 `BLINK_INTERVAL=600`
  이라 **초당 1.67 프레임**이고, 생성자가 `isFocused` 일 때만 인터벌을 걸며 `handleBlur` 에서
  `pause()` 한다 — **포커스 잃은 터미널은 아예 안 깜빡인다.** 분할 4개가 각자 블링크 루프를
  돈다는 건 사실이 아니다. (DOM 렌더러 쪽은 CSS 애니메이션이라 메인스레드 비용도 없다.)
- **`WEBGL_IDLE_RELEASE_MS`(3분)를 줄이는 건 손해다.** attach/detach 가 각각
  `term.refresh(0, rows-1)` 전체 재페인트를 부른다 — 타이핑이 잠깐 멈출 때마다 churn 하면
  아끼는 1.67fps 보다 더 쓴다. 이 값은 발열이 아니라 **밤샘 GPU 컨텍스트 누수**용이다.
- `components/Sidebar.jsx`(751줄)는 **아무도 import 하지 않는 죽은 코드**다. 그 안의 10초
  `/api/system/stats` 폴링은 돌지 않는다 — 성능 문제로 오해하지 말 것.

### `isActive` 는 "보고 있는 pane" 이 아니다 (2026-08-07)

**분할 그리드에서는 형제 pane 이 전부 `isActive=true` 이고 `isFocused` 만 1개다**
(`Terminal.jsx` 의 그 주석, `PaneGrid` 는 `isFocused={pane.id === tab.activePaneId}`).
`isActive` 로 "하나만 하는 일" 을 게이트하면 조용히 pane 수만큼 곱해진다. 같은 뿌리로
**세 군데**가 틀려 있었다 — 출력 렌더(60fps×4), 하트비트 ping(5s×4), `/api/health`
프로브(3s×4). 새로 게이트를 달 때 이 질문을 먼저 하라: *분할이면 몇 개가 실행되는가?*

⚠️ `tab.activePaneId` 는 **보장되지 않는다**(`App.jsx` 에 `|| panes[0]` 폴백이 있다).
그러니 **정확히 하나여야 하는 일을 `isFocused` 에만 기대지 마라** — 아무도 focused 가
아니면 아무도 안 한다. 프로브가 모듈 레벨 리스를 쓰는 이유가 이것이다.

### outage 프로브 — 리스 + 사다리

`/api/health` 프로브는 **막혀서 생긴 장애를 더 밀어붙이던** 쪽이었다. 이 앱의 장애는 대개
공유 터널 포화인데(memory `project_cloudflare_tunnel_layer`), pane 마다 3초로 두드렸다.
실측된 5분 30초 장애 하나에 4분할 기준 400회가 넘는다.

`components/terminal/outageProbe.js` 가 둘을 갖는다:
- **리스** — 페이지당 한 pane 만 프로브한다. `isFocused` 가 아니라 모듈 레벨 클레임이라
  activePaneId 가 비어도 성립한다. **15초 무갱신이면 다른 pane 이 뺏어온다** — 명시적
  해제에만 기대면, 리스를 쥔 채 정리된 pane 하나가 페이지 전체의 복귀 감지를 죽인다.
  그래서 프로브 타이머를 clear 하는 **모든** 자리에서 해제도 같이 한다.
- **사다리** — 0~30s 는 3초, ~2분은 10초, 그 뒤 30초. 3초 해상도는 초반에만 값어치가 있다.

리스를 빼면 통합 테스트가 30초 창에서 24회를 관측한다(리스 있으면 ≤12). 순수 테스트 9개는
사다리·리스 인계를, 통합 1개는 pane 간 조율을 덮는다 — 통합에서 사다리를 재려 하지 마라,
프로브 시작 자체가 백오프 라운드에 달려 있어 타이밍이 깨지기 쉽다.

### 하트비트의 watched 판정 (2026-08-07)

`isActive` 만 보던 시절, 분할 형제가 보고 있는 pane 과 똑같이 **5초마다** ping 했다(가짜
타이머로 실측: 30초에 6번). 형제는 전부 `isActive=true` 라 4분할이면 그게 4배다. 지금은
`watched = isActive && isFocused` 로 판정해 keepalive 를 기본 15초로 되돌린다.

**솎는 것은 건강할 때의 keepalive 뿐이다.** 임계를 넘긴 뒤의 escalation ping 은 포커스와
무관하게 5초 틱마다 그대로 나간다 — 감지 속도를 건드리지 않는 것이 이 변경의 조건이었고,
테스트가 그 선을 지킨다(`Terminal.reconnect.test.jsx` 의 "임계를 넘기면 포커스와 무관하게 매
틱 확인한다").

타이머 자체는 여전히 5초 하나다. **주기를 바꾸는 대신 틱을 세어 솎는 이유**: interval 주기를
포커스에 따라 갈아끼우려면 소켓 수명주기 안의 `setInterval` 을 재생성해야 하는데, 그 자리가
이 저장소에서 재연결이 가장 조용히 깨지는 코드다(위 "what can and cannot move").

임계도 함께 따라간다(watched 12s / 그 외 35s). **둘은 반드시 같이 움직여야 한다** — ping 만
15초로 늦추고 임계를 12초로 두면 멀쩡한 소켓이 매번 죽는다.

### 항상 도는 타이머는 활동 중에만 돌게

App.jsx 의 탭 busy 인디케이터 틱(150ms)이 **아무 출력이 없어도 영영** 돌면서 매번 Set 두 개를
만들고 탭×pane 을 순회했다. 지금은 `iterm:activity` 가 타이머를 켜고, `deriveBusy` 가
`idle`(만료를 기다릴 것도 켜둘 것도 없음)을 돌려주면 스스로 끈다.

판정은 `utils/busyActivity.js` 에 있다 — App.jsx 에는 렌더 테스트가 없으므로 그 안에 남은
로직은 테스트가 0 이다. **타이머·이벤트 배선만 App 에 남기고 파생은 밖으로.**

### 컴포넌트 수만큼 곱해지는 요청 — 캐시가 아니라 타이머를 공유해야 한다 (2026-08-12)

모든 탭의 `PaneGrid` 가 **항상 마운트**된다(스크롤백·WS 보존). 그래서 pane/탭 단위 훅 안의
fetch 는 조용히 pane 수·탭 수만큼 곱해진다. 실측(40분): 전체 HTTP 470건 중 **380건이
`/api/git/status`** 였고, 안 보이는 탭들이 각자 자기 오프셋으로 두드린 것이었다.

- **짧은 결과 캐시는 이 문제를 못 고친다.** 캐시는 창 안에 겹친 요청만 합치는데, 독립
  타이머들은 몇 초 만에 서로 어긋난다. 공유해야 하는 건 결과가 아니라 **타이머**다.
  → `utils/gitStatusStore.js`: (host, path) 키마다 타이머 1개·in-flight 1개, 구독자는
  결과만 나눠 받는다. 주기는 **가장 짧은 간격을 요구한 구독자**가 정한다.
- **안 보이면 안 돈다.** `TerminalHeader` 는 `isPaneVisible`(= 그 pane 의 `isActive`)일
  때만 구독한다. git 배지는 그 pane 의 레일 안에만 그려지므로 안 보이는 동안의 값은
  아무도 못 본다. 다시 보이면 캐시를 즉시 받고 곧바로 갱신한다.
- 같은 병이 `useSnippets` 에도 있었다 — 탭마다 하나씩, 부팅 때 `GET /api/snippets` 가
  14번. 모듈 레벨 스토어로 1회.

**새 훅에 fetch 를 넣기 전에 물어라: 이게 pane 마다/탭마다 마운트되나?** 답이 예면
스토어를 밖에 두고 훅은 구독만 하게 한다.

### 부팅 버스트 — 최종 상태가 같으면 순서는 양보해도 된다 (2026-08-12)

복원된 워크스페이스(pane 14개)의 부팅 1초 구간 실측: `POST /api/ws-ticket` 14회,
`GET /api/snippets` 14회, cwd 조회 15회(원격 9개는 각각 SSH 왕복), 그리고 WS 핸드셰이크
14개 + tmux attach 리플레이 14개. 전부 **공유 HTTP/2 연결과 단일 Cloudflare 터널** 위로
동시에 나간다 — 이 저장소가 wedge 를 반복해 밟은 바로 그 자원이다(memory
`project_cloudflare_tunnel_layer`, `project_ws_ticket_wedge_cookie_fallback`).

- **티켓은 배치로 받는다.** `utils/wsTicketBatch.js` 가 30ms 창으로 모아
  `POST /api/ws-tickets`(`routes/ws_tickets.py`) 한 번. ⚠️ **결과는 위치로 매칭한다** —
  같은 호스트의 원격 pane 은 ws 경로가 전부 같은데 티켓은 단일 사용이라, 경로로 키를
  잡으면 첫 pane 만 붙고 나머지가 조용히 실패한다. 인증 모델은 그대로다(같은 발급 함수·
  같은 TTL·같은 경로 바인딩). 실패하면 예전처럼 쿠키 폴백이 이어받는다.
- **핸드셰이크는 몇 개씩 나눠 연다.** `utils/wsConnectGate.js` — 동시 3개, 보이는 pane
  우선. ⚠️ **무한 대기 금지**: 슬롯을 못 받아도 `WS_GATE_MAX_WAIT_MS`(2.5s) 뒤엔 그냥
  진행하고, 호출부가 반납을 잊어도 백스톱이 12s 뒤 되돌린다. 게이트가 재연결을 막는
  새 교착이 되면 이 저장소가 고쳐 온 모든 버그보다 나쁘다. 반납 자리는
  `clearOpenTimer` 하나다 — onopen/onclose 가 둘 다 지나는 유일한 지점.
- **안 보이는 pane 의 cwd 조회는 미룬다**(`useActiveTerminalCwd` 의 `deferMs`, pane 마다
  다른 지터). 보이게 되는 순간 0 이 되어 effect 가 다시 돌며 즉시 조회한다.

**일반화: 부팅에서 줄일 것은 총량이 아니라 동시성이다.** 어차피 다 할 일이면, 보이는
것부터 하고 나머지는 몇 십 ms 씩 비켜 세운다.

## Xvnc 원격 데스크톱 (2026-08)

호스트 카드 → Remote Desktop → 디스플레이 선택 → pane 에 데스크탑이 뜬다. pane 크기를
바꾸면 원격 해상도가 따라오고, 브라우저를 닫아도 호스트의 세션은 살아있다.

**`Xvnc : GUI = tmux : 셸`.** 비유가 아니라 구조가 같다 — 데스크탑이 호스트의 Xvnc
프로세스 안에서 돌고 뷰어는 붙었다 떨어졌다 할 뿐이다. x11vnc(실제 화면 미러링)를
쓰지 않는 이유가 이것이다: 지속성이 데스크탑 세션에 묶이고, 해상도 변경도 등록된
xrandr 모드로만 가능해 반쪽이다.

전송은 **SSH direct-tcpip**. VNC 는 호스트 루프백에만 바인딩하고 기존 SSH 연결 안으로
통과시키므로 호스트에 새 인바운드 포트를 열지 않는다. 이게 이 기능의 보안 경계다.

### 보안 모델 — 무엇이 무엇을 막는가

관문은 세 겹이고, **VNC 포트 자체는 네트워크에서 도달 불가**하다:

```
앱 로그인(JWT) → WS 인증(티켓/쿠키) → SSH(저장된 자격증명) → 그 호스트의 127.0.0.1
```

- `-localhost` 는 **고정 문자열**이다. 어떤 flavor 든 어떤 경로로든 뺄 수 없다. 빼면
  VNC 가 인터넷에 그대로 노출된다. `ss` 로 확인하면 `127.0.0.1:5901` 이지 `0.0.0.0` 이
  아니어야 한다. LAN·인터넷은 물론 **Tailscale 에서도 그 포트에 못 닿는다.**
- **VNC 비밀번호가 막는 것은 딱 하나 — 그 호스트에 이미 셸 계정을 가진 사람**이다.
  그 외에는 원래 들어올 수 없다.
- `~/.vnc/passwd` 는 고정 키 DES 난독화라 **암호학적으로 약하다**(0600 이어도 읽으면
  되돌릴 수 있다). 다만 그 파일을 읽으려면 이미 그 유저의 셸이 있어야 하고, 셸이 있으면
  루프백 포트에 그냥 붙을 수 있다 — 파일의 약함이 노출을 넓히지는 않는다. **비밀번호는
  같은 호스트 다른 유저에 대한 과속방지턱이지 진짜 경계가 아니다.**
- 따라서 **실제로 조여야 할 곳은 앱의 현관**이다. 앱이 뚫리면 VNC 도 같이 뚫리고,
  현관이 안전하면 VNC 는 이미 안전하다.

| 모듈 | 담당 |
|---|---|
| `backend/vnc_discovery.py` | X11 소켓·리스닝 포트·프로세스·바이너리 경로·GPU 능력 파싱 |
| `backend/routes/vnc.py` | 디스플레이 목록 / 세션 기동·종료 / 비밀번호 설정 |
| `backend/routes/vnc_ws.py` | WS ↔ RFB 바이트 펌프 |
| `frontend/src/components/vnc/` | noVNC 클라이언트 (lazy chunk) |
| `frontend/src/utils/vncResize.js` | 리사이즈 판정 + 250ms 디바운스, 생성 해상도 계산 |

### 함정 (전부 실호스트에서 밟은 것들)

**테스트가 전부 통과해도 아래는 안 잡힌다.** 실제로 붙어봐야 나온다.

- **WS 서브프로토콜을 골라줘야 한다.** noVNC 는 `binary` 를 요구하는데, 서버가
  `websocket.accept()` 를 인자 없이 부르면 RFC 6455 상 **브라우저가 연결을 실패
  처리**한다. 서버에는 예외가 남지 않아 로그가 `connection open / closed` 로만 보인다.
  클라이언트가 제시한 목록에 있을 때만 골라라 — 제시 안 한 걸 고르면 그것도 실패한다.
- **VNC WS 로 제어 메시지를 보내지 마라.** RFB 는 순수 바이너리 스트림이다. 터미널 WS 의
  `_push_ws_tickets` 를 재사용하면 JSON 텍스트 프레임이 섞여 들어가 noVNC 가 `RFB 003.008`
  인사를 못 읽는다. 재연결은 핸드셰이크의 쿠키 폴백으로 충분하다.
- **`ssh_pool` 을 쓰지 마라.** janitor 가 300s idle conn 을 닫는데 RFB 스트림은 `run()` 을
  거치지 않아 `last_used` 가 갱신되지 않는다 — 잘 보다가 5분 뒤 끊긴다. 전용 conn 을 연다.
- **`-localhost` 표기가 flavor 마다 다르다.** TigerVNC 는 `-localhost yes`, TurboVNC 는
  인자 없는 불리언 `-localhost`. TurboVNC 에 `yes` 를 주면 Xvnc 로 새어들어가
  `Unrecognized option: yes` 로 죽는다. **루프백 바인딩 자체는 어느 쪽이든 필수다.**
- **`-SecurityTypes` 를 지정하지 않으면 세션 생성이 무한 대기한다.** `~/.vnc/passwd` 가
  없으면 vncserver 가 `vncpasswd` 를 띄우고 입력을 기다린다. 원격에는 사람이 없다.
  비밀번호 파일이 있으면 기본(VncAuth) 유지, 없으면 `-SecurityTypes None`. 그리고 원격
  명령은 **stdin 을 `/dev/null` 로 막고 타임아웃을 걸어라.**
- **디스플레이 판정을 X11 소켓만으로 하지 마라.** 데스크탑이 도는 기계면 `/tmp/.X11-unix/X0`
  은 항상 있다. 5900번대 리스닝이나 `Xvnc`/`Xtigervnc` 프로세스가 있을 때만 목록에 넣는다.
- **`ps` 는 자기 자신을 출력한다.** 디스커버리 명령줄에 `Xtigervnc`(후보 경로 루프)와
  `:32`(`user:32`)가 한 줄에 들어 있어 "디스플레이 32번" 유령이 생겼다. 명령줄 문자열이
  아무 데나 등장하는 것으로 잡지 마라 — basename 정확 일치 + 독립된 `:N` 인자여야 한다.
- **`auth_method == 'tailscale'` 호스트는 asyncssh conn 이 없다.** `tailscale ssh` 로 SSH
  채널을 열고 원격에서 `nc → ncat → bash /dev/tcp` 폴백으로 루프백에 파이프한다.
  Tailscale IP 직결은 안 된다 — `-localhost` 때문에 그 주소엔 아무도 듣지 않는다.

### 3D 가속

Xvnc 는 소프트웨어 프레임버퍼라 GL 앱이 llvmpipe 로 떨어진다. GPU 로 올리려면 VirtualGL 이
필요하고, 두 가지가 **둘 다** 있어야 한다:

1. TurboVNC 의 **`-vgl`** 옵션. (TurboVNC 3.x 는 `~/.vnc/xstartup.turbovnc` 를 보지 않는다 —
   시스템 스크립트를 쓰고 `-xstartup` 으로만 교체 가능하다. xstartup 을 건드리는 접근은
   통하지 않는다.)
2. **`VGL_DISPLAY=egl`**. 없으면 vglrun 이 기본 GLX 백엔드를 쓰는데 헤드리스 서버에는
   3D X 서버가 없어 **세션이 통째로 죽는다.**

**앱은 세션의 자식으로 실행돼야 GPU 를 쓴다.** 독/메뉴에서 띄우면 되고, SSH 로
`DISPLAY=:1 앱` 하면 소프트웨어 렌더링이다(VirtualGL 의 `LD_PRELOAD` 를 상속하지 못한다).
확인은 세션 안에서 `glxinfo | grep renderer`.

전송의 천장은 남는다 — VNC 에는 비디오 코덱이 없어 움직이는 화면은 정지영상 연사다.
NVENC 는 놀고 있다. 부드러운 3D 가 필요하면 그건 WebRTC(Selkies) 영역이다.

### 프론트

- **`resizeSession=true` 가 해상도 추적의 본체다.** `scaleViewport` 는 서버가
  `SetDesktopSize` 를 거부할 때의 폴백일 뿐 — 그것만으로는 흐릿하게 확대된다.
- **드래그 중 매 프레임 `SetDesktopSize` 를 보내면 서버가 프레임버퍼를 재할당하며 폭주한다.**
  250ms 디바운스 필수. 생성 해상도도 pane 크기에서 계산한다(고정값이면 떴다가 리사이즈되는
  왕복이 매번 생긴다). devicePixelRatio 는 곱하지 마라 — 원격 프레임버퍼만 커진다.
- pane 은 **`mode: 'vnc'`** 를 쓴다. tab-state sanitize 가 비터미널 pane 을 보존하므로
  새로고침 복원이 그대로 동작한다.
- **pane 을 옮길 때 필드를 골라 담지 마라.** 원본을 통째로 옮기고 슬롯 고유값(`id`)만
  덮어쓴다. 화이트리스트 방식은 새 속성이 생길 때마다 조용히 떨어뜨린다 —
  `mode`/`display` 가 떨어져 VNC pane 이 터미널로 변한 적이 있다.
- noVNC 는 **lazy import**. 수백 KB 라 시작 번들에 들어가면 안 된다.

### 작은 pane 은 데스크탑의 크기를 정하지 않는다 (2026-08-06)

**원격 해상도를 따라갈지는 pane 실측 크기로 판정한다**(`shouldFollowPaneSize`,
1024x600 미만이면 통보 안 함). 처음엔 `isPhoneViewport()` 로 판정했는데 **폰을
가로로 돌리면 844px 라 "폰이 아님" 이 된다** — 데스크탑을 보려고 돌리는 바로 그
순간이다. 그래서 pane 크기가 `SetDesktopSize` 로 나가 데스크탑이 폰 크기로 줄고
창·패널이 잘렸다. 그 해상도는 **세션에 남아** 나중에 PC 로 봐도 잘린 채다.
"모바일에서 VNC 화면이 다 잘린다" 의 근원이 이것이었다.

- 측정 전(0x0)도 통보하지 않는다 — 모르는 값으로 데스크탑을 줄이면 안 된다.
- 생성 해상도도 같은 규칙(`computeCreateGeometry`) — 작은 pane 에서 만들면 실측
  대신 `1280x800`.
- **이미 줄어든 세션은 클라이언트가 못 되돌린다**(창 배치가 원격에서 이미 잘렸다).
  설정 모달이 현재 해상도를 보여주고, 데스크탑 크기 미만이면 종료 후 재생성을 안내한다.

보기 모드(`settings.vncViewMode`)로 큰 화면을 다룬다:

| 모드 | noVNC 플래그 | 쓰임 |
|---|---|---|
| `fit` (기본) | `scaleViewport` | 통째로 축소 — 전체 배치 보기 |
| `pan` | `clipViewport` + `dragViewport` | 1:1 픽셀 + 끌어서 이동, 탭은 클릭 |

- **적용 순서가 규칙이다.** noVNC `_updateClip` 은 "Scaling trumps clipping" 이라
  `scaleViewport` 가 켜진 동안 들어온 `clipViewport=true` 를 **무시한다**. 항상 끄는 쪽을
  먼저 대입할 것 — `applyVncViewMode` 가 그 순서를 갖고 있고 테스트가 순서까지 검증한다.
- **중간 배율(핀치 줌)은 공개 API 로 안 된다.** `scaleViewport` 는 "맞춤" 뿐이고 임의 배율은
  `rfb._display.scale`(비공개)이다. CSS `transform: scale()` 도 안 된다 — noVNC 는
  `getBoundingClientRect` 로 포인터 좌표를 잡고 자기 내부 scale 로만 나누므로 클릭 위치가
  배율만큼 어긋난다.

### 컨트롤은 화면에 없다 — 탭 메뉴 → 설정 모달

원격 데스크톱은 **화면 자체가 콘텐츠**다. pane 위의 컨트롤 레일은 데스크탑을 가렸고
폰에서 누르기도 나빴다. 지금은 pane 위에 아무것도 없다:

```
탭(서브탭) 메뉴 "VNC 설정" → emitVncControl(paneId, {openSettings}) → VncPane 이 모달을 연다
```

- pane `…` 메뉴에 넣을 수 없다 — **VNC pane 은 `TerminalHeader` 를 렌더하지 않는다**
  (`Pane.jsx` 의 `!isVnc`). 그래서 메뉴는 탭바/서브탭바 쪽이고, 멀리 떨어진 pane 까지는
  `vncControlBus` 의 window CustomEvent 로 닿는다(`iterm:open-file` 과 같은 패턴).
- **선택 즉시 살아있는 RFB 에 적용하고 저장은 그 뒤에 한다.** 예전엔 설정 PUT(600ms
  디바운스)이 돌아와야 화면이 바뀌어서 "반응이 느리다/안 먹는다" 로 보였다.
- VNC pane 에서는 **모바일 하단 키바와 빠른 입력을 띄우지 않는다** — 터미널 세션이 없어
  키를 받을 곳이 없다(누르면 영영 로딩).
- `MenuItem` 은 별도 파일이다. `VncMenuItems` 가 그것을 쓰고 `TabBarMenus` 가
  `VncMenuItems` 를 쓰므로, 한 파일에 두면 순환 import 로 조용히 undefined 컴포넌트가 된다.

### 로컬(이 서버 자신)도 대상이다

`host_id` 로 **`local` 예약어**를 받는다(`routes/vnc.py` 의 `LOCAL_HOST_ID`). DB 에 없는
가상 호스트이고 소유권 검사도 하지 않는다 — 로그인한 사용자는 이미 이 서버의 셸을 쓸 수
있다(터미널 pane 이 그것이다).

로컬이 **가장 단순하고 가장 빠르다.** 백엔드가 도는 기계가 곧 대상이라 SSH 채널도 터널도
없이 `asyncio.open_connection('127.0.0.1', port)` 로 끝난다. 디스커버리도 서브프로세스로
같은 명령을 돌린다 — **명령 문자열은 원격과 동일하게 유지**해야 한다. 파서가 하나뿐이라
여기서 갈라지면 두 경로가 어긋난다.

⚠️ **컨테이너 배포에서 `local` 은 컨테이너 자신이다.** 이미지에 VNC 가 없으므로(Dockerfile
확인) 로컬 원격 데스크톱 버튼은 **홈 진입 시 한 번 조회해서 실제로 있을 때만** 그린다.
없으면 버튼 자체가 안 뜬다. 원격 호스트는 SSH 를 타야 알 수 있어 매번 프로브할 수 없다
(클릭 시 조회) — 로컬만 SSH 없이 한 번에 알 수 있어서 자동 감지가 가능하다.

이 판정은 **`hooks/useLocalVncAvailable` 하나**가 갖는다(모듈 레벨 캐시 → 조회 1회).
호스트 카드를 그리는 화면이 둘(App 홈 · 빈 pane 의 `EmptyPane` 홈)인데 App 쪽에만 값이
있어서 **폰에서 빈 pane 으로 들어가면 로컬 원격 데스크톱 아이콘이 안 뜨는** 버그가 있었다
(폰의 기본 동선이 빈 pane 홈이라 폰에서만 없는 것처럼 보였다). 홈을 그리는 곳이 늘어나면
프로브를 복사하지 말고 이 훅을 써라.

### 미설치 호스트에는 설치법을 보여준다

"없다" 로 끝내면 다음에 뭘 할지 모른다. `/etc/os-release` 의 ID 로 배포판을 감지해 실제
명령을 띄운다(계열마다 패키지명이 다르다 — `tigervnc-standalone-server` /
`tigervnc-server` / `tigervnc`).

`/usr/share/xsessions/` 유무도 같이 본다. **VNC 만 깔고 데스크탑이 없으면 세션이 뜨자마자
죽는다** — TigerVNC 는 세션 스크립트가 끝나면 서버를 같이 내리기 때문이다. 실제로 겪은
실패라 안내에 함께 띄운다.

### 비밀번호 설정

경고만 띄우고 고칠 방법을 안 주면 안 된다. 피커의 경고 바로 아래에서 설정한다
(`POST /api/hosts/{id}/vnc/password`). 설정하면 백엔드가 `~/.vnc/passwd` 유무로 보안
타입을 정하므로 이후 세션이 자동으로 VncAuth 가 되고 클라이언트 입력 폼이 이어받는다.

- **비밀번호는 stdin 으로만 넘긴다.** 명령줄 인자로 주면 원격의 `ps` 에 그대로 보인다.
- 우리 DB 에 저장하지 않는다. 호스트의 passwd 파일이 유일한 보관처다.
- **6~8자로 제한한다.** 고전 VNC 인증은 8자까지만 쓰고 초과분을 조용히 자른다 — 긴
  비밀번호를 넣고 "설정됐다" 고 믿게 두면 안 된다.

### 화질 컨트롤은 접이식이다

원격 데스크톱은 **화면 자체가 콘텐츠**다. 컨트롤을 상시 띄우면 데스크탑을 가린다.
우측 가장자리 손잡이를 눌러야 펼쳐진다.

pane `…` 메뉴에 넣을 수 없다 — **VNC pane 은 `TerminalHeader` 를 아예 렌더하지 않는다**
(`Pane.jsx` 의 `!isVnc`). 터미널 전용 크롬이 VNC 에 의미 없고 30px 레일 없이 캔버스가
전체를 채우도록 일부러 뺀 구조다.

### 검증 방법

**브라우저 없이 프로토콜까지 확인할 수 있다.** 토큰 생성 →
`POST /api/ws-ticket {"path": "/ws/vnc/{host_id}"}` →
`websockets.connect(url, subprotocols=['binary'])` → `ws.subprotocol` 과 첫 프레임
(`RFB 003.008` 이어야 한다)을 확인. 위 서브프로토콜·스트림 오염 버그를 둘 다 이걸로 잡았다.

⚠️ **실행 중인 앱에 브라우저(Playwright 등)로 붙지 마라.** 같은 계정이면 탭 복원이
사용자가 쓰고 있던 tmux 세션을 가져간다. 브라우저 레이어 확인이 꼭 필요하면 사용자에게
직접 열어보게 하라.

## LLM 사용량 (2026-08-06)

홈 대시보드의 토큰·비용 구획. **에이전트가 남긴 로그를 우리가 직접 읽는다** —
LLM API 는 여전히 아무 데서도 부르지 않는다(아키텍처 규칙 그대로).

**상주하는 것이 없다.** 호스트마다 컨테이너를 띄우는 대신 수집기를 그때그때 SSH stdin
으로 밀어 원격에서 한 번 실행한다. 설치 0, 포트 0, 이미지 갱신 0, 버전 드리프트 0
(스크립트가 항상 이 백엔드에서 나가므로 원격이 낡을 수 없다).

```
로컬  llm_usage.collect.collect(days)            # 그냥 import
원격  run_remote_cmd(host, "python3 - 30", stdin_data=collect.py 전문)
```

| 모듈 | 담당 |
|---|---|
| `llm_usage/collect.py` | 로그 → 토큰. **stdlib only 단일 파일**(stdin 으로 통째로 나간다) |
| `llm_usage/runner.py` | 로컬/원격 실행 + 마커 기반 stdout 파싱 |
| `llm_usage/pricing.py` | 모델 → 단가. **비용을 곱하는 곳은 여기 하나뿐** |
| `llm_usage/aggregate.py` | 행 → 그룹·비용·세션 목록. 순수 함수 |
| `llm_usage/service.py` | 수집 + 캐시(성공 24h / 실패 3h) + 스위치 |

### 규칙과 함정

- **수집기는 추출만 한다.** 단가는 백엔드가 붙인다 — 표가 원격 스크립트에 있으면
  호스트마다 다른 표로 계산된 값이 섞여 들어온다.
- **claude**: 같은 응답이 resume/fork 로 여러 파일에 실린다 → `(message.id, requestId)`
  전역 dedup(ccusage 의 규칙만 가져왔다). 제목은 `ai-title` 줄에 그대로 있다.
- **codex**: `token_count` 는 **누적값**이다. 그냥 더하면 세션 길이의 제곱으로 부푼다 —
  직전 누적과의 델타만 얹는다. `input_tokens` 는 캐시분을 포함하므로 빼준다.
- **opencode**: `session` 테이블에 비용·토큰·제목이 이미 있다. `model` 칸이 JSON 이라
  그대로 두면 같은 모델이 여러 줄로 갈라진다. **비용은 그쪽 값이 우리 표를 이긴다.**
- **세션 목록은 잘라 보내도 개수는 자르지 않는다**(`session_count`). 화면의 "세션 수" 가
  전송 상한에 걸려 조용히 작아지면 그건 틀린 숫자다.
- 표에 없는 모델은 **0 이 아니라 "모름"** 이다(`rate_for` → None). 0 으로 채우면 "안 썼다"
  와 구별되지 않는다.
- 정액제면 이 비용은 청구액이 아니라 **정가 환산**이다 — 화면에도 그렇게 적는다.
- ccusage 를 쓰지 않은 이유: Claude Code 전용(codex/opencode 누락), 호스트마다 node 필요,
  `npx` 는 실행마다 네트워크 — "호스트마다 설치·갱신" 문제가 도커에서 npm 으로 바뀔 뿐이다.

### 옵트인

설정의 스위치 하나(`LLM_USAGE_ENABLED` env 가 이기고, 없으면 DB). **꺼져 있으면 로그
파일도 안 읽고 SSH 도 안 건다.** 폴러가 없어 대시보드를 열 때만 움직이고, 새로고침을
눌러야 캐시를 무시하고 다시 훑는다.

### 호스트를 지워도 사용량은 남는다 — 은퇴 후 보관 (2026-08-10)

호스트 삭제가 곧 통계 삭제면 지난 비용이 되돌릴 수 없게 증발한다. 반대로 영영 남기면
대시보드에 없는 호스트가 계속 뜬다(실제로 그렇게 쌓였다). 그 사이를 이렇게 나눈다:

- `DELETE /api/hosts/{id}` 는 `llm_usage_source.retired_at` **도장만 찍는다.** 데이터는 그대로.
- 화면에는 "삭제된 호스트 · N일 후 정리" 로 계속 보이고, 기다리기 싫으면 즉시 삭제 버튼.
- **폴러는 없다.** 대시보드를 열 때 만료분만 한 번 훑어 지운다(이 모듈의 "상주하는 것이 없다").
- **수집에 성공하면 은퇴가 풀린다.** 살아 돌아온 소스에 도장이 남아 있으면 조용히 지워진다.
- 은퇴는 **멱등**이다. 두 번 지워도 시계가 다시 돌지 않는다(보관 기간이 무한정 밀린다).
- purge 는 `llm_usage_daily`·`llm_usage_session`·`usage_sessions` 를 **한 트랜잭션**에서 지운다.
  한 표에만 남으면 유령보다 헷갈린다.

⚠️ **보관 기간은 화면이 보여줄 수 있는 가장 긴 창보다 짧으면 안 된다.** 30일이던 시절엔
90일·전체 범위를 열어도 지워진 호스트 몫이 이미 없어서 **합계가 말없이 줄었다.** 지금은
`_RETENTION_FLOOR_DAYS = max(ALLOWED_DAYS)` 로 하한을 코드가 강제한다(기본 365일,
`LLM_USAGE_RETENTION_DAYS` 로 조정하되 하한 아래로는 안 내려간다). 범위를 추가하면 하한도
따라 올라간다 — 상수 둘이 각자 놀지 않게.

⚠️ **삭제 API 는 은퇴한 소스만 받는다.** 예전 검사는 "등록된 호스트면 거절" 이었는데
`local`(이 서버) 은 hosts 테이블에 없어서 그대로 통과했다 — URL 하나로 이 서버의 전 기록이
지워졌다(적대적 리뷰 중 실제로 밟았다). 살아 있는 소스를 지워봐야 다음 수집이 다시 채우니,
"은퇴한 것만" 이 이 버튼의 의미이자 안전장치다.

## 대시보드 표면 — 주사선과 유리는 한 세트 (2026-08-06)

홈 캔버스에 주사선(`styles/textures.js` `canvasTexture`)을 깔고 그 위에 유리 카드
(`styles/dashboardCard.js`)를 얹는다. **하나만 떼면 둘 다 의미를 잃는다** — 평평한 배경
위의 유리는 뭉갤 것이 없어 "그냥 투명" 해 보이고(한 번 되돌린 적 있다), 유리 없는 주사선은
그냥 배경 무늬다.

- 주사선 잉크는 **테마 글자색**(`var(--ui-text)`)이다. 검정은 어두운 테마에서 배경과 3 RGB
  차이라 안 보이고 밝은 테마에선 지저분하다. 글자색이면 다크=밝은 선, 라이트=어두운 선.
- `texture: 'flat'` 테마(e-ink)에는 깔지 않는다 — 질감의 **부재**가 그 테마의 정체성이다.
- 카드 그림자·하이라이트에 흰검을 박지 않는다. crust/text 에서 뽑아야 라이트 테마에서도
  성립한다. blur 는 `--glass-blur-card`(모바일에서 작게 override — backdrop-filter 는 비싸다).
- 카드 면의 정의는 `dashboardCard.js` **하나뿐**이다. 타일·막대·차트가 각자 그리면 농도가
  어긋난다.

**`tokens.fontSize` 에 없는 키를 쓰면 글씨가 커진다.** `fontSize['10.5']` 같은 키는
undefined 를 내고, undefined 인 fontSize 는 무시되어 **상속 크기(글로벌 CSS 가 없으므로
브라우저 기본 16px)** 로 렌더된다 — 작게 하려던 보조 라벨이 화면에서 가장 큰 글씨가 되는데
에러는 어디에도 안 난다. `styles/tokens.fontSize.test.js` 가 소스를 스캔해 막는다.

**한 동작은 한 자리에만 둔다.** 탭바 레일과 설정 메뉴에 같은 항목(패널 균등 분할)이 둘 다
있으면 어느 쪽이 진짜인지 매번 고민하게 되고, 자주 안 쓰는 동작이 레일 폭을 상시로 먹는다.

## Frontend derivation utils

Pure derivations that used to live inline in `App.jsx` are extracted to `utils/` with their own tests, because **App.jsx has no render test** — logic left inside it is untested. `tabsWithMeta` (per-tab name/icon/color/persistence, following the active pane's identity) is now `tabModel.deriveTabMeta`; extension→Monaco language is `fileTypes.monacoLanguageForFile`. When thinning App, move the pure part out and test it there rather than trusting the whole component to be exercised.

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

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

## Deploy (host systemd)

⚠️ **`deploy/local-deploy.sh` 는 저장소에 없다.** `.gitignore` 에 있는 메인테이너 기계
전용 스크립트라, **클론한 사람에게는 존재하지 않는 명령**이다. 아래 두 갈래를 구분할 것 —
예전에는 이 절이 그 스크립트만 가리켜서, 클론한 사람의 에이전트가 없는 파일을 실행하려다
막혔다.

### 누구에게나 통하는 방법 (클론한 저장소의 표준)

```bash
git pull
cd frontend && npm ci && npm run build && cd ..   # 프론트가 바뀌었으면
sudo systemctl restart iterminallist.service      # 백엔드/의존성이 바뀌었으면
```

**순서가 규칙이다: 프론트 빌드가 재시작보다 먼저.** 백엔드가 `backend/static` 을 그대로
서빙하므로, 재시작을 먼저 하면 낡은 번들을 그대로 다시 들고 뜬다.

⚠️ 프론트를 다시 빌드하면 **해시가 붙은 옛 청크가 지워진다**(`emptyOutDir: true`). 그때
열려 있던 브라우저 탭은 낡은 번들이라 필요한 순간에 404 를 맞고 자가 새로고침한다 —
[[feedback_batch_deploys_while_user_works]]. 사용자가 쓰는 중이라면 배포를 모아서 한 번에.

### 이 dev 박스에서만

메인테이너 기계에는 위 절차를 감싼 `deploy/local-deploy.sh` 가 있다(`--auto` 가 기본:
프론트를 빌드하고, backend/deploy 파일이 바뀌었을 때만 재시작). 그 기계에서는 그걸 쓴다 —
`--frontend-only` / `--restart` / `--status`. **다른 기계에서는 위의 표준 절차를 쓸 것.**

Service name: `iterminallist` (defined in `deploy/iterminallist.service` — 이건 배포된다).

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

## 에디터 상태의 키는 **fileKey** 다 — path 가 아니다 (2026-08-25)

원격 파일을 열면 **에디터가 빈 화면**이었다. 읽기는 200 이고 내용도 왔는데 아무것도 안 그려졌다.

`FileEditor` 의 `fileStates` 는 전부 `activeFile`(= fileKey, 원격이면
`remote:<hostId>:<path>`)로 읽고 쓴다 — 저장·편집·닫기·diff 전부. 그런데 **`loadFile` 만**
`parseFileKey` 로 뜯은 `path` 로 저장했다.

- **로컬은 `fileKey === path` 라 우연히 맞는다.** 그래서 이 버그는 원격에서만 난다.
- 원격은 쓴 자리(`/home/u/a.py`)와 읽는 자리(`remote:h1:/home/u/a.py`)가 달라 영영 못 만난다
  → `content: ''` → 빈 화면.
- 게다가 "아직 안 읽었다"(`!fileStates[activeFile]`)가 **영원히 참**이라 5초마다 SSH 왕복을
  다시 태웠다. 로그에 5초 간격이 줄줄이 찍혀 있으면 이 병을 의심할 것.

⚠️ **일반화: 같은 상태를 두 이름으로 키잉하지 마라.** 한쪽이 다른 쪽의 접두사 없는 부분집합이면
테스트도 로컬 경로에서 통과한다 — 원격 경로 하나를 반드시 같이 테스트할 것.
`FileEditor.test.jsx` 의 "원격 텍스트 파일의 내용을 실제로 보여준다" 가 그 선이고, Monaco 목이
**value 를 실제로 그려야** 이 테스트가 의미를 갖는다(빈 목이면 빈 화면을 못 본다).

### 원격 파일 폴링은 로컬과 같은 주기일 수 없다

외부 변경 감시는 **폴 하나가 SSH/SFTP 왕복**이다. 로컬(5s)과 같은 값을 쓰면 파일 하나당
분당 12회가 그 호스트로, 공유 터널을 타고 나간다. 지금 원격은 **30초**이고, 탭이 보이지
않으면(`document.hidden`) 아예 멈춘다.

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
- ⚠️ **SSE 는 그 뒤 티켓 방식으로 되돌아왔다** (`useWorkspaceTabs.js` 의 NOTE 참고 —
  쿠키 폴백으로 바꾸자마자 SSE 폭주가 재발했다). 백엔드는 여전히 ticket-or-cookie 를
  받지만 프론트는 티켓으로 연결한다. 실측(7일)에서도 `POST /api/sse-ticket` 306회 ≒
  SSE 연결 304회로 1:1 이다. 즉 **이 문단의 "새 클라이언트는 티켓을 안 부른다" 는
  raw-file 에만 해당한다.**
- Ticket endpoints stay for backward-compat with cached clients; the raw-file client
  doesn't call them.

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

## tmux 바인딩은 tmux 기본을 따른다 (2026-08-27)

물어야 할 것은 **"alt-screen 인가" 가 아니라 "이 앱이 마우스를 원하나"** 다.

```
tmux 3.4 기본:  if -F "#{||:#{pane_in_mode},#{mouse_any_flag}}" { send -M } { copy-mode -e }
```

`alternate_on` 으로 가르면 less·man 처럼 **alt-screen 이면서 마우스를 안 쓰는** 앱에
휠을 던지고, 앱이 무시해서 아무 일도 안 일어난다.

**선택(드래그·더블·트리플 클릭)도 tmux 가 한다.** 한때 전부 unbind 했는데, `mouse on`
이면 xterm.js 는 이벤트를 tmux 로 넘기므로 unbind 하면 **아무도 선택을 처리하지 않는다**
— 드래그해도 아무 일이 없었다. 결과는 `set-clipboard on`(OSC 52)이 브라우저 클립보드까지
보낸다(`components/terminal/osc52Clipboard.js` 가 받는다).

- ⚠️ **명시적으로 되묶어야 한다.** `unbind-key` 는 서버 전역이고 그 상태가 남는다 —
  코드에서 unbind 를 그만두는 것만으로는 이미 풀린 서버에서 되살아나지 않고, tmux 에는
  "이 키를 기본으로 되돌려라" 가 없다.
- ⚠️ **명령 전체를 한 인자로** 넘긴다. `;` 를 argv 로 쪼개면 tmux 가 앞부분만 바인딩하고
  나머지를 버린다 — 더블클릭이 pane 만 고르고 복사는 안 하는 식으로 조용히 반쪽이 된다.
- ⚠️ **바인딩은 두 벌이다**: 로컬 `tmux_manager`, 원격 `host_manager` 부트스트랩.
- **copy-mode 안의 휠은 덮지 않는다** — tmux 기본이 이미 같다.
- **PageUp/Down 은 `alternate_on` 그대로.** 그건 마우스가 아니라 **키**다.
- 우클릭·가운데클릭은 계속 unbind — 우리 컨텍스트 메뉴가 있고, X11 선택 버퍼는 브라우저에
  없다. 이건 임베드라서 다른 것이지 실수가 아니다.
- 🔐 OSC 52 는 **쓰기만** 받는다. 읽기(`?`)는 원격이 사용자 클립보드를 훔쳐볼 통로다.

## 지우면 지워져야 한다 — 브리지가 되살리지 않게 (2026-08-27)

원격 브리지는 세션이 사라진 것을 보면 `create=1` 로 **다시 만든다.** 호스트 재부팅
복구를 위한 장치인데, 사용자가 **직접 지운** 경우엔 정반대로 작동한다 — 우리 쪽에서
죽인 것과 저절로 사라진 것은 겉으로 구별되지 않는다.

→ `session_tombstones`. 죽인 쪽이 표를 남기고, 붙으러 온 소켓은 **붙기 전에** 닫힌다.

⚠️ **`create` 만 끄면 안 된다.** 그러면 붙기는 하고 → 세션이 없으니 `session-gone` 이
나가고 → 클라이언트는 그걸 "새로 만들라" 로 읽어 `create=1` 로 다시 온다. 거절해도 그
고리가 계속 돌고, 무덤이 만료되는 순간 되살아난다. 그래서 `{"type":"session-terminated"}`
를 보내고 닫는다 — 클라이언트는 셸이 exit 했을 때와 같은 길로 가서 pane 을 닫는다
(`Terminal.jsx` `endedByServerRef` 가 그 뒤의 재접속을 끊는다).

⚠️ **무덤은 짧아야 한다(20s).** 붙는 것 자체를 막으므로 길게 두면 같은 이름으로 **새로
여는 것**까지 막힌다 — 호스트 기본 세션명(`mobile`)을 지운 직후라면 그 호스트가 안 열린다.
길 필요도 없다: 클라이언트가 멈추므로 덮어야 할 것은 이미 날아간 재접속 몇 개뿐이다.

⚠️ `force`(kill-server)는 표를 남기지 않는다 — "호스트 통째로 리셋" 은 다음 연결이 새
세션을 여는 게 맞다.

⚠️ **판정은 pane 단위다 — 탭 단위로 하면 섞인 탭에서 반드시 틀린다.** 점유 판정
(`claimedPrefixesByHost`)이 `tab.type !== 'host'` 면 곧장 빠져나가는 바람에 **로컬 탭
안의 원격 pane 이 통째로 누락**됐다. 쓰고 있는 rpi5 세션이 "이어할 수 있는 세션" 에
떴고, 종료하니 같이 죽었다. pane 은 자기 `hostId` 를 갖는다 — 이 저장소가 같은 자리에서
여러 번 밟았다([[project_tab_color_model]], [[project_tab_unwrap_sanitize]]).

⚠️ **그 목록의 `attached` 는 캐시하면 안 된다.** "이어할 수 있다" 는 *지금*에 대한
단언인데, 60초 캐시가 백엔드 재시작으로 잠깐 떨어졌던 순간의 `0` 을 들고 있었다.
리모트가 붙어 있으면 그 소켓으로 묻고 캐시하지 않는다(왕복이 없으니 캐시할 이유도 없다).

⚠️ **종료는 죽이기 직전에 다시 판정한다**(`host_tmux.assert_not_attached` → 409).
화면은 언제나 과거를 그리므로, 파괴적 동작의 안전 판정을 호출자의 스냅샷에 맡기면 안 된다.
붙어 있는 것을 **일부러** 죽이는 두 곳(세션 재시작 · 탭 닫기)만 `allow_attached` 를 든다.
그리고 재시작은 `recreate` 도 함께 든다 — 무덤을 남기면 **자기 재접속을 자기가 막는다**
(그게 "원격 세션 재시작이 오래 걸린다" 의 정체였다. SSH 는 실측 0.3초로 범인이 아니었다).

⚠️ 관련: **붙어 있는 세션은 "이어할 수 있는" 목록에 넣지 않는다**(`HomeSessions`).
붙어 있다는 건 쓰는 중이라는 뜻이고, 그걸 지우라고 내밀면 위의 되살리기와 정확히
부딪힌다. 열린 탭 판정(`isClaimedSession`)은 **이 브라우저의 탭**만 보므로, 다른 기기나
백엔드가 붙잡고 있는 것은 tmux 의 `attached` 플래그만이 안다.

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

## 종료·실패에는 상한이 있어야 한다 (2026-08-20)

로그 감사에서 나온 셋. 뿌리가 하나다 — **끝나지 않는 대기를 그대로 뒀다.**

### 재시작 23회 중 13회가 SIGKILL 이었다

`stop-sigterm timed out → SIGKILL` 이 반복되고 있었고, 그때마다 uvicorn 로그가
`Waiting for connections to close` 에서 멈춰 있었다(횟수까지 정확히 일치). 원인은
`shutdown()` 이 각 연결에 거는 `transport.close()` 가 **write buffer 를 먼저 비우는**
graceful close 라는 것 — 멈춘 피어(모바일 전환·포화된 터널)에 물린 터미널 WS 하나가
그 버퍼를 붙잡으면 `connection_lost` 가 영영 안 온다. 실측에서 걸린 태스크는 매번 1개였다.

- `uvicorn.run(timeout_graceful_shutdown=5)`. 실측: 15s+SIGKILL → **6s + 정상 종료**.
- SIGKILL 이면 lifespan 의 `finally` 가 통째로 날아간다(SQLite close, SSH/SFTP 풀).
  `main.py` 의 "강제 종료로 detach hook 이 못 돈 orphan usage row 정리" 는 그 상태를
  시작 때 청소로 덮고 있던 흔적이다.
- ⚠️ **`sftp_pool.close_pool` 의 `await conn.wait_closed()` 에는 상한이 없었다.** 이건
  lifespan **안**이라 uvicorn 의 graceful 상한이 이미 지난 뒤에 돈다 — 여기서 막히면
  아무도 안 구해준다. 상한은 연결마다가 아니라 **전체에 한 번**(죽은 호스트 N 대면 N 배).
- 두 상한은 같이 움직인다: `graceful(5s) + POOL_CLOSE_TIMEOUT_SEC(3s) < TimeoutStopSec(15s)`.
  `tests/test_shutdown_is_bounded.py` 가 이 부등식을 잠근다.
- ⚠️ **배포마다 `ERROR: Exception in ASGI application` 이 한 번 찍힌다 — 정상이다.**
  끝까지 남는 그 "1 running task" 는 SSE 스트림(`/api/tab-state/events`)이고, 응답이
  끝나지 않는 요청이라 상한에 걸려 취소된다. 그 `CancelledError` 가 starlette 의
  streaming 미들웨어를 지나 ASGI 층에 보고되는 것뿐이다(마지막 줄이
  `Task cancelled, timeout graceful shutdown exceeded` 인지 보면 구별된다).
  **예전엔 안 보였던 이유는 그 시점에 프로세스가 이미 SIGKILL 당했기 때문**이지,
  안 일어나던 일이 아니다. 숨기지 않는다 — ASGI 예외를 통째로 삼키면 진짜 오류가 묻힌다.

### 실패를 캐시하지 않으면 죽은 호스트가 화면을 붙잡는다

`_fetch_host_tmux_sessions` 는 성공만 60초 캐시했다. 꺼진 호스트 하나가 조회 때마다
SSH connect timeout(15초)을 새로 태우고, batch 는 `gather` 라 그 15초가 **응답 전체**의
대기였다 — 홈의 "이어할 수 있는 세션" 이 열 때마다 15초씩 멈춰 있었다.
실측: 15.10s → 0.01s → 0.01s, `refresh=true` 는 15s(살아 돌아온 호스트용 탈출구).

**일반화: 느린 실패는 캐시하지 않으면 매번 같은 값을 다시 산다.** 실패 TTL 은 성공보다
짧게(살아 돌아왔을 때의 지연) — 이 둘이 상수 한 쌍이다.

### `_closed` 와 "소켓이 죽었다" 는 다른 사건이다

`ws_bridge` 가 소켓이 닫힌 뒤에도 계속 send 해 `Unexpected ASGI message 'websocket.send',
after sending 'websocket.close'` 를 매일 7건씩 쌓고 있었다(닫히는 순간의 pane 출력이
조용히 유실된다).

`on_readable` 이 `_closed` 를 전혀 안 봤다. send 하나가 실패해 `_closed` 가 서도 reader
루프는 그걸 **0.5초 주기로만** 확인하므로 remove_reader 까지 창이 남고, 실패한 flush task
는 이미 `done()` 이라 "돌고 있으면 안 만든다" 가드가 통과돼 **청크마다 새 task** 가
죽은 소켓에 send 했다(로그의 100ms 간격이 이것).

- 그래서 `_ws_gone` 이 `_closed` 와 **따로** 있다. `_closed` 는 PTY EOF(셸 exit)로도
  서는데 그때 소켓은 멀쩡하므로 **마지막 출력은 끝까지 가야 한다.** 하나로 합치면
  둘 중 하나가 반드시 깨진다 — 테스트가 양쪽을 다 잠근다.
- reader 루프는 `sleep(0.5)` 대신 `wait_for(_closed.wait(), 0.5)` 로 즉시 빠져나온다.
- ⚠️ reader 의 finally 에서 flush task 를 거둘 때 **`except Exception` 으로는 부족하다** —
  `CancelledError` 는 `BaseException` 이라 안 잡히고, 그게 새면 flush task 가 고아로 남아
  소켓이 닫힌 뒤에 send 한다. 이 finally 는 run() 이 cancel 해서 도는 자리다.
- `_ws_gone` 은 펌프를 **다 거둔 뒤에** 세운다. 그 전에 세우면 마지막 drain 이 버려진다.

### 원격은 리모트로만 간다 — SSH 로 찌르지 않는다 (2026-08-27)

⚠️ **설치할 때 넘기는 두 번째 인자는 tmux 소켓이지 세션 이름이 아니다.** 거기에
`remote_tmux_session`(예: `mobile`)을 넘겼더니 리모트가 `tmux -L mobile` 을 보고
**서버 없음**으로 판정해 pane 스트림이 아예 안 왔다 — 상태는 영영 "모름" 이고
배달·읽기는 셸 경로로 떨어져 거절됐다(실측: statusUnknown 15/15, read 502).
원격의 우리 세션은 **기본 소켓**에 산다(부트스트랩이 `-L` 없이 tmux 를 부른다).

⚠️ **`build_probe_cmd` 는 리모트로 보내지 않는다.** `||`·`{ }`·`exit` 를 쓰는 진짜 셸
구문이라 tmux 전용 통로로는 실행할 수 없다. 리모트가 붙어 있으면 그 답(존재·명령·타이틀)이
이미 스트림에 있으므로 거기서 낸다(`itl_remote.probe`). 채널이 자기 `host_id` 를 들고
있어서 호출부 시그니처는 그대로다.

⚠️ 허용목록 테스트는 **실제 빌더에서 명령을 뽑는다.** 손으로 적으면 빌더가 바뀔 때
테스트만 옛 문자열을 지키고 진짜 명령은 막힌 채로 남는다 — 그게 이 사고였다.

**가르는 기준은 "SSH 냐" 가 아니라 "얼마나 자주 부르냐" 다.**

| | 경로 |
|---|---|
| 되풀이되는 것 (상태 채우기·기다림) | **리모트만.** 없으면 `statusUnknown` |
| 화면 열 때 한 번 (실행중 보드) | 리모트가 있으면 그쪽, 없으면 SSH (`open_channel_on_demand`) |

⚠️ `open_channel_on_demand` 를 폴링 경로에서 부르면 그 구분이 무너진다. 새로 쓰기 전에
**"이게 반복되나"** 를 먼저 물을 것.

⚠️ 실행중 보드의 기계 값은 리모트가 **`/proc` 에서 직접 읽어** 보낸다. 셸로 받아오면
`run` 통로를 tmux 밖으로 넓혀야 하는데, 우리 코드가 이미 그 기계에 있으니 그럴 이유가 없다.
키 이름은 `parse_machine` 과 **똑같아야 한다**(snake_case) — camelCase 로 냈다가 화면이
못 읽어 메모리가 통째로 비었다(`cpus` 만 우연히 같아서 나왔다).

**기준이 하나다: 그 호스트에 리모트가 붙어 있나.** 붙어 있으면 상태·배달·읽기가 전부 그
소켓으로 가고, 아니면 안 된다. SSH 폴백은 **없다.**

없앤 이유는 경로가 둘이면 실패 방식도 둘이기 때문이다 — 어느 쪽으로 갔는지에 따라
지연도 오류도 달라져 진단이 매번 새로 시작된다. 그리고 없는 리모트를 SSH 로 대신하려면
**꺼진 기계를 찔러 15초를 태워야** 하는데, 그게 홈 화면을 멈춰 세우던 원인이었다
(`terminal_wait` 는 그걸 5초마다 했다).

- 리모트 없는 호스트의 pane 은 `statusUnknown` 이다. 결함이 아니라 **사실**이다 —
  우리가 볼 방법이 없다. 추측으로 채우면 `terminal_wait` 가 0초에 거짓 완료를 준다.
- 화면은 그 호스트에 **설치 버튼**을 내민다(호스트 목록의 ⤓). 경고색이 아니다 —
  안 깐 것은 선택이고, 여기서 말하는 것은 "할 수 있다" 다.
- 낡은 리모트는 **다시 설치해서** 고친다(상태에 `outdated`). SSH 로 숨기지 않는다.
- `tests/test_remote_channel.py` 가 리모트 경로에 SSH 관련 이름이 다시 들어오는 것을 막는다.

### 원격 상태는 밀려 온다 — 물어보지 않는다 (2026-08-27)

리모트가 붙어 있는 호스트는 pane 상태를 **스트림으로 밀어 준다**(`remote_agent/ingest`).
그래서 그 호스트에는 SSH 로 상태를 묻지 않는다(`_fill_remote_status` 가 리모트 있는
호스트를 먼저 빼고 나머지에만 왕복한다). `itl list` 의 원격 `?` 도 그만큼 사라진다.

`terminal_wait` 는 **서버가 붙잡는다**(`GET /api/itl/wait`). 예전에는 호출자가 2초(로컬)·
5초(원격)마다 다시 물었고 원격은 그때마다 SSH 왕복이었다 — 이 저장소가 토큰을 크게
태운 그 패턴이다. 지금은 상태가 바뀔 때만 깨어난다(`agent_status_events`).

- **한 번에 25초만 붙잡는다**(호출자 HTTP 상한 30초 안쪽). 더 기다려야 하면 이어 부른다.
  오래 매달린 요청은 이 저장소가 이미 겪은 고장이다(공유 HTTP/2 풀 wedge · iOS 진행바).
- ⚠️ 신호(`agent_status_events`)에 **내용을 싣지 않는다.** 깨어난 쪽이 다시 판정한다 —
  신호에 상태를 실으면 받는 쪽마다 판정이 생긴다(이 저장소가 파서 이중화로 여러 번 데었다).
- ⚠️ `asyncio.Event` 를 모듈 전역으로 두지 않는다. 처음 쓰인 루프에 묶여 다른 루프에서
  기다리면 죽는다. 기다리는 쪽이 자기 루프에서 future 를 만들어 등록한다.
- ⚠️ 완료 알림은 로컬과 **같은 함수**를 탄다(`_notify_completions` 에 소유자·발췌를 주입).
  두 벌로 만들면 중복 억제·소요시간 규칙이 조용히 갈라진다.
- ⚠️ 상태 맵의 키에 호스트를 붙인다. 원격 sessionId 는 그 호스트의 tmux 세션명이라
  호스트가 다르면 겹치고, 겹치면 한쪽 완료가 다른 쪽 지문을 덮어 알림이 사라진다.

### SSH 풀의 대기에는 전부 상한이 있다 (2026-08-27)

`ssh_pool.get()` 은 **per-host 잠금을 쥔 채** 연결을 연다. 거기서 멈추면 그 호스트로 가는
**모든 후속 요청이 잠금 뒤에 쌓인다** — 홈 화면이 tmux 세션 목록을 주기적으로 폴링하므로
폴링마다 태스크가 하나씩 영구히 늘었다(실측: 종료 시 `Cancel 97 running task(s)`).

⚠️ **멈춤은 예외가 아니라서 실패 캐시에도 안 걸린다.** `_fetch_host_tmux_sessions` 의
캐시는 예외에만 반응한다 — 상한이 있어야 멈춤이 예외가 되고, 그때 캐시가 받아 다음
폴링을 막는다. 캐시와 상한은 **한 세트**다.

- `SSH_POOL_CONNECT_SEC`(20) · `SSH_POOL_COMMAND_SEC`(20) · close 5s.
- `login_timeout`(20s)도 함께. `connect_timeout` 은 **TCP 까지만** 재고 인증 단계는
  asyncssh 기본이 **120초**다 — TCP 는 받아 주면서 인증에서 멈추는 호스트가 그 2분을 잡는다.
- 타임아웃은 `logger.warning` 으로 남긴다. 이 사고가 오래간 이유가 **조용해서**였다.

### 연결 반납은 `_release_connection` 만이 한다 (2026-08-27)

`db/*.py` 의 쿼리는 `_get_connection()` 으로 빌리고 **반드시 `_release_connection()` 으로
반납**한다. `conn.close()` 를 부르면 연결은 닫히지만 `_pool_size` 가 줄지 않고 큐에도 안
돌아간다 — 풀 크기(10)만큼 부르고 나면 그 다음 호출이 `_pool.get()` 에서 막힌다.

⚠️ 그 호출은 `asyncio.to_thread` 안에서 돌아 **실행기 스레드까지 잡아먹는다.** 그래서
한 함수의 반납 누락이 저장소를 쓰는 **모든 요청의 정지**가 된다. 실측: 반납을 빠뜨린
함수 하나(`get_host_cred_epoch`, itl 요청마다 호출된다)가 앱 전체를 세웠고, 종료 로그에
`Cancel 97 running task(s)` 가 남았다(정상값은 1 — SSE 스트림 하나).

- 풀 대기에는 상한이 있다(`SQLITE_POOL_WAIT_SEC`, 기본 10s). 같은 버그가 다시 나면
  **조용한 정지 대신 시끄러운 실패**가 된다. 상한을 없애면 그 진단 경로가 사라진다.
- `tests/test_sqlite_pool_leak.py` 가 `db/*.py` 를 훑어 직접 `conn.close()` 를 막는다.

## 로그는 "재접속했다" 가 아니라 "왜" 를 남긴다 (2026-08-20)

이 저장소의 버그는 거의 다 재연결에 있는데(memory `project_ws_reconnect_watchdog`,
`project_duplicate_connect_await_window`, `project_ws_ticket_wedge_cookie_fallback`),
로그에는 `WS attach: session=…` 한 줄뿐이라 사후 진단이 늘 추측이었다. **서버는 소켓이
다시 열린 것만 본다 — 무엇을 보고 다시 열었는지는 클라이언트만 안다.**

- 클라이언트가 `reason` / `prev_ms` 를 **핸드셰이크 쿼리에 얹어** 보낸다. 새 엔드포인트도
  새 왕복도 없다(이 저장소가 계속 줄여 온 쪽이라 그게 조건이었다).
- `backend/ws_observe.py` 가 그것을 `WS attach/detach` 두 줄로 옮긴다. `prev=` 가 짧으면
  요동, 길면 단발 끊김 — **원인이 다르므로 로그에서 구별되어야 한다.**
- ⚠️ **명시적 사유가 close 코드를 이긴다**(`reasonLockedRef`). 하트비트·워치독은 소켓을
  **스스로** 닫으므로 onclose 는 말끔한 `close-1000` 을 보고하는데, 그러면 "의심만으로
  멀쩡한 소켓을 죽였다" 는 사실이 묻힌다 — 그게 여기서 가장 재고 싶은 값이다.
- 낱말은 고정 어휘다. 프론트가 서버가 모르는 값을 보내면 전부 `other` 로 접혀 **에러 없이
  조용히 쓸모없어진다.** `tests/test_ws_observe.py` 가 Terminal.jsx 를 읽어 대조한다.
- 🔐 그 값은 클라이언트가 준 것이다. 인증·라우팅에 절대 쓰지 않고, 화이트리스트로 접어
  로그 injection(개행으로 가짜 줄 만들기)을 막는다.

**읽는 법**

| 보이는 것 | 뜻 |
|---|---|
| `reason=heartbeat prev=13s` 가 여러 pane 에 동시에 | 하트비트 오탐 또는 공유 터널 정체 |
| `reason=close-1006 prev=수백초` | 전송단에서 끊겼다 — cloudflared 로그와 시각 대조 |
| `reason=initial` 이 한꺼번에 | 부팅/복원 버스트지 끊김이 아니다 |
| `lived=` 가 60초 근처 반복 | `INACTIVE_PANE_GRACE_MS` 로 우리가 닫은 것(정상) |

### 그 줄이 보이려면 소음을 솎아야 한다

실측(7일): 앱 로그 34,478 줄 중 **17,663 줄이 access 로그 `200 OK`** 였고 `GET
/api/git/status` 하나가 4,851 줄이었다. `access_log_filter.py` 가 폴링의 **성공만**
솎는다. 규칙 둘, 둘 다 안전 방향이다:

- **2xx/3xx 가 아니면 무조건 남긴다** — 폴링 엔드포인트의 404·500 이야말로 가장 보고 싶은 줄.
- **경로 화이트리스트로만 솎는다.** 새 엔드포인트가 조용해지는 건 사고다.
- WS 핸드셰이크 줄은 절대 안 솎는다(attach/detach 와 짝을 이룬다). `ACCESS_LOG_QUIET=0` 로 끈다.
- ⚠️ **솎되 침묵하지 않는다** — 60초마다 "폴링 성공 N건 생략" 한 줄을 남긴다. 처음 판에는
  이게 없었고, 그 탓에 **업로드 실패를 진단할 때 "그 3분간 이 브라우저의 HTTP 가 살아
  있었나" 를 물을 수 없었다**(공유 HTTP/2 풀 wedge 는 이 배포의 단골 고장인데도).
  요약이 **끊기는 것** 자체가 "클라이언트의 HTTP 가 멈췄다" 는 증거다. 요약은 반드시
  **다른 로거**로 내보낸다 — `uvicorn.access` 로 쓰면 자기 필터를 다시 지나 재귀한다.

**일반화: 로그를 줄일 때는 "없어진 줄로 무엇을 못 묻게 되는가" 를 먼저 물어라.** 소음을
지우는 것과 신호를 지우는 것은 같은 동작이다.

⚠️ **낡은 클라이언트는 `reason=unset` 으로 찍힌다.** 브라우저가 새 번들을 받아야 사유가
붙는다 — 배포 직후 `unset` 이 섞이는 것은 정상이다.

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

한 pane 의 에이전트가 옆 pane(다른 기계 포함)을 부린다. **이 앱만의 주력 가치다.**
`backend/cli/itl` (stdlib only) + MCP(`cli/itl_mcp.py`) + `routes/itl.py`.
전문 — 주소 문법 표, 원격 배달, 자동 설치, MCP 도구 7종, 밟은 함정 전부: **[docs/notes/itl.md](docs/notes/itl.md)**

깨면 조용히 거짓말이 시작되는 것들만 여기 남긴다:

- **주소는 사람이 말하는 번호, 신원은 세션 ID.** pane 이 닫히면 번호가 밀리므로 호출
  시점에 세션으로 풀고 그 뒤로는 번호를 재사용하지 않는다. 사용자가 붙인 탭 이름은
  언제나 내장 그룹(`@working` 등)을 이긴다.
- **확인된 것만 delivered.** 원격은 `&& echo ITL_SENT` 표식이 없으면 `send-failed`.
  `conn.run(check=False)` 는 exit code 를 안 보므로 표식 없이는 "SSH 가 돌았다" 와
  "입력이 들어갔다" 를 구별할 수 없다.
- ⚠️ **"모름" 을 "일 안 함" 으로 세지 마라.** 원격 pane 의 status 는 워처가 못 봐서 비어
  있다. 빈 값을 만족으로 읽어 `terminal_wait` 가 0초에 "완료" 를 준 사고가 세 번 났다.
  상태 그룹 주소는 **매칭 전에** 상태를 채운다(`remote_status`).
- **원격 상태는 기본으로 채운다** — 거른 목록은 상태에 대한 단언이다. 옵트인이던
  이유(호스트당 SSH 왕복)는 리모트 전환으로 사라졌고, 꺼 두면 목록이 원격을 전부
  `?` 로 보여 **고장으로 읽힌다.** route·CLI·MCP 스키마·MCP 도구가 함께 움직인다.
- **세 곳이 함께 움직인다**: `routes/itl.py` · `cli/itl` · `cli/itl_mcp_tools.py`.
  skip 사유든 조회 인자든 한쪽만 늘리면 사용자 화면에 슬러그가 그대로 나온다.
- **호스트당 왕복 하나.** `_HostChannels` 가 상태 조회부터 배달까지 채널을 재사용하고,
  예산(`HOST_DEADLINE` 20s)을 나눠 쓴다. 백엔드 상한 < 호출자 상한(30s) 이어야 한다 —
  넘으면 **배달됐는데 실패로 읽혀 재시도가 중복 전송**된다.
- `--submit` 은 기본 off (vim/claude 안의 stray Enter 방지). `send-keys` 는 `--` 필요.
- 🔐 원격 tmux env 의 `ITL_TOKEN` 은 **사용자 전체 범위**다. 그 호스트에 셸이 있는 사람은
  그것으로 **다른 호스트의 pane 까지** 입력할 수 있다(배달이 백엔드 자격증명으로 일어나므로).
  새 호스트를 추가할 때 이 사실을 기억할 것.
- **stdout 은 JSON-RPC 전용**(MCP). `print()` 하나가 서버를 죽은 것으로 만든다.
- **핸드오프는 되묻지 않고 이어진다 (2026-08-25).** 배달되는 본문 앞에 **답장 명령**이
  붙는다(`[from … · 답장: itl send <보낸쪽 세션ID> '<답장>' --submit]`). 받은 에이전트가
  그걸 실행하면 `--submit` 때문에 보낸 쪽이 **즉시 깨어난다** — 폴링이 0이다.
  ⚠️ **보내는 쪽은 그 꼬리표를 볼 수 없다.** 그래서 `/send` 응답이 대상마다
  `reply: true|false` 를 실어 보내고, CLI·MCP 가 "답장 경로 전달됨 — 기다리지 마세요" 를
  적는다. 이 한 줄이 없으면 기능이 있어도 호출자가 `terminal_read` 반복을 고르고,
  그 되묻기가 **호출 한 번마다 컨텍스트 전체를 재청구**한다.
  ⚠️ **붙지 않았을 때도 말해야 한다** — 받는 쪽이 셸이거나 그 기계에 itl 이 없으면
  답장할 방법이 없는데, 그때 "답장이 온다" 고 적으면 오지 않을 답을 기다리게 된다.
- **`terminal_wait` 의 폴링은 그 사고와 다르다.** 루프가 MCP 프로세스 **안**에서 돌아
  얼마를 기다리든 컨텍스트 청구는 1회다. 비싼 것은 *에이전트가* 도구를 반복 호출하는 쪽.

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

### 진행바가 여전히 뜬다면 — 매달린 fetch 를 찾아라 (2026-08-14)

스트림을 워커로 옮긴 뒤에도 진행바가 **간간이** 20%쯤에서 멈춰 있었다. 워커가 안 도는 게
아니라, **끝나지 않는 요청이 하나 더 있었다**:

- ⚠️ **워커가 든 건 스트림뿐이다.** 그 앞의 `POST /api/sse-ticket` 은 여전히 **페이지가**
  쏜다(티켓 발급은 메인 스레드에 남긴다는 그 규칙의 대가다). 그리고 SSE 재연결마다 다시
  쏜다 — "간간이" 의 정체.
- 게다가 폴링 fetch(git status, cwd batch, tab-state, snippets…)에 **타임아웃이 하나도
  없었다.** 공유 터널이 깜빡이면(로그의 재연결 클러스터가 그 순간이다) 그 요청들은
  **영원히 매달린다.**

매달린 요청은 세 가지를 동시에 망가뜨린다: ① iOS 진행바가 붙박이가 되고(새로고침 말곤
탈출구 없음) ② wedge 된 HTTP/2 풀의 슬롯을 계속 물고 있어 **wedge 를 악화시키고**
③ promise 가 영영 안 풀려 **그 폴러가 조용히 멈춘다**(변화가 없는 것처럼 보인다).

→ `utils/apiFetch.js` — 기본 15초 마감시한. `timeoutMs: 0` 으로 예외(업로드·git push 처럼
길이가 정해지지 않은 것). SSE 티켓은 8초(어차피 재연결 사다리를 탄다).
`AbortSignal.timeout` 은 사파리 16+ 라 **AbortController 폴백이 있다** — 구형 iOS 가
정확히 워커 SSE 도 폴백하는 그 브라우저라 여기서 빠지면 안 된다.

**규칙: 배경/폴링 fetch 에 마감시한이 없으면 그건 버그다.** 실패는 호출부가 이미 다룰 줄
아는 상태다(직전 값 유지 + 다음 주기 재시도). 매달리는 것만이 다룰 수 없는 상태다.

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

## 원격 /tmp 은 "항상 쓸 수 있다" 가 아니다 — tmpfs 는 찰 수 있다 (2026-08-14)

한 호스트에서 이미지 붙여넣기가 `SFTP upload failed: Failure` 로 죽고, **같은 호스트에
붙어 있던 다른 에이전트 세션은 Bash 도구가 통째로 죽었다**(`echo ok` 가 exit 1, stdout
자체가 안 옴, `date > 파일` 은 파일만 만들어지고 내용이 비어 있음).

**원인 하나가 둘을 다 설명한다: 그 호스트의 `/tmp` 이 tmpfs 인데 가득 찼다.**

| 시각 | /tmp | 셸로 `date > /tmp/x` |
|---|---|---|
| 12:37 | 50G / 62G (81%), 스왑 8G/8G | **생성 실패** |
| 12:38 | 8G / 62G (13%) | exit=0 |

- **`touch` 는 되는데 쓰기만 실패한다** — 파일 생성은 inode 만 필요하고 쓰기는 데이터
  페이지가 필요하다. "파일은 생겼는데 비어 있다" 가 이 상태의 지문이다.
- **`df` 의 Avail 을 믿지 마라.** tmpfs 의 Avail 은 마운트 크기 한도지 실제 가용
  메모리가 아니다. RAM+스왑이 마르면 13G "여유" 로 보여도 쓰기가 ENOSPC 다.
- 에이전트 툴 레이어가 죽은 이유도 같다 — 명령 출력을 `/tmp` 임시 파일로 받아 읽는다.
- 그때 범인은 4일째 떠 있던 ComfyUI(RSS 39GB)였다. 스왑은 100%.

**진단 순서:** 원격 쓰기가 이상하면 `df -h /tmp` 와 `free -h` 를 **같이** 본다. tmpfs 면
`du` 합계와 `df` 사용량이 크게 어긋나는지도(= 삭제됐는데 열려 있는 파일) 확인한다.

⚠️ **일시적인 실패를 영구 결론으로 굳히지 마라.** `routes/files_write.py` 의 붙여넣기
폴더 캐시에 TTL(30분)이 있는 이유가 이것이다 — /tmp 가 회복되면 다시 /tmp 로 돌아가야
한다. 홈 폴백(`~/.iterminallist-paste`)은 재부팅에도 안 지워지는 자리다.

## 업로드가 막히는 것은 파일 문제가 아니다 — 그리고 WS 는 그때도 살아 있다 (2026-08-20)

원격 pane 에 이미지를 붙여넣었는데 실패했다. **서버에도 터널에도 요청 흔적이 0** 이었고,
새로고침하니 같은 이미지가 10초 만에 같은 호스트에 올라갔다. 파일도 그 호스트의 `/tmp` 도
멀쩡했다는 뜻이다 — 브라우저의 **공유 HTTP/2 연결이 막힌 것**뿐이다.

핵심 비대칭: **WebSocket 은 매번 새 TCP 라 그때도 멀쩡히 붙어 있다.** 그래서
"터미널은 되는데 업로드만 안 되는" 조합이 나오고, 새로고침(=새 연결 풀)이 즉시 낫게 한다.
[[project_ws_ticket_wedge_cookie_fallback]] 이 WS 에 대해 고친 그 문제의, 평범한 fetch 판이다.

네 가지를 한 세트로 고쳤다. 하나만 되돌리면 나머지가 다시 반쪽이 된다:

| 빈틈 | 규칙 |
|---|---|
| 실패하면 blob 을 버려 **다시 복사해 와야 했다** | `uploadWithRetry` 가 붙잡고 재시도(2·5·12·25s) |
| "업로드 실패" 만 말해 **파일·호스트를 의심**하게 했다 | `blocked` 를 따로 말한다 — "새로고침 후 재시도" |
| 막힌 길에 같은 fetch 를 한 번 더 쏴 **20초를 더** 태웠다 | 값싼 `/api/health` 프로브로 가른다 |
| 서버에 **아무 기록도 안 남았다**(요청이 안 갔으니) | 살아있는 **WS 로** 보고 → `log_client_error` |

- ⚠️ **보고를 HTTP 로 받으면 안 된다.** 알려야 할 상황이 바로 그 HTTP 가 막힌 때다.
  통로는 WS 하나뿐이고, 그래서 `client-error` 는 **로컬·원격 브리지 셋 모두**가 받아야
  한다(`ws_bridge` 1곳 + `host_manager` 2곳 — asyncssh/tailscale). 실제 사고가 원격
  pane 이었다 — 로컬만 받으면 바로 그 케이스를 놓친다.
- ⚠️ 제어 메시지는 **PTY 로 절대 흘리지 않는다**(처리 후 `continue`). 셸에 타이핑되면
  더 큰 사고다.
- 🔐 scope/kind 는 화이트리스트로 접고 detail 은 제어문자를 걷어낸다. 막을 것은 **새 줄을
  만드는 것**이지 문자열 검열이 아니다 — `detail=` 뒤에 남으면 그건 데이터다.
- `server`(서버가 답을 한 거절 — 원격 `/tmp` 가 찼다 등)는 **붙잡지 않는다.** 다시 보내도
  같은 답이라 60초를 더 두드리는 건 사용자 시간만 버린다. 재시도는 `blocked`/`offline` 만.

## Terminal paste destination (the rule)

**Pasted files land in `/tmp/iterminallist-paste/` on the machine the pane lives on.** Local pane → this server's `/tmp`; remote pane → that host's `/tmp`, over SFTP.

The host half matters: a remote pane given a *local* path gets a file its shell cannot open, and the paste looks like it succeeded. The frontend threads the pane's `hostId` through all four upload call sites (clipboard paste, right-click send-file, drag-drop, mobile quick-input attach).

Why `/tmp` and not the workspace: `WORKSPACE_ROOT` is the jupyterLab/notebooks directory in this deployment. Pasted images accumulating there pollute the notebook folder, and inside a git repo they get swept into commits. `/tmp` is writable on any POSIX host, needs no cleanup (cleared on reboot), and can never touch project files. Trade-off accepted: pastes do not survive a reboot and are not browsable in the file explorer. Override the local dir with `PASTE_DIR` if a deployment needs it.

Filenames are `<timestamp>-<random>-<safe-basename>`. **The timestamp alone is not enough** — dropping several files at once puts them in the same millisecond and the earlier upload is silently overwritten.

**Broadcasting an attachment to panes on different hosts uploads to each host.** One path cannot be valid on two machines, but the send already fans out per pane, so the path is swapped per pane too (`useImageAttach.resolveTextForTargets`). The image goes up once when pasted (to the focused pane's host, so the user sees a real path) and again per additional host at send time, cached so a host is never hit twice. If one host's upload fails, only that pane keeps the unusable path — the rest still send. When there is no attachment the send stays **fully synchronous**; adding an `await` to the common path costs perceptible latency.

## 붙여넣은 이미지의 토큰 — 바이트가 아니라 픽셀이다 (2026-08-24)

이 앱은 이미지를 pane 이 사는 기계의 `/tmp` 에 올리고 **경로만** 넣는다. 그 경로를
에이전트가 읽는 순간 비용이 생기고, 그 비용의 규칙은 파일 크기와 무관하다:

- API 는 **긴 변 1568 / 총 1.15M 픽셀**로 먼저 줄인 뒤 `w*h/750` 으로 청구한다.
  실측(이 저장소 트랜스크립트): **664KB PNG 와 8KB PNG 가 똑같이 1,533 tok**.
- 그래서 WebP 재인코딩은 **업로드 시간만** 아낀다(그건 그대로 가치 있다 — wedge 대응).
  그리고 긴 변 2048 → 1568 로 낮춰도 **절감은 0** 이다. 위 상한이 이미 걸리기 때문.
  실제로 줄이려면 **1.15M 픽셀 아래**로 내려가야 한다.
- ⚠️ **한 번 들어간 이미지는 그 세션이 끝날 때까지 매 요청에 다시 실린다.** 실측 38개
  세션에서 최초 242K 토큰이 **129M(533배)** 으로 재청구됐다(최악: 이미지 13장 → 요청
  1,386회 → 16.9M). **붙일 때 아낀 1토큰이 수백 배로 돌아온다** — 이 절의 근거 전부가 이것.

지금 동작(`components/terminal/terminalHelpers.js` + `utils/pasteImageOptimize.js`):

| 순서 | 무엇 | 왜 |
|---|---|---|
| 1 | 단색 여백 자동 크롭 | 축소와 달리 **글자 크기를 안 줄이면서** 픽셀만 뺀다 |
| 2 | 긴 변 **1024** 상한 | 레티나(2배) 캡처는 여기서 사실상 1:1 — 1999×1500 이 1,533 → 1,049 tok |
| 3 | WebP q0.85 재인코딩 | 바이트(업로드 시간)용 |
| 4 | 예상 토큰 표시 | 토스트와 빠른입력 하단에 `≈1,049 tok` — 비용은 **붙이는 순간에만** 조정 가능하다 |

- **크롭 판정은 썸네일(긴 변 64px)에서 한다.** 4K 붙여넣기를 원본 해상도로
  `getImageData` 하면 폰에서 33MB 를 잡는다. 되돌릴 때 여유 2px 을 준다.
- 모서리 색이 서로 다르거나 잘라낸 뒤가 원본의 5% 미만이면 **크롭을 포기**한다 —
  판정이 틀렸을 가능성이 높은 쪽에 건다.
- ⚠️ **예전 `blob.size < 768KB` 게이트가 가장 흔한 케이스를 통째로 빠뜨렸다.** 치수 상한은
  파일 크기와 무관하게 항상 적용해야 한다(재인코딩만 크기를 기준으로 판단한다).
- 디코드 못 하는 포맷(gif/svg)·`createImageBitmap` 없음 → `tokens` 는 **0 이 아니라 null**.
  0 으로 채우면 "안 든다" 와 구별되지 않는다(이 저장소의 "모른다고 적는 것이 기능" 규칙).
- 절감의 **상한은 잔존**이다: 이미지 한 장은 그 세션 내내 실려 나가므로, 이미지 작업이
  끝나면 `/clear`·`/compact` 로 컨텍스트를 비우는 것이 어떤 리사이즈보다 크게 아낀다.

## 토큰이 새는 곳은 도구 출력이 아니라 요청의 무게다 (2026-08-24)

7일 실측(요청 11,685회): 컨텍스트 재청구 **4.26G tok**, 그중 캐시 읽기 98.3%.
그런데 **도구 결과 총합은 1.3M tok(0.03%)** 이었다. 즉 출력을 줄이는 최적화는 값이 없고,
비용은 전부 "매 요청에 다시 실리는 무게" 다. 그 무게는 세션 길이를 그대로 따라간다:

| 요청 구간 | 평균 컨텍스트 |
|---|---|
| 1–50 | 91K |
| 201–500 | 317K |
| 501–1000 | 519K |
| 1000+ | **597K (6.5배)** |

상위 3개 세션이 7일 총액의 51% 였다. **따라서 가장 큰 절감은 "작업이 끝났으면 /clear"**
이고, 그걸 판단하려면 지금 요청 하나가 얼마인지 알아야 하는데 그 값은 세션 밖에서만 보였다.

- `~/.claude/hooks/context-weight.sh` (Stop 훅)가 임계(300K/500K/700K)를 넘을 때
  **한 번씩만** 알린다. 막지 않는다 — 끊을지는 사람이 정한다. 같은 임계로 두 번 말하면
  다음부터 안 읽힌다. 플릿 4대 공유.
- ⚠️ 셸에서 `case "${last:-0}" in` 은 **기본값을 검사에만 쓰고 변수는 빈 채로 둔다.**
  다음 줄의 정수 비교가 깨져 훅이 통째로 조용해진다(테스트가 이걸 잡았다).

### 이 저장소의 CLAUDE.md 자체가 고정 세금이다

이 문서는 **모든 요청에 동행한다.** 한때 46K tok 이었고, 그래서 이 저장소의 세션 시작
컨텍스트가 95~109K 로 다른 저장소(57~70K)보다 무거웠다. 2026-08-24 에 25K 로 줄였다 —
**버린 게 아니라 `docs/notes/` 로 옮기고 규칙만 남겼다**(itl · vnc · render-budget).

**새 사건을 적을 때의 규칙: 규칙과 함정은 여기, 서사는 `docs/notes/`.** 여기 남길 문장의
기준은 "이걸 모르면 되돌릴 수 있는가" 다. 왜 그렇게 됐는지의 이야기는 링크 한 홉 뒤에 둔다.

### 하루 한 번 요약은 서비스가 보낸다 (크론 아님)

`backend/usage_report.py` — 사용량 + 누수 신호(차단된 폴링, 죽은 세션)를 텔레그램으로.
크론이 아니라 이 프로세스가 보내는 이유: 수집기·세션 표·텔레그램 자격증명을 **이미 셋 다
들고 있다.** 크론 줄은 한 기계에만 살고 앱과 따로 논다.

- **할 말이 없으면 아무것도 안 보낸다.** 매일 "0" 이 오면 그 채널은 안 읽히게 된다.
- ⚠️ **`parse_mode` 를 절대 쓰지 마라** — 본문에 경로·명령 조각이 그대로 들어간다.
- ⚠️ **"모른다" 를 "0" 으로 접지 않는다.** tmux 서버가 죽었을 때의 빈 목록을 "죽은 세션
  0개" 로 읽으면 화면이 조용히 거짓말한다. `_dead_session_count` 는 그때 `None` 이다.
- ⚠️ **기본은 꺼짐이다(옵트인).** 이 알림은 텔레그램으로 나가고 그 방에는 pane 제목·비용·
  기계 이름이 실린다 — 묻지 않고 켤 수 없다. 처음 판은 기본이 켜짐이었고 **끄는 UI 도
  없어서**, 사용자는 원치 않는 알림을 받고도 끌 방법이 없었다. 스위치는 설정 → 텔레그램에
  있고, 저장 버튼 뒤가 아니라 **즉시** 반영된다("껐는데 또 왔다" 를 만들지 않는다).
- ⚠️ **가만히 있는 값을 매일 반복하지 않는다.** 쌓인 세션 기록처럼 어제도 오늘도 같은
  숫자는 임계(20)를 처음 넘을 때 한 번, 그 뒤로는 10개 이상 더 늘었을 때만 말한다.
  날마다 같은 줄을 보내면 그 채널은 곧 안 읽히고, 정작 진짜 신호가 묻힌다.
- ⚠️ **겁주는 문구는 신호가 아니라 소음이다.** "죽은 tmux 세션 45개" 는 세션이 날아간
  것처럼 읽혔지만 실제로는 정상 종료된 탭이 남긴 DB 기록이었다. 무엇을 잃었는지/안
  잃었는지를 문구가 말해야 한다.
- `USAGE_REPORT_ENABLED` / `USAGE_REPORT_HOUR` env 가 DB 설정을 이긴다(텔레그램과 같은 규칙).

### 죽은 세션 기록 정리

`POST /api/sessions/prune` — tmux 에 없는 `sessions` 행을 지운다(이 박스는 48행 중 45행이
죽어 있었고, 지우는 코드가 아예 없었다).

- ⚠️ **라우트 등록 순서가 곧 매칭 우선순위다.** `{session_id}` 뒤에 두면 "prune 이라는
  세션" 으로 읽혀 **정리 대신 세션을 만든다.** 반드시 앞에.
- ⚠️ **빈 tmux 목록은 "전부 죽었다" 가 아니라 "판정 불가" 다**(tmux 서버가 멈춘 모습과
  같다). 그 상태에서 지우면 전 행이 날아간다 — 409 로 거절한다.

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

## 렌더 상한 · 요청 곱셈 — 이 저장소의 성능은 거의 다 "몇 개가 도는가" 다

전문 — 발열 오진 이력, 하트비트 실측, 부팅 버스트, 배지 갱신, 중복 소켓:
**[docs/notes/render-budget.md](docs/notes/render-budget.md)**

- ⚠️ **`isActive` 는 "보고 있는 pane" 이 아니다.** 분할 그리드에서는 형제가 전부
  `isActive=true` 이고 `isFocused` 만 1개다. 새 게이트를 달 때 **"분할이면 몇 개가
  실행되는가"** 를 먼저 물어라 — 이 하나로 출력 렌더·하트비트·health 프로브 세 군데가
  동시에 틀려 있었다. `tab.activePaneId` 는 보장되지 않으므로(`|| panes[0]` 폴백)
  정확히 하나여야 하는 일은 `isFocused` 가 아니라 모듈 레벨 리스로 정한다.
- **출력 싱크의 코얼레싱 창이 곧 fps 다**(`createOutputSink.js`, 지금 20fps/12fps).
  리딩엣지라 조용하다 들어온 첫 바이트는 항상 즉시 그려지고, 창을 늘려도 늘어나는 건
  지속 출력의 병합 폭뿐이다 — **이 숫자는 입력 지연과 무관하다.** 60→30→20 으로 두 번
  내려왔고 아무도 차이를 못 느꼈다. 더 내리면 스크롤이 끊겨 보인다(바닥).
- **모든 탭의 `PaneGrid` 가 상시 마운트된다** → pane 단위 fetch 는 조용히 곱해진다.
  실측에서 `/api/git/status` 하나가 전체 HTTP 의 80% 였다. **캐시가 아니라 타이머를 공유**
  하고(`gitStatusStore`), 안 보이면 구독하지 않는다.
- **배지는 시계가 아니라 사건에 붙인다.** repo 는 시간이 흘러서 바뀌지 않는다 —
  터미널이 뭔가 써야 바뀐다.
- **부팅에서 줄일 것은 총량이 아니라 동시성이다**(티켓 배치 · 핸드셰이크 게이트 3개).
  ⚠️ 게이트가 새 교착이 되면 안 된다 — 슬롯을 못 받아도 2.5s 뒤엔 진행한다.
- ⚠️ **`connect()` 의 await 창에서는 `wsRef` 가 비어 OPEN/CONNECTING 가드가 안 걸린다.**
  중복 소켓이 서로를 죽여 영원히 "다시 연결 중" 이 된다. **await 를 추가하는 변경은 항상
  "그 사이 같은 일을 또 시작할 길이 있나" 를 동반해야 한다.**
- ⚠️ **폰이 붙으면 PC 화면이 짜부라진다** — tmux `window-size latest`. 그래서 모바일은
  아직 보지 않은 pane 에 **아예 붙지 않는다**(`skipInitialConnect`).

## Xvnc 원격 데스크톱 (2026-08)

호스트 카드 → Remote Desktop. **`Xvnc : GUI = tmux : 셸`** — 데스크탑이 호스트의 Xvnc
안에서 돌고 뷰어만 붙었다 떨어진다. 전송은 **SSH direct-tcpip** 라 호스트에 새 인바운드
포트를 열지 않는다. 이게 이 기능의 보안 경계다.
전문 — flavor 별 함정, 3D 가속, 모바일 터치패드, 검증 방법: **[docs/notes/vnc.md](docs/notes/vnc.md)**

| 모듈 | 담당 |
|---|---|
| `backend/vnc_discovery.py` · `routes/vnc.py` · `routes/vnc_ws.py` | 탐색 · 세션 · 바이트 펌프 |
| `frontend/src/components/vnc/` · `utils/vncResize.js` | noVNC(lazy chunk) · 리사이즈 판정 |

되돌리면 즉시 깨지는 것들:

- **`-localhost` 는 고정 문자열이다.** 빼면 VNC 가 인터넷에 그대로 노출된다.
  `ss` 로 `127.0.0.1:5901` 인지 확인할 것(`0.0.0.0` 이면 사고).
- **VNC 비밀번호가 막는 것은 그 호스트에 이미 셸 계정이 있는 사람뿐이다.** 실제로 조여야
  할 곳은 앱의 현관이다 — 앱이 뚫리면 VNC 도 같이 뚫린다.
- **WS 서브프로토콜(`binary`)을 골라줘야 한다.** 안 고르면 브라우저가 연결을 실패
  처리하는데 서버 로그에는 `connection open / closed` 로만 보인다.
- **VNC WS 로 제어 메시지(JSON)를 보내지 마라.** RFB 는 순수 바이너리다.
- **`ssh_pool` 을 쓰지 마라** — janitor 가 idle 로 보고 5분 뒤 끊는다. 전용 conn.
- ⚠️ **작은 pane 은 데스크탑 크기를 정하지 않는다**(`shouldFollowPaneSize`). 폰을 가로로
  돌리면 844px 라 "폰 아님" 이 되던 판정 때문에 데스크탑이 폰 크기로 굳은 적이 있다.
  **한 번 줄어든 세션은 클라이언트가 못 되돌린다.**
- **확대는 컨테이너 상자를 키워서** 한다. CSS transform 은 좌표가 배율만큼 어긋난다.
- ⚠️ **RFB 는 몰아친다 — 터미널용 타임아웃을 가져다 쓰면 안 된다.** 해상도가 바뀌면 전체
  프레임버퍼가 한 번에 오는데, send 상한이 5초(터미널 pump 에서 복사한 값)라 공유 터널에서
  멀쩡한 연결을 스스로 끊었다("해상도만 바꾸면 끊긴다"). 상한은 처리량이 아니라 **죽음**을
  재는 값이다(`VNC_SEND_TIMEOUT_SEC`, 60s).
- **화질은 사람이 고르는 값이 아니다 — 링크가 정한다.** 기본은 `auto`
  (`utils/vncAdaptiveQuality.js`): 버스트 구간의 실측 처리량으로 light↔balanced↔sharp 를
  오간다. **꼭대기에서 시작해 내릴 때는 한 번에, 올릴 때는 3회 동의+15초 쿨다운** —
  대칭으로 만들면 경계에서 진동하고 그게 가장 나쁘다. 사람이 프리셋을 고르면 그게 이기고
  적응은 멈춘다.
- ⚠️ **`qualityLevel` 은 선형 눈금이 아니다.** 서버가 실제 JPEG 품질로 옮긴다
  (TurboVNC: 3→42, 6→79, 8→92, 9→100). 기본 6 은 글자를 뭉갰다.
- ⚠️ **버스트 간격은 넉넉해야 한다 — 느린 링크일수록 메시지 간격이 벌어진다**(64KB 씩
  보내므로 1Mbps 면 0.5초). 짧게 잡으면 정작 재야 할 느린 링크만 영영 측정되지 않는다.

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

## 이북(전자잉크) 모드 — 스위치 하나, 세 겹 (2026-08-28)

전자잉크는 화면을 다시 칠하지 않고 **다시 쓴다.** 갱신 한 번이 100~300ms 에 잔상을
남기므로, 이 모드가 끄는 것은 장식이 아니라 **갱신 횟수**다. 켜는 곳은 둘 —
로그인 화면(즉시)과 설정 → 외양 맨 위(저장 버튼을 거친다).

**무엇을 덮는지는 `utils/einkMode.js` 한 곳이 정한다.** 세 겹:

| 겹 | 어디 |
|---|---|
| CSS | `styles/einkCss.js` — `html[data-eink="1"]` 아래 전환·애니·blur·그림자를 끈다 |
| 설정 | `EINK_SETTINGS_OVERRIDE` — smoothScroll·predictiveEcho·useWebgl off, 대비 original |
| 테마 | 흑백 `eink` 테마로 강제. pane 별 `themeOverride` 도 진다 |

- ⚠️ **사용자 설정을 덮어쓰지 않는다.** `applyEinkSettings` 는 *사본*만 낸다 — 그래서
  끄면 원래 테마·스크롤 값이 그대로 돌아오고, 설정 모달도 계속 진짜 값을 보여준다.
- ⚠️ **플래그는 React 마운트 전에 읽는다**(`main.jsx` → `readStoredEinkMode`). 첫 렌더
  뒤에 붙이면 이 모드가 없애려던 애니메이션 첫 페인트를 이미 한 번 치른 뒤다.
- **CSS 가 전부 `!important` 인 이유**: 유리·전환·그림자가 대부분 **인라인 스타일**이라
  (`glass.js`·`dashboardCard.js` 가 style 객체를 낸다) 특이도로는 못 이긴다.
- ⚠️ **blur 를 끄면 반투명은 그냥 "뒤가 비침" 이다** — 메뉴 뒤로 터미널 글자가 비쳐
  못 읽는다. 그래서 중립 면의 채움·테두리 비율이 var 를 지난다: **`var(--glass-fill, 34%)`**.
  이름은 **둘뿐이고**(`--glass-fill` · `--glass-line`) **각 자리가 자기 기본값을 fallback
  으로** 들고 있다 — 그래서 `:root` 기본값이 필요 없고, 이북 모드는 스위치 하나로 전부를
  불투명하게 만든다.
  - ⚠️ **액센트·위험색 틴트는 대상이 아니다.** 그건 이미 불투명한 면 *위에* 얹는 색이라
    100% 로 만들면 글자를 덮는 색 블록이 된다. var 를 지나는 것은 **중립 면**뿐이다
    (surface/base/mantle/crust).
  - `styles/glassFill.test.js` 가 소스를 훑어 리터럴 퍼센트를 막는다. 안 막으면 그 면만
    투명하게 남는데, **전자잉크 기기로 그 화면을 열어보기 전엔 아무도 모른다.**
- **가장 큰 절감은 코얼레싱 창이다** — `COALESCE_EINK_MS`(300ms, ~3fps). 30fps 로 밀어야
  패널이 못 따라와 잔상만 쌓인다. **리딩엣지는 유지**하므로 키 입력 에코는 여전히 즉시다.
- 커서 깜빡임은 `cursorBlink:false` 로 끈다 — 아무것도 안 하는 동안 초당 1~2회 전체
  갱신을 부르는, 이 앱에서 가장 비싼 장식이다.
- 누른 표시는 **남긴다**(움직이지 않는 방식으로 — inset outline). 전역 `:active` 의
  scale/brightness 는 합성에서 공짜지만 종이에서는 갱신 한 번이다.
- **모서리는 전부 직각**(`border-radius: 0`). 둥근 모서리는 안티에일리어싱된 곡선이고,
  회색을 디더링으로 그리는 패널에서는 그게 얼룩진 가장자리가 된다. 예외를 두지 않는다 —
  각진 상자들 사이에 둥근 것 몇 개가 남으면 스타일이 아니라 **렌더링 고장으로 읽힌다.**
- **주기 작업은 `einkPollMs()` 를 지난다**(`EINK_POLL_FACTOR = 4`). 폴 하나가 요청 하나가
  아니라 **React 상태 쓰기 하나**이고, 종이에서 그건 부르지 않은 화면 갱신이다. 지금
  걸린 곳: git status 스토어 · fleet · 시스템 통계 · 에디터 외부변경 감시.
  - ⚠️ **busy 틱(150ms)에는 걸지 않는다** — 한 번 걸었다가 되돌렸다. 그 틱은 `sameSet`
    으로 이전 값과 같으면 `prev` 를 그대로 돌려주므로 React 가 bail out 한다. 즉 초당
    6.7회는 *계산*이지 리렌더가 아니고, 늘려봐야 busy 점이 늦게 뜨는 손해만 남는다.
    **"자주 도는 타이머" 를 곧 "자주 그린다" 로 읽지 마라.**
  - ⚠️ **하트비트·워치독·재접속 사다리에는 절대 걸지 마라.** 그 값들은 처리량이 아니라
    **죽음**을 재는 값이라, 늘리면 끊긴 소켓이 1분의 침묵이 된다(위 재접속 절들 참고).
  - 모듈 레벨 타이머는 설정이 스코프에 없다 → `isEinkActive()` 가 `<html>` 에서 직접
    읽는다. prop 을 여섯 단계 내리는 대신. 대신 **이미 돌고 있는 타이머는 다시 안 잰다**
    (구독이 바뀔 때 반영된다).

⚠️ **`themeUI.js` 의 `mix()` 는 6자리 hex 만 받는다.** `parseInt('fff', 16)` 은 흰색이
아니라 `0x000fff`(파랑)다 — 라이트 테마의 muted/faint 가 회색 대신 남색으로 나오던 원인이고,
예외를 안 던지므로 **화면을 보기 전엔 알 수 없다.** `expand()` 가 막고
`styles/themeUI.test.js` 가 "검정·흰색에서 뽑은 톤은 무채색" 을 잠근다.

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

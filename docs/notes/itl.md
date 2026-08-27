# Terminal-to-terminal messaging (`itl`)

> CLAUDE.md 에서 옮겨 온 상세 노트다. **규칙 요약은 CLAUDE.md 에 남아 있고**,
> 여기에는 그 규칙이 왜 그런지(무엇을 밟았는지)가 들어 있다.
> 터미널 간 명령 전달(itl) — 주소 문법, 원격 배달, MCP, 자동 설치.


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
- `send-keys` needs `--` before the text, or a message starting with `-` dies as `unknown flag -x`
  — and `check=False` swallows it, so it simply never arrives.
- `--submit` is off by default. Text lands on the prompt and a human presses Enter; a stray Enter inside vim/claude executes something nobody asked for (same rule as terminal file drop).
- `ITL_TOKEN` is readable via `tmux show-environment`, so it is a **scoped** JWT (`scope: "itl"`). `verify_auth_token` rejects any token carrying a scope claim — a leaked ITL_TOKEN cannot read files or host secrets.
- **Remote panes are sendable** (2026-08-15). The backend does the SSH round trip with that
  host's stored credentials (`backend/itl_remote.py`), so the *caller* needs no key for that box —
  which is the whole point: a handle pasted to an agent elsewhere works without its own access.
  A dead remote session is `skipped: session-gone`, an unreachable host `host-unreachable`;
  neither is ever counted as delivered, and one dead host never fails the whole fan-out.
- ⚠️ **Quote every remote argument yourself.** `shlex.quote` leaves `=mobile-abc` bare (POSIX-safe),
  and a **zsh** login shell eats that as equals-expansion (`=foo` → path of `foo`) — the target
  arrives mangled and `has-session` quietly says no. Measured on a real host; `itl_remote._sq`
  always quotes. The local path is argv (no shell), which is why it never showed this.
- **A session ID is an address.** `resolve` matches it *before* splitting, so a session named
  `mobile.2` is not read as "tab mobile, pane 2". Numbers shift when a pane closes; an id does
  not — that is what a copied handle carries.

### 원격을 반쪽으로 두면 받은 쪽이 헤맨다 (2026-08-17)

원격이 "보낼 수는 있다" 까지만 되어 있으면, 그 위에 올라탄 흐름(핸드오프 → 기다림 → 답장)이
전부 조용히 거짓말을 한다. 넷을 한 세트로 고쳤다 — 하나만 되돌리면 나머지가 다시 거짓이 된다.

| 무엇 | 규칙 |
|---|---|
| 배달 | **확인된 것만 delivered.** 원격 명령 끝에 `&& echo ITL_SENT`, 표식 없으면 `send-failed` |
| 왕복 | **호스트당 연결 하나**(`itl_remote.RemoteChannel`), 호스트끼리는 병렬, `HOST_DEADLINE=20s` |
| 상태 | 원격은 **기본이 "모름"**(`statusUnknown`, 표에서 `?`). 물어볼 때만 호스트당 SSH 한 번 |
| 답장 | 받는 쪽에 `itl` 이 있을 때만 답장 명령을 적어 준다(probe 가 PATH/파일을 같이 본다) |

- ⚠️ **`conn.run(check=False)` 는 exit code 를 안 본다.** 그래서 tmux 가 거절해도 예외가 없고,
  표식 없이는 "SSH 명령이 돌았다" 와 "입력이 들어갔다" 를 구별할 수 없다. `;` 대신 `&&` 로
  잇는 이유도 같다 — 본문이 실패했는데 Enter 만 들어가면 프롬프트에 있던 것이 실행된다.
- ⚠️ **`run_remote_cmd` 는 호출마다 SSH 를 새로 연다**(풀 없음). 존재확인·pane 정보·전송을
  따로 부르면 대상 하나에 핸드셰이크가 3번이고, 팬아웃이면 그만큼 곱해져 호출자 타임아웃
  (CLI·MCP = 30s)을 넘긴다. 그러면 **배달은 됐는데 실패로 읽혀 재시도가 중복 전송**이 된다.
  백엔드 상한(20s)이 호출자 상한(30s)보다 작아야 하는 이유가 이것이다 — 둘은 같이 움직인다.
- ⚠️ **"모름" 을 "일 안 함" 으로 세지 마라.** 원격 pane 은 워처가 볼 수 없어 status 가 비어
  있고, `not_working` 판정은 빈 상태를 만족으로 읽는다 → `terminal_wait` 가 **0 초에 "완료"**
  를 돌려줬다. 원격에 일을 넘긴 에이전트가 결과 없이 다음 단계로 갔다. 지금은 원격이 섞이면
  `remote_status=1` 로 물어보고(폴 간격도 5s), 못 물어본 것은 만족으로 세지 않는다.
- 원격 **읽기**도 된다(`itl read` / `terminal_read`) — 보낸 뒤 화면을 못 보면 핸드오프는 눈
  감고 하는 일이 된다. 세션이 없으면 404 `session-gone`, 호스트에 못 닿으면 502 로 갈린다.
- skip 사유 목록은 **세 곳이 함께 움직인다**: `routes/itl.py` 의 `REASON_*`, `cli/itl` 과
  `cli/itl_mcp_tools.py` 의 `SKIP_REASONS`, 프론트 `RailMenus.pushSkipLabel`. 한쪽만 늘리면
  사용자 화면에 슬러그(`send-failed`)가 그대로 나온다.
- **여러 줄 방어는 경계에 있다**(`routes/itl.py collapse_lines`). CLI 에도 같은 함수가 있지만
  (`_single_line`) MCP·프론트는 CLI 를 지나지 않는다. `send-keys -l` 에서 개행은 Enter 라,
  안 합치면 대화형 TUI 가 조각난 명령 N 개를 받는다. 두 구현은 테스트가 대조한다.
- 🔐 **원격 tmux env 의 ITL_TOKEN 은 사용자 전체 범위다.** 그 호스트에 same-user 셸이 있는
  사람은 그것으로 **다른 호스트의 pane 까지** 입력할 수 있다(배달은 백엔드의 자격증명으로
  일어나므로). 예전 근거("토큰을 읽으려면 이미 그 기계의 셸이 있다")는 그 기계 안에서만
  성립했다 — 지금은 기계 경계를 넘는다. tailnet 한정·itl 스코프가 반경을 좁히지만, 호스트
  단위 스코프나 더 짧은 TTL 은 아직 없다. 새 호스트를 추가할 때 이 사실을 기억할 것.

### 상태로 고르는 주소는 상태를 먼저 채워야 한다 (2026-08-20)

`@working` `@idle` `@permission` 은 `t["status"] == key` 로 고른다. 그런데 **원격 pane 의
status 는 워처가 못 봐서 기본이 비어 있고**, 빈 값은 어떤 그룹에도 안 맞는다 → 원격이
**통째로 조용히 빠졌다.** 호출자는 그걸 "원격은 안 돌고 있다" 로 읽는다 —
불완전한 답이 아니라 **틀린 답**이다(이 문서가 이미 적어 둔 "모름을 일 안 함으로 세지
마라" 의 세 번째 재발).

한 뿌리로 세 군데가 틀려 있었다:

- `/api/itl/resolve` 는 `remote_status=1` 을 줘도 **채우기가 매칭 뒤**라 소용이 없었다.
  `/api/itl/targets` 는 이미 "채우기가 필터보다 먼저" 인데 여기만 반대였다. 지금은 주소가
  상태 그룹을 가리킬 때만 **매칭 전에** 채운다 — 그 외에는 맞은 것만 채운다(원격 pane
  하나를 5초마다 폴링하는 `terminal_wait` 를 전체 호스트 SSH 로 바꾸면 안 된다).
- **MCP `terminal_list`·`terminal_resolve` 스키마에 `remote_status` 가 아예 없었다.**
  CLI 에는 `--remote` 가 있었는데 MCP 에만 없어서, MCP 로 목록을 부르는 에이전트는 원격을
  **영원히 `?` 로만** 보고 `status=working` 필터에서 전부 잃었다. ⚠️ 이 저장소가 이미 적어
  둔 "세 곳이 함께 움직인다"(`routes/itl.py` · `cli/itl` · `cli/itl_mcp_tools.py`) 규칙이
  깨진 자리다 — skip 사유뿐 아니라 **모든 조회 인자가** 그 규칙을 따른다.
- `terminal_wait` 의 첫 해석도 같아서 `@working` 을 기다리면 원격이 안 잡히고
  `has_remote=False` 가 되어 로컬만 보고 즉시 끝났다.

**지금은 그냥 켜 둔다 (2026-08-27).** 한때는 "답을 바꾸는 인자는 자동으로 켠다" 였다 —
`terminal_list` 는 `status` 필터가 있을 때, `resolve`/`wait` 는 주소가 상태 그룹일 때만
`remote_status` 를 스스로 켰다. 그 조건부의 이유는 **채우기가 호스트당 SSH 왕복**이라는
것 하나뿐이었는데, 리모트 전환으로 그게 메모리 조회가 됐다(실측: 원격 15 pane 을 채우고도
`itl list` 전체가 0.1초).

조건부를 그대로 두면 값은 안 아끼면서 **기본 목록이 원격을 전부 `?` 로** 보여준다. 그건
"모른다" 가 아니라 "안 물어봤다" 인데 화면에서 구별되지 않아 **고장으로 읽힌다.** 그래서
네 층(route · CLI · MCP 스키마 · MCP 도구) 전부 기본을 켬으로 맞췄고, 끄는 길만 남겼다.

⚠️ **네 층이 같이 움직여야 한다.** 한 곳만 옛 기본값으로 남으면 그 경로로 들어온 호출자만
조용히 원격을 빼먹는다. `test_every_layer_fills_remote_status_by_default` 가 그 선이다.

**보내는 쪽도 같이 고쳤다 — 단, 왕복은 호스트당 한 번을 지킨다.** `/send` `/key` 도 상태
주소면 매칭 전에 상태를 채우는데, 그 조회와 배달이 **각자 SSH 를 열면 호스트당 왕복이
두 번**이 되고 두 단계가 각자 `HOST_DEADLINE`(20s)을 쓰면 합이 호출자 상한(30s)을 넘는다 →
**배달됐는데 실패로 읽혀 재시도가 중복 전송**(이 문서가 위에 적어 둔 바로 그 사고).

- `_HostChannels` 가 호스트당 채널을 한 번 열어 **상태 조회부터 배달까지 재사용**한다.
  실패한 호스트는 기억한다 — 매번 다시 열면 죽은 호스트 하나가 마감시한을 다 먹는다.
- **예산은 하나를 나눠 쓴다**: 상태 조회는 `STATUS_PHASE_BUDGET`(=HOST_DEADLINE/2), 배달은
  거기서 **쓴 만큼 뺀 나머지**(바닥 `MIN_DELIVER_DEADLINE`). 총합은 예전과 같다.
- 상태 그룹이 아닌 주소(번호·이름·명령)는 상태 조회를 **아예 안 건다** — 매칭에 필요 없다.
- ⚠️ 채우는 길이 둘이 됐다(자기 연결 `_fill_remote_status` / 공유 채널 `_fill_status_over`).
  판정은 `_apply_status_tables` **하나**를 쓴다 — 갈리면 한쪽만 "모름" 을 "일 안 함" 으로
  접어 상태 주소가 다시 거짓말을 시작한다. 테스트가 두 함수 모두 그걸 쓰는지 검사한다.

### 원격 env 주입은 attach **뒤에**, 세션은 만들지 않는다 (2026-08-17)

`ensure_remote_itl_env` 는 예전에 attach **앞에서** 돌면서 세션이 없으면 직접 만들었다.
둘 다 틀렸다:

- **세션 생성은 브리지의 일이다.** 우리가 먼저 `tmux new-session -d` 를 하면 브리지의
  `has-session ||` 절이 통과해 조심스러운 생성이 통째로 건너뛰어진다 —
  `set-option -g history-limit` 을 new-session 과 한 tmux 호출로 묶는 부분(콜드 스타트 첫
  pane 이 2000 에 고정된다, [[project_tmux_history_limit]])과 클라이언트 PTY 차원 상속
  (`conn.run` 은 PTY 가 없어 80x24 로 시작)을 둘 다 잃는다.
- **attach 앞에서 SSH 왕복을 하면 재연결마다 그 값을 물고, 부팅 때는 pane 수만큼 겹친다** —
  이 저장소가 줄여 온 바로 그 동시성이다. 지금은 `asyncio.create_task` 로 attach 뒤에 돌고,
  `(host, session)` 별 TTL(15분) 캐시가 재연결 폭풍에서 왕복을 0 으로 만든다.
- 그래서 respawn 도 안 한다(돌고 있는 에이전트를 죽인다). 이미 뜬 pane 은 env 를 늦게 받지만
  CLI·MCP 가 `tmux show-environment` 로 스스로 회복한다 — **회복 코드는 두 파일 모두에**
  있어야 한다. 한쪽만 있으면 "터미널에선 되는데 MCP 도구는 안 된다" 가 된다.

### UI 픽커의 "이 세션으로 전송" 도 백엔드를 지난다 (2026-08-17)

`RailMenus` 의 compose 행은 예전에 `window.terminalSessions[key]` 로 직접 밀어넣었다. 그
경로는 **대상 pane 이 지금 이 브라우저에 붙어 있어야만** 동작한다: 모바일에서 아직 안 본
pane 은 아예 안 붙고(`skipInitialConnect`), 안 보이는 pane 의 소켓은 60초 뒤 닫히고
(`INACTIVE_PANE_GRACE_MS`), 닫힌 소켓에 넣은 입력은 큐에서 4초 뒤 버려진다
(`STALE_INPUT_MS`). 그런데 UI 는 **무조건 초록 플래시**를 띄웠다 — 사라진 명령을 아무도 몰랐다.

- 지금은 `POST /api/itl/send` 를 쓴다(쿠키 인증이 그대로 통한다). 붙어 있지 않아도 도달하고,
  무엇보다 `delivered/skipped` 로 **도달 여부를 알려준다**. 실패면 빨간 테두리 + 사유 한 줄,
  입력은 지우지 않는다(다시 시도할 것이므로).
- 주소는 **신원**을 쓴다(`paneSessions.sessionKey` = 로컬 sessionId / 원격 tmuxSessionName).
  픽커의 `key` 는 원격이면 프론트 pane id 라 서버가 모르는 값이다.
- `timeoutMs` 는 30초다 — 원격 배달은 백엔드의 SSH 왕복을 포함하므로 apiFetch 기본 15초로는
  성공한 전송이 실패로 보인다.
- `origin: false` — 사람이 특정 터미널을 골라 친 명령이다. `[from …]` 꼬리표는 에이전트끼리
  헤매지 않게 하는 장치이고 여기서는 노이즈다.

### 설치 없이 되게 — PATH 는 tmux **서버** 환경에만 있다 (2026-08-19)

`itl` 은 백엔드와 함께 배포되므로 이미 그 기계에 있는데, **아무의 PATH 에도 없었다.**
저장소 경로를 아는 사람만 `python3 …/backend/cli/itl` 로 쓸 수 있었고, 원격은 호스트
편집기의 설치 버튼을 찾아 누른 사람만 됐다 — 이 앱의 차별점이 "읽어 본 사람 전용" 이었다.

⚠️ **실측(tmux 3.4): pane 은 세션 환경의 PATH 를 물려받지 않는다.** `-e FOO=bar` 는
들어가는데 `-e PATH=` 는 안 들어간다. `set-environment` 도, `set-environment -g` 도
마찬가지다. pane 이 무엇을 찾을 수 있는지는 **tmux 서버 프로세스의 환경**만 정한다.

- 그래서 PATH 는 `tmux_manager._tmux_env()` 에 있다(서버를 띄우는 자리). 설치되는 파일이
  하나도 없고 앱을 지우면 같이 사라진다. **이미 떠 있는 tmux 서버는 자기가 시작한 PATH 를
  유지하므로**(세션이 백엔드보다 오래 사는 설계) 서버 재시작 때 적용된다.
- `itl_remote_setup` 의 세션 PATH 줄도 같은 이유로 **원격 pane 에는 효과가 없다.** 원격에서
  실제로 동작하게 하는 것은 설치된 파일 + rc 줄이다. 이 사실을 모르고 그 줄을 근거로
  "PATH 는 해결됐다" 고 읽지 말 것.
- 복원된 로컬 세션(백엔드 재시작을 넘긴 것)은 `create_session` 을 지나지 않아 ITL_* 가 영영
  비어 있었다 → attach 때 `refresh_session_env` 가 다시 심는다.

**원격 자동 설치**(`ensure_remote_itl_cli`): 첫 attach 에 CLI+MCP 한 벌을 올린다.
해시가 버전 표식이라 같은 판이면 덮어쓰지 않고(TTL 6h), 임시 이름으로 쓰고 rename 하므로
전송이 끊겨도 반쪽짜리 파일이 남지 않는다. **압축·인코딩은 원격 python3 가 한다** —
`base64 -d` 는 macOS 에서 `-D` 고 tar 플래그도 갈린다. `ITL_AUTO_INSTALL=0` 으로 끈다.
⚠️ **자동 경로는 사용자의 rc 파일을 건드리지 않는다.** 그건 버튼을 누르는 사람이 고르는
일이다(`build_install_cmd(with_rc=)` 가 그 경계 하나다).

**에이전트 MCP 자동 등록**(`backend/agent_mcp.py`): `~/.claude.json` 의 user scope 에
`itl` 항목을 넣는다. 로컬은 lifespan 에서 1회, 원격은 CLI 설치가 성공한 **뒤에**(가리키는
파일이 없는 항목을 심으면 에이전트가 시작하다 실패한다). 규칙 둘:
- **강제하지 않는다** — `ITL_AUTO_MCP=0`, 그리고 **사람이 손으로 쓴 항목은 건드리지 않는다**
  (래퍼나 다른 인터프리터를 일부러 쓴 것일 수 있다). 우리가 쓴 낡은 경로만 고친다.
- **망가뜨리지 않는다** — 그 파일에는 온보딩 플래그·프로젝트별 기록이 같이 있다. 파싱 →
  복사 → temp 쓰기 → `os.replace`. 못 읽는 파일은 **새로 짓지 않고 그냥 둔다**(설정이 없다
  = 그 기계에서 에이전트를 쓴 적이 없다는 뜻이고, 우리가 지어 주면 그 에이전트의 온보딩이
  가장 먼저 덮어쓴다).

### 목록용 행과 접속용 행은 다르다 (2026-08-19)

`storage.list_hosts` 는 **`password_enc` 를 SELECT 하지 않는다** — 그 행은 브라우저로
나가므로 옳은 설계다. 그런데 `GET /api/hosts/tmux-sessions/batch` 가 그 행을 그대로
`resolve_host_secrets` 에 넘기고 있었다. 결과: password 인증 호스트가 전부
`비밀번호 인증인데 비밀번호가 없음` 으로 실패하고, **홈의 "이어할 수 있는 세션" 이 그
호스트들에서 영영 비어 있었다.**

진단이 어려웠던 이유: **한 경로에서만 실패한다.** 터미널·VNC·단일 조회는 전부
`get_host` 를 쓰므로 멀쩡히 붙는다("접속은 되는데 세션 목록만 안 나온다" 가 이 병의 지문).

- 배치는 고를 때만 목록을 쓰고, **다이얼할 호스트는 `get_host` 로 다시 읽는다.**
- `resolve_host_secrets` 는 이제 **컬럼이 아예 없는 행을 거부한다**(값이 비어 있는 것과
  구별한다 — 후자는 정말로 비밀번호를 저장하지 않은 호스트다).
  `tests/test_host_secrets_shape.py` 가 그 구분을 잠근다.

**일반화: 비밀이 빠진 행을 접속 경로에 넘기면, 그 실패는 "자격이 없다" 처럼 보인다.**
새 엔드포인트가 호스트에 붙는다면 그 행이 어디서 왔는지부터 확인할 것.

### 실행 중 보드 — 한 화면, 호스트당 왕복 하나 (2026-08-19)

`GET /api/fleet`(`routes/fleet.py`)가 **한 번의 SSH 방문**으로 pane 상태 + 각 세션이 언제
시작됐는지 + 그 기계의 램·가동시간을 같이 걷어온다(`itl_remote.build_snapshot_cmd`).
화면 하나에 SSH 를 세 번 걸면 호스트 수만큼 곱해진다 — 이 저장소가 계속 줄여 온 쪽이다.

- 출력은 마커(`ITL_SECTION`)로 세 구획이다. ⚠️ `parse_list_status` 는 마커에서 **멈춰야**
  한다. 안 그러면 `MemTotal:` 줄이 세션 이름으로 들어온다.
- 압축·인코딩·추출은 **원격 python3** 가 한다. `base64 -d` 는 macOS 에서 `-D` 고 tar 플래그도
  갈린다(원격 itl 설치와 같은 이유).
- `/proc` 이 없는 호스트(macOS·BSD)는 machine 이 **None** 이다. 0% 로 그리면 측정한 것처럼
  보인다 — 못 닿은 호스트도 마찬가지로 수치를 아예 안 그린다.
- **세션별 메모리**는 pane 의 pid 가 아니라 **그 아래 프로세스 트리 전체**의 RSS 합이다
  (pane pid 는 셸이고, 무거운 것은 그 셸이 띄운 에이전트·빌드다). 트리를 셸에서 도는 대신
  `ps -eo pid=,ppid=,rss=` 한 장을 받아 **백엔드가 합친다**(`itl_remote.sum_tree_rss`) —
  로컬도 같은 함수를 쓰므로 두 경로가 숫자의 의미를 두고 어긋날 수 없다. RSS 는 공유
  페이지를 겹쳐 세므로 "어느 세션이 무거운가" 에 답하는 값이지 "지우면 얼마가 도나" 가
  아니다(PSS 는 대개 root 가 필요하다). `ps` 가 없으면 **0 이 아니라 없음**이다.
- ⚠️ `system_monitor` 와 `tmux_manager` 는 **싱글턴을 export** 한다. 모듈을 import 해서
  `system_monitor.get_stats` 를 부르면 AttributeError 가 나고, 이 라우트는 그것을 "수치를 못
  구했다" 로 삼킨다 — 화면에 로컬 수치만 통째로 비어 나오고 에러는 어디에도 없다.
  실제로 그렇게 한 번 배포됐다. `test_fleet_snapshot.py` 가 그 이름들을 잡는다.

### 상태판 — 모른다고 적는 것이 기능이다 (2026-08-19)

홈의 "지금 돌고 있는 것"(`components/home/FleetBoard.jsx` + `utils/fleetStore.js`)은
`GET /api/itl/targets?remote_status=1` 하나를 그린다.

- **원격 pane 상태는 백엔드 워처가 못 본다**(그 호스트의 tmux 다). 그래서 이 조회는
  **호스트당 SSH 한 번**이고, 그 값이 이 화면의 주기를 정한다: 30초, 그리고 홈이 실제로
  보일 때만. 타이머는 **스토어가 하나만** 갖는다(홈은 대시보드와 빈 pane 두 곳에서 그려진다
  — [[project_request_multiplication]] 과 같은 병).
- ⚠️ **못 물어본 호스트는 `?` 다. 유휴가 아니다.** 둘을 같게 그리면 화면이 조용히
  거짓말을 한다(같은 실수가 예전에 `terminal_wait` 를 0 초에 "완료" 로 만들었다).
- 실패해도 직전 그림을 지우지 않는다 — 빈 판은 "전부 멈췄다" 로 읽힌다.

### 윈도우 호스트 — 지원하지 않는다, 그리고 그렇게 말한다 (2026-08-19)

이 앱이 원격에 하는 일은 전부 POSIX 셸 전제다(tmux, `/tmp` 붙여넣기, `~/.local/bin`).
윈도우 호스트는 **한 주에 걸쳐 서로 무관해 보이는 세 개의 버그**로 사용자를 만났다 —
tmux 토글 거부, 붙여넣기 증발, 핸드오프 조용한 부재.

`backend/remote_platform.py` 가 `uname -s 2>&1` **한 번**으로 판정한다(cmd.exe·PowerShell
은 "is not recognized" 계열 문구를 뱉는다 — 그 실패 문구가 곧 근거다). `tmux-check` 와
`itl-status` 가 `platform` 을 함께 돌려주고, 호스트 편집기가 "Windows 호스트 — 지원하지
않음 + WSL 로 등록하면 그대로 동작" 을 한 번에 말한다.
⚠️ **침묵은 `unknown` 이지 `windows` 가 아니다.** 잠긴 셸에 경고를 붙이면 멀쩡한 호스트를
겁준다.

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

⚠️ That argument is bounded to *that machine*, and remote sending crosses the boundary — see the 🔐 note in the traps above. A token read on the weakest host drives panes on every host, because delivery uses the backend's stored credentials, not the caller's.

Traps (MCP-specific):
- **stdout is JSON-RPC only.** A single stray `print()` makes the client treat the server as dead. All logs go to stderr, and only when `ITL_MCP_DEBUG=1`.
- **Never respond to a notification.** Messages without `id` (e.g. `notifications/initialized`) get `return None` at the top of the dispatcher — answering them is a protocol violation.
- **`send_keys -l "C-c"` types the literal `C-c`.** Special keys go through `tmux_manager.send_key`, which lets tmux interpret the key name. The Telegram stop button hit the same trap.

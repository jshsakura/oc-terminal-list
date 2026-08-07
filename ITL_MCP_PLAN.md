# ITL MCP — 터미널끼리 서로를 보고 시키는 MCP 서버 (설계서)

> 구현 담당: GLM. 이 문서 하나로 구현 가능하도록 인터페이스·스키마·에러·테스트까지 확정한다.
> 이미 있는 것 위에 얹는 작업이다. **새로 발명하지 말고 기존 `itl` 계층을 재사용한다.**

---

## 0. 한 줄

pane 안에서 도는 에이전트가 **같은 탭의 형제 터미널**을 조회하고, "2번 탭 glm한테 시켜" 같은
지시를 첫 시도에 맞출 수 있게 하는 **stdio MCP 서버**. 백엔드 `/api/itl/*` 를 감싸는 얇은 층이다.

```
사용자: "같은 탭 옆 터미널이 뭐 하고 있는지 보고, 2번 탭 glm한테 테스트 돌리라고 해"
   → 에이전트가 terminal_list(scope="same_tab") → terminal_read(to="2") → terminal_send(to="2.@glm", ...)
```

---

## 1. 목표 / 비목표

### 1.1 목표

| # | 목표 | 성공 판정 |
|---|---|---|
| G1 | 같은 탭 형제 pane 조회가 **기본값**이어야 한다 | `terminal_list` 를 인자 없이 불러 형제만 나온다 |
| G2 | "2번 탭 glm" 같은 **탭×대상 교차 주소**가 표현 가능해야 한다 | `2.@glm` 이 해소된다 |
| G3 | 보내기 전에 **어디로 가는지 확인**할 수 있어야 한다 | `terminal_resolve` dry-run |
| G4 | 상대 화면을 **읽을 수** 있어야 한다 (시켜놓고 결과 확인) | `terminal_read` |
| G5 | 상대가 끝날 때까지 **기다릴 수** 있어야 한다 | `terminal_wait` |
| G6 | 원격 호스트에 **설치가 필요 없어야** 한다 | 파일 1개 복사로 동작, `pip install` 0개 |
| G7 | 에이전트가 자기 자신에게 시켜 **루프 도는 일이 없어야** 한다 | 자기 제외가 기본 |

### 1.2 비목표 (하지 않는다)

- **백엔드에서 LLM 호출** — 아키텍처 규칙. 자연어 해석은 pane 안의 모델이 이미 한다.
  우리가 하는 일은 "그 모델이 첫 시도에 맞출 만큼 뻔한 어휘"를 주는 것뿐이다.
- **자연어 주소 파싱** ("두번째 탭의 지엘엠") — 도구 설명문으로 모델이 `2.@glm` 을 만들게 한다.
- **새 인바운드 포트 / 상주 프로세스** — stdio 로만 붙는다.
- **MCP resources / prompts** — v1 은 tools 만. (§13 참고)
- **원격 pane 에 보내기/읽기** — SSH 왕복이 필요하다. 지금처럼 **명시적으로 거절**한다.

---

## 2. 아키텍처

```
┌─ tmux pane (사용자 세션) ────────────────────────────────┐
│  claude / glm / codex  ← 에이전트 CLI                    │
│     │ stdio (JSON-RPC 2.0, newline-delimited)            │
│     ▼                                                    │
│  backend/cli/itl_mcp.py   ← 이번에 만드는 것 (stdlib only)│
│     │ HTTP + Authorization: Bearer $ITL_TOKEN            │
└─────┼────────────────────────────────────────────────────┘
      ▼
  FastAPI  /api/itl/targets · /resolve · /send · /read(신규)
      │
      ├── itl_targets.resolve()      ← 주소 해소기 (단 하나)
      ├── agent_status_watcher       ← status / command / title
      ├── pane_excerpt.extract_excerpt ← 화면 발췌 (신규 read 가 재사용)
      └── tmux_manager               ← send-keys / capture-pane
```

**핵심 불변식 — 주소 해소기는 백엔드에 하나뿐이다.**
MCP 서버는 주소 문자열을 **파싱하지 않는다.** 그대로 백엔드에 넘긴다. `itl` CLI, Telegram
자유텍스트, MCP 셋이 같은 `itl_targets.resolve` 를 본다. 여기서 갈라지면 세 경로가 서로 다른
터미널로 보내기 시작하고, 그건 조용히 틀리는 종류의 버그다.

**환경변수는 기존 것 그대로.** `itl_env.build_itl_env` 가 이미 세션 생성 두 경로(REST/WS)에
`ITL_API` / `ITL_TOKEN` / `ITL_SESSION` 을 주입한다. MCP 서버는 에이전트 CLI의 **자식
프로세스**로 뜨므로 pane 환경을 그대로 물려받는다. **`itl_env.py` 는 건드리지 않는다.**

---

## 3. 설계 결정 (근거 포함 — 뒤집으려면 근거부터 반박할 것)

### D1. MCP Python SDK(`pip install mcp`)를 쓰지 않는다. JSON-RPC 를 직접 짠다.

- 이 저장소의 규칙은 **"상주하는 것이 없다 / 설치 0"** 이다(`llm_usage` 절, `itl` CLI 가 stdlib
  only 인 이유). SDK 를 쓰면 원격 호스트마다 pip 설치 + 버전 드리프트가 생긴다.
- 우리가 필요한 스펙 표면은 5개뿐: `initialize`, `notifications/initialized`, `tools/list`,
  `tools/call`, `ping`. 250줄 안쪽이다.
- 대가: 스펙 변화를 우리가 따라가야 한다. → `protocolVersion` 을 명시적으로 협상하고(§5.1),
  모르는 메서드는 `-32601` 로 정직하게 거절한다.

### D2. 전송은 stdio 만. HTTP/SSE 전송은 만들지 않는다.

- stdio 는 **새 포트가 0개**다. 이 앱의 보안 경계는 "앱 현관"이고, 인바운드를 늘리지 않는 것이
  Xvnc 절에서 이미 세운 원칙이다.
- 덤으로 인증이 공짜다 — 자식 프로세스가 pane 의 `ITL_TOKEN` 을 상속한다.

### D3. `itl` CLI 를 대체하지 않는다. 형제로 둔다.

- CLI 는 사람이 치고, 셸 스크립트가 파이프하고, MCP 를 모르는 에이전트가 쓴다.
- 둘은 **같은 엔드포인트**를 본다. MCP 는 CLI 를 subprocess 로 부르지 **않는다**(에러 처리와
  파싱이 두 번 일어난다) — HTTP 를 직접 친다.

### D4. `terminal_wait` 는 MCP 서버에서 폴링한다. 백엔드에 타이머를 만들지 않는다.

- 백엔드에 대기 상태를 두면 연결이 끊긴 클라이언트를 청소해야 하고, 그건 상주하는 것이다.
- `/api/itl/targets` 는 이미 status 를 준다. 2초 폴링이면 충분하고, 기다리는 주체(에이전트)의
  프로세스 안에서 도는 게 수명 관리가 자명하다.

### D5. `terminal_list` 의 텍스트 출력은 백엔드 `format_table` 을 그대로 쓴다.

- CLAUDE.md: *"이 표 자체가 주소 체계의 사용설명서다."* 모델이 표를 보면 다음 주소를 스스로
  만든다. 표를 MCP 쪽에서 다시 그리면 두 개의 사용설명서가 생긴다.

### D6. 자기 자신은 기본적으로 대상에서 뺀다.

- 에이전트가 `@all` 로 보내면 자기 프롬프트에도 텍스트가 박히고, 그걸 읽고 또 보낸다. 실제로
  도는 무한 루프다. `include_self` 를 명시해야만 포함한다.

---

## 4. 주소 문법 v2 (백엔드 `itl_targets.py` 변경)

현재 문법으로는 사용자의 두 요구를 **표현할 수 없다**:

| 요구 | 현재 | 문제 |
|---|---|---|
| "같은 탭 형제들 전부" | 없음 | `@all` 은 전역, `3` 은 한 개 |
| "2번 탭의 glm" | 없음 | `@glm` 은 전역, `2.3` 은 번호로만 |

### 4.1 문법

```
addr     := paneref | group | tabsel SEP panesel
SEP      := "." | ":"
tabsel   := INT | "@" NAME
panesel  := INT | "@" WORD
paneref  := INT                     # 호출자 탭의 N 번 pane
group    := "@" WORD                # 전역 또는 호출자 기준 그룹
```

### 4.2 예약어 (WORD)

| 예약어 | 뜻 | from_session 필요 |
|---|---|---|
| `all` | 전부 | 아니오 |
| `here` | **호출자가 속한 탭의 모든 pane** (신규) | **예** |
| `siblings` | **호출자 탭에서 자기를 뺀 pane** (신규) | **예** |
| `working` `idle` `permission` | 에이전트 상태 | 아니오 |
| 그 외 | 돌고 있는 명령 (`claude` `glm` `codex` `node` …) | 아니오 |

### 4.3 해소 순서 (이 순서를 바꾸지 말 것)

1. **사용자가 지은 탭 이름이 항상 이긴다.** 예외 없음. 탭을 `working` 이라 이름 붙였는데
   `@working` 이 딴 데로 가면 그게 함정이다. (기존 규칙 — `_by_name` 우선, 유지)
2. 예약 그룹 (`all` / `here` / `siblings` / 상태)
3. 돌고 있는 명령

`tabsel` 위치의 `@NAME` 은 **탭 이름으로만** 해석한다(그 자리에 상태 그룹은 의미가 없다).
`panesel` 위치의 `@WORD` 는 **탭 이름으로 해석하지 않는다** — 상태 → 명령 순.

### 4.4 from_session 이 없을 때

`3`, `@here`, `@siblings` 는 **빈 목록을 돌려준다.** 전역 번호로 재해석하지 않는다.
(기존 주석 그대로: *"조용히 엉뚱한 곳으로 보내느니 못 찾았다고 하는 편이 낫다."*)

### 4.5 케이스 표 — 이 표가 그대로 테스트다

`tests/test_itl_targets.py` 의 기존 `TABS` 픽스처 기준. 탭1 = `frontend`(pane s1, s2, 빈 pane),
탭2 = `backend`(원격 h1, h2). 호출자 `from_session="s1"` (= 주소 `1.1`).

| 주소 | 결과 | 비고 |
|---|---|---|
| `3` | `[]` | 탭1에 3번 pane 없음 |
| `2` | `1.2` | 호출자 탭의 2번 |
| `1.2` / `1:2` | `1.2` | 기존 |
| `@frontend` | `1.2` | 탭 이름 → 활성 pane |
| `@frontend.1` | `1.1` | 기존 |
| `@all` | 4개 전부 | 기존 |
| `@here` | `1.1`, `1.2` | **신규** — 자기 포함 |
| `@siblings` | `1.2` | **신규** — 자기 제외 |
| `@working` | `1.1` | 기존 |
| `@claude` | `1.1`, `2.1` | 기존, 전역 |
| `2.@claude` | `2.1` | **신규** — 탭 2의 claude |
| `@backend.@claude` | `2.1` | **신규** — 탭 이름 × 명령 |
| `@here.@claude` | `1.1` | **신규** |
| `1.@idle` | `[]` | 탭1에 idle 없음 |
| `@here` (from_session=None) | `[]` | 기준점 없음 |
| `@siblings` (from_session=None) | `[]` | 기준점 없음 |
| `2.@nope` | `[]` | 없는 명령 |
| `@working.@claude` | `[]` | tabsel 위치의 상태 그룹은 탭 이름이 아니므로 매치 없음 |
| `1 . 2` | `1.2` | **신규** — 구분자 앞뒤 공백 허용 (head/tail strip) |
| `@api.v2` † | `3.1` | **신규** — 점 든 탭 이름, 단일 토큰 → 활성 pane |
| `@api.v2.1` † | `3.1` | **신규** — 점 든 탭 이름 + pane 인덱스 (rsplit 필요) |

† `api.v2` 행은 확장 픽스처(`TABS` + `api.v2` 탭 1개, pane 2개)로 검증한다.
기본 `TABS` 에 넣으면 `@all` 4개 카운트·`test_unknown_address` 등 기존 케이스가 깨지기 때문이다.

**하위호환 필수** — 기존 `test_itl_targets.py` 의 모든 케이스가 손대지 않고 통과해야 한다.

### 4.6 구현 노트

`resolve()` 를 아래 형태로 재구성한다. 함수는 50줄 이하로 쪼갠다(코딩 규칙).

```python
def resolve(targets, expr, from_session=None):
    """Address string -> target list. Empty list when nothing matches."""
    raw = (expr or "").strip()
    if not raw:
        return []
    tab_part, sep, pane_part = _split_addr(raw)     # None when not a two-part address
    if sep:
        scoped = _select_tab(targets, tab_part, from_session)
        return _select_pane(scoped, pane_part, targets, from_session)
    ...
```

- `_split_addr` 는 `@name.2` 의 `.` 과 `@name` 안의 `.` 을 구분해야 한다. **마지막 `.`
  또는 `:` (rsplit)에서 자르되, 뒤쪽이 `INT` 이거나 `@`-접두일 때만 두 부분 주소로 본다.**
  그렇지 않으면 통째로 탭 이름으로 본다 (탭 이름에 점이 들어갈 수 있다: `api.v2`).
  rsplit 이어야 `@api.v2.1` 이 head=`@api.v2`, tail=`1` 로 갈라져 점 든 탭 이름에도 pane
  지정이 된다. head/tail 은 `strip()` 하여 `1 . 2` 같은 공백-관대 입력도 파싱한다.
- **탭 이름은 정규식으로 검증하지 않는다.** 사용자가 지은 문자열이기 때문이다. 정규식은
  `INT` (`^\d+$`) 에만 쓰고, `@WORD` 는 `@` 접두 사실만으로 판별한 뒤 `_by_name` 으로
  보낸다. 점·공백이 들어간 탭 이름도 자연스럽게 해소된다.
- `_select_tab(targets, sel, from_session)` → 그 탭의 target 부분집합
- `_select_pane(scoped, sel, all_targets, from_session)` → 최종 목록

---

## 5. MCP 서버 사양

### 5.0 파일

```
backend/cli/itl_mcp.py      MCP 서버 본체 (stdlib only, 단일 파일)
backend/cli/itl-mcp         실행 래퍼 (chmod +x, 한 줄: exec python3 "$(dirname "$0")/itl_mcp.py" "$@")
backend/tests/test_itl_mcp.py
```

⚠️ 본체를 **`.py` 확장자로** 둔다. 기존 `cli/itl` 은 확장자가 없어 테스트에서 import 하려면
`importlib` 곡예가 필요하다. MCP 서버는 도구 스키마·디스패치·에러 매핑이 전부 테스트 대상이라
평범하게 import 되어야 한다. 실행 편의는 래퍼가 맡는다.

### 5.1 프로토콜

- **전송**: stdin/stdout, **줄 단위 JSON**(newline-delimited). 메시지 안에 개행 금지
  (`json.dumps(..., ensure_ascii=False)` 는 기본적으로 개행을 넣지 않는다 — `indent` 금지).
- **⚠️ stdout 은 JSON-RPC 전용이다.** `print()` 하나가 클라이언트를 깨뜨린다. 모든 로그는
  **stderr** 로. 디버그 로그는 `ITL_MCP_DEBUG=1` 일 때만.
- stdin EOF → `exit 0`.
- 지원 `protocolVersion`: `{"2024-11-05", "2025-03-26", "2025-06-18"}`.
  클라이언트가 준 값이 이 집합에 있으면 **그대로 돌려주고**, 없으면 `2025-06-18` 을 돌려준다.

| 메서드 | 응답 |
|---|---|
| `initialize` | `{protocolVersion, capabilities: {tools: {listChanged: false}}, serverInfo: {name: "itl", version: "1.0.0"}}` |
| `notifications/initialized` | **응답 없음** (notification — `id` 가 없는 메시지엔 절대 응답하지 않는다) |
| `tools/list` | `{tools: [...]}` (§5.3) |
| `tools/call` | `{content: [{type: "text", text: "..."}], isError: bool}` |
| `ping` | `{}` |
| 그 외 | JSON-RPC error `-32601 Method not found` |

### 5.2 에러 두 종류를 섞지 말 것

| 상황 | 표현 | 이유 |
|---|---|---|
| 잘못된 JSON / 없는 메서드 / 스키마 위반 | JSON-RPC `error` 객체 | 프로토콜 층의 실패 |
| 주소 못 찾음 / 원격 미지원 / 세션 사라짐 / 401 | `result` + `isError: true` + 설명 텍스트 | **모델이 읽고 복구해야 하는 실패** |

두 번째를 JSON-RPC error 로 내면 클라이언트가 모델에게 보여주지 않고 삼키는 경우가 있다.
"3번 터미널이 없습니다. `terminal_list` 로 주소를 확인하세요" 는 **모델에게 갈 말**이다.

에러 텍스트 규격:

| 케이스 | 텍스트 |
|---|---|
| 토큰 없음 | `ITL_TOKEN이 없습니다. 이 도구는 Terminal List가 만든 터미널 안에서만 동작합니다.` |
| 401 | `인증이 만료됐습니다. 사용자에게 이 터미널을 새로 열어달라고 요청하세요.` |
| 백엔드 불통 | `백엔드에 연결할 수 없습니다 ({API}): {reason}` |
| 주소 미매치 | `'{to}'에 해당하는 터미널이 없습니다. terminal_list로 주소를 확인하세요.` |
| 팬아웃 초과 | `대상이 {n}개입니다 (상한 {MAX}). 주소를 좁히거나 confirm_fanout=true로 다시 부르세요.` |
| 원격 pane | `{addr}는 원격 호스트의 터미널이라 아직 보낼 수 없습니다.` |

### 5.3 도구 명세

> 도구 이름과 **설명문이 곧 API 다.** 모델은 이 문장만 보고 인자를 만든다.
> 설명문은 반드시 한국어/영어를 섞지 말고 아래 문장 그대로 쓴다.

공통 인자 규칙:
- `to` 는 §4 문법 문자열. **MCP 서버는 파싱하지 않고 그대로 전달한다.**
- 모든 도구는 `ITL_SESSION` 을 `from_session` 으로 자동 첨부한다. 모델이 신경 쓸 필요 없다.

---

#### `terminal_list` — 열려 있는 터미널 목록

```jsonc
{
  "name": "terminal_list",
  "description": "열려 있는 터미널(pane)과 그 주소를 표로 본다. 기본은 내가 속한 탭의 형제 터미널만 보여준다. 다른 탭까지 보려면 scope=\"all\". 각 행의 ADDR 값이 다른 도구의 to 인자로 그대로 들어간다.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "scope":  {"type": "string", "enum": ["same_tab", "all"], "default": "same_tab",
                 "description": "same_tab = 내가 속한 탭만. all = 전체 탭."},
      "status": {"type": "string", "enum": ["working", "idle", "permission"],
                 "description": "이 상태인 터미널만."},
      "command":{"type": "string", "description": "이 명령이 돌고 있는 터미널만 (claude, glm, codex ...)."},
      "include_self": {"type": "boolean", "default": true,
                 "description": "내 터미널도 목록에 포함할지. 목록은 기본 포함(> 표시가 붙는다)."}
    },
    "additionalProperties": false
  }
}
```

- 구현: `GET /api/itl/targets?from_session=&fmt=table` → 표를 그대로 텍스트로.
  `scope`/`status`/`command`/`include_self` 는 **MCP 서버에서 필터링**한 뒤
  `fmt=json` 결과를 자체 표로 그리는 게 아니라 → **백엔드에 필터를 넘긴다**(§6.1 참고:
  `/targets` 에 `scope`·`status`·`command` 쿼리 추가).
- `scope="same_tab"` 이고 `ITL_SESSION` 이 없으면: `isError:true`,
  `"내 터미널의 위치를 알 수 없습니다(ITL_SESSION 없음). scope=\"all\"로 다시 시도하세요."`
- 결과가 0행이면 표 대신 `"열려 있는 터미널이 없습니다."`

#### `terminal_whoami` — 내 주소

```jsonc
{
  "name": "terminal_whoami",
  "description": "이 터미널 자신의 주소(탭 번호.pane 번호)와 탭 이름, 형제 터미널 수를 알려준다. 다른 터미널에게 '나에게 답해줘'라고 할 때 이 주소를 알려주면 된다.",
  "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false}
}
```

반환(텍스트, JSON):
```json
{"addr": "1.1", "tabIndex": 1, "paneIndex": 1, "tabName": "frontend",
 "cwd": "/w/app", "command": "claude", "siblingCount": 2}
```

#### `terminal_resolve` — 이 주소가 어디로 가는지 미리 보기

```jsonc
{
  "name": "terminal_resolve",
  "description": "주소가 어떤 터미널들로 해소되는지 미리 확인한다. 아무것도 보내지 않는다. 여러 터미널에 보내기 전이나 주소가 확실하지 않을 때 먼저 부른다.",
  "inputSchema": {
    "type": "object",
    "required": ["to"],
    "properties": {"to": {"type": "string", "description": "주소. 예: 3 | 1.3 | @프론트 | @siblings | 2.@glm | @working | @all"}},
    "additionalProperties": false
  }
}
```

#### `terminal_send` — 다른 터미널에 입력

```jsonc
{
  "name": "terminal_send",
  "description": "다른 터미널의 프롬프트에 텍스트를 입력한다. 기본은 엔터를 치지 않는다 — 사람이 보고 직접 실행한다. 상대가 즉시 실행하길 원하면 submit=true. 자기 자신에게는 보내지 않는다(무한 루프 방지).",
  "inputSchema": {
    "type": "object",
    "required": ["to", "text"],
    "properties": {
      "to":   {"type": "string", "description": "주소. 예: 3 | 1.3 | @backend | @siblings | 2.@glm"},
      "text": {"type": "string", "maxLength": 8000, "description": "입력할 내용. 그대로 타이핑된다."},
      "submit": {"type": "boolean", "default": false,
                 "description": "엔터까지 칠지. 기본 false — 대화형 앱 한가운데 엔터가 들어가면 의도치 않게 실행된다."},
      "include_self": {"type": "boolean", "default": false, "description": "자기 자신도 대상에 포함(기본 제외)."},
      "confirm_fanout": {"type": "boolean", "default": false,
                 "description": "대상이 5개를 넘을 때 true여야 실제로 보낸다. 오타 하나로 전 터미널에 명령이 박히는 걸 막는다."}
    },
    "additionalProperties": false
  }
}
```

동작 순서 (**이 순서 그대로**):
1. `GET /api/itl/resolve` 로 먼저 해소 → 대상 목록 확보
2. `include_self=false`(기본)면 `ITL_SESSION` 과 같은 target 제거
3. 남은 대상 0개 → `isError` + 미매치 문구
4. 대상 > `FANOUT_CONFIRM_THRESHOLD`(=5) 이고 `confirm_fanout` 이 false → **보내지 않고**
   대상 표 + 안내를 `isError:false` 로 돌려준다. (모델이 보고 다시 부를 수 있게. 실패가 아니다.)
5. `POST /api/itl/send`
6. delivered/skipped 를 사람이 읽는 줄로 반환. delivered 가 0이면 `isError: true`.

#### `terminal_read` — 상대 화면 읽기

```jsonc
{
  "name": "terminal_read",
  "description": "다른 터미널의 현재 화면을 읽는다. 시켜놓은 작업이 어떻게 됐는지 확인할 때 쓴다. 주소는 정확히 하나의 터미널로 해소되어야 한다.",
  "inputSchema": {
    "type": "object",
    "required": ["to"],
    "properties": {
      "to":    {"type": "string"},
      "lines": {"type": "integer", "default": 40, "minimum": 1, "maximum": 200,
                "description": "화면 마지막 몇 줄을 읽을지."},
      "mode":  {"type": "string", "enum": ["excerpt", "raw"], "default": "excerpt",
                "description": "excerpt = 입력상자/상태줄 같은 UI 장식을 걷어낸 본문. raw = 있는 그대로."}
    },
    "additionalProperties": false
  }
}
```

- 여러 개로 해소되면 `isError` + 매치된 주소들을 나열: `"'@claude'는 3개로 해소됩니다: 1.1, 2.1, 3.2. 하나만 지정하세요."`
- 원격 pane → `isError` + `"원격 호스트의 터미널은 아직 읽을 수 없습니다."`

#### `terminal_wait` — 끝날 때까지 기다리기

```jsonc
{
  "name": "terminal_wait",
  "description": "지정한 터미널이 작업을 마칠 때까지 기다린다. 다른 터미널에 일을 시킨 뒤 결과를 확인하기 전에 부른다. 최대 timeout_sec까지만 기다리고, 시간이 다 되면 마지막 상태를 알려준다.",
  "inputSchema": {
    "type": "object",
    "required": ["to"],
    "properties": {
      "to":    {"type": "string"},
      "until": {"type": "string", "enum": ["idle", "not_working", "permission"], "default": "not_working",
                "description": "not_working = working이 아니게 되면(권한 대기 포함). idle = 완전히 쉬는 상태. permission = 권한 요청이 뜰 때."},
      "timeout_sec": {"type": "integer", "default": 120, "minimum": 5, "maximum": 600}
    },
    "additionalProperties": false
  }
}
```

- 구현: `POLL_SEC = 2.0` 으로 `/api/itl/targets` 폴링. **첫 폴링은 즉시** 한다(이미 끝났을 수 있다).
- 대상이 여러 개면 **전부** 조건을 만족해야 종료.
- 반환: `{"reached": true|false, "elapsed_sec": 34, "targets": [{"addr": "2.1", "status": "idle"}]}`
- 도중에 대상이 사라지면(`session-gone`) 그 대상은 조건 충족으로 친다 + 텍스트에 명시.
- timeout 은 `isError: false` — 시간 초과는 정상적인 결과다. 텍스트에 `아직 working 중입니다` 를 명시.

#### `terminal_key` — 특수 키 보내기 (P2)

```jsonc
{
  "name": "terminal_key",
  "description": "다른 터미널에 특수 키를 보낸다. 폭주하는 작업을 멈출 때 C-c를 쓴다.",
  "inputSchema": {
    "type": "object",
    "required": ["to", "key"],
    "properties": {
      "to":  {"type": "string"},
      "key": {"type": "string", "enum": ["C-c", "Escape", "Enter", "q"]}
    },
    "additionalProperties": false
  }
}
```

- 키는 **화이트리스트**로만. `send_keys -l "C-c"` 는 리터럴 문자를 타이핑한다 —
  `tmux_manager.send_key`(키 전송)를 써야 한다. Telegram 중단 버튼과 같은 함정.
- 백엔드 `POST /api/itl/key` 필요 (§6.3).

---

## 6. 백엔드 변경

### 6.1 `GET /api/itl/targets` — 필터 인자 추가

```python
@router.get("/targets")
async def itl_targets(
    from_session: str | None = Query(None),
    fmt: str = Query("json", pattern="^(json|table)$"),
    scope: str = Query("all", pattern="^(all|same_tab)$"),
    status: str | None = Query(None, pattern="^(working|idle|permission)$"),
    command: str | None = Query(None, max_length=64),
    username: str = Depends(verify_itl_token),
): ...
```

- 필터는 **순수 함수로 분리**한다: `itl_targets.filter_targets(targets, *, scope, from_session, status, command)`.
  라우트에 조건문을 쌓지 말 것 — 테스트가 붙는 자리다.
- `scope="same_tab"` + `from_session` 없음 → **422** (`"same_tab은 from_session이 필요합니다"`).
  조용히 전역을 돌려주면 모델이 "형제만 봤다"고 착각한다.
- 기존 호출자(`itl` CLI)는 인자를 안 보내므로 기본값으로 동작이 그대로다.

### 6.2 `GET /api/itl/read` — 신규

```python
@router.get("/read")
async def itl_read(
    to: str = Query(..., min_length=1, max_length=200),
    from_session: str | None = Query(None),
    lines: int = Query(40, ge=1, le=MAX_READ_LINES),      # MAX_READ_LINES = 200
    mode: str = Query("excerpt", pattern="^(excerpt|raw)$"),
    username: str = Depends(verify_itl_token),
): ...
```

| 상황 | 응답 |
|---|---|
| 미매치 | 404 `'{to}'에 해당하는 터미널이 없습니다` |
| 2개 이상 | 400 `{ "detail": ..., "matched": ["1.1","2.1"] }` — **주소를 함께 돌려준다** |
| 원격 pane | 400 `remote-unsupported` |
| 세션 없음 | 404 `session-gone` |
| 정상 | `{"addr": "2.1", "sessionId": "...", "mode": "...", "text": "..."}` |

구현:
```python
_rc, pane_text, _err = await tmux_manager._run(
    "capture-pane", "-p", "-S", f"-{lines}", "-t", f"={session_id}:", check=False,
)
text = extract_excerpt(pane_text) if mode == "excerpt" else _tail(pane_text, lines)
```
- `={session_id}:` 표기 그대로. **`=name` 만 쓰면 "can't find pane"** — 기존 함정.
- 응답 텍스트 상한 `MAX_READ_CHARS = 20_000`. 넘으면 뒤에서 자르고 앞에 `…(잘림)` 표시.
- `tmux_manager._run` 은 private 이다. **`tmux_manager.capture_pane(session_id, lines)` 를
  public 메서드로 올리고** `agent_status_service._capture_excerpt` / `telegram_service` 의
  같은 호출도 그걸 쓰게 바꾼다(현재 두 곳이 복붙 상태 — DRY).

### 6.3 `POST /api/itl/key` — 신규 (P2)

```python
ALLOWED_KEYS = {"C-c", "Escape", "Enter", "q"}
```
- 화이트리스트 밖이면 400. `tmux_manager.send_key(session_id, key)` 사용.
- 팬아웃 상한은 send 와 동일(`MAX_FANOUT`).

### 6.4 레이트 리밋 — 신규

에이전트끼리 서로 부르면 루프가 생길 수 있다. 자기 제외(§D6)로 1-hop 루프는 막지만
A→B→A 는 막지 못한다. 소스 세션 기준으로 창을 건다:

```python
from rate_limit import check_rate_limit
check_rate_limit(f"itl:send:{request.from_session or username}", max_attempts=30, window_seconds=60)
```

- `/send` 와 `/key` 에 적용. `/targets` `/resolve` `/read` 는 읽기라 걸지 않는다
  (모델이 폴링으로 기다리는 정상 동작을 막게 된다).
- 429 는 MCP 에서 `isError: true` + `"보내기가 너무 잦습니다(분당 30회). 루프에 빠진 게 아닌지 확인하세요."`

### 6.5 등록

`routes/itl.py` 는 이미 등록돼 있다. **새 라우트는 이 파일에 추가**하고 `main.py` 는 건드리지 않는다.
⚠️ `/read` 를 `/{something}` 형태의 기존 라우트보다 **먼저** 두지 않아도 되지만, 등록 순서 diff 는
CLAUDE.md 규칙대로 확인한다:
```python
[(sorted(r.methods), r.path) for r in main.app.routes]   # 순서 포함해 비교
```

---

## 7. 보안 모델

### 7.1 관문

```
앱 로그인(JWT) → ITL_TOKEN(scope="itl", 30일) → /api/itl/* → 그 사용자 소유 세션만
```

- `ITL_TOKEN` 은 **scoped** 토큰이다. `verify_token` 이 scope 붙은 토큰을 거절하므로
  유출돼도 파일 읽기·호스트 비밀에 닿지 못한다. **이 성질을 깨지 말 것.**
- 대상은 `storage.get_tab_state(username)` 에서 나온다 — **다른 사용자의 pane 은 애초에
  목록에 없다.** 별도 소유권 검사가 필요 없는 이유다.

### 7.2 `terminal_read` 가 넓히는 면 — 정직하게

읽기가 생기면 유출된 `ITL_TOKEN` 은 **보내기 + 읽기 = 사실상 대화형 셸**이 된다. 보내기만
있을 때보다 강하다. 그럼에도 도입하는 근거:

> `ITL_TOKEN` 을 읽으려면 `tmux show-environment` 를 실행해야 하고, 그건 **이미 그 사용자로
> 그 머신에서 명령을 실행할 수 있다는 뜻**이다. 그 상태면 pane 에 직접 타이핑하는 것이 더
> 쉽다. 파일의 약함이 노출을 넓히지 않는다는 Xvnc 비밀번호 절과 같은 논증이다.

- 그래도 끄고 싶은 배포를 위해 `ITL_READ_ENABLED`(기본 `1`) 를 둔다. `0` 이면 `/read` 가
  403 `"읽기가 비활성화돼 있습니다"`.
- **CLAUDE.md 의 itl 함정 목록에 이 문장을 추가한다.** 문서화되지 않은 권한 확대는 안 된다.

### 7.3 안 하는 것

- 텍스트 화이트리스트 없음. `terminal_send` 는 임의 텍스트를 보낸다 — 그게 이 도구의 목적이고,
  경계는 "그 pane 이 이미 당신 것"이라는 사실이다. (Telegram 자유텍스트와 같은 판단)
- 다만 **`submit` 기본 false** 는 절대 뒤집지 않는다. vim/claude 한가운데의 엔터는 사고다.

---

## 8. 함정 (실제로 밟은 것 + 예상되는 것)

| # | 함정 | 대응 |
|---|---|---|
| T1 | **stdout 에 print 하나** → 클라이언트가 서버를 죽은 것으로 본다 | 로그는 전부 stderr. 테스트가 stdout 을 파싱해 검증 |
| T2 | notification(`id` 없음)에 응답 → 프로토콜 위반 | `if "id" not in msg: return None` 을 디스패처 최상단에 |
| T3 | `send-keys -t =name` → "can't find pane" | `=name:` (콜론 필수). 기존 함정, `capture-pane` 도 동일 |
| T4 | `send_keys -l "C-c"` → 리터럴 타이핑 | 키는 `send_key` 로. 기존 Telegram 함정 |
| T5 | 번호를 들고 있다가 나중에 사용 | 주소는 **호출 시점에 즉시 해소**. 세션 ID 로만 라우팅 |
| T6 | 에이전트가 자기에게 보내 루프 | `include_self` 기본 false + 레이트 리밋 |
| T7 | `@all` 오타로 전 터미널에 명령 | `confirm_fanout` + `MAX_FANOUT` |
| T8 | 원격 pane 이 조용히 누락 | `skipped: remote-unsupported` 로 **명시적 보고**. 기존 규칙 |
| T9 | 30일 뒤 `ITL_TOKEN` 만료, MCP 프로세스는 살아 있음 | 401 을 "터미널을 새로 열어달라고 사용자에게 요청" 문구로. 재발급 시도 안 함 |
| T10 | `json.dumps(indent=…)` → 개행이 들어가 프레이밍 파괴 | indent 금지. 테스트로 개행 없음 검증 |
| T11 | 탭 이름에 `.` 이 들어감 (`api.v2`) | `_split_addr` 는 뒤쪽이 INT/`@WORD` 일 때만 분리 |
| T12 | `scope=same_tab` 인데 `from_session` 없음 → 전역이 형제로 오인 | 422 로 거절 |
| T13 | 라우트 등록 순서 변경으로 조용한 오라우팅 | 등록 전후 route 리스트를 **순서 포함** diff |

---

## 9. 코드 스켈레톤 (`backend/cli/itl_mcp.py`)

```python
#!/usr/bin/env python3
"""itl-mcp — MCP server exposing sibling terminals to the agent in this pane.

Stdlib only, on purpose: it must run on a remote host with a single file copy,
same rule as backend/cli/itl. Identity comes from the env tmux injects at
session creation: ITL_API / ITL_TOKEN / ITL_SESSION.

stdout carries JSON-RPC and nothing else. Every log line goes to stderr.
"""
import json, os, sys, time, urllib.error, urllib.parse, urllib.request

API = os.environ.get("ITL_API", "http://127.0.0.1:38822").rstrip("/")
TOKEN = os.environ.get("ITL_TOKEN", "")
SESSION = os.environ.get("ITL_SESSION", "")

PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")
FANOUT_CONFIRM_THRESHOLD = 5
POLL_SEC = 2.0
HTTP_TIMEOUT = 15

TOOLS = [ ... ]              # §5.3 그대로. 스키마는 이 리스트가 유일한 출처.


class ToolError(Exception):
    """Recoverable failure the model should read and retry differently."""


def _log(msg):
    if os.environ.get("ITL_MCP_DEBUG"):
        print(msg, file=sys.stderr, flush=True)


def _api(method, path, params=None, body=None):
    """HTTP to the backend. Raises ToolError with a sentence meant for the model."""
    ...


# --- tool implementations: each returns a plain string ---------------------
def tool_terminal_list(args): ...
def tool_terminal_whoami(args): ...
def tool_terminal_resolve(args): ...
def tool_terminal_send(args): ...
def tool_terminal_read(args): ...
def tool_terminal_wait(args): ...

HANDLERS = {"terminal_list": tool_terminal_list, ...}


# --- protocol -------------------------------------------------------------
def handle(msg):
    """Returns a response dict, or None for notifications."""
    if "id" not in msg:
        return None                      # notification: never answer
    method = msg.get("method")
    ...


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            _write({"jsonrpc": "2.0", "id": None,
                    "error": {"code": -32700, "message": "Parse error"}})
            continue
        response = handle(msg)
        if response is not None:
            _write(response)


def _write(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()
```

파일 크기 목표: **400줄 이하.** 넘으면 `itl_mcp_tools.py` 로 도구 구현만 분리한다
(프로토콜 층과 도구 층은 서로 모르게).

---

## 10. 테스트 계획

> 규칙: **테스트 통과 ≠ 안전.** 이 저장소는 라우트 순서·patch 표적·F821 로 여러 번 데였다.
> 아래는 최소선이고, §12 의 수동 검증을 반드시 함께 한다.

### 10.1 `backend/tests/test_itl_targets.py` (확장)

- §4.5 표 전체를 `@pytest.mark.parametrize` 로. **표와 테스트가 1:1 이어야 한다.**
- 기존 케이스 전부 무수정 통과 (하위호환 회귀 방지)
- `filter_targets` 단위 테스트: scope/status/command 조합

### 10.2 `backend/tests/test_itl_read.py` (신규)

- `tmux_manager.capture_pane` 를 monkeypatch. 실제 tmux 없이.
- 케이스: 정상 excerpt / 정상 raw / 미매치 404 / 다중매치 400+matched / 원격 400 /
  세션없음 404 / lines 상한 초과 422 / `ITL_READ_ENABLED=0` 403 / 20k 초과 잘림

### 10.3 `backend/tests/test_itl_mcp.py` (신규)

가짜 `_api` 를 주입하고 `handle()` 을 직접 부른다. 실제 HTTP·stdin 없이.

| 케이스 | 검증 |
|---|---|
| `initialize` | 클라이언트 버전 에코 / 미지원 버전 → 최신 반환 |
| `notifications/initialized` | **`None` 반환** (응답 없음) |
| `tools/list` | 모든 도구가 `name`/`description`/`inputSchema` 를 갖는다. 스키마가 유효한 JSON Schema object |
| 없는 메서드 | `-32601` |
| 깨진 JSON | `-32700` |
| `tools/call` 없는 도구 | `isError: true` (JSON-RPC error 아님) |
| `terminal_send` 자기 자신 | 기본 제외됨 |
| `terminal_send` 대상 6개 + confirm 없음 | 보내지 않고 안내. `_api` 의 POST 호출 0회 |
| `terminal_send` 대상 6개 + confirm | POST 1회 |
| `terminal_wait` 즉시 충족 | 폴링 1회, `reached: true` |
| `terminal_wait` timeout | `reached: false`, `isError: false` |
| 모든 응답 | `json.dumps` 결과에 `\n` 없음 (T10) |
| 401 / 연결실패 | 규격 문구(§5.2) 그대로 |

### 10.4 `frontend` — 없음

이 작업은 프론트를 건드리지 않는다.

---

## 11. 등록 방법 (문서에 넣을 것)

```bash
# Claude Code (이 프로젝트에서만)
claude mcp add itl -- python3 /home/ubuntu/app/jupyterLab/notebooks/iTerminaLlist/backend/cli/itl_mcp.py

# 전역
claude mcp add -s user itl -- python3 <repo>/backend/cli/itl_mcp.py
```

```jsonc
// opencode / 기타 클라이언트 (mcpServers 형식)
{
  "mcpServers": {
    "itl": { "command": "python3", "args": ["<repo>/backend/cli/itl_mcp.py"] }
  }
}
```

- **env 는 적지 않는다.** 에이전트 CLI 가 pane 안에서 뜨므로 `ITL_*` 를 자동 상속한다.
  설정에 토큰을 박으면 그 파일이 커밋될 위험만 생긴다.
- 앱 밖에서 띄우면 `ITL_TOKEN` 이 없다 → **서버는 정상 기동하고**, 도구 호출 시에만
  §5.2 의 안내 문구를 돌려준다. (기동 실패시키면 클라이언트가 이유 없이 "서버 실패"만 띄운다)

---

## 12. 작업 분해 (GLM 용 — 단계별 완료 조건)

각 단계는 **독립 커밋**. 앞 단계가 초록이 아니면 다음으로 가지 않는다.

### Phase 1 — 주소 문법 v2 (백엔드만, MCP 없음)
- [ ] `itl_targets.resolve` 를 `_split_addr` / `_select_tab` / `_select_pane` 로 재구성
- [ ] `@here` `@siblings` 추가, `tabsel.@WORD` 추가
- [ ] `filter_targets` 순수 함수 추가
- [ ] `GET /targets` 에 `scope`/`status`/`command` 인자
- **DoD**: §4.5 표 전체 통과 + 기존 `test_itl_targets.py` 무수정 통과 + `itl list` 가 그대로 동작

### Phase 2 — 읽기 엔드포인트
- [ ] `tmux_manager.capture_pane()` public 메서드 (기존 두 복붙 자리도 이걸 쓰게 교체)
- [ ] `GET /api/itl/read`
- [ ] `ITL_READ_ENABLED` 스위치
- **DoD**: `test_itl_read.py` 전부 통과. 실제 세션에서 `curl` 로 화면이 나온다

### Phase 3 — MCP 서버 본체
- [ ] 프로토콜 층 (`initialize` / `tools/list` / `tools/call` / `ping` / 에러)
- [ ] 도구 6개 (`list` `whoami` `resolve` `send` `read` `wait`)
- [ ] 실행 래퍼 `backend/cli/itl-mcp`
- **DoD**: `test_itl_mcp.py` 전부 통과 + §12.1 수동 검증 통과

### Phase 4 — 안전장치
- [ ] `/send` 레이트 리밋
- [ ] `confirm_fanout` 경로
- [ ] `terminal_key` + `POST /api/itl/key` (선택)
- **DoD**: 분당 31번째 send 가 429, MCP 가 안내 문구로 바꿔 보여준다

### Phase 5 — 문서
- [ ] `CLAUDE.md` 의 "Terminal-to-terminal messaging (`itl`)" 절에 **MCP 하위 절 추가**:
      새 주소 예약어 표, MCP 도구 목록, 등록 명령, §7.2 의 읽기 권한 확대 문장, 함정 T1/T2
- [ ] `README.md` / `README.ko.md` 에 한 줄 + 등록 명령
- **DoD**: 문서만 읽고 처음 보는 사람이 등록해서 쓸 수 있다

### 12.1 수동 검증 (테스트가 못 잡는 것)

⚠️ **실행 중인 앱에 브라우저로 붙지 말 것** (탭 복원이 사용자 tmux 세션을 가져간다).
아래는 전부 터미널에서 한다.

1. 앱에서 탭 하나를 2분할 → 왼쪽 pane 에서 `claude` 실행
2. `claude mcp add itl -- python3 <repo>/backend/cli/itl_mcp.py` 후 `/mcp` 로 연결 확인
3. "같은 탭에 뭐가 열려 있어?" → `terminal_list` 가 형제만 반환하는지
4. "옆 터미널에 `date` 라고 입력해줘" → 오른쪽 pane 프롬프트에 텍스트가 뜨고 **엔터는 안 쳐졌는지**
5. "옆 터미널 화면 읽어줘" → `terminal_read`
6. 오른쪽에서 긴 작업 실행 → "옆이 끝나면 알려줘" → `terminal_wait` 가 끝나고 반응하는지
7. 탭 2개 만들고 2번 탭에서 `glm` 실행 → 1번 탭에서 "2번 탭 glm한테 인사해줘" → `2.@glm` 로 가는지
8. **프로토콜 확인 (브라우저 없이)**:
   ```bash
   printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
     '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
     '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
   | python3 backend/cli/itl_mcp.py
   ```
   → 응답이 **정확히 2줄**이어야 한다(notification 에 응답이 없으므로).

---

## 13. 수용 기준 (이게 되면 끝)

- [ ] pane 안 에이전트에게 "같은 탭에 뭐 열려 있어?" 라고 하면 형제 목록이 나온다
- [ ] "2번 탭 glm한테 시켜" 가 `2.@glm` 로 첫 시도에 해소된다
- [ ] 시켜놓고 → 기다리고 → 화면 읽어서 → 보고하는 흐름이 한 대화 안에서 된다
- [ ] `pip install` 없이 원격 호스트에 파일 하나 복사로 동작한다
- [ ] 자기 자신에게 보내지지 않는다
- [ ] `submit` 기본이 false 다
- [ ] 원격 pane 은 조용히 실패하지 않고 이유를 말한다
- [ ] 백엔드 어디에서도 LLM API 를 부르지 않는다
- [ ] 기존 `itl` CLI 동작이 하나도 바뀌지 않았다

---

## 14. 나중에 (지금은 안 한다)

| 항목 | 왜 미루나 |
|---|---|
| MCP resources (`itl://targets`) | tools 로 충분. 클라이언트별 지원 편차가 크다 |
| MCP prompts | 프롬프트 템플릿은 사용자 몫 |
| 원격 pane send/read | SSH 왕복 설계가 별도 작업 (`host_manager` 경유) |
| 우편함(비동기 답장 큐) | orca 흡수 로드맵 P2 의 나머지 절반. 주소 체계가 안정된 뒤 |
| 프론트에 "메시지 수신" 표시 | 지금은 그냥 프롬프트에 글자가 뜬다. 충분히 자명하다 |
| Streamable HTTP 전송 | 새 인바운드를 여는 일이라 근거가 더 필요하다 |

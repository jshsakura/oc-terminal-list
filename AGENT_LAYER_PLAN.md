# Agent Layer 계획

Terminal List에 **옵트인 다중 에이전트 레이어**를 얹는 계획. wikidocs/347755 의 "tmux 멀티페인 + 역할별 CLAUDE.md + 원격 제어" 흐름을 시스템에 내장하되, 기본 정체성(범용 웹 터미널)은 절대 깨지 않는다.

---

## 1. 3대 원칙 (가드레일)

### 1.1 범용 터미널이 기본
- 에이전트/스킬/팀 기능은 **옵트인 부가 레이어**다. 메인 진입점·기본 네비게이션·첫 진입 경험을 절대 차지하지 않는다.
- 에이전트 UI는 별도 사이드바 섹션 또는 별도 탭으로 격리. 기본 상태는 **빈 채로 시작** (스킬 0개, 팀 0개).
- 백엔드 라우트도 `/api/agents/*`, `/api/skills/*`, `/api/teams/*` 로 prefix 격리.

### 1.2 LLM API 직접 호출 금지
- 백엔드는 Anthropic / OpenAI / 기타 LLM API를 **절대 직접 부르지 않는다**.
- 우리가 다루는 건 오직: tmux 페인 관리 + stdin 주입(`tmux send-keys`) + stdout 캡처(`ws_bridge.py`).
- 사용자 호스트의 CLI(`claude`, `codex`, `aider`, `gemini`, `opencode` …)에 명령어를 흘려보낼 뿐. **LLM 벤더 중립**.
- 결과: API 키가 우리 DB·백엔드 통과 안 함, 새 외부 의존성 0, 새 보안면 0, 결제는 사용자 책임.

### 1.3 Git native, lazy install
- 스킬은 git 저장소에서 받는다. 번들 0개로 시작.
- `git sparse-checkout` 으로 단일 스킬만 받고, 업데이트는 `git pull`, 삭제는 폴더 제거.
- Oh My Zsh 보다 Homebrew/vim-plug 결.

---

## 2. 사용자 흐름

```
호스트 선택 → 작업 폴더 선택 → 팀 프리셋 선택 → "팀 시작"
                                                    ↓
                  worktree N개 생성 (역할별)
                  각 페인 cwd 에서 CLI(claude 등) 실행
                  (선택) 시작 프롬프트 자동 입력
```

기존 `HostList` → `RemoteFolderPicker` / `LocalFolderPicker` 컴포넌트를 재활용하고, "팀 프리셋 선택" 한 단계만 추가한다.

---

## 3. 디렉토리 구조

```
~/.octerm/
   sources.json            ← 카탈로그 git URL 레지스트리 (기본 0~1개)
   skills/<source>/<name>/ ← 사용자가 추가한 스킬만 (lazy)
      skill.yaml
      CLAUDE.md
      settings.json (선택)
   teams/<name>.yaml       ← 팀 프리셋 (스킬 조합)
```

워크트리는 사용자의 프로젝트 디렉토리 옆 `.octerm/worktrees/<team-id>/<role>/` 로 만든다 (또는 임시 디렉토리). git 저장소가 아닌 폴더에서 팀 시작 시도 시: 안내 후 거부 (또는 git init 옵션 제공).

---

## 4. 데이터 모델

### 4.1 `skill.yaml`

```yaml
name: pm
display: "Product Manager"
icon: "📋"

# 어떤 CLI 를 띄울지. claude, codex, aider, gemini, opencode 등.
command: claude
args: []                          # 선택. CLI 옵션
env: {}                           # 선택. 환경변수

# 역할 정의: 페인 cwd 에 CLAUDE.md 로 떨어지거나 시작 프롬프트로 주입.
claude_md: |
  당신은 PM 입니다. 작업을 분해하고 명세를 작성하세요...

# 시야 제한 (git sparse-checkout 패턴).
sparse_paths:
  - "docs/**"
  - "specs/**"
  - "README.md"

# Claude Code .claude/settings.json 으로 떨어짐 (해당 CLI 한정).
allowed_tools: [Read, Grep, WebSearch]
denied_tools: [Edit, Write, Bash]

# 팀 시작 직후 페인 stdin 에 자동 입력될 첫 프롬프트.
start_prompt: "현재 백로그를 읽고 다음 스프린트를 제안해줘"
```

### 4.2 `sources.json`

```json
{
  "sources": [
    { "name": "official", "url": "https://github.com/<org>/oma-skills.git" }
  ]
}
```

기본값은 0개 또는 official 1개. 사용자가 UI 에서 추가.

### 4.3 `teams/<name>.yaml`

```yaml
name: feature-dev
display: "기능 개발 팀"
roles:
  - skill: pm
  - skill: dev
  - skill: reviewer
layout: "horizontal"   # tmux 페인 분할 방향
```

---

## 5. 백엔드 변경

추가되는 라우트는 다음 정도. 모두 `/api` 하위 별도 prefix.

```
GET    /api/skills              ← 설치된 스킬 목록 (~/.octerm/skills 스캔)
POST   /api/skills/install      ← { source, name } → sparse-checkout 으로 받기
DELETE /api/skills/:id          ← 폴더 제거
POST   /api/skills/update       ← git pull (전체 또는 단건)

GET    /api/sources             ← sources.json 읽기
POST   /api/sources             ← URL 추가
DELETE /api/sources/:name       ← 제거

GET    /api/teams               ← 팀 프리셋 목록
POST   /api/teams               ← 새 팀 yaml 생성
POST   /api/teams/:name/start   ← { host, cwd } → worktree+페인 오케스트레이션

POST   /api/panes/:id/send      ← stdin 텍스트 주입 (이미 ws_bridge 인프라 존재)
```

새 외부 의존성은 없다. yaml 파싱은 `pyyaml` 정도만 추가.

---

## 6. 페인 실행 메커니즘

`POST /api/teams/:name/start` 의 동작:

1. 대상 호스트의 작업 폴더가 git 저장소인지 확인.
2. 각 역할에 대해 worktree 생성:
   ```sh
   git -C <project> worktree add .octerm/worktrees/<team-id>/<role> -b agent/<role>
   ```
3. 각 worktree 에 `CLAUDE.md` 와 `.claude/settings.json` 떨어뜨림 (스킬 yaml 에서 생성).
4. (선택) `git sparse-checkout set <paths>` 적용.
5. tmux 세션에 페인 N개 분할.
6. 각 페인에 진입 명령 주입:
   ```sh
   tmux send-keys -t <session>:<pane> "cd <worktree> && <command> <args>" Enter
   ```
7. (선택) `start_prompt` 가 있으면 짧은 지연 후 stdin 으로 추가 주입.

**핵심: 6번까지는 모두 기존 `tmux_manager.py` + `ws_bridge.py` 에 이미 있는 기능의 조합이다.** 새 코드는 1~5의 오케스트레이션 + yaml 파서.

---

## 7. 프론트엔드 변경

### 7.1 신규 컴포넌트
- `AgentSidebar.jsx` — 사이드바 옵트인 섹션 ("Agents" 토글). 기본 닫힘.
- `SkillCatalog.jsx` — sources.json 의 카탈로그 인덱스 검색·설치 UI. 검색 시점엔 다운로드 X.
- `TeamPicker.jsx` — 호스트·폴더 선택 후 팀 프리셋 고르는 모달.
- `TeamRunner.jsx` — 팀 진행 상태 (페인별 상태 라벨).

### 7.2 기존 컴포넌트 재활용
- `HostList`, `RemoteFolderPicker`, `LocalFolderPicker` — 그대로.
- `PaneGrid`, `Terminal` — 그대로. 에이전트 페인이라고 별도 처리 없음.
- `MobileToolbar` — "팀에 지시 보내기" 버튼은 *옵션* 으로 추가 (에이전트 모드 활성화 시에만 표시).

### 7.3 정체성 보호 체크리스트
- [ ] 첫 로그인 후 화면에 에이전트 관련 UI가 자동으로 보이지 않는다.
- [ ] 사이드바에서 "Agents" 섹션을 켜야 비로소 노출된다.
- [ ] 스킬 0개·팀 0개 상태에서도 터미널은 평소처럼 동작한다.

---

## 8. 단계

### Phase 1 — 최소 동작 (1차 PR)
- `~/.octerm/` 디렉토리 매니저
- `skill.yaml` 스키마 정의 + 검증
- `GET /api/skills`, `POST /api/skills/install` (단일 source 하드코딩 OK)
- 사이드바 옵트인 토글 + `SkillCatalog` 최소 UI
- "팀 시작" 은 1개 스킬·1개 페인으로만 동작

### Phase 2 — 멀티 역할
- 팀 yaml + 다중 worktree 오케스트레이션
- `git sparse-checkout` 적용
- 페인별 시작 프롬프트 자동 주입
- 모바일 "팀에 지시" 라우팅

### Phase 3 — 카탈로그 / 공유
- `sources.json` UI
- 스킬/팀 export, import
- 업데이트 알림

---

## 9. 미결정

- **기본 카탈로그 소스**: 사용자가 언급한 "ecc" 의 정확한 출처 미확인. Phase 1 단계에서는 sources.json 을 빈 채로 출시하고, 사용자 직접 추가하도록.
- **CLI 미설치 처리**: 호스트에 `claude` 가 없을 때의 UX (안내 모달 vs CLI 자동 설치 가이드).
- **Worktree 정리 정책**: 팀 종료 시 worktree 자동 제거 vs 보존 (사용자 머지 흐름 보호).
- **권한**: 에이전트 기능에 대한 별도 권한 설정 필요 여부 (관리자만 / 모든 사용자).

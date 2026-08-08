# Terminal List

🌐 [English](./README.md) | 🇰🇷 [한국어](./README.ko.md) | 🐳 GHCR Container | 🖥️ Host-native 권장

[![GHCR Publish](https://github.com/jshsakura/oc-terminal-list/actions/workflows/ghcr-publish.yml/badge.svg)](https://github.com/jshsakura/oc-terminal-list/actions/workflows/ghcr-publish.yml)
[![GHCR Image](https://img.shields.io/badge/ghcr.io-jshsakura%2Foc--terminal--list-blue?logo=docker)](https://github.com/jshsakura/oc-terminal-list/pkgs/container/oc-terminal-list)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](#라이선스)

빠르고 자체 호스팅 가능한 웹 터미널. 지속형 `tmux` 세션, 파일 탐색, SSH 호스트 관리, 모바일 친화적 서버 접속을 지원합니다.

**[▶ 라이브 데모](https://jshsakura.github.io/oc-terminal-list/#demo)** — 샘플 호스트로 스크립트 재생, 설치·가입·실제 쉘 없음. 전체 소개와 스크린샷은 [프로젝트 사이트](https://jshsakura.github.io/oc-terminal-list/)에서 확인하세요.

> Docker로 빠르고 격리된 배포가 가능합니다. **Host-native 설치를 권장합니다** — 앱이 실제 호스트 셸, 호스트 `tmux`, SSH 도구, 로컬 워크스페이스를 직접 제어할 수 있습니다.

```text
# 아래 내용을 AI 코딩 어시스턴트에 붙여넣으면 설치 가이드를 받을 수 있습니다
Install Terminal List from this repository and choose the best mode for my server:
https://github.com/jshsakura/oc-terminal-list

실제 호스트 제어가 필요하면 host-native systemd를 선택하세요.
격리된 컨테이너 터미널이 필요하면 GHCR Docker를 선택하세요.
```

---

## 목차

- [소개](#소개)
- [스크린샷](#스크린샷)
- [기능](#기능)
- [설치 모드](#설치-모드)
- [빠른 시작: Docker / GHCR](#빠른-시작-docker--ghcr)
- [권장: Host-native systemd](#권장-host-native-systemd)
- [데이터 모델: Docker vs host-native](#데이터-모델-docker-vs-host-native)
- [설정](#설정)
- [첫 로그인과 2FA](#첫-로그인과-2fa)
- [앱 사용법](#앱-사용법)
- [운영](#운영)
- [보안 모델](#보안-모델)
- [리버스 프록시 / HTTPS](#리버스-프록시--https)
- [개발자 설정](#개발자-설정)
- [프로젝트 구조](#프로젝트-구조)
- [문제 해결](#문제-해결)
- [로드맵](#로드맵)
- [관련 문서](#관련-문서)
- [라이선스](#라이선스)

---

## 소개

Terminal List는 사용자가 소유한 머신을 위한 브라우저 기반 터미널 워크스페이스입니다.

다음 기능을 결합합니다:

- 지속형 호스트 `tmux` 세션 기반 웹 터미널
- 분할 pane + 동시 입력(브로드캐스트), pane 단위 제외
- VS Code 스타일의 파일 탐색기 및 에디터 (워크스페이스 디렉토리 범위)
- SSH 호스트/키 관리
- 단일 관리자 로그인 + 선택적 TOTP 2FA + 패스키(WebAuthn)
- 음성 입력으로 핸즈프리 명령 입력
- 데스크톱, 태블릿, 모바일에서 작동하는 반응형 UI

노트북 스타일 원격 셸보다 빠르고 직관적인 가벼운 터미널 대시보드가 필요할 때 유용합니다.

---

## 스크린샷

### 분할 pane과 브로드캐스트

탭 하나를 필요한 만큼 분할합니다. **브로드캐스트**를 켜면 타이핑이 탭 안의 다른 pane으로 모두 복제되고, 대상 pane에는 앰버 테두리와 배지가 붙습니다. 배지의 `✕`를 누르면 그 pane만 빠집니다(입력을 받지도, 보내지도 않음).

![브로드캐스트가 켜진 분할 pane, 하나는 제외됨](docs/screenshots/broadcast.png)

### 빠른 입력 — 탭을 아우르는 대상 선택

명령을 한 번 작성하고, 어느 터미널로 보낼지 고릅니다. 열려 있는 모든 탭의 pane이 탭별로 묶여 나오고, 탭 이름을 누르면 그 탭 전체가 한 번에 선택됩니다. 아무것도 고르지 않으면 활성 pane으로 갑니다.

<p align="center">
  <img src="docs/screenshots/send-to.png" alt="탭별로 묶인 보낼 대상 선택 팝업" width="380">
</p>

### 홈 대시보드

![연결·실행 중인 세션·사용 통계를 보여주는 홈 대시보드](docs/screenshots/home.png)

### 모바일

분할은 서브탭으로 접히고, 키 툴바가 `Esc`·`Tab`·`Ctrl+C`·방향키·붙여넣기를 제공합니다. 빠른 입력은 모바일 한글 IME의 자소 분리 문제를 우회합니다.

<p align="center">
  <img src="docs/screenshots/mobile.png" alt="서브탭과 키 툴바가 있는 모바일 화면" width="300">
  <img src="docs/screenshots/mobile-quick-input.png" alt="모바일 빠른 입력" width="300">
</p>

---

## 기능

| 영역 | 기능 |
| --- | --- |
| 터미널 | xterm.js 터미널 UI, 지속형 `tmux` 세션, 재연결 친화적 WebSocket 브릿지, 예측 입력(mosh 방식 로컬 에코), 제자리 세션 재시작(같은 경로에 새 셸) |
| 분할 | 오른쪽/아래 분할, 2×2 그리드, 드래그 크기 조절, 균등 분할(중첩 분할에서도 모든 pane이 같은 면적), pane을 새 탭으로 분리 |
| 브로드캐스트 | 탭 안의 모든 pane에 타이핑을 동시 입력, pane 단위로 즉시 제외 |
| 빠른 입력 | 명령을 작성해 원하는 pane들로 전송(탭별 그룹 선택), 음성 받아쓰기(Web Speech API), 터미널별 명령 이력 (무한 스크롤) |
| 세션 | SQLite 기반 세션 메타데이터 및 복원 |
| 파일 | 워크스페이스 범위 파일 탐색기, Monaco 에디터, 내용 검색(ripgrep), 선택한 폴더로 업로드, 생성/이동/삭제 |
| Git | pane이 속한 저장소의 변경 목록과 브랜치 표시 |
| 스니펫 | 저장한 명령을 `Ctrl+Shift+S` 로 열어 포커스된 pane에서 실행 |
| SSH | 호스트 및 키 관리, 암호화된 비밀 저장소 |
| 인증 | 초기 관리자 설정, JWT 세션, 선택적 TOTP 2FA, 일회성 백업 코드, 패스키(WebAuthn) |
| Vault | SSH 비밀번호, 개인키 암호문, OTP 비밀이 `data/.vault-key`로 Fernet 암호화 |
| UI | 59종 테마, pane별 테마 오버라이드, 언어 전환(한/영), 모바일 서브탭·키 툴바, 반응형 레이아웃 |
| 성능 | Gzip/Brotli, 장기 정적 자산 캐시, 지연 로딩 프론트엔드 청크, Monaco idle prefetch, WebSocket 배치, WebGL 렌더러 |
| 배포 | GHCR Docker 이미지, Compose 예시, systemd host-native 서비스 |

### AI 에이전트 (MCP) 브릿지

`itl`은 MCP 서버(`backend/cli/itl_mcp.py`)로도 노출돼, pane 안의 AI 코딩 에이전트가 형제 터미널에 명령을 보내고·화면을 읽고·작업 완료를 기다리고·특수 키를 보낼 수 있습니다. 동일한 스코프 `ITL_TOKEN`으로 통제됩니다.

```bash
# Claude Code (프로젝트 로컬)
claude mcp add itl -- python3 <repo>/backend/cli/itl_mcp.py

# opencode / 기타 클라이언트 (mcpServers 형식)
{ "itl": { "command": "python3", "args": ["<repo>/backend/cli/itl_mcp.py"] } }
```

환경 변수(`ITL_API` / `ITL_TOKEN` / `ITL_SESSION`)는 pane에서 자동 상속됩니다 — `ITL_TOKEN`을 설정 파일에 박지 마세요.

---

## 설치 모드

| 모드 | 추천 대상 | 터미널 실행 위치 | 데이터 위치 | 권장 여부 |
| --- | --- | --- | --- | --- |
| **Host-native / systemd** | 실제 서버 제어, 호스트 셸, 호스트 `tmux`, 직접 워크스페이스 접근 | 호스트 | `.env`의 호스트 경로 | **권장** |
| **Docker / GHCR** | 빠른 체험, 격리 배포, 간단한 롤백 | 컨테이너 | 마운트된 `./data` 및 `./workspace` | 지원됨 |
| **로컬 개발** | 백엔드/프론트엔드 개발 | 개발 셸 | 로컬 경로 | 개발자용 |

Host-native가 기본 모드인 이유: 이 프로젝트는 터미널 도구입니다. 컨테이너 격리는 패키징에 좋지만, 셸·파일시스템·SSH 에이전트·`tmux` 서버가 컨테이너 범위로 제한됩니다. 호스트 리소스를 직접 마운트하고 연결하지 않으면 제약이 있습니다.

---

## 빠른 시작: Docker / GHCR

Docker로 가장 빠르게 앱을 체험할 수 있습니다.

> 기본 포트: **38822**. `3000`, `5173`, `8000`, `8080`, `8888` 등 일반적인 개발 포트를 피합니다. `APP_PORT`로 자유롭게 변경하세요.

### 방법 A: 저장소의 `compose.yml` 사용

```bash
git clone https://github.com/jshsakura/oc-terminal-list.git
cd oc-terminal-list

docker compose up -d
docker compose logs -f backend
```

접속:

```text
http://localhost:38822
```

다른 포트 사용:

```bash
# 일회성
APP_PORT=9000 docker compose up -d

# 이 체크아웃에 영구 적용
echo "APP_PORT=9000" >> .env
docker compose up -d
```

### 방법 B: 최소 Compose 파일 작성

```bash
mkdir oc-terminal-list && cd oc-terminal-list

cat > compose.yml <<'EOF'
services:
  backend:
    image: ghcr.io/jshsakura/oc-terminal-list:latest
    container_name: oc-terminal-list
    ports:
      - "${APP_PORT:-38822}:${APP_PORT:-38822}"
    environment:
      - HOST=0.0.0.0
      - APP_PORT=${APP_PORT:-38822}
      - DB_PATH=/app/data/iterminallist.db
      - WORKSPACE_ROOT=/workspace
    volumes:
      - ./data:/app/data
      - ./workspace:/workspace
    restart: unless-stopped
EOF

docker compose up -d
```

### Docker 동작 방식

- 웹 서비스는 `${APP_PORT:-38822}`에서 수신합니다.
- 터미널 셸은 컨테이너 내부에서 실행됩니다.
- 앱 데이터는 `./data` → `/app/data`로 마운트됩니다.
- 편집 가능한 워크스페이스 파일은 `./workspace` → `/workspace`로 마운트됩니다.
- JWT 서명 키는 `data/.jwt-secret`에 자동 생성되며, 브라우저 세션은 HttpOnly 쿠키를 사용합니다.
- Vault 암호화 키는 `/app/data/.vault-key`로 자동 생성됩니다.

---

## 권장: Host-native systemd

Terminal List가 실제 호스트 환경에서 동작해야 할 때 사용합니다.

### 사전 요구 사항

- Linux 호스트
- Python 3.12 권장
- Node.js 20 권장 (프론트엔드 빌드용)
- `tmux`
- `sqlite3` CLI 권장 (백업 작업용)
- `bash` 또는 선호하는 호스트 셸

Debian/Ubuntu 계열에서 OS 패키지 설치:

```bash
sudo apt-get update
sudo apt-get install -y python3 python3-venv nodejs npm tmux sqlite3
```

### 설치

```bash
git clone https://github.com/jshsakura/oc-terminal-list.git
cd oc-terminal-list

cp .env.example .env
```

호스트에 맞게 `.env` 편집:

```bash
# Host-native 예시 값
APP_PORT=38822
HOST=0.0.0.0
DB_PATH=/var/lib/iterminallist/iterminallist.db
VAULT_KEY_PATH=/var/lib/iterminallist/.vault-key
WORKSPACE_ROOT=/srv/iterminallist/workspace
TMUX_SOCKET_NAME=iterminallist-app
LOG_LEVEL=INFO
```

호스트 소유 런타임 디렉토리 생성:

```bash
sudo mkdir -p /var/lib/iterminallist /srv/iterminallist/workspace
sudo chown -R "$USER:$USER" /var/lib/iterminallist /srv/iterminallist/workspace
```

의존성 설치 및 프론트엔드 빌드:

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt

cd frontend
npm install
npm run build
cd ..
```

서비스 등록:

```bash
# 중요: 먼저 deploy/iterminallist.service를 검토하세요.
# User, Group, WorkingDirectory, EnvironmentFile, ExecStart 경로가 호스트에 맞아야 합니다.
sudo cp deploy/iterminallist.service /etc/systemd/system/iterminallist.service
sudo systemctl daemon-reload
sudo systemctl enable --now iterminallist.service
```

상태 확인:

```bash
systemctl status iterminallist.service
journalctl -u iterminallist.service -f
```

접속:

```text
http://localhost:38822
```

> 전체 호스트 운영 가이드: [`deploy/README.md`](./deploy/README.md)

---

## 데이터 모델: Docker vs host-native

마이그레이션이 목적이 아니라면 Docker와 host-native 데이터를 분리하세요.

| 모드 | DB | Vault 키 | 워크스페이스 |
| --- | --- | --- | --- |
| Docker | `./data/iterminallist.db` → `/app/data/iterminallist.db` | `./data/.vault-key` → `/app/data/.vault-key` | `./workspace` → `/workspace` |
| Host-native | `.env`의 `DB_PATH` | `.env`의 `VAULT_KEY_PATH` (또는 기본값 `data/.vault-key`) | `.env`의 `WORKSPACE_ROOT` |

규칙:

1. `iterminallist.db`와 `.vault-key`는 항상 함께 백업하세요.
2. `.vault-key`를 분실하면 암호화된 SSH 비밀번호, 개인키 암호문, OTP 비밀을 복원할 수 없습니다.
3. Docker와 systemd를 같은 `data/` 디렉토리에 무분별하게 연결하지 마세요. 파일 소유권 및 vault-key 불일치로 비밀이 손상될 수 있습니다.
4. 마이그레이션 시 앱을 먼저 중지하고, DB와 `.vault-key`를 모두 복사한 뒤 대상 모드에서 재시작하세요.

---

## 설정

핵심 환경 변수:

| 변수 | 기본값 / 예시 | 설명 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | FastAPI / uvicorn 바인드 주소 |
| `APP_PORT` | `38822` | 웹 서비스 포트 |
| `DB_PATH` | `/var/lib/iterminallist/iterminallist.db` 또는 `/app/data/iterminallist.db` | SQLite 데이터베이스 경로 |
| `VAULT_KEY_PATH` | `/var/lib/iterminallist/.vault-key` 또는 `/app/data/.vault-key` | Fernet 마스터 키 경로 (암호화된 비밀용) |
| `WORKSPACE_ROOT` | `/srv/iterminallist/workspace` 또는 `/workspace` | 파일 탐색기에 노출되는 루트 디렉토리 |
| `TMUX_SOCKET_NAME` | `iterminallist-app` | 전용 `tmux -L` 소켓 네임스페이스 |
| `TMUX_HISTORY_LIMIT` | `100000` | tmux 스크롤백/히스토리 한계 |
| `LOG_LEVEL` | `INFO` | Python 로깅 레벨 |
| `RELOAD` | 프로덕션에서 `false` | Uvicorn 리로드 플래그 |
| `TRUST_PROXY_HEADERS` | `0` | 신뢰된 리버스 프록시 뒤에서만 `X-Forwarded-*` 헤더 신뢰 |
| `ENABLE_CSP` | `1` | 기본 Content-Security-Policy 헤더 전송 |

보안 키:

- JWT 서명 키를 `.env`에 **넣지 마세요**.
- JWT 서명 키는 기본적으로 `data/.jwt-secret`에 생성됩니다. 필요하면 `JWT_SECRET_PATH`로 경로를 지정할 수 있습니다.
- Vault 마스터 키는 `VAULT_KEY_PATH`에 저장됩니다. 설정하지 않으면 프로젝트 루트의 `data/.vault-key`가 기본값입니다. DB와 함께 백업해야 합니다.
- Host-native 설치에서 JWT 로테이션 명령 사용 가능:

```bash
.venv/bin/python backend/rotate_jwt.py --confirm
sudo systemctl restart iterminallist.service
```

---

## 첫 로그인과 2FA

1. `http://localhost:38822` 또는 설정한 도메인을 엽니다.
2. 관리자 계정이 없으면 초기 설정 화면이 나타납니다.
3. 관리자 계정 생성:
   - 사용자 이름: 최소 3자
   - 비밀번호: 최소 8자, 12자 이상 권장
4. 로그인합니다.
5. 선택 사항이지만 권장: **설정 → 2단계 인증**에서 TOTP 2FA 활성화.

2FA 흐름:

1. **2FA 활성화**를 클릭합니다.
2. Google Authenticator, Microsoft Authenticator, 1Password, Bitwarden 또는 RFC 6238 호환 앱으로 QR 코드를 스캔합니다.
3. 6자리 코드를 입력합니다.
4. 10개의 일회성 백업 코드를 안전하게 보관하세요. 다시 표시되지 않습니다.

---

## 앱 사용법

### 터미널

- 홈 대시보드의 "현재 머신" 또는 등록한 SSH 호스트에서 터미널을 엽니다.
- 브라우저 새로고침 후에도 재연결됩니다. 백엔드가 지속형 `tmux` 세션에 재연결합니다.
- 탭의 `⋯` 메뉴에서 이름을 바꿉니다. 탭을 닫으면 그 안의 세션이 모두 종료됩니다.
- 모바일 툴바에서 `Esc`, `Tab`, `Ctrl+C`, 방향키, 붙여넣기를 사용할 수 있습니다.
- **터미널 새로고침**(pane `…` 메뉴)은 화면만 다시 붙입니다. *같은 셸*에 재부착하므로 PATH·셸 해시·실행 중인 프로세스가 그대로입니다.
- **세션 재시작**(pane `…` 메뉴)은 tmux 세션을 종료하고 **같은 경로에서** 새 셸을 엽니다. 방금 설치한 명령이 아직 `PATH`에 안 잡힐 때 쓰세요. 안에서 돌던 프로세스가 모두 종료되므로 확인창을 거칩니다.

### 분할과 브로드캐스트

- 오른쪽(`Ctrl+\`) 또는 아래(`Ctrl+Shift+\`)로 분할하거나, 탭 메뉴에서 2×2 그리드를 고릅니다.
- 경계선을 드래그해 크기를 조절합니다. 탭바의 **균등 분할**(격자 아이콘)은 모든 pane을 같은 면적으로 되돌립니다 — 중첩 분할에서도 마찬가지입니다(단순히 노드마다 반씩 나누면 안쪽 pane이 절반 크기가 됩니다).
- **브로드캐스트**(안테나 아이콘)는 타이핑을 탭 안의 모든 pane에 복제합니다. 대상 pane에는 앰버 테두리와 배지가 붙고, 배지의 `✕`로 한 pane만 제외하고 `+`로 되돌립니다.
- 제외된 pane은 입력을 받지도, 자기 입력을 남에게 보내지도 않습니다. 빼둔 창에서 실수로 타이핑해도 다른 창이 오염되지 않습니다.
- 브로드캐스트를 끄면 제외 목록도 초기화되어, 다시 켤 때는 항상 전원 참여로 시작합니다.

### 빠른 입력 · 음성 · 대상 선택

- 탭바(키보드 아이콘), 모바일 툴바, 또는 `Ctrl+Shift+Enter`로 빠른 입력을 엽니다.
- 모바일 한글 IME의 자소 분리를 피할 수 있습니다 — 명령을 다 쓴 뒤 한 번에 보냅니다.
- 직접 입력하거나 마이크 버튼으로 Web Speech API를 통해 음성으로 입력합니다.
- 십자선 버튼으로 **어느 터미널에 보낼지** 고릅니다. 열려 있는 모든 탭의 pane이 탭별로 묶여 나오고, 탭 이름을 누르면 그 탭 전체가 선택됩니다. 아무것도 고르지 않으면 활성 pane으로 갑니다.
- **명령 이력** 패널(눈 아이콘)에서 터미널별 명령 이력을 무한 스크롤로 확인합니다. 항목을 클릭하면 커서 위치에 삽입됩니다.

### 파일 탐색기

- `WORKSPACE_ROOT` 하위만 탐색 가능합니다.
- 내장 Monaco 에디터로 파일을 열고 편집하며, ripgrep으로 파일 내용을 검색합니다.
- 워크스페이스 항목을 생성·이동·이름변경·삭제합니다.
- 업로드는 선택한 폴더로 들어갑니다. 아무것도 고르지 않았으면 트리에서 들어가 있는 폴더, 그다음 에디터에 열려 있는 파일의 폴더 순으로 정해집니다.
- 선택한 폴더에서 터미널을 엽니다.

### 패스키 / WebAuthn

- **설정 → 보안**에서 패스키를 등록합니다 (Face ID, Touch ID, 하드웨어 키).
- 이후 로그인 시 비밀번호 대신 패스키를 사용합니다.
- TOTP 2FA와 비밀번호 로그인은 폴백으로 그대로 사용 가능합니다.

### 설정

- 테마 선택: 59종 (Catppuccin, Tokyo Night, Dracula, Gruvbox, Nord, Rosé Pine, Solarized, GitHub …), pane별로 덮어쓸 수 있습니다.
- 글자 대비: 저대비 팔레트를 밝혀 가독성을 높이거나, 테마 색을 원본 그대로 보여줍니다.
- 언어: 한국어 / English.
- 글꼴 크기·서체 (PC와 모바일 각각 설정).
- 터미널 자동 스크롤 동작, 부드러운 스크롤, 스크롤 감도.
- 예측 입력(mosh 방식 로컬 에코) — 에디터·비밀번호 입력에선 자동으로 꺼집니다.
- TOTP 2FA, 백업 코드 관리, 패스키 등록.

### 단축키

| 단축키 | 동작 |
| --- | --- |
| `Ctrl+Shift+Enter` | 빠른 입력 |
| `Ctrl+Shift+P` | 명령 팔레트 |
| `Ctrl+Shift+S` | 스니펫 팔레트 |
| `Ctrl+P` | 빠른 파일 열기 |
| `Ctrl+T` | 새 탭 |
| `Ctrl+W` | 탭 닫기 |
| `Ctrl+1` … `Ctrl+9` | N번 탭으로 전환 |
| `Ctrl+\` | 오른쪽 분할 |
| `Ctrl+Shift+\` | 아래 분할 |
| `Ctrl+,` | 설정 |
| `Ctrl+Shift+F` | 터미널 내 검색 |

macOS에서는 `Ctrl` 대신 `Cmd`를 사용합니다.

---

## 운영

### 서비스 명령어

```bash
sudo systemctl restart iterminallist.service
sudo systemctl stop iterminallist.service
sudo systemctl start iterminallist.service
journalctl -u iterminallist.service -f
```

### Docker 명령어

```bash
docker compose ps
docker compose logs -f backend
docker compose restart backend
docker compose pull
docker compose up -d
```

### 백업

Host-native 예시:

```bash
DEST=/backup/iterminallist-$(date +%Y%m%d-%H%M)
mkdir -p "$DEST"

sqlite3 /var/lib/iterminallist/iterminallist.db ".backup $DEST/iterminallist.db" 2>/dev/null \
  || cp /var/lib/iterminallist/iterminallist.db "$DEST/iterminallist.db"

cp /var/lib/iterminallist/.vault-key "$DEST/.vault-key"
chmod 600 "$DEST/.vault-key"
```

Docker 예시:

```bash
DEST=./backup/iterminallist-$(date +%Y%m%d-%H%M)
mkdir -p "$DEST"

sqlite3 ./data/iterminallist.db ".backup $DEST/iterminallist.db" 2>/dev/null \
  || cp ./data/iterminallist.db "$DEST/iterminallist.db"

cp ./data/.vault-key "$DEST/.vault-key"
chmod 600 "$DEST/.vault-key"
```

### 복원

Host-native:

```bash
sudo systemctl stop iterminallist.service
cp /backup/iterminallist-YYYYMMDD-HHMM/iterminallist.db /var/lib/iterminallist/iterminallist.db
cp /backup/iterminallist-YYYYMMDD-HHMM/.vault-key /var/lib/iterminallist/.vault-key
chmod 600 /var/lib/iterminallist/.vault-key
sudo systemctl start iterminallist.service
```

Docker:

```bash
docker compose down
cp ./backup/iterminallist-YYYYMMDD-HHMM/iterminallist.db ./data/iterminallist.db
cp ./backup/iterminallist-YYYYMMDD-HHMM/.vault-key ./data/.vault-key
chmod 600 ./data/.vault-key
docker compose up -d
```

---

## 보안 모델

| 제어 | 동작 |
| --- | --- |
| 관리자 인증 | 단일 관리자 설정 흐름, bcrypt/passlib 비밀번호 해싱 |
| 세션 인증 | HttpOnly 쿠키에 담긴 JWT 액세스 토큰, 서명 키는 `data/.jwt-secret`에 자동 생성 |
| 2FA | TOTP + 일회성 백업 코드 |
| 비밀 저장소 | `data/.vault-key`를 사용한 Fernet 암호화 vault 값 |
| 파일 접근 | 서버가 경로를 검증하고 파일 작업을 `WORKSPACE_ROOT`로 제한 |
| API 접근 | 인증 보호 API 엔드포인트 |

권장 사항:

1. TOTP 2FA를 활성화하세요.
2. 로컬 전용이 아닌 경우 HTTPS 뒤에 앱을 배치하세요.
3. 리버스 프록시를 사용 중이라면 `APP_PORT`를 방화벽으로 차단하세요.
4. DB와 `.vault-key`를 항상 함께 백업하세요.
5. `.env`, `data/`, DB 파일, `.vault-key`를 커밋하지 마세요.

---

## 리버스 프록시 / HTTPS

Nginx 설정 예시:

```nginx
server {
    listen 80;
    server_name terminal.example.com;

    location / {
        proxy_pass http://127.0.0.1:38822;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws/ {
        proxy_pass http://127.0.0.1:38822;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

Certbot으로 HTTPS 활성화:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d terminal.example.com
sudo certbot renew --dry-run
```

---

## 개발자 설정

### 백엔드와 프론트엔드 동시 실행

```bash
python run.py
```

옵션:

```bash
python run.py --backend
python run.py --frontend
python run.py --no-restart
```

### 수동 백엔드 실행

```bash
cd backend
pip install -r requirements.txt
DB_PATH=../data/iterminallist.db APP_PORT=8000 python3 main.py
```

### 수동 프론트엔드 실행

```bash
cd frontend
npm install
npm run dev
```

Vite 개발 서버 기본 포트는 `5173`이며, `VITE_BACKEND_HOST` / `VITE_BACKEND_PORT`를 설정하지 않으면 `/api` 및 `/ws`를 `localhost:8000`으로 프록시합니다.

### 테스트 및 빌드

```bash
# 프론트엔드 테스트
cd frontend
npx vitest run

# 프론트엔드 프로덕션 빌드 -> backend/static
npm run build

# 백엔드 테스트
cd ../backend
pytest
```

### Docker 이미지 빌드

```bash
docker build -t ghcr.io/jshsakura/oc-terminal-list:latest .
docker compose config --quiet
docker compose up -d
```

### GHCR 퍼블리싱

`.github/workflows/ghcr-publish.yml` 워크플로우가 다음에 퍼블리시합니다:

```text
ghcr.io/jshsakura/oc-terminal-list
```

트리거:

- `main` 또는 `master` 브랜치에 push
- `v*.*.*` 패턴의 태그
- 수동 `workflow_dispatch`

생성되는 태그: 기본 브랜치용 `latest`, 릴리스용 시맨틱 버전 태그, `sha-*` 태그.

---

## 프로젝트 구조

```text
oc-terminal-list/
├── backend/                    # FastAPI 백엔드
│   ├── main.py                 # API, WebSocket 브릿지, 정적 파일 서빙
│   ├── auth_manager.py         # 관리자 인증, JWT, 2FA 흐름
│   ├── sqlite_storage.py       # SQLite 영속성
│   ├── tmux_manager.py         # tmux 세션 관리
│   ├── vault.py                # 암호화된 비밀 저장소
│   ├── requirements.txt
│   └── tests/
├── frontend/                   # React + Vite 프론트엔드
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── vite.config.js          # backend/static으로 빌드
├── deploy/
│   ├── README.md               # host-native 운영 가이드
│   └── iterminallist.service   # systemd 유닛 템플릿/예시
├── compose.yml                 # GHCR Compose 예시
├── Dockerfile                  # 다중 단계 프론트엔드 + 백엔드 이미지
├── .dockerignore
├── .env.example
├── run.py                      # 개발 슈퍼바이저
└── README.md
```

---

## 문제 해결

### 포트가 이미 사용 중

Docker:

```bash
APP_PORT=9000 docker compose up -d
```

영구 적용:

```bash
echo "APP_PORT=9000" >> .env
docker compose up -d
```

Host-native:

```bash
# .env 편집
APP_PORT=9000

sudo systemctl restart iterminallist.service
```

### Docker 컨테이너가 시작되지 않음

```bash
docker compose ps
docker compose logs backend
docker compose config
```

### systemd 서비스 실패

```bash
journalctl -u iterminallist.service -n 100 --no-pager
systemctl status iterminallist.service
```

일반적인 원인:

- `deploy/iterminallist.service`에 잘못된 `User`, `Group`, 또는 경로가 포함되어 있음.
- `.env`의 `DB_PATH` 또는 `WORKSPACE_ROOT`가 서비스 사용자가 쓸 수 없는 디렉토리를 가리킴.
- `tmux`가 설치되지 않음.
- 프론트엔드가 `backend/static`에 빌드되지 않음.

### 로그인은 성공하지만 즉시 로그아웃됨

JWT 서명 키가 로테이션되었을 수 있습니다. 다시 로그인하면 서버가 세션 쿠키를 재발급합니다.

### Vault 복호화 오류

DB와 `.vault-key`가 일치하지 않습니다. 같은 백업 세트에서 두 파일을 모두 복원하거나, 영향을 받는 SSH/호스트 비밀을 다시 등록하세요.

### Docker 데이터 초기화

```bash
docker compose down
rm -rf ./data ./workspace
mkdir -p ./data ./workspace
docker compose up -d
```

---

## 로드맵

- [ ] install.sh 가이드형 host-native 설치 프로그램
- [ ] CLI 및 정적 자산 레이아웃 정리 후 PyPI / pipx 패키징
- [ ] 다중 사용자 지원
- [ ] 세션 공유
- [ ] 터미널 녹화/재생
- [ ] 플러그인 시스템
- [ ] 네이티브 모바일 컴패니언 앱

---

## 관련 문서

- [`deploy/README.md`](./deploy/README.md) — systemd 운영, JWT 로테이션, vault 키 관리, 백업/복원
- [GHCR 패키지](https://github.com/jshsakura/oc-terminal-list/pkgs/container/oc-terminal-list)
- [GitHub Issues](https://github.com/jshsakura/oc-terminal-list/issues)

---

## 라이선스

MIT License.

---


# Terminal List

🌐 [English](./README.md) | 🇰🇷 [한국어](./README.ko.md) | 🐳 GHCR Container | 🖥️ Host-native 권장

[![GHCR Publish](https://github.com/jshsakura/oc-terminal-list/actions/workflows/ghcr-publish.yml/badge.svg)](https://github.com/jshsakura/oc-terminal-list/actions/workflows/ghcr-publish.yml)
[![GHCR Image](https://img.shields.io/badge/ghcr.io-jshsakura%2Foc--terminal--list-blue?logo=docker)](https://github.com/jshsakura/oc-terminal-list/pkgs/container/oc-terminal-list)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](#라이선스)

빠르고 자체 호스팅 가능한 웹 터미널. 지속형 `tmux` 세션, 파일 탐색, SSH 호스트 관리, 모바일 친화적 서버 접속을 지원합니다.

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
- VS Code 스타일의 파일 탐색기 및 에디터 (워크스페이스 디렉토리 범위)
- SSH 호스트/키 관리
- 단일 관리자 로그인 + 선택적 TOTP 2FA
- 데스크톱, 태블릿, 모바일에서 작동하는 반응형 UI

노트북 스타일 원격 셸보다 빠르고 직관적인 가벼운 터미널 대시보드가 필요할 때 유용합니다.

---

## 기능

| 영역 | 기능 |
| --- | --- |
| 터미널 | xterm.js 터미널 UI, 지속형 `tmux` 세션, 재연결 친화적 WebSocket 브릿지 |
| 세션 | SQLite 기반 세션 메타데이터 및 복원 |
| 파일 | 워크스페이스 범위 파일 탐색기, 에디터, 생성/이동/삭제 |
| SSH | 호스트 및 키 관리, 암호화된 비밀 저장소 |
| 인증 | 초기 관리자 설정, JWT 세션, 선택적 TOTP 2FA, 일회성 백업 코드 |
| Vault | SSH 비밀번호, 개인키 암호문, OTP 비밀이 `data/.vault-key`로 Fernet 암호화 |
| UI | 테마, 언어 전환, 모바일 툴바, 반응형 레이아웃 |
| 성능 | Gzip, 장기 정적 자산 캐시, 지연 로딩 프론트엔드 청크, WebSocket 배치 |
| 배포 | GHCR Docker 이미지, Compose 예시, systemd host-native 서비스 |

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
- JWT 서명 키는 앱이 DB 설정에 자동 생성 및 저장합니다.
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

보안 키:

- JWT 서명 키를 `.env`에 **넣지 마세요**.
- JWT 서명 키는 앱이 DB 설정에 자동 생성 및 저장합니다.
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

- 사이드바 또는 상단 액션 버튼에서 터미널을 생성합니다.
- 세션 목록에서 세션을 전환합니다.
- 세션 이름을 편집하여 이름을 변경합니다.
- 브라우저 새로고침 후에도 재연결됩니다. 백엔드가 지속형 `tmux` 세션에 재연결합니다.
- 모바일 툴바에서 `Esc`, `Tab`, `Ctrl+C`, 방향키, 붙여넣기를 사용할 수 있습니다.

### 파일 탐색기

- `WORKSPACE_ROOT` 하위만 탐색 가능합니다.
- 내장 에디터로 파일을 열고 편집합니다.
- 파일/디렉토리를 생성합니다.
- 워크스페이스 항목을 이동하거나 삭제합니다.
- 선택한 폴더에서 터미널을 엽니다.

### 설정

- 테마 선택: Catppuccin, Dracula, Monokai, Solarized Dark, GitHub Dark.
- 언어: 한국어 / English.
- 글꼴 크기.
- 터미널 자동 스크롤 동작.
- TOTP 2FA 및 백업 코드 관리.

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
| 세션 인증 | JWT 액세스 토큰, 서명 키는 앱이 자동 생성 및 저장 |
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

JWT 서명 키가 로테이션되었을 수 있습니다. 브라우저 localStorage를 지우고 다시 로그인하세요.

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

Made with ❤️ by [jshsakura](https://github.com/jshsakura)

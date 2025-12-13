# iTerminalList

**웹 기반 터미널 에뮬레이터 with 영속적 세션 및 파일 브라우저**

## ✨ 주요 기능

- 🖥️ **웹 터미널**: xterm.js 기반 풀 기능 터미널 에뮬레이터
- 💾 **영속적 세션**: SQLite + Redis 기반 세션 복원 및 히스토리
- 📁 **파일 브라우저**: VS Code 스타일 파일 탐색 및 편집
- 🔐 **인증 시스템**: JWT 기반 관리자 인증
- 🎨 **5가지 테마**: Catppuccin, Dracula, Monokai, Solarized Dark, GitHub Dark
- 🌐 **다국어 지원**: 한국어/English
- 📱 **반응형 UI**: 모바일/태블릿/데스크톱 최적화
- 🐳 **Docker 배포**: 단일 컨테이너로 쉬운 배포

## 🚀 빠른 시작

### Docker Compose 사용 (권장)

```bash
# 저장소 클론
git clone https://github.com/yourusername/iterminallist.git
cd iterminallist

# 환경 변수 설정
cp .env.example .env

# 실행
docker-compose up -d

# 접속
open http://localhost:8000
```

### Docker Hub에서 실행

```bash
# docker-compose.yml 다운로드
wget https://raw.githubusercontent.com/yourusername/iterminallist/main/docker-compose.yml
wget https://raw.githubusercontent.com/yourusername/iterminallist/main/.env.example

# .env 설정
cp .env.example .env
# .env 파일 편집하여 비밀번호 변경

# 실행
docker-compose up -d
```

### 로컬 개발

```bash
# 백엔드
cd backend
pip install -r requirements.txt
DB_PATH=./data/iterminallist.db python3 main.py

# 프론트엔드 (새 터미널)
cd frontend
npm install
npm run dev
```

## 🔐 초기 설정

1. 브라우저에서 `http://localhost:8000` 접속
2. **초기 설정 화면**에서 관리자 계정 생성
   - 사용자명: 최소 3자
   - 비밀번호: 최소 8자
3. 로그인 후 터미널 사용

## 📝 사용 방법

### 터미널 사용
- **새 터미널**: 사이드바 "+ 새 터미널" 버튼
- **세션 전환**: 사이드바에서 세션 클릭
- **세션 닫기**: 세션 우측 X 버튼

### 파일 브라우저
1. **파일 탭**: 사이드바에서 "파일" 탭 선택
2. **폴더 선택**: 폴더 클릭 → 경로 표시 및 선택
3. **파일 생성**: 상단 📄+ 버튼 (선택된 폴더 안에 생성)
4. **폴더 생성**: 상단 📁+ 버튼 (선택된 폴더 안에 생성)
5. **파일 편집**: 파일 클릭 → 에디터 열림 → 편집 → 저장

## 📁 프로젝트 구조

```
iTerminaLlist/
├── backend/                    # FastAPI 백엔드
│   ├── main.py                # API 엔트리포인트
│   ├── auth_manager.py        # JWT 인증
│   ├── pty_manager.py         # PTY 세션 관리
│   ├── sqlite_storage.py      # SQLite 저장소
│   └── requirements.txt
├── frontend/                   # React + Vite 프론트엔드
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── styles/
│   │   └── i18n/
│   └── package.json
├── data/                       # SQLite 데이터 (자동 생성)
│   └── iterminallist.db
├── run_standalone.py           # 단독 실행 스크립트
└── compose.yml                 # Docker Compose 설정
```

## 🛠️ 기술 스택

### 백엔드
- **Python 3.8+**
- FastAPI (웹 프레임워크)
- ptyprocess (가상 터미널)
- SQLite (데이터 저장)
- passlib + bcrypt (비밀번호 해싱)
- python-jose (JWT)

### 프론트엔드
- **React 18**
- Vite (빌드 도구)
- xterm.js (터미널 렌더링)
- xterm-addon-fit (반응형 크기)

## 🔧 개발 모드

### 백엔드만 실행
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 프론트엔드만 실행
```bash
cd frontend
npm install
npm run dev -- --port 23232
```

## 🐳 Docker Hub 배포

### 이미지 빌드 및 푸시

```bash
# 이미지 빌드
docker build -t yourusername/iterminallist:latest .

# 버전 태그 추가
docker tag yourusername/iterminallist:latest yourusername/iterminallist:1.0.0

# Docker Hub 로그인
docker login

# 푸시
docker push yourusername/iterminallist:latest
docker push yourusername/iterminallist:1.0.0
```

### Makefile 사용

```bash
# 빌드
make build

# Docker Hub에 푸시
make push TAG=yourusername/iterminallist:1.0.0

# 배포
make deploy
```

### 데이터 영속성
- SQLite 데이터: Docker 볼륨 `app-data`에 저장
- Redis 데이터: Docker 볼륨 `redis-data`에 저장
- MariaDB 데이터: Docker 볼륨 `mariadb-data`에 저장
- 컨테이너 재시작 시에도 데이터 유지

## 🌐 도메인 연결

### Nginx 리버스 프록시 예시
```nginx
server {
    listen 80;
    server_name terminal.yourdomain.com;

    location / {
        proxy_pass http://localhost:23232;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /api/ {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
    }

    location /ws/ {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_read_timeout 3600s;
    }
}
```

## 📱 모바일 최적화

- **iOS Safari**: Visual Viewport API로 키보드 위치 자동 조정
- **특수키 툴바**: ESC, Tab, Ctrl+C, 방향키, 붙여넣기
- **스마트 스크롤**: AI 채팅 스타일 자동 스크롤

## 🎨 커스터마이징

### 테마 추가
`frontend/src/styles/themes.js`에서 새 테마 정의

### 언어 추가
`frontend/src/i18n/locales.js`에서 번역 추가

## 🔒 보안

- **비밀번호**: bcrypt 해싱 (단방향)
- **JWT 토큰**: 24시간 유효
- **인증 필수**: 모든 API 엔드포인트 보호
- **SQLite**: 로컬 파일 시스템 (외부 노출 없음)

## 📊 데이터 관리

### SQLite 데이터베이스 위치
```bash
# Docker
docker volume inspect iterminallist_sqlite-data

# 로컬
./data/iterminallist.db
```

### 데이터 백업
```bash
# 로컬
cp ./data/iterminallist.db ./backup/iterminallist_$(date +%Y%m%d).db

# Docker
docker run --rm -v iterminallist_sqlite-data:/data -v $(pwd):/backup \
  alpine cp /data/iterminallist.db /backup/
```

## 🐛 트러블슈팅

### PTY 권한 오류
```bash
# Docker 컨테이너를 privileged 모드로 실행
docker compose down
docker compose --profile dev up
```

### 포트 충돌
`.env` 파일에서 포트 변경:
```
FRONTEND_PORT=23232
BACKEND_PORT=8000
```

### 데이터 초기화
```bash
# SQLite 데이터베이스 삭제
rm -f ./data/iterminallist.db

# Docker 볼륨 삭제
docker compose down -v
```

## 🚧 향후 계획

- [ ] Swift 네이티브 iOS 앱
- [ ] Kotlin 네이티브 Android 앱
- [ ] 멀티 사용자 지원
- [ ] 세션 공유 기능
- [ ] 터미널 녹화/재생

## 📄 라이선스

MIT License

## 🙏 기여

이슈 및 PR 환영합니다!

# iTerminalList - Docker 배포 가이드

웹 기반 터미널 에뮬레이터를 Docker Compose로 배포하는 가이드입니다.

## 📦 구성 요소

- **Frontend + Backend**: 단일 컨테이너로 통합 (Vite 빌드 + FastAPI)
- **Redis**: 세션 캐싱 및 임시 데이터 저장
- **MariaDB**: 영구 데이터 저장 (선택 사항, 현재는 SQLite 사용)

## 🚀 빠른 시작

### 1. 환경 변수 설정

```bash
cp .env.example .env
# .env 파일을 편집하여 필요한 값 수정
```

### 2. Docker Compose로 실행

```bash
# 빌드 및 실행
docker-compose up -d

# 로그 확인
docker-compose logs -f app

# 중지
docker-compose down

# 데이터까지 모두 삭제
docker-compose down -v
```

### 3. 접속

브라우저에서 `http://localhost:8000` 접속

- 최초 접속 시 관리자 계정 생성 화면이 표시됩니다
- 사용자명: 3자 이상
- 비밀번호: 8자 이상

## 🐳 Docker Hub에 배포

### 이미지 빌드 및 푸시

```bash
# 이미지 빌드
docker build -t yourusername/iterminallist:latest .

# 태그 추가 (버전)
docker tag yourusername/iterminallist:latest yourusername/iterminallist:1.0.0

# Docker Hub에 로그인
docker login

# 이미지 푸시
docker push yourusername/iterminallist:latest
docker push yourusername/iterminallist:1.0.0
```

### Docker Hub 이미지로 실행

`.env` 파일에서 이미지 이름 변경:

```env
DOCKER_IMAGE=yourusername/iterminallist:latest
```

그리고 실행:

```bash
docker-compose pull
docker-compose up -d
```

## 📁 디렉토리 구조

```
iTerminalList/
├── Dockerfile              # 통합 이미지 빌드
├── docker-compose.yml      # 전체 스택 구성
├── .env.example           # 환경 변수 예제
├── backend/               # FastAPI 백엔드
│   ├── main.py
│   ├── requirements.txt
│   └── ...
└── frontend/              # React 프론트엔드
    ├── src/
    ├── package.json
    └── ...
```

## 🔧 환경 변수

### 필수 환경 변수

| 변수명 | 기본값 | 설명 |
|--------|--------|------|
| `APP_PORT` | `8000` | 애플리케이션 포트 |
| `DB_PATH` | `/app/data/iterminallist.db` | SQLite DB 경로 |
| `REDIS_HOST` | `redis` | Redis 호스트 |
| `REDIS_PORT` | `6379` | Redis 포트 |

### MariaDB 환경 변수 (선택)

| 변수명 | 기본값 | 설명 |
|--------|--------|------|
| `MYSQL_ROOT_PASSWORD` | `rootpassword` | MariaDB root 비밀번호 |
| `MYSQL_DATABASE` | `iterminallist` | 데이터베이스 이름 |
| `MYSQL_USER` | `iterminal` | 데이터베이스 사용자 |
| `MYSQL_PASSWORD` | `iterminalpass` | 사용자 비밀번호 |

## 🔒 보안 고려사항

### 프로덕션 배포 시 필수 변경 사항

1. **비밀번호 변경**
   ```env
   MYSQL_ROOT_PASSWORD=strong_random_password_here
   MYSQL_PASSWORD=another_strong_password
   ```

2. **포트 변경** (선택 사항)
   ```env
   APP_PORT=8080
   ```

3. **볼륨 백업**
   ```bash
   # 데이터 백업
   docker run --rm -v iterminallist_app-data:/data -v $(pwd):/backup \
     alpine tar czf /backup/backup-$(date +%Y%m%d).tar.gz /data
   ```

## 📊 모니터링

### 컨테이너 상태 확인

```bash
# 실행 중인 컨테이너 확인
docker-compose ps

# 리소스 사용량 확인
docker stats

# 로그 확인
docker-compose logs -f app
docker-compose logs -f redis
docker-compose logs -f mariadb
```

### 헬스체크

```bash
# 애플리케이션 상태 확인
curl http://localhost:8000/api/auth/status

# Redis 확인
docker-compose exec redis redis-cli ping

# MariaDB 확인
docker-compose exec mariadb mysqladmin ping -h localhost
```

## 🔄 업데이트

### 새 버전으로 업데이트

```bash
# 최신 이미지 pull
docker-compose pull

# 컨테이너 재시작
docker-compose up -d

# 오래된 이미지 정리
docker image prune -f
```

### 롤백

```bash
# 특정 버전으로 롤백
DOCKER_IMAGE=yourusername/iterminallist:1.0.0 docker-compose up -d
```

## 🐛 트러블슈팅

### 포트 충돌

```bash
# 8000번 포트 사용 중인 프로세스 확인
lsof -ti:8000

# .env에서 포트 변경
APP_PORT=8080
```

### 데이터베이스 초기화

```bash
# 모든 데이터 삭제 후 재시작
docker-compose down -v
docker-compose up -d
```

### 로그 확인

```bash
# 전체 로그
docker-compose logs

# 특정 서비스 로그
docker-compose logs app

# 실시간 로그
docker-compose logs -f --tail=100
```

## 📝 라이선스

MIT License

## 🤝 기여

이슈와 풀 리퀘스트를 환영합니다!

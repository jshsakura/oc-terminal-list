# iTerminaLlist - 빠른 시작 가이드

## 🚀 5분 안에 시작하기

### 방법 1: Python 스크립트 사용 (권장)

```bash
# 1. 개발 모드 시작
python3 run_container.py dev

# 2. 브라우저에서 접속
# http://localhost:23232
```

### 방법 2: Makefile 사용

```bash
# 개발 모드 시작
make dev

# 또는 한 번에 설치 + 실행
make quick-start
```

### 방법 3: Docker Compose 직접 사용

```bash
# 개발 모드
docker compose --profile dev up -d

# 프로덕션 모드
docker compose --profile prod up -d --build
```

---

## 📋 사용 가능한 명령어

### run_container.py 스크립트

```bash
python3 run_container.py dev       # 개발 모드 시작
python3 run_container.py prod      # 프로덕션 모드 시작
python3 run_container.py stop      # 중지
python3 run_container.py restart   # 재시작
python3 run_container.py logs      # 로그 보기
python3 run_container.py status    # 상태 확인
python3 run_container.py build     # 이미지 재빌드
python3 run_container.py clean     # 정리 (컨테이너/볼륨 삭제)
python3 run_container.py shell     # 백엔드 쉘 접속
```

### Makefile (더 짧은 명령어)

```bash
make dev         # 개발 모드
make prod        # 프로덕션 모드
make stop        # 중지
make restart     # 재시작
make logs        # 전체 로그
make logs-be     # 백엔드 로그만
make logs-fe     # 프론트엔드 로그만
make status      # 상태 확인
make shell       # 백엔드 쉘
make clean       # 정리
```

---

## 🌐 접속 정보

| 서비스 | URL | 설명 |
|--------|-----|------|
| **웹 UI** | http://localhost:23232 | 터미널 인터페이스 |
| **백엔드 API** | http://localhost:8000 | FastAPI 서버 |
| **API 문서** | http://localhost:8000/docs | Swagger UI |
| **Redis** | localhost:36379 | 내부 전용 |

---

## 🔧 개발 모드 vs 프로덕션 모드

### 개발 모드 (dev)
- ✅ 코드 변경 시 자동 리로드 (핫 리로드)
- ✅ 소스 코드가 볼륨 마운트됨
- ✅ 상세한 로그 출력
- ⚠️ 최적화되지 않음 (느릴 수 있음)

**사용 시나리오**: 로컬 개발, 디버깅

### 프로덕션 모드 (prod)
- ✅ 최적화된 빌드 (Vite 번들링, Nginx)
- ✅ 빠른 성능
- ✅ 작은 이미지 크기
- ⚠️ 코드 변경 시 재빌드 필요

**사용 시나리오**: 실제 배포, 성능 테스트

---

## 📝 로그 확인 방법

```bash
# 전체 로그 (실시간)
python3 run_container.py logs

# 백엔드만
python3 run_container.py logs backend

# 프론트엔드만
python3 run_container.py logs frontend-dev

# 마지막 100줄만 보기
docker compose logs --tail=100
```

---

## 🐛 문제 해결

### 포트 충돌 에러

```bash
# 기존 컨테이너 확인 및 중지
docker ps -a
docker stop $(docker ps -q)
```

### 컨테이너가 시작되지 않을 때

```bash
# 1. 모든 컨테이너 중지
python3 run_container.py stop

# 2. 이미지 재빌드
python3 run_container.py build

# 3. 다시 시작
python3 run_container.py dev
```

### Redis 연결 실패

```bash
# Redis 컨테이너 상태 확인
docker ps | grep redis

# Redis 로그 확인
docker logs iterminal-redis

# Redis 컨테이너 재시작
docker restart iterminal-redis
```

### 완전히 초기화하고 다시 시작

```bash
# 경고: 모든 데이터가 삭제됩니다!
python3 run_container.py clean
python3 run_container.py build
python3 run_container.py dev
```

---

## 🔍 디버깅 팁

### 백엔드 컨테이너 쉘 접속

```bash
python3 run_container.py shell

# 또는
docker exec -it iterminal-backend bash

# Python 인터프리터
python3
>>> import redis
>>> r = redis.Redis(host='redis', port=6379)
>>> r.ping()  # True가 나와야 함
```

### 프론트엔드 컨테이너 쉘 접속

```bash
python3 run_container.py shell frontend-dev

# 또는
docker exec -it iterminal-frontend-dev sh

# 의존성 재설치
npm install
```

### 네트워크 확인

```bash
# 네트워크 정보
docker network inspect iterminallist_iterminal-network

# 컨테이너 IP 확인
docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' iterminal-backend
```

---

## 📦 의존성 설치 (로컬 개발 시)

Docker 없이 로컬에서 직접 실행하려면:

```bash
# 백엔드
cd backend
pip install -r requirements.txt
python main.py

# 프론트엔드 (새 터미널)
cd frontend
npm install
npm run dev
```

---

## 🎨 설정 커스터마이징

### 환경 변수 설정

```bash
# .env 파일 생성
cp .env.example .env

# .env 파일 편집
nano .env
```

### 포트 변경

`compose.yml` 파일에서 포트 수정:

```yaml
ports:
  - "원하는포트:5173"  # 프론트엔드
  - "8000:8000"        # 백엔드
```

---

## 🚢 프로덕션 배포

```bash
# 1. 프로덕션 모드로 빌드
python3 run_container.py prod

# 2. 또는 단일 Docker 이미지로 빌드
docker build -t iterminallist:latest .

# 3. 실행
docker run -d \
  -p 23232:80 \
  -p 8000:8000 \
  --privileged \
  -e REDIS_URL=redis://host.docker.internal:36379 \
  iterminallist:latest
```

---

## 📚 추가 자료

- [전체 문서](README.md)
- [기술 아키텍처](docs/architecture.md)
- [API 문서](http://localhost:8000/docs)
- [이슈 보고](https://github.com/your-repo/issues)

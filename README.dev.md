# iTerminaLlist 개발 환경 가이드

## 개발 모드 실행

### 1. 개발 환경 시작
```bash
# 기존 컨테이너 중지 (있다면)
docker compose down

# 개발 모드로 실행
docker compose -f docker-compose.dev.yml up --build
```

### 2. 서비스 접속
- **프론트엔드**: http://localhost:5173
- **백엔드 API**: http://localhost:8000
- **백엔드 문서**: http://localhost:8000/docs

### 3. 컨테이너 내부 접근 (npm 사용)

#### 프론트엔드 컨테이너 접속
```bash
docker exec -it iterminallist-frontend-dev sh

# 컨테이너 내부에서 npm 사용 가능
npm install lucide-react
npm run build
npm run dev
```

#### 백엔드 컨테이너 접속
```bash
docker exec -it iterminallist-backend-dev bash

# Python 패키지 설치
pip install 패키지명
```

### 4. 코드 변경 사항 자동 반영
- **프론트엔드**: Vite HMR로 즉시 반영
- **백엔드**: uvicorn --reload로 자동 재시작

### 5. 개발 중지
```bash
# 컨테이너 중지
docker compose -f docker-compose.dev.yml down

# 볼륨까지 삭제 (Redis 데이터 초기화)
docker compose -f docker-compose.dev.yml down -v
```

## 프로덕션 빌드

### 1. 프로덕션 모드 실행
```bash
# 프로덕션 이미지 빌드 및 실행
docker compose up --build -d
```

### 2. 서비스 접속
- **프론트엔드**: http://localhost:3000 (Nginx)
- **백엔드 API**: http://localhost:8000

## 개발 vs 프로덕션 차이

| 항목 | 개발 모드 | 프로덕션 모드 |
|------|-----------|---------------|
| 프론트엔드 | Node.js + Vite Dev Server (5173) | Nginx + 빌드된 정적 파일 (80) |
| 코드 변경 반영 | 즉시 (HMR) | 재빌드 필요 |
| 볼륨 마운트 | 소스 코드 마운트 | 빌드 결과만 복사 |
| 컨테이너 내 npm | ✅ 사용 가능 | ❌ 없음 |
| 성능 | 개발용 | 최적화됨 |

## 문제 해결

### npm이 안 될 때
1. 개발 모드로 실행했는지 확인: `docker-compose.dev.yml`
2. 프론트엔드 컨테이너 접속: `docker exec -it iterminallist-frontend-dev sh`
3. Node.js 버전 확인: `node --version` (18.x 이상)

### 코드 변경이 반영 안 될 때
1. 볼륨 마운트 확인: `docker compose -f docker-compose.dev.yml ps`
2. 컨테이너 재시작: `docker compose -f docker-compose.dev.yml restart frontend`

### Redis 연결 오류
1. Redis 컨테이너 상태 확인: `docker compose -f docker-compose.dev.yml ps redis`
2. 네트워크 확인: `docker network inspect iterminallist_iterminal-network`

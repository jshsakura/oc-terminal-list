.PHONY: help up down build rebuild logs status clean shell backup push deploy

# 기본 타겟
help:
	@echo "iTerminaLlist - Docker Compose Makefile"
	@echo ""
	@echo "사용 가능한 명령어:"
	@echo "  make up          - 전체 스택 시작"
	@echo "  make down        - 전체 스택 중지"
	@echo "  make build       - 이미지 빌드"
	@echo "  make rebuild     - 이미지 재빌드 후 시작"
	@echo "  make logs        - 전체 로그 보기"
	@echo "  make logs-app    - 앱 로그만 보기"
	@echo "  make logs-redis  - Redis 로그만 보기"
	@echo "  make logs-db     - MariaDB 로그만 보기"
	@echo "  make status      - 컨테이너 상태 확인"
	@echo "  make clean       - 모든 컨테이너/볼륨 삭제"
	@echo "  make shell       - 앱 쉘 접속"
	@echo "  make backup      - 데이터 백업"
	@echo "  make push        - Docker Hub에 푸시"
	@echo "  make deploy      - 프로덕션 배포"
	@echo ""
	@echo "포트:"
	@echo "  8000    - iTerminalList (웹 UI + API)"

# 환경 설정
ENV_FILE := .env
ifeq (,$(wildcard $(ENV_FILE)))
    $(shell cp .env.example .env)
endif

# Docker Compose 실행
up:
	@echo "Starting iTerminalList stack..."
	@docker-compose up -d
	@echo "✓ Started! Access at http://localhost:8000"

# 중지
down:
	@echo "Stopping iTerminalList stack..."
	@docker-compose down
	@echo "✓ Stopped"

# 빌드
build:
	@echo "Building iTerminalList image..."
	@docker-compose build
	@echo "✓ Build complete"

# 재빌드 및 시작
rebuild:
	@echo "Rebuilding and starting..."
	@docker-compose up -d --build
	@echo "✓ Rebuild complete"

# 로그
logs:
	@docker-compose logs -f

logs-app:
	@docker-compose logs -f app

logs-redis:
	@docker-compose logs -f redis

logs-db:
	@docker-compose logs -f mariadb

# 상태
status:
	@docker-compose ps

# 정리
clean:
	@echo "Removing all containers and volumes..."
	@docker-compose down -v
	@echo "✓ Cleaned"

# 쉘 접속
shell:
	@docker-compose exec app /bin/bash

shell-redis:
	@docker-compose exec redis redis-cli

shell-db:
	@docker-compose exec mariadb mysql -u root -p

# 데이터 백업
backup:
	@echo "Backing up data..."
	@docker run --rm -v iterminallist_app-data:/data -v $(PWD):/backup \
		alpine tar czf /backup/backup-$$(date +%Y%m%d-%H%M%S).tar.gz /data
	@echo "✓ Backup created in current directory"

# Docker Hub 푸시
push:
	@if [ -z "$(TAG)" ]; then \
		echo "Error: TAG is required. Usage: make push TAG=yourusername/iterminallist:1.0.0"; \
		exit 1; \
	fi
	@echo "Tagging and pushing to Docker Hub..."
	@docker tag iterminallist:latest $(TAG)
	@docker push $(TAG)
	@echo "✓ Pushed $(TAG)"

# 프로덕션 배포
deploy:
	@echo "Deploying to production..."
	@docker-compose pull
	@docker-compose up -d
	@echo "✓ Deployed"

# GitHub Actions 설정 가이드

## 1. GitHub Secrets 설정

GitHub Actions가 Docker Hub에 푸시하려면 다음 secrets를 설정해야 합니다:

### 설정 방법
1. GitHub 저장소 접속: https://github.com/jshsakura/oc-terminal-list
2. **Settings** → **Secrets and variables** → **Actions** 클릭
3. **New repository secret** 버튼 클릭

### 필요한 Secrets

#### DOCKERHUB_USERNAME
- Name: `DOCKERHUB_USERNAME`
- Secret: `jshsakura` (또는 Docker Hub 사용자명)

#### DOCKERHUB_TOKEN
- Name: `DOCKERHUB_TOKEN`
- Secret: Docker Hub Access Token
  - Docker Hub 토큰 생성: https://hub.docker.com/settings/security
  - **New Access Token** → Name: `github-actions`, Permissions: `Read, Write, Delete`

## 2. 워크플로우 동작 방식

### 자동 트리거
- `main` 또는 `oc` 브랜치에 푸시할 때마다 자동 실행
- 버전은 자동으로 증가 (v1.0.0 → v1.0.1 → v1.0.2 ...)

### 수동 트리거
GitHub Actions 탭에서 **Run workflow** 버튼으로 수동 실행 가능
- 버전을 수동으로 지정하거나 비워두면 자동 증가

## 3. 빌드되는 이미지

### 지원 아키텍처
- **linux/amd64** (x86_64, 일반 PC/서버)
- **linux/arm64** (Raspberry Pi 4/5, Apple Silicon)

### Docker 이미지 태그
- `jshsakura/oc-terminal-list:latest` (항상 최신 버전)
- `jshsakura/oc-terminal-list:1.0.0` (특정 버전)
- `jshsakura/oc-terminal-list:1.0.1` (다음 버전)

## 4. 버전 관리

### 버전 증가 규칙
- 푸시할 때마다 패치 버전 자동 증가 (1.0.0 → 1.0.1)
- Git 태그 자동 생성 (v1.0.1, v1.0.2, ...)
- GitHub Release 자동 생성

### 현재 버전 확인
```bash
# 최신 태그 확인
git tag -l "v*" | sort -V | tail -n 1

# 모든 태그 보기
git tag -l "v*" | sort -V
```

### 수동 버전 지정
GitHub Actions 탭에서 **Run workflow** 클릭 후 버전 입력
- 예: `1.1.0` (메이저/마이너 변경 시)

## 5. 배포 확인

### GitHub Actions 로그 확인
https://github.com/jshsakura/oc-terminal-list/actions

### Docker Hub 확인
https://hub.docker.com/r/jshsakura/oc-terminal-list/tags

### 이미지 풀 테스트
```bash
# 최신 버전
docker pull jshsakura/oc-terminal-list:latest

# 특정 버전
docker pull jshsakura/oc-terminal-list:1.0.0

# ARM64 (Raspberry Pi)
docker pull --platform linux/arm64 jshsakura/oc-terminal-list:latest

# AMD64 (PC)
docker pull --platform linux/amd64 jshsakura/oc-terminal-list:latest
```

## 6. 워크플로우 상태 뱃지

README에 추가된 뱃지:
- **Build Status**: GitHub Actions 빌드 상태
- **Docker Pulls**: Docker Hub 다운로드 횟수
- **Latest Version**: 최신 버전 표시

## 7. 릴리스 노트 작성

각 릴리스는 자동으로 GitHub Releases에 생성됩니다:
- URL: https://github.com/jshsakura/oc-terminal-list/releases
- 수동으로 릴리스 노트 편집 가능

## 8. 트러블슈팅

### 빌드 실패 시
1. GitHub Actions 로그 확인
2. Docker Hub 로그인 확인 (Secrets 설정)
3. Dockerfile 문법 오류 확인

### 태그 충돌 시
```bash
# 로컬 태그 삭제
git tag -d v1.0.1

# 원격 태그 삭제
git push origin :refs/tags/v1.0.1
```

### 버전 초기화
```bash
# 모든 태그 삭제 후 v1.0.0부터 재시작
git tag -l "v*" | xargs git tag -d
git push origin --delete $(git tag -l "v*")
git tag -a v1.0.0 -m "Reset version to 1.0.0"
git push origin v1.0.0
```

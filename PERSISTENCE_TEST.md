# 영속성 테스트 가이드

컨테이너 재시작 후에도 모든 설정과 설치가 유지되는지 테스트합니다.

## 유지되는 것들

다음 디렉토리가 Docker 볼륨으로 저장됩니다:
- `/root` - 홈 디렉토리 전체 (bashrc, nvm, pyenv, ssh keys 등)
- `/workspace` - 작업 디렉토리
- `/usr/local` - 전역 설치 패키지 (npm -g, pip 시스템 패키지 등)

## 테스트 시나리오

### 1. 웹 터미널 접속
http://localhost:5173 → 로그인 → 터미널 실행

### 2. 환경 테스트

```bash
# 현재 위치 확인
pwd

# Node.js 버전 관리 테스트
nvm install 18
nvm use 18
node --version

# Python 버전 관리 테스트
pyenv install 3.10.13
pyenv global 3.10.13
python --version

# 작업 디렉토리에 파일 생성
cd /workspace
echo "테스트 파일" > test.txt
mkdir my-project
cd my-project
npm init -y
npm install express

# pip 패키지 설치
pip install requests numpy

# 전역 npm 패키지 설치
npm install -g eslint prettier

# bashrc에 별칭 추가
echo 'alias ll="ls -lah"' >> ~/.bashrc
source ~/.bashrc
ll
```

### 3. 컨테이너 재시작

로컬 터미널에서:
```bash
docker compose -f docker-compose.dev.yml restart backend
```

### 4. 웹 터미널에서 확인

재접속 후:
```bash
# Node.js 버전 확인
nvm ls
node --version  # 18.x.x여야 함

# Python 버전 확인
pyenv versions
python --version  # 3.10.13이어야 함

# 작업 파일 확인
cd /workspace
ls -la
cat test.txt
cd my-project
ls node_modules  # express가 있어야 함

# pip 패키지 확인
pip list | grep requests
pip list | grep numpy

# 전역 npm 패키지 확인
npm list -g --depth=0 | grep eslint

# bashrc 별칭 확인
ll  # 동작해야 함
```

### 5. 완전 재빌드 테스트

```bash
# 컨테이너 삭제 (볼륨은 유지)
docker compose -f docker-compose.dev.yml down

# 재시작
docker compose -f docker-compose.dev.yml up -d
```

웹 터미널 재접속 → 모든 것이 그대로여야 함

### 6. 볼륨 초기화 (모든 데이터 삭제)

**경고**: 모든 설치와 작업 파일이 삭제됩니다!

```bash
docker compose -f docker-compose.dev.yml down -v
```

## 주의사항

### 유지되는 것
✅ nvm/pyenv 설치 버전
✅ npm/pip 패키지
✅ /workspace 작업 파일
✅ ~/.bashrc 설정
✅ ~/.ssh 키
✅ ~/.config 설정 파일
✅ 전역 npm 패키지 (`npm -g`)

### 유지되지 않는 것
❌ `/app` 디렉토리 (소스 코드는 호스트에서 마운트)
❌ 시스템 패키지 (apt install한 것들 - Dockerfile에 추가해야 함)
❌ Redis 데이터 (별도 볼륨 `redis-data-dev`)

## 실전 사용 예시

```bash
# 1. 웹 터미널 접속
# 2. 프로젝트 설정
cd /workspace
git clone https://github.com/user/my-project.git
cd my-project
nvm install 20
nvm use 20
npm install
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 3. 작업
npm run dev
# 또는
python app.py

# 4. 언제든 재시작 가능
# docker compose restart backend
# 모든 환경이 그대로 유지됨!
```

## 볼륨 관리

```bash
# 볼륨 목록 확인
docker volume ls | grep iterminallist

# 볼륨 상세 정보
docker volume inspect iterminallist_root-home
docker volume inspect iterminallist_workspace-data
docker volume inspect iterminallist_usr-local

# 특정 볼륨만 삭제 (주의!)
docker volume rm iterminallist_workspace-data

# 모든 미사용 볼륨 삭제
docker volume prune
```

## VM처럼 사용하기

이제 컨테이너를 가상 머신처럼 사용할 수 있습니다:
1. 원하는 대로 환경 설정
2. 패키지 설치
3. 프로젝트 작업
4. 컨테이너 재시작/재빌드 → 모든 것 유지
5. 필요시 호스트 백업 (`docker volume export`)

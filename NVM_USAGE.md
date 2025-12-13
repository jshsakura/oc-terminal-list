# 언어 버전 관리 가이드 (nvm + pyenv)

백엔드 컨테이너에 **nvm**과 **pyenv**가 설치되어 있어 Node.js와 Python 버전을 자유롭게 관리할 수 있습니다.

## 컨테이너 접속

```bash
docker exec -it iterminallist-backend-dev bash
```

## nvm 기본 사용법

### 1. Node.js 버전 확인
```bash
# 현재 사용 중인 버전
node --version
nvm current

# 설치된 버전 목록
nvm ls

# 사용 가능한 모든 버전 보기
nvm ls-remote
```

### 2. Node.js 설치

```bash
# 최신 LTS 버전 설치
nvm install --lts

# 특정 버전 설치
nvm install 18.19.0
nvm install 20.10.0
nvm install 21.5.0

# 최신 버전 설치
nvm install node
```

### 3. 버전 전환

```bash
# 특정 버전으로 전환
nvm use 20.10.0

# LTS 버전으로 전환
nvm use --lts

# 기본 버전 설정
nvm alias default 20.10.0
```

### 4. 버전 삭제

```bash
# 특정 버전 삭제
nvm uninstall 18.19.0
```

## npm 패키지 관리

각 Node.js 버전은 독립적인 npm과 전역 패키지를 가집니다.

```bash
# 전역 패키지 설치
npm install -g @anthropic-ai/claude-code
npm install -g typescript
npm install -g pnpm

# 설치된 전역 패키지 확인
npm list -g --depth=0
```

## 영속성

설치한 모든 Node.js 버전과 패키지는 Docker 볼륨(`nvm-data`)에 저장되어:
- ✅ 컨테이너 재시작 후에도 유지됨
- ✅ 이미지 재빌드 후에도 유지됨
- ❌ 볼륨 삭제 시에만 초기화됨

```bash
# 볼륨 삭제 (모든 nvm 설치 초기화)
docker compose -f docker-compose.dev.yml down -v
```

## 예제 워크플로우

```bash
# 1. 컨테이너 접속
docker exec -it iterminallist-backend-dev bash

# 2. 사용 가능한 LTS 버전 확인
nvm ls-remote --lts

# 3. Node.js 20.x LTS 설치
nvm install 20

# 4. Node.js 18.x LTS 설치
nvm install 18

# 5. 버전 전환 테스트
nvm use 20
node --version  # v20.x.x

nvm use 18
node --version  # v18.x.x

# 6. 기본 버전을 20으로 설정
nvm alias default 20

# 7. 각 버전에서 패키지 설치
nvm use 20
npm install -g typescript

nvm use 18
npm install -g ts-node
```

## 터미널에서 직접 사용

iTerminaLlist 웹 터미널에서 바로 nvm 명령어를 사용할 수 있습니다:

1. 웹 터미널 접속 (http://localhost:5173)
2. 로그인
3. 터미널에서 직접 실행:
   ```bash
   nvm install 21
   nvm use 21
   node --version
   ```

## 문제 해결

### nvm 명령어를 찾을 수 없음
```bash
# bashrc 다시 로드
source ~/.bashrc

# 또는 직접 로드
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
```

### 설치한 버전이 사라짐
- 볼륨이 삭제되었는지 확인:
  ```bash
  docker volume ls | grep nvm-data
  ```
- 없다면 다시 설치:
  ```bash
  docker compose -f docker-compose.dev.yml up -d
  ```

## 기본 설치 버전

컨테이너 초기 빌드 시 자동으로 설치되는 버전:
- **Node.js LTS** (최신 안정 버전)
- **npm** (Node.js 포함)
- **@anthropic-ai/claude-code** (전역 패키지)
- **Python 3.11.7** (기본 버전)
- **Python 3.12.1** (추가 버전)

---

# Python 버전 관리 (pyenv)

## pyenv 기본 사용법

### 1. Python 버전 확인
```bash
# 현재 사용 중인 버전
python --version
pyenv version

# 설치된 버전 목록
pyenv versions

# 사용 가능한 모든 버전 보기
pyenv install --list
```

### 2. Python 설치

```bash
# 최신 3.11.x 설치
pyenv install 3.11.7

# 최신 3.12.x 설치
pyenv install 3.12.1

# 특정 버전 설치
pyenv install 3.10.13
pyenv install 3.9.18
```

### 3. 버전 전환

```bash
# 전역 기본 버전 설정
pyenv global 3.12.1

# 로컬 디렉토리 버전 설정
pyenv local 3.11.7

# 현재 셸 세션만 변경
pyenv shell 3.10.13
```

### 4. 버전 삭제

```bash
# 특정 버전 삭제
pyenv uninstall 3.9.18
```

## pip와 가상환경

각 Python 버전은 독립적인 pip를 가집니다.

```bash
# pip 업그레이드
pip install --upgrade pip

# 패키지 설치
pip install fastapi uvicorn

# 가상환경 생성 (venv)
python -m venv myenv
source myenv/bin/activate

# 또는 pyenv-virtualenv 사용
pyenv virtualenv 3.11.7 myproject
pyenv activate myproject
```

## 멀티 언어 워크플로우

Node.js와 Python을 함께 사용:

```bash
# 1. Python 3.12로 전환
pyenv global 3.12.1
python --version

# 2. Node.js 20으로 전환
nvm use 20
node --version

# 3. 각 언어의 패키지 설치
pip install requests
npm install -g typescript

# 4. 프로젝트별 버전 설정
cd /workspace/my-project
pyenv local 3.11.7
nvm use 18
```

## 영속성

nvm과 pyenv의 모든 설치 버전은 Docker 볼륨에 저장됩니다:
- `nvm-data` - Node.js 버전들
- `pyenv-data` - Python 버전들

이 볼륨들은 컨테이너 재시작/재빌드 후에도 유지됩니다.

```bash
# 볼륨 확인
docker volume ls | grep -E 'nvm|pyenv'

# 모든 설정 초기화 (볼륨 삭제)
docker compose -f docker-compose.dev.yml down -v
```

# 배포 가이드 (systemd)

iTerminaLlist 백엔드를 systemd 서비스로 등록해 부팅 시 자동 시작 + 비정상 종료 시 재시작.

## 사전 준비

```bash
# 1) venv 와 의존성 (이미 했으면 스킵)
cd /home/ubuntu/app/jupyterLab/notebooks/iTerminaLlist
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt

# 2) 프론트엔드 빌드 → backend/static
cd frontend
npm install
npm run build
```

## 서비스 등록

```bash
# 유닛 파일 설치
sudo cp deploy/iterminallist.service /etc/systemd/system/iterminallist.service
sudo systemctl daemon-reload

# 부팅 시 자동시작 + 즉시 시작
sudo systemctl enable --now iterminallist.service

# 상태 확인
systemctl status iterminallist.service
```

## 운영 명령

```bash
# 로그 (실시간 follow)
journalctl -u iterminallist.service -f

# 재시작 / 중지
sudo systemctl restart iterminallist.service
sudo systemctl stop iterminallist.service

# 자동시작 해제
sudo systemctl disable iterminallist.service
```

## 설정 변경 시

`.env` 만 수정한 경우:

```bash
sudo systemctl restart iterminallist.service
```

`deploy/iterminallist.service` 자체를 수정한 경우:

```bash
sudo cp deploy/iterminallist.service /etc/systemd/system/iterminallist.service
sudo systemctl daemon-reload
sudo systemctl restart iterminallist.service
```

## 프론트엔드 갱신 시

`backend/static` 은 `vite build` 의 출력 디렉토리이므로:

```bash
cd frontend && npm run build
sudo systemctl restart iterminallist.service   # 서빙되는 정적파일은 즉시 반영되지만 캐시 헤더 갱신 위해 재시작 권장
```

## 개발 모드 (서비스 사용 안 함)

```bash
# 백엔드 + vite dev server 동시 실행 (자식 죽으면 자동 재시작)
python run.py

# 백엔드만
python run.py --backend
```

## JWT 키 회전

JWT 서명 키는 DB(`system_config.jwt_secret_key`) 에 자동 생성/저장된다 — `.env` 에는 두지 않는다.
회전이 필요하면:

```bash
.venv/bin/python backend/rotate_jwt.py             # 미리보기
.venv/bin/python backend/rotate_jwt.py --confirm   # 실제 회전
sudo systemctl restart iterminallist.service       # 서비스 재시작
```

회전 후 모든 기존 access token 무효 → 모든 사용자가 다시 로그인.

## 비밀 키 관리 (vault.py)

저장된 SSH 비밀키 / 호스트 비밀번호 / OTP 비밀키는 `data/.vault-key` (자동 생성 0600)
로 암호화된다. JWT_SECRET_KEY 와 분리되어 있어서 JWT 회전해도 vault 데이터는 그대로.

운영 시 주의:
- `data/.vault-key` 는 절대 백업/이미지에서 분실하면 안 됨 → 잃으면 모든 vault 항목 복구 불가
- `.gitignore` 에 등록되어 있어 실수로 커밋되지 않음
- 다른 서버로 이전 시 `.vault-key` 와 DB 를 함께 복사

기존 v1 (JWT 파생 키) 데이터가 있으면 한 번만 마이그레이션:

```bash
# 이전 JWT_SECRET_KEY 알 때 — OLD_JWT_SECRET_KEY 환경변수로 지정
OLD_JWT_SECRET_KEY='이전값' .venv/bin/python backend/migrate_vault.py --dry-run
OLD_JWT_SECRET_KEY='이전값' .venv/bin/python backend/migrate_vault.py
```

스크립트는 자동으로 DB `.bak-pre-vault-migrate` 백업을 만든다.

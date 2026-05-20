# 배포 & 운영 가이드 (systemd 셀프호스트)

Docker 가 아닌 호스트에 직접 띄울 때의 가이드. 부팅 시 자동 시작, 비정상 종료 시 재시작, JWT/Vault 키 관리, 2FA 설정, 백업까지.

> Docker 배포는 프로젝트 루트의 [README.md](../README.md) 참조.

## 목차
1. [사전 준비](#사전-준비)
2. [서비스 등록](#서비스-등록)
3. [운영 명령](#운영-명령)
4. [초기 설정 (관리자 계정)](#초기-설정-관리자-계정)
5. [2단계 인증 (TOTP)](#2단계-인증-totp)
6. [JWT 키 회전](#jwt-키-회전)
7. [Vault 마스터 키 관리](#vault-마스터-키-관리)
8. [백업 & 복구](#백업--복구)
9. [설정 변경 시 재배포](#설정-변경-시-재배포)
10. [개발 모드](#개발-모드-서비스-사용-안-함)
11. [트러블슈팅](#트러블슈팅)

---

## 사전 준비

```bash
cd /home/ubuntu/app/jupyterLab/notebooks/iTerminaLlist

# 1) venv + 백엔드 의존성
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt

# 2) 프론트엔드 빌드 → backend/static
cd frontend && npm install && npm run build && cd ..

# 3) .env 검토
cp .env.example .env  # 처음이라면
# WORKSPACE_ROOT, DB_PATH, APP_PORT 등 본인 환경에 맞게 편집
```

`.env` 에 **JWT 키 / vault 키는 두지 않는다** — 자동 생성/관리됨.

## 서비스 등록

```bash
sudo cp deploy/iterminallist.service /etc/systemd/system/iterminallist.service
sudo systemctl daemon-reload
sudo systemctl enable --now iterminallist.service
systemctl status iterminallist.service
```

성공하면 `Active: active (running)` 표시. 부팅 시 자동 시작 + 비정상 종료 시 5초 후 재시작.

## 운영 명령

```bash
# 실시간 로그
journalctl -u iterminallist.service -f

# 재시작 / 중지
sudo systemctl restart iterminallist.service
sudo systemctl stop iterminallist.service

# 자동시작 해제
sudo systemctl disable iterminallist.service
```

## 초기 설정 (관리자 계정)

1. 브라우저에서 `http://<서버>:<APP_PORT>` 접속 (기본 38822)
2. **System Initialization** 화면에서 관리자 계정 생성 (사용자명 ≥3자, 비밀번호 ≥8자)
3. 로그인 후 사용

이후 추가 사용자는 (현재 시점) 단일 관리자 모델이라 추가하지 않는다.

## 2단계 인증 (TOTP)

### 활성화
1. 로그인 → ⚙️ **Settings** → **2단계 인증** 섹션
2. **Enable 2FA** 클릭
3. Google Authenticator / Microsoft Authenticator / 1Password / Bitwarden 등 인증앱으로 QR 스캔
   (또는 표시된 비밀키를 수동 입력)
4. 인증앱이 보여주는 6자리 코드 입력 → **Verify & enable**
5. **백업 코드 10개** 가 한 번만 표시됨 — 안전한 곳에 보관 (다시 표시 안 됨)

이후 로그인 흐름: 비밀번호 → 6자리 OTP 코드 입력. 인증앱이 없으면 백업 코드(일회용) 사용.

### 백업 코드 재발급
**Settings → 2단계 인증 → New backup codes** — 기존 코드 전부 무효화.

### 비활성화
**Settings → 2단계 인증 → Disable 2FA** + 비밀번호 재확인.
비밀키와 모든 백업 코드가 삭제되며 다음 로그인부터는 비밀번호만 받는다.

### 디바이스 분실 시
1. 백업 코드로 로그인 (Login 화면 → "백업 코드로 로그인")
2. Settings 에서 OTP 비활성화 후 새로 설정

백업 코드도 잃었다면 호스트에서 직접 SQLite 수정 필요:
```bash
.venv/bin/python -c "
import sqlite3
conn = sqlite3.connect('data/iterminallist.db')
conn.execute('UPDATE admin SET otp_enabled=0, otp_secret_enc=NULL')
conn.execute('DELETE FROM admin_backup_codes')
conn.commit()
"
```

## JWT 키 회전

JWT 서명 키는 기본적으로 `data/.jwt-secret` 파일에 0600 권한으로 자동 생성/저장된다.
`JWT_SECRET_PATH` 로 경로를 바꿀 수 있으며, `.env` 에 키 값을 직접 두지 않는다.

```bash
.venv/bin/python backend/rotate_jwt.py             # 미리보기
.venv/bin/python backend/rotate_jwt.py --confirm   # 실제 회전
sudo systemctl restart iterminallist.service
```

회전 후 모든 기존 access token 무효 → 모든 사용자가 다시 로그인.

회전이 API 가 아닌 CLI 인 이유: incident response 외에 거의 만질 일이 없어서 평상시 노출되는 엔드포인트로 둘 필요 없음.

## Vault 마스터 키 관리

저장된 SSH 비밀키 / 호스트 비밀번호 / OTP 비밀키는 `data/.vault-key` (0600, 자동 생성) 으로 암호화된다. **JWT 와 분리** — JWT 회전해도 vault 데이터는 그대로.

운영 시 주의:
- `data/.vault-key` 잃으면 vault 항목 전부 복구 불가 → 백업 정책에 반드시 포함
- `.gitignore` 등록되어 있어 실수 커밋 안 됨
- 다른 서버 이전 시 **`data/.vault-key` 와 DB 를 함께** 복사

### 레거시 데이터 마이그레이션 (1회용)
v1 (JWT_SECRET_KEY 파생 키) 시절 데이터가 남아있다면:

```bash
# 이전 JWT_SECRET_KEY 를 알아야 함 (env 에서 직접 보거나 백업에서 확인)
OLD_JWT_SECRET_KEY='이전값' .venv/bin/python backend/migrate_vault.py --dry-run
OLD_JWT_SECRET_KEY='이전값' .venv/bin/python backend/migrate_vault.py
```

DB `.bak-pre-vault-migrate` 백업이 자동 생성됨.

## 백업 & 복구

### 무엇을 백업하나
| 파일 | 용도 | 손실 시 |
|---|---|---|
| `data/iterminallist.db` | 모든 데이터 (admin, hosts, sessions, OTP 메타) | 전체 데이터 손실 |
| `data/.vault-key` | vault 마스터 키 | SSH 키 / 호스트 비밀번호 / OTP 비밀키 복호화 불가 |

**둘은 반드시 함께** — 한쪽만 살아있으면 vault 항목들이 인질이 됨.

### 백업 (서비스 동작 중에도 안전)
```bash
DEST=/backup/iterminallist-$(date +%Y%m%d-%H%M)
mkdir -p "$DEST"
sqlite3 data/iterminallist.db ".backup $DEST/iterminallist.db" 2>/dev/null \
  || cp data/iterminallist.db "$DEST/iterminallist.db"
cp data/.vault-key "$DEST/.vault-key"
chmod 600 "$DEST/.vault-key"
```

`sqlite3` CLI 없으면 그냥 `cp` 도 OK (단일 파일이라 트랜잭션 중간에도 무결성 유지되지만 일관성 보장은 sqlite3 .backup 이 더 안전).

### 복구
```bash
sudo systemctl stop iterminallist.service
cp /backup/iterminallist-XXXX/iterminallist.db data/
cp /backup/iterminallist-XXXX/.vault-key data/
chmod 600 data/.vault-key
sudo systemctl start iterminallist.service
```

## 설정 변경 시 재배포

| 변경한 것 | 필요한 조치 |
|---|---|
| `.env` 값 | `sudo systemctl restart iterminallist.service` |
| `deploy/iterminallist.service` 자체 | `sudo cp ... && sudo systemctl daemon-reload && sudo systemctl restart ...` |
| 백엔드 코드 (`backend/*.py`) | `sudo systemctl restart iterminallist.service` |
| 프론트엔드 (`frontend/src/*`) | `cd frontend && npm run build && sudo systemctl restart iterminallist.service` |

## 개발 모드 (서비스 사용 안 함)

운영 서비스를 잠시 끄고 dev mode (vite HMR + uvicorn reload) 로 작업할 때:

```bash
sudo systemctl stop iterminallist.service
python run.py            # 백엔드 + vite dev server 동시
python run.py --backend  # 백엔드만 (이미 vite 띄워뒀을 때)
```

`run.py` 는 자식 죽으면 자동 재시작 (지수 백오프), 60초 안에 5회 초과 실패하면 포기. 포트 충돌 자동 감지.

작업 끝나면:
```bash
sudo systemctl start iterminallist.service
```

## 트러블슈팅

### 부팅 안 됨 (`Active: failed`)
```bash
journalctl -u iterminallist.service -n 50 --no-pager
```
- `ModuleNotFoundError` → venv 재생성 + `pip install -r backend/requirements.txt`
- `port already in use` → `ss -tlnp | grep :38822` 로 점유 프로세스 확인

### 자꾸 재시작만 반복 (`auto-restart` 루프)
유닛 파일에 `StartLimitBurst=10` 설정되어 있어 5분 안에 10회 초과 실패하면 systemd 가 멈춤.
```bash
journalctl -u iterminallist.service -n 100 --no-pager   # 원인 확인
sudo systemctl reset-failed iterminallist.service       # 카운터 리셋
sudo systemctl start iterminallist.service
```

### 로그인 후 즉시 튕김
JWT 키가 회전됐을 때 발생. 다시 로그인하면 서버가 HttpOnly 세션 쿠키를 재발급한다.

### vault 데이터 복호화 실패 (호스트 SSH/비밀번호 안 됨)
`data/.vault-key` 가 다른 키로 바뀌었을 가능성. 백업에서 복구하거나 영향받은 항목 재등록.

### reloader (watchfiles) 가 운영에서 떠있음
`.env` 에 `RELOAD=true` 가 있으면 systemd 의 `Environment=RELOAD=false` 보다 우선됨.
`.env` 에서 `RELOAD` 줄 자체를 제거해야 함 (이 저장소의 `.env.example` 도 그렇게 두고 있음).

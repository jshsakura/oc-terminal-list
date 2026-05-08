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

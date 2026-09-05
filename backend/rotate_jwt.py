#!/usr/bin/env python3
"""
JWT 서명 키 회전.

새 버전: 키는 data/.jwt-secret 파일에 0600 으로 저장 (vault 키와 동일 디렉토리).
레거시 DB(system_config.jwt_secret_key) 에 키가 남아있으면 같이 정리.
교체 후 모든 기존 access_token 이 무효 → 모든 사용자가 다시 로그인해야 한다.

사용법
    .venv/bin/python backend/rotate_jwt.py             # 미리보기 (실제 변경 없음)
    .venv/bin/python backend/rotate_jwt.py --confirm   # 실제 회전

운영 시
    rotate 후 systemd 서비스 재시작 권장:
        sudo systemctl restart iterminallist.service
"""
from __future__ import annotations

import argparse
import os
import secrets
import sqlite3
import sys
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _THIS_DIR.parent

from dotenv import load_dotenv  # noqa: E402

load_dotenv(_PROJECT_ROOT / ".env", override=True)

DB_PATH = os.getenv("DB_PATH") or str(_PROJECT_ROOT / "data" / "iterminallist.db")
JWT_KEY_PATH = Path(os.getenv("JWT_SECRET_PATH") or (_PROJECT_ROOT / "data" / ".jwt-secret"))


def _mask(value: str | None) -> str:
    return (value[:6] + "…" + value[-4:]) if value else "(없음)"


def _read_file_key() -> str | None:
    if not JWT_KEY_PATH.exists():
        return None
    try:
        raw = JWT_KEY_PATH.read_text(encoding="utf-8").strip()
        return raw or None
    except OSError:
        return None


def _write_file_key(key: str) -> None:
    JWT_KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(JWT_KEY_PATH), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, key.encode("utf-8"))
    finally:
        os.close(fd)
    try:
        os.chmod(str(JWT_KEY_PATH), 0o600)
    except OSError:
        pass


def _read_db_legacy_key() -> str | None:
    if not Path(DB_PATH).exists():
        return None
    conn = sqlite3.connect(DB_PATH)
    try:
        row = conn.execute(
            "SELECT value FROM system_config WHERE key = 'jwt_secret_key'"
        ).fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def _delete_db_legacy_key() -> None:
    if not Path(DB_PATH).exists():
        return
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("DELETE FROM system_config WHERE key = 'jwt_secret_key'")
        conn.commit()
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--confirm", action="store_true", help="실제 회전 (없으면 미리보기)")
    args = parser.parse_args()

    file_key = _read_file_key()
    legacy_key = _read_db_legacy_key()
    print(f"[info] JWT key file  = {JWT_KEY_PATH}")
    print(f"[info] file 현재 키   = {_mask(file_key)}")
    print(f"[info] DB (legacy)   = {_mask(legacy_key)}")

    if not args.confirm:
        print("[note] --confirm 없음 — 변경 없음")
        print("       실제 회전: backend/rotate_jwt.py --confirm")
        return 0

    new_key = secrets.token_urlsafe(48)
    _write_file_key(new_key)
    if legacy_key:
        _delete_db_legacy_key()
        print("[info] DB 레거시 키 삭제됨")

    print(f"[done] 새 JWT 키 저장됨 — {_mask(new_key)}  ({JWT_KEY_PATH})")
    print("[next] 운영 중이면 백엔드 재시작:")
    print("       sudo systemctl restart iterminallist.service")
    print("[note] 모든 기존 토큰이 즉시 무효 — 모든 사용자가 다시 로그인해야 합니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

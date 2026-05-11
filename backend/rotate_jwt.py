#!/usr/bin/env python3
"""
JWT 서명 키 회전.

DB(system_config.jwt_secret_key) 에 자동저장된 키를 새 무작위 값으로 교체.
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
import secrets
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _THIS_DIR.parent

from dotenv import load_dotenv  # noqa: E402

load_dotenv(_PROJECT_ROOT / ".env", override=True)

import os  # noqa: E402

DB_PATH = os.getenv("DB_PATH") or str(_PROJECT_ROOT / "data" / "iterminallist.db")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--confirm", action="store_true", help="실제 회전 (없으면 미리보기)")
    args = parser.parse_args()

    if not Path(DB_PATH).exists():
        print(f"[abort] DB 파일 없음: {DB_PATH}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT value FROM system_config WHERE key = 'jwt_secret_key'"
    ).fetchone()
    current = row[0] if row else None
    masked = (current[:6] + "…" + current[-4:]) if current else "(없음 — 다음 부팅 시 자동 생성)"
    print(f"[info] DB             = {DB_PATH}")
    print(f"[info] 현재 JWT 키    = {masked}")

    if not args.confirm:
        print("[note] --confirm 없음 — 변경 없음")
        print("       실제 회전: backend/rotate_jwt.py --confirm")
        conn.close()
        return 0

    new_key = secrets.token_urlsafe(48)
    now = datetime.utcnow().isoformat()
    if current is None:
        conn.execute(
            "INSERT INTO system_config (key, value, created_at) VALUES (?, ?, ?)",
            ("jwt_secret_key", new_key, now),
        )
    else:
        conn.execute(
            "UPDATE system_config SET value = ?, created_at = ? WHERE key = 'jwt_secret_key'",
            (new_key, now),
        )
    conn.commit()
    conn.close()

    print(f"[done] 새 JWT 키 저장됨 — {new_key[:6]}…{new_key[-4:]}")
    print("[next] 운영 중이면 백엔드 재시작:")
    print("       sudo systemctl restart iterminallist.service")
    print("[note] 모든 기존 토큰이 즉시 무효 — 모든 사용자가 다시 로그인해야 합니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

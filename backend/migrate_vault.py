#!/usr/bin/env python3
"""
vault.py v1 (JWT_SECRET_KEY 파생) → v2 (data/.vault-key) 마이그레이션.

현재 DB 안의 모든 vault 암호문 (ssh_keys.private_key_enc, ssh_keys.passphrase_enc,
hosts.password_enc, admin.otp_secret_enc) 을 새 vault 키로 재암호화한다.

원칙
    - 이미 새 키로 풀리는 항목은 건너뜀
    - 새 키와 레거시 키 모두 실패하는 항목은 손상으로 보고만 하고 건드리지 않음
    - 백업: 실행 전 DB 파일을 .bak 로 복사

사용법
    .venv/bin/python backend/migrate_vault.py            # 자동 — 운영 환경에 맞춰 .env 의 JWT 사용
    .venv/bin/python backend/migrate_vault.py --dry-run  # 변경 없이 어떤 항목이 바뀔지만 출력
    OLD_JWT_SECRET_KEY='xxx' .venv/bin/python backend/migrate_vault.py
        # 이미 .env 의 JWT 를 바꿨고 이전 값을 알 때 — 이전 값을 환경변수로 넣어 강제 사용
"""
from __future__ import annotations

import argparse
import os
import shutil
import sqlite3
import sys
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _THIS_DIR.parent
sys.path.insert(0, str(_THIS_DIR))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(_PROJECT_ROOT / ".env", override=True)

# OLD_JWT_SECRET_KEY 가 있으면 vault.py 가 그걸 레거시 키로 쓰도록 환경변수 치환
if os.getenv("OLD_JWT_SECRET_KEY"):
    os.environ["JWT_SECRET_KEY"] = os.environ["OLD_JWT_SECRET_KEY"]

from cryptography.fernet import InvalidToken  # noqa: E402

from vault import _get_fernet, _vault_key_path, reencrypt_legacy  # noqa: E402

DB_PATH = os.getenv("DB_PATH") or str(_PROJECT_ROOT / "data" / "iterminallist.db")

# (table, primary_key_col, ciphertext_col, label) — 모든 vault 암호문 위치
TARGETS = [
    ("ssh_keys", "id", "private_key_enc", "SSH private key"),
    ("ssh_keys", "id", "passphrase_enc",  "SSH passphrase"),
    ("hosts",    "id", "password_enc",    "host password"),
    ("admin",    "id", "otp_secret_enc",  "OTP secret"),
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not Path(DB_PATH).exists():
        print(f"[abort] DB 파일 없음: {DB_PATH}", file=sys.stderr)
        return 1

    print(f"[info] DB        = {DB_PATH}")
    print(f"[info] vault key = {_vault_key_path()}")
    # 키 강제 로드 (없으면 생성)
    _get_fernet()
    print(f"[info] vault key {'loaded' if _vault_key_path().exists() else 'created'}")

    if not args.dry_run:
        backup = Path(DB_PATH).with_suffix(Path(DB_PATH).suffix + ".bak-pre-vault-migrate")
        shutil.copy2(DB_PATH, backup)
        print(f"[info] DB 백업    = {backup}")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    summary = {"migrated": 0, "already_v2": 0, "broken": 0, "empty": 0}
    broken_items: list[tuple[str, str, str]] = []

    for table, pk_col, enc_col, label in TARGETS:
        rows = conn.execute(f"SELECT {pk_col} AS pk, {enc_col} AS enc FROM {table}").fetchall()
        for row in rows:
            pk = row["pk"]
            enc = row["enc"]
            if not enc:
                summary["empty"] += 1
                continue
            try:
                _get_fernet().decrypt(enc.encode("ascii"))
                summary["already_v2"] += 1
                continue
            except InvalidToken:
                pass
            new_enc = reencrypt_legacy(enc)
            if new_enc is None:
                summary["broken"] += 1
                broken_items.append((table, str(pk), label))
                print(f"  ! {label} in {table}#{pk} — 복호화 불가 (레거시 키 불일치 또는 손상)")
                continue
            print(f"  ✓ {label} in {table}#{pk} — 재암호화")
            if not args.dry_run:
                conn.execute(
                    f"UPDATE {table} SET {enc_col} = ? WHERE {pk_col} = ?",
                    (new_enc, pk),
                )
            summary["migrated"] += 1

    if not args.dry_run:
        conn.commit()
    conn.close()

    print()
    print(f"[summary] migrated={summary['migrated']}  already_v2={summary['already_v2']}  "
          f"broken={summary['broken']}  empty={summary['empty']}")
    if broken_items:
        print("[summary] 손상 항목 (아래는 수동 재등록 필요):")
        for t, k, lbl in broken_items:
            print(f"  - {lbl}: {t}#{k}")
    if args.dry_run:
        print("[note] --dry-run — DB 변경 없음")
    return 0 if summary["broken"] == 0 else 2


if __name__ == "__main__":
    sys.exit(main())

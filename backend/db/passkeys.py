"""WebAuthn 자격증명 저장.

SQLiteStorage 에 믹스인으로 합류한다 — 호출부는 그대로 `storage.<메서드>()` 다.
연결 획득/반납(`_get_connection`/`_release_connection`)은 db/base.py 가 제공한다.
"""
from __future__ import annotations

from datetime import datetime
import asyncio



class PasskeyMixin:
    async def add_passkey_credential(
        self,
        username: str,
        credential_id: bytes,
        public_key: bytes,
        sign_count: int,
        transports: list[str] | None = None,
        label: str | None = None,
        aaguid: bytes | None = None,
        backup_eligible: bool = False,
        backup_state: bool = False,
    ) -> int:
        transports_csv = ",".join(transports) if transports else None
        now = datetime.utcnow().isoformat()
        def _add():
            conn = self._get_connection()
            try:
                cur = conn.execute(
                    """
                    INSERT INTO passkey_credentials
                    (username, credential_id, public_key, sign_count, transports, label,
                     aaguid, backup_eligible, backup_state, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        username, credential_id, public_key, int(sign_count),
                        transports_csv, label, aaguid,
                        1 if backup_eligible else 0,
                        1 if backup_state else 0,
                        now,
                    ),
                )
                conn.commit()
                return cur.lastrowid
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_add)

    async def list_passkey_credentials(self, username: str) -> list[dict]:
        def _list():
            conn = self._get_connection()
            try:
                rows = conn.execute(
                    """
                    SELECT id, credential_id, sign_count, transports, label, aaguid,
                           backup_eligible, backup_state, created_at, last_used_at
                    FROM passkey_credentials
                    WHERE username = ?
                    ORDER BY created_at DESC
                    """,
                    (username,),
                ).fetchall()
                return [
                    {
                        "id": r["id"],
                        "credential_id": bytes(r["credential_id"]),
                        "sign_count": int(r["sign_count"]),
                        "transports": (r["transports"] or "").split(",") if r["transports"] else [],
                        "label": r["label"],
                        "aaguid": bytes(r["aaguid"]) if r["aaguid"] else None,
                        "backup_eligible": bool(r["backup_eligible"]),
                        "backup_state": bool(r["backup_state"]),
                        "created_at": r["created_at"],
                        "last_used_at": r["last_used_at"],
                    }
                    for r in rows
                ]
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_list)

    async def get_passkey_credential(self, credential_id: bytes) -> dict | None:
        """username 무관 조회 — passkey 로그인은 username-less 로 들어올 수도 있다."""
        def _get():
            conn = self._get_connection()
            try:
                row = conn.execute(
                    """
                    SELECT id, username, credential_id, public_key, sign_count, transports,
                           backup_eligible, backup_state
                    FROM passkey_credentials WHERE credential_id = ?
                    """,
                    (credential_id,),
                ).fetchone()
                if not row:
                    return None
                return {
                    "id": row["id"],
                    "username": row["username"],
                    "credential_id": bytes(row["credential_id"]),
                    "public_key": bytes(row["public_key"]),
                    "sign_count": int(row["sign_count"]),
                    "transports": (row["transports"] or "").split(",") if row["transports"] else [],
                    "backup_eligible": bool(row["backup_eligible"]),
                    "backup_state": bool(row["backup_state"]),
                }
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_get)

    async def update_passkey_after_use(
        self, credential_id: bytes, sign_count: int, backup_state: bool | None = None,
    ) -> None:
        now = datetime.utcnow().isoformat()
        def _update():
            conn = self._get_connection()
            try:
                if backup_state is None:
                    conn.execute(
                        "UPDATE passkey_credentials SET sign_count = ?, last_used_at = ? WHERE credential_id = ?",
                        (int(sign_count), now, credential_id),
                    )
                else:
                    conn.execute(
                        "UPDATE passkey_credentials SET sign_count = ?, backup_state = ?, last_used_at = ? WHERE credential_id = ?",
                        (int(sign_count), 1 if backup_state else 0, now, credential_id),
                    )
                conn.commit()
            finally:
                self._release_connection(conn)
        await asyncio.to_thread(_update)

    async def rename_passkey_credential(self, row_id: int, username: str, label: str) -> bool:
        def _rename():
            conn = self._get_connection()
            try:
                cur = conn.execute(
                    "UPDATE passkey_credentials SET label = ? WHERE id = ? AND username = ?",
                    (label, row_id, username),
                )
                conn.commit()
                return cur.rowcount > 0
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_rename)

    async def delete_passkey_credential(self, row_id: int, username: str) -> bool:
        def _delete():
            conn = self._get_connection()
            try:
                cur = conn.execute(
                    "DELETE FROM passkey_credentials WHERE id = ? AND username = ?",
                    (row_id, username),
                )
                conn.commit()
                return cur.rowcount > 0
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_delete)

    # -------- snippets --------

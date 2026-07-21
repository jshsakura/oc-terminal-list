"""UI 설정 · 탭 상태 저장.

SQLiteStorage 에 믹스인으로 합류한다 — 호출부는 그대로 `storage.<메서드>()` 다.
연결 획득/반납(`_get_connection`/`_release_connection`)은 db/base.py 가 제공한다.
"""
from __future__ import annotations

from datetime import datetime
import asyncio
import json



class UserPrefsMixin:
    async def get_user_settings(self, username: str) -> dict | None:
        """사용자의 저장된 UI 설정. 없으면 None."""
        def _get():
            conn = self._get_connection()
            try:
                row = conn.execute(
                    "SELECT settings_json FROM user_settings WHERE username = ?", (username,)
                ).fetchone()
                if not row:
                    return None
                try:
                    return json.loads(row["settings_json"])
                except (TypeError, ValueError):
                    return None
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_get)

    async def save_user_settings(self, username: str, settings: dict) -> None:
        """사용자 설정 upsert. 단일 JSON blob 으로 보관."""
        payload = json.dumps(settings, ensure_ascii=False)
        def _save():
            conn = self._get_connection()
            try:
                conn.execute(
                    "INSERT OR REPLACE INTO user_settings (username, settings_json, updated_at) VALUES (?, ?, ?)",
                    (username, payload, datetime.utcnow().isoformat()),
                )
                conn.commit()
            finally:
                self._release_connection(conn)
        await asyncio.to_thread(_save)

    # -------- tab state (탭 순서/레이아웃 전체 — 기기 간 완전 복원) --------

    async def get_tab_state(self, username: str) -> dict | None:
        """저장된 탭 전체 상태. 없으면 None.
        updatedAt 은 다른 기기에서의 변경 감지를 위한 ETag 역할.
        """
        def _get():
            conn = self._get_connection()
            try:
                row = conn.execute(
                    "SELECT tabs_json, active_tab_id, updated_at FROM tab_state WHERE username = ?",
                    (username,),
                ).fetchone()
                if not row:
                    return None
                try:
                    return {
                        "tabs": json.loads(row["tabs_json"]),
                        "activeTabId": row["active_tab_id"],
                        "updatedAt": row["updated_at"],
                    }
                except (TypeError, ValueError):
                    return None
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_get)

    async def get_tab_state_updated_at(self, username: str) -> str | None:
        """탭 상태의 마지막 수정 시각만 가볍게 조회 (폴링용)."""
        def _get():
            conn = self._get_connection()
            try:
                row = conn.execute(
                    "SELECT updated_at FROM tab_state WHERE username = ?",
                    (username,),
                ).fetchone()
                return row["updated_at"] if row else None
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_get)

    async def save_tab_state(self, username: str, tabs: list, active_tab_id: str | None) -> str:
        """탭 전체 상태 upsert. 새 updated_at 을 반환 — 호출자가 자기 변경의 버전을 기억하게."""
        tabs_json = json.dumps(tabs, ensure_ascii=False)
        new_updated_at = datetime.utcnow().isoformat()
        def _save():
            conn = self._get_connection()
            try:
                conn.execute(
                    "INSERT OR REPLACE INTO tab_state (username, tabs_json, active_tab_id, updated_at) VALUES (?, ?, ?, ?)",
                    (username, tabs_json, active_tab_id, new_updated_at),
                )
                conn.commit()
            finally:
                self._release_connection(conn)
        await asyncio.to_thread(_save)
        return new_updated_at

    # -------- system config --------

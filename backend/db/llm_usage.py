"""LLM usage, accumulated in our DB.

Why store it at all when the agents already have logs: **those logs expire.**
Claude Code prunes old project transcripts on its own, a retired host takes its
history with it, and re-reading everything for a 90-day window is slow. What we
collected once should stay ours.

Upsert, never insert: collecting the same day twice must overwrite that day, not
add to it. That is what the composite primary key is for.

Joins the SQLiteStorage mixin set — call sites stay `storage.<method>()`.
Connection handling comes from db/base.py.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

TOKEN_FIELDS = ("input", "output", "cache_read", "cache_creation")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class LlmUsageMixin:
    async def upsert_llm_daily(self, username: str, source_id: str, rows: list) -> int:
        """Replace this source's numbers for every day present in `rows`.

        Days *not* in `rows` are left alone — a 7-day collection must not erase
        the 90-day history we already have.
        """
        if not rows:
            return 0
        stamp = _now()
        payload = [
            (
                username, source_id, str(r.get("day") or ""),
                str(r.get("agent") or "unknown"), str(r.get("model") or "unknown"),
                str(r.get("project") or "unknown"),
                int(r.get("input") or 0), int(r.get("output") or 0),
                int(r.get("cache_read") or 0), int(r.get("cache_creation") or 0),
                (float(r["cost"]) if r.get("cost") is not None else None),
                stamp,
            )
            for r in rows if r.get("day")
        ]

        def _write():
            conn = self._get_connection()
            try:
                # Same collection, same day → one row. INSERT alone would double
                # the numbers every time someone hits refresh twice in a day.
                conn.executemany(
                    """
                    INSERT INTO llm_usage_daily
                        (username, source_id, day, agent, model, project,
                         input, output, cache_read, cache_creation, cost, updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(username, source_id, day, agent, model, project)
                    DO UPDATE SET
                        input = excluded.input,
                        output = excluded.output,
                        cache_read = excluded.cache_read,
                        cache_creation = excluded.cache_creation,
                        cost = excluded.cost,
                        updated_at = excluded.updated_at
                    """,
                    payload,
                )
                conn.commit()
                return len(payload)
            finally:
                self._release_connection(conn)

        return await asyncio.to_thread(_write)

    async def query_llm_daily(self, username: str, since_day: str | None = None) -> list:
        """Stored rows, newest window first. `since_day` is inclusive ('2026-07-01')."""
        def _read():
            conn = self._get_connection()
            try:
                sql = (
                    "SELECT source_id, day, agent, model, project,"
                    " input, output, cache_read, cache_creation, cost"
                    " FROM llm_usage_daily WHERE username = ?"
                )
                args = [username]
                if since_day:
                    sql += " AND day >= ?"
                    args.append(since_day)
                sql += " ORDER BY day"
                cur = conn.execute(sql, args)
                cols = [c[0] for c in cur.description]
                return [dict(zip(cols, row)) for row in cur.fetchall()]
            finally:
                self._release_connection(conn)

        return await asyncio.to_thread(_read)

    async def upsert_llm_sessions(self, username: str, source_id: str, sessions: list) -> int:
        if not sessions:
            return 0
        payload = [
            (
                username, source_id, str(s.get("session_id") or ""),
                s.get("agent") or "", s.get("model") or "", s.get("project") or "",
                s.get("cwd") or "", s.get("title") or "", s.get("last_activity") or "",
                int(s.get("input") or 0), int(s.get("output") or 0),
                int(s.get("cache_read") or 0), int(s.get("cache_creation") or 0),
                (float(s["cost"]) if s.get("cost") is not None else None),
            )
            for s in sessions if s.get("session_id")
        ]

        def _write():
            conn = self._get_connection()
            try:
                conn.executemany(
                    """
                    INSERT INTO llm_usage_session
                        (username, source_id, session_id, agent, model, project, cwd,
                         title, last_activity, input, output, cache_read, cache_creation, cost)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(username, source_id, session_id) DO UPDATE SET
                        agent = excluded.agent,
                        model = excluded.model,
                        project = excluded.project,
                        cwd = excluded.cwd,
                        -- A remote collection sends no title (prompt text stays put),
                        -- so an empty one must not wipe a title we already have.
                        title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE title END,
                        last_activity = excluded.last_activity,
                        input = excluded.input,
                        output = excluded.output,
                        cache_read = excluded.cache_read,
                        cache_creation = excluded.cache_creation,
                        cost = excluded.cost
                    """,
                    payload,
                )
                conn.commit()
                return len(payload)
            finally:
                self._release_connection(conn)

        return await asyncio.to_thread(_write)

    async def query_llm_sessions(self, username: str, since_day: str | None = None,
                                 limit: int = 50) -> list:
        def _read():
            conn = self._get_connection()
            try:
                sql = (
                    "SELECT source_id, session_id, agent, model, project, cwd, title,"
                    " last_activity, input, output, cache_read, cache_creation, cost"
                    " FROM llm_usage_session WHERE username = ?"
                )
                args = [username]
                if since_day:
                    sql += " AND last_activity >= ?"
                    args.append(since_day)
                sql += " ORDER BY last_activity DESC LIMIT ?"
                args.append(int(limit))
                cur = conn.execute(sql, args)
                cols = [c[0] for c in cur.description]
                return [dict(zip(cols, row)) for row in cur.fetchall()]
            finally:
                self._release_connection(conn)

        return await asyncio.to_thread(_read)

    async def count_llm_sessions(self, username: str, since_day: str | None = None) -> dict:
        """`{source_id: count}` — the real number, not the length of the list.

        The list is capped for display; a session count that silently shrinks to
        that cap is simply a wrong number.
        """
        def _read():
            conn = self._get_connection()
            try:
                sql = ("SELECT source_id, COUNT(*) FROM llm_usage_session"
                       " WHERE username = ?")
                args = [username]
                if since_day:
                    sql += " AND last_activity >= ?"
                    args.append(since_day)
                sql += " GROUP BY source_id"
                return {row[0]: int(row[1]) for row in conn.execute(sql, args).fetchall()}
            finally:
                self._release_connection(conn)

        return await asyncio.to_thread(_read)

    async def get_llm_sources(self, username: str) -> dict:
        """`{source_id: {name, last_ok_at, last_try_at, last_error}}`."""
        def _read():
            conn = self._get_connection()
            try:
                cur = conn.execute(
                    "SELECT source_id, name, last_ok_at, last_try_at, last_error, retired_at"
                    " FROM llm_usage_source WHERE username = ?",
                    (username,),
                )
                cols = [c[0] for c in cur.description]
                return {row[0]: dict(zip(cols, row)) for row in cur.fetchall()}
            finally:
                self._release_connection(conn)

        return await asyncio.to_thread(_read)

    async def mark_llm_source(self, username: str, source_id: str, *, name: str = "",
                              ok: bool = False, error: str | None = None) -> None:
        """Record the attempt. `last_ok_at` is what the once-a-day throttle reads."""
        stamp = _now()

        def _write():
            conn = self._get_connection()
            try:
                conn.execute(
                    """
                    INSERT INTO llm_usage_source
                        (username, source_id, name, last_ok_at, last_try_at, last_error)
                    VALUES (?,?,?,?,?,?)
                    ON CONFLICT(username, source_id) DO UPDATE SET
                        name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE name END,
                        last_ok_at = CASE WHEN ? THEN excluded.last_ok_at ELSE last_ok_at END,
                        last_try_at = excluded.last_try_at,
                        last_error = excluded.last_error,
                        -- 수집에 성공했다는 건 그 소스가 살아 돌아왔다는 뜻이다.
                        -- 은퇴 표시를 남겨두면 보관 기간이 지나 조용히 지워진다.
                        retired_at = CASE WHEN ? THEN NULL ELSE retired_at END
                    """,
                    (username, source_id, name, stamp if ok else None, stamp, error,
                     1 if ok else 0, 1 if ok else 0),
                )
                conn.commit()
            finally:
                self._release_connection(conn)

        await asyncio.to_thread(_write)

    async def retire_llm_source(self, username: str, source_id: str) -> None:
        """호스트가 삭제됐다고 표시만 한다 — 데이터는 보관 기간 동안 남는다.

        소스 행이 없으면 만들지 않는다. 수집된 적 없는 호스트를 지우면서 유령을
        새로 만들 이유가 없다.
        """
        stamp = _now()

        def _write():
            conn = self._get_connection()
            try:
                conn.execute(
                    "UPDATE llm_usage_source SET retired_at = ?"
                    " WHERE username = ? AND source_id = ? AND retired_at IS NULL",
                    (stamp, username, source_id),
                )
                conn.commit()
            finally:
                self._release_connection(conn)

        await asyncio.to_thread(_write)

    async def purge_llm_source(self, username: str, source_id: str) -> dict:
        """소스와 그 데이터를 실제로 지운다. 되돌릴 수 없다.

        세 테이블을 **한 트랜잭션**에서 지운다 — 중간에 끊기면 어느 표에는 있고 어느
        표에는 없는 상태가 되고, 그건 화면에서 유령보다 더 헷갈린다.
        """
        def _write():
            conn = self._get_connection()
            try:
                daily = conn.execute(
                    "DELETE FROM llm_usage_daily WHERE username = ? AND source_id = ?",
                    (username, source_id)).rowcount
                sessions = conn.execute(
                    "DELETE FROM llm_usage_session WHERE username = ? AND source_id = ?",
                    (username, source_id)).rowcount
                usage = conn.execute(
                    "DELETE FROM usage_sessions WHERE username = ? AND target_id = ?",
                    (username, source_id)).rowcount
                conn.execute(
                    "DELETE FROM llm_usage_source WHERE username = ? AND source_id = ?",
                    (username, source_id))
                conn.commit()
                return {"daily": daily, "sessions": sessions, "usage_sessions": usage}
            finally:
                self._release_connection(conn)

        return await asyncio.to_thread(_write)

    async def list_expired_llm_sources(self, username: str, cutoff: str) -> list:
        """`retired_at` 이 cutoff 보다 오래된 소스 id. 보관 기간이 끝난 것들."""
        def _read():
            conn = self._get_connection()
            try:
                cur = conn.execute(
                    "SELECT source_id FROM llm_usage_source"
                    " WHERE username = ? AND retired_at IS NOT NULL AND retired_at < ?",
                    (username, cutoff),
                )
                return [r[0] for r in cur.fetchall()]
            finally:
                self._release_connection(conn)

        return await asyncio.to_thread(_read)

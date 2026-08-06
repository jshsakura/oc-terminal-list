"""세션 사용량 집계 저장.

SQLiteStorage 에 믹스인으로 합류한다 — 호출부는 그대로 `storage.<메서드>()` 다.
연결 획득/반납(`_get_connection`/`_release_connection`)은 db/base.py 가 제공한다.
"""
from __future__ import annotations

from datetime import datetime, timedelta
import asyncio



class UsageMixin:
    async def record_usage_start(
        self,
        username: str,
        target_type: str,
        target_id: str,
        session_id: str | None = None,
    ) -> int | None:
        """세션 attach 시점 row 생성. 반환된 event_id 를 record_usage_end 에 전달."""
        started_at = datetime.utcnow().isoformat()
        def _insert():
            conn = self._get_connection()
            try:
                cur = conn.execute(
                    """
                    INSERT INTO usage_sessions
                        (username, target_type, target_id, session_id, started_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (username, target_type, target_id, session_id, started_at),
                )
                conn.commit()
                return int(cur.lastrowid)
            except Exception:
                return None
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_insert)

    async def record_usage_end(self, event_id: int) -> None:
        """detach 시점 — duration 계산해서 update. id 가 None 이면 no-op."""
        if not event_id:
            return
        ended_at = datetime.utcnow().isoformat()
        def _update():
            conn = self._get_connection()
            try:
                row = conn.execute(
                    "SELECT started_at FROM usage_sessions WHERE id = ?",
                    (event_id,),
                ).fetchone()
                if not row:
                    return
                try:
                    started = datetime.fromisoformat(row["started_at"])
                    delta = (datetime.fromisoformat(ended_at) - started).total_seconds()
                    duration = max(0, int(delta))
                except (TypeError, ValueError):
                    duration = None
                conn.execute(
                    "UPDATE usage_sessions SET ended_at = ?, duration_seconds = ? WHERE id = ?",
                    (ended_at, duration, event_id),
                )
                conn.commit()
            finally:
                self._release_connection(conn)
        await asyncio.to_thread(_update)

    async def close_orphan_usage_sessions(self) -> int:
        """서버 재시작 시 ended_at 가 비어있는 모든 row 를 닫는다.
        Duration 은 started_at 기준으로 계산하지만, 부정확할 수 있어 NULL 로 표시."""
        ended_at = datetime.utcnow().isoformat()
        def _close():
            conn = self._get_connection()
            try:
                cur = conn.execute(
                    "UPDATE usage_sessions SET ended_at = ? WHERE ended_at IS NULL",
                    (ended_at,),
                )
                conn.commit()
                return int(cur.rowcount or 0)
            finally:
                self._release_connection(conn)
        return await asyncio.to_thread(_close)

    async def get_usage_summary(self, username: str, days: int = 7) -> dict:
        """최근 N일 사용 통계 집계.

        반환 구조:
          {
            "window_days": 7,
            "total_seconds": int, "session_count": int, "active_targets": int,
            "by_target": [{ target_type, target_id, total_seconds, session_count, last_used }, ...],
            "by_day": [{ day: "YYYY-MM-DD", seconds: int }, ...],   # 빈 날 포함, 오름차순
            "by_type": { "local": int_seconds, "host": int_seconds },
            "avg_session_seconds": int,
          }

        ended_at NULL row 도 (지금 진행중) 포함시켜 started_at 기준으로 계산.
        """
        window = max(1, min(int(days or 7), 365))
        cutoff = datetime.utcnow().timestamp() - window * 86400

        def _query():
            conn = self._get_connection()
            try:
                # 모든 윈도우 내 row 조회 — 라이브 row 포함 (ended_at IS NULL 도 잡음)
                rows = conn.execute(
                    """
                    SELECT target_type, target_id, started_at, ended_at, duration_seconds
                    FROM usage_sessions
                    WHERE username = ?
                    ORDER BY started_at DESC
                    """,
                    (username,),
                ).fetchall()
                return [dict(r) for r in rows]
            finally:
                self._release_connection(conn)

        rows = await asyncio.to_thread(_query)
        now_ts = datetime.utcnow().timestamp()
        total_seconds = 0
        session_count = 0
        by_type: dict[str, int] = {"local": 0, "host": 0}
        by_target_acc: dict[tuple[str, str], dict] = {}
        # 날짜별 합 — 대시보드 상단의 일별 막대. 시작일 기준으로 센다(자정을 넘긴 세션도
        # 시작한 날의 것으로 본다). 하루를 쪼개 배분하면 "하루 평균" 과 합이 안 맞는다.
        by_day_acc: dict[str, int] = {}

        for r in rows:
            try:
                started_ts = datetime.fromisoformat(r["started_at"]).timestamp()
            except (TypeError, ValueError):
                continue
            if started_ts < cutoff:
                continue
            # duration: ended_at 있으면 그 값, 없으면 now - started
            dur = r.get("duration_seconds")
            if dur is None:
                if r.get("ended_at"):
                    try:
                        dur = int(
                            (datetime.fromisoformat(r["ended_at"]).timestamp() - started_ts)
                        )
                    except (TypeError, ValueError):
                        dur = 0
                else:
                    dur = int(now_ts - started_ts)
            dur = max(0, int(dur or 0))
            total_seconds += dur
            session_count += 1
            ttype = r["target_type"] or "host"
            if ttype not in by_type:
                by_type[ttype] = 0
            by_type[ttype] += dur
            key = (ttype, r["target_id"] or "")
            slot = by_target_acc.setdefault(
                key,
                {
                    "target_type": ttype,
                    "target_id": r["target_id"] or "",
                    "total_seconds": 0,
                    "session_count": 0,
                    "last_used": r["started_at"],
                },
            )
            slot["total_seconds"] += dur
            slot["session_count"] += 1
            day_key = (r["started_at"] or "")[:10]
            if day_key:
                by_day_acc[day_key] = by_day_acc.get(day_key, 0) + dur
            if (slot["last_used"] or "") < (r["started_at"] or ""):
                slot["last_used"] = r["started_at"]

        by_target = sorted(
            by_target_acc.values(),
            key=lambda x: x["total_seconds"],
            reverse=True,
        )
        avg = int(total_seconds / session_count) if session_count else 0
        # 빈 날도 0 으로 채워 보낸다 — 막대가 없는 날은 "안 썼다" 이지 "모른다" 가 아니다.
        # 채우지 않으면 프론트가 간격을 균등하게 그려 며칠을 쉬었는지 사라진다.
        today = datetime.utcfromtimestamp(now_ts).date()
        by_day = []
        for offset in range(window - 1, -1, -1):
            day = (today - timedelta(days=offset)).isoformat()
            by_day.append({"day": day, "seconds": int(by_day_acc.get(day, 0))})
        return {
            "window_days": window,
            "total_seconds": total_seconds,
            "session_count": session_count,
            "active_targets": len(by_target_acc),
            "by_target": by_target,
            "by_type": by_type,
            "by_day": by_day,
            "avg_session_seconds": avg,
        }

    # -------- command history (터미널별 명령 히스토리) --------

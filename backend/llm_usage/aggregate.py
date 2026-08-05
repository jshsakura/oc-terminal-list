"""여러 호스트의 watcher 응답을 한 덩어리로 합친다 — 순수 함수만.

I/O 가 없으므로 그대로 단위 테스트한다. 여기서 쓰는 입력은 **다른 서비스가 준 것**이라
믿지 않는다: 숫자가 아닌 값, 빠진 키, 리스트 아닌 리스트를 전부 흘려보낸다.

합산의 함정 두 개:

- **`agents`/`days` 는 더하면 안 된다.** 개수가 아니라 *서로 다른 것의 수*다. 두
  호스트가 모두 claude 를 쓰면 더해서 2가 되지만 실제로는 1종이다. 합친 뒤 다시 센다.
- **같은 이름은 호스트를 넘어 합친다.** 두 호스트의 `kicad` 는 한 줄로 모인다 —
  "한 화면에서 본다" 가 목적이기 때문이다. 호스트별로 보고 싶으면 `by_host` 가 있다.
"""
from __future__ import annotations

# 토큰 계열 필드 — 전부 단순 합산 대상.
TOKEN_FIELDS = ("tokens", "input", "output", "cache_read", "cache_creation")
# 그룹 행(by_agent/by_model/by_project)이 들고 다니는 합산 필드.
GROUP_FIELDS = ("tokens", "cost", "sessions")


def _num(x) -> float:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return 0.0
    return v if v == v else 0.0  # NaN 제거


def _rows(payload, key: str) -> list[dict]:
    value = (payload or {}).get(key)
    return [r for r in value if isinstance(r, dict)] if isinstance(value, list) else []


def _merge_named(sources: list[dict], key: str) -> list[dict]:
    """`name` 기준으로 그룹 행을 합쳐 비용 내림차순으로 돌려준다."""
    acc: dict[str, dict] = {}
    for payload in sources:
        for row in _rows(payload, key):
            name = str(row.get("name") or "unknown")
            slot = acc.setdefault(name, {"name": name, **{f: 0.0 for f in GROUP_FIELDS}})
            for field in GROUP_FIELDS:
                slot[field] += _num(row.get(field))
    return sorted(acc.values(), key=lambda r: r["cost"], reverse=True)


def _merge_days(sources: list[dict]) -> list[dict]:
    acc: dict[str, dict] = {}
    for payload in sources:
        for row in _rows(payload, "by_day"):
            day = str(row.get("day") or "")
            if not day:
                continue
            slot = acc.setdefault(
                day, {"day": day, "cost": 0.0, **{f: 0.0 for f in TOKEN_FIELDS}}
            )
            slot["cost"] += _num(row.get("cost"))
            for field in TOKEN_FIELDS:
                slot[field] += _num(row.get(field))
    return [acc[d] for d in sorted(acc)]


def _host_row(source: dict) -> dict:
    """소스 하나를 호스트 한 줄로 — 못 읽은 소스도 사유를 달고 남는다."""
    totals = (source.get("summary") or {}).get("totals") or {}
    return {
        "source_id": source.get("source_id"),
        "name": source.get("label") or source.get("source_id"),
        "ok": bool(source.get("ok")),
        "error": source.get("error"),
        "fetched_at": source.get("fetched_at"),
        "tokens": _num(totals.get("tokens")),
        "cost": _num(totals.get("cost")),
        "sessions": _num(totals.get("sessions")),
    }


def merge_summaries(sources: list[dict]) -> dict:
    """소스 목록 → 대시보드가 그대로 그릴 수 있는 한 덩어리.

    `sources` 의 각 항목은 `{source_id, label, ok, error, fetched_at, summary}`.
    실패한 소스는 숫자에 0 으로 기여하되 `by_host` 에는 사유와 함께 남는다 —
    "그 호스트는 왜 비었나" 를 화면에서 답할 수 있어야 한다.
    """
    ok_sources = [s for s in sources if s.get("ok")]
    payloads = [s.get("summary") or {} for s in ok_sources]

    by_agent = _merge_named(payloads, "by_agent")
    by_model = _merge_named(payloads, "by_model")
    by_project = _merge_named(payloads, "by_project")
    by_day = _merge_days(payloads)

    totals = {"cost": 0.0, "sessions": 0.0, **{f: 0.0 for f in TOKEN_FIELDS}}
    for payload in payloads:
        row = (payload or {}).get("totals") or {}
        totals["cost"] += _num(row.get("cost"))
        totals["sessions"] += _num(row.get("sessions"))
        for field in TOKEN_FIELDS:
            totals[field] += _num(row.get(field))
    # 개수는 합산이 아니라 재계산 — 두 호스트의 같은 에이전트는 1종이다.
    totals["agents"] = len(by_agent)
    totals["days"] = len(by_day)

    return {
        "totals": totals,
        "by_day": by_day,
        "by_agent": by_agent,
        "by_model": by_model,
        "by_project": by_project,
        "by_host": [_host_row(s) for s in sources],
        "source_count": len(sources),
        "ok_count": len(ok_sources),
    }


def merge_sessions(sources: list[dict], limit: int = 50) -> list[dict]:
    """호스트별 세션 목록을 최근 활동 순으로 섞는다.

    `host_id`/`host_name` 을 붙여 돌려준다 — 프론트가 살아있는 pane 을 찾을 때
    `(host_id, cwd)` 로 조인하기 때문에 호스트를 잃으면 안 된다.
    """
    merged: list[dict] = []
    for source in sources:
        if not source.get("ok"):
            continue
        for row in source.get("sessions") or []:
            if not isinstance(row, dict):
                continue
            merged.append({
                **row,
                "host_id": source.get("source_id"),
                "host_name": source.get("label") or source.get("source_id"),
            })
    merged.sort(key=lambda r: str(r.get("last_activity") or ""), reverse=True)
    return merged[: max(0, int(limit))]

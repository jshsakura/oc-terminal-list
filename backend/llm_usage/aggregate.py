"""Fold collected sources into the one object the dashboard draws. Pure functions.

Input is a list of sources (this server + each host), each carrying what
`collect.py` produced: `{rows, sessions, session_count, warnings}`. No I/O here,
so it is unit-tested directly.

Nothing in that input is trusted — it crossed an SSH boundary. Non-numbers,
missing keys and lists that aren't lists all flow through harmlessly.

Three traps:

- **`agents`/`days` must not be summed.** They are counts of *distinct* things.
  Two hosts running claude sum to 2 but are one agent. Merge first, then count.
- **The same name merges across hosts.** `kicad` on two machines is one line —
  seeing it in one place is the whole point. `by_host` is there for the split.
- **Cost is decided per row.** Group first and multiply later and there is no
  answer for a group mixing models. Each row is priced by its own model.
"""
from __future__ import annotations

from .pricing import priced_cost

# Token fields — plain sums.
TOKEN_FIELDS = ("input", "output", "cache_read", "cache_creation")
# What a group row (by_agent/by_model/by_project) carries.
GROUP_FIELDS = ("tokens", "cost", "sessions")


def _num(x) -> float:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return 0.0
    return v if v == v else 0.0  # drop NaN


def _tokens_of(row: dict) -> dict:
    return {f: _num(row.get(f)) for f in TOKEN_FIELDS}


def _list_of(payload, key: str) -> list[dict]:
    value = (payload or {}).get(key)
    return [r for r in value if isinstance(r, dict)] if isinstance(value, list) else []


def price_row(row: dict) -> dict:
    """Attach cost and a token total to one row. A source-reported cost wins."""
    tokens = _tokens_of(row)
    given = row.get("cost")
    return {
        **row,
        **tokens,
        "tokens": sum(tokens.values()),
        "cost": priced_cost(row.get("model"), tokens, given if given is not None else None),
    }


def _sessions_per(rows_by_key: dict, sessions: list[dict], key: str) -> None:
    """Fill in per-group session counts from the session list (within its cap)."""
    counted: dict[str, set] = {}
    for session in sessions:
        name = str(session.get(key) or "unknown")
        sid = f"{session.get('host_id')}:{session.get('session_id')}"
        counted.setdefault(name, set()).add(sid)
    for name, ids in counted.items():
        if name in rows_by_key:
            rows_by_key[name]["sessions"] = float(len(ids))


def _group(rows: list[dict], key: str) -> dict:
    acc: dict[str, dict] = {}
    for row in rows:
        name = str(row.get(key) or "unknown")
        slot = acc.setdefault(name, {"name": name, **{f: 0.0 for f in GROUP_FIELDS}})
        slot["tokens"] += _num(row.get("tokens"))
        slot["cost"] += _num(row.get("cost"))
    return acc


def _sorted_group(acc: dict) -> list[dict]:
    return sorted(acc.values(), key=lambda r: r["cost"], reverse=True)


def _by_day(rows: list[dict]) -> list[dict]:
    """Per-day totals, plus the per-host split that the daily chart stacks.

    `hosts` is a {source_id: cost} map rather than a list: the chart colours each
    segment by host, and a host's colour must follow the host — not its rank on
    that particular day.
    """
    acc: dict[str, dict] = {}
    for row in rows:
        day = str(row.get("day") or "")
        if not day:
            continue
        slot = acc.setdefault(day, {"day": day, "cost": 0.0, "tokens": 0.0,
                                    "hosts": {}, **{f: 0.0 for f in TOKEN_FIELDS}})
        cost = _num(row.get("cost"))
        slot["cost"] += cost
        slot["tokens"] += _num(row.get("tokens"))
        for field in TOKEN_FIELDS:
            slot[field] += _num(row.get(field))
        host = row.get("source_id")
        if host:
            slot["hosts"][host] = slot["hosts"].get(host, 0.0) + cost
    return [acc[d] for d in sorted(acc)]


def _host_row(source: dict, rows: list[dict], session_count: float) -> dict:
    """One source becomes one host row — failures stay, carrying their reason."""
    return {
        "source_id": source.get("source_id"),
        "name": source.get("label") or source.get("source_id"),
        "ok": bool(source.get("ok")),
        "error": source.get("error"),
        "fetched_at": source.get("fetched_at"),
        "tokens": sum(_num(r.get("tokens")) for r in rows),
        "cost": sum(_num(r.get("cost")) for r in rows),
        "sessions": session_count,
    }


def merge_summaries(sources: list[dict]) -> dict:
    """Sources to the single object the dashboard renders.

    Each item is `{source_id, label, ok, error, fetched_at, payload}`. A failed
    source contributes 0 to every number but stays in `by_host` with its reason —
    "why is that host empty?" has to be answerable on screen.
    """
    all_rows: list[dict] = []
    host_rows: list[dict] = []
    total_sessions = 0.0
    warnings: list[str] = []

    for source in sources:
        payload = source.get("payload") or {}
        # Tag each row with the host it came from — the daily chart stacks by host.
        rows = ([{**price_row(r), "source_id": source.get("source_id")}
                 for r in _list_of(payload, "rows")] if source.get("ok") else [])
        # session_count predates the list cap; fall back to the list length.
        count = _num(payload.get("session_count")) if source.get("ok") else 0.0
        if not count:
            count = float(len(_list_of(payload, "sessions"))) if source.get("ok") else 0.0
        all_rows.extend(rows)
        total_sessions += count
        host_rows.append(_host_row(source, rows, count))
        for warn in (payload.get("warnings") or []):
            warnings.append(f"{source.get('label') or source.get('source_id')}: {warn}")

    sessions = merge_sessions(sources)
    by_agent = _group(all_rows, "agent")
    by_model = _group(all_rows, "model")
    by_project = _group(all_rows, "project")
    _sessions_per(by_agent, sessions, "agent")
    _sessions_per(by_model, sessions, "model")
    _sessions_per(by_project, sessions, "project")
    by_day = _by_day(all_rows)

    totals = {"cost": 0.0, "tokens": 0.0, **{f: 0.0 for f in TOKEN_FIELDS}}
    for row in all_rows:
        totals["cost"] += _num(row.get("cost"))
        totals["tokens"] += _num(row.get("tokens"))
        for field in TOKEN_FIELDS:
            totals[field] += _num(row.get(field))
    totals["sessions"] = total_sessions
    # Recounted, not summed — the same agent on two hosts is one agent.
    totals["agents"] = len(by_agent)
    totals["days"] = len(by_day)

    ok_count = len([s for s in sources if s.get("ok")])
    return {
        "totals": totals,
        "by_day": by_day,
        "by_agent": _sorted_group(by_agent),
        "by_model": _sorted_group(by_model),
        "by_project": _sorted_group(by_project),
        "by_host": host_rows,
        "source_count": len(sources),
        "ok_count": ok_count,
        "warnings": warnings,
    }


def merge_sessions(sources: list[dict], limit: int = 50) -> list[dict]:
    """Interleave every host's sessions by recency.

    `host_id`/`host_name` are attached because the frontend joins on
    `(host_id, cwd)` to find the live pane — losing the host loses the jump.
    """
    merged: list[dict] = []
    for source in sources:
        if not source.get("ok"):
            continue
        for row in _list_of(source.get("payload"), "sessions"):
            tokens = _tokens_of(row)
            given = row.get("cost")
            merged.append({
                **row,
                "tokens": sum(tokens.values()),
                "cost": priced_cost(row.get("model"), tokens,
                                    given if given is not None else None),
                "host_id": source.get("source_id"),
                "host_name": source.get("label") or source.get("source_id"),
            })
    merged.sort(key=lambda r: str(r.get("last_activity") or ""), reverse=True)
    return merged[: max(0, int(limit))]

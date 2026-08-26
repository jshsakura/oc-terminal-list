"""Daily usage + leak report, sent by this service itself.

Why the backend and not a cron entry: a cron line lives on one machine, drifts out of sync
with the app, and needs its own credentials to reach the DB and the hosts. This process
already holds all three — the usage collector (local + every registered host), the session
table, and the Telegram config — so the report is just a timer around data we already have.

What it reports is what the measurements said actually costs money (2026-08-24 audit):
tokens are spent by *weight per request*, not by tool output, and the leaks worth naming are
the ones a person can act on that morning — polling that got blocked, sessions that died.

Rules borrowed from the notification code, and they are not optional:
  - **Never set parse_mode.** The body carries paths and command fragments; asking Telegram to
    parse them as Markdown fails the whole send on an unclosed entity.
  - Empty fields are omitted, never rendered blank.
  - A day with nothing to say sends nothing. A daily "0" trains you to ignore the channel.
"""
from __future__ import annotations

import asyncio
import datetime
import logging
import os

import telegram_client
import telegram_service
from llm_usage.service import get_usage
from sqlite_storage import storage
from tmux_manager import tmux_manager

logger = logging.getLogger(__name__)

DEFAULT_HOUR = 9
CONFIG_ENABLED = "usage_report_enabled"
CONFIG_HOUR = "usage_report_hour"
POLL_GUARD_LOG = os.path.expanduser("~/.claude/hooks/no-idle-bash.log")
MAX_BODY = 4000

# What the polling guard calls things, in words a person reads at 9am.
KIND_LABELS = {
    "noop": "아무 일도 안 하는 호출",
    "bare-sleep": "지연만 하는 호출",
    "poll-loop": "폴링 루프",
    "long-sleep": "긴 전경 대기",
}


def _env_flag(name: str) -> bool | None:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return None
    return raw not in ("0", "false", "False", "no")


async def get_report_config() -> dict:
    """env wins over the DB — same precedence as the Telegram credentials themselves."""
    env_enabled = _env_flag("USAGE_REPORT_ENABLED")
    if env_enabled is None:
        stored = await storage.get_config(CONFIG_ENABLED)
        enabled = stored != "0"          # default on; it only fires if Telegram is configured
        from_env = False
    else:
        enabled, from_env = env_enabled, True

    hour_raw = os.getenv("USAGE_REPORT_HOUR") or await storage.get_config(CONFIG_HOUR) or ""
    try:
        hour = int(hour_raw)
    except (TypeError, ValueError):
        hour = DEFAULT_HOUR
    if not 0 <= hour <= 23:
        hour = DEFAULT_HOUR
    return {"enabled": enabled, "hour": hour, "from_env": from_env}


async def save_report_config(enabled: bool | None, hour: int | None) -> None:
    if enabled is not None:
        await storage.set_config(CONFIG_ENABLED, "1" if enabled else "0")
    if hour is not None and 0 <= hour <= 23:
        await storage.set_config(CONFIG_HOUR, str(hour))


def _count_blocked(day: str) -> dict[str, int]:
    """Yesterday's polling-guard entries, by kind. Line format: ts, mode, kind, command (tabs).

    ⚠️ Only known kinds are counted. An older revision of the guard logged without the mode
    column, so field 2 there is a whole shell command — and one slipped straight into a
    notification body as if it were a category name. The whitelist is the boundary: an
    unrecognised value means a format we do not understand, not a new category.
    """
    counts: dict[str, int] = {}
    try:
        with open(POLL_GUARD_LOG, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                parts = line.split("\t")
                if len(parts) < 3 or not parts[0].startswith(day):
                    continue
                kind = parts[2].strip()
                if kind not in KIND_LABELS:
                    continue
                counts[kind] = counts.get(kind, 0) + 1
    except OSError:
        return {}
    return counts


async def _dead_session_count(username: str) -> int | None:
    """Rows whose tmux session is gone. None = could not tell (never 0 — see the fleet board).

    A dead tmux server also lists zero sessions, and reading that as "every row is dead" is
    how a cleanup turns destructive.
    """
    try:
        if not await tmux_manager.server_alive():
            return None
        live = {s.name for s in await tmux_manager.list_sessions()}
        if not live:
            return None
        rows = await storage.get_user_sessions(username)
        return len([r for r in rows if r["id"] not in live])
    except Exception:
        return None


async def gather(username: str, day: str | None = None) -> dict:
    """Everything the report needs. Never raises — a broken part is reported as missing."""
    day = day or (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
    usage: dict = {}
    try:
        usage = await get_usage(username, days=1)
    except Exception as e:                       # noqa: BLE001 - a failed source must not
        logger.warning("usage report: usage lookup failed: %s", e)   # kill the leak signals

    return {
        "day": day,
        "usage": usage,
        "blocked": _count_blocked(day),
        "dead_sessions": await _dead_session_count(username),
    }


CONFIG_DEAD_SEEN = "usage_report_dead_seen"
DEAD_REPORT_FLOOR = 20      # 이 아래면 정리할 만큼 쌓인 것도 아니다
DEAD_REPORT_GROWTH = 10     # 이미 알린 뒤에는 이만큼 더 늘어야 다시 말한다


async def _dead_worth_reporting(count: int | None) -> int | None:
    """매일 같은 숫자를 반복하지 않는다.

    쌓인 기록은 **가만히 있는 상태**다. 그걸 날마다 알리면 그 채널은 곧 안 읽히게 되고,
    정작 진짜 신호가 왔을 때도 묻힌다(이 모듈이 "할 말이 없으면 안 보낸다" 를 지키는 이유와
    같다). 처음 임계를 넘을 때 한 번, 그 뒤로는 의미 있게 더 늘었을 때만 말한다.
    """
    if not count or count < DEAD_REPORT_FLOOR:
        return None
    try:
        seen = int(await storage.get_config(CONFIG_DEAD_SEEN) or 0)
    except (TypeError, ValueError):
        seen = 0
    if count < seen + DEAD_REPORT_GROWTH and seen:
        return None
    await storage.set_config(CONFIG_DEAD_SEEN, str(count))
    return count


def _label(row: dict) -> str:
    """Aggregate rows carry `name` — not `label`, not `key`.

    ⚠️ Reading the wrong field does not raise; it silently prints a UUID (hosts) or `?`
    (agents), which is exactly what a first run of this report did. A host id in a
    notification is unreadable, and naming the machine is the whole point of the line.
    """
    name = str(row.get("name") or "").strip()
    if not name or name == "unknown":
        return "?"
    return name if len(name) <= 28 else name[:26] + "…"


def _fmt_tokens(n: float) -> str:
    n = float(n or 0)
    if n >= 1e9:
        return f"{n / 1e9:.2f}G"
    if n >= 1e6:
        return f"{n / 1e6:.1f}M"
    if n >= 1e3:
        return f"{n / 1e3:.0f}K"
    return str(int(n))


def render(data: dict) -> str:
    """Plain text. Returns '' when there is nothing worth a notification."""
    lines: list[str] = []
    usage = data.get("usage") or {}
    totals = usage.get("totals") or {}
    tokens = float(totals.get("tokens") or 0)
    cost = float(totals.get("cost") or 0)

    if usage.get("enabled") and tokens:
        head = f"📊 {data['day']} 사용량 {_fmt_tokens(tokens)} tok"
        if cost:
            head += f" · ${cost:,.2f} 상당"      # 정액제면 청구액이 아니라 정가 환산이다
        lines.append(head)
        hosts = [h for h in (usage.get("by_host") or []) if float(h.get("tokens") or 0) > 0]
        for h in sorted(hosts, key=lambda x: -float(x.get("tokens") or 0))[:5]:
            lines.append(f" · {_label(h)} {_fmt_tokens(h.get('tokens'))}")
        agents = [a for a in (usage.get("by_agent") or []) if float(a.get("tokens") or 0) > 0]
        if agents:
            lines.append(" · " + " / ".join(
                f"{_label(a)} {_fmt_tokens(a.get('tokens'))}" for a in agents[:4]))

    signals: list[str] = []
    blocked = data.get("blocked") or {}
    if blocked:
        detail = " · ".join(f"{KIND_LABELS.get(k, k)} {v}" for k, v in
                            sorted(blocked.items(), key=lambda x: -x[1]))
        signals.append(f" · 폴링·대기 차단 {sum(blocked.values())}건 ({detail})")
    dead = data.get("dead_sessions")
    if dead:
        # ⚠️ "죽은 세션" 이라고 쓰면 세션이 날아간 것처럼 읽힌다. 실제로는 예전에 정상
        # 종료된 탭이 남긴 **DB 기록**이고, 아무것도 잃지 않았다. 겁주는 문구는 신호가
        # 아니라 소음이다.
        signals.append(
            f" · 정리 안 된 세션 기록 {dead}개 (종료된 탭이 남긴 것 — 잃은 것은 없습니다). "
            "홈에서 한 번에 지울 수 있습니다"
        )
    if signals:
        lines.append("")
        lines.append("🔎 누수 신호")
        lines.extend(signals)

    if not lines:
        return ""
    return "\n".join(lines)[:MAX_BODY]


async def build_and_send(username: str, day: str | None = None) -> dict:
    """Gather → render → send. Returns what happened, so a caller can show it."""
    config = await get_report_config()
    if not config["enabled"]:
        return {"status": "disabled"}
    tg = await telegram_service.get_config()
    if not (tg["token"] and tg["chat_id"]):
        return {"status": "no-telegram"}
    data = await gather(username, day)
    # 쌓인 기록은 가만히 있는 값이라 매일 반복하면 소음이 된다 — 여기서 한 번 거른다.
    data["dead_sessions"] = await _dead_worth_reporting(data.get("dead_sessions"))
    text = render(data)
    if not text:
        return {"status": "nothing-to-say"}
    try:
        await telegram_client.send_message(tg["token"], tg["chat_id"], text)
    except telegram_client.TelegramError as e:
        logger.warning("usage report send failed: %s", e)
        return {"status": "send-failed", "detail": str(e), "text": text}
    return {"status": "sent", "text": text}


def seconds_until(hour: int, now: datetime.datetime | None = None) -> float:
    """Seconds to the next local `hour`:00. Pure, so the schedule is testable."""
    now = now or datetime.datetime.now()
    target = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if target <= now:
        target += datetime.timedelta(days=1)
    return (target - now).total_seconds()


class UsageReportWorker:
    """One daily timer. Sleeps in chunks so a suspended machine cannot oversleep a whole day."""

    MAX_SLEEP = 3600.0

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None

    async def _loop(self) -> None:
        while True:
            try:
                config = await get_report_config()
                wait = seconds_until(config["hour"])
                await asyncio.sleep(min(wait, self.MAX_SLEEP))
                if wait > self.MAX_SLEEP:
                    continue
                admin = await storage.get_admin()
                if admin and admin.get("username"):
                    result = await build_and_send(admin["username"])
                    logger.info("usage report: %s", result.get("status"))
                # Past the hour — do not fire twice in the same minute.
                await asyncio.sleep(90)
            except asyncio.CancelledError:
                raise
            except Exception as e:                              # noqa: BLE001
                logger.warning("usage report loop: %s", e)
                await asyncio.sleep(300)

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):        # noqa: BLE001
                pass
        self._task = None


usage_report_worker = UsageReportWorker()

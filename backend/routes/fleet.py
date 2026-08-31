"""The fleet board — every terminal on every machine, and how each machine is holding up.

One screen, one sweep. Filling this in costs **one SSH round trip per remote host**, so
the pane statuses, when each session started, and the machine's own figures all travel
in that single visit (`host_snapshot.build_snapshot_cmd`). Asking for uptime separately
would double the cost of drawing the board.

What must survive any refactor here: a host we could not reach is reported as such.
Drawing it as "idle, 0% memory" turns a network problem into a confident lie, and this
repo has already paid for that mistake once (a remote pane with no status was read as
satisfied, so an agent's wait returned "done" in zero seconds).
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends

import host_snapshot
from _deps import verify_auth_token
# Both modules export a **singleton**, not module-level functions. Importing the module
# and calling `system_monitor.get_stats` silently produced an AttributeError that this
# route swallowed into "stats unavailable" — the board drew every local figure blank.
from system_monitor import system_monitor
from tmux_manager import tmux_manager
from pane_targets import build_targets
import agent_status_watcher
from sqlite_storage import storage

logger = logging.getLogger(__name__)
router = APIRouter()


async def _local_rss() -> dict[str, int]:
    """Per-session resident memory for this machine, the same way remote hosts report it.

    One `ps` for the whole table plus tmux's pane pids — the arithmetic is shared with the
    remote path (`host_snapshot.sum_tree_rss`) so the two can never disagree about what the
    number means.
    """
    try:
        rc, out, _ = await tmux_manager._run(
            "list-panes", "-a", "-F", "#{session_name}\t#{pane_pid}", check=False,
        )
        if rc != 0 or not out:
            return {}
        proc = await asyncio.create_subprocess_exec(
            "ps", "-eo", "pid=,ppid=,rss=",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
        return host_snapshot.sum_tree_rss(
            stdout.decode("utf-8", errors="replace"), host_snapshot.parse_pane_pids(out),
        )
    except Exception as e:
        logger.info("local per-session memory unavailable: %s", e)
        return {}


def _local_machine(stats: dict, pane_count: int) -> dict:
    """This server's own figures, in the same shape a remote host reports."""
    return {
        "id": "local",
        "reachable": True,
        "paneCount": pane_count,
        "uptimeSeconds": stats.get("uptime"),
        "memUsed": stats.get("mem_used"),
        "memTotal": stats.get("mem_total"),
        "swapUsed": stats.get("swap_used"),
        "swapTotal": stats.get("swap_total"),
        "cpus": stats.get("cpu_count"),
        "cpuPercent": stats.get("cpu"),
    }


def _remote_machine(host_id: str, snapshot: dict, pane_count: int) -> dict:
    machine = snapshot.get("machine") or {}
    return {
        "id": host_id,
        "reachable": bool(snapshot.get("reachable")),
        "paneCount": pane_count,
        "uptimeSeconds": machine.get("uptime_seconds"),
        "memUsed": machine.get("mem_used"),
        "memTotal": machine.get("mem_total"),
        "swapUsed": machine.get("swap_used"),
        "swapTotal": machine.get("swap_total"),
        "cpus": machine.get("cpus"),
        "cpuPercent": None,      # a point-in-time CPU read needs two samples; not worth a second visit
    }


def apply_snapshot(target: dict, snapshot: dict) -> dict:
    """Fill one remote pane from its host's snapshot. Returns a new dict.

    Three outcomes, and they are not the same thing:
      - host answered and knows this session  → real status
      - host answered, session is gone        → `statusGone`
      - host did not answer                   → `statusUnknown` stays true
    """
    if not snapshot.get("reachable"):
        return {**target, "statusUnknown": True}
    name = target.get("tmuxSession") or ""
    info = (snapshot.get("sessions") or {}).get(name)
    started = (snapshot.get("started") or {}).get(name)
    if info is None:
        return {**target, "status": None, "statusUnknown": False, "statusGone": True, "startedAt": started}
    command, title = info
    from agent_status import detect_status, display_title
    return {
        **target,
        "statusUnknown": False,
        "command": command,
        "title": display_title(title),
        "status": detect_status(title),
        "startedAt": started,
        "memBytes": (snapshot.get("rss") or {}).get(name),
    }


@router.get("/api/fleet")
async def get_fleet(username: str = Depends(verify_auth_token)):
    state = await storage.get_tab_state(username) or {}
    targets = build_targets(state.get("tabs") or [], agent_status_watcher.snapshot())

    local_started: dict[str, int] = {}
    try:
        local_started = {s.name: s.created for s in await tmux_manager.list_sessions()}
    except Exception as e:
        logger.info("local session times unavailable: %s", e)
    local_rss = await _local_rss()

    host_ids = sorted({t["hostId"] for t in targets if not t.get("sessionId") and t.get("hostId")})
    snapshots = dict(zip(
        host_ids,
        await asyncio.gather(*[host_snapshot.fetch(h, username) for h in host_ids]),
        strict=True,
    )) if host_ids else {}

    filled: list[dict] = []
    for target in targets:
        if target.get("sessionId"):
            filled.append({
                **target,
                "startedAt": local_started.get(target["sessionId"]),
                "memBytes": local_rss.get(target["sessionId"]),
            })
            continue
        if not target.get("hostId"):
            filled.append(target)
            continue
        filled.append(apply_snapshot(target, snapshots.get(target["hostId"], {})))

    counts: dict[str, int] = {}
    for target in filled:
        key = "local" if target.get("sessionId") else (target.get("hostId") or "local")
        counts[key] = counts.get(key, 0) + 1

    machines = []
    if counts.get("local"):
        try:
            stats = await asyncio.to_thread(system_monitor.get_stats)
        except Exception as e:
            logger.info("local stats unavailable: %s", e)
            stats = {}
        machines.append(_local_machine(stats, counts["local"]))
    for host_id in host_ids:
        machines.append(_remote_machine(host_id, snapshots.get(host_id, {}), counts.get(host_id, 0)))

    return {"targets": filled, "machines": machines}

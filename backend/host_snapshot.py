"""실행 중 보드가 한 호스트에서 가져오는 것 — SSH 왕복 **하나**로.

pane 상태, 각 세션이 언제 시작됐는지, 그 기계 자신의 수치가 전부 그 한 번에 실려 온다.
호스트 방문이 비싼 단위라 그렇다 — uptime 을 따로 물으면 보드 한 장의 비용이 두 배가 된다.

⚠️ **화면을 열 때 한 번만 부른다.** 되풀이되는 경로에 놓으면 안 된다(CLAUDE.md 의
"가르는 기준은 SSH 냐가 아니라 얼마나 자주 부르냐다").

⚠️ **닿지 못한 호스트는 그렇게 보고한다.** "유휴, 메모리 0%" 로 그리면 네트워크 문제가
자신만만한 거짓말이 된다 — 이 저장소는 그 실수의 값을 이미 한 번 치렀다(상태 없는 원격
pane 을 만족으로 읽어 기다림이 0초에 "완료" 를 준 사고).

⚠️ **못 받은 값은 채우지 않는다.** `machine` 이 None 인 것과 그 기계가 0 을 보고한 것은
다른 사건이고, 화면까지 그 둘은 구별되어야 한다.
"""
from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)

# 한 호스트를 훑는 상한. 꺼진 기계에 매달리면 보드 전체가 그만큼 늦는다(gather 라 최댓값).
SNAPSHOT_TIMEOUT_SEC = 15.0


def _sq(value: str) -> str:
    """Always wrap in single quotes — never "only if unsafe".

    `shlex.quote` leaves `=mobile-3b908205466e` bare, because it is POSIX-safe. It is
    not **zsh**-safe: a bare word starting with `=` triggers equals-expansion (`=foo` →
    the path of the command `foo`), so the target arrives mangled and `has-session`
    quietly says no. Measured on a real host — with quotes `ITL_OK`, without it empty.
    The remote login shell is not ours to choose, so we do not leave it a choice.
    """
    return "'" + str(value).replace("'", "'\\''") + "'"


_LIST_FORMAT = "#{session_name}\t#{pane_current_command}\t#{pane_title}"


# Sections of one round trip, separated by a marker line. A host visit is the expensive
# unit here (an SSH connection), so everything this screen needs travels together —
# asking for uptime separately would double the cost of drawing the board.
SNAPSHOT_MARK = "ITL_SECTION"
_SESSION_FORMAT = "#{session_name}\t#{session_created}"
_PANE_PID_FORMAT = "#{session_name}\t#{pane_pid}"


def build_list_status_cmd() -> str:
    return f"tmux list-panes -a -F {_sq(_LIST_FORMAT)} 2>/dev/null"


def build_snapshot_cmd() -> str:
    """Pane status + when each session started + how the machine itself is doing.

    Everything after the tmux part is best-effort: a host without /proc (macOS, BSD)
    simply reports nothing there, and the board draws the pane rows without machine
    figures rather than showing zeroes that look like real measurements.
    """
    return "; ".join([
        f"tmux list-panes -a -F {_sq(_LIST_FORMAT)} 2>/dev/null",
        f"echo {_sq(SNAPSHOT_MARK)}",
        f"tmux list-sessions -F {_sq(_SESSION_FORMAT)} 2>/dev/null",
        f"echo {_sq(SNAPSHOT_MARK)}",
        "cat /proc/uptime 2>/dev/null",
        "grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' /proc/meminfo 2>/dev/null",
        "nproc 2>/dev/null | sed 's/^/CPUS /'",
        f"echo {_sq(SNAPSHOT_MARK)}",
        f"tmux list-panes -a -F {_sq(_PANE_PID_FORMAT)} 2>/dev/null",
        f"echo {_sq(SNAPSHOT_MARK)}",
        # The whole process table, summed **here** rather than there. Walking a process
        # tree in POSIX shell is a loop of forks per pane; `ps` is one page of text that
        # every unix has, and the arithmetic is free on this side.
        "ps -eo pid=,ppid=,rss= 2>/dev/null",
    ])


def parse_snapshot(out: str | None) -> dict:
    """The three sections above → `{sessions, started, machine}`.

    `machine` is None when the host told us nothing about itself — that is different from
    a machine reporting 0% and has to stay different all the way to the screen.
    """
    text = out or ""
    parts = text.split(f"\n{SNAPSHOT_MARK}\n")
    if len(parts) < 3:
        # Marker missing (older host command, or the shell died mid-way) — treat the whole
        # output as the pane listing rather than losing it.
        return {"sessions": parse_list_status(text), "started": {}, "machine": None}
    panes, sessions, machine = parts[0], parts[1], parts[2]

    started: dict[str, int] = {}
    for line in sessions.splitlines():
        name, _, epoch = line.partition("\t")
        if name.strip() and epoch.strip().isdigit():
            started[name.strip()] = int(epoch.strip())

    pane_pids = parse_pane_pids(parts[3]) if len(parts) > 3 else {}
    rss = sum_tree_rss(parts[4], pane_pids) if len(parts) > 4 else {}

    return {
        "sessions": parse_list_status(panes),
        "started": started,
        "machine": parse_machine(machine),
        "rss": rss,
    }


def parse_pane_pids(text: str | None) -> dict[str, list[int]]:
    """`session_name → [pane pid, …]`. A session can hold several panes."""
    result: dict[str, list[int]] = {}
    for line in (text or "").splitlines():
        name, _, pid = line.partition("\t")
        name, pid = name.strip(), pid.strip()
        if name and pid.isdigit():
            result.setdefault(name, []).append(int(pid))
    return result


def sum_tree_rss(ps_text: str | None, pane_pids: dict[str, list[int]]) -> dict[str, int]:
    """Resident memory of everything running under each session, in bytes.

    The pane's own pid is a shell; the thing worth measuring is what it started (an agent,
    a build, a dev server), so this walks children rather than reading one process.

    RSS double-counts shared pages, so a tree's total reads high — it answers "which
    session is the heavy one", not "how much would I get back". That is the question this
    list is for, and the alternative (PSS) needs root on most kernels.
    """
    children: dict[int, list[int]] = {}
    rss: dict[int, int] = {}
    for line in (ps_text or "").splitlines():
        parts = line.split()
        if len(parts) < 3:
            continue
        pid, ppid, kb = parts[0], parts[1], parts[2]
        if not (pid.isdigit() and ppid.isdigit() and kb.isdigit()):
            continue
        rss[int(pid)] = int(kb) * 1024
        children.setdefault(int(ppid), []).append(int(pid))

    if not rss:
        return {}

    totals: dict[str, int] = {}
    for name, pids in pane_pids.items():
        seen: set[int] = set()
        stack = list(pids)
        total = 0
        while stack:
            pid = stack.pop()
            if pid in seen:
                continue          # a malformed table must not spin forever
            seen.add(pid)
            total += rss.get(pid, 0)
            stack.extend(children.get(pid, ()))
        if total:
            totals[name] = total
    return totals


def parse_machine(text: str | None) -> dict | None:
    """`/proc/uptime` + a few `/proc/meminfo` lines → the figures the board draws."""
    uptime: float | None = None
    mem: dict[str, int] = {}
    cpus: int | None = None
    for line in (text or "").splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("CPUS "):
            value = line[5:].strip()
            cpus = int(value) if value.isdigit() else None
            continue
        if ":" in line:
            key, _, rest = line.partition(":")
            value = rest.strip().split()
            if value and value[0].isdigit():
                mem[key.strip()] = int(value[0]) * 1024      # kB → bytes
            continue
        first = line.split()[0]
        try:
            uptime = float(first)
        except ValueError:
            continue

    total = mem.get("MemTotal")
    available = mem.get("MemAvailable")
    if uptime is None and total is None:
        return None
    machine: dict = {"uptime_seconds": uptime, "cpus": cpus}
    if total:
        machine["mem_total"] = total
        if available is not None:
            machine["mem_used"] = max(0, total - available)
    swap_total, swap_free = mem.get("SwapTotal"), mem.get("SwapFree")
    if swap_total:
        machine["swap_total"] = swap_total
        if swap_free is not None:
            machine["swap_used"] = max(0, swap_total - swap_free)
    return machine


def parse_list_status(out: str | None) -> dict[str, tuple[str, str]]:
    """`session_name → (command, title)`. 한 세션에 pane 이 여러 개면 **첫 줄**을 쓴다.

    원격 세션은 우리 UI 에서 pane 하나로 보이고(그 세션의 현재 윈도우), 상태를 알려주는
    타이틀도 그 pane 의 것이다.
    """
    result: dict[str, tuple[str, str]] = {}
    for line in (out or "").splitlines():
        if line.strip() == SNAPSHOT_MARK:
            break              # everything after belongs to the other sections
        parts = line.rstrip("\n").split("\t")
        if len(parts) < 2 or not parts[0].strip():
            continue
        name = parts[0].strip()
        if name in result:
            continue
        result[name] = (parts[1].strip(), (parts[2].strip() if len(parts) > 2 else ""))
    return result


async def fetch(host_id: str, username: str) -> dict:
    """실행 중 보드가 한 호스트에서 필요로 하는 전부 — SSH 왕복 하나.

    닿지 못한 것은 빈 기계가 아니라 `reachable: False` 로 보고한다. 물어보지 못한 상자와
    할 일이 없는 상자는 다르고, 보드는 그 둘을 말할 수 있어야 한다.
    """
    from host_common import resolve_host_with_secrets, run_remote_cmd
    try:
        host, secrets = await resolve_host_with_secrets(host_id, username)
        out = await run_remote_cmd(
            host, secrets, build_snapshot_cmd(), timeout=SNAPSHOT_TIMEOUT_SEC,
        )
        return {**parse_snapshot(out), "reachable": True}
    except asyncio.CancelledError:
        raise
    except Exception as e:                                   # noqa: BLE001
        logger.info("host snapshot failed (host=%s): %s", host_id, e)
        return {"sessions": {}, "started": {}, "machine": None, "reachable": False}

"""원격 팬이 남긴 전달 요청을 걷어 온다 — **붙어 있지 않아도.**

로컬 팬은 이 기계의 tmux 를 백엔드가 이미 1.5초마다 훑으므로 우편함(`@itl_outbox`)이
공짜로 걷힌다(`agent_status_service`). 원격은 그 tmux 가 남의 기계에 있어서 같은 공짜가
없다. 그래서 원격 팬이 **보내는** 것만 오래 막혀 있었다:

    8.1 → 8.2 은 된다 (배달은 백엔드가 SSH 로 한다)
    8.2 → 8.1 은 안 됐다 (8.2 의 표식을 읽을 사람이 없다. 그 탭이 안 붙어 있으면)

에이전트끼리 주고받는 흐름은 **회신이 오지 않으면 반쪽**이라, 그 절반을 여기서 채운다.

비용을 어떻게 억제하는가 — 이 저장소의 규칙은 "SSH 냐" 가 아니라 "얼마나 자주 부르냐" 다:

1. **호스트당 왕복 하나.** 명령 하나가 그 기계의 모든 세션을 훑어 비우고 찍는다.
2. **필요한 호스트만.** 지금 탭 상태에 원격 팬이 있는 호스트만 본다.
3. **붙어 있는 세션은 건너뛴다.** 그쪽은 브리지의 표식 통로가 즉시 처리한다.
4. **연결은 `ssh_pool` 로 재사용한다.** 매번 핸드셰이크를 새로 하면 이 주기가 곧 부하다.
5. **보는 사람이 없으면 느리게.** SSE 청취자가 없으면 간격을 늘린다.

⚠️ **비우는 것과 걷는 것이 한 명령 안에 있어야 한다.** 나눠 두면 그 사이에 다음 주기가
같은 통을 또 집어 같은 말을 두 번 꽂는다(라우터의 nonce 접기가 마지막 방어선이지만,
애초에 두 번 보내지 않는 것이 맞다).
"""
from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)

#: 회신을 기다리는 사람이 있는 동안의 주기. 사람이 "느리다" 고 느끼지 않을 만큼 짧고,
#: 호스트당 왕복 하나라 이 정도는 감당된다.
INTERVAL_ACTIVE_SEC = 5.0
#: 아무도 앱을 안 보고 있을 때. 배달은 여전히 되어야 하지만 급하지 않다.
INTERVAL_IDLE_SEC = 30.0
#: 한 호스트를 훑는 데 쓰는 상한. 이 저장소의 모든 기다림에는 상한이 있다.
DRAIN_TIMEOUT_SEC = 15.0
#: 한 주기에 동시에 훑는 호스트 수. 한 줄로 돌면 꺼진 호스트 하나가 상한(15s)만큼
#: 나머지 전부의 회신을 미룬다 — 그런데 호스트 수만큼 한꺼번에 나가는 것도 부하다.
DRAIN_CONCURRENCY = 4

#: **붙어 있든 아니든 비우고 찍는다.** 한때 붙어 있는 세션을 건너뛰었는데(그쪽은 브리지의
#: 표식 통로가 처리하므로) 그러면 그 통이 **영영 안 비워진다** — `itl` 은 언제나 두 통로로
#: 내보내기 때문이다. 남은 값은 그 팬이 나중에 안 붙게 되는 순간, 또는 백엔드가 재시작해
#: 중복 기록이 비워진 뒤에 **옛말로 되살아난다.** 겹치는 것은 라우터의 nonce 가 접는다 —
#: 그게 nonce 가 있는 이유다.
#: ⚠️ **구분자는 진짜 탭이어야 한다.** tmux 의 `-F` 는 `\t` 를 탭으로 풀어 주지 않는다 —
#: 큰따옴표 안의 `\t` 는 백슬래시와 t 두 글자로 그대로 나가고, 그러면 `read` 가 못 쪼개
#: **아무것도 안 걷힌다**(조용히). 그래서 파이썬 쪽에서 실제 탭 문자를 박는다.
_TAB = "\t"

DRAIN_CMD = (
    'tmux list-sessions '
    f'-F "#{{session_name}}{_TAB}#{{session_attached}}{_TAB}#{{@itl_outbox}}" '
    "2>/dev/null | while IFS=\"$(printf '\\t')\" read -r s a v; do "
    '  [ -n "$v" ] || continue; '
    '  tmux set-option -u -t "$s" @itl_outbox >/dev/null 2>&1; '
    '  printf "%s\\t%s\\n" "$s" "$v"; '
    "done"
)


def parse_drain(text: str | None) -> list[tuple[str, str]]:
    """`세션\\t페이로드` 줄 → 목록. 모양이 아니면 조용히 버린다.

    빈 결과는 "할 일이 없었다" 이지 오류가 아니다 — 대개의 주기가 그렇다.
    """
    out: list[tuple[str, str]] = []
    for line in (text or "").splitlines():
        if not line.strip():
            continue
        parts = line.split("\t", 1)
        if len(parts) != 2 or not parts[0].strip() or not parts[1].strip():
            continue
        out.append((parts[0].strip(), parts[1].strip()))
    return out


async def _hosts_with_remote_panes(username: str) -> set[str]:
    """탭 상태에 원격 팬이 있는 호스트. 없으면 이 주기는 아무 데도 안 나간다."""
    from pane_targets import build_targets
    from sqlite_storage import storage

    state = await storage.get_tab_state(username) or {}
    return {
        t["hostId"]
        for t in build_targets(state.get("tabs") or [])
        if t.get("kind") == "host" and t.get("hostId")
    }


async def _drain_host(host_id: str, username: str) -> None:
    from host_common import resolve_host_with_secrets
    from host_manager import open_connection
    from itl_channel import parse_sentinel
    from itl_router import deliver_from_pane
    from ssh_pool import ssh_pool

    host, secrets = await resolve_host_with_secrets(host_id, username)

    async def _opener():
        return await open_connection(
            host,
            private_key=secrets["private_key"],
            passphrase=secrets["passphrase"],
            password=secrets["password"],
        )

    result = await asyncio.wait_for(
        ssh_pool.run(host_id, _opener, DRAIN_CMD, check=False),
        timeout=DRAIN_TIMEOUT_SEC,
    )
    raw = result.stdout if isinstance(result.stdout, str) else (result.stdout or b"").decode(
        "utf-8", errors="replace"
    )
    for session, payload in parse_drain(raw):
        msg = parse_sentinel(payload)
        if not msg:
            logger.info("원격 우편함의 모양이 아니다 (%s/%s)", host_id[:8], session)
            continue
        # 보낸 이는 **호스트 + 세션 이름**으로 되짚는다 — 주소록의 `hostId`/`tmuxSession`
        # 과 같은 값이다. 이름만으로는 호스트마다 같은 `mobile` 을 못 가른다.
        await deliver_from_pane(username, session, msg, host_id=host_id)


async def drain_once(username: str) -> int:
    """모든 대상 호스트를 한 번 훑는다. 돌려주는 값은 훑은 호스트 수(진단용)."""
    try:
        host_ids = await _hosts_with_remote_panes(username)
    except Exception as e:                                   # noqa: BLE001
        logger.debug("원격 우편함: 주소록을 못 읽었다: %s", e)
        return 0
    gate = asyncio.Semaphore(DRAIN_CONCURRENCY)

    async def _one(host_id: str) -> None:
        async with gate:
            try:
                await _drain_host(host_id, username)
            except asyncio.CancelledError:
                raise
            except Exception as e:                           # noqa: BLE001
                # 꺼진 호스트가 하나 있다고 나머지를 못 걷으면 안 된다 — 그리고 그
                # 호스트의 상한(15s)이 나머지의 회신을 미루지도 않는다(동시에 나간다).
                logger.debug("원격 우편함 훑기 실패 (%s): %s", host_id[:8], e)

    await asyncio.gather(*(_one(h) for h in sorted(host_ids)))
    return len(host_ids)


class RemoteOutboxDrainer:
    """주기 루프. `has_listeners` 가 참이면 조인다."""

    def __init__(self, username_of=None, has_listeners=None, drain=None):
        self._username_of = username_of
        self._has_listeners = has_listeners
        self._drain = drain or drain_once
        self._task: asyncio.Task | None = None

    async def _tick(self) -> None:
        username = await self._username_of() if self._username_of else None
        if not username:
            return
        await self._drain(username)

    async def _loop(self) -> None:
        while True:
            try:
                await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception as e:                           # noqa: BLE001
                # 한 번의 실패로 루프가 죽으면 회신이 영영 안 온다.
                logger.debug("원격 우편함 루프 오류: %s", e)
            active = bool(self._has_listeners and self._has_listeners())
            await asyncio.sleep(INTERVAL_ACTIVE_SEC if active else INTERVAL_IDLE_SEC)

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except (asyncio.CancelledError, Exception):          # noqa: BLE001
            pass
        self._task = None

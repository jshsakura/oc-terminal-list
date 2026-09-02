"""tmux 를 주기적으로 훑어 에이전트 상태 전이를 뽑아낸다.

`tmux list-panes -a -F` 한 번(≈5ms)이면 전 세션의 타이틀·명령·활성여부가 나온다.
**클라이언트가 하나도 안 붙어 있어도 동작한다** — 그게 "폰으로 알림"(P1)의 전제다.

내보내는 이벤트는 변경분만이다. 특히 스피너 프레임(초당 10~12회)은 반드시
접어야 한다 — 안 그러면 브로드캐스트가 그 자체로 폭주한다.
"""
from __future__ import annotations

import asyncio
import logging

from agent_status import detect_status, display_title, is_spinner_only_change

logger = logging.getLogger(__name__)

# 폴링 주기 — 보고 있는 사람이 있으면 조이고, 없으면 푼다.
# 아무도 안 볼 때도 멈추지는 않는다(알림 때문에).
INTERVAL_ACTIVE_SECONDS = 1.5
INTERVAL_IDLE_SECONDS = 5.0

# tmux -F 포맷. 타이틀이 마지막이라 그 안의 탭 문자는 maxsplit 으로 흡수된다.
# 타이틀이 **마지막**이어야 한다 — 그 안의 탭 문자를 maxsplit 이 흡수한다.
PANE_FORMAT = (
    "#{session_name}\t#{?pane_active,1,0}\t#{pane_current_command}"
    # ⚠️ **타이틀은 언제나 마지막이어야 한다** — 그 안의 탭을 maxsplit 이 흡수한다.
    # 우편함(`@itl_outbox`)은 JSON 이라 리터럴 탭이 들어갈 수 없어 그 앞이 안전하다.
    "\t#{pane_current_path}\t#{@itl_outbox}\t#{pane_title}"
)


def parse_pane_lines(raw: str) -> list[dict]:
    """`list-panes -a -F PANE_FORMAT` 출력 → pane 목록 (활성 pane 만)."""
    panes: list[dict] = []
    for line in (raw or "").splitlines():
        if not line.strip():
            continue
        parts = line.split("\t", 5)
        if len(parts) < 6:
            continue
        session_id, active, command, cwd, outbox, raw_title = parts
        if active != "1":
            continue
        panes.append({
            "sessionId": session_id,
            "command": command,
            # tmux 가 아는 **실제** 경로. tab-state 의 cwd 는 저장 시점 값이라 낡는다.
            "cwd": cwd,
            # 붙어 있지 않은 팬이 백엔드에 말을 거는 통로(itl). 상태와 무관한 값이라
            # `_diff` 는 보지 않고, `_tick` 이 따로 걷어 간다.
            "outbox": outbox,
            "title": display_title(raw_title),
            "rawTitle": raw_title,
            "status": detect_status(raw_title),
        })
    return panes


class AgentStatusWatcher:
    """폴링 → 전이 이벤트. tmux 접근은 주입받는다(테스트에서 교체 가능)."""

    def __init__(self, list_panes=None, on_change=None, has_listeners=None, on_outbox=None):
        # list_panes: async () -> str (tmux 원시 출력)
        # on_change:  async (changes: list[dict]) -> None
        # has_listeners: () -> bool  (붙어있는 클라이언트 유무 → 폴링 주기)
        self._list_panes = list_panes
        self._on_change = on_change
        self._has_listeners = has_listeners
        # on_outbox: async (list[(session_id, payload)]) -> None
        self._on_outbox = on_outbox
        self._state: dict[str, dict] = {}
        self._task: asyncio.Task | None = None

    # ---------------------- 상태 ----------------------

    def snapshot(self) -> dict[str, dict]:
        """세션ID → {status, title, command, cwd}. 신규 클라이언트 하이드레이션용."""
        return {k: dict(v) for k, v in self._state.items()}

    def _diff(self, panes: list[dict]) -> list[dict]:
        """이번 폴링 결과를 이전 상태와 비교해 변경분만 뽑는다."""
        changes: list[dict] = []
        seen: set[str] = set()

        for pane in panes:
            session_id = pane["sessionId"]
            seen.add(session_id)
            previous = self._state.get(session_id)

            if previous is not None:
                same_status = previous["status"] == pane["status"]
                # 스피너 프레임만 다른 건 변경이 아니다.
                spinner_only = is_spinner_only_change(previous["rawTitle"], pane["rawTitle"])
                # ⚠️ **cwd 도 봐야 한다.** 이 폴링은 이미 `#{pane_current_path}` 를 읽고
                # 있는데(공짜다 — 같은 tmux 호출의 칸 하나), 비교에서 빠져 있어서 타이틀이
                # 안 변하는 셸에서 `cd` 를 하면 아무 신호도 안 나갔다. 그래서 상단 주소가
                # 손으로 새로고침해야만 따라오는 "반쯤 수동" 상태였다.
                # `cd` 는 사람 속도로 일어나므로 스피너와 달리 폭주 위험이 없다.
                same_cwd = (previous.get("cwd") or "") == (pane.get("cwd") or "")
                if same_status and spinner_only and same_cwd:
                    # rawTitle 은 갱신해 둔다 — 다음 비교의 기준이 프레임 하나만큼 흐르지 않게.
                    previous["rawTitle"] = pane["rawTitle"]
                    continue

            self._state[session_id] = dict(pane)
            changes.append({
                **pane,
                "previousStatus": previous["status"] if previous else None,
                # working → working 이 아닌 무언가 = 한 턴이 끝났다. P1 푸시가 물릴 지점.
                "completed": bool(previous and previous["status"] == "working"
                                  and pane["status"] != "working"),
                "gone": False,
            })

        for session_id in [k for k in self._state if k not in seen]:
            self._state.pop(session_id, None)
            changes.append({"sessionId": session_id, "gone": True, "status": None,
                            "title": "", "command": "", "previousStatus": None,
                            "completed": False})

        return changes

    # ---------------------- 루프 ----------------------

    async def _tick(self) -> None:
        raw = await self._list_panes()
        panes = parse_pane_lines(raw)
        # 우편함은 상태가 아니라 **전달할 것**이다 — 상태 비교에 섞이면 안 되고(값이
        # 지워지는 것을 변경으로 읽는다), 변경이 없어도 걷어 가야 한다.
        pending = [(p["sessionId"], p["outbox"]) for p in panes if p.get("outbox")]
        for pane in panes:
            pane.pop("outbox", None)
        changes = self._diff(panes)
        if changes and self._on_change:
            await self._on_change(changes)
        if pending and self._on_outbox:
            await self._on_outbox(pending)

    async def _loop(self) -> None:
        while True:
            try:
                await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                # 폴링 실패로 루프가 죽으면 상태가 영원히 멈춘다 — 삼키고 계속 돈다.
                logger.debug("agent status poll failed: %s", e)
            active = bool(self._has_listeners and self._has_listeners())
            await asyncio.sleep(INTERVAL_ACTIVE_SECONDS if active else INTERVAL_IDLE_SECONDS)

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except (asyncio.CancelledError, Exception):
            pass
        self._task = None

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
PANE_FORMAT = "#{session_name}\t#{?pane_active,1,0}\t#{pane_current_command}\t#{pane_title}"


def parse_pane_lines(raw: str) -> list[dict]:
    """`list-panes -a -F PANE_FORMAT` 출력 → pane 목록 (활성 pane 만)."""
    panes: list[dict] = []
    for line in (raw or "").splitlines():
        if not line.strip():
            continue
        parts = line.split("\t", 3)
        if len(parts) < 4:
            continue
        session_id, active, command, raw_title = parts
        if active != "1":
            continue
        panes.append({
            "sessionId": session_id,
            "command": command,
            "title": display_title(raw_title),
            "rawTitle": raw_title,
            "status": detect_status(raw_title),
        })
    return panes


class AgentStatusWatcher:
    """폴링 → 전이 이벤트. tmux 접근은 주입받는다(테스트에서 교체 가능)."""

    def __init__(self, list_panes=None, on_change=None, has_listeners=None):
        # list_panes: async () -> str (tmux 원시 출력)
        # on_change:  async (changes: list[dict]) -> None
        # has_listeners: () -> bool  (붙어있는 클라이언트 유무 → 폴링 주기)
        self._list_panes = list_panes
        self._on_change = on_change
        self._has_listeners = has_listeners
        self._state: dict[str, dict] = {}
        self._task: asyncio.Task | None = None

    # ---------------------- 상태 ----------------------

    def snapshot(self) -> dict[str, dict]:
        """세션ID → {status, title, command}. 신규 클라이언트 하이드레이션용."""
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
                if same_status and spinner_only:
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
        changes = self._diff(parse_pane_lines(raw))
        if changes and self._on_change:
            await self._on_change(changes)

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

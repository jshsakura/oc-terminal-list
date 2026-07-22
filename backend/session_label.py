"""세션 → 사람이 알아볼 이름. 알림 문구에 쓴다.

"작업 완료" 만 오면 터미널을 여러 개 굴릴 때 **어느 놈인지 알 수가 없다.**
`itl list` 가 쓰는 것과 같은 주소 체계(탭.pane)를 붙여, 알림만 보고도
어디로 가야 하는지 알게 한다.
"""
from __future__ import annotations

import logging

from itl_targets import build_targets
from sqlite_storage import storage

logger = logging.getLogger(__name__)


async def describe_session(username: str, session_id: str) -> dict:
    """{addr, tabName, paneIndex} — 못 찾으면 값이 빈 dict.

    탭 상태에 없는 세션(앱 밖에서 만든 것 등)도 있으므로 실패는 정상이다.
    그 경우 알림은 주소 없이 나간다 — 없는 것보다 낫다.
    """
    try:
        state = await storage.get_tab_state(username) or {}
        for target in build_targets(state.get("tabs") or []):
            if target["sessionId"] == session_id or target["tmuxSession"] == session_id:
                host = ""
                if target["hostId"]:
                    try:
                        record = await storage.get_host(target["hostId"], username)
                        host = (record or {}).get("name") or ""
                    except Exception:
                        host = ""
                return {
                    "addr": target["addr"],
                    "tabName": target["tabName"],
                    "paneIndex": target["paneIndex"],
                    "cwd": target["cwd"],
                    "host": host,
                }
    except Exception as e:
        logger.debug("세션 라벨 조회 실패 (%s): %s", session_id, e)
    return {}


def format_label(described: dict, session_id: str = "") -> str:
    """알림 제목에 넣을 한 줄. 주소를 모르면 세션 앞자리로라도 구분한다."""
    addr = described.get("addr")
    tab = (described.get("tabName") or "").strip()
    if addr and tab:
        return f"{addr} · {tab}"
    if addr:
        return addr
    return session_id[:8] if session_id else "terminal"

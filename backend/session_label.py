"""세션 → 사람이 알아볼 이름. 알림 문구에 쓴다.

"작업 완료" 만 오면 터미널을 여러 개 굴릴 때 **어느 놈인지 알 수가 없다.**
`itl list` 가 쓰는 것과 같은 주소 체계(탭.pane)를 붙여, 알림만 보고도
어디로 가야 하는지 알게 한다.
"""
from __future__ import annotations

import logging

from pathlib import Path

from itl_targets import build_targets
from sqlite_storage import storage

logger = logging.getLogger(__name__)


async def describe_session(username: str, session_id: str, live_cwd: str = "") -> dict:
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
                    # tmux 가 아는 실제 경로가 우선 — tab-state 값은 저장 시점이라 낡는다.
                    "cwd": live_cwd or target["cwd"],
                    "host": host,
                }
    except Exception as e:
        logger.debug("세션 라벨 조회 실패 (%s): %s", session_id, e)
    return {}


def shorten_path(path: str) -> str:
    """홈은 `~` 로 접고, 너무 길면 앞을 줄인다. 경로의 **마지막**이 제일 중요하다."""
    p = (path or "").strip().rstrip("/")
    if not p:
        return ""
    home = str(Path.home())
    if p == home:
        return "~"
    if p.startswith(home + "/"):
        p = "~/" + p[len(home) + 1:]
    parts = p.split("/")
    # 마지막 두 조각이면 "어디인지" 는 대개 충분하다.
    return "/".join(parts[-2:]) if len(parts) > 2 else p


def format_label(described: dict, session_id: str = "") -> str:
    """알림 제목 한 줄 — **메인탭 › 서브탭**.

    서브탭 자리에는 그 pane 의 경로 마지막 조각을 쓴다. 탭 이름과 같으면(대개
    탭 이름이 폴더명에서 나온다) 같은 말을 두 번 하지 않고 pane 번호로 대신한다.
    """
    addr = described.get("addr")
    tab = (described.get("tabName") or "").strip()
    cwd_tail = (described.get("cwd") or "").rstrip("/").rsplit("/", 1)[-1]
    pane_index = described.get("paneIndex")

    if not addr:
        return session_id[:8] if session_id else "terminal"
    if not tab:
        return addr

    # 서브탭 표시: 경로 마지막이 새 정보면 그걸, 아니면 pane 번호.
    if cwd_tail and cwd_tail != tab:
        sub = cwd_tail
    elif pane_index:
        sub = f"#{pane_index}"
    else:
        sub = ""
    return f"{addr} · {tab} › {sub}" if sub else f"{addr} · {tab}"

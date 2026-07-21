"""tmux 세션에 주입할 itl 환경변수.

세션 안에서 도는 `itl` CLI 가 "나는 누구고 어디에 연결하나"를 이 값들로 안다.
세션 생성 경로가 둘(REST 생성 / WS attach 시 생성)이라 여기 모아 둔다 —
한쪽에만 있으면 진입점에 따라 CLI 가 되기도 하고 안 되기도 한다.
"""
from __future__ import annotations

import logging
import os

from _deps import ITL_TOKEN_SCOPE, get_auth_manager

logger = logging.getLogger(__name__)

# CLI 는 같은 머신에서 도니 루프백으로 붙는다. 컨테이너/리버스프록시 구성에서
# 포트가 다르면 ITL_API_BASE 로 덮어쓴다.
DEFAULT_API_BASE = f"http://127.0.0.1:{os.getenv('APP_PORT', '38822')}"


async def build_itl_env(username: str, session_id: str) -> dict[str, str]:
    """실패해도 세션 생성은 막지 않는다 — itl 이 안 되는 것과 터미널이 안 열리는 건 다르다."""
    try:
        manager = get_auth_manager()
        if not manager:
            return {}
        token = await manager.create_scoped_token(username, ITL_TOKEN_SCOPE)
        return {
            "ITL_API": os.getenv("ITL_API_BASE") or DEFAULT_API_BASE,
            "ITL_TOKEN": token,
            "ITL_SESSION": session_id,
        }
    except Exception as e:
        logger.warning("itl 환경변수 준비 실패 (session=%s): %s", session_id, e)
        return {}

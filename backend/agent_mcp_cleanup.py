"""itl 이 에이전트 설정에 남긴 MCP 항목을 걷어낸다.

itl 을 없앨 때 이것을 같이 하지 않으면, 이 기계에서 에이전트를 띄울 때마다 **지워진
파일을 가리키는 MCP 서버**가 뜨려다 실패한다. 앱은 조용해지는데 사용자의 에이전트는
매 세션 빨간 줄을 하나씩 문다 — 우리가 쓴 것이니 우리가 지운다.

두 규칙은 등록하던 시절 그대로다:

1. **우리가 쓴 것만 지운다.** `args` 가 `itl_mcp.py` 로 끝나는 항목만. 사람이 손으로
   적은 `itl` 항목(다른 인터프리터·래퍼·플래그)은 그 사람의 것이라 놔둔다.
2. **절대 망가뜨리지 않는다.** 파싱 → 사본 수정 → 같은 디렉터리에 임시 파일 → `os.replace`.
   어느 단계에서 실패해도 원본은 그대로고, 못 읽는 설정은 다시 쓰지 않고 놔둔다.

원격 호스트에도 같은 항목이 남아 있다. 여기서 지우지 않는 이유는 그러려면 부팅마다
호스트마다 SSH 를 한 번씩 태워야 하기 때문이다(이 저장소가 계속 줄여 온 쪽). 그쪽은
사람이 한 줄로 지운다 — README 의 안내 참고.
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

MCP_KEY = "itl"
CONFIG_NAME = ".claude.json"
MCP_SCRIPT = "itl_mcp.py"


def _is_ours(entry) -> bool:
    """우리가 쓴 항목인가 — 우리 MCP 스크립트를 python3 로 돌리는 모양."""
    if not isinstance(entry, dict):
        return False
    return any(str(a).endswith(MCP_SCRIPT) for a in (entry.get("args") or []))


def without_itl(config: dict) -> dict | None:
    """우리 항목을 뺀 새 설정. 뺄 것이 없으면 None(= 아무것도 쓰지 않는다)."""
    servers = config.get("mcpServers")
    if not isinstance(servers, dict) or not _is_ours(servers.get(MCP_KEY)):
        return None
    remaining = {k: v for k, v in servers.items() if k != MCP_KEY}
    return {**config, "mcpServers": remaining}


def _atomic_write_json(path: Path, data: dict) -> None:
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".itl-mcp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def drop_local_agent_mcp(home: str | None = None) -> bool:
    """이 기계의 에이전트 설정에서 itl MCP 항목을 지운다. 지웠으면 True.

    설정이 없거나(그 기계에서 에이전트를 쓴 적이 없다) 못 읽으면 아무것도 하지 않는다.
    멱등이라 부팅마다 불러도 두 번째부터는 아무 일도 일어나지 않는다.
    """
    path = Path(home or os.path.expanduser("~")) / CONFIG_NAME
    if not path.exists():
        return False
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        logger.info("에이전트 설정을 읽지 못해 MCP 정리를 건너뜁니다: %s", e)
        return False
    if not isinstance(config, dict):
        return False
    updated = without_itl(config)
    if updated is None:
        return False
    try:
        _atomic_write_json(path, updated)
    except Exception as e:
        logger.warning("에이전트 MCP 정리 실패: %s", e)
        return False
    logger.info("에이전트 설정에서 itl MCP 항목을 지웠습니다 (%s)", path)
    return True

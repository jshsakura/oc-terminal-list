"""tmux 에 없는 세션 행을 치우는 계약.

왜 필요한가: 세션 행은 `DELETE /api/sessions/{id}` 로만 지워진다. 그런데 세션은 그 경로를
**안 거치고도** 죽는다 — 기계 재부팅, tmux 서버 종료, OOM kill. 그때 행은 영원히 남고
아무도 치우지 않았다. 실측으로 5~6월치 45개가 그렇게 쌓여 있었다(7월에 "닫기=종료" 모델이
들어온 뒤로는 새로 쌓이지 않았지만, 위 세 경로는 지금도 열려 있다).

⚠️ 이 정리의 위험은 **반대 방향**이다. 살아있는 세션의 행을 지우면 소유권 조회가 None 이
되어 그 세션에 **다시 붙지 못한다** — 행이 남아 있는 것보다 나쁘다. 그래서 빈 목록은
"판정 불가" 로 다루고 아무것도 지우지 않는다.
"""
from __future__ import annotations

import pytest

from sqlite_storage import SQLiteStorage


@pytest.fixture
async def storage(tmp_path):
    st = SQLiteStorage(str(tmp_path / "t.db"))
    yield st


async def _seed(st, ids):
    for sid in ids:
        await st.create_session(sid, "u1", cwd="/tmp")


@pytest.mark.asyncio
async def test_tmux_에_없는_행만_지운다(storage):
    await _seed(storage, ["live-1", "dead-1", "dead-2"])
    removed = await storage.prune_sessions_not_in({"live-1"})
    assert removed == 2
    assert await storage.get_session_owner("live-1") == "u1"
    assert await storage.get_session_owner("dead-1") is None


@pytest.mark.asyncio
async def test_빈_목록이면_아무것도_지우지_않는다(storage):
    """'전부 죽었다' 와 'tmux 를 못 물어봤다' 는 같은 모습이다 — 지우는 쪽이 훨씬 위험하다."""
    await _seed(storage, ["a", "b"])
    assert await storage.prune_sessions_not_in(set()) == 0
    assert await storage.get_session_owner("a") == "u1"


@pytest.mark.asyncio
async def test_전부_살아있으면_건드리지_않는다(storage):
    await _seed(storage, ["a", "b"])
    assert await storage.prune_sessions_not_in({"a", "b"}) == 0
    assert await storage.get_session_owner("b") == "u1"


@pytest.mark.asyncio
async def test_두_번_돌려도_안전하다(storage):
    await _seed(storage, ["live", "dead"])
    assert await storage.prune_sessions_not_in({"live"}) == 1
    assert await storage.prune_sessions_not_in({"live"}) == 0


@pytest.mark.asyncio
async def test_다른_사용자의_행도_대상이다(storage):
    """시작 시 정리는 전역이다 — tmux 는 사용자별로 나뉘어 있지 않다."""
    await storage.create_session("mine", "u1", cwd="/tmp")
    await storage.create_session("theirs", "u2", cwd="/tmp")
    assert await storage.prune_sessions_not_in({"mine"}) == 1
    assert await storage.get_session_owner("theirs") is None


def test_시작_시_실제로_불린다():
    """배선이 빠지면 이 기능은 조용히 없는 것이 된다."""
    src = open(__file__.replace("tests/test_session_row_prune.py", "main.py"), encoding="utf-8").read()
    assert "prune_sessions_not_in" in src

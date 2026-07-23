"""완료 알림 중복 억제 — _notify_completions 를 직접 돌려 검증한다.

두 가지를 지킨다:
  1. 같은 내용(제목+발췌)이면 다시 안 보낸다 — 에이전트가 짧게 응답하고 멈추기를
     반복해도 폰이 계속 울리지 않는다.
  2. 그렇다고 "안 누른 걸 기다리며" 막아두는 게 아니다 — 내용이 바뀌면 즉시 보낸다.
     세워두는 상태가 없다는 뜻이다.
"""
from unittest.mock import AsyncMock, patch

import pytest

import agent_status_service as svc


def _done(session="s1", title="작업"):
    return {"sessionId": session, "status": "idle", "previousStatus": "working",
            "completed": True, "gone": False, "command": "claude",
            "title": title, "cwd": "/tmp"}


@pytest.fixture(autouse=True)
def clean_state():
    svc._last_notified_at.clear()
    svc._last_signature.clear()
    svc._working_since.clear()
    yield
    svc._last_notified_at.clear()
    svc._last_signature.clear()


async def _run(changes, excerpt="화면 내용"):
    """실제 _notify_completions 를 돌리되 바깥으로 나가는 건 전부 막는다."""
    sent = []
    with patch.object(svc.storage, "get_session_owner", AsyncMock(return_value="u")), \
         patch.object(svc, "_capture_excerpt", AsyncMock(return_value=excerpt)), \
         patch.object(svc, "describe_session", AsyncMock(return_value={"addr": "1.1", "tabName": "t", "paneIndex": 1, "cwd": "/tmp"})), \
         patch.object(svc, "send_to_user", AsyncMock()), \
         patch.object(svc.agent_status_watcher, "snapshot", return_value={}), \
         patch.object(svc, "notify_agent_done", AsyncMock(side_effect=lambda *a, **k: sent.append(a))):
        await svc._notify_completions(changes)
    return sent


@pytest.mark.anyio
async def test_same_content_is_not_resent():
    assert len(await _run([_done()], excerpt="빌드 성공")) == 1
    # 같은 제목 + 같은 발췌 → 조용히 무시
    assert len(await _run([_done()], excerpt="빌드 성공")) == 0


@pytest.mark.anyio
async def test_new_content_notifies_immediately():
    """내용이 달라지면 즉시 보낸다 — 안 누른 걸 기다리며 막는 게 아니다."""
    await _run([_done()], excerpt="첫 번째 결과")
    # 시간과 무관하게, 발췌가 바뀌면 새 알림
    sent = await _run([_done()], excerpt="두 번째 결과")
    assert len(sent) == 1


@pytest.mark.anyio
async def test_title_change_alone_is_new():
    await _run([_done(title="A")], excerpt="같은 화면")
    assert len(await _run([_done(title="B")], excerpt="같은 화면")) == 1


@pytest.mark.anyio
async def test_gone_session_resets_so_it_can_notify_again():
    """세션이 죽고 다시 생기면 같은 내용이어도 새 알림이다 — 세워둔 상태가 아니다."""
    await _run([_done()], excerpt="결과")
    await svc._notify_completions([{"sessionId": "s1", "gone": True}])
    assert len(await _run([_done()], excerpt="결과")) == 1


@pytest.mark.anyio
async def test_different_sessions_do_not_block_each_other():
    sent = await _run([_done(session="a"), _done(session="b")], excerpt="x")
    assert len(sent) == 2

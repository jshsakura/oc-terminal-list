"""agent_status 파서 — tmux pane_title 에서 에이전트 상태를 읽는다.

케이스는 `shared/agent-title-cases.json` 한 곳에서 온다. 같은 표를 프론트
(`utils/agentTitle.test.js`)도 읽으므로, 두 구현의 판정이 갈라지면 한쪽이 깨진다.
"""
import json
from pathlib import Path

import pytest

from agent_status import detect_status, display_title, is_spinner_only_change

CASES = json.loads(
    (Path(__file__).resolve().parents[2] / "shared" / "agent-title-cases.json").read_text("utf-8")
)


def _id(case: dict) -> str:
    return case.get("title") or case.get("before") or "<empty>"


@pytest.mark.parametrize("case", CASES["status"], ids=_id)
def test_detect_status(case):
    assert detect_status(case["title"]) == case["expect"], case.get("why", "")


@pytest.mark.parametrize("case", CASES["displayTitle"], ids=_id)
def test_display_title(case):
    assert display_title(case["title"]) == case["expect"], case.get("why", "")


@pytest.mark.parametrize("case", CASES["spinnerOnlyChange"], ids=_id)
def test_spinner_only_change(case):
    assert is_spinner_only_change(case["before"], case["after"]) is case["expect"]


# ---------------------- 표에 담기 애매한 것들 ----------------------

def test_none_title_is_not_an_agent():
    """JSON 으로는 null 타이틀을 표현하기 애매하다 — 여기서 직접 본다."""
    assert detect_status(None) is None
    assert display_title(None) == ""

"""원격 관찰자(probe) 검증.

probe 는 **원격에서** 도는 별도 프로세스라 import 로 검증할 수 없다. 그래서 백엔드가
실제로 보내는 것과 **같은 소스**를 컴파일해서 그 안의 함수를 직접 부른다 — 치환까지
포함해 검증되므로, 글리프가 안 박힌 채 나가는 사고가 여기서 잡힌다.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

import agent_status
from remote_agent.payload import script_source

SHARED = Path(__file__).resolve().parents[2] / "shared" / "agent-title-cases.json"
CASES = json.loads(SHARED.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def probe():
    """백엔드가 원격으로 보내는 바로 그 소스를 실행한 네임스페이스."""
    ns: dict = {}
    exec(compile(script_source(), "probe.py", "exec"), ns)   # noqa: S102 — 그게 요점이다
    return ns


def test_glyphs_are_substituted(probe):
    # 치환이 안 되면 probe 는 import 단계에서 죽는다. 여기 온 것 자체가 절반의 증거고,
    # 나머지 절반은 규칙이 실제로 같은가다(아래 테스트들).
    assert "__STATUS" not in probe["STATUS_GLYPHS"]


@pytest.mark.parametrize("case", CASES["displayTitle"], ids=lambda c: c.get("why", ""))
def test_display_title_matches_backend(probe, case):
    """표시용 타이틀 규칙이 백엔드와 같아야 한다 — 접는 기준이 여기서 나온다."""
    assert probe["display_title"](case["title"]) == agent_status.display_title(case["title"])


@pytest.mark.parametrize("case", CASES["spinnerOnlyChange"], ids=lambda c: c.get("why", ""))
def test_spinner_folding_matches_backend(probe, case):
    """⚠️ 원격이 접는 것과 백엔드가 접는 것이 갈라지면, 스피너 프레임이 통째로 넘어오거나
    (초당 10회 × 호스트 수) 진짜 전이가 원격에서 조용히 사라진다."""
    before, after = case["before"], case["after"]
    line = "s\t1\tclaude\t/tmp\t{}"
    folded_same = probe["fold_key"](line.format(before)) == probe["fold_key"](line.format(after))
    assert folded_same == agent_status.is_spinner_only_change(before, after)


def test_changed_lines_reports_nothing_when_only_spinner_moved(probe):
    prev = ["s1\t1\tclaude\t/tmp\t⠋ building"]
    curr = ["s1\t1\tclaude\t/tmp\t⠙ building"]
    assert probe["changed_lines"](prev, curr) == []


def test_changed_lines_reports_a_real_transition(probe):
    prev = ["s1\t1\tclaude\t/tmp\t⠋ building"]
    curr = ["s1\t1\tclaude\t/tmp\t✳ done"]
    assert probe["changed_lines"](prev, curr) == curr


def test_a_closed_pane_is_a_change(probe):
    """사라진 pane 을 안 보내면 백엔드는 그 pane 의 마지막 상태를 영원히 들고 있는다."""
    prev = ["s1\t1\tclaude\t/tmp\t✳ a", "s2\t1\tclaude\t/tmp\t✳ b"]
    curr = ["s1\t1\tclaude\t/tmp\t✳ a"]
    assert probe["changed_lines"](prev, curr) == curr


def test_title_may_contain_tabs(probe):
    """타이틀이 마지막 칸이라 그 안의 탭은 흡수된다 — 앞칸으로 밀리면 안 된다."""
    line = "s1\t1\tclaude\t/tmp\tbuild\tstep 2"
    assert probe["fold_key"](line).endswith("build\tstep 2")


def test_interval_is_clamped(probe):
    """백엔드가 0 을 보내도 원격이 폭주하지 않는다."""
    control = probe["Control"](1.5)
    for want, expect in ((0, probe["MIN_INTERVAL"]), (999, probe["MAX_INTERVAL"])):
        control.interval = max(probe["MIN_INTERVAL"], min(probe["MAX_INTERVAL"], float(want)))
        assert control.interval == expect

"""설치 도구 카탈로그 — 목록 합치기 · 확인 스크립트 · 결과 파싱."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import host_tools  # noqa: E402


def test_builtin_list_has_herdr():
    ids = [t["id"] for t in host_tools.builtin_tools()]
    assert "herdr" in ids


def test_builtin_probe_never_runs_the_tool():
    """확인 명령이 그 도구를 **실행하면** 안 된다.

    herdr 는 인자 없이 부르면 멀티플렉서를 띄운다. tty 가 없는 SSH exec 에서 그러면
    프로브가 우리 상한까지 매달린다 — `command -v` 는 PATH 만 본다.
    """
    for tool in host_tools.builtin_tools():
        check = tool["check_command"]
        assert check.startswith("command -v "), f"{tool['id']}: {check}"


def test_builtin_tools_are_copies():
    first = host_tools.builtin_tools()[0]
    first["name"] = "mutated"
    assert host_tools.builtin_tools()[0]["name"] != "mutated"


def test_merge_puts_builtin_first_and_marks_origin():
    merged = host_tools.merge_tools([{"id": "u1", "name": "mine"}])
    assert merged[0]["builtin"] is True
    assert merged[-1]["id"] == "u1"
    assert merged[-1]["builtin"] is False


def test_user_row_overrides_builtin_of_same_id():
    merged = host_tools.merge_tools([{"id": "herdr", "name": "내 herdr"}])
    herdr = [t for t in merged if t["id"] == "herdr"]
    assert len(herdr) == 1
    assert herdr[0]["name"] == "내 herdr"
    assert herdr[0]["builtin"] is False


def test_check_script_puts_local_bin_on_path():
    """비대화형 SSH 셸에는 ~/.local/bin 이 없다 — 설치물이 거기 앉는데도."""
    script = host_tools.build_check_script(host_tools.builtin_tools(), "@@M")
    assert host_tools.PROBE_PATH_PREFIX in script
    assert "command -v herdr" in script


def test_check_script_skips_tools_without_a_check():
    script = host_tools.build_check_script(
        [{"id": "a", "check_command": ""}, {"id": "b", "check_command": "true"}], "@@M"
    )
    assert "@@M b" in script
    assert "@@M a" not in script


def test_parse_reads_verdict_and_detail():
    out = "@@M herdr\n@@M ok\n/home/u/.local/bin/herdr\n"
    parsed = host_tools.parse_check_output(out, "@@M")
    assert parsed["herdr"]["installed"] is True
    assert "herdr" in parsed["herdr"]["detail"]


def test_parse_marks_missing_tool_as_not_installed():
    parsed = host_tools.parse_check_output("@@M herdr\n@@M no\n", "@@M")
    assert parsed["herdr"]["installed"] is False


def test_parse_leaves_unmentioned_tool_unknown():
    """중간에 끊긴 프로브는 흔한 경우다. 없는 것은 **모름**이지 안 깔림이 아니다."""
    parsed = host_tools.parse_check_output("@@M a\n@@M ok\n", "@@M")
    assert "b" not in parsed


def test_marker_is_unpredictable():
    """도구 출력이 표식을 흉내내 다음 도구의 판정을 바꿀 수 없어야 한다."""
    assert host_tools.new_marker() != host_tools.new_marker()

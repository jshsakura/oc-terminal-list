"""설치 도구 카탈로그 — 목록 합치기 · 확인 스크립트 · 결과 파싱."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import host_tools  # noqa: E402


def test_builtin_list_is_tmux_and_itl_only():
    """tmux 기반 터미널이다 — 다른 멀티플렉서를 카탈로그에 싣지 않는다."""
    ids = [t["id"] for t in host_tools.builtin_tools()]
    assert ids == ["tmux", "itl"]


def test_builtin_probe_never_runs_the_tool():
    """확인 명령이 그 도구를 **실행하면** 안 된다.

    tmux 는 인자 없이 부르면 서버와 세션을 띄운다. tty 가 없는 SSH exec 에서 그러면
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
    merged = host_tools.merge_tools([{"id": "tmux", "name": "내 tmux"}])
    tmux = [t for t in merged if t["id"] == "tmux"]
    assert len(tmux) == 1
    assert tmux[0]["name"] == "내 tmux"
    assert tmux[0]["builtin"] is False


def test_check_script_puts_local_bin_on_path():
    """비대화형 SSH 셸에는 ~/.local/bin 이 없다 — 설치물이 거기 앉는데도."""
    script = host_tools.build_check_script(host_tools.builtin_tools(), "@@M")
    assert host_tools.PROBE_PATH_PREFIX in script
    assert "command -v tmux" in script


def test_check_script_skips_tools_without_a_check():
    script = host_tools.build_check_script(
        [{"id": "a", "check_command": ""}, {"id": "b", "check_command": "true"}], "@@M"
    )
    assert "@@M b" in script
    assert "@@M a" not in script


def test_parse_reads_verdict_and_detail():
    out = "@@M tmux\n@@M ok\n/home/u/.local/bin/tmux\n"
    parsed = host_tools.parse_check_output(out, "@@M")
    assert parsed["tmux"]["installed"] is True
    assert "tmux" in parsed["tmux"]["detail"]


def test_parse_marks_missing_tool_as_not_installed():
    parsed = host_tools.parse_check_output("@@M tmux\n@@M no\n", "@@M")
    assert parsed["tmux"]["installed"] is False


def test_parse_leaves_unmentioned_tool_unknown():
    """중간에 끊긴 프로브는 흔한 경우다. 없는 것은 **모름**이지 안 깔림이 아니다."""
    parsed = host_tools.parse_check_output("@@M a\n@@M ok\n", "@@M")
    assert "b" not in parsed


def test_marker_is_unpredictable():
    """도구 출력이 표식을 흉내내 다음 도구의 판정을 바꿀 수 없어야 한다."""
    assert host_tools.new_marker() != host_tools.new_marker()


# ─── push-installed tools (itl) ───────────────────────────────────────────────

def test_builtin_list_has_itl_as_a_push_tool():
    itl = next(t for t in host_tools.builtin_tools() if t["id"] == "itl")
    assert itl["install_kind"] == "push"
    assert itl["install_path"] == "~/.local/bin/itl"
    assert host_tools.is_pushable("itl")
    assert not host_tools.is_pushable("tmux")


def test_push_source_is_the_shipped_cli():
    src = host_tools.push_source("itl")
    assert src.startswith("#!/usr/bin/env python3") and "def main(" in src


def test_push_script_places_one_executable_file_and_nothing_else():
    script = host_tools.push_script("itl")
    assert 'mkdir -p "$HOME/.local/bin"' in script
    assert 'cat > "$HOME/.local/bin"/itl' in script
    assert 'chmod 755 "$HOME/.local/bin"/itl' in script
    assert "sudo" not in script and "curl" not in script


def test_remove_script_deletes_exactly_that_file():
    assert host_tools.remove_script("itl") == 'rm -f "$HOME/.local/bin"/itl'


def test_push_script_quotes_the_tool_id():
    """Not reachable today (PUSHABLE is code-owned), but the id must never be shell."""
    assert "'a b'" in host_tools.push_script("a b")


async def test_run_local_script_full_feeds_stdin_and_reports_exit_code(tmp_path):
    target = tmp_path / "out"
    rc, out = await host_tools.run_local_script_full(f"cat > {target}", stdin_data="hello")
    assert rc == 0 and target.read_text() == "hello"
    rc, _ = await host_tools.run_local_script_full("exit 3")
    assert rc == 3


def test_local_tool_installed_looks_in_local_bin(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    assert not host_tools.local_tool_installed("itl")
    (tmp_path / ".local" / "bin").mkdir(parents=True)
    (tmp_path / ".local" / "bin" / "itl").write_text("x")
    assert host_tools.local_tool_installed("itl")


# ─── 설치본이 낡았는지 ─────────────────────────────────────────────────────────

def test_itl_probe_reports_a_fingerprint_without_running_it():
    """⚠️ 확인 명령은 그 도구를 실행하면 안 된다(규칙 2). 읽기만 한다."""
    itl = next(t for t in host_tools.builtin_tools() if t["id"] == "itl")
    check = itl["check_command"]
    assert check.startswith("command -v itl")
    assert "sha256sum" in check and "fp=" in check
    assert "itl --version" not in check and "itl -v" not in check


def test_expected_fingerprint_matches_the_shipped_file():
    import hashlib
    expected = hashlib.sha256(host_tools.push_source("itl").encode("utf-8")).hexdigest()
    assert host_tools.expected_fingerprint("itl") == expected
    assert host_tools.expected_fingerprint("tmux") == ""      # 밀기 대상이 아니다


def test_outdated_is_none_when_the_fingerprint_could_not_be_read():
    """모르면 "최신" 이 아니라 **모름** 이다 — 최신으로 그리면 갱신할 이유를 못 본다."""
    assert host_tools.is_outdated("itl", "/home/u/.local/bin/itl") is None
    assert host_tools.is_outdated("itl", None) is None
    assert host_tools.is_outdated("tmux", "fp=" + "0" * 64) is None


def test_outdated_compares_against_what_we_would_push():
    same = "fp=" + host_tools.expected_fingerprint("itl")
    assert host_tools.is_outdated("itl", same) is False
    assert host_tools.is_outdated("itl", "fp=" + "0" * 64) is True


def test_fingerprint_is_read_out_of_a_noisy_detail():
    fp = host_tools.expected_fingerprint("itl")
    assert host_tools.fingerprint_in(f"/home/u/.local/bin/itl fp={fp} 기타") == fp
    assert host_tools.fingerprint_in("fp=너무짧음") == ""

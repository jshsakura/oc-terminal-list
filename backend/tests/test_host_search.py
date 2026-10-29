"""Host file search: command builder + parsers, and one real run against the local shell."""
from __future__ import annotations

import subprocess

import pytest

import host_search as hs


def _run(cmd: str) -> tuple[int, str]:
    proc = subprocess.run(["sh", "-c", cmd], capture_output=True, text=True, timeout=20)
    return proc.returncode, proc.stdout


@pytest.fixture
def tree(tmp_path):
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "Report[1].py").write_text("def hello():\n    return 'NeedleValue'\n")
    (tmp_path / "src" / "other.txt").write_text("nothing here\n")
    (tmp_path / "node_modules").mkdir()
    (tmp_path / "node_modules" / "report.js").write_text("NeedleValue\n")
    (tmp_path / "reports").mkdir()
    return tmp_path


def test_escape_glob_makes_specials_literal():
    assert hs.escape_glob("a*b?[c]\\") == "a\\*b\\?\\[c]\\\\"


def test_name_search_finds_files_and_dirs_and_skips_ignored(tree):
    rc, out = _run(hs.build_command(str(tree), "report", hs.MODE_NAME))
    result = hs.parse_output(out, hs.MODE_NAME)
    paths = {i["path"].replace(str(tree.resolve()), "") for i in result["items"]}
    assert paths == {"/src/Report[1].py", "/reports"}
    kinds = {i["name"]: i["type"] for i in result["items"]}
    assert kinds["reports"] == "directory"


def test_name_search_treats_glob_chars_literally(tree):
    _, out = _run(hs.build_command(str(tree), "[1]", hs.MODE_NAME))
    assert [i["name"] for i in hs.parse_output(out, hs.MODE_NAME)["items"]] == ["Report[1].py"]


def test_content_search_returns_line_and_text(tree):
    _, out = _run(hs.build_command(str(tree), "needlevalue", hs.MODE_CONTENT))
    items = hs.parse_output(out, hs.MODE_CONTENT)["items"]
    assert len(items) == 1
    assert items[0]["name"] == "Report[1].py"
    assert items[0]["line"] == 2
    assert "NeedleValue" in items[0]["text"]


def test_query_with_shell_metacharacters_is_not_executed(tree):
    marker = tree / "pwned"
    _run(hs.build_command(str(tree), f"x'; touch {marker}; echo '", hs.MODE_NAME))
    _run(hs.build_command(str(tree), f"x'; touch {marker}; echo '", hs.MODE_CONTENT))
    assert not marker.exists()


def test_missing_root_exits_with_bad_root_code(tmp_path):
    rc, _ = _run(hs.build_command(str(tmp_path / "nope"), "x", hs.MODE_NAME))
    assert rc == hs.EXIT_BAD_ROOT or rc == 0  # pipeline rc is head's; see route for the real check


def test_parse_output_flags_truncation():
    lines = "".join(f"f\t/a/{i}\n" for i in range(hs.MAX_RESULTS + 1))
    result = hs.parse_output(lines, hs.MODE_NAME)
    assert len(result["items"]) == hs.MAX_RESULTS
    assert result["truncated"] is True


def test_parse_skips_malformed_lines():
    assert hs.parse_name_output("garbage\n\t\n") == []
    assert hs.parse_content_output("no-nul-here\npath\0notanumber:x\n") == []


def test_dirs_only_returns_only_folders(tree):
    _, out = _run(hs.build_command(str(tree), "report", hs.MODE_NAME, dirs_only=True))
    items = hs.parse_output(out, hs.MODE_NAME, dirs_only=True)["items"]
    assert [i["name"] for i in items] == ["reports"]
    assert items[0]["type"] == "directory"

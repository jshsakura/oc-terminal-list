"""리모트 설치 스크립트 · 상태 판정."""
from __future__ import annotations

import shutil
import subprocess

import pytest

from remote_agent.setup import (
    STATUS_SCRIPT,
    UNINSTALL_SCRIPT,
    build_install_script,
    parse_status,
    version_hash,
)

URL = "ws://100.1.2.3:38822/api/remote/ws"


def test_the_token_never_appears_in_the_command():
    """🔐 명령 문자열은 원격 `ps` 에 그대로 보인다 — 토큰은 stdin 으로만 간다."""
    script = build_install_script(URL, "mobile")
    assert "IFS= read -r _itl_tok" in script
    assert "$_itl_tok" in script
    assert "eyJ" not in script          # JWT 조각이 새어 들어오지 않았나


def test_the_credential_file_is_narrowed_before_it_exists():
    """⚠️ 먼저 쓰고 나중에 chmod 하면 그 사이에 같은 기계의 다른 사용자가 읽는다."""
    script = build_install_script(URL, "mobile")
    umask_at = script.index("umask 077")
    write_at = script.index('"$_itl_tok" >')
    assert umask_at < write_at


def test_all_three_files_are_installed():
    script = build_install_script(URL, "mobile")
    for name in ("probe.py", "wsclient.py", "client.py"):
        assert f"itl-remote/{name}" in script


def test_the_probe_that_ships_has_its_glyphs_substituted():
    """치환 안 된 probe 를 얹으면 원격이 시작하자마자 죽는다."""
    assert "__STATUS_GLYPHS__" not in build_install_script(URL, "mobile")


def test_version_follows_content_not_a_hand_managed_string():
    """손으로 관리하는 버전 문자열은 잊혀진다 — 내용이 곧 버전이다."""
    first = version_hash()
    assert first and first == version_hash()
    assert len(first) == 12


def test_missing_systemd_is_not_an_install_failure():
    """컨테이너·구형 기계에서도 설치는 되어야 한다 — 띄우는 건 사용자가 한다."""
    script = build_install_script(URL, "mobile")
    assert "ITL_REMOTE_SERVICE=none" in script
    assert "ITL_REMOTE_INSTALLED" in script


def test_status_reads_a_healthy_host():
    status = parse_status("FILES=1\nCRED=1\nVERSION=abc\nSERVICE=active\nPROC=1", True, "abc")
    assert status == {"installed": True, "connected": True, "running": True,
                      "service": "active", "version": "abc", "outdated": False}


def test_a_stale_version_is_flagged():
    status = parse_status("FILES=1\nCRED=1\nVERSION=old\nSERVICE=active\nPROC=1", True, "new")
    assert status["outdated"] is True


def test_files_without_credentials_is_not_installed():
    """반쯤 지워진 상태를 '깔림' 으로 읽으면 설치 버튼이 사라져 고칠 방법이 없어진다."""
    assert parse_status("FILES=1\nCRED=0\nSERVICE=none\nPROC=0", False, "v")["installed"] is False


def test_a_hand_started_process_counts_as_running():
    """서비스 없이 손으로 띄운 경우 — '안 도는데 돈다고' 보다 낫다."""
    status = parse_status("FILES=1\nCRED=1\nSERVICE=none\nPROC=1", False, "v")
    assert status["running"] is True
    assert status["connected"] is False


def test_our_own_view_of_connectedness_wins():
    """붙어 있는가는 **우리 쪽 사실**이다 — SSH 출력보다 정확하다."""
    assert parse_status("FILES=1\nCRED=1\nPROC=0", True, "v")["running"] is True


def test_uninstall_removes_service_files_and_credentials():
    for fragment in ("disable --now", "rm -rf", "itl-remote", "ITL_REMOTE_REMOVED"):
        assert fragment in UNINSTALL_SCRIPT


def test_status_script_distinguishes_files_from_credentials():
    assert "FILES=" in STATUS_SCRIPT and "CRED=" in STATUS_SCRIPT


def test_the_running_probe_does_not_match_its_own_command_line():
    """⚠️ 실측 버그: 스크립트 전체가 원격 셸의 argv 라, pgrep 패턴을 그대로 적으면
    **자기를 실행한 셸을 찾아** 언제나 '돌고 있다' 가 나온다. 그러면 '안 깔렸는데
    돌고 있다' 는 모순된 화면이 되고, 설치 버튼을 눌러도 상태가 안 변한다."""
    assert "itl-remote/[c]lient.py" in STATUS_SCRIPT
    assert 'pgrep -f "itl-remote/client.py"' not in STATUS_SCRIPT


# ---------------------- 셸이 실제로 읽을 수 있는가 ----------------------

def _bash_syntax_ok(script: str) -> tuple[bool, str]:
    """`bash -n` — 실행하지 않고 파싱만 한다."""
    bash = shutil.which("bash")
    if not bash:
        pytest.skip("bash 없음")
    out = subprocess.run([bash, "-n"], input=script, capture_output=True, text=True)
    return out.returncode == 0, out.stderr


# ⚠️ id 를 붙이지 않으면 실패 메시지에 **스크립트 전문**(2만 자)이 테스트 이름으로 찍혀
# 정작 bash 가 알려준 줄 번호를 못 읽는다. 실제로 그랬다.
@pytest.mark.parametrize("label", ["install", "status", "uninstall"])
def test_scripts_parse_as_shell(label):
    script = {
        "install": build_install_script(URL, "mobile"),
        "status": STATUS_SCRIPT,
        "uninstall": UNINSTALL_SCRIPT,
    }[label]
    """⚠️ 실측 버그가 여기 걸린다. 보기 좋으라고 heredoc 을 들여썼더니 `<<'MARKER'` 의
    구분자가 행 맨 앞이 아니게 되어 **heredoc 이 영영 닫히지 않았다** — 뒤따르는
    systemctl 과 완료 표식까지 통째로 삼켰다. 눈으로는 멀쩡해 보였고, 원격에서 실행할
    때에야 실패했을 것이다."""
    ok, err = _bash_syntax_ok(script)
    assert ok, f"{label}: {err}"


def test_the_unit_file_is_written_flush_left():
    """systemd 는 `  [Unit]` 을 읽지 못한다. 그리고 들여쓴 구분자는 heredoc 을 못 닫는다."""
    script = build_install_script(URL, "mobile")
    body = script.split("<<'ITL_UNIT_EOF'\n", 1)[1].split("\nITL_UNIT_EOF", 1)[0]
    assert body.startswith("[Unit]")
    for line in body.splitlines():
        assert line == line.lstrip(), f"들여쓴 줄: {line!r}"


def test_the_unit_uses_systemd_home_not_a_shell_variable():
    """systemd 는 ExecStart 에서 $HOME 을 펼치지 않는다 — %h 여야 한다."""
    script = build_install_script(URL, "mobile")
    exec_line = [ln for ln in script.splitlines() if ln.startswith("ExecStart=")][0]
    assert "%h/" in exec_line
    assert "$HOME" not in exec_line


# ---------------------- 실제로 돌려서 재는 것 ----------------------

def _run(script: str, home) -> str:
    bash = shutil.which("bash")
    if not bash:
        pytest.skip("bash 없음")
    out = subprocess.run([bash, "-s"], input=script, capture_output=True, text=True,
                         env={"HOME": str(home), "PATH": "/usr/bin:/bin"})
    return out.stdout


def test_status_output_is_one_marker_per_line(tmp_path):
    """⚠️ 실측 버그. `printf '%s'` 로 VERSION 을 개행 없이 써서 `cat | sed` 의 출력에
    **다음 줄이 이어붙었다** — `VERSION=f0fc…SERVICE=active` 가 되어 버전도 서비스도
    못 읽고 "낡았다" 로 오판했다. 문자열만 보는 테스트로는 안 잡히고, 실제로 돌려야 보인다."""
    lib = tmp_path / ".local/share/itl-remote"
    cfg = tmp_path / ".config/itl-remote"
    lib.mkdir(parents=True)
    cfg.mkdir(parents=True)
    (lib / "client.py").write_text("")
    (cfg / "credentials").write_text("{}")
    (lib / "VERSION").write_text("abc123")        # 개행 없는 옛 설치 그대로

    out = _run(STATUS_SCRIPT, tmp_path)
    markers = [ln for ln in out.splitlines() if "=" in ln]
    for line in markers:
        assert line.count("=") == 1 or line.startswith("VERSION="), f"두 표식이 한 줄에: {line!r}"
    assert "VERSION=abc123" in out.splitlines()


def test_status_of_a_freshly_installed_tree_parses_clean(tmp_path):
    """설치 스크립트가 만든 그대로를 상태 스크립트가 읽어 온전한 값이 나오는가."""
    _run(build_install_script(URL, "mobile").replace(
        "IFS= read -r _itl_tok", "_itl_tok=dummy"), tmp_path)
    out = _run(STATUS_SCRIPT, tmp_path)
    status = parse_status(out, connected=False, current_version=version_hash())
    assert status["installed"] is True
    assert status["version"] == version_hash()
    assert status["outdated"] is False           # 방금 깐 것이 낡았다고 나오면 안 된다


def test_the_directories_are_not_group_writable(tmp_path):
    """🔐 파일이 600 이어도 디렉터리가 그룹 쓰기 가능하면 **파일을 갈아치울 수** 있다 —
    자격증명 교체, 나아가 client.py 를 자기 코드로 대체. 실측 호스트가 775 였다."""
    _run(build_install_script(URL, "mobile").replace(
        "IFS= read -r _itl_tok", "_itl_tok=dummy"), tmp_path)
    for rel in (".local/share/itl-remote", ".config/itl-remote"):
        mode = oct((tmp_path / rel).stat().st_mode)[-3:]
        assert mode == "700", f"{rel} = {mode}"


def test_the_credential_file_is_not_world_readable(tmp_path):
    """🔐 같은 기계의 다른 사용자가 읽으면 그 호스트의 자격증명이 새어 나간다."""
    _run(build_install_script(URL, "mobile").replace(
        "IFS= read -r _itl_tok", "_itl_tok=dummy"), tmp_path)
    cred = tmp_path / ".config/itl-remote/credentials"
    assert cred.exists()
    assert oct(cred.stat().st_mode)[-3:] == "600"


def test_installing_restarts_the_service():
    """⚠️ `enable --now` 는 이미 돌고 있는 서비스를 다시 띄우지 않는다 — 파일만 새것이고
    프로세스는 옛 코드다. 다시 설치해도 아무것도 안 바뀌는 조용한 실패가 된다(실측)."""
    script = build_install_script(URL, "mobile")
    assert "systemctl --user restart" in script
    assert "enable --now" not in script

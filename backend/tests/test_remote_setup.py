"""리모트 설치 스크립트 · 상태 판정."""
from __future__ import annotations

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

"""itl_remote_setup — 보안 계약 중심 단위 테스트.

이 모듈의 본질은 "원격에 무엇을 심는가"가 아니라 "무엇을 절대 심지 않는가"다:
1. 토큰 값은 조립된 원격 명령 문자열(cmd)에 한 글자도 없어야 한다 — stdin 으로만.
2. 수동 셋업 명령에는 비밀이 없어야 한다.
3. tailnet 이 아니면 아무 왕복도 하지 않는다.
"""
from __future__ import annotations

from unittest.mock import AsyncMock

import itl_remote_setup as sut


def test_exact_target_quotes_leading_equals_for_zsh():
    # zsh 의 =-expansion 을 피하려 전체를 단일인용으로 감싸야 한다(hosts.py 규칙).
    assert sut._exact_target("mobile-2b4a0a2ee6f8") == "'=mobile-2b4a0a2ee6f8'"
    assert sut._exact_target("mobile-x", ":") == "'=mobile-x:'"


def test_remote_api_base_tailscale_only():
    assert sut._remote_api_base({"ip_kind": "tailscale", "ip": "100.1.2.3"}) == "http://100.1.2.3:38822"
    assert sut._remote_api_base({"ip_kind": "lan", "ip": "192.168.0.2"}) == ""
    assert sut._remote_api_base({"ip_kind": "", "ip": ""}) == ""


def test_manual_setup_command_carries_no_secret():
    cmd = sut.build_manual_setup_command()
    assert cmd.startswith("mkdir -p ~/.local/bin")
    assert "<<'ITL_EOF'" in cmd and "\nITL_EOF\n" in cmd
    assert "chmod 700 ~/.local/bin/itl" in cmd
    assert sut.PROFILE_MARKER in cmd
    # 저장소 CLI 본문이 그대로 들어있는지(단일 진실).
    assert "터미널끼리 명령을 주고받는다" in cmd
    # 'Bearer {TOKEN}' f-string 코드는 CLI 본문에 원래 들어있으므로 마커에서 제외 —
    # 우리가 잡으려는 건 값이지 파이썬 소스의 포맷 문자가 아니다.
    for secret_marker in ("ITL_TOKEN=", "eyJ"):
        assert secret_marker not in cmd


class _FakeAuthManager:
    def __init__(self, token: str):
        self._token = token

    async def create_scoped_token(self, username: str, scope: str, extra: dict | None = None):
        assert scope == "itl"
        self.extra = extra          # 원격 토큰이 어느 호스트에서 왔는지 청구로 다는지 본다
        return self._token


async def test_env_inject_token_travels_stdin_only():
    """토큰 값은 stdin 에만 있고 cmd 문자열에는 없어야 한다 — argv(ps) 노출 방지."""
    captured: dict = {}
    token = "SECRET.eyJhbGciOi.JWTSIGNATURE"

    async def fake_run(host, secrets, cmd, timeout=10, stdin_data=None):
        captured["cmd"] = cmd
        captured["stdin"] = stdin_data
        return "ITL_ENV_OK"

    orig_run, orig_ident, orig_mgr = sut.run_remote_cmd, sut.get_server_identity, sut.get_auth_manager
    sut.run_remote_cmd = fake_run
    sut.get_server_identity = AsyncMock(return_value={"ip_kind": "tailscale", "ip": "100.1.2.3"})
    sut.get_auth_manager = lambda: _FakeAuthManager(token)
    try:
        sut.forget_injected("box", "mobile-2b4a0a2ee6f8")
        ok = await sut.ensure_remote_itl_env(
            {"use_remote_tmux": 1, "hostname": "box", "last_cwd": "/home/u/workspace"},
            {}, "mobile-2b4a0a2ee6f8", "user",
        )
    finally:
        sut.run_remote_cmd, sut.get_server_identity, sut.get_auth_manager = orig_run, orig_ident, orig_mgr
        sut.forget_injected("box", "mobile-2b4a0a2ee6f8")

    assert ok is True
    assert captured["stdin"] == token
    cmd = captured["cmd"]
    assert token not in cmd, "토큰이 원격 명령 문자열(argv/ps)에 노출됨"
    assert "read -r _itl_tok" in cmd
    assert 'ITL_TOKEN "$_itl_tok"' in cmd
    assert "http://100.1.2.3:38822" in cmd
    # shlex.quote 는 안전 문자(영숫자/하이픈)를 인용 없이 통과시킨다.
    assert "ITL_SESSION mobile-2b4a0a2ee6f8" in cmd
    # 세션을 만들지도, 돌고 있는 pane 을 respawn 하지도 않는다
    # (그건 브리지의 일이다 — test_env_inject_never_creates_the_session).
    assert "new-session" not in cmd
    assert "respawn-pane" not in cmd
    # PATH 도 세션 env 에 심는다 — pane(bash 비로그인)이 ~/.local/bin 을
    # 못 찾던 실측 장애의 재발 방지.
    assert 'PATH "$HOME/.local/bin:$_itl_p"' in cmd


async def test_env_inject_skips_without_tailscale():
    """tailnet 주소가 아니면 SSH 왕복 자체를 하지 않는다."""
    calls: list = []

    async def fake_run(host, secrets, cmd, timeout=10, stdin_data=None):
        calls.append(cmd)
        return "ITL_ENV_OK"

    orig_run, orig_ident, orig_mgr = sut.run_remote_cmd, sut.get_server_identity, sut.get_auth_manager
    sut.run_remote_cmd = fake_run
    sut.get_server_identity = AsyncMock(return_value={"ip_kind": "lan", "ip": "192.168.0.2"})
    sut.get_auth_manager = lambda: _FakeAuthManager("t")
    try:
        assert await sut.ensure_remote_itl_env({"use_remote_tmux": 1}, {}, "s", "u") is False
    finally:
        sut.run_remote_cmd, sut.get_server_identity, sut.get_auth_manager = orig_run, orig_ident, orig_mgr
    assert calls == []


async def test_env_inject_never_creates_the_session():
    """세션을 만드는 것은 **브리지의 일**이다.

    예전엔 없으면 `tmux new-session -d` 로 만들었다. 그러면 브리지의 조심스러운 생성 절이
    `has-session` 에 걸려 통째로 건너뛰어진다 — `set-option -g history-limit` 을 new-session
    과 한 tmux 호출로 묶는 부분(콜드 스타트 첫 pane 이 2000 에 고정된다)과, 클라이언트 PTY
    차원 상속(이 exec 은 PTY 가 없어 80x24 로 시작한다)을 둘 다 잃는다.
    """
    async def fail_run(*a, **k):  # pragma: no cover - 호출되면 테스트 실패
        raise AssertionError("should not run")

    orig_run, orig_mgr = sut.run_remote_cmd, sut.get_auth_manager
    orig_ident = sut.get_server_identity
    sut.run_remote_cmd = fail_run
    sut.get_server_identity = AsyncMock(return_value={"ip_kind": "tailscale", "ip": "100.1.2.3"})
    sut.get_auth_manager = lambda: _FakeAuthManager("t")
    try:
        # tmux 안 쓰는 호스트 → 왕복 없음
        assert await sut.ensure_remote_itl_env({"use_remote_tmux": 0}, {}, "s", "u") is False
    finally:
        sut.run_remote_cmd, sut.get_server_identity, sut.get_auth_manager = orig_run, orig_ident, orig_mgr

    captured: dict = {}

    async def fake_run(host, secrets, cmd, timeout=10, stdin_data=None):
        captured["cmd"] = cmd
        return "ITL_ENV_NOSESSION"

    # 1단계 finally 가 원복시킨 패치를 재설치해야 실구현(get_server_identity 등)이
    # 돌지 않는다 — 이 머신은 실제 tailnet 이라 False 조기반환이 안 걸린다.
    sut.run_remote_cmd = fake_run
    sut.get_server_identity = AsyncMock(return_value={"ip_kind": "tailscale", "ip": "100.1.2.3"})
    sut.get_auth_manager = lambda: _FakeAuthManager("t")
    sut.forget_injected("box", "s")
    try:
        assert await sut.ensure_remote_itl_env(
            {"use_remote_tmux": 1, "hostname": "box"}, {}, "s", "u") is False
    finally:
        sut.run_remote_cmd, sut.get_server_identity, sut.get_auth_manager = orig_run, orig_ident, orig_mgr
    assert "new-session" not in captured["cmd"]
    assert "respawn-pane" not in captured["cmd"]      # 돌고 있는 에이전트를 죽이는 일도 없다
    assert "ITL_ENV_NOSESSION" in captured["cmd"]


async def test_env_inject_is_skipped_within_the_ttl():
    """재연결마다 SSH 왕복을 하나 더 얹으면 그게 복구를 느리게 만든다.

    토큰은 30일짜리라 매번 심을 이유가 없다. 창을 무한이 아니게 두는 이유는 원격 tmux
    서버가 재시작되면 세션 env 가 사라지기 때문이다.
    """
    calls: list = []

    async def fake_run(host, secrets, cmd, timeout=10, stdin_data=None):
        calls.append(cmd)
        return "ITL_ENV_OK"

    orig_run, orig_mgr = sut.run_remote_cmd, sut.get_auth_manager
    orig_ident = sut.get_server_identity
    sut.run_remote_cmd = fake_run
    sut.get_server_identity = AsyncMock(return_value={"ip_kind": "tailscale", "ip": "100.1.2.3"})
    sut.get_auth_manager = lambda: _FakeAuthManager("t")
    host = {"use_remote_tmux": 1, "id": "h1"}
    sut.forget_injected("h1", "s")
    try:
        assert await sut.ensure_remote_itl_env(host, {}, "s", "u") is True
        assert await sut.ensure_remote_itl_env(host, {}, "s", "u") is True      # 캐시 적중
        assert len(calls) == 1
        # 다른 세션은 자기 몫을 심어야 한다 — 캐시 키는 (호스트, 세션) 이다.
        assert await sut.ensure_remote_itl_env(host, {}, "other", "u") is True
        assert len(calls) == 2
        # force 는 창을 무시한다(세션 재시작 뒤 다시 심을 길).
        assert await sut.ensure_remote_itl_env(host, {}, "s", "u", force=True) is True
        assert len(calls) == 3
    finally:
        sut.run_remote_cmd, sut.get_server_identity, sut.get_auth_manager = orig_run, orig_ident, orig_mgr
        sut.forget_injected("h1", "s")
        sut.forget_injected("h1", "other")


async def test_status_parses_probe_output():
    async def fake_run(host, secrets, cmd, timeout=10, stdin_data=None):
        return "FILE=1\nPANE=0\n"

    orig_run = sut.run_remote_cmd
    sut.run_remote_cmd = fake_run
    try:
        status = await sut.remote_itl_status({"use_remote_tmux": 1}, {})
    finally:
        sut.run_remote_cmd = orig_run
    assert status["installed"] is True
    assert status["pane_path"] is False
    assert status["setup_command"].startswith("mkdir -p ~/.local/bin")
    # 수동 명령은 bashrc(비로그인 pane 셸)까지 커버한다. 시스템 경로는 건드리지 않는다.
    assert ".bashrc" in status["setup_command"]
    assert "sudo" not in status["setup_command"]


async def test_install_streams_repo_cli_via_stdin():
    # install 은 run_remote_cmd 를 2회(설치→상태재조회) 호출하므로 리스트로 캡처한다.
    calls: list = []

    async def fake_run(host, secrets, cmd, timeout=10, stdin_data=None):
        calls.append({"cmd": cmd, "stdin": stdin_data})
        if "ITL_CLI_INSTALLED" in cmd:
            return "ITL_CLI_INSTALLED"
        return "FILE=1\nPANE=1"

    orig_run = sut.run_remote_cmd
    sut.run_remote_cmd = fake_run
    try:
        result = await sut.install_remote_itl({"use_remote_tmux": 1}, {})
    finally:
        sut.run_remote_cmd = orig_run
    assert result["installed"] is True and result["pane_path"] is True
    install_call = next(c for c in calls if "ITL_CLI_INSTALLED" in c["cmd"])
    # 설치 본문 = 저장소 원문이 stdin 통로로 흘러간다(argv 미노출).
    assert "터미널끼리 명령을 주고받는다" in install_call["stdin"]
    # CLI 만이 아니라 MCP 서버까지 한 벌로 간다 — 반쪽만 있는 호스트는 pane 에서
    # 진단할 수 없는 방식으로 실패한다.
    import json as _json
    assert set(_json.loads(install_call["stdin"])) == set(sut.BUNDLE_FILES)
    # 임시 이름으로 쓰고 rename — 전송이 끊겨도 반쪽짜리 파일이 남지 않는다.
    assert "os.replace(tmp" in install_call["cmd"]
    assert "0o700" in install_call["cmd"]
    assert ".bashrc" in install_call["cmd"]
    assert "sudo" not in install_call["cmd"]


async def test_auto_install_writes_only_its_own_file():
    """자동 설치는 사용자의 rc 파일을 건드리지 않는다.

    버튼을 누르는 것과 앱이 알아서 하는 것의 경계다. 세션 PATH 는 어차피 주입되므로
    이 앱이 연 pane 에서는 그냥 되고, 사용자가 직접 연 셸까지 바꾸는 것은 사용자가
    명시적으로 고를 때만 한다.
    """
    calls: list = []

    async def fake_run(host, secrets, cmd, timeout=10, stdin_data=None):
        calls.append(cmd)
        return "ITL_CLI_INSTALLED"

    orig_run = sut.run_remote_cmd
    sut.run_remote_cmd = fake_run
    try:
        sut.forget_installed("box")
        ok = await sut.ensure_remote_itl_cli({"id": "box"}, {})
    finally:
        sut.run_remote_cmd = orig_run
        sut.forget_installed("box")

    assert ok is True
    assert len(calls) == 1
    assert ".bashrc" not in calls[0]
    assert ".profile" not in calls[0]
    assert sut.PROFILE_MARKER not in calls[0]


async def test_auto_install_is_skipped_once_the_host_is_current():
    """두 번째 attach 는 SSH 를 아예 열지 않는다 — 재연결 경로에 왕복을 얹지 않는다."""
    calls: list = []

    async def fake_run(host, secrets, cmd, timeout=10, stdin_data=None):
        calls.append(cmd)
        return "ITL_CLI_CURRENT"

    orig_run = sut.run_remote_cmd
    sut.run_remote_cmd = fake_run
    try:
        sut.forget_installed("box")
        assert await sut.ensure_remote_itl_cli({"id": "box"}, {}) is True
        assert await sut.ensure_remote_itl_cli({"id": "box"}, {}) is True
    finally:
        sut.run_remote_cmd = orig_run
        sut.forget_installed("box")
    assert len(calls) == 1


async def test_auto_install_failure_is_never_fatal():
    """윈도우 호스트·잠긴 셸·꽉 찬 디스크 — 터미널은 열려야 하고, 예외는 나가지 않는다."""
    async def fake_run(host, secrets, cmd, timeout=10, stdin_data=None):
        raise RuntimeError("no sh on this host")

    orig_run = sut.run_remote_cmd
    sut.run_remote_cmd = fake_run
    try:
        sut.forget_installed("winbox")
        assert await sut.ensure_remote_itl_cli({"id": "winbox"}, {}) is False
    finally:
        sut.run_remote_cmd = orig_run
        sut.forget_installed("winbox")


def test_install_command_is_a_no_op_when_the_version_matches():
    """같은 해시면 덮어쓰지 않는다 — 버전 표식이 재설치 폭풍을 막는다."""
    cmd = sut.build_install_cmd("abc123", with_rc=False)
    assert ".itl.version" in cmd
    assert "ITL_CLI_CURRENT" in cmd and "ITL_CLI_INSTALLED" in cmd
    # 항상 stdin 을 읽는다 — 검사 후 설치로 나누면 왕복이 둘이 된다.
    assert cmd.index("sys.stdin.read()") < cmd.index("ITL_CLI_CURRENT")


def test_version_covers_the_whole_bundle():
    """MCP 도구만 바뀌어도 호스트가 갱신돼야 한다 — 진입점만 해시하면 안 잡힌다."""
    import itl_remote_setup as m
    real = m._bundle_sources
    m._bundle_sources = lambda: {"itl": "a", "itl_mcp.py": "b", "itl_mcp_tools.py": "c"}
    try:
        before = m._cli_hash()
        m._bundle_sources = lambda: {"itl": "a", "itl_mcp.py": "b", "itl_mcp_tools.py": "CHANGED"}
        after = m._cli_hash()
    finally:
        m._bundle_sources = real
    assert before != after


def test_cli_single_line_collapse():
    # 무확장자 CLI 라서 import 대신 exec 로 순수 함수만 뽑아 검증한다.
    import types
    src = open("cli/itl", encoding="utf-8").read()
    mod = types.ModuleType("itl_cli")
    exec(compile(src, "cli/itl", "exec"), mod.__dict__)
    assert mod._single_line("a\nb\r\nc\n\n  d  \n") == "a · b · c · d"
    assert mod._single_line("한 줄") == "한 줄"
    assert mod._single_line("\n\n") == ""


def test_cli_selfheals_from_tmux_session_env():
    # 구 pane 재현: ITL_* 없이 TMUX 만 있는 셸에서 모듈을 로드하면
    # tmux 세션 환경에서 값을 회복한다(주입 전에 켜진 프로세스의 발신 복구).
    import os
    import sys
    import types

    class _FakeCompleted:
        def __init__(self, out):
            self.stdout = out

    class _FakeSubprocess:
        @staticmethod
        def run(cmd, capture_output=True, text=True, timeout=None):
            assert cmd[:2] == ["tmux", "show-environment"], cmd
            fake_env = {
                "ITL_API": "ITL_API=http://100.1.2.3:38822\n",
                "ITL_TOKEN": "ITL_TOKEN=tok123\n",
                "ITL_SESSION": "ITL_SESSION=mobile-x\n",
            }
            return _FakeCompleted(fake_env.get(cmd[2], f"-{cmd[2]}\n"))

    src = open("cli/itl", encoding="utf-8").read()
    saved = {k: os.environ.pop(k) for k in ("ITL_API", "ITL_TOKEN", "ITL_SESSION") if k in os.environ}
    os.environ["TMUX"] = "/tmp/tmux-0/default,1,0"
    real_sub = sys.modules["subprocess"]
    sys.modules["subprocess"] = _FakeSubprocess
    try:
        mod = types.ModuleType("itl_cli_oldpane")
        exec(compile(src, "cli/itl", "exec"), mod.__dict__)
    finally:
        sys.modules["subprocess"] = real_sub
        os.environ.pop("TMUX", None)
        os.environ.update(saved)
    assert mod.TOKEN == "tok123"
    assert mod.API == "http://100.1.2.3:38822"
    assert mod.SESSION == "mobile-x"
    # TMUX 없는 셸(앱 밖)에서는 회복하지 않는다 — 토큰 없음 거부 유지.
    assert mod._from_tmux_env("ITL_TOKEN") == ""


async def test_remote_itl_token_names_its_host_and_generation():
    """🔐 원격 tmux env 의 토큰은 `tmux show-environment` 로 읽힌다. 어느 기계에서 나온
    것인지를 청구로 달아 둬야 **그 호스트 것만** 폐기할 수 있다(세대를 올려서).
    반경을 줄이는 게 아니다 — 배달은 허브가 자기 권한으로 하므로 기능은 그대로다."""
    manager = _FakeAuthManager("tok")

    async def fake_run(host, secrets, cmd, timeout=10, stdin_data=None):
        return "ITL_ENV_OK"

    orig_run, orig_ident, orig_mgr = sut.run_remote_cmd, sut.get_server_identity, sut.get_auth_manager
    sut.run_remote_cmd = fake_run
    sut.get_server_identity = AsyncMock(return_value={"ip_kind": "tailscale", "ip": "100.1.2.3"})
    sut.get_auth_manager = lambda: manager
    try:
        sut.forget_injected("host-7", "mobile-x")
        await sut.ensure_remote_itl_env(
            {"id": "host-7", "cred_epoch": 4, "use_remote_tmux": 1, "hostname": "box"},
            {}, "mobile-x", "jsh",
        )
    finally:
        sut.run_remote_cmd, sut.get_server_identity, sut.get_auth_manager = orig_run, orig_ident, orig_mgr

    assert manager.extra == {"host": "host-7", "epoch": 4}


async def test_a_local_style_host_without_a_generation_still_gets_a_token():
    """⚠️ 청구를 **필수**로 만들면 세대 컬럼이 아직 없는 호스트에서 itl 이 통째로 죽는다."""
    manager = _FakeAuthManager("tok")

    async def fake_run(host, secrets, cmd, timeout=10, stdin_data=None):
        return "ITL_ENV_OK"

    orig_run, orig_ident, orig_mgr = sut.run_remote_cmd, sut.get_server_identity, sut.get_auth_manager
    sut.run_remote_cmd = fake_run
    sut.get_server_identity = AsyncMock(return_value={"ip_kind": "tailscale", "ip": "100.1.2.3"})
    sut.get_auth_manager = lambda: manager
    try:
        sut.forget_injected("box", "mobile-y")
        ok = await sut.ensure_remote_itl_env(
            {"use_remote_tmux": 1, "hostname": "box"}, {}, "mobile-y", "jsh",
        )
    finally:
        sut.run_remote_cmd, sut.get_server_identity, sut.get_auth_manager = orig_run, orig_ident, orig_mgr

    assert ok is True
    assert manager.extra is None

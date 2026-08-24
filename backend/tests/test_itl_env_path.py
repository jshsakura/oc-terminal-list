"""itl 이 pane 의 PATH 에 있는가 — 이 앱의 핵심 기능이 걸린 한 줄.

CLI 는 백엔드와 함께 배포되므로 이미 이 기계에 있다. 그런데 아무의 PATH 에도 없어서,
저장소 경로를 아는 사람만 `python3 …/backend/cli/itl` 로 쓸 수 있었다. 설치 없이 그냥
되는 것이 이 기능의 전제라, 여기서 그 전제를 잠근다.

⚠️ 실측(tmux 3.4): pane 은 세션 환경의 `-e FOO=bar` 는 물려받지만 **PATH 는 물려받지
않는다** — `new-session -e` 도, `set-environment` 도, `set-environment -g` 도 아니다.
pane 이 무엇을 찾을 수 있는지는 **tmux 서버 프로세스의 환경**만이 정한다. 그래서 PATH 는
세션 env(itl_env)가 아니라 서버를 띄우는 자리(_tmux_env)에 있다. 이 두 테스트가 그
분업이 뒤집히지 않게 잡는다.
"""
from __future__ import annotations

import os

import itl_env
from tmux_manager import TmuxManager


class _FakeAuthManager:
    async def create_scoped_token(self, username: str, scope: str):
        assert scope == "itl"
        return "scoped.token.value"


async def test_session_env_carries_identity_only():
    """PATH 를 여기 넣으면 조용한 no-op 가 된다 — 넣지 않는 것이 계약이다."""
    orig = itl_env.get_auth_manager
    itl_env.get_auth_manager = lambda: _FakeAuthManager()
    try:
        env = await itl_env.build_itl_env("user", "sess-1")
    finally:
        itl_env.get_auth_manager = orig
    assert env["ITL_SESSION"] == "sess-1"
    assert env["ITL_TOKEN"] == "scoped.token.value"
    assert "PATH" not in env


def test_the_tmux_server_environment_carries_the_cli_directory():
    """pane 이 실제로 itl 을 찾는 통로 — 서버를 띄우는 환경.

    ⚠️ "맨 앞" 이 아니라 "PATH 항목으로 있다" 를 본다. 이 앱의 pane **안에서** 테스트를
    돌리면 PATH 에 이미 그 경로가 있고(우리가 넣은 것이다), 그러면 `_tmux_env` 는 옳게도
    중복 추가를 건너뛴다. startswith 로 재면 정작 기능이 동작하는 환경에서만 빨개진다.
    """
    env = TmuxManager()._tmux_env()
    # CLI_DIR 은 PosixPath 다 — str() 없이 비교하면 항상 빗나간다.
    assert str(itl_env.CLI_DIR) in env["PATH"].split(os.pathsep)


def test_the_backend_path_passes_through_untouched():
    """PATH 를 새로 짓지 않는다 — 항목을 더할 수는 있어도 뺄 수는 없어야 한다.

    직접 조립하면 nvm·pyenv 처럼 사용자가 기대하는 경로를 조용히 잃는다.
    """
    original = os.environ.get("PATH", "")
    env = TmuxManager()._tmux_env()
    assert env["PATH"].endswith(original)


def test_the_cli_this_points_at_actually_exists():
    """경로만 심고 파일이 없으면 'command not found' 가 도움말의 답이 된다."""
    assert (itl_env.CLI_DIR / "itl").exists()
    assert os.access(itl_env.CLI_DIR / "itl", os.X_OK)

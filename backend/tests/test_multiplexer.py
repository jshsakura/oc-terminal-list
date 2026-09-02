"""멀티플렉서는 선택이고, 안 골라도 터미널은 된다.

이 파일이 잠그는 것은 셋이다:
  1. 옛 행(`use_remote_tmux` 만 있는)이 새 코드에서 뜻이 안 바뀐다.
  2. 각 선택이 원격에서 **다른 명령**을 만든다 — herdr 를 골랐는데 tmux 가 뜨면 안 된다.
  3. 어느 선택이든 그 도구가 없으면 **평범한 셸로 떨어진다**(연결 자체가 실패하지 않는다).
"""
import multiplexer as mux
from host_manager import TMUX_SESSION_GONE_EXIT, _build_remote_command


class TestNormalize:
    def test_모르는_값은_기본으로_접는다(self):
        assert mux.normalize("zellij") == mux.TMUX
        assert mux.normalize(None) == mux.TMUX
        assert mux.normalize(123) == mux.TMUX

    def test_대소문자와_공백은_무시한다(self):
        assert mux.normalize("  HERDR ") == mux.HERDR

    def test_fallback_을_지정할_수_있다(self):
        assert mux.normalize("", fallback=mux.NONE) == mux.NONE


class TestPersists:
    def test_none_만_비영속이다(self):
        assert mux.persists(mux.TMUX)
        assert mux.persists(mux.HERDR)
        assert not mux.persists(mux.NONE)


class TestFromHostRow:
    def test_새_칸이_있으면_그것을_쓴다(self):
        assert mux.from_host_row({"multiplexer": "herdr", "use_remote_tmux": 1}) == mux.HERDR

    def test_옛_행의_꺼짐은_none_으로_되짚는다(self):
        assert mux.from_host_row({"use_remote_tmux": 0}) == mux.NONE

    def test_옛_행의_켜짐은_기본값이다(self):
        """옛 스키마에 herdr 라는 값은 존재조차 하지 않았다 — 되짚기는 끄기만 표현한다."""
        assert mux.from_host_row({"use_remote_tmux": 1}) == mux.TMUX

    def test_행이_없으면_기본값(self):
        assert mux.from_host_row(None) == mux.TMUX

    def test_새_칸이_옛_칸을_이긴다(self):
        """두 칸이 어긋난 행(옛 코드가 use_remote_tmux 만 갱신한 경우)에서도 뜻이 하나다."""
        assert mux.from_host_row({"multiplexer": "none", "use_remote_tmux": 1}) == mux.NONE


class TestRemoteCommand:
    """원격도 **묻지 말고 찾는다** — 한 번의 SSH 안에서 순서대로 본다.

    실측(ubuntu-lab): tmux 8개 · herdr 12개 · 겹치는 이름 8개 · herdr 에만 4개.
    설정 하나로 갈랐을 때 그 4개는 **보이지도 붙지도 않았고**, 탭 sanitize 가 "죽었다" 로
    읽어 그 탭들을 지웠다. 이 클래스가 그 재발을 막는다.
    """

    def test_tmux_가_잡고_있으면_tmux_로_붙는다(self):
        cmd = _build_remote_command(mux.HERDR, "mobile")   # 설정은 herdr 인데도
        assert "if command -v tmux >/dev/null 2>&1 && tmux has-session -t mobile" in cmd
        assert "exec tmux attach-session -t mobile" in cmd

    def test_herdr_가_잡고_있으면_herdr_로_붙는다(self):
        cmd = _build_remote_command(mux.TMUX, "mobile")    # 설정은 tmux 인데도
        assert "herdr session list --json" in cmd
        assert "exec herdr --session mobile" in cmd

    def test_겹치면_tmux_가_먼저다(self):
        """전환기에 두 번 만들어진 이름이 그 모양이고, 사람이 쓰던 쪽은 tmux 였다."""
        cmd = _build_remote_command(mux.HERDR, "mobile")
        assert cmd.index("tmux has-session") < cmd.index("herdr session list")

    def test_아무도_없으면_설정된_것으로_새로_만든다(self):
        """설정의 역할은 여기 하나뿐이다."""
        tmux_cmd = _build_remote_command(mux.TMUX, "mobile")
        assert "new-session -d -s mobile" in tmux_cmd
        herdr_cmd = _build_remote_command(mux.HERDR, "mobile")
        assert "new-session -d -s mobile" not in herdr_cmd
        # else 가지가 herdr 생성으로 끝난다
        assert herdr_cmd.rsplit("else", 1)[1].count("exec herdr --session mobile") == 1

    def test_none_은_탐색하지_않는다(self):
        """붙잡지 말라고 **일부러 고른 값**이다 — 남아 있던 세션에 슬그머니 붙으면 안 된다."""
        assert _build_remote_command(mux.NONE, "mobile") is None
        cmd = _build_remote_command(mux.NONE, "mobile", "/srv/app")
        assert cmd == "cd /srv/app 2>/dev/null; exec ${SHELL:-bash} -l"
        assert "has-session" not in cmd and "herdr" not in cmd

    def test_어느_쪽도_없으면_셸로_떨어진다(self):
        """떨어지는 것 자체는 사고가 아니다. 연결이 실패하는 것이 사고다."""
        for choice in (mux.TMUX, mux.HERDR):
            cmd = _build_remote_command(choice, "mobile")
            assert "exec ${SHELL:-bash} -l" in cmd, choice

    def test_설치_경로를_PATH_에_얹는다(self):
        """installer 가 ~/.local/bin 에 넣는데 비대화형 SSH 셸에는 그게 없다."""
        for choice in (mux.TMUX, mux.HERDR):
            assert 'PATH="$HOME/.local/bin:$PATH"' in _build_remote_command(choice, "mobile")

    def test_재접속은_없는_세션을_새로_만들지_않는다(self):
        """`create=0` 은 "이어붙기만" 이다. 둘 다 없으면 약속된 코드로 죽어야
        프론트가 `session-gone` → `create=1` 로 전환한다."""
        for choice in (mux.TMUX, mux.HERDR):
            cmd = _build_remote_command(choice, "mobile", create_session=False)
            assert f"exit {TMUX_SESSION_GONE_EXIT}" in cmd
            assert "new-session -d" not in cmd
            # 그래도 **붙는 것**은 여전히 시도한다 — 살아 있으면 이어 붙어야 한다.
            assert "tmux has-session" in cmd and "herdr session list" in cmd

    def test_불리언_옛_호출부도_그대로_받는다(self):
        assert "tmux attach-session" in _build_remote_command(True, "mobile")
        assert _build_remote_command(False, "mobile") is None

    def test_세션명은_셸에_그대로_넘어가지_않는다(self):
        """모델이 이미 막지만, 명령 조립도 스스로 인용한다(방어선은 둘이어야 한다)."""
        cmd = _build_remote_command(mux.HERDR, "a b; rm -rf /")
        assert "'a b; rm -rf /'" in cmd

    def test_만들어진_셸이_문법적으로_유효하다(self):
        """if/elif/else 를 문자열로 짜므로, 한 조각만 어긋나도 조용히 안 붙는다."""
        import subprocess
        for choice in (mux.TMUX, mux.HERDR):
            for create in (True, False):
                cmd = _build_remote_command(choice, "mobile", "/srv/app", create_session=create)
                r = subprocess.run(["bash", "-n", "-c", cmd], capture_output=True, text=True)
                assert r.returncode == 0, f"{choice}/{create}: {r.stderr}"


class TestItlKeyStamp:
    def test_원격_tmux_세션에_열쇠를_새긴다(self):
        cmd = _build_remote_command(mux.TMUX, "mobile", itl_pane_key="abc123")
        assert "set-option -t mobile @itl_key abc123" in cmd

    def test_열쇠가_없으면_옵션도_없다(self):
        assert "@itl_key" not in _build_remote_command(mux.TMUX, "mobile")

    def test_열쇠는_셸_인용을_지난다(self):
        cmd = _build_remote_command(mux.TMUX, "mobile", itl_pane_key="a b")
        assert "@itl_key 'a b'" in cmd

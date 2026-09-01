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
    def test_tmux_는_tmux_에_붙는다(self):
        cmd = _build_remote_command(mux.TMUX, "mobile")
        # 안전한 이름은 shlex.quote 가 따옴표 없이 그대로 둔다.
        assert "exec tmux attach-session -t mobile" in cmd
        assert "herdr" not in cmd

    def test_herdr_는_herdr_에_붙는다(self):
        cmd = _build_remote_command(mux.HERDR, "mobile")
        assert "exec herdr --session mobile" in cmd
        # tmux 옵션 뭉치가 herdr 명령에 새어 들어가면 안 된다 — 그건 tmux 의 설정 이름이다.
        assert "tmux " not in cmd

    def test_none_은_그냥_로그인_셸이다(self):
        assert _build_remote_command(mux.NONE, "mobile") is None
        cmd = _build_remote_command(mux.NONE, "mobile", "/srv/app")
        assert cmd == "cd /srv/app 2>/dev/null; exec ${SHELL:-bash} -l"

    def test_어느_선택이든_도구가_없으면_셸로_떨어진다(self):
        """떨어지는 것 자체는 사고가 아니다. 연결이 실패하는 것이 사고다."""
        for choice in (mux.TMUX, mux.HERDR):
            cmd = _build_remote_command(choice, "mobile")
            assert cmd.rstrip().endswith("exec ${SHELL:-bash} -l"), choice
            assert f"command -v {choice} >/dev/null 2>&1 &&" in cmd

    def test_herdr_는_설치_경로를_PATH_에_얹는다(self):
        """installer 가 ~/.local/bin 에 넣는데 비대화형 SSH 셸에는 그게 없다."""
        cmd = _build_remote_command(mux.HERDR, "mobile")
        assert 'PATH="$HOME/.local/bin:$PATH"' in cmd

    def test_herdr_재접속은_없는_세션을_새로_만들지_않는다(self):
        """create=0 은 "이어붙기만" 이다. herdr 는 --session 하나로 생성까지 하므로
        목록을 먼저 봐야 한다."""
        cmd = _build_remote_command(mux.HERDR, "mobile", create_session=False)
        assert "herdr session list --json" in cmd
        assert f"exit {TMUX_SESSION_GONE_EXIT}" in cmd

    def test_none_재접속은_이어붙을_대상이_없다고_말한다(self):
        cmd = _build_remote_command(mux.NONE, "mobile", create_session=False)
        assert f"exit {TMUX_SESSION_GONE_EXIT}" in cmd

    def test_불리언_옛_호출부도_그대로_받는다(self):
        """옛 호출부/테스트가 넘기던 True/False. 조용히 뜻이 바뀌면 안 된다."""
        assert "tmux attach-session" in _build_remote_command(True, "mobile")
        assert _build_remote_command(False, "mobile") is None

    def test_세션명은_셸에_그대로_넘어가지_않는다(self):
        """모델이 이미 막지만, 명령 조립도 스스로 인용한다(방어선은 둘이어야 한다)."""
        cmd = _build_remote_command(mux.HERDR, "a b; rm -rf /")
        assert "'a b; rm -rf /'" in cmd

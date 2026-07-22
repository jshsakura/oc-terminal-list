"""알림에 넣을 화면 발췌 — LLM 없이 구조만 보고 고른다.

샘플은 실제 돌고 있던 claude 세션의 `capture-pane -p` 출력이다.
"""
from pane_excerpt import MAX_LINES, extract_excerpt

CLAUDE_SCREEN = """여쭤보지 않고 즉시 재시작한 건, 제가 만든 라이브 장애를 멈추는 조치였기
  때문입니다. 다음부턴 이런 계약 변경 시 프론트 빌드보다 백엔드 재시작을
  먼저 하도록 메모해뒀습니다.
✻ Sautéed for 11m 59s
※ recap: K패치 스타 관리자 통계 페이지와 홈 화면 응원 랭킹 페이지네이션
  작업을 마쳤고 라이브에 반영·재시작까지 끝냈습니다. 다음 할 일은 없고,
  로그인해서 화면이 의도대로 보이는지 확인해주시면 됩니다.
─────────────────────────────────────────────────────────────────────────
❯
─────────────────────────────────────────────────────────────────────────
   Sonnet 5 notebooks [██░░░░░░░░] 26% | 5h 4% (22:30) | 7d 39% (13:00)…
  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← 3 agents
"""


def test_drops_the_input_box_and_statusline():
    """화면 마지막 줄을 그대로 쓰면 입력 상자와 상태바가 나온다 — 그게 문제였다."""
    out = extract_excerpt(CLAUDE_SCREEN)
    assert "bypass permissions" not in out
    assert "█" not in out
    assert "─────" not in out
    assert "❯" not in out


def test_keeps_the_actual_last_message():
    out = extract_excerpt(CLAUDE_SCREEN)
    assert "확인해주시면 됩니다" in out          # 진짜 마지막 내용
    assert out.count("\n") < MAX_LINES          # 몇 줄만


def test_plain_shell_output_is_kept_as_is():
    """일반 셸은 장식이 없다 — 마지막 줄들이 곧 내용이다."""
    out = extract_excerpt("$ npm test\n\n  47 passing\n  2 failing\n")
    assert "47 passing" in out and "2 failing" in out


def test_empty_or_chrome_only_screen_yields_nothing():
    """건질 게 없으면 빈 문자열 — 알림에 테두리만 실어 보내면 안 된다."""
    assert extract_excerpt("") == ""
    assert extract_excerpt("\n\n   \n") == ""
    assert extract_excerpt("──────\n❯\n──────\n") == ""


def test_long_lines_are_capped():
    out = extract_excerpt("x" * 500)
    assert len(out) <= 100


def test_long_screen_keeps_the_newest_lines():
    """앞을 자른다 — 마지막 줄이 가장 최근이라 더 중요하다."""
    screen = "\n".join(f"line {i}" for i in range(50))
    out = extract_excerpt(screen)
    assert "line 49" in out
    assert "line 0" not in out


def test_interleaved_dividers_are_removed():
    """구분선이 중간에 껴 있어도 발췌가 테두리로 채워지면 안 된다."""
    out = extract_excerpt("결과 A\n────────\n결과 B\n────────\n결과 C\n")
    assert "────" not in out
    assert "결과 C" in out

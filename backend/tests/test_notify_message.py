"""알림 본문 조립 — 훑을 수 있어야 하고, 빈 항목이 늘어지면 안 된다."""
from notify_message import build_done_message, format_duration, summarize_others


def test_duration_reads_like_a_person_wrote_it():
    assert format_duration(45) == "45초"
    assert format_duration(60) == "1분"
    assert format_duration(90) == "1분 30초"
    assert format_duration(3600) == "1시간"
    assert format_duration(3900) == "1시간 5분"


def test_duration_unknown_is_empty():
    for bad in (None, 0, -5):
        assert format_duration(bad) == ""


def test_full_message_has_every_piece():
    out = build_done_message(
        label="1.1 · web", command="claude", title="메모리 분석",
        cwd="~/app/proj", host="ubuntu-ai", duration_seconds=719,
        excerpt="테스트 47개 통과", others="⚙️ 작업중 2",
    )
    for needle in ("1.1 · web", "claude", "11분 59초", "ubuntu-ai",
                   "~/app/proj", "메모리 분석", "테스트 47개 통과", "작업중 2"):
        assert needle in out, needle


def test_missing_pieces_leave_no_empty_lines():
    """값이 없는 항목까지 자리를 차지하면 훑을 수가 없다."""
    out = build_done_message(label="1.1", command="claude")
    assert "📁" not in out and "💬" not in out and "⏱" not in out
    assert "\n\n" not in out


def test_falls_back_when_nothing_is_known():
    assert build_done_message() == "✅ 작업 완료"


def test_summarize_others_excludes_self():
    snap = {
        "me": {"status": "idle"},
        "a": {"status": "working"},
        "b": {"status": "working"},
        "c": {"status": "permission"},
        "d": {"status": None},          # 에이전트가 아닌 셸
    }
    out = summarize_others(snap, "me")
    assert "작업중 2" in out and "대기 1" in out
    assert "유휴" not in out            # me 를 뺐으니 유휴는 0


def test_summarize_others_empty_when_alone():
    assert summarize_others({"me": {"status": "idle"}}, "me") == ""
    assert summarize_others({}, "me") == ""


def test_cwd_is_not_repeated_when_it_equals_the_tab_name():
    """탭 이름은 대개 폴더명에서 나온다 — 그대로 두면 같은 문자열이 두 번 찍힌다."""
    out = build_done_message(label="1.1 · game-and-watch", cwd="game-and-watch")
    assert out.count("game-and-watch") == 1
    assert "📁" not in out


def test_cwd_is_kept_when_it_adds_information():
    out = build_done_message(label="1.1 · web", cwd="~/projects/api")
    assert "📁 ~/projects/api" in out


def test_cwd_tail_matching_the_tab_name_is_dropped():
    """경로 전체는 달라도 마지막 조각이 탭 이름이면 새 정보가 아니다."""
    out = build_done_message(label="1.1 · myapp", cwd="/home/me/src/myapp")
    assert "📁" not in out


def test_title_is_not_repeated_when_the_excerpt_already_shows_it():
    out = build_done_message(title="빌드 완료", excerpt="빌드 완료\n47 passing")
    assert out.count("빌드 완료") == 1
    assert "💬" not in out

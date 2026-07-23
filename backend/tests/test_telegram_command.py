"""텔레그램 메시지 파싱 — 폰에서 친 것을 주소와 본문으로 가른다."""
import pytest

from telegram_command import parse_command


@pytest.mark.parametrize("text,addr,body", [
    ("1.1 테스트 다시 돌려봐", "1.1", "테스트 다시 돌려봐"),
    ("1.1  여러  공백  보존", "1.1", "여러  공백  보존"),
    ("3 재시작", "3", "재시작"),
    ("2:4 npm run build", "2:4", "npm run build"),
    ("@claude 오늘 작업 커밋해", "@claude", "오늘 작업 커밋해"),
    ("@backend.2 로그 확인", "@backend.2", "로그 확인"),
    ("@working 상태 보고해", "@working", "상태 보고해"),
])
def test_parses_address_and_body(text, addr, body):
    assert parse_command(text) == (addr, body)


@pytest.mark.parametrize("text,addr,body", [
    ("/r 1.1 재시작", "1.1", "재시작"),
    ("/run @claude 커밋", "@claude", "커밋"),
    ("/send 2.2 ls -al", "2.2", "ls -al"),
])
def test_slash_prefix_is_optional(text, addr, body):
    """텔레그램이 /명령 을 특별 취급하니 흔한 접두사는 벗겨준다."""
    assert parse_command(text) == (addr, body)


@pytest.mark.parametrize("text", [
    "",
    "   ",
    "그냥 봇한테 하는 말",          # 주소 없음 → 어디로 보낼지 모른다
    "안녕하세요",
    "1.1",                          # 주소만, 본문 없음
    "@claude",
    "/r 1.1",                       # 슬래시+주소만, 본문 없음
])
def test_returns_none_when_not_a_command(text):
    """주소가 없거나 본문이 없으면 아무 pane 에도 흘려보내지 않는다."""
    assert parse_command(text) is None


def test_body_can_start_with_special_chars():
    """본문에 코드/명령이 그대로 들어갈 수 있어야 한다 — 자유 입력이 목적이다."""
    assert parse_command("1.1 git commit -m 'fix: 버그'") == ("1.1", "git commit -m 'fix: 버그'")
    assert parse_command("2.1 echo $HOME && ls") == ("2.1", "echo $HOME && ls")


def test_second_token_that_looks_like_address_stays_in_body():
    """주소는 첫 토큰만. 본문 안의 숫자는 건드리지 않는다."""
    assert parse_command("1.1 3번 항목 확인") == ("1.1", "3번 항목 확인")

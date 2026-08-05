"""원격 watcher 조회 — 셸을 거치면서 조용히 깨지는 지점들.

여기서 틀리면 에러가 안 나고 **빈 응답**이 돌아온다. 그러면 "이 호스트엔 watcher 가
없다" 로 오진하고 대시보드에서 그 호스트가 통째로 사라진다. 실제로 밟았다.
"""
import pytest

from llm_usage.client import (
    WatcherUnavailable,
    _parse_json_body,
    build_remote_fetch_cmd,
)


def test_query_string_is_quoted_so_the_shell_cannot_eat_it():
    """`&` 는 셸에서 백그라운드 실행이다. 안 감싸면 URL 이 잘려 빈 응답이 온다."""
    cmd = build_remote_fetch_cmd("/api/sessions?limit=40&days=30")
    assert "'http://127.0.0.1:34318/api/sessions?limit=40&days=30'" in cmd
    # 따옴표 밖에 맨몸 & 가 남아 있으면 안 된다 (|| 의 파이프는 허용).
    outside = cmd.replace("'http://127.0.0.1:34318/api/sessions?limit=40&days=30'", "")
    assert "&" not in outside


def test_falls_back_to_wget_when_curl_is_missing():
    cmd = build_remote_fetch_cmd("/api/health")
    assert cmd.index("curl") < cmd.index("||") < cmd.index("wget")


def test_port_is_configurable_but_always_loopback():
    """원격에 새 포트를 열지 않는다 — 언제나 그 호스트의 127.0.0.1 로만 간다."""
    cmd = build_remote_fetch_cmd("/api/health", port=9999)
    assert "http://127.0.0.1:9999/api/health" in cmd
    assert "0.0.0.0" not in cmd


def test_motd_and_shell_noise_before_the_json_is_skipped():
    """SSH stdout 은 배너와 섞일 수 있다. 첫 `{` 부터가 우리 것."""
    body = _parse_json_body('Welcome to Ubuntu!\nLast login: ...\n{"totals": {"cost": 1}}', "x")
    assert body["totals"]["cost"] == 1


def test_empty_response_is_an_explicit_failure_not_an_empty_dict():
    with pytest.raises(WatcherUnavailable):
        _parse_json_body("", "x")


def test_empty_response_can_say_what_it_actually_means():
    """빈 응답은 사실상 "거기 watcher 가 없다" 다. 화면에 그 말이 떠야 한다."""
    with pytest.raises(WatcherUnavailable, match="llm-watcher 가 없습니다"):
        _parse_json_body("", "some-host", empty_hint="이 호스트에 llm-watcher 가 없습니다")


def test_non_json_response_is_an_explicit_failure():
    with pytest.raises(WatcherUnavailable):
        _parse_json_body("404 not found", "x")


def test_json_list_is_rejected_because_callers_index_by_key():
    with pytest.raises(WatcherUnavailable):
        _parse_json_body("[1, 2, 3]", "x")

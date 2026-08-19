"""실행 중 보드가 기대는 두 가지: 한 호스트에 한 번만 가고, **모르는 것을 모른다고 적는다.**

두 번째가 이 저장소가 이미 한 번 대가를 치른 규칙이다 — 원격 pane 의 빈 상태를 만족으로
읽는 바람에 에이전트의 기다림이 0 초에 "완료" 를 돌려줬다. 화면도 같은 실수를 하면
"못 닿은 기계" 가 "한가한 기계" 로 보인다.
"""
from __future__ import annotations

from itl_remote import SNAPSHOT_MARK, build_snapshot_cmd, parse_machine, parse_snapshot
from routes.fleet import apply_snapshot


def _out(panes: str, sessions: str, machine: str) -> str:
    return f"{panes}\n{SNAPSHOT_MARK}\n{sessions}\n{SNAPSHOT_MARK}\n{machine}"


def test_one_round_trip_carries_everything():
    cmd = build_snapshot_cmd()
    assert "list-panes" in cmd and "list-sessions" in cmd
    assert "/proc/uptime" in cmd and "/proc/meminfo" in cmd
    # 한 명령이다 — 화면 하나에 SSH 를 세 번 걸면 호스트가 늘수록 그만큼 곱해진다.
    assert cmd.count("ssh") == 0


def test_sections_are_parsed_apart():
    parsed = parse_snapshot(_out(
        "s1\tclaude\t✳ 고치는 중\ns2\tbash\t~",
        "s1\t1755500000\ns2\t1755000000",
        "864000.00 100.0\nMemTotal:       8000000 kB\nMemAvailable:    2000000 kB\nCPUS 4",
    ))
    assert parsed["sessions"]["s1"][0] == "claude"
    assert parsed["started"]["s1"] == 1755500000
    assert parsed["machine"]["cpus"] == 4
    assert parsed["machine"]["mem_total"] == 8000000 * 1024
    assert parsed["machine"]["mem_used"] == 6000000 * 1024
    assert parsed["machine"]["uptime_seconds"] == 864000.0


def test_machine_lines_can_never_be_read_as_sessions():
    """마커 뒤는 다른 이야기다. 안 끊으면 `MemTotal:` 줄이 세션 이름이 된다."""
    parsed = parse_snapshot(_out("s1\tbash\t~", "s1\t1", "MemTotal: 100 kB"))
    assert list(parsed["sessions"]) == ["s1"]


def test_a_host_without_proc_reports_no_machine():
    """macOS·BSD 는 /proc 이 없다. 0% 로 그리면 측정한 것처럼 보인다."""
    assert parse_machine("") is None
    parsed = parse_snapshot(_out("s1\tbash\t~", "s1\t1", ""))
    assert parsed["machine"] is None
    assert parsed["sessions"]["s1"][0] == "bash"


def test_unreachable_host_stays_unknown():
    target = {"tmuxSession": "s1", "statusUnknown": True}
    out = apply_snapshot(target, {"reachable": False})
    assert out["statusUnknown"] is True
    assert "status" not in out or out.get("status") is None


def test_answered_host_with_a_missing_session_is_gone_not_unknown():
    out = apply_snapshot({"tmuxSession": "s9"}, {"reachable": True, "sessions": {"s1": ("bash", "~")}})
    assert out["statusGone"] is True
    assert out["statusUnknown"] is False


def test_answered_host_fills_status_and_start_time():
    out = apply_snapshot(
        {"tmuxSession": "s1"},
        {"reachable": True, "sessions": {"s1": ("claude", "✳ working")}, "started": {"s1": 1755500000}},
    )
    assert out["statusUnknown"] is False
    assert out["command"] == "claude"
    assert out["startedAt"] == 1755500000


def test_the_route_holds_the_singletons_not_the_modules():
    """`system_monitor.get_stats` 는 **인스턴스** 메서드다.

    모듈을 import 해서 같은 이름으로 부르면 AttributeError 가 나는데, 이 라우트는 그것을
    "수치를 못 구했다" 로 삼켜 버린다 — 화면에는 로컬 기계의 램·가동시간이 통째로 빈 채로
    나오고 아무 데도 에러가 없다. 실제로 그렇게 배포됐었다.
    """
    from routes import fleet
    assert callable(getattr(fleet.system_monitor, "get_stats", None))
    assert callable(getattr(fleet.tmux_manager, "list_sessions", None))

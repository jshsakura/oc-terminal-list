"""itl — 팬 사이로 말을 옮기는 단일 파일 CLI.

여기서 잠그는 것은 셋이다.

1. **에이전트 상태 판정이 나머지 두 사본과 갈라지지 않는다.** 규칙은 stablyai/orca 에서
   왔고 이 저장소에 이미 `backend/agent_status.py` · `frontend/utils/agentTitle.js` 로
   두 벌 있다. itl 은 stdin 으로 밀 수 있어야 해서 import 를 못 하고, 그래서 **세 번째
   사본**이다 — 사본이 늘어난 만큼 규율도 같이 와야 한다. 판정 케이스의 단일 진실
   공급원은 여전히 `shared/agent-title-cases.json` 이고, 이 파일이 그 표로 itl 을 친다.

2. **상태는 타이틀에서만 판정한다.** tmux 는 상태를 모른다 — `unify_status` 는 그
   판정 하나로 접힌다.

3. **모호한 주소는 고르지 않는다.** 하나를 골라 주면 "그 중 하나" 에 명령이 들어가고,
   잘못 들어간 것을 되돌릴 방법이 없다.

⚠️ 실제 tmux 는 띄우지 않는다 — 파싱과 판정만 순수 함수로 친다.
"""
from __future__ import annotations

import importlib.machinery
import importlib.util
import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
ITL_PATH = REPO / "backend" / "cli" / "itl"
CASES_PATH = REPO / "shared" / "agent-title-cases.json"


def _load_itl():
    """확장자가 없는 실행 스크립트라 평범한 import 가 안 된다.

    `.py` 가 아니면 `spec_from_file_location` 이 로더를 못 고르고 None 을 낸다 —
    SourceFileLoader 를 직접 준다. (확장자를 붙이면 이 번거로움은 사라지지만, 그러면
    `itl` 이 아니라 `itl.py` 를 치게 된다.)
    """
    loader = importlib.machinery.SourceFileLoader("itl_cli", str(ITL_PATH))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


itl = _load_itl()


def _status_cases():
    data = json.loads(CASES_PATH.read_text(encoding="utf-8"))
    cases = data.get("status")
    # ⚠️ 표가 비었는데 통과하면 이 테스트는 아무것도 안 지키면서 초록불만 준다.
    assert isinstance(cases, list) and cases, "공유 케이스 표가 비었다 — 경로가 낡았다"
    return cases


class TestStatusMatchesSharedTable:
    def test_표가_실제로_실려_있다(self):
        assert len(_status_cases()) >= 5

    @pytest.mark.parametrize("case", _status_cases(), ids=lambda c: (c.get("why") or c["title"])[:40])
    def test_공유_케이스_그대로_판정한다(self, case):
        got = itl.detect_status(case["title"])
        assert got == case["expect"], (
            f"{case['title']!r} → {got!r}, 표는 {case['expect']!r} "
            f"({case.get('why', '')})\n"
            "shared/agent-title-cases.json 을 보고 세 사본을 함께 고칠 것."
        )


class TestUnifiedVocabulary:
    def test_멀티플렉서_상태는_무시하고_타이틀에_묻는다(self):
        """옛 `mux_status` 자리에 무엇이 와도 판정은 타이틀이다."""
        assert itl.unify_status("blocked", "✳ 정리 중") == "idle"
        assert itl.unify_status("unknown", "⠼ 빌드") == "working"

    def test_아무_증거도_없으면_빈_문자열(self):
        """0 이나 'idle' 로 채우면 **모른다는 사실이 사라진다** — 이 저장소의 규칙."""
        assert itl.unify_status("unknown", "zsh") == ""
        assert itl.unify_status("", "") == ""

    def test_tmux_는_타이틀만으로_판정된다(self):
        raw = "%0\tsess-a\t0.0\tclaude\t/home/u\t✳ 메모리 정리"
        panes = itl.parse_tmux_panes(raw, "/tmp/sock")
        assert panes[0]["status"] == "idle"
        assert panes[0]["mux"] == "tmux"


class TestParseTmux:
    def test_타이틀_안의_탭은_흡수된다(self):
        """타이틀이 **마지막**이어야 성립한다 — 순서를 바꾸면 조용히 깨진다."""
        raw = "%1\tsess\t0.1\tzsh\t/home/u\ta\tb\tc"
        panes = itl.parse_tmux_panes(raw, "/s")
        assert len(panes) == 1
        assert panes[0]["title"] == "a\tb\tc"

    def test_짧은_줄과_빈_줄은_버린다(self):
        assert itl.parse_tmux_panes("\n\nbroken\n", "/s") == []

    def test_주소는_세션과_네이티브id_다(self):
        panes = itl.parse_tmux_panes("%2\tsess\t0.2\tzsh\t/h\t—", "/s")
        assert panes[0]["addr"] == "sess:%2"


class TestResolve:
    PANES = [
        itl.pane_record("tmux", "/s", "alpha", "%0", agent="claude"),
        itl.pane_record("tmux", "/h", "beta", "%1", agent="codex"),
        itl.pane_record("tmux", "/h", "beta", "%2", agent="codex"),
    ]

    def test_정확한_주소(self):
        pane, why = itl.resolve(self.PANES, "beta:%2")
        assert pane["native_id"] == "%2" and not why

    def test_팬이_하나뿐인_세션은_이름만으로(self):
        """앱이 만드는 모양이 정확히 이것이다 — 세션 하나에 팬 하나."""
        pane, why = itl.resolve(self.PANES, "alpha")
        assert pane["addr"] == "alpha:%0" and not why

    def test_에이전트_이름이_유일하면_그것으로(self):
        pane, why = itl.resolve(self.PANES, "claude")
        assert pane["addr"] == "alpha:%0" and not why

    def test_모호하면_고르지_않고_후보를_준다(self):
        pane, why = itl.resolve(self.PANES, "beta")
        assert pane is None
        assert "beta:%1" in why and "beta:%2" in why

    def test_에이전트가_여럿이어도_고르지_않는다(self):
        pane, why = itl.resolve(self.PANES, "codex")
        assert pane is None and "여럿" in why

    def test_앱_탭번호를_이_기계에서_바로_푼다(self):
        """**백엔드도 브라우저도 없이** 옆 탭에 말을 걸 수 있어야 한다.

        표식 경로(백엔드 브리지)는 브라우저가 그 팬을 보고 있을 때만 돈다 — 자율로 도는
        에이전트에게는 정확히 그때가 아니다. tmux 가 `@pane_addr` 로 주소를 들고 있으므로
        같은 기계 안이면 여기서 끝난다.
        """
        panes = [
            itl.pane_record("tmux", "/s", "sess-a", "%0"),
            itl.pane_record("tmux", "/s", "sess-b", "%1"),
        ]
        panes[1]["app_addr"] = "2.1"
        pane, why = itl.resolve(panes, "2.1")
        assert pane["addr"] == "sess-b:%1" and not why

    def test_앱_주소가_겹치면_고르지_않는다(self):
        panes = [itl.pane_record("tmux", "/s", f"s{i}", f"%{i}") for i in range(2)]
        for pane in panes:
            pane["app_addr"] = "1.1"
        got, why = itl.resolve(panes, "1.1")
        assert got is None and "여럿" in why

    def test_이_기계에_없는_앱_주소는_못_푼다(self):
        """못 푸는 것이 맞다 — 그때 백엔드에게 넘긴다(다른 기계일 수 있다)."""
        panes = [itl.pane_record("tmux", "/s", "sess-a", "%0")]
        assert itl.resolve(panes, "7.3")[0] is None

    def test_없으면_없다고_한다(self):
        pane, why = itl.resolve(self.PANES, "nope")
        assert pane is None and "없다" in why

    def test_빈_주소(self):
        assert itl.resolve(self.PANES, "")[0] is None


class TestWhoami:
    PANES = [
        itl.pane_record("tmux", "/s", "alpha", "%3"),
    ]

    def test_tmux_는_소켓까지_맞아야_한다(self, monkeypatch):
        """`%0` exists on every tmux server; the app socket and the default socket both have one."""
        monkeypatch.setenv("TMUX", "/tmp/tmux-1000/app,1,0")
        monkeypatch.setenv("TMUX_PANE", "%0")
        mine = dict(mux=itl.TMUX, socket="/tmp/tmux-1000/app", session="s", native_id="%0", addr="s:%0")
        other = dict(mux=itl.TMUX, socket="/tmp/tmux-1000/default", session="d", native_id="%0", addr="d:%0")
        assert itl.whoami([other, mine]) is mine

    def test_tmux_만_있으면_tmux_팬(self, monkeypatch):
        monkeypatch.delenv("TMUX", raising=False)          # no socket to match against
        monkeypatch.setenv("TMUX_PANE", "%3")
        assert itl.whoami(self.PANES)["addr"] == "alpha:%3"

    def test_tmux_밖이면_None(self, monkeypatch):
        monkeypatch.delenv("TMUX_PANE", raising=False)
        assert itl.whoami(self.PANES) is None


class TestTmuxAccessFailure:
    def test_current_socket_does_not_require_directory_access(self, monkeypatch):
        monkeypatch.setenv("TMUX", "/private/app.sock,123,0")
        monkeypatch.setattr(itl.os, "listdir", lambda path: pytest.fail("known socket must not enumerate directories"))
        assert itl.tmux_sockets() == ["/private/app.sock"]

    def test_stale_whoami_reports_context_error(self, monkeypatch, capsys):
        monkeypatch.setenv("TMUX", "/private/app.sock,123,0")
        monkeypatch.setenv("TMUX_PANE", "%0")
        monkeypatch.setattr(itl, "discover", lambda: [itl.pane_record(itl.TMUX, "/private/app.sock", "s", "%1")])
        assert itl.main(["--json", "whoami"]) == 3
        result = json.loads(capsys.readouterr().out)
        assert result["errorCode"] == "tmux_context_stale"
        assert result["retryable"] is False
        assert "sandbox-config" not in result["error"]

    def test_stale_key_lookup_never_reads_another_session_key(self, monkeypatch):
        monkeypatch.setenv("TMUX", "/private/app.sock,123,0")
        monkeypatch.setenv("TMUX_PANE", "%0")
        calls = []

        def run(argv, **kwargs):
            calls.append(argv)
            return (0, "%1\n", "") if "list-panes" in argv else (0, "another-session-key", "")

        monkeypatch.setattr(itl, "tmux_bin", lambda: "/usr/bin/tmux")
        monkeypatch.setattr(itl, "run", run)
        with pytest.raises(itl.TmuxContextError):
            itl.my_key()
        assert len(calls) == 1 and "list-panes" in calls[0]

    def test_denied_receipt_does_not_wait(self, monkeypatch, capsys):
        monkeypatch.setenv("TMUX", "/private/app.sock,123,0")
        monkeypatch.setenv("TMUX_PANE", "%0")
        calls = []
        monkeypatch.setattr(itl, "tmux_bin", lambda: "/usr/bin/tmux")
        monkeypatch.setattr(itl, "run", lambda argv, **kw: calls.append(argv) or (1, "", "Operation not permitted"))
        assert itl.main(["--json", "receipt", "abcd1234", "--wait", "90"]) == 3
        result = json.loads(capsys.readouterr().out)
        assert result["errorCode"] == "tmux_socket_denied"
        assert result["delivery"] == "unknown"
        assert not any("wait-for" in argv for argv in calls)

    def test_denied_receipt_query_after_valid_context_does_not_wait(self, monkeypatch):
        monkeypatch.setenv("TMUX", "/private/app.sock,123,0")
        monkeypatch.setenv("TMUX_PANE", "%0")
        monkeypatch.setattr(itl, "tmux_bin", lambda: "/usr/bin/tmux")
        calls = []

        def run(argv, **kwargs):
            calls.append(argv)
            return (0, "%0\n", "") if "list-panes" in argv else (1, "", "Permission denied")

        monkeypatch.setattr(itl, "run", run)
        with pytest.raises(itl.TmuxAccessError):
            itl.receipt("abcd1234", timeout=90)
        assert not any("wait-for" in argv for argv in calls)

    def test_socket_selection_never_falls_back_to_another_server(self, monkeypatch, capsys):
        monkeypatch.setattr(itl, "discover_tmux", lambda *a, **kw: [])
        monkeypatch.setattr(itl, "send_app_addr", lambda *a, **kw: pytest.fail("explicit namespace must be preserved"))
        assert itl.main(["--json", "--socket", "/private/app.sock", "send", "2.1", "hi"]) == 2
        assert json.loads(capsys.readouterr().out)["ok"] is False

    def test_handoff_followed_by_permission_failure_preserves_unknown_delivery(self, monkeypatch, capsys):
        monkeypatch.setattr(itl, "discover", lambda: [])
        monkeypatch.setattr(itl, "send_app_addr", lambda *a, **kw: (True, ""))

        def denied(*args, **kwargs):
            raise itl.TmuxAccessError("Permission denied")

        monkeypatch.setattr(itl, "receipt", denied)
        assert itl.main(["--json", "send", "2.1", "hi"]) == 4
        result = json.loads(capsys.readouterr().out)
        assert result["handedOff"] is True and result["delivery"] == "unknown"
        assert result["retryable"] is False

    def test_socketless_duplicate_pane_ids_do_not_guess_identity(self, monkeypatch):
        monkeypatch.setenv("TMUX_PANE", "%0")
        panes = [itl.pane_record(itl.TMUX, socket, "s", "%0") for socket in ["/a", "/b"]]
        assert itl.whoami(panes) is None

    def test_socket_option_limits_target_discovery(self, monkeypatch, capsys):
        monkeypatch.setattr(itl, "tmux_bin", lambda: "/usr/bin/tmux")
        monkeypatch.setattr(itl, "tmux_sockets", lambda: pytest.fail("explicit socket must not scan other servers"))
        calls = []
        monkeypatch.setattr(itl, "run", lambda argv, **kw: calls.append(argv) or (0, "", ""))
        assert itl.main(["--json", "--socket", "/private/app.sock", "list"]) == 0
        assert json.loads(capsys.readouterr().out)["panes"] == []
        assert calls[0][1:3] == ["-S", "/private/app.sock"]

    def test_ambiguous_app_address_never_falls_back_to_backend(self, monkeypatch, capsys):
        panes = [itl.pane_record(itl.TMUX, "/s", session, pane) for session, pane in [("a", "%1"), ("b", "%2")]]
        for pane in panes:
            pane["app_addr"] = "2.1"
        monkeypatch.setattr(itl, "discover", lambda: panes)
        monkeypatch.setattr(itl, "send_app_addr", lambda *a, **kw: pytest.fail("ambiguous target must never queue"))
        assert itl.main(["--json", "send", "2.1", "do work"]) == 2
        assert "여럿" in json.loads(capsys.readouterr().out)["error"]

    def test_discovery_reports_denied_socket(self, monkeypatch):
        monkeypatch.setattr(itl, "tmux_bin", lambda: "/usr/bin/tmux")
        monkeypatch.setattr(itl, "tmux_sockets", lambda: ["/tmp/tmux-1000/app"])
        monkeypatch.setattr(itl, "run", lambda argv, **kw: (1, "", "error connecting (Operation not permitted)"))

        with pytest.raises(itl.TmuxAccessError, match="Operation not permitted"):
            itl.discover_tmux()

    @pytest.mark.parametrize("argv", [["list"], ["whoami"], ["send", "1.3", "hi"]])
    def test_all_commands_report_denied_socket(self, monkeypatch, capsys, argv):
        def denied():
            raise itl.TmuxAccessError("tmux 소켓 접근 거부: Operation not permitted")

        monkeypatch.setattr(itl, "discover", denied)
        assert itl.main(argv) == 3
        captured = capsys.readouterr()
        assert "Operation not permitted" in captured.err
        assert "itl sandbox-config" in captured.err
        assert "열쇠가 없다" not in captured.err
        assert itl.SEND_MARKER not in captured.out

    def test_send_reports_denied_key_lookup_in_json(self, monkeypatch, capsys):
        def denied_key():
            raise itl.TmuxAccessError("tmux 소켓 접근 거부: Operation not permitted")

        monkeypatch.setattr(itl, "discover", lambda: [])
        monkeypatch.setattr(itl, "my_key", denied_key)

        assert itl.main(["--json", "send", "1.3", "hi"]) == 3
        result = json.loads(capsys.readouterr().out)
        assert result["ok"] is False and result["handedOff"] is False
        assert result["errorCode"] == "tmux_socket_denied" and result["retryable"] is False
        assert "Operation not permitted" in result["error"]

    def test_sandbox_config_uses_current_tmux_socket_without_connecting(self, monkeypatch, capsys):
        import tomllib

        monkeypatch.setenv("TMUX", "/tmp/tmux-1000/default,123,0")
        monkeypatch.setattr(itl, "discover", lambda: pytest.fail("sandbox-config must not connect to tmux"))

        assert itl.main(["--json", "sandbox-config"]) == 0
        result = json.loads(capsys.readouterr().out)
        assert result["socket"] == "/tmp/tmux-1000/default"
        assert '"/tmp/tmux-1000/default" = "allow"' in result["config"]
        assert '"/tmp/tmux-1000" = "read"' in result["config"]
        config = tomllib.loads(result["config"])
        assert config["permissions"]["itl-tmux"]["network"]["unix_sockets"][result["socket"]] == "allow"
        assert "sandbox_mode" in result["instructions"]

    def test_sandbox_config_requires_tmux_environment(self, monkeypatch, capsys):
        monkeypatch.delenv("TMUX", raising=False)
        assert itl.main(["sandbox-config"]) == 2
        assert "TMUX" in capsys.readouterr().err


class TestSendGuards:
    def test_너무_길면_보내지_않는다(self):
        pane = itl.pane_record("tmux", "/s", "a", "%0")
        ok, why = itl.send(pane, "x" * (itl.MAX_TEXT_BYTES + 1))
        assert not ok and "너무 길다" in why


def test_stdlib_만_쓴다():
    """⚠️ 이게 깨지면 **원격 전달이 통째로 깨진다.** 백엔드가 이 파일을 stdin 으로 밀어
    원격에서 실행하므로(llm_usage/collect.py 와 같은 규칙), 서드파티 import 가 하나라도
    들어오면 그 호스트에서 ImportError 로 끝난다. 여기서 안 잡으면 원격에서만 터진다."""
    import ast
    tree = ast.parse(ITL_PATH.read_text(encoding="utf-8"))
    allowed = {
        "argparse", "json", "os", "re", "secrets", "shlex", "shutil", "subprocess", "sys", "__future__",
    }
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            imported.add(node.module.split(".")[0])
    assert imported <= allowed, f"stdlib 밖의 import: {sorted(imported - allowed)}"


# ─── 열쇠와 엔터 정책 ──────────────────────────────────────────────────────────

class TestKey:
    def test_env_가_먼저다(self, monkeypatch):
        monkeypatch.setenv(itl.KEY_ENV, "envkey")
        monkeypatch.setenv("TMUX", "/tmp/tmux-1000/x,1,0")
        assert itl.my_key() == "envkey"

    def test_tmux_옵션에서_읽는다(self, monkeypatch):
        monkeypatch.delenv(itl.KEY_ENV, raising=False)
        monkeypatch.setenv("TMUX", "/tmp/tmux-1000/app,1,0")
        monkeypatch.setenv("TMUX_PANE", "%3")
        seen = {}

        def fake_run(argv, **_kw):
            seen["argv"] = argv
            if "list-panes" in argv:
                return 0, "%3\n", ""
            return 0, "abc123\n", ""

        monkeypatch.setattr(itl, "tmux_bin", lambda: "/usr/bin/tmux")
        monkeypatch.setattr(itl, "run", fake_run)
        assert itl.my_key() == "abc123"
        assert seen["argv"][:3] == ["/usr/bin/tmux", "-S", "/tmp/tmux-1000/app"]
        assert "-t" in seen["argv"] and "%3" in seen["argv"] and itl.TMUX_KEY_OPTION in seen["argv"]

    def test_둘_다_없으면_빈_문자열(self, monkeypatch):
        monkeypatch.delenv(itl.KEY_ENV, raising=False)
        monkeypatch.delenv("TMUX", raising=False)
        monkeypatch.delenv("TMUX_PANE", raising=False)
        assert itl.my_key() == ""

    def test_denied_key_lookup_does_not_mean_missing_key(self, monkeypatch):
        monkeypatch.delenv(itl.KEY_ENV, raising=False)
        monkeypatch.setenv("TMUX", "/tmp/tmux-1000/app,1,0")
        monkeypatch.setenv("TMUX_PANE", "%5")
        monkeypatch.setattr(itl, "tmux_bin", lambda: "/usr/bin/tmux")
        monkeypatch.setattr(itl, "run", lambda argv, **kw: (1, "", "error connecting (Operation not permitted)"))

        with pytest.raises(itl.TmuxAccessError, match="Operation not permitted"):
            itl.my_key()

    def test_열쇠_없이는_표식을_찍지_않는다(self, monkeypatch, capsys):
        """A marker without the key is dropped by the bridge — say so instead of printing it."""
        monkeypatch.setattr(itl, "my_key", lambda: "")
        outbox: list[str] = []
        monkeypatch.setattr(itl, "put_outbox", lambda line: outbox.append(line) or True)
        ok, why = itl.send_app_addr("1.2", "hi")
        assert not ok and "열쇠" in why
        assert "1.2" in why and "로컬" in why
        assert "itl list" in why and "itl whoami" in why
        assert "재시도" in why
        assert itl.SEND_MARKER not in capsys.readouterr().out
        assert outbox == []                 # 열쇠가 없으면 우편함도 안 세운다

    def test_표식에는_열쇠와_난수가_실린다(self, monkeypatch, capsys):
        # ⚠️ `put_outbox` 를 반드시 막는다. 이 테스트가 이 팬의 tmux 안에서 돌면 **진짜**
        # 우편함을 세워 백엔드가 다른 호스트의 팬 1.2 에 "hi" 를 배달한다(실제로 그랬다).
        outbox: list[str] = []
        monkeypatch.setattr(itl, "put_outbox", lambda line: outbox.append(line) or True)
        monkeypatch.setattr(itl, "my_key", lambda: "k" * 32)
        assert itl.send_app_addr("1.2", "hi") == (True, "")
        assert len(outbox) == 1 and json.loads(outbox[0])["to"] == "1.2"   # 두 통로로 나간다
        out = capsys.readouterr().out
        assert out.startswith(itl.SEND_MARKER + " ")
        payload = json.loads(out[len(itl.SEND_MARKER):])
        assert payload["to"] == "1.2" and payload["text"] == "hi" and payload["key"] == "k" * 32
        assert len(payload["n"]) == 8
        # two sends of the same text are distinct lines (replay suppression must not eat them)
        itl.send_app_addr("1.2", "hi")
        assert json.loads(capsys.readouterr().out[len(itl.SEND_MARKER):])["n"] != payload["n"]


class TestNoLiveTmuxFromTests:
    """스위트가 자기가 도는 팬의 tmux 에 닿지 않는다(conftest 가 환경을 지운다)."""

    def test_환경에_tmux_가_없다(self):
        import os
        assert "TMUX" not in os.environ and "TMUX_PANE" not in os.environ

    def test_put_outbox_는_tmux_환경이_없으면_아무것도_안_한다(self, monkeypatch):
        calls = []
        monkeypatch.setattr(itl, "run", lambda argv, **kw: calls.append(argv) or (0, "", ""))
        assert itl.put_outbox("{}") is False
        assert calls == []


class TestIsAgent:
    def _pane(self, **kw):
        base = dict(mux=itl.TMUX, socket="", session="s", native_id="%1", label="", agent="",
                    status="", cwd="", title="")
        base.update(kw)
        return base

    def test_타이틀만으로는_에이전트가_아니다(self):
        """Any output can set the title (OSC 0/2). Only the process name counts."""
        assert not itl.is_agent(self._pane(status=itl.WORKING, title="✳ claude", agent="zsh"))

    def test_전면_명령이_에이전트_이름이면_에이전트(self):
        assert itl.is_agent(self._pane(agent="claude"))

    def test_맨_셸은_아니다(self):
        assert not itl.is_agent(self._pane(agent="zsh"))
        assert not itl.is_agent(self._pane(agent="node"))      # a name is not enough


class TestEnterIfAgent:
    """`--enter-if-agent` is the backend's rule: submit into an agent, only type into a shell."""

    def _run_send(self, monkeypatch, pane, argv):
        calls = {}
        monkeypatch.setattr(itl, "discover", lambda: [pane])

        def fake_send(p, text, *, enter=True, raw=False):
            calls["enter"] = enter
            return True, ""

        monkeypatch.setattr(itl, "send", fake_send)
        assert itl.main(argv) == 0
        return calls["enter"]

    def test_맨_셸에는_엔터를_안_친다(self, monkeypatch):
        pane = dict(mux=itl.TMUX, socket="", session="s", native_id="%1", label="", agent="zsh",
                    status="", cwd="", title="", addr="s:%1", app_addr="")
        assert self._run_send(monkeypatch, pane, ["send", "s", "ls", "--enter-if-agent"]) is False

    def test_에이전트에는_엔터를_친다(self, monkeypatch):
        pane = dict(mux=itl.TMUX, socket="", session="s", native_id="%1", label="", agent="claude",
                    status=itl.IDLE, cwd="", title="✳ Claude Code", addr="s:%1", app_addr="")
        assert self._run_send(monkeypatch, pane, ["send", "s", "go", "--enter-if-agent"]) is True

    def test_백엔드_경로에서는_본문의_개행을_지운다(self, monkeypatch):
        pane = dict(mux=itl.TMUX, socket="", session="s", native_id="%1", label="", agent="zsh",
                    status="", cwd="", title="", addr="s:%1", app_addr="")
        got = {}
        monkeypatch.setattr(itl, "discover", lambda: [pane])
        monkeypatch.setattr(itl, "send", lambda p, text, *, enter=True, raw=False: got.update(text=text) or (True, ""))
        itl.main(["send", "s", "ls\nrm -rf /", "--enter-if-agent"])
        assert "\n" not in got["text"]

    def test_사람이_직접_치면_기본은_엔터다(self, monkeypatch):
        pane = dict(mux=itl.TMUX, socket="", session="s", native_id="%1", label="", agent="zsh",
                    status="", cwd="", title="", addr="s:%1", app_addr="")
        assert self._run_send(monkeypatch, pane, ["send", "s", "ls"]) is True

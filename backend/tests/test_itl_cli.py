"""itl — 팬 사이로 말을 옮기는 단일 파일 CLI.

여기서 잠그는 것은 셋이다.

1. **에이전트 상태 판정이 나머지 두 사본과 갈라지지 않는다.** 규칙은 stablyai/orca 에서
   왔고 이 저장소에 이미 `backend/agent_status.py` · `frontend/utils/agentTitle.js` 로
   두 벌 있다. itl 은 stdin 으로 밀 수 있어야 해서 import 를 못 하고, 그래서 **세 번째
   사본**이다 — 사본이 늘어난 만큼 규율도 같이 와야 한다. 판정 케이스의 단일 진실
   공급원은 여전히 `shared/agent-title-cases.json` 이고, 이 파일이 그 표로 itl 을 친다.

2. **두 멀티플렉서가 같은 어휘로 말한다.** tmux 는 상태를 모르고 herdr 는 자기 낱말
   (blocked/done/unknown)을 쓴다. `itl list` 가 같은 상황을 멀티플렉서에 따라 다르게
   부르면 이 도구는 존재 이유가 없다.

3. **모호한 주소는 고르지 않는다.** 하나를 골라 주면 "그 중 하나" 에 명령이 들어가고,
   잘못 들어간 것을 되돌릴 방법이 없다.

⚠️ 실제 tmux/herdr 는 띄우지 않는다 — 파싱과 판정만 순수 함수로 친다.
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
    @pytest.mark.parametrize("herdr_status,expected", [
        ("working", "working"),
        ("blocked", "permission"),   # herdr 의 낱말 → 이 저장소의 낱말
        ("idle", "idle"),
        ("done", "idle"),            # done 은 "안 보고 있는 사이 끝난 idle" 이다
    ])
    def test_herdr_어휘를_옮긴다(self, herdr_status, expected):
        assert itl.unify_status(herdr_status, "") == expected

    def test_unknown_이면_타이틀에_다시_묻는다(self):
        """herdr 가 모른다고 해서 우리도 포기할 이유는 없다 — 타이틀은 남아 있다."""
        assert itl.unify_status("unknown", "✳ 정리 중") == "idle"
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


class TestParseHerdr:
    def test_팬_목록을_읽는다(self):
        data = {"result": {"panes": [
            {"pane_id": "w1:p1", "agent": "claude", "agent_status": "blocked",
             "foreground_cwd": "/home/u", "terminal_title": "claude waiting"},
        ]}}
        panes = itl.parse_herdr_panes(data, "s1")
        assert panes[0]["addr"] == "s1:w1:p1"
        assert panes[0]["status"] == "permission"

    def test_모양이_바뀌면_조용히_빈_목록(self):
        """던지면 멀쩡한 tmux 팬까지 같이 안 보이게 된다 — 한쪽의 고장이 전부를 먹는다."""
        for bad in (None, {}, {"result": {}}, {"result": {"panes": "nope"}}):
            assert itl.parse_herdr_panes(bad, "s1") == []

    def test_pane_id_없는_행은_버린다(self):
        data = {"result": {"panes": [{"agent": "claude"}, {"pane_id": "w1:p2"}]}}
        assert [p["native_id"] for p in itl.parse_herdr_panes(data, "s")] == ["w1:p2"]


class TestResolve:
    PANES = [
        itl.pane_record("tmux", "/s", "alpha", "%0", agent="claude"),
        itl.pane_record("herdr", "/h", "beta", "w1:p1", agent="codex"),
        itl.pane_record("herdr", "/h", "beta", "w1:p2", agent="codex"),
    ]

    def test_정확한_주소(self):
        pane, why = itl.resolve(self.PANES, "beta:w1:p2")
        assert pane["native_id"] == "w1:p2" and not why

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
        assert "beta:w1:p1" in why and "beta:w1:p2" in why

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
        itl.pane_record("herdr", "/h", "sess-h", "w1:p1"),
    ]

    def test_herdr_환경이면_herdr_팬(self, monkeypatch):
        monkeypatch.setenv("HERDR_SESSION", "sess-h")
        monkeypatch.setenv("HERDR_PANE_ID", "w1:p1")
        monkeypatch.setenv("TMUX_PANE", "%3")
        # ⚠️ 중첩(tmux 안의 herdr)이면 **안쪽이 이긴다** — 내가 실제로 타이핑당하는 자리다.
        assert itl.whoami(self.PANES)["mux"] == "herdr"

    def test_tmux_는_소켓까지_맞아야_한다(self, monkeypatch):
        """`%0` exists on every tmux server; the app socket and the default socket both have one."""
        monkeypatch.delenv("HERDR_SESSION", raising=False)
        monkeypatch.setenv("TMUX", "/tmp/tmux-1000/app,1,0")
        monkeypatch.setenv("TMUX_PANE", "%0")
        mine = dict(mux=itl.TMUX, socket="/tmp/tmux-1000/app", session="s", native_id="%0", addr="s:%0")
        other = dict(mux=itl.TMUX, socket="/tmp/tmux-1000/default", session="d", native_id="%0", addr="d:%0")
        assert itl.whoami([other, mine]) is mine

    def test_tmux_만_있으면_tmux_팬(self, monkeypatch):
        monkeypatch.delenv("TMUX", raising=False)          # no socket to match against
        monkeypatch.delenv("HERDR_SESSION", raising=False)
        monkeypatch.delenv("HERDR_PANE_ID", raising=False)
        monkeypatch.setenv("TMUX_PANE", "%3")
        assert itl.whoami(self.PANES)["addr"] == "alpha:%3"

    def test_둘_다_아니면_None(self, monkeypatch):
        for var in ("HERDR_SESSION", "HERDR_PANE_ID", "TMUX_PANE"):
            monkeypatch.delenv(var, raising=False)
        assert itl.whoami(self.PANES) is None


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
        "argparse", "json", "os", "re", "secrets", "shutil", "subprocess", "sys", "__future__",
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

    def test_열쇠_없이는_표식을_찍지_않는다(self, monkeypatch, capsys):
        """A marker without the key is dropped by the bridge — say so instead of printing it."""
        monkeypatch.setattr(itl, "my_key", lambda: "")
        ok, why = itl.send_app_addr("1.2", "hi")
        assert not ok and "열쇠" in why
        assert itl.SEND_MARKER not in capsys.readouterr().out

    def test_표식에는_열쇠와_난수가_실린다(self, monkeypatch, capsys):
        monkeypatch.setattr(itl, "my_key", lambda: "k" * 32)
        assert itl.send_app_addr("1.2", "hi") == (True, "")
        out = capsys.readouterr().out
        assert out.startswith(itl.SEND_MARKER + " ")
        payload = json.loads(out[len(itl.SEND_MARKER):])
        assert payload["to"] == "1.2" and payload["text"] == "hi" and payload["key"] == "k" * 32
        assert len(payload["n"]) == 8
        # two sends of the same text are distinct lines (replay suppression must not eat them)
        itl.send_app_addr("1.2", "hi")
        assert json.loads(capsys.readouterr().out[len(itl.SEND_MARKER):])["n"] != payload["n"]


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

    def test_herdr_는_에이전트를_이름으로_안다(self):
        assert itl.is_agent(self._pane(mux=itl.HERDR, agent="anything"))
        assert not itl.is_agent(self._pane(mux=itl.HERDR, agent=""))


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

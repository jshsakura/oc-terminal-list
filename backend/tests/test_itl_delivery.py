from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

import itl_channel
import itl_router
from tests.test_itl_cli import itl


@pytest.fixture
def receiving_pane(tmp_path: Path, monkeypatch):
    binary = shutil.which("tmux")
    if binary is None:
        pytest.skip("tmux is unavailable")
    socket_dir = tmp_path / f"tmux-{os.getuid()}"
    socket_dir.mkdir(mode=0o700)
    socket = str(socket_dir / "socket")
    monkeypatch.setenv("TMUX_TMPDIR", str(tmp_path))
    base = [binary, "-S", socket]
    env = os.environ.copy()
    env.pop("TMUX", None)
    script = tmp_path / "receiver.py"
    result = tmp_path / "received"
    script.write_text(
        "import os, select, subprocess, sys, time, tty\n"
        "tty.setraw(0)\n"
        "sys.stdout.write('\\x1b[?2004h'); sys.stdout.flush()\n"
        "subprocess.run([sys.argv[1], '-S', sys.argv[2], 'wait-for', '-S', 'ready'], check=True)\n"
        "data = b''\n"
        "deadline = time.monotonic() + 5\n"
        "while time.monotonic() < deadline:\n"
        "    ready, _, _ = select.select([0], [], [], max(0, deadline-time.monotonic()))\n"
        "    if not ready: break\n"
        "    data += os.read(0, 65536)\n"
        "    if data.endswith(b'\\r'): break\n"
        "open(sys.argv[3], 'wb').write(data)\n"
        "subprocess.run([sys.argv[1], '-S', sys.argv[2], 'wait-for', '-S', 'done'], check=True)\n",
        encoding="utf-8",
    )
    command = "exec -a codex " + shlex.join([sys.executable, str(script), binary, socket, str(result)])
    subprocess.run(
        [*base, "-f", "/dev/null", "set-option", "-g", "remain-on-exit", "on", ";",
         "new-session", "-d", "-s", "receiver", command],
        check=True, env=env, capture_output=True, timeout=5,
    )
    try:
        subprocess.run([*base, "wait-for", "ready"], check=True, timeout=5)
        pane = itl.pane_record(itl.TMUX, socket, "receiver", "%0", agent="codex")
        yield pane, base, result
    finally:
        subprocess.run([*base, "kill-server"], capture_output=True, timeout=5)


@pytest.mark.parametrize("copy_mode, text", [(False, "한글 Enter -n"), (True, "한글 Enter -n"),
                                            (False, ";"), (False, "-n")])
def test_send_frames_paste_before_enter(receiving_pane, copy_mode, text):
    pane, base, result = receiving_pane
    if copy_mode:
        subprocess.run([*base, "copy-mode", "-t", "%0"], check=True, timeout=5)

    ok, error = itl.send(pane, text, enter=True)

    assert ok, error
    subprocess.run([*base, "wait-for", "done"], check=True, timeout=7)
    assert result.read_bytes() == b"\x1b[200~" + text.encode() + b"\x1b[201~\r"


@pytest.mark.parametrize("agent, enter_sent", [("codex", True), ("zsh", False)])
def test_send_receipt_distinguishes_enter_from_typing(monkeypatch, capsys, agent, enter_sent):
    pane = itl.pane_record(itl.TMUX, "/private/socket", "receiver", "%0", agent=agent)
    monkeypatch.setattr(itl, "discover", lambda: [pane])
    monkeypatch.setattr(itl, "send", lambda pane, text, *, enter: (True, ""))

    assert itl.main(["--json", "send", "receiver", "작업", "--enter-if-agent"]) == 0

    receipt = json.loads(capsys.readouterr().out)
    assert receipt["enterSent"] is enter_sent
    assert receipt["delivery"] == ("enter-sent" if enter_sent else "typed")


def test_node_agent_uses_foreground_process_identity(monkeypatch):
    pane = itl.pane_record(itl.TMUX, "/private/socket", "receiver", "%0", agent="node")
    monkeypatch.setattr(itl, "run", lambda argv, **kwargs: (0, "/dev/pts/123\n", ""))
    monkeypatch.setattr(itl, "foreground_command", lambda tty: ["node", "/opt/@anthropic-ai/claude-code/cli.js"])

    assert itl.is_agent(pane)


def test_node_argument_and_title_cannot_impersonate_agent(monkeypatch):
    pane = itl.pane_record(itl.TMUX, "/private/socket", "receiver", "%0", agent="node", title="codex")
    monkeypatch.setattr(itl, "run", lambda argv, **kwargs: (0, "/dev/pts/123\n", ""))
    monkeypatch.setattr(itl, "foreground_command", lambda tty: ["node", "/tmp/server.js", "codex"])

    assert not itl.is_agent(pane)


@pytest.mark.parametrize("enter_sent", [True, False])
async def test_router_returns_target_receipt(monkeypatch, enter_sent):
    async def targets(username):
        return [{"addr": "1.1", "kind": "local", "sessionId": "receiver"}]

    async def send(args):
        return json.dumps({"ok": True, "enterSent": enter_sent})

    monkeypatch.setattr(itl_router, "_targets_for", targets)
    monkeypatch.setattr(itl_router, "_run_local", send)

    result = await itl_router.deliver("user", "1.1", "작업")

    assert result["enterSent"] is enter_sent


async def test_router_does_not_claim_success_without_valid_receipt(monkeypatch):
    async def targets(username):
        return [{"addr": "1.1", "kind": "local", "sessionId": "receiver"}]

    async def send(args):
        return "not a receipt"

    monkeypatch.setattr(itl_router, "_targets_for", targets)
    monkeypatch.setattr(itl_router, "_run_local", send)

    with pytest.raises(itl_router.DeliveryFailed):
        await itl_router.deliver("user", "1.1", "작업")


def test_no_enter_survives_backend_handoff(monkeypatch, capsys):
    key = "a" * 32
    monkeypatch.setattr(itl, "my_key", lambda: key)
    monkeypatch.setattr(itl, "put_outbox", lambda line: True)

    assert itl.send_app_addr("2.1", "작업", submit=False) == (True, "")

    marker = capsys.readouterr().out
    messages = itl_channel.SentinelScanner(key).feed(marker.encode())
    assert messages[0]["submit"] is False


async def test_router_keeps_no_enter_from_marker(monkeypatch):
    calls = []

    async def targets(username):
        return [{"addr": "1.1", "kind": "local", "sessionId": "sender"}]

    async def deliver(username, addr, text, *, sender, submit):
        calls.append(submit)
        return {"enterSent": False}

    async def acknowledge(*args, **kwargs):
        return None

    monkeypatch.setattr(itl_router, "_targets_for", targets)
    monkeypatch.setattr(itl_router, "deliver", deliver)
    monkeypatch.setattr(itl_router, "_ack_ok", acknowledge)

    await itl_router.deliver_from_pane("user", "sender", {"to": "2.1", "text": "작업", "submit": False})

    assert calls == [False]


def test_pending_request_cannot_be_overwritten(receiving_pane, monkeypatch):
    pane, base, _result = receiving_pane
    monkeypatch.setenv("TMUX", pane["socket"] + ",1,0")
    monkeypatch.setenv("TMUX_PANE", pane["native_id"])
    first = json.dumps({"n": "abcd1234", "to": "2.1", "text": "first", "receipt": True})
    second = json.dumps({"n": "abcd1235", "to": "2.1", "text": "second", "receipt": True})

    assert itl.put_outbox(first)
    assert not itl.put_outbox(second)

    result = subprocess.run([*base, "show-options", "-qv", "-t", "%0", "@itl_outbox"],
                            check=True, capture_output=True, text=True, timeout=5)
    assert result.stdout.strip() == first


@pytest.mark.parametrize("command", [["whoami"], ["doctor"], ["send", "99.1", "must-not-send"],
                                   ["receipt", "abcd1234", "--wait", "90"]])
def test_cli_stale_sender_fails_without_touching_other_panes(receiving_pane, command):
    pane, base, _result = receiving_pane
    env = {**os.environ, "TMUX": pane["socket"] + ",1,0", "TMUX_PANE": "%999"}
    subprocess.run([*base, "set-option", "-t", "%0", "@itl_key", "must-not-leak"], check=True, timeout=5)
    client = subprocess.run([sys.executable, str(Path(__file__).parents[1] / "cli/itl"), "--json", *command],
                            capture_output=True, text=True, env=env, timeout=3)
    assert client.returncode == 3 and not client.stderr
    output = json.loads(client.stdout)
    assert output["errorCode"] == "tmux_context_stale" and output["retryable"] is False
    assert "must-not-leak" not in client.stdout
    outbox = subprocess.run([*base, "show-options", "-qv", "-t", "%0", "@itl_outbox"],
                            check=True, capture_output=True, text=True, timeout=5)
    assert not outbox.stdout.strip()


def test_cli_current_server_doctor_and_tab_send(receiving_pane):
    pane, base, received = receiving_pane
    subprocess.run([*base, "new-session", "-d", "-s", "sender", "cat"], check=True, timeout=5)
    subprocess.run([*base, "set-option", "-t", "receiver", "@pane_addr", "99.1"], check=True, timeout=5)
    subprocess.run([*base, "set-option", "-t", "sender", "@pane_addr", "99.2"], check=True, timeout=5)
    subprocess.run([*base, "set-option", "-t", "sender", "@itl_key", "must-not-leak"], check=True, timeout=5)
    env = {**os.environ, "TMUX": pane["socket"] + ",1,0", "TMUX_PANE": "%1"}
    cli = [sys.executable, str(Path(__file__).parents[1] / "cli/itl"), "--json"]
    diagnostic = subprocess.run([*cli, "doctor"], check=True, capture_output=True, text=True, env=env, timeout=3)
    report = json.loads(diagnostic.stdout)
    assert report["sender"] == "99.2" and report["senderKeyAvailable"] is True
    assert set(report["targets"]) == {"99.1", "99.2"}
    assert "must-not-leak" not in diagnostic.stdout
    sent = subprocess.run([*cli, "send", "99.1", "탭 간 전달 확인"],
                          check=True, capture_output=True, text=True, env=env, timeout=3)
    assert json.loads(sent.stdout)["delivery"] == "enter-sent"
    subprocess.run([*base, "wait-for", "done"], check=True, timeout=7)
    assert received.read_bytes() == b"\x1b[200~" + "탭 간 전달 확인".encode() + b"\x1b[201~\r"


async def test_backend_delivery_ignores_inherited_unrelated_socket(receiving_pane, monkeypatch):
    pane, base, received = receiving_pane
    from tmux_manager import tmux_manager

    monkeypatch.setattr(tmux_manager, "socket_name", "socket")
    monkeypatch.setenv("TMUX", str(Path(pane["socket"]).parent / "missing-socket") + ",123,0")
    monkeypatch.setenv("TMUX_PANE", "%999")
    output = await itl_router._run_local(["send", "receiver", "backend socket selection"])
    assert json.loads(output)["delivery"] == "enter-sent"
    subprocess.run([*base, "wait-for", "done"], check=True, timeout=7)
    assert received.read_bytes() == b"\x1b[200~backend socket selection\x1b[201~\r"


def test_cli_current_socket_works_when_another_socket_is_denied(receiving_pane):
    pane, base, _received = receiving_pane
    denied_socket = str(Path(pane["socket"]).parent / "denied")
    denied_base = [base[0], "-S", denied_socket]
    subprocess.run([*denied_base, "-f", "/dev/null", "new-session", "-d", "-s", "denied", "cat"],
                   check=True, capture_output=True, timeout=5)
    try:
        os.chmod(denied_socket, 0)
        env = {**os.environ, "TMUX": pane["socket"] + ",1,0", "TMUX_PANE": "%0"}
        cli = [sys.executable, str(Path(__file__).parents[1] / "cli/itl"), "--json"]
        current = subprocess.run([*cli, "list"], check=True, capture_output=True, text=True, env=env, timeout=3)
        assert [p["native_id"] for p in json.loads(current.stdout)["panes"]] == ["%0"]
        all_servers = subprocess.run([*cli, "list", "--all"],
                                     capture_output=True, text=True, env=env, timeout=3)
        assert all_servers.returncode == 3
        assert json.loads(all_servers.stdout)["errorCode"] == "tmux_socket_denied"
        env["TMUX"] = denied_socket + ",1,0"
        receipt = subprocess.run([*cli, "receipt", "abcd1234", "--wait", "90"],
                                 capture_output=True, text=True, env=env, timeout=3)
        report = json.loads(receipt.stdout)
        assert receipt.returncode == 3
        assert report["errorCode"] == "tmux_socket_denied" and report["delivery"] == "unknown"
    finally:
        os.chmod(denied_socket, 0o600)
        subprocess.run([*denied_base, "kill-server"], capture_output=True, timeout=5)


def test_receipt_is_readable_after_event_signal(receiving_pane, monkeypatch):
    pane, base, _result = receiving_pane
    monkeypatch.setenv("TMUX", pane["socket"] + ",1,0")
    monkeypatch.setenv("TMUX_PANE", pane["native_id"])
    request_id = "abcd1234"
    expected = {"ok": True, "requestId": request_id, "delivery": "enter-sent", "enterSent": True}
    subprocess.run([*base, "set-option", "-t", "%0", "@itl_pending", request_id], check=True, timeout=5)

    assert itl.record_receipt(pane, request_id, json.dumps(expected)) == (True, "")
    raw, error = itl.receipt(request_id, timeout=1)

    assert not error and json.loads(raw) == expected
    pending = subprocess.run([*base, "show-options", "-qv", "-t", "%0", "@itl_pending"],
                             check=True, capture_output=True, text=True, timeout=5)
    assert not pending.stdout.strip()


def test_receipt_timeout_leaves_pending_request_intact(receiving_pane, monkeypatch):
    pane, base, _result = receiving_pane
    monkeypatch.setenv("TMUX", pane["socket"] + ",1,0")
    monkeypatch.setenv("TMUX_PANE", pane["native_id"])
    subprocess.run([*base, "set-option", "-t", "%0", "@itl_pending", "abcd1234"], check=True, timeout=5)

    raw, error = itl.receipt("abcd1234", timeout=0.05)

    assert not raw and "abcd1234" in error
    pending = subprocess.run([*base, "show-options", "-qv", "-t", "%0", "@itl_pending"],
                             check=True, capture_output=True, text=True, timeout=5)
    assert pending.stdout.strip() == "abcd1234"


@pytest.mark.parametrize("target_exists", [True, False])
async def test_cli_gets_backend_receipt_without_browser(receiving_pane, monkeypatch, target_exists):
    pane, base, result_file = receiving_pane
    from tmux_manager import tmux_manager

    monkeypatch.setattr(tmux_manager, "socket_name", "socket")
    subprocess.run([*base, "new-session", "-d", "-s", "sender", "cat"], check=True, timeout=5)
    env = {**os.environ, "TMUX": pane["socket"] + ",1,0", "TMUX_PANE": "%1", "ITL_KEY": "a" * 32}
    monkeypatch.setenv("TMUX", env["TMUX"])
    monkeypatch.setenv("TMUX_PANE", "%1")

    async def targets(username):
        targets = [{"addr": "1.1", "kind": "local", "sessionId": "sender"}]
        if target_exists:
            targets.append({"addr": "99.1", "kind": "local", "sessionId": "receiver"})
        return targets

    monkeypatch.setattr(itl_router, "_targets_for", targets)
    client = subprocess.Popen([sys.executable, str(Path(__file__).parents[1] / "cli/itl"),
                               "--json", "send", "99.1", "receipt-test", "--wait", "10"],
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
    try:
        subprocess.run([*base, "wait-for", "itl-outbox-%1"], check=True, timeout=5)
        queued = subprocess.run([*base, "show-options", "-qv", "-t", "%1", "@itl_outbox"],
                                check=True, capture_output=True, text=True, timeout=5)
        msg = itl_channel.parse_sentinel(queued.stdout)
        assert msg is not None
        subprocess.run([*base, "set-option", "-u", "-t", "%1", "@itl_outbox"], check=True, timeout=5)

        await itl_router.deliver_from_pane("user", "sender", msg)
        stdout, stderr = client.communicate(timeout=5)

        assert not stderr
        receipt = json.loads(stdout)
        assert receipt["ok"] is target_exists
        assert receipt["requestId"] == msg["n"]
        assert receipt["delivery"] == ("enter-sent" if target_exists else "failed")
        assert client.returncode == (0 if target_exists else 3)
        if target_exists:
            subprocess.run([*base, "wait-for", "done"], check=True, timeout=5)
            assert result_file.read_bytes() == b"\x1b[200~[from 1.1] receipt-test\x1b[201~\r"
    finally:
        if client.poll() is None:
            client.kill()
            client.wait(timeout=5)

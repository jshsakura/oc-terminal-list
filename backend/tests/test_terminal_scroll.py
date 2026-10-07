"""Scrollbar controls must address tmux history, never type into a user's shell."""

import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
import uuid
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fastapi import HTTPException, Response
from pydantic import ValidationError

from routes.terminal_scroll import (
    ScrollRequest,
    get_scroll,
    parse_state,
    scroll_script,
    scroll_terminal,
    set_scroll,
)


@unittest.skipUnless(shutil.which("tmux"), "tmux is required for isolated history tests")
class ScrollHistoryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = ["tmux", "-L", f"codex-scroll-test-{os.getpid()}"]
        cls.env = {k: v for k, v in os.environ.items() if k not in ("TMUX", "TMUX_PANE")}
        cls.run_tmux("-f", "/dev/null", "new-session", "-d", "-s", "history", "-x", "80", "-y", "20", "sh")
        cls.run_tmux("send-keys", "-t", "=history:", "seq 1 300", "Enter")
        for _ in range(30):
            if cls.state()["history"] > 200:
                break
            time.sleep(0.05)

    @classmethod
    def tearDownClass(cls):
        subprocess.run([*cls.base, "kill-server"], env=cls.env, capture_output=True)

    @classmethod
    def run_tmux(cls, *args):
        return subprocess.check_output([*cls.base, *args], env=cls.env, text=True, timeout=3)

    @classmethod
    def state(cls, offset=None):
        output = subprocess.check_output(
            ["sh", "-c", scroll_script(cls.base, "history", offset)], env=cls.env, text=True, timeout=3
        )
        return parse_state(output)

    def test_seek_and_return_to_live_output(self):
        for offset in [40, 100, 5, 0]:
            with self.subTest(offset=offset):
                self.assertEqual(self.state(offset)["offset"], offset)
        self.assertEqual(self.run_tmux("display-message", "-p", "-t", "=history:", "#{pane_in_mode}").strip(), "0")

    def test_explicit_bottom_leaves_copy_mode_for_a_shell(self):
        self.state(40)
        output = subprocess.check_output(
            ["sh", "-c", scroll_script(self.base, "history", action="bottom")],
            env=self.env, text=True, timeout=3,
        )
        self.assertEqual(parse_state(output)["offset"], 0)
        self.assertEqual(self.run_tmux("display-message", "-p", "-t", "=history:", "#{pane_in_mode}").strip(), "0")

    def test_seek_is_clamped_to_existing_history(self):
        state = self.state(1_000_000)
        self.assertEqual(state["offset"], state["history"])
        self.state(0)

    def test_unknown_session_cannot_select_another_pane(self):
        result = subprocess.run(
            ["sh", "-c", scroll_script(self.base, "missing", 50)], env=self.env, capture_output=True, text=True
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.state()["offset"], 0)

    def test_session_name_is_shell_quoted(self):
        result = subprocess.run(
            ["sh", "-c", scroll_script(self.base, "$(printf INJECTED)", 5)],
            env=self.env,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("INJECTED", result.stdout)

    @unittest.skipUnless(shutil.which("zsh"), "zsh is required for remote login-shell compatibility")
    def test_seek_script_runs_under_zsh(self):
        output = subprocess.check_output(
            ["zsh", "-fc", scroll_script(self.base, "history", 40)],
            env=self.env,
            text=True,
            timeout=3,
        )

        self.assertEqual(parse_state(output)["offset"], 40)
        self.state(0)

    def test_seek_batches_metadata_and_mutation_commands(self):
        script = scroll_script(self.base, "history", 40)

        self.assertTrue(script.startswith("state=$("))
        self.assertNotIn("pane=$(", script)
        self.assertNotIn("mode=$(", script)
        self.assertNotIn("hist=$(", script)
        self.assertIn(r"\;", script)

    def test_malformed_or_other_mode_is_unavailable(self):
        self.assertEqual(parse_state(""), {"available": False})
        self.assertFalse(parse_state("%1|20|0|24|tree-mode")["available"])

    def test_relative_movement_uses_history_when_the_program_does_not_request_mouse(self):
        self.state(0)
        for lines, expected in [(-12, 12), (-8, 20), (5, 15), (48, 0)]:
            output = subprocess.check_output(
                ["sh", "-c", scroll_script(self.base, "history", lines=lines)],
                env=self.env, text=True, timeout=3,
            )
            self.assertEqual(parse_state(output)["offset"], expected)


@unittest.skipUnless(shutil.which("tmux"), "tmux is required for isolated wheel tests")
class ApplicationWheelTest(unittest.TestCase):
    def setUp(self):
        self.base = ["tmux", "-L", f"codex-wheel-test-{os.getpid()}-{uuid.uuid4().hex[:8]}"]
        self.env = {k: v for k, v in os.environ.items() if k not in ("TMUX", "TMUX_PANE")}
        self.temp = tempfile.TemporaryDirectory()
        self.receipt = os.path.join(self.temp.name, "input.hex")
        self.fixture = os.path.join(self.temp.name, "fixture.py")
        with open(self.fixture, "w") as file:
            file.write('''import os, signal, sys, tty
tty.setraw(0)
def disable_mouse(*args):
    sys.stdout.write("\\x1b[?1000l\\x1b[?1006l")
    sys.stdout.flush()
signal.signal(signal.SIGUSR1, disable_mouse)
sys.stdout.write("\\x1b[?1000h" + ("\\x1b[?1006h" if sys.argv[2] == "sgr" else ""))
if sys.argv[2] == "utf8":
    sys.stdout.write("\\x1b[?1005h")
sys.stdout.flush()
received = b""
while True:
    received += os.read(0, 4096)
    with open(sys.argv[1], "w") as file:
        file.write(received.hex())
''')

    def tearDown(self):
        subprocess.run([*self.base, "kill-server"], env=self.env, capture_output=True)
        self.temp.cleanup()

    def start(self, protocol):
        command = shlex.join([sys.executable, self.fixture, self.receipt, protocol])
        subprocess.check_call([*self.base, "-f", "/dev/null", "new-session", "-d", "-s", "app",
                               "-x", "80", "-y", "20", command], env=self.env)
        for _ in range(60):
            if self.state().get("target") == "application":
                return
            time.sleep(0.02)
        self.fail("Mouse-enabled fixture did not become ready")

    def state(self, **operation):
        output = subprocess.check_output(["sh", "-c", scroll_script(self.base, "app", **operation)],
                                         env=self.env, text=True, timeout=3)
        return parse_state(output)

    def assert_received(self, expected):
        for _ in range(60):
            if os.path.exists(self.receipt):
                with open(self.receipt) as file:
                    if file.read() == expected.hex():
                        return
            time.sleep(0.02)
        with open(self.receipt) as file:
            self.assertEqual(file.read(), expected.hex())

    def test_sgr_wheel_moves_internal_history_even_in_a_normal_buffer(self):
        self.start("sgr")
        self.assertEqual(self.state()["history"], 0)
        self.state(lines=-3, col=7, row=8)
        self.state(lines=2, col=9999, row=9999)
        self.assert_received(b"\x1b[<64;7;8M" * 3 + b"\x1b[<65;80;20M" * 2)

    def test_explicit_bottom_delivers_one_escape(self):
        self.start("sgr")
        self.state(action="bottom")
        self.assert_received(b"\x1b")

    def test_input_mode_restore_does_not_deliver_escape(self):
        self.start("sgr")
        self.state(offset=0)
        time.sleep(0.1)
        self.assertFalse(os.path.exists(self.receipt))

    def test_bottom_leaves_copy_mode_before_delivering_escape(self):
        self.start("sgr")
        subprocess.check_call([*self.base, "copy-mode", "-t", "=app:"], env=self.env)
        self.assertEqual(self.state()["target"], "history")
        self.assertEqual(self.state(action="bottom")["target"], "application")
        self.assert_received(b"\x1b")

    def test_bottom_does_not_send_escape_after_mouse_is_disabled(self):
        self.start("sgr")
        pid = subprocess.check_output([*self.base, "display-message", "-p", "-t", "=app:", "#{pane_pid}"],
                                      env=self.env, text=True).strip()
        script = scroll_script(self.base, "app", action="bottom")
        command = f'  {shlex.join(self.base)} if-shell'
        script = script.replace(command, f'kill -USR1 {int(pid)}; sleep 0.1\n' + command)
        output = subprocess.check_output(["sh", "-c", script], env=self.env, text=True, timeout=3)
        self.assertEqual(parse_state(output)["target"], "history")
        self.assertFalse(os.path.exists(self.receipt))

    def test_other_tmux_menu_rejects_bottom_without_escape(self):
        self.start("sgr")
        subprocess.check_call([*self.base, "choose-tree", "-t", "=app:"], env=self.env)
        result = subprocess.run(["sh", "-c", scroll_script(self.base, "app", action="bottom")],
                                env=self.env, capture_output=True, timeout=3)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(os.path.exists(self.receipt))

    def test_legacy_mouse_protocol_receives_only_wheel_bytes(self):
        self.start("legacy")
        self.state(lines=-2, col=7, row=8)
        self.state(lines=1, col=7, row=8)
        self.assert_received(b"\x1b[M\x60\x27\x28" * 2 + b"\x1b[M\x61\x27\x28")

    def test_copy_mode_does_not_deliver_application_wheel(self):
        self.start("sgr")
        subprocess.check_call([*self.base, "copy-mode", "-t", "=app:"], env=self.env)
        self.assertEqual(self.state()["target"], "history")
        self.state(lines=-12, col=7, row=8)
        time.sleep(0.1)
        self.assertFalse(os.path.exists(self.receipt))

    def test_utf8_mouse_coordinates_are_encoded_without_truncation(self):
        self.start("utf8")
        subprocess.check_call([*self.base, "resize-window", "-t", "=app:", "-x", "4096", "-y", "160"],
                              env=self.env)
        self.state(lines=-1, col=2048, row=140)
        self.assert_received(b"\x1b[M\x60" + chr(2048 + 32).encode() + chr(140 + 32).encode())

    def test_send_time_guard_blocks_wheel_after_the_program_disables_mouse(self):
        self.start("sgr")
        pid = subprocess.check_output([*self.base, "display-message", "-p", "-t", "=app:", "#{pane_pid}"],
                                      env=self.env, text=True).strip()
        script = scroll_script(self.base, "app", lines=-2, col=7, row=8)
        script = script.replace('  condition=', f'  kill -USR1 {int(pid)}; sleep 0.1\n  condition=')
        output = subprocess.check_output(["sh", "-c", script], env=self.env, text=True, timeout=3)
        self.assertEqual(parse_state(output)["target"], "history")
        self.assertFalse(os.path.exists(self.receipt))

    def test_other_tmux_menu_is_rejected_without_application_input(self):
        self.start("sgr")
        subprocess.check_call([*self.base, "choose-tree", "-t", "=app:"], env=self.env)
        self.assertFalse(self.state()["available"])
        result = subprocess.run(["sh", "-c", scroll_script(self.base, "app", lines=-12)],
                                env=self.env, capture_output=True, timeout=3)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(os.path.exists(self.receipt))

    @unittest.skipUnless(shutil.which("zsh"), "zsh is required for remote login-shell compatibility")
    def test_wheel_script_runs_under_zsh(self):
        self.start("sgr")
        subprocess.check_output(["zsh", "-fc", scroll_script(self.base, "app", lines=-2, col=7, row=8)],
                                env=self.env, text=True, timeout=3)
        self.assert_received(b"\x1b[<64;7;8M" * 2)


class ScrollRequestTest(unittest.TestCase):
    def test_explicit_bottom_is_a_fixed_operation(self):
        request = ScrollRequest(session_id="session", action="bottom")
        self.assertEqual(request.action, "bottom")
        for operation in ({"action": "Escape"}, {"action": "bottom", "offset": 0},
                          {"action": "bottom", "lines": -1}, {"action": "bottom", "text": "command"}):
            with self.subTest(operation=operation), self.assertRaises(ValidationError):
                ScrollRequest(session_id="session", **operation)

    def test_rejects_arbitrary_input_and_invalid_operations(self):
        for operation in ({}, {"offset": 0, "lines": -1}, {"lines": 0}, {"lines": 49},
                          {"lines": -49}, {"lines": -1, "col": 0}, {"lines": -1, "row": 10001},
                          {"lines": -1, "text": "command"}, {"lines": -1, "button": 0},
                          {"lines": -1, "col": "$(printf injected)"}):
            with self.subTest(operation=operation), self.assertRaises(ValidationError):
                ScrollRequest(session_id="session", **operation)

    def test_reads_target_metadata_without_guessing_from_alternate_screen(self):
        self.assertEqual(parse_state("%1|2|0|24||1|1|80|0")["target"], "application")
        self.assertEqual(parse_state("%1|2|0|24|copy-mode|1|1|80|0")["target"], "history")
        self.assertEqual(parse_state("%1|2|0|24||0|0|80|0")["target"], "history")
        self.assertFalse(parse_state("%1|2|0|24||bad|0|80|0")["available"])


class ScrollAuthorizationTest(unittest.IsolatedAsyncioTestCase):
    async def test_routes_prevent_caching_terminal_content(self):
        with patch("routes.terminal_scroll.scroll_terminal", AsyncMock(return_value={"available": True})):
            for call in (
                lambda response: get_scroll(response, "session", username="me"),
                lambda response: set_scroll(
                    ScrollRequest(session_id="session", offset=0), response, username="me"
                ),
            ):
                with self.subTest(call=call):
                    response = Response()
                    self.assertEqual(await call(response), {"available": True})
                    self.assertEqual(response.headers["Cache-Control"], "no-store")

    async def test_unknown_or_foreign_local_owner_is_rejected_before_tmux(self):
        for owner in [None, "someone-else"]:
            with (
                patch("routes.terminal_scroll.storage.get_session_owner", AsyncMock(return_value=owner)),
                patch("routes.terminal_scroll.asyncio.create_subprocess_exec") as spawn,
            ):
                with self.assertRaises(HTTPException) as error:
                    await scroll_terminal("me", "session", None, 50)
                self.assertEqual(error.exception.status_code, 404)
                spawn.assert_not_called()

    async def test_foreign_owner_cannot_deliver_wheel(self):
        with (patch("routes.terminal_scroll.storage.get_session_owner", AsyncMock(return_value="other")),
              patch("routes.terminal_scroll.asyncio.create_subprocess_exec") as spawn):
            with self.assertRaises(HTTPException) as error:
                await scroll_terminal("me", "session", None, lines=-12)
            self.assertEqual(error.exception.status_code, 404)
            spawn.assert_not_called()

    async def test_foreign_owner_cannot_deliver_bottom_escape(self):
        with (patch("routes.terminal_scroll.storage.get_session_owner", AsyncMock(return_value="other")),
              patch("routes.terminal_scroll.asyncio.create_subprocess_exec") as spawn):
            with self.assertRaises(HTTPException) as error:
                await scroll_terminal("me", "session", None, action="bottom")
            self.assertEqual(error.exception.status_code, 404)
            spawn.assert_not_called()

    async def test_remote_bottom_uses_the_owned_host_and_fixed_escape(self):
        with (patch("routes.terminal_scroll.resolve_host_with_secrets",
                    AsyncMock(return_value=({"id": "h"}, {}))) as resolve,
              patch("routes.terminal_scroll.run_remote_cmd_pooled",
                    AsyncMock(return_value=(0, "%1|0|0|24||1|1|80|0", ""))) as run):
            await scroll_terminal("me", "app", "h", action="bottom")
            resolve.assert_awaited_once_with("h", "me")
            self.assertIn('"send-keys -t $pane -H 1b"', run.call_args.args[2])
            self.assertIn("if-shell -F", run.call_args.args[2])

    async def test_remote_wheel_uses_the_owned_host_and_same_guarded_script(self):
        with (patch("routes.terminal_scroll.resolve_host_with_secrets",
                    AsyncMock(return_value=({"id": "h"}, {}))) as resolve,
              patch("routes.terminal_scroll.run_remote_cmd_pooled",
                    AsyncMock(return_value=(0, "%1|0|0|24||1|1|80|0", ""))) as run):
            state = await scroll_terminal("me", "app", "h", lines=-12, col=7, row=8)
            resolve.assert_awaited_once_with("h", "me")
            self.assertEqual(state["target"], "application")
            self.assertIn("if-shell -F", run.call_args.args[2])

    async def test_remote_uses_owned_host_and_quotes_session(self):
        with (
            patch(
                "routes.terminal_scroll.resolve_host_with_secrets", AsyncMock(return_value=({"id": "h"}, {}))
            ) as resolve,
            patch(
                "routes.terminal_scroll.run_remote_cmd_pooled",
                AsyncMock(return_value=(0, "%1|100|30|20|copy-mode", "")),
            ) as run,
        ):
            state = await scroll_terminal("me", "session", "h", 30)
            resolve.assert_awaited_once_with("h", "me")
            self.assertEqual(state["offset"], 30)
            self.assertIn("scroll-up", run.call_args.args[2])


if __name__ == "__main__":
    unittest.main()

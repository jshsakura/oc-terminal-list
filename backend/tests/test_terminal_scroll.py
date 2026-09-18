"""Scrollbar controls must address tmux history, never type into a user's shell."""

import os
import shutil
import subprocess
import sys
import time
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fastapi import HTTPException, Response

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

    def test_malformed_or_other_mode_is_unavailable(self):
        self.assertEqual(parse_state(""), {"available": False})
        self.assertFalse(parse_state("%1|20|0|24|tree-mode")["available"])


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

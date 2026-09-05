"""`run_remote_cmd_pooled` — 짧은 원격 명령은 연결을 재사용하고, tailscale 은 그대로 서브프로세스다."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import host_common

HOST = {"id": "h1", "auth_method": "key", "hostname": "h", "ssh_user": "u"}
SECRETS = {"private_key": "k", "passphrase": None, "password": None}


async def test_풀을_지나고_stdin_과_종료코드를_그대로_넘긴다():
    result = SimpleNamespace(exit_status=3, stdout="out", stderr="err")
    run = AsyncMock(return_value=result)
    with patch("ssh_pool.ssh_pool.run", run):
        rc, out, err = await host_common.run_remote_cmd_pooled(HOST, SECRETS, "itl", stdin_data="src")
    assert (rc, out, err) == (3, "out", "err")
    host_id, _opener, cmd = run.await_args.args
    assert host_id == "h1" and cmd == "itl"
    assert run.await_args.kwargs == {"check": False, "input": "src"}


async def test_tailscale_은_풀을_안_쓴다():
    """재사용할 asyncssh 연결이 없다 — 서브프로세스 갈래 그대로."""
    with (
        patch("ssh_pool.ssh_pool.run", AsyncMock()) as pooled,
        patch.object(host_common, "run_remote_cmd_full", AsyncMock(return_value=(0, "", ""))) as full,
    ):
        await host_common.run_remote_cmd_pooled({**HOST, "auth_method": "tailscale"}, SECRETS, "x")
    pooled.assert_not_awaited()
    full.assert_awaited_once()


async def test_id_없는_호스트는_새_연결로_떨어진다():
    with patch.object(host_common, "run_remote_cmd_full", AsyncMock(return_value=(0, "", ""))) as full:
        await host_common.run_remote_cmd_pooled({**HOST, "id": ""}, SECRETS, "x")
    full.assert_awaited_once()

"""`run_remote_cmd_full` 의 tailscale 갈래 — 상한에 걸리면 프로세스를 죽인다.

`asyncio.wait_for` 는 `communicate()` 만 취소한다. 프로세스를 그대로 두면 `tailscale ssh`
가 매달린 채 남아 상한을 둔 뜻이 없어진다(asyncssh 갈래는 finally 가 conn 을 닫는다).
"""
from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest

import host_common


class _HangingProc:
    returncode = None

    def __init__(self):
        self.killed = False

    async def communicate(self, input=None):
        await asyncio.sleep(10)
        return b"", b""

    def kill(self):
        self.killed = True


async def test_타임아웃이면_프로세스를_죽인다():
    proc = _HangingProc()

    async def fake_exec(*_a, **_kw):
        return proc

    with patch("asyncio.create_subprocess_exec", fake_exec):
        with pytest.raises(asyncio.TimeoutError):
            await host_common.run_remote_cmd_full(
                {"auth_method": "tailscale", "hostname": "h", "ssh_user": "u"}, {}, "true",
                timeout=0.01,
            )
    assert proc.killed

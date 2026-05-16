"""호스트 라우터 공용 헬퍼: 시크릿 해석 + 원격 명령 실행."""
from __future__ import annotations

import asyncio
import logging

from fastapi import HTTPException

from host_manager import resolve_host_secrets
from sqlite_storage import storage

logger = logging.getLogger(__name__)


async def resolve_host_with_secrets(host_id: str, username: str) -> tuple:
    host = await storage.get_host(host_id, username)
    if not host:
        raise HTTPException(status_code=404, detail="호스트를 찾을 수 없습니다")
    key_record = None
    if host.get("auth_method") == "key" and host.get("key_id"):
        key_record = await storage.get_ssh_key(host["key_id"], username)
        if not key_record:
            raise HTTPException(status_code=400, detail="연결된 SSH 키를 찾을 수 없음")
    secrets = resolve_host_secrets(host, key_record)
    return host, secrets


async def run_remote_cmd(host: dict, secrets: dict, cmd: str, timeout: float = 10.0) -> str:
    """원격 호스트에서 셸 명령을 실행하고 stdout 문자열을 반환. tailscale/SSH 자동 분기."""
    if host.get("auth_method") == "tailscale":
        target = f"{host.get('ssh_user') or 'root'}@{host['hostname']}"
        proc = await asyncio.create_subprocess_exec(
            "tailscale", "ssh", target, cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return stdout.decode("utf-8", errors="replace")
    from host_manager import open_connection
    conn = await open_connection(
        host,
        private_key=secrets["private_key"],
        passphrase=secrets["passphrase"],
        password=secrets["password"],
    )
    try:
        result = await asyncio.wait_for(conn.run(cmd, check=False), timeout=timeout)
        return (result.stdout if isinstance(result.stdout, str) else (result.stdout or b"").decode("utf-8", errors="replace"))
    finally:
        conn.close()
        await conn.wait_closed()


MAX_COMMIT_MESSAGE_LEN = 4000
MAX_REMOTE_PATH_LEN = 4096
MAX_UPLOAD_FILE_BYTES = 200 * 1024 * 1024
MAX_UPLOAD_TOTAL_BYTES = 500 * 1024 * 1024
MAX_UPLOAD_FILES = 200

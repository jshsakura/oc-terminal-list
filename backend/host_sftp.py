"""
호스트 SFTP 파일 브라우징.

asyncssh SFTP 클라이언트를 사용해 원격 호스트의 디렉토리 목록 / 파일 읽기 / 쓰기.
연결은 host_id 기준으로 풀링 → 매 요청마다 SSH 핸드셰이크 안 하게.

연결 idle TTL = 5분. TTL 지나면 자동 close.
"""
from __future__ import annotations

import asyncio
import logging
import time

import asyncssh

from host_manager import HostConnectError, open_connection

logger = logging.getLogger(__name__)

CONNECTION_IDLE_TTL = 300  # 5분
MAX_FILE_BYTES = 10 * 1024 * 1024  # 10MB 읽기 상한

# host_id → (conn, last_used_ts)
_pool: dict[str, tuple[asyncssh.SSHClientConnection, float]] = {}
_pool_lock = asyncio.Lock()


async def _get_or_open(host: dict, secrets: dict) -> asyncssh.SSHClientConnection:
    """풀에서 연결 꺼내거나 새로 연다. idle TTL 만료된 건 close 후 재연결."""
    host_id = host["id"]
    now = time.monotonic()
    async with _pool_lock:
        cached = _pool.get(host_id)
        if cached:
            conn, last = cached
            if (now - last) < CONNECTION_IDLE_TTL and not conn.is_closed():
                _pool[host_id] = (conn, now)
                return conn
            # 만료/닫힘 → 정리
            try:
                conn.close()
            except Exception:
                pass
            _pool.pop(host_id, None)

        conn = await open_connection(
            host,
            private_key=secrets.get("private_key"),
            passphrase=secrets.get("passphrase"),
            password=secrets.get("password"),
        )
        _pool[host_id] = (conn, now)
        return conn


def _drop(host_id: str) -> None:
    cached = _pool.pop(host_id, None)
    if cached:
        try: cached[0].close()
        except Exception: pass


async def list_directory(host: dict, secrets: dict, path: str = ".") -> dict:
    """원격 디렉토리 목록. {items, resolved} 반환.

    path 가 빈문자열/None 이면 "." (홈) 사용.
    숨김 파일 (`.` prefix) 은 포함 (프론트에서 필요 시 필터).
    resolved 는 sftp.realpath 결과 — 프론트가 "상위 폴더로 이동" 같은 절대경로 기반
    UI 를 할 수 있게 노출.
    """
    target = path.strip() if path else "."
    if not target:
        target = "."
    try:
        conn = await _get_or_open(host, secrets)
        async with conn.start_sftp_client() as sftp:
            # ~ 확장은 SFTP 가 안 해줌 → realpath 로 변환. ~/ 시작이면 환경에서 $HOME 으로 풀어줌.
            candidate = target
            if candidate.startswith("~"):
                # SFTP 표준은 ~ 미지원 → '.' (= 로그인 홈) 으로 시작해 상대 경로로 변환
                if candidate in ("~", "~/"):
                    candidate = "."
                elif candidate.startswith("~/"):
                    candidate = candidate[2:]  # '~/foo/bar' → 'foo/bar'
            try:
                resolved = await sftp.realpath(candidate)
            except (OSError, asyncssh.SFTPError):
                # realpath 실패 → 홈 (".") 폴백
                resolved = await sftp.realpath(".")

            entries = await sftp.readdir(resolved)
            items: list[dict] = []
            for entry in entries:
                name = entry.filename
                if name in (".", ".."):
                    continue
                attrs = entry.attrs
                # type: directory / file / link
                kind = "file"
                if attrs.permissions is not None:
                    import stat
                    if stat.S_ISDIR(attrs.permissions):
                        kind = "directory"
                    elif stat.S_ISLNK(attrs.permissions):
                        kind = "link"
                items.append({
                    "name": name,
                    "path": f"{resolved.rstrip('/')}/{name}" if resolved != "/" else f"/{name}",
                    "type": kind,
                    "size": attrs.size if attrs.size is not None else None,
                    "modified": float(attrs.mtime) if attrs.mtime else None,
                })
            items.sort(key=lambda x: (x["type"] == "file", x["name"].lower()))
            return {"items": items, "resolved": resolved}
    except HostConnectError:
        _drop(host["id"])
        raise
    except (asyncssh.Error, OSError) as e:
        # 연결 자체는 살아있지만 sftp 가 실패 → 다음 시도용으로 일단 버림
        _drop(host["id"])
        raise HostConnectError(f"SFTP listdir failed: {e}") from e


async def read_file(host: dict, secrets: dict, path: str) -> str:
    """원격 파일을 텍스트로 읽음 (utf-8, errors=replace). 10MB 상한."""
    if not path or not path.strip():
        raise HostConnectError("path is required")
    try:
        conn = await _get_or_open(host, secrets)
        async with conn.start_sftp_client() as sftp:
            try:
                attrs = await sftp.stat(path)
            except (OSError, asyncssh.SFTPError) as e:
                raise HostConnectError(f"file not found: {path}") from e
            if attrs.size is not None and attrs.size > MAX_FILE_BYTES:
                raise HostConnectError(f"file too large (>{MAX_FILE_BYTES} bytes)")
            async with sftp.open(path, "rb") as f:
                data = await f.read(MAX_FILE_BYTES)
            return data.decode("utf-8", errors="replace")
    except HostConnectError:
        raise
    except (asyncssh.Error, OSError) as e:
        _drop(host["id"])
        raise HostConnectError(f"SFTP read failed: {e}") from e


async def write_file(host: dict, secrets: dict, path: str, content: str | bytes) -> None:
    """원격 파일 덮어쓰기."""
    if not path or not path.strip():
        raise HostConnectError("path is required")
    try:
        conn = await _get_or_open(host, secrets)
        async with conn.start_sftp_client() as sftp:
            async with sftp.open(path, "wb") as f:
                await f.write(content if isinstance(content, bytes) else content.encode("utf-8"))
    except (asyncssh.Error, OSError) as e:
        _drop(host["id"])
        raise HostConnectError(f"SFTP write failed: {e}") from e


async def create_item(host: dict, secrets: dict, path: str, kind: str) -> None:
    """원격 파일/폴더 생성."""
    try:
        conn = await _get_or_open(host, secrets)
        async with conn.start_sftp_client() as sftp:
            if kind == "directory":
                await sftp.mkdir(path)
            else:
                async with sftp.open(path, "wb") as f:
                    pass
    except (asyncssh.Error, OSError) as e:
        _drop(host["id"])
        raise HostConnectError(f"SFTP create failed: {e}") from e


async def move_item(host: dict, secrets: dict, source: str, destination: str) -> None:
    """원격 파일/폴더 이동(rename)."""
    try:
        conn = await _get_or_open(host, secrets)
        async with conn.start_sftp_client() as sftp:
            await sftp.rename(source, destination)
    except (asyncssh.Error, OSError) as e:
        _drop(host["id"])
        raise HostConnectError(f"SFTP move failed: {e}") from e


async def delete_item(host: dict, secrets: dict, path: str) -> None:
    """원격 파일/폴더 삭제."""
    try:
        conn = await _get_or_open(host, secrets)
        async with conn.start_sftp_client() as sftp:
            try:
                attrs = await sftp.stat(path)
                import stat
                if stat.S_ISDIR(attrs.permissions):
                    await sftp.rmdir(path)
                else:
                    await sftp.remove(path)
            except (asyncssh.Error, OSError) as e:
                # 폴더가 비어있지 않으면 rmdir 실패 가능성 있음. 
                # 하지만 sftp client 가 recursive remove 를 직접 지원하지 않으므로 단순 구현.
                raise e
    except (asyncssh.Error, OSError) as e:
        _drop(host["id"])
        raise HostConnectError(f"SFTP delete failed: {e}") from e


async def close_pool() -> None:
    """앱 종료 시 모든 풀 연결 정리."""
    async with _pool_lock:
        for _host_id, (conn, _) in list(_pool.items()):
            try:
                conn.close()
                await conn.wait_closed()
            except Exception:
                pass
        _pool.clear()

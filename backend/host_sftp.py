"""
호스트 SFTP 파일 브라우징/전송.

asyncssh SFTP 클라이언트로 원격 호스트의 목록/읽기/쓰기/전송을 담당한다.
연결 풀은 `sftp_pool`, Tailscale 호스트(asyncssh 연결이 없다)는 `sftp_tailscale`.

**전송은 전부 스트리밍이다.** 파일 하나를 통째로 메모리에 올리면 200MB × 동시 N 이
그대로 RSS 가 된다. 업로드는 청크를 받아 바로 흘리고, 다운로드는 청크를 바로 내보내며,
폴더 zip 도 파일 하나씩 압축해 내보낸다(전체 zip 을 RAM 에 만들지 않는다).
"""
from __future__ import annotations

import logging
import os
import posixpath
import shlex
import stat
import zipfile

import asyncssh

import sftp_tailscale as _ts
from host_manager import HostConnectError
from sftp_pool import (
    CHUNK_BYTES,
    MAX_DOWNLOAD_BYTES,
    MAX_DOWNLOAD_FILES,
    MAX_FILE_BYTES,
    MAX_REMOTE_PATH_LEN,
    close_pool,
    drop,
    get_or_open,
    touch,
    validate_remote_path,
)

logger = logging.getLogger(__name__)

__all__ = [
    "MAX_FILE_BYTES", "MAX_DOWNLOAD_BYTES", "MAX_DOWNLOAD_FILES", "MAX_REMOTE_PATH_LEN",
    "CHUNK_BYTES", "validate_remote_path", "close_pool",
    "list_directory", "read_file", "read_file_bytes",
    "download_item", "download_items", "open_download",
    "write_file", "upload_stream", "make_dirs", "path_exists",
    "create_item", "move_item", "copy_item", "delete_item", "chmod_item",
    "get_tmux_cwd", "get_tmux_cwds", "remote_home",
]

# 풀 함수는 **모듈 전역 이름**으로 들고 있는다 — 이 이름을 통해서만 호출해야
# 테스트의 monkeypatch(host_sftp._get_or_open) 가 실제로 먹는다.
_get_or_open = get_or_open
_drop = drop


def _is_tailscale(host: dict) -> bool:
    return (host.get("auth_method") or "key").lower() == "tailscale"


def _child_path(parent: str, name: str) -> str:
    return f"/{name}" if parent == "/" else f"{parent.rstrip('/')}/{name}"


def _is_dir_attrs(attrs: asyncssh.SFTPAttrs) -> bool:
    return attrs.permissions is not None and stat.S_ISDIR(attrs.permissions)


def _is_link_attrs(attrs: asyncssh.SFTPAttrs) -> bool:
    return attrs.permissions is not None and stat.S_ISLNK(attrs.permissions)


def _kind_of(attrs: asyncssh.SFTPAttrs) -> str:
    if attrs.permissions is None:
        return "file"
    if stat.S_ISDIR(attrs.permissions):
        return "directory"
    if stat.S_ISLNK(attrs.permissions):
        return "link"
    return "file"


# ─── 목록 ─────────────────────────────────────────────────────────────────────

async def _statvfs(sftp, path: str) -> dict | None:
    """남은 디스크 용량. statvfs 는 SFTP 확장이라 서버가 거절할 수 있다 — 없으면 None."""
    try:
        vfs = await sftp.statvfs(path)
        return {"total": vfs.blocks * vfs.frsize, "free": vfs.bavail * vfs.frsize}
    except Exception:
        return None


async def list_directory(host: dict, secrets: dict, path: str = ".") -> dict:
    """원격 디렉토리 목록. `{items, resolved, fs}` 반환.

    각 항목은 name/path/type/size/modified 에 더해 **mode·uid·gid·link_target** 을 싣는다 —
    권한 열과 chmod UI 가 목록 한 번으로 그려지도록. 소유자 *이름* 은 SFTP 로 알 수 없어
    숫자만 넘긴다(상용 클라이언트도 이름 해석이 안 되면 숫자를 보여준다).

    path 가 빈문자열/None 이면 "." (홈) 사용. 숨김 파일은 포함(프론트에서 필터).
    """
    if _is_tailscale(host):
        return await _ts.list_directory(host, path)
    target = (path.strip() if path else ".") or "."
    try:
        conn = await _get_or_open(host, secrets)
        async with conn.start_sftp_client() as sftp:
            # ~ 확장은 SFTP 가 안 해줌 → realpath 로 변환. SFTP 표준은 ~ 미지원이라
            # '.' (= 로그인 홈) 기준 상대 경로로 바꿔 넘긴다.
            candidate = target
            if candidate in ("~", "~/"):
                candidate = "."
            elif candidate.startswith("~/"):
                candidate = candidate[2:]
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
                kind = _kind_of(attrs)
                link_target = None
                if kind == "link":
                    try:
                        link_target = await sftp.readlink(_child_path(resolved, name))
                    except Exception:
                        link_target = None
                items.append({
                    "name": name,
                    "path": _child_path(resolved, name),
                    "type": kind,
                    "size": attrs.size if attrs.size is not None else None,
                    "modified": float(attrs.mtime) if attrs.mtime else None,
                    "mode": stat.S_IMODE(attrs.permissions) if attrs.permissions is not None else None,
                    "uid": attrs.uid,
                    "gid": attrs.gid,
                    "link_target": link_target,
                })
            items.sort(key=lambda x: (x["type"] == "file", x["name"].lower()))
            return {"items": items, "resolved": resolved, "fs": await _statvfs(sftp, resolved)}
    except HostConnectError:
        _drop(host["id"])
        raise
    except (asyncssh.Error, OSError) as e:
        # 연결 자체는 살아있지만 sftp 가 실패 → 다음 시도용으로 일단 버림
        _drop(host["id"])
        raise HostConnectError(f"SFTP listdir failed: {e}") from e


# ─── 읽기 ─────────────────────────────────────────────────────────────────────

async def read_file(host: dict, secrets: dict, path: str) -> str:
    """원격 파일을 텍스트로 읽음 (utf-8, errors=replace). 10MB 상한."""
    return (await read_file_bytes(host, secrets, path)).decode("utf-8", errors="replace")


async def read_file_bytes(host: dict, secrets: dict, path: str) -> bytes:
    """원격 파일을 바이너리로 읽음. 10MB 상한 (에디터가 여는 크기)."""
    path = validate_remote_path(path)
    if _is_tailscale(host):
        return await _ts.read_file_bytes(host, path)
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
                return await f.read(MAX_FILE_BYTES)
    except HostConnectError:
        raise
    except (asyncssh.Error, OSError) as e:
        _drop(host["id"])
        raise HostConnectError(f"SFTP read failed: {e}") from e


# ─── 다운로드 (스트리밍) ──────────────────────────────────────────────────────

class _ZipSink:
    """zipfile 이 쓰는 대로 받아두었다가 청크째 꺼내주는 비-seekable 싱크.

    `seek` 를 **일부러 정의하지 않는다** — zipfile 은 seek 가 없으면 non-seekable 모드로
    돌면서 data descriptor 를 쓴다. seek 를 흉내내면 zipfile 이 되감기를 시도하는데
    이미 내보낸 바이트는 되돌릴 수 없어 아카이브가 깨진다.
    """

    def __init__(self) -> None:
        self._buf = bytearray()
        self._pos = 0

    def write(self, data) -> int:
        self._buf += data
        self._pos += len(data)
        return len(data)

    def tell(self) -> int:
        return self._pos

    def flush(self) -> None:
        pass

    def drain(self) -> bytes:
        out = bytes(self._buf)
        self._buf.clear()
        return out


async def _walk_files(sftp, root: str, base: str):
    """`(원격경로, 아카이브 경로)` 순회. 빈 디렉토리는 `(None, 'dir/')` 로 나온다.

    심볼릭 링크는 건너뛴다 — 따라 들어가면 순환에 빠지거나 대상 밖의 트리를 빨아들인다.
    """
    try:
        attrs = await sftp.stat(root)
    except (OSError, asyncssh.SFTPError) as e:
        raise HostConnectError(f"path not found: {root}") from e
    if not _is_dir_attrs(attrs):
        yield root, posixpath.relpath(root, base)
        return

    stack = [root]
    while stack:
        current = stack.pop()
        entries = [e for e in await sftp.readdir(current) if e.filename not in (".", "..")]
        if not entries:
            # 빈 디렉토리도 아카이브에 남긴다 — 없으면 압축을 풀 때 사라진다.
            yield None, posixpath.relpath(current, base).rstrip("/") + "/"
            continue
        for entry in entries:
            child = _child_path(current, entry.filename)
            if _is_link_attrs(entry.attrs):
                continue
            if _is_dir_attrs(entry.attrs):
                stack.append(child)
                continue
            yield child, posixpath.relpath(child, base)


async def _zip_stream(sftp, host_id: str, paths: list[str]):
    """여러 경로를 zip 으로 **흘려보낸다**. 전체를 RAM 에 만들지 않는다."""
    sink = _ZipSink()
    total = 0
    count = 0
    with zipfile.ZipFile(sink, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in paths:
            base = posixpath.dirname(path.rstrip("/")) or "/"
            async for remote, arc in _walk_files(sftp, path, base):
                if remote is None:  # 빈 디렉토리 엔트리
                    zf.writestr(arc, b"")
                    chunk = sink.drain()
                    if chunk:
                        yield chunk
                    continue
                count += 1
                if count > MAX_DOWNLOAD_FILES:
                    raise HostConnectError(f"download too large (>{MAX_DOWNLOAD_FILES} files)")
                with zf.open(arc, "w") as dest:
                    async with sftp.open(remote, "rb") as src:
                        while True:
                            data = await src.read(CHUNK_BYTES)
                            if not data:
                                break
                            total += len(data)
                            if total > MAX_DOWNLOAD_BYTES:
                                raise HostConnectError(
                                    f"download too large (>{MAX_DOWNLOAD_BYTES} bytes)")
                            dest.write(data)
                            touch(host_id)
                            out = sink.drain()
                            if out:
                                yield out
                out = sink.drain()
                if out:
                    yield out
    tail = sink.drain()
    if tail:
        yield tail


async def open_download(host: dict, secrets: dict, paths: list[str]):
    """`(filename, media_type, async_generator)` 반환. 호출자가 StreamingResponse 로 감싼다.

    파일 하나면 원본 그대로, 폴더이거나 여러 개면 zip 으로 묶는다.
    """
    paths = [validate_remote_path(p) for p in paths]
    if not paths:
        raise HostConnectError("path is required")

    if _is_tailscale(host):
        return await _open_download_tailscale(host, paths)

    conn = await _get_or_open(host, secrets)
    sftp_ctx = conn.start_sftp_client()
    sftp = await sftp_ctx.__aenter__()
    try:
        single_file = False
        if len(paths) == 1:
            try:
                attrs = await sftp.stat(paths[0])
            except (OSError, asyncssh.SFTPError) as e:
                raise HostConnectError(f"path not found: {paths[0]}") from e
            single_file = not _is_dir_attrs(attrs)
            if single_file and attrs.size is not None and attrs.size > MAX_DOWNLOAD_BYTES:
                raise HostConnectError(f"download too large (>{MAX_DOWNLOAD_BYTES} bytes)")
    except Exception:
        await sftp_ctx.__aexit__(None, None, None)
        raise

    host_id = host["id"]

    if single_file:
        filename = os.path.basename(paths[0].rstrip("/")) or "download"

        async def gen_file():
            try:
                async with sftp.open(paths[0], "rb") as f:
                    while True:
                        data = await f.read(CHUNK_BYTES)
                        if not data:
                            break
                        touch(host_id)
                        yield data
            finally:
                await sftp_ctx.__aexit__(None, None, None)

        return filename, "application/octet-stream", gen_file()

    if len(paths) > 1:
        filename = f"download-{len(paths)}-items.zip"
    else:
        base = os.path.basename(paths[0].rstrip("/")) or "download"
        filename = base if base.lower().endswith(".zip") else f"{base}.zip"

    async def gen_zip():
        try:
            async for chunk in _zip_stream(sftp, host_id, paths):
                yield chunk
        finally:
            await sftp_ctx.__aexit__(None, None, None)

    return filename, "application/zip", gen_zip()


async def _open_download_tailscale(host: dict, paths: list[str]):
    """Tailscale 은 원격 python 이 묶어서 stdout 으로 뱉는다 — 여기서는 이미 받은 뒤 쪼갠다."""
    data, filename, media_type = await _ts.download_items(host, paths)

    async def gen():
        for i in range(0, len(data), CHUNK_BYTES):
            yield data[i:i + CHUNK_BYTES]

    return filename, media_type, gen()


async def download_items(host: dict, secrets: dict, paths: list[str]) -> tuple[bytes, str, str]:
    """`open_download` 의 버퍼링 버전 — 작은 항목/테스트용."""
    filename, media_type, gen = await open_download(host, secrets, paths)
    buf = bytearray()
    async for chunk in gen:
        buf += chunk
    return bytes(buf), filename, media_type


async def download_item(host: dict, secrets: dict, path: str) -> tuple[bytes, str, str]:
    """단건 다운로드(하위호환). 폴더는 zip 바이트."""
    return await download_items(host, secrets, [path])


# ─── 업로드 / 쓰기 (스트리밍) ─────────────────────────────────────────────────

async def _sftp_makedirs(sftp, path: str) -> None:
    """`mkdir -p` 상당. 이미 있으면 넘어간다 — 없는 채로 남으면 다음 단계가 실패로 알려준다."""
    parts = [p for p in path.split("/") if p]
    current = "/" if path.startswith("/") else ""
    for part in parts:
        current = _child_path(current, part) if current else part
        try:
            await sftp.mkdir(current)
        except (OSError, asyncssh.SFTPError):
            pass


async def make_dirs(host: dict, secrets: dict, path: str) -> None:
    """중간 경로까지 한번에 만든다 (폴더 업로드가 쓴다)."""
    path = validate_remote_path(path)
    if _is_tailscale(host):
        return await _ts.create_item(host, path, "directory")
    try:
        conn = await _get_or_open(host, secrets)
        async with conn.start_sftp_client() as sftp:
            await _sftp_makedirs(sftp, path)
    except (asyncssh.Error, OSError) as e:
        _drop(host["id"])
        raise HostConnectError(f"SFTP mkdir failed: {e}") from e


async def upload_stream(
    host: dict, secrets: dict, path: str, chunks, make_parents: bool = True,
) -> int:
    """청크 async iterable 을 원격 파일로 흘려 쓴다. 반환값은 쓴 바이트 수.

    파일 전체를 메모리에 올리지 않는 것이 요점이다 — 큰 파일 동시 업로드가 OOM 을
    부르던 경로다. 중간에 실패하면 **반쪽 파일을 지운다**: 남겨두면 사용자는 전송이
    끝났다고 믿고, 깨진 파일을 원본으로 쓴다.
    """
    path = validate_remote_path(path)
    if _is_tailscale(host):
        if make_parents:
            parent = posixpath.dirname(path)
            if parent:
                await _ts.create_item(host, parent, "directory")
        return await _ts.upload_stream(host, path, chunks)

    host_id = host["id"]
    written = 0
    try:
        conn = await _get_or_open(host, secrets)
        async with conn.start_sftp_client() as sftp:
            if make_parents:
                parent = posixpath.dirname(path)
                if parent:
                    await _sftp_makedirs(sftp, parent)
            try:
                async with sftp.open(path, "wb") as f:
                    async for chunk in chunks:
                        if not chunk:
                            continue
                        await f.write(chunk)
                        written += len(chunk)
                        touch(host_id)
            except Exception:
                try:
                    await sftp.remove(path)
                except Exception:
                    pass
                raise
        return written
    except HostConnectError:
        raise
    except (asyncssh.Error, OSError) as e:
        _drop(host_id)
        raise HostConnectError(f"SFTP upload failed: {e}") from e


async def write_file(host: dict, secrets: dict, path: str, content: str | bytes) -> None:
    """원격 파일 덮어쓰기 (에디터 저장/붙여넣기 같은 작은 내용 전용)."""
    data = content if isinstance(content, bytes) else content.encode("utf-8")

    async def _once():
        yield data

    await upload_stream(host, secrets, path, _once(), make_parents=False)


async def path_exists(host: dict, secrets: dict, paths: list[str]) -> dict[str, bool]:
    """여러 경로의 존재 여부를 한 번에. 업로드 전 덮어쓰기 확인용."""
    paths = [validate_remote_path(p) for p in paths]
    if _is_tailscale(host):
        return await _ts.path_exists(host, paths)
    result: dict[str, bool] = {}
    try:
        conn = await _get_or_open(host, secrets)
        async with conn.start_sftp_client() as sftp:
            for p in paths:
                try:
                    await sftp.lstat(p)
                    result[p] = True
                except (OSError, asyncssh.SFTPError):
                    result[p] = False
        return result
    except (asyncssh.Error, OSError) as e:
        _drop(host["id"])
        raise HostConnectError(f"SFTP stat failed: {e}") from e


# ─── 생성 / 이동 / 복사 / 삭제 / 권한 ─────────────────────────────────────────

async def remote_home(host: dict, secrets: dict) -> str | None:
    """The SSH user's home, as the SFTP server resolves it.

    Needed because a path handed to the terminal must be absolute — the pane's
    cwd is arbitrary, so a relative "it works from home" path would not open.
    Tailscale hosts do not go through asyncssh; they ask the shell instead.
    """
    if _is_tailscale(host):
        try:
            stdout, _ = await _ts.run(_ts.target_for(host), "printf %s \"$HOME\"", timeout=6.0)
            return stdout.decode(errors="replace").strip() or None
        except Exception as e:
            logger.debug("remote_home tailscale failed (%s): %s", host.get("id"), e)
            return None
    try:
        conn = await _get_or_open(host, secrets)
        async with conn.start_sftp_client() as sftp:
            return await sftp.realpath(".")
    except (asyncssh.Error, OSError) as e:
        logger.debug("remote_home failed (%s): %s", host.get("id"), e)
        return None


async def create_item(host: dict, secrets: dict, path: str, kind: str) -> None:
    """원격 파일/폴더 생성."""
    path = validate_remote_path(path)
    if _is_tailscale(host):
        return await _ts.create_item(host, path, kind)
    try:
        conn = await _get_or_open(host, secrets)
        async with conn.start_sftp_client() as sftp:
            if kind == "directory":
                await _sftp_makedirs(sftp, path)
            else:
                async with sftp.open(path, "wb"):
                    pass
    except (asyncssh.Error, OSError) as e:
        _drop(host["id"])
        raise HostConnectError(f"SFTP create failed: {e}") from e


async def move_item(host: dict, secrets: dict, source: str, destination: str) -> None:
    """원격 파일/폴더 이동(rename)."""
    source = validate_remote_path(source)
    destination = validate_remote_path(destination)
    if _is_tailscale(host):
        return await _ts.move_item(host, source, destination)
    try:
        conn = await _get_or_open(host, secrets)
        async with conn.start_sftp_client() as sftp:
            await sftp.rename(source, destination)
    except (asyncssh.Error, OSError) as e:
        _drop(host["id"])
        raise HostConnectError(f"SFTP move failed: {e}") from e


async def copy_item(host: dict, secrets: dict, source: str, destination: str) -> None:
    """원격 안에서의 복사.

    SFTP 프로토콜에는 복사가 없다. 우리를 거쳐 read→write 하면 같은 기계 안의 복사에
    네트워크 왕복이 두 번 붙으므로, 셸의 `cp -a` 로 **원격이 직접** 하게 한다.
    """
    source = validate_remote_path(source)
    destination = validate_remote_path(destination)
    if _is_tailscale(host):
        return await _ts.copy_item(host, source, destination)
    cmd = f"cp -a -- {shlex.quote(source)} {shlex.quote(destination)}"
    try:
        conn = await _get_or_open(host, secrets)
        result = await conn.run(cmd, check=False)
        if result.exit_status != 0:
            err = result.stderr if isinstance(result.stderr, str) else ""
            raise HostConnectError(f"copy failed: {err.strip()[:200] or 'cp exited nonzero'}")
    except HostConnectError:
        raise
    except (asyncssh.Error, OSError) as e:
        _drop(host["id"])
        raise HostConnectError(f"SFTP copy failed: {e}") from e


async def _sftp_rmtree(sftp, root: str, host_id: str) -> None:
    """자식부터 지우고 마지막에 자기 자신.

    파이썬 재귀 대신 후위 스택 — 깊은 트리에서 재귀 한도에 걸리지 않게.
    """
    pending = [root]
    dirs_post: list[str] = []
    while pending:
        current = pending.pop()
        dirs_post.append(current)
        for entry in await sftp.readdir(current):
            if entry.filename in (".", ".."):
                continue
            child = _child_path(current, entry.filename)
            if _is_dir_attrs(entry.attrs) and not _is_link_attrs(entry.attrs):
                pending.append(child)
            else:
                await sftp.remove(child)
                touch(host_id)
    for directory in reversed(dirs_post):
        await sftp.rmdir(directory)
        touch(host_id)


async def delete_item(host: dict, secrets: dict, path: str, recursive: bool = True) -> None:
    """원격 파일/폴더 삭제.

    **폴더는 기본적으로 재귀 삭제한다.** `rmdir` 단발이던 시절에는 내용이 있는 폴더가
    지워지지 않았고, 사용자에게는 그냥 "삭제가 안 된다" 로만 보였다.
    심볼릭 링크는 링크 자체만 지운다 — 따라 들어가면 대상 트리를 날린다.
    """
    path = validate_remote_path(path)
    if _is_tailscale(host):
        return await _ts.delete_item(host, path, recursive)
    try:
        conn = await _get_or_open(host, secrets)
        async with conn.start_sftp_client() as sftp:
            try:
                attrs = await sftp.lstat(path)
            except (OSError, asyncssh.SFTPError) as e:
                raise HostConnectError(f"path not found: {path}") from e
            if _is_link_attrs(attrs) or not _is_dir_attrs(attrs):
                await sftp.remove(path)
                return
            if not recursive:
                await sftp.rmdir(path)
                return
            await _sftp_rmtree(sftp, path, host["id"])
    except HostConnectError:
        raise
    except (asyncssh.Error, OSError) as e:
        _drop(host["id"])
        raise HostConnectError(f"SFTP delete failed: {e}") from e


async def chmod_item(
    host: dict, secrets: dict, path: str, mode: int, recursive: bool = False,
) -> None:
    """원격 권한 변경. mode 는 8진 정수(0o644 등)."""
    path = validate_remote_path(path)
    if not isinstance(mode, int) or not 0 <= mode <= 0o7777:
        raise HostConnectError("invalid mode")
    if _is_tailscale(host):
        return await _ts.chmod_item(host, path, mode, recursive)
    try:
        conn = await _get_or_open(host, secrets)
        if recursive:
            result = await conn.run(f"chmod -R {mode:o} -- {shlex.quote(path)}", check=False)
            if result.exit_status != 0:
                raise HostConnectError("chmod failed")
            return
        async with conn.start_sftp_client() as sftp:
            await sftp.chmod(path, mode)
    except HostConnectError:
        raise
    except (asyncssh.Error, OSError) as e:
        _drop(host["id"])
        raise HostConnectError(f"SFTP chmod failed: {e}") from e


# ─── tmux cwd ─────────────────────────────────────────────────────────────────

async def get_tmux_cwd(host: dict, secrets: dict, session: str | None = None) -> str | None:
    """원격 호스트 tmux 세션의 현재 작업 디렉토리.
    session 지정 시 해당 세션 타겟, 실패하면 현재 활성 세션으로 폴백.
    Tailscale 호스트는 `tailscale ssh` 서브프로세스 사용 (asyncssh 미지원).
    """
    # Raspberry Pi / minimal distros sometimes expose a thinner non-login PATH over
    # ssh/tailscale ssh, and `display-message` can return empty when there is no
    # current client context. Resolve tmux explicitly and fall back to list-panes
    # against the exact session target so detached/attached remote tmux both work.
    target = session or ""
    qtarget = shlex.quote(target)
    target_arg = f"-t {qtarget}" if target else ""
    cmd = (
        "TMUX_BIN=$(command -v tmux 2>/dev/null); "
        "[ -n \"$TMUX_BIN\" ] || [ ! -x /usr/bin/tmux ] || TMUX_BIN=/usr/bin/tmux; "
        "[ -n \"$TMUX_BIN\" ] || [ ! -x /usr/local/bin/tmux ] || TMUX_BIN=/usr/local/bin/tmux; "
        "[ -n \"$TMUX_BIN\" ] || exit 0; "
        f"CWD=$($TMUX_BIN display-message {target_arg} -p '#{{pane_current_path}}' 2>/dev/null || true); "
        "if [ -n \"$CWD\" ]; then printf '%s\\n' \"$CWD\"; exit 0; fi; "
        f"$TMUX_BIN list-panes {target_arg} -F '#{{pane_active}}\t#{{pane_current_path}}' 2>/dev/null "
        "| awk -F '\\t' 'BEGIN{p=\"\"} $1==1{print $2; found=1; exit} !p{p=$2} END{if(!found && p) print p}'"
    )
    if _is_tailscale(host):
        return await _get_tmux_cwd_tailscale(host, cmd)
    return await _get_tmux_cwd_ssh(host, secrets, cmd)


_TMUX_CWDS_CMD = (
    "TMUX_BIN=$(command -v tmux 2>/dev/null); "
    "[ -n \"$TMUX_BIN\" ] || [ ! -x /usr/bin/tmux ] || TMUX_BIN=/usr/bin/tmux; "
    "[ -n \"$TMUX_BIN\" ] || [ ! -x /usr/local/bin/tmux ] || TMUX_BIN=/usr/local/bin/tmux; "
    "[ -n \"$TMUX_BIN\" ] || exit 0; "
    "$TMUX_BIN list-panes -a -F '#{session_name}\t#{pane_active}\t#{pane_current_path}' 2>/dev/null"
)


def parse_tmux_cwds(text: str) -> dict[str, str]:
    """`session<TAB>active<TAB>path` lines -> {session: path}, active pane winning.

    Pure so the parsing is testable without a host. A session with no active pane
    (possible while it is being set up) keeps the first path seen rather than
    dropping out of the map entirely.
    """
    out: dict[str, str] = {}
    active: set[str] = set()
    for line in (text or "").splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        session, is_active, path = parts[0], parts[1].strip(), parts[2].strip()
        if not session or not path:
            continue
        if is_active == "1":
            out[session] = path
            active.add(session)
        elif session not in out:
            out[session] = path
    return out


async def get_tmux_cwds(host: dict, secrets: dict) -> dict[str, str]:
    """Every remote tmux session's cwd in **one** round trip.

    A restored workspace can hold a dozen panes on one host, and asking per pane
    meant a dozen SSH exec channels (and a dozen HTTP requests through the
    tunnel) inside the boot window. The data is identical — `list-panes -a`
    already reports every session.
    """
    if _is_tailscale(host):
        try:
            stdout, _ = await _ts.run(_ts.target_for(host), _TMUX_CWDS_CMD, timeout=8.0)
            return parse_tmux_cwds(stdout.decode(errors="replace"))
        except Exception as e:
            logger.debug("get_tmux_cwds tailscale failed (%s): %s", host.get("id"), e)
            return {}
    try:
        conn = await _get_or_open(host, secrets)
        result = await conn.run(_TMUX_CWDS_CMD, check=False)
        return parse_tmux_cwds(result.stdout or "")
    except Exception as e:
        logger.debug("get_tmux_cwds ssh failed (%s): %s", host.get("id"), e)
        _drop(host["id"])
        return {}


async def _get_tmux_cwd_tailscale(host: dict, cmd: str) -> str | None:
    try:
        stdout, _ = await _ts.run(_ts.target_for(host), cmd, timeout=6.0)
        return stdout.decode(errors="replace").strip() or None
    except Exception as e:
        logger.debug("get_tmux_cwd tailscale failed (%s): %s", host.get("id"), e)
        return None


async def _get_tmux_cwd_ssh(host: dict, secrets: dict, cmd: str) -> str | None:
    try:
        conn = await _get_or_open(host, secrets)
        result = await conn.run(cmd, check=False)
        return (result.stdout or "").strip() or None
    except Exception as e:
        logger.debug("get_tmux_cwd ssh failed (%s): %s", host.get("id"), e)
        _drop(host["id"])
        return None

"""
호스트 SFTP 파일 브라우징.

asyncssh SFTP 클라이언트를 사용해 원격 호스트의 디렉토리 목록 / 파일 읽기 / 쓰기.
연결은 host_id 기준으로 풀링 → 매 요청마다 SSH 핸드셰이크 안 하게.

연결 idle TTL = 5분. TTL 지나면 자동 close.
"""
from __future__ import annotations

import asyncio
import io
import logging
import os
import posixpath
import stat
import time
import zipfile

import asyncssh

from host_manager import HostConnectError, open_connection

logger = logging.getLogger(__name__)

CONNECTION_IDLE_TTL = 300  # 5분
MAX_FILE_BYTES = 10 * 1024 * 1024  # 10MB 읽기 상한
MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024  # 원격 폴더 zip 안전 상한
MAX_DOWNLOAD_FILES = 10000

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


MAX_REMOTE_PATH_LEN = 4096


def validate_remote_path(path: str) -> str:
    """원격(SFTP) 경로 최소 검증. 널바이트 거부 + 길이 상한(defense-in-depth).

    원격 파일시스템은 절대경로 사용이 정상이라 절대경로 자체는 막지 않는다 —
    호스트 소유자가 이미 신뢰된 대상이므로 여기서는 명백히 잘못된 입력만 거른다.
    """
    if not isinstance(path, str) or not path.strip():
        raise HostConnectError("path is required")
    if "\x00" in path:
        raise HostConnectError("invalid path: null byte")
    if len(path) > MAX_REMOTE_PATH_LEN:
        raise HostConnectError(f"path too long (>{MAX_REMOTE_PATH_LEN} chars)")
    return path


# ─── Tailscale SSH helpers ────────────────────────────────────────────────────

def _tailscale_target(host: dict) -> str:
    import shutil as _sh
    if not _sh.which("tailscale"):
        raise HostConnectError("tailscale CLI not found")
    ssh_user = (host.get("ssh_user") or host.get("username") or "").strip()
    hostname = (host.get("hostname") or host.get("host") or "").strip()
    if not hostname:
        raise HostConnectError("hostname not set")
    return f"{ssh_user}@{hostname}" if ssh_user else hostname


async def _run_ts(target: str, cmd: str, timeout: float = 15.0) -> tuple[bytes, bytes]:
    proc = await asyncio.create_subprocess_exec(
        "tailscale", "ssh", target, cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    return stdout or b"", stderr or b""


async def _list_directory_tailscale(host: dict, path: str = ".") -> dict:
    import json as _json
    import shlex as _shlex

    target = _tailscale_target(host)
    target_path = (path.strip() if path else ".") or "."
    qpath = _shlex.quote(target_path)

    py = (
        "import os,stat,json,sys\n"
        "p=sys.argv[1] if len(sys.argv)>1 else '.'\n"
        "p=os.path.expanduser(p)\n"
        "try:\n"
        "    r=os.path.realpath(p)\n"
        "except Exception:\n"
        "    r=p\n"
        "items=[]\n"
        "try:\n"
        "    for e in os.scandir(r):\n"
        "        if e.name in ('.','..'):continue\n"
        "        try:\n"
        "            st=e.stat(follow_symlinks=False);m=st.st_mode\n"
        "            k='directory' if stat.S_ISDIR(m) else 'link' if stat.S_ISLNK(m) else 'file'\n"
        "            pt=('/'+e.name) if r=='/' else r.rstrip('/')+'/'+e.name\n"
        "            items.append({'name':e.name,'path':pt,'type':k,'size':st.st_size,'modified':st.st_mtime})\n"
        "        except Exception:pass\n"
        "except Exception as ex:\n"
        "    print(json.dumps({'error':str(ex)}))\n"
        "    raise SystemExit(1)\n"
        "items.sort(key=lambda x:(x['type']=='file',x['name'].lower()))\n"
        "print(json.dumps({'items':items,'resolved':r}))\n"
    )
    cmd = f"python3 - {qpath} <<'__ITSEOF__'\n{py}\n__ITSEOF__"

    try:
        stdout, stderr = await _run_ts(target, cmd)
        raw = stdout.decode(errors="replace").strip()
        if not raw:
            err = stderr.decode(errors="replace").strip()
            raise HostConnectError(f"tailscale listdir: no output — {err[:200]}")
        data = _json.loads(raw)
        if "error" in data:
            raise HostConnectError(f"tailscale listdir: {data['error']}")
        return data
    except HostConnectError:
        raise
    except Exception as e:
        raise HostConnectError(f"tailscale listdir failed: {e}") from e


async def _read_file_tailscale(host: dict, path: str) -> str:
    data = await _read_file_tailscale_bytes(host, path)
    return data.decode("utf-8", errors="replace")


async def _read_file_tailscale_bytes(host: dict, path: str) -> bytes:
    import base64 as _b64
    import shlex as _shlex

    target = _tailscale_target(host)
    qpath = _shlex.quote(path)
    max_b = MAX_FILE_BYTES

    py = (
        "import os,sys,base64\n"
        "p=sys.argv[1]\n"
        f"if os.path.getsize(p)>{max_b}:\n"
        "    print('__TOO_LARGE__');raise SystemExit(1)\n"
        "with open(p,'rb') as f:data=f.read()\n"
        "print(base64.b64encode(data).decode())\n"
    )
    cmd = f"python3 - {qpath} <<'__ITSEOF__'\n{py}\n__ITSEOF__"

    try:
        stdout, stderr = await _run_ts(target, cmd, timeout=30.0)
        raw = stdout.decode(errors="replace").strip()
        if raw == "__TOO_LARGE__":
            raise HostConnectError(f"file too large (>{max_b} bytes)")
        if not raw:
            err = stderr.decode(errors="replace").strip()
            raise HostConnectError(f"tailscale read: no output — {err[:200]}")
        return _b64.b64decode(raw.encode())
    except HostConnectError:
        raise
    except Exception as e:
        raise HostConnectError(f"tailscale read failed: {e}") from e


async def _download_item_tailscale(host: dict, path: str) -> tuple[bytes, str, str]:
    import shlex as _shlex

    target = _tailscale_target(host)
    qpath = _shlex.quote(path)
    max_b = MAX_DOWNLOAD_BYTES
    max_files = MAX_DOWNLOAD_FILES

    py = (
        "import io, os, sys, zipfile\n"
        "p=os.path.realpath(os.path.expanduser(sys.argv[1]))\n"
        "max_b=int(sys.argv[2]); max_files=int(sys.argv[3])\n"
        "if os.path.isfile(p):\n"
        "    print('__ITERM_TYPE__file', file=sys.stderr)\n"
        "    if os.path.getsize(p)>max_b:\n"
        "        print('__TOO_LARGE__', file=sys.stderr); raise SystemExit(1)\n"
        "    with open(p,'rb') as f: sys.stdout.buffer.write(f.read())\n"
        "    raise SystemExit(0)\n"
        "if not os.path.isdir(p):\n"
        "    print('__NOT_SUPPORTED__', file=sys.stderr); raise SystemExit(1)\n"
        "print('__ITERM_TYPE__dir', file=sys.stderr)\n"
        "buf=io.BytesIO(); total=0; count=0; base=os.path.basename(p.rstrip(os.sep)) or 'download'\n"
        "with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as zf:\n"
        "    for root, dirs, files in os.walk(p, followlinks=False):\n"
        "        dirs[:]=[d for d in dirs if not os.path.islink(os.path.join(root,d))]\n"
        "        rel_root=os.path.relpath(root, os.path.dirname(p))\n"
        "        if not dirs and not files:\n"
        "            zf.writestr(rel_root.replace(os.sep,'/')+'/', b'')\n"
        "        for name in files:\n"
        "            fp=os.path.join(root,name)\n"
        "            if os.path.islink(fp): continue\n"
        "            size=os.path.getsize(fp); total+=size; count+=1\n"
        "            if total>max_b or count>max_files:\n"
        "                print('__TOO_LARGE__', file=sys.stderr); raise SystemExit(1)\n"
        "            zf.write(fp, os.path.relpath(fp, os.path.dirname(p)).replace(os.sep,'/'))\n"
        "sys.stdout.buffer.write(buf.getvalue())\n"
    )
    cmd = f"python3 - {qpath} {max_b} {max_files} <<'__ITSEOF__'\n{py}\n__ITSEOF__"

    try:
        stdout, stderr = await _run_ts(target, cmd, timeout=120.0)
        err = stderr.decode(errors="replace").strip()
        if "__TOO_LARGE__" in err:
            raise HostConnectError(f"download too large (>{max_b} bytes or >{max_files} files)")
        if "__NOT_SUPPORTED__" in err:
            raise HostConnectError(f"unsupported path: {path}")
        if err and not stdout:
            raise HostConnectError(f"tailscale download: {err[:200]}")
        filename = os.path.basename(path.rstrip("/")) or "download"
        media_type = "application/zip" if "__ITERM_TYPE__dir" in err else "application/octet-stream"
        if media_type == "application/zip" and not filename.lower().endswith(".zip"):
            filename = f"{filename}.zip"
        return stdout, filename, media_type
    except HostConnectError:
        raise
    except Exception as e:
        raise HostConnectError(f"tailscale download failed: {e}") from e


async def _write_file_tailscale(host: dict, path: str, content: str | bytes) -> None:
    import base64 as _b64
    import shlex as _shlex

    target = _tailscale_target(host)
    data = content if isinstance(content, bytes) else content.encode("utf-8")
    b64str = _b64.b64encode(data).decode()
    qpath = _shlex.quote(path)

    py = (
        "import sys,base64\n"
        "p=sys.argv[1]\n"
        f"data=base64.b64decode({b64str!r})\n"
        "with open(p,'wb') as f:f.write(data)\n"
    )
    cmd = f"python3 - {qpath} <<'__ITSEOF__'\n{py}\n__ITSEOF__"

    try:
        _, stderr = await _run_ts(target, cmd, timeout=60.0)
        err = stderr.decode(errors="replace").strip()
        if err:
            raise HostConnectError(f"tailscale write: {err[:200]}")
    except HostConnectError:
        raise
    except Exception as e:
        raise HostConnectError(f"tailscale write failed: {e}") from e


async def _create_item_tailscale(host: dict, path: str, kind: str) -> None:
    import shlex as _shlex

    target = _tailscale_target(host)
    qpath = _shlex.quote(path)
    cmd = f"mkdir -p {qpath}" if kind == "directory" else f"touch {qpath}"

    try:
        _, stderr = await _run_ts(target, cmd)
        err = stderr.decode(errors="replace").strip()
        if err:
            raise HostConnectError(f"tailscale create: {err[:200]}")
    except HostConnectError:
        raise
    except Exception as e:
        raise HostConnectError(f"tailscale create failed: {e}") from e


async def _move_item_tailscale(host: dict, source: str, destination: str) -> None:
    import shlex as _shlex

    target = _tailscale_target(host)
    cmd = f"mv {_shlex.quote(source)} {_shlex.quote(destination)}"

    try:
        _, stderr = await _run_ts(target, cmd)
        err = stderr.decode(errors="replace").strip()
        if err:
            raise HostConnectError(f"tailscale move: {err[:200]}")
    except HostConnectError:
        raise
    except Exception as e:
        raise HostConnectError(f"tailscale move failed: {e}") from e


async def _delete_item_tailscale(host: dict, path: str) -> None:
    import shlex as _shlex

    target = _tailscale_target(host)
    qpath = _shlex.quote(path)

    py = (
        "import os,sys\n"
        "p=sys.argv[1]\n"
        "if os.path.isdir(p) and not os.path.islink(p):\n"
        "    os.rmdir(p)\n"
        "else:\n"
        "    os.remove(p)\n"
    )
    cmd = f"python3 - {qpath} <<'__ITSEOF__'\n{py}\n__ITSEOF__"

    try:
        _, stderr = await _run_ts(target, cmd)
        err = stderr.decode(errors="replace").strip()
        if err:
            raise HostConnectError(f"tailscale delete: {err[:200]}")
    except HostConnectError:
        raise
    except Exception as e:
        raise HostConnectError(f"tailscale delete failed: {e}") from e


async def list_directory(host: dict, secrets: dict, path: str = ".") -> dict:
    """원격 디렉토리 목록. {items, resolved} 반환.

    path 가 빈문자열/None 이면 "." (홈) 사용.
    숨김 파일 (`.` prefix) 은 포함 (프론트에서 필요 시 필터).
    resolved 는 sftp.realpath 결과 — 프론트가 "상위 폴더로 이동" 같은 절대경로 기반
    UI 를 할 수 있게 노출.
    """
    if (host.get("auth_method") or "key").lower() == "tailscale":
        return await _list_directory_tailscale(host, path)
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
    data = await read_file_bytes(host, secrets, path)
    return data.decode("utf-8", errors="replace")


async def read_file_bytes(host: dict, secrets: dict, path: str) -> bytes:
    """원격 파일을 바이너리로 읽음. 10MB 상한."""
    path = validate_remote_path(path)
    if (host.get("auth_method") or "key").lower() == "tailscale":
        return await _read_file_tailscale_bytes(host, path)
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


def _is_dir_attrs(attrs: asyncssh.SFTPAttrs) -> bool:
    return attrs.permissions is not None and stat.S_ISDIR(attrs.permissions)


def _is_link_attrs(attrs: asyncssh.SFTPAttrs) -> bool:
    return attrs.permissions is not None and stat.S_ISLNK(attrs.permissions)


async def _sftp_zip_directory_bytes(sftp, root: str) -> bytes:
    buffer = io.BytesIO()
    root = root.rstrip("/") or "/"
    parent = posixpath.dirname(root.rstrip("/")) or "/"
    total = 0
    count = 0

    async def add_dir(current: str) -> None:
        nonlocal total, count
        entries = await sftp.readdir(current)
        if not entries:
            arc = posixpath.relpath(current, parent).rstrip("/") + "/"
            zf.writestr(arc, b"")
            return
        for entry in entries:
            name = entry.filename
            if name in (".", ".."):
                continue
            child = f"{current.rstrip('/')}/{name}" if current != "/" else f"/{name}"
            attrs = entry.attrs
            if _is_link_attrs(attrs):
                continue
            if _is_dir_attrs(attrs):
                await add_dir(child)
                continue
            size = attrs.size or 0
            total += size
            count += 1
            if total > MAX_DOWNLOAD_BYTES or count > MAX_DOWNLOAD_FILES:
                raise HostConnectError(
                    f"download too large (>{MAX_DOWNLOAD_BYTES} bytes or >{MAX_DOWNLOAD_FILES} files)"
                )
            async with sftp.open(child, "rb") as f:
                data = await f.read(MAX_DOWNLOAD_BYTES + 1)
            arc = posixpath.relpath(child, parent)
            zf.writestr(arc, data)

    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        await add_dir(root)
    return buffer.getvalue()


async def download_item(host: dict, secrets: dict, path: str) -> tuple[bytes, str, str]:
    """원격 파일/폴더 다운로드. 폴더는 zip 바이트로 반환."""
    path = validate_remote_path(path)
    if (host.get("auth_method") or "key").lower() == "tailscale":
        return await _download_item_tailscale(host, path)
    try:
        conn = await _get_or_open(host, secrets)
        async with conn.start_sftp_client() as sftp:
            try:
                attrs = await sftp.stat(path)
            except (OSError, asyncssh.SFTPError) as e:
                raise HostConnectError(f"path not found: {path}") from e
            filename = os.path.basename(path.rstrip("/")) or "download"
            if _is_dir_attrs(attrs):
                data = await _sftp_zip_directory_bytes(sftp, path)
                if not filename.lower().endswith(".zip"):
                    filename = f"{filename}.zip"
                return data, filename, "application/zip"
            if attrs.size is not None and attrs.size > MAX_DOWNLOAD_BYTES:
                raise HostConnectError(f"download too large (>{MAX_DOWNLOAD_BYTES} bytes)")
            async with sftp.open(path, "rb") as f:
                data = await f.read(MAX_DOWNLOAD_BYTES + 1)
            return data, filename, "application/octet-stream"
    except HostConnectError:
        raise
    except (asyncssh.Error, OSError) as e:
        _drop(host["id"])
        raise HostConnectError(f"SFTP download failed: {e}") from e


async def write_file(host: dict, secrets: dict, path: str, content: str | bytes) -> None:
    """원격 파일 덮어쓰기."""
    path = validate_remote_path(path)
    if (host.get("auth_method") or "key").lower() == "tailscale":
        return await _write_file_tailscale(host, path, content)
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
    path = validate_remote_path(path)
    if (host.get("auth_method") or "key").lower() == "tailscale":
        return await _create_item_tailscale(host, path, kind)
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
    source = validate_remote_path(source)
    destination = validate_remote_path(destination)
    if (host.get("auth_method") or "key").lower() == "tailscale":
        return await _move_item_tailscale(host, source, destination)
    try:
        conn = await _get_or_open(host, secrets)
        async with conn.start_sftp_client() as sftp:
            await sftp.rename(source, destination)
    except (asyncssh.Error, OSError) as e:
        _drop(host["id"])
        raise HostConnectError(f"SFTP move failed: {e}") from e


async def delete_item(host: dict, secrets: dict, path: str) -> None:
    """원격 파일/폴더 삭제."""
    path = validate_remote_path(path)
    if (host.get("auth_method") or "key").lower() == "tailscale":
        return await _delete_item_tailscale(host, path)
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


async def get_tmux_cwd(host: dict, secrets: dict, session: str | None = None) -> str | None:
    """원격 호스트 tmux 세션의 현재 작업 디렉토리.
    session 지정 시 해당 세션 타겟, 실패하면 현재 활성 세션으로 폴백.
    Tailscale 호스트는 `tailscale ssh` 서브프로세스 사용 (asyncssh 미지원).
    """
    import shlex as _shlex

    # Raspberry Pi / minimal distros sometimes expose a thinner non-login PATH over
    # ssh/tailscale ssh, and `display-message` can return empty when there is no
    # current client context. Resolve tmux explicitly and fall back to list-panes
    # against the exact session target so detached/attached remote tmux both work.
    target = session or ""
    qtarget = _shlex.quote(target)
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

    auth_method = (host.get("auth_method") or "key").lower()

    if auth_method == "tailscale":
        return await _get_tmux_cwd_tailscale(host, cmd)
    else:
        return await _get_tmux_cwd_ssh(host, secrets, cmd)


async def _get_tmux_cwd_tailscale(host: dict, cmd: str) -> str | None:
    """tailscale ssh 서브프로세스로 원격 tmux CWD 조회."""
    import asyncio as _asyncio
    import shutil as _shutil
    if not _shutil.which("tailscale"):
        return None
    ssh_user = (host.get("ssh_user") or host.get("username") or "").strip()
    hostname = (host.get("hostname") or host.get("host") or "").strip()
    if not hostname:
        return None
    target = f"{ssh_user}@{hostname}" if ssh_user else hostname
    try:
        proc = await _asyncio.create_subprocess_exec(
            "tailscale", "ssh", target, cmd,
            stdout=_asyncio.subprocess.PIPE,
            stderr=_asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await _asyncio.wait_for(proc.communicate(), timeout=6.0)
        return (stdout or b"").decode(errors="replace").strip() or None
    except Exception as e:
        logger.debug("get_tmux_cwd tailscale failed (%s): %s", host.get("id"), e)
        return None


async def _get_tmux_cwd_ssh(host: dict, secrets: dict, cmd: str) -> str | None:
    """asyncssh 연결 풀로 원격 tmux CWD 조회."""
    try:
        conn = await _get_or_open(host, secrets)
        result = await conn.run(cmd, check=False)
        return (result.stdout or "").strip() or None
    except Exception as e:
        logger.debug("get_tmux_cwd ssh failed (%s): %s", host.get("id"), e)
        _drop(host["id"])
        return None


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

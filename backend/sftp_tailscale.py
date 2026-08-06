"""`auth_method == 'tailscale'` 호스트용 파일 조작.

Tailscale SSH 는 asyncssh 연결이 없으므로 `tailscale ssh` 서브프로세스로 원격에
명령을 보낸다. 파서/동작은 SFTP 경로(`host_sftp.py`)와 **결과 형태가 같아야** 한다 —
프론트는 둘을 구분하지 않는다.

바이너리는 stdin/stdout 파이프로 흘린다. base64 를 명령줄에 박아 넣으면 200MB
업로드가 그대로 argv 로 가서 죽고, 원격 `ps` 에 파일 내용이 보인다.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import shlex
import shutil

from host_manager import HostConnectError
from sftp_pool import (
    CHUNK_BYTES,
    MAX_DOWNLOAD_BYTES,
    MAX_DOWNLOAD_FILES,
    MAX_FILE_BYTES,
)

logger = logging.getLogger(__name__)


def target_for(host: dict) -> str:
    if not shutil.which("tailscale"):
        raise HostConnectError("tailscale CLI not found")
    ssh_user = (host.get("ssh_user") or host.get("username") or "").strip()
    hostname = (host.get("hostname") or host.get("host") or "").strip()
    if not hostname:
        raise HostConnectError("hostname not set")
    return f"{ssh_user}@{hostname}" if ssh_user else hostname


async def run(target: str, cmd: str, timeout: float = 15.0) -> tuple[bytes, bytes]:
    proc = await asyncio.create_subprocess_exec(
        "tailscale", "ssh", target, cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    return stdout or b"", stderr or b""


def _heredoc(py: str, *args: str) -> str:
    """원격에서 python3 스크립트를 실행하는 명령 문자열."""
    quoted = " ".join(shlex.quote(a) for a in args)
    return f"python3 - {quoted} <<'__ITSEOF__'\n{py}\n__ITSEOF__"


# ─── 목록 ─────────────────────────────────────────────────────────────────────

_LIST_PY = (
    "import os,stat,json,sys,pwd,grp\n"
    "p=sys.argv[1] if len(sys.argv)>1 else '.'\n"
    "p=os.path.expanduser(p)\n"
    "try:\n"
    "    r=os.path.realpath(p)\n"
    "except Exception:\n"
    "    r=p\n"
    "def nm(fn,i):\n"
    "    try:return fn(i)[0]\n"
    "    except Exception:return None\n"
    "items=[]\n"
    "try:\n"
    "    for e in os.scandir(r):\n"
    "        if e.name in ('.','..'):continue\n"
    "        try:\n"
    "            st=e.stat(follow_symlinks=False);m=st.st_mode\n"
    "            k='directory' if stat.S_ISDIR(m) else 'link' if stat.S_ISLNK(m) else 'file'\n"
    "            pt=('/'+e.name) if r=='/' else r.rstrip('/')+'/'+e.name\n"
    "            tgt=None\n"
    "            if k=='link':\n"
    "                try:tgt=os.readlink(e.path)\n"
    "                except Exception:pass\n"
    "            items.append({'name':e.name,'path':pt,'type':k,'size':st.st_size,\n"
    "                'modified':st.st_mtime,'mode':stat.S_IMODE(m),'uid':st.st_uid,'gid':st.st_gid,\n"
    "                'owner':nm(pwd.getpwuid,st.st_uid),'group':nm(grp.getgrgid,st.st_gid),\n"
    "                'link_target':tgt})\n"
    "        except Exception:pass\n"
    "except Exception as ex:\n"
    "    print(json.dumps({'error':str(ex)}))\n"
    "    raise SystemExit(1)\n"
    "items.sort(key=lambda x:(x['type']=='file',x['name'].lower()))\n"
    "fs=None\n"
    "try:\n"
    "    v=os.statvfs(r);fs={'total':v.f_blocks*v.f_frsize,'free':v.f_bavail*v.f_frsize}\n"
    "except Exception:pass\n"
    "print(json.dumps({'items':items,'resolved':r,'fs':fs}))\n"
)


async def list_directory(host: dict, path: str = ".") -> dict:
    target = target_for(host)
    target_path = (path.strip() if path else ".") or "."
    try:
        stdout, stderr = await run(target, _heredoc(_LIST_PY, target_path))
        raw = stdout.decode(errors="replace").strip()
        if not raw:
            err = stderr.decode(errors="replace").strip()
            raise HostConnectError(f"tailscale listdir: no output — {err[:200]}")
        data = json.loads(raw)
        if "error" in data:
            raise HostConnectError(f"tailscale listdir: {data['error']}")
        return data
    except HostConnectError:
        raise
    except Exception as e:
        raise HostConnectError(f"tailscale listdir failed: {e}") from e


# ─── 읽기 / 다운로드 ──────────────────────────────────────────────────────────

async def read_file(host: dict, path: str) -> str:
    return (await read_file_bytes(host, path)).decode("utf-8", errors="replace")


async def read_file_bytes(host: dict, path: str) -> bytes:
    target = target_for(host)
    py = (
        "import os,sys,base64\n"
        "p=sys.argv[1]\n"
        f"if os.path.getsize(p)>{MAX_FILE_BYTES}:\n"
        "    print('__TOO_LARGE__');raise SystemExit(1)\n"
        "with open(p,'rb') as f:data=f.read()\n"
        "print(base64.b64encode(data).decode())\n"
    )
    try:
        stdout, stderr = await run(target, _heredoc(py, path), timeout=30.0)
        raw = stdout.decode(errors="replace").strip()
        if raw == "__TOO_LARGE__":
            raise HostConnectError(f"file too large (>{MAX_FILE_BYTES} bytes)")
        if not raw:
            err = stderr.decode(errors="replace").strip()
            raise HostConnectError(f"tailscale read: no output — {err[:200]}")
        return base64.b64decode(raw.encode())
    except HostConnectError:
        raise
    except Exception as e:
        raise HostConnectError(f"tailscale read failed: {e}") from e


_DOWNLOAD_PY = (
    "import io, os, sys, zipfile\n"
    "paths=[os.path.realpath(os.path.expanduser(a)) for a in sys.argv[3:]]\n"
    "max_b=int(sys.argv[1]); max_files=int(sys.argv[2])\n"
    "if len(paths)==1 and os.path.isfile(paths[0]):\n"
    "    p=paths[0]\n"
    "    print('__ITERM_TYPE__file', file=sys.stderr)\n"
    "    if os.path.getsize(p)>max_b:\n"
    "        print('__TOO_LARGE__', file=sys.stderr); raise SystemExit(1)\n"
    "    with open(p,'rb') as f:\n"
    "        while True:\n"
    "            c=f.read(1<<20)\n"
    "            if not c: break\n"
    "            sys.stdout.buffer.write(c)\n"
    "    raise SystemExit(0)\n"
    "print('__ITERM_TYPE__dir', file=sys.stderr)\n"
    "buf=io.BytesIO(); total=0; count=0\n"
    "with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as zf:\n"
    "    for p in paths:\n"
    "        base=os.path.dirname(p.rstrip(os.sep)) or '/'\n"
    "        if os.path.isfile(p):\n"
    "            total+=os.path.getsize(p); count+=1\n"
    "            if total>max_b or count>max_files:\n"
    "                print('__TOO_LARGE__', file=sys.stderr); raise SystemExit(1)\n"
    "            zf.write(p, os.path.relpath(p, base).replace(os.sep,'/')); continue\n"
    "        if not os.path.isdir(p):\n"
    "            continue\n"
    "        for root, dirs, files in os.walk(p, followlinks=False):\n"
    "            dirs[:]=[d for d in dirs if not os.path.islink(os.path.join(root,d))]\n"
    "            if not dirs and not files:\n"
    "                zf.writestr(os.path.relpath(root, base).replace(os.sep,'/')+'/', b'')\n"
    "            for name in files:\n"
    "                fp=os.path.join(root,name)\n"
    "                if os.path.islink(fp): continue\n"
    "                total+=os.path.getsize(fp); count+=1\n"
    "                if total>max_b or count>max_files:\n"
    "                    print('__TOO_LARGE__', file=sys.stderr); raise SystemExit(1)\n"
    "                zf.write(fp, os.path.relpath(fp, base).replace(os.sep,'/'))\n"
    "sys.stdout.buffer.write(buf.getvalue())\n"
)


async def download_items(host: dict, paths: list[str]) -> tuple[bytes, str, str]:
    """파일 하나면 그대로, 폴더이거나 여러 개면 zip 으로 묶어 반환."""
    target = target_for(host)
    args = [str(MAX_DOWNLOAD_BYTES), str(MAX_DOWNLOAD_FILES), *paths]
    try:
        stdout, stderr = await run(target, _heredoc(_DOWNLOAD_PY, *args), timeout=300.0)
        err = stderr.decode(errors="replace").strip()
        if "__TOO_LARGE__" in err:
            raise HostConnectError(
                f"download too large (>{MAX_DOWNLOAD_BYTES} bytes or >{MAX_DOWNLOAD_FILES} files)"
            )
        if err and not stdout:
            raise HostConnectError(f"tailscale download: {err[:200]}")
        is_zip = "__ITERM_TYPE__dir" in err
        if len(paths) > 1:
            filename = f"download-{len(paths)}-items.zip"
        else:
            filename = os.path.basename(paths[0].rstrip("/")) or "download"
            if is_zip and not filename.lower().endswith(".zip"):
                filename = f"{filename}.zip"
        return stdout, filename, "application/zip" if is_zip else "application/octet-stream"
    except HostConnectError:
        raise
    except Exception as e:
        raise HostConnectError(f"tailscale download failed: {e}") from e


# ─── 쓰기 / 업로드 ────────────────────────────────────────────────────────────

async def write_file(host: dict, path: str, content: str | bytes) -> None:
    data = content if isinstance(content, bytes) else content.encode("utf-8")

    async def _once():
        yield data

    await upload_stream(host, path, _once())


async def upload_stream(host: dict, path: str, chunks) -> int:
    """청크를 원격 stdin 으로 흘려 파일에 쓴다. 반환값은 쓴 바이트 수.

    `cat > path` 로 넘기므로 파일 크기와 무관하게 메모리를 잡지 않는다.
    같은 이유로 base64 를 argv 에 실을 때 생기던 크기 한계와 `ps` 노출이 없다.
    """
    target = target_for(host)
    qpath = shlex.quote(path)
    proc = await asyncio.create_subprocess_exec(
        "tailscale", "ssh", target, f"cat > {qpath}",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    written = 0
    try:
        async for chunk in chunks:
            if not chunk:
                continue
            proc.stdin.write(chunk)
            await proc.stdin.drain()
            written += len(chunk)
        proc.stdin.close()
    except Exception:
        proc.kill()
        raise
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        err = (stderr or b"").decode(errors="replace").strip()
        raise HostConnectError(f"tailscale write failed: {err[:200]}")
    return written


async def download_stream(host: dict, path: str):
    """원격 파일을 청크로 흘려 받는다 (단일 파일 전용)."""
    target = target_for(host)
    qpath = shlex.quote(path)
    proc = await asyncio.create_subprocess_exec(
        "tailscale", "ssh", target, f"cat {qpath}",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        while True:
            chunk = await proc.stdout.read(CHUNK_BYTES)
            if not chunk:
                break
            yield chunk
    finally:
        if proc.returncode is None:
            proc.kill()
        await proc.wait()


# ─── 생성 / 이동 / 복사 / 삭제 / 권한 ─────────────────────────────────────────

async def _run_checked(host: dict, cmd: str, label: str, timeout: float = 60.0) -> None:
    target = target_for(host)
    try:
        _, stderr = await run(target, cmd, timeout=timeout)
        err = stderr.decode(errors="replace").strip()
        if err:
            raise HostConnectError(f"tailscale {label}: {err[:200]}")
    except HostConnectError:
        raise
    except Exception as e:
        raise HostConnectError(f"tailscale {label} failed: {e}") from e


async def create_item(host: dict, path: str, kind: str) -> None:
    q = shlex.quote(path)
    await _run_checked(host, f"mkdir -p {q}" if kind == "directory" else f"touch {q}", "create")


async def move_item(host: dict, source: str, destination: str) -> None:
    await _run_checked(
        host, f"mv -n {shlex.quote(source)} {shlex.quote(destination)}", "move")


async def copy_item(host: dict, source: str, destination: str) -> None:
    """원격 안에서의 복사 — 서버가 직접 한다(우리를 거쳐 왕복시키지 않는다)."""
    await _run_checked(
        host, f"cp -a {shlex.quote(source)} {shlex.quote(destination)}", "copy", timeout=300.0)


async def delete_item(host: dict, path: str, recursive: bool = True) -> None:
    q = shlex.quote(path)
    cmd = f"rm -rf -- {q}" if recursive else (
        f"if [ -d {q} ] && [ ! -L {q} ]; then rmdir -- {q}; else rm -f -- {q}; fi")
    await _run_checked(host, cmd, "delete", timeout=300.0)


async def chmod_item(host: dict, path: str, mode: int, recursive: bool = False) -> None:
    flag = "-R " if recursive else ""
    await _run_checked(
        host, f"chmod {flag}{mode:o} -- {shlex.quote(path)}", "chmod", timeout=120.0)


async def path_exists(host: dict, paths: list[str]) -> dict[str, bool]:
    """여러 경로의 존재 여부를 한 번에. 업로드 전 충돌 확인용."""
    py = (
        "import os,sys,json\n"
        "print(json.dumps({p: os.path.lexists(p) for p in sys.argv[1:]}))\n"
    )
    target = target_for(host)
    try:
        stdout, _ = await run(target, _heredoc(py, *paths), timeout=30.0)
        return json.loads(stdout.decode(errors="replace").strip() or "{}")
    except Exception as e:
        logger.debug("tailscale exists failed: %s", e)
        return {}

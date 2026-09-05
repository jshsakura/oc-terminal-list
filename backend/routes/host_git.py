"""원격 호스트 git API — SSH 로 실행."""
from __future__ import annotations

import logging
import shlex

from fastapi import APIRouter, Depends, HTTPException, Query, Request

import host_sftp
import multiplexer as mux
from _deps import verify_auth_token
from host_common import (
    MAX_COMMIT_MESSAGE_LEN,
    MAX_REMOTE_PATH_LEN,
    resolve_host_with_secrets,
    run_remote_cmd,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/hosts/{host_id}/git", tags=["host-git"])


@router.get("/status")
async def host_git_status(
    host_id: str,
    path: str = Query("", description="원격 디렉토리. 비우면 cwd 사용."),
    username: str = Depends(verify_auth_token),
):
    """원격 호스트의 git status — SSH 로 직접 실행."""
    host, secrets = await resolve_host_with_secrets(host_id, username)
    target = (path or "").strip()
    if not target:
        # `get_tmux_cwd` 는 이름 그대로 tmux 에게 묻는다 — none 호스트에는 물어볼
        # 상대가 없다. "영속이냐"(persists)가 아니라 "tmux 냐" 로 갈라야 하는 이유다.
        cwd = (await host_sftp.get_tmux_cwd(host, secrets)
               if mux.from_host_row(host) == mux.TMUX else None)
        target = cwd or host.get("start_path") or "."
    safe = shlex.quote(target)
    cmd = (
        f"git -C {safe} status --porcelain=v1 -uall 2>&1; "
        f"echo '__BRANCH__'; "
        f"git -C {safe} rev-parse --abbrev-ref HEAD 2>/dev/null; "
        f"echo '__ROOT__'; "
        f"git -C {safe} rev-parse --show-toplevel 2>/dev/null"
    )
    try:
        raw = await run_remote_cmd(host, secrets, cmd, timeout=10)
    except Exception as e:
        logger.warning("host git status failed (%s): %s", host_id, e)
        return {"items": [], "branch": None, "repo": None, "error": "원격 git 조회 실패"}

    status_part, _, rest_part = raw.partition("__BRANCH__")
    branch_part, _, root_part = rest_part.partition("__ROOT__")
    if "not a git repository" in status_part.lower() or "fatal:" in status_part.lower():
        return {"items": [], "branch": None, "repo": None, "error": None}

    items = []
    for line in status_part.strip().splitlines():
        if len(line) < 3:
            continue
        staged_code = line[0]
        unstaged_code = line[1]
        file_path = line[3:].strip().strip('"')
        kind = (
            "untracked" if line[:2] == "??"
            else "deleted" if "D" in line[:2]
            else "added" if "A" in line[:2]
            else "modified"
        )
        items.append({
            "path": file_path,
            "repo_path": file_path,
            "code": (staged_code + unstaged_code).strip(),
            "kind": kind,
            "staged": staged_code not in (" ", "?"),
        })
    branch = branch_part.strip() or None
    repo_root = root_part.strip() or target
    return {"items": items, "branch": branch, "repo": repo_root, "error": None}


@router.get("/diff")
async def host_git_diff(
    host_id: str,
    path: str = Query(..., description="원격 파일 절대 경로"),
    staged: bool = Query(False),
    username: str = Depends(verify_auth_token),
):
    host, secrets = await resolve_host_with_secrets(host_id, username)
    safe_path = shlex.quote(path)
    staged_flag = "--cached " if staged else ""
    dir_path = path.rsplit('/', 1)[0] if '/' in path else '.'
    safe_dir = shlex.quote(dir_path)
    cmd = f"git -C {safe_dir} diff {staged_flag}--no-color -- {safe_path} 2>&1"
    try:
        output = await run_remote_cmd(host, secrets, cmd, timeout=10)
        if "not a git repository" in output.lower() or "fatal:" in output.lower():
            raise HTTPException(status_code=404, detail="해당 파일이 속한 git 저장소를 찾을 수 없습니다")
        return {
            "path": path,
            "repo": dir_path,
            "patch": output,
            "staged": staged,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("host git diff failed (%s, %s): %s", host_id, path, e)
        raise HTTPException(status_code=500, detail="원격 git diff 실패")


@router.post("/commit")
async def host_git_commit(
    host_id: str,
    request: Request,
    username: str = Depends(verify_auth_token),
):
    body = await request.json()
    path = (body.get("path") or "").strip()
    message = (body.get("message") or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Commit message is required")
    if len(message) > MAX_COMMIT_MESSAGE_LEN:
        raise HTTPException(status_code=400, detail="Commit message too long")
    if len(path) > MAX_REMOTE_PATH_LEN:
        raise HTTPException(status_code=400, detail="Path too long")
    host, secrets = await resolve_host_with_secrets(host_id, username)
    if not path:
        path = (host.get("start_path") or "").strip() or "."
    safe_dir = shlex.quote(path)
    safe_msg = shlex.quote(message)
    cmd = f"git -C {safe_dir} add -A && git -C {safe_dir} commit -m {safe_msg} 2>&1"
    try:
        output = await run_remote_cmd(host, secrets, cmd, timeout=30)
        if "nothing to commit" in output.lower():
            return {"ok": True, "output": output.strip()}
        if "error:" in output.lower() or "fatal:" in output.lower():
            raise HTTPException(status_code=500, detail=output.strip())
        return {"ok": True, "output": output.strip()}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("host git commit failed (%s): %s", host_id, e)
        raise HTTPException(status_code=500, detail="원격 commit 실패")


@router.post("/push")
async def host_git_push(
    host_id: str,
    request: Request,
    username: str = Depends(verify_auth_token),
):
    body = await request.json()
    path = (body.get("path") or "").strip()
    if len(path) > MAX_REMOTE_PATH_LEN:
        raise HTTPException(status_code=400, detail="Path too long")
    host, secrets = await resolve_host_with_secrets(host_id, username)
    if not path:
        path = (host.get("start_path") or "").strip() or "."
    safe_dir = shlex.quote(path)
    cmd = f"git -C {safe_dir} push 2>&1"
    try:
        output = await run_remote_cmd(host, secrets, cmd, timeout=60)
        if "error:" in output.lower() or "fatal:" in output.lower():
            raise HTTPException(status_code=500, detail=output.strip())
        return {"ok": True, "output": output.strip()}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("host git push failed (%s): %s", host_id, e)
        raise HTTPException(status_code=500, detail="원격 push 실패")

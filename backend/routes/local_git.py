"""워크스페이스 local git API — status/diff/commit/push/file-content."""
from __future__ import annotations

import asyncio
import logging
import os
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from _deps import (
    GIT_COMMIT_TIMEOUT,
    GIT_DIFF_TIMEOUT,
    GIT_PUSH_TIMEOUT,
    GIT_QUICK_TIMEOUT,
    GIT_STATUS_TIMEOUT,
    WORKSPACE_ROOT,
    run_proc,
    validate_path,
    verify_auth_token,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/git", tags=["local-git"])


MAX_COMMIT_MESSAGE_LEN = 4000
REPO_ITEMS_CAP = 200       # repo 당 응답에 포함할 최대 항목 (over → truncated 플래그)
REPO_NOISE_THRESHOLD = 800 # 이 이상이면 repo 자체를 noisy 로 분류 → 메타만, items 비움


async def _find_repo_root(start_path: str) -> str | None:
    """주어진 경로에서 위로 올라가며 git 저장소 루트를 찾는다. 없으면 None."""
    if not os.path.isdir(start_path):
        start_path = os.path.dirname(start_path) or start_path
    try:
        rc, out, _ = await run_proc(
            ["git", "-C", start_path, "rev-parse", "--show-toplevel"],
            timeout=GIT_QUICK_TIMEOUT,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        if rc != 0:
            return None
        return out.decode("utf-8", errors="replace").strip() or None
    except (FileNotFoundError, asyncio.TimeoutError):
        return None


async def _collect_repo_status(repo_root: str, workspace_abs: str, items_cap: int = REPO_ITEMS_CAP) -> dict:
    """단일 repo 의 변경 사항 + 브랜치를 워크스페이스 상대 경로 기준으로 정리.

    repo 가 매우 크면 (예: 빌드 산출물 수천개) cap 까지만 자르고 truncated 표시.
    """
    try:
        rc, stdout, stderr = await run_proc(
            ["git", "-C", repo_root, "status", "--porcelain=v1", "-uall"],
            timeout=GIT_STATUS_TIMEOUT,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        if rc != 0:
            return {"items": [], "branch": None, "error": stderr.decode("utf-8", "replace").strip() or "git status failed", "total": 0, "truncated": False}

        repo_rel_prefix = os.path.relpath(repo_root, workspace_abs).replace("\\", "/")
        if repo_rel_prefix in (".", ""):
            repo_rel_prefix = ""

        all_lines = [line for line in stdout.decode().splitlines() if len(line) >= 3]
        total = len(all_lines)
        # 너무 시끄러운 repo (gitignore 누락된 build/cache 등) 는 메타만 반환,
        # items 는 비워 응답 비대화 방지.
        noisy = total >= REPO_NOISE_THRESHOLD
        truncated = total > items_cap and not noisy
        lines = [] if noisy else all_lines[:items_cap]

        items = []
        for line in lines:
            staged_code = line[0]
            unstaged_code = line[1]
            rel_to_repo = line[3:].strip().strip('"')
            kind = (
                "untracked" if line[:2] == "??"
                else "deleted" if "D" in line[:2]
                else "added" if "A" in line[:2]
                else "modified"
            )
            workspace_rel = (
                f"{repo_rel_prefix}/{rel_to_repo}" if repo_rel_prefix else rel_to_repo
            )
            items.append({
                "path": workspace_rel,
                "repo_path": rel_to_repo,
                "repo_root": repo_root,
                "code": (staged_code + unstaged_code).strip(),
                "kind": kind,
                "staged": staged_code not in (" ", "?"),
            })

        b_rc, b_out, _ = await run_proc(
            ["git", "-C", repo_root, "rev-parse", "--abbrev-ref", "HEAD"],
            timeout=GIT_QUICK_TIMEOUT,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        branch = b_out.decode().strip() if b_rc == 0 else None

        return {
            "items": items,
            "branch": branch,
            "error": None,
            "total": total,
            "truncated": truncated,
            "noisy": noisy,
        }
    except asyncio.TimeoutError:
        return {"items": [], "branch": None, "error": "git status timed out", "total": 0, "truncated": False, "noisy": False}
    except Exception as e:
        logger.warning("collect repo status failed (%s): %s", repo_root, e)
        return {"items": [], "branch": None, "error": "git status failed", "total": 0, "truncated": False, "noisy": False}


# 워크스페이스 repo 스캔 결과 캐시 — fs 변동이 잦지 않으니 60초 캐시.
_REPO_SCAN_CACHE: dict = {"ts": 0.0, "roots": []}
_REPO_SCAN_TTL = 60.0


async def _scan_workspace_repos(workspace_abs: str, max_depth: int = 2) -> list[str]:
    """워크스페이스에서 git repo 들의 루트 경로를 탐색 (max_depth 까지). 60초 캐시."""
    now = time.time()
    if now - _REPO_SCAN_CACHE["ts"] < _REPO_SCAN_TTL and _REPO_SCAN_CACHE["roots"]:
        return list(_REPO_SCAN_CACHE["roots"])

    found: list[str] = []
    try:
        for entry in os.scandir(workspace_abs):
            if not entry.is_dir(follow_symlinks=False):
                continue
            if entry.name.startswith('.'):
                continue
            full = entry.path
            if os.path.isdir(os.path.join(full, '.git')):
                found.append(full)
                continue
            if max_depth > 1:
                try:
                    for sub in os.scandir(full):
                        if not sub.is_dir(follow_symlinks=False):
                            continue
                        if sub.name.startswith('.'):
                            continue
                        if os.path.isdir(os.path.join(sub.path, '.git')):
                            found.append(sub.path)
                except PermissionError:
                    pass
    except Exception as e:
        logger.warning("scan workspace repos failed: %s", e)
    _REPO_SCAN_CACHE["ts"] = now
    _REPO_SCAN_CACHE["roots"] = found
    return found


@router.get("/status")
async def git_status(
    path: str = Query("", description="포커스된 폴더 경로 (워크스페이스 상대). 비우면 워크스페이스 전체 repo 집계."),
    username: str = Depends(verify_auth_token),
):
    """경로 지정 시 그 repo 의 변경, 비우면 워크스페이스 내 모든 repo 의 변경을 집계."""
    workspace_abs = os.path.abspath(WORKSPACE_ROOT)

    if not path:
        repo_roots = await _scan_workspace_repos(workspace_abs)
        if not repo_roots:
            return {"items": [], "branch": None, "repo": None, "repos": [], "error": None}
        results = await asyncio.gather(*[
            _collect_repo_status(r, workspace_abs) for r in repo_roots
        ], return_exceptions=False)
        repos_meta = []
        all_items = []
        for repo_root, r in zip(repo_roots, results):
            if r.get("error"):
                continue
            total = r.get("total", 0)
            if total == 0:
                continue
            rel = os.path.relpath(repo_root, workspace_abs).replace("\\", "/")
            repos_meta.append({
                "root": repo_root,
                "rel": rel,
                "branch": r["branch"],
                "count": len(r["items"]),
                "total": total,
                "truncated": r.get("truncated", False),
                "noisy": r.get("noisy", False),
            })
            all_items.extend(r["items"])
        return {
            "items": all_items,
            "branch": None,
            "repo": None,
            "repos": repos_meta,
            "error": None,
        }

    target = str(validate_path(path).absolute())
    repo_root = await _find_repo_root(target)
    if not repo_root:
        return {"items": [], "branch": None, "repo": None, "repos": [], "error": None}

    try:
        rc, stdout, stderr = await run_proc(
            ["git", "-C", repo_root, "status", "--porcelain=v1", "-uall"],
            timeout=GIT_STATUS_TIMEOUT,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        if rc != 0:
            return {
                "items": [],
                "branch": None,
                "repo": repo_root,
                "error": stderr.decode("utf-8", errors="replace").strip() or "git status failed",
            }

        repo_rel_prefix = os.path.relpath(repo_root, workspace_abs).replace("\\", "/")
        if repo_rel_prefix in (".", ""):
            repo_rel_prefix = ""

        items = []
        for line in stdout.decode().splitlines():
            if len(line) < 3:
                continue
            staged_code = line[0]
            unstaged_code = line[1]
            rel_to_repo = line[3:].strip().strip('"')
            kind = (
                "untracked" if line[:2] == "??"
                else "deleted" if "D" in line[:2]
                else "added" if "A" in line[:2]
                else "modified"
            )
            workspace_rel = (
                f"{repo_rel_prefix}/{rel_to_repo}" if repo_rel_prefix else rel_to_repo
            )
            items.append({
                "path": workspace_rel,
                "repo_path": rel_to_repo,
                "code": (staged_code + unstaged_code).strip(),
                "kind": kind,
                "staged": staged_code not in (" ", "?"),
            })

        b_rc, b_out, _ = await run_proc(
            ["git", "-C", repo_root, "rev-parse", "--abbrev-ref", "HEAD"],
            timeout=GIT_QUICK_TIMEOUT,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        branch = b_out.decode().strip() if b_rc == 0 else None

        return {
            "items": items,
            "branch": branch,
            "repo": repo_root,
            "repo_relative": repo_rel_prefix,
            "error": None,
        }
    except FileNotFoundError:
        return {"items": [], "branch": None, "repo": None, "error": "git binary not found"}
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="git status timed out")
    except Exception as e:
        logger.error("git status endpoint failed: %s", e)
        raise HTTPException(status_code=500, detail="git status failed")


@router.get("/diff")
async def git_diff(
    path: str = Query(...),
    staged: bool = Query(False),
    username: str = Depends(verify_auth_token),
):
    safe = validate_path(path)
    repo_root = await _find_repo_root(str(safe))
    if not repo_root:
        raise HTTPException(status_code=404, detail="해당 파일이 속한 git 저장소를 찾을 수 없습니다")

    rel_to_repo = os.path.relpath(str(safe.absolute()), repo_root).replace("\\", "/")
    args = ["git", "-C", repo_root, "diff"]
    if staged:
        args.append("--cached")
    args += ["--no-color", "--", rel_to_repo]

    try:
        rc, stdout, stderr = await run_proc(
            args,
            timeout=GIT_DIFF_TIMEOUT,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        if rc != 0:
            err = stderr.decode("utf-8", errors="replace").strip()
            raise HTTPException(status_code=500, detail=err or "git diff failed")
        return {
            "path": path,
            "repo": repo_root,
            "repo_path": rel_to_repo,
            "patch": stdout.decode("utf-8", errors="replace"),
            "staged": staged,
        }
    except HTTPException:
        raise
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="git diff timed out")
    except Exception as e:
        logger.error("git diff failed (%s): %s", path, e)
        raise HTTPException(status_code=500, detail="git diff failed")


@router.post("/commit")
async def git_commit(
    request: Request,
    username: str = Depends(verify_auth_token),
):
    body = await request.json()
    path = body.get("path", "")
    message = (body.get("message") or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Commit message is required")
    if len(message) > MAX_COMMIT_MESSAGE_LEN:
        raise HTTPException(status_code=400, detail="Commit message too long")
    try:
        safe = validate_path(path) if path else Path(WORKSPACE_ROOT)
        repo_root = await _find_repo_root(str(safe)) if path else str(safe)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid path")
    if not repo_root:
        raise HTTPException(status_code=404, detail="No git repository found")

    try:
        add_rc, _, add_err = await run_proc(
            ["git", "-C", repo_root, "add", "-A"],
            timeout=GIT_COMMIT_TIMEOUT,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        if add_rc != 0:
            raise HTTPException(status_code=500, detail=add_err.decode("utf-8", errors="replace").strip() or "git add failed")

        c_rc, stdout, stderr = await run_proc(
            ["git", "-C", repo_root, "commit", "-m", message],
            timeout=GIT_COMMIT_TIMEOUT,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        if c_rc != 0:
            err = stderr.decode("utf-8", errors="replace").strip()
            raise HTTPException(status_code=500, detail=err or "git commit failed")
        return {"ok": True, "output": stdout.decode("utf-8", errors="replace").strip()}
    except HTTPException:
        raise
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="git commit timed out")
    except Exception as e:
        logger.error("git commit failed: %s", e)
        raise HTTPException(status_code=500, detail="git commit failed")


@router.post("/push")
async def git_push(
    request: Request,
    username: str = Depends(verify_auth_token),
):
    body = await request.json()
    path = body.get("path", "")
    try:
        safe = validate_path(path) if path else Path(WORKSPACE_ROOT)
        repo_root = await _find_repo_root(str(safe)) if path else str(safe)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid path")
    if not repo_root:
        raise HTTPException(status_code=404, detail="No git repository found")

    try:
        rc, stdout, stderr = await run_proc(
            ["git", "-C", repo_root, "push"],
            timeout=GIT_PUSH_TIMEOUT,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        combined = (stdout + stderr).decode("utf-8", errors="replace").strip()
        if rc != 0:
            raise HTTPException(status_code=500, detail=combined or "git push failed")
        return {"ok": True, "output": combined}
    except HTTPException:
        raise
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="git push timed out")
    except Exception as e:
        logger.error("git push failed: %s", e)
        raise HTTPException(status_code=500, detail="git push failed")


@router.get("/file-content")
async def git_file_content(
    path: str = Query(...),
    ref: str = Query("HEAD"),
    username: str = Depends(verify_auth_token),
):
    """파일의 특정 ref(기본 HEAD) 시점 내용. DiffEditor 좌측(원본)에 사용."""
    safe = validate_path(path)
    repo_root = await _find_repo_root(str(safe))
    if not repo_root:
        raise HTTPException(status_code=404, detail="해당 파일이 속한 git 저장소를 찾을 수 없습니다")

    rel_to_repo = os.path.relpath(str(safe.absolute()), repo_root).replace("\\", "/")
    try:
        rc, stdout, stderr = await run_proc(
            ["git", "-C", repo_root, "show", f"{ref}:{rel_to_repo}"],
            timeout=GIT_DIFF_TIMEOUT,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        if rc != 0:
            err = stderr.decode("utf-8", errors="replace").strip().lower()
            if "exists on disk, but not in" in err or "does not exist" in err or "bad object" in err:
                return {"path": path, "ref": ref, "content": "", "exists": False}
            raise HTTPException(status_code=500, detail=err or "git show failed")
        return {
            "path": path,
            "ref": ref,
            "content": stdout.decode("utf-8", errors="replace"),
            "exists": True,
        }
    except HTTPException:
        raise
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="git show timed out")
    except Exception as e:
        logger.error("git show failed (%s): %s", path, e)
        raise HTTPException(status_code=500, detail="git show failed")


# 호환: 워크스페이스 전체 status 의 헬퍼 — 다른 모듈에서 사용 가능.
async def get_git_status_dict() -> dict:
    """워크스페이스 단일 git status — 키: 워크스페이스 상대 경로, 값: 코드."""
    try:
        rc, stdout, _err = await run_proc(
            ["git", "status", "--porcelain=v1", "-uall"],
            timeout=GIT_STATUS_TIMEOUT,
            cwd=os.path.abspath(WORKSPACE_ROOT),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        result: dict = {}
        if stdout:
            for line in stdout.decode().splitlines():
                if len(line) > 3:
                    result[line[3:].strip().strip('"')] = line[:2].strip()
        return result
    except Exception as e:
        logger.error("git status failed: %s", e)
        return {}

"""서버 상태·리소스·사용량 — health/config/stats/프로세스 kill/usage.

/proc 전수 스캔은 동기 I/O 라 async 핸들러를 블로킹한다. to_thread + 짧은 TTL 캐시로
동시 폴링을 스캔 1회에 합친다. 프로세스 kill 은 백엔드 OS 사용자 소유만 허용한다.
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal as signal_mod
import time

from fastapi import APIRouter, Depends, HTTPException, Query

from _deps import verify_auth_token
from pydantic import BaseModel
from sqlite_storage import storage
from system_monitor import system_monitor

logger = logging.getLogger(__name__)

router = APIRouter(tags=["system"])


# /api/system/stats 응답 TTL 캐시 — /proc 전수 스캔(수백 PID × 수 파일) 은 동기 I/O
# 라 async 핸들러를 블로킹하므로 to_thread + 짧은 캐시로 동시 폴링을 1회 스캔에 합친다.
_SYS_STATS_TTL = 2.0
_sys_stats_cache: dict = {"at": 0.0, "value": None}
_sys_stats_lock = asyncio.Lock()


async def _get_system_stats_cached() -> dict:
    now = time.time()
    cached_value = _sys_stats_cache.get("value")
    if cached_value is not None and now - _sys_stats_cache["at"] < _SYS_STATS_TTL:
        return cached_value
    async with _sys_stats_lock:
        now = time.time()
        cached_value = _sys_stats_cache.get("value")
        if cached_value is not None and now - _sys_stats_cache["at"] < _SYS_STATS_TTL:
            return cached_value
        stats = await asyncio.to_thread(system_monitor.get_stats)
        _sys_stats_cache["value"] = stats
        _sys_stats_cache["at"] = now
        return stats


@router.get("/api/system/stats")
async def get_system_stats(username: str = Depends(verify_auth_token)):
    return await _get_system_stats_cached()


class ProcessKillRequest(BaseModel):
    # 'term' = SIGTERM (정상 종료 요청), 'kill' = SIGKILL (강제). 외부 노출 화이트리스트만.
    signal: str = "term"


_PROTECTED_PIDS = {1}  # init


def _read_proc_uid(pid: int) -> int | None:
    try:
        with open(f"/proc/{pid}/status") as f:
            for line in f:
                if line.startswith("Uid:"):
                    return int(line.split()[1])
    except (FileNotFoundError, PermissionError, ValueError):
        return None
    return None


@router.post("/api/system/processes/{pid}/kill")
async def kill_process(
    pid: int,
    req: ProcessKillRequest,
    username: str = Depends(verify_auth_token),
):
    """Top processes 패널에서 호출. 백엔드 OS 사용자 소유 프로세스만 kill 허용.

    - pid <= 1, 백엔드 자신, init 등은 거부.
    - 시그널은 'term' | 'kill' 만 허용 — 외부 raw signum 미허용 (검증 우회 방지).
    """
    if pid <= 1 or pid in _PROTECTED_PIDS:
        raise HTTPException(status_code=400, detail="protected pid")
    if pid == os.getpid() or pid == os.getppid():
        raise HTTPException(status_code=400, detail="cannot kill self")

    sig_name = (req.signal or "term").lower()
    if sig_name == "term":
        sig = signal_mod.SIGTERM
    elif sig_name == "kill":
        sig = signal_mod.SIGKILL
    else:
        raise HTTPException(status_code=400, detail="unsupported signal")

    target_uid = _read_proc_uid(pid)
    if target_uid is None:
        raise HTTPException(status_code=404, detail="process not found")

    # 백엔드 실행 사용자의 프로세스만 — root 가 아닌 한 어차피 OS 가 막지만 명시적으로 거부.
    me_uid = os.getuid()
    if target_uid != me_uid and me_uid != 0:
        raise HTTPException(status_code=403, detail="not owner")

    try:
        os.kill(pid, sig)
    except ProcessLookupError:
        raise HTTPException(status_code=404, detail="process not found")
    except PermissionError:
        raise HTTPException(status_code=403, detail="permission denied")
    except OSError as e:
        logger.error("kill_process pid=%s signal=%s failed: %s", pid, sig_name, e)
        raise HTTPException(status_code=500, detail="프로세스 종료에 실패했습니다.")

    logger.info("kill_process pid=%s signal=%s by=%s", pid, sig_name, username)
    return {"ok": True, "pid": pid, "signal": sig_name}


@router.get("/api/usage/summary")
async def get_usage_summary(
    days: int = Query(7, ge=1, le=90),
    username: str = Depends(verify_auth_token),
):
    """최근 N일 사용 통계. 빈 패널 대시보드 카드용."""
    return await storage.get_usage_summary(username, days)


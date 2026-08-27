"""세션 간 명령 전달 — `itl` CLI 의 백엔드.

pane 안에서 도는 에이전트가 다른 pane 에게 프롬프트를 넣을 수 있게 한다.
자연어 해석은 하지 않는다 — 그건 이미 pane 안의 모델이 하는 일이고, 여기서는
그 모델이 첫 시도에 맞출 만큼 뻔한 주소 어휘만 제공한다(itl_targets 참고).

원격도 로컬과 **같은 대접**을 받는다: 보내기·읽기·상태 모두 백엔드가 그 호스트의
자격증명으로 SSH 를 걸어 처리한다. 부르는 쪽은 그 호스트의 열쇠가 필요 없다(itl_remote).
원격이 반쪽이면 받은 에이전트가 헤맨다 — 답장할 방법을 모르고, 기다림은 거짓으로 끝나고,
"보냈다" 가 배달을 뜻하지 않게 된다. 그 세 구멍을 여기서 막는다.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from collections.abc import Awaitable, Callable

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import agent_status_events
import itl_remote
from _deps import verify_itl_token
from agent_status import detect_status, display_title, is_agent_pane
from agent_status_service import agent_status_watcher
from itl_origin import build_reply_cmd, find_sender, format_origin
from itl_targets import (
    build_targets,
    filter_targets,
    format_table,
    references_status_group,
    resolve,
)
from pane_excerpt import extract_excerpt
from rate_limit import check_rate_limit
from server_identity import get_server_identity
from sqlite_storage import storage
from tmux_manager import tmux_manager

logger = logging.getLogger(__name__)

# 한 번에 자는 최대 시간. 신호를 놓쳐도 이만큼 뒤에는 다시 판정한다 —
# 이벤트 하나에 전부를 걸지 않는 안전망이다(놓침이 곧 영구 대기가 되면 안 된다).
_WAIT_SLICE_SEC = 30.0

router = APIRouter(prefix="/api/itl", tags=["itl"])

# 한 번에 보낼 수 있는 대상 수 상한 — @all 오타 하나로 전 터미널에 명령이 박히는 걸 막는다.
MAX_FANOUT = 20
# 상태 주소(`@working`)는 매칭 전에 상태를 알아야 해서 한 호스트에 두 단계(상태 조회 →
# 배달)가 돈다. 두 단계가 각자 HOST_DEADLINE(20s)을 쓰면 합이 호출자 상한(CLI·MCP = 30s)을
# 넘겨 **배달됐는데 실패로 읽히고 재시도가 중복 전송**이 된다. 그래서 예산은 하나를 나눠
# 쓴다: 상태 조회에 쓴 시간을 배달 몫에서 뺀다.
STATUS_PHASE_BUDGET = itl_remote.HOST_DEADLINE / 2
# 다만 배달 몫이 0 이 되면 안 된다 — 상태 조회가 예산을 다 먹어도 배달은 시도해 본다.
MIN_DELIVER_DEADLINE = 5.0
MAX_TEXT_CHARS = 8000
MAX_READ_LINES = 200
MAX_READ_CHARS = 20_000

# Agent-to-agent loops (A→B→A) can amplify fan-out. Self-exclusion (§D6) blocks
# 1-hop loops but not 2-hop ones, so we cap writes per source session. Reads are
# exempt: terminal_wait polls /targets every 2s, which is normal model behavior.
RATE_LIMIT_MAX = 30
RATE_LIMIT_WINDOW = 60

# §6.3: `send_key` uses tmux key names (C-c, Escape, ...) which are interpreted
# by tmux — never `send_keys -l`, which would type "C-c" literally (telegram
# abort button trap). Whitelist keeps the surface tiny.
ALLOWED_KEYS = {"C-c", "Escape", "Enter", "q"}

# skip 사유 — CLI·MCP 의 사람말 번역표와 **같이** 움직여야 한다(한쪽만 늘리면 슬러그가 노출된다).
REASON_UNSUPPORTED = "remote-unsupported"
REASON_GONE = "session-gone"
REASON_UNREACHABLE = "host-unreachable"
REASON_SEND_FAILED = "send-failed"
REASON_DEADLINE = "deadline"


class SendRequest(BaseModel):
    to: str = Field(..., min_length=1, max_length=200)
    text: str = Field(..., min_length=1, max_length=MAX_TEXT_CHARS)
    # 기본은 엔터 없음. 사람이 보고 치는 편이 안전하다 — 대화형 앱 한가운데에 엔터가
    # 들어가면 의도치 않은 실행이 된다(터미널 파일 드롭과 같은 원칙).
    submit: bool = False
    # 보내는 쪽 세션. `itl send 3` 처럼 탭을 생략한 주소의 기준점이 된다.
    from_session: str | None = Field(default=None, max_length=128)
    # Set only by the MCP server. CLI never sends it, hence default False.
    # Drops targets whose sessionId or tmuxSession equals from_session.
    exclude_self: bool = False
    # 받는 쪽이 출처를 알게 앞에 `[from …]` 을 붙인다. 보내는 쪽은 본문만 쓰면 된다.
    # 끄는 길을 남기는 이유: 스크립트가 만든 문자열을 그대로 넣어야 할 때가 있다.
    origin: bool = True


class KeyRequest(BaseModel):
    to: str = Field(..., min_length=1, max_length=200)
    key: str = Field(..., min_length=1, max_length=16)
    from_session: str | None = Field(default=None, max_length=128)
    exclude_self: bool = False


async def _targets_for(username: str) -> list[dict]:
    state = await storage.get_tab_state(username) or {}
    return build_targets(state.get("tabs") or [], agent_status_watcher.snapshot())


def _read_enabled() -> bool:
    """ITL_READ_ENABLED env switch (default on). Reading widens the surface of a
    leaked ITL_TOKEN from send-only to send+read ≈ interactive shell, so a
    deployment that wants the narrower surface can set ``ITL_READ_ENABLED=0``."""
    return os.getenv("ITL_READ_ENABLED", "1") != "0"


def _tail(text: str, lines: int) -> str:
    """raw mode — last ``lines`` lines of the capture, preserving order.

    `capture-pane` pads to the pane height, so the tail of a half-empty screen is all
    blanks. Trailing blank lines are dropped first, or `lines=40` can return 40 empties.
    """
    if not text or lines <= 0:
        return ""
    all_lines = text.splitlines()
    while all_lines and not all_lines[-1].strip():
        all_lines.pop()
    return "\n".join(all_lines[-lines:])


def _truncate_for_response(text: str) -> str:
    """Enforce MAX_READ_CHARS. Over → keep the tail and prefix a cut marker."""
    if len(text) <= MAX_READ_CHARS:
        return text
    prefix = "…(잘림)\n"
    return prefix + text[-(MAX_READ_CHARS - len(prefix)):]


def collapse_lines(text: str) -> str:
    """여러 줄 → 한 줄. `send-keys -l` 에서 개행은 **Enter** 라, 그대로 보내면 줄마다
    제출돼 대화형 TUI 가 조각난 명령 N 개를 받는다.

    CLI 도 같은 일을 하지만(`cli/itl` 의 `_single_line`), 규칙이 있어야 할 자리는
    **경계**다 — MCP 서버와 직접 호출하는 클라이언트는 CLI 를 지나지 않는다.
    두 구현은 반드시 같은 답을 내야 한다(tests/test_itl_remote_setup.py 가 대조한다).
    """
    flat = text.replace("\r\n", "\n").replace("\r", "\n")
    if "\n" not in flat:
        return text
    return " · ".join(part.strip() for part in flat.split("\n") if part.strip())


async def _fill_remote_status(targets: list[dict], username: str) -> list[dict]:
    """원격 pane 의 command/status/title 을 채운다 — **호스트당 SSH 한 번**.

    기본 목록에는 없다. 백엔드 워처는 원격 tmux 를 볼 수 없고(CLAUDE.md 의 상태감지 절),
    목록을 그릴 때마다 SSH 를 거는 건 너무 비싸다. 그래서 필요한 쪽이 요청할 때만 한다.

    ⚠️ 못 물어본 호스트의 pane 은 status 를 채우지 않고 `statusUnknown` 을 세운다 —
    "일 안 한다" 와 "모른다" 를 같게 취급하면 기다림이 **즉시 거짓 완료**로 끝난다
    (원격은 status 가 늘 비어 있어서 `terminal_wait` 가 0 초에 "완료" 를 돌려줬다).
    """
    host_ids = sorted({
        t["hostId"] for t in targets
        if not t.get("sessionId") and t.get("hostId")
    })
    if not host_ids:
        return targets

    # 리모트가 붙어 있는 호스트는 **이미 상태를 밀어 주고 있다** — 물어볼 이유가 없다.
    # 그 호스트만 빼고 나머지에만 SSH 를 건다.
    from remote_agent import ingest
    streamed = {h: _table_from_stream(ingest.snapshot(h)) for h in host_ids
                if ingest.has_live_state(h)}
    need_ssh = [h for h in host_ids if h not in streamed]

    tables = dict(streamed)
    if need_ssh:
        fetched = await asyncio.gather(*[
            itl_remote.list_pane_status(host_id, username) for host_id in need_ssh
        ])
        tables.update(dict(zip(need_ssh, fetched, strict=True)))
    return _apply_status_tables(targets, tables)


def _table_from_stream(snapshot: dict) -> dict:
    """리모트가 밀어 준 상태 → `list_pane_status` 와 **같은 모양**(세션명 → (명령, 타이틀)).

    모양을 맞추는 이유: 아래 `_apply_status_tables` 가 두 경로의 단일 판정이다. 여기서
    다른 모양을 내면 그 판정이 갈라지고, 갈라지면 한쪽이 "모름" 을 "일 안 함" 으로 접는다.
    """
    return {
        session: (info.get("command") or "", info.get("rawTitle") or "")
        for session, info in (snapshot or {}).items()
    }


def _apply_status_tables(targets: list[dict], by_host: dict[str, dict]) -> list[dict]:
    """호스트별 상태 표를 target 목록에 얹는다 — 채우기 경로들의 **단일 판정**.

    이 함수가 따로 있는 이유: 상태를 채우는 길이 둘이다(자기 연결을 여는
    `_fill_remote_status`, 팬아웃의 공유 채널을 쓰는 `_fill_status_over`). 판정이
    갈리면 한쪽만 "모름" 을 "일 안 함" 으로 접어 상태 주소가 다시 거짓말을 시작한다.
    """
    filled: list[dict] = []
    for target in targets:
        if target.get("sessionId") or not target.get("hostId"):
            filled.append(target)
            continue
        table = by_host.get(target["hostId"])
        if not table:
            filled.append({**target, "statusUnknown": True})
            continue
        info = table.get(target.get("tmuxSession") or "")
        if info is None:
            # 호스트는 답했는데 그 세션이 없다 — 사라진 것이지 모르는 게 아니다.
            filled.append({**target, "status": None, "statusUnknown": False, "statusGone": True})
            continue
        command, title = info
        filled.append({
            **target,
            "statusUnknown": False,          # 물어봤고 답을 받았다
            "command": command,
            "title": display_title(title),
            "status": detect_status(title),
        })
    return filled


@router.get("/targets")
async def itl_targets(
    from_session: str | None = Query(None),
    fmt: str = Query("json", pattern="^(json|table)$"),
    scope: str = Query("all", pattern="^(all|same_tab)$"),
    status: str | None = Query(None, pattern="^(working|idle|permission)$"),
    command: str | None = Query(None, max_length=64),
    exclude_self: bool = Query(False),
    remote_status: bool = Query(False),
    username: str = Depends(verify_itl_token),
):
    """열려 있는 터미널 목록. `fmt=table` 은 CLI 가 그대로 출력한다.

    `scope=same_tab` 은 호출자가 속한 탭으로 좁힌다 — from_session 이 없으면
    좁힐 기준이 없으므로 422 로 명확히 알린다.

    `remote_status=1` 은 원격 pane 의 상태까지 채운다(호스트당 SSH 한 번). 기본은 끈다 —
    목록 조회는 값싸야 한다.
    """
    if scope == "same_tab" and not from_session:
        raise HTTPException(
            status_code=422,
            detail='same_tab은 from_session이 필요합니다. scope="all"로 다시 시도하세요.',
        )
    targets = await _targets_for(username)
    # 채우기가 필터보다 먼저다 — `status=working&remote_status=1` 이 원격에도 걸리게.
    if remote_status:
        targets = await _fill_remote_status(targets, username)
    targets = filter_targets(
        targets, scope=scope, from_session=from_session,
        status=status, command=command, exclude_self=exclude_self,
    )
    if fmt == "table":
        return {"table": format_table(targets, from_session)}
    return {"targets": targets}


@router.get("/wait")
async def itl_wait(
    to: str = Query(..., max_length=200),
    until: str = Query("not_working", pattern="^(not_working|idle|permission)$"),
    timeout_sec: int = Query(25, ge=1, le=60),
    from_session: str | None = Query(None),
    username: str = Depends(verify_itl_token),
):
    """조건이 될 때까지 **서버가 붙잡는다.** 호출자는 한 번만 부른다.

    예전에는 호출자가 2초(로컬)·5초(원격)마다 다시 물었고, 원격은 그때마다 SSH 왕복이었다.
    지금은 상태가 **바뀔 때만** 깨어나 다시 판정한다 — 조용한 동안에는 아무 일도 안 일어난다.

    ⚠️ **짧게 붙잡는다**(최대 60초, 호출자는 25초를 쓴다). 오래 매달린 요청은 이 저장소가
    이미 겪은 고장이다 — 공유 HTTP/2 풀을 물고 늘어지고 iOS 는 그걸 로딩으로 센다.
    상한에 닿으면 `reached: false` 로 돌려주고 호출자가 이어 부를지 정한다.
    """
    deadline = time.monotonic() + timeout_sec
    start = time.monotonic()
    expected: set[str] | None = None
    gone: set[str] = set()

    while True:
        targets = await _targets_for(username)
        needs_remote = any(not t.get("sessionId") and t.get("hostId") for t in targets)
        if needs_remote:
            targets = await _fill_remote_status(targets, username)
        matched = resolve(targets, to, from_session)
        by_addr = {t.get("addr"): t for t in matched}
        if expected is None:
            if not matched:
                raise HTTPException(status_code=404, detail=f"'{to}'에 해당하는 터미널이 없습니다")
            expected = set(by_addr)
        # 사라진 pane 은 조건을 만족한 것으로 친다(세션 종료).
        gone |= {addr for addr in expected if addr not in by_addr}
        remaining = expected - gone
        if all(_wait_reached(by_addr[a], until) for a in remaining if a in by_addr):
            return {"reached": True, "elapsed_sec": int(time.monotonic() - start),
                    "targets": [by_addr[a] for a in sorted(expected) if a in by_addr]}

        left = deadline - time.monotonic()
        if left <= 0:
            return {"reached": False, "elapsed_sec": int(time.monotonic() - start),
                    "targets": [by_addr[a] for a in sorted(expected) if a in by_addr]}
        # 변화가 올 때까지 잔다. 안 오면 상한에서 깬다 — 폴링이 아니다.
        await agent_status_events.wait_for_change(min(left, _WAIT_SLICE_SEC))


def _wait_reached(target: dict, until: str) -> bool:
    """조건 만족 여부 — **모르는 것은 만족이 아니다.**

    ⚠️ 원격 pane 의 status 는 비어 있을 수 있고, 빈 값을 "일 안 함" 으로 읽으면 기다림이
    0초에 거짓 완료로 끝난다. 이 저장소가 세 번 밟은 사고다.
    """
    if target.get("statusUnknown"):
        return False
    if target.get("statusGone"):
        return True
    status = target.get("status")
    if until == "not_working":
        return status is not None and status != "working"
    return status == until


@router.get("/resolve")
async def itl_resolve(
    to: str = Query(...),
    from_session: str | None = Query(None),
    remote_status: bool = Query(False),
    username: str = Depends(verify_itl_token),
):
    """주소가 어디로 가는지 미리 본다 — 보내기 전에 확인용(dry-run).

    `remote_status=1` 은 맞은 pane 이 원격일 때 그 상태까지 채운다(호스트당 SSH 한 번).
    기다림(`terminal_wait`)이 이걸 쓴다 — 상태를 모르는 채로 기다리면 즉시 끝나버린다.

    ⚠️ **채우기가 매칭보다 먼저여야 하는 경우가 있다.** `@working` 처럼 주소가 상태로
    대상을 고르면, 상태가 빈 원격 pane 은 어떤 그룹에도 안 맞아 **통째로 조용히 빠진다** —
    `remote_status=1` 을 줘도 그랬다(채우기가 매칭 뒤였으므로). `/targets` 는 이미
    "채우기가 필터보다 먼저" 인데 여기만 반대였다.

    그 외 주소(번호·이름·명령)는 매칭에 상태가 필요 없으므로 **맞은 것만** 채운다 —
    `terminal_wait` 가 원격 pane 하나를 5초마다 폴링하는데, 그걸 전체 호스트 SSH 로
    바꾸면 폴링 비용이 호스트 수만큼 곱해진다.
    """
    targets = await _targets_for(username)
    if remote_status and references_status_group(to):
        targets = await _fill_remote_status(targets, username)
        return {"matched": resolve(targets, to, from_session)}
    matched = resolve(targets, to, from_session)
    if remote_status and matched:
        matched = await _fill_remote_status(matched, username)
    return {"matched": matched}


@router.get("/read")
async def itl_read(
    to: str = Query(..., min_length=1, max_length=200),
    from_session: str | None = Query(None),
    lines: int = Query(40, ge=1, le=MAX_READ_LINES),
    mode: str = Query("excerpt", pattern="^(excerpt|raw)$"),
    username: str = Depends(verify_itl_token),
):
    """터미널 화면을 읽는다. ``excerpt`` 는 UI 장식을 걷어낸 발췌, ``raw`` 는 그대로.

    원격도 읽는다 — 보낸 뒤 "뭐 하고 있나" 를 볼 수 없으면 핸드오프는 눈 감고 하는 일이 된다.

    읽기가 생기면 유출된 ITL_TOKEN 은 보내기+읽기 = 사실상 대화형 셸이 된다.
    ``ITL_READ_ENABLED=0`` 으로 끌 수 있다(기본 1).
    """
    if not _read_enabled():
        raise HTTPException(status_code=403, detail="읽기가 비활성화돼 있습니다")

    targets = await _targets_for(username)
    matched = resolve(targets, to, from_session)
    if not matched:
        raise HTTPException(status_code=404, detail=f"'{to}'에 해당하는 터미널이 없습니다")
    if len(matched) > 1:
        return JSONResponse(
            status_code=400,
            content={
                "detail": f"대상이 {len(matched)}개 입니다. 주소를 좁혀주세요.",
                "matched": [t["addr"] for t in matched],
            },
        )

    target = matched[0]
    session_id = target.get("sessionId")
    if session_id:
        if not await tmux_manager.session_exists(session_id):
            raise HTTPException(status_code=404, detail="session-gone")
        pane_text = await tmux_manager.capture_pane(session_id, lines)
    else:
        pane_text = await _read_remote(target, username, lines)

    text = extract_excerpt(pane_text) if mode == "excerpt" else _tail(pane_text, lines)
    text = _truncate_for_response(text)

    logger.info("itl read: to=%s mode=%s len=%d", to, mode, len(text))
    return {"addr": target["addr"], "sessionId": session_id,
            "hostId": target.get("hostId"), "mode": mode, "text": text}


async def _read_remote(target: dict, username: str, lines: int) -> str:
    """원격 pane 화면 — 연결 하나로 생사 확인과 캡처를 같이 한다."""
    host_id, tmux_session = target.get("hostId"), target.get("tmuxSession")
    if not (host_id and tmux_session):
        raise HTTPException(status_code=400, detail="읽을 수 있는 터미널이 아닙니다")
    try:
        async with await itl_remote.open_channel(host_id, username) as channel:
            if await itl_remote.probe(channel, tmux_session) is None:
                raise HTTPException(status_code=404, detail="session-gone")
            return await itl_remote.capture_pane(channel, tmux_session, lines)
    except HTTPException:
        raise
    except Exception as e:
        logger.info("itl remote read failed (%s/%s): %s", host_id, tmux_session, e)
        raise HTTPException(status_code=502, detail="그 호스트에 못 닿았습니다") from e


async def _origin_context(from_session: str | None, username: str) -> tuple[dict | None, str, str]:
    """(보낸 pane, 그 기계 이름, **이 서버의** itl 명령).

    실패해도 전달은 막지 않는다 — 꼬리표가 본문보다 중요할 수 없다. 한 번만 계산해서
    대상마다 쓴다(예전엔 로컬용·원격용으로 두 번 불러 탭 상태를 두 번 읽었다).
    """
    try:
        sender = find_sender(await _targets_for(username), from_session)
        if not sender:
            return None, "", ""
        identity = await get_server_identity()
        if sender.get("hostId"):
            host = await storage.get_host(sender["hostId"], username)
            machine = (host or {}).get("name") or ""
        else:
            machine = identity.get("hostname") or ""
        return sender, machine, (identity.get("itl_cmd") or "")
    except Exception as e:
        logger.debug("origin context skipped: %s", e)
        return None, "", ""


def _skip(target: dict, reason: str) -> dict:
    return {"skipped": {"addr": target["addr"], "reason": reason}}


def _is_self(target: dict, from_session: str | None) -> bool:
    return bool(from_session) and from_session in (target.get("sessionId"), target.get("tmuxSession"))


class _HostChannels:
    """호스트당 SSH 연결을 **한 번만** 열고 팬아웃이 끝날 때까지 재사용한다.

    `@working` 같은 상태 주소는 매칭 전에 상태를 알아야 하는데(안 그러면 원격이 통째로
    빠진다), 상태 조회와 배달이 각자 연결을 열면 **호스트당 왕복이 두 번**이 된다.
    그러면 이 저장소가 이미 적어 둔 함정을 그대로 밟는다 — 백엔드 상한(20s)이 호출자
    상한(30s)을 넘겨 **배달됐는데 실패로 읽히고 재시도가 중복 전송**이 된다.

    실패는 기억한다. 못 연 호스트를 매번 다시 열려고 하면 죽은 호스트 하나가 마감시한을
    통째로 먹는다.
    """

    def __init__(self, username: str) -> None:
        self._username = username
        self._open: dict[str, itl_remote.RemoteChannel] = {}
        self._failed: set[str] = set()

    async def get(self, host_id: str) -> itl_remote.RemoteChannel | None:
        if host_id in self._open:
            return self._open[host_id]
        if host_id in self._failed:
            return None
        try:
            channel = await asyncio.wait_for(
                itl_remote.open_channel(host_id, self._username),
                timeout=itl_remote.REMOTE_CONNECT_TIMEOUT,
            )
        except Exception as e:
            logger.info("itl channel open failed (host=%s): %s", host_id, e)
            self._failed.add(host_id)
            return None
        self._open[host_id] = channel
        return channel

    async def aclose(self) -> None:
        channels, self._open = list(self._open.values()), {}
        # 하나가 못 닫혀도 나머지는 닫는다 — 열어 둔 SSH 가 남으면 그게 다음 사고다.
        await asyncio.gather(*[c.close() for c in channels], return_exceptions=True)


async def _fill_status_over(channels: _HostChannels, targets: list[dict]) -> list[dict]:
    """`_fill_remote_status` 와 **같은 판정**, 다만 이미 열린 채널 위에서 돈다.

    ⚠️ 두 함수는 "못 물어본 것은 `statusUnknown`" 규칙을 반드시 같이 지켜야 한다.
    한쪽만 빈 상태를 "일 안 함" 으로 접으면 상태 주소가 다시 거짓말을 시작한다.
    """
    host_ids = sorted({
        t["hostId"] for t in targets if not t.get("sessionId") and t.get("hostId")
    })
    if not host_ids:
        return targets

    async def one(host_id: str) -> dict[str, tuple[str, str]]:
        channel = await channels.get(host_id)
        if channel is None:
            return {}
        try:
            return itl_remote.parse_list_status(
                await channel.run(itl_remote.build_list_status_cmd())
            )
        except Exception as e:
            logger.info("itl remote status over shared channel failed (host=%s): %s", host_id, e)
            return {}

    fetched = await asyncio.gather(*[one(h) for h in host_ids])
    return _apply_status_tables(targets, dict(zip(host_ids, fetched, strict=True)))


async def _deliver_to_host(
    host_id: str,
    targets: list[dict],
    username: str,
    deliver_remote: Callable[[itl_remote.RemoteChannel, str, itl_remote.PaneProbe], Awaitable[dict | None]],
    outcome: dict[str, dict],
    *,
    channels: _HostChannels | None = None,
    deadline: float = itl_remote.HOST_DEADLINE,
) -> None:
    """한 호스트의 대상 전부 — **연결 하나**로. 예외는 여기서 흡수한다.

    호스트 하나가 죽었다고 팬아웃 전체가 실패하면 안 되고, 그렇다고 배달 못 한 것을
    delivered 로 세도 안 된다. 그래서 모든 갈래가 outcome 에 사유를 남긴다.

    `channels` 가 오면 그 호스트 채널을 **이미 열려 있는 것으로 재사용**한다(상태 주소
    경로). `deadline` 은 그때 상태 조회에 쓴 시간을 뺀 나머지다 — 두 단계를 각자
    HOST_DEADLINE 으로 두면 합이 호출자 상한(30s)을 넘어, 배달됐는데 실패로 읽히고
    재시도가 중복 전송이 된다.
    """
    def mark_rest(reason: str) -> None:
        for target in targets:
            outcome.setdefault(target["addr"], _skip(target, reason))

    try:
        await asyncio.wait_for(
            _deliver_to_host_inner(host_id, targets, username, deliver_remote, outcome,
                                   channels=channels),
            timeout=max(deadline, MIN_DELIVER_DEADLINE),
        )
    except TimeoutError:
        logger.warning("itl remote fanout deadline (host=%s, %d targets)", host_id, len(targets))
        mark_rest(REASON_DEADLINE)
    except Exception as e:
        logger.warning("itl remote fanout failed (host=%s): %s", host_id, e)
        mark_rest(REASON_UNREACHABLE)


async def _deliver_to_host_inner(
    host_id: str,
    targets: list[dict],
    username: str,
    deliver_remote: Callable[[itl_remote.RemoteChannel, str, itl_remote.PaneProbe], Awaitable[dict | None]],
    outcome: dict[str, dict],
    *,
    channels: _HostChannels | None = None,
) -> None:
    if channels is not None:
        channel = await channels.get(host_id)
        if channel is None:
            raise ConnectionError(f"채널을 열지 못했습니다: {host_id}")
        await _deliver_over(channel, host_id, targets, deliver_remote, outcome)
        return
    async with await itl_remote.open_channel(host_id, username) as channel:
        await _deliver_over(channel, host_id, targets, deliver_remote, outcome)


async def _deliver_over(
    channel: itl_remote.RemoteChannel,
    host_id: str,
    targets: list[dict],
    deliver_remote: Callable[[itl_remote.RemoteChannel, str, itl_remote.PaneProbe], Awaitable[dict | None]],
    outcome: dict[str, dict],
) -> None:
    """열려 있는 채널 하나로 그 호스트의 대상 전부에 배달한다."""
    for target in targets:
        addr, tmux_session = target["addr"], target["tmuxSession"]
        try:
            found = await itl_remote.probe(channel, tmux_session)
        except Exception as e:
            logger.warning("itl remote probe failed (%s/%s): %s", host_id, tmux_session, e)
            outcome[addr] = _skip(target, REASON_UNREACHABLE)
            continue
        if found is None:
            outcome[addr] = _skip(target, REASON_GONE)
            continue
        try:
            extra = await deliver_remote(channel, tmux_session, found)
        except itl_remote.RemoteSendError as e:
            logger.warning("itl remote send unconfirmed (%s/%s): %s", host_id, tmux_session, e)
            outcome[addr] = _skip(target, REASON_SEND_FAILED)
        except Exception as e:
            logger.warning("itl remote deliver failed (%s/%s): %s", host_id, tmux_session, e)
            outcome[addr] = _skip(target, REASON_UNREACHABLE)
        else:
            outcome[addr] = {"delivered": {"addr": addr, "hostId": host_id,
                                           "tmuxSession": tmux_session, **(extra or {})}}


async def _fanout_deliver(
    to: str,
    from_session: str | None,
    username: str,
    *,
    bucket: str,
    deliver_local: Callable[[str], Awaitable[dict | None]],
    deliver_remote: Callable[[itl_remote.RemoteChannel, str, itl_remote.PaneProbe], Awaitable[dict | None]] | None = None,
    exclude_self: bool = False,
) -> dict:
    """Resolve ``to`` against the caller's tabs and deliver to every matched pane.

    Single source of truth for the rules /send and /key share: rate-limit check on
    ``bucket``, 404 on no match, MAX_FANOUT 400, ``exclude_self`` filter, per-target
    skip bookkeeping, delivered/skipped shape.

    로컬은 같은 기계의 tmux 라 순서대로 즉시 처리한다. 원격은 **호스트별로 묶어** 연결
    하나를 열고, 호스트들끼리는 병렬이다 — 그래서 팬아웃 총 시간이 호스트 수만큼 늘지
    않는다(예전엔 대상마다 핸드셰이크 3번 × 순차라 호출자 타임아웃을 넘겼다).
    결과는 `matched` 순서로 다시 조립한다 — 병렬이어도 출력은 늘 같은 순서다.
    """
    check_rate_limit(bucket, max_attempts=RATE_LIMIT_MAX, window_seconds=RATE_LIMIT_WINDOW)
    targets = await _targets_for(username)

    # `@working` 처럼 주소가 **상태로** 대상을 고르면 매칭 전에 상태를 채워야 한다.
    # 원격 pane 의 status 는 워처가 못 봐서 비어 있고, 빈 값은 어떤 상태 그룹에도 안 맞아
    # **원격이 통째로 조용히 빠진다** — 호출자는 그걸 "원격은 안 돌고 있다" 로 읽는다.
    #
    # 채널은 그때 열어 **배달까지 재사용**한다. 따로 열면 호스트당 왕복이 두 번이 되고,
    # 그러면 시간 예산이 호출자 상한을 넘겨 중복 전송을 부른다(STATUS_PHASE_BUDGET 주석).
    channels: _HostChannels | None = None
    status_elapsed = 0.0
    if deliver_remote is not None and references_status_group(to):
        channels = _HostChannels(username)
        started = time.monotonic()
        try:
            targets = await asyncio.wait_for(
                _fill_status_over(channels, targets), timeout=STATUS_PHASE_BUDGET,
            )
        except TimeoutError:
            # 못 물어본 것은 그대로 "모름" 이라 상태 그룹에 안 걸린다 — 조용히 틀린 답을
            # 주는 대신 대상에서 빠지는 쪽이 맞다.
            logger.warning("itl status phase deadline (to=%s)", to)
        status_elapsed = time.monotonic() - started

    try:
        return await _fanout_after_resolve(
            targets, to, from_session, username,
            bucket=bucket, deliver_local=deliver_local, deliver_remote=deliver_remote,
            exclude_self=exclude_self, channels=channels, status_elapsed=status_elapsed,
        )
    finally:
        if channels is not None:
            await channels.aclose()


async def _fanout_after_resolve(
    targets: list[dict],
    to: str,
    from_session: str | None,
    username: str,
    *,
    bucket: str,
    deliver_local: Callable[[str], Awaitable[dict | None]],
    deliver_remote: Callable[[itl_remote.RemoteChannel, str, itl_remote.PaneProbe], Awaitable[dict | None]] | None,
    exclude_self: bool,
    channels: _HostChannels | None,
    status_elapsed: float,
) -> dict:
    """해소부터 배달까지 — 상태 채우기가 끝난 뒤의 나머지 전부."""
    matched = resolve(targets, to, from_session)
    if not matched:
        raise HTTPException(status_code=404, detail=f"'{to}' 에 해당하는 터미널이 없습니다")
    if len(matched) > MAX_FANOUT:
        raise HTTPException(
            status_code=400,
            detail=f"대상이 너무 많습니다 ({len(matched)} > {MAX_FANOUT}). 주소를 좁혀주세요.",
        )

    chosen = [t for t in matched if not (exclude_self and _is_self(t, from_session))]
    outcome: dict[str, dict] = {}

    # 원격은 호스트별로 모은다. 보낼 곳을 모르는 pane(세션도 호스트도 없음)은 여기서 갈린다.
    remote_by_host: dict[str, list[dict]] = {}
    for target in chosen:
        if target.get("sessionId"):
            continue
        host_id, tmux_session = target.get("hostId"), target.get("tmuxSession")
        if not (host_id and tmux_session and deliver_remote):
            outcome[target["addr"]] = _skip(target, REASON_UNSUPPORTED)
            continue
        remote_by_host.setdefault(host_id, []).append(target)

    for target in chosen:
        session_id = target.get("sessionId")
        if not session_id:
            continue
        if not await tmux_manager.session_exists(session_id):
            outcome[target["addr"]] = _skip(target, REASON_GONE)
            continue
        extra = await deliver_local(session_id)
        outcome[target["addr"]] = {
            "delivered": {"addr": target["addr"], "sessionId": session_id, **(extra or {})},
        }

    if remote_by_host and deliver_remote:
        remaining = itl_remote.HOST_DEADLINE - status_elapsed
        await asyncio.gather(*[
            _deliver_to_host(host_id, host_targets, username, deliver_remote, outcome,
                             channels=channels, deadline=remaining)
            for host_id, host_targets in remote_by_host.items()
        ])

    delivered = [outcome[t["addr"]]["delivered"] for t in chosen
                 if "delivered" in outcome.get(t["addr"], {})]
    skipped = [outcome[t["addr"]]["skipped"] for t in chosen
               if "skipped" in outcome.get(t["addr"], {})]

    logger.info("itl fanout: bucket=%s to=%s delivered=%d skipped=%d",
                bucket, to, len(delivered), len(skipped))
    return {"delivered": delivered, "skipped": skipped}


@router.post("/send")
async def itl_send(request: SendRequest, username: str = Depends(verify_itl_token)):
    """해소된 대상 전부에 문자열을 입력한다 — 로컬이든 원격이든.

    원격은 백엔드가 저장된 자격증명으로 SSH 를 걸어 그 호스트의 tmux 에 넣는다.
    부르는 쪽은 그 호스트의 열쇠가 필요 없다 (itl_remote 의 설명 참고).
    """
    text = collapse_lines(request.text)
    if not text.strip():
        raise HTTPException(status_code=400, detail="보낼 내용이 비어 있습니다")

    sender, machine, local_itl_cmd = (
        await _origin_context(request.from_session, username) if request.origin
        else (None, "", "")
    )

    def prefix_for(itl_cmd: str, command: str, title: str) -> tuple[str, bool]:
        """`(꼬리표, 답장명령이_붙었나)`.

        꼬리표는 **에이전트 프롬프트에만** 붙인다. 셸에 붙으면 `[from …] ls` 가 되어
        그 줄 전체가 실행 불가능한 명령이 된다. 그래서 대상마다 따로 판정한다.

        답장 명령은 **받는 쪽이 실제로 itl 을 쓸 수 있을 때만** 넣는다 — 로컬은 이 서버의
        itl_cmd, 원격은 그 호스트에서 probe 로 확인한 것. 못 쓰는 명령을 답장 방법이라고
        적어 보내면 "command not found" 를 답장이라고 믿게 만든다.

        붙었는지를 **돌려주는 이유**: 보내는 쪽은 꼬리표를 볼 수 없다. 그래서 답장이
        올 수 있는지를 모르고, 모르면 기다리는 쪽(폴링)을 고른다. 이 값이 그대로
        `delivered[].reply` 가 되어 CLI·MCP 응답에 "답장이 온다" 를 적게 한다.
        """
        if not sender or not is_agent_pane(command, title):
            return "", False
        reply_cmd = build_reply_cmd(itl_cmd, sender)
        return format_origin(sender, machine, reply_cmd), bool(reply_cmd)

    async def deliver_local(session_id: str) -> dict:
        command, title = await tmux_manager.pane_info(session_id) or ("", "")
        prefix, replyable = prefix_for(local_itl_cmd, command, title)
        await tmux_manager.send_keys(session_id, prefix + text, submit=request.submit)
        return {"reply": replyable}

    async def deliver_remote(channel: itl_remote.RemoteChannel, tmux_session: str,
                             found: itl_remote.PaneProbe) -> dict:
        prefix, replyable = prefix_for(found.itl_cmd, found.command, found.title)
        await itl_remote.send_text(channel, tmux_session, prefix + text, submit=request.submit)
        return {"reply": replyable}

    return await _fanout_deliver(
        request.to, request.from_session, username,
        bucket=f"itl:send:{request.from_session or username}",
        deliver_local=deliver_local, deliver_remote=deliver_remote,
        exclude_self=request.exclude_self,
    )


@router.post("/key")
async def itl_key(request: KeyRequest, username: str = Depends(verify_itl_token)):
    """해소된 대상 전부에 특수 키를 보낸다.

    `tmux_manager.send_key` 를 쓴다 — `send_keys -l` 은 "C-c" 라는 글자를
    그대로 타이핑한다 (telegram 중단 버튼 함정). 화이트리스트 밖은 400.
    """
    if request.key not in ALLOWED_KEYS:
        raise HTTPException(
            status_code=400,
            detail=f"지원하지 않는 키: {request.key}. 허용: {', '.join(sorted(ALLOWED_KEYS))}",
        )

    async def deliver_local(session_id: str) -> None:
        await tmux_manager.send_key(session_id, request.key)

    async def deliver_remote(channel: itl_remote.RemoteChannel, tmux_session: str,
                             found: itl_remote.PaneProbe) -> None:
        await itl_remote.send_key(channel, tmux_session, request.key)

    return await _fanout_deliver(
        request.to, request.from_session, username,
        bucket=f"itl:key:{request.from_session or username}",
        deliver_local=deliver_local, deliver_remote=deliver_remote,
        exclude_self=request.exclude_self,
    )

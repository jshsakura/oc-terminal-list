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
from collections.abc import Awaitable, Callable

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import itl_remote
from _deps import verify_itl_token
from agent_status import detect_status, display_title, is_agent_pane
from agent_status_service import agent_status_watcher
from itl_origin import build_reply_cmd, find_sender, format_origin
from itl_targets import build_targets, filter_targets, format_table, resolve
from pane_excerpt import extract_excerpt
from rate_limit import check_rate_limit
from server_identity import get_server_identity
from sqlite_storage import storage
from tmux_manager import tmux_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/itl", tags=["itl"])

# 한 번에 보낼 수 있는 대상 수 상한 — @all 오타 하나로 전 터미널에 명령이 박히는 걸 막는다.
MAX_FANOUT = 20
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
    fetched = await asyncio.gather(*[
        itl_remote.list_pane_status(host_id, username) for host_id in host_ids
    ])
    by_host = dict(zip(host_ids, fetched, strict=True))

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
    """
    targets = await _targets_for(username)
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


async def _deliver_to_host(
    host_id: str,
    targets: list[dict],
    username: str,
    deliver_remote: Callable[[itl_remote.RemoteChannel, str, itl_remote.PaneProbe], Awaitable[None]],
    outcome: dict[str, dict],
) -> None:
    """한 호스트의 대상 전부 — **연결 하나**로. 예외는 여기서 흡수한다.

    호스트 하나가 죽었다고 팬아웃 전체가 실패하면 안 되고, 그렇다고 배달 못 한 것을
    delivered 로 세도 안 된다. 그래서 모든 갈래가 outcome 에 사유를 남긴다.
    """
    def mark_rest(reason: str) -> None:
        for target in targets:
            outcome.setdefault(target["addr"], _skip(target, reason))

    try:
        await asyncio.wait_for(
            _deliver_to_host_inner(host_id, targets, username, deliver_remote, outcome),
            timeout=itl_remote.HOST_DEADLINE,
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
    deliver_remote: Callable[[itl_remote.RemoteChannel, str, itl_remote.PaneProbe], Awaitable[None]],
    outcome: dict[str, dict],
) -> None:
    async with await itl_remote.open_channel(host_id, username) as channel:
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
                await deliver_remote(channel, tmux_session, found)
            except itl_remote.RemoteSendError as e:
                logger.warning("itl remote send unconfirmed (%s/%s): %s", host_id, tmux_session, e)
                outcome[addr] = _skip(target, REASON_SEND_FAILED)
            except Exception as e:
                logger.warning("itl remote deliver failed (%s/%s): %s", host_id, tmux_session, e)
                outcome[addr] = _skip(target, REASON_UNREACHABLE)
            else:
                outcome[addr] = {"delivered": {"addr": addr, "hostId": host_id,
                                               "tmuxSession": tmux_session}}


async def _fanout_deliver(
    to: str,
    from_session: str | None,
    username: str,
    *,
    bucket: str,
    deliver_local: Callable[[str], Awaitable[None]],
    deliver_remote: Callable[[itl_remote.RemoteChannel, str, itl_remote.PaneProbe], Awaitable[None]] | None = None,
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
        await deliver_local(session_id)
        outcome[target["addr"]] = {"delivered": {"addr": target["addr"], "sessionId": session_id}}

    if remote_by_host and deliver_remote:
        await asyncio.gather(*[
            _deliver_to_host(host_id, host_targets, username, deliver_remote, outcome)
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

    def prefix_for(itl_cmd: str, command: str, title: str) -> str:
        """꼬리표는 **에이전트 프롬프트에만** 붙인다. 셸에 붙으면 `[from …] ls` 가 되어
        그 줄 전체가 실행 불가능한 명령이 된다. 그래서 대상마다 따로 판정한다.

        답장 명령은 **받는 쪽이 실제로 itl 을 쓸 수 있을 때만** 넣는다 — 로컬은 이 서버의
        itl_cmd, 원격은 그 호스트에서 probe 로 확인한 것. 못 쓰는 명령을 답장 방법이라고
        적어 보내면 "command not found" 를 답장이라고 믿게 만든다.
        """
        if not sender or not is_agent_pane(command, title):
            return ""
        return format_origin(sender, machine, build_reply_cmd(itl_cmd, sender))

    async def deliver_local(session_id: str) -> None:
        command, title = await tmux_manager.pane_info(session_id) or ("", "")
        await tmux_manager.send_keys(
            session_id, prefix_for(local_itl_cmd, command, title) + text, submit=request.submit,
        )

    async def deliver_remote(channel: itl_remote.RemoteChannel, tmux_session: str,
                             found: itl_remote.PaneProbe) -> None:
        await itl_remote.send_text(
            channel, tmux_session,
            prefix_for(found.itl_cmd, found.command, found.title) + text,
            submit=request.submit,
        )

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

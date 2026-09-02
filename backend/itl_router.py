"""탭 번호(`1.2`)로 팬에 말을 옮긴다 — **같은 기계든 아니든.**

`backend/cli/itl` 은 한 기계 안만 안다(그 기계의 tmux 소켓과 herdr 소켓). 기계를 넘는
것은 여기다. 그리고 넘는 방법이 이 모듈의 전부다:

    **크리덴셜을 호스트로 내보내지 않는다. 이미 인증된 SSH 로 itl 을 밀어 넣는다.**

팬 안의 에이전트에게 SSH 키나 토큰을 주면 그 기계에서 도는 아무 코드나 그것을 읽는다.
그래서 보내는 쪽은 자기 주소와 내용만 말하고(그건 비밀이 아니다), 실제 배달은 두 호스트의
연결을 모두 쥔 이 백엔드가 한다. 호스트 N 대여도 신뢰 관계는 여전히 백엔드↔호스트 N 개뿐,
N² 이 되지 않는다.

주소는 **앱의 탭 번호**다(`탭.pane`). 그 번호를 세는 곳은 `pane_targets.build_targets`
하나이고, 화면 배지·tmux 상태바·이 라우터가 같은 값을 본다 — 두 곳이 세면 "2번" 이
가리키는 것이 화면마다 달라진다.

⚠️ **번호는 밀린다**(팬을 닫으면 뒤가 당겨진다). 그래서 저장하지 않고 배달 직전에 다시 센다.
"""
from __future__ import annotations

import asyncio
import logging
import re
import shlex
from pathlib import Path

from pane_targets import build_targets
from sqlite_storage import storage

logger = logging.getLogger(__name__)

#: 앱 주소 — `탭.pane`. 이 모양이 아니면 그 기계의 itl 이 알아서 풀 몫이다.
ADDR_RE = re.compile(r"^\d+\.\d+$")
#: Anything that could break a typed line into more than one (or move the cursor).
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")

#: 배달 한 번의 상한. 원격은 SSH 왕복이라 로컬보다 넉넉하다.
LOCAL_TIMEOUT_SEC = 10.0
REMOTE_TIMEOUT_SEC = 25.0

#: 한 번에 옮길 수 있는 길이. `cli/itl` 의 상한과 **같아야** 한다 — 여기서 통과시킨 것을
#: 저쪽이 거절하면 보낸 쪽은 성공했다고 믿는다.
MAX_TEXT_BYTES = 8192

ITL_PATH = Path(__file__).resolve().parent / "cli" / "itl"

#: 비대화형 SSH 셸의 PATH 에는 `~/.local/bin` 이 없는데 herdr 는 거기 앉는다.
#: 이 저장소가 이미 여러 번 밟은 함정이라 원격 명령마다 앞에 붙인다.
REMOTE_PATH_PREFIX = 'PATH="$HOME/.local/bin:$PATH" '


class DeliveryFailed(Exception):
    """배달 실패. **조용히 성공한 척하지 않는다** — 보낸 쪽은 상대가 받았다고 믿는다."""


def _itl_source() -> str:
    return ITL_PATH.read_text(encoding="utf-8")


def native_addr(target: dict) -> str:
    """앱의 타깃 → 그 기계의 itl 이 아는 주소.

    로컬은 세션 id(= tmux 세션명이자 herdr 세션명), 원격은 원격 tmux/herdr 세션명이다.
    어느 쪽이든 **그 기계에서 세션 하나에 팬 하나**라 itl 이 이름만으로 푼다.
    """
    return target.get("sessionId") or target.get("tmuxSession") or ""


def resolve(targets: list[dict], addr: str) -> dict:
    """`1.2` → 타깃 하나. 못 찾으면 던진다."""
    want = (addr or "").strip()
    if not ADDR_RE.match(want):
        raise DeliveryFailed(f"주소는 `탭.pane` 모양이어야 한다: {addr!r}")
    for t in targets:
        if t.get("addr") == want:
            return t
    known = ", ".join(t["addr"] for t in targets) or "(없음)"
    raise DeliveryFailed(f"그런 탭이 없다: {want} — 지금 있는 것: {known}")


async def _run_local(args: list[str]) -> str:
    proc = await asyncio.create_subprocess_exec(
        str(ITL_PATH), *args,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=LOCAL_TIMEOUT_SEC)
    except asyncio.TimeoutError as e:
        proc.kill()
        raise DeliveryFailed(f"로컬 배달이 {LOCAL_TIMEOUT_SEC}s 안에 안 끝났다") from e
    if proc.returncode != 0:
        detail = (err or b"").decode("utf-8", errors="replace").strip()
        raise DeliveryFailed(detail or f"itl → {proc.returncode}")
    return (out or b"").decode("utf-8", errors="replace")


async def _run_remote(host_id: str, username: str, args: list[str]) -> str:
    """원격에서 itl 을 **한 번** 실행한다. 설치하지 않는다.

    파일은 매번 stdin 으로 간다(llm_usage 수집기와 같은 규칙) — 설치 0, 포트 0,
    버전 드리프트 0. 원격이 낡은 itl 을 들고 있을 수가 없다.
    """
    from host_common import resolve_host_with_secrets, run_remote_cmd_full

    try:
        host, secrets = await resolve_host_with_secrets(host_id, username)
    except Exception as e:
        raise DeliveryFailed(f"호스트를 못 찾았다 ({host_id}): {e}") from e

    quoted = " ".join(shlex.quote(a) for a in args)
    cmd = f"{REMOTE_PATH_PREFIX}python3 - {quoted}"
    try:
        rc, out, err = await run_remote_cmd_full(host, secrets, cmd,
                                                 timeout=REMOTE_TIMEOUT_SEC,
                                                 stdin_data=_itl_source())
    except asyncio.TimeoutError as e:
        raise DeliveryFailed(f"원격이 {REMOTE_TIMEOUT_SEC}s 안에 답하지 않았다") from e
    except Exception as e:
        raise DeliveryFailed(f"SSH 실패: {e}") from e
    # ⚠️ The exit code must be read. `run_remote_cmd` returns stdout regardless, and
    # with that alone a remote "no such pane" looked like success to the sender.
    if rc != 0:
        raise DeliveryFailed((err or out).strip()[:200] or f"itl(원격) → {rc}")
    return out


async def _targets_for(username: str) -> list[dict]:
    state = await storage.get_tab_state(username) or {}
    return build_targets(state.get("tabs") or [])


async def list_targets(username: str) -> list[dict]:
    """지금 이 사용자의 팬 주소록. 배달 전에 매번 다시 센다."""
    return await _targets_for(username)


async def deliver(username: str, addr: str, text: str, *, sender: str = "",
                  submit: bool = True) -> dict:
    """`addr` 이 가리키는 팬에 `text` 를 꽂는다.

    ⚠️ `sender` 는 **보낸 쪽이 준 값**이라 신뢰하지 않는다. 주소 모양으로만 접고,
    아니면 통째로 버린다 — 여기로 임의 문자열이 새면 받는 에이전트에게 보내는 쪽을
    사칭할 수 있다.

    `submit=True` → `--enter-if-agent` (Enter only into an agent pane). `submit=False`
    → `--no-enter`: the text is typed and left for a human, whatever the pane holds.
    """
    # One line, always. A line feed typed into a pane is Enter; that would void the
    # agent-only rule below no matter what the flag says.
    text = _CONTROL_RE.sub(" ", text or "").strip()
    if not text:
        raise DeliveryFailed("빈 내용")
    if len(text.encode("utf-8", errors="replace")) > MAX_TEXT_BYTES:
        raise DeliveryFailed(f"내용이 너무 길다 (>{MAX_TEXT_BYTES}B)")

    targets = await _targets_for(username)
    target = resolve(targets, addr)
    native = native_addr(target)
    if not native:
        raise DeliveryFailed(f"{addr} 에는 붙을 세션이 없다 (빈 팬)")

    # 꼬리표는 주소 모양일 때만. 받는 쪽 에이전트가 누구에게 답할지 알아야 한다.
    tag = f"[from {sender}] " if ADDR_RE.match((sender or "").strip()) else ""
    payload = f"{tag}{text}"

    # `--enter-if-agent`: text arriving through this channel may have originated on
    # another machine. Submitting it into an agent is a prompt; submitting it into a
    # bare shell would execute it, and that stays a human act (the user presses Enter).
    args = ["send", native, payload, "--enter-if-agent" if submit else "--no-enter"]
    if target.get("kind") == "host" and target.get("hostId"):
        out = await _run_remote(target["hostId"], username, args)
    else:
        out = await _run_local(args)

    logger.info("itl deliver %s → %s (%s) by %s",
                sender or "-", addr, target.get("kind"), username)
    return {"ok": True, "addr": addr, "kind": target.get("kind"), "detail": out.strip()[:200]}


async def deliver_from_pane(username: str, sender_key: str, msg: dict) -> None:
    """팬이 찍은 표식 하나를 배달한다 — 브리지가 부르는 진입점.

    ⚠️ **보낸 이는 여기서 되짚는다.** 페이로드의 자칭을 쓰면 팬 하나가 다른 팬을 사칭해
    "1.1 이 시켰다" 를 만들 수 있다. 우리는 그 표식이 어느 세션에서 나왔는지 알고 있다.
    """
    try:
        targets = await _targets_for(username)
    except Exception as e:
        logger.warning("itl 주소록을 못 읽었다: %s", e)
        return

    sender = next((t["addr"] for t in targets if native_addr(t) == sender_key), "")
    try:
        await deliver(username, msg["to"], msg["text"], sender=sender)
        await _ack_ok(username, sender, msg.get("to", ""))
    except DeliveryFailed as e:
        # 조용히 성공한 척하지 않는다 — 보낸 에이전트는 상대가 받았다고 믿는다.
        logger.warning("itl 배달 실패 (%s → %s): %s", sender or "-", msg.get("to"), e)
        await _ack_failure(username, sender, msg.get("to", ""), str(e))
    except Exception as e:  # noqa: BLE001 — 한 번의 배달 실패가 브리지를 죽이면 안 된다
        logger.warning("itl 배달 예외 (%s → %s): %s", sender or "-", msg.get("to"), e)


async def _ack_ok(username: str, sender: str, to: str) -> None:
    """보낸 팬에게 **전달됐다고** 알린다.

    ⚠️ 이게 없으면 침묵이 두 가지를 뜻한다: 잘 갔거나, 표식이 아예 안 주워졌거나.
    표식 통로는 한 방향(팬 → 백엔드)이라 보낸 쪽은 그 둘을 구별할 방법이 없다 —
    실제로 "전달됐는지 확인할 방법이 없다" 가 이 기능의 첫 신고였다.

    실패 통지와 **같은 규칙**이다: 타이핑만 하고 제출하지 않는다(`submit=False`).
    고리가 안 생기는 이유도 같다 — 이 배달은 `deliver` 를 직접 부르므로 스캐너를
    거치지 않고, 이 문구에는 표식이 없다.
    """
    if not ADDR_RE.match((sender or "").strip()) or not ADDR_RE.match((to or "").strip()):
        return
    try:
        await deliver(username, sender, f"[itl] {to} 로 전달됨", submit=False)
    except Exception as e:  # noqa: BLE001 — 통지 실패가 배달 성공을 뒤집지는 않는다
        logger.info("itl 성공 통지 실패 (%s): %s", sender, e)


async def _ack_failure(username: str, sender: str, to: str, why: str) -> None:
    """보낸 팬에게 실패를 알린다.

    고리가 안 생기는 이유: 배달은 스캐너를 거치지 않고, 이 문구에는 표식이 없다.
    표식이 없는 줄은 다시 주워지지 않는다.

    🔐 **Typed, never submitted** (`submit=False`). `why` can be the *target* host's
    stderr; submitting it into the sender agent as a prompt would let a target host
    inject instructions into whoever talks to it. Typed text just sits in the input.
    """
    if not ADDR_RE.match((sender or "").strip()):
        return          # 보낸 팬이 주소록에 없다 — 알릴 곳이 없다
    # `why` may carry text a remote host produced (its itl's stderr). It is typed into
    # the sender's pane, so it must stay one line of plain text — no control characters.
    why = _CONTROL_RE.sub(" ", why)
    try:
        await deliver(username, sender, f"[itl] {to} 로 못 보냈다: {why}"[:400], submit=False)
    except Exception as e:  # noqa: BLE001
        logger.info("itl 실패 통지도 실패 (%s): %s", sender, e)

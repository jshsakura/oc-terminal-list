"""수집기를 어디서 돌릴 것인가 — 이 서버에서 직접, 또는 SSH 너머에서.

**원격에 아무것도 설치하지 않는다.** `collect.py` 를 통째로 SSH stdin 으로 밀어
넣고 원격 `python3 -` 로 실행한다. 상주 프로세스도, 열어둘 포트도, 갱신할 이미지도
없다 — 스크립트는 매번 이 백엔드에서 나가므로 원격이 낡을 수도 없다.

`backend/cli/itl` 과 같은 발상이고, 보안 모델은 VNC 와 같다: 새 인바운드 포트를
열지 않고 이미 있는 SSH 연결만 쓴다.
"""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from . import collect as collector

logger = logging.getLogger(__name__)

# Cap on a remote run. A busy host walks a few hundred files (~0.5s here), so this
# is mostly about how long a *dead* host may hold up the dashboard — every host is
# collected concurrently, so the slowest one is the wait the user actually feels.
REMOTE_TIMEOUT_SECONDS = 25.0
LOCAL_TIMEOUT_SECONDS = 30.0

# python3 가 없는 옛 호스트를 위해 python 으로 한 번 더 시도한다. `exec` 인 이유:
# 셸이 stdin 을 먼저 읽어버리면 스크립트가 사라진다 — 인터프리터가 그대로 물려받아야 한다.
REMOTE_CMD = (
    "if command -v python3 >/dev/null 2>&1; then exec python3 - {days} notitle;"
    " else exec python - {days} notitle; fi"
)


class CollectFailed(RuntimeError):
    """이 소스에서는 못 읽었다 — 사유를 UI 까지 들고 간다."""


def script_source() -> str:
    """The collector body we ship. This one line is why it must stay a single file."""
    return Path(__file__).with_name("collect.py").read_text(encoding="utf-8")


def parse_output(raw: str, label: str = "") -> dict:
    """원격 stdout 에서 결과 JSON 을 꺼낸다.

    **마커 뒤부터 읽는다.** SSH stdout 에는 MOTD·셸 잡담이 섞이는데, 첫 `{` 부터
    파싱하면 배너에 중괄호가 하나만 있어도 조용히 어긋난다.
    """
    text = raw or ""
    marker = collector.OUTPUT_MARKER
    index = text.rfind(marker)
    if index < 0:
        hint = text.strip().splitlines()[-1][:120] if text.strip() else ""
        raise CollectFailed(
            "수집기를 실행하지 못했습니다 (python3 없음?)" + (f" — {hint}" if hint else "")
        )
    body = text[index + len(marker):].strip()
    if not body:
        raise CollectFailed("결과가 비어 있습니다")
    try:
        payload = json.loads(body)
    except ValueError as e:
        raise CollectFailed(f"JSON 파싱 실패 ({e})") from e
    if not isinstance(payload, dict):
        raise CollectFailed("예상과 다른 응답 형식")
    if not payload.get("ok"):
        raise CollectFailed(str(payload.get('error') or '수집 실패'))
    return payload


async def run_local(days: int) -> dict:
    """이 서버 자신 — 그냥 import 해서 부른다. 파일 IO 라 스레드로 뺀다."""
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(collector.collect, days), timeout=LOCAL_TIMEOUT_SECONDS
        )
    except asyncio.TimeoutError as e:
        raise CollectFailed(f"로컬 수집이 {LOCAL_TIMEOUT_SECONDS}s 안에 끝나지 않았습니다") from e
    except Exception as e:  # noqa: BLE001 — 소스 하나의 사고가 전체를 죽이면 안 된다
        raise CollectFailed(f"로컬 수집 실패: {e}") from e


async def run_remote(host: dict, secrets: dict, days: int) -> dict:
    """등록된 호스트 — 수집기를 stdin 으로 밀어 넣고 원격에서 실행한다."""
    from host_common import run_remote_cmd  # 순환 import 회피 — 호출 시점에 로드

    label = host.get("name") or host.get("hostname") or host.get("id")
    # `notitle`: the remote returns numbers, models and project names — never the
    # prompt text a session was titled with. Aggregation happens over there; what
    # crosses the wire is the result, not the logs.
    cmd = REMOTE_CMD.format(days=int(days))
    try:
        raw = await run_remote_cmd(host, secrets, cmd,
                                   timeout=REMOTE_TIMEOUT_SECONDS,
                                   stdin_data=script_source())
    except asyncio.TimeoutError as e:
        raise CollectFailed(f"응답 없음 ({REMOTE_TIMEOUT_SECONDS}s)") from e
    except Exception as e:  # asyncssh/tailscale 계열 예외가 다양하다
        raise CollectFailed(f"SSH 실패 ({e})") from e
    return parse_output(raw, label)

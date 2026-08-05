"""llm-watcher 한 대에서 사용량을 읽는다.

경로는 둘, 응답은 같다:

  직결   compose 동봉분(`http://llm-watcher:34318`) 또는 이 호스트의 컨테이너
         (`http://127.0.0.1:34318`) → 그냥 HTTP
  SSH    fleet 원격 호스트 → `curl http://127.0.0.1:34318` 을 SSH 로 실행

**원격에 새 포트를 열지 않는다.** watcher 는 어디서든 루프백에만 바인딩하고, 우리는
이미 있는 SSH 연결로 그 루프백에 닿는다 — VNC 와 같은 보안 모델이다. Tailscale IP
직결은 안 된다(그 주소엔 아무도 듣지 않는다).
"""
from __future__ import annotations

import asyncio
import json
import logging
import shlex

import aiohttp

logger = logging.getLogger(__name__)

# watcher 의 기본 포트. 이미지·compose·systemd 어디서든 같은 값을 쓴다.
WATCHER_PORT = 34318
# watcher 의 선택적 API 키 헤더 — llm-watcher 의 auth.py 와 같은 이름이어야 한다.
API_KEY_HEADER = "X-API-Key"
# 직결은 같은 머신/같은 도커 네트워크라 빨라야 정상. 안 뜨면 없는 것으로 친다.
DIRECT_TIMEOUT_SECONDS = 3.0
# SSH 는 연결 수립 + 원격 curl 이라 넉넉히. 죽은 호스트를 오래 붙들지는 않는다.
SSH_TIMEOUT_SECONDS = 15.0


class WatcherUnavailable(RuntimeError):
    """이 소스에서는 못 읽었다 — 사유를 UI 까지 들고 간다."""


def _parse_json_body(raw: str, where: str, empty_hint: str | None = None) -> dict:
    """SSH stdout 은 MOTD·셸 잡담과 섞일 수 있어 첫 `{` 부터 본다.

    빈 응답은 거의 항상 "거기 watcher 가 없다" 는 뜻이다 — curl 이 연결을 거부당하고
    조용히 끝난 것이다. 그대로 "응답이 비어 있습니다" 라고 띄우면 화면을 보는 사람은
    무슨 말인지 모른다. `empty_hint` 로 호출부가 사람 말로 바꿔준다.
    """
    text = (raw or "").strip()
    if not text:
        raise WatcherUnavailable(empty_hint or f"{where}: 응답이 비어 있습니다")
    start = text.find("{")
    if start < 0:
        raise WatcherUnavailable(f"{where}: JSON 이 아닙니다")
    try:
        parsed = json.loads(text[start:])
    except json.JSONDecodeError as e:
        raise WatcherUnavailable(f"{where}: JSON 파싱 실패 ({e})") from e
    if not isinstance(parsed, dict):
        raise WatcherUnavailable(f"{where}: 예상과 다른 응답 형식")
    return parsed


def _auth_headers(api_key: str | None) -> dict:
    return {API_KEY_HEADER: api_key} if api_key else {}


async def fetch_direct(base_url: str, path: str,
                       timeout: float = DIRECT_TIMEOUT_SECONDS,
                       api_key: str | None = None) -> dict:
    """같은 머신/같은 도커 네트워크의 watcher 를 HTTP 로 읽는다."""
    url = f"{base_url.rstrip('/')}{path}"
    try:
        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=timeout)
        ) as session:
            async with session.get(url, headers=_auth_headers(api_key)) as res:
                if res.status != 200:
                    raise WatcherUnavailable(f"{url}: HTTP {res.status}")
                return _parse_json_body(await res.text(), url)
    except WatcherUnavailable:
        raise
    except asyncio.TimeoutError as e:
        raise WatcherUnavailable(f"{url}: {timeout}s 안에 응답 없음") from e
    except aiohttp.ClientError as e:
        raise WatcherUnavailable(f"{url}: 연결 실패 ({e})") from e


def build_remote_fetch_cmd(path: str, port: int = WATCHER_PORT,
                           timeout: int = 8, api_key: str | None = None) -> str:
    """원격에서 루프백 watcher 를 때리는 셸 한 줄.

    curl 이 없는 호스트가 있어 wget 으로 폴백한다(VNC 의 nc→ncat→/dev/tcp 와 같은
    발상). 둘 다 없으면 빈 출력 → 호출부가 '못 읽음' 으로 처리한다.

    **URL 은 반드시 따옴표로 감싼다.** 쿼리스트링의 `&` 는 셸에서 백그라운드 실행이라
    `?limit=40&days=30` 이 통째로 잘려 나간다 — 에러도 안 나고 빈 응답만 돌아와서
    "watcher 가 없다" 로 오진하기 딱 좋다.

    **API 키는 명령 문자열에 넣지 않는다.** 이 문자열은 원격 셸의 argv 가 되므로
    거기 넣은 것은 그 호스트의 `ps` 에 그대로 보인다 — `K=값 curl …` 같은 환경변수
    대입도 결국 argv 라 소용없다. 대신 키를 **stdin 으로 받아** 셸 변수에 넣는다
    (VNC 비밀번호와 같은 규칙). 호출부가 `stdin_data` 로 키를 흘려줘야 한다.
    """
    url = shlex.quote(f"http://127.0.0.1:{port}{path}")
    if not api_key:
        return (
            f"curl -fsS --max-time {timeout} {url} 2>/dev/null"
            f" || wget -qO- --timeout={timeout} {url} 2>/dev/null"
        )
    header = f'"{API_KEY_HEADER}: $k"'
    # `read` 는 argv 를 남기지 않는다. -r 은 백슬래시를 해석하지 않기 위해서.
    return (
        f"IFS= read -r k;"
        f" curl -fsS --max-time {timeout} -H {header} {url} 2>/dev/null"
        f" || wget -qO- --timeout={timeout} --header={header} {url} 2>/dev/null"
    )


async def fetch_via_ssh(host: dict, secrets: dict, path: str,
                        timeout: float = SSH_TIMEOUT_SECONDS,
                        api_key: str | None = None) -> dict:
    """원격 호스트의 루프백 watcher 를 SSH 너머로 읽는다."""
    from host_common import run_remote_cmd  # 순환 import 회피 — 호출 시점에 로드

    cmd = build_remote_fetch_cmd(path, api_key=api_key)
    # 키는 argv 가 아니라 stdin 으로 — 원격 `ps` 에 남기지 않는다.
    stdin_data = f"{api_key}\n" if api_key else None
    label = f"{host.get('name') or host.get('hostname')}:{path}"
    try:
        raw = await run_remote_cmd(host, secrets, cmd, timeout=timeout,
                                   stdin_data=stdin_data)
    except asyncio.TimeoutError as e:
        raise WatcherUnavailable(f"{label}: SSH 응답 없음 ({timeout}s)") from e
    except Exception as e:  # asyncssh/tailscale 계열 예외가 다양하다
        raise WatcherUnavailable(f"{label}: SSH 실패 ({e})") from e
    return _parse_json_body(
        raw, label,
        empty_hint=f"이 호스트에 llm-watcher 가 없습니다 (127.0.0.1:{WATCHER_PORT} 응답 없음)",
    )

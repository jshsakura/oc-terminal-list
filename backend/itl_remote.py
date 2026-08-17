"""원격 pane 으로 입력을 보낸다 — 자격증명은 백엔드가 갖는다.

이 파일이 있는 이유는 하나다: **받는 쪽에 그 호스트의 열쇠가 없다.**

pane 핸들을 복사해 다른 에이전트에게 "여기다 시켜" 라고 넘기면, 그 에이전트가 원격
세션에 닿는 길은 자기 `~/.ssh` 뿐이다. 실제로 그렇게 막혔다 — `ssh jshsakura@100.115.177.3`
이 `Permission denied (publickey,password)` 로 거절당했고, 받는 쪽이 자기 ssh config 를
뒤져 별칭을 찾아내고서야 들어갔다. 우리 쪽 힌트로는 그 추측을 줄일 수 있을 뿐 없앨 수 없다.

없앨 수 있는 건 백엔드다. 앱은 이미 그 호스트의 자격증명(금고의 키·비밀번호, 또는
tailscale 신원)을 갖고 SSH 를 연다 — VNC·파일·LLM 사용량이 전부 그 길을 쓴다.
`itl send` 가 원격에서도 되면 받는 쪽은 아무 자격증명도 필요 없다.

로컬 경로(`tmux_manager.send_keys`)와 **같은 규칙**을 원격에서도 지킨다:
  - `-l` 은 리터럴 — 없으면 "Enter"·"C-c" 같은 낱말이 키로 해석된다.
  - `--` 로 플래그 파싱을 끊는다 — `-` 로 시작하는 메시지가 `unknown flag` 로 죽는다.
  - 타깃은 `'=name:'` — send-keys 의 `-t` 는 pane 타깃이라 `=name` 만으로는 못 찾는다.

두 가지 규칙이 더 있고, 둘 다 실측에서 나왔다:

**한 호스트에는 연결 하나** (`RemoteChannel`). `run_remote_cmd` 는 호출마다 SSH 를 열고
닫는다. 존재확인·pane 정보·전송을 따로 부르면 대상 하나에 핸드셰이크가 **세 번**이고,
팬아웃이면 대상 수만큼 곱해져 호출자 타임아웃을 넘긴다 — 그러면 백엔드는 계속 배달하는데
호출자는 실패로 읽고 재시도해서 **같은 말이 두 번** 들어간다.

**배달은 확인된 것만 배달이다.** `conn.run(check=False)` 는 exit code 를 보지 않으므로
`tmux send-keys` 가 거절해도 예외가 없다. 그래서 명령 끝에 `&& echo ITL_SENT` 를 달고
그 표식이 돌아온 것만 delivered 로 센다. `;` 가 아니라 `&&` 인 이유도 같다 — 본문이
실패했는데 Enter 만 따로 들어가면 프롬프트에 있던 엉뚱한 것이 실행된다.
"""
from __future__ import annotations

import asyncio
import logging
from typing import NamedTuple

from host_common import resolve_host_with_secrets, run_remote_cmd

logger = logging.getLogger(__name__)

# 연결 하나를 여는 데 드는 시간(잠든 호스트가 깨어날 여유). 이 상한을 넘기면
# "그 호스트에 못 닿음" 이고, 팬아웃의 다른 호스트는 그와 무관하게 진행한다.
REMOTE_CONNECT_TIMEOUT = 12.0
# 연결이 선 뒤의 tmux 명령 하나. 붙은 뒤라면 밀리초 단위 일이라 넉넉하다.
REMOTE_EXEC_TIMEOUT = 8.0
# 한 호스트에 대한 전체 작업 상한. 호스트들은 병렬이라 팬아웃 총 시간도 대략 이 값이다.
# **호출자 타임아웃보다 반드시 작아야 한다**(itl CLI / MCP = 30s) — 크면 호출자가 먼저
# 포기하고, 배달은 계속되어 재시도가 중복 전송이 된다.
HOST_DEADLINE = 20.0

_SENT_MARK = "ITL_SENT"
_GONE_MARK = "ITL_GONE"
_INFO_PREFIX = "ITL_INFO="
_ITL_ON_PATH_MARK = "ITL_PATH"
_ITL_FILE_MARK = "ITL_FILE"

# 받는 쪽 pane 을 한 번의 왕복으로 다 묻는다: 살아 있나 · 무엇이 돌고 있나 · itl 을 쓸 수 있나.
# 따로 물으면 왕복이 배가 되고, 그 사이에 세션이 죽으면 앞의 답이 거짓이 된다.
_INFO_FORMAT = _INFO_PREFIX + "#{pane_current_command}\t#{pane_title}"

# `command -v itl` 은 **비대화형 셸**에서 도는 판정이라 `~/.local/bin` 이 PATH 에 없을 수
# 있다. 그래서 파일 존재도 같이 보고, 그때는 절대경로를 답장 명령에 쓴다 — 어느 셸에서든
# 실행되는 형태여야 "답장 방법" 이라고 적어 보낼 수 있다.
_ITL_PROBE = (
    'if command -v itl >/dev/null 2>&1; then echo ' + _ITL_ON_PATH_MARK + '; '
    'elif [ -x "$HOME/.local/bin/itl" ]; then echo ' + _ITL_FILE_MARK + '; fi'
)


class RemoteSendError(RuntimeError):
    """명령은 돌았지만 tmux 가 전달을 확인해 주지 않았다 (표식 없음)."""


class PaneProbe(NamedTuple):
    """받는 쪽 pane 에 대해 한 번의 왕복으로 알아낸 것.

    `itl_cmd` 는 **그 pane 에서 실제로 실행되는** 프로그램 이름이다 (''=없음). 답장 명령을
    적어 보낼지 여부가 여기 달려 있다 — 없는 명령을 답장 방법이라고 알려주면 받은 쪽은
    "command not found" 를 답장이라고 믿는다.
    """
    command: str
    title: str
    itl_cmd: str


def _sq(value: str) -> str:
    """Always wrap in single quotes — never "only if unsafe".

    `shlex.quote` leaves `=mobile-3b908205466e` bare, because it is POSIX-safe. It is
    not **zsh**-safe: a bare word starting with `=` triggers equals-expansion (`=foo` →
    the path of the command `foo`), so the target arrives mangled and `has-session`
    quietly says no. Measured on a real host — with quotes `ITL_OK`, without it empty.
    The remote login shell is not ours to choose, so we do not leave it a choice.
    """
    return "'" + str(value).replace("'", "'\\''") + "'"


def build_send_cmd(tmux_session: str, text: str, *, submit: bool = False) -> str:
    """`tmux send-keys -t '=S:' -l -- 'text' [&& … Enter] && echo ITL_SENT`.

    Chained with `&&`, not `;`: a body that failed must not be followed by a lone Enter
    (that runs whatever was already on the prompt), and the marker must only appear when
    every step succeeded — it is what makes "delivered" mean delivered.
    """
    target = _sq(f"={tmux_session}:")
    parts = [f"tmux send-keys -t {target} -l -- {_sq(text)}"]
    if submit:
        parts.append(f"tmux send-keys -t {target} Enter")
    parts.append(f"echo {_SENT_MARK}")
    return " && ".join(parts)


def build_key_cmd(tmux_session: str, key: str) -> str:
    """`tmux send-keys -t '=S:' C-c && echo ITL_SENT` — a key *name*, so no `-l`/`--`.

    The caller whitelists the key (routes/itl.py `ALLOWED_KEYS`); quoting it here is
    belt-and-braces so this function is safe on its own terms.
    """
    return f"tmux send-keys -t {_sq(f'={tmux_session}:')} {_sq(key)} && echo {_SENT_MARK}"


def build_probe_cmd(tmux_session: str) -> str:
    """생사 + pane 정보 + itl 가용성을 한 번에.

    `has-session` 을 앞에 두는 이유: `display-message` 는 없는 타깃에도 rc=0 에 빈 값을
    준다(실측). 생사를 그것으로 판정하면 죽은 세션이 살아 있는 것으로 읽힌다.
    """
    exact = _sq(f"={tmux_session}")
    pane = _sq(f"={tmux_session}:")
    return "; ".join([
        f"tmux has-session -t {exact} 2>/dev/null || {{ echo {_GONE_MARK}; exit 0; }}",
        f"tmux display-message -p -t {pane} {_sq(_INFO_FORMAT)}",
        _ITL_PROBE,
    ])


def parse_probe(out: str | None) -> PaneProbe | None:
    """probe 출력 → PaneProbe. 세션이 사라졌으면 None.

    "정보를 못 읽었다" 와 "세션이 없다" 는 다르다 — 전자는 꼬리표만 포기하면 되고,
    후자는 배달 자체가 불가능하다. 그래서 없음은 표식으로만 판정한다.
    """
    lines = [line.strip() for line in (out or "").splitlines() if line.strip()]
    if _GONE_MARK in lines:
        return None
    info = next((line[len(_INFO_PREFIX):] for line in lines if line.startswith(_INFO_PREFIX)), "")
    command, _, title = info.partition("\t")
    if _ITL_ON_PATH_MARK in lines:
        itl_cmd = "itl"
    elif _ITL_FILE_MARK in lines:
        itl_cmd = "~/.local/bin/itl"
    else:
        itl_cmd = ""
    return PaneProbe(command.strip(), title.strip(), itl_cmd)


# 모든 tmux 세션의 (이름, 명령, 타이틀) — **호스트당 한 번**. pane 마다 물으면 세션 수만큼
# 왕복이 곱해진다(원격 cwd 배치가 같은 이유로 list-panes 를 쓴다).
_LIST_FORMAT = "#{session_name}\t#{pane_current_command}\t#{pane_title}"


def build_list_status_cmd() -> str:
    return f"tmux list-panes -a -F {_sq(_LIST_FORMAT)} 2>/dev/null"


def parse_list_status(out: str | None) -> dict[str, tuple[str, str]]:
    """`session_name → (command, title)`. 한 세션에 pane 이 여러 개면 **첫 줄**을 쓴다.

    원격 세션은 우리 UI 에서 pane 하나로 보이고(그 세션의 현재 윈도우), 상태를 알려주는
    타이틀도 그 pane 의 것이다.
    """
    result: dict[str, tuple[str, str]] = {}
    for line in (out or "").splitlines():
        parts = line.rstrip("\n").split("\t")
        if len(parts) < 2 or not parts[0].strip():
            continue
        name = parts[0].strip()
        if name in result:
            continue
        result[name] = (parts[1].strip(), (parts[2].strip() if len(parts) > 2 else ""))
    return result


class RemoteChannel:
    """한 호스트로 가는 SSH 연결 하나 — 그 위에서 tmux 명령을 여러 번 돌린다.

    `auth_method == 'tailscale'` 호스트는 asyncssh 연결이 없다(`tailscale ssh` 서브프로세스)
    — 그 경로는 명령마다 프로세스를 띄우는 성질이고, 여기서 바꿀 수 있는 것이 아니다.
    """

    def __init__(self, host: dict, secrets: dict, conn=None):
        self._host = host
        self._secrets = secrets
        self._conn = conn

    @property
    def host_name(self) -> str:
        return str(self._host.get("name") or self._host.get("hostname") or "")

    async def run(self, cmd: str, timeout: float = REMOTE_EXEC_TIMEOUT) -> str:
        if self._conn is None:
            return await run_remote_cmd(self._host, self._secrets, cmd, timeout=timeout)
        result = await asyncio.wait_for(self._conn.run(cmd, check=False), timeout=timeout)
        out = result.stdout
        return out if isinstance(out, str) else (out or b"").decode("utf-8", errors="replace")

    async def close(self) -> None:
        """연결을 닫는다. **정리를 기다리다 매달리지 않는다** — 끊긴 망에서 `wait_closed()`
        는 영영 안 돌아올 수 있다(host_manager 가 같은 상한을 갖는 이유)."""
        conn, self._conn = self._conn, None
        if conn is None:
            return
        try:
            conn.close()
            await asyncio.wait_for(conn.wait_closed(), timeout=5.0)
        except Exception as e:
            logger.debug("remote channel close: %s", e)

    async def __aenter__(self) -> RemoteChannel:
        return self

    async def __aexit__(self, *exc) -> None:
        await self.close()


async def open_channel(host_id: str, username: str) -> RemoteChannel:
    """그 호스트로 가는 채널 하나. 실패는 그대로 던진다 — 호출부가 "못 닿음" 으로 센다."""
    host, secrets = await resolve_host_with_secrets(host_id, username)
    if host.get("auth_method") == "tailscale":
        return RemoteChannel(host, secrets)
    from host_manager import open_connection
    conn = await asyncio.wait_for(
        open_connection(
            host,
            private_key=secrets["private_key"],
            passphrase=secrets["passphrase"],
            password=secrets["password"],
        ),
        timeout=REMOTE_CONNECT_TIMEOUT,
    )
    return RemoteChannel(host, secrets, conn)


async def probe(channel: RemoteChannel, tmux_session: str) -> PaneProbe | None:
    """세션이 살아 있으면 PaneProbe, 사라졌으면 None. 못 물으면 예외."""
    return parse_probe(await channel.run(build_probe_cmd(tmux_session)))


async def send_text(channel: RemoteChannel, tmux_session: str, text: str,
                    *, submit: bool = False) -> None:
    """확인된 전송만 성공이다 — 표식이 없으면 `RemoteSendError`."""
    out = await channel.run(build_send_cmd(tmux_session, text, submit=submit))
    if _SENT_MARK not in (out or ""):
        raise RemoteSendError(f"tmux 가 전달을 확인하지 않았습니다: {tmux_session}")


async def send_key(channel: RemoteChannel, tmux_session: str, key: str) -> None:
    out = await channel.run(build_key_cmd(tmux_session, key))
    if _SENT_MARK not in (out or ""):
        raise RemoteSendError(f"tmux 가 키 전달을 확인하지 않았습니다: {tmux_session}")


def build_capture_cmd(tmux_session: str, lines: int) -> str:
    """`tmux capture-pane -p -t '=S:' -S -N` — 화면 + 위로 N 줄.

    `-S` 의 값은 `-40` 처럼 `-` 로 시작한다. tmux 의 옵션 파서는 그것을 값으로 받지만
    인용은 해 둔다(셸 단계에서 플래그로 읽히지 않게).
    """
    return f"tmux capture-pane -p -t {_sq(f'={tmux_session}:')} -S {_sq(f'-{max(1, int(lines))}')}"


async def capture_pane(channel: RemoteChannel, tmux_session: str, lines: int) -> str:
    """원격 pane 화면. 읽기가 원격에서 막혀 있으면 "보냈는데 뭐 하고 있나" 를 볼 길이 없다."""
    return await channel.run(build_capture_cmd(tmux_session, lines))


async def list_pane_status(host_id: str, username: str) -> dict[str, tuple[str, str]]:
    """호스트 하나의 모든 tmux 세션 상태를 한 번의 왕복으로. 못 닿으면 빈 dict.

    빈 dict 는 "아무 세션도 없다" 가 아니라 **"모른다"** 로 취급해야 한다 — 호출부가
    그 구분을 한다(routes/itl.py `_fill_remote_status`).
    """
    try:
        async with await asyncio.wait_for(
            open_channel(host_id, username), timeout=REMOTE_CONNECT_TIMEOUT
        ) as channel:
            return parse_list_status(await channel.run(build_list_status_cmd()))
    except Exception as e:
        logger.info("remote status list failed (host=%s): %s", host_id, e)
        return {}

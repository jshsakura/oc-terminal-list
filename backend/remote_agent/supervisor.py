"""원격 관찰자 한 대를 살려 두는 감독자.

`probe.py` 를 원격에서 **오래 도는 프로세스**로 띄우고, 그 stdout(줄 단위 JSON)을
읽어 콜백으로 넘긴다. stdin 은 제어 채널로 남는다.

⚠️ **스크립트를 stdin 으로 보낼 수 없다.** `python3 -` 는 stdin 이 EOF 날 때까지를
프로그램으로 읽으므로, 같은 통로를 제어에 다시 쓸 수 없다(`llm_usage` 는 한 번 실행하고
끝나서 이 문제가 없었다). 그래서 소스는 **base64 로 argv 에 실어** 보내고 stdin 은
비워 둔다 — 원격에 파일도 안 남는다. 스크립트는 비밀이 아니므로 `ps` 에 보여도 된다
(비밀은 여전히 stdin 으로만 간다는 규칙은 그대로다).

이 저장소가 배운 것들이 그대로 적용된다:
  - **끝나지 않는 대기를 두지 않는다.** 연결·시작·종료 전부 상한이 있다.
  - **실패는 백오프한다.** 꺼진 호스트가 15초마다 SSH 를 새로 태우면 안 된다.
  - **"모른다" 를 "0" 으로 접지 않는다.** tmux 서버가 없으면 pane 0개가 아니라 `no-server`.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging

from remote_agent.payload import script_source

logger = logging.getLogger(__name__)

# 재시도 사다리 — 꺼진 호스트를 계속 두드리지 않는다. 마지막 값에서 머문다.
BACKOFF_SECONDS = (5, 15, 45, 120, 300)
# 원격 파이썬이 뜨고 hello 를 뱉기까지. 넘으면 그 호스트는 쓸 수 없는 것으로 본다.
HELLO_TIMEOUT_SEC = 25.0
# bye 를 보낸 뒤 얌전히 끝나기를 기다리는 상한. 끊긴 망에서 영원히 잡히지 않게.
SHUTDOWN_TIMEOUT_SEC = 5.0


def build_command(socket_name: str | None) -> str:
    """원격에서 실행할 셸 명령. 소스는 argv 로, stdin 은 제어용으로 비운다."""
    blob = base64.b64encode(script_source().encode("utf-8")).decode("ascii")
    env = f"ITL_TMUX_SOCKET={socket_name} " if socket_name else ""
    # -u: 줄 단위로 즉시 흘려보낸다. 버퍼링되면 상태 변화가 뭉쳐서 늦게 온다.
    return (
        f"{env}python3 -u -c "
        "'import base64,sys;exec(base64.b64decode(sys.argv[1]))' "
        f"{blob}"
    )


class RemoteProbeSession:
    """프로세스 하나의 수명. 전송(SSH)은 주입받는다 — 테스트에서 교체 가능."""

    def __init__(self, host_id: str, spawn, on_event, on_state=None):
        # spawn:    async (command:str) -> process (stdin/stdout/stderr, terminate/wait)
        # on_event: async (host_id:str, event:dict) -> None
        # on_state: async (host_id:str, state:str, detail:str|None) -> None
        self.host_id = host_id
        self._spawn = spawn
        self._on_event = on_event
        self._on_state = on_state
        self._proc = None
        self._closing = False

    async def _emit_state(self, state: str, detail: str | None = None) -> None:
        if self._on_state:
            await self._on_state(self.host_id, state, detail)

    async def send(self, message: dict) -> bool:
        """제어 메시지 한 줄. 죽은 프로세스에 쓰는 것은 예외가 아니라 False 다."""
        proc = self._proc
        if proc is None or self._closing:
            return False
        try:
            proc.stdin.write(json.dumps(message, ensure_ascii=False) + "\n")
            drain = getattr(proc.stdin, "drain", None)
            if drain:
                await drain()
            return True
        except (BrokenPipeError, ConnectionError, OSError):
            return False

    async def run_once(self, command: str) -> None:
        """프로세스를 한 번 띄우고 stdout 이 끝날 때까지 읽는다."""
        self._proc = await self._spawn(command)
        self._closing = False
        try:
            first = await asyncio.wait_for(self._read_line(), timeout=HELLO_TIMEOUT_SEC)
            if not first or first.get("t") != "hello":
                raise RuntimeError(f"probe did not greet: {first!r}")
            await self._emit_state("up")
            while True:
                event = await self._read_line()
                if event is None:
                    return                     # stdout EOF — 원격이 끝났다
                await self._on_event(self.host_id, event)
        finally:
            await self._terminate()

    async def _read_line(self) -> dict | None:
        raw = await self._proc.stdout.readline()
        if not raw:
            return None
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8", errors="replace")
        raw = raw.strip()
        if not raw:
            return {}
        try:
            return json.loads(raw)
        except ValueError:
            # 원격 셸이 끼워 넣은 배너/경고 한 줄이 스트림을 죽이면 안 된다.
            logger.debug("remote probe %s: non-JSON line %r", self.host_id, raw[:120])
            return {}

    async def _terminate(self) -> None:
        proc, self._proc, self._closing = self._proc, None, True
        if proc is None:
            return
        # 얌전히 끝날 기회를 준다. stdin EOF 만으로도 probe 는 멈추지만, bye 를 먼저
        # 보내면 다음 폴을 기다리지 않고 즉시 나간다.
        try:
            proc.stdin.write(json.dumps({"t": "bye"}) + "\n")
            close = getattr(proc.stdin, "close", None)
            if close:
                close()
        except Exception:
            pass
        # ⚠️ 상한 없이 기다리지 않는다 — 끊긴 망에서 wait 는 돌아오지 않는다.
        try:
            await asyncio.wait_for(proc.wait(), timeout=SHUTDOWN_TIMEOUT_SEC)
        except Exception:
            terminate = getattr(proc, "terminate", None)
            if terminate:
                try:
                    terminate()
                except Exception:
                    pass


def backoff_for(round_index: int) -> float:
    """실패 라운드 → 다음 시도까지 초. 마지막 값에서 머문다."""
    idx = min(max(round_index, 0), len(BACKOFF_SECONDS) - 1)
    return float(BACKOFF_SECONDS[idx])

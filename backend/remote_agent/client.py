"""호스트에 설치되는 리모트 — probe 를 띄우고 허브와 중계한다.

**중계만 한다.** 상태 판정도, 스피너 접기도, tmux 도 전부 `probe.py` 안에 있고 여기는
그 stdout ↔ WebSocket 을 잇는다. 그래서 무설치 경로(백엔드가 SSH 로 probe 를 띄움)와
설치 경로(이 파일이 probe 를 띄움)가 **같은 프로토콜 하나**를 쓴다 — 한쪽만 고쳐져
갈라질 여지가 없다.

의존성 없음(stdlib + 같은 폴더의 두 파일). pip 도 네트워크도 필요 없다.

  ~/.local/share/itl-remote/{client.py, probe.py, wsclient.py}
  ~/.config/itl-remote/credentials      (0600, JSON: {"url":…, "token":…})

⚠️ 자격증명은 **파일에서만** 읽는다. 인자로 받으면 그 호스트의 `ps` 에 그대로 보인다.
"""
import json
import os
import subprocess
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wsclient import WebSocketClient, WebSocketError  # noqa: E402

CONFIG_PATH = os.path.expanduser("~/.config/itl-remote/credentials")
PROBE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "probe.py")

# 재연결 사다리. 허브가 내려가 있어도 계속 두드리지 않는다.
BACKOFF_SECONDS = (2, 5, 15, 45, 120, 300)
# 이만큼 붙어 있었으면 "쓸 만한 연결" 로 보고 사다리를 되감는다.
# ⚠️ 핸드셰이크 성공만으로 되감으면, 붙자마자 끊기는 상태에서 사다리가 영영 안 오른다.
STABLE_SECONDS = 60.0


def load_config():
    with open(CONFIG_PATH, encoding="utf-8") as handle:
        config = json.load(handle)
    url, token = config.get("url"), config.get("token")
    if not url or not token:
        raise SystemExit(f"{CONFIG_PATH}: url/token 이 필요합니다")
    return url, token, config


def host_facts():
    """이 기계가 자기를 소개하는 값. 실패한 항목은 **넣지 않는다** — 빈 문자열을 넣으면
    화면에서 "모른다" 와 "없다" 가 구별되지 않는다."""
    facts = {}
    try:
        uname = os.uname()
        facts["os"] = f"{uname.sysname} {uname.release}"
        facts["arch"] = uname.machine
        facts["hostname"] = uname.nodename
    except (AttributeError, OSError):
        pass
    try:
        facts["cpus"] = os.cpu_count()
    except OSError:
        pass
    try:
        with open("/proc/meminfo", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("MemTotal:"):
                    facts["mem_kb"] = int(line.split()[1])
                    break
    except (OSError, ValueError, IndexError):
        pass
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=name",
                              "--format=csv,noheader"],
                             capture_output=True, text=True, timeout=5)
        names = [ln.strip() for ln in out.stdout.splitlines() if ln.strip()]
        if names:
            facts["gpu"] = ", ".join(names)
    except (OSError, subprocess.SubprocessError):
        pass
    return facts


class Relay:
    """probe 프로세스 하나와 소켓 하나를 잇는다."""

    def __init__(self, socket_client, env):
        self.ws = socket_client
        self.proc = subprocess.Popen(
            [sys.executable, "-u", PROBE_PATH],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, env=env,
        )
        self.stop = threading.Event()
        self._write_lock = threading.Lock()

    def send(self, obj):
        with self._write_lock:
            self.ws.send_json(obj)

    def _pump_probe_to_hub(self):
        try:
            for line in self.proc.stdout:
                line = line.strip()
                if not line or self.stop.is_set():
                    break
                try:
                    self.send(json.loads(line))
                except ValueError:
                    continue          # probe 가 뱉은 깨진 줄 하나로 멈추지 않는다
        except (OSError, WebSocketError):
            pass
        finally:
            self.stop.set()

    def run(self):
        """허브 → probe 방향은 이 스레드가, 반대는 펌프 스레드가 맡는다."""
        pump = threading.Thread(target=self._pump_probe_to_hub, daemon=True)
        pump.start()
        self.send({"t": "facts", "facts": host_facts()})
        try:
            while not self.stop.is_set():
                message = self.ws.recv_json()
                if message is None:
                    return                        # 허브가 닫았다
                if message.get("t") == "bye":
                    return
                try:
                    self.proc.stdin.write(json.dumps(message) + "\n")
                    self.proc.stdin.flush()
                except (BrokenPipeError, OSError):
                    return                        # probe 가 죽었다 — 통째로 다시 시작
        finally:
            self.close()

    def close(self):
        self.stop.set()
        try:
            self.proc.stdin.write(json.dumps({"t": "bye"}) + "\n")
            self.proc.stdin.flush()
            self.proc.stdin.close()
        except (BrokenPipeError, OSError, ValueError):
            pass
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.kill()                      # ⚠️ 상한 없이 기다리지 않는다
        self.ws.close()


def main():
    url, token, config = load_config()
    env = dict(os.environ)
    if config.get("tmux_socket"):
        env["ITL_TMUX_SOCKET"] = str(config["tmux_socket"])

    round_index = 0
    while True:
        started = time.monotonic()
        try:
            client = WebSocketClient(url, headers={"Authorization": f"Bearer {token}"})
            client.connect()
            Relay(client, env).run()
        except (WebSocketError, OSError, ValueError) as e:
            sys.stderr.write(f"itl-remote: {e}\n")
        lived = time.monotonic() - started
        # 오래 붙어 있었으면 사다리를 되감는다. 핸드셰이크만으로 되감지 않는 이유:
        # 붙자마자 끊기는 상태에서 매 실패가 "첫 시도" 가 되어 영영 몰아친다.
        round_index = 0 if lived >= STABLE_SECONDS else min(round_index + 1,
                                                            len(BACKOFF_SECONDS) - 1)
        time.sleep(BACKOFF_SECONDS[round_index])


if __name__ == "__main__":
    main()

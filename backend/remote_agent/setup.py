"""리모트 설치 · 상태 · 제거 — 전부 SSH 한 번씩.

`itl_remote_setup` 의 CLI 설치와 같은 방식이다: 파일을 stdin 으로 밀어 넣는다.
pip 도 PyPI 도 네트워크도 필요 없다 — 원격에 python3 만 있으면 된다.

🔐 **설치는 사람이 누를 때만 일어난다.** 자동 설치도 자동 시작도 없다. 그리고 설치는
**선택**이다 — 안 깔아도 백엔드가 SSH 로 probe 를 띄우는 경로가 그대로 있다. 깔면
얻는 것은 셋뿐이다: NAT 뒤에서도 붙고, 재부팅을 넘겨 살고, 그 호스트 전용 자격증명을
갖는다.

⚠️ 자격증명은 **stdin 으로만** 간다. 명령 문자열은 원격 `ps` 에 그대로 보인다.
"""
from __future__ import annotations

import hashlib
import json
import logging
import shlex
from pathlib import Path

from remote_agent.payload import script_source

logger = logging.getLogger(__name__)

LIB_DIR = "$HOME/.local/share/itl-remote"
CONFIG_DIR = "$HOME/.config/itl-remote"
UNIT_NAME = "itl-remote.service"
UNIT_PATH = "$HOME/.config/systemd/user/" + UNIT_NAME

_HERE = Path(__file__).resolve().parent


def _sources() -> dict[str, str]:
    """원격에 얹을 파일들. probe 는 글리프가 찍힌 판이다."""
    return {
        "probe.py": script_source(),
        "wsclient.py": (_HERE / "wsclient.py").read_text(encoding="utf-8"),
        "client.py": (_HERE / "client.py").read_text(encoding="utf-8"),
    }


def version_hash() -> str:
    """내용 해시. 원격이 낡았는지 **버전 문자열 관리 없이** 판정한다."""
    digest = hashlib.sha256()
    for name, body in sorted(_sources().items()):
        digest.update(name.encode())
        digest.update(body.encode("utf-8"))
    return digest.hexdigest()[:12]


def _heredoc(path: str, body: str, marker: str) -> str:
    # 따옴표 친 마커 → 원격 셸이 본문의 $ 나 백틱을 건드리지 않는다.
    return f"cat > {path} <<'{marker}'\n{body}\n{marker}"


def build_install_script(url: str, tmux_socket: str) -> str:
    """설치 명령. **토큰은 여기 없다** — stdin 첫 줄로 들어온다."""
    parts = [
        "IFS= read -r _itl_tok",
        # 🔐 **디렉터리도 좁힌다.** 파일만 600 으로 두면 그 파일은 못 읽어도, 디렉터리가
        # 그룹 쓰기 가능하면(실측: 775) 같은 그룹의 다른 사용자가 **파일을 갈아치울 수**
        # 있다 — 자격증명을 바꾸거나 client.py 를 자기 코드로 대체할 수 있다는 뜻이다.
        # umask 에 맡기지 않고 못을 박는다(호스트마다 umask 가 다르다).
        f"mkdir -p {LIB_DIR} {CONFIG_DIR}",
        f"chmod 700 {LIB_DIR} {CONFIG_DIR}",
    ]
    for index, (name, body) in enumerate(sorted(_sources().items())):
        parts.append(_heredoc(f"{LIB_DIR}/{name}", body, f"ITL_REMOTE_EOF_{index}"))
    parts += [
        # 개행을 꼭 붙인다 — 없으면 이 파일을 읽는 쪽에서 다음 출력이 같은 줄에 이어붙는다.
        f"printf '%s\\n' {shlex.quote(version_hash())} > {LIB_DIR}/VERSION",
        # 자격증명 파일은 만들기 **전에** 권한을 좁힌다 — 먼저 쓰고 나중에 chmod 하면
        # 그 사이에 같은 기계의 다른 사용자가 읽을 수 있다.
        f"umask 077 && : > {CONFIG_DIR}/credentials",
        (f'printf \'{{"url":%s,"tmux_socket":%s,"token":"%s"}}\' '
         f'{shlex.quote(_json_str(url))} {shlex.quote(_json_str(tmux_socket))} '
         f'"$_itl_tok" > {CONFIG_DIR}/credentials'),
        f"chmod 600 {CONFIG_DIR}/credentials",
        "unset _itl_tok",
        _systemd_unit_script(),
        "echo ITL_REMOTE_INSTALLED",
    ]
    return "\n".join(parts)


def _json_str(value: str) -> str:
    return json.dumps(value or "")


def _systemd_unit_script() -> str:
    """user unit 을 쓸 수 있으면 등록하고, 없으면 조용히 건너뛴다.

    ⚠️ systemd 가 없다고 설치를 실패로 만들지 않는다 — 컨테이너·구형 기계에서도
    돌아야 하고, 그런 곳에서는 사용자가 직접 띄우면 된다(명령을 상태에 함께 돌려준다).
    """
    unit = "\n".join([
        "[Unit]",
        "Description=Terminal List remote",
        "After=network-online.target",
        "",
        "[Service]",
        "Type=simple",
        f"ExecStart=/usr/bin/env python3 {LIB_DIR}/client.py".replace("$HOME", "%h"),
        "Restart=always",
        "RestartSec=5",
        "",
        "[Install]",
        "WantedBy=default.target",
    ])
    # ⚠️ **heredoc 은 절대 들여쓰지 않는다.** 보기 좋으라고 안쪽을 밀어 넣었다가 두 가지가
    # 한꺼번에 깨졌다: ① 유닛 본문이 `  [Unit]` 로 쓰여 systemd 가 파싱하지 못하고,
    # ② `<<'MARKER'` 는 구분자가 **행 맨 앞**이어야 하므로 heredoc 이 영영 닫히지 않아
    # 뒤따르는 `systemctl`·완료 표식까지 통째로 삼킨다. 셸은 들여쓰기를 신경 쓰지 않으니
    # 여기서 얻을 것은 없고 잃을 것만 있다.
    return "\n".join([
        "if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment "
        ">/dev/null 2>&1; then",
        "mkdir -p $HOME/.config/systemd/user",
        _heredoc(UNIT_PATH, unit, "ITL_UNIT_EOF"),
        "systemctl --user daemon-reload >/dev/null 2>&1",
        f"systemctl --user enable {UNIT_NAME} >/dev/null 2>&1",
        # ⚠️ **restart 여야 한다.** `enable --now` 는 이미 돌고 있는 서비스를 다시 띄우지
        # 않는다 — 파일만 새것이고 프로세스는 옛 코드 그대로다. 다시 설치했는데 아무것도
        # 안 바뀌는 조용한 실패가 되고, 실측에서 그 탓에 기계 값이 계속 비어 있었다.
        f"systemctl --user restart {UNIT_NAME} >/dev/null 2>&1"
        " && echo ITL_REMOTE_SERVICE=1 || echo ITL_REMOTE_SERVICE=0",
        "else",
        "echo ITL_REMOTE_SERVICE=none",
        "fi",
    ])


STATUS_SCRIPT = "\n".join([
    f'[ -f {LIB_DIR}/client.py ] && echo FILES=1 || echo FILES=0',
    f'[ -f {CONFIG_DIR}/credentials ] && echo CRED=1 || echo CRED=0',
    # ⚠️ `cat | sed` 로 흘리면 파일에 개행이 없을 때 **다음 줄이 이어붙는다**(실측:
    # `VERSION=f0fc…SERVICE=active` → 버전도 서비스도 못 읽고 "낡았다" 로 오판했다).
    # 명령치환은 끝의 개행을 떼고 echo 가 하나를 붙이므로, 파일이 어떻게 생겼든 한 줄이다.
    f'echo "VERSION=$(cat {LIB_DIR}/VERSION 2>/dev/null)"',
    "if command -v systemctl >/dev/null 2>&1; then",
    f'  systemctl --user is-active {UNIT_NAME} 2>/dev/null | sed "s/^/SERVICE=/";',
    "else echo SERVICE=none; fi",
    # 서비스 없이 손으로 띄운 경우도 잡는다 — "안 도는데 돈다고" 보다 낫다.
    # ⚠️ 대괄호는 오타가 아니다. 이 스크립트 전체가 원격 셸의 argv 가 되므로, 패턴을
    # 그대로 적으면 **pgrep 이 자기를 실행한 셸을 찾아** 항상 PROC=1 이 된다(실측).
    # `[c]lient` 는 정규식으로는 client 에 맞지만 문자열로는 자기 자신과 다르다.
    'pgrep -f "itl-remote/[c]lient.py" >/dev/null 2>&1 && echo PROC=1 || echo PROC=0',
])

UNINSTALL_SCRIPT = "\n".join([
    "if command -v systemctl >/dev/null 2>&1; then",
    f"  systemctl --user disable --now {UNIT_NAME} >/dev/null 2>&1 || true;",
    f"  rm -f {UNIT_PATH};",
    "  systemctl --user daemon-reload >/dev/null 2>&1 || true;",
    "fi",
    'pkill -f "itl-remote/client.py" >/dev/null 2>&1 || true',
    f"rm -rf {LIB_DIR} {CONFIG_DIR}",
    "echo ITL_REMOTE_REMOVED",
])


def manual_start_command() -> str:
    """systemd user 서비스가 없는 호스트에서 사람이 직접 띄우는 명령.

    경로가 여기 상수와 같이 움직여야 하므로 문자열을 화면에 박지 않는다 — 한쪽만 바뀌면
    사용자가 붙여넣은 명령이 조용히 아무것도 안 하는 경로를 가리킨다.
    """
    return f"nohup python3 {LIB_DIR}/client.py >/dev/null 2>&1 &"


def start_hint(status: dict) -> str | None:
    """지금 무엇을 더 해야 하나 — 없으면 None.

    ⚠️ 설치가 성공했는데 **아무것도 안 도는** 조합이 있다(systemd 없는 호스트). 그때
    화면이 "아직 안 붙었습니다" 만 말하면 이유도 할 일도 알 수 없다.
    """
    if not status.get("installed") or status.get("connected"):
        return None
    service = status.get("service")
    if service == "none":
        return "manual"          # systemctl 자체가 없다 → 직접 띄워야 한다
    if service == "inactive":
        return "inactive"        # 유닛은 있는데 멈춰 있다
    return "waiting"             # 서비스는 살아 있다 → 재시도 중일 뿐


def parse_status(raw: str, connected: bool, current_version: str) -> dict:
    """원격 출력 → 상태. **모르는 것은 None 이다**(False 가 아니라)."""
    text = raw or ""
    installed = "FILES=1" in text and "CRED=1" in text
    version = None
    for line in text.splitlines():
        if line.startswith("VERSION="):
            version = line[len("VERSION="):].strip() or None
    service = None
    for line in text.splitlines():
        if line.startswith("SERVICE="):
            service = line[len("SERVICE="):].strip() or None
    return {
        "installed": installed,
        # 붙어 있는가는 **우리 쪽 사실**이라 SSH 출력보다 정확하다.
        "connected": connected,
        "running": connected or "PROC=1" in text,
        "service": service,                 # active / inactive / none / None(모름)
        "version": version,
        "outdated": bool(installed and version and version != current_version),
    }

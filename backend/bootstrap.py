"""
컨테이너 부팅 시 호스트 자동 등록.

UX 원칙: 사용자가 secrets/ssh-key 파일 하나만 두면 끝. 나머지는 다 자동.

자동 감지:
  - 트리거: /app/secrets/ssh-key 파일이 존재 → 자동등록 진행
  - 호스트 주소: host.docker.internal (Docker Desktop/Linux의 표준 호스트 게이트웨이)
  - SSH 유저: ubuntu (가장 흔한 기본값)
  - tmux: ON (컨테이너 재기동에도 셸 영속)

override (env, 모두 선택):
  BOOTSTRAP_HOST_NAME       기본 "Docker Host"
  BOOTSTRAP_HOST_HOSTNAME   기본 "host.docker.internal"
  BOOTSTRAP_HOST_USER       기본 "ubuntu"
  BOOTSTRAP_HOST_PORT       기본 22
  BOOTSTRAP_HOST_KEY_PATH   기본 "/app/secrets/ssh-key"
  BOOTSTRAP_HOST_TMUX_SESSION  기본 "mobile"
  BOOTSTRAP_HOST_START_PATH 선택

idempotent — 같은 이름의 호스트가 admin 소유로 이미 있으면 skip.
admin 미설정이면 (initial setup 전) silent skip — 다음 부팅에서 재시도.
"""
import logging
import os
import uuid

from sqlite_storage import storage
from vault import decrypt_str, encrypt_str

logger = logging.getLogger(__name__)

DEFAULT_KEY_PATH = "/app/secrets/ssh-key"
DEFAULT_HOSTNAME = "host.docker.internal"
DEFAULT_NAME = "Docker Host"
DEFAULT_USER = "ubuntu"
DEFAULT_TMUX_SESSION = "mobile"
BOOTSTRAP_KEY_NAME = "_bootstrap_key"


async def _ensure_bootstrap_key(username: str, key_path: str) -> str | None:
    for k in await storage.list_ssh_keys(username):
        if k.get("name") == BOOTSTRAP_KEY_NAME:
            return k["id"]
    try:
        with open(key_path, "r", encoding="utf-8") as f:
            private_key = f.read()
    except OSError as e:
        logger.warning("bootstrap: cannot read key at %s (%s)", key_path, e)
        return None
    if not private_key.strip():
        logger.warning("bootstrap: key file %s is empty", key_path)
        return None
    passphrase = os.getenv("BOOTSTRAP_HOST_KEY_PASSPHRASE", "").strip() or None
    key_id = str(uuid.uuid4())
    await storage.create_ssh_key(
        key_id=key_id,
        username=username,
        name=BOOTSTRAP_KEY_NAME,
        public_key=None,
        private_key_enc=encrypt_str(private_key),
        passphrase_enc=encrypt_str(passphrase) if passphrase else None,
    )
    logger.info("bootstrap: created SSH key entry for %s", username)
    return key_id


async def register_bootstrap_host() -> None:
    key_path = os.getenv("BOOTSTRAP_HOST_KEY_PATH", "").strip() or DEFAULT_KEY_PATH
    if not os.path.exists(key_path):
        return  # 키 파일 없음 → 자동등록 미사용 (정상 경로)

    admin = await storage.get_admin()
    if not admin:
        logger.info("bootstrap: admin not set up yet — will retry on next startup")
        return
    username = admin["username"]

    name = (os.getenv("BOOTSTRAP_HOST_NAME") or DEFAULT_NAME).strip()
    if any(h.get("name") == name for h in await storage.list_hosts(username)):
        return  # 이미 등록됨 — idempotent

    key_id = await _ensure_bootstrap_key(username, key_path)
    if not key_id:
        return

    hostname = (os.getenv("BOOTSTRAP_HOST_HOSTNAME") or DEFAULT_HOSTNAME).strip()
    ssh_user = (os.getenv("BOOTSTRAP_HOST_USER") or DEFAULT_USER).strip()
    port = int((os.getenv("BOOTSTRAP_HOST_PORT") or "22").strip() or "22")
    tmux_session = (os.getenv("BOOTSTRAP_HOST_TMUX_SESSION") or DEFAULT_TMUX_SESSION).strip()
    start_path = (os.getenv("BOOTSTRAP_HOST_START_PATH") or "").strip() or None

    # tmux 사전 확인 — 3-상태 결과:
    #   "yes"     : SSH 통과 + tmux 있음 → use_remote_tmux=1
    #   "no"      : SSH 통과 + tmux 없음 → use_remote_tmux=0 + 안내 경고
    #   "unknown" : SSH 자체 실패 (MFA / 네트워크 / 키 미인가 등) → tmux 있다고 가정하고 1
    #               (호스트 sshd 가 MFA 강제하는 흔한 케이스. 첫 사용자 attach 시 OTP 입력으로
    #               통과되고 tmux 도 보통 깔려있다는 가정. 없으면 그때 알아채고 토글 끄면 됨)
    tmux_status = await _probe_remote_tmux(hostname, port, ssh_user, key_path)
    use_tmux = 0 if tmux_status == "no" else 1
    host_id = str(uuid.uuid4())
    await storage.upsert_host(
        host_id, username,
        name=name,
        hostname=hostname,
        port=port,
        ssh_user=ssh_user,
        auth_method="key",
        key_id=key_id,
        use_remote_tmux=use_tmux,
        remote_tmux_session=tmux_session,
        start_path=start_path,
        color_index=0,
    )
    logger.info(
        "bootstrap: registered host '%s' (%s@%s:%d, key, tmux=%s)",
        name, ssh_user, hostname, port, tmux_status,
    )
    if tmux_status == "no":
        logger.warning(
            "bootstrap: host '%s' has SSH access but no tmux installed. "
            "Connect once, run `sudo apt install tmux` / `brew install tmux`, "
            "then enable 'Remote tmux' from host settings for persistent sessions.",
            name,
        )
    elif tmux_status == "unknown":
        logger.info(
            "bootstrap: tmux probe could not run (likely MFA-protected sshd). "
            "Assuming tmux is available. On first attach you'll see the usual "
            "OTP prompt; if tmux is actually missing, disable 'Remote tmux' "
            "from host settings.",
        )


async def _probe_remote_tmux(hostname: str, port: int, ssh_user: str, key_path: str) -> str:
    """등록한 호스트로 SSH 한 번 붙어서 tmux 가 PATH 에 있는지 확인.
    반환값: "yes" | "no" | "unknown" (unknown = SSH 자체 실패, MFA 강제 등)."""
    try:
        import asyncssh  # 백엔드 dep
        with open(key_path, "r", encoding="utf-8") as f:
            private_key = f.read()
        passphrase = os.getenv("BOOTSTRAP_HOST_KEY_PASSPHRASE", "").strip() or None
        async with asyncssh.connect(
            hostname,
            port=port,
            username=ssh_user,
            client_keys=[asyncssh.import_private_key(private_key, passphrase=passphrase)],
            known_hosts=None,  # 첫 부팅 — TOFU
            connect_timeout=8,
        ) as conn:
            result = await conn.run("command -v tmux >/dev/null 2>&1 && echo yes || echo no", check=False)
            return "yes" if (result.stdout or "").strip().endswith("yes") else "no"
    except Exception as e:
        logger.info("bootstrap: tmux probe could not connect to %s@%s:%d (%s)", ssh_user, hostname, port, e)
        return "unknown"

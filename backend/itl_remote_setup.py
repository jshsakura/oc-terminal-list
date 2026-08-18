"""원격 호스트용 itl 셋업 — CLI 설치 + tmux 세션 환경 주입.

보안 규칙 ("첫째도 둘째도 보안이다"):
1. 토큰은 SSH stdin 으로만 이동한다. 우리가 조립해 보내는 명령 문자열에는 토큰
   값이 없다 — `$_itl_tok` 셸 변수 이름뿐. (명령 문자열은 원격 셸의 argv 가
   되어 그 호스트의 ps 에 보인다. host_common.run_remote_cmd 의 stdin 통로 규칙.)
2. 원격 디스크에는 비밀이 하나도 남지 않는다. 깔리는 것은 비밀 없는 CLI 스크립트
   하나뿐이고, 그 내용조차 cat 의 stdin 으로 흘려보낸다.
3. 토큰은 itl 스코프다 — 유출돼도 itl 송수신 외에는 아무 API 도 못 쓰고, 백엔드가
   tailnet 안에서만 닿는다.
4. 테일스케일에서만 움직인다. 백엔드 자신의 주소가 tailnet(100.x) 이 아니면
   주입을 아예 건너뛴다 — 공용망 주소를 원격 터미널에 심지 않는다.

residual, 정직하게: `tmux set-environment … "$_itl_tok"` 이 실행되는 수 밀리초
동안 확장된 값이 원격 ps 에 스칠 수 있다. 로컬 세션도 tmux show-environment 로
same-user 에게 상시 노출되는 것과 동등 이하 수준이고(itl_env 설계가 이미 받아들인
수준), 토큰이 itl 스코프 + tailnet 한정이라 실질 반경이 없다. 대안들(rc 파일,
디스크 캐시)은 전부 영구 저장이라 더 나쁘다.
"""
from __future__ import annotations

import hashlib
import logging
import os
import shlex
import time
from pathlib import Path

from _deps import ITL_TOKEN_SCOPE, get_auth_manager
from host_common import run_remote_cmd
from server_identity import get_server_identity

logger = logging.getLogger(__name__)

# ~/.profile 에 PATH 줄을 추가할 때 찾아볼 멱등 마커.
PROFILE_MARKER = "iTerminaLlist itl setup"


def _remote_api_base(identity: dict) -> str:
    """원격 CLI 가 부를 백엔드 주소 — tailnet 주소만. 아니면 '' (기능 OFF)."""
    if identity.get("ip_kind") != "tailscale" or not identity.get("ip"):
        return ""
    return f"http://{identity['ip']}:{os.getenv('APP_PORT', '38822')}"


def _exact_target(session: str, suffix: str = "") -> str:
    """tmux exact-match 타깃(`=name`)을 sh/zsh 모두 안전하게 감싼다.

    zsh 는 `=` 로 시작하는 토큰을 명령 경로 확장으로 해석해 tmux 이전에 실패한다.
    hosts.py get_host_tmux_clients 의 것과 같은 규칙.
    """
    q = shlex.quote(f"={session}{suffix}")
    if q.startswith("="):
        q = "'" + q.replace("'", "'\"'\"'") + "'"
    return q


def _cli_source() -> str:
    """배포 저장소의 backend/cli/itl 원문 — 설치·수동 명령 모두 이 하나가 진실."""
    path = Path(__file__).resolve().with_name("cli") / "itl"
    return path.read_text(encoding="utf-8")


def _cli_hash() -> str:
    """Fingerprint of the CLI we would install, used as the remote version marker."""
    return hashlib.sha256(_cli_source().encode("utf-8")).hexdigest()[:16]


AUTO_INSTALL_ENABLED = os.getenv("ITL_AUTO_INSTALL", "1").strip() not in ("0", "false", "no")

# Re-checking the remote copy on every attach would put an SSH round trip on the
# reconnect path — the one place this repo keeps having to take work *out* of. The hash
# is part of the key, so a new CLI version reinstalls on the next attach regardless.
CLI_TTL_SECONDS = 6 * 60 * 60
_cli_seen: dict[tuple[str, str], float] = {}


def forget_installed(host_id: str) -> None:
    """Drop the install memo for a host (tests, and after a manual reinstall)."""
    for key in [k for k in _cli_seen if k[0] == str(host_id)]:
        _cli_seen.pop(key, None)


def build_install_cmd(version: str, *, with_rc: bool) -> str:
    """Write ~/.local/bin/itl from stdin, but only when it is missing or stale.

    Always reading stdin keeps this to one round trip instead of check-then-install —
    and the body lands on a temp name first, so a connection dropped mid-transfer cannot
    leave a half-written `itl` that runs and fails in confusing ways.

    `with_rc` is what separates the two paths on purpose: the automatic install writes
    **only** its own file, while editing the user's ~/.profile and ~/.bashrc stays behind
    the button they press themselves. Panes opened by this app get the directory from the
    session PATH either way, so the rc lines only matter for shells the user starts.
    """
    bin_dir = '"$HOME/.local/bin"'
    tmp = '"$HOME/.local/bin/.itl.incoming"'
    target = '"$HOME/.local/bin/itl"'
    marker = '"$HOME/.local/bin/.itl.version"'
    ver = shlex.quote(version)
    rc = f"{_rc_path_snippet()}; " if with_rc else ""
    return "\n".join([
        f"mkdir -p {bin_dir} || {{ echo ITL_CLI_FAIL; exit 0; }}",
        f"cat > {tmp} || {{ echo ITL_CLI_FAIL; exit 0; }}",
        f'if [ "$(cat {marker} 2>/dev/null)" = {ver} ] && [ -x {target} ]; then',
        f"  rm -f {tmp}; {rc}echo ITL_CLI_CURRENT",
        "else",
        f"  mv {tmp} {target} && chmod 700 {target} && printf '%s\\n' {ver} > {marker} && "
        f"{rc}echo ITL_CLI_INSTALLED || echo ITL_CLI_FAIL",
        "fi",
    ])


async def ensure_remote_itl_cli(host: dict, secrets: dict) -> bool:
    """Make sure this host has a current `itl`, without anyone asking for it.

    The feature this app is built around is one agent handing work to another across
    machines. Until now the remote half only worked if someone had found the button in
    the host editor and pressed it — so on a fresh host the handoff silently degraded to
    "no reply command available". Installing costs one SSH round trip on the first
    attach and nothing afterwards.
    """
    if not AUTO_INSTALL_ENABLED:
        return False
    try:
        version = _cli_hash()
    except Exception as e:
        logger.warning("itl CLI 소스를 읽지 못했습니다: %s", e)
        return False

    key = (str(host.get("id") or host.get("hostname") or ""), version)
    now = time.monotonic()
    seen = _cli_seen.get(key)
    if seen is not None and (now - seen) < CLI_TTL_SECONDS:
        return True

    try:
        out = await run_remote_cmd(
            host, secrets, build_install_cmd(version, with_rc=False),
            timeout=20, stdin_data=_cli_source(),
        )
    except Exception as e:
        # A Windows host, a locked-down shell, a full disk — all land here. The terminal
        # still works; only the cross-machine handoff is unavailable, and the host editor
        # reports that as its status.
        logger.info("itl 원격 자동 설치 건너뜀 (%s): %s", key[0], e)
        return False

    if "ITL_CLI_CURRENT" in (out or "") or "ITL_CLI_INSTALLED" in (out or ""):
        if len(_cli_seen) >= _INJECT_CACHE_MAX:
            _cli_seen.pop(min(_cli_seen, key=lambda k: _cli_seen[k]), None)
        _cli_seen[key] = now
        return True
    logger.info("itl 원격 자동 설치 실패 (%s): %s", key[0], (out or "").strip()[:120])
    return False


# 같은 (호스트, 세션) 에 다시 심지 않는 창. 토큰은 30일짜리라 매 재연결마다 심을 이유가
# 없다 — 재연결 폭풍마다 SSH 왕복을 하나 더 얹으면 그게 복구를 느리게 만든다. 창을 두는
# 이유(무한이 아닌 이유): 원격 tmux 서버가 재시작되면 세션 env 가 사라지므로 다시 심어야 한다.
INJECT_TTL_SECONDS = 15 * 60
_INJECT_CACHE_MAX = 256
_injected: dict[tuple[str, str], float] = {}


def _recently_injected(key: tuple[str, str], now: float) -> bool:
    at = _injected.get(key)
    return at is not None and (now - at) < INJECT_TTL_SECONDS


def _remember_injected(key: tuple[str, str], now: float) -> None:
    if len(_injected) >= _INJECT_CACHE_MAX:
        oldest = min(_injected, key=lambda k: _injected[k])
        _injected.pop(oldest, None)
    _injected[key] = now


def forget_injected(host_id: str, tmux_session: str) -> None:
    """다음 접속에서 반드시 다시 심게 한다(테스트·세션 재시작용)."""
    _injected.pop((str(host_id), str(tmux_session)), None)


async def ensure_remote_itl_env(
    host: dict,
    secrets: dict,
    tmux_session: str,
    username: str,
    force: bool = False,
) -> bool:
    """원격 tmux 세션에 ITL_API/ITL_TOKEN/ITL_SESSION 을 심는다.

    - 실패해도 예외를 밖으로 던지지 않는 caller 계약(터미널이 열리는 게 우선).
    - **세션을 만들지 않는다.** 있는 세션에만 심고, 없으면 그냥 물러난다. 예전엔 없으면
      `tmux new-session -d` 로 만들었는데, 그러면 브리지의 조심스러운 생성 절이 통째로
      건너뛰어진다: `set-option -g history-limit` 을 new-session 과 한 tmux 호출로 묶는
      부분(콜드 스타트 첫 pane 이 기본 2000 에 고정된다 — project_tmux_history_limit)과
      PTY 차원 상속(여기 exec 은 PTY 가 없어 80x24 로 시작한다)을 둘 다 잃는다.
      세션을 만드는 것은 브리지의 일이고, 우리는 그 뒤에 붙는다(routes/host_ws.py).
    - 그래서 **respawn 도 하지 않는다.** 이미 떠 있는 pane 프로세스는 env 를 늦게 받지만,
      CLI 가 `tmux show-environment` 로 스스로 회복하도록 만들어져 있다(cli/itl).
    - ITL_SESSION = tmux 세션명. 원격 pane 은 sessionId 가 없고 itl_targets 가
      tmuxSession 정확일치로 신원을 찾는다.
    """
    if not host or not host.get("use_remote_tmux", 1):
        return False
    session = (tmux_session or "").strip()
    if not session:
        return False

    cache_key = (str(host.get("id") or host.get("hostname") or ""), session)
    now = time.monotonic()
    if not force and _recently_injected(cache_key, now):
        return True

    identity = await get_server_identity()
    api = _remote_api_base(identity)
    if not api:
        return False  # tailnet 아님 → 이 기능은 조용히 꺼진다

    manager = get_auth_manager()
    if not manager:
        return False
    try:
        token = await manager.create_scoped_token(username, ITL_TOKEN_SCOPE)
    except Exception as e:
        logger.warning("itl 스코프 토큰 발급 실패 (%s): %s", username, e)
        return False
    if not token:
        return False

    exact = _exact_target(session)

    # 토큰 값은 어디에도 문자열로 박히지 않는다 — stdin → read → "$_itl_tok".
    cmd = "\n".join([
        "IFS= read -r _itl_tok",
        f"tmux has-session -t {exact} 2>/dev/null || {{ echo ITL_ENV_NOSESSION; unset _itl_tok; exit 0; }}",
        f'tmux set-environment -t {exact} ITL_TOKEN "$_itl_tok"',
        f"tmux set-environment -t {exact} ITL_API {shlex.quote(api)}",
        f"tmux set-environment -t {exact} ITL_SESSION {shlex.quote(session)}",
        # 실측 장애 원인: ~/.profile 은 로그인 셸만 읽어서 pane(bash 비로그인)이
        # ~/.local/bin 을 못 찾는다. 세션 env 의 PATH 자체에 심으면 이후 pane 전체
        # (그 안에서 돌는 에이전트와 비대화형 bash -c 자식들까지)가 물리고 받는다.
        f'_itl_p="$(tmux show-environment -t {exact} PATH 2>/dev/null | cut -d= -f2-)"',
        '[ -n "$_itl_p" ] || _itl_p="$PATH"',
        (f'case ":$_itl_p:" in *":$HOME/.local/bin:"*) ;; '
         f'*) tmux set-environment -t {exact} PATH "$HOME/.local/bin:$_itl_p" 2>/dev/null ;; esac'),
        "unset _itl_tok _itl_p",
        "echo ITL_ENV_OK",
    ])
    try:
        out = await run_remote_cmd(host, secrets, cmd, timeout=12, stdin_data=token)
    except Exception as e:
        logger.warning("itl 원격 env 주입 실패 (%s): %s", session, e)
        return False
    if "ITL_ENV_OK" not in (out or ""):
        return False
    _remember_injected(cache_key, now)
    return True


def _rc_path_snippet() -> str:
    """~/.profile 과 ~/.bashrc 양쪽에 PATH 줄을 멱등 추가하는 원격 셸 조각.

    profile 만으로는 부족했다 — pane 셸은 비로그인이라 bashrc 만 읽는다(실측).
    """
    marker_q = shlex.quote(PROFILE_MARKER)
    line = "export PATH=\"$HOME/.local/bin:$PATH\""
    return (
        f'for _rc in "$HOME/.profile" "$HOME/.bashrc"; do '
        f"grep -q {marker_q} \"$_rc\" 2>/dev/null || "
        f"printf '\\n# added by {PROFILE_MARKER}\\n{line}\\n' >> \"$_rc\"; done; "
        "unset _rc"
    )


def build_manual_setup_command() -> str:
    """사람이 원격 터미널에 붙여넣는 셋업 원라이너 — 비밀이 하나도 없다.

    heredoc 는 인용('ITL_EOF')돼 본문이 확장되지 않고, 본문에 ITL_EOF 라인이
    없으므로 안전하게 끝난다.
    """
    content = _cli_source().rstrip("\n")
    return (
        "mkdir -p ~/.local/bin && cat > ~/.local/bin/itl <<'ITL_EOF'\n"
        f"{content}\n"
        "ITL_EOF\n"
        "chmod 700 ~/.local/bin/itl\n"
        f"{_rc_path_snippet()}\n"
        'echo "itl installed -> ~/.local/bin/itl"'
    )


async def remote_itl_status(host: dict, secrets: dict) -> dict:
    """설치 여부 + pane 셸이 itl 을 PATH 에서 잡는지 + 수동 셋업 명령.

    PANE 검사는 bash -ic(비로그인 대화형 — 실제 pane 과 같은 조건)로 한다.
    """
    cmd = (
        '[ -f "$HOME/.local/bin/itl" ] && echo FILE=1 || echo FILE=0; '
        "bash -ic 'command -v itl >/dev/null 2>&1' 2>/dev/null && echo PANE=1 || echo PANE=0"
    )
    out = await run_remote_cmd(host, secrets, cmd, timeout=10)
    installed = "FILE=1" in (out or "")
    pane_path = "PANE=1" in (out or "")
    return {
        "installed": installed,
        "pane_path": pane_path,
        "setup_command": build_manual_setup_command(),
    }


async def install_remote_itl(host: dict, secrets: dict) -> dict:
    """~/.local/bin/itl 로 영구 설치 + rc PATH(멱등). 본문은 stdin 으로.

    Shares one command builder with the automatic path so the two cannot drift; the only
    difference is `with_rc`, which is the whole point of pressing the button — it also
    puts the directory on the PATH of shells the user opens themselves.
    """
    content = _cli_source()
    if not content.strip():
        raise RuntimeError("backend/cli/itl 소스를 읽을 수 없습니다")
    cmd = build_install_cmd(_cli_hash(), with_rc=True)
    out = await run_remote_cmd(host, secrets, cmd, timeout=20, stdin_data=content)
    if not ("ITL_CLI_INSTALLED" in (out or "") or "ITL_CLI_CURRENT" in (out or "")):
        raise RuntimeError("원격 설치가 완료되지 않았습니다")
    # The manual install just proved the host is current; let the automatic path skip it.
    forget_installed(str(host.get("id") or host.get("hostname") or ""))
    return await remote_itl_status(host, secrets)

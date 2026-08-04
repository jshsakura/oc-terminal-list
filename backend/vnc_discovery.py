"""Xvnc 가상 데스크탑 디스커버리 — SSH 한 번으로 긁어온 원격 출력을 파싱.

파싱은 전부 순수 함수다. SSH 가 필요한 건 gather_discovery 하나뿐이며, 거기도
runner callable 을 주입받아 테스트 가능하다. (routes/vnc.py 가 key/pass 호스트는
ssh_pool, tailscale 호스트는 tailscale ssh 서브프로세스로 runner 를 만들어 넘긴다.)

수집하는 세 가지:
  - ls -1 /tmp/.X11-unix/    → 존재하는 디스플레이 번호 (``X1`` → ``:1``)
  - ss -ltnH (또는 netstat)  → 5900번대 리스닝 포트 + 바인딩 주소
  - ps -eo pid,user:32,args → Xtigervnc / Xvnc 프로세스, -geometry, 소유 유저
설치 여부는 후보 경로들(vncserver, /opt/TurboVNC/bin/vncserver, …)을 순회해
첫 히트한 경로를 ``vncserver_path`` 로 돌려준다. GPU 가속 가능 여부는
vglrun + nvidia-smi 로 ``gpu`` 필드에 정리한다. ``~/.vnc/passwd`` 존재 여부는
``has_vnc_passwd`` 로 알려 세션 생성 시 보안 타입을 갈라 만든다.

디스플레이 번호 → 포트는 ``5900 + display``.
"""
from __future__ import annotations

import os
import re
from collections.abc import Awaitable, Callable

# 섹션 구분 마커 — 원격 셸 출력에서 이 문자열이 줄 전체로 나오면 다음 섹션.
_X11_MARK = "__ITL_VNC_X11__"
_SS_MARK = "__ITL_VNC_SS__"
_PS_MARK = "__ITL_VNC_PS__"
_WHICH_MARK = "__ITL_VNC_WHICH__"
_GPU_MARK = "__ITL_VNC_GPU__"
_PASSWD_MARK = "__ITL_VNC_PASSWD__"
_ENV_MARK = "__ITL_VNC_ENV__"

# 원격에서 한 번에 실행하는 디스커버리 명령. 각 subcommand 가 자신의 stderr 를
# 삼키도록 2>/dev/null 를 달아뒀다 — runner 가 stdout/stderr 를 합쳐도 파서가
# 섞이지 않는다. ss 가 없으면 netstat 으로 폴백.
#
# WHICH 섹션은 후보 경로들을 순회하며 첫 번째로 발견한 vncserver 바이너리 경로를
# 출력한다. TurboVNC 는 /opt/TurboVNC/bin/vncserver 처럼 PATH 밖에 설치되는 경우가
# 있어 절대경로 후보까지 직접 찔러본다. command -v 는 PATH 조회와 절대경로 존재
# 확인을 모두 처리한다.
# GPU 섹션은 VirtualGL(vglrun) + nvidia-smi 로 GPU 가속 가능 여부를 알아낸다.
DISCOVERY_CMD = (
    f"echo {_X11_MARK}; ls -1 /tmp/.X11-unix/ 2>/dev/null; "
    f"echo {_SS_MARK}; (ss -ltnH 2>/dev/null || netstat -ltn 2>/dev/null); "
    f"echo {_PS_MARK}; ps -eo pid,user:32,args 2>/dev/null; "
    f"echo {_WHICH_MARK}; "
    f'for p in vncserver /opt/TurboVNC/bin/vncserver /usr/bin/vncserver '
    f'/usr/local/bin/vncserver Xtigervnc; do command -v "$p" 2>/dev/null && break; done; '
    f"echo {_GPU_MARK}; "
    f'echo "VGL:$(command -v vglrun 2>/dev/null || true)"; '
    f'nvidia-smi -L >/dev/null 2>&1 && echo "NSMI:yes" || echo "NSMI:no"; '
    f'echo "VGA:$(lspci 2>/dev/null | grep -i vga | head -1 || true)"; '
    f"echo {_PASSWD_MARK}; test -f ~/.vnc/passwd && echo yes || echo no; "
    # 미설치 호스트에 설치법을 안내하려면 배포판을 알아야 한다. 그리고 VNC 만
    # 있고 데스크탑이 없으면 세션이 뜨자마자 죽는다(실제로 겪은 실패) — xsessions
    # 유무도 같이 본다.
    f"echo {_ENV_MARK}; "
    f'echo "ID:$(. /etc/os-release 2>/dev/null && echo "$ID" || true)"; '
    f'echo "XSESSIONS:$(ls -1 /usr/share/xsessions/ 2>/dev/null | head -1 || true)"'
)

# Xtigervnc(TigerVNC) 와 Xvnc(RealVNC/TigerVNC 구형) — 둘 다 가상 디스플레이 서버.
# x11vnc(실제 모니터 미러링)는 범위 밖이라 여기서 잡지 않는다.
#
# 프로세스 판정은 엄격하게: args 의 첫 토큰(실행 파일) basename 이 정확히
# Xvnc / Xtigervnc 여야 한다. 명령줄 아무 곳에나 "Xtigervnc" 가 등장하는 것으로는
# 잡지 않는다 — 그러면 디스커버리 명령 자신(for 루프 후보 경로에 "Xtigervnc" 포함)
# 이나 vncserver 래퍼 스크립트를 잘못 잡는다.
_VNC_SERVER_NAMES = {"Xvnc", "Xtigervnc"}
# 디스플레이 번호는 독립된 ":N" 인자여야 한다. "user:32" 처럼 다른 토큰에 붙어
# 있는 것은 디스플레이 번호가 아니다.
_DISPLAY_TOKEN_RE = re.compile(r"^:(\d+)$")
_GEOMETRY_RE = re.compile(r"-geometry\s+(\d+x\d+)", re.IGNORECASE)

# 디스커버리 명령 자신을 배제하기 위한 마커 목록. ps 출력에 이 마커들이 포함된
# 줄은 우리가 실행한 셸 명령 자신이므로 버린다.
_ALL_MARKERS = (_X11_MARK, _SS_MARK, _PS_MARK, _WHICH_MARK, _GPU_MARK, _PASSWD_MARK, _ENV_MARK)

# VNC 포트 범위 — display 0..99 → 5900..5999.
_VNC_PORT_LO = 5900
_VNC_PORT_HI = 5999


def parse_x11_unix(text: str) -> list[int]:
    """``ls -1 /tmp/.X11-unix/`` 결과 → 디스플레이 번호 목록.

    ``X1`` → ``1``. ``X``로 시작하고 나머지가 숫자인 줄만 본다.
    """
    nums: list[int] = []
    for line in (text or "").splitlines():
        line = line.strip()
        if len(line) >= 2 and line[0] == "X" and line[1:].isdigit():
            nums.append(int(line[1:]))
    return nums


def parse_listening_ports(text: str) -> dict[int, str]:
    """``ss -ltnH`` 또는 ``netstat -ltn`` 결과 → {포트: 바인딩 주소} (5900번대만).

    리스닝 소켓의 local-address 토큰(``127.0.0.1:5901``, ``:::5902``, ``[::]:5902``)
    을 토큰 단위로 훑어 마지막 ``:`` 뒤가 5900-5999 숫자면 취합한다.
    두 포맷 모두 local-address 가 토큰이라 포맷 분기 없이 처리된다.
    """
    ports: dict[int, str] = {}
    for line in (text or "").splitlines():
        for tok in line.split():
            host, sep, port_s = tok.rpartition(":")
            if not sep or not host or not port_s.isdigit():
                continue
            port = int(port_s)
            if _VNC_PORT_LO <= port <= _VNC_PORT_HI:
                if host.startswith("[") and host.endswith("]"):
                    host = host[1:-1]
                ports[port] = host
    return ports


def parse_vnc_processes(text: str) -> list[dict]:
    """``ps -eo pid,user:32,args`` 결과 → VNC 서버 프로세스 목록.

    각 항목: ``{pid, user, server, display, geometry}``. ``display``/``geometry`` 는
    args 에서 파싱 못 하면 각각 ``None``/``""``.

    ``user:32`` 로 8자 잘림을 방지한다 — 기본 ``user`` 컬럼은 8자 제한이라 긴
    사용자명이 ``+`` 로 잘린다. ``split(None, 2)`` 는 연속 공백을 하나로 collapses
    하므로 32자 패딩에 영향받지 않는다.

    **자기 탐지 방지 (두 겹):**
    1. args 첫 토큰의 basename 이 정확히 ``Xvnc`` / ``Xtigervnc`` 여야 한다. 명령줄
       아무 곳에나 등장하는 문자열로는 잡지 않는다.
    2. 디스커버리 마커(``__ITL_VNC_*``)가 포함된 줄은 우리 명령 자신이므로 버린다.
    디스플레이 번호도 독립된 ``:N`` 인자여야 하며 ``user:32`` 같은 토큰에서 오인되지
    않는다.
    """
    procs: list[dict] = []
    for line in (text or "").splitlines():
        # Layer 2 — 디스커버리 명령 자신을 배제.
        if any(m in line for m in _ALL_MARKERS):
            continue
        parts = line.split(None, 2)
        if len(parts) < 3:
            continue
        pid_s, user, args = parts
        if not pid_s.isdigit():
            continue
        # Layer 1 — 실행 파일 basename 이 정확히 Xvnc / Xtigervnc 여야 한다.
        args_tokens = args.split()
        if not args_tokens:
            continue
        exe_name = os.path.basename(args_tokens[0])
        if exe_name not in _VNC_SERVER_NAMES:
            continue
        # 디스플레이 번호는 독립된 ":N" 인자 — user:32 같은 토큰은 제외.
        display: int | None = None
        for tok in args_tokens[1:]:
            dm = _DISPLAY_TOKEN_RE.fullmatch(tok)
            if dm:
                display = int(dm.group(1))
                break
        geometry = ""
        gm = _GEOMETRY_RE.search(args)
        if gm:
            geometry = gm.group(1)
        procs.append({
            "pid": int(pid_s),
            "user": user,
            "server": exe_name,
            "display": display,
            "geometry": geometry,
        })
    return procs


def parse_installed(text: str) -> bool:
    """``command -v vncserver Xtigervnc`` 결과 → 하나라도 있으면 True."""
    return bool((text or "").strip())


def parse_vncserver_path(text: str) -> str | None:
    """WHICH 섹션 결과 → 첫 번째 비어있지 않은 줄(발견된 vncserver 경로).

    후보 순회 루프가 첫 히트에서 ``break`` 하므로 섹션의 첫 번째 줄이 곧 경로다.
    빈 섹션이면 설치되지 않은 것 → None.
    """
    for line in (text or "").splitlines():
        line = line.strip()
        if line:
            return line
    return None


def detect_flavor(path: str | None) -> str:
    """경로에서 TurboVNC vs TigerVNC 구분.

    path 가 None(미설치)이면 빈 문자열. 경로에 "turbovnc" 가 들어가면
    "turbovnc", 그 외 설치된 경우는 "tigervnc".
    """
    if path is None:
        return ""
    return "turbovnc" if "turbovnc" in path.lower() else "tigervnc"


def _detect_gpu_vendor(nvidia: bool, vga_text: str) -> str | None:
    """nvidia-smi 성공 여부 + lspci VGA 줄에서 GPU 벤더를 추론.

    nvidia-smi 가 성공했으면 "nvidia" 가 확정 (가장 신뢰 가능). 아니면 VGA 줄
    텍스트에서 벤더 키워드를 찾는다. GPU 가 없거나 벤더를 특정 못 하면 None /
    "unknown".
    """
    if nvidia:
        return "nvidia"
    low = (vga_text or "").lower()
    if not low:
        return None
    if "nvidia" in low:
        return "nvidia"
    if "advanced micro devices" in low or "amd" in low or "radeon" in low:
        return "amd"
    if "intel" in low:
        return "intel"
    return "unknown"


def parse_gpu(text: str) -> dict:
    """GPU 섹션 결과 → ``{nvidia, virtualgl, vendor, renderer_hint}``.

    접두사가 붙은 줄을 파싱: ``VGL:<path>``(virtualgl = 경로 비어있지 않음),
    ``NSMI:yes|no``(nvidia = "yes"), ``VGA:<text>``(lspci VGA 컨트롤러 줄).

    GPU 존재 판정은 ``nvidia-smi 성공`` **또는** ``lspci VGA 줄 존재`` — NVIDIA
    뿐 아니라 AMD/Intel GPU 도 잡는다. GPU 가속 가능(renderer_hint="gpu")은
    GPU 가 존재하고 virtualgl 도 설치되어 있을 때. vendor 는 "nvidia"/"amd"/
    "intel"/"unknown"(GPU 있으나 벤더 불명)/None(GPU 없음).
    """
    nvidia = False
    virtualgl = False
    vga_text = ""
    for line in (text or "").splitlines():
        line = line.strip()
        if line.startswith("VGL:"):
            virtualgl = bool(line[4:].strip())
        elif line.startswith("NSMI:"):
            nvidia = line[5:].strip().lower() == "yes"
        elif line.startswith("VGA:"):
            vga_text = line[4:].strip()
    gpu_present = nvidia or bool(vga_text)
    vendor = _detect_gpu_vendor(nvidia, vga_text)
    renderer_hint = "gpu" if (gpu_present and virtualgl) else "software"
    return {
        "nvidia": nvidia,
        "virtualgl": virtualgl,
        "vendor": vendor,
        "renderer_hint": renderer_hint,
    }


def parse_has_vnc_passwd(text: str) -> bool:
    """``test -f ~/.vnc/passwd`` 결과(yes/no) → bool.

    비밀번호 파일이 있으면 세션 생성 시 기본 VncAuth 를 존중하고, 없으면
    ``-SecurityTypes None`` 로 프롬프트 없이 띄운다.
    """
    for line in (text or "").splitlines():
        line = line.strip()
        if line:
            return line == "yes"
    return False


def split_sections(combined: str) -> dict[str, str]:
    """마커로 구분된 통합 출력을 섹션별로 분할. 순수 함수."""
    sections: dict[str, str] = {
        "x11": "", "ss": "", "ps": "", "which": "", "gpu": "", "passwd": "", "env": "",
    }
    marks = {
        _X11_MARK: "x11",
        _SS_MARK: "ss",
        _PS_MARK: "ps",
        _WHICH_MARK: "which",
        _GPU_MARK: "gpu",
        _PASSWD_MARK: "passwd",
        _ENV_MARK: "env",
    }
    current: str | None = None
    for line in (combined or "").splitlines():
        key = marks.get(line.strip())
        if key is not None:
            current = key
        elif current is not None:
            sections[current] += line + "\n"
    return sections


def build_displays(
    x11_nums: list[int],
    ports: dict[int, str],
    procs: list[dict],
) -> list[dict]:
    """세 소스를 합쳐 디스플레이 목록을 만든다.

    디스플레이로 인정하는 근거는 **VNC 서버가 실제로 듣고 있는가** 이다:
      (a) 5900번대 리스닝 포트, 또는
      (b) ``Xvnc``/``Xtigervnc`` 프로세스의 ``:N`` 인자.

    X11 소켓(``/tmp/.X11-unix/X0``)은 데스크탑이 도는 기계라면 항상 존재하므로 단독
    근거로 쓰지 않는다 — VNC 와 무관한 ``:0`` 이 목록에 올라 5900 연결 거부로 끝난다.
    소켓 정보는 보조 근거로만 쓴다(현재는 부가 정보 없이 포트/프로세스 기반만 목록에 넣음).
    포트는 ``5900 + display``. 프로세스 메타(server/user/geometry)는 display 가
    일치하는 프로세스에서 보강한다.
    """
    display_set: set[int] = set()
    for p in procs:
        if p["display"] is not None:
            display_set.add(p["display"])
    for port in ports:
        d = port - _VNC_PORT_LO
        if 0 <= d <= 99:
            display_set.add(d)

    out: list[dict] = []
    for d in sorted(display_set):
        port = _VNC_PORT_LO + d
        proc = next((p for p in procs if p["display"] == d), None)
        out.append({
            "display": d,
            "port": port,
            "bind": ports.get(port, ""),
            "server": proc["server"] if proc else "",
            "user": proc["user"] if proc else "",
            "geometry": proc["geometry"] if proc else "",
        })
    return out


# 배포판 → VNC 서버 설치 명령. 미설치 호스트에 "어떻게 깔면 되는지" 를 알려주기 위한 것.
# 패키지명은 배포판마다 다르다 — tigervnc-standalone-server(데비안 계열) vs tigervnc-server(RH 계열).
_INSTALL_BY_DISTRO = {
    "ubuntu": "sudo apt install tigervnc-standalone-server",
    "debian": "sudo apt install tigervnc-standalone-server",
    "raspbian": "sudo apt install tigervnc-standalone-server",
    "linuxmint": "sudo apt install tigervnc-standalone-server",
    "pop": "sudo apt install tigervnc-standalone-server",
    "fedora": "sudo dnf install tigervnc-server",
    "rhel": "sudo dnf install tigervnc-server",
    "centos": "sudo dnf install tigervnc-server",
    "rocky": "sudo dnf install tigervnc-server",
    "almalinux": "sudo dnf install tigervnc-server",
    "arch": "sudo pacman -S tigervnc",
    "manjaro": "sudo pacman -S tigervnc",
    "alpine": "sudo apk add tigervnc",
    "opensuse-tumbleweed": "sudo zypper install tigervnc",
    "opensuse-leap": "sudo zypper install tigervnc",
}


def parse_env(text: str) -> dict:
    """ENV 섹션 → {distro, install_cmd, has_desktop}.

    ``has_desktop`` 이 거짓이면 VNC 만 깔아도 세션이 뜨자마자 죽는다 — TigerVNC 는
    세션 스크립트가 끝나면 서버를 같이 내리기 때문이다. 그래서 설치 안내에
    데스크탑도 함께 언급해야 한다.
    """
    distro = ""
    has_desktop = False
    for line in (text or "").splitlines():
        line = line.strip()
        if line.startswith("ID:"):
            distro = line[3:].strip().strip('"')
        elif line.startswith("XSESSIONS:"):
            has_desktop = bool(line[10:].strip())
    return {
        "distro": distro or None,
        "install_cmd": _INSTALL_BY_DISTRO.get(distro),
        "has_desktop": has_desktop,
    }


def discover(combined_output: str) -> dict:
    """통합 원격 출력 → 디스커버리 응답 dict (순수).

    ``available`` 은 "원격 조회 자체가 됐다" — 설치 여부와 무관. ``installed`` 는
    vncserver/Xtigervnc 바이너리 유무. ``vncserver_path`` 는 발견된 경로(없으면
    None), ``flavor`` 는 turbovnc/tigervnc(미설치 시 빈 문자열), ``gpu`` 는
    호스트 수준의 GPU 가속 능력 정보.
    """
    sections = split_sections(combined_output)
    x11 = parse_x11_unix(sections["x11"])
    ports = parse_listening_ports(sections["ss"])
    procs = parse_vnc_processes(sections["ps"])
    vncserver_path = parse_vncserver_path(sections["which"])
    installed = vncserver_path is not None
    flavor = detect_flavor(vncserver_path)
    gpu = parse_gpu(sections["gpu"])
    has_vnc_passwd = parse_has_vnc_passwd(sections["passwd"])
    env = parse_env(sections.get("env", ""))
    return {
        "available": True,
        "installed": installed,
        "vncserver_path": vncserver_path,
        "flavor": flavor,
        "gpu": gpu,
        "has_vnc_passwd": has_vnc_passwd,
        "distro": env["distro"],
        "install_cmd": env["install_cmd"],
        "has_desktop": env["has_desktop"],
        "displays": build_displays(x11, ports, procs),
    }


async def gather_discovery(run: Callable[[str], Awaitable[str]]) -> dict:
    """runner 로 DISCOVERY_CMD 를 돌려 discover() 한다.

    runner 는 ``async (cmd: str) -> str`` (stdout). SSH 실패/타임아웃 시
    ``available: False`` + 에러 메시지로 내려 UI 가 스스로 비활성화하게 한다.
    """
    try:
        output = await run(DISCOVERY_CMD)
    except Exception as e:  # 연결 실패·타임아웃 등 — 500 대신 available:false.
        return {
            "available": False,
            "installed": False,
            "vncserver_path": None,
            "flavor": "",
            "gpu": {"nvidia": False, "virtualgl": False, "vendor": None, "renderer_hint": "software"},
            "has_vnc_passwd": False,
            "distro": None,
            "install_cmd": None,
            "has_desktop": False,
            "displays": [],
            "error": str(e),
        }
    result = discover(output)
    return result

"""VNC 디스커버리 파서 — 실제 ss / ps / ls 출력을 고정 샘플로 넣고 검증 (SSH 불필요).

gather_discovery 의 SSH 레이어는 runner 를 주입받으므로 여기서는 순수 파싱만 검증한다.
커버: 디스플레이 0개 / 1개 / 여러 개 / ss 부재 폴백 / geometry 인자 없는 프로세스.
"""
import pytest

from vnc_discovery import (
    _GPU_MARK,
    _PASSWD_MARK,
    _PS_MARK,
    _SS_MARK,
    _WHICH_MARK,
    _X11_MARK,
    DISCOVERY_CMD,
    build_displays,
    detect_flavor,
    discover,
    gather_discovery,
    parse_gpu,
    parse_has_vnc_passwd,
    parse_installed,
    parse_listening_ports,
    parse_vnc_processes,
    parse_vncserver_path,
    parse_x11_unix,
)


def _combined(
    x11: str = "", ss: str = "", ps: str = "", which: str = "", gpu: str = "", passwd: str = ""
) -> str:
    """테스트용 통합 출력 조립 — 마커 포함."""
    return (
        f"{_X11_MARK}\n{x11}"
        f"{_SS_MARK}\n{ss}"
        f"{_PS_MARK}\n{ps}"
        f"{_WHICH_MARK}\n{which}"
        f"{_GPU_MARK}\n{gpu}"
        f"{_PASSWD_MARK}\n{passwd}"
    )


# ---------------------- 단위 파서 ----------------------


def test_parse_x11_unix_extracts_display_numbers():
    assert parse_x11_unix("X0\nX1\nX5\n") == [0, 1, 5]
    assert parse_x11_unix("X11\n") == [11]
    assert parse_x11_unix("") == []
    # X 접두사 없거나 숫자 아닌 건 무시
    assert parse_x11_unix("X\nXabc\nY2\n") == []


def test_parse_listening_ports_ss_format():
    out = parse_listening_ports(
        "LISTEN 0 128 127.0.0.1:5901 0.0.0.0:*\n"
        "LISTEN 0 128 0.0.0.0:22 0.0.0.0:*\n"
        "LISTEN 0 128 127.0.0.1:5905 0.0.0.0:*\n"
    )
    assert out == {5901: "127.0.0.1", 5905: "127.0.0.1"}


def test_parse_listening_ports_netstat_format():
    """ss 가 없을 때 netstat -ltn 폴백 출력도 같은 파서로 잡힌다."""
    out = parse_listening_ports(
        "Proto Recv-Q Send-Q Local Address Foreign Address State\n"
        "tcp 0 0 127.0.0.1:5901 0.0.0.0:* LISTEN\n"
        "tcp6 0 0 :::5902 :::* LISTEN\n"
        "tcp 0 0 0.0.0.0:22 0.0.0.0:* LISTEN\n"
    )
    assert out == {5901: "127.0.0.1", 5902: "::"}


def test_parse_listening_ports_ignores_non_vnc_range():
    assert parse_listening_ports("LISTEN 0 128 0.0.0.0:8080 0.0.0.0:*\n") == {}
    assert parse_listening_ports("LISTEN 0 128 0.0.0.0:5899 0.0.0.0:*\n") == {}
    assert parse_listening_ports("LISTEN 0 128 0.0.0.0:6000 0.0.0.0:*\n") == {}


def test_parse_vnc_processes_with_geometry():
    ps = (
        "  PID USER COMMAND\n"
        " 1234 ubuntu Xtigervnc :1 -localhost yes -geometry 1920x1080 -depth 24\n"
        " 5678 root Xtigervnc :2 -localhost yes -geometry 1366x768\n"
    )
    procs = parse_vnc_processes(ps)
    assert len(procs) == 2
    p1 = next(p for p in procs if p["display"] == 1)
    assert p1["pid"] == 1234
    assert p1["user"] == "ubuntu"
    assert p1["server"] == "Xtigervnc"
    assert p1["geometry"] == "1920x1080"


def test_parse_vnc_processes_without_geometry():
    """-geometry 인자가 없는 프로세스 — geometry 는 빈 문자열."""
    ps = "9 root Xvnc :3 -localhost yes\n"
    procs = parse_vnc_processes(ps)
    assert len(procs) == 1
    assert procs[0]["server"] == "Xvnc"
    assert procs[0]["display"] == 3
    assert procs[0]["geometry"] == ""


def test_parse_vnc_processes_without_display_token():
    """:N 토큰이 없는 프로세스 — display 는 None."""
    ps = "42 ubuntu Xtigervnc -localhost yes\n"
    procs = parse_vnc_processes(ps)
    assert len(procs) == 1
    assert procs[0]["display"] is None


def test_parse_vnc_processes_ignores_non_vnc():
    ps = "1 root /sbin/init\n2 root khugepaged\n"
    assert parse_vnc_processes(ps) == []


def test_parse_vnc_processes_long_username_user32_format():
    """user:32 컬럼 폭 — 긴 사용자명이 공백 패딩과 함께 나온다.

    기본 ``user`` 컬럼은 8자 제한이라 ``jshsaku+`` 처럼 잘리지만, ``user:32`` 는
    32자 폭으로 패딩만 추가하고 이름은 온전히 나온다. ``split(None, 2)`` 가 연속
    공백을 하나로 collapses 하므로 패딩에 영향받지 않는다.
    """
    # user:32 출력 시뮬레이션 — "jshsaku" 뒤에 32-7=25개 공백
    ps = "12345 jshsaku                         Xtigervnc :1 -geometry 1920x1080\n"
    procs = parse_vnc_processes(ps)
    assert len(procs) == 1
    assert procs[0]["user"] == "jshsaku"
    assert procs[0]["display"] == 1


def test_parse_vnc_processes_truncated_username_old_format():
    """구형 user(8자) 출력 — ``jshsaku+`` 로 잘린 이름도 파싱 자체는 된다.

    user:32 마이그레이션 전의 출력과도 호환되어야 한다 (구 ps 출력을 캐시한 경우 등).
    """
    ps = "12345 jshsaku+ Xtigervnc :1 -geometry 1920x1080\n"
    procs = parse_vnc_processes(ps)
    assert len(procs) == 1
    assert procs[0]["user"] == "jshsaku+"


# ---------------------- 자기 탐지(유령 디스플레이) 방지 ----------------------


def test_parse_vnc_processes_excludes_discovery_command_itself():
    """ps 출력에 디스커버리 명령 자신의 줄이 포함되어도 유령이 나오면 안 된다.

    실제 ubuntu-ai 호스트에서 발견한 버그: 디스커버리 명령줄에 ``Xtigervnc``(후보
    경로 루프)와 ``:32``(``user:32``)가 같은 줄에 있어서 디스플레이 32번이 유령으로
    잡혔다. 두 겹 방어(exe basename + 마커 배제)로 잡는다.
    """
    # 실제 ps 출력에 포함되는 디스커버리 명령줄 시뮬레이션
    discovery_line = (
        "99999 jshsakura                         /bin/sh -c "
        f"echo {_X11_MARK}; ls -1 /tmp/.X11-unix/ 2>/dev/null; "
        f"echo {_SS_MARK}; (ss -ltnH 2>/dev/null || netstat -ltn 2>/dev/null); "
        f"echo {_PS_MARK}; ps -eo pid,user:32,args 2>/dev/null; "
        f"echo {_WHICH_MARK}; for p in vncserver /opt/TurboVNC/bin/vncserver "
        f"/usr/bin/vncserver /usr/local/bin/vncserver Xtigervnc; "
        f'do command -v "$p" 2>/dev/null && break; done'
    )
    # 정상 Xvnc 프로세스 한 줄 + 디스커버리 명령줄 한 줄
    ps = (
        f"{discovery_line}\n"
        "12345 jshsakura                         Xvnc :1 -localhost yes -geometry 1920x1080\n"
    )
    procs = parse_vnc_processes(ps)
    # 디스플레이 1만 잡히고, 디스플레이 32(유령)는 없어야 한다
    assert len(procs) == 1
    assert procs[0]["display"] == 1
    assert procs[0]["server"] == "Xvnc"


def test_parse_vnc_processes_user32_not_display_number():
    """``user:32`` 토큰이 디스플레이 번호 ``:32`` 로 오인되지 않아야 한다.

    Layer 1(exe basename)이 이미 잡지만, 디스플레이 토큰 검사도 독립적으로
    검증한다 — 첫 토큰이 ``Xtigervnc`` 이더라도 ``user:32`` 는 standalone ``:N``
    토큰이 아니므로 display 에 잡히면 안 된다.
    """
    # 극단적 케이스: exe basename 이 맞지만 user:32 가 args 에 섞인 경우
    # (실제로는 발생하지 않지만 디스플레이 토큰 로직을 독립 검증)
    ps = "12345 ubuntu Xtigervnc -localhost yes user:32 :1 -geometry 1920x1080\n"
    procs = parse_vnc_processes(ps)
    assert len(procs) == 1
    assert procs[0]["display"] == 1  # :1, not :32


def test_parse_vnc_processes_absolute_path_exe():
    """실행 파일이 절대경로(``/opt/TurboVNC/bin/Xvnc``)여도 잡힌다."""
    ps = "1111 ubuntu /opt/TurboVNC/bin/Xvnc :1 -geometry 1920x1080\n"
    procs = parse_vnc_processes(ps)
    assert len(procs) == 1
    assert procs[0]["server"] == "Xvnc"
    assert procs[0]["display"] == 1


def test_parse_vnc_processes_path_exe_xtigervnc():
    """PATH 실행(``Xtigervnc`` 직접)도 잡힌다."""
    ps = "2222 root Xtigervnc :2 -localhost yes -geometry 1366x768\n"
    procs = parse_vnc_processes(ps)
    assert len(procs) == 1
    assert procs[0]["server"] == "Xtigervnc"
    assert procs[0]["display"] == 2


def test_parse_vnc_processes_rejects_wrapper_script():
    """``vncserver`` 래퍼 스크립트는 실제 X 서버가 아니다 — 잡히면 안 된다."""
    ps = "3333 ubuntu vncserver :1 -localhost yes -geometry 1280x800\n"
    assert parse_vnc_processes(ps) == []


def test_parse_vnc_processes_rejects_marker_only_line():
    """마커가 포함된 줄은 우리 명령이므로 통째로 버린다 — exe basename 과 무관."""
    ps = f"4444 ubuntu Xtigervnc :5 -geometry 1920x1080 {_X11_MARK} something\n"
    assert parse_vnc_processes(ps) == []


def test_parse_installed():
    assert parse_installed("/usr/bin/vncserver\n/usr/bin/Xtigervnc\n") is True
    assert parse_installed("/usr/bin/Xtigervnc\n") is True
    assert parse_installed("") is False
    assert parse_installed("   \n") is False


def test_parse_vncserver_path_turbovnc():
    """TurboVNC 절대경로가 WHICH 섹션 첫 줄에 오면 그 경로를 돌려준다."""
    path = parse_vncserver_path("/opt/TurboVNC/bin/vncserver\n")
    assert path == "/opt/TurboVNC/bin/vncserver"
    assert detect_flavor(path) == "turbovnc"


def test_parse_vncserver_path_path_only():
    """PATH 기반 vncserver 경로 — flavor 는 tigervnc."""
    path = parse_vncserver_path("/usr/bin/vncserver\n")
    assert path == "/usr/bin/vncserver"
    assert detect_flavor(path) == "tigervnc"


def test_parse_vncserver_path_neither():
    """빈 WHICH 섹션 → None, flavor 도 빈 문자열."""
    assert parse_vncserver_path("") is None
    assert parse_vncserver_path("   \n") is None
    assert detect_flavor(None) == ""


def test_parse_gpu_present():
    """vglrun + nvidia-smi 모두 있으면 renderer_hint = gpu, vendor = nvidia."""
    out = parse_gpu("VGL:/usr/bin/vglrun\nNSMI:yes\nVGA:NVIDIA Corporation [GPU]\n")
    assert out["nvidia"] is True
    assert out["virtualgl"] is True
    assert out["vendor"] == "nvidia"
    assert out["renderer_hint"] == "gpu"


def test_parse_gpu_absent():
    """빈 GPU 섹션 → 전부 거짓, software, vendor None."""
    out = parse_gpu("")
    assert out["nvidia"] is False
    assert out["virtualgl"] is False
    assert out["vendor"] is None
    assert out["renderer_hint"] == "software"


def test_parse_gpu_nvidia_smi_fails():
    """nvidia-smi 실패 + vglrun 없음 + VGA 도 없으면 → software, vendor None."""
    out = parse_gpu("VGL:\nNSMI:no\n")
    assert out["nvidia"] is False
    assert out["virtualgl"] is False
    assert out["vendor"] is None
    assert out["renderer_hint"] == "software"


def test_parse_gpu_vgl_only_no_nvidia():
    """vglrun 만 있고 GPU 자체가 없으면 가속 불가 → software, vendor None."""
    out = parse_gpu("VGL:/usr/bin/vglrun\nNSMI:no\n")
    assert out["virtualgl"] is True
    assert out["nvidia"] is False
    assert out["vendor"] is None
    assert out["renderer_hint"] == "software"


def test_parse_gpu_amd_with_vgl():
    """AMD GPU (lspci 로만 감지) + vglrun → renderer_hint = gpu (NVIDIA 버그 수정)."""
    out = parse_gpu(
        "VGL:/usr/bin/vglrun\nNSMI:no\n"
        "VGA:VGA compatible controller: Advanced Micro Devices, Inc. [AMD/ATI] Renoir\n"
    )
    assert out["nvidia"] is False
    assert out["virtualgl"] is True
    assert out["vendor"] == "amd"
    assert out["renderer_hint"] == "gpu"


def test_parse_gpu_intel_with_vgl():
    """Intel GPU (lspci 로만 감지) + vglrun → renderer_hint = gpu."""
    out = parse_gpu(
        "VGL:/usr/bin/vglrun\nNSMI:no\n"
        "VGA:VGA compatible controller: Intel Corporation UHD Graphics 620\n"
    )
    assert out["nvidia"] is False
    assert out["virtualgl"] is True
    assert out["vendor"] == "intel"
    assert out["renderer_hint"] == "gpu"


def test_parse_gpu_amd_without_vgl():
    """AMD GPU 있지만 vglrun 없으면 → software (GPU 있어도 가속 불가)."""
    out = parse_gpu(
        "VGL:\nNSMI:no\n"
        "VGA:VGA compatible controller: Advanced Micro Devices, Inc. [AMD/ATI] Navi\n"
    )
    assert out["vendor"] == "amd"
    assert out["virtualgl"] is False
    assert out["renderer_hint"] == "software"


def test_parse_gpu_radeon_keyword():
    """'radeon' 키워드로 AMD 벤더 감지."""
    out = parse_gpu("VGL:\nNSMI:no\nVGA:VGA compatible controller: ATI Radeon HD\n")
    assert out["vendor"] == "amd"


def test_parse_gpu_unknown_vendor():
    """VGA 컨트롤러가 있으나 벤더 키워드를 모르면 vendor = unknown."""
    out = parse_gpu("VGL:\nNSMI:no\nVGA:VGA compatible controller: MysteryCo GPU\n")
    assert out["vendor"] == "unknown"
    assert out["renderer_hint"] == "software"


# ---------------------- 통합 discover() ----------------------


def test_discover_no_displays():
    out = discover(_combined(which="/usr/bin/vncserver\n"))
    assert out["available"] is True
    assert out["installed"] is True
    assert out["displays"] == []


def test_discover_single_display():
    out = discover(_combined(
        x11="X1\n",
        ss="LISTEN 0 128 127.0.0.1:5901 0.0.0.0:*\n",
        ps="1234 ubuntu Xtigervnc :1 -localhost yes -geometry 1920x1080\n",
        which="/usr/bin/vncserver\n/usr/bin/Xtigervnc\n",
    ))
    assert out["installed"] is True
    assert len(out["displays"]) == 1
    d = out["displays"][0]
    assert d["display"] == 1
    assert d["port"] == 5901
    assert d["server"] == "Xtigervnc"
    assert d["user"] == "ubuntu"
    assert d["geometry"] == "1920x1080"
    assert d["bind"] == "127.0.0.1"


def test_discover_multiple_displays():
    out = discover(_combined(
        x11="X1\nX2\nX5\n",
        ss=(
            "LISTEN 0 128 127.0.0.1:5901 0.0.0.0:*\n"
            "LISTEN 0 128 127.0.0.1:5902 0.0.0.0:*\n"
            "LISTEN 0 128 127.0.0.1:5905 0.0.0.0:*\n"
        ),
        ps=(
            "1111 a Xtigervnc :1 -geometry 1920x1080\n"
            "2222 b Xtigervnc :2 -geometry 1280x800\n"
            "3333 c Xtigervnc :5 -geometry 2560x1440\n"
        ),
        which="/usr/bin/Xtigervnc\n",
    ))
    nums = [d["display"] for d in out["displays"]]
    assert nums == [1, 2, 5]
    assert all(d["port"] == 5900 + d["display"] for d in out["displays"])


def test_discover_display_from_port_only():
    """X11 소켓이 사라졌어도 리스닝 포트+프로세스로 디스플레이를 잡아낸다."""
    out = discover(_combined(
        x11="",
        ss="LISTEN 0 128 127.0.0.1:5901 0.0.0.0:*\n",
        ps="1234 ubuntu Xtigervnc :1 -geometry 1280x800\n",
        which="/usr/bin/Xtigervnc\n",
    ))
    assert [d["display"] for d in out["displays"]] == [1]


def test_discover_ss_absent_netstat_fallback():
    """ss 가 없으면 netstat 출력이 ss 섹션에 들어간다 (폴백 경로)."""
    out = discover(_combined(
        x11="X1\n",
        ss="tcp 0 0 127.0.0.1:5901 0.0.0.0:* LISTEN\n",
        ps="1234 ubuntu Xtigervnc :1 -geometry 1280x800\n",
        which="/usr/bin/Xtigervnc\n",
    ))
    d = out["displays"][0]
    assert d["port"] == 5901
    assert d["bind"] == "127.0.0.1"


def test_discover_with_gpu_and_turbovnc():
    """TurboVNC 경로 + GPU 모두 있을 때 discover() 가 호스트 수준 필드를 채운다."""
    out = discover(_combined(
        x11="X1\n",
        ss="LISTEN 0 128 127.0.0.1:5901 0.0.0.0:*\n",
        ps="1234 ubuntu Xvnc :1 -geometry 1280x800\n",
        which="/opt/TurboVNC/bin/vncserver\n",
        gpu="VGL:/usr/bin/vglrun\nNSMI:yes\nVGA:NVIDIA\n",
    ))
    assert out["vncserver_path"] == "/opt/TurboVNC/bin/vncserver"
    assert out["flavor"] == "turbovnc"
    assert out["gpu"]["renderer_hint"] == "gpu"
    assert out["installed"] is True
    assert [d["display"] for d in out["displays"]] == [1]


def test_discover_empty_gpu_section_displays_still_parsed():
    """GPU 섹션이 비어 있어도 디스플레이 파싱은 정상, gpu 는 software."""
    out = discover(_combined(
        x11="X1\nX2\n",
        ss=(
            "LISTEN 0 128 127.0.0.1:5901 0.0.0.0:*\n"
            "LISTEN 0 128 127.0.0.1:5902 0.0.0.0:*\n"
        ),
        ps=(
            "1 a Xtigervnc :1 -geometry 1280x800\n"
            "2 b Xtigervnc :2 -geometry 1920x1080\n"
        ),
        which="/usr/bin/vncserver\n",
        gpu="",  # GPU 정보 없음
    ))
    assert [d["display"] for d in out["displays"]] == [1, 2]
    assert out["gpu"]["renderer_hint"] == "software"
    assert out["gpu"]["nvidia"] is False


def test_discover_uninstalled_host():
    """vncserver/Xtigervnc 바이너리가 없어도 available 은 True."""
    out = discover(_combined())  # which 섹션 비움
    assert out["available"] is True
    assert out["installed"] is False
    assert out["displays"] == []


def test_build_displays_merges_three_sources():
    """X11 소켓만으로는 디스플레이로 인정하지 않는다 — 포트 또는 프로세스가 있어야 함."""
    displays = build_displays(
        x11_nums=[1],
        ports={5902: "127.0.0.1"},
        procs=[{"pid": 9, "user": "u", "server": "Xvnc", "display": 3, "geometry": "800x600"}],
    )
    nums = [d["display"] for d in displays]
    assert nums == [2, 3]  # :1(X11 단독) 제외, :2(포트), :3(프로세스)
    by_disp = {d["display"]: d for d in displays}
    assert by_disp[2]["bind"] == "127.0.0.1"  # 포트로만 발견
    assert by_disp[3]["server"] == "Xvnc"     # 프로세스로 발견


# ── X11 소켓 단독은 디스플레이에서 제외 (VNC 서버가 실제로 듣고 있는가) ──────────


def test_build_displays_excludes_x11_only_socket():
    """X11 소켓만 있고 5900번대 리스닝도 Xvnc 프로세스도 없음 → 목록에서 제외."""
    displays = build_displays(
        x11_nums=[0, 1],
        ports={},
        procs=[],
    )
    assert displays == []


def test_build_displays_includes_port_only_no_socket():
    """리스닝만 있고 소켓이 없음 → 포함."""
    displays = build_displays(
        x11_nums=[],
        ports={5901: "127.0.0.1"},
        procs=[],
    )
    assert len(displays) == 1
    assert displays[0]["display"] == 1
    assert displays[0]["port"] == 5901
    assert displays[0]["bind"] == "127.0.0.1"


def test_build_displays_includes_proc_only_no_port():
    """Xvnc 프로세스만 잡히고 리스닝을 못 읽음(ss/netstat 없는 환경) → 포함."""
    displays = build_displays(
        x11_nums=[],
        ports={},
        procs=[{"pid": 42, "user": "pi", "server": "Xtigervnc", "display": 2, "geometry": "1920x1080"}],
    )
    assert len(displays) == 1
    assert displays[0]["display"] == 2
    assert displays[0]["server"] == "Xtigervnc"
    assert displays[0]["geometry"] == "1920x1080"


def test_build_displays_all_three_sources_present():
    """셋 다 있는 정상 케이스 → 포함, 기존 필드 유지."""
    displays = build_displays(
        x11_nums=[1],
        ports={5901: "127.0.0.1"},
        procs=[{"pid": 42, "user": "pi", "server": "Xtigervnc", "display": 1, "geometry": "1920x1080"}],
    )
    assert len(displays) == 1
    d = displays[0]
    assert d["display"] == 1
    assert d["port"] == 5901
    assert d["bind"] == "127.0.0.1"
    assert d["server"] == "Xtigervnc"
    assert d["user"] == "pi"
    assert d["geometry"] == "1920x1080"


# ---------------------- gather_discovery (runner 주입) ----------------------


@pytest.mark.asyncio
async def test_gather_discovery_passes_discovery_cmd():
    """runner 에게 정확히 DISCOVERY_CMD 를 넘긴다."""
    captured = {}

    async def fake_run(cmd):
        captured["cmd"] = cmd
        return _combined(which="/usr/bin/Xtigervnc\n")

    out = await gather_discovery(fake_run)
    assert captured["cmd"] == DISCOVERY_CMD
    assert out["available"] is True
    assert out["installed"] is True


@pytest.mark.asyncio
async def test_gather_discovery_runner_failure_returns_available_false():
    """SSH 실패/타임아웃 시 500 대신 available:false 로 내린다."""
    async def boom(_cmd):
        raise TimeoutError("ssh connect timed out")

    out = await gather_discovery(boom)
    assert out["available"] is False
    assert out["displays"] == []
    assert "timed out" in out["error"]


@pytest.mark.asyncio
async def test_gather_discovery_error_includes_gpu_defaults():
    """runner 예외 시에도 gpu 기본값 + vncserver_path None 이 내려간다."""
    async def boom(_cmd):
        raise OSError("connection refused")

    out = await gather_discovery(boom)
    assert out["available"] is False
    assert out["vncserver_path"] is None
    assert out["flavor"] == ""
    assert out["gpu"]["renderer_hint"] == "software"
    assert out["gpu"]["nvidia"] is False
    assert out["gpu"]["virtualgl"] is False
    assert out["gpu"]["vendor"] is None
    assert out["has_vnc_passwd"] is False


# ---------------------- has_vnc_passwd 파서 ----------------------


def test_parse_has_vnc_passwd_yes():
    """passwd 파일 존재 → True."""
    assert parse_has_vnc_passwd("yes\n") is True


def test_parse_has_vnc_passwd_no():
    """passwd 파일 부재 → False."""
    assert parse_has_vnc_passwd("no\n") is False


def test_parse_has_vnc_passwd_empty():
    """빈 출력 → False (test 명령 자체가 실패한 경우)."""
    assert parse_has_vnc_passwd("") is False
    assert parse_has_vnc_passwd("\n") is False


def test_discover_includes_has_vnc_passwd():
    """discover() 응답에 has_vnc_passwd 필드가 포함된다."""
    combined = _combined(
        which="/opt/TurboVNC/bin/vncserver\n",
        passwd="yes\n",
    )
    out = discover(combined)
    assert out["has_vnc_passwd"] is True


def test_discover_has_vnc_passwd_false_when_absent():
    """passwd 섹션이 no 이면 has_vnc_passwd=False."""
    combined = _combined(
        which="/opt/TurboVNC/bin/vncserver\n",
        passwd="no\n",
    )
    out = discover(combined)
    assert out["has_vnc_passwd"] is False


def test_discover_has_vnc_passwd_defaults_false_when_section_missing():
    """passwd 섹션이 통합 출력에 없어도 기본값 False 로 안전."""
    # passwd 인자를 주지 않으면 _combined 기본값 "" → parse_has_vnc_passwd("") → False
    combined = _combined(which="/usr/bin/Xtigervnc\n")
    out = discover(combined)
    assert out["has_vnc_passwd"] is False

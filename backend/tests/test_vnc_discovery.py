"""VNC 디스커버리 파서 — 실제 ss / ps / ls 출력을 고정 샘플로 넣고 검증 (SSH 불필요).

gather_discovery 의 SSH 레이어는 runner 를 주입받으므로 여기서는 순수 파싱만 검증한다.
커버: 디스플레이 0개 / 1개 / 여러 개 / ss 부재 폴백 / geometry 인자 없는 프로세스.
"""
import pytest

from vnc_discovery import (
    _GPU_MARK,
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
    parse_installed,
    parse_listening_ports,
    parse_vnc_processes,
    parse_vncserver_path,
    parse_x11_unix,
)


def _combined(x11: str = "", ss: str = "", ps: str = "", which: str = "", gpu: str = "") -> str:
    """테스트용 통합 출력 조립 — 마커 포함."""
    return (
        f"{_X11_MARK}\n{x11}"
        f"{_SS_MARK}\n{ss}"
        f"{_PS_MARK}\n{ps}"
        f"{_WHICH_MARK}\n{which}"
        f"{_GPU_MARK}\n{gpu}"
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
    displays = build_displays(
        x11_nums=[1],
        ports={5902: "127.0.0.1"},
        procs=[{"pid": 9, "user": "u", "server": "Xvnc", "display": 3, "geometry": "800x600"}],
    )
    nums = [d["display"] for d in displays]
    assert nums == [1, 2, 3]
    by_disp = {d["display"]: d for d in displays}
    assert by_disp[1]["server"] == ""        # X11 소켓만 있고 프로세스 정보 없음
    assert by_disp[2]["bind"] == "127.0.0.1"  # 포트로만 발견
    assert by_disp[3]["server"] == "Xvnc"     # 프로세스로 발견


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

"""연결(리모트 + itl)로 가는 **공개 표면은 하나다.**

⚠️ 실측 사고: 호스트 카드의 설치 버튼이 `remote-install` 로 가고 있었다. 그러면 그
버튼으로 깐 호스트는 리모트만 있고 `itl` 이 없어 **답장도 호출도 못 한다** — 화면에는
"설치됨" 으로 똑같이 보인다. 반쪽만 묻거나 반쪽만 까는 길이 남아 있으면, 어느 버튼을
눌렀는지에 따라 결과가 달라지는데 그 차이가 화면에 보이지 않는다.
"""
from pathlib import Path

_FRONT = Path(__file__).resolve().parents[2] / "frontend" / "src"

RETIRED = ("remote-install", "remote-status", "itl-setup", "itl-status")


def test_the_half_routes_are_gone():
    import main
    paths = {getattr(r, "path", "") for r in main.app.routes}
    for name in RETIRED:
        assert f"/api/hosts/{{host_id}}/{name}" not in paths, f"{name} 라우트가 남아 있다"


def test_both_buttons_go_to_the_same_place():
    """호스트 카드(⤓)와 호스트 편집기의 버튼이 같은 곳으로 가야 한다."""
    hook = (_FRONT / "hooks" / "useRemoteInstall.js").read_text(encoding="utf-8")
    section = (_FRONT / "components" / "hostEditor" / "HostAgentSection.jsx").read_text(encoding="utf-8")
    assert "agent-setup" in hook and "agent-setup" in section
    # URL 형태로만 본다 — 주석이 옛 이름을 **설명**하는 건 정상이고, 오히려 남겨야
    # 다음 사람이 왜 걷어냈는지 안다.
    for name in RETIRED:
        assert f"/{name}" not in hook, f"카드 버튼이 아직 {name} 로 간다 — 반쪽만 깔린다"


def test_the_frontend_calls_no_retired_route():
    for path in _FRONT.rglob("*.js*"):
        if path.suffix not in (".js", ".jsx") or ".test." in path.name:
            continue
        text = path.read_text(encoding="utf-8")
        for name in RETIRED:
            assert f"/{name}" not in text, f"{path.name} 이 걷어낸 {name} 를 부른다"

"""`.env` 로드가 앱 모듈 import 보다 먼저인지 잠근다.

이 저장소의 여러 모듈이 **import 시점에** `os.getenv` 를 읽는다(`sqlite_storage` 의
`DB_PATH`, `_deps` 의 `WORKSPACE_ROOT`, `tmux_manager` 의 `TMUX_SOCKET_NAME`,
`ssh_pool` 의 타임아웃들). `load_dotenv` 가 그 아래에 있으면 그 값들에는 `.env` 가 영영
닿지 않고, **에러 없이 조용히 기본값**으로 뜬다.

프로덕션은 systemd 의 `EnvironmentFile=.env` 가 가려 준다. 드러나는 곳은 `python run.py`
(dev) — 거기서 `TMUX_SOCKET_NAME` 이 기본값 `iterminallist-app`, 즉 **운영 소켓**으로
떨어진다. 개발용 인스턴스가 운영 tmux 서버와 DB 를 잡는다는 뜻이다. 2026-08-31 에
격리 인스턴스를 띄우다 실제로 그렇게 붙었다.
"""
import ast
import pathlib

BACKEND = pathlib.Path(__file__).resolve().parent.parent
MAIN = BACKEND / "main.py"

# import 시점에 os.getenv 를 읽는 모듈들 — 이들보다 load_dotenv 가 먼저여야 한다.
EAGER_ENV_MODULES = {"_deps", "sqlite_storage", "ssh_pool", "tmux_manager"}


def _load_dotenv_line(tree):
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "load_dotenv"
        ):
            return node.lineno
    return None


def _first_eager_import_line(tree):
    lines = []
    for node in ast.iter_child_nodes(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            root = node.module.split(".")[0]
            if root in EAGER_ENV_MODULES:
                lines.append((node.lineno, node.module))
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split(".")[0] in EAGER_ENV_MODULES:
                    lines.append((node.lineno, alias.name))
    return min(lines) if lines else None


def test_load_dotenv_runs_before_modules_that_read_env_at_import():
    tree = ast.parse(MAIN.read_text())

    dotenv_line = _load_dotenv_line(tree)
    assert dotenv_line is not None, "main.py 에서 load_dotenv 호출을 못 찾았다"

    first = _first_eager_import_line(tree)
    assert first is not None, (
        "import 시점에 env 를 읽는 모듈이 main.py 에서 사라졌다면 EAGER_ENV_MODULES 를 갱신할 것"
    )
    line, module = first

    assert dotenv_line < line, (
        f"load_dotenv 가 {dotenv_line}행인데 `{module}` import 가 {line}행이다.\n"
        f"그 모듈은 import 시점에 os.getenv 를 읽으므로, 이 순서면 .env 값이 조용히 무시된다."
    )


def test_eager_modules_still_read_env_at_import_time():
    """위 테스트의 전제 자체를 검사한다.

    그 모듈들이 언젠가 지연 읽기로 바뀌면 이 목록은 낡은 것이고, 그때는 위 테스트가
    지키는 것이 없으면서 통과만 한다.
    """
    still_eager = []
    for name in EAGER_ENV_MODULES:
        tree = ast.parse((BACKEND / f"{name}.py").read_text())
        for node in ast.iter_child_nodes(tree):          # 모듈 최상위만
            if any(
                isinstance(sub, ast.Call)
                and isinstance(sub.func, ast.Attribute)
                and sub.func.attr == "getenv"
                for sub in ast.walk(node)
            ):
                still_eager.append(name)
                break
    assert sorted(still_eager) == sorted(EAGER_ENV_MODULES), (
        f"import 시점 env 읽기가 사라진 모듈: {sorted(set(EAGER_ENV_MODULES) - set(still_eager))}"
    )

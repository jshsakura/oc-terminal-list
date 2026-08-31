"""SQLiteStorage 믹스인 합성이 실제로 동작하는지 — 도메인마다 최소 1회 왕복.

왜 필요한가: 저장소를 db/ 아래 믹스인으로 쪼갠 뒤, 어느 한 믹스인을 합성에서
빠뜨려도 import 는 멀쩡히 성공하고 ruff 도 통과한다. 해당 메서드를 실제로 부르는
경로가 실행될 때가 돼서야 AttributeError 로 터진다 — 그때는 이미 운영 중이다.
"""
import pytest

from sqlite_storage import SQLiteStorage


@pytest.fixture
def storage(tmp_path):
    s = SQLiteStorage(str(tmp_path / "t.db"))   # SchemaMixin 이 전 테이블 생성
    yield s


@pytest.mark.anyio
async def test_admin_roundtrip(storage):
    assert await storage.create_admin("u", "hash") is True
    assert (await storage.get_admin())["username"] == "u"


@pytest.mark.anyio
async def test_session_roundtrip(storage):
    await storage.create_session("sess1", "u", cwd="/tmp", name="n")
    assert await storage.get_session_owner("sess1") == "u"


@pytest.mark.anyio
async def test_host_roundtrip(storage):
    await storage.upsert_host("h1", "u", name="box", hostname="1.2.3.4")
    assert (await storage.get_host("h1", "u"))["name"] == "box"


@pytest.mark.anyio
async def test_user_prefs_and_tab_state_roundtrip(storage):
    await storage.save_user_settings("u", {"theme": "dark"})
    assert (await storage.get_user_settings("u"))["theme"] == "dark"
    assert await storage.save_tab_state("u", [{"id": "t1"}], "t1")
    assert (await storage.get_tab_state("u"))["activeTabId"] == "t1"


@pytest.mark.anyio
async def test_app_config_roundtrip(storage):
    await storage.set_config("k", "v")
    assert await storage.get_config("k") == "v"


@pytest.mark.anyio
async def test_command_history_roundtrip(storage):
    await storage.push_command_history("u", "term1", "ls -al")
    rows = await storage.get_command_history("u", "term1")
    assert any("ls -al" in str(r) for r in rows)


@pytest.mark.anyio
async def test_snippet_roundtrip(storage):
    await storage.create_snippet("u", "sn1", "name", "cmd")
    assert any(x["id"] == "sn1" for x in await storage.list_snippets("u"))


@pytest.mark.anyio
async def test_tool_roundtrip(storage):
    await storage.create_tool("u", "t1", "herdr", "curl x | sh", check_command="command -v herdr")
    rows = await storage.list_tools("u")
    assert any(x["id"] == "t1" and x["check_command"] == "command -v herdr" for x in rows)
    assert await storage.update_tool("u", "t1", name="herdr2")
    assert await storage.delete_tool("u", "t1")
    assert await storage.list_tools("u") == []


@pytest.mark.anyio
async def test_list_endpoints_are_reachable(storage):
    """ssh_keys/passkeys/usage — 빈 상태 조회만으로도 믹스인 합류 여부는 증명된다."""
    assert await storage.list_ssh_keys("u") == []
    assert await storage.list_passkey_credentials("u") == []
    assert isinstance(await storage.get_usage_summary("u"), dict)

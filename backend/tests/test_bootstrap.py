"""
bootstrap.register_bootstrap_host 의 시나리오:

  0) BOOTSTRAP_HOST_ENABLE 안 켜져 있음 → no-op (기본 OFF, opt-in)
  1) key 파일 없음 → no-op (자동등록 미사용 정상 경로)
  2) key 있으나 admin 미설정 → silent skip
  3) 같은 name 호스트 이미 등록 → idempotent skip
  4) 정상 등록 + tmux probe 성공 → use_remote_tmux=1
  5) 정상 등록 + tmux probe 실패 → use_remote_tmux=0 (사용자가 SSH 들어가 설치 후 토글)
"""
from unittest.mock import AsyncMock, patch

import pytest

import bootstrap


@pytest.fixture
def storage_mock():
    with patch.object(bootstrap, "storage", autospec=False) as m:
        m.get_admin = AsyncMock(return_value={"username": "admin"})
        m.list_hosts = AsyncMock(return_value=[])
        m.list_ssh_keys = AsyncMock(return_value=[])
        m.create_ssh_key = AsyncMock(return_value=None)
        m.upsert_host = AsyncMock(return_value=None)
        yield m


@pytest.fixture(autouse=True)
def _enable_bootstrap(monkeypatch):
    """모든 시나리오는 opt-in 게이트가 켜진 상태를 가정. (별도 OFF 케이스만 직접 unset)"""
    monkeypatch.setenv("BOOTSTRAP_HOST_ENABLE", "1")


@pytest.fixture
def tmp_key(tmp_path):
    key = tmp_path / "ssh-key"
    key.write_text("-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----\n")
    return str(key)


@pytest.mark.asyncio
async def test_skip_when_key_file_missing(storage_mock, monkeypatch):
    monkeypatch.setenv("BOOTSTRAP_HOST_KEY_PATH", "/nonexistent/key/path")
    await bootstrap.register_bootstrap_host()
    storage_mock.upsert_host.assert_not_awaited()
    storage_mock.get_admin.assert_not_awaited()


@pytest.mark.asyncio
async def test_skip_when_admin_not_set_up(storage_mock, monkeypatch, tmp_key):
    monkeypatch.setenv("BOOTSTRAP_HOST_KEY_PATH", tmp_key)
    storage_mock.get_admin.return_value = None
    await bootstrap.register_bootstrap_host()
    storage_mock.upsert_host.assert_not_awaited()


@pytest.mark.asyncio
async def test_idempotent_when_host_already_registered(storage_mock, monkeypatch, tmp_key):
    monkeypatch.setenv("BOOTSTRAP_HOST_KEY_PATH", tmp_key)
    storage_mock.list_hosts.return_value = [{"name": "Docker Host", "id": "existing"}]
    await bootstrap.register_bootstrap_host()
    storage_mock.upsert_host.assert_not_awaited()
    storage_mock.create_ssh_key.assert_not_awaited()


@pytest.mark.asyncio
async def test_registers_with_tmux_when_probe_says_yes(storage_mock, monkeypatch, tmp_key):
    monkeypatch.setenv("BOOTSTRAP_HOST_KEY_PATH", tmp_key)
    with patch.object(bootstrap, "_probe_remote_tmux", AsyncMock(return_value="yes")):
        await bootstrap.register_bootstrap_host()
    storage_mock.create_ssh_key.assert_awaited_once()
    storage_mock.upsert_host.assert_awaited_once()
    fields = storage_mock.upsert_host.await_args.kwargs
    assert fields["use_remote_tmux"] == 1
    assert fields["auth_method"] == "key"
    assert fields["hostname"] == "host.docker.internal"
    assert fields["ssh_user"] == "ubuntu"
    assert fields["name"] == "Docker Host"


@pytest.mark.asyncio
async def test_registers_without_tmux_when_probe_says_no(storage_mock, monkeypatch, tmp_key):
    monkeypatch.setenv("BOOTSTRAP_HOST_KEY_PATH", tmp_key)
    with patch.object(bootstrap, "_probe_remote_tmux", AsyncMock(return_value="no")):
        await bootstrap.register_bootstrap_host()
    # SSH 통과 + tmux 부재 — 사용자가 들어가 설치 후 토글
    storage_mock.upsert_host.assert_awaited_once()
    fields = storage_mock.upsert_host.await_args.kwargs
    assert fields["use_remote_tmux"] == 0


@pytest.mark.asyncio
async def test_registers_with_tmux_when_probe_unknown(storage_mock, monkeypatch, tmp_key):
    """MFA 등으로 SSH probe 실패 — tmux 있다고 가정해서 use_remote_tmux=1 (사용자 OTP 입력해 통과)."""
    monkeypatch.setenv("BOOTSTRAP_HOST_KEY_PATH", tmp_key)
    with patch.object(bootstrap, "_probe_remote_tmux", AsyncMock(return_value="unknown")):
        await bootstrap.register_bootstrap_host()
    storage_mock.upsert_host.assert_awaited_once()
    fields = storage_mock.upsert_host.await_args.kwargs
    assert fields["use_remote_tmux"] == 1


@pytest.mark.asyncio
async def test_env_overrides_defaults(storage_mock, monkeypatch, tmp_key):
    monkeypatch.setenv("BOOTSTRAP_HOST_KEY_PATH", tmp_key)
    monkeypatch.setenv("BOOTSTRAP_HOST_HOSTNAME", "10.0.0.5")
    monkeypatch.setenv("BOOTSTRAP_HOST_USER", "deploy")
    monkeypatch.setenv("BOOTSTRAP_HOST_PORT", "2222")
    monkeypatch.setenv("BOOTSTRAP_HOST_NAME", "Custom")
    monkeypatch.setenv("BOOTSTRAP_HOST_START_PATH", "/srv/app")
    with patch.object(bootstrap, "_probe_remote_tmux", AsyncMock(return_value="yes")):
        await bootstrap.register_bootstrap_host()
    fields = storage_mock.upsert_host.await_args.kwargs
    assert fields["hostname"] == "10.0.0.5"
    assert fields["ssh_user"] == "deploy"
    assert fields["port"] == 2222
    assert fields["name"] == "Custom"
    assert fields["start_path"] == "/srv/app"


@pytest.mark.asyncio
async def test_reuses_existing_bootstrap_key(storage_mock, monkeypatch, tmp_key):
    monkeypatch.setenv("BOOTSTRAP_HOST_KEY_PATH", tmp_key)
    storage_mock.list_ssh_keys.return_value = [
        {"id": "existing-key-id", "name": bootstrap.BOOTSTRAP_KEY_NAME}
    ]
    with patch.object(bootstrap, "_probe_remote_tmux", AsyncMock(return_value="yes")):
        await bootstrap.register_bootstrap_host()
    storage_mock.create_ssh_key.assert_not_awaited()
    fields = storage_mock.upsert_host.await_args.kwargs
    assert fields["key_id"] == "existing-key-id"


@pytest.mark.asyncio
async def test_skips_when_key_file_empty(storage_mock, monkeypatch, tmp_path):
    empty_key = tmp_path / "empty-key"
    empty_key.write_text("")
    monkeypatch.setenv("BOOTSTRAP_HOST_KEY_PATH", str(empty_key))
    await bootstrap.register_bootstrap_host()
    storage_mock.upsert_host.assert_not_awaited()


@pytest.mark.asyncio
async def test_skip_when_bootstrap_disabled(storage_mock, monkeypatch, tmp_key):
    """opt-in 게이트가 꺼져 있으면 키 파일이 있어도 아무것도 안 함."""
    monkeypatch.delenv("BOOTSTRAP_HOST_ENABLE", raising=False)
    monkeypatch.setenv("BOOTSTRAP_HOST_KEY_PATH", tmp_key)
    await bootstrap.register_bootstrap_host()
    storage_mock.upsert_host.assert_not_awaited()
    storage_mock.get_admin.assert_not_awaited()
    storage_mock.list_hosts.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("falsy", ["0", "false", "no", "off", "", "anything-else"])
async def test_bootstrap_enable_falsy_values(storage_mock, monkeypatch, tmp_key, falsy):
    """1/true/yes/on 만 켜진 것으로 인식 — 그 외는 OFF."""
    monkeypatch.setenv("BOOTSTRAP_HOST_ENABLE", falsy)
    monkeypatch.setenv("BOOTSTRAP_HOST_KEY_PATH", tmp_key)
    await bootstrap.register_bootstrap_host()
    storage_mock.upsert_host.assert_not_awaited()

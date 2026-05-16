import io
import zipfile

import pytest

import host_sftp
from host_manager import HostConnectError


# ---------------------- Tailscale 경로 ----------------------


@pytest.mark.asyncio
async def test_tailscale_download_marks_directory_as_zip(monkeypatch):
    async def fake_run_ts(target, cmd, timeout=15.0):
        return b"PK\x03\x04zip-bytes", b"__ITERM_TYPE__dir\n"

    monkeypatch.setattr(host_sftp, "_tailscale_target", lambda host: "ubuntu@example")
    monkeypatch.setattr(host_sftp, "_run_ts", fake_run_ts)

    data, filename, media_type = await host_sftp.download_item(
        {"id": "h1", "auth_method": "tailscale", "hostname": "example"},
        {},
        "/tmp/bundle",
    )

    assert data == b"PK\x03\x04zip-bytes"
    assert filename == "bundle.zip"
    assert media_type == "application/zip"


@pytest.mark.asyncio
async def test_tailscale_download_keeps_file_name(monkeypatch):
    async def fake_run_ts(target, cmd, timeout=15.0):
        return b"PK-not-a-folder", b"__ITERM_TYPE__file\n"

    monkeypatch.setattr(host_sftp, "_tailscale_target", lambda host: "ubuntu@example")
    monkeypatch.setattr(host_sftp, "_run_ts", fake_run_ts)

    data, filename, media_type = await host_sftp.download_item(
        {"id": "h1", "auth_method": "tailscale", "hostname": "example"},
        {},
        "/tmp/archive",
    )

    assert data == b"PK-not-a-folder"
    assert filename == "archive"
    assert media_type == "application/octet-stream"


@pytest.mark.asyncio
async def test_tailscale_download_too_large_raises(monkeypatch):
    async def fake_run_ts(target, cmd, timeout=15.0):
        return b"", b"__TOO_LARGE__\n"

    monkeypatch.setattr(host_sftp, "_tailscale_target", lambda host: "ubuntu@example")
    monkeypatch.setattr(host_sftp, "_run_ts", fake_run_ts)

    with pytest.raises(HostConnectError) as exc:
        await host_sftp.download_item(
            {"id": "h1", "auth_method": "tailscale", "hostname": "example"},
            {},
            "/tmp/huge",
        )
    assert "too large" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_download_item_rejects_empty_path():
    with pytest.raises(HostConnectError):
        await host_sftp.download_item({"id": "h1", "auth_method": "key"}, {}, "")


# ---------------------- SFTP 경로 (asyncssh mock) ----------------------


class _FakeAttrs:
    def __init__(self, *, is_dir=False, size=0, is_link=False):
        import stat as _stat
        if is_link:
            self.permissions = _stat.S_IFLNK | 0o644
        elif is_dir:
            self.permissions = _stat.S_IFDIR | 0o755
        else:
            self.permissions = _stat.S_IFREG | 0o644
        self.size = size


class _FakeEntry:
    def __init__(self, name, *, is_dir=False, size=0, is_link=False):
        self.filename = name
        self.attrs = _FakeAttrs(is_dir=is_dir, size=size, is_link=is_link)


class _FakeFile:
    def __init__(self, data: bytes):
        self._data = data

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def read(self, _n=None):
        return self._data


class _FakeSftp:
    """Minimal asyncssh.SFTPClient stand-in for download_item paths."""

    def __init__(self, tree: dict):
        # tree: { "/abs/path": (FakeAttrs, optional entries list, optional bytes) }
        self._tree = tree

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def stat(self, path):
        node = self._tree.get(path)
        if node is None:
            import asyncssh
            raise asyncssh.SFTPError(2, "no such file")
        return node[0]

    async def readdir(self, path):
        return self._tree[path][1]

    def open(self, path, _mode):
        return _FakeFile(self._tree[path][2])


class _FakeConn:
    def __init__(self, sftp):
        self._sftp = sftp

    def start_sftp_client(self):
        return self._sftp


@pytest.mark.asyncio
async def test_sftp_download_single_file(monkeypatch):
    sftp = _FakeSftp({
        "/home/user/notes.txt": (_FakeAttrs(size=11), None, b"hello world"),
    })

    async def fake_open(host, secrets):
        return _FakeConn(sftp)

    monkeypatch.setattr(host_sftp, "_get_or_open", fake_open)
    data, filename, media_type = await host_sftp.download_item(
        {"id": "h1", "auth_method": "key"}, {}, "/home/user/notes.txt"
    )
    assert data == b"hello world"
    assert filename == "notes.txt"
    assert media_type == "application/octet-stream"


@pytest.mark.asyncio
async def test_sftp_download_directory_zips_recursively(monkeypatch):
    sftp = _FakeSftp({
        "/work/proj": (_FakeAttrs(is_dir=True), [
            _FakeEntry("a.txt", size=2),
            _FakeEntry("sub", is_dir=True),
            _FakeEntry(".", is_dir=True),  # 무시되어야 함
        ], None),
        "/work/proj/a.txt": (_FakeAttrs(size=2), None, b"AA"),
        "/work/proj/sub": (_FakeAttrs(is_dir=True), [
            _FakeEntry("b.txt", size=3),
        ], None),
        "/work/proj/sub/b.txt": (_FakeAttrs(size=3), None, b"BBB"),
    })

    async def fake_open(host, secrets):
        return _FakeConn(sftp)

    monkeypatch.setattr(host_sftp, "_get_or_open", fake_open)
    data, filename, media_type = await host_sftp.download_item(
        {"id": "h1", "auth_method": "key"}, {}, "/work/proj"
    )
    assert filename == "proj.zip"
    assert media_type == "application/zip"
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = sorted(zf.namelist())
        assert names == ["proj/a.txt", "proj/sub/b.txt"]
        assert zf.read("proj/a.txt") == b"AA"
        assert zf.read("proj/sub/b.txt") == b"BBB"


@pytest.mark.asyncio
async def test_sftp_download_empty_directory_writes_marker(monkeypatch):
    sftp = _FakeSftp({
        "/empty": (_FakeAttrs(is_dir=True), [], None),
    })

    async def fake_open(host, secrets):
        return _FakeConn(sftp)

    monkeypatch.setattr(host_sftp, "_get_or_open", fake_open)
    data, filename, _ = await host_sftp.download_item(
        {"id": "h1", "auth_method": "key"}, {}, "/empty"
    )
    assert filename == "empty.zip"
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        # 빈 디렉터리도 zip 내에 폴더 엔트리로 보존됨.
        assert any(n.endswith("/") for n in zf.namelist())


@pytest.mark.asyncio
async def test_sftp_download_skips_symlinks(monkeypatch):
    sftp = _FakeSftp({
        "/work": (_FakeAttrs(is_dir=True), [
            _FakeEntry("real.txt", size=4),
            _FakeEntry("evil", is_link=True),
        ], None),
        "/work/real.txt": (_FakeAttrs(size=4), None, b"safe"),
    })

    async def fake_open(host, secrets):
        return _FakeConn(sftp)

    monkeypatch.setattr(host_sftp, "_get_or_open", fake_open)
    data, _, _ = await host_sftp.download_item(
        {"id": "h1", "auth_method": "key"}, {}, "/work"
    )
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        assert "work/real.txt" in zf.namelist()
        assert all("evil" not in n for n in zf.namelist())


@pytest.mark.asyncio
async def test_sftp_download_rejects_oversized_file(monkeypatch):
    big = host_sftp.MAX_DOWNLOAD_BYTES + 10
    sftp = _FakeSftp({
        "/big": (_FakeAttrs(size=big), None, b""),
    })

    async def fake_open(host, secrets):
        return _FakeConn(sftp)

    monkeypatch.setattr(host_sftp, "_get_or_open", fake_open)
    with pytest.raises(HostConnectError) as exc:
        await host_sftp.download_item(
            {"id": "h1", "auth_method": "key"}, {}, "/big"
        )
    assert "too large" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_sftp_download_rejects_oversized_directory(monkeypatch):
    half = host_sftp.MAX_DOWNLOAD_BYTES // 2 + 1
    sftp = _FakeSftp({
        "/dir": (_FakeAttrs(is_dir=True), [
            _FakeEntry("a", size=half),
            _FakeEntry("b", size=half),
        ], None),
        "/dir/a": (_FakeAttrs(size=half), None, b""),
        "/dir/b": (_FakeAttrs(size=half), None, b""),
    })

    async def fake_open(host, secrets):
        return _FakeConn(sftp)

    monkeypatch.setattr(host_sftp, "_get_or_open", fake_open)
    with pytest.raises(HostConnectError) as exc:
        await host_sftp.download_item(
            {"id": "h1", "auth_method": "key"}, {}, "/dir"
        )
    assert "too large" in str(exc.value).lower()

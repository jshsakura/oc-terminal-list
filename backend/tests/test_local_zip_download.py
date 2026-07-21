import io
import zipfile

import pytest

import main
from routes import files_read  # zip 헬퍼/상한은 main 에서 분리됨


def test_zip_directory_bytes_includes_files(tmp_path):
    root = tmp_path / "proj"
    root.mkdir()
    (root / "a.txt").write_text("AA")
    sub = root / "sub"
    sub.mkdir()
    (sub / "b.txt").write_text("BBB")

    data = files_read._zip_directory_bytes(root)

    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = sorted(zf.namelist())
        assert names == ["proj/a.txt", "proj/sub/b.txt"]
        assert zf.read("proj/a.txt") == b"AA"
        assert zf.read("proj/sub/b.txt") == b"BBB"


def test_zip_directory_bytes_raises_on_too_many_files(tmp_path, monkeypatch):
    monkeypatch.setattr(files_read, "MAX_LOCAL_ZIP_FILES", 2)

    root = tmp_path / "proj"
    root.mkdir()
    for i in range(3):
        (root / f"f{i}.txt").write_text("x")

    with pytest.raises(files_read._ZipTooLargeError):
        files_read._zip_directory_bytes(root)


def test_zip_directory_bytes_raises_on_too_large(tmp_path, monkeypatch):
    monkeypatch.setattr(files_read, "MAX_LOCAL_ZIP_BYTES", 10)

    root = tmp_path / "proj"
    root.mkdir()
    (root / "big.txt").write_bytes(b"x" * 20)

    with pytest.raises(files_read._ZipTooLargeError):
        files_read._zip_directory_bytes(root)


def test_zip_directory_bytes_skips_symlinks(tmp_path):
    root = tmp_path / "proj"
    root.mkdir()
    (root / "real.txt").write_text("safe")
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("leak")
    try:
        (root / "link").symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("symlinks unavailable on this filesystem")

    data = files_read._zip_directory_bytes(root)
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = zf.namelist()
        assert "proj/real.txt" in names
        assert all("secret" not in n for n in names)

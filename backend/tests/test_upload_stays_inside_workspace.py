"""로컬 업로드의 임시 파일이 워크스페이스 밖에 생기지 않는다.

`os.path.basename(".")` 은 `.` 을 그대로 돌려주고, `dest / "."` 는 pathlib 이 접어 dest
자신이 된다. 그때 `with_suffix(".part")` 가 만든 임시 파일은 dest 의 **형제**였다 —
dest 가 워크스페이스 루트면 그 바깥이다. 상한(200MB)만큼 밖에 썼다가 지우는 셈이었다.
"""
from __future__ import annotations

import os
import pytest

import routes.files_write as files_write


class _Upload:
    def __init__(self, name: str, data: bytes = b"hello"):
        self.filename = name
        self._data = data
        self._done = False

    async def read(self, _n: int) -> bytes:
        if self._done:
            return b""
        self._done = True
        return self._data


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    root = tmp_path / "ws"
    root.mkdir()
    monkeypatch.setattr("_deps.WORKSPACE_ROOT", str(root))
    monkeypatch.setattr("routes.files_write.WORKSPACE_ROOT", str(root))
    monkeypatch.setattr("routes.files_write._invalidate_file_index", lambda: None)
    return root


async def test_점_이름은_건너뛰고_형제_경로에_아무것도_안_쓴다(workspace):
    out = await files_write.upload_files(files=[_Upload("."), _Upload("..")], dest="", username="u")
    assert out["files"] == []
    assert not (workspace.parent / "ws.part").exists()
    assert sorted(os.listdir(workspace.parent)) == ["ws"]


async def test_임시_파일은_목적지_폴더_안에_만들어진다(workspace, monkeypatch):
    seen: list[str] = []
    real_open = open

    def spy_open(path, *a, **kw):
        seen.append(str(path))
        return real_open(path, *a, **kw)

    monkeypatch.setattr("builtins.open", spy_open)
    out = await files_write.upload_files(files=[_Upload("README")], dest="", username="u")
    assert out["files"][0]["path"] == "README"
    assert (workspace / "README").read_bytes() == b"hello"
    part = [p for p in seen if p.endswith(".part")]
    assert part and part[0].startswith(str(workspace) + os.sep)
    assert not (workspace / ".README.part").exists()


async def test_경로_구분자가_섞인_이름은_마지막_조각만_쓴다(workspace):
    out = await files_write.upload_files(files=[_Upload("a/../../etc/passwd")], dest="", username="u")
    assert out["files"][0]["path"] == "passwd"
    assert (workspace / "passwd").exists()

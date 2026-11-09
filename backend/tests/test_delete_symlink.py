"""Deleting a symlink removes the link, never what it points at.

validate_path resolves the path, so a link to a directory turned into the directory
itself and DELETE /api/files ran rmtree on the target. A link to "." made that the
whole workspace.
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

import _deps
from routes import files_write


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    root = tmp_path / "ws"
    root.mkdir()
    monkeypatch.setattr(_deps, "WORKSPACE_ROOT", str(root))
    monkeypatch.setattr(files_write, "_invalidate_file_index", lambda: None)
    return root


def _delete(path: str):
    return asyncio.run(files_write.delete_file(path=path, username="u"))


def test_deleting_a_link_to_a_directory_keeps_the_target(workspace):
    target = workspace / "real"
    target.mkdir()
    (target / "keep.txt").write_text("keep")
    link = workspace / "link"
    link.symlink_to(target, target_is_directory=True)

    _delete("link")

    assert not link.is_symlink() and not link.exists()
    assert (target / "keep.txt").read_text() == "keep"


def test_deleting_a_link_to_the_workspace_root_keeps_the_workspace(workspace):
    (workspace / "keep.txt").write_text("keep")
    link = workspace / "rootlink"
    link.symlink_to(workspace, target_is_directory=True)

    _delete("rootlink")

    assert not link.is_symlink()
    assert (workspace / "keep.txt").read_text() == "keep"


def test_deleting_a_link_to_outside_removes_only_the_link(workspace, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("secret")
    link = workspace / "out"
    link.symlink_to(outside, target_is_directory=True)

    _delete("out")

    assert not link.is_symlink()
    assert (outside / "secret.txt").read_text() == "secret"


def test_deleting_a_dangling_link_removes_it(workspace):
    link = workspace / "dangling"
    link.symlink_to(workspace / "missing")

    _delete("dangling")

    assert not link.is_symlink()


def test_a_path_through_a_link_to_outside_is_still_refused(workspace, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("secret")
    (workspace / "out").symlink_to(outside, target_is_directory=True)

    with pytest.raises(HTTPException) as caught:
        _delete("out/secret.txt")

    assert caught.value.status_code == 403
    assert (outside / "secret.txt").exists()


def test_plain_directories_and_files_are_still_deleted(workspace):
    (workspace / "dir").mkdir()
    (workspace / "dir" / "a.txt").write_text("a")
    (workspace / "f.txt").write_text("f")

    _delete("dir")
    _delete("f.txt")

    assert not (workspace / "dir").exists()
    assert not (workspace / "f.txt").exists()


@pytest.mark.parametrize("path", ["", "/", ".", "a/.."])
def test_the_workspace_root_cannot_be_deleted(workspace, path):
    with pytest.raises(HTTPException) as caught:
        _delete(path)
    assert caught.value.status_code == 400
    assert workspace.exists()


@pytest.mark.parametrize("path", ["..", "../ws", "a/../..", "/../.."])
def test_climbing_out_is_refused(workspace, path):
    with pytest.raises(HTTPException) as caught:
        _delete(path)
    assert caught.value.status_code in (400, 403)
    assert workspace.exists()

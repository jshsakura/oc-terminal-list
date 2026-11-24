import subprocess

import pytest
from fastapi import FastAPI
import httpx
import pytest_asyncio

import _deps
from routes import local_git


@pytest_asyncio.fixture
async def client(tmp_path, monkeypatch):
    monkeypatch.setattr(_deps, "WORKSPACE_ROOT", str(tmp_path))
    app = FastAPI()
    app.include_router(local_git.router)
    app.dependency_overrides[local_git.verify_auth_token] = lambda: "test"
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client


@pytest.mark.asyncio
async def test_document_outside_git_has_no_comparison_source(client, tmp_path):
    (tmp_path / "note.md").write_text("local document")
    response = await client.get("/api/git/file-content", params={"path": "note.md", "ref": "HEAD"})
    assert response.status_code == 200
    assert response.json() == {"path": "note.md", "ref": "HEAD", "content": "", "exists": False}


@pytest.mark.asyncio
async def test_committed_source_and_untracked_document(client, tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    def git(*args):
        subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)
    git("init")
    (repo / "tracked.md").write_text("committed")
    git("add", "tracked.md")
    git("-c", "user.name=Test", "-c", "user.email=test@local", "commit", "-m", "test")
    (repo / "tracked.md").write_text("edited")
    (repo / "untracked.md").write_text("new")
    response = await client.get("/api/git/file-content", params={"path": "repo/tracked.md"})
    assert response.status_code == 200
    assert response.json()["content"] == "committed"
    assert response.json()["exists"] is True
    response = await client.get("/api/git/file-content", params={"path": "repo/untracked.md"})
    assert response.status_code == 200
    assert response.json()["exists"] is False


@pytest.mark.parametrize("params,status", [
    ({"path": "../outside.md"}, 403),
    ({"path": "note.md", "ref": "--help"}, 400),
])
@pytest.mark.asyncio
async def test_path_and_ref_rejections_remain_errors(client, params, status):
    assert (await client.get("/api/git/file-content", params=params)).status_code == status

"""GET /api/hosts/{id}/files/search — route wiring (the command itself is test_host_search)."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

import routes.host_files as host_files


def _patched(run):
    return (
        patch.object(host_files, "resolve_host_with_secrets", AsyncMock(return_value=({"id": "h1"}, {}))),
        patch.object(host_files, "run_remote_cmd_pooled", run),
    )


async def _call(run, **kw):
    a, b = _patched(run)
    with a, b:
        return await host_files.search_host_files(
            host_id="h1", q=kw.get("q", "x"), mode=kw.get("mode", "name"), path=kw.get("path", ""), username="u")


def test_returns_parsed_items():
    run = AsyncMock(return_value=(0, "d\t/home/u/reports\nf\t/home/u/a.py\n", ""))
    out = asyncio.run(_call(run))
    assert [i["name"] for i in out["items"]] == ["reports", "a.py"]
    assert out["truncated"] is False


def test_bad_root_is_404():
    run = AsyncMock(return_value=(3, "", ""))
    with pytest.raises(HTTPException) as e:
        asyncio.run(_call(run))
    assert e.value.status_code == 404


def test_timeout_is_504():
    run = AsyncMock(side_effect=asyncio.TimeoutError())
    with pytest.raises(HTTPException) as e:
        asyncio.run(_call(run))
    assert e.value.status_code == 504


def test_blank_query_skips_the_host():
    run = AsyncMock()
    out = asyncio.run(_call(run, q="   "))
    assert out["items"] == []
    run.assert_not_called()

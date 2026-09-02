"""Shared fixtures.

The itl marker key is derived from a secret file that is created on first use. Tests
must never write that file into the real `data/` directory, so every test gets a fresh
one under tmp_path.
"""
from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _itl_secret_in_tmp(tmp_path, monkeypatch):
    import itl_key
    monkeypatch.setenv("ITL_SECRET_PATH", str(tmp_path / ".itl-secret"))
    itl_key.reset_cache()
    yield
    itl_key.reset_cache()

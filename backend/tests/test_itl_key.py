"""itl marker key — derived per pane, stable across restarts, never stored."""
from __future__ import annotations

import os
import stat

import itl_key


def test_same_scope_same_key_across_cache_resets():
    a = itl_key.key_for(itl_key.local_scope("sess-1"))
    itl_key.reset_cache()                       # a backend restart
    assert itl_key.key_for(itl_key.local_scope("sess-1")) == a


def test_different_scopes_differ():
    assert itl_key.key_for(itl_key.local_scope("a")) != itl_key.key_for(itl_key.local_scope("b"))
    assert (itl_key.key_for(itl_key.host_scope("h1", "mobile"))
            != itl_key.key_for(itl_key.host_scope("h2", "mobile")))


def test_secret_file_is_private(tmp_path):
    itl_key.key_for("x")
    path = tmp_path / ".itl-secret"
    assert path.exists()
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600


def test_key_is_short_hex():
    key = itl_key.key_for("x")
    assert len(key) == itl_key.KEY_HEX_LEN and int(key, 16) >= 0


def test_matches_needs_both_sides():
    key = itl_key.key_for("x")
    assert itl_key.matches(key, key)
    assert not itl_key.matches(key, key[:-1] + ("0" if key[-1] != "0" else "1"))
    assert not itl_key.matches(None, key)
    assert not itl_key.matches(key, None)
    assert not itl_key.matches("", "")

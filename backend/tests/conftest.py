"""Shared fixtures.

The itl marker key is derived from a secret file that is created on first use. Tests
must never write that file into the real `data/` directory, so every test gets a fresh
one under tmp_path.
"""
from __future__ import annotations

import os

import pytest

# ⚠️ 테스트는 **운영 Redis 에 붙지 않는다.**
# `backend/cache.py` 는 import 시점에 `REDIS_URL` 을 읽어 클라이언트를 만든다. 이 개발
# 기계의 셸 환경에는 그 값이 들어 있어서, 테스트가 살아 있는 앱과 **같은 캐시**를 쓰고
# 있었다. 증상은 두 가지였다:
#   1. 전체 스위트에서 test_host_tmux_batch 가 "Future attached to a different loop" 로
#      실패한다(비동기 커넥션이 테스트 간 이벤트 루프를 넘는다). 단독 실행은 통과해서
#      플래키로 보인다.
#   2. 더 나쁜 쪽 — `delete_prefix` 같은 호출이 운영 캐시 키를 지울 수 있다.
# conftest 는 테스트 모듈보다 먼저 import 되므로 여기서 지우면 in-memory 로 뜬다.
os.environ.pop("REDIS_URL", None)

# ⚠️ 테스트는 **자기가 도는 팬의 tmux 에 닿지 않는다.**
# pytest 를 이 앱의 팬 안에서 돌리면 `TMUX`/`TMUX_PANE` 이 그 세션을 가리킨다. `cli/itl` 의
# `put_outbox`·`my_key` 는 그 값으로 **진짜** 세션 옵션을 세우고 읽는다 — 실제로
# `send_app_addr("1.2", "hi")` 를 부르는 테스트가 이 팬의 우편함을 세워, 백엔드가 그것을
# 다른 호스트의 팬 1.2 에 "[from 5.1] hi" 로 배달했다(2026-09-06, 스위트를 돌릴 때마다).
# 필요한 테스트는 monkeypatch 로 명시적으로 세운다.
for _var in ("TMUX", "TMUX_PANE", "ITL_KEY"):
    os.environ.pop(_var, None)


@pytest.fixture(autouse=True)
def _itl_secret_in_tmp(tmp_path, monkeypatch):
    import itl_key
    monkeypatch.setenv("ITL_SECRET_PATH", str(tmp_path / ".itl-secret"))
    itl_key.reset_cache()
    yield
    itl_key.reset_cache()

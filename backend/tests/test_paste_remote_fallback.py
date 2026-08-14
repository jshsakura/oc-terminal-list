"""원격 붙여넣기 — /tmp 가 막힌 호스트는 홈으로 떨어진다.

실측 배경: 한 호스트에서 SFTP 로 /tmp 에 쓰면 SSH_FX_FAILURE(4) 가 났다. 원인은
그 호스트의 정책이 아니라 **/tmp(tmpfs)가 가득 찼던 것**이다 — 62G 중 50G 사용에
스왑까지 100% 인 동안 쓰기가 ENOSPC 였고, 몇 분 뒤 8G 로 내려가자 그대로 됐다
(0바이트 `touch` 는 그 와중에도 됐다 — 파일 생성은 inode 만, 쓰기는 데이터 페이지가
필요하다). 같은 시각 다른 호스트들은 /tmp 가 멀쩡했다.

그러니 규칙은 둘이다: **"POSIX 면 /tmp 는 쓸 수 있다" 를 전제하지 말 것**(그러면
붙여넣기가 통째로 죽는다), 그리고 **그 실패를 영구 결론으로 굳히지도 말 것**(회복되면
/tmp 로 돌아가야 한다 — 홈은 재부팅에도 안 지워지는 자리다).
"""
from __future__ import annotations

import time

import pytest
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException

import routes.files_write as fw
from paste_targets import remote_home_paste_dir, remote_paste_dir


class _Upload:
    """UploadFile 대역 — read(n) 만 쓴다."""

    def __init__(self, data: bytes = b"PNG-BYTES"):
        self._data = data

    async def read(self, _n: int = -1) -> bytes:
        return self._data


@pytest.fixture(autouse=True)
def _clear_cache():
    fw._paste_dir_by_host.clear()
    yield
    fw._paste_dir_by_host.clear()


def _patches(write_side_effect, home="/home/me"):
    return (
        patch.object(fw, "resolve_host_with_secrets", AsyncMock(return_value=({"id": "h1"}, {}))),
        patch.object(fw.host_sftp, "create_item", AsyncMock(return_value=None)),
        patch.object(fw.host_sftp, "remote_home", AsyncMock(return_value=home)),
        patch.object(fw.host_sftp, "write_file", AsyncMock(side_effect=write_side_effect)),
    )


async def _paste(**kw):
    return await fw._save_remote_paste("h1", "u", _Upload(), "shot.png", **kw)


async def test_tmp_works_so_home_is_never_touched():
    p1, p2, p3, p4 = _patches(None)
    with p1, p2, p3 as home_mock, p4 as write:
        out = await _paste()
    assert out["path"] == f"{remote_paste_dir()}/shot.png"
    assert write.await_count == 1
    # /tmp 가 되면 홈이 어딘지 물어볼 필요도 없다 — SSH 왕복 하나를 아낀다.
    assert home_mock.await_count == 0


async def test_falls_back_to_home_when_tmp_is_refused():
    def side_effect(host, secrets, path, content):
        if path.startswith("/tmp/"):
            raise fw.HostConnectError("SFTP upload failed: Failure")
        return None

    p1, p2, p3, p4 = _patches(side_effect)
    with p1, p2, p3, p4:
        out = await _paste()
    assert out["path"] == f"{remote_home_paste_dir('/home/me')}/shot.png"
    assert out["scope"] == "host"


async def test_working_dir_is_remembered_so_the_failure_is_paid_once():
    calls: list[str] = []

    def side_effect(host, secrets, path, content):
        calls.append(path)
        if path.startswith("/tmp/"):
            raise fw.HostConnectError("Failure")
        return None

    p1, p2, p3, p4 = _patches(side_effect)
    with p1, p2, p3, p4:
        await _paste()
        await _paste()

    # 첫 번째만 /tmp 를 때려보고, 두 번째부터는 곧장 홈으로 간다.
    assert sum(1 for c in calls if c.startswith("/tmp/")) == 1
    assert sum(1 for c in calls if c.startswith("/home/me/")) == 2


async def test_cache_is_dropped_when_the_remembered_dir_stops_working():
    fw._paste_dir_by_host["h1"] = (remote_home_paste_dir("/home/me"), time.time())

    p1, p2, p3, p4 = _patches(fw.HostConnectError("gone"))
    with p1, p2, p3, p4:
        with pytest.raises(HTTPException):
            await _paste()
    # 다음 붙여넣기가 후보를 처음부터 다시 찾도록 비워야 한다.
    assert "h1" not in fw._paste_dir_by_host


async def test_all_candidates_fail_reports_502():
    p1, p2, p3, p4 = _patches(fw.HostConnectError("nope"))
    with p1, p2, p3, p4:
        with pytest.raises(HTTPException) as e:
            await _paste()
    assert e.value.status_code == 502


async def test_home_unknown_leaves_tmp_as_the_only_candidate():
    p1, p2, p3, p4 = _patches(fw.HostConnectError("nope"), home=None)
    with p1, p2, p3, p4 as write:
        with pytest.raises(HTTPException):
            await _paste()
    assert write.await_count == 1


async def test_cache_expires_so_a_full_tmp_is_not_a_life_sentence():
    """실측: /tmp 가 막힌 이유는 그 호스트의 정책이 아니라 **tmpfs 가 가득 찼던 것**이었고,
    몇 분 뒤 스스로 풀렸다. 일시적인 상태를 영구 결론으로 굳히면, 회복된 뒤에도 붙여넣기가
    계속 홈에 쌓인다 — /tmp 와 달리 재부팅에도 안 지워지는 자리다."""
    stale = time.time() - fw._PASTE_DIR_TTL_SECONDS - 1
    fw._paste_dir_by_host["h1"] = (remote_home_paste_dir("/home/me"), stale)

    p1, p2, p3, p4 = _patches(None)
    with p1, p2, p3, p4:
        out = await _paste()
    # 만료됐으니 /tmp 를 다시 시도했고, 이제 되니까 /tmp 로 돌아간다.
    assert out["path"] == f"{remote_paste_dir()}/shot.png"

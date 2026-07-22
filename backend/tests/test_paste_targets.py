"""붙여넣기 파일이 어디로 가는가 — 규칙을 못박는다.

규칙: **대상 pane 이 사는 머신의 `/tmp/iterminallist-paste/`.**
로컬 pane 이면 이 서버의 /tmp, 원격 pane 이면 그 호스트의 /tmp.

왜 워크스페이스가 아닌가: WORKSPACE_ROOT 는 이 배포에서 jupyterLab/notebooks 다.
붙여넣은 이미지가 거기 쌓이면 노트북 폴더가 오염되고, git 저장소면 커밋에 딸려간다.
/tmp 는 쓰기권한이 사실상 보장되고 재부팅 때 알아서 비워진다.
"""
import os

import pytest

from paste_targets import (
    PASTE_DIR_NAME, local_paste_dir, remote_paste_dir, safe_basename, stamped_name,
)


def test_remote_is_always_tmp():
    """호스트마다 다른 규칙이면 예측할 수 없다 — 어디서든 같은 자리."""
    assert remote_paste_dir() == f"/tmp/{PASTE_DIR_NAME}"


def test_local_defaults_to_tmp(monkeypatch):
    monkeypatch.delenv("PASTE_DIR", raising=False)
    monkeypatch.delenv("TMPDIR", raising=False)
    assert str(local_paste_dir()) == f"/tmp/{PASTE_DIR_NAME}"


def test_local_never_lands_in_the_workspace(monkeypatch):
    """이 배포의 WORKSPACE_ROOT 는 노트북 폴더다 — 절대 거기로 가면 안 된다."""
    monkeypatch.delenv("PASTE_DIR", raising=False)
    from _deps import WORKSPACE_ROOT
    assert not str(local_paste_dir()).startswith(str(WORKSPACE_ROOT))


def test_local_dir_is_overridable(monkeypatch):
    """컨테이너 배포 등에서 옮길 수 있어야 한다."""
    monkeypatch.setenv("PASTE_DIR", "/var/tmp/custom")
    assert str(local_paste_dir()) == "/var/tmp/custom"


@pytest.mark.parametrize("raw,expected_contains", [
    ("photo.png", "photo.png"),
    ("../../etc/passwd", "passwd"),          # 경로 traversal 차단
    ("/absolute/path/x.jpg", "x.jpg"),
    ("한글 이름.png", "_.png"),                # 화이트리스트 밖은 _
    ("...hidden", "hidden"),                 # 선행 점 제거
])
def test_safe_basename(raw, expected_contains):
    got = safe_basename(raw)
    assert expected_contains in got
    assert "/" not in got and ".." not in got


def test_safe_basename_falls_back():
    assert safe_basename(None) == "file"
    assert safe_basename("") == "file"
    assert safe_basename("///") == "file"


def test_safe_basename_is_length_capped():
    assert len(safe_basename("a" * 500)) <= 80


def test_stamped_names_do_not_collide():
    """같은 초에 여러 장을 붙여넣어도 겹치면 앞의 것이 덮인다."""
    names = {stamped_name("x.png") for _ in range(50)}
    assert len(names) > 1
    assert all(n.endswith("x.png") for n in names)

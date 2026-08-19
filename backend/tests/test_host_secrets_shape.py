"""접속용 자격 해석은 **어떤 행을 받았는지**에 달려 있다.

`list_hosts` 는 브라우저로 나가는 행이라 `password_enc` 를 아예 SELECT 하지 않는다(옳다).
그 행을 접속 경로에 넘기면 비밀번호가 있는 호스트가 "비밀번호가 없음" 으로 실패한다 —
그리고 그 실패는 **한 경로에서만** 나므로(터미널은 get_host 를 쓴다) 진단이 어렵다.
실제로 홈 화면의 "이어할 수 있는 세션" 이 password 인증 호스트에서 영영 비어 있었다.
"""
from __future__ import annotations

import pytest

from host_manager import HostConnectError, resolve_host_secrets


def test_list_row_is_rejected_loudly():
    """컬럼이 아예 없는 행 = 잘못된 행. 조용히 None 을 주면 안 된다."""
    list_row = {"id": "h1", "auth_method": "password"}      # list_hosts 가 주는 모양
    with pytest.raises(HostConnectError) as e:
        resolve_host_secrets(list_row, None)
    assert "password_enc" in str(e.value)
    assert "get_host" in str(e.value)


def test_saved_password_is_decrypted():
    from vault import encrypt_str
    row = {"auth_method": "password", "password_enc": encrypt_str("s3cret")}
    assert resolve_host_secrets(row, None)["password"] == "s3cret"


def test_no_password_saved_is_not_the_same_error():
    """컬럼은 있는데 비어 있다 = 정말로 비밀번호를 저장하지 않은 호스트.
    이때는 여기서 터지지 않고, 접속 시점에 원래 메시지로 실패해야 한다."""
    row = {"auth_method": "password", "password_enc": None}
    assert resolve_host_secrets(row, None)["password"] is None


def test_other_methods_do_not_need_the_column():
    for method in ("key", "tailscale"):
        assert resolve_host_secrets({"auth_method": method}, None)["password"] is None

"""웹 푸시 — 키 관리, 구독 저장, 완료 알림 판정.

실제 발송(네트워크)은 테스트하지 않는다. 대신 그 앞단 — 키 포맷, 구독 수명주기,
"언제 보낼지" 판정 — 을 고정한다. 발송 자체는 pywebpush 의 책임이다.
"""
import time

import pytest

import push_keys
from push_service import build_agent_done_payload
from sqlite_storage import SQLiteStorage


@pytest.fixture
def vapid(tmp_path, monkeypatch):
    monkeypatch.setenv("VAPID_KEY_PATH", str(tmp_path / ".vapid-key"))
    push_keys._cache = None
    yield
    push_keys._cache = None


def test_vapid_public_key_is_p256_uncompressed(vapid):
    pub = push_keys.get_public_key()
    assert len(pub) == 87          # 65바이트 uncompressed point → base64url 87자
    assert "=" not in pub          # 푸시 프로토콜은 패딩 없는 base64url


def test_vapid_private_key_is_raw_32_bytes(vapid):
    """py-vapid 는 길이 32면 raw, 아니면 DER 로 해석한다. PEM 을 넘기면 죽는다."""
    import base64
    priv = push_keys.get_vapid_keys()["private"]
    raw = base64.urlsafe_b64decode(priv + "=" * (-len(priv) % 4))
    assert len(raw) == 32


def test_vapid_key_survives_restart(vapid):
    """키가 바뀌면 기존 구독이 전부 무효가 된다 — 반드시 파일로 살아남아야 한다."""
    first = push_keys.get_public_key()
    push_keys._cache = None
    assert push_keys.get_public_key() == first


def test_corrupt_vapid_key_fails_loudly(vapid, tmp_path):
    """조용히 새 키를 만들면 기존 구독이 말없이 죽는다 — 시끄럽게 실패해야 한다."""
    (tmp_path / ".vapid-key").write_bytes(b"not a pem")
    push_keys._cache = None
    with pytest.raises(RuntimeError, match="VAPID"):
        push_keys.get_vapid_keys()


# ---------------------- 구독 저장 ----------------------

@pytest.fixture
def storage(tmp_path):
    return SQLiteStorage(str(tmp_path / "t.db"))


@pytest.mark.anyio
async def test_subscription_roundtrip(storage):
    await storage.save_push_subscription("u", "https://fcm/a", "p", "a", "UA")
    subs = await storage.list_push_subscriptions("u")
    assert subs[0]["endpoint"] == "https://fcm/a"
    assert subs[0]["keys"] == {"p256dh": "p", "auth": "a"}


@pytest.mark.anyio
async def test_resubscribe_same_device_overwrites(storage):
    """같은 기기가 재구독하면 endpoint 가 같다 — 행이 늘어나면 알림이 중복된다."""
    await storage.save_push_subscription("u", "https://fcm/a", "p1", "a1")
    await storage.save_push_subscription("u", "https://fcm/a", "p2", "a2")
    subs = await storage.list_push_subscriptions("u")
    assert len(subs) == 1
    assert subs[0]["keys"]["p256dh"] == "p2"


@pytest.mark.anyio
async def test_subscriptions_are_per_user(storage):
    await storage.save_push_subscription("a", "https://fcm/1", "p", "a")
    await storage.save_push_subscription("b", "https://fcm/2", "p", "a")
    assert len(await storage.list_push_subscriptions("a")) == 1
    assert await storage.count_push_subscriptions("b") == 1


@pytest.mark.anyio
async def test_delete_subscription(storage):
    await storage.save_push_subscription("u", "https://fcm/a", "p", "a")
    assert await storage.delete_push_subscription("https://fcm/a") is True
    assert await storage.count_push_subscriptions("u") == 0
    assert await storage.delete_push_subscription("https://fcm/a") is False


# ---------------------- 알림 페이로드 / 쿨다운 ----------------------

def test_payload_carries_session_and_tag():
    p = build_agent_done_payload({"sessionId": "s1", "command": "claude", "title": "폴더 로더 수정"})
    assert p["sessionId"] == "s1"
    assert "claude" in p["title"]
    assert p["body"] == "폴더 로더 수정"
    # tag 가 세션별이라야 같은 pane 알림이 쌓이지 않고 교체된다.
    assert p["tag"] == "agent-done-s1"


def test_payload_survives_empty_title():
    p = build_agent_done_payload({"sessionId": "s1", "command": "", "title": ""})
    assert p["body"]           # 빈 알림을 띄우면 안 된다
    assert p["title"]


def test_payload_truncates_long_title():
    p = build_agent_done_payload({"sessionId": "s1", "command": "claude", "title": "가" * 500})
    assert len(p["body"]) <= 120


def test_cooldown_suppresses_flapping():
    """working↔idle 이 연달아 잡히면 폰이 계속 울린다 — 그러면 사용자가 알림을 꺼버린다."""
    from agent_status_service import _should_notify, DONE_NOTIFY_COOLDOWN_SECONDS
    now = time.time()
    assert _should_notify("flap", now) is True
    assert _should_notify("flap", now + 1) is False
    assert _should_notify("flap", now + DONE_NOTIFY_COOLDOWN_SECONDS + 1) is True


def test_cooldown_is_per_session():
    from agent_status_service import _should_notify
    now = time.time()
    assert _should_notify("s-a", now) is True
    assert _should_notify("s-b", now) is True     # 다른 세션은 서로 막지 않는다


def test_forgetting_a_gone_session_clears_cooldown():
    from agent_status_service import _should_notify, _forget_session
    now = time.time()
    assert _should_notify("s-x", now) is True
    _forget_session("s-x")
    assert _should_notify("s-x", now) is True     # 세션이 죽고 새로 생기면 다시 알린다

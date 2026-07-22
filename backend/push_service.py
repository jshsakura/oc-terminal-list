"""웹 푸시 발송 — 에이전트가 한 턴을 끝냈을 때 기기로 알린다.

설계 요지:

**서버는 "보낼지"만 정하고 "보여줄지"는 서비스워커가 정한다.** 서버는 지금 사용자가
어느 pane 을 보고 있는지 알 수 없다. 그래서 완료 이벤트는 항상 보내고, sw.js 가
`clients.matchAll` 로 포커스된 창을 확인해 이미 보고 있으면 알림을 띄우지 않는다.

**실패한 구독은 즉시 지운다.** 푸시 서비스가 404/410 을 주면 그 구독은 영영 죽은
것이다(브라우저가 지웠거나 사용자가 알림을 껐다). 남겨두면 매 완료마다 죽은
endpoint 로 왕복을 낭비한다.

**LLM 은 호출하지 않는다** — 알림 문구는 tmux pane 타이틀 그대로다.
"""
from __future__ import annotations

import asyncio
import json
import logging

from pywebpush import WebPushException, webpush

from push_keys import get_vapid_keys
from sqlite_storage import storage

logger = logging.getLogger(__name__)

# 푸시 서비스 응답 대기 상한. 느린 서비스 하나가 완료 알림 전체를 잡아두면 안 된다.
PUSH_TIMEOUT_SECONDS = 10
# VAPID 클레임의 연락처. 푸시 서비스가 문제 발생 시 연락할 주소로 쓴다(형식만 지키면 됨).
VAPID_SUBJECT = "mailto:admin@localhost"
# 알림 본문에 실을 타이틀 길이 상한 — 에이전트 타이틀이 길면 잘라 보낸다.
MAX_BODY_CHARS = 120


def _send_one(subscription: dict, payload: str) -> tuple[bool, int | None]:
    """동기 발송 1건. (성공?, HTTP 상태). 예외는 여기서 흡수한다."""
    keys = get_vapid_keys()
    try:
        webpush(
            subscription_info={
                "endpoint": subscription["endpoint"],
                "keys": subscription["keys"],
            },
            data=payload,
            vapid_private_key=keys["private"],
            vapid_claims={"sub": VAPID_SUBJECT},
            timeout=PUSH_TIMEOUT_SECONDS,
        )
        return True, None
    except WebPushException as e:
        status = getattr(e.response, "status_code", None)
        return False, status
    except Exception as e:
        logger.debug("push send failed (%s): %s", subscription["endpoint"][:40], e)
        return False, None


async def send_to_user(username: str, payload: dict) -> int:
    """사용자의 모든 기기로 발송. 반환은 성공 건수.

    404/410 을 받은 구독은 그 자리에서 삭제한다 — 죽은 endpoint 를 남겨두면
    매 알림마다 왕복을 낭비한다.
    """
    subs = await storage.list_push_subscriptions(username)
    if not subs:
        return 0

    body = json.dumps(payload, ensure_ascii=False)
    results = await asyncio.gather(
        *(asyncio.to_thread(_send_one, s, body) for s in subs),
        return_exceptions=True,
    )

    sent = 0
    for sub, result in zip(subs, results):
        if isinstance(result, Exception):
            continue
        ok, status = result
        if ok:
            sent += 1
        elif status in (404, 410):
            await storage.delete_push_subscription(sub["endpoint"])
            logger.info("push: 죽은 구독 정리 (%s)", sub["endpoint"][:40])
    return sent


def build_agent_done_payload(change: dict, label: str = "") -> dict:
    """워처의 완료 이벤트 → 알림 페이로드.

    `tag` 는 세션ID 다 — 같은 pane 의 알림이 쌓이지 않고 최신 것으로 교체된다.
    `sessionId` 는 서비스워커가 "이미 그 pane 을 보고 있나" 판정과 클릭 시 이동에 쓴다.
    """
    title = (change.get("title") or "").strip()
    command = (change.get("command") or "agent").strip()
    # 제목에 주소(탭.pane)를 넣는다 — 알림 목록에서 어느 터미널인지 바로 보여야 한다.
    heading = f"{label} · {command}" if label else f"{command} 작업 완료"
    return {
        "type": "agentDone",
        "sessionId": change.get("sessionId"),
        "title": heading,
        "body": title[:MAX_BODY_CHARS] if title else "에이전트가 대기 상태로 돌아왔습니다.",
        "tag": f"agent-done-{change.get('sessionId')}",
    }

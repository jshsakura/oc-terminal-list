"""인증 쿠키 발급 정책 — Secure 플래그 판정이 전부다.

여기를 잘못 만지면 로그인이 통째로 깨진다. 기본 배포가 리버스 프록시 없는
http://<서버-IP>:<PORT> 직접 접속이라, "localhost 아니면 무조건 Secure" 로 바꾸면
쿠키가 저장은 되는데 재전송이 안 돼 로그인이 조용히 실패한다. 판정 근거는
요청 scheme 이고, X-Forwarded-* 는 TRUST_PROXY_HEADERS 를 켠 경우에만 믿는다.
"""
from __future__ import annotations

import logging
import os

from fastapi import Request, Response

from _deps import AUTH_COOKIE_NAME

logger = logging.getLogger(__name__)



AUTH_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _request_is_https(request: Request) -> bool:
    if request.url.scheme == "https":
        return True
    if _env_flag("TRUST_PROXY_HEADERS"):
        return request.headers.get("x-forwarded-proto", "").split(",", 1)[0].strip().lower() == "https"
    return False


# AUTH_COOKIE_SECURE: "auto"(기본) | "1"(강제 secure) | "0"(강제 non-secure).
# 기본 배포 방식이 리버스 프록시 없이 http://<서버-IP>:<PORT> 로 직접 접속하는 것이라
# (README/deploy 문서 참고) "non-localhost 면 무조건 secure=True" 로 바꾸면 표준 배포에서
# 로그인 쿠키가 브라우저에 저장은 되지만 이후 요청에 재전송되지 않아 로그인이 깨진다.
# 그래서 auto 의 판정 로직 자체는 유지(scheme 기반) 하고, HTTPS 종료 리버스 프록시 뒤에
# 있는데 TRUST_PROXY_HEADERS 를 안 켠 애매한 구성만 기동 시 경고로 알린다.
_AUTH_COOKIE_SECURE_MODE = os.getenv("AUTH_COOKIE_SECURE", "auto").strip().lower()
if _AUTH_COOKIE_SECURE_MODE in {"0", "false", "no", "off"}:
    logger.warning(
        "[auth] AUTH_COOKIE_SECURE=%s — 인증 쿠키가 항상 secure=False 로 발급됩니다. "
        "localhost 개발 환경이 아니라면 위험합니다.",
        _AUTH_COOKIE_SECURE_MODE,
    )
elif _AUTH_COOKIE_SECURE_MODE not in {"1", "true", "yes", "on"} and not _env_flag("TRUST_PROXY_HEADERS"):
    logger.warning(
        "[auth] AUTH_COOKIE_SECURE=auto, TRUST_PROXY_HEADERS=0. "
        "HTTPS 를 종료하는 리버스 프록시 뒤에서 서비스한다면 요청 scheme 이 http 로 보여 "
        "인증 쿠키가 non-secure 로 발급될 수 있습니다. 그런 구성이면 TRUST_PROXY_HEADERS=1 "
        "또는 AUTH_COOKIE_SECURE=1 을 설정하세요."
    )


def _resolve_auth_cookie_secure(request: Request) -> bool:
    """쿠키 secure 플래그 결정.

    - AUTH_COOKIE_SECURE=1/0 이면 명시적으로 강제.
    - 기본값(auto)은 기존 동작 유지: request scheme(또는 신뢰된 X-Forwarded-Proto) 기반.
      표준 배포가 프록시 없이 http 로 직접 서비스되므로(README 참고) non-localhost 라고
      무조건 secure=True 로 바꾸면 그 표준 배포의 로그인이 깨진다 — 그래서 판정 로직은
      건드리지 않고, 애매한 구성은 기동 시 로그 경고로만 알린다.
    """
    if _AUTH_COOKIE_SECURE_MODE in {"1", "true", "yes", "on"}:
        return True
    if _AUTH_COOKIE_SECURE_MODE in {"0", "false", "no", "off"}:
        return False
    return _request_is_https(request)


def _set_auth_cookie(response: Response, request: Request, token: str) -> None:
    secure = _resolve_auth_cookie_secure(request)
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        max_age=AUTH_COOKIE_MAX_AGE_SECONDS,
        httponly=True,
        secure=secure,
        samesite="strict",
        path="/",
    )


def _clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(key=AUTH_COOKIE_NAME, path="/", samesite="strict")



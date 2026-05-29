"""WebAuthn (passkey) 헬퍼 — py_webauthn 라이브러리 래핑.

RP ID / origin 은 들어오는 HTTP Request 의 Host 헤더에서 자동 추출한다
(사용자 환경별로 도메인이 달라지므로 env 로 못 박지 않음).
"""
from __future__ import annotations

import base64
import logging
import secrets
from urllib.parse import urlparse

from fastapi import HTTPException, Request
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers.cose import COSEAlgorithmIdentifier
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from rate_limit import trust_proxy_headers

logger = logging.getLogger(__name__)

RP_NAME = "Terminal List"


def derive_rp_info(http_request: Request) -> tuple[str, str]:
    """요청에서 (rp_id, origin) 추출.

    - rp_id = hostname only (포트 제외, IP 도 허용)
    - origin = scheme://host[:port]

    프록시 뒤일 수도 있어 Forwarded / X-Forwarded-* 헤더 도 참고.
    """
    headers = http_request.headers
    # Forwarded headers are only trusted behind a configured reverse proxy.
    # Direct deployments must not let clients choose WebAuthn rp_id/origin.
    if trust_proxy_headers():
        forwarded_host = headers.get("x-forwarded-host") or headers.get("host") or ""
        forwarded_proto = headers.get("x-forwarded-proto")
    else:
        forwarded_host = headers.get("host") or ""
        forwarded_proto = None
    if not forwarded_proto:
        # http_request.url.scheme 은 uvicorn 의 raw scheme. proxy 뒤면 TRUST_PROXY_HEADERS=1 필요.
        forwarded_proto = http_request.url.scheme or "http"
    host = forwarded_host.strip()
    if not host:
        host = http_request.url.netloc
    # rp_id = host 의 hostname 만 (port 제외). 표준 라이브러리 사용.
    parsed = urlparse(f"//{host}", scheme=forwarded_proto)
    rp_id = parsed.hostname or "localhost"
    origin = f"{forwarded_proto}://{host}"
    return rp_id, origin


def _b64u_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64u_decode(data: str) -> bytes:
    pad = 4 - (len(data) % 4)
    if pad and pad < 4:
        data = data + ("=" * pad)
    return base64.urlsafe_b64decode(data.encode("ascii"))


def make_registration_options(
    *,
    rp_id: str,
    username: str,
    existing_credential_ids: list[bytes],
) -> tuple[dict, bytes]:
    """등록용 PublicKeyCredentialCreationOptions JSON 과 challenge 반환.

    excludeCredentials 로 이미 등록된 자격증명은 다시 등록되지 않게 한다.
    """
    opts = generate_registration_options(
        rp_id=rp_id,
        rp_name=RP_NAME,
        user_name=username,
        user_display_name=username,
        # ES256 + RS256 — 광범위한 호환성. webauthn 라이브러리 기본도 이 둘.
        supported_pub_key_algs=[
            COSEAlgorithmIdentifier.ECDSA_SHA_256,
            COSEAlgorithmIdentifier.RSASSA_PKCS1_v1_5_SHA_256,
        ],
        authenticator_selection=AuthenticatorSelectionCriteria(
            # platform 한정 안 함 — USB 보안키도 OK. user verification 은 가능하면 요구.
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
        exclude_credentials=[
            PublicKeyCredentialDescriptor(id=cid) for cid in existing_credential_ids
        ],
    )
    # py_webauthn 의 options_to_json 은 string 반환. dict 으로 다시.
    import json as _json
    body = _json.loads(options_to_json(opts))
    return body, opts.challenge


def make_authentication_options(*, rp_id: str, allow_credential_ids: list[bytes] | None = None) -> tuple[dict, bytes, str]:
    """로그인용 PublicKeyCredentialRequestOptions. challenge_id 도 함께 발급해서
    클라이언트가 complete 단계에서 어떤 challenge 였는지 식별할 수 있게 한다.
    allow_credential_ids 가 비면 username-less (resident key / passkey) 흐름.
    """
    descriptors = [PublicKeyCredentialDescriptor(id=cid) for cid in (allow_credential_ids or [])]
    opts = generate_authentication_options(
        rp_id=rp_id,
        allow_credentials=descriptors,
        user_verification=UserVerificationRequirement.PREFERRED,
    )
    import json as _json
    body = _json.loads(options_to_json(opts))
    challenge_id = secrets.token_urlsafe(24)
    return body, opts.challenge, challenge_id


def verify_registration(
    *,
    response_dict: dict,
    expected_challenge: bytes,
    expected_origin: str,
    expected_rp_id: str,
):
    """py_webauthn.verify_registration_response 의 동기 래퍼.
    잘못된 응답이면 HTTPException(400) 으로 변환.
    """
    try:
        verification = verify_registration_response(
            credential=response_dict,
            expected_challenge=expected_challenge,
            expected_origin=expected_origin,
            expected_rp_id=expected_rp_id,
            require_user_verification=False,
        )
        return verification
    except Exception as e:  # webauthn 의 InvalidRegistrationResponse 등
        # 상세 원인은 서버 로그에만 남기고 클라이언트엔 일반 메시지.
        logger.warning("passkey registration verification failed: %s", e)
        raise HTTPException(status_code=400, detail="패스키 등록 검증에 실패했습니다.")


def verify_authentication(
    *,
    response_dict: dict,
    expected_challenge: bytes,
    expected_origin: str,
    expected_rp_id: str,
    credential_public_key: bytes,
    credential_current_sign_count: int,
):
    try:
        verification = verify_authentication_response(
            credential=response_dict,
            expected_challenge=expected_challenge,
            expected_origin=expected_origin,
            expected_rp_id=expected_rp_id,
            credential_public_key=credential_public_key,
            credential_current_sign_count=credential_current_sign_count,
            require_user_verification=False,
        )
        return verification
    except Exception as e:
        logger.warning("passkey authentication verification failed: %s", e)
        raise HTTPException(status_code=401, detail="패스키 인증에 실패했습니다.")

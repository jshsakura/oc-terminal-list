"""인증 라우트 — 로그인/토큰, OTP(TOTP), 패스키(WebAuthn).

main.py 에서 분리. 전역 auth_manager 를 역참조하는 대신 _deps.get_auth_manager() 를
쓴다 — main → routes 단방향 의존이라야 순환 import 가 안 생긴다.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response

from _deps import AUTH_COOKIE_NAME, get_auth_manager, verify_auth_token
from auth_cookie import _clear_auth_cookie, _set_auth_cookie
from models import (
    LoginRequest, OtpDisableRequest, OtpEnableRequest, OtpLoginRequest,
    PasskeyLoginCompleteRequest, PasskeyRegisterBeginRequest,
    PasskeyRegisterCompleteRequest, PasskeyRenameRequest,
    PasswordChangeRequest, SetupRequest,
)
from passkey import (
    derive_rp_info,
    make_authentication_options,
    make_registration_options,
    verify_authentication as _verify_authn,
    verify_registration as _verify_reg,
)
from rate_limit import check_rate_limit, client_ip_from_request
from sqlite_storage import storage

logger = logging.getLogger(__name__)

router = APIRouter(tags=["auth"])


@router.get("/api/auth/status")
async def auth_status():
    if get_auth_manager() is None:
        return {"setup_complete": False, "passkey_available": False}
    setup_complete = await get_auth_manager().is_setup_complete()
    passkey_available = False
    if setup_complete:
        admin = await storage.get_admin()
        if admin:
            creds = await storage.list_passkey_credentials(admin["username"])
            passkey_available = len(creds) > 0
    return {"setup_complete": setup_complete, "passkey_available": passkey_available}


@router.post("/api/auth/setup")
async def setup_admin(request: SetupRequest):
    if get_auth_manager() is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    if await get_auth_manager().is_setup_complete():
        raise HTTPException(status_code=400, detail="이미 초기 설정이 완료되었습니다")
    if len(request.username) < 3:
        raise HTTPException(status_code=400, detail="사용자명은 3자 이상이어야 합니다")
    if len(request.password) < 8:
        raise HTTPException(status_code=400, detail="비밀번호는 8자 이상이어야 합니다")
    if not await get_auth_manager().create_admin(request.username, request.password):
        raise HTTPException(status_code=500, detail="관리자 계정 생성 실패")
    return {"success": True, "message": "관리자 계정이 생성되었습니다"}


@router.post("/api/auth/login")
async def login(request: LoginRequest, http_request: Request, response: Response):
    if get_auth_manager() is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    # rate limit: IP 당 60초 10회, username 당 5분 20회.
    # IP 만 보면 NAT 뒤 여러 사용자가 같이 깎이고, username 만 보면 IP 분산 공격을 못 막음.
    ip = client_ip_from_request(http_request)
    check_rate_limit(f"login:ip:{ip}", max_attempts=10, window_seconds=60)
    check_rate_limit(f"login:user:{request.username}", max_attempts=20, window_seconds=300)
    if not await get_auth_manager().is_setup_complete():
        raise HTTPException(status_code=400, detail="초기 설정을 먼저 완료해주세요")
    if not await get_auth_manager().verify_admin(request.username, request.password):
        raise HTTPException(status_code=401, detail="사용자명 또는 비밀번호가 올바르지 않습니다")
    if await get_auth_manager().is_otp_enabled():
        pending = await get_auth_manager().create_otp_pending_token(request.username)
        return {
            "otp_required": True,
            "pending_token": pending,
            "username": request.username,
        }
    access_token = await get_auth_manager().create_access_token(request.username)
    _set_auth_cookie(response, http_request, access_token)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "username": request.username,
        "otp_required": False,
    }


@router.post("/api/auth/login/otp")
async def login_otp(request: OtpLoginRequest, http_request: Request, response: Response):
    if get_auth_manager() is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    # OTP 무차별 대입 방지 — 6자리 코드(100만 조합)는 짧은 시간 안 5회 시도면
    # 통계적으로 위험. IP + pending_token 양쪽 limit.
    ip = client_ip_from_request(http_request)
    check_rate_limit(f"otp:ip:{ip}", max_attempts=5, window_seconds=60)
    check_rate_limit(f"otp:tok:{request.pending_token[:32]}", max_attempts=5, window_seconds=300)
    username = await get_auth_manager().verify_otp_pending_token(request.pending_token)
    if not username:
        raise HTTPException(status_code=401, detail="OTP 인증 시간이 만료되었습니다. 다시 로그인해주세요.")
    if request.is_backup_code:
        ok = await get_auth_manager().consume_backup_code(username, request.code)
    else:
        ok = await get_auth_manager().verify_otp_code(username, request.code)
    if not ok:
        raise HTTPException(status_code=401, detail="OTP 코드가 올바르지 않습니다")
    access_token = await get_auth_manager().create_access_token(username)
    _set_auth_cookie(response, http_request, access_token)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "username": username,
        "otp_required": False,
    }


@router.get("/api/auth/verify")
async def verify_token(
    request: Request,
    response: Response,
    username: str = Depends(verify_auth_token),
    authorization: str | None = Header(None),
    auth_cookie: str | None = Cookie(None, alias=AUTH_COOKIE_NAME),
):
    # Smooth migration: an old localStorage Bearer token that still verifies is
    # promoted to the new HttpOnly cookie, then the frontend can delete it.
    if authorization and authorization.startswith("Bearer ") and not auth_cookie:
        bearer = authorization[len("Bearer "):].strip()
        if bearer and bearer.lower() not in {"null", "undefined"}:
            _set_auth_cookie(response, request, bearer)
    return {"valid": True, "username": username}


@router.post("/api/auth/refresh")
async def refresh_token(
    request: Request,
    response: Response,
    username: str = Depends(verify_auth_token),
):
    """현재 유효한 토큰으로 만료 시각을 새로 24h 미룬 토큰을 재발급.
    활동 중인 사용자가 24h 정각에 튕기지 않게 프론트가 주기적으로 호출한다.
    (만료된 토큰은 Depends 에서 401 → 프론트가 로그인 유도)"""
    if get_auth_manager() is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    access_token = await get_auth_manager().create_access_token(username)
    _set_auth_cookie(response, request, access_token)
    return {"access_token": access_token, "token_type": "bearer", "username": username}


@router.post("/api/auth/logout")
async def logout(response: Response):
    _clear_auth_cookie(response)
    return {"success": True}


@router.post("/api/auth/change-password")
async def change_password(
    request: PasswordChangeRequest,
    response: Response,
    username: str = Depends(verify_auth_token),
):
    """현재 비밀번호 확인 후 새 비밀번호로 변경. 성공 시 세션 쿠키 무효화."""
    if get_auth_manager() is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    if len(request.new_password) < 8:
        raise HTTPException(status_code=400, detail="비밀번호는 8자 이상이어야 합니다")
    if request.new_password == request.current_password:
        raise HTTPException(status_code=400, detail="새 비밀번호가 기존 비밀번호와 같습니다")
    changed = await get_auth_manager().change_password(
        username, request.current_password, request.new_password
    )
    if not changed:
        raise HTTPException(status_code=401, detail="현재 비밀번호가 올바르지 않습니다")
    # 비밀번호 변경 후 재로그인 강제 — 기존 세션 쿠키 제거
    _clear_auth_cookie(response)
    return {"success": True}


# ---------------------- OTP (TOTP) 관리 ----------------------

@router.get("/api/auth/otp/status")
async def otp_status(username: str = Depends(verify_auth_token)):
    if get_auth_manager() is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    return await get_auth_manager().get_otp_status()


@router.post("/api/auth/otp/setup")
async def otp_setup(username: str = Depends(verify_auth_token)):
    """새 비밀키 발급 → provisioning URI 반환. 아직 활성화는 안 됨."""
    if get_auth_manager() is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    if await get_auth_manager().is_otp_enabled():
        raise HTTPException(status_code=400, detail="이미 OTP가 활성화되어 있습니다. 먼저 비활성화 후 다시 설정하세요.")
    return await get_auth_manager().begin_otp_setup(username)


@router.post("/api/auth/otp/enable")
async def otp_enable(request: OtpEnableRequest, username: str = Depends(verify_auth_token)):
    """첫 OTP 코드 검증 → 활성화 + 백업코드 발급."""
    if get_auth_manager() is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    backup_codes = await get_auth_manager().enable_otp(username, request.code)
    if backup_codes is None:
        raise HTTPException(status_code=400, detail="OTP 코드가 올바르지 않거나 setup 이 먼저 필요합니다")
    return {"enabled": True, "backup_codes": backup_codes}


@router.post("/api/auth/otp/disable")
async def otp_disable(request: OtpDisableRequest, username: str = Depends(verify_auth_token)):
    """비밀번호 재확인 후 OTP 비활성화 + 비밀키/백업코드 삭제."""
    if get_auth_manager() is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    if not await get_auth_manager().verify_admin(username, request.password):
        raise HTTPException(status_code=401, detail="비밀번호가 올바르지 않습니다")
    await get_auth_manager().disable_otp(username)
    return {"enabled": False}


@router.post("/api/auth/otp/backup-codes/regenerate")
async def otp_regenerate_backup_codes(username: str = Depends(verify_auth_token)):
    """기존 백업코드 폐기 후 새로 10개 발급."""
    if get_auth_manager() is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    if not await get_auth_manager().is_otp_enabled():
        raise HTTPException(status_code=400, detail="OTP가 활성화되지 않았습니다")
    codes = await get_auth_manager().issue_backup_codes(username)
    return {"backup_codes": codes}


# ---------------------- 패스키 (WebAuthn) ----------------------
# RP ID / origin 은 들어오는 Request 의 Host 헤더에서 추출 (env 박지 않음).
# challenge 는 AuthManager 의 in-memory dict 에 5분만 보관.

@router.post("/api/auth/passkey/register/begin")
async def passkey_register_begin(
    request: PasskeyRegisterBeginRequest,
    http_request: Request,
    username: str = Depends(verify_auth_token),
):
    """기존(비번/OTP) 인증을 통과한 사용자가 새 패스키를 등록하기 위한 challenge 발급."""
    if get_auth_manager() is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    rp_id, _origin = derive_rp_info(http_request)
    existing = await storage.list_passkey_credentials(username)
    options, challenge = make_registration_options(
        rp_id=rp_id,
        username=username,
        existing_credential_ids=[c["credential_id"] for c in existing],
    )
    get_auth_manager()._store_passkey_challenge("register", username, challenge)
    return {"options": options, "rp_id": rp_id}


@router.post("/api/auth/passkey/register/complete")
async def passkey_register_complete(
    request: PasskeyRegisterCompleteRequest,
    http_request: Request,
    username: str = Depends(verify_auth_token),
):
    if get_auth_manager() is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    challenge = get_auth_manager()._consume_passkey_challenge("register", username)
    if not challenge:
        raise HTTPException(status_code=400, detail="등록 세션이 만료되었습니다. 다시 시작해주세요.")
    rp_id, origin = derive_rp_info(http_request)
    verification = _verify_reg(
        response_dict=request.response,
        expected_challenge=challenge,
        expected_origin=origin,
        expected_rp_id=rp_id,
    )
    transports = []
    raw_transports = (request.response or {}).get("response", {}).get("transports")
    if isinstance(raw_transports, list):
        transports = [str(t) for t in raw_transports if t]
    label = (request.label or "").strip() or None
    row_id = await storage.add_passkey_credential(
        username=username,
        credential_id=verification.credential_id,
        public_key=verification.credential_public_key,
        sign_count=int(verification.sign_count or 0),
        transports=transports,
        label=label,
        aaguid=getattr(verification, "aaguid", None) and bytes(verification.aaguid) if hasattr(verification, "aaguid") else None,
        backup_eligible=bool(getattr(verification, "credential_backed_up", False)),
        backup_state=bool(getattr(verification, "credential_backed_up", False)),
    )
    return {"status": "registered", "id": row_id, "label": label}


@router.post("/api/auth/passkey/login/begin")
async def passkey_login_begin(http_request: Request):
    """로그인 challenge — 단일 admin 환경이라 allowCredentials 를 그 사용자의 자격증명으로 미리 채운다.
    setup 미완료면 거절. rate-limit IP 기준.
    """
    if get_auth_manager() is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    ip = client_ip_from_request(http_request)
    check_rate_limit(f"passkey:ip:{ip}", max_attempts=20, window_seconds=60)
    if not await get_auth_manager().is_setup_complete():
        raise HTTPException(status_code=400, detail="초기 설정을 먼저 완료해주세요")
    rp_id, _ = derive_rp_info(http_request)
    # 단일 admin 가정. resident key 흐름 위해 list 가 비어도 동작은 가능하지만
    # 등록된 패스키가 하나도 없으면 명시적으로 안내한다.
    admin = await storage.get_admin()
    all_creds = await storage.list_passkey_credentials(admin["username"]) if admin else []
    if not all_creds:
        raise HTTPException(status_code=400, detail="등록된 패스키가 없습니다")
    options, challenge, challenge_id = make_authentication_options(
        rp_id=rp_id,
        allow_credential_ids=[c["credential_id"] for c in all_creds],
    )
    get_auth_manager()._store_passkey_challenge("authenticate", challenge_id, challenge)
    return {"options": options, "challenge_id": challenge_id, "rp_id": rp_id}


@router.post("/api/auth/passkey/login/complete")
async def passkey_login_complete(request: PasskeyLoginCompleteRequest, http_request: Request, response: Response):
    if get_auth_manager() is None:
        raise HTTPException(status_code=500, detail="인증 시스템이 초기화되지 않았습니다")
    ip = client_ip_from_request(http_request)
    check_rate_limit(f"passkey:ip:{ip}", max_attempts=20, window_seconds=60)
    challenge = get_auth_manager()._consume_passkey_challenge("authenticate", request.challenge_id)
    if not challenge:
        raise HTTPException(status_code=401, detail="인증 세션이 만료되었습니다. 다시 시도해주세요.")
    rp_id, origin = derive_rp_info(http_request)

    # 응답 객체의 rawId 또는 id (base64url) 에서 credential_id 추출 → DB 조회
    raw_id = (request.response or {}).get("rawId") or (request.response or {}).get("id")
    if not isinstance(raw_id, str) or not raw_id:
        raise HTTPException(status_code=400, detail="잘못된 패스키 응답")
    from passkey import _b64u_decode
    try:
        credential_id = _b64u_decode(raw_id)
    except Exception:
        raise HTTPException(status_code=400, detail="credential_id 디코딩 실패")
    cred = await storage.get_passkey_credential(credential_id)
    if not cred:
        raise HTTPException(status_code=401, detail="등록되지 않은 패스키입니다")

    verification = _verify_authn(
        response_dict=request.response,
        expected_challenge=challenge,
        expected_origin=origin,
        expected_rp_id=rp_id,
        credential_public_key=cred["public_key"],
        credential_current_sign_count=cred["sign_count"],
    )
    await storage.update_passkey_after_use(
        credential_id=cred["credential_id"],
        sign_count=int(verification.new_sign_count or 0),
    )
    access_token = await get_auth_manager().create_access_token(cred["username"])
    _set_auth_cookie(response, http_request, access_token)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "username": cred["username"],
        "otp_required": False,
    }


@router.get("/api/auth/passkey/list")
async def passkey_list(username: str = Depends(verify_auth_token)):
    rows = await storage.list_passkey_credentials(username)
    from passkey import _b64u_encode
    return {
        "items": [
            {
                "id": r["id"],
                "label": r["label"],
                "credential_id_b64": _b64u_encode(r["credential_id"]),
                "transports": r["transports"],
                "created_at": r["created_at"],
                "last_used_at": r["last_used_at"],
            }
            for r in rows
        ]
    }


@router.patch("/api/auth/passkey/{row_id}")
async def passkey_rename(row_id: int, request: PasskeyRenameRequest, username: str = Depends(verify_auth_token)):
    ok = await storage.rename_passkey_credential(row_id, username, request.label)
    if not ok:
        raise HTTPException(status_code=404, detail="패스키를 찾을 수 없습니다")
    return {"status": "renamed"}


@router.delete("/api/auth/passkey/{row_id}")
async def passkey_delete(row_id: int, username: str = Depends(verify_auth_token)):
    ok = await storage.delete_passkey_credential(row_id, username)
    if not ok:
        raise HTTPException(status_code=404, detail="패스키를 찾을 수 없습니다")
    return {"status": "deleted"}

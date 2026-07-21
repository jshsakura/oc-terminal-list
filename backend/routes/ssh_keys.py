"""SSH 개인키 보관 — 등록/수정/삭제.

개인키·패스프레이즈는 vault 로 암호화해 저장하고, 목록 응답에는 절대 싣지 않는다.
실제 복호화는 접속 시점에 resolve_host_secrets 가 한다.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from _deps import verify_auth_token
from models import SshKeyCreateRequest, SshKeyUpdateRequest
from sqlite_storage import storage
from vault import encrypt_str

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ssh-keys", tags=["ssh-keys"])


@router.get("")
async def list_ssh_keys(username: str = Depends(verify_auth_token)):
    return {"items": await storage.list_ssh_keys(username)}


@router.post("")
async def create_ssh_key(request: SshKeyCreateRequest, username: str = Depends(verify_auth_token)):
    import uuid
    key_id = str(uuid.uuid4())
    private_key_enc = encrypt_str(request.private_key)
    if private_key_enc is None:
        raise HTTPException(status_code=400, detail="개인키가 비어있습니다")
    passphrase_enc = encrypt_str(request.passphrase) if request.passphrase else None
    await storage.create_ssh_key(
        key_id=key_id,
        username=username,
        name=request.name,
        public_key=request.public_key,
        private_key_enc=private_key_enc,
        passphrase_enc=passphrase_enc,
    )
    return {"id": key_id, "name": request.name, "status": "created"}


@router.put("/{key_id}")
async def update_ssh_key(
    key_id: str,
    request: SshKeyUpdateRequest,
    username: str = Depends(verify_auth_token),
):
    private_key_enc = encrypt_str(request.private_key) if request.private_key else None
    passphrase_enc = encrypt_str(request.passphrase) if request.passphrase else None
    ok = await storage.update_ssh_key(
        key_id=key_id,
        username=username,
        name=request.name,
        public_key=request.public_key,
        private_key_enc=private_key_enc,
        passphrase_enc=passphrase_enc,
        clear_passphrase=request.clear_passphrase,
    )
    if not ok:
        raise HTTPException(status_code=404, detail="키를 찾을 수 없거나 변경할 내용이 없습니다")
    return {"id": key_id, "status": "updated"}


@router.delete("/{key_id}")
async def delete_ssh_key(key_id: str, username: str = Depends(verify_auth_token)):
    ok = await storage.delete_ssh_key(key_id, username)
    if not ok:
        raise HTTPException(status_code=404, detail="키를 찾을 수 없습니다")
    return {"id": key_id, "status": "deleted"}

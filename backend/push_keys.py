"""웹 푸시 VAPID 키 — data/.vault-key 와 같은 자동관리 방식.

VAPID 는 "이 푸시를 보낸 게 누구인가"를 브라우저 푸시 서비스에 증명하는 키쌍이다.
공개키는 클라이언트가 구독할 때 쓰고(브라우저가 그 키로 구독을 묶는다), 개인키는
발송할 때 서명에 쓴다.

⚠️ 키가 바뀌면 **기존 구독이 전부 무효가 된다** — 브라우저가 구독을 공개키에
묶어두기 때문이다. 그래서 한 번 만들면 파일로 보존한다(.env 에 넣지 않는다).
"""
from __future__ import annotations

import base64
import logging
import os
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_VAPID_KEY_PATH = _PROJECT_ROOT / "data" / ".vapid-key"

_cache: dict | None = None


def _key_path() -> Path:
    return Path(os.getenv("VAPID_KEY_PATH") or _DEFAULT_VAPID_KEY_PATH)


def _b64url(raw: bytes) -> str:
    """푸시 프로토콜은 패딩 없는 base64url 을 쓴다."""
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _load_or_create_private_key() -> ec.EllipticCurvePrivateKey:
    path = _key_path()
    if path.exists():
        raw = path.read_bytes().strip()
        if raw:
            try:
                return serialization.load_pem_private_key(raw, password=None)
            except Exception as e:
                # 깨진 키를 조용히 새 키로 갈면 기존 구독이 전부 죽는다 — 시끄럽게 알린다.
                raise RuntimeError(
                    f"VAPID 키 파일을 읽을 수 없습니다: {path}. 파일을 지우면 새로 생성되지만, "
                    f"기존 푸시 구독은 모두 무효가 됩니다."
                ) from e

    path.parent.mkdir(parents=True, exist_ok=True)
    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, pem)
    finally:
        os.close(fd)
    logger.info("VAPID 키 생성: %s", path)
    return key


def get_vapid_keys() -> dict:
    """{'public': <base64url>, 'private': <base64url>}. 프로세스 수명 동안 캐시.

    ⚠️ 개인키는 **raw 32바이트 스칼라의 base64url** 이어야 한다. py-vapid 의
    `from_string` 이 길이 32면 raw, 아니면 DER 로 해석한다 — PEM 을 넘기면
    "ASN.1 parsing error" 로 죽는다. 디스크에는 PEM 으로 보관하고(표준 포맷),
    라이브러리에 넘길 때만 이 형태로 변환한다.
    """
    global _cache
    if _cache is not None:
        return _cache

    key = _load_or_create_private_key()
    public_numbers = key.public_key().public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    _cache = {
        "public": _b64url(public_numbers),
        "private": _b64url(key.private_numbers().private_value.to_bytes(32, "big")),
    }
    return _cache


def get_public_key() -> str:
    return get_vapid_keys()["public"]

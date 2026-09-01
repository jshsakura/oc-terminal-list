"""API 요청 본문 모델 — Pydantic.

라우트 모듈 여러 곳이 같은 모델을 쓰므로 한 곳에 모은다. 검증 규칙(길이 상한,
필드 정규화)이 곧 시스템 경계의 입력 검증이라 여기가 단일 진실 공급원이다.
"""
from __future__ import annotations

import re

from pydantic import BaseModel, field_validator

import multiplexer


class ResizeRequest(BaseModel):
    cols: int
    rows: int


class SessionCreateRequest(BaseModel):
    cols: int = 80
    rows: int = 24
    cwd: str | None = None
    shell: str | None = None


class SessionNameRequest(BaseModel):
    name: str


class SetupRequest(BaseModel):
    username: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


class OtpLoginRequest(BaseModel):
    pending_token: str
    code: str
    is_backup_code: bool = False


class OtpEnableRequest(BaseModel):
    code: str


class OtpDisableRequest(BaseModel):
    password: str


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str




class SshKeyCreateRequest(BaseModel):
    name: str
    private_key: str
    passphrase: str | None = None
    public_key: str | None = None


class SshKeyUpdateRequest(BaseModel):
    # 모든 필드 옵셔널. private_key 가 비어있으면 기존 키 유지 (보안: 평문 노출 방지를 위한 write-once 정책 유지).
    name: str | None = None
    private_key: str | None = None  # 새 키로 교체할 때만 채움
    passphrase: str | None = None
    clear_passphrase: bool = False     # passphrase 제거 의도 명시 (빈 문자열과 구분)
    public_key: str | None = None


_HOSTNAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-:]{0,253}$")
_SSH_USER_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9._\-]{0,63}$")
_REMOTE_TMUX_SESSION_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_MAX_START_PATH_LEN = 4096


class HostUpsertRequest(BaseModel):
    name: str
    hostname: str
    port: int = 22
    ssh_user: str
    auth_method: str = "key"        # 'key' | 'password'

    @field_validator("hostname")
    @classmethod
    def _check_hostname(cls, v: str) -> str:
        # 선행 '-' 금지 — ssh argv 옵션처럼 해석되는 인자 인젝션 방어.
        # 영문/숫자/점/하이픈/언더스코어/콜론(IPv6 :) 만 허용. 길이 254.
        if not v or not _HOSTNAME_RE.match(v):
            raise ValueError("invalid hostname")
        return v

    @field_validator("ssh_user")
    @classmethod
    def _check_ssh_user(cls, v: str) -> str:
        if not v or not _SSH_USER_RE.match(v):
            raise ValueError("invalid ssh_user")
        return v

    @field_validator("port")
    @classmethod
    def _check_port(cls, v: int) -> int:
        if v < 1 or v > 65535:
            raise ValueError("invalid port")
        return v
    key_id: str | None = None
    password: str | None = None  # 평문으로 들어와서 vault 로 암호화 후 저장
    color_index: int = 0
    group_name: str | None = None
    use_remote_tmux: bool = True
    # 'tmux' | 'herdr' | 'none'. None 이면 옛 use_remote_tmux 로 되짚는다
    # (backend/multiplexer.from_host_row) — 옛 클라이언트가 이 칸을 안 보낸다.
    multiplexer: str | None = None
    remote_tmux_session: str | None = "mobile"
    start_path: str | None = None
    icon: str | None = None
    theme: str | None = None  # pane.themeOverride 자동 적용용 (없으면 글로벌 settings.theme)

    @field_validator("multiplexer")
    @classmethod
    def _check_multiplexer(cls, v: str | None) -> str | None:
        """모르는 값은 **거절**한다 — 조용히 기본값으로 접지 않는다.

        이건 사용자가 화면에서 고른 값이라, 오타로 tmux 가 되면 "골랐는데 안 바뀐다" 가
        된다. 되짚기(None)와 잘못된 값은 다른 사건이다.
        """
        if v is None or v == "":
            return None
        if v not in multiplexer.CHOICES:
            raise ValueError("invalid multiplexer")
        return v

    @field_validator("remote_tmux_session")
    @classmethod
    def _check_remote_tmux_session(cls, v: str | None) -> str | None:
        # 원격 tmux 세션명으로 그대로 쓰이므로(effective_tmux_session 등) 영문/숫자/하이픈/
        # 언더스코어만 허용 — tmux 커맨드 인자 인젝션/구분자 오염 방지.
        if v is None or v == "":
            return v
        if not _REMOTE_TMUX_SESSION_RE.match(v):
            raise ValueError("invalid remote_tmux_session")
        return v

    @field_validator("start_path")
    @classmethod
    def _check_start_path(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return v
        if "\x00" in v:
            raise ValueError("invalid start_path: null byte")
        if len(v) >= _MAX_START_PATH_LEN:
            raise ValueError(f"start_path too long (>{_MAX_START_PATH_LEN} chars)")
        return v


class WsTicketRequest(BaseModel):
    path: str


class FileTicketRequest(BaseModel):
    path: str


class PasskeyRegisterBeginRequest(BaseModel):
    label: str | None = None  # 사용자 메모 (예: "MacBook Air")


class PasskeyRegisterCompleteRequest(BaseModel):
    label: str | None = None
    response: dict  # 브라우저 navigator.credentials.create() 결과 (JSON 직렬화된 PublicKeyCredential)


class PasskeyLoginCompleteRequest(BaseModel):
    challenge_id: str  # begin 단계에서 발급한 임시 ID (challenge 캐시 key)
    response: dict     # 브라우저 navigator.credentials.get() 결과


class PasskeyRenameRequest(BaseModel):
    label: str

    @field_validator("label")
    @classmethod
    def _check_label(cls, v: str) -> str:
        s = (v or "").strip()
        if not s or len(s) > 64:
            raise ValueError("label required (≤64 chars)")
        return s


class CommandHistoryPushRequest(BaseModel):
    terminal_key: str
    text: str

    @field_validator("terminal_key")
    @classmethod
    def _check_terminal_key(cls, v: str) -> str:
        s = (v or "").strip()
        if not s or len(s) > 128:
            raise ValueError("terminal_key required (≤128 chars)")
        return s

    @field_validator("text")
    @classmethod
    def _check_text(cls, v: str) -> str:
        # 빈/공백 only / 너무 긴 텍스트는 거절. 호출 측이 trim 했다고 가정하지만 방어.
        s = (v or "").replace("\r", "").rstrip("\n").strip()
        if not s:
            raise ValueError("text empty")
        if len(s) > 500:
            raise ValueError("text too long (>500)")
        return s


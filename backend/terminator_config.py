"""Terminator's connection: the Z.ai key and the model, set from the settings screen.

Both live as files under ~/.config/zai, not in the database or the vault: the key is the
user's own credential for their own plan, and a file the person can also write by hand
(or a worker image can mount) is the whole interface. The key is write-only over the API:
it is never sent back, only whether it is set and its last four characters.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

CONFIG_DIR = "~/.config/zai"
KEY_NAME = "api_key"
MODEL_NAME = "terminator_model"
DEFAULT_MODEL = "glm-5.3-flash"

KEY_MIN_CHARS = 16
KEY_MAX_CHARS = 512
KEY_HINT_CHARS = 4
_KEY_RE = re.compile(r"^[\x21-\x7e]+$")          # printable ASCII, no spaces
_MODEL_RE = re.compile(r"^[a-z0-9][a-z0-9.\-]{0,63}$")


def _dir() -> Path:
    return Path(os.path.expanduser(CONFIG_DIR))


def _read(name: str) -> str | None:
    try:
        return (_dir() / name).read_text(encoding="utf-8").strip() or None
    except OSError:
        return None


def _write_private(name: str, value: str) -> None:
    """Write via a 0600 temp file and rename, so the key is never briefly world-readable."""
    folder = _dir()
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    tmp = folder / f".{name}.tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(value + "\n")
    os.replace(tmp, folder / name)


def _remove(name: str) -> None:
    try:
        (_dir() / name).unlink()
    except FileNotFoundError:
        pass


def read_key() -> str | None:
    return _read(KEY_NAME)


def read_model() -> str:
    model = _read(MODEL_NAME)
    return model if model and _MODEL_RE.match(model) else DEFAULT_MODEL


def validate_key(key: str) -> str:
    key = (key or "").strip()
    if not (KEY_MIN_CHARS <= len(key) <= KEY_MAX_CHARS) or not _KEY_RE.match(key):
        raise ValueError("키 모양이 맞지 않습니다. Z.ai 에서 받은 키를 그대로 붙여 넣습니다")
    return key


def validate_model(model: str) -> str:
    model = (model or "").strip().lower()
    if not _MODEL_RE.match(model):
        raise ValueError("모델 이름은 영문 소문자·숫자·점·하이픈으로 씁니다")
    return model


def save(*, key: str | None = None, model: str | None = None, clear_key: bool = False) -> None:
    """Validate everything first, then write, so a bad model does not leave a half-saved key."""
    new_key = validate_key(key) if key else None
    new_model = validate_model(model) if model is not None and model.strip() else None
    if clear_key:
        _remove(KEY_NAME)
    elif new_key:
        _write_private(KEY_NAME, new_key)
    if new_model is not None:
        if new_model == DEFAULT_MODEL:
            _remove(MODEL_NAME)
        else:
            _write_private(MODEL_NAME, new_model)
    elif model is not None:                     # an emptied field goes back to the default
        _remove(MODEL_NAME)


def describe() -> dict:
    key = read_key()
    return {
        "configured": key is not None,
        "key_hint": key[-KEY_HINT_CHARS:] if key and len(key) > KEY_HINT_CHARS * 2 else None,
        "model": read_model(),
        "default_model": DEFAULT_MODEL,
    }

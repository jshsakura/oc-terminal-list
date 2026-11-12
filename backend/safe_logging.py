"""Keep credential-bearing service URLs out of formatted logs and tracebacks."""
from __future__ import annotations

import logging
import re
from typing import Final

_TELEGRAM_TOKEN: Final = re.compile(r"(https?://api\.telegram\.org/bot)[^/\s?\"']+", re.IGNORECASE)
_QUERY_SECRET: Final = re.compile(
    r"([?&](?:ticket|token|access_token|auth|password|api_key)=)[^&\s\"']+", re.IGNORECASE,
)
_POLL_SUCCESS: Final = re.compile(
    r'^HTTP Request: POST https://api\.telegram\.org/bot[^/ ]+/getUpdates "HTTP/[^ ]+ 200 OK"$',
    re.IGNORECASE,
)


class CredentialSafeFormatter(logging.Formatter):
    def __init__(self, original: logging.Formatter) -> None:
        super().__init__()
        self.original = original

    def format(self, record: logging.LogRecord) -> str:
        formatted = self.original.format(record)
        return _QUERY_SECRET.sub(r"\1[redacted]", _TELEGRAM_TOKEN.sub(r"\1[redacted]", formatted))


class QuietTelegramPolling(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return record.levelno != logging.INFO or _POLL_SUCCESS.fullmatch(record.getMessage()) is None


def install() -> None:
    """Protect existing handlers without replacing their formats or error visibility."""
    for name in ("", "uvicorn", "uvicorn.error", "uvicorn.access"):
        for handler in logging.getLogger(name).handlers:
            if not isinstance(handler.formatter, CredentialSafeFormatter):
                handler.setFormatter(CredentialSafeFormatter(handler.formatter or logging.Formatter()))
    http_logger = logging.getLogger("httpx")
    if not any(isinstance(item, QuietTelegramPolling) for item in http_logger.filters):
        http_logger.addFilter(QuietTelegramPolling())

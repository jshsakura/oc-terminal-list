"""Exercise the real logging/HTTP boundary using only synthetic credentials."""
import io
import logging

import httpx
import pytest

from safe_logging import CredentialSafeFormatter, QuietTelegramPolling


@pytest.fixture
def output():
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(CredentialSafeFormatter(logging.Formatter('%(levelname)s %(message)s')))
    logger = logging.getLogger('httpx')
    old_level = logger.level
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    quiet = QuietTelegramPolling()
    logger.addFilter(quiet)
    yield stream, logger
    logger.removeFilter(quiet)
    logger.removeHandler(handler)
    logger.setLevel(old_level)
    handler.close()


def test_real_http_request_does_not_log_bot_credential(output):
    stream, _ = output
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={'ok': True}))
    with httpx.Client(transport=transport) as client:
        client.post('https://api.telegram.org/bot12345:synthetic-secret/sendMessage')
    text = stream.getvalue()
    assert 'synthetic-secret' not in text
    assert '/bot[redacted]/sendMessage' in text
    assert '200 OK' in text


def test_successful_poll_is_quiet_but_failure_is_visible(output):
    stream, _ = output
    transport = httpx.MockTransport(lambda request: httpx.Response(502 if request.content else 200))
    with httpx.Client(transport=transport) as client:
        client.post('https://api.telegram.org/bot12345:synthetic-secret/getUpdates')
        assert stream.getvalue() == ''
        client.post('https://api.telegram.org/bot12345:synthetic-secret/getUpdates', content=b'failed')
    text = stream.getvalue()
    assert '502 Bad Gateway' in text
    assert 'synthetic-secret' not in text


def test_exception_traceback_and_query_credentials_are_redacted(output):
    stream, logger = output
    try:
        raise httpx.ConnectError('https://api.telegram.org/bot12345:synthetic-secret/getUpdates')
    except httpx.ConnectError:
        logger.exception('failure /ws/terminal?ticket=temporary-secret&reason=resume')
    text = stream.getvalue()
    assert 'ConnectError' in text
    assert 'Traceback' in text
    assert 'synthetic-secret' not in text
    assert 'temporary-secret' not in text
    assert 'reason=resume' in text

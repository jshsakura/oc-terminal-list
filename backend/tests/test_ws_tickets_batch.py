"""POST /api/ws-tickets — batch issuance for boot.

The batch exists to collapse one POST per pane into one POST per page load. The
rules it must not break: one ticket per *slot* (not per path), positional
results, single use, and the same path binding the single-shot route enforces.
"""
from __future__ import annotations

import pytest

from routes.ws_tickets import MAX_BATCH_PATHS, WsTicketBatchRequest, create_ws_tickets
from tickets import _consume_ws_ticket, _ws_tickets
from fastapi import HTTPException


@pytest.fixture(autouse=True)
def _clear_tickets():
    _ws_tickets.clear()
    yield
    _ws_tickets.clear()


async def _issue(paths):
    return await create_ws_tickets(WsTicketBatchRequest(paths=paths), username="u1")


async def test_results_are_positional():
    out = await _issue(["/ws/a", "/ws/b", "/ws/c"])
    assert len(out["tickets"]) == 3
    assert _consume_ws_ticket(out["tickets"][0]["ticket"], "/ws/a") == "u1"
    assert _consume_ws_ticket(out["tickets"][1]["ticket"], "/ws/b") == "u1"


async def test_same_path_twice_gets_two_distinct_tickets():
    """Every remote pane on one host shares a ws path, and tickets are single
    use — collapsing them by path would leave all but the first pane unable to
    attach."""
    out = await _issue(["/ws/host/h1", "/ws/host/h1"])
    first, second = out["tickets"]
    assert first["ticket"] != second["ticket"]
    assert _consume_ws_ticket(first["ticket"], "/ws/host/h1") == "u1"
    assert _consume_ws_ticket(second["ticket"], "/ws/host/h1") == "u1"


async def test_ticket_is_bound_to_its_path():
    out = await _issue(["/ws/a"])
    assert _consume_ws_ticket(out["tickets"][0]["ticket"], "/ws/b") is None


async def test_ticket_is_single_use():
    out = await _issue(["/ws/a"])
    ticket = out["tickets"][0]["ticket"]
    assert _consume_ws_ticket(ticket, "/ws/a") == "u1"
    assert _consume_ws_ticket(ticket, "/ws/a") is None


async def test_bad_path_only_nulls_its_own_slot():
    out = await _issue(["/ws/a", "not-a-ws-path", "/ws/c"])
    assert out["tickets"][0] is not None
    assert out["tickets"][1] is None
    assert out["tickets"][2] is not None


async def test_batch_size_is_capped():
    with pytest.raises(HTTPException) as e:
        await _issue([f"/ws/{i}" for i in range(MAX_BATCH_PATHS + 1)])
    assert e.value.status_code == 400


async def test_empty_batch_is_not_an_error():
    out = await _issue([])
    assert out["tickets"] == []

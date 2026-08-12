"""Batch WebSocket ticket issuance.

One HTTP round trip for N sockets. The single-path `/api/ws-ticket` in `main.py`
stays for reconnects (one socket at a time) and for older cached clients; this
route exists because *boot* opens every pane at once. On a restored workspace of
14 panes that was 14 POSTs inside one second, all queued on the shared HTTP/2
connection that WS reconnects also depend on — the connection this deployment
sees wedge on mobile network switches.

Nothing about the auth model changes: same `_create_ws_ticket`, same per-path
binding, same TTL, same single use. Only the number of requests changes.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from _deps import verify_auth_token
from tickets import WS_TICKET_TTL_SECONDS, _create_ws_ticket

router = APIRouter(prefix="/api", tags=["tickets"])

# A page cannot hold anywhere near this many panes; the cap only stops a crafted
# request from minting tickets in bulk.
MAX_BATCH_PATHS = 32


class WsTicketBatchRequest(BaseModel):
    paths: list[str]


@router.post("/ws-tickets")
async def create_ws_tickets(
    request: WsTicketBatchRequest,
    username: str = Depends(verify_auth_token),
):
    """Returns one ticket per requested path, **positionally**.

    Not keyed by path: every remote pane on the same host asks for the same
    `/ws/host/{id}` path, and tickets are single-use — keying by path would hand
    those panes one ticket and every pane after the first would fail to attach.
    """
    paths = request.paths or []
    if len(paths) > MAX_BATCH_PATHS:
        raise HTTPException(status_code=400, detail=f"한 번에 {MAX_BATCH_PATHS}개까지만 발급합니다")

    tickets: list[dict | None] = []
    for path in paths:
        # A bad path in the batch must not sink the good ones — the caller reads
        # results positionally and falls back to cookie auth for the null slots.
        try:
            ticket, expires_at = _create_ws_ticket(username, path)
        except HTTPException:
            tickets.append(None)
            continue
        tickets.append({"ticket": ticket, "expires_at": expires_at})

    return {"tickets": tickets, "ttl": WS_TICKET_TTL_SECONDS}

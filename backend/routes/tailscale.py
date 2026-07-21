"""Tailscale 피어 목록 — 호스트 등록 시 사설망 기기를 골라 넣기 위한 조회."""
from __future__ import annotations

import asyncio
import json
import logging
import shutil

from fastapi import APIRouter, Depends

from _deps import verify_auth_token

logger = logging.getLogger(__name__)

router = APIRouter(tags=["tailscale"])


# tailscale 바이너리 없거나 실행 안 되면 빈 목록 반환 (UI 측에서 비활성).

@router.get("/api/tailscale/peers")
async def get_tailscale_peers(username: str = Depends(verify_auth_token)):
    if not shutil.which("tailscale"):
        return {"available": False, "peers": []}
    try:
        proc = await asyncio.create_subprocess_exec(
            "tailscale", "status", "--json",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _stderr = await asyncio.wait_for(proc.communicate(), timeout=5)
        if proc.returncode != 0:
            return {"available": True, "peers": [], "error": "tailscale status failed"}
        data = json.loads(stdout.decode("utf-8", errors="replace"))
    except (TimeoutError, json.JSONDecodeError, FileNotFoundError) as e:
        return {"available": False, "peers": [], "error": str(e)}

    peers_raw = data.get("Peer") or {}
    peers = []
    for p in peers_raw.values():
        ips = p.get("TailscaleIPs") or []
        peers.append({
            "id": p.get("ID"),
            "hostname": p.get("HostName") or "",
            "dns_name": (p.get("DNSName") or "").rstrip("."),
            "os": p.get("OS") or "",
            "ip": ips[0] if ips else "",
            "online": bool(p.get("Online")),
            "user_id": p.get("UserID"),
        })
    # 자기 자신
    self_node = data.get("Self") or {}
    me = {
        "id": self_node.get("ID"),
        "hostname": self_node.get("HostName") or "",
        "dns_name": (self_node.get("DNSName") or "").rstrip("."),
        "os": self_node.get("OS") or "",
        "ip": (self_node.get("TailscaleIPs") or [""])[0] or "",
        "online": True,
        "is_self": True,
    }
    peers.sort(key=lambda x: ((not x.get("online")), x.get("hostname", "").lower()))
    return {"available": True, "peers": peers, "self": me}


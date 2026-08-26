"""최소 WebSocket 클라이언트 — stdlib 만 쓴다.

**왜 직접 쓰나.** 이걸 쓰는 쪽은 원격 호스트에 얹히는 리모트다. 의존성을 하나라도
붙이면 설치가 "pip 이 있고 네트워크가 되는 기계" 로 좁아진다 — `itl` CLI 를 파일 하나로
얹는 이 저장소의 방식과 어긋난다. RFC 6455 중 클라이언트가 실제로 쓰는 부분만 담았다.

담은 것: 핸드셰이크, 텍스트/바이너리 프레임 송수신(마스킹 포함), 조각난 프레임 이어붙이기,
ping→pong, close. 안 담은 것: 확장(permessage-deflate), 서버 역할.

⚠️ **보내는 프레임은 반드시 마스킹한다.** 클라이언트가 마스킹을 빼면 서버는 프로토콜
위반으로 즉시 끊는데, 그 실패는 "연결이 그냥 끊겼다" 로만 보여 진단이 어렵다.
"""
import base64
import json
import os
import socket
import ssl
import struct
from urllib.parse import urlparse

OPCODE_CONT, OPCODE_TEXT, OPCODE_BINARY = 0x0, 0x1, 0x2
OPCODE_CLOSE, OPCODE_PING, OPCODE_PONG = 0x8, 0x9, 0xA

# 한 프레임 상한. 우리 메시지는 화면 발췌가 가장 크고 그래야 수십 KB 다 —
# 상한이 없으면 이상한 헤더 하나가 메모리를 통째로 요구할 수 있다.
MAX_FRAME_BYTES = 4 * 1024 * 1024


class WebSocketError(Exception):
    pass


class WebSocketClient:
    """한 연결. 스레드 안전하지 않다 — 읽기 루프 하나, 쓰기는 락으로 감싸서 쓸 것."""

    def __init__(self, url, headers=None, timeout=30.0):
        self.url = url
        self.headers = dict(headers or {})
        self.timeout = timeout
        self.sock = None
        self._buffer = b""

    # ---------------------- 연결 ----------------------

    def connect(self):
        parsed = urlparse(self.url)
        secure = parsed.scheme in ("wss", "https")
        port = parsed.port or (443 if secure else 80)
        host = parsed.hostname
        if not host:
            raise WebSocketError(f"bad url: {self.url}")

        sock = socket.create_connection((host, port), timeout=self.timeout)
        if secure:
            context = ssl.create_default_context()
            sock = context.wrap_socket(sock, server_hostname=host)
        self.sock = sock

        key = base64.b64encode(os.urandom(16)).decode()
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query
        lines = [
            f"GET {path} HTTP/1.1",
            f"Host: {host}:{port}",
            "Upgrade: websocket",
            "Connection: Upgrade",
            f"Sec-WebSocket-Key: {key}",
            "Sec-WebSocket-Version: 13",
        ]
        lines += [f"{k}: {v}" for k, v in self.headers.items()]
        sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())

        head = self._read_until(b"\r\n\r\n")
        status = head.split(b"\r\n", 1)[0].decode("latin-1", "replace")
        if " 101" not in status:
            # 101 이 아니면 본문에 이유가 있다(401 등). 그대로 올려야 진단이 된다.
            raise WebSocketError(f"handshake failed: {status.strip()}")

    def _read_until(self, marker):
        while marker not in self._buffer:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise WebSocketError("connection closed during handshake")
            self._buffer += chunk
            if len(self._buffer) > 64 * 1024:
                raise WebSocketError("handshake response too large")
        head, self._buffer = self._buffer.split(marker, 1)
        return head

    def _read_exactly(self, count):
        while len(self._buffer) < count:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise WebSocketError("connection closed")
            self._buffer += chunk
        data, self._buffer = self._buffer[:count], self._buffer[count:]
        return data

    # ---------------------- 프레임 ----------------------

    def _send_frame(self, opcode, payload=b""):
        if self.sock is None:
            raise WebSocketError("not connected")
        length = len(payload)
        header = bytearray([0x80 | opcode])
        if length < 126:
            header.append(0x80 | length)
        elif length < (1 << 16):
            header.append(0x80 | 126)
            header += struct.pack("!H", length)
        else:
            header.append(0x80 | 127)
            header += struct.pack("!Q", length)
        mask = os.urandom(4)                      # ⚠️ 클라이언트 프레임은 항상 마스킹
        header += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(bytes(header) + masked)

    def send_json(self, obj):
        self._send_frame(OPCODE_TEXT, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def _recv_frame(self):
        first, second = self._read_exactly(2)
        fin, opcode = bool(first & 0x80), first & 0x0F
        length = second & 0x7F
        if length == 126:
            length = struct.unpack("!H", self._read_exactly(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self._read_exactly(8))[0]
        if length > MAX_FRAME_BYTES:
            raise WebSocketError(f"frame too large: {length}")
        # 서버 → 클라이언트는 마스킹하지 않는 것이 규약이지만, 켜져 있어도 읽어낸다.
        mask = self._read_exactly(4) if (second & 0x80) else None
        payload = self._read_exactly(length) if length else b""
        if mask:
            payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        return fin, opcode, payload

    def recv_json(self):
        """다음 데이터 메시지. 제어 프레임은 여기서 처리하고 넘어간다.

        None 을 돌려주면 상대가 닫은 것이다 — 예외가 아니라 값이다(정상 종료이므로).
        """
        buffer, buffer_opcode = b"", None
        while True:
            fin, opcode, payload = self._recv_frame()
            if opcode == OPCODE_PING:
                self._send_frame(OPCODE_PONG, payload)
                continue
            if opcode == OPCODE_PONG:
                continue
            if opcode == OPCODE_CLOSE:
                try:
                    self._send_frame(OPCODE_CLOSE, payload[:2])
                except OSError:
                    pass
                return None
            if opcode == OPCODE_CONT:
                if buffer_opcode is None:      # 시작 프레임 없는 continuation
                    raise WebSocketError("unexpected continuation frame")
                buffer += payload
            else:
                buffer, buffer_opcode = payload, opcode
            if not fin:
                continue
            if buffer_opcode == OPCODE_TEXT:
                try:
                    return json.loads(buffer.decode("utf-8"))
                except (UnicodeDecodeError, ValueError):
                    # 한 줄이 깨졌다고 연결을 죽이지 않는다 — 다음 메시지로 넘어간다.
                    buffer, buffer_opcode = b"", None
                    continue
            buffer, buffer_opcode = b"", None

    def close(self):
        try:
            if self.sock is not None:
                self._send_frame(OPCODE_CLOSE, struct.pack("!H", 1000))
        except (OSError, WebSocketError):
            pass
        finally:
            try:
                if self.sock is not None:
                    self.sock.close()
            except OSError:
                pass
            self.sock = None

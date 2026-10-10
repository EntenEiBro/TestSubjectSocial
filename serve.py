"""Static file server + WebSocket signaling relay for Test Subject Social.

Usage:
    python serve.py [port]            reachable on your local network (binds 0.0.0.0) — LAN play
    python serve.py [port] --local    this computer only (binds 127.0.0.1)

Then open http://localhost:<port> (default 8765, the same port the phone app
uses, so PCs and phones can join each other with join codes).

Besides serving files (with caching disabled so module edits show up on a
normal reload) this server provides two tiny endpoints used by online play:

    GET /netinfo              JSON with this machine's LAN address and port
    GET /ws?room=CODE&role=host|client
                              WebSocket relay. A host owns a room; clients
                              join it. The relay only forwards JSON signaling
                              messages (WebRTC offers/answers/ICE candidates);
                              game video, UI and input then flow peer-to-peer.

Relay protocol (all text frames, JSON):
    server -> host    {"type": "join",  "id": n}           a client connected
    server -> host    {"type": "leave", "id": n}           a client disconnected
    server -> host    {"type": "msg",   "from": n, "data": ...}
    host   -> server  {"to": n, "data": ...}               forwarded to client n
    client -> server  {"data": ...}                        forwarded to host
    server -> client  {"type": "msg", "data": ...}
    server -> any     {"type": "error", "reason": "..."}

Only the Python standard library is used (RFC 6455 framing is implemented
below), so there is nothing to install.
"""
import base64
import hashlib
import http.server
import json
import os
import socket
import struct
import sys
import threading
from urllib.parse import parse_qs, urlparse

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_FRAME = 1 << 20  # signaling messages are small; refuse anything absurd


class WebSocket:
    """Minimal server-side RFC 6455 connection (text frames, ping/pong, close)."""

    def __init__(self, rfile, wfile):
        self.rfile = rfile
        self.wfile = wfile
        self.lock = threading.Lock()
        self.open = True

    def _read_exact(self, n):
        data = self.rfile.read(n)
        if data is None or len(data) < n:
            raise ConnectionError("socket closed")
        return data

    def recv(self):
        """Return the next text message, or None when the connection closes."""
        while self.open:
            b1, b2 = self._read_exact(2)
            opcode = b1 & 0x0F
            masked = b2 & 0x80
            length = b2 & 0x7F
            if length == 126:
                length = struct.unpack(">H", self._read_exact(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", self._read_exact(8))[0]
            if length > MAX_FRAME:
                raise ConnectionError("frame too large")
            mask = self._read_exact(4) if masked else b"\0\0\0\0"
            payload = bytearray(self._read_exact(length))
            for i in range(length):
                payload[i] ^= mask[i % 4]
            if opcode == 0x8:  # close
                self.close()
                return None
            if opcode == 0x9:  # ping -> pong
                self._send_frame(0xA, bytes(payload))
                continue
            if opcode in (0x1, 0x0):
                return payload.decode("utf-8", errors="replace")
            # binary / pong frames are ignored
        return None

    def _send_frame(self, opcode, payload):
        header = bytearray([0x80 | opcode])
        n = len(payload)
        if n < 126:
            header.append(n)
        elif n < 65536:
            header += bytes([126]) + struct.pack(">H", n)
        else:
            header += bytes([127]) + struct.pack(">Q", n)
        with self.lock:
            self.wfile.write(bytes(header) + payload)
            self.wfile.flush()

    def send(self, obj):
        if not self.open:
            return
        try:
            self._send_frame(0x1, json.dumps(obj).encode("utf-8"))
        except OSError:
            self.open = False

    def close(self):
        if self.open:
            self.open = False
            try:
                self._send_frame(0x8, b"")
            except OSError:
                pass


class Rooms:
    """Thread-safe registry of rooms: code -> {"host": ws, "clients": {id: ws}}."""

    def __init__(self):
        self.lock = threading.Lock()
        self.rooms = {}
        self.next_id = 1

    def add_host(self, code, ws):
        with self.lock:
            if code in self.rooms:
                return False
            self.rooms[code] = {"host": ws, "clients": {}}
            return True

    def remove_host(self, code):
        with self.lock:
            room = self.rooms.pop(code, None)
        if room:
            for client in room["clients"].values():
                client.send({"type": "error", "reason": "host left"})
                client.close()

    def add_client(self, code, ws):
        with self.lock:
            room = self.rooms.get(code)
            if not room:
                return None, None
            cid = self.next_id
            self.next_id += 1
            room["clients"][cid] = ws
            return cid, room["host"]

    def remove_client(self, code, cid):
        with self.lock:
            room = self.rooms.get(code)
            host = room["host"] if room else None
            if room:
                room["clients"].pop(cid, None)
        if host:
            host.send({"type": "leave", "id": cid})

    def client(self, code, cid):
        with self.lock:
            room = self.rooms.get(code)
            return room["clients"].get(cid) if room else None


ROOMS = Rooms()


def lan_address():
    """Best-effort primary LAN IP (no packets are actually sent)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


class GameHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):  # keep the console quiet for the many module requests
        if "/ws" in (self.path or "") or "404" in (fmt % args):
            super().log_message(fmt, *args)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/netinfo":
            body = json.dumps({"lan": lan_address(), "port": self.server.server_address[1],
                               "lanEnabled": self.server.server_address[0] != "127.0.0.1"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if url.path == "/ws" and self.headers.get("Upgrade", "").lower() == "websocket":
            self.handle_websocket(parse_qs(url.query))
            return
        super().do_GET()

    def handle_websocket(self, query):
        key = self.headers.get("Sec-WebSocket-Key")
        if not key:
            self.send_error(400, "Missing Sec-WebSocket-Key")
            return
        accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
        self.send_response(101, "Switching Protocols")
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        self.close_connection = True

        ws = WebSocket(self.rfile, self.wfile)
        code = (query.get("room", [""])[0] or "").upper()[:8]
        role = query.get("role", ["client"])[0]
        try:
            if role == "host":
                self.run_host(ws, code)
            else:
                self.run_client(ws, code)
        except (ConnectionError, OSError, ValueError):
            pass
        finally:
            ws.open = False

    def run_host(self, ws, code):
        if not code or not ROOMS.add_host(code, ws):
            ws.send({"type": "error", "reason": "room unavailable"})
            return
        try:
            while True:
                text = ws.recv()
                if text is None:
                    break
                msg = json.loads(text)
                target = ROOMS.client(code, msg.get("to"))
                if target:
                    target.send({"type": "msg", "data": msg.get("data")})
        finally:
            ROOMS.remove_host(code)

    def run_client(self, ws, code):
        cid, host = ROOMS.add_client(code, ws)
        if cid is None:
            ws.send({"type": "error", "reason": "no such room"})
            return
        host.send({"type": "join", "id": cid})
        ws.send({"type": "welcome", "id": cid})
        try:
            while True:
                text = ws.recv()
                if text is None:
                    break
                msg = json.loads(text)
                host.send({"type": "msg", "from": cid, "data": msg.get("data")})
        finally:
            ROOMS.remove_client(code, cid)


def game_folder():
    """The game's files live in 'Test Subject Social/game' (single copy)."""
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "Test Subject Social", "game")


def main():
    os.chdir(game_folder())
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    port = int(args[0]) if args else 8765
    # LAN play is the default; --local restricts the server to this computer.
    bind = "127.0.0.1" if "--local" in sys.argv else "0.0.0.0"
    server = http.server.ThreadingHTTPServer((bind, port), GameHandler)
    server.daemon_threads = True
    print(f"Serving Test Subject Social on http://localhost:{port}")
    if bind == "0.0.0.0":
        print(f"Online play: friends on your network can join via http://{lan_address()}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()

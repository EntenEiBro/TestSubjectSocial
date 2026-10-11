"""Local static file server for Test Subject Social (development).

Usage:
    python serve.py [port]            then open http://localhost:<port> (default 8765)
    python serve.py [port] --eos      also run the Epic Online Services bridge, so
                                      HOST ONLINE / JOIN ONLINE work in a browser
    python serve.py [port] --eos --fresh-id
                                      the same with a brand-new anonymous EOS
                                      identity (a second player on the same PC)
    python serve.py [port] --eos --peer-bridge=PORT
                                      also reach the bridge of the server on PORT
                                      at /eos2/, and serve /__duo.html: host and
                                      second player side by side in one tab

Serves 'Test Subject Social/game' to this computer only (binds 127.0.0.1),
with caching disabled so module edits show up on a normal reload. Only the
Python standard library is used, so there is nothing to install. The EOS
bridge needs the SDK in EOS/ and the product IDs in eos_config.json (both
kept out of git; see eos_bridge.py).
"""
import http.server
import json
import os
import sys
import threading
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
EOS = None          # EOSBridge when started with --eos
EOS_LOG = []        # (id, event): every page polls with its own cursor, so nothing is lost
EOS_COND = threading.Condition()
PEER_PORT = None    # --peer-bridge: second player's server (dev test page)

DUO_PAGE = b"""<!doctype html><meta charset="utf-8"><title>TSS duo</title>
<style>body{margin:0;background:#111;display:flex;flex-wrap:wrap}iframe{width:50vw;height:28.125vw;border:0}</style>
<iframe id="a" src="/"></iframe><iframe id="b" src="about:blank"></iframe>
<script>window.join=(code)=>{document.getElementById('b').src='/?room='+code+'&eosdev=/eos2';};</script>
"""


def eos_events(batch):
    with EOS_COND:
        next_id = EOS_LOG[-1][0] + 1 if EOS_LOG else 1
        for i, e in enumerate(batch):
            EOS_LOG.append((next_id + i, e))
        del EOS_LOG[:-5000]
        EOS_COND.notify_all()


class GameHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):  # keep the console quiet for the many module requests
        if "404" in (fmt % args):
            super().log_message(fmt, *args)

    # -------------------------------------------- EOS bridge over HTTP (dev only)
    def _json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _proxy(self, body=None):
        """Forward /eos2/... to the second player's server (dev test page)."""
        url = f"http://127.0.0.1:{PEER_PORT}/eos/" + self.path[len("/eos2/"):]
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=body), timeout=30) as r:
                return self._json(json.loads(r.read()))
        except (OSError, ValueError):
            return self._json({"error": "peer bridge unreachable"}, 502)

    def do_GET(self):
        if self.path.startswith("/eos2/") and PEER_PORT:
            return self._proxy()
        if self.path == "/__duo.html" and PEER_PORT:
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(DUO_PAGE)))
            self.end_headers()
            return self.wfile.write(DUO_PAGE)
        if self.path.startswith("/eos/events"):
            if not EOS:
                return self._json({"error": "no bridge"}, 404)
            after = int(self.path.partition("after=")[2] or -1)
            with EOS_COND:
                if after < 0:  # first poll of a page: start from now
                    return self._json({"last": EOS_LOG[-1][0] if EOS_LOG else 0, "events": []})
                EOS_COND.wait_for(lambda: EOS_LOG and EOS_LOG[-1][0] > after, timeout=15)
                batch = [(i, e) for i, e in EOS_LOG if i > after][:500]
            try:
                return self._json({"last": batch[-1][0] if batch else after, "events": [e for _, e in batch]})
            except OSError:
                return None  # page went away; it will catch up with its cursor
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/eos2/") and PEER_PORT:
            return self._proxy(self.rfile.read(int(self.headers.get("Content-Length") or 0)))
        if not self.path.startswith("/eos/cmd"):
            return self._json({"error": "not found"}, 404)
        if not EOS:
            return self._json({"error": "no bridge"}, 404)
        req = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        op, arg = req.get("op"), req.get("arg")
        if op == "status":
            return self._json(EOS.status())
        if op == "host":
            EOS.host()
        elif op == "join":
            EOS.join(arg)
        elif op == "send":
            EOS.send_many(arg or [])
        elif op == "stop":
            EOS.stop()
        return self._json({"ok": True})


def game_folder():
    """The game's files live in 'Test Subject Social/game' (single copy)."""
    return os.path.join(ROOT, "Test Subject Social", "game")


def start_eos(fresh=False, label="dev"):
    """Start the EOS bridge whose events are served at /eos/events."""
    global EOS
    import eos_bridge
    cfg = eos_bridge.load_config(os.path.join(ROOT, "eos_config.json"))
    if not cfg:
        sys.exit("eos_config.json not found next to serve.py")
    if fresh:
        os.environ["TSS_EOS_FRESH_DEVICE"] = "1"
    dll = os.path.join(ROOT, "EOS", "win", "SDK", "Bin", "EOSSDK-Win64-Shipping.dll")
    data = os.path.join(os.environ.get("TEMP", ROOT), f"tss-eos-{label}")
    os.makedirs(data, exist_ok=True)
    EOS = eos_bridge.EOSBridge(dll, cfg, eos_events, data,
                               log=lambda m: print(m, flush=True))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    port = int(args[0]) if args else 8765
    global PEER_PORT
    if "--eos" in sys.argv:
        start_eos("--fresh-id" in sys.argv, str(port))
    for a in sys.argv:
        if a.startswith("--peer-bridge="):
            PEER_PORT = int(a.split("=", 1)[1])
    os.chdir(game_folder())
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), GameHandler)
    server.daemon_threads = True
    print(f"Serving Test Subject Social on http://localhost:{port}" + (" (EOS bridge on)" if EOS else ""))
    server.serve_forever()


if __name__ == "__main__":
    main()

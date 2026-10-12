"""Online play for the Godot build on Windows: eos_bridge.EOSBridge behind a
localhost socket (the Godot game can't load the EOS SDK itself).

The game listens on 127.0.0.1 and starts this program with
    --connect <port> --data <dir> [--fresh]
It connects back, and both sides exchange JSON lines:
    game -> sidecar   {"op": "host" | "join" | "send" | "stop" | "quit", "arg": ...}
    sidecar -> game   {"status": {state, user, code, message}}   (whenever it changes)
                      {"ev": [event, ...]}                          (see eos_bridge / net/eos_link.gd)
                      {"log": "..."}
The sidecar exits as soon as the game closes the connection (game quit or
crashed), so it never lingers.

Packaged for releases with  python tools/build_eos_sidecar.py  (PyInstaller,
next to EOSSDK-Win64-Shipping.dll and eos_config.json in the game's eos/ folder).
"""
import json
import os
import socket
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(sys.executable if getattr(sys, "frozen", False) else __file__))
sys.path.insert(0, HERE)
import eos_bridge  # noqa: E402

UNAVAILABLE = {"state": "unavailable", "user": None, "code": None, "message": "online play is not included in this build"}


def find_files():
    """(SDK dll, config json) next to the sidecar (release) or in the repository (development)."""
    for base in (HERE, os.path.join(HERE, "eos")):
        dll, cfg = os.path.join(base, "EOSSDK-Win64-Shipping.dll"), os.path.join(base, "eos_config.json")
        if os.path.exists(dll) and os.path.exists(cfg):
            return dll, cfg
    dll = os.path.join(HERE, "EOS", "win", "SDK", "Bin", "EOSSDK-Win64-Shipping.dll")
    cfg = os.path.join(HERE, "eos_config.json")
    return (dll, cfg) if os.path.exists(dll) and os.path.exists(cfg) else None


def arg(name, default=None):
    if name in sys.argv:
        i = sys.argv.index(name)
        return sys.argv[i + 1] if i + 1 < len(sys.argv) else default
    return default


def main():
    port = int(arg("--connect", "0"))
    data = arg("--data") or os.path.join(os.environ.get("APPDATA", HERE), "TestSubjectSocial")
    if "--fresh" in sys.argv:
        os.environ["TSS_EOS_FRESH_DEVICE"] = "1"   # a second identity for a second game on this PC
    os.makedirs(data, exist_ok=True)
    sock = socket.create_connection(("127.0.0.1", port), timeout=15)
    sock.settimeout(None)
    lock = threading.Lock()

    def write(obj):
        line = (json.dumps(obj, separators=(",", ":")) + "\n").encode("utf-8")
        with lock:
            try:
                sock.sendall(line)
            except OSError:
                os._exit(0)   # the game is gone

    files = find_files()
    bridge = None
    if files:
        try:
            with open(files[1], encoding="utf-8") as f:
                cfg = json.load(f)
            bridge = eos_bridge.EOSBridge(files[0], cfg, lambda batch: write({"ev": batch}), data,
                                          log=lambda m: write({"log": str(m)}))
        except Exception as exc:   # broken config / SDK: report, keep the link up
            write({"status": {"state": "error", "user": None, "code": None, "message": str(exc)}})
    if bridge is None:
        write({"status": UNAVAILABLE})
    else:
        def watch():
            last = None
            while True:
                s = bridge.status()
                if s != last:
                    write({"status": s})
                    last = dict(s)
                time.sleep(0.05)
        threading.Thread(target=watch, name="status", daemon=True).start()

    reader = sock.makefile("r", encoding="utf-8")
    try:
        for line in reader:
            try:
                cmd = json.loads(line)
            except ValueError:
                continue
            op = cmd.get("op")
            if op == "quit":
                break
            if bridge is None:
                continue
            if op == "host":
                bridge.host()
            elif op == "join":
                bridge.join(str(cmd.get("arg", "")))
            elif op == "send":
                bridge.send_many(cmd.get("arg") or [])
            elif op == "stop":
                bridge.stop()
    except OSError:
        pass
    if bridge is not None:
        bridge.stop()     # leave the room cleanly before exiting
        time.sleep(0.3)
        bridge.shutdown()
        time.sleep(0.2)
    os._exit(0)


if __name__ == "__main__":
    main()

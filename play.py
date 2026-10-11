"""Launch Test Subject Social as a desktop game.

Starts the bundled server on a free local port and shows the game in its
own native window (pywebview, which embeds the system web engine — WebView2
on Windows). No browser is opened. Closing the window quits the game.

Usage:
    python play.py              fullscreen game window
    python play.py --windowed   1280x720 window instead of fullscreen

The server only listens on this computer (127.0.0.1), preferably on port
8765 so saved settings and commendations stay with the same address.

In the game: F11 toggles fullscreen; the title menu has a QUIT option.
If pywebview is unavailable, the game falls back to a browser app window.

Online play (HOST ONLINE / JOIN ONLINE) goes through Epic Online Services:
eos_bridge.py drives the EOS SDK. It needs EOSSDK-Win64-Shipping.dll and
eos_config.json (the product IDs), which are not part of the source
repository: the release build keeps them in an `eos` folder next to the
.exe; from source they are read from EOS/win/SDK/Bin and eos_config.json.
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from http.server import ThreadingHTTPServer

TITLE = "Test Subject Social"


def game_dir():
    """Folder holding index.html.

    Release build: the `game` folder next to the .exe (see build_exe.py).
    From source: 'Test Subject Social/game' next to this script.
    """
    if getattr(sys, "frozen", False):
        beside = os.path.join(os.path.dirname(sys.executable), "game")
        if os.path.exists(os.path.join(beside, "index.html")):
            return beside
        return getattr(sys, "_MEIPASS", beside)
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "Test Subject Social", "game")


HERE = game_dir()
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import serve  # noqa: E402  (the static file server)


def log(msg):
    """print() that tolerates windowed builds, where there is no console."""
    if sys.stdout:
        print(msg)


GAME_PORT = 8765  # stable port = stable storage origin (settings, commendations)


def free_port(preferred=GAME_PORT, host="127.0.0.1"):
    """Use `preferred` if it is free, otherwise any free port."""
    for port in (preferred, 0):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((host, port))
                return s.getsockname()[1]
            except OSError:
                continue
    raise RuntimeError("no free port")


def data_dir():
    """Where the game keeps settings and commendations between sessions."""
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    path = os.path.join(base, "TestSubjectSocial")
    os.makedirs(path, exist_ok=True)
    return path


def eos_files():
    """(SDK dll, config json) for online play, or None if either is missing."""
    if getattr(sys, "frozen", False):
        base = os.path.join(os.path.dirname(sys.executable), "eos")
        dll, cfg = os.path.join(base, "EOSSDK-Win64-Shipping.dll"), os.path.join(base, "eos_config.json")
    else:
        root = os.path.dirname(os.path.abspath(__file__))
        dll = os.path.join(root, "EOS", "win", "SDK", "Bin", "EOSSDK-Win64-Shipping.dll")
        cfg = os.path.join(root, "eos_config.json")
    return (dll, cfg) if os.path.exists(dll) and os.path.exists(cfg) else None


class DesktopApi:
    """Functions the game page can call as `window.pywebview.api.<name>()`."""

    def __init__(self):
        # Private (underscore) attributes are not exposed to the page: pywebview would
        # otherwise walk the whole native window object looking for functions.
        self._window = None
        self._eos = None          # EOSBridge, started on the first online call
        self._eos_lock = threading.Lock()

    def toggle_fullscreen(self):
        if self._window:
            self._window.toggle_fullscreen()

    def quit(self):
        if self._window:
            self._window.destroy()

    # ---- online play (Epic Online Services, see eos_bridge.py and net/eos.js)
    def _bridge(self):
        with self._eos_lock:
            if self._eos is None:
                files = eos_files()
                if not files:
                    return None
                import eos_bridge
                with open(files[1], encoding="utf-8") as f:
                    cfg = json.load(f)
                cache = os.path.join(data_dir(), "eos")
                self._eos = eos_bridge.EOSBridge(files[0], cfg, self._push_events, cache, log=log)
            return self._eos

    def _push_events(self, batch):
        if self._window:
            self._window.run_js(f"window.__eosEvents && window.__eosEvents({json.dumps(batch)})")

    def eos_status(self):
        bridge = self._bridge()
        if not bridge:
            return {"state": "unavailable", "message": "online play is not included in this build"}
        return bridge.status()

    def eos_host(self):
        if self._bridge():
            self._eos.host()

    def eos_join(self, code):
        if self._bridge():
            self._eos.join(code)

    def eos_send(self, batch_json):
        if self._eos:
            self._eos.send_many(json.loads(batch_json))

    def eos_stop(self):
        if self._eos:
            self._eos.stop()

    def _shutdown(self):
        """Leave any room before the process exits."""
        if self._eos:
            self._eos.stop()
            self._eos.shutdown()
            time.sleep(0.4)


def run_native(url, windowed):
    """Show the game in a native window. Returns False if pywebview can't run."""
    try:
        import webview
    except ImportError:
        return False
    api = DesktopApi()
    api._window = webview.create_window(
        TITLE, url, js_api=api,
        width=1280, height=720, min_size=(640, 360),
        fullscreen=not windowed, background_color="#000000",
    )
    try:
        # Persistent (non-private) storage keeps settings and commendations.
        webview.start(private_mode=False, storage_path=data_dir())
    except Exception as exc:  # e.g. no WebView2 runtime on very old systems
        log(f"Native window unavailable ({exc}); falling back to a browser window.")
        return False
    finally:
        api._shutdown()
    return True


def find_browser():
    """Locate a Chromium-based browser that supports --app windows (fallback only)."""
    candidates = []
    if sys.platform == "win32":
        for base in (os.environ.get("PROGRAMFILES(X86)"), os.environ.get("PROGRAMFILES"), os.environ.get("LOCALAPPDATA")):
            if base:
                candidates += [os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
                               os.path.join(base, "Google", "Chrome", "Application", "chrome.exe")]
    for name in ("msedge", "google-chrome", "chromium", "chrome"):
        path = shutil.which(name)
        if path:
            candidates.append(path)
    return next((c for c in candidates if c and os.path.exists(c)), None)


def run_browser_fallback(url, windowed):
    """Last resort: a browser app window (or the default browser)."""
    browser = find_browser()
    if not browser:
        webbrowser.open(url)
        threading.Event().wait()
        return
    profile = tempfile.mkdtemp(prefix="tss-profile-")
    args = [browser, f"--app={url}", f"--user-data-dir={profile}", "--no-first-run", "--no-default-browser-check"]
    args += ["--window-size=1280,720"] if windowed else ["--start-fullscreen"]
    try:
        subprocess.run(args)
    finally:
        shutil.rmtree(profile, ignore_errors=True)


def main():
    windowed = "--windowed" in sys.argv
    os.chdir(HERE)

    port = free_port(GAME_PORT)
    server = ThreadingHTTPServer(("127.0.0.1", port), serve.GameHandler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://localhost:{port}/"
    log(f"{TITLE} running at {url}")

    try:
        if not run_native(url, windowed):
            run_browser_fallback(url, windowed)
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()

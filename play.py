"""Launch Test Subject Social as a desktop game.

Starts the bundled server on a free local port and shows the game in its
own native window (pywebview, which embeds the system web engine — WebView2
on Windows). No browser is opened. Closing the window quits the game.

Usage:
    python play.py              fullscreen game window
    python play.py --windowed   1280x720 window instead of fullscreen
    python play.py --local      only this computer (no online players from your network)

Online play works over your local network (LAN / Wi-Fi) by default: the
server listens on port 8765 — the same port the phone app uses — so PCs and
phones can join each other with the same join codes. The first launch may
show a Windows Firewall prompt; allow access on private networks.

In the game: F11 toggles fullscreen; the title menu has a QUIT option.
If pywebview is unavailable, the game falls back to a browser app window.
"""
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
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
import serve  # noqa: E402  (the static server + online relay)


def log(msg):
    """print() that tolerates windowed builds, where there is no console."""
    if sys.stdout:
        print(msg)


GAME_PORT = 8765  # same port as the phone app, so join codes work across devices


def free_port(preferred=GAME_PORT, host="0.0.0.0"):
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


class DesktopApi:
    """Functions the game page can call as `window.pywebview.api.<name>()`."""

    def __init__(self):
        self.window = None

    def toggle_fullscreen(self):
        if self.window:
            self.window.toggle_fullscreen()

    def quit(self):
        if self.window:
            self.window.destroy()


def run_native(url, windowed):
    """Show the game in a native window. Returns False if pywebview can't run."""
    try:
        import webview
    except ImportError:
        return False
    api = DesktopApi()
    api.window = webview.create_window(
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
    lan = "--local" not in sys.argv  # LAN (network) play is the default
    windowed = "--windowed" in sys.argv
    os.chdir(HERE)

    host = "0.0.0.0" if lan else "127.0.0.1"
    port = free_port(GAME_PORT, host)
    server = ThreadingHTTPServer((host, port), serve.GameHandler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://localhost:{port}/"
    log(f"{TITLE} running at {url}")
    if lan:
        log(f"Online players on your network can join via http://{serve.lan_address()}:{port}")

    try:
        if not run_native(url, windowed):
            run_browser_fallback(url, windowed)
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()

"""Build the release folder:  Test Subject Social/

Requirements (once):  python -m pip install pyinstaller
Build:                python build_exe.py

Output layout (copy or zip the whole folder to share the game):

    Test Subject Social/
        Test Subject Social.exe   double-click to play            (rebuilt by this script)
        game/                     all game files — the ONLY copy;  (never touched by this script)
                                  edit them here directly
        _internal/                Python runtime used by the .exe (rebuilt by this script)
        README.txt                how to play

No Python or internet connection is needed on the target PC (Windows 10/11).
The game opens in its own app window using Microsoft Edge, which ships with
Windows; see play.py.
"""
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
NAME = "Test Subject Social"
RELEASE = os.path.join(ROOT, NAME)
GAME = os.path.join(RELEASE, "game")  # the game's source files live here (single copy)

README = """TEST SUBJECT SOCIAL
===================

Double-click "Test Subject Social.exe" to play.

  F11      toggle fullscreen
  Esc      pause during a round
  Alt+F4   quit

Player 1: W A S D to move, F = action, G = shove
Player 2: arrow keys to move, Enter = action, Right Shift = shove
Gamepads: up to 4 (left stick / A / B)
In the lobby press T to add bots to empty seats.

Keep this folder together: the .exe needs the "game" and "_internal" folders.
Third-party licenses (three.js, fonts) are in game/vendor/.
"""


def main():
    os.chdir(ROOT)
    if not os.path.exists("icon.ico"):
        subprocess.check_call([sys.executable, os.path.join("tools", "make_icon.py")])
    build = os.path.join(ROOT, "build")
    # Paths are absolute because PyInstaller resolves them relative to --specpath.
    subprocess.check_call([
        sys.executable, "-m", "PyInstaller", os.path.join(ROOT, "play.py"),
        "--name", NAME,
        "--onedir",
        "--windowed",              # no console window
        "--icon", os.path.join(ROOT, "icon.ico"),
        "--noconfirm",
        "--clean",
        "--distpath", os.path.join(build, "dist"),
        "--workpath", os.path.join(build, "pyinstaller"),
        "--specpath", build,
    ])

    # Refresh only the launcher (.exe + _internal). The game/ folder is the
    # source of truth and is never deleted or overwritten here.
    if not os.path.exists(os.path.join(GAME, "index.html")):
        sys.exit(f"Game files not found in {GAME}")
    built = os.path.join(build, "dist", NAME)
    internal = os.path.join(RELEASE, "_internal")
    if os.path.exists(internal):
        shutil.rmtree(internal)
    shutil.copytree(os.path.join(built, "_internal"), internal)
    shutil.copy2(os.path.join(built, f"{NAME}.exe"), os.path.join(RELEASE, f"{NAME}.exe"))
    with open(os.path.join(RELEASE, "README.txt"), "w", encoding="utf-8") as f:
        f.write(README)

    size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(RELEASE) for f in fs)
    print(f"\nRelease folder: {RELEASE} ({size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()

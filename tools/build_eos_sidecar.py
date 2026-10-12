"""Package the Windows online helper (eos_sidecar.py + eos_bridge.py) as
build/eos_sidecar/tss_eos/tss_eos.exe with PyInstaller. godot/tools/export.ps1
copies that folder next to the exported game as eos/ and adds the EOS SDK dll
and eos_config.json (both git-ignored).

Requirements (once):  python -m pip install pyinstaller
Build:                python tools/build_eos_sidecar.py
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "build", "eos_sidecar")


def main():
    subprocess.check_call([
        sys.executable, "-m", "PyInstaller", os.path.join(ROOT, "eos_sidecar.py"),
        "--name", "tss_eos",
        "--onedir",
        "--noconsole",              # talks to the game over a local socket, no window
        "--noconfirm",
        "--clean",
        "--hidden-import", "eos_bridge",
        "--paths", ROOT,
        "--distpath", OUT,
        "--workpath", os.path.join(OUT, "work"),
        "--specpath", OUT,
    ])
    print("online helper:", os.path.join(OUT, "tss_eos", "tss_eos.exe"))


if __name__ == "__main__":
    main()

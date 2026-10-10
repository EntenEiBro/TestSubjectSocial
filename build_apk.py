"""Build the Android app:  Test Subject Social.apk  (in this folder)

Requirements (installed once under D:\\AndroidDev, see README):
    JDK 17, Android SDK (platform-tools, platforms;android-34, build-tools;34.0.0), Gradle 8.7

Build:   python build_apk.py
Install: copy the .apk to the phone and tap it, or with USB debugging on:
         python build_apk.py --install

The game files are taken from 'Test Subject Social/game' (the same single
copy the Windows build uses) and packed into the APK as assets.
"""
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
ANDROID = os.path.join(ROOT, "android")
TOOLS = os.environ.get("TSS_ANDROID_TOOLS", r"D:\AndroidDev")
JDK = os.path.join(TOOLS, "jdk")
SDK = os.path.join(TOOLS, "sdk")
GRADLE = os.path.join(TOOLS, "gradle-8.7", "bin", "gradle.bat" if os.name == "nt" else "gradle")
OUTPUT = os.path.join(ROOT, "Test Subject Social.apk")


def main():
    for path, what in ((JDK, "JDK 17"), (SDK, "Android SDK"), (GRADLE, "Gradle 8.7")):
        if not os.path.exists(path):
            sys.exit(f"{what} not found at {path}")

    env = dict(os.environ)
    env["JAVA_HOME"] = JDK
    env["ANDROID_HOME"] = SDK
    env["ANDROID_SDK_ROOT"] = SDK
    # Keep Gradle's (large) caches off the system drive, next to the tools.
    env["GRADLE_USER_HOME"] = os.path.join(TOOLS, "gradle-home")
    env["ANDROID_USER_HOME"] = os.path.join(TOOLS, "android-home")
    env["PATH"] = os.path.join(JDK, "bin") + os.pathsep + env.get("PATH", "")

    # Regenerate launcher icons if missing.
    if not os.path.exists(os.path.join(ANDROID, "app", "src", "main", "res", "mipmap-mdpi", "ic_launcher.png")):
        subprocess.check_call([sys.executable, os.path.join(ROOT, "tools", "make_icon.py")])

    with open(os.path.join(ANDROID, "local.properties"), "w", encoding="utf-8") as f:
        f.write("sdk.dir=" + SDK.replace("\\", "\\\\") + "\n")

    subprocess.check_call([GRADLE, "--no-daemon", "assembleRelease"], cwd=ANDROID, env=env)

    built = os.path.join(ANDROID, "app", "build", "outputs", "apk", "release", "app-release.apk")
    shutil.copy2(built, OUTPUT)
    print(f"\nBuilt: {OUTPUT} ({os.path.getsize(OUTPUT) / 1e6:.1f} MB)")

    if "--install" in sys.argv:
        adb = os.path.join(SDK, "platform-tools", "adb.exe" if os.name == "nt" else "adb")
        subprocess.check_call([adb, "install", "-r", OUTPUT], env=env)
        print("Installed on the connected phone.")


if __name__ == "__main__":
    main()

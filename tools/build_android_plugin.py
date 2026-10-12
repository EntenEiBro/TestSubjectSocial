"""Build the Godot Android plugin "TssEos" (online play on phones) and put it
where the Godot export picks it up:

    godot/addons/tss_eos/bin/tss_eos-release.aar   our plugin (JNI glue + bridge + config)
    godot/addons/tss_eos/bin/eossdk.aar            the EOS SDK itself

Both contain the EOS SDK / product IDs and are git-ignored, like EOS/ and
eos_config.json. Requirements: the same JDK / Android SDK / Gradle as
build_apk.py (under D:\\AndroidDev).

    python tools/build_android_plugin.py
"""
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLUGIN = os.path.join(ROOT, "godot_android_plugin")
OUT = os.path.join(ROOT, "godot", "addons", "tss_eos", "bin")
TOOLS = os.environ.get("TSS_ANDROID_TOOLS", r"D:\AndroidDev")
JDK = os.path.join(TOOLS, "jdk")
SDK = os.path.join(TOOLS, "sdk")
GRADLE = os.path.join(TOOLS, "gradle-8.7", "bin", "gradle.bat" if os.name == "nt" else "gradle")
EOS_AAR = os.path.join(ROOT, "EOS", "android", "SDK", "Bin", "Android", "static-stdc++", "aar", "eossdk-StaticSTDC-release.aar")


def main():
    for path, what in ((JDK, "JDK 17"), (SDK, "Android SDK"), (GRADLE, "Gradle 8.7"), (EOS_AAR, "EOS Android SDK"),
                       (os.path.join(ROOT, "eos_config.json"), "eos_config.json")):
        if not os.path.exists(path):
            sys.exit(f"{what} not found at {path}")
    env = dict(os.environ)
    env.update(JAVA_HOME=JDK, ANDROID_HOME=SDK, ANDROID_SDK_ROOT=SDK,
               GRADLE_USER_HOME=os.path.join(TOOLS, "gradle-home"), ANDROID_USER_HOME=os.path.join(TOOLS, "android-home"))
    env["PATH"] = os.path.join(JDK, "bin") + os.pathsep + env.get("PATH", "")
    with open(os.path.join(PLUGIN, "local.properties"), "w", encoding="utf-8") as f:
        f.write("sdk.dir=" + SDK.replace("\\", "\\\\") + "\n")
    subprocess.check_call([GRADLE, "--no-daemon", ":tsseos:assembleRelease"], cwd=PLUGIN, env=env)
    os.makedirs(OUT, exist_ok=True)
    shutil.copy2(os.path.join(PLUGIN, "tsseos", "build", "outputs", "aar", "tsseos-release.aar"), os.path.join(OUT, "tss_eos-release.aar"))
    shutil.copy2(EOS_AAR, os.path.join(OUT, "eossdk.aar"))
    print("plugin ready in", OUT)


if __name__ == "__main__":
    main()

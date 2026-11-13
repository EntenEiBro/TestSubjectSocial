# Godot 4.7.2 port — status

The web game (`Test Subject Social/game/src`) is being ported to Godot 4.7.2
(GDScript, GL Compatibility, Windows + Android). Props are modelled in Blender
by script. Updated 2026-10-12 (session paused at 20:20).

## Done
- **Core framework:** `src/core` covers geometry, materials, textures (including painted `Tex.canvas/image/text`), environment helpers, avatars, FX/gore, arena physics, bot AI, input, audio, haptics, i18n, and Blender props (`props.gd`).
- **Game layer:** `src/game` has players, flow and commendations.
- **UI:** `src/ui` has the HUD, backdrop, touch controls and all menu screens; `src/main.gd` ties it together.
- **Lighting:** global lighting is about 15% darker than a straight conversion, at the user's request (`Env.LIGHT_K` / `AMBIENT_K`).
- **Minigames:**
  - Ported: sawblade (the reference port) plus the games written by the parallel workers. See the table below.
  - Each game has `src/minigames/<id>.gd` and `blender/props/<id>.py`, whose output is `assets/models/props/<id>.glb`.
- **Online play (EOS):**
  - `src/net/`: `eos_link.gd` (bridge), `lockstep.gd`, `ui_mirror.gd` (host menus mirrored to clients), `net.gd` (host, autoload), `net_client.gd`, `remote_round.gd`.
  - **Windows:** `eos_sidecar.py` is the helper process, talking JSON lines over a localhost socket. It is packaged by `tools/build_eos_sidecar.py`.
  - **Tested on one PC with two instances:** room hosted via EOS, client joined by code, lockstep round with zero desyncs. The client took a seat in the mirrored lobby by tapping and customized its avatar; ready-up worked.
  - Test commands: `--nettest=host [--lobby]` and `--room=CODE --nettest=client --eos-fresh` (see `main.gd` `_net_test_host`).
  - **Android:** the Godot plugin "TssEos" lives in `godot_android_plugin/` and wraps the old app's `tss_eos.c` JNI glue. Build it with `python tools/build_android_plugin.py`, which writes `godot/addons/tss_eos/bin/*.aar` (git-ignored). It is wired into the Gradle template (`godot/android/build/build.gradle`: the AARs, androidx deps and desugaring; `config.gradle` NDK set to 27.2).
- **Exports:**
  - `export_presets.cfg` has Windows Desktop and Android presets. Android uses package `com.testsubjectsocial.godot` (installs next to the old app), versionCode 10, arm64, Gradle build, signed with `D:\AndroidDev\android-home\debug.keystore`.
  - Run `godot/tools/export.ps1 -Target windows|android [-Install]`.
  - Android SDK platform 36 and build-tools 36.1.0 were installed (with the user's OK).

## Watching the work
- **Godot editor:** open with the Live Follow plugin (`addons/live_follow`). Start it with `D:\Tools\Godot\4.7.2\Godot_v4.7.2-stable_win64.exe --editor --path godot --log-file godot/.live/editor.log`. It opens changed scripts, imports and previews new props, and runs play requests.
- **Tools:**
  - `godot/tools/check.ps1`: compile everything.
  - `run.ps1`: headless tests.
  - `play.ps1`: visible run through the editor's Play button, with screenshots.
  - `import.ps1`
  - `blender/build.ps1 -Games "<ids>"`: visible Blender build that closes itself.
- **Porting guide for workers:** `godot/PORTING.md`.

## Released
**v2.0.0 was released on 2026-11-13:** https://github.com/EntenEiBro/TestSubjectSocial/releases/tag/v2.0.0
- **Assets:** a Windows zip with the exe, the `eos` folder, README and licenses, and an APK (`com.testsubjectsocial.game`, versionCode 10, installs over v1.x).
- **Tested:**
  - 120 headless rounds (all 30 games with 2 and 4 players).
  - Online play with the exported exe (host + client, lobby taps, no desync).
  - Online play between the PC and a Pixel 10.
  - Local play on the phone.
  - Background CPU on the phone is 0-0.6% (it was about 10%).
- **Package assets:** `build/release/v2.0.0`. Notes: `build/release/NOTES-2.0.0.md`.

## Open
- The user wants the old web version removed (`Test Subject Social/game`, `android/`, `play.py`, `serve.py`, `build_exe.py`, `build_apk.py`). The Godot APK still needs `android/app/src/main/cpp/tss_eos.c`. Confirm with the user before deleting.
- The interim test app `com.testsubjectsocial.godot` is still installed on the user's phone.

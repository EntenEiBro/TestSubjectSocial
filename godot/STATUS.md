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

## Next
1. Finish the remaining minigames (see the table), then do one full-program playthrough.
2. Android: install the APK on the Pixel 10 and test (no phone screenshots: ask the user to look). Then test online between PC and phone.
3. Windows: export, copy the `eos/` helper folder, and test the exe.
4. Final release builds; update the README / HOW TO INSTALL for the Godot version.
5. **The user asked to remove the web version once the Godot version is done.** Confirm what exactly (phone app, web code in the repo, GitHub releases) before deleting anything.

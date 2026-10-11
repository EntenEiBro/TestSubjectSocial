# Godot 4.7.2 port — status

Paused 2026-10-11. The web game (`Test Subject Social/game/src`) is being
ported to Godot 4.7.2 (GDScript, GL Compatibility, Windows + Android); the
props are modelled in Blender by script.

## Done
- Core framework: `src/core` (geometry, materials, textures incl. painted
  `Tex.canvas/image/text`, environment helpers, avatars, FX/gore, arena physics,
  bot AI, input, audio, haptics, i18n), `src/game` (players, flow, commendations),
  `src/ui` (HUD, backdrop, touch controls, all menu screens), `src/main.gd`.
- Intro, title screen, menus, points and final screens run.
- Minigame 1/30: **sawblade** (reference port) — the blade and hacksaws are built in
  Blender (`blender/props/sawblade.py`). Headless tests pass.
- Export templates 4.7.2 installed (checksum verified).

## Tools
- `godot/tools/check.ps1`: compile-check every script.
- `godot/tools/run.ps1 -Extra "--game=<id> --test --seeds=3"`: headless round test (prints TEST_RESULT).
- `godot/tools/play.ps1 -Extra "--game=<id> --quick --shot=<png> --shot-at=4,10"`: plays visibly via the
  editor's Play button (Live Follow plugin) and saves screenshots.
- `godot/tools/import.ps1`: imports new assets (via the open editor, otherwise headless).
- `blender/build.ps1 -Games "<id>,<id>"`: builds props in a visible Blender window and exports `.glb`.
- Live Follow editor plugin (`addons/live_follow`): opens changed scripts, previews new props,
  runs play requests. Start the editor with
  `Godot_v4.7.2-stable_win64.exe --editor --path godot --log-file godot/.live/editor.log`.

## Next
1. Port the other 29 minigames. The plan is 6 parallel workers, ~5 games each, every game following
   `src/minigames/sawblade.gd` + `blender/props/<id>.py`, each tested headless (2 and 4 players)
   and watched via `play.ps1`.
2. Calibrate lighting against the web version.
3. Online: EOS sidecar (Windows) and Android plugin; lockstep/host/client port.
4. Export presets, then build the Windows exe and Android APK and test on the phone.

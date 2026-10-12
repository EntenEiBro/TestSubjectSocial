# Porting a minigame from the web version to Godot 4.7.2

Source (read-only): `D:\Claude\test-subject-social\Test Subject Social\game\src\minigames\<id>.js`
Target script:      `D:\Claude\test-subject-social\godot\src\minigames\<id>.gd` (already listed in `registry.gd`)
Blender props:      `D:\Claude\test-subject-social\blender\props\<id>.py` → `godot/assets/models/props/<id>.glb`

**Reference port — read these first:** `sawblade.js` ↔ `godot/src/minigames/sawblade.gd` and
`blender/props/sawblade.py`. Also read `godot/src/minigames/minigame.gd` (the base class, a
line-by-line port of `base.js`) and skim the core helpers you use (`godot/src/core/*.gd`).

The port must play like the original: same rules, timings, dimensions, camera, bot behaviour,
HUD texts, sounds, commendations. Keep the structure and comments of the JS file; translate
idioms, not design.

## The user watches the work
The Godot editor stays open with the **Live Follow** plugin: scripts you write open in its script
editor, imported props are shown turning in its 3D view, and play requests run with its Play button.
Blender builds open a visible Blender window. So:
- **Never** close / restart the Godot editor, and never kill Godot or Blender processes you did not start.
- Use the tools below. Don't run Godot directly (no `--import`, no visible standalone windows).

## Tools (PowerShell; run with `powershell -NoProfile -ExecutionPolicy Bypass -File <script> ...`)
| Step | Command |
|---|---|
| Build props in Blender (visible, closes itself) | `D:\Claude\test-subject-social\blender\build.ps1 -Games "<id>"` |
| Import new / changed assets (done by the editor) | `D:\Claude\test-subject-social\godot\tools\import.ps1` |
| Compile-check all scripts | `D:\Claude\test-subject-social\godot\tools\check.ps1` (prints `CHECK_ALL ... failed=[...]` + errors; other workers' files may fail too, only fix yours) |
| Headless round test | `godot\tools\run.ps1 -Extra "--game=<id> --test --seeds=3"` and again with `--players=2` → `TEST_RESULT {...}`: every run must have `"finished":true` and all seats ranked, in a plausible sim time |
| Watch it / screenshots (editor Play, queued — can wait a few minutes) | `godot\tools\play.ps1 -Extra "--game=<id> --quick --shot=<your scratch dir>\<id>.png --shot-at=4,10,18" -Timeout 60` then **Read the PNGs** and compare with what the JS builds (layout, camera, colours, props, HUD). `--humans=1` makes seat 1 a keyboard player (WASD + F/G) if needed. |

`--quick` skips title card + briefing. Without `--test`/`--quick` the full flow runs (title card, 2-page briefing, countdown) — check the briefing renders once per game too.

## Blender props (models)
Model every distinctive object of the game in Blender — machines, hazards, furniture, weapons,
vehicles, pickups, signs with shape, anything that isn't a plain floor/wall/box/stencil/lamp
(those stay procedural through `Env.*`; avatars come from `Subject`).
- Write `blender/props/<id>.py` with `def build(root):` (see sawblade.py). Coordinates and
  rotations are written in **game space** (THREE: Y up, +Z toward camera) — `common.py` converts.
- Primitives mirror THREE geometry: `bm_box(w,h,d)`, `bm_cyl(rt, rb, h, seg)` (cone = `bm_cyl(0, r, h, seg)`),
  `bm_sphere(r, ws, hs)`, `bm_ico`, `bm_torus(radius, tube, radial, tubular)`, `bm_plane(w,h)`, `bm_circle`.
- `Merger()` joins all parts that always move together into ONE object (one draw call per
  material): `m.add(bm, mat, pos=(x,y,z), rot=(rx,ry,rz), scale=(sx,sy,sz))`, then
  `m.finish("name", root, pos=(...))`. The object origin is the pivot (the game resets the part's
  transform when it loads it); `finish(pos=...)` only spreads things out in Blender.
- Parts that move separately (a lid, a fork, a wheel) = separate objects; either load them
  separately by name, or parent them: `m2.finish("lid", parent=body_obj, pos=(local offset))` →
  in Godot `node.find_child("lid", true, false)`. Names must be unique inside the file.
- Materials: `game_mat(0xRRGGBB, "texname" or None, glow=False, double=False)` — Godot rebuilds
  these as the exact `Mats.mat` / `Mats.glow` the JS used (textures from `godot/assets/textures`:
  concrete, wall, tiles, metal, plate, rust, wood, crate, hazard, fabric, dirt, blood, ...).
  Faces get 0..1 UVs per face (`uv=k` in `add()` tiles k repeats per metre instead).
- In Godot: `var n := Props.make("<id>", "name")` returns a fresh Node3D copy with the game's
  materials. Materials are shared (cached); if the game recolours / fades one instance, give it its
  own: `mi.set_surface_override_material(0, mat.duplicate())` (or keep that part procedural).
- Build → import → test. After changing a prop, rebuild and re-import.
- Avoid naming a part exactly like the game id (the root empty has that name; parts are searched
  below it, but distinct names keep things clear, e.g. `forklift_body`).

## JS → GDScript cheat sheet
- Class: `extends Minigame`, `const META := {...}` (same keys/texts as `static meta`). Methods:
  `build()`, `start()`, `update(dt)`, `bot_think(seat, dt)`, `preview(dt)`, `placement()`.
  Base helpers: `make_scene({fog, fog_near, fog_far, ambient, ambient_intensity, floor_at})`,
  `make_camera(pos, look, fov)`, `spawn_subject(seat, {x, y, z, ring, facing})`,
  `kill(seat, style, {dir, force, sound, quiet})`, `alive_seats()`, `human_seats()`, `end(delay, tiers)`,
  `check_last_standing(min_alive)`, `award(seat, key)`, `progress(seat, key, n)`, `is_local(seat)`,
  `Minigame.group_by(sorted, key_fn)`, `Minigame.rank_by_score(list)`. Fields: `time`, `clock`, `state`,
  `seats`, `deaths`, `scene`, `camera`, `fx`, `hud`, `engine` (`engine.shake(a)`), `lockstep`.
- Seats are **Dictionaries**: `seat.player`, `seat.ctrl`, `seat.brain`, `seat.is_bot`, `seat.alive`,
  `seat.death_time`, `seat.score`, `seat.subject`, `seat.actor`, `seat.tag_target`. Add your own keys
  in `build()` (`seat["ammo"] = 3`) before reading them — reading a missing key is an error.
  Player: `p.name()` (a method!), `p.color` ("#rrggbb"), `p.slot`, `p.id`, `p.device`, `p.is_bot`.
- `ArenaActor.new({player, ctrl, subject, x, z, radius, speed})`; `Arena.new({bounds: {min_x, max_x,
  min_z, max_z}, shove, shove_force})`, `arena.step(dt, input_enabled)`, `add_wall(min_x, max_x, min_z,
  max_z)`, `add_circle(x, z, r)`, `on_shove = func(a, b)`, `clear_line(from, to)`. Actor fields:
  `pos, vel, knock, radius, speed, speed_mul, facing, alive, frozen, stun, y, vy, falling, seat, data`.
  Unknown fields (`a.carrying = x`) go to `a.data` automatically; reading one never set returns null.
- Controller (`seat.ctrl`): `move_x, move_y, a, b, a_pressed, b_pressed, a_released, b_released,
  dir_pressed` ("up"/"down"/"left"/"right"/""), bots: `set_move(x, z)`, `set_buttons(a, b)`, `tap_dir(d)`.
- AI: `AI.make_brain`, `AI.steer_to(actor, x, z, {arrive, slow})`, `AI.flee_from`, `AI.wander(actor, brain,
  dt, bounds)`, `AI.nearest(actor, actors, filter)` → `{actor, dist}` or null, `AI.try_shove`, `AI.release_buttons`.
- Randomness: simulation → `Rng.random()`, `Rng.rand(a, b)`, `Rng.rand_int(a, b)`, `Rng.pick(arr)`,
  `Rng.shuffle(arr)` (deterministic, online lockstep). Cosmetic-only (`crand` in JS) → `U.crand(a, b)` /
  `randf()`, `randi_range()`. Never `Time` / wall clock in simulation; use `time` / `clock`.
- Util: `U.damp(l, dt)`, `U.hypot`, `U.angle_diff`, `U.dist2d`, `U.col(c)`, `U.set_rot(n, x, y, z)`,
  `U.reparent_keep(node, parent)` (THREE attach), `U.add(parent, [children])`; clamp/lerp →
  `clampf`/`lerpf`; `TickTimer.new(seconds, repeat)` (`tick(dt)` → true when it fires, `remaining()`, `progress()`, `reset()`).
- THREE → Godot: `new THREE.Group()` → `Node3D.new()`; `new THREE.Mesh(geo, mat)` → `Env.mesh(Geo.box(w,h,d),
  mat, x, y, z)` (not added to a parent — `parent.add_child(m)`); `scene.add(o)` → `scene.add_child(o)`;
  `o.position.set(x,y,z)` → `o.position = Vector3(x,y,z)`; `scale.setScalar(s)` → `scale = Vector3.ONE * s`;
  `o.rotation.y = r` works the same, but a hand-made Node3D with several rotation axes needs
  `U.set_rot(n, x, y, z)` (THREE's XYZ Euler order; `Env.mesh` already sets it); `lookAt` →
  `Env.look_from(n, pos, target)` / `Env.aim(light, target_local)` (work outside the tree);
  `getWorldPosition` → `global_position` (only inside the tree); `remove()` → `remove_child` / `queue_free()`.
- Geometry `Geo.box/plane/cyl/cone/sphere/circle/ring/torus/ico/octa/tetra/lines` — THREE parameter semantics.
- Materials: `mat(color, Tex.x(rep), extra)` → `Mats.mat(color, Tex.x(Vector2(rx, ry)), extra)`;
  `glow(c)` / `MeshBasicMaterial` → `Mats.glow(c, extra)`. Extra keys: `opacity`, `transparent`,
  `double_side` (THREE.DoubleSide), `depth_write` (false), `emissive`, `emissive_intensity`,
  `emissive_map` (THREE emissiveMap: multiplied, not added), `additive`,
  `no_fog`, `shadeless`, `no_shadow`. Change later: `Mats.set_opacity(m, a)`, `Mats.set_color(m, c)`.
- Painted textures: `canvasTexture(key, size, paint, {repeat})` → `Tex.canvas(key, size, func(ci: CanvasItem,
  s: float): ..., Vector2(rep))` (`ci.draw_rect/draw_circle/draw_line/draw_polygon/draw_string/draw_arc`),
  per-pixel noise → `Tex.image(key, size, func(img: Image, s: int): ...)`; `textTexture(text, opts)` →
  `Tex.text(text, {w, h, font: "ops"|"vt"|"elite", size, color, bg, grimy})` (a Texture2D: use as
  `Mats.glow(0xffffff, {"tex": t})`). Screens redrawn during play (monitors, scoreboards) →
  `Env.monitor(...)` / `ScreenCanvas` (`screen.draw(func(ci, w, h): ...)`). InstancedMesh → MultiMeshInstance3D.
- Lights: `Env.point_light(color, intensity, distance, decay)`, `Env.spot_light(...)`, `Env.dir_light(...)`,
  `Env.hanging_lamp(parent, x, y, z, {color, intensity, angle, distance, shadow, target})` → `{group, light, bulb}`.
  Intensities are the JS numbers (converted inside). Don't create/remove lights mid-round: hide them.
- Environment: `Env.floor_plane(parent, w, d, {tex, tile, y, color, x, z})` (JS `floor`), `Env.block(parent, x,y,z,
  w,h,d, mat)`, `Env.room(parent, w, d, h, {tile, open, wall_tex, floor_tex, ceiling})`, `Env.stencil(parent, text,
  x, y, z, {w, h, rot_y, color, opacity})`, `Env.text3d`, `Env.pipe(parent, a, b, r, color)`, `Env.crate(parent,
  x, y, z, s, rot)`, `Env.hazard_strip(parent, x, z, w, d, y)`, `Env.player_ring(color)`,
  `Env.monitor(parent, x, y, z, {w, h, rot_x, rot_y})` → `{group, screen, draw}`, `Env.draw_symbol(ci, sym, cx, cy,
  r, color, lw)`, `Env.wall_fan(parent, x, y, z, {r, rot_y})` → `{group, update}`.
- Avatars: `Subject` — `s.root`, `s.parts` (hips, pelvis, legL, legR, torso, chest, armL, armR, handL, handR,
  head, skull, patch, neck, face, hat), `s.pose` (idle | carry | aim | armsUp | sit | cower | hold | push),
  `s.animate(dt, speed)`, `s.face_angle(angle, dt)`, `s.push()`, `s.ring`, `Subject.for_player(player)`.
- FX (`fx`): `kill` styles gib, shot, crush, fall, snap, burn, slice; `spray(pos, count, opts)`, `pool(x, z, size, y)`,
  `smoke(pos, opts)`, `sparks(pos, opts)`, `explosion(pos, scale)`, `add_body(node, vel, spin, opts)`, `reserve_flash()`.
- HUD (`hud`): `set_stat(seat, text)`, `set_status(seat, text)`, `set_timer(sec)` (`-1` hides = JS `null`;
  values between -1 and 0 show 0:00),
  `banner(text, ms, cls)` (cls "danger" / "good"), `prompt(text)` ("" hides), `feed(text, color)`, `mark_dead(seat)`.
  Pass the English text exactly as in JS (translation happens inside via `I18n.tr_msg`).
- Audio: `Audio.sfx(n, {vol})` → `Sfx.play(n, {"vol": v})`; `Audio.music(s)` → `Sfx.music(s)`. Available sounds:
  back, beep, burn, buzz, chew, chisel, clank, click, cough, crunch, ding, engine, explode, fork, go, grind, horn,
  inhale, inject, join, metal, puff, reload, saw, search, select, shot, shove, snap, sonar, spider, splat, step,
  sting, thud, tick, train, trainHorn, whoosh, win, wrong.
- `Haptics.forPlayer(p, f)` → `Haptics.for_player(p, f)`; `Commendations` keys as in JS (`commendations.gd` DEFS).
- If a JS game imports another game's class (e.g. `extends CableRun`), port that dependency as written.

## GDScript pitfalls (each one has bitten already)
- `var x := expr` needs a typed expression. Dictionary values, `max`/`min`, untyped arrays and
  ArenaActor dynamic fields are Variant → write `var x: float = ...` or use `maxf/minf/maxi/mini/clampf`.
- Lambdas capture locals **by value**: a primitive changed inside a lambda doesn't change outside —
  keep shared state in a Dictionary/Array or in member variables.
- Don't name functions/variables after built-ins (`floor`, `range`, `str`, `min`, ...).
- `look_at()` / `global_position` / `to_global` fail outside the scene tree — `build()` runs before the
  stage is in the tree; use `Env.look_from` / local math there.
- `%` on floats → `fmod`; integer division warns — use floats where JS does.
- Seat/actor Dictionaries + RefCounted cycles: clear `seat.actor = null` in an overridden `dispose()`
  (then `super.dispose()`), like sawblade.gd.
- `==` (and `Array.find/has`) compare Dictionaries by content: use `is_same(a, b)` for seat identity.
- Children of a `Props.make` copy have no owner: `node.find_child("lid", true, false)`.
- JS `color.setRGB()/setHSL()` values are linear (three's colour management): convert with
  `Color(r, g, b).linear_to_srgb()`.
- With bots only, the flow skips the briefing; use `--humans=1` to see the briefing pages.

## Rules
- Only edit your own files (`src/minigames/<id>.gd`, `blender/props/<id>.py`). If a core helper is
  truly missing, add a small static helper in your own script instead; report anything you think
  should change in core.
- No git commands. Don't touch other games' files, `registry.gd`, `main.gd`, the editor, or the plugin.
- Finish each game completely (port → props → check → headless tests 4 + 2 players → visual check with
  screenshots → fixes) before starting the next.

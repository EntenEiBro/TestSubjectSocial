extends Minigame
## CHISEL TEST — every subject gets a workbench, a mallet and a slab of nine
## clay blocks. The big monitor shows a TARGET pattern: which of the nine
## blocks must be chiselled away. Carve it, submit it, keep your head.
##
## Rules:
##   - Move the cursor one cell at a time; A chisels the block out (press again
##     on an empty cell to put it back); B submits your slab (locks it).
##   - When the timer runs out (12s, shrinking by 1s per pattern to 5s) or all
##     living subjects have submitted, every slab is judged. Unsubmitted slabs
##     that happen to be correct count as correct.
##   - Wrong slab → a ceiling turret descends and executes you.
##   - Patterns grow from 2 removed cells to 7. Last subject alive wins;
##     anyone still alive after 8 patterns shares first place.
## Bench, slab base, mallet, chisel and turret models: blender/props/chisel.py.

const META := {
	"id": "chisel",
	"title": "CHISEL TEST",
	"tagline": "Measure twice. Cut once. Die never, ideally.",
	"category": "Precision",
	"controls": [{"input": "move", "label": "Move cursor"}, {"input": "a", "label": "Chisel / restore"}, {"input": "b", "label": "Submit"}],
	"objective": "Carve the pattern on the monitor correctly, every time.",
	"rules": [
		"The monitor shows which blocks to remove (hollow squares). Carve your slab to match.",
		"{A} chisels or restores the block under your cursor. {B} submits.",
		"When time runs out, every wrong slab earns its carver a visit from the ceiling turret.",
		"Patterns get bigger and the clock gets shorter. Survive all eight.",
	],
}

const PATTERNS := 8
const CUBE := 0.4
const PITCH := 0.46
const SLAB_TILT := 0.32            # radians the slab tips toward the camera
const SPACING := 2.8               # station spacing along X
const PLAYER_DX := -0.95           # subjects stand at the left end of their bench...
const PLAYER_Z := 0.0              # ...level with the slab, facing it (+X)
const SLAB_DX := 0.3               # slab offset to the right of the station centre
const BENCH_TOP := 0.92
const TURRET_UP := 6.0
const TURRET_DOWN := 3.15
const LAMP := {"work": 0xd99a22, "sent": 0x3a8fff, "pass": 0x39ff5a, "fail": 0xff2a1a, "off": 0x222222}
const NONE := -1                   # bench.pass: -1 = not judged, 0 = failed, 1 = passed

var screen: Dictionary
var cube_geo: Mesh
var cube_mat: StandardMaterial3D
var chip_geo: Mesh
var round_n := 0
var phase := "idle"   # "idle" | "work" | "verdict" | "intermission"
var phase_t := 0.0
var target := []
var _screen_key := ""
var _last_tick := 0
var _fired := false


## Seconds allowed for pattern `r` (1-based).
static func time_for(r: int) -> float:
	return maxf(5.0, 12.0 - (r - 1))


## Blocks to remove for pattern `r` (1-based).
static func cells_for(r: int) -> int:
	return mini(7, 1 + r)


func build() -> void:
	make_scene({"fog_near": 14.0, "fog_far": 40.0, "ambient_intensity": 1.0})
	make_camera([0, 5.3, 7.0], [0, 1.55, -0.35], 46)

	# Room
	Env.floor_plane(scene, 30, 20, {"tex": "concrete", "tile": 3.0})
	Env.block(scene, 0, 3, -2.75, 30, 6, 0.3, Mats.mat(0xffffff, Tex.wall(Vector2(8, 2))))
	Env.hazard_strip(scene, 0, 1.5, 14, 0.35, 0.012)
	Env.stencil(scene, "PRECISION IS MANDATORY", -4.6, 4.7, -2.58, {"w": 5.0, "h": 1.1, "opacity": 0.4})
	Env.stencil(scene, "NO REFUNDS", 4.9, 4.7, -2.58, {"w": 3.6, "h": 1.1, "opacity": 0.4})
	Env.pipe(scene, [-14, 5.6, -2.4], [14, 5.6, -2.4], 0.14)
	Env.block(scene, 0, 5.75, 1.0, 14, 0.18, 0.25, Mats.mat(0x55574f, Tex.metal()))   # turret rail

	# Big target monitor
	screen = Env.monitor(scene, 0, 2.75, -2.3, {"w": 2.3, "h": 1.72, "rot_x": -0.2})
	_screen_key = ""

	Env.hanging_lamp(scene, -3, 6.4, 0.6, {"intensity": 70.0, "angle": 0.9})
	Env.hanging_lamp(scene, 3, 6.4, 0.6, {"intensity": 70.0, "angle": 0.9})

	# Shared resources
	cube_geo = Geo.box(CUBE, CUBE, CUBE)
	cube_mat = Mats.mat(0xe6cfa2, Tex.concrete())
	chip_geo = Geo.box(0.06, 0.06, 0.06)

	var n := seats.size()
	for i in n:
		_build_station(seats[i], (i - (n - 1) / 2.0) * SPACING)

	round_n = 0
	phase = "idle"
	phase_t = 0.0
	target = []
	target.resize(9)
	target.fill(false)


## Bench, slab of nine cubes, cursor frame, status lamp, tools and a turret.
func _build_station(seat: Dictionary, x: float) -> void:
	var color: String = seat.player.color
	# Bench
	var bench := Props.make("chisel", "bench")
	bench.position = Vector3(x + SLAB_DX, 0, 0)
	scene.add_child(bench)

	# Slab: tilted base plate with nine cubes on top.
	var slab := Node3D.new()
	slab.add_child(Props.make("chisel", "slab_base"))
	var cubes := []
	for r in 3:
		for c in 3:
			var cube := Env.mesh(cube_geo, cube_mat, (c - 1) * PITCH, 0.04 + CUBE / 2, (r - 1) * PITCH)
			slab.add_child(cube)
			cubes.append({"mesh": cube, "pop": 1.0})
	# Cursor: four glowing bars in the player's colour.
	var cursor := Node3D.new()
	var bar_mat := Mats.glow(color)
	var l := PITCH
	var t := 0.045
	cursor.add_child(Env.mesh(Geo.box(l, t, t), bar_mat, 0, 0, -l / 2, {"cast": false}))
	cursor.add_child(Env.mesh(Geo.box(l, t, t), bar_mat, 0, 0, l / 2, {"cast": false}))
	cursor.add_child(Env.mesh(Geo.box(t, t, l), bar_mat, -l / 2, 0, 0, {"cast": false}))
	cursor.add_child(Env.mesh(Geo.box(t, t, l), bar_mat, l / 2, 0, 0, {"cast": false}))
	slab.add_child(cursor)
	slab.position = Vector3(x + SLAB_DX, BENCH_TOP + 0.12, 0.05)
	slab.rotation.x = SLAB_TILT
	scene.add_child(slab)

	# Status lamp on the bench front.
	var lamp_mat := Mats.glow(LAMP.off)
	scene.add_child(Env.mesh(Geo.sphere(0.09, 8, 6), lamp_mat, x + SLAB_DX + 0.68, BENCH_TOP - 0.25, 0.68, {"cast": false}))

	# Subject + tools (mallet right hand, chisel left hand).
	var s := spawn_subject(seat, {"x": x + PLAYER_DX, "z": PLAYER_Z, "facing": PI / 2})
	s.pose = "hold"
	var mallet := Props.make("chisel", "mallet")
	mallet.position = Vector3(0, -0.78, 0.06)
	mallet.rotation.x = PI / 2
	s.parts.armR.add_child(mallet)
	var tool := Props.make("chisel", "chisel_tool")
	tool.position = Vector3(0, -0.8, 0.12)
	s.parts.armL.add_child(tool)

	# Ceiling turret, parked above the frame until needed.
	var turret := Node3D.new()
	turret.add_child(Props.make("chisel", "turret_arm"))
	var head := Props.make("chisel", "turret_head")
	var muzzle := Node3D.new()
	muzzle.position = Vector3(0, 0, 0.75)
	head.add_child(muzzle)
	var laser_mat := Mats.glow(0xff2010, {"opacity": 0.75})
	var laser := Env.mesh(Geo.box(0.02, 0.02, 1), laser_mat, 0, 0, 0, {"cast": false})
	laser.visible = false
	head.add_child(laser)
	var flash := Env.point_light(0xffc070, 0, 7, 1.5)
	muzzle.add_child(flash)
	turret.add_child(head)
	turret.position = Vector3(x + PLAYER_DX, TURRET_UP, 1.0)
	scene.add_child(turret)

	var removed := []
	removed.resize(9)
	removed.fill(false)
	seat["bench"] = {
		"x": x, "slab": slab, "cubes": cubes, "cursor": cursor, "lamp_mat": lamp_mat, "mallet": mallet,
		"removed": removed, "cur": 4, "submitted": false, "pass": NONE, "swing": 0.0,
		"turret": {"group": turret, "head": head, "muzzle": muzzle, "laser": laser, "laser_mat": laser_mat, "flash": flash,
			"y": TURRET_UP, "want_down": false, "aim": false},
	}
	_place_cursor(seat)


# ------------------------------------------------------------- patterns

## Start pattern `round`: new target, fresh slabs, reset submissions.
func _begin_pattern() -> void:
	round_n += 1
	var k := cells_for(round_n)
	var cells := Rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]).slice(0, k)
	target = []
	target.resize(9)
	target.fill(false)
	for i in cells:
		target[i] = true
	phase = "work"
	phase_t = time_for(round_n)
	_last_tick = ceili(phase_t)
	for seat in alive_seats():
		var b: Dictionary = seat.bench
		b.removed.fill(false)
		for i in b.cubes.size():
			var cb: Dictionary = b.cubes[i]
			cb.mesh.visible = true
			cb.pop = -0.1 * i / 9.0 - 0.05   # staggered drop-in
		b.submitted = false
		b.pass = NONE
		b.cur = 4
		Mats.set_color(b.lamp_mat, LAMP.work)
		_place_cursor(seat)
	Sfx.play("beep")
	hud.banner("PATTERN %d" % round_n, 1100)
	hud.prompt("PATTERN %d / %d — carve the shape on the monitor" % [round_n, PATTERNS])


## Judge every living slab and schedule executions.
func _verdict() -> void:
	phase = "verdict"
	phase_t = 0.0
	_fired = false
	hud.banner("VERDICT", 1200, "danger")
	Sfx.play("horn", {"vol": 0.6})
	for seat in alive_seats():
		var b: Dictionary = seat.bench
		var ok := true
		for i in 9:
			if b.removed[i] != target[i]:
				ok = false
		b.pass = 1 if ok else 0
		Mats.set_color(b.lamp_mat, LAMP.pass if ok else LAMP.fail)
		b.turret.want_down = not ok
		Sfx.play("ding" if ok else "wrong", {"vol": 0.7})


func start() -> void:
	_begin_pattern()


func preview(dt: float) -> void:
	_animate(dt)
	_draw_screen()


func update(dt: float) -> void:
	var playing := state == "play"
	if playing:
		phase_t += -dt if phase == "work" else dt
		if phase == "work":
			_work()
		elif phase == "verdict":
			_run_verdict()
		elif phase == "intermission" and phase_t > 1.2:
			_begin_pattern()
	_animate(dt)
	_draw_screen()
	if not playing:
		return

	hud.set_timer(phase_t if phase == "work" else -1.0)
	for seat in seats:
		var b: Dictionary = seat.bench
		var txt := "CARVING"
		if not seat.alive:
			txt = "EXECUTED"
		elif b.pass == 1:
			txt = "PASSED"
		elif b.pass == 0:
			txt = "FAILED"
		elif b.submitted:
			txt = "SUBMITTED"
		hud.set_stat(seat, txt)
		hud.set_status(seat, "PATTERN %d/%d" % [round_n, PATTERNS] if seat.alive else "")


## Read inputs during the carving phase; end it on timeout or full submission.
func _work() -> void:
	var sec := ceili(phase_t)
	if sec != _last_tick and sec >= 0:
		_last_tick = sec
		if sec <= 3:
			Sfx.play("tick", {"vol": 2.0})
	for seat in alive_seats():
		var b: Dictionary = seat.bench
		var c: Controller = seat.ctrl
		if b.submitted:
			continue
		if c.dir_pressed != "":
			var r: int = b.cur / 3
			var col: int = b.cur % 3
			match c.dir_pressed:
				"up": r -= 1
				"down": r += 1
				"left": col -= 1
				"right": col += 1
			var nc := clampi(r, 0, 2) * 3 + clampi(col, 0, 2)
			if nc != b.cur:
				b.cur = nc
				_place_cursor(seat)
				Sfx.play("click", {"vol": 0.5})
		if c.a_pressed:
			_toggle(seat)
		if c.b_pressed:
			b.submitted = true
			b.cursor.visible = false
			Mats.set_color(b.lamp_mat, LAMP.sent)
			Sfx.play("select", {"vol": 0.7})
	if phase_t <= 0 or alive_seats().all(func(s): return s.bench.submitted):
		_verdict()


## Chisel out (or restore) the cell under the cursor.
func _toggle(seat: Dictionary) -> void:
	var b: Dictionary = seat.bench
	var i: int = b.cur
	var cb: Dictionary = b.cubes[i]
	b.swing = 0.2
	b.removed[i] = not b.removed[i]
	var cube: MeshInstance3D = cb.mesh
	var p := cube.global_position if cube.is_inside_tree() else Vector3.ZERO
	if b.removed[i]:
		cube.visible = false
		Sfx.play("chisel")
		Sfx.play("crunch", {"vol": 0.3})
		for k in 3:
			var ox := Rng.rand(-0.12, 0.12)
			var oy := Rng.rand(0, 0.15)
			var oz := Rng.rand(-0.12, 0.12)
			var chip := Env.mesh(chip_geo, cube_mat, p.x + ox, p.y + oy, p.z + oz)
			scene.add_child(chip)
			var vx := Rng.rand(-2, 2)
			var vy := Rng.rand(2, 4)
			var vz := Rng.rand(-1, 2.5)
			var sx := Rng.rand(-9, 9)
			var sy := Rng.rand(-9, 9)
			var sz := Rng.rand(-9, 9)
			fx.add_body(chip, Vector3(vx, vy, vz), Vector3(sx, sy, sz), {"life": 1.6, "bleed": false, "radius": 0.06, "bounce": 0.4})
		fx.smoke(p, {"color": 0xb8ab90, "size": 0.14, "life": 0.8, "rise": 0.6, "opacity": 0.55})
	else:
		cube.visible = true
		cb.pop = 0.25
		Sfx.play("thud", {"vol": 0.6})


## Verdict timeline: turrets descend, aim, fire; then next pattern or the end.
func _run_verdict() -> void:
	var t := phase_t
	var doomed := alive_seats().filter(func(s): return s.bench.pass == 0)
	if t > 0.9 and t < 1.6:
		for s in doomed:
			s.bench.turret.aim = true
	if t >= 1.6 and not _fired:
		_fired = true
		for s in doomed:
			var tr: Dictionary = s.bench.turret
			tr.aim = false
			var from: Vector3 = tr.muzzle.global_position
			var to: Vector3 = s.subject.parts.chest.global_position
			tr.flash.light_energy = 50.0 * Env.LIGHT_K
			fx.sparks(from, {"count": 14, "speed": 6.0})
			fx.smoke(from, {"size": 0.2, "life": 1.0, "opacity": 0.4})
			# Same instant for everyone failing this pattern → shared placement tier.
			kill(s, "shot", {"dir": to - from, "force": 1.3})
		if doomed.is_empty():
			Sfx.play("ding")
	if t >= 2.7:
		for s in seats:
			s.bench.turret.want_down = false
		var alive := alive_seats()
		if alive.size() <= 1 or round_n >= PATTERNS:
			if round_n >= PATTERNS and not alive.is_empty():
				for s in alive:
					award(s, "masterMason")
				hud.banner("APPRENTICES SURVIVE" if alive.size() > 1 else "MASTER MASON", 2000, "good")
			hud.prompt("")
			end()
			return
		phase = "intermission"
		phase_t = 0.0
		for s in alive:
			s.bench.pass = NONE
			Mats.set_color(s.bench.lamp_mat, LAMP.off)


# ------------------------------------------------------------- visuals

func _place_cursor(seat: Dictionary) -> void:
	var b: Dictionary = seat.bench
	var r: int = b.cur / 3
	var c: int = b.cur % 3
	b.cursor.position = Vector3((c - 1) * PITCH, 0.04 + CUBE + 0.03, (r - 1) * PITCH)


func _animate(dt: float) -> void:
	var now := clock * 1000
	for seat in seats:
		var b: Dictionary = seat.bench
		# Cubes: drop-in / restore pop.
		for cb in b.cubes:
			if cb.pop != 1.0:
				cb.pop = minf(1.0, cb.pop + dt * 4)
				var k := clampf(cb.pop, 0.0, 1.0)
				var m: MeshInstance3D = cb.mesh
				m.position.y = 0.04 + CUBE / 2 + (1 - k) * 0.6
				m.scale = Vector3.ONE * lerpf(0.6, 1.0, k)
				if cb.pop >= 1.0:
					m.position.y = 0.04 + CUBE / 2
					m.scale = Vector3.ONE
		b.cursor.visible = seat.alive and not b.submitted and phase == "work" and int(floor(now / 180)) % 4 != 0
		# Turret: descend / park, aim at the subject, laser while aiming.
		var tr: Dictionary = b.turret
		tr.y += ((TURRET_DOWN if tr.want_down else TURRET_UP) - tr.y) * U.damp(5, dt)
		var group: Node3D = tr.group
		group.position.y = tr.y
		var tgt := Vector3(b.x + PLAYER_DX, 1.3, PLAYER_Z)
		var dir := tgt - group.position
		var head: Node3D = tr.head
		if dir.length() > 1e-4:
			head.basis = Basis.looking_at(dir, Vector3.UP, true)   # THREE lookAt: +Z toward the target
		var laser: MeshInstance3D = tr.laser
		laser.visible = tr.aim
		if tr.aim:
			var d := dir.length()
			laser.scale.z = d
			laser.position = Vector3(0, 0, d / 2)
			Mats.set_opacity(tr.laser_mat, 0.5 + sin(now * 0.05) * 0.3)
		var flash: OmniLight3D = tr.flash
		flash.light_energy *= exp(-dt * 20)
		if not seat.alive:
			continue
		# Subject: idle hold, mallet strike on each chisel blow.
		var s: Subject = seat.subject
		var p: Dictionary = s.parts
		if b.pass == 0 and phase == "verdict":
			s.pose = "cower"
			s.animate(dt, 0)
			continue
		s.animate(dt, 0)
		b.swing = maxf(0.0, b.swing - dt)
		var ax := -2.1 if b.swing > 0.1 else (-0.75 if b.swing > 0 else -1.25)
		p.armR.rotation.x += (ax - p.armR.rotation.x) * U.damp(30, dt)
		p.armR.rotation.z = -0.1
		p.armL.rotation.x = -0.95
		p.armL.rotation.z = 0.15
		p.torso.rotation.x = 0.22
		p.head.rotation.x = 0.35   # stare at the slab


## Centred monitor text at (x, y) (textBaseline 'middle').
static func _text(ci: CanvasItem, text: String, x: float, y: float, size: int, color: String) -> void:
	var font := UI.font("vt")
	var base := y + (font.get_ascent(size) - font.get_descent(size)) / 2.0
	ci.draw_string(font, Vector2(x - 64, base), text, HORIZONTAL_ALIGNMENT_CENTER, 128, size, U.col(color))


## Big monitor: target grid, pattern number and timer.
func _draw_screen() -> void:
	var blink := int(floor(clock * 1000 / 250)) % 2 == 0
	var sec := maxi(0, ceili(phase_t))
	var tstr := ""
	for v in target:
		tstr += "1" if v else "0"
	var key := "%s|%d|%s|%s" % [phase, round_n, tstr, str(sec) if phase == "work" else str(blink)]
	if key == _screen_key:
		return
	_screen_key = key
	var ph := phase
	var rn := round_n
	var tg := target.duplicate()
	screen.screen.draw(func(ci: CanvasItem, _w: float, _h: float):
		var green := U.col("#39ff5a")
		if ph == "idle":
			if blink:
				_text(ci, "AWAITING PATTERN", 64, 48, 14, "#39ff5a")
			return
		# Target grid: solid blocks stay, hollow squares must be removed.
		var sz := 24.0
		var ox := 8.0
		var oy := 16.0
		for i in 9:
			var x := ox + (i % 3) * (sz + 2)
			var y := oy + int(i / 3) * (sz + 2)
			if tg[i]:
				var a := Vector2(x + 2, y + 2)
				var b := Vector2(x + sz - 2, y + sz - 2)
				ci.draw_dashed_line(a, Vector2(b.x, a.y), green, 2.0, 3.0)
				ci.draw_dashed_line(Vector2(b.x, a.y), b, green, 2.0, 3.0)
				ci.draw_dashed_line(b, Vector2(a.x, b.y), green, 2.0, 3.0)
				ci.draw_dashed_line(Vector2(a.x, b.y), a, green, 2.0, 3.0)
			else:
				ci.draw_rect(Rect2(x, y, sz, sz), green)
				ci.draw_rect(Rect2(x + sz - 4, y, 4, sz), U.col("#1f8f34"))
				ci.draw_rect(Rect2(x, y + sz - 4, sz, 4), U.col("#1f8f34"))
		_text(ci, "TARGET", 46, 8, 10, "#39ff5a")
		_text(ci, "PATTERN %d/%d" % [rn, PATTERNS], 104, 10, 10, "#39ff5a")
		if ph == "work":
			_text(ci, str(sec), 104, 48, 34, "#ff3a26" if sec <= 3 else "#39ff5a")
			_text(ci, "CUT %d" % tg.count(true), 104, 78, 10, "#39ff5a")
		elif ph == "verdict":
			if blink:
				_text(ci, "VERDICT", 104, 48, 13, "#ff3a26")
		else:
			_text(ci, "NEXT", 104, 48, 13, "#39ff5a"))


# ------------------------------------------------------------- placement

## Survivors share first; the executed are grouped by the instant they died.
func placement() -> Array:
	var tiers := []
	var alive := alive_seats()
	if not alive.is_empty():
		tiers.append(alive)
	var dead := deaths.duplicate()
	dead.reverse()
	tiers.append_array(Minigame.group_by(dead, func(s): return snappedf(s.death_time, 0.001)))
	return tiers


# ------------------------------------------------------------------- bots

func bot_think(seat: Dictionary, dt: float) -> void:
	var c: Controller = seat.ctrl
	var brain: Dictionary = seat.brain
	var m: Dictionary = brain.memory
	var b: Dictionary = seat.bench
	c.set_buttons(false, false)
	c.set_move(0, 0)
	if phase != "work" or b.submitted:
		return
	if m.get("round", -1) != round_n:
		# New pattern: read the monitor (clumsy bots occasionally misread one cell).
		m["round"] = round_n
		m["wait"] = brain.reaction + Rng.rand(0.3, 0.7) + cells_for(round_n) * 0.07
		m["goal"] = target.duplicate()
		if Rng.random() < brain.error * 0.8:
			var i := int(floor(Rng.random() * 9))
			m.goal[i] = not m.goal[i]
	m.wait -= dt
	if m.wait > 0:
		return
	m["wait"] = lerpf(0.4, 0.17, brain.difficulty) + Rng.rand(-0.02, 0.08)

	var needed := []
	for i in 9:
		if b.removed[i] != m.goal[i]:
			needed.append(i)
	if needed.is_empty():
		c.set_buttons(false, true)   # submit
		return
	var r0: int = b.cur / 3
	var c0: int = b.cur % 3
	# Rare slip: chisel the wrong cell (it will notice and fix it if time allows).
	if not (b.cur in needed) and Rng.random() < brain.error * 0.4:
		c.set_buttons(true, false)
		return
	var best: int = needed[0]
	var bd := 99
	for i in needed:
		var d: int = absi(i / 3 - r0) + absi(i % 3 - c0)
		if d < bd:
			bd = d
			best = i
	if best == b.cur:
		c.set_buttons(true, false)
		return
	var r1 := best / 3
	var c1 := best % 3
	if r1 != r0:
		c.tap_dir("up" if r1 < r0 else "down")
	else:
		c.tap_dir("left" if c1 < c0 else "right")


func dispose() -> void:
	for seat in seats:
		seat.brain.memory.clear()
	super.dispose()

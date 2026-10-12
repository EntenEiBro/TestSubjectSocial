extends Minigame
## SYMBOL FLOOR — an 8×6 grid of piston-mounted floor plates hangs over a
## bottomless shaft. Every plate glows with one of four symbols.
##
## Rules:
##   - Wall monitors announce a doomed symbol and count down (4s, shrinking to
##     1.8s as the round goes on). On the horn every remaining plate showing
##     that symbol tips over and drops into the pit — gone for good.
##   - Anyone whose centre is over a missing plate falls and dies.
##   - Every second cycle the surviving plates are reassigned new symbols.
##   - Diagonal movement is allowed; B shoves rivals (ideally onto doomed plates).
##   - Last subject standing wins. After 90s the floor collapses randomly.
## Plate (with its piston) and pit spike models: blender/props/symbolfloor.py.

const META := {
	"id": "symbolfloor",
	"title": "SYMBOL FLOOR",
	"tagline": "Literacy is a load-bearing skill.",
	"category": "Survival",
	"controls": [{"input": "move", "label": "Move"}, {"input": "b", "label": "Shove"}],
	"objective": "Stay on solid floor longer than everyone else.",
	"rules": [
		"The monitors name a symbol. When the horn sounds, every plate with that symbol drops.",
		"Stand over a missing plate and you fall. The shaft has no bottom worth mentioning.",
		"Plates swap symbols every few cycles. Shove rivals onto the doomed ones.",
	],
}

const COLS := 8
const ROWS := 6
const TS := 1.6                      # tile pitch (centre to centre)
const GAP := 0.1                     # visual gap between plates
const TH := 0.3                      # plate thickness
const GW := COLS * TS                # grid extents
const GD := ROWS * TS
const SYMBOLS := ["X", "O", "S", "T"]
const SYMBOL_NAMES := {"X": "CROSS", "O": "CIRCLE", "S": "SQUARE", "T": "TRIANGLE"}
const SHUDDER := 0.35                # seconds a doomed plate rattles before it goes
const COLLAPSE_AT := 90.0            # seconds until the floor starts failing at random
const HARD_CAP := 125.0              # absolute round limit (safety net)
const TOP_MAT := "m_none_41443f"     # the plate model's placeholder top-face material

var arena: Arena
var grid := []
var monitors := []
var sym_mats := {}
var doom_mats := {}
var pit_light: OmniLight3D
var phase := "idle"     # "idle" | "calm" | "announce" | "drop" | "collapse"
var phase_t := 0.0      # time left in the current phase
var phase_len := 1.0    # total length of the current phase
var doomed = null       # symbol currently announced
var cycle := 0
var collapse_t := 0.0
var _last_tick := -1
var _screen_key := ""
var _ten_awarded := false
var _top_idx := -1


## Paint the grimy metal face of a plate with a symbol on top (port of plateCanvas;
## emissive_only = black with just the symbol, for the emission map).
static func _paint_plate(img: Image, s: int, sym: String, color: Color, emissive_only: bool) -> void:
	if emissive_only:
		img.fill(Color.BLACK)
	else:
		var base := Color("#41443f")
		for y in s:
			for x in s:
				var n := (randf() - 0.5) * 26.0 / 255.0
				var c := Color(base.r + n, base.g + n, base.b + n)
				if x < 4 or x >= s - 4 or y < 4 or y >= s - 4:
					c = c.lerp(Color.BLACK, 0.6)
				elif ((x == 7 or x == 121) and y >= 7 and y <= 121) or ((y == 7 or y == 121) and x >= 7 and x <= 121):
					c = c.lerp(Color.WHITE, 0.08)
				img.set_pixel(x, y, c)
		for b in [[12, 12], [116, 12], [12, 116], [116, 116]]:
			_disc(img, b[0], b[1], 4.0, Color("#23251f"), 1.0)
		for i in 6:
			_disc(img, U.crand(0, 128), U.crand(0, 128), U.crand(6, 20), Color8(90, 50, 20), U.crand(0.1, 0.25))
	# drawSymbol(ctx, sym, 64, 64, 34, color, 11) with square line caps
	var r := 34.0
	var hw := 5.5
	for y in range(int(64 - r - 8), int(64 + r + 8)):
		for x in range(int(64 - r - 8), int(64 + r + 8)):
			if _in_symbol(sym, x + 0.5, y + 0.5, 64.0, 64.0, r, hw):
				img.set_pixel(x, y, color)


static func _disc(img: Image, cx: float, cy: float, rad: float, color: Color, alpha: float) -> void:
	var s := img.get_width()
	for y in range(maxi(0, int(cy - rad - 1)), mini(s, int(cy + rad + 2))):
		for x in range(maxi(0, int(cx - rad - 1)), mini(s, int(cx + rad + 2))):
			if U.hypot(x + 0.5 - cx, y + 0.5 - cy) <= rad:
				img.set_pixel(x, y, img.get_pixel(x, y).lerp(color, alpha))


## Stroke coverage of a symbol (X, O, S = square, T = triangle) at pixel (px, py).
static func _in_symbol(sym: String, px: float, py: float, cx: float, cy: float, r: float, hw: float) -> bool:
	match sym:
		"X":
			return _seg(px, py, cx - r, cy - r, cx + r, cy + r, hw) or _seg(px, py, cx + r, cy - r, cx - r, cy + r, hw)
		"O":
			return absf(U.hypot(px - cx, py - cy) - r) <= hw
		"S":
			return absf(maxf(absf(px - cx), absf(py - cy)) - r) <= hw
		"T":
			var a := Vector2(cx, cy - r)
			var b := Vector2(cx + r, cy + r * 0.8)
			var c := Vector2(cx - r, cy + r * 0.8)
			return _seg(px, py, a.x, a.y, b.x, b.y, hw) or _seg(px, py, b.x, b.y, c.x, c.y, hw) or _seg(px, py, c.x, c.y, a.x, a.y, hw)
	return false


## Inside a line segment stroke of half-width hw with square caps.
static func _seg(px: float, py: float, ax: float, ay: float, bx: float, by: float, hw: float) -> bool:
	var dx := bx - ax
	var dy := by - ay
	var l := sqrt(dx * dx + dy * dy)
	var ux := dx / l
	var uy := dy / l
	var qx := px - ax
	var qy := py - ay
	var t := qx * ux + qy * uy
	return t >= -hw and t <= l + hw and absf(qx * uy - qy * ux) <= hw


func build() -> void:
	make_scene({"fog_near": 16.0, "fog_far": 42.0, "floor_at": func(x: float, z: float) -> float: return 0.0 if _present(tile_at(x, z)) else -INF})
	make_camera([0, 14.2, 10.6], [0, 0, 0.35], 50)

	_build_shaft()
	_build_tiles()

	# Wall monitors announcing the doomed symbol.
	# Tilted down toward the camera (negative rot_x turns the screen face upward).
	monitors = []
	for x in [-4.3, 0.0, 4.3]:
		monitors.append(Env.monitor(scene, x, 2.0, -GD / 2 + 0.25, {"w": 2.4, "h": 1.8, "rot_x": -0.5}))
	_screen_key = ""

	Env.hanging_lamp(scene, -3.5, 7.5, 0.4, {"intensity": 95.0, "angle": 0.95})
	Env.hanging_lamp(scene, 3.5, 7.5, 0.4, {"intensity": 95.0, "angle": 0.95})

	# Arena + avatars on four interior plates.
	arena = Arena.new({"bounds": {"min_x": -GW / 2, "max_x": GW / 2, "min_z": -GD / 2, "max_z": GD / 2}, "shove_force": 12.5})
	var cells := [[2, 1], [5, 1], [2, 4], [5, 4]]
	for i in seats.size():
		var seat: Dictionary = seats[i]
		var t: Dictionary = grid[cells[i][1] * COLS + cells[i][0]]
		spawn_subject(seat, {"x": t.x, "z": t.z})
		seat.actor = arena.add(ArenaActor.new({"player": seat.player, "ctrl": seat.ctrl, "subject": seat.subject, "x": t.x, "z": t.z}))
		seat.actor.seat = seat

	phase = "idle"
	phase_t = 0.0
	phase_len = 1.0
	doomed = null
	cycle = 0
	collapse_t = 0.0
	_last_tick = -1


## Shaft walls, pit floor, railings and grime.
func _build_shaft() -> void:
	var wall_mat := Mats.mat(0xffffff, Tex.wall(Vector2(3, 3)))
	var rust_mat := Mats.mat(0x9a9a9a, Tex.rust(Vector2(3, 4)))
	# Walls run from the pit bottom up past the floor level.
	Env.block(scene, 0, -2, -GD / 2 - 0.25, GW + 1.0, 14, 0.5, wall_mat)
	Env.block(scene, -GW / 2 - 0.25, -2, 0.25, 0.5, 14, GD + 0.5, wall_mat)
	Env.block(scene, GW / 2 + 0.25, -2, 0.25, 0.5, 14, GD + 0.5, wall_mat)
	Env.block(scene, 0, -4.8, GD / 2 + 0.3, GW + 1.0, 9, 0.4, rust_mat)   # front lip below floor level
	# Pit floor far below with a sullen red glow and some spikes.
	var pit_floor := Env.mesh(Geo.plane(GW, GD), Mats.mat(0x2a1d16, Tex.rust(Vector2(4, 3))), 0, -9, 0, {"cast": false})
	pit_floor.rotation.x = -PI / 2
	scene.add_child(pit_floor)
	for i in 40:
		var sx := Rng.rand(-GW / 2 + 0.4, GW / 2 - 0.4)
		var sz := Rng.rand(-GD / 2 + 0.4, GD / 2 - 0.4)
		var spike := Props.make("symbolfloor", "spike")
		spike.position = Vector3(sx, -8.5, sz)
		scene.add_child(spike)
	pit_light = Env.point_light(0xff3a18, 40, 16, 1.4)
	pit_light.position = Vector3(0, -5, 0)
	scene.add_child(pit_light)
	# Front railing (the invisible boundary needs an excuse).
	var rail_mat := Mats.mat(0xc9a227, Tex.hazard(Vector2(6, 1)))
	Env.block(scene, 0, 0.95, GD / 2 + 0.12, GW, 0.08, 0.08, rail_mat)
	var post_mat := Mats.mat(0x3a3a36, Tex.metal())
	var x := -GW / 2
	while x <= GW / 2 + 0.01:
		Env.block(scene, x, 0.48, GD / 2 + 0.12, 0.08, 0.95, 0.08, post_mat)
		x += TS * 2
	# Ledge trims along the walls at floor level.
	Env.block(scene, 0, -0.1, -GD / 2 - 0.05, GW, 0.2, 0.1, Mats.mat(0xc9a227, Tex.hazard(Vector2(8, 1))))
	Env.stencil(scene, "READ THE FLOOR", 0, 4.0, -GD / 2 + 0.01, {"w": 7.0, "h": 1.8, "opacity": 0.45})
	Env.pipe(scene, [-GW / 2 + 0.2, 5.2, -GD / 2 + 0.25], [GW / 2 - 0.2, 5.2, -GD / 2 + 0.25], 0.16)
	Env.pipe(scene, [-GW / 2 + 0.25, 5.2, -GD / 2 + 0.2], [-GW / 2 + 0.25, -9, -GD / 2 + 0.2], 0.12)


## Lambert top with the painted plate + an emission map of the symbol (pulses).
static func _make_top(sym: String, color: String) -> StandardMaterial3D:
	var col := Color(color)
	var key := "%s_%s" % [sym, color.substr(1)]
	var map: Texture2D = Tex.image("symfloor_map_" + key, 128, func(img: Image, s: int): _paint_plate(img, s, sym, col, false)).tex
	var em: Texture2D = Tex.image("symfloor_em_" + key, 128, func(img: Image, s: int): _paint_plate(img, s, sym, col, true)).tex
	var m := Mats.mat(0xffffff, map, {"emissive": 0xffffff, "emissive_intensity": 1.0})
	m.emission_texture = em
	# THREE multiplies emissive x emissiveMap; Godot's default operator adds them.
	m.emission_operator = BaseMaterial3D.EMISSION_OP_MULTIPLY
	return m


## Create the plate grid with four shared symbol materials (+ red "doomed" variants).
func _build_tiles() -> void:
	sym_mats = {}
	doom_mats = {}
	for s in SYMBOLS:
		sym_mats[s] = _make_top(s, "#39ff5a")
		doom_mats[s] = _make_top(s, "#ff3a26")
	grid = []
	for r in ROWS:
		for c in COLS:
			var x := (c - (COLS - 1) / 2.0) * TS
			var z := (r - (ROWS - 1) / 2.0) * TS
			var group := Node3D.new()
			group.rotation_order = EULER_ORDER_XYZ
			var sym: String = Rng.pick(SYMBOLS)
			var plate := Props.make("symbolfloor", "plate")
			group.add_child(plate)
			group.position = Vector3(x, 0, z)
			scene.add_child(group)
			var mi := _mesh_of(plate)
			if _top_idx < 0 and mi:
				for i in mi.mesh.get_surface_count():
					var src := mi.mesh.surface_get_material(i)
					if src and src.resource_name == TOP_MAT:
						_top_idx = i
			var t := {"i": r * COLS + c, "c": c, "r": r, "x": x, "z": z, "sym": sym, "group": group, "plate": mi, "state": "up", "t": 0.0, "vy": 0.0, "spin": Vector3.ZERO}
			_set_top(t, sym_mats[sym])
			grid.append(t)


static func _mesh_of(n: Node) -> MeshInstance3D:
	if n is MeshInstance3D:
		return n
	for c in n.get_children():
		var m := _mesh_of(c)
		if m:
			return m
	return null


func _set_top(t: Dictionary, m: Material) -> void:
	var mi: MeshInstance3D = t.plate
	if mi and _top_idx >= 0:
		mi.set_surface_override_material(_top_idx, m)


# ------------------------------------------------------------------ grid

## Plate under world point (x, z), or null outside the grid.
func tile_at(x: float, z: float) -> Variant:
	var c := int(floor((x + GW / 2) / TS))
	var r := int(floor((z + GD / 2) / TS))
	if c < 0 or c >= COLS or r < 0 or r >= ROWS:
		return null
	return grid[r * COLS + c]


## True while a plate can still be stood on (including while it rattles).
func _present(t) -> bool:
	return t != null and (t.state == "up" or t.state == "shudder")


func solid_tiles() -> Array:
	return grid.filter(func(t): return t.state == "up")


func _set_sym(t: Dictionary, sym: String) -> void:
	t.sym = sym
	_set_top(t, sym_mats[sym])


## Begin dropping a plate: it rattles red for SHUDDER seconds, then falls.
func _doom(t: Dictionary) -> void:
	if t.state != "up":
		return
	t.state = "shudder"
	t.t = SHUDDER
	_set_top(t, doom_mats[t.sym])


## Reassign symbols to all solid plates (guaranteeing at least two kinds).
func _reshuffle() -> void:
	var tiles := solid_tiles()
	if tiles.is_empty():
		return
	for t in tiles:
		_set_sym(t, Rng.pick(SYMBOLS))
	if tiles.size() >= 2:
		var kinds := {}
		for t in tiles:
			kinds[t.sym] = true
		if kinds.size() < 2:
			var sh := Rng.shuffle(SYMBOLS)
			var a: String = sh[0]
			var b: String = sh[1]
			for i in tiles.size():
				_set_sym(tiles[i], a if i % 2 else b)
	Sfx.play("select", {"vol": 0.6})
	hud.banner("SYMBOLS REASSIGNED", 900)


static func _counts(tiles: Array) -> Dictionary:
	var m := {}
	for t in tiles:
		m[t.sym] = int(m.get(t.sym, 0)) + 1
	return m


static func _options(cnt: Dictionary, n: int) -> Array:
	return SYMBOLS.filter(func(s): return cnt.has(s) and cnt[s] < n)


## Choose the next doomed symbol: one that exists but never wipes the whole floor.
func _pick_doomed() -> String:
	var tiles := solid_tiles()
	var cnt := _counts(tiles)
	var options := _options(cnt, tiles.size())
	if options.is_empty() and tiles.size() >= 2:
		_reshuffle()
		tiles = solid_tiles()
		cnt = _counts(tiles)
		options = _options(cnt, tiles.size())
	if options.is_empty():
		var missing := SYMBOLS.filter(func(s): return not cnt.has(s))
		if missing.is_empty():
			Rng.random()   # JS pick([]) still draws a number
			return Rng.pick(SYMBOLS)
		return Rng.pick(missing)
	return Rng.pick(options)


# ------------------------------------------------------------- lifecycle

func start() -> void:
	_enter("calm", 1.4)


func _enter(p: String, length: float) -> void:
	phase = p
	phase_t = length
	phase_len = length


## 0 → 1 difficulty ramp over the first 60 seconds.
func _ramp() -> float:
	return clampf(time / 60.0, 0.0, 1.0)


func preview(dt: float) -> void:
	_animate_tiles(dt)
	_draw_screens()
	for s in seats:
		s.subject.animate(dt, 0)


func update(dt: float) -> void:
	var playing := state == "play"
	_animate_tiles(dt)
	arena.step(dt, playing)
	if playing:
		_run_cycle(dt)
	_draw_screens()

	# Falling: anyone whose centre is over a missing plate drops (also during 'over').
	for seat in alive_seats():
		var a: ArenaActor = seat.actor
		if not a.falling and not _present(tile_at(a.pos.x, a.pos.z)):
			a.falling = true
			a.vy = 1.5
			seat.subject.pose = "armsUp"
			Sfx.play("whoosh", {"vol": 1.2})
			Sfx.play("wrong", {"vol": 0.4})
		if a.falling and a.y < -3:
			kill(seat, "fall", {"dir": a.vel + a.knock})

	if not playing:
		return
	# Commendation: still standing when the floor first shrinks to ten plates.
	if not _ten_awarded and solid_tiles().size() <= 10:
		_ten_awarded = true
		for seat in alive_seats():
			if not seat.actor.falling:
				award(seat, "tenTiles")
	for seat in seats:
		hud.set_stat(seat, ("FALLING" if seat.actor.falling else "STANDING") if seat.alive else "FELL")
	hud.set_timer(phase_t if phase == "announce" else -1.0)
	if time > HARD_CAP:
		end()
		return
	check_last_standing()


## The announce → horn → drop → (reshuffle) cycle, and the late collapse.
func _run_cycle(dt: float) -> void:
	if time > COLLAPSE_AT and phase != "collapse":
		_enter("collapse", INF)
		doomed = null
		Sfx.play("sting")
		hud.banner("STRUCTURAL FAILURE", 1800, "danger")
	phase_t -= dt
	match phase:
		"calm":
			if phase_t <= 0:
				doomed = _pick_doomed()
				_enter("announce", lerpf(4.0, 1.8, _ramp()))
				_last_tick = ceili(phase_t)
				Sfx.play("beep")
				hud.banner(SYMBOL_NAMES[doomed], int(round(phase_len * 1000)), "danger")
		"announce":
			var sec := ceili(phase_t)
			if sec != _last_tick and sec > 0:
				_last_tick = sec
				Sfx.play("tick", {"vol": 2.0})
			if phase_t <= 0:
				Sfx.play("horn")
				if engine:
					engine.shake(0.15)
				for t in grid:
					if t.state == "up" and t.sym == doomed:
						_doom(t)
				_enter("drop", 1.0)
		"drop":
			if phase_t <= 0:
				cycle += 1
				doomed = null
				if cycle % 2 == 0:
					_reshuffle()
				_enter("calm", lerpf(1.6, 0.7, _ramp()))
		"collapse":
			collapse_t -= dt
			if collapse_t <= 0:
				collapse_t = 0.55
				var solid := solid_tiles()
				if not solid.is_empty():
					_doom(Rng.pick(solid))
					Sfx.play("clank", {"vol": 0.5})


## Rattle doomed plates, then tip them into the shaft.
func _animate_tiles(dt: float) -> void:
	for t in grid:
		var g: Node3D = t.group
		if t.state == "shudder":
			t.t -= dt
			var jx := Rng.rand(-0.04, 0.04)
			var jy := Rng.rand(-0.05, 0.02)
			var jz := Rng.rand(-0.04, 0.04)
			g.position = Vector3(t.x + jx, jy, t.z + jz)
			if t.t <= 0:
				t.state = "falling"
				t.t = 3.0
				t.vy = 0.0
				var sx := Rng.rand(-2.5, 2.5)
				var sy := Rng.rand(-0.6, 0.6)
				var sz := Rng.rand(-2.5, 2.5)
				t.spin = Vector3(sx, sy, sz)
				g.position = Vector3(t.x, 0, t.z)
				Sfx.play("clank", {"vol": 0.35})
				fx.sparks(Vector3(t.x, 0.05, t.z), {"count": 5, "speed": 3.0})
		elif t.state == "falling":
			t.t -= dt
			t.vy -= 18 * dt
			g.position.y += t.vy * dt
			g.rotation += t.spin * dt
			if t.t <= 0 or g.position.y < -14:
				t.state = "gone"
				g.visible = false
	# Slow sinister pulse on every symbol.
	var pulse := 0.75 + sin(clock * 1000 * 0.004) * 0.25
	for s in SYMBOLS:
		sym_mats[s].emission_energy_multiplier = pulse


## Centred monitor text at (x, y) (textBaseline 'middle').
static func _text(ci: CanvasItem, text: String, x: float, y: float, size: int, color: String) -> void:
	var font := UI.font("vt")
	var base := y + (font.get_ascent(size) - font.get_descent(size)) / 2.0
	ci.draw_string(font, Vector2(x - 64, base), text, HORIZONTAL_ALIGNMENT_CENTER, 128, size, U.col(color))


## Repaint the monitors when their content changes.
func _draw_screens() -> void:
	var blink := int(floor(clock * 1000 / 250)) % 2 == 0
	var key := ""
	var paint: Callable
	if phase == "announce" or phase == "drop":
		var sec := maxi(1, ceili(phase_t)) if phase == "announce" else 0
		var red := phase == "drop"
		var sym := str(doomed)
		key = "a%s%d%s" % [sym, sec, red and blink]
		paint = func(ci: CanvasItem, _w: float, _h: float):
			if red and blink:
				return
			var col := "#ff3a26" if red else "#39ff5a"
			Env.draw_symbol(ci, sym, 40, 50, 25, col, 8)
			_text(ci, "!" if red else str(sec), 98, 52, 46, col)
			_text(ci, "DROPPING" if red else "DROPS IN", 64, 9, 11, col)
	elif phase == "collapse":
		key = "c%s" % blink
		paint = func(ci: CanvasItem, _w: float, _h: float):
			var col := "#ff3a26" if blink else "#701a12"
			_text(ci, "COLLAPSE", 64, 40, 18, col)
			_text(ci, "NO SAFE FLOOR", 64, 62, 12, col)
	else:
		key = "w%s" % blink
		paint = func(ci: CanvasItem, _w: float, _h: float):
			_text(ci, "STAND BY" if blink else "", 64, 28, 16, "#39ff5a")
			for i in SYMBOLS.size():
				Env.draw_symbol(ci, SYMBOLS[i], 22 + i * 28, 64, 9, "#1f8f34", 3)
	if key == _screen_key:
		return
	_screen_key = key
	for m in monitors:
		m.screen.draw(paint)


# ------------------------------------------------------------- placement

## Survivors first; the dead grouped by the instant they died (latest first).
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

## Breadth-first distances over solid plates from a start cell (8-way, no corner
## cutting). Returns {dist: {tile index: d}, prev: {tile index: tile}}.
func _bfs(start) -> Dictionary:
	var dist := {}
	var prev := {}
	if start == null:
		return {"dist": dist, "prev": prev}
	dist[start.i] = 0.0
	var q := [start]
	var head := 0
	while head < q.size():
		var t: Dictionary = q[head]
		head += 1
		for dr in [-1, 0, 1]:
			for dc in [-1, 0, 1]:
				if dr == 0 and dc == 0:
					continue
				var n = _cell(t.c + dc, t.r + dr)
				if n == null or n.state != "up" or dist.has(n.i):
					continue
				if dr != 0 and dc != 0 and (not _solid(t.c + dc, t.r) or not _solid(t.c, t.r + dr)):
					continue
				dist[n.i] = dist[t.i] + (1.4 if dr != 0 and dc != 0 else 1.0)
				prev[n.i] = t
				q.append(n)
	return {"dist": dist, "prev": prev}


func _cell(c: int, r: int) -> Variant:
	return null if c < 0 or c >= COLS or r < 0 or r >= ROWS else grid[r * COLS + c]


func _solid(c: int, r: int) -> bool:
	var t = _cell(c, r)
	return t != null and t.state == "up"


## How exposed a plate is: missing neighbours and the grid edge make it riskier.
func _exposure(t: Dictionary) -> float:
	var e := 0.0
	for d in [[1, 0], [-1, 0], [0, 1], [0, -1]]:
		var n = _cell(t.c + d[0], t.r + d[1])
		if n == null:
			e += 0.35
		elif n.state != "up":
			e += 1.0
	return e


func bot_think(seat: Dictionary, dt: float) -> void:
	var a: ArenaActor = seat.actor
	var brain: Dictionary = seat.brain
	var m: Dictionary = brain.memory
	a.ctrl.set_buttons(false, false)
	if a.falling:
		a.ctrl.set_move(0, 0)
		return

	# What does this bot "know"? It notices a new announcement after its reaction
	# time; clumsy bots occasionally misread the screen for a while.
	var elapsed := phase_len - phase_t
	if phase == "announce" and m.get("seen_for", -1) != cycle:
		m["seen_for"] = cycle
		m["delay"] = brain.reaction + (Rng.rand(0.6, 1.6) if Rng.random() < brain.error * 0.8 else 0.0)
	var known = null
	if phase == "announce" and elapsed > float(m.get("delay", 0.0)):
		known = doomed
	elif phase == "drop":
		known = doomed

	m["retarget"] = float(m.get("retarget", 0.0)) - dt
	var here = tile_at(a.pos.x, a.pos.z)
	var tgt = m.get("target")
	var target_bad: bool = tgt == null or tgt.state != "up" or (known != null and tgt.sym == known)
	if m.retarget <= 0 or target_bad or m.get("known") != known:
		m["known"] = known
		m["retarget"] = Rng.rand(0.6, 1.2)
		var res := _bfs(here if here != null and here.state == "up" else null)
		var dist: Dictionary = res.dist
		var prev: Dictionary = res.prev
		var best = null
		var bs := INF
		var candidates := []
		if not dist.is_empty():
			for i in dist:
				candidates.append(grid[i])
		else:
			candidates = solid_tiles()
		for t in candidates:
			if known != null and t.sym == known:
				continue
			var base: float = dist[t.i] if dist.has(t.i) else U.hypot(t.x - a.pos.x, t.z - a.pos.z) / TS
			var s: float = base * (1.0 if known != null else 0.35)
			s += _exposure(t) * 0.9
			for o in arena.actors:
				if o != a and o.alive and U.hypot(o.pos.x - t.x, o.pos.z - t.z) < 0.9:
					s += 1.1
			if phase == "collapse":
				s += Rng.random() * 0.5
			if s < bs:
				bs = s
				best = t
		m["target"] = best if best != null else here
		# Path of plates to walk through (start → target).
		var path := []
		var t = m.target
		while t != null and not is_same(t, here) and prev.has(t.i):
			path.push_front(t)
			t = prev[t.i]
		m["path"] = path

	# Walk the path waypoint by waypoint, then settle in the centre of the target.
	var p: Array = m.get("path", [])
	while not p.is_empty() and ((p[0].state != "up" and not is_same(p[0], m.target)) or U.hypot(p[0].x - a.pos.x, p[0].z - a.pos.z) < 0.45):
		p.pop_front()
	var wp = p[0] if not p.is_empty() else m.target
	if wp != null:
		AI.steer_to(a, wp.x, wp.z, {"arrive": 0.12, "slow": 0.7})
	else:
		a.ctrl.set_move(0, 0)

	# Opportunistic shove: rival standing on a plate about to drop, me on a safe one.
	if known != null and here != null and here.sym != known and a.shove_cd <= 0:
		for o in arena.actors:
			if o == a or not o.alive or o.falling:
				continue
			var d := U.hypot(o.pos.x - a.pos.x, o.pos.z - a.pos.z)
			var ot = tile_at(o.pos.x, o.pos.z)
			if d < 1.35 and ot != null and ot.sym == known and Rng.random() < brain.difficulty * dt * 5:
				var dx: float = o.pos.x - a.pos.x
				var dz: float = o.pos.z - a.pos.z
				a.ctrl.set_move(dx / d * 0.3, dz / d * 0.3)
				a.facing = atan2(dx, dz)
				a.ctrl.set_buttons(false, true)
				break


func dispose() -> void:
	for seat in seats:
		seat.actor = null   # break the seat <-> actor reference cycle
		seat.brain.memory.clear()
	super.dispose()

extends Minigame
## CONDEMNED FLOOR — a 12×8 grid of rotten old floor tiles (1.2 m each) laid
## over joists above a very deep shaft.
##
## Rules
##  - The tile under your feet starts cracking the moment you touch it
##    (it rattles, sinks and darkens) and drops into the shaft 1 s after
##    first contact. Fallen tiles leave holes for good.
##  - Standing over a hole = you fall ('fall' death).
##  - A = hop: ~0.45 s airborne, 1.1 s cooldown. While airborne you touch no
##    tiles (nothing cracks, holes don't matter) — enough to clear a hole
##    one tile wide. Land on a hole and you fall anyway.
##  - B = shove (standard arena shove). Shove rivals into holes.
##  - Every 15 s a few random tiles turn red and drop 1 s later. From 60 s on
##    the floor fails every 4 s.
##  - Last subject standing wins. Hard cap 75 s: survivors share first place.
##  - Grace: tiles touched during the first second after GO hold for 1.4 s.
## Floor tile and barricade models: blender/props/crumble.py.

const META := {
	"id": "crumble",
	"title": "CONDEMNED FLOOR",
	"tagline": "The floor is condemned. So are you.",
	"category": "Survival",
	"controls": [{"input": "move", "label": "Move"}, {"input": "a", "label": "Hop"}, {"input": "b", "label": "Shove"}],
	"objective": "Be the last subject standing.",
	"rules": [
		"Every tile you stand on cracks and drops into the shaft one second later.",
		"Press {A} to hop. In the air you touch nothing and can clear a one-tile hole.",
		"Every 15 seconds the floor fails on its own. Red tiles drop after one second.",
		"Shove rivals toward the holes. Gravity handles the paperwork.",
	],
}

const COLS := 12
const ROWS := 8
const TS := 1.2                       # tile pitch
const GAP := 0.06                     # visual seam between tiles
const TH := 0.22                      # tile thickness
const GW := COLS * TS                 # grid extents (14.4 × 9.6)
const GD := ROWS * TS
const CRACK_TIME := 1.0               # contact → drop (0.7 burnt the whole floor in ~12 s with 4 players)
const OPENING_FUSE := 1.4             # fuse for tiles touched in the first second
const WARN_TIME := 1.0                # random failures: red warning time
const HOP_TIME := 0.45
const HOP_CD := 1.1
const HOP_H := 0.6
const QUAKE_EVERY := 15.0             # random failures early on
const LATE_AT := 60.0                 # ...and the final collapse
const LATE_EVERY := 4.0
const CAP := 75.0                     # hard round limit
const FALL_KILL_Y := -3.0
const SPAWN_CELLS := [[2, 2], [9, 5], [9, 2], [2, 5]] # 2 players: opposite corners
const NB8 := [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
const NB4 := [[1, 0], [-1, 0], [0, 1], [0, -1]]
const BOT_SLIP := 0.02                # per tile × brain.error: misjudge the fuse (may fall)
const BOT_HOP_ERR := 0.15             # per tile × brain.error: hop too early (may land short)
const CROWD_R := 1.8                  # bots stop loitering when a rival is this close
const BOT_SHOVE := 0.9                # shoves per second × difficulty when a rival has a hole behind them
const TOP_MAT := "m_none_8d8774"      # the tile model's top surface (replaced by the painted faces)


## One floor tile of the grid.
class FloorTile:
	var i := 0
	var c := 0
	var r := 0
	var x := 0.0
	var z := 0.0
	var base_y := 0.0
	var group: Node3D
	var plate: MeshInstance3D
	var variant := 0
	var state := "solid"   # solid | falling | gone
	var t := INF           # fuse left (INF = untouched)
	var dur := 1.0
	var warned := false
	var stage := 0
	var vy := 0.0
	var fall_t := 0.0
	var spin_x := 0.0
	var spin_z := 0.0


var arena: Arena
var grid := []                # FloorTile, row-major
var fresh_mats := []          # top-face materials
var crack_mats := []
var warn_top: StandardMaterial3D
var top_idx := 0
var flicker := {}
var next_quake := QUAKE_EVERY
var quake_n := 0
var _crack_sfx := 0.0
var _drop_sfx := 0.0
var _prompt_on := false


## Grimy old floor tile face, optionally with cracks. (Cosmetic: randf is fine here.)
## Painted pixel by pixel into an Image (the JS canvas calls rasterised by
## the _px_* helpers below): the per-pixel noise needs no SubViewport and
## 4096 draw_rect calls.
static func _tile_texture(key: String, base: String, cracks: int = 0) -> Dictionary:
	return Tex.image("crumble-" + key, 64, func(img: Image, s: int):
		var bc := Color(base)
		for y in s:
			for x in s:
				var n := (randf() - 0.5) * 28.0 / 255.0
				img.set_pixel(x, y, Color(clampf(bc.r + n, 0, 1), clampf(bc.g + n, 0, 1), clampf(bc.b + n, 0, 1)))
		for i in 5:
			_px_circle(img, randf() * 64, randf() * 64, 4 + randf() * 12, Color8(40, 28, 12), 0.08 + randf() * 0.14)
		_px_rect_outline(img, Rect2(1.5, 1.5, 61, 61), 3.0, Color.BLACK, 0.55)
		_px_rect_outline(img, Rect2(5.5, 5.5, 53, 53), 1.0, Color.WHITE, 0.07)
		# chipped corner
		_px_triangle(img, Vector2(64, 64), Vector2(60 - randf() * 8, 64), Vector2(64, 60 - randf() * 8), Color8(20, 16, 12), 0.7)
		for k in cracks:
			var lw := 1.0 + randf() * 1.5
			var px := 32 + (randf() - 0.5) * 14
			var py := 32 + (randf() - 0.5) * 14
			var ang := randf() * TAU
			var pts := PackedVector2Array([Vector2(px, py)])
			for st in 6:
				ang += (randf() - 0.5) * 1.1
				px += cos(ang) * 6
				py += sin(ang) * 6
				pts.append(Vector2(px, py))
			_px_polyline(img, pts, lw, Color8(12, 8, 5), 0.9))


## Alpha-blend colour c (opacity a) into one pixel.
static func _px_blend(img: Image, x: int, y: int, c: Color, a: float) -> void:
	if x < 0 or y < 0 or x >= img.get_width() or y >= img.get_height():
		return
	var o := img.get_pixel(x, y)
	img.set_pixel(x, y, Color(lerpf(o.r, c.r, a), lerpf(o.g, c.g, a), lerpf(o.b, c.b, a), 1.0))


## Filled circle (ctx.arc + fill).
static func _px_circle(img: Image, cx: float, cy: float, r: float, c: Color, a: float) -> void:
	for y in range(int(floor(cy - r)), int(ceil(cy + r)) + 1):
		for x in range(int(floor(cx - r)), int(ceil(cx + r)) + 1):
			if (x + 0.5 - cx) * (x + 0.5 - cx) + (y + 0.5 - cy) * (y + 0.5 - cy) <= r * r:
				_px_blend(img, x, y, c, a)


## Rectangle outline of line width lw centred on the rect edges (ctx.strokeRect).
static func _px_rect_outline(img: Image, rc: Rect2, lw: float, c: Color, a: float) -> void:
	var hw := lw / 2
	for y in img.get_height():
		for x in img.get_width():
			var px := x + 0.5
			var py := y + 0.5
			var outer := px >= rc.position.x - hw and px <= rc.end.x + hw and py >= rc.position.y - hw and py <= rc.end.y + hw
			var inner := px > rc.position.x + hw and px < rc.end.x - hw and py > rc.position.y + hw and py < rc.end.y - hw
			if outer and not inner:
				_px_blend(img, x, y, c, a)


## Filled triangle.
static func _px_triangle(img: Image, p0: Vector2, p1: Vector2, p2: Vector2, c: Color, a: float) -> void:
	var lo := Vector2(minf(p0.x, minf(p1.x, p2.x)), minf(p0.y, minf(p1.y, p2.y)))
	var hi := Vector2(maxf(p0.x, maxf(p1.x, p2.x)), maxf(p0.y, maxf(p1.y, p2.y)))
	for y in range(int(floor(lo.y)), int(ceil(hi.y)) + 1):
		for x in range(int(floor(lo.x)), int(ceil(hi.x)) + 1):
			var p := Vector2(x + 0.5, y + 0.5)
			var d0 := (p1 - p0).cross(p - p0)
			var d1 := (p2 - p1).cross(p - p1)
			var d2 := (p0 - p2).cross(p - p2)
			if (d0 >= 0 and d1 >= 0 and d2 >= 0) or (d0 <= 0 and d1 <= 0 and d2 <= 0):
				_px_blend(img, x, y, c, a)


## Polyline of width lw with round caps / joins (each pixel blended once).
static func _px_polyline(img: Image, pts: PackedVector2Array, lw: float, c: Color, a: float) -> void:
	var hw := maxf(lw / 2, 0.75)
	var hit := {}
	for i in pts.size() - 1:
		var p0 := pts[i]
		var p1 := pts[i + 1]
		for y in range(int(floor(minf(p0.y, p1.y) - hw)), int(ceil(maxf(p0.y, p1.y) + hw)) + 1):
			for x in range(int(floor(minf(p0.x, p1.x) - hw)), int(ceil(maxf(p0.x, p1.x) + hw)) + 1):
				var p := Vector2(x + 0.5, y + 0.5)
				var q := Geometry2D.get_closest_point_to_segment(p, p0, p1)
				if p.distance_to(q) <= hw:
					hit[Vector2i(x, y)] = true
	for k in hit:
		_px_blend(img, k.x, k.y, c, a)


func build() -> void:
	make_scene({"fog_near": 16.0, "fog_far": 46.0, "floor_at": _floor_at})
	make_camera([0, 15, 11.2], [0, 0, 0.4], 50)

	_build_shaft(scene)
	_build_tiles(scene)

	Env.hanging_lamp(scene, -3.8, 7.6, 0.2, {"intensity": 95.0, "angle": 0.95})
	Env.hanging_lamp(scene, 3.8, 7.6, 0.2, {"intensity": 95.0, "angle": 0.95})
	flicker = Env.hanging_lamp(scene, 0, 6.6, -3.4, {"intensity": 30.0, "angle": 1.0, "shadow": false, "color": 0xffc890})

	# Arena + avatars
	arena = Arena.new({"bounds": {"min_x": -GW / 2, "max_x": GW / 2, "min_z": -GD / 2, "max_z": GD / 2}, "shove_force": 12.0})
	for i in seats.size():
		var seat: Dictionary = seats[i]
		var t := _cell(SPAWN_CELLS[i][0], SPAWN_CELLS[i][1])
		var facing := atan2(-t.x, -t.z)
		spawn_subject(seat, {"x": t.x, "z": t.z, "facing": facing})
		seat.actor = arena.add(ArenaActor.new({"player": seat.player, "ctrl": seat.ctrl, "subject": seat.subject, "x": t.x, "z": t.z}))
		seat.actor.seat = seat
		seat.actor.facing = facing
		seat.actor.data["hop_t"] = 0.0
		seat.actor.data["hop_cd"] = 0.0
	arena.on_shove = func(att: ArenaActor, vic: ArenaActor):
		vic.data["last_shover"] = att.seat
		vic.data["shoved_at"] = time

	next_quake = QUAKE_EVERY
	quake_n = 0
	_crack_sfx = 0.0
	_drop_sfx = 0.0
	_prompt_on = false


## Shaft walls, joists, pit glow, signage.
func _build_shaft(root: Node3D) -> void:
	var wall_mat := Mats.mat(0xffffff, Tex.wall(Vector2(3, 3)))
	var rust_mat := Mats.mat(0x9a9a9a, Tex.rust(Vector2(3, 4)))
	Env.block(root, 0, -2, -GD / 2 - 0.25, GW + 1.0, 14, 0.5, wall_mat)
	Env.block(root, -GW / 2 - 0.25, -2, 0.25, 0.5, 14, GD + 0.5, wall_mat)
	Env.block(root, GW / 2 + 0.25, -2, 0.25, 0.5, 14, GD + 0.5, wall_mat)
	Env.block(root, 0, -4.8, GD / 2 + 0.3, GW + 1.0, 9, 0.4, rust_mat) # front lip below floor level

	# Rotten joists under the tile seams (visible through the holes).
	var joist := Mats.mat(0x7d6c58, Tex.wood(Vector2(6, 1)))
	for r in ROWS + 1:
		Env.block(root, 0, -TH - 0.12, (r - ROWS / 2.0) * TS, GW, 0.2, 0.12, joist)
	for c in [0, 4, 8, 12]:
		Env.block(root, (c - COLS / 2.0) * TS, -TH - 0.34, 0, 0.14, 0.22, GD, joist)

	# The bottom is a long way down.
	var pit_floor := Env.mesh(Geo.plane(GW, GD), Mats.mat(0x221a14, Tex.rust(Vector2(4, 3))), 0, -14, 0, {"cast": false})
	pit_floor.rotation.x = -PI / 2
	root.add_child(pit_floor)
	var pit_light := Env.point_light(0xff5a1e, 26, 16, 1.4)
	pit_light.position = Vector3(0, -9, 0)
	root.add_child(pit_light)

	# Front railing + ledge trims.
	var rail_mat := Mats.mat(0xc9a227, Tex.hazard(Vector2(6, 1)))
	Env.block(root, 0, 0.95, GD / 2 + 0.12, GW, 0.08, 0.08, rail_mat)
	var post_mat := Mats.mat(0x3a3a36, Tex.metal())
	var x := -GW / 2
	while x <= GW / 2 + 0.01:
		Env.block(root, x, 0.48, GD / 2 + 0.12, 0.08, 0.95, 0.08, post_mat)
		x += TS * 2
	Env.block(root, 0, -0.1, -GD / 2 - 0.05, GW, 0.2, 0.1, Mats.mat(0xc9a227, Tex.hazard(Vector2(8, 1))))

	# Signage and barricade planks (Blender model).
	Env.stencil(root, "CONDEMNED", 0, 3.3, -GD / 2 + 0.01, {"w": 7.0, "h": 2.0, "opacity": 0.55, "color": "#c8b48a"})
	Env.stencil(root, "MAX LOAD 0 KG", -4.9, 1.3, -GD / 2 + 0.01, {"w": 3.4, "h": 1.0, "opacity": 0.4})
	Env.stencil(root, "KEEP MOVING", 4.9, 1.3, -GD / 2 + 0.01, {"w": 3.4, "h": 1.0, "opacity": 0.4})
	for bx in [-5.2, 5.2]:
		var bar := Props.make("crumble", "barricade")
		bar.position = Vector3(bx, 3.3, -GD / 2)
		root.add_child(bar)
	Env.pipe(root, [-GW / 2 + 0.2, 5.0, -GD / 2 + 0.25], [GW / 2 - 0.2, 5.0, -GD / 2 + 0.25], 0.16)
	Env.pipe(root, [GW / 2 - 0.25, 5.0, -GD / 2 + 0.2], [GW / 2 - 0.25, -12, -GD / 2 + 0.2], 0.12)


## Create the tile grid with a handful of shared top materials (fresh variants, crack stages, red warning).
func _build_tiles(root: Node3D) -> void:
	var fresh_tex := []
	var bases := ["#8d8774", "#7a8273", "#86735f"]
	for k in 3:
		fresh_tex.append(_tile_texture("fresh%d" % k, bases[k], 0))
	var crack_tex := []
	var counts := [2, 5, 9]
	for k in 3:
		crack_tex.append(_tile_texture("crack%d" % k, "#8d8774", counts[k]))
	fresh_mats = fresh_tex.map(func(t): return Mats.mat(0xffffff, t))
	crack_mats = [Mats.mat(0xd2c8b8, crack_tex[0]), Mats.mat(0x9a8e7e, crack_tex[1]), Mats.mat(0x62584c, crack_tex[2])]
	warn_top = Mats.mat(0xffa898, crack_tex[0], {"emissive": 0x6a0c06})

	grid = []
	for r in ROWS:
		for c in COLS:
			var x := (c - (COLS - 1) / 2.0) * TS
			var z := (r - (ROWS - 1) / 2.0) * TS
			var variant := mini(2, int(floor(Rng.random() * 3)))
			var group := Node3D.new()
			group.rotation_order = EULER_ORDER_XYZ
			var plate := _make_plate()
			plate.set_surface_override_material(top_idx, fresh_mats[variant])
			plate.rotation.y = floor(Rng.random() * 4) * (PI / 2)
			group.add_child(plate)
			var base_y := Rng.rand(-0.012, 0.008) # uneven old floor
			group.position = Vector3(x, base_y, z)
			root.add_child(group)
			var t := FloorTile.new()
			t.i = grid.size()
			t.c = c
			t.r = r
			t.x = x
			t.z = z
			t.base_y = base_y
			t.group = group
			t.plate = plate
			t.variant = variant
			grid.append(t)


## A tile model (top face at y = 0); finds the top surface index once.
func _make_plate() -> MeshInstance3D:
	var n := Props.make("crumble", "tile")
	var mi: MeshInstance3D = n if n is MeshInstance3D else n.find_children("*", "MeshInstance3D")[0]
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	if grid.is_empty():
		for i in mi.mesh.get_surface_count():
			var m := mi.mesh.surface_get_material(i)
			if m and m.resource_name == TOP_MAT:
				top_idx = i
	return mi


# ------------------------------------------------------------------ grid

## FX floor height: debris lands on standing tiles, falls forever through holes.
func _floor_at(x: float, z: float) -> float:
	return 0.0 if _standable(tile_at(x, z)) else -INF


## Tile under world point (x, z), or null outside the grid.
func tile_at(x: float, z: float) -> FloorTile:
	return _cell(int(floor((x + GW / 2) / TS)), int(floor((z + GD / 2) / TS)))


func _cell(c: int, r: int) -> FloorTile:
	if c < 0 or c >= COLS or r < 0 or r >= ROWS:
		return null
	return grid[r * COLS + c]


## Can this tile be stood on right now (including while it cracks)?
func _standable(t: FloorTile) -> bool:
	return t != null and t.state == "solid"


## Untouched, unwarned tile.
func _fresh(t: FloorTile) -> bool:
	return t != null and t.state == "solid" and t.t == INF


## Point (x, z) is over a hole or a tile about to go. Outside the grid counts as safe (walls).
func _hole_at(x: float, z: float) -> bool:
	var t := tile_at(x, z)
	return t != null and (t.state != "solid" or t.t < 0.35)


## Tile starts its fall.
func _drop(t: FloorTile) -> void:
	t.state = "falling"
	t.t = INF
	t.vy = 0.0
	t.fall_t = 0.0
	t.spin_x = sin(t.i * 12.9898) * 2.5
	t.spin_z = cos(t.i * 78.233) * 2.5
	t.group.position = Vector3(t.x, t.base_y, t.z)
	if _drop_sfx <= 0:
		_drop_sfx = 0.1
		Sfx.play("crunch", {"vol": 0.45})
		fx.smoke(Vector3(t.x, 0.05, t.z), {"color": 0x6a5f50, "size": 0.35, "rise": 0.4, "life": 0.9, "opacity": 0.45})


## A few random fresh tiles turn red and drop after WARN_TIME.
func _quake(count: int, late: bool) -> void:
	var pool := grid.filter(func(t): return _fresh(t))
	for t in Rng.shuffle(pool).slice(0, count):
		t.warned = true
		t.t = WARN_TIME
		t.dur = WARN_TIME
	Sfx.play("buzz")
	Sfx.play("grind", {"vol": 0.6})
	if engine:
		engine.shake(0.2)
	hud.banner("FINAL COLLAPSE" if late else "SUBSIDENCE WARNING", 1200, "danger")


# ------------------------------------------------------------- lifecycle

func start() -> void:
	hud.banner("MIND YOUR STEP", 1200)
	hud.prompt("{MOVE} move · {A} hop · {B} shove")
	_prompt_on = true


func preview(dt: float) -> void:
	_animate_tiles(dt)
	_flicker()
	for s in seats:
		s.subject.animate(dt, 0)


func update(dt: float) -> void:
	var playing := state == "play"
	_crack_sfx -= dt
	_drop_sfx -= dt

	_update_hops(dt, playing)
	arena.step(dt, playing)

	if playing:
		# Contact: grounded subjects crack the tile under their centre.
		for seat in alive_seats():
			var a: ArenaActor = seat.actor
			if a.falling or a.data.hop_t > 0:
				continue
			var t := tile_at(a.pos.x, a.pos.z)
			if not _standable(t):
				continue
			var fuse := OPENING_FUSE if time < 1 else CRACK_TIME
			if t.t == INF:
				t.t = fuse
				t.dur = fuse
				if _crack_sfx <= 0:
					_crack_sfx = 0.12
					Sfx.play("snap", {"vol": 0.18})
			elif t.t > fuse:
				t.t = fuse
		# Fuses
		for t in grid:
			if t.state != "solid" or t.t == INF:
				continue
			t.t -= dt
			if t.t <= 0:
				_drop(t)
	_check_falls()
	_animate_tiles(dt)
	_flicker()

	for seat in alive_seats():
		var a: ArenaActor = seat.actor
		if a.falling and a.y < FALL_KILL_Y:
			_credit(seat)
			kill(seat, "fall", {"dir": a.vel + a.knock})
	if not playing:
		return

	# Random floor failures.
	if time >= next_quake:
		var late := time >= LATE_AT - 0.001
		_quake(4 if late else 3 + quake_n, late)
		quake_n += 1
		next_quake += LATE_EVERY if late else QUAKE_EVERY

	for seat in seats:
		if not seat.alive:
			hud.set_stat(seat, "FELL")
			hud.set_status(seat, "")
			continue
		var a: ArenaActor = seat.actor
		hud.set_stat(seat, "FALLING" if a.falling else ("AIRBORNE" if a.data.hop_t > 0 else "STANDING"))
		hud.set_status(seat, "HOP READY" if not a.falling and a.data.hop_t <= 0 and a.data.hop_cd <= 0 else "")
	hud.set_timer(maxf(0.0, CAP - time))
	if _prompt_on and time > 5:
		_prompt_on = false
		hud.prompt("")

	if time >= CAP:
		hud.banner("TIME UP", 1500)
		end()
		return
	check_last_standing()


## Hop timers, arcs and take-offs (A).
func _update_hops(dt: float, playing: bool) -> void:
	for seat in seats:
		var a: ArenaActor = seat.actor
		var d: Dictionary = a.data
		if not a.alive:
			continue
		d.hop_cd = maxf(0.0, d.hop_cd - dt)
		if d.hop_t > 0:
			d.hop_t -= dt
			if d.hop_t <= 0:
				d.hop_t = 0.0
				a.y = 0.0
				seat.subject.pose = "idle"
				Sfx.play("step", {"vol": 2.0})
			else:
				var p: float = 1.0 - d.hop_t / HOP_TIME
				a.y = 4 * HOP_H * p * (1 - p)
		elif playing and not a.falling and a.stun <= 0 and d.hop_cd <= 0 and a.ctrl.a_pressed:
			d.hop_t = HOP_TIME
			d.hop_cd = HOP_CD
			seat.subject.pose = "armsUp"
			Sfx.play("whoosh", {"vol": 0.35})


## Grounded subjects over a hole start falling.
func _check_falls() -> void:
	for seat in alive_seats():
		var a: ArenaActor = seat.actor
		if a.falling or a.data.hop_t > 0:
			continue
		if not _standable(tile_at(a.pos.x, a.pos.z)):
			a.falling = true
			a.vy = 0.8
			seat.subject.pose = "armsUp"
			Sfx.play("whoosh", {"vol": 1.1})
			Sfx.play("wrong", {"vol": 0.35})


## Feed line when a recent shove sent someone down.
func _credit(seat: Dictionary) -> void:
	var d: Dictionary = seat.actor.data
	var by = d.get("last_shover")
	if by != null and not is_same(by, seat) and time - float(d.get("shoved_at", -99.0)) < 2.5:
		hud.feed("%s floored %s" % [by.player.name(), seat.player.name()], by.player.color)


## Rattle / darken cracking tiles, tumble falling ones (cosmetic, deterministic).
func _animate_tiles(dt: float) -> void:
	warn_top.emission_energy_multiplier = 0.6 + sin(clock * 14) * 0.4
	for t in grid:
		if t.state == "solid":
			if t.t == INF:
				continue
			var p := clampf(1.0 - t.t / t.dur, 0.0, 1.0)
			var stage := 4 if t.warned else (1 if p < 0.34 else (2 if p < 0.67 else 3))
			if stage != t.stage:
				t.stage = stage
				t.plate.set_surface_override_material(top_idx, warn_top if stage == 4 else crack_mats[stage - 1])
			var amp := 0.012 + p * 0.05
			var ph: float = clock * 55 + t.i * 1.37
			t.group.position = Vector3(t.x + sin(ph) * amp, t.base_y - p * 0.07 + sin(ph * 1.3) * amp * 0.5, t.z + cos(ph * 0.9) * amp)
			t.group.rotation = Vector3(sin(ph * 0.7) * p * 0.06, 0, cos(ph * 0.8) * p * 0.06)
		elif t.state == "falling":
			t.fall_t += dt
			t.vy -= 20 * dt
			t.group.position.y += t.vy * dt
			t.group.rotation.x += t.spin_x * dt
			t.group.rotation.z += t.spin_z * dt
			if t.group.position.y < -13 or t.fall_t > 3:
				t.state = "gone"
				t.group.visible = false


## The bare bulb at the back stutters now and then.
func _flicker() -> void:
	var k := sin(clock * 23) + sin(clock * 7.3)
	(flicker.light as Light3D).light_energy = (4.0 if k > 1.7 else 30.0) * Env.LIGHT_K


# ------------------------------------------------------------------- bots
#
# One step at a time. A bot stays on its current tile for as long as that is
# safe — it leaves once the remaining fuse drops to its reaction time + the
# time needed to get its centre off the tile + a small margin — then steps
# (or hops) to the neighbouring fresh tile with the most uncontested fresh
# floor behind it (Tron-style territory count), away from rivals.
# A new plan is made the moment the bot lands on a new (now cracking) tile.

func bot_think(seat: Dictionary, dt: float) -> void:
	var a: ArenaActor = seat.actor
	var brain: Dictionary = seat.brain
	var m: Dictionary = brain.memory
	var d: Dictionary = a.data
	if not m.has("going"):
		m.step = null
		m.think = 0.0
		m.here = null
		m.slip = 0.0
		m.hop_at = 0.3
		m.land = null
		m.commit = 0.0
		m.going = false
		m.a_prev = false
		m.b_prev = false
	var want_a := false
	var want_b := false
	m.think -= dt

	if a.falling:
		a.ctrl.set_move(0, 0)
		_bot_buttons(a, m, false, false)
		return
	if d.hop_t > 0:
		m.commit = 0.0
		if m.land != null:
			AI.steer_to(a, m.land.x, m.land.z, {"arrive": 0.05, "slow": 0.25})
		_bot_buttons(a, m, false, false)
		return
	var here := tile_at(a.pos.x, a.pos.z)
	if not _standable(here):
		a.ctrl.set_move(0, 0)
		_bot_buttons(a, m, false, false)
		return
	if m.land != null and m.commit > 0:
		# A hop was requested; it registers next tick. Keep running at the landing tile meanwhile.
		m.commit -= dt
		AI.steer_to(a, m.land.x, m.land.z, {"arrive": 0.0, "slow": 0.01})
		_bot_buttons(a, m, d.hop_cd <= 0, false)
		return
	m.land = null
	var left: float = CRACK_TIME if here.t == INF else here.t # time until this tile drops

	if m.here != here:
		# New tile (it starts cracking now): roll this tile's rare mistakes and replan.
		m.here = here
		m.going = false
		m.step = null
		m.slip = Rng.rand(0.15, 0.3) if Rng.random() < brain.error * BOT_SLIP else 0.0 # misjudges the fuse
		m.hop_at = 0.3 + Rng.rand(-0.08, 0.12)
		if Rng.random() < brain.error * BOT_HOP_ERR:
			m.hop_at -= Rng.rand(0.45, 0.7) # jumps too early
	var s = m.step
	var invalid: bool = s == null or s.from != here or not (_fresh(s.t) or (s.t.state == "solid" and s.t.t > left + 0.15))
	if not invalid and not s.hop and s.t.c != here.c and s.t.r != here.r \
			and not (_lasts(_cell(s.t.c, here.r)) and _lasts(_cell(here.c, s.t.r))):
		invalid = true
	# A rival close by can shove us into a hole: don't loiter, move on (re-planned around them).
	var crowded := false
	for o in arena.actors:
		if o != a and o.alive and not o.falling and U.hypot(o.pos.x - a.pos.x, o.pos.z - a.pos.z) < CROWD_R:
			crowded = true
	if invalid or ((m.think <= 0 or crowded) and not m.going):
		_plan_step(seat, here, d.hop_cd < left - 0.3)
		m.think = 0.3 + brain.reaction + Rng.rand(0, 0.2)
		s = m.step
	if s != null and s.hop and (d.hop_cd > maxf(0.0, left - 0.25) or (crowded and d.hop_cd > 0)):
		_plan_step(seat, here, false)
		s = m.step

	if s == null:
		AI.steer_to(a, here.x, here.z, {"arrive": 0.1, "slow": 0.5})
	else:
		var w: FloorTile = s.t
		var dx := w.x - here.x
		var dz := w.z - here.z
		var ln := U.hypot(dx, dz)
		if ln == 0.0:
			ln = 1.0
		var ux := dx / ln
		var uz := dz / ln
		var rel := (a.pos.x - here.x) * ux + (a.pos.z - here.z) * uz
		var travel: float = (maxf(0.0, m.hop_at - rel) if s.hop else _exit_dist(a, here, ux, uz)) / a.speed + 0.12
		var margin: float = brain.reaction + travel + 0.06 - m.slip
		var off := 0.1 if s.hop else 0.3
		if (left > margin and not m.going and not crowded) or (s.hop and d.hop_cd > 0):
			# Wait near the edge we will leave by (short exit = more time on each tile). A hop
			# still on cooldown also waits here (if it cannot be ready in time we re-plan a walk above).
			AI.steer_to(a, here.x + ux * off, here.z + uz * off, {"arrive": 0.05, "slow": 0.35})
		else:
			m.going = true # committed: no more periodic replans until the next tile
			if s.hop:
				AI.steer_to(a, w.x, w.z, {"arrive": 0.0, "slow": 0.01})
				if rel >= m.hop_at:
					want_a = true
					m.land = w
					m.commit = 0.1
			else:
				AI.steer_to(a, w.x, w.z, {"arrive": 0.0, "slow": 0.5})

	# Shove a rival who has a hole behind them — only with time to spare on our own tile.
	if not want_a and a.shove_cd <= 0 and a.stun <= 0 and left > 0.35:
		for o in arena.actors:
			if o == a or not o.alive or o.falling or o.data.get("hop_t", 0.0) > 0:
				continue
			var ox: float = o.pos.x - a.pos.x
			var oz: float = o.pos.z - a.pos.z
			var dd := U.hypot(ox, oz)
			if dd > 1.35 or dd < 0.05:
				continue
			var vx := ox / dd
			var vz := oz / dd
			if not _hole_at(o.pos.x + vx * 0.9, o.pos.z + vz * 0.9) and not _hole_at(o.pos.x + vx * 1.7, o.pos.z + vz * 1.7):
				continue
			if Rng.random() < brain.difficulty * BOT_SHOVE * dt:
				a.facing = atan2(ox, oz)
				a.ctrl.set_move(vx * 0.3, vz * 0.3)
				want_b = true
				break
	_bot_buttons(a, m, want_a, want_b)


## Buttons are edge-triggered: alternate so repeated intents become fresh presses.
func _bot_buttons(a: ArenaActor, m: Dictionary, want_a: bool, want_b: bool) -> void:
	a.ctrl.set_buttons(want_a and not m.a_prev, want_b and not m.b_prev)
	m.a_prev = want_a and not m.a_prev
	m.b_prev = want_b and not m.b_prev


## Pick the next step from `here`: a fresh neighbour (8-way, no corner cutting) or a 4-way hop two tiles out.
func _plan_step(seat: Dictionary, here: FloorTile, allow_hop: bool) -> void:
	var a: ArenaActor = seat.actor
	var brain: Dictionary = seat.brain
	var m: Dictionary = brain.memory
	m.step = null
	var rivals := arena.actors.filter(func(o): return o != a and o.alive and not o.falling)
	var r_starts := []
	for o in rivals:
		var rt := tile_at(o.pos.x, o.pos.z)
		if rt != null:
			r_starts.append(rt)
	var r_dist := _bfs(r_starts, 0.0, null)
	var cands := []
	for nb in NB8:
		var dc: int = nb[0]
		var dr: int = nb[1]
		var n := _cell(here.c + dc, here.r + dr)
		if not _fresh(n):
			continue
		if dc != 0 and dr != 0 and not (_lasts(_cell(here.c + dc, here.r)) and _lasts(_cell(here.c, here.r + dr))):
			continue
		cands.append({"t": n, "hop": false, "from": here})
	if allow_hop:
		for nb in NB4:
			var f := _cell(here.c + nb[0] * 2, here.r + nb[1] * 2)
			if _fresh(f):
				cands.append({"t": f, "hop": true, "from": here}) # hops leave the middle tile untouched
	var best = null
	var bs := -INF
	for cand in cands:
		var ct: FloorTile = cand.t
		# Territory: fresh tiles we would reach before any rival (diminishing returns).
		var md := _bfs([ct], 1.0, here)
		var terr := 0.0
		for i in md.size():
			if md[i] == INF:
				continue
			if md[i] < r_dist[i]:
				terr += 1.0
			elif md[i] == r_dist[i]:
				terr += 0.5
		var s: float = sqrt(terr) * 3 + _openness(ct) * 0.6 + (3.0 if cand.hop else 0.0)
		for o in rivals:
			var dd := U.hypot(o.pos.x - ct.x, o.pos.z - ct.z)
			if dd < 3:
				s -= (3 - dd) * 2.5
			var os = o.seat.brain.memory.get("step") if o.seat != null else null # another bot's intended step
			if os != null:
				if os.t == ct:
					s -= 6
				if cand.hop and os.hop:
					# Two hops crossing mid-air bump into each other: avoid.
					var mx := (here.x + ct.x) / 2
					var mz := (here.z + ct.z) / 2
					var ox: float = (os.from.x + os.t.x) / 2
					var oz: float = (os.from.z + os.t.z) / 2
					if U.hypot(mx - ox, mz - oz) < 1.3:
						s -= 6
		s += Rng.rand(-1, 1) * brain.error * 3
		if s > bs:
			bs = s
			best = cand
	if best != null:
		m.step = best
		return

	# Trapped: a standing neighbour that clearly outlasts this tile...
	var bt := here.t + 0.15
	var bn: FloorTile = null
	for nb in NB8:
		var dc: int = nb[0]
		var dr: int = nb[1]
		if dc != 0 and dr != 0 and not (_lasts(_cell(here.c + dc, here.r)) and _lasts(_cell(here.c, here.r + dr))):
			continue
		var n := _cell(here.c + dc, here.r + dr)
		if _standable(n) and n.t > bt:
			bt = n.t
			bn = n
	if bn != null:
		m.step = {"t": bn, "hop": false, "from": here}
		return
	# ...or a hop onto any standing tile two cells away.
	if allow_hop:
		for nb in NB4:
			var f := _cell(here.c + nb[0] * 2, here.r + nb[1] * 2)
			if _standable(f) and f.t > 0.7:
				m.step = {"t": f, "hop": true, "from": here}
				return


## 8-way BFS over fresh tiles from `starts` (distance d0); `blocked` is never entered.
func _bfs(starts: Array, d0: float, blocked: FloorTile) -> PackedFloat64Array:
	var dist := PackedFloat64Array()
	dist.resize(grid.size())
	dist.fill(INF)
	var q := []
	for t in starts:
		if d0 < dist[t.i]:
			dist[t.i] = d0
			q.append(t)
	var h := 0
	while h < q.size():
		var t: FloorTile = q[h]
		h += 1
		var nd := dist[t.i] + 1.0
		for nb in NB8:
			var nc: int = t.c + nb[0]
			var nr: int = t.r + nb[1]
			if nc < 0 or nc >= COLS or nr < 0 or nr >= ROWS:
				continue
			var n: FloorTile = grid[nr * COLS + nc]
			if n == blocked or n.state != "solid" or n.t != INF or dist[n.i] <= nd:
				continue
			dist[n.i] = nd
			q.append(n)
	return dist


## Fresh neighbours count up, holes and walls count down.
func _openness(t: FloorTile) -> float:
	var v := 0.0
	for nb in NB8:
		var n := _cell(t.c + nb[0], t.r + nb[1])
		if n == null:
			v -= 0.3
		elif n.state != "solid":
			v -= 1.0
		elif n.t == INF:
			v += 1.0
	return v


## Solid with enough fuse left to cut past its corner.
func _lasts(t: FloorTile) -> bool:
	return t != null and t.state == "solid" and t.t > 0.6


## Distance along (ux, uz) until the actor's centre leaves tile `here`.
func _exit_dist(a: ArenaActor, here: FloorTile, ux: float, uz: float) -> float:
	var best := INF
	if ux > 1e-6:
		best = minf(best, (here.x + TS / 2 - a.pos.x) / ux)
	if ux < -1e-6:
		best = minf(best, (here.x - TS / 2 - a.pos.x) / ux)
	if uz > 1e-6:
		best = minf(best, (here.z + TS / 2 - a.pos.z) / uz)
	if uz < -1e-6:
		best = minf(best, (here.z - TS / 2 - a.pos.z) / uz)
	return 0.6 if best == INF else maxf(0.0, best)


func dispose() -> void:
	for seat in seats:
		seat.actor = null   # break the seat <-> actor reference cycle
		if seat.brain.memory.has("here"):
			seat.brain.memory.clear()
	super.dispose()

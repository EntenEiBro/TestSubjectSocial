extends Minigame
## SIDEARM ASSEMBLY — a factory floor, a conveyor belt of loose pistol parts
## and one workbench per subject.
##
## Rules:
##  - The belt along the bottom of the screen carries four part types:
##    FRAME, SLIDE, BARREL and MAGAZINE.
##  - Walk to the belt and press A to pick a part up (one at a time), carry it
##    to YOUR bench and press A to install it. Duplicates of a part you have
##    already installed are rejected and dropped. Pressing A away from your
##    bench drops the part.
##  - B shoves; a shoved carrier drops whatever they hold.
##  - Four installed parts = an assembled pistol: six rounds, 0.6 s between
##    shots, every hit is lethal. Benches, crates and walls stop bullets.
##    An empty pistol can be reloaded by installing another magazine.
##  - The round ends when one subject remains or after 75 seconds. Survivors
##    rank by installed parts (seat.score), the dead by reverse death order.
##
## Models (blender/props/sidearm.py): part_frame / part_slide / part_barrel /
## part_magazine (gun space), pistol (all four), bench, conveyor.

const META := {
	"id": "sidearm",
	"title": "SIDEARM ASSEMBLY",
	"tagline": "Some assembly required. Some funerals included.",
	"category": "Assembly",
	"controls": [{"input": "move", "label": "Move"}, {"input": "a", "label": "Grab / Install / Fire"}, {"input": "b", "label": "Shove"}],
	"objective": "Build a pistol at your own bench, then be the last subject standing.",
	"rules": [
		"Grab parts off the belt and install them at YOUR bench. Duplicates are rejected.",
		"Frame + slide + barrel + magazine = a pistol. Six rounds. Every hit kills.",
		"Shove carriers to make them drop their part. Benches and crates stop bullets.",
		"Out of ammo? Install another magazine to reload.",
	],
}

const HALF_W := 9.5            # pen half-width
const MIN_Z := -5.4            # walkable back edge (benches stand against it)
const BELT_FRONT := 4.5        # walkable front edge (belt housing starts here)
const BELT_Z := 5.1            # belt centreline
const BELT_Y := 0.8            # belt surface height
const BELT_SPEED := 1.5        # units / second, toward +X
const BELT_LEN := HALF_W * 2 + 3
const BENCH_Z := -4.85         # bench centre
const BENCH_W := 2.1
const BENCH_D := 0.9
const BENCH_H := 0.95
const ROUND_TIME := 75.0
const FIRE_CD := 0.6
const MAG_SIZE := 6
const RANGE := 26.0
const SPAWN_EVERY := 0.9       # belt part spawn interval
const MAX_LOOSE := 12          # parts lying on the floor at once

const PART_TYPES := ["frame", "slide", "barrel", "magazine"]
const PART_INFO := {
	"frame": {"label": "FRAME", "color": 0x55663f},
	"slide": {"label": "SLIDE", "color": 0xb9bdbb},
	"barrel": {"label": "BARREL", "color": 0xc8873a},
	"magazine": {"label": "MAGAZINE", "color": 0x3b62a8},
}

var arena: Arena
var benches := []
var parts := []
var tracers := []
var bag := []
var spawn_t := 0.0
var belt_mat: StandardMaterial3D
var _prompt_shown := false

# ------------------------------------------------------------- part models

## Offsets that put a lying part's bottom centre at its origin (per type).
static var _lying_offset := {}


## A part laid flat for display on the belt, floor or bench: an outer node
## whose local origin is at the part's bottom centre (Blender model inside).
static func lying_part(type: String) -> Node3D:
	var outer := Node3D.new()
	var inner := Props.make("sidearm", "part_" + type)
	if type == "frame" or type == "magazine":
		inner.rotation.z = PI / 2
	outer.add_child(inner)
	if not _lying_offset.has(type):
		var acc := [null]
		_bounds(inner, Transform3D.IDENTITY, acc)
		var box: AABB = acc[0] if acc[0] != null else AABB()
		var c := box.get_center()
		_lying_offset[type] = Vector3(-c.x, -box.position.y, -c.z)
	inner.position = _lying_offset[type]
	outer.scale = Vector3.ONE * 1.25
	return outer


## Bounding box of all meshes under n (n's own transform included), in its parent's space.
static func _bounds(n: Node3D, xf: Transform3D, acc: Array) -> void:
	var t := xf * n.transform
	if n is MeshInstance3D and (n as MeshInstance3D).mesh != null:
		var bb: AABB = t * (n as MeshInstance3D).get_aabb()
		acc[0] = bb if acc[0] == null else (acc[0] as AABB).merge(bb)
	for c in n.get_children():
		if c is Node3D:
			_bounds(c, t, acc)


static func _reparent(n: Node3D, parent: Node3D) -> void:
	if n.get_parent():
		n.get_parent().remove_child(n)
	parent.add_child(n)


func build() -> void:
	make_scene({"fog_near": 22.0, "fog_far": 55.0})
	make_camera([0, 15, 10.5], [0, 0, 0.4], 50)

	Env.floor_plane(scene, 44, 34, {"tex": "concrete", "tile": 3.0})
	Env.floor_plane(scene, HALF_W * 2, BELT_FRONT - MIN_Z, {"tex": "plate", "tile": 1.5, "y": 0.005, "z": (BELT_FRONT + MIN_Z) / 2})

	# Back wall, side walls and set dressing
	var wall_mat := Mats.mat(0xffffff, Tex.wall(Vector2(6, 1.5)))
	Env.block(scene, 0, 2.2, MIN_Z - 0.3, HALF_W * 2 + 1.2, 4.4, 0.3, wall_mat)
	var side_mat := Mats.mat(0xffffff, Tex.rust(Vector2(3, 1)))
	Env.block(scene, -HALF_W - 0.3, 0.6, (BELT_FRONT + MIN_Z) / 2, 0.6, 1.2, BELT_FRONT - MIN_Z + 1.4, side_mat)
	Env.block(scene, HALF_W + 0.3, 0.6, (BELT_FRONT + MIN_Z) / 2, 0.6, 1.2, BELT_FRONT - MIN_Z + 1.4, side_mat)
	Env.stencil(scene, "ASSEMBLE", 0, 3.4, MIN_Z - 0.14, {"w": 8.0, "h": 1.6, "opacity": 0.55})
	Env.pipe(scene, [-HALF_W, 4.0, MIN_Z - 0.05], [HALF_W, 4.0, MIN_Z - 0.05], 0.14)
	Env.pipe(scene, [-HALF_W, 3.6, MIN_Z - 0.05], [HALF_W, 3.6, MIN_Z - 0.05], 0.08, 0x3b5a3b)
	Env.hazard_strip(scene, 0, BELT_FRONT - 0.25, HALF_W * 2, 0.4, 0.012)
	Env.crate(scene, -HALF_W - 1.6, 0, -2, 1.2, 0.3)
	Env.crate(scene, -HALF_W - 1.5, 1.2, -2.1, 0.9, 0.9)
	Env.crate(scene, HALF_W + 1.6, 0, 1, 1.2, -0.2)

	arena = Arena.new({"bounds": {"min_x": -HALF_W, "max_x": HALF_W, "min_z": MIN_Z, "max_z": BELT_FRONT}, "shove_force": 12.0})

	_build_belt()
	_build_cover()

	Env.hanging_lamp(scene, -5.5, 7.5, -0.5, {"intensity": 85.0, "angle": 0.95})
	Env.hanging_lamp(scene, 5.5, 7.5, -0.5, {"intensity": 85.0, "angle": 0.95})
	Env.hanging_lamp(scene, 0, 7.5, -1.5, {"intensity": 55.0, "angle": 0.8, "shadow": false})
	Env.hanging_lamp(scene, 0, 7, 4.2, {"intensity": 45.0, "angle": 0.9, "shadow": false})

	# Benches + avatars
	var n := seats.size()
	var spacing := 4.2 if n >= 4 else (5.2 if n == 3 else 6.0)
	for i in n:
		var seat: Dictionary = seats[i]
		var bx := (i - (n - 1) / 2.0) * spacing
		var bench := _build_bench(seat, bx)
		benches.append(bench)
		seat["bench"] = bench
		seat["installed"] = []
		seat["armed"] = false
		seat["armed_at"] = 0.0
		seat["ammo"] = 0
		seat["fire_cd"] = 0.0
		seat["held"] = null
		var x := bx
		var z := BENCH_Z + 1.6
		spawn_subject(seat, {"x": x, "z": z, "facing": 0.0})
		seat.actor = arena.add(ArenaActor.new({"player": seat.player, "ctrl": seat.ctrl, "subject": seat.subject, "x": x, "z": z}))
		seat.actor.facing = 0.0
		seat.actor.seat = seat
		# Pistol model held in the right hand once assembled.
		var holder := Node3D.new()
		holder.position = Vector3(0, -0.78, 0.06)
		holder.rotation.x = PI / 2
		var gun := Props.make("sidearm", "pistol")
		gun.scale = Vector3.ONE * 0.5
		gun.position = Vector3(0, 0.24 * 0.5, 0.17 * 0.5)
		holder.add_child(gun)
		holder.visible = false
		seat.subject.parts.armR.add_child(holder)
		seat["gun"] = holder
	arena.on_shove = func(_a: ArenaActor, b: ArenaActor):
		if b.seat != null and b.seat.held != null:
			_drop(b.seat, 3.0)
			Sfx.play("clank", {"vol": 0.6})

	# Pre-fill the belt so the action starts immediately.
	var px := -HALF_W - 1
	while px < HALF_W:
		_spawn_belt_part(px)
		px += BELT_SPEED * SPAWN_EVERY * 1.4


# ------------------------------------------------------------------ stage

func _build_belt() -> void:
	# Frame, rails, rollers, feed chute (left) and scrap hopper (right): Blender model.
	var machine := Props.make("sidearm", "conveyor")
	machine.position = Vector3(0, 0, BELT_Z)
	scene.add_child(machine)
	var tex := Tex.canvas("sidearm-belt", 64, _paint_belt, Vector2(BELT_LEN, 1))
	belt_mat = Mats.mat(0xffffff, tex)
	var surf := Env.mesh(Geo.plane(BELT_LEN, 1.0), belt_mat, 0, BELT_Y, BELT_Z, {"cast": false})
	surf.rotation.x = -PI / 2
	scene.add_child(surf)
	Env.stencil(scene, "PARTS", -HALF_W - 1.2, 1.8, BELT_Z + 0.81, {"w": 1.3, "h": 0.5, "opacity": 0.8, "color": "#e0c050"})


static func _paint_belt(ci: CanvasItem, s: float) -> void:
	ci.draw_rect(Rect2(0, 0, s, s), Color("#1c1d1b"))
	var x := 0.0
	while x < s:
		ci.draw_rect(Rect2(x, 0, 5, s), Color("#34352f"))
		x += 16.0
	for i in 160:
		ci.draw_rect(Rect2(randf() * s, randf() * s, 2, 2), Color(0, 0, 0, randf() * 0.4))


func _build_cover() -> void:
	var crate_mat := Mats.mat(0xffffff, Tex.crate())
	_add_cover(-4.6, 0.8, 1.3, 1.3, 1.3, crate_mat)
	_add_cover(4.6, 0.8, 1.3, 1.3, 1.3, crate_mat)
	_add_cover(0, -1.3, 2.4, 0.5, 1.0, Mats.mat(0xa8aca4, Tex.plate(Vector2(2, 1))))
	Env.hazard_strip(scene, 0, -0.85, 2.4, 0.3, 0.012)
	Env.crate(scene, -4.6, 1.3, 0.8, 0.8, 0.4)


func _add_cover(x: float, z: float, w: float, d: float, h: float, material: Material) -> void:
	Env.block(scene, x, h / 2, z, w, h, d, material)
	arena.add_wall(x - w / 2, x + w / 2, z - d / 2, z + d / 2)


## A workbench with a pegboard, a player label and four part slots.
func _build_bench(seat: Dictionary, bx: float) -> Dictionary:
	var g := Node3D.new()
	g.position = Vector3(bx, 0, BENCH_Z)
	# Top, legs, shelf, pegboard with tools, vise: Blender model.
	g.add_child(Props.make("sidearm", "bench"))
	# Owner's colour stripe and label on the pegboard
	var color: String = seat.player.color
	g.add_child(Env.mesh(Geo.box(BENCH_W, 0.14, 0.07), Mats.glow(color), 0, BENCH_H + 1.04, -BENCH_D / 2 + 0.04))
	var label_tex := Tex.text("P%d" % (seat.player.slot + 1), {"w": 128, "h": 64, "size": 54, "color": color})
	var label := Env.mesh(Geo.plane(0.9, 0.45), Mats.glow(0xffffff, {"tex": label_tex, "transparent": true}), 0, BENCH_H + 0.62, -BENCH_D / 2 + 0.07, {"cast": false})
	g.add_child(label)
	# Part slots: tinted outline plates so the missing parts are readable.
	var slots := {}
	for i in PART_TYPES.size():
		var t: String = PART_TYPES[i]
		var sx := -0.72 + i * 0.48
		var pm := Mats.glow(PART_INFO[t].color, {"opacity": 0.35, "depth_write": false})
		var plate := Env.mesh(Geo.plane(0.38, 0.7), pm, sx, BENCH_H + 0.005, 0.05, {"cast": false})
		plate.rotation.x = -PI / 2
		g.add_child(plate)
		slots[t] = {"x": bx + sx, "y": BENCH_H, "z": BENCH_Z + 0.05, "plate": plate, "mat": pm, "part": null}
	# Owner's floor marking in front of the bench
	var mark := Env.mesh(Geo.plane(BENCH_W, 0.9), Mats.glow(color, {"opacity": 0.22, "depth_write": false}), 0, 0.015, BENCH_D / 2 + 0.55, {"cast": false})
	mark.rotation.x = -PI / 2
	g.add_child(mark)
	scene.add_child(g)
	arena.add_wall(bx - BENCH_W / 2, bx + BENCH_W / 2, BENCH_Z - BENCH_D / 2, BENCH_Z + BENCH_D / 2)
	return {"x": bx, "group": g, "slots": slots}


# ------------------------------------------------------------------ parts

## Next part type from a shuffled bag so every type appears regularly.
func _next_type() -> String:
	if bag.is_empty():
		bag = Rng.shuffle(PART_TYPES)
	return bag.pop_back()


func _spawn_belt_part(x: float = -HALF_W - 1.5) -> Dictionary:
	var type := _next_type()
	var g := lying_part(type)
	g.rotation.y = PI / 2 + Rng.rand(-0.3, 0.3)
	var p := {"type": type, "g": g, "state": "belt", "x": x, "z": BELT_Z + Rng.rand(-0.15, 0.15), "y": BELT_Y, "vx": 0.0, "vy": 0.0, "vz": 0.0, "age": 0.0}
	g.position = Vector3(p.x, p.y, p.z)
	scene.add_child(g)
	parts.append(p)
	return p


func _remove_part(p: Dictionary) -> void:
	var g: Node3D = p.g
	if is_instance_valid(g):
		if g.get_parent():
			g.get_parent().remove_child(g)
		g.queue_free()
	for i in parts.size():
		if is_same(parts[i], p):
			parts.remove_at(i)
			break


## Move belt parts, settle dropped parts, recycle parts that fall off the end.
func _update_parts(dt: float) -> void:
	for p in parts.duplicate():
		if p.state == "belt":
			p.x += BELT_SPEED * dt
			p.g.position = Vector3(p.x, p.y, p.z)
			if p.x > HALF_W + 1.4:
				_remove_part(p)
		elif p.state == "floor":
			p.age += dt
			if p.y > 0 or p.vy > 0:
				p.vy -= 20 * dt
				p.x += p.vx * dt
				p.z += p.vz * dt
				p.y += p.vy * dt
				p.x = clampf(p.x, -HALF_W + 0.3, HALF_W - 0.3)
				p.z = clampf(p.z, MIN_Z + 0.3, BELT_FRONT - 0.3)
				if p.y <= 0:
					p.y = 0.0
					p.vy = 0.0
					_push_out_of_walls(p)
					Sfx.play("clank", {"vol": 0.25})
			p.g.position = Vector3(p.x, p.y, p.z)
	# Keep the floor tidy: discard the oldest loose parts.
	var loose := parts.filter(func(q): return q.state == "floor")
	if loose.size() > MAX_LOOSE:
		loose.sort_custom(func(a, b): return a.age > b.age)
		for p in loose.slice(0, loose.size() - MAX_LOOSE):
			fx.smoke(p.g.position, {"size": 0.2, "life": 0.6})
			_remove_part(p)


## Nudge a landed part out of any bench/crate footprint so it stays reachable.
func _push_out_of_walls(p: Dictionary) -> void:
	for w in arena.walls:
		if p.x > w.min_x and p.x < w.max_x and p.z > w.min_z and p.z < w.max_z:
			var opts := [[p.x - w.min_x, -1.0, 0.0], [w.max_x - p.x, 1.0, 0.0], [p.z - w.min_z, 0.0, -1.0], [w.max_z - p.z, 0.0, 1.0]]
			opts.sort_custom(func(a, b): return a[0] < b[0])
			var pen: float = opts[0][0]
			p.x += opts[0][1] * (pen + 0.15)
			p.z += opts[0][2] * (pen + 0.15)


## Is the seat standing at the front of its own bench?
func _at_own_bench(seat: Dictionary) -> bool:
	var a: ArenaActor = seat.actor
	return absf(a.pos.x - seat.bench.x) < BENCH_W / 2 + 0.25 and a.pos.z - (BENCH_Z + BENCH_D / 2) < 1.1


## Try to pick up the nearest reachable part. Returns true on success.
func _try_pickup(seat: Dictionary) -> bool:
	var a: ArenaActor = seat.actor
	var best = null
	var bd := INF
	for p in parts:
		var reach: float
		if p.state == "belt":
			if p.x < -HALF_W or p.x > HALF_W:
				continue
			reach = 1.75
		elif p.state == "floor":
			if p.y > 0.3:
				continue
			reach = 1.15
		else:
			continue
		var d := U.hypot(a.pos.x - p.x, a.pos.z - p.z)
		if d < reach and d < bd:
			bd = d
			best = p
	if best == null:
		return false
	best.state = "held"
	seat.held = best
	_reparent(best.g, seat.subject.root)
	best.g.position = Vector3(0, 1.0, 0.55)
	best.g.rotation = Vector3(0, PI / 2, 0)
	Sfx.play("select", {"vol": 0.5})
	return true


## Drop the held part in front of the seat.
func _drop(seat: Dictionary, toss: float = 1.2) -> void:
	var p = seat.held
	if p == null:
		return
	seat.held = null
	var a: ArenaActor = seat.actor
	_reparent(p.g, scene)
	var f := a.forward()
	p.state = "floor"
	p.age = 0.0
	p.x = a.pos.x + f.x * 0.5
	p.z = a.pos.z + f.z * 0.5
	p.y = 1.0
	p.vx = f.x * toss + Rng.rand(-1, 1)
	p.vz = f.z * toss + Rng.rand(-1, 1)
	p.vy = 3.0
	p.g.rotation = Vector3(0, Rng.rand(0, TAU), 0)
	p.g.position = Vector3(p.x, p.y, p.z)


## Install (or reject) the held part at the seat's own bench.
func _insert(seat: Dictionary) -> void:
	var p: Dictionary = seat.held
	if seat.armed:
		if p.type == "magazine":
			seat.held = null
			_remove_part(p)
			seat.ammo = MAG_SIZE
			Sfx.play("reload")
			hud.feed("%s RELOADED" % seat.player.name(), seat.player.color)
		else:
			_drop(seat)
			Sfx.play("wrong")
		return
	if p.type in seat.installed:
		_drop(seat)
		Sfx.play("wrong")
		return
	seat.held = null
	seat.installed.append(p.type)
	seat.score = float(seat.installed.size())
	var slot: Dictionary = seat.bench.slots[p.type]
	_reparent(p.g, scene)
	p.state = "bench"
	p.g.position = Vector3(slot.x, slot.y, slot.z)
	p.g.rotation = Vector3.ZERO
	p.g.scale = Vector3.ONE
	slot.part = p
	Mats.set_opacity(slot.mat, 0.8)
	Sfx.play("clank")
	fx.sparks(Vector3(slot.x, slot.y + 0.2, slot.z), {"count": 5, "speed": 3.0})
	if seat.installed.size() == PART_TYPES.size():
		_arm(seat)


## All four parts installed: the pistol leaves the bench and enters the hand.
func _arm(seat: Dictionary) -> void:
	for t in PART_TYPES:
		var slot: Dictionary = seat.bench.slots[t]
		if slot.part != null:
			_remove_part(slot.part)
			slot.part = null
		Mats.set_opacity(slot.mat, 0.12)
	seat.armed = true
	seat.armed_at = time
	seat.ammo = MAG_SIZE
	Sfx.play("reload")
	Sfx.play("ding", {"vol": 0.6})
	fx.sparks(Vector3(seat.bench.x, BENCH_H + 0.3, BENCH_Z), {"count": 14, "speed": 4.0})
	hud.banner("%s IS ARMED" % seat.player.name(), 1300, "danger")
	hud.feed("%s — PISTOL ASSEMBLED" % seat.player.name(), seat.player.color)


# --------------------------------------------------------------- shooting

## Hitscan along the facing direction; first wall or body stops the round.
func _fire(seat: Dictionary) -> void:
	var a: ArenaActor = seat.actor
	seat.ammo -= 1
	seat.fire_cd = FIRE_CD
	var f := a.forward()
	var origin := Vector3(a.pos.x + f.x * 0.9, 1.5, a.pos.z + f.z * 0.9)
	var bd: Dictionary = arena.bounds
	var end_p = null
	var victim = null
	var d := 0.25
	while d < RANGE:
		var x := a.pos.x + f.x * d
		var z := a.pos.z + f.z * d
		if x < bd.min_x - 0.3 or x > bd.max_x + 0.3 or z < bd.min_z - 0.3 or z > bd.max_z + 0.5:
			end_p = Vector3(x, 1.5, z)
			break
		var blocked := false
		for w in arena.walls:
			if x > w.min_x and x < w.max_x and z > w.min_z and z < w.max_z:
				blocked = true
				break
		if blocked:
			end_p = Vector3(x, 1.5, z)
			break
		for s in alive_seats():
			if not is_same(s, seat) and U.hypot(s.actor.pos.x - x, s.actor.pos.z - z) < s.actor.radius + 0.08:
				victim = s
				break
		if victim != null:
			end_p = Vector3(x, 1.5, z)
			break
		d += 0.1
	if end_p == null:
		end_p = origin + f * RANGE
	Sfx.play("shot")
	engine.shake(0.15)
	fx.sparks(origin, {"count": 6, "speed": 4.0, "color": 0xffe08a})
	fx.smoke(origin, {"size": 0.15, "life": 0.5, "opacity": 0.4})
	_tracer(origin, end_p)
	if victim != null:
		if victim.held != null:
			_drop(victim, 2.0)
		# Commendation: out-drew someone whose gun was finished first.
		if victim.armed and victim.armed_at < seat.armed_at:
			award(seat, "returnFire")
		kill(victim, "shot", {"dir": f, "sound": "splat"})
		hud.feed("%s ▸ %s" % [seat.player.name(), victim.player.name()], seat.player.color)
	else:
		fx.sparks(end_p, {"count": 8, "speed": 5.0})
		Sfx.play("metal", {"vol": 0.3})


## Brief glowing streak between two points.
func _tracer(from: Vector3, to: Vector3) -> void:
	var length := maxf(0.01, from.distance_to(to))
	var mtl := Mats.glow(0xffe08a, {"opacity": 1.0, "depth_write": false})
	var m := Env.mesh(Geo.box(0.06, 0.06, 1.0), mtl, 0, 0, 0, {"cast": false})
	Env.look_from(m, (from + to) * 0.5, to)
	m.scale = Vector3(1, 1, length)
	scene.add_child(m)
	tracers.append({"m": m, "mat": mtl, "life": 0.16})


func _update_tracers(dt: float) -> void:
	var i := tracers.size() - 1
	while i >= 0:
		var t: Dictionary = tracers[i]
		t.life -= dt
		Mats.set_opacity(t.mat, maxf(0.0, t.life / 0.16))
		if t.life <= 0:
			t.m.queue_free()
			tracers.remove_at(i)
		i -= 1


# -------------------------------------------------------------- lifecycle

func start() -> void:
	hud.prompt("Grab parts from the belt ▸ build <b>your</b> pistol at <b>your</b> bench ▸ use it")
	_prompt_shown = true


func preview(dt: float) -> void:
	_animate_belt(dt)
	_update_parts(dt)
	for s in seats:
		s.subject.animate(dt, 0)


func _animate_belt(dt: float) -> void:
	belt_mat.uv1_offset.x = fmod(belt_mat.uv1_offset.x - BELT_SPEED * dt, 1.0)


func update(dt: float) -> void:
	_animate_belt(dt)
	var playing := state == "play"
	arena.step(dt, playing)
	_update_parts(dt)
	_update_tracers(dt)
	for s in seats:
		if not s.alive:
			continue
		s.subject.pose = "carry" if s.held != null else ("aim" if s.armed else "idle")
		s.gun.visible = s.armed and s.held == null
	if not playing:
		return
	# The opening prompt disappears after 6 s (setTimeout in the web version).
	if _prompt_shown and time >= 6.0:
		_prompt_shown = false
		hud.prompt("")

	spawn_t += dt
	if spawn_t >= SPAWN_EVERY:
		spawn_t -= SPAWN_EVERY
		_spawn_belt_part()

	for seat in alive_seats():
		if not seat.alive:
			continue   # shot earlier this frame
		seat.fire_cd = maxf(0.0, seat.fire_cd - dt)
		_handle_action(seat)

	for s in seats:
		var stat := "AMMO %d/%d" % [s.ammo, MAG_SIZE] if s.armed else "PARTS %d/4" % s.installed.size()
		hud.set_stat(s, stat)
		var status := ""
		if not s.alive:
			status = "DECEASED"
		elif s.held != null:
			status = "CARRYING %s" % PART_INFO[s.held.type].label
		elif s.armed:
			status = "ARMED" if s.ammo > 0 else "EMPTY — NEED MAGAZINE"
		hud.set_status(s, status)
	hud.set_timer(ROUND_TIME - time)
	if time >= ROUND_TIME:
		hud.banner("SHIFT OVER", 1500)
		Sfx.play("buzz")
		end()
		return
	check_last_standing()


## Resolve the A button: install / drop / fire / pick up, in that priority.
func _handle_action(seat: Dictionary) -> void:
	var a: ArenaActor = seat.actor
	var c: Controller = seat.ctrl
	if not c.a_pressed or a.stun > 0:
		return
	if seat.held != null:
		if _at_own_bench(seat):
			_insert(seat)
		else:
			_drop(seat)
			Sfx.play("thud", {"vol": 0.4})
		return
	if seat.armed and seat.ammo > 0:
		if seat.fire_cd <= 0:
			_fire(seat)
		return
	if not _try_pickup(seat) and seat.armed:
		Sfx.play("click")


# -------------------------------------------------------------------- bots

static func _press_a(c: Controller, m: Dictionary, was_a: bool) -> void:
	if not was_a:
		c.set_buttons(true, false)
		m["last_a"] = true


## Bot: fetch the parts it still needs (intercepting belt parts), install
## them, then hunt the nearest rival with line of sight and fire.
func bot_think(seat: Dictionary, dt: float) -> void:
	var a: ArenaActor = seat.actor
	var brain: Dictionary = seat.brain
	var m: Dictionary = brain.memory
	var c: Controller = a.ctrl
	var was_a: bool = m.get("last_a", false)
	m["last_a"] = false
	c.set_buttons(false, false)

	# Hunting with a loaded pistol
	if seat.armed and seat.ammo > 0 and seat.held == null:
		var target = null
		var best_d := INF
		var visible := false
		for r in alive_seats():
			if is_same(r, seat):
				continue
			var dr := U.dist2d(a.pos, r.actor.pos)
			var los := arena.clear_line(a.pos, r.actor.pos, 0.2)
			var score := dr - (6.0 if los else 0.0)
			if score < best_d:
				best_d = score
				target = r
				visible = los
		if target == null:
			c.set_move(0, 0)
			return
		var t: ArenaActor = target.actor
		var d := U.dist2d(a.pos, t.pos)
		if visible and d < 16:
			c.set_move(0, 0)
			# Angular error: close shots are deadly, long shots are a gamble.
			if not m.has("aim_err") or m.get("reroll", false):
				m["aim_err"] = Rng.rand(-1, 1) * (0.05 + 0.22 * (1.0 - brain.difficulty))
				m["reroll"] = false
				m["aim_t"] = 0.0
			# Lead the target slightly.
			var lead: float = 0.12 * brain.difficulty
			var ang := atan2(t.pos.x + t.vel.x * lead - a.pos.x, t.pos.z + t.vel.z * lead - a.pos.z)
			a.facing = ang + float(m.aim_err)
			m["aim_t"] = float(m.get("aim_t", 0.0)) + dt
			if m.aim_t > brain.reaction + 0.35 + d * 0.03 and seat.fire_cd <= 0:
				_press_a(c, m, was_a)
				m["reroll"] = true
		else:
			m["aim_t"] = 0.0
			_navigate(a, m, t.pos.x, t.pos.z, dt)
		return

	# Juke sideways when an armed rival is lining up on us.
	if float(m.get("dodge_t", 0.0)) > 0:
		m["dodge_t"] = m.dodge_t - dt
		c.set_move(m.dodge_x, m.dodge_z)
		return
	for r in alive_seats():
		if is_same(r, seat) or not r.armed or r.ammo <= 0 or r.held != null:
			continue
		var ra: ArenaActor = r.actor
		var dx := a.pos.x - ra.pos.x
		var dz := a.pos.z - ra.pos.z
		var d := U.hypot(dx, dz)
		if d > 14 or d < 1e-3:
			continue
		var aimed := (dx * sin(ra.facing) + dz * cos(ra.facing)) / d > 0.97
		if aimed and arena.clear_line(ra.pos, a.pos, 0.2) and Rng.random() < brain.difficulty * dt * 5:
			var side := 1.0 if Rng.random() < 0.5 else -1.0
			m["dodge_x"] = (-dz / d) * side
			m["dodge_z"] = (dx / d) * side
			m["dodge_t"] = Rng.rand(0.3, 0.6)
			return

	var needed: Array = ["magazine"] if seat.armed else PART_TYPES.filter(func(pt): return not pt in seat.installed)

	if seat.held != null:
		if not seat.held.type in needed:
			_press_a(c, m, was_a)
			return
		if _at_own_bench(seat):
			c.set_move(0, 0)
			a.facing = PI
			_press_a(c, m, was_a)
			return
		_navigate(a, m, seat.bench.x, BENCH_Z + BENCH_D / 2 + 0.6, dt)
		return

	# Opportunistic shove of a nearby carrier.
	for r in alive_seats():
		if is_same(r, seat) or r.held == null:
			continue
		var d := U.dist2d(a.pos, r.actor.pos)
		if d < 1.3 and Rng.random() < brain.difficulty * dt * 3:
			a.facing = atan2(r.actor.pos.x - a.pos.x, r.actor.pos.z - a.pos.z)
			c.set_buttons(false, true)
			return

	# Choose the cheapest part to reach (floor parts directly, belt parts by interception).
	var spd := a.speed * a.speed_mul
	var goal = null
	var best_t := INF
	for p in parts:
		if not p.type in needed:
			continue
		if p.state == "floor" and p.y < 0.3:
			var tt := U.hypot(a.pos.x - p.x, a.pos.z - p.z) / spd
			if tt < best_t:
				best_t = tt
				goal = {"p": p, "x": p.x, "z": p.z}
		elif p.state == "belt":
			var stand_z := BELT_FRONT - 0.5
			var tt := 0.0
			var px: float = p.x
			for k in 3:
				tt = U.hypot(px - a.pos.x, stand_z - a.pos.z) / spd + 0.15
				px = p.x + BELT_SPEED * tt
			if px > HALF_W - 0.6 or px < -HALF_W + 0.3:
				continue
			if tt < best_t:
				best_t = tt
				goal = {"p": p, "x": px, "z": stand_z}
	if goal == null:
		_navigate(a, m, a.pos.x * 0.8, BELT_FRONT - 1.2, dt)
		return
	var reach := 1.6 if goal.p.state == "belt" else 1.0
	if U.hypot(a.pos.x - goal.p.x, a.pos.z - goal.p.z) < reach:
		_press_a(c, m, was_a)
		c.set_move(0, 0)
		return
	_navigate(a, m, goal.x, goal.z, dt)


## Steer toward a point, sidestepping when stuck against an obstacle.
func _navigate(a: ArenaActor, m: Dictionary, x: float, z: float, dt: float) -> void:
	m["stuck_t"] = float(m.get("stuck_t", 0.0)) + dt
	if float(m.get("detour_t", 0.0)) > 0:
		m["detour_t"] = m.detour_t - dt
		a.ctrl.set_move(m.detour_x, m.detour_z)
		return
	var d := AI.steer_to(a, x, z, {"arrive": 0.15, "slow": 0.6})
	if m.stuck_t > 0.6:
		var moved := 1.0
		if m.has("last_pos"):
			var lp: Vector2 = m.last_pos
			moved = U.hypot(a.pos.x - lp.x, a.pos.z - lp.y)
		if moved < 0.25 and d > 0.6:
			var dx := x - a.pos.x
			var dz := z - a.pos.z
			var l := U.hypot(dx, dz)
			if l == 0.0:
				l = 1.0
			var side := 1.0 if Rng.random() < 0.5 else -1.0
			m["detour_x"] = (-dz / l) * side
			m["detour_z"] = (dx / l) * side
			m["detour_t"] = Rng.rand(0.35, 0.7)
		m["last_pos"] = Vector2(a.pos.x, a.pos.z)
		m["stuck_t"] = 0.0


func dispose() -> void:
	for seat in seats:
		seat.actor = null   # break the seat <-> actor reference cycle
	super.dispose()

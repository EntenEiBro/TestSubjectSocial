extends Minigame
## FORKLIFT FRENZY — warehouse logistics with a performance review at the end.
##
## Rules:
##  - Every subject drives a small forklift. The stick sets the heading you
##    want; the forklift turns toward it at a limited rate and accelerates
##    with some inertia (it slows down while turning hard).
##  - A raises / lowers the forks: with an empty fork in front of a crate it
##    picks the crate up, while loaded it sets the crate down in front.
##  - Each subject owns a painted deposit zone in a corner. Crates resting in
##    your zone are your score — steal from rival zones freely. Crates can
##    also be bulldozed.
##  - B = horn + bump: shoves forklifts in front of you and knocks their
##    crate off the forks. Forklifts collide and push each other.
##  - After 45 s the subject(s) with the fewest crates are flattened by a
##    crate dropped from the ceiling. Ties for last all die.
## Forklift (body + carriage) and shelving rack models: blender/props/forklift.py.

const META := {
	"id": "forklift",
	"title": "FORKLIFT FRENZY",
	"tagline": "Lowest output gets a crate. From above.",
	"category": "Competitive",
	"controls": [{"input": "move", "label": "Steer / Drive"}, {"input": "a", "label": "Forks up / down"}, {"input": "b", "label": "Horn + bump"}],
	"objective": "Have the most crates in your zone when the shift ends — and never the fewest.",
	"rules": [
		"Point the stick where you want to go; the forklift turns and accelerates.",
		"{A} lifts a crate in front of the forks, {A} again sets it down.",
		"Crates in your coloured zone score. Stealing is encouraged. {B} honks and bumps.",
		"After 45 s the lowest scorer is crushed. Ties for last are crushed together.",
	],
}

const HALF_W := 11.0
const MIN_Z := -7.0
const MAX_Z := 6.5
const ROUND_TIME := 45.0
const ZONE := 4.0                 # deposit zone side length
const FL_R := 0.8                 # forklift body radius (centre slightly behind pos)
const CRATE := 0.9
const CRATE_R := 0.5
const MAX_SPEED := 6.2
const ACCEL := 7.0
const DECEL := 9.0
const TURN_RATE := 3.4
const FORK_REACH := 1.25          # fork pick point ahead of the forklift centre
const START_CRATES := 10
const MAX_CRATES := 24
const SPAWN_EVERY := 3.0
const GRAVITY := 26.0

var zones := []
var forklifts := []
var crates := []
var drops := []      # execution crates
var spawn_t := 0.0
var _crate_mat: StandardMaterial3D
var _prompt_off_at := -1.0   # JS: setTimeout(5000) hides the opening prompt


## The forklift model (forward = +Z) painted in `color`. Returns {g, carriage}.
static func build_forklift(color: Variant) -> Dictionary:
	var g := Node3D.new()
	var body := Props.make("forklift", "forklift_body")
	_repaint(body, Mats.mat(color, Tex.metal()))
	g.add_child(body)
	# Carriage + forks (moves vertically)
	var carriage := Props.make("forklift", "carriage")
	carriage.position = Vector3(0, 0.15, 0.8)
	g.add_child(carriage)
	return {"g": g, "carriage": carriage}


## Swap the white "paint" material of the forklift model for the player's colour.
static func _repaint(node: Node, paint: Material) -> void:
	if node is MeshInstance3D:
		var mi: MeshInstance3D = node
		if mi.mesh:
			for i in mi.mesh.get_surface_count():
				var src := mi.mesh.surface_get_material(i)
				if src and src.resource_name == "m_metal_ffffff":
					mi.set_surface_override_material(i, paint)
	for c in node.get_children():
		_repaint(c, paint)


func build() -> void:
	make_scene({"fog_near": 24.0, "fog_far": 60.0})
	make_camera([0, 20, 13.5], [0, 0, -0.3], 50)
	_crate_mat = Mats.mat(0xffffff, Tex.crate())

	Env.floor_plane(scene, 50, 40, {"tex": "concrete", "tile": 3.0})
	Env.floor_plane(scene, HALF_W * 2, MAX_Z - MIN_Z, {"tex": "plate", "tile": 2.0, "y": 0.004, "z": (MIN_Z + MAX_Z) / 2})
	_build_warehouse()

	Env.hanging_lamp(scene, -4, 8, -5.5, {"intensity": 100.0, "angle": 1.0, "target": Vector3(-5, 0, -1)})
	Env.hanging_lamp(scene, 4, 8, -5.5, {"intensity": 100.0, "angle": 1.0, "target": Vector3(5, 0, -1)})
	Env.hanging_lamp(scene, -5.5, 8, 3.5, {"intensity": 70.0, "angle": 0.95, "shadow": false})
	Env.hanging_lamp(scene, 5.5, 8, 3.5, {"intensity": 70.0, "angle": 0.95, "shadow": false})

	# Deposit zones in the corners
	var zx := HALF_W - ZONE / 2 - 0.3
	var z_top := MIN_Z + ZONE / 2 + 0.3
	var z_bot := MAX_Z - ZONE / 2 - 0.3
	var corners := [[-zx, z_top], [zx, z_top], [-zx, z_bot], [zx, z_bot]]
	zones = []
	for i in seats.size():
		zones.append(_build_zone(seats[i], corners[i][0], corners[i][1]))

	forklifts = []
	for i in seats.size():
		var seat: Dictionary = seats[i]
		var zone: Dictionary = zones[i]
		var x: float = zone.x * 0.62
		var z: float = zone.z * 0.55
		var parts := build_forklift(seat.player.color)
		var g: Node3D = parts.g
		var s := spawn_subject(seat, {"x": 0.0, "z": 0.0, "ring": false, "facing": 0.0})
		scene.remove_child(s.root)
		g.add_child(s.root)
		s.root.position = Vector3(0, 0.02, -0.33)
		s.root.rotation.y = 0.0
		s.pose = "sit"
		var ring := Env.player_ring(seat.player.color)
		ring.scale = Vector3.ONE * 2.1
		g.add_child(ring)
		scene.add_child(g)
		var fl := {"seat": seat, "g": g, "carriage": parts.carriage, "x": x, "z": z, "h": atan2(-x, -z), "v": 0.0, "px": 0.0, "pz": 0.0,
			"fork_up": false, "fork_y": 0.15, "carry": null, "horn_cd": 0.0, "stun": 0.0, "dead": false}
		seat["fl"] = fl
		seat["zone"] = zone
		seat["certified"] = false
		forklifts.append(fl)
		_place_forklift(fl)

	crates = []
	for i in START_CRATES:
		_spawn_crate(false)
	spawn_t = 0.0
	drops = []


# ------------------------------------------------------------------ stage

func _build_warehouse() -> void:
	var wall_mat := Mats.mat(0xffffff, Tex.wall(Vector2(6, 1.5)))
	Env.block(scene, 0, 2.5, MIN_Z - 1.6, HALF_W * 2 + 3, 5, 0.3, wall_mat)
	Env.block(scene, -HALF_W - 0.3, 0.5, (MIN_Z + MAX_Z) / 2, 0.4, 1.0, MAX_Z - MIN_Z, Mats.mat(0xffffff, Tex.hazard(Vector2(1, 8))))
	Env.block(scene, HALF_W + 0.3, 0.5, (MIN_Z + MAX_Z) / 2, 0.4, 1.0, MAX_Z - MIN_Z, Mats.mat(0xffffff, Tex.hazard(Vector2(1, 8))))
	Env.block(scene, 0, 0.3, MIN_Z - 0.2, HALF_W * 2 + 0.6, 0.6, 0.4, Mats.mat(0xffffff, Tex.hazard(Vector2(10, 1))))
	Env.stencil(scene, "STACK", 0, 3.6, MIN_Z - 1.44, {"w": 6.0, "h": 1.8, "opacity": 0.55})
	# Shelving racks against the back wall, loosely stocked
	for rx in [-7.5, 7.5]:
		var rack := Props.make("forklift", "rack")
		rack.position = Vector3(rx, 0, MIN_Z - 1.0)
		scene.add_child(rack)
		for y in [0.15, 1.5, 2.85]:
			for k in range(-1, 2):
				if Rng.random() < 0.7:
					scene.add_child(Env.mesh(Geo.box(0.8, 0.8, 0.8), _crate_mat, rx + k * 1.3, y + 0.45, MIN_Z - 1.0))


func _build_zone(seat: Dictionary, x: float, z: float) -> Dictionary:
	var color: String = seat.player.color
	var pad := Env.mesh(Geo.plane(ZONE, ZONE), Mats.glow(color, {"opacity": 0.22, "depth_write": false}), x, 0.012, z, {"cast": false})
	pad.rotation.x = -PI / 2
	scene.add_child(pad)
	var edge := Mats.glow(color)
	for e in [[0.0, -ZONE / 2, ZONE, 0.12], [0.0, ZONE / 2, ZONE, 0.12], [-ZONE / 2, 0.0, 0.12, ZONE], [ZONE / 2, 0.0, 0.12, ZONE]]:
		scene.add_child(Env.mesh(Geo.box(e[2], 0.02, e[3]), edge, x + e[0], 0.02, z + e[1], {"cast": false}))
	var tex := Tex.text("P%d" % (seat.player.slot + 1), {"w": 128, "h": 64, "size": 54, "color": color})
	var label := Env.mesh(Geo.plane(1.6, 0.8), Mats.glow(0xffffff, {"tex": tex, "opacity": 0.6, "depth_write": false}), x, 0.02, z, {"cast": false})
	label.rotation.x = -PI / 2
	scene.add_child(label)
	return {"x": x, "z": z, "half": ZONE / 2, "seat": seat}


static func _in_zone(px: float, pz: float, zone: Dictionary, margin: float = 0.0) -> bool:
	return absf(px - zone.x) < zone.half - margin and absf(pz - zone.z) < zone.half - margin


## Add a crate in the middle of the floor, optionally dropping from the ceiling.
func _spawn_crate(from_above: bool = true) -> Dictionary:
	var x := 0.0
	var z := 0.0
	for tries in 20:
		x = Rng.rand(-4.5, 4.5)
		z = Rng.rand(-3.5, 3)
		var ok := true
		for c in crates:
			if U.hypot(c.x - x, c.z - z) <= 1.2:
				ok = false
				break
		if ok:
			for f in forklifts:
				if U.hypot(f.x - x, f.z - z) <= 1.8:
					ok = false
					break
		if ok:
			break
	var m := Env.mesh(Geo.box(CRATE, CRATE, CRATE), _crate_mat, x, 0, z)
	m.rotation.y = Rng.rand(-0.3, 0.3)
	scene.add_child(m)
	var c := {"m": m, "x": x, "z": z, "y": 7.0 if from_above else 0.0, "vy": 0.0, "carrier": null, "falling": from_above}
	crates.append(c)
	_place_crate(c)
	return c


func _place_crate(c: Dictionary) -> void:
	c.m.position = Vector3(c.x, c.y + CRATE / 2, c.z)


func _place_forklift(fl: Dictionary) -> void:
	var g: Node3D = fl.g
	g.position = Vector3(fl.x, 0, fl.z)
	g.rotation.y = fl.h
	fl.carriage.position.y = fl.fork_y


# ---------------------------------------------------------------- physics

## Drive one forklift from its controller (heading-seeking steering with inertia).
func _drive(fl: Dictionary, dt: float, input: bool) -> void:
	var c: Controller = fl.seat.ctrl
	fl.stun = maxf(0.0, fl.stun - dt)
	fl.horn_cd = maxf(0.0, fl.horn_cd - dt)
	var mag := minf(1.0, U.hypot(c.move_x, c.move_y))
	var target_v := 0.0
	if input and not fl.dead and fl.stun <= 0 and mag > 0.2:
		var want := atan2(c.move_x, c.move_y)
		var diff := U.angle_diff(fl.h, want)
		var turn := TURN_RATE * dt
		fl.h += clampf(diff, -turn, turn)
		target_v = MAX_SPEED * (0.82 if fl.carry != null else 1.0) * mag * maxf(0.1, cos(diff))
	var rate := ACCEL if target_v > fl.v else DECEL
	fl.v += clampf(target_v - fl.v, -rate * dt, rate * dt)
	fl.x += (sin(fl.h) * fl.v + fl.px) * dt
	fl.z += (cos(fl.h) * fl.v + fl.pz) * dt
	var k := exp(-4 * dt)
	fl.px *= k
	fl.pz *= k
	var r := 0.95
	if fl.x < -HALF_W + r or fl.x > HALF_W - r:
		fl.x = clampf(fl.x, -HALF_W + r, HALF_W - r)
		fl.px *= -0.3
		fl.v *= 0.7
	if fl.z < MIN_Z + r or fl.z > MAX_Z - r:
		fl.z = clampf(fl.z, MIN_Z + r, MAX_Z - r)
		fl.pz *= -0.3
		fl.v *= 0.7
	fl.fork_y += ((0.95 if fl.fork_up else 0.15) - fl.fork_y) * U.damp(8, dt)


## Forklift-vs-forklift circle collisions with an impulse exchange.
func _collide_forklifts() -> void:
	var list := forklifts.filter(func(f): return not f.dead)
	for i in list.size():
		for j in range(i + 1, list.size()):
			var a: Dictionary = list[i]
			var b: Dictionary = list[j]
			var dx: float = b.x - a.x
			var dz: float = b.z - a.z
			var d := U.hypot(dx, dz)
			var mn := 1.7
			if d >= mn or d < 1e-4:
				continue
			var nx := dx / d
			var nz := dz / d
			var push := (mn - d) / 2
			a.x -= nx * push
			a.z -= nz * push
			b.x += nx * push
			b.z += nz * push
			var va: float = sin(a.h) * a.v * nx + cos(a.h) * a.v * nz
			var vb: float = sin(b.h) * b.v * nx + cos(b.h) * b.v * nz
			var j2 := maxf(0.0, va - vb)
			if j2 > 0.5:
				a.px -= nx * j2 * 0.5
				a.pz -= nz * j2 * 0.5
				b.px += nx * j2 * 0.9
				b.pz += nz * j2 * 0.9
				a.v *= 0.5
				b.v *= 0.7
				if j2 > 2.5:
					Sfx.play("clank", {"vol": 0.5})
					fx.sparks(Vector3(a.x + nx * 0.85, 0.6, a.z + nz * 0.85), {"count": 6})


## Free crates: falling, being bulldozed by forklift bodies, separating from each other.
func _update_crates(dt: float) -> void:
	for c in crates:
		if c.carrier != null:
			var f: Dictionary = c.carrier
			c.x = f.x + sin(f.h) * FORK_REACH
			c.z = f.z + cos(f.h) * FORK_REACH
			c.y = f.fork_y + 0.04
			c.m.rotation.y = f.h
			_place_crate(c)
			continue
		if c.falling or c.y > 0:
			c.vy -= GRAVITY * dt
			c.y += c.vy * dt
			if c.y <= 0:
				c.y = 0.0
				if c.vy < -6:
					Sfx.play("thud", {"vol": 0.6})
					fx.smoke(Vector3(c.x, 0.2, c.z), {"size": 0.35, "life": 0.8, "color": 0x8a8270})
				c.vy = 0.0
				c.falling = false
		if c.y < 0.5:
			for f in forklifts:
				if f.dead:
					continue
				var bx: float = f.x - sin(f.h) * 0.15
				var bz: float = f.z - cos(f.h) * 0.15
				var dx: float = c.x - bx
				var dz: float = c.z - bz
				var d := U.hypot(dx, dz)
				var mn := FL_R + CRATE_R
				if d < mn and d > 1e-4:
					c.x = bx + dx / d * mn
					c.z = bz + dz / d * mn
					f.v *= 0.97
		c.x = clampf(c.x, -HALF_W + CRATE_R, HALF_W - CRATE_R)
		c.z = clampf(c.z, MIN_Z + CRATE_R, MAX_Z - CRATE_R)
	var free := crates.filter(func(cr): return cr.carrier == null and not cr.falling)
	for i in free.size():
		for j in range(i + 1, free.size()):
			var a: Dictionary = free[i]
			var b: Dictionary = free[j]
			var dx: float = b.x - a.x
			var dz: float = b.z - a.z
			var d := U.hypot(dx, dz)
			var mn := CRATE * 0.98
			if d < mn and d > 1e-4:
				var p := (mn - d) / 2
				var nx := dx / d
				var nz := dz / d
				a.x -= nx * p
				a.z -= nz * p
				b.x += nx * p
				b.z += nz * p
	for c in free:
		_place_crate(c)


## A button: lift a crate in reach, set down the carried crate, or toggle empty forks.
func _forks(fl: Dictionary) -> void:
	if fl.carry != null:
		var c: Dictionary = fl.carry
		fl.carry = null
		c.carrier = null
		c.x = fl.x + sin(fl.h) * (FORK_REACH + 0.1)
		c.z = fl.z + cos(fl.h) * (FORK_REACH + 0.1)
		c.vy = 0.0
		fl.fork_up = false
		Sfx.play("thud", {"vol": 0.5})
		return
	if fl.fork_up:
		fl.fork_up = false
		Sfx.play("clank", {"vol": 0.3})
		return
	var tip_x: float = fl.x + sin(fl.h) * FORK_REACH
	var tip_z: float = fl.z + cos(fl.h) * FORK_REACH
	var best = null
	var bd := 0.8
	for c in crates:
		if c.carrier != null or c.falling or c.y > 0.3:
			continue
		var d := U.hypot(tip_x - c.x, tip_z - c.z)
		if d < bd:
			bd = d
			best = c
	fl.fork_up = true
	Sfx.play("clank", {"vol": 0.4})
	if best != null:
		best.carrier = fl
		fl.carry = best
		Sfx.play("engine")


## Knock the carried crate off a forklift's forks.
func _spill(fl: Dictionary) -> void:
	var c = fl.carry
	if c == null:
		return
	fl.carry = null
	c.carrier = null
	c.y = maxf(c.y, 0.6)
	c.vy = 3.0
	c.falling = true
	c.x += Rng.rand(-0.4, 0.4)
	c.z += Rng.rand(-0.4, 0.4)
	fl.fork_up = false


## B button: horn + a short bump cone in front.
func _horn(fl: Dictionary) -> void:
	fl.horn_cd = 1.1
	Sfx.play("horn", {"vol": 0.5})
	var fx_ := sin(fl.h)
	var fz := cos(fl.h)
	for o in forklifts:
		if is_same(o, fl) or o.dead:
			continue
		var dx: float = o.x - fl.x
		var dz: float = o.z - fl.z
		var d := U.hypot(dx, dz)
		if d > 2.8 or d < 1e-3 or (dx * fx_ + dz * fz) / d < 0.3:
			continue
		o.px += dx / d * 5.5
		o.pz += dz / d * 5.5
		o.stun = 0.35
		o.v *= 0.3
		Haptics.for_player(o.seat.player, "hit")
		Haptics.for_player(fl.seat.player, "click")
		_spill(o)
		Sfx.play("shove")


# -------------------------------------------------------------- lifecycle

func start() -> void:
	Sfx.play("engine")
	hud.prompt("{MOVE} drive · {A} forks · {B} horn")
	_prompt_off_at = time + 5.0


func preview(dt: float) -> void:
	for s in seats:
		s.subject.animate(dt, 0)


func update(dt: float) -> void:
	var playing := state == "play"
	for fl in forklifts:
		if playing and not fl.dead:
			var c: Controller = fl.seat.ctrl
			if c.a_pressed and fl.stun <= 0:
				_forks(fl)
			if c.b_pressed and fl.horn_cd <= 0:
				_horn(fl)
		_drive(fl, dt, playing)
	_collide_forklifts()
	_update_crates(dt)
	for fl in forklifts:
		if fl.dead:
			continue
		_place_forklift(fl)
		var s: Subject = fl.seat.subject
		s.pose = "sit"
		s.animate(dt, 0)
		s.root.rotation.z = sin(time * 30) * 0.01 * absf(fl.v)   # engine rattle
	_update_drops(dt)
	if not playing:
		return

	if _prompt_off_at >= 0.0 and time >= _prompt_off_at:
		_prompt_off_at = -1.0
		hud.prompt("")

	spawn_t += dt
	if spawn_t >= SPAWN_EVERY:
		spawn_t -= SPAWN_EVERY
		if crates.size() < MAX_CRATES:
			_spawn_crate(true)

	for seat in seats:
		var n := 0
		for c in crates:
			if c.carrier == null and not c.falling and _in_zone(c.x, c.z, seat.zone):
				n += 1
		seat.score = float(n)
		if seat.score >= 4 and not seat.certified:
			seat.certified = true
			award(seat, "certified")
		hud.set_stat(seat, "CRATES %d" % n)
		hud.set_status(seat, "LOADED" if seat.fl.carry != null else "")
	hud.set_timer(maxf(0.0, ROUND_TIME - time))
	if time >= ROUND_TIME:
		_review()


## Shift over: the lowest scorer(s) get a crate from the ceiling.
func _review() -> void:
	var mn := INF
	for s in seats:
		mn = minf(mn, s.score)
	var losers := seats.filter(func(s): return s.score == mn)
	hud.banner("EQUAL FAILURE. EQUAL PUNISHMENT." if losers.size() == seats.size() else "PERFORMANCE REVIEW", 2200, "danger")
	Sfx.play("buzz")
	for i in losers.size():
		var seat: Dictionary = losers[i]
		var fl: Dictionary = seat.fl
		var m := Env.mesh(Geo.box(1.8, 1.8, 1.8), _crate_mat, fl.x, 16 + i * 2, fl.z)
		scene.add_child(m)
		drops.append({"m": m, "seat": seat, "y": 16.0 + i * 2, "vy": 0.0, "delay": 0.6 + i * 0.25, "landed": false})
	end(3.4 + losers.size() * 0.25)


func _update_drops(dt: float) -> void:
	for d in drops:
		if d.landed:
			continue
		if d.delay > 0:
			d.delay -= dt
			continue
		var fl: Dictionary = d.seat.fl
		d.vy -= GRAVITY * 1.4 * dt
		d.y += d.vy * dt
		var top := 1.2
		d.m.position = Vector3(fl.x, d.y + 0.9, fl.z)
		if d.y <= top:
			d.landed = true
			d.y = 0.45
			d.m.position.y = d.y + 0.9
			var s: Subject = d.seat.subject
			U.reparent_keep(s.root, scene)   # so FX use world coordinates
			kill(d.seat, "crush")
			fl.dead = true
			fl.g.scale.y = 0.3
			if fl.carry != null:
				_spill(fl)
			fx.smoke(Vector3(fl.x, 0.4, fl.z), {"size": 0.8, "life": 1.2, "color": 0x6a6258})
			if engine:
				engine.shake(0.8)


## Rank by crates in zone; the crushed share their score but rank below the living.
func placement() -> Array:
	return Minigame.rank_by_score(seats)


# -------------------------------------------------------------------- bots

## Bot: pick the cheapest free crate (centre first, sometimes a rival's),
## line the forks up, lift, haul it into its own zone and set it down.
func bot_think(seat: Dictionary, dt: float) -> void:
	var fl: Dictionary = seat.fl
	var c: Controller = seat.ctrl
	var brain: Dictionary = seat.brain
	var m: Dictionary = brain.memory
	var was_a: bool = m.get("last_a", false)
	m["last_a"] = false
	c.set_buttons(false, false)
	if fl.dead:
		c.set_move(0, 0)
		return

	# Unstick: if barely moving for a while, swing around.
	m["stuck_t"] = float(m.get("stuck_t", 0.0)) + dt
	if m.stuck_t > 1.0:
		var last_pos = m.get("last_pos")
		var moved: float = U.hypot(fl.x - last_pos.x, fl.z - last_pos.z) if last_pos != null else 1.0
		if moved < 0.35 and m.get("want_move", false):
			m["turn_t"] = 0.8
			m["turn_dir"] = fl.h + PI + Rng.rand(-0.8, 0.8)
		m["last_pos"] = {"x": fl.x, "z": fl.z}
		m["stuck_t"] = 0.0
	if float(m.get("turn_t", 0.0)) > 0:
		m.turn_t -= dt
		c.set_move(sin(m.turn_dir), cos(m.turn_dir))
		return

	# Honk at loaded rivals right in front.
	for o in forklifts:
		if is_same(o, fl) or o.dead or o.carry == null or fl.horn_cd > 0:
			continue
		var dx: float = o.x - fl.x
		var dz: float = o.z - fl.z
		var d := U.hypot(dx, dz)
		if d < 2.6 and (dx * sin(fl.h) + dz * cos(fl.h)) / d > 0.5 and Rng.random() < brain.difficulty * dt * 3:
			c.set_buttons(false, true)
			break

	var zone: Dictionary = seat.zone
	if fl.carry != null:
		if m.get("drop") == null:
			var ddx := Rng.rand(-1.1, 1.1)
			var ddz := Rng.rand(-1.1, 1.1)
			m["drop"] = {"x": zone.x + ddx, "z": zone.z + ddz}
		var tip_x: float = fl.x + sin(fl.h) * (FORK_REACH + 0.1)
		var tip_z: float = fl.z + cos(fl.h) * (FORK_REACH + 0.1)
		if _in_zone(tip_x, tip_z, zone, 0.55) and (U.hypot(tip_x - m.drop.x, tip_z - m.drop.z) < 1.0 or _in_zone(tip_x, tip_z, zone, 1.0)):
			c.set_move(0, 0)
			_press_a(c, m, was_a)
			m["drop"] = null
			m["want_move"] = false
			return
		_steer(fl, m, m.drop.x, m.drop.z)
		return
	if fl.fork_up:
		_press_a(c, m, was_a)
		return

	m["pick_t"] = float(m.get("pick_t", 0.0)) - dt
	if not _valid_target(m.get("target"), zone) or m.pick_t <= 0:
		# Late in the shift, a bot that isn't clearly ahead turns to theft.
		var leader := -INF
		for s in seats:
			if not is_same(s, seat):
				leader = maxf(leader, s.score)
		var desperate: bool = time > 25 and seat.score <= leader + 1
		var thief: bool = desperate or Rng.random() < 0.2 + 0.3 * brain.difficulty
		var best = null
		var bc := INF
		for cr in crates:
			if not _valid_target(cr, zone):
				continue
			var cost: float = U.hypot(cr.x - fl.x, cr.z - fl.z) + U.hypot(cr.x - zone.x, cr.z - zone.z) * 0.5
			for z in zones:
				if not is_same(z, zone) and _in_zone(cr.x, cr.z, z):
					cost += -3.0 if desperate else (1.0 if thief else 9.0)
					break
			# Avoid crates a rival is already lining up on.
			for s in seats:
				if not is_same(s, seat) and is_same(s.brain.memory.get("target"), cr):
					cost += 4
					break
			if cost < bc:
				bc = cost
				best = cr
		m["target"] = best
		m["pick_t"] = Rng.rand(1.5, 2.5)
	var t = m.target
	if t == null:
		c.set_move(0, 0)
		m["want_move"] = false
		return
	var tx: float = fl.x + sin(fl.h) * FORK_REACH
	var tz: float = fl.z + cos(fl.h) * FORK_REACH
	if U.hypot(tx - t.x, tz - t.z) < 0.6:
		c.set_move(0, 0)
		_press_a(c, m, was_a)
		m["target"] = null
		m["want_move"] = false
		return
	# Approach from a staging point behind the crate (relative to us) so the forks line up.
	var d := U.hypot(t.x - fl.x, t.z - fl.z)
	var dd := d if d != 0.0 else 1.0
	var ux: float = (t.x - fl.x) / dd
	var uz: float = (t.z - fl.z) / dd
	if d > 3.2:
		_steer(fl, m, t.x - ux * 2, t.z - uz * 2)
	else:
		_steer(fl, m, t.x - ux * (FORK_REACH - 0.15), t.z - uz * (FORK_REACH - 0.15), 0.55)


func _press_a(c: Controller, m: Dictionary, was_a: bool) -> void:
	if not was_a:
		c.set_buttons(true, false)
		m["last_a"] = true


func _valid_target(cr, zone: Dictionary) -> bool:
	if cr == null or cr.carrier != null or cr.falling or _in_zone(cr.x, cr.z, zone):
		return false
	for o in crates:
		if is_same(o, cr):
			return true
	return false


func _steer(fl: Dictionary, m: Dictionary, x: float, z: float, throttle: float = 1.0) -> void:
	var dx: float = x - fl.x
	var dz: float = z - fl.z
	var d := U.hypot(dx, dz)
	if d == 0.0:
		d = 1.0
	var s := minf(1.0, d / 1.5) * throttle
	fl.seat.ctrl.set_move(dx / d * maxf(0.35, s), dz / d * maxf(0.35, s))
	m["want_move"] = true


func dispose() -> void:
	# break reference cycles (seat <-> forklift / zone, crate <-> carrier, bot memories)
	for c in crates:
		c.carrier = null
	for fl in forklifts:
		fl.carry = null
		fl.seat = null
	for z in zones:
		z.seat = null
	for d in drops:
		d.seat = null
	for seat in seats:
		seat.fl = null
		seat.zone = null
		seat.brain.memory.clear()
	super.dispose()

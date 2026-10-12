extends Minigame
## SPIN CYCLE — sumo on a giant industrial turntable above a bottomless shaft.
##
## Rules
##  - The disc (radius 6) spins and carries everyone standing on it around
##    with it. An outward centrifugal drift grows with the square of the spin
##    speed, and the spin keeps speeding up for the whole round.
##  - Every 15 s the outermost ring of the disc breaks away (15/30/45/60 s).
##    It flashes red and shudders for 3 s first. Whoever is still on it rides
##    it down.
##  - Leaving the disc = falling into the shaft ('fall' death). Shoving (B)
##    someone off credits the shover in the feed.
##  - Last subject standing wins. At 70 s the disc stops and every survivor
##    shares first place. Nobody can fall once the round is over.
## Ring plates, core, roller wheels and arm feet: blender/props/spincycle.py.

const META := {
	"id": "spincycle",
	"title": "SPIN CYCLE",
	"tagline": "Gentle cycle not available.",
	"category": "Survival",
	"controls": [{"input": "move", "label": "Move"}, {"input": "b", "label": "Shove"}],
	"objective": "Be the last subject standing.",
	"rules": [
		"The turntable drags you around and flings you outward — faster and faster.",
		"Every 15 seconds the outer ring breaks away. It flashes red first.",
		"Off the edge is a long way down.",
		"Press {B} to shove rivals toward the rim.",
		"After 70 seconds the disc stops. Survivors share the win.",
	],
}

const RADII := [6.0, 5.0, 4.1, 3.3, 2.6]   # disc radius after 0..4 ring breaks
const SEGMENTS := [14, 12, 10, 8]          # plates per breakable ring (even: alternating colours)
const BREAK_AT := [15.0, 30.0, 45.0, 60.0] # seconds of play at which ring k breaks away
const WARN := 3.0                          # seconds of flashing before a break
const CAP := 70.0                          # the disc stops: survivors share the win
const DEPTH := 0.35                        # disc thickness
const SHAFT_R := 9.0                       # radius of the shaft opening
const SPAWN_R := 3.2
const OMEGA0 := 0.45                       # rad/s at GO
const OMEGA_RAMP := 0.013                  # rad/s gained per second
const CENTRI := 0.55                       # outward drift = CENTRI * omega² * r (units/s)
const EDGE_SLACK := 0.05                   # centre this far past the rim = falling
const ARM_ANGLES := [-PI / 2, PI / 5, 4 * PI / 5]   # roller arms (world angle, x=cos z=sin)
const PLATE_MAT := "m_plate_b8b4aa"        # the plate model's body material (swapped per ring)

var arena: Arena
var disc: Node3D
var rings := []
var arms := []
var alarm: OmniLight3D
var shaft_light: OmniLight3D
var disc_r: float = RADII[0]
var omega := 0.3
var arm_r: float = RADII[0]   # visual: roller arms follow the rim
var break_idx := 0            # next ring to break
var warned := false           # the next ring is currently flashing
var flash_phase := 0.0
var flash_on := false
var capped := false
var prompt_on := false
var spark_t := 0.0
var spark_n := 0
var hum_t := 0.0


func build() -> void:
	disc_r = RADII[0]
	omega = 0.3
	arm_r = disc_r
	make_scene({
		"fog_near": 16.0, "fog_far": 46.0,
		# Over the shaft there is no floor: debris and bodies keep falling.
		"floor_at": func(x: float, z: float) -> float: return 0.0 if U.hypot(x, z) <= disc_r else -INF,
	})
	make_camera([0, 15, 11], [0, -0.6, 0.4], 50)

	_build_room()
	_build_shaft()
	_build_disc()
	_build_arms()

	Env.hanging_lamp(scene, 0, 10, 0, {"intensity": 150.0, "angle": 0.8})
	Env.hanging_lamp(scene, -8, 8.5, -4, {"intensity": 50.0, "angle": 0.8, "shadow": false})
	Env.hanging_lamp(scene, 8, 8.5, -4, {"intensity": 50.0, "angle": 0.8, "shadow": false})

	# --- arena + avatars (bounds are irrelevant: the rim is handled by update())
	arena = Arena.new({"bounds": {"min_x": -20.0, "max_x": 20.0, "min_z": -20.0, "max_z": 20.0}, "shove_force": 13.0})
	var n := seats.size()
	for i in n:
		var seat: Dictionary = seats[i]
		var ang := float(i) / n * TAU + PI / 4
		var x := cos(ang) * SPAWN_R
		var z := sin(ang) * SPAWN_R
		var facing := atan2(-x, -z)
		spawn_subject(seat, {"x": x, "z": z, "facing": facing})
		seat.actor = arena.add(ArenaActor.new({"player": seat.player, "ctrl": seat.ctrl, "subject": seat.subject, "x": x, "z": z}))
		seat.actor.facing = facing
		seat.actor.seat = seat
	arena.on_shove = func(a: ArenaActor, b: ArenaActor):
		b.data["last_shover"] = a.seat
		b.data["shoved_at"] = time

	break_idx = 0
	warned = false
	flash_phase = 0.0
	flash_on = false
	capped = false
	prompt_on = false
	spark_t = 0.0
	spark_n = 0
	hum_t = 0.0


# ------------------------------------------------------------------- stage

func _build_room() -> void:
	var deck := Env.mesh(Geo.ring(SHAFT_R, 40, 48), Mats.mat(0xffffff, Tex.concrete(Vector2(10, 10))), 0, 0, 0, {"cast": false})
	deck.rotation.x = -PI / 2
	scene.add_child(deck)
	var lip := Env.mesh(Geo.ring(SHAFT_R, SHAFT_R + 0.7, 48), Mats.mat(0xffffff, Tex.hazard(Vector2(10, 10))), 0, 0.01, 0, {"cast": false})
	lip.rotation.x = -PI / 2
	scene.add_child(lip)
	var back := Env.mesh(Geo.plane(50, 14), Mats.mat(0xffffff, Tex.wall(Vector2(12, 3.5))), 0, 5, -14, {"cast": false})
	scene.add_child(back)
	Env.stencil(scene, "CENTRIFUGE 3", -6, 4.5, -13.9, {"w": 7.0, "h": 2.2, "opacity": 0.55})
	Env.stencil(scene, "DO NOT RIDE", 6, 4.5, -13.9, {"w": 6.0, "h": 2.0, "opacity": 0.55, "color": "#c9a227"})
	Env.pipe(scene, [-25, 7.5, -13.6], [25, 7.5, -13.6], 0.3)
	Env.pipe(scene, [-25, 6.6, -13.7], [25, 6.6, -13.7], 0.14, 0x5a3022)
	# Alarm beacon above the back wall stencil, lit while a ring is failing.
	scene.add_child(Env.mesh(Geo.box(0.5, 0.35, 0.3), Mats.glow(0x5a0c06), 0, 8.4, -13.8, {"cast": false}))
	alarm = Env.point_light(0xff2a10, 0, 30, 1.2)
	alarm.position = Vector3(0, 6, -8)
	scene.add_child(alarm)


func _build_shaft() -> void:
	var wall_mat := Mats.mat(0x4a4a46, Tex.plate(Vector2(16, 20)))
	wall_mat.cull_mode = BaseMaterial3D.CULL_FRONT   # THREE.BackSide: seen from inside
	scene.add_child(Env.mesh(Geo.cyl(SHAFT_R, SHAFT_R, 40, 32, true), wall_mat, 0, -20, 0, {"cast": false}))
	var rib_geo := Geo.torus(SHAFT_R - 0.08, 0.1, 4, 40)
	var rib_mat := Mats.mat(0x6e3f22, Tex.rust())
	for y in [-1.5, -5.0, -9.0, -14.0]:
		var rib := Env.mesh(rib_geo, rib_mat, 0, y, 0, {"cast": false})
		rib.rotation.x = PI / 2
		scene.add_child(rib)
	var lamp_geo := Geo.sphere(0.13, 6, 4)
	var lamp_mat := Mats.glow(0xff7a1a)
	for i in 8:
		var a := float(i) / 8 * TAU
		scene.add_child(Env.mesh(lamp_geo, lamp_mat, cos(a) * (SHAFT_R - 0.12), -3, sin(a) * (SHAFT_R - 0.12), {"cast": false}))
	# Central spindle disappearing into the dark.
	scene.add_child(Env.mesh(Geo.cyl(0.7, 1.0, 40, 10), Mats.mat(0xffffff, Tex.rust(Vector2(1, 8))), 0, -DEPTH - 0.22 - 20, 0, {"cast": false}))
	shaft_light = Env.point_light(0xff5a1a, 26, 22, 1.4)
	shaft_light.position = Vector3(0, -9, 0)
	scene.add_child(shaft_light)


## The turntable: a solid core plus four breakable rings of plates.
func _build_disc() -> void:
	disc = Node3D.new()
	scene.add_child(disc)
	rings = []
	for k in 4:
		var r_out: float = RADII[k] - 0.03
		var r_in: float = RADII[k + 1] + 0.03
		var n: int = SEGMENTS[k]
		var mid := (r_in + r_out) / 2
		# Each ring owns its materials (the emissive flashes before the break).
		var mats := [
			Mats.mat(0xb8b4aa, Tex.plate(), {"emissive": 0x000000}),
			Mats.mat(0x8c8a84, Tex.plate(), {"emissive": 0x000000}),
		]
		var segs := []
		for i in n:
			var m := (i + 0.5) / n * TAU
			# rotation.y = m maps local +X to (cos m, 0, -sin m): the plate sits on that bearing.
			var seg := Props.make("spincycle", "plate_%d" % k)
			_remat(seg, mats[i % 2])
			seg.position = Vector3(cos(m) * mid, 0, -sin(m) * mid)
			seg.rotation.y = m
			disc.add_child(seg)
			segs.append(seg)
		rings.append({"segs": segs, "mats": mats})
	disc.add_child(Props.make("spincycle", "core"))


## Swap the plate model's body material for one of the ring's own.
static func _remat(node: Node, m: Material) -> void:
	if node is MeshInstance3D:
		var mi: MeshInstance3D = node
		if mi.mesh:
			for i in mi.mesh.get_surface_count():
				var src := mi.mesh.surface_get_material(i)
				if src and src.resource_name == PLATE_MAT:
					mi.set_surface_override_material(i, m)
	for c in node.get_children():
		_remat(c, m)


## Static roller arms that grind against the rim (and throw the sparks).
func _build_arms() -> void:
	arms = []
	var arm_mat := Mats.mat(0x6b5a3a, Tex.rust())
	var beam_geo := Geo.box(1, 0.22, 0.35)
	for a in ARM_ANGLES:
		var g := Node3D.new()
		g.rotation.y = -a   # local +X → (cos a, 0, sin a)
		var beam := Env.mesh(beam_geo, arm_mat, 0, -0.17, 0)
		var wheel := Props.make("spincycle", "roller")
		wheel.position.y = -0.17
		var foot := Props.make("spincycle", "arm_foot")
		foot.position = Vector3(SHAFT_R - 0.25, -0.5, 0)
		U.add(g, [beam, wheel, foot])
		scene.add_child(g)
		arms.append({"a": a, "beam": beam, "wheel": wheel})
	_place_arms(0)


# --------------------------------------------------------------- lifecycle

func start() -> void:
	omega = OMEGA0
	hud.banner("SPIN UP", 1200)
	hud.prompt("{MOVE} fight the spin · {B} shove")
	prompt_on = true
	Sfx.play("grind", {"vol": 0.5})


func preview(dt: float) -> void:
	disc.rotation.y += dt * omega
	for s in seats:
		s.subject.animate(dt, 0)
	_animate(dt, false)


func update(dt: float) -> void:
	var playing := state == "play"
	arena.step(dt, playing)

	if playing:
		omega = OMEGA0 + OMEGA_RAMP * time
	else:
		omega = maxf(0.0, omega - dt * (0.8 if capped else 0.3))

	if playing:
		_update_rings(dt)
	elif warned:
		_clear_warning()

	# The disc carries everyone standing on it; while playing it also flings them outward.
	var ang := omega * dt
	var c := cos(ang)
	var s := sin(ang)
	disc.rotation.y = wrapf(disc.rotation.y + ang, -PI, PI)
	var fling := 1.0 + CENTRI * omega * omega * dt if playing else 1.0
	for seat in seats:
		if not seat.alive:
			continue
		var a: ArenaActor = seat.actor
		if a.falling:
			if a.y < -3:
				_fall_kill(seat)
			continue
		var x := a.pos.x
		var z := a.pos.z
		a.pos.x = (x * c + z * s) * fling
		a.pos.z = (-x * s + z * c) * fling
		a.facing = fmod(a.facing + ang, TAU)
		var r := U.hypot(a.pos.x, a.pos.z)
		if playing:
			if r > disc_r + EDGE_SLACK:
				_start_fall(seat, r)
		elif r > disc_r - 0.3:
			# Round over: nobody leaves the disc any more.
			var k := (disc_r - 0.3) / r
			a.pos.x *= k
			a.pos.z *= k
		a.subject.root.position.x = a.pos.x
		a.subject.root.position.z = a.pos.z

	_animate(dt, true)
	if prompt_on and (not playing or time > 5):
		prompt_on = false
		hud.prompt("")
	if not playing:
		return

	# HUD
	var doom_r: float = RADII[break_idx + 1] if warned else INF
	for seat in seats:
		if not seat.alive:
			hud.set_stat(seat, "SPUN OUT")
			hud.set_status(seat, "")
			continue
		var a: ArenaActor = seat.actor
		if a.falling:
			hud.set_stat(seat, "SLIPPING")
			hud.set_status(seat, "")
			continue
		var r := U.hypot(a.pos.x, a.pos.z)
		hud.set_stat(seat, "ON DISC")
		hud.set_status(seat, "GET OFF THE RING" if r > doom_r - 0.1 else ("NEAR EDGE" if r > disc_r - 0.9 else ""))
	hud.set_timer(maxf(0.0, CAP - time))

	if time >= CAP:
		capped = true
		hud.banner("DISC STOPPED", 2000)
		Sfx.play("horn")
		end(3)
		return
	# Wait for anyone mid-fall to reach the bottom before judging.
	if not alive_seats().any(func(st): return st.actor.falling):
		check_last_standing()


# ------------------------------------------------------------------- rings

func _update_rings(dt: float) -> void:
	if break_idx >= BREAK_AT.size():
		return
	var k := break_idx
	var left: float = BREAK_AT[k] - time
	if left > WARN:
		return
	if not warned:
		warned = true
		flash_phase = 0.0
		hud.banner("OUTER RING FAILING", 1500, "danger")
		Sfx.play("buzz")
	# Flash faster as the break approaches; the plates shudder in time.
	flash_phase += dt * (2 + (WARN - left) * 2.5)
	var on := fmod(flash_phase, 1.0) < 0.5
	if on and not flash_on:
		Sfx.play("beep", {"vol": 0.5})
	flash_on = on
	var ring: Dictionary = rings[k]
	for m in ring.mats:
		m.emission = U.col(0x8a1000 if on else 0x000000)
	for seg in ring.segs:
		seg.position.y = -0.035 if on else 0.0
	alarm.light_energy = (40.0 if on else 0.0) * Env.LIGHT_K
	if left <= 0:
		_break_ring(k)


func _clear_warning() -> void:
	if break_idx < rings.size():
		var ring: Dictionary = rings[break_idx]
		for m in ring.mats:
			m.emission = Color.BLACK
		for seg in ring.segs:
			seg.position.y = 0.0
	alarm.light_energy = 0.0
	warned = false
	flash_on = false


## Ring k tears loose: its plates tumble into the shaft, the rim moves in.
func _break_ring(k: int) -> void:
	var ring: Dictionary = rings[k]
	disc_r = RADII[k + 1]
	break_idx += 1
	warned = false
	flash_on = false
	alarm.light_energy = 0.0
	for m in ring.mats:
		m.emission = U.col(0x5a1200)   # still glowing as they fall
	var w := omega
	var segs: Array = ring.segs
	for i in segs.size():
		var seg: Node3D = segs[i]
		seg.position.y = 0.0
		var p := seg.global_position
		var r := U.hypot(p.x, p.z)
		if r == 0.0:
			r = 1.0
		var ox := p.x / r
		var oz := p.z / r
		var out := Rng.rand(0.5, 1.8)
		# Outward kick plus the disc's own tangential speed at that point.
		var vy := Rng.rand(-0.5, 1.5)
		var vel := Vector3(ox * out + w * p.z, vy, oz * out - w * p.x)
		var sx := Rng.rand(-2.5, 2.5)
		var sy := Rng.rand(-1, 1)
		var sz := Rng.rand(-2.5, 2.5)
		fx.add_body(seg, vel, Vector3(sx, sy, sz), {"life": 4.0, "bounce": 0.1, "bleed": false, "radius": 0.3})
		if i % 2 == 0:
			fx.sparks(Vector3(p.x, 0.1, p.z), {"count": 6, "speed": 5.0})
	segs.clear()
	Sfx.play("crunch")
	Sfx.play("metal")
	Sfx.play("explode", {"vol": 0.35})
	if engine:
		engine.shake(0.45)
	hud.banner("CORE ONLY" if break_idx >= BREAK_AT.size() else "RING LOST", 1300, "danger")


# ------------------------------------------------------------------- falls

func _start_fall(seat: Dictionary, r: float) -> void:
	var a: ArenaActor = seat.actor
	a.falling = true
	a.vy = 1.2
	a.knock.x += a.pos.x / r * 1.5
	a.knock.z += a.pos.z / r * 1.5
	a.subject.pose = "armsUp"
	var by = a.data.get("last_shover")
	var recent: bool = time - float(a.data.get("shoved_at", -9.0)) < 2
	a.data["credit_by"] = by if by != null and not is_same(by, seat) and recent else null
	Sfx.play("whoosh", {"vol": 1.1})


func _fall_kill(seat: Dictionary) -> void:
	var a: ArenaActor = seat.actor
	var by = a.data.get("credit_by")
	var dir := Vector3(a.pos.x, 0, a.pos.z)
	if dir.length_squared() < 1e-4:
		dir = Vector3(0, 0, 1)
	if by != null:
		hud.feed("%s sent %s down the shaft" % [by.player.name(), seat.player.name()], by.player.color)
	kill(seat, "fall", {"dir": dir, "quiet": by != null})


# ---------------------------------------------------------------- cosmetics

func _place_arms(dt: float) -> void:
	arm_r += (disc_r - arm_r) * minf(1.0, dt * 3)
	var inner := arm_r + 0.25
	for arm in arms:
		arm.beam.scale.x = SHAFT_R - inner
		arm.beam.position.x = (SHAFT_R + inner) / 2
		arm.wheel.position.x = inner
		arm.wheel.rotation.y = wrapf(arm.wheel.rotation.y - omega * dt * arm_r / 0.25, -PI, PI)


## Purely visual: roller arms, rim sparks, shaft glow, motor hum.
func _animate(dt: float, sound: bool) -> void:
	_place_arms(dt)
	if omega > 0.2:
		spark_t -= dt
		if spark_t <= 0:
			spark_t = 0.25 / omega
			var arm: Dictionary = arms[spark_n % arms.size()]
			spark_n += 1
			fx.sparks(Vector3(cos(arm.a) * disc_r, 0.02, sin(arm.a) * disc_r), {"count": 4, "speed": 4.0})
		if sound:
			hum_t -= dt
			if hum_t <= 0:
				hum_t = 2.4
				Sfx.play("grind", {"vol": 0.12 + omega * 0.12})
	shaft_light.light_energy = (26 + sin(clock * 2.3) * 4) * Env.LIGHT_K


# -------------------------------------------------------------------- bots

func bot_think(seat: Dictionary, dt: float) -> void:
	var a: ArenaActor = seat.actor
	var brain: Dictionary = seat.brain
	var mem: Dictionary = brain.memory
	if a.falling:
		a.ctrl.set_move(0, 0)
		a.ctrl.set_buttons(false, false)
		return
	var skill: float = brain.difficulty
	var my_r := U.hypot(a.pos.x, a.pos.z)
	# The rim the bot plans around: once it notices a warning, the doomed ring no longer counts.
	var safe_r := disc_r
	if warned and time >= BREAK_AT[break_idx] - WARN + brain.reaction * 2.5:
		safe_r = RADII[break_idx + 1]

	mem["think"] = float(mem.get("think", 0.0)) - dt
	if mem.think <= 0:
		mem["think"] = brain.reaction + Rng.rand(0.15, 0.4)
		mem["lazy"] = Rng.random() < brain.error                  # forgets to lean against the spin
		mem["home_r"] = safe_r * Rng.rand(0.05, 0.18 + (1 - skill) * 0.3)
		mem["home_a"] = Rng.rand(0, TAU)
		# Prey: a nearby rival who is further out than we are.
		mem["prey"] = null
		var best := -INF
		for o in seats:
			if is_same(o, seat) or not o.alive or o.actor.falling:
				continue
			var t: ArenaActor = o.actor
			var tr := U.hypot(t.pos.x, t.pos.z)
			var d := U.hypot(t.pos.x - a.pos.x, t.pos.z - a.pos.z)
			if tr < my_r + 0.3 or d > 2.5 + skill * 1.5:
				continue
			var score := tr - d * 0.5
			if score > best:
				best = score
				mem["prey"] = o
		if mem.prey != null and Rng.random() > 0.3 + skill * 0.6:
			mem["prey"] = null

	var tx := 0.0
	var tz := 0.0
	var rush := false
	var want_b := false
	var margin := 0.6 + skill * 0.9
	var prey_seat = mem.get("prey")
	var prey: ArenaActor = prey_seat.actor if prey_seat != null and prey_seat.alive and not prey_seat.actor.falling else null
	if my_r > safe_r - margin:
		rush = true                                               # too close to the rim: back to the hub
	elif prey != null:
		var pr := U.hypot(prey.pos.x, prey.pos.z)
		if pr == 0.0:
			pr = 1e-3
		var ox := prey.pos.x / pr
		var oz := prey.pos.z / pr
		var dx := prey.pos.x - a.pos.x
		var dz := prey.pos.z - a.pos.z
		var d := U.hypot(dx, dz)
		if d == 0.0:
			d = 1e-3
		# Get on the inside of the prey, then drive into them and shove outward.
		var px := prey.pos.x - ox * 0.85
		var pz := prey.pos.z - oz * 0.85
		if d < 1.3 or U.hypot(px - a.pos.x, pz - a.pos.z) < 0.45:
			tx = prey.pos.x
			tz = prey.pos.z
			rush = true
			var fx_ := sin(a.facing)
			var fz := cos(a.facing)
			var facing_it := (fx_ * dx + fz * dz) / d > 0.6
			var outward := (dx * ox + dz * oz) / d > 0.2
			if d < 1.45 and facing_it and outward and a.shove_cd <= 0 and Rng.random() < 0.25 + skill * 0.5:
				want_b = true
		else:
			tx = px
			tz = pz
	else:
		tx = cos(mem.home_a) * mem.home_r
		tz = sin(mem.home_a) * mem.home_r

	var vx := (tx - a.pos.x) * 2.5
	var vz := (tz - a.pos.z) * 2.5
	if rush:
		var l0 := U.hypot(vx, vz)
		if l0 == 0.0:
			l0 = 1.0
		vx = vx / l0 * a.speed
		vz = vz / l0 * a.speed
	# Counter the disc: carry velocity (ω·z, −ω·x) plus centrifugal drift CENTRI·ω²·(x, z).
	var w := omega
	var f := CENTRI * w * w
	var comp: float = 0.15 if mem.lazy else 0.45 + 0.55 * skill
	vx -= (w * a.pos.z + f * a.pos.x) * comp
	vz -= (-w * a.pos.x + f * a.pos.z) * comp
	var mx := vx / a.speed
	var mz := vz / a.speed
	var l := U.hypot(mx, mz)
	if l > 1:
		mx /= l
		mz /= l
	elif l < 0.06:
		mx = 0.0
		mz = 0.0
	a.ctrl.set_move(mx, mz)
	# Buttons are edge-triggered: alternate so repeated intents become fresh presses.
	var press: bool = want_b and not mem.get("b_prev", false)
	a.ctrl.set_buttons(false, press)
	mem["b_prev"] = press


func dispose() -> void:
	for seat in seats:
		seat.actor = null   # break the seat <-> actor reference cycle
		seat.brain.memory.clear()
	super.dispose()

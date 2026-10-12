extends Minigame
## LASER SWEEP — a circular test chamber with an emitter column in the middle
## that sweeps laser beams around like the hands of a very hostile clock.
##
## Rules
##  - Red (low) beams sweep at ankle height: press A to jump over them
##    (0.5 s airtime, 0.9 s between jumps).
##  - Magenta (high) beams sweep at head height: they only burn subjects who
##    are airborne, so never jump into one.
##  - One low beam at first; a high beam joins at 11 s, a second low beam at
##    23 s, and at 36 s the high beam is replaced by a counter-rotating one
##    (max 3 beams). The rotor speeds up the whole time and, from ~17 s on,
##    reverses direction every 7–11 s (announced 1.2 s ahead).
##  - Touching a live beam = burned. New beams flicker harmlessly for 1.4 s
##    before they go live. The emitter column and the chamber wall are solid.
##  - B shoves; a shoved subject cannot jump for 0.75 s.
##  - Last subject standing wins. After 70 s the test ends and every survivor
##    shares first place.
##
## Models (blender/props/lasersweep.py): chamber (wall, rims, catch rail),
## emitter (column + collars), lens (housing riding on every beam).

const META := {
	"id": "lasersweep",
	"title": "LASER SWEEP",
	"tagline": "Ankle-height compliance testing. Head-height consequences.",
	"category": "Survival",
	"controls": [{"input": "move", "label": "Move"}, {"input": "a", "label": "Jump"}, {"input": "b", "label": "Shove"}],
	"objective": "Be the last subject standing.",
	"rules": [
		"Red beams sweep at ankle height. Press {A} to jump over them.",
		"Magenta beams sweep at head height. They only burn subjects in the air.",
		"Beams multiply, speed up and sometimes reverse.",
		"Shoved subjects cannot jump for a moment.",
	],
}

const R := 6.5                 # chamber radius (inner wall)
const COL_R := 0.85            # emitter column radius
const LOW_Y := 0.32            # ankle beam height
const HIGH_Y := 2.4            # head beam height
const AIR := 0.5               # jump airtime (s)
const GRAV := 27.0
const V0 := (GRAV * AIR) / 2   # take-off speed → apex ≈ 0.84
const JUMP_CD := 0.9           # from take-off to the next possible jump
const NO_JUMP := 0.75          # jump lock after being shoved
const LOW_CLEAR := 0.28        # feet higher than this clear a low beam
const HIGH_HIT := 0.4          # feet higher than this put the head into a high beam
const WARM := 1.4              # harmless flicker before a beam goes live
const CAP := 70.0              # hard time cap (s of play)
const LOW_COL := 0xff2a14
const HIGH_COL := 0xff2ee0

## Beam slots: three on the main rotor, one counter-rotating. Read-only.
const BEAM_DEFS := [
	{"kind": "low", "offset": 0.0, "counter": false},
	{"kind": "high", "offset": PI / 2, "counter": false},
	{"kind": "low", "offset": PI, "counter": false},
	{"kind": "high", "offset": 0.0, "counter": true},
]

var arena: Arena
var beams := []
var scorch_geo: Mesh
var scorch_mat: StandardMaterial3D
var band_mat: StandardMaterial3D
var beacon_mat: StandardMaterial3D
var emit_light: OmniLight3D

# Rotor state
var rotor_angle := PI / 2
var counter_angle := 0.0
var rotor_dir := 1.0
var omega := 0.0
var stage := 0
var rev_at := INF
var rev_warned := false
var last_reverse_t := -99.0
var powered_down := false
var _prompt_clear_at := -1.0   # setTimeout(() => prompt(null)) in game time


func build() -> void:
	make_scene({"fog_near": 18.0, "fog_far": 50.0, "ambient_intensity": 0.75})
	make_camera([0, 15, 11.2], [0, 0.4, 0.4], 48)

	_build_chamber()
	_build_emitter()
	_build_beams()

	Env.hanging_lamp(scene, -4.2, 8.5, 1.5, {"intensity": 75.0, "angle": 0.85})
	Env.hanging_lamp(scene, 4.2, 8.5, 1.5, {"intensity": 75.0, "angle": 0.85})

	# Scorch decals left where subjects burned (shared geometry/material).
	scorch_geo = Geo.circle(0.75, 14)
	scorch_mat = Mats.mat(0xffffff, Tex.image("lasersweep-burn", 64, _paint_burn), {"transparent": true, "depth_write": false})

	# --- arena + avatars (circular wall handled in update, column is a solid circle)
	arena = Arena.new({"bounds": {"min_x": -R, "max_x": R, "min_z": -R, "max_z": R}, "shove_force": 11.0})
	arena.add_circle(0, 0, COL_R + 0.05)
	var n := seats.size()
	for i in n:
		var seat: Dictionary = seats[i]
		# Spread around the chamber, never on the first beam's start angle (π/2).
		var ang := PI / 2 + PI / n + (i * TAU) / n
		var x := cos(ang) * 3.7
		var z := sin(ang) * 3.7
		var facing := atan2(-x, -z)
		spawn_subject(seat, {"x": x, "z": z, "facing": facing})
		seat.actor = arena.add(ArenaActor.new({"player": seat.player, "ctrl": seat.ctrl, "subject": seat.subject, "x": x, "z": z}))
		seat.actor.seat = seat
		seat.actor.facing = facing
		var d: Dictionary = seat.actor.data
		d["air"] = -1.0
		d["jump_cd"] = 0.0
		d["no_jump"] = 0.0
		d["last_shover"] = null
		d["shoved_at"] = -99.0
	arena.on_shove = func(a: ArenaActor, b: ArenaActor):
		b.data["last_shover"] = a.seat
		b.data["shoved_at"] = time
		b.data["no_jump"] = NO_JUMP


# ------------------------------------------------------------------- stage

func _build_chamber() -> void:
	Env.floor_plane(scene, 44, 34, {"tex": "concrete", "tile": 3.0, "y": -0.02})
	var disk := Env.mesh(Geo.circle(R + 0.2, 40), Mats.mat(0xffffff, Tex.tiles(Vector2(6, 6))), 0, 0.002, 0, {"cast": false})
	disk.rotation.x = -PI / 2
	scene.add_child(disk)
	# Soot streaks burned into the floor by countless previous calibrations.
	var soot_tex := Tex.canvas("lasersweep-soot", 256, _paint_soot, null, true)
	var soot := Env.mesh(Geo.circle(R, 40), Mats.mat(0xffffff, soot_tex, {"transparent": true, "depth_write": false}), 0, 0.008, 0, {"cast": false})
	soot.rotation.x = -PI / 2
	scene.add_child(soot)
	var band := Env.mesh(Geo.ring(R - 0.4, R, 48), Mats.mat(0xffffff, Tex.hazard(Vector2(12, 1))), 0, 0.015, 0, {"cast": false})
	band.rotation.x = -PI / 2
	scene.add_child(band)
	Env.stencil(scene, "DO NOT LOITER", 0, 0.02, 4.75, {"w": 3.6, "h": 1.0, "opacity": 0.22}).rotation.x = -PI / 2

	# Chamber wall (tall behind, waist-high in front so the camera sees in),
	# rims and the catch rail for the head-height beams: Blender model.
	scene.add_child(Props.make("lasersweep", "chamber"))

	# Back room
	scene.add_child(Env.mesh(Geo.plane(44, 12), Mats.mat(0xffffff, Tex.wall(Vector2(11, 3))), 0, 4, -9.6))
	Env.stencil(scene, "BEAM CALIBRATION", 0, 5.4, -9.5, {"w": 8.0, "h": 1.8, "opacity": 0.5})
	Env.pipe(scene, [-16, 4.4, -9.2], [16, 4.4, -9.2], 0.25)
	Env.pipe(scene, [-16, 3.7, -9.3], [16, 3.7, -9.3], 0.12, 0x5a3022)
	Env.pipe(scene, [0, 3.2, 0], [0, 12, 0], 0.22)   # emitter power conduit


func _build_emitter() -> void:
	scene.add_child(Env.mesh(Geo.cyl(COL_R + 0.3, COL_R + 0.4, 0.18, 20), Mats.mat(0xffffff, Tex.hazard(Vector2(4, 1))), 0, 0.09, 0))
	# Column, collars, hatch and cap: Blender model.
	scene.add_child(Props.make("lasersweep", "emitter"))
	band_mat = Mats.glow(0x5a0a06)
	for y in [1.1, 1.6]:
		scene.add_child(Env.mesh(Geo.cyl(COL_R + 0.02, COL_R + 0.02, 0.08, 20), band_mat, 0, y, 0, {"cast": false}))
	beacon_mat = Mats.glow(LOW_COL)
	scene.add_child(Env.mesh(Geo.sphere(0.3, 10, 6, 0, TAU, 0, PI / 2), beacon_mat, 0, 3.2, 0, {"cast": false}))
	# Red glow on the floor around the emitter (no shadows).
	emit_light = Env.point_light(0xff3020, 6, 9, 1.6)
	emit_light.position = Vector3(0, 1.4, 0)
	scene.add_child(emit_light)


static func _additive(color: int, opacity: float) -> StandardMaterial3D:
	return Mats.glow(color, {"opacity": opacity, "additive": true, "depth_write": false})


func _build_beams() -> void:
	var length := R - COL_R + 0.12
	var core_geo := Geo.cyl(0.035, 0.035, length, 6, true)
	var glow_geo := Geo.cyl(0.13, 0.13, length, 8, true)
	var stripe_geo := Geo.plane(length, 0.3)
	var flare_geo := Geo.sphere(0.2, 8, 6)
	var mats := {
		"low": {"core": Mats.glow(0xffd8cc), "glow": _additive(LOW_COL, 0.5), "stripe": _additive(LOW_COL, 0.28), "flare": _additive(0xff7a50, 0.8)},
		"high": {"core": Mats.glow(0xffd8f8), "glow": _additive(HIGH_COL, 0.5), "stripe": _additive(HIGH_COL, 0.22), "flare": _additive(0xff90f0, 0.8)},
	}
	var fx_opts := {"cast": false}
	var mid := COL_R + length / 2
	for def in BEAM_DEFS:
		var m: Dictionary = mats[def.kind]
		var y := LOW_Y if def.kind == "low" else HIGH_Y
		var g := Node3D.new()
		g.position.y = y
		# Cylinders lie along local +X from the column surface to the wall.
		var core := Env.mesh(core_geo, m.core, mid, 0, 0, fx_opts)
		core.rotation.z = PI / 2
		var glow_mesh := Env.mesh(glow_geo, m.glow, mid, 0, 0, fx_opts)
		glow_mesh.rotation.z = PI / 2
		var stripe := Env.mesh(stripe_geo, m.stripe, mid, 0.022 - y, 0, fx_opts)   # floor guide line under the beam
		stripe.rotation.x = -PI / 2
		var flare := Env.mesh(flare_geo, m.flare, R - 0.02, 0, 0, fx_opts)
		var lens := Props.make("lasersweep", "lens")
		lens.position = Vector3(COL_R + 0.05, 0, 0)
		U.add(g, [core, glow_mesh, stripe, flare, lens])
		g.visible = false
		scene.add_child(g)
		beams.append({
			"kind": def.kind, "offset": def.offset, "counter": def.counter, "y": y,
			"g": g, "core": core, "glow": glow_mesh, "stripe": stripe, "flare": flare,
			"state": "off", "t": 0.0, "angle": 0.0, "prev_angle": 0.0, "w": 0.0,
		})


# --------------------------------------------------------------- lifecycle

func start() -> void:
	# Reset everything the cosmetic preview touched so all devices start identical.
	rotor_angle = PI / 2
	counter_angle = 0.0
	omega = 0.0
	rotor_dir = 1.0 if Rng.random() < 0.5 else -1.0
	for b in beams:
		b.state = "off"
		b.t = 0.0
		b.angle = counter_angle if b.counter else rotor_angle + b.offset
		b.prev_angle = b.angle
		b.w = 0.0
		_render_beam(b)
	_set_beam(beams[0], "warm")
	stage = 0
	rev_at = 17 + Rng.rand(0, 3)
	rev_warned = false
	last_reverse_t = -99.0
	hud.banner("BEAM ONLINE", 1200, "danger")
	hud.prompt("{A} jump over red · {B} shove")
	_prompt_clear_at = time + 4.0


func preview(dt: float) -> void:
	for s in seats:
		s.subject.animate(dt, 0)
	# Cosmetic demo: the first beam idles round the chamber.
	rotor_angle += dt * 0.7
	var b: Dictionary = beams[0]
	b.state = "on"
	b.angle = rotor_angle
	b.prev_angle = rotor_angle
	_render_beam(b)
	_animate_emitter()


# ------------------------------------------------------------------- beams

func _set_beam(b: Dictionary, st: String) -> void:
	b.state = st
	b.t = WARM if st == "warm" else 0.0
	if st == "warm":
		Sfx.play("beep", {"vol": 0.4})


func _update_beams(dt: float, playing: bool) -> void:
	if playing:
		var target := minf(2.7, 1.25 + 0.021 * time)
		# The rotor holds still while the first beam warms up, then runs at full
		# speed (no ease-in: a constant speed keeps arrival predictions honest).
		omega = 0.0 if time < WARM else target
	else:
		omega *= exp(-2.5 * dt)
	var w := rotor_dir * omega
	var cw := -rotor_dir * omega * 0.7
	rotor_angle += w * dt
	counter_angle += cw * dt
	for b in beams:
		b.prev_angle = b.angle
		b.angle = counter_angle if b.counter else rotor_angle + b.offset
		b.w = cw if b.counter else w
		if b.state == "warm":
			b.t -= dt
			if b.t <= 0:
				b.state = "on"
				b.t = 0.0
				Sfx.play("burn", {"vol": 0.35})
		_render_beam(b)


func _render_beam(b: Dictionary) -> void:
	var g: Node3D = b.g
	g.visible = b.state != "off"
	if not g.visible:
		return
	g.rotation.y = -b.angle   # local +X → (cos θ, 0, sin θ)
	var on: bool = b.state == "on"
	var flick: bool = fmod(clock * 17 + b.y + b.offset, 1.0) < 0.25 + 0.6 * (1.0 - b.t / WARM)
	b.core.visible = on
	b.flare.visible = on
	b.glow.visible = on or flick
	b.stripe.visible = on or flick
	var pulse := 1.0 + sin(clock * 31 + b.offset * 3) * 0.12
	b.glow.scale = Vector3(pulse, 1, pulse)   # thickness (the glow mesh is rotated onto X)


func _animate_emitter() -> void:
	var warn := state == "play" and rev_warned
	var live := false
	for b in beams:
		if b.state == "on":
			live = true
	var blink := fmod(clock * 8, 1.0) < 0.5 if warn else fmod(clock * 1.5, 1.0) < 0.5
	Mats.set_color(beacon_mat, ((0xffb020 if warn else LOW_COL) if blink else 0x3a0806))
	Mats.set_color(band_mat, ((0xffb020 if warn and blink else 0xc81a0c) if live else 0x3a0806))
	emit_light.light_energy = ((7.0 if live else 2.5) + sin(clock * 23) * 0.8) * Env.LIGHT_K


## Seconds until a beam of `kind` reaches world angle `phi` (INF if none).
## `flipped` assumes the opposite rotation (a bot that has not noticed a reversal yet).
## `self_w` is the observer's own angular velocity (rad/s): the beam closes in
## at the relative rate. Warm beams count only if they will be live by the time
## they arrive; 'off' slots are ignored.
func _arrival(phi: float, kind: String, flipped: bool = false, self_w: float = 0.0) -> float:
	var best := INF
	for b in beams:
		if b.kind != kind or b.state == "off":
			continue
		var w: float = (-b.w if flipped else b.w) - self_w
		if absf(w) < 0.05:
			continue
		var d := U.angle_diff(b.angle, phi)
		var t: float
		if w > 0:
			t = (d if d >= 0 else d + TAU) / w
		else:
			t = (-d if d <= 0 else TAU - d) / -w
		if b.state == "warm" and t < b.t:
			continue
		if t < best:
			best = t
	return best


# -------------------------------------------------------------- subjects

func _update_jumps(dt: float, input: bool) -> void:
	for seat in seats:
		if not seat.alive:
			continue
		var a: ArenaActor = seat.actor
		var d: Dictionary = a.data
		d.jump_cd = maxf(0.0, d.jump_cd - dt)
		d.no_jump = maxf(0.0, d.no_jump - dt)
		if d.air >= 0:
			d.air += dt
			if d.air >= AIR:
				d.air = -1.0
				a.y = 0.0
				Sfx.play("step", {"vol": 0.8})
			else:
				a.y = V0 * d.air - 0.5 * GRAV * d.air * d.air
		elif input and a.ctrl.a_pressed and d.jump_cd <= 0 and d.no_jump <= 0 and a.stun <= 0:
			d.air = 0.0
			d.jump_cd = JUMP_CD
			a.y = 0.0
			Sfx.play("whoosh", {"vol": 0.25})


## Tuck legs and flail arms while airborne (after the arena's walk animation).
func _pose_airborne() -> void:
	for seat in seats:
		if not seat.alive or seat.actor.data.air < 0:
			continue
		var s := sin(PI * minf(1.0, seat.actor.data.air / AIR))
		var p: Dictionary = seat.subject.parts
		p.legL.rotation.x = -0.9 * s
		p.legR.rotation.x = -0.4 * s
		p.armL.rotation.z = -0.8 * s
		p.armR.rotation.z = 0.8 * s


func _burn(seat: Dictionary, beam: Dictionary) -> void:
	var a: ArenaActor = seat.actor
	var phi := atan2(a.pos.z, a.pos.x)
	var s := 1.0 if beam.w >= 0 else -1.0
	var dir := Vector3(-sin(phi) * s, 0, cos(phi) * s)
	var by = a.data.last_shover if a.data.last_shover != null and time - a.data.shoved_at < 1.6 else null
	var hit_pos := Vector3(a.pos.x, beam.y, a.pos.z)
	var x := a.pos.x
	var z := a.pos.z
	kill(seat, "burn", {"dir": dir, "force": 1.0})
	fx.sparks(hit_pos, {"color": 0xff6a3a if beam.kind == "low" else 0xff70f0, "count": 14, "speed": 5.0})
	var mark := Env.mesh(scorch_geo, scorch_mat, x, 0.018, z, {"cast": false})
	mark.rotation = Vector3(-PI / 2, 0, x * 3.1 + z * 1.7)
	scene.add_child(mark)
	if by != null and not is_same(by, seat):
		hud.feed("%s tripped %s into a beam" % [by.player.name(), seat.player.name()], by.player.color)


# ------------------------------------------------------------------ update

func update(dt: float) -> void:
	var playing := state == "play"
	_update_jumps(dt, playing)
	arena.step(dt, playing)
	# Circular chamber wall.
	for a in arena.actors:
		if not a.alive:
			continue
		var r := U.hypot(a.pos.x, a.pos.z)
		var mx: float = R - a.radius
		if r > mx:
			a.pos.x *= mx / r
			a.pos.z *= mx / r
			a.subject.root.position.x = a.pos.x
			a.subject.root.position.z = a.pos.z
	_pose_airborne()

	if not playing and not powered_down:
		# Test concluded: the emitter powers down.
		powered_down = true
		for b in beams:
			b.state = "off"
		Sfx.play("buzz", {"vol": 0.4})
	_update_beams(dt, playing)
	_animate_emitter()
	if _prompt_clear_at >= 0.0 and time >= _prompt_clear_at:
		_prompt_clear_at = -1.0
		hud.prompt("")
	if not playing:
		return

	_schedule()

	# Lethal contact: did a live beam sweep across a subject this tick?
	for seat in alive_seats():
		var a: ArenaActor = seat.actor
		var r := U.hypot(a.pos.x, a.pos.z)
		if r < 0.2:
			continue
		var phi := atan2(a.pos.z, a.pos.x)
		var hw := minf(0.6, (a.radius * 0.7 + 0.06) / r)
		for b in beams:
			if b.state != "on":
				continue
			if (a.y >= LOW_CLEAR) if b.kind == "low" else (a.y <= HIGH_HIT):
				continue
			var sweep: float = b.angle - b.prev_angle
			var rel := U.angle_diff(b.prev_angle, phi)
			var hit := (rel >= -hw and rel <= sweep + hw) if sweep >= 0 else (rel <= hw and rel >= sweep - hw)
			if hit:
				_burn(seat, b)
				break

	for seat in seats:
		if not seat.alive:
			hud.set_stat(seat, "CAUTERIZED")
			hud.set_status(seat, "")
			continue
		hud.set_stat(seat, "ALIVE")
		hud.set_status(seat, "GROUNDED" if seat.actor.data.no_jump > 0 else "")
	hud.set_timer(maxf(0.0, CAP - time))
	if time >= CAP:
		hud.banner("TIME UP", 1600)
		end()
		return
	check_last_standing()


## Escalation timeline + direction reversals.
func _schedule() -> void:
	var t := time
	if stage == 0 and t >= 11:
		stage = 1
		_set_beam(beams[1], "warm")
		hud.banner("HIGH BEAM ONLINE", 1400, "danger")
		hud.prompt("Magenta burns the airborne — stay down")
		_prompt_clear_at = t + 4.5
	elif stage == 1 and t >= 23:
		stage = 2
		_set_beam(beams[2], "warm")
		hud.banner("THIRD BEAM ONLINE", 1400, "danger")
	elif stage == 2 and t >= 36:
		stage = 3
		# The rotor's high beam retires; a counter-rotating one takes over from the same spot.
		_set_beam(beams[1], "off")
		var c: Dictionary = beams[3]
		counter_angle = rotor_angle + PI / 2
		c.angle = counter_angle
		c.prev_angle = counter_angle
		_set_beam(c, "warm")
		hud.banner("COUNTER-ROTATION", 1400, "danger")
		Sfx.play("grind", {"vol": 0.5})

	if not rev_warned and t >= rev_at - 1.2:
		rev_warned = true
		hud.banner("REVERSING", 1100, "danger")
		Sfx.play("buzz", {"vol": 0.6})
	if t >= rev_at:
		rotor_dir *= -1
		last_reverse_t = t
		rev_at = t + Rng.rand(7, 11)
		rev_warned = false
		Sfx.play("clank", {"vol": 0.6})
		engine.shake(0.15)


# -------------------------------------------------------------------- bots

## Roll how a bot will handle the next approaching low beam.
func _new_plan(brain: Dictionary) -> void:
	var blunder: bool = Rng.random() < brain.error * 0.35
	var lead: float
	if blunder:
		lead = Rng.rand(0.55, 0.8) if Rng.random() < 0.5 else Rng.rand(-0.1, 0.03)   # way too early / too late
	else:
		# ~2 ticks pass between the decision and take-off (input commit latency).
		lead = 0.24 + (brain.reaction - 0.2) * 0.25 + Rng.rand(-1, 1) * brain.error * 0.35
	brain.memory["plan"] = {
		"lead": lead,
		"jumped": false,
		"respect_high": brain.difficulty >= 0.85 or Rng.random() < 0.3 + brain.difficulty * 0.65,
		"smart": Rng.random() < 0.2 + brain.difficulty * 0.8,   # sidesteps low/high crossings
		"hunt": Rng.random() < brain.difficulty * 0.6,          # stalks rivals to shove them
	}


func bot_think(seat: Dictionary, dt: float) -> void:
	var a: ArenaActor = seat.actor
	var brain: Dictionary = seat.brain
	var mem: Dictionary = brain.memory
	var d: Dictionary = a.data
	if not mem.has("home_r"):
		mem["home_r"] = 3.5 + Rng.rand(-0.5, 0.6)
		mem["drift"] = Rng.rand(-0.5, 0.5)
		mem["drift_t"] = Rng.rand(2, 4)
		mem["last_t_low"] = INF
		mem["a_prev"] = false
		mem["b_prev"] = false
		_new_plan(brain)
	mem["drift_t"] = mem.drift_t - dt
	if mem.drift_t <= 0:
		mem["drift"] = Rng.rand(-0.6, 0.6)
		mem["drift_t"] = Rng.rand(2, 5)

	var r := U.hypot(a.pos.x, a.pos.z)
	if r == 0.0:
		r = 0.01
	var phi := atan2(a.pos.z, a.pos.x)
	# Right after a reversal a bot keeps predicting the old direction for `reaction` seconds.
	var stale: bool = time - last_reverse_t < brain.reaction
	# Own angular velocity: running toward a beam makes it arrive sooner.
	var self_w := (-sin(phi) * a.vel.x + cos(phi) * a.vel.z) / r
	var t_low := _arrival(phi, "low", stale, self_w)
	var t_high := _arrival(phi, "high", stale, self_w)
	if t_low > mem.last_t_low + 0.25:
		_new_plan(brain)   # previous beam passed: next pass
	mem["last_t_low"] = t_low
	var plan: Dictionary = mem.plan

	# --- jump timing
	var can_jump: bool = d.air < 0 and d.jump_cd <= 0 and d.no_jump <= 0 and a.stun <= 0
	var want_a: bool = can_jump and not plan.jumped and t_low <= plan.lead and (not plan.respect_high or t_high > 0.5)

	# --- movement: hold mid-radius, drift slowly, keep personal space
	var dphi: float = mem.drift * 0.3
	if plan.smart and t_low < 2.5 and absf(t_low - t_high) < 0.65:
		# A low and a high beam will cross here: step to whichever side separates them more.
		var step := 1.4 / r
		var best_score := absf(t_low - t_high)
		for o in [step, -step]:
			var sc := absf(_arrival(phi + o, "low", stale) - _arrival(phi + o, "high", stale))
			if sc > best_score + 0.1:
				best_score = sc
				dphi = o
	var tx: float = cos(phi + dphi) * mem.home_r
	var tz: float = sin(phi + dphi) * mem.home_r
	for o in arena.actors:
		if o == a or not o.alive:
			continue
		var dx: float = a.pos.x - o.pos.x
		var dz: float = a.pos.z - o.pos.z
		var dd := U.hypot(dx, dz)
		if dd < 1.6 and dd > 0.01:
			tx += (dx / dd) * (1.6 - dd) * 1.2
			tz += (dz / dd) * (1.6 - dd) * 1.2

	# --- shove a rival just before a low beam reaches them (they cannot jump then)
	var want_b := false
	var hunt = null
	var n = AI.nearest(a, arena.actors)
	if n != null:
		var t: ArenaActor = n.actor
		var tt := _arrival(atan2(t.pos.z, t.pos.x), "low", stale)
		if n.dist < 1.45 and a.shove_cd <= 0 and tt > 0.12 and tt < 0.6 and t_low > 0.75 and Rng.random() < brain.difficulty * 0.35:
			want_b = true
			var dx := t.pos.x - a.pos.x
			var dz := t.pos.z - a.pos.z
			var dd := U.hypot(dx, dz)
			if dd == 0.0:
				dd = 1.0
			a.ctrl.set_move((dx / dd) * 0.4, (dz / dd) * 0.4)
			a.facing = atan2(dx, dz)
		elif plan.hunt and n.dist < 3.2 and tt > 0.6 and tt < 1.8 and t_low > 1.0:
			hunt = t
	if not want_b:
		# Plant the feet while a low beam closes in, so the timing stays readable.
		if t_low < 0.55 and d.air < 0:
			a.ctrl.set_move(0, 0)
		elif hunt != null:
			AI.steer_to(a, hunt.pos.x, hunt.pos.z, {"arrive": 0.9})
		else:
			AI.steer_to(a, tx, tz, {"arrive": 0.3, "slow": 3.0})

	# Buttons are edge-triggered: never hold them two frames in a row.
	var pa: bool = want_a and not mem.a_prev
	var pb: bool = want_b and not mem.b_prev
	if pa:
		plan.jumped = true
	a.ctrl.set_buttons(pa, pb)
	mem["a_prev"] = pa
	mem["b_prev"] = pb


# ------------------------------------------------------------ texture helpers

## Radial soot streaks and char blotches (transparent overlay for the chamber floor).
static func _paint_soot(ci: CanvasItem, s: float) -> void:
	var cx := s / 2
	for i in 160:
		var a := randf() * TAU
		var r0 := cx * (0.12 + randf() * 0.3)
		var r1 := cx * (0.55 + randf() * 0.42)
		ci.draw_line(Vector2(cx + cos(a) * r0, cx + sin(a) * r0), Vector2(cx + cos(a) * r1, cx + sin(a) * r1),
			Color(12 / 255.0, 8 / 255.0, 6 / 255.0, 0.05 + randf() * 0.13), 1.0 + randf() * 3.0)
	for i in 24:
		var a := randf() * TAU
		var rr := cx * (0.2 + randf() * 0.7)
		var x := cx + cos(a) * rr
		var y := cx + sin(a) * rr
		var br := 6.0 + randf() * 18.0
		var alpha := 0.25 + randf() * 0.35
		# Radial gradient → stacked discs, densest in the middle.
		for k in 8:
			ci.draw_circle(Vector2(x, y), br * (1.0 - k / 8.0), Color(8 / 255.0, 5 / 255.0, 3 / 255.0, alpha / 6.0))
	# A dark ring where the ankle beams graze the floor most.
	ci.draw_arc(Vector2(cx, cx), cx * 0.55, 0, TAU, 96, Color(10 / 255.0, 6 / 255.0, 4 / 255.0, 0.18), 10.0)


## Charred scorch mark left where a subject burned (radial gradient + speckles).
static func _paint_burn(img: Image, s: int) -> void:
	var stops := [[0.0, Color(5 / 255.0, 3 / 255.0, 2 / 255.0, 0.92)], [0.55, Color(22 / 255.0, 10 / 255.0, 4 / 255.0, 0.6)], [1.0, Color(0, 0, 0, 0)]]
	for y in s:
		for x in s:
			var d := Vector2(x + 0.5 - s / 2.0, y + 0.5 - s / 2.0).length() / (s / 2.0)
			var c: Color = stops[2][1]
			if d < 0.55:
				c = (stops[0][1] as Color).lerp(stops[1][1], d / 0.55)
			elif d < 1.0:
				c = (stops[1][1] as Color).lerp(stops[2][1], (d - 0.55) / 0.45)
			img.set_pixel(x, y, c)
	for i in 40:
		var px := randi_range(0, s - 2)
		var py := randi_range(0, s - 2)
		var k := randf() * 0.5
		for oy in 2:
			for ox in 2:
				var c := img.get_pixel(px + ox, py + oy)
				var na := k + c.a * (1.0 - k)
				var rgb := Color(c.r, c.g, c.b) * (c.a * (1.0 - k) / maxf(na, 0.001))
				img.set_pixel(px + ox, py + oy, Color(rgb.r, rgb.g, rgb.b, na))


func dispose() -> void:
	for seat in seats:
		seat.actor = null   # break the seat <-> actor reference cycle
	super.dispose()

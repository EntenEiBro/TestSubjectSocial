extends Minigame
## CHAIR PROTOCOL — lethal musical chairs in a padded-cell conference room.
##
## Rules
##  - A ring of folding chairs stands in the middle of the room: always one
##    fewer chair than living subjects.
##  - MUSIC: a looping beep-tune plays for a hidden 4–9 s. The chairs are
##    electrified (blue glow). Touching one zaps you: ~1 s stun + knockback.
##  - SIT!: the music stops, the lights flash and the chairs turn safe
##    (green). Reach a free chair and press A to sit. One subject per chair.
##    A shove (B) on a seated subject knocks them off their chair.
##  - 3 s after the music stops, everyone still standing drops through a
##    trapdoor ('fall'). Then a chair sinks into the floor and the next round
##    starts (the tune gets a little faster each round).
##  - Last subject alive wins. Simultaneous drops share a place. Safety cap
##    at 75 s: survivors rank seated first, then standing.
## Chair, loudspeaker and junction box models: blender/props/chairs.py.

const META := {
	"id": "chairs",
	"title": "CHAIR PROTOCOL",
	"tagline": "Please be seated. Standing is a terminal offence.",
	"category": "Reflex",
	"controls": [{"input": "move", "label": "Move"}, {"input": "a", "label": "Sit down"}, {"input": "b", "label": "Shove"}],
	"objective": "Be seated every time the music stops.",
	"rules": [
		"While the music plays the chairs are electrified. Touching one stuns you.",
		"When it stops, reach a free chair and press {A} to sit. One subject per chair.",
		"Whoever is still standing drops through a trapdoor. Then a chair is removed.",
		"Shove ({B}) rivals into live chairs — or off a seat.",
	],
}

const HALF_W := 7.0          # walkable room half-extents
const HALF_D := 4.8
const CHAIR_R := 0.36        # chair collision radius
const TOUCH := 0.06          # extra reach that still counts as touching a live chair
const SIT_REACH := 1.1       # max distance (centre to centre) to sit on a chair
const SIT_DROP := 0.4        # how far a seated subject's root is lowered
const ZAP_TIME := 1.0        # stun from a live chair
const ZAP_GRACE := 0.9       # chairs need a moment to charge when the music starts
const SIT_TIME := 3.0        # music stop → trapdoors
const HANG := 0.45           # victims dangle over the open hatch this long
const DROP_TIME := 1.8       # trapdoor phase length
const RESET_TIME := 2.0      # chair removal / rearrangement
const CAP := 75.0            # hard time cap (s of play)
const STEP_BASE := 0.2       # seconds per music step
const TRAP_HALF := 0.55      # trapdoor half-size
const SPAWN_R := 3.3
const COLORS := {"live": 0x4aa8ff, "safe": 0x45ff6a, "drop": 0xff3020}

## The tune: 16 steps, each a list of [sfx name, volume].
const PATTERN := [
	[["thud", 0.7], ["beep", 0.22]], [["tick", 0.5]], [["select", 0.2]], [["tick", 0.5]],
	[["thud", 0.7], ["fork", 0.5]], [["click", 0.7]], [["beep", 0.22]], [["tick", 0.5]],
	[["thud", 0.7], ["ding", 0.12]], [["tick", 0.5]], [["select", 0.2]], [["click", 0.7]],
	[["thud", 0.7], ["fork", 0.5]], [["beep", 0.22]], [["select", 0.2]], [["spider", 0.35]],
]

var arena: Arena
var traps := []          # read by _floor_at (debris falls through open hatches)
var chairs := []
var cones := []
var lamps := []
var ring_light: OmniLight3D
var air_mat: StandardMaterial3D
var frame_mat: StandardMaterial3D
var pad_mat: StandardMaterial3D
var halo_mat: StandardMaterial3D
var hatch_mat: StandardMaterial3D

var phase := "music"
var phase_t := 0.0
var phase_id := 0
var round_n := 1
var music_dur := 6.0
var step_len := STEP_BASE
var beat_t := 0.0
var beat_idx := 0
var beat_pulse := 0.0
var mode := "live"       # chair / light look: "live" | "safe" | "drop" | "off"
var flash_t := 0.0
var arc_t := 0.5
var move_t := 0.0
var _pv_beat := -1
var _prompt_off_at := -1.0   # JS: setTimeout(5000) hides the opening prompt


## Chair positions for `k` chairs: a ring, each chair facing outward.
static func chair_layout(k: int) -> Array:
	if k <= 1:
		return [{"x": 0.0, "z": 0.0, "f": 0.0}]
	var r := 1.25 if k == 2 else 1.55
	var out := []
	for i in k:
		var th := (0.0 if k == 2 else -PI / 2) + float(i) / k * TAU
		var x := cos(th) * r
		var z := sin(th) * r
		out.append({"x": x, "z": z, "f": atan2(x, z)})
	return out


func build() -> void:
	traps = []
	make_scene({"fog_near": 18.0, "fog_far": 46.0, "ambient_intensity": 0.85, "floor_at": _floor_at})
	make_camera([0, 13, 10.2], [0, 0, 0.3], 46)

	# --- room
	Env.room(scene, HALF_W * 2 + 0.6, HALF_D * 2 + 0.6, 4, {"floor_tex": "plate", "tile": 2.0, "open": ["south"]})
	var disc := Env.mesh(Geo.circle(2.55, 32), Mats.mat(0xffffff, Tex.tiles(Vector2(3, 3))), 0, 0.008, 0, {"cast": false})
	disc.rotation.x = -PI / 2
	scene.add_child(disc)
	var band := Env.mesh(Geo.ring(2.55, 2.85, 40), Mats.mat(0xffffff, Tex.hazard(Vector2(12, 1))), 0, 0.012, 0, {"cast": false})
	band.rotation.x = -PI / 2
	scene.add_child(band)
	Env.stencil(scene, "PLEASE BE SEATED", 0, 2.75, -HALF_D - 0.13, {"w": 7.0, "h": 1.6, "opacity": 0.6})
	Env.stencil(scene, "MANDATORY FUN", -4.6, 1.5, -HALF_D - 0.13, {"w": 3.2, "h": 1.0, "opacity": 0.4})
	Env.stencil(scene, "HIGH VOLTAGE", 0, 0.02, 3.9, {"w": 4.4, "h": 1.2, "opacity": 0.28}).rotation.x = -PI / 2
	Env.pipe(scene, [-HALF_W - 0.3, 3.6, -HALF_D - 0.05], [HALF_W + 0.3, 3.6, -HALF_D - 0.05], 0.1)

	# Junction box + floor cable feeding the chairs.
	var box := Props.make("chairs", "junction")
	box.position = Vector3(0, 0.75, -HALF_D + 0.05)
	scene.add_child(box)
	Env.block(scene, 0, 0.025, (-HALF_D - 2.85) / 2, 0.12, 0.05, HALF_D - 2.85, Mats.mat(0x1c1c1a))

	# Wall loudspeakers with an ON AIR lamp.
	air_mat = Mats.glow(0x2a0606)
	cones = []
	for sx in [-1.0, 1.0]:
		var x: float = sx * 4.9
		var cab := Props.make("chairs", "speaker")
		cab.position = Vector3(x, 2.9, -HALF_D - 0.05)
		scene.add_child(cab)
		var cone := Props.make("chairs", "speaker_cone")
		cone.position = Vector3(x, 2.8, -HALF_D + 0.26)
		cone.rotation.x = PI / 2   # wide end toward the room
		scene.add_child(cone)
		cones.append(cone)
		scene.add_child(Env.mesh(Geo.box(0.4, 0.12, 0.05), air_mat, x, 3.45, -HALF_D + 0.17, {"cast": false}))

	var lamp_a := Env.hanging_lamp(scene, -3.2, 7, 0, {"intensity": 80.0, "angle": 0.95})
	var lamp_b := Env.hanging_lamp(scene, 3.2, 7, 0, {"intensity": 80.0, "angle": 0.95})
	lamps = [lamp_a.light, lamp_b.light]
	ring_light = Env.point_light(COLORS.live, 0.0, 7.0, 1.5)
	ring_light.position = Vector3(0, 1.6, 0)
	scene.add_child(ring_light)

	# --- arena
	arena = Arena.new({"bounds": {"min_x": -HALF_W, "max_x": HALF_W, "min_z": -HALF_D, "max_z": HALF_D}, "shove_force": 12.0})
	arena.add_wall(-0.4, 0.4, -HALF_D - 0.5, -HALF_D + 0.23)   # junction box

	# --- chairs (shared materials; emissive shows the current)
	frame_mat = Mats.mat(0x9a9e98, Tex.metal(), {"emissive": 0x000000, "emissive_intensity": 0.0})
	pad_mat = Mats.mat(0x6a2a22, Tex.fabric(), {"emissive": 0x000000, "emissive_intensity": 0.0})
	halo_mat = Mats.glow(COLORS.live, {"opacity": 0.3, "depth_write": false})
	hatch_mat = Mats.glow(0x030303)
	var n := seats.size()
	var k := maxi(1, n - 1)
	chairs = []
	for p in chair_layout(k):
		var ch := _build_chair()
		_place_chair(ch, p.x, p.z, p.f)
		chairs.append(ch)

	# --- trapdoors (one per seat, opened under whoever is left standing)
	var hole_geo := Geo.plane(TRAP_HALF * 2, TRAP_HALF * 2)
	var hole_mat := Mats.glow(0x020202)
	var flap_geo := Geo.box(TRAP_HALF, 0.04, TRAP_HALF * 2)
	var flap_mat := Mats.mat(0xffffff, Tex.hazard(Vector2(1, 2)))

	# --- avatars
	for i in n:
		var seat: Dictionary = seats[i]
		var th := float(i) / n * TAU + PI / 4
		var x := cos(th) * SPAWN_R
		var z := sin(th) * SPAWN_R
		var facing := atan2(-x, -z)
		spawn_subject(seat, {"x": x, "z": z, "facing": facing})
		seat.actor = arena.add(ArenaActor.new({"player": seat.player, "ctrl": seat.ctrl, "subject": seat.subject, "x": x, "z": z}))
		seat.actor.facing = facing
		seat.actor.seat = seat

		var g := Node3D.new()
		var hole := Env.mesh(hole_geo, hole_mat, 0, 0.02, 0, {"cast": false})
		hole.rotation.x = -PI / 2
		g.add_child(hole)
		var flaps := []
		for side in [-1.0, 1.0]:
			var pivot := Node3D.new()
			pivot.position = Vector3(side * TRAP_HALF, 0.024, 0)
			pivot.add_child(Env.mesh(flap_geo, flap_mat, -side * TRAP_HALF / 2, 0, 0, {"cast": false}))
			g.add_child(pivot)
			flaps.append({"pivot": pivot, "side": side})
		g.visible = false
		scene.add_child(g)
		var trap := {"g": g, "flaps": flaps, "k": 0.0, "open": false, "x": 0.0, "z": 0.0}
		traps.append(trap)
		seat["chair"] = null
		seat["zap"] = 0.0
		seat["zap_imm"] = 0.0
		seat["hang"] = -1.0
		seat["trap"] = trap
	arena.on_shove = func(att: ArenaActor, vic: ArenaActor): _on_shove(att, vic)

	phase = "music"
	phase_t = 0.0
	phase_id = 0
	round_n = 1
	music_dur = 6.0
	step_len = STEP_BASE
	beat_t = 0.0
	beat_idx = 0
	beat_pulse = 0.0
	mode = "live"
	flash_t = 0.0
	arc_t = 0.5
	move_t = 0.0
	_pv_beat = -1


## One folding chair (sitter faces local +Z) with a floor halo and a removal hatch.
func _build_chair() -> Dictionary:
	var g := Node3D.new()
	g.rotation_order = EULER_ORDER_XYZ
	var model := Props.make("chairs", "chair")
	_remat(model, {"m_metal_9a9e98": frame_mat, "m_fabric_6a2a22": pad_mat})
	g.add_child(model)
	var halo := Env.mesh(Geo.circle(0.62, 20), halo_mat, 0, 0.016, 0, {"cast": false})
	halo.rotation.x = -PI / 2
	g.add_child(halo)
	scene.add_child(g)
	var hatch := Env.mesh(Geo.plane(0.9, 0.9), hatch_mat, 0, 0.021, 0, {"cast": false})
	hatch.rotation.x = -PI / 2
	hatch.visible = false
	scene.add_child(hatch)
	return {"g": g, "halo": halo, "hatch": hatch, "x": 0.0, "z": 0.0, "f": 0.0, "fx": 0.0, "fz": 0.0, "ff": 0.0,
		"tx": 0.0, "tz": 0.0, "tf": 0.0, "active": true, "removing": false, "sink": 0.0, "occupant": null}


## Swap a prop's (shared) Blender materials for this round's own instances.
static func _remat(node: Node, by_name: Dictionary) -> void:
	if node is MeshInstance3D:
		var mi: MeshInstance3D = node
		if mi.mesh:
			for i in mi.mesh.get_surface_count():
				var src := mi.mesh.surface_get_material(i)
				if src and by_name.has(src.resource_name):
					mi.set_surface_override_material(i, by_name[src.resource_name])
	for c in node.get_children():
		_remat(c, by_name)


func _place_chair(ch: Dictionary, x: float, z: float, f: float) -> void:
	ch.x = x
	ch.z = z
	ch.f = f
	var g: Node3D = ch.g
	g.position = Vector3(x, g.position.y, z)
	g.rotation.y = f


## A chair that is part of the current round (not sinking away).
func _live(ch: Dictionary) -> bool:
	return ch.active and not ch.removing


## Ground height for debris: open trapdoors are bottomless.
func _floor_at(x: float, z: float) -> float:
	for t in traps:
		if t.open and absf(x - t.x) < TRAP_HALF and absf(z - t.z) < TRAP_HALF:
			return -INF
	return 0.0


# ------------------------------------------------------------------ phases

func start() -> void:
	round_n = 1
	_start_music()
	hud.prompt("When the music stops: {A} sits · {B} shoves")
	_prompt_off_at = time + 5.0


func _start_music() -> void:
	phase = "music"
	phase_t = 0.0
	phase_id += 1
	music_dur = Rng.rand(2.5, 4.5) if time > 50 else Rng.rand(4, 9)
	step_len = STEP_BASE * maxf(0.75, 1.0 - 0.07 * (round_n - 1))
	beat_t = step_len   # first note right away
	beat_idx = 0
	mode = "live"
	hud.set_timer(-1)
	hud.banner("MUSIC ON — DO NOT TOUCH", 1600, "danger")


func _stop_music() -> void:
	phase = "sit"
	phase_t = 0.0
	phase_id += 1
	mode = "safe"
	flash_t = 0.6
	beat_pulse = 0.0
	_prompt_off_at = -1.0
	Sfx.play("go")
	Sfx.play("clank", {"vol": 0.6})
	hud.banner("SIT!", 1200, "good")
	hud.prompt("Press {A} at a free chair")


func _drop() -> void:
	phase = "drop"
	phase_t = 0.0
	phase_id += 1
	mode = "drop"
	hud.prompt("")
	hud.set_timer(-1)
	var any := false
	for seat in seats:
		if not seat.alive or seat.chair != null:
			continue
		var a: ArenaActor = seat.actor
		var t: Dictionary = seat.trap
		t.x = a.pos.x
		t.z = a.pos.z
		t.open = true
		t.g.position = Vector3(t.x, 0, t.z)
		t.g.visible = true
		seat.hang = 0.0
		seat.zap = 0.0
		a.vel = Vector3.ZERO
		a.knock = Vector3.ZERO
		any = true
	if any:
		Sfx.play("clank")
		Sfx.play("metal", {"vol": 0.7})
		if engine:
			engine.shake(0.2)
		hud.banner("TRAPDOOR OPEN", 1400, "danger")


func _start_reset() -> void:
	phase = "reset"
	phase_t = 0.0
	phase_id += 1
	mode = "off"
	move_t = 0.0
	for t in traps:
		t.open = false
	for seat in seats:
		if seat.chair != null:
			_unseat(seat, true)
	# Remove chairs until there is one fewer than the survivors.
	var want := maxi(1, alive_seats().size() - 1)
	var live := chairs.filter(func(ch): return _live(ch))
	while live.size() > want:
		var ch: Dictionary = live.pop_at(Rng.rand_int(0, live.size() - 1))
		ch.removing = true
		ch.sink = 0.0
	var layout := chair_layout(live.size())
	for i in layout.size():
		var p: Dictionary = layout[i]
		var ch: Dictionary = live[i]
		ch.fx = ch.x
		ch.fz = ch.z
		ch.ff = ch.f
		ch.tx = p.x
		ch.tz = p.z
		ch.tf = p.f
	Sfx.play("grind", {"vol": 0.5})
	hud.banner("CHAIRS LEFT: %d" % want, 1600)


func _finish() -> void:
	var alive := alive_seats()
	if not alive.is_empty():
		hud.banner("LAST SUBJECT SEATED", 2200, "good")
		Sfx.play("ding")
	else:
		hud.banner("NOBODY SAT", 2200, "danger")
	hud.set_timer(-1)
	hud.prompt("")
	end(2.4)


func _time_up() -> void:
	# Survivors share the podium, seated subjects above standing ones.
	for s in alive_seats():
		s.score = 1.0 if s.chair != null else 0.0
	hud.banner("TIME UP", 2000, "danger")
	hud.set_timer(-1)
	hud.prompt("")
	Sfx.play("buzz")
	end(2)


# -------------------------------------------------------------- mechanics

func _seat(seat: Dictionary, ch: Dictionary) -> void:
	var a: ArenaActor = seat.actor
	seat.chair = ch
	ch.occupant = seat
	a.frozen = true
	a.y = -SIT_DROP
	a.pos = Vector3(ch.x, 0, ch.z)
	a.vel = Vector3.ZERO
	a.knock = Vector3.ZERO
	a.facing = ch.f
	Sfx.play("thud", {"vol": 0.6})
	Haptics.for_player(seat.player, "click")


## Stand a subject up; `place` sets them down just in front of the chair.
func _unseat(seat: Dictionary, place: bool = false) -> void:
	var ch = seat.chair
	if ch == null:
		return
	var a: ArenaActor = seat.actor
	ch.occupant = null
	seat.chair = null
	a.frozen = seat.zap > 0 or seat.hang >= 0
	a.y = 0.0
	if place:
		var ox := sin(float(ch.f))
		var oz := cos(float(ch.f))
		a.pos = Vector3(ch.x + ox * 0.95, 0, ch.z + oz * 0.95)


func _on_shove(att: ArenaActor, vic: ArenaActor) -> void:
	var s = vic.seat
	if s == null or s.chair == null or phase != "sit" or state != "play":
		return
	_unseat(s)
	vic.stun = 0.7
	Sfx.play("clank", {"vol": 0.6})
	hud.feed("%s unseated %s" % [att.player.name(), vic.player.name()], att.player.color)


func _zap(seat: Dictionary, ch: Dictionary) -> void:
	var a: ArenaActor = seat.actor
	seat.zap = ZAP_TIME
	a.frozen = true
	var dx: float = a.pos.x - ch.x
	var dz: float = a.pos.z - ch.z
	var d := U.hypot(dx, dz)
	if d > 1e-4:
		dx /= d
		dz /= d
	else:
		dx = 0.0
		dz = 1.0
	a.vel = Vector3.ZERO
	a.knock.x += dx * 6
	a.knock.z += dz * 6
	fx.sparks(Vector3(ch.x + dx * CHAIR_R, 0.7, ch.z + dz * CHAIR_R), {"color": 0x8fd8ff, "count": 14, "speed": 5.0})
	Sfx.play("buzz")
	Sfx.play("snap", {"vol": 0.5})
	if engine:
		engine.shake(0.15)
	Haptics.for_player(seat.player, "hit")
	hud.feed("%s got zapped" % seat.player.name(), seat.player.color)


## Chair collisions, seated / dangling pins, zap timers and poses.
func _post_physics(dt: float) -> void:
	for seat in seats:
		if not seat.alive:
			continue
		var a: ArenaActor = seat.actor
		var s: Subject = seat.subject
		seat.zap_imm = maxf(0.0, seat.zap_imm - dt)
		if seat.zap > 0:
			seat.zap -= dt
			if seat.zap <= 0:
				seat.zap = 0.0
				seat.zap_imm = 0.5
		if seat.chair != null:
			a.pos = Vector3(seat.chair.x, 0, seat.chair.z)
			a.vel = Vector3.ZERO
			a.knock = Vector3.ZERO
		elif seat.hang >= 0:
			a.pos = Vector3(seat.trap.x, 0, seat.trap.z)
			a.vel = Vector3.ZERO
			a.knock = Vector3.ZERO
		else:
			for ch in chairs:
				if not _live(ch):
					continue
				var dx: float = a.pos.x - ch.x
				var dz: float = a.pos.z - ch.z
				var d := U.hypot(dx, dz)
				var mn := CHAIR_R + a.radius
				if d >= mn:
					continue
				if d > 1e-4:
					a.pos.x = ch.x + dx / d * mn
					a.pos.z = ch.z + dz / d * mn
				else:
					a.pos.z = ch.z + mn
		a.frozen = seat.chair != null or seat.zap > 0 or seat.hang >= 0
		s.root.position = Vector3(a.pos.x, a.y, a.pos.z)
		if seat.chair != null:
			s.pose = "sit"
		elif seat.zap > 0 or seat.hang >= 0:
			s.pose = "armsUp"
		elif a.stun > 0.3:
			s.pose = "cower"
		else:
			s.pose = "idle"
		if seat.zap > 0:
			s.root.rotation.z = sin(clock * 50) * 0.18
			s.root.rotation.x = sin(clock * 37) * 0.1
		elif seat.hang >= 0:
			s.root.rotation.z = sin(clock * 22) * 0.12
			s.root.rotation.x = 0.0
		else:
			s.root.rotation.z = 0.0
			s.root.rotation.x = 0.0


# ------------------------------------------------------------------ visuals

## Chair removal / rearrangement and trapdoor flaps. Positions depend on dt only.
func _animate_props(dt: float) -> void:
	if phase == "reset":
		move_t += dt
	var k := clampf((move_t - 0.6) / 0.9, 0.0, 1.0)
	k = k * k * (3.0 - 2.0 * k)
	for ch in chairs:
		if not ch.active:
			continue
		var g: Node3D = ch.g
		if ch.removing:
			ch.sink += dt
			ch.halo.visible = false
			ch.hatch.visible = true
			ch.hatch.position = Vector3(ch.x, 0.021, ch.z)
			g.rotation.z = sin(clock * 60) * 0.05 if ch.sink < 0.3 else 0.0
			g.position.y = 0.0 if ch.sink < 0.3 else -(ch.sink - 0.3) * 2.0
			if g.position.y < -1.3:
				ch.active = false
				g.visible = false
				ch.hatch.visible = false
			continue
		if phase == "reset":
			_place_chair(ch, lerpf(ch.fx, ch.tx, k), lerpf(ch.fz, ch.tz, k), ch.ff + U.angle_diff(ch.ff, ch.tf) * k)
	for t in traps:
		t.k = minf(1.0, t.k + dt * 7) if t.open else maxf(0.0, t.k - dt * 3)
		for f in t.flaps:
			f.pivot.rotation.z = f.side * t.k * (PI / 2)
		t.g.visible = t.open or t.k > 0.001


## Current glow on the chairs, halos, ring light, lamps and speakers.
func _animate_lights(dt: float) -> void:
	beat_pulse = maxf(0.0, beat_pulse - dt * 4)
	var p := beat_pulse
	var c := Color(0, 0, 0)
	var emis := 0.0
	var halo := 0.0
	var ring := 0.0
	if mode == "live":
		c = U.col(COLORS.live)
		emis = 0.12 + 0.35 * p + 0.05 * sin(clock * 40)
		halo = 0.22 + 0.3 * p
		ring = 4.0 + 8.0 * p
	elif mode == "safe":
		c = U.col(COLORS.safe)
		emis = 0.15
		halo = 0.35
		ring = 5.0
	elif mode == "drop":
		c = U.col(COLORS.drop)
		emis = 0.0
		halo = 0.2
		ring = 5.0 + sin(clock * 18) * 2
	Mats.set_color(halo_mat, c)
	Mats.set_opacity(halo_mat, halo)
	ring_light.light_color = c
	ring_light.light_energy = ring * Env.LIGHT_K
	# THREE: emissive = colour * emis (linear) → Godot emission colour x energy.
	frame_mat.emission = c
	frame_mat.emission_energy_multiplier = emis
	pad_mat.emission = c
	pad_mat.emission_energy_multiplier = emis * 0.6
	for cone in cones:
		cone.scale = Vector3(1 + 0.18 * p, 1, 1 + 0.18 * p)
	Mats.set_color(air_mat, (0xff2a1a if p > 0.3 else 0x8a1a10) if mode == "live" else 0x2a0606)
	var lamp := 80.0
	if flash_t > 0:
		flash_t -= dt
		lamp = 260.0 if int(floor(flash_t * 10)) % 2 == 0 else 15.0
	for l in lamps:
		l.light_energy = lamp * Env.LIGHT_K


func preview(dt: float) -> void:
	for s in seats:
		s.subject.animate(dt, 0)
	# Cosmetic: the chairs hum along to an imaginary beat (no RNG, no sound).
	var beat := int(floor(clock / 0.8))
	if beat != _pv_beat:
		_pv_beat = beat
		beat_pulse = 1.0
	_animate_lights(dt)


# ------------------------------------------------------------------- update

func update(dt: float) -> void:
	var playing := state == "play"
	for seat in seats:
		if seat.alive:
			seat.actor.frozen = seat.chair != null or seat.zap > 0 or seat.hang >= 0
	arena.step(dt, playing)
	_post_physics(dt)
	_animate_props(dt)
	_animate_lights(dt)
	if not playing:
		return

	if _prompt_off_at >= 0.0 and time >= _prompt_off_at:
		_prompt_off_at = -1.0
		if phase == "music":
			hud.prompt("")

	phase_t += dt
	if phase == "music":
		# The tune
		beat_t += dt
		while beat_t >= step_len:
			beat_t -= step_len
			var notes: Array = PATTERN[beat_idx % PATTERN.size()]
			for nt in notes:
				Sfx.play(nt[0], {"vol": nt[1]})
			if notes[0][0] == "thud":
				beat_pulse = 1.0
			beat_idx += 1
		# Live chairs
		if phase_t > ZAP_GRACE:
			for seat in seats:
				if not seat.alive or seat.chair != null or seat.zap > 0 or seat.zap_imm > 0 or seat.hang >= 0:
					continue
				var a: ArenaActor = seat.actor
				for ch in chairs:
					if not _live(ch):
						continue
					if U.hypot(a.pos.x - ch.x, a.pos.z - ch.z) < CHAIR_R + a.radius + TOUCH:
						_zap(seat, ch)
						break
		# Idle arcs crackling off the chairs
		arc_t -= dt
		if arc_t <= 0:
			arc_t = Rng.rand(0.25, 0.6)
			var live := chairs.filter(func(ch): return _live(ch))
			if not live.is_empty():
				var ch: Dictionary = Rng.pick(live)
				fx.sparks(Vector3(ch.x + Rng.rand(-0.25, 0.25), Rng.rand(0.2, 0.9), ch.z + Rng.rand(-0.25, 0.25)), {"color": 0x8fd8ff, "count": 4, "speed": 2.5})
		if phase_t >= music_dur:
			_stop_music()
	elif phase == "sit":
		for seat in seats:
			if not seat.alive or seat.chair != null or seat.zap > 0 or seat.hang >= 0:
				continue
			var a: ArenaActor = seat.actor
			if not seat.ctrl.a or a.stun > 0:
				continue
			var best = null
			var bd := SIT_REACH
			for ch in chairs:
				if not _live(ch) or ch.occupant != null:
					continue
				var d := U.hypot(a.pos.x - ch.x, a.pos.z - ch.z)
				if d < bd:
					bd = d
					best = ch
			if best != null:
				_seat(seat, best)
		hud.set_timer(maxf(0.0, SIT_TIME - phase_t))
		if phase_t >= SIT_TIME:
			_drop()
	elif phase == "drop":
		for seat in seats:
			if not seat.alive or seat.hang < 0:
				continue
			seat.hang += dt
			if seat.hang >= HANG:
				seat.hang = -1.0
				kill(seat, "fall", {"dir": Vector3(0, 0, 1)})
		if phase_t >= DROP_TIME:
			if alive_seats().size() <= 1:
				_finish()
				return
			_start_reset()
	elif phase == "reset":
		if phase_t >= RESET_TIME:
			round_n += 1
			_start_music()

	# HUD
	for s in seats:
		hud.set_stat(s, "ALIVE" if s.alive else "DROPPED")
		var status := ""
		if s.alive:
			status = "ZAPPED" if s.zap > 0 else ("SEATED" if s.chair != null else "STANDING")
		hud.set_status(s, status)

	if state != "play":
		return
	if phase != "drop" and alive_seats().size() <= 1:   # e.g. a solo seat
		_finish()
		return
	if time >= CAP:
		_time_up()


# -------------------------------------------------------------------- bots

func bot_think(seat: Dictionary, dt: float) -> void:
	var a: ArenaActor = seat.actor
	var c: Controller = a.ctrl
	var brain: Dictionary = seat.brain
	var m: Dictionary = brain.memory
	if m.get("phase_id", -1) != phase_id:
		m["phase_id"] = phase_id
		m["react"] = brain.reaction + Rng.rand(0, 0.25) * (1 - brain.difficulty)
		m["evict"] = Rng.random() < brain.difficulty
		m["slip_at"] = Rng.rand(1.2, 4) if Rng.random() < brain.error * 1.5 else -1.0   # a careless drift toward the chairs
		m["slip_t"] = 0.0
		if not m.has("dir"):
			m["dir"] = 1.0 if Rng.random() < 0.5 else -1.0
		m["orbit_jit"] = Rng.rand(-0.3, 0.3)
	if seat.chair != null or seat.hang >= 0 or seat.zap > 0:
		c.set_move(0, 0)
		c.set_buttons(false, false)
		m["b_prev"] = false
		return

	var want_a := false
	var want_b := false
	if phase == "sit" and phase_t >= m.react:
		var r := _bot_sit(seat, dt)
		want_a = r[0]
		want_b = r[1]
	else:
		want_b = _bot_orbit(seat, dt, phase == "music")
	# B is edge-triggered: alternate so repeated intents become fresh presses.
	var b_prev: bool = m.get("b_prev", false)
	c.set_buttons(want_a, want_b and not b_prev)
	m["b_prev"] = want_b and not b_prev


## Circle the ring at a safe distance; strong bots shove rivals into live chairs. Returns wantB.
func _bot_orbit(seat: Dictionary, dt: float, music: bool) -> bool:
	var a: ArenaActor = seat.actor
	var brain: Dictionary = seat.brain
	var m: Dictionary = brain.memory
	var extent := 0.0
	for ch in chairs:
		if _live(ch):
			extent = maxf(extent, U.hypot(ch.x, ch.z) + CHAIR_R + 0.1)
	var orbit_r: float = extent + 0.95 + (1 - brain.difficulty) * 0.9 + m.orbit_jit
	var slipping := false
	if music and m.slip_at > 0 and phase_t > m.slip_at and m.slip_t < 0.7:
		m.slip_t += dt
		orbit_r = maxf(0.2, extent - 0.4)
		slipping = true

	# Sabotage: shove a rival standing between us and the chairs.
	if music and brain.difficulty >= 0.6 and phase_t > ZAP_GRACE and a.shove_cd <= 0:
		var my_r := U.hypot(a.pos.x, a.pos.z)
		for o in seats:
			if o == seat or not o.alive or o.chair != null or o.zap > 0 or o.hang >= 0:
				continue
			var oa: ArenaActor = o.actor
			var dx := oa.pos.x - a.pos.x
			var dz := oa.pos.z - a.pos.z
			var d := U.hypot(dx, dz)
			if d < 1.3 and d > 0.01 and U.hypot(oa.pos.x, oa.pos.z) < my_r - 0.2 and Rng.random() < brain.difficulty * dt * 1.2:
				a.ctrl.set_move(dx / d * 0.35, dz / d * 0.35)
				return true

	var ang: float = atan2(a.pos.z, a.pos.x) + m.dir * 0.55
	var tx := clampf(cos(ang) * orbit_r, -HALF_W + 0.8, HALF_W - 0.8)
	var tz := clampf(sin(ang) * orbit_r, -HALF_D + 0.8, HALF_D - 0.8)
	var mx := tx - a.pos.x
	var mz := tz - a.pos.z
	var ml := U.hypot(mx, mz)
	if ml == 0.0:
		ml = 1.0
	var spd := 0.6 if music else 0.4
	mx = mx / ml * spd
	mz = mz / ml * spd
	if not slipping:
		for ch in chairs:
			if not _live(ch):
				continue
			var dx: float = a.pos.x - ch.x
			var dz: float = a.pos.z - ch.z
			var d := U.hypot(dx, dz)
			if d == 0.0:
				d = 0.01
			var clear := CHAIR_R + a.radius + 0.45
			if d < clear:
				var w := (clear - d) / 0.45 * 1.5
				mx += dx / d * w
				mz += dz / d * w
	for o in seats:
		if o == seat or not o.alive:
			continue
		var oa: ArenaActor = o.actor
		var dx := a.pos.x - oa.pos.x
		var dz := a.pos.z - oa.pos.z
		var d := U.hypot(dx, dz)
		if d == 0.0:
			d = 0.01
		if d < 1.1:
			mx += dx / d * (1.1 - d) * 0.6
			mz += dz / d * (1.1 - d) * 0.6
	a.ctrl.set_move(mx, mz)
	return false


## Rush the best free chair and sit; contest rivals; evict a sitter if nothing is free. Returns [a, b].
func _bot_sit(seat: Dictionary, dt: float) -> Array:
	var a: ArenaActor = seat.actor
	var brain: Dictionary = seat.brain
	var m: Dictionary = brain.memory
	var free := chairs.filter(func(ch): return _live(ch) and ch.occupant == null)
	if not free.is_empty():
		var best = null
		var bc := INF
		var bd := 0.0
		for ch in free:
			var d := U.hypot(a.pos.x - ch.x, a.pos.z - ch.z)
			var cost := d
			if brain.difficulty >= 0.5 and free.size() > 1:
				for o in seats:
					if o == seat or not o.alive or o.chair != null or o.hang >= 0:
						continue
					if U.hypot(o.actor.pos.x - ch.x, o.actor.pos.z - ch.z) < d - 0.6:
						cost += 1.2 * brain.difficulty
			if cost < bc:
				bc = cost
				best = ch
				bd = d
		# Contest: shove a rival racing us for the same chair.
		if brain.difficulty >= 0.5 and a.shove_cd <= 0 and bd > SIT_REACH - 0.05:
			for o in seats:
				if o == seat or not o.alive or o.chair != null or o.hang >= 0:
					continue
				var oa: ArenaActor = o.actor
				var dx := oa.pos.x - a.pos.x
				var dz := oa.pos.z - a.pos.z
				var d := U.hypot(dx, dz)
				if d < 1.2 and d > 0.01 and U.hypot(oa.pos.x - best.x, oa.pos.z - best.z) < bd + 0.5 and Rng.random() < brain.difficulty * dt * 5:
					a.ctrl.set_move(dx / d * 0.35, dz / d * 0.35)
					return [false, true]
		AI.steer_to(a, best.x, best.z, {"arrive": 0.0, "slow": 0.3})
		return [bd < SIT_REACH - 0.05, false]
	# Every chair taken: go and yank someone off theirs (or give up).
	if not m.evict:
		a.ctrl.set_move(0, 0)
		return [false, false]
	var target = null
	var td := INF
	for o in seats:
		if o == seat or not o.alive or o.chair == null:
			continue
		var d := U.hypot(o.actor.pos.x - a.pos.x, o.actor.pos.z - a.pos.z)
		if d < td:
			td = d
			target = o
	if target == null:
		a.ctrl.set_move(0, 0)
		return [false, false]
	var t: ArenaActor = target.actor
	if td > 1.1:
		AI.steer_to(a, t.pos.x, t.pos.z, {"arrive": 0.0})
		return [false, false]
	var tdx := t.pos.x - a.pos.x
	var tdz := t.pos.z - a.pos.z
	var dd := td if td != 0.0 else 0.01
	a.ctrl.set_move(tdx / dd * 0.35, tdz / dd * 0.35)
	return [false, a.shove_cd <= 0 and Rng.random() < 0.3 + brain.difficulty * 0.4]


func dispose() -> void:
	# break the seat <-> actor / chair <-> occupant reference cycles
	for ch in chairs:
		ch.occupant = null
	for seat in seats:
		seat.actor = null
		seat.chair = null
		seat.trap = null
	super.dispose()

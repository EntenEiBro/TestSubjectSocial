extends Minigame
## TURBINE HALL — a square hall lined with grinding shredders. Banks of giant
## fans blow a gale across the floor. Lean into it.
##
## Rules
##  - All four walls are shredder drums: touching one is a 'slice' death.
##  - One fan bank blows at a time. The wind pushes every subject toward the
##    opposite wall (it is added to the actor's knockback velocity every tick),
##    so you have to walk against it to hold your ground.
##  - Every 6–9 s the wind moves to another wall. The next bank's warning
##    lights flash and a banner names the side 1.5 s before it starts.
##  - The wind pulses, gusts and grows from 3.2 to 5.6 over the first minute
##    (walking speed is 5.2, so late gusts briefly out-run a walking subject).
##  - Concrete pillars stand in the hall. Directly downwind of a pillar the
##    wind drops to a trickle (the lee zone, shown as a dark patch on the floor).
##  - B shoves. A shove with the wind behind it carries much further and
##    staggers longer — the house speciality.
##  - Last subject standing wins. After 70 s the test is concluded and every
##    survivor shares first place.
##
## Shredder drums, fans and pillars are Blender models (blender/props/turbine.py).

const META := {
	"id": "turbine",
	"title": "TURBINE HALL",
	"tagline": "The air is fresh. The walls are hungry.",
	"category": "Hazard",
	"controls": [{"input": "move", "label": "Move"}, {"input": "b", "label": "Shove"}],
	"objective": "Be the last subject standing.",
	"rules": [
		"Giant fans blow across the hall. Walk into the wind to hold your ground.",
		"The wind changes sides every few seconds. Warning lights flash on the next fan bank.",
		"The walls are lined with shredders. Touching them is fatal.",
		"No wind reaches the lee of a pillar. Shove rivals downwind with {B}.",
	],
}

const H := 7.0                  # inner half-extent of the square hall
const EDGE := 0.5               # shredder bite depth from the wall
const KILL := H - EDGE          # |x| or |z| beyond this = shredded
const PILLAR_R := 0.75
const LEE_LEN := 3.4            # length of the windless zone behind a pillar (from its centre)
const WARN_TIME := 1.5          # warning before a wind shift
const TIME_CAP := 70.0
const FAN_DIST := H + 1.7       # fan centre distance from the hall centre
const FAN_R := 1.5
# Wind coming FROM side i travels along DIRS[i] (x, z) (also the inward normal of that wall):
# 0 = back wall (−Z), 1 = right wall (+X), 2 = front wall (+Z), 3 = left wall (−X).
const DIRS := [Vector2(0, 1), Vector2(-1, 0), Vector2(0, -1), Vector2(1, 0)]
const SIDE_BANNER := ["WIND FROM THE BACK", "WIND FROM THE RIGHT", "WIND FROM THE FRONT", "WIND FROM THE LEFT"]
# Pillar layouts (one is picked per round).
const LAYOUTS := [
	[[-3.3, -3.3], [3.3, -3.3], [-3.3, 3.3], [3.3, 3.3]],
	[[0.0, -3.4], [-3.2, 2.4], [3.2, 2.4]],
	[[0.0, -3.6], [0.0, 3.6], [-3.6, 0.0], [3.6, 0.0]],
]
const MOTES := 150              # dust specks
const STREAKS := 36             # wind streak lines

var arena: Arena
var drums := []
var fans := [[], [], [], []]
var fan_rate := [0.0, 0.0, 0.0, 0.0]
var lamp_mats := []
var warn_light: OmniLight3D
var pillars := []               # Vector2(x, z)
var lee_mat: StandardMaterial3D
var lees := []
# pending / side = -1: none (JS null / calm)
var wind := {"side": 0, "pending": -1, "warn_at": 0.0, "switch_at": 0.0, "warn_start": 0.0, "ramp": 1.0, "W": 2.6}
var maxed := false
var vis := Vector2(0, 1)
var mote_pos := []
var mote_seed := []
var motes_mm: MultiMesh
var streak_head := []
var streak_seed := []
var streak_mesh: ImmediateMesh
var streak_mat: StandardMaterial3D
var prompt_on := false


## Pure hash → [0, 1). Cosmetic particle scatter without touching the game RNG.
static func hash01(n: float) -> float:
	var s := sin(n * 127.1 + 311.7) * 43758.5453
	return s - floor(s)


func build() -> void:
	make_scene({"fog_near": 20.0, "fog_far": 56.0})
	make_camera([0, 18, 12.5], [0, 0, 0.6], 44)

	# --- floor, back wall, dressing
	Env.floor_plane(scene, 60, 44, {"tex": "concrete", "tile": 3.0})
	Env.floor_plane(scene, H * 2, H * 2, {"tex": "plate", "tile": 1.75, "y": 0.005})
	Env.stencil(scene, "STAND FIRM", 0, 0.02, 0, {"w": 6.0, "h": 1.8, "opacity": 0.18}).rotation.x = -PI / 2
	scene.add_child(Env.mesh(Geo.plane(50, 12), Mats.mat(0xffffff, Tex.wall(Vector2(12, 3))), 0, 5, -12, {"cast": false}))
	Env.stencil(scene, "AIRFLOW TEST 7", 0, 6.2, -11.9, {"w": 9.0, "h": 2.4, "opacity": 0.5})
	Env.pipe(scene, [-22, 8, -11.5], [22, 8, -11.5], 0.32)
	Env.pipe(scene, [-22, 7.2, -11.6], [22, 7.2, -11.6], 0.14, 0x5a3022)

	# --- shredder drums along all four walls (drum + teeth: Blender model)
	var steel := Mats.mat(0x8d918c, Tex.metal())
	var housing := Mats.mat(0xffffff, Tex.rust(Vector2(6, 1)))
	for side in 4:
		var d: Vector2 = DIRS[side]
		var g := Node3D.new()
		g.position = Vector3(-d.x * (H - 0.12), 0.42, -d.y * (H - 0.12))
		g.rotation.y = atan2(d.x, d.y) # local +Z points into the hall, local X runs along the wall
		var spin := Props.make("turbine", "shredder_drum")
		g.add_child(spin)
		g.add_child(Env.mesh(Geo.box(H * 2 + 1.4, 1.0, 0.5), housing, 0, 0.08, -0.45, {"cast": false}))
		g.add_child(Env.mesh(Geo.box(H * 2 + 1.4, 0.08, 0.55), steel, 0, 0.5, -0.12, {"cast": false}))
		scene.add_child(g)
		drums.append(spin)
		# Hazard paint inside the bite zone.
		if d.y != 0:
			Env.hazard_strip(scene, 0, -d.y * (H - 0.3), H * 2, 0.6, 0.012)
		else:
			Env.hazard_strip(scene, -d.x * (H - 0.3), 0, 0.6, H * 2, 0.012)

	# --- fan banks: two big fans behind each wall (frame + rotor: Blender models)
	fans = [[], [], [], []]
	fan_rate = [0.0, 0.0, 0.0, 0.0]
	lamp_mats = []
	for side in 4:
		var d: Vector2 = DIRS[side]
		var lat := Vector2(d.y, -d.x)
		var lamp_mat := Mats.glow(0x2a0a06)
		lamp_mats.append(lamp_mat)
		for lx in [-3.6, 3.6]:
			var fg := Node3D.new()
			fg.position = Vector3(-d.x * FAN_DIST + lat.x * lx, 2.0, -d.y * FAN_DIST + lat.y * lx)
			fg.rotation.y = atan2(d.x, d.y) # faces into the hall (local +Z = blowing direction)
			var blades := Props.make("turbine", "fan_blades")
			fg.add_child(Props.make("turbine", "fan_frame"))
			fg.add_child(blades)
			fg.add_child(Env.mesh(Geo.box(0.5, 0.22, 0.3), lamp_mat, 0, FAN_R + 0.3, 0, {"cast": false}))
			scene.add_child(fg)
			fans[side].append(blades)
	# A red strobe that sits on the bank about to start.
	warn_light = Env.point_light(0xff2a10, 0, 14, 1.6)
	warn_light.position = Vector3(0, 2.5, -H)
	scene.add_child(warn_light)

	# --- concrete pillars + their lee patches
	pillars = []
	for p in Rng.pick(LAYOUTS):
		pillars.append(Vector2(p[0], p[1]))
	lee_mat = Mats.glow(0x000000, {"opacity": 0.0, "depth_write": false})
	lees = []
	for p in pillars:
		var pillar := Props.make("turbine", "pillar")
		pillar.position = Vector3(p.x, 0, p.y)
		scene.add_child(pillar)
		var lg := Node3D.new()
		lg.position = Vector3(p.x, 0.03, p.y)
		var plane := Env.mesh(Geo.plane(PILLAR_R * 1.6, LEE_LEN - PILLAR_R), lee_mat, 0, 0, (PILLAR_R + LEE_LEN) / 2, {"cast": false})
		plane.rotation.x = -PI / 2
		lg.add_child(plane)
		scene.add_child(lg)
		lees.append(lg)

	Env.hanging_lamp(scene, 0, 8.5, 0, {"intensity": 120.0, "angle": 0.95})
	Env.hanging_lamp(scene, -5, 7.5, -3, {"intensity": 45.0, "angle": 0.8, "shadow": false})
	Env.hanging_lamp(scene, 5, 7.5, 3, {"intensity": 45.0, "angle": 0.8, "shadow": false})

	# --- arena + avatars
	arena = Arena.new({"bounds": {"min_x": -H, "max_x": H, "min_z": -H, "max_z": H}, "shove_force": 13.0})
	for p in pillars:
		arena.add_circle(p.x, p.y, PILLAR_R)
	var spots := [[-1.8, -1.8], [1.8, 1.8], [1.8, -1.8], [-1.8, 1.8]]
	for i in seats.size():
		var seat: Dictionary = seats[i]
		var x: float = spots[i % spots.size()][0]
		var z: float = spots[i % spots.size()][1]
		var facing := atan2(-x, -z)
		spawn_subject(seat, {"x": x, "z": z, "facing": facing})
		seat.actor = arena.add(ArenaActor.new({"player": seat.player, "ctrl": seat.ctrl, "subject": seat.subject, "x": x, "z": z}))
		seat.actor.facing = facing
		seat.actor.seat = seat
		seat.actor.data["shelter"] = 0.0
	arena.on_shove = func(a: ArenaActor, b: ArenaActor):
		b.data["last_shover"] = a.seat
		b.data["shoved_at"] = time
		# A shove with the wind behind it carries much further and staggers longer.
		var w := wind
		if state != "play" or w.side < 0:
			return
		var dw: Vector2 = DIRS[w.side]
		var ux := b.pos.x - a.pos.x
		var uz := b.pos.z - a.pos.z
		var dd := U.hypot(ux, uz)
		if dd == 0.0:
			dd = 1.0
		var down := (ux * dw.x + uz * dw.y) / dd
		if down <= 0:
			return
		var f: float = (3 + w.W * 0.9) * down
		b.knock.x += dw.x * f
		b.knock.z += dw.y * f
		b.stun = maxf(b.stun, 0.35 + 0.25 * down)

	# --- wind state (the briefing preview shows the back bank blowing)
	wind = {"side": 0, "pending": -1, "warn_at": 0.0, "switch_at": 0.0, "warn_start": 0.0, "ramp": 1.0, "W": 2.6}
	maxed = false
	vis = Vector2(0, 1)

	# --- dust motes (tiny specks) and wind streaks (line segments)
	mote_pos = []
	mote_seed = []
	for i in MOTES:
		mote_pos.append(Vector3((hash01(i * 3 + 1) * 2 - 1) * H, 0.15 + hash01(i * 3 + 2) * 2.2, (hash01(i * 3 + 3) * 2 - 1) * H))
		mote_seed.append(0)
	motes_mm = MultiMesh.new()
	motes_mm.transform_format = MultiMesh.TRANSFORM_3D
	motes_mm.mesh = Geo.box(0.09, 0.09, 0.09)
	motes_mm.instance_count = MOTES
	var motes := MultiMeshInstance3D.new()
	motes.multimesh = motes_mm
	motes.material_override = Mats.glow(0xbfb49a, {"opacity": 0.6, "depth_write": false})
	motes.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	motes.custom_aabb = AABB(Vector3(-H - 2, -1, -H - 2), Vector3(H * 2 + 4, 6, H * 2 + 4))
	scene.add_child(motes)
	_sync_motes()

	streak_head = []
	streak_seed = []
	for i in STREAKS:
		streak_head.append(Vector3((hash01(i * 5 + 11) * 2 - 1) * H, 0.3 + hash01(i * 5 + 12) * 2.0, (hash01(i * 5 + 13) * 2 - 1) * H))
		streak_seed.append(0)
	streak_mat = Mats.glow(0xd8d4c8, {"opacity": 0.0, "depth_write": false})
	streak_mesh = ImmediateMesh.new()
	var streaks := MeshInstance3D.new()
	streaks.mesh = streak_mesh
	streaks.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	streaks.custom_aabb = AABB(Vector3(-H - 2, -1, -H - 2), Vector3(H * 2 + 4, 6, H * 2 + 4))
	scene.add_child(streaks)


func start() -> void:
	var w := wind
	w.side = -1          # calm until the first bank spins up
	w.pending = -1
	w.warn_at = 1.0
	w.ramp = 0.0
	w.W = 0.0
	hud.banner("HOLD YOUR GROUND", 1000)
	hud.prompt("Walk into the wind · {B} shove")
	prompt_on = true     # hidden again after 4.5 s (JS setTimeout)


func preview(dt: float) -> void:
	_animate(dt)
	for s in seats:
		s.subject.animate(dt, 0)


# -------------------------------------------------------------------- wind

## Windless factor 0..1 at (x, z) for wind along (dx, dz): 1 = fully in a pillar's lee.
func _shelter(x: float, z: float, dx: float, dz: float) -> float:
	var best := 0.0
	for p in pillars:
		var rx: float = x - p.x
		var rz: float = z - p.y
		var along := rx * dx + rz * dz
		if along <= 0 or along >= LEE_LEN:
			continue
		var perp := absf(rx * dz - rz * dx)
		var s := clampf((PILLAR_R + 0.15 - perp) / 0.3, 0, 1) * clampf((LEE_LEN - along) / 0.8, 0, 1)
		if s > best:
			best = s
	return best * 0.85 # eddies: the lee kills most of the wind, not all of it


## Warnings, shifts and the strength curve. Gameplay only (state == "play").
func _update_wind(dt: float) -> void:
	var w := wind
	var t := time
	if w.pending < 0 and t >= w.warn_at:
		var cur: int = w.side
		w.pending = int(Rng.pick([0, 1, 2, 3].filter(func(s): return s != cur)))
		w.warn_start = t
		w.switch_at = t + WARN_TIME
		hud.banner(SIDE_BANNER[w.pending], 1500, "danger")
		Sfx.play("horn", {"vol": 0.45})
	if w.pending >= 0 and t >= w.switch_at:
		w.side = w.pending
		w.pending = -1
		w.ramp = 0.6
		w.warn_at = t + Rng.rand(6, 9) - WARN_TIME
		Sfx.play("grind", {"vol": 0.5})
		Sfx.play("whoosh", {"vol": 0.6})
	w.ramp = minf(1.0, w.ramp + dt * 1.6)
	if w.side < 0:
		w.W = 0.0
		return
	# 3.2 → 5.6 over the first minute; sharp pulses plus irregular gusts that can
	# briefly out-run a walking subject late in the round.
	var base := 3.2 + 2.4 * clampf(t / 60, 0, 1)
	var pulse := 0.72 + 0.28 * sin(t * 2.3 + 0.8 * sin(t * 0.7))
	var gust := pow(maxf(0.0, sin(t * 0.83 + 1.7 * sin(t * 0.31))), 8) * 0.3
	w.W = base * minf(1.2, pulse + gust) * w.ramp


# ------------------------------------------------------------------ visuals

## Purely cosmetic animation (fans, drums, lamps, lee patches, dust).
func _animate(dt: float) -> void:
	var w := wind
	for d in drums:
		d.rotation.x = wrapf(d.rotation.x - dt * 8, -PI, PI)

	# Fans: the active bank roars, the warned bank starts turning, the rest coast down.
	var strobe := sin(clock * 18) > 0
	for s in 4:
		var target := 0.0
		if s == w.side:
			target = 2.5 + w.W * 2.2
		elif s == w.pending:
			target = 1.2
		fan_rate[s] += (target - fan_rate[s]) * U.damp(1.6, dt)
		for b in fans[s]:
			b.rotation.z = wrapf(b.rotation.z + fan_rate[s] * dt, -PI, PI)
		var col := 0x2a0a06
		if s == w.pending:
			col = 0xff2010 if strobe else 0x300805
		elif s == w.side:
			col = 0xff9a20
		Mats.set_color(lamp_mats[s], col)
	if w.pending >= 0:
		var dp: Vector2 = DIRS[w.pending]
		warn_light.position = Vector3(-dp.x * (H + 0.6), 2.5, -dp.y * (H + 0.6))
		warn_light.light_energy = (18.0 if strobe else 2.0) * Env.LIGHT_K
	else:
		warn_light.light_energy = 0.0

	# Lee patches behind the pillars for the current wind.
	if w.side >= 0:
		var ds: Vector2 = DIRS[w.side]
		var ang := atan2(ds.x, ds.y)
		for lg in lees:
			lg.rotation.y = ang
		lee_mat.albedo_color.a = clampf(w.W / 4.6, 0, 1) * 0.32
	else:
		lee_mat.albedo_color.a = 0.0

	# Visual wind direction eases toward the real one.
	var tgt: Vector2 = DIRS[w.side] if w.side >= 0 else (DIRS[w.pending] if w.pending >= 0 else DIRS[0])
	var k := U.damp(3, dt)
	vis += (tgt - vis) * k
	var length := vis.length()
	var vx := vis.x
	var vz := vis.y
	if length < 0.05:
		vx = tgt.x
		vz = tgt.y
		length = 1.0
	vx /= length
	vz /= length

	var spd: float = 0.5 + w.W * 1.9
	for i in MOTES:
		mote_pos[i] = _advance_mote(mote_pos[i], i, mote_seed, i, spd * (0.6 + hash01(i * 7.13) * 0.8), dt, vx, vz)
	_sync_motes()

	var tail: float = 0.3 + w.W * 0.2
	streak_mesh.clear_surfaces()
	streak_mesh.surface_begin(Mesh.PRIMITIVE_LINES, streak_mat)
	for i in STREAKS:
		var p := _advance_mote(streak_head[i], i + 1000, streak_seed, i, spd * (1.2 + hash01(i * 3.71) * 0.6), dt, vx, vz)
		streak_head[i] = p
		streak_mesh.surface_add_vertex(p)
		streak_mesh.surface_add_vertex(Vector3(p.x - vx * tail, p.y, p.z - vz * tail))
	streak_mesh.surface_end()
	streak_mat.albedo_color.a = clampf(0.05 + w.W * 0.08, 0, 0.42)


func _sync_motes() -> void:
	for i in MOTES:
		motes_mm.set_instance_transform(i, Transform3D(Basis(), mote_pos[i]))


## Drift one particle with the wind; respawn it on the upwind side once it leaves the hall.
func _advance_mote(p: Vector3, id: float, seeds: Array, seed_idx: int, spd: float, dt: float, vx: float, vz: float) -> Vector3:
	var x := p.x
	var y := p.y
	var z := p.z
	var calm := 1.0 - 0.85 * _shelter(x, z, vx, vz)
	var wob := sin(clock * 2 + id) * 0.35
	x += (vx * spd * calm + vz * wob) * dt
	z += (vz * spd * calm - vx * wob) * dt
	y += sin(clock * 1.3 + id * 0.7) * 0.15 * dt
	if absf(x) > H + 0.6 or absf(z) > H + 0.6 or y < 0.05 or y > 3:
		seeds[seed_idx] += 1
		var s: float = seeds[seed_idx]
		var lat := (hash01(id * 13.7 + s * 3.1) * 2 - 1) * H
		x = -vx * (H + 0.4) + vz * lat
		z = -vz * (H + 0.4) - vx * lat
		y = 0.15 + hash01(id * 5.3 + s * 1.7) * 2.2
	return Vector3(x, y, z)


# ------------------------------------------------------------------- update

func update(dt: float) -> void:
	if prompt_on and time >= 4.5:
		prompt_on = false
		hud.prompt("")
	var playing := state == "play"
	var w := wind
	if playing:
		_update_wind(dt)
	else:
		w.W = maxf(0.0, w.W - dt * 3) # fans wind down once the round is decided
		w.pending = -1

	# Wind force: steady push added to the knockback (decays at 6/s → settles at W).
	var side: int = w.side if playing else -1
	for seat in alive_seats():
		var a: ArenaActor = seat.actor
		var dir: Vector2 = DIRS[side] if side >= 0 else Vector2.ZERO
		a.data["shelter"] = _shelter(a.pos.x, a.pos.z, dir.x, dir.y) if side >= 0 else 0.0
		if side < 0 or w.W <= 0:
			continue
		var f: float = w.W * (1 - a.data.shelter) * 6 * dt
		a.knock.x += dir.x * f
		a.knock.z += dir.y * f
	arena.step(dt, playing)
	_animate(dt)
	if not playing:
		return

	# Shredders
	for seat in alive_seats():
		var a: ArenaActor = seat.actor
		if absf(a.pos.x) > KILL or absf(a.pos.z) > KILL:
			_credit(seat)
			fx.sparks(Vector3(a.pos.x, 0.6, a.pos.z), {"count": 14})
			kill(seat, "slice", {"dir": Vector3(-a.pos.x, 0, -a.pos.z), "force": 0.9})

	for seat in seats:
		hud.set_stat(seat, "ALIVE" if seat.alive else "SHREDDED")
		hud.set_status(seat, "SHELTERED" if seat.alive and seat.actor.data.shelter > 0.5 else "")
	hud.set_timer(maxf(0.0, TIME_CAP - time))
	if not maxed and time >= 50 and w.pending < 0:
		maxed = true
		hud.banner("MAXIMUM AIRFLOW", 1400, "danger")
		Sfx.play("buzz", {"vol": 0.5})
	if check_last_standing():
		return
	if time >= TIME_CAP:
		hud.banner("VENTILATION TEST CONCLUDED", 1800)
		Sfx.play("horn")
		end()


## Feed line for a subject shoved into the shredders within the last 2 s.
func _credit(seat: Dictionary) -> void:
	var d: Dictionary = seat.actor.data
	var by = d.get("last_shover")
	if by != null and not is_same(by, seat) and time - float(d.get("shoved_at", -99.0)) < 2:
		hud.feed("%s fed the shredders" % by.player.name(), by.player.color)


# --------------------------------------------------------------------- bots

func bot_think(seat: Dictionary, dt: float) -> void:
	var a: ArenaActor = seat.actor
	var brain: Dictionary = seat.brain
	var mem: Dictionary = brain.memory
	var w := wind
	if not mem.has("wx"):
		var jx := Rng.rand(-1, 1)
		mem.merge({
			"wx": 0.0, "wz": 0.0, "think": 0.0, "mode": "hold", "tx": a.pos.x * 0.5, "tz": a.pos.z * 0.5, "prey": null, "pillar": -1, "plan": -1,
			"b_prev": false, "daze": 0.0, "jx": jx, "seen_side": -1, "blind": null, "ant_roll": -1.0, "ant_for": -1,
		})
	var cur: int = w.side
	# Did the bot register the warning? (rolled once per warning; sloppy bots sometimes ignore it)
	if w.pending >= 0 and mem.ant_roll != w.warn_start and time - w.warn_start > brain.reaction + (1 - brain.difficulty) * 0.9:
		mem.ant_roll = w.warn_start
		mem.ant_for = -2 if Rng.random() < brain.error * 1.5 else w.pending
	# A wind shift goes unnoticed for a moment: until then the bot fights the old wind.
	if w.side != mem.seen_side:
		if mem.blind == null:
			mem.blind = brain.reaction * 1.5 + (1 - brain.difficulty) * 0.9 + Rng.rand(0, 0.35)
			if mem.ant_for == w.side:
				mem.blind *= 0.5 # saw it coming
		mem.blind -= dt
		if mem.blind <= 0:
			mem.seen_side = w.side
			mem.blind = null
	var seen: int = mem.seen_side
	# Perceived wind (old direction while blind) is smoothed by the reaction time.
	var wx: float = DIRS[seen].x * w.W if seen >= 0 else 0.0
	var wz: float = DIRS[seen].y * w.W if seen >= 0 else 0.0
	var lag: float = minf(1.0, dt / (0.06 + brain.reaction))
	mem.wx += (wx - mem.wx) * lag
	mem.wz += (wz - mem.wz) * lag
	# Plan for the upcoming wind once the warning has registered.
	var plan := seen
	if mem.ant_for >= 0 and (mem.ant_for == w.pending or mem.ant_for == w.side):
		plan = mem.ant_for
	mem.daze = maxf(0.0, mem.daze - dt)
	mem.think -= dt
	if mem.think <= 0 or mem.plan != plan:
		mem.think = 0.3 + Rng.rand(0, 0.3)
		mem.plan = plan
		_bot_plan(seat, plan)

	# Where to stand this tick.
	var tx: float = mem.tx
	var tz: float = mem.tz
	var prey = mem.prey if mem.mode == "hunt" and mem.prey != null and mem.prey.alive else null
	if mem.mode == "hunt" and prey == null:
		mem.mode = "hold"
		mem.think = 0.0
	if prey != null and plan >= 0:
		tx = prey.pos.x - DIRS[plan].x * 0.85
		tz = prey.pos.z - DIRS[plan].y * 0.85
	if mem.mode == "shelter" and mem.pillar >= 0 and plan >= 0:
		# Walk around the pillar instead of into it when approaching from upwind.
		var p: Vector2 = pillars[mem.pillar]
		var pd: Vector2 = DIRS[plan]
		var rx := a.pos.x - p.x
		var rz := a.pos.z - p.y
		var along := rx * pd.x + rz * pd.y
		var perp := rx * pd.y - rz * pd.x
		if along < 0.3 and absf(perp) < PILLAR_R + 0.6:
			var sgn := 1.0 if perp >= 0 else -1.0
			tx = p.x + pd.y * sgn * (PILLAR_R + 0.9)
			tz = p.y - pd.x * sgn * (PILLAR_R + 0.9)

	# Desired velocity toward the spot, minus the (perceived) wind it has to beat.
	var dx := tx - a.pos.x
	var dz := tz - a.pos.z
	var d := U.hypot(dx, dz)
	var want := minf(1.0, d / 1.2) * a.speed if d > 0.05 else 0.0
	var shelter := _shelter(a.pos.x, a.pos.z, DIRS[cur].x, DIRS[cur].y) if cur >= 0 else 0.0
	var comp: float = (0.1 if mem.daze > 0 else 0.45 + 0.5 * brain.difficulty) * (1 - shelter)
	var mx: float = ((dx / d * want if d > 0.05 else 0.0) - mem.wx * comp) / a.speed
	var mz: float = ((dz / d * want if d > 0.05 else 0.0) - mem.wz * comp) / a.speed
	# Panic: shredder close behind → claw straight back inward (not while dazed).
	var m := 1.3
	var pk: float = 0.0 if mem.daze > 0 else 1.4 * (0.4 + 0.6 * brain.difficulty)
	if a.pos.x > KILL - m:
		mx -= (a.pos.x - (KILL - m)) / m * pk
	if a.pos.x < -KILL + m:
		mx += (-KILL + m - a.pos.x) / m * pk
	if a.pos.z > KILL - m:
		mz -= (a.pos.z - (KILL - m)) / m * pk
	if a.pos.z < -KILL + m:
		mz += (-KILL + m - a.pos.z) / m * pk

	# Shove a rival who stands downwind of us.
	var want_b := false
	var n = AI.nearest(a, arena.actors)
	if cur >= 0 and n != null and n.dist < 1.35 and n.dist > 0.01 and a.shove_cd <= 0:
		var t: ArenaActor = n.actor
		var ux: float = (t.pos.x - a.pos.x) / n.dist
		var uz: float = (t.pos.z - a.pos.z) / n.dist
		var downwind: float = ux * DIRS[cur].x + uz * DIRS[cur].y
		var chance: float = (2.5 if is_same(prey, t) else 1.2) * brain.difficulty * 2.5 * dt
		if downwind > 0.3 and Rng.random() < chance:
			want_b = true # move toward = face toward
			mx = ux
			mz = uz
	a.ctrl.set_move(mx, mz)
	a.ctrl.set_buttons(false, want_b and not mem.b_prev)
	mem.b_prev = want_b and not mem.b_prev


## Pick a mode + target: hunt a rival downwind, take a pillar's lee, or hold upwind of centre.
func _bot_plan(seat: Dictionary, plan: int) -> void:
	var a: ArenaActor = seat.actor
	var brain: Dictionary = seat.brain
	var mem: Dictionary = brain.memory
	var err: float = brain.error * 2.5
	if Rng.random() < brain.error * 0.45:
		mem.daze = Rng.rand(0.4, 1.0) # lapse of concentration
	if plan < 0:
		mem.mode = "hold"
		mem.pillar = -1
		mem.tx = a.pos.x * 0.5 + Rng.rand(-err, err)
		mem.tz = a.pos.z * 0.5 + Rng.rand(-err, err)
		return
	var px: float = DIRS[plan].x
	var pz: float = DIRS[plan].y
	var my_down := a.pos.x * px + a.pos.z * pz # how far downwind we already stand

	# 1) Hunt: a close rival downwind of us, while we have room behind us.
	var n = AI.nearest(a, arena.actors)
	if n != null and n.dist < 5 and KILL - my_down > 2.5:
		var t: ArenaActor = n.actor
		var rel := (t.pos.x - a.pos.x) * px + (t.pos.z - a.pos.z) * pz
		var keep: bool = mem.mode == "hunt" and is_same(mem.prey, t)
		if rel > 0.3 and (keep or Rng.random() < 0.25 + brain.difficulty * 0.5):
			mem.mode = "hunt"
			mem.prey = t
			mem.pillar = -1
			return
	mem.prey = null

	# 2) Shelter: the lee of the nearest free pillar.
	var best := -1
	var bx := 0.0
	var bz := 0.0
	var bd := INF
	var off := PILLAR_R + 0.42 + 0.35
	for pi in pillars.size():
		var p: Vector2 = pillars[pi]
		var sx := p.x + px * off
		var sz := p.y + pz * off
		if KILL - (sx * px + sz * pz) < 1.3:
			continue # that lee ends in the shredder
		var d := U.hypot(sx - a.pos.x, sz - a.pos.z)
		var taken := false
		for o in arena.actors:
			if o != a and o.alive and U.hypot(o.pos.x - sx, o.pos.z - sz) < minf(0.9, d):
				taken = true
				break
		if not taken and d < bd:
			bd = d
			best = pi
			bx = sx
			bz = sz
	var sticky: bool = mem.mode == "shelter" and best >= 0 and mem.pillar == best and Rng.random() < 0.6 + brain.difficulty * 0.35
	if best >= 0 and bd < 6.5 and (sticky or Rng.random() < 0.15 + brain.difficulty * 0.5):
		mem.mode = "shelter"
		mem.pillar = best
		mem.tx = bx + Rng.rand(-err, err) * 0.3
		mem.tz = bz + Rng.rand(-err, err) * 0.3
		return

	# 3) Hold: upwind of the centre, so the next shift leaves room to drift.
	mem.mode = "hold"
	mem.pillar = -1
	var back: float = 0.6 + brain.difficulty * 1.6
	mem.tx = -px * back + pz * mem.jx * 1.5 + Rng.rand(-err, err)
	mem.tz = -pz * back - px * mem.jx * 1.5 + Rng.rand(-err, err)


func dispose() -> void:
	for seat in seats:
		seat.actor = null      # break the seat <-> actor reference cycle
		seat.brain.memory.clear()
	super.dispose()

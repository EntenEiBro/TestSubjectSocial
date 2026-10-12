extends Minigame
## MOTION SENSOR — red light / green light down a long, grimy hall, judged
## by a ceiling-mounted sentry turret with a big signal lamp.
##
## Rules
##  - Subjects start at the near end of a 20 m hall; the exit door is at the
##    far end (z = -20). Walking pace is deliberately slow.
##  - The sentry cycles: GREEN (random 2–5 s, it looks away — move freely)
##    → YELLOW warning (0.6 s, it swings round) → RED (random 1.5–4 s).
##  - Under RED, anyone whose ground speed (walking + knockback) stays above a
##    small threshold for a moment is shot ("shot"). A short grace period at
##    the start of RED lets bodies settle.
##  - B shoves. A shoved subject slides — shove someone during RED (or late in
##    YELLOW) and the sentry does the rest.
##  - Stepping through the exit door = safe; finishers walk off into the dark.
##  - After 55 s the hall is cleared: everyone still inside is shot, the
##    furthest from the exit first.
##  - Placement: finishers in arrival order, then the dead (last to die ranks
##    highest).
##
## Sentry turret and signal panel: blender/props/motion.py.

const META := {
	"id": "motion",
	"title": "MOTION SENSOR",
	"tagline": "Walk on green. Hold very, very still on red.",
	"category": "Reflex",
	"controls": [{"input": "move", "label": "Move"}, {"input": "b", "label": "Shove"}],
	"objective": "Reach the exit door at the far end of the hall.",
	"rules": [
		"Move while the sentry lamp is GREEN. YELLOW means stop now.",
		"Anything moving under a RED lamp gets shot.",
		"Shove rivals with {B} — a shoved subject is a moving subject.",
		"Finish order decides placement. After 55 s the hall is cleared.",
	],
}

const HW := 4.0                      # hall half-width
const START_Z := 0.8                 # spawn line
const EXIT_Z := -20.0                # inner face of the far wall (door plane)
const FINISH_Z := EXIT_Z - 0.35      # crossing this inside the door = safe
const DOOR_HALF := 1.6
const DOOR_H := 3.0
const WALL_H := 5.5
const SPEED := 2.2                   # slow walk: ~9 s of walking for the whole hall
const GREEN_MIN := 2.0
const GREEN_MAX := 5.0
const YELLOW_TIME := 0.6
const RED_MIN := 1.5
const RED_MAX := 4.0
const RED_GRACE := 0.15              # bodies settle at the start of RED
const MOVE_EPS := 0.45               # speed (units/s) the sentry notices
const MOTION_LIMIT := 0.08           # seconds above MOVE_EPS before it fires
const CAP := 55.0
const PURGE_GAP := 0.45
const TURRET_Y := 4.4
const TURRET_Z := EXIT_Z + 1.6
const COLORS := {"green": 0x39ff5a, "yellow": 0xffc21a, "red": 0xff2a14, "dim": 0x221a10}

var arena: Arena
var cam_z := 0.0
var cam_goal := 0.0
var strip_mat: StandardMaterial3D
var signal_mat: StandardMaterial3D
var eye_mat: StandardMaterial3D
var cone_mat: StandardMaterial3D
var lamp_light: OmniLight3D
var lenses := []
var turret := {}
var tracers := []
var phase := "idle"       # idle | green | yellow | red
var phase_t := 0.0
var phase_dur := INF
var cycle := 0            # increments on every phase change (bots watch it)
var beeped := false
var scan_t := 0.0
var finishers := []
var purging := false
var purge := []
var purge_t := 0.0
var _prompt_off := -1.0   # game time the intro prompt is hidden (JS setTimeout 4500)


func build() -> void:
	make_scene({"fog": 0x0a0a0b, "fog_near": 22.0, "fog_far": 54.0, "ambient": 0x3c3e44})
	make_camera([0, 10, 11], [0, 0.5, -6], 50)
	cam_z = 0.0
	cam_goal = 0.0

	_build_hall()
	_build_door()
	_build_turret()

	Env.hanging_lamp(scene, -2.6, 5.2, -1.5, {"intensity": 70.0, "angle": 0.95})
	Env.hanging_lamp(scene, 2.6, 5.2, -9, {"intensity": 70.0, "angle": 0.95})
	Env.hanging_lamp(scene, -2.6, 5.2, -15.5, {"intensity": 55.0, "angle": 0.95, "shadow": false})

	# --- arena + avatars
	arena = Arena.new({"bounds": {"min_x": -HW, "max_x": HW, "min_z": EXIT_Z - 8, "max_z": 2.6}, "shove_force": 9.0})
	arena.add_wall(-HW - 1, -DOOR_HALF, EXIT_Z - 0.6, EXIT_Z)
	arena.add_wall(DOOR_HALF, HW + 1, EXIT_Z - 0.6, EXIT_Z)
	var n := seats.size()
	for i in n:
		var seat: Dictionary = seats[i]
		var x := (i - (n - 1) / 2.0) * 1.8
		var z := START_Z
		spawn_subject(seat, {"x": x, "z": z, "facing": PI})
		seat.actor = arena.add(ArenaActor.new({"player": seat.player, "ctrl": seat.ctrl, "subject": seat.subject, "x": x, "z": z, "speed": SPEED}))
		seat.actor.seat = seat
		seat.actor.facing = PI
		seat["idx"] = i
		seat["finished"] = false
		seat["motion"] = 0.0
		seat["walk_x"] = 0.0
		seat["walk_z"] = 0.0
	arena.on_shove = func(att: ArenaActor, vic: ArenaActor):
		vic.data["last_shover"] = att.seat
		vic.data["shoved_at"] = time

	# Muzzle tracers: one reusable streak per seat.
	for s in seats:
		var m := Mats.glow(0xffe08a, {"opacity": 1.0, "depth_write": false})
		var mi := Env.mesh(Geo.box(0.05, 0.05, 1), m, 0, 0, 0, {"cast": false})
		mi.visible = false
		scene.add_child(mi)
		tracers.append({"mesh": mi, "mat": m, "t": 0.0})

	phase = "idle"
	phase_t = 0.0
	phase_dur = INF
	cycle = 0
	beeped = false
	scan_t = 0.0
	finishers = []
	purging = false
	purge = []
	purge_t = 0.0
	_lamp("green")


# ------------------------------------------------------------------ stage

func _build_hall() -> void:
	var length := 24.0
	var zc := (4 + EXIT_Z) / 2
	Env.floor_plane(scene, 40, 50, {"tex": "concrete", "tile": 3.0, "z": -10.0})
	Env.floor_plane(scene, HW * 2, length, {"tex": "tiles", "tile": 1.5, "y": 0.005, "z": zc})
	# Start line, distance marks, exit strip.
	var start_line := Env.mesh(Geo.plane(HW * 2, 0.2), Mats.mat(0xd8d2c0), 0, 0.02, START_Z - 0.7, {"cast": false})
	start_line.rotation.x = -PI / 2
	scene.add_child(start_line)
	Env.stencil(scene, "START", 0, 0.02, START_Z + 1.2, {"w": 3.2, "h": 1.1, "opacity": 0.3}).rotation.x = -PI / 2
	var tick_mat := Mats.mat(0x9a9480, null, {"opacity": 0.35, "depth_write": false})
	for d in [15, 10, 5]:
		Env.stencil(scene, "%d M" % d, -HW + 1.3, 0.02, EXIT_Z + d, {"w": 2.0, "h": 0.8, "opacity": 0.28}).rotation.x = -PI / 2
		var tick := Env.mesh(Geo.plane(HW * 2, 0.08), tick_mat, 0, 0.015, EXIT_Z + d, {"cast": false})
		tick.rotation.x = -PI / 2
		scene.add_child(tick)
	Env.stencil(scene, "FREEZE", 0, 0.02, -9, {"w": 5.0, "h": 1.8, "opacity": 0.18}).rotation.x = -PI / 2
	Env.hazard_strip(scene, 0, EXIT_Z + 0.35, DOOR_HALF * 2 + 0.6, 0.5, 0.02)

	# Side walls with signal strips along the top and the usual pipework.
	var wall_mat := Mats.mat(0xffffff, Tex.wall(Vector2(6, 1.4)))
	Env.block(scene, -HW - 0.2, WALL_H / 2, zc, 0.4, WALL_H, length, wall_mat)
	Env.block(scene, HW + 0.2, WALL_H / 2, zc, 0.4, WALL_H, length, wall_mat)
	strip_mat = Mats.glow(COLORS.green)
	for sx in [-1, 1]:
		scene.add_child(Env.mesh(Geo.box(0.08, 0.12, length), strip_mat, sx * (HW - 0.04), 3.6, zc, {"cast": false}))
		Env.pipe(scene, [sx * (HW - 0.25), 4.6, 4], [sx * (HW - 0.25), 4.6, EXIT_Z + 0.3], 0.12)
		Env.hazard_strip(scene, sx * (HW - 0.25), zc, 0.5, length, 0.012)
	Env.stencil(scene, "NO SUDDEN MOVEMENTS", -HW + 0.02, 2.2, -7, {"w": 7.0, "h": 1.3, "rot_y": PI / 2, "opacity": 0.55})
	Env.stencil(scene, "YOU ARE BEING OBSERVED", HW - 0.02, 2.2, -12, {"w": 7.0, "h": 1.3, "rot_y": -PI / 2, "opacity": 0.5})


## Far wall with the exit door, EXIT sign, a 3-lens signal panel and a dark tunnel beyond.
func _build_door() -> void:
	var z := EXIT_Z - 0.3
	var wall_mat := Mats.mat(0xffffff, Tex.wall(Vector2(2, 2)))
	var side_w := HW + 0.4 - DOOR_HALF
	Env.block(scene, -(DOOR_HALF + side_w / 2), WALL_H / 2, z, side_w, WALL_H, 0.6, wall_mat)
	Env.block(scene, DOOR_HALF + side_w / 2, WALL_H / 2, z, side_w, WALL_H, 0.6, wall_mat)
	Env.block(scene, 0, (DOOR_H + WALL_H) / 2, z, DOOR_HALF * 2, WALL_H - DOOR_H, 0.6, wall_mat)
	var frame := Mats.mat(0xffffff, Tex.hazard(Vector2(1, 3)))
	Env.block(scene, -DOOR_HALF - 0.1, DOOR_H / 2, EXIT_Z + 0.05, 0.2, DOOR_H, 0.15, frame)
	Env.block(scene, DOOR_HALF + 0.1, DOOR_H / 2, EXIT_Z + 0.05, 0.2, DOOR_H, 0.15, frame)
	Env.block(scene, 0, DOOR_H - 0.2, z, DOOR_HALF * 2, 0.4, 0.5, Mats.mat(0x6a6e6a, Tex.plate(Vector2(3, 1))))   # raised shutter
	var sign_tex := Tex.text("EXIT", {"w": 256, "h": 80, "size": 64, "color": "#39ff5a", "bg": "#041004", "grimy": false})
	scene.add_child(Env.mesh(Geo.plane(2.2, 0.7), Mats.glow(0xffffff, {"tex": sign_tex}), 0, DOOR_H + 0.5, EXIT_Z + 0.02, {"cast": false}))
	# Dark tunnel beyond the door (THREE.BackSide: only the inner faces render).
	var dark_mat := Mats.glow(0x020202)
	dark_mat.cull_mode = BaseMaterial3D.CULL_FRONT
	scene.add_child(Env.mesh(Geo.box(DOOR_HALF * 2 + 0.2, DOOR_H, 8), dark_mat, 0, DOOR_H / 2 - 0.01, EXIT_Z - 4.6, {"cast": false}))

	# Traffic-light panel on the far wall (Blender housing, procedural lenses).
	var panel := Node3D.new()
	panel.add_child(Props.make("motion", "signal_panel"))
	for l in [["red", 0.6], ["yellow", 0.0], ["green", -0.6]]:
		var m := Mats.glow(COLORS.dim)
		panel.add_child(Env.mesh(Geo.circle(0.24, 14), m, 0, l[1], 0.16, {"cast": false}))
		lenses.append({"key": l[0], "mat": m})
	panel.position = Vector3(DOOR_HALF + 1.4, 2.6, EXIT_Z + 0.16)
	scene.add_child(panel)


## Ceiling sentry: beam, rod, yawing housing with twin barrels, lamp dome, red scan cone.
func _build_turret() -> void:
	Env.block(scene, 0, 5.35, TURRET_Z, HW * 2 + 0.8, 0.35, 0.5, Mats.mat(0x4a4038, Tex.rust(Vector2(4, 1))))
	var base := Node3D.new()
	base.position = Vector3(0, TURRET_Y, TURRET_Z)
	scene.add_child(base)
	base.add_child(Props.make("motion", "turret_base"))
	var yaw := Node3D.new()
	base.add_child(yaw)
	var pitch := Node3D.new()
	pitch.position.y = -0.3
	yaw.add_child(pitch)
	pitch.add_child(Props.make("motion", "turret_head"))
	eye_mat = Mats.glow(0x5a0a06)
	pitch.add_child(Env.mesh(Geo.sphere(0.11, 8, 6), eye_mat, 0, 0.1, 0.48, {"cast": false}))
	# The signal lamp: a big dome on top inside a wire cage (cage: Blender head).
	signal_mat = Mats.glow(COLORS.green)
	pitch.add_child(Env.mesh(Geo.sphere(0.3, 12, 6, 0, TAU, 0, PI / 2), signal_mat, 0, 0.27, 0, {"cast": false}))
	# Scan cone (only lit under RED). Tip at the eye, opening along +Z.
	cone_mat = Mats.glow(COLORS.red, {"opacity": 0.0, "depth_write": false, "additive": true, "double_side": true})
	var cone := Env.mesh(Geo.cone(2.4, 16, 16, true), cone_mat, 0, 0.1, 0.5 + 8, {"cast": false})
	cone.rotation.x = -PI / 2
	cone.visible = false
	pitch.add_child(cone)
	var muzzle := Node3D.new()
	muzzle.position = Vector3(0, -0.1, 1.25)
	pitch.add_child(muzzle)
	lamp_light = Env.point_light(COLORS.green, 30.0, 24.0, 1.2)
	lamp_light.position = Vector3(0, 0.3, 0.6)
	base.add_child(lamp_light)
	turret = {"base": base, "yaw": yaw, "pitch": pitch, "cone": cone, "muzzle": muzzle, "hold_t": 0.0, "aim_yaw": 0.0, "aim_pitch": 0.0}
	yaw.rotation.y = PI


## Paint the signal lamp, wall strips and panel lenses in one phase colour.
func _lamp(key: String) -> void:
	var hex: int = COLORS[key]
	Mats.set_color(signal_mat, hex)
	Mats.set_color(strip_mat, hex)
	lamp_light.light_color = U.col(hex)
	for l in lenses:
		Mats.set_color(l.mat, COLORS[l.key] if l.key == key else COLORS.dim)


# ------------------------------------------------------------------- flow

func start() -> void:
	_set_phase("green")
	hud.prompt("{MOVE} on green · freeze on red · {B} shoves")
	_prompt_off = 4.5


func preview(dt: float) -> void:
	for s in seats:
		s.subject.animate(dt, 0)
	# Cosmetic lamp demo cycle.
	var k := int(floor(clock / 1.6)) % 3
	_lamp("green" if k == 0 else ("yellow" if k == 1 else "red"))
	_update_turret(dt)
	_update_camera(dt)


func _set_phase(p: String) -> void:
	phase = p
	phase_t = 0.0
	cycle += 1
	beeped = false
	scan_t = 0.0
	if p == "green":
		phase_dur = Rng.rand(GREEN_MIN, GREEN_MAX)
		_lamp("green")
		Mats.set_color(eye_mat, 0x5a0a06)
		hud.banner("MOVE", 900, "good")
		Sfx.play("go", {"vol": 0.5})
	elif p == "yellow":
		phase_dur = YELLOW_TIME
		_lamp("yellow")
		hud.banner("FREEZE", 1700, "danger")
		Sfx.play("beep")
	else:
		phase_dur = Rng.rand(RED_MIN, RED_MAX)
		_lamp("red")
		Mats.set_color(eye_mat, 0xff2010)
		for s in seats:
			s.motion = 0.0
		Sfx.play("buzz")
		Sfx.play("sonar", {"vol": 0.6})


func _update_phase(dt: float) -> void:
	phase_t += dt
	if phase == "yellow":
		# Blink + second beep halfway through the warning.
		Mats.set_color(signal_mat, COLORS.yellow if int(floor(phase_t * 12)) % 2 == 0 else COLORS.dim)
		if not beeped and phase_t >= YELLOW_TIME / 2:
			beeped = true
			Sfx.play("beep")
	elif phase == "red":
		scan_t -= dt
		if scan_t <= 0:
			scan_t = 0.5
			Sfx.play("tick", {"vol": 0.6})
	if phase_t >= phase_dur:
		_set_phase("yellow" if phase == "green" else ("red" if phase == "yellow" else "green"))


## Snap the turret onto a world point and hold the aim for a moment.
func _aim_at(x: float, y: float, z: float) -> void:
	var T := turret
	var dx := x
	var dz := z - TURRET_Z
	var dy := (TURRET_Y - 0.3) - y
	T.aim_yaw = atan2(dx, dz)
	T.aim_pitch = atan2(dy, U.hypot(dx, dz))
	T.yaw.rotation.y = T.aim_yaw
	T.pitch.rotation.x = T.aim_pitch
	T.hold_t = 0.7


## The sentry fires on a seat.
func _shoot(seat: Dictionary, show_banner: bool = true) -> void:
	var a: ArenaActor = seat.actor
	var T := turret
	var to := Vector3(a.pos.x, 1.25, a.pos.z)
	_aim_at(to.x, to.y, to.z)
	var muzzle: Node3D = T.muzzle
	var from := muzzle.global_position
	var tr: Dictionary = tracers[seat.idx]
	var mi: MeshInstance3D = tr.mesh
	Env.look_from(mi, (from + to) * 0.5, to)
	mi.scale = Vector3(1, 1, maxf(0.1, from.distance_to(to)))
	mi.visible = true
	Mats.set_opacity(tr.mat, 1.0)
	tr.t = 0.2
	fx.sparks(from, {"count": 8, "speed": 4.0})
	var by = a.data.get("last_shover")
	if by != null and not is_same(by, seat) and time - float(a.data.get("shoved_at", -99.0)) < 1.2:
		hud.feed("%s framed %s" % [by.player.name(), seat.player.name()], by.player.color)
	if show_banner:
		hud.banner("MOVEMENT DETECTED", 1100, "danger")
	kill(seat, "shot", {"dir": Vector3(to.x - from.x, 0, to.z - from.z)})


func _finish(seat: Dictionary) -> void:
	seat.finished = true
	finishers.append(seat)
	var a: ArenaActor = seat.actor
	a.alive = false   # leave the physics sim; we animate the walk-off ourselves
	seat.walk_x = a.pos.x
	seat.walk_z = a.pos.z
	Sfx.play("ding")
	hud.banner("EXIT REACHED", 1000, "good")
	hud.feed("%s reached the exit" % seat.player.name(), seat.player.color)


## Time is up: everyone still in the hall is shot, furthest from the exit first.
func _start_purge() -> void:
	purging = true
	var doomed := seats.filter(func(s): return s.alive and not s.finished)
	doomed.sort_custom(func(p, q):
		if p.actor.pos.z != q.actor.pos.z:
			return p.actor.pos.z > q.actor.pos.z
		return p.idx < q.idx)
	purge = []
	for i in doomed.size():
		purge.append({"seat": doomed[i], "at": 0.9 + i * PURGE_GAP})
	purge_t = 0.0
	phase = "red"
	_lamp("red")
	Mats.set_color(eye_mat, 0xff2010)
	hud.banner("HALL CLOSED", 2000, "danger")
	Sfx.play("sting", {"vol": 0.7})


func _run_purge(dt: float) -> void:
	purge_t += dt
	for p in purge:
		if not p.seat.alive:
			continue
		p.seat.subject.pose = "armsUp"
		if purge_t >= p.at:
			_shoot(p.seat, false)


# ----------------------------------------------------------------- update

func update(dt: float) -> void:
	var playing := state == "play"
	arena.step(dt, playing and not purging)
	_walk_off(dt)
	_update_tracers(dt)
	if playing and not purging:
		_update_phase(dt)
	_update_turret(dt)
	_update_camera(dt)
	if not playing:
		return

	if _prompt_off >= 0.0 and time >= _prompt_off:
		_prompt_off = -1.0
		hud.prompt("")
	if purging:
		_run_purge(dt)
	else:
		for seat in seats:
			if not seat.alive or seat.finished:
				continue
			var a: ArenaActor = seat.actor
			if a.pos.z < FINISH_Z:
				_finish(seat)
				continue
			if phase == "red" and phase_t >= RED_GRACE:
				var spd := U.hypot(a.vel.x + a.knock.x, a.vel.z + a.knock.z)
				if spd > MOVE_EPS:
					seat.motion += dt
				else:
					seat.motion = maxf(0.0, seat.motion - dt * 0.5)
				if seat.motion >= MOTION_LIMIT:
					_shoot(seat)

	# HUD
	hud.set_timer(maxf(0.0, CAP - time))
	var frozen := phase == "yellow" or phase == "red"
	for seat in seats:
		if seat.finished:
			hud.set_status(seat, "SAFE")
			hud.set_stat(seat, "EXIT #%d" % (finishers.find(seat) + 1))
		elif not seat.alive:
			hud.set_status(seat, "")
			hud.set_stat(seat, "SHOT")
		else:
			hud.set_status(seat, "FREEZE" if frozen else "MOVE")
			hud.set_stat(seat, "%d M TO EXIT" % maxi(0, ceili(seat.actor.pos.z - EXIT_Z)))

	if seats.all(func(s): return not s.alive or s.finished):
		end(1.8)
	elif not purging and time >= CAP:
		_start_purge()
	elif time > CAP + 10:
		end()   # absolute safety net


## Finished subjects stroll through the door into the dark.
func _walk_off(dt: float) -> void:
	for seat in seats:
		if not seat.finished or seat.subject == null or not seat.subject.root.visible:
			continue
		seat.walk_z -= SPEED * dt
		seat.walk_x = lerpf(seat.walk_x, 0.0, minf(1.0, dt * 2))
		var sub: Subject = seat.subject
		sub.root.position = Vector3(seat.walk_x, 0, seat.walk_z)
		sub.face_angle(PI, dt)
		sub.animate(dt, SPEED)
		if seat.walk_z < EXIT_Z - 6:
			sub.root.visible = false
			seat.tag_target = null


func _update_tracers(dt: float) -> void:
	for tr in tracers:
		if not tr.mesh.visible:
			continue
		tr.t -= dt
		Mats.set_opacity(tr.mat, maxf(0.0, tr.t / 0.2))
		if tr.t <= 0:
			tr.mesh.visible = false


## Looks away on green, swings round on yellow, sweeps on red, holds aim after a shot.
func _update_turret(dt: float) -> void:
	var T := turret
	T.hold_t = maxf(0.0, T.hold_t - dt)
	var yaw_goal: float
	var pitch_goal: float
	if T.hold_t > 0:
		yaw_goal = T.aim_yaw
		pitch_goal = T.aim_pitch
	elif phase == "green":
		yaw_goal = PI
		pitch_goal = 0.15
	elif phase == "yellow" or phase == "red":
		yaw_goal = sin(clock * 1.4) * 0.42
		pitch_goal = 0.27
	else:   # idle (briefing)
		yaw_goal = sin(clock * 0.5) * 1.3
		pitch_goal = 0.2
	var k := U.damp(9 if phase == "yellow" else 6, dt)
	var yaw: Node3D = T.yaw
	var pitch: Node3D = T.pitch
	yaw.rotation.y += U.angle_diff(yaw.rotation.y, yaw_goal) * k
	pitch.rotation.x += (pitch_goal - pitch.rotation.x) * k
	var scanning := phase == "red" and state != "preview" and state != "build"
	T.cone.visible = scanning
	if scanning:
		Mats.set_opacity(cone_mat, 0.07 + 0.04 * sin(clock * 9))


## Track the pack down the hall; never pan back toward the start.
func _update_camera(dt: float) -> void:
	var pack := seats.filter(func(s): return s.alive and not s.finished and s.actor != null)
	if not pack.is_empty():
		var avg := 0.0
		var rear := -INF
		for s in pack:
			avg += s.actor.pos.z
			rear = maxf(rear, s.actor.pos.z)
		avg /= pack.size()
		cam_goal = clampf(minf(cam_goal, maxf(avg, rear - 3)), EXIT_Z + 7, 0.0)
	cam_z = lerpf(cam_z, cam_goal, minf(1.0, dt * 2.5))
	Env.look_from(camera, Vector3(0, 10, cam_z + 11), Vector3(0, 0.5, cam_z - 6))


## Finishers in arrival order, then the dead (last to die ranks highest).
func placement() -> Array:
	var tiers := []
	for s in finishers:
		tiers.append([s])
	var stragglers := seats.filter(func(s): return s.alive and not s.finished)
	if not stragglers.is_empty():
		tiers.append(stragglers)
	var dead := deaths.duplicate()
	dead.reverse()
	tiers.append_array(Minigame.group_by(dead, func(s): return snappedf(s.death_time, 0.001)))
	return tiers


# ------------------------------------------------------------------- bots

func bot_think(seat: Dictionary, dt: float) -> void:
	var a: ArenaActor = seat.actor
	var c: Controller = a.ctrl
	var brain: Dictionary = seat.brain
	var m: Dictionary = brain.memory
	if seat.finished or purging:
		c.set_move(0, 0)
		c.set_buttons(false, false)
		return

	# React to phase changes (once per phase).
	if m.get("cycle", -1) != cycle:
		m["cycle"] = cycle
		if phase == "green":
			m["go_delay"] = brain.reaction * Rng.rand(0.8, 1.3)
			m["hunt"] = Rng.random() < brain.difficulty * 0.6
		elif phase == "yellow":
			var late: bool = Rng.random() < brain.error * 0.55   # sloppy bots sometimes stop too late
			m["stop_delay"] = brain.reaction * Rng.rand(0.85, 1.15) + (Rng.rand(0.35, 0.8) if late else 0.0)
			# Right at the door, a sharp bot dashes through during the warning.
			if a.pos.z - FINISH_Z < 0.9 and Rng.random() < brain.difficulty:
				m["stop_delay"] = maxf(m.stop_delay, YELLOW_TIME - 0.15)
		elif phase == "red":
			m["frame"] = Rng.random() < 0.2 + brain.difficulty * 0.6

	var move: bool
	if phase == "green":
		move = phase_t >= float(m.get("go_delay", 0.0))
	else:
		var since := phase_t if phase == "yellow" else YELLOW_TIME + phase_t
		move = since < float(m.get("stop_delay", 0.0))

	var want_b := false
	if move:
		var mx := 0.0
		var mz := -1.0
		var parity := 1.0 if int(seat.idx) % 2 else -1.0
		if a.pos.z < EXIT_Z + 4.5:
			# Funnel into the door.
			var tx := clampf(a.pos.x, -DOOR_HALF + 0.55, DOOR_HALF - 0.55)
			mx = clampf((tx - a.pos.x) * 1.5, -1, 1)
		else:
			for o in seats:
				if is_same(o, seat) or not o.alive or o.finished:
					continue
				var dx: float = a.pos.x - o.actor.pos.x
				var dz: float = a.pos.z - o.actor.pos.z
				var d := U.hypot(dx, dz)
				if d > 3 or d < 0.01:
					continue
				var w := (3 - d) / 3
				var side := signf(dx) if absf(dx) > 0.05 else parity
				if m.get("hunt", false) and dz > 0.4:
					mx -= signf(dx) * minf(absf(dx), 1) * w * 1.2   # line up behind a rival ahead
				else:
					mx += side * w * (0.6 + brain.difficulty)        # keep clear of everyone else
			if a.pos.x > HW - 1:
				mx -= 0.8
			if a.pos.x < -HW + 1:
				mx += 0.8
			# During the warning, use the reaction window to sidestep a rival right behind us.
			if phase == "yellow" and brain.difficulty > 0.5:
				for o in seats:
					if is_same(o, seat) or not o.alive or o.finished:
						continue
					var dx: float = a.pos.x - o.actor.pos.x
					var dz: float = a.pos.z - o.actor.pos.z
					if dz < -0.2 and dz > -1.8 and absf(dx) < 1.2:
						mx = (signf(dx) if absf(dx) > 0.05 else parity) * 1.5
						mz = -0.3
						break
		var pace := lerpf(0.85, 1.0, brain.difficulty)
		var l := U.hypot(mx, mz)
		if l == 0.0:
			l = 1.0
		c.set_move((mx / l) * pace, (mz / l) * pace)
	else:
		c.set_move(0, 0)
		# Standing still under yellow/red: frame a rival standing in front of us.
		if phase != "green" and m.get("frame", false) and a.shove_cd <= 0 and a.stun <= 0:
			var fx_ := sin(a.facing)
			var fz := cos(a.facing)
			for o in seats:
				if is_same(o, seat) or not o.alive or o.finished:
					continue
				var dx: float = o.actor.pos.x - a.pos.x
				var dz: float = o.actor.pos.z - a.pos.z
				var d := U.hypot(dx, dz)
				if d > 1.4 or d < 0.01 or (dx * fx_ + dz * fz) / d < 0.5:
					continue
				if Rng.random() < dt * (0.8 + brain.difficulty * 3):
					want_b = true
				break
	# Buttons are edge-triggered: alternate so repeated intents become fresh presses.
	var press: bool = want_b and not m.get("b_prev", false)
	c.set_buttons(false, press)
	m["b_prev"] = press


func dispose() -> void:
	for seat in seats:
		seat.actor = null   # break the seat <-> actor reference cycle
	purge = []
	super.dispose()

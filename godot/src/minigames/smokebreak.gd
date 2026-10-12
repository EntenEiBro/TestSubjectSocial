extends Minigame
## SMOKE BREAK — mandatory relaxation, strictly measured.
##
## Rules
##  - Subjects sit on stools in a grim break room, each with a cigarette.
##  - HOLD A to inhale: your lung meter fills (faster the fuller it gets).
##  - RELEASE inside the green sweet zone for a good puff (+1) and a fat cloud.
##    Release below it: weak puff, nothing gained. Release above it: too
##    harsh, nothing gained. Hit the top of the meter: coughing fit, locked
##    out for 2 s.
##  - The sweet zone moves after every puff. Six good puffs finish a
##    cigarette; a new one is lit automatically.
##  - 40 s break. Most puffs wins. The subject(s) with the fewest puffs are
##    dealt with by the ceiling turret — unless everyone tied.
## Stool, ashtray, vending machine, clock, fixture, turret and cigarette
## models: blender/props/smokebreak.py. The JS DOM lung meters are drawn by
## a HUD overlay (MeterLayer).

const META := {
	"id": "smokebreak",
	"title": "SMOKE BREAK",
	"tagline": "Fifteen minutes of relaxation. Mandatory. Graded.",
	"category": "Timing",
	"controls": [{"input": "a", "label": "Hold to inhale, release to puff"}],
	"objective": "Take the most good puffs before the break ends.",
	"rules": [
		"Hold {A} to fill your lungs. Release inside the green zone for a good puff.",
		"Too early does nothing. Fill to the top and you cough for 2 seconds.",
		"The zone moves after every puff.",
		"Fewest puffs when the break ends is shown the exit. By the turret.",
	],
}

const DURATION := 40.0
const PUFFS_PER_CIG := 6
const COUGH_LOCK := 2.0
const CIG_LEN := 0.34           # full paper length (exaggerated for low-res readability)
const STOOL_Y := 0.82           # seat height: pelvis rests here when root sits at y = 0
const RAIL_Y := 4.3
const RAIL_Z := 1.6


## HUD overlay that draws every seat's lung meter (the JS DOM meters).
class MeterLayer extends Control:
	var game = null
	func _draw() -> void:
		if game != null:
			game._draw_meters(self)


var spacing := 2.5
var fan := {}
var fan_pos := Vector3.ZERO
var clock_hand: Node3D
var tube_mat: StandardMaterial3D
var tube_light: OmniLight3D
var turret: Node3D
var turret_pivot: Node3D
var turret_eye_mat: StandardMaterial3D
var laser: Node3D
var turret_target_x := 0.0
var meter_layer: MeterLayer = null
var phase := "play"     # play | reckoning
var losers := []
var flicker_t := 0.0
var flicker_off := false
var reckon_t := 0.0
var verdict := false
var exec_index := 0
var exec_t := 0.0


func build() -> void:
	var n := seats.size()
	spacing = 3.2 if n <= 2 else (2.8 if n == 3 else 2.5)
	var width := n * spacing
	make_scene({"fog_near": 14.0, "fog_far": 40.0, "ambient_intensity": 1.0})
	var cam_z := 6.2 + width * 0.45
	make_camera([0, 2.6, cam_z], [0, 1.55, 0], 45)
	scene.add_child(Env.dir_light(0xe0d8c8, 0.75, Vector3(1, 5, 10), Vector3.ZERO))

	_build_room(width)
	_build_turret(width)
	meter_layer = MeterLayer.new()
	meter_layer.game = self
	meter_layer.set_anchors_preset(Control.PRESET_FULL_RECT)
	meter_layer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if hud:
		hud.add_child(meter_layer)

	for i in n:
		_build_seat(seats[i], (i - (n - 1) / 2.0) * spacing)
	# Ashtray stands between neighbours.
	for i in n - 1:
		_ashtray((i + 0.5 - (n - 1) / 2.0) * spacing, -0.2)

	phase = "play"
	losers = []
	flicker_t = 0.0


# ------------------------------------------------------------------ stage

func _build_room(width: float) -> void:
	var w := width + 12
	Env.floor_plane(scene, w, 16, {"tex": "tiles", "tile": 1.5, "z": 2.0})
	Env.block(scene, 0, 3, -2.6, w, 6, 0.3, Mats.mat(0xb8b8a8, Tex.wall(Vector2(w / 4, 1.5))))
	Env.block(scene, 0, 0.5, -2.42, w, 1.0, 0.06, Mats.mat(0x4d5a4a, Tex.wall(Vector2(w / 4, 0.4)))) # dado band
	Env.stencil(scene, "BREAK ROOM", -width / 4 - 0.5, 3.85, -2.42, {"w": 5.0, "h": 1.7, "opacity": 0.5})
	Env.stencil(scene, "LUNGS ARE COMPANY PROPERTY", -width / 4 - 0.5, 3.0, -2.42, {"w": 5.0, "h": 0.75, "opacity": 0.75, "color": "#c0402c"})

	# Vending machine (Blender model) with its painted front.
	var vx := -width / 2 - 1.4
	var vend := Props.make("smokebreak", "vending")
	vend.position = Vector3(vx, 0, -1.8)
	scene.add_child(vend)
	scene.add_child(Env.mesh(Geo.plane(1.0, 1.9), Mats.glow(0xcfcfcf, {"tex": _vending_tex()}), vx - 0.05, 1.4, -1.34, {"cast": false}))
	var v_light := Env.point_light(0x9fd8ff, 3, 4, 1.5)
	v_light.position = Vector3(vx, 1.5, -0.8)
	scene.add_child(v_light)

	# Big wall fan.
	fan = Env.wall_fan(scene, width / 2 + 1.3, 3.2, -2.4, {"r": 1.1})
	fan_pos = Vector3(width / 2 + 1.3, 3.2, -2.2)

	# Wall clock (minute hand counts down the break).
	var clk := Props.make("smokebreak", "wall_clock")
	clk.position = Vector3(0.2, 4.3, -2.4)
	scene.add_child(clk)
	clock_hand = Node3D.new()
	clock_hand.position = Vector3(0.2, 4.3, -2.33)
	clock_hand.add_child(Env.mesh(Geo.box(0.03, 0.34, 0.02), Mats.glow(0x111111), 0, 0.15, 0))
	scene.add_child(clock_hand)

	# Flickering fluorescent tube.
	var tw := minf(6.0, width)
	var tube := Node3D.new()
	var housing := Props.make("smokebreak", "tube_fixture")
	housing.scale.x = tw / 6.0
	tube.add_child(housing)
	tube_mat = Mats.glow(0xe8fff0)
	tube.add_child(Env.mesh(Geo.box(tw - 0.3, 0.06, 0.12), tube_mat, 0, -0.06, 0, {"cast": false}))
	tube.position = Vector3(0, 4.6, 0.6)
	scene.add_child(tube)
	tube_light = Env.point_light(0xdcf5e4, 22, 14, 1.2)
	tube_light.position = Vector3(0, 4.2, 0.9)
	tube_light.shadow_enabled = Env.shadows_enabled
	scene.add_child(tube_light)


func _ashtray(x: float, z: float) -> void:
	var stand := Props.make("smokebreak", "ashtray")
	stand.position = Vector3(x, 0, z)
	scene.add_child(stand)
	var butt_mat := Mats.mat(0xd8c8a0)
	for k in 3:
		var butt := Env.mesh(Geo.cyl(0.02, 0.02, 0.1, 4), butt_mat, x + Rng.rand(-0.1, 0.1), 1.02, z + Rng.rand(-0.1, 0.1))
		butt.rotation.z = PI / 2
		butt.rotation.y = Rng.rand(0, 3)
		scene.add_child(butt)


## Rail-mounted ceiling turret that tracks the lowest scorer.
func _build_turret(width: float) -> void:
	Env.block(scene, 0, RAIL_Y + 0.25, RAIL_Z, width + 4, 0.12, 0.2, Mats.mat(0x2a2a28, Tex.metal()))
	var t := Node3D.new()
	t.add_child(Props.make("smokebreak", "turret_body"))
	turret_pivot = Node3D.new()
	turret_pivot.position.y = -0.2
	turret_pivot.add_child(Props.make("smokebreak", "turret_head"))
	turret_eye_mat = Mats.glow(0x550000)
	turret_pivot.add_child(Env.mesh(Geo.sphere(0.05, 6, 4), turret_eye_mat, 0.1, 0.08, 0.15, {"cast": false}))
	# Laser sight: unit-length box along +Z, scaled to the target distance.
	laser = Node3D.new()
	laser.add_child(Env.mesh(Geo.box(0.02, 0.02, 1), Mats.glow(0xff2020, {"opacity": 0.7}), 0, 0, 0.5, {"cast": false}))
	laser.visible = false
	turret_pivot.add_child(laser)
	t.add_child(turret_pivot)
	t.position = Vector3(width / 2 + 1.2, RAIL_Y, RAIL_Z)
	scene.add_child(t)
	turret = t
	turret_target_x = t.position.x


## Stool, subject, cigarette and lung meter for one seat.
func _build_seat(seat: Dictionary, x: float) -> void:
	var stool := Props.make("smokebreak", "stool")
	stool.position = Vector3(x, 0, 0)
	scene.add_child(stool)

	var s := spawn_subject(seat, {"x": x, "y": 0.0, "z": 0.0, "facing": 0.0})
	s.pose = "sit"
	seat.merge({
		"hand": s.parts.handR,
		"lung": 0.0, "mode": "idle", "mode_t": 0.0, "zone": _roll_zone(0.0), "on_cig": 0, "cig_no": 1, "inhale_k": 0.0,
		"status_text": "", "status_t": 0.0, "wisp_t": Rng.rand(0, 0.5), "exhale_left": 0, "lit": false,
	}, true)

	# Cigarette: filter at the group origin, paper + ember along +Z.
	var cig := Node3D.new()
	var filter := Props.make("smokebreak", "cig_filter")
	var paper := Props.make("smokebreak", "cig_paper")
	paper.position.z = 0.08
	var ember_mat := Mats.glow(0xff5a1a)
	var ember := Env.mesh(Geo.sphere(0.045, 6, 4), ember_mat, 0, 0, 0, {"cast": false})
	var ember_light := Env.point_light(0xff6a20, 0.6, 1.8, 1.5)
	ember.add_child(ember_light)
	U.add(cig, [filter, paper, ember])
	_no_shadow(cig)
	scene.add_child(cig)
	seat["cig"] = cig
	seat["paper"] = paper
	seat["ember"] = ember
	seat["ember_mat"] = ember_mat
	seat["ember_light"] = ember_light
	_set_cig_length(seat)


static func _no_shadow(n: Node) -> void:
	if n is GeometryInstance3D:
		(n as GeometryInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for c in n.get_children():
		_no_shadow(c)


func _set_cig_length(seat: Dictionary) -> void:
	var ln := CIG_LEN * (1.0 - 0.75 * (float(seat.on_cig) / PUFFS_PER_CIG))
	seat.paper.scale = Vector3(1, 1, ln)
	seat.ember.position.z = 0.08 + ln


# -------------------------------------------------------------- per frame

func preview(dt: float) -> void:
	_ambience(dt)
	for seat in seats:
		_animate_seat(seat, dt)
	_place_meters()


func update(dt: float) -> void:
	_ambience(dt)
	var playing := state == "play" and phase == "play"
	for seat in seats:
		if not seat.alive:
			continue
		_step_seat(seat, dt, playing)
		_animate_seat(seat, dt)
	_place_meters()
	for seat in seats:
		seat.status_t = maxf(0.0, seat.status_t - dt)
		hud.set_stat(seat, ("PUFFS %d · CIG %d" % [seat.score, seat.cig_no]) if seat.alive else "BREAK TERMINATED")
		hud.set_status(seat, seat.status_text if seat.alive and seat.status_t > 0 else "")
	if state != "play":
		return
	if phase == "play":
		hud.set_timer(DURATION - time)
		_track_lowest()
		if time >= DURATION:
			_begin_reckoning()
	else:
		_update_reckoning(dt)


## Lung mechanics for one seat.
func _step_seat(seat: Dictionary, dt: float, playing: bool) -> void:
	var a: bool = playing and seat.ctrl.a
	seat.mode_t = maxf(0.0, seat.mode_t - dt)
	match seat.mode:
		"idle":
			seat.lung = maxf(0.0, seat.lung - dt * 1.5)
			if a:
				seat.mode = "inhale"
				seat.lung = 0.0
				Sfx.play("inhale", {"vol": 0.8})
		"inhale":
			var spd := 1.0 + minf(time, DURATION) / DURATION * 0.5
			seat.lung += (0.32 + 0.75 * seat.lung) * spd * dt
			if seat.lung >= 1:
				seat.lung = 1.0
				_cough(seat)
			elif not a:
				_release(seat)
		"exhale":
			seat.lung = maxf(0.0, seat.lung - dt * 2.2)
			if seat.exhale_left > 0 and Rng.random() < dt * 9:
				seat.exhale_left -= 1
				fx.smoke(_mouth_pos(seat), {"size": Rng.rand(0.16, 0.28), "rise": 0.7, "life": 2.2, "opacity": 0.55, "color": 0xb8b8b0, "drift": _drift(seat, 0.9)})
			if seat.mode_t <= 0:
				seat.mode = _light(seat) if seat.on_cig >= PUFFS_PER_CIG else "idle"
		"cough":
			seat.lung = maxf(0.0, seat.lung - dt)
			if Rng.random() < dt * 4:
				fx.smoke(_mouth_pos(seat), {"size": 0.1, "rise": 0.4, "life": 1.0, "opacity": 0.4})
			if seat.mode_t <= 0:
				seat.mode = "idle"
		"light":
			if seat.mode_t <= 0.35 and not seat.lit:
				seat.lit = true
				seat.on_cig = 0
				seat.cig_no += 1
				_set_cig_length(seat)
				seat.cig.visible = true
				fx.sparks(seat.ember.global_position, {"count": 6, "color": 0xffc040, "speed": 2.0})
				Sfx.play("click")
				Sfx.play("burn", {"vol": 0.25})
			if seat.mode_t <= 0:
				seat.mode = "idle"


func _release(seat: Dictionary) -> void:
	var lo: float = seat.zone.lo
	var w: float = seat.zone.w
	if seat.lung >= lo and seat.lung <= lo + w:
		seat.score += 1
		seat.on_cig += 1
		_set_cig_length(seat)
		progress(seat, "chainSmoker", 1)
		seat.mode = "exhale"
		seat.mode_t = 0.75
		seat.exhale_left = 6
		Sfx.play("puff")
		_status(seat, "GOOD PUFF +1")
	elif seat.lung < lo:
		seat.mode = "exhale"
		seat.mode_t = 0.35
		seat.exhale_left = 1
		_status(seat, "WEAK")
	else:
		seat.mode = "exhale"
		seat.mode_t = 0.55
		seat.exhale_left = 2
		Sfx.play("wrong", {"vol": 0.35})
		_status(seat, "TOO HARSH")
	seat.zone = _roll_zone(time)


func _cough(seat: Dictionary) -> void:
	seat.mode = "cough"
	seat.mode_t = COUGH_LOCK
	seat.zone = _roll_zone(time)
	Sfx.play("cough")
	_status(seat, "COUGHING FIT")
	for i in 4:
		fx.smoke(_mouth_pos(seat), {"size": 0.12, "rise": 0.6, "life": 1.2, "opacity": 0.5, "drift": _drift(seat, 0.5)})


## Finish the stub and light a fresh one. Returns the new mode.
func _light(seat: Dictionary) -> String:
	seat.mode_t = 0.9
	seat.lit = false
	seat.cig.visible = false
	_status(seat, "LIGHTING UP")
	return "light"


func _status(seat: Dictionary, text: String) -> void:
	seat.status_text = text
	seat.status_t = 0.9


func _mouth_pos(seat: Dictionary) -> Vector3:
	return (seat.subject.parts.head as Node3D).to_global(Vector3(0, -0.09, 0.3))


## Smoke drift: forward from the face, bent toward the wall fan.
func _drift(seat: Dictionary, fwd: float) -> Vector3:
	var p: Vector3 = seat.subject.root.position
	return Vector3(0, 0, fwd) + (fan_pos - p).normalized() * 0.35


## Posing: sitting, arm to mouth while inhaling, cough shakes.
func _animate_seat(seat: Dictionary, dt: float) -> void:
	if not seat.alive:
		return
	var s: Subject = seat.subject
	var p: Dictionary = s.parts
	var t := clock
	s.animate(dt, 0)
	p.legL.rotation.x = -1.35
	p.legR.rotation.x = -1.35
	var want_up := 1.0 if seat.mode == "inhale" else (0.35 if seat.mode == "exhale" else 0.0)
	seat.inhale_k = lerpf(seat.inhale_k, want_up, U.damp(10, dt))
	var k: float = seat.inhale_k
	p.armR.rotation.x = lerpf(-1.0, -2.05, k)
	p.armR.rotation.z = lerpf(-0.12, -0.42, k)
	if seat.mode == "cough":
		p.torso.rotation.x = 0.35 + sin(t * 32) * 0.15
		p.head.rotation.x = 0.2 + sin(t * 32 + 1) * 0.2
		p.armL.rotation.x = -1.6
	elif seat.mode == "light":
		p.armL.rotation.x = -1.9  # cupping the lighter
		p.armL.rotation.z = 0.35

	# Cigarette transform: in hand at rest, in the mouth while inhaling.
	var cig: Node3D = seat.cig
	if not s.root.is_inside_tree():
		return
	var head: Node3D = p.head
	var hand_pos: Vector3 = (seat.hand as Node3D).global_position + Vector3(0, 0.02, 0.06)
	var mouth_pos := head.to_global(Vector3(0, -0.1, 0.2))
	var rest_dir := Vector3(0.15, 0.55, 1).normalized()
	var mouth_dir := (head.global_transform.basis.z.normalized() + Vector3(0, -0.15, 0)).normalized()
	var pos := hand_pos.lerp(mouth_pos, k)
	var dir := rest_dir.lerp(mouth_dir, k).normalized()
	cig.transform = Transform3D(Basis.looking_at(dir, Vector3.UP, true), pos)

	# Ember glow + idle wisps.
	var hot := 1.0 if seat.mode == "inhale" else 0.4 + sin(t * 7 + seat.player.slot) * 0.08
	Mats.set_color(seat.ember_mat, Color(1, 0.25 + hot * 0.45, 0.05 + hot * 0.15))
	(seat.ember_light as OmniLight3D).light_energy = (0.4 + hot * 2.2) * Env.LIGHT_K
	seat.wisp_t -= dt
	if seat.wisp_t <= 0 and cig.visible:
		seat.wisp_t = Rng.rand(0.35, 0.7)
		fx.smoke(seat.ember.global_position, {"size": 0.05, "rise": 0.7, "life": 1.6, "opacity": 0.3, "color": 0xc8c8c0, "drift": _drift(seat, 0.05)})


func _ambience(dt: float) -> void:
	fan.update.call(dt)
	# Fluorescent flicker: mostly steady, occasional stutters.
	flicker_t -= dt
	if flicker_t <= 0:
		if flicker_off:
			flicker_off = false
			flicker_t = Rng.rand(0.8, 3)
		elif Rng.random() < 0.35:
			flicker_off = true
			flicker_t = Rng.rand(0.04, 0.14)
		else:
			flicker_t = Rng.rand(0.3, 1.5)
	var level := 0.15 if flicker_off else 1.0
	tube_light.light_energy = 22 * level * Env.LIGHT_K
	var v := 0.92 if level > 0.5 else 0.25
	Mats.set_color(tube_mat, Color(v, v, v))
	var left := 0.0
	if state == "play" and phase == "play":
		left = maxf(0.0, DURATION - time)
	elif phase == "reckoning":
		left = 0.0
	else:
		left = DURATION
	clock_hand.rotation.z = -(left / 60) * TAU
	# Turret glides toward its target X.
	var tx := turret.position.x
	turret.position.x = tx + clampf(turret_target_x - tx, -dt * 7, dt * 7)


## During play the turret idly aims at whoever is currently last.
func _track_lowest() -> void:
	var alive := seats.filter(func(s): return s.alive)
	var mn := INF
	var mx := -INF
	for s in alive:
		mn = minf(mn, s.score)
		mx = maxf(mx, s.score)
	if mn == mx:
		turret_target_x = turret.position.x
		_aim_at(null)
		return
	var low = null
	for s in alive:
		if s.score == mn:
			low = s
			break
	turret_target_x = low.subject.root.position.x
	_aim_at(low)


func _aim_at(seat) -> Vector3:
	var target: Vector3 = seat.subject.parts.head.global_position if seat != null else turret.position + Vector3(0, -2, 1.2)
	var dir := target - (turret.position + turret_pivot.position)
	if dir.length() > 1e-4:
		turret_pivot.basis = Basis.looking_at(dir.normalized(), Vector3.UP, true)
	return target


## Project each meter next to its subject's head (drawn by MeterLayer).
func _place_meters() -> void:
	if meter_layer != null:
		meter_layer.queue_redraw()


## The JS DOM meter: a bordered bar with the red top band, the green sweet
## zone, the lung fill and a "N PUFFS" label, left edge beside the head.
func _draw_meters(ci: Control) -> void:
	if camera == null or not camera.is_inside_tree():
		return
	var vp := camera.get_viewport().get_visible_rect().size
	var u := UI.UPX
	var font := UI.font("vt")
	var fs := UI.u(2.4)
	var bw := 1.9 * u
	var bh := 14.0 * u
	var bd := 0.3 * u
	var sh := 0.2 * u
	var gap := 0.4 * u
	var outer := Vector2(bw + bd * 2, bh + bd * 2)
	for seat in seats:
		if not seat.alive:
			continue
		var hp: Vector3 = seat.subject.parts.head.global_position + Vector3(0.62, -0.45, 0)
		if camera.is_position_behind(hp):
			continue
		var sp := camera.unproject_position(hp) / vp * Vector2(1280, 720)
		var pc := U.col(seat.player.color)
		var txt := "%d PUFFS" % seat.score
		var tw := font.get_string_size(txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
		var col_w := maxf(outer.x + sh * 2, tw)
		var total_h := outer.y + sh * 2 + gap + fs
		var x0 := sp.x
		var y0 := sp.y - total_h / 2
		var shake := sin(clock * 50) * 3 if seat.mode == "cough" else 0.0
		var bx := x0 + (col_w - outer.x) / 2 + shake
		var by := y0 + sh
		ci.draw_rect(Rect2(bx - sh / 2, by - sh / 2, outer.x + sh, outer.y + sh), Color.BLACK, false, sh)
		ci.draw_rect(Rect2(bx, by, outer.x, outer.y), Color(8 / 255.0, 8 / 255.0, 6 / 255.0, 0.75))
		ci.draw_rect(Rect2(bx + bd / 2, by + bd / 2, outer.x - bd, outer.y - bd), pc, false, bd)
		var ix := bx + bd
		var iy := by + bd
		ci.draw_rect(Rect2(ix, iy, bw, bh * 0.05), Color("#7a1010"))
		var lo: float = seat.zone.lo
		var zw: float = seat.zone.w
		var zbot := iy + bh - lo * bh
		var zh := zw * bh
		var zx := ix - 0.3 * bw
		ci.draw_rect(Rect2(zx, zbot - zh - 4, bw * 1.6, zh + 4), Color(71 / 255.0, 1.0, 106 / 255.0, 0.35))
		ci.draw_rect(Rect2(zx, zbot - zh - 4, bw * 1.6, 2), UI.CRT)
		ci.draw_rect(Rect2(zx, zbot - 2, bw * 1.6, 2), UI.CRT)
		var in_zone: bool = seat.lung >= lo and seat.lung <= lo + zw
		var fill_c := Color("#7a1010") if seat.mode == "cough" else (UI.CRT if in_zone and seat.mode == "inhale" else pc)
		var fh := clampf(seat.lung, 0.0, 1.0) * bh
		ci.draw_rect(Rect2(ix + 0.15 * bw, iy + bh - fh, 0.7 * bw, fh), fill_c)
		var tp := Vector2(x0 + (col_w - tw) / 2, by + outer.y + sh + gap + fs * 0.8)
		ci.draw_string_outline(font, tp, txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, 4, Color(0, 0, 0, 0.8))
		ci.draw_string(font, tp, txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, UI.BONE)


# ---------------------------------------------------------------- ending

func _begin_reckoning() -> void:
	phase = "reckoning"
	reckon_t = 0.0
	verdict = false
	hud.set_timer(0)
	hud.banner("BREAK'S OVER", 1400)
	Sfx.play("horn")


func _update_reckoning(dt: float) -> void:
	reckon_t += dt
	if not verdict and reckon_t >= 0.8:
		verdict = true
		var mn := INF
		var mx := -INF
		for s in seats:
			mn = minf(mn, s.score)
			mx = maxf(mx, s.score)
		losers = [] if mn == mx else seats.filter(func(s): return s.score == mn)
		exec_index = 0
		exec_t = 0.0
		if not losers.is_empty():
			hud.banner("UNDER-INHALED", 1600, "danger")
			Sfx.play("sting")
		else:
			hud.banner("ALL SPARED", 1600, "good")
			end(2.4)
	if not verdict or losers.is_empty():
		return
	if exec_index >= losers.size():
		end(2.4)
		return
	var seat: Dictionary = losers[exec_index]
	# Glide over, paint with the laser, fire.
	turret_target_x = seat.subject.root.position.x
	var target := _aim_at(seat)
	var arrived := absf(turret.position.x - turret_target_x) < 0.05
	laser.visible = arrived
	Mats.set_color(turret_eye_mat, 0xff2020 if arrived else 0x550000)
	if arrived:
		var muzzle := turret.position + turret_pivot.position
		laser.scale = Vector3(1, 1, muzzle.distance_to(target))
		if exec_t == 0:
			Sfx.play("beep")
		exec_t += dt
		if exec_t >= 0.7:
			laser.visible = false
			fx.sparks(muzzle + (target - muzzle).normalized() * 0.7, {"count": 12, "color": 0xffe08a, "speed": 5.0})
			# Drop the cigarette, then the subject.
			seat.cig.visible = true
			fx.add_body(seat.cig, Vector3(Rng.rand(-1, 1), 2, 1.5), Vector3(Rng.rand(-8, 8), 0, Rng.rand(-8, 8)), {"bleed": false, "radius": 0.05, "life": 8.0})
			kill(seat, "shot", {"dir": Vector3(0, 0, -1), "force": 1.0})
			exec_index += 1
			exec_t = 0.0


func placement() -> Array:
	return Minigame.rank_by_score(seats)


# ------------------------------------------------------------------- bots

func bot_think(seat: Dictionary, _dt: float) -> void:
	var b: Dictionary = seat.brain
	var m: Dictionary = b.memory
	if phase != "play":
		seat.ctrl.set_buttons(false)
		return
	if seat.mode == "idle":
		if m.get("wait") == null:
			m.wait = time + b.reaction + Rng.rand(0, 0.4)
		if time >= m.wait:
			var lo: float = seat.zone.lo
			var w: float = seat.zone.w
			var jitter: float = (Rng.random() + Rng.random() - 1) * w * (1.25 - b.difficulty) * 0.9
			m.target = 1.1 if Rng.random() < b.error * 0.35 else lo + w * Rng.rand(0.3, 0.7) + jitter
			seat.ctrl.set_buttons(true)
		else:
			seat.ctrl.set_buttons(false)
	elif seat.mode == "inhale":
		# Release a hair early: the release lands one frame later.
		var tg = m.get("target")
		seat.ctrl.set_buttons(seat.lung < (tg if tg != null else 0.5) - 0.02)
		m.wait = null
	else:
		seat.ctrl.set_buttons(false)
		m.wait = null


func dispose() -> void:
	if meter_layer != null and is_instance_valid(meter_layer):
		meter_layer.game = null
		meter_layer.queue_free()
	meter_layer = null
	super.dispose()


# ======================================================================
# Helpers & procedural assets
# ======================================================================

## New sweet zone; it narrows slightly as the break drags on.
static func _roll_zone(t: float) -> Dictionary:
	var w := Rng.rand(0.12, 0.2) * (1 - minf(t, DURATION) / DURATION * 0.3)
	return {"lo": Rng.rand(0.28, 0.93 - w), "w": w}


## Front panel of the vending machine: rows of mystery rations (cached).
static func _vending_tex() -> Dictionary:
	return Tex.canvas("smoke-vending", 64, func(ci: CanvasItem, s: float):
		ci.draw_rect(Rect2(0, 0, s, s), Color("#10161a"))
		ci.draw_rect(Rect2(2, 2, s - 4, 8), Color("#c9a227"))
		ci.draw_string(UI.font("vt"), Vector2(0, 9.5), "RATIONS", HORIZONTAL_ALIGNMENT_CENTER, s, 9, Color("#1a1208"))
		var cols := ["#b5402a", "#3f7d74", "#c9a227", "#6b4a8f", "#8a8a80"]
		for r in 5:
			for k in 4:
				if randf() < 0.15:
					continue # sold out
				ci.draw_rect(Rect2(5 + k * 11, 14 + r * 9, 8, 6), Color(cols[(r + k * 2) % cols.size()]))
			ci.draw_rect(Rect2(4, 20 + r * 9, 44, 1), Color("#3a4448"))
		ci.draw_rect(Rect2(52, 14, 9, 30), Color("#222222"))
		ci.draw_rect(Rect2(54, 17, 5, 3), Color("#47ff6a"))
		ci.draw_rect(Rect2(6, 58, 40, 5), Color("#05080a")))

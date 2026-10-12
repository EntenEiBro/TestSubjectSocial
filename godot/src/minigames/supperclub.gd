extends Minigame
## SUPPER CLUB — a long dinner table, one dim chandelier and a plate of peas
## per guest. At the head of the table THE HOST reads his evening paper. He
## does not tolerate eating while he is watching.
##
## Rules:
##   - A loads one pea onto your fork (up to 3). B eats the forkful.
##   - The host periodically lowers his newspaper. A rustle and a creak warn you
##     (~0.6s) before his eyes light up red. Sometimes he only pretends.
##   - Pressing A or B at all while he watches gets you shot.
##   - First to clean the plate wins; the finishing order is recorded.
##   - 60s cap: whoever has the most peas left is shot. When only one diner is
##     still eating, the cap shrinks to 8 seconds.
## Furniture, candles, chandelier, plate, fork and revolver models:
## blender/props/supperclub.py.

const META := {
	"id": "supperclub",
	"title": "SUPPER CLUB",
	"tagline": "Dinner is served. Manners are enforced.",
	"category": "Stealth",
	"controls": [{"input": "a", "label": "Load fork"}, {"input": "b", "label": "Eat forkful"}],
	"objective": "Clean your plate first — without being seen eating.",
	"rules": [
		"{A} loads a pea onto your fork (three max). {B} eats the forkful.",
		"When the host lowers his paper and his eyes glow red, touch nothing.",
		"A rustle and a creak come first. Sometimes he is only bluffing.",
		"At the 60 second gong, the guest with the most peas left is excused. Permanently.",
	],
}

const PEAS := 22          # peas per plate
const FORK_MAX := 3
const CAP := 60.0         # round length (seconds)
const LAST_PLATE := 8.0   # seconds granted to the final unfinished diner
const TABLE_TOP := 0.76
const SEAT_X := 1.22      # distance of a diner from the table's centre line
const SIT_DROP := 0.4     # how far a seated subject's root is lowered
const SCOOP_TIME := 0.3
const EAT_TIME := 0.9
const WARN_TIME := 0.6

static var _news_grain: ImageTexture = null   # kept alive for the cached newspaper canvas

var per_side := 1
var table_len := 3.4
var host_z := 0.0
var pea_geo: Mesh
var pea_mat: StandardMaterial3D
var cap_at := CAP
var finish_order := []
var shot_queue := []
var _gong_done := false
var candle_light: OmniLight3D
var chandelier: Node3D
var key_light: SpotLight3D
var eye_mat: StandardMaterial3D
var eye_light: OmniLight3D
var gun: Node3D
var muzzle: Node3D
var flash: OmniLight3D
var paper: Node3D
var host := {}
var _sfx_queue := []      # [[delay, name, vol]] — JS setTimeout sounds, in game time


func build() -> void:
	make_scene({"fog": 0x0a0807, "fog_near": 10.0, "fog_far": 30.0, "ambient": 0x4a3a30, "ambient_intensity": 0.8})
	var n := seats.size()
	per_side = ceili(n / 2.0)
	table_len = maxf(3.4, per_side * 1.6 + 1.2)
	host_z = -table_len / 2 - 0.85
	make_camera([0, 3.7, table_len / 2 + 3.1], [0, 1.15, -0.95], 52)

	_build_room(scene)
	_build_table(scene)
	_build_host(scene)

	# Diners: alternate sides, front-to-back.
	pea_geo = Geo.sphere(0.034, 6, 4)
	pea_mat = Mats.mat(0x6aa632)
	for i in n:
		var seat: Dictionary = seats[i]
		var side := -1 if i % 2 == 0 else 1
		var j := floori(i / 2.0)
		var k := ceili(n / 2.0) if side < 0 else floori(n / 2.0)
		var z := (j - (k - 1) / 2.0) * 1.6 + 0.2
		_seat_diner(seat, side, z)

	cap_at = CAP
	finish_order = []
	shot_queue = []
	_gong_done = false


# ------------------------------------------------------------------ set

func _build_room(scn: Node3D) -> void:
	var W := 11.0
	var D := table_len + 7
	var carpet := Env.mesh(Geo.plane(W, D + 6), Mats.mat(0x5a1f1d, Tex.fabric(Vector2(10, 10))), 0, 0, 0, {"cast": false})
	carpet.rotation.x = -PI / 2
	scn.add_child(carpet)
	var panel := Mats.mat(0xb39a80, Tex.wood(Vector2(4, 2)))
	var back_z := host_z - 1.6
	Env.block(scn, 0, 2.5, back_z, W, 5, 0.3, panel)
	var side_mat := Mats.mat(0xa89078, Tex.wood(Vector2(6, 2)))
	Env.block(scn, -W / 2, 2.5, 0, 0.3, 5, D + 6, side_mat)
	Env.block(scn, W / 2, 2.5, 0, 0.3, 5, D + 6, side_mat)
	# Wainscot rail + grim portraits behind the host.
	Env.block(scn, 0, 1.1, back_z + 0.18, W, 0.08, 0.06, Mats.mat(0x3a2414, Tex.wood()))
	for x in [-3.0, 3.0]:
		var portrait := Props.make("supperclub", "portrait")
		portrait.position = Vector3(x, 2.9, back_z + 0.2)
		scn.add_child(portrait)
	Env.stencil(scn, "NO SECOND HELPINGS", 0, 4.25, back_z + 0.17, {"w": 5.5, "h": 1.2, "opacity": 0.35, "color": "#e8d9b0"})
	Env.pipe(scn, [-W / 2 + 0.3, 4.7, back_z + 0.3], [W / 2 - 0.3, 4.7, back_z + 0.3], 0.1)


func _build_table(scn: Node3D) -> void:
	var L := table_len
	# Table (top, runner, legs) as one Blender model in the matching length.
	var table := Props.make("supperclub", "table_%d" % roundi(L * 10))
	scn.add_child(table)

	# Candles (one shared warm light) + a tureen of something grey.
	for z in [-L / 2 + 0.6, L / 2 - 0.6]:
		var candle := Props.make("supperclub", "candle")
		candle.position = Vector3(0, TABLE_TOP, z)
		scn.add_child(candle)
	candle_light = Env.point_light(0xffb060, 3, 5, 1.5)
	candle_light.position = Vector3(0, TABLE_TOP + 0.6, 0)
	scn.add_child(candle_light)
	var tureen := Props.make("supperclub", "tureen")
	tureen.position = Vector3(0, TABLE_TOP, 0)
	scn.add_child(tureen)

	# The single dim chandelier.
	chandelier = Props.make("supperclub", "chandelier")
	chandelier.position = Vector3(0, 3.95, -0.3)
	scn.add_child(chandelier)
	key_light = Env.spot_light(0xffd8a0, 55, 20, 0.95, 0.7, 1.3)
	key_light.position = Vector3(0, 3.8, -0.3)
	Env.aim(key_light, Vector3(0, 0, -0.3))
	key_light.shadow_enabled = Env.shadows_enabled
	key_light.shadow_bias = 0.05
	scn.add_child(key_light)


## The host: an oversized Subject in a dark suit with a top hat and a newspaper.
func _build_host(scn: Node3D) -> void:
	var s := Subject.new({"suit": 0x1c1a1f, "skin": 0xd8cbb4, "hat": "Top Hat", "face": "Monocle", "number": "--"})
	var S := 1.4
	s.root.scale = Vector3.ONE * S
	s.root.position = Vector3(0, -SIT_DROP * S, host_z)
	s.pose = "sit"
	# Shirt front + bow tie over the jumpsuit patch.
	var chest: Node3D = s.parts.torso
	chest.add_child(Env.mesh(Geo.box(0.2, 0.42, 0.02), Mats.mat(0xe2dccb, Tex.fabric()), 0, 0.38, 0.156))
	chest.add_child(Env.mesh(Geo.box(0.16, 0.06, 0.03), Mats.mat(0x7a1414), 0, 0.6, 0.17))
	# Eyes that glow when he is watching.
	eye_mat = Mats.glow(0x2a0606)
	var head: Node3D = s.parts.head
	for x in [-0.1, 0.1]:
		head.add_child(Env.mesh(Geo.box(0.11, 0.07, 0.01), eye_mat, x, 0.05, 0.236, {"cast": false}))
	eye_light = Env.point_light(0xff2010, 0, 4, 1.5)
	eye_light.position = Vector3(0, 0.05, 1.2)
	head.add_child(eye_light)
	# Revolver in the right hand, hidden until needed (Blender model).
	gun = Props.make("supperclub", "revolver")
	gun.position = Vector3(0, -0.78, 0.05)
	gun.visible = false
	s.parts.armR.add_child(gun)
	muzzle = Node3D.new()
	muzzle.position = Vector3(0, -0.32, 0.03)
	gun.add_child(muzzle)
	flash = Env.point_light(0xffc070, 0, 8, 1.5)
	muzzle.add_child(flash)
	scn.add_child(s.root)

	# A dim spot so the host (and his eyes) read from across the table.
	var host_light := Env.spot_light(0xffe2b8, 11, 12, 0.55, 0.6, 1.2)
	host_light.position = Vector3(0, 3.6, host_z + 2.2)
	Env.aim(host_light, Vector3(0, 1.6, host_z))
	scn.add_child(host_light)

	# Throne-like chair.
	var throne := Props.make("supperclub", "throne")
	throne.position = Vector3(0, 0, host_z)
	scn.add_child(throne)

	# Newspaper on a pivot at its bottom edge, held in front of his face.
	var paper_mat := Mats.mat(0xa89f88, _news_texture(), {"double_side": true})
	var pivot := Node3D.new()
	var sheet_l := Env.mesh(Geo.plane(0.72, 0.95), paper_mat, -0.35, 0.47, 0.03)
	var sheet_r := Env.mesh(Geo.plane(0.72, 0.95), paper_mat, 0.35, 0.47, 0.03)
	sheet_l.rotation.y = 0.18   # slight fold
	sheet_r.rotation.y = -0.18
	U.add(pivot, [sheet_l, sheet_r])
	pivot.position = Vector3(0, 1.55, host_z + 0.75)
	scn.add_child(pivot)
	paper = pivot

	host = {
		"subject": s,
		"state": "reading",     # reading | warning | fakeHold | watching | raising
		"t": Rng.rand(2.5, 4),
		"age": 0.0,             # seconds in the current state
		"event": 0,             # increments each time a warning begins
		"fake": false,
		"lower": 0.0,           # 0 = paper up, 1 = fully lowered
		"aim": null,            # seat being aimed at
		"aim_t": 0.0,
		"gun_hold": 0.0,
		"facing": 0.0,
	}


## Seat a diner: chair, plate, peas (MultiMesh) and a fork in the right hand.
func _seat_diner(seat: Dictionary, side: int, z: float) -> void:
	var x := side * SEAT_X
	var s := spawn_subject(seat, {"x": x, "y": -SIT_DROP, "z": z, "facing": PI / 2 if side < 0 else -PI / 2, "ring": false})
	s.pose = "sit"
	# Chair (Blender model; its back is on +X, turned for the -X side).
	var chair := Props.make("supperclub", "chair")
	chair.position = Vector3(x, 0, z)
	chair.rotation.y = 0.0 if side > 0 else PI
	scene.add_child(chair)
	# Player-coloured place card so everyone finds their plate.
	var card := Env.mesh(Geo.box(0.04, 0.08, 0.22), Mats.glow(seat.player.color), side * 0.18, TABLE_TOP + 0.04, z + 0.32, {"cast": false})
	scene.add_child(card)
	# Plate + peas
	var px := side * 0.52
	var plate := Props.make("supperclub", "plate")
	plate.position = Vector3(px, TABLE_TOP + 0.015, z)
	scene.add_child(plate)
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = pea_geo
	mm.instance_count = PEAS
	for i in PEAS:
		var a := Rng.rand(0, TAU)
		var r := sqrt(Rng.random()) * 0.17
		mm.set_instance_transform(i, Transform3D(Basis(), Vector3(px + cos(a) * r, TABLE_TOP + 0.064 + (0.03 if i > 14 else 0.0), z + sin(a) * r)))
	var peas := MultiMeshInstance3D.new()
	peas.multimesh = mm
	peas.material_override = pea_mat
	scene.add_child(peas)
	# Fork: handle + head with three tines (Blender model), angled forward-down from the hand.
	var fork := Props.make("supperclub", "fork")
	var load := []
	for i in FORK_MAX:
		var p := Env.mesh(pea_geo, pea_mat, (i - 1) * 0.026, 0.025, 0.21)
		p.visible = false
		fork.add_child(p)
		load.append(p)
	fork.position = Vector3(0, -0.76, 0.03)
	fork.rotation.x = PI / 4
	s.parts.armR.add_child(fork)

	seat["diner"] = {
		"side": side, "z": z, "peas": PEAS, "fork": 0, "peas_mm": mm, "load": load,
		"anim": "", "anim_t": 0.0, "finished": 0, "condemned": false, "arm_x": -1.1, "arm_z": 0.0, "chew": 0.0,
		"ate": false, "finish_time": 0.0,
	}


# ------------------------------------------------------------- lifecycle

func start() -> void:
	Sfx.play("ding")
	hud.banner("BON APPÉTIT", 1200, "good")


func preview(dt: float) -> void:
	_animate_host(dt)
	for seat in seats:
		_animate_diner(seat, dt)


## 0 → 1 tension ramp across the round.
func ramp() -> float:
	return clampf(time / 45.0, 0, 1)


func update(dt: float) -> void:
	_tick_sfx(dt)
	var playing := state == "play"
	if playing:
		_run_host(dt)
		for seat in alive_seats():
			_handle_input(seat)
		_run_shots(dt)
		_check_end()
	else:
		_run_shots(dt)
	_animate_host(dt)
	for seat in seats:
		if seat.alive:
			_animate_diner(seat, dt)

	if not playing:
		return
	hud.set_timer(maxf(0.0, cap_at - time))
	for seat in seats:
		var d: Dictionary = seat.diner
		if not seat.alive:
			hud.set_stat(seat, "EXCUSED")
			hud.set_status(seat, "")
			continue
		var fork_txt := "  FORK %d" % d.fork if d.fork > 0 else ""
		hud.set_stat(seat, "PLATE CLEAN" if d.finished > 0 else "PEAS %d%s" % [d.peas, fork_txt])
		hud.set_status(seat, "FINISHED #%d" % d.finished if d.finished > 0 else ("CAUGHT" if d.condemned else ""))


## Delayed sounds (JS setTimeout), counted in game time.
func _tick_sfx(dt: float) -> void:
	for i in range(_sfx_queue.size() - 1, -1, -1):
		var e: Array = _sfx_queue[i]
		e[0] -= dt
		if e[0] <= 0.0:
			Sfx.play(e[1], {"vol": e[2]})
			_sfx_queue.remove_at(i)


func _go(st: String, t: float) -> void:
	host.state = st
	host.t = t
	host.age = 0.0


## Host behaviour: read → warn (rustle, creak) → watch / bluff → raise paper.
func _run_host(dt: float) -> void:
	var h := host
	h.t -= dt
	h.age += dt
	match h.state:
		"reading":
			if Rng.random() < dt * 0.6:
				Sfx.play("search", {"vol": 0.25})   # idle page rustle
			if h.t <= 0:
				h.event += 1
				h.fake = Rng.random() < 0.28
				_go("warning", WARN_TIME)
				Sfx.play("puff", {"vol": 0.9})       # paper rustle
				Sfx.play("grind", {"vol": 0.25})     # chair creak
		"warning":
			if h.t <= 0:
				if h.fake:
					_go("fakeHold", Rng.rand(0.25, 0.45))
				else:
					_go("watching", Rng.rand(1.4, 2.6) + ramp() * 0.6)
					Sfx.play("sting", {"vol": 0.35})
		"fakeHold":
			if h.t <= 0:
				_go("raising", 0.35)
				Sfx.play("puff", {"vol": 0.5})
		"watching":
			if h.t <= 0 and h.aim == null and shot_queue.is_empty() and not _gong_done:
				_go("raising", 0.4)
				Sfx.play("puff", {"vol": 0.6})
		"raising":
			if h.t <= 0:
				_go("reading", Rng.rand(lerpf(2.0, 1.2, ramp()), lerpf(4.8, 3.0, ramp())))


func watching() -> bool:
	return host.state == "watching"


## Read one diner's buttons. Any press while the host watches is fatal.
func _handle_input(seat: Dictionary) -> void:
	var d: Dictionary = seat.diner
	var c: Controller = seat.ctrl
	if d.finished > 0 or d.condemned:
		return
	if not c.a_pressed and not c.b_pressed:
		return
	if watching():
		_condemn(seat)
		return
	if d.anim != "":
		return   # still mid-motion
	if c.a_pressed and d.fork < FORK_MAX and d.peas - d.fork > 0:
		d.fork += 1
		d.anim = "scoop"
		d.anim_t = SCOOP_TIME
		Sfx.play("fork", {"vol": 1.4})
	elif c.b_pressed and d.fork > 0:
		d.anim = "eat"
		d.anim_t = EAT_TIME
		d.ate = false


## Mark a diner as caught; the host will turn and fire.
func _condemn(seat: Dictionary, reason: String = "CAUGHT EATING") -> void:
	var d: Dictionary = seat.diner
	if d.condemned or not seat.alive:
		return
	d.condemned = true
	shot_queue.append(seat)
	host.t = maxf(host.t, 0.8)
	hud.feed("%s — %s" % [seat.player.name(), reason], seat.player.color)


## Aim at queued victims one by one, then fire.
func _run_shots(dt: float) -> void:
	var h := host
	h.gun_hold = maxf(0.0, h.gun_hold - dt)
	if h.aim == null:
		while not shot_queue.is_empty() and not shot_queue[0].alive:
			shot_queue.pop_front()
		if not shot_queue.is_empty():
			h.aim = shot_queue.pop_front()
			h.aim_t = 0.4
			gun.visible = true
			Sfx.play("reload", {"vol": 0.8})
	if h.aim != null:
		h.aim_t -= dt
		h.gun_hold = 0.8
		if h.aim_t <= 0:
			var seat: Dictionary = h.aim
			h.aim = null
			var from_p := muzzle.global_position
			var to_p: Vector3 = seat.subject.parts.chest.global_position
			flash.light_energy = 60.0 * Env.LIGHT_K
			fx.sparks(from_p, {"count": 12, "speed": 5.0})
			fx.smoke(from_p, {"size": 0.15, "life": 1.2, "opacity": 0.4})
			kill(seat, "shot", {"dir": to_p - from_p})
	if h.gun_hold <= 0 and h.aim == null:
		gun.visible = false


## Round end: plates cleaned, executions resolved, or the gong.
func _check_end() -> void:
	if host.aim != null or not shot_queue.is_empty():
		return
	var alive := alive_seats()
	var eating := alive.filter(func(s): return s.diner.finished == 0)
	if alive.size() <= 1 or eating.is_empty():
		end()
		return
	# Only one guest still eating: hurry them along.
	if eating.size() == 1 and not finish_order.is_empty() and cap_at > time + LAST_PLATE:
		cap_at = time + LAST_PLATE
		hud.banner("LAST PLATE", 1400, "danger")
		Sfx.play("beep")
	if time >= cap_at:
		if _gong_done:
			end()
			return
		_gong_done = true
		Sfx.play("horn")
		# Exactly one guest is excused: most peas left; ties go to whoever has
		# the emptiest fork, then to chance.
		var sorted := eating.duplicate()
		sorted.sort_custom(func(a, b):
			if a.diner.peas != b.diner.peas:
				return a.diner.peas > b.diner.peas
			return a.diner.fork < b.diner.fork)
		var top: Dictionary = sorted[0]
		var tied := sorted.filter(func(s): return s.diner.peas == top.diner.peas and s.diner.fork == top.diner.fork)
		var victim: Dictionary = Rng.pick(tied)
		hud.banner("DINNER IS OVER", 1600, "danger")
		# The host lowers his paper for the occasion.
		host.state = "watching"
		host.t = 2.0
		host.age = 0.0
		_condemn(victim, "SLOWEST EATER")


# ------------------------------------------------------------- animation

func _animate_host(dt: float) -> void:
	var h := host
	var s: Subject = h.subject
	var p := s.parts
	var target := 0.0
	match h.state:
		"warning":
			target = 0.45 * clampf(h.age / WARN_TIME, 0, 1)
		"fakeHold":
			target = 0.45
		"watching":
			target = 1.0
	var rate := 30.0 if h.state == "warning" else (14.0 if h.state == "watching" else 8.0)
	h.lower += (target - h.lower) * U.damp(rate, dt)
	# Paper: upright in front of the face → tipped forward and down.
	var rustle := sin((clock * 1000) * 0.011) * 0.015 if h.state == "reading" else 0.0
	paper.rotation.x = h.lower * 0.6 + rustle
	paper.position.y = 1.55 - h.lower * 0.62
	# Eyes (THREE setRGB takes linear values)
	var lit := 1.0 if h.state == "watching" else (0.25 if h.state == "warning" or h.state == "fakeHold" else 0.0)
	Mats.set_color(eye_mat, Color(0.16 + lit * 0.84, 0.03 + lit * 0.12, 0.03 + lit * 0.05).linear_to_srgb())
	eye_light.light_energy = lit * 3 * Env.LIGHT_K
	flash.light_energy *= exp(-dt * 25)

	# Body: turn toward the current target when shooting.
	var face := 0.0
	if h.aim != null:
		var q: Vector3 = h.aim.subject.root.position
		face = atan2(q.x - 0, q.z - host_z)
	h.facing += (face - h.facing) * U.damp(10, dt)
	s.root.rotation.y = h.facing
	s.animate(dt, 0)
	var hold_x := lerpf(-1.35, -0.95, h.lower)
	p.armL.rotation.x = hold_x
	p.armL.rotation.z = 0.25
	p.armR.rotation.x = -1.5 if gun.visible else hold_x
	p.armR.rotation.z = 0.0 if gun.visible else -0.25
	p.head.rotation.x = 0.18 if h.state == "reading" else -0.05


func _animate_diner(seat: Dictionary, dt: float) -> void:
	var d: Dictionary = seat.diner
	var s: Subject = seat.subject
	var p := s.parts
	s.animate(dt, 0)
	var ax := -1.1
	var az := 0.0
	if d.anim != "":
		d.anim_t -= dt
		if d.anim == "scoop":
			var k: float = 1 - d.anim_t / SCOOP_TIME
			ax = -1.1 + sin(k * PI) * 0.28
		else:
			var k: float = 1 - d.anim_t / EAT_TIME
			ax = -2.5 if k < 0.75 else -1.1
			az = -0.5 if k < 0.75 else 0.0
			if k > 0.4 and not d.ate:
				_swallow(seat)
		if d.anim_t <= 0:
			d.anim = ""
	d.arm_x += (ax - d.arm_x) * U.damp(18, dt)
	d.arm_z += (az - d.arm_z) * U.damp(18, dt)
	p.armR.rotation.x = d.arm_x
	p.armR.rotation.z = d.arm_z
	p.armL.rotation.x = -0.9
	# Chewing nod
	if d.chew > 0:
		d.chew -= dt
		p.head.rotation.x = sin(d.chew * 30) * 0.08
	else:
		p.head.rotation.x = 0.15
	# Fork load + plate contents
	var load: Array = d.load
	for i in load.size():
		load[i].visible = i < d.fork
	var mm: MultiMesh = d.peas_mm
	mm.visible_instance_count = maxi(0, d.peas - d.fork)


## Forkful reaches the mouth: peas leave the world.
func _swallow(seat: Dictionary) -> void:
	var d: Dictionary = seat.diner
	d.ate = true
	d.peas -= d.fork
	d.fork = 0
	d.chew = 0.5
	for i in 3:
		_sfx_queue.append([i * 0.12, "chew", 1.3])
	if d.peas <= 0 and d.finished == 0 and state == "play":
		d.finished = finish_order.size() + 1
		d.finish_time = time
		finish_order.append(seat)
		Sfx.play("win" if d.finished == 1 else "ding")
		hud.banner("%s — PLATE CLEAN" % seat.player.name(), 1400, "good")
		if time < 20:
			award(seat, "speedEater")


# ------------------------------------------------------------- placement

## Finishers in order, then the unfinished by fewest peas, then the dead (latest first).
func placement() -> Array:
	var tiers := []
	for s in finish_order:
		if s.alive:
			tiers.append([s])
	var rest := alive_seats().filter(func(s): return s.diner.finished == 0)
	rest.sort_custom(func(a, b): return a.diner.peas < b.diner.peas)
	tiers.append_array(Minigame.group_by(rest, func(s): return s.diner.peas))
	var dead := deaths.duplicate()
	dead.reverse()
	tiers.append_array(Minigame.group_by(dead, func(s): return snappedf(s.death_time, 0.001)))
	return tiers


# ------------------------------------------------------------------- bots

func bot_think(seat: Dictionary, dt: float) -> void:
	var d: Dictionary = seat.diner
	var c: Controller = seat.ctrl
	var b: Dictionary = seat.brain
	var m: Dictionary = b.memory
	var h := host
	c.set_buttons(false, false)
	c.set_move(0, 0)
	if d.finished > 0 or d.condemned:
		return
	# New warning? Decide how long this bot keeps eating before it notices
	# (clumsy bots sometimes get greedy and don't stop in time).
	if m.get("event", -1) != h.event:
		m["event"] = h.event
		m["stop_after"] = b.reaction + (Rng.rand(0.5, 1.1) if Rng.random() < b.error * 0.9 else 0.0)
		m["resume"] = b.reaction + Rng.rand(0.1, 0.45)
	var safe := false
	match h.state:
		"reading":
			safe = h.age > m.get("resume", 0.3)
		"warning":
			safe = h.age < m.get("stop_after", 0.0)
		"watching":
			safe = h.age < m.get("stop_after", 0.0) - WARN_TIME   # still "reacting"
		"raising":
			# With the gong close, desperate bots start eating while the paper is still rising.
			safe = cap_at - time < 8
	if not m.has("pace"):
		m["pace"] = Rng.rand(0.0, 0.14) * (1.3 - b.difficulty)   # per-bot table manners
	m["cd"] = m.get("cd", 0.0) - dt
	if not safe or d.anim != "" or m.get("pressed", false):
		m["pressed"] = false
		return
	if m.cd > 0:
		return
	if d.fork < FORK_MAX and d.peas - d.fork > 0:
		c.set_buttons(true, false)
		m.cd = SCOOP_TIME + m.pace + Rng.rand(0.02, 0.1)
	elif d.fork > 0:
		c.set_buttons(false, true)
		m.cd = EAT_TIME + m.pace + Rng.rand(0.05, 0.2)
	m["pressed"] = true   # release on the next think so presses register as taps


# ------------------------------------------------------------- textures

## Paint the host's newspaper front page (original, procedurally scribbled).
## 256×176 page painted into the top of a cached 256² canvas (UV-scaled to it).
static func _news_texture() -> Dictionary:
	return Tex.canvas("supperclubNews", 256, func(ci: CanvasItem, _s: float):
		if _news_grain == null:
			var img := Image.create(256, 176, false, Image.FORMAT_RGBA8)
			var base := Color("#cdc6ae")
			for y in 176:
				for x in 256:
					var n := (randf() - 0.5) * 22.0 / 255.0
					img.set_pixel(x, y, Color(base.r + n, base.g + n, base.b + n))
			_news_grain = ImageTexture.create_from_image(img)
		ci.draw_texture(_news_grain, Vector2.ZERO)
		var ink := Color("#1d1b17")
		var font := UI.font("elite")
		_draw_fit(ci, font, "THE EVENING LEDGER", 26, 22, 236, ink)
		ci.draw_rect(Rect2(10, 33, 236, 2), ink)
		_draw_fit(ci, font, "GUESTS URGED TO CHEW QUIETLY", 52, 15, 236, ink)
		# Columns of fake copy + a murky photo.
		var copy := Color(30 / 255.0, 28 / 255.0, 24 / 255.0, 0.55)
		for col in 4:
			var y := 62
			while y < 168:
				if not (col == 1 and y < 110):
					ci.draw_rect(Rect2(12 + col * 59, y, randf_range(40, 54), 2), copy)
				y += 5
		ci.draw_rect(Rect2(71, 62, 54, 44), Color("#4a463d"))
		ci.draw_circle(Vector2(98, 80), 10, Color("#2a2722"))
		ci.draw_rect(Rect2(86, 90, 24, 16), Color("#2a2722")), Vector2(1, 176.0 / 256.0))


## Centred text at baseline y, shrunk to fit max_w.
static func _draw_fit(ci: CanvasItem, font: Font, text: String, y: float, size: int, max_w: float, color: Color) -> void:
	var w := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	if w > max_w:
		size = int(size * max_w / w)
		w = font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	ci.draw_string(font, Vector2((256 - w) / 2.0, y), text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, color)

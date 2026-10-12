extends Minigame
## ALCOVE ROULETTE — a maintenance tunnel, six one-person nooks and a train
## that has never once braked.
##
## Rules
##  - The track runs left↔right (X axis) through the tunnel. Three nooks are
##    recessed into the far wall (-Z) and three into the near wall (+Z).
##  - Every cycle: CALM (wander) → WARNING (~4 s: klaxon, the tunnel mouth
##    glows, each nook lights GREEN = safe or RED = a ceiling press will drop)
##    → TRAIN (sweeps the whole tunnel floor) → VENT (steam blasts everyone
##    back out of the nooks).
##  - Safe nooks per cycle = living subjects - 1 (min 1). Somebody always loses.
##  - A nook holds exactly ONE body. An occupied nook is a wall to everyone
##    else — but SHOVE (B) aimed at the occupant yanks them out.
##  - Caught on the tracks: 'gib' along the train's heading. Inside a red nook:
##    'crush'. Last subject alive wins. After 6 cycles the warnings shorten.
##
## Train and ceiling presses are Blender models (blender/props/alcove.py).

const META := {
	"id": "alcove",
	"title": "ALCOVE ROULETTE",
	"tagline": "Mind the gap. There is only one gap. It is taken.",
	"category": "Survival",
	"controls": [{"input": "move", "label": "Move"}, {"input": "b", "label": "Shove / Evict"}],
	"objective": "Be inside a GREEN nook every time the train comes through.",
	"rules": [
		"Nooks light GREEN (safe) or RED (a press drops) before each train.",
		"There is always one fewer safe nook than survivors.",
		"One body per nook. Shove an occupant to drag them out.",
		"Steam vents clear the nooks after every train.",
	],
}

const HALF := 2.6          # tunnel half-depth: wall faces at z = ±HALF
const DEPTH := 1.15        # nook depth beyond the wall face
const NOOK_W := 1.4        # nook opening width (x) — fits exactly one body
const XMAX := 10.0         # walkable tunnel half-length
const SAFE_DEPTH := 0.18   # centre must be this far past the wall line to dodge the train
const NOOKS := [[-7.0, -1], [-1.0, -1], [5.0, -1], [-5.0, 1], [1.0, 1], [7.0, 1]] # [x, side]
const CAR_LEN := 6.4
const CAR_GAP := 0.5
const CARS := 4
const TRAIN_LEN := CARS * CAR_LEN + (CARS - 1) * CAR_GAP
const TRAIN_SPEED := 34.0
const TRAIN_START := XMAX + 10   # |x| where the train front appears / tail disappears
const PRESS_UP := 3.0
const PRESS_DOWN := 0.45
const LAMP := {"off": 0x23231f, "red": 0xff2a1a, "green": 0x35ff4a}

var arena: Arena
var nooks := []
var mouth_glow: MeshInstance3D
var mouth_mat: StandardMaterial3D
var mouth_light: OmniLight3D
var train: Node3D
var phase := "calm"
var phase_t := 0.0
var calm_dur := 2.5
var warn_dur := 4.0
var cycle := 0
var train_dir := 1.0
var train_front := 0.0
var preview_t := 3.0
var beep_t := 0.0
var horn_done := false


func build() -> void:
	make_scene({"fog_near": 18.0, "fog_far": 48.0, "ambient_intensity": 1.0})
	make_camera([0, 13.5, 10.8], [0, 0, 0.35], 46)
	arena = Arena.new({"bounds": {"min_x": -XMAX, "max_x": XMAX, "min_z": -HALF - DEPTH, "max_z": HALF + DEPTH}, "shove_force": 12.0})

	# --- floor, ballast and track
	Env.floor_plane(scene, 100, 30, {"tex": "concrete", "tile": 3.0})
	Env.floor_plane(scene, 100, 3.2, {"tex": "dirt", "tile": 2.0, "y": 0.01})
	var rail_mat := Mats.mat(0xa09f96, Tex.metal())
	for z in [-0.72, 0.72]:
		Env.block(scene, 0, 0.13, z, 100, 0.14, 0.12, rail_mat)
	var n := 90
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = Geo.box(0.35, 0.08, 2.3)
	mm.instance_count = n
	for i in n:
		mm.set_instance_transform(i, Transform3D(Basis(), Vector3(-49.5 + i * 1.1, 0.045, 0)))
	var sleepers := MultiMeshInstance3D.new()
	sleepers.multimesh = mm
	sleepers.material_override = Mats.mat(0xffffff, Tex.wood())
	sleepers.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	scene.add_child(sleepers)
	Env.hazard_strip(scene, 0, -HALF + 0.22, 100, 0.3, 0.02)
	Env.hazard_strip(scene, 0, HALF - 0.22, 100, 0.3, 0.02)
	for sx in [-1, 1]:
		Env.hazard_strip(scene, sx * (XMAX + 0.2), 0, 0.4, HALF * 2, 0.025)

	# --- walls with nook recesses (far wall tall, near wall cut away for the camera)
	_build_wall(-1, 3.2)
	_build_wall(1, 0.7)
	Env.stencil(scene, "KEEP CLEAR", -4, 2.2, -HALF + 0.02, {"w": 4.0, "h": 1.3, "opacity": 0.55})
	Env.stencil(scene, "ONE PER NOOK", 2, 2.2, -HALF + 0.02, {"w": 4.4, "h": 1.3, "opacity": 0.55})
	Env.stencil(scene, "LINE 9", -10.5, 2.0, -HALF + 0.02, {"w": 3.0, "h": 1.1, "opacity": 0.4})
	Env.pipe(scene, [-50, 2.85, -HALF + 0.15], [50, 2.85, -HALF + 0.15], 0.1, 0x3c3a34)
	Env.pipe(scene, [-50, 2.55, -HALF + 0.12], [50, 2.55, -HALF + 0.12], 0.06, 0x5a2a20)

	Env.hanging_lamp(scene, -6, 7, 0, {"intensity": 80.0, "angle": 0.95})
	Env.hanging_lamp(scene, 0, 7, 0, {"intensity": 80.0, "angle": 0.95})
	Env.hanging_lamp(scene, 6, 7, 0, {"intensity": 80.0, "angle": 0.95})

	# --- the nooks: floor lamp tile, coloured light, hydraulic press (Blender model)
	nooks = []
	for k in NOOKS.size():
		var x: float = NOOKS[k][0]
		var side: int = NOOKS[k][1]
		var zc := side * (HALF + DEPTH / 2)
		var tile_mat := Mats.glow(LAMP.off)
		var tile := Env.mesh(Geo.plane(NOOK_W - 0.12, DEPTH - 0.08), tile_mat, x, 0.03, zc, {"cast": false})
		tile.rotation.x = -PI / 2
		scene.add_child(tile)
		var light := Env.point_light(LAMP.off, 0, 5.5, 1.5)
		light.position = Vector3(x, 1.6, zc - side * 0.6)
		scene.add_child(light)
		var press := Props.make("alcove", "press")
		press.position = Vector3(x, PRESS_UP, zc)
		scene.add_child(press)
		nooks.append({"i": k, "x": x, "side": side, "zc": zc, "tile_mat": tile_mat, "light": light, "press": press, "press_y": PRESS_UP,
			"press_target": PRESS_UP, "occupant": null, "safe": false, "state": "off", "slammed": false, "crushed": false})

	# --- tunnel mouth glow (grows during the warning): additive billboard
	mouth_mat = Mats.glow(0xfff1c4, {"tex": _glow_texture(), "additive": true, "opacity": 0.0})
	mouth_mat.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	mouth_mat.billboard_keep_scale = true
	mouth_glow = Env.mesh(Geo.plane(1, 1), mouth_mat, -XMAX - 4, 1.5, 0, {"cast": false})
	scene.add_child(mouth_glow)
	mouth_light = Env.point_light(0xfff0c8, 0, 20, 1.2)
	mouth_light.position = Vector3(-XMAX - 3, 1.6, 0)
	scene.add_child(mouth_light)

	_build_train()

	# --- avatars
	for i in seats.size():
		var seat: Dictionary = seats[i]
		var x := (i - (seats.size() - 1) / 2.0) * 3   # centred line-up on the tracks
		var z := 0.0
		spawn_subject(seat, {"x": x, "z": z})
		seat.actor = arena.add(ArenaActor.new({"player": seat.player, "ctrl": seat.ctrl, "subject": seat.subject, "x": x, "z": z}))
		seat.actor.seat = seat
	arena.on_shove = func(att: ArenaActor, vic: ArenaActor): _evict(att, vic)

	phase = "calm"
	phase_t = 0.0
	calm_dur = 2.5
	warn_dur = 4.0
	cycle = 0
	train_dir = 1.0
	train_front = 0.0
	preview_t = 3.0
	beep_t = 0.0


## One tunnel wall with three nook recesses. Solid segments become arena
## walls; the nook back walls are enforced by the arena bounds.
## side: -1 = far wall, +1 = near wall; h = wall height.
func _build_wall(side: int, h: float) -> void:
	var xs := []
	for nk in NOOKS:
		if nk[1] == side:
			xs.append(float(nk[0]))
	xs.sort()
	var thick := DEPTH + 0.5
	var zc := side * (HALF + thick / 2)
	var seg := func(a: float, b: float):
		if b - a < 0.01:
			return
		Env.block(scene, (a + b) / 2, h / 2, zc, b - a, h, thick, Mats.mat(0xffffff, Tex.wall(Vector2((b - a) / 3, h / 3))))
		var z0 := side * HALF
		var z1 := side * (HALF + thick + 1)
		arena.add_wall(a, b, minf(z0, z1), maxf(z0, z1))
	var x0 := -50.0
	var back_mat := Mats.mat(0x8a8478, Tex.concrete(Vector2(0.5, h / 3)))
	for x in xs:
		seg.call(x0, x - NOOK_W / 2)
		Env.block(scene, x, h / 2, side * (HALF + DEPTH + 0.25), NOOK_W, h, 0.5, back_mat)
		x0 = x + NOOK_W / 2
	seg.call(x0, 50.0)


## Long low-poly train (Blender model); local +X is the nose, cars trail toward -X.
func _build_train() -> void:
	var g := Node3D.new()
	g.add_child(Props.make("alcove", "train"))
	# A travelling light so the train lights the tunnel.
	var head := Env.point_light(0xfff0c8, 50, 16, 1.2)
	head.position = Vector3(2, 1.5, 0)
	g.add_child(head)
	g.visible = false
	scene.add_child(g)
	train = g


func start() -> void:
	phase = "calm"
	phase_t = 0.0
	calm_dur = 2.5
	_set_lamps("off")
	train.visible = false
	hud.banner("FIND YOUR NOOK", 1300)


func preview(dt: float) -> void:
	for s in seats:
		s.subject.animate(dt, 0)
	# Demo trains roll through while the briefing is up.
	preview_t -= dt
	if preview_t <= 0 and not train.visible:
		preview_t = 6.0
		var order := Rng.shuffle(nooks)
		for i in order.size():
			_lamp(order[i], "green" if i < 3 else "red")
		_launch_train(1.0 if Rng.random() < 0.5 else -1.0, false)
	_animate(dt)


# ------------------------------------------------------------------ phases

func _start_warning() -> void:
	cycle += 1
	var safe_count := maxi(1, alive_seats().size() - 1)
	var order := Rng.shuffle(nooks)
	for i in order.size():
		var nk: Dictionary = order[i]
		nk.safe = i < safe_count
		nk.slammed = false
		nk.crushed = false
		_lamp(nk, "green" if nk.safe else "red")
	train_dir = 1.0 if Rng.random() < 0.5 else -1.0
	warn_dur = warn_for(cycle)
	phase = "warn"
	phase_t = 0.0
	beep_t = 0.0
	horn_done = false
	mouth_glow.position.x = -train_dir * (XMAX + 4)
	mouth_light.position.x = -train_dir * (XMAX + 3)
	Sfx.play("horn")
	hud.banner("TRAIN INCOMING", 1400, "danger")
	hud.prompt("<b>%d</b> GREEN NOOK%s — GET IN" % [safe_count, "S" if safe_count > 1 else ""])


## Send the train through (dir: travel direction along X; sound: play the roar).
func _launch_train(dir: float, sound: bool = true) -> void:
	train_dir = dir
	for nk in nooks:
		nk.slammed = false
		nk.crushed = false
	train_front = -dir * TRAIN_START
	train.rotation.y = 0.0 if dir > 0 else PI
	train.position = Vector3(train_front, 0, 0)
	train.visible = true
	if sound:
		Sfx.play("train")
		Sfx.play("trainHorn")


func _start_vent() -> void:
	phase = "vent"
	phase_t = 0.0
	calm_dur = 2.6 if cycle < 6 else 1.6
	mouth_mat.albedo_color.a = 0.0
	mouth_light.light_energy = 0.0
	Sfx.play("puff")
	for nk in nooks:
		nk.press_target = PRESS_UP
		_lamp(nk, "off")
		for i in 3:
			var px: float = nk.x + Rng.rand(-0.3, 0.3)
			fx.smoke(Vector3(px, 0.3, nk.zc), {"color": 0xd8d8d0, "size": 0.35, "rise": 1.6, "life": 1.2, "opacity": 0.45, "drift": Vector3(0, 0, -nk.side * 1.5)})
		var occ = nk.occupant
		if occ != null and occ.alive:
			occ.knock = Vector3(Rng.rand(-1.5, 1.5), 0, -nk.side * 9)
			occ.stun = 0.3


# --------------------------------------------------------------- nook logic

## Nook whose opening column contains the actor and whose wall line it has crossed.
func nook_of(a: ArenaActor, min_depth: float = -0.05) -> Variant:
	for nk in nooks:
		if absf(a.pos.x - nk.x) < NOOK_W / 2 and a.pos.z * nk.side - HALF > min_depth:
			return nk
	return null


static func _in_col(a: ArenaActor, nk: Dictionary) -> bool:
	return absf(a.pos.x - nk.x) < NOOK_W / 2


static func _depth(a: ArenaActor, nk: Dictionary) -> float:
	return a.pos.z * nk.side - HALF


## Maintain one-occupant-per-nook: occupied nooks act as walls for everyone else.
func _nook_rules() -> void:
	var actors := arena.actors.filter(func(a): return a.alive and not a.falling)
	for nk in nooks:
		var o = nk.occupant
		if o != null and (not o.alive or not _in_col(o, nk) or _depth(o, nk) < -0.05):
			nk.occupant = null
		if nk.occupant == null:
			var best = null
			for a in actors:
				if _in_col(a, nk) and _depth(a, nk) > -0.05 and (best == null or _depth(a, nk) > _depth(best, nk)):
					best = a
			nk.occupant = best
		if nk.occupant == null:
			continue
		for a in actors:
			if is_same(a, nk.occupant) or not _in_col(a, nk) or _depth(a, nk) <= -a.radius:
				continue
			a.pos.z = nk.side * (HALF - a.radius)
			a.subject.root.position.z = a.pos.z


## Shoving a nook occupant drags them OUT toward the tracks instead of deeper in.
func _evict(att: ArenaActor, vic: ArenaActor) -> void:
	vic.data["last_shover"] = att.seat
	var nk = nook_of(vic)
	if nk == null:
		return
	var sx := signf(vic.pos.x - att.pos.x)
	if sx == 0.0:
		sx = -1.0 if Rng.random() < 0.5 else 1.0
	vic.knock = Vector3(sx * 3.5, 0, -nk.side * 11)
	vic.stun = 0.55
	Sfx.play("clank", {"vol": 0.6})
	hud.feed("%s evicted %s" % [att.player.name(), vic.player.name()], att.player.color)


func _lamp(nk: Dictionary, st: String) -> void:
	nk.state = st
	Mats.set_color(nk.tile_mat, LAMP[st])
	var light: OmniLight3D = nk.light
	light.light_color = U.col(LAMP[st])
	light.light_energy = (0.0 if st == "off" else 9.0) * Env.LIGHT_K


func _set_lamps(st: String) -> void:
	for nk in nooks:
		_lamp(nk, st)


# ------------------------------------------------------------------- update

## Train motion, presses, lamp pulse. Runs in every state (kills only while playing).
func _animate(dt: float) -> void:
	var playing := state == "play"
	if train.visible:
		train_front += train_dir * TRAIN_SPEED * dt
		train.position.x = train_front
		if absf(train_front) < TRAIN_START + TRAIN_LEN and engine:
			engine.shake(0.03)
		# Red presses slam as the nose passes them.
		for nk in nooks:
			if nk.state == "red" and not nk.slammed and (train_front - nk.x) * train_dir >= 0:
				nk.slammed = true
				nk.press_target = PRESS_DOWN
		if playing and phase == "train":
			_train_kills()
		var tail := train_front - train_dir * TRAIN_LEN
		if tail * train_dir > TRAIN_START:
			train.visible = false
			if playing and phase == "train":
				_start_vent()
			elif state != "play":
				_set_lamps("off")
			for nk in nooks:
				nk.press_target = PRESS_UP
	for nk in nooks:
		var down: bool = nk.press_target < nk.press_y
		var spd := 28.0 if down else 3.0
		nk.press_y = maxf(nk.press_target, nk.press_y - spd * dt) if down else minf(nk.press_target, nk.press_y + spd * dt)
		var press: Node3D = nk.press
		press.position.y = nk.press_y
		# Near-wall presses would hang in the camera's line of sight over the
		# tracks, so they only appear while slamming.
		if nk.side > 0:
			press.visible = nk.press_y < PRESS_UP - 0.05
		if nk.slammed and not nk.crushed and nk.press_y <= 1.4:
			nk.crushed = true
			if engine:
				engine.shake(0.3)
			fx.sparks(Vector3(nk.x, 0.2, nk.zc), {"count": 12})
			if playing:
				var hit := false
				for seat in alive_seats():
					if is_same(nook_of(seat.actor), nk):
						kill(seat, "crush")
						hit = true
				Sfx.play("metal" if hit else "clank")
		if nk.state != "off":
			nk.light.light_energy = (7 + sin(time * 12 + nk.x) * 2) * Env.LIGHT_K


func _train_kills() -> void:
	var dir := train_dir
	var lo := minf(train_front, train_front - dir * TRAIN_LEN)
	var hi := maxf(train_front, train_front - dir * TRAIN_LEN)
	for seat in alive_seats():
		var a: ArenaActor = seat.actor
		if a.pos.x + a.radius < lo or a.pos.x - a.radius > hi:
			continue
		if nook_of(a, SAFE_DEPTH) != null:
			continue
		kill(seat, "gib", {"dir": Vector3(dir, 0, Rng.rand(-0.2, 0.2)), "force": 1.5})


func update(dt: float) -> void:
	var playing := state == "play"
	arena.step(dt, playing)
	_nook_rules()
	_animate(dt)
	for seat in seats:
		if not seat.alive:
			hud.set_stat(seat, "FLATTENED")
			continue
		var nk = nook_of(seat.actor)
		var st := "EXPOSED"
		if nk != null:
			st = "SAFE" if nk.state == "green" else ("DOOMED" if nk.state == "red" else "IN NOOK")
		hud.set_stat(seat, st)
	if not playing:
		return

	phase_t += dt
	if phase == "calm":
		hud.set_timer(calm_dur - phase_t + warn_for(cycle + 1))
		if phase_t >= calm_dur:
			_start_warning()
	elif phase == "warn":
		var k := phase_t / warn_dur
		hud.set_timer(warn_dur - phase_t)
		mouth_mat.albedo_color.a = minf(1.0, k * 1.2)
		mouth_glow.scale = Vector3.ONE * (0.5 + k * k * 6)
		mouth_light.light_energy = k * k * 80 * Env.LIGHT_K
		beep_t -= dt
		if beep_t <= 0:
			beep_t = 0.25 if k > 0.7 else 0.5
			Sfx.play("beep", {"vol": 0.6})
		if not horn_done and warn_dur - phase_t < 1.2:
			horn_done = true
			Sfx.play("trainHorn")
		if phase_t >= warn_dur:
			phase = "train"
			phase_t = 0.0
			hud.prompt("")
			hud.set_timer(-1)
			_launch_train(train_dir)
	elif phase == "train":
		hud.set_timer(-1)
		if phase_t > 6 and not train.visible:
			_start_vent() # safety net
	elif phase == "vent":
		if phase_t >= 0.7:
			phase = "calm"
			phase_t = 0.0

	var alive := alive_seats()
	if alive.size() <= 1:
		if not alive.is_empty():
			var w: Dictionary = alive[0]
			hud.banner("LAST NOOK TAKEN", 2200, "good")
			hud.feed("%s took the last nook" % w.player.name(), w.player.color)
			# Commendation: rode out the deciding train inside the last green nook.
			var nk = nook_of(w.actor, SAFE_DEPTH)
			if phase == "train" and nk != null and nk.safe:
				award(w, "lastNook")
		hud.prompt("")
		end(2.6)


## Ties (same train) share a tier.
func placement() -> Array:
	return _tiered_placement()


## Survivors first, then the dead latest-first; simultaneous deaths share a tier.
func _tiered_placement() -> Array:
	var tiers := []
	var alive := alive_seats()
	if not alive.is_empty():
		tiers.append(alive)
	var dead := deaths.duplicate()
	dead.reverse()
	for s in dead:
		if not tiers.is_empty() and not tiers[-1][0].alive and absf(tiers[-1][0].death_time - s.death_time) < 0.05:
			tiers[-1].append(s)
		else:
			tiers.append([s])
	return tiers


# ---------------------------------------------------------------------- bots

func bot_think(seat: Dictionary, dt: float) -> void:
	var a: ArenaActor = seat.actor
	var brain: Dictionary = seat.brain
	var mem: Dictionary = brain.memory
	a.ctrl.set_buttons(false, false)
	var mine = nook_of(a)
	if mem.get("cycle", -1) != cycle:
		mem["cycle"] = cycle
		mem["sloppy"] = Rng.random() < brain.error
		mem["target"] = -1

	if phase == "warn" or phase == "train":
		if phase == "warn" and phase_t < brain.reaction * 2.2:
			return # still processing the lights
		if mine != null and is_same(mine.occupant, a):
			if mine.safe:
				AI.steer_to(a, mine.x, mine.side * (HALF + DEPTH * 0.62), {"arrive": 0.06, "slow": 0.4})
				return
			AI.steer_to(a, mine.x + Rng.rand(-0.2, 0.2), mine.side * (HALF - 1.5)) # red: get out
			return
		var cost := func(nk: Dictionary) -> float: return absf(nk.x - a.pos.x) + absf(nk.side * HALF - a.pos.z)
		var greens := nooks.filter(func(nk): return nk.safe)
		var free := greens.filter(func(nk): return nk.occupant == null or is_same(nk.occupant, a))
		free.sort_custom(func(p, q): return cost.call(p) < cost.call(q))
		if not free.is_empty():
			var t = null
			if mem.target >= 0:
				for nk in free:
					if nk.i == mem.target:
						t = nk
			if t == null or cost.call(t) > cost.call(free[0]) + 2.5:
				t = free[-1] if mem.sloppy else free[0]
			mem.target = t.i
			_approach(a, t)
		elif not greens.is_empty():
			# Every green is taken: go evict the nearest occupant.
			greens.sort_custom(func(p, q): return cost.call(p) < cost.call(q))
			var t: Dictionary = greens[0]
			var occ: ArenaActor = t.occupant
			var ex: float = t.x
			var ez: float = t.side * (HALF - 0.5)
			var d := U.hypot(occ.pos.x - a.pos.x, occ.pos.z - a.pos.z)
			if d < 1.4:
				a.ctrl.set_move((occ.pos.x - a.pos.x) / d * 0.3, (occ.pos.z - a.pos.z) / d * 0.3)
				if Rng.random() < 0.12 + brain.difficulty * 0.15:
					a.ctrl.set_buttons(false, true)
			else:
				AI.steer_to(a, ex, ez, {"arrive": 0.1})
		return

	# Calm / vent: loiter on the tracks, drifting between spots.
	if mine != null:
		AI.steer_to(a, mine.x, mine.side * (HALF - 1.5))
		return
	mem["spot_t"] = float(mem.get("spot_t", 0.0)) - dt
	if mem.get("spot") == null or mem.spot_t <= 0:
		var spx := Rng.rand(-7.5, 7.5)
		var spz := Rng.rand(-1.3, 1.3)
		mem["spot"] = Vector2(spx, spz)
		mem["spot_t"] = Rng.rand(1.5, 3.5)
	AI.steer_to(a, mem.spot.x, mem.spot.y, {"arrive": 0.4})


## Walk to a nook's entrance, line up with it, then step inside.
func _approach(a: ArenaActor, nk: Dictionary) -> void:
	var depth: float = a.pos.z * nk.side - HALF
	if absf(a.pos.x - nk.x) > 0.16 and depth < -0.25:
		AI.steer_to(a, nk.x, nk.side * (HALF - 0.55), {"arrive": 0.05, "slow": 0.5})
	else:
		AI.steer_to(a, nk.x, nk.side * (HALF + DEPTH * 0.62), {"arrive": 0.06, "slow": 0.4})


func dispose() -> void:
	for nk in nooks:
		nk.occupant = null
	for seat in seats:
		seat.actor = null      # break the seat <-> actor reference cycle
		seat.brain.memory.clear()
	super.dispose()


## Warning length for a cycle: 4 s, shrinking after the sixth train.
static func warn_for(c: int) -> float:
	return 4.0 if c <= 6 else maxf(2.2, 4 - (c - 6) * 0.35)


## Soft radial glow sprite texture (headlight bloom).
static func _glow_texture() -> Dictionary:
	return Tex.image("alcove-glow", 64, func(img: Image, s: int):
		for y in s:
			for x in s:
				var r := Vector2(x + 0.5 - s / 2.0, y + 0.5 - s / 2.0).length() / (s / 2.0)
				var al := 0.0
				if r < 0.25:
					al = lerpf(1.0, 0.6, r / 0.25)
				elif r < 1.0:
					al = lerpf(0.6, 0.0, (r - 0.25) / 0.75)
				img.set_pixel(x, y, Color(1, 1, 1, al)))

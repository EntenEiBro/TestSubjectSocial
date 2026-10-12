extends Minigame
## THE INCINERATOR — contraband culture rides a conveyor past every subject.
##
## Rules
##  - Each subject mans their own conveyor lane (left → right) with a furnace
##    behind them. Items: framed ART and MACHINE PARTS.
##  - Press A while an item sits in the glowing grab zone to hurl it into the
##    furnace. Art burned: +1. Machine part burned: −1 (wrong!).
##  - Art that slips past the grab zone: −1. Parts that pass are correct.
##  - The belts accelerate over the 45 s shift. Every lane receives the exact
##    same item sequence at the same moment, so the contest is fair.
##  - At the whistle the lowest scorer(s) are "filtered" — dragged into their
##    own furnace. Nobody burns if everyone is tied.
##
## Furnace, conveyor stations, art stands and machine parts are Blender models
## (blender/props/incinerator.py); canvases, belt surface, zones and flames are procedural.

const META := {
	"id": "incinerator",
	"title": "THE INCINERATOR",
	"tagline": "Culture is flammable. So are you.",
	"category": "Precision",
	"controls": [{"input": "a", "label": "Grab & burn"}],
	"objective": "Burn the art, spare the machinery, and do not finish last.",
	"rules": [
		"Press {A} while an item is in your glowing zone to hurl it into the furnace.",
		"Art burned: +1. Machine part burned: −1. Art that slips past: −1.",
		"The belt speeds up. Every lane gets the same items.",
		"Lowest score at the whistle is fed to the furnace.",
	],
}

const DURATION := 45.0
const ZONE0 := 0.40                 # grab zone along the belt (0..1)
const ZONE1 := 0.70
const HATCH := 0.08                 # belt fraction hidden inside each end hatch
const BELT_Y := 0.85                # belt top surface height
const BELT_Z := 1.25                # belt centre line (in front of the subject)
const BELT_D := 1.0                 # belt depth
const FURN_FRONT := -1.0            # furnace mouth plane
const FURN_W := 1.9
const MOUTH_W := 1.3
const MOUTH_H := 1.55
const THROW_T := 0.42               # item flight time into the furnace
const GRAB_COOLDOWN := 0.22
const ITEM_SCALE := 1.2             # belt items are drawn slightly oversized for readability
const PART_TYPES := ["gear", "pipe", "valve", "piston", "spring"]
const ART_STYLES := ["blobs", "portrait", "landscape", "grid", "swirl"]
const BRICK_PLACEHOLDER := "m_none_2a1d17"   # Blender material swapped for the painted bricks

var spacing := 6.0
var belt_len := 5.3
var lanes := []
var speed := 0.0
var phase := "play"          # play | reckoning
var schedule := []
var next_spawn := 0
var item_id := 0
var losers := []
var art_pool := []           # painted canvases (Texture2D)
var art_mats := []
var belt_mat: StandardMaterial3D
var brick_mat: StandardMaterial3D
var reckon_t := 0.0
var verdict := false


## Belt speed in belt-lengths per second at round time t.
static func speed_at(t: float) -> float:
	return 0.30 + 0.0105 * minf(t, DURATION)


## Mean spawn interval (seconds) at round time t.
static func interval_at(t: float) -> float:
	return 1.75 - 0.019 * minf(t, DURATION)


func build() -> void:
	var n := seats.size()
	spacing = 6.0 if n <= 2 else (5.2 if n == 3 else 4.6)
	belt_len = spacing - 0.7
	var width := n * spacing
	make_scene({"fog_near": 18.0, "fog_far": 52.0, "ambient_intensity": 1.1})
	fx.reserve_flash() # explosions reuse one light (no shader recompiles)
	# Fit every station horizontally: tan(hfov/2) ≈ 0.736 for fov 45 at 16:9.
	var dist := (width + 1.2) / (2 * 0.736 * 0.95)
	var look := Vector3(0, 1.45, 0.1)
	var dir := Vector3(0, sin(0.4), cos(0.4))
	make_camera(look + dir * dist, look, 45)
	# Soft frontal fill so items on the belts read clearly.
	scene.add_child(Env.dir_light(0xd8d0c0, 0.9, Vector3(0, 6, 12)))

	_build_room(width)
	art_pool = []
	for i in 10:
		art_pool.append(_paint_art(ART_STYLES[i % ART_STYLES.size()]))
	# Unlit canvases: the art must stay readable however dim the hall is.
	art_mats = []
	for t in art_pool:
		art_mats.append(Mats.glow(0xd8d8d8, {"tex": t}))

	# Shared scrolling belt surface (all belts run at the same speed).
	belt_mat = Mats.mat(0xffffff, Tex.canvas("incin-belt", 32, func(ci: CanvasItem, s: float):
		ci.draw_rect(Rect2(0, 0, s, s), Color("#1f1e1c"))
		ci.draw_rect(Rect2(0, 0, 6, s), Color("#353330"))
		for i in 40:
			ci.draw_rect(Rect2(randf() * s, randf() * s, 1, 1), Color(1, 1, 1, 0.05)), Vector2(8, 1)))
	brick_mat = Mats.mat(0xffffff, _brick_tex())

	lanes = []
	for i in n:
		lanes.append(_build_lane(seats[i], (i - (n - 1) / 2.0) * spacing))
	speed = speed_at(0)
	phase = "play"
	schedule = _make_schedule()
	next_spawn = 0
	item_id = 0
	losers = []


# ------------------------------------------------------------------ stage

func _build_room(width: float) -> void:
	Env.floor_plane(scene, width + 24, 26, {"tex": "plate", "tile": 2.0, "z": 2.0})
	var wall_mat := Mats.mat(0xffffff, Tex.wall(Vector2((width + 24) / 4, 2)))
	Env.block(scene, 0, 4, -2.75, width + 24, 8, 0.3, wall_mat)
	Env.stencil(scene, "CULTURE IS FUEL", -width / 4, 5.6, -2.58, {"w": 7.0, "h": 2.2, "opacity": 0.5})
	Env.stencil(scene, "SPARE THE PARTS", width / 4, 5.6, -2.58, {"w": 7.0, "h": 2.2, "opacity": 0.5, "color": "#c9a227"})
	# Overhead duct
	Env.pipe(scene, [-width / 2 - 6, 6.8, -2.2], [width / 2 + 6, 6.8, -2.2], 0.35, 0x3d3a34)
	Env.hazard_strip(scene, 0, 2.15, width + 2, 0.35, 0.012)


## Build one station: belt, hatches, grab zone, furnace and the subject.
func _build_lane(seat: Dictionary, x0: float) -> Dictionary:
	var L := belt_len
	var color: String = seat.player.color
	var smoke_t := Rng.rand(0, 0.4)
	var flame_phase := Rng.rand(0, 6)
	var player_x := x0 + ((ZONE0 + ZONE1) / 2 - 0.5) * L
	var lane := {
		"seat": seat, "x0": x0, "items": [], "belt_x0": x0 - L / 2,
		"player_x": player_x, "furn_x": player_x + 0.95,
		"cool": 0.0, "flash": 0.0, "burst": 0.0, "smoke_t": smoke_t, "flame_phase": flame_phase,
	}
	seat["lane"] = lane
	seat["correct"] = 0
	seat["decisions"] = 0
	seat["throw_t"] = 0.0
	seat["status_t"] = 0.0
	seat["status_text"] = ""
	seat["pulled"] = false

	# Belt body, legs, rollers, side rails and the end hatches with rubber
	# curtains (items appear / vanish inside them): one Blender model per belt length.
	var conveyor := Props.make("incinerator", "conveyor_%d" % roundi(L * 100))
	conveyor.position = Vector3(x0, 0, BELT_Z)
	scene.add_child(conveyor)
	var top := Env.mesh(Geo.plane(L, BELT_D), belt_mat, x0, BELT_Y + 0.002, BELT_Z, {"cast": false})
	top.rotation.x = -PI / 2
	scene.add_child(top)

	# Grab zone: tinted overlay + glowing cross bars.
	var bx0: float = lane.belt_x0
	var zx0 := bx0 + ZONE0 * L
	var zx1 := bx0 + ZONE1 * L
	lane["zone_mat"] = Mats.glow(color, {"opacity": 0.18, "depth_write": false})
	var zone := Env.mesh(Geo.plane(zx1 - zx0, BELT_D), lane.zone_mat, (zx0 + zx1) / 2, BELT_Y + 0.01, BELT_Z, {"cast": false})
	zone.rotation.x = -PI / 2
	scene.add_child(zone)
	lane["bar_mat"] = Mats.glow(color)
	for zx in [zx0, zx1]:
		scene.add_child(Env.mesh(Geo.box(0.05, 0.03, BELT_D + 0.12), lane.bar_mat, zx, BELT_Y + 0.13, BELT_Z, {"cast": false}))
	lane["highlight_mat"] = Mats.glow(color, {"opacity": 0.55, "depth_write": false})

	_build_furnace(lane, seat)

	# Station divider behind the belt.
	Env.block(scene, x0 + spacing / 2, 1.5, -1.8, 0.25, 3, 1.6, Mats.mat(0xffffff, Tex.hazard(Vector2(1, 2))))

	Env.hanging_lamp(scene, x0, 5.2, 1.0, {"intensity": 55.0, "angle": 0.85, "target": Vector3(x0, 0, 0.9)})

	spawn_subject(seat, {"x": player_x, "z": 0.15, "facing": 0.0})
	lane["home"] = seat.subject.root.position
	return lane


## Brick furnace with a hollow mouth, flames, flicker light and alarm bulb.
func _build_furnace(lane: Dictionary, seat: Dictionary) -> void:
	var fxp: float = lane.furn_x
	var depth := 1.4
	# Brick body, cap plate and flue: Blender model, bricks painted here.
	var furnace := Props.make("incinerator", "furnace")
	furnace.position = Vector3(fxp, 0, FURN_FRONT)
	_apply_brick(furnace)
	scene.add_child(furnace)
	# Interior: glowing back wall + coal bed.
	lane["core_mat"] = Mats.glow(0xff6a1a)
	scene.add_child(Env.mesh(Geo.plane(MOUTH_W, MOUTH_H), lane.core_mat, fxp, MOUTH_H / 2, FURN_FRONT - depth + 0.05, {"cast": false}))
	var coal_mat := Mats.glow(0xc23a0a)
	for i in 7:
		var cx := fxp + Rng.rand(-0.5, 0.5)
		var cz := FURN_FRONT - Rng.rand(0.3, 1.1)
		scene.add_child(Env.mesh(Geo.box(0.22, 0.12, 0.22), coal_mat, cx, 0.06, cz, {"cast": false}))
	# Flames
	var flames := []
	var fm := [Mats.glow(0xff7a1a, {"opacity": 0.85}), Mats.glow(0xffd25a, {"opacity": 0.8})]
	for i in 6:
		var r := Rng.rand(0.12, 0.2)
		var f := Env.mesh(Geo.cone(r, 0.7, 5), fm[i % 2], fxp + (i / 5.0 - 0.5) * (MOUTH_W - 0.3), 0.35, FURN_FRONT - 0.5 - (i % 2) * 0.3, {"cast": false})
		var ph := Rng.rand(0, 6)
		var rate := Rng.rand(9, 15)
		scene.add_child(f)
		flames.append({"m": f, "phase": ph, "rate": rate})
	lane["flames"] = flames
	var light := Env.point_light(0xff7a2a, 6, 7, 1.3)
	light.position = Vector3(fxp, 1.0, FURN_FRONT + 0.4)
	scene.add_child(light)
	lane["light"] = light
	# Alarm bulb + player-coloured label.
	lane["alarm_mat"] = Mats.glow(0x330000)
	scene.add_child(Env.mesh(Geo.sphere(0.12, 8, 6), lane.alarm_mat, fxp + FURN_W / 2 - 0.15, 2.85, FURN_FRONT - 0.2, {"cast": false}))
	Env.stencil(scene, "P%d" % (seat.player.slot + 1), fxp, MOUTH_H + 0.42, FURN_FRONT + 0.02, {"w": 0.9, "h": 0.38, "color": seat.player.color, "opacity": 0.95})
	lane["mouth"] = Vector3(fxp, 0.85, FURN_FRONT - 0.45)


## Swap the furnace model's placeholder brick material for the painted bricks.
func _apply_brick(node: Node) -> void:
	if node is MeshInstance3D:
		var mi: MeshInstance3D = node
		if mi.mesh:
			for i in mi.mesh.get_surface_count():
				var src := mi.mesh.surface_get_material(i)
				if src and src.resource_name == BRICK_PLACEHOLDER:
					mi.set_surface_override_material(i, brick_mat)
	for c in node.get_children():
		_apply_brick(c)


## Pre-roll the shared item sequence for the whole shift.
func _make_schedule() -> Array:
	var list := []
	var t := 0.3
	var last := ""
	var run := 0
	while t < DURATION - 0.6:
		var kind := "art" if Rng.random() < 0.56 else "part"
		if kind == last and run >= 3:
			kind = "part" if kind == "art" else "art"
		run = run + 1 if kind == last else 1
		last = kind
		var variant := Rng.rand_int(0, art_pool.size() - 1) if kind == "art" else Rng.rand_int(0, PART_TYPES.size() - 1)
		var frame := Rng.rand_int(0, 2)
		list.append({"t": t, "kind": kind, "variant": variant, "frame": frame})
		t += interval_at(t) * Rng.rand(0.8, 1.25)
	return list


# ----------------------------------------------------------------- items

func _spawn_due() -> void:
	while next_spawn < schedule.size() and time >= float(schedule[next_spawn].t):
		var spec: Dictionary = schedule[next_spawn]
		next_spawn += 1
		var id := item_id
		item_id += 1
		for lane in lanes:
			var g: Node3D = _build_art(art_mats[spec.variant], spec.frame) if spec.kind == "art" else _build_part(PART_TYPES[spec.variant])
			g.rotation_order = EULER_ORDER_XYZ
			var hl := Env.mesh(Geo.plane(1.0, 0.8), lane.highlight_mat, 0, 0.015, 0, {"cast": false})
			hl.rotation.x = -PI / 2
			hl.visible = false
			g.add_child(hl)
			g.scale = Vector3.ONE * ITEM_SCALE
			scene.add_child(g)
			var it := {"id": id, "kind": spec.kind, "u": (time - float(spec.t)) * speed, "g": g, "hl": hl,
				"spin": g.find_child("gear_spin", true, false), "state": "belt", "resolved": false, "fly": null}
			_place_on_belt(lane, it, 0)
			lane.items.append(it)


func _place_on_belt(lane: Dictionary, it: Dictionary, lift: float) -> void:
	var g: Node3D = it.g
	g.position = Vector3(float(lane.belt_x0) + float(it.u) * belt_len, BELT_Y + lift, BELT_Z)


## The item a grab would take right now (most advanced in the zone).
func _grabbable(lane: Dictionary) -> Variant:
	var best = null
	for it in lane.items:
		if it.state != "belt" or it.resolved or it.u < ZONE0 or it.u > ZONE1:
			continue
		if best == null or it.u > best.u:
			best = it
	return best


func _grab(lane: Dictionary) -> void:
	var seat: Dictionary = lane.seat
	lane.cool = GRAB_COOLDOWN
	seat.throw_t = THROW_T
	var it = _grabbable(lane)
	if it == null:
		Sfx.play("whoosh", {"vol": 0.4})
		return
	it.state = "flying"
	it.resolved = true
	it.hl.visible = false
	var to: Vector3 = lane.mouth + Vector3(Rng.rand(-0.3, 0.3), 0, 0)
	it.fly = {"t": 0.0, "from": (it.g as Node3D).position, "to": to}
	Sfx.play("whoosh", {"vol": 0.6})


## An item reached the furnace: score it.
func _incinerate(lane: Dictionary, it: Dictionary) -> void:
	var seat: Dictionary = lane.seat
	(it.g as Node3D).queue_free()
	it.state = "gone"
	seat.decisions += 1
	lane.burst = minf(2.0, lane.burst + 1)
	var mouth: Vector3 = lane.mouth
	fx.sparks(Vector3(mouth.x, 0.6, mouth.z), {"count": 10, "color": 0xffb040})
	for i in 3:
		fx.smoke(mouth + Vector3(Rng.rand(-0.4, 0.4), 0.9, 0.6), {"color": 0x2a2522 if i else 0xff7a1a, "size": 0.25, "rise": 1.6, "life": 1.2, "opacity": 0.6})
	Sfx.play("burn", {"vol": 0.8})
	if it.kind == "art":
		seat.score += 1
		seat.correct += 1
		_status(seat, "BURNED +1")
	else:
		seat.score -= 1
		lane.flash = 0.7
		Sfx.play("buzz")
		Sfx.play("clank", {"vol": 0.6})
		fx.sparks(Vector3(mouth.x, 0.9, mouth.z), {"count": 14, "color": 0xbfe4ff, "speed": 8.0})
		_status(seat, "WRONG! −1")


func _status(seat: Dictionary, text: String) -> void:
	seat.status_text = text
	seat.status_t = 0.9


func _update_lane(lane: Dictionary, dt: float, playing: bool) -> void:
	var seat: Dictionary = lane.seat
	lane.cool = maxf(0.0, lane.cool - dt)
	lane.flash = maxf(0.0, lane.flash - dt)
	if playing and seat.alive and lane.cool <= 0 and seat.ctrl.a_pressed:
		_grab(lane)

	var zone_hot := false
	var items: Array = lane.items
	var i := items.size() - 1
	while i >= 0:
		var it: Dictionary = items[i]
		var g: Node3D = it.g
		if it.state == "belt":
			it.u += speed * dt
			var in_zone: bool = not it.resolved and it.u >= ZONE0 and it.u <= ZONE1
			zone_hot = zone_hot or in_zone
			it.hl.visible = in_zone
			if it.spin != null:
				it.spin.rotation.z -= speed * belt_len * dt / (0.37 * ITEM_SCALE)
			_place_on_belt(lane, it, 0.06 + sin(time * 18) * 0.02 if in_zone else 0.0)
			if playing and not it.resolved and it.u > ZONE1:
				it.resolved = true
				seat.decisions += 1
				if it.kind == "art":
					seat.score -= 1
					lane.flash = 0.45
					Sfx.play("wrong", {"vol": 0.5})
					_status(seat, "MISSED ART −1")
				else:
					seat.correct += 1
			if it.u >= 1:
				g.queue_free()
				items.remove_at(i)
		elif it.state == "flying":
			var f: Dictionary = it.fly
			f.t += dt / THROW_T
			var k: float = minf(1.0, f.t)
			g.position = (f.from as Vector3).lerp(f.to, k)
			g.position.y += sin(k * PI) * 1.5
			g.rotation.x -= dt * 9
			g.rotation.z += dt * 4
			if k >= 1:
				_incinerate(lane, it)
				items.remove_at(i)
		i -= 1
	var zm: StandardMaterial3D = lane.zone_mat
	var opacity := 0.38 + sin(time * 20) * 0.08 if zone_hot else 0.16
	if lane.flash > 0:
		Mats.set_color(zm, 0xff2020)
		opacity = 0.5
	else:
		Mats.set_color(zm, seat.player.color)
	zm.albedo_color.a = opacity


# -------------------------------------------------------------- animation

func _animate_furnaces(dt: float) -> void:
	var t := clock
	for lane in lanes:
		lane.burst = maxf(0.0, lane.burst - dt * 1.8)
		var fp: float = lane.flame_phase
		var burst: float = lane.burst
		var flick := 0.8 + sin(t * 13 + fp) * 0.12 + sin(t * 31 + fp * 2) * 0.08
		var light: OmniLight3D = lane.light
		light.light_energy = (6 * flick + burst * 14) * Env.LIGHT_K
		var red := 1.0 if lane.flash > 0 else 0.0
		# THREE's setRGB values are linear.
		light.light_color = Color(1, 0.48 * (1 - red) + 0.05 * red, 0.16 * (1 - red)).linear_to_srgb()
		Mats.set_color(lane.core_mat, Color(1, 0.35 + 0.15 * flick + burst * 0.2, 0.08).linear_to_srgb())
		Mats.set_color(lane.alarm_mat, 0xff1a1a if lane.flash > 0 and sin(t * 40) > 0 else 0x330000)
		for f in lane.flames:
			var s: float = 0.75 + sin(t * f.rate + f.phase) * 0.3 + burst * 0.9
			var m: Node3D = f.m
			m.scale = Vector3(1 + burst * 0.4, s, 1 + burst * 0.4)
			m.position.y = 0.35 * s
		lane.smoke_t -= dt
		if lane.smoke_t <= 0:
			lane.smoke_t = Rng.rand(0.25, 0.5)
			var px: float = lane.furn_x + Rng.rand(-0.4, 0.4)
			var drift := Vector3(Rng.rand(-0.1, 0.1), 0, 0.25)
			fx.smoke(Vector3(px, MOUTH_H - 0.1, FURN_FRONT + 0.15), {"color": 0x2a2724, "size": 0.18, "rise": 1.4, "life": 1.4, "opacity": 0.35, "drift": drift})


func _animate_subjects(dt: float) -> void:
	for seat in seats:
		if not seat.alive or seat.pulled:
			continue
		var s: Subject = seat.subject
		var p: Dictionary = s.parts
		s.animate(dt, 0)
		if seat.throw_t > 0:
			seat.throw_t = maxf(0.0, seat.throw_t - dt)
			var k: float = 1.0 - seat.throw_t / THROW_T
			var ax := lerpf(-0.5, -1.3, k / 0.35) if k < 0.35 else lerpf(-1.3, -3.1, (k - 0.35) / 0.65)
			p.armL.rotation.x = ax
			p.armR.rotation.x = ax
			p.torso.rotation.y = lerpf(0, -0.25, k / 0.35) if k < 0.35 else lerpf(-0.25, 0.75, (k - 0.35) / 0.65)
		else:
			p.torso.rotation.y = lerpf(p.torso.rotation.y, 0, U.damp(8, dt))


func _scroll_belt(dt: float) -> void:
	belt_mat.uv1_offset.x = fposmod(belt_mat.uv1_offset.x - speed * 8 * dt, 1.0)


# ------------------------------------------------------------------ flow

func preview(dt: float) -> void:
	_scroll_belt(dt)
	_animate_furnaces(dt)
	_animate_subjects(dt)


func update(dt: float) -> void:
	var playing := state == "play" and phase == "play"
	speed = speed_at(time) if playing else maxf(0.0, speed - dt * 0.5)
	_scroll_belt(dt)
	if playing:
		_spawn_due()
	for lane in lanes:
		_update_lane(lane, dt, playing)
	_animate_furnaces(dt)
	_animate_subjects(dt)

	for seat in seats:
		seat.status_t = maxf(0.0, seat.status_t - dt)
		var acc: int = roundi(float(seat.correct) / seat.decisions * 100) if seat.decisions else 100
		hud.set_stat(seat, "SCORE %d · %d%%" % [int(seat.score), acc] if seat.alive else "FILTERED")
		hud.set_status(seat, seat.status_text if seat.alive and seat.status_t > 0 else "")
	if state != "play":
		return
	if phase == "play":
		hud.set_timer(maxf(0.0, DURATION - time))
		if time >= DURATION:
			_begin_reckoning()
	else:
		_update_reckoning(dt)


func _begin_reckoning() -> void:
	phase = "reckoning"
	reckon_t = 0.0
	verdict = false
	hud.set_timer(0)
	Sfx.play("horn")
	hud.banner("SHIFT OVER", 1400)
	for lane in lanes:
		for it in lane.items:
			it.hl.visible = false


## Wait for in-flight items to land, pick the loser(s), drag them in.
func _update_reckoning(dt: float) -> void:
	reckon_t += dt
	const VERDICT := 0.7
	const PULL_START := 1.6
	const PULL_DUR := 1.3
	if not verdict and reckon_t >= VERDICT:
		verdict = true
		for s in seats:
			if s.decisions >= 5 and s.correct == s.decisions:
				award(s, "flawlessFilter")
		var mn := INF
		var mx := -INF
		for s in seats:
			mn = minf(mn, s.score)
			mx = maxf(mx, s.score)
		losers = [] if mn == mx else seats.filter(func(s): return s.score == mn)
		if not losers.is_empty():
			hud.banner("FILTERING...", 1600, "danger")
			Sfx.play("sting")
		else:
			hud.banner("ALL SPARED", 1600, "good")
	if not verdict:
		return
	for seat in losers:
		if not seat.alive:
			continue
		var k := clampf((reckon_t - PULL_START) / PULL_DUR, 0.0, 1.0)
		if k <= 0:
			continue
		var s: Subject = seat.subject
		var root := s.root
		if not seat.pulled:
			seat.pulled = true
			if s.ring:
				s.ring.visible = false
			s.pose = "armsUp"
			Sfx.play("grind")
			root.rotation_order = EULER_ORDER_XYZ
		var e := k * k
		var lane: Dictionary = seat.lane
		root.position = (lane.home as Vector3).lerp(Vector3(lane.furn_x, 0.25, FURN_FRONT - 0.15), e)
		root.rotation.x = -1.0 * e
		root.rotation.y = sin(k * 25) * 0.25 * (1 - k)
		s.animate(dt, 0)
		s.parts.armL.rotation.x += sin(time * 30) * 0.4
		s.parts.armR.rotation.x -= sin(time * 30) * 0.4
		if k >= 1:
			kill(seat, "burn", {"dir": Vector3(0, 0, -1), "force": 0.4})
			lane.burst = 2.5
			var mouth: Vector3 = lane.mouth
			fx.explosion(Vector3(mouth.x, 0.4, mouth.z), 0.6)
	var done := losers.all(func(s): return not s.alive)
	if done and reckon_t >= (PULL_START + PULL_DUR + 0.2 if not losers.is_empty() else 1.4):
		end(2.4)


func placement() -> Array:
	return Minigame.rank_by_score(seats)


# ------------------------------------------------------------------- bots

func bot_think(seat: Dictionary, _dt: float) -> void:
	var ctrl: Controller = seat.ctrl
	var b: Dictionary = seat.brain
	var lane: Dictionary = seat.lane
	ctrl.set_buttons(false, false)
	if phase != "play":
		return
	for it in lane.items:
		if it.state != "belt" or it.resolved or it.u < HATCH:
			continue
		var m = b.memory.get(it.id)
		if m == null:
			# First sight: decide whether this looks like art.
			var want: bool = Rng.random() < 0.72 + 0.26 * b.difficulty if it.kind == "art" else Rng.random() < b.error * 0.6
			m = {"want": want, "at": null}
			b.memory[it.id] = m
		if not m.want:
			continue
		if it.u >= ZONE0 and m.at == null:
			m.at = time + b.reaction * Rng.rand(0.5, 1.25)
		if m.at != null and time >= m.at and it.u <= ZONE1 and lane.cool <= 0 and is_same(_grabbable(lane), it):
			ctrl.set_buttons(true, false)
			m.want = false
			break


func dispose() -> void:
	for seat in seats:
		seat["lane"] = null   # break the seat <-> lane reference cycle
	lanes.clear()
	super.dispose()


# ======================================================================
# Items (Blender models + painted canvases)
# ======================================================================

## A framed painting on a little stand, facing the camera (stand + frame
## modelled in Blender; the canvas is one of the round's painted textures).
func _build_art(canvas_mat: Material, frame_idx: int) -> Node3D:
	var g := Props.make("incinerator", "art_%d" % (frame_idx % 3))
	var pic := Env.mesh(Geo.plane(0.72, 0.54), canvas_mat, 0, 0.42, -0.02, {"cast": false})
	pic.rotation.x = -0.14
	g.add_child(pic)
	return g


## A low-poly machine part. Gears carry a `gear_spin` child so they roll along.
func _build_part(type: String) -> Node3D:
	return Props.make("incinerator", "part_" + type)


# ======================================================================
# Procedural textures
# ======================================================================

## Dark soot-stained brick texture for the furnaces (cached).
static func _brick_tex() -> Dictionary:
	return Tex.canvas("incin-brick", 64, func(ci: CanvasItem, s: float):
		ci.draw_rect(Rect2(0, 0, s, s), Color("#2a1d17"))
		for row in 8:
			for col in range(-1, 5):
				var x := col * 16 + (row % 2) * 8
				var y := row * 8
				var l := 22 + randf() * 14
				ci.draw_rect(Rect2(x + 1, y + 1, 14, 6), _hsl(10 + randf() * 12, 45, l))
		_vgrad(ci, 0, 0, s, s / 2, Color(0, 0, 0, 0.55), Color(0, 0, 0, 0.1))
		_vgrad(ci, 0, s / 2, s, s, Color(0, 0, 0, 0.1), Color(0, 0, 0, 0.3)), Vector2(1, 2))


class _Canvas extends Control:
	var fn: Callable
	func _draw() -> void:
		fn.call(self)


## Render fn(ci) once into a w×h texture owned by this round (freed with it).
func _paint(w: int, h: int, fn: Callable) -> Texture2D:
	var vp := SubViewport.new()
	vp.size = Vector2i(w, h)
	vp.disable_3d = true
	vp.transparent_bg = false
	vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	var c := _Canvas.new()
	c.fn = fn
	c.size = Vector2(w, h)
	vp.add_child(c)
	add_child(vp)
	return vp.get_texture()


## Paint one small "masterpiece" onto a 64×48 canvas (cosmetic randomness).
func _paint_art(style: String) -> Texture2D:
	var hue := float(randi_range(0, 359))
	return _paint(64, 48, func(g: CanvasItem):
		match style:
			"portrait":
				g.draw_rect(Rect2(0, 0, 64, 48), _hsl(hue, 45, 50))
				_radial(g, 64, 48, Vector2(32, 18), 3, Vector2(32, 24), 38, Color(1, 240 / 255.0, 200 / 255.0, 0.35), Color(0, 0, 0, 0.55))
				var dark := _hsl(hue + 180, 30, 14)
				g.draw_colored_polygon(_ellipse(32, 19, 8, 10), dark)
				g.draw_colored_polygon(_ellipse(32, 50, 19, 17, 0, PI, TAU), dark)
				g.draw_rect(Rect2(29, 31, 6, 4), _hsl(hue + 30, 70, 60)) # a brooch, very refined
			"landscape":
				var sky0 := _hsl(hue, 60, 35)
				var sky1 := _hsl(hue + 40, 70, 70)
				_vgrad(g, 0, 0, 64, 30, sky0, sky1)
				g.draw_rect(Rect2(0, 30, 64, 18), sky1)
				g.draw_circle(Vector2(randi_range(12, 52), randi_range(8, 18)), 6, _hsl(hue + 60, 90, 75))
				for k in 3:
					var col := _hsl(hue + 120 + k * 15, 40, 40 - k * 10)
					var base := 24.0 + k * 7
					var amp := U.crand(3, 7)
					var ph := U.crand(0, 6)
					for x in range(0, 64, 4):
						var ya := base + sin(x / 9.0 + ph) * amp
						var yb := base + sin((x + 4) / 9.0 + ph) * amp
						g.draw_colored_polygon(PackedVector2Array([Vector2(x, ya), Vector2(x + 4, yb), Vector2(x + 4, 48), Vector2(x, 48)]), col)
			"grid":
				g.draw_rect(Rect2(0, 0, 64, 48), Color("#e8e2cf"))
				var cols := [_hsl(hue, 80, 50), _hsl(hue + 120, 80, 45), _hsl(hue + 220, 70, 55), Color("#111111")]
				for k in 5:
					g.draw_rect(Rect2(randi_range(0, 48), randi_range(0, 34), randi_range(8, 22), randi_range(8, 18)), cols[k % cols.size()])
				for k in 4:
					g.draw_rect(Rect2(randi_range(4, 60), 0, 2, 48), Color("#111111"))
					g.draw_rect(Rect2(0, randi_range(4, 44), 64, 2), Color("#111111"))
			"swirl":
				g.draw_rect(Rect2(0, 0, 64, 48), _hsl(hue, 50, 20))
				for k in 9:
					var c := Vector2(32 + U.crand(-4, 4), 24 + U.crand(-3, 3))
					g.draw_arc(c, 3 + k * 3.2, U.crand(0, 3), U.crand(3.5, 6.5), 24, _hsl(hue + k * 25, 75, 45 + k * 4), 3.0)
			_: # blobs
				g.draw_rect(Rect2(0, 0, 64, 48), _hsl(hue, 30, 82))
				for k in 7:
					var col := _hsl(hue + U.crand(-90, 160), 75, U.crand(35, 60))
					g.draw_colored_polygon(_ellipse(U.crand(6, 58), U.crand(6, 42), U.crand(4, 13), U.crand(3, 10), U.crand(0, 3)), col)
				var p0 := Vector2(U.crand(0, 64), U.crand(0, 48))
				var p1 := Vector2(U.crand(0, 64), U.crand(0, 48))
				var p2 := Vector2(U.crand(0, 64), U.crand(0, 48))
				var p3 := Vector2(U.crand(0, 64), U.crand(0, 48))
				var pts := PackedVector2Array()
				for i in 25:
					var t := i / 24.0
					var u := 1.0 - t
					pts.append(p0 * u * u * u + p1 * 3 * u * u * t + p2 * 3 * u * t * t + p3 * t * t * t)
				g.draw_polyline(pts, Color("#1a1a1a"), 2.0)
		# Brush grain + varnish.
		for k in 160:
			g.draw_rect(Rect2(U.crand(0, 64), U.crand(0, 48), 2, 1), Color(0, 0, 0, 0.08) if randf() < 0.5 else Color(1, 1, 1, 0.08)))


## CSS hsl() → Color (h in degrees, s / l in percent).
static func _hsl(h: float, s: float, l: float, a: float = 1.0) -> Color:
	var hh := fposmod(h, 360.0) / 360.0
	var ss := clampf(s / 100.0, 0.0, 1.0)
	var ll := clampf(l / 100.0, 0.0, 1.0)
	var q := ll * (1.0 + ss) if ll < 0.5 else ll + ss - ll * ss
	var p := 2.0 * ll - q
	return Color(_hue(p, q, hh + 1.0 / 3.0), _hue(p, q, hh), _hue(p, q, hh - 1.0 / 3.0), a)


static func _hue(p: float, q: float, t: float) -> float:
	t = fposmod(t, 1.0)
	if t < 1.0 / 6.0:
		return p + (q - p) * 6.0 * t
	if t < 0.5:
		return q
	if t < 2.0 / 3.0:
		return p + (q - p) * (2.0 / 3.0 - t) * 6.0
	return p


## Ellipse outline (canvas ellipse(): centre, radii, rotation, start / end angle).
static func _ellipse(cx: float, cy: float, rx: float, ry: float, rot: float = 0.0, a0: float = 0.0, a1: float = TAU, seg: int = 24) -> PackedVector2Array:
	var pts := PackedVector2Array()
	var full := absf(a1 - a0) >= TAU - 1e-4
	var count := seg if full else seg + 1
	for i in count:
		var a := a0 + (a1 - a0) * i / seg
		var x := cos(a) * rx
		var y := sin(a) * ry
		pts.append(Vector2(cx + x * cos(rot) - y * sin(rot), cy + x * sin(rot) + y * cos(rot)))
	return pts


## Vertical linear gradient over the rect x..x+w, y0..y1.
static func _vgrad(ci: CanvasItem, x: float, y0: float, w: float, y1: float, c0: Color, c1: Color) -> void:
	ci.draw_polygon(PackedVector2Array([Vector2(x, y0), Vector2(x + w, y0), Vector2(x + w, y1), Vector2(x, y1)]), PackedColorArray([c0, c0, c1, c1]))


## Two-circle radial gradient (canvas createRadialGradient) filled per pixel.
static func _radial(ci: CanvasItem, w: int, h: int, c0: Vector2, r0: float, c1: Vector2, r1: float, col0: Color, col1: Color) -> void:
	var cd := c1 - c0
	var dr := r1 - r0
	var a := cd.dot(cd) - dr * dr
	for y in h:
		for x in w:
			var pd := Vector2(x + 0.5, y + 0.5) - c0
			var b := pd.dot(cd) + r0 * dr
			var c := pd.dot(pd) - r0 * r0
			var t := 1.0
			if absf(a) < 1e-6:
				t = c / (2.0 * b) if b != 0.0 else 1.0
			else:
				var disc := b * b - a * c
				if disc >= 0.0:
					var sq := sqrt(disc)
					t = maxf((b + sq) / a, (b - sq) / a)
					if r0 + t * dr < 0.0:
						t = minf((b + sq) / a, (b - sq) / a)
			ci.draw_rect(Rect2(x, y, 1, 1), col0.lerp(col1, clampf(t, 0.0, 1.0)))

extends Minigame
## SONAR CROSSING — a muddy strip of no-man's-land seeded with invisible
## mines, a harvester grinding up the rear and an exit gate far ahead.
##
## Rules
##  - The field runs from the start line (z = 0) to the exit gate (z = -40),
##    14 units wide, fenced with barbed wire. ~70 hidden mines are buried in
##    it (none within 2 units of the start; a passable route always exists).
##  - Stand still for 0.8 s and your collar emits a SONAR ping: mines within
##    4.5 units glow red for 3 s. Everyone sees what you reveal.
##  - Stepping on a mine: explosion, 'gib' for you and anyone within 1.4.
##  - B shoves. Shoving rivals onto mines is encouraged.
##  - After 12 s a field harvester (spinning bladed drum spanning the field)
##    starts rolling forward from behind the start, accelerating. Contact is
##    fatal. At 60 s it floors it.
##  - Crossing the exit line = safe; finishers walk off into the dark.
##  - Placement: finishers in arrival order, then the dead (last to die
##    ranks highest).
## Harvester and mine models: blender/props/sonar.py.

const META := {
	"id": "sonar",
	"title": "SONAR CROSSING",
	"tagline": "Stand still and listen. The harvester is not listening.",
	"category": "Hazard",
	"controls": [{"input": "move", "label": "Move"}, {"input": "b", "label": "Shove"}],
	"objective": "Cross the minefield and reach the exit gate.",
	"rules": [
		"The mines are invisible. Stand still to send a sonar ping that reveals nearby ones.",
		"A mine takes out everyone within arm's reach.",
		"After 12 s the harvester starts rolling up behind you — and it speeds up.",
		"Finish order decides placement. Shoving is allowed.",
	],
}

const HW := 7.0                 # field half-width
const START_Z := 0.0
const FINISH_Z := -40.0
const MINE_COUNT := 70
const MINE_TRIGGER := 0.5       # actor centre within this of a mine sets it off
const BLAST_KILL := 1.4
const PING_STILL := 0.8
const PING_R := 4.5
const REVEAL_TIME := 3.0
const HARVEST_AT := 12.0
const CAP := 60.0
const HARVESTER_START_Z := 7.5
const DRUM_R := 1.1
const STACK_X := [-4.0, 4.0]    # exhaust stacks (local x; at y 3.5, z 3.4)

var arena: Arena
var cam_goal := 1.0
var cam_z := 1.0
var moon: DirectionalLight3D
var pack_light: OmniLight3D
var mines := []
var harvester := {}
var beacons := []               # beacon materials (left, right)
var pings := []
var ping_mat: StandardMaterial3D
var crater_mat: StandardMaterial3D
var finishers := []
var harvest_announced := false
var cap_announced := false
var _prompt_t := -1.0           # JS: setTimeout(() => hud.prompt(null), 3500)


func build() -> void:
	make_scene({"fog": 0x0a0b0d, "fog_near": 20.0, "fog_far": 46.0, "ambient": 0x4a5060, "ambient_intensity": 1.15})
	fx.reserve_flash()   # explosions reuse one light (no shader recompiles)
	make_camera([0, 12, 11], [0, 0, -3.5], 50)
	cam_goal = 1.0
	cam_z = 1.0

	# --- ground
	Env.floor_plane(scene, 60, 50, {"tex": "dirt", "tile": 3.0, "x": 0.0, "z": -16.0, "color": 0x8a8070})
	Env.floor_plane(scene, HW * 2, 46, {"tex": "dirt", "tile": 2.0, "y": 0.004, "z": -18.0, "color": 0x6e6352})
	var patch_mat := Mats.mat(0x1c1a14, null, {"opacity": 0.55, "depth_write": false})
	for i in 14:
		var p := Env.mesh(Geo.circle(Rng.rand(0.5, 1.4), 9), patch_mat, Rng.rand(-HW + 1, HW - 1), 0.01, Rng.rand(FINISH_Z + 2, -2), {"cast": false})
		p.rotation.x = -PI / 2
		p.scale.y = Rng.rand(0.5, 1)
		scene.add_child(p)
	var start_line := Env.mesh(Geo.plane(HW * 2, 0.25), Mats.mat(0xd8d2c0), 0, 0.02, START_Z, {"cast": false})
	start_line.rotation.x = -PI / 2
	scene.add_child(start_line)
	Env.stencil(scene, "LISTEN", 0, 0.03, 2.0, {"w": 5.0, "h": 1.6, "opacity": 0.35}).rotation.x = -PI / 2
	Env.hazard_strip(scene, 0, FINISH_Z, HW * 2, 0.5, 0.02)

	_build_fences(scene)
	_build_gate(scene)
	_build_lights(scene)

	# --- arena + avatars
	arena = Arena.new({"bounds": {"min_x": -HW, "max_x": HW, "min_z": FINISH_Z - 30, "max_z": 3.2}, "shove_force": 12.0})
	for i in seats.size():
		var seat: Dictionary = seats[i]
		var x := (i - (seats.size() - 1) / 2.0) * 3
		var z := 1.6
		spawn_subject(seat, {"x": x, "z": z, "facing": PI})
		seat.actor = arena.add(ArenaActor.new({"player": seat.player, "ctrl": seat.ctrl, "subject": seat.subject, "x": x, "z": z, "speed": 4.8}))
		seat.actor.seat = seat
		seat.actor.facing = PI
		seat.actor.data["still"] = 0.0
		seat["finished"] = false
		seat["pinged"] = false
		seat["walk_z"] = 0.0
	arena.on_shove = func(att: ArenaActor, vic: ArenaActor):
		vic.data["last_shover"] = att.seat
		vic.data["shoved_at"] = time

	_place_mines(scene)
	_build_harvester(scene)
	pings = []
	# Ping rings clone this material; the hidden template mirrors the JS prewarm sample.
	ping_mat = Mats.glow(0x39ff5a, {"opacity": 0.9, "depth_write": false, "double_side": true})
	var template := Env.mesh(Geo.ring(0.88, 1, 8), ping_mat, 0, 0.06, 0, {"cast": false})
	template.visible = false
	scene.add_child(template)
	crater_mat = Mats.mat(0x0e0c09, null, {"opacity": 0.8, "depth_write": false})
	finishers = []
	harvest_announced = false
	cap_announced = false


# ------------------------------------------------------------------ stage

func _build_fences(scn: Node3D) -> void:
	var post_mat := Mats.mat(0x5a4a38, Tex.wood())
	var wire_mat := Mats.mat(0x6d6d66, Tex.metal())
	var length := 48.0
	var zc := -20.0
	for sx in [-1.0, 1.0]:
		var x: float = sx * (HW + 0.35)
		var z := 4.0
		while z >= FINISH_Z - 1:
			var p := Env.mesh(Geo.box(0.14, 1.6, 0.14), post_mat, x, 0.8, z)
			p.rotation.z = Rng.rand(-0.06, 0.06)
			scn.add_child(p)
			z -= 2.5
		for y in [0.45, 0.85, 1.25]:
			Env.block(scn, x, y, zc, 0.03, 0.03, length, wire_mat)
		# Barbs: little crossed spikes along the wires (InstancedMesh → MultiMesh).
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = Geo.box(0.02, 0.14, 0.02)
		mm.instance_count = 180
		for i in 180:
			var y: float = [0.45, 0.85, 1.25][i % 3]
			var b := Basis.from_euler(Vector3(Rng.rand(-1, 1), 0, 0.8 if i % 2 == 1 else -0.8), EULER_ORDER_XYZ)
			mm.set_instance_transform(i, Transform3D(b, Vector3(x, y, 4 - (i / 180.0) * length)))
		var barbs := MultiMeshInstance3D.new()
		barbs.multimesh = mm
		barbs.material_override = wire_mat
		scn.add_child(barbs)


## Exit gate + a pitch-black tunnel that finishers disappear into.
func _build_gate(scn: Node3D) -> void:
	var z := FINISH_Z - 0.6
	var steel := Mats.mat(0x585c58, Tex.metal())
	Env.block(scn, -HW - 0.4, 2, z, 0.6, 4, 0.6, steel)
	Env.block(scn, HW + 0.4, 2, z, 0.6, 4, 0.6, steel)
	Env.block(scn, 0, 4.2, z, HW * 2 + 1.4, 0.6, 0.6, steel)
	var sign_tex := Tex.text("EXIT", {"w": 256, "h": 80, "size": 64, "color": "#39ff5a", "bg": "#041004", "grimy": false})
	var sign := Env.mesh(Geo.plane(3.2, 1.0), Mats.glow(0xffffff, {"tex": sign_tex}), 0, 4.2, z + 0.32, {"cast": false})
	scn.add_child(sign)
	var exit_light := Env.point_light(0x39ff5a, 18, 10, 1.4)
	exit_light.position = Vector3(0, 3.5, z + 1.5)
	scn.add_child(exit_light)
	var dark_mat := Mats.glow(0x020202)
	dark_mat.cull_mode = BaseMaterial3D.CULL_FRONT   # THREE.BackSide
	var dark := Env.mesh(Geo.box(HW * 2 + 0.6, 4, 14), dark_mat, 0, 1.99, z - 7.2, {"cast": false})
	scn.add_child(dark)


func _build_lights(scn: Node3D) -> void:
	moon = Env.dir_light(0x8a98b8, 0.9, Vector3(6, 20, 7), Vector3(0, 0, -3))
	moon.shadow_enabled = Env.shadows_enabled
	moon.directional_shadow_max_distance = 40.0
	scn.add_child(moon)
	# A watchtower searchlight that follows the pack (keeps the action readable).
	pack_light = Env.point_light(0xdfe4f0, 34, 24, 1.1)
	scn.add_child(pack_light)
	# Floodlight poles along the fences.
	var pole_mat := Mats.mat(0x3a3a36, Tex.metal())
	var lamp_mat := Mats.glow(0xfff0c0)
	var i := 0
	var z := 2.0
	while z > FINISH_Z - 2:
		var sx := 1.0 if i % 2 == 1 else -1.0
		var x := sx * (HW + 1.4)
		Env.block(scn, x, 3, z, 0.2, 6, 0.2, pole_mat)
		Env.block(scn, x - sx * 0.4, 6, z, 1, 0.3, 0.5, pole_mat)
		scn.add_child(Env.mesh(Geo.box(0.7, 0.08, 0.35), lamp_mat, x - sx * 0.5, 5.83, z, {"cast": false}))
		var l := Env.point_light(0xffe2b0, 32, 17, 1.2)
		l.position = Vector3(x - sx * 1.2, 5.4, z)
		scn.add_child(l)
		z -= 9
		i += 1


## Scatter mines, keeping a hidden meandering corridor clear so the field
## is always passable, and nothing within 2 units of the start line.
func _place_mines(scn: Node3D) -> void:
	var path := []
	var px := Rng.rand(-4, 4)
	var pz := START_Z
	while pz >= FINISH_Z:
		path.append(Vector2(px, pz))
		px = clampf(px + Rng.rand(-3.5, 3.5), -HW + 1.5, HW - 1.5)
		pz -= 4
	mines = []
	var tries := 0
	while mines.size() < MINE_COUNT and tries < 5000:
		tries += 1
		var x := Rng.rand(-HW + 0.4, HW - 0.4)
		var z := Rng.rand(FINISH_Z + 1.5, START_Z - 2)
		if _dist_to_path(path, x, z) < 1.0:
			continue
		var crowded := false
		for m in mines:
			if U.hypot(m.x - x, m.z - z) < 0.9:
				crowded = true
				break
		if crowded:
			continue
		var g := Node3D.new()
		g.add_child(Props.make("sonar", "mine"))
		var glow_mat := Mats.glow(0xff2a14, {"opacity": 0.0, "depth_write": false})
		var ring := Env.mesh(Geo.ring(0.34, 0.5, 14), glow_mat, 0, 0.03, 0, {"cast": false})
		ring.rotation.x = -PI / 2
		g.add_child(ring)
		g.position = Vector3(x, 0, z)
		g.visible = false
		scn.add_child(g)
		mines.append({"x": x, "z": z, "g": g, "glow_mat": glow_mat, "reveal": 0.0, "alive": true})


static func _dist_to_path(path: Array, x: float, z: float) -> float:
	var best := INF
	for i in path.size() - 1:
		var a: Vector2 = path[i]
		var b: Vector2 = path[i + 1]
		var vx := b.x - a.x
		var vz := b.y - a.y
		var t := clampf(((x - a.x) * vx + (z - a.y) * vz) / (vx * vx + vz * vz), 0, 1)
		best = minf(best, U.hypot(x - (a.x + vx * t), z - (a.y + vz * t)))
	return best


func _build_harvester(scn: Node3D) -> void:
	var g := Node3D.new()
	# Blender model: chassis, hood, cab, stacks, wheels + the bladed drum (child,
	# axis at y = DRUM_R) + two beacons (children).
	var body := Props.make("sonar", "harvester")
	g.add_child(body)
	var drum: Node3D = Subject._find(body, "drum")
	beacons = []
	for k in 2:
		var bm := Mats.glow(0xff9a1a)
		var b := Subject._find(body, "beacon_%d" % k) as MeshInstance3D
		if b:
			b.set_surface_override_material(0, bm)
			b.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		beacons.append(bm)
	var head := Env.spot_light(0xffe0a0, 60, 22, 0.7, 0.5, 1.2)
	head.position = Vector3(0, 3.2, 0.8)
	Env.aim(head, Vector3(0, 0, -8))
	g.add_child(head)
	g.position = Vector3(0, 0, HARVESTER_START_Z)
	scn.add_child(g)
	harvester = {"g": g, "drum": drum, "z": HARVESTER_START_Z, "speed": 0.0, "active": false, "smoke_t": 0.0}


## Front (lethal) edge of the harvester drum.
func harvest_front() -> float:
	return harvester.z - DRUM_R - 0.1


# ------------------------------------------------------------------ flow

func start() -> void:
	hud.banner("CROSS", 1000)
	hud.prompt("STAND STILL TO PING SONAR")
	_prompt_t = 3.5


func preview(dt: float) -> void:
	for s in seats:
		s.subject.animate(dt, 0)
	var drum: Node3D = harvester.drum
	drum.rotation.x -= dt * 2
	_animate_beacons()
	_update_camera(dt)


## Emit a sonar pulse from a seat, revealing nearby mines for everybody.
func ping(seat: Dictionary) -> void:
	var a: ArenaActor = seat.actor
	seat.pinged = true
	Sfx.play("sonar")
	var mat_i: StandardMaterial3D = ping_mat.duplicate()
	var ring := Env.mesh(Geo.ring(0.88, 1, 40), mat_i, a.pos.x, 0.06, a.pos.z, {"cast": false})
	ring.rotation.x = -PI / 2
	ring.scale = Vector3.ONE * 0.2
	scene.add_child(ring)
	pings.append({"ring": ring, "mat": mat_i, "t": 0.0})
	for idx in mines.size():
		var m: Dictionary = mines[idx]
		if not m.alive or U.hypot(m.x - a.pos.x, m.z - a.pos.z) > PING_R:
			continue
		m.reveal = REVEAL_TIME
		for s in seats:
			if not s.is_bot:
				continue
			var mem: Dictionary = s.brain.memory
			if not mem.has("known"):
				mem["known"] = {}
			if is_same(s, seat) or Rng.random() < 0.55 + 0.45 * s.brain.difficulty:
				mem.known[idx] = true


## Set off a mine: blast, gib everyone close, shove the rest.
func detonate(m: Dictionary) -> void:
	if not m.alive:
		return
	m.alive = false
	m.g.visible = false
	var at := Vector3(m.x, 0.2, m.z)
	fx.explosion(at, 0.8)
	Sfx.play("explode", {"vol": 0.8})
	if engine:
		engine.shake(0.5)
	var crater := Env.mesh(Geo.circle(0.9, 10), crater_mat, m.x, 0.015, m.z, {"cast": false})
	crater.rotation.x = -PI / 2
	scene.add_child(crater)
	if state != "play":
		return
	for seat in alive_seats():
		if seat.finished:
			continue
		var a: ArenaActor = seat.actor
		var dx: float = a.pos.x - m.x
		var dz: float = a.pos.z - m.z
		var d := U.hypot(dx, dz)
		if d < BLAST_KILL:
			var kx := dx if dx != 0.0 else Rng.rand(-1, 1)
			var kz := dz if dz != 0.0 else Rng.rand(-1, 1)
			kill(seat, "gib", {"dir": Vector3(kx, 0, kz), "force": 1.3})
		elif d < 3.5:
			a.knock.x += dx / d * 8 * (1 - d / 3.5)
			a.knock.z += dz / d * 8 * (1 - d / 3.5)
			a.stun = 0.25


func _finish(seat: Dictionary) -> void:
	seat.finished = true
	finishers.append(seat)
	var a: ArenaActor = seat.actor
	a.alive = false   # leave the physics sim; we animate the walk-off ourselves
	seat.walk_z = a.pos.z
	Sfx.play("ding")
	var place := finishers.size()
	hud.banner("FIRST OUT" if place == 1 else "#%d OUT" % place, 1000, "good")
	hud.feed("%s escaped" % seat.player.name(), seat.player.color)
	if not seat.pinged:
		award(seat, "blindFaith")
		hud.feed("%s never listened" % seat.player.name(), seat.player.color)


func _animate_beacons() -> void:
	var on := floori(clock * 4) % 2 == 0
	Mats.set_color(beacons[0], 0xff9a1a if on else 0x3a1a04)
	Mats.set_color(beacons[1], 0x3a1a04 if on else 0xff9a1a)


## Track the average depth of the pack; never pan back toward the start.
func _update_camera(dt: float) -> void:
	var pack := seats.filter(func(s): return s.alive and not s.finished and s.actor != null)
	if not pack.is_empty():
		var avg := 0.0
		var rear := -INF
		for s in pack:
			avg += s.actor.pos.z
			rear = maxf(rear, s.actor.pos.z)
		avg /= pack.size()
		# Average depth, held back just enough to keep the straggler in frame.
		cam_goal = maxf(FINISH_Z + 1, minf(cam_goal, maxf(avg, rear - 4.5)))
	cam_z = lerpf(cam_z, cam_goal, minf(1.0, dt * 2.5))
	Env.look_from(camera, Vector3(0, 12, cam_z + 11), Vector3(0, 0, cam_z - 3.5))
	moon.position = Vector3(6, 20, cam_z + 6)
	Env.look_dir(moon, Vector3(0, 0, cam_z - 4) - moon.position)
	pack_light.position = Vector3(0, 8, cam_z - 2)


# ------------------------------------------------------------------ update

func update(dt: float) -> void:
	if _prompt_t > 0.0:
		_prompt_t -= dt
		if _prompt_t <= 0.0:
			hud.prompt("")
	var playing := state == "play"
	arena.step(dt, playing)
	_animate_beacons()

	# Finished subjects stroll into the dark.
	for seat in seats:
		if not seat.finished or seat.subject == null or not seat.subject.root.visible:
			continue
		seat.walk_z -= 2.4 * dt
		seat.subject.root.position.z = seat.walk_z
		seat.subject.face_angle(PI, dt)
		seat.subject.animate(dt, 2.4)
		if seat.walk_z < FINISH_Z - 7:
			seat.subject.root.visible = false
			seat.tag_target = null

	# Harvester
	var h := harvester
	if playing and not h.active and time >= HARVEST_AT:
		h.active = true
		Sfx.play("grind")
		Sfx.play("horn")
		hud.banner("HARVEST TIME", 1500, "danger")
	var drum: Node3D = h.drum
	if h.active:
		h.speed = 14.0 if time >= CAP else minf(6.5, 1.1 + (time - HARVEST_AT) * 0.09)
		if playing and time >= CAP and not cap_announced:
			cap_announced = true
			hud.banner("NO MERCY", 1200, "danger")
			Sfx.play("sting")
		h.z -= h.speed * dt
		drum.rotation.x -= dt * (4 + h.speed * 2)
		h.smoke_t -= dt
		if h.smoke_t <= 0:
			h.smoke_t = 0.18
			for sx in STACK_X:
				fx.smoke(Vector3(sx, 3.5 + 0.9, h.z + 3.4), {"color": 0x2a2a2a, "size": 0.3, "life": 1.4, "rise": 2.0})
			if Rng.random() < 0.3:
				Sfx.play("engine", {"vol": 0.6})
	else:
		drum.rotation.x -= dt * 2
	h.g.position.z = h.z

	# Sonar rings
	for i in range(pings.size() - 1, -1, -1):
		var p: Dictionary = pings[i]
		p.t += dt / 0.7
		p.ring.scale = Vector3.ONE * (0.2 + p.t * PING_R)
		Mats.set_opacity(p.mat, maxf(0.0, 0.9 * (1 - p.t)))
		if p.t >= 1:
			p.ring.queue_free()
			pings.remove_at(i)
	# Revealed mines fade out
	var front := harvest_front()
	for m in mines:
		if not m.alive:
			continue
		if m.reveal > 0:
			m.reveal -= dt
			m.g.visible = true
			var k := minf(1.0, m.reveal / 1.2)
			Mats.set_opacity(m.glow_mat, maxf(0.0, k * (0.65 + 0.35 * sin(time * 14))))
			if m.reveal <= 0:
				m.g.visible = false
		if h.active and m.z > front:
			detonate(m)   # ground up by the drum

	_update_camera(dt)
	if not playing:
		return

	for seat in seats:
		if not seat.alive or seat.finished:
			continue
		var a: ArenaActor = seat.actor
		# Stillness → sonar
		var still: float = a.data.still
		if U.hypot(a.vel.x, a.vel.z) < 0.45 and a.knock.length_squared() < 0.5:
			still += dt
			if still >= PING_STILL:
				ping(seat)
				still = -0.9
		else:
			still = minf(still, 0.0) + (dt if still < 0 else 0.0)
		a.data.still = still
		# Mines
		for m in mines:
			if m.alive and absf(m.z - a.pos.z) < 1 and U.hypot(m.x - a.pos.x, m.z - a.pos.z) < MINE_TRIGGER:
				detonate(m)
				break
		if not seat.alive:
			continue
		# Harvester
		if a.pos.z > harvest_front() - 0.3:
			kill(seat, "gib", {"dir": Vector3(Rng.rand(-0.3, 0.3), 0, -1), "force": 1.6})
			fx.spray(Vector3(a.pos.x, 1.5, a.pos.z), 40, {"dir": Vector3(0, 0.5, -1), "speed": 9.0})
			continue
		if a.pos.z < FINISH_Z:
			_finish(seat)

	# HUD
	hud.set_timer(HARVEST_AT - time if time < HARVEST_AT else maxf(0.0, CAP - time))
	for seat in seats:
		if seat.finished:
			var place := 0
			for k in finishers.size():
				if is_same(finishers[k], seat):
					place = k + 1
			hud.set_stat(seat, "ESCAPED #%d" % place)
		elif not seat.alive:
			hud.set_stat(seat, "MULCHED")
		else:
			hud.set_stat(seat, "%dm TO GO" % maxi(0, ceili(seat.actor.pos.z - FINISH_Z)))
	if seats.all(func(s): return not s.alive or s.finished):
		end(1.8)
	elif time > CAP + 20:
		end()   # absolute safety net


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
	for s in dead:
		tiers.append([s])
	return tiers


# ---------------------------------------------------------------------- bots

## True if walking from `pos` along the unit direction (dx, dz) for ~1.6 units
## stays clear of every known live mine (and inside the fences).
func _path_clear(pos: Vector3, dx: float, dz: float, known: Dictionary, reach: float = 1.6, margin: float = 0.85) -> bool:
	var t := 0.35
	while t <= reach:
		var px := pos.x + dx * t
		var pz := pos.z + dz * t
		if absf(px) > HW - 0.4:
			return false
		for idx in known:
			var m: Dictionary = mines[idx]
			if m.alive and U.hypot(m.x - px, m.z - pz) < margin:
				return false
		t += 0.35
	return true


## Choose the safest of 16 headings around the bot. Clear paths that move
## toward the exit (−Z) score best, sideways next, backwards last — but a
## backwards path still beats walking onto a mine. `max_back` limits how far
## backwards is acceptable (the harvester may be right behind us).
## Returns Vector2(x, z) or null when every direction is blocked.
func _best_escape(pos: Vector3, known: Dictionary, max_back: float = INF) -> Variant:
	var best = null
	var best_score := -INF
	for i in 16:
		var ang := i / 16.0 * TAU
		var dx := sin(ang)
		var dz := -cos(ang)   # i = 0 points at the exit
		if dz > 0 and max_back < 2.5:
			continue          # no room to back up: harvester
		if not _path_clear(pos, dx, dz, known):
			continue
		# Clearance: distance from the probe end to the nearest known mine.
		var ex := pos.x + dx * 1.6
		var ez := pos.z + dz * 1.6
		var clear := 4.0
		for idx in known:
			var m: Dictionary = mines[idx]
			if m.alive:
				clear = minf(clear, U.hypot(m.x - ex, m.z - ez))
		var score := -dz * 2 + clear * 0.6 + Rng.random() * 0.2
		if score > best_score:
			best_score = score
			best = Vector2(dx, dz)
	return best


func bot_think(seat: Dictionary, dt: float) -> void:
	var a: ArenaActor = seat.actor
	var brain: Dictionary = seat.brain
	var mem: Dictionary = brain.memory
	if seat.finished:
		return
	if not mem.has("known"):
		mem["known"] = {}
	if not mem.has("ping_t"):
		mem["ping_t"] = 0.0
		mem["lane_t"] = 0.0
		mem["back_t"] = 0.0
		mem["back_x"] = 0.0
		mem["back_z"] = 0.0
	var known: Dictionary = mem.known
	a.ctrl.set_buttons(false, false)
	var gap := harvest_front() - a.pos.z          # distance to the drum behind us
	var panic: bool = harvester.active and gap < 4 + harvester.speed * 0.8

	# Periodic sonar stops (more frequent for careful/skilled bots).
	if mem.ping_t > 0:
		mem.ping_t -= dt
		if not panic:
			a.ctrl.set_move(0, 0)
			return
		mem.ping_t = 0.0
	var interval := lerpf(6.5, 2.8, brain.difficulty)
	if not mem.has("last_z"):
		mem["last_z"] = a.pos.z
		mem["travel"] = interval + 1 if Rng.random() < 0.4 + brain.difficulty * 0.6 else 0.0   # careful bots listen before the first step
	mem.travel += absf(a.pos.z - mem.last_z)
	mem.last_z = a.pos.z
	if not panic and mem.travel > interval and time > 0.6:
		mem.travel = 0.0
		mem.ping_t = PING_STILL + 0.25 + brain.reaction
		a.ctrl.set_move(0, 0)
		return

	# Lane drift keeps the pack from piling into one file.
	mem.lane_t -= dt
	if mem.lane_t <= 0 or not mem.has("lane_x"):
		mem["lane_x"] = Rng.rand(-HW + 1.5, HW - 1.5)
		mem.lane_t = Rng.rand(2.5, 5)
	var mx := clampf((mem.lane_x - a.pos.x) * 0.15, -0.4, 0.4)
	var mz := -1.0

	# Steer around remembered mines ahead.
	for idx in known.keys():
		var m: Dictionary = mines[idx]
		if not m.alive:
			known.erase(idx)
			continue
		var dx: float = a.pos.x - m.x
		var dz: float = a.pos.z - m.z
		var d := U.hypot(dx, dz)
		if d > 2.4 or dz < -0.6:
			continue   # behind us: irrelevant
		var w := (2.4 - d) / 2.4
		var side := signf(dx) if absf(dx) > 0.05 else (-1.0 if a.pos.x > 0 else 1.0)
		mx += side * w * 2.6
		if d < 1.1:
			mz += w * 1.4   # too close: ease off the forward push
	# Keep some distance from the others — one mine should not take out a crowd.
	if not panic:
		for o in seats:
			if is_same(o, seat) or not o.alive or o.finished:
				continue
			var dx: float = a.pos.x - o.actor.pos.x
			var dz: float = a.pos.z - o.actor.pos.z
			var d := U.hypot(dx, dz)
			if d < 2.2 and d > 0.01:
				mx += dx / d * (2.2 - d) * 0.6
				mz += dz / d * (2.2 - d) * 0.25
	# Fences
	if a.pos.x > HW - 1.2:
		mx -= 1.2
	if a.pos.x < -HW + 1.2:
		mx += 1.2
	var care := 1.0 if panic else lerpf(0.75, 0.9, brain.difficulty)

	# Dead ends: if the way we want to go runs into a known mine (e.g. mines
	# left, right AND ahead, where the pushes above cancel out), pick the
	# safest direction all around — backwards included — and back out for a
	# moment before trying a new lane.
	if mem.back_t > 0:
		mem.back_t -= dt
		if _path_clear(a.pos, mem.back_x, mem.back_z, known):
			a.ctrl.set_move(mem.back_x * care, mem.back_z * care)
			return
		mem.back_t = 0.0   # the escape route itself is blocked now: re-plan below
	var length := U.hypot(mx, mz)
	if length == 0.0:
		length = 1.0
	var dir_x := mx / length
	var dir_z := mz / length
	if not _path_clear(a.pos, dir_x, dir_z, known):
		var escape = _best_escape(a.pos, known, gap if panic else INF)
		if escape != null:
			dir_x = escape.x
			dir_z = escape.y
			if escape.y > 0.2:                   # going backwards: commit for a moment
				mem.back_x = dir_x
				mem.back_z = dir_z
				mem.back_t = Rng.rand(0.7, 1.2)
				mem.lane_x = Rng.rand(-HW + 1.5, HW - 1.5)   # then try another lane
				mem.lane_t = Rng.rand(2.5, 5)
	length = U.hypot(dir_x, dir_z)
	if length == 0.0:
		length = 1.0
	a.ctrl.set_move(dir_x / length * care, dir_z / length * care)

	# Opportunistic shove: a rival standing next to a known mine.
	if Rng.random() < 0.04 * brain.difficulty:
		for o in seats:
			if is_same(o, seat) or not o.alive or o.finished:
				continue
			var dx: float = o.actor.pos.x - a.pos.x
			var dz: float = o.actor.pos.z - a.pos.z
			var d := U.hypot(dx, dz)
			if d > 1.3:
				continue
			var behind_them := false
			for idx in known:
				var m: Dictionary = mines[idx]
				if m.alive and U.hypot(m.x - (o.actor.pos.x + dx / d), m.z - (o.actor.pos.z + dz / d)) < 0.8:
					behind_them = true
					break
			if behind_them:
				a.ctrl.set_move(dx / d * 0.3, dz / d * 0.3)
				a.ctrl.set_buttons(false, true)
				break


func dispose() -> void:
	for seat in seats:
		seat.actor = null   # break the seat <-> actor reference cycle
	super.dispose()

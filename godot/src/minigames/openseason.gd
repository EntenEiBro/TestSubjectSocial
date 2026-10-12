extends Minigame
## OPEN SEASON — rotating hunter vs. runners in a long walled courtyard.
##
## Rules:
##  - The round is split into N sub-rounds (N = number of players). In each,
##    one player is the HUNTER (in a sniper nest behind the camera) and every
##    other player is a RUNNER.
##  - Runners start at the far end of the courtyard and must reach the green
##    exit strip near the nest. Crates, barriers and pillars provide cover.
##    B = shove / forward dive.
##  - The hunter steers a swaying crosshair with the stick and fires with A
##    (bolt action, 1.2 s between shots). Shots are raycast from the camera:
##    skull = instant kill, body = wounded (55 % speed, blood trail), a second
##    body hit kills. Cover blocks shots.
##  - A sub-round ends when every runner is dead or out, or after 30 s.
##  - Points: runner escapes +2, hunter +1 per kill. Everyone returns for the
##    next sub-round, so deaths here are per-sub-round avatars (fx only, not
##    kill()). Final ranking: tiers by total points.
##
## Rifle and sandbags: blender/props/openseason.py. THREE's Raycaster is
## replaced by a small ray-vs-mesh test (AABB, then triangles) in this file.

const META := {
	"id": "openseason",
	"title": "OPEN SEASON",
	"tagline": "Everyone gets a turn with the rifle. Everyone gets a turn being the deer.",
	"category": "Roles",
	"controls": [{"input": "move", "label": "Run / Aim"}, {"input": "a", "label": "Fire (hunter)"}, {"input": "b", "label": "Dive / Shove (runner)"}],
	"objective": "Score the most points: escape as a runner, drop runners as the hunter.",
	"rules": [
		"Each player hunts once from the nest while the others run for the green exit.",
		"Headshots kill instantly. A body hit wounds; a second one finishes the job.",
		"Cover blocks bullets. Escaping scores +2, every kill scores the hunter +1.",
	],
}

const HALF_W := 7.0          # courtyard half-width
const FAR_Z := -22.0         # far wall
const START_Z := -19.0       # runner start line
const EXIT_Z := 4.5          # crossing this line = escaped
const SUB_TIME := 30.0
const INTRO := 2.4
const OUTRO := 2.4
const FIRE_CD := 1.2
const CROSS_SPEED := 1.25    # NDC units / second (vertical); horizontal scaled by aspect
const ASPECT := 16.0 / 9.0
const RUN_MUL := 0.85        # runner base speed multiplier
const WOUND_MUL := 0.55
const RAY_FAR := 80.0

## Cover layout: [x, z, w, d, h, kind]. Rows are derived from z.
const COVER := [
	[-4.4, -14.0, 1.2, 1.2, 2.4, "stack"],
	[0.6, -13.6, 2.6, 0.6, 1.0, "barrier"],
	[4.6, -14.6, 0.9, 0.9, 3.2, "pillar"],
	[-1.8, -9.2, 0.9, 0.9, 3.2, "pillar"],
	[2.8, -9.4, 1.2, 1.2, 1.2, "crate"],
	[-5.3, -8.8, 1.2, 1.2, 1.2, "crate"],
	[-3.4, -4.6, 2.6, 0.6, 1.0, "barrier"],
	[1.4, -4.2, 1.2, 1.2, 2.4, "stack"],
	[5.3, -5.0, 1.2, 1.2, 1.2, "crate"],
	[-1.2, 0.0, 1.2, 1.2, 1.2, "crate"],
	[3.4, -0.6, 0.9, 0.9, 3.2, "pillar"],
	[-5.4, 0.4, 1.2, 1.2, 2.4, "stack"],
]

static var _face_cache := {}

var arena: Arena
var blockers := []        # {mi, seat: null} — meshes that stop bullets (cover, walls, floor)
var cover := []
var rifle: Node3D
var band_mat: StandardMaterial3D
var muzzle: Node3D
var recoil := 0.0
var cross_el: Reticle
var exit_mat: StandardMaterial3D
var cross := Vector2(0, 0.05)
var cool := 0.0
var bolt_t := 0.0
var leaving := []
var tracers := []
var sway_t := 0.0
var sub := {}
var final_tiers = null
var _last_dir := Vector3.FORWARD


static func _row_of(z: float) -> int:
	return 0 if z < -12 else (1 if z < -7 else (2 if z < -2.5 else 3))


## DOM reticle of the web version, drawn as a HUD control (removed in dispose()).
class Reticle extends Control:
	var col := Color.WHITE

	func _draw() -> void:
		var k := size.x / 100.0
		for pass_i in 2:
			var c := Color(0, 0, 0, 0.5) if pass_i == 0 else col
			var lw := (6.5 if pass_i == 0 else 4.0) * k
			draw_arc(Vector2(50, 50) * k, 28 * k, 0, TAU, 40, c, lw, true)
			draw_line(Vector2(50, 2) * k, Vector2(50, 34) * k, c, lw)
			draw_line(Vector2(50, 66) * k, Vector2(50, 98) * k, c, lw)
			draw_line(Vector2(2, 50) * k, Vector2(34, 50) * k, c, lw)
			draw_line(Vector2(66, 50) * k, Vector2(98, 50) * k, c, lw)
			draw_circle(Vector2(50, 50) * k, (4.5 if pass_i == 0 else 3.0) * k, c)


func build() -> void:
	make_scene({"fog_near": 26.0, "fog_far": 72.0})
	make_camera([0, 7, 13], [0, 0, -7], 52)   # (the rifle model hangs off the camera)

	var length := EXIT_Z + 3 - FAR_Z
	var mid_z := (EXIT_Z + 3 + FAR_Z) / 2
	var ground := Env.floor_plane(scene, HALF_W * 2 + 8, length + 14, {"tex": "concrete", "tile": 3.0, "z": mid_z + 3})
	blockers.append({"mi": ground, "seat": null})
	Env.floor_plane(scene, HALF_W * 2, length, {"tex": "tiles", "tile": 1.6, "y": 0.004, "z": mid_z})

	# Courtyard walls
	var wall_mat := Mats.mat(0xffffff, Tex.wall(Vector2(length / 4, 1)))
	var far_mat := Mats.mat(0xffffff, Tex.wall(Vector2(HALF_W / 2, 1.5)))
	for w in [
		Env.block(scene, -HALF_W - 0.2, 2, mid_z, 0.4, 4, length, wall_mat),
		Env.block(scene, HALF_W + 0.2, 2, mid_z, 0.4, 4, length, wall_mat),
		Env.block(scene, 0, 3, FAR_Z - 0.2, HALF_W * 2 + 0.8, 6, 0.4, far_mat),
	]:
		blockers.append({"mi": w, "seat": null})
	Env.stencil(scene, "RUN", 0, 3.4, FAR_Z + 0.02, {"w": 7.0, "h": 2.6, "opacity": 0.6})
	Env.stencil(scene, "NO LOITERING", -HALF_W + 0.03, 2.4, -10, {"w": 5.0, "h": 1.2, "rot_y": PI / 2, "opacity": 0.4})
	Env.hazard_strip(scene, 0, START_Z + 1.2, HALF_W * 2, 0.35, 0.01)

	# Exit strip + gate posts with signs
	exit_mat = Mats.glow(0x39ff5a, {"opacity": 0.28, "depth_write": false})
	var exit_glow := Env.mesh(Geo.plane(HALF_W * 2, 1.6), exit_mat, 0, 0.015, EXIT_Z + 0.8, {"cast": false})
	exit_glow.rotation.x = -PI / 2
	scene.add_child(exit_glow)
	var sign_mat := Mats.glow(0xffffff, {"tex": Tex.text("EXIT", {"w": 128, "h": 64, "size": 46, "color": "#39ff5a", "bg": "#0a1a0a"})})
	for side in [-1, 1]:
		Env.block(scene, side * (HALF_W - 0.3), 1.5, EXIT_Z, 0.5, 3, 0.5, Mats.mat(0x5a5d58, Tex.plate()))
		scene.add_child(Env.mesh(Geo.plane(1.1, 0.45), sign_mat, side * (HALF_W - 0.3), 2.5, EXIT_Z + 0.26, {"cast": false}))
	# Sandbag lip of the sniper nest along the bottom of the frame (Blender sandbags)
	for i in range(-4, 5):
		var b := Props.make("openseason", "sandbag")
		_no_shadow(b)
		b.position = Vector3(i * 0.95, 4.35 + (i % 2) * 0.05, 10.7)
		b.rotation.y = Rng.rand(-0.1, 0.1)
		scene.add_child(b)
	Env.block(scene, 0, 2.1, 10.9, 9, 4.2, 0.6, Mats.mat(0x55524a, Tex.concrete()))

	# Lighting along the courtyard
	for z in [-18.0, -11.0, -4.0, 2.5]:
		Env.hanging_lamp(scene, 0, 6, z, {"intensity": 75.0, "angle": 1.0, "distance": 26.0})

	# Cover + collision
	arena = Arena.new({"bounds": {"min_x": -HALF_W, "max_x": HALF_W, "min_z": FAR_Z + 0.4, "max_z": EXIT_Z + 2.5}, "shove_force": 10.0})
	for cv in COVER:
		var x: float = cv[0]
		var z: float = cv[1]
		var w: float = cv[2]
		var d: float = cv[3]
		var h: float = cv[4]
		_build_cover(x, z, w, d, h, cv[5])
		arena.add_wall(x - w / 2, x + w / 2, z - d / 2, z + d / 2)
		cover.append({"x": x, "z": z, "w": w, "d": d, "h": h, "row": _row_of(z)})

	_build_rifle()
	_build_crosshair()

	cross = Vector2(0, 0.05)
	cool = 0.0
	bolt_t = 0.0
	sway_t = 0.0
	for i in seats.size():
		var seat: Dictionary = seats[i]
		seat["idx"] = i
		seat["os"] = {"points": 0, "kills": 0, "escapes": 0, "wounded": false, "down": false, "escaped": false, "meshes": [], "trail_t": 0.0}
	_setup_sub(0)


# ------------------------------------------------------------------ stage

func _build_cover(x: float, z: float, w: float, d: float, h: float, kind: String) -> void:
	var add := func(m: MeshInstance3D) -> MeshInstance3D:
		scene.add_child(m)
		blockers.append({"mi": m, "seat": null})
		return m
	if kind == "crate" or kind == "stack":
		var crate_mat := Mats.mat(0xffffff, Tex.crate())
		var s := h / 2 if h > 1.5 else h
		add.call(Env.mesh(Geo.box(w, s, d), crate_mat, x, s / 2, z))
		if kind == "stack":
			var top: MeshInstance3D = add.call(Env.mesh(Geo.box(w * 0.9, s, d * 0.9), crate_mat, x + 0.05, s * 1.5, z - 0.03))
			top.rotation.y = 0.12
	elif kind == "pillar":
		add.call(Env.mesh(Geo.box(w, h, d), Mats.mat(0x8a877e, Tex.concrete()), x, h / 2, z))
		add.call(Env.mesh(Geo.box(w + 0.04, 0.4, d + 0.04), Mats.mat(0xffffff, Tex.hazard()), x, 0.5, z))
	else:   # barrier: tapered concrete block
		var c := Mats.mat(0x9a968c, Tex.concrete())
		add.call(Env.mesh(Geo.box(w, h * 0.45, d), c, x, h * 0.225, z))
		add.call(Env.mesh(Geo.box(w, h * 0.55, d * 0.55), c, x, h * 0.45 + h * 0.275, z))


static func _no_shadow(n: Node) -> void:
	if n is GeometryInstance3D:
		(n as GeometryInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for c in n.get_children():
		_no_shadow(c)


## Bolt-action rifle hanging in the lower right of the hunter's view (Blender
## model + a procedural band in the hunter's colour).
func _build_rifle() -> void:
	var g := Node3D.new()
	g.rotation_order = EULER_ORDER_XYZ
	g.add_child(Props.make("openseason", "rifle"))
	band_mat = Mats.glow(0xffffff)
	g.add_child(Env.mesh(Geo.box(0.095, 0.035, 0.08), band_mat, 0, 0.03, 0.02))
	_no_shadow(g)
	muzzle = Node3D.new()
	muzzle.position = Vector3(0, 0.03, -1.16)
	g.add_child(muzzle)
	g.position = Vector3(0.36, -0.3, -0.6)
	g.scale = Vector3.ONE * 0.62
	camera.add_child(g)
	rifle = g
	recoil = 0.0


func _build_crosshair() -> void:
	cross_el = Reticle.new()
	cross_el.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cross_el.size = Vector2.ONE * UI.u(8)
	cross_el.position = Vector2(640, 360) - cross_el.size / 2
	hud.add_child(cross_el)


func dispose() -> void:
	if is_instance_valid(cross_el):
		cross_el.queue_free()
	for seat in seats:
		seat.actor = null   # break the seat <-> actor reference cycle
		seat.brain.memory = {}
	arena.actors = []
	super.dispose()


# ------------------------------------------------------------ sub-rounds

## Rebuild avatars for sub-round `i` (hunter = seat i).
func _setup_sub(i: int) -> void:
	for seat in seats:
		_remove_avatar(seat)
		seat.os.wounded = false
		seat.os.down = false
		seat.os.escaped = false
		seat.os.trail_t = 0.0
		seat.os.meshes = []
	arena.actors = []
	var hunter: Dictionary = seats[i]
	sub = {"index": i, "hunter": hunter, "phase": "intro", "t": 0.0}
	var runners := seats.filter(func(s): return not is_same(s, hunter))
	for k in runners.size():
		var seat: Dictionary = runners[k]
		var x := (k - (runners.size() - 1) / 2.0) * 2.6
		var z := START_Z
		var s := spawn_subject(seat, {"x": x, "z": z, "facing": 0.0})
		var actor := arena.add(ArenaActor.new({"player": seat.player, "ctrl": seat.ctrl, "subject": s, "x": x, "z": z}))
		actor.facing = 0.0
		actor.speed_mul = RUN_MUL
		actor.seat = seat
		seat.actor = actor
		# Hit zones: anything under the head group is "head", the rest "body".
		var meshes := []
		_collect_meshes(s.root, s, seat, meshes)
		seat.os.meshes = meshes
		seat.brain.memory = {}
	hunter.subject = null
	hunter.actor = null
	hunter.tag_target = null
	hunter.brain.memory = {}
	cross = Vector2(0, 0.05)
	cool = 0.4
	Mats.set_color(band_mat, hunter.player.color)
	cross_el.col = U.col(hunter.player.color)
	cross_el.queue_redraw()


func _collect_meshes(n: Node, s: Subject, seat: Dictionary, out: Array) -> void:
	if n is MeshInstance3D and n != s.ring:
		var head: Node = s.parts.head
		out.append({"mi": n, "seat": seat, "zone": "head" if (n == head or head.is_ancestor_of(n)) else "body"})
	for c in n.get_children():
		_collect_meshes(c, s, seat, out)


## Remove a living avatar from the previous sub-round (corpses stay).
func _remove_avatar(seat: Dictionary) -> void:
	var s = seat.subject
	if s != null and not seat.os.down and not seat.os.escaped:
		var root: Node3D = s.root
		if root.get_parent():
			root.get_parent().remove_child(root)
		s.dispose()
	seat.subject = null
	seat.actor = null
	seat.tag_target = null


func _announce_sub() -> void:
	var h: Dictionary = sub.hunter
	hud.banner("%s HAS THE RIFLE" % h.player.name(), 2000, "danger")
	hud.feed("ROUND %d/%d — HUNTER: %s" % [sub.index + 1, seats.size(), h.player.name()], h.player.color)
	var human := "Hunter: {MOVE} aims, {A} fires" if not h.is_bot else "Runners: reach the green exit, {B} dives"
	hud.prompt(human)
	Sfx.play("reload")


func _active_runners() -> Array:
	return seats.filter(func(s): return not is_same(s, sub.hunter) and s.actor != null and s.actor.alive and not s.os.down and not s.os.escaped)


func start() -> void:
	_announce_sub()


func preview(dt: float) -> void:
	for s in seats:
		if s.subject != null and s.actor != null:
			s.subject.animate(dt, 0)
	sway_t += dt


func update(dt: float) -> void:
	_update_fx(dt)
	if state != "play":
		arena.step(dt, false)
		_place_crosshair(false)
		return
	sub.t += dt
	sway_t += dt
	cool = maxf(0.0, cool - dt)
	if bolt_t > 0:
		bolt_t -= dt
		if bolt_t <= 0:
			Sfx.play("reload")
	_move_crosshair(dt, sub.phase != "outro")

	if sub.phase == "intro":
		arena.step(dt, false)
		if sub.t >= INTRO:
			sub.phase = "run"
			sub.t = 0.0
			Sfx.play("go")
			hud.banner("RUN", 800)
			hud.prompt("")
	elif sub.phase == "run":
		_step_runners(dt)
		var h: Dictionary = sub.hunter
		if h.ctrl.a_pressed and cool <= 0:
			_fire(h)
		if _active_runners().is_empty() or sub.t >= SUB_TIME:
			_end_sub()
	else:
		arena.step(dt, false)
		if sub.t >= OUTRO:
			if sub.index + 1 < seats.size():
				_setup_sub(sub.index + 1)
				_announce_sub()
			else:
				_finish()
	_hud_update()


## Runner movement, dives, wound trails and escapes.
func _step_runners(dt: float) -> void:
	var runners := _active_runners()
	var dives := runners.filter(func(s): return s.actor.stun <= 0 and s.ctrl.b_pressed and s.actor.shove_cd <= 0)
	arena.step(dt, true)
	for s in dives:
		s.actor.knock += s.actor.forward() * 6.5
	for s in runners:
		var a: ArenaActor = s.actor
		if s.os.wounded:
			s.subject.root.rotation.z = sin(time * 9) * 0.12
			s.os.trail_t -= dt
			if s.os.trail_t <= 0:
				s.os.trail_t = 0.3
				fx.pool(a.pos.x, a.pos.z, 0.35)
		if a.pos.z > EXIT_Z:
			_escape(s)


func _escape(seat: Dictionary) -> void:
	seat.os.escaped = true
	seat.os.points += 2
	seat.os.escapes += 1
	seat.actor.alive = false
	seat.tag_target = null
	if seat.subject.ring:
		seat.subject.ring.visible = false
	leaving.append({"s": seat.subject, "t": 0.0})
	Sfx.play("ding")
	hud.feed("%s ESCAPED +2" % seat.player.name(), seat.player.color)


func _end_sub() -> void:
	sub.phase = "outro"
	sub.t = 0.0
	var kills := seats.filter(func(s): return not is_same(s, sub.hunter) and s.os.down).size()
	var out := seats.filter(func(s): return not is_same(s, sub.hunter) and s.os.escaped).size()
	hud.banner("%d DOWN · %d OUT" % [kills, out], 2000, "danger" if kills else "good")
	Sfx.play("sting" if kills else "beep", {"vol": 0.5})


func _finish() -> void:
	for s in seats:
		s.alive = true
		s.score = s.os.points
	var sorted := _by_points()
	final_tiers = Minigame.group_by(sorted, func(s): return s.os.points)
	hud.banner("SEASON CLOSED", 2000)
	cross_el.modulate.a = 0.0
	end(2.2, final_tiers)


func _by_points() -> Array:
	var sorted := seats.duplicate()
	sorted.sort_custom(func(a, b):
		if a.os.points != b.os.points:
			return a.os.points > b.os.points
		return a.idx < b.idx)
	return sorted


func placement() -> Array:
	if final_tiers != null:
		return final_tiers
	return Minigame.group_by(_by_points(), func(s): return s.os.points)


# ---------------------------------------------------------------- the rifle

## Crosshair position including breathing sway (NDC).
func _cross_pos() -> Vector2:
	var t := sway_t
	return Vector2(
		clampf(cross.x + sin(t * 1.3) * 0.006 + sin(t * 3.1) * 0.003, -0.98, 0.98),
		clampf(cross.y + cos(t * 1.1) * 0.008 + sin(t * 2.7) * 0.003, -0.98, 0.98))


func _move_crosshair(dt: float, active: bool) -> void:
	var c: Controller = sub.hunter.ctrl
	if active:
		cross.x = clampf(cross.x + c.move_x * CROSS_SPEED * dt / ASPECT, -0.97, 0.97)
		cross.y = clampf(cross.y - c.move_y * CROSS_SPEED * dt, -0.97, 0.97)
	_place_crosshair(active)


func _place_crosshair(active: bool) -> void:
	var p := _cross_pos()
	cross_el.size = Vector2.ONE * UI.u(8)
	cross_el.position = Vector2((p.x + 1) / 2 * 1280.0, (1 - p.y) / 2 * 720.0) - cross_el.size / 2
	cross_el.modulate.a = 0.25 if not active else (0.4 if cool > 0 else 1.0)
	rifle.rotation.y = -p.x * 0.45
	rifle.rotation.x = p.y * 0.3


## World ray through NDC (x, y) of the camera: [origin, direction] (THREE setFromCamera).
func _ndc_ray(x: float, y: float) -> Array:
	var t := camera.global_transform
	var th := tan(deg_to_rad(camera.fov) * 0.5)
	return [t.origin, (t.basis * Vector3(x * th * ASPECT, y * th, -1.0)).normalized()]


## THREE's Vector3.project(camera): world point → NDC (x, y, depth z).
func _project(p: Vector3) -> Vector3:
	var v := camera.global_transform.affine_inverse() * p
	var th := tan(deg_to_rad(camera.fov) * 0.5)
	var w := -v.z
	if absf(w) < 1e-6:
		w = 1e-6
	var n := camera.near
	var f := camera.far
	var cz := -(f + n) / (f - n) * v.z - 2.0 * f * n / (f - n)
	return Vector3(v.x / (th * ASPECT) / w, v.y / th / w, cz / w)


## Meshes a shot can hit, nearest first: {c: {mi, seat, zone}, point, distance} or null.
func _ray_hit(x: float, y: float):
	var list := blockers.duplicate()
	for s in _active_runners():
		list.append_array(s.os.meshes)
	var ray := _ndc_ray(x, y)
	_last_dir = ray[1]
	return _ray_cast(ray[0], ray[1], list)


static func _faces_of(m: Mesh) -> PackedVector3Array:
	if not _face_cache.has(m):
		_face_cache[m] = m.get_faces()
	return _face_cache[m]


## Nearest ray / mesh intersection (AABB rejection, then triangles; both faces).
static func _ray_cast(origin: Vector3, dir: Vector3, cands: Array):
	var best = null
	var best_t := RAY_FAR
	for c in cands:
		var mi: MeshInstance3D = c.mi
		if not is_instance_valid(mi) or mi.mesh == null or not mi.is_inside_tree():
			continue
		var xf := mi.global_transform
		var inv := xf.affine_inverse()
		var lo := inv * origin
		var ld := inv.basis * dir
		var box := mi.get_aabb().grow(0.002)
		if not box.has_point(lo) and box.intersects_ray(lo, ld) == null:
			continue
		var faces := _faces_of(mi.mesh)
		for k in range(0, faces.size() - 2, 3):
			var hit = Geometry3D.ray_intersects_triangle(lo, ld, faces[k], faces[k + 1], faces[k + 2])
			if hit == null:
				continue
			var wp: Vector3 = xf * (hit as Vector3)
			var t := origin.distance_to(wp)
			if t < best_t:
				best_t = t
				best = {"c": c, "point": wp, "distance": t}
	return best


func _fire(hunter: Dictionary) -> void:
	cool = FIRE_CD
	bolt_t = 0.5
	recoil = 1.0
	var p := _cross_pos()
	var hit = _ray_hit(p.x, p.y)
	var dir := _last_dir
	Sfx.play("shot")
	engine.shake(0.2)
	var from := muzzle.global_position
	fx.sparks(from, {"count": 4, "speed": 2.0, "color": 0xffe08a})
	var to: Vector3 = hit.point if hit != null else from + dir * 60.0
	_tracer(from, to)
	if hit == null:
		return
	var victim = hit.c.seat
	if victim == null:
		fx.smoke(hit.point, {"size": 0.18, "life": 0.7, "color": 0x8a8270, "rise": 0.6})
		fx.sparks(hit.point, {"count": 5, "speed": 3.0})
		return
	if hit.c.zone == "head":
		_down(victim, hunter, dir, true)
	elif victim.os.wounded:
		_down(victim, hunter, dir, false)
	else:
		victim.os.wounded = true
		victim.actor.speed_mul = RUN_MUL * WOUND_MUL
		victim.actor.stun = 0.25
		fx.spray(hit.point, 14, {"dir": dir, "speed": 4.0})
		Sfx.play("splat", {"vol": 0.5})
		hud.feed("%s WOUNDED" % victim.player.name(), hunter.player.color)


## A runner is dropped for this sub-round (per-sub-round avatar, not kill()).
func _down(victim: Dictionary, hunter: Dictionary, dir: Vector3, headshot: bool) -> void:
	victim.os.down = true
	victim.actor.alive = false
	victim.tag_target = null
	if victim.subject.ring:
		victim.subject.ring.visible = false
	fx.kill(victim.subject, "shot", {"dir": dir, "force": 1.3 if headshot else 1.0})
	Sfx.play("splat", {"vol": 0.8})
	engine.shake(0.3)
	hunter.os.points += 1
	hunter.os.kills += 1
	hud.feed("%s ▸ %s%s" % [hunter.player.name(), victim.player.name(), " — HEADSHOT" if headshot else ""], hunter.player.color)
	if headshot:
		award(hunter, "cleanShot")


func _tracer(from: Vector3, to: Vector3) -> void:
	var m := Mats.glow(0xffe9a0, {"opacity": 0.9})
	var line := MeshInstance3D.new()
	line.mesh = Geo.lines([from, to])
	line.material_override = m
	line.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	scene.add_child(line)
	tracers.append({"m": line, "mat": m, "life": 0.12})


func _update_fx(dt: float) -> void:
	var i := tracers.size() - 1
	while i >= 0:
		var t: Dictionary = tracers[i]
		t.life -= dt
		Mats.set_opacity(t.mat, maxf(0.0, t.life / 0.12))
		if t.life <= 0:
			t.m.queue_free()
			tracers.remove_at(i)
		i -= 1
	i = leaving.size() - 1
	while i >= 0:
		var l: Dictionary = leaving[i]
		var s: Subject = l.s
		l.t += dt
		s.root.position.z += 4.5 * dt
		s.root.rotation.y = 0.0
		s.animate(dt, 4.5)
		if l.t > 1.6:
			if s.root.get_parent():
				s.root.get_parent().remove_child(s.root)
			s.dispose()
			leaving.remove_at(i)
		i -= 1
	recoil = maxf(0.0, recoil - dt * 5)
	rifle.position.z = -0.6 + recoil * 0.12
	Mats.set_opacity(exit_mat, 0.2 + sin(time * 4) * 0.08)


func _hud_update() -> void:
	for s in seats:
		var status := "RUNNER"
		if is_same(s, sub.hunter):
			status = "HUNTER"
		elif s.os.down:
			status = "RUNNER · DOWN"
		elif s.os.escaped:
			status = "RUNNER · OUT"
		elif s.os.wounded:
			status = "RUNNER · WOUNDED"
		hud.set_status(s, status)
		hud.set_stat(s, "PTS %d" % s.os.points)
	hud.set_timer(SUB_TIME - sub.t if sub.phase == "run" else (SUB_TIME if sub.phase == "intro" else -1.0))


# -------------------------------------------------------------------- bots

func bot_think(seat: Dictionary, dt: float) -> void:
	if is_same(seat, sub.hunter):
		_bot_hunter(seat, dt)
	else:
		_bot_runner(seat, dt)


static func _has_seat(list: Array, seat) -> bool:
	for s in list:
		if is_same(s, seat):
			return true
	return false


## Hunter bot: pick the most urgent visible runner, sweep the crosshair
## toward head or chest with skill-dependent wobble, fire once settled.
func _bot_hunter(seat: Dictionary, dt: float) -> void:
	var c: Controller = seat.ctrl
	var brain: Dictionary = seat.brain
	var m: Dictionary = brain.memory
	var d: float = brain.difficulty
	var was_a: bool = m.get("last_a", false)
	m["last_a"] = false
	c.set_buttons(false, false)
	var runners := _active_runners()
	if runners.is_empty() or sub.phase == "outro":
		c.set_move(0, 0)
		return
	m["retarget"] = float(m.get("retarget", 0.0)) - dt
	if m.get("target") == null or not _has_seat(runners, m.target) or m.retarget <= 0:
		var sorted := runners.duplicate()
		sorted.sort_custom(func(a, b):
			if a.actor.pos.z != b.actor.pos.z:
				return a.actor.pos.z > b.actor.pos.z
			return a.idx < b.idx)
		var found = null
		for s in sorted:
			if _visible(s):
				found = s
				break
		m["target"] = found if found != null else sorted[0]
		m["retarget"] = Rng.rand(1.4, 2.4)
		m["head"] = Rng.random() < 0.15 + 0.35 * d
		m["on_t"] = 0.0
	var t: Dictionary = m.target
	var part: Node3D = t.subject.parts.skull if m.head else t.subject.parts.chest
	var v := _project(part.global_position)
	# Smoothly wandering aim error.
	var amp := 0.006 + 0.045 * (1 - d)
	m["nt"] = float(m.get("nt", 0.0)) - dt
	if m.nt <= 0:
		m["ntx"] = Rng.rand(-1, 1) * amp
		m["nty"] = Rng.rand(-1, 1) * amp
		m["nt"] = Rng.rand(0.2, 0.5)
	var k := U.damp(6, dt)
	var nx: float = m.get("nx", 0.0)
	var ny: float = m.get("ny", 0.0)
	m["nx"] = nx + (float(m.get("ntx", 0.0)) - nx) * k
	m["ny"] = ny + (float(m.get("nty", 0.0)) - ny) * k
	var cur := _cross_pos()
	var ex: float = v.x + m.nx - cur.x
	var ey: float = v.y + m.ny - cur.y
	c.set_move(clampf((ex * ASPECT) / (CROSS_SPEED * 0.15), -1, 1), clampf(-ey / (CROSS_SPEED * 0.15), -1, 1))
	if sub.phase != "run" or cool > 0:
		m["on_t"] = 0.0
		return
	var err := U.hypot(ex * ASPECT, ey)
	if err < (0.02 if m.head else 0.035):
		m["on_t"] = m.on_t + dt
		if m.on_t > brain.reaction:
			var hit = _ray_hit(cur.x, cur.y)
			var on_target: bool = hit != null and is_same(hit.c.seat, t)
			# (JS compares against the distance from the camera to the projected NDC
			# point, ~14 m — kept as is so the bot fires exactly as in the web version.)
			var blocked: bool = hit != null and hit.c.seat == null and hit.distance < v.distance_to(camera.position)
			if on_target or (m.on_t > brain.reaction + 0.6 and not blocked):
				if not was_a:
					c.set_buttons(true, false)
					m["last_a"] = true
				m["on_t"] = 0.0
				m["head"] = Rng.random() < 0.15 + 0.35 * d
			elif m.on_t > 1.2:
				m["retarget"] = 0.0
	else:
		m["on_t"] = maxf(0.0, m.on_t - dt)


## Line-of-sight from the nest to a runner's chest.
func _visible(seat: Dictionary) -> bool:
	var v := _project(seat.subject.parts.chest.global_position)
	var hit = _ray_hit(v.x, v.y)
	return hit != null and is_same(hit.c.seat, seat)


## Runner bot: hop between cover pieces row by row, then sprint for the exit.
func _bot_runner(seat: Dictionary, dt: float) -> void:
	var a = seat.actor
	var c: Controller = seat.ctrl
	var brain: Dictionary = seat.brain
	var m: Dictionary = brain.memory
	c.set_buttons(false, false)
	if a == null or not a.alive or sub.phase != "run":
		c.set_move(0, 0)
		return
	if not m.has("plan"):
		m["plan"] = _make_plan()
		m["step"] = 0
		m["wait"] = 0.0
	if m.wait > 0:
		m["wait"] = m.wait - dt
		c.set_move(0, 0)
		# Break cover right after the rifle fires.
		if cool > 0.6 and Rng.random() < brain.difficulty * dt * 6:
			m["wait"] = 0.0
		if sub.t > SUB_TIME - 8:
			m["wait"] = 0.0
		return
	var wp: Dictionary = m.plan[m.step]
	var d := _go_to(a, m, wp.x, wp.z, dt)
	if d < 0.5 and m.step < m.plan.size() - 1:
		m["step"] = m.step + 1
		if wp.cover:
			m["wait"] = Rng.rand(0.2, 1.3) * (0.4 if seat.os.wounded else 1.0)
	if d > 3 and a.shove_cd <= 0 and Rng.random() < 0.25 * dt:
		c.set_buttons(false, true)


func _make_plan() -> Array:
	var plan := []
	for row in 4:
		if Rng.random() < 0.2:
			continue
		var cv: Dictionary = Rng.pick(cover.filter(func(o): return o.row == row))
		plan.append({"x": cv.x + Rng.rand(-0.3, 0.3) * cv.w, "z": cv.z - cv.d / 2 - 0.6, "cover": true})
	plan.append({"x": Rng.rand(-HALF_W + 1.2, HALF_W - 1.2), "z": EXIT_Z + 1.5, "cover": false})
	return plan


## Steer toward a point, routing around the first blocking obstacle via its corners.
func _go_to(a: ArenaActor, m: Dictionary, x: float, z: float, dt: float) -> float:
	var tx := x
	var tz := z
	var goal := Vector3(x, 0, z)
	if not arena.clear_line(a.pos, goal, 0.2):
		var w = _first_block(a.pos, goal)
		if w != null:
			var r := 0.65
			var corners := [[w.min_x - r, w.min_z - r], [w.max_x + r, w.min_z - r], [w.min_x - r, w.max_z + r], [w.max_x + r, w.max_z + r]]
			var best = null
			var bc := INF
			for cc in corners:
				var cx: float = cc[0]
				var cz: float = cc[1]
				var near := U.hypot(cx - a.pos.x, cz - a.pos.z)
				if near < 0.3:
					continue
				var cost := near + U.hypot(x - cx, z - cz) + (0.0 if arena.clear_line(a.pos, Vector3(cx, 0, cz), 0.2) else 50.0)
				if cost < bc:
					bc = cost
					best = Vector2(cx, cz)
			if best != null:
				tx = best.x
				tz = best.y
	# Stuck detection → short random sidestep.
	m["stuck_t"] = float(m.get("stuck_t", 0.0)) + dt
	if float(m.get("detour_t", 0.0)) > 0:
		m["detour_t"] = m.detour_t - dt
		a.ctrl.set_move(m.dx, m.dz)
		return U.hypot(x - a.pos.x, z - a.pos.z)
	AI.steer_to(a, tx, tz, {"arrive": 0.1, "slow": 0.3})
	if m.stuck_t > 0.7:
		var moved := 1.0
		if m.has("last_pos"):
			var lp: Vector2 = m.last_pos
			moved = U.hypot(a.pos.x - lp.x, a.pos.z - lp.y)
		if moved < 0.3 and a.stun <= 0:
			var ang := Rng.rand(0, TAU)
			m["dx"] = sin(ang)
			m["dz"] = cos(ang)
			m["detour_t"] = 0.4
		m["last_pos"] = Vector2(a.pos.x, a.pos.z)
		m["stuck_t"] = 0.0
	return U.hypot(x - a.pos.x, z - a.pos.z)


func _first_block(from: Vector3, to: Vector3):
	var d := U.hypot(to.x - from.x, to.z - from.z)
	var n := maxi(1, ceili(d / 0.2))
	for i in range(1, n):
		var x := from.x + (to.x - from.x) * i / n
		var z := from.z + (to.z - from.z) * i / n
		for w in arena.walls:
			if x > w.min_x and x < w.max_x and z > w.min_z and z < w.max_z:
				return w
	return null

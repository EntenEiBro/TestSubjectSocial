extends Minigame
## HOT SEAT — king of the hill on an electrified square platform.
##
## Rules
##  - A square platform is ringed by a live fence. Touching it ('burn') is
##    fatal; the hazard stripes mark the kill zone.
##  - A glowing pressure plate (radius 1.4) sits somewhere on the platform.
##    A subject standing on it ALONE scores 1 point per second. Two or more
##    on it = contested: nobody scores and the plate flickers red.
##  - Every ~12 s (11–13 s) the plate powers down and relocates. 1.5 s before
##    the move a red warning ring marks the next spot and a banner announces it.
##  - B shoves (Arena shove): knock rivals off the plate or into the fence.
##  - 60 s round. Ranking: survivors by points, then the fried by points
##    (ties among the fried broken by who died later). If only one subject
##    (or none) is left alive, the round ends early.
## Fence post, transformer and plate base models: blender/props/hotseat.py.

const META := {
	"id": "hotseat",
	"title": "HOT SEAT",
	"tagline": "Sit down. Stay down. Mind the fence.",
	"category": "Competitive",
	"controls": [{"input": "move", "label": "Move"}, {"input": "b", "label": "Shove"}],
	"objective": "Hold the pressure plate alone for the most seconds.",
	"rules": [
		"Stand on the glowing plate alone to earn 1 point per second.",
		"Two or more on it is contested — nobody scores. Shove them off.",
		"Every ~12 s the plate relocates. A red ring marks the next spot.",
		"The fence is electrified. Fried subjects rank below every survivor.",
	],
}

const HALF := 6.5            # fence line half-extent (square platform)
const EDGE := 0.55           # kill depth from the fence
const PLATE_R := 1.4         # pressure plate radius
const PLATE_MARGIN := 2.3    # plate centre keeps this far from the fence
const ROUND := 60.0          # seconds of play
const WARN := 1.5            # warning ring lead time before a relocation
const MOVE_MIN := 11.0
const MOVE_MAX := 13.0
const IDLE_COLOR := 0x9cff6a # unclaimed plate
const HOT_COLOR := 0xff3a20  # contested flicker

var arena: Arena
var wire_mat: StandardMaterial3D
var pad_mat: StandardMaterial3D
var warn_mat: StandardMaterial3D
var warn_ring: MeshInstance3D
var plate_group: Node3D
var plate_light: OmniLight3D
var plate := {"x": 0.0, "z": 0.0}
var next := {"x": 0.0, "z": 0.0}
var warned := false
var next_move_at := INF      # set at GO
var holder = null
var contested := false
var contest_sfx_at := -10.0
var plate_boot := 1.0
var arc_t := 0.4
var arc_idx := 0
var _prompt_off_at := -1.0   # JS: setTimeout(5000) hides the opening prompt


func build() -> void:
	var f := HALF + 0.12   # visual fence line
	make_scene({
		"fog_near": 20.0, "fog_far": 55.0,
		"floor_at": func(x: float, z: float) -> float: return 0.0 if absf(x) <= f + 0.3 and absf(z) <= f + 0.3 else -0.6,
	})
	make_camera([0, 17, 12.5], [0, 0, 0.5], 48)

	# --- room: sunken concrete floor, back wall, raised steel platform
	Env.floor_plane(scene, 60, 44, {"tex": "concrete", "tile": 3.0, "y": -0.6})
	scene.add_child(Env.mesh(Geo.plane(44, 12), Mats.mat(0xffffff, Tex.wall(Vector2(11, 3))), 0, 5, -10.5, {"cast": false}))
	Env.stencil(scene, "HIGH VOLTAGE", 0, 2.8, -10.4, {"w": 7.0, "h": 2.0, "opacity": 0.55})
	Env.pipe(scene, [-18, 5.2, -10.2], [18, 5.2, -10.2], 0.25)
	Env.pipe(scene, [-18, 4.4, -10.3], [18, 4.4, -10.3], 0.1, 0x5a3022)

	Env.block(scene, 0, -0.3, 0, f * 2 + 0.6, 0.6, f * 2 + 0.6, Mats.mat(0xffffff, Tex.plate(Vector2(5, 5))))
	Env.floor_plane(scene, HALF * 2, HALF * 2, {"tex": "tiles", "tile": 1.3, "y": 0.004})
	Env.stencil(scene, "REMAIN SEATED", 0, 0.015, 3.6, {"w": 6.0, "h": 1.6, "opacity": 0.18}).rotation.x = -PI / 2
	Env.hazard_strip(scene, 0, -HALF + 0.3, HALF * 2, 0.6, 0.012)
	Env.hazard_strip(scene, 0, HALF - 0.3, HALF * 2, 0.6, 0.012)
	Env.hazard_strip(scene, -HALF + 0.3, 0, 0.6, HALF * 2 - 1.2, 0.012)
	Env.hazard_strip(scene, HALF - 0.3, 0, 0.6, HALF * 2 - 1.2, 0.012)

	# --- electrified fence: posts + three humming wires per side (shared geometry)
	var n_posts := 8
	for i in n_posts + 1:
		var t := -f + 2 * f * i / n_posts
		var spots := [[t, -f], [t, f]]
		if i > 0 and i < n_posts:
			spots.append([-f, t])
			spots.append([f, t])
		for sp in spots:
			var post := Props.make("hotseat", "post")
			post.position = Vector3(sp[0], 0.675, sp[1])
			scene.add_child(post)
	wire_mat = Mats.glow(0x8fd0ff)
	var wire_geo := Geo.box(2 * f, 0.035, 0.035)
	for h in [0.35, 0.7, 1.05]:
		for wd in [[0.0, -f, 0.0], [0.0, f, 0.0], [-f, 0.0, PI / 2], [f, 0.0, PI / 2]]:
			var w := Env.mesh(wire_geo, wire_mat, wd[0], h, wd[1], {"cast": false})
			w.rotation.y = wd[2]
			scene.add_child(w)
	# Transformers feeding the fence from the back corners.
	for sx in [-1.0, 1.0]:
		var bx: float = sx * (f + 1.7)
		var bz := -f - 1.1
		var tr := Props.make("hotseat", "transformer")
		tr.position = Vector3(bx, 0, bz)
		scene.add_child(tr)
		scene.add_child(Env.mesh(Geo.box(0.22, 0.22, 0.05), Mats.glow(0x3aff5a), bx, 0.3, bz + 0.57, {"cast": false}))
		Env.pipe(scene, [bx, 0.6, bz], [sx * f, 1.05, -f], 0.05, 0x22221f)

	Env.hanging_lamp(scene, -3.5, 8, 0, {"intensity": 85.0, "angle": 0.85})
	Env.hanging_lamp(scene, 3.5, 8, 0, {"intensity": 85.0, "angle": 0.85})

	# --- the pressure plate
	var g := Node3D.new()
	g.add_child(Props.make("hotseat", "plate_base"))
	pad_mat = Mats.glow(IDLE_COLOR)
	g.add_child(Env.mesh(Geo.cyl(PLATE_R, PLATE_R, 0.07, 28), pad_mat, 0, 0.04, 0, {"cast": false}))
	var dark_mat := Mats.glow(0x1b1a17)
	var inner := Env.mesh(Geo.ring(PLATE_R * 0.5, PLATE_R * 0.62, 28), dark_mat, 0, 0.078, 0, {"cast": false})
	inner.rotation.x = -PI / 2
	var dot := Env.mesh(Geo.circle(PLATE_R * 0.16, 14), dark_mat, 0, 0.078, 0, {"cast": false})
	dot.rotation.x = -PI / 2
	U.add(g, [inner, dot])
	plate_light = Env.point_light(IDLE_COLOR, 10, 6, 1.5)
	plate_light.position.y = 1.2
	g.add_child(plate_light)
	scene.add_child(g)
	plate_group = g

	# Warning ring at the next spot.
	warn_mat = Mats.glow(0xff2a1a, {"opacity": 0.8, "depth_write": false, "double_side": true})
	warn_ring = Env.mesh(Geo.ring(PLATE_R - 0.12, PLATE_R + 0.08, 32), warn_mat, 0, 0.03, 0, {"cast": false})
	warn_ring.rotation.x = -PI / 2
	warn_ring.visible = false
	scene.add_child(warn_ring)

	# --- plate state
	plate = {"x": 0.0, "z": 0.0}
	next = {"x": 0.0, "z": 0.0}
	warned = false
	next_move_at = INF
	holder = null
	contested = false
	contest_sfx_at = -10.0
	plate_boot = 1.0
	arc_t = 0.4
	arc_idx = 0

	# --- arena + avatars, evenly around the plate
	arena = Arena.new({"bounds": {"min_x": -HALF, "max_x": HALF, "min_z": -HALF, "max_z": HALF}, "shove_force": 13.0})
	var n := seats.size()
	for i in n:
		var seat: Dictionary = seats[i]
		var ang := float(i) / n * TAU + PI / 4
		var x := cos(ang) * 3.2
		var z := sin(ang) * 3.2
		var facing := atan2(-x, -z)
		spawn_subject(seat, {"x": x, "z": z, "facing": facing})
		seat.actor = arena.add(ArenaActor.new({"player": seat.player, "ctrl": seat.ctrl, "subject": seat.subject, "x": x, "z": z}))
		seat.actor.facing = facing
		seat.actor.seat = seat
		seat.actor.data["hold"] = 0.0
		seat.actor.data["on_plate"] = false
	arena.on_shove = func(a: ArenaActor, b: ArenaActor):
		b.data["last_shover"] = a.seat
		b.data["shoved_at"] = time


func start() -> void:
	next_move_at = Rng.rand(MOVE_MIN, MOVE_MAX)
	hud.banner("CLAIM THE PLATE", 1000)
	hud.prompt("Stand on the plate alone to score · {B} shoves")
	_prompt_off_at = time + 5.0
	for seat in seats:
		hud.set_stat(seat, "POINTS %d" % int(seat.score))
		hud.set_status(seat, "")
	hud.set_timer(ROUND)


func preview(dt: float) -> void:
	_animate(dt)
	for s in seats:
		s.subject.animate(dt, 0)


# ------------------------------------------------------------------ plate

## Random plate spot on the platform, preferably far from (fx, fz). Bounded loop → deterministic.
func _pick_spot(fx_: float, fz: float) -> Dictionary:
	var lim := HALF - PLATE_MARGIN
	var best := {}
	var best_d := -1.0
	for i in 12:
		var x := Rng.rand(-lim, lim)
		var z := Rng.rand(-lim, lim)
		var d := U.hypot(x - fx_, z - fz)
		if d >= 4.5:
			return {"x": x, "z": z}
		if d > best_d:
			best_d = d
			best = {"x": x, "z": z}
	return best


func _warn() -> void:
	var s := _pick_spot(plate.x, plate.z)
	next.x = s.x
	next.z = s.z
	warned = true
	warn_ring.position = Vector3(s.x, 0.03, s.z)
	warn_ring.visible = true
	Sfx.play("beep")
	Sfx.play("buzz", {"vol": 0.4})
	hud.banner("PLATE RELOCATING", 1300, "danger")


func _relocate() -> void:
	var old := Vector3(plate.x, 0.2, plate.z)
	fx.sparks(old, {"color": 0xffd27a, "count": 10, "speed": 4.0})
	fx.smoke(old, {"color": 0x555555, "size": 0.4, "life": 1.2})
	plate.x = next.x
	plate.z = next.z
	plate_group.position = Vector3(plate.x, 0, plate.z)
	plate_boot = 0.0
	warned = false
	warn_ring.visible = false
	next_move_at += Rng.rand(MOVE_MIN, MOVE_MAX)
	Sfx.play("clank")
	Sfx.play("ding", {"vol": 0.5})
	hud.banner("PLATE LIVE", 900)


## THREE's Color.multiplyScalar works on linear values: scale an sRGB colour in linear space.
static func _scaled(c: Color, k: float) -> Color:
	var l := c.srgb_to_linear()
	return Color(l.r * k, l.g * k, l.b * k).linear_to_srgb()


## Cosmetic animation (fence hum, arcs, plate glow, warning ring). Deterministic: clock-based, no rng.
func _animate(dt: float) -> void:
	var c := clock
	var f := 0.6 + 0.4 * absf(sin(c * 31) * sin(c * 7.7))
	# THREE setRGB takes linear values.
	Mats.set_color(wire_mat, Color(0.45 * f, 0.75 * f, f).linear_to_srgb())

	arc_t -= dt
	if arc_t <= 0:
		arc_t = 0.5 + 0.6 * absf(sin(c * 2.3))
		var i := arc_idx
		arc_idx += 1
		var fl := HALF + 0.12
		var t := (fmod(i * 0.618034, 1.0) * 2 - 1) * HALF
		var side := i % 4
		var x := t if (side == 0 or side == 1) else (-fl if side == 2 else fl)
		var z := -fl if side == 0 else (fl if side == 1 else t)
		fx.sparks(Vector3(x, 0.35 + (i % 3) * 0.35, z), {"color": 0xbfe6ff, "count": 5, "speed": 3.0})

	plate_boot = minf(1.0, plate_boot + dt * 3)
	var b := 1.0 - pow(1.0 - plate_boot, 3.0)
	var s := 0.2 + 0.8 * b
	plate_group.scale = Vector3(s, 1, s)
	var col: Color
	var k: float
	if contested:
		var on := int(floor(c * 14)) % 2 == 0
		col = U.col(HOT_COLOR if on else 0x3a0c06)
		k = 1.0 if on else 0.2
	elif holder != null:
		col = U.col(holder.player.color)
		k = 0.85 + 0.15 * sin(c * 6)
	else:
		col = U.col(IDLE_COLOR)
		k = 0.6 + 0.3 * sin(c * 3)
	if warned and int(floor(c * 10)) % 2 == 1:
		k *= 0.4   # powering down
	Mats.set_color(pad_mat, _scaled(col, 0.35 + 0.65 * k))
	plate_light.light_color = col
	plate_light.light_energy = 10 * k * b * Env.LIGHT_K

	if warn_ring.visible:
		var p := 0.5 + 0.5 * sin(c * 18)
		Mats.set_opacity(warn_mat, 0.35 + 0.55 * p)
		warn_ring.scale = Vector3.ONE * (1 + 0.08 * p)


# ----------------------------------------------------------------- update

func update(dt: float) -> void:
	_animate(dt)
	var playing := state == "play"
	arena.step(dt, playing)
	if not playing:
		return

	if _prompt_off_at >= 0.0 and time >= _prompt_off_at:
		_prompt_off_at = -1.0
		hud.prompt("")

	# The fence.
	var lim := HALF - EDGE
	for seat in alive_seats():
		var a: ArenaActor = seat.actor
		if absf(a.pos.x) > lim or absf(a.pos.z) > lim:
			_electrocute(seat)

	# Relocation cycle (no new move announced if it would land after the bell).
	if not warned and next_move_at < ROUND - 0.5 and time >= next_move_at - WARN:
		_warn()
	if warned and time >= next_move_at:
		_relocate()

	# Scoring: exactly one live subject on the plate earns time.
	var hold_seat = null
	var count := 0
	for seat in alive_seats():
		var a: ArenaActor = seat.actor
		var on := U.hypot(a.pos.x - plate.x, a.pos.z - plate.z) < PLATE_R
		a.data["on_plate"] = on
		if on:
			count += 1
			hold_seat = seat
	var was_contested := contested
	contested = count > 1
	holder = hold_seat if count == 1 else null
	if contested and not was_contested and time - contest_sfx_at > 1.5:
		contest_sfx_at = time
		Sfx.play("buzz", {"vol": 0.25})
	if holder != null:
		var d: Dictionary = holder.actor.data
		d.hold += dt
		var pts := floorf(d.hold)
		if pts > holder.score:
			holder.score = pts
			Sfx.play("tick", {"vol": 0.7})

	# HUD
	for seat in seats:
		hud.set_stat(seat, "POINTS %d" % int(seat.score))
		var status := ""
		if not seat.alive:
			status = "FRIED"
		elif holder != null and is_same(holder, seat):
			status = "ON THE PLATE"
		elif contested and seat.actor.data.get("on_plate", false):
			status = "CONTESTED"
		hud.set_status(seat, status)
	hud.set_timer(maxf(0.0, ROUND - time))

	if time >= ROUND:
		hud.banner("TIME UP", 1500)
		hud.prompt("")
		Sfx.play("horn")
		end()
		return
	check_last_standing()


func _electrocute(seat: Dictionary) -> void:
	var a: ArenaActor = seat.actor
	var px := a.pos.x
	var pz := a.pos.z
	if absf(px) > HALF - EDGE:
		px = signf(px) * HALF
	if absf(pz) > HALF - EDGE:
		pz = signf(pz) * HALF
	fx.sparks(Vector3(px, 0.7, pz), {"color": 0x9fd8ff, "count": 16, "speed": 7.0})
	Sfx.play("buzz")
	var by = a.data.get("last_shover")
	if by != null and not is_same(by, seat) and time - float(a.data.get("shoved_at", -99.0)) < 1.5:
		hud.feed("%s fried %s" % [by.player.name(), seat.player.name()], by.player.color)
	kill(seat, "burn", {"dir": Vector3(-a.pos.x, 0, -a.pos.z)})


## Survivors by points, then the fried by points (later death breaks ties).
func placement() -> Array:
	var alive := seats.filter(func(s): return s.alive)
	alive.sort_custom(func(a, b): return a.score > b.score)
	var dead := seats.filter(func(s): return not s.alive)
	dead.sort_custom(func(a, b):
		if a.score != b.score:
			return a.score > b.score
		return a.death_time > b.death_time)
	var tiers := Minigame.group_by(alive, func(s): return s.score)
	tiers.append_array(Minigame.group_by(dead, func(s): return "%s|%.3f" % [s.score, s.death_time]))
	return tiers


# ------------------------------------------------------------------- bots

func bot_think(seat: Dictionary, dt: float) -> void:
	var a: ArenaActor = seat.actor
	var brain: Dictionary = seat.brain
	var mem: Dictionary = brain.memory
	var diff: float = brain.difficulty
	var want_b := false

	# Periodic aim error + whether this bot bothers to flank this time.
	mem["err_t"] = float(mem.get("err_t", 0.0)) - dt
	if mem.err_t <= 0:
		mem["err_t"] = Rng.rand(1.2, 2.4)
		var e: float = brain.error * 3
		mem["ox"] = Rng.rand(-e, e)
		mem["oz"] = Rng.rand(-e, e)
		mem["flank"] = Rng.random() < diff

	# 1. Where to stand: the plate, or the next spot once it is announced.
	var px: float = plate.x
	var pz: float = plate.z
	if warned:
		var left := next_move_at - time
		var travel := U.hypot(next.x - a.pos.x, next.z - a.pos.z) / a.speed
		var go: bool
		if holder != null and is_same(holder, seat):
			go = left < travel * (1.2 - diff * 0.5) + 0.15            # farm the old plate, then dash
		else:
			go = WARN - left > brain.reaction + (1 - diff) * 0.5      # everyone else heads over
		if go:
			px = next.x
			pz = next.z
	var tx: float = px + mem.ox
	var tz: float = pz + mem.oz

	# 2. A rival on our plate: flank it from the inside and shove it outward.
	var n = AI.nearest(a, arena.actors)
	var my_d := U.hypot(a.pos.x - px, a.pos.z - pz)
	var rival: ArenaActor = null
	if n != null:
		var r: ArenaActor = n.actor
		if U.hypot(r.pos.x - px, r.pos.z - pz) < PLATE_R + 0.4 and my_d < PLATE_R + 2.2:
			rival = r
	if rival != null:
		var ox := rival.pos.x - px
		var oz := rival.pos.z - pz
		var ol := U.hypot(ox, oz)
		if ol < 0.25:
			ox = rival.pos.x - a.pos.x
			oz = rival.pos.z - a.pos.z
			ol = U.hypot(ox, oz)
			if ol == 0.0:
				ol = 1.0
		ox /= ol
		oz /= ol
		if mem.flank:
			tx = rival.pos.x - ox * 0.85
			tz = rival.pos.z - oz * 0.85
		if n.dist < 1.35:
			mem["contest"] = float(mem.get("contest", 0.0)) + dt
			if mem.contest > brain.reaction and a.shove_cd <= 0 and Rng.random() < dt * (1 + diff * 4):
				want_b = true
		else:
			mem["contest"] = 0.0
	else:
		mem["contest"] = 0.0

	var mx := 0.0
	var mz := 0.0
	var dx := tx - a.pos.x
	var dz := tz - a.pos.z
	var d := U.hypot(dx, dz)
	var pace := 0.72 + diff * 0.28
	if d > 0.2:
		var s := minf(1.0, d / 0.8) * pace
		mx = dx / d * s
		mz = dz / d * s

	# 3. Soft repulsion from the wire.
	mx += _rep(a.pos.x) * (1 + diff)
	mz += _rep(a.pos.z) * (1 + diff)

	# 4. Danger: sliding toward the fence (knock decays at e^-6t → ~knock/6 left to slide),
	#    or a rival lining us up against it.
	var kl := U.hypot(a.knock.x, a.knock.z)
	var sx := a.pos.x + a.knock.x / 6
	var sz := a.pos.z + a.knock.z / 6
	var danger := HALF - 1.1
	if kl > 2 and (absf(sx) > danger or absf(sz) > danger):
		mx = -signf(sx) if absf(sx) > danger else 0.0
		mz = -signf(sz) if absf(sz) > danger else 0.0
		want_b = false
	elif n != null and n.dist < 1.8 and not want_b and diff > 0.25:
		var ex := -signf(a.pos.x) if absf(a.pos.x) > HALF - 2.4 else 0.0
		var ez := -signf(a.pos.z) if absf(a.pos.z) > HALF - 2.4 else 0.0
		var r: ArenaActor = n.actor
		if (ex != 0.0 or ez != 0.0) and (r.pos.x - a.pos.x) * ex + (r.pos.z - a.pos.z) * ez > 0.2:
			# Rival is between us and the middle: slide along the fence away from it, edging back in.
			var tnx := -ez
			var tnz := ex
			if tnx * (a.pos.x - r.pos.x) + tnz * (a.pos.z - r.pos.z) < 0:
				tnx = -tnx
				tnz = -tnz
			mx = tnx + ex * 0.5
			mz = tnz + ez * 0.5
			if n.dist < 1.3 and a.shove_cd <= 0 and Rng.random() < dt * diff * 3:
				want_b = true   # shove back

	# Shoving: point the stick at the target so the shove cone faces it.
	if want_b and n != null:
		var r: ArenaActor = n.actor
		var ax := r.pos.x - a.pos.x
		var az := r.pos.z - a.pos.z
		var al := U.hypot(ax, az)
		if al == 0.0:
			al = 1.0
		mx = ax / al * 0.5
		mz = az / al * 0.5
		a.facing = atan2(ax, az)
	a.ctrl.set_move(mx, mz)
	# Buttons are edge-triggered: alternate so repeated intents become fresh presses.
	var press: bool = want_b and not mem.get("b_prev", false)
	a.ctrl.set_buttons(false, press)
	mem["b_prev"] = press


static func _rep(v: float) -> float:
	var soft := HALF - 1.7
	if v > soft:
		return soft - v
	if v < -soft:
		return -soft - v
	return 0.0


func dispose() -> void:
	holder = null
	for seat in seats:
		seat.actor = null   # break the seat <-> actor reference cycle
		seat.brain.memory.clear()
	super.dispose()

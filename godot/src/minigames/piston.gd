extends Minigame
## PISTON PRESS — every subject gets a private island under a private
## hydraulic press. Junk rains down. Hoarders get flattened.
##
## Rules
##  - Each subject stands on their own raised square platform, separated by a
##    bottomless pit. A massive piston hangs over each platform.
##  - Junk (crates, tyres, barrels) drops onto random living platforms about
##    every 1.2 s. A picks junk up (carry pose), A again throws it in the
##    facing direction in an arc — it lands on whatever platform it reaches,
##    or falls into the pit.
##  - Thrown junk that hits a subject knocks them back hard — possibly off
##    their platform and into the pit ('fall').
##  - Every 10 s: SLAM. 3 s of sirens, then every piston drops. The platform(s)
##    holding the MOST junk (carried junk counts!) are pressed flat ('crush')
##    and their junk is cleared; the others' pistons stop at the safety catch.
##    If nobody holds any junk, nobody dies.
##  - From 70 s on, a slam comes every 5 s and always flattens exactly one
##    subject (the biggest hoarder, or a random one if all are clean).
##  - You cannot walk off your platform — only get knocked off. Last alive wins.
## Press, barrel and tyre models: blender/props/piston.py.

const META := {
	"id": "piston",
	"title": "PISTON PRESS",
	"tagline": "Tidy desk, long life. Messy desk, flat life.",
	"category": "Survival",
	"controls": [{"input": "move", "label": "Move"}, {"input": "a", "label": "Grab / Throw junk"}],
	"objective": "Never hold the most junk when the pistons slam.",
	"rules": [
		"Junk rains onto the platforms. Grab it ({A}) and throw it at rivals ({A}).",
		"Every 10 s the pistons slam: the biggest junk pile gets pressed flat.",
		"Junk in your hands counts toward your pile.",
		"A direct hit knocks a subject back — maybe into the pit.",
	],
}

const PH := 1.6                  # platform half-size (3.2 x 3.2)
const SPACING := 5.0             # centre-to-centre distance between neighbours
const GRAVITY := 20.0
const CARRY_Y := 1.3
const CARRY_FWD := 0.55
const THROW_H := 7.5
const THROW_UP := 6.0
const HIT_KNOCK := 9.0           # lethal when hit near an edge, survivable mid-platform
const PISTON_REST := 6.6
const PISTON_WARN := 5.6
const PISTON_CATCH := 2.4
const PISTON_CRUSH := 0.15
const SLAM_EVERY := 10.0
const CAP := 70.0
const CAP_EVERY := 5.0
const DROP_EVERY := 1.2
const MAX_JUNK := 28

## Platforms stand in one row across the screen: a 2x2 grid would put the
## near pistons squarely in front of the far platforms from this camera.
const LAYOUTS := {
	1: [[0.0, 0.0]],
	2: [[-SPACING / 2, 0.0], [SPACING / 2, 0.0]],
	3: [[-SPACING, 0.0], [0.0, 0.0], [SPACING, 0.0]],
	4: [[-SPACING * 1.5, 0.0], [-SPACING / 2, 0.0], [SPACING / 2, 0.0], [SPACING * 1.5, 0.0]],
}

## Horizontal distance a throw covers before touching down on a platform.
static func throw_range() -> float:
	var h0 := CARRY_Y - 0.35
	var t := (THROW_UP + sqrt(THROW_UP * THROW_UP + 2 * GRAVITY * h0)) / GRAVITY
	return CARRY_FWD + THROW_H * t

var arena: Arena
var plats := []
var junk := []
var drop_t := 0.6
var slam := {}
var siren: OmniLight3D
var _over_t := 0.0
var _crate_mat: StandardMaterial3D


func build() -> void:
	make_scene({"fog_near": 20.0, "fog_far": 46.0, "fog": 0x080808})
	make_camera([0, 12.5, 14.5], [0, 1.2, 0.2], 50)

	var layout: Array = LAYOUTS.get(seats.size(), LAYOUTS[4])
	Env.floor_plane(scene, 80, 60, {"tex": "concrete", "tile": 4.0, "y": -18.0, "color": 0x555555})
	var back := Env.mesh(Geo.plane(50, 26), Mats.mat(0xffffff, Tex.wall(Vector2(12, 6))), 0, 0, -10, {"cast": false})
	scene.add_child(back)
	Env.stencil(scene, "MIND YOUR PILE", 0, 6, -9.9, {"w": 9.0, "h": 2.6, "opacity": 0.45})
	Env.pipe(scene, [-25, 9.5, -9.6], [25, 9.5, -9.6], 0.35)
	Env.pipe(scene, [-25, 4, -9.7], [25, 4, -9.7], 0.15, 0x5b2c1e)
	var glow_pit := Env.point_light(0xa02010, 18, 22, 1.2)
	glow_pit.position = Vector3(0, -12, 0)
	scene.add_child(glow_pit)

	Env.hanging_lamp(scene, -7.5, 9.5, 4, {"intensity": 110.0, "angle": 0.75, "target": Vector3(-1, 0, 0)})
	Env.hanging_lamp(scene, 7.5, 9.5, 4, {"intensity": 110.0, "angle": 0.75, "target": Vector3(1, 0, 0), "shadow": false})
	Env.hanging_lamp(scene, 0, 10, -6.5, {"intensity": 70.0, "angle": 0.8, "target": Vector3(0, 0, 0), "shadow": false})
	siren = Env.point_light(0xff2010, 0, 30, 1)
	siren.position = Vector3(0, 6, 0)
	scene.add_child(siren)

	# --- platforms + pistons
	plats = []
	var pillar_mat := Mats.mat(0xffffff, Tex.plate(Vector2(1, 3)))
	var top_mat := Mats.mat(0xffffff, Tex.plate(Vector2(2, 2)))
	_crate_mat = Mats.mat(0xffffff, Tex.crate())
	for i in seats.size():
		var seat: Dictionary = seats[i]
		var x: float = layout[i][0]
		var z: float = layout[i][1]
		var pillar := Env.mesh(Geo.box(PH * 2, 12, PH * 2), pillar_mat, x, -6.01, z)
		scene.add_child(pillar)
		var top := Env.mesh(Geo.plane(PH * 2, PH * 2), top_mat, x, 0.001, z, {"cast": false})
		top.rotation.x = -PI / 2
		scene.add_child(top)
		# Player-coloured border so everyone knows whose island is whose.
		var edge := Mats.glow(seat.player.color)
		for e in [[0.0, -PH + 0.06, PH * 2, 0.12], [0.0, PH - 0.06, PH * 2, 0.12], [-PH + 0.06, 0.0, 0.12, PH * 2], [PH - 0.06, 0.0, 0.12, PH * 2]]:
			var s := Env.mesh(Geo.plane(e[2], e[3]), edge, x + e[0], 0.02, z + e[1], {"cast": false})
			s.rotation.x = -PI / 2
			scene.add_child(s)
		Env.hazard_strip(scene, x, z + PH - 0.3, PH * 2 - 0.3, 0.25, 0.015)

		var piston := Node3D.new()
		piston.add_child(Props.make("piston", "press"))
		var beacon_mat := Mats.glow(0x3a0a06)
		piston.add_child(Env.mesh(Geo.box(0.3, 0.2, 0.3), beacon_mat, PH - 0.35, 1.1, PH - 0.35, {"cast": false}))
		piston.position = Vector3(x, PISTON_REST, z)
		scene.add_child(piston)
		plats.append({"x": x, "z": z, "seat": seat, "piston": piston, "beacon_mat": beacon_mat, "y": PISTON_REST, "target": PISTON_REST, "crushing": false, "crushed_done": false})
		seat["plat"] = i

	# --- arena + avatars (each avatar is fenced to its own platform in update())
	arena = Arena.new({"bounds": {"min_x": -40.0, "max_x": 40.0, "min_z": -40.0, "max_z": 40.0}, "shove": false})
	for i in seats.size():
		var seat: Dictionary = seats[i]
		var pl: Dictionary = plats[i]
		spawn_subject(seat, {"x": pl.x, "z": pl.z + 0.4})
		seat.actor = arena.add(ArenaActor.new({"player": seat.player, "ctrl": seat.ctrl, "subject": seat.subject, "x": pl.x, "z": pl.z + 0.4, "speed": 4.6}))
		seat.actor.seat = seat

	junk = []
	drop_t = 0.6
	slam = {"phase": "idle", "t": 0.0, "next": SLAM_EVERY, "forced": false}


func start() -> void:
	hud.banner("KEEP IT TIDY", 1200)


func preview(dt: float) -> void:
	for s in seats:
		s.subject.animate(dt, 0)
	for pl in plats:
		pl.piston.position.y = PISTON_REST + sin(clock * 1.3 + pl.x) * 0.15


# -------------------------------------------------------------------- junk

## Create a junk mesh of a random kind.
func _make_junk() -> Dictionary:
	var kind: String = Rng.pick(["crate", "crate", "barrel", "tire"])
	var m := Node3D.new()
	m.rotation_order = EULER_ORDER_XYZ
	var half: float
	var r: float
	if kind == "crate":
		var s := Rng.rand(0.6, 0.8)
		m.add_child(Env.mesh(Geo.box(s, s, s), _crate_mat))
		half = s / 2
		r = s * 0.6
	elif kind == "barrel":
		var color: int = Rng.pick([0x2f5c8a, 0x8a2f22, 0x4c6a2a])
		m.add_child(Props.make("piston", "barrel_%06x" % color))
		half = 0.425
		r = 0.36
	else:
		m.add_child(Props.make("piston", "tire"))
		m.rotation.x = PI / 2
		half = 0.14
		r = 0.44
	var j := {"mesh": m, "kind": kind, "half": half, "r": r, "state": "flying", "plat": -1, "pos": Vector3.ZERO, "vel": Vector3.ZERO,
		"holder": null, "thrower": null, "power": 0.0, "spin": Vector3.ZERO, "hit": false}
	scene.add_child(m)
	junk.append(j)
	return j


## Index of the platform under (x, z), or -1 over the pit.
func plat_at(x: float, z: float) -> int:
	for i in plats.size():
		var pl: Dictionary = plats[i]
		if absf(x - pl.x) <= PH and absf(z - pl.z) <= PH:
			return i
	return -1


## Height at which junk `j` would rest at (x, z) on platform `p` (simple stacking).
func _rest_y(p: int, x: float, z: float, j: Dictionary, among = null) -> float:
	var top := 0.0
	for o in (among if among != null else junk):
		if is_same(o, j) or o.state != "rest" or o.plat != p:
			continue
		if U.hypot(o.pos.x - x, o.pos.z - z) < (o.r + j.r) * 0.75:
			top = maxf(top, o.pos.y + o.half)
	return top + j.half


## Re-stack a platform's pile after something was removed from it.
func _settle(p: int) -> void:
	var pile := junk.filter(func(o): return o.state == "rest" and o.plat == p)
	pile.sort_custom(func(a, b): return a.pos.y < b.pos.y)
	var done := []
	for o in pile:
		o.pos.y = _rest_y(p, o.pos.x, o.pos.z, o, done)
		o.mesh.position.y = o.pos.y
		done.append(o)


## Junk currently counted against platform p (pile + whatever its owner carries).
func count(p: int) -> int:
	var n := 0
	for o in junk:
		if (o.state == "rest" and o.plat == p) or (o.state == "carried" and o.holder != null and o.holder.plat == p):
			n += 1
	return n


func carried(seat: Dictionary) -> Variant:
	for o in junk:
		if o.state == "carried" and is_same(o.holder, seat):
			return o
	return null


func _remove_junk(j: Dictionary) -> void:
	var m: Node3D = j.mesh
	if is_instance_valid(m):
		m.queue_free()
	for i in junk.size():
		if is_same(junk[i], j):
			junk.remove_at(i)
			break


## Drop a fresh piece of junk from the ceiling onto a random living platform.
func _drop_junk() -> void:
	var living := plats.filter(func(pl): return pl.seat.alive)
	if living.is_empty() or junk.size() >= MAX_JUNK:
		return
	var pl: Dictionary = Rng.pick(living)
	var j := _make_junk()
	var px: float = pl.x + Rng.rand(-PH + 0.45, PH - 0.45)
	var pz: float = pl.z + Rng.rand(-PH + 0.45, PH - 0.45)
	j.pos = Vector3(px, 11, pz)
	j.vel = Vector3(0, -2, 0)
	j.power = 2.5
	var sx := Rng.rand(-2, 2)
	var sy := Rng.rand(-2, 2)
	var sz := Rng.rand(-2, 2)
	j.spin = Vector3(sx, sy, sz)


func _pick_up(seat: Dictionary) -> bool:
	var a: ArenaActor = seat.actor
	var best = null
	var bd := 1.15
	for j in junk:
		if j.state != "rest" or j.plat != seat.plat:
			continue
		var d := U.hypot(j.pos.x - a.pos.x, j.pos.z - a.pos.z)
		if d < bd:
			bd = d
			best = j
	if best == null:
		return false
	var p: int = best.plat
	best.state = "carried"
	best.holder = seat
	best.plat = -1
	_settle(p)
	a.subject.pose = "carry"
	Sfx.play("clank", {"vol": 0.35})
	return true


func _throw(seat: Dictionary, j: Dictionary) -> void:
	var a: ArenaActor = seat.actor
	var f := a.forward()
	j.state = "flying"
	j.holder = null
	j.thrower = seat
	j.power = HIT_KNOCK
	j.hit = false
	j.vel = Vector3(f.x * THROW_H, THROW_UP, f.z * THROW_H)
	var sx := Rng.rand(-6, 6)
	var sy := Rng.rand(-6, 6)
	var sz := Rng.rand(-6, 6)
	j.spin = Vector3(sx, sy, sz)
	a.subject.pose = "idle"
	a.subject.push()
	Sfx.play("whoosh", {"vol": 0.6})


## Let go of carried junk (holder died / got knocked off).
func _drop(seat: Dictionary) -> void:
	var j = carried(seat)
	if j == null:
		return
	j.state = "flying"
	j.holder = null
	j.thrower = null
	j.power = 0.0
	var vx := Rng.rand(-1, 1)
	var vz := Rng.rand(-1, 1)
	j.vel = Vector3(vx, 1, vz)
	if seat.subject:
		seat.subject.pose = "idle"


func _update_junk(dt: float) -> void:
	for j in junk.duplicate():
		var m: Node3D = j.mesh
		if j.state == "carried":
			var a: ArenaActor = j.holder.actor
			var yaw := a.subject.root.rotation.y
			j.pos = Vector3(a.pos.x + sin(yaw) * CARRY_FWD, a.y + CARRY_Y + j.half * 0.3, a.pos.z + cos(yaw) * CARRY_FWD)
			m.position = j.pos
			m.rotation.y = yaw
			continue
		if j.state == "rest":
			continue
		# flying / falling into the pit
		j.vel.y -= GRAVITY * dt
		j.pos += j.vel * dt
		m.rotation += j.spin * dt
		m.position = j.pos
		if j.state == "pit":
			if j.pos.y < -25:
				_remove_junk(j)
			continue
		# Hit a subject?
		if not j.hit and j.power > 0 and j.pos.y > 0.1 and j.pos.y < 2.4:
			for seat in alive_seats():
				var a: ArenaActor = seat.actor
				if is_same(seat, j.thrower) or a.falling:
					continue
				if U.hypot(a.pos.x - j.pos.x, a.pos.z - j.pos.z) > 0.45 + j.r:
					continue
				j.hit = true
				var h := Vector3(j.vel.x, 0, j.vel.z)
				if h.length_squared() < 0.01:
					h = Vector3(a.pos.x - j.pos.x, 0, a.pos.z - j.pos.z)
				if h.length_squared() < 0.0001:
					var hx := Rng.rand(-1, 1)
					var hz := Rng.rand(-1, 1)
					h = Vector3(hx, 0, hz)
				h = h.normalized()
				a.knock += h * j.power
				a.stun = 0.6 if j.power > 6 else 0.25
				if j.thrower != null:
					a.data["hit_by"] = j.thrower
					a.data["hit_at"] = time
				j.vel.x *= -0.2
				j.vel.z *= -0.2
				Sfx.play("thud")
				if j.power > 6:
					Sfx.play("clank", {"vol": 0.5})
					if engine:
						engine.shake(0.15)
				fx.sparks(j.pos, {"count": 6, "color": 0xffe0a0})
				break
		# Landing
		if j.vel.y < 0 and j.pos.y > -0.25:
			var p := plat_at(j.pos.x, j.pos.z)
			if p >= 0:
				var ry := _rest_y(p, j.pos.x, j.pos.z, j)
				if j.pos.y <= ry:
					j.pos.y = ry
					j.state = "rest"
					j.plat = p
					m.position = j.pos
					m.rotation = Vector3(PI / 2 if j.kind == "tire" else 0.0, Rng.rand(0, PI), 0)
					Sfx.play("thud", {"vol": 0.5})
		elif j.pos.y <= -0.25:
			j.state = "pit"


# ------------------------------------------------------------------ pistons

func _update_slam(dt: float) -> void:
	var S := slam
	var warn_dur := 1.5 if S.next >= CAP else 3.0
	S.t += dt
	if S.phase == "idle":
		if time >= S.next - warn_dur:
			S.phase = "warn"
			S.t = 0.0
			S.forced = S.next >= CAP
			for pl in plats:
				pl.target = PISTON_WARN
			Sfx.play("horn")
			hud.banner("PURGE!" if S.forced else "BRACE!", 1200, "danger")
	elif S.phase == "warn":
		var on := int(floor(S.t * 6)) % 2 == 0
		siren.light_energy = (40.0 if on else 4.0) * Env.LIGHT_K
		for pl in plats:
			Mats.set_color(pl.beacon_mat, 0xff2010 if on else 0x3a0a06)
		if floor(S.t * 2) != floor((S.t - dt) * 2):
			Sfx.play("buzz", {"vol": 0.5})
		if time >= S.next:
			_decide_slam()
	elif S.phase == "down":
		var settled := true
		for pl in plats:
			pl.y = maxf(pl.target, pl.y - 32 * dt)
			if pl.y > pl.target:
				settled = false
			if pl.crushing and not pl.crushed_done and pl.y <= 1.95:
				pl.crushed_done = true
				var seat: Dictionary = pl.seat
				if seat.alive and not seat.actor.falling:
					var held = carried(seat)
					if held != null:
						_remove_junk(held)
					kill(seat, "crush")
		if settled:
			S.phase = "hold"
			S.t = 0.0
			if engine:
				engine.shake(0.5)
			Sfx.play("crunch")
			for i in plats.size():
				var pl: Dictionary = plats[i]
				if pl.crushing:
					for j in junk.filter(func(o): return (o.state == "rest" and o.plat == i) or (o.state == "carried" and is_same(o.holder, pl.seat))):
						_remove_junk(j)
					for k in 4:
						var sx := Rng.rand(-1.4, 1.4)
						var sz := Rng.rand(-1.4, 1.4)
						fx.smoke(Vector3(pl.x + sx, 0.3, pl.z + sz), {"color": 0x6a6660, "size": 0.4, "life": 1.2})
				else:
					Sfx.play("clank", {"vol": 0.5})
				fx.sparks(Vector3(pl.x + PH - 0.2, pl.target, pl.z + PH - 0.2), {"count": 8})
	elif S.phase == "hold":
		if S.t >= 0.5:
			S.phase = "rise"
			S.t = 0.0
			for pl in plats:
				pl.target = PISTON_REST
	elif S.phase == "rise":
		var done := true
		for pl in plats:
			pl.y = minf(PISTON_REST, pl.y + 6 * dt)
			if pl.y < PISTON_REST:
				done = false
		if done:
			S.phase = "idle"
			S.t = 0.0
			S.next += CAP_EVERY if S.next >= CAP else SLAM_EVERY
	# Easing toward warning height (down/rise phases move pistons explicitly).
	if S.phase == "warn" or S.phase == "idle":
		for pl in plats:
			pl.y += (pl.target - pl.y) * minf(1.0, dt * 4)
	if S.phase != "warn":
		siren.light_energy = 0.0
		for pl in plats:
			Mats.set_color(pl.beacon_mat, 0x3a0a06)
	for pl in plats:
		var jitter := Rng.rand(-0.03, 0.03) if S.phase == "warn" else 0.0
		pl.piston.position = Vector3(pl.x + jitter, pl.y, pl.z + jitter)


## Pick which platforms get flattened and send every piston down.
func _decide_slam() -> void:
	var S := slam
	S.phase = "down"
	S.t = 0.0
	var living := []      # platform indices
	for i in plats.size():
		if plats[i].seat.alive:
			living.append(i)
	var counts := living.map(func(i): return count(i))
	var mx := 0
	for c in counts:
		mx = maxi(mx, c)
	var victims := []     # platform indices
	if S.forced:
		if mx > 0:
			var top := []
			for k in living.size():
				if counts[k] == mx:
					top.append(living[k])
			victims = [Rng.pick(top)]
		else:
			victims = [Rng.pick(living)]
	elif mx > 0:
		for k in living.size():
			if counts[k] == mx:
				victims.append(living[k])
	for i in plats.size():
		var pl: Dictionary = plats[i]
		var crush: bool = i in victims or not pl.seat.alive   # empty platforms always get squashed clean
		pl.crushing = crush
		pl.crushed_done = false
		pl.target = PISTON_CRUSH if crush else PISTON_CATCH
	Sfx.play("grind")
	hud.banner("SLAM!" if not victims.is_empty() else "ALL CLEAN", 1000, "danger" if not victims.is_empty() else "good")


# ------------------------------------------------------------------- update

func update(dt: float) -> void:
	var playing := state == "play"
	arena.step(dt, playing)

	# Keep everyone on their own island; a hard knock carries them over the edge.
	for seat in seats:
		if not seat.alive:
			continue
		var a: ArenaActor = seat.actor
		var pl: Dictionary = plats[seat.plat]
		if a.falling:
			if a.y < -2.5 and playing:
				_fall_kill(seat)
			continue
		var dx: float = a.pos.x - pl.x
		var dz: float = a.pos.z - pl.z
		if absf(dx) > PH or absf(dz) > PH:
			a.falling = true
			a.vy = 2.0
			_drop(seat)
			a.subject.pose = "armsUp"
			Sfx.play("whoosh")
		elif a.knock.length() < 3:
			var lim := PH - 0.3
			a.pos.x = pl.x + clampf(dx, -lim, lim)
			a.pos.z = pl.z + clampf(dz, -lim, lim)
			a.subject.root.position.x = a.pos.x
			a.subject.root.position.z = a.pos.z

	# Grab / throw (A).
	if playing:
		for seat in alive_seats():
			if seat.actor.falling or not seat.ctrl.a_pressed:
				continue
			var held = carried(seat)
			if held != null:
				_throw(seat, held)
			else:
				_pick_up(seat)

	_update_junk(dt)
	if not playing:
		# Round over: let the presses wind back up, no more verdicts.
		_over_t += dt
		siren.light_energy = 0.0
		for pl in plats:
			if _over_t > 0.8:
				pl.y = minf(PISTON_REST, pl.y + 6 * dt)
			pl.piston.position = Vector3(pl.x, pl.y, pl.z)
		return
	_update_slam(dt)

	if slam.phase != "down" and slam.phase != "hold":
		drop_t -= dt
		if drop_t <= 0:
			drop_t = DROP_EVERY * Rng.rand(0.75, 1.25)
			_drop_junk()

	# HUD
	var S := slam
	hud.set_timer(maxf(0.0, S.next - time) if (S.phase == "idle" or S.phase == "warn") else 0.0)
	var counts := []
	for i in plats.size():
		counts.append(count(i) if plats[i].seat.alive else -1)
	var mx := -1
	for c in counts:
		mx = maxi(mx, c)
	for seat in seats:
		if not seat.alive:
			hud.set_stat(seat, "PRESSED")
			hud.set_status(seat, "")
			continue
		var c: int = counts[seat.plat]
		hud.set_stat(seat, "JUNK %d" % c)
		hud.set_status(seat, "BIGGEST PILE" if c > 0 and c == mx else "")
	# Wait for anyone mid-fall to actually hit the bottom before judging.
	if not alive_seats().any(func(s): return s.actor.falling):
		check_last_standing()


## Finish off a subject who fell into the pit, crediting the thrower.
func _fall_kill(seat: Dictionary) -> void:
	var a: ArenaActor = seat.actor
	var by = a.data.get("hit_by")
	if by != null and not is_same(by, seat) and time - float(a.data.get("hit_at", -9.0)) < 3:
		award(by, "specialDelivery")
		hud.feed("%s made a special delivery" % by.player.name(), by.player.color)
	var k := Vector3(a.knock.x, 0, a.knock.z)
	kill(seat, "fall", {"dir": a.knock if k.length_squared() > 0.01 else Vector3(0, 0, 1)})


## Simultaneous deaths (same slam) share a tier.
func placement() -> Array:
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
	var pl: Dictionary = plats[seat.plat]
	var want_a := false
	if a.falling:
		a.ctrl.set_move(0, 0)
		a.ctrl.set_buttons(false, false)
		return

	# Dodge incoming thrown junk (skill-dependent).
	var dodge = null
	for j in junk:
		if j.state != "flying" or j.power < 6 or is_same(j.thrower, seat):
			continue
		var t_land: float = (j.vel.y + sqrt(maxf(0.0, j.vel.y * j.vel.y + 2 * GRAVITY * maxf(0.0, j.pos.y - 1)))) / GRAVITY
		var lx: float = j.pos.x + j.vel.x * t_land
		var lz: float = j.pos.z + j.vel.z * t_land
		if U.hypot(lx - a.pos.x, lz - a.pos.z) < 1.1:
			dodge = {"x": a.pos.x - lx, "z": a.pos.z - lz, "vx": j.vel.x, "vz": j.vel.z}
			break
	if dodge != null and (mem.get("dodging", false) or Rng.random() < brain.difficulty * 0.25):
		mem["dodging"] = true
		# Sidestep perpendicular to the incoming path, toward the platform centre.
		var px: float = -dodge.vz
		var pz: float = dodge.vx
		var to_c: float = (pl.x - a.pos.x) * px + (pl.z - a.pos.z) * pz
		if to_c < 0:
			px = -px
			pz = -pz
		a.ctrl.set_move(px, pz)
		a.ctrl.set_buttons(false, false)
		mem["a_prev"] = false
		return
	mem["dodging"] = false

	var held = carried(seat)
	if held != null:
		var tgt = mem.get("target")
		if tgt == null or not tgt.alive:
			# Only rivals a throw can actually reach (standing at our front edge).
			var reach := throw_range() + (PH - 0.35) + (PH - 0.4)
			var rivals := alive_seats().filter(func(s): return not is_same(s, seat) and U.hypot(plats[s.plat].x - pl.x, plats[s.plat].z - pl.z) <= reach)
			mem["target"] = Rng.pick(rivals) if not rivals.is_empty() else null
			mem["hold_t"] = 0.0
			mem["aim"] = Rng.rand(-1, 1) * (0.06 + brain.error * 0.5)
		mem["hold_t"] = float(mem.get("hold_t", 0.0)) + dt
		var target = mem.target
		if target != null:
			var T: Dictionary = plats[target.plat]
			# Aim at the rival — slightly toward where they stand, not just their platform.
			var tx: float = (T.x + target.actor.pos.x) / 2
			var tz: float = (T.z + target.actor.pos.z) / 2
			var dist := U.hypot(tx - pl.x, tz - pl.z)
			if dist == 0.0:
				dist = 1.0
			var dir_x: float = (tx - pl.x) / dist
			var dir_z: float = (tz - pl.z) / dist
			var off := clampf(dist - throw_range(), -(PH - 0.35), PH - 0.35)
			var sx: float = pl.x + dir_x * off
			var sz: float = pl.z + dir_z * off
			var d := AI.steer_to(a, sx, sz, {"arrive": 0.15, "slow": 0.6})
			var urgent: bool = slam.phase == "warn" or mem.hold_t > 2.6
			if d < 0.3 or urgent:
				var aim: float = atan2(dir_x, dir_z) + mem.aim
				a.ctrl.set_move(sin(aim) * 0.3, cos(aim) * 0.3)
				if absf(U.angle_diff(a.facing, aim)) < 0.12 and mem.hold_t > 0.35 + brain.reaction:
					want_a = true
		else:
			# Nobody in range: dump it into the pit in front of the platform.
			a.ctrl.set_move(0, 0.3)
			want_a = mem.hold_t > 0.5 and absf(U.angle_diff(a.facing, 0)) < 0.2
	else:
		mem["target"] = null
		var best = null
		var bd := INF
		for j in junk:
			if j.state != "rest" or j.plat != seat.plat:
				continue
			var d := U.hypot(j.pos.x - a.pos.x, j.pos.z - a.pos.z)
			if d < bd:
				bd = d
				best = j
		if best != null:
			AI.steer_to(a, best.pos.x, best.pos.z, {"arrive": 0.5, "slow": 0.6})
			if bd < 0.95:
				want_a = true
		else:
			if mem.get("idle") == null:
				var ix := Rng.rand(-0.6, 0.6)
				var iz := Rng.rand(-0.6, 0.6)
				mem["idle"] = {"x": ix, "z": iz}
			AI.steer_to(a, pl.x + mem.idle.x, pl.z + mem.idle.z, {"arrive": 0.3})
	var a_prev: bool = mem.get("a_prev", false)
	a.ctrl.set_buttons(want_a and not a_prev, false)
	mem["a_prev"] = want_a and not a_prev


func dispose() -> void:
	# break reference cycles (seat <-> actor, bot memories pointing at rival seats, junk holders)
	for j in junk:
		j.holder = null
		j.thrower = null
	for pl in plats:
		pl.seat = null
	for seat in seats:
		seat.actor = null
		seat.brain.memory.clear()
	super.dispose()

extends Minigame
## DROP ZONE — a loading bay under an overhead crane. Collect golden rations
## while the crane keeps dropping freight.
##
## Rules
##  - 60 s shift in a walled loading bay.
##  - The crane lowers crates in from above. A red shadow circle marks each
##    impact point and grows for ~1.2 s (the ring shows its final size), then
##    the load drops. Anyone inside the circle at impact is crushed ("crush").
##    Subjects just outside the circle are knocked back by the impact.
##  - Some drops are heavy pallets (2x2 crates) with a much wider shadow.
##  - The drop rate rises over the shift (and later loads arrive in pairs).
##  - Landed loads sit on the floor as obstacles for a few seconds, then the
##    crane hauls them away. All loads come from a fixed pool (bounded count).
##  - Golden ration tins lie on the floor (seats + 1 at a time). Walking over
##    one = +1 point; it reappears elsewhere. A load landing on a tin destroys it.
##  - B shoves. Shoving a rival under a falling load is encouraged.
##  - Ranking: survivors above the crushed; within each group by points
##    (ties among the dead: whoever died later ranks higher).
##  - The shift ends at 60 s, or as soon as at most one subject is alive.
##
## Loads, hook rigs, ration tin and gantry: blender/props/dropzone.py.

const META := {
	"id": "dropzone",
	"title": "DROP ZONE",
	"tagline": "Heavy loads. Light compensation.",
	"category": "Competitive",
	"controls": [{"input": "move", "label": "Move"}, {"input": "b", "label": "Shove"}],
	"objective": "Collect the most golden rations without getting flattened.",
	"rules": [
		"The crane drops freight all shift. A red shadow marks every impact.",
		"Stand in a shadow when the load lands and you are flattened.",
		"Walk over golden rations for points. Survivors outrank the flattened.",
		"Drops speed up and heavy pallets hit wider. {B} shoves.",
	],
}

const HALF_W := 8.0          # inner bay half-extents
const HALF_D := 5.5
const ROUND_TIME := 60.0
const FALL := 0.3            # free-fall time at the end of a warning
const HANG_TOP := 10.0       # height a load enters / leaves at
const HANG_LOW := 4.6        # height a load is released from
const CLEAR_TIME := 0.7      # crane haul-away duration
const KILL_PAD := 0.12       # centre within shadow radius + pad = crushed
const PICKUP_R := 0.7
const KINDS := {
	"crate": {"r": 0.95, "col": 0.72, "warn": 1.2, "stay": 2.4, "top": 1.3, "pool": 14},
	"pallet": {"r": 1.75, "col": 1.42, "warn": 1.35, "stay": 3.0, "top": 1.32, "pool": 4},
}

var arena: Arena
var beacon_mat: StandardMaterial3D
var beacon: OmniLight3D
var tok_ring_mat: StandardMaterial3D
var drops := []
var drop_serial := 0
var tokens := []
var drop_t := 1.0
var quota_stage := 0
var pallet_warned := false
var _prompt_off := -1.0      # game time the intro prompt is hidden (JS setTimeout 5000)


## Distance from point (cx, cz) to the segment p→q (pure helper).
static func _seg_dist(px: float, pz: float, qx: float, qz: float, cx: float, cz: float) -> float:
	var vx := qx - px
	var vz := qz - pz
	var len2 := vx * vx + vz * vz
	var t := ((cx - px) * vx + (cz - pz) * vz) / len2 if len2 > 1e-6 else 0.0
	t = clampf(t, 0.0, 1.0)
	return U.hypot(px + vx * t - cx, pz + vz * t - cz)


func build() -> void:
	make_scene({"fog_near": 18.0, "fog_far": 52.0})
	make_camera([0, 15.5, 11.5], [0, 0, 0.6], 48)

	# --- the bay
	Env.floor_plane(scene, 46, 34, {"tex": "concrete", "tile": 3.0})
	Env.floor_plane(scene, HALF_W * 2, HALF_D * 2, {"tex": "plate", "tile": 2.0, "y": 0.005})
	Env.stencil(scene, "DROP ZONE", 0, 0.02, 0.4, {"w": 8.0, "h": 2.6, "opacity": 0.16}).rotation.x = -PI / 2
	Env.hazard_strip(scene, 0, -HALF_D + 0.2, HALF_W * 2, 0.4, 0.012)
	Env.hazard_strip(scene, 0, HALF_D - 0.2, HALF_W * 2, 0.4, 0.012)
	Env.hazard_strip(scene, -HALF_W + 0.2, 0, 0.4, HALF_D * 2 - 0.8, 0.012)
	Env.hazard_strip(scene, HALF_W - 0.2, 0, 0.4, HALF_D * 2 - 0.8, 0.012)

	var wall_mat := Mats.mat(0xffffff, Tex.plate(Vector2(6, 1)))
	Env.block(scene, 0, 0.45, -HALF_D - 0.3, HALF_W * 2 + 1.2, 0.9, 0.6, wall_mat)
	Env.block(scene, 0, 0.45, HALF_D + 0.3, HALF_W * 2 + 1.2, 0.9, 0.6, wall_mat)
	Env.block(scene, -HALF_W - 0.3, 0.45, 0, 0.6, 0.9, HALF_D * 2, wall_mat)
	Env.block(scene, HALF_W + 0.3, 0.45, 0, 0.6, 0.9, HALF_D * 2, wall_mat)

	scene.add_child(Env.mesh(Geo.plane(46, 12), Mats.mat(0xffffff, Tex.wall(Vector2(11, 3))), 0, 6, -8, {"cast": false}))
	Env.stencil(scene, "OVERHEAD LOADS", -4.5, 1.9, -7.95, {"w": 7.0, "h": 2.0, "opacity": 0.55})
	Env.stencil(scene, "QUOTA IS LAW", 5.5, 1.9, -7.95, {"w": 6.0, "h": 1.8, "opacity": 0.4})
	Env.pipe(scene, [-23, 3.4, -7.8], [23, 3.4, -7.8], 0.2)
	Env.pipe(scene, [-23, 2.9, -7.85], [23, 2.9, -7.85], 0.1, 0x5a3022)

	# Gantry: two rails on columns flanking the bay (Blender model).
	scene.add_child(Props.make("dropzone", "gantry"))
	# Waiting freight outside the bay.
	Env.crate(scene, -10.6, 0, -4.6, 1.2, 0.2)
	Env.crate(scene, -10.4, 1.2, -4.7, 1.0, 0.7)
	Env.crate(scene, -10.8, 0, -3.1, 1.1, -0.3)
	Env.crate(scene, 10.6, 0, -4.2, 1.3, 0.1)
	Env.crate(scene, 10.9, 0, 2.8, 1.0, 0.5)

	Env.hanging_lamp(scene, -4, 7, 0.5, {"intensity": 90.0, "angle": 0.9})
	Env.hanging_lamp(scene, 4, 7, 0.5, {"intensity": 90.0, "angle": 0.9})
	# Rotating warning beacon (cosmetic, no shadows).
	beacon_mat = Mats.glow(0x5a0d06)
	scene.add_child(Env.mesh(Geo.sphere(0.22, 8, 6), beacon_mat, 0, 4.4, -7.7, {"cast": false}))
	beacon = Env.point_light(0xff3a14, 0.0, 12.0, 1.6)
	beacon.position = Vector3(0, 4.2, -7.3)
	scene.add_child(beacon)

	# --- arena + avatars
	arena = Arena.new({"bounds": {"min_x": -HALF_W, "max_x": HALF_W, "min_z": -HALF_D, "max_z": HALF_D}, "shove_force": 12.0})
	var n := seats.size()
	var spots: Array
	if n <= 2:
		spots = [[-3.0, 0.5], [3.0, 0.5]]
	elif n == 3:
		spots = [[-3.5, -1.0], [3.5, -1.0], [0.0, 2.5]]
	else:
		spots = [[-3.0, -1.5], [3.0, -1.5], [-3.0, 2.5], [3.0, 2.5]]
	for i in n:
		var seat: Dictionary = seats[i]
		var x: float = spots[i % spots.size()][0]
		var z: float = spots[i % spots.size()][1]
		seat["idx"] = i
		seat.score = 0
		spawn_subject(seat, {"x": x, "z": z})
		seat.actor = arena.add(ArenaActor.new({"player": seat.player, "ctrl": seat.ctrl, "subject": seat.subject, "x": x, "z": z}))
		seat.actor.seat = seat
	arena.on_shove = func(a: ArenaActor, b: ArenaActor):
		b.data["last_shover"] = a.seat
		b.data["shoved_at"] = time

	# --- shared materials, then the fixed pools
	tok_ring_mat = Mats.glow(0xffc23a, {"opacity": 0.55, "depth_write": false})
	var slot := 0
	for kind in ["crate", "pallet"]:
		for i in int(KINDS[kind].pool):
			drops.append(_make_drop(kind, slot))
			slot += 1
	drop_serial = 0

	var token_count := mini(5, n + 1)
	for i in token_count:
		tokens.append(_make_token())
	for tk in tokens:
		_place_token(tk)
		tk.pop = 1.0
		tk.g.scale = Vector3.ONE

	drop_t = 1.0          # first drop shortly after GO
	quota_stage = 0
	pallet_warned = false


## One pooled load: body + crane rig (hook and cable) + red shadow disc and ring.
func _make_drop(kind: String, slot: int) -> Dictionary:
	var K: Dictionary = KINDS[kind]
	var g := Props.make("dropzone", "load_" + kind)
	var rig := g.find_child("rig_" + kind, true, false) as Node3D
	var cable := g.find_child("cable_" + kind, true, false) as GeometryInstance3D
	if cable:
		cable.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	g.visible = false
	scene.add_child(g)

	var disc_mat := Mats.glow(0xff2a14, {"opacity": 0.0, "depth_write": false})
	var ring_mat := Mats.glow(0xff3a20, {"opacity": 0.0, "depth_write": false})
	var y := 0.03 + slot * 0.0015
	var disc := Env.mesh(Geo.circle(1, 28), disc_mat, 0, y, 0, {"cast": false})
	disc.rotation.x = -PI / 2
	disc.visible = false
	var ring := Env.mesh(Geo.ring(0.9, 1, 36), ring_mat, 0, y + 0.0007, 0, {"cast": false})
	ring.rotation.x = -PI / 2
	ring.visible = false
	scene.add_child(disc)
	scene.add_child(ring)
	return {"kind": kind, "K": K, "g": g, "rig": rig, "disc": disc, "ring": ring, "disc_mat": disc_mat, "ring_mat": ring_mat,
		"state": "free", "t": 0.0, "x": 0.0, "z": 0.0, "col": null, "notice": [], "id": 0}


## One pooled golden ration tin with a floor ring.
func _make_token() -> Dictionary:
	var g := Node3D.new()
	var tin := Props.make("dropzone", "tin")
	tin.rotation_order = EULER_ORDER_XYZ
	tin.position.y = 0.45
	tin.rotation.z = 0.25
	var ring := Env.mesh(Geo.ring(0.36, 0.48, 20), tok_ring_mat, 0, 0.025, 0, {"cast": false})
	ring.rotation.x = -PI / 2
	g.add_child(tin)
	g.add_child(ring)
	g.visible = false
	scene.add_child(g)
	return {"g": g, "tin": tin, "x": 0.0, "z": 0.0, "active": false, "respawn": 0.0, "pop": 0.0, "phase": tokens.size() * 1.7}


func start() -> void:
	hud.banner("COLLECT THE RATIONS", 1400)
	hud.prompt("Grab golden rations · dodge red shadows · {B} shoves")
	_prompt_off = 5.0
	_update_hud()


func preview(dt: float) -> void:
	for s in seats:
		s.subject.animate(dt, 0)
	_animate_tokens(dt)
	_animate_beacon()


# ------------------------------------------------------------------ drops

func _free_drop(kind: String):
	for d in drops:
		if d.state == "free" and d.kind == kind:
			return d
	return null


## Choose an impact point: on a subject, on a ration, or anywhere. Avoids other loads.
func _pick_spot(r: float):
	var lx := HALF_W - r * 0.75
	var lz := HALF_D - r * 0.75
	for tries in 10:
		var m := Rng.random()
		var x: float
		var z: float
		var alive := alive_seats()
		var live := tokens.filter(func(t): return t.active)
		if m < 0.45 and not alive.is_empty():
			var a: ArenaActor = Rng.pick(alive).actor
			var lead := Rng.rand(0, 0.45)
			x = a.pos.x + a.vel.x * lead + Rng.rand(-1, 1) * r * 0.7
			z = a.pos.z + a.vel.z * lead + Rng.rand(-1, 1) * r * 0.7
		elif m < 0.72 and not live.is_empty():
			var t: Dictionary = Rng.pick(live)
			x = t.x + Rng.rand(-0.7, 0.7)
			z = t.z + Rng.rand(-0.7, 0.7)
		else:
			x = Rng.rand(-lx, lx)
			z = Rng.rand(-lz, lz)
		x = clampf(x, -lx, lx)
		z = clampf(z, -lz, lz)
		var ok := true
		for d in drops:
			if d.state == "free":
				continue
			if U.hypot(d.x - x, d.z - z) < d.K.r + r - 0.25:
				ok = false
				break
		if ok:
			return {"x": x, "z": z}
	return null


func _spawn_drop(kind: String) -> bool:
	var d = _free_drop(kind)
	if d == null and kind == "pallet":
		kind = "crate"
		d = _free_drop(kind)
	if d == null:
		return false
	var spot = _pick_spot(d.K.r)
	if spot == null:
		return false
	d.state = "warn"
	d.t = 0.0
	d.x = spot.x
	d.z = spot.z
	drop_serial += 1
	d.id = drop_serial
	var g: Node3D = d.g
	g.position = Vector3(d.x, HANG_TOP, d.z)
	g.rotation.y = Rng.rand(0, PI / 2)
	g.visible = true
	d.rig.visible = true
	d.disc.position.x = d.x
	d.ring.position.x = d.x
	d.disc.position.z = d.z
	d.ring.position.z = d.z
	d.disc.scale = Vector3.ONE * 0.01
	d.ring.scale = Vector3.ONE * float(d.K.r)
	Mats.set_opacity(d.disc_mat, 0.0)
	Mats.set_opacity(d.ring_mat, 0.0)
	d.disc.visible = true
	d.ring.visible = true
	# Per-seat moment a bot "notices" this shadow (humans: immediately).
	var notice := []
	for s in seats:
		if s.is_bot:
			var b: Dictionary = s.brain
			notice.append(b.reaction + (1.0 - b.difficulty) * 0.2 + (0.35 if Rng.random() < b.error * 0.5 else 0.0))
		else:
			notice.append(0.0)
	d.notice = notice
	if kind == "pallet" and not pallet_warned:
		pallet_warned = true
		hud.banner("HEAVY LOADS INBOUND", 1300, "danger")
	Sfx.play("tick", {"vol": 0.5})
	return true


## Spawn schedule: interval shrinks 1.5 s → 0.5 s; pallets and pairs later on.
func _schedule(dt: float) -> void:
	drop_t -= dt
	if drop_t > 0:
		return
	var p := clampf(time / ROUND_TIME, 0.0, 1.0)
	drop_t += 1.5 - p * 1.0
	var pallet_chance := 0.0 if time < 8 else 0.1 + 0.2 * p
	_spawn_drop("pallet" if Rng.random() < pallet_chance else "crate")
	if time > 15 and Rng.random() < 0.15 + 0.35 * p:
		_spawn_drop("crate")


func _update_drops(dt: float, live: bool) -> void:
	for d in drops:
		if d.state == "free":
			continue
		d.t += dt
		var K: Dictionary = d.K
		var g: Node3D = d.g
		if d.state == "warn":
			var hang: float = K.warn - FALL
			var k: float = minf(1.0, d.t / K.warn)
			if d.t < hang:
				var e: float = d.t / hang
				g.position.y = HANG_TOP + (HANG_LOW - HANG_TOP) * (1.0 - (1.0 - e) * (1.0 - e))
			else:
				d.rig.visible = false   # released
				var f: float = minf(1.0, (d.t - hang) / FALL)
				g.position.y = HANG_LOW * (1.0 - f * f)
			d.disc.scale = Vector3.ONE * (K.r * (0.2 + 0.8 * k))
			Mats.set_opacity(d.disc_mat, 0.18 + 0.42 * k)
			Mats.set_opacity(d.ring_mat, 0.45 + 0.45 * absf(sin(d.t * (6.0 + 10.0 * k))))
			if d.t >= K.warn:
				_impact(d, live)
		elif d.state == "landed":
			if d.t >= K.stay:
				d.state = "clear"
				d.t = 0.0
				if d.col != null:
					var c: Dictionary = d.col
					arena.circles = arena.circles.filter(func(o): return not is_same(o, c))
					d.col = null
				d.rig.visible = true
		elif d.state == "clear":
			var c2: float = minf(1.0, d.t / CLEAR_TIME)
			g.position.y = c2 * c2 * HANG_TOP
			if c2 >= 1.0:
				d.state = "free"
				g.visible = false
				d.rig.visible = true


## Load hits the floor: crush whoever is under it, knock back the near misses.
func _impact(d: Dictionary, live: bool) -> void:
	var K: Dictionary = d.K
	var heavy: bool = d.kind == "pallet"
	d.state = "landed"
	d.t = 0.0
	d.g.position.y = 0.0
	d.disc.visible = false
	d.ring.visible = false
	d.col = arena.add_circle(d.x, d.z, K.col)
	Sfx.play("thud", {"vol": 1.0 if heavy else 0.8})
	Sfx.play("crunch" if heavy else "clank", {"vol": 0.6 if heavy else 0.45})
	engine.shake(0.35 if heavy else 0.12)
	var puffs := 5 if heavy else 3
	for i in puffs:
		var ang: float = float(i) / puffs * TAU + d.id
		fx.smoke(Vector3(d.x + cos(ang) * K.r * 0.8, 0.2, d.z + sin(ang) * K.r * 0.8),
			{"color": 0x7d7566, "size": 0.6 if heavy else 0.4, "rise": 0.6, "life": 0.9, "opacity": 0.45})
	# Rations under the load are lost.
	for tk in tokens:
		if tk.active and U.hypot(tk.x - d.x, tk.z - d.z) < K.r:
			_despawn_token(tk, 0.6)
	if not live:
		return
	for seat in seats:
		if not seat.alive:
			continue
		var a: ArenaActor = seat.actor
		var dx: float = a.pos.x - d.x
		var dz: float = a.pos.z - d.z
		var dist := U.hypot(dx, dz)
		if dist < K.r + KILL_PAD:
			_credit(seat)
			kill(seat, "crush")
			continue
		if dist < K.r + 1.0 and dist > 1e-4:
			var w: float = 1.0 - (dist - K.r) / 1.0
			a.knock.x += (dx / dist) * 6.0 * w
			a.knock.z += (dz / dist) * 6.0 * w
			if w > 0.5:
				a.stun = maxf(a.stun, 0.2)


## Feed line if a rival shoved the victim in the last moments.
func _credit(seat: Dictionary) -> void:
	var data: Dictionary = seat.actor.data
	var by = data.get("last_shover")
	if by != null and not is_same(by, seat) and time - float(data.get("shoved_at", -99.0)) < 1.6:
		hud.feed("%s shoved %s under the load" % [by.player.name(), seat.player.name()], by.player.color)


# ----------------------------------------------------------------- tokens

func _place_token(tk: Dictionary) -> void:
	var x := 0.0
	var z := 0.0
	for i in 14:
		x = Rng.rand(-HALF_W + 1, HALF_W - 1)
		z = Rng.rand(-HALF_D + 1, HALF_D - 1)
		var ok := true
		for s in seats:
			if s.alive and s.actor and U.hypot(s.actor.pos.x - x, s.actor.pos.z - z) < 2.2:
				ok = false
				break
		if ok:
			for d in drops:
				if (d.state == "landed" or d.state == "warn") and U.hypot(d.x - x, d.z - z) < d.K.r + 0.5:
					ok = false
					break
		if ok:
			for o in tokens:
				if not is_same(o, tk) and o.active and U.hypot(o.x - x, o.z - z) < 2.5:
					ok = false
					break
		if ok:
			break
	tk.x = x
	tk.z = z
	tk.active = true
	tk.pop = 0.0
	tk.g.position = Vector3(x, 0, z)
	tk.g.scale = Vector3.ONE * 0.01
	tk.g.visible = true


func _despawn_token(tk: Dictionary, delay: float) -> void:
	tk.active = false
	tk.g.visible = false
	tk.respawn = delay


func _animate_tokens(dt: float) -> void:
	for tk in tokens:
		if not tk.active:
			continue
		tk.pop = minf(1.0, tk.pop + dt * 4)
		tk.g.scale = Vector3.ONE * maxf(0.01, tk.pop)
		var tin: Node3D = tk.tin
		tin.rotation.y += dt * 2.5
		tin.position.y = 0.45 + sin(clock * 3 + tk.phase) * 0.08


func _update_tokens(dt: float) -> void:
	for tk in tokens:
		if not tk.active:
			tk.respawn -= dt
			if tk.respawn <= 0:
				_place_token(tk)
			continue
		for seat in seats:
			if not seat.alive:
				continue
			var a: ArenaActor = seat.actor
			if U.hypot(a.pos.x - tk.x, a.pos.z - tk.z) < PICKUP_R:
				seat.score += 1
				_despawn_token(tk, 0.8)
				Sfx.play("ding", {"vol": 0.5})
				fx.sparks(Vector3(tk.x, 0.5, tk.z), {"color": 0xffd040, "count": 8, "speed": 4.0})
				break


func _animate_beacon() -> void:
	var s := sin(clock * 7)
	beacon.light_energy = maxf(0.0, s) * 9.0 * Env.LIGHT_K
	Mats.set_color(beacon_mat, 0xff3a14 if s > 0 else 0x5a0d06)


# ----------------------------------------------------------------- update

func update(dt: float) -> void:
	var playing := state == "play"
	arena.step(dt, playing)
	_animate_beacon()
	_animate_tokens(dt)
	if playing:
		_schedule(dt)
	_update_drops(dt, playing)
	if not playing:
		return
	_update_tokens(dt)

	if _prompt_off >= 0.0 and time >= _prompt_off:
		_prompt_off = -1.0
		hud.prompt("")
	if quota_stage == 0 and time >= 20:
		quota_stage = 1
		hud.banner("QUOTA RAISED", 1200, "danger")
	if quota_stage == 1 and time >= 40:
		quota_stage = 2
		hud.banner("QUOTA RAISED", 1200, "danger")

	_update_hud()
	hud.set_timer(maxf(0.0, ROUND_TIME - time))

	var alive := alive_seats().size()
	if alive == 0:
		hud.banner("NO SURVIVORS", 2000, "danger")
		end(2.6)
		return
	if time >= ROUND_TIME or (seats.size() > 1 and alive <= 1):
		Sfx.play("horn")
		hud.banner("SHIFT OVER", 2000)
		end(2.6)


func _update_hud() -> void:
	var top := 0
	for s in seats:
		top = maxi(top, int(s.score))
	for seat in seats:
		if seat.alive:
			hud.set_stat(seat, "PTS %d" % seat.score)
			hud.set_status(seat, "TOP EARNER" if top > 0 and int(seat.score) == top else "")
		else:
			hud.set_stat(seat, "FLATTENED · PTS %d" % seat.score)
			hud.set_status(seat, "")


## Survivors first (by points), then the crushed (by points, later death higher).
func placement() -> Array:
	var alive := seats.filter(func(s): return s.alive)
	alive.sort_custom(func(a, b): return a.score > b.score)
	var dead := seats.filter(func(s): return not s.alive)
	dead.sort_custom(func(a, b):
		if a.score != b.score:
			return a.score > b.score
		return a.death_time > b.death_time)
	var tiers := Minigame.group_by(alive, func(s): return s.score)
	tiers.append_array(Minigame.group_by(dead, func(s): return "%d|%.3f" % [s.score, s.death_time]))
	return tiers


# ------------------------------------------------------------------- bots

func _noticed(d: Dictionary, i: int) -> bool:
	return d.state == "warn" and d.t >= d.notice[i]


func bot_think(seat: Dictionary, _dt: float) -> void:
	var a: ArenaActor = seat.actor
	var brain: Dictionary = seat.brain
	var mem: Dictionary = brain.memory
	var i: int = seat.idx
	var diff: float = brain.difficulty
	var spd: float = a.speed
	var look := diff >= 0.5   # look-ahead path planning around shadows

	# 1. Pick a ration: nearest, penalised if a shadow will land on it first or a rival is closer.
	var tgt = null
	var best := INF
	for tk in tokens:
		if not tk.active:
			continue
		var dist := U.hypot(tk.x - a.pos.x, tk.z - a.pos.z)
		var cost := dist
		if look:
			for d in drops:
				if not _noticed(d, i):
					continue
				var tti: float = d.K.warn - d.t
				if U.hypot(tk.x - d.x, tk.z - d.z) < d.K.r + 0.4 and dist / spd < tti + 0.3:
					cost += 5
			for o in seats:
				if is_same(o, seat) or not o.alive:
					continue
				if U.hypot(tk.x - o.actor.pos.x, tk.z - o.actor.pos.z) < dist - 1.5:
					cost += 1.5 * diff
					break
		if cost < best:
			best = cost
			tgt = tk
	var mx := 0.0
	var mz := 0.0
	if true:
		var gx: float = tgt.x if tgt != null else 0.0
		var gz: float = tgt.z if tgt != null else 0.0
		var dx := gx - a.pos.x
		var dz := gz - a.pos.z
		var dd := U.hypot(dx, dz)
		if dd > 0.15:
			var s := minf(1.0, dd / 0.6)
			mx = (dx / dd) * s
			mz = (dz / dd) * s

	# 2. Shadows: get out if inside; with look-ahead, route around ones on the way.
	var fx_ := 0.0
	var fz := 0.0
	var inside := false
	for d in drops:
		if not _noticed(d, i):
			continue
		var tti: float = d.K.warn - d.t
		var dx: float = a.pos.x - d.x
		var dz: float = a.pos.z - d.z
		var dist := U.hypot(dx, dz)
		var safe: float = d.K.r + KILL_PAD + a.radius * 0.6 + 0.15 * diff
		if dist < safe:
			inside = true
			var ux: float
			var uz: float
			if dist > 0.05:
				ux = dx / dist
				uz = dz / dist
			else:
				ux = 1.0 if i % 2 else -1.0
				uz = 0.0
			var w := 2.0 + (safe - dist) * 2.0
			fx_ += ux * w
			fz += uz * w
		elif look:
			var reach := spd * minf(tti, 0.9)
			var ml := U.hypot(mx, mz)
			if dist < safe + reach and ml > 0.1:
				var ex := a.pos.x + (mx / ml) * reach
				var ez := a.pos.z + (mz / ml) * reach
				if _seg_dist(a.pos.x, a.pos.z, ex, ez, d.x, d.z) < safe:
					var tx := -dz / dist
					var tz := dx / dist
					if tx * mx + tz * mz < 0:
						tx = -tx
						tz = -tz
					fx_ += tx * 1.6 + (dx / dist) * 0.6
					fz += tz * 1.6 + (dz / dist) * 0.6
					mx *= 0.3
					mz *= 0.3

	# 3. Landed loads: slide around them instead of pushing into them.
	for d in drops:
		if d.col == null:
			continue
		var dx: float = a.pos.x - d.x
		var dz: float = a.pos.z - d.z
		var dist := U.hypot(dx, dz)
		if dist == 0.0:
			dist = 0.01
		var edge: float = dist - d.K.col - a.radius
		var ml := U.hypot(mx, mz)
		if edge < 0.9 and ml > 0.1 and (-dx * mx - dz * mz) / (dist * ml) > 0.2:
			var tx := -dz / dist
			var tz := dx / dist
			if tx * mx + tz * mz < 0:
				tx = -tx
				tz = -tz
			var w := (0.9 - edge) * 1.3
			fx_ += tx * w
			fz += tz * w

	var vx: float
	var vz: float
	if inside:
		vx = fx_ + mx * 0.15
		vz = fz + mz * 0.15
		# Escaping into a wall: slide along it instead.
		var m := 0.75
		if (a.pos.x > HALF_W - m and vx > 0) or (a.pos.x < -HALF_W + m and vx < 0):
			var s1 := absf(vx)
			vx = 0.0
			vz += (1.0 if vz >= 0 else -1.0) * s1
		if (a.pos.z > HALF_D - m and vz > 0) or (a.pos.z < -HALF_D + m and vz < 0):
			var s2 := absf(vz)
			vz = 0.0
			vx += (1.0 if vx >= 0 else -1.0) * s2
	else:
		vx = mx + fx_
		vz = mz + fz

	# 4. Shoves: feed a rival to a load about to land (skilled bots), or jostle over a ration.
	var want_b := false
	if not inside:
		for o in seats:
			if is_same(o, seat) or not o.alive:
				continue
			var t: ArenaActor = o.actor
			var dx := t.pos.x - a.pos.x
			var dz := t.pos.z - a.pos.z
			var dist := U.hypot(dx, dz)
			if dist > 1.45 or dist < 0.2:
				continue
			var ux := dx / dist
			var uz := dz / dist
			var lethal := false
			if diff >= 0.55:
				var lx := t.pos.x + ux * 1.8
				var lz := t.pos.z + uz * 1.8
				for d in drops:
					if not _noticed(d, i):
						continue
					var tti: float = d.K.warn - d.t
					if tti > 0.12 and tti < 0.6 and U.hypot(lx - d.x, lz - d.z) < d.K.r:
						lethal = true
						break
			var contest: bool = tgt != null and dist < 1.2 and U.hypot(tgt.x - t.pos.x, tgt.z - t.pos.z) < 2
			if (lethal and Rng.random() < 0.35 * diff) or (contest and Rng.random() < 0.012 * diff):
				vx = ux   # face the victim (the arena turns us toward the stick)
				vz = uz
				want_b = true
				break
	a.ctrl.set_move(vx, vz)
	# Buttons are edge-triggered: alternate so repeated intents become fresh presses.
	var press: bool = want_b and not mem.get("b_prev", false)
	a.ctrl.set_buttons(false, press)
	mem["b_prev"] = press


func dispose() -> void:
	for seat in seats:
		seat.actor = null   # break the seat <-> actor reference cycle
	super.dispose()

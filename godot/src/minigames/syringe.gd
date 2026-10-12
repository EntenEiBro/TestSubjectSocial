extends Minigame
## SYRINGE HUNT — a dim storage office, twelve containers, one loaded syringe.
##
## Rules:
##  - One random locker / cabinet / desk drawer secretly holds the syringe.
##    Stand at a container's front and HOLD A for 1.2 s to search it (a ring
##    fills above your head). Searched containers stay open.
##  - The finder becomes the INFECTED carrier, syringe visible in hand.
##    Infected subjects press A next to a clean subject to stab them: the
##    victim convulses, turns green and joins the hunt a little faster than
##    clean subjects (+5 %; the carrier +4 %).
##  - Clean subjects can B-shove infected ones to stun them for 2.6 s
##    (infected subjects cannot shove).
##  - The hunt lasts 60 s after the syringe is found (75 s total cap).
##  - Everyone infected → the original carrier wins, the rest rank by
##    infection order (later = better). Time out → survivors share first
##    place, the infected are purged (killed) and ranked carrier first, then
##    later-infected above earlier-infected.
## Locker / cabinet / desk (with door / drawer) and syringe models: blender/props/syringe.py.

const META := {
	"id": "syringe",
	"title": "SYRINGE HUNT",
	"tagline": "One dose. Plenty of volunteers.",
	"category": "Deception",
	"controls": [{"input": "move", "label": "Move"}, {"input": "a", "label": "Hold: search · Tap: stab"}, {"input": "b", "label": "Shove (stuns infected)"}],
	"objective": "Find the syringe and infect everyone — or stay clean until the clock runs out.",
	"rules": [
		"Hold {A} at a locker, cabinet or desk to search it. One of them hides the syringe.",
		"The finder is infected. Infected subjects are slightly faster and stab others with {A} to convert them.",
		"Clean subjects shove the infected to stun them. At time-out the infected are purged.",
	],
}

const HALF_W := 9.0
const MIN_Z := -6.1
const MAX_Z := 5.5
const SEARCH_TIME := 1.2
const SEARCH_REACH := 1.0
const HUNT_TIME := 40.0
const TOTAL_CAP := 70.0
const STAB_RANGE := 1.2
const STAB_CD := 1.6
const CONVULSE := 4.0            # fresh victims writhe before joining the hunt
# The infected are slightly faster than clean subjects; the longer daze and
# convulsion keep survival possible (bot tests: survivors in ~1 of 5 rounds).
const INFECTED_SPEED := 1.05     # stab victims who join the hunt
const CARRIER_SPEED := 1.04      # the original carrier
const PRIME_TIME := 2.5          # finder uncaps the needle (survivors' head start)
const STUN_TIME := 2.6           # a survivor's shove leaves a hunter dazed this long
const HINT_AFTER := 25.0         # the hiding place starts rattling if nobody found it
const GREEN := Color(0x5c / 255.0, 1.0, 0x4a / 255.0)   # 0x5cff4a
const RING_SEG := 24

## Container footprints in local space (front = +Z).
const KINDS := {
	"locker": {"w": 0.9, "h": 2.0, "d": 0.6, "color": 0x56645a},
	"cabinet": {"w": 1.0, "h": 1.2, "d": 0.6, "color": 0x7a7466},
	"desk": {"w": 1.5, "h": 0.85, "d": 0.8, "color": 0xffffff},
}

## [x, z, kind, rot_y] — rot_y 0 faces +Z (camera), π/2 faces +X, -π/2 faces -X.
const LAYOUT := [
	[-6.3, -5.65, "locker", 0.0], [-2.4, -5.65, "locker", 0.0], [2.4, -5.65, "locker", 0.0], [6.3, -5.65, "locker", 0.0],
	[-8.65, -2.2, "cabinet", PI / 2], [-8.65, 2.2, "cabinet", PI / 2],
	[8.65, -2.2, "cabinet", -PI / 2], [8.65, 2.2, "cabinet", -PI / 2],
	[-4.2, 0.2, "desk", 0.0], [4.2, 0.2, "desk", 0.0], [0.0, -2.6, "cabinet", 0.0], [0.0, 2.2, "desk", 0.0],
]


## A searchable container.
class Stash:
	var kind := ""
	var x := 0.0
	var z := 0.0
	var rot_y := 0.0
	var w := 0.0
	var d := 0.0
	var group: Node3D
	var searched := false
	var open := 0.0
	var has_syringe := false
	var door: Node3D = null
	var drawer: Node3D = null
	var front := Vector3.ZERO


static var _barrel_mat: StandardMaterial3D = null

var arena: Arena
var containers := []
var found := false
var found_at := 0.0
var end_at := TOTAL_CAP
var infect_order := []
var outcome := ""
var purge := []
var purge_t := 0.0
var hint_t := 0.0
var _prompt_on := false


## Low-poly syringe along +Z (needle forward), roughly 0.6 units long (Blender model).
static func _syringe_model() -> Node3D:
	var g := Props.make("syringe", "syringe_model")
	var barrel := g.find_child("syringe_barrel", true, false) as MeshInstance3D
	if barrel:
		if _barrel_mat == null:
			_barrel_mat = Mats.glow(0x6cff5a, {"transparent": true, "opacity": 0.85})
		barrel.set_surface_override_material(0, _barrel_mat)
		barrel.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return g


func build() -> void:
	make_scene({"fog_near": 18.0, "fog_far": 46.0, "ambient": 0x34363c})
	make_camera([0, 15, 11], [0, 0, -0.4], 50)

	# Room: north wall inner face sits at z = MIN_Z, open toward the camera.
	Env.room(scene, HALF_W * 2 + 0.6, 12.6, 4.5, {"floor_tex": "tiles", "tile": 1.5, "open": ["south"]}).position.z = MIN_Z + 6.15
	Env.stencil(scene, "HIDE", 0, 3.2, MIN_Z + 0.03, {"w": 4.6, "h": 1.7, "opacity": 0.6})
	Env.pipe(scene, [-HALF_W, 4.1, MIN_Z + 0.1], [HALF_W, 4.1, MIN_Z + 0.1], 0.12)
	Env.hazard_strip(scene, 0, MAX_Z - 0.15, HALF_W * 2, 0.3, 0.012)
	Env.crate(scene, -HALF_W + 0.6, 0, MAX_Z - 0.8, 0.8, 0.3)
	Env.crate(scene, HALF_W - 0.7, 0, -4.4, 0.9, -0.2)

	Env.hanging_lamp(scene, -4.8, 7, -0.5, {"intensity": 85.0, "angle": 1.0})
	Env.hanging_lamp(scene, 4.8, 7, -0.5, {"intensity": 85.0, "angle": 1.0})
	Env.hanging_lamp(scene, 0, 6.5, -4.6, {"intensity": 40.0, "angle": 0.9, "shadow": false, "target": Vector3.ZERO})

	arena = Arena.new({"bounds": {"min_x": -HALF_W, "max_x": HALF_W, "min_z": MIN_Z, "max_z": MAX_Z}, "shove_force": 11.0})
	arena.add_wall(-HALF_W + 0.2, -HALF_W + 1.0, MAX_Z - 1.2, MAX_Z - 0.4) # crate by the door
	arena.add_wall(HALF_W - 1.15, HALF_W - 0.25, -4.85, -3.95)

	containers = []
	for l in LAYOUT:
		containers.append(_build_container(l[0], l[1], l[2], l[3]))
	(Rng.pick(containers) as Stash).has_syringe = true

	# Avatars along the doorway, plus a per-seat search ring.
	var n := seats.size()
	for i in n:
		var seat: Dictionary = seats[i]
		var x := (i - (n - 1) / 2.0) * 2.4
		var z := 3.9
		spawn_subject(seat, {"x": x, "z": z, "facing": PI})
		seat.actor = arena.add(ArenaActor.new({"player": seat.player, "ctrl": seat.ctrl, "subject": seat.subject, "x": x, "z": z}))
		seat.actor.facing = PI
		seat.actor.seat = seat
		seat.merge({"infected": false, "carrier": false, "infected_at": 0.0, "convulse": 0.0, "prime": 0.0, "stab_cd": 0.0, "jabs": 0, "opened": 0,
			"search": {"c": null, "t": 0.0}, "syringe": null}, true)
		var ring := MeshInstance3D.new()
		ring.mesh = Geo.ring(0.2, 0.32, RING_SEG)
		var rm := Mats.glow(seat.player.color, {"transparent": true, "depth_write": false, "double_side": true})
		rm.no_depth_test = true
		rm.render_priority = 10
		ring.material_override = rm
		ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		ring.visible = false
		scene.add_child(ring)
		seat["search_ring"] = ring
	arena.on_shove = func(a: ArenaActor, b: ArenaActor):
		if b.seat != null and b.seat.infected and a.seat != null and not a.seat.infected:
			b.stun = STUN_TIME
			Sfx.play("thud")
			fx.sparks(Vector3(b.pos.x, 1.9, b.pos.z), {"count": 6, "speed": 2.0, "color": 0xffffff})

	found = false
	found_at = 0.0
	end_at = TOTAL_CAP
	infect_order = []
	outcome = ""
	purge = []
	purge_t = 0.0
	hint_t = 0.0


# ------------------------------------------------------------------ stage

## Build a searchable container (locker, filing cabinet or desk) and its collider.
func _build_container(x: float, z: float, kind: String, rot_y: float) -> Stash:
	var K: Dictionary = KINDS[kind]
	var g := Node3D.new()
	g.position = Vector3(x, 0, z)
	g.rotation.y = rot_y
	var c := Stash.new()
	c.kind = kind
	c.x = x
	c.z = z
	c.rot_y = rot_y
	c.w = K.w
	c.d = K.d
	c.group = g
	g.add_child(Props.make("syringe", kind))
	if kind == "desk":
		var drawer := Props.make("syringe", "desk_drawer")
		drawer.position = Vector3(0.4, K.h - 0.28, 0)
		g.add_child(drawer)
		c.drawer = drawer
	else:
		var pivot := Props.make("syringe", kind + "_door")
		pivot.position = Vector3(-K.w / 2 + 0.03, 0, K.d / 2)
		g.add_child(pivot)
		c.door = pivot
	scene.add_child(g)
	# Collider (footprint rotated by 0 or ±90°)
	var side := absf(sin(rot_y)) > 0.5
	var hw: float = (K.d if side else K.w) / 2
	var hd: float = (K.w if side else K.d) / 2
	arena.add_wall(x - hw, x + hw, z - hd, z + hd)
	var reach: float = K.d / 2 + 0.55
	c.front = Vector3(x + sin(rot_y) * reach, 0, z + cos(rot_y) * reach)
	return c


# -------------------------------------------------------------- mechanics

## Finish searching a container.
func _open_container(c: Stash, seat: Dictionary) -> void:
	c.searched = true
	seat.opened += 1
	Sfx.play("search")
	if not c.has_syringe:
		Sfx.play("clank", {"vol": 0.3})
		return
	found = true
	found_at = time
	end_at = minf(found_at + HUNT_TIME, TOTAL_CAP)
	_infect(seat, true)
	hud.banner("SOMEONE HAS THE SYRINGE", 2000, "danger")
	hud.feed("%s FOUND THE SYRINGE" % seat.player.name(), seat.player.color)
	Sfx.play("sting", {"vol": 0.7})
	for s in seats:
		s.actor.frozen = s.convulse > 0
		s.search.c = null
		s.search.t = 0.0
		s.search_ring.visible = false
	# The finder needs a moment to uncap the needle: everyone else gets a head start.
	seat.prime = PRIME_TIME
	seat.actor.frozen = true


## Mark a seat infected. Carriers get the syringe at once; stab victims after convulsing.
func _infect(seat: Dictionary, carrier: bool = false) -> void:
	seat.infected = true
	seat.carrier = carrier
	seat.infected_at = time
	infect_order.append(seat)
	# Green tint + faint glow on every body mesh.
	_tint_green(seat.subject.root, seat.subject.ring)
	if carrier:
		_arm_syringe(seat)
	else:
		seat.convulse = CONVULSE
		seat.actor.frozen = true


static func _tint_green(node: Node, skip: Node) -> void:
	if node is MeshInstance3D and node != skip:
		var mi: MeshInstance3D = node
		if mi.mesh:
			for i in mi.mesh.get_surface_count():
				var m := mi.get_active_material(i)
				if m is StandardMaterial3D:
					var c: StandardMaterial3D = m.duplicate()
					var a := c.albedo_color.a
					c.albedo_color = c.albedo_color.lerp(GREEN, 0.4)
					c.albedo_color.a = a
					if c.shading_mode != BaseMaterial3D.SHADING_MODE_UNSHADED:
						c.emission_enabled = true
						c.emission = U.col(0x0c2a0a)
					mi.set_surface_override_material(i, c)
	for ch in node.get_children():
		_tint_green(ch, skip)


## Put a syringe in the seat's right hand and switch it to hunter stats.
func _arm_syringe(seat: Dictionary) -> void:
	var holder := Node3D.new()
	holder.position = Vector3(0, -0.78, 0.05)
	holder.rotation.x = PI / 2
	var s := _syringe_model()
	s.scale = Vector3.ONE * 1.3
	holder.add_child(s)
	seat.subject.parts.armR.add_child(holder)
	seat.syringe = holder
	seat.actor.speed_mul = CARRIER_SPEED if seat.carrier else INFECTED_SPEED
	seat.actor.shove_cd = 1e9 # infected cannot shove


func _try_stab(seat: Dictionary) -> void:
	var a: ArenaActor = seat.actor
	seat.stab_cd = 0.5
	var f := a.forward()
	var best = null
	var bd := INF
	for s in alive_seats():
		if s.infected:
			continue
		var dx: float = s.actor.pos.x - a.pos.x
		var dz: float = s.actor.pos.z - a.pos.z
		var d := U.hypot(dx, dz)
		if d > STAB_RANGE or d < 1e-3:
			continue
		if (dx * f.x + dz * f.z) / d < -0.2:
			continue
		if d < bd:
			bd = d
			best = s
	a.subject.push()
	if best == null:
		Sfx.play("whoosh", {"vol": 0.4})
		return
	seat.stab_cd = STAB_CD
	seat.jabs += 1
	if seat.carrier and time - found_at <= 3:
		award(seat, "quickJab")
	_infect(best, false)
	var away := Vector3(best.actor.pos.x - a.pos.x, 0, best.actor.pos.z - a.pos.z).normalized()
	best.actor.knock += away * 4
	Sfx.play("inject")
	fx.sparks(Vector3(best.actor.pos.x, 1.3, best.actor.pos.z), {"count": 10, "speed": 3.0, "color": 0x6cff5a})
	hud.feed("%s ▸ %s INFECTED" % [seat.player.name(), best.player.name()], seat.player.color)


# -------------------------------------------------------------- lifecycle

func start() -> void:
	hud.prompt("Hold {A} at a container to search it")
	_prompt_on = true


func preview(dt: float) -> void:
	for s in seats:
		s.subject.animate(dt, 0)


func update(dt: float) -> void:
	var playing := state == "play"
	arena.step(dt, playing)
	_animate(dt)
	if not playing:
		_run_purge(dt)
		return
	if _prompt_on and time >= 5.0:   # JS: setTimeout(5000)
		_prompt_on = false
		hud.prompt("")

	for seat in alive_seats():
		var a: ArenaActor = seat.actor
		seat.stab_cd = maxf(0.0, seat.stab_cd - dt)
		if seat.convulse > 0:
			seat.convulse -= dt
			if seat.convulse <= 0:
				a.frozen = false
				var root: Node3D = seat.subject.root
				root.rotation = Vector3(0, root.rotation.y, 0)
				_arm_syringe(seat)
			continue
		if seat.prime > 0:
			seat.prime -= dt
			if seat.prime <= 0:
				a.frozen = false
			continue
		if not found:
			_search_step(seat, dt)
		elif seat.infected and seat.ctrl.a_pressed and seat.stab_cd <= 0 and a.stun <= 0:
			_try_stab(seat)

	# The hiding place starts to rattle if nobody has found it for a while.
	if not found and time > HINT_AFTER:
		hint_t -= dt
		if hint_t <= 0:
			hint_t = 1.5
			Sfx.play("clank", {"vol": 0.35})

	# HUD
	var survivors := seats.filter(func(s): return s.alive and not s.infected)
	for s in seats:
		hud.set_status(s, "CARRIER" if s.carrier else ("INFECTED" if s.infected else ("CLEAN" if found else "SEARCHING")))
		hud.set_stat(s, ("JABS %d" % s.jabs) if s.infected else ("OPENED %d" % s.opened))
	hud.set_timer(end_at - time)

	if found and survivors.is_empty():
		outcome = "infected"
		hud.banner("TOTAL INFECTION", 2200, "danger")
		Sfx.play("sting")
		# The carrier is spared; everyone they turned is purged.
		var doomed := infect_order.slice(1).filter(func(s): return s.alive)
		purge = []
		for i in doomed.size():
			purge.append({"seat": doomed[i], "at": 1.0 + i * 0.6})
		purge_t = 0.0
		end(2.2 + doomed.size() * 0.6)
	elif time >= end_at:
		_timeout()


## Hold-A container search for one seat.
func _search_step(seat: Dictionary, dt: float) -> void:
	var a: ArenaActor = seat.actor
	var srch: Dictionary = seat.search
	var ring: MeshInstance3D = seat.search_ring
	var target: Stash = null
	if seat.ctrl.a and a.stun <= 0:
		var bd := SEARCH_REACH
		for c in containers:
			if c.searched:
				continue
			var d := U.dist2d(a.pos, c.front)
			if d < bd:
				bd = d
				target = c
	if target == null:
		srch.c = null
		srch.t = 0.0
		a.frozen = false
		ring.visible = false
		return
	if srch.c != target:
		srch.c = target
		srch.t = 0.0
		Sfx.play("search", {"vol": 0.4})
	srch.t += dt
	a.frozen = true
	a.facing = target.rot_y + PI
	ring.visible = true
	var k := clampf(srch.t / SEARCH_TIME, 0.0, 1.0)
	var segs := maxi(1, int(floor(k * RING_SEG)))
	ring.mesh = Geo.ring(0.2, 0.32, segs, 0.0, TAU * segs / RING_SEG)
	if srch.t >= SEARCH_TIME:
		srch.c = null
		srch.t = 0.0
		a.frozen = false
		ring.visible = false
		_open_container(target, seat)


## Doors, rings, convulsions and poses.
func _animate(dt: float) -> void:
	for c in containers:
		if c.searched and c.open < 1:
			c.open = minf(1.0, c.open + dt * 3)
		var jiggle := 0.0
		if not found and c.has_syringe and time > HINT_AFTER and state == "play":
			jiggle = absf(sin(time * 30)) * 0.06
		if c.door:
			c.door.rotation.y = -(c.open * 1.9 + jiggle)
		if c.drawer:
			c.drawer.position.z = c.open * 0.45 + jiggle
	for s in seats:
		var ring: MeshInstance3D = s.search_ring
		if not s.alive:
			ring.visible = false
			continue
		if ring.visible and ring.is_inside_tree():
			var v: Vector3 = s.subject.parts.head.global_position
			ring.position = Vector3(v.x, v.y + 0.75, v.z)
			ring.quaternion = camera.quaternion
		var root: Node3D = s.subject.root
		if s.convulse > 0:
			root.rotation.z = sin(time * 45) * 0.2
			root.rotation.x = sin(time * 31) * 0.1
			s.subject.pose = "armsUp"
		else:
			s.subject.pose = "armsUp" if s.prime > 0 else ("cower" if s.actor.stun > 0.3 else ("hold" if s.syringe != null else "idle"))


## Time ran out: survivors win, the infected are purged one by one.
func _timeout() -> void:
	outcome = "timeout"
	var doomed := infect_order.filter(func(s): return s.alive)
	hud.banner("TIME UP — PURGING THE INFECTED" if doomed.size() > 0 else "TIME UP", 2200, "danger" if doomed.size() > 0 else "good")
	Sfx.play("buzz")
	purge = []
	for i in doomed.size():
		purge.append({"seat": doomed[i], "at": 0.8 + i * 0.6})
	purge_t = 0.0
	end(1.8 + doomed.size() * 0.6)


func _run_purge(dt: float) -> void:
	if purge.is_empty():
		return
	purge_t += dt
	for p in purge:
		var s: Dictionary = p.seat
		if not s.alive:
			continue
		if purge_t > p.at - 0.5: # brief convulsion before the end
			s.subject.root.rotation.z = sin(time * 45) * 0.2
			s.subject.pose = "armsUp"
		if purge_t >= p.at:
			kill(s, "gib" if Rng.random() < 0.5 else "burn")


## Tiers: everyone infected → carrier, then later-infected first.
## Time-out → survivors (one tier), then the infected in that same order.
func placement() -> Array:
	var inf_tiers := []
	if not infect_order.is_empty():
		inf_tiers.append([infect_order[0]])
		var rest := infect_order.slice(1)
		rest.reverse()
		for s in rest:
			inf_tiers.append([s])
	if outcome == "infected":
		return inf_tiers
	var survivors := seats.filter(func(s): return not s.infected)
	if survivors.is_empty():
		return inf_tiers
	return [survivors] + inf_tiers


# -------------------------------------------------------------------- bots

func bot_think(seat: Dictionary, dt: float) -> void:
	var a: ArenaActor = seat.actor
	var c: Controller = a.ctrl
	var brain: Dictionary = seat.brain
	var m: Dictionary = brain.memory
	var was_a: bool = m.get("last_a", false)
	m.last_a = false
	c.set_buttons(false, false)
	if seat.convulse > 0 or seat.prime > 0:
		c.set_move(0, 0)
		return

	if not found:
		if m.get("claim") == null or m.claim.searched:
			m.claim = _claim_container(seat)
		var goal = m.claim
		if goal == null:
			c.set_move(0, 0)
			return
		# Occasionally shove a rival who is mid-search.
		for r in alive_seats():
			if is_same(r, seat) or r.search.c == null:
				continue
			if U.dist2d(a.pos, r.actor.pos) < 1.2 and Rng.random() < brain.difficulty * dt * 1.2:
				a.facing = atan2(r.actor.pos.x - a.pos.x, r.actor.pos.z - a.pos.z)
				c.set_buttons(false, true)
				return
		if U.dist2d(a.pos, goal.front) < SEARCH_REACH * 0.75:
			c.set_move(0, 0)
			c.set_buttons(true, false)
			m.last_a = true
			return
		_go_to(a, m, goal.front.x, goal.front.z, dt)
		return

	if seat.infected:
		if a.stun > 0:
			c.set_move(0, 0)
			return
		var target = null
		var bd := INF
		for s in alive_seats():
			if s.infected:
				continue
			var d := U.dist2d(a.pos, s.actor.pos)
			if d < bd:
				bd = d
				target = s
		if target == null:
			c.set_move(0, 0)
			return
		var ta: ArenaActor = target.actor
		if bd < STAB_RANGE * 0.85:
			m.in_range_t = m.get("in_range_t", 0.0) + dt
			a.facing = atan2(ta.pos.x - a.pos.x, ta.pos.z - a.pos.z)
			# React like a human would: a short delay before the jab.
			if m.in_range_t > brain.reaction + 0.1 and not was_a and seat.stab_cd <= 0:
				c.set_move(0, 0)
				c.set_buttons(true, false)
				m.last_a = true
				m.in_range_t = 0.0
				return
			c.set_move((ta.pos.x - a.pos.x) * 0.5, (ta.pos.z - a.pos.z) * 0.5)
			return
		m.in_range_t = 0.0
		# Lead the target a little.
		_go_to(a, m, ta.pos.x + ta.vel.x * 0.25, ta.pos.z + ta.vel.z * 0.25, dt)
		return

	_flee(seat, dt)


## Pick the nearest unsearched container, avoiding ones other bots already claimed.
func _claim_container(seat: Dictionary) -> Stash:
	var a: ArenaActor = seat.actor
	var claimed := []
	for s in seats:
		if not is_same(s, seat):
			claimed.append(s.brain.memory.get("claim"))
	var best: Stash = null
	var bc := INF
	for c in containers:
		if c.searched:
			continue
		var cost: float = U.dist2d(a.pos, c.front) + (6.0 if claimed.has(c) else 0.0) + Rng.rand(0, 1.5)
		if c.has_syringe and time > HINT_AFTER:
			cost -= 100 # they hear the rattle
		if cost < bc:
			bc = cost
			best = c
	return best


## Survivor bot: sample escape directions away from active hunters; shove when cornered.
func _flee(seat: Dictionary, dt: float) -> void:
	var a: ArenaActor = seat.actor
	var c: Controller = a.ctrl
	var brain: Dictionary = seat.brain
	var m: Dictionary = brain.memory
	var hunters := alive_seats().filter(func(s): return s.infected and s.convulse <= 0)
	if hunters.is_empty():
		c.set_move(0, 0)
		return
	var closest = null
	var cd := INF
	for h in hunters:
		var d := U.dist2d(a.pos, h.actor.pos)
		if d < cd:
			cd = d
			closest = h
	if closest != null and cd < 1.45 and closest.actor.stun <= 0 and a.shove_cd <= 0 and Rng.random() < brain.difficulty * dt * 12:
		a.facing = atan2(closest.actor.pos.x - a.pos.x, closest.actor.pos.z - a.pos.z)
		c.set_move(0, 0)
		c.set_buttons(false, true)
		return
	var B: Dictionary = arena.bounds
	var best_dir = null
	var bs := -INF
	for i in 16:
		var ang := float(i) / 16 * TAU
		var p := Vector3(a.pos.x + sin(ang) * 2.2, 0, a.pos.z + cos(ang) * 2.2)
		if p.x < B.min_x + 0.6 or p.x > B.max_x - 0.6 or p.z < B.min_z + 0.6 or p.z > B.max_z - 0.6:
			continue
		if not arena.clear_line(a.pos, p, 0.2):
			continue
		var score := INF
		for h in hunters:
			score = minf(score, U.dist2d(p, h.actor.pos) * (1.6 if h.actor.stun > 0 else 1.0))
		if m.has("flee_dir"):
			score += 0.5 * cos(ang - m.flee_dir)
		# Avoid hugging walls (corners are death traps).
		score -= 1.5 / maxf(0.3, minf(minf(p.x - B.min_x, B.max_x - p.x), minf(p.z - B.min_z, B.max_z - p.z)))
		if score > bs:
			bs = score
			best_dir = ang
	if best_dir == null:
		c.set_move(-sin(a.facing), -cos(a.facing))
		return
	m.flee_dir = best_dir
	var urgency := 1.0 if cd < 6 else 0.45
	c.set_move(sin(best_dir) * urgency, cos(best_dir) * urgency)


## Steer to a point, routing around the first blocking collider via its corners.
func _go_to(a: ArenaActor, m: Dictionary, x: float, z: float, dt: float) -> void:
	var tx := x
	var tz := z
	var goal := Vector3(x, 0, z)
	if not arena.clear_line(a.pos, goal, 0.2):
		var w = _first_block(a.pos, goal)
		if w != null:
			var r := 0.65
			var best = null
			var bc := INF
			for cc in [[w.min_x - r, w.min_z - r], [w.max_x + r, w.min_z - r], [w.min_x - r, w.max_z + r], [w.max_x + r, w.max_z + r]]:
				var pt := Vector3(cc[0], 0, cc[1])
				var near_d := U.hypot(pt.x - a.pos.x, pt.z - a.pos.z)
				if near_d < 0.3:
					continue
				var cost := near_d + U.hypot(x - pt.x, z - pt.z) + (0.0 if arena.clear_line(a.pos, pt, 0.2) else 50.0)
				if cost < bc:
					bc = cost
					best = pt
			if best != null:
				tx = best.x
				tz = best.z
	m.stuck_t = m.get("stuck_t", 0.0) + dt
	if m.get("detour_t", 0.0) > 0:
		m.detour_t -= dt
		a.ctrl.set_move(m.dx, m.dz)
		return
	AI.steer_to(a, tx, tz, {"arrive": 0.1, "slow": 0.4})
	if m.stuck_t > 0.7:
		var moved: float = U.hypot(a.pos.x - m.last_pos.x, a.pos.z - m.last_pos.z) if m.has("last_pos") else 1.0
		if moved < 0.3 and a.stun <= 0 and U.hypot(x - a.pos.x, z - a.pos.z) > 0.8:
			var ang := Rng.rand(0, TAU)
			m.dx = sin(ang)
			m.dz = cos(ang)
			m.detour_t = 0.4
		m.last_pos = Vector3(a.pos.x, 0, a.pos.z)
		m.stuck_t = 0.0


func _first_block(from: Vector3, to: Vector3) -> Variant:
	var d := U.hypot(to.x - from.x, to.z - from.z)
	var n := maxi(1, int(ceil(d / 0.2)))
	for i in range(1, n):
		var x := from.x + (to.x - from.x) * i / n
		var z := from.z + (to.z - from.z) * i / n
		for w in arena.walls:
			if x > w.min_x and x < w.max_x and z > w.min_z and z < w.max_z:
				return w
	return null


func dispose() -> void:
	for seat in seats:
		seat.actor = null   # break the seat <-> actor reference cycle
		seat.brain.memory.clear()
	purge = []
	infect_order = []
	super.dispose()

extends Minigame
## LIVE ORDNANCE — hot potato, facility edition. Somebody is always holding
## a bundle of dynamite with a timer taped to it. Do not be that somebody.
##
## Rules
##  - Rectangular test pen with three obstacles (two crate stacks and a
##    generator) to dodge around and hide behind.
##  - A bomb drops from the ceiling into a random subject's hands. Its fuse is
##    a hidden 9–16 s (5–8 s once the round has run 50 s). The LED blinks and
##    the beeping speeds up as the fuse nears zero.
##  - The holder passes it on by touching another subject, or presses A to
##    toss it at the nearest subject in front of them (short range, aim
##    assisted; with nobody in range the toss is fumbled). Whoever just got
##    rid of the bomb is immune for 0.7 s, so it can't bounce straight back.
##  - The holder moves 10% faster. Everyone can shove with B — the usual way
##    to keep the holder off you.
##  - Fuse out: the holder is gibbed (big blast, knockback, camera shake).
##    A fresh bomb drops onto a random survivor 2 s later.
##  - Last subject standing wins. At 75 s the current bomb goes off
##    immediately and the survivors share the win.
## Bomb and generator models: blender/props/ordnance.py.

const META := {
	"id": "ordnance",
	"title": "LIVE ORDNANCE",
	"tagline": "Possession is nine-tenths of the blast radius.",
	"category": "Survival",
	"controls": [{"input": "move", "label": "Move"}, {"input": "a", "label": "Toss bomb"}, {"input": "b", "label": "Shove"}],
	"objective": "Do not be holding the bomb when it goes off.",
	"rules": [
		"A random subject is issued a live bomb. Pass it on before it detonates.",
		"Touch someone to hand it over, or press {A} to toss it at the subject in front of you.",
		"The fuse is hidden. The beeping speeds up as it nears zero.",
		"The holder moves faster. Everyone else can shove with {B}.",
	],
}

const HALF_W := 8.5          # inner pen half-extents
const HALF_D := 5.5
const CAP := 75.0            # hard time cap (s)
const LATE := 50.0           # after this, fuses get short
const RESPAWN := 2.0         # pause between a blast and the next bomb
const DROP_TIME := 0.6       # bomb falling from the ceiling
const TOSS_RANGE := 3.4
const TOSS_CONE := 0.7       # cos of the toss aim-assist half angle
const TOSS_TIME := 0.3       # flight time of a toss
const PASS_IMMUNE := 0.7     # pass-back immunity for whoever let go
const TOUCH_PAD := 0.12      # extra reach for a touch pass
const HOLDER_SPEED := 1.1
const BLAST_PUSH := 3.6      # knockback radius of a detonation
const BOMB_SCALE := 1.3
const GEN_H := 0.9           # generator height (preview bomb rests on it)
const WANDER := {"min_x": -HALF_W + 1.5, "max_x": HALF_W - 1.5, "min_z": -HALF_D + 1.5, "max_z": HALF_D - 1.5}

var arena: Arena
var obstacles := []
var bomb := {}
var _prompt_off_at := -1.0   # JS: setTimeout(4500) hides the opening prompt


func build() -> void:
	make_scene({"fog_near": 18.0, "fog_far": 50.0})
	fx.reserve_flash()   # explosions reuse one light (no shader recompiles)
	make_camera([0, 15.5, 11.8], [0, 0, 0.6], 48)

	# --- floor, pen walls, set dressing
	Env.floor_plane(scene, 44, 32, {"tex": "concrete", "tile": 3.0})
	Env.floor_plane(scene, HALF_W * 2, HALF_D * 2, {"tex": "plate", "tile": 2.0, "y": 0.005})
	Env.stencil(scene, "BLAST ZONE", 0, 0.02, 3.4, {"w": 6.0, "h": 1.6, "opacity": 0.22}).rotation.x = -PI / 2
	Env.stencil(scene, "PASS IT ON", 0, 0.02, -3.4, {"w": 6.0, "h": 1.6, "opacity": 0.18}).rotation.x = -PI / 2

	var wall_mat := Mats.mat(0xffffff, Tex.rust(Vector2(4, 1)))
	Env.block(scene, 0, 0.5, -HALF_D - 0.3, HALF_W * 2 + 1.2, 1.0, 0.6, wall_mat)
	Env.block(scene, 0, 0.5, HALF_D + 0.3, HALF_W * 2 + 1.2, 1.0, 0.6, wall_mat)
	Env.block(scene, -HALF_W - 0.3, 0.5, 0, 0.6, 1.0, HALF_D * 2, wall_mat)
	Env.block(scene, HALF_W + 0.3, 0.5, 0, 0.6, 1.0, HALF_D * 2, wall_mat)
	Env.hazard_strip(scene, 0, -HALF_D + 0.25, HALF_W * 2, 0.5, 0.012)
	Env.hazard_strip(scene, 0, HALF_D - 0.25, HALF_W * 2, 0.5, 0.012)
	Env.hazard_strip(scene, -HALF_W + 0.25, 0, 0.5, HALF_D * 2 - 1, 0.012)
	Env.hazard_strip(scene, HALF_W - 0.25, 0, 0.5, HALF_D * 2 - 1, 0.012)

	var back := Env.mesh(Geo.plane(44, 9), Mats.mat(0xffffff, Tex.wall(Vector2(11, 2.25))), 0, 3.5, -HALF_D - 1.4, {"cast": false})
	scene.add_child(back)
	Env.stencil(scene, "ORDNANCE TESTING", 0, 3.4, -HALF_D - 1.35, {"w": 9.0, "h": 2.2, "opacity": 0.55})
	Env.pipe(scene, [-18, 5.6, -HALF_D - 1.1], [18, 5.6, -HALF_D - 1.1], 0.22)
	Env.pipe(scene, [-18, 4.9, -HALF_D - 1.2], [18, 4.9, -HALF_D - 1.2], 0.1, 0x5a3022)
	Env.crate(scene, -10.8, 0, -3.5, 1.2, 0.3)
	Env.crate(scene, -10.6, 1.2, -3.4, 0.8, -0.2)
	Env.crate(scene, 10.9, 0, 2.5, 1.3, -0.4)

	Env.hanging_lamp(scene, -4.5, 7.5, 0, {"intensity": 85.0, "angle": 0.9})
	Env.hanging_lamp(scene, 4.5, 7.5, 0, {"intensity": 85.0, "angle": 0.9})
	Env.hanging_lamp(scene, 0, 8, -3.5, {"color": 0xff6a4a, "intensity": 25.0, "angle": 0.8, "shadow": false})

	# --- arena + obstacles
	arena = Arena.new({"bounds": {"min_x": -HALF_W, "max_x": HALF_W, "min_z": -HALF_D, "max_z": HALF_D}, "shove_force": 13.0})
	obstacles = []
	Env.crate(scene, -4, 0, -1.6, 1.4, 0)
	Env.crate(scene, -3.95, 1.4, -1.55, 0.85, 0.35)
	_add_obstacle(-4, -1.6, 1.4, 1.4)
	Env.crate(scene, 4, 0, 1.6, 1.4, 0)
	Env.crate(scene, 4.05, 1.4, 1.62, 0.85, -0.3)
	_add_obstacle(4, 1.6, 1.4, 1.4)
	# Generator in the middle (the preview bomb sits on it).
	scene.add_child(Props.make("ordnance", "generator"))
	_add_obstacle(0, 0, 2.2, 0.9)

	# --- avatars (opposite corners first so 2 players start far apart)
	var spots := [[-6.5, -3.5], [6.5, 3.5], [6.5, -3.5], [-6.5, 3.5]]
	for i in seats.size():
		var seat: Dictionary = seats[i]
		var x: float = spots[i][0]
		var z: float = spots[i][1]
		var facing := PI / 2 if x < 0 else -PI / 2
		spawn_subject(seat, {"x": x, "z": z, "facing": facing})
		seat.actor = arena.add(ArenaActor.new({"player": seat.player, "ctrl": seat.ctrl, "subject": seat.subject, "x": x, "z": z}))
		seat.actor.seat = seat
		seat.actor.facing = facing
		seat.actor.data["immune_until"] = 0.0

	_build_bomb()


func _add_obstacle(x: float, z: float, w: float, d: float) -> void:
	obstacles.append(arena.add_wall(x - w / 2, x + w / 2, z - d / 2, z + d / 2))


## Three sticks of dynamite, tape, a timer box with a blinking LED.
func _build_bomb() -> void:
	var g := Node3D.new()
	g.rotation_order = EULER_ORDER_XYZ
	g.add_child(Props.make("ordnance", "bomb"))
	var led_mat := Mats.glow(0x3a0806)
	g.add_child(Env.mesh(Geo.sphere(0.035, 6, 4), led_mat, 0.05, 0.29, 0, {"cast": false}))
	g.scale = Vector3.ONE * BOMB_SCALE
	g.visible = false
	scene.add_child(g)
	# The glow light lives in the scene (always "visible") so hiding the bomb
	# never changes the light count (no shader recompiles mid-round).
	var light := Env.point_light(0xff2010, 0, 4.5, 1.6)
	scene.add_child(light)

	bomb = {
		"g": g, "led_mat": led_mat, "light": light,
		"state": "none",           # "none" | "drop" | "held" | "flying"
		"holder": null, "from": null, "target": null,
		"pos": Vector3.ZERO, "start": Vector3.ZERO,
		"fuse": 1.0, "fuse_max": 1.0, "hold_t": 0.0, "toss_cd": 0.0, "fly_t": 0.0, "drop_t": 0.0, "respawn_t": 1.0,
		"blink": 0.0, "blink_on": false, "spin": 0.0, "hop": 0.0,
	}


func start() -> void:
	var b := bomb
	_hide_bomb()
	b.respawn_t = 1.0
	b.blink = 0.0
	hud.banner("PASS IT ON", 1000)
	hud.prompt("{A} toss the bomb · {B} shove")
	_prompt_off_at = time + 4.5


func preview(dt: float) -> void:
	for s in seats:
		s.subject.animate(dt, 0)
	# A dormant bomb idles on the generator.
	var b := bomb
	var g: Node3D = b.g
	g.visible = true
	b.spin += dt * 0.5
	g.position = Vector3(0, GEN_H + 0.1, 0)
	g.rotation = Vector3(0, b.spin, 0)
	b.blink += dt * 1.2
	var on := fmod(b.blink, 1.0) < 0.4
	Mats.set_color(b.led_mat, 0xff2a14 if on else 0x3a0806)
	b.light.position = Vector3(0, GEN_H + 0.7, 0)
	b.light.light_energy = (3.0 if on else 0.0) * Env.LIGHT_K


# -------------------------------------------------------------------- bomb

## Where a holder carries the bomb: in both hands, in front of the chest.
func _hand_pos(actor: ArenaActor) -> Vector3:
	var yaw := actor.subject.root.rotation.y
	return Vector3(actor.pos.x + sin(yaw) * 0.6, 1.3, actor.pos.z + cos(yaw) * 0.6)


## Drop a fresh bomb onto a random survivor.
func _drop_bomb() -> void:
	var b := bomb
	var alive := alive_seats()
	if alive.size() < 2:
		b.respawn_t = 0.5
		return
	b.state = "drop"
	b.drop_t = 0.0
	b.target = Rng.pick(alive)
	b.holder = null
	b.from = null
	b.fuse = Rng.rand(5, 8) if time > LATE else Rng.rand(9, 16)
	b.fuse_max = b.fuse
	b.blink = 0.0
	Sfx.play("whoosh")
	if time > 2:
		hud.banner("NEW ORDNANCE", 1000, "danger")


## `seat` now holds the bomb.
func _grab(seat: Dictionary) -> void:
	var b := bomb
	b.state = "held"
	b.holder = seat
	b.target = null
	b.hold_t = 0.0
	b.toss_cd = 0.25
	seat.actor.speed_mul = HOLDER_SPEED
	seat.subject.pose = "carry"
	Sfx.play("clank", {"vol": 0.5})


## `seat` lets go of the bomb (pass or toss).
func _release(seat: Dictionary) -> void:
	seat.actor.speed_mul = 1.0
	seat.subject.pose = "idle"
	seat.actor.data["immune_until"] = time + PASS_IMMUNE


func _pass(from: Dictionary, to: Dictionary) -> void:
	_release(from)
	_grab(to)
	Sfx.play("shove", {"vol": 0.5})
	hud.feed("%s passed the bomb to %s" % [from.player.name(), to.player.name()], to.player.color)


static func _immune(a: ArenaActor, now: float) -> bool:
	return float(a.data.get("immune_until", 0.0)) > now


## Best toss target: closest eligible subject inside the forward cone with a clear line.
func _toss_target(seat: Dictionary) -> Variant:
	var a: ArenaActor = seat.actor
	var fx_ := sin(a.facing)
	var fz := cos(a.facing)
	var best = null
	var bs := INF
	for s in seats:
		if is_same(s, seat) or not s.alive or _immune(s.actor, time):
			continue
		var o: ArenaActor = s.actor
		var dx := o.pos.x - a.pos.x
		var dz := o.pos.z - a.pos.z
		var d := U.hypot(dx, dz)
		if d > TOSS_RANGE or d < 0.01:
			continue
		var dot := (dx * fx_ + dz * fz) / d
		if dot < TOSS_CONE:
			continue
		if not arena.clear_line(a.pos, o.pos):
			continue
		var score := d * (2 - dot)
		if score < bs:
			bs = score
			best = s
	return best


func _toss(seat: Dictionary) -> void:
	var b := bomb
	seat.subject.push()
	var t = _toss_target(seat)
	if t == null:   # nobody to catch it: fumble and keep it
		b.toss_cd = 0.6
		b.hop = 0.35
		Sfx.play("wrong", {"vol": 0.4})
		return
	_release(seat)
	b.start = b.pos
	b.state = "flying"
	b.from = seat
	b.target = t
	b.holder = null
	b.fly_t = 0.0
	Sfx.play("whoosh")


## Fuse out: gib `victim`, blast everyone nearby back, schedule the next bomb.
func _detonate(victim: Dictionary) -> void:
	var b := bomb
	var a: ArenaActor = victim.actor
	var at := Vector3(a.pos.x, 1.0, a.pos.z)
	_hide_bomb()
	b.respawn_t = RESPAWN
	fx.explosion(at, 1.4)
	fx.smoke(at, {"color": 0x222222, "size": 1.1, "rise": 2.4, "life": 2.4, "opacity": 0.6})
	Sfx.play("explode")
	kill(victim, "gib", {"dir": a.forward(), "force": 1.5, "quiet": true})
	if engine:
		engine.shake(1.0)
	hud.feed("%s — DETONATED" % victim.player.name(), victim.player.color)
	for s in alive_seats():
		var o: ArenaActor = s.actor
		var dx := o.pos.x - at.x
		var dz := o.pos.z - at.z
		var d := U.hypot(dx, dz)
		if d < BLAST_PUSH and d > 0.01:
			var f := 12.0 * (1 - d / BLAST_PUSH)
			o.knock.x += dx / d * f
			o.knock.z += dz / d * f
			o.stun = maxf(o.stun, 0.3)   # the Arena turns this into a haptic hit


## Take the bomb out of play (no holder, invisible).
func _hide_bomb() -> void:
	var b := bomb
	if b.holder != null:
		b.holder.actor.speed_mul = 1.0
		b.holder.subject.pose = "idle"
	b.state = "none"
	b.holder = null
	b.from = null
	b.target = null
	b.g.visible = false
	b.light.light_energy = 0.0


func _update_bomb_logic(dt: float) -> void:
	var b := bomb
	if b.state == "none":
		b.respawn_t -= dt
		if b.respawn_t <= 0:
			_drop_bomb()
		return
	if b.state == "held" or b.state == "flying":
		b.fuse -= dt
		if b.fuse <= 0:
			_detonate(b.holder if b.state == "held" else b.target)
			return

	if b.state == "drop":
		if not b.target.alive:
			var alive := alive_seats()
			if alive.size() < 2:
				_hide_bomb()
				b.respawn_t = 0.5
				return
			b.target = Rng.pick(alive)
		b.drop_t += dt / DROP_TIME
		if b.drop_t >= 1:
			var t: Dictionary = b.target
			_grab(t)
			hud.feed("%s has the bomb" % t.player.name(), t.player.color)
	elif b.state == "held":
		var holder: Dictionary = b.holder
		var h: ArenaActor = holder.actor
		b.hold_t += dt
		b.toss_cd = maxf(0.0, b.toss_cd - dt)
		if holder.ctrl.a_pressed and b.toss_cd <= 0 and b.hold_t > 0.2 and h.stun <= 0:
			_toss(holder)
		if b.state == "held" and b.hold_t > 0.15:
			for s in seats:
				if is_same(s, holder) or not s.alive:
					continue
				var o: ArenaActor = s.actor
				if _immune(o, time):
					continue
				if U.hypot(o.pos.x - h.pos.x, o.pos.z - h.pos.z) < h.radius + o.radius + TOUCH_PAD:
					_pass(holder, s)
					break
	elif b.state == "flying":
		b.fly_t += dt / TOSS_TIME
		if b.fly_t >= 1:
			var from: Dictionary = b.from
			var to: Dictionary = b.target
			if to.alive:
				_grab(to)
				hud.feed("%s tossed the bomb to %s" % [from.player.name(), to.player.name()], to.player.color)
			elif from.alive:
				_grab(from)
			else:
				_hide_bomb()
				b.respawn_t = RESPAWN


## Bomb placement, LED blink and beeps (speed up as the fuse runs out).
func _update_bomb_visual(dt: float, playing: bool) -> void:
	var b := bomb
	var g: Node3D = b.g
	if b.state == "none":
		g.visible = false
		b.light.light_energy = 0.0
		return
	g.visible = true
	var p: Vector3 = b.pos
	if b.state == "drop":
		p = _hand_pos(b.target.actor)
		var k := minf(1.0, b.drop_t)
		p.y += (1 - k * k) * 9
		b.spin += dt * 6
		g.rotation = Vector3(0, b.spin, 0)
	elif b.state == "held":
		p = _hand_pos(b.holder.actor)
		if b.hop > 0:
			b.hop = maxf(0.0, b.hop - dt)
			p.y += sin(b.hop / 0.35 * PI) * 0.5
		g.rotation = Vector3(0, b.holder.subject.root.rotation.y, 0)
	elif b.state == "flying":
		var dest := _hand_pos(b.target.actor)
		var k := minf(1.0, b.fly_t)
		p = (b.start as Vector3).lerp(dest, k)
		p.y += sin(k * PI) * 1.1
		b.spin += dt * 16
		g.rotation = Vector3(b.spin * 0.5, b.spin, 0)
	b.pos = p
	g.position = p

	var remaining := maxf(0.0, b.fuse)
	var burnt: float = 1 - remaining / b.fuse_max
	var urgency := 0.0 if b.state == "drop" else maxf(burnt * burnt, clampf(1 - remaining / 5, 0, 1))
	b.blink += dt * (1.2 + urgency * 10)
	var on := fmod(b.blink, 1.0) < 0.4
	if on and not b.blink_on and playing and b.state != "drop":
		Sfx.play("beep" if urgency > 0.6 else "tick", {"vol": 0.45 if urgency > 0.6 else 0.7})
	b.blink_on = on
	Mats.set_color(b.led_mat, 0xff2a14 if on else 0x3a0806)
	b.light.position = Vector3(p.x, p.y + 0.5, p.z)
	b.light.light_energy = ((3 + urgency * 5) if on else 0.0) * Env.LIGHT_K
	g.scale = Vector3.ONE * BOMB_SCALE * ((1 + urgency * 0.12) if on else 1.0)


# ------------------------------------------------------------------ update

func update(dt: float) -> void:
	var playing := state == "play"
	arena.step(dt, playing)
	if playing:
		_update_bomb_logic(dt)
	_update_bomb_visual(dt, playing)
	if not playing:
		return

	if _prompt_off_at >= 0.0 and time >= _prompt_off_at:
		_prompt_off_at = -1.0
		hud.prompt("")

	var b := bomb
	for seat in seats:
		if not seat.alive:
			hud.set_stat(seat, "VAPORISED")
			hud.set_status(seat, "")
			continue
		var holds: bool = b.state == "held" and is_same(b.holder, seat)
		var incoming: bool = (b.state == "drop" or b.state == "flying") and is_same(b.target, seat)
		hud.set_status(seat, "HOLDER" if holds else "")
		var stat := "ALIVE"
		if holds:
			stat = "TICKING"
		elif incoming:
			stat = "INCOMING"
		elif _immune(seat.actor, time):
			stat = "IMMUNE"
		hud.set_stat(seat, stat)
	hud.set_timer(maxf(0.0, CAP - time))

	if time >= CAP:
		# Time's up: whoever has the bomb right now gets it anyway.
		if b.state == "held":
			_detonate(b.holder)
		elif b.state == "flying":
			_detonate(b.target)
		else:
			_hide_bomb()
		hud.banner("TIME UP", 1400, "danger")
		end()
		return
	check_last_standing()


# -------------------------------------------------------------- bot helpers

func _wall_margin(x: float, z: float) -> float:
	return minf(minf(x + HALF_W, HALF_W - x), minf(z + HALF_D, HALF_D - z))


func _inside_obstacle(x: float, z: float, pad: float) -> bool:
	for o in obstacles:
		if x > o.min_x - pad and x < o.max_x + pad and z > o.min_z - pad and z < o.max_z + pad:
			return true
	return false


## Waypoint around an obstacle corner when the straight line is blocked.
func _detour(from: Vector3, tx: float, tz: float) -> Vector3:
	var goal := Vector3(tx, 0, tz)
	var best = null
	var bl := INF
	for o in obstacles:
		for cx in [o.min_x - 0.8, o.max_x + 0.8]:
			for cz in [o.min_z - 0.8, o.max_z + 0.8]:
				var c := Vector3(cx, 0, cz)
				if not arena.clear_line(from, c) or not arena.clear_line(c, goal):
					continue
				var l := U.hypot(cx - from.x, cz - from.z) + U.hypot(tx - cx, tz - cz)
				if l < bl:
					bl = l
					best = c
	return best if best != null else goal


## Pick a place to run to, away from the threat `t`: far from it, out of its
## line of sight (behind obstacles), off the walls, and not via its reach.
func _pick_spot(a: ArenaActor, t: ArenaActor, brain: Dictionary, prev) -> Dictionary:
	var cands := []
	for i in 10:
		var ang := float(i) / 10 * TAU
		cands.append({"x": a.pos.x + cos(ang) * 2.8, "z": a.pos.z + sin(ang) * 2.8})
	for o in obstacles:
		var cx: float = (o.min_x + o.max_x) / 2
		var cz: float = (o.min_z + o.max_z) / 2
		var dx := cx - t.pos.x
		var dz := cz - t.pos.z
		var d := U.hypot(dx, dz)
		if d == 0.0:
			d = 1.0
		var r: float = maxf(o.max_x - o.min_x, o.max_z - o.min_z) / 2 + 0.9
		cands.append({"x": cx + dx / d * r, "z": cz + dz / d * r})
	if prev != null:
		cands.append(prev)

	var best = null
	var bs := -INF
	for c in cands:
		var x := clampf(c.x, -HALF_W + 0.7, HALF_W - 0.7)
		var z := clampf(c.z, -HALF_D + 0.7, HALF_D - 0.7)
		if _inside_obstacle(x, z, 0.55):
			continue
		var p := Vector3(x, 0, z)
		var s := minf(U.hypot(x - t.pos.x, z - t.pos.z), 9.0)
		if not arena.clear_line(t.pos, p):
			s += 1.5 + brain.difficulty * 2      # hidden behind cover
		if not arena.clear_line(a.pos, p):
			s -= 1.5                             # can't run straight there
		var m := _wall_margin(x, z)
		if m < 1.6:
			s -= (1.6 - m) * 2.5                 # don't get pinned
		var seg := seg_dist(t.pos.x, t.pos.z, a.pos.x, a.pos.z, x, z)
		if seg < 1.8:
			s -= (1.8 - seg) * 3                 # don't run past the holder
		for o in arena.actors:
			if o == a or o == t or not o.alive:
				continue
			var dd := U.hypot(o.pos.x - x, o.pos.z - z)
			if dd < 1.6:
				s -= (1.6 - dd) * 0.8            # spread out
		if prev != null and is_same(c, prev):
			s += 0.6                             # commit a little
		s += Rng.rand(0, brain.error * 3)
		if s > bs:
			bs = s
			best = {"x": x, "z": z}
	return best if best != null else {"x": a.pos.x, "z": a.pos.z}


# -------------------------------------------------------------------- bots

func bot_think(seat: Dictionary, dt: float) -> void:
	var a: ArenaActor = seat.actor
	var brain: Dictionary = seat.brain
	var mem: Dictionary = brain.memory
	var b := bomb
	var want_a := false
	var want_b := false

	if b.state == "held" and is_same(b.holder, seat):
		# Holder: chase the nearest rival who can take it, toss when lined up.
		mem["spot"] = null
		mem["retarget"] = float(mem.get("retarget", 0.0)) - dt
		var prey_seat = mem.get("prey")
		if mem.retarget <= 0 or prey_seat == null or not prey_seat.alive:
			mem["retarget"] = 0.15 + brain.reaction
			var now := time
			var n = AI.nearest(a, arena.actors, func(o): return not _immune(o, now))
			if n == null:
				n = AI.nearest(a, arena.actors)
			mem["prey"] = n.actor.seat if n != null else null
		prey_seat = mem.prey
		var prey: ArenaActor = prey_seat.actor if prey_seat != null and prey_seat.alive else null
		if prey != null:
			var lead: float = 0.15 + brain.difficulty * 0.35
			var tx := clampf(prey.pos.x + prey.vel.x * lead, -HALF_W + 0.5, HALF_W - 0.5)
			var tz := clampf(prey.pos.z + prey.vel.z * lead, -HALF_D + 0.5, HALF_D - 0.5)
			var d := U.hypot(prey.pos.x - a.pos.x, prey.pos.z - a.pos.z)
			var clear := arena.clear_line(a.pos, prey.pos)
			var urgent: bool = b.fuse < 1 + brain.difficulty * 2   # the beeping gives it away
			var can_toss: bool = clear and b.toss_cd <= 0 and b.hold_t > 0.3 + brain.reaction and a.stun <= 0 \
				and not _immune(prey, time) and d < TOSS_RANGE * (0.55 + 0.35 * brain.difficulty)
			if can_toss and (urgent or Rng.random() < dt * (0.8 + brain.difficulty * 4)):
				var aim: float = atan2(prey.pos.x - a.pos.x, prey.pos.z - a.pos.z) + Rng.rand(-1, 1) * brain.error * 2.5
				a.ctrl.set_move(sin(aim) * 0.6, cos(aim) * 0.6)
				a.facing = aim
				want_a = true
			elif clear:
				AI.steer_to(a, tx, tz, {"arrive": 0.0})
			else:
				var w := _detour(a.pos, tx, tz)
				AI.steer_to(a, w.x, w.z, {"arrive": 0.0})
		else:
			AI.wander(a, brain, dt, WANDER)
	else:
		mem["prey"] = null
		var threat = null
		if b.state == "held":
			threat = b.holder
		elif b.state == "drop" or b.state == "flying":
			threat = b.target
		if threat != null and is_same(threat, seat):
			# The bomb is landing on us: get close to someone to hand it straight on.
			mem["spot"] = null
			var n = AI.nearest(a, arena.actors)
			if n != null:
				AI.steer_to(a, n.actor.pos.x, n.actor.pos.z, {"arrive": 0.0})
		elif threat == null or not threat.alive:
			mem["spot"] = null
			AI.wander(a, brain, dt, WANDER)
		else:
			# Flee: keep distance and cover between us and the holder.
			var t: ArenaActor = threat.actor
			mem["replan"] = float(mem.get("replan", 0.0)) - dt
			if mem.replan <= 0 or mem.get("spot") == null:
				mem["replan"] = 0.15 + brain.reaction * 0.8
				mem["spot"] = _pick_spot(a, t, brain, mem.get("spot"))
			AI.steer_to(a, mem.spot.x, mem.spot.z, {"arrive": 0.25, "slow": 0.6})
			# Cornered by the holder: shove them away.
			var dx := t.pos.x - a.pos.x
			var dz := t.pos.z - a.pos.z
			var d := U.hypot(dx, dz)
			if d == 0.0:
				d = 0.01
			if b.state == "held" and d < 1.6 and a.shove_cd <= 0:
				var cornered := d < 1.1 or _wall_margin(a.pos.x, a.pos.z) < 1.3 or _inside_obstacle(a.pos.x, a.pos.z, 0.9)
				if cornered and Rng.random() < 0.04 + brain.difficulty * 0.16:
					a.ctrl.set_move(dx / d * 0.3, dz / d * 0.3)
					want_b = true
	# Buttons are edge-triggered: alternate so repeated intents become fresh presses.
	var a_prev: bool = mem.get("a_prev", false)
	var b_prev: bool = mem.get("b_prev", false)
	a.ctrl.set_buttons(want_a and not a_prev, want_b and not b_prev)
	mem["a_prev"] = want_a and not a_prev
	mem["b_prev"] = want_b and not b_prev


## Distance from point (px, pz) to the segment (ax, az)–(bx, bz).
static func seg_dist(px: float, pz: float, ax: float, az: float, bx: float, bz: float) -> float:
	var vx := bx - ax
	var vz := bz - az
	var l2 := vx * vx + vz * vz
	var k := clampf(((px - ax) * vx + (pz - az) * vz) / l2, 0.0, 1.0) if l2 > 1e-6 else 0.0
	return U.hypot(px - (ax + vx * k), pz - (az + vz * k))


func dispose() -> void:
	# break reference cycles (seat <-> actor, bot memories pointing at rival seats)
	bomb.holder = null
	bomb.from = null
	bomb.target = null
	for seat in seats:
		seat.actor = null
		seat.brain.memory.clear()
	super.dispose()

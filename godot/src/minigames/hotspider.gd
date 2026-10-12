extends Minigame
## HOT SPIDER — a clockwork spider bomb clings to somebody's spine. Pass it on
## before the fuse runs out.
##
## Rules
##  - Circular grated pit with a furnace glowing underneath.
##  - A mechanical spider drops onto a random subject's back. Its fuse is a
##    hidden 8–14 s; the red eye blinks faster as it burns down and digits
##    appear for the final 3 seconds.
##  - The carrier presses A to THROW it (arc, facing direction). It latches
##    onto the first subject it hits; on a miss it lands and scuttles after
##    the nearest subject. A thrower is immune for 1 s after letting go.
##  - The carrier moves 10% faster. B shoves.
##  - Fuse out: the carrier's spine is folded the wrong way ('snap') plus a
##    small blast. A spider that pops on the floor gibs anyone within reach.
##    A fresh spider drops 2 s later. Last subject alive wins.
##  - After 75 s the fuses shorten so the round always resolves.
##
## Models (blender/props/hotspider.py): spider (+ spider_key), leg_l / leg_r
## (eight hip pivots), pit (rim wall, railing, posts).

const META := {
	"id": "hotspider",
	"title": "HOT SPIDER",
	"tagline": "It only wants a hug. A very short, very final hug.",
	"category": "Survival",
	"controls": [{"input": "move", "label": "Move"}, {"input": "a", "label": "Throw spider"}, {"input": "b", "label": "Shove"}],
	"objective": "Do not be wearing the spider when its fuse runs out.",
	"rules": [
		"The spider clings to your back. Press {A} to throw it at someone.",
		"Missed throws land — the spider then hunts the nearest subject.",
		"The red eye blinks faster as the hidden fuse burns down.",
		"Whoever wears it at zero gets folded in half.",
	],
}

const R := 7.5               # arena radius
const THROW_SPEED := 12.0    # horizontal throw speed
const THROW_UP := 3.5        # initial vertical speed of a throw
const GRAVITY := 20.0
const SCUTTLE_SPEED := 3.8
const POUNCE_RANGE := 2.6    # a loose spider leaps at anyone this close
const LATCH_DIST := 0.7
const IMMUNE_TIME := 1.0
const BLAST_R := 2.2         # floor detonation kill radius
const LOOSE_BURN := 0.75     # fuse burns slower while the spider is loose


## The one spider of the round (state machine: none | drop | attached | flying | scuttle).
class Spider:
	var g: Node3D
	var key: Node3D
	var legs := []
	var eye_mat: StandardMaterial3D
	var light: OmniLight3D
	var label: Label3D
	var shown_digit := -1
	var state := "none"
	var pos := Vector3.ZERO
	var vel := Vector3.ZERO
	var heading := 0.0
	var carrier = null        # seat Dictionary
	var thrower = null
	var attached_t := 0.0
	var fuse := 0.0
	var fuse_max := 1.0
	var blink := 0.0
	var blink_on := false
	var leg_phase := 0.0
	var drop_t := 0.0
	var drop_target = null
	var pounce_cd := 0.0


var arena: Arena
var heat: OmniLight3D
var spider: Spider
var respawn_t := 1.2


func build() -> void:
	make_scene({"fog_near": 20.0, "fog_far": 52.0})
	fx.reserve_flash()   # explosions reuse one light (no shader recompiles)
	make_camera([0, 16.5, 12.2], [0, 0, 0.4], 48)

	# --- the pit: furnace glow beneath a see-through grate
	Env.floor_plane(scene, 60, 40, {"tex": "concrete", "tile": 3.0, "y": -1.2})
	var furnace := Env.mesh(Geo.circle(R + 0.4, 28), Mats.glow(0x6a2408), 0, -0.7, 0, {"cast": false})
	furnace.rotation.x = -PI / 2
	scene.add_child(furnace)
	heat = Env.point_light(0xff6a20, 25, 14, 1.4)
	heat.position = Vector3(0, -0.3, 0)
	scene.add_child(heat)
	var grate_mat := Mats.mat(0xffffff, Tex.image("hotspider-grate", 64, _paint_grate, Vector2(R * 0.9, R * 0.9)), {"double_side": true})
	grate_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR   # alphaTest: 0.5
	grate_mat.alpha_scissor_threshold = 0.5
	var grate := Env.mesh(Geo.circle(R + 0.4, 32), grate_mat, 0, 0, 0, {"cast": false})
	grate.rotation.x = -PI / 2
	scene.add_child(grate)
	# Rim wall, railing posts: Blender model. Hazard band stays a textured ring.
	scene.add_child(Props.make("hotspider", "pit"))
	var band := Env.mesh(Geo.ring(R - 0.35, R + 0.4, 40), Mats.mat(0xffffff, Tex.hazard(Vector2(12, 1))), 0, 0.015, 0, {"cast": false})
	band.rotation.x = -PI / 2
	scene.add_child(band)
	Env.pipe(scene, [-14, 4.5, -9], [14, 4.5, -9], 0.25)
	Env.pipe(scene, [-14, 3.6, -9.3], [14, 3.6, -9.3], 0.12, 0x5a3022)
	Env.stencil(scene, "DO NOT FEED", 0, 2.2, -9.6, {"w": 6.0, "h": 1.8, "opacity": 0.5})
	scene.add_child(Env.mesh(Geo.plane(40, 10), Mats.mat(0xffffff, Tex.wall(Vector2(10, 2.5))), 0, 3.8, -9.8))

	Env.hanging_lamp(scene, 0, 9, 0, {"intensity": 120.0, "angle": 0.85})
	Env.hanging_lamp(scene, -6, 8, -2, {"intensity": 50.0, "angle": 0.8, "shadow": false})
	Env.hanging_lamp(scene, 6, 8, -2, {"intensity": 50.0, "angle": 0.8, "shadow": false})

	# --- arena + avatars
	arena = Arena.new({"bounds": {"min_x": -R, "max_x": R, "min_z": -R, "max_z": R}, "shove_force": 12.0})
	for i in seats.size():
		var seat: Dictionary = seats[i]
		var a := float(i) / seats.size() * TAU + PI / 4
		var x := cos(a) * 3.6
		var z := sin(a) * 3.6
		spawn_subject(seat, {"x": x, "z": z})
		seat.actor = arena.add(ArenaActor.new({"player": seat.player, "ctrl": seat.ctrl, "subject": seat.subject, "x": x, "z": z}))
		seat.actor.seat = seat
		seat.actor.data["immune_until"] = 0.0

	_build_spider()
	respawn_t = 1.2


## Low-poly clockwork spider: shell, eye, eight two-segment legs, countdown digits.
func _build_spider() -> void:
	var g := Node3D.new()
	g.rotation_order = EULER_ORDER_YXZ
	g.scale = Vector3.ONE * 1.45
	var body := Props.make("hotspider", "spider")   # shell, head, band, fangs + wind-up key
	g.add_child(body)
	var eye_mat := Mats.glow(0xff1a10)
	g.add_child(Env.mesh(Geo.sphere(0.075, 6, 4), eye_mat, 0, 0.42, 0.05, {"cast": false}))
	var legs := []
	for side in [-1, 1]:
		for i in 4:
			var hip := Props.make("hotspider", "leg_l" if side < 0 else "leg_r")
			hip.position = Vector3(side * 0.18, 0.24, 0.18 - i * 0.13)
			U.set_rot(hip, 0, side * (-0.7 + i * 0.45) * -1, 0)
			g.add_child(hip)
			legs.append({"hip": hip, "side": side, "i": i, "base_y": hip.rotation.y})
	var light := Env.point_light(0xff2010, 0, 3.5, 1.5)
	light.position = Vector3(0, 0.6, 0)
	g.add_child(light)
	g.visible = false
	scene.add_child(g)

	# Countdown digits (last 3 seconds only): a billboard drawn over everything.
	var label := Label3D.new()
	label.font = Env.font()
	label.font_size = 52
	label.pixel_size = 1.1 / 64.0
	label.outline_size = 8
	label.outline_modulate = Color.BLACK
	label.modulate = Color("#ff3a2a")
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.no_depth_test = true
	label.render_priority = 10
	label.outline_render_priority = 9
	label.visible = false
	scene.add_child(label)

	spider = Spider.new()
	spider.g = g
	spider.key = body.find_child("spider_key", true, false)
	spider.legs = legs
	spider.eye_mat = eye_mat
	spider.light = light
	spider.label = label


func start() -> void:
	respawn_t = 1.0
	spider.g.visible = false
	hud.banner("CATCH!", 900)


func preview(dt: float) -> void:
	for s in seats:
		s.subject.animate(dt, 0)
	# A demo spider idles in the middle of the pit.
	var sp := spider
	sp.g.visible = true
	sp.g.position = Vector3.ZERO
	sp.heading += dt * 0.6
	sp.g.rotation = Vector3(0, sp.heading, 0)
	_animate_spider(dt, 1.5, 0.5)


# ------------------------------------------------------------------ spider

## Drop a fresh spider from the ceiling onto a random survivor.
func _spawn_spider() -> void:
	var alive := alive_seats()
	if alive.size() < 2:
		return
	var sp := spider
	sp.state = "drop"
	sp.drop_t = 0.0
	sp.drop_target = Rng.pick(alive)
	sp.fuse = Rng.rand(3.5, 5.5) if time > 75 else Rng.rand(8, 14)
	sp.fuse_max = sp.fuse
	sp.blink = 0.0
	sp.g.visible = true
	Sfx.play("spider")
	hud.banner("INCOMING", 900, "danger")


## Clamp the spider onto `seat`'s back.
func _latch(seat: Dictionary) -> void:
	var sp := spider
	if sp.carrier != null and sp.carrier.actor != null:
		sp.carrier.actor.speed_mul = 1.0
	sp.carrier = seat
	sp.state = "attached"
	sp.attached_t = 0.0
	seat.actor.speed_mul = 1.1
	Sfx.play("spider")
	Sfx.play("clank", {"vol": 0.4})
	hud.feed("%s is wearing the spider" % seat.player.name(), seat.player.color)


## Carrier lets go: the spider leaves in an arc along their facing.
func _throw(seat: Dictionary) -> void:
	var sp := spider
	var a: ArenaActor = seat.actor
	var f := a.forward()
	if sp.fuse < 1:
		award(seat, "buzzerBeater")
		hud.feed("%s — buzzer beater!" % seat.player.name(), seat.player.color)
	a.speed_mul = 1.0
	a.data["immune_until"] = time + IMMUNE_TIME
	a.subject.push()
	sp.carrier = null
	sp.thrower = seat
	sp.state = "flying"
	sp.pos = Vector3(a.pos.x + f.x * 0.6, 1.4, a.pos.z + f.z * 0.6)
	sp.vel = Vector3(f.x * THROW_SPEED, THROW_UP, f.z * THROW_SPEED)
	sp.heading = a.facing
	Sfx.play("whoosh")


## Fuse reached zero: snap the carrier or blast whoever is near the floor bomb.
func _detonate() -> void:
	var sp := spider
	var at := sp.g.position
	fx.explosion(at, 0.55)
	Sfx.play("explode", {"vol": 0.7})
	engine.shake(0.6)
	if sp.state == "attached" and sp.carrier != null:
		var victim: Dictionary = sp.carrier
		victim.actor.speed_mul = 1.0
		kill(victim, "snap")
	else:
		for seat in alive_seats():
			var d := U.hypot(seat.actor.pos.x - at.x, seat.actor.pos.z - at.z)
			if d < BLAST_R:
				kill(seat, "gib", {"dir": Vector3(seat.actor.pos.x - at.x, 0, seat.actor.pos.z - at.z)})
	# Blast wave shoves everyone nearby.
	for seat in alive_seats():
		var a: ArenaActor = seat.actor
		var dx := a.pos.x - at.x
		var dz := a.pos.z - at.z
		var d := U.hypot(dx, dz)
		if d < 2.8 and d > 0.01:
			a.knock.x += (dx / d) * 9 * (1 - d / 2.8)
			a.knock.z += (dz / d) * 9 * (1 - d / 2.8)
	sp.state = "none"
	sp.carrier = null
	sp.g.visible = false
	sp.label.visible = false
	sp.light.light_energy = 0.0
	respawn_t = 2.0


## A loose spider leaps at a nearby subject's predicted position.
func _pounce(t: ArenaActor) -> void:
	var sp := spider
	var flight := 0.42
	var tx := t.pos.x + t.vel.x * flight
	var tz := t.pos.z + t.vel.z * flight
	sp.vel = Vector3((tx - sp.pos.x) / flight, (GRAVITY * flight) / 2 + 1.2, (tz - sp.pos.z) / flight)
	sp.pos.y = 0.05
	sp.state = "flying"
	sp.thrower = null
	sp.pounce_cd = 1.4
	Sfx.play("spider")


## Can this actor be latched right now?
func _latchable(a: ArenaActor) -> bool:
	return a.alive and not (float(a.data.get("immune_until", 0.0)) > time)


func _update_spider(dt: float) -> void:
	var sp := spider
	if sp.state == "none":
		respawn_t -= dt
		if respawn_t <= 0:
			_spawn_spider()
		return
	if sp.state != "drop":
		sp.fuse -= dt if sp.state == "attached" else dt * LOOSE_BURN
		if sp.fuse <= 0:
			_detonate()
			return

	if sp.state == "drop":
		var t: Dictionary = sp.drop_target
		if not t.alive:
			sp.state = "flying"
			sp.vel = Vector3.ZERO
		else:
			sp.drop_t += dt / 0.6
			var back := _back_pos(t.actor)
			var k := minf(1.0, sp.drop_t)
			sp.pos = Vector3(back.x, back.y + (1 - k * k) * 9, back.z)
			sp.heading += dt * 6
			sp.g.rotation = Vector3(0, sp.heading, 0)
			if sp.drop_t >= 1:
				_latch(t)
	if sp.state == "attached":
		var a: ArenaActor = sp.carrier.actor
		sp.attached_t += dt
		sp.pos = _back_pos(a)
		sp.g.rotation = Vector3(-PI / 2, a.subject.root.rotation.y, 0)
		if sp.carrier.ctrl.a_pressed and sp.attached_t > 0.25 and state == "play":
			_throw(sp.carrier)
	elif sp.state == "flying":
		sp.vel.y -= GRAVITY * dt
		sp.pos += sp.vel * dt
		var r := U.hypot(sp.pos.x, sp.pos.z)
		if r > R - 0.3:   # bonk off the railing
			sp.pos.x *= (R - 0.3) / r
			sp.pos.z *= (R - 0.3) / r
			sp.vel.x *= -0.35
			sp.vel.z *= -0.35
			Sfx.play("clank", {"vol": 0.4})
		sp.heading += dt * 14
		sp.g.rotation = Vector3(0, sp.heading, 0)
		for seat in alive_seats():
			var a: ArenaActor = seat.actor
			if not _latchable(a) or sp.pos.y > 2.2:
				continue
			if U.hypot(a.pos.x - sp.pos.x, a.pos.z - sp.pos.z) < LATCH_DIST:
				_latch(seat)
				break
		if sp.state == "flying" and sp.pos.y <= 0.02:
			sp.pos.y = 0.0
			sp.state = "scuttle"
			sp.pounce_cd = maxf(sp.pounce_cd, 0.5)
			Sfx.play("clank", {"vol": 0.5})
			fx.sparks(sp.pos, {"count": 6})
	elif sp.state == "scuttle":
		var best = null
		var bd := INF
		for seat in alive_seats():
			if not _latchable(seat.actor):
				continue
			var d := U.hypot(seat.actor.pos.x - sp.pos.x, seat.actor.pos.z - sp.pos.z)
			if d < bd:
				bd = d
				best = seat
		sp.pounce_cd -= dt
		if best != null:
			var t: ArenaActor = best.actor
			var want := atan2(t.pos.x - sp.pos.x, t.pos.z - sp.pos.z)
			sp.heading += U.angle_diff(sp.heading, want) * minf(1.0, dt * 10)
			var speed := SCUTTLE_SPEED + (1 - sp.fuse / sp.fuse_max) * 1.5
			sp.pos.x += sin(sp.heading) * speed * dt
			sp.pos.z += cos(sp.heading) * speed * dt
			if bd < LATCH_DIST:
				_latch(best)
			elif bd < POUNCE_RANGE and sp.pounce_cd <= 0:
				_pounce(t)
		sp.g.rotation = Vector3(0, sp.heading, 0)
	sp.g.position = sp.pos

	var scuttling := sp.state == "scuttle" or sp.state == "drop"
	_animate_spider(dt, 14.0 if scuttling else (5.0 if sp.state == "attached" else 2.0), 0.55 if scuttling else 0.25)
	_update_fuse_display(dt)


## World point on an actor's back where the spider clings.
func _back_pos(a: ArenaActor) -> Vector3:
	var yaw := a.subject.root.rotation.y
	return Vector3(a.pos.x - sin(yaw) * 0.28, a.y + 1.3, a.pos.z - cos(yaw) * 0.28)


## Leg gait: alternating tetrapod swing.
func _animate_spider(dt: float, rate: float, amp: float) -> void:
	var sp := spider
	sp.leg_phase += dt * rate
	for leg in sp.legs:
		var ph: float = sp.leg_phase + (PI if leg.i % 2 else 0.0) + (PI if leg.side > 0 else 0.0)
		var hip: Node3D = leg.hip
		hip.rotation.y = leg.base_y + sin(ph) * amp * 0.6
		hip.rotation.z = maxf(0.0, cos(ph)) * amp * 0.5 * leg.side
	# Cosmetic: the wind-up key turns with the gait.
	if sp.key:
		sp.key.rotation.y = wrapf(sp.key.rotation.y + dt * rate * 0.35, -PI, PI)


## Blinking eye (faster as the fuse burns) + digits for the final 3 s.
func _update_fuse_display(dt: float) -> void:
	var sp := spider
	var burnt := 1.0 - maxf(0.0, sp.fuse) / sp.fuse_max
	var freq := 1.0 if sp.state == "drop" else 1.2 + burnt * burnt * 11
	sp.blink += dt * freq
	var on := fmod(sp.blink, 1.0) < 0.45
	if on and not sp.blink_on and sp.state != "drop":
		Sfx.play("beep" if sp.fuse < 3 else "tick", {"vol": 0.35 if sp.fuse < 3 else 0.5})
	sp.blink_on = on
	Mats.set_color(sp.eye_mat, 0xff2010 if on else 0x3a0806)
	sp.light.light_energy = (6.0 if on else 0.0) * Env.LIGHT_K
	var show := sp.state != "drop" and sp.fuse <= 3
	sp.label.visible = show
	if show:
		var digit := maxi(1, int(ceil(sp.fuse)))
		if digit != sp.shown_digit:
			sp.shown_digit = digit
			sp.label.text = str(digit)
		sp.label.position = Vector3(sp.pos.x, sp.pos.y + 1.0, sp.pos.z)
		sp.label.scale = Vector3.ONE * ((1.25 if on else 1.05) / 1.1)


# ------------------------------------------------------------------- update

func update(dt: float) -> void:
	var playing := state == "play"
	arena.step(dt, playing)
	# Circular pit wall.
	for a in arena.actors:
		if not a.alive:
			continue
		var r := U.hypot(a.pos.x, a.pos.z)
		var mx: float = R - a.radius
		if r > mx:
			a.pos.x *= mx / r
			a.pos.z *= mx / r
			a.subject.root.position.x = a.pos.x
			a.subject.root.position.z = a.pos.z
	heat.light_energy = (22 + sin(time * 3) * 4 + Rng.random() * 3) * Env.LIGHT_K
	var sp := spider
	if playing:
		_update_spider(dt)
	elif sp.state == "attached" and sp.carrier != null:
		# keep the spider glued to the winner while the round wraps up
		sp.g.position = _back_pos(sp.carrier.actor)
		sp.g.rotation = Vector3(-PI / 2, sp.carrier.actor.subject.root.rotation.y, 0)
		_animate_spider(dt, 5, 0.25)
	if not playing:
		return

	for seat in seats:
		if not seat.alive:
			hud.set_stat(seat, "FOLDED")
			hud.set_status(seat, "")
			continue
		var has: bool = sp.state == "attached" and is_same(sp.carrier, seat)
		hud.set_stat(seat, "SPIDER!" if has else ("IMMUNE" if seat.actor.data.immune_until > time else "CLEAN"))
		hud.set_status(seat, "CARRIER" if has else "")
	hud.set_timer(-1)
	if time > 150:
		end()   # absolute safety net
		return
	check_last_standing()


# ---------------------------------------------------------------------- bots

func bot_think(seat: Dictionary, dt: float) -> void:
	var a: ArenaActor = seat.actor
	var brain: Dictionary = seat.brain
	var mem: Dictionary = brain.memory
	var sp := spider
	var want_a := false
	var want_b := false

	if sp.state == "attached" and is_same(sp.carrier, seat):
		# Carrier: chase the nearest latchable rival and throw when lined up.
		var n = AI.nearest(a, arena.actors, func(o): return _latchable(o))
		if n != null:
			var t: ArenaActor = n.actor
			var lead := 0.25
			var tx := t.pos.x + t.vel.x * lead
			var tz := t.pos.z + t.vel.z * lead
			var ang := atan2(tx - a.pos.x, tz - a.pos.z)
			if n.dist < 4 and sp.attached_t > 0.3 + brain.reaction:
				if mem.get("aim") == null:
					mem["aim"] = Rng.rand(-1, 1) * brain.error * 0.9
				var aim: float = ang + mem.aim
				a.ctrl.set_move(sin(aim) * 0.35, cos(aim) * 0.35)
				if absf(U.angle_diff(a.facing, aim)) < 0.25 or sp.fuse < 0.6:
					want_a = true
			else:
				mem["aim"] = null
				AI.steer_to(a, tx, tz, {"arrive": 0.0})
		else:
			AI.wander(a, brain, dt, {"min_x": -R + 2, "max_x": R - 2, "min_z": -R + 2, "max_z": R - 2})
	else:
		mem["aim"] = null
		# Everyone else: flee the carrier / loose spider, hug the middle of the free space.
		var threat = null
		if sp.state == "attached" and sp.carrier != null:
			threat = sp.carrier.actor.pos
		elif sp.state != "none":
			threat = sp.pos
		var fx_ := 0.0
		var fz := 0.0
		if threat != null:
			var dx: float = a.pos.x - threat.x
			var dz: float = a.pos.z - threat.z
			var d := U.hypot(dx, dz)
			if d == 0.0:
				d = 0.01
			var rng := 5.0 if sp.state == "scuttle" else 6.5
			if d < rng:
				var w := (rng - d) / rng
				fx_ += (dx / d) * w * 2.2
				fz += (dz / d) * w * 2.2
				# Slide along the wall instead of getting pinned against it.
				var r := U.hypot(a.pos.x, a.pos.z)
				if r == 0.0:
					r = 0.01
				if r > R - 2.4:
					var tx := -a.pos.z / r
					var tz := a.pos.x / r
					if tx * dx + tz * dz < 0:
						tx = -tx
						tz = -tz
					fx_ += tx * 1.6 - (a.pos.x / r) * 0.9
					fz += tz * 1.6 - (a.pos.z / r) * 0.9
			# Panic shove: carrier right on top of us.
			if sp.state == "attached" and d < 1.25 and Rng.random() < 0.08 + brain.difficulty * 0.1:
				a.ctrl.set_move(-dx / d * 0.3, -dz / d * 0.3)
				want_b = true
				fx_ = 0.0
				fz = 0.0
		if not want_b:
			if U.hypot(fx_, fz) > 0.25:
				a.ctrl.set_move(fx_, fz)
			else:
				AI.wander(a, brain, dt, {"min_x": -R + 2.2, "max_x": R - 2.2, "min_z": -R + 2.2, "max_z": R - 2.2})
	# Buttons are edge-triggered: alternate so repeated intents become fresh presses.
	var pa: bool = want_a and not mem.get("a_prev", false)
	var pb: bool = want_b and not mem.get("b_prev", false)
	a.ctrl.set_buttons(pa, pb)
	mem["a_prev"] = pa
	mem["b_prev"] = pb


## See-through steel grate: dark bars on transparent holes (alpha-tested).
static func _paint_grate(img: Image, s: int) -> void:
	var bar := Color("#4b4c48")
	for y in s:
		for x in s:
			if x % 16 >= 5 and y % 16 >= 5:
				img.set_pixel(x, y, Color(0, 0, 0, 0))
				continue
			var c := bar
			if x % 16 == 4 or y % 16 == 4:
				c = c.lerp(Color.BLACK, 0.35)
			var n := (randf() - 0.5) * 40.0 / 255.0
			img.set_pixel(x, y, Color(clampf(c.r + n + 8 / 255.0, 0, 1), clampf(c.g + n, 0, 1), clampf(c.b + n - 6 / 255.0, 0, 1), 1.0))


func dispose() -> void:
	for seat in seats:
		seat.actor = null   # break the seat <-> actor reference cycle
	spider.carrier = null
	spider.thrower = null
	spider.drop_target = null
	super.dispose()

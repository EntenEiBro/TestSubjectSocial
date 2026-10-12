extends Minigame
## PRESSURE TEST — push your luck at a row of pump stations.
##
## Rules
##  - Every subject stands at their own station: a hand pump, a glass
##    pressure tank and a big dial gauge. Nobody walks anywhere.
##  - HOLD A to pump: pressure rises, a little faster the longer you keep
##    holding (releasing resets the acceleration, so tapping is slower but safer).
##  - PRESS B to bank: the current pressure (rounded down) is added to your
##    score and the tank vents to zero (short lock-out while it vents).
##  - Every tank fill has a hidden burst threshold, random 40–100, re-rolled
##    after each bank or burst. Exceed it and the tank bursts: the unbanked
##    pressure is lost, you are blasted back and stunned for 2 s, and you
##    collect a strike. The third burst is fatal (gib).
##  - Hint: the gauge needle (and the tank) trembles once the pressure is
##    within 15 % of the threshold.
##  - 45 s round. Unbanked pressure at the buzzer is worth nothing. The round
##    also ends early when only one subject (or nobody) is left alive.
##  - Ranking: living subjects by banked score, then the dead in reverse
##    death order (base Minigame.placement()).
##
## Pump, tank base / frame, gauge housing and needle are Blender models
## (blender/props/pressure.py); glass, liquid, dial face and shards are procedural.

const META := {
	"id": "pressure",
	"title": "PRESSURE TEST",
	"tagline": "Every tank has a limit. So do you.",
	"category": "Timing",
	"controls": [{"input": "a", "label": "Hold to pump"}, {"input": "b", "label": "Bank pressure"}],
	"objective": "Bank the most pressure before time runs out.",
	"rules": [
		"Hold {A} to pump. Pressure climbs faster the longer you hold.",
		"Press {B} to bank: the pressure joins your score and the tank vents.",
		"Each tank bursts at a hidden limit (40–100). A burst loses the fill, stuns you and costs a strike.",
		"The needle trembles near the limit. The third burst is fatal. Unbanked pressure at the buzzer is worthless.",
	],
}

const DURATION := 45.0
const MAX_STRIKES := 3
const STUN_TIME := 2.0
const VENT_TIME := 0.9
const THRESH_MIN := 40.0
const THRESH_MAX := 100.0
const SHAKE_AT := 0.85                          # needle trembles from 85 % of the threshold
const RATE_BASE := 6.0                          # pressure units / s
const RATE_GAIN := 9.0
const RATE_MAX := 26.0
const BIG_BANK := 85                            # feed line for greedy successes
const FACING := 0.45                            # subjects turn slightly toward their tank
const HANDLE_TOP := 1.12                        # pump T-handle height / stroke
const STROKE := 0.2
const GLASS_H := 1.5
const NEEDLE_0 := PI * 0.75                     # 0 → lower left, 100 → lower right
const NEEDLE_SPAN := PI * 1.5

var spacing := 3.0
var mats := {}
var readout_root: Control = null
var steam_drift := Vector3(0.15, 0, 0.1)
var prompt_on := false


func build() -> void:
	var n := seats.size()
	spacing = 3.4 if n <= 2 else 3.0
	var width := n * spacing
	var W := width + 14
	make_scene({"fog_near": 14.0, "fog_far": 42.0, "ambient_intensity": 0.95})
	make_camera([0, 3.0, 6.0 + width * 0.42], [0, 1.3, -0.3], 45)
	scene.add_child(Env.dir_light(0xd8dce0, 0.6, Vector3(-2, 6, 10)))

	# Shared materials for every station (the solid parts are Blender models).
	mats = {
		"steel": Mats.mat(0x8a8e8a, Tex.metal()),
		"dark": Mats.mat(0x2e302d, Tex.plate()),
		"glass": Mats.mat(0xcfe6e0, null, {"opacity": 0.22, "depth_write": false, "double_side": true}),
		"shard": Mats.glow(0xd8f0ea, {"opacity": 0.6, "double_side": true}),
		"face": Mats.glow(0xdddddd, {"tex": _gauge_texture()}),
	}

	# Room
	Env.floor_plane(scene, W, 16, {"tex": "plate", "tile": 2.0, "z": 2.0})
	Env.block(scene, 0, 3, -2.35, W, 6, 0.3, Mats.mat(0xa9a89a, Tex.wall(Vector2(W / 4, 1.5))))
	Env.block(scene, 0, 0.45, -2.17, W, 0.9, 0.06, Mats.mat(0x5a4a3a, Tex.rust(Vector2(W / 3, 0.5))))
	Env.stencil(scene, "PRESSURE TEST", -(width / 4 + 1.2), 4.3, -2.18, {"w": 5.4, "h": 1.6, "opacity": 0.55})
	Env.stencil(scene, "KNOW YOUR LIMIT", width / 4 + 1.2, 4.3, -2.18, {"w": 4.6, "h": 1.0, "opacity": 0.8, "color": "#c0402c"})
	Env.pipe(scene, [-W / 2, 3.5, -2.0], [W / 2, 3.5, -2.0], 0.14)
	Env.pipe(scene, [-W / 2, 3.85, -2.05], [W / 2, 3.85, -2.05], 0.08, 0x3a3f3a)
	for i in n - 1:
		Env.hazard_strip(scene, (i + 0.5 - (n - 1) / 2.0) * spacing, 0.1, 0.22, 4.2, 0.008)

	# Two shadow-casting lamps at most.
	var lamp_xs := []
	if n <= 2:
		for i in n:
			lamp_xs.append((i - (n - 1) / 2.0) * spacing)
	else:
		lamp_xs = [-width / 4, width / 4]
	for lx in lamp_xs:
		Env.hanging_lamp(scene, lx, 6.4, -0.2, {"intensity": 85.0, "angle": 0.95})

	# Pressure readouts above each gauge (HUD labels).
	readout_root = Control.new()
	readout_root.name = "PressureReadouts"
	readout_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	readout_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.add_child(readout_root)

	for i in n:
		_build_station(seats[i], i, (i - (n - 1) / 2.0) * spacing)


# ------------------------------------------------------------------ stage

## Pump, tank, gauge, warning lamp and subject for one seat.
func _build_station(seat: Dictionary, i: int, x0: float) -> void:
	var sx := x0 - 0.6
	var sz := 0.35
	var tx := x0 + 0.6
	var tz := -0.55

	# Tank base (static: survives a burst) + gauge stem
	Env.hazard_strip(scene, tx, tz, 1.5, 1.5, 0.006)
	var base := Props.make("pressure", "tank_base")
	base.position = Vector3(tx, 0, tz)
	scene.add_child(base)
	var stub := Env.mesh(Geo.cyl(0.44, 0.44, 0.22, 16, true), mats.glass, tx, 0.41, tz, {"cast": false})
	stub.visible = false
	scene.add_child(stub)

	# Tank body (swells with pressure, hidden after a burst)
	var tank := Node3D.new()
	tank.position = Vector3(tx, 0.3, tz)
	var liq_mat := Mats.mat(0x46d36a, null, {"emissive": 0x000000})
	var liquid := Node3D.new()     # base at y = 0, scaled to the fill level
	liquid.add_child(Env.mesh(Geo.cyl(0.4, 0.4, 1, 16), liq_mat, 0, 0.5, 0, {"cast": false}))
	liquid.scale.y = 0.001
	var glass := Env.mesh(Geo.cyl(0.44, 0.44, GLASS_H, 16, true), mats.glass, 0, GLASS_H / 2, 0, {"cast": false})
	U.add(tank, [liquid, glass, Props.make("pressure", "tank_frame")])
	scene.add_child(tank)

	# Dial gauge on a stem above the tank, tilted toward the camera.
	var gauge := Node3D.new()
	gauge.position = Vector3(tx, 2.42, tz + 0.12)
	gauge.rotation.x = -0.15
	var face := Env.mesh(Geo.circle(0.37, 28), mats.face, 0, 0, 0.052, {"cast": false})
	var needle := Node3D.new()
	needle.position.z = 0.062
	needle.rotation.z = NEEDLE_0
	needle.add_child(Props.make("pressure", "gauge_needle"))
	U.add(gauge, [Props.make("pressure", "gauge_body"), face, needle])
	scene.add_child(gauge)

	# Warning lamp on the wall behind the station.
	Env.pipe(scene, [tx, 0, -2.05], [tx, 3.5, -2.05], 0.07, 0x4d4a44)
	scene.add_child(Env.mesh(Geo.box(0.32, 0.32, 0.06), mats.dark, tx - 0.55, 2.9, -2.18))
	var warn_mat := Mats.glow(0x200404)
	scene.add_child(Env.mesh(Geo.box(0.22, 0.22, 0.08), warn_mat, tx - 0.55, 2.9, -2.14, {"cast": false}))

	# Hand pump in front of the subject.
	var px := sx + sin(FACING) * 0.55
	var pz := sz + cos(FACING) * 0.55
	var pump := Node3D.new()
	pump.position = Vector3(px, 0, pz)
	pump.rotation.y = FACING
	pump.add_child(Props.make("pressure", "pump_body"))
	var rod := Props.make("pressure", "pump_rod")
	rod.position.y = HANDLE_TOP
	pump.add_child(rod)
	scene.add_child(pump)
	Env.pipe(scene, [px, 0.1, pz], [tx - 0.4, 0.2, tz + 0.25], 0.035, 0x1c1c1a)

	spawn_subject(seat, {"x": sx, "z": sz, "facing": FACING})

	var readout := UI.label("0", "vt", 3.4, Color(seat.player.color))
	UI.outline(readout, 6, Color(0, 0, 0, 0.85))
	readout.size = Vector2(120, UI.u(4))
	readout_root.add_child(readout)

	seat.merge({
		"idx": i, "sx": sx, "sz": sz, "tx": tx, "tz": tz,
		"pressure": 0.0, "vis": 0.0, "threshold": 0.0, "fill_no": 0, "hold_t": 0.0, "rate": 0.0,
		"pumping": false, "pump_phase": 0.0, "down": 0.0,
		"stun": 0.0, "vent": 0.0, "strikes": 0, "broken": false, "pop": 1.0, "shake_k": 0.0,
		"steam_left": 0.0, "steam_t": 0.0, "status_text": "", "status_t": 0.0,
		"tank": tank, "liquid": liquid, "liq_mat": liq_mat, "stub": stub, "gauge": gauge, "gauge_x": gauge.position.x,
		"needle": needle, "rod": rod, "warn_mat": warn_mat, "readout": readout, "readout_txt": "0",
	}, true)
	_roll_threshold(seat)


# -------------------------------------------------------------- mechanics

## New hidden burst threshold for the next fill.
func _roll_threshold(seat: Dictionary) -> void:
	seat.threshold = Rng.rand(THRESH_MIN, THRESH_MAX)
	seat.fill_no += 1


## Pump / bank / burst logic for one living seat (play state only).
func _step_seat(seat: Dictionary, dt: float) -> void:
	var c: Controller = seat.ctrl
	seat.pumping = false
	if seat.stun > 0:
		seat.stun -= dt
		seat.hold_t = 0.0
		seat.rate = 0.0
		if seat.stun <= 0:
			# A replacement tank is bolted in.
			seat.stun = 0.0
			seat.broken = false
			seat.tank.visible = true
			seat.stub.visible = false
			seat.pop = 0.0
			Sfx.play("clank", {"vol": 0.5})
		return
	if seat.vent > 0:
		seat.vent -= dt
		seat.hold_t = 0.0
		seat.rate = 0.0
		return
	if c.b_pressed and seat.pressure >= 1:
		_bank(seat)
		return
	if c.a:
		seat.hold_t += dt
		seat.rate = minf(RATE_MAX, RATE_BASE + RATE_GAIN * seat.hold_t)
		seat.pressure += seat.rate * dt
		seat.pumping = true
		if seat.pressure > seat.threshold:
			_burst(seat)
	else:
		seat.hold_t = 0.0
		seat.rate = 0.0


func _bank(seat: Dictionary) -> void:
	var amt := int(floor(seat.pressure))
	seat.score += amt
	seat.pressure = 0.0
	seat.hold_t = 0.0
	seat.rate = 0.0
	seat.pumping = false
	seat.vent = VENT_TIME
	seat.steam_left = VENT_TIME
	seat.steam_t = 0.0
	_roll_threshold(seat)
	_status(seat, "BANKED +%d" % amt)
	Sfx.play("puff")
	Sfx.play("ding", {"vol": 0.3})
	Haptics.for_player(seat.player, "click")
	if amt >= BIG_BANK:
		hud.feed("%s BANKED %d" % [seat.player.name(), amt], seat.player.color)


func _burst(seat: Dictionary) -> void:
	seat.strikes += 1
	seat.pressure = 0.0
	seat.vis = 0.0
	seat.hold_t = 0.0
	seat.rate = 0.0
	seat.pumping = false
	seat.broken = true
	seat.tank.visible = false
	seat.stub.visible = true
	seat.steam_left = 0.0
	_roll_threshold(seat)
	var tx: float = seat.tx
	var tz: float = seat.tz

	# Glass shards, spray and steam.
	for k in 8:
		var a := float(k) / 8 * TAU + Rng.rand(-0.3, 0.3)
		var shard := Env.mesh(Geo.box(0.14, 0.2, 0.015), mats.shard, tx + cos(a) * 0.42, 0.45 + k * 0.17, tz + sin(a) * 0.42, {"cast": false})
		var rx := Rng.rand(0, 3)
		var ry := Rng.rand(0, 3)
		U.set_rot(shard, rx, ry, 0)
		var vx := cos(a) * Rng.rand(2.5, 6)
		var vy := Rng.rand(3, 7)
		var vz := sin(a) * Rng.rand(2.5, 6) + 1.2
		var spin := Vector3(Rng.rand(-14, 14), Rng.rand(-14, 14), Rng.rand(-14, 14))
		fx.add_body(shard, Vector3(vx, vy, vz), spin, {"bleed": false, "life": 5.0, "radius": 0.06, "bounce": 0.25})
	var c := Vector3(tx, 1.1, tz)
	fx.sparks(c, {"color": 0xff6a2a, "count": 14, "speed": 7.0})
	fx.sparks(c, {"color": 0xd8f0ea, "count": 10, "speed": 5.0})
	for k in 4:
		var sxp := tx + Rng.rand(-0.4, 0.4)
		var szp := tz + Rng.rand(-0.4, 0.4)
		fx.smoke(Vector3(sxp, 0.6 + k * 0.35, szp), {"color": 0xcfcfc8, "size": 0.45, "rise": 1.4, "life": 1.5, "opacity": 0.6})
	Sfx.play("explode", {"vol": 0.75})
	if engine:
		engine.shake(0.35)

	var dir := Vector3(seat.sx - tx, 0, seat.sz - tz).normalized()
	if seat.strikes >= MAX_STRIKES:
		kill(seat, "gib", {"dir": dir, "force": 1.2})
		return
	seat.stun = STUN_TIME
	Haptics.for_player(seat.player, "hit")
	Sfx.play("wrong", {"vol": 0.4})
	_status(seat, "BURST!")
	hud.feed("%s BLEW A TANK (%d/%d)" % [seat.player.name(), seat.strikes, MAX_STRIKES], seat.player.color)


## Round over: every remaining tank vents (unbanked pressure is lost).
func _vent_all() -> void:
	for seat in seats:
		seat.pumping = false
		seat.rate = 0.0
		seat.hold_t = 0.0
		if seat.alive and seat.pressure > 0:
			seat.pressure = 0.0
			seat.steam_left = VENT_TIME
			seat.steam_t = 0.0


func _status(seat: Dictionary, text: String) -> void:
	seat.status_text = text
	seat.status_t = 1.0


# -------------------------------------------------------------- lifecycle

func start() -> void:
	for seat in seats:
		seat.vis = 0.0
		seat.pumping = false
		seat.rate = 0.0
		seat.pump_phase = 0.0
	hud.prompt("Hold {A} to pump · {B} banks")
	prompt_on = true   # hidden after 5 s (JS setTimeout)


func preview(dt: float) -> void:
	# Cosmetic demo: everyone pumps, needles wander (no game state touched).
	for seat in seats:
		seat.vis = 24 + 18 * sin(clock * 0.9 + seat.idx * 1.9)
		seat.pumping = true
		seat.rate = 10.0
		_animate_seat(seat, dt)
		_render_tank(seat, dt)
	_place_readouts()


func update(dt: float) -> void:
	var playing := state == "play"
	if prompt_on and time >= 5.0:
		prompt_on = false
		if playing:
			hud.prompt("")
	for seat in seats:
		if playing and seat.alive:
			_step_seat(seat, dt)
		# Displayed pressure: follows rises instantly, drains smoothly when venting.
		if seat.vis > seat.pressure:
			seat.vis = maxf(seat.pressure, seat.vis - dt * 110)
		else:
			seat.vis = seat.pressure
		seat.status_t = maxf(0.0, seat.status_t - dt)
		_animate_seat(seat, dt)
		_render_tank(seat, dt)
	_place_readouts()

	for seat in seats:
		hud.set_stat(seat, "BANKED %d · STRIKES %d/%d" % [int(seat.score), seat.strikes, MAX_STRIKES])
		var st := ""
		if not seat.alive:
			st = "RUPTURED"
		elif seat.status_t > 0:
			st = seat.status_text
		elif seat.stun > 0:
			st = "STUNNED"
		elif seat.pumping:
			st = "PUMPING"
		hud.set_status(seat, st)
	if not playing:
		return

	hud.set_timer(maxf(0.0, DURATION - time))
	var alive := alive_seats().size()
	if alive == 0 or (seats.size() > 1 and alive == 1):
		hud.banner("LAST TANK STANDING" if alive else "TEST CONCLUDED", 2200, "good" if alive else "danger")
		Sfx.play("horn")
		_vent_all()
		end(2.6)
	elif time >= DURATION:
		hud.set_timer(0)
		hud.banner("TEST CONCLUDED", 2200)
		Sfx.play("horn")
		_vent_all()
		end(2.4)


# ---------------------------------------------------------------- visuals

## Pumping pose, pump handle and burst knock-back for one seat.
func _animate_seat(seat: Dictionary, dt: float) -> void:
	if not seat.alive:
		return
	var s: Subject = seat.subject
	var p: Dictionary = s.parts
	var stunned: bool = seat.stun > 0
	s.pose = "cower" if stunned else "idle"
	s.animate(dt, 0)

	if seat.pumping and not stunned:
		var before := floorf((seat.pump_phase - PI) / TAU)
		seat.pump_phase += dt * (4 + seat.rate * 0.3)
		var after := floorf((seat.pump_phase - PI) / TAU)
		if after != before and state == "play":
			Sfx.play("step", {"vol": 0.7})
		seat.down = 0.5 - 0.5 * cos(seat.pump_phase)
	else:
		seat.pump_phase = 0.0
		seat.down = lerpf(seat.down, 0, U.damp(10, dt))
	seat.rod.position.y = HANDLE_TOP - seat.down * STROKE

	if not stunned:
		# Hands on the T-handle; lean into the down stroke.
		var d: float = seat.down
		p.armL.rotation.x = -(0.95 - 0.75 * d)
		p.armR.rotation.x = -(0.95 - 0.75 * d)
		p.armL.rotation.z = 0.16
		p.armR.rotation.z = -0.16
		p.torso.rotation.x = 0.4 * d
		p.head.rotation.x = -0.25 * d
		p.hips.position.y -= 0.04 * d

	# Burst: thrown back away from the tank, a hop, then shuffle back.
	var knock := 0.0
	var hop := 0.0
	if stunned:
		var b: float = seat.stun / STUN_TIME # 1 → 0
		var e := 1.0 - b
		knock = minf(1.0, e * 6) * minf(1.0, b * 4)
		hop = sin(e / 0.25 * PI) * 0.35 if e < 0.25 else 0.0
	var dx: float = seat.sx - seat.tx
	var dz: float = seat.sz - seat.tz
	var dl := U.hypot(dx, dz)
	if dl == 0.0:
		dl = 1.0
	s.root.position = Vector3(seat.sx + dx / dl * 0.8 * knock, hop, seat.sz + dz / dl * 0.8 * knock)
	s.root.rotation.z = sin(clock * 9) * 0.08 * knock if stunned else 0.0


## Tank swell, liquid level/colour, needle (with the near-limit tremble), steam, lamp.
func _render_tank(seat: Dictionary, dt: float) -> void:
	var k := clampf(seat.vis / 100.0, 0, 1.05)
	seat.pop = minf(1.0, seat.pop + dt * 3.2)
	var pk: float = maxf(0.01, _ease_out_back(seat.pop)) if seat.pop < 1 else 1.0
	var sw := 1 + 0.17 * k * k

	var near: bool = state == "play" and seat.alive and not seat.broken and seat.vent <= 0 and seat.pressure >= seat.threshold * SHAKE_AT
	var close := clampf((seat.pressure / seat.threshold - SHAKE_AT) / (1 - SHAKE_AT), 0, 1) if near else 0.0
	seat.shake_k = 0.35 + 0.65 * close if near else 0.0
	var jit := 0.0
	if near:
		jit = (sin(clock * 57 + seat.idx * 2.1) * 0.7 + sin(clock * 31.3 + seat.idx) * 0.3) * (0.07 + 0.1 * close)

	var tank: Node3D = seat.tank
	tank.scale = Vector3(sw * pk, (1 + 0.05 * k * k) * pk, sw * pk)
	tank.rotation.z = jit * 0.05
	seat.liquid.scale.y = maxf(0.001, k * (GLASS_H - 0.05))
	# THREE's setHSL / setRGB values are linear.
	var lin := _hsl01(0.34 * (1 - minf(1.0, k)), 0.85, 0.48)
	var lm: StandardMaterial3D = seat.liq_mat
	lm.albedo_color = lin.linear_to_srgb()
	lm.emission = (lin * (0.25 + 0.35 * k)).linear_to_srgb()
	seat.needle.rotation.z = NEEDLE_0 - minf(k, 1.03) * NEEDLE_SPAN + jit
	seat.gauge.position.x = seat.gauge_x + jit * 0.06

	if seat.steam_left > 0:
		seat.steam_left -= dt
		seat.steam_t -= dt
		if seat.steam_t <= 0:
			seat.steam_t = 0.12
			fx.smoke(Vector3(seat.tx + 0.22, 2.3, seat.tz - 0.22), {"color": 0xd6d6cf, "size": 0.18, "rise": 1.6, "life": 1.3, "opacity": 0.55, "drift": steam_drift})

	var lamp := 0.12
	if not seat.alive:
		lamp = 0.8
	elif seat.stun > 0:
		lamp = 1.0 if sin(clock * 14) > 0 else 0.2
	Mats.set_color(seat.warn_mat, Color(lamp, lamp * 0.12, lamp * 0.06).linear_to_srgb())


## Project each pressure readout above its gauge.
func _place_readouts() -> void:
	for seat in seats:
		var el: Label = seat.readout
		if not seat.alive or camera == null or not camera.is_inside_tree():
			el.visible = false
			continue
		var p := Vector3(seat.tx, 3.08, seat.tz + 0.12)
		if camera.is_position_behind(p):
			el.visible = false
			continue
		var vp := camera.get_viewport().get_visible_rect().size
		var sp := camera.unproject_position(p)
		var jx: float = sin(clock * 70 + seat.idx) * (2 + seat.shake_k * 4) if seat.shake_k > 0 else 0.0
		el.visible = true
		el.position = Vector2(sp.x / vp.x * 1280.0 - el.size.x / 2 + jx, sp.y / vp.y * 720.0 - el.size.y / 2)
		var txt := "—" if seat.broken else str(int(floor(seat.vis)))
		if txt != seat.readout_txt:
			seat.readout_txt = txt
			el.text = txt


# placement(): the base implementation already ranks the living by banked
# score (ties share a tier) and then the dead in reverse death order.

# -------------------------------------------------------------------- bots

func bot_think(seat: Dictionary, dt: float) -> void:
	var b: Dictionary = seat.brain
	var m: Dictionary = b.memory
	var c: Controller = seat.ctrl
	if seat.stun > 0 or seat.vent > 0:
		c.set_buttons(false, false)
		m["last_b"] = false
		return
	if m.get("fill", -1) != seat.fill_no:
		_bot_plan(seat)
	if m.wait > 0:
		m.wait -= dt
		c.set_buttons(false, false)
		m.last_b = false
		return

	var p: float = seat.pressure
	var bank: bool = p >= m.target
	# The needle trembles: a bot that notices it banks after its reaction delay.
	if m.notice and p >= seat.threshold * SHAKE_AT:
		m.alarm += dt
		if m.alarm >= b.reaction:
			bank = true
	# Cash in before the buzzer.
	if DURATION - time < 0.35 + b.reaction + b.difficulty * 0.6 and p >= 5:
		bank = true

	if bank and p >= 1:
		# Tap B (press on one tick, release on the next).
		var lb: bool = m.get("last_b", false)
		c.set_buttons(false, not lb)
		m["last_b"] = not lb
		return
	m["last_b"] = false
	c.set_buttons(true, false)


## Per-fill bot plan: target pressure, greed, whether it will notice the tremble.
func _bot_plan(seat: Dictionary) -> void:
	var b: Dictionary = seat.brain
	var m: Dictionary = b.memory
	var d: float = b.difficulty
	m["fill"] = seat.fill_no
	var target: float = 28 + d * 32 + Rng.rand(-6, 6) - seat.strikes * 5 * d
	if Rng.random() < (1 - d) * 0.4:
		target += Rng.rand(12, 35) # greed (mostly low difficulty)
	m["target"] = clampf(target, 22, 98)
	m["notice"] = Rng.random() < 0.15 + 0.8 * d
	m["alarm"] = 0.0
	m["wait"] = b.reaction + Rng.rand(0.1, 0.4 + (1 - d) * 1.2)


func dispose() -> void:
	if is_instance_valid(readout_root):
		readout_root.queue_free()
	readout_root = null
	super.dispose()


# ======================================================================
# Helpers & procedural assets
# ======================================================================

static func _ease_out_back(t: float) -> float:
	var c1 := 1.70158
	var c3 := c1 + 1
	return 1 + c3 * pow(t - 1, 3) + c1 * pow(t - 1, 2)


## HSL (all 0..1) → RGB, like THREE.Color.setHSL.
static func _hsl01(h: float, s: float, l: float) -> Color:
	var q := l * (1.0 + s) if l < 0.5 else l + s - l * s
	var p := 2.0 * l - q
	return Color(_hue(p, q, h + 1.0 / 3.0), _hue(p, q, h), _hue(p, q, h - 1.0 / 3.0))


static func _hue(p: float, q: float, t: float) -> float:
	t = fposmod(t, 1.0)
	if t < 1.0 / 6.0:
		return p + (q - p) * 6.0 * t
	if t < 0.5:
		return q
	if t < 2.0 / 3.0:
		return p + (q - p) * (2.0 / 3.0 - t) * 6.0
	return p


static var _mono: SystemFont = null


static func _mono_font() -> Font:
	if _mono == null:
		_mono = SystemFont.new()
		_mono.font_names = PackedStringArray(["Consolas", "Courier New", "DejaVu Sans Mono", "Droid Sans Mono", "monospace"])
		_mono.font_weight = 700
	return _mono


## Dial face: 0–100 over 270°, clockwise, green / yellow / red bands (cached).
static func _gauge_texture() -> Dictionary:
	return Tex.canvas("pressure-gauge", 128, func(c: CanvasItem, s: float):
		var cx := s / 2
		var cy := s / 2
		var r := s * 0.48
		var ang := func(v: float) -> float: return v * (PI * 1.5 / 100) - PI * 1.25 # canvas angle of dial value v
		c.draw_rect(Rect2(0, 0, s, s), Color("#d6cfb8"))
		for i in 260:
			c.draw_rect(Rect2(randf() * s, randf() * s, 2, 2), Color(70 / 255.0, 50 / 255.0, 25 / 255.0, randf() * 0.1))
		for band in [[0.0, 40.0, "#3f8f45"], [40.0, 75.0, "#c9a227"], [75.0, 100.0, "#b3261e"]]:
			c.draw_arc(Vector2(cx, cy), r * 0.78, ang.call(band[0]), ang.call(band[1]), 24, Color(band[2]), s * 0.075)
		var ink := Color("#1b1a17")
		for v in range(0, 101, 5):
			var major: bool = v % 20 == 0
			var a: float = ang.call(float(v))
			var r0 := r * (0.62 if major else 0.7)
			var r1 := r * 0.9
			c.draw_line(Vector2(cx + cos(a) * r0, cy + sin(a) * r0), Vector2(cx + cos(a) * r1, cy + sin(a) * r1), ink, 3.0 if major else 1.5)
		var font := _mono_font()
		for v in range(0, 101, 20):
			var a: float = ang.call(float(v))
			_centered_text(c, font, str(v), Vector2(cx + cos(a) * r * 0.45, cy + sin(a) * r * 0.45), 13, ink)
		_centered_text(c, font, "PSI", Vector2(cx, cy + r * 0.62), 11, ink)
		c.draw_arc(Vector2(cx, cy), r - 2, 0, TAU, 48, Color("#26241f"), 4.0))


static func _centered_text(c: CanvasItem, font: Font, txt: String, at: Vector2, size: int, color: Color) -> void:
	var sz := font.get_string_size(txt, HORIZONTAL_ALIGNMENT_LEFT, -1, size)
	c.draw_string(font, Vector2(at.x - sz.x / 2, at.y + (font.get_ascent(size) - font.get_descent(size)) / 2), txt, HORIZONTAL_ALIGNMENT_LEFT, -1, size, color)

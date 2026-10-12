extends Minigame
## QUICK DRAW — a reaction audit. Subjects stand in a row, each behind a big
## red button on a pedestal, under a rail of ceiling guns.
##
## Rules
##  - Every heat the wall screen shows WAIT (red lamps), then after a random
##    1.5–4.5 s it turns green and shows DRAW!. Press A as fast as possible.
##  - Pressing during WAIT is a FALSE START: the heat is aborted and every
##    subject who jumped that tick is zapped and loses a life.
##  - Otherwise the heat ends when everyone has pressed or 1.2 s after DRAW.
##    Anyone who did not press in time loses a life ("TOO SLOW"); if everyone
##    pressed, the slowest subject (ties included) loses a life. If every
##    remaining subject pressed on the very same tick it is a DEAD HEAT and
##    nobody is punished.
##  - Each subject has 2 lives (bulbs on the pedestal + HUD). At 0 lives the
##    ceiling gun paints them with a laser and shoots them.
##  - Heats repeat until one subject is left. No new heat starts after 62 s
##    (timer shows 70 s); then survivors rank by lives left, then by total
##    reaction time (false starts / no-press count as 1.2 s). The dead rank
##    by the heat they died in (later = better), then total reaction time.
##  - Each heat's reaction times are listed in the kill feed (fastest on top).
##
## Pedestal, button and ceiling gun: blender/props/quickdraw.py.

const META := {
	"id": "quickdraw",
	"title": "QUICK DRAW",
	"tagline": "Slow hands are a liability. Liabilities are removed.",
	"category": "Reflex",
	"controls": [{"input": "a", "label": "Press the button"}],
	"objective": "Press faster than everyone else. Be the last subject with lives left.",
	"rules": [
		"When the screen turns green and says DRAW, press {A} as fast as you can.",
		"The slowest subject of each heat loses one of two lives. Not pressing within 1.2 s also costs a life.",
		"Press before the screen turns green and you are zapped for a false start. That costs a life too.",
		"Out of lives? The ceiling gun handles the paperwork.",
		"After 70 s the most lives left wins, then the lowest total reaction time.",
	],
}

const LIVES := 2
const PAUSE := 1.3                    # between heats ("HEAT n")
const WAIT_MIN := 1.5                 # random WAIT before DRAW
const WAIT_MAX := 4.5
const DRAW_WINDOW := 1.2              # no press within this → life lost
const RESULT_TIME := 1.7              # minimum time the heat result is shown
const CAP := 70.0                     # displayed round length
const LAST_HEAT := 62.0               # no new heat starts after this
const AIM_TIME := 0.7                 # laser on the doomed before the shot
const EXEC_GAP := 0.4
const PED_Z := 0.56                   # pedestal (button) distance in front of the subject
const BTN_X := 0.12                   # button position inside the pedestal group
const BTN_Y := 1.08
const GUN_Y := 4.1                    # ceiling gun rail
const GUN_Z := 0.7
const LIT := 0x47ff6a
const UNLIT := 0x2a0806
# Right-arm pitch (rotation.x) targets: hanging, poised over the button, slamming it.
const ARM_REST := -0.25
const ARM_POISED := -1.32
const ARM_SLAM := -1.05

var spacing := 2.4
var M := {}
var screen: ScreenCanvas
var lamp_mat: StandardMaterial3D
var signal_light: OmniLight3D
var laser_mat: StandardMaterial3D
var phase := "intro"      # intro | pause | wait | draw | result | done
var phase_t := 0.0        # seconds in the current phase (in "draw": time since DRAW)
var play_t := 0.0         # seconds of play since GO
var heat := 0
var wait_dur := 3.0
var draw_at := 0.0
var tick_t := 0.0
var exec_queue := []
var result_end := 0.0
var signal_mode := "off"
var signal_t := 0.0
var _screen_key := ""
var _prompt_off := -1.0   # play time the intro prompt is hidden (JS setTimeout 5000)


func build() -> void:
	var n := seats.size()
	spacing = 3.0 if n <= 2 else (2.7 if n == 3 else 2.4)
	var width := n * spacing
	make_scene({"fog_near": 14.0, "fog_far": 40.0, "ambient_intensity": 0.85})
	make_camera([0, 2.9, 5.2 + width * 0.35], [0, 1.75, 0], 45)
	scene.add_child(Env.dir_light(0xe0d8c8, 0.6, Vector3(1, 5, 10)))

	# Shared materials (reused by every seat).
	M = {
		"dark": Mats.mat(0x232421, Tex.metal()),
		"gun": Mats.mat(0x3a3c38, Tex.metal()),
	}
	laser_mat = Mats.glow(0xff2020, {"opacity": 0.75})

	_build_room(width)
	for i in n:
		_build_seat(seats[i], i, (i - (n - 1) / 2.0) * spacing)

	phase = "intro"
	phase_t = 0.0
	play_t = 0.0
	heat = 0
	wait_dur = 3.0
	draw_at = 0.0
	tick_t = 0.0
	exec_queue = []
	result_end = 0.0
	signal_mode = "off"
	signal_t = 0.0
	_screen_key = ""
	_draw_screen("QUICK DRAW", "#d8d2c0", "#141410", "REACTION AUDIT")


# ------------------------------------------------------------------ stage

func _build_room(width: float) -> void:
	var W := width + 12
	Env.floor_plane(scene, W, 14, {"tex": "plate", "tile": 2.0, "z": 2.0})
	Env.block(scene, 0, 3, -2.2, W, 6, 0.3, Mats.mat(0xffffff, Tex.wall(Vector2(W / 4, 1.5))))
	Env.block(scene, 0, 0.5, -2.03, W, 1.0, 0.06, Mats.mat(0x4a3a30, Tex.rust(Vector2(W / 4, 0.4))))   # grimy dado band
	Env.pipe(scene, [-W / 2, 5.1, -1.95], [W / 2, 5.1, -1.95], 0.14)
	Env.pipe(scene, [-W / 2, 4.75, -1.98], [W / 2, 4.75, -1.98], 0.07, 0x5a3022)
	Env.hazard_strip(scene, 0, PED_Z + 0.5, width + 1.2, 0.3, 0.012)
	Env.stencil(scene, "NO FLINCHING", 4.4, 3.3, -2.04, {"w": 3.2, "h": 1.1, "opacity": 0.6})
	Env.stencil(scene, "SLOWEST HAND IS REVIEWED", -4.4, 3.3, -2.04, {"w": 3.2, "h": 0.7, "opacity": 0.75, "color": "#c0402c"})

	# Wall screen + signal lamps.
	Env.block(scene, 0, 3.2, -1.98, 3.7, 1.75, 0.2, Mats.mat(0x2e2f2b, Tex.plate()))
	screen = ScreenCanvas.new(256, 112, 3.4, 1.49)
	screen.scanlines = false
	screen.position = Vector3(0, 3.2, -1.87)
	scene.add_child(screen)
	lamp_mat = Mats.glow(0x1c1c1a)
	for sx in [-1, 1]:
		var rim := Env.mesh(Geo.cyl(0.34, 0.34, 0.12, 14), M.dark, sx * 2.25, 3.2, -1.98)
		rim.rotation.x = PI / 2
		scene.add_child(rim)
		scene.add_child(Env.mesh(Geo.sphere(0.26, 12, 8), lamp_mat, sx * 2.25, 3.2, -1.9, {"cast": false}))
	signal_light = Env.point_light(0xff2010, 0.0, 14.0, 1.3)
	signal_light.position = Vector3(0, 3.0, -1.1)
	scene.add_child(signal_light)

	# Ceiling rail for the guns + one shadow-casting work lamp.
	Env.block(scene, 0, GUN_Y + 0.62, GUN_Z, width + 2, 0.12, 0.2, M.gun)
	Env.hanging_lamp(scene, 0, 6.4, 1.6, {"intensity": 85.0, "angle": 1.05, "target": Vector3(0, 0, 0.3)})


## Pedestal, button, life bulbs, ceiling gun and per-seat state.
func _build_seat(seat: Dictionary, idx: int, x: float) -> void:
	spawn_subject(seat, {"x": x, "z": 0.0, "facing": 0.0})
	# Pedestal sits slightly right so the button lands under the right hand.
	var ped := Node3D.new()
	ped.position = Vector3(x + 0.2, 0, PED_Z)
	ped.add_child(Props.make("quickdraw", "pedestal"))
	var button := Props.make("quickdraw", "button")
	button.position = Vector3(BTN_X, BTN_Y, 0)
	ped.add_child(button)
	var bulbs := []
	for k in LIVES:
		var bx := (k - (LIVES - 1) / 2.0) * 0.16
		var bm := Mats.glow(LIT)
		ped.add_child(Env.mesh(Geo.sphere(0.045, 8, 6), bm, bx, 0.72, 0.235, {"cast": false}))
		bulbs.append(bm)
	scene.add_child(ped)

	var gun := Node3D.new()
	gun.position = Vector3(x, GUN_Y, GUN_Z)
	gun.add_child(Props.make("quickdraw", "gun_mount"))
	var pivot := Node3D.new()
	pivot.add_child(Props.make("quickdraw", "gun_body"))
	var barrel := Props.make("quickdraw", "gun_barrel")
	barrel.position = Vector3(0, 0, 0.36)
	pivot.add_child(barrel)
	var eye_mat := Mats.glow(0x440000)
	pivot.add_child(Env.mesh(Geo.sphere(0.04, 6, 4), eye_mat, 0.11, 0.06, 0.16, {"cast": false}))
	# Laser beam: a 1 m box starting at the pivot along +Z, stretched to the target.
	var laser := Node3D.new()
	laser.add_child(Env.mesh(Geo.box(0.02, 0.02, 1), laser_mat, 0, 0, 0.5, {"cast": false}))
	laser.visible = false
	pivot.add_child(laser)
	gun.add_child(pivot)
	scene.add_child(gun)

	seat["idx"] = idx
	seat["lives"] = LIVES
	seat["total"] = 0.0
	seat["best"] = null
	seat["died_heat"] = 0
	seat["heat_state"] = "idle"
	seat["ms"] = 0
	seat["lost"] = false
	seat["beeped"] = false
	seat["exec_at"] = 0.0
	seat["press_t"] = 0.0
	seat["zap_t"] = 0.0
	seat["btn_k"] = 0.0
	seat["arm_k"] = ARM_REST
	seat["tense_k"] = 0.0
	seat["button"] = button
	seat["bulbs"] = bulbs
	seat["gun"] = {"group": gun, "pivot": pivot, "barrel": barrel, "laser": laser, "eye_mat": eye_mat, "recoil": 0.0, "aiming": false}


## Repaint the wall screen (only when its content changes).
func _draw_screen(text: String, fg: String, bg: String, sub: String = "") -> void:
	var key := "%s|%s|%s|%s" % [text, fg, bg, sub]
	if key == _screen_key:
		return
	_screen_key = key
	screen.draw(func(ci: CanvasItem, w: float, h: float):
		ci.draw_rect(Rect2(0, 0, w, h), Color(bg))
		var font := UI.font("ops")
		var size := 64
		var fit := (w * 0.9) / maxf(1.0, font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x)
		if fit < 1.0:
			size = int(floor(size * fit))
		_text_mid(ci, font, text, w, 46.0 if sub != "" else 58.0, size, Color(fg))
		if sub != "":
			_text_mid(ci, UI.font("vt"), sub, w, 94.0, 22, Color(fg))
		var y := 0.0
		while y < h:
			ci.draw_rect(Rect2(0, y, w, 1), Color(0, 0, 0, 0.3))
			y += 2.0)


## Centred text with its middle at y (canvas textAlign center / textBaseline middle).
static func _text_mid(ci: CanvasItem, font: Font, text: String, w: float, y: float, size: int, col: Color) -> void:
	var base := y + (font.get_ascent(size) - font.get_descent(size)) / 2.0
	ci.draw_string(font, Vector2(0, base), text, HORIZONTAL_ALIGNMENT_CENTER, w, size, col)


func _set_signal(mode: String) -> void:
	signal_mode = mode
	signal_t = 0.0


# -------------------------------------------------------------- lifecycle

func start() -> void:
	hud.prompt("Press {A} the moment the screen turns green")
	_prompt_off = 5.0
	_begin_pause()


func preview(dt: float) -> void:
	_animate(dt)


func update(dt: float) -> void:
	_animate(dt)
	if state != "play":
		return
	# All round timing runs on our own counters, advanced here once per tick.
	phase_t += dt
	play_t += dt
	if _prompt_off >= 0.0 and play_t >= _prompt_off:
		_prompt_off = -1.0
		hud.prompt("")
	if play_t >= CAP + 6 and phase != "done":   # absolute safety net
		_time_up()
		return
	match phase:
		"pause":
			if phase_t >= PAUSE:
				_begin_wait()
		"wait":
			_step_wait(dt)
		"draw":
			_step_draw()
		"result":
			_step_result()
	if state == "play":
		_update_hud()


# ------------------------------------------------------------------ heats

func _begin_pause() -> void:
	if play_t >= LAST_HEAT:
		_time_up()
		return
	heat += 1
	phase = "pause"
	phase_t = 0.0
	for s in seats:
		s.heat_state = "steady" if s.alive else "idle"
		s.ms = 0
		s.lost = false
	hud.banner("HEAT %d" % heat, 900)
	_draw_screen("HEAT %d" % heat, "#d8d2c0", "#141410", "STAND BY")
	_set_signal("off")


func _begin_wait() -> void:
	phase = "wait"
	phase_t = 0.0
	wait_dur = Rng.rand(WAIT_MIN, WAIT_MAX)
	tick_t = 0.3
	hud.banner("WAIT...", 0, "danger")
	_draw_screen("WAIT", "#ffb030", "#1a0c04")
	_set_signal("wait")
	Sfx.play("beep", {"vol": 0.5})


func _begin_draw() -> void:
	phase = "draw"
	phase_t = 0.0
	draw_at = time
	hud.banner("DRAW!", 900, "good")
	_draw_screen("DRAW!", "#041004", "#39ff5a")
	_set_signal("draw")
	Sfx.play("go")


func _step_wait(dt: float) -> void:
	# Presses are checked before the switch to DRAW: a press on the very tick
	# DRAW appears was made blind and counts as a false start.
	var jumpers := alive_seats().filter(func(s): return s.ctrl.a_pressed)
	if not jumpers.is_empty():
		_false_start(jumpers)
		return
	tick_t -= dt
	if tick_t <= 0:
		tick_t = 0.55
		Sfx.play("tick", {"vol": 0.6})
	if phase_t >= wait_dur:
		_begin_draw()


func _step_draw() -> void:
	var t := phase_t   # seconds since DRAW (phase_t was reset when DRAW appeared)
	for s in alive_seats():
		if s.heat_state != "steady" or not s.ctrl.a_pressed:
			continue
		s.heat_state = "pressed"
		s.ms = maxi(1, roundi(t * 1000))
		s.total += t
		if s.best == null or t < s.best:
			s.best = t
		s.press_t = 0.22
		Sfx.play("clank", {"vol": 0.5})
		Haptics.for_player(s.player, "press")
	var pending := alive_seats().filter(func(s): return s.heat_state == "steady")
	if pending.is_empty() or t >= DRAW_WINDOW:
		_resolve_heat(pending)


func _false_start(jumpers: Array) -> void:
	for s in jumpers:
		s.heat_state = "false"
		s.total += DRAW_WINDOW
		s.press_t = 0.22
		hud.feed("%s: FALSE START" % s.player.name(), s.player.color)
	hud.banner("FALSE START", 1400, "danger")
	_draw_screen("FALSE START", "#ffffff", "#7a0e08")
	_set_signal("fault")
	Sfx.play("wrong")
	_punish(jumpers)


## Heat over: list the times, find who pays.
func _resolve_heat(pending: Array) -> void:
	for s in pending:
		s.heat_state = "slow"
		s.total += DRAW_WINDOW
	var racers := alive_seats().filter(func(s): return s.heat_state == "pressed")
	racers.sort_custom(func(a, b):
		if a.ms != b.ms:
			return a.ms < b.ms
		return a.idx < b.idx)
	# Feed: newest line goes on top, so post slowest first.
	for s in pending:
		hud.feed("%s: TOO SLOW" % s.player.name(), s.player.color)
	for i in range(racers.size() - 1, -1, -1):
		hud.feed("%s: %d MS" % [racers[i].player.name(), racers[i].ms], racers[i].player.color)

	var losers := []
	if not pending.is_empty():
		losers = pending
		hud.banner("TOO SLOW", 1400, "danger")
		if not racers.is_empty():
			_draw_screen("%d MS" % racers[0].ms, "#39ff5a", "#041004", racers[0].player.name())
		else:
			_draw_screen("TOO SLOW", "#ffffff", "#7a0e08")
	elif not racers.is_empty():
		var worst: int = racers[-1].ms
		if racers.size() > 1 and racers[0].ms == worst:
			hud.banner("DEAD HEAT", 1400, "good")
			_draw_screen("DEAD HEAT", "#39ff5a", "#041004", "%d MS" % worst)
		else:
			losers = racers.filter(func(s): return s.ms == worst)
			hud.banner("%s DRAWS FIRST" % racers[0].player.name(), 1400, "good")
			_draw_screen("%d MS" % racers[0].ms, "#39ff5a", "#041004", racers[0].player.name())
	_set_signal("fault" if not losers.is_empty() else "off")
	_punish(losers)


## Take a life from each loser; queue executions for the empty ones.
func _punish(losers: Array) -> void:
	phase = "result"
	phase_t = 0.0
	exec_queue = []
	for s in losers:
		s.lives = maxi(0, s.lives - 1)
		s.lost = true
		s.beeped = false
		if s.lives < s.bulbs.size():
			Mats.set_color(s.bulbs[s.lives], UNLIT)
		_zap(s)
		if s.lives <= 0:
			s.died_heat = heat
			exec_queue.append(s)
	for i in exec_queue.size():
		exec_queue[i].exec_at = 0.35 + i * (AIM_TIME + EXEC_GAP)
	var exec_end := 0.35 + exec_queue.size() * (AIM_TIME + EXEC_GAP) + 0.6 if not exec_queue.is_empty() else 0.0
	result_end = maxf(RESULT_TIME, exec_end)


func _zap(s: Dictionary) -> void:
	s.zap_t = 0.7
	Sfx.play("buzz")
	Sfx.play("snap", {"vol": 0.5})
	fx.sparks(s.button.global_position, {"color": 0x9fd8ff, "count": 14, "speed": 4.0})
	Haptics.for_player(s.player, "hit")


func _step_result() -> void:
	for s in exec_queue:
		if not s.alive or phase_t < s.exec_at:
			continue
		s.gun.aiming = true
		if not s.beeped:
			s.beeped = true
			Sfx.play("beep")
		if phase_t >= s.exec_at + AIM_TIME:
			_execute(s)
	if phase_t < result_end:
		return
	if alive_seats().size() <= 1:
		_finish()
	else:
		_begin_pause()


func _execute(s: Dictionary) -> void:
	var g: Dictionary = s.gun
	g.aiming = false
	g.laser.visible = false
	g.recoil = 1.0
	var muzzle: Vector3 = g.pivot.global_transform * Vector3(0, 0, 0.6)
	fx.sparks(muzzle, {"count": 12, "color": 0xffe08a, "speed": 5.0})
	kill(s, "shot", {"dir": Vector3(0, 0, -1)})


func _finish() -> void:
	phase = "done"
	_set_signal("off")
	_draw_screen("AUDIT COMPLETE", "#d8d2c0", "#141410")
	hud.set_timer(-1)
	end(2.4)


func _time_up() -> void:
	phase = "done"
	_set_signal("off")
	_draw_screen("TIME UP", "#ffb030", "#1a0c04")
	hud.banner("TIME UP", 2000)
	hud.set_timer(0)
	Sfx.play("horn")
	end(2.4)


## Survivors: most lives, then lowest total time. Dead: later heat first, then total time.
func placement() -> Array:
	var key := func(s): return "%s|%d|%d|%d" % [s.alive, s.lives, s.died_heat, roundi(s.total * 1000)]
	var alive := seats.filter(func(s): return s.alive)
	alive.sort_custom(func(a, b):
		if a.lives != b.lives:
			return a.lives > b.lives
		if a.total != b.total:
			return a.total < b.total
		return a.idx < b.idx)
	var dead := seats.filter(func(s): return not s.alive)
	dead.sort_custom(func(a, b):
		if a.died_heat != b.died_heat:
			return a.died_heat > b.died_heat
		if a.total != b.total:
			return a.total < b.total
		return a.idx < b.idx)
	var tiers := Minigame.group_by(alive, key)
	tiers.append_array(Minigame.group_by(dead, key))
	return tiers


func _update_hud() -> void:
	var live := phase == "wait" or phase == "draw"
	for s in seats:
		if not s.alive:
			hud.set_stat(s, "SHOT")
			hud.set_status(s, "")
			continue
		hud.set_stat(s, "LIVES %d" % s.lives)
		var st := ""
		if s.heat_state == "pressed":
			st = "%d MS" % s.ms
		elif s.heat_state == "false":
			st = "FALSE START"
		elif s.heat_state == "slow":
			st = "TOO SLOW"
		elif live and s.heat_state == "steady":
			st = "STEADY"
		if phase == "result" and s.lost:
			st = "LIFE LOST"
		hud.set_status(s, st)
	hud.set_timer(maxf(0.0, CAP - play_t))


# -------------------------------------------------------------- animation

func _animate(dt: float) -> void:
	_ambience(dt)
	var tense := 1.0 if state == "play" and (phase == "wait" or phase == "draw") else 0.0
	for s in seats:
		s.press_t = maxf(0.0, s.press_t - dt)
		s.btn_k = lerpf(s.btn_k, 1.0 if s.press_t > 0 else 0.0, U.damp(30, dt))
		s.button.position.y = BTN_Y - s.btn_k * 0.05
		_animate_gun(s, dt)
		if not s.alive:
			continue
		var sub: Subject = s.subject
		var p: Dictionary = sub.parts
		sub.animate(dt, 0)
		s.tense_k = lerpf(s.tense_k, tense, U.damp(6, dt))
		var target: float = ARM_SLAM if s.press_t > 0 else lerpf(ARM_REST, ARM_POISED, s.tense_k)
		s.arm_k = lerpf(s.arm_k, target, U.damp(40 if s.press_t > 0 else 10, dt))
		p.armR.rotation.x = s.arm_k
		p.torso.rotation.x = 0.04 + s.tense_k * 0.12
		if s.zap_t > 0:
			s.zap_t -= dt
			sub.root.rotation.z = sin(clock * 50) * 0.12 if s.zap_t > 0 else 0.0
			p.armL.rotation.x = -2.2
			p.head.rotation.x = sin(clock * 37) * 0.3
		elif s.gun.aiming:
			p.armL.rotation.x = -2.5   # futile shielding
			p.armL.rotation.z = 0.4
			p.torso.rotation.x = 0.3


## Guns idly sweep over the heads; the doomed get the laser, then the bullet.
func _animate_gun(s: Dictionary, dt: float) -> void:
	var g: Dictionary = s.gun
	var group: Node3D = g.group
	var pivot: Node3D = g.pivot
	g.recoil = maxf(0.0, g.recoil - dt * 4)
	g.barrel.position.z = 0.36 - g.recoil * 0.15
	var v: Vector3
	if s.alive:
		var head: Node3D = s.subject.parts.head
		v = head.global_position if head.is_inside_tree() else s.subject.root.position + Vector3(0, 1.6, 0)
		if not g.aiming:
			v.x += sin(clock * 0.7 + s.player.slot * 1.7) * 0.6
			v.y -= 0.4
	else:
		v = Vector3(group.position.x, 0.5, group.position.z + 1.5)
		g.aiming = false
	# THREE Object3D.lookAt: the gun's +Z turns toward v.
	var dir := v - group.position
	if dir.length() > 1e-5:
		var aim_q := Basis.looking_at(-dir.normalized(), Vector3.UP).get_rotation_quaternion()
		pivot.quaternion = pivot.quaternion.slerp(aim_q, 1.0 if g.aiming else U.damp(6, dt)).normalized()
	var laser: Node3D = g.laser
	laser.visible = g.aiming and s.alive
	if laser.visible:
		laser.scale = Vector3(1, 1, maxf(0.1, dir.length() - 0.1))
	Mats.set_color(g.eye_mat, 0xff2020 if g.aiming else 0x440000)


## Signal lamps + coloured flood light (cosmetic).
func _ambience(dt: float) -> void:
	signal_t += dt
	var col := 0x1c1c1a
	var li := 0.0
	var lc := 0xff2010
	match signal_mode:
		"wait":
			col = 0xff2a10
			li = 3 + sin(signal_t * 6) * 0.8
			lc = 0xff2a10
		"draw":
			col = 0x39ff5a
			li = 6 + 14 * exp(-signal_t * 4)
			lc = 0x39ff5a
		"fault":
			var on := fmod(signal_t * 8, 1.0) < 0.5
			col = 0xff2a10 if on else 0x2a0806
			li = 8.0 if on else 0.0
			lc = 0xff2010
	Mats.set_color(lamp_mat, col)
	signal_light.light_energy = li * Env.LIGHT_K
	signal_light.light_color = U.col(lc)


# ------------------------------------------------------------------- bots

func bot_think(seat: Dictionary, _dt: float) -> void:
	var b: Dictionary = seat.brain
	var m: Dictionary = b.memory
	if m.get("heat", -1) != heat:
		# Plan this heat: reaction time (better bots faster) and a rare jump start.
		m["heat"] = heat
		var d: float = b.difficulty
		var personal: float = b.reaction - (0.35 - d * 0.25)   # ±0.05 per-bot temperament
		var r: float = 0.44 - 0.2 * d + personal + (Rng.random() + Rng.random() - 1) * 0.08 * (1.2 - d)
		if Rng.random() < b.error * 0.3:
			r += Rng.rand(0.12, 0.45)   # blinked
		m["react"] = maxf(0.15, r)
		m["jump_frac"] = Rng.rand(0.3, 0.9) if Rng.random() < 0.012 + 0.06 * (1 - d) else null
	# Hold A from the planned moment until the game has registered the press
	# (heat_state leaves "steady"), then release. Written in tick N, the edge
	# shows up as ctrl.a_pressed in tick N+1; holding also survives any missed
	# commit. Released at all other times so the next press is a fresh edge.
	var steady: bool = seat.heat_state == "steady"
	var press := false
	if steady and phase == "wait" and m.jump_frac != null and phase_t >= wait_dur * m.jump_frac:
		press = true
	elif steady and phase == "draw" and phase_t >= m.react:
		press = true
	seat.ctrl.set_buttons(press, false)


func dispose() -> void:
	exec_queue = []
	super.dispose()

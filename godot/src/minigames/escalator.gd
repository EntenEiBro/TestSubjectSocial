extends Minigame
## DOWN ESCALATOR — climb a down-running escalator one correct arrow at a time.
##
## Rules
##  - Every subject has their own steep escalator lane that runs DOWN into a
##    toothed crusher. Everyone starts halfway up (step 20 of 40).
##  - The CRT above each lane shows the next required direction (big) and the
##    two after it (small). The correct direction climbs one step.
##  - A wrong direction is a stumble: −2 steps and a 0.4 s stun.
##  - The drag speeds up over time; after 45 s it goes into overdrive.
##  - Reach the top to escape (finish order is recorded). Reach the bottom
##    and the crusher has you.
##  - Placement: escapees in order, then anyone still on (by height), then
##    the dead (last to die places highest).
##
## Models (blender/props/escalator.py): lane (truss, balustrades, handrails,
## comb plate), roller (+ teeth). Steps, skirt lights, CRTs and the pit are procedural.

const META := {
	"id": "escalator",
	"title": "DOWN ESCALATOR",
	"tagline": "The only way out is up. The machine disagrees.",
	"category": "Reflex",
	"controls": [{"input": "move", "label": "Press the shown arrow"}],
	"objective": "Climb to the top of your down-running escalator before it feeds you to the crusher.",
	"rules": [
		"Press the direction on your monitor to climb one step.",
		"Wrong direction: you stumble down two steps.",
		"The escalator keeps speeding up. The bottom has teeth.",
		"First to the top places highest.",
	],
}

const TOP := 40                 # steps to escape
const START := 20               # everyone starts in the middle
const ANGLE := 0.6              # incline (radians, ≈34°)
const LEN := 12.0               # visual incline length (world units)
const Y0 := 0.5                 # bottom of the incline
const Z0 := 3.0
const STEP_COUNT := 34          # visible steps per lane
const STEP_W := 1.3
const STUN := 0.4
const OVERDRIVE := 45.0         # seconds until the drag ramps hard
const HARD_CAP := 75.0          # absolute safety end
const DIRS := ["up", "down", "left", "right"]
const SIN := sin(ANGLE)
const COS := cos(ANGLE)

var spacing := 2.6
var top_y := 0.0
var top_z := 0.0
var step_geo: Mesh
var step_h := 0.0
var step_mat: StandardMaterial3D
var tooth_mat: StandardMaterial3D
var lanes := []
var seq := []
var phase := 0.0               # shared step scroll offset
var finish_order := []
var overdrive_announced := false
var pit_light: OmniLight3D


## Drag rate in steps per second at round time t.
static func drag_at(t: float) -> float:
	return 0.9 + 0.035 * t + (0.5 * (t - OVERDRIVE) if t > OVERDRIVE else 0.0)


func build() -> void:
	var n := seats.size()
	spacing = 4.0 if n <= 2 else (3.1 if n == 3 else 2.6)
	var width := n * spacing
	make_scene({"fog_near": 20.0, "fog_far": 55.0, "ambient_intensity": 1.0})
	var cam_z := 12.5 + maxf(0.0, width - 10.4) * 0.6
	make_camera([0, 4.0, cam_z + 1.2], [0, 3.5, -2], 50)
	scene.add_child(Env.dir_light(0xcfd4d8, 0.8, Vector3(0, 5, 14), Vector3.ZERO))

	_build_shaft(width)
	step_h = (LEN / STEP_COUNT) * SIN + 0.15
	step_geo = Geo.box(STEP_W, step_h, (LEN / STEP_COUNT) * COS + 0.01)
	step_mat = Mats.mat(0xffffff, Tex.canvas("esc-step", 32, _paint_step))
	tooth_mat = Mats.mat(0xd8d4c8, Tex.metal(), {"emissive": 0x3a0800})
	for i in n:
		lanes.append(_build_lane(seats[i], (i - (n - 1) / 2.0) * spacing))


# ------------------------------------------------------------------ stage

func _build_shaft(width: float) -> void:
	Env.floor_plane(scene, width + 20, 30, {"tex": "concrete", "tile": 3.0, "z": 0.0})
	top_y = Y0 + LEN * SIN
	top_z = Z0 - LEN * COS
	# Back wall and upper landing.
	Env.block(scene, 0, 8, top_z - 3.4, width + 20, 16, 0.4, Mats.mat(0xffffff, Tex.wall(Vector2((width + 20) / 4, 4))))
	Env.block(scene, 0, top_y / 2, top_z - 1.6, width + 3, top_y, 3.2, Mats.mat(0x2e2f2c, Tex.plate(Vector2(4, 2))))
	var landing := Env.mesh(Geo.plane(width + 3, 3.2), Mats.mat(0xffffff, Tex.plate(Vector2((width + 3) / 1.5, 2))), 0, top_y + 0.01, top_z - 1.6, {"cast": false})
	landing.rotation.x = -PI / 2
	scene.add_child(landing)
	Env.stencil(scene, "KEEP CLIMBING", 0, top_y + 4.9, top_z - 3.15, {"w": 8.0, "h": 2.4, "opacity": 0.55})
	# Glowing EXIT sign.
	var exit_tex := Tex.text("EXIT", {"w": 128, "h": 48, "size": 40, "color": "#47ff6a", "bg": "#06200a", "grimy": false})
	scene.add_child(Env.mesh(Geo.plane(1.6, 0.6), Mats.glow(0xffffff, {"tex": exit_tex}), 0, top_y + 2.6, top_z - 3.1, {"cast": false}))
	var exit_light := Env.point_light(0x47ff6a, 4, 6, 1.5)
	exit_light.position = Vector3(0, top_y + 2.4, top_z - 2.4)
	scene.add_child(exit_light)
	# Crusher pit housing across all lanes.
	Env.block(scene, 0, 0.06, Z0 + 1.5, width + 1, 0.12, 0.15, Mats.mat(0x2a2a27, Tex.metal()))
	var pit := Env.mesh(Geo.plane(width + 1, 1.4), Mats.glow(0x1a0503), 0, 0.005, Z0 + 0.8, {"cast": false})
	pit.rotation.x = -PI / 2
	scene.add_child(pit)
	Env.hazard_strip(scene, 0, Z0 + 2.0, width + 1, 0.6, 0.012)
	Env.stencil(scene, "MIND THE TEETH", 0, 0.02, Z0 + 2.9, {"w": 5.0, "h": 1.2, "opacity": 0.4}).rotation.x = -PI / 2
	pit_light = Env.point_light(0xff2a1a, 5, 6, 1.4)
	pit_light.position = Vector3(0, 0.3, Z0 + 1.3)
	scene.add_child(pit_light)
	# Overhead lamps along the incline.
	Env.hanging_lamp(scene, -width / 4, 10.5, -1.5, {"intensity": 70.0, "angle": 0.9, "target": Vector3(-width / 4, 3, -1.5)})
	Env.hanging_lamp(scene, width / 4, 10.5, -1.5, {"intensity": 70.0, "angle": 0.9, "target": Vector3(width / 4, 3, -1.5)})


## One escalator: truss, balustrades, rails, moving steps, crusher, CRT.
func _build_lane(seat: Dictionary, x: float) -> Dictionary:
	var lane := {"seat": seat, "x": x, "steps": [], "rollers": []}
	seat["lane"] = lane
	seat["p"] = float(START)
	seat["disp_p"] = float(START)
	seat["idx"] = 0
	seat["stun"] = 0.0
	seat["streak"] = 0
	seat["missteps"] = 0
	seat["finished"] = false
	seat["dying"] = 0.0
	seat["climb_t"] = 0.0
	seat["flash"] = 0.0
	seat["ok_flash"] = 0.0
	seat["walk_off"] = 0.0
	seat["dying_from"] = Vector3.ZERO

	# Truss, balustrades, handrails and comb plate: Blender model.
	var body := Props.make("escalator", "lane")
	body.position = Vector3(x, 0, 0)
	scene.add_child(body)
	# Coloured skirt lights along both sides of the steps.
	var skirt_mat := Mats.glow(seat.player.color)
	lane["skirt_mat"] = skirt_mat
	for side in [-1, 1]:
		var up := 0.05
		var s := LEN / 2
		var m := Env.mesh(Geo.box(0.03, 0.04, LEN), skirt_mat, x + side * (STEP_W / 2 + 0.01), Y0 + s * SIN + up * COS, Z0 - s * COS + up * SIN)
		m.rotation.x = ANGLE
		scene.add_child(m)
	# Moving steps.
	for i in STEP_COUNT:
		var st := Env.mesh(step_geo, step_mat)
		scene.add_child(st)
		lane.steps.append(st)
	# Crusher: two counter-rotating toothed rollers.
	for rd in [[Z0 + 0.55, 1.0], [Z0 + 1.05, -1.0]]:
		var g := Props.make("escalator", "roller")
		var teeth := g.find_child("teeth", true, false) as MeshInstance3D
		if teeth:
			teeth.material_override = tooth_mat   # emissive teeth (Mats.mat with emissive)
		g.position = Vector3(x, 0.32, rd[0])
		scene.add_child(g)
		lane.rollers.append({"g": g, "dir": rd[1]})
	# Monitor above the top of the lane.
	lane["crt"] = Env.monitor(scene, x, top_y + 3.25, top_z - 0.6, {"w": minf(1.9, spacing * 0.72), "h": minf(1.4, spacing * 0.53), "rot_x": 0.22})
	lane["draw_key"] = ""
	lane["draw_t"] = 0.0

	spawn_subject(seat, {"x": x, "y": Y0, "z": Z0, "facing": PI})
	_place_subject(seat, 1)
	return lane


## Arrow at sequence index i (extended lazily, shared by everyone for fairness).
func arrow(i: int) -> String:
	while seq.size() <= i:
		var n := seq.size()
		var d: String = Rng.pick(DIRS)
		if n >= 2 and seq[n - 1] == d and seq[n - 2] == d:
			d = Rng.pick(DIRS.filter(func(x): return x != d))
		seq.append(d)
	return seq[i]


# -------------------------------------------------------------- animation

func _scroll_steps(dt: float, rate: float) -> void:
	var d := LEN / STEP_COUNT
	phase = fmod(fmod(phase - rate * (LEN / TOP) * dt, d) + d, d)
	for lane in lanes:
		var steps: Array = lane.steps
		for i in steps.size():
			var s := i * d + phase
			var ty := Y0 + (s + d) * SIN
			steps[i].position = Vector3(lane.x, ty - step_h / 2, Z0 - (s + d / 2) * COS)
		for r in lane.rollers:
			r.g.rotation.x = wrapf(r.g.rotation.x + r.dir * dt * (3 + rate * 2), -PI, PI)
	pit_light.light_energy = (4 + sin(clock * 9) * 1.5) * Env.LIGHT_K


## Put a subject on the incline at its displayed height.
func _place_subject(seat: Dictionary, k: float) -> void:
	var s: Subject = seat.subject
	seat.disp_p = lerpf(seat.disp_p, seat.p, k)
	var along: float = clampf(seat.disp_p / TOP, 0, 1) * LEN + seat.walk_off
	var on_landing := along > LEN
	var y := top_y if on_landing else Y0 + along * SIN + 0.05
	s.root.position = Vector3(seat.lane.x, y, Z0 - along * COS)


func _animate_subjects(dt: float) -> void:
	for seat in seats:
		if not seat.alive:
			continue
		var s: Subject = seat.subject
		var p: Dictionary = s.parts
		if seat.dying > 0:
			continue
		seat.climb_t = maxf(0.0, seat.climb_t - dt)
		if seat.finished:
			if seat.walk_off < 1.3:
				seat.walk_off = minf(1.3, seat.walk_off + dt * 2.5)
				s.animate(dt, 3)
			else:
				s.face_angle(0, dt, 6)
				s.pose = "armsUp"
				s.animate(dt, 0)
			_place_subject(seat, 1)
			continue
		s.animate(dt, 6.0 if seat.climb_t > 0 else 0.0)
		if seat.stun > 0:
			p.torso.rotation.x = -0.35
			p.armL.rotation.x = -2.4 + sin(clock * 40) * 0.5
			p.armR.rotation.x = -2.4 - sin(clock * 40) * 0.5
		elif seat.climb_t <= 0:
			# Hands on the rails.
			p.armL.rotation.z = lerpf(p.armL.rotation.z, 0.35, U.damp(10, dt))
			p.armR.rotation.z = lerpf(p.armR.rotation.z, -0.35, U.damp(10, dt))
		_place_subject(seat, U.damp(16, dt))


func _finish_index(seat: Dictionary) -> int:
	for i in finish_order.size():
		if is_same(finish_order[i], seat):
			return i
	return -1


## Redraw a lane monitor (throttled; immediate on events).
func _draw_monitor(lane: Dictionary, dt: float, force: bool = false) -> void:
	var seat: Dictionary = lane.seat
	lane.draw_t -= dt
	var flash: bool = seat.flash > 0
	var ok: bool = seat.ok_flash > 0
	var key := "%d|%s|%s|%s|%s|%s" % [seat.idx, flash, ok, seat.finished, seat.alive, seat.stun > 0]
	if not force and key == lane.draw_key and lane.draw_t > 0:
		return
	lane.draw_key = key
	lane.draw_t = 0.08
	var col := U.col(seat.player.color)
	var label := "P%d" % (seat.player.slot + 1)
	var alive: bool = seat.alive
	var finished: bool = seat.finished
	var place := _finish_index(seat) + 1
	var arrows := []
	if alive and not finished:
		arrows = [arrow(seat.idx), arrow(seat.idx + 1), arrow(seat.idx + 2)]
	var frac := clampf(seat.p / TOP, 0, 1)
	var font := UI.font("vt")
	var screen: ScreenCanvas = lane.crt.screen
	screen.draw(func(ci: CanvasItem, w: float, h: float):
		if flash:
			ci.draw_rect(Rect2(0, 0, w, h), Color("#3a0505"))
		ci.draw_rect(Rect2(2, 2, w - 4, h - 4), col, false, 4.0)
		ci.draw_string(font, Vector2(7, 6 + 12), label, HORIZONTAL_ALIGNMENT_LEFT, -1, 15, col)
		if not alive:
			_draw_glyph_x(ci, w / 2, h / 2, 26, Color("#ff3a2a"))
			return
		if finished:
			var g := Color("#47ff6a")
			ci.draw_string(font, Vector2(w / 2 - 6 - 60, h / 2 - 8 + 9), "EXIT", HORIZONTAL_ALIGNMENT_CENTER, 120, 30, g)
			ci.draw_string(font, Vector2(w / 2 - 6 - 60, h / 2 + 14 + 6), "#%d" % place, HORIZONTAL_ALIGNMENT_CENTER, 120, 18, g)
		else:
			var main := Color("#ff4a3a") if flash else (Color("#c8ffd0") if ok else Color("#47ff6a"))
			_draw_arrow(ci, arrows[0], 50, 52, 30, main)
			_draw_arrow(ci, arrows[1], 100, 32, 11, Color(71 / 255.0, 1.0, 106 / 255.0, 0.6))
			_draw_arrow(ci, arrows[2], 100, 66, 9, Color(71 / 255.0, 1.0, 106 / 255.0, 0.35))
		# Height gauge.
		ci.draw_rect(Rect2(w - 12, 10, 5, h - 20), Color("#0d2a10"))
		var gh := (h - 20) * frac
		ci.draw_rect(Rect2(w - 12, 10 + (h - 20) - gh, 5, gh), Color("#ff4a3a") if frac < 0.2 else Color("#47ff6a")))


# ------------------------------------------------------------------ flow

func preview(dt: float) -> void:
	_scroll_steps(dt, drag_at(0))
	_animate_subjects(dt)
	for lane in lanes:
		_draw_monitor(lane, dt)


func update(dt: float) -> void:
	var playing := state == "play"
	var rate := drag_at(time) if playing else drag_at(minf(time, OVERDRIVE)) * 0.5
	_scroll_steps(dt, rate)

	if playing:
		for seat in seats:
			_update_seat(seat, dt, rate)
		if not overdrive_announced and time >= OVERDRIVE:
			overdrive_announced = true
			hud.banner("OVERDRIVE", 1500, "danger")
			Sfx.play("horn")
		hud.set_timer(maxf(0.0, OVERDRIVE - time))
		var active := seats.filter(func(s): return s.alive and not s.finished)
		if active.is_empty() or time >= HARD_CAP:
			end(2.4)
	_animate_subjects(dt)
	for lane in lanes:
		_draw_monitor(lane, dt)
	for seat in seats:
		var stat: String
		if not seat.alive:
			stat = "MULCHED"
		elif seat.finished:
			stat = "ESCAPED #%d" % (_finish_index(seat) + 1)
		else:
			stat = "STEP %d/%d · x%d" % [maxi(0, int(floor(seat.p))), TOP, seat.streak]
		hud.set_stat(seat, stat)
		hud.set_status(seat, "STUMBLE!" if seat.alive and not seat.finished and seat.stun > 0 else "")


func _update_seat(seat: Dictionary, dt: float, rate: float) -> void:
	if not seat.alive:
		return
	seat.flash = maxf(0.0, seat.flash - dt)
	seat.ok_flash = maxf(0.0, seat.ok_flash - dt)
	if seat.finished:
		return
	if seat.dying > 0:
		_update_dying(seat, dt)
		return

	seat.stun = maxf(0.0, seat.stun - dt)
	var dir: String = seat.ctrl.dir_pressed
	if dir != "" and seat.stun <= 0:
		if dir == arrow(seat.idx):
			seat.p += 1
			seat.idx += 1
			seat.streak += 1
			seat.climb_t = 0.2
			seat.ok_flash = 0.08
			Sfx.play("step", {"vol": 1.4})
			if seat.streak % 10 == 0:
				Sfx.play("tick")
		else:
			seat.p -= 2
			seat.stun = STUN
			seat.streak = 0
			seat.missteps += 1
			seat.flash = 0.4
			Sfx.play("wrong", {"vol": 0.7})
			Haptics.for_player(seat.player, "error")
		_draw_monitor(seat.lane, 0, true)
	seat.p -= rate * dt

	if seat.p >= TOP:
		seat.p = float(TOP)
		seat.finished = true
		finish_order.append(seat)
		if seat.missteps == 0:
			award(seat, "expressLane")
		Sfx.play("ding")
		hud.feed("%s — ESCAPED #%d" % [seat.player.name(), finish_order.size()], seat.player.color)
		_draw_monitor(seat.lane, 0, true)
	elif seat.p <= 0:
		seat.p = 0.0
		seat.dying = 0.45
		seat.dying_from = seat.subject.root.position
		Sfx.play("grind")


## Dragged through the comb into the rollers, then mulched.
func _update_dying(seat: Dictionary, dt: float) -> void:
	seat.dying -= dt
	var k := 1.0 - maxf(0.0, seat.dying) / 0.45
	var root: Node3D = seat.subject.root
	root.position = (seat.dying_from as Vector3).lerp(Vector3(seat.lane.x, -0.4, Z0 + 0.8), k * k)
	U.set_rot(root, -0.9 * k, PI, 0)   # THREE's XYZ order: pitch forward after facing up the slope
	seat.subject.pose = "armsUp"
	seat.subject.animate(dt, 0)
	if Rng.random() < 0.5:
		fx.sparks(Vector3(seat.lane.x + Rng.rand(-0.5, 0.5), 0.5, Z0 + 0.8), {"count": 3})
	if seat.dying <= 0:
		kill(seat, "gib", {"dir": Vector3(0, 0, 1), "force": 1.1})
		fx.sparks(Vector3(seat.lane.x, 0.5, Z0 + 0.8), {"count": 20, "speed": 8.0})
		Sfx.play("crunch")
		engine.shake(0.4)
		_draw_monitor(seat.lane, 0, true)


## Escapees in order, survivors by height, then the dead (last death highest).
func placement() -> Array:
	var tiers := []
	for s in finish_order:
		tiers.append([s])
	var on := seats.filter(func(s): return s.alive and not s.finished)
	on.sort_custom(func(a, b): return a.p > b.p)
	tiers.append_array(Minigame.group_by(on, func(s): return int(floor(s.p))))
	var dead := deaths.duplicate()
	dead.reverse()
	for s in dead:
		tiers.append([s])
	return tiers


# ------------------------------------------------------------------- bots

func bot_think(seat: Dictionary, _dt: float) -> void:
	var b: Dictionary = seat.brain
	var m: Dictionary = b.memory
	if seat.finished or seat.dying > 0 or seat.stun > 0:
		m["next"] = time + b.reaction
		return
	if not m.has("next"):
		m["next"] = time + b.reaction + Rng.rand(0, 0.2)
	if time < m.next:
		return
	var interval := lerpf(0.6, 0.28, b.difficulty)
	m["next"] = time + interval * Rng.rand(0.85, 1.2)
	var want := arrow(seat.idx)
	var slip: bool = Rng.random() < b.error * 0.5
	seat.ctrl.tap_dir(Rng.pick(DIRS.filter(func(d): return d != want)) if slip else want)


func dispose() -> void:
	for lane in lanes:
		lane.seat = null   # break the seat <-> lane reference cycle
	for seat in seats:
		seat.lane = null
	finish_order.clear()
	super.dispose()


# ======================================================================
# Procedural assets
# ======================================================================

## Grooved aluminium step with a yellow safety edge (cached).
static func _paint_step(ci: CanvasItem, s: float) -> void:
	ci.draw_rect(Rect2(0, 0, s, s), Color("#6f726e"))
	var x := 1.0
	while x < s:
		ci.draw_rect(Rect2(x, 0, 1, s), Color("#3c3e3b"))
		x += 3.0
	var yellow := Color("#c9a227")
	ci.draw_rect(Rect2(0, 0, s, 4), yellow)
	ci.draw_rect(Rect2(0, 0, 3, s), yellow)
	ci.draw_rect(Rect2(s - 3, 0, 3, s), yellow)
	for i in 20:
		ci.draw_rect(Rect2(randf() * s, randf() * s, 2, 1), Color(0, 0, 0, 0.25))


## Chunky arrow glyph pointing in `dir`.
static func _draw_arrow(ci: CanvasItem, dir: String, cx: float, cy: float, r: float, color: Color) -> void:
	var rot: float = {"up": 0.0, "right": PI / 2, "down": PI, "left": -PI / 2}[dir]
	var pts := [Vector2(0, -r), Vector2(r * 0.9, -r * 0.05), Vector2(r * 0.38, -r * 0.05), Vector2(r * 0.38, r),
		Vector2(-r * 0.38, r), Vector2(-r * 0.38, -r * 0.05), Vector2(-r * 0.9, -r * 0.05)]
	var out := PackedVector2Array()
	for p in pts:
		out.append(Vector2(cx, cy) + (p as Vector2).rotated(rot))
	ci.draw_colored_polygon(out, color)


static func _draw_glyph_x(ci: CanvasItem, cx: float, cy: float, r: float, color: Color) -> void:
	ci.draw_line(Vector2(cx - r, cy - r), Vector2(cx + r, cy + r), color, 7.0)
	ci.draw_line(Vector2(cx + r, cy - r), Vector2(cx - r, cy + r), color, 7.0)

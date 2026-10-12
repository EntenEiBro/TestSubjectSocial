extends Minigame
## WINCH RACE — a tall service shaft, one lift platform per subject, a meat
## grinder coming up from below.
##
## Rules
##  - Every subject stands on their own platform (lanes side by side, seen
##    from the front). Alternate A and B (A, B, A, B…) to crank the winch:
##    each clean alternation lifts the platform LIFT metres.
##  - Pressing the same button twice in a row (or both at once) slips the
##    ratchet: the platform drops SLIP_DROP and the crank is jammed for
##    SLIP_STUN seconds (presses are ignored meanwhile).
##  - The winch has a top speed (CLIMB_SPEED). Cranks are queued (at most
##    two turns); mashing faster than the winch turns is wasted.
##  - The grinder rises from below and keeps speeding up. If its teeth reach
##    your platform you are minced ('gib').
##  - The first platform to reach the hatch at TOP (20 m) escapes; the round
##    ends when everyone has escaped or died (the grinder guarantees this in
##    under 30 s), with a 60 s safety cap.
##  - Ranking: escapees in order, then survivors by height (cap only), then
##    the dead in reverse death order.
## Platform, crank, hatch and grinder roller models: blender/props/winch.py.

const META := {
	"id": "winch",
	"title": "WINCH RACE",
	"tagline": "Upward mobility, powered by you.",
	"category": "Timing",
	"controls": [{"input": "a", "label": "Crank"}, {"input": "b", "label": "Crank"}],
	"objective": "Crank your lift to the hatch before the grinder catches up.",
	"rules": [
		"Alternate {A} and {B} to crank your winch. Every clean turn lifts your platform.",
		"Pressing the same button twice slips the ratchet: you drop and stall for a moment.",
		"The winch has a top speed. Mashing faster than it turns is wasted effort.",
		"The grinder below rises faster and faster. First through the hatch wins.",
	],
}

const LANE_W := 2.4            # lane width (x)
const DECK_W := LANE_W - 0.35  # platform width
const TOP := 20.0              # hatch height (platform deck)
const CEIL := TOP + 2.4        # underside of the ceiling
const LIFT := 0.125            # metres per clean crank
const CLIMB_SPEED := 1.25      # max platform speed → caps the useful crank rate at 10/s
const QUEUE_MAX := LIFT * 2    # cranks buffered beyond this are wasted
const SLIP_DROP := 0.25
const SLIP_STUN := 0.4
const G_START := -5.0          # grinder teeth height at GO
const G_SPEED := 0.45          # initial rise speed (m/s)
const G_ACCEL := 0.032         # speed gain per second
const G_MAX := TOP - 0.1       # grinder stops just under the hatch level
const KILL_MARGIN := 0.2       # teeth this close below the deck = minced
const WARN_GAP := 2.5          # HUD / lamp warning distance
const ACCEL_AT := 14.0         # "grinder accelerating" banner
const CAP := 60.0              # safety cap
const CRANK_X := 0.66          # winch post offset on the platform

var W := 0.0
var grinder_y := G_START
var g_speed := G_SPEED
var finish_count := 0
var first_out := false
var accel_warned := false
var grind_t := 0.0
var cam_y := 0.0
var cam_d := 12.0
var spot: SpotLight3D
var spot_target := Vector3.ZERO
var rollers := []
var beacon_mat: StandardMaterial3D
var g_light: OmniLight3D
var grinder: Node3D
var _prompt_t := -1.0          # JS: setTimeout(() => hud.prompt(null), 5000)


func build() -> void:
	var n := seats.size()
	W = n * LANE_W
	grinder_y = G_START
	g_speed = G_SPEED
	finish_count = 0
	first_out = false
	accel_warned = false
	grind_t = 0.0
	cam_y = 0.0
	cam_d = 12.0

	# Debris and blood settle on the grinder housing (and fall away elsewhere).
	make_scene({
		"fog_near": 22.0, "fog_far": 64.0, "ambient": 0x34363c,
		"floor_at": func(x, z): return grinder_y - 0.45 if absf(x) < W / 2 + 0.1 and z > -1.45 and z < 0.95 else -INF,
	})
	make_camera([0, 0, 12], [0, -1, 0], 50)

	# --- the shaft: back wall, side columns, lane dividers
	scene.add_child(Env.mesh(Geo.plane(W + 14, 46), Mats.mat(0xffffff, Tex.wall(Vector2((W + 14) / 4, 46 / 4.0))), 0, 6, -1.55, {"cast": false}))
	var col_mat := Mats.mat(0xffffff, Tex.concrete(Vector2(1, 10)))
	for s in [-1.0, 1.0]:
		Env.block(scene, s * (W / 2 + 0.55), 5, -0.5, 0.9, 44, 2.1, col_mat)
		Env.pipe(scene, [s * (W / 2 + 1.35), -17, -1.2], [s * (W / 2 + 1.35), 27, -1.2], 0.14, 0x5a3022)
	var beam_mat := Mats.mat(0x6b6158, Tex.metal())
	for i in range(1, n):
		Env.block(scene, -W / 2 + i * LANE_W, 5, -0.9, 0.14, 44, 1.2, beam_mat)
	# Amber cage bulbs up the shaft edges (no lights, just glow).
	var bulb_geo := Geo.sphere(0.07, 6, 4)
	var bulb_mat := Mats.glow(0xffb040)
	for i in n + 1:
		var x := -W / 2 + i * LANE_W + (-0.1 if i == 0 else (0.1 if i == n else 0.0))
		var y := -4.0
		while y <= TOP + 1:
			scene.add_child(Env.mesh(bulb_geo, bulb_mat, x, y, -0.25, {"cast": false}))
			y += 4
	# Height markers + wall stencils.
	var line_mat := Mats.mat(0xffffff, Tex.hazard(Vector2(W / 1.5, 1)))
	for m in [5, 10, 15]:
		Env.stencil(scene, "%dM" % m, -W / 2 - 2.3, m + 0.35, -1.5, {"w": 1.6, "h": 0.6, "opacity": 0.6})
		scene.add_child(Env.mesh(Geo.plane(W, 0.07), line_mat, 0, m, -1.53, {"cast": false}))
	Env.stencil(scene, "KEEP CRANKING", 0, 8.5, -1.52, {"w": 7.0, "h": 2.4, "opacity": 0.22})
	Env.stencil(scene, "NO WAY DOWN", 0, -2.4, -1.52, {"w": 5.0, "h": 1.6, "opacity": 0.35})

	# --- ceiling with one hatch per lane
	Env.block(scene, 0, CEIL + 0.35, -0.2, W + 2.2, 0.7, 2.8, Mats.mat(0xffffff, Tex.plate(Vector2(W / 2, 1))))
	scene.add_child(Env.mesh(Geo.plane(W + 2.2, 0.18), Mats.mat(0xffffff, Tex.hazard(Vector2((W + 2.2) / 1.5, 1))), 0, CEIL + 0.09, 1.205, {"cast": false}))
	Env.stencil(scene, "HATCH 20M", 0, CEIL + 0.45, 1.21, {"w": 3.2, "h": 0.5, "color": "#9dffa0", "opacity": 0.8})
	Env.hanging_lamp(scene, -W / 2 - 0.55, CEIL - 0.7, 1.5, {"intensity": 45.0, "angle": 1.0, "shadow": false, "target": Vector3(0, TOP - 2, -1)})

	# --- follow spot (the only shadow caster), moved with the camera
	spot = Env.spot_light(0xffe2b0, 150, 40, 0.8, 0.6, 1.4)
	spot.shadow_enabled = Env.shadows_enabled
	spot.shadow_bias = 0.05
	scene.add_child(spot)

	_build_grinder(scene, W)

	# --- lanes: platform, winch, cable, hatch
	var edge_geo := Geo.plane(DECK_W, 0.14)
	var lamp_geo := Geo.box(0.16, 0.08, 0.06)
	var stripe_geo := Geo.box(DECK_W, 0.02, 0.07)
	var cable_geo := Geo.cyl(0.022, 0.022, 1, 4)
	var hole_geo := Geo.plane(1.3, 1.1)
	var exit_geo := Geo.box(0.3, 0.08, 0.08)
	var haz_mat := Mats.mat(0xffffff, Tex.hazard(Vector2(2, 1)))
	var cable_mat := Mats.mat(0x2a2a28)
	var hole_mat := Mats.glow(0x050505)
	for i in n:
		var seat: Dictionary = seats[i]
		var x := (i - (n - 1) / 2.0) * LANE_W
		var g := Node3D.new()
		g.position = Vector3(x, 0, 0)
		# Blender: deck, frame, guard rail, winch post + drum and the crank (child).
		var platform := Props.make("winch", "platform")
		g.add_child(platform)
		g.add_child(Env.mesh(edge_geo, haz_mat, 0, -0.08, 0.752, {"cast": false}))
		g.add_child(Env.mesh(stripe_geo, Mats.glow(seat.player.color), 0, 0.005, 0.69, {"cast": false}))
		var crank: Node3D = Subject._find(platform, "crank")
		var warn_mat := Mats.glow(0x401008)
		g.add_child(Env.mesh(lamp_geo, warn_mat, -DECK_W / 2 + 0.15, -0.08, 0.78, {"cast": false}))
		scene.add_child(g)

		var cable := Env.mesh(cable_geo, cable_mat, x + CRANK_X, 10, 0.12, {"cast": false})
		scene.add_child(cable)

		# Hatch: dark hole in the ceiling + hazard door hinged on its left edge.
		var hole := Env.mesh(hole_geo, hole_mat, x, CEIL - 0.005, 0, {"cast": false})
		hole.rotation.x = PI / 2
		scene.add_child(hole)
		var hatch := Props.make("winch", "hatch")
		hatch.position = Vector3(x - 0.65, CEIL - 0.02, 0)
		scene.add_child(hatch)
		var exit_mat := Mats.glow(0x7a5a10)
		scene.add_child(Env.mesh(exit_geo, exit_mat, x, CEIL - 0.06, 0.75, {"cast": false}))

		var lane := {"i": i, "x": x, "group": g, "crank": crank, "crank_angle": 0.0, "crank_target": 0.0, "cable": cable,
			"warn_mat": warn_mat, "exit_mat": exit_mat, "hatch": hatch, "hatch_open": 0.0, "dead": false}
		spawn_subject(seat, {"x": x - 0.1, "y": 0.0, "z": 0.05})
		seat.subject.root.rotation.y = 0.3   # half-turned toward the crank
		seat["lane"] = lane
		seat["h"] = 0.0
		seat["queue"] = 0.0
		seat["last"] = ""
		seat["stun"] = 0.0
		seat["finished"] = false
		seat["finish_rank"] = 0
		seat["finish_time"] = 0.0
		seat["exit_t"] = 0.0
		seat["cranks"] = 0
		seat["slips"] = 0

	_animate_machines(0, false)
	_update_camera(0, true)


## The grinder: a rusted housing filling the shaft, two counter-rotating cutter rollers on top.
func _build_grinder(scn: Node3D, w: float) -> void:
	var g := Node3D.new()
	g.add_child(Env.mesh(Geo.box(w + 0.2, 24, 2.4), Mats.mat(0xffffff, Tex.rust(Vector2(w / 2, 10))), 0, -0.45 - 12, -0.25))
	g.add_child(Env.mesh(Geo.plane(w + 0.2, 0.5), Mats.mat(0xffffff, Tex.hazard(Vector2((w + 0.2) / 1.5, 1))), 0, -0.75, 0.955, {"cast": false}))
	Env.stencil(g, "GRINDER", 0, -2.0, 0.96, {"w": 3.6, "h": 1.2, "opacity": 0.55, "color": "#d8c8a0"})
	rollers = []
	# Each roller = one Blender segment per lane (core, paddles, two cutter discs).
	for spec in [[-0.4, "roller_a"], [0.45, "roller_b"]]:
		var r := Node3D.new()
		r.position = Vector3(0, -0.55, spec[0])
		for i in seats.size():
			var lx := (i - (seats.size() - 1) / 2.0) * LANE_W
			var seg := Props.make("winch", spec[1])
			seg.position.x = lx
			r.add_child(seg)
		g.add_child(r)
		rollers.append(r)
	beacon_mat = Mats.glow(0xff2a10)
	for s in [-1.0, 1.0]:
		g.add_child(Env.mesh(Geo.box(0.22, 0.22, 0.22), beacon_mat, s * (w / 2 - 0.25), -0.75, 1.05, {"cast": false}))
	g_light = Env.point_light(0xff3010, 14, 9, 1.6)
	g_light.position = Vector3(0, 0.4, 1.4)
	g.add_child(g_light)
	scn.add_child(g)
	grinder = g


# -------------------------------------------------------------- lifecycle

func start() -> void:
	hud.banner("CRANK!", 900)
	hud.prompt("Alternate {A} and {B} to crank · same button twice slips")
	_prompt_t = 5.0
	Sfx.play("grind", {"vol": 0.6})


func preview(dt: float) -> void:
	_animate_machines(dt, false)
	_animate_subjects(dt)
	_update_camera(dt)


func update(dt: float) -> void:
	var playing := state == "play"
	if _prompt_t > 0.0:
		_prompt_t -= dt
		if _prompt_t <= 0.0 and playing:
			hud.prompt("")
	if playing:
		_simulate(dt)
	_animate_machines(dt, playing)
	_animate_subjects(dt)
	_update_camera(dt)
	if not playing:
		return
	_update_hud()
	_check_end()


# -------------------------------------------------------------- mechanics

func _simulate(dt: float) -> void:
	g_speed = G_SPEED + G_ACCEL * time
	grinder_y = minf(G_MAX, grinder_y + g_speed * dt)
	if not accel_warned and time >= ACCEL_AT:
		accel_warned = true
		hud.banner("GRINDER ACCELERATING", 1600, "danger")
		Sfx.play("horn", {"vol": 0.6})

	# Everyone who reaches the hatch on the same tick shares the rank.
	var rank_now := finish_count + 1
	var newly := 0
	var min_gap := INF
	for seat in seats:
		if not seat.alive or seat.finished:
			continue
		seat.stun = maxf(0.0, seat.stun - dt)
		if seat.stun <= 0:
			_read_crank(seat)
		var move := minf(seat.queue, CLIMB_SPEED * dt)
		seat.h += move
		seat.queue -= move
		if seat.h >= TOP:
			seat.h = TOP
			_finish(seat, rank_now)
			newly += 1
			continue
		if grinder_y > seat.h - KILL_MARGIN:
			_mince(seat)
			continue
		min_gap = minf(min_gap, seat.h - grinder_y)
	finish_count += newly

	# Grinding noise, louder as it closes in on the lowest subject.
	grind_t -= dt
	if grind_t <= 0:
		grind_t = 0.55
		Sfx.play("grind", {"vol": clampf(1 - min_gap / 8, 0.12, 0.8) if not is_inf(min_gap) else 0.12})


## Read this tick's button edges: alternate = lift, repeat / both = slip.
func _read_crank(seat: Dictionary) -> void:
	var c: Controller = seat.ctrl
	var a := c.a_pressed
	var b := c.b_pressed
	if not a and not b:
		return
	if a and b:
		_slip(seat)
		return
	var btn := "a" if a else "b"
	if btn == seat.last:
		_slip(seat)
		return
	seat.last = btn
	seat.queue = minf(QUEUE_MAX, seat.queue + LIFT)
	seat.cranks += 1
	seat.lane.crank_target += PI / 2
	Sfx.play("tick", {"vol": 0.35})


func _slip(seat: Dictionary) -> void:
	var lane: Dictionary = seat.lane
	seat.stun = SLIP_STUN
	seat.queue = 0.0
	seat.h = maxf(-3.0, seat.h - SLIP_DROP)
	seat.slips += 1
	lane.crank_target -= PI * 1.5   # the crank spins back
	Sfx.play("clank", {"vol": 0.6})
	fx.sparks(Vector3(lane.x + CRANK_X, seat.h + 1.0, 0.35), {"count": 8, "speed": 3.0})
	Haptics.for_player(seat.player, "hit")


func _finish(seat: Dictionary, rank: int) -> void:
	seat.finished = true
	seat.finish_rank = rank
	seat.finish_time = time
	seat.queue = 0.0
	seat.exit_t = 0.0
	Sfx.play("ding")
	hud.feed("%s escaped" % seat.player.name(), seat.player.color)
	if not first_out:
		first_out = true
		hud.banner("FIRST OUT", 1400, "good")


func _mince(seat: Dictionary) -> void:
	var lane: Dictionary = seat.lane
	lane.dead = true
	lane.cable.visible = false
	Mats.set_color(lane.warn_mat, 0x401008)
	kill(seat, "gib", {"dir": Vector3(0, 0, -1), "force": 0.6, "sound": "grind"})
	fx.sparks(Vector3(lane.x, grinder_y, 0.7), {"count": 14, "speed": 5.0, "color": 0xff3a2a})
	# The empty platform gets spat out onto the housing.
	var odd: bool = lane.i % 2 == 1
	fx.add_body(lane.group, Vector3(1.2 if odd else -1.2, 4, -0.4), Vector3(3, 0, 4 if odd else -4), {"bleed": false, "radius": 0.3})


func _check_end() -> void:
	var unresolved := 0
	for s in seats:
		if s.alive and not s.finished:
			unresolved += 1
	if unresolved == 0:
		if finish_count == 0:
			hud.banner("NOBODY ESCAPED", 2200, "danger")
		elif deaths.is_empty():
			hud.banner("SHAFT CLEARED", 2200, "good")
		else:
			hud.banner("SHIFT OVER", 2200)
		end(2.4)
	elif time >= CAP:
		hud.banner("TIME UP", 2200)
		Sfx.play("buzz")
		end(2.4)


## Escapees by order, then survivors by height, then the dead (last to die first).
func placement() -> Array:
	var fin := seats.filter(func(s): return s.finished)
	fin.sort_custom(func(a, b): return a.finish_rank < b.finish_rank)
	var alive := seats.filter(func(s): return s.alive and not s.finished)
	alive.sort_custom(func(a, b): return a.h > b.h)
	var dead := deaths.duplicate()
	dead.reverse()
	var tiers := Minigame.group_by(fin, func(s): return s.finish_rank)
	tiers.append_array(Minigame.group_by(alive, func(s): return "%.2f" % s.h))
	tiers.append_array(Minigame.group_by(dead, func(s): return snappedf(s.death_time, 0.001)))
	return tiers


func _update_hud() -> void:
	for s in seats:
		if not s.alive:
			hud.set_status(s, "MINCED")
			hud.set_stat(s, "%.1fm" % maxf(0.0, s.h))
		elif s.finished:
			hud.set_status(s, "ESCAPED")
			hud.set_stat(s, "ESCAPED #%d" % s.finish_rank)
		else:
			var gap: float = s.h - grinder_y
			hud.set_status(s, "SLIPPED!" if s.stun > 0 else ("GRINDER CLOSE!" if gap < WARN_GAP else "CRANKING"))
			hud.set_stat(s, "%.1fm" % maxf(0.0, s.h))
	hud.set_timer(-1)


# ------------------------------------------------------------- animation

## Grinder position + rollers, beacons, platforms, cranks, cables, hatches.
func _animate_machines(dt: float, playing: bool) -> void:
	var spin := (6 + g_speed * 6 if playing else 4.0) * dt
	rollers[0].rotation.x += spin
	rollers[1].rotation.x -= spin
	grinder.position.y = grinder_y
	var on := sin(clock * 9) > 0
	Mats.set_color(beacon_mat, 0xff2a10 if on else 0x3a0806)
	g_light.light_energy = (14.0 if on else 5.0) * Env.LIGHT_K
	var blink := sin(clock * 16) > 0
	var k := U.damp(20, dt)
	for seat in seats:
		var lane: Dictionary = seat.lane
		lane.crank_angle += (lane.crank_target - lane.crank_angle) * k
		if lane.crank:
			lane.crank.rotation.z = -lane.crank_angle
		if not lane.dead:
			lane.group.position.y = seat.h
			var y0: float = seat.h + 1.12
			var length := maxf(0.05, CEIL - y0)
			lane.cable.scale.y = length
			lane.cable.position.y = y0 + length / 2
			var close: bool = playing and seat.alive and not seat.finished and seat.h - grinder_y < WARN_GAP
			Mats.set_color(lane.warn_mat, 0xff2010 if close and blink else 0x401008)
		if seat.finished:
			lane.hatch_open = minf(1.0, lane.hatch_open + dt * 4)
		lane.hatch.rotation.z = -lane.hatch_open * 1.75
		Mats.set_color(lane.exit_mat, 0x4dff6a if seat.finished else 0x7a5a10)


func _animate_subjects(dt: float) -> void:
	for seat in seats:
		if not seat.alive:
			continue
		var s: Subject = seat.subject
		if seat.finished:
			# Climb out through the hatch, then vanish upstairs.
			seat.exit_t += dt
			s.pose = "armsUp"
			s.animate(dt, 0)
			var k := clampf((seat.exit_t - 0.3) / 0.8, 0, 1)
			s.root.position.y = TOP + k * k * 3.2
			if k >= 1 and s.root.visible:
				s.root.visible = false
				seat.tag_target = null
			continue
		s.root.position.y = seat.h
		var stunned: bool = seat.stun > 0
		s.pose = "cower" if stunned else "hold"
		s.animate(dt, 0)
		if stunned:
			continue
		# Both hands on the crank handle, following its rotation.
		var p := s.parts
		var ang: float = seat.lane.crank_angle
		p.armR.rotation.x = -1.25 + sin(ang) * 0.35
		p.armR.rotation.z = 0.25 + cos(ang) * 0.12
		p.armL.rotation.x = -1.1 + sin(ang) * 0.3
		p.armL.rotation.z = 0.55 + cos(ang) * 0.1
		p.torso.rotation.z = sin(ang) * 0.05


## Frame every live subject (and the grinder when it is near); zoom out as they spread.
func _update_camera(dt: float, snap: bool = false) -> void:
	var lo := INF
	var hi := -INF
	var best := 0.0
	for s in seats:
		best = maxf(best, s.h)
		if not s.alive or s.finished:
			continue
		lo = minf(lo, s.h)
		hi = maxf(hi, s.h)
	if is_inf(lo):
		lo = best
		hi = best
	var bottom := lo - 0.6
	var top := hi + 2.6
	if grinder_y > lo - 6:
		bottom = minf(bottom, grinder_y - 0.8)
	if hi > TOP - 4:
		top = maxf(top, CEIL + 0.8)
	var d := clampf((top - bottom) * 1.25 + 1, 9, 26)
	var cy := (bottom + top) / 2
	var k := 1.0 if snap else U.damp(2.5, dt)
	cam_y += (cy - cam_y) * k
	cam_d += (d - cam_d) * k
	Env.look_from(camera, Vector3(0, cam_y + 1.0, cam_d), Vector3(0, cam_y, -0.4))
	Env.look_from(spot, Vector3(0, cam_y + 7, 7), Vector3(0, cam_y - 1, -1))


# -------------------------------------------------------------------- bots

## Bots alternate at a difficulty-based cadence with reaction-sized jitter,
## an occasional hesitation, and (mostly at low difficulty) the odd
## same-button mis-press. Each press is held for exactly one tick.
func bot_think(seat: Dictionary, dt: float) -> void:
	var c: Controller = seat.ctrl
	var brain: Dictionary = seat.brain
	var m: Dictionary = brain.memory
	if not m.has("cd"):
		m["cd"] = brain.reaction + Rng.rand(0, 0.2)
		m["held"] = false
	if m.held:
		c.set_buttons(false, false)
		m.held = false
	if seat.finished:
		return
	if seat.stun > 0:
		m.cd = maxf(m.cd, seat.stun + brain.reaction * Rng.rand(0.5, 1.2))
		return
	m.cd -= dt
	if m.cd > 0:
		return
	var d: float = brain.difficulty
	var rate := 6.2 + 3.0 * d             # presses per second: ~7.1 / 8.0 / 8.9
	var slip_p: float = brain.error * 0.15   # ~2.9% / 2.0% / 1.1% per press
	if seat.h - grinder_y < WARN_GAP + 1:   # panic
		rate *= 1 + 0.08 * d
		slip_p *= 1.6 - d
	var jitter := clampf(brain.reaction, 0.05, 0.4) * 0.9
	m.cd += (1 / rate) * (1 + Rng.rand(-jitter, jitter))
	if Rng.random() < brain.reaction * 0.04:
		m.cd += brain.reaction * Rng.rand(0.5, 1.5)   # hesitation
	var btn := "b" if seat.last == "a" else "a"
	if seat.last != "" and Rng.random() < slip_p:
		btn = seat.last   # mis-press: same button again
	c.set_buttons(btn == "a", btn == "b")
	m.held = true

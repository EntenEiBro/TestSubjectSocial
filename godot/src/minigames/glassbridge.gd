extends Minigame
## GLASS PANELS — a long glass bridge across a bottomless chasm.
##
## Rules
##  - The bridge is 8 rows long and two panes wide (far / near). In every row
##    one pane is tempered (safe), the other shatters the instant a subject's
##    centre is over it ('fall'). Nothing tells them apart.
##  - The steel crossbeams between rows are safe to stand on, so subjects can
##    wait between rows and switch lanes there.
##  - Shattered panes stay gone, so everyone learns. A tempered pane that has
##    held somebody for 0.5 s lights up green as known-safe.
##  - Everyone starts on the safe platform at the same time and moves freely.
##    B shoves (ideally a rival onto untested glass).
##  - Reaching the far platform = finished (finish order ranks).
##  - After 60 s the bridge is decommissioned: a collapse wave sweeps from the
##    start platform to the far end and everyone not across falls.
##  - Ranking: finishers in order, then anyone still standing (only if the round
##    ended early), then the dead in reverse death order. The round ends as soon
##    as at most one subject is still undecided (their place is fixed by then).
##
## Models (blender/props/glassbridge.py): row / row_last (girders, railing,
## strut, crossbeam), exit_door. Glass panes, platforms and pillars stay procedural.

const META := {
	"id": "glassbridge",
	"title": "GLASS PANELS",
	"tagline": "Half of it is load-bearing. Allegedly.",
	"category": "Deception",
	"controls": [{"input": "move", "label": "Move"}, {"input": "b", "label": "Shove"}],
	"objective": "Cross the bridge before it collapses. First across wins.",
	"rules": [
		"Every row has two panes. One is tempered. The other is a formality.",
		"Broken panes stay broken. A pane that holds someone for a moment glows green.",
		"Press {B} to shove a rival onto untested glass. Science thanks them.",
		"At zero the bridge is decommissioned — with everyone still on it.",
	],
}

const ROWS := 8
const PW := 1.5                        # pane length along the bridge (X)
const GAP := 0.5                       # walkable steel crossbeam between rows
const PITCH := PW + GAP
const PD := 1.3                        # pane depth = half the bridge width
const LANE_Z := [-PD / 2, PD / 2]      # centres of the far (0) and near (1) pane
const SPAN := ROWS * PW + (ROWS - 1) * GAP
const X0 := -SPAN / 2                  # first glass edge
const X1 := SPAN / 2                   # last glass edge
const PLAT_L := 3.4                    # platform length
const PLAT_D := 3.0                    # platform half depth
const XS := X0 - PLAT_L
const XE := X1 + PLAT_L
const HOLD := 0.5                      # seconds a tempered pane must hold someone to glow
const TIME_LIMIT := 60.0
const WAVE := 11.0                     # collapse wave speed (units/s)
const START := "start"
const END := "end"
const BEAM := "beam"
const PARK := [[X1 + 1.6, -2.1], [X1 + 1.6, 2.1], [X1 + 2.7, -1.0], [X1 + 2.7, 1.0]]

var arena: Arena
var collapse = null       # {t, front, next_row, start_dropped} once the bridge is decommissioned
var panels := []
var row_groups := []
var fallers := []
var finish_count := 0
var _warned := false
var _last_sec := -1
var _prompt_clear_at := -1.0
var start_group: Node3D
var pit_light: OmniLight3D
var glass_mat: StandardMaterial3D
var safe_mat: StandardMaterial3D
var shard_mat: StandardMaterial3D
var shard_geo: Mesh


static func _row_x(r: int) -> float:       # near (start-side) edge of row r
	return X0 + r * PITCH


static func _row_cx(r: int) -> float:      # centre of row r
	return _row_x(r) + PW / 2


static func _beam_x(r: int) -> float:      # beam after row r (-1: start edge)
	return X0 - 0.5 if r < 0 else _row_x(r) + PW + GAP / 2


func build() -> void:
	make_scene({"fog_near": 16.0, "fog_far": 48.0, "floor_at": func(x: float, z: float) -> float: return 0.0 if _solid_at(x, z) else -INF})
	make_camera([0, 12.5, 12.5], [0, -0.8, 0.2], 46)

	_build_chasm()
	_build_platforms()
	_build_bridge()

	Env.hanging_lamp(scene, -9.5, 6.5, 0.3, {"intensity": 55.0, "angle": 0.8, "shadow": false})
	Env.hanging_lamp(scene, -3.5, 6.8, 0.3, {"intensity": 75.0, "angle": 0.9})
	Env.hanging_lamp(scene, 3.5, 6.8, 0.3, {"intensity": 75.0, "angle": 0.9})
	Env.hanging_lamp(scene, 9.5, 6.5, 0.3, {"intensity": 55.0, "angle": 0.8, "shadow": false})

	# Arena: one box covering both platforms; walls block the void beside the bridge.
	arena = Arena.new({"bounds": {"min_x": XS, "max_x": XE, "min_z": -PLAT_D, "max_z": PLAT_D}, "shove_force": 12.0})
	arena.add_wall(X0, X1, PD, PLAT_D + 1)
	arena.add_wall(X0, X1, -PLAT_D - 1, -PD)
	var n := seats.size()
	for i in n:
		var seat: Dictionary = seats[i]
		var x := X0 - 1.9
		var z := (i - (n - 1) / 2.0) * 1.35
		spawn_subject(seat, {"x": x, "z": z, "facing": PI / 2})
		seat.actor = arena.add(ArenaActor.new({"player": seat.player, "ctrl": seat.ctrl, "subject": seat.subject, "x": x, "z": z}))
		seat.actor.seat = seat
		seat.actor.facing = PI / 2
		seat["finish_order"] = 0
	arena.on_shove = func(a: ArenaActor, b: ArenaActor):
		b.data["last_shover"] = a.seat
		b.data["shoved_at"] = time


## Back wall, pipes and a far-away glowing pit floor.
func _build_chasm() -> void:
	scene.add_child(Env.mesh(Geo.plane(64, 36), Mats.mat(0x8c867a, Tex.concrete(Vector2(10, 6))), 0, -8, -7.5, {"cast": false}))
	var pit := Env.mesh(Geo.plane(64, 30), Mats.mat(0x24180f, Tex.rust(Vector2(8, 4))), 0, -24, 0, {"cast": false})
	pit.rotation.x = -PI / 2
	scene.add_child(pit)
	pit_light = Env.point_light(0xff3a18, 45, 30, 1.2)
	pit_light.position = Vector3(0, -16, 0)
	scene.add_child(pit_light)
	Env.pipe(scene, [-30, 4.2, -7.2], [30, 4.2, -7.2], 0.22)
	Env.pipe(scene, [-30, 3.5, -7.3], [30, 3.5, -7.3], 0.12, 0x5a3022)
	Env.pipe(scene, [-4.5, 4.2, -7.2], [-4.5, -20, -7.2], 0.14)
	Env.pipe(scene, [6.5, 3.5, -7.3], [6.5, -20, -7.3], 0.1, 0x5a3022)
	Env.stencil(scene, "TRUST THE GLASS", 0, 2.1, -7.45, {"w": 8.0, "h": 2.0, "opacity": 0.5})


## Start platform (collapses at the end) and the far platform with its exit.
func _build_platforms() -> void:
	var deck_mat := Mats.mat(0xffffff, Tex.plate(Vector2(3, 3)))
	var pillar_mat := Mats.mat(0x9a948a, Tex.concrete(Vector2(1, 5)))
	var deck_geo := Geo.box(PLAT_L, 0.6, PLAT_D * 2)
	var pillar_geo := Geo.box(1.6, 16, 1.6)

	start_group = Node3D.new()
	start_group.add_child(Env.mesh(deck_geo, deck_mat, XS + PLAT_L / 2, -0.3, 0))
	start_group.add_child(Env.mesh(pillar_geo, pillar_mat, XS + PLAT_L / 2, -8.6, 0))
	Env.hazard_strip(start_group, X0 - 0.25, 0, 0.5, PLAT_D * 2, 0.01)
	scene.add_child(start_group)

	scene.add_child(Env.mesh(deck_geo, deck_mat, XE - PLAT_L / 2, -0.3, 0))
	scene.add_child(Env.mesh(pillar_geo, pillar_mat, XE - PLAT_L / 2, -8.6, 0))
	Env.hazard_strip(scene, X1 + 0.25, 0, 0.5, PLAT_D * 2, 0.01)

	# Exit door at the back of the far platform (frame + glowing door: Blender model).
	var dx := XE - 1.7
	var dz := -PLAT_D + 0.1
	var door := Props.make("glassbridge", "exit_door")
	door.position = Vector3(dx, 0, dz)
	scene.add_child(door)
	var exit_light := Env.point_light(0x40ff6a, 6, 6, 1.5)
	exit_light.position = Vector3(dx, 1.4, dz + 0.8)
	scene.add_child(exit_light)
	Env.stencil(scene, "EXIT", dx, 3.0, dz - 0.05, {"w": 1.8, "h": 0.7, "color": "#7dff9a", "opacity": 0.85})


## Girders, crossbeams, railings and the 16 glass panes (one fragile per row).
func _build_bridge() -> void:
	var pane_geo := Geo.box(PW - 0.06, 0.06, PD - 0.08)
	glass_mat = Mats.mat(0xa8dbe6, null, {"emissive": 0x0e2c33, "opacity": 0.42, "depth_write": false, "double_side": true})
	safe_mat = Mats.mat(0x7dff9a, null, {"emissive": 0x1f8a38, "opacity": 0.62, "depth_write": false, "double_side": true})
	shard_mat = Mats.mat(0xbfe8f0, null, {"opacity": 0.7, "double_side": true})
	shard_geo = Geo.circle(0.2, 3)

	for r in ROWS:
		var last := r == ROWS - 1
		var g := Props.make("glassbridge", "row_last" if last else "row")
		g.position = Vector3(_row_x(r), 0, 0)
		scene.add_child(g)
		row_groups.append(g)

		var bad := Rng.rand_int(0, 1)
		for lane in 2:
			var pane := Env.mesh(pane_geo, glass_mat, _row_cx(r), -0.03, LANE_Z[lane], {"cast": false})
			scene.add_child(pane)
			panels.append({
				"row": r, "lane": lane, "x": _row_cx(r), "z": LANE_Z[lane], "fragile": lane == bad,
				"broken": false, "known": false, "hold_t": 0.0, "proven_at": null, "occ": false, "mesh": pane,
			})


# -------------------------------------------------------------- geometry

## What lies under world point (x, z): START, END, BEAM or a pane Dictionary.
func _cell_at(x: float, z: float) -> Variant:
	if x < X0:
		return START
	if x >= X1:
		return END
	var local := x - X0
	var row := mini(ROWS - 1, int(floor(local / PITCH)))
	if local - row * PITCH >= PW:
		return BEAM
	return panels[row * 2 + (0 if z < 0 else 1)]


## Can something stand at (x, z) right now?
func _solid_at(x: float, z: float) -> bool:
	if x < XS or x > XE:
		return false
	if collapse != null and x < collapse.front:
		return false
	var c = _cell_at(x, z)
	if c is String and (c == START or c == END):
		return absf(z) <= PLAT_D
	if absf(z) > PD:
		return false
	if c is String:
		return true   # BEAM
	return not c.broken


# ------------------------------------------------------------- lifecycle

func start() -> void:
	hud.banner("WATCH YOUR STEP", 1400)
	hud.prompt("{MOVE} walk · {B} shove")
	_prompt_clear_at = 4.5


func preview(dt: float) -> void:
	_animate(dt)
	for s in seats:
		s.subject.animate(dt, 0)


func update(dt: float) -> void:
	var playing := state == "play"
	_animate(dt)
	arena.step(dt, playing)
	if playing and collapse == null and time >= TIME_LIMIT:
		_start_collapse()
	_update_collapse(dt)
	_resolve_footing(dt)
	_update_finishers(dt)
	_update_stats()
	if not playing:
		return
	if _prompt_clear_at >= 0.0 and time >= _prompt_clear_at:
		_prompt_clear_at = -1.0
		hud.prompt("")

	if collapse == null:
		var left := maxf(0.0, TIME_LIMIT - time)
		hud.set_timer(left)
		if not _warned and left <= 10:
			_warned = true
			Sfx.play("horn")
			hud.banner("BRIDGE UNSTABLE", 1400, "danger")
		var sec := int(ceil(left))
		if left <= 5 and sec != _last_sec:
			_last_sec = sec
			Sfx.play("tick", {"vol": 2.0})
	else:
		hud.set_timer(-1)

	# Done once at most one subject is undecided (their placement can no longer change).
	var pending := seats.filter(func(s): return s.alive and s.finish_order == 0)
	var any_falling := false
	for s in pending:
		if s.actor.falling:
			any_falling = true
	if pending.size() <= 1 and not any_falling:
		end()
		return
	if time > TIME_LIMIT + 10:
		end()   # safety net


## Who stands where: shatter fragile panes, start falls, credit tempered panes.
func _resolve_footing(dt: float) -> void:
	for p in panels:
		p.occ = false
	for seat in seats:
		if not seat.alive or seat.finish_order != 0:
			continue
		var a: ArenaActor = seat.actor
		if a.falling:
			if a.y < -3:
				_fall_kill(seat)
			continue
		var c = _cell_at(a.pos.x, a.pos.z)
		if c is String and c == END:
			if state == "play" and not (collapse != null and a.pos.x < collapse.front):
				_finish(seat)
			if seat.finish_order != 0:
				continue
		elif c is Dictionary and not c.broken:
			if c.fragile:
				_shatter(c)
			else:
				c.occ = true
				if c.proven_at == null:
					c.proven_at = time
		if not _solid_at(a.pos.x, a.pos.z):
			_start_fall(seat)
	for p in panels:
		if p.fragile or p.broken:
			continue
		if p.occ:
			p.hold_t += dt
			if not p.known and p.hold_t >= HOLD:
				p.known = true
				p.mesh.material_override = safe_mat
				Sfx.play("ding", {"vol": 0.35})
		else:
			p.hold_t = 0.0


func _start_fall(seat: Dictionary) -> void:
	var a: ArenaActor = seat.actor
	a.falling = true
	a.vy = 0.6
	seat.subject.pose = "armsUp"
	Sfx.play("whoosh", {"vol": 1.2})
	Haptics.for_player(seat.player, "hit")
	var by = a.data.get("last_shover")
	var recent: bool = time - float(a.data.get("shoved_at", -9.0)) < 1.5
	a.data["fell_by"] = by if by != null and not is_same(by, seat) and recent else null


func _fall_kill(seat: Dictionary) -> void:
	var a: ArenaActor = seat.actor
	var by = a.data.get("fell_by")
	if by != null:
		hud.feed("%s volunteered %s" % [by.player.name(), seat.player.name()], by.player.color)
	var dir := a.knock if a.knock.length_squared() > 0.01 else Vector3(1, 0, 0)
	kill(seat, "fall", {"dir": dir})


func _finish(seat: Dictionary) -> void:
	var a: ArenaActor = seat.actor
	finish_count += 1
	seat.finish_order = finish_count
	a.frozen = true
	a.data["park"] = PARK[(seat.finish_order - 1) % PARK.size()]
	a.data["cheer"] = 1.6
	seat.subject.pose = "armsUp"
	Sfx.play("ding")
	hud.feed("%s made it across" % seat.player.name(), seat.player.color)


## Finished subjects stroll to a parking spot on the far platform and celebrate.
func _update_finishers(dt: float) -> void:
	for seat in seats:
		if seat.finish_order == 0 or not seat.alive:
			continue
		var a: ArenaActor = seat.actor
		var park: Array = a.data.park
		var dx: float = park[0] - a.pos.x
		var dz: float = park[1] - a.pos.z
		var d := U.hypot(dx, dz)
		if d > 0.08:
			var v := minf(3.0, d * 4)
			a.vel.x = (dx / d) * v
			a.vel.z = (dz / d) * v
			a.facing = atan2(dx, dz)
		else:
			a.facing = 0.0
		if a.data.cheer > 0:
			a.data["cheer"] = a.data.cheer - dt
			if a.data.cheer <= 0:
				seat.subject.pose = "idle"


## Remove a pane, throwing glass shards into the chasm.
func _shatter(p: Dictionary, quiet: bool = false) -> void:
	if p.broken:
		return
	p.broken = true
	p.mesh.visible = false
	var n := 3 if quiet else 7
	for i in n:
		# Kept inside the hole so no shard comes to rest on a neighbouring pane.
		var s := Env.mesh(shard_geo, shard_mat, p.x + Rng.rand(-0.4, 0.4), -0.03, p.z + Rng.rand(-0.3, 0.3), {"cast": false})
		s.rotation = Vector3(Rng.rand(0, 6.28), Rng.rand(0, 6.28), 0)
		s.scale = Vector3.ONE * Rng.rand(0.6, 1.4)
		scene.add_child(s)
		fx.add_body(s, Vector3(Rng.rand(-0.8, 0.8), Rng.rand(-0.5, 1), Rng.rand(-0.8, 0.8)),
			Vector3(Rng.rand(-9, 9), Rng.rand(-9, 9), Rng.rand(-9, 9)), {"bleed": false, "life": 3.0, "radius": 0.05})
	if not quiet:
		Sfx.play("snap", {"vol": 1.3})
		Sfx.play("crunch", {"vol": 0.5})
		fx.sparks(Vector3(p.x, 0.05, p.z), {"color": 0xd8f4ff, "count": 10, "speed": 4.0})
		engine.shake(0.2)


func _start_collapse() -> void:
	collapse = {"t": 0.0, "front": XS - 0.5, "next_row": 0, "start_dropped": false}
	Sfx.play("sting")
	Sfx.play("grind")
	engine.shake(0.6)
	hud.banner("BRIDGE DECOMMISSIONED", 1800, "danger")
	hud.set_timer(-1)


## The collapse wave travels from the start platform to the far edge.
func _update_collapse(dt: float) -> void:
	var c = collapse
	if c == null:
		return
	c.t += dt
	c.front = minf(X1, XS - 0.5 + c.t * WAVE)
	if not c.start_dropped and c.front > XS:
		c.start_dropped = true
		_drop(start_group)
	while c.next_row < ROWS and c.front > _row_cx(c.next_row) - PW * 0.25:
		var r: int = c.next_row
		c.next_row += 1
		_shatter(panels[r * 2], true)
		_shatter(panels[r * 2 + 1], true)
		_drop(row_groups[r])
		Sfx.play("crunch", {"vol": 0.5})


func _drop(obj: Node3D) -> void:
	fallers.append({"obj": obj, "vy": 0.0, "spin": Rng.rand(-0.8, 0.8)})


## Cosmetics: falling bridge parts, glass shimmer, pit glow.
func _animate(dt: float) -> void:
	var i := fallers.size() - 1
	while i >= 0:
		var f: Dictionary = fallers[i]
		var obj: Node3D = f.obj
		f.vy -= 18 * dt
		obj.position.y += f.vy * dt
		obj.rotation.x += f.spin * dt * 0.3
		if obj.position.y < -40:
			obj.visible = false
			fallers.remove_at(i)
		i -= 1
	glass_mat.emission_energy_multiplier = 0.85 + sin(clock * 1.7) * 0.15
	pit_light.light_energy = (40 + sin(clock * 2.3) * 6) * Env.LIGHT_K


func _update_stats() -> void:
	for seat in seats:
		var s: String
		if seat.finish_order != 0:
			s = "ACROSS #%d" % seat.finish_order
		elif not seat.alive:
			s = "FELL"
		elif seat.actor.falling:
			s = "FALLING"
		elif seat.actor.pos.x < X0:
			s = "WAITING"
		else:
			s = "ON BRIDGE"
		hud.set_stat(seat, s)


# ------------------------------------------------------------- placement

## Finishers in order, then anyone still standing (furthest first), then the dead (latest first).
func placement() -> Array:
	var fin := seats.filter(func(s): return s.finish_order != 0)
	fin.sort_custom(func(a, b): return a.finish_order < b.finish_order)
	var pend := seats.filter(func(s): return s.alive and s.finish_order == 0)
	pend.sort_custom(func(a, b): return a.actor.pos.x > b.actor.pos.x)
	var dead := deaths.duplicate()
	dead.reverse()
	var tiers := []
	for s in fin:
		tiers.append([s])
	for s in pend:
		tiers.append([s])
	tiers.append_array(Minigame.group_by(dead, func(s): return snappedf(s.death_time, 0.001)))
	return tiers


# ------------------------------------------------------------------ bots

## Which lane of row `r` this bot believes is safe (-1 = unknown). Bots see
## green panes, subjects standing on glass (after their reaction time),
## broken panes (the partner must be tempered) and the pane under their feet.
func _lane_known(seat: Dictionary, r: int, here: Variant) -> int:
	var p0: Dictionary = panels[r * 2]
	var p1: Dictionary = panels[r * 2 + 1]
	if here is Dictionary:
		if is_same(here, p0) and not p0.broken:
			return 0
		if is_same(here, p1) and not p1.broken:
			return 1
	var react: float = seat.brain.reaction
	if _seen(p0, react):
		return 0
	if _seen(p1, react):
		return 1
	if p0.broken and not p1.broken:
		return 1
	if p1.broken and not p0.broken:
		return 0
	return -1


func _seen(p: Dictionary, react: float) -> bool:
	return not p.broken and (p.known or (p.proven_at != null and time - p.proven_at > react))


## Is (x, z) a spot this bot knows it can stand on?
func _bot_safe(seat: Dictionary, x: float, z: float, frontier: int) -> bool:
	var c = _cell_at(x, z)
	if c is String and c == START:
		return collapse == null and x > XS + 0.4
	if c is String and c == END:
		return false
	if absf(z) > PD - 0.1:
		return false
	if c is String:
		return true   # BEAM
	if c.broken:
		return false
	return c.row < frontier and seat.brain.memory.lanes[c.row] == c.lane


func bot_think(seat: Dictionary, dt: float) -> void:
	var a: ArenaActor = seat.actor
	var brain: Dictionary = seat.brain
	var m: Dictionary = brain.memory
	if a.falling or seat.finish_order != 0:
		a.ctrl.set_move(0, 0)
		a.ctrl.set_buttons(false, false)
		m["b_prev"] = false
		return
	if not m.has("lanes"):
		var lanes := []
		lanes.resize(ROWS)
		lanes.fill(-1)
		m["lanes"] = lanes
		m["wait_z"] = Rng.rand(-1.1, 1.1)
		m["wait_t"] = 0.0
		m["frontier"] = -1
		m["gamble"] = -1
		m["hunt_t"] = 0.0
		m["hunt_cd"] = Rng.rand(1, 3)
		m["hold_dx"] = Rng.rand(-0.5, 0.5)   # personal waiting spot so bots don't jostle each other sideways
	var lanes_m: Array = m.lanes
	var here = _cell_at(a.pos.x, a.pos.z)

	# What do I know? F = first row without a known safe lane.
	var F := 0
	while F < ROWS:
		var l := _lane_known(seat, F, here)
		if l < 0:
			break
		lanes_m[F] = l
		F += 1
	if F != m.frontier:
		# Somebody (maybe me) solved a row: wait again before risking the next one.
		m["frontier"] = F
		m["wait_t"] = 0.0
		m["patience"] = Rng.rand(lerpf(0.8, 3.2, brain.difficulty), lerpf(2.6, 7.5, brain.difficulty))
		m["gamble"] = -1
	m["wait_t"] = m.wait_t + dt
	m["hunt_cd"] = m.hunt_cd - dt
	if m.hunt_t > 0:
		m["hunt_t"] = m.hunt_t - dt

	# Gamble on the frontier once patience runs out or the clock gets tight.
	if F < ROWS and m.gamble < 0:
		var left := TIME_LIMIT - time
		var margin := lerpf(7, 2.5, brain.difficulty)
		if m.wait_t > m.patience or left < (ROWS - F) * 0.9 + margin:
			m["gamble"] = 0 if Rng.random() < 0.5 else 1
	if F < ROWS and m.gamble >= 0:
		lanes_m[F] = m.gamble
	var goal: int = ROWS if F >= ROWS else (F if m.gamble >= 0 else F - 1)

	# Navigate pane centre → beam (own lane) → switch lane on the beam → next pane.
	var z := a.pos.z
	var tx := a.pos.x
	var tz := z
	var k: int
	var on_pane := false
	if here is String and here == START:
		k = -1
	elif here is String and here == BEAM:
		k = int(floor((a.pos.x - X0) / PITCH))
	elif here is String and here == END:
		k = ROWS
	else:
		k = here.row
		on_pane = true
	if not m.has("last_k") or m.last_k != k:
		m["last_k"] = k
		m["sloppy"] = Rng.random() < brain.error * 0.35   # clumsy bots cut corners
	if on_pane:
		var hz: float = LANE_Z[here.lane]
		if k < goal:
			tx = X1 + 1.4 if k == ROWS - 1 else _beam_x(k)
			tz = hz
		else:
			tx = _row_cx(k) + m.hold_dx   # hold: own spot, outer half of the pane
			tz = hz * 1.2
	elif k < ROWS:
		var nxt := k + 1
		if nxt > goal:
			# Hold position behind the frontier.
			if k < 0:
				tx = X0 - 1.0 + m.hold_dx * 0.8
				tz = m.wait_z
			elif lanes_m[k] >= 0:
				var hz: float = LANE_Z[lanes_m[k]]
				if absf(z - hz) > 0.2:
					tx = _beam_x(k)
					tz = hz
				else:
					tx = _row_cx(k) + m.hold_dx
					tz = hz * 1.2
		else:
			var nz: float = LANE_Z[lanes_m[nxt]]
			if absf(z - nz) > (0.9 if m.sloppy else 0.2):
				tx = _beam_x(k)
				tz = nz
			else:
				tx = _row_cx(nxt)
				tz = nz

	# Volunteering others: sneak up behind a rival waiting at the untested row and shove.
	var want_b := false
	var sx := 0.0
	var sz := 0.0
	if F < ROWS and m.gamble < 0:
		var front_x := _row_x(F)
		var victim: ArenaActor = null
		var bd := 2.4
		for s in seats:
			if is_same(s, seat) or not s.alive or s.finish_order != 0:
				continue
			var o: ArenaActor = s.actor
			if o.falling:
				continue
			var dx := o.pos.x - a.pos.x
			var d := U.hypot(dx, o.pos.z - z)
			if dx < 0.15 or d > bd:
				continue
			if o.pos.x < front_x - 2.0 or o.pos.x >= front_x:
				continue
			bd = d
			victim = o
		if victim != null and m.hunt_t <= 0 and m.hunt_cd <= 0 and Rng.random() < maxf(0.0, brain.difficulty - 0.2) * dt * 1.5:
			m["hunt_t"] = 2.5
		if victim != null and m.hunt_t > 0:
			var hx := victim.pos.x - 0.8
			var hz := victim.pos.z
			if _bot_safe(seat, hx, hz, F) and _bot_safe(seat, (hx + a.pos.x) / 2, (hz + z) / 2, F):
				tx = hx
				tz = hz
				var dx := victim.pos.x - a.pos.x
				var dz := victim.pos.z - z
				var d := U.hypot(dx, dz)
				if d == 0.0:
					d = 1.0
				if d < 1.3 and dx > 0.3 and a.shove_cd <= 0 and Rng.random() < 0.35:
					want_b = true
					sx = dx / d
					sz = dz / d
					m["hunt_t"] = 0.0
					m["hunt_cd"] = Rng.rand(2.5, 5) / (0.4 + brain.difficulty)
			else:
				m["hunt_t"] = 0.0

	if want_b:
		a.facing = atan2(sx, sz)
		a.ctrl.set_move(sx * 0.3, sz * 0.3)
	else:
		AI.steer_to(a, tx, tz, {"arrive": 0.1, "slow": 0.6})
	# Buttons are edge-triggered: alternate so repeated intents become fresh presses.
	var press: bool = want_b and not m.get("b_prev", false)
	a.ctrl.set_buttons(false, press)
	m["b_prev"] = press


func dispose() -> void:
	for seat in seats:
		seat.actor = null   # break the seat <-> actor reference cycle
	super.dispose()

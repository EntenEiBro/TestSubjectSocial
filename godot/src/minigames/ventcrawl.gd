extends Minigame
## VENT CRAWL — a seeded maze of low ventilation ducts, littered with data
## chips and patrolled by security drones that hunt by ear.
##
## Rules
##  - The duct network is a 13×9 maze generated from the round seed, with a
##    few extra openings so it has loops (no open 2×2 halls, no wall islands).
##  - Data chips lie at cell centres. Walking over one = +1 chip. When only a
##    few are left, a fresh batch appears away from everybody.
##  - A security drone patrols the ducts and paths (BFS along the maze) to the
##    nearest subject it can HEAR: moving subjects are heard within 6 cells of
##    duct, standing still only from the next cell, and anyone who just
##    grabbed a chip is loud (10 cells) for a moment. It remembers the last
##    heard spot for a short while, otherwise it wanders.
##  - At 25 s a second drone drops in as far from the subjects as possible.
##    At 45 s both drones are overclocked (faster, sharper hearing).
##  - Drone contact is fatal ('shot'). B shoves (nudge a rival into a drone).
##  - Round: 60 s, or until at most one subject is left. Ranking: the living
##    by chips, then the dead by chips (later death breaks ties).
## Drone and data-chip models: blender/props/ventcrawl.py.

const META := {
	"id": "ventcrawl",
	"title": "VENT CRAWL",
	"tagline": "The ducts are quiet. Keep it that way.",
	"category": "Stealth",
	"controls": [{"input": "move", "label": "Move"}, {"input": "b", "label": "Shove"}],
	"objective": "Collect the most data chips without being found.",
	"rules": [
		"Data chips lie in the ducts. Each one is worth a point.",
		"Security drones hunt by sound. Moving is loud; standing still is quiet.",
		"Grabbing a chip makes noise. A second drone joins after 25 seconds.",
		"Drone contact is fatal. The living outrank the dead.",
	],
}

const COLS := 13
const ROWS := 9
const N := COLS * ROWS
const CELL := 1.6
const HW := COLS * CELL / 2.0
const HD := ROWS * CELL / 2.0
const T := 0.22                 # wall thickness
const WALL_H := 0.75            # low duct walls
const CENTER := 4 * COLS + 6    # floor(ROWS / 2) * COLS + floor(COLS / 2)

const ROUND_TIME := 60.0
const SECOND_AT := 25.0
const OVERCLOCK_AT := 45.0
const SUBJECT_SPEED := 4.2
const DRONE_PATROL := 2.4       # drone speed when nobody is heard
const DRONE_CHASE := 3.2        # drone speed while chasing a heard subject
const OVERCLOCK_MUL := 1.2
const DRONE_Y := 1.3
const KILL_R := 0.72
const HEAR_MOVE := 6            # path cells
const HEAR_STILL := 1
const HEAR_LOUD := 10
const LOUD_T := 1.6             # seconds a chip pickup stays audible
const MEMORY := 2.5             # seconds a drone keeps hunting the last heard spot
const STILL_SPEED := 1.0        # below this ground speed a subject counts as quiet
const PICK_R2 := 0.6 * 0.6
const CHIP_LOW := 3             # respawn a batch at or below this many chips
const CHIP_POOL := 12

var arena: Arena
var lamps := []
var drones := []
var chips := []
var chip_target := 0
var drone_mul := 1.0
var hear_move := HEAR_MOVE
var overclocked := false
var east := []                  # 1 = wall on the +X side of a cell
var south := []                 # 1 = wall on the +Z side of a cell
var nbr := []                   # open neighbour lists (N, E, S, W order)
var danger := []
var _queue := []
var _tmp_dist := []
var _tmp_mark := []
var _bot_dist := []
var _bot_par := []
var _danger_src := []
var _prompt_t := -1.0           # JS: setTimeout(() => hud.prompt(null), 4500)


## Cell centre coordinates.
static func _cx(i: int) -> float:
	return -HW + (float(i % COLS) + 0.5) * CELL


static func _cz(i: int) -> float:
	return -HD + (float(floori(float(i) / COLS)) + 0.5) * CELL


static func _filled(n: int, v: int) -> Array:
	var a := []
	a.resize(n)
	a.fill(v)
	return a


func build() -> void:
	make_scene({"fog_near": 20.0, "fog_far": 48.0, "ambient_intensity": 0.55})
	make_camera([0, 18.5, 8.2], [0, 0, 0.5], 50)

	# Scratch buffers for the grid searches (no per-tick allocations).
	_queue = _filled(N, 0)
	_tmp_dist = _filled(N, 0)
	_tmp_mark = _filled(N, 0)
	_bot_dist = _filled(N, 0)
	_bot_par = _filled(N, 0)
	danger = _filled(N, -1)
	_danger_src = []

	_generate_maze()

	# --- set dressing
	Env.floor_plane(scene, 60, 44, {"tex": "concrete", "tile": 3.0, "y": -0.02, "color": 0x6f6c66})
	Env.floor_plane(scene, HW * 2, HD * 2, {"tex": "plate", "tile": CELL, "y": 0.0, "color": 0x8e918c})
	var grill_mat := Mats.mat(0xb0b0aa, _vent_texture())
	var grill_geo := Geo.plane(CELL * 0.5, CELL * 0.5)
	for i in N:
		var c := i % COLS
		var r := floori(float(i) / COLS)
		if (c * 7 + r * 5) % 9 != 4:
			continue
		var g := Env.mesh(grill_geo, grill_mat, _cx(i), 0.012, _cz(i), {"cast": false})
		g.rotation.x = -PI / 2
		scene.add_child(g)
	Env.hazard_strip(scene, 0, -HD - 0.5, HW * 2 + 1.4, 0.5)
	Env.hazard_strip(scene, 0, HD + 0.5, HW * 2 + 1.4, 0.5)
	var back := Env.mesh(Geo.plane(48, 8), Mats.mat(0xffffff, Tex.wall(Vector2(12, 2))), 0, 3.5, -HD - 2.4, {"cast": false})
	scene.add_child(back)
	Env.stencil(scene, "VENT SECTOR 7", -5.5, 2.3, -HD - 2.35, {"w": 7.0, "h": 2.0, "opacity": 0.55})
	Env.stencil(scene, "DRONES HAVE RIGHT OF WAY", 6, 2.0, -HD - 2.35, {"w": 7.5, "h": 1.4, "opacity": 0.4})
	Env.pipe(scene, [-24, 4.3, -HD - 2.1], [24, 4.3, -HD - 2.1], 0.25)
	Env.pipe(scene, [-24, 3.6, -HD - 2.2], [24, 3.6, -HD - 2.2], 0.12, 0x5a3022)

	lamps = [
		Env.hanging_lamp(scene, -5.4, 7.2, -0.6, {"intensity": 50.0, "angle": 0.8, "color": 0xd6dcff}),
		Env.hanging_lamp(scene, 5.4, 7.2, 0.6, {"intensity": 50.0, "angle": 0.8, "color": 0xd6dcff}),
		Env.hanging_lamp(scene, 0, 7, 4.4, {"intensity": 22.0, "angle": 0.75, "shadow": false}),
	]

	# --- duct walls: merged straight runs, one shared unit box
	arena = Arena.new({"bounds": {"min_x": -HW, "max_x": HW, "min_z": -HD, "max_z": HD}, "shove_force": 10.0})
	var wall_mat := Mats.mat(0xa3a7a1, Tex.metal())
	var unit := Geo.box(1, 1, 1)
	for j in ROWS + 1:          # horizontal lines (constant z)
		var z := -HD + j * CELL
		var start := -1
		for c in COLS + 1:
			var has: bool = c < COLS and (j == 0 or j == ROWS or south[(j - 1) * COLS + c] == 1)
			if has and start < 0:
				start = c
			if not has and start >= 0:
				_add_run(unit, wall_mat, -HW + start * CELL - T / 2, -HW + c * CELL + T / 2, z - T / 2, z + T / 2)
				start = -1
	for i in COLS + 1:          # vertical lines (constant x)
		var x := -HW + i * CELL
		var start := -1
		for r in ROWS + 1:
			var has: bool = r < ROWS and (i == 0 or i == COLS or east[r * COLS + i - 1] == 1)
			if has and start < 0:
				start = r
			if not has and start >= 0:
				_add_run(unit, wall_mat, x - T / 2, x + T / 2, -HD + start * CELL - T / 2, -HD + r * CELL + T / 2)
				start = -1

	# --- subjects in the corners
	var corners := [0, N - 1, COLS - 1, N - COLS]
	for i in seats.size():
		var seat: Dictionary = seats[i]
		var cell: int = corners[i % 4]
		var x := _cx(cell)
		var z := _cz(cell)
		spawn_subject(seat, {"x": x, "z": z, "facing": atan2(-x, -z)})
		seat.actor = arena.add(ArenaActor.new({"player": seat.player, "ctrl": seat.ctrl, "subject": seat.subject, "x": x, "z": z, "speed": SUBJECT_SPEED}))
		seat.actor.seat = seat
		seat.actor.facing = atan2(-x, -z)
		seat.actor.data["loud_t"] = 0.0

	# --- drones (both built now so the light count never changes mid-round)
	drones = [_make_drone(scene), _make_drone(scene)]
	var d0: Dictionary = drones[0]
	_place_drone(d0, CENTER)
	d0.active = true
	d0.idle = 2.0
	drone_mul = 1.0
	hear_move = HEAR_MOVE
	overclocked = false

	# --- data chips (pooled): Blender board + die, procedural additive halo
	chip_target = 6 + seats.size()
	var board_mat := Mats.mat(0x1d6b34, null, {"emissive": 0x23b04a, "emissive_intensity": 0.75})
	var halo_geo := Geo.circle(0.34, 12)
	var halo_mat := Mats.glow(0x2bff6a, {"opacity": 0.22, "depth_write": false, "additive": true})
	chips = []
	for k in CHIP_POOL:
		var g := Node3D.new()
		var chip := Props.make("ventcrawl", "chip")
		_override_mat(chip, "m_none_1d6b34", board_mat)
		_no_shadow(chip)
		var halo := Env.mesh(halo_geo, halo_mat, 0, -0.26, 0, {"cast": false})
		halo.rotation.x = -PI / 2
		U.add(g, [chip, halo])
		g.visible = false
		scene.add_child(g)
		chips.append({"g": g, "cell": -1, "active": false, "pop": 1.0, "phase": k * 1.7})
	_spawn_chips(chip_target)


func _add_run(unit: Mesh, wall_mat: Material, min_x: float, max_x: float, min_z: float, max_z: float) -> void:
	var m := Env.mesh(unit, wall_mat, (min_x + max_x) / 2, WALL_H / 2, (min_z + max_z) / 2)
	m.scale = Vector3(max_x - min_x, WALL_H, max_z - min_z)
	scene.add_child(m)
	arena.add_wall(min_x, max_x, min_z, max_z)


# ------------------------------------------------------------------ maze

## Recursive-backtracker maze plus extra openings for loops.
func _generate_maze() -> void:
	east = _filled(N, 1)
	south = _filled(N, 1)
	var seen := _filled(N, 0)
	var start_cell := Rng.rand_int(0, N - 1)
	var stack := [start_cell]
	seen[start_cell] = 1
	while not stack.is_empty():
		var cur: int = stack[-1]
		var c := cur % COLS
		var r := floori(float(cur) / COLS)
		var opts := []
		if r > 0 and seen[cur - COLS] == 0:
			opts.append(0)
		if c < COLS - 1 and seen[cur + 1] == 0:
			opts.append(1)
		if r < ROWS - 1 and seen[cur + COLS] == 0:
			opts.append(2)
		if c > 0 and seen[cur - 1] == 0:
			opts.append(3)
		if opts.is_empty():
			stack.pop_back()
			continue
		var dir: int = Rng.pick(opts)
		var nxt: int = cur - COLS if dir == 0 else (cur + 1 if dir == 1 else (cur + COLS if dir == 2 else cur - 1))
		_open_wall(cur, dir)
		seen[nxt] = 1
		stack.append(nxt)
	# Knock out ~28% of the remaining inner walls (never leaving a wall-less vertex).
	var walls := []
	for i in N:
		var c := i % COLS
		var r := floori(float(i) / COLS)
		if c < COLS - 1 and east[i] == 1:
			walls.append(i * 2)
		if r < ROWS - 1 and south[i] == 1:
			walls.append(i * 2 + 1)
	var to_remove := roundi(walls.size() * 0.28)
	for w in Rng.shuffle(walls):
		if to_remove <= 0:
			break
		if _try_remove(int(w) >> 1, (int(w) & 1) == 1):
			to_remove -= 1
	# Spawn corners get a second exit where possible (no instant dead ends).
	_try_remove(0, false)
	_try_remove(0, true)
	_try_remove(COLS - 2, false)
	_try_remove(COLS - 1, true)
	_try_remove(N - COLS - COLS, true)
	_try_remove(N - COLS, false)
	_try_remove(N - 1 - COLS, true)
	_try_remove(N - 2, false)

	# Neighbour lists (N, E, S, W order).
	nbr = []
	for i in N:
		var c := i % COLS
		var r := floori(float(i) / COLS)
		var list := []
		if r > 0 and south[i - COLS] == 0:
			list.append(i - COLS)
		if c < COLS - 1 and east[i] == 0:
			list.append(i + 1)
		if r < ROWS - 1 and south[i] == 0:
			list.append(i + COLS)
		if c > 0 and east[i - 1] == 0:
			list.append(i - 1)
		nbr.append(list)


func _open_wall(cell: int, dir: int) -> void:
	if dir == 0:
		south[cell - COLS] = 0
	elif dir == 1:
		east[cell] = 0
	elif dir == 2:
		south[cell] = 0
	else:
		east[cell - 1] = 0


## Remove the east/south wall of `cell` unless that leaves a vertex with no walls.
func _try_remove(cell: int, is_south: bool) -> bool:
	var c := cell % COLS
	var r := floori(float(cell) / COLS)
	var arr: Array = south if is_south else east
	if (r >= ROWS - 1) if is_south else (c >= COLS - 1):
		return false
	if arr[cell] == 0:
		return false
	arr[cell] = 0
	var ok: bool
	if is_south:
		ok = _vertex_walls(c, r + 1) > 0 and _vertex_walls(c + 1, r + 1) > 0
	else:
		ok = _vertex_walls(c + 1, r) > 0 and _vertex_walls(c + 1, r + 1) > 0
	if not ok:
		arr[cell] = 1
	return ok


## Number of wall segments meeting at grid vertex (vx, vy); border vertices always count as walled.
func _vertex_walls(vx: int, vy: int) -> int:
	if vx <= 0 or vx >= COLS or vy <= 0 or vy >= ROWS:
		return 9
	var ul := (vy - 1) * COLS + (vx - 1)
	return int(east[ul]) + int(east[ul + COLS]) + int(south[ul]) + int(south[ul + 1])


func cell_at(x: float, z: float) -> int:
	var c := clampi(floori((x + HW) / CELL), 0, COLS - 1)
	var r := clampi(floori((z + HD) / CELL), 0, ROWS - 1)
	return r * COLS + c


## Breadth-first search over open ducts. Writes step counts (-1 = unreached) into `out`.
func bfs(sources: Array, out: Array, blocked: Callable = Callable(), par = null) -> Array:
	out.fill(-1)
	var q := _queue
	var head := 0
	var tail := 0
	var check := blocked.is_valid()
	for s in sources:
		if out[s] >= 0:
			continue
		out[s] = 0
		if par != null:
			par[s] = -1
		q[tail] = s
		tail += 1
	while head < tail:
		var cur: int = q[head]
		head += 1
		var nb: Array = nbr[cur]
		var nd: int = out[cur] + 1
		for n in nb:
			if out[n] >= 0 or (check and blocked.call(n)):
				continue
			out[n] = nd
			if par != null:
				par[n] = cur
			q[tail] = n
			tail += 1
	return out


## First cell on the BFS path from `start` to `goal` (or `start` if none).
func _first_step(par: Array, start_c: int, goal: int) -> int:
	if goal == start_c:
		return start_c
	var c := goal
	for guard in N:
		var p: int = par[c]
		if p == start_c:
			return c
		if p < 0:
			return start_c
		c = p
	return start_c


# ----------------------------------------------------------------- chips

## Top the chip count up to `target`, away from subjects and drones. Returns how many appeared.
func _spawn_chips(target: int) -> int:
	var active := 0
	for ch in chips:
		if ch.active:
			active += 1
	if active >= target:
		return 0
	var src := []
	for s in seats:
		if s.alive and s.actor:
			src.append(cell_at(s.actor.pos.x, s.actor.pos.z))
	for d in drones:
		if d.active:
			src.append(cell_at(d.x, d.z))
	var dist := bfs(src, _tmp_dist)
	var taken := _tmp_mark
	taken.fill(0)
	for ch in chips:
		if ch.active:
			taken[ch.cell] = 1
	var spawned := 0
	for ch in chips:
		if active >= target:
			break
		if ch.active:
			continue
		var cands := []
		for i in N:
			if taken[i] == 0 and dist[i] >= 3:
				cands.append(i)
		if cands.is_empty():
			for i in N:
				if taken[i] == 0:
					cands.append(i)
		if cands.is_empty():
			break
		var cell: int = Rng.pick(cands)
		taken[cell] = 1
		ch.cell = cell
		ch.active = true
		ch.pop = 0.0
		ch.g.visible = true
		ch.g.position = Vector3(_cx(cell), 0.32, _cz(cell))
		active += 1
		spawned += 1
	return spawned


# ---------------------------------------------------------------- drones

func _make_drone(scn: Node3D) -> Dictionary:
	var g := Node3D.new()
	# Blender model: shell + band + arms, four rotor children and the eye.
	var model := Props.make("ventcrawl", "drone")
	g.add_child(model)
	var rotors := []
	for k in 4:
		rotors.append(Subject._find(model, "rotor_%d" % k))
	var eye_mat := Mats.glow(0xff2010)
	_override_mat(model, "g_none_ff2010", eye_mat)
	# Scanning cone (apex at the drone, tilted forward, sweeps side to side).
	var pivot := Node3D.new()
	pivot.rotation_order = EULER_ORDER_YXZ
	pivot.rotation.x = -0.5
	pivot.position = Vector3(0, -0.05, 0.2)
	var cone_mat := Mats.glow(0xff2a1a, {"opacity": 0.14, "depth_write": false, "additive": true, "double_side": true})
	var cone := Env.mesh(Geo.cone(0.5, 1.45, 14, true), cone_mat, 0, -0.725, 0, {"cast": false})
	pivot.add_child(cone)
	g.add_child(pivot)
	var light := Env.point_light(0xff2a1a, 0.0, 4.5, 1.6)
	light.position = Vector3(0, -0.3, 0.2)
	g.add_child(light)
	g.visible = false
	scn.add_child(g)
	# Red spot where the scanner touches the floor.
	var spot_mat := Mats.glow(0xff2a1a, {"opacity": 0.25, "depth_write": false, "additive": true})
	var spot := Env.mesh(Geo.circle(0.5, 16), spot_mat, 0, 0.025, 0, {"cast": false})
	spot.rotation.x = -PI / 2
	spot.visible = false
	scn.add_child(spot)
	return {
		"g": g, "rotors": rotors, "eye_mat": eye_mat, "pivot": pivot, "cone_mat": cone_mat, "spot": spot, "spot_mat": spot_mat, "light": light,
		"active": false, "warm": 0.0, "idle": 0.0, "x": 0.0, "z": 0.0, "wp": CENTER, "homing": false,
		"target": null, "goal": CENTER, "patrol": -1, "memory": 0.0,
		"heading": 0.0, "yaw": 0.0, "bob": 0.0, "scan": 0.0, "flash": 0.0,
		"dist": _filled(N, -1), "goal_dist": _filled(N, -1),
	}


func _place_drone(d: Dictionary, cell: int) -> void:
	d.x = _cx(cell)
	d.z = _cz(cell)
	d.wp = cell
	d.goal = cell
	d.patrol = -1
	d.memory = 0.0
	d.homing = false
	d.target = null
	d.g.visible = true
	d.spot.visible = true
	d.g.position = Vector3(d.x, DRONE_Y, d.z)


## Second drone: drops in on the cell farthest (by duct) from every living subject.
func _deploy_second() -> void:
	var d: Dictionary = drones[1]
	var src := []
	for s in seats:
		if s.alive:
			src.append(cell_at(s.actor.pos.x, s.actor.pos.z))
	var cell := CENTER
	if not src.is_empty():
		var dist := bfs(src, _tmp_dist)
		var bd := -1
		for i in N:
			if dist[i] > bd:
				bd = dist[i]
				cell = i
	_place_drone(d, cell)
	d.active = true
	d.warm = 1.4
	d.idle = 0.0
	hud.banner("SECOND DRONE DEPLOYED", 1400, "danger")
	Sfx.play("horn", {"vol": 0.5})


func _move_drone(d: Dictionary, tx: float, tz: float, step: float) -> void:
	var dx: float = tx - d.x
	var dz: float = tz - d.z
	var length := U.hypot(dx, dz)
	if length < 1e-4:
		return
	var m := minf(step, length)
	d.x += dx / length * m
	d.z += dz / length * m
	d.heading = atan2(dx, dz)


func _update_drone(d: Dictionary, dt: float) -> void:
	if not d.active:
		return
	if d.warm > 0:
		d.warm -= dt
		return
	if d.idle > 0:
		d.idle -= dt
		return
	var pc := cell_at(d.x, d.z)
	bfs([pc], d.dist)

	# Listen: nearest audible subject by duct distance (seat order breaks ties).
	var best = null
	var bd := 999
	for seat in seats:
		if not seat.alive:
			continue
		var a: ArenaActor = seat.actor
		var pd: int = d.dist[cell_at(a.pos.x, a.pos.z)]
		if pd < 0:
			continue
		var moving := U.hypot(a.vel.x, a.vel.z) > STILL_SPEED
		var hear: int = HEAR_LOUD if float(a.data.loud_t) > 0.0 else (hear_move if moving else HEAR_STILL)
		if pd <= hear and pd < bd:
			bd = pd
			best = seat
	if best != null and not is_same(best, d.target):
		Sfx.play("sonar", {"vol": 0.35})
	d.target = best
	var tc := -1
	if best != null:
		tc = cell_at(best.actor.pos.x, best.actor.pos.z)
		d.goal = tc
		d.memory = MEMORY
	elif d.memory > 0:
		d.memory -= dt

	var step: float = (DRONE_CHASE if best != null else DRONE_PATROL) * drone_mul * dt
	if best != null and (tc == pc or tc == d.wp):
		# Same or next duct cell: go straight for them.
		d.homing = true
		_move_drone(d, best.actor.pos.x, best.actor.pos.z, step)
		return
	if d.homing:
		d.homing = false
		d.wp = pc
	var tx := _cx(d.wp)
	var tz := _cz(d.wp)
	if U.hypot(tx - d.x, tz - d.z) > step:
		_move_drone(d, tx, tz, step)
		return
	# Reached a cell centre: pick the next one along the shortest duct path.
	d.x = tx
	d.z = tz
	if best == null:
		if d.memory > 0 and d.wp == d.goal:
			d.memory = 0.0
		if d.memory <= 0:
			if d.patrol < 0 or d.wp == d.patrol:
				d.patrol = Rng.rand_int(0, N - 1)
			d.goal = d.patrol
	var gd := bfs([d.goal], d.goal_dist)
	var nxt: int = d.wp
	var nd: int = 999 if gd[d.wp] < 0 else gd[d.wp]
	for n in nbr[d.wp]:
		var v: int = gd[n]
		if v >= 0 and v < nd:
			nd = v
			nxt = n
	d.wp = nxt


## Multi-source distance field from the drones (read by the bots).
func _compute_danger() -> void:
	var src := _danger_src
	src.clear()
	for d in drones:
		if d.active:
			src.append(cell_at(d.x, d.z))
			src.append(d.wp)
	if not src.is_empty():
		bfs(src, danger)
	else:
		danger.fill(-1)


# ------------------------------------------------------------- lifecycle

func start() -> void:
	drones[0].idle = 2.0
	_compute_danger()
	hud.banner("DRONE ONLINE", 1200, "danger")
	Sfx.play("sonar", {"vol": 0.5})
	hud.prompt("{MOVE} crawl · {B} shove · stand still to stay quiet")
	_prompt_t = 4.5


func preview(dt: float) -> void:
	for s in seats:
		s.subject.animate(dt, 0)
	_animate(dt)


func update(dt: float) -> void:
	if _prompt_t > 0.0:
		_prompt_t -= dt
		if _prompt_t <= 0.0:
			hud.prompt("")
	var playing := state == "play"
	arena.step(dt, playing)
	if playing:
		_play(dt)
	_animate(dt)


func _play(dt: float) -> void:
	for seat in seats:
		if seat.alive:
			seat.actor.data.loud_t = maxf(0.0, float(seat.actor.data.loud_t) - dt)

	if not drones[1].active and time >= SECOND_AT:
		_deploy_second()
	if not overclocked and time >= OVERCLOCK_AT:
		overclocked = true
		drone_mul = OVERCLOCK_MUL
		hear_move = HEAR_MOVE + 2
		hud.banner("DRONES OVERCLOCKED", 1300, "danger")
		Sfx.play("grind", {"vol": 0.5})

	for d in drones:
		_update_drone(d, dt)

	# Drone contact.
	for d in drones:
		if not d.active or d.warm > 0:
			continue
		for seat in seats:
			if not seat.alive:
				continue
			var a: ArenaActor = seat.actor
			var dx: float = a.pos.x - d.x
			var dz: float = a.pos.z - d.z
			if dx * dx + dz * dz < KILL_R * KILL_R:
				fx.sparks(Vector3(d.x, DRONE_Y - 0.15, d.z), {"color": 0xff3a2a, "count": 10})
				kill(seat, "shot", {"dir": Vector3(dx, 0, dz)})
				d.flash = 0.25
				d.target = null
				d.memory = 0.0

	# Chip pickups.
	var left := 0
	for ch in chips:
		if not ch.active:
			continue
		var x := _cx(ch.cell)
		var z := _cz(ch.cell)
		for seat in seats:
			if not seat.alive:
				continue
			var a: ArenaActor = seat.actor
			var dx := a.pos.x - x
			var dz := a.pos.z - z
			if dx * dx + dz * dz < PICK_R2:
				ch.active = false
				ch.g.visible = false
				seat.score += 1
				a.data.loud_t = LOUD_T
				Sfx.play("select", {"vol": 0.6})
				fx.sparks(Vector3(x, 0.4, z), {"color": 0x5aff7a, "count": 8, "speed": 3.0})
				break
		if ch.active:
			left += 1
	if left <= CHIP_LOW and _spawn_chips(chip_target) > 0:
		hud.banner("NEW CHIPS DETECTED", 1000)
		Sfx.play("beep", {"vol": 0.4})

	_compute_danger()

	# HUD
	for seat in seats:
		hud.set_stat(seat, "CHIPS %d" % int(seat.score))
		if not seat.alive:
			hud.set_status(seat, "NEUTRALIZED")
			continue
		var heard := false
		for d in drones:
			if d.active and is_same(d.target, seat):
				heard = true
		var a: ArenaActor = seat.actor
		var still := U.hypot(a.vel.x, a.vel.z) <= STILL_SPEED and float(a.data.loud_t) <= 0.0
		hud.set_status(seat, "HEARD" if heard else ("QUIET" if still else ""))
	hud.set_timer(maxf(0.0, ROUND_TIME - time))

	# Ending
	if time >= ROUND_TIME:
		hud.banner("TIME UP", 1500)
		Sfx.play("buzz")
		end(2.4)
		return
	if alive_seats().is_empty():
		hud.banner("VENTS CLEARED", 1500, "danger")
		end(2.4)
		return
	check_last_standing()


## Purely cosmetic animation (chips, drones, lamp flicker).
func _animate(dt: float) -> void:
	for ch in chips:
		if not ch.active:
			continue
		ch.pop = minf(1.0, ch.pop + dt * 3)
		var g: Node3D = ch.g
		g.scale = Vector3.ONE * maxf(0.001, ch.pop)
		g.rotation.y += dt * 1.6
		g.position.y = 0.32 + sin(clock * 3 + ch.phase) * 0.05
	for d in drones:
		var light: OmniLight3D = d.light
		if not d.active:
			light.light_energy = 0.0
			continue
		d.bob += dt * 3
		var y: float = DRONE_Y + sin(d.bob) * 0.06 + (d.warm * 5.0 if d.warm > 0 else 0.0)
		var g: Node3D = d.g
		g.position = Vector3(d.x, y, d.z)
		d.yaw += U.angle_diff(d.yaw, d.heading) * minf(1.0, dt * 8)
		g.rotation.y = d.yaw
		for r in d.rotors:
			if r:
				r.rotation.y += dt * 40
		var hot := 1.0 if d.target != null else 0.0
		d.scan += dt * (6.0 if hot > 0 else 2.2)
		var sweep: float = sin(d.scan) * (0.25 if hot > 0 else 0.7)
		d.pivot.rotation.y = sweep
		var ang: float = d.yaw + sweep
		d.spot.position = Vector3(d.x + sin(ang) * 0.7, 0.025, d.z + cos(ang) * 0.7)
		d.spot.visible = d.warm <= 0
		Mats.set_opacity(d.cone_mat, 0.12 + hot * 0.1)
		Mats.set_opacity(d.spot_mat, 0.22 + hot * 0.22)
		d.flash = maxf(0.0, d.flash - dt)
		light.light_energy = ((1.0 if d.warm > 0 else 3.0) + hot * 2 + d.flash * 30) * Env.LIGHT_K
		var blink: bool = fmod(d.scan, 1.0) < 0.5 if hot > 0 else true
		Mats.set_color(d.eye_mat, 0xff2010 if blink else 0x4a0806)
	var fl_light: Light3D = lamps[2].light
	fl_light.light_energy = 22.0 * (0.8 + 0.2 * sin(clock * 23) * sin(clock * 7.3)) * Env.LIGHT_K


# ------------------------------------------------------------- placement

## The living by chips, then the dead by chips (later death breaks ties).
func placement() -> Array:
	var alive := seats.filter(func(s): return s.alive)
	alive.sort_custom(func(a, b): return a.score > b.score)
	var dead := seats.filter(func(s): return not s.alive)
	dead.sort_custom(func(a, b): return a.score > b.score or (a.score == b.score and a.death_time > b.death_time))
	var tiers := Minigame.group_by(alive, func(s): return s.score)
	tiers.append_array(Minigame.group_by(dead, func(s): return "%s|%.3f" % [s.score, s.death_time]))
	return tiers


# ------------------------------------------------------------------ bots

func bot_think(seat: Dictionary, dt: float) -> void:
	var a: ArenaActor = seat.actor
	var brain: Dictionary = seat.brain
	var mem: Dictionary = brain.memory
	if not mem.has("next"):
		mem["next"] = -1
		mem["t"] = 0.0
		mem["mode"] = "chip"
		mem["b_prev"] = false
	var my := cell_at(a.pos.x, a.pos.z)
	var avoid_r := floori(1 + brain.difficulty * 2.4)   # 1 / 2 / 3 cells of look-ahead
	mem.t -= dt
	var adjacent: bool = mem.next == my or nbr[my].has(mem.next)
	# Replan on arrival, when knocked off course, or every reaction interval (hiding bots
	# only re-check on the interval so they actually stay still).
	var arrived: bool = my == mem.next and mem.mode != "hide"
	if mem.next < 0 or arrived or not adjacent or mem.t <= 0:
		_bot_plan(seat, my, avoid_r)

	if mem.next == my:
		AI.steer_to(a, _cx(my), _cz(my), {"arrive": 0.3 if mem.mode == "hide" else 0.05, "slow": 0.6})
	else:
		_steer_cell(a, my, mem.next)

	# Opportunistic shove at a rival right in front.
	var want_b := false
	if mem.mode != "hide":
		for o in seats:
			if is_same(o, seat) or not o.alive:
				continue
			var dx: float = o.actor.pos.x - a.pos.x
			var dz: float = o.actor.pos.z - a.pos.z
			var d := U.hypot(dx, dz)
			if d < 1.15 and d > 0.01 and (dx * sin(a.facing) + dz * cos(a.facing)) / d > 0.6 and Rng.random() < 0.03 * brain.difficulty:
				want_b = true
	a.ctrl.set_buttons(false, want_b and not mem.b_prev)
	mem.b_prev = want_b and not mem.b_prev


func _dg(i: int) -> int:
	var v: int = danger[i]
	return 99 if v < 0 else v


## Decide the next cell: flee if a drone is close, else the nearest chip on a safe path, else hide.
func _bot_plan(seat: Dictionary, my: int, avoid_r: int) -> void:
	var brain: Dictionary = seat.brain
	var mem: Dictionary = brain.memory
	mem.t = 0.2 + brain.reaction
	var careless: bool = Rng.random() < brain.error * 0.3   # occasional blunder: ignores the drones for one step
	var here := _dg(my)
	if here <= avoid_r and not careless:
		_bot_flee(seat, my, here)
		return
	var dist := _bot_dist
	var par := _bot_par
	bfs([my], dist, Callable() if careless else func(n): return _dg(n) <= avoid_r, par)
	var best := -1
	var bd := 999
	for ch in chips:
		if not ch.active:
			continue
		var d: int = dist[ch.cell]
		if d >= 0 and d < bd:
			bd = d
			best = ch.cell
	if best < 0:
		mem.mode = "hide"   # no safe chip: keep still and quiet
		mem.next = my
		return
	mem.mode = "chip"
	mem.next = _first_step(par, my, best)


## Run to the safest reachable cell nearby, never stepping closer to a drone, avoiding dead ends.
func _bot_flee(seat: Dictionary, my: int, here: int) -> void:
	var mem: Dictionary = seat.brain.memory
	var dist := _bot_dist
	var par := _bot_par
	bfs([my], dist, (func(n): return _dg(n) < here) if here > 0 else Callable(), par)
	var best := my
	var bs := -1e9
	for i in N:
		var d: int = dist[i]
		if d < 0 or d > 6:
			continue
		var s := mini(_dg(i), 8) * 2.0 - d * 0.5
		if nbr[i].size() == 1:
			s -= 3   # dead ends are coffins
		if s > bs:
			bs = s
			best = i
	mem.mode = "flee"
	mem.next = _first_step(par, my, best)


## Steer from cell `from_c` into the adjacent cell `to_c`, keeping to the duct's centre line.
func _steer_cell(a: ArenaActor, from_c: int, to_c: int) -> void:
	var mx: float
	var mz: float
	if from_c % COLS != to_c % COLS:
		mx = signf(_cx(to_c) - a.pos.x)
		var off := _cz(from_c) - a.pos.z
		mz = clampf(off * 3, -1, 1)
		if absf(off) > 0.22:
			mx *= 0.35
	else:
		mz = signf(_cz(to_c) - a.pos.z)
		var off := _cx(from_c) - a.pos.x
		mx = clampf(off * 3, -1, 1)
		if absf(off) > 0.22:
			mz *= 0.35
	var length := U.hypot(mx, mz)
	if length == 0.0:
		length = 1.0
	a.ctrl.set_move(mx / length, mz / length)


func dispose() -> void:
	for seat in seats:
		seat.actor = null   # break the seat <-> actor reference cycle
	super.dispose()


# ------------------------------------------------------------- helpers

## Give every surface of `node` that uses the Blender material `mat_name` the material `m`.
static func _override_mat(node: Node, mat_name: String, m: Material) -> void:
	if node is MeshInstance3D:
		var mi: MeshInstance3D = node
		if mi.mesh:
			for i in mi.mesh.get_surface_count():
				var src := mi.mesh.surface_get_material(i)
				if src and src.resource_name == mat_name:
					mi.set_surface_override_material(i, m)
	for c in node.get_children():
		_override_mat(c, mat_name, m)


static func _no_shadow(node: Node) -> void:
	if node is GeometryInstance3D:
		(node as GeometryInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for c in node.get_children():
		_no_shadow(c)


## Floor vent grille (cosmetic texture; cached).
static func _vent_texture() -> Dictionary:
	return Tex.image("ventcrawlGrille", 64, func(img: Image, s: int):
		img.fill(Color("#161716"))
		var slat := Color("#4b4e4a")
		var y := 6
		while y < s - 4:
			img.fill_rect(Rect2i(5, y, s - 10, 3), slat)
			y += 8
		var rim := Color("#61645f")
		img.fill_rect(Rect2i(0, 0, s, 4), rim)
		img.fill_rect(Rect2i(0, s - 4, s, 4), rim)
		img.fill_rect(Rect2i(0, 0, 4, s), rim)
		img.fill_rect(Rect2i(s - 4, 0, 4, s), rim)
		for py in s:
			for px in s:
				var c := img.get_pixel(px, py)
				var n := (randf() - 0.5) * 24.0
				img.set_pixel(px, py, Color(clampf(c.r + (n + 4.0) / 255.0, 0, 1), clampf(c.g + n / 255.0, 0, 1), clampf(c.b + (n - 3.0) / 255.0, 0, 1))))

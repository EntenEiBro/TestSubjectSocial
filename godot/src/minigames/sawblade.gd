extends Minigame
## SAWBLADE RICOCHET — dodge bouncing circular saws in a pen lined with
## reciprocating hacksaws. Shove rivals into the blades. Last one standing.
## Blade and hacksaw models: blender/build_props.py ("sawblade").

const META := {
	"id": "sawblade",
	"title": "SAWBLADE RICOCHET",
	"tagline": "The walls bite. The blades bounce.",
	"category": "Survival",
	"controls": [{"input": "move", "label": "Move"}, {"input": "b", "label": "Shove"}],
	"objective": "Be the last subject standing.",
	"rules": ["Circular saws ricochet around the pen — more join over time.", "The walls are lined with hacksaws. Touching them is fatal.", "Shove rivals into the blades."],
}

const HALF_W := 8.0     # inner pen half-extents
const HALF_D := 5.5
const EDGE := 0.55      # hacksaw kill depth from wall
const BLADE_R := 0.75
const SPIN := 5.5       # blade spin, rad/s (counter-clockwise from above)

var arena: Arena
var hacksaws := []
var blades := []
var spawn_timer: TickTimer


func build() -> void:
	make_scene({"fog_near": 18.0, "fog_far": 50.0})
	make_camera([0, 15.5, 11.5], [0, 0, 0.6], 48)

	Env.floor_plane(scene, 40, 30, {"tex": "plate", "tile": 2.0})
	Env.floor_plane(scene, HALF_W * 2, HALF_D * 2, {"tex": "tiles", "tile": 2.0, "y": 0.005})
	Env.stencil(scene, "KEEP MOVING", 0, 0.02, -2.5, {"w": 7.0, "h": 2.0, "opacity": 0.25}).rotation.x = -PI / 2

	# Pen walls with hacksaw strips facing inward.
	var wall_mat := Mats.mat(0xffffff, Tex.rust(Vector2(4, 1)))
	Env.block(scene, 0, 0.6, -HALF_D - 0.3, HALF_W * 2 + 1.2, 1.2, 0.6, wall_mat)
	Env.block(scene, 0, 0.6, HALF_D + 0.3, HALF_W * 2 + 1.2, 1.2, 0.6, wall_mat)
	Env.block(scene, -HALF_W - 0.3, 0.6, 0, 0.6, 1.2, HALF_D * 2, wall_mat)
	Env.block(scene, HALF_W + 0.3, 0.6, 0, 0.6, 1.2, HALF_D * 2, wall_mat)
	_add_saw(0, -HALF_D + 0.05, HALF_W * 2, 0)
	_add_saw(0, HALF_D - 0.05, HALF_W * 2, PI)
	_add_saw(-HALF_W + 0.05, 0, HALF_D * 2, PI / 2)
	_add_saw(HALF_W - 0.05, 0, HALF_D * 2, -PI / 2)
	Env.hazard_strip(scene, 0, -HALF_D + 0.4, HALF_W * 2, 0.4, 0.01)
	Env.hazard_strip(scene, 0, HALF_D - 0.4, HALF_W * 2, 0.4, 0.01)

	Env.hanging_lamp(scene, -4, 7, 0, {"intensity": 90.0, "angle": 0.9})
	Env.hanging_lamp(scene, 4, 7, 0, {"intensity": 90.0, "angle": 0.9})

	# Arena + avatars
	arena = Arena.new({"bounds": {"min_x": -HALF_W, "max_x": HALF_W, "min_z": -HALF_D, "max_z": HALF_D}, "shove_force": 13.0})
	var spots := [[-3.0, -2.0], [3.0, -2.0], [-3.0, 2.0], [3.0, 2.0]]
	for i in seats.size():
		var seat: Dictionary = seats[i]
		var x: float = spots[i][0]
		var z: float = spots[i][1]
		spawn_subject(seat, {"x": x, "z": z})
		seat.actor = arena.add(ArenaActor.new({"player": seat.player, "ctrl": seat.ctrl, "subject": seat.subject, "x": x, "z": z}))
		seat.actor.seat = seat
	arena.on_shove = func(a: ArenaActor, b: ArenaActor):
		b.data["last_shover"] = a.seat
		b.data["shoved_at"] = time

	spawn_timer = TickTimer.new(7.0, true)


## A hacksaw strip (Blender model, 16 m or 11 m) along a wall; the strip saws back and forth.
func _add_saw(x: float, z: float, length: float, rot_y: float) -> void:
	var g := Node3D.new()
	var strip := Props.make("sawblade", "hacksaw_%d" % int(length))
	g.add_child(strip)
	g.position = Vector3(x, 0.55, z)
	g.rotation.y = rot_y
	scene.add_child(g)
	hacksaws.append({"g": g, "strip": strip, "phase": Rng.rand(0, 6)})


## Add a spinning saw blade entering from a random edge.
func spawn_blade() -> void:
	var g := Props.make("sawblade", "blade")
	var angle := Rng.rand(0, TAU)
	var spd := 6.0 + blades.size() * 0.6
	var x := Rng.rand(-HALF_W + 2, HALF_W - 2)
	var z := -HALF_D + 1.2 if Rng.random() < 0.5 else HALF_D - 1.2
	var b := {"g": g, "x": x, "z": z, "vx": cos(angle) * spd, "vz": sin(angle) * spd, "warm": 1.0}
	g.position = Vector3(x, 0.7, z)
	g.scale = Vector3.ONE * 0.01
	scene.add_child(g)
	blades.append(b)
	Sfx.play("saw")
	hud.banner("BLADE RELEASED" if blades.size() == 1 else "BLADE %d" % blades.size(), 1000, "danger")


func start() -> void:
	spawn_blade()


func preview(dt: float) -> void:
	_animate_saws(dt)
	for s in seats:
		s.subject.animate(dt, 0)


func _animate_saws(dt: float) -> void:
	for h in hacksaws:
		h.phase += dt * 14
		h.strip.position.x = sin(h.phase) * 0.2


func update(dt: float) -> void:
	_animate_saws(dt)
	var playing := state == "play"
	arena.step(dt, playing)
	if not playing:
		return

	if spawn_timer.tick(dt) and blades.size() < 6:
		spawn_blade()

	# Blades bounce and speed up slowly
	for b in blades:
		b.warm = max(0.0, b.warm - dt)
		var g: Node3D = b.g
		g.scale = Vector3.ONE * min(1.0, g.scale.x + dt * 3)
		var accel := 1.0 + dt * 0.02
		b.vx *= accel
		b.vz *= accel
		b.x += b.vx * dt
		b.z += b.vz * dt
		var before := Vector2(b.vx, b.vz)
		if b.x < -HALF_W + BLADE_R:
			b.x = -HALF_W + BLADE_R
			b.vx = absf(b.vx)
		elif b.x > HALF_W - BLADE_R:
			b.x = HALF_W - BLADE_R
			b.vx = -absf(b.vx)
		if b.z < -HALF_D + BLADE_R:
			b.z = -HALF_D + BLADE_R
			b.vz = absf(b.vz)
		elif b.z > HALF_D - BLADE_R:
			b.z = HALF_D - BLADE_R
			b.vz = -absf(b.vz)
		if before != Vector2(b.vx, b.vz):
			Sfx.play("clank", {"vol": 0.4})
			fx.sparks(Vector3(b.x, 0.7, b.z), {"count": 6})
		g.position = Vector3(b.x, 0.7, b.z)
		# Spin (visual only). 16 identical teeth: much faster than ~6 rad/s
		# steps close to a whole tooth per frame and looks frozen (wagon-wheel effect).
		g.rotation.y = wrapf(g.rotation.y + dt * SPIN, -PI, PI)

	# Lethal contacts
	for seat in alive_seats():
		var a: ArenaActor = seat.actor
		for b in blades:
			if b.warm > 0.7:
				continue
			if U.hypot(a.pos.x - b.x, a.pos.z - b.z) < BLADE_R + a.radius * 0.8:
				_credit(a)
				kill(seat, "slice", {"dir": Vector3(b.vx, 0, b.vz)})
				break
		if not seat.alive:
			continue
		var near_wall := a.pos.x < -HALF_W + EDGE or a.pos.x > HALF_W - EDGE or a.pos.z < -HALF_D + EDGE or a.pos.z > HALF_D - EDGE
		if near_wall:
			_credit(a)
			kill(seat, "slice", {"dir": Vector3(-a.pos.x, 0, -a.pos.z), "force": 0.8})
	for seat in seats:
		hud.set_stat(seat, "ALIVE" if seat.alive else "SHREDDED")
	hud.set_timer(-1)
	check_last_standing()


## Credit a recent shover (within 1.5s) with a kill for the "Saw Feeder" commendation.
func _credit(victim: ArenaActor) -> void:
	var by = victim.data.get("last_shover")
	if by != null and time - float(victim.data.get("shoved_at", -99.0)) < 1.5:
		progress(by, "sawFeeder")
		hud.feed("%s fed the saws" % by.player.name(), by.player.color)


func bot_think(seat: Dictionary, dt: float) -> void:
	var a: ArenaActor = seat.actor
	var brain: Dictionary = seat.brain
	a.ctrl.set_buttons(false, false)
	# Danger vector: sum of repulsion from blades (with look-ahead) and walls.
	var fx_ := 0.0
	var fz := 0.0
	for b in blades:
		var px: float = b.x + b.vx * brain.reaction
		var pz: float = b.z + b.vz * brain.reaction
		var dx := a.pos.x - px
		var dz := a.pos.z - pz
		var d := U.hypot(dx, dz)
		if d < 4.2:
			var w := (4.2 - d) / 4.2
			var dd := d if d != 0.0 else 1.0
			fx_ += dx / dd * w * 3
			fz += dz / dd * w * 3
	fx_ += _wall_push(a.pos.x, -HALF_W, HALF_W) * 1.5
	fz += _wall_push(a.pos.z, -HALF_D, HALF_D) * 1.5
	if U.hypot(fx_, fz) > 0.3:
		a.ctrl.set_move(fx_, fz)
		return
	# Hunt: approach a rival who is near a wall and shove them outward.
	var n = AI.nearest(a, arena.actors)
	if n != null and n.dist < 4 and Rng.random() < brain.difficulty:
		var t: ArenaActor = n.actor
		# Approach from the inside so the shove sends them toward the wall.
		var out := Vector3(t.pos.x, 0, t.pos.z).normalized()
		AI.steer_to(a, t.pos.x - out.x * 0.9, t.pos.z - out.z * 0.9, {"arrive": 0.3})
		if n.dist < 1.3 and Rng.random() < 0.15:
			a.facing = atan2(t.pos.x - a.pos.x, t.pos.z - a.pos.z)
			a.ctrl.set_buttons(false, true)
	else:
		AI.wander(a, brain, dt, {"min_x": -HALF_W + 2, "max_x": HALF_W - 2, "min_z": -HALF_D + 2, "max_z": HALF_D - 2})


static func _wall_push(v: float, lo: float, hi: float) -> float:
	if v < lo + 2.2:
		return lo + 2.2 - v
	if v > hi - 2.2:
		return -(v - (hi - 2.2))
	return 0.0


func dispose() -> void:
	for seat in seats:
		seat.actor = null   # break the seat <-> actor reference cycle
	super.dispose()

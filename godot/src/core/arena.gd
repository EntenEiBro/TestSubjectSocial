class_name Arena
extends RefCounted
## Lightweight top-down arena physics shared by most rounds. Avatars are
## circles on the XZ plane; the Arena resolves movement, knockback, wall
## (AABB / circle) collisions, body separation and the universal shove (B).
##
## Screen-space convention used by every camera: pushing the stick "up" moves
## toward -Z (away from the camera), "right" moves toward +X.
##
## Positions are quantised to 1/4096 each step so tiny floating-point
## differences between devices can't snowball in online (lockstep) rounds.

const Q := 4096.0

var bounds := {"min_x": -10.0, "max_x": 10.0, "min_z": -10.0, "max_z": 10.0}
var walls := []     # {min_x, max_x, min_z, max_z}
var circles := []   # {x, z, r}
var actors := []
var shove_enabled := true
var shove_force := 11.0
var on_shove: Callable = Callable()   # func(attacker, victim)


## opts: bounds {min_x, max_x, min_z, max_z}, shove (true), shove_force (11)
func _init(opts: Dictionary = {}) -> void:
	if opts.has("bounds"):
		bounds = opts.bounds
	shove_enabled = opts.get("shove", true)
	shove_force = opts.get("shove_force", 11.0)


func add(actor: ArenaActor) -> ArenaActor:
	actors.append(actor)
	return actor


func add_wall(min_x: float, max_x: float, min_z: float, max_z: float) -> Dictionary:
	var w := {"min_x": min_x, "max_x": max_x, "min_z": min_z, "max_z": max_z}
	walls.append(w)
	return w


func remove_wall(w: Dictionary) -> void:
	walls.erase(w)


func add_circle(x: float, z: float, r: float) -> Dictionary:
	var c := {"x": x, "z": z, "r": r}
	circles.append(c)
	return c


func alive_actors() -> Array:
	return actors.filter(func(a): return a.alive)


static func _q(v: float) -> float:
	return round(v * Q) / Q


## Advance all actors one step. input_enabled = false freezes control.
func step(dt: float, input_enabled: bool = true) -> void:
	for a in actors:
		if not a.alive:
			continue
		a.shove_cd = max(0.0, a.shove_cd - dt)
		a.stun = max(0.0, a.stun - dt)
		var c: Controller = a.ctrl
		var can_act: bool = input_enabled and not a.frozen and a.stun <= 0.0 and not a.falling
		var tx: float = c.move_x * a.speed * a.speed_mul if can_act else 0.0
		var tz: float = c.move_y * a.speed * a.speed_mul if can_act else 0.0
		var k := U.damp(12.0, dt)
		a.vel.x += (tx - a.vel.x) * k
		a.vel.z += (tz - a.vel.z) * k
		if can_act and U.hypot(c.move_x, c.move_y) > 0.2:
			a.facing = atan2(c.move_x, c.move_y)
		if can_act and shove_enabled and c.b_pressed and a.shove_cd <= 0.0:
			shove(a)
		a.pos.x += (a.vel.x + a.knock.x) * dt
		a.pos.z += (a.vel.z + a.knock.z) * dt
		a.knock *= exp(-6.0 * dt)
		if a.falling:
			a.vy -= 25.0 * dt
			a.y += a.vy * dt
	_separate()
	for a in actors:
		# Newly stunned since the last step: the player of this subject feels it.
		if a.stun > a.stun_seen + 1e-6:
			Haptics.for_player(a.player, "heavy" if a.stun > 0.5 else "hit")
		a.stun_seen = a.stun
		if not a.alive:
			continue
		if not a.falling:
			_collide(a)
		a.pos.x = _q(a.pos.x)
		a.pos.z = _q(a.pos.z)
		a.vel = Vector3(_q(a.vel.x), 0.0, _q(a.vel.z))
		a.knock = Vector3(_q(a.knock.x), 0.0, _q(a.knock.z))
		a.subject.root.position = Vector3(a.pos.x, a.y, a.pos.z)
		a.subject.face_angle(a.facing, dt)
		a.subject.animate(dt, U.hypot(a.vel.x, a.vel.z))


## Shove from `a`: knock back anyone in a cone in front.
func shove(a: ArenaActor) -> void:
	a.shove_cd = 0.6
	a.subject.push()
	Sfx.play("whoosh", {"vol": 0.5})
	var f := a.forward()
	var hit := false
	for b in actors:
		if b == a or not b.alive or b.falling:
			continue
		var d: Vector3 = b.pos - a.pos
		d.y = 0.0
		var dist := d.length()
		if dist > 1.55 or dist < 0.01:
			continue
		if d.normalized().dot(f) < 0.35:
			continue
		b.knock += d.normalized() * shove_force
		b.stun = 0.35
		hit = true
		if on_shove.is_valid():
			on_shove.call(a, b)
	if hit:
		Sfx.play("shove")
		Haptics.for_player(a.player, "click")


func _separate() -> void:
	var list := actors.filter(func(x): return x.alive and not x.falling)
	for i in list.size():
		for j in range(i + 1, list.size()):
			var a: ArenaActor = list[i]
			var b: ArenaActor = list[j]
			var dx := b.pos.x - a.pos.x
			var dz := b.pos.z - a.pos.z
			var d := U.hypot(dx, dz)
			var mn := a.radius + b.radius
			if d < mn and d > 1e-4:
				var push := (mn - d) / 2.0
				var nx := dx / d
				var nz := dz / d
				a.pos.x -= nx * push
				a.pos.z -= nz * push
				b.pos.x += nx * push
				b.pos.z += nz * push


func _collide(a: ArenaActor) -> void:
	var bd := bounds
	a.pos.x = clampf(a.pos.x, bd.min_x + a.radius, bd.max_x - a.radius)
	a.pos.z = clampf(a.pos.z, bd.min_z + a.radius, bd.max_z - a.radius)
	for w in walls:
		var cx := clampf(a.pos.x, w.min_x, w.max_x)
		var cz := clampf(a.pos.z, w.min_z, w.max_z)
		var dx := a.pos.x - cx
		var dz := a.pos.z - cz
		var d := U.hypot(dx, dz)
		if d < a.radius:
			if d > 1e-5:
				a.pos.x = cx + (dx / d) * a.radius
				a.pos.z = cz + (dz / d) * a.radius
			else:
				# Centre inside the box: push out along the shallowest axis.
				var pens := [[a.pos.x - w.min_x, -1.0, 0.0], [w.max_x - a.pos.x, 1.0, 0.0], [a.pos.z - w.min_z, 0.0, -1.0], [w.max_z - a.pos.z, 0.0, 1.0]]
				pens.sort_custom(func(p, q): return p[0] < q[0])
				var pen: Array = pens[0]
				a.pos.x += pen[1] * (pen[0] + a.radius)
				a.pos.z += pen[2] * (pen[0] + a.radius)
	for c in circles:
		var dx: float = a.pos.x - c.x
		var dz: float = a.pos.z - c.z
		var d := U.hypot(dx, dz)
		var mn: float = a.radius + c.r
		if d < mn and d > 1e-5:
			a.pos.x = c.x + (dx / d) * mn
			a.pos.z = c.z + (dz / d) * mn


## Line-of-sight test against walls (2D segment vs AABB, sampled).
func clear_line(from: Vector3, to: Vector3, step_len: float = 0.25) -> bool:
	var d := U.hypot(to.x - from.x, to.z - from.z)
	var n := int(max(1.0, ceil(d / step_len)))
	for i in range(1, n):
		var x := from.x + (to.x - from.x) * i / n
		var z := from.z + (to.z - from.z) * i / n
		for w in walls:
			if x > w.min_x and x < w.max_x and z > w.min_z and z < w.max_z:
				return false
	return true

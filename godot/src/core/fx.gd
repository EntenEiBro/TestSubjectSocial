class_name FX
extends RefCounted
## Visual effects: debris physics, blood spray, pools, smoke, sparks and the
## signature death styles. One FX instance lives per minigame stage; it owns
## short-lived nodes and updates them every frame (cosmetic only: uses
## randf, never the simulation Rng).

static var gore := 1.0          # settings: 1 = full, 0.25 = reduced
const GRAVITY := -22.0
const MAX_BODIES := 90

static var _blood_mat: StandardMaterial3D
static var _drop_geo: Mesh

var scene: Node3D
var floor_at: Callable
var bodies := []
var drops := []
var decals := []
var puffs := []
var flash: OmniLight3D = null


func _init(stage: Node3D, floor_fn: Callable = Callable()) -> void:
	scene = stage
	floor_at = floor_fn if floor_fn.is_valid() else func(_x, _z): return 0.0
	if _blood_mat == null:
		_blood_mat = Mats.mat(0x6e0505)
		_drop_geo = Geo.box(0.07, 0.07, 0.07)


static func _pool_material() -> StandardMaterial3D:
	return Mats.mat(0xffffff, Tex.blood(), {"transparent": true, "depth_write": false, "no_shadow": true})


static func _smoke_material(color: Variant, opacity: float) -> StandardMaterial3D:
	return Mats.mat(color, null, {"opacity": opacity, "depth_write": false, "no_shadow": true})


func _floor(x: float, z: float) -> float:
	return float(floor_at.call(x, z))


## One mesh per effect material, so Minigame.prewarm() can compile their shaders early.
func samples() -> Array:
	return [
		Env.mesh(_drop_geo, _blood_mat, 0, 0, 0, {"cast": false}),
		Env.mesh(Geo.plane(1, 1), _pool_material(), 0, 0, 0, {"cast": false}),
		Env.mesh(Geo.ico(0.5), _smoke_material(0x9a9a9a, 0.5), 0, 0, 0, {"cast": false}),
		Env.mesh(_drop_geo, Mats.glow(0xffd27a), 0, 0, 0, {"cast": false}),
	]


## Keep one explosion light in the stage from the start (rounds with
## explosions call this in build(): a light appearing mid-round recompiles shaders).
func reserve_flash() -> OmniLight3D:
	if flash == null:
		flash = Env.point_light(0xff9a3a, 0.0, 12.0, 2.0)
		scene.add_child(flash)
	return flash


## Throw a node into the debris sim with linear + angular velocity.
## opts: life (12), bounce (0.3), bleed (true), radius (0.15)
func add_body(obj: Node3D, vel: Vector3 = Vector3.ZERO, spin: Vector3 = Vector3.ZERO, opts: Dictionary = {}) -> void:
	if obj.is_inside_tree():
		U.reparent_keep(obj, scene)
	else:
		scene.add_child(obj)
	bodies.append({"obj": obj, "vel": vel, "spin": spin, "life": float(opts.get("life", 12.0)), "bounce": float(opts.get("bounce", 0.3)),
		"bleed": bool(opts.get("bleed", true)), "radius": float(opts.get("radius", 0.15)), "rest": false, "trail": 0.0})


## Spray blood droplets from a point. opts: dir (Vector3), speed (6), spread (1)
func spray(pos: Vector3, count: int = 30, opts: Dictionary = {}) -> void:
	count = int(ceil(count * gore))
	var dir: Variant = opts.get("dir", null)
	var spd: float = opts.get("speed", 6.0)
	var spread: float = opts.get("spread", 1.0)
	for i in count:
		var m := MeshInstance3D.new()
		m.mesh = _drop_geo
		m.material_override = _blood_mat
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		m.position = pos
		var v := Vector3(U.crand(-1, 1) * spread, U.crand(0.3, 1.2), U.crand(-1, 1) * spread)
		if dir is Vector3:
			v += dir * 1.4
		v = v.normalized() * spd * U.crand(0.4, 1.1)
		m.scale = Vector3.ONE * U.crand(0.6, 1.8)
		scene.add_child(m)
		drops.append({"m": m, "v": v, "life": 3.0, "spark": false})


## A blood pool on the floor growing to `size`.
func pool(x: float, z: float, size: float = 1.6, y: Variant = null) -> void:
	var fl: float = _floor(x, z) if y == null else float(y)
	if is_inf(fl) or is_nan(fl):
		return
	size *= 0.4 + 0.6 * gore
	var m := Env.mesh(Geo.plane(1, 1), _pool_material(), x, fl + 0.012 + randf() * 0.004, z, {"cast": false})
	m.rotation = Vector3(-PI / 2, 0, randf() * TAU)
	m.scale = Vector3.ONE * 0.1
	scene.add_child(m)
	decals.append({"m": m, "target": size, "grow": 0.0})


## Grey smoke puff. opts: color, size (0.5), rise (1.2), life (2), opacity (0.5), drift (Vector3)
func smoke(pos: Vector3, opts: Dictionary = {}) -> void:
	var life: float = opts.get("life", 2.0)
	var opacity: float = opts.get("opacity", 0.5)
	var mat := _smoke_material(opts.get("color", 0x9a9a9a), opacity)
	var m := Env.mesh(Geo.ico(float(opts.get("size", 0.5))), mat, pos.x, pos.y, pos.z, {"cast": false})
	scene.add_child(m)
	var drift: Variant = opts.get("drift", null)
	puffs.append({"m": m, "mat": mat, "life": life, "max": life, "rise": float(opts.get("rise", 1.2)), "opacity": opacity,
		"drift": drift if drift is Vector3 else Vector3(U.crand(-0.2, 0.2), 0, U.crand(-0.2, 0.2))})


## Bright flash of sparks. opts: color (0xffd27a), count (10), speed (6)
func sparks(pos: Vector3, opts: Dictionary = {}) -> void:
	var mtl := Mats.glow(opts.get("color", 0xffd27a))
	var spd: float = opts.get("speed", 6.0)
	for i in int(opts.get("count", 10)):
		var m := MeshInstance3D.new()
		m.mesh = _drop_geo
		m.material_override = mtl
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		m.position = pos
		var v := Vector3(U.crand(-1, 1), U.crand(-0.2, 1), U.crand(-1, 1)).normalized() * spd * U.crand(0.3, 1.0)
		scene.add_child(m)
		drops.append({"m": m, "v": v, "life": U.crand(0.2, 0.5), "spark": true})


## Large fiery explosion + smoke column.
func explosion(pos: Vector3, scale: float = 1.0) -> void:
	var light := flash
	if light:
		light.light_energy = 80.0 * scale * Env.LIGHT_K
		light.omni_range = 12.0 * scale
	else:
		light = Env.point_light(0xff9a3a, 80.0 * scale, 12.0 * scale)
		scene.add_child(light)
	light.position = pos + Vector3(0, 0.5, 0)
	puffs.append({"light": light, "life": 0.35, "max": 0.35, "keep": light == flash})
	for i in 10:
		var off := Vector3(U.crand(-0.6, 0.6), U.crand(0, 0.8), U.crand(-0.6, 0.6)) * scale
		smoke(pos + off, {"color": 0xff7a1a if i < 4 else 0x2a2a2a, "size": U.crand(0.4, 0.9) * scale, "rise": U.crand(1.5, 3), "life": U.crand(0.6, 1.6), "opacity": 0.85})
	sparks(pos, {"count": 20, "speed": 10.0 * scale})


## Kill an avatar with a named style. The subject's root is consumed.
## style: gib | shot | crush | fall | snap | burn | slice. opts: dir (Vector3), force (1)
func kill(subject: Subject, style: String = "gib", opts: Dictionary = {}) -> void:
	var root := subject.root
	var dir: Vector3 = opts.get("dir", Vector3(0, 0, 1))
	var force: float = opts.get("force", 1.0)
	var center: Vector3 = subject.parts.chest.global_position
	var d := Vector3(dir.x, 0, dir.z)
	d = d.normalized() if d.length() > 1e-6 else Vector3(0, 0, 1)
	if style == "gib" or style == "slice":
		for p in subject.detachable():
			var v := Vector3(U.crand(-1, 1), U.crand(0.6, 1.4), U.crand(-1, 1)).normalized() * U.crand(4, 9) * force + d * 3.0 * force
			add_body(p, v, Vector3(U.crand(-12, 12), U.crand(-12, 12), U.crand(-12, 12)))
		add_body(subject.parts.hips, Vector3(0, 2, 0) + d * 2.0, Vector3(U.crand(-4, 4), 0, U.crand(-4, 4)))
		spray(center, 70, {"speed": 8.0 * force})
		pool(center.x, center.z, 2.6)
	elif style == "shot":
		add_body(root, Vector3(d.x * 2.5 * force, 1.5, d.z * 2.5 * force), Vector3(-d.z * 5, 0, d.x * 5) * -1.0, {"radius": 0.4, "bounce": 0.1})
		spray(center, 40, {"dir": d, "speed": 7.0})
		pool(center.x + d.x, center.z + d.z, 1.8)
	elif style == "snap":
		subject.parts.torso.rotation.x = -2.4
		subject.parts.head.rotation.x = -0.8
		add_body(root, Vector3(0, 1.5, 0), Vector3(U.crand(-2, 2), 0, U.crand(-2, 2)), {"radius": 0.4, "bounce": 0.05})
		spray(center, 25, {"speed": 4.0})
		pool(center.x, center.z, 1.4)
	elif style == "crush":
		root.scale.y = 0.08
		root.position.y += 0.02
		spray(Vector3(center.x, root.position.y + 0.2, center.z), 90, {"speed": 9.0, "spread": 1.6})
		pool(root.position.x, root.position.z, 3.2)
	elif style == "fall":
		add_body(root, Vector3(d.x * 1.2, 0.5, d.z * 1.2), Vector3(U.crand(-3, 3), U.crand(-1, 1), U.crand(-3, 3)), {"radius": 0.4, "bleed": false, "life": 4.0})
	elif style == "burn":
		_char(root)
		for i in 8:
			smoke(center + Vector3(U.crand(-0.3, 0.3), U.crand(-0.5, 0.5), U.crand(-0.3, 0.3)), {"color": 0xff6a10 if i % 2 else 0x222222, "life": 1.5, "rise": 2.0})
		add_body(root, Vector3(0, 1, 0), Vector3(U.crand(-2, 2), 0, U.crand(-2, 2)), {"radius": 0.4, "bleed": false})


## Blacken every mesh under `node` (burn deaths).
func _char(node: Node) -> void:
	if node is MeshInstance3D:
		var mi: MeshInstance3D = node
		if mi.mesh:
			for i in mi.mesh.get_surface_count():
				var m := mi.get_active_material(i)
				if m is StandardMaterial3D:
					var c: StandardMaterial3D = m.duplicate()
					c.albedo_color = c.albedo_color * 0.15
					c.albedo_color.a = 1.0
					mi.set_surface_override_material(i, c)
	for c in node.get_children():
		_char(c)


func _remove(n: Node) -> void:
	if is_instance_valid(n):
		n.queue_free()


func update(dt: float) -> void:
	# Rigid debris
	var i := bodies.size() - 1
	while i >= 0:
		var b: Dictionary = bodies[i]
		var obj: Node3D = b.obj
		if not is_instance_valid(obj):
			bodies.remove_at(i)
			i -= 1
			continue
		b.life -= dt
		if not b.rest:
			b.vel.y += GRAVITY * dt
			obj.position += b.vel * dt
			obj.rotation += b.spin * dt
			var fl := _floor(obj.position.x, obj.position.z)
			if not is_inf(fl) and obj.position.y < fl + b.radius * 0.5 and b.vel.y < 0 and obj.position.y > fl - 1:
				obj.position.y = fl + b.radius * 0.5
				b.vel.y *= -b.bounce
				b.vel.x *= 0.6
				b.vel.z *= 0.6
				b.spin *= 0.5
				if b.bleed and absf(b.vel.y) > 1.0:
					pool(obj.position.x, obj.position.z, U.crand(0.4, 0.9))
				if b.vel.length_squared() < 0.3:
					b.rest = true
			b.trail -= dt
			if b.bleed and b.trail <= 0.0 and b.vel.length_squared() > 4.0:
				b.trail = 0.05
				spray(obj.position, 1, {"speed": 1.0})
		if obj.position.y < -40 or (b.life <= 0 and not b.rest):
			_remove(obj)
			bodies.remove_at(i)
		i -= 1
	# Cap settled debris so long rounds don't accumulate forever.
	if bodies.size() > MAX_BODIES:
		var j := 0
		while j < bodies.size() and bodies.size() > MAX_BODIES:
			if bodies[j].rest:
				_remove(bodies[j].obj)
				bodies.remove_at(j)
			else:
				j += 1
	# Droplets / sparks
	i = drops.size() - 1
	while i >= 0:
		var d: Dictionary = drops[i]
		var m: Node3D = d.m
		d.life -= dt
		d.v.y += GRAVITY * dt * (0.3 if d.spark else 1.0)
		m.position += d.v * dt
		var fl2 := _floor(m.position.x, m.position.z)
		var landed := not is_inf(fl2) and m.position.y < fl2 and m.position.y > fl2 - 1
		if landed or d.life <= 0:
			if landed and not d.spark and randf() < 0.15:
				pool(m.position.x, m.position.z, U.crand(0.15, 0.4))
			_remove(m)
			drops.remove_at(i)
		i -= 1
	# Pools grow
	for dc in decals:
		if dc.grow < 1.0 and is_instance_valid(dc.m):
			dc.grow = min(1.0, dc.grow + dt * 0.8)
			dc.m.scale = Vector3.ONE * (0.1 + (dc.target - 0.1) * (1.0 - pow(1.0 - dc.grow, 3.0)))
	# Smoke + flashes
	i = puffs.size() - 1
	while i >= 0:
		var p: Dictionary = puffs[i]
		p.life -= dt
		var k: float = max(0.0, p.life / p.max)
		if p.has("light"):
			p.light.light_energy *= 0.85
		else:
			p.m.position.y += p.rise * dt
			p.m.position += p.drift * dt
			p.m.scale = Vector3.ONE * (1.0 + (1.0 - k) * 1.8)
			p.mat.albedo_color.a = p.opacity * k
		if p.life <= 0:
			if p.get("keep", false):
				p.light.light_energy = 0.0
			else:
				_remove(p.light if p.has("light") else p.m)
			puffs.remove_at(i)
		i -= 1

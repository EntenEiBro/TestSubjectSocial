class_name Backdrop
extends Node3D
## The 3D "intake room" rendered behind every menu: four pedestals under
## swinging lamps hold the joined test subjects. The lobby rebuilds a
## pedestal's subject whenever its owner changes their look; the final
## screen uses the spotlight / lift / confetti ceremony helpers.

var camera: Camera3D
var cam_look := Vector3(0, 1.4, 0)
var t := 0.0
var mode := "title"       # title | lobby | final
var fan: Dictionary
var slots := []
var key: OmniLight3D
var spotlight = null      # Array of lit pedestal indices, or null = normal lighting
var key_target := 6.0
var confetti := []
var _confetti_geo: Mesh
var _confetti_mats := []


func _init() -> void:
	name = "Backdrop"
	var scene := Env.mood_scene({"fog": 0x070707, "fog_near": 8, "fog_far": 32, "ambient_intensity": 0.55})
	add_child(scene)
	camera = Camera3D.new()
	camera.fov = 45
	scene.add_child(camera)
	Env.look_from(camera, Vector3(0, 2.4, 9.5), cam_look)

	Env.room(scene, 18, 12, 7, {"open": ["south"]})
	Env.stencil(scene, "INTAKE", 0, 4.6, -5.8, {"w": 7, "h": 2.4})
	Env.stencil(scene, "NO EXIT", -6.8, 2.2, -5.8, {"w": 3, "h": 1.1, "opacity": 0.4})
	fan = Env.wall_fan(scene, 6.2, 4.4, -5.8, {"r": 1.3})
	Env.pipe(scene, [-9, 6, -5.6], [9, 6, -5.6], 0.16)
	Env.pipe(scene, [-9, 5.6, -5.5], [9, 5.6, -5.5], 0.09, 0x6b3a22)
	Env.pipe(scene, [-7.5, 0, -5.6], [-7.5, 7, -5.6], 0.14)
	Env.crate(scene, -7.2, 0, -3.5, 1.1, 0.3)
	Env.crate(scene, -6.4, 0, -4.6, 0.9, 0.8)
	Env.crate(scene, -7, 1.1, -3.7, 0.8, 0.1)
	Env.block(scene, 7, 0.6, -4, 1.4, 1.2, 1.4, Mats.mat(0xffffff, Tex.rust()))
	Env.hazard_strip(scene, 0, 3.2, 14, 0.4)

	var xs := [-4.2, -1.4, 1.4, 4.2]
	for i in xs.size():
		var x: float = xs[i]
		var ped := Env.block(scene, x, 0.15, 0, 1.6, 0.3, 1.6, Mats.mat(0x55524a, Tex.plate()))
		var lamp := Env.hanging_lamp(scene, x, 5.2, 0.4, {"intensity": 0.0, "angle": 0.5, "distance": 12.0})
		var holder := Node3D.new()
		holder.position = Vector3(x, 0.3, 0)
		scene.add_child(holder)
		slots.append({"x": x, "ped": ped, "lamp": lamp, "holder": holder, "subject": null, "swing": i * 1.7, "on": false,
			"lift": 0.0, "lift_target": 0.0, "look": null, "number": 0, "bursts": 0})
	key = Env.point_light(0xffd6a0, 6.0, 20.0)
	key.position = Vector3(0, 5, 4)
	scene.add_child(key)

	_confetti_geo = Geo.plane(0.12, 0.07)
	for c in [0xc9a227, 0x9b1d1d, 0x47ff6a, 0xd8d2c0, 0x4ad2ff]:
		_confetti_mats.append(Mats.glow(c, {"double_side": true}))


## Light only these pedestals (Array of indices), or normal lighting with null.
func set_spotlight(indices) -> void:
	spotlight = indices
	key_target = 0.6 if indices != null else 6.0


## Raise (positive) or sink (negative) pedestal i to y metres.
func set_lift(i: int, y: float) -> void:
	slots[i].lift_target = y


## Throw a burst of confetti above pedestal i.
func burst_confetti(i: int, count: int = 120) -> void:
	slots[i].bursts += 1
	var x: float = slots[i].x
	for k in count:
		var m := MeshInstance3D.new()
		m.mesh = _confetti_geo
		m.material_override = _confetti_mats[k % _confetti_mats.size()]
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		m.position = Vector3(x + (randf() - 0.5) * 0.6, 3.2 + slots[i].lift, (randf() - 0.5) * 0.6)
		m.rotation = Vector3(randf() * 6, randf() * 6, randf() * 6)
		var a := randf() * TAU
		var s := 1.5 + randf() * 3.5
		add_child(m)
		confetti.append({"m": m, "vx": cos(a) * s, "vy": 3 + randf() * 5, "vz": sin(a) * s * 0.6, "spin": (randf() - 0.5) * 14, "life": 4 + randf() * 1.5})


## Back to the normal intake room (after the ceremony).
func reset_ceremony() -> void:
	set_spotlight(null)
	for s in slots:
		s.lift_target = 0.0
	for c in confetti:
		c.m.queue_free()
	confetti.clear()


## Put a subject (or nothing) on pedestal i.
func set_slot(i: int, look, number: int = 0) -> void:
	var s: Dictionary = slots[i]
	if s.subject:
		s.subject.dispose()
		s.subject = null
	s.on = look != null
	s.look = look
	s.number = number if look != null else 0
	if look == null:
		return
	var lk: Dictionary = look.duplicate()
	lk["number"] = "%02d" % number
	s.subject = Subject.new(lk)
	s.holder.add_child(s.subject.root)


func set_pose(i: int, pose: String) -> void:
	if slots[i].subject:
		slots[i].subject.pose = pose


## Compact state for online clients (they draw this room themselves).
func get_state() -> Dictionary:
	var st := []
	for s in slots:
		st.append([s.look, s.number, s.subject.pose if s.subject else "idle", s.lift_target, s.bursts])
	return {"m": mode, "s": st, "l": spotlight}


func apply_state(st: Dictionary) -> void:
	mode = st.get("m", "title")
	var list: Array = st.get("s", [])
	for i in min(list.size(), slots.size()):
		var e: Array = list[i]
		var s: Dictionary = slots[i]
		if JSON.stringify(e[0]) != JSON.stringify(s.look) or int(e[1]) != int(s.number):
			set_slot(i, e[0], int(e[1]))
		set_pose(i, e[2])
		s.lift_target = float(e[3])
		if int(e[4]) > int(s.bursts):
			burst_confetti(i)
		s.bursts = int(e[4])
	var lit = st.get("l")
	if JSON.stringify(lit) != JSON.stringify(spotlight):
		set_spotlight(lit)


func update(dt: float) -> void:
	t += dt
	fan.update.call(dt)
	key.light_energy += (key_target * Env.LIGHT_K - key.light_energy) * min(1.0, dt * 4.0)
	for i in slots.size():
		var s: Dictionary = slots[i]
		s.swing += dt
		var lit: bool = (i in spotlight) if spotlight != null else s.on
		var target := (140.0 if spotlight != null else 70.0) if lit else 0.0
		var light: SpotLight3D = s.lamp.light
		light.light_energy += (target * Env.LIGHT_K - light.light_energy) * min(1.0, dt * (14.0 if spotlight != null else 6.0))
		var bulb: MeshInstance3D = s.lamp.bulb
		(bulb.material_override as StandardMaterial3D).albedo_color = Color("#ffe2b0") if lit else Color("#222222")
		s.lift += (s.lift_target - s.lift) * min(1.0, dt * 2.2)
		s.ped.position.y = 0.15 + s.lift
		s.holder.position.y = 0.3 + s.lift
		var g: Node3D = s.lamp.group
		g.rotation.z = sin(s.swing * 0.9) * 0.06
		g.rotation.x = cos(s.swing * 0.7) * 0.04
		if s.subject:
			s.subject.animate(dt, 0.0)
			s.subject.root.rotation.y = sin(t * 0.6 + s.x) * 0.25
	var k := confetti.size() - 1
	while k >= 0:
		var c: Dictionary = confetti[k]
		c.life -= dt
		c.vy -= 6.0 * dt
		c.vx *= 1.0 - dt * 1.2
		c.vz *= 1.0 - dt * 1.2
		if c.vy < -1.6:
			c.vy = -1.6
		var m: MeshInstance3D = c.m
		m.position.x += (c.vx + sin(c.life * 7.0 + k) * 0.6) * dt
		m.position.y += c.vy * dt
		m.position.z += c.vz * dt
		m.rotation.x += c.spin * dt
		m.rotation.y += c.spin * 0.7 * dt
		if c.life <= 0 or m.position.y < 0.02:
			m.queue_free()
			confetti.remove_at(k)
		k -= 1
	# Slow cinematic drift.
	var cx := sin(t * 0.12) * 0.8
	var lobby := mode == "lobby"
	var target_pos := Vector3(cx * 0.3, 1.5, 8.6) if lobby else Vector3(cx, 2.6 + sin(t * 0.2) * 0.2, 9.8)
	camera.position = camera.position.lerp(target_pos, min(1.0, dt * 1.5))
	cam_look = cam_look.lerp(Vector3(0, 0.15, 0) if lobby else Vector3(0, 1.4, 0), min(1.0, dt * 1.5))
	Env.look_from(camera, camera.position, cam_look)

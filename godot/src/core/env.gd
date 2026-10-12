class_name Env
## Reusable set-dressing builders for industrial rooms (port of environment.js
## plus the scene/lamp helpers of engine.js). Every stage is assembled from
## these so the whole game shares one look: stained concrete, rusted plate,
## hazard stripes, hanging lamps, pipes, stencilled wall text, CRT monitors.
##
## Positions use the same coordinates as the web version (Y up, the camera
## usually looks toward -Z); Godot's axes match THREE's.

## Light intensity conversion (THREE candela-style values → Godot energy).
## Tuned ~15% darker than a straight conversion (moodier, as requested).
const LIGHT_K := 0.28
const AMBIENT_K := 0.46

static var shadows_enabled := true   # set from settings (off on phones)
static var _font: Font = null


static func font() -> Font:
	if _font == null:
		_font = load("res://assets/fonts/blackopsone-latin.woff2")
	return _font


## Mesh instance placed at (x, y, z). opts: cast (true), receive (true).
static func mesh(geo: Mesh, material: Material, x: float = 0.0, y: float = 0.0, z: float = 0.0, opts: Dictionary = {}) -> MeshInstance3D:
	var m := MeshInstance3D.new()
	m.mesh = geo
	m.material_override = material
	m.position = Vector3(x, y, z)
	m.rotation_order = EULER_ORDER_XYZ
	var cast: bool = opts.get("cast", true)
	m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if (cast and shadows_enabled) else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return m


## Axis-aligned box placed by its centre.
static func block(parent: Node3D, x: float, y: float, z: float, w: float, h: float, d: float, material: Material) -> MeshInstance3D:
	var m := mesh(Geo.box(w, h, d), material, x, y, z)
	parent.add_child(m)
	return m


## Floor plane of size w x d with a tiled texture.
## opts: tex ("concrete"), tile (4), y (0), color (0xffffff), x (0), z (0)
static func floor_plane(parent: Node3D, w: float, d: float, opts: Dictionary = {}) -> MeshInstance3D:
	var tile: float = opts.get("tile", 4.0)
	var material := Mats.mat(opts.get("color", 0xffffff), Tex.named(opts.get("tex", "concrete"), Vector2(w / tile, d / tile)))
	var m := mesh(Geo.plane(w, d), material, opts.get("x", 0.0), opts.get("y", 0.0), opts.get("z", 0.0), {"cast": false})
	m.rotation.x = -PI / 2
	parent.add_child(m)
	return m


## Closed room: floor + 4 walls (+ optional ceiling). Walls listed in `open`
## (default ["south"], the camera side) are left out.
static func room(parent: Node3D, w: float, d: float, h: float, opts: Dictionary = {}) -> Node3D:
	var group := Node3D.new()
	var tile: float = opts.get("tile", 4.0)
	var open: Array = opts.get("open", ["south"])
	var wall_tex: String = opts.get("wall_tex", "wall")
	floor_plane(group, w, d, {"tex": opts.get("floor_tex", "concrete"), "tile": tile})
	var wm := Mats.mat(0xffffff, Tex.named(wall_tex, Vector2(w / tile, h / tile)))
	var wm_side := Mats.mat(0xffffff, Tex.named(wall_tex, Vector2(d / tile, h / tile)))
	var walls := {
		"north": [0.0, h / 2, -d / 2, w, h, 0.3, wm],
		"south": [0.0, h / 2, d / 2, w, h, 0.3, wm],
		"west": [-w / 2, h / 2, 0.0, 0.3, h, d, wm_side],
		"east": [w / 2, h / 2, 0.0, 0.3, h, d, wm_side],
	}
	for k in walls:
		if k in open:
			continue
		var a: Array = walls[k]
		block(group, a[0], a[1], a[2], a[3], a[4], a[5], a[6])
	if opts.get("ceiling", false):
		var c := mesh(Geo.plane(w, d), Mats.mat(0x3a3a3a, Tex.concrete(Vector2(w / tile, d / tile))), 0, h, 0, {"cast": false})
		c.rotation.x = PI / 2
		group.add_child(c)
	parent.add_child(group)
	return group


## Text in the game's stencil font, sized to fit w x h (world units).
## opts: color ("#cfc8b4"), opacity (1), shaded (true), font_size (96), double (false)
static func text3d(text: String, w: float, h: float, opts: Dictionary = {}) -> Label3D:
	var l := Label3D.new()
	l.text = text
	l.font = font()
	var fs: int = opts.get("font_size", 96)
	l.font_size = fs
	l.outline_size = 0
	l.modulate = U.col(opts.get("color", "#cfc8b4"), float(opts.get("opacity", 1.0)))
	l.shaded = opts.get("shaded", true)
	l.double_sided = opts.get("double", false)
	l.no_depth_test = false
	l.alpha_cut = Label3D.ALPHA_CUT_DISABLED
	l.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	var size := font().get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs)
	var px_w: float = (w * 0.92) / max(1.0, size.x)
	var px_h: float = (h * 0.75) / max(1.0, float(fs))
	l.pixel_size = min(px_w, px_h)
	return l


## Big worn stencil lettering painted on a wall plane.
## opts: w (6), h (2.2), rot_y (0), color ("#cfc8b4"), opacity (0.75)
static func stencil(parent: Node3D, text: String, x: float, y: float, z: float, opts: Dictionary = {}) -> Label3D:
	var l := text3d(text, opts.get("w", 6.0), opts.get("h", 2.2), {"color": opts.get("color", "#cfc8b4"), "opacity": opts.get("opacity", 0.75)})
	l.position = Vector3(x, y, z)
	l.rotation_order = EULER_ORDER_XYZ
	l.rotation.y = opts.get("rot_y", 0.0)
	parent.add_child(l)
	return l


## A pipe run between two points a and b (Array [x, y, z] or Vector3).
static func pipe(parent: Node3D, a: Variant, b: Variant, r: float = 0.12, color: Variant = 0x4d4a44) -> MeshInstance3D:
	var va := _v3(a)
	var vb := _v3(b)
	var length := va.distance_to(vb)
	var m := mesh(Geo.cyl(r, r, length, 6), Mats.mat(color, Tex.rust()))
	m.position = (va + vb) * 0.5
	var dir := (vb - va).normalized()
	m.quaternion = Quaternion(Vector3.UP, dir) if absf(dir.dot(Vector3.UP)) < 0.9999 else (Quaternion() if dir.y > 0.0 else Quaternion(Vector3.RIGHT, PI))
	parent.add_child(m)
	return m


static func _v3(v: Variant) -> Vector3:
	if v is Vector3:
		return v
	return Vector3(float(v[0]), float(v[1]), float(v[2]))


## Wooden crate of size s, sitting on y.
static func crate(parent: Node3D, x: float, y: float, z: float, s: float = 1.0, rot: float = 0.0) -> MeshInstance3D:
	var m := mesh(Geo.box(s, s, s), Mats.mat(0xffffff, Tex.crate()), x, y + s / 2, z)
	m.rotation.y = rot
	parent.add_child(m)
	return m


## Hazard-striped strip on the floor (edges of pits, danger zones).
static func hazard_strip(parent: Node3D, x: float, z: float, w: float, d: float, y: float = 0.01) -> MeshInstance3D:
	var m := mesh(Geo.plane(w, d), Mats.mat(0xffffff, Tex.hazard(Vector2(max(1.0, w / 1.5), max(1.0, d / 1.5)))), x, y, z, {"cast": false})
	m.rotation.x = -PI / 2
	parent.add_child(m)
	return m


## Thin floating ring marker under an avatar, tinted with the player colour.
static func player_ring(color: Variant) -> MeshInstance3D:
	var m := MeshInstance3D.new()
	m.mesh = Geo.ring(0.45, 0.58, 16)
	m.material_override = Mats.glow(color, {"opacity": 0.85, "depth_write": false})
	m.rotation.x = -PI / 2
	m.position.y = 0.03
	m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return m


## Point light with THREE semantics (distance 0 = unlimited, decay exponent).
static func point_light(color: Variant, intensity: float, distance: float = 0.0, decay: float = 2.0) -> OmniLight3D:
	var l := OmniLight3D.new()
	l.light_color = U.col(color)
	l.light_energy = intensity * LIGHT_K
	l.omni_range = distance if distance > 0.0 else 80.0
	l.omni_attenuation = decay
	l.shadow_enabled = false
	return l


## Spot light with THREE semantics. It shines along its node's -Z; use aim().
static func spot_light(color: Variant, intensity: float, distance: float = 0.0, angle: float = PI / 3, penumbra: float = 0.0, decay: float = 2.0) -> SpotLight3D:
	var l := SpotLight3D.new()
	l.light_color = U.col(color)
	l.light_energy = intensity * LIGHT_K
	l.spot_range = distance if distance > 0.0 else 80.0
	l.spot_attenuation = decay
	l.spot_angle = clampf(rad_to_deg(angle), 1.0, 89.0)
	l.spot_angle_attenuation = 0.4 + penumbra * 1.2
	l.shadow_enabled = false
	return l


## Directional light shining from `from` toward `to` (world space).
static func dir_light(color: Variant, intensity: float, from: Vector3, to: Vector3 = Vector3.ZERO) -> DirectionalLight3D:
	var l := DirectionalLight3D.new()
	l.light_color = U.col(color)
	l.light_energy = intensity * LIGHT_K * 3.0
	l.position = from
	look_dir(l, to - from)
	return l


## Point a light / node's -Z along direction `dir`.
static func look_dir(n: Node3D, dir: Vector3) -> void:
	if dir.length() < 1e-6:
		return
	var up := Vector3.UP if absf(dir.normalized().dot(Vector3.UP)) < 0.98 else Vector3(0, 0, -1)
	n.basis = Basis.looking_at(dir.normalized(), up)


## Place a node at `pos` looking at `target` (parent space; works outside the tree).
static func look_from(n: Node3D, pos: Vector3, target: Vector3) -> void:
	var dir := target - pos
	if dir.length() < 1e-6:
		n.position = pos
		return
	var up := Vector3.UP if absf(dir.normalized().dot(Vector3.UP)) < 0.999 else Vector3(0, 0, -1)
	n.transform = Transform3D(Basis.looking_at(dir.normalized(), up), pos)


## Aim a spot light at a point in its parent's space.
static func aim(light: Node3D, target_local: Vector3) -> void:
	look_dir(light, target_local - light.position)


## A hanging industrial lamp (spot light + shade + bulb + cord).
## opts: color (0xffe2b0), intensity (60), angle (0.75), distance (30), shadow (true), target (Vector3 world)
## Returns {group, light, bulb}.
static func hanging_lamp(parent: Node3D, x: float, y: float, z: float, opts: Dictionary = {}) -> Dictionary:
	var color = opts.get("color", 0xffe2b0)
	var group := Node3D.new()
	group.rotation_order = EULER_ORDER_XYZ
	var shade := mesh(Geo.cone(0.5, 0.45, 8, true), Mats.mat(0x2b2e2a, null, {"double_side": true}), 0, 0.1, 0)
	var bulb := mesh(Geo.sphere(0.12, 6, 4), Mats.glow(color), 0, 0, 0, {"cast": false})
	var cord := mesh(Geo.cyl(0.02, 0.02, 4, 4), Mats.glow(0x111111), 0, 2.3, 0, {"cast": false})
	U.add(group, [shade, bulb, cord])
	group.position = Vector3(x, y, z)
	var light := spot_light(color, opts.get("intensity", 60.0), opts.get("distance", 30.0), opts.get("angle", 0.75), 0.5, 1.4)
	light.shadow_enabled = opts.get("shadow", true) and shadows_enabled
	light.shadow_bias = 0.05
	group.add_child(light)
	var target: Variant = opts.get("target", null)
	if target is Vector3:
		look_dir(light, target - Vector3(x, y, z))
	else:
		light.rotation.x = -PI / 2
	parent.add_child(group)
	return {"group": group, "light": light, "bulb": bulb}


## Spinning extractor fan set into a wall. Returns {group, update(dt)}.
static func wall_fan(parent: Node3D, x: float, y: float, z: float, opts: Dictionary = {}) -> Dictionary:
	var r: float = opts.get("r", 1.2)
	var g := Node3D.new()
	var ring_m := mesh(Geo.torus(r, 0.15, 6, 16), Mats.mat(0x3a3a36, Tex.metal()))
	var blades := Node3D.new()
	for i in 5:
		var b := mesh(Geo.box(0.3, r * 0.95, 0.04), Mats.mat(0x5a5a52, Tex.metal()), 0, r * 0.45, 0)
		var pivot := Node3D.new()
		pivot.rotation.z = float(i) / 5.0 * TAU
		b.rotation.y = 0.4
		pivot.add_child(b)
		blades.add_child(pivot)
	var back := mesh(Geo.circle(r, 16), Mats.glow(0x050505), 0, 0, -0.1, {"cast": false})
	U.add(g, [back, ring_m, blades])
	g.position = Vector3(x, y, z)
	g.rotation.y = opts.get("rot_y", 0.0)
	parent.add_child(g)
	return {"group": g, "update": func(dt: float): blades.rotation.z += dt * 3.0}


## Green CRT monitor with a redrawable 2D screen.
## Returns {group, screen: ScreenCanvas, draw(fn)} where fn(ci: CanvasItem, w, h) paints.
static func monitor(parent: Node3D, x: float, y: float, z: float, opts: Dictionary = {}) -> Dictionary:
	var w: float = opts.get("w", 1.4)
	var h: float = opts.get("h", 1.05)
	var group := Node3D.new()
	group.rotation_order = EULER_ORDER_XYZ
	var case_m := mesh(Geo.box(w + 0.2, h + 0.2, 0.8), Mats.mat(0x3b3a33, Tex.plate()), 0, 0, -0.35)
	var screen := ScreenCanvas.new(128, 96, w, h)
	screen.position.z = 0.06
	U.add(group, [case_m, screen])
	group.position = Vector3(x, y, z)
	group.rotation = Vector3(opts.get("rot_x", 0.0), opts.get("rot_y", 0.0), 0.0)
	parent.add_child(group)
	return {"group": group, "screen": screen, "draw": func(fn: Callable): screen.draw(fn)}


## Draw a floor / monitor symbol (X, O, S = square, T = triangle) on a canvas item.
static func draw_symbol(ci: CanvasItem, sym: String, cx: float, cy: float, r: float, color: Variant = "#39ff5a", lw: float = 8.0) -> void:
	var c := U.col(color)
	match sym:
		"X":
			ci.draw_line(Vector2(cx - r, cy - r), Vector2(cx + r, cy + r), c, lw)
			ci.draw_line(Vector2(cx + r, cy - r), Vector2(cx - r, cy + r), c, lw)
		"O":
			ci.draw_arc(Vector2(cx, cy), r, 0, TAU, 32, c, lw)
		"S":
			ci.draw_rect(Rect2(cx - r, cy - r, r * 2, r * 2), c, false, lw)
		"T":
			var pts := PackedVector2Array([Vector2(cx, cy - r), Vector2(cx + r, cy + r * 0.8), Vector2(cx - r, cy + r * 0.8), Vector2(cx, cy - r)])
			ci.draw_polyline(pts, c, lw)


## Standard moody lighting rig: background, fog, ambient + hemisphere-like fill.
## opts: fog (0x0b0b0b), fog_near (12), fog_far (60), ambient (0x3a3a40), ambient_intensity (0.9)
static func mood_scene(opts: Dictionary = {}) -> Node3D:
	var root := Node3D.new()
	root.name = "Stage"
	var fog_c := U.col(opts.get("fog", 0x0b0b0b))
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = fog_c
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	var amb := U.col(opts.get("ambient", 0x3a3a40))
	var ai: float = opts.get("ambient_intensity", 0.9)
	# AmbientLight + HemisphereLight(0x9a9a8a, 0x201a14, 0.5) folded into one ambient colour.
	var hemi := U.col(0x9a9a8a).lerp(U.col(0x201a14), 0.5)
	env.ambient_light_color = Color(amb.r * ai + hemi.r * 0.5, amb.g * ai + hemi.g * 0.5, amb.b * ai + hemi.b * 0.5)
	env.ambient_light_energy = AMBIENT_K
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	env.fog_enabled = true
	env.fog_mode = Environment.FOG_MODE_DEPTH
	env.fog_light_color = fog_c
	env.fog_light_energy = 1.0
	env.fog_density = 1.0
	env.fog_depth_begin = opts.get("fog_near", 12.0)
	env.fog_depth_end = opts.get("fog_far", 60.0)
	env.fog_depth_curve = 1.0
	env.fog_sky_affect = 0.0
	var we := WorldEnvironment.new()
	we.environment = env
	root.add_child(we)
	# The hemisphere light's top-down part: a soft shadowless fill from above.
	var fill := DirectionalLight3D.new()
	fill.light_color = U.col(0x9a9a8a)
	fill.light_energy = 0.15
	fill.rotation = Vector3(-PI / 2, 0, 0)
	fill.shadow_enabled = false
	fill.sky_mode = DirectionalLight3D.SKY_MODE_LIGHT_ONLY
	root.add_child(fill)
	return root

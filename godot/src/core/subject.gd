class_name Subject
extends RefCounted
## The customizable "test subject" avatar (models built in Blender:
## blender/build_subject.py → assets/models/subject.glb, hats.glb, faces.glb).
##
## The rig is a hierarchy of pivots so limbs can be animated procedurally and,
## on death, detached into individual physics debris (see fx.gd):
##
##   root (feet on y=0, faces +Z)
##    └ hips
##       ├ legL / legR        (pivot at the hip joint)
##       └ torso
##          ├ armL / armR     (pivot at the shoulder; handL / handR hold props)
##          └ head            (face accessory + hat)
##
## Construct with a look {suit, skin, hat, face, number} and add `root` to a scene.

const SUIT_COLORS := [
	{"name": "Hazard Orange", "hex": 0xc4561f},
	{"name": "Ward Teal", "hex": 0x2f7d74},
	{"name": "Mustard", "hex": 0xb89a2c},
	{"name": "Oxblood", "hex": 0x7c2323},
	{"name": "Surplus Olive", "hex": 0x5a6a2e},
	{"name": "Coolant Blue", "hex": 0x2d4f8f},
	{"name": "Bleach White", "hex": 0xc9c5b8},
	{"name": "Bruise Purple", "hex": 0x5b3a72},
]
const SKIN_TONES := [0xe2b896, 0xc68e66, 0x8d5a3b, 0x5b3a26, 0xb9b38f]
const HATS := ["None", "Hard Hat", "Beanie", "Bucket", "Paper Bag", "Top Hat", "Gas Mask", "Welder", "Headlamp", "Party Hat"]
const FACES := ["Plain", "Goggles", "Shades", "Bandage", "Monocle", "Mustache"]
const SLOT_COLORS := ["#e2582a", "#3fb6a8", "#d9c24a", "#b45ad6"]

static var _templates := {}     # "subject" | "hats" | "faces" -> instantiated glb (kept out of the tree)
static var _mat_cache := {}

var look := {}
var root: Node3D
var parts := {}
var ring: MeshInstance3D = null  # player-colour ground ring (set by Minigame.spawn_subject)
var walk_phase := 0.0
var speed := 0.0
var pose := "idle"   # idle | carry | aim | armsUp | sit | cower | hold | push
var push_timer := 0.0


func _init(look_in: Dictionary = {}) -> void:
	look = {"suit": SUIT_COLORS[0].hex, "skin": SKIN_TONES[0], "hat": "None", "face": "Plain", "number": "00"}
	for k in look_in:
		look[k] = look_in[k]
	_build()


static func _template(key: String) -> Node:
	if not _templates.has(key):
		var scene: PackedScene = load("res://assets/models/%s.glb" % key)
		_templates[key] = scene.instantiate()
	return _templates[key]


static func _find(node: Node, node_name: String) -> Node:
	if node.name == node_name:
		return node
	for c in node.get_children():
		var f := _find(c, node_name)
		if f:
			return f
	return null


## The flat retro look for an imported material (cached).
static func flat(m: Material) -> Material:
	if m == null:
		return null
	var key := "flat:%d" % m.get_instance_id()
	if _mat_cache.has(key):
		return _mat_cache[key]
	var out := m
	if m is StandardMaterial3D:
		var s: StandardMaterial3D = m.duplicate()
		if s.shading_mode != BaseMaterial3D.SHADING_MODE_UNSHADED:
			s.diffuse_mode = BaseMaterial3D.DIFFUSE_LAMBERT
			s.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
			s.roughness = 1.0
			s.metallic = 0.0
		s.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST_WITH_MIPMAPS
		out = s
	_mat_cache[key] = out
	return out


static func _tinted(tex_name: String, color: Variant, k: float = 1.0) -> Material:
	var c := U.col(color)
	c = Color(c.r * k, c.g * k, c.b * k)
	var key := "%s:%s" % [tex_name, c.to_html(false)]
	if not _mat_cache.has(key):
		_mat_cache[key] = Mats.mat(c, Tex.named(tex_name))
	return _mat_cache[key]


func _suit_index() -> int:
	for i in SUIT_COLORS.size():
		if SUIT_COLORS[i].hex == int(look.suit):
			return i
	return 0


## Material for a named Blender material on this subject.
func _material_for(src: Material) -> Material:
	var n := src.resource_name if src else ""
	match n:
		"suit":
			return _tinted("fabric", look.suit)
		"suitDark":
			return _tinted("fabric", look.suit, 0.65)
		"skin":
			return _tinted("fabric", look.skin)
		"knit_suit":
			return _tinted("knit", look.suit)
		"knit_suitDark":
			return _tinted("knit", look.suit, 0.7)
		"party_stripes":
			var key := "stripes:%d" % _suit_index()
			if not _mat_cache.has(key):
				_mat_cache[key] = Mats.mat(0xffffff, Tex.named("stripes_%d" % _suit_index()), {"double_side": true})
			return _mat_cache[key]
	return flat(src)


func _apply_materials(node: Node) -> void:
	if node is MeshInstance3D:
		var mi: MeshInstance3D = node
		if mi.mesh:
			for i in mi.mesh.get_surface_count():
				mi.set_surface_override_material(i, _material_for(mi.mesh.surface_get_material(i)))
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if Env.shadows_enabled else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for c in node.get_children():
		_apply_materials(c)


func _build() -> void:
	root = Node3D.new()
	root.name = "Subject"
	var body := _template("subject")
	var src := _find(body, "Subject")
	if src == null:
		src = body
	for c in src.get_children():
		root.add_child(c.duplicate())
	for pname in ["hips", "pelvis", "legL", "legR", "torso", "chest", "armL", "armR", "handL", "handR", "head", "skull", "patch", "neck"]:
		parts[pname] = _find(root, pname)
	_apply_materials(root)

	# Chest number patch: identity at a glance in chaotic rounds.
	var num := Env.text3d(str(look.number), 0.22, 0.17, {"color": "#111111", "font_size": 64})
	num.position = Vector3(0, -0.005, 0.004)
	parts.patch.add_child(num)

	var face_tpl := _find(_template("faces"), "face_" + str(look.face))
	if face_tpl == null:
		face_tpl = _find(_template("faces"), "face_Plain")
	var face: Node3D = face_tpl.duplicate()
	face.transform = Transform3D.IDENTITY
	_apply_materials(face)
	parts.head.add_child(face)
	parts["face"] = face

	parts["hat"] = null
	if str(look.hat) != "None":
		var hat_tpl := _find(_template("hats"), "hat_" + str(look.hat).replace(" ", ""))
		if hat_tpl:
			var hat: Node3D = hat_tpl.duplicate()
			hat.transform = Transform3D.IDENTITY
			_apply_materials(hat)
			parts.head.add_child(hat)
			parts["hat"] = hat

	# Hit zones for precision shooting (head vs body).
	parts.skull.set_meta("hit_zone", "head")
	parts.chest.set_meta("hit_zone", "body")
	parts.pelvis.set_meta("hit_zone", "body")


## Parts that fly off individually when the subject is torn apart.
func detachable() -> Array:
	return [parts.head, parts.armL, parts.armR, parts.legL, parts.legR, parts.torso]


## Face a world-space direction angle (radians, 0 = +Z), smoothly.
func face_angle(angle: float, dt: float, rate: float = 14.0) -> void:
	var cur := root.rotation.y
	var d := angle - cur
	while d > PI:
		d -= TAU
	while d < -PI:
		d += TAU
	root.rotation.y = cur + d * U.damp(rate, dt)


## Trigger a short push animation.
func push() -> void:
	push_timer = 0.25


## Procedural animation; `spd` = ground speed in units/s. Call every frame while alive.
func animate(dt: float, spd: float = -1.0) -> void:
	if spd >= 0.0:
		speed = spd
	var p := parts
	var moving := clampf(speed / 4.0, 0.0, 1.4)
	walk_phase += dt * (4.0 + speed * 2.2) * (1.0 if moving > 0.05 else 0.0)
	var s := sin(walk_phase)
	var swing := 0.75 * moving
	p.legL.rotation.x = s * swing
	p.legR.rotation.x = -s * swing
	var bob := absf(cos(walk_phase)) * 0.05 * moving
	p.hips.position.y = 0.92 + bob
	p.torso.rotation.z = sin(walk_phase) * 0.04 * moving

	var a_l := -s * swing * 0.8
	var a_r := s * swing * 0.8
	var z_l := 0.05
	var z_r := -0.05
	var lean := 0.08 * moving
	match pose:
		"carry":
			a_l = -1.25; a_r = -1.25; z_l = 0.25; z_r = -0.25
		"aim":
			a_r = -1.55; a_l = -1.35; z_l = -0.35; z_r = 0.05
		"armsUp":
			a_l = -2.9; a_r = -2.9; z_l = 0.25; z_r = -0.25
		"cower":
			a_l = -2.2; a_r = -2.2; z_l = -0.6; z_r = 0.6; lean = 0.45
		"sit":
			a_l = -1.1; a_r = -1.1; z_l = 0.1; z_r = -0.1
			p.legL.rotation.x = -1.5
			p.legR.rotation.x = -1.5
			lean = 0.0
		"hold":
			a_r = -1.2; z_r = 0.0
	if push_timer > 0.0:
		push_timer -= dt
		a_l = -1.6; a_r = -1.6; z_l = 0.0; z_r = 0.0; lean = 0.35
	var k := U.damp(16.0, dt)
	p.armL.rotation.x = lerpf(p.armL.rotation.x, a_l, k)
	p.armR.rotation.x = lerpf(p.armR.rotation.x, a_r, k)
	p.armL.rotation.z = lerpf(p.armL.rotation.z, z_l, k)
	p.armR.rotation.z = lerpf(p.armR.rotation.z, z_r, k)
	p.torso.rotation.x = lerpf(p.torso.rotation.x, lean, k)
	p.head.rotation.x = lerpf(p.head.rotation.x, -lean * 0.5, k)


## Remove the avatar from the scene and free it.
func dispose() -> void:
	if is_instance_valid(root):
		root.queue_free()


## Build a Subject for a session player.
static func for_player(player) -> Subject:
	var lk: Dictionary = player.look.duplicate()
	lk["number"] = "%02d" % (player.slot + 1)
	return Subject.new(lk)

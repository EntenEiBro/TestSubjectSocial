class_name Props
## Minigame props modelled in Blender (blender/build_props.py), exported per
## game to res://assets/models/props/<game>.glb.
##
##   var blade := Props.make("sawblade", "blade")   # fresh copy at the origin
##
## Blender material names follow "m_<tex>_<rrggbb>" (lit) / "g_<tex>_<rrggbb>"
## (unlit), optional "_2s" (double-sided); they are rebuilt here with Mats so
## props share the exact flat look (and material cache) of procedural parts.

static var _scenes := {}
static var _mats := {}


static func _template(game_id: String) -> Node:
	if not _scenes.has(game_id):
		var path := "res://assets/models/props/%s.glb" % game_id
		_scenes[game_id] = (load(path) as PackedScene).instantiate() if ResourceLoader.exists(path) else null
	return _scenes[game_id]


static func has(game_id: String, part: String) -> bool:
	var t := _template(game_id)
	return t != null and _find_part(t, game_id, part) != null


## The named part below the game's root empty (which is named like the game,
## as is the glb's own root node; a part with that same name is still found).
static func _find_part(t: Node, game_id: String, part: String) -> Node:
	var root: Node = t
	while root.name == game_id and root.get_child_count() == 1 and root.get_child(0).name == game_id:
		root = root.get_child(0)
	if root.name == game_id:
		for c in root.get_children():
			var f := Subject._find(c, part)
			if f:
				return f
		return null
	return Subject._find(root, part)


## A new instance of the named part (transform reset to identity), or null.
static func make(game_id: String, part: String) -> Node3D:
	var t := _template(game_id)
	if t == null:
		push_error("Props: missing %s.glb" % game_id)
		return null
	var src := _find_part(t, game_id, part) as Node3D
	if src == null:
		push_error("Props: %s has no part '%s'" % [game_id, part])
		return null
	var n: Node3D = src.duplicate()
	n.transform = Transform3D.IDENTITY
	_apply(n)
	return n


static func material(src: Material) -> Material:
	if src == null:
		return null
	var key := src.resource_name
	if _mats.has(key):
		return _mats[key]
	var parts := key.split("_")
	var out: Material
	if parts.size() >= 3 and (parts[0] == "m" or parts[0] == "g") and parts[2].is_valid_hex_number():
		var color := parts[2].hex_to_int()
		var tex = null if parts[1] == "none" else Tex.named(parts[1])
		var extra := {"double_side": parts.size() > 3 and parts[3] == "2s"}
		if parts[0] == "g":
			if tex:
				extra["tex"] = tex
			out = Mats.glow(color, extra)
		else:
			out = Mats.mat(color, tex, extra)
	else:
		out = Subject.flat(src)
	_mats[key] = out
	return out


static func _apply(node: Node) -> void:
	if node is MeshInstance3D:
		var mi: MeshInstance3D = node
		if mi.mesh:
			for i in mi.mesh.get_surface_count():
				mi.set_surface_override_material(i, material(mi.mesh.surface_get_material(i)))
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if Env.shadows_enabled else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for c in node.get_children():
		_apply(c)

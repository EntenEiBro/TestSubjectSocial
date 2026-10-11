@tool
extends Node3D
## Editor stage for the Live Follow plugin: lays a game's Blender props out in
## a row (each with its name above it) and turns them slowly. Nothing added
## here is saved (the preview nodes have no owner).

const ROW_WIDTH := 5.0

var _parts: Array[Node3D] = []


func show_glb(path: String) -> void:
	var old := get_node_or_null("Props")
	if old:
		old.free()
	_parts.clear()
	var scene := ResourceLoader.load(path, "PackedScene", ResourceLoader.CACHE_MODE_REPLACE) as PackedScene
	if scene == null:
		return
	var inst := scene.instantiate()
	# glb root -> the game's empty -> named parts
	var game_root: Node = inst.get_child(0) if inst.get_child_count() == 1 and not (inst.get_child(0) is MeshInstance3D) else inst
	var holder := Node3D.new()
	holder.name = "Props"
	add_child(holder)
	var title := Label3D.new()
	title.text = path.get_file().get_basename().to_upper()
	title.font_size = 64
	title.pixel_size = 0.004
	title.position = Vector3(0, 2.2, 0)
	title.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	holder.add_child(title)
	var items := []
	var total := 0.0
	for c in game_root.get_children():
		if not (c is Node3D):
			continue
		var aabb := _aabb(c, Transform3D.IDENTITY)
		var w: float = max(0.3, max(aabb.size.x, aabb.size.z))
		items.append({"node": c, "aabb": aabb, "w": w})
		total += w + 0.4
	var k: float = min(1.0, ROW_WIDTH / max(0.01, total))
	var x := -total * k / 2.0
	for it in items:
		var src: Node3D = it.node
		var pivot := Node3D.new()
		var part: Node3D = src.duplicate()
		part.transform = Transform3D.IDENTITY
		Props._apply(part)   # the game's flat materials
		var a: AABB = it.aabb
		part.position = -Vector3(a.get_center().x, a.position.y, a.get_center().z)
		pivot.add_child(part)
		pivot.scale = Vector3.ONE * k
		x += (it.w + 0.4) * k / 2.0
		pivot.position = Vector3(x, 0, 0)
		x += (it.w + 0.4) * k / 2.0
		holder.add_child(pivot)
		_parts.append(pivot)
		var lab := Label3D.new()
		lab.text = src.name
		lab.font_size = 32
		lab.pixel_size = 0.003
		lab.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		lab.position = Vector3(x - (it.w + 0.4) * k / 2.0, max(0.2, a.size.y * k) + 0.25, 0)
		holder.add_child(lab)
	inst.free()


func _process(delta: float) -> void:
	for p in _parts:
		if is_instance_valid(p):
			p.rotate_y(delta * 0.6)


## Bounds of n and its descendants in n's own space (t = accumulated transform).
static func _aabb(n: Node, t: Transform3D) -> AABB:
	var out := AABB()
	var first := true
	if n is MeshInstance3D and (n as MeshInstance3D).mesh:
		out = t * (n as MeshInstance3D).mesh.get_aabb()
		first = false
	for c in n.get_children():
		if c is Node3D:
			var ca := _aabb(c, t * (c as Node3D).transform)
			if ca.size != Vector3.ZERO:
				out = ca if first else out.merge(ca)
				first = false
	return out

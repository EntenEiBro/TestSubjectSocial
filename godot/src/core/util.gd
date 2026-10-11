class_name U
## Small, dependency-free helpers shared by every module.


## Frame-rate independent exponential smoothing factor.
static func damp(lambda: float, dt: float) -> float:
	return 1.0 - exp(-lambda * dt)


static func hypot(x: float, y: float) -> float:
	return sqrt(x * x + y * y)


## Shortest signed difference between two angles (radians).
static func angle_diff(a: float, b: float) -> float:
	var d := fmod(b - a, TAU)
	if d > PI:
		d -= TAU
	if d < -PI:
		d += TAU
	return d


## Distance between two points on the ground plane (x/z).
static func dist2d(a: Vector3, b: Vector3) -> float:
	return hypot(a.x - b.x, a.z - b.z)


## Cosmetic random float in [a, b) (NOT for simulation: use Rng.rand).
static func crand(a: float = 0.0, b: float = 1.0) -> float:
	return a + randf() * (b - a)


## Format seconds as M:SS.
static func format_time(sec: float) -> String:
	var s := int(max(0.0, ceil(sec)))
	return "%d:%02d" % [s / 60, s % 60]


## Colour from 0xRRGGBB, "#rrggbb" or a Color.
static func col(c: Variant, alpha: float = 1.0) -> Color:
	if c is Color:
		return Color(c.r, c.g, c.b, alpha * c.a)
	if c is String:
		var k := Color.html(c)
		k.a *= alpha
		return k
	var v := int(c)
	return Color(((v >> 16) & 0xFF) / 255.0, ((v >> 8) & 0xFF) / 255.0, (v & 0xFF) / 255.0, alpha)


## Move `node` under `new_parent` keeping its world transform (THREE's attach()).
static func reparent_keep(node: Node3D, new_parent: Node3D) -> void:
	var t := node.global_transform
	if node.get_parent():
		node.get_parent().remove_child(node)
	new_parent.add_child(node)
	node.global_transform = t


## Add several children at once; returns the parent.
static func add(parent: Node, children: Array) -> Node:
	for c in children:
		if c:
			parent.add_child(c)
	return parent


## Ease helpers for UI animation.
static func ease_out_cubic(x: float) -> float:
	x = clampf(x, 0.0, 1.0)
	return 1.0 - pow(1.0 - x, 3.0)


static func ease_out_back(x: float) -> float:
	x = clampf(x, 0.0, 1.0)
	var c := 1.7
	return 1.0 + (c + 1.0) * pow(x - 1.0, 3.0) + c * pow(x - 1.0, 2.0)


## Euler (x, y, z) applied in THREE's default XYZ order.
static func set_rot(n: Node3D, x: float, y: float, z: float) -> void:
	n.rotation_order = EULER_ORDER_XYZ
	n.rotation = Vector3(x, y, z)

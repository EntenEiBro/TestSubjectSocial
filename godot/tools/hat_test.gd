extends Node3D
## Hat / face fit check: lines up avatars wearing every hat (and every face),
## then saves orthographic front and side elevations of their heads, plus a
## perspective overview, and quits.
##   godot --path godot --windowed --resolution 1920x1080 res://tools/hat_test.tscn -- --out=C:/tmp/hats
## Files: <out>/hats_front_<n>.png, hats_side_<n>.png, hats_overview.png

const ENTRIES := [
	["None", "Plain"], ["Hard Hat", "Plain"], ["Beanie", "Plain"], ["Bucket", "Plain"],
	["Paper Bag", "Plain"], ["Top Hat", "Plain"], ["Gas Mask", "Plain"], ["Welder", "Plain"],
	["Headlamp", "Plain"], ["Party Hat", "Plain"], ["None", "Goggles"], ["None", "Shades"],
	["None", "Bandage"], ["None", "Monocle"], ["None", "Mustache"], ["Hard Hat", "Goggles"],
]
const PER_SHOT := 4
const SPACING := 0.85
const HEAD_Y := 1.88      # hips 0.92 + torso 0.08 + head 0.88

var out_dir := "user://hat_test"
var subjects := []
var camera: Camera3D


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if str(a).begins_with("--out="):
			out_dir = str(a).trim_prefix("--out=")
	DirAccess.make_dir_recursive_absolute(out_dir)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.32, 0.33, 0.35)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.55, 0.55, 0.58)
	env.ambient_light_energy = 0.8
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.light_energy = 1.1
	sun.shadow_enabled = true
	Env.look_dir(sun, Vector3(-0.35, -0.8, -0.55))
	add_child(sun)
	var floor_m := MeshInstance3D.new()
	floor_m.mesh = Geo.plane(40, 40)
	floor_m.material_override = Mats.mat(0x6a6a66)
	floor_m.rotation.x = -PI / 2
	add_child(floor_m)

	for i in ENTRIES.size():
		var e: Array = ENTRIES[i]
		var s := Subject.new({"suit": Subject.SUIT_COLORS[i % Subject.SUIT_COLORS.size()].hex, "skin": Subject.SKIN_TONES[i % 3],
			"hat": e[0], "face": e[1], "number": "%02d" % (i + 1)})
		s.root.position = Vector3(i * SPACING, 0, 0)
		add_child(s.root)
		s.animate(0.0, 0.0)
		subjects.append(s)
		var lab := Label3D.new()
		lab.text = "%s / %s" % [e[0], e[1]]
		lab.font_size = 28
		lab.pixel_size = 0.0035
		lab.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		lab.position = Vector3(i * SPACING, HEAD_Y + 0.95, 0)
		lab.modulate = Color(1, 1, 0.8)
		add_child(lab)

	camera = Camera3D.new()
	add_child(camera)
	camera.current = true
	_run.call_deferred()


func _shot(file: String) -> void:
	for i in 4:
		await get_tree().process_frame
	await RenderingServer.frame_post_draw
	var path := out_dir.path_join(file)
	get_viewport().get_texture().get_image().save_png(path)
	print("screenshot ", path)


func _run() -> void:
	var groups := int(ceil(ENTRIES.size() / float(PER_SHOT)))
	camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	camera.size = 1.85   # vertical metres (16:9 → 3.3 m wide: four avatars)
	for side in [false, true]:
		for s in subjects:
			s.root.rotation.y = PI / 2 if side else 0.0   # side: face pointing to screen-right
		for g in groups:
			var cx := (g * PER_SHOT + (PER_SHOT - 1) / 2.0) * SPACING
			camera.transform = Transform3D(Basis.IDENTITY, Vector3(cx, HEAD_Y + 0.35, 6.0))
			await _shot("hats_%s_%d.png" % ["side" if side else "front", g + 1])
	# Perspective three-quarter overview of everyone.
	for s in subjects:
		s.root.rotation.y = 0.45
	camera.projection = Camera3D.PROJECTION_PERSPECTIVE
	camera.fov = 40
	var mid := (ENTRIES.size() - 1) * SPACING / 2.0
	Env.look_from(camera, Vector3(mid, HEAD_Y + 1.6, 7.5), Vector3(mid, HEAD_Y - 0.2, 0))
	await _shot("hats_overview.png")
	get_tree().quit()

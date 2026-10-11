class_name Main
extends Node
## Application bootstrap and top-level menu loop (port of main.js).
##
## The App owns the long-lived systems — renderer, HUD, menu overlay, backdrop,
## touch controls, settings, roster — and runs the linear menu flow:
##   intro → title → lobby → program select → program (rounds) → final → lobby …
##
## Command-line options (after "--"), for testing:
##   --game=<id>         jump straight into one simulation
##   --players=N         participants (default 4)    --humans=N  keyboard humans (default 0)
##   --quick             skip title card + briefing  --loop     replay forever
##   --test              headless check: fast-forward the round(s), print JSON results, quit
##   --shot=<file.png>   save a screenshot after --shot-at seconds (default 3) and quit
##   --room=<CODE>       start as an online client in that room

const RESOLUTIONS := [
	{"h": 360, "label": "RETRO 360p"},
	{"h": 540, "label": "GRAINY 540p"},
	{"h": 720, "label": "HD 720p"},
	{"h": 1080, "label": "FULL HD 1080p"},
]
const SETTINGS_PATH := "user://settings.json"

static var app = null

var settings := {"master": 0.8, "music": 0.5, "sfx": 0.9, "botLevel": 1, "resHeight": 1080, "gore": true, "hapticLevel": 3, "lang": ""}
var world_vp: SubViewport
var view: TextureRect
var hud: Hud
var overlay_layer: CanvasLayer
var overlay: Control          # screens put their content here
var overlay_bg: ColorRect
var overlay_grad: TextureRect
var toast_layer: CanvasLayer
var touch = null              # TouchControls on phones / tablets
var backdrop: Backdrop
var screens: Screens
var flow: Flow
var players := []
var game: Minigame = null
var quick := false
var paused := false
var time_scale := 1.0
var platform := "desktop"
var last_game_id := ""
var last_results = null
var last_custom = null
var remote_tap := Callable()  # lobby: online clients' taps on the seat cards
var args := {}
var _frame_handlers := []
var _pause_choice := ""
var _shake := 0.0
var _cam_offset := Vector2.ZERO
var _current_scene: Node3D = null
var _grain_mat: ShaderMaterial
var _time := 0.0


func _ready() -> void:
	app = self
	_parse_args()
	_load_settings()
	platform = "android" if OS.get_name() == "Android" else "desktop"
	Env.shadows_enabled = platform != "android" and not args.has("noshadows")
	FX.gore = 1.0 if settings.gore else 0.25
	if str(settings.lang) == "":
		var dev := OS.get_locale_language()
		settings.lang = dev if dev in ["en", "de", "ru", "zh", "ja", "it", "hi"] else "en"
	I18n.set_language(settings.lang)
	for k in ["master", "music", "sfx"]:
		Sfx.set_volume(k, float(settings[k]))
	Haptics.level = int(settings.hapticLevel)
	_build_tree()
	Commendations.unlocked.connect(func(def): toast(I18n.t("COMMENDATION — {title}", {"title": I18n.t(def.title)}), I18n.t(def.desc)))
	if is_touch_device():
		Sfx.on_haptic = func(n): Haptics.from_sfx(n)
	if args.has("watch") and platform == "desktop":
		# A window over the editor (on the editor's screen), 60% of its width.
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED)
		if args.has("screen") and int(args.screen) < DisplayServer.get_screen_count():
			DisplayServer.window_set_current_screen(int(args.screen))
		var w := int(DisplayServer.screen_get_usable_rect(DisplayServer.window_get_current_screen()).size.x * 0.6)
		DisplayServer.window_set_size(Vector2i(w, w * 9 / 16))
	if platform == "desktop" and DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_WINDOWED:
		_fit_window()
	get_viewport().size_changed.connect(_resize)
	_resize()
	show_backdrop()
	if args.has("shot"):
		_screenshot_later(str(args.shot), str(args.get("shot-at", "3")))
	run.call_deferred()


func _parse_args() -> void:
	var list := Array(OS.get_cmdline_user_args())
	# Started with the editor's Play button by the Live Follow plugin: the
	# requested args are handed over in .live/run_args.txt (consumed once).
	var hand_off := ProjectSettings.globalize_path("res://.live/run_args.txt")
	if EngineDebugger.is_active() and FileAccess.file_exists(hand_off):
		list.append_array(FileAccess.get_file_as_string(hand_off).strip_edges().split(" ", false))
		DirAccess.remove_absolute(hand_off)
	for a in list:
		var s := str(a).trim_prefix("--")
		var eq := s.find("=")
		if eq >= 0:
			args[s.substr(0, eq)] = s.substr(eq + 1)
		else:
			args[s] = true


func is_touch_device() -> bool:
	return args.has("touch") or (DisplayServer.is_touchscreen_available() and OS.has_feature("mobile"))


func _build_tree() -> void:
	world_vp = SubViewport.new()
	world_vp.name = "World"
	world_vp.size = Vector2i(1280, 720)
	world_vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	world_vp.audio_listener_enable_3d = false
	world_vp.positional_shadow_atlas_size = 2048
	add_child(world_vp)
	view = TextureRect.new()
	view.name = "View"
	view.texture = world_vp.get_texture()
	view.set_anchors_preset(Control.PRESET_FULL_RECT)
	view.stretch_mode = TextureRect.STRETCH_SCALE
	view.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	view.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(view)

	var hud_layer := CanvasLayer.new()
	hud_layer.layer = 1
	add_child(hud_layer)
	hud = Hud.new()
	hud_layer.add_child(hud)

	overlay_layer = CanvasLayer.new()
	overlay_layer.layer = 2
	add_child(overlay_layer)
	overlay_bg = ColorRect.new()
	overlay_bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	overlay_bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay_bg.color = Color(0, 0, 0, 0)
	overlay_layer.add_child(overlay_bg)
	overlay_grad = TextureRect.new()
	overlay_grad.set_anchors_preset(Control.PRESET_FULL_RECT)
	overlay_grad.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var grad := Gradient.new()
	grad.offsets = PackedFloat32Array([0.0, 0.45, 0.7, 1.0])
	grad.colors = PackedColorArray([Color(0, 0, 0, 0.78), Color(0, 0, 0, 0.3), Color(0, 0, 0, 0), Color(0, 0, 0, 0)])
	var gt := GradientTexture2D.new()
	gt.gradient = grad
	gt.width = 256
	gt.height = 4
	overlay_grad.texture = gt
	overlay_grad.stretch_mode = TextureRect.STRETCH_SCALE
	overlay_grad.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	overlay_grad.visible = false
	overlay_layer.add_child(overlay_grad)
	overlay = Control.new()
	overlay.name = "Overlay"
	overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay_layer.add_child(overlay)

	if is_touch_device():
		var tl := CanvasLayer.new()
		tl.layer = 3
		add_child(tl)
		touch = TouchControls.new()
		tl.add_child(touch)

	toast_layer = CanvasLayer.new()
	toast_layer.layer = 4
	add_child(toast_layer)

	var fx_layer := CanvasLayer.new()
	fx_layer.layer = 5
	add_child(fx_layer)
	var grain := ColorRect.new()
	grain.set_anchors_preset(Control.PRESET_FULL_RECT)
	grain.mouse_filter = Control.MOUSE_FILTER_IGNORE
	# Soft black vignette (no noise: a grain texture read as a speckled grid at the edges).
	var sh := Shader.new()
	sh.code = """shader_type canvas_item;
void fragment() {
	vec2 d = (UV - vec2(0.5)) * vec2(1.0, 0.75);
	COLOR = vec4(0.0, 0.0, 0.0, smoothstep(0.34, 0.70, length(d)) * 0.55);
}"""
	_grain_mat = ShaderMaterial.new()
	_grain_mat.shader = sh
	grain.material = _grain_mat
	fx_layer.add_child(grain)

	backdrop = Backdrop.new()
	screens = Screens.new(self)
	flow = Flow.new(self)


## Render height follows the setting but never exceeds the screen's pixels.
func _resize() -> void:
	var win := DisplayServer.window_get_size()
	var stage_h: float = min(float(win.y), float(win.x) * 9.0 / 16.0)
	var h := int(max(90.0, min(float(settings.resHeight), stage_h)))
	if args.has("test"):
		h = 90
	world_vp.size = Vector2i(int(round(h * 16.0 / 9.0)), h)
	var hd: bool = int(settings.resHeight) >= 720
	view.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR if hd else CanvasItem.TEXTURE_FILTER_NEAREST
	world_vp.msaa_3d = Viewport.MSAA_2X if hd and platform != "android" else Viewport.MSAA_DISABLED


## Keep a windowed game fully on screen: shrink it (16:9) to fit the usable
## area (taskbar excluded, room for the title bar) and centre it. With display
## scaling a 1280x720 window can otherwise hang off the bottom of the screen.
func _fit_window() -> void:
	var scr := DisplayServer.window_get_current_screen()
	var usable := DisplayServer.screen_get_usable_rect(scr)
	var title_bar := 40
	var size := Vector2(DisplayServer.window_get_size())
	var k: float = minf(1.0, minf(usable.size.x * 0.92 / size.x, (usable.size.y - title_bar) * 0.92 / size.y))
	var s := Vector2i(size * k)
	DisplayServer.window_set_size(s)
	DisplayServer.window_set_position(usable.position + Vector2i((usable.size.x - s.x) / 2, title_bar + (usable.size.y - title_bar - s.y) / 2))


func apply_resolution() -> void:
	_resize()


## Subscribe a per-frame handler func(dt); returns an unsubscribe Callable.
func on_frame(fn: Callable) -> Callable:
	var entry := [fn]
	_frame_handlers.append(entry)
	return func(): _frame_handlers.erase(entry)


## Show a scene (minigame root or backdrop) in the 3D view.
func set_scene(node: Node3D, cam: Camera3D) -> void:
	if _current_scene and _current_scene != node and is_instance_valid(_current_scene) and _current_scene.get_parent() == world_vp:
		world_vp.remove_child(_current_scene)
	_current_scene = node
	if node.get_parent() != world_vp:
		if node.get_parent():
			node.get_parent().remove_child(node)
		world_vp.add_child(node)
	if cam:
		cam.current = true
		cam.h_offset = 0.0
		cam.v_offset = 0.0


func show_backdrop() -> void:
	set_scene(backdrop, backdrop.camera)


func current_camera() -> Camera3D:
	return world_vp.get_camera_3d()


## Add camera shake (decays automatically).
func shake(amount: float = 0.3) -> void:
	_shake = min(1.5, _shake + amount)


func _process(delta: float) -> void:
	_time += delta
	var raw: float = min(delta, 1.0 / 20.0)
	if args.has("fps") and int(_time) != int(_time - delta):
		print("fps %d  t=%.1f  draw=%d" % [Engine.get_frames_per_second(), _time, RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME)])
	frame(raw * time_scale)
	_apply_shake(raw)


## One frame of the app (also used by tests to fast-forward).
func frame(dt: float) -> void:
	Inputs.update()
	Net.pump()
	for entry in _frame_handlers.duplicate():
		if entry in _frame_handlers:
			entry[0].call(dt)
	if game and is_instance_valid(game) and not paused:
		if game.lockstep and Net.lockstep_active():
			Net.lockstep_update(dt)
		else:
			game.tick(dt)
		var pause_pressed := Inputs.key_pressed("Escape") or Inputs.action_pressed("pause") or Inputs.any_pad_pressed(9)
		if game and game.state == "play" and pause_pressed and not Net.is_client():
			open_pause()
	elif game == null:
		backdrop.update(dt)
	Inputs.end_frame()


func _apply_shake(dt: float) -> void:
	var cam := current_camera()
	if cam == null:
		return
	if _shake <= 0.001:
		if _cam_offset != Vector2.ZERO:
			cam.h_offset = 0.0
			cam.v_offset = 0.0
			_cam_offset = Vector2.ZERO
		return
	var s := _shake * 0.25
	_cam_offset = Vector2((randf() - 0.5) * s, (randf() - 0.5) * s)
	cam.h_offset = _cam_offset.x
	cam.v_offset = _cam_offset.y
	_shake = max(0.0, _shake - dt * 2.2)


## Replace the overlay content. cls: "" | dim | card | clear | title
func set_overlay(content: Control, cls: String = "") -> void:
	for c in overlay.get_children():
		c.queue_free()
	set_overlay_class(cls)
	if content:
		overlay.add_child(content)


func set_overlay_class(cls: String) -> void:
	overlay_grad.visible = cls == "title"
	match cls:
		"dim":
			overlay_bg.color = Color(0, 0, 0, 0.62)
		"card":
			overlay_bg.color = Color(0, 0, 0, 1)
		_:
			overlay_bg.color = Color(0, 0, 0, 0)


func clear_overlay() -> void:
	set_overlay(null, "clear")


## Slide-in notification (commendations).
func toast(title: String, body: String = "") -> void:
	var box := PanelContainer.new()
	var sb := UI.flat_box(Color(12 / 255.0, 11 / 255.0, 9 / 255.0, 0.95))
	sb.border_width_left = UI.u(0.8)
	sb.border_color = UI.HAZARD
	sb.content_margin_left = UI.u(2)
	sb.content_margin_right = UI.u(2)
	sb.content_margin_top = UI.u(1)
	sb.content_margin_bottom = UI.u(1)
	box.add_theme_stylebox_override("panel", sb)
	box.add_child(UI.vbox([UI.label(title, "ops", 2.6, UI.HAZARD, HORIZONTAL_ALIGNMENT_LEFT), UI.label(body, "elite", 2.0, UI.BONE_DIM, HORIZONTAL_ALIGNMENT_LEFT)], 0.3, false))
	box.position = Vector2(1280, 720 * 0.3)
	toast_layer.add_child(box)
	Sfx.play("ding")
	await get_tree().process_frame
	var tw := create_tween()
	tw.tween_property(box, "position:x", 1280 - box.size.x - UI.u(2), 0.35).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tw.tween_interval(3.5)
	tw.tween_property(box, "modulate:a", 0.0, 0.6)
	tw.tween_callback(box.queue_free)


func open_pause() -> void:
	paused = true
	time_scale = 0.0
	Inputs.end_frame()
	if touch:
		touch.set_context("")
	Haptics.round_active = false
	var choice: String = await screens.pause_screen()
	Haptics.round_active = choice == "resume"
	paused = false
	time_scale = 1.0
	if touch and choice == "resume":
		touch.set_context("play")
	if choice != "resume":
		_pause_choice = choice


## The pause-menu decision since the round started ("" = none).
func take_pause_choice() -> String:
	var c := _pause_choice
	_pause_choice = ""
	return c


func set_language(code: String) -> void:
	settings.lang = code
	I18n.set_language(code)
	save_settings()


func _load_settings() -> void:
	if FileAccess.file_exists(SETTINGS_PATH):
		var d = JSON.parse_string(FileAccess.get_file_as_string(SETTINGS_PATH))
		if d is Dictionary:
			for k in d:
				settings[k] = d[k]
	var ok := false
	for r in RESOLUTIONS:
		if int(r.h) == int(settings.resHeight):
			ok = true
	if not ok:
		settings.resHeight = 1080


func save_settings() -> void:
	FX.gore = 1.0 if settings.gore else 0.25
	var f := FileAccess.open(SETTINGS_PATH, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(settings))


func quit() -> void:
	get_tree().quit()


func toggle_fullscreen() -> void:
	var m := DisplayServer.window_get_mode()
	DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED if m == DisplayServer.WINDOW_MODE_FULLSCREEN or m == DisplayServer.WINDOW_MODE_EXCLUSIVE_FULLSCREEN else DisplayServer.WINDOW_MODE_FULLSCREEN)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_F11:
		toggle_fullscreen()


func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT or what == NOTIFICATION_APPLICATION_PAUSED:
		Sfx.suspend()
		if game and is_instance_valid(game) and game.state == "play" and not paused and not Net.is_client() and platform == "android":
			open_pause()
	elif what == NOTIFICATION_APPLICATION_FOCUS_IN or what == NOTIFICATION_APPLICATION_RESUMED:
		Sfx.resume()
	elif what == NOTIFICATION_WM_GO_BACK_REQUEST:
		# Android back button behaves like Esc (pause / back in menus).
		var e := InputEventKey.new()
		e.keycode = KEY_ESCAPE
		e.physical_keycode = KEY_ESCAPE
		e.pressed = true
		Input.parse_input_event(e)
		var up := e.duplicate()
		up.pressed = false
		get_tree().create_timer(0.08).timeout.connect(func(): Input.parse_input_event(up))


# ---------------------------------------------------------------------- flows

func run() -> void:
	if args.has("room"):
		await Net.run_client(self, str(args.room).to_upper())
		return
	if args.has("game"):
		await quick_launch()
		return
	await screens.intro_screen()
	while true:
		var choice: String = await screens.title_screen()
		match choice:
			"options":
				await screens.options_screen()
				continue
			"manual":
				await screens.manual_screen(Registry.games())
				continue
			"credits":
				await screens.credits_screen()
				continue
			"commendations":
				await screens.commendations_screen(Registry.games())
				continue
			"quit":
				quit()
				return
			"join":
				await screens.join_screen()
				continue
			"online":
				if str(await screens.online_screen()) != "play":
					Net.stop_hosting()
					continue
		# play
		while true:
			var roster = await screens.lobby_screen()
			if roster == null:
				break
			var mode = null
			while true:
				var m = await screens.mode_screen(Registry.games().size())
				if m == null:
					break
				if str(m) == "custom":
					var c = await screens.custom_screen(Registry.games())
					if c == null:
						continue
					mode = c
				else:
					mode = m
				break
			if mode == null:
				continue
			await flow.play_program(mode)
		Net.stop_hosting()


## Debug path: jump straight into a simulation with bots (and --test).
func quick_launch() -> void:
	var G = Registry.find(str(args.game))
	if G == null:
		set_overlay(UI.center(UI.label("UNKNOWN GAME: %s" % args.game, "ops", 4)), "dim")
		if args.has("test"):
			print(JSON.stringify({"error": "unknown game", "id": args.game}))
			get_tree().quit(2)
		return
	var n := int(args.get("players", 4))
	var humans := int(args.get("humans", 0))
	var devices := ["kb1", "kb2", "pad0", "pad1"]
	players = []
	for i in n:
		players.append(Player.new(i, devices[i] if i < humans else "bot"))
	quick = args.has("quick") or args.has("test")
	if args.has("test"):
		await _run_test(G)
		return
	while true:
		for p in players:
			p.reset_stats()
		await flow.play_round(G, 0, 1)
		await screens.points_screen(players, last_results, {"game": G})
		if not args.has("loop"):
			break
	await screens.standings(players)


## --shot=<file.png> --shot-at=2,5.5,9 saves one screenshot per time (file_1.png …), then quits.
func _screenshot_later(path: String, times: String) -> void:
	var at := Array(times.split(",")).map(func(s): return float(s))
	var start := Time.get_ticks_msec() / 1000.0
	for i in at.size():
		var wait: float = at[i] - (Time.get_ticks_msec() / 1000.0 - start)
		if wait > 0.0:
			await get_tree().create_timer(wait).timeout
		await RenderingServer.frame_post_draw
		var file := path if at.size() == 1 else path.get_basename() + "_%d.png" % (i + 1)
		get_viewport().get_texture().get_image().save_png(file)
		print("screenshot ", file)
	get_tree().quit()


## Headless round check: simulate at fixed steps until the round ends, print results.
func _run_test(G) -> void:
	var seeds := int(args.get("seeds", 1))
	var out := []
	for s in seeds:
		Rng.seed_random(1000 + s * 7919)
		for p in players:
			p.reset_stats()
		var g: Minigame = G.new({"engine": self, "hud": hud, "players": players, "bot_difficulty": 0.6})
		g.build()
		g.prewarm()
		set_scene(g, g.camera)
		g.state = "preview"
		game = g
		g.begin()
		var steps := 0
		var t0 := Time.get_ticks_msec()
		while g.result_tiers == null and steps < 60 * 300:
			Inputs.update()
			g.tick(1.0 / 60.0)
			Inputs.end_frame()
			steps += 1
			if steps % 600 == 0:
				await get_tree().process_frame
		var tiers = g.result_tiers if g.result_tiers != null else g.placement()
		var places := []
		var pos := 1
		for tier in tiers:
			for seat in tier:
				places.append({"slot": seat.player.slot, "place": pos, "alive": seat.alive})
			pos += tier.size()
		out.append({"seed": s, "sim_s": snappedf(steps / 60.0, 0.1), "finished": g.result_tiers != null, "ranked": places.size(), "places": places, "ms": Time.get_ticks_msec() - t0})
		game = null
		g.dispose()
		await get_tree().process_frame
	print("TEST_RESULT " + JSON.stringify({"game": G.META.id, "players": players.size(), "runs": out}))
	get_tree().quit()

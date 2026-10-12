class_name Screens
extends RefCounted
## Every full-screen menu / interstitial as an awaitable function (port of
## screens.js). Each screen builds Controls into the app overlay, runs a
## per-frame handler and resolves when the player makes a choice:
##
##   var choice = await app.screens.title_screen()

const VERSION := "2.0.0"
const FIELDS := ["suit", "skin", "hat", "face", "ready"]
const FIELD_LABEL := {"suit": "JUMPSUIT", "skin": "SKIN", "hat": "HEAD", "face": "FACE", "ready": "READY"}
const HAPTIC_LEVELS := ["OFF", "LOW", "MEDIUM", "HIGH"]

var app


class Run extends RefCounted:
	signal done(value)
	var finished := false
	var value = null

	func finish(v = null) -> void:
		if finished:
			return
		finished = true
		value = v
		done.emit(v)


func _init(app_in) -> void:
	app = app_in


func t(s: String, vars: Dictionary = {}) -> String:
	return I18n.t(s, vars)


## Show `content`, run handler(dt, run) every frame until run.finish(value).
## tap_any(run) is called for taps on empty space (continue-style screens).
func run_screen(content: Control, cls: String, handler: Callable, tap_any: Callable = Callable()) -> Variant:
	var r := Run.new()
	app.set_overlay(content, cls)
	if tap_any.is_valid():
		var catcher := Control.new()
		catcher.set_anchors_preset(Control.PRESET_FULL_RECT)
		catcher.mouse_filter = Control.MOUSE_FILTER_STOP
		catcher.gui_input.connect(func(e):
			if (e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT) or (e is InputEventScreenTouch and e.pressed):
				tap_any.call(r))
		app.overlay.add_child(catcher)
		app.overlay.move_child(catcher, 0)
	var off: Callable = app.on_frame(func(dt):
		if not r.finished:
			handler.call(dt, r))
	var v = await r.done
	off.call()
	return v


## Vertical list navigation shared by simple menus. Returns the direction used.
func menu_nav(count: int, state: Dictionary, paint: Callable) -> String:
	var d: String = Inputs.menu_dir()
	if d == "up" or d == "down":
		state.index = (int(state.index) + (1 if d == "down" else -1) + count) % count
		Sfx.play("click")
		paint.call()
	return d


func _hint(text_bb: String) -> RichTextLabel:
	var h := UI.rich(text_bb, "vt", 2.6, UI.BONE_DIM)
	h.custom_minimum_size.x = 640
	h.visible = not I18n.is_touch_mode()
	return h


## A flat clickable text row (menus).
func _menu_item(text: String, size_u: float = 4.4) -> Button:
	var b := Button.new()
	b.text = text
	b.flat = true
	b.focus_mode = Control.FOCUS_NONE
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	b.add_theme_font_override("font", UI.font("ops"))
	b.add_theme_font_size_override("font_size", UI.u(size_u))
	for st in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		b.add_theme_color_override(st, UI.BONE_DIM)
	var empty := StyleBoxEmpty.new()
	for st in ["normal", "hover", "pressed", "focus"]:
		b.add_theme_stylebox_override(st, empty)
	return b


func _set_item_sel(b: Button, sel: bool, label: String) -> void:
	b.text = ("▸ " + label) if sel else ("   " + label)
	for st in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		b.add_theme_color_override(st, UI.BONE if sel else UI.BONE_DIM)


# ===================================================================== INTRO

## Startup animation (~6 s, always plays in full): terminal boot, CRT switch-on,
## lamps clank on as subjects drop onto the pedestals, the title stamps in.
func intro_screen() -> void:
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var black := ColorRect.new()
	black.color = Color.BLACK
	black.set_anchors_preset(Control.PRESET_FULL_RECT)
	black.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var term := UI.rich("", "vt", 3.8, UI.CRT, "left")
	term.position = Vector2(1280 * 0.08, 720 * 0.14)
	term.custom_minimum_size = Vector2(1000, 0)
	black.add_child(term)
	var crt := ColorRect.new()
	crt.color = Color.WHITE
	crt.size = Vector2(1280, 3)
	crt.position = Vector2(0, 359)
	crt.pivot_offset = Vector2(640, 1.5)
	crt.scale = Vector2(0, 1)
	crt.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var stripe_top := UI.hazard_strip(3.6)
	stripe_top.size = Vector2(1280, UI.u(3.6))
	stripe_top.position = Vector2(-1350, 720 * 0.17)
	var stripe_bot := UI.hazard_strip(3.6)
	stripe_bot.size = Vector2(1280, UI.u(3.6))
	stripe_bot.position = Vector2(1350, 720 * 0.79 - UI.u(3.6))
	var letters := []
	var logo1 := HBoxContainer.new()
	logo1.add_theme_constant_override("separation", 0)
	logo1.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for ch in "TEST SUBJECT":
		var l := UI.shadow(UI.label(ch if ch != " " else "  ", "ops", 11, UI.BONE), 0.4)
		l.modulate.a = 0.0
		logo1.add_child(l)
		letters.append(l)
	var logo2 := UI.outline(UI.label("SOCIAL", "ops", 22, UI.BLOOD), UI.u(0.5), Color("#2a0505")) as Label
	logo2.modulate.a = 0.0
	var logo := UI.vbox([logo1, logo2], -3.0)
	logo.rotation = deg_to_rad(-2)
	var logo_c := UI.center(logo)
	logo_c.position.y = -720 * 0.05
	var warn := UI.label(t("PARTICIPATION IS MANDATORY"), "vt", 3.6, UI.RED)
	warn.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	warn.position = Vector2(-400, -720 * 0.11 - UI.u(5))
	warn.size = Vector2(800, UI.u(5))
	warn.modulate.a = 0.0
	for c in [logo_c, stripe_top, stripe_bot, warn, black, crt]:
		root.add_child(c)

	var lines := [
		{"text": t("FACILITY TERMINAL v{v}", {"v": VERSION}), "value": "", "bad": false},
		_status(t("MAINS POWER"), "OK"),
		_status(t("SUBJECT TRACKING"), "OK"),
		_status(t("LETHAL HAZARDS"), t("ARMED")),
		_status(t("ETHICS COMMITTEE"), t("NOT FOUND"), true),
		{"text": "> " + t("BEGINNING INTAKE"), "value": "", "bad": false},
	]
	app.backdrop.mode = "title"
	for i in Player.MAX_PLAYERS:
		app.backdrop.set_slot(i, null)
	app.backdrop.camera.position = Vector3(0, 7, 21)
	Sfx.music("none")
	var cps := 115.0
	var full := 0
	for l in lines:
		full += l.text.length() + l.value.length()
	var t_crt := full / cps + 0.35
	var state := {"time": 0.0, "typed": 0, "cue": 0}
	var cues := []
	cues.append([t_crt, func():
		Sfx.play("whoosh"); Sfx.play("buzz")
		var tw := root.create_tween()
		tw.tween_property(crt, "scale:x", 1.0, 0.25)
		tw.tween_property(crt, "scale:y", 240.0, 0.25)
		tw.parallel().tween_property(crt, "modulate:a", 0.0, 0.3)
		root.create_tween().tween_property(black, "modulate:a", 0.0, 0.6).set_delay(0.15)])
	for i in 4:
		cues.append([t_crt + 0.45 + i * 0.26, func():
			app.backdrop.set_slot(i, Player.new(i, "bot").look, i + 1)
			Sfx.play("clank")])
	for i in letters.size():
		cues.append([t_crt + 1.6 + i * 0.05, func():
			var l: Label = letters[i]
			l.pivot_offset = l.size / 2
			l.scale = Vector2(2.2, 2.2)
			var tw := l.create_tween()
			tw.tween_property(l, "modulate:a", 1.0, 0.08)
			tw.parallel().tween_property(l, "scale", Vector2.ONE, 0.2).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
			Sfx.play("chisel", {"vol": 0.5})])
	cues.append([t_crt + 2.35, func():
		logo2.pivot_offset = logo2.size / 2
		logo2.scale = Vector2(3, 3)
		var tw := logo2.create_tween()
		tw.tween_property(logo2, "modulate:a", 1.0, 0.1)
		tw.parallel().tween_property(logo2, "scale", Vector2.ONE, 0.35).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		root.create_tween().tween_property(stripe_top, "position:x", 0.0, 0.4).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
		root.create_tween().tween_property(stripe_bot, "position:x", 0.0, 0.4).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
		Sfx.play("sting"); Sfx.play("explode", {"vol": 0.5})
		app.shake(0.9)
		if app.touch or app.platform == "android":
			Haptics.play("explosion")])
	cues.append([t_crt + 2.7, func():
		var tw := warn.create_tween()
		for k in 5:
			tw.tween_property(warn, "modulate:a", 1.0, 0.0)
			tw.tween_interval(0.2)
			tw.tween_property(warn, "modulate:a", 0.0, 0.0)
			tw.tween_interval(0.2)
		tw.tween_property(warn, "modulate:a", 1.0, 0.0)])
	cues.append([t_crt + 4.3, func(): root.create_tween().tween_property(root, "modulate:a", 0.0, 0.5)])
	var end_t := t_crt + 4.8
	await run_screen(root, "clear", func(dt, r):
		state.time += min(dt, 0.1)
		var count := int(min(full, floor(state.time * cps)))
		if count > state.typed:
			if count / 3 > state.typed / 3:
				Sfx.play("tick")
			state.typed = count
			UI.set_rich(term, _term_text(lines, count), "left")
		while state.cue < cues.size() and state.time >= cues[state.cue][0]:
			cues[state.cue][1].call()
			state.cue += 1
		if state.time >= end_t:
			r.finish())


func _status(label: String, value: String, bad: bool = false) -> Dictionary:
	return {"text": "> %s %s " % [label, ".".repeat(max(3, 24 - label.length()))], "value": value, "bad": bad}


func _term_text(lines: Array, count: int) -> String:
	var left := count
	var out := ""
	for l in lines:
		if left <= 0:
			break
		out += str(l.text).substr(0, left)
		left -= str(l.text).length()
		if l.value != "" and left > 0:
			out += "[color=%s]%s[/color]" % ["#ff4a3a" if l.bad else "#47ff6a", str(l.value).substr(0, left)]
			left -= str(l.value).length()
		out += "\n"
	return out.trim_suffix("\n") + "[bgcolor=#47ff6a] [/bgcolor]"


# ===================================================================== TITLE

func title_screen() -> String:
	var items := [{"id": "play", "label": t("BEGIN TESTING")}, {"id": "online", "label": t("HOST ONLINE")}, {"id": "join", "label": t("JOIN ONLINE")}]
	if app.touch == null:
		items.append({"id": "options", "label": t("SETTINGS")})
	items.append_array([{"id": "manual", "label": t("FIELD MANUAL")}, {"id": "commendations", "label": t("COMMENDATIONS")}, {"id": "credits", "label": t("CREDITS")}])
	items.append({"id": "quit", "label": t("QUIT")})
	var state := {"index": 0}
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var l1 := UI.shadow(UI.label("TEST SUBJECT", "ops", 8.5, UI.BONE, HORIZONTAL_ALIGNMENT_LEFT), 0.3)
	var l2 := UI.outline(UI.label("SOCIAL", "ops", 15, UI.BLOOD, HORIZONTAL_ALIGNMENT_LEFT), UI.u(0.4), Color("#2a0505")) as Label
	var logo := UI.vbox([l1, l2], -3.5, false)
	logo.rotation = deg_to_rad(-2)
	var sub := UI.label(t("a collection of lethal party games for 2–4 subjects"), "elite", 2.4, UI.BONE_DIM, HORIZONTAL_ALIGNMENT_LEFT)
	var menu := UI.vbox([], 0.2, false)
	var buttons := []
	for i in items.size():
		var b := _menu_item(items[i].label)
		menu.add_child(b)
		buttons.append(b)
	var hint := _hint("")
	hint.custom_minimum_size.x = 600
	UI.set_rich(hint, I18n.pick("Tap an option", "{MOVE} choose · {A} confirm"), "left")
	var col := UI.vbox([logo, sub, UI.spacer(2), menu, hint], 1.0, false)
	col.position = Vector2(1280 * 0.07, 720 * 0.12)
	root.add_child(col)
	var note := UI.label(t("FACILITY TERMINAL v{v} · ALL OUTCOMES FINAL", {"v": VERSION}), "vt", 2.2, Color("#6b675b"), HORIZONTAL_ALIGNMENT_RIGHT)
	note.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	note.position = Vector2(-1280 * 0.03 - 700, -720 * 0.03 - UI.u(3))
	note.size = Vector2(700, UI.u(3))
	root.add_child(note)
	var paint := func():
		for i in buttons.size():
			_set_item_sel(buttons[i], i == state.index, items[i].label)
	paint.call()
	app.backdrop.mode = "title"
	for i in Player.MAX_PLAYERS:
		app.backdrop.set_slot(i, Player.new(i, "bot").look, i + 1)
	Sfx.music("menu")
	var r_ref := {"r": null}
	for i in buttons.size():
		buttons[i].pressed.connect(func():
			state.index = i
			paint.call()
			Sfx.play("select")
			if r_ref.r:
				r_ref.r.finish(items[i].id))
	if app.touch:
		var gear := UI.tap_btn("⚙", false, 5.0)
		gear.set_anchors_preset(Control.PRESET_TOP_RIGHT)
		gear.position = Vector2(-UI.u(3) - UI.u(10), UI.u(3))
		gear.pressed.connect(func():
			Sfx.play("select")
			if r_ref.r:
				r_ref.r.finish("options"))
		root.add_child(gear)
	return await run_screen(root, "title", func(dt, r):
		r_ref.r = r
		menu_nav(items.size(), state, paint)
		if Inputs.join_pressed() != "":
			Sfx.play("select")
			r.finish(items[state.index].id))


# =================================================================== OPTIONS

func options_screen() -> void:
	var s: Dictionary = app.settings
	var rows := [
		{"key": "lang", "label": func(): return t("LANGUAGE"), "get": func():
			for l in I18n.LANGUAGES:
				if l.code == I18n.current:
					return l.name
			return "English", "step": func(d):
			var codes := I18n.LANGUAGES.map(func(l): return l.code)
			var i: int = (codes.find(I18n.current) + d + codes.size()) % codes.size()
			app.set_language(codes[i])},
		{"key": "master", "label": func(): return t("MASTER VOLUME"), "get": func(): return "%d%%" % roundi(s.master * 100), "step": func(d):
			s.master = _clamp01(s.master + d * 0.1); Sfx.set_volume("master", s.master)},
		{"key": "music", "label": func(): return t("MUSIC VOLUME"), "get": func(): return "%d%%" % roundi(s.music * 100), "step": func(d):
			s.music = _clamp01(s.music + d * 0.1); Sfx.set_volume("music", s.music)},
		{"key": "sfx", "label": func(): return t("EFFECTS VOLUME"), "get": func(): return "%d%%" % roundi(s.sfx * 100), "step": func(d):
			s.sfx = _clamp01(s.sfx + d * 0.1); Sfx.set_volume("sfx", s.sfx)},
		{"key": "bot", "label": func(): return t("BOT SKILL"), "get": func(): return t(["DOCILE", "COMPETENT", "RUTHLESS"][int(s.botLevel)]), "step": func(d):
			s.botLevel = clampi(int(s.botLevel) + d, 0, 2)},
		{"key": "res", "label": func(): return t("RESOLUTION"), "get": func():
			for r in Main.RESOLUTIONS:
				if int(r.h) == int(s.resHeight):
					return t(r.label)
			return "", "step": func(d):
			var idx := 3
			for i in Main.RESOLUTIONS.size():
				if int(Main.RESOLUTIONS[i].h) == int(s.resHeight):
					idx = i
			s.resHeight = Main.RESOLUTIONS[clampi(idx + d, 0, Main.RESOLUTIONS.size() - 1)].h
			app.apply_resolution()},
		{"key": "gore", "label": func(): return t("GORE"), "get": func(): return t("ON") if s.gore else t("REDUCED"), "step": func(_d): s.gore = not s.gore},
		{"key": "back", "label": func(): return t("BACK"), "get": func(): return "", "step": func(_d): pass},
	]
	if app.touch and Haptics.supported():
		rows.insert(1, {"key": "haptics", "label": func(): return t("HAPTIC STRENGTH"), "get": func(): return t(HAPTIC_LEVELS[clampi(int(s.hapticLevel), 0, 3)]), "step": func(d):
			s.hapticLevel = clampi(int(s.hapticLevel) + d, 0, 3)
			Haptics.level = s.hapticLevel
			Haptics.play("click")})
	var state := {"index": 0}
	var p := UI.panel({"width_frac": 0.55})
	var title := UI.label("", "ops", 6.4, UI.BONE)
	var list := UI.vbox([], 0.2, false)
	var hint := _hint("")
	for c in [title, list, hint]:
		p.body.add_child(c)
	var row_nodes := []
	var r_ref := {"r": null}
	for i in rows.size():
		var bg := PanelContainer.new()
		bg.mouse_filter = Control.MOUSE_FILTER_STOP
		var lab := UI.label("", "elite", 3.0, UI.BONE_DIM, HORIZONTAL_ALIGNMENT_LEFT)
		lab.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var dec := UI.tap_btn("◂", false, 3.0)
		var val := UI.label("", "vt", 3.6, UI.CRT)
		val.custom_minimum_size.x = UI.u(22)
		var inc := UI.tap_btn("▸", false, 3.0)
		var h := UI.hbox([lab, dec, val, inc], 1.0, false)
		bg.add_child(h)
		list.add_child(bg)
		row_nodes.append({"bg": bg, "lab": lab, "val": val, "dec": dec, "inc": inc})
	var render := func():
		title.text = t("SETTINGS")
		UI.set_rich(hint, I18n.pick("Tap ◂ ▸ to adjust", "{MOVE} adjust · {BACK} back"))
		for i in rows.size():
			var n: Dictionary = row_nodes[i]
			var v: String = rows[i].get.call()
			n.lab.text = rows[i].label.call()
			n.val.text = v
			n.dec.visible = v != ""
			n.inc.visible = v != ""
			n.val.visible = v != ""
			var sel: bool = i == state.index
			n.bg.add_theme_stylebox_override("panel", UI.flat_box(Color(0.61, 0.11, 0.11, 0.35) if sel else Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0.8))
			n.lab.add_theme_color_override("font_color", UI.BONE if sel else UI.BONE_DIM)
	var change := func(i: int, d: int):
		state.index = i
		rows[i].step.call(d)
		Sfx.play("click")
		render.call()
		app.save_settings()
	for i in rows.size():
		var n: Dictionary = row_nodes[i]
		n.dec.pressed.connect(func(): change.call(i, -1))
		n.inc.pressed.connect(func(): change.call(i, 1))
		n.bg.gui_input.connect(func(e):
			if (e is InputEventMouseButton and e.pressed) and rows[i].key == "back":
				Sfx.play("back")
				if r_ref.r:
					r_ref.r.finish())
	render.call()
	await run_screen(UI.center(p.root), "dim", func(dt, r):
		r_ref.r = r
		var d := menu_nav(rows.size(), state, render)
		if d == "left" or d == "right":
			change.call(state.index, 1 if d == "right" else -1)
		if Inputs.join_pressed() != "":
			if rows[state.index].key == "back":
				Sfx.play("back")
				r.finish()
			else:
				change.call(state.index, 1)
		if Inputs.back_pressed() != "":
			Sfx.play("back")
			r.finish())


func _clamp01(v: float) -> float:
	return round(clampf(v, 0.0, 1.0) * 10.0) / 10.0


func _back_only_screen(p: Dictionary, wide: bool = false) -> void:
	var back := UI.tap_btn(t("BACK"), true)
	p.body.add_child(UI.hbox([back]))
	p.body.add_child(_hint(I18n.tp("{BACK} back")))
	var r_ref := {"r": null}
	back.pressed.connect(func():
		Sfx.play("back")
		if r_ref.r:
			r_ref.r.finish())
	await run_screen(UI.center(p.root), "dim", func(dt, r):
		r_ref.r = r
		if Inputs.back_pressed() != "" or Inputs.join_pressed() != "":
			Sfx.play("back")
			r.finish())


# ==================================================================== MANUAL

func manual_screen(registry: Array) -> void:
	var p := UI.panel({"width_frac": 0.82, "pad_y": 2.0})
	p.body.add_child(UI.label(t("FIELD MANUAL"), "ops", 5.4, UI.BONE))
	var left := UI.vbox([], 0.6, false)
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	left.add_child(UI.label(t("CONTROLS"), "ops", 2.8, UI.HAZARD, HORIZONTAL_ALIGNMENT_LEFT))
	var grid := GridContainer.new()
	grid.columns = 4
	grid.add_theme_constant_override("h_separation", UI.u(1.5))
	var rows := [["", t("MOVE"), t("ACTION") + " Ⓐ", t("SHOVE") + " Ⓑ"],
		[t("Keyboard (left)"), "W A S D", "F", "G"],
		[t("Keyboard (right)"), t("ARROWS"), "ENTER", "R-SHIFT"],
		[t("Gamepad"), t("L-STICK / D-PAD"), "Ⓐ / ✕", "Ⓑ / ◯"],
		[t("Touch screen"), t("JOYSTICK"), "Ⓐ", "Ⓑ"]]
	for ri in rows.size():
		for c in rows[ri]:
			grid.add_child(UI.label(c, "elite", 2.1, UI.BONE_DIM if ri == 0 else UI.BONE, HORIZONTAL_ALIGNMENT_LEFT))
	left.add_child(grid)
	left.add_child(UI.label(t("PROCEDURE"), "ops", 2.8, UI.HAZARD, HORIZONTAL_ALIGNMENT_LEFT))
	for para in ["Every simulation is short and lethal. Placement earns points: 3 / 2 / 1 / 0. The subject with the most points when the program ends is released. The rest are not.",
			"Empty seats are filled by facility units (bots). Read the second briefing page — it tells you how to win."]:
		var r := UI.rich(t(para), "elite", 2.2, UI.BONE, "left")
		r.custom_minimum_size.x = 480
		left.add_child(r)
	var right := UI.vbox([], 0.4, false)
	right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	right.add_child(UI.label(t("SIMULATIONS"), "ops", 2.8, UI.HAZARD, HORIZONTAL_ALIGNMENT_LEFT))
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(500, 330)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var sims := UI.vbox([], 0.2, false)
	var i := 1
	for G in registry:
		var r := UI.rich("%d. [b]%s[/b] — %s" % [i, t(G.META.title), t(G.META.tagline)], "elite", 1.95, UI.BONE_DIM, "left")
		r.custom_minimum_size.x = 480
		sims.add_child(r)
		i += 1
	scroll.add_child(sims)
	right.add_child(scroll)
	p.body.add_child(UI.hbox([left, right], 4.0, false))
	await _back_only_screen(p)


# ============================================================ ONLINE (host)

## HOST ONLINE: opens a room, shows its code and connected players. Returns "play" or null.
func online_screen() -> Variant:
	if Net.has_method("start_hosting"):
		Net.start_hosting()
	var p := UI.panel({"width_frac": 0.8})
	p.body.add_child(UI.label(t("HOST ONLINE"), "ops", 6.4, UI.BONE))
	var body := UI.vbox([], 1.0)
	p.body.add_child(body)
	var play := UI.tap_btn(t("CONTINUE TO INTAKE"), true)
	var back := UI.tap_btn(t("BACK"))
	p.body.add_child(UI.hbox([play, back]))
	p.body.add_child(_hint(I18n.tp("{A} continue to intake · {BACK} back (closes the room)")))
	var r_ref := {"r": null}
	var last := {"sig": ""}
	var render := func():
		var status: String = Net.host_status() if Net.has_method("host_status") else "error"
		var code: String = Net.room_code() if Net.has_method("room_code") else ""
		var n: int = Net.connected_count() if Net.has_method("connected_count") else 0
		var sig := "%s|%s|%d" % [status, code, n]
		if sig == last.sig:
			return
		last.sig = sig
		for c in body.get_children():
			c.queue_free()
		if status == "error":
			var err: String = Net.host_error() if Net.has_method("host_error") else "online play is not available in this build yet"
			body.add_child(UI.label(t("ONLINE UNAVAILABLE") + " — " + err, "elite", 2.4, UI.BLOOD))
			body.add_child(UI.label(t("Check your internet connection and try again."), "elite", 2.4, UI.BONE))
		elif status != "hosting":
			body.add_child(UI.label(t("Opening a room…"), "elite", 2.6, UI.BONE))
		else:
			body.add_child(UI.label(t("ROOM CODE"), "elite", 2.6, UI.BONE))
			body.add_child(UI.label(code, "ops", 12, UI.CRT))
			var r := UI.rich(t("Friends anywhere choose <b>JOIN ONLINE</b> and type this code (PC or phone)."), "vt", 3.0, UI.BONE)
			r.custom_minimum_size.x = 900
			body.add_child(r)
			body.add_child(UI.label(t("{n} REMOTE SUBJECT(S) CONNECTED — they join in the lobby with their action button", {"n": n}), "vt", 3.0, UI.HAZARD))
	play.pressed.connect(func():
		if Net.has_method("host_status") and Net.host_status() == "hosting" and r_ref.r:
			Sfx.play("select")
			r_ref.r.finish("play"))
	back.pressed.connect(func():
		Sfx.play("back")
		if r_ref.r:
			r_ref.r.finish(null))
	render.call()
	app.overlay.set_meta("online_code", true)   # the corner room-code badge stays hidden here
	var result = await run_screen(UI.center(p.root), "dim", func(dt, r):
		r_ref.r = r
		render.call()
		if Inputs.join_pressed() != "" and Net.has_method("host_status") and Net.host_status() == "hosting":
			Sfx.play("select")
			r.finish("play")
		elif Inputs.back_pressed() != "":
			Sfx.play("back")
			r.finish(null))
	app.overlay.remove_meta("online_code")
	return result


## JOIN ONLINE: type the host's room code; joining hands over to the online client.
func join_screen() -> void:
	if app.touch:
		app.touch.set_visible_controls(false)
	var p := UI.panel({"width_frac": 0.6})
	p.body.add_child(UI.label(t("JOIN ONLINE"), "ops", 6.4, UI.BONE))
	var info := UI.rich(t("Type the room code shown on your friend's screen (HOST ONLINE)."), "elite", 2.4, UI.BONE)
	info.custom_minimum_size.x = 650
	p.body.add_child(info)
	var input := LineEdit.new()
	input.max_length = 7
	input.placeholder_text = "K7QPXW"
	input.alignment = HORIZONTAL_ALIGNMENT_CENTER
	input.custom_minimum_size = Vector2(520, UI.u(11))
	input.add_theme_font_override("font", UI.font("ops"))
	input.add_theme_font_size_override("font_size", UI.u(8))
	input.add_theme_color_override("font_color", UI.CRT)
	input.add_theme_stylebox_override("normal", UI.flat_box(Color("#0c0b09"), UI.EDGE, UI.u(0.4), 1.0))
	input.add_theme_stylebox_override("focus", UI.flat_box(Color("#0c0b09"), UI.HAZARD, UI.u(0.4), 1.0))
	p.body.add_child(UI.hbox([input]))
	var err := UI.label("", "elite", 2.4, Color("#ff6a5a"))
	p.body.add_child(err)
	var join := UI.tap_btn(t("JOIN"), true, 4.0)
	var back := UI.tap_btn(t("BACK"), false, 4.0)
	p.body.add_child(UI.hbox([join, back]))
	p.body.add_child(UI.label(t("Room codes have 6 letters and digits, e.g. K7QPXW"), "vt", 2.6, UI.BONE_DIM))
	var r_ref := {"r": null}
	var try_join := func(_x = null):
		var code := _parse_code(input.text)
		if code == "":
			err.text = t("That code is not valid — it looks like K7QPXW.")
			Sfx.play("wrong")
			return
		Sfx.play("select")
		err.text = t("Connecting…")
		if r_ref.r:
			r_ref.r.finish(code)
	join.pressed.connect(try_join)
	input.text_submitted.connect(try_join)
	back.pressed.connect(func():
		Sfx.play("back")
		if r_ref.r:
			r_ref.r.finish(null))
	input.call_deferred("grab_focus")
	var code = await run_screen(UI.center(p.root), "dim", func(dt, r):
		r_ref.r = r
		if Inputs.key_pressed("Escape"):
			r.finish(null))
	if app.touch:
		app.touch.set_visible_controls(true)
	if code != null:
		await Net.run_client(app, str(code))


static func _parse_code(text: String) -> String:
	var alphabet := "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	var clean := ""
	for ch in text.to_upper():
		if ch in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789":
			clean += ch
	if clean.length() != 6:
		return ""
	for ch in clean:
		if alphabet.find(ch) < 0:
			return ""
	return clean


# ============================================================= COMMENDATIONS

func commendations_screen(registry: Array) -> void:
	var sm: Dictionary = Commendations.summary()
	var p := UI.panel({"width_frac": 0.8, "pad_y": 2.0})
	p.body.add_child(UI.label(t("COMMENDATIONS"), "ops", 5.4, UI.BONE))
	p.body.add_child(UI.label(t("{a} / {b} EARNED", {"a": sm.unlocked, "b": sm.total}), "elite", 2.4, UI.BONE_DIM))
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(900, 400)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var list := UI.vbox([], 0.6, false)
	for key in Commendations.DEFS:
		var d: Dictionary = Commendations.DEFS[key]
		var on: bool = Commendations.is_unlocked(key)
		var game_title := str(d.game)
		for G in registry:
			if G.META.id == d.game:
				game_title = t(G.META.title)
		var prog := ""
		if d.has("goal") and not on:
			prog = "  [i]%d/%d[/i]" % [min(int(d.goal), Commendations.count(key)), int(d.goal)]
		var medal := UI.label("★" if on else "☆", "ops", 4, UI.HAZARD if on else UI.BONE_DIM)
		var txt := UI.rich("[b]%s[/b]%s\n[color=#8f8a7a]%s · %s[/color]" % [t(d.title), prog, t(d.desc), game_title], "elite", 2.2, UI.BONE if on else UI.BONE_DIM, "left")
		txt.custom_minimum_size.x = 780
		list.add_child(UI.hbox([medal, txt], 1.5, false))
	scroll.add_child(list)
	p.body.add_child(scroll)
	await _back_only_screen(p)


func credits_screen() -> void:
	var p := UI.panel({"width_frac": 0.6})
	p.body.add_child(UI.label(t("CREDITS"), "ops", 6.4, UI.BONE))
	var txt := UI.rich("%s\n\n%s\n%s: Godot Engine 4.7 (MIT). %s: Blender.\n%s: Black Ops One, VT323 (SIL OFL), Special Elite (Apache 2.0).\n%s: Epic Online Services.\n\n%s" % [
		t("An original fan-made homage to the \"lethal party game\" genre."),
		t("Design, code, procedural art & synthesized audio: built from scratch for this project."),
		t("Engine"), t("Models"), t("Fonts"), t("Online play"),
		t("No subjects were harmed. Officially.")], "elite", 2.4, UI.BONE_DIM)
	txt.custom_minimum_size.x = 700
	p.body.add_child(txt)
	await _back_only_screen(p)


# ===================================================================== LOBBY

## Join + customize. Humans join with their A button; T / gamepad Y adds a bot,
## Y / gamepad X removes one. Returns the Player roster, or null on back.
func lobby_screen() -> Variant:
	app.backdrop.mode = "lobby"
	var roster: Array = app.players if not app.players.is_empty() else []
	for p in roster:
		p.ready = p.is_bot
	var cursor := {}     # player id -> field index
	var st := {"countdown": -1.0, "leave": false, "dirty": true}
	var refresh_backdrop := func():
		for i in Player.MAX_PLAYERS:
			var p = _player_in_slot(roster, i)
			app.backdrop.set_slot(i, p.look if p else null, i + 1)
			if p and p.ready:
				app.backdrop.set_pose(i, "armsUp")
	var free_slot := func() -> int:
		for i in Player.MAX_PLAYERS:
			if _player_in_slot(roster, i) == null:
				return i
		return -1
	var can_tap_join := func() -> bool:
		return app.touch != null and roster.filter(func(p): return p.device == "touch").is_empty()

	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var title := UI.shadow(UI.label(t("SUBJECT INTAKE"), "ops", 6, UI.BONE), 0.4)
	title.set_anchors_preset(Control.PRESET_CENTER_TOP)
	title.position = Vector2(-500, UI.u(3))
	title.size = Vector2(1000, UI.u(8))
	root.add_child(title)
	# Seat cards, status, buttons and hint stack up from the bottom edge and size
	# themselves (taller cards push the column up instead of overlapping).
	var bottom := VBoxContainer.new()
	bottom.add_theme_constant_override("separation", UI.u(0.8))
	bottom.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bottom.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	bottom.grow_vertical = Control.GROW_DIRECTION_BEGIN
	bottom.offset_left = 1280 * 0.04
	bottom.offset_right = -1280 * 0.04
	bottom.offset_bottom = -UI.u(1.5)
	root.add_child(bottom)
	var slots_box := HBoxContainer.new()
	slots_box.add_theme_constant_override("separation", UI.u(1.6))
	slots_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bottom.add_child(slots_box)
	var status := UI.rich("", "vt", 2.8, UI.HAZARD)
	bottom.add_child(status)
	var addbot := UI.tap_btn(t("+ BOT"), false, 2.6)
	var rembot := UI.tap_btn(t("− BOT"), false, 2.6)
	var backb := UI.tap_btn(t("BACK"), false, 2.6)
	bottom.add_child(UI.hbox([addbot, rembot, backb], 1.5))
	var hint := _hint(I18n.tp("JOIN {A} · CUSTOMIZE {MOVE} · LEAVE {B} · ADD BOT {ADDBOT} · REMOVE BOT {REMBOT} · BACK {BACK}"))
	hint.add_theme_font_size_override("normal_font_size", UI.u(2.3))
	bottom.add_child(hint)

	var add_bot := func():
		var slot: int = free_slot.call()
		if slot >= 0:
			roster.append(Player.new(slot, "bot"))
			Sfx.play("join")
		else:
			Sfx.play("wrong")
		st.dirty = true
	var remove_bot := func():
		var bots := roster.filter(func(p): return p.is_bot)
		if not bots.is_empty():
			roster.erase(bots[-1])
			Sfx.play("back")
		st.dirty = true
	addbot.pressed.connect(add_bot)
	rembot.pressed.connect(remove_bot)
	backb.pressed.connect(func(): st.leave = true)

	## Tap actions on the cards: join:slot, dec/inc:slot:field, ready:slot, leave:slot.
	var on_tap := func(action: String, device: String = ""):
		var parts := action.split(":")
		var kind := parts[0]
		var slot := int(parts[1]) if parts.size() > 1 else -1
		var p = _player_in_slot(roster, slot)
		var me = null
		if device != "":
			for q in roster:
				if q.device == device:
					me = q
			if kind != "join" and (me == null or me != p):
				return
		if kind == "join" and p == null:
			if device != "":
				if me != null:
					return
				var np := Player.new(slot, device)
				roster.append(np)
				cursor[np.id] = 0
				Sfx.play("join")
			elif can_tap_join.call():
				var np2 := Player.new(slot, "touch")
				roster.append(np2)
				cursor[np2.id] = 0
				Sfx.play("join")
		elif kind == "leave" and p:
			roster.erase(p)
			Sfx.play("back")
		elif kind == "ready" and p:
			p.ready = not p.ready
			cursor[p.id] = FIELDS.size() - 1
			Sfx.play("select" if p.ready else "back")
		elif (kind == "dec" or kind == "inc") and p and not p.ready:
			p.cycle(parts[2], 1 if kind == "inc" else -1)
			cursor[p.id] = FIELDS.find(parts[2])
			Sfx.play("click")
		st.dirty = true
	app.remote_tap = func(device: String, action: String): on_tap.call(action, device)

	var render := func():
		for c in slots_box.get_children():
			c.queue_free()
		for i in Player.MAX_PLAYERS:
			slots_box.add_child(_slot_card(roster, i, cursor, can_tap_join.call(), on_tap))
		var humans := roster.filter(func(p): return not p.is_bot)
		var text := ""
		if roster.size() < Player.MIN_PLAYERS:
			text = I18n.pick("NEED AT LEAST {n} SUBJECTS — TAP +BOT TO ADD A BOT", "NEED AT LEAST {n} SUBJECTS — PRESS {ADDBOT} TO ADD A BOT", {"n": Player.MIN_PLAYERS})
		elif humans.any(func(p): return not p.ready):
			text = t("WAITING FOR ALL SUBJECTS TO CONFIRM READY")
		elif st.countdown >= 0.0:
			text = t("PROCEEDING IN {n}", {"n": int(ceil(st.countdown))})
		UI.set_rich(status, text)
		refresh_backdrop.call()
	var result = await run_screen(root, "", func(dt, r):
		var joined := ""
		var j: String = Inputs.join_pressed(true)
		if j != "" and roster.filter(func(p): return p.device == j).is_empty():
			var slot: int = free_slot.call()
			if slot >= 0:
				var np := Player.new(slot, j)
				roster.append(np)
				cursor[np.id] = 0
				joined = j
				Sfx.play("join")
				st.dirty = true
		if Inputs.key_pressed("KeyT") or Inputs.any_pad_pressed(3):
			add_bot.call()
		if Inputs.key_pressed("KeyY") or Inputs.any_pad_pressed(2):
			remove_bot.call()
		for p in roster.filter(func(q): return str(q.device).begins_with("net") and not Net.is_connected_device(q.device)):
			roster.erase(p)
			st.dirty = true
		for p in roster.filter(func(q): return not q.is_bot):
			var c: Controller = Inputs.controller(p.device)
			var ci: int = cursor.get(p.id, 0)
			if c.dir_pressed == "down" or c.dir_pressed == "up":
				ci = (ci + (1 if c.dir_pressed == "down" else -1) + FIELDS.size()) % FIELDS.size()
				cursor[p.id] = ci
				Sfx.play("click")
				st.dirty = true
			var field: String = FIELDS[ci]
			if (c.dir_pressed == "left" or c.dir_pressed == "right") and field != "ready" and not p.ready:
				p.cycle(field, 1 if c.dir_pressed == "right" else -1)
				Sfx.play("click")
				st.dirty = true
			if c.a_pressed and joined != p.device:
				if field == "ready" or p.ready:
					p.ready = not p.ready
					Sfx.play("select" if p.ready else "back")
				else:
					cursor[p.id] = FIELDS.size() - 1
					Sfx.play("click")
				st.dirty = true
			if c.b_pressed:
				if p.ready:
					p.ready = false
				else:
					roster.erase(p)
					Sfx.play("back")
				st.dirty = true
		if Inputs.key_pressed("Escape") or st.leave:
			app.players = roster
			r.finish(null)
			return
		var all_ready: bool = roster.size() >= Player.MIN_PLAYERS and roster.all(func(p): return p.ready)
		if all_ready:
			if st.countdown < 0.0:
				st.countdown = 3.0
				st.dirty = true
			var before := int(ceil(st.countdown))
			st.countdown -= dt
			if int(ceil(st.countdown)) != before:
				Sfx.play("beep")
				st.dirty = true
			if st.countdown <= 0.0:
				Sfx.play("go")
				roster.sort_custom(func(a, b): return a.slot < b.slot)
				app.players = roster
				r.finish(roster)
				return
		elif st.countdown >= 0.0:
			st.countdown = -1.0
			st.dirty = true
		if st.dirty:
			st.dirty = false
			render.call())
	app.remote_tap = Callable()
	return result


func _player_in_slot(roster: Array, slot: int):
	for p in roster:
		if p.slot == slot:
			return p
	return null


func _slot_card(roster: Array, i: int, cursor: Dictionary, tap_join: bool, on_tap: Callable) -> Control:
	var p = _player_in_slot(roster, i)
	var card := PanelContainer.new()
	card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	card.custom_minimum_size = Vector2(0, UI.u(30))
	var pc := Color(p.color) if p else Color("#333333")
	var sb := UI.flat_box(UI.PANEL, UI.EDGE, max(1, UI.u(0.3)), 1.2)
	sb.border_width_top = UI.u(0.8)
	sb.border_color = pc
	if p and p.ready:
		sb.shadow_color = Color(pc.r, pc.g, pc.b, 0.6)
		sb.shadow_size = UI.u(2)
	card.add_theme_stylebox_override("panel", sb)
	var col := UI.vbox([], 0.3, false)
	card.add_child(col)
	if p == null:
		card.modulate.a = 0.75
		col.alignment = BoxContainer.ALIGNMENT_CENTER
		col.add_child(UI.label(t("SEAT {n}", {"n": i + 1}), "ops", 3, UI.BONE_DIM))
		var lbl := UI.rich(t("TAP HERE<br>TO VOLUNTEER") if tap_join else I18n.tp("PRESS {A}<br>TO VOLUNTEER"), "vt", 2.8, UI.BONE_DIM)
		col.add_child(lbl)
		card.mouse_filter = Control.MOUSE_FILTER_STOP
		card.set_meta("tap", "join:%d" % i)   # online clients tap the mirrored card (UiMirror)
		card.gui_input.connect(func(e):
			if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
				on_tap.call("join:%d" % i))
		return card
	var head := UI.hbox([], 1.0, false)
	var nm := UI.label(p.name(), "ops", 3, pc, HORIZONTAL_ALIGNMENT_LEFT)
	nm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var x := UI.tap_btn("✕", false, 2.2)
	x.pressed.connect(func(): on_tap.call("leave:%d" % i))
	x.set_meta("tap", "leave:%d" % i)
	head.add_child(nm)
	head.add_child(x)
	col.add_child(head)
	var dev := ""
	if p.is_bot:
		dev = t(Controller.LABELS.bot.name)
	elif str(p.device).begins_with("pad"):
		dev = t("Gamepad {n}", {"n": int(str(p.device).substr(3)) + 1})
	elif str(p.device).begins_with("net"):
		dev = t("Online player {n}", {"n": str(p.device).substr(3)})
	else:
		dev = t(Controller.LABELS.get(p.device, Controller.LABELS.bot).name)
	col.add_child(UI.label(dev, "vt", 2.2, UI.BONE_DIM, HORIZONTAL_ALIGNMENT_LEFT))
	if p.is_bot:
		col.add_child(UI.label(t("FACILITY UNIT") + "\n" + t("auto-assigned"), "vt", 2.4, UI.BONE_DIM))
		return card
	var ci: int = cursor.get(p.id, 0)
	for fi in FIELDS.size():
		var f: String = FIELDS[fi]
		var row := PanelContainer.new()
		var sel := fi == ci
		row.add_theme_stylebox_override("panel", UI.flat_box(Color(1, 1, 1, 0.08) if sel else Color(0, 0, 0, 0), pc if sel else Color(0, 0, 0, 0), 1 if sel else 0, 0.4))
		var h := UI.hbox([], 0.4, false)
		row.add_child(h)
		var lab := UI.label(t(FIELD_LABEL[f]), "elite", 2.0, UI.BONE if sel else UI.BONE_DIM, HORIZONTAL_ALIGNMENT_LEFT)
		lab.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		h.add_child(lab)
		if f == "ready":
			var rb := UI.tap_btn(("✔ " + t("READY")) if p.ready else (t("TAP") if p.device == "touch" else I18n.key_text("A")), p.ready, 2.2)
			rb.pressed.connect(func(): on_tap.call("ready:%d" % i))
			rb.set_meta("tap", "ready:%d" % i)
			h.add_child(rb)
		else:
			var dec := UI.tap_btn("◂", false, 2.0)
			var inc := UI.tap_btn("▸", false, 2.0)
			dec.pressed.connect(func(): on_tap.call("dec:%d:%s" % [i, f]))
			inc.pressed.connect(func(): on_tap.call("inc:%d:%s" % [i, f]))
			dec.set_meta("tap", "dec:%d:%s" % [i, f])
			inc.set_meta("tap", "inc:%d:%s" % [i, f])
			var v := UI.label(p.look_label(f), "vt", 2.4, UI.BONE)
			v.custom_minimum_size.x = UI.u(13)
			v.clip_text = true
			h.add_child(dec)
			h.add_child(v)
			h.add_child(inc)
		col.add_child(row)
	return card


# =============================================================== MODE SELECT

func mode_screen(registry_count: int = 30) -> Variant:
	var items := [
		{"id": "original", "label": t("FULL PROGRAM"), "desc": t("{n} random simulations out of {total}, with orientation and final judgement.", {"n": 15, "total": registry_count})},
		{"id": "arcade", "label": t("QUICK SHIFT"), "desc": t("10 random simulations. No orientation, no ceremony.")},
		{"id": "custom", "label": t("CUSTOM PLAYLIST"), "desc": t("Pick exactly which simulations to run, in random order.")},
	]
	var state := {"index": 0}
	var p := UI.panel({"width_frac": 0.82})
	p.body.add_child(UI.label(t("SELECT PROGRAM"), "ops", 6.4, UI.BONE))
	var cards := UI.hbox([], 2.0)
	p.body.add_child(cards)
	var nodes := []
	var r_ref := {"r": null}
	for i in items.size():
		var c := PanelContainer.new()
		c.custom_minimum_size = Vector2(300, UI.u(22))
		c.mouse_filter = Control.MOUSE_FILTER_STOP
		var v := UI.vbox([UI.label(items[i].label, "ops", 3.6, UI.BONE), UI.rich(items[i].desc, "elite", 2.2, UI.BONE_DIM)], 1.0)
		v.get_child(1).custom_minimum_size.x = 270
		c.add_child(v)
		cards.add_child(c)
		nodes.append(c)
		c.gui_input.connect(func(e):
			if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT and r_ref.r:
				state.index = i
				Sfx.play("select")
				r_ref.r.finish(items[i].id))
	var back := UI.tap_btn(t("BACK"))
	back.pressed.connect(func():
		Sfx.play("back")
		if r_ref.r:
			r_ref.r.finish(null))
	p.body.add_child(UI.hbox([back]))
	p.body.add_child(_hint(I18n.tp("{MOVE} choose · {A} confirm · {BACK} back")))
	var paint := func():
		for i in nodes.size():
			var sel: bool = i == state.index
			nodes[i].add_theme_stylebox_override("panel", UI.flat_box(Color(0.61, 0.11, 0.11, 0.3) if sel else Color("#16140f"), UI.BLOOD if sel else UI.EDGE, UI.u(0.4), 1.5))
	paint.call()
	return await run_screen(UI.center(p.root), "dim", func(dt, r):
		r_ref.r = r
		var d: String = Inputs.menu_dir()
		if d != "":
			state.index = (state.index + (1 if d == "right" or d == "down" else -1) + items.size()) % items.size()
			Sfx.play("click")
			paint.call()
		if Inputs.join_pressed() != "":
			Sfx.play("select")
			r.finish(items[state.index].id)
		elif Inputs.back_pressed() != "":
			Sfx.play("back")
			r.finish(null))


## Toggle grid of simulations. Returns {ids} or null.
func custom_screen(registry: Array) -> Variant:
	var sel := {}
	var initial: Array = app.last_custom if app.last_custom != null else registry.map(func(G): return G.META.id)
	for id in initial:
		sel[id] = true
	var state := {"index": 0}
	var cols := 5
	var total := registry.size() + 1
	var p := UI.panel({"width_frac": 0.86, "pad_y": 2.0})
	p.body.add_child(UI.label(t("CUSTOM PLAYLIST"), "ops", 5, UI.BONE))
	var grid := GridContainer.new()
	grid.columns = cols
	grid.add_theme_constant_override("h_separation", UI.u(0.8))
	grid.add_theme_constant_override("v_separation", UI.u(0.8))
	p.body.add_child(grid)
	var start := UI.tap_btn("", true)
	var back := UI.tap_btn(t("BACK"))
	p.body.add_child(UI.hbox([start, back]))
	p.body.add_child(_hint(I18n.tp("{MOVE} move · {A} toggle · {BACK} back")))
	var cards := []
	var r_ref := {"r": null}
	for i in registry.size():
		var G = registry[i]
		var c := PanelContainer.new()
		c.custom_minimum_size = Vector2(205, UI.u(7.4))
		c.mouse_filter = Control.MOUSE_FILTER_STOP
		var v := UI.vbox([UI.label("%02d  %s" % [i + 1, t(G.META.title)], "ops", 1.9, UI.BONE, HORIZONTAL_ALIGNMENT_LEFT), UI.label(t(G.META.category), "vt", 1.9, UI.BONE_DIM, HORIZONTAL_ALIGNMENT_LEFT)], 0.1, false)
		v.get_child(0).clip_text = true
		c.add_child(v)
		grid.add_child(c)
		cards.append(c)
	var render := func():
		for i in cards.size():
			var on: bool = sel.has(registry[i].META.id)
			var cur: bool = i == state.index
			cards[i].add_theme_stylebox_override("panel", UI.flat_box(Color(0.12, 0.3, 0.14, 0.5) if on else Color("#16140f"), UI.HAZARD if cur else (UI.CRT if on else UI.EDGE), UI.u(0.35) if cur else 1, 0.6))
			cards[i].modulate.a = 1.0 if on else 0.6
		start.text = "%s (%d)" % [t("START"), sel.size()]
		start.modulate = Color(1, 1, 1, 1.0 if sel.size() > 0 else 0.4)
		start.add_theme_color_override("font_color", UI.HAZARD if state.index == registry.size() else UI.BONE)
	var activate := func(i: int):
		if i < registry.size():
			var id: String = registry[i].META.id
			if sel.has(id):
				sel.erase(id)
			else:
				sel[id] = true
			Sfx.play("click")
			render.call()
			return null
		if sel.size() > 0:
			Sfx.play("select")
			app.last_custom = sel.keys()
			return {"ids": registry.map(func(G): return G.META.id).filter(func(id): return sel.has(id))}
		return null
	for i in cards.size():
		cards[i].gui_input.connect(func(e):
			if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
				state.index = i
				activate.call(i))
	start.pressed.connect(func():
		var res = activate.call(registry.size())
		if res != null and r_ref.r:
			r_ref.r.finish(res))
	back.pressed.connect(func():
		Sfx.play("back")
		if r_ref.r:
			r_ref.r.finish(null))
	render.call()
	return await run_screen(UI.center(p.root), "dim", func(dt, r):
		r_ref.r = r
		var d: String = Inputs.menu_dir()
		if d != "":
			var i: int = state.index
			if i < registry.size():
				if d == "left": i = max(0, i - 1)
				if d == "right": i = min(total - 1, i + 1)
				if d == "up": i = max(0, i - cols)
				if d == "down": i = i + cols if i + cols < registry.size() else registry.size()
			else:
				if d == "left": i -= 1
				if d == "up": i = registry.size() - 1
			state.index = clampi(i, 0, total - 1)
			Sfx.play("click")
			render.call()
		if Inputs.join_pressed() != "":
			var res = activate.call(state.index)
			if res != null:
				r.finish(res)
				return
		if Inputs.back_pressed() != "":
			Sfx.play("back")
			r.finish(null))


# =============================================================== ORIENTATION

## Typewriter monologue from the facility. A press skips ahead / continues.
func monologue(lines_in: Array, title: String = "ORIENTATION") -> void:
	var lines := lines_in.map(func(l): return t(l))
	var box := UI.vbox([], 1.5)
	box.custom_minimum_size.x = 1280 * 0.7
	var head := UI.label(t(title), "vt", 3, UI.CRT)
	head.modulate.a = 0.6
	var text := UI.label("", "vt", 5, UI.CRT, HORIZONTAL_ALIGNMENT_LEFT)
	text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	text.custom_minimum_size = Vector2(1280 * 0.7, UI.u(20))
	var skip := UI.tap_btn(t("SKIP"))
	box.add_child(head)
	box.add_child(text)
	box.add_child(UI.hbox([skip]))
	box.add_child(_hint(I18n.pick("Tap to continue", "{A} continue · {BACK} skip")))
	var st := {"line": 0, "chars": 0, "acc": 0.0, "hold": 0.0, "tapped": false, "skip": false}
	skip.pressed.connect(func(): st.skip = true)
	var unattended: bool = not app.players.is_empty() and app.players.all(func(p): return p.is_bot)
	await run_screen(UI.center(box), "dim", func(dt, r):
		if st.skip:
			r.finish()
			return
		var line: String = lines[st.line]
		st.acc += dt
		while st.acc > 0.028 and st.chars < line.length():
			st.acc -= 0.028
			st.chars += 1
			if line[st.chars - 1] != " ":
				Sfx.play("tick", {"vol": 0.6})
		text.text = line.substr(0, st.chars) + ("█" if int(Time.get_ticks_msec() / 400) % 2 == 0 else " ")
		if Inputs.back_pressed() != "":
			r.finish()
			return
		st.hold = st.hold + dt if st.chars >= line.length() else 0.0
		var auto_next: bool = unattended and st.hold > 1.8
		if Inputs.join_pressed() != "" or auto_next or st.tapped:
			st.hold = 0.0
			st.tapped = false
			if st.chars < line.length():
				st.chars = line.length()
			else:
				st.line += 1
				if st.line >= lines.size():
					r.finish()
				else:
					st.chars = 0
					Sfx.play("click"), func(_r): st.tapped = true)


# ============================================================= ROUND SCREENS

## NEXT-SIMULATION ROULETTE: a reel of cards spins and stops on the chosen one.
func roulette(G, index: int, total: int, registry: Array) -> void:
	var card_w := UI.u(30)
	var spin_s := 3.0
	var others := registry.filter(func(R): return R != G)
	var strip := []
	for i in 26:
		strip.append(others[randi() % others.size()] if not others.is_empty() else G)
	strip.append(G)
	for i in 3:
		strip.append(others[randi() % others.size()] if not others.is_empty() else G)
	var target := 26
	var root := UI.vbox([], 1.0)
	root.custom_minimum_size.x = 1280
	root.add_child(UI.label(t("SIMULATION {a} / {b}", {"a": "%02d" % (index + 1), "b": "%02d" % total}), "vt", 3, UI.BONE_DIM))
	root.add_child(UI.label(t("SELECTING NEXT SIMULATION"), "ops", 5, UI.BONE))
	var window := Panel.new()
	window.custom_minimum_size = Vector2(1280, UI.u(22))
	window.clip_contents = true
	window.add_theme_stylebox_override("panel", UI.flat_box(Color("#0c0b09")))
	var reel := Control.new()
	reel.position = Vector2(640 - card_w / 2.0, UI.u(2))
	window.add_child(reel)
	var target_card: PanelContainer = null
	for i in strip.size():
		var R = strip[i]
		var c := PanelContainer.new()
		c.position = Vector2(i * card_w + UI.u(1), 0)
		c.size = Vector2(UI.u(28), UI.u(18))
		c.add_theme_stylebox_override("panel", UI.flat_box(Color("#16140f"), UI.EDGE, UI.u(0.4), 1.5))
		var v := UI.vbox([UI.label(t(R.META.category).to_upper(), "vt", 2.4, UI.HAZARD), UI.label(t(R.META.title), "ops", 3.0, UI.BONE)], 0.8)
		v.get_child(1).autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		v.get_child(1).custom_minimum_size.x = UI.u(25)
		c.add_child(v)
		reel.add_child(c)
		if i == target:
			target_card = c
	var marker := ColorRect.new()
	marker.color = UI.BLOOD
	marker.position = Vector2(640 - UI.u(0.25), 0)
	marker.size = Vector2(UI.u(0.5), UI.u(22))
	window.add_child(marker)
	var frame := UI.vbox([UI.hazard_strip(0.8), window, UI.hazard_strip(0.8)], 0)
	root.add_child(frame)
	var chosen := UI.label(t("SELECTED"), "ops", 5, UI.BLOOD)
	chosen.modulate.a = 0.0
	root.add_child(chosen)
	var st := {"time": 0.0, "last": -1, "landed": false}
	await run_screen(UI.center(root), "card", func(dt, r):
		st.time += min(dt, 0.1)
		var k := U.ease_out_cubic(st.time / spin_s)
		var pos := k * target
		reel.position.x = 640 - card_w / 2.0 - pos * card_w
		var passing := roundi(pos)
		if passing != st.last:
			st.last = passing
			if not st.landed:
				Sfx.play("tick")
		if not st.landed and st.time >= spin_s:
			st.landed = true
			target_card.add_theme_stylebox_override("panel", UI.flat_box(Color("#2a0d0b"), UI.BLOOD, UI.u(0.4), 1.5))
			Sfx.play("clank")
			Sfx.play("sting")
			app.shake(0.4)
		if st.landed:
			var s := U.ease_out_back((st.time - spin_s) / 0.35)
			chosen.pivot_offset = chosen.size / 2
			chosen.scale = Vector2.ONE * (2.2 - 1.2 * s)
			chosen.modulate.a = min(1.0, (st.time - spin_s) / 0.15)
		if st.time >= spin_s + 1.3:
			r.finish())


## Big stencilled title card for a simulation.
func title_card(G, index: int, total: int) -> void:
	Sfx.play("sting")
	var title := UI.label(t(G.META.title), "ops", 13, UI.BONE)
	title.add_theme_color_override("font_shadow_color", UI.BLOOD)
	title.add_theme_constant_override("shadow_offset_x", UI.u(0.5))
	title.add_theme_constant_override("shadow_offset_y", UI.u(0.5))
	title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	title.custom_minimum_size.x = 1200
	var box := UI.vbox([UI.label(t("SIMULATION {a} / {b}", {"a": "%02d" % (index + 1), "b": "%02d" % total}), "vt", 3, UI.BONE_DIM),
		title, UI.label(t(G.META.tagline), "elite", 2.8, UI.BONE_DIM)], 1.0)
	box.pivot_offset = Vector2(640, 200)
	box.scale = Vector2(1.6, 1.6)
	app.set_overlay(UI.center(box), "card")
	var tw := box.create_tween()
	tw.tween_property(box, "scale", Vector2.ONE, 0.35).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	await app.get_tree().create_timer(2.3).timeout


## Two-page briefing (controls, then objective) with per-player ready-up.
func briefing(G, seats: Array) -> void:
	var st := {"page": 0, "dirty": true}
	var ready := {}
	for s in seats:
		if s.is_bot:
			ready[s.player.id] = true
	var humans := seats.filter(func(s): return not s.is_bot)
	var m: Dictionary = G.META
	var root := PanelContainer.new()
	root.custom_minimum_size.x = 1280 * 0.7
	root.add_theme_stylebox_override("panel", UI.flat_box(UI.PANEL, UI.EDGE, max(1, UI.u(0.3))))
	var col := UI.vbox([], 0)
	root.add_child(col)
	var head := PanelContainer.new()
	var hsb := UI.flat_box(Color("#16140f"))
	hsb.border_width_bottom = UI.u(0.6)
	hsb.border_color = UI.BLOOD
	hsb.content_margin_left = UI.u(3)
	hsb.content_margin_right = UI.u(3)
	hsb.content_margin_top = UI.u(1.5)
	hsb.content_margin_bottom = UI.u(1.5)
	head.add_theme_stylebox_override("panel", hsb)
	var cat := UI.label(t(m.category).to_upper(), "vt", 2.8, UI.HAZARD, HORIZONTAL_ALIGNMENT_LEFT)
	var tl := UI.label(t(m.title), "ops", 5, UI.BONE)
	tl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var pg := UI.label("", "vt", 2.8, UI.BONE_DIM, HORIZONTAL_ALIGNMENT_RIGHT)
	head.add_child(UI.hbox([cat, tl, pg], 2.0, false))
	col.add_child(head)
	var body_m := MarginContainer.new()
	for side in ["left", "right"]:
		body_m.add_theme_constant_override("margin_" + side, UI.u(5))
	for side in ["top", "bottom"]:
		body_m.add_theme_constant_override("margin_" + side, UI.u(2.5))
	body_m.custom_minimum_size.y = UI.u(28)
	var body := UI.vbox([], 1.0, false)
	body_m.add_child(body)
	col.add_child(body_m)
	var foot := UI.vbox([], 0.8)
	var foot_m := MarginContainer.new()
	foot_m.add_theme_constant_override("margin_bottom", UI.u(2))
	foot_m.add_child(foot)
	col.add_child(foot_m)
	var tap_seats := func() -> Array:
		var touch := humans.filter(func(s): return s.player.device == "touch")
		return touch if not touch.is_empty() else humans.filter(func(s): return not str(s.player.device).begins_with("net"))
	var render := func():
		pg.text = t("PAGE {a}/{b}", {"a": st.page + 1, "b": 2})
		for c in body.get_children():
			c.queue_free()
		for c in foot.get_children():
			c.queue_free()
		if st.page == 0:
			body.add_child(UI.label(t("CONTROLS"), "ops", 3, UI.HAZARD, HORIZONTAL_ALIGNMENT_LEFT))
			var grid := GridContainer.new()
			grid.columns = 3
			grid.add_theme_constant_override("h_separation", UI.u(3))
			grid.add_theme_constant_override("v_separation", UI.u(1))
			for c in m.controls:
				var icon := {"move": t("MOVE"), "a": "Ⓐ", "b": "Ⓑ"}.get(c.input, str(c.input)) as String
				var keys := {"move": I18n.key_text("MOVE"), "a": I18n.key_text("A"), "b": I18n.key_text("B")}.get(c.input, "") as String
				var l1 := UI.label(icon, "ops", 3, UI.BONE, HORIZONTAL_ALIGNMENT_LEFT)
				var l2 := UI.label(t(c.label), "elite", 3, UI.BONE, HORIZONTAL_ALIGNMENT_LEFT)
				l2.size_flags_horizontal = Control.SIZE_EXPAND_FILL
				l2.custom_minimum_size.x = 420
				var l3 := UI.label(keys, "vt", 2.6, UI.BONE_DIM, HORIZONTAL_ALIGNMENT_RIGHT)
				for l in [l1, l2, l3]:
					grid.add_child(l)
			body.add_child(grid)
			var next := UI.tap_btn(t("NEXT PAGE"), true)
			next.pressed.connect(func():
				st.page = 1
				Sfx.play("select")
				st.dirty = true)
			foot.add_child(UI.hbox([next]))
			foot.add_child(_hint(I18n.tp("{A} NEXT PAGE")))
		else:
			body.add_child(UI.label(t("OBJECTIVE"), "ops", 3, UI.HAZARD, HORIZONTAL_ALIGNMENT_LEFT))
			var obj := UI.rich(I18n.fmt(t(m.objective)), "elite", 3.2, UI.BONE, "left")
			obj.custom_minimum_size.x = 780
			body.add_child(obj)
			for rule in m.get("rules", []):
				var rl := UI.rich("• " + I18n.fmt(t(rule)), "elite", 2.4, UI.BONE_DIM, "left")
				rl.custom_minimum_size.x = 780
				body.add_child(rl)
			var chips := UI.hbox([], 1.0)
			for s in seats:
				var ok: bool = ready.has(s.player.id)
				var chip := PanelContainer.new()
				var pc := Color(s.player.color)
				chip.add_theme_stylebox_override("panel", UI.flat_box(pc if ok else Color(0, 0, 0, 0), pc, max(1, UI.u(0.25)), 0.4))
				chip.add_child(UI.label(s.player.name() + (" ✔" if ok else ""), "vt", 2.6, Color.BLACK if ok else UI.BONE_DIM))
				chips.add_child(chip)
			foot.add_child(chips)
			var prev := UI.tap_btn(t("PREVIOUS"))
			var rd := UI.tap_btn(t("I'M READY"), true)
			prev.pressed.connect(func():
				st.page = 0
				Sfx.play("back")
				st.dirty = true)
			rd.pressed.connect(func():
				for s in tap_seats.call():
					ready[s.player.id] = true
				Sfx.play("beep")
				st.dirty = true)
			foot.add_child(UI.hbox([prev, rd]))
			foot.add_child(_hint(I18n.tp("EVERY SUBJECT PRESS {A} WHEN READY · {B} PREVIOUS PAGE")))
	await run_screen(UI.center(root), "dim", func(dt, r):
		for s in humans:
			if str(s.player.device).begins_with("net") and not Net.is_live(s.player.device) and not ready.has(s.player.id):
				ready[s.player.id] = true
				st.dirty = true
			var c: Controller = s.ctrl
			if c.a_pressed:
				if st.page == 0:
					st.page = 1
					Sfx.play("select")
					st.dirty = true
					break
				if not ready.has(s.player.id):
					ready[s.player.id] = true
					Sfx.play("beep")
					st.dirty = true
			if c.b_pressed and st.page == 1:
				if ready.has(s.player.id):
					ready.erase(s.player.id)
				else:
					st.page = 0
				Sfx.play("back")
				st.dirty = true
		if humans.is_empty() and st.page == 0:
			st.page = 1
			st.dirty = true
		if st.dirty:
			st.dirty = false
			render.call()
		if st.page == 1 and ready.size() == seats.size():
			if not st.has("done_at"):
				st["done_at"] = 0.3 if not humans.is_empty() else 0.9
			st.done_at -= dt
			if st.done_at <= 0.0:
				r.finish())


## 3-2-1-GO overlay.
func countdown() -> void:
	for n in ["3", "2", "1"]:
		var l := UI.label(n, "ops", 26, UI.BONE)
		l.add_theme_color_override("font_shadow_color", Color.BLACK)
		l.add_theme_constant_override("shadow_offset_x", UI.u(0.8))
		l.add_theme_constant_override("shadow_offset_y", UI.u(0.8))
		app.set_overlay(UI.center(l), "clear")
		_slam(l)
		Sfx.play("beep")
		await app.get_tree().create_timer(0.65).timeout
	var go := UI.label(t("GO"), "ops", 26, UI.BLOOD)
	app.set_overlay(UI.center(go), "clear")
	_slam(go)
	Sfx.play("go")
	app.get_tree().create_timer(0.6).timeout.connect(func():
		if is_instance_valid(go) and go.is_inside_tree():
			app.clear_overlay())


func _slam(l: Control) -> void:
	await app.get_tree().process_frame
	if not is_instance_valid(l):
		return
	l.pivot_offset = l.size / 2
	l.scale = Vector2(1.8, 1.8)
	l.create_tween().tween_property(l, "scale", Vector2.ONE, 0.3).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)


## After every round: points handed out one subject at a time (last place
## first), counted onto the standings bars, rows re-sort, the leader is crowned.
func points_screen(players: Array, results, opts: Dictionary = {}) -> void:
	var row_h := UI.u(9)
	var by_player := {}
	for r in (results if results else []):
		by_player[r.player.id] = r
	var gained := func(p) -> int: return int(by_player[p.id].points) if by_player.has(p.id) else 0
	var prev_score := func(p) -> int: return int(p.score) - gained.call(p)
	var before := players.duplicate()
	before.sort_custom(func(a, b):
		var pa: int = prev_score.call(a)
		var pb: int = prev_score.call(b)
		return pa > pb if pa != pb else a.slot < b.slot)
	var after := before.duplicate()
	after.sort_custom(func(a, b): return a.score > b.score if a.score != b.score else before.find(a) < before.find(b))
	var max_score := 1
	for p in players:
		max_score = max(max_score, int(p.score))
	var awards: Array = (results if results else []).duplicate()
	awards.sort_custom(func(a, b): return a.place > b.place)
	var step := 0.8
	var t_award := 0.6
	var t_sort: float = t_award + awards.size() * step + 0.3
	var t_done: float = t_sort + 0.8

	var p := UI.panel({"width_frac": 0.62})
	p.body.add_child(UI.label(t("SIMULATION REPORT"), "ops", 6.4, UI.BONE))
	var game = opts.get("game")
	if game:
		p.body.add_child(UI.label(t(game.META.title), "elite", 2.4, UI.BONE_DIM))
	if opts.has("round_index"):
		p.body.add_child(UI.label(t("{a} OF {b} SIMULATIONS COMPLETE", {"a": int(opts.round_index) + 1, "b": int(opts.total)}), "vt", 2.8, UI.BONE_DIM))
	var board := Control.new()
	board.custom_minimum_size = Vector2(1280 * 0.62 - UI.u(12), players.size() * row_h)
	p.body.add_child(board)
	var hint := _hint(I18n.pick("Tap to continue", "{A} continue"))
	hint.modulate.a = 0.0
	p.body.add_child(hint)
	var rows := {}
	for i in before.size():
		var pl = before[i]
		var pc := Color(pl.color)
		var row := PanelContainer.new()
		row.add_theme_stylebox_override("panel", UI.flat_box(Color(22 / 255.0, 20 / 255.0, 15 / 255.0, 0.95), Color(0, 0, 0, 0), 0, 0.0))
		row.position = Vector2(0, i * row_h)
		row.size = Vector2(board.custom_minimum_size.x, UI.u(7.6))
		var rank := UI.label(str(i + 1), "ops", 3.6, UI.BONE_DIM)
		rank.custom_minimum_size.x = UI.u(4)
		var nm := UI.label(pl.name(), "ops", 3, pc, HORIZONTAL_ALIGNMENT_LEFT)
		nm.custom_minimum_size.x = UI.u(20)
		var r = by_player.get(pl.id)
		var place := UI.label(("× " if r and r.died else "") + (I18n.ordinal(int(r.place)) if r else ""), "vt", 2.8, UI.BLOOD if r and r.died else UI.CRT)
		place.custom_minimum_size.x = UI.u(9)
		place.modulate.a = 0.0
		var bar := ProgressBar.new()
		bar.show_percentage = false
		bar.max_value = max_score
		bar.value = prev_score.call(pl)
		bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		bar.custom_minimum_size.y = UI.u(2.2)
		bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		bar.add_theme_stylebox_override("background", UI.flat_box(Color("#0c0b09"), UI.EDGE, 1))
		bar.add_theme_stylebox_override("fill", UI.flat_box(pc))
		var sc := UI.label(str(prev_score.call(pl)), "ops", 3.6, UI.HAZARD, HORIZONTAL_ALIGNMENT_RIGHT)
		sc.custom_minimum_size.x = UI.u(6)
		var gain := UI.label("+%d" % gained.call(pl), "ops", 4.2, UI.CRT)
		gain.custom_minimum_size.x = UI.u(7)
		gain.modulate.a = 0.0
		var crown := UI.label("", "ops", 4, UI.HAZARD)
		crown.custom_minimum_size.x = UI.u(4)
		row.add_child(UI.hbox([crown, rank, nm, place, bar, sc, gain], 1.5, false))
		row.modulate.a = 0.0
		board.add_child(row)
		rows[pl.id] = {"row": row, "rank": rank, "place": place, "bar": bar, "sc": sc, "gain": gain, "crown": crown}
	var st := {"time": 0.0, "step": -1, "crowned": false, "sorted": false, "skipped": false}
	var sfx := func(n: String):
		if not st.skipped:
			Sfx.play(n)
	await run_screen(UI.center(p.root), "dim", func(dt, run):
		st.time += min(dt, 0.1)
		for i in before.size():
			var k := U.ease_out_cubic((st.time - i * 0.08) / 0.45)
			var e: Dictionary = rows[before[i].id]
			e.row.modulate.a = k
			e.row.size.x = board.size.x   # rows span the whole panel
			if not st.sorted:
				e.row.position.x = (1.0 - k) * UI.u(12)
		for i in awards.size():
			var r = awards[i]
			var e: Dictionary = rows[r.player.id]
			var local: float = st.time - (t_award + i * step)
			if local < 0.0:
				e.gain.modulate.a = 0.0
				continue
			if i > st.step:
				st.step = i
				sfx.call("back" if r.points == 0 else ("select" if r.place == 1 else "click"))
				e.place.modulate.a = 1.0
			var pop := U.ease_out_back(local / 0.25)
			var fly := U.ease_out_cubic((local - 0.3) / 0.4)
			e.gain.modulate.a = 1.0 if local < 0.3 else 1.0 - fly
			e.gain.scale = Vector2.ONE * (0.4 + 0.6 * pop)
			var shown := roundi(prev_score.call(r.player) + r.points * U.ease_out_cubic((local - 0.25) / 0.45))
			if e.sc.text != str(shown):
				e.sc.text = str(shown)
				if r.points:
					sfx.call("tick")
			e.bar.value = shown
		if st.time >= t_sort:
			st.sorted = true
			var k := U.ease_out_cubic((st.time - t_sort) / 0.6)
			for i in before.size():
				var pl = before[i]
				var j := after.find(pl)
				var e: Dictionary = rows[pl.id]
				e.row.position.y = (i + (j - i) * k) * row_h
				e.rank.text = str((j if k > 0.5 else i) + 1)
				e.sc.text = str(pl.score)
				e.bar.value = pl.score
		if st.time >= t_sort + 0.6 and not st.crowned:
			st.crowned = true
			var top: int = after[0].score
			if top > 0:
				for pl in after.filter(func(q): return q.score == top):
					rows[pl.id].crown.text = "♛"
			sfx.call("ding")
		hint.modulate.a = 1.0 if st.time >= t_done else 0.0
		if Inputs.join_pressed() != "":
			if st.time < t_done:
				st.skipped = true
				st.time = max(st.time, t_done)
			else:
				Sfx.play("click")
				run.finish()
				return
		if st.time > t_done + 6.0:
			run.finish(), func(run):
			if st.time < t_done:
				st.skipped = true
				st.time = max(st.time, t_done)
			else:
				Sfx.play("click")
				run.finish())


## Cumulative standings with bars.
func standings(players: Array, title: String = "STANDINGS") -> void:
	var max_s := 1
	for p in players:
		max_s = max(max_s, int(p.score))
	var sorted := players.duplicate()
	sorted.sort_custom(func(a, b): return a.score > b.score)
	var p := UI.panel({"width_frac": 0.55})
	p.body.add_child(UI.label(t(title), "ops", 6.4, UI.BONE))
	for i in sorted.size():
		var pl = sorted[i]
		var bar := ProgressBar.new()
		bar.show_percentage = false
		bar.max_value = max_s
		bar.value = pl.score
		bar.custom_minimum_size = Vector2(300, UI.u(2.2))
		bar.add_theme_stylebox_override("background", UI.flat_box(Color("#0c0b09"), UI.EDGE, 1))
		bar.add_theme_stylebox_override("fill", UI.flat_box(Color(pl.color)))
		p.body.add_child(UI.hbox([UI.label(str(i + 1), "ops", 3.6, UI.BONE_DIM), UI.label(pl.name(), "ops", 3, Color(pl.color)), bar, UI.label(str(pl.score), "ops", 3.6, UI.HAZARD)], 1.5))
	p.body.add_child(_hint(I18n.pick("Tap to continue", "{A} continue")))
	var st := {"t": 0.0}
	await run_screen(UI.center(p.root), "dim", func(dt, r):
		st.t += dt
		if st.t > 0.8 and (Inputs.join_pressed() != "" or st.t > 6.0):
			Sfx.play("click")
			r.finish(), func(r):
			if st.t > 0.8:
				Sfx.play("click")
				r.finish())


## End of program — the winner ceremony on the intake pedestals.
func final_screen(players: Array, ceremony: bool = true) -> void:
	var sorted := players.duplicate()
	sorted.sort_custom(func(a, b): return a.score > b.score)
	var top: int = sorted[0].score
	var winners := sorted.filter(func(p): return p.score == top)
	var names := " & ".join(winners.map(func(w): return w.name()))
	var verdict := t("{names} — TIE. THE FACILITY WILL DECIDE LATER.", {"names": names}) if winners.size() > 1 else t("{name} HAS PROVEN THEIR WORTH.", {"name": winners[0].name()})
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var drum := UI.shadow(UI.label(t("AND THE SURVIVING SUBJECT IS…"), "vt", 4.4, UI.BONE), 0.3)
	drum.position = Vector2(0, 720 * 0.14)
	drum.size = Vector2(1280, UI.u(6))
	drum.modulate.a = 0.0
	root.add_child(drum)
	var win_label := UI.outline(UI.label(t("TIE") if winners.size() > 1 else t("WINNER"), "ops", 13, UI.HAZARD), UI.u(0.4), Color("#2a1d05")) as Label
	var win_name := UI.shadow(UI.label(names, "ops", 6, Color(winners[0].color)), 0.4)
	var win := UI.vbox([win_label, win_name], 0.0)
	win.position = Vector2(140, 720 * 0.3 - UI.u(12))
	win.custom_minimum_size = Vector2(1000, UI.u(22))
	win.pivot_offset = Vector2(500, UI.u(11))
	win.rotation = deg_to_rad(-3)
	win.modulate.a = 0.0
	root.add_child(win)
	var tp := UI.panel({"width_frac": 0.66, "pad_y": 2.0})
	tp.body.add_child(UI.label(t("FINAL JUDGEMENT") if ceremony else t("SHIFT COMPLETE"), "ops", 4.5, UI.BONE))
	tp.body.add_child(UI.label(verdict, "ops", 3, Color(winners[0].color)))
	var grid := GridContainer.new()
	grid.columns = 4
	grid.add_theme_constant_override("h_separation", UI.u(3))
	for i in sorted.size():
		var pl = sorted[i]
		var wins: int = pl.history.filter(func(h): return h.place == 1).size()
		grid.add_child(UI.label(I18n.ordinal(i + 1), "ops", 3, UI.BONE))
		grid.add_child(UI.label(pl.name(), "ops", 3, Color(pl.color)))
		grid.add_child(UI.label(t("{w} wins · {d} deaths", {"w": wins, "d": pl.deaths}), "elite", 2.6, UI.BONE_DIM))
		grid.add_child(UI.label(str(pl.score), "ops", 3, UI.HAZARD))
	tp.body.add_child(UI.center(grid) if false else grid)
	if ceremony:
		tp.body.add_child(UI.label(t("All other subjects will be recycled."), "elite", 2.4, UI.BLOOD))
	var done := UI.tap_btn(t("RETURN TO TERMINAL"), true)
	tp.body.add_child(UI.hbox([done]))
	tp.body.add_child(_hint(I18n.tp("{A} return to terminal")))
	var table := UI.center(tp.root)
	table.position.y = 720 * 0.18
	table.modulate.a = 0.0
	root.add_child(table)
	var bd: Backdrop = app.backdrop
	bd.mode = "title"
	bd.reset_ceremony()
	var occupied := []
	for i in Player.MAX_PLAYERS:
		var pl = _player_in_slot(players, i)
		bd.set_slot(i, pl.look if pl else null, i + 1)
		if pl:
			occupied.append(i)
			bd.set_pose(i, "idle")
	var win_slots := winners.map(func(w): return w.slot)
	bd.set_spotlight([])
	Sfx.music("none")
	var t_reveal := 3.2
	var t_sink := t_reveal + 1.1
	var t_table := t_reveal + 2.6
	var st := {"time": 0.0, "revealed": false, "sunk": false, "beat": 0.0, "sweep": 0.0}
	var r_ref := {"r": null}
	done.pressed.connect(func():
		if st.time > t_table + 0.6 and r_ref.r:
			Sfx.play("select")
			bd.reset_ceremony()
			r_ref.r.finish())
	await run_screen(root, "clear", func(dt, r):
		r_ref.r = r
		st.time += min(dt, 0.1)
		if not st.revealed:
			drum.modulate.a = min(1.0, st.time / 0.4)
			if st.time >= st.beat:
				Sfx.play("tick")
				st.beat = st.time + max(0.045, 0.16 - st.time * 0.04)
			var hop := 0.12 + pow(st.time / t_reveal, 2) * 0.5
			st.sweep += dt / hop
			if not occupied.is_empty():
				bd.set_spotlight([occupied[int(st.sweep) % occupied.size()]])
			if st.time >= t_reveal:
				st.revealed = true
				bd.set_spotlight(win_slots)
				for s in win_slots:
					bd.set_pose(s, "armsUp")
					bd.set_lift(s, 0.9)
					bd.burst_confetti(s)
				for s in occupied:
					if not s in win_slots:
						bd.set_pose(s, "cower")
				Sfx.play("sting"); Sfx.play("win"); Sfx.play("explode", {"vol": 0.4})
				app.shake(0.7)
				if app.touch or app.platform == "android":
					Haptics.play("win")
		if st.revealed:
			var k := U.ease_out_back((st.time - t_reveal) / 0.4)
			drum.modulate.a = max(0.0, 1.0 - (st.time - t_reveal) / 0.3)
			win.modulate.a = min(1.0, (st.time - t_reveal) / 0.12)
			var lift := U.ease_out_cubic((st.time - t_table) / 0.5) if st.time >= t_table else 0.0
			win.scale = Vector2.ONE * ((3.0 - 2.0 * k) * (1.0 - 0.5 * lift))
			win.position.y = 720 * 0.3 - UI.u(12) - lift * UI.u(13)
		if st.revealed and not st.sunk and st.time >= t_sink:
			st.sunk = true
			for s in occupied:
				if not s in win_slots:
					bd.set_lift(s, -3.2)
			if occupied.size() > win_slots.size():
				Sfx.play("grind")
		if st.time >= t_table:
			var k2 := U.ease_out_cubic((st.time - t_table) / 0.5)
			table.modulate.a = k2
			table.position.y = 720 * 0.18 + (1.0 - k2) * UI.u(8)
		if st.time > t_table + 0.6 and Inputs.join_pressed() != "":
			Sfx.play("select")
			bd.reset_ceremony()
			r.finish())


## Pause menu during a round. Returns "resume" | "skip" | "quit".
func pause_screen() -> String:
	var items := [{"id": "resume", "label": t("RESUME")}, {"id": "skip", "label": t("SKIP SIMULATION")}, {"id": "quit", "label": t("ABORT PROGRAM")}]
	var state := {"index": 0}
	var saved := []
	for c in app.overlay.get_children():
		saved.append(c)
		app.overlay.remove_child(c)
	var p := UI.panel({"width_frac": 0.4})
	p.body.add_child(UI.label(t("PAUSED"), "ops", 6.4, UI.BONE))
	var menu := UI.vbox([], 0.2, false)
	var buttons := []
	var r_ref := {"r": null}
	for i in items.size():
		var b := _menu_item(items[i].label)
		menu.add_child(b)
		buttons.append(b)
		b.pressed.connect(func():
			Sfx.play("select")
			if r_ref.r:
				r_ref.r.finish(items[i].id))
	p.body.add_child(menu)
	var paint := func():
		for i in buttons.size():
			_set_item_sel(buttons[i], i == state.index, items[i].label)
	paint.call()
	var choice = await run_screen(UI.center(p.root), "dim", func(dt, r):
		r_ref.r = r
		menu_nav(items.size(), state, paint)
		if Inputs.join_pressed() != "":
			Sfx.play("select")
			r.finish(items[state.index].id)
		elif Inputs.key_pressed("Escape") or Inputs.any_pad_pressed(9):
			r.finish("resume"))
	app.set_overlay(null, "clear")
	for c in saved:
		if is_instance_valid(c):
			app.overlay.add_child(c)
	return str(choice)

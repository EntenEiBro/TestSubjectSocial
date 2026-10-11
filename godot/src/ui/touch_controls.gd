class_name TouchControls
extends Control
## On-screen controls for phones and tablets (port of touch.js).
##
##   left half   floating joystick: appears wherever the thumb lands
##   right side  big Ⓐ (action) and smaller Ⓑ (shove / back)
##   top         pause button (II)
##
## set_context("play") shows everything (rounds), "menu" only Ⓐ / Ⓑ (online
## client in the host's menus), "" hides the controls (menus are tapped
## directly). Drives the Controller "touch", so every screen and minigame
## treats a touch player like a keyboard half or a gamepad.

const STICK_RADIUS := 0.11   # fraction of the stage height

var ctrl: Controller
var context := ""
var show_pause := true
var _stick_finger := -1
var _origin := Vector2.ZERO
var _knob := Vector2.ZERO
var _buttons := {}           # finger -> "a" | "b"
var _down := {"a": false, "b": false}


func _init(pause: bool = true) -> void:
	show_pause = pause
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	ctrl = Inputs.controller("touch")
	set_context("")


func set_context(ctx: String) -> void:
	context = ctx
	visible = ctx == "play" or ctx == "menu"
	_release()
	queue_redraw()


func set_visible_controls(v: bool) -> void:
	if v:
		set_context(context)
	else:
		visible = false
		_release()


func _release() -> void:
	_stick_finger = -1
	_buttons.clear()
	_down = {"a": false, "b": false}
	ctrl.raw_x = 0.0
	ctrl.raw_y = 0.0
	ctrl.raw_a = false
	ctrl.raw_b = false


func _a_rect() -> Rect2:
	var s := UI.u(20)
	return Rect2(1280 - UI.u(6) - s, 720 - UI.u(10) - s, s, s)


func _b_rect() -> Rect2:
	var s := UI.u(14)
	return Rect2(1280 - UI.u(28) - s, 720 - UI.u(5) - s, s, s)


func _pause_rect() -> Rect2:
	return Rect2(640 - UI.u(5), UI.u(2) + UI.u(8.5), UI.u(10), UI.u(5))


func _local(p: Vector2) -> Vector2:
	return get_global_transform_with_canvas().affine_inverse() * p


func _input(event: InputEvent) -> void:
	if not visible:
		return
	var idx := -1
	var pos := Vector2.ZERO
	var pressed := false
	var drag := false
	if event is InputEventScreenTouch:
		idx = event.index
		pos = _local(event.position)
		pressed = event.pressed
	elif event is InputEventScreenDrag:
		idx = event.index
		pos = _local(event.position)
		drag = true
	elif event is InputEventMouseButton and event.device != InputEvent.DEVICE_ID_EMULATION and event.button_index == MOUSE_BUTTON_LEFT:
		idx = 99
		pos = _local(event.position)
		pressed = event.pressed
	elif event is InputEventMouseMotion and event.device != InputEvent.DEVICE_ID_EMULATION and (event.button_mask & MOUSE_BUTTON_MASK_LEFT):
		idx = 99
		pos = _local(event.position)
		drag = true
	else:
		return
	if drag:
		if idx == _stick_finger:
			_move_stick(pos)
		return
	if pressed:
		if _a_rect().grow(UI.u(1)).has_point(pos):
			_press(idx, "a")
		elif _b_rect().grow(UI.u(1)).has_point(pos):
			_press(idx, "b")
		elif context == "play" and show_pause and _pause_rect().has_point(pos):
			Haptics.play("click")
			Inputs.action("pause")
		elif context == "play" and pos.x < 640 and pos.y > 720 * 0.12 and _stick_finger < 0:
			_stick_finger = idx
			_origin = pos
			_knob = pos
			Haptics.play("tick")
			_move_stick(pos)
		else:
			return
		get_viewport().set_input_as_handled()
	else:
		if idx == _stick_finger:
			_stick_finger = -1
			ctrl.raw_x = 0.0
			ctrl.raw_y = 0.0
			queue_redraw()
		if _buttons.has(idx):
			_buttons.erase(idx)
			_sync_buttons()


func _press(idx: int, which: String) -> void:
	_buttons[idx] = which
	Haptics.play("press")
	_sync_buttons()


func _sync_buttons() -> void:
	var held: Array = _buttons.values()
	_down.a = "a" in held
	_down.b = "b" in held
	ctrl.raw_a = _down.a
	ctrl.raw_b = _down.b
	queue_redraw()


func _move_stick(pos: Vector2) -> void:
	var radius := 720.0 * STICK_RADIUS
	var d := pos - _origin
	var length := d.length()
	if length > radius:
		d = d / length * radius
	_knob = _origin + d
	var k := 0.0 if length < radius * 0.18 else 1.0 / radius
	ctrl.raw_x = d.x * k
	ctrl.raw_y = d.y * k
	queue_redraw()


func _draw() -> void:
	if not visible:
		return
	var font := UI.font("ops")
	for which in ["a", "b"]:
		var r := _a_rect() if which == "a" else _b_rect()
		var c := r.get_center()
		var down: bool = _down[which]
		draw_circle(c, r.size.x / 2, Color(0.61, 0.11, 0.11, 0.75) if down else Color(0.04, 0.035, 0.03, 0.55))
		draw_arc(c, r.size.x / 2, 0, TAU, 40, UI.BONE if which == "a" else UI.BONE_DIM, UI.u(0.4))
		var glyph := "Ⓐ" if which == "a" else "Ⓑ"
		var fs := UI.u(8.0 if which == "a" else 5.5)
		var sz := font.get_string_size(glyph, HORIZONTAL_ALIGNMENT_CENTER, -1, fs)
		draw_string(font, c + Vector2(-sz.x / 2, fs * 0.35), glyph, HORIZONTAL_ALIGNMENT_CENTER, -1, fs, UI.BONE)
	if context == "play" and show_pause:
		var pr := _pause_rect()
		draw_rect(pr, Color(0.04, 0.035, 0.03, 0.75))
		draw_rect(pr, Color("#555555"), false, 1.0)
		var vt := UI.font("vt")
		draw_string(vt, pr.position + Vector2(pr.size.x / 2 - UI.u(1.2), pr.size.y * 0.72), "II", HORIZONTAL_ALIGNMENT_LEFT, -1, UI.u(3.2), UI.BONE)
	if _stick_finger >= 0:
		var radius := 720.0 * STICK_RADIUS
		draw_circle(_origin, radius, Color(1, 1, 1, 0.06))
		draw_arc(_origin, radius, 0, TAU, 48, Color(0.85, 0.82, 0.75, 0.5), UI.u(0.4))
		draw_circle(_knob, UI.u(5), Color(0.85, 0.82, 0.75, 0.55))

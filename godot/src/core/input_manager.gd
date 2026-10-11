extends Node
## Unified local-multiplayer input (autoload "Inputs").
##
## Devices:
##   kb1  — W A S D to move, F / Space = A, G = B
##   kb2  — arrow keys, Enter / Numpad0 = A, Right Shift / Numpad1 = B
##   pad0..pad3 — gamepads (left stick / d-pad, A / Cross, B / Circle)
##   touch — the on-screen controls (written by TouchControls)
##   netN  — online players (written by the online host)
##   bot   — private controllers written by AI routines
##
## Keys are tracked by web-style codes ("KeyW", "ArrowUp", "Enter", "Escape"...)
## so menu / game code reads like the original. Gamepad buttons use the web
## "standard" numbering: 0 A, 1 B, 2 X, 3 Y, 9 Start, 12-15 d-pad.

signal mode_changed(mode: String)

const KEYMAPS := {
	"kb1": {"up": ["KeyW"], "down": ["KeyS"], "left": ["KeyA"], "right": ["KeyD"], "a": ["KeyF", "Space"], "b": ["KeyG"]},
	"kb2": {"up": ["ArrowUp"], "down": ["ArrowDown"], "left": ["ArrowLeft"], "right": ["ArrowRight"],
		"a": ["Enter", "Numpad0", "NumpadEnter"], "b": ["ShiftRight", "Numpad1"]},
}
const PAD_MAP := {0: JOY_BUTTON_A, 1: JOY_BUTTON_B, 2: JOY_BUTTON_X, 3: JOY_BUTTON_Y, 8: JOY_BUTTON_BACK, 9: JOY_BUTTON_START,
	12: JOY_BUTTON_DPAD_UP, 13: JOY_BUTTON_DPAD_DOWN, 14: JOY_BUTTON_DPAD_LEFT, 15: JOY_BUTTON_DPAD_RIGHT}

var keys := {}                 # code -> true while held
var pressed_this_frame := {}   # code -> true for the frame it went down
var controllers := {}          # device -> Controller
var _tracked := []
var _pending_actions := {}
var actions_this_frame := {}
var _pad_now := {}             # pad index -> {button: bool}
var _pad_prev := {}
var _stick_prev := {}
var mode := "keyboard"         # keyboard | gamepad | touch (button prompts follow it)


func _ready() -> void:
	process_priority = -100
	if DisplayServer.is_touchscreen_available() and OS.has_feature("mobile"):
		mode = "touch"


func set_mode(m: String) -> void:
	if m != mode:
		mode = m
		mode_changed.emit(m)


static func code_of(e: InputEventKey) -> String:
	var k := e.physical_keycode if e.physical_keycode != KEY_NONE else e.keycode
	if k >= KEY_A and k <= KEY_Z:
		return "Key" + char(k)
	if k >= KEY_0 and k <= KEY_9:
		return "Digit" + char(k)
	if k >= KEY_KP_0 and k <= KEY_KP_9:
		return "Numpad%d" % (k - KEY_KP_0)
	match k:
		KEY_UP: return "ArrowUp"
		KEY_DOWN: return "ArrowDown"
		KEY_LEFT: return "ArrowLeft"
		KEY_RIGHT: return "ArrowRight"
		KEY_ENTER: return "Enter"
		KEY_KP_ENTER: return "NumpadEnter"
		KEY_SPACE: return "Space"
		KEY_ESCAPE: return "Escape"
		KEY_BACKSPACE: return "Backspace"
		KEY_TAB: return "Tab"
		KEY_F11: return "F11"
		KEY_SHIFT:
			return "ShiftRight" if e.location == KEY_LOCATION_RIGHT else "ShiftLeft"
	return OS.get_keycode_string(k)


func _input(event: InputEvent) -> void:
	if event is InputEventKey:
		var e: InputEventKey = event
		if e.echo:
			return
		var code := code_of(e)
		if e.pressed:
			if not keys.has(code):
				pressed_this_frame[code] = true
			keys[code] = true
			set_mode("keyboard")
		else:
			keys.erase(code)
	elif event is InputEventJoypadButton and event.pressed:
		set_mode("gamepad")
	elif event is InputEventJoypadMotion and absf(event.axis_value) > 0.5:
		set_mode("gamepad")
	elif event is InputEventScreenTouch and event.pressed:
		set_mode("touch")


func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT:
		keys.clear()


## Get (or create) the Controller bound to a device ("bot" always gets a new one).
func controller(device: String) -> Controller:
	if device == "bot":
		return Controller.new("bot")
	if not controllers.has(device):
		controllers[device] = Controller.new(device)
	return controllers[device]


## Register a bot controller so it is committed every frame.
func track(c: Controller) -> void:
	_tracked.append(c)


func untrack_all() -> void:
	_tracked.clear()


## Queue a one-shot named action (touch buttons); visible for exactly one frame.
func action(action_name: String) -> void:
	_pending_actions[action_name] = true


func action_pressed(action_name: String) -> bool:
	return actions_this_frame.has(action_name)


func _pad_button(i: int, web_button: int) -> bool:
	if not PAD_MAP.has(web_button):
		return false
	return Input.is_joy_button_pressed(i, PAD_MAP[web_button])


## Called once at the start of every frame (by the main loop).
func update() -> void:
	actions_this_frame = _pending_actions
	_pending_actions = {}
	_pad_prev = _pad_now
	_pad_now = {}
	for i in Input.get_connected_joypads():
		var st := {}
		for wb in PAD_MAP:
			st[wb] = _pad_button(i, wb)
		_pad_now[i] = st
	for device in controllers:
		var c: Controller = controllers[device]
		if device.begins_with("kb"):
			var m: Dictionary = KEYMAPS[device]
			c.raw_x = (1.0 if _held(m.right) else 0.0) - (1.0 if _held(m.left) else 0.0)
			c.raw_y = (1.0 if _held(m.down) else 0.0) - (1.0 if _held(m.up) else 0.0)
			c.raw_a = _held(m.a)
			c.raw_b = _held(m.b)
		elif device.begins_with("pad"):
			var i := int(device.substr(3))
			if i in Input.get_connected_joypads():
				var x := Input.get_joy_axis(i, JOY_AXIS_LEFT_X)
				var y := Input.get_joy_axis(i, JOY_AXIS_LEFT_Y)
				if U.hypot(x, y) < 0.22:
					x = 0.0
					y = 0.0
				if _pad_button(i, 14): x = -1.0
				if _pad_button(i, 15): x = 1.0
				if _pad_button(i, 12): y = -1.0
				if _pad_button(i, 13): y = 1.0
				c.raw_x = x
				c.raw_y = y
				c.raw_a = _pad_button(i, 0)
				c.raw_b = _pad_button(i, 1) or _pad_button(i, 2)
			else:
				c.raw_x = 0.0
				c.raw_y = 0.0
				c.raw_a = false
				c.raw_b = false
		# "touch" and "netN" have their raw values written elsewhere.
		c.commit()
	for c in _tracked:
		c.commit()


## Called at the very end of every frame.
func end_frame() -> void:
	pressed_this_frame.clear()
	for i in _pad_now:
		_stick_prev[i] = _stick_dir(i)


func _held(codes: Array) -> bool:
	for k in codes:
		if keys.has(k) or pressed_this_frame.has(k):
			return true
	return false


## True if the key (web code) went down this frame.
func key_pressed(code: String) -> bool:
	return pressed_this_frame.has(code)


func key_held(code: String) -> bool:
	return keys.has(code)


## Gamepad edge detection with web button numbers.
func pad_pressed(index: int, web_button: int) -> bool:
	var now: Dictionary = _pad_now.get(index, {})
	var prev: Dictionary = _pad_prev.get(index, {})
	return now.get(web_button, false) and not prev.get(web_button, false)


## Which device pressed its "A" (join / confirm) button this frame, if any.
## Online devices only count when include_net (the lobby).
func join_pressed(include_net: bool = false) -> String:
	for k in KEYMAPS.kb1.a:
		if key_pressed(k):
			return "kb1"
	for k in KEYMAPS.kb2.a:
		if key_pressed(k):
			return "kb2"
	for i in _pad_now:
		if pad_pressed(i, 0):
			return "pad%d" % i
	var touch: Controller = controllers.get("touch")
	if touch and touch.a_pressed:
		return "touch"
	if include_net:
		for device in controllers:
			if str(device).begins_with("net") and controllers[device].a_pressed:
				return device
	return ""


## Which device pressed its "B" (back / leave) button this frame.
func back_pressed() -> String:
	for k in KEYMAPS.kb1.b:
		if key_pressed(k):
			return "kb1"
	for k in KEYMAPS.kb2.b:
		if key_pressed(k):
			return "kb2"
	if key_pressed("Escape") or key_pressed("Backspace"):
		return "kb2"
	for i in _pad_now:
		if pad_pressed(i, 1):
			return "pad%d" % i
	var touch: Controller = controllers.get("touch")
	if (touch and touch.b_pressed) or action_pressed("back"):
		return "touch"
	return ""


## Menu navigation from any device: "up" | "down" | "left" | "right" | "".
func menu_dir() -> String:
	if key_pressed("KeyW") or key_pressed("ArrowUp"): return "up"
	if key_pressed("KeyS") or key_pressed("ArrowDown"): return "down"
	if key_pressed("KeyA") or key_pressed("ArrowLeft"): return "left"
	if key_pressed("KeyD") or key_pressed("ArrowRight"): return "right"
	for i in _pad_now:
		if pad_pressed(i, 12): return "up"
		if pad_pressed(i, 13): return "down"
		if pad_pressed(i, 14): return "left"
		if pad_pressed(i, 15): return "right"
		var stick := _stick_dir(i)
		if stick != "" and stick != _stick_prev.get(i, ""):
			return stick
	var touch: Controller = controllers.get("touch")
	if touch and touch.dir_pressed != "":
		return touch.dir_pressed
	return ""


func _stick_dir(i: int) -> String:
	var x := Input.get_joy_axis(i, JOY_AXIS_LEFT_X)
	var y := Input.get_joy_axis(i, JOY_AXIS_LEFT_Y)
	if absf(x) < 0.6 and absf(y) < 0.6:
		return ""
	if absf(x) > absf(y):
		return "right" if x > 0 else "left"
	return "down" if y > 0 else "up"


## True if any pad pressed the given web button this frame.
func any_pad_pressed(web_button: int) -> bool:
	for i in _pad_now:
		if pad_pressed(i, web_button):
			return true
	return false

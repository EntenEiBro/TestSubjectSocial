class_name Controller
extends RefCounted
## A virtual controller — the only input surface minigames see: an analog
## move vector plus two buttons (A = action, B = shove / secondary).
## Humans' raw values are filled by Inputs (keyboard halves, gamepads, touch,
## online players); bots write them with set_move / set_buttons / tap_dir.

const LABELS := {
	"kb1": {"move": "W A S D", "a": "F", "b": "G", "name": "Keyboard (left)"},
	"kb2": {"move": "ARROWS", "a": "ENTER", "b": "R-SHIFT", "name": "Keyboard (right)"},
	"pad": {"move": "L-STICK", "a": "Ⓐ", "b": "Ⓑ", "name": "Gamepad"},
	"net": {"move": "REMOTE", "a": "Ⓐ", "b": "Ⓑ", "name": "Online"},
	"touch": {"move": "JOYSTICK", "a": "Ⓐ", "b": "Ⓑ", "name": "Touch screen"},
	"bot": {"move": "—", "a": "—", "b": "—", "name": "Bot"},
}

var device: String
var move_x := 0.0     # -1 (left) .. 1 (right)
var move_y := 0.0     # -1 (up / away from the camera) .. 1 (down / toward it)
var a := false
var b := false
var a_pressed := false
var b_pressed := false
var a_released := false
var b_released := false
var dir_pressed := ""  # "up" | "down" | "left" | "right" | "" (discrete press this frame)
var raw_x := 0.0
var raw_y := 0.0
var raw_a := false
var raw_b := false
var raw_dir := ""
var _prev_a := false
var _prev_b := false
var _prev_dir := ""


func _init(dev: String = "bot") -> void:
	device = dev


func is_bot() -> bool:
	return device == "bot"


func labels() -> Dictionary:
	if device.begins_with("pad"):
		return LABELS.pad
	if device.begins_with("net"):
		return LABELS.net
	return LABELS.get(device, LABELS.bot)


## Bot helper: analog movement.
func set_move(x: float, y: float) -> void:
	raw_x = x
	raw_y = y


## Bot helper: hold or release buttons.
func set_buttons(btn_a: bool, btn_b: bool = false) -> void:
	raw_a = btn_a
	raw_b = btn_b


## Bot helper: tap a discrete direction this frame.
func tap_dir(d: String) -> void:
	raw_dir = d


## Derive edge-triggered states from the raw values. Called once per frame / tick.
func commit() -> void:
	var x := raw_x
	var y := raw_y
	var length := sqrt(x * x + y * y)
	if length > 1.0:
		x /= length
		y /= length
	move_x = x
	move_y = y
	a = raw_a
	b = raw_b
	a_pressed = a and not _prev_a
	b_pressed = b and not _prev_b
	a_released = (not a) and _prev_a
	b_released = (not b) and _prev_b
	_prev_a = a
	_prev_b = b
	if not is_bot():
		var d := ""
		if absf(x) > 0.6 or absf(y) > 0.6:
			if absf(x) > absf(y):
				d = "right" if x > 0 else "left"
			else:
				d = "down" if y > 0 else "up"
		dir_pressed = d if d != "" and d != _prev_dir else ""
		_prev_dir = d
	else:
		dir_pressed = raw_dir
		raw_dir = ""


## Clear transient states (e.g. between screens).
func reset() -> void:
	raw_x = 0.0
	raw_y = 0.0
	raw_a = false
	raw_b = false
	raw_dir = ""
	commit()

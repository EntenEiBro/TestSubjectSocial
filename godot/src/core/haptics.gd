extends Node
## Vibration feedback on phones (autoload "Haptics").
##
## Haptics.play(kind) triggers a named feel. Menus get feedback for free
## through from_sfx() (hooked into Sfx). During a round that hook is muted
## (round_active), because sounds don't say WHO caused them; in-round feels
## are personal: for_player(player, kind) only fires for the subject played
## with this device's touch controls.

## Feels: [[timings ms (off, on, off, on...)], [amplitudes 0-255]] and a priority.
const FEELS := {
	"tick": {"wave": [[0, 10], [0, 140]], "prio": 0},
	"click": {"wave": [[0, 18], [0, 200]], "prio": 1},
	"press": {"wave": [[0, 14], [0, 90]], "prio": 1},
	"countdown": {"wave": [[0, 22], [0, 120]], "prio": 2},
	"hit": {"wave": [[0, 35], [0, 180]], "prio": 3},
	"error": {"wave": [[0, 30, 50, 30], [0, 160, 0, 160]], "prio": 3},
	"go": {"wave": [[0, 60], [0, 220]], "prio": 4},
	"heavy": {"wave": [[0, 70], [0, 255]], "prio": 5},
	"explosion": {"wave": [[0, 90, 30, 70], [0, 255, 0, 150]], "prio": 6},
	"win": {"wave": [[0, 40, 60, 40, 60, 110], [0, 170, 0, 170, 0, 255]], "prio": 6},
	"death": {"wave": [[0, 200, 70, 280], [0, 255, 0, 210]], "prio": 9},
}
const SFX_FEELS := {
	"select": "click", "join": "click", "back": "tick", "ding": "click",
	"beep": "countdown", "go": "go", "wrong": "error", "buzz": "error",
	"clank": "press", "explode": "explosion", "win": "win",
}
const WINDOW_MS := 45.0
const LEVEL_SCALE := [0.0, 0.35, 0.65, 1.0]

var level := 3            # SETTINGS → HAPTIC STRENGTH: 0 OFF .. 3 HIGH
var round_active := false # during a round only personal feels (for_player) vibrate
var _last_at := -1000.0
var _last_prio := -1
var _busy_until := -1000.0
var _seq := 0


func supported() -> bool:
	return OS.has_feature("mobile")


func play(kind: String) -> void:
	if level <= 0 or not FEELS.has(kind) or not supported():
		return
	var feel: Dictionary = FEELS[kind]
	var now := Time.get_ticks_msec() * 1.0
	if now - _last_at < WINDOW_MS and feel.prio <= _last_prio:
		return
	# Don't let small feels cut off a longer, more important one still playing.
	if now < _busy_until and feel.prio < _last_prio:
		return
	var timings: Array = feel.wave[0]
	var amps: Array = feel.wave[1]
	var total := 0.0
	for t in timings:
		total += float(t)
	_last_at = now
	_last_prio = feel.prio
	_busy_until = now + total
	var scale: float = LEVEL_SCALE[clampi(level, 0, 3)]
	_seq += 1
	var seq := _seq
	var at := 0.0
	for i in timings.size():
		var ms := float(timings[i])
		if i % 2 == 1 and int(amps[i]) > 0:
			var dur := int(max(6.0, round(ms * (0.55 + 0.45 * scale))))
			var amp := clampf(float(amps[i]) / 255.0 * scale, 0.01, 1.0)
			_pulse_at(at, dur, amp, seq)
		at += ms


func _pulse_at(delay_ms: float, dur: int, amp: float, seq: int) -> void:
	if delay_ms <= 0.0:
		Input.vibrate_handheld(dur, amp)
		return
	get_tree().create_timer(delay_ms / 1000.0, true).timeout.connect(func():
		if seq == _seq:
			Input.vibrate_handheld(dur, amp))


## Hook for Sfx: vibrate along with menu sound effects (muted during rounds).
func from_sfx(sfx_name: String) -> void:
	if round_active:
		return
	if SFX_FEELS.has(sfx_name):
		play(SFX_FEELS[sfx_name])


## Personal feel: only for the subject played with this device's touch controls.
func for_player(player, kind: String) -> void:
	if player != null and player.device == "touch" and not player.remote:
		play(kind)

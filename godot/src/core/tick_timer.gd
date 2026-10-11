class_name TickTimer
extends RefCounted
## Countdown / interval helper for "every N seconds" events. Call tick(dt);
## it returns true on the frame the timer fires.

var duration: float
var repeat: bool
var t := 0.0
var done := false


func _init(d: float, rep: bool = false) -> void:
	duration = d
	repeat = rep


func remaining() -> float:
	return max(0.0, duration - t)


func progress() -> float:
	return clampf(t / duration, 0.0, 1.0) if duration > 0.0 else 1.0


func reset(d: float = -1.0) -> void:
	if d >= 0.0:
		duration = d
	t = 0.0
	done = false


func tick(dt: float) -> bool:
	if done:
		return false
	t += dt
	if t >= duration:
		if repeat:
			t -= duration
		else:
			done = true
		return true
	return false

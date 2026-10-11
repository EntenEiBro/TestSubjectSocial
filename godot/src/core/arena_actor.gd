class_name ArenaActor
extends RefCounted
## One avatar living in an Arena (a circle on the XZ plane).
##
## Minigames may attach their own fields freely (a.seat = seat, a.holding = x):
## unknown properties are stored in `data` (see _set / _get).

var player = null
var ctrl: Controller
var subject: Subject
var pos := Vector3.ZERO
var vel := Vector3.ZERO
var knock := Vector3.ZERO
var radius := 0.42
var speed := 5.2
var speed_mul := 1.0
var facing := 0.0       # 0 = +Z = toward the camera
var alive := true
var frozen := false     # ignore input (cutscenes, stunned, seated...)
var stun := 0.0
var stun_seen := 0.0
var shove_cd := 0.0
var y := 0.0            # vertical offset (falling into pits)
var vy := 0.0
var falling := false
var seat = null         # the Minigame seat (Dictionary) this actor belongs to
var data := {}          # per-minigame scratch space


## opts: player, ctrl, subject, x (0), z (0), radius (0.42), speed (5.2)
func _init(opts: Dictionary = {}) -> void:
	player = opts.get("player", null)
	ctrl = opts.get("ctrl", null)
	subject = opts.get("subject", null)
	pos = Vector3(opts.get("x", 0.0), 0.0, opts.get("z", 0.0))
	radius = opts.get("radius", 0.42)
	speed = opts.get("speed", 5.2)
	if subject:
		subject.root.position = pos


func _set(property: StringName, value: Variant) -> bool:
	data[property] = value
	return true


func _get(property: StringName) -> Variant:
	if data.has(property):
		return data[property]
	return null


## Unit vector the actor is facing.
func forward() -> Vector3:
	return Vector3(sin(facing), 0, cos(facing))


## Point `dist` units in front of the actor.
func ahead(dist: float = 1.0) -> Vector3:
	return pos + forward() * dist

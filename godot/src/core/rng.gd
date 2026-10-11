class_name Rng
## Seeded random generator for game simulation (mulberry32, the same sequence
## as the web version). Online rounds run on every device in lockstep, so all
## simulation code (minigames, bot AI) must take randomness from here instead
## of randf()/randi(). Purely cosmetic randomness (particles, texture noise,
## camera shake, sounds) uses U.crand() / randf() instead.
##
## The generator is reseeded at the start of every round (flow.gd).

const M32 := 0xFFFFFFFF

static var _state: int = 0x9E3779B9


## Restart the sequence from `s` (a 32-bit integer).
static func seed_random(s: int) -> void:
	_state = s & M32


## A fresh random seed (for the host / offline play).
static func make_seed() -> int:
	return randi() & M32


## 32-bit wrapping multiply (Math.imul), split so no 64-bit product overflows.
static func _imul(a: int, b: int) -> int:
	a &= M32
	b &= M32
	var lo := a * (b & 0xFFFF)
	var hi := ((a * (b >> 16)) & 0xFFFF) << 16
	return (lo + hi) & M32


## Next float in [0, 1).
static func random() -> float:
	_state = (_state + 0x6D2B79F5) & M32
	var t := _state
	t = _imul(t ^ (t >> 15), t | 1)
	t = (t ^ ((t + _imul(t ^ (t >> 7), t | 61)) & M32)) & M32
	return float((t ^ (t >> 14)) & M32) / 4294967296.0


## Random float in [a, b).
static func rand(a: float = 0.0, b: float = 1.0) -> float:
	return a + random() * (b - a)


## Random integer in [a, b] (inclusive).
static func rand_int(a: int, b: int) -> int:
	return int(floor(a + random() * (b - a + 1)))


## Pick one random element from an array.
static func pick(arr: Array) -> Variant:
	if arr.is_empty():
		return null
	return arr[int(floor(random() * arr.size()))]


## Return a new, Fisher-Yates shuffled copy of `arr`.
static func shuffle(arr: Array) -> Array:
	var a := arr.duplicate()
	for i in range(a.size() - 1, 0, -1):
		var j := int(floor(random() * (i + 1)))
		var tmp = a[i]
		a[i] = a[j]
		a[j] = tmp
	return a

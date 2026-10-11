class_name AI
## Reusable steering helpers for bots. Bots drive the same Controller API as
## humans, so these only write stick / button values. Simulation randomness
## comes from Rng (deterministic for online play).


## Bot skill profile: reaction delay + error rates, randomized per bot.
static func make_brain(difficulty: float = 0.6) -> Dictionary:
	return {
		"difficulty": difficulty,
		"reaction": 0.35 - difficulty * 0.25 + Rng.rand(-0.05, 0.05),
		"error": 0.25 - difficulty * 0.2,
		"wander": Rng.rand(0, TAU),
		"timer": 0.0,
		"target": null,
		"memory": {},
	}


## Steer `actor` toward (x, z). opts: arrive (0.25), slow (1.2). Returns the distance left.
static func steer_to(actor: ArenaActor, x: float, z: float, opts: Dictionary = {}) -> float:
	var arrive: float = opts.get("arrive", 0.25)
	var slow: float = opts.get("slow", 1.2)
	var dx := x - actor.pos.x
	var dz := z - actor.pos.z
	var d := U.hypot(dx, dz)
	if d < arrive:
		actor.ctrl.set_move(0, 0)
		return d
	var s: float = min(1.0, d / slow)
	actor.ctrl.set_move(dx / d * s, dz / d * s)
	return d


## Steer away from a point.
static func flee_from(actor: ArenaActor, x: float, z: float) -> void:
	var dx := actor.pos.x - x
	var dz := actor.pos.z - z
	var d := U.hypot(dx, dz)
	if d == 0.0:
		d = 1.0
	actor.ctrl.set_move(dx / d, dz / d)


## Random wander inside bounds {min_x, max_x, min_z, max_z}; call every frame.
static func wander(actor: ArenaActor, brain: Dictionary, dt: float, bounds = null) -> void:
	brain.wander += Rng.rand(-2, 2) * dt
	var x := sin(brain.wander)
	var z := cos(brain.wander)
	var p := actor.pos
	if bounds:
		if p.x < bounds.min_x + 1.5:
			x = absf(x)
		if p.x > bounds.max_x - 1.5:
			x = -absf(x)
		if p.z < bounds.min_z + 1.5:
			z = absf(z)
		if p.z > bounds.max_z - 1.5:
			z = -absf(z)
		brain.wander = atan2(x, z)
	actor.ctrl.set_move(x * 0.7, z * 0.7)


## Nearest other live actor (optionally filtered): {actor, dist} or null.
static func nearest(actor: ArenaActor, actors: Array, filter: Callable = Callable()) -> Variant:
	var best = null
	var bd := INF
	for o in actors:
		if o == actor or not o.alive:
			continue
		if filter.is_valid() and not filter.call(o):
			continue
		var d := U.hypot(o.pos.x - actor.pos.x, o.pos.z - actor.pos.z)
		if d < bd:
			bd = d
			best = o
	if best == null:
		return null
	return {"actor": best, "dist": bd}


## Face a target and shove it if close enough.
static func try_shove(actor: ArenaActor, target: ArenaActor, range_m: float = 1.3, chance: float = 1.0) -> bool:
	var d := U.hypot(target.pos.x - actor.pos.x, target.pos.z - actor.pos.z)
	if d < range_m and Rng.random() < chance:
		actor.facing = atan2(target.pos.x - actor.pos.x, target.pos.z - actor.pos.z)
		actor.ctrl.set_buttons(actor.ctrl.raw_a, true)
		return true
	return false


## Release all buttons (call at the start of a bot's think step).
static func release_buttons(ctrl: Controller) -> void:
	ctrl.set_buttons(false, false)

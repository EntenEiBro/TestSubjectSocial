class_name Minigame
extends Node3D
## The contract every round implements (port of base.js).
##
## Lifecycle (driven by flow.gd):
##   var game = G.new(ctx)      ctx = {engine, input, hud, players, bot_difficulty, lockstep}
##   game.build()               stage, camera, avatars (shown behind the briefing)
##   game.prewarm()
##   game.preview(dt)           optional idle animation while the briefing is up
##   game.begin()               countdown finished → start()
##   game.tick(dt)              per frame / tick: bots think, update(), FX
##   game.result_tiers          set (Array of tiers) once end() has run its course
##
## Subclasses define `const META := {id, title, tagline, category, controls, objective, rules}`
## and override build(), start(), update(dt), bot_think(seat, dt), optionally
## preview(dt) and placement().
##
## A seat is a Dictionary: {player, ctrl, brain, is_bot, alive, death_time, score,
## subject, actor, tag_target} — games may add their own keys (seat.os = {...}).
##
## Determinism (online rounds run on every device in lockstep): simulation code
## takes randomness from Rng and time from `time` / `clock` — never randf(),
## Time.get_ticks_msec() or wall-clock time.

signal round_finished(tiers: Array)

var meta := {}
var ctx := {}
var engine = null
var hud: Hud = null
var time := 0.0          # seconds since start()
var clock := 0.0         # seconds of simulation since build (also runs during preview)
var lockstep := false
var state := "build"     # build | preview | play | over
var deaths := []         # seats in order of death
var scene: Node3D = null
var camera: Camera3D = null
var fx: FX = null
var seats := []
var result_tiers = null  # Array of tiers once finished
var _end_in := -1.0
var _end_tiers = null
var _lights := []


func _init(ctx_in: Dictionary = {}) -> void:
	ctx = ctx_in
	meta = get_script().get_script_constant_map().get("META", {})
	engine = ctx.get("engine")
	hud = ctx.get("hud")
	lockstep = bool(ctx.get("lockstep", false))
	name = str(meta.get("id", "Minigame"))
	var difficulty: float = ctx.get("bot_difficulty", 0.6)
	for player in ctx.get("players", []):
		var c: Controller
		if lockstep:
			c = Controller.new(player.device)
		elif player.is_bot:
			c = Controller.new("bot")
			Inputs.track(c)
		else:
			c = Inputs.controller(player.device)
		seats.append({
			"player": player, "ctrl": c, "is_bot": player.is_bot, "brain": AI.make_brain(difficulty),
			"alive": true, "death_time": -1.0, "score": 0.0, "subject": null, "actor": null, "tag_target": null,
		})


# ------------------------------------------------------------------ overrides

## Construct the stage. Must set scene and camera (make_scene / make_camera).
func build() -> void:
	pass

## Called once when the countdown reaches GO.
func start() -> void:
	pass

## Per-frame game logic while state == "play" (and while "over", to let things settle).
func update(_dt: float) -> void:
	pass

## Per-frame bot logic for one bot seat while playing.
func bot_think(_seat: Dictionary, _dt: float) -> void:
	pass

## Idle animation during the briefing (state == "preview").
func preview(_dt: float) -> void:
	pass

## Final ranking as tiers (Arrays of seats), best first. Default: survivors
## (by seat.score, ties grouped), then the dead in reverse death order.
func placement() -> Array:
	var alive := seats.filter(func(s): return s.alive)
	alive.sort_custom(func(a, b): return a.score > b.score)
	var tiers := group_by(alive, func(s): return s.score)
	var dead := deaths.duplicate()
	dead.reverse()
	tiers.append_array(group_by(dead, func(s): return snappedf(s.death_time, 0.001)))
	return tiers


# -------------------------------------------------------------------- helpers

## Standard moody stage + FX. opts: fog, fog_near, fog_far, ambient, ambient_intensity, floor_at (Callable)
func make_scene(opts: Dictionary = {}) -> Node3D:
	scene = Env.mood_scene(opts)
	add_child(scene)
	fx = FX.new(scene, opts.get("floor_at", Callable()))
	return scene


## Perspective camera at pos looking at look (Arrays [x, y, z] or Vector3).
func make_camera(pos: Variant, look: Variant, fov: float = 50.0) -> Camera3D:
	camera = Camera3D.new()
	camera.fov = fov
	camera.near = 0.1
	camera.far = 300.0
	scene.add_child(camera)
	Env.look_from(camera, Env._v3(pos), Env._v3(look))
	return camera


## Spawn the avatar for a seat. opts: x, y, z, ring (true), facing (0)
func spawn_subject(seat: Dictionary, opts: Dictionary = {}) -> Subject:
	var s := Subject.for_player(seat.player)
	s.root.position = Vector3(opts.get("x", 0.0), opts.get("y", 0.0), opts.get("z", 0.0))
	s.root.rotation.y = opts.get("facing", 0.0)
	if opts.get("ring", true):
		s.ring = Env.player_ring(seat.player.color)
		s.root.add_child(s.ring)
	scene.add_child(s.root)
	seat.subject = s
	seat.tag_target = s.parts.head
	return s


## Eliminate a seat with a death style (see FX.kill). Safe to call twice.
## opts: dir (Vector3), force (1), sound (sfx name), quiet (false). Returns true if it was alive.
func kill(seat: Dictionary, style: String = "gib", opts: Dictionary = {}) -> bool:
	if not seat.alive:
		return false
	seat.alive = false
	seat.death_time = time
	deaths.append(seat)
	if seat.actor:
		seat.actor.alive = false
	if seat.subject:
		if seat.subject.ring:
			seat.subject.ring.visible = false
		fx.kill(seat.subject, style, opts)
	seat.tag_target = null
	hud.mark_dead(seat)
	Haptics.for_player(seat.player, "death")
	var sounds := {"gib": "splat", "shot": "shot", "crush": "crunch", "fall": "whoosh", "snap": "snap", "burn": "burn", "slice": "saw"}
	var sfx: String = opts.get("sound", sounds.get(style, ""))
	if sfx != "":
		Sfx.play(sfx)
	if style != "fall":
		Sfx.play("splat", {"vol": 0.6})
	if engine:
		engine.shake(0.1 if style == "fall" else 0.5)
	if not opts.get("quiet", false):
		hud.feed("%s — TERMINATED" % seat.player.name(), seat.player.color)
	return true


## Seats played on this device (online players' seats live on their own devices).
func is_local(seat) -> bool:
	return seat != null and not seat.is_bot and not seat.player.remote


## One-shot commendation for a human seat on this device.
func award(seat, key: String) -> void:
	if is_local(seat):
		Commendations.unlock(key)


## Advance a cumulative commendation counter for a human seat on this device.
func progress(seat, key: String, amount: int = 1) -> void:
	if is_local(seat):
		Commendations.add(key, amount)


func alive_seats() -> Array:
	return seats.filter(func(s): return s.alive)


func human_seats() -> Array:
	return seats.filter(func(s): return not s.is_bot)


## Finish the round after an optional dramatic pause (in game time).
func end(delay: float = 2.2, tiers = null) -> void:
	if state == "over":
		return
	state = "over"
	_end_in = delay
	_end_tiers = tiers


## Standard "last one standing" check. Returns true if the round ended.
func check_last_standing(min_alive: int = 1) -> bool:
	if state != "play":
		return false
	if alive_seats().size() <= min_alive:
		end()
		return true
	return false


# -------------------------------------------------------------- engine-facing

## Countdown finished.
func begin() -> void:
	state = "play"
	time = 0.0
	start()


## Called every frame (or lockstep tick) by the flow.
func tick(dt: float) -> void:
	clock += dt
	if state == "preview" or state == "build":
		preview(dt)
	if state == "play":
		time += dt
		for seat in seats:
			if seat.is_bot and seat.alive:
				bot_think(seat, dt)
		update(dt)
	elif state == "over":
		update(dt)
		if _end_in >= 0.0:
			_end_in -= dt
			if _end_in <= 0.0:
				_end_in = -1.0
				result_tiers = _end_tiers if _end_tiers != null else placement()
				round_finished.emit(result_tiers)
	if fx:
		fx.update(dt)
	_sync_lights()
	_update_tags()


## Prepare rendering before the round: lights attached to moving / hideable
## objects are moved to the stage root and follow their object (a light that
## appears or disappears changes the light setup and can stall phones).
func prewarm() -> void:
	if scene == null:
		return
	_warm_up()
	var lights := []
	_collect_lights(scene, lights)
	for light in lights:
		var anchor := Node3D.new()
		anchor.transform = light.transform
		light.get_parent().add_child(anchor)
		light.get_parent().remove_child(light)
		scene.add_child(light)
		_lights.append({"light": light, "anchor": anchor, "hidden": false, "saved": light.light_energy})
	_sync_lights()


## Shader warm-up: draw one tiny sample of every effect material (blood, pools,
## smoke, sparks) and one avatar per seat right in front of the camera while the
## title card / briefing is up, then remove them. Phones compile a shader the
## first time it is drawn; this keeps those stalls out of the round. Cosmetic
## only (no Rng, removed on a real-time timer), so lockstep stays identical.
func _warm_up() -> void:
	if camera == null or fx == null or DisplayServer.get_name() == "headless":
		return
	var warm := Node3D.new()
	warm.name = "ShaderWarmup"
	warm.position = Vector3(0, 0, -0.6)
	warm.scale = Vector3.ONE * 0.01
	camera.add_child(warm)
	var x := -0.4
	for m in fx.samples():
		m.position.x = x
		warm.add_child(m)
		x += 0.2
	var avatars := []
	for seat in seats:
		var s := Subject.for_player(seat.player)
		s.root.position.x = x
		warm.add_child(s.root)
		avatars.append(s)
		x += 0.2
	var tree := Engine.get_main_loop() as SceneTree
	tree.create_timer(0.6).timeout.connect(func():
		for s in avatars:
			s.dispose()
		if is_instance_valid(warm):
			warm.queue_free())


func _collect_lights(node: Node, out: Array) -> void:
	for c in node.get_children():
		if c is Light3D and node != scene and not (c is DirectionalLight3D):
			out.append(c)
		_collect_lights(c, out)


func _sync_lights() -> void:
	for h in _lights:
		var light: Light3D = h.light
		var anchor: Node3D = h.anchor
		if not is_instance_valid(light) or not is_instance_valid(anchor):
			continue
		var shown := anchor.is_inside_tree() and anchor.is_visible_in_tree()
		if shown:
			if h.hidden:
				h.hidden = false
				light.light_energy = h.saved
			light.global_transform = anchor.global_transform
		else:
			if light.light_energy != 0.0:
				h.saved = light.light_energy
			h.hidden = true
			light.light_energy = 0.0


func _update_tags() -> void:
	if hud == null:
		return
	for seat in seats:
		var target = seat.tag_target
		if target == null or camera == null or not is_instance_valid(target) or not target.is_inside_tree():
			hud.tag(seat, null)
			continue
		var p: Vector3 = target.global_position + Vector3(0, 0.55, 0)
		if camera.is_position_behind(p):
			hud.tag(seat, null)
			continue
		var vp_size := camera.get_viewport().get_visible_rect().size
		var sp := camera.unproject_position(p)
		hud.tag(seat, {"x": sp.x / vp_size.x, "y": sp.y / vp_size.y})


## Release resources.
func dispose() -> void:
	if not lockstep:
		Inputs.untrack_all()
	if hud:
		hud.clear()
	queue_free()


## Group a pre-sorted array into tiers of equal key.
static func group_by(sorted: Array, key: Callable) -> Array:
	var tiers := []
	for item in sorted:
		if not tiers.is_empty() and key.call(tiers[-1][0]) == key.call(item):
			tiers[-1].append(item)
		else:
			tiers.append([item])
	return tiers


## Rank by score descending, then alive before dead.
static func rank_by_score(list: Array) -> Array:
	var sorted := list.duplicate()
	sorted.sort_custom(func(a, b):
		if a.score != b.score:
			return a.score > b.score
		return a.alive and not b.alive)
	return group_by(sorted, func(s): return "%s|%s" % [s.score, s.alive])

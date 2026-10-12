class_name Lockstep
extends RefCounted
## Online rounds run on every player's own device (port of net/lockstep.js).
##
## Instead of streaming the host's screen, each device simulates the round
## itself ("deterministic lockstep"):
##   1. The host picks a random seed and tells every client which simulation to
##      build (Net.round_start). All devices build it from that seed.
##   2. After the briefing every device rebuilds a fresh copy from a second seed
##      (round_prepare), so the idle preview can't make them differ, and freezes
##      it until tick 0.
##   3. The host runs the round at a fixed 60 ticks per second. Each tick it
##      collects one input per human seat (its own devices plus the latest input
##      received from every online player) and simulates that tick. These input
##      frames are numbered and sent to all clients.
##   4. Clients simulate exactly the same frames: same seed + same inputs + same
##      code = the same game on every screen, rendered locally.
## The host never waits for anyone. Every HASH_EVERY ticks it includes a state
## checksum; a client that disagrees reports it and keeps playing (the host's
## copy decides the results).

const TICK := 1.0 / 60.0
const PROTOCOL := 1          # bump when the simulation or frame format changes
const HISTORY := 8           # frames repeated in every packet (packets may get lost)
const HASH_EVERY := 30       # ticks between state checksums
const MAX_TICKS_PER_FRAME := 4


## Quantize one controller state into a compact, exactly reproducible frame entry.
static func encode_input(x: float, y: float, a: bool, b: bool) -> Array:
	return [roundi(clampf(x, -1, 1) * 100), roundi(clampf(y, -1, 1) * 100), (1 if a else 0) | (2 if b else 0)]


static func _apply_input(ctrl: Controller, q) -> void:
	ctrl.raw_x = float(q[0]) / 100.0
	ctrl.raw_y = float(q[1]) / 100.0
	ctrl.raw_a = (int(q[2]) & 1) != 0
	ctrl.raw_b = (int(q[2]) & 2) != 0


## Seats driven by frame entries, in frame order (every non-bot seat).
static func human_seats(game: Minigame) -> Array:
	return game.seats.filter(func(s): return not s.is_bot)


## Simulate one tick with one input frame (identical on host and clients).
static func step_game(game: Minigame, humans: Array, frame: Array) -> void:
	if game.state == "preview":
		game.begin()   # tick 0 starts the round
	for i in humans.size():
		_apply_input(humans[i].ctrl, frame[i] if i < frame.size() else [0, 0, 0])
	for s in game.seats:
		s.ctrl.commit()
	game.tick(TICK)


## Checksum of the simulation state: time, alive flags, scores and avatar positions.
static func state_hash(game: Minigame) -> int:
	var h := 0x811c9dc5
	var mix := func(v: int, hh: int) -> int: return ((hh ^ (v & 0xFFFFFFFF)) * 0x01000193) & 0xFFFFFFFF
	h = mix.call(roundi(game.time * 1000), h)
	for s in game.seats:
		h = mix.call(1 if s.alive else 0, h)
		h = mix.call(roundi(float(s.score) * 1000), h)
		if s.subject:
			var p: Vector3 = s.subject.root.position
			h = mix.call(roundi(p.x * 1000), h)
			h = mix.call(roundi(p.y * 1000), h)
			h = mix.call(roundi(p.z * 1000), h)
	return h


## Host side: runs the online round at a fixed tick rate and publishes the input
## frames. The app calls update() instead of game.tick() while it is active.
class Host extends RefCounted:
	var game: Minigame = null
	var humans := []
	var frames := []
	var acc := 0.0
	var hash = null
	var sample: Callable          # func(device) -> encoded input
	var publish: Callable         # func(frames, hash)
	var on_tick_begin: Callable   # sounds made inside a tick are simulated by every client
	var on_tick_end: Callable

	func start(g: Minigame) -> void:
		game = g
		humans = Lockstep.human_seats(g)
		frames = []
		acc = 0.0
		hash = null

	func stop() -> void:
		game = null

	func update(dt: float) -> void:
		if game == null:
			return
		acc = minf(acc + dt, Lockstep.TICK * Lockstep.MAX_TICKS_PER_FRAME)
		var ran := 0
		while acc >= Lockstep.TICK - 1e-9 and ran < Lockstep.MAX_TICKS_PER_FRAME:
			acc -= Lockstep.TICK
			ran += 1
			var frame := humans.map(func(s): return sample.call(str(s.player.device)))
			frames.append(frame)
			on_tick_begin.call()
			Lockstep.step_game(game, humans, frame)
			on_tick_end.call()
			if frames.size() % Lockstep.HASH_EVERY == 0:
				hash = [frames.size(), Lockstep.state_hash(game)]
		if ran > 0:
			publish.call(frames, hash)


## Client side: follows the host's frames.
class Follower extends RefCounted:
	var game: Minigame
	var humans := []
	var frames := {}           # tick -> input frame
	var latest := 0            # newest frame number received (exclusive)
	var next := 0              # next tick to simulate
	var acc := 0.0
	var reserve := 1           # frames held back to absorb jitter (grows if delivery is bumpy)
	var starved := 0.0
	var stall_len := 0.0
	var smooth := 0.0
	var host_hashes := {}
	var own_hashes := {}
	var desynced := false

	func _init(g: Minigame) -> void:
		game = g
		humans = Lockstep.human_seats(g)

	## Frame packet from the host: {n, f: last frames, h: [tick, hash]}.
	func receive(pkt: Dictionary) -> void:
		var f: Array = pkt.get("f", [])
		var n := int(pkt.get("n", 0))
		var first := n - f.size()
		for i in f.size():
			if not frames.has(first + i):
				frames[first + i] = f[i]
		latest = maxi(latest, n)
		var h = pkt.get("h")
		if h is Array and h.size() == 2:
			host_hashes[int(h[0])] = int(h[1])
			_check_hash(int(h[0]))

	## Frames the host resent after a gap (reliable channel).
	func fill(from: int, f: Array) -> void:
		for i in f.size():
			if not frames.has(from + i):
				frames[from + i] = f[i]
		latest = maxi(latest, from + f.size())

	## First missing frame if stuck on a gap (for resend requests), else -1.
	func gap() -> int:
		return next if not frames.has(next) and latest > next else -1

	## Advance by real time dt using frames as they arrive. Returns false while stalled.
	func update(dt: float) -> bool:
		if desynced:
			return true
		acc = minf(acc + dt, 0.25)
		var budget := int(floor(acc / Lockstep.TICK))
		var usable := latest - next - reserve
		if usable > 4:
			budget = maxi(budget, mini(usable, 8))   # fell behind: catch up
		if budget <= 0:
			return true
		var ran := 0
		while ran < budget and latest - next - reserve > 0 and frames.has(next):
			Lockstep.step_game(game, humans, frames[next])
			frames.erase(next)
			next += 1
			ran += 1
			if next % Lockstep.HASH_EVERY == 0:
				own_hashes[next] = Lockstep.state_hash(game)
				_check_hash(next)
		acc = maxf(0.0, acc - ran * Lockstep.TICK)
		if ran < budget:
			acc = 0.0
			stall_len += dt
			return false
		if stall_len > 0.0:
			# Short, repeated waits mean bumpy delivery -> hold back one more frame.
			if stall_len < 0.5:
				starved += stall_len
				if starved > 0.2 and reserve < 6:
					reserve += 1
					starved = 0.0
			stall_len = 0.0
			smooth = 0.0
		smooth += dt
		if smooth > 3.0:
			starved = 0.0
		if smooth > 10.0 and reserve > 1:
			reserve -= 1
			smooth = 0.0
		return true

	func _check_hash(tick: int) -> void:
		if not host_hashes.has(tick) or not own_hashes.has(tick):
			return
		if host_hashes[tick] != own_hashes[tick]:
			desynced = true
		host_hashes.erase(tick)
		own_hashes.erase(tick)

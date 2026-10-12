class_name RemoteRound
extends RefCounted
## An online client's own copy of the current round (port of net/remoteround.js).
##
## When the host starts a round, the client builds the same minigame from the
## same seed and roster, renders it itself and simulates it from the host's
## lockstep input frames. Menus, the briefing, the countdown and results stay
## mirrored from the host; the in-round HUD is drawn locally (in this device's
## language). If the local copy ever disagrees with the host's checksum, the
## client tells the host and keeps playing: the host's copy decides the results.

const NEED_RETRY := 0.3   # ask for missing frames at most this often

var app
var send: Callable        # func(msg) -> control message to the host
var on_end: Callable      # show the backdrop again
var on_sync: Callable     # func(desynced: bool)
var game: Minigame = null
var follower: Lockstep.Follower = null
var info = null           # the host's "round" message
var _need_t := 0.0
var _desync_sent := false


func _init(app_in, send_fn: Callable, end_fn: Callable, sync_fn: Callable) -> void:
	app = app_in
	send = send_fn
	on_end = end_fn
	on_sync = sync_fn


func active() -> bool:
	return game != null


## Host: a round begins - build it here from the same seed (shown behind the briefing).
func start(msg: Dictionary) -> void:
	end()
	var ok := int(msg.get("v", -1)) == Lockstep.PROTOCOL
	if ok:
		info = msg
		ok = _build(int(msg.get("seed", 0)))
	if not ok:
		push_warning("[net] cannot run round %s locally" % msg.get("id"))
		end()
	send.call({"t": "sim", "ok": ok})


## Host: briefing over - rebuild a fresh copy and wait for tick 0.
func prepare(msg: Dictionary) -> void:
	if info == null:
		return
	if not _build(int(msg.get("seed", 0))):
		end()
		return
	app.hud.set_players(game.seats)
	app.hud.visible = true
	follower = Lockstep.Follower.new(game)
	Haptics.round_active = true   # only our own subject's events vibrate now


func frames(pkt: Dictionary) -> void:
	if follower:
		follower.receive(pkt)


func fill(msg: Dictionary) -> void:
	if follower:
		follower.fill(int(msg.get("from", 0)), msg.get("f", []))


## Host: round over - back to the mirrored menus.
func end() -> void:
	Haptics.round_active = false
	var had := game != null
	if game:
		game.dispose()
	game = null
	follower = null
	info = null
	app.hud.clear()
	app.hud.visible = false
	if _desync_sent:
		_desync_sent = false
		on_sync.call(false)
	if had:
		on_end.call()


## Per rendered frame: preview animation, or lockstep ticks from the host's frames.
func update(dt: float) -> void:
	if game == null:
		return
	if follower == null:
		game.tick(dt)   # briefing preview (cosmetic; rebuilt before the round starts)
		return
	follower.update(dt)
	if follower.desynced and not _desync_sent:
		_desync_sent = true
		send.call({"t": "desync", "tick": follower.next})
		on_sync.call(true)
	_need_t -= dt
	var gap := follower.gap()
	if gap >= 0 and _need_t <= 0.0:
		_need_t = NEED_RETRY
		send.call({"t": "need", "from": gap})


func _build(seed_value: int) -> bool:
	var G = Registry.find(str(info.get("id", "")))
	if G == null:
		return false
	if game:
		game.dispose()
		game = null
	app.hud.clear()
	app.hud.visible = false
	Rng.seed_random(seed_value)
	var g: Minigame = G.new({"engine": app, "hud": app.hud, "players": _roster(),
		"bot_difficulty": float(info.get("bot", 0.6)), "lockstep": true})
	g.build()
	g.prewarm()
	g.state = "preview"
	app.set_scene(g, g.camera)
	game = g
	follower = null
	return true


## The host's roster as local Players: our seat is played here, the others are remote.
func _roster() -> Array:
	var me := "net%d" % int(info.get("me", 0))
	var out := []
	for d in info.get("players", []):
		var dev := str(d.get("device", "bot"))
		var mine := dev == me
		var device := "bot" if dev == "bot" else (("touch" if app.touch else "kb1") if mine else "remote")
		var p := Player.new(int(d.get("slot", 0)), device)
		p.look = (d.get("look", {}) as Dictionary).duplicate()
		p.look_index = (d.get("lookIndex", {}) as Dictionary).duplicate()
		p.remote = not mine and device != "bot"   # no commendations / haptics for other people's seats
		out.append(p)
	return out

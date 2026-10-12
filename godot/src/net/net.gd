extends Node
## Online play (autoload "Net"): hosting over Epic Online Services (port of
## net/host.js + the lockstep host).
##
## HOST ONLINE opens an EOS lobby with a 6-letter code. Friends choose JOIN
## ONLINE on their PC or phone, type the code and talk to this device
## peer-to-peer. Three P2P channels per player:
##   CTRL    reliable, ordered  menus (UI mirror snapshots), sounds, round control
##                              (round / prepare / fill / end), taps on mirrored menus
##   INPUT   unreliable         controller state {s, x, y, a, b, pa, pb}, pings
##   FRAMES  unreliable         lockstep input frames during a round
## Rounds run on every player's own device (lockstep.gd). Between rounds each
## client draws its own intake-room backdrop and mirrors the host's menus.
## Remote input drives a Controller "net<N>" (menus, lobby, briefing) and the
## lockstep frames (rounds). N is tied to the client's session token, so a
## player who drops out and reconnects gets their seat back.

const NO_INPUT := {"x": 0.0, "y": 0.0, "a": false, "b": false}
const RESEND_MAX := 120       # frames per resend message (gap repair)
const UI_SYNC := 0.05         # UI checks per second: 20 (only changes are sent)
const GRACE := 20.0           # a dropped player keeps their seat this long
const SILENT := 10.0          # nothing heard this long = connection lost
const INPUT_QUEUE := 8        # max buffered input changes per player
const FRAME_PACKET := 1100    # a frames message must fit one EOS packet (unreliable)

var link := EosLink.new()
var status := "offline"       # offline | connecting | hosting | error
var error := ""
var code := ""
var players := {}             # peer -> player dict (one per live connection)
var devices := {}             # client token -> device number N
var lost := {}                # device number -> time the link was lost
var lockstep := Lockstep.Host.new()
var client: NetClient = null  # set while this device plays as an online client
var _next_dev := 1
var _ui_t := 0.0
var _audio := []
var _in_sim_tick := false
var _off := []
var _chip: Label
var _chip_layer: CanvasLayer


func _ready() -> void:
	lockstep.sample = _sample
	lockstep.publish = send_frames
	lockstep.on_tick_begin = func(): _in_sim_tick = true
	lockstep.on_tick_end = func(): _in_sim_tick = false
	_chip_layer = CanvasLayer.new()
	_chip_layer.layer = 6
	add_child(_chip_layer)
	_chip = UI.label("", "vt", 2.4, UI.CRT, HORIZONTAL_ALIGNMENT_RIGHT)
	_chip.position = Vector2(1280 - UI.u(2) - 800, UI.u(1))
	_chip.size = Vector2(800, UI.u(3.5))
	_chip.visible = false
	_chip_layer.add_child(_chip)


func _now() -> float:
	return Time.get_ticks_msec() / 1000.0


func _app():
	return Main.app


# ============================================================== API for the game

func is_client() -> bool:
	return client != null


func has_remote_players() -> bool:
	return status == "hosting" and connected_count() > 0


func connected_count() -> int:
	var n := 0
	for p in players.values():
		if p.connected:
			n += 1
	return n


func host_status() -> String:
	return "hosting" if status == "hosting" else ("error" if status == "error" else "connecting")


func host_error() -> String:
	return error


func room_code() -> String:
	return code


func lockstep_active() -> bool:
	return lockstep.game != null


func lockstep_start(game: Minigame) -> void:
	lockstep.start(game)


func lockstep_stop() -> void:
	lockstep.stop()


func lockstep_update(dt: float) -> void:
	lockstep.update(dt)


func is_live(device: String) -> bool:
	var dev := int(device.substr(3))
	for p in players.values():
		if p.dev == dev and p.connected:
			return true
	return false


## Connected, or may still come back (grace period).
func is_connected_device(device: String) -> bool:
	if is_live(device):
		return true
	var dev := int(device.substr(3))
	return lost.has(dev) and _now() - float(lost[dev]) < GRACE


func run_client(app, room: String) -> void:
	client = NetClient.new(app, room, link)
	await client.run()
	client = null


# ================================================================= online rounds

## A round begins: every connected client builds the same simulation from `seed`.
func round_start(G, seed_value: int, roster: Array, bot: float) -> void:
	var list := roster.map(func(p): return {"slot": p.slot, "device": p.device, "look": p.look, "lookIndex": p.look_index})
	for p in players.values():
		if not p.connected:
			continue
		p.sim = "pending"
		_ctrl(p, {"t": "round", "v": Lockstep.PROTOCOL, "id": G.META.id, "seed": seed_value, "bot": bot, "me": p.dev, "players": list})


## After the briefing: everyone rebuilds a fresh copy from `seed` and waits for tick 0.
func round_prepare(seed_value: int) -> void:
	for p in players.values():
		if p.sim == "pending" or p.sim == "running":
			_ctrl(p, {"t": "prepare", "seed": seed_value})


## Publish the newest frames (the last HISTORY of them, in case packets get lost).
func send_frames(frames: Array, hash) -> void:
	var n := frames.size()
	var text := ""
	for keep in range(Lockstep.HISTORY, 0, -1):
		text = JSON.stringify({"n": n, "f": frames.slice(maxi(0, n - keep)), "h": hash})
		if text.length() <= FRAME_PACKET:
			break
	for p in players.values():
		if p.sim == "running" and p.connected:
			link.send(p.peer, EosLink.CH.FRAMES, EosLink.MODE.UNRELIABLE, text)


## The round is over: clients return to the mirrored menus.
func round_end() -> void:
	for p in players.values():
		if p.sim == null:
			continue
		_ctrl(p, {"t": "end"})
		p.sim = null


## Next input of an online seat for one lockstep tick (one queued change per tick).
func _take_input(device: String) -> Dictionary:
	var dev := int(device.substr(3))
	for p in players.values():
		if p.dev == dev and p.connected:
			return _next_input(p)
	return NO_INPUT


func _next_input(p: Dictionary) -> Dictionary:
	if not p.queue.is_empty():
		p.cur = p.queue.pop_front()
	return p.cur if p.cur != null else NO_INPUT


## Lockstep: current input of one human seat (local device or online player).
func _sample(device: String) -> Array:
	if device.begins_with("net"):
		var s := _take_input(device)
		return Lockstep.encode_input(s.x, s.y, s.a, s.b)
	var c: Controller = Inputs.controller(device)
	return Lockstep.encode_input(c.raw_x, c.raw_y, c.raw_a, c.raw_b)


# ====================================================================== the room

## Log in (if needed) and open the room.
func start_hosting() -> void:
	if status == "hosting" or status == "connecting":
		return
	status = "connecting"
	error = ""
	var r: Dictionary = await link.ready()
	if r.ok:
		r = await link.host()
	if status != "connecting":
		link.stop()   # closed again while opening
		return
	if not r.ok:
		status = "error"
		error = I18n.t("The online service is not reachable.") if str(r.get("message")) == "timeout" else str(r.get("message", ""))
		return
	code = str(r.code)
	_off = [link.on("msg", _on_message), link.on("peer-closed", func(e): _lost(str(e.get("peer", ""))))]
	Sfx.on_event = func(kind, n, opts):
		if connected_count() > 0:
			_audio.append([kind, n, opts, _in_sim_tick])
	status = "hosting"


## Close the room: tell every joined player, then drop all connections and the lobby.
func stop_hosting() -> void:
	if status == "offline":
		return
	for off in _off:
		off.call()
	_off = []
	for p in players.values():
		_ctrl(p, {"t": "closed"})
	link.flush()
	get_tree().create_timer(0.3).timeout.connect(func(): link.stop())
	for key in players.keys():
		_lost(key)
	players.clear()
	devices.clear()
	lost.clear()
	Sfx.on_event = Callable()
	_audio = []
	code = ""
	status = "offline"
	_chip.visible = false


## Once per frame, before Inputs.update(): network I/O, buffered remote input
## (one change per player per frame), queued sounds, UI mirror, room badge.
func pump() -> void:
	link.poll()
	if client:
		return
	if status != "hosting":
		_chip.visible = false
		return
	if not _audio.is_empty():
		var all := _audio
		_audio = []
		for p in players.values():
			if not p.connected:
				continue
			# Sounds of the simulation itself are made by each client's own copy of the round.
			var list := all.filter(func(a): return not a[3]) if p.sim == "running" else all
			if not list.is_empty():
				_ctrl(p, {"t": "audio", "l": list.map(func(a): return [a[0], a[1], a[2]])})
	if lockstep.game == null:
		for p in players.values():
			if p.queue.is_empty():
				continue
			var s := _next_input(p)
			var c: Controller = Inputs.controller("net%d" % p.dev)
			c.raw_x = s.x
			c.raw_y = s.y
			c.raw_a = s.a
			c.raw_b = s.b
	_ui_t -= get_process_delta_time()
	if _ui_t <= 0.0:
		_ui_t = UI_SYNC
		_sync_ui()
		_check_silence()
		_render_chip()


func _ctrl(p: Dictionary, msg: Dictionary) -> void:
	link.send(p.peer, EosLink.CH.CTRL, EosLink.MODE.ORDERED, msg)


func _on_message(e: Dictionary) -> void:
	var m = JSON.parse_string(str(e.get("data", "")))
	if not (m is Dictionary):
		return
	var peer := str(e.get("peer", ""))
	var ch := int(e.get("ch", -1))
	if ch == EosLink.CH.CTRL and m.get("t") == "hello":
		_hello(peer, m)
		return
	var p = players.get(peer)
	if p == null:
		# Someone we don't know (or forgot after a drop): ask them to say hello again.
		if ch == EosLink.CH.INPUT and m.get("t") != "ping":
			link.send(peer, EosLink.CH.CTRL, EosLink.MODE.ORDERED, {"t": "rehello"})
		return
	p.heard = _now()
	if ch == EosLink.CH.INPUT:
		_on_input(p, m)
	elif ch == EosLink.CH.CTRL:
		_on_sim_message(p, m)


## A client introduces itself (first contact, or again after a reconnect).
func _hello(peer: String, m: Dictionary) -> void:
	if int(m.get("v", -1)) != Lockstep.PROTOCOL:
		link.send(peer, EosLink.CH.CTRL, EosLink.MODE.ORDERED, {"t": "refused", "why": "version"})
		return
	var token := str(m.get("token", peer))
	if not devices.has(token):
		devices[token] = _next_dev
		_next_dev += 1
	var dev: int = devices[token]
	for k in players.keys():
		if players[k].dev == dev and k != peer:
			players.erase(k)   # a reconnecting player replaces their old, dead link
	lost.erase(dev)
	var p := {"peer": peer, "dev": dev, "connected": true, "heard": _now(), "last": {}, "ui_seq": 0,
		"seq": -1, "queue": [], "state": null, "cur": null, "press_a": 0, "press_b": 0, "rtt": null, "sim": null}
	players[peer] = p
	var msg := _ui_message(p)
	msg["t"] = "hello"
	msg["id"] = dev
	msg["n"] = dev
	_ctrl(p, msg)


## Round control messages from a client.
func _on_sim_message(p: Dictionary, m: Dictionary) -> void:
	match str(m.get("t", "")):
		"sim":
			if p.sim == "pending":
				p.sim = "running" if m.get("ok", false) else "off"
		"need":
			if p.sim == "running":
				var frames: Array = lockstep.frames
				var from := maxi(0, int(m.get("from", 0)))
				if from < frames.size():
					_ctrl(p, {"t": "fill", "from": from, "f": frames.slice(from, from + RESEND_MAX)})
		"tap":
			var app = _app()
			if app and app.remote_tap.is_valid():
				app.remote_tap.call("net%d" % p.dev, str(m.get("a", "")))
		"desync":
			push_warning("[net] player %d desynced at tick %s" % [p.dev, m.get("tick")])
		"bye":
			_lost(p.peer)


func _check_silence() -> void:
	var now := _now()
	for p in players.values().duplicate():
		if now - float(p.heard) > SILENT:
			_lost(p.peer)


## A link died: free its input and start the seat's grace period.
func _lost(key: String) -> void:
	var p = players.get(key)
	if p == null:
		return
	players.erase(key)
	for o in players.values():
		if o.dev == p.dev:
			return
	lost[p.dev] = _now()
	if Inputs.controllers.has("net%d" % p.dev):
		Inputs.controllers["net%d" % p.dev].reset()


## Controller packet {s, x, y, a, b, pa, pb}: s = sequence number, pa/pb = A/B
## presses so far (a press whose packets were all lost is re-created).
## {t: "ping", c} is answered right away (the client shows its ping).
func _on_input(p: Dictionary, s: Dictionary) -> void:
	if s.get("t") == "ping":
		link.send(p.peer, EosLink.CH.INPUT, EosLink.MODE.UNRELIABLE, {"t": "pong", "c": s.get("c")})
		if s.get("r") != null:
			p.rtt = s.r
		return
	var seq := int(s.get("s", -1))
	if seq <= int(p.seq):
		return   # out of order: never let an older packet overwrite a newer one
	var first: bool = p.seq < 0
	p.seq = seq
	var st := {"x": clampf(float(s.get("x", 0.0)), -1, 1), "y": clampf(float(s.get("y", 0.0)), -1, 1), "a": bool(s.get("a", false)), "b": bool(s.get("b", false))}
	var pa := int(s.get("pa", 0))
	var pb := int(s.get("pb", 0))
	if first:
		p.press_a = pa - (1 if st.a else 0)
		p.press_b = pb - (1 if st.b else 0)
	var prev: Dictionary = p.queue[-1] if not p.queue.is_empty() else (p.state if p.state != null else NO_INPUT)
	# Lost presses: replay one press + release before the current state.
	if pa - (1 if st.a and not prev.a else 0) > int(p.press_a) and not st.a:
		_queue(p, _with(prev, "a", true))
		_queue(p, _with(prev, "a", false))
	if pb - (1 if st.b and not prev.b else 0) > int(p.press_b) and not st.b:
		_queue(p, _with(prev, "b", true))
		_queue(p, _with(prev, "b", false))
	p.press_a = pa
	p.press_b = pb
	_queue(p, st)


static func _with(d: Dictionary, k: String, v) -> Dictionary:
	var o := d.duplicate()
	o[k] = v
	return o


func _queue(p: Dictionary, st: Dictionary) -> void:
	var prev = p.queue[-1] if not p.queue.is_empty() else p.state
	if prev != null and prev.x == st.x and prev.y == st.y and prev.a == st.a and prev.b == st.b:
		return
	p.queue.append(st)
	p.state = st
	while p.queue.size() > INPUT_QUEUE:
		p.queue.pop_front()   # never build up lag


# ===================================================================== UI mirror

func _ui_message(p: Dictionary) -> Dictionary:
	var app = _app()
	var msg := {"s": p.ui_seq + 1}
	p.ui_seq += 1
	var ov = UiMirror.delta(UiMirror.capture(app.overlay), _part(p, "ov"))
	if ov != null:
		msg["ov"] = ov
	var toasts = UiMirror.delta(UiMirror.capture(app.toast_layer), _part(p, "toasts"))
	if toasts != null:
		msg["toasts"] = toasts
	var cls: String = app.overlay_cls
	if p.last.get("cls") != cls:
		p.last["cls"] = cls
		msg["cls"] = cls
	var bd: Dictionary = app.backdrop.get_state()
	var bd_text := JSON.stringify(bd)
	if p.last.get("bd") != bd_text:
		p.last["bd"] = bd_text
		msg["bd"] = bd
	return msg


func _part(p: Dictionary, key: String) -> Dictionary:
	if not p.last.has(key):
		p.last[key] = {}
	return p.last[key]


## Send each player only the UI parts that changed since what they last received.
func _sync_ui() -> void:
	if connected_count() == 0:
		return
	for p in players.values():
		if not p.connected:
			continue
		var msg := _ui_message(p)
		if msg.size() > 1:
			msg["t"] = "ui"
			_ctrl(p, msg)
		else:
			p.ui_seq -= 1


## Corner badge on the host's menus: the join code stays visible after HOST ONLINE.
func _render_chip() -> void:
	var app = _app()
	var show: bool = status == "hosting" and app != null and app.game == null and not app.overlay.has_meta("online_code")
	_chip.visible = show
	if show:
		var txt := "● %s %s" % [I18n.t("ROOM CODE"), code]
		for p in players.values():
			if p.connected:
				txt += "   P%d%s" % [p.dev, (" %d ms" % int(p.rtt)) if p.rtt != null else ""]
		_chip.text = txt

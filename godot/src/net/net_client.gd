class_name NetClient
extends RefCounted
## The remote-player side of online play (port of net/client.js).
##
## JOIN ONLINE finds the host's EOS lobby by its code and talks to the host
## peer-to-peer. Rounds run on this device (remote_round.gd); between rounds it
## draws its own intake-room backdrop (the host says who stands where) and
## mirrors the host's menus (ui_mirror.gd) and sounds. This device's controls
## go to the host every frame they change (plus heartbeats); every local device
## works (keyboard halves, gamepads, touch) and they are merged into one.
## If the connection drops the client keeps knocking; a session token tells the
## host it is the same player, so they get their seat back.

const HEARTBEAT := 0.1        # resend the controller state at least this often
const REPEAT := 2             # extra copies of every change (input packets may get lost)
const PING := 1.0
const HELLO_RETRY := 3.0      # knock again while the host hasn't answered
const FIRST_CONTACT := 30.0
const SILENT := 4.0           # nothing from the host this long = connection lost
const GIVE_UP := 60.0         # ...and this long = give up
const JOIN_TRIES := 5         # room searches before "does not exist"
const DEVICES := ["kb1", "kb2", "pad0", "pad1", "pad2", "pad3", "touch"]

static var _tokens := {}      # room code -> session token (reclaims the seat on reconnects)

var app
var code: String
var link: EosLink
var host := ""
var remote: RemoteRound
var view: UiMirror.View
var toast_view: UiMirror.View
var mirror_root: Control
var toast_root: Control
var net_info: Label
var token: String
var welcomed := false
var finished := false
var leaving := false
var done := false
var badge_shown := false
var lost_shown := false
var desynced := false
var ping := -1
var _seq := 0
var _last := ""
var _last_sent := 0.0
var _repeat := 0
var _press_a := 0
var _press_b := 0
var _prev_a := false
var _prev_b := false
var _last_ping := 0.0
var _hello_at := 0.0
var _last_heard := 0.0
var _first_at := 0.0
var _back_armed := -10.0
var _finish_press := 0
var _off := []


func _init(app_in, room: String, link_in: EosLink) -> void:
	app = app_in
	code = room
	link = link_in


func _now() -> float:
	return Time.get_ticks_msec() / 1000.0


func t(s: String, vars: Dictionary = {}) -> String:
	return I18n.t(s, vars)


## Join the room and play as a remote subject until the room closes or the player leaves.
func run() -> void:
	_setup()
	var frame_off: Callable = app.on_frame(_frame)
	_status(t("CONNECTING"), t("Contacting the facility…"))
	var r: Dictionary = await link.ready()
	if r.ok:
		var attempt := 1
		while not leaving:
			r = await link.join(code)
			# A room opened moments ago may not be searchable yet: ask again a few times.
			if r.ok or int(r.get("code", -1)) != EosLink.NOT_FOUND or attempt >= JOIN_TRIES:
				break
			attempt += 1
			await app.get_tree().create_timer(1.5).timeout
	if leaving:
		pass
	elif not r.ok:
		if int(r.get("code", -1)) == EosLink.NOT_FOUND:
			_finish(t("NO CONNECTION"), t("Room {code} does not exist.", {"code": code}))
		else:
			_finish(t("NO CONNECTION"), t("The online service is not reachable.") if str(r.get("message")) == "timeout" else str(r.get("message", "")))
	else:
		host = str(r.host)
		_status(t("CONNECTING"), t("Linking up with the host…"))
		if not _tokens.has(code):
			_tokens[code] = "%x%x" % [randi(), Time.get_ticks_usec()]
		token = _tokens[code]
		_first_at = _now()
		_last_heard = _now()
		_off.append(link.on("msg", _on_msg))
		_hello()
	while not done:
		await app.get_tree().process_frame
	frame_off.call()
	_teardown()


func _setup() -> void:
	for d in DEVICES:
		Inputs.controller(d)
	app.players = []
	app.show_backdrop()
	app.backdrop.mode = "lobby"
	for i in Player.MAX_PLAYERS:
		app.backdrop.set_slot(i, null)
	# The host's menus are drawn under our own status panels (app.overlay).
	mirror_root = Control.new()
	mirror_root.name = "Mirror"
	mirror_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	mirror_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	app.overlay_layer.add_child(mirror_root)
	app.overlay_layer.move_child(mirror_root, app.overlay.get_index())
	toast_root = Control.new()
	toast_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	toast_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	app.toast_layer.add_child(toast_root)
	view = UiMirror.View.new(mirror_root, _tap)
	toast_view = UiMirror.View.new(toast_root, _tap)
	net_info = UI.label("", "vt", 2.4, UI.CRT, HORIZONTAL_ALIGNMENT_LEFT)
	net_info.position = Vector2(UI.u(2), UI.u(1))
	net_info.size = Vector2(700, UI.u(3.5))
	net_info.visible = false
	app.toast_layer.add_child(net_info)
	remote = RemoteRound.new(app, _send_ctrl, _on_round_end, func(d):
		desynced = d
		_show_ping())
	if app.touch:
		app.touch.show_pause = false   # pausing is the host's call
		app.touch.set_context("menu")
	Sfx.music("none")


func _teardown() -> void:
	for off in _off:
		off.call()
	_off.clear()
	remote.end()
	link.stop()
	for n in [mirror_root, toast_root, net_info]:
		if is_instance_valid(n):
			n.queue_free()
	app.clear_overlay()
	if app.touch:
		app.touch.show_pause = true
		app.touch.set_context("")
	app.show_backdrop()
	for c in Inputs.controllers.values():
		c.reset()


func _send_ctrl(m: Dictionary) -> void:
	if host != "":
		link.send(host, EosLink.CH.CTRL, EosLink.MODE.ORDERED, m)


func _hello() -> void:
	_hello_at = _now()
	_send_ctrl({"t": "hello", "token": token, "v": Lockstep.PROTOCOL})


func _tap(action: String) -> void:
	if host != "" and welcomed and not finished and not remote.active():
		_send_ctrl({"t": "tap", "a": action})


func _on_round_end() -> void:
	app.show_backdrop()
	if app.touch and not finished:
		app.touch.set_context("menu")


## Our own status panel (connecting, closed...) with a way back to the main menu.
func _status(title: String, body: String = "") -> void:
	var p := UI.panel({"width_frac": 0.55})
	p.body.add_child(UI.label(title, "ops", 6.4, UI.BONE))
	var b := UI.rich(body, "elite", 2.6, UI.BONE)
	b.custom_minimum_size.x = 600
	p.body.add_child(b)
	var back := UI.tap_btn(t("BACK TO MAIN MENU"), true)
	back.pressed.connect(_leave)
	p.body.add_child(UI.hbox([back]))
	var hint := UI.rich("%s %s · %s" % [t("ROOM CODE"), code, I18n.tp("{BACK} leave")], "vt", 2.6, UI.BONE_DIM)
	hint.custom_minimum_size.x = 600
	p.body.add_child(hint)
	app.set_overlay(UI.center(p.root), "dim")


func _show_ping() -> void:
	net_info.visible = ping >= 0
	net_info.add_theme_color_override("font_color", UI.RED if desynced or ping > 150 else UI.CRT)
	net_info.text = "" if ping < 0 else ("PING %d ms%s" % [ping, (" · " + t("OUT OF SYNC")) if desynced else ""])


func _toast(text: String) -> void:
	var l := UI.rich(text, "vt", 2.8, UI.HAZARD)
	l.custom_minimum_size.x = 1000
	l.position = Vector2(140, UI.u(11))
	app.toast_layer.add_child(l)
	var tw := l.create_tween()
	tw.tween_interval(5.0)
	tw.tween_property(l, "modulate:a", 0.0, 1.0)
	tw.tween_callback(l.queue_free)


func _leave() -> void:
	if leaving:
		return
	leaving = true
	_send_ctrl({"t": "bye"})
	link.flush()
	app.get_tree().create_timer(0.15).timeout.connect(func(): done = true)


func _finish(title: String, body: String) -> void:
	finished = true
	_finish_press = _press_a
	remote.end()
	view.clear()
	toast_view.clear()
	if app.touch:
		app.touch.set_context("")   # only the BACK TO MAIN MENU button now
	_status(title, body)
	link.stop()


# ------------------------------------------------------------------ per frame

func _frame(dt: float) -> void:
	if remote.active():
		remote.update(dt)
	# Merge every local device into one remote controller.
	var x := 0.0
	var y := 0.0
	var a := false
	var b := false
	for d in DEVICES:
		var c: Controller = Inputs.controllers.get(d)
		if c == null:
			continue
		if absf(c.move_x) > absf(x):
			x = c.move_x
		if absf(c.move_y) > absf(y):
			y = c.move_y
		a = a or c.a
		b = b or c.b
	if a and not _prev_a:
		_press_a += 1
	if b and not _prev_b:
		_press_b += 1
	_prev_a = a
	_prev_b = b
	if finished and _press_a > _finish_press:
		_leave()   # A / F / Enter = BACK TO MAIN MENU
		return
	if Inputs.key_pressed("Escape"):
		# Leaving: Esc / the phone's back button twice.
		if finished or _now() - _back_armed < 2.5:
			_leave()
			return
		_back_armed = _now()
		_toast(t("PRESS BACK AGAIN TO LEAVE THE ROOM"))
	_watchdog()
	if host == "" or not welcomed or finished:
		return
	var now := _now()
	if now - _last_ping > PING:
		_last_ping = now
		link.send(host, EosLink.CH.INPUT, EosLink.MODE.UNRELIABLE, {"t": "ping", "c": now, "r": ping if ping >= 0 else null})
	var state := "%.2f,%.2f,%s,%s" % [x, y, a, b]
	if state != _last:
		_repeat = REPEAT + 1
	elif _repeat <= 0 and now - _last_sent < HEARTBEAT:
		return
	_seq += 1
	link.send(host, EosLink.CH.INPUT, EosLink.MODE.UNRELIABLE, {"s": _seq, "x": snappedf(x, 0.01), "y": snappedf(y, 0.01), "a": a, "b": b, "pa": _press_a, "pb": _press_b})
	_repeat -= 1
	_last = state
	_last_sent = now


## Knock until the host answers; notice when it goes quiet.
func _watchdog() -> void:
	if finished or host == "":
		return
	var now := _now()
	if not badge_shown:
		if now - _first_at > FIRST_CONTACT:
			_finish(t("NO CONNECTION"), t("The host did not answer."))
		elif now - _hello_at > HELLO_RETRY:
			_hello()
		return
	var quiet := now - _last_heard
	if quiet > SILENT:
		if quiet > GIVE_UP:
			_finish(t("DISCONNECTED"), t("The connection to the host was lost."))
			return
		if not lost_shown:
			lost_shown = true
			remote.end()
			_status(t("RECONNECTING…"), t("The connection to the host was lost."))
		if now - _hello_at > HELLO_RETRY:
			welcomed = false
			_hello()
	elif lost_shown:
		lost_shown = false
		app.set_overlay(null, app.overlay_cls)


# ------------------------------------------------------------------ messages

func _on_msg(e: Dictionary) -> void:
	if str(e.get("peer", "")) != host or finished:
		return
	var m = JSON.parse_string(str(e.get("data", "")))
	if not (m is Dictionary):
		return
	_last_heard = _now()
	if int(e.get("ch", -1)) == EosLink.CH.FRAMES:
		remote.frames(m)
		return
	match str(m.get("t", "")):
		"pong":
			ping = roundi((_now() - float(m.get("c", _now()))) * 1000.0)
			_show_ping()
		"hello":
			welcomed = true
			_last = ""   # resend our controller state right away
			app.set_overlay(null, "")
			if not badge_shown:
				badge_shown = true
				_toast(I18n.tp("ONLINE · PLAYER {n} · PRESS {A} IN THE LOBBY TO JOIN", {"n": int(m.get("n", m.get("id", 0)))}))
				if str(app.args.get("nettest", "")) == "client":
					_test_taps()
			_apply_ui(m)
		"ui":
			_apply_ui(m)
		"audio":
			for item in m.get("l", []):
				if item[0] == "sfx":
					Sfx.play(str(item[1]), item[2] if item[2] is Dictionary else {})
				elif item[0] == "music":
					Sfx.music(str(item[1]))
		"round":
			remote.start(m)
		"prepare":   # briefing over: the round starts, so the joystick appears
			remote.prepare(m)
			if app.touch:
				app.touch.set_context("play")
		"fill":
			remote.fill(m)
		"end":
			if str(app.args.get("nettest", "")) == "client" and remote.follower:
				print("NETTEST client round end ticks=", remote.follower.next, " desynced=", remote.follower.desynced, " reserve=", remote.follower.reserve)
			remote.end()
			if app.touch:
				app.touch.set_context("menu")
		"rehello":
			welcomed = false
			_hello()
		"refused":
			_finish(t("NO CONNECTION"), t("The host runs a different version of the game."))
		"closed":
			_finish(t("ROOM CLOSED"), t("The host closed the room."))
			if str(app.args.get("nettest", "")) == "client":
				print("NETTEST client: room closed")
				app.get_tree().create_timer(1.0).timeout.connect(func(): app.get_tree().quit())


## Online test (--nettest=client): take seat 2 in the host's lobby by tapping
## the mirrored card, ready up, and screenshot the mirrored lobby.
func _test_taps() -> void:
	var tree: SceneTree = app.get_tree()
	await tree.create_timer(2.5).timeout
	_tap("join:1")
	await tree.create_timer(1.5).timeout
	_tap("inc:1:suit")
	await tree.create_timer(1.0).timeout
	await app.snap("user://nettest_client_lobby.png")
	_tap("ready:1")


## Mirror host UI parts.
func _apply_ui(m: Dictionary) -> void:
	if m.has("ov"):
		view.apply(m.ov)
	if m.has("toasts"):
		toast_view.apply(m.toasts)
	if m.has("cls"):
		app.set_overlay_class(str(m.cls))
	if m.has("bd") and m.bd is Dictionary:
		app.backdrop.apply_state(m.bd)

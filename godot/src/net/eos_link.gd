class_name EosLink
extends RefCounted
## The game's link to Epic Online Services (port of net/eos.js).
##
## EOS is a native SDK, so each platform has a small bridge with the same
## command set:
##   Windows  eos_sidecar.py / eos/tss_eos.exe (eos_bridge.py: Python + ctypes),
##            started by the game, talking JSON lines over a localhost socket
##   Android  the TssEos Godot plugin (EosBridge.java + libtss_eos.so, JNI)
##
## Commands: host, join(code), send([[peer, channel, mode, text], ...]), stop.
## Events: ready, hosted {code}, joined {host}, peer-open {peer},
## peer-closed {peer}, msg {peer, ch, data}, error {op, code, message}.
##
## Players log in anonymously (EOS Connect device ID: no Epic account). A room
## is an EOS lobby tagged with a 6-letter code; the joiner looks it up and talks
## to the lobby owner peer-to-peer (through Epic's relays when needed).
## Messages of any size are fine: the bridges split and reassemble them.

const CH := {"CTRL": 0, "INPUT": 1, "FRAMES": 2}
const MODE := {"UNRELIABLE": 0, "RELIABLE": 1, "ORDERED": 2}
const CODE_ALPHABET := "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"   # no 0/O/1/I
const NOT_FOUND := 18                                        # EOS_NotFound

var kind := ""                # "" (not started) | android | desktop | none
var listeners := {}           # event type -> Array[Callable]
var _outbox := []
var _status := {"state": "idle", "user": null, "code": null, "message": null}
var _android = null
var _server: TCPServer
var _sock: StreamPeerTCP
var _pid := -1
var _buf := PackedByteArray()
var _queued_cmds := []        # commands sent before the sidecar connected
var _started_at := 0.0


## Normalise a typed room code; "" unless it is 6 valid symbols.
static func parse_room_code(text: String) -> String:
	var clean := ""
	for ch in text.to_upper():
		if ch in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789":
			clean += ch
	if clean.length() != 6:
		return ""
	for ch in clean:
		if CODE_ALPHABET.find(ch) < 0:
			return ""
	return clean


func _tree() -> SceneTree:
	return Engine.get_main_loop() as SceneTree


func _unavailable(why: String) -> void:
	kind = "none"
	_status = {"state": "unavailable", "user": null, "code": null, "message": why}


func _ensure_started() -> void:
	if kind != "":
		return
	if Engine.has_singleton("TssEos"):
		kind = "android"
		_android = Engine.get_singleton("TssEos")
		return
	if OS.get_name() != "Windows":
		_unavailable("online play is not available on this platform")
		return
	var cmd := _sidecar_command()
	if cmd.is_empty():
		_unavailable("online play is not included in this build")
		return
	_server = TCPServer.new()
	if _server.listen(0, "127.0.0.1") != OK:
		_unavailable("could not open a local port for online play")
		return
	var data_dir := ProjectSettings.globalize_path("user://eos")
	var args: Array = cmd.args + ["--connect", str(_server.get_local_port()), "--data", data_dir]
	if "--eos-fresh" in OS.get_cmdline_user_args():
		args.append("--fresh")
	_pid = OS.create_process(cmd.exe, PackedStringArray(args))
	if _pid <= 0:
		_unavailable("the online helper could not be started")
		return
	kind = "desktop"
	_started_at = Time.get_ticks_msec() / 1000.0
	_status = {"state": "starting", "user": null, "code": null, "message": null}


## Release: <game>/eos/tss_eos.exe (+ SDK dll + config). Editor runs: python + the repository's eos_sidecar.py.
func _sidecar_command() -> Dictionary:
	var packaged := OS.get_executable_path().get_base_dir().path_join("eos/tss_eos.exe")
	if FileAccess.file_exists(packaged):
		return {"exe": packaged, "args": []}
	if OS.has_feature("editor"):
		var script := ProjectSettings.globalize_path("res://").path_join("../eos_sidecar.py").simplify_path()
		if FileAccess.file_exists(script):
			return {"exe": "python", "args": [script]}
	return {}


## Subscribe to an event type ("msg", "peer-closed", ...); returns an unsubscribe Callable.
func on(type: String, fn: Callable) -> Callable:
	if not listeners.has(type):
		listeners[type] = []
	var entry := [fn]
	listeners[type].append(entry)
	return func():
		if listeners.has(type):
			listeners[type].erase(entry)


func _deliver(batch: Array) -> void:
	for e in batch:
		if not (e is Dictionary):
			continue
		if e.get("type") == "hosted":
			_status.code = e.get("code")
		for entry in (listeners.get(e.get("type", ""), []) as Array).duplicate():
			entry[0].call(e)


## Once per frame (Net.pump): read the bridge, deliver events, send the outbox.
func poll() -> void:
	if kind == "desktop":
		_poll_sidecar()
	elif kind == "android":
		var s: String = _android.poll()
		if s != "":
			var batch = JSON.parse_string(s)
			if batch is Array:
				_deliver(batch)
	flush()


func _poll_sidecar() -> void:
	if _sock == null:
		if _server and _server.is_connection_available():
			_sock = _server.take_connection()
			_server.stop()
			for c in _queued_cmds:
				_write(c)
			_queued_cmds.clear()
		elif Time.get_ticks_msec() / 1000.0 - _started_at > 20.0 and _status.state == "starting":
			_status = {"state": "error", "user": null, "code": null, "message": "the online helper did not start"}
		return
	_sock.poll()
	if _sock.get_status() != StreamPeerTCP.STATUS_CONNECTED:
		if _status.state != "error":
			_status = {"state": "error", "user": null, "code": null, "message": "the online helper stopped"}
		return
	var n := _sock.get_available_bytes()
	if n > 0:
		var got: Array = _sock.get_data(n)
		if got[0] == OK:
			_buf.append_array(got[1])
	while true:
		var nl := _buf.find(10)
		if nl < 0:
			break
		var line := _buf.slice(0, nl).get_string_from_utf8()
		_buf = _buf.slice(nl + 1)
		var m = JSON.parse_string(line)
		if not (m is Dictionary):
			continue
		if m.has("status"):
			_status = m.status
		elif m.has("ev"):
			_deliver(m.ev)
		elif m.has("log") and OS.is_debug_build():
			print("[eos] ", m.log)


func _write(cmd: Dictionary) -> void:
	if kind != "desktop":
		return
	if _sock == null:
		_queued_cmds.append(cmd)
		return
	_sock.put_data((JSON.stringify(cmd) + "\n").to_utf8_buffer())


func _call(op: String, arg = null) -> void:
	_ensure_started()
	if kind == "desktop":
		_write({"op": op, "arg": arg})
	elif kind == "android":
		match op:
			"host": _android.host()
			"join": _android.join(str(arg))
			"send": _android.send(JSON.stringify(arg))
			"stop": _android.stop()


## {state: starting | ready | error | unavailable, user, code, message}
func status() -> Dictionary:
	_ensure_started()
	if kind == "android":
		var s = JSON.parse_string(_android.status())
		return s if s is Dictionary else {"state": "error", "message": "bad status"}
	return _status


## Waits until logged in to EOS. Returns {ok, message}.
func ready(timeout: float = 20.0) -> Dictionary:
	var end := Time.get_ticks_msec() / 1000.0 + timeout
	while true:
		poll()
		var s := status()
		if s.get("state") == "ready":
			return {"ok": true}
		if s.get("state") == "error" or s.get("state") == "unavailable":
			return {"ok": false, "message": str(s.get("message", s.get("state")))}
		if Time.get_ticks_msec() / 1000.0 > end:
			return {"ok": false, "message": "timeout"}
		await _tree().process_frame
	return {"ok": false}


## Wait for one event of `type` (or an "error" for operation `op`): {ok, e} or {ok: false, message, code}.
func _await(type: String, op: String, timeout: float) -> Dictionary:
	var box := {"res": null}
	var off_ok := on(type, func(e):
		if box.res == null:
			box.res = {"ok": true, "e": e})
	var off_err := on("error", func(e):
		if box.res == null and e.get("op") == op:
			box.res = {"ok": false, "message": str(e.get("message", "")), "code": int(e.get("code", -1))})
	var end := Time.get_ticks_msec() / 1000.0 + timeout
	while box.res == null and Time.get_ticks_msec() / 1000.0 < end:
		await _tree().process_frame
		poll()
	off_ok.call()
	off_err.call()
	return box.res if box.res != null else {"ok": false, "message": "timeout", "code": -1}


## Open a room: {ok, code} or {ok: false, message}.
func host() -> Dictionary:
	_call("host")
	var r := await _await("hosted", "host", 20.0)
	if r.ok:
		r["code"] = str(r.e.get("code", ""))
	return r


## Find a room by code: {ok, host} or {ok: false, message, code}.
func join(code: String) -> Dictionary:
	_call("join", code)
	var r := await _await("joined", "join", 20.0)
	if r.ok:
		r["host"] = str(r.e.get("host", ""))
	return r


## Queue a message (everything queued in a frame goes out in one bridge call).
func send(peer: String, channel: int, mode: int, msg) -> void:
	_outbox.append([peer, channel, mode, msg if msg is String else JSON.stringify(msg)])


func flush() -> void:
	if _outbox.is_empty() or kind == "" or kind == "none":
		return
	var batch := _outbox
	_outbox = []
	_call("send", batch)


## Leave / close the room and drop every connection.
func stop() -> void:
	flush()
	_status.code = null
	if kind != "" and kind != "none":
		_call("stop")

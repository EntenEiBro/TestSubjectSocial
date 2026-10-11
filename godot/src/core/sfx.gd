extends Node
## Sound (autoload "Sfx"): synthesized effects and looping music beds,
## rendered to WAV by tools/make_sounds.py.
##
##   Sfx.play("clank")             Sfx.play("shot", {"vol": 0.5})
##   Sfx.music("menu" | "tension" | "none")
##   Sfx.set_volume("master" | "music" | "sfx", 0..1)

var on_haptic: Callable = Callable()   # func(sfx_name) — phones vibrate along with menu sounds
var on_event: Callable = Callable()    # func(kind, name, opts) — mirrored to online players

var _streams := {}
var _pool: Array[AudioStreamPlayer] = []
var _next := 0
var _music_a: AudioStreamPlayer
var _music_b: AudioStreamPlayer
var _music_style := ""
var _fade := 0.0
var volume := {"master": 0.8, "music": 0.5, "sfx": 0.9}


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for bus_name in ["Music", "SFX"]:
		if AudioServer.get_bus_index(bus_name) < 0:
			AudioServer.add_bus()
			var idx := AudioServer.bus_count - 1
			AudioServer.set_bus_name(idx, bus_name)
			AudioServer.set_bus_send(idx, "Master")
	for i in 20:
		var p := AudioStreamPlayer.new()
		p.bus = "SFX"
		add_child(p)
		_pool.append(p)
	_music_a = AudioStreamPlayer.new()
	_music_b = AudioStreamPlayer.new()
	for m in [_music_a, _music_b]:
		m.bus = "Music"
		m.volume_db = -80.0
		add_child(m)
	for k in volume:
		set_volume(k, volume[k])


func _stream(sfx_name: String, dir: String = "sfx") -> AudioStream:
	var key := dir + "/" + sfx_name
	if not _streams.has(key):
		var path := "res://assets/%s/%s.wav" % [dir, sfx_name]
		_streams[key] = load(path) if ResourceLoader.exists(path) else null
	return _streams[key]


func set_volume(kind: String, v: float) -> void:
	volume[kind] = v
	var bus := {"master": "Master", "music": "Music", "sfx": "SFX"}[kind] as String
	var idx := AudioServer.get_bus_index(bus)
	if idx >= 0:
		AudioServer.set_bus_volume_db(idx, linear_to_db(max(v, 0.0001)))
		AudioServer.set_bus_mute(idx, v <= 0.001)


## Play a named sound effect. opts: vol (1.0). Unknown names are ignored.
func play(sfx_name: String, opts: Dictionary = {}) -> void:
	if on_event.is_valid():
		on_event.call("sfx", sfx_name, opts)
	if on_haptic.is_valid():
		on_haptic.call(sfx_name)
	var s := _stream(sfx_name)
	if s == null:
		return
	var p := _pool[_next]
	_next = (_next + 1) % _pool.size()
	p.stream = s
	p.volume_db = linear_to_db(max(float(opts.get("vol", 1.0)), 0.0001))
	p.pitch_scale = 1.0
	p.play()


## Start a looping music bed: "menu", "tension" or "none" (crossfades).
func music(style: String) -> void:
	if on_event.is_valid():
		on_event.call("music", style, {})
	if style == _music_style:
		return
	_music_style = style
	var tmp := _music_a
	_music_a = _music_b
	_music_b = tmp
	if style != "none":
		var s := _stream(style, "music")
		if s is AudioStreamWAV:
			var w: AudioStreamWAV = s
			w.loop_mode = AudioStreamWAV.LOOP_FORWARD
			w.loop_begin = 0
			w.loop_end = w.data.size() / 2
		_music_a.stream = s
		_music_a.volume_db = -60.0
		_music_a.play()
	_fade = 1.0


func _process(delta: float) -> void:
	if _fade <= 0.0:
		return
	_fade = max(0.0, _fade - delta / 1.2)
	var k := 1.0 - _fade
	if _music_a.playing:
		_music_a.volume_db = linear_to_db(max(k, 0.0001))
	if _music_b.playing:
		_music_b.volume_db = linear_to_db(max(1.0 - k, 0.0001))
		if _fade <= 0.0:
			_music_b.stop()


## Silence everything (app sent to the background) / continue.
func suspend() -> void:
	AudioServer.set_bus_mute(0, true)


func resume() -> void:
	AudioServer.set_bus_mute(0, volume.master <= 0.001)

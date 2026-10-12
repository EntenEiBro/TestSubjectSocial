@tool
extends EditorPlugin
## LIVE FOLLOW: makes the build visible in the open editor while scripts and
## tools work on the project from outside.
##
##  * Scripts that change on disk open in the script editor (throttled, so a
##    burst of edits doesn't flicker).
##  * Asset imports are done HERE (the progress bar shows), on request from
##    tools/import.ps1, so only one importer ever writes .godot/imported.
##  * Freshly imported Blender props turn on a preview stage in the 3D view.
##  * tools/play.ps1 runs the game with the editor's Play button (queued).
##
## Requests are files in res://.live/ (a .gdignore keeps the importer out):
##   .live/import/<id>      -> rescan + import, then .live/done/<id>
##   .live/play/<id>.json   {"args": "...", "timeout": 60} -> play, then .live/done/<id>

const LIVE := "res://.live"
const PREVIEW_SCENE := "res://tools/live_preview.tscn"
const SCRIPT_HOLD := 3.0     # seconds a script stays in view before the next one
const PROP_HOLD := 10.0      # seconds the prop preview keeps the 3D view

var _timer: Timer
var _mtimes := {}
var _prop_mtimes := {}
var _pending_prop := ""
var _primed := false
var _pending_script := ""
var _view_until := 0.0
var _import_waiters := []
var _import_started := -1.0
var _play_queue := []
var _playing = null
var _play_started := 0.0


func _enter_tree() -> void:
	# Only the visible editor serves requests (headless exports / imports load plugins too).
	if DisplayServer.get_name() == "headless":
		return
	for sub in ["import", "play", "done"]:
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(LIVE + "/" + sub))
	var ignore := ProjectSettings.globalize_path(LIVE + "/.gdignore")
	if not FileAccess.file_exists(ignore):
		FileAccess.open(ignore, FileAccess.WRITE).store_string("")
	_timer = Timer.new()
	_timer.wait_time = 0.5
	_timer.timeout.connect(_poll)
	add_child(_timer)
	_timer.start()


func _exit_tree() -> void:
	if _timer:
		_timer.queue_free()


func _now() -> float:
	return Time.get_ticks_msec() / 1000.0


func _poll() -> void:
	_handle_imports()
	_handle_play()
	_watch_props()
	_watch_scripts()


# ------------------------------------------------------------------- scripts

func _watch_scripts() -> void:
	var files := []
	_collect("res://src", ".gd", files)
	_collect("res://tools", ".gd", files)
	for f in files:
		var t := FileAccess.get_modified_time(f)
		if _mtimes.get(f, -1) != t:
			if _primed:
				_pending_script = f
			_mtimes[f] = t
	_primed = true
	if _pending_script == "" or _now() < _view_until or _playing != null:
		return
	var path := _pending_script
	_pending_script = ""
	EditorInterface.get_resource_filesystem().update_file(path)
	var s = ResourceLoader.load(path, "Script", ResourceLoader.CACHE_MODE_REPLACE)
	if s is Script:
		EditorInterface.set_main_screen_editor("Script")
		EditorInterface.edit_script(s)
		print("[live] editing ", path)
	_view_until = _now() + SCRIPT_HOLD


# --------------------------------------------------------------------- props

func _watch_props() -> void:
	var files := []
	_collect("res://assets/models/props", ".glb.import", files)
	for f in files:
		var t := FileAccess.get_modified_time(f)
		if _prop_mtimes.get(f, -1) != t:
			if _prop_mtimes.has(f) or _primed:
				_pending_prop = f.trim_suffix(".import")
			_prop_mtimes[f] = t
	if _pending_prop != "" and _import_started < 0.0 and _playing == null:
		_show_prop(_pending_prop)
		_pending_prop = ""


func _show_prop(glb: String) -> void:
	if not ResourceLoader.exists(PREVIEW_SCENE):
		return
	var root := EditorInterface.get_edited_scene_root()
	if root == null or root.scene_file_path != PREVIEW_SCENE:
		EditorInterface.open_scene_from_path(PREVIEW_SCENE)
		root = EditorInterface.get_edited_scene_root()
	if root and root.has_method("show_glb"):
		root.show_glb(glb)
		EditorInterface.set_main_screen_editor("3D")
		_view_until = _now() + PROP_HOLD
		print("[live] showing props ", glb)


# ------------------------------------------------------------------- imports

func _handle_imports() -> void:
	var fs := EditorInterface.get_resource_filesystem()
	for id in _list(LIVE + "/import"):
		_import_waiters.append(id)
		DirAccess.remove_absolute(ProjectSettings.globalize_path(LIVE + "/import/" + id))
	if _import_started < 0.0:
		if _import_waiters.is_empty() or _playing != null:
			return
		_import_started = _now()
		print("[live] importing new assets for %d request(s)" % _import_waiters.size())
		fs.scan()
		return
	var busy: bool = fs.is_scanning() or (fs.has_method("is_importing") and fs.is_importing())
	if busy or _now() - _import_started < 1.5:
		return
	for id in _import_waiters:
		_write(LIVE + "/done/" + id, "imported")
	_import_waiters.clear()
	_import_started = -1.0


# ---------------------------------------------------------------------- play

func _handle_play() -> void:
	for f in _list(LIVE + "/play"):
		var path := LIVE + "/play/" + f
		var req = JSON.parse_string(FileAccess.get_file_as_string(path))
		DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
		if req is Dictionary:
			req["id"] = f.get_basename()
			_play_queue.append(req)
	if _playing != null:
		var elapsed := _now() - _play_started
		if not EditorInterface.is_playing_scene() and elapsed > 4.0:
			_write(LIVE + "/done/" + str(_playing.id), "played")
			_playing = null
		elif elapsed > float(_playing.get("timeout", 90)):
			EditorInterface.stop_playing_scene()
		return
	if _play_queue.is_empty() or _import_started >= 0.0:
		return
	_playing = _play_queue.pop_front()
	if EditorInterface.is_playing_scene():
		EditorInterface.stop_playing_scene()
	# The game reads (and deletes) this hand-off file when started by the editor;
	# --watch makes it open as a window that fits on the screen.
	_write(LIVE + "/run_args.txt", "--watch --screen=%d %s" % [DisplayServer.window_get_current_screen(), str(_playing.get("args", ""))])
	EditorInterface.play_main_scene()
	_play_started = _now()
	print("[live] playing: ", _playing.get("args", ""))


# ------------------------------------------------------------------- helpers

func _list(dir: String) -> PackedStringArray:
	var d := DirAccess.open(dir)
	return d.get_files() if d else PackedStringArray()


func _write(path: String, text: String) -> void:
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f:
		f.store_string(text)


func _collect(dir: String, suffix: String, out: Array) -> void:
	var d := DirAccess.open(dir)
	if d == null:
		return
	for sub in d.get_directories():
		if not sub.begins_with("."):
			_collect(dir + "/" + sub, suffix, out)
	for f in d.get_files():
		if f.ends_with(suffix):
			out.append(dir + "/" + f)

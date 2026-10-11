extends Node
## Compile every script under res://src (parse + type errors are printed by
## the engine). Runs as a scene so the autoloads exist:
##   godot --headless --path godot res://tools/check_all.tscn
## Prints "CHECK_ALL ok=N failed=M [paths]".

func _ready() -> void:
	var files := []
	_collect("res://src", files)
	var failed := []
	for f in files:
		var s = load(f)
		if s == null or (s is GDScript and not s.can_instantiate()):
			failed.append(f)
	print("CHECK_ALL ok=%d failed=%d %s" % [files.size() - failed.size(), failed.size(), str(failed)])
	get_tree().quit(1 if failed.size() > 0 else 0)


func _collect(dir: String, out: Array) -> void:
	var d := DirAccess.open(dir)
	if d == null:
		return
	for sub in d.get_directories():
		_collect(dir + "/" + sub, out)
	for f in d.get_files():
		if f.ends_with(".gd"):
			out.append(dir + "/" + f)

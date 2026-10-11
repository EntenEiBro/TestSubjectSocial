class_name Hud
extends Control
## In-round heads-up display. Minigames talk to it through a tiny API:
##   set_players(seats)         build corner panels
##   set_timer(seconds | -1)    big top-centre clock (negative hides it)
##   set_stat(seat, text)       per-player stat line ("PUFFS 4")
##   set_status(seat, text)     per-player status tag ("HUNTER")
##   banner(text, ms, cls)      centre announcement (cls: "", "danger", "good")
##   prompt(text | "")          bottom instruction strip ({A} etc. become key caps)
##   feed(text, color)          kill-feed line
##   tag(seat, pos | null)      floating name tag (normalized screen coords)
## Every text goes through I18n.tr_msg().

var timer_label: Label
var banner_label: Label
var prompt_label: RichTextLabel
var prompt_box: PanelContainer
var feed_box: VBoxContainer
var panels := {}       # seat (Dictionary) id -> {root, name, status, stat}
var tags := {}
var _banner_until := 0.0
var _clock := 0.0


func _init() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	timer_label = UI.shadow(UI.label("", "ops", 6.0, UI.BONE), 0.4)
	timer_label.set_anchors_preset(Control.PRESET_CENTER_TOP)
	timer_label.position = Vector2(-200, UI.u(2))
	timer_label.size = Vector2(400, UI.u(8))
	add_child(timer_label)
	banner_label = UI.shadow(UI.label("", "ops", 7.0, UI.BONE), 0.5)
	banner_label.set_anchors_preset(Control.PRESET_CENTER_TOP)
	banner_label.position = Vector2(-600, 720 * 0.22 - UI.u(4))
	banner_label.size = Vector2(1200, UI.u(9))
	banner_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(banner_label)
	prompt_box = PanelContainer.new()
	prompt_box.add_theme_stylebox_override("panel", UI.flat_box(Color(0, 0, 0, 0.7), Color(0, 0, 0, 0), 0, 0.6))
	prompt_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	prompt_label = UI.rich("", "vt", 3.0, UI.BONE)
	prompt_label.custom_minimum_size = Vector2(700, 0)
	prompt_box.add_child(prompt_label)
	add_child(prompt_box)
	feed_box = UI.vbox([], 0.5, false)
	feed_box.alignment = BoxContainer.ALIGNMENT_BEGIN
	feed_box.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	feed_box.position = Vector2(-UI.u(2) - 500, UI.u(11))
	feed_box.size = Vector2(500, 300)
	add_child(feed_box)
	clear()


func _process(delta: float) -> void:
	_clock += delta
	if banner_label.visible and _banner_until > 0.0 and _clock >= _banner_until:
		banner_label.visible = false
	if timer_label.visible and timer_label.has_meta("urgent"):
		timer_label.modulate.a = 0.65 + 0.35 * sin(_clock * 12.0)
	prompt_box.position = Vector2(640 - prompt_box.size.x / 2.0, 720 - UI.u(10) - prompt_box.size.y)


static func _key(seat) -> int:
	return seat.player.slot if seat is Dictionary else int(seat)


## Build per-player corner panels for this round.
func set_players(seats: Array) -> void:
	for p in panels.values():
		p.root.queue_free()
	for t in tags.values():
		t.queue_free()
	panels.clear()
	tags.clear()
	var i := 0
	for seat in seats:
		var pl = seat.player
		var pc := Color(pl.color)
		var right := i == 1 or i == 3
		var bottom := i >= 2
		var box := PanelContainer.new()
		var sb := UI.flat_box(Color(10 / 255.0, 9 / 255.0, 8 / 255.0, 0.72))
		sb.content_margin_left = UI.u(1.4)
		sb.content_margin_right = UI.u(1.4)
		sb.content_margin_top = UI.u(0.8)
		sb.content_margin_bottom = UI.u(0.8)
		if right:
			sb.border_width_right = UI.u(0.8)
		else:
			sb.border_width_left = UI.u(0.8)
		sb.border_color = pc
		box.add_theme_stylebox_override("panel", sb)
		box.mouse_filter = Control.MOUSE_FILTER_IGNORE
		box.custom_minimum_size = Vector2(UI.u(22), 0)
		var align := HORIZONTAL_ALIGNMENT_RIGHT if right else HORIZONTAL_ALIGNMENT_LEFT
		var name_l := UI.label(pl.name() + ("  " + I18n.t("BOT") if pl.is_bot else ""), "ops", 2.4, pc, align)
		var status_l := UI.label("", "vt", 2.6, UI.HAZARD, align)
		var stat_l := UI.label("", "vt", 2.6, UI.BONE, align)
		box.add_child(UI.vbox([name_l, status_l, stat_l], 0.1, false))
		add_child(box)
		var corner_preset := [Control.PRESET_TOP_LEFT, Control.PRESET_TOP_RIGHT, Control.PRESET_BOTTOM_LEFT, Control.PRESET_BOTTOM_RIGHT][i % 4] as int
		box.set_anchors_and_offsets_preset(corner_preset, Control.PRESET_MODE_MINSIZE, UI.u(2))
		box.grow_horizontal = Control.GROW_DIRECTION_BEGIN if right else Control.GROW_DIRECTION_END
		box.grow_vertical = Control.GROW_DIRECTION_BEGIN if bottom else Control.GROW_DIRECTION_END
		panels[_key(seat)] = {"root": box, "name": name_l, "status": status_l, "stat": stat_l}
		var tag := UI.outline(UI.label("P%d\n▾" % (pl.slot + 1), "ops", 2.2, pc), 4, Color.BLACK) as Label
		tag.size = Vector2(80, UI.u(5))
		tag.visible = false
		add_child(tag)
		tags[_key(seat)] = tag
		i += 1


func set_timer(sec: float) -> void:
	if sec < 0.0:
		timer_label.visible = false
		return
	timer_label.visible = true
	timer_label.text = U.format_time(sec)
	if sec <= 5.0:
		timer_label.set_meta("urgent", true)
		timer_label.add_theme_color_override("font_color", UI.RED)
	else:
		if timer_label.has_meta("urgent"):
			timer_label.remove_meta("urgent")
		timer_label.modulate.a = 1.0
		timer_label.add_theme_color_override("font_color", UI.BONE)


func set_stat(seat, text: String) -> void:
	var p = panels.get(_key(seat))
	if p:
		p.stat.text = I18n.tr_msg(text)


func set_status(seat, text: String) -> void:
	var p = panels.get(_key(seat))
	if p:
		p.status.text = I18n.tr_msg(text)


## Grey a panel out with a × (the subject died).
func mark_dead(seat, dead: bool = true) -> void:
	var p = panels.get(_key(seat))
	if p == null:
		return
	p.root.modulate = Color(0.55, 0.55, 0.55, 0.6) if dead else Color.WHITE
	var nm: String = p.name.text.trim_suffix(" ×")
	p.name.text = nm + (" ×" if dead else "")


func banner(text: String, ms: int = 1600, cls: String = "") -> void:
	banner_label.text = I18n.tr_msg(text)
	banner_label.add_theme_color_override("font_color", UI.RED if cls == "danger" else (UI.CRT if cls == "good" else UI.BONE))
	banner_label.visible = true
	_banner_until = _clock + ms / 1000.0 if ms > 0 else 0.0


func prompt(text: String) -> void:
	if text == "":
		prompt_box.visible = false
		return
	prompt_box.visible = true
	UI.set_rich(prompt_label, I18n.fmt(I18n.tr_msg(text)))


func feed(text: String, color: Variant = "#cc3333") -> void:
	var box := PanelContainer.new()
	var sb := UI.flat_box(Color(80 / 255.0, 0, 0, 0.7))
	sb.border_width_right = UI.u(0.6)
	sb.border_color = U.col(color)
	sb.content_margin_left = UI.u(1.2)
	sb.content_margin_right = UI.u(1.2)
	box.add_theme_stylebox_override("panel", sb)
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.size_flags_horizontal = Control.SIZE_SHRINK_END
	box.add_child(UI.label(I18n.tr_msg(text), "vt", 2.6, UI.BONE, HORIZONTAL_ALIGNMENT_RIGHT))
	feed_box.add_child(box)
	feed_box.move_child(box, 0)
	var tw := create_tween()
	tw.tween_interval(3.2)
	tw.tween_property(box, "modulate:a", 0.0, 0.8)
	tw.tween_callback(box.queue_free)


## Floating name tag at normalized screen position {x, y} (or null to hide).
func tag(seat, pos) -> void:
	var t: Label = tags.get(_key(seat))
	if t == null:
		return
	if pos == null:
		t.visible = false
		return
	t.visible = true
	t.position = Vector2(pos.x * 1280.0 - t.size.x / 2.0, pos.y * 720.0 - t.size.y)


## Remove everything (between rounds).
func clear() -> void:
	for p in panels.values():
		p.root.queue_free()
	for t in tags.values():
		t.queue_free()
	panels.clear()
	tags.clear()
	for c in feed_box.get_children():
		c.queue_free()
	banner_label.visible = false
	prompt_box.visible = false
	timer_label.visible = false

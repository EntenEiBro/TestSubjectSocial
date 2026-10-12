class_name UiMirror
extends RefCounted
## Mirrors the host's menus on online clients (the Godot twin of the web
## version's HTML snapshots).
##
## capture() walks a Control tree and describes every visible node with its
## final, laid-out local rect and how it draws (text, font, colours, styleboxes,
## textures). The client rebuilds the same picture from plain Controls - no
## containers or scripts needed, since the host already did the layout. Only
## nodes whose description changed are sent after the first snapshot.
##
## Nodes with metadata "tap" (e.g. "join:2" on the lobby cards) become tappable
## on the client: a tap is sent to the host, whose current screen handles it.

const FONT_KINDS := ["ops", "elite", "vt"]

static var _next_id := 0


# =================================================================== host side

## {order: [ids], nodes: {id: desc}} for the subtree of `root` (root itself excluded).
static func capture(root: Node) -> Dictionary:
	var out := {"order": [], "nodes": {}}
	for c in root.get_children():
		if c is Control:
			_walk(c, 0, out)
	return out


static func _walk(n: Control, parent: int, out: Dictionary) -> void:
	if not n.visible or n.modulate.a <= 0.003:
		return
	# Small stable ids (instance ids can exceed what JSON numbers carry exactly).
	if not n.has_meta("_mid"):
		_next_id += 1
		n.set_meta("_mid", _next_id)
	var id: int = n.get_meta("_mid")
	var d := {"p": parent, "r": [n.position.x, n.position.y, n.size.x, n.size.y]}
	if n.rotation != 0.0:
		d["rot"] = n.rotation
	if n.scale != Vector2.ONE:
		d["sc"] = [n.scale.x, n.scale.y]
	if n.pivot_offset != Vector2.ZERO:
		d["pv"] = [n.pivot_offset.x, n.pivot_offset.y]
	if n.modulate != Color.WHITE:
		d["m"] = n.modulate.to_html()
	if n.self_modulate != Color.WHITE:
		d["sm"] = n.self_modulate.to_html()
	if n.clip_contents:
		d["clip"] = 1
	if n.has_meta("tap"):
		d["tap"] = str(n.get_meta("tap"))
	_describe(n, d)
	out.order.append(id)
	out.nodes[id] = d
	if n is Label or n is RichTextLabel or n is ProgressBar or n is LineEdit:
		return   # their insides are drawn by the description
	for c in n.get_children():
		if c is Control:
			_walk(c, id, out)


static func _font_kind(f: Font) -> String:
	for k in FONT_KINDS:
		if f == UI.font(k):
			return k
	return ""


static func _style(sb: StyleBox) -> Variant:
	if sb is StyleBoxFlat:
		var s: StyleBoxFlat = sb
		var o := {"bg": s.bg_color.to_html(), "bc": s.border_color.to_html(),
			"bw": [s.border_width_left, s.border_width_top, s.border_width_right, s.border_width_bottom]}
		if s.corner_radius_top_left > 0:
			o["cr"] = s.corner_radius_top_left
		if s.shadow_size > 0:
			o["sh"] = [s.shadow_color.to_html(), s.shadow_size]
		return o
	if sb is StyleBoxTexture and (sb as StyleBoxTexture).texture and (sb as StyleBoxTexture).texture.resource_path != "":
		return {"tex": (sb as StyleBoxTexture).texture.resource_path}
	return null


static func _describe(n: Control, d: Dictionary) -> void:
	if n is Label:
		var l: Label = n
		d["k"] = "label"
		d["t"] = l.text
		d["f"] = _font_kind(l.get_theme_font("font"))
		d["fs"] = l.get_theme_font_size("font_size")
		d["c"] = l.get_theme_color("font_color").to_html()
		d["ha"] = l.horizontal_alignment
		d["va"] = l.vertical_alignment
		if l.autowrap_mode != TextServer.AUTOWRAP_OFF:
			d["wr"] = l.autowrap_mode
		if l.clip_text:
			d["ct"] = 1
		var os := l.get_theme_constant("outline_size")
		if os > 0:
			d["ol"] = [l.get_theme_color("font_outline_color").to_html(), os]
		var shc := l.get_theme_color("font_shadow_color")
		if shc.a > 0.0:
			d["sh"] = [shc.to_html(), l.get_theme_constant("shadow_offset_x"), l.get_theme_constant("shadow_offset_y")]
	elif n is RichTextLabel:
		var r: RichTextLabel = n
		d["k"] = "rich"
		d["t"] = r.text
		d["f"] = _font_kind(r.get_theme_font("normal_font"))
		d["fs"] = r.get_theme_font_size("normal_font_size")
		d["c"] = r.get_theme_color("default_color").to_html()
	elif n is ProgressBar:
		var p: ProgressBar = n
		d["k"] = "bar"
		d["v"] = [p.min_value, p.max_value, p.value]
		d["bg"] = _style(p.get_theme_stylebox("background"))
		d["fill"] = _style(p.get_theme_stylebox("fill"))
	elif n is Button:
		var b: Button = n
		d["k"] = "button"
		d["t"] = b.text
		d["f"] = _font_kind(b.get_theme_font("font"))
		d["fs"] = b.get_theme_font_size("font_size")
		d["c"] = b.get_theme_color("font_color").to_html()
		d["al"] = b.alignment
		d["st"] = _style(b.get_theme_stylebox("normal"))
	elif n is ColorRect:
		d["k"] = "color"
		d["c"] = (n as ColorRect).color.to_html()
	elif n is TextureRect:
		var t: TextureRect = n
		if t.texture and t.texture.resource_path != "":
			d["k"] = "tex"
			d["tex"] = t.texture.resource_path
			d["sm2"] = t.stretch_mode
			d["flt"] = t.texture_filter
			d["rep"] = t.texture_repeat
	elif n is PanelContainer or n is Panel:
		d["k"] = "panel"
		d["st"] = _style(n.get_theme_stylebox("panel"))
	elif n is LineEdit:
		var e: LineEdit = n
		d["k"] = "label"
		d["t"] = e.text if e.text != "" else e.placeholder_text
		d["f"] = _font_kind(e.get_theme_font("font"))
		d["fs"] = e.get_theme_font_size("font_size")
		d["c"] = e.get_theme_color("font_color").to_html()
		d["ha"] = e.alignment
		d["va"] = VERTICAL_ALIGNMENT_CENTER


## Changes between two captures for one client: full snapshot when the node
## set / order changed, otherwise only the changed descriptions.
## `last` holds what this client has: {order_sig, json: {id: text}}.
static func delta(cap: Dictionary, last: Dictionary) -> Variant:
	var sig := ",".join(PackedStringArray(cap.order.map(func(i): return str(i))))
	var texts := {}
	for id in cap.order:
		texts[id] = JSON.stringify(cap.nodes[id])
	if sig != last.get("sig", ""):
		last["sig"] = sig
		last["json"] = texts
		return {"full": 1, "order": cap.order, "nodes": cap.nodes}
	var changed := {}
	var old: Dictionary = last.get("json", {})
	for id in cap.order:
		if old.get(id, "") != texts[id]:
			changed[id] = cap.nodes[id]
	last["json"] = texts
	return {"nodes": changed} if not changed.is_empty() else null


# ================================================================= client side

## Rebuilds and updates the mirrored picture under `root` (a full-rect Control).
class View extends RefCounted:
	var root: Control
	var nodes := {}          # host id (String) -> Control
	var kinds := {}          # host id -> kind the node was built as
	var on_tap: Callable     # func(action)
	var _styles := {}

	func _init(r: Control, tap_fn: Callable) -> void:
		root = r
		on_tap = tap_fn

	func clear() -> void:
		for c in root.get_children():
			c.queue_free()
		nodes.clear()
		kinds.clear()

	func apply(msg: Dictionary) -> void:
		if msg.get("full", 0):
			clear()
			var data: Dictionary = msg.get("nodes", {})
			for id in msg.get("order", []):
				var key := str(int(id))
				var d: Dictionary = data.get(key, data.get(id, {}))
				var parent: Control = nodes.get(str(int(d.get("p", 0))), root)
				var n := _make(d)
				parent.add_child(n)
				nodes[key] = n
				kinds[key] = str(d.get("k", ""))
				_update(n, d)
			return
		var changed: Dictionary = msg.get("nodes", {})
		for id in changed:
			var key := str(int(float(id)))
			var d: Dictionary = changed[id]
			var n: Control = nodes.get(key)
			if n == null:
				continue
			if str(d.get("k", "")) != kinds.get(key, ""):
				# The node changed kind (rare): rebuild it in place.
				var repl := _make(d)
				n.add_sibling(repl)
				for c in n.get_children():
					c.reparent(repl, false)
				n.queue_free()
				nodes[key] = repl
				kinds[key] = str(d.get("k", ""))
				n = repl
			_update(n, d)

	func _make(d: Dictionary) -> Control:
		var n: Control
		match str(d.get("k", "")):
			"label":
				n = Label.new()
			"rich":
				var r := RichTextLabel.new()
				r.bbcode_enabled = true
				r.scroll_active = false
				r.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
				n = r
			"bar":
				var p := ProgressBar.new()
				p.show_percentage = false
				n = p
			"button", "panel":
				n = Panel.new()
			"color":
				n = ColorRect.new()
			"tex":
				n = TextureRect.new()
				(n as TextureRect).expand_mode = TextureRect.EXPAND_IGNORE_SIZE
			_:
				n = Control.new()
		n.mouse_filter = Control.MOUSE_FILTER_IGNORE
		if d.has("tap"):
			n.mouse_filter = Control.MOUSE_FILTER_STOP
			var action := str(d.tap)
			n.gui_input.connect(func(e):
				if (e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT) or (e is InputEventScreenTouch and e.pressed):
					on_tap.call(action))
		return n

	func _sb(o) -> StyleBox:
		if o == null:
			return StyleBoxEmpty.new()
		var key := JSON.stringify(o)
		if _styles.has(key):
			return _styles[key]
		var sb: StyleBox
		if o.has("tex"):
			var t := StyleBoxTexture.new()
			t.texture = load(str(o.tex))
			sb = t
		else:
			var s := StyleBoxFlat.new()
			s.bg_color = Color.html(str(o.bg))
			s.border_color = Color.html(str(o.bc))
			var bw: Array = o.get("bw", [0, 0, 0, 0])
			s.border_width_left = int(bw[0])
			s.border_width_top = int(bw[1])
			s.border_width_right = int(bw[2])
			s.border_width_bottom = int(bw[3])
			if o.has("cr"):
				s.set_corner_radius_all(int(o.cr))
			if o.has("sh"):
				s.shadow_color = Color.html(str(o.sh[0]))
				s.shadow_size = int(o.sh[1])
			sb = s
		_styles[key] = sb
		return sb

	func _update(n: Control, d: Dictionary) -> void:
		var r: Array = d.get("r", [0, 0, 0, 0])
		n.position = Vector2(float(r[0]), float(r[1]))
		n.size = Vector2(float(r[2]), float(r[3]))
		n.rotation = float(d.get("rot", 0.0))
		var sc: Array = d.get("sc", [1, 1])
		n.scale = Vector2(float(sc[0]), float(sc[1]))
		var pv: Array = d.get("pv", [0, 0])
		n.pivot_offset = Vector2(float(pv[0]), float(pv[1]))
		n.modulate = Color.html(str(d.get("m", "ffffffff")))
		n.self_modulate = Color.html(str(d.get("sm", "ffffffff")))
		n.clip_contents = d.has("clip")
		var f := str(d.get("f", ""))
		match str(d.get("k", "")):
			"label":
				var l: Label = n
				l.text = str(d.get("t", ""))
				if f != "":
					l.add_theme_font_override("font", UI.font(f))
				l.add_theme_font_size_override("font_size", int(d.get("fs", 16)))
				l.add_theme_color_override("font_color", Color.html(str(d.get("c", "ffffff"))))
				l.horizontal_alignment = int(d.get("ha", 0))
				l.vertical_alignment = int(d.get("va", 0))
				l.autowrap_mode = int(d.get("wr", TextServer.AUTOWRAP_OFF))
				l.clip_text = d.has("ct")
				if d.has("ol"):
					l.add_theme_color_override("font_outline_color", Color.html(str(d.ol[0])))
					l.add_theme_constant_override("outline_size", int(d.ol[1]))
				if d.has("sh"):
					l.add_theme_color_override("font_shadow_color", Color.html(str(d.sh[0])))
					l.add_theme_constant_override("shadow_offset_x", int(d.sh[1]))
					l.add_theme_constant_override("shadow_offset_y", int(d.sh[2]))
			"rich":
				var rt: RichTextLabel = n
				if f != "":
					rt.add_theme_font_override("normal_font", UI.font(f))
					rt.add_theme_font_override("bold_font", UI.font("ops"))
				rt.add_theme_font_size_override("normal_font_size", int(d.get("fs", 16)))
				rt.add_theme_font_size_override("bold_font_size", int(d.get("fs", 16)))
				rt.add_theme_color_override("default_color", Color.html(str(d.get("c", "ffffff"))))
				rt.text = str(d.get("t", ""))
			"bar":
				var p: ProgressBar = n
				var v: Array = d.get("v", [0, 1, 0])
				p.min_value = float(v[0])
				p.max_value = float(v[1])
				p.value = float(v[2])
				p.add_theme_stylebox_override("background", _sb(d.get("bg")))
				p.add_theme_stylebox_override("fill", _sb(d.get("fill")))
			"button":
				n.add_theme_stylebox_override("panel", _sb(d.get("st")))
				var lab: Label = n.get_node_or_null("L")
				if lab == null:
					lab = Label.new()
					lab.name = "L"
					lab.set_anchors_preset(Control.PRESET_FULL_RECT)
					lab.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
					lab.mouse_filter = Control.MOUSE_FILTER_IGNORE
					n.add_child(lab)
				lab.text = str(d.get("t", ""))
				var al := int(d.get("al", HORIZONTAL_ALIGNMENT_CENTER))
				lab.horizontal_alignment = al
				if f != "":
					lab.add_theme_font_override("font", UI.font(f))
				lab.add_theme_font_size_override("font_size", int(d.get("fs", 16)))
				lab.add_theme_color_override("font_color", Color.html(str(d.get("c", "ffffff"))))
			"panel":
				n.add_theme_stylebox_override("panel", _sb(d.get("st")))
			"color":
				(n as ColorRect).color = Color.html(str(d.get("c", "000000")))
			"tex":
				var t: TextureRect = n
				t.texture = load(str(d.tex)) if ResourceLoader.exists(str(d.tex)) else null
				t.stretch_mode = int(d.get("sm2", 0))
				t.texture_filter = int(d.get("flt", 0))
				t.texture_repeat = int(d.get("rep", 0))

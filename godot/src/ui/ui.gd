class_name UI
## UI kit: the game's fonts, palette and building blocks for menus / HUD.
## Sizes are given in "u" = 1% of the 720px stage height (like the web CSS).

const UPX := 7.2
const BONE := Color("#d8d2c0")
const BONE_DIM := Color("#8f8a7a")
const INK := Color("#0b0a09")
const BLOOD := Color("#9b1d1d")
const HAZARD := Color("#c9a227")
const CRT := Color("#47ff6a")
const RED := Color("#ff4a3a")
const PANEL := Color(14 / 255.0, 13 / 255.0, 11 / 255.0, 0.86)
const EDGE := Color("#2c2a24")

static var _fonts := {}


static func u(n: float) -> int:
	return int(round(n * UPX))


## kind: "ops" (Black Ops One, headings), "elite" (Special Elite, body), "vt" (VT323, terminal / hints)
static func font(kind: String = "elite") -> Font:
	if not _fonts.has(kind):
		var file := {"ops": "blackopsone", "elite": "specialelite", "vt": "vt323"}.get(kind, "specialelite") as String
		var f: FontFile = load("res://assets/fonts/%s-latin.woff2" % file)
		var ext: FontFile = load("res://assets/fonts/%s-latin-ext.woff2" % file)
		var sys := SystemFont.new()
		sys.font_names = PackedStringArray(["Microsoft YaHei", "Yu Gothic", "Nirmala UI", "Segoe UI", "Noto Sans CJK SC", "Noto Sans CJK JP",
			"Noto Sans Devanagari", "Noto Sans", "Droid Sans Fallback", "sans-serif"])
		var fb: Array[Font] = []
		if ext:
			fb.append(ext)
		fb.append(sys)
		f.fallbacks = fb
		_fonts[kind] = f
	return _fonts[kind]


static func style_label(l: Control, kind: String, size_u: float, color: Color) -> void:
	l.add_theme_font_override("font", font(kind))
	l.add_theme_font_size_override("font_size", u(size_u))
	l.add_theme_color_override("font_color", color)


static func label(text: String, kind: String = "elite", size_u: float = 2.4, color: Color = BONE, align: int = HORIZONTAL_ALIGNMENT_CENTER) -> Label:
	var l := Label.new()
	l.text = text
	l.horizontal_alignment = align
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	style_label(l, kind, size_u, color)
	return l


## Label with a hard drop shadow (headings over 3D).
static func shadow(l: Label, off_u: float = 0.5, color: Color = Color.BLACK) -> Label:
	l.add_theme_color_override("font_shadow_color", color)
	l.add_theme_constant_override("shadow_offset_x", max(1, u(off_u)))
	l.add_theme_constant_override("shadow_offset_y", max(1, u(off_u)))
	return l


static func outline(l: Control, size_px: int, color: Color) -> Control:
	l.add_theme_color_override("font_outline_color", color)
	l.add_theme_constant_override("outline_size", size_px)
	return l


## BBCode text (key caps from I18n.fmt). autowrap with a width set by the container.
static func rich(bbcode: String, kind: String = "elite", size_u: float = 2.4, color: Color = BONE, align: String = "center") -> RichTextLabel:
	var r := RichTextLabel.new()
	r.bbcode_enabled = true
	r.fit_content = true
	r.scroll_active = false
	r.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	r.add_theme_font_override("normal_font", font(kind))
	r.add_theme_font_override("bold_font", font("ops"))
	r.add_theme_font_size_override("normal_font_size", u(size_u))
	r.add_theme_font_size_override("bold_font_size", u(size_u))
	r.add_theme_color_override("default_color", color)
	set_rich(r, bbcode, align)
	return r


static func set_rich(r: RichTextLabel, bbcode: String, align: String = "center") -> void:
	var html_b := bbcode.replace("<b>", "[b]").replace("</b>", "[/b]").replace("<br>", "\n")
	r.text = "[%s]%s[/%s]" % [align, html_b, align] if align != "left" else html_b


static func flat_box(bg: Color, border: Color = Color(0, 0, 0, 0), bw: int = 0, pad_u: float = 0.0) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = bg
	s.border_color = border
	s.set_border_width_all(bw)
	s.set_content_margin_all(u(pad_u))
	return s


## Strip of diagonal hazard stripes (panel tops, intro).
static func hazard_strip(height_u: float = 1.2) -> TextureRect:
	var t := TextureRect.new()
	t.texture = Tex.load_tex("hazard")
	t.stretch_mode = TextureRect.STRETCH_TILE
	t.custom_minimum_size = Vector2(0, u(height_u))
	t.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	t.texture_repeat = CanvasItem.TEXTURE_REPEAT_ENABLED
	t.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	t.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return t


## The standard dark panel with a hazard stripe on top. Returns {root, body (VBox)}.
## opts: width_frac (0 = fit), pad_x (6), pad_y (4)
static func panel(opts: Dictionary = {}) -> Dictionary:
	var root := PanelContainer.new()
	root.add_theme_stylebox_override("panel", flat_box(PANEL, EDGE, max(1, u(0.3))))
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var w: float = opts.get("width_frac", 0.0)
	if w > 0.0:
		root.custom_minimum_size.x = 1280.0 * w
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 0)
	col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(col)
	col.add_child(hazard_strip(1.2))
	var m := MarginContainer.new()
	m.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for side in ["left", "right"]:
		m.add_theme_constant_override("margin_" + side, u(opts.get("pad_x", 6.0)))
	for side in ["top", "bottom"]:
		m.add_theme_constant_override("margin_" + side, u(opts.get("pad_y", 3.0)))
	col.add_child(m)
	var body := VBoxContainer.new()
	body.alignment = BoxContainer.ALIGNMENT_CENTER
	body.add_theme_constant_override("separation", u(1.2))
	body.mouse_filter = Control.MOUSE_FILTER_IGNORE
	m.add_child(body)
	return {"root": root, "body": body}


## A tappable button in the game's style (also clickable with a mouse).
static func tap_btn(text: String, primary: bool = false, size_u: float = 3.0) -> Button:
	var b := Button.new()
	b.text = text
	b.focus_mode = Control.FOCUS_NONE
	b.add_theme_font_override("font", font("ops"))
	b.add_theme_font_size_override("font_size", u(size_u))
	for st in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		b.add_theme_color_override(st, BONE)
	var border := BLOOD if primary else Color("#555555")
	var bg := Color(BLOOD.r, BLOOD.g, BLOOD.b, 0.35) if primary else Color(0, 0, 0, 0.4)
	var normal := flat_box(bg, border, max(1, u(0.4)))
	normal.content_margin_left = u(3)
	normal.content_margin_right = u(3)
	normal.content_margin_top = u(0.9)
	normal.content_margin_bottom = u(0.9)
	var pressed: StyleBoxFlat = normal.duplicate()
	pressed.bg_color = Color(BLOOD.r, BLOOD.g, BLOOD.b, 0.6)
	b.add_theme_stylebox_override("normal", normal)
	b.add_theme_stylebox_override("hover", normal)
	b.add_theme_stylebox_override("focus", normal)
	b.add_theme_stylebox_override("pressed", pressed)
	return b


static func hbox(children: Array = [], sep_u: float = 1.5, centered: bool = true) -> HBoxContainer:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", u(sep_u))
	if centered:
		h.alignment = BoxContainer.ALIGNMENT_CENTER
	h.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for c in children:
		h.add_child(c)
	return h


static func vbox(children: Array = [], sep_u: float = 1.0, centered: bool = true) -> VBoxContainer:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", u(sep_u))
	if centered:
		v.alignment = BoxContainer.ALIGNMENT_CENTER
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for c in children:
		v.add_child(c)
	return v


## A full-stage Control that centres its single child.
static func center(child: Control) -> CenterContainer:
	var c := CenterContainer.new()
	c.set_anchors_preset(Control.PRESET_FULL_RECT)
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	c.add_child(child)
	return c


static func full(c: Control) -> Control:
	c.set_anchors_preset(Control.PRESET_FULL_RECT)
	return c


static func spacer(h_u: float) -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(0, u(h_u))
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return c

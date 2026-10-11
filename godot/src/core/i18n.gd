extends Node
## Tiny translation layer (autoload "I18n"). The English text is the key:
##
##   I18n.t("BEGIN TESTING")                       → "TESTS BEGINNEN" (German)
##   I18n.t("NEED AT LEAST {n} SUBJECTS", {"n": 2})  placeholders filled after lookup
##   I18n.tr_msg("SUBJECT 2 IS ARMED")             runtime messages: exact match,
##                                                 then the regex patterns (i18n/patterns.json)
##   I18n.fmt(text)                                swaps {A} {B} {MOVE} {BACK} {PAUSE}
##                                                 {ADDBOT} {REMBOT} for the current device's
##                                                 button labels (as BBCode key caps)
##   I18n.tp(english, vars)                        t() + fmt()
##   I18n.pick(touch_text, button_text, vars)      wording for touch vs buttons
##
## Packs: res://i18n/<code>.json {strings, patterns} (tools/convert_i18n.py).

signal language_changed(code: String)

const LANGUAGES := [
	{"code": "en", "name": "English"},
	{"code": "de", "name": "Deutsch"},
	{"code": "ru", "name": "Русский"},
	{"code": "zh", "name": "中文"},
	{"code": "ja", "name": "日本語"},
	{"code": "it", "name": "Italiano"},
	{"code": "hi", "name": "हिन्दी"},
]
const LABELS := {
	"keyboard": {"A": "F / ENTER", "B": "G / R-SHIFT", "MOVE": "W A S D / ARROWS", "BACK": "ESC", "PAUSE": "ESC", "ADDBOT": "T", "REMBOT": "Y"},
	"gamepad": {"A": "Ⓐ", "B": "Ⓑ", "MOVE": "L-STICK", "BACK": "Ⓑ", "PAUSE": "START", "ADDBOT": "Ⓨ", "REMBOT": "Ⓧ"},
	"touch": {"A": "Ⓐ", "B": "Ⓑ", "MOVE": "JOYSTICK", "BACK": "BACK", "PAUSE": "II", "ADDBOT": "+ BOT", "REMBOT": "− BOT"},
}
const TRANSLATE_WORDS := ["ARROWS", "L-STICK", "JOYSTICK", "BACK"]

var current := "en"
var _packs := {}
var _patterns := []      # [{id, re: RegEx}]
var _cache := {}
var _token_re := RegEx.create_from_string("\\{(A|B|MOVE|BACK|PAUSE|ADDBOT|REMBOT)\\}")
var _var_re := RegEx.create_from_string("\\{(\\w+)\\}")
var _num_re := RegEx.create_from_string("\\{(\\d)\\}")


func _ready() -> void:
	for l in LANGUAGES:
		var path := "res://i18n/%s.json" % l.code
		if FileAccess.file_exists(path):
			_packs[l.code] = JSON.parse_string(FileAccess.get_file_as_string(path))
	var pats = JSON.parse_string(FileAccess.get_file_as_string("res://i18n/patterns.json"))
	if pats is Array:
		for p in pats:
			var re := RegEx.new()
			if re.compile(str(p.re)) == OK:
				_patterns.append({"id": p.id, "re": re})


func set_language(code: String) -> void:
	current = code if _packs.has(code) else "en"
	_cache.clear()
	language_changed.emit(current)


func _fill(text: String, vars: Dictionary) -> String:
	if vars.is_empty():
		return text
	var out := text
	for m in _var_re.search_all(text):
		var k := m.get_string(1)
		if vars.has(k):
			out = out.replace("{" + k + "}", str(vars[k]))
	return out


## Translate a known UI string (English text as key).
func t(english: String, vars: Dictionary = {}) -> String:
	var pack: Dictionary = _packs.get(current, {})
	var strings: Dictionary = pack.get("strings", {})
	var out: String = strings.get(english, english)
	if out == "":
		out = english
	return _fill(out, vars)


## Translate a runtime message (HUD): exact match, then the regex patterns,
## whose captured groups are themselves translated.
func tr_msg(text: String) -> String:
	if current == "en" or text == "":
		return text
	if _cache.has(text):
		return _cache[text]
	var out := _translate_message(text)
	if _cache.size() > 4000:
		_cache.clear()
	_cache[text] = out
	return out


func _translate_message(text: String) -> String:
	var pack: Dictionary = _packs.get(current, {})
	var strings: Dictionary = pack.get("strings", {})
	if strings.has(text) and str(strings[text]) != "":
		return strings[text]
	var templates: Dictionary = pack.get("patterns", {})
	for p in _patterns:
		var m: RegExMatch = p.re.search(text)
		if m == null:
			continue
		if not templates.has(p.id):
			return text
		var tpl: String = templates[p.id]
		var out := tpl
		for nm in _num_re.search_all(tpl):
			var idx := int(nm.get_string(1))
			out = out.replace("{%d}" % idx, tr_msg(m.get_string(idx)))
		return out
	return text


func input_mode() -> String:
	return Inputs.mode


func is_touch_mode() -> bool:
	return Inputs.mode == "touch"


## Key-cap label for one button token in the current input mode (BBCode).
func key_label(token: String) -> String:
	var labels: Dictionary = LABELS.get(input_mode(), LABELS.keyboard)
	if not labels.has(token):
		return "{%s}" % token
	var parts := []
	for part in str(labels[token]).split(" / "):
		var words := []
		for w in part.split(" "):
			words.append(t(w) if w in TRANSLATE_WORDS else w)
		parts.append(" ".join(words))
	return "[bgcolor=#d8d2c022][color=#ffffff] %s [/color][/bgcolor]" % " / ".join(parts)


## Plain-text version of key_label (for Label nodes / 3D text).
func key_text(token: String) -> String:
	var labels: Dictionary = LABELS.get(input_mode(), LABELS.keyboard)
	return str(labels.get(token, token))


## Replace {A}, {B}, {MOVE}... in an (already translated) string with key caps.
func fmt(text: String, bbcode: bool = true) -> String:
	if text.find("{") < 0:
		return text
	var out := text
	for m in _token_re.search_all(text):
		var token := m.get_string(1)
		out = out.replace("{" + token + "}", key_label(token) if bbcode else key_text(token))
	return out


func tp(english: String, vars: Dictionary = {}, bbcode: bool = true) -> String:
	return fmt(t(english, vars), bbcode)


func pick(touch_text: String, button_text: String, vars: Dictionary = {}, bbcode: bool = true) -> String:
	return tp(touch_text if is_touch_mode() else button_text, vars, bbcode)


## 1 → "1ST", 2 → "2ND"... (other languages use their 'ORDINAL {n}' entry).
func ordinal(n: int) -> String:
	if current != "en":
		return t("ORDINAL {n}", {"n": n})
	var s := ["TH", "ST", "ND", "RD"]
	var v := n % 100
	var suffix := "TH"
	if (v - 20) % 10 >= 1 and (v - 20) % 10 <= 3 and v > 20:
		suffix = s[(v - 20) % 10]
	elif v >= 1 and v <= 3:
		suffix = s[v]
	return "%d%s" % [n, suffix]

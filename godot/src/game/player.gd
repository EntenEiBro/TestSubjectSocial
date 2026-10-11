class_name Player
extends RefCounted
## One participant (human or bot) in the current session.

const MAX_PLAYERS := 4
const MIN_PLAYERS := 2
## Points awarded per finishing place, by participant count.
const PLACEMENT_POINTS := {2: [3, 0], 3: [3, 1, 0], 4: [3, 2, 1, 0]}

var id: String
var slot: int
var device: String       # kb1 | kb2 | pad0.. | touch | netN | bot | remote
var is_bot: bool
var remote := false      # an online player's seat simulated on this device (no haptics/awards)
var color: String
var look := {}
var look_index := {}
var ready := false
var score := 0
var deaths := 0
var wins := 0
var history := []        # per round {game, place, points, died}


## slot 0..3 (fixed seat / colour), device = input device id.
func _init(slot_i: int, dev: String) -> void:
	id = "p%d" % slot_i
	slot = slot_i
	device = dev
	is_bot = dev == "bot"
	color = Subject.SLOT_COLORS[slot_i]
	var si := slot_i * 2 % Subject.SUIT_COLORS.size()
	look_index = {"suit": si, "skin": slot_i % Subject.SKIN_TONES.size(), "hat": 0, "face": 0}
	look = {"suit": Subject.SUIT_COLORS[si].hex, "skin": Subject.SKIN_TONES[look_index.skin], "hat": Subject.HATS[0], "face": Subject.FACES[0]}
	if is_bot:
		randomize_look()
	ready = is_bot
	reset_stats()


## Display name in the current language ("SUBJECT 2", "UNIT-3"...).
func name() -> String:
	return I18n.t("UNIT-{n}", {"n": slot + 1}) if is_bot else I18n.t("SUBJECT {n}", {"n": slot + 1})


func reset_stats() -> void:
	score = 0
	deaths = 0
	wins = 0
	history = []


## Cycle one customization field (suit | skin | hat | face) by step (+1 / -1).
func cycle(field: String, step: int) -> void:
	var lists := {"suit": Subject.SUIT_COLORS, "skin": Subject.SKIN_TONES, "hat": Subject.HATS, "face": Subject.FACES}
	var list: Array = lists[field]
	var i := (int(look_index[field]) + step + list.size()) % list.size()
	look_index[field] = i
	look[field] = list[i].hex if field == "suit" else list[i]


## Cosmetic randomisation (lobby bots); uses randi, not the simulation Rng.
func randomize_look() -> void:
	look_index = {"suit": randi() % Subject.SUIT_COLORS.size(), "skin": randi() % Subject.SKIN_TONES.size(),
		"hat": randi() % Subject.HATS.size(), "face": randi() % Subject.FACES.size()}
	look = {"suit": Subject.SUIT_COLORS[look_index.suit].hex, "skin": Subject.SKIN_TONES[look_index.skin],
		"hat": Subject.HATS[look_index.hat], "face": Subject.FACES[look_index.face]}


## Display name of the current value of a field.
func look_label(field: String) -> String:
	if field == "suit":
		return I18n.t(Subject.SUIT_COLORS[look_index.suit].name)
	if field == "skin":
		return I18n.t("Tone {n}", {"n": int(look_index.skin) + 1})
	return I18n.t(str(look[field]))


## Plain data copy (online roster).
func to_dict() -> Dictionary:
	return {"slot": slot, "device": device, "look": look.duplicate(), "look_index": look_index.duplicate()}

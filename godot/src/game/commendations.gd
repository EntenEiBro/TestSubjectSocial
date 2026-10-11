extends Node
## Local "commendations" (one per simulation; autoload "Commendations").
## Progress is stored in user://commendations.json; only human players earn them.
## Minigames call award(seat, key) (one-shot) or progress(seat, key, amount).

signal unlocked(def: Dictionary)

const STORE := "user://commendations.json"
const DEFS := {
	"returnFire": {"game": "sidearm", "title": "Return Fire", "desc": "Kill a subject who finished their gun before you did."},
	"cleanShot": {"game": "openseason", "title": "Clean Shot", "desc": "Land a headshot as the hunter."},
	"lastNook": {"game": "alcove", "title": "Last Nook", "desc": "Win Alcove Roulette from the final safe alcove."},
	"buzzerBeater": {"game": "hotspider", "title": "Buzzer Beater", "desc": "Throw the spider with less than one second on its fuse."},
	"specialDelivery": {"game": "piston", "title": "Special Delivery", "desc": "Knock a rival off their platform with thrown junk."},
	"flawlessFilter": {"game": "incinerator", "title": "Flawless Filter", "desc": "Finish The Incinerator with 100% accuracy."},
	"tenTiles": {"game": "symbolfloor", "title": "Ten Tiles Left", "desc": "Still be standing when only ten tiles remain."},
	"expressLane": {"game": "escalator", "title": "Express Lane", "desc": "Reach the top of the escalator without a single misstep."},
	"speedEater": {"game": "supperclub", "title": "Speed Eater", "desc": "Clean your plate in under 20 seconds."},
	"quickJab": {"game": "syringe", "title": "Quick Jab", "desc": "Infect someone within 3 seconds of finding the syringe."},
	"masterMason": {"game": "chisel", "title": "Master Mason", "desc": "Survive every pattern of the Chisel Test."},
	"blindFaith": {"game": "sonar", "title": "Blind Faith", "desc": "Cross the minefield without ever using sonar."},
	"certified": {"game": "forklift", "title": "Certified", "desc": "Hold four crates in your zone at once."},
	"sawFeeder": {"game": "sawblade", "title": "Saw Feeder", "desc": "Shove 15 subjects into the blades (cumulative).", "goal": 15},
	"chainSmoker": {"game": "smokebreak", "title": "Chain Smoker", "desc": "Take 20 good puffs in total (cumulative).", "goal": 20},
}

var state := {}   # key -> {unlocked: bool, count: int}


func _ready() -> void:
	if FileAccess.file_exists(STORE):
		var d = JSON.parse_string(FileAccess.get_file_as_string(STORE))
		if d is Dictionary:
			state = d


func _save() -> void:
	var f := FileAccess.open(STORE, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(state))


func is_unlocked(key: String) -> bool:
	return state.has(key) and bool(state[key].get("unlocked", false))


func count(key: String) -> int:
	return int(state[key].get("count", 0)) if state.has(key) else 0


## Unlock a one-shot commendation. Returns true if newly unlocked.
func unlock(key: String) -> bool:
	if not DEFS.has(key) or is_unlocked(key):
		return false
	var cur: Dictionary = state.get(key, {})
	cur["unlocked"] = true
	state[key] = cur
	_save()
	unlocked.emit(DEFS[key])
	return true


## Add to a cumulative counter, unlocking when its goal is reached.
func add(key: String, amount: int = 1) -> void:
	if not DEFS.has(key):
		return
	var cur: Dictionary = state.get(key, {"unlocked": false, "count": 0})
	cur["count"] = int(cur.get("count", 0)) + amount
	state[key] = cur
	_save()
	if DEFS[key].has("goal") and cur.count >= DEFS[key].goal:
		unlock(key)


func summary() -> Dictionary:
	var n := 0
	for k in DEFS:
		if is_unlocked(k):
			n += 1
	return {"unlocked": n, "total": DEFS.size()}

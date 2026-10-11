class_name Registry
## The simulation registry: every minigame script in play order of the manual.
## Add new rounds here (each script defines `const META := {...}` and extends Minigame).

const PATHS := [
	"res://src/minigames/sidearm.gd",
	"res://src/minigames/openseason.gd",
	"res://src/minigames/alcove.gd",
	"res://src/minigames/hotspider.gd",
	"res://src/minigames/piston.gd",
	"res://src/minigames/incinerator.gd",
	"res://src/minigames/symbolfloor.gd",
	"res://src/minigames/escalator.gd",
	"res://src/minigames/supperclub.gd",
	"res://src/minigames/syringe.gd",
	"res://src/minigames/chisel.gd",
	"res://src/minigames/sonar.gd",
	"res://src/minigames/forklift.gd",
	"res://src/minigames/sawblade.gd",
	"res://src/minigames/smokebreak.gd",
	"res://src/minigames/hotseat.gd",
	"res://src/minigames/ordnance.gd",
	"res://src/minigames/dropzone.gd",
	"res://src/minigames/turbine.gd",
	"res://src/minigames/cablerun.gd",
	"res://src/minigames/motion.gd",
	"res://src/minigames/spincycle.gd",
	"res://src/minigames/crumble.gd",
	"res://src/minigames/quickdraw.gd",
	"res://src/minigames/ventcrawl.gd",
	"res://src/minigames/lasersweep.gd",
	"res://src/minigames/chairs.gd",
	"res://src/minigames/winch.gd",
	"res://src/minigames/pressure.gd",
	"res://src/minigames/glassbridge.gd",
]

static var _games := []


## All available minigame scripts (missing files are skipped).
static func games() -> Array:
	if _games.is_empty():
		for p in PATHS:
			if ResourceLoader.exists(p):
				var s = load(p)
				if s and s.get_script_constant_map().has("META"):
					_games.append(s)
	return _games


static func find(id: String):
	for g in games():
		if g.META.id == id:
			return g
	return null


static func meta(G) -> Dictionary:
	return G.META

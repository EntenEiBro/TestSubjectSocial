class_name Flow
extends RefCounted
## Session orchestration: programs (modes) and individual rounds (port of flow.js).
##
##   play_program("original" | "arcade" | {ids})
##     └ for each simulation: roulette reel picks it → play_round(G)
##          title card → briefing (2 pages + ready) → countdown → play
##     └ animated points screen after every round, winner ceremony at the end

const BOT_LEVELS := [0.3, 0.6, 0.9]
const INTRO_LINES := [
	"Good evening, subjects. Welcome to the facility.",
	"Tonight you will participate in a series of entertaining simulations.",
	"Each simulation has a winner. Losing is discouraged. Permanently.",
	"Points are awarded for placement. The subject with the most points will be released.",
	"The others will be repurposed. Please enjoy the party.",
]
const OUTRO_LINES := [
	"The program is complete. Your cooperation has been noted.",
	"Results have been tabulated by an impartial machine.",
]
## How many simulations a program draws from the whole archive.
const PROGRAM_SIZE := {"original": 15, "arcade": 10}

var app


func _init(app_in) -> void:
	app = app_in


## The minigame list for a mode, always in random order (cosmetic randomness).
func program_list(mode, last_id: String = "") -> Array:
	var pool := Registry.games()
	if mode is Dictionary:
		var ids: Array = mode.get("ids", [])
		pool = pool.filter(func(G): return G.META.id in ids)
	var list := pool.duplicate()
	list.shuffle()
	if list.size() > 1 and list[0].META.id == last_id:
		list.append(list.pop_front())
	if mode is String and PROGRAM_SIZE.has(mode):
		list = list.slice(0, PROGRAM_SIZE[mode])
	return list


## Run a full program; returns when the final screen is dismissed or the program aborted.
func play_program(mode) -> void:
	var list := program_list(mode, app.last_game_id)
	var ceremony: bool = mode is String and mode == "original"
	for p in app.players:
		p.reset_stats()
	if ceremony:
		await app.screens.monologue(INTRO_LINES)
	for i in list.size():
		await app.screens.roulette(list[i], i, list.size(), Registry.games())
		var outcome: String = await play_round(list[i], i, list.size())
		if outcome == "quit":
			app.show_backdrop()
			return
		await app.screens.points_screen(app.players, app.last_results, {"game": list[i], "round_index": i, "total": list.size()})
	if ceremony:
		await app.screens.monologue(OUTRO_LINES, "CONCLUSION")
	app.show_backdrop()
	await app.screens.final_screen(app.players, ceremony)


func _build(G, seed_value: int, lockstep: bool) -> Minigame:
	Rng.seed_random(seed_value)
	var g: Minigame = G.new({"engine": app, "hud": app.hud, "players": app.players,
		"bot_difficulty": BOT_LEVELS[clampi(int(app.settings.botLevel), 0, 2)], "lockstep": lockstep})
	g.build()
	g.prewarm()
	app.set_scene(g, g.camera)
	g.state = "preview"
	app.game = g
	return g


## Play one simulation. Returns "done", "skip" or "quit".
func play_round(G, index: int = 0, total: int = 1) -> String:
	var hud: Hud = app.hud
	hud.clear()
	hud.visible = false
	var online: bool = Net.has_remote_players()
	var seed_value := Rng.make_seed()
	var game := _build(G, seed_value, false)
	app.last_game_id = G.META.id
	if online:
		Net.round_start(G, seed_value, app.players, BOT_LEVELS[clampi(int(app.settings.botLevel), 0, 2)])
	Sfx.music("tension")
	if not app.quick:
		await app.screens.title_card(G, index, total)
		await app.screens.briefing(G, game.seats)
	if online:
		# Every device swaps the briefing preview for a fresh, identical copy.
		var seed2 := Rng.make_seed()
		game.dispose()
		app.game = null
		game = _build(G, seed2, true)
		Net.round_prepare(seed2)
	hud.set_players(game.seats)
	hud.visible = true
	if app.touch:
		app.touch.set_context("play")
	await app.screens.countdown()
	Haptics.round_active = true
	if online:
		Net.lockstep_start(game)
	else:
		game.begin()
	Sfx.music("none")
	app.take_pause_choice()

	# Wait for the round to finish, or for a pause-menu decision.
	var choice := ""
	while game.result_tiers == null:
		await app.get_tree().process_frame
		choice = app.take_pause_choice()
		if choice != "":
			break
	if app.touch:
		app.touch.set_context("")
	Haptics.round_active = false

	var result := "done"
	app.last_results = null
	if choice == "":
		app.last_results = score_round(game, game.result_tiers, G)
		hud.visible = false
		await app.get_tree().create_timer(1.4).timeout
	else:
		result = choice
	if online:
		Net.lockstep_stop()
		Net.round_end()
	app.game = null
	game.dispose()
	hud.clear()
	hud.visible = false
	app.show_backdrop()
	Sfx.music("menu")
	return result


## Convert placement tiers into points and update player records.
static func score_round(game: Minigame, tiers: Array, G) -> Array:
	var table: Array = Player.PLACEMENT_POINTS.get(game.seats.size(), Player.PLACEMENT_POINTS[4])
	var results := []
	var pos := 0
	for tier in tiers:
		var points: int = table[pos] if pos < table.size() else 0
		for seat in tier:
			var died: bool = not seat.alive
			seat.player.score += points
			if died:
				seat.player.deaths += 1
			seat.player.history.append({"game": G.META.id, "place": pos + 1, "points": points, "died": died})
			results.append({"player": seat.player, "place": pos + 1, "points": points, "died": died})
		pos += tier.size()
	for seat in game.seats:
		var found := false
		for r in results:
			if r.player == seat.player:
				found = true
		if not found:
			seat.player.history.append({"game": G.META.id, "place": game.seats.size(), "points": 0, "died": not seat.alive})
			results.append({"player": seat.player, "place": game.seats.size(), "points": 0, "died": not seat.alive})
	return results

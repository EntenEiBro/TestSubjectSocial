extends Node
## Online play (autoload "Net"). Placeholder until the EOS layer is ported:
## offline answers for everything the game asks.

func pump() -> void:
	pass

func has_remote_players() -> bool:
	return false

func is_client() -> bool:
	return false

func lockstep_active() -> bool:
	return false

func lockstep_update(_dt: float) -> void:
	pass

func lockstep_start(game) -> void:
	game.begin()

func lockstep_stop() -> void:
	pass

func round_start(_G, _seed_value: int, _players: Array, _bot: float) -> void:
	pass

func round_prepare(_seed_value: int) -> void:
	pass

func round_end() -> void:
	pass

func stop_hosting() -> void:
	pass

func is_connected_device(_device: String) -> bool:
	return false

func is_live(_device: String) -> bool:
	return false

func run_client(_app, _code: String) -> void:
	pass

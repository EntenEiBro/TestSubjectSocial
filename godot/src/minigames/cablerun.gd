extends Minigame
## CABLE RUN — every subject is plugged into the mains and drags a live
## high-voltage cable behind them. Light cycles, but with paperwork.
##
## Rules
##  - Subjects never stop: they run along their heading at constant speed and
##    steer with the stick (limited, smoothed turn rate). Stick = desired
##    heading (up = away from the camera).
##  - Everyone starts at the central junction box running outward on
##    diverging headings; steering is ignored for the first 0.6 s.
##  - A = short sprint boost (cooldown 3 s). No shove in this round.
##  - Each subject's cable is recorded as a polyline (a point every 0.12 s).
##    It is a finite cord: the oldest end unplugs behind you. The cord holds
##    6 s of running at GO and grows to 20 s, so the pen fills up gradually.
##  - Touching any rival's cable, your own cable (except the slack right
##    behind you) or the electrified perimeter fence = electrocuted ('burn').
##  - After 25 s the speed ramps up (+65 % over 30 s).
##  - Last subject standing wins. Hard cap 70 s: survivors share first place,
##    the dead are ranked by survival time (default placement()).
##
## Implementation notes
##  - No Arena physics (no shove, no body separation). Positions live in
##    seat.cr; movement is sub-stepped so fast subjects can't tunnel through
##    a cable, and deaths within one sub-step happen simultaneously.
##  - Lethal contact uses exact point-to-segment distances. Bots use a coarse
##    occupancy grid (stamped as cables are laid) for cheap look-ahead probes,
##    and treat rivals' predicted paths (head + heading × time) as obstacles.
## Fence posts, hub, sockets and transformers: blender/props/cablerun.py.

const META := {
	"id": "cablerun",
	"title": "CABLE RUN",
	"tagline": "Every subject is now an extension cord.",
	"category": "Survival",
	"controls": [{"input": "move", "label": "Steer"}, {"input": "a", "label": "Sprint"}],
	"objective": "Be the last subject standing.",
	"rules": [
		"You never stop running. Steer with {MOVE}.",
		"You drag a live cable behind you. It gets longer as the test goes on.",
		"Touching any cable or the fence is fatal — yours included.",
		"Press {A} for a short sprint. The pace rises after 25 seconds.",
	],
}

const HALF_W := 9.0                # arena half-extents (18 × 12)
const HALF_D := 6.0
const BODY_R := 0.24               # head radius vs. the fence
const HIT_R := 0.27                # head-to-cable lethal distance
const BASE_SPEED := 3.3            # units / s
const TURN := 3.4                  # max turn rate (rad / s) at base speed
const RAMP_START := 25.0
const RAMP_TIME := 30.0
const RAMP_GAIN := 0.65
const SPRINT_MUL := 1.75
const SPRINT_TIME := 0.55
const SPRINT_CD := 3.0
const REC_DT := 0.12               # cable point interval (s)
const OWN_GRACE := 1.1             # own-cable slack (arc length) that is safe
const CAP := 70.0                  # hard time cap (s)
const TRAIL_BASE := 3.5            # cord length in seconds of running (grows over the round)
const TRAIL_GROW := 0.22
const TRAIL_MAX := 16.0
const STEER_LOCK := 0.6            # steering is ignored for the first 0.6 s
const MAX_PTS := 800               # 75 s / 0.12 s ≈ 625 points + margin
const CORE_HALF := 0.07
const GLOW_HALF := 0.32
const CABLE_Y := 0.05
const CELL := 0.25                 # bot occupancy grid
const GW := 72                     # ceil(HALF_W * 2 / CELL)
const GH := 48                     # ceil(HALF_D * 2 / CELL)
const CANDIDATES := [0.0, -0.35, 0.35, -0.75, 0.75, -1.2, 1.2, -1.75, 1.75, -2.5, 2.5]

var wire_base := Color()
var wire_mat: StandardMaterial3D
var xf_lamps := []
var grid := PackedByteArray()      # owner = seat index + 1
var grid_t := PackedFloat32Array() # time stamp of the owner
var ramp_announced := false
var prompt_t := 0.0
var _ff_seen := PackedInt32Array()
var _ff_q := PackedInt32Array()
var _ff_mark := 0


func build() -> void:
	make_scene({"fog_near": 20.0, "fog_far": 56.0})
	make_camera([0, 16, 11], [0, 0, 0.9], 48)

	# --- floor
	Env.floor_plane(scene, 50, 36, {"tex": "concrete", "tile": 3.0})
	Env.floor_plane(scene, HALF_W * 2, HALF_D * 2, {"tex": "plate", "tile": 1.5, "y": 0.005, "color": 0x6a6e6c})
	Env.stencil(scene, "HIGH VOLTAGE", 0, 0.015, 0, {"w": 10.0, "h": 3.4, "opacity": 0.12}).rotation.x = -PI / 2
	Env.hazard_strip(scene, 0, -HALF_D - 0.45, HALF_W * 2 + 1.6, 0.5, 0.01)
	Env.hazard_strip(scene, 0, HALF_D + 0.45, HALF_W * 2 + 1.6, 0.5, 0.01)
	Env.hazard_strip(scene, -HALF_W - 0.45, 0, 0.5, HALF_D * 2, 0.01)
	Env.hazard_strip(scene, HALF_W + 0.45, 0, 0.5, HALF_D * 2, 0.01)

	# --- electrified perimeter fence: posts (Blender model), glowing wires
	scene.add_child(Props.make("cablerun", "fence_posts"))
	var px := HALF_W + 0.08
	var pz := HALF_D + 0.08
	wire_base = U.col(0x6fd0ff)
	wire_mat = Mats.glow(0x6fd0ff)
	for y in [0.3, 0.62]:
		scene.add_child(Env.mesh(Geo.box(HALF_W * 2 + 0.16, 0.03, 0.03), wire_mat, 0, y, -pz, {"cast": false}))
		scene.add_child(Env.mesh(Geo.box(HALF_W * 2 + 0.16, 0.03, 0.03), wire_mat, 0, y, pz, {"cast": false}))
		scene.add_child(Env.mesh(Geo.box(0.03, 0.03, HALF_D * 2 + 0.16), wire_mat, -px, y, 0, {"cast": false}))
		scene.add_child(Env.mesh(Geo.box(0.03, 0.03, HALF_D * 2 + 0.16), wire_mat, px, y, 0, {"cast": false}))

	# --- set dressing: back wall, conduits, transformers
	scene.add_child(Env.mesh(Geo.plane(44, 10), Mats.mat(0xffffff, Tex.wall(Vector2(11, 2.5))), 0, 4, -HALF_D - 3.2, {"cast": false}))
	Env.stencil(scene, "MIND THE CABLE", 0, 2.6, -HALF_D - 3.1, {"w": 8.0, "h": 2.2, "opacity": 0.55})
	Env.pipe(scene, [-20, 5, -HALF_D - 2.9], [20, 5, -HALF_D - 2.9], 0.22)
	Env.pipe(scene, [-20, 4.3, -HALF_D - 2.95], [20, 4.3, -HALF_D - 2.95], 0.1, 0x2c3a44)
	var lamp_mat := Mats.glow(0xff3a20)
	for sx in [-1.0, 1.0]:
		var xf := Props.make("cablerun", "transformer")
		xf.position = Vector3(sx * (HALF_W + 2.6), 0, -HALF_D - 1.6)
		scene.add_child(xf)
		var l := Env.mesh(Geo.sphere(0.12, 6, 4), lamp_mat, sx * (HALF_W + 2.6), 1.7, -HALF_D - 0.72, {"cast": false})
		scene.add_child(l)
		xf_lamps.append(l)
	Env.stencil(scene, "DANGER", -(HALF_W + 2.6), 0.9, -HALF_D - 0.74, {"w": 1.8, "h": 0.6, "opacity": 0.8, "color": "#e8c33a"})
	Env.stencil(scene, "DANGER", HALF_W + 2.6, 0.9, -HALF_D - 0.74, {"w": 1.8, "h": 0.6, "opacity": 0.8, "color": "#e8c33a"})

	Env.hanging_lamp(scene, -4.5, 8, 0.5, {"intensity": 85.0, "angle": 0.95})
	Env.hanging_lamp(scene, 4.5, 8, 0.5, {"intensity": 85.0, "angle": 0.95})
	Env.hanging_lamp(scene, 0, 8.5, -4, {"intensity": 35.0, "angle": 0.9, "shadow": false})

	# --- occupancy grid for bot probes (owner = seat index + 1, time stamped)
	grid.resize(GW * GH)
	grid.fill(0)
	grid_t.resize(GW * GH)
	grid_t.fill(0.0)

	# --- subjects, sockets, cables
	var glow_tex := _cable_glow_texture()
	var light_geo := Geo.box(0.22, 0.04, 0.22)
	# Everyone starts at the central junction and runs OUTWARD on diverging
	# headings (toward the corners for 4), so nobody shares a lane at GO.
	var n := seats.size()
	var corner := atan2(HALF_W, HALF_D)
	var layouts := {
		1: [PI / 2],
		2: [-PI / 2, PI / 2],
		3: [PI, PI / 3, -PI / 3],
		4: [-PI + corner, PI - corner, corner, -corner],
	}
	var headings: Array = layouts[mini(4, maxi(1, n))]
	scene.add_child(Props.make("cablerun", "hub"))
	for i in n:
		var seat: Dictionary = seats[i]
		# Pinwheel: spokes leave the hub radially, but everyone runs a little
		# clockwise of their spoke. With rotational (not mirror) symmetry,
		# neighbours follow each other instead of turning into each other.
		var radial: float = headings[i % headings.size()]
		var heading := radial + 0.7
		var dx := sin(radial)
		var dz := cos(radial)
		var x := dx * 1.7
		var z := dz * 1.7
		spawn_subject(seat, {"x": x, "z": z, "facing": heading})
		var color := U.col(seat.player.color)

		# Junction socket the cable comes out of.
		var sx := dx * 1.1
		var sz := dz * 1.1
		var sock := Props.make("cablerun", "socket")
		sock.position = Vector3(sx, 0, sz)
		scene.add_child(sock)
		scene.add_child(Env.mesh(light_geo, Mats.glow(color), sx, 0.27, sz, {"cast": false}))

		var core_mat := Mats.glow(color.lerp(Color.WHITE, 0.35), {"double_side": true})
		var glow_mat := Mats.glow(color, {"tex": glow_tex, "opacity": 0.55, "depth_write": false, "additive": true, "double_side": true})
		var ribbons := [_ribbon(GLOW_HALF, glow_mat, CABLE_Y - 0.01, 1), _ribbon(CORE_HALF, core_mat, CABLE_Y, 2)]
		seat["cr"] = {
			"idx": i, "x": x, "z": z, "heading": heading, "turn": 0.0, "speed": 0.0, "boost": 0.0, "cd": 0.0, "rec_t": 0.0,
			"px": [sx, x], "pz": [sz, z], "cum": [0.0, 0.6], "pt": [0.0, 0.0], "tail": 0,
			"nx": [], "nz": [],
			"ribbons": ribbons, "glow_mat": glow_mat, "dirty_from": 0, "settled": false, "spark_t": Rng.rand(0, 0.3),
		}
		_stamp(i, sx, sz, x, z)
		_refresh_cable(seat)

	ramp_announced = false
	prompt_t = 0.0


## Flat ribbon mesh (two vertices per cable point), rebuilt when the cable changes.
func _ribbon(half: float, material: StandardMaterial3D, y: float, order: int) -> Dictionary:
	var mi := MeshInstance3D.new()
	var am := ArrayMesh.new()
	mi.mesh = am
	mi.material_override = material
	mi.position.y = y
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	material.render_priority = order
	scene.add_child(mi)
	return {"mesh": am, "half": half, "mat": material}


func start() -> void:
	hud.banner("POWER ON", 900)
	hud.prompt("{MOVE} steer · {A} sprint")
	prompt_t = 3.5
	Sfx.play("buzz", {"vol": 0.6})


func preview(dt: float) -> void:
	for s in seats:
		s.subject.animate(dt, 0)
	_cosmetics(dt)


# ------------------------------------------------------------------ helpers

func _ramp() -> float:
	return 1.0 + clampf((time - RAMP_START) / RAMP_TIME, 0, 1) * RAMP_GAIN


## Cord length (seconds of running) at the current time.
func _trail() -> float:
	return minf(TRAIL_MAX, TRAIL_BASE + time * TRAIL_GROW)


## Unplug cable points older than the cord length (also for the dead).
func _unplug() -> void:
	var oldest := time - _trail()
	for seat in seats:
		var c: Dictionary = seat.cr
		var pt: Array = c.pt
		var n := pt.size()
		var t: int = c.tail
		while t < n - 2 and pt[t + 1] < oldest:
			t += 1
		if t != c.tail:
			c.tail = t
			# Live cables are rebuilt by update() this frame; a settled dead one here.
			if not seat.alive and c.settled:
				_rebuild(seat)


## Mark grid cells along a cable segment (3×3 neighbourhood per sample).
func _stamp(idx: int, x0: float, z0: float, x1: float, z1: float) -> void:
	var length := U.hypot(x1 - x0, z1 - z0)
	var steps := maxi(1, int(ceil(length / 0.12)))
	for s in steps + 1:
		var t := float(s) / steps
		var gx := int(floor((x0 + (x1 - x0) * t + HALF_W) / CELL))
		var gz := int(floor((z0 + (z1 - z0) * t + HALF_D) / CELL))
		for dz in range(-1, 2):
			var zz := gz + dz
			if zz < 0 or zz >= GH:
				continue
			for dx in range(-1, 2):
				var xx := gx + dx
				if xx < 0 or xx >= GW:
					continue
				grid[zz * GW + xx] = idx + 1
				grid_t[zz * GW + xx] = time


## Lethal contact test for one seat's head. Returns null or {type, by}.
func _hit_test(seat: Dictionary) -> Variant:
	var c: Dictionary = seat.cr
	var x: float = c.x
	var z: float = c.z
	if absf(x) > HALF_W - BODY_R or absf(z) > HALF_D - BODY_R:
		return {"type": "wall", "by": null}
	var r2 := HIT_R * HIT_R
	for o in seats:
		var oc: Dictionary = o.cr
		var px: Array = oc.px
		var pz: Array = oc.pz
		var n := px.size()
		var own: bool = oc.idx == c.idx
		var last := n - 1
		if own:
			var cum: Array = oc.cum
			var head_cum: float = cum[n - 1] + U.hypot(x - px[n - 1], z - pz[n - 1])
			while last > 0 and head_cum - cum[last] < OWN_GRACE:
				last -= 1
		for i in range(oc.tail, last):
			# cheap reject: both ends far away on one axis
			var ax: float = px[i]
			var bx: float = px[i + 1]
			if (ax - x > 1.5 and bx - x > 1.5) or (x - ax > 1.5 and x - bx > 1.5):
				continue
			if _seg_dist2(x, z, ax, pz[i], bx, pz[i + 1]) < r2:
				return {"type": "own" if own else "cable", "by": o}
		# The live end (last laid point → owner's head) is cable too.
		if not own and _seg_dist2(x, z, px[n - 1], pz[n - 1], oc.x, oc.z) < r2:
			return {"type": "cable", "by": o}
	return null


func _electrocute(seat: Dictionary, hit: Dictionary) -> void:
	var c: Dictionary = seat.cr
	var n: int = c.px.size()
	_stamp(c.idx, c.px[n - 1], c.pz[n - 1], c.x, c.z)
	seat.subject.root.position = Vector3(c.x, 0, c.z)
	fx.sparks(Vector3(c.x, 0.5, c.z), {"color": 0x9fe4ff, "count": 16, "speed": 7.0})
	fx.sparks(Vector3(c.x, 1.2, c.z), {"color": 0xffffff, "count": 8, "speed": 4.0})
	Sfx.play("buzz", {"vol": 0.9})
	kill(seat, "burn", {"dir": Vector3(sin(c.heading), 0, cos(c.heading)), "quiet": true})
	var nm: String = seat.player.name()
	var msg := ""
	if hit.type == "wall":
		msg = "%s hugged the fence" % nm
	elif hit.type == "own":
		msg = "%s tripped over their own cable" % nm
	else:
		msg = "%s touched %s's cable" % [nm, hit.by.player.name()]
	hud.feed(msg, seat.player.color)
	c.speed = 0.0
	c.turn = 0.0
	c.boost = 0.0


## Recompute the ribbon edge normals that changed since the last call, then rebuild the meshes.
func _refresh_cable(seat: Dictionary) -> void:
	var c: Dictionary = seat.cr
	var px: Array = c.px
	var pz: Array = c.pz
	var n := px.size()   # vertex n = live head
	var cnx: Array = c.nx
	var cnz: Array = c.nz
	while cnx.size() < n + 1:
		cnx.append(0.0)
		cnz.append(0.0)
	var from := maxi(0, mini(c.dirty_from, n - 1))
	for i in range(from, n + 1):
		var ia := maxi(0, i - 1)
		var ib := mini(n, i + 1)
		var ax: float = px[ia] if ia < n else c.x
		var az: float = pz[ia] if ia < n else c.z
		var bx: float = px[ib] if ib < n else c.x
		var bz: float = pz[ib] if ib < n else c.z
		var tx := bx - ax
		var tz := bz - az
		var l := U.hypot(tx, tz)
		if l < 1e-5:
			tx = sin(c.heading)
			tz = cos(c.heading)
			l = 1.0
		cnx[i] = -tz / l
		cnz[i] = tx / l
	c.dirty_from = n - 1
	_rebuild(seat)


## Write both ribbons' vertices for the live part of the cable (tail .. head).
func _rebuild(seat: Dictionary) -> void:
	var c: Dictionary = seat.cr
	var px: Array = c.px
	var pz: Array = c.pz
	var cnx: Array = c.nx
	var cnz: Array = c.nz
	var n := px.size()
	var tail: int = c.tail
	var count := n - tail + 1
	var rib_a: Dictionary = c.ribbons[0]
	var rib_b: Dictionary = c.ribbons[1]
	var wa: float = rib_a.half
	var wb: float = rib_b.half
	var va := PackedVector3Array()
	var vb := PackedVector3Array()
	var uvs := PackedVector2Array()
	va.resize(count * 2)
	vb.resize(count * 2)
	uvs.resize(count * 2)
	var k := 0
	for i in range(tail, n + 1):
		var x: float = px[i] if i < n else c.x
		var z: float = pz[i] if i < n else c.z
		var nx: float = cnx[i]
		var nz: float = cnz[i]
		va[k] = Vector3(x + nx * wa, 0, z + nz * wa)
		va[k + 1] = Vector3(x - nx * wa, 0, z - nz * wa)
		vb[k] = Vector3(x + nx * wb, 0, z + nz * wb)
		vb[k + 1] = Vector3(x - nx * wb, 0, z - nz * wb)
		uvs[k] = Vector2(0, 0.5)
		uvs[k + 1] = Vector2(1, 0.5)
		k += 2
	var segs := count - 1
	var idx := PackedInt32Array()
	idx.resize(segs * 6)
	for s in segs:
		var a := s * 2
		idx[s * 6] = a
		idx[s * 6 + 1] = a + 2
		idx[s * 6 + 2] = a + 1
		idx[s * 6 + 3] = a + 1
		idx[s * 6 + 4] = a + 2
		idx[s * 6 + 5] = a + 3
	for pair in [[rib_a, va], [rib_b, vb]]:
		var am: ArrayMesh = pair[0].mesh
		am.clear_surfaces()
		if segs < 1:
			continue
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = pair[1]
		arrays[Mesh.ARRAY_TEX_UV] = uvs
		arrays[Mesh.ARRAY_INDEX] = idx
		am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		am.surface_set_material(0, pair[0].mat)


## Purely visual flicker (no game state).
func _cosmetics(_dt: float) -> void:
	var t := clock
	var f := 0.7 + 0.3 * absf(sin(t * 31) * sin(t * 7.3))
	Mats.set_color(wire_mat, Color(wire_base.r * f, wire_base.g * f, wire_base.b * f))
	for l in xf_lamps:
		l.visible = sin(t * 4) > 0
	for seat in seats:
		Mats.set_opacity(seat.cr.glow_mat, 0.45 + 0.15 * sin(t * 12 + seat.cr.idx * 1.7))


# ------------------------------------------------------------------- update

func update(dt: float) -> void:
	_cosmetics(dt)
	var playing := state == "play"
	if playing:
		_simulate(dt)
	else:
		_coast(dt)
	for seat in seats:
		# A dead subject's cable end is frozen: one last refresh, then leave it.
		if seat.alive or not seat.cr.settled:
			_refresh_cable(seat)
			if not seat.alive:
				seat.cr.settled = true
	if not playing:
		return

	if prompt_t > 0:
		prompt_t -= dt
		if prompt_t <= 0:
			hud.prompt("")
	if not ramp_announced and time >= RAMP_START:
		ramp_announced = true
		hud.banner("VOLTAGE RISING", 1400, "danger")
		Sfx.play("horn", {"vol": 0.5})

	for seat in seats:
		var c: Dictionary = seat.cr
		if not seat.alive:
			hud.set_stat(seat, "FRIED")
			hud.set_status(seat, "")
			continue
		hud.set_stat(seat, "SPRINT READY" if c.cd <= 0 else "RECHARGING")
		hud.set_status(seat, "SPRINTING" if c.boost > 0 else "")
	hud.set_timer(maxf(0.0, CAP - time))

	if time >= CAP:
		hud.prompt("")
		hud.banner("TIME UP", 1600)
		Sfx.play("horn")
		end()
		return
	var left := alive_seats().size()
	if check_last_standing():
		hud.prompt("")
		hud.banner("LAST LIVE WIRE" if left == 1 else "TOTAL BLACKOUT", 1800)


func _simulate(dt: float) -> void:
	var ramp := _ramp()
	var base_speed := BASE_SPEED * ramp
	var turn_max := TURN * sqrt(ramp)
	var max_move := 0.0
	for seat in seats:
		if not seat.alive:
			continue
		var c: Dictionary = seat.cr
		var ctrl: Controller = seat.ctrl
		c.cd = maxf(0.0, c.cd - dt)
		c.boost = maxf(0.0, c.boost - dt)
		if ctrl.a_pressed and c.cd <= 0:
			c.boost = SPRINT_TIME
			c.cd = SPRINT_CD
			Sfx.play("whoosh", {"vol": 0.5})
			fx.sparks(Vector3(c.x, 0.2, c.z), {"color": 0x9fe4ff, "count": 5, "speed": 3.0})
		c.speed = base_speed * (SPRINT_MUL if c.boost > 0 else 1.0)
		var mx := ctrl.move_x
		var my := ctrl.move_y
		var want := 0.0
		# Opening grace: everyone runs straight out of the junction first.
		if time >= STEER_LOCK and U.hypot(mx, my) > 0.35:
			want = clampf(U.angle_diff(c.heading, atan2(mx, my)) * 6, -turn_max, turn_max)
		c.turn += (want - c.turn) * U.damp(14, dt)
		max_move = maxf(max_move, c.speed * dt)

	# Sub-stepped movement; everyone hit within one sub-step dies together.
	var n_sub := mini(8, maxi(1, int(ceil(max_move / 0.12))))
	var sdt := dt / n_sub
	for k in n_sub:
		for seat in seats:
			if not seat.alive:
				continue
			var c: Dictionary = seat.cr
			c.heading = U.angle_diff(0, c.heading + c.turn * sdt)
			c.x += sin(c.heading) * c.speed * sdt
			c.z += cos(c.heading) * c.speed * sdt
		var hits := []
		for seat in seats:
			if not seat.alive:
				continue
			var h = _hit_test(seat)
			if h != null:
				hits.append([seat, h])
		for pair in hits:
			_electrocute(pair[0], pair[1])

	# Lay cable, move avatars.
	for seat in seats:
		if not seat.alive:
			continue
		var c: Dictionary = seat.cr
		c.rec_t += dt
		if c.rec_t >= REC_DT and c.px.size() < MAX_PTS - 2:
			c.rec_t -= REC_DT
			var n: int = c.px.size()
			var lx: float = c.px[n - 1]
			var lz: float = c.pz[n - 1]
			c.px.append(c.x)
			c.pz.append(c.z)
			c.pt.append(time)
			c.cum.append(c.cum[n - 1] + U.hypot(c.x - lx, c.z - lz))
			_stamp(c.idx, lx, lz, c.x, c.z)
		c.spark_t -= dt
		if c.spark_t <= 0:
			c.spark_t = 0.25 + Rng.random() * 0.35
			fx.sparks(Vector3(c.x - sin(c.heading) * 0.3, 0.12, c.z - cos(c.heading) * 0.3), {"color": 0xbfe8ff, "count": 2, "speed": 2.5})
		var s: Subject = seat.subject
		s.root.position = Vector3(c.x, 0, c.z)
		s.face_angle(c.heading, dt, 20)
		s.animate(dt, c.speed)
	_unplug()


## Round over: survivors jog to a halt (no more collisions).
func _coast(dt: float) -> void:
	for seat in seats:
		if not seat.alive:
			continue
		var c: Dictionary = seat.cr
		c.speed *= exp(-4 * dt)
		if c.speed < 0.05:
			c.speed = 0.0
		c.x = clampf(c.x + sin(c.heading) * c.speed * dt, -HALF_W + BODY_R, HALF_W - BODY_R)
		c.z = clampf(c.z + cos(c.heading) * c.speed * dt, -HALF_D + BODY_R, HALF_D - BODY_R)
		var s: Subject = seat.subject
		s.root.position = Vector3(c.x, 0, c.z)
		s.face_angle(c.heading, dt, 20)
		s.animate(dt, c.speed)


# ---------------------------------------------------------------------- bots

## Is (x, z) unsafe for `seat` according to the bot's coarse world model?
func _blocked(seat: Dictionary, x: float, z: float, t: float) -> bool:
	if absf(x) > HALF_W - 0.45 or absf(z) > HALF_D - 0.45:
		return true
	var gx := int(floor((x + HALF_W) / CELL))
	var gz := int(floor((z + HALF_D) / CELL))
	var gi := gz * GW + gx
	var who: int = grid[gi]
	var me: int = seat.cr.idx + 1
	if who != 0 and grid_t[gi] > time - _trail() and not (who == me and grid_t[gi] > time - 0.6):
		return true
	for o in seats:
		if o.cr.idx + 1 == me or not o.alive:
			continue
		var oc: Dictionary = o.cr
		var n: int = oc.px.size()
		# Cable not yet laid in the grid: last point → head.
		if _seg_dist2(x, z, oc.px[n - 1], oc.pz[n - 1], oc.x, oc.z) < 0.45 * 0.45:
			return true
		if U.hypot(x - oc.x, z - oc.z) < 0.7:
			return true
		# Predicted path: where the rival's head (and so its cable) will be by
		# the time we get here, plus a safety lead. Crossing it is only "free"
		# if we pass well before the rival does; head-on lines are blocked.
		var reach := minf(maxf(oc.speed, BASE_SPEED) * t, 3) + 0.6
		var ex: float = oc.x + sin(oc.heading) * reach
		var ez: float = oc.z + cos(oc.heading) * reach
		if t < 1.2 and _seg_dist2(x, z, oc.x, oc.z, ex, ez) < 0.5 * 0.5:
			return true
	return false


## Free grid cell for the flood fill (cable-free, unplugged, or our own fresh slack).
func _cell_free(i: int, me: int, young: float, unplugged: float) -> bool:
	var o: int = grid[i]
	return o == 0 or grid_t[i] <= unplugged or (o == me and grid_t[i] > young)


## Open space reachable from (x, z): a capped flood fill over the occupancy
## grid (cables + fence). Light-cycle bots must compare ROOM, not just the
## free distance straight ahead, or they drive into dead-end corridors.
@warning_ignore("integer_division")
func _area(seat: Dictionary, x: float, z: float, limit: int) -> int:
	if _ff_seen.is_empty():
		_ff_seen.resize(GW * GH)
		_ff_seen.fill(0)
		_ff_q.resize(GW * GH)
		_ff_mark = 0
	_ff_mark += 1
	var mark := _ff_mark
	var gx := int(floor((x + HALF_W) / CELL))
	var gz := int(floor((z + HALF_D) / CELL))
	if gx < 2 or gz < 2 or gx >= GW - 2 or gz >= GH - 2:
		return 0
	var me: int = seat.cr.idx + 1
	var young := time - 0.6
	var unplugged := time - _trail()
	var head := 0
	var tail := 0
	var count := 0
	var start := gz * GW + gx
	_ff_seen[start] = mark
	_ff_q[tail] = start
	tail += 1
	while head < tail and count < limit:
		var i: int = _ff_q[head]
		head += 1
		count += 1
		var cx := i % GW
		var cz := (i - cx) / GW
		if cx > 2:
			var j := i - 1
			if _ff_seen[j] != mark and _cell_free(j, me, young, unplugged):
				_ff_seen[j] = mark
				_ff_q[tail] = j
				tail += 1
		if cx < GW - 3:
			var j := i + 1
			if _ff_seen[j] != mark and _cell_free(j, me, young, unplugged):
				_ff_seen[j] = mark
				_ff_q[tail] = j
				tail += 1
		if cz > 2:
			var j := i - GW
			if _ff_seen[j] != mark and _cell_free(j, me, young, unplugged):
				_ff_seen[j] = mark
				_ff_q[tail] = j
				tail += 1
		if cz < GH - 3:
			var j := i + GW
			if _ff_seen[j] != mark and _cell_free(j, me, young, unplugged):
				_ff_seen[j] = mark
				_ff_q[tail] = j
				tail += 1
	return count


## Where the probe path for `theta` is after `dist` units (or null if blocked before).
func _probe_end(seat: Dictionary, theta: float, dist: float) -> Variant:
	var c: Dictionary = seat.cr
	var ramp := _ramp()
	var spd := BASE_SPEED * ramp
	var per_dist := (TURN * sqrt(ramp)) / spd
	var stp := 0.25
	var target: float = c.heading + theta
	var h: float = c.heading
	var x: float = c.x
	var z: float = c.z
	var d := 0.0
	while d < dist:
		h += clampf(target - h, -per_dist * stp, per_dist * stp)
		x += sin(h) * stp
		z += cos(h) * stp
		d += stp
		if _blocked(seat, x, z, d / spd):
			return null
	return Vector2(x, z)


## Free distance along "turn toward heading + theta at full rate, then straight".
func _probe(seat: Dictionary, theta: float, max_d: float) -> float:
	var c: Dictionary = seat.cr
	var ramp := _ramp()
	var spd := BASE_SPEED * ramp
	var per_dist := (TURN * sqrt(ramp)) / spd
	var stp := 0.25
	var target: float = c.heading + theta
	var h: float = c.heading
	var x: float = c.x
	var z: float = c.z
	var d := 0.0
	while d < max_d:
		h += clampf(target - h, -per_dist * stp, per_dist * stp)
		x += sin(h) * stp
		z += cos(h) * stp
		d += stp
		if _blocked(seat, x, z, d / spd):
			return d - stp
	return max_d


func bot_think(seat: Dictionary, dt: float) -> void:
	var c: Dictionary = seat.cr
	var brain: Dictionary = seat.brain
	var mem: Dictionary = brain.memory
	if not mem.has("target"):
		mem.target = c.heading
		mem.t = 0.0
		mem.a_prev = false
	var want_a := false
	mem.t -= dt
	if mem.t <= 0:
		mem.t = 0.03 + brain.reaction * 0.25
		want_a = _bot_plan(seat, mem)
	seat.ctrl.set_move(sin(mem.target), cos(mem.target))
	# Edge-triggered button: alternate so a repeated intent becomes a fresh press.
	seat.ctrl.set_buttons(want_a and not mem.a_prev, false)
	mem.a_prev = want_a and not mem.a_prev


## Pick a heading via look-ahead probes; returns true to request a sprint.
func _bot_plan(seat: Dictionary, mem: Dictionary) -> bool:
	var c: Dictionary = seat.cr
	var brain: Dictionary = seat.brain
	var diff: float = brain.difficulty
	var max_d := 2.5 + diff * 6.5

	# Cut-off (difficulty ≥ 0.6 only): if we are clearly AHEAD of and BESIDE
	# a rival running roughly the same way (never head-on), aim across the
	# line in front of them. The probe still has to call that path free.
	var cut = null
	if diff >= 0.595 and time > 3:
		var mfx := sin(c.heading)
		var mfz := cos(c.heading)
		var best_ahead := INF
		for o in seats:
			if o.cr.idx == c.idx or not o.alive:
				continue
			var oc: Dictionary = o.cr
			var ofx := sin(oc.heading)
			var ofz := cos(oc.heading)
			if mfx * ofx + mfz * ofz < 0.5:
				continue                                     # not parallel enough
			var rx: float = c.x - oc.x
			var rz: float = c.z - oc.z
			var ahead := rx * ofx + rz * ofz                 # how far in front of them we are
			var side := absf(rx * ofz - rz * ofx)            # lateral offset
			if ahead < 1.5 or ahead > 5 or side < 0.8 or side > 3.5:
				continue
			if ahead < best_ahead:
				best_ahead = ahead
				var lead := ahead + 1.2 + diff
				cut = U.angle_diff(c.heading, atan2(oc.x + ofx * lead - c.x, oc.z + ofz * lead - c.z))

	# Room behind each option: flood-fill from a point ~1.6 u down that path.
	# Better bots look at more of the room (bigger cap), so they also judge
	# large regions; weaker ones only notice tight dead ends.
	var area_cap := 220 + int(round(diff * 500))
	# Commitment: once a bot has started turning one way it keeps that turn
	# unless the other side is clearly better — flip-flopping between left
	# and right every re-plan means never turning at all (straight into the fence).
	var committed := signf(U.angle_diff(c.heading, mem.target))
	var best_s := -INF
	var best_th := 0.0
	var fwd := 0.0
	for th in CANDIDATES:
		var free_d := _probe(seat, th, max_d)
		if th == 0.0:
			fwd = free_d
		var pend = _probe_end(seat, th, 1.6) if free_d >= 1.6 else null
		var room := float(_area(seat, pend.x, pend.y, area_cap)) / area_cap if pend != null else 0.0
		# Keep away from the fence: margin to the pen edge a little further down this path.
		var far = _probe_end(seat, th, 2.6) if free_d >= 2.6 else pend
		var margin := minf(HALF_W - absf(far.x), HALF_D - absf(far.y)) if far != null else 0.0
		var s: float = free_d + room * max_d * 1.2 + clampf(margin, 0, 3) * 0.9 - absf(th) * 0.15 + Rng.rand(-1, 1) * brain.error * 0.8
		s -= absf(U.angle_diff(mem.target, c.heading + th)) * 0.3   # stay close to the current plan
		if committed != 0.0 and absf(th) > 0.2 and signf(th) != committed:
			s -= 1.5
		if free_d < 1.2:
			s -= 20   # anything that hits a wall/cable almost at once is a last resort
		if cut != null and free_d >= max_d * 0.85:
			s += (diff - 0.5) * 4 * maxf(0.0, 1.0 - absf(th - cut) / 0.9)
		if s > best_s:
			best_s = s
			best_th = th
	mem.target = c.heading + best_th

	if c.cd > 0 or fwd < max_d * 0.95 or absf(best_th) > 0.4:
		return false
	if cut != null and absf(cut) < 0.6:
		return Rng.random() < diff * 0.6
	return Rng.random() < 0.03 + diff * 0.03


## Squared distance from point (x, z) to segment (ax, az)-(bx, bz).
static func _seg_dist2(x: float, z: float, ax: float, az: float, bx: float, bz: float) -> float:
	var dx := bx - ax
	var dz := bz - az
	var l2 := dx * dx + dz * dz
	var t := ((x - ax) * dx + (z - az) * dz) / l2 if l2 > 1e-9 else 0.0
	t = clampf(t, 0.0, 1.0)
	var ex := ax + dx * t - x
	var ez := az + dz * t - z
	return ex * ex + ez * ez


## Soft glow falloff across the cable width (u axis), white with alpha. Cached.
static func _cable_glow_texture() -> Dictionary:
	return Tex.image("cableGlow", 64, func(img: Image, s: int):
		for x in s:
			var t := absf((x + 0.5) / s - 0.5) * 2.0   # 0 centre → 1 edge
			var a := maxf(0.0, exp(-t * t * 5.0) - 0.02)
			for y in s:
				img.set_pixel(x, y, Color(1, 1, 1, a)))

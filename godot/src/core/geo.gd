class_name Geo
## Procedural meshes with THREE.js semantics, so stage-building code ports
## one-to-one from the web version:
##
##   Geo.box(w, h, d)                          every face UV 0..1 (like BoxGeometry)
##   Geo.cyl(r_top, r_bottom, h, seg, open, theta_start, theta_len)   axis = Y, centred
##   Geo.cone(r, h, seg, open)
##   Geo.sphere(r, w_seg, h_seg, phi_start, phi_len, theta_start, theta_len)
##   Geo.plane(w, h)                           XY plane facing +Z (PlaneGeometry)
##   Geo.circle(r, seg, theta_start, theta_len)  disc in XY facing +Z
##   Geo.ring(r_in, r_out, seg, theta_start, theta_len)
##   Geo.torus(radius, tube, radial_seg, tubular_seg, arc)  ring around the Z axis (XY plane)
##   Geo.ico(r, detail)  Geo.octa(r)  Geo.tetra(r)
##   Geo.lines(points)                         line segments (pairs of Vector3)
##
## Meshes are cached by their parameters; never modify a returned mesh.

const FRONT_CW := true   # Godot treats clockwise triangles as front faces

static var _cache := {}


static func _cached(key: String, build: Callable) -> Mesh:
	if not _cache.has(key):
		_cache[key] = build.call()
	return _cache[key]


## Emit one triangle so that it faces along the intended normals.
static func _tri(st: SurfaceTool, p: Array, n: Array, uv: Array) -> void:
	var face: Vector3 = (p[1] - p[0]).cross(p[2] - p[0])
	var want: Vector3 = n[0] + n[1] + n[2]
	var order := [0, 1, 2]
	# (b-a)x(c-a) points toward the viewer for counter-clockwise triangles.
	var ccw := face.dot(want) > 0.0
	if ccw == FRONT_CW:
		order = [0, 2, 1]
	for i in order:
		st.set_normal(n[i])
		st.set_uv(uv[i])
		st.add_vertex(p[i])


static func _quad(st: SurfaceTool, p: Array, n: Array, uv: Array) -> void:
	_tri(st, [p[0], p[1], p[2]], [n[0], n[1], n[2]], [uv[0], uv[1], uv[2]])
	_tri(st, [p[0], p[2], p[3]], [n[0], n[2], n[3]], [uv[0], uv[2], uv[3]])


static func box(w: float, h: float, d: float) -> Mesh:
	return _cached("box:%.4f:%.4f:%.4f" % [w, h, d], func():
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		var hx := w * 0.5
		var hy := h * 0.5
		var hz := d * 0.5
		# [normal, u axis, v axis] with u x v = normal
		var faces := [
			[Vector3.RIGHT, Vector3(0, 0, -1), Vector3.UP],
			[Vector3.LEFT, Vector3(0, 0, 1), Vector3.UP],
			[Vector3.UP, Vector3.RIGHT, Vector3(0, 0, -1)],
			[Vector3.DOWN, Vector3.RIGHT, Vector3(0, 0, 1)],
			[Vector3(0, 0, 1), Vector3.RIGHT, Vector3.UP],
			[Vector3(0, 0, -1), Vector3.LEFT, Vector3.UP],
		]
		var ext := Vector3(hx, hy, hz)
		for f in faces:
			var n: Vector3 = f[0]
			var ua: Vector3 = f[1]
			var va: Vector3 = f[2]
			var c := n * absf(ext.dot(n))
			var hu := absf(ext.dot(ua))
			var hv := absf(ext.dot(va))
			var p0 := c - ua * hu - va * hv
			var p1 := c + ua * hu - va * hv
			var p2 := c + ua * hu + va * hv
			var p3 := c - ua * hu + va * hv
			_quad(st, [p0, p1, p2, p3], [n, n, n, n], [Vector2(0, 1), Vector2(1, 1), Vector2(1, 0), Vector2(0, 0)])
		return st.commit())


static func plane(w: float, h: float) -> Mesh:
	return _cached("plane:%.4f:%.4f" % [w, h], func():
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		var n := Vector3(0, 0, 1)
		_quad(st, [Vector3(-w / 2, -h / 2, 0), Vector3(w / 2, -h / 2, 0), Vector3(w / 2, h / 2, 0), Vector3(-w / 2, h / 2, 0)],
			[n, n, n, n], [Vector2(0, 1), Vector2(1, 1), Vector2(1, 0), Vector2(0, 0)])
		return st.commit())


static func cyl(rt: float, rb: float, h: float, seg: int = 16, open: bool = false, theta_start: float = 0.0, theta_len: float = TAU) -> Mesh:
	seg = max(3, seg)
	return _cached("cyl:%.4f:%.4f:%.4f:%d:%s:%.4f:%.4f" % [rt, rb, h, seg, open, theta_start, theta_len], func():
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		var hh := h * 0.5
		var slope := (rb - rt) / h if h != 0.0 else 0.0
		var pts_top := []
		var pts_bot := []
		var nrm := []
		for i in seg + 1:
			var u := float(i) / seg
			var th := theta_start + u * theta_len
			var s := sin(th)
			var c := cos(th)
			# THREE: x = r*sin(theta), z = r*cos(theta)
			pts_top.append(Vector3(rt * s, hh, rt * c))
			pts_bot.append(Vector3(rb * s, -hh, rb * c))
			nrm.append(Vector3(s, slope, c).normalized())
		for i in seg:
			var u0 := float(i) / seg
			var u1 := float(i + 1) / seg
			if rt == 0.0:
				var apex := Vector3(0, hh, 0)
				var na: Vector3 = (nrm[i] + nrm[i + 1]).normalized()
				_tri(st, [pts_bot[i], pts_bot[i + 1], apex], [nrm[i], nrm[i + 1], na], [Vector2(u0, 1), Vector2(u1, 1), Vector2((u0 + u1) / 2, 0)])
			elif rb == 0.0:
				var apex2 := Vector3(0, -hh, 0)
				var nb: Vector3 = (nrm[i] + nrm[i + 1]).normalized()
				_tri(st, [pts_top[i], apex2, pts_top[i + 1]], [nrm[i], nb, nrm[i + 1]], [Vector2(u0, 0), Vector2((u0 + u1) / 2, 1), Vector2(u1, 0)])
			else:
				_quad(st, [pts_bot[i], pts_bot[i + 1], pts_top[i + 1], pts_top[i]], [nrm[i], nrm[i + 1], nrm[i + 1], nrm[i]],
					[Vector2(u0, 1), Vector2(u1, 1), Vector2(u1, 0), Vector2(u0, 0)])
		if not open:
			for cap in [[rt, hh, Vector3.UP], [rb, -hh, Vector3.DOWN]]:
				var r: float = cap[0]
				if r <= 0.0:
					continue
				var y: float = cap[1]
				var n: Vector3 = cap[2]
				var center := Vector3(0, y, 0)
				for i in seg:
					var t0 := theta_start + float(i) / seg * theta_len
					var t1 := theta_start + float(i + 1) / seg * theta_len
					var a := Vector3(r * sin(t0), y, r * cos(t0))
					var b := Vector3(r * sin(t1), y, r * cos(t1))
					_tri(st, [center, a, b], [n, n, n], [Vector2(0.5, 0.5), Vector2(0.5 + sin(t0) * 0.5, 0.5 - cos(t0) * 0.5), Vector2(0.5 + sin(t1) * 0.5, 0.5 - cos(t1) * 0.5)])
		return st.commit())


static func cone(r: float, h: float, seg: int = 16, open: bool = false, theta_start: float = 0.0, theta_len: float = TAU) -> Mesh:
	return cyl(0.0, r, h, seg, open, theta_start, theta_len)


static func sphere(r: float, w_seg: int = 16, h_seg: int = 12, phi_start: float = 0.0, phi_len: float = TAU, theta_start: float = 0.0, theta_len: float = PI) -> Mesh:
	w_seg = max(3, w_seg)
	h_seg = max(2, h_seg)
	return _cached("sph:%.4f:%d:%d:%.4f:%.4f:%.4f:%.4f" % [r, w_seg, h_seg, phi_start, phi_len, theta_start, theta_len], func():
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		var grid := []
		for iy in h_seg + 1:
			var v := float(iy) / h_seg
			var row := []
			for ix in w_seg + 1:
				var u := float(ix) / w_seg
				# THREE SphereGeometry parameterisation
				var x := -r * cos(phi_start + u * phi_len) * sin(theta_start + v * theta_len)
				var y := r * cos(theta_start + v * theta_len)
				var z := r * sin(phi_start + u * phi_len) * sin(theta_start + v * theta_len)
				row.append([Vector3(x, y, z), Vector2(u, v)])
			grid.append(row)
		for iy in h_seg:
			for ix in w_seg:
				var a = grid[iy][ix]
				var b = grid[iy][ix + 1]
				var c = grid[iy + 1][ix + 1]
				var d = grid[iy + 1][ix]
				var pa: Vector3 = a[0]
				var pb: Vector3 = b[0]
				var pc: Vector3 = c[0]
				var pd: Vector3 = d[0]
				var na := pa.normalized() if pa.length() > 0.0 else Vector3.UP
				var nb := pb.normalized() if pb.length() > 0.0 else Vector3.UP
				var nc := pc.normalized() if pc.length() > 0.0 else Vector3.DOWN
				var nd := pd.normalized() if pd.length() > 0.0 else Vector3.DOWN
				if pa.distance_to(pb) > 1e-6:
					_tri(st, [pa, pb, pd], [na, nb, nd], [a[1], b[1], d[1]])
				if pc.distance_to(pd) > 1e-6:
					_tri(st, [pb, pc, pd], [nb, nc, nd], [b[1], c[1], d[1]])
		return st.commit())


static func circle(r: float, seg: int = 16, theta_start: float = 0.0, theta_len: float = TAU) -> Mesh:
	seg = max(3, seg)
	return _cached("circ:%.4f:%d:%.4f:%.4f" % [r, seg, theta_start, theta_len], func():
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		var n := Vector3(0, 0, 1)
		for i in seg:
			var t0 := theta_start + float(i) / seg * theta_len
			var t1 := theta_start + float(i + 1) / seg * theta_len
			var a := Vector3(r * cos(t0), r * sin(t0), 0)
			var b := Vector3(r * cos(t1), r * sin(t1), 0)
			_tri(st, [Vector3.ZERO, a, b], [n, n, n], [Vector2(0.5, 0.5), Vector2(0.5 + cos(t0) * 0.5, 0.5 - sin(t0) * 0.5), Vector2(0.5 + cos(t1) * 0.5, 0.5 - sin(t1) * 0.5)])
		return st.commit())


static func ring(r_in: float, r_out: float, seg: int = 16, theta_start: float = 0.0, theta_len: float = TAU) -> Mesh:
	seg = max(3, seg)
	return _cached("ring:%.4f:%.4f:%d:%.4f:%.4f" % [r_in, r_out, seg, theta_start, theta_len], func():
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		var n := Vector3(0, 0, 1)
		for i in seg:
			var t0 := theta_start + float(i) / seg * theta_len
			var t1 := theta_start + float(i + 1) / seg * theta_len
			var a := Vector3(r_in * cos(t0), r_in * sin(t0), 0)
			var b := Vector3(r_out * cos(t0), r_out * sin(t0), 0)
			var c := Vector3(r_out * cos(t1), r_out * sin(t1), 0)
			var d := Vector3(r_in * cos(t1), r_in * sin(t1), 0)
			var k := r_in / r_out if r_out > 0.0 else 0.0
			_quad(st, [a, b, c, d], [n, n, n, n], [
				Vector2(0.5 + cos(t0) * 0.5 * k, 0.5 - sin(t0) * 0.5 * k), Vector2(0.5 + cos(t0) * 0.5, 0.5 - sin(t0) * 0.5),
				Vector2(0.5 + cos(t1) * 0.5, 0.5 - sin(t1) * 0.5), Vector2(0.5 + cos(t1) * 0.5 * k, 0.5 - sin(t1) * 0.5 * k)])
		return st.commit())


static func torus(radius: float, tube: float, radial_seg: int = 8, tubular_seg: int = 16, arc: float = TAU) -> Mesh:
	radial_seg = max(3, radial_seg)
	tubular_seg = max(3, tubular_seg)
	return _cached("torus:%.4f:%.4f:%d:%d:%.4f" % [radius, tube, radial_seg, tubular_seg, arc], func():
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		var grid := []
		for j in radial_seg + 1:
			var row := []
			for i in tubular_seg + 1:
				var u := float(i) / tubular_seg * arc
				var v := float(j) / radial_seg * TAU
				var p := Vector3((radius + tube * cos(v)) * cos(u), (radius + tube * cos(v)) * sin(u), tube * sin(v))
				var c := Vector3(radius * cos(u), radius * sin(u), 0)
				row.append([p, (p - c).normalized(), Vector2(float(i) / tubular_seg, float(j) / radial_seg)])
			grid.append(row)
		for j in radial_seg:
			for i in tubular_seg:
				var a = grid[j][i]
				var b = grid[j + 1][i]
				var c = grid[j + 1][i + 1]
				var d = grid[j][i + 1]
				_quad(st, [a[0], b[0], c[0], d[0]], [a[1], b[1], c[1], d[1]], [a[2], b[2], c[2], d[2]])
		return st.commit())


static func _poly(key: String, verts: Array, faces: Array, r: float) -> Mesh:
	return _cached(key, func():
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		for f in faces:
			var a: Vector3 = verts[f[0]].normalized() * r
			var b: Vector3 = verts[f[1]].normalized() * r
			var c: Vector3 = verts[f[2]].normalized() * r
			var n := (b - a).cross(c - a).normalized()
			if n.dot(a + b + c) < 0.0:
				n = -n
			_tri(st, [a, b, c], [n, n, n], [Vector2(0, 1), Vector2(1, 1), Vector2(0.5, 0)])
		return st.commit())


static func ico(r: float, detail: int = 0) -> Mesh:
	if detail > 0:
		return sphere(r, 8 + detail * 2, 6 + detail * 2)
	var t := (1.0 + sqrt(5.0)) / 2.0
	var v := [Vector3(-1, t, 0), Vector3(1, t, 0), Vector3(-1, -t, 0), Vector3(1, -t, 0), Vector3(0, -1, t), Vector3(0, 1, t),
		Vector3(0, -1, -t), Vector3(0, 1, -t), Vector3(t, 0, -1), Vector3(t, 0, 1), Vector3(-t, 0, -1), Vector3(-t, 0, 1)]
	var f := [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
		[3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
	return _poly("ico:%.4f" % r, v, f, r)


static func octa(r: float) -> Mesh:
	var v := [Vector3(1, 0, 0), Vector3(-1, 0, 0), Vector3(0, 1, 0), Vector3(0, -1, 0), Vector3(0, 0, 1), Vector3(0, 0, -1)]
	var f := [[0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2], [1, 2, 5], [1, 5, 3], [1, 3, 4], [1, 4, 2]]
	return _poly("octa:%.4f" % r, v, f, r)


static func tetra(r: float) -> Mesh:
	var v := [Vector3(1, 1, 1), Vector3(-1, -1, 1), Vector3(-1, 1, -1), Vector3(1, -1, -1)]
	var f := [[2, 1, 0], [0, 3, 2], [1, 3, 0], [2, 3, 1]]
	return _poly("tetra:%.4f" % r, v, f, r)


## Line segments: `points` = [a0, b0, a1, b1, ...] (not cached).
static func lines(points: Array) -> Mesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_LINES)
	for p in points:
		st.add_vertex(p)
	return st.commit()

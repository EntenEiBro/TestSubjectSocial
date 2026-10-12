"""LASER SWEEP props: the circular chamber wall (tall behind, waist-high in
front, rims, catch rail on posts), the emitter column and the beam lens
housing. The hazard base, glowing bands, beacon and beams stay procedural
in the game (their colours change at runtime)."""
import math

import bmesh
import bpy

from common import Merger, P, bm_box, bm_cyl, bm_torus, game_mat, game_matrix

R = 6.5
COL_R = 0.85
LOW_Y = 0.32
HIGH_Y = 2.4


def open_cyl(r, h, seg, theta_start, theta_len, rep_u, rep_v):
    """THREE CylinderGeometry(r, r, h, seg, 1, true, thetaStart, thetaLength)
    with its UVs (u around, v up) times the texture repeat."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.verify()
    cols = []
    for i in range(seg + 1):
        th = theta_start + i / seg * theta_len
        x, z = r * math.sin(th), r * math.cos(th)
        cols.append((bm.verts.new(P(x, -h / 2, z)), bm.verts.new(P(x, h / 2, z)), i / seg))
    for i in range(seg):
        b0, t0, u0 = cols[i]
        b1, t1, u1 = cols[i + 1]
        f = bm.faces.new((b0, b1, t1, t0))
        f.smooth = True
        for loop, (u, v) in zip(f.loops, ((u0, 0), (u1, 0), (u1, 1), (u0, 1))):
            loop[uv].uv = (u * rep_u, v * rep_v)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # Outward normals (the material is double-sided anyway).
    for f in bm.faces:
        c = f.calc_center_median()
        if f.normal.dot((c[0], c[1], 0)) < 0:
            f.normal_flip()
    return bm


def add_raw(m, part, mat, pos=(0, 0, 0), rot=(0, 0, 0)):
    """Merger.add without the automatic per-face UVs (keeps the part's own UVs)."""
    bmesh.ops.transform(part, matrix=game_matrix(pos, rot), verts=part.verts)
    if mat not in m.mats:
        m.mats.append(mat)
    idx = m.mats.index(mat)
    for f in part.faces:
        f.material_index = idx
    tmp = bpy.data.meshes.new("_merge_tmp")
    part.to_mesh(tmp)
    part.free()
    m.bm.from_mesh(tmp)
    bpy.data.meshes.remove(tmp)


def build(root):
    # --- chamber wall (origin = chamber centre on the floor)
    plate = game_mat(0xffffff, "plate", double=True)
    rust = game_mat(0xffffff, "rust")
    rail_m = game_mat(0x6b6f6a, "metal")
    c = Merger()
    add_raw(c, open_cyl(R + 0.15, 3.4, 32, math.pi / 2, math.pi, 12, 2), plate, pos=(0, 1.7, 0))     # back, tall
    add_raw(c, open_cyl(R + 0.15, 0.9, 32, -math.pi / 2, math.pi, 12, 1), plate, pos=(0, 0.45, 0))   # front, low
    c.add(bm_torus(R + 0.15, 0.08, 4, 40), rust, pos=(0, 0.9, 0), rot=(math.pi / 2, 0, 0))            # low rim
    c.add(bm_torus(R + 0.15, 0.1, 4, 24, math.pi), rust, pos=(0, 3.4, 0), rot=(-math.pi / 2, 0, 0))   # top rim (back half)
    # Catch rail for the head-height beams, on posts along the front.
    c.add(bm_torus(R + 0.12, 0.05, 4, 40), rail_m, pos=(0, HIGH_Y, 0), rot=(math.pi / 2, 0, 0))
    post_h = HIGH_Y - 0.9
    for i in range(7):
        a = i / 6 * math.pi
        c.add(bm_cyl(0.05, 0.05, post_h, 5), rust, pos=(math.cos(a) * (R + 0.12), 0.9 + post_h / 2, math.sin(a) * (R + 0.12)))
    c.finish("chamber", root, pos=(0, 0, 0))

    # --- emitter column (origin on the floor at the column axis)
    metal = game_mat(0x8a8f8c, "metal")
    collar = game_mat(0x2a2b2a, "metal")
    bolt = game_mat(0x1a1b1a)
    e = Merger()
    e.add(bm_cyl(COL_R, COL_R, 3.2, 20), metal, pos=(0, 1.6, 0), uv=0.3)
    for y in (LOW_Y, HIGH_Y):
        e.add(bm_cyl(COL_R + 0.08, COL_R + 0.08, 0.28, 20), collar, pos=(0, y, 0))
        for k in range(12):   # bolt heads round the top of each collar
            a = k / 12 * math.tau
            e.add(bm_cyl(0.03, 0.03, 0.03, 6), bolt, pos=(math.cos(a) * (COL_R + 0.03), y + 0.155, math.sin(a) * (COL_R + 0.03)))
    # Inspection hatch with a vent grille (faces the camera) and the top cap.
    e.add(bm_box(0.42, 0.5, 0.1), collar, pos=(0, 1.95, COL_R - 0.02))
    for k in range(4):
        e.add(bm_box(0.32, 0.03, 0.02), bolt, pos=(0, 1.8 + k * 0.1, COL_R + 0.04))
    e.add(bm_cyl(COL_R - 0.05, COL_R + 0.02, 0.1, 20), metal, pos=(0, 3.2 - 0.05, 0))
    e.finish("emitter", root, pos=(9.5, 0, 0))

    # --- lens housing riding on each beam (centre at the origin, beam along +X)
    lens_m = game_mat(0x3a3c3a, "metal")
    l = Merger()
    l.add(bm_box(0.3, 0.24, 0.3), lens_m)
    l.add(bm_cyl(0.075, 0.075, 0.08, 10), bolt, pos=(0.17, 0, 0), rot=(0, 0, math.pi / 2))
    l.add(bm_box(0.32, 0.03, 0.32), collar, pos=(0, 0.135, 0))
    l.finish("lens", root, pos=(9.5, 0.32, 2.0))

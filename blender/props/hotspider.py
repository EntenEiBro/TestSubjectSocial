"""HOT SPIDER props: the clockwork spider bomb (body + a wind-up key, and
the two leg variants that the game hangs on eight animated hip pivots) and
the pit rim (plate wall, railing, posts). The grate, furnace glow, hazard
band and the spider's blinking eye stay procedural."""
import math

import bmesh
import bpy

from common import Merger, P, bm_box, bm_cyl, bm_sphere, bm_torus, game_mat, game_matrix

R = 7.5


def open_cyl(r, h, seg, rep_u, rep_v):
    """THREE CylinderGeometry(r, r, h, seg, 1, true) with its UVs times the texture repeat."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.verify()
    cols = []
    for i in range(seg + 1):
        th = i / seg * math.tau
        x, z = r * math.sin(th), r * math.cos(th)
        cols.append((bm.verts.new(P(x, -h / 2, z)), bm.verts.new(P(x, h / 2, z)), i / seg))
    for i in range(seg):
        b0, t0, u0 = cols[i]
        b1, t1, u1 = cols[i + 1]
        f = bm.faces.new((b0, b1, t1, t0))
        f.smooth = True
        for loop, (u, v) in zip(f.loops, ((u0, 0), (u1, 0), (u1, 1), (u0, 1))):
            loop[uv].uv = (u * rep_u, v * rep_v)
    bm.normal_update()
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
    shell = game_mat(0x9aa09c, "metal")
    dark = game_mat(0x1b1c1b)
    band = game_mat(0xb5741f, "rust")
    brass = game_mat(0xc9a040, "metal")

    # --- spider body (origin = the spider group's origin, feet level; unscaled:
    # the game scales the whole spider by 1.45 like the web version)
    b = Merger()
    b.add(bm_sphere(0.28, 7, 5), shell, pos=(0, 0.24, -0.05), scale=(1, 0.6, 1.25))
    b.add(bm_box(0.24, 0.15, 0.2), shell, pos=(0, 0.22, 0.3))
    b.add(bm_box(0.5, 0.06, 0.12), band, pos=(0, 0.3, -0.02))
    for x in (-0.06, 0.06):
        b.add(bm_cyl(0, 0.025, 0.12, 4, smooth=False), dark, pos=(x, 0.13, 0.4), rot=(math.pi, 0, 0))
    # rivets along the band and a key socket at the back
    for x in (-0.2, -0.1, 0.1, 0.2):
        b.add(bm_box(0.03, 0.02, 0.03), dark, pos=(x, 0.335, -0.02))
    b.add(bm_cyl(0.035, 0.035, 0.04, 8), dark, pos=(0, 0.405, -0.2))
    body = b.finish("spider", root, pos=(0, 0.6, 0))

    # Wind-up key (child of the body, spins about its shaft).
    k = Merger()
    k.add(bm_cyl(0.016, 0.016, 0.1, 6), brass, pos=(0, 0.05, 0))
    for x in (-0.045, 0.045):
        k.add(bm_torus(0.04, 0.014, 4, 12), brass, pos=(x, 0.12, 0))
    k.finish("spider_key", parent=body, pos=(0, 0.42, -0.2))

    # Legs: one hip pivot each; geometry for the left (-1) and right (+1) side.
    for name, side in (("leg_l", -1), ("leg_r", 1)):
        g = Merger()
        g.add(bm_box(0.34, 0.045, 0.045), dark, pos=(side * 0.15, 0.09, 0), rot=(0, 0, side * 0.6))
        g.add(bm_box(0.045, 0.44, 0.045), dark, pos=(side * 0.36, -0.02, 0), rot=(0, 0, side * 0.35))
        g.add(bm_box(0.06, 0.06, 0.06), shell, pos=(0, 0, 0))                         # hip joint
        g.finish(name, root, pos=(side * 0.8, 0.84, 0))

    # --- pit rim: plate wall round the grate, railing torus and 16 posts
    plate = game_mat(0x6b6158, "plate", double=True)
    rust = game_mat(0xffffff, "rust")
    p = Merger()
    add_raw(p, open_cyl(R + 0.9, 1.4, 32, 8, 1), plate, pos=(0, -0.6, 0))
    p.add(bm_torus(R + 0.55, 0.06, 4, 40), rust, pos=(0, 1.0, 0), rot=(math.pi / 2, 0, 0))
    for i in range(16):
        a = i / 16 * math.tau
        p.add(bm_cyl(0.06, 0.06, 1.0, 5), rust, pos=(math.cos(a) * (R + 0.55), 0.5, math.sin(a) * (R + 0.55)))
    p.finish("pit", root, pos=(0, 0, 0))

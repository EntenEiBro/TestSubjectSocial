"""HOT SEAT props: the electric fence post (with insulators at the three wire
heights), the transformer boxes feeding the fence, and the pressure plate's
steel base ring. The glowing pad, its markings and the humming wires stay in
the game (their colours change every frame)."""
import math

import bmesh

from common import Merger, bm_box, bm_cyl, game_mat

PLATE_R = 1.4


def _cyl(rt, rb, h, seg):
    """common.bm_cyl with outward normals recalculated (caps can face inward)."""
    bm = bm_cyl(rt, rb, h, seg)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def build(root):
    metal = game_mat(0x4a4a44, "metal")
    ceramic = game_mat(0xd8d2c0)
    dark = game_mat(0x22221f)

    # ------------------------------------------------------------ fence post
    # Origin = post centre (0.14 x 1.35 x 0.14, the game puts it at y 0.675).
    p = Merger()
    p.add(bm_box(0.14, 1.35, 0.14), metal)
    p.add(bm_box(0.24, 0.04, 0.24), metal, pos=(0, -0.655, 0))
    p.add(bm_box(0.18, 0.05, 0.18), metal, pos=(0, 0.69, 0))
    for h in (0.35, 0.7, 1.05):
        p.add(_cyl(0.1, 0.12, 0.07, 8), ceramic, pos=(0, h - 0.675, 0))
    p.finish("post", root, pos=(0, 0.675, 0))

    # ------------------------------------------------------------ transformer
    # Origin = box centre (1.4 x 1.2 x 1.1, the game sinks it half into the pit
    # floor); the green status light stays in the game.
    body = game_mat(0x5a5f55, "metal")
    hz = game_mat(0xffffff, "hazard")
    t = Merger()
    t.add(bm_box(1.4, 1.2, 1.1, bevel=0.03), body)
    # cooling fins on both sides
    for sx in (-1, 1):
        for k in range(6):
            t.add(bm_box(0.06, 0.9, 0.04), body, pos=(sx * 0.72, -0.05, -0.4 + k * 0.16))
    # insulator bushings on top
    for bx in (-0.4, 0.0, 0.4):
        t.add(_cyl(0.07, 0.09, 0.3, 8), ceramic, pos=(bx, 0.75, -0.2))
        t.add(_cyl(0.03, 0.03, 0.08, 6), dark, pos=(bx, 0.94, -0.2))
    t.add(bm_box(0.6, 0.18, 0.012), hz, pos=(-0.25, 0.32, 0.556))
    t.finish("transformer", root, pos=(3.0, 0.6, 0))

    # ------------------------------------------------- pressure plate base
    # Origin on the floor at the plate centre.
    base = game_mat(0x3a3b38, "metal")
    bolt = game_mat(0x8a8a82)
    b = Merger()
    b.add(_cyl(PLATE_R + 0.18, PLATE_R + 0.24, 0.05, 28), base, pos=(0, 0.025, 0))
    for i in range(8):
        a = i / 8 * math.tau + math.pi / 8
        b.add(_cyl(0.05, 0.05, 0.03, 6), bolt, pos=(math.cos(a) * (PLATE_R + 0.1), 0.06, math.sin(a) * (PLATE_R + 0.1)))
    b.finish("plate_base", root, pos=(-3.0, 0, 0))

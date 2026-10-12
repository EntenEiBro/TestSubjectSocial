"""WINCH RACE props: the lift platform with its winch (+ the crank handle as
a child), the hatch door and one lane-wide segment of each grinder roller
(core, paddles and toothed cutter discs)."""
import math

import bmesh

from common import P, Merger, bm_box, bm_cyl, game_mat

LANE_W = 2.4
DECK_W = LANE_W - 0.35
CRANK_X = 0.66


def bm_star(r_out, r_in, points, depth):
    """Toothed cutter disc (THREE Shape star in the XY plane, extruded along Z, centred)."""
    bm = bmesh.new()
    front, back = [], []
    for i in range(points * 2):
        r = r_in if i % 2 else r_out
        a = i / (points * 2) * math.tau
        x, y = math.cos(a) * r, math.sin(a) * r
        front.append(bm.verts.new(P(x, y, depth / 2)))
        back.append(bm.verts.new(P(x, y, -depth / 2)))
    n = len(front)
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], back[i], back[j], front[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def build(root):
    # --- lift platform (deck, under-beams, back guard rail, winch post + drum).
    # The hazard edge strip, the player stripe and the warning lamp stay in the
    # game (per-lane colours).
    plate = game_mat(0xffffff, "plate")
    frame = game_mat(0x3c3a36, "metal")
    drum = game_mat(0x8a6a3a, "rust")
    m = Merger()
    m.add(bm_box(DECK_W, 0.16, 1.5), plate, pos=(0, -0.08, 0), uv=0.7)       # Tex.plate([1.5, 1])
    for z in (0.35, -0.35):
        m.add(bm_box(DECK_W - 0.2, 0.14, 0.14), frame, pos=(0, -0.25, z))
    for s in (-1, 1):
        m.add(bm_box(0.06, 1.0, 0.06), frame, pos=(s * (DECK_W / 2 - 0.08), 0.5, -0.68))
    m.add(bm_box(DECK_W - 0.1, 0.06, 0.06), frame, pos=(0, 1.0, -0.68))
    m.add(bm_box(0.16, 0.9, 0.16), frame, pos=(CRANK_X, 0.45, 0.12))
    m.add(bm_cyl(0.17, 0.17, 0.26, 10), drum, pos=(CRANK_X, 0.98, 0.12), rot=(math.pi / 2, 0, 0))
    platform = m.finish("platform", root, pos=(0, 2.0, 0))

    # --- crank handle (pivot on the drum axle; the game turns it about Z).
    steel = game_mat(0xb0b2ad, "metal")
    knob = game_mat(0x8a1c14)
    c = Merger()
    c.add(bm_box(0.05, 0.3, 0.04), steel, pos=(0, 0.13, 0))
    c.add(bm_cyl(0.035, 0.035, 0.14, 6), knob, pos=(0, 0.27, 0.06), rot=(math.pi / 2, 0, 0))
    c.add(bm_cyl(0.03, 0.03, 0.05, 6), steel, pos=(0, 0, -0.01), rot=(math.pi / 2, 0, 0))   # hub cap
    c.finish("crank", parent=platform, pos=(CRANK_X, 0.98, 0.27))

    # --- hatch door: hazard plate hinged on its left edge (origin = hinge).
    door = game_mat(0xffffff, "hazard")
    h = Merger()
    h.add(bm_box(1.3, 0.06, 1.1), door, pos=(0.65, -0.03, 0))
    h.add(bm_box(0.24, 0.04, 0.05), frame, pos=(1.15, -0.08, 0.3))              # pull handle
    h.finish("hatch", root, pos=(-0.65, 4.5, 0))

    # --- grinder roller segments (one lane wide, centred on the lane). Disc
    # offsets interleave so the two rollers' cutters mesh without touching.
    core = game_mat(0x8c8e89, "metal")
    blade = game_mat(0xc8cac4, "metal")
    for k, (name, offs) in enumerate((("roller_a", (-0.5, 0.3)), ("roller_b", (-0.3, 0.5)))):
        r = Merger()
        r.add(bm_cyl(0.22, 0.22, LANE_W, 8), core, rot=(0, 0, math.pi / 2))
        for i in range(3):
            r.add(bm_box(LANE_W, 0.07, 0.9), core, rot=(i / 3 * math.pi, 0, 0))
        for off in offs:
            r.add(bm_star(0.58, 0.42, 12, 0.05), blade, pos=(off, 0, 0), rot=(0, math.pi / 2, 0))
        r.finish(name, root, pos=(0, -1.0, -0.4 + k * 0.85))

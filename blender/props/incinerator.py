"""THE INCINERATOR props: brick furnace, conveyor stations (one per belt
length), framed art stands and the five machine parts that ride the belts.

Dimensions follow incinerator.js. The furnace's brick faces use the
placeholder material m_none_2a1d17; the game swaps in its painted brick
texture ("incin-brick"). Picture canvases, the scrolling belt surface, the
grab zone, flames and the furnace glow stay procedural in the game (they are
recoloured / animated per lane).
"""
import math

from common import Merger, bm_box, bm_cyl, bm_torus, empty, game_mat, game_matrix

BELT_Y = 0.85
BELT_D = 1.0
HATCH = 0.08
FURN_W, MOUTH_W, MOUTH_H = 1.9, 1.3, 1.55


def build(root):
    _furnace(root)
    # Belt length = station spacing - 0.7 (6 / 5.2 / 4.6 m for 2 / 3 / 4 players).
    for k, length in enumerate((5.3, 4.5, 3.9)):
        _conveyor(root, length, (-4.0, 0, 3.0 + k * 1.6))
    _art(root)
    _parts(root)


def _furnace(root):
    """Origin = centre of the mouth plane on the floor (fx, 0, FURN_FRONT)."""
    brick = game_mat(0x2a1d17)              # replaced by the painted brick texture
    plate = game_mat(0x3b3a33, "plate")
    flue = game_mat(0x3a352f, "rust")
    side = (FURN_W - MOUTH_W) / 2
    depth = 1.4
    cz = -depth / 2
    m = Merger()
    m.add(bm_box(side, 2.4, depth), brick, pos=(-MOUTH_W / 2 - side / 2, 1.2, cz))
    m.add(bm_box(side, 2.4, depth), brick, pos=(MOUTH_W / 2 + side / 2, 1.2, cz))
    m.add(bm_box(MOUTH_W, 2.4 - MOUTH_H, depth), brick, pos=(0, MOUTH_H + (2.4 - MOUTH_H) / 2, cz))
    m.add(bm_box(FURN_W + 0.2, 0.3, depth + 0.2), plate, pos=(0, 2.55, cz))
    # Flue up into the ceiling (pipe 2.6 -> 7.5).
    m.add(bm_cyl(0.28, 0.28, 4.9, 6, smooth=False), flue, pos=(0, 2.6 + 4.9 / 2, cz))
    m.finish("furnace", root, pos=(-4.0, 0, -1.0))


def _conveyor(root, length, at):
    """Belt frame, legs, rollers, rails and the two end hatches with rubber
    curtains. Origin = belt centre on the floor (x0, 0, BELT_Z)."""
    L = length
    frame = game_mat(0x4a4d48, "metal")
    roller = game_mat(0x2b2b28, "metal")
    rail = game_mat(0x6a5d2c, "metal")
    hatch = game_mat(0x8a8470, "plate")
    stripe = game_mat(0xffffff, "hazard")
    rubber = game_mat(0x161616)
    m = Merger()
    m.add(bm_box(L + 0.2, 0.36, BELT_D + 0.14), frame, pos=(0, BELT_Y - 0.2, 0))
    for sx in (-1, 1):
        for sz in (-1, 1):
            m.add(bm_box(0.1, BELT_Y - 0.4, 0.1), frame, pos=(sx * (L / 2 - 0.2), (BELT_Y - 0.4) / 2, sz * 0.4))
    for sx in (-1, 1):
        m.add(bm_cyl(0.2, 0.2, BELT_D + 0.1, 10), roller, pos=(sx * L / 2, BELT_Y - 0.2, 0), rot=(math.pi / 2, 0, 0))
    for sz in (-1, 1):
        m.add(bm_box(L, 0.12, 0.06), rail, pos=(0, BELT_Y + 0.06, sz * (BELT_D / 2 + 0.04)))
    hatch_w = HATCH * L + 0.12
    for side in (-1, 1):
        hx = side * (L / 2 - hatch_w / 2 + 0.12)
        m.add(bm_box(hatch_w, 1.0, BELT_D + 0.2), hatch, pos=(hx, BELT_Y + 0.5, 0))
        m.add(bm_box(hatch_w + 0.06, 0.08, BELT_D + 0.26), stripe, pos=(hx, BELT_Y + 1.03, 0))
        for k in range(4):
            m.add(bm_box(0.03, 0.8, 0.22), rubber, pos=(hx - side * (hatch_w / 2 + 0.02), BELT_Y + 0.42, -0.36 + k * 0.24))
    m.finish("conveyor_%d" % round(L * 100), root, pos=at)


def _art(root):
    """Framed painting on a little stand (canvas added by the game), one per
    frame finish: gilt, wood, black."""
    stand = game_mat(0x3e2a19, "wood")
    backing = game_mat(0x2a241c)
    frames = [game_mat(0xb8913a, "metal"), game_mat(0x5a3a22, "wood"), game_mat(0x1d1b19, "wood")]
    for k, fm in enumerate(frames):
        m = Merger()
        m.add(bm_box(0.55, 0.07, 0.3), stand, pos=(0, 0.035, 0))
        panel = game_matrix((0, 0.42, -0.02), (-0.14, 0, 0))
        m.add(bm_box(0.78, 0.6, 0.03), backing, pos=(0, 0, -0.02), parent_m=panel)
        m.add(bm_box(0.9, 0.08, 0.07), fm, pos=(0, 0.3, 0), parent_m=panel)
        m.add(bm_box(0.9, 0.08, 0.07), fm, pos=(0, -0.3, 0), parent_m=panel)
        m.add(bm_box(0.08, 0.6, 0.07), fm, pos=(-0.41, 0, 0), parent_m=panel)
        m.add(bm_box(0.08, 0.6, 0.07), fm, pos=(0.41, 0, 0), parent_m=panel)
        m.finish("art_%d" % k, root, pos=(-1.5 + k * 1.1, 0, 6.0))


def _parts(root):
    steel = game_mat(0xc4c8c2, "metal")
    dark = game_mat(0x6a6e6a, "metal")
    rust = game_mat(0xb07048, "rust")
    red = game_mat(0x8a2a1c, "metal")
    z = 7.5

    # Gear: the toothed wheel is its own child ("gear_spin") so it rolls along the belt.
    g = empty("part_gear", root, pos=(-2.0, 0, z))
    m = Merger()
    m.add(bm_cyl(0.28, 0.28, 0.1, 12), steel, rot=(math.pi / 2, 0, 0))
    for i in range(10):
        a = i / 10 * math.tau
        m.add(bm_box(0.11, 0.11, 0.1), steel, pos=(math.cos(a) * 0.32, math.sin(a) * 0.32, 0), rot=(0, 0, a))
    m.add(bm_cyl(0.09, 0.09, 0.16, 8), dark, rot=(math.pi / 2, 0, 0))
    m.finish("gear_spin", g, pos=(0, 0.38, 0))

    # Pipe section with flanges.
    m = Merger()
    m.add(bm_cyl(0.12, 0.12, 0.8, 8), rust, pos=(0, 0.2, 0), rot=(0, 0, math.pi / 2))
    for sx in (-0.4, 0.4):
        m.add(bm_cyl(0.2, 0.2, 0.06, 8), dark, pos=(sx, 0.2, 0), rot=(0, 0, math.pi / 2))
    m.finish("part_pipe", root, pos=(-0.8, 0, z))

    # Valve with hand wheel.
    m = Merger()
    m.add(bm_box(0.32, 0.26, 0.26), dark, pos=(0, 0.13, 0))
    m.add(bm_cyl(0.035, 0.035, 0.3, 6), steel, pos=(0, 0.4, 0))
    m.add(bm_torus(0.22, 0.035, 5, 10), red, pos=(0, 0.6, 0), rot=(math.pi / 2, 0, 0))
    m.add(bm_box(0.44, 0.03, 0.03), red, pos=(0, 0.6, 0))
    m.add(bm_box(0.44, 0.03, 0.03), red, pos=(0, 0.6, 0), rot=(0, math.pi / 2, 0))
    m.finish("part_valve", root, pos=(0.3, 0, z))

    # Piston: cylinder, rod and eye.
    m = Merger()
    m.add(bm_cyl(0.17, 0.17, 0.36, 8), dark, pos=(0, 0.18, 0))
    m.add(bm_cyl(0.06, 0.06, 0.42, 6), steel, pos=(0, 0.55, 0))
    m.add(bm_torus(0.08, 0.03, 4, 8), steel, pos=(0, 0.82, 0))
    m.finish("part_piston", root, pos=(1.3, 0, z))

    # Coil spring (six slightly tilted rings).
    m = Merger()
    for i in range(6):
        m.add(bm_torus(0.16, 0.03, 4, 10), steel, pos=(0, 0.05 + i * 0.08, 0), rot=(math.pi / 2, 0.12 if i % 2 else -0.12, 0))
    m.finish("part_spring", root, pos=(2.3, 0, z))

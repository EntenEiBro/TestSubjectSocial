"""MOTION SENSOR props: the ceiling sentry turret (fixed base, yawing/pitching
head with twin barrels and the lamp cage) and the traffic-light panel."""
import math

from common import Merger, bm_box, bm_cyl, bm_torus, game_mat


def build(root):
    steel = game_mat(0x4c504e, "metal")
    dark = game_mat(0x1c1d1c)

    # Base (origin = the turret's base group): ceiling rod + collar.
    b = Merger()
    b.add(bm_cyl(0.07, 0.07, 0.8, 6), dark, pos=(0, 0.55, 0))
    b.add(bm_cyl(0.32, 0.38, 0.18, 10), steel, pos=(0, 0.1, 0))
    b.finish("turret_base", root, pos=(0, 4.4, 0))

    # Head (origin = the pitch group): housing, side plate, twin barrels along
    # +Z and the wire cage around the signal dome (dome and eye stay procedural:
    # the game recolours them).
    h = Merger()
    h.add(bm_box(0.9, 0.55, 0.95), steel)
    h.add(bm_box(1.08, 0.14, 0.6), dark, pos=(0, 0, -0.1))
    for x in (-0.18, 0.18):
        h.add(bm_cyl(0.055, 0.07, 0.8, 8), dark, pos=(x, -0.1, 0.8), rot=(math.pi / 2, 0, 0))
    h.add(bm_torus(0.31, 0.022, 4, 12), dark, pos=(0, 0.36, 0), rot=(math.pi / 2, 0, 0))
    h.finish("turret_head", root, pos=(2.5, 4.1, 0))

    # Traffic-light panel (lenses stay procedural) with a hood over each lens.
    p = Merger()
    p.add(bm_box(0.8, 2.0, 0.3), game_mat(0x2a2c2a, "metal"))
    for y in (0.6, 0.0, -0.6):
        p.add(bm_box(0.56, 0.04, 0.16), dark, pos=(0, y + 0.27, 0.23))
    p.finish("signal_panel", root, pos=(5.0, 2.6, 0))

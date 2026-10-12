"""CONDEMNED FLOOR props: the rotten floor tile and the wall barricade.

The tile keeps the JS BoxGeometry(TS - GAP, TH, TS - GAP) silhouette
(1.14 x 0.22 x 1.14, pivot = centre of the top face) but is split into three
materials like the JS material array [side, side, top, bottom, side, side]:
the game swaps the top surface ("m_none_8d8774") for its painted crack stages.
"""
import math

from common import Merger, bm_box, bm_cyl, game_mat

TS, GAP, TH = 1.2, 0.06, 0.22


def build(root):
    w = TS - GAP
    top = game_mat(0x8d8774)       # replaced in the game (fresh / cracked / warning faces)
    side = game_mat(0x4f493f)
    bottom = game_mat(0x2a2622)
    t = Merger()
    t.add(bm_box(w, 0.03, w, bevel=0.008), top, pos=(0, -0.015, 0))
    t.add(bm_box(w, 0.17, w), side, pos=(0, -0.115, 0))
    t.add(bm_box(w, 0.02, w), bottom, pos=(0, -0.21, 0))
    t.finish("tile", root, pos=(0, 0, 0))

    # Barricade: two crossed planks nailed over the shaft wall (block positions
    # of the JS version: planks at local z 0.08 / 0.12, rotation z = +-0.35).
    plank = game_mat(0x9a8468, "wood")
    nail = game_mat(0x3a3a36, "metal")
    b = Merger()
    for z, rz in ((0.08, 0.35), (0.12, -0.35)):
        b.add(bm_box(3.2, 0.32, 0.08), plank, pos=(0, 0, z), rot=(0, 0, rz))
        for sx in (-1, 1):
            # nail heads near both plank ends (along the rotated plank axis)
            ex = sx * 1.35 * math.cos(rz)
            ey = sx * 1.35 * math.sin(rz)
            for oy in (-0.08, 0.08):
                b.add(bm_cyl(0.025, 0.025, 0.02, 6), nail, pos=(ex - oy * math.sin(rz), ey + oy * math.cos(rz), z + 0.045), rot=(math.pi / 2, 0, 0))
    b.finish("barricade", root, pos=(0, 3.3, -3))

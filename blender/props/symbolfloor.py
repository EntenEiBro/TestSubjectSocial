"""SYMBOL FLOOR props: the piston-mounted floor plate and the pit spike.

The plate's top face carries its own placeholder material ("m_none_41443f");
the game swaps it for the glowing symbol materials (and their red "doomed"
variants), exactly like the web version's per-face box materials."""
import math

from common import Merger, bm_box, bm_cyl, bm_plane, game_mat

TS, GAP, TH = 1.6, 0.1, 0.3
W = TS - GAP


def _plane(w, h):
    """common.bm_plane with its face normal computed (uv_faces needs it to pick
    the projection axis; without it every U collapses to 0)."""
    bm = bm_plane(w, h)
    for f in bm.faces:
        f.normal_update()
    return bm


def build(root):
    side = game_mat(0x8a8d88, "metal")
    bottom = game_mat(0x2a2a28)
    top = game_mat(0x41443f)                 # replaced in the game
    rod = game_mat(0x6e706a, "metal")
    collar = game_mat(0x3a3b38, "plate")

    # ------------------------------------------------------------- the plate
    # Origin = centre of the plate's top face (the game's tile group origin).
    p = Merger()
    p.add(_plane(W, W), top, pos=(0, 0, 0), rot=(-math.pi / 2, 0, 0))
    p.add(bm_box(W, TH - 0.014, W), side, pos=(0, -0.004 - (TH - 0.014) / 2, 0))
    p.add(bm_box(W - 0.02, 0.01, W - 0.02), bottom, pos=(0, -TH + 0.005, 0))
    # hydraulic piston underneath: mounting flange, collar and the long rod
    p.add(bm_cyl(0.32, 0.32, 0.06, 10), collar, pos=(0, -TH - 0.03, 0))
    p.add(bm_cyl(0.22, 0.22, 0.5, 8), collar, pos=(0, -TH - 0.3, 0))
    p.add(bm_cyl(0.16, 0.16, 6, 6), rod, pos=(0, -TH - 3, 0))
    p.finish("plate", root, pos=(0, 0, 0))

    # -------------------------------------------------------------- pit spike
    # THREE ConeGeometry(0.18, 1.1, 4) on a small welded base; origin = cone centre.
    spike = game_mat(0x6b6d68, "metal")
    rust = game_mat(0xffffff, "rust")
    s = Merger()
    s.add(bm_cyl(0, 0.18, 1.1, 4, smooth=False), spike)
    s.add(bm_cyl(0, 0.07, 0.3, 4, smooth=False), rust, pos=(0, 0.42, 0))
    s.add(bm_box(0.42, 0.06, 0.42), rust, pos=(0, -0.55, 0), rot=(0, math.pi / 4, 0))
    s.finish("spike", root, pos=(2.5, -8.5, 0))

"""LIVE ORDNANCE props: the dynamite bundle with its timer (the blinking LED
stays in the game) and the generator in the middle of the pen."""
import math

from common import Merger, bm_box, bm_cyl, bm_plane, bm_torus, game_mat

GEN_H = 0.9


def build(root):
    # ------------------------------------------------------------- the bomb
    # Three sticks of dynamite, two tape bands, a timer box and a wire loop.
    # Origin = bundle centre (unscaled; the game scales it by 1.3).
    stick = game_mat(0xa3271b, "fabric")
    tape = game_mat(0x1d1d1b)
    timer = game_mat(0x2c2f2c, "metal")
    wire = game_mat(0xd8b02a)
    fuse = game_mat(0xd8d2c0)
    face = game_mat(0x1a2a1a)
    b = Merger()
    for y, z in ((0, -0.08), (0, 0.08), (0.135, 0)):
        b.add(bm_cyl(0.075, 0.075, 0.5, 10), stick, pos=(0, y, z), rot=(0, 0, math.pi / 2))
        # paper end caps
        for sx in (-0.252, 0.252):
            b.add(bm_cyl(0.07, 0.07, 0.006, 10), fuse, pos=(sx, y, z), rot=(0, 0, math.pi / 2))
    for x in (-0.15, 0.15):
        b.add(bm_box(0.06, 0.3, 0.33), tape, pos=(x, 0.065, 0))
    b.add(bm_box(0.2, 0.07, 0.13), timer, pos=(0, 0.24, 0))
    b.add(bm_box(0.11, 0.004, 0.07), face, pos=(-0.03, 0.2765, 0))
    b.add(bm_torus(0.07, 0.012, 4, 10, arc=math.pi), wire, pos=(-0.05, 0.27, 0))
    # red / blue leads from the timer into the sticks
    b.add(bm_cyl(0.008, 0.008, 0.16, 4), game_mat(0x9a1a12), pos=(0.09, 0.2, 0.06), rot=(0.5, 0, 0.3))
    b.add(bm_cyl(0.008, 0.008, 0.16, 4), game_mat(0x1a3a8a), pos=(0.09, 0.2, -0.06), rot=(-0.5, 0, 0.3))
    b.finish("bomb", root, pos=(0, 1.0, 0))

    # ------------------------------------------------------------ generator
    # Origin on the floor at its centre (2.2 x 0.9 footprint, GEN_H tall).
    body = game_mat(0x8a8f84, "metal")
    haz = game_mat(0xffffff, "hazard")
    dark = game_mat(0x3a3c38, "plate")
    black = game_mat(0x1c1c1a)
    g = Merger()
    g.add(bm_box(2.2, GEN_H - 0.08, 0.9, bevel=0.03), body, pos=(0, GEN_H / 2 + 0.04, 0))
    # skid rails
    for z in (-0.36, 0.36):
        g.add(bm_box(2.3, 0.08, 0.12), black, pos=(0, 0.04, z))
    top = bm_plane(2.0, 0.7)
    for f in top.faces:
        f.normal_update()   # uv_faces needs the face normal (bm_plane leaves it zero)
    g.add(top, haz, pos=(0, GEN_H + 0.01, 0), rot=(-math.pi / 2, 0, 0), uv=1.0)
    # control box with an exhaust stack
    g.add(bm_box(0.3, 0.3, 0.5), dark, pos=(-0.7, GEN_H + 0.15, 0))
    g.add(bm_cyl(0.05, 0.05, 0.35, 8), black, pos=(-0.78, GEN_H + 0.45, -0.15))
    g.add(bm_cyl(0.065, 0.065, 0.04, 8), black, pos=(-0.78, GEN_H + 0.63, -0.15))
    # vent slats on the long sides
    for side in (-1, 1):
        for k in range(5):
            g.add(bm_box(0.08, 0.36, 0.02), black, pos=(0.25 + k * 0.16, 0.46, side * 0.455))
        g.add(bm_box(0.5, 0.22, 0.015), dark, pos=(-0.55, 0.5, side * 0.455))
    # fuel cap
    g.add(bm_cyl(0.07, 0.07, 0.05, 8), black, pos=(0.75, GEN_H + 0.03, 0.18))
    g.finish("generator", root, pos=(3.0, 0, 0))

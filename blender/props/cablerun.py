"""CABLE RUN props: the electrified fence posts, the central junction hub,
the per-subject wall sockets and the two step-down transformers.

Dimensions follow cablerun.js (HALF_W = 9, HALF_D = 6). The glowing fence
wires, the socket lights (player colour) and the blinking transformer lamps
stay procedural in the game because their materials change during play.
"""
import math

from common import Merger, bm_box, bm_cyl, game_mat

HALF_W, HALF_D = 9.0, 6.0


def build(root):
    metal = game_mat(0xffffff, "metal")
    ceramic = game_mat(0xc9c2a8)
    dark = game_mat(0x2b2d2b, "metal")

    # --- Fence posts (one mesh): 0.12 m square posts with insulator caps
    # every 1.5 m around the pen, plus a bolted foot plate.
    m = Merger()
    px, pz = HALF_W + 0.08, HALF_D + 0.08

    def add_post(x, z):
        m.add(bm_box(0.12, 0.8, 0.12), metal, pos=(x, 0.4, z))
        m.add(bm_cyl(0.07, 0.07, 0.1, 6), ceramic, pos=(x, 0.82, z))
        m.add(bm_box(0.22, 0.03, 0.22), dark, pos=(x, 0.015, z))

    x = -HALF_W
    while x <= HALF_W + 1e-6:
        add_post(x, -pz)
        add_post(x, pz)
        x += 1.5
    z = -HALF_D + 1.5
    while z < HALF_D - 1e-6:
        add_post(-px, z)
        add_post(px, z)
        z += 1.5
    m.finish("fence_posts", root)

    # --- Central junction hub: the floor disc of the JS version, a ring of
    # bolts and a low armoured junction housing in the middle.
    h = Merger()
    h.add(bm_cyl(0.75, 0.85, 0.04, 10), dark, pos=(0, 0.02, 0))
    bolt = game_mat(0x6a6c66, "metal")
    for i in range(10):
        a = i / 10 * math.tau + math.pi / 10
        h.add(bm_cyl(0.045, 0.045, 0.03, 6), bolt, pos=(math.cos(a) * 0.66, 0.055, math.sin(a) * 0.66))
    h.add(bm_cyl(0.34, 0.42, 0.16, 10), game_mat(0x3a3c38, "metal"), pos=(0, 0.12, 0))
    h.add(bm_cyl(0.2, 0.26, 0.06, 10), game_mat(0xd9b02a), pos=(0, 0.23, 0))
    h.add(bm_cyl(0.07, 0.07, 0.05, 6), bolt, pos=(0, 0.285, 0))
    h.finish("hub", root, pos=(0, 0, -3))

    # --- Socket the cable comes out of (0.46 x 0.26 x 0.46 box, bevelled,
    # with corner bolts). The coloured status light sits on top in the game.
    s = Merger()
    s.add(bm_box(0.46, 0.26, 0.46, bevel=0.03), game_mat(0x3a3c38, "metal"), pos=(0, 0.13, 0))
    for sx in (-1, 1):
        for sz in (-1, 1):
            s.add(bm_cyl(0.025, 0.025, 0.02, 6), bolt, pos=(sx * 0.17, 0.265, sz * 0.17))
    s.finish("socket", root, pos=(1.5, 0, -3))

    # --- Step-down transformer (2.2 x 2.2 x 1.7 body like the JS block) on a
    # plinth, with cooling fins on both sides, the dark top cover, three
    # porcelain bushings, a rating plate and the bezel of the warning lamp
    # (lamp itself at local (0, 1.7, 0.88) stays procedural: it blinks).
    t = Merger()
    body = game_mat(0x5d6b52, "plate")
    fin = game_mat(0x4e5a45, "metal")
    t.add(bm_box(2.4, 0.12, 1.9), game_mat(0x6a6a64, "concrete"), pos=(0, 0.06, 0))
    t.add(bm_box(2.2, 2.08, 1.7), body, pos=(0, 1.16, 0))
    for sx in (-1, 1):
        for k in range(8):
            fz = -0.7 + k * 0.2
            t.add(bm_box(0.2, 1.6, 0.04), fin, pos=(sx * 1.2, 1.1, fz))
        t.add(bm_box(0.08, 0.08, 1.6), fin, pos=(sx * 1.2, 1.94, 0))
        t.add(bm_box(0.08, 0.08, 1.6), fin, pos=(sx * 1.2, 0.26, 0))
    t.add(bm_box(1.4, 0.3, 1.1), dark, pos=(0, 2.35, 0))
    for bx in (-0.45, 0.0, 0.45):
        t.add(bm_cyl(0.06, 0.06, 0.5, 8), ceramic, pos=(bx, 2.75, 0))
        for k in range(4):
            t.add(bm_cyl(0.12, 0.12, 0.04, 10), ceramic, pos=(bx, 2.58 + k * 0.1, 0))
        t.add(bm_cyl(0.035, 0.035, 0.12, 6), bolt, pos=(bx, 3.06, 0))
    t.add(bm_box(0.62, 0.36, 0.02), game_mat(0xb7b9b4, "metal"), pos=(-0.62, 1.72, 0.86))
    t.add(bm_cyl(0.17, 0.17, 0.06, 10), dark, pos=(0, 1.7, 0.86), rot=(math.pi / 2, 0, 0))
    t.add(bm_box(0.5, 0.05, 0.06), dark, pos=(0.62, 1.5, 0.86))
    t.finish("transformer", root, pos=(6, 0, -3))

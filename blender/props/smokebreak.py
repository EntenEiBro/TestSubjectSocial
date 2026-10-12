"""SMOKE BREAK props: stool, ashtray stand, vending machine, wall clock,
fluorescent fixture, the rail-mounted ceiling turret and the cigarette.

Dimensions follow smokebreak.js. Parts whose material or length changes in
play stay procedural in the game: the glowing tube, the clock hand, the
turret's eye and laser, the vending machine's painted front and the ember.
"""
import math

from common import Merger, bm_box, bm_cyl, bm_sphere, bm_torus, game_mat

STOOL_Y = 0.82


def build(root):
    metal = game_mat(0x6a6c68, "metal")
    dark = game_mat(0x1e1e1c)

    # --- Stool (origin on the floor under the seat centre)
    s = Merger()
    s.add(bm_cyl(0.3, 0.3, 0.08, 12), game_mat(0x6a1c18, "fabric"), pos=(0, STOOL_Y - 0.04, 0))
    s.add(bm_cyl(0.27, 0.27, 0.03, 12), metal, pos=(0, STOOL_Y - 0.095, 0))
    s.add(bm_cyl(0.05, 0.05, STOOL_Y - 0.08, 6), metal, pos=(0, (STOOL_Y - 0.08) / 2, 0))
    s.add(bm_cyl(0.28, 0.3, 0.04, 10), metal, pos=(0, 0.02, 0))
    s.add(bm_torus(0.22, 0.02, 4, 12), metal, pos=(0, 0.32, 0), rot=(math.pi / 2, 0, 0))
    for k in range(3):
        a = k / 3 * math.tau
        s.add(bm_box(0.18, 0.02, 0.02), metal, pos=(math.cos(a) * 0.13, 0.32, math.sin(a) * 0.13), rot=(0, -a, 0))
    s.finish("stool", root, pos=(-6, 0, 0))

    # --- Ashtray stand
    tray = game_mat(0x4a4c48, "metal")
    a = Merger()
    a.add(bm_cyl(0.22, 0.25, 0.04, 10), tray, pos=(0, 0.02, 0))
    a.add(bm_cyl(0.03, 0.03, 0.9, 6), tray, pos=(0, 0.47, 0))
    a.add(bm_cyl(0.2, 0.14, 0.1, 10), tray, pos=(0, 0.95, 0))
    a.add(bm_cyl(0.18, 0.18, 0.01, 10), game_mat(0x5a5852), pos=(0, 0.995, 0))   # ash
    a.add(bm_torus(0.2, 0.012, 4, 12), tray, pos=(0, 1.0, 0), rot=(math.pi / 2, 0, 0))
    a.finish("ashtray", root, pos=(-5, 0, 0))

    # --- Vending machine (origin on the floor at the body centre, front = +Z).
    # The painted front (1.0 x 1.9 at local (-0.05, 1.4, 0.46)) is added by the game.
    v = Merger()
    red = game_mat(0x6e2a22, "metal")
    v.add(bm_box(1.3, 2.5, 0.9), red, pos=(0, 1.25, 0))
    v.add(bm_box(1.1, 0.06, 0.04), dark, pos=(-0.05, 2.38, 0.46))      # window frame
    v.add(bm_box(1.1, 0.06, 0.04), dark, pos=(-0.05, 0.42, 0.46))
    v.add(bm_box(0.05, 2.0, 0.04), dark, pos=(-0.575, 1.4, 0.46))
    v.add(bm_box(0.05, 2.0, 0.04), dark, pos=(0.475, 1.4, 0.46))
    v.add(bm_box(0.14, 0.5, 0.03), game_mat(0x2a2a28, "metal"), pos=(0.57, 1.55, 0.46))   # coin panel
    v.add(bm_box(0.06, 0.1, 0.02), game_mat(0xc9a227), pos=(0.57, 1.72, 0.48))
    for k in range(3):
        v.add(bm_box(0.08, 0.04, 0.02), game_mat(0x8a8a80), pos=(0.57, 1.52 - k * 0.08, 0.48))
    v.add(bm_box(0.8, 0.22, 0.05), dark, pos=(-0.05, 0.22, 0.46))       # delivery flap
    v.add(bm_box(1.32, 0.3, 0.92), game_mat(0x4a1c16, "metal"), pos=(0, 2.65, 0))  # top sign box
    v.add(bm_box(1.0, 0.18, 0.02), game_mat(0xc9a227), pos=(0, 2.65, 0.465))
    for sx in (-0.55, 0.55):
        for sz in (-0.35, 0.35):
            v.add(bm_box(0.08, 0.04, 0.08), dark, pos=(sx, -0.02, sz))
    v.finish("vending", root, pos=(-3.5, 0, 0))

    # --- Wall clock (origin = face centre, face toward +Z)
    c = Merger()
    c.add(bm_cyl(0.42, 0.42, 0.08, 16), game_mat(0xe8e2d0), rot=(math.pi / 2, 0, 0))
    c.add(bm_torus(0.43, 0.04, 4, 16), game_mat(0x222222), pos=(0, 0, 0.02))
    tick = game_mat(0x222222)
    for k in range(12):
        ang = k / 12 * math.tau
        big = k % 3 == 0
        c.add(bm_box(0.025 if big else 0.015, 0.08 if big else 0.05, 0.01), tick,
              pos=(math.sin(ang) * 0.33, math.cos(ang) * 0.33, 0.045), rot=(0, 0, -ang))
    c.add(bm_cyl(0.03, 0.03, 0.02, 8), tick, pos=(0, 0, 0.08), rot=(math.pi / 2, 0, 0))
    c.finish("wall_clock", root, pos=(-2, 2, 0))

    # --- Fluorescent fixture housing, 6 m (the glowing tube is added by the game)
    f = Merger()
    f.add(bm_box(6.0, 0.08, 0.3), game_mat(0x2c2c2a), pos=(0, 0, 0))
    for sx in (-1, 1):
        f.add(bm_box(0.06, 0.12, 0.3), game_mat(0x3a3a36, "metal"), pos=(sx * 2.97, -0.04, 0))
        f.add(bm_cyl(0.012, 0.012, 1.2, 4), game_mat(0x3a3a36, "metal"), pos=(sx * 2.4, 0.64, 0))
    f.finish("tube_fixture", root, pos=(0, 4.6, -3))

    # --- Ceiling turret: trolley body and the aiming head (origin = pivot).
    b = Merger()
    b.add(bm_box(0.5, 0.3, 0.5), game_mat(0x3d3f3a, "plate"), pos=(0, 0.05, 0))
    b.add(bm_box(0.52, 0.06, 0.52), game_mat(0xc9a227, "hazard"), pos=(0, -0.07, 0))
    b.add(bm_box(0.14, 0.12, 0.34), game_mat(0x2a2a28, "metal"), pos=(0, 0.25, 0))
    for sz in (-0.13, 0.13):
        b.add(bm_cyl(0.05, 0.05, 0.05, 8), dark, pos=(0, 0.36, sz), rot=(0, 0, math.pi / 2))
    b.finish("turret_body", root, pos=(3, 4.3, 0))
    h = Merger()
    gun = game_mat(0x222321, "metal")
    h.add(bm_sphere(0.17, 8, 6), gun)
    h.add(bm_cyl(0.06, 0.07, 0.7, 8), gun, pos=(0, 0, 0.35), rot=(math.pi / 2, 0, 0))
    h.add(bm_cyl(0.085, 0.085, 0.08, 8), gun, pos=(0, 0, 0.66), rot=(math.pi / 2, 0, 0))
    h.add(bm_box(0.12, 0.12, 0.1), game_mat(0x3d3f3a, "plate"), pos=(0.1, 0.08, 0.07))
    h.finish("turret_head", root, pos=(3, 4.1, 0))

    # --- Cigarette: filter (origin at its back end, along +Z) and a 1 m paper
    # tube the game scales to the remaining length.
    cf = Merger()
    cf.add(bm_cyl(0.036, 0.036, 0.08, 6), game_mat(0xc98a3a), pos=(0, 0, 0.04), rot=(math.pi / 2, 0, 0))
    cf.add(bm_cyl(0.037, 0.037, 0.008, 6), game_mat(0xd8b04a), pos=(0, 0, 0.074), rot=(math.pi / 2, 0, 0))
    cf.finish("cig_filter", root, pos=(5, 1, 0))
    cp = Merger()
    cp.add(bm_cyl(0.034, 0.034, 1.0, 6), game_mat(0xf2efe6), pos=(0, 0, 0.5), rot=(math.pi / 2, 0, 0))
    cp.finish("cig_paper", root, pos=(5, 1, 0.08))

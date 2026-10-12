"""SIDEARM ASSEMBLY props: the four pistol parts (gun space), the assembled
pistol, the workbench and the conveyor belt machinery.

Gun space (partModel in sidearm.js): barrel axis along +Z, up = +Y, the
slide's underside at y ~ 0.06. All four parts together form the pistol.
"""
import math

from common import Merger, bm_box, bm_cyl, game_mat

HALF_W = 9.5
BELT_Y = 0.8
BELT_LEN = HALF_W * 2 + 3
BENCH_W, BENCH_D, BENCH_H = 2.1, 0.9, 0.95

PART_COLORS = {"frame": 0x55663f, "slide": 0xb9bdbb, "barrel": 0xc8873a, "magazine": 0x3b62a8}


def add_part(m, kind, parent_m=None):
    """Add one pistol part (THREE geometry of partModel) to merger m."""
    metal = game_mat(PART_COLORS[kind], "metal")
    dark = game_mat(0x1d1e1c)
    kw = {"parent_m": parent_m}
    if kind == "frame":
        m.add(bm_box(0.18, 0.12, 0.6), metal, **kw)
        m.add(bm_box(0.17, 0.42, 0.22), metal, pos=(0, -0.24, -0.17), rot=(-0.25, 0, 0), **kw)
        m.add(bm_box(0.04, 0.1, 0.18), dark, pos=(0, -0.11, 0.04), **kw)            # trigger guard
    elif kind == "slide":
        m.add(bm_box(0.2, 0.16, 0.64), metal, pos=(0, 0.14, 0), **kw)
        for i in range(3):                                                          # serrations
            m.add(bm_box(0.205, 0.12, 0.02), dark, pos=(0, 0.14, -0.27 + i * 0.05), **kw)
        m.add(bm_box(0.03, 0.04, 0.04), dark, pos=(0, 0.24, 0.28), **kw)            # front sight
        m.add(bm_box(0.205, 0.06, 0.14), dark, pos=(0, 0.17, 0.05), **kw)           # ejection port
    elif kind == "barrel":
        m.add(bm_cyl(0.055, 0.055, 0.62, 8), metal, pos=(0, 0.14, 0.08), rot=(math.pi / 2, 0, 0), **kw)
        m.add(bm_cyl(0.075, 0.075, 0.07, 8), metal, pos=(0, 0.14, 0.37), rot=(math.pi / 2, 0, 0), **kw)
        m.add(bm_box(0.13, 0.12, 0.16), metal, pos=(0, 0.14, -0.2), **kw)            # chamber
    elif kind == "magazine":
        m.add(bm_box(0.13, 0.42, 0.18), metal, pos=(0, -0.27, -0.17), rot=(-0.25, 0, 0), **kw)
        m.add(bm_box(0.16, 0.05, 0.22), dark, pos=(0, -0.49, -0.23), rot=(-0.25, 0, 0), **kw)   # base plate
        m.add(bm_cyl(0.035, 0.035, 0.1, 6), game_mat(0xd9b04a), pos=(0, -0.05, -0.12), rot=(math.pi / 2, 0, 0), **kw)


def build(root):
    # --- pistol parts, one object each (gun space, origin = gun origin)
    for k, kind in enumerate(("frame", "slide", "barrel", "magazine")):
        m = Merger()
        add_part(m, kind)
        m.finish("part_" + kind, root, pos=(-1.5 + k * 1.0, 1.2, 3.0))

    # --- the assembled pistol (all four parts in one mesh)
    m = Merger()
    for kind in ("frame", "slide", "barrel", "magazine"):
        add_part(m, kind)
    m.finish("pistol", root, pos=(2.8, 1.2, 3.0))

    # --- workbench (origin: bench centre on the floor; the player stripe,
    # label, part slots and floor mark are added by the game per player)
    wood = game_mat(0xffffff, "wood")
    steel = game_mat(0x4a4d48, "metal")
    peg = game_mat(0x8a7a5c, "fabric")
    vise = game_mat(0x2f4f7f, "metal")
    dark = game_mat(0x1d1e1c)
    tool = game_mat(0x9a9c96, "metal")
    grip = game_mat(0x7c2323)
    b = Merger()
    b.add(bm_box(BENCH_W, 0.12, BENCH_D), wood, pos=(0, BENCH_H - 0.06, 0), uv=1.0)
    for lx, lz in ((-0.95, -0.35), (0.95, -0.35), (-0.95, 0.35), (0.95, 0.35)):
        b.add(bm_box(0.1, BENCH_H - 0.12, 0.1), steel, pos=(lx, (BENCH_H - 0.12) / 2, lz))
    b.add(bm_box(BENCH_W, 0.08, BENCH_D - 0.1), steel, pos=(0, 0.25, 0))                # lower shelf
    b.add(bm_box(BENCH_W, 1.1, 0.06), peg, pos=(0, BENCH_H + 0.55, -BENCH_D / 2 + 0.03))  # pegboard
    # Pegboard holes (dark dots) and two hanging tools at the sides.
    for ix in range(-4, 5):
        for iy in range(5):
            x = ix * 0.22
            y = BENCH_H + 0.12 + iy * 0.2
            if abs(x) < 0.5 and 0.3 < y - BENCH_H < 0.95:
                continue   # leave the player label area clear
            b.add(bm_box(0.025, 0.025, 0.01), dark, pos=(x, y, -BENCH_D / 2 + 0.062))
    # wrench (left)
    b.add(bm_box(0.05, 0.42, 0.02), tool, pos=(-0.74, BENCH_H + 0.5, -BENCH_D / 2 + 0.075), rot=(0, 0, 0.15))
    b.add(bm_box(0.13, 0.08, 0.02), tool, pos=(-0.77, BENCH_H + 0.72, -BENCH_D / 2 + 0.075), rot=(0, 0, 0.15))
    # screwdriver (right)
    b.add(bm_box(0.05, 0.16, 0.03), grip, pos=(0.74, BENCH_H + 0.66, -BENCH_D / 2 + 0.075))
    b.add(bm_box(0.015, 0.24, 0.015), tool, pos=(0.74, BENCH_H + 0.46, -BENCH_D / 2 + 0.075))
    # Vise on the corner: base, fixed + moving jaw, screw and tommy bar.
    b.add(bm_box(0.22, 0.06, 0.3), vise, pos=(-0.85, BENCH_H + 0.03, 0.25))
    b.add(bm_box(0.22, 0.12, 0.07), vise, pos=(-0.85, BENCH_H + 0.12, 0.14))
    b.add(bm_box(0.22, 0.12, 0.07), vise, pos=(-0.85, BENCH_H + 0.12, 0.34))
    b.add(bm_cyl(0.018, 0.018, 0.18, 6), steel, pos=(-0.85, BENCH_H + 0.1, 0.46), rot=(math.pi / 2, 0, 0))
    b.add(bm_cyl(0.012, 0.012, 0.2, 6), steel, pos=(-0.85, BENCH_H + 0.1, 0.55), rot=(0, 0, math.pi / 2))
    b.finish("bench", root, pos=(0, 0, -2.5))

    # --- conveyor (origin: belt centreline on the floor, x = 0). The moving
    # belt surface stays procedural (its texture scrolls).
    frame_m = game_mat(0x46483f, "metal")
    rail_m = game_mat(0x8a7a2a, "metal")
    hood_m = game_mat(0x3a3c36, "plate")
    mouth = game_mat(0x050505, glow=True)
    hopper_m = game_mat(0x5b3a22, "rust")
    roller = game_mat(0x2a2b28, "metal")
    c = Merger()
    seg = BELT_LEN / 6   # six segments = the texture's 6 x 1 repeat
    for i in range(6):
        c.add(bm_box(seg, BELT_Y - 0.1, 1.25), frame_m, pos=(-BELT_LEN / 2 + seg * (i + 0.5), BELT_Y / 2 - 0.05, 0))
    for z in (-0.58, 0.58):
        c.add(bm_box(BELT_LEN, 0.16, 0.08), rail_m, pos=(0, BELT_Y + 0.08, z))
    x = -BELT_LEN / 2 + 0.3
    while x < BELT_LEN / 2:                       # rollers in the gap under the belt
        c.add(bm_cyl(0.045, 0.045, 1.12, 8), roller, pos=(x, BELT_Y - 0.05, 0), rot=(math.pi / 2, 0, 0))
        x += 0.6
    # Feed chute (left): hood with a dark mouth facing the belt (+X) and a strip curtain.
    hx = -HALF_W - 1.2
    c.add(bm_box(1.4, 1.6, 1.6), hood_m, pos=(hx, 1.6, 0))
    c.add(bm_box(0.04, 0.3, 1.3), mouth, pos=(hx + 0.7, 0.95, 0))
    for k in range(6):
        c.add(bm_box(0.02, 0.26, 0.19), roller, pos=(hx + 0.73, 0.96, -0.55 + k * 0.22))
    c.add(bm_box(1.5, 0.08, 1.7), hood_m, pos=(hx, 2.44, 0))       # roof lip
    c.add(bm_cyl(0.12, 0.12, 0.9, 8), hood_m, pos=(hx - 0.2, 2.9, -0.3))   # feed duct
    # Scrap hopper (right): rusty bin with a dark mouth where the belt enters.
    px = HALF_W + 1.2
    c.add(bm_box(1.4, 1.1, 1.6), hopper_m, pos=(px, 0.55, 0))
    c.add(bm_box(0.04, 0.24, 1.2), mouth, pos=(px - 0.7, 0.92, 0))
    c.add(bm_box(1.5, 0.08, 1.7), hopper_m, pos=(px, 1.12, 0))      # rim
    c.finish("conveyor", root, pos=(0, 0, 6.0))

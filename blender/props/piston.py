"""PISTON PRESS props: the hydraulic press (head + rod, the beacon stays in
the game for its per-press colour), the oil barrels and the tyre junk."""
import math

from common import Merger, bm_box, bm_cyl, bm_torus, game_mat

PH = 1.6   # platform half-size (the head covers the platform)


def build(root):
    # ------------------------------------------------------------- the press
    # Origin = bottom of the press head (the game moves it up and down).
    head = game_mat(0x8a8d88, "metal")
    rod = game_mat(0xb9bbb5, "metal")
    haz = game_mat(0xffffff, "hazard")
    collar = game_mat(0x3a3b38, "plate")
    dark = game_mat(0x222321)
    p = Merger()
    p.add(bm_box(PH * 2 - 0.2, 1.0, PH * 2 - 0.2, bevel=0.04), head, pos=(0, 0.5, 0))
    p.add(bm_box(PH * 2 - 0.1, 0.25, PH * 2 - 0.1), haz, pos=(0, 0.12, 0), uv=1.3)
    # stiffening ribs on all four sides of the head
    for k in range(4):
        a = k * math.pi / 2
        for off in (-0.8, 0.8):
            x, z = math.sin(a) * (PH - 0.08), math.cos(a) * (PH - 0.08)
            ox, oz = math.cos(a) * off, -math.sin(a) * off
            p.add(bm_box(0.12, 0.7, 0.08), head, pos=(x + ox, 0.62, z + oz), rot=(0, a, 0))
    # bolts on the top face (the front-right corner carries the game's beacon)
    for bx, bz in ((-1.25, 0), (1.25, 0), (0, -1.25), (0, 1.25), (-1.2, -1.2), (1.2, -1.2), (-1.2, 1.2)):
        p.add(bm_cyl(0.08, 0.08, 0.08, 6), dark, pos=(bx, 1.04, bz))
    p.add(bm_box(1.6, 0.4, 1.6, bevel=0.03), collar, pos=(0, 1.2, 0))
    p.add(bm_cyl(0.6, 0.6, 0.12, 12), dark, pos=(0, 1.46, 0))
    p.add(bm_cyl(0.45, 0.45, 14, 12), rod, pos=(0, 8, 0))
    # hydraulic hoses running up beside the rod
    for sx in (-0.62, 0.62):
        p.add(bm_cyl(0.07, 0.07, 12.5, 6), dark, pos=(sx, 7.6, -0.1))
    p.finish("press", root, pos=(0, 0, 0))

    # ---------------------------------------------------------------- barrels
    rim = game_mat(0x2a2a28)
    for i, color in enumerate((0x2f5c8a, 0x8a2f22, 0x4c6a2a)):
        body = game_mat(color, "metal")
        b = Merger()
        b.add(bm_cyl(0.32, 0.32, 0.85, 12), body)
        for y in (-0.25, 0.25):
            b.add(bm_cyl(0.335, 0.335, 0.05, 12), rim, pos=(0, y, 0))
        b.add(bm_cyl(0.33, 0.33, 0.03, 12), rim, pos=(0, 0.425, 0))
        b.add(bm_cyl(0.33, 0.33, 0.03, 12), rim, pos=(0, -0.425, 0))
        b.add(bm_cyl(0.05, 0.05, 0.04, 6), rim, pos=(0.17, 0.445, 0.05))
        b.finish("barrel_%06x" % color, root, pos=(4.0 + i * 0.9, 0.425, 0))

    # ------------------------------------------------------------------- tyre
    # THREE TorusGeometry(0.3, 0.14, 6, 10) (ring in the XY plane; the game lays
    # it flat) with tread blocks around the outside.
    rubber = game_mat(0x1e1d1b, "fabric")
    t = Merger()
    t.add(bm_torus(0.3, 0.14, 8, 14), rubber)
    for k in range(14):
        a = k / 14 * math.tau
        t.add(bm_box(0.07, 0.07, 0.3), rubber, pos=(math.cos(a) * 0.43, math.sin(a) * 0.43, 0), rot=(0, 0, a))
    t.add(bm_cyl(0.17, 0.17, 0.06, 10), rim, pos=(0, 0, 0), rot=(math.pi / 2, 0, 0))
    t.finish("tire", root, pos=(7.0, 0.44, 0))

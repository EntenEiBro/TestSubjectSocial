"""CHISEL TEST props: the workbench, the slab's base plate, the mallet and
chisel the subjects hold, and the ceiling turret (arm + aiming head).
The clay cubes, the cursor, the status lamp and the laser stay in the game
(they pop, blink and recolour per seat)."""
import math

from common import Merger, bm_box, bm_cyl, bm_sphere, game_mat

BENCH_TOP = 0.92


def build(root):
    # ------------------------------------------------------------- workbench
    # Origin on the floor under the bench centre (1.65 x 1.25 top).
    wood = game_mat(0x8a6a48, "wood")
    leg = game_mat(0x3a3a36, "metal")
    hz = game_mat(0xffffff, "hazard")
    b = Merger()
    b.add(bm_box(1.65, 0.1, 1.25, bevel=0.01), wood, pos=(0, BENCH_TOP - 0.05, 0), uv=1.2)
    for dx in (-0.72, 0.72):
        for dz in (-0.5, 0.5):
            b.add(bm_box(0.1, BENCH_TOP - 0.1, 0.1), leg, pos=(dx, (BENCH_TOP - 0.1) / 2, dz))
    b.add(bm_box(1.65, 0.3, 0.04), hz, pos=(0, BENCH_TOP - 0.25, 0.62), uv=1.8)
    # lower stretchers and a shelf board
    for dz in (-0.5, 0.5):
        b.add(bm_box(1.44, 0.06, 0.06), leg, pos=(0, 0.2, dz))
    b.add(bm_box(1.44, 0.04, 0.9), wood, pos=(0, 0.25, 0), uv=1.2)
    b.finish("bench", root, pos=(0, 0, 0))

    # ------------------------------------------------------------ slab base
    plate = game_mat(0x2c2d2b, "plate")
    rim = game_mat(0x4a4c48, "metal")
    s = Merger()
    s.add(bm_box(1.5, 0.08, 1.5), plate)
    for i in range(4):
        a = i * math.pi / 2
        s.add(bm_box(1.54, 0.1, 0.04), rim, pos=(math.sin(a) * 0.75, 0.01, math.cos(a) * 0.75), rot=(0, a, 0))
    s.finish("slab_base", root, pos=(0, 1.04, 2.0))

    # ----------------------------------------------------------- hand tools
    # Mallet in its holder frame (handle along -Y; the game hangs it from the
    # right arm at (0, -0.78, 0.06) turned PI/2 about X).
    handle = game_mat(0x6b4a2a, "wood")
    steel = game_mat(0x7a7c78, "metal")
    m = Merger()
    m.add(bm_cyl(0.025, 0.025, 0.36, 6), handle, pos=(0, -0.12, 0))
    m.add(bm_box(0.2, 0.11, 0.11, bevel=0.01), steel, pos=(0, -0.3, 0))
    m.add(bm_cyl(0.06, 0.06, 0.02, 8), steel, pos=(0.105, -0.3, 0), rot=(0, 0, math.pi / 2))
    m.add(bm_cyl(0.06, 0.06, 0.02, 8), steel, pos=(-0.105, -0.3, 0), rot=(0, 0, math.pi / 2))
    m.finish("mallet", root, pos=(2.5, 1.0, 0))

    # Chisel (blade toward +Z, wooden grip behind; 0.26 long like the JS bar).
    blade = game_mat(0xa0a29c, "metal")
    c = Merger()
    c.add(bm_box(0.03, 0.03, 0.13), blade, pos=(0, 0, 0.065))
    c.add(bm_box(0.04, 0.012, 0.02), blade, pos=(0, 0, 0.135))
    c.add(bm_cyl(0.022, 0.026, 0.13, 6), handle, pos=(0, 0, -0.065), rot=(math.pi / 2, 0, 0))
    c.finish("chisel_tool", root, pos=(3.0, 1.0, 0))

    # ------------------------------------------------------- ceiling turret
    # Arm: hangs from the rail trolley; the head sits at the group origin.
    gun = game_mat(0x4a4c48, "metal")
    body = game_mat(0x3a3328, "rust")
    a = Merger()
    a.add(bm_cyl(0.06, 0.06, 3, 6), gun, pos=(0, 1.6, 0))
    a.add(bm_cyl(0.12, 0.12, 0.12, 8), gun, pos=(0, 0.2, 0))
    a.add(bm_box(0.4, 0.22, 0.34), body, pos=(0, 3.1, 0))
    for dx in (-0.14, 0.14):
        a.add(bm_cyl(0.07, 0.07, 0.05, 8), gun, pos=(dx, 3.25, 0.17), rot=(math.pi / 2, 0, 0))
    a.finish("turret_arm", root, pos=(4.5, 2.0, 0))

    # Head: aims along +Z (two barrels, a red sensor eye, cooling fins).
    eye = game_mat(0xff2a1a, None, glow=True)
    h = Merger()
    h.add(bm_box(0.45, 0.32, 0.5, bevel=0.02), body)
    for dx in (-0.1, 0.1):
        h.add(bm_cyl(0.05, 0.05, 0.55, 8), gun, pos=(dx, 0, 0.45), rot=(math.pi / 2, 0, 0))
        h.add(bm_cyl(0.065, 0.065, 0.08, 8), gun, pos=(dx, 0, 0.7), rot=(math.pi / 2, 0, 0))
    h.add(bm_sphere(0.05, 6, 4), eye, pos=(0, 0.1, 0.26))
    for k in range(4):
        h.add(bm_box(0.47, 0.02, 0.06), gun, pos=(0, -0.08 + k * 0.06, -0.26))
    h.finish("turret_head", root, pos=(4.5, 1.5, 0))

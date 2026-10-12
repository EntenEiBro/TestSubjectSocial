"""SONAR CROSSING props: the field harvester (body + spinning bladed drum +
beacons) and the buried mine."""
import math

from common import Merger, bm_box, bm_cyl, game_mat

HW = 7.0          # field half-width (sonar.js)
DRUM_R = 1.1


def build(root):
    # --- harvester body (one mesh): chassis, hazard hood over the drum, cab,
    # exhaust stacks and four wheels under the chassis. Origin = ground level
    # at the drum axis line; the game moves it along -Z.
    rust = game_mat(0xffffff, "rust")
    hazard = game_mat(0xffffff, "hazard")
    steel = game_mat(0x8a8c86, "metal")
    stack = game_mat(0x222222)
    tyre = game_mat(0x1a1a18)
    hub = game_mat(0x5a5a52, "metal")
    m = Merger()
    m.add(bm_box(HW * 2 + 1.2, 2.2, 3.2), rust, pos=(0, 1.7, 2.6), uv=1 / 3.04)        # Tex.rust([5, 1])
    m.add(bm_box(HW * 2 + 1.2, 0.3, 2.4), hazard, pos=(0, DRUM_R * 2 + 0.25, 0.4), uv=8 / 15.2)  # Tex.hazard([8, 1])
    m.add(bm_box(2.4, 1.4, 1.8), steel, pos=(0, 3.4, 2.8))
    for x in (-4, 4):
        m.add(bm_cyl(0.18, 0.22, 1.6, 6), stack, pos=(x, 3.5, 3.4))
    for x in (-6.7, 6.7):
        for z in (1.7, 3.6):
            m.add(bm_cyl(0.62, 0.62, 0.5, 12), tyre, pos=(x, 0.62, z), rot=(0, 0, math.pi / 2))
            m.add(bm_cyl(0.3, 0.3, 0.52, 8), hub, pos=(x, 0.62, z), rot=(0, 0, math.pi / 2))
    body = m.finish("harvester", root, pos=(0, 0, 8))

    # --- drum (rotates about X): rusty core and 9 x 6 staggered blades.
    core = game_mat(0x5a2e1e, "rust")
    blade = game_mat(0xb8bab2, "metal")
    d = Merger()
    d.add(bm_cyl(DRUM_R * 0.7, DRUM_R * 0.7, HW * 2 + 0.6, 10), core, rot=(0, 0, math.pi / 2))
    for i in range(9):
        x = -HW + (i / 8) * HW * 2
        for k in range(6):
            a = (k / 6) * math.pi * 2 + i * 0.4
            d.add(bm_box(0.08, 0.5, 0.35), blade, pos=(x, math.cos(a) * DRUM_R * 0.9, math.sin(a) * DRUM_R * 0.9), rot=(-a, 0, 0))
    d.finish("drum", parent=body, pos=(0, DRUM_R, 0))

    # --- warning beacons (the game flashes each with its own material).
    beacon = game_mat(0xff9a1a, glow=True)
    for k, x in enumerate((-HW, HW)):
        b = Merger()
        b.add(bm_box(0.35, 0.35, 0.35), beacon)
        b.finish("beacon_%d" % k, parent=body, pos=(x, 3.0, 1.2))

    # --- buried mine: squat metal body with a rusty pressure cap.
    body_m = game_mat(0x3a3c36, "metal")
    cap = game_mat(0x7a2a18, "rust")
    mm = Merger()
    mm.add(bm_cyl(0.26, 0.3, 0.1, 8), body_m, pos=(0, 0.05, 0))
    mm.add(bm_cyl(0.07, 0.07, 0.08, 6), cap, pos=(0, 0.13, 0))
    mm.finish("mine", root, pos=(0, 0, -2))

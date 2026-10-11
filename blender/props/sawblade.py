"""SAWBLADE RICOCHET props: the bouncing circular saw and the wall hacksaws."""
import math

from common import Merger, bm_box, bm_cyl, game_mat


def build(root):
    metal = game_mat(0xc8cac4, "metal")
    tooth = game_mat(0xa8aaa4)
    hub = game_mat(0x333333)
    mark = game_mat(0xd9b02a)
    blade_r = 0.75
    # Circular saw (one mesh): disc, 16 hooked teeth raked in the spin
    # direction (the game turns it counter-clockwise seen from above), two
    # hazard-yellow marks and the hub, so the spin reads clearly.
    m = Merger()
    m.add(bm_cyl(blade_r, blade_r, 0.06, 24), metal)
    for i in range(16):
        a = i / 16 * math.tau
        rake = 0.6   # tilt of each tooth toward the direction of travel
        m.add(bm_cyl(0, 0.11, 0.26, 3, smooth=False), tooth,
              pos=(math.cos(a) * (blade_r + 0.02), 0, math.sin(a) * (blade_r + 0.02)), rot=(0, -a + rake, -math.pi / 2))
    for k in range(2):
        a = k * math.pi
        m.add(bm_box(0.5, 0.012, 0.09), mark, pos=(math.cos(a) * 0.45, 0.036, math.sin(a) * 0.45), rot=(0, -a, 0))
        m.add(bm_box(0.5, 0.012, 0.09), mark, pos=(math.cos(a) * 0.45, -0.036, math.sin(a) * 0.45), rot=(0, -a, 0))
    m.add(bm_cyl(0.2, 0.2, 0.12, 8), hub)
    m.finish("blade", root, pos=(0, 0.7, 0))

    # Reciprocating hacksaw strips (16 m and 11 m), teeth facing local +Z.
    bladem = game_mat(0xb7b9b4, "metal")
    for k, length in enumerate((16.0, 11.0)):
        h = Merger()
        h.add(bm_box(length, 0.18, 0.06), bladem)
        x = -length / 2
        while x < length / 2:
            h.add(bm_cyl(0, 0.07, 0.16, 3, smooth=False), bladem, pos=(x, 0, 0.08), rot=(math.pi / 2, 0, 0))
            x += 0.25
        h.finish("hacksaw_%d" % int(length), root, pos=(0, 0.55, -2.0 - k * 1.2))

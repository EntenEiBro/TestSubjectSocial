"""OPEN SEASON props: the hunter's bolt-action rifle (hangs off the camera)
and the sandbag lip of the sniper nest."""
import math

from common import Merger, bm_box, bm_cyl, game_mat


def build(root):
    # Bolt-action rifle, in the rifle group's local space (the game scales it
    # by 0.62 and hangs it in the lower right of the hunter's view). The
    # player-coloured band and the muzzle point stay procedural.
    wood = game_mat(0xffffff, "wood")
    steel = game_mat(0x6a6e6c, "metal")
    lens = game_mat(0x1a2a30, None, glow=True)
    r = Merger()
    r.add(bm_box(0.09, 0.13, 0.55), wood, pos=(0, -0.02, 0.18))                      # stock
    r.add(bm_box(0.07, 0.08, 0.34), steel, pos=(0, 0.02, -0.22))                     # receiver
    r.add(bm_cyl(0.018, 0.02, 0.8, 6), steel, pos=(0, 0.03, -0.75), rot=(math.pi / 2, 0, 0))   # barrel
    r.add(bm_cyl(0.036, 0.036, 0.34, 8), steel, pos=(0, 0.11, -0.22), rot=(math.pi / 2, 0, 0))  # scope
    r.add(bm_box(0.02, 0.06, 0.02), steel, pos=(0.05, 0.04, -0.12))                  # bolt handle
    r.add(bm_cyl(0.016, 0.016, 0.02, 6), steel, pos=(0.05, 0.008, -0.12))            # bolt knob
    for z in (-0.33, -0.11):                                                         # scope mounts
        r.add(bm_box(0.03, 0.05, 0.03), steel, pos=(0, 0.075, z))
    for z in (-0.392, -0.048):                                                       # scope lenses
        r.add(bm_cyl(0.03, 0.03, 0.004, 8), lens, pos=(0, 0.11, z), rot=(math.pi / 2, 0, 0))
    r.finish("rifle", root, pos=(0, 1.2, 0))

    # Sandbag (1.0 x 0.4 x 0.6, rounded) for the nest's lip.
    bag = game_mat(0x7a6a48, "fabric")
    s = Merger()
    s.add(bm_box(1.0, 0.4, 0.6, bevel=0.09), bag)
    s.finish("sandbag", root, pos=(2.0, 0.2, 0))

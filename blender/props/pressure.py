"""PRESSURE TEST props: hand pump (body + moving T-handle rod), tank base with
the gauge stem, tank frame (cap, struts, bands, vent), dial-gauge housing and
its needle.

Dimensions follow pressure.js. The glass, the liquid (recoloured per seat),
the gauge face (painted dial), shards and the wall warning lamp stay
procedural in the game.
"""
import math

from common import Merger, bm_box, bm_cyl, bm_torus, game_mat

GLASS_H = 1.5


def build(root):
    steel = game_mat(0x8a8e8a, "metal")
    dark = game_mat(0x2e302d, "plate")
    red = game_mat(0x8f2a1e, "metal")
    needle = game_mat(0xc81e14, glow=True)

    # Tank base: plinth + cap, plus the gauge stem. Origin = tank centre on the floor.
    m = Merger()
    m.add(bm_box(1.1, 0.16, 1.1), dark, pos=(0, 0.08, 0))
    m.add(bm_cyl(0.49, 0.49, 0.14, 16), steel, pos=(0, 0.23, 0))
    m.add(bm_cyl(0.045, 0.045, 0.3, 6), steel, pos=(0, 2.02, 0.05))
    m.finish("tank_base", root, pos=(0, 0, 0))

    # Tank frame (swells with the tank): top cap, 4 struts, 2 bands, vent pipe.
    # Origin = bottom of the glass (the game's tank group at y = 0.3).
    m = Merger()
    m.add(bm_cyl(0.49, 0.49, 0.14, 16), steel, pos=(0, GLASS_H + 0.07, 0))
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        m.add(bm_box(0.05, GLASS_H, 0.05), steel, pos=(math.cos(a) * 0.47, GLASS_H / 2, math.sin(a) * 0.47))
    for y in (0.3, 1.2):
        m.add(bm_torus(0.455, 0.025, 4, 18), steel, pos=(0, y, 0), rot=(math.pi / 2, 0, 0))
    m.add(bm_cyl(0.05, 0.05, 0.32, 6), steel, pos=(0.22, GLASS_H + 0.3, -0.22))
    m.finish("tank_frame", root, pos=(1.4, 0.3, 0))

    # Dial gauge housing (faces local +Z) with the needle hub.
    m = Merger()
    m.add(bm_cyl(0.42, 0.44, 0.1, 22), steel, rot=(math.pi / 2, 0, 0))
    m.add(bm_cyl(0.045, 0.045, 0.03, 8), dark, pos=(0, 0, 0.072), rot=(math.pi / 2, 0, 0))
    m.finish("gauge_body", root, pos=(2.8, 2.42, 0))

    # Needle: pivot at the hub, pointing up (local +Y).
    m = Merger()
    m.add(bm_box(0.035, 0.34, 0.012), needle, pos=(0, 0.12, 0))
    m.finish("gauge_needle", root, pos=(2.8, 2.42, 0.4))

    # Hand pump: base plate + barrel, and the rod with its T-handle (origin = handle).
    m = Merger()
    m.add(bm_box(0.4, 0.04, 0.26), dark, pos=(0, 0.02, 0))
    m.add(bm_cyl(0.065, 0.075, 0.64, 8), red, pos=(0, 0.36, 0))
    m.finish("pump_body", root, pos=(-1.4, 0, 0))
    m = Merger()
    m.add(bm_cyl(0.02, 0.02, 0.4, 6), steel, pos=(0, -0.2, 0))
    m.add(bm_box(0.6, 0.05, 0.05), dark)
    m.finish("pump_rod", root, pos=(-1.4, 1.12, 0))

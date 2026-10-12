"""FORKLIFT FRENZY props: the forklift (body + separately moving carriage
with the forks) and the warehouse shelving rack.

The forklift's paint uses the plain white metal material; the game swaps it
for the player's colour on each instance."""
import math

from common import Merger, bm_box, bm_cyl, bm_torus, game_mat


def build(root):
    paint = game_mat(0xffffff, "metal")      # tinted per player in the game
    dark = game_mat(0x2a2b28, "metal")
    black = game_mat(0x141414)
    haz = game_mat(0xffffff, "hazard")
    hub = game_mat(0x6a6c68, "metal")
    lamp = game_mat(0xffe2b0, None, glow=True)

    # ---------------------------------------------------------------- body
    # Forward = +Z, origin on the floor at the forklift's centre.
    f = Merger()
    f.add(bm_box(1.1, 0.5, 1.5, bevel=0.03), paint, pos=(0, 0.5, -0.1))
    f.add(bm_box(1.12, 0.65, 0.42, bevel=0.04), dark, pos=(0, 0.62, -0.88))
    f.add(bm_box(1.0, 0.05, 0.25), haz, pos=(0, 0.78, 0.55))
    for x, z in ((-0.56, 0.42), (0.56, 0.42), (-0.56, -0.62), (0.56, -0.62)):
        f.add(bm_cyl(0.25, 0.25, 0.2, 12), black, pos=(x, 0.25, z), rot=(0, 0, math.pi / 2))
        f.add(bm_cyl(0.12, 0.12, 0.21, 8), hub, pos=(x * 1.01, 0.25, z), rot=(0, 0, math.pi / 2))
    # seat, backrest, steering column + wheel
    f.add(bm_box(0.5, 0.12, 0.45, bevel=0.02), black, pos=(0, 0.81, -0.35))
    f.add(bm_box(0.5, 0.5, 0.1, bevel=0.02), black, pos=(0, 1.05, -0.6))
    f.add(bm_cyl(0.025, 0.025, 0.45, 6), dark, pos=(0, 0.95, 0.22), rot=(-0.5, 0, 0))
    f.add(bm_torus(0.14, 0.02, 4, 12), black, pos=(0, 1.16, 0.12), rot=(math.pi / 2 - 0.5, 0, 0))
    # Open overhead guard (bars only, so the top-down camera still sees the driver)
    for x, z in ((-0.5, 0.25), (0.5, 0.25), (-0.5, -0.8), (0.5, -0.8)):
        f.add(bm_box(0.06, 1.95, 0.06), dark, pos=(x, 1.3, z))
    f.add(bm_box(1.06, 0.06, 0.06), dark, pos=(0, 2.27, 0.25))
    f.add(bm_box(1.06, 0.06, 0.06), dark, pos=(0, 2.27, -0.8))
    f.add(bm_box(0.06, 0.06, 1.1), paint, pos=(-0.5, 2.27, -0.27))
    f.add(bm_box(0.06, 0.06, 1.1), paint, pos=(0.5, 2.27, -0.27))
    # Mast + headlights + exhaust
    f.add(bm_box(0.09, 2.0, 0.09), dark, pos=(-0.36, 1.05, 0.72))
    f.add(bm_box(0.09, 2.0, 0.09), dark, pos=(0.36, 1.05, 0.72))
    f.add(bm_box(0.8, 0.08, 0.08), dark, pos=(0, 2.05, 0.72))
    for x in (-0.5, 0.5):
        f.add(bm_box(0.1, 0.08, 0.04), lamp, pos=(x, 2.2, 0.29))
    f.add(bm_cyl(0.04, 0.04, 0.5, 6), black, pos=(-0.45, 1.1, -0.95))
    # (not named "forklift": that is the name of the file's root empty)
    f.finish("forklift_body", root, pos=(0, 0, 0))

    # ------------------------------------------------------- carriage + forks
    # Origin = carriage pivot (the game moves it up and down the mast).
    c = Merger()
    c.add(bm_box(0.78, 0.4, 0.05), dark, pos=(0, 0.2, 0))
    for x in (-0.24, 0.24):
        c.add(bm_box(0.1, 0.05, 0.95), game_mat(0x8a8d88, "metal"), pos=(x, 0.0, 0.47))
        c.add(bm_box(0.1, 0.42, 0.04), game_mat(0x8a8d88, "metal"), pos=(x, 0.2, 0.04))
    # load backrest
    for x in (-0.3, 0.0, 0.3):
        c.add(bm_box(0.04, 0.35, 0.03), dark, pos=(x, 0.57, 0))
    c.add(bm_box(0.78, 0.04, 0.03), dark, pos=(0, 0.74, 0))
    c.finish("carriage", root, pos=(0, 0.15, 2.0))

    # --------------------------------------------------------- shelving rack
    # Origin on the floor at the rack centre (4.5 m wide, 0.9 deep, 4 m tall).
    rack = game_mat(0x2f4f7f, "metal")
    wood = game_mat(0x8a5a2a, "wood")
    beam = game_mat(0xc4561f, "metal")
    r = Merger()
    for dx in (-2.2, 2.2):
        for dz in (-0.39, 0.39):
            r.add(bm_box(0.12, 4, 0.12), rack, pos=(dx, 2, dz))
        # side bracing
        for y in (0.8, 2.2, 3.5):
            r.add(bm_box(0.04, 0.04, 0.8), rack, pos=(dx, y, 0))
        r.add(bm_box(0.03, 1.5, 0.03), rack, pos=(dx, 1.5, 0), rot=(1.0, 0, 0))
        r.add(bm_box(0.03, 1.5, 0.03), rack, pos=(dx, 2.9, 0), rot=(-1.0, 0, 0))
    for y in (0.15, 1.5, 2.85):
        r.add(bm_box(4.5, 0.1, 0.9), wood, pos=(0, y, 0), uv=0.5)
        for dz in (-0.43, 0.43):
            r.add(bm_box(4.4, 0.12, 0.05), beam, pos=(0, y - 0.07, dz))
    r.finish("rack", root, pos=(0, 0, -3.0))

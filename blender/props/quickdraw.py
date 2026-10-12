"""QUICK DRAW props: the button pedestal (+ the red button that is pressed),
and the ceiling gun (mount, swivelling body, recoiling barrel)."""
import math

from common import Merger, bm_box, bm_cyl, bm_plane, game_mat

LIVES = 2
BTN_X = 0.12


def build(root):
    ped = game_mat(0x5c605a, "plate")
    dark = game_mat(0x232421, "metal")
    housing = game_mat(0xc9a227, "metal")
    hazard = game_mat(0xffffff, "hazard")

    # Pedestal (origin on the floor): base, column, top plate, the brass button
    # housing, the hazard plate on the front and the rims of the life bulbs.
    p = Merger()
    p.add(bm_box(0.6, 0.06, 0.52), dark, pos=(0, 0.03, 0))
    p.add(bm_box(0.46, 0.9, 0.4), ped, pos=(0, 0.5, 0))
    p.add(bm_box(0.52, 0.05, 0.46), dark, pos=(0, 0.975, 0))
    p.add(bm_cyl(0.19, 0.21, 0.05, 14), housing, pos=(BTN_X, 1.02, 0))
    p.add(bm_plane(0.4, 0.14), hazard, pos=(0, 0.16, 0.201))
    for k in range(LIVES):
        bx = (k - (LIVES - 1) / 2) * 0.16
        p.add(bm_box(0.11, 0.11, 0.03), dark, pos=(bx, 0.72, 0.215))
    p.finish("pedestal", root, pos=(0, 0, 0))

    # The big red button (origin = its centre; the game moves it down when pressed).
    b = Merger()
    b.add(bm_cyl(0.15, 0.15, 0.1, 14), game_mat(0xc8201a))
    b.finish("button", root, pos=(BTN_X, 1.08, 0))

    # Ceiling gun: mount (hangs from the rail), body (turns toward the target)
    # and the barrel (slides back on recoil). Barrel and body point along +Z.
    gun = game_mat(0x3a3c38, "metal")
    barrel = game_mat(0x1f201e, "metal")
    m = Merger()
    m.add(bm_box(0.1, 0.5, 0.1), gun, pos=(0, 0.3, 0))
    m.finish("gun_mount", root, pos=(1.5, 4.1, 0.7))
    g = Merger()
    g.add(bm_box(0.28, 0.22, 0.4), gun)
    g.finish("gun_body", root, pos=(1.5, 4.1, 1.5))
    br = Merger()
    br.add(bm_cyl(0.05, 0.06, 0.42, 8), barrel, rot=(math.pi / 2, 0, 0))
    br.finish("gun_barrel", root, pos=(1.5, 4.1, 2.3))

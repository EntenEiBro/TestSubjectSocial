"""ALCOVE ROULETTE props: the four-car train (one rigid mesh, nose at local
+X = origin, cars trailing toward -X) and the nook's hydraulic ceiling press.

Dimensions follow alcove.js. The train's travelling headlight, walls, rails,
sleepers, nook lamp tiles / lights and the tunnel-mouth glow stay procedural
in the game.
"""
import math

from common import Merger, bm_box, bm_cyl, game_mat

HALF = 2.6
DEPTH = 1.15
NOOK_W = 1.4
CAR_LEN, CAR_GAP, CARS = 6.4, 0.5, 4


def build(root):
    _train(root)
    _press(root)


def _train(root):
    w = HALF * 2 - 0.3
    body = game_mat(0x56636a, "metal")
    dark = game_mat(0x1d1e1c)
    stripe = game_mat(0xb5741f, "rust")
    win = game_mat(0x9a8f62, glow=True)
    lamp = game_mat(0xfff4c8, glow=True)
    visor = game_mat(0x2a2a24, glow=True)
    m = Merger()
    for i in range(CARS):
        cx = -CAR_LEN / 2 - i * (CAR_LEN + CAR_GAP)
        m.add(bm_box(CAR_LEN, 2.6, w), body, pos=(cx, 1.85, 0))
        m.add(bm_box(CAR_LEN - 0.3, 0.35, w - 0.7), body, pos=(cx, 3.3, 0))
        m.add(bm_box(CAR_LEN - 1.2, 0.55, w + 0.04), win, pos=(cx, 2.35, 0))
        m.add(bm_box(CAR_LEN + 0.02, 0.22, w + 0.04), stripe, pos=(cx, 1.15, 0))
        m.add(bm_box(CAR_LEN - 0.8, 0.5, w - 1.2), dark, pos=(cx, 0.35, 0))
        for wx in (-CAR_LEN / 2 + 1, CAR_LEN / 2 - 1):
            for wz in (-0.72, 0.72):
                m.add(bm_cyl(0.32, 0.32, 0.15, 8), dark, pos=(cx + wx, 0.32, wz), rot=(math.pi / 2, 0, 0))
    # Nose details: headlamps and the dark windscreen visor.
    for z in (-1.5, 1.5):
        m.add(bm_box(0.06, 0.35, 0.5), lamp, pos=(0.02, 1.25, z))
    m.add(bm_box(0.08, 0.5, w * 0.7), visor, pos=(0.03, 2.4, 0))
    m.finish("train", root, pos=(14.0, 0, -6.0))


def _press(root):
    plate = game_mat(0xffffff, "plate")
    hazard = game_mat(0xffffff, "hazard")
    rod = game_mat(0x8a8c88, "metal")
    m = Merger()
    m.add(bm_box(NOOK_W - 0.16, 0.8, DEPTH - 0.14), plate)
    m.add(bm_box(NOOK_W - 0.12, 0.12, DEPTH - 0.1), hazard, pos=(0, -0.42, 0))
    m.add(bm_cyl(0.12, 0.12, 1.4, 6), rod, pos=(0, 1.1, 0))
    m.finish("press", root, pos=(0, 3.0, 0))

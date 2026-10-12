"""DOWN ESCALATOR props: one escalator lane (truss under the steps,
balustrades, handrails, comb plate where the steps vanish) and the crusher
roller with its teeth (separate child so the game can give the teeth their
glowing material). Steps, skirt lights, monitors and the pit stay procedural."""
import math

from common import Merger, bm_box, bm_cyl, game_mat

ANGLE = 0.6
LEN = 12.0
Y0, Z0 = 0.5, 3.0
STEP_W = 1.3
SIN, COS = math.sin(ANGLE), math.cos(ANGLE)


def inclined(m, part, mat, s, up=0.0, dx=0.0):
    """Place a part along the incline (s = distance up the slope, up = offset off it)."""
    m.add(part, mat, pos=(dx, Y0 + s * SIN + up * COS, Z0 - s * COS + up * SIN), rot=(ANGLE, 0, 0))


def build(root):
    truss = game_mat(0x262624, "metal")
    bal = game_mat(0x5d605b, "plate")
    rail = game_mat(0x151515)
    comb = game_mat(0xb09a3a, "metal")
    # --- lane (origin at the lane's centre line on the floor plane, x = 0)
    m = Merger()
    inclined(m, bm_box(STEP_W + 0.1, 0.7, LEN + 0.6), truss, LEN / 2, -0.5)
    for side in (-1, 1):
        dx = side * (STEP_W / 2 + 0.09)
        inclined(m, bm_box(0.14, 1.0, LEN + 0.4), bal, LEN / 2, 0.45, dx)        # balustrade
        inclined(m, bm_box(0.2, 0.09, LEN + 0.6), rail, LEN / 2, 1.0, dx)        # handrail
        # handrail newel caps at both ends
        for s in (-0.3, LEN + 0.3):
            up = 0.97
            m.add(bm_cyl(0.1, 0.1, 0.2, 10), rail, pos=(dx, Y0 + s * SIN + up * COS, Z0 - s * COS + up * SIN), rot=(ANGLE, 0, math.pi / 2))
    # Comb plate where the steps vanish, with its fingers reaching up the slope.
    m.add(bm_box(STEP_W + 0.3, 0.12, 0.32), comb, pos=(0, Y0 - 0.02, Z0 + 0.12))
    for k in range(9):
        x = -STEP_W / 2 + 0.07 + k * (STEP_W - 0.14) / 8
        m.add(bm_box(0.05, 0.03, 0.14), comb, pos=(x, Y0 + 0.04, Z0 - 0.08), rot=(ANGLE * 0.5, 0, 0))
    m.finish("lane", root, pos=(0, 0, 0))

    # --- crusher roller (axis along X) with its eight teeth as a child
    r = Merger()
    r.add(bm_cyl(0.26, 0.26, STEP_W + 0.2, 10), game_mat(0x7a7c78, "metal"), rot=(0, 0, math.pi / 2))
    roller = r.finish("roller", root, pos=(3.0, 0.32, Z0 + 0.55))
    t = Merger()
    for k in range(8):
        a = k / 8 * math.tau
        t.add(bm_box(STEP_W + 0.2, 0.16, 0.16), game_mat(0xd8d4c8, "metal"), pos=(0, math.cos(a) * 0.3, math.sin(a) * 0.3), rot=(a, 0, 0))
    t.finish("teeth", parent=roller, pos=(0, 0, 0))

"""CHAIR PROTOCOL props: the folding chair, the wall loudspeaker (cabinet +
separate pulsing cone) and the junction box that feeds the chairs."""
import math

from common import Merger, bm_box, bm_cyl, bm_sphere, bm_torus, game_mat


def build(root):
    # ------------------------------------------------------------ folding chair
    # Sitter faces local +Z; origin on the floor under the seat centre. The
    # game swaps the frame / pad materials for its own (their emissive shows
    # the current), so keep exactly these two names on the glowing parts.
    frame = game_mat(0x9a9e98, "metal")
    pad = game_mat(0x6a2a22, "fabric")
    rubber = game_mat(0x1c1c1a)
    c = Merger()
    for sx in (-0.21, 0.21):
        for sz in (-0.2, 0.2):
            c.add(bm_cyl(0.03, 0.03, 0.44, 6), frame, pos=(sx, 0.22, sz))
            c.add(bm_cyl(0.036, 0.036, 0.03, 6), rubber, pos=(sx, 0.015, sz))
    # stretchers between the legs (front/back and both sides)
    for sz in (-0.2, 0.2):
        c.add(bm_cyl(0.015, 0.015, 0.42, 5), frame, pos=(0, 0.12, sz), rot=(0, 0, math.pi / 2))
    for sx in (-0.21, 0.21):
        c.add(bm_cyl(0.015, 0.015, 0.4, 5), frame, pos=(sx, 0.09, 0), rot=(math.pi / 2, 0, 0))
    # seat rim + pad
    c.add(bm_box(0.54, 0.03, 0.52), frame, pos=(0, 0.425, 0))
    c.add(bm_box(0.52, 0.06, 0.5, bevel=0.012), pad, pos=(0, 0.46, 0))
    # back posts, top rail and back pad
    for sx in (-0.21, 0.21):
        c.add(bm_cyl(0.03, 0.03, 0.62, 6), frame, pos=(sx, 0.77, -0.22))
        c.add(bm_sphere(0.034, 6, 4), frame, pos=(sx, 1.08, -0.22))
    c.add(bm_cyl(0.018, 0.018, 0.42, 5), frame, pos=(0, 0.79, -0.22), rot=(0, 0, math.pi / 2))
    c.add(bm_box(0.48, 0.26, 0.04, bevel=0.01), pad, pos=(0, 0.94, -0.22))
    c.finish("chair", root, pos=(0, 0, 0))

    # ------------------------------------------------------------- loudspeaker
    # Cabinet (origin at its centre, front face at local z = +0.2) with a
    # grille ring and the ON AIR lamp bezel; the lamp itself and the cone are
    # animated by the game.
    cab = game_mat(0x2a2a27, "plate")
    trim = game_mat(0x3c3c38, "metal")
    dark = game_mat(0x0d0d0c)
    s = Merger()
    s.add(bm_box(1.1, 1.4, 0.4, bevel=0.02), cab)
    s.add(bm_torus(0.4, 0.035, 6, 20), trim, pos=(0, -0.1, 0.205))
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        s.add(bm_cyl(0.025, 0.025, 0.02, 6), trim, pos=(math.cos(a) * 0.47, -0.1 + math.sin(a) * 0.47, 0.205), rot=(math.pi / 2, 0, 0))
    s.add(bm_box(0.48, 0.18, 0.03), dark, pos=(0, 0.55, 0.205))
    # wall bracket
    s.add(bm_box(0.5, 0.08, 0.3), trim, pos=(0, 0.74, -0.05))
    s.finish("speaker", root, pos=(2.0, 2.9, 0))

    cone_m = game_mat(0x111111, None, double=True)
    cap = game_mat(0x222222)
    k = Merger()
    # THREE CylinderGeometry(0.36, 0.12, 0.22, 12, 1, true): wide end up (+Y);
    # the game turns it toward the room.
    k.add(bm_cyl(0.36, 0.12, 0.22, 12, open_ended=True), cone_m)
    k.add(bm_sphere(0.09, 8, 4, hemi=True), cap, pos=(0, -0.1, 0))
    k.finish("speaker_cone", root, pos=(2.0, 2.8, 0.6))

    # ------------------------------------------------------------ junction box
    # Origin at the box centre; the red lever sticks out of the front.
    box = game_mat(0x56605a, "metal")
    lever = game_mat(0x7a1f1f)
    hz = game_mat(0xffffff, "hazard")
    bolt = game_mat(0x2b2d2b)
    j = Merger()
    j.add(bm_box(0.8, 1.0, 0.36, bevel=0.015), box)
    j.add(bm_box(0.72, 0.9, 0.02), box, pos=(0, 0, 0.185))
    j.add(bm_box(0.34, 0.12, 0.012), hz, pos=(-0.12, 0.3, 0.198))
    for bx in (-0.32, 0.32):
        for by in (-0.41, 0.41):
            j.add(bm_cyl(0.02, 0.02, 0.02, 6), bolt, pos=(bx, by, 0.2), rot=(math.pi / 2, 0, 0))
    j.add(bm_box(0.1, 0.08, 0.06), bolt, pos=(0.25, 0.14, 0.2))
    j.add(bm_box(0.06, 0.3, 0.06), lever, pos=(0.25, 0.3, 0.21))
    j.add(bm_box(0.1, 0.06, 0.08), lever, pos=(0.25, 0.46, 0.21))
    # conduit down into the floor
    j.add(bm_cyl(0.05, 0.05, 0.3, 8), bolt, pos=(0, -0.62, 0.05))
    j.finish("junction", root, pos=(-2.0, 0.75, 0))

"""GLASS PANELS props: one bridge row segment (girders, railing posts and
cables, centre strut, hazard crossbeam) for rows 0-6, the shorter last row
and the exit door of the far platform. The glass panes stay procedural
(their material is swapped when a pane is proven safe)."""
from common import Merger, bm_box, game_mat

PW = 1.5      # pane length along the bridge (X)
GAP = 0.5     # walkable steel crossbeam between rows
PITCH = PW + GAP
PD = 1.3      # pane depth = half the bridge width


def build(root):
    steel = game_mat(0x6e706a, "metal")
    rust = game_mat(0xffffff, "rust")
    hazard = game_mat(0xffffff, "hazard")
    bolt = game_mat(0x2a2b28)
    # Row segment, origin at the row's near (start-side) glass edge, deck level.
    for name, last in (("row", False), ("row_last", True)):
        m = Merger()
        length = PW if last else PITCH
        for side in (-1, 1):
            gz = side * (PD + 0.08)
            m.add(bm_box(length, 0.34, 0.16), rust, pos=(length / 2, -0.17, gz))          # girder
            m.add(bm_box(0.07, 1.0, 0.07), steel, pos=(0.04, 0.5, gz))                   # railing post
            m.add(bm_box(length, 0.04, 0.04), steel, pos=(length / 2, 1.0, gz))          # cable
            # rivet heads along the girder's outer face
            x = 0.15
            while x < length - 0.05:
                m.add(bm_box(0.04, 0.04, 0.02), bolt, pos=(x, -0.17, gz + side * 0.09))
                x += 0.3
            if last:
                m.add(bm_box(0.07, 1.0, 0.07), steel, pos=(PW - 0.04, 0.5, gz))
        m.add(bm_box(PW, 0.08, 0.08), steel, pos=(PW / 2, -0.1, 0))                       # centre strut
        if not last:
            # Crossbeam in three slices along Z = the texture's 1 x 3 repeat.
            w = (PD * 2 + 0.3) / 3
            for k in range(3):
                m.add(bm_box(GAP, 0.22, w), hazard, pos=(PW + GAP / 2, -0.11, -w + k * w))
        m.finish(name, root, pos=(0, 0, -4.0 if last else 0))

    # Exit door at the back of the far platform (origin: door centre on the floor).
    frame = game_mat(0x3a3a36, "metal")
    door = game_mat(0x1f6a2a, glow=True)
    bar = game_mat(0x9a9c96, "metal")
    d = Merger()
    d.add(bm_box(0.2, 2.4, 0.2), frame, pos=(-0.85, 1.2, 0))
    d.add(bm_box(0.2, 2.4, 0.2), frame, pos=(0.85, 1.2, 0))
    d.add(bm_box(1.9, 0.2, 0.2), frame, pos=(0, 2.45, 0))
    d.add(bm_box(1.5, 2.3, 0.02), door, pos=(0, 1.15, -0.05))
    d.add(bm_box(1.9, 0.06, 0.3), frame, pos=(0, 0.03, 0))                               # threshold
    d.add(bm_box(1.1, 0.06, 0.06), bar, pos=(0, 1.05, 0.02))                             # push bar
    d.finish("exit_door", root, pos=(5.0, 0, 0))

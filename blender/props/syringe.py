"""SYRINGE HUNT props: the searchable containers (locker, filing cabinet,
desk) with their moving parts, and the syringe itself.

Every container is built in its local space (front = +Z, floor at y = 0)
with the JS dimensions (KINDS in syringe.js). Doors are separate objects
with their origin on the hinge (the JS pivot at (-w/2 + 0.03, 0, d/2)); the
desk drawer's origin is the JS drawer group origin (0.4, h - 0.28, 0).
The syringe points along +Z (needle forward); its glowing barrel is a child
object ("syringe_barrel") so the game can make it translucent.
"""
import math

from common import Merger, bm_box, bm_cyl, game_mat

KINDS = {
    "locker": {"w": 0.9, "h": 2.0, "d": 0.6, "color": 0x56645a},
    "cabinet": {"w": 1.0, "h": 1.2, "d": 0.6, "color": 0x7a7466},
    "desk": {"w": 1.5, "h": 0.85, "d": 0.8, "color": 0xffffff},
}


def _scaled(color, k):
    r, g, b = (color >> 16) & 255, (color >> 8) & 255, color & 255
    return (min(255, round(r * k)) << 16) | (min(255, round(g * k)) << 8) | min(255, round(b * k))


def build(root):
    dark = game_mat(0x161616)
    handle = game_mat(0xa0a0a0)
    x0 = -4.0
    for kind in ("locker", "cabinet"):
        K = KINDS[kind]
        w, h, d = K["w"], K["h"], K["d"]
        body = game_mat(K["color"], "metal")
        door = game_mat(_scaled(K["color"], 1.15), "metal")
        # Body: carcass, dark interior behind the door, a plinth and a top lip.
        m = Merger()
        m.add(bm_box(w, h, d - 0.04), body, pos=(0, h / 2, -0.02))
        m.add(bm_box(w - 0.1, h - 0.12, 0.02), dark, pos=(0, h / 2, d / 2 - 0.03))
        m.add(bm_box(w + 0.02, 0.06, d - 0.02), dark, pos=(0, 0.03, -0.02))
        m.add(bm_box(w + 0.02, 0.03, d - 0.02), body, pos=(0, h - 0.015, -0.02))
        if kind == "locker":
            # coat hook and shelf inside (visible once the door is open)
            m.add(bm_box(w - 0.14, 0.02, d - 0.16), handle, pos=(0, h - 0.42, 0.02))
            m.add(bm_cyl(0.015, 0.015, 0.12, 4), handle, pos=(0, h - 0.62, d / 2 - 0.12), rot=(math.pi / 2, 0, 0))
        else:
            m.add(bm_box(w - 0.14, 0.02, d - 0.16), handle, pos=(0, h * 0.5, 0.02))
        m.finish(kind, root, pos=(x0, 0, 0))

        # Door (origin = hinge): panel, handle, vents / label slot.
        dm = Merger()
        dw = w - 0.06
        dm.add(bm_box(dw, h - 0.08, 0.04), door, pos=(dw / 2, h / 2, 0.02))
        dm.add(bm_box(0.05, 0.16, 0.05), handle, pos=(w - 0.16, h * 0.55, 0.06))
        if kind == "locker":
            for i in range(3):
                dm.add(bm_box(0.4, 0.03, 0.01), dark, pos=(dw / 2, h - 0.25 - i * 0.07, 0.045))
            for i in range(3):
                dm.add(bm_box(0.4, 0.03, 0.01), dark, pos=(dw / 2, 0.3 + i * 0.07, 0.045))
            dm.add(bm_box(0.16, 0.08, 0.01), game_mat(0xd8d2c0), pos=(dw / 2, h - 0.55, 0.045))
        else:
            dm.add(bm_box(0.5, 0.03, 0.01), dark, pos=(dw / 2, h * 0.5, 0.045))
            dm.add(bm_box(0.22, 0.09, 0.012), handle, pos=(dw / 2, h * 0.72, 0.045))
        dm.finish(kind + "_door", root, pos=(x0 - w / 2 + 0.03, 0, d / 2))
        x0 += 2.0

    # Desk: top, pedestal with two fixed drawers, side panel, clutter.
    K = KINDS["desk"]
    w, h, d = K["w"], K["h"], K["d"]
    wood = game_mat(0xffffff, "wood")
    front = game_mat(0x8a6a42, "wood")
    brass = game_mat(0xb0a070)
    m = Merger()
    m.add(bm_box(w, 0.08, d), wood, pos=(0, h - 0.04, 0))
    m.add(bm_box(0.62, h - 0.08, d - 0.04), wood, pos=(0.4, (h - 0.08) / 2, 0))
    m.add(bm_box(0.08, h - 0.08, d - 0.04), wood, pos=(-0.7, (h - 0.08) / 2, 0))
    m.add(bm_box(1.0, 0.3, 0.02), wood, pos=(-0.2, h - 0.3, -d / 2 + 0.04))   # modesty panel
    for y in (0.14, 0.36):
        m.add(bm_box(0.56, 0.18, 0.02), front, pos=(0.4, y, d / 2 - 0.01))
        m.add(bm_box(0.16, 0.04, 0.04), brass, pos=(0.4, y, d / 2 + 0.02))
    m.add(bm_box(0.4, 0.04, 0.3), game_mat(0xd8d2c0, "fabric"), pos=(-0.35, h + 0.02, 0.05))
    m.add(bm_cyl(0.05, 0.05, 0.1, 6), game_mat(0x7a2323), pos=(0.1, h + 0.05, -0.15))
    m.add(bm_box(0.3, 0.02, 0.22), game_mat(0xb8b2a0, "fabric"), pos=(-0.3, h + 0.05, 0.02), rot=(0, 0.25, 0))
    m.finish("desk", root, pos=(x0 + 0.5, 0, 0))

    dr = Merger()
    dr.add(bm_box(0.56, 0.24, 0.05), front, pos=(0, 0, d / 2))
    dr.add(bm_box(0.16, 0.04, 0.04), brass, pos=(0, 0, d / 2 + 0.04))
    dr.add(bm_box(0.5, 0.18, d - 0.1), dark, pos=(0, -0.02, 0))
    dr.finish("desk_drawer", root, pos=(x0 + 0.9, h - 0.28, 0))

    # Syringe (~0.6 long along +Z): plunger rod, thumb rest, finger flange,
    # needle hub + needle; the barrel is a child object.
    white = game_mat(0xdddddd)
    s = Merger()
    s.add(bm_cyl(0.015, 0.015, 0.16, 4), white, pos=(0, 0, -0.24), rot=(math.pi / 2, 0, 0))
    s.add(bm_cyl(0.07, 0.07, 0.02, 8), white, pos=(0, 0, -0.32), rot=(math.pi / 2, 0, 0))
    s.add(bm_box(0.2, 0.03, 0.03), white, pos=(0, 0, -0.16))
    s.add(bm_cyl(0.02, 0.045, 0.04, 8), white, pos=(0, 0, 0.19), rot=(math.pi / 2, 0, 0))
    s.add(bm_cyl(0.006, 0.006, 0.2, 4), game_mat(0xeeeeee), pos=(0, 0, 0.27), rot=(math.pi / 2, 0, 0))
    s.add(bm_cyl(0.055, 0.055, 0.02, 8), game_mat(0x222222), pos=(0, 0, -0.12), rot=(math.pi / 2, 0, 0))  # plunger seal
    syr = s.finish("syringe_model", root, pos=(x0 + 3.0, 1.0, 0))
    b = Merger()
    b.add(bm_cyl(0.06, 0.06, 0.34, 8), game_mat(0x6cff5a, glow=True), rot=(math.pi / 2, 0, 0))
    b.finish("syringe_barrel", parent=syr)

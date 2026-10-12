"""SUPPER CLUB props: dinner table (two lengths), diner chair, the host's
throne, candlesticks, tureen, chandelier, plate, fork, revolver and the
grim portraits."""
import math

from common import Merger, bm_box, bm_circle, bm_cyl, bm_plane, bm_sphere, bm_torus, game_mat

TABLE_TOP = 0.76


def build(root):
    # --- dinner table: top, centre runner and four legs. The game uses
    # table_34 (up to 2 guests) or table_44 (3-4 guests).
    wood = game_mat(0x7a5232, "wood")
    cloth = game_mat(0x6e6352, "fabric")
    leg = game_mat(0x4a2e1a, "wood")
    for k, length in enumerate((3.4, 4.4)):
        m = Merger()
        m.add(bm_box(1.75, 0.08, length), wood, pos=(0, TABLE_TOP - 0.04, 0), uv=1.1)   # Tex.wood([2, 4])
        m.add(bm_box(0.6, 0.01, length - 0.2), cloth, pos=(0, TABLE_TOP + 0.005, 0))
        for x in (-0.75, 0.75):
            for z in (-length / 2 + 0.2, length / 2 - 0.2):
                m.add(bm_box(0.12, TABLE_TOP - 0.08, 0.12), leg, pos=(x, (TABLE_TOP - 0.08) / 2, z))
        m.finish("table_%d" % round(length * 10), root, pos=(-3.0 + k * 2.4, 0, 0))

    # --- diner chair: seat block + tall back on the +X side (the game turns it).
    chair = game_mat(0x4a2a18, "wood")
    c = Merger()
    c.add(bm_box(0.5, 0.4, 0.5), chair, pos=(0, 0.2, 0))
    c.add(bm_box(0.06, 1.1, 0.5), chair, pos=(0.27, 0.75, 0))
    c.add(bm_box(0.09, 0.06, 0.56), chair, pos=(0.27, 1.32, 0))      # top rail
    c.finish("chair", root, pos=(2.0, 0, 0))

    # --- the host's throne: dark wooden box seat, velvet back framed by posts.
    throne_wood = game_mat(0x3a1c14, "wood")
    velvet = game_mat(0x5a1414, "fabric")
    brass = game_mat(0x8a7238, "metal")
    t = Merger()
    t.add(bm_box(0.95, 0.54, 0.85), throne_wood, pos=(0, 0.27, 0))
    t.add(bm_box(1.0, 2.2, 0.12), velvet, pos=(0, 1.3, -0.45))
    for x in (-0.53, 0.53):
        t.add(bm_box(0.1, 2.3, 0.16), throne_wood, pos=(x, 1.25, -0.45))
        t.add(bm_sphere(0.075, 8, 6), brass, pos=(x, 2.47, -0.45))
    t.finish("throne", root, pos=(3.6, 0, 0))

    # --- candlestick (origin on the table top): brass foot, wax, flame.
    holder = game_mat(0x8a7a40, "metal")
    wax = game_mat(0xe8e0c8)
    flame = game_mat(0xffc46a, glow=True)
    cs = Merger()
    cs.add(bm_box(0.18, 0.06, 0.18), holder, pos=(0, 0.04, 0))
    cs.add(bm_cyl(0.035, 0.035, 0.32, 6), wax, pos=(0, 0.23, 0))
    cs.add(bm_cyl(0, 0.03, 0.08, 5), flame, pos=(0, 0.43, 0))
    cs.finish("candle", root, pos=(5.0, TABLE_TOP, 0))

    # --- tureen of something grey (origin on the table top), with handles.
    steel = game_mat(0xa0a39a, "metal")
    tu = Merger()
    tu.add(bm_cyl(0.22, 0.17, 0.2, 10), steel, pos=(0, 0.1, 0))
    for x in (-0.25, 0.25):
        tu.add(bm_box(0.07, 0.03, 0.08), steel, pos=(x, 0.16, 0))
    tu.add(bm_cyl(0.035, 0.035, 0.04, 6), steel, pos=(0, 0.22, 0))
    tu.finish("tureen", root, pos=(5.6, TABLE_TOP, 0))

    # --- the single dim chandelier: brass ring, rod, six candles.
    rod = game_mat(0x111111)
    ch = Merger()
    ch.add(bm_torus(0.55, 0.04, 5, 14), brass, rot=(math.pi / 2, 0, 0))
    ch.add(bm_cyl(0.015, 0.015, 2, 4), rod, pos=(0, 1.0, 0))
    for i in range(6):
        a = (i / 6) * math.pi * 2
        ch.add(bm_cyl(0.03, 0.03, 0.14, 5), wax, pos=(math.cos(a) * 0.55, 0.09, math.sin(a) * 0.55))
        ch.add(bm_cyl(0, 0.025, 0.07, 5), flame, pos=(math.cos(a) * 0.55, 0.2, math.sin(a) * 0.55))
    ch.finish("chandelier", root, pos=(0, 3.95, -3.0))

    # --- plate.
    china = game_mat(0xe0dccd)
    p = Merger()
    p.add(bm_cyl(0.27, 0.22, 0.03, 14), china)
    p.finish("plate", root, pos=(6.4, TABLE_TOP + 0.015, 0))

    # --- fork (hand-local: handle along +Z, three tines).
    silver = game_mat(0xc8c8c0, "metal")
    f = Merger()
    f.add(bm_box(0.025, 0.015, 0.2), silver, pos=(0, 0, 0.08))
    for tx in (-0.022, 0, 0.022):
        f.add(bm_box(0.008, 0.008, 0.08), silver, pos=(tx, 0, 0.22))
    f.finish("fork", root, pos=(7.0, 1.0, 0))

    # --- revolver (hand-local: hangs down -Y from the grip).
    grip = game_mat(0x4a2c18, "wood")
    gun_steel = game_mat(0x2c2d2e, "metal")
    g = Merger()
    g.add(bm_box(0.06, 0.12, 0.05), grip)
    g.add(bm_cyl(0.045, 0.045, 0.07, 6), gun_steel, pos=(0, -0.08, 0.02))
    g.add(bm_cyl(0.018, 0.018, 0.22, 6), gun_steel, pos=(0, -0.2, 0.03))
    g.add(bm_box(0.012, 0.03, 0.012), gun_steel, pos=(0, -0.3, 0.05))   # front sight
    g.finish("revolver", root, pos=(7.5, 1.0, 0))

    # --- grim portrait: brass frame, dark canvas, a face and shoulders.
    frame = game_mat(0x8a6a2a, "metal")
    canvas = game_mat(0x2a2620, "concrete")
    face = game_mat(0x6a5a48)
    body = game_mat(0x1b1814)
    po = Merger()
    po.add(bm_box(1.3, 1.6, 0.08), frame)
    po.add(bm_plane(1.1, 1.4), canvas, pos=(0, 0, 0.05))
    po.add(bm_circle(0.22, 10), face, pos=(0, 0.25, 0.06))
    po.add(bm_plane(0.6, 0.55), body, pos=(0, -0.3, 0.06))
    po.finish("portrait", root, pos=(0, 2.9, -5.0))

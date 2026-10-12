"""Build the test subject avatar, its headwear and face accessories.

Run:  blender --background --python blender/build_subject.py

Exports (godot/assets/models/):
  subject.glb  the body rig. Node names match the animation code (core/subject.gd):
               Subject > hips > pelvis, legL/legR (thigh, shin, boot),
               torso > chest, patch, collar, armL/armR (upper, fore, hand), head > neck, skull
               Materials "suit", "suitDark", "skin" are recoloured per player in Godot.
  hats.glb     one node per headwear, "hat_<Name>" (head-local coordinates)
  faces.glb    one node per face accessory, "face_<Name>"
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (bm_box, bm_circle, bm_cyl, bm_ico, bm_plane, bm_sphere, bm_torus, empty, export_glb,  # noqa: E402
                    material, obj_from_bm, reset_scene, uv_faces)

BEVEL = 0.012
HATS = ["Hard Hat", "Beanie", "Bucket", "Paper Bag", "Top Hat", "Gas Mask", "Welder", "Headlamp", "Party Hat"]
FACES = ["Plain", "Goggles", "Shades", "Bandage", "Monocle", "Mustache"]

# The head everything below is fitted to (head-local coordinates, game space):
# skull = 0.42 cube centred at y=0.02 (top y=0.23, chin y=-0.19, face z=0.21),
# vertical edges bevelled (corner radius ~0.28), ears to |x|=0.235,
# nose to z=0.245, brow at y=0.11. Round headwear must clear r=0.29.
HEAD_TOP = 0.23
CORNER_R = 0.29


def uv_wrap(bm, rep_u=1.0, rep_v=1.0):
    """Cylindrical UVs for round parts (THREE cylinder / sphere / cone style):
    u runs once around the Y axis, v bottom to top; flat caps get planar UVs."""
    import math as _m
    layer = bm.loops.layers.uv.verify()
    bm.normal_update()
    zs = [v.co.z for v in bm.verts]
    z0, z1 = min(zs), max(zs)
    dz = (z1 - z0) or 1.0
    r = max(max(abs(v.co.x), abs(v.co.y)) for v in bm.verts) or 1.0
    for f in bm.faces:
        if abs(f.normal.z) > 0.95:
            for l in f.loops:
                l[layer].uv = (0.5 + l.vert.co.x / (2 * r), 0.5 + l.vert.co.y / (2 * r))
            continue
        us = []
        for l in f.loops:
            co = l.vert.co
            us.append(None if abs(co.x) + abs(co.y) < 1e-6 else _m.atan2(co.x, -co.y) / _m.tau + 0.5)
        known = [u for u in us if u is not None]
        if known and max(known) - min(known) > 0.5:
            known = [u + 1.0 if u < 0.5 else u for u in known]
            us = [None if u is None else (u + 1.0 if u < 0.5 else u) for u in us]
        avg = sum(known) / len(known) if known else 0.5
        for l, u in zip(f.loops, us):
            l[layer].uv = ((avg if u is None else u) * rep_u, (l.vert.co.z - z0) / dz * rep_v)
    return bm


def build_body():
    suit = material("suit", 0xffffff, "fabric")
    suit_dark = material("suitDark", 0xa6a6a6, "fabric")
    skin = material("skin", 0xffffff, "fabric")
    boots = material("boots", 0x231d18)
    patch = material("patch", 0xd8d0b8)
    stitch = material("stitch", 0x1a1714)

    root = empty("Subject")
    hips = empty("hips", root, (0, 0.92, 0))
    obj_from_bm("pelvis", bm_box(0.46, 0.2, 0.26, BEVEL), suit_dark, hips)
    obj_from_bm("belt", bm_box(0.47, 0.05, 0.27, BEVEL * 0.5), boots, hips, (0, 0.08, 0))
    obj_from_bm("buckle", bm_box(0.08, 0.05, 0.02, 0.004), material("brass", 0xb08d3a), hips, (0, 0.08, 0.138))

    for side, name in ((-1, "legL"), (1, "legR")):
        leg = empty(name, hips, (0.12 * side, -0.05, 0))
        obj_from_bm(f"thigh_{name}", bm_box(0.18, 0.5, 0.2, BEVEL), suit, leg, (0, -0.27, 0))
        obj_from_bm(f"knee_{name}", bm_box(0.17, 0.06, 0.19, BEVEL * 0.5), suit_dark, leg, (0, -0.5, 0))
        obj_from_bm(f"shin_{name}", bm_box(0.16, 0.36, 0.18, BEVEL), suit, leg, (0, -0.66, 0))
        obj_from_bm(f"boot_{name}", bm_box(0.19, 0.12, 0.3, BEVEL), boots, leg, (0, -0.82, 0.05))
        obj_from_bm(f"sole_{name}", bm_box(0.2, 0.03, 0.31, 0.004), stitch, leg, (0, -0.875, 0.05))

    torso = empty("torso", hips, (0, 0.08, 0))
    obj_from_bm("chest", bm_box(0.52, 0.6, 0.3, BEVEL * 1.5), suit, torso, (0, 0.32, 0))
    obj_from_bm("zip", bm_box(0.02, 0.5, 0.01, 0.0), stitch, torso, (0.06, 0.32, 0.151))
    obj_from_bm("pocket", bm_box(0.12, 0.1, 0.012, 0.003), suit_dark, torso, (-0.14, 0.44, 0.153))
    patch_node = empty("patch", torso, (0, 0.42, 0.152))
    obj_from_bm("patch_card", bm_plane(0.26, 0.2), patch, patch_node, (0, 0, 0.001))
    obj_from_bm("collar", bm_box(0.3, 0.06, 0.24, BEVEL * 0.5), suit_dark, torso, (0, 0.64, 0))

    for side, name in ((-1, "armL"), (1, "armR")):
        arm = empty(name, torso, (0.33 * side, 0.56, 0))
        obj_from_bm(f"shoulder_{name}", bm_box(0.17, 0.1, 0.18, BEVEL), suit_dark, arm, (0, -0.02, 0))
        obj_from_bm(f"upper_{name}", bm_box(0.15, 0.4, 0.16, BEVEL), suit, arm, (0, -0.18, 0))
        obj_from_bm(f"fore_{name}", bm_box(0.13, 0.34, 0.14, BEVEL), suit, arm, (0, -0.52, 0))
        obj_from_bm(f"cuff_{name}", bm_box(0.14, 0.04, 0.15, 0.004), suit_dark, arm, (0, -0.67, 0))
        hand = empty(f"hand{name[-1]}", arm, (0, -0.74, 0))
        obj_from_bm(f"handmesh_{name}", bm_box(0.12, 0.13, 0.13, BEVEL), skin, hand)

    head = empty("head", torso, (0, 0.88, 0))
    obj_from_bm("neck", bm_box(0.14, 0.12, 0.14, BEVEL * 0.5), skin, head, (0, -0.16, 0))
    obj_from_bm("skull", bm_box(0.42, 0.42, 0.42, BEVEL * 2), skin, head, (0, 0.02, 0))
    obj_from_bm("ear_L", bm_box(0.03, 0.08, 0.06, 0.005), skin, head, (-0.22, 0.02, 0))
    obj_from_bm("ear_R", bm_box(0.03, 0.08, 0.06, 0.005), skin, head, (0.22, 0.02, 0))
    obj_from_bm("brow", bm_box(0.3, 0.025, 0.02, 0.004), material("browmat", 0x2a1d14), head, (0, 0.11, 0.214))
    obj_from_bm("nose", bm_box(0.05, 0.07, 0.04, 0.008), skin, head, (0, -0.01, 0.225))
    export_glb(root, "subject.glb")


def build_hats():
    # Laid out in a row beside the body (Godot resets each piece onto the head origin).
    root = empty("Hats", None, (1.2, 1.88, 0))
    metal = lambda name, c: material(name, c, "metal")  # noqa: E731
    count = [0]

    def hat(name):
        count[0] += 1
        return empty("hat_" + name.replace(" ", ""), root, ((count[0] - 1) * 0.85, 0, 0))

    def add(parent, nm, bm, mat, pos=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), uv="box", rep=(1.0, 1.0)):
        # Textured materials need UVs: per-face for boxes, wrapped round the Y axis for round parts.
        if uv == "wrap":
            uv_wrap(bm, rep[0], rep[1])
        elif uv == "box":
            uv_faces(bm)
        return obj_from_bm(nm, bm, mat, parent, pos, rot, scale)

    # Hard Hat: rounded shell over the top of the cube head, ridge following
    # the dome, front peak, hazard sticker on the shell.
    g = hat("Hard Hat")
    yellow = material("hardhat", 0xe0b52a, "fabric")
    sa, sb, sc, sy = 0.3, 0.216, 0.312, 0.17          # dome semi-axes (x, y, z) and rim height
    add(g, "shell", bm_sphere(sa, 24, 12, hemi=True), yellow, (0, sy, 0), scale=(1, sb / sa, sc / sa), uv="wrap")
    # Band round the rim, stretched like the shell so it encloses the shell's edge all round.
    add(g, "band", bm_cyl(sa + 0.006, sa + 0.006, 0.05, 24), yellow, (0, 0.19, 0), scale=(1, 1, sc / sa), uv="wrap", rep=(4, 1))
    ridge_m = material("hardhat_ridge", 0xd0a420, "fabric")
    dome_y = lambda z: sy + sb * math.sqrt(max(0.0, 1 - (z / sc) ** 2))  # noqa: E731
    n_seg, z_end = 8, 0.27
    for k in range(n_seg):
        z0 = -z_end + k * 2 * z_end / n_seg
        z1 = z0 + 2 * z_end / n_seg
        y0, y1 = dome_y(z0) + 0.004, dome_y(z1) + 0.004
        seg_len = math.hypot(z1 - z0, y1 - y0) + 0.012
        add(g, f"ridge{k}", bm_box(0.07, 0.06, seg_len), ridge_m, (0, (y0 + y1) / 2, (z0 + z1) / 2), (math.atan2(-(y1 - y0), z1 - z0), 0, 0))
    add(g, "peak", bm_box(0.46, 0.035, 0.16, 0.008), material("hardhat_peak", 0xcfa21f, "fabric"), (0, 0.185, 0.33), (0.12, 0, 0))
    st_y = 0.27
    st_z = sc * math.sqrt(1 - ((st_y - sy) / sb) ** 2) + 0.006
    st_tilt = math.atan2((st_y - sy) / sb ** 2, (st_z - 0.006) / sc ** 2)   # surface normal's lean toward +Y
    add(g, "sticker", bm_plane(0.12, 0.08), material("hazard_sticker", 0xffffff, "hazard"), (0, st_y, st_z), (-st_tilt, 0, 0))

    # Beanie: knit body, folded cuff (clears the head corners), pompom
    # (knit tinted with the suit colour in Godot).
    g = hat("Beanie")
    knit = material("knit_suit", 0xffffff, "knit")
    knit_dark = material("knit_suitDark", 0xb3b3b3, "knit")
    add(g, "body", bm_sphere(0.29, 20, 12, hemi=True), knit, (0, 0.2, 0), scale=(1, 0.82, 1), uv="wrap", rep=(4, 1))
    add(g, "cuff", bm_cyl(0.295, 0.3, 0.11, 24), knit_dark, (0, 0.2, 0), uv="wrap", rep=(4, 1))
    pom = empty("pom", g, (0, 0.46, 0))
    for i in range(7):
        add(pom, f"blob{i}", bm_ico(0.05, 1), material("pompom", 0xeeeae0, "fabric"),
            (math.sin(i * 1.7) * 0.03, math.cos(i * 2.3) * 0.02, math.cos(i * 1.7) * 0.03))

    # Bucket: dented pail upside down over the head (wide enough that the
    # cube's corners stay inside), rolled rim, ribs, handle hanging in front of the chin.
    g = hat("Bucket")
    p_bot, p_top, p_r_rim, p_r_top = -0.06, 0.38, 0.315, 0.285
    p_h = p_top - p_bot
    pail_r = lambda y: p_r_rim + (p_r_top - p_r_rim) * (y - p_bot) / p_h  # noqa: E731
    add(g, "pail", bm_cyl(p_r_top, p_r_rim, p_h, 24, open_ended=True), material("pail", 0x8a9092, "metal", double=True),
        (0, (p_bot + p_top) / 2, 0), uv="wrap", rep=(3, 1))
    add(g, "bottom", bm_cyl(p_r_top, p_r_top, 0.02, 24), metal("pail_bottom", 0x8a9092), (0, p_top, 0), uv="wrap")
    add(g, "rim", bm_torus(p_r_rim, 0.018, 6, 28), metal("pail_rim", 0x9aa0a2), (0, p_bot, 0), (math.pi / 2, 0, 0))
    for k, y in enumerate((0.07, 0.27)):
        add(g, f"rib{k}", bm_torus(pail_r(y) + 0.004, 0.01, 4, 28), metal("pail_rib", 0x737a7c), (0, y, 0), (math.pi / 2, 0, 0))
    lug_y = 0.0
    lug_x = pail_r(lug_y) + 0.012
    add(g, "lugR", bm_box(0.024, 0.06, 0.06, 0.005), metal("pail_handle", 0x5d6365), (lug_x, lug_y, 0))
    add(g, "lugL", bm_box(0.024, 0.06, 0.06, 0.005), metal("pail_handle", 0x5d6365), (-lug_x, lug_y, 0))
    # Half ring from lug to lug, swung forward so it hangs in front of the chin.
    add(g, "handle", bm_torus(lug_x, 0.012, 4, 20, math.pi), metal("pail_handle", 0x5d6365), (0, lug_y, 0), (-1.13, 0, math.pi))
    dent_a = math.atan2(0.12, 0.19)
    add(g, "dent", bm_sphere(0.05, 8, 6), metal("pail_dent", 0x7c8284),
        (math.sin(dent_a) * pail_r(0.28), 0.28, math.cos(dent_a) * pail_r(0.28)), (0, dent_a, 0), scale=(1, 0.5, 0.3))

    # Paper Bag: creased bag over the whole head (roomy enough for nose and
    # ears), jagged top, eye holes, wonky mouth.
    g = hat("Paper Bag")
    bag_w, bag_h, bag_d = 0.52, 0.56, 0.52
    front = bag_d / 2 + 0.002
    add(g, "bag", bm_box(bag_w, bag_h, bag_d, 0.01), material("paperbag", 0xffffff, "paper"), (0, 0.04, 0))
    for i in range(9):
        add(g, f"tooth{i}", bm_box(0.07, 0.08, bag_d + 0.01, 0.004), material("paperbag_top", 0xe6e0d0, "paper"),
            (-0.23 + i * 0.0575, 0.33 + (i % 2) * 0.02, 0), (0, 0, 0.25 if i % 2 else -0.25))
    hole = material("hole", 0x080808, unlit=True)
    add(g, "eyeL", bm_circle(0.045, 12), hole, (-0.1, 0.08, front), uv=None)
    add(g, "eyeR", bm_circle(0.04, 12), hole, (0.1, 0.09, front), uv=None)
    add(g, "mouth", bm_box(0.14, 0.025, 0.005), hole, (0.01, -0.08, front), (0, 0, 0.12))
    add(g, "crease", bm_box(0.004, 0.5, 0.004), material("crease", 0x7a5d34), (0.12, 0.04, front))

    # Top Hat: silk crown, brim, curled edge, band with buckle.
    g = hat("Top Hat")
    silk = material("silk", 0x1c1b20, "fabric")
    add(g, "crown", bm_cyl(0.205, 0.185, 0.44, 24), silk, (0, 0.43, 0), uv="wrap", rep=(3, 2))
    add(g, "crowntop", bm_cyl(0.205, 0.205, 0.02, 24), material("silk_top", 0x2a2930, "fabric"), (0, 0.655, 0), uv="wrap")
    add(g, "brim", bm_cyl(0.34, 0.34, 0.025, 28), silk, (0, 0.215, 0), uv="wrap", rep=(4, 1))
    add(g, "curl", bm_torus(0.335, 0.022, 6, 28), silk, (0, 0.23, 0), (math.pi / 2, 0, 0))
    add(g, "band", bm_cyl(0.19, 0.19, 0.07, 24), material("tophat_band", 0x7a1f1f, "fabric"), (0, 0.27, 0), uv="wrap", rep=(3, 1))
    add(g, "buckle", bm_box(0.07, 0.06, 0.02, 0.004), metal("brass_buckle", 0xc9a742), (0, 0.27, 0.19))

    # Gas Mask: rubber face piece over nose and brow, lenses, ribbed canister,
    # straps round the head (wide enough for the ears).
    g = hat("Gas Mask")
    rubber = material("rubber", 0x2c3029, "fabric")
    add(g, "face", bm_box(0.4, 0.3, 0.1, 0.02), rubber, (0, -0.02, 0.25))
    add(g, "snout", bm_cyl(0.11, 0.14, 0.12, 16), rubber, (0, -0.14, 0.31), (math.pi / 2, 0, 0), uv="wrap")
    can = empty("canister", g, (0, -0.17, 0.43), (math.pi / 2 - 0.3, 0, 0))
    add(can, "can", bm_cyl(0.085, 0.085, 0.16, 16), metal("can", 0x55604c), uv="wrap")
    for k, y in enumerate((-0.05, 0, 0.05)):
        add(can, f"canrib{k}", bm_cyl(0.09, 0.09, 0.012, 16), metal("canrib", 0x3e4637), (0, y, 0), uv="wrap")
    glass = material("mask_glass", 0x9fb89a, unlit=True)
    for k, x in enumerate((-0.1, 0.1)):
        add(g, f"lens{k}", bm_circle(0.065, 16), glass, (x, 0.07, 0.302), uv=None)
        add(g, f"lensframe{k}", bm_torus(0.068, 0.014, 6, 16), metal("lensframe", 0x6b6f66), (x, 0.07, 0.302))
    for k, y in enumerate((0.05, 0.2)):
        add(g, f"strap{k}", bm_box(0.49, 0.035, 0.45, 0.005), rubber, (0, y, -0.005))

    # Welder: shield, dark window, hinges, square head harness (a ring would
    # cut through the head's corners).
    g = hat("Welder")
    shell = material("welder_shell", 0x2d2d29, "metal")
    add(g, "front", bm_box(0.48, 0.48, 0.06, 0.01), shell, (0, 0, 0.27))
    add(g, "sideR", bm_box(0.06, 0.48, 0.24, 0.01), shell, (0.24, 0, 0.17))
    add(g, "sideL", bm_box(0.06, 0.48, 0.24, 0.01), shell, (-0.24, 0, 0.17))
    add(g, "top", bm_box(0.48, 0.06, 0.24, 0.01), shell, (0, 0.24, 0.17))
    add(g, "frame", bm_box(0.3, 0.11, 0.02, 0.004), metal("welder_frame", 0x4a4a44), (0, 0.07, 0.305))
    add(g, "filter", bm_box(0.26, 0.08, 0.005), material("filterglass", 0x173a20, unlit=True), (0, 0.07, 0.317))
    for k, x in enumerate((-0.275, 0.275)):
        add(g, f"hinge{k}", bm_cyl(0.04, 0.04, 0.03, 12), metal("hinge", 0x8b8b80), (x, 0.1, 0.1), (0, 0, math.pi / 2), uv="wrap")
    harness = material("harness", 0x222222)
    hh, ht = 0.222, 0.024                                   # harness half-size, strap thickness
    add(g, "harnessB", bm_box(2 * hh + ht, 0.045, ht, 0.004), harness, (0, 0.12, -hh))
    add(g, "harnessL", bm_box(ht, 0.045, 2 * hh, 0.004), harness, (-hh, 0.12, 0))
    add(g, "harnessR", bm_box(ht, 0.045, 2 * hh, 0.004), harness, (hh, 0.12, 0))
    add(g, "harnessT", bm_box(0.045, ht, 2 * hh, 0.004), harness, (0, HEAD_TOP + ht / 2, 0))
    add(g, "trim", bm_box(0.5, 0.02, 0.06, 0.004), material("welder_trim", 0x7a1f1f), (0, -0.2, 0.3))

    # Headlamp: band snug round the head, a strap over the crown down to the
    # band front and back, lamp housing with glowing lens, battery pack.
    g = hat("Headlamp")
    band = material("elastic", 0x1d1f22, "fabric")
    bh = 0.227                                               # band half-size (head 0.21, brow to 0.224)
    add(g, "around", bm_box(2 * bh, 0.06, 2 * bh, 0.005), band, (0, 0.1, 0))
    add(g, "over", bm_box(0.06, 0.024, 2 * bh, 0.005), band, (0, HEAD_TOP + 0.012, 0))
    for k, z in enumerate((-bh + 0.006, bh - 0.006)):
        add(g, f"drop{k}", bm_box(0.06, HEAD_TOP + 0.024 - 0.13, 0.012, 0.003), band, (0, (HEAD_TOP + 0.024 + 0.13) / 2, z))
    add(g, "housing", bm_box(0.16, 0.11, 0.08, 0.01), metal("lamp_housing", 0x3a3c40), (0, 0.11, 0.26))
    add(g, "bezel", bm_cyl(0.05, 0.05, 0.03, 16), metal("bezel", 0x9a9da2), (0, 0.11, 0.31), (math.pi / 2, 0, 0), uv="wrap")
    add(g, "lens", bm_circle(0.042, 16), material("lamp_lens", 0xfff4c0, unlit=True), (0, 0.11, 0.327), uv=None)
    add(g, "battery", bm_box(0.15, 0.09, 0.06, 0.008), metal("battery", 0x2f3134), (0, 0.12, -0.25))
    add(g, "led", bm_box(0.03, 0.02, 0.01), material("led_green", 0x47ff6a, unlit=True), (0.04, 0.14, -0.281))

    # Party Hat: striped cone (stripes in the suit colour, chosen in Godot),
    # pompom, elastic down the cheeks and under the chin (outside the head).
    g = hat("Party Hat")
    add(g, "cone", bm_cyl(0.0, 0.18, 0.46, 24, open_ended=True), material("party_stripes", 0xffffff, "stripes_0", double=True),
        (-0.02, 0.45, 0), (0, 0, 0.14), uv="wrap")
    add(g, "trim", bm_torus(0.18, 0.015, 6, 24), material("party_trim", 0xf2ead8), (-0.002, 0.225, 0), (math.pi / 2, 0, 0.14))
    pom = empty("pom", g, (-0.055, 0.69, 0))
    for i in range(6):
        add(pom, f"blob{i}", bm_ico(0.035, 1), material("party_pom", 0xf2ead8, "fabric"),
            (math.sin(i * 2.1) * 0.02, math.cos(i * 1.3) * 0.015, math.cos(i * 2.1) * 0.02))
    el = material("party_elastic", 0xdddddd)
    ex, ez, ey_top, ey_bot = 0.216, 0.08, 0.225, -0.2
    for k, x in enumerate((-ex, ex)):
        add(g, f"elastic{k}", bm_box(0.006, ey_top - ey_bot, 0.006), el, (x, (ey_top + ey_bot) / 2, ez))
    add(g, "elastic_chin", bm_box(2 * ex, 0.006, 0.006), el, (0, ey_bot, ez))
    export_glb(root, "hats.glb")


def build_faces():
    root = empty("Faces", None, (1.2, 1.88, 1.6))
    black = material("ink", 0x0b0b0b, unlit=True)
    count = [0]

    def face(name):
        count[0] += 1
        return empty("face_" + name, root, ((count[0] - 1) * 0.85, 0, 0))

    def eyes(g):
        obj_from_bm("eyeL", bm_box(0.05, 0.05, 0.01), black, g, (-0.1, 0.05, 0.226))
        obj_from_bm("eyeR", bm_box(0.05, 0.05, 0.01), black, g, (0.1, 0.05, 0.226))

    g = face("Plain")
    eyes(g)
    obj_from_bm("mouth", bm_box(0.12, 0.02, 0.01), black, g, (0, -0.09, 0.226))

    g = face("Goggles")
    frame = material("goggle_frame", 0x3a2e22)
    lens = material("goggle_lens", 0x6f8f6a, unlit=True)
    for k, x in enumerate((-0.1, 0.1)):
        obj_from_bm(f"frame{k}", bm_torus(0.07, 0.025, 4, 8), frame, g, (x, 0.05, 0.23))
        obj_from_bm(f"lens{k}", bm_circle(0.06, 8), lens, g, (x, 0.05, 0.232))
    obj_from_bm("strap", bm_box(0.46, 0.03, 0.44, 0.004), frame, g, (0, 0.05, 0))

    g = face("Shades")
    obj_from_bm("glasses", bm_box(0.36, 0.08, 0.02, 0.006), black, g, (0, 0.05, 0.23))
    obj_from_bm("arms", bm_box(0.43, 0.02, 0.3, 0.0), material("shades_arm", 0x111111), g, (0, 0.06, 0.08))
    obj_from_bm("mouth", bm_box(0.12, 0.02, 0.01), black, g, (0, -0.09, 0.226))

    g = face("Bandage")
    # Wide enough to wrap over the ears (|x| <= 0.235).
    obj_from_bm("wrap", uv_faces(bm_box(0.49, 0.08, 0.46, 0.006)), material("bandage", 0xd8d2c0, "fabric"), g, (0, 0.08, 0), (0, 0, 0.25))
    obj_from_bm("eye", bm_box(0.06, 0.06, 0.01), black, g, (0.09, 0.0, 0.226))
    obj_from_bm("mouth", bm_box(0.12, 0.02, 0.01), black, g, (0, -0.09, 0.226))

    g = face("Monocle")
    obj_from_bm("ring", bm_torus(0.06, 0.015, 4, 10), material("monocle", 0xc0a040), g, (0.1, 0.05, 0.232))
    obj_from_bm("chain", bm_box(0.006, 0.16, 0.006), material("monocle", 0xc0a040), g, (0.15, -0.03, 0.23))
    eyes(g)
    obj_from_bm("mouth", bm_box(0.12, 0.02, 0.01), black, g, (0, -0.09, 0.226))

    g = face("Mustache")
    stache = material("mustache", 0x2a1a10)
    obj_from_bm("stache", bm_box(0.22, 0.05, 0.03, 0.01), stache, g, (0, -0.07, 0.23))
    obj_from_bm("curlL", bm_box(0.05, 0.04, 0.03, 0.01), stache, g, (-0.13, -0.05, 0.23), (0, 0, 0.5))
    obj_from_bm("curlR", bm_box(0.05, 0.04, 0.03, 0.01), stache, g, (0.13, -0.05, 0.23), (0, 0, -0.5))
    eyes(g)
    export_glb(root, "faces.glb")


def main():
    reset_scene()
    for build in (build_body, build_hats, build_faces):
        build()


if __name__ == "__main__":
    main()

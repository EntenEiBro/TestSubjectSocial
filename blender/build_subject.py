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
                    material, obj_from_bm, reset_scene)

BEVEL = 0.012
HATS = ["Hard Hat", "Beanie", "Bucket", "Paper Bag", "Top Hat", "Gas Mask", "Welder", "Headlamp", "Party Hat"]
FACES = ["Plain", "Goggles", "Shades", "Bandage", "Monocle", "Mustache"]


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

    def add(parent, nm, bm, mat, pos=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
        return obj_from_bm(nm, bm, mat, parent, pos, rot, scale)

    # Hard Hat: rounded shell hugging the cube head, ridge, front peak, sticker.
    g = hat("Hard Hat")
    yellow = material("hardhat", 0xe0b52a, "fabric")
    add(g, "shell", bm_sphere(0.3, 24, 12, hemi=True), yellow, (0, 0.17, 0), scale=(1, 0.72, 1.04))
    add(g, "band", bm_cyl(0.305, 0.305, 0.05, 28), yellow, (0, 0.19, 0))
    add(g, "ridge", bm_box(0.07, 0.07, 0.56, 0.01), material("hardhat_ridge", 0xd0a420, "fabric"), (0, 0.37, 0))
    add(g, "peak", bm_box(0.46, 0.035, 0.16, 0.008), material("hardhat_peak", 0xcfa21f, "fabric"), (0, 0.185, 0.33), (0.12, 0, 0))
    add(g, "sticker", bm_plane(0.12, 0.08), material("hazard_sticker", 0xffffff, "hazard"), (0, 0.27, 0.302), (-0.35, 0, 0))

    # Beanie: knit body, folded cuff, pompom (tinted with the suit colour in Godot).
    g = hat("Beanie")
    knit = material("knit_suit", 0xffffff, "knit")
    knit_dark = material("knit_suitDark", 0xb3b3b3, "knit")
    add(g, "body", bm_sphere(0.28, 20, 12, hemi=True), knit, (0, 0.2, 0), scale=(1, 0.85, 1))
    add(g, "cuff", bm_cyl(0.285, 0.29, 0.11, 24), knit_dark, (0, 0.2, 0))
    pom = empty("pom", g, (0, 0.46, 0))
    for i in range(7):
        add(pom, f"blob{i}", bm_ico(0.05, 1), material("pompom", 0xeeeae0, "fabric"),
            (math.sin(i * 1.7) * 0.03, math.cos(i * 2.3) * 0.02, math.cos(i * 1.7) * 0.03))

    # Bucket: dented pail upside down, rolled rim, ribs, handle.
    g = hat("Bucket")
    add(g, "pail", bm_cyl(0.22, 0.27, 0.4, 20, open_ended=True), material("pail", 0x8a9092, "metal", double=True), (0, 0.15, 0))
    add(g, "bottom", bm_cyl(0.22, 0.22, 0.02, 20), metal("pail_bottom", 0x8a9092), (0, 0.35, 0))
    add(g, "rim", bm_torus(0.27, 0.018, 6, 24), metal("pail_rim", 0x9aa0a2), (0, -0.05, 0), (math.pi / 2, 0, 0))
    for k, y in enumerate((0.06, 0.24)):
        add(g, f"rib{k}", bm_torus(0.25 - (y - 0.06) * 0.14, 0.01, 4, 24), metal("pail_rib", 0x737a7c), (0, y, 0), (math.pi / 2, 0, 0))
    add(g, "handle", bm_torus(0.2, 0.012, 4, 16, math.pi), metal("pail_handle", 0x5d6365), (0, -0.02, 0), (0, 0, math.pi))
    add(g, "lugR", bm_box(0.06, 0.06, 0.02, 0.005), metal("pail_handle", 0x5d6365), (0.27, 0, 0))
    add(g, "lugL", bm_box(0.06, 0.06, 0.02, 0.005), metal("pail_handle", 0x5d6365), (-0.27, 0, 0))
    add(g, "dent", bm_sphere(0.05, 8, 6), metal("pail_dent", 0x7c8284), (0.12, 0.27, 0.19), scale=(1, 0.5, 0.3))

    # Paper Bag: creased bag, jagged top, eye holes, wonky mouth.
    g = hat("Paper Bag")
    add(g, "bag", bm_box(0.5, 0.56, 0.48, 0.01), material("paperbag", 0xffffff, "paper"), (0, 0.04, 0))
    for i in range(9):
        add(g, f"tooth{i}", bm_box(0.07, 0.08, 0.49, 0.004), material("paperbag_top", 0xe6e0d0, "paper"),
            (-0.22 + i * 0.055, 0.33 + (i % 2) * 0.02, 0), (0, 0, 0.25 if i % 2 else -0.25))
    hole = material("hole", 0x080808, unlit=True)
    add(g, "eyeL", bm_circle(0.045, 12), hole, (-0.1, 0.08, 0.242))
    add(g, "eyeR", bm_circle(0.04, 12), hole, (0.1, 0.09, 0.242))
    add(g, "mouth", bm_box(0.14, 0.025, 0.005), hole, (0.01, -0.08, 0.242), (0, 0, 0.12))
    add(g, "crease", bm_box(0.004, 0.5, 0.004), material("crease", 0x7a5d34), (0.12, 0.04, 0.242))

    # Top Hat: silk crown, brim, curled edge, band with buckle.
    g = hat("Top Hat")
    silk = material("silk", 0x1c1b20, "fabric")
    add(g, "crown", bm_cyl(0.205, 0.185, 0.44, 24), silk, (0, 0.43, 0))
    add(g, "crowntop", bm_cyl(0.205, 0.205, 0.02, 24), material("silk_top", 0x2a2930, "fabric"), (0, 0.655, 0))
    add(g, "brim", bm_cyl(0.34, 0.34, 0.025, 28), silk, (0, 0.215, 0))
    add(g, "curl", bm_torus(0.335, 0.022, 6, 28), silk, (0, 0.23, 0), (math.pi / 2, 0, 0))
    add(g, "band", bm_cyl(0.19, 0.19, 0.07, 24), material("tophat_band", 0x7a1f1f, "fabric"), (0, 0.27, 0))
    add(g, "buckle", bm_box(0.07, 0.06, 0.02, 0.004), metal("brass_buckle", 0xc9a742), (0, 0.27, 0.19))

    # Gas Mask: rubber face piece, lenses, ribbed canister, straps.
    g = hat("Gas Mask")
    rubber = material("rubber", 0x2c3029, "fabric")
    add(g, "face", bm_box(0.4, 0.3, 0.1, 0.02), rubber, (0, -0.02, 0.25))
    add(g, "snout", bm_cyl(0.11, 0.14, 0.12, 16), rubber, (0, -0.14, 0.31), (math.pi / 2, 0, 0))
    can = empty("canister", g, (0, -0.17, 0.43), (math.pi / 2 - 0.3, 0, 0))
    add(can, "can", bm_cyl(0.085, 0.085, 0.16, 16), metal("can", 0x55604c))
    for k, y in enumerate((-0.05, 0, 0.05)):
        add(can, f"canrib{k}", bm_cyl(0.09, 0.09, 0.012, 16), metal("canrib", 0x3e4637), (0, y, 0))
    glass = material("mask_glass", 0x9fb89a, unlit=True)
    for k, x in enumerate((-0.1, 0.1)):
        add(g, f"lens{k}", bm_circle(0.065, 16), glass, (x, 0.07, 0.302))
        add(g, f"lensframe{k}", bm_torus(0.068, 0.014, 6, 16), metal("lensframe", 0x6b6f66), (x, 0.07, 0.302))
    for k, y in enumerate((0.05, 0.2)):
        add(g, f"strap{k}", bm_box(0.44, 0.035, 0.44, 0.005), rubber, (0, y, -0.01))

    # Welder: shield, dark window, hinges, harness.
    g = hat("Welder")
    shell = material("welder_shell", 0x2d2d29, "metal")
    add(g, "front", bm_box(0.48, 0.48, 0.06, 0.01), shell, (0, 0, 0.27))
    add(g, "sideR", bm_box(0.06, 0.48, 0.24, 0.01), shell, (0.24, 0, 0.17))
    add(g, "sideL", bm_box(0.06, 0.48, 0.24, 0.01), shell, (-0.24, 0, 0.17))
    add(g, "top", bm_box(0.48, 0.06, 0.24, 0.01), shell, (0, 0.24, 0.17))
    add(g, "frame", bm_box(0.3, 0.11, 0.02, 0.004), metal("welder_frame", 0x4a4a44), (0, 0.07, 0.305))
    add(g, "filter", bm_box(0.26, 0.08, 0.005), material("filterglass", 0x173a20, unlit=True), (0, 0.07, 0.317))
    for k, x in enumerate((-0.275, 0.275)):
        add(g, f"hinge{k}", bm_cyl(0.04, 0.04, 0.03, 12), metal("hinge", 0x8b8b80), (x, 0.1, 0.1), (0, 0, math.pi / 2))
    add(g, "harness", bm_torus(0.235, 0.022, 6, 24), material("harness", 0x222222), (0, 0.12, 0), (math.pi / 2, 0, 0))
    add(g, "trim", bm_box(0.5, 0.02, 0.06, 0.004), material("welder_trim", 0x7a1f1f), (0, -0.2, 0.3))

    # Headlamp: band, lamp housing with glowing lens, battery pack.
    g = hat("Headlamp")
    band = material("elastic", 0x1d1f22, "fabric")
    add(g, "around", bm_box(0.45, 0.06, 0.45, 0.005), band, (0, 0.1, 0))
    add(g, "over", bm_box(0.06, 0.03, 0.46, 0.005), band, (0, 0.245, 0))
    add(g, "housing", bm_box(0.16, 0.11, 0.08, 0.01), metal("lamp_housing", 0x3a3c40), (0, 0.11, 0.26))
    add(g, "bezel", bm_cyl(0.05, 0.05, 0.03, 16), metal("bezel", 0x9a9da2), (0, 0.11, 0.31), (math.pi / 2, 0, 0))
    add(g, "lens", bm_circle(0.042, 16), material("lamp_lens", 0xfff4c0, unlit=True), (0, 0.11, 0.327))
    add(g, "battery", bm_box(0.15, 0.09, 0.06, 0.008), metal("battery", 0x2f3134), (0, 0.12, -0.25))
    add(g, "led", bm_box(0.03, 0.02, 0.01), material("led_green", 0x47ff6a, unlit=True), (0.04, 0.14, -0.281))

    # Party Hat: striped cone (stripes in the suit colour, chosen in Godot), pompom, elastic.
    g = hat("Party Hat")
    add(g, "cone", bm_cyl(0.0, 0.18, 0.46, 24, open_ended=True), material("party_stripes", 0xffffff, "stripes_0", double=True), (-0.02, 0.45, 0), (0, 0, 0.14))
    add(g, "trim", bm_torus(0.18, 0.015, 6, 24), material("party_trim", 0xf2ead8), (-0.002, 0.225, 0), (math.pi / 2, 0, 0.14))
    pom = empty("pom", g, (-0.055, 0.69, 0))
    for i in range(6):
        add(pom, f"blob{i}", bm_ico(0.035, 1), material("party_pom", 0xf2ead8, "fabric"),
            (math.sin(i * 2.1) * 0.02, math.cos(i * 1.3) * 0.015, math.cos(i * 2.1) * 0.02))
    for k, x in enumerate((-0.2, 0.2)):
        add(g, f"elastic{k}", bm_box(0.006, 0.42, 0.006), material("party_elastic", 0xdddddd), (x, 0.02, 0.05))
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
    obj_from_bm("wrap", bm_box(0.46, 0.08, 0.46, 0.006), material("bandage", 0xd8d2c0, "fabric"), g, (0, 0.08, 0), (0, 0, 0.25))
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

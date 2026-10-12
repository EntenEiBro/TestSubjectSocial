"""VENT CRAWL props: the security drone (body + 4 rotors + eye) and the data chip."""
import math

from common import Merger, bm_box, bm_cyl, bm_sphere, bm_torus, game_mat


def build(root):
    shell = game_mat(0x3b3f3e, "metal")
    dark = game_mat(0x1a1b1a)
    band = game_mat(0xc9a227, "rust")
    eye = game_mat(0xff2010, glow=True)

    # Drone body (one mesh): squashed sphere shell, the hazard band around
    # it and the two crossed rotor arms. Faces +Z (the eye side).
    m = Merger()
    m.add(bm_sphere(0.34, 8, 6), shell, scale=(1, 0.45, 1.1))
    m.add(bm_torus(0.36, 0.035, 4, 14), band, rot=(math.pi / 2, 0, 0))
    for a in (math.pi / 4, -math.pi / 4):
        m.add(bm_box(1.0, 0.04, 0.06), dark, pos=(0, 0.04, 0), rot=(0, a, 0))
    body = m.finish("drone", root, pos=(0, 1.3, 0))

    # Rotors spin on their own (hub + two-bladed prop), children of the body.
    for k, (x, z) in enumerate(((0.35, 0.35), (-0.35, 0.35), (0.35, -0.35), (-0.35, -0.35))):
        r = Merger()
        r.add(bm_cyl(0.05, 0.05, 0.06, 6), dark)
        r.add(bm_box(0.36, 0.012, 0.05), dark, pos=(0, 0.03, 0))
        r.finish("rotor_%d" % k, parent=body, pos=(x, 0.08, z))

    # Red sensor eye (the game blinks it with its own material per drone).
    e = Merger()
    e.add(bm_sphere(0.075, 6, 4), eye)
    e.finish("eye", parent=body, pos=(0, -0.03, 0.36))

    # Data chip: green board (the game gives it the emissive glow), black die
    # and a row of gold contact fingers along one edge.
    board = game_mat(0x1d6b34)
    die = game_mat(0x151615)
    gold = game_mat(0xc9a227)
    c = Merger()
    c.add(bm_box(0.38, 0.05, 0.28), board)
    c.add(bm_box(0.15, 0.06, 0.15), die, pos=(0, 0.03, 0))
    for i in range(6):
        c.add(bm_box(0.03, 0.054, 0.05), gold, pos=(-0.125 + i * 0.05, 0, 0.105))
    c.finish("chip", root, pos=(1.5, 0.32, 0))

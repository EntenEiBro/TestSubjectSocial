"""SPIN CYCLE props: the turntable's breakable ring plates (one annular-sector
plate per ring, with its hazard rim stripe), the solid core with hub and
struts, and the roller wheel + foot of the rim-grinding arms.

The plates' body material ("m_plate_b8b4aa") is swapped by the game for the
ring's own (alternating, flashing) materials."""
import math

import bmesh

from common import P, Merger, bm_box, bm_cyl, game_mat

RADII = [6.0, 5.0, 4.1, 3.3, 2.6]
SEGMENTS = [14, 12, 10, 8]
DEPTH = 0.35
SHAFT_R = 9


def _cyl(rt, rb, h, seg):
    """common.bm_cyl with outward normals recalculated (its caps came out
    facing inward: the core's top cap was culled and showed the struts below)."""
    bm = bm_cyl(rt, rb, h, seg)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def _disc(r, y, seg=28):
    """Flat disc facing up (triangle fan), normals verified."""
    bm = bmesh.new()
    c = bm.verts.new(P(0, y, 0))
    ring = [bm.verts.new(P(r * math.cos(i / seg * math.tau), y, -r * math.sin(i / seg * math.tau))) for i in range(seg)]
    for i in range(seg):
        bm.faces.new((c, ring[i], ring[(i + 1) % seg]))
    bm.normal_update()
    if next(iter(bm.faces)).normal.z < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.normal_update()
    return bm


def _sector(r_in, r_out, half, depth, seg=8):
    """THREE ExtrudeGeometry of an annular sector (see spincycle.js
    sectorGeometry): top at y=0, bearing +X, mid-radius point at the origin."""
    bm = bmesh.new()
    mid = (r_in + r_out) / 2

    def gp(r, a, y):
        return P(r * math.cos(a) - mid, y, -r * math.sin(a))

    angs = [-half + 2 * half * i / seg for i in range(seg + 1)]
    ot = [bm.verts.new(gp(r_out, a, 0)) for a in angs]
    ob = [bm.verts.new(gp(r_out, a, -depth)) for a in angs]
    it = [bm.verts.new(gp(r_in, a, 0)) for a in angs]
    ib = [bm.verts.new(gp(r_in, a, -depth)) for a in angs]
    for i in range(seg):
        bm.faces.new((ot[i], ot[i + 1], it[i + 1], it[i]))
        bm.faces.new((ob[i], ib[i], ib[i + 1], ob[i + 1]))
        f = bm.faces.new((ot[i], ob[i], ob[i + 1], ot[i + 1]))
        f.smooth = True
        f = bm.faces.new((it[i], it[i + 1], ib[i + 1], ib[i]))
        f.smooth = True
    bm.faces.new((ot[0], it[0], ib[0], ob[0]))
    bm.faces.new((ot[-1], ob[-1], ib[-1], it[-1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    return bm


def _strip(r0, r1, a0, a1, y, x_off=0.0, seg=4):
    """Flat annular strip facing up (THREE RingGeometry laid flat)."""
    bm = bmesh.new()
    angs = [a0 + (a1 - a0) * i / seg for i in range(seg + 1)]
    inner = [bm.verts.new(P(r0 * math.cos(a) + x_off, y, -r0 * math.sin(a))) for a in angs]
    outer = [bm.verts.new(P(r1 * math.cos(a) + x_off, y, -r1 * math.sin(a))) for a in angs]
    for i in range(seg):
        bm.faces.new((inner[i], outer[i], outer[i + 1], inner[i + 1]))
    bm.normal_update()
    if next(iter(bm.faces)).normal.z < 0:   # Blender Z = game up
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.normal_update()
    return bm


def build(root):
    body = game_mat(0xb8b4aa, "plate")       # replaced per ring in the game
    hz = game_mat(0xffffff, "hazard")
    under = game_mat(0x2e2f2c, "metal")

    # ------------------------------------------------- breakable ring plates
    for k in range(4):
        r_out, r_in, n = RADII[k] - 0.03, RADII[k + 1] + 0.03, SEGMENTS[k]
        half, mid = math.pi / n - 0.008, (r_in + r_out) / 2
        m = Merger()
        m.add(_sector(r_in, r_out, half, DEPTH), body, uv=0.5)
        m.add(_strip(r_out - 0.26, r_out - 0.04, -half, half, 0.012, x_off=-mid), hz, uv=1.5 / r_out)
        # a stiffening rib under each plate (seen once the outer rings are gone)
        m.add(bm_box(r_out - r_in - 0.1, 0.12, 0.16), under, pos=(0, -DEPTH - 0.06, 0))
        m.finish("plate_%d" % k, root, pos=(-6.0 + k * 2.2, 0, 3.0))

    # ------------------------------------------------------------- the core
    rc = RADII[4] - 0.03
    core = game_mat(0xa29e94, "plate")
    dark = game_mat(0x2e2f2c, "metal")
    bolt = game_mat(0x8a8a82)
    c = Merger()
    c.add(_cyl(rc, rc, DEPTH, 28), core, pos=(0, -DEPTH / 2, 0), uv=0.5)
    # explicit top face (the cylinder's own cap rendered culled in the game)
    c.add(_disc(rc, 0.002), core, uv=0.5)
    c.add(_strip(rc - 0.26, rc - 0.04, 0, math.tau, 0.012, seg=28), hz, uv=1.5 / rc)
    c.add(_cyl(0.75, 0.9, 0.08, 12), dark, pos=(0, 0.04, 0))
    c.add(_cyl(0.4, 0.45, 0.06, 10), bolt, pos=(0, 0.11, 0))
    for i in range(6):
        a = i / 6 * math.tau
        c.add(_cyl(0.07, 0.07, 0.06, 6), bolt, pos=(math.cos(a) * 0.55, 0.1, math.sin(a) * 0.55))
    # Underside cross-struts (visible through the seams and once rings fall away)
    for i in range(3):
        c.add(bm_box(rc * 2 - 0.4, 0.22, 0.25), dark, pos=(0, -DEPTH - 0.11, 0), rot=(0, i / 3 * math.pi, 0))
    c.finish("core", root, pos=(0, 0, 0))

    # --------------------------------------------------- roller arm parts
    # Roller wheel (spins about its vertical axis against the rim).
    wheel = game_mat(0x2c2d2b, "metal")
    cap = game_mat(0x8a8a82, "metal")
    w = Merger()
    w.add(_cyl(0.25, 0.25, 0.3, 12), wheel)
    w.add(_cyl(0.27, 0.27, 0.04, 12), wheel, pos=(0, 0.15, 0))
    w.add(_cyl(0.27, 0.27, 0.04, 12), wheel, pos=(0, -0.15, 0))
    w.add(_cyl(0.08, 0.08, 0.36, 8), cap)
    for i in range(3):
        a = i / 3 * math.tau
        w.add(bm_box(0.12, 0.02, 0.04), cap, pos=(math.cos(a) * 0.16, 0.175, math.sin(a) * 0.16), rot=(0, -a, 0))
    w.finish("roller", root, pos=(8.0, 0, 0))

    # Arm foot bolted to the shaft lip (origin = foot centre).
    arm = game_mat(0x6b5a3a, "rust")
    f = Merger()
    f.add(bm_box(0.6, 0.9, 0.9, bevel=0.03), arm)
    f.add(bm_box(0.8, 0.08, 1.1), arm, pos=(0.05, -0.41, 0))
    for bz in (-0.42, 0.42):
        f.add(_cyl(0.05, 0.05, 0.05, 6), bolt, pos=(0.32, -0.35, bz))
    f.add(bm_box(0.04, 0.5, 0.5), dark, pos=(-0.31, 0.1, 0))
    f.finish("arm_foot", root, pos=(9.0, 0, 0))

"""TURBINE HALL props: the spinning shredder drum (drum + three rows of teeth),
the wall fan (static frame + spinning blade rotor) and the concrete pillar
with its hazard band.

Dimensions follow turbine.js. The shredder housing / hood boxes, the fans'
warning lamps (recoloured per bank), lee patches and wind particles stay
procedural in the game. The pillar gets THREE-style cylindrical UVs with the
JS texture repeats baked in (concrete 1 x 2, hazard band 3 x 0.5).
"""
import math

from common import Merger, bm_box, bm_circle, bm_cyl, bm_torus, game_mat, game_matrix

H = 7.0
FAN_R = 1.5
PILLAR_R = 0.75


def build(root):
    _shredder(root)
    _fan(root)
    _pillar(root)


def _shredder(root):
    """Drum along local X (length 2H) with 3 staggered rows of teeth; spins about X."""
    steel = game_mat(0x8d918c, "metal")
    tooth = game_mat(0xc9ccc6, "metal")
    m = Merger()
    m.add(bm_cyl(0.24, 0.24, H * 2, 10), steel, rot=(0, 0, math.pi / 2))
    rows, step = 3, 0.3
    per_row = math.floor((H * 2 - 0.2) / step)   # same as the JS Math.floor
    for r in range(rows):
        for i in range(per_row):
            a = r / rows * math.tau + i * 0.9
            m.add(bm_cyl(0, 0.06, 0.2, 4, smooth=False), tooth,
                  pos=(-H + 0.1 + (i + (r % 2) * 0.5) * step, math.cos(a) * 0.3, math.sin(a) * 0.3), rot=(a, 0, 0))
    m.finish("shredder_drum", root, pos=(0, 0.42, -9.0))


def _fan(root):
    """Fan frame (ring, dark backing disc, cross bars, legs) facing local +Z,
    and the rotor (5 raked blades + hub) that spins about local Z."""
    body = game_mat(0x4a4c47, "metal")
    blade = game_mat(0x7b7e76, "metal")
    dark = game_mat(0x060606, glow=True)
    f = Merger()
    f.add(bm_torus(FAN_R, 0.18, 6, 20), body)
    f.add(bm_circle(FAN_R, 16), dark, pos=(0, 0, -0.3))
    f.add(bm_box(FAN_R * 2, 0.07, 0.07), body, pos=(0, 0, 0.26))
    f.add(bm_box(FAN_R * 2, 0.07, 0.07), body, pos=(0, 0, 0.26), rot=(0, 0, math.pi / 2))
    f.add(bm_box(0.2, 2.0, 0.2), body, pos=(-1.0, -1.0, -0.35))
    f.add(bm_box(0.2, 2.0, 0.2), body, pos=(1.0, -1.0, -0.35))
    f.finish("fan_frame", root, pos=(-4.0, 2.0, 0))

    r = Merger()
    for i in range(5):
        pivot = game_matrix(rot=(0, 0, i / 5 * math.tau))
        r.add(bm_box(0.5, FAN_R * 0.9, 0.06), blade, pos=(0, FAN_R * 0.47, 0), rot=(0, 0.38, 0), parent_m=pivot)
    r.add(bm_cyl(0.28, 0.28, 0.4, 8), body, rot=(math.pi / 2, 0, 0))
    r.finish("fan_blades", root, pos=(0.0, 2.0, 0))


def _pillar(root):
    concrete = game_mat(0xb0aba0, "concrete")
    band = game_mat(0xffffff, "hazard")
    m = Merger()
    m.add(bm_cyl(PILLAR_R, PILLAR_R * 1.05, 2.2, 10), concrete, pos=(0, 1.1, 0))
    m.add(bm_cyl(PILLAR_R * 1.06 + 0.02, PILLAR_R * 1.06 + 0.02, 0.35, 10, open_ended=True), band, pos=(0, 0.32, 0))
    m.add(bm_cyl(PILLAR_R + 0.12, PILLAR_R + 0.12, 0.18, 10), concrete, pos=(0, 2.25, 0))
    ob = m.finish("pillar", root, pos=(4.0, 0, 0))
    _cyl_uvs(ob, {concrete.name: (1.0, 2.0), band.name: (3.0, 0.5)})


def _cyl_uvs(ob, reps):
    """THREE CylinderGeometry UVs (u around the axis, v along it; caps planar),
    scaled by each material's texture repeat."""
    me = ob.data
    uvl = me.uv_layers.active
    for poly in me.polygons:
        ru, rv = reps.get(me.materials[poly.material_index].name, (1.0, 1.0))
        cos = [me.vertices[me.loops[li].vertex_index].co for li in poly.loop_indices]
        if abs(poly.normal.z) > 0.9:   # cap (Blender Z = game up)
            rad = max(math.hypot(c.x, c.y) for c in cos) or 1.0
            for li, c in zip(poly.loop_indices, cos):
                uvl.data[li].uv = ((c.x / rad * 0.5 + 0.5) * ru, (c.y / rad * 0.5 + 0.5) * rv)
            continue
        # Game x = Blender x, game z = -Blender y; THREE's theta runs from +Z toward +X.
        us = [(math.atan2(c.x, -c.y) / math.tau) % 1.0 for c in cos]
        if max(us) - min(us) > 0.5:
            us = [u + 1.0 if u < 0.5 else u for u in us]
        z0 = min(c.z for c in cos)
        z1 = max(c.z for c in cos)
        hh = (z1 - z0) or 1.0
        for li, c, u in zip(poly.loop_indices, cos, us):
            uvl.data[li].uv = (u * ru, (c.z - z0) / hh * rv)

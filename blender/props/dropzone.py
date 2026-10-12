"""DROP ZONE props: the crane loads (single crate, strapped pallet) with their
hook rigs, the golden ration tin and the overhead gantry."""
from common import Merger, bm_box, bm_cyl, game_mat, uv_faces


class RepMerger(Merger):
    """Merger whose parts can carry a texture repeat (THREE texture.repeat on
    0..1 face UVs), e.g. the hazard straps (Tex.hazard([2, 1]))."""

    def add(self, part, mat, pos=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), parent_m=None, uv=None, rep=None):
        if rep is None:
            return super().add(part, mat, pos, rot, scale, parent_m, uv)
        uv_faces(part)
        layer = part.loops.layers.uv.verify()
        for f in part.faces:
            for loop in f.loops:
                u, v = loop[layer].uv
                loop[layer].uv = (u * rep[0], v * rep[1])
        # Base add() would recompute the UVs: inline its remaining steps.
        import bmesh
        import bpy
        from common import game_matrix
        m = game_matrix(pos, rot, scale)
        if parent_m is not None:
            m = parent_m @ m
        bmesh.ops.transform(part, matrix=m, verts=part.verts)
        if mat not in self.mats:
            self.mats.append(mat)
        idx = self.mats.index(mat)
        for f in part.faces:
            f.material_index = idx
        tmp = bpy.data.meshes.new("_merge_tmp")
        part.to_mesh(tmp)
        part.free()
        self.bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)


def _rig(kind, parent, top, hook, cable_mat):
    """Crane rig hanging above a load: hook block (+ spreader bar on pallets)
    and a 9 m cable (separate child so the game can switch its shadow off)."""
    r = Merger()
    r.add(bm_box(0.34, 0.22, 0.34), hook, pos=(0, 0.11, 0))
    if kind == "pallet":
        r.add(bm_box(2.3, 0.12, 0.12), hook, pos=(0, 0.04, 0))
    rig = r.finish("rig_" + kind, parent=parent, pos=(0, top, 0))
    c = Merger()
    c.add(bm_cyl(0.035, 0.035, 9.0, 4, smooth=False), cable_mat)
    c.finish("cable_" + kind, parent=rig, pos=(0, 0.22 + 4.5, 0))
    return rig


def build(root):
    crate = game_mat(0xffffff, "crate")
    wood = game_mat(0xb08a60, "wood")
    strap = game_mat(0xffffff, "hazard")
    cable = game_mat(0x1a1a1a)
    hook = game_mat(0x8a8d88, "metal")

    # Single crate load (1.3 m cube), origin on the floor under its centre.
    m = Merger()
    m.add(bm_box(1.3, 1.3, 1.3), crate, pos=(0, 0.65, 0))
    body = m.finish("load_crate", root, pos=(-3.0, 0, 0))
    _rig("crate", body, 1.3, hook, cable)

    # Heavy pallet: wooden base, 2x2 crates, two crossed hazard straps.
    p = RepMerger()
    p.add(bm_box(2.7, 0.22, 2.7), wood, pos=(0, 0.11, 0))
    for sx, sz in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        p.add(bm_box(1.2, 1.1, 1.2), crate, pos=(sx * 0.66, 0.77, sz * 0.66))
    p.add(bm_box(2.62, 0.08, 0.16), strap, pos=(0, 0.8, 0), rep=(2, 1))
    p.add(bm_box(2.62, 0.08, 0.16), strap, pos=(0, 0.8, 0), rot=(0, 1.5707963, 0), rep=(2, 1))
    body = p.finish("load_pallet", root, pos=(0.5, 0, 0))
    _rig("pallet", body, 1.32, hook, cable)

    # Golden ration tin: unlit gold can with two metal lids (origin = can centre).
    gold = game_mat(0xffc23a, None, glow=True)
    lid = game_mat(0x8a6a1a, "metal")
    t = Merger()
    t.add(bm_cyl(0.24, 0.24, 0.3, 10), gold)
    t.add(bm_cyl(0.26, 0.26, 0.05, 10), lid, pos=(0, 0.16, 0))
    t.add(bm_cyl(0.26, 0.26, 0.05, 10), lid, pos=(0, -0.16, 0))
    t.finish("tin", root, pos=(3.5, 0.45, 0))

    # Overhead gantry: two rails on columns flanking the bay + the back beam.
    steel = game_mat(0xb08a2a, "metal")
    dark = game_mat(0x55524a, "metal")
    g = Merger()
    for sx in (-1, 1):
        g.add(bm_box(0.35, 0.45, 14.6), steel, pos=(sx * 9.8, 7.2, 0))
        g.add(bm_box(0.4, 7.2, 0.4), dark, pos=(sx * 9.8, 3.6, -6.8))
        g.add(bm_box(0.4, 7.2, 0.4), dark, pos=(sx * 9.8, 3.6, 6.8))
    g.add(bm_box(20, 0.45, 0.35), steel, pos=(0, 7.2, -6.8))
    g.finish("gantry", root, pos=(0, 0, -12.0))

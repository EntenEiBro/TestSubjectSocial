"""Shared helpers for the Blender model scripts (run inside Blender).

Coordinates are written in the game's space (THREE / Godot: Y up, the
subject faces +Z) and converted to Blender's Z-up space with P(); the glTF
exporter's +Y-up conversion turns them back exactly, so every measurement
matches the game code.

    game (x, y, z)  ->  Blender (x, -z, y)  ->  glTF / Godot (x, y, z)
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TEX_DIR = os.path.join(ROOT, "godot", "assets", "textures")
OUT_DIR = os.path.join(ROOT, "godot", "assets", "models")

RX90 = Matrix.Rotation(math.pi / 2, 4, "X")

# Live mode (Blender started with its window): every new part is drawn as it
# is added, so the build can be watched. Set by showcase.py.
LIVE = {"on": False, "delay": 0.04}


def ui_context():
    """Operator context for the first Blender window (None without a window)."""
    import contextlib
    wm = bpy.context.window_manager
    if wm is not None and len(wm.windows):
        win = wm.windows[0]
        return bpy.context.temp_override(window=win, screen=win.screen)
    return contextlib.nullcontext()


def step():
    """Redraw the Blender window after adding a part (live mode only)."""
    if not LIVE["on"]:
        return
    import time
    try:
        with ui_context():
            bpy.ops.wm.redraw_timer(type="DRAW_WIN_SWAP", iterations=1)
    except Exception as exc:
        print("redraw failed:", exc)
    time.sleep(LIVE["delay"])


def P(x, y, z):
    return Vector((x, -z, y))


def rot_game(rx=0.0, ry=0.0, rz=0.0):
    """Game-space Euler XYZ rotation as a Blender rotation matrix."""
    return Matrix.Rotation(rx, 4, "X") @ Matrix.Rotation(ry, 4, "Z") @ Matrix.Rotation(-rz, 4, "Y")


_mats = {}


def reset_scene():
    """Empty the current scene (works with or without Blender's window)."""
    _mats.clear()
    for block in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.cameras, bpy.data.lights):
        for item in list(block):
            block.remove(item)


def hex_rgb(h):
    if isinstance(h, str):
        h = int(h.lstrip("#"), 16)
    srgb = [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
    # Blender colours are linear; the game's hex colours are sRGB.
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb)


def material(name, color=0xffffff, tex=None, unlit=False, double=False, alpha=None, emission=None):
    """Matte material (roughness 1, no specular), optionally textured."""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    if unlit:
        # A Background shader is exported as an unlit material (KHR_materials_unlit).
        sh = nt.nodes.new("ShaderNodeBackground")
        sh.inputs["Color"].default_value = (*hex_rgb(color), 1)
        nt.links.new(sh.outputs[0], out.inputs["Surface"])
    else:
        sh = nt.nodes.new("ShaderNodeBsdfPrincipled")
        sh.inputs["Base Color"].default_value = (*hex_rgb(color), 1)
        sh.inputs["Roughness"].default_value = 1.0
        sh.inputs["Metallic"].default_value = 0.0
        for key in ("Specular IOR Level", "Specular"):
            if key in sh.inputs:
                sh.inputs[key].default_value = 0.0
        if emission is not None:
            for key in ("Emission Color", "Emission"):
                if key in sh.inputs:
                    sh.inputs[key].default_value = (*hex_rgb(emission), 1)
            if "Emission Strength" in sh.inputs:
                sh.inputs["Emission Strength"].default_value = 1.0
        if tex:
            img = bpy.data.images.load(os.path.join(TEX_DIR, tex + ".png"), check_existing=True)
            tn = nt.nodes.new("ShaderNodeTexImage")
            tn.image = img
            tn.interpolation = "Closest"
            if color != 0xffffff:
                mix = nt.nodes.new("ShaderNodeMix")
                mix.data_type = "RGBA"
                mix.blend_type = "MULTIPLY"
                mix.inputs["Factor"].default_value = 1.0
                mix.inputs[6].default_value = (*hex_rgb(color), 1)
                nt.links.new(tn.outputs["Color"], mix.inputs[7])
                nt.links.new(mix.outputs[2], sh.inputs["Base Color"])
            else:
                nt.links.new(tn.outputs["Color"], sh.inputs["Base Color"])
            if alpha == "texture":
                nt.links.new(tn.outputs["Alpha"], sh.inputs["Alpha"])
        if isinstance(alpha, float):
            sh.inputs["Alpha"].default_value = alpha
        nt.links.new(sh.outputs[0], out.inputs["Surface"])
    if alpha is not None:
        try:
            m.surface_render_method = "BLENDED"
        except AttributeError:
            m.blend_method = "BLEND"
    m.use_backface_culling = not double
    _mats[name] = m
    return m


# --------------------------------------------------------------- primitives
# Each builder returns a bmesh in Blender orientation for the game-space
# primitive (THREE parameter semantics).

def bm_box(w, h, d, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector((w, d, h)), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, w * 0.3, h * 0.3, d * 0.3), segments=1, affect="EDGES", profile=0.5)
    return bm


def bm_cyl(rt, rb, h, seg=16, open_ended=False, smooth=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=not open_ended, cap_tris=False, segments=max(3, seg), radius1=rb, radius2=rt, depth=h)
    if smooth:
        for f in bm.faces:
            f.smooth = len(f.verts) == 4
    return bm


def bm_sphere(r, ws=16, hs=12, hemi=False, smooth=True):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=max(3, ws), v_segments=max(3, hs), radius=r)
    if hemi:
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -1e-5], context="VERTS")
    for f in bm.faces:
        f.smooth = smooth
    return bm


def bm_ico(r, detail=1):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=max(1, detail + 1), radius=r)
    return bm


def bm_torus(radius, tube, radial=6, tubular=16, arc=math.tau, smooth=True):
    """THREE TorusGeometry: ring around the game's Z axis (in the XY plane)."""
    bm = bmesh.new()
    closed = arc >= math.tau - 1e-6
    cols = tubular if closed else tubular + 1
    rows = []
    for i in range(cols):
        u = i / tubular * arc
        ring = []
        for j in range(radial):
            v = j / radial * math.tau
            g = Vector(((radius + tube * math.cos(v)) * math.cos(u), (radius + tube * math.cos(v)) * math.sin(u), tube * math.sin(v)))
            ring.append(bm.verts.new(P(*g)))
        rows.append(ring)
    for i in range(tubular if closed else tubular):
        a, b = rows[i], rows[(i + 1) % cols]
        for j in range(radial):
            f = bm.faces.new((a[j], b[j], b[(j + 1) % radial], a[(j + 1) % radial]))
            f.smooth = smooth
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def bm_plane(w, h):
    """THREE PlaneGeometry: XY plane facing +Z (game space)."""
    bm = bmesh.new()
    vs = [bm.verts.new(P(x, y, 0)) for (x, y) in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2))]
    bm.faces.new(vs)
    return bm


def bm_circle(r, seg=16):
    bm = bmesh.new()
    vs = [bm.verts.new(P(r * math.cos(i / seg * math.tau), r * math.sin(i / seg * math.tau), 0)) for i in range(seg)]
    bm.faces.new(vs)
    return bm


def uv_faces(bm, world=None):
    """Planar UVs per face along its dominant axis.

    world=None maps every face to 0..1 (THREE BoxGeometry semantics: one
    texture repeat per face); world=k tiles k repeats per metre instead."""
    layer = bm.loops.layers.uv.verify()
    for f in bm.faces:
        f.normal_update()   # faces made by hand (bm_plane, bm_circle) have no normal yet
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        a, b = [(1, 2), (0, 2), (0, 1)][ax]
        pts = [(l.vert.co[a], l.vert.co[b]) for l in f.loops]
        if world is None:
            u0, u1 = min(p[0] for p in pts), max(p[0] for p in pts)
            v0, v1 = min(p[1] for p in pts), max(p[1] for p in pts)
            du, dv = (u1 - u0) or 1.0, (v1 - v0) or 1.0
            for l, p in zip(f.loops, pts):
                l[layer].uv = ((p[0] - u0) / du, (p[1] - v0) / dv)
        else:
            for l, p in zip(f.loops, pts):
                l[layer].uv = (p[0] * world, p[1] * world)
    return bm


def game_matrix(pos=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    """Game-space placement (THREE position / Euler XYZ / scale) as a Blender matrix."""
    return Matrix.Translation(P(*pos)) @ rot_game(*rot) @ Matrix.Diagonal((scale[0], scale[2], scale[1], 1.0))


class Merger:
    """Collects many primitives into ONE mesh object (one draw call per
    material in the game instead of one per part). Parts are placed with
    game-space transforms; `parent_m` nests a sub-assembly transform."""

    def __init__(self):
        self.bm = bmesh.new()
        self.mats = []

    def add(self, part, mat, pos=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), parent_m=None, uv=None):
        m = game_matrix(pos, rot, scale)
        if parent_m is not None:
            m = parent_m @ m
        uv_faces(part, uv)
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

    def finish(self, name, parent=None, pos=(0, 0, 0), rot=(0, 0, 0)):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for mat in self.mats:
            me.materials.append(mat)
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        if parent is not None:
            ob.parent = parent
        place(ob, pos, rot)
        step()
        return ob


def game_mat(color=0xffffff, tex=None, glow=False, double=False):
    """Material following the game's naming scheme, which the Godot loader
    (props.gd) turns back into the exact flat material of the web version:
    "m_<tex|none>_<rrggbb>" (lit Lambert) or "g_..." (unlit), "_2s" = double-sided."""
    c = color if isinstance(color, int) else int(str(color).lstrip("#"), 16)
    name = "%s_%s_%06x%s" % ("g" if glow else "m", tex or "none", c, "_2s" if double else "")
    return material(name, c, tex=tex, unlit=glow, double=double)


def obj_from_bm(name, bm, mat, parent=None, pos=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    place(ob, pos, rot, scale)
    step()
    return ob


def place(ob, pos=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    ob.location = P(*pos)
    ob.rotation_mode = "XYZ"
    ob.rotation_euler = rot_game(*rot).to_euler("XYZ")
    # Game-space scale (sx along x, sy along up, sz along depth) -> Blender (x, depth, up).
    ob.scale = Vector((scale[0], scale[2], scale[1]))


def empty(name, parent=None, pos=(0, 0, 0), rot=(0, 0, 0)):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_size = 0.1
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    place(ob, pos, rot)
    return ob


def export_glb(root, filename):
    """Export `root` and all its descendants as a .glb in godot/assets/models."""
    os.makedirs(OUT_DIR, exist_ok=True)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    stack = [root]
    while stack:
        o = stack.pop()
        o.select_set(True)
        stack.extend(o.children)
    bpy.context.view_layer.objects.active = root
    path = os.path.join(OUT_DIR, filename)
    with ui_context():
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=True)
    print("exported", path)

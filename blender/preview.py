"""Render preview images of exported .glb models (for checking them quickly).

Run:  blender --background --python blender/preview.py -- <out.png> <model.glb> [<model2.glb> ...] [--hat NAME] [--face NAME]
Imports the models, frames them with a 3/4 camera and renders with Workbench.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
out = argv[0]
models = [a for a in argv[1:] if a.endswith(".glb")]
hat = argv[argv.index("--hat") + 1] if "--hat" in argv else None
face = argv[argv.index("--face") + 1] if "--face" in argv else None

bpy.ops.wm.read_factory_settings(use_empty=True)
for path in models:
    bpy.ops.import_scene.gltf(filepath=path)

# Keep only the requested hat / face (they all sit on the head origin).
head_z = 1.8
doomed = set()
for ob in bpy.data.objects:
    if ob.name.startswith("hat_") and ob.name != f"hat_{hat}" or ob.name.startswith("face_") and ob.name != f"face_{face}":
        doomed.update(c.name for c in ob.children_recursive)
        doomed.add(ob.name)
for name in doomed:
    if name in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)
for name in (f"hat_{hat}", f"face_{face}"):
    ob = bpy.data.objects.get(name)
    if ob:
        top = ob
        while top.parent:
            top = top.parent
        top.location = Vector((0, 0, head_z))  # head pivot height of the subject (0.92+0.08+0.88)

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
        hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
center = (lo + hi) / 2
size = max((hi - lo).length, 0.5)

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
bpy.context.scene.collection.objects.link(cam)
cam.location = center + Vector((size * 0.9, -size * 1.4, size * 0.45))
d = center - cam.location
cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
bpy.context.scene.camera = cam
sc = bpy.context.scene
sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.light = "STUDIO"
sc.display.shading.color_type = "TEXTURE"
sc.render.resolution_x = 640
sc.render.resolution_y = 640
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print("preview", out)

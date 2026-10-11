"""Build the game's models with Blender's window open, so you can watch.

Run:  blender --python blender/showcase.py -- [subject] [props] ...
      (no list = everything)

Every part is added one by one with the viewport redrawn in between, the
.glb files are exported exactly like the background build, and at the end
all models are framed in the viewport (textured solid shading). The window
stays open afterwards to look around; closing it ends Blender.
"""
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
# "props:sawblade,glassbridge" builds only those games' props.
wanted = {a.split(":")[0] for a in argv} or {"subject", "props"}
only_props = set()
for a in argv:
    if a.startswith("props:"):
        only_props |= set(a.split(":", 1)[1].split(","))


def view3d():
    for win in bpy.context.window_manager.windows:
        for area in win.screen.areas:
            if area.type == "VIEW_3D":
                region = next(r for r in area.regions if r.type == "WINDOW")
                return win, area, region
    return None


def setup_view(location=(1.5, 0.0, 1.0), distance=7.0):
    v = view3d()
    if not v:
        return
    win, area, region = v
    space = area.spaces.active
    space.shading.type = "SOLID"
    space.shading.color_type = "TEXTURE"
    space.shading.light = "STUDIO"
    space.overlay.show_extras = False
    r3d = space.region_3d
    r3d.view_location = location
    r3d.view_distance = distance
    from mathutils import Euler
    r3d.view_rotation = Euler((1.25, 0.0, 0.55)).to_quaternion()
    common.step()


def frame_all():
    v = view3d()
    if not v:
        return
    win, area, region = v
    with bpy.context.temp_override(window=win, area=area, region=region):
        bpy.ops.object.select_all(action="DESELECT")
        bpy.ops.view3d.view_all(center=False)
    common.step()


def main():
    common.LIVE["on"] = True
    common.reset_scene()
    setup_view()
    if "subject" in wanted:
        import build_subject
        build_subject.build_body()
        build_subject.build_hats()
        build_subject.build_faces()
    if "props" in wanted and os.path.exists(os.path.join(HERE, "build_props.py")):
        import build_props
        build_props.build_all(live_offset=True, only=only_props or None)
    frame_all()
    print("showcase finished: models exported to", common.OUT_DIR)
    if "quit" in wanted:
        # Leave the finished models on screen for a few seconds, then close.
        bpy.app.timers.register(lambda: (bpy.ops.wm.quit_blender(), None)[1], first_interval=float(os.environ.get("SHOWCASE_LINGER", "4")))


# Run once the window is up (scripts given with --python start before the first draw).
bpy.app.timers.register(lambda: (main(), None)[1], first_interval=0.5)

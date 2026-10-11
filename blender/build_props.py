"""Props for the minigames, modelled in Blender and exported per game to
godot/assets/models/props/<game>.glb.

Every game has its own module blender/props/<game>.py with a
`build(root)` function that adds named objects under the empty `root`;
the game loads them by name (Props.make("sawblade", "blade")). Parts that
always move together are merged into one mesh with common.Merger (fewer
draw calls on phones). Dimensions follow the web version's THREE geometry.

Headless:   blender -b --python blender/build_props.py -- [game ...]
Watch it:   blender --python blender/showcase.py -- props:sawblade,chairs [quit]
"""
import importlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402

PROPS_DIR = os.path.join(HERE, "props")


def games():
    return sorted(f[:-3] for f in os.listdir(PROPS_DIR) if f.endswith(".py") and not f.startswith("_"))


def build_all(live_offset=False, only=None):
    """Build (and export) every game's props, or just the ids in `only`."""
    os.makedirs(os.path.join(common.OUT_DIR, "props"), exist_ok=True)
    if PROPS_DIR not in sys.path:
        sys.path.insert(0, PROPS_DIR)
    x = 6.0
    for gid in games():
        if only and gid not in only:
            continue
        mod = importlib.import_module(gid)
        root = common.empty(gid, pos=(x if live_offset else 0.0, 0, 0))
        mod.build(root)
        common.export_glb(root, os.path.join("props", gid + ".glb"))
        x += 24.0


if __name__ == "__main__" and not any(a.endswith("showcase.py") for a in sys.argv):
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    common.reset_scene()
    build_all(only=set(args) or None)

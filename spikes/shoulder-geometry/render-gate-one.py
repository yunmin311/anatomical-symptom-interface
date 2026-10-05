"""
Render ONE (config, view) pair of the shoulder gate from the saved .blend.

Headless and one-shot by design: `blender --background shoulder.blend --python
render-gate-one.py -- <config> <view>`.

Run:  blender --background spikes/shoulder-geometry/shoulder.blend \
            --python render-gate-one.py -- bone-only front
"""

import bpy
import json
import os
import sys
from mathutils import Vector

SPIKE = r"E:\1project\asi-atlas-v2\spikes\shoulder-geometry"
OUT = os.path.join(SPIKE, "renders")
os.makedirs(OUT, exist_ok=True)

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
CFG = argv[0] if len(argv) > 0 else "bone-only"
VIEW = argv[1] if len(argv) > 1 else "front"

with open(os.path.join(r"E:\1project\asi-atlas-v2", "assets", "anatomy", "generated",
                       "shoulder-scene.json"), encoding="utf-8") as fh:
    SCENE = json.load(fh)
sys_of = {s["id"]: s["system"] for s in SCENE["structures"]}
label_of = {s["id"]: s["label"] for s in SCENE["structures"]}

PALETTE = {
    "bone":      ((0.945, 0.925, 0.855, 1.0), 0.42, 0.0),
    "cartilage": ((0.800, 0.855, 0.875, 1.0), 0.50, 0.0),
    "muscle":    ((0.520, 0.185, 0.155, 1.0), 0.58, 0.05),
    "fascia":    ((0.880, 0.855, 0.810, 1.0), 0.60, 0.0),
    "tendon":    ((0.905, 0.880, 0.790, 1.0), 0.45, 0.0),
    "ligament":  ((0.890, 0.865, 0.790, 1.0), 0.48, 0.0),
    "nerve":     ((0.900, 0.775, 0.250, 1.0), 0.45, 0.0),
    "artery":    ((0.680, 0.105, 0.105, 1.0), 0.40, 0.0),
    "vein":      ((0.150, 0.265, 0.540, 1.0), 0.40, 0.0),
    "organ":     ((0.720, 0.520, 0.470, 1.0), 0.60, 0.04),
    "gland":     ((0.760, 0.560, 0.610, 1.0), 0.55, 0.04),
    "skin":      ((0.845, 0.680, 0.585, 1.0), 0.62, 0.10),
}

CONFIGS = {
    "bone-only":          (["bone"], {}, None),
    "muscle-only":        (["muscle"], {}, None),
    "bone-muscle":        (["bone", "muscle"], {}, None),
    "vascular-overlay":   (["bone", "artery", "vein"], {"bone": 0.20}, None),
    # Isolate: NO systems, only the named structure. The first version passed
    # ["muscle"] here, which showed all 27 muscles and made the isolate render
    # byte-identical to muscle-only -- a silent no-op that still wrote a
    # plausible-looking PNG.
    "supraspinatus-only": ([], {}, "Right supraspinatus"),
}
systems, alphas, selection = CONFIGS[CFG]

scene = bpy.context.scene
sel_mat = bpy.data.materials.get("ASI_selection_highlight")
if sel_mat is None:
    # Recreate rather than append None: an empty slot renders as default white,
    # which is indistinguishable from "the highlight is white".
    sel_mat = bpy.data.materials.new("ASI_selection_highlight")
    sel_mat.use_nodes = True
    b = sel_mat.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (0.35, 0.95, 1.0, 1.0)
    b.inputs["Roughness"].default_value = 0.25
    b.inputs["Emission Color"].default_value = (0.35, 0.95, 1.0, 1.0)
    b.inputs["Emission Strength"].default_value = 0.55
    sel_mat.diffuse_color = (0.35, 0.95, 1.0, 1.0)
    print("[GATE] selection material was missing from the .blend; recreated")


def translucent(system):
    p = PALETTE.get(system, PALETTE["organ"])
    mat = bpy.data.materials.get(f"ASI_{system}_blend")
    if mat is None:
        mat = bpy.data.materials.new(f"ASI_{system}_blend")
        mat.use_nodes = True
        b = mat.node_tree.nodes.get("Principled BSDF")
        b.inputs["Base Color"].default_value = p[0]
        b.inputs["Roughness"].default_value = p[1]
        b.inputs["Alpha"].default_value = alphas.get(system, 1.0)
        try:
            mat.surface_render_method = "BLENDED"
        except (AttributeError, TypeError):
            pass
        mat.diffuse_color = p[0]
    return mat


visible = []
for ob in scene.objects:
    if ob.type != "MESH":
        continue
    system = sys_of.get(ob.name)
    is_sel = selection is not None and label_of.get(ob.name) == selection
    show = (system in systems) or is_sel
    ob.hide_render = not show
    if is_sel:
        ob.data.materials.clear()
        ob.data.materials.append(sel_mat)
    elif system in alphas:
        ob.data.materials.clear()
        ob.data.materials.append(translucent(system))
    else:
        ob.data.materials.clear()
        ob.data.materials.append(bpy.data.materials["ASI_" + str(system)])
    if show:
        visible.append(ob)

half = scene["asi_half_extent_m"]

# Frame on what is ACTUALLY visible, not on the whole shoulder. With a fixed
# shoulder-wide distance an isolated 35 mm structure rendered as a speck, which
# makes the isolate evidence useless. Clamped so the full-shoulder configs keep
# their established framing.
vis_lo = [float("inf")] * 3
vis_hi = [float("-inf")] * 3
for ob in visible:
    for c in ob.bound_box:
        w = ob.matrix_world @ Vector(c)
        for i in range(3):
            vis_lo[i] = min(vis_lo[i], w[i])
            vis_hi[i] = max(vis_hi[i], w[i])
vis_extent = max((vis_hi[i] - vis_lo[i]) for i in range(3)) if visible else half * 2
frame_half = min(half, max(vis_extent * 0.62, half * 0.14))
DIST = frame_half * 3.1
# Aim at the centre of what is VISIBLE, not the world origin. The scene origin
# is the centre of the whole shoulder, so an isolated structure sits well off to
# one side; moving the camera closer while still aiming at the origin pushed it
# straight out of frame.
target = Vector([(vis_lo[i] + vis_hi[i]) / 2 for i in range(3)]) if visible else Vector((0, 0, 0))
print(f"[GATE] framing: visible extent {vis_extent:.4f} m -> frame half {frame_half:.4f} m, "
      f"dist {DIST:.4f} m, target ({target.x:+.3f},{target.y:+.3f},{target.z:+.3f})")
VIEWS = {
    # anterior = -y, posterior = +y, the body's own right = -x
    "front":   Vector((0.0, -DIST, 0.0)),
    "back":    Vector((0.0, DIST, 0.0)),
    "lateral": Vector((-DIST * 1.12, 0.0, 0.0)),
    "oblique": Vector((-DIST * 0.80, -DIST * 0.78, DIST * 0.40)),
}

cam = scene.camera
cam.location = Vector(VIEWS[VIEW]) + target
d = target - cam.location
cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
bpy.context.view_layer.update()

from bpy_extras.object_utils import world_to_camera_view

def world_bbox_centre(ob):
    """Centre of the structure in world space.

    NOT ob.matrix_world.translation. The build centres every mesh about a single
    shared offset, so all 43 origins sit at the same point well outside the frame
    (ndc y = -2.46) while the geometry itself projects correctly inside it. An
    in-frame test on origins reported "0 in frame" for all twenty renders and
    wrongly refused them; the vertices were at ndc 0.43-0.79 the whole time.
    """
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for c in ob.bound_box:
        w = ob.matrix_world @ Vector(c)
        for i in range(3):
            lo[i] = min(lo[i], w[i])
            hi[i] = max(hi[i], w[i])
    return Vector([(lo[i] + hi[i]) / 2 for i in range(3)])


inside = 0
for ob in visible:
    co = world_to_camera_view(scene, cam, world_bbox_centre(ob))
    if 0.0 <= co.x <= 1.0 and 0.0 <= co.y <= 1.0 and co.z > 0:
        inside += 1
if visible and inside == 0:
    print(f"[GATE] REFUSING {CFG}/{VIEW}: 0/{len(visible)} in frame")
    raise SystemExit(3)

path = os.path.join(OUT, f"{CFG}__{VIEW}.png")
scene.render.filepath = path
bpy.ops.render.render(write_still=True)

# Report what was actually visible, by system, so a config that silently shows
# everything (an isolate that did not isolate) is obvious in the log and not only
# in the pixels.
vis_by_system = {}
for ob in visible:
    if selection and label_of.get(ob.name) == selection:
        k = "selected:" + label_of.get(ob.name, "?")
    else:
        k = str(sys_of.get(ob.name))
    vis_by_system[k] = vis_by_system.get(k, 0) + 1

size = os.path.getsize(path) if os.path.exists(path) else 0
print(f"[GATE] {CFG:20s} {VIEW:8s} visible={len(visible):3d} inframe={inside:3d} "
      f"bytes={size} systems={json.dumps(vis_by_system)}")
print("[GATE] OK")
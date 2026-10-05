"""
Render ONE configuration of the already-built shoulder scene.

Split from the build because a single 20-render batch over the bridge stopped
dead after the first frame -- status success, no traceback, no further stdout.
Rather than debug that as one long call, the build runs once and each config is
rendered in its own call, which both makes progress durable and localises the
problem if it recurs.

The config to render is read from spikes/shoulder-geometry/job.json so the
caller can choose it without editing this file.
"""

import bpy
import json
import os
from bpy_extras.object_utils import world_to_camera_view

ROOT = r"E:\1project\asi-atlas-v2"
SPIKE = os.path.join(ROOT, "spikes", "shoulder-geometry")
OUT = os.path.join(SPIKE, "renders")
JOB = os.path.join(SPIKE, "job.json")
os.makedirs(OUT, exist_ok=True)

with open(JOB, encoding="utf-8") as fh:
    job = json.load(fh)
CFG_NAME = job["config"]
VIEWS = job["views"]

scene = bpy.context.scene
scene.render.resolution_x = job.get("res", 900)
scene.render.resolution_y = job.get("res", 900)
scene.render.image_settings.file_format = "PNG"


def material(name, colour, rough, sss, alpha=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    b = mat.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = colour
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = 0.0
    if "Subsurface Weight" in b.inputs:
        b.inputs["Subsurface Weight"].default_value = sss
    if alpha < 1.0:
        b.inputs["Alpha"].default_value = alpha
        try:
            mat.surface_render_method = "BLENDED"
        except (AttributeError, TypeError):
            pass
    mat.diffuse_color = colour
    return mat


PALETTE = {
    "bone":      ((0.945, 0.925, 0.860, 1.0), 0.42, 0.0),
    "cartilage": ((0.800, 0.855, 0.875, 1.0), 0.50, 0.0),
    "muscle":    ((0.560, 0.215, 0.180, 1.0), 0.58, 0.06),
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
SELECTION_COLOUR = (0.35, 0.95, 1.0, 1.0)

CONFIGS = {
    "bone-only":          (["bone"], {}, None),
    "muscle-only":        (["muscle"], {}, None),
    "bone-muscle":        (["bone", "muscle"], {}, None),
    "vascular-overlay":   (["bone", "artery", "vein"], {"bone": 0.22}, None),
    "supraspinatus-only": (["muscle"], {}, "Right supraspinatus"),
}

systems, alphas, selection = CONFIGS[CFG_NAME]

# Rebuild the classification lookup from the scene JSON so materials come from the
# reviewed system map, never from a name pattern here.
with open(os.path.join(ROOT, "assets", "anatomy", "generated", "shoulder-scene.json"), encoding="utf-8") as fh:
    SCENE = json.load(fh)
sys_of = {s["id"]: s["system"] for s in SCENE["structures"]}
label_of = {s["id"]: s["label"] for s in SCENE["structures"]}

cache = {}


def get(system, alpha=None):
    key = (system, alpha)
    if key not in cache:
        p = PALETTE.get(system, PALETTE["organ"])
        cache[key] = material(f"ASI_{system}_{alpha}", p[0], p[1], p[2],
                              1.0 if alpha is None else alpha)
    return cache[key]


sel_mat = material("ASI_selection_highlight", SELECTION_COLOUR, 0.25, 0.0)
sb = sel_mat.node_tree.nodes.get("Principled BSDF")
sb.inputs["Emission Color"].default_value = SELECTION_COLOUR
sb.inputs["Emission Strength"].default_value = 1.6

subject = [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("bp3d:")]
print(f"[R] config {CFG_NAME}: {len(subject)} meshes in scene")

visible = []
for ob in subject:
    system = sys_of.get(ob.name)
    show = system in systems
    if selection and label_of.get(ob.name) == selection:
        show = True
    ob.hide_render = not show
    if show:
        visible.append(ob)
    if selection and label_of.get(ob.name) == selection:
        ob.data.materials.clear()
        ob.data.materials.append(sel_mat)
    else:
        ob.data.materials.clear()
        ob.data.materials.append(get(system, alphas.get(system)))

# restore any previous selection material
for ob in subject:
    if ob.name in sys_of and label_of.get(ob.name) == selection:
        continue
    if ob.hide_render:
        ob.data.materials.clear()
        ob.data.materials.append(get(sys_of.get(ob.name), alphas.get(sys_of.get(ob.name))))

print(f"[R] visible {len(visible)}: "
      + json.dumps({s: sum(1 for o in visible if sys_of.get(o.name) == s)
                    for s in systems}))

cam = scene.camera
if cam is None:
    raise RuntimeError("no camera in scene; run build-shoulder-scene.py first")

DIST = 0.9
VIEWS = {
    "front":   (0.0, -DIST, 0.0),
    "back":    (0.0, DIST, 0.0),
    "lateral": (-DIST * 1.15, 0.0, 0.0),
    "oblique": (-DIST * 0.85, -DIST * 0.75, DIST * 0.42),
}

from mathutils import Vector

for view_name in job["views"]:
    cam.location = Vector(VIEWS[view_name])
    d = Vector((0, 0, 0)) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()

    inside = 0
    for ob in visible:
        co = world_to_camera_view(scene, cam, ob.matrix_world.translation)
        if 0.02 <= co.x <= 0.98 and 0.02 <= co.y <= 0.98 and co.z > 0:
            inside += 1
    if inside == 0:
        raise RuntimeError(f"{CFG_NAME}/{view_name}: nothing in frame, refusing to write a blank render")

    path = os.path.join(OUT, f"{CFG_NAME}__{view_name}.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    size = os.path.getsize(path) if os.path.exists(path) else 0
    print(f"[R] {CFG_NAME:20s} {view_name:8s} {size:>8} bytes  {inside}/{len(visible)} in frame")

print(f"[R] DONE {CFG_NAME}")
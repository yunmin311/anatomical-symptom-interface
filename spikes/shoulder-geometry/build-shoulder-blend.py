"""
Build the RIGHT SHOULDER scene once and save it as a .blend.

Headless (`blender --background --python`), because the gate renders must be
reproducible without the GUI bridge. Two findings forced this:

1. Over the MCP bridge, only the FIRST bpy.ops.render.render() in a scene
   succeeds. A four-view batch produced exactly one image, always the first
   view, with status success and no traceback; follow-up calls stopped dead at
   the render operator. Unreliable for a gate that has to be repeatable.
2. The first render was massively overexposed -- 900 W area lights at 0.9 m --
   which bleached muscle and bone to the same near-white and destroyed the one
   judgement the render exists to support. Lighting is now derived, not guessed.

Run:  blender --background --python build-shoulder-blend.py
"""

import bpy
import json
import math
import os
from mathutils import Vector

ROOT = r"E:\1project\asi-atlas-v2"
SRC = r"E:\1project\anatomical-symptom-interface\assets\anatomy\source\obj\isa_BP3D_4.0_obj_99"
SPIKE = os.path.join(ROOT, "spikes", "shoulder-geometry")
SCENE_JSON = os.path.join(ROOT, "assets", "anatomy", "generated", "shoulder-scene.json")
BLEND = os.path.join(SPIKE, "shoulder.blend")

with open(SCENE_JSON, encoding="utf-8") as fh:
    SCENE = json.load(fh)

MM = 0.001

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
SELECTION_COLOUR = (0.35, 0.95, 1.0, 1.0)


def wipe():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.lights,
                 bpy.data.cameras, bpy.data.images, bpy.data.worlds):
        for item in list(coll):
            try:
                coll.remove(item)
            except (RuntimeError, ReferenceError):
                pass


def material(name, colour, rough, sss, alpha=1.0, emission=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    b = mat.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = colour
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = 0.0
    if "Subsurface Weight" in b.inputs:
        b.inputs["Subsurface Weight"].default_value = sss
    if emission:
        b.inputs["Emission Color"].default_value = colour
        b.inputs["Emission Strength"].default_value = emission
    if alpha < 1.0:
        b.inputs["Alpha"].default_value = alpha
        try:
            mat.surface_render_method = "BLENDED"
        except (AttributeError, TypeError):
            pass
    mat.diffuse_color = colour
    return mat


wipe()
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.length_unit = "CENTIMETERS"

# One material per system, created ONCE. Creating them per object produced
# ASI_muscle, ASI_muscle.001 ... ASI_muscle.027 -- 27 identical materials.
SYS_MATS = {}
for key, (colour, rough, sss) in PALETTE.items():
    SYS_MATS[key] = material("ASI_" + key, colour, rough, sss)

print(f"[B] importing {len(SCENE['structures'])} structures")
subject = []
for s in SCENE["structures"]:
    path = os.path.join(SRC, s["meshFile"])
    if not os.path.exists(path):
        print(f"[B] MISSING {s['meshFile']}")
        continue
    before = set(bpy.data.objects)
    # Explicit axes. wm.obj_import defaults to forward_axis='NEGATIVE_Z',
    # up_axis='Y', which ROTATES the body: the imported y range came out as
    # -1506..-969 mm, which is exactly -(source z 1506..969). With that default the
    # anterior/posterior/right-left camera presets silently address the wrong
    # sides of the body -- exactly the "Front/Back/Left/Right framing is
    # confusing" failure this gate exists to catch. BodyParts3D is Y-forward,
    # Z-up, so the import must be axis-preserving.
    bpy.ops.wm.obj_import(filepath=path, forward_axis="Y", up_axis="Z")
    new = [o for o in bpy.data.objects if o not in before]
    if not new:
        continue
    ob = max(new, key=lambda o: len(o.data.vertices) if o.type == "MESH" else 0)
    for extra in new:
        if extra is not ob:
            bpy.data.objects.remove(extra, do_unlink=True)
    ob.name = s["id"]
    ob.scale = (MM, MM, MM)
    bpy.context.view_layer.update()
    # Bake mm -> m into the data. wm.obj_import re-centres each mesh on its own
    # origin, so placing is measured from the imported result, never from the
    # source body coordinates.
    ob.data.transform(ob.matrix_world)
    ob.matrix_world.identity()
    ob.data.materials.clear()
    ob.data.materials.append(SYS_MATS.get(s["system"], SYS_MATS["organ"]))
    for poly in ob.data.polygons:
        poly.use_smooth = True
    subject.append(ob)

print(f"[B] imported {len(subject)} meshes")

# Centre on the shoulder structures only. BP3D's skin mesh is the WHOLE BODY at
# 1.72 m, so including it triples the framing box and shrinks the subject to a
# corner. Filtering must be by SYSTEM, not by name: the object is called
# bp3d:FJ2810 and "Skin" is only its anatomical label, so a substring test on the
# name silently matched nothing.
sys_of = {s["id"]: s["system"] for s in SCENE["structures"]}
focus = [o for o in subject if sys_of.get(o.name) != "skin"]
print(f"[B] framing subjects {len(focus)} of {len(subject)} "
      f"(excluded {[o.name for o in subject if sys_of.get(o.name) == 'skin']})")
bpy.context.view_layer.update()
bb_min = [math.inf] * 3
bb_max = [-math.inf] * 3
for ob in focus:
    for corner in ob.bound_box:
        w = ob.matrix_world @ Vector(corner)
        for i in range(3):
            bb_min[i] = min(bb_min[i], w[i])
            bb_max[i] = max(bb_max[i], w[i])
centre = Vector([(bb_min[i] + bb_max[i]) / 2 for i in range(3)])
for ob in subject:
    ob.location = ob.location - centre
bpy.context.view_layer.update()

extent = max(bb_max[i] - bb_min[i] for i in range(3))
# The mesh data was already scaled mm -> m above, so bb_min/bb_max are METRES.
# Dividing by MM again shrank the framing box a thousandfold and produced 0 W
# lights and a collapsed camera distance.
half = extent * 0.5

# Verify the import preserved the source axes, per axis, against the reviewed
# source bounds. This is the guard on the camera-preset bug: if the importer ever
# rotates the body again, the presets would address the wrong sides and this
# raises instead of producing plausible-looking nonsense.
src = SCENE["framing"]
problems = []
for i, ax in enumerate("xyz"):
    got = (bb_min[i], bb_max[i])
    want = (src["min"][i] * MM, src["max"][i] * MM)
    tol = 0.05
    if abs(got[0] - want[0]) > tol or abs(got[1] - want[1]) > tol:
        problems.append(
            f"{ax}: imported {got[0]:+.4f}..{got[1]:+.4f} but source bounds are "
            f"{want[0]:+.4f}..{want[1]:+.4f}"
        )
print(f"[B] axis check vs reviewed source bounds (tolerance {0.05} m): "
      + ("FAIL -> " + "; ".join(problems) if problems else "all three axes agree"))
if problems:
    raise SystemExit(
        "AXIS MISMATCH between the imported geometry and the reviewed source bounds. "
        "The camera presets would address the wrong sides of the body. Refusing to "
        "save. " + "; ".join(problems)
    )

# Sanity: the biggest individual structure should be scapula-sized (~0.17 m), not
# metres. If one is wildly out of scale it is reported rather than silently
# inflating the framing.
sizes = []
for ob in focus:
    lo = [math.inf] * 3
    hi = [-math.inf] * 3
    for c in ob.bound_box:
        w = ob.matrix_world @ Vector(c)
        for i in range(3):
            lo[i] = min(lo[i], w[i])
            hi[i] = max(hi[i], w[i])
    sizes.append((max(hi[i] - lo[i] for i in range(3)), ob.name))
sizes.sort(reverse=True)
print("[B] largest structures by extent (m): "
      + ", ".join(f"{n}={s:.3f}" for s, n in sizes[:5]))
print("[B] smallest structures by extent (m): "
      + ", ".join(f"{n}={s:.3f}" for s, n in sizes[-3:]))

# Which object owns each extreme of the framing box? An outlier here means one
# mesh was transformed differently from the rest, and the camera would frame that
# outlier instead of the shoulder.
print("[B] extremes of the framing box:")
for axis, idx in (("x", 0), ("y", 1), ("z", 2)):
    lo = min(focus, key=lambda o: min((o.matrix_world @ Vector(c))[idx] for c in o.bound_box))
    hi = max(focus, key=lambda o: max((o.matrix_world @ Vector(c))[idx] for c in o.bound_box))
    lov = min((lo.matrix_world @ Vector(c))[idx] for c in lo.bound_box)
    hiv = max((hi.matrix_world @ Vector(c))[idx] for c in hi.bound_box)
    print(f"    {axis}: min {lov:+.4f} from {lo.name}   max {hiv:+.4f} from {hi.name}")

# ----------------------------------------------------------------- lighting
# Energies are sized for the subject, not picked. An area light's useful range is
# a few multiples of its size; at ~1 m from a 0.5 m subject, 900 W was roughly two
# stops hot and flattened every material to the same value. These are keyed to the
# subject radius so the exposure does not drift if the scene scale changes.
def area(name, loc, watts, size):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = watts
    data.color = (1.0, 1.0, 1.0)
    data.size = size
    ob = bpy.data.objects.new(name, data)
    ob.location = loc
    scene.collection.objects.link(ob)
    d = Vector((0, 0, 0)) - Vector(loc)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return ob


d_key = half * 3.2
area("key", (-half * 1.6, -d_key * 0.9, half * 2.2), watts=round(28 * d_key * d_key), size=half * 2.2)
area("fill", (half * 2.4, -half * 1.6, half * 0.5), watts=round(7 * d_key * d_key), size=half * 2.6)
area("rim", (half * 1.0, d_key * 0.95, half * 1.6), watts=round(14 * d_key * d_key), size=half * 1.8)

world = bpy.data.worlds.new("studio")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.050, 0.053, 0.058, 1.0)
bg.inputs[1].default_value = 0.6
scene.world = world

# Standard view transform, not AgX. AgX is the modern default and it desaturates
# highlights hard, which is precisely the wrong behaviour when the whole point of
# the render is to judge whether muscle reads differently from bone.
try:
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
except TypeError:
    pass
scene.view_settings.exposure = 0.0
scene.view_settings.gamma = 1.0

cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 80.0
cam_data.clip_start = 0.01
cam_data.clip_end = 100.0
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
scene["asi_half_extent_m"] = half

try:
    scene.render.engine = "BLENDER_EEVEE_NEXT"
except TypeError:
    scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 900
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
try:
    scene.eevee.taa_render_samples = 96
except AttributeError:
    pass

# Selection material kept in the file so the isolate render can use it.
# use_fake_user is REQUIRED: nothing references this material at save time, and
# Blender drops zero-user datablocks when writing a .blend. Without it the
# isolate render silently fell back to an empty material slot and came out white.
sel = material("ASI_selection_highlight", SELECTION_COLOUR, 0.25, 0.0, emission=0.55)
sel.use_fake_user = True

bpy.ops.wm.save_as_mainfile(filepath=BLEND)
print(f"[B] saved {BLEND}")
print(f"[B] materials: {sorted(m.name for m in bpy.data.materials)}")
print(f"[B] lights: " + json.dumps({o.name: round(o.data.energy) for o in scene.objects if o.type == 'LIGHT'}))
print("[B] DONE")
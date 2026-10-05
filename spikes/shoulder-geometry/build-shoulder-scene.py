"""
RIGHT SHOULDER GEOMETRY SPIKE -- Blender build + render.

Runs inside Blender. Executed from the MCP bridge via execute_code, which does
exec(code, ns) and returns captured stdout, so values are reported with print().

What this is for: judge whether the 99%-reduction BodyParts3D geometry is good
enough to build a viewer on. The gate is deliberately BEFORE any web work, so
that a failure here stops the project instead of being disguised by CSS, shaders
or camera tuning.

Anatomy orientation in BodyParts3D, established from the data rather than
assumed (see scripts/scope-shoulder-review.mjs and the orientation probe):
    anterior  = NEGATIVE y   (sternum y=-189.5 is the most anterior midline point;
                              infraspinatus y=-36.5 is posterior)
    posterior = POSITIVE y
    superior  = POSITIVE z   (skin spans z -78 .. 1641, feet to head)
    the body's own RIGHT occupies NEGATIVE x
So a true lateral view of the RIGHT shoulder is a camera on -x looking toward +x.
"""

import bpy
import json
import math
import os
from mathutils import Vector

ROOT = r"E:\1project\asi-atlas-v2"
SRC = r"E:\1project\anatomical-symptom-interface\assets\anatomy\source\obj\isa_BP3D_4.0_obj_99"
SCENE_JSON = os.path.join(ROOT, "assets", "anatomy", "generated", "shoulder-scene.json")
OUT = os.path.join(ROOT, "spikes", "shoulder-geometry", "renders")
os.makedirs(OUT, exist_ok=True)

with open(SCENE_JSON, encoding="utf-8") as fh:
    SCENE = json.load(fh)

# ---------------------------------------------------------------- materials
#
# Presentation only. These colours are a PRESENTATION layer keyed to the
# tissue-system classification; they are not anatomical identity and they do not
# replace it. Standard anatomical-illustration convention: bone ivory, muscle a
# desaturated red-brown, artery red, vein blue, nerve yellow.
#
# Muscle is deliberately a dull red-brown, not a vivid red. A bright red muscle in
# a health product reads as inflammation, and nothing here is inflamed.
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
    "UNKNOWN":   ((0.500, 0.500, 0.500, 1.0), 0.70, 0.0),
}

# Selection is a SEPARATE visual state, not an anatomical material. A cyan-white
# emission reads unambiguously as "you picked this", and cannot be mistaken for
# tissue, for inflammation, or for a diagnosis.
SELECTION_COLOUR = (0.35, 0.95, 1.0, 1.0)


def make_material(name, colour, rough, sss, alpha=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = colour
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = 0.0
    if "Subsurface Weight" in bsdf.inputs:
        bsdf.inputs["Subsurface Weight"].default_value = sss
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        # EEVEE Next replaced blend_method with surface_render_method.
        try:
            mat.surface_render_method = "BLENDED"
        except (AttributeError, TypeError):
            try:
                mat.blend_method = "BLEND"
            except (AttributeError, TypeError):
                pass
    mat.diffuse_color = colour
    return mat


def make_selection_material():
    mat = bpy.data.materials.new("ASI_selection_highlight")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = SELECTION_COLOUR
    bsdf.inputs["Roughness"].default_value = 0.25
    bsdf.inputs["Emission Color"].default_value = SELECTION_COLOUR
    bsdf.inputs["Emission Strength"].default_value = 1.6
    mat.diffuse_color = SELECTION_COLOUR
    return mat


# ------------------------------------------------------------------ reset
def wipe():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.lights,
                 bpy.data.cameras, bpy.data.images):
        for item in list(coll):
            try:
                coll.remove(item)
            except (RuntimeError, ReferenceError):
                pass
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)


wipe()
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.length_unit = "CENTIMETERS"

# ----------------------------------------------------------------- import
# Objects are imported in millimetres then scaled to metres, because Blender's
# default unit is the metre and a 250 mm humerus left unscaled makes every light
# and clip distance wrong.
MM = 0.001
materials = {k: make_material("ASI_" + k, *v) for k, v in PALETTE.items()}
selection_mat = make_selection_material()

print(f"[BUILD] importing {len(SCENE['structures'])} structures")

imported = {}
tri_total = 0
for s in SCENE["structures"]:
    path = os.path.join(SRC, s["meshFile"])
    if not os.path.exists(path):
        print(f"[BUILD] MISSING FILE {s['meshFile']}")
        continue
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    if not new:
        print(f"[BUILD] import produced nothing for {s['meshFile']}")
        continue
    ob = max(new, key=lambda o: len(o.data.vertices) if o.type == "MESH" else 0)
    for extra in new:
        if extra is not ob:
            bpy.data.objects.remove(extra, do_unlink=True)

    ob.name = s["id"]
    ob.scale = (MM, MM, MM)
    bpy.context.view_layer.update()

    # Bake the mm -> m scale into the mesh data, then reset the object transform.
    #
    # Do NOT try to offset by the framing box here. bpy.ops.wm.obj_import
    # re-centres each mesh on its own origin, so mesh data arrives centred at
    # roughly z=0 regardless of where the structure sits in the body. Subtracting
    # the body-space centre therefore pushed the whole shoulder 1.24 m below the
    # world origin and every render came out empty. Centring is measured from the
    # imported result instead, below.
    ob.data.transform(ob.matrix_world)
    ob.matrix_world.identity()

    sysname = s["system"]
    ob.data.materials.clear()
    ob.data.materials.append(materials.get(sysname, materials["UNKNOWN"]))
    for poly in ob.data.polygons:
        poly.use_smooth = True

    imported[s["id"]] = {
        "object": ob,
        "label": s["label"],
        "system": sysname,
        "role": s["role"],
        "reviewStatus": s.get("reviewStatus", "machine-derived"),
        "agentProposed": bool(s.get("agentProposed")),
        "triangles": s["triangles"],
    }
    tri_total += s["triangles"]

print(f"[BUILD] imported {len(imported)} objects, {tri_total} triangles")
by_system = {}
for v in imported.values():
    by_system[v["system"]] = by_system.get(v["system"], 0) + 1
print(f"[BUILD] by system: {json.dumps(by_system)}")

# ------------------------------------------------------- frame and centre
# Centre on the SHOULDER STRUCTURES ONLY. Skin is excluded because BP3D's `Skin`
# mesh is the whole body, so including it would frame the entire figure.
fr = SCENE["framing"]
extent_mm = fr["extent"]
R = max(extent_mm) * MM * 0.5

subject = [v["object"] for v in imported.values() if v["role"] != "skin"]

# Measured from the imported meshes, not from the source bounds: this is the only
# placement that cannot be wrong about what the importer did to the origins.
bpy.context.view_layer.update()
bb_min = [math.inf] * 3
bb_max = [-math.inf] * 3
for ob in subject:
    for corner in ob.bound_box:
        w = ob.matrix_world @ Vector(corner)
        for i in range(3):
            bb_min[i] = min(bb_min[i], w[i])
            bb_max[i] = max(bb_max[i], w[i])
centre = Vector([(bb_min[i] + bb_max[i]) / 2 for i in range(3)])
for ob in subject:
    ob.location = ob.location - centre
bpy.context.view_layer.update()

print(f"[BUILD] imported bbox centre {[round(v, 4) for v in centre]}")
print(f"[BUILD] expected half-extent {R:.4f} m")
post_min = [math.inf] * 3
post_max = [-math.inf] * 3
for ob in subject:
    for corner in ob.bound_box:
        w = ob.matrix_world @ Vector(corner)
        for i in range(3):
            post_min[i] = min(post_min[i], w[i])
            post_max[i] = max(post_max[i], w[i])
print(f"[BUILD] centred bbox {[round(v, 4) for v in post_min]} -> {[round(v, 4) for v in post_max]}")

# ---------------------------------------------------------------- lighting
# Neutral studio: a key, a fill and a rim. Nothing coloured, so material colour
# reads true. A coloured light would make the palette judgement unreliable.
def add_light(name, kind, loc, energy, size=1.0):
    data = bpy.data.lights.new(name, kind)
    data.energy = energy
    data.color = (1.0, 1.0, 1.0)
    if kind == "AREA":
        data.size = size
    ob = bpy.data.objects.new(name, data)
    ob.location = loc
    scene.collection.objects.link(ob)
    # Area lights emit along their local -Z, which defaults to straight down.
    # Left unaimed they lit the floor and the shoulder stayed dark, so every
    # light is aimed at the subject.
    d = Vector((0, 0, 0)) - Vector(loc)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return ob


key = add_light("key", "AREA", (-R * 2.2, -R * 2.6, R * 2.4), 900, size=R * 2.0)
fill = add_light("fill", "AREA", (R * 2.4, -R * 1.8, R * 0.6), 260, size=R * 2.4)
rim = add_light("rim", "AREA", (R * 1.2, R * 2.8, R * 1.8), 480, size=R * 1.6)

world = bpy.data.worlds.new("studio")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.055, 0.058, 0.062, 1.0)
bg.inputs[1].default_value = 1.0
scene.world = world

# ----------------------------------------------------------------- camera
cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 85.0
cam_data.clip_start = 0.01
cam_data.clip_end = 100.0
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

# Distance chosen to frame the reviewed extent with a little air.
DIST = R * 3.4


def aim(obj, at):
    d = Vector(at) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


# anterior = -y, posterior = +y, the body's right = -x
VIEWS = {
    "front":   Vector((0.0, -DIST, 0.0)),                    # looking at the anterior surface
    "back":    Vector((0.0, DIST, 0.0)),                     # looking at the posterior surface
    "lateral": Vector((-DIST * 1.15, 0.0, 0.0)),             # from outside the right shoulder
    "oblique": Vector((-DIST * 0.85, -DIST * 0.75, DIST * 0.42)),
}

# --------------------------------------------------------------- renderer
try:
    scene.render.engine = "BLENDER_EEVEE_NEXT"
except TypeError:
    scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1000
scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
try:
    scene.eevee.taa_render_samples = 64
except AttributeError:
    pass

# ---------------------------------------------------------------- configs
CONFIGS = {
    # name: (systems to show, alpha overrides, selection id)
    "bone-only":          (["bone"], {}, None),
    "muscle-only":        (["muscle"], {}, None),
    "bone-muscle":        (["bone", "muscle"], {}, None),
    "vascular-overlay":   (["bone", "artery", "vein"], {"bone": 0.22}, None),
    "supraspinatus-only": (["muscle"], {}, "Right supraspinatus"),
}

print(f"[BUILD] scene ready in Blender; {len(subject)} subject objects centred")
print("[BUILD] DONE (build only; render via render-shoulder-config.py)")
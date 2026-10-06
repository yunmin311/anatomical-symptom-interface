"""
Derive professional 2D orthographic assets from the SAME licensed Blender source.

The hand-made SVG schematic is replaced by views rendered out of the anatomy the
project already ships, so the 2D surface and the 3D scene cannot disagree about
what a structure is. Nothing is drawn by hand and nothing is generated: these are
orthographic renders of BodyParts3D geometry, CC BY 4.0, attributed the same way.

Outputs, per view (front / back / left / right) and per layer:

    body-<view>-<layer>.png       1024 x 1024 orthographic render
    body-<view>-<layer>-id.png    same framing, flat per-structure colour (debug)
    body-<view>-<layer>.grid.json  hit grid, cells -> the SAME structure ids as 3D

WHY A BVH AND NOT A COLOUR-LOOKUP IMAGE
----------------------------------------
Matching a tap against a rendered ID pass means guessing which of several
antialiased, tone-mapped, colour-managed pixels is "the" colour of a structure.
Fragile, and it breaks the first time anything touches colour management.

So the hit map is computed geometrically: one BVH ray per grid cell, straight
through the scene, and the structure it hits is that cell's id. Exact,
antialiasing-proof, and it carries the same asi ids the 3D viewer uses, so a tap
on the 2D map selects the identical structure in 3D. One identity, two surfaces.

TWO THINGS THAT ARE EASY TO GET WRONG HERE, and both fail SILENTLY
-----------------------------------------------------------------
1. Orthographic rays are PARALLEL to the camera's forward axis. The pixel
   position picks where a ray starts in the plane through the camera, never
   which way it points. Building the direction from the right/up offsets sends
   every ray sideways across the scene and misses the body entirely.

2. scene.ray_cast() ignores hide_render. Hiding the skin to reveal bone is
   obvious and correct for the render and completely invisible to ray_cast, so
   the hit map keeps resolving skin on a bone-only layer and never complains.
   Hence the explicit per-layer BVH below instead of scene visibility flags.

Both produced an all-empty or all-skin hit map that looked like a legitimate
"nothing here" rather than a bug. The guards at the bottom now fail loudly.

Run: blender --background shoulder.blend --python derive-2d-views.py
"""
import bpy
import json
import os
from mathutils import Vector
from mathutils.bvhtree import BVHTree

REPO = r"E:\1project\asi-atlas-v2"
OUT_IMG = os.path.join(REPO, "apps", "web", "public", "anatomy", "views")
OUT_DATA = os.path.join(REPO, "assets", "anatomy", "generated", "views")
# Flat per-structure ID renders are a derivation aid for checking the hit map by
# eye. They are ~9 MB and nothing loads them at runtime, so they are written here
# instead of into public/.
SCRATCH = os.path.join(REPO, "spikes", "shoulder-geometry", "view-derivation")
os.makedirs(OUT_IMG, exist_ok=True)
os.makedirs(OUT_DATA, exist_ok=True)
os.makedirs(SCRATCH, exist_ok=True)

with open(os.path.join(REPO, "assets", "anatomy", "generated", "shoulder-scene.json"),
          encoding="utf-8") as fh:
    SCENE = json.load(fh)
SYS_OF = {s["id"]: s["system"] for s in SCENE["structures"]}
LABEL_OF = {s["id"]: s["label"] for s in SCENE["structures"]}

# The 3D manifest is the definition of what is SELECTABLE. Skin is loaded by the
# viewer as a whole-body context shell and is not in that list, so the 2D map must
# not resolve a cell to skin either -- otherwise a tap on the 2D map selects
# something the 3D viewer cannot select, and the two surfaces stop agreeing.
with open(os.path.join(REPO, "assets", "anatomy", "generated", "shoulder", "right", "manifest.json"),
          encoding="utf-8") as fh:
    MANIFEST_3D = json.load(fh)
SELECTABLE_3D = {s["id"] for s in MANIFEST_3D["structures"]}

BODY = bpy.data.objects.get("bp3d:FJ2810")
meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("bp3d")]
structures = [o for o in meshes if SYS_OF.get(o.name) != "skin"]

# --------------------------------------------------------------- the palette
# Mirrors apps/web/src/atlas/material-system.ts. A Blender script cannot import
# the TypeScript, so this is kept in step by hand; the ids match the manifest, so
# a divergence is detectable rather than silent.
PALETTE = {
    # Bone is deliberately NOT near-white. The render background is transparent
    # and a locator map is drawn on a light UI, so a 0.945 bone at 320W of key
    # light came out white-on-white and the whole scapula was invisible.
    "bone":      (0.855, 0.815, 0.715),
    "cartilage": (0.700, 0.770, 0.800),
    "muscle":    (0.560, 0.215, 0.185),
    "fascia":    (0.860, 0.830, 0.775),
    "tendon":    (0.900, 0.870, 0.760),
    "ligament":  (0.880, 0.850, 0.755),
    "nerve":     (0.870, 0.720, 0.190),
    "artery":    (0.680, 0.105, 0.105),
    "vein":      (0.130, 0.250, 0.520),
    "organ":     (0.700, 0.490, 0.440),
    "gland":     (0.740, 0.530, 0.590),
    "skin":      (0.845, 0.665, 0.565),
    "UNKNOWN":   (0.400, 0.410, 0.430),
}

# Per-structure tone spread, mirroring the deterministic within-system variation in
# apps/web/src/atlas/material-system.ts. Without it every muscle in a 2D view is
# the same flat pink and the map is unreadable -- the hit grid can tell them apart,
# but a person looking at the image cannot.
TONE_SPREAD = 0.30


def tone_for(structure_id, rgb):
    """Deterministic per-structure lightness offset from the id alone.

    Seeded by the id rather than by iteration order so the same structure is the
    same shade on every machine and in every re-run.
    """
    h = 0
    for i, c in enumerate(structure_id):
        h = (h * 31 + ord(c) * (i + 7)) & 0xFFFFFFFF
    k = ((h % 1000) / 1000.0 - 0.5) * TONE_SPREAD
    return tuple(min(1.0, max(0.0, c * (1.0 + k))) for c in rgb)

LAYER_SETS = {
    # No combined "all" layer. It is redundant and actively misleading: skin is the
    # outermost surface, so an all-systems render resolves entirely to skin and its
    # hit map has no selectable structure in it. It was byte-identical to "surface".
    # Four layers, and only three of them can be tapped.
    "surface":  ["skin"],
    "bone":     ["bone"],
    "muscle":   ["muscle"],
    "vascular": ["artery", "vein"],
}

scene = bpy.context.scene
for o in bpy.data.objects:
    if o.type == "MESH":
        o.hide_render = True

# Neutral, flat lighting. A 2D locator map is read by silhouette and position,
# not by shading, and dramatic light would invent form the source does not have.
for o in list(scene.objects):
    if o.type == "LIGHT":
        bpy.data.objects.remove(o, do_unlink=True)


def area(name, loc, energy, size):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.color = (1.0, 1.0, 0.97)
    data.size = size
    ob = bpy.data.objects.new(name, data)
    ob.location = loc
    scene.collection.objects.link(ob)
    ob.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return ob


area("key", (-2.2, -3.0, 2.6), 150, 4.0)
area("fill", (3.0, -2.0, 0.4), 55, 5.0)
area("rim", (1.2, 3.0, 1.8), 80, 4.0)

world = bpy.data.worlds.new("flat")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (1.0, 1.0, 1.0, 1.0)
# Low ambient on purpose. A strong white world plus a light palette washes the
# whole map out; a locator map wants legible edges, not studio realism.
bg.inputs[1].default_value = 0.42
scene.world = world

# 640 is the honest size for a locator map shown in a panel. At 1024 the twenty
# PNGs were 10.3 MB of detail nobody can use at this display size.
scene.render.resolution_x = 640
scene.render.resolution_y = 640
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.film_transparent = True
try:
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
except TypeError:
    pass
try:
    scene.render.engine = "BLENDER_EEVEE_NEXT"
except TypeError:
    scene.render.engine = "BLENDER_EEVEE"

# Orthographic camera: a 2D locator must not have perspective, or the same
# structure sits in a different place depending on how far away it is.
cam_data = bpy.data.cameras.new("ortho")
cam_data.type = "ORTHO"
cam_data.clip_start = 0.01
cam_data.clip_end = 60.0
cam = bpy.data.objects.new("ortho", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

# Frame to the ANATOMY SCOPE, not to the skin.
#
# The skin mesh is whole-body, but the 43 structures are shoulder-scoped. Framing
# to the skin put a single shoulder in the corner of a 1024px body-shaped canvas
# with 90% of it empty, which reads as "mostly missing" rather than "scoped". The
# map has to frame what we actually have, and grow when the scope grows.
bpy.context.view_layer.update()
mins = [1e9] * 3
maxs = [-1e9] * 3
for o in structures:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        for i in range(3):
            mins[i] = min(mins[i], w[i])
            maxs[i] = max(maxs[i], w[i])
centre = Vector([(mins[i] + maxs[i]) / 2 for i in range(3)])
span = max(maxs[i] - mins[i] for i in range(3))
cam_data.ortho_scale = span * 1.12
print(f"[2D] anatomy scope: {len(structures)} structures, span {span:.4f} m, "
      f"ortho_scale {cam_data.ortho_scale:.4f}")

# anterior = -Y, posterior = +Y, the body's own right = -X, superior = +Z
VIEWS = {
    "front": Vector((0.0, -1.0, 0.0)),
    "back":  Vector((0.0, 1.0, 0.0)),
    "left":  Vector((1.0, 0.0, 0.0)),
    "right": Vector((-1.0, 0.0, 0.0)),
}
GRID_W, GRID_H = 160, 200

ID_COLOURS = [((((i * 37) % 255) / 255.0, ((i * 91) % 255) / 255.0, ((i * 53) % 255) / 255.0, 1.0))
              for i in range(256)]

id_mats = {}
# EVERY mesh needs an ID material, skin included: from the front it is the first
# thing a ray meets, and an ID map without it resolves every frontal cell to
# nothing.
for i, o in enumerate(meshes):
    m = bpy.data.materials.new(f"ID_{i:03d}")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[0].default_value = ID_COLOURS[i]
    em.inputs[1].default_value = 1.0
    nt.links.new(em.outputs[0], nt.nodes.new("ShaderNodeOutputMaterial").inputs[0])
    id_mats[o.name] = m

disp_mats = {}
for o in meshes:
    sysname = SYS_OF.get(o.name, "UNKNOWN")
    rgb = tone_for(o.name, PALETTE.get(sysname, PALETTE["UNKNOWN"]))
    m = bpy.data.materials.new(f"D2D_{o.name.replace(':','_')}")
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
    b.inputs["Roughness"].default_value = 0.66
    b.inputs["Metallic"].default_value = 0.0
    m.diffuse_color = (rgb[0], rgb[1], rgb[2], 1.0)
    disp_mats[o.name] = m


def visible_for(layer_name):
    wanted = LAYER_SETS[layer_name]
    return [o for o in meshes if SYS_OF.get(o.name, "UNKNOWN") in wanted]


def build_bvh(objs):
    """One BVH over exactly the layer's meshes, plus a triangle -> structure map.

    The BVH depends only on geometry, not on the camera, so it is built once per
    layer and reused for all four views.

    Triangles come from loop_triangles rather than polygons. BodyParts3D meshes
    contain n-gons, and FromPolygons over 400k mixed n-gons raised an access
    violation and killed Blender outright.
    """
    verts = []
    tris = []
    owner = []
    idx = 0
    for o in objs:
        m = o.matrix_world
        base = len(verts)
        verts.extend([m @ v.co for v in o.data.vertices])
        o.data.calc_loop_triangles()
        for t in o.data.loop_triangles:
            a, b, c = t.vertices
            tris.append((base + a, base + b, base + c))
            owner.append(o.name)
        idx = len(verts)
    print(f"[2D]   bvh: {len(objs)} objects, {len(tris)} tris, {len(verts)} verts")
    tree = BVHTree.FromPolygons(verts, tris, all_triangles=True, epsilon=0.0)
    del verts, tris
    return tree, owner


def set_layers(layer_name, use_id=False):
    shown = {o.name for o in visible_for(layer_name)}
    for o in meshes:
        sysname = SYS_OF.get(o.name, "UNKNOWN")
        show = o.name in shown
        o.hide_render = not show
        if not show:
            continue
        o.data.materials.clear()
        o.data.materials.append(id_mats[o.name] if use_id else disp_mats[o.name])


def aim(view):
    d = VIEWS[view]
    cam.location = centre + d * 6.0
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()


def cast_grid(bvh, owner):
    origin = cam.matrix_world.translation
    basis = cam.matrix_world.to_3x3()
    cam_right = basis @ Vector((1, 0, 0))
    cam_up = basis @ Vector((0, 1, 0))
    forward = (basis @ Vector((0, 0, -1))).normalized()
    half = cam_data.ortho_scale * 0.5
    cells = []
    for gy in range(GRID_H):
        row = []
        for gx in range(GRID_W):
            nx = ((gx + 0.5) / GRID_W) * 2.0 - 1.0
            ny = 1.0 - ((gy + 0.5) / GRID_H) * 2.0
            start = origin + cam_right * (nx * half) + cam_up * (ny * half)
            hit = bvh.ray_cast(start, forward)
            row.append(owner[hit[2]] if hit[0] is not None else "")
        cells.append(row)
    return cells


manifest = {"schemaVersion": 1, "grid": {"w": GRID_W, "h": GRID_H}, "views": {}}

def encode_rows(cells):
    """Run-length encode the hit map as [startX, length, structureIndex] per row.

    The raw grid was 3.4 MB for twenty files because every one of 32000 cells
    carried a twelve-character string. BodyParts3D ids repeat along a row and most
    of the grid is empty, so runs compress this by roughly fifty times and the
    client expands it in one pass on load.
    """
    index = {}
    order = []
    rows = []
    for row in cells:
        runs = []
        x = 0
        w = len(row)
        while x < w:
            sid = row[x]
            if not sid:
                x += 1
                continue
            run = 1
            while x + run < w and row[x + run] == sid:
                run += 1
            if sid not in index:
                index[sid] = len(order)
                order.append(sid)
            runs.append([x, run, index[sid]])
            x += run
        rows.append(runs)
    return {"structures": order, "rows": rows}


for view in VIEWS:
    aim(view)
    manifest["views"][view] = {"layers": {}}

# Layers outer, views inner: the BVH is built once per layer and reused across
# all four views.
for layer in LAYER_SETS:
    bvh, owner = build_bvh(visible_for(layer))
    skin_is_content = "skin" in LAYER_SETS[layer]
    for view in VIEWS:
        aim(view)
        set_layers(layer, use_id=False)
        path = os.path.join(OUT_IMG, f"shoulder-{view}-{layer}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)

        set_layers(layer, use_id=True)
        scene.render.filepath = os.path.join(SCRATCH, f"shoulder-{view}-{layer}-id.png")
        bpy.ops.render.render(write_still=True)

        raw = cast_grid(bvh, owner)
        # A cell may only resolve to something the 3D viewer can also select.
        cells = [[("" if sid == BODY.name else sid) for sid in row] for row in raw]
        filled = sum(1 for row in cells for c in row if c)
        total = GRID_W * GRID_H
        skin_cells = sum(1 for row in raw for c in row if c == BODY.name)
        if skin_cells and skin_is_content:
            # Layer draws skin and every frontal cell lands on it, so this layer
            # has no selectable structure at all. That is a real product state,
            # not a bug, and it is recorded rather than papered over.
            print(f"[2D] {view:6s} {layer:9s} SELECTABLE=NO "
                  f"(all {skin_cells} filled cells are skin, which 3D does not expose)")
        else:
            unknown = {c for row in cells for c in row if c and c not in SELECTABLE_3D}
            if unknown:
                raise RuntimeError(
                    f"2D hit grid for {view}/{layer} resolves to {len(unknown)} ids the 3D "
                    f"manifest does not contain: {sorted(unknown)[:5]}")
            if filled == 0:
                raise RuntimeError(
                    f"2D hit grid for {view}/{layer} resolved 0 of {total} cells but the "
                    "layer should contain selectable anatomy. See the orthographic ray "
                    "direction note at the top of this script.")

        histogram = {}
        for row in cells:
            for c in row:
                if c:
                    histogram[c] = histogram.get(c, 0) + 1
        top = sorted(histogram.items(), key=lambda kv: -kv[1])[:5]
        print(f"[2D] {view:6s} {layer:9s} png={os.path.getsize(path)//1024:4d}KB "
              f"cells={filled}/{total} distinct={len(histogram)} "
              f"top={', '.join(f'{LABEL_OF.get(k, k).split()[0]}:{v}' for k, v in top)}")

        gpath = os.path.join(OUT_DATA, f"shoulder-{view}-{layer}.grid.json")
        encoded = encode_rows(cells)
        with open(gpath, "w", encoding="utf-8") as fh:
            json.dump({
                "schemaVersion": 1,
                "view": view,
                "layer": layer,
                "grid": {"w": GRID_W, "h": GRID_H},
                "selectable": filled > 0,
                "note": (
                    "Cells carry the SAME asi ids the 3D viewer uses, so a tap on the 2D map "
                    "selects the identical structure. Rows are [startX, length, structureIndex] "
                    "runs into structures[]; empty space is absent."),
                "skinCellsDropped": skin_cells,
                "structureCells": {LABEL_OF.get(k, k): v for k, v in sorted(histogram.items(), key=lambda kv: -kv[1])},
                **encoded,
            }, fh, separators=(",", ":"))

        manifest["views"][view]["layers"][layer] = {
            "image": f"/anatomy/views/shoulder-{view}-{layer}.png",
            "grid": f"/anatomy/views/shoulder-{view}-{layer}.grid.json",
            "pngBytes": os.path.getsize(path),
            "gridBytes": os.path.getsize(gpath),
            "selectable": filled > 0,
            "cellsFilled": filled,
            "cellsTotal": total,
            "distinctStructures": len(histogram),
        }

manifest["structures"] = [
    {"id": s["id"], "label": LABEL_OF.get(s["id"], s["id"]), "system": SYS_OF.get(s["id"], "UNKNOWN")}
    for s in SCENE["structures"]
]
manifest["provenance"] = {
    "method": "orthographic render of the same BodyParts3D meshes the 3D viewer uses",
    "dataset": "BodyParts3D",
    "release": "4.0 (mesh archive 2013/05, 99% polygon reduction)",
    "archive": "isa_BP3D_4.0_obj_99.zip",
    "archiveSha256": "40665852c49f218326590e204db91064a1ecfc3c6f8cbd7bbbcaac62c7cd409e",
    "doi": "10.18908/lsdba.nbdc00837-000",
    "licence": "CC-BY-4.0",
    "licenceUrl": "https://dbarchive.biosciencedb.jp/en/bodyparts3d/lic.html",
    "attribution": ("BodyParts3D, (c) The Database Center for Life Science licensed under "
                    "CC Attribution 4.0 International"),
    "retrievedAt": "2026-10-01",
    "officialLicenseLastUpdated": "2025-02-27",
    "ourLicenseEvidenceCheckedAt": "2026-10-05",
    "modified": True,
    "modification": ("geometry unmodified; orthographic renders and a BVH hit grid derived from it"),
    "codeLicence": "MIT (this repository's code)",
    "assetLicence": "CC BY 4.0 (the geometry and the images derived from it)",
    "handDrawn": False,
    "aiGenerated": False,
    "replaces": ("the hand-authored SVG silhouette in apps/web/src/anatomy/svg-geometry.ts, which "
                 "remains only as a development fallback"),
}

mpath = os.path.join(OUT_DATA, "manifest.json")
with open(mpath, "w", encoding="utf-8") as fh:
    json.dump(manifest, fh, indent=2)
print(f"[2D] wrote {mpath}")
print("[2D] DONE")
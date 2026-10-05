"""
Export web-viewer GLB assets from the built shoulder scene.

Two files, both in the same coordinate space so the shoulder sits inside the body:

  shoulder-atlas.glb  the 42 non-skin shoulder structures
  body-context.glb    BodyParts3D's whole-body Skin mesh

Deliberately exported WITHOUT materials. The tissue system is PRESENTATION
metadata and must not be baked into the asset where it would read as anatomical
identity. The viewer assigns materials at load time from the reviewed
anatomy-system-map, via a tested TypeScript module, so the same geometry can be
re-presented without re-exporting. This also keeps the files smaller.

BodyParts3D 4.0 is CC BY 4.0: attribution travels with the asset and is
recorded in the manifest, not implied by the file.

Run: blender --background shoulder.blend --python export-web-glb.py
"""

import bpy
import json
import os
import shutil

REPO = r"E:\1project\asi-atlas-v2"
SPIKE = os.path.join(REPO, "spikes", "shoulder-geometry")
# assets/anatomy/generated/ is the tracked authority; apps/web/public/anatomy/ is
# what the web app actually serves. Export to the first, publish to the second.
GEN = os.path.join(REPO, "assets", "anatomy", "generated", "shoulder", "right")
PUBLIC = os.path.join(REPO, "apps", "web", "public", "anatomy", "shoulder", "right")
os.makedirs(GEN, exist_ok=True)
os.makedirs(PUBLIC, exist_ok=True)

with open(os.path.join(REPO, "assets", "anatomy", "generated", "shoulder-scene.json"),
          encoding="utf-8") as fh:
    SCENE = json.load(fh)
sys_of = {s["id"]: s["system"] for s in SCENE["structures"]}
label_of = {s["id"]: s["label"] for s in SCENE["structures"]}
SYS_OF = sys_of
LABEL_OF = label_of

skin = [o for o in bpy.data.objects if o.type == "MESH" and sys_of.get(o.name) == "skin"]
shoulder = [o for o in bpy.data.objects
            if o.type == "MESH" and sys_of.get(o.name) not in (None, "skin")]
print(f"[X] skin meshes {len(skin)}  shoulder meshes {len(shoulder)}")


def export(objects, path, label):
    for o in bpy.data.objects:
        if o.type == "MESH":
            o.hide_render = True
    for o in objects:
        o.hide_render = False
    for o in bpy.data.objects:
        o.select_set(False)
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]

    # Identity travels in custom properties, not in the node NAME.
    #
    # three.js sanitises node names: PropertyBinding.sanitizeNodeName replaces
    # [ . : / ] and whitespace with "_", so a node exported as "bp3d:FJ3384"
    # arrives in the browser as "bp3d_FJ3384". A viewer that keys off the name
    # then matches nothing, silently renders every mesh with the glTF default
    # white material, and cannot hide or show anything. Custom properties export
    # to glTF `extras` and arrive as userData untouched.
    #
    # The name is still written, with a sanitised-safe form, because a name is
    # what a human reads in a debugger.
    for o in objects:
        sid = o.name
        o["asi_id"] = sid
        o["asi_label"] = LABEL_OF.get(sid, sid)
        o["asi_system"] = SYS_OF.get(sid, "UNKNOWN")
        o.name = sid.replace(":", "_")

    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_materials="NONE",     # presentation stays in code
        export_yup=True,             # glTF convention; the viewer converts back
        export_texcoords=False,
        export_normals=True,
        export_extras=True,          # carries asi_id / asi_label / asi_system
    )

    # Put the original names back so a re-save of this .blend is not confusing.
    for o in objects:
        if "asi_id" in o:
            o.name = o["asi_id"]

    size = os.path.getsize(path)
    tris = 0
    for o in objects:
        if o.type == "MESH":
            tris += sum(max(0, len(p.vertices) - 2) for p in o.data.polygons)
    print(f"[X] {label:16s} -> {os.path.basename(path)}  objects={len(objects)}  "
          f"tris={tris}  bytes={size} ({size/1024/1024:.2f} MB)")
    return {"file": os.path.basename(path), "objects": len(objects),
            "triangles": tris, "bytes": size}


manifest = {"schemaVersion": 1, "units": "metres", "glTFYup": True}
manifest["shoulder"] = export(shoulder, os.path.join(GEN, "shoulder-atlas.glb"), "shoulder-atlas")
manifest["bodyContext"] = export(skin, os.path.join(GEN, "body-context.glb"), "body-context")

# Record what each exported node actually IS, so the viewer never has to infer a
# tissue class from a name or a colour.
manifest["structures"] = [
    {
        "id": s["id"],
        "label": s["label"],
        "system": s["system"],
        "derivedClass": s.get("derivedClass"),
        "presentationSystemClassification": s.get("presentationSystemClassification"),
        "ontologyFmaVerification": s.get("ontologyFmaVerification"),
        "reviewStatus": s.get("reviewStatus"),
        "fma": s.get("fma"),
        "bp": s.get("bp"),
        "triangles": s.get("triangles"),
        "boundsMm": s.get("boundsMm"),
    }
    for s in SCENE["structures"] if s["system"] != "skin"
]

# Source systems that this dataset genuinely does not provide, for the shoulder.
# Recorded so the UI can say so rather than quietly omitting them.
manifest["unavailableInSource"] = [
    {"system": "nerve", "reason": "BodyParts3D 4.0 has 42 nerve meshes in the whole body and none in the shoulder: no brachial plexus, no axillary or suprascapular nerve."},
    {"system": "tendon", "reason": "BodyParts3D 4.0 models 8 tendons, none in the shoulder: the rotator cuff tendons are absent."},
    {"system": "ligament", "reason": "BodyParts3D 4.0 models 20 ligaments, none in the shoulder: the glenohumeral and coracohumeral ligaments are absent."},
    {"system": "cartilage", "reason": "BodyParts3D 4.0 models 51 cartilages, none in the shoulder."},
]

manifest["provenance"] = {
    "dataset": "BodyParts3D",
    "release": "4.0 (mesh archive 2013/05, 99% polygon reduction)",
    "archive": "isa_BP3D_4.0_obj_99.zip",
    "archiveSha256": "40665852c49f218326590e204db91064a1ecfc3c6f8cbd7bbbcaac62c7cd409e",
    "doi": "10.18908/lsdba.nbdc00837-000",
    "licence": "CC-BY-4.0",
    "licenceUrl": "https://dbarchive.biosciencedb.jp/en/bodyparts3d/lic.html",
    "attribution": "BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution 4.0 International",
    "retrievedAt": "2026-10-01",
    "officialLicenseLastUpdated": "2025-02-27",
    "ourLicenseEvidenceCheckedAt": "2026-10-05",
    "modified": True,
    "modification": "geometry unmodified; per-system presentation applied in the viewer; GLB re-encoded by Blender",
    "codeLicence": "MIT (this repository's code)",
    "assetLicence": "CC BY 4.0 (the geometry). The two are separate and must not be conflated.",
    "fidelity": "99% polygon reduction. Approved for regional localisation, layer exploration, selection and contextual viewing. NOT approved for surgical-grade, microscopic or high-magnification insertion/origin inspection; close zoom exposes visible polygon reduction and torn boundaries.",
}

out = os.path.join(GEN, "manifest.json")
with open(out, "w", encoding="utf-8") as fh:
    json.dump(manifest, fh, indent=2)
print(f"[X] wrote {out} ({os.path.getsize(out)} bytes)")

for name in ("shoulder-atlas.glb", "body-context.glb", "manifest.json"):
    src = os.path.join(GEN, name)
    dst = os.path.join(PUBLIC, name)
    shutil.copy2(src, dst)
    print(f"[X] published {name} -> apps/web/public/anatomy/shoulder/right/ ({os.path.getsize(dst)} bytes)")

print("[X] DONE")
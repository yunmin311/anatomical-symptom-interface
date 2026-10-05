import bpy
import json

with open(r"E:\1project\asi-atlas-v2\assets\anatomy\generated\shoulder-scene.json", encoding="utf-8") as fh:
    SCENE = json.load(fh)
label_of = {s["id"]: s["label"] for s in SCENE["structures"]}

print("[M] materials in blend:")
for m in bpy.data.materials:
    bsdf = None
    if m.use_nodes and m.node_tree:
        bsdf = m.node_tree.nodes.get("Principled BSDF")
    col = bsdf.inputs["Base Color"].default_value[:] if bsdf else None
    em = bsdf.inputs["Emission Strength"].default_value if bsdf and "Emission Strength" in bsdf.inputs else None
    emc = bsdf.inputs["Emission Color"].default_value[:] if bsdf and "Emission Color" in bsdf.inputs else None
    print(f"    {m.name:32s} base={[round(v,3) for v in col] if col else None} "
          f"emitStr={em} emitCol={[round(v,3) for v in emc] if emc else None}")

sel = bpy.data.materials.get("ASI_selection_highlight")
print("[M] selection material found:", sel is not None)

target = [o for o in bpy.data.objects if o.type == "MESH" and label_of.get(o.name) == "Right supraspinatus"]
for o in target:
    print(f"[M] {o.name} label={label_of.get(o.name)}")
    print(f"[M]   materials: {[m.name if m else None for m in o.data.materials]}")
    print(f"[M]   hide_render={o.hide_render} polys={len(o.data.polygons)}")
print("[M] DONE")
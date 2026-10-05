"""Diagnose the blank renders. Do not guess -- check the depsgraph."""
import bpy
import json
import math
import traceback
from mathutils import Vector

scene = bpy.context.scene
vl = bpy.context.view_layer

print("[DIAG] engine            ", scene.render.engine)
print("[DIAG] resolution        ", scene.render.resolution_x, "x", scene.render.resolution_y)
print("[DIAG] world             ", scene.world.name if scene.world else None)
print("[DIAG] camera            ", scene.camera.name if scene.camera else None)
if scene.camera:
    print("[DIAG] cam location      ", tuple(round(v, 4) for v in scene.camera.location))
    print("[DIAG] cam rotation deg  ", tuple(round(math.degrees(v), 2) for v in scene.camera.rotation_euler))
    print("[DIAG] cam lens          ", scene.camera.data.lens, " sensor", scene.camera.data.sensor_width)

meshes = [o for o in scene.objects if o.type == "MESH"]
print("[DIAG] mesh objects      ", len(meshes))
vis = [o for o in meshes if not o.hide_render]
print("[DIAG] visible to render ", len(vis))

# Are they actually IN the view layer? An object can exist in bpy.data but be
# linked to no collection the view layer sees, which renders as nothing.
in_layer = {o.name for o in vl.objects}
print("[DIAG] in view layer     ", sum(1 for o in meshes if o.name in in_layer))
print("[DIAG] scene collections ", [c.name for c in scene.collection.children])
print("[DIAG] objects linked to ", [c.name for c in bpy.data.collections])

if vis:
    xs = [tuple(round(c, 4) for c in o.matrix_world.translation) for o in vis]
    print("[DIAG] world positions sample", xs[:4])
    bb_min = [1e9] * 3
    bb_max = [-1e9] * 3
    for o in vis:
        for corner in o.bound_box:
            w = o.matrix_world @ Vector(corner)
            for i in range(3):
                bb_min[i] = min(bb_min[i], w[i])
                bb_max[i] = max(bb_max[i], w[i])
    print("[DIAG] combined world bbox", [round(v, 4) for v in bb_min], "->", [round(v, 4) for v in bb_max])
    print("[DIAG] bbox centre       ", [round((bb_min[i] + bb_max[i]) / 2, 4) for i in range(3)])

# Lights
lights = [o for o in scene.objects if o.type == "LIGHT"]
print("[DIAG] lights            ", [(o.name, o.data.type, round(o.data.energy)) for o in lights])
for o in lights:
    d = Vector((0, 0, 0)) - o.matrix_world.translation
    print("[DIAG]   ", o.name, "aims at", tuple(round(v, 3) for v in (o.matrix_world.translation + d.normalized() * 0.1)))

# What does the camera actually see? Project each visible object's centre.
if scene.camera:
    from bpy_extras.object_utils import world_to_camera_view
    inside = 0
    for o in vis[:60]:
        co = world_to_camera_view(scene, scene.camera, o.matrix_world.translation)
        if 0.0 <= co.x <= 1.0 and 0.0 <= co.y <= 1.0 and co.z > 0:
            inside += 1
    print(f"[DIAG] objects inside camera frame (of {min(len(vis),60)} sampled): {inside}")

# GPU / GL backend -- the likely reason EEVEE produced only the world colour.
try:
    import gpu
    print("[DIAG] gpu backend       ", gpu.platform.backend_type_get())
    print("[DIAG] renderer          ", gpu.platform.renderer_get())
    print("[DIAG] vendor            ", gpu.platform.vendor_get())
except Exception as e:
    print("[DIAG] gpu probe failed  ", type(e).__name__, e)

print("[DIAG] DONE")
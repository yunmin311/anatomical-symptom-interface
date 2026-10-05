import bpy
import json
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

scene = bpy.context.scene
cam = scene.camera
print("[P] camera object   ", cam.name if cam else None)
print("[P] scene.camera    ", scene.camera.name if scene.camera else None)
print("[P] custom prop half", scene.get("asi_half_extent_m"))

half = scene.get("asi_half_extent_m")
print("[P] cam loc         ", tuple(round(v, 4) for v in cam.location))
print("[P] cam rot deg     ", tuple(round(__import__("math").degrees(v), 2) for v in cam.rotation_euler))
print("[P] lens / sensor   ", cam.data.lens, cam.data.sensor_width, cam.data.sensor_fit)
print("[P] clip            ", cam.data.clip_start, cam.data.clip_end)

meshes = [o for o in scene.objects if o.type == "MESH"]
print("[P] meshes          ", len(meshes))
print("[P] first 3 names   ", [o.name for o in meshes[:3]])

DIST = half * 3.1
cam.location = Vector((0.0, -DIST, 0.0))
d = Vector((0, 0, 0)) - cam.location
cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
bpy.context.view_layer.update()
print("[P] after aim: loc  ", tuple(round(v, 4) for v in cam.location))
print("[P] after aim: rot  ", tuple(round(__import__("math").degrees(v), 2) for v in cam.rotation_euler))

dg = bpy.context.evaluated_depsgraph_get()
for o in meshes[:5]:
    mw = o.matrix_world
    co = world_to_camera_view(scene, cam, mw.translation)
    # also project a real vertex
    vs = [v.co for v in o.data.vertices[:1]]
    cov = world_to_camera_view(scene, cam, mw @ vs[0]) if vs else None
    print(f"[P]   {o.name:16s} origin=({mw.translation.x:+.4f},{mw.translation.y:+.4f},{mw.translation.z:+.4f}) "
          f"ndc=({co.x:.3f},{co.y:.3f},{co.z:.4f}) vert_ndc=({cov.x:.3f},{cov.y:.3f},{cov.z:.4f})" if cov else "")
print("[P] DONE")
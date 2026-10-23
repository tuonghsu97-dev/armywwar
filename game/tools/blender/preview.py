"""Render preview PNGs of exported GLBs.
Usage: blender -b --factory-startup --python preview.py -- id1 id2 ...   (or 'all')
Camera: 3/4 iso from front-left-above. Front of model (glTF +Z = Blender -Y) faces the camera side.
A small red arrow on the ground marks glTF +Z (forward).
"""
import bpy, sys, os, math, glob
from mathutils import Vector

OUT = r"D:\HoangKiet\armywwar\game\assets\models"
PREV = os.path.join(OUT, "preview")
os.makedirs(PREV, exist_ok=True)

ids = sys.argv[sys.argv.index('--') + 1:]
TOP = '--top' in ids
REST = '--rest' in ids
ids = [i for i in ids if i != '--rest']
ids = [i for i in ids if i != '--top']
if ids == ['all']:
    ids = sorted(os.path.splitext(os.path.basename(p))[0] for p in glob.glob(os.path.join(OUT, "*.glb")))


def reset():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)


sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sh = sc.display.shading
sh.light = 'STUDIO'
sh.color_type = 'MATERIAL'
sh.show_shadows = True
sh.show_cavity = True
sh.cavity_type = 'BOTH'
sh.show_object_outline = True
sc.render.resolution_x = 640
sc.render.resolution_y = 480
sc.render.film_transparent = False
sc.world.color = (0.55, 0.6, 0.65)
try:
    sh.background_type = 'WORLD'
except Exception:
    pass

for mid in ids:
    reset()
    path = os.path.join(OUT, mid + ".glb")
    if not os.path.exists(path):
        print('[PV] MISSING', mid); continue
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in sc.objects if o.type == 'MESH' and not o.name.startswith('Icosphere')]
    for arm in ([] if REST else [o for o in sc.objects if o.type == 'ARMATURE']):
        acts = sorted(bpy.data.actions, key=lambda a: (not a.name.startswith('Run'), a.name))
        if acts:
            try:
                if arm.animation_data is None:
                    arm.animation_data_create()
                for t in list(arm.animation_data.nla_tracks):
                    arm.animation_data.nla_tracks.remove(t)
                arm.animation_data.action = acts[0]
                try:
                    arm.animation_data.action_slot = acts[0].slots[0]
                except Exception:
                    pass
                sc.frame_set(8)
                print('[PV] posed with', acts[0].name)
            except Exception as e:
                print('[PV] pose fail', e)
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
    size = mx - mn
    r = max(size.length, 0.01)
    ctr = (mn + mx) / 2
    # ground plane + forward arrow
    bpy.ops.mesh.primitive_plane_add(size=r * 3, location=(ctr.x, ctr.y, min(0.0, mn.z) - r * 0.002))
    g = bpy.context.active_object
    gm = bpy.data.materials.new("g"); gm.diffuse_color = (0.42, 0.45, 0.4, 1); g.data.materials.append(gm)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(ctr.x, mn.y - r * 0.2, 0.002))
    a = bpy.context.active_object
    a.scale = (r * 0.02, r * 0.3, 0.002)
    am = bpy.data.materials.new("a"); am.diffuse_color = (0.9, 0.1, 0.1, 1); a.data.materials.append(am)
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = r * 1.15
    cam = bpy.data.objects.new("cam", cam_data)
    sc.collection.objects.link(cam)
    d = Vector((0.0, -0.001, 1.0)).normalized() if TOP else Vector((-0.75, -1.0, 0.95)).normalized()  # front-left-above
    cam.location = ctr + d * r * 3
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    cam_data.clip_end = r * 10
    sc.camera = cam
    tris = 0
    for o in objs:
        o.data.calc_loop_triangles(); tris += len(o.data.loop_triangles)
    sc.render.filepath = os.path.join(PREV, mid + ("_top.png" if TOP else "_rest.png" if REST else ".png"))
    bpy.ops.render.render(write_still=True)
    import json
    part = os.path.join(r"D:\HoangKiet\armywwar\game\tools\blender\work\manifest_parts", mid + ".json")
    if os.path.exists(part):
        d = json.load(open(part, encoding="utf-8"))
        d[mid]["tris"] = tris
        d[mid]["size_m"] = [round(v, 2) for v in (size.x, size.z, size.y)]  # glTF x,y(up),z(forward)
        json.dump(d, open(part, "w", encoding="utf-8"), indent=1)
    print("[PV]", mid, "tris", tris, "size", tuple(round(v, 2) for v in size),
          "objs", [o.name for o in objs], "anims", [a.name for a in bpy.data.actions], flush=True)

"""Shared helpers for WARGRID asset export (Blender 5.2, headless).

Conventions: Blender -Y = vehicle front -> glTF +Z. Origin at bottom-center
(ships: waterline = source z 0). Static meshes; rotors split into 'Rotor'/'TailRotor'.
"""
import bpy, bmesh, json, math, os, re
from mathutils import Vector, Matrix

ROOT = r"D:\HoangKiet\armywwar"
OUT = os.path.join(ROOT, "game", "assets", "models")
WORK = os.path.join(ROOT, "game", "tools", "blender", "work")
os.makedirs(OUT, exist_ok=True)
os.makedirs(WORK, exist_ok=True)

STRIP_TYPES = {'CAMERA', 'LIGHT', 'LIGHT_PROBE', 'SPEAKER'}
STRIP_RE = re.compile(r"(^|_)(Boom|Dust|EX\d|GX|Debris|Deb|Spark|Tracer|Smoke|Fire|Flame|FireE|FireCore|Puff|puff|Blur|Flash|Muz|Splash|Trail|Shell|Launch|LaunchFlash|Foam|Sea|Ground|Pad|Target|TargetShip|Wreck|Crate\d|Drop|Rocket|Missile|MissileFlame|hit|trail)(\b|_|\d|$|\.)")


def log(*a):
    print("[WG]", *a, flush=True)


def set_scene(name=None):
    sc = bpy.data.scenes[name] if name else bpy.context.scene
    bpy.context.window.scene = sc
    return sc


def is_stripped(o, extra=None, use_default=True):
    if o.type in STRIP_TYPES:
        return True
    if use_default and STRIP_RE.search(o.name):
        return True
    if extra and re.search(extra, o.name):
        return True
    return False


def tri_count(me):
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def flatten_material(m):
    """Bake procedural base colour to a flat value; drop texture links."""
    if m is None or not m.use_nodes or not m.node_tree:
        return
    nt = m.node_tree
    p = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if p is None:
        # make a principled from viewport colour
        out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None)
        emis = next((n for n in nt.nodes if n.type == 'EMISSION'), None)
        col = tuple(m.diffuse_color)
        if emis is not None and not emis.inputs['Color'].is_linked:
            col = tuple(emis.inputs['Color'].default_value)
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        p = nt.nodes.new('ShaderNodeBsdfPrincipled')
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(p.outputs[0], out.inputs[0])
        p.inputs['Base Color'].default_value = col
        if emis is not None:
            p.inputs['Emission Color'].default_value = col
            p.inputs['Emission Strength'].default_value = 1.0
        return
    for inp in p.inputs:
        if inp.is_linked:
            src = inp.links[0].from_node
            if inp.name == 'Base Color':
                col = None
                if src.type == 'VALTORGB':
                    els = src.color_ramp.elements
                    col = [sum(e.color[i] for e in els) / len(els) for i in range(4)]
                elif src.type == 'RGB':
                    col = list(src.outputs[0].default_value)
                elif src.type == 'MIX' or src.type == 'MIX_RGB':
                    ins = [i for i in src.inputs if i.type == 'RGBA' and not i.is_linked]
                    if ins:
                        cs = [list(i.default_value) for i in ins]
                        col = [sum(c[k] for c in cs) / len(cs) for k in range(4)]
                if col is None:
                    col = list(m.diffuse_color)
                col[3] = 1.0
                inp.default_value = col
            for l in list(inp.links):
                nt.links.remove(l)
    # remove now-unused nodes
    keep = {p}
    out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None)
    if out:
        keep.add(out)
        if not out.inputs['Surface'].is_linked:
            nt.links.new(p.outputs[0], out.inputs['Surface'])
        elif out.inputs['Surface'].links[0].from_node != p:
            nt.links.new(p.outputs[0], out.inputs['Surface'])
    for n in list(nt.nodes):
        if n not in keep:
            nt.nodes.remove(n)
    m.diffuse_color = tuple(p.inputs['Base Color'].default_value)


def bake_objects(root_name=None, frame=None, rest_pose=True, extra_strip=None, only=None, include_hidden=False, use_default_strip=True):
    """Return list of new mesh objects (not linked) baked in root-relative space."""
    sc = bpy.context.scene
    if frame is None:
        frame = sc.frame_start
    sc.frame_set(frame)
    if rest_pose:
        for a in bpy.data.armatures:
            a.pose_position = 'REST'
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    root = bpy.data.objects.get(root_name) if root_name else None
    rinv = root.matrix_world.inverted() if root else Matrix.Identity(4)
    baked = []
    for o in sc.objects:
        if o.type not in {'MESH', 'CURVE', 'SURFACE', 'FONT', 'META'}:
            continue
        if is_stripped(o, extra_strip, use_default_strip):
            continue
        if only and not re.search(only, o.name):
            continue
        if not include_hidden and (o.hide_render or not o.visible_get()):
            continue
        oe = o.evaluated_get(dg)
        try:
            me = bpy.data.meshes.new_from_object(oe, preserve_all_data_layers=False, depsgraph=dg)
        except Exception as e:
            log("skip", o.name, e)
            continue
        if len(me.polygons) == 0:
            bpy.data.meshes.remove(me)
            continue
        me.transform(rinv @ oe.matrix_world)
        if (rinv @ oe.matrix_world).determinant() < 0:
            me.flip_normals()
        no = bpy.data.objects.new(o.name, me)
        baked.append(no)
    log("baked", len(baked), "objects")
    return baked


def new_export_scene(objs):
    sc = bpy.data.scenes.new("EXPORT")
    for o in objs:
        sc.collection.objects.link(o)
    bpy.context.window.scene = sc
    for s in list(bpy.data.scenes):
        if s != sc:
            bpy.data.scenes.remove(s)
    # purge unrelated objects
    keep = set(objs)
    for o in list(bpy.data.objects):
        if o not in keep and o.users_scene == ():
            try:
                bpy.data.objects.remove(o)
            except Exception:
                pass
    return sc


def decimate_budget(objs, target, keep_small=150, min_ratio=0.02):
    """Collapse-decimate objects so the sum of triangles ~ target."""
    counts = {o: tri_count(o.data) for o in objs}
    total = sum(counts.values())
    if total <= target:
        return total
    for _ in range(3):
        small = sum(c for o, c in counts.items() if c <= keep_small)
        big = sum(c for o, c in counts.items() if c > keep_small)
        if big == 0:
            break
        r = max(min_ratio, min(1.0, (target - small) / big))
        for o, c in counts.items():
            if c <= keep_small or r >= 0.999:
                continue
            m = o.modifiers.new("dec", 'DECIMATE')
            m.decimate_type = 'COLLAPSE'
            m.ratio = r
            m.use_collapse_triangulate = True
            dg = bpy.context.evaluated_depsgraph_get()
            oe = o.evaluated_get(dg)
            nm = bpy.data.meshes.new_from_object(oe, depsgraph=dg)
            o.modifiers.clear()
            old = o.data
            o.data = nm
            bpy.data.meshes.remove(old)
            counts[o] = tri_count(nm)
        total = sum(counts.values())
        log("decimate pass r=%.3f -> %d tris" % (r, total))
        if total <= target * 1.05:
            break
    return total


def join(objs, name):
    if not objs:
        return None
    if len(objs) == 1:
        objs[0].name = name
        objs[0].data.name = name
        return objs[0]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    return o


def world_bbox(objs):
    mn = Vector((1e9,) * 3)
    mx = Vector((-1e9,) * 3)
    for o in objs:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            mn = Vector(map(min, mn, w))
            mx = Vector(map(max, mx, w))
    return mn, mx


def transform_all(objs, M):
    for o in objs:
        if o.parent is None:
            o.matrix_world = M @ o.matrix_world
    apply_transforms(objs)


def apply_transforms(objs):
    for o in objs:
        if o.parent is not None or o.type != 'MESH':
            continue
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)


def set_origin_to_center(o):
    """Move object origin to its bbox center (for spinning parts)."""
    mn, mx = world_bbox([o])
    c = (mn + mx) / 2
    o.data.transform(Matrix.Translation(-c))
    o.matrix_world = Matrix.Translation(c)


def place_on_ground(objs, waterline=False):
    mn, mx = world_bbox(objs)
    off = Vector((-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, 0 if waterline else -mn.z))
    for o in objs:
        if o.parent is None:
            o.matrix_world = Matrix.Translation(off) @ o.matrix_world


def mesh_stats(objs):
    return sum(tri_count(o.data) for o in objs if o.type == 'MESH')


def clean_scene_materials():
    for m in bpy.data.materials:
        flatten_material(m)


def get_mat(name, color, metal=0.0, rough=0.7, emit=None, alpha=None):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
    p = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    p.inputs['Base Color'].default_value = (*color, 1.0)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    if emit:
        p.inputs['Emission Color'].default_value = (*emit, 1.0)
        p.inputs['Emission Strength'].default_value = 3.0
    if alpha is not None:
        p.inputs['Alpha'].default_value = alpha
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
    m.diffuse_color = (*color, 1.0)
    return m


def export_glb(model_id, animations=False, extra=None):
    path = os.path.join(OUT, model_id + ".glb")
    kw = dict(filepath=path, export_format='GLB', use_active_scene=True, export_apply=True,
              export_yup=True, export_animations=animations, export_cameras=False, export_lights=False,
              export_draco_mesh_compression_enable=False, export_extras=False, export_texcoords=False)
    if extra:
        kw.update(extra)
    bpy.ops.export_scene.gltf(**kw)
    log("exported", path, os.path.getsize(path))
    return path


def write_manifest_entry(model_id, tris, source, animations=None, notes=""):
    """Each model writes its own json fragment; build_manifest.py merges."""
    d = os.path.join(WORK, "manifest_parts")
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, model_id + ".json"), "w", encoding="utf-8") as f:
        json.dump({model_id: {"file": model_id + ".glb", "tris": int(tris), "source": source,
                              "forward": "+Z", "animations": animations or [], "notes": notes}}, f, indent=1)


def finish(model_id, objs, source, yaw_deg=0.0, waterline=False, notes="", animations=None,
           anim_export=False, spin_parts=("Rotor", "TailRotor")):
    """Rotate (yaw so nose is -Y), ground, export, manifest."""
    if yaw_deg:
        transform_all(objs, Matrix.Rotation(math.radians(yaw_deg), 4, 'Z'))
    apply_transforms(objs)
    place_on_ground(objs, waterline)
    apply_transforms(objs)
    for o in objs:
        if o.name.split('.')[0] in spin_parts:
            set_origin_to_center(o)
    tris = mesh_stats(objs)
    export_glb(model_id, animations=anim_export)
    write_manifest_entry(model_id, tris, source, animations, notes)
    log("DONE", model_id, "tris", tris)
    return tris


def clip_above(objs, zmax):
    """Delete faces whose centroid is above zmax (strips antennas/whips)."""
    for o in objs:
        bm = bmesh.new(); bm.from_mesh(o.data)
        dead = [f for f in bm.faces if f.calc_center_median().z > zmax]
        if dead:
            bmesh.ops.delete(bm, geom=dead, context='FACES')
            bm.to_mesh(o.data)
        bm.free()

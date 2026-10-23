"""Decorative map tiles.  blender -b <tile.blend> --python export_map.py -- <model_id>
Strips lights/cameras/fire/smoke, planar-dissolve then collapse to <= 80k tris, keeps flat materials.
Origin: tile center at source ground level (z=0 kept, not lifted to bbox bottom).
"""
import bpy, sys, os, re, math
sys.path.insert(0, os.path.dirname(__file__))
import importlib, wg_lib as L
importlib.reload(L)

CFG = {
    'map_city': dict(src='the4_city10x10_v2.blend', scene='Map_City10', target=78000,
                     strip=r'Fire|Flame|Smoke|_Cam', notes='Ruined city district tile (roads, blocks, park, military post).'),
    'map_port': dict(src='the4_port10x10_v2.blend', scene='Map_Port10', target=78000,
                     strip=r'Fire|Flame|Smoke|_Sea$|_Cam', notes='Harbour tile: docks, containers, cranes, town, island. Sea plane removed (game draws water).'),
    'map_airbase': dict(src='the4_forest10x10_v4.blend', scene='Map_Forest10', target=78000,
                        strip=r'Fire|Flame|Smoke|_Cam', notes='Forest tile with twin airfields (Air_*), camp, towers.'),
}

mid = sys.argv[sys.argv.index('--') + 1]
c = CFG[mid]
L.set_scene(c['scene'])
baked = L.bake_objects(root_name=None, rest_pose=False, extra_strip=c['strip'], use_default_strip=False)
sc = L.new_export_scene(baked)
L.clean_scene_materials()
before = L.mesh_stats(baked)
# planar dissolve on everything big (lossless-ish for boxes)
for o in baked:
    if L.tri_count(o.data) < 400:
        continue
    m = o.modifiers.new('pl', 'DECIMATE'); m.decimate_type = 'DISSOLVE'; m.angle_limit = math.radians(4)
    m.delimit = {'MATERIAL'}
    dg = bpy.context.evaluated_depsgraph_get()
    nm = bpy.data.meshes.new_from_object(o.evaluated_get(dg), depsgraph=dg)
    o.modifiers.clear(); old = o.data; o.data = nm; bpy.data.meshes.remove(old)
mid_t = L.mesh_stats(baked)
L.log('tris', before, '-> planar', mid_t)
L.decimate_budget(baked, c['target'], keep_small=300, min_ratio=0.01)

def prune_small_islands(objs, target):
    """Collapse cannot reduce separate boxes/quads: drop the smallest-area islands until <= target."""
    import bmesh
    total = L.mesh_stats(objs)
    if total <= target:
        return
    isl = []   # (area, tris, obj, face indices)
    for o in objs:
        bm = bmesh.new(); bm.from_mesh(o.data); bm.faces.ensure_lookup_table()
        seen = set()
        for f in bm.faces:
            if f.index in seen:
                continue
            stack = [f]; ids = []; seen.add(f.index)
            while stack:
                g = stack.pop(); ids.append(g.index)
                for e in g.edges:
                    for h in e.link_faces:
                        if h.index not in seen:
                            seen.add(h.index); stack.append(h)
            area = sum(bm.faces[i].calc_area() for i in ids)
            tris = sum(len(bm.faces[i].verts) - 2 for i in ids)
            isl.append((area, tris, o.name, ids))
        bm.free()
    isl.sort(key=lambda t: t[0])
    excess = total - target
    kill = {}
    for area, tris, name, ids in isl:
        if excess <= 0:
            break
        kill.setdefault(name, []).extend(ids)
        excess -= tris
    for o in objs:
        ids = kill.get(o.name)
        if not ids:
            continue
        bm = bmesh.new(); bm.from_mesh(o.data); bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.faces[i] for i in ids], context='FACES')
        bm.to_mesh(o.data); bm.free()
    L.log('pruned islands ->', L.mesh_stats(objs), 'max area removed', area)


prune_small_islands(baked, c['target'])
for o in sorted(baked, key=lambda o: -L.tri_count(o.data))[:12]:
    L.log('big', o.name, L.tri_count(o.data))
j = L.join(baked, 'Tile')
L.log('final', L.tri_count(j.data), 'mats', len(j.data.materials))
L.finish(mid, [j], c['src'], yaw_deg=0, waterline=True, notes=c['notes'] + ' Origin at tile center, z=0 = source ground level.')

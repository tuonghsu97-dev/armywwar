import bpy, sys
dg = bpy.context.evaluated_depsgraph_get()
print("=== FILE", bpy.data.filepath)
print("scenes", [s.name for s in bpy.data.scenes], "frame", bpy.context.scene.frame_start, bpy.context.scene.frame_end)
print("actions", [(a.name, tuple(a.frame_range)) for a in bpy.data.actions])
for o in bpy.context.scene.objects:
    tris = 0
    if o.type == 'MESH':
        e = o.evaluated_get(dg); m = e.to_mesh()
        m.calc_loop_triangles(); tris = len(m.loop_triangles); e.to_mesh_clear()
    mods = [m.type for m in getattr(o,'modifiers',[])]
    act = o.animation_data.action.name if o.animation_data and o.animation_data.action else ''
    mats = [s.material.name for s in o.material_slots if s.material] if o.type=='MESH' else []
    print(f"{o.name:30s} {o.type:9s} par={o.parent.name if o.parent else '-':20s} tris={tris:7d} hide={o.hide_render} mods={mods} act={act} mats={mats[:4]} loc={tuple(round(v,2) for v in o.matrix_world.translation)} dims={tuple(round(v,2) for v in o.dimensions)}")

import bpy
for m in bpy.data.materials:
    if not m.use_nodes or not m.node_tree: print("MAT", m.name, "nonodes", tuple(m.diffuse_color)); continue
    types = [n.type for n in m.node_tree.nodes]
    p = next((n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'), None)
    bc = None
    if p:
        i = p.inputs['Base Color']; bc = ('LINK:'+i.links[0].from_node.type) if i.is_linked else tuple(round(x,3) for x in i.default_value)
    print("MAT", m.name, bc, [t for t in types if t not in ('OUTPUT_MATERIAL','BSDF_PRINCIPLED')][:8], "users", m.users)

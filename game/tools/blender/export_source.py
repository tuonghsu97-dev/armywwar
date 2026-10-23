"""Export a model from one of the source .blend files.
Usage: blender -b <src.blend> --python export_source.py -- <model_id>
The source file is never saved.
"""
import bpy, sys, os, re
sys.path.insert(0, os.path.dirname(__file__))
import importlib, wg_lib as L
importlib.reload(L)

CFG = {
    # model_id: dict(scene, root, target tris, yaw, strip regex, groups {regex: name}, team material rename)
    'tank_heavy': dict(src='JagdLeopard1_Tank.blend', scene='Tank_JagdLeopard1', root='Tank_Rig', target=9000, yaw=180, clip=2.4,
                       team=None, notes='Jagdpanzer-style tank destroyer; tracks/wheels baked static.'),
    'apc': dict(src='ArmoredTruck_8x8.blend', scene='Truck_Armored', root='Truck_Rig', target=8000, yaw=180, clip=3.2,
                strip=r'Bench|Floor', team='TR_Cyan', notes='8x8 armored truck; rear door closed, wheels static.'),
    'heli_attack': dict(src='AttackHeli_Mi28_Fly.blend', scene='Heli_Mi28', root='Heli_Rig', target=5000, yaw=180,
                        groups={r'^Rotor_': 'Rotor', r'^Tail_': 'TailRotor'}, team='HE_Red',
                        notes="Mi-28 style. Main rotor = node 'Rotor' (spin around local Y/up), tail rotor = 'TailRotor' (spin around local X)."),
    'drone': dict(src='CombatDrone.blend', scene='Drone_Combat', root='Drone_Rig', target=3000, yaw=180,
                  groups={r'^RotLF_': 'Rotor_LF', r'^RotRF_': 'Rotor_RF', r'^RotLR_': 'Rotor_LR', r'^RotRR_': 'Rotor_RR'},
                  team='DR_Red', notes="Quad combat drone with gun gimbal. Four props as nodes Rotor_LF/RF/LR/RR (spin around local up)."),
    'bomber': dict(src='Fighterjet.blend', scene='Scene', root='Bomber_Root', target=6000, yaw=180,
                   strip=r'BB_Bomb|BayCutter|BayInterior|^GR_|^Drop', team=None,
                   notes='Flying-wing style bomber; bombs and FX stripped, bay doors closed.'),
    'destroyer': dict(src='Warship.blend', scene='Warship', root='Ship_Rig', target=6000, yaw=180, waterline=True,
                      team='SH_Red', notes='Guided-missile destroyer; origin at waterline.'),
}


def main():
    mid = sys.argv[sys.argv.index('--') + 1]
    c = CFG[mid]
    L.set_scene(c['scene'])
    # frame 1, rest pose, root-relative
    baked = L.bake_objects(root_name=c['root'], frame=bpy.context.scene.frame_start,
                           rest_pose=c.get('rest', False), extra_strip=c.get('strip'))
    sc = L.new_export_scene(baked)
    if c.get('clip'):
        L.clip_above(baked, c['clip'])
    L.clean_scene_materials()
    if c.get('team') and bpy.data.materials.get(c['team']):
        bpy.data.materials[c['team']].name = 'TeamColor'
    groups = c.get('groups', {})
    # decimate (spin parts excluded from budget)
    body = [o for o in baked if not any(re.search(rx, o.name) for rx in groups)]
    L.decimate_budget(body, c['target'] - sum(L.tri_count(o.data) for o in baked if o not in body))
    out = []
    glists = [(name, [o for o in baked if re.search(rx, o.name)]) for rx, name in groups.items()]
    for name, parts in glists:
        j = L.join(parts, name)
        if j:
            out.append(j)
    j = L.join(body, 'Body')
    out.insert(0, j)
    for o in out:
        L.log('part', o.name, L.tri_count(o.data), [m.name for m in o.data.materials][:12])
    L.finish(mid, out, c['src'], yaw_deg=c['yaw'], waterline=c.get('waterline', False), notes=c['notes'],
             spin_parts=tuple(groups.values()))


main()

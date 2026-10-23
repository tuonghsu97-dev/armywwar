"""infantry.glb: low-poly box soldier skinned to the Viper.blend armature (rigid per-bone weights).
Pipeline: join rest-pose meshes -> voxel remesh -> collapse to ~1.8k tris ->
material transfer (nearest source face) -> weight transfer (Data Transfer) -> skinned export.
A small procedural rifle is parented to bone hand.R. Actions kept: Run, Aim.
"""
import bpy, bmesh, sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import importlib, wg_lib as L
importlib.reload(L)
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

TARGET = int(os.environ.get('INF_TRIS', '1850'))
VOXEL = float(os.environ.get('INF_VOXEL', '0.014'))
L.set_scene('Viper')
sc = bpy.context.scene
rig = bpy.data.objects['Viper_Rig']

for o in list(sc.objects):
    if o.type in {'LIGHT', 'CAMERA'} or o.name in {'Viper_FaceDetails', 'Ear1', 'Ear-1', 'Cube'}:
        bpy.data.objects.remove(o)
for s in list(bpy.data.scenes):
    if s != sc:
        bpy.data.scenes.remove(s)
meshes = [o for o in sc.objects if o.type == 'MESH' and o.parent == rig]

# ---- low-poly soldier built from boxes, each rigidly weighted to one Viper bone
mats = {
    'skin': L.get_mat('INF_Skin', (0.50, 0.33, 0.22), 0, 0.8),
    'uniform': L.get_mat('INF_Uniform', (0.13, 0.145, 0.07), 0, 0.9),
    'gear': L.get_mat('INF_Gear', (0.07, 0.075, 0.045), 0, 0.9),
    'dark': L.get_mat('INF_Dark', (0.025, 0.025, 0.025), 0, 0.7),
    'helmet': L.get_mat('INF_Helmet', (0.10, 0.115, 0.055), 0, 0.7),
    'team': L.get_mat('TeamColor', (0.6, 0.6, 0.6), 0, 0.6),
}
order = list(mats)
for o in meshes:
    bpy.data.objects.remove(o)
bones = rig.data.bones
H = lambda n: Vector(bones[n].head_local)
T = lambda n: Vector(bones[n].tail_local)

bm = bmesh.new()
dl = bm.verts.layers.deform.verify()
gindex = {}


def part(bone, p0, p1, s0, s1, m, ref=(0, 1, 0), taper_top=None):
    """Box from p0 to p1; s0/s1 = (width, depth) at each end. Rigidly bound to `bone`."""
    p0, p1 = Vector(p0), Vector(p1)
    dn = (p1 - p0).normalized()
    r = Vector(ref)
    u = (r - r.dot(dn) * dn)
    if u.length < 1e-4:
        u = Vector((1, 0, 0)) - Vector((1, 0, 0)).dot(dn) * dn
    u.normalize()
    v = dn.cross(u)
    rings = []
    for p, (w, d) in ((p0, s0), (p1, s1)):
        rings.append([bm.verts.new(p + u * (a * w / 2) + v * (b * d / 2)) for a, b in ((1, 1), (-1, 1), (-1, -1), (1, -1))])
    a, b = rings
    fs = [bm.faces.new([a[i], a[(i + 1) % 4], b[(i + 1) % 4], b[i]]) for i in range(4)]
    fs.append(bm.faces.new(list(reversed(a))))
    fs.append(bm.faces.new(b))
    if bone not in gindex:
        gindex[bone] = len(gindex)
    for vv in a + b:
        vv[dl][gindex[bone]] = 1.0
    for f in fs:
        f.material_index = order.index(m)
    return fs


X = Vector((1, 0, 0)); Y = Vector((0, 1, 0)); Z = Vector((0, 0, 1))
# torso
part('hips', (0, 0.01, 0.86), (0, 0.01, 1.05), (0.34, 0.22), (0.33, 0.21), 'uniform', ref=X)
part('spine', (0, 0.01, 1.04), (0, 0.0, 1.22), (0.32, 0.20), (0.36, 0.22), 'uniform', ref=X)
part('chest', (0, 0.0, 1.19), (0, 0.0, 1.47), (0.42, 0.28), (0.44, 0.26), 'gear', ref=X)
part('chest', (0, 0.19, 1.16), (0, 0.19, 1.44), (0.30, 0.13), (0.28, 0.13), 'gear', ref=X)       # backpack
part('chest', (0, -0.142, 1.30), (0, -0.142, 1.40), (0.12, 0.01), (0.12, 0.01), 'team', ref=X)  # chest patch
part('neck', (0, 0.012, 1.45), (0, 0.012, 1.57), (0.1, 0.1), (0.1, 0.1), 'skin', ref=X)
part('head', (0, 0.012, 1.55), (0, 0.012, 1.74), (0.18, 0.20), (0.18, 0.20), 'skin', ref=X)
part('head', (0, 0.02, 1.655), (0, 0.02, 1.83), (0.25, 0.28), (0.18, 0.20), 'helmet', ref=X)
part('head', (0, 0.02, 1.665), (0, 0.02, 1.70), (0.256, 0.286), (0.25, 0.28), 'team', ref=X)
part('head', (0, -0.085, 1.60), (0, -0.085, 1.645), (0.15, 0.03), (0.15, 0.03), 'dark', ref=X)   # goggles/visor
for s in ('L', 'R'):
    sx = 1 if s == 'L' else -1
    part('shoulder.' + s, (sx * 0.05, 0, 1.42), H('upper_arm.' + s), (0.12, 0.14), (0.13, 0.14), 'gear', ref=Y)
    ua0, ua1 = H('upper_arm.' + s), T('upper_arm.' + s)
    part('upper_arm.' + s, ua0, ua1, (0.12, 0.12), (0.10, 0.10), 'uniform')
    part('upper_arm.' + s, ua0.lerp(ua1, 0.12), ua0.lerp(ua1, 0.38), (0.126, 0.126), (0.122, 0.122), 'team')
    part('forearm.' + s, H('forearm.' + s), T('forearm.' + s), (0.10, 0.10), (0.085, 0.085), 'uniform')
    part('hand.' + s, H('hand.' + s), T('hand.' + s) + (T('hand.' + s) - H('hand.' + s)) * 0.3, (0.085, 0.06), (0.075, 0.055), 'dark')
    part('thigh.' + s, H('thigh.' + s) + Vector((0, 0, 0.05)), T('thigh.' + s), (0.17, 0.18), (0.13, 0.14), 'uniform', ref=X)
    part('shin.' + s, H('shin.' + s), T('shin.' + s) + Vector((0, 0, 0.05)), (0.13, 0.14), (0.11, 0.12), 'uniform', ref=X)
    fx = sx * 0.105
    part('foot.' + s, (fx, 0.06, 0.0), (fx, 0.06, 0.16), (0.12, 0.10), (0.12, 0.12), 'dark', ref=X)    # boot shaft
    part('foot.' + s, (fx, 0.065, 0.05), (fx, -0.17, 0.045), (0.115, 0.10), (0.11, 0.08), 'dark', ref=X)

me = bpy.data.meshes.new('Soldier')
bm.to_mesh(me); bm.free()
for k in order:
    me.materials.append(mats[k])
low = bpy.data.objects.new('Soldier', me)
sc.collection.objects.link(low)
for name, idx in sorted(gindex.items(), key=lambda kv: kv[1]):
    vg = low.vertex_groups.new(name=name)
    assert vg.index == idx
for p in me.polygons:
    p.use_smooth = False
me.validate()
low.parent = rig
low.matrix_parent_inverse = Matrix.Identity(4)
am = low.modifiers.new('Armature', 'ARMATURE'); am.object = rig
L.log('low tris', L.tri_count(low.data))

# ---- procedural rifle (muzzle -Y, up +Z, origin at grip)
def box(bm, c, s):
    r = bmesh.ops.create_cube(bm, size=1.0)
    for v in r['verts']:
        v.co = Vector((v.co.x * s[0] + c[0], v.co.y * s[1] + c[1], v.co.z * s[2] + c[2]))
rbm = bmesh.new()
box(rbm, (0, -0.10, 0.05), (0.045, 0.42, 0.07))   # receiver/handguard
box(rbm, (0, -0.43, 0.06), (0.022, 0.26, 0.022))  # barrel
box(rbm, (0, 0.22, 0.03), (0.04, 0.24, 0.09))     # stock
box(rbm, (0, -0.06, -0.04), (0.035, 0.07, 0.13))  # magazine
box(rbm, (0, 0.04, -0.03), (0.03, 0.04, 0.10))    # grip
box(rbm, (0, -0.08, 0.11), (0.03, 0.14, 0.04))    # optic
rme = bpy.data.meshes.new('Rifle'); rbm.to_mesh(rme); rbm.free()
rme.materials.append(L.get_mat('INF_Weapon', (0.03, 0.03, 0.03), 0.4, 0.5))
rme.transform(Matrix.Scale(0.85, 4))
rifle = bpy.data.objects.new('Rifle', rme)
sc.collection.objects.link(rifle)

ROT = float(os.environ.get('RIFLE_ROTZ', '180'))
sock = bpy.data.objects['Viper_WeaponSocket.R']
rig.animation_data.action = bpy.data.actions['Viper_Rifle_Aim']
sc.frame_set(10)
bpy.context.view_layer.update()
mw = sock.matrix_world @ Matrix.Rotation(math.radians(ROT), 4, 'Z')
rifle.parent = rig
rifle.parent_type = 'BONE'
rifle.parent_bone = 'hand.R'
bpy.context.view_layer.update()
rifle.matrix_world = mw
bpy.context.view_layer.update()

# ---- actions
keep = {'Viper_Run_Gun': 'Run', 'Viper_Rifle_Aim': 'Aim'}
for a in list(bpy.data.actions):
    if a.name in keep:
        a.name = keep[a.name]; a.use_fake_user = True
    else:
        bpy.data.actions.remove(a)
rig.animation_data.action = None
for pb in rig.pose.bones:
    pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0); pb.rotation_euler = (0, 0, 0); pb.scale = (1, 1, 1)
for o in list(sc.objects):
    if o not in (rig, low, rifle):
        L.log('removing', o.name)
        bpy.data.objects.remove(o)
tris = L.tri_count(low.data) + L.tri_count(rifle.data)
L.export_glb('infantry', animations=True, extra=dict(export_animation_mode='ACTIONS', export_skins=True,
                                                     export_def_bones=True, export_optimize_animation_size=True))
L.write_manifest_entry('infantry', tris, 'Viper.blend (armature + Run/Aim actions) + procedural low-poly body', ['Run', 'Aim'],
                       "Skinned soldier (armature from Viper), rifle node parented to bone hand.R. Clips: 'Run' (loop, 25 frames @24fps), 'Aim' (41f). Helmet + patches = TeamColor. Faces +Z.")
L.log('DONE infantry', tris)

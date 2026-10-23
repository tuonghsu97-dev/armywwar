"""Tiny bmesh modelling kit for procedural low-poly assets.
Units = metres. Front = -Y, up = +Z, ground at z = 0.
"""
import bpy, bmesh, math, random
from mathutils import Vector, Matrix, Euler
import wg_lib as L

# ---------------------------------------------------------------- materials
PAL = {
    'Olive':    dict(color=(0.115, 0.13, 0.062), rough=0.75),
    'OliveDk':  dict(color=(0.07, 0.08, 0.04), rough=0.8),
    'Sand':     dict(color=(0.42, 0.35, 0.22), rough=0.9),
    'Grey':     dict(color=(0.26, 0.28, 0.30), rough=0.6),
    'GreyDk':   dict(color=(0.12, 0.13, 0.14), rough=0.6),
    'GreyLt':   dict(color=(0.45, 0.47, 0.48), rough=0.6),
    'Navy':     dict(color=(0.20, 0.22, 0.25), rough=0.55),
    'Deck':     dict(color=(0.09, 0.09, 0.095), rough=0.8),
    'Dark':     dict(color=(0.025, 0.025, 0.028), rough=0.6),
    'Rubber':   dict(color=(0.015, 0.015, 0.015), rough=0.9),
    'Metal':    dict(color=(0.30, 0.30, 0.31), rough=0.35, metal=0.8),
    'Glass':    dict(color=(0.03, 0.06, 0.09), rough=0.1, metal=0.3),
    'Concrete': dict(color=(0.36, 0.34, 0.30), rough=0.95),
    'ConcDk':   dict(color=(0.20, 0.19, 0.17), rough=0.95),
    'Sandbag':  dict(color=(0.40, 0.34, 0.21), rough=1.0),
    'Wood':     dict(color=(0.20, 0.12, 0.06), rough=0.9),
    'Bark':     dict(color=(0.12, 0.08, 0.05), rough=1.0),
    'Leaf':     dict(color=(0.07, 0.17, 0.04), rough=0.9),
    'Pine':     dict(color=(0.035, 0.10, 0.04), rough=0.9),
    'Rock':     dict(color=(0.24, 0.23, 0.21), rough=1.0),
    'White':    dict(color=(0.70, 0.70, 0.68), rough=0.6),
    'Yellow':   dict(color=(0.70, 0.48, 0.05), rough=0.6),
    'Red':      dict(color=(0.55, 0.04, 0.03), rough=0.6),
    'Brick':    dict(color=(0.33, 0.14, 0.09), rough=0.9),
    'Beige':    dict(color=(0.50, 0.43, 0.32), rough=0.9),
    'Roof':     dict(color=(0.15, 0.15, 0.15), rough=0.9),
    'Glow':     dict(color=(0.1, 0.8, 1.0), rough=0.3, emit=(0.1, 0.8, 1.0)),
    'GlowRed':  dict(color=(1.0, 0.15, 0.05), rough=0.3, emit=(1.0, 0.15, 0.05)),
    'Lens':     dict(color=(0.5, 0.9, 1.0), rough=0.05, emit=(0.4, 0.8, 1.0)),
    'TeamColor': dict(color=(0.75, 0.75, 0.75), rough=0.5),
}


def mat(name):
    p = PAL[name]
    return L.get_mat(name if name != 'TeamColor' else 'TeamColor', p['color'], p.get('metal', 0.0),
                     p['rough'], p.get('emit'))


# ---------------------------------------------------------------- builder
class Model:
    def __init__(self):
        self.nodes = {}   # name -> [bm, [mat names]]
        self.stack = [Matrix.Identity(4)]

    @property
    def T(self):
        return self.stack[-1]

    def xf(self, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
        """with m.xf((x,y,z), (rx,ry,rz)): nested local frame (degrees)."""
        model = self

        class _Ctx:
            def __enter__(s):
                M = Matrix.Translation(Vector(loc)) @ Euler([math.radians(a) for a in rot]).to_matrix().to_4x4() \
                    @ Matrix.Scale(scale, 4)
                model.stack.append(model.T @ M)

            def __exit__(s, *a):
                model.stack.pop()
        return _Ctx()

    def strut(self, m, p0, p1, r, seg=4, node='Body'):
        """Thin cylinder between two points."""
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        q = d.normalized().to_track_quat('Z', 'Y')
        bm = self._node(node)[0]
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=d.length)
        M = self.T @ Matrix.Translation((p0 + p1) / 2) @ q.to_matrix().to_4x4()
        for v in res['verts']:
            v.co = M @ v.co
        self._assign(node, self._faces_of(res['verts']), m)

    def prism_x(self, m, prof_yz, x0, x1, node='Body'):
        """Extrude a (y,z) side profile across x0..x1 (hulls, turrets)."""
        return self.loft(m, [[(x0, y, z) for y, z in prof_yz], [(x1, y, z) for y, z in prof_yz]], node)

    def _node(self, node):
        if node not in self.nodes:
            self.nodes[node] = [bmesh.new(), []]
        return self.nodes[node]

    def _assign(self, node, faces, m):
        bm, mats = self._node(node)
        if m not in mats:
            mats.append(m)
        i = mats.index(m)
        for f in faces:
            f.material_index = i
            f.smooth = False

    @staticmethod
    def _faces_of(verts):
        fs = set()
        for v in verts:
            fs.update(v.link_faces)
        return fs

    # ---- primitives -------------------------------------------------
    def box(self, m, c, s, rot=(0, 0, 0), node='Body', taper=None):
        """c=center, s=full size (x,y,z). taper=(sx,sy) scale of the top face."""
        bm = self._node(node)[0]
        r = bmesh.ops.create_cube(bm, size=1.0)
        vs = r['verts']
        for v in vs:
            x, y, z = v.co
            if taper and z > 0:
                x *= taper[0]; y *= taper[1]
            v.co = Vector((x * s[0], y * s[1], z * s[2]))
        M = self.T @ Matrix.Translation(Vector(c)) @ Euler([math.radians(a) for a in rot]).to_matrix().to_4x4()
        for v in vs:
            v.co = M @ v.co
        self._assign(node, self._faces_of(vs), m)
        return vs

    def cyl(self, m, c, r, h, axis='Z', seg=8, r2=None, rot=None, node='Body'):
        """Cylinder/cone centred at c, length h along axis."""
        bm = self._node(node)[0]
        res = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg,
                                    radius1=r, radius2=r if r2 is None else r2, depth=h)
        vs = res['verts']
        R = {'Z': Matrix.Identity(4), 'X': Matrix.Rotation(math.radians(90), 4, 'Y'),
             'Y': Matrix.Rotation(math.radians(90), 4, 'X')}[axis]  # Y: r2 end -> -Y (front)
        if rot:
            R = Euler([math.radians(a) for a in rot]).to_matrix().to_4x4() @ R
        M = self.T @ Matrix.Translation(Vector(c)) @ R
        for v in vs:
            v.co = M @ v.co
        self._assign(node, self._faces_of(vs), m)
        return vs

    def sphere(self, m, c, r, sub=1, scale=(1, 1, 1), node='Body', jitter=0.0, seed=0):
        bm = self._node(node)[0]
        res = bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
        rnd = random.Random(seed)
        for v in res['verts']:
            j = 1 + (rnd.uniform(-jitter, jitter) if jitter else 0)
            v.co = self.T @ Vector((v.co.x * scale[0] * j + c[0], v.co.y * scale[1] * j + c[1], v.co.z * scale[2] * j + c[2]))
        self._assign(node, self._faces_of(res['verts']), m)
        return res['verts']

    def loft(self, m, rings, node='Body', cap=True):
        """rings: list of equal-length lists of (x,y,z). Bridged in order, ends capped."""
        bm = self._node(node)[0]
        vr = [[bm.verts.new(self.T @ Vector(p)) for p in ring] for ring in rings]
        faces = []
        n = len(rings[0])
        for a, b in zip(vr[:-1], vr[1:]):
            for i in range(n):
                j = (i + 1) % n
                quad = [a[i], a[j], b[j], b[i]]
                # skip degenerate quads (collapsed points)
                uniq = []
                for v in quad:
                    if all((v.co - u.co).length > 1e-6 for u in uniq):
                        uniq.append(v)
                if len(uniq) >= 3:
                    try:
                        faces.append(bm.faces.new(uniq))
                    except ValueError:
                        pass
        if cap:
            for ring in (vr[0], vr[-1]):
                uniq = []
                for v in ring:
                    if all((v.co - u.co).length > 1e-6 for u in uniq):
                        uniq.append(v)
                if len(uniq) >= 3:
                    try:
                        faces.append(bm.faces.new(uniq))
                    except ValueError:
                        pass
        # weld collapsed points
        allv = [v for r in vr for v in r]
        bmesh.ops.remove_doubles(bm, verts=allv, dist=1e-5)
        faces = [f for f in faces if f.is_valid]
        self._assign(node, faces, m)
        return faces

    def plate(self, m, outline, z0, z1, node='Body', rot=None, offset=(0, 0, 0)):
        """Extrude a 2D outline (x,y) between z0 and z1 (wings, decks)."""
        rings = [[(x, y, z0) for x, y in outline], [(x, y, z1) for x, y in outline]]
        if rot or offset != (0, 0, 0):
            M = Matrix.Translation(Vector(offset))
            if rot:
                M = M @ Euler([math.radians(a) for a in rot]).to_matrix().to_4x4()
            rings = [[tuple(M @ Vector(p)) for p in r] for r in rings]
        return self.loft(m, rings, node)

    def wing(self, m, root_le, root_te, tip_le, tip_te, t_root, t_tip=None, node='Body', mirror=True, dihedral=0.0):
        """Wing from root (x=root_x) to tip. Points are (x, y). Builds diamond-section plate."""
        t_tip = t_root * 0.5 if t_tip is None else t_tip
        sides = [1, -1] if mirror else [1]
        for s in sides:
            rx, rle = root_le[0], root_le[1]; rte = root_te[1]
            tx, tle = tip_le[0], tip_le[1]; tte = tip_te[1]
            dz = math.tan(math.radians(dihedral)) * (tx - rx)
            z0 = root_le[2] if len(root_le) > 2 else 0
            rings = []
            for (x, le, te, t, zz) in ((rx, rle, rte, t_root, z0), (tx, tle, tte, t_tip, z0 + dz)):
                mid = (le + te) / 2
                rings.append([(s * x, le, zz), (s * x, mid, zz + t / 2), (s * x, te, zz), (s * x, mid, zz - t / 2)])
            if s < 0:
                rings = [list(reversed(r)) for r in rings]
            self.loft(m, rings, node)

    def wheel(self, m, x, y, z, r, w, seg=8, node='Body', hub='Dark'):
        self.cyl(m, (x, y, z), r, w, axis='X', seg=seg, node=node)
        self.cyl(hub, (x + (w / 2 + 0.01) * (1 if x > 0 else -1), y, z), r * 0.45, 0.04, axis='X', seg=6, node=node)

    def mirror_x(self, fn):
        for s in (1, -1):
            fn(s)

    # ---- output -----------------------------------------------------
    def build(self):
        objs = []
        for name, (bm, mats) in self.nodes.items():
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
            me = bpy.data.meshes.new(name)
            bm.to_mesh(me)
            bm.free()
            for mn in mats:
                me.materials.append(mat(mn))
            o = bpy.data.objects.new(name, me)
            bpy.context.scene.collection.objects.link(o)
            objs.append(o)
        return objs


def ring_circle(y, r, z=0.0, n=8, sx=1.0, sz=1.0, x=0.0, phase=0.0):
    """Circle ring in the XZ plane at position y (for fuselages along Y)."""
    return [(x + math.cos(2 * math.pi * i / n + phase) * r * sx, y, z + math.sin(2 * math.pi * i / n + phase) * r * sz)
            for i in range(n)]


def ring_poly(y, pts, z=0.0, scale=1.0):
    """Ring from 2D (x,z) profile points at position y."""
    return [(px * scale, y, z + pz * scale) for px, pz in pts]

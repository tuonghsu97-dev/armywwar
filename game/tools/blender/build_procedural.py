"""Procedural low-poly models.
blender -b --factory-startup --python build_procedural.py -- <id ...|all>
Front = -Y (glTF +Z), ground z=0, ships: waterline z=0.
"""
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import importlib, wg_lib as L, proc_kit as K
importlib.reload(L); importlib.reload(K)
from proc_kit import Model, ring_circle, ring_poly

REG = {}


def model(mid, notes='', waterline=False, spin=('Rotor', 'TailRotor')):
    def deco(fn):
        REG[mid] = (fn, notes, waterline, spin)
        return fn
    return deco


# ------------------------------------------------------------ shared parts
def tracks(m, xc, length, h, w, y0=0.0, mat='Rubber', wheels=5):
    for s in (1, -1):
        x = s * xc
        m.box(mat, (x, y0, h / 2), (w, length - h, h))
        m.cyl(mat, (x, y0 - (length - h) / 2, h / 2), h / 2, w, axis='X', seg=8)
        m.cyl(mat, (x, y0 + (length - h) / 2, h / 2), h / 2, w, axis='X', seg=8)
        for i in range(wheels):
            yy = y0 - (length - h) / 2 + (length - h) * i / (wheels - 1)
            m.cyl('Dark', (x + s * (w / 2 + 0.01), yy, h * 0.42), h * 0.33, 0.04, axis='X', seg=8)


def cab(m, y_front, w=2.5, mat='Olive', h=1.9, z0=1.05, depth=2.0):
    yc = y_front + depth / 2
    m.box(mat, (0, yc, z0 + h / 2), (w, depth, h), taper=(0.96, 0.84))
    m.box('Glass', (0, y_front + 0.17, z0 + h * 0.72), (w * 0.86, 0.05, h * 0.36), rot=(-14, 0, 0))
    for s in (1, -1):
        m.box('Glass', (s * w / 2 * 0.985, yc - 0.1, z0 + h * 0.7), (0.04, depth * 0.45, h * 0.3))
    m.box('Dark', (0, y_front - 0.12, z0 + 0.05), (w, 0.3, 0.35))  # bumper
    m.box('Dark', (0, y_front + 0.02, z0 + 0.45), (w * 0.6, 0.06, 0.35))  # grille


def chassis(m, y0, y1, w=1.4, z=1.0):
    m.box('Dark', (0, (y0 + y1) / 2, z), (w, y1 - y0, 0.35))


def axle_wheels(m, ys, x=1.15, r=0.6, w=0.45, fender='Olive'):
    for y in ys:
        for s in (1, -1):
            m.wheel('Rubber', s * x, y, r, r, w)
            if fender:
                m.box(fender, (s * x, y, r * 2 + 0.08), (w + 0.12, r * 2.2, 0.08))


def canister_pack(m, rows, cols, size, length, pitch, mat='Olive', tube_mat='Dark'):
    """Pack of launch canisters in the current frame, pitched front-up (rotate about X at rear end)."""
    with m.xf((0, 0, 0), (-pitch, 0, 0)):
        W = cols * size + (cols - 1) * 0.06
        H = rows * size + (rows - 1) * 0.06
        for r in range(rows):
            for c in range(cols):
                x = -W / 2 + size / 2 + c * (size + 0.06)
                z = size / 2 + r * (size + 0.06)
                m.box(mat, (x, -length / 2, z), (size, length, size))
                m.box(tube_mat, (x, -length - 0.01, z), (size * 0.8, 0.03, size * 0.8))
        m.box('Dark', (0, -length * 0.25, -0.1), (W * 0.9, 0.3, 0.2))
        m.box('Dark', (0, -length * 0.8, -0.1), (W * 0.9, 0.3, 0.2))


def team_stripe(m, c, s, rot=(0, 0, 0)):
    m.box('TeamColor', c, s, rot=rot)


def flag(m, pole_base, height, size=(1.6, 1.0), node='Flag'):
    x, y, z = pole_base
    m.cyl('Metal', (x, y, z + height / 2), 0.06 * height / 6, height, seg=6)
    m.sphere('Metal', (x, y, z + height + 0.05), 0.1 * height / 6, sub=1)
    # flag extends along +X (XZ plane: readable from the iso camera)
    m.box('TeamColor', (x + size[0] / 2 + 0.06, y, z + height - size[1] / 2 - 0.1), (size[0], 0.04, size[1]), node=node)


def sandbag_ring(m, r, layers=2, seg=16, gap=(-110, -70), bag=(0.45, 0.5)):
    for l in range(layers):
        for i in range(seg):
            a0 = 360 * i / seg + (180 / seg if l % 2 else 0)
            a = a0 + 180 / seg
            ang = (a - 90) % 360 - 180  # 0 = +X ; -90 = -Y(front)
            ad = math.degrees(math.atan2(math.sin(math.radians(a)), math.cos(math.radians(a))))
            if gap and gap[0] <= ad <= gap[1]:
                continue
            x, y = r * math.cos(math.radians(a)), r * math.sin(math.radians(a))
            length = 2 * math.pi * r / seg * 1.02
            m.box('Sandbag', (x, y, bag[1] / 2 + l * bag[1] * 0.95), (bag[0], length, bag[1]), rot=(0, 0, a),
                  taper=(0.8, 0.95))


# ------------------------------------------------------------ ground vehicles
@model('spg', 'Tracked self-propelled howitzer (PzH-2000 style), long 155mm barrel. TeamColor stripes on turret.')
def spg():
    m = Model()
    m.prism_x('Olive', [(-3.6, 0.6), (-3.0, 1.55), (3.5, 1.6), (3.6, 0.6), (-3.2, 0.45)][::-1], -1.6, 1.6)
    tracks(m, 1.35, 6.9, 0.95, 0.62)
    for s in (1, -1):
        m.box('OliveDk', (s * 1.38, 0, 1.0), (0.66, 6.9, 0.06))  # fender
    m.prism_x('Olive', [(-1.6, 1.6), (-1.15, 2.75), (2.3, 2.75), (2.7, 1.6)][::-1], -1.45, 1.45)
    m.box('Olive', (0, -1.75, 2.15), (0.95, 0.5, 0.75))       # mantlet
    m.cyl('Olive', (0, -5.0, 2.15), 0.12, 6.4, axis='Y', seg=8)  # barrel
    m.cyl('Olive', (0, -4.0, 2.15), 0.17, 0.9, axis='Y', seg=8)  # bore evacuator
    m.box('Dark', (0, -8.25, 2.15), (0.42, 0.45, 0.3))         # muzzle brake
    m.cyl('OliveDk', (0.75, 0.6, 2.9), 0.36, 0.3, seg=8)        # cupola
    m.cyl('Dark', (0.75, 0.1, 3.05), 0.03, 0.8, axis='Y', seg=4)
    for s in (1, -1):
        team_stripe(m, (s * 1.46, 0.6, 2.35), (0.03, 2.4, 0.22))
        m.cyl('Dark', (s * 1.2, -1.2, 2.55), 0.07, 0.35, axis='Y', seg=6, rot=(30, 0, 0))
    m.box('Dark', (0, 3.55, 1.1), (2.4, 0.08, 0.6))            # rear door
    m.box('Dark', (0, 2.6, 1.62), (1.6, 1.0, 0.04))            # engine grille
    return m


@model('himars', '6x6 truck with tilted 6-round rocket pod (HIMARS style). TeamColor on cab doors and pod sides.')
def himars():
    m = Model()
    chassis(m, -3.2, 3.6)
    cab(m, -3.8)
    axle_wheels(m, (-2.6, 1.2, 2.6))
    m.box('Olive', (0, 1.4, 1.42), (2.4, 4.4, 0.4))
    with m.xf((0, 3.5, 1.65), (-14, 0, 0)):
        m.box('Olive', (0, -2.3, 0.7), (2.3, 4.6, 1.4))
        for r in range(2):
            for c in range(3):
                m.cyl('Dark', (-0.7 + c * 0.7, -4.62, 0.38 + r * 0.62), 0.24, 0.06, axis='Y', seg=8)
        for s in (1, -1):
            team_stripe(m, (s * 1.16, -2.3, 0.95), (0.03, 3.8, 0.25))
    m.box('Dark', (0, 3.2, 1.9), (1.8, 0.5, 0.6))
    for s in (1, -1):
        team_stripe(m, (s * 1.22, -2.6, 1.7), (0.03, 0.9, 0.5))
    return m


@model('supply_truck', '6x6 logistics truck with canvas-covered cargo bed. TeamColor stripe on canvas.')
def supply_truck():
    m = Model()
    chassis(m, -3.2, 3.6)
    cab(m, -3.8)
    axle_wheels(m, (-2.6, 1.2, 2.6))
    m.box('OliveDk', (0, 1.3, 1.45), (2.45, 4.8, 0.3))         # bed floor
    for s in (1, -1):
        m.box('Olive', (s * 1.2, 1.3, 1.85), (0.06, 4.8, 0.55))
    m.box('Olive', (0, 3.68, 1.85), (2.45, 0.06, 0.55))
    m.box('Sand', (0, 1.25, 2.75), (2.4, 4.6, 1.5), taper=(0.88, 1.0))   # canvas
    for s in (1, -1):
        team_stripe(m, (s * 1.2, 1.25, 2.65), (0.03, 4.0, 0.3))
    m.box('Wood', (0, 3.4, 1.8), (1.0, 0.5, 0.5))
    return m


@model('ugv', 'Small tracked combat robot (UGV) with remote turret and sensor mast.')
def ugv():
    m = Model()
    m.box('OliveDk', (0, 0, 0.6), (1.15, 2.0, 0.45), taper=(0.88, 0.9))
    m.box('OliveDk', (0, -1.05, 0.55), (1.1, 0.3, 0.3), rot=(-35, 0, 0))
    tracks(m, 0.72, 2.1, 0.55, 0.3, wheels=4)
    m.box('Olive', (0, 0.15, 0.98), (0.6, 0.75, 0.32), taper=(0.85, 0.8))
    m.cyl('Dark', (0, -0.55, 1.0), 0.04, 0.9, axis='Y', seg=6)
    m.box('Dark', (0.22, -0.2, 1.05), (0.12, 0.18, 0.12))
    m.cyl('Metal', (-0.3, 0.55, 1.3), 0.025, 0.7, seg=4)
    m.box('Dark', (-0.3, 0.52, 1.66), (0.16, 0.12, 0.1))
    m.box('Lens', (-0.3, 0.455, 1.66), (0.08, 0.02, 0.06))
    team_stripe(m, (0, -0.86, 0.8), (0.8, 0.03, 0.12))
    team_stripe(m, (0, 0.15, 1.15), (0.5, 0.6, 0.02))
    return m


@model('sam', 'SAM launcher truck: 4 canisters tilted ~38 deg + radar panel behind cab. TeamColor stripes.')
def sam():
    m = Model()
    chassis(m, -3.6, 4.4)
    cab(m, -4.2)
    axle_wheels(m, (-3.0, 1.4, 2.9))
    m.box('Olive', (0, 1.6, 1.42), (2.4, 5.6, 0.4))
    with m.xf((0, 4.2, 1.75)):
        m.box('Dark', (0, -0.3, 0.2), (2.0, 0.6, 0.5))
        with m.xf((0, 0, 0.1)):
            canister_pack(m, 2, 2, 0.9, 5.8, 38)
    with m.xf((0, -1.9, 3.0)):
        m.cyl('Dark', (0, 0, 0), 0.08, 1.2, seg=6)
        m.box('OliveDk', (0, 0, 1.2), (1.9, 0.14, 1.4), rot=(18, 0, 0))
        m.box('Dark', (0, -0.09, 1.2), (1.6, 0.03, 1.1), rot=(18, 0, 0))
    for s in (1, -1):
        team_stripe(m, (s * 1.22, -3.2, 1.75), (0.03, 0.9, 0.4))
        team_stripe(m, (s * 1.21, 1.6, 1.42), (0.03, 4.6, 0.18))
    return m


@model('iron_dome', 'Interceptor launcher trailer (20 tubes, tilted) with separate radar panel unit on the same chassis.')
def iron_dome():
    m = Model()
    m.box('Dark', (0, 0.2, 0.95), (1.4, 6.6, 0.3))
    m.box('Olive', (0, 0.6, 1.25), (2.4, 5.0, 0.35))
    for y in (1.2, 2.4):
        for s in (1, -1):
            m.wheel('Rubber', s * 1.05, y, 0.55, 0.55, 0.4)
    m.box('Dark', (0, -3.2, 0.9), (0.2, 1.2, 0.15))  # tow bar
    m.box('OliveDk', (0, -0.6, 0.55), (0.3, 0.3, 0.9))  # support leg
    with m.xf((0, 2.8, 1.45), (-52, 0, 0)):
        m.box('Olive', (0, -1.6, 0.75), (2.3, 3.2, 1.5))
        for r in range(4):
            for c in range(5):
                m.cyl('Dark', (-0.84 + c * 0.42, -3.22, 0.22 + r * 0.36), 0.15, 0.05, axis='Y', seg=6)
    with m.xf((0, -1.6, 1.45)):
        m.box('OliveDk', (0, 0, 0.3), (1.4, 1.2, 0.6))
        m.cyl('Dark', (0, 0, 1.0), 0.1, 1.0, seg=6)
        m.box('Olive', (0, 0, 1.9), (2.3, 0.2, 1.5), rot=(15, 0, 0))
        m.box('Dark', (0, -0.12, 1.9), (2.0, 0.03, 1.2), rot=(15, 0, 0))
    for s in (1, -1):
        team_stripe(m, (s * 1.21, 0.6, 1.25), (0.03, 4.4, 0.16))
    return m


@model('laser', '8x8 armoured vehicle with turret-mounted laser beam director (glowing lens = material Lens).')
def laser():
    m = Model()
    m.prism_x('Olive', [(-3.6, 0.85), (-3.0, 1.95), (3.4, 2.0), (3.6, 0.85), (-3.2, 0.6)][::-1], -1.4, 1.4)
    axle_wheels(m, (-2.4, -1.0, 1.0, 2.4), x=1.25, r=0.55, w=0.4, fender=None)
    for s in (1, -1):
        m.box('OliveDk', (s * 1.35, 0, 1.3), (0.12, 6.8, 0.5))
    m.box('Olive', (0, 0.4, 2.3), (1.9, 2.4, 0.6), taper=(0.85, 0.85))
    with m.xf((0, 0.4, 2.85)):
        m.box('OliveDk', (0, 0, 0.2), (0.5, 0.6, 0.4))
        m.box('Olive', (0, 0, 0.7), (0.5, 0.9, 0.7))
        m.cyl('Olive', (0, -0.1, 0.75), 0.55, 1.0, axis='Y', seg=12)    # beam director housing
        m.cyl('Dark', (0, -0.62, 0.75), 0.5, 0.06, axis='Y', seg=12)
        m.cyl('Lens', (0, -0.66, 0.75), 0.4, 0.04, axis='Y', seg=12)
        for s in (1, -1):
            m.box('Dark', (s * 0.75, 0, 0.75), (0.3, 0.5, 0.4))
            m.box('Lens', (s * 0.75, -0.26, 0.75), (0.18, 0.02, 0.22))
    for s in (1, -1):
        team_stripe(m, (s * 1.42, -0.5, 1.6), (0.03, 3.0, 0.2))
    return m


@model('ew', 'Electronic-warfare truck: shelter with tilted dish and two telescopic masts with panel antennas.')
def ew():
    m = Model()
    chassis(m, -3.2, 3.6)
    cab(m, -3.8)
    axle_wheels(m, (-2.6, 1.2, 2.6))
    m.box('Olive', (0, 1.3, 2.3), (2.45, 4.6, 2.2))   # shelter
    m.box('Dark', (0, 3.62, 2.1), (0.8, 0.04, 1.6))
    for s in (1, -1):
        team_stripe(m, (s * 1.235, 1.3, 2.9), (0.03, 4.0, 0.3))
    with m.xf((0.4, 0.2, 3.4), (35, 0, 20)):
        m.cyl('Dark', (0, 0, -0.1), 0.08, 0.5, seg=6)
        m.cyl('GreyLt', (0, 0, 0.3), 1.2, 0.35, seg=12, r2=0.15, rot=(180, 0, 0))
        m.cyl('Dark', (0, 0, 0.55), 0.05, 0.6, seg=4)
    for (x, y, h) in ((-0.7, 2.6, 4.5), (0.7, 3.2, 3.5)):
        m.cyl('Metal', (x, y, 3.4 + h / 2), 0.07, h, seg=6)
        for k in range(3):
            a = k * 120
            with m.xf((x, y, 3.4 + h - 0.5), (0, 0, a)):
                m.box('OliveDk', (0, -0.25, 0), (0.5, 0.08, 0.9))
    for x in (-1.0, 1.0):
        m.cyl('Dark', (x, 3.4, 4.6), 0.02, 2.4, seg=4)
    return m


# ------------------------------------------------------------ air
@model('drone_kamikaze', 'Cruciform loitering munition (Switchblade/Lancet style), pusher prop at tail.')
def drone_kamikaze():
    m = Model()
    m.loft('OliveDk', [ring_circle(y, r, z=0.25, n=8) for y, r in
                        ((-0.86, 0.02), (-0.72, 0.09), (-0.5, 0.13), (0.55, 0.13), (0.75, 0.08))])
    m.box('Lens', (0, -0.84, 0.25), (0.05, 0.03, 0.05))
    for a in (45, -45):
        with m.xf((0, -0.25, 0.25), (0, a, 0)):
            m.box('Olive', (0, 0, 0), (0.7, 0.16, 0.014))
        with m.xf((0, 0.5, 0.25), (0, a, 0)):
            m.box('Olive', (0, 0, 0), (1.1, 0.22, 0.016))
    m.cyl('TeamColor', (0, 0.05, 0.25), 0.135, 0.08, axis='Y', seg=8)
    m.cyl('Dark', (0, 0.8, 0.25), 0.03, 0.08, axis='Y', seg=6)
    m.box('Dark', (0, 0.84, 0.25), (0.42, 0.02, 0.04))
    return m


@model('fpv', 'Tiny FPV quadcopter (<200 tris).')
def fpv():
    m = Model()
    m.box('Dark', (0, 0, 0.06), (0.09, 0.16, 0.035))
    m.box('TeamColor', (0, 0.01, 0.09), (0.07, 0.1, 0.03))   # battery
    m.box('Dark', (0, -0.085, 0.075), (0.04, 0.02, 0.03))
    for a in (45, -45):
        m.box('Dark', (0, 0, 0.055), (0.3, 0.025, 0.012), rot=(0, 0, a))
    for sx in (1, -1):
        for sy in (1, -1):
            x, y = sx * 0.106, sy * 0.106
            m.cyl('Metal', (x, y, 0.07), 0.016, 0.025, seg=4)
            m.box('Grey', (x, y, 0.086), (0.13, 0.014, 0.004), rot=(0, 0, 30 * sx * sy))
    m.box('Red', (0, -0.11, 0.06), (0.03, 0.02, 0.02))   # payload
    return m


def fuselage_hex(y, w, h, z=1.0):
    return [(w, y, z), (w * 0.55, y, z + h * 0.5), (-w * 0.55, y, z + h * 0.5), (-w, y, z),
            (-w * 0.5, y, z - h * 0.4), (w * 0.5, y, z - h * 0.4)]


@model('fighter_stealth', 'Angular 5th-gen stealth fighter, twin canted tails (F-22 style). TeamColor tail tips.')
def fighter_stealth():
    m = Model()
    st = ((-9.6, 0.04, 0.04), (-7.6, 0.6, 0.7), (-5.0, 1.1, 1.3), (-2.0, 2.2, 1.4), (3.0, 2.4, 1.2),
          (7.0, 2.0, 1.0), (9.2, 1.6, 0.8))
    m.loft('Grey', [fuselage_hex(y, w, h) for y, w, h in st])
    m.sphere('Glass', (0, -5.0, 1.62), 1.0, sub=1, scale=(0.45, 1.9, 0.42))
    m.wing('Grey', (1.8, -3.0, 1.0), (1.8, 4.2), (6.8, 2.9), (6.8, 4.5), 0.3, 0.08)
    m.wing('Grey', (1.4, 6.0, 1.0), (1.4, 9.4), (4.4, 8.4), (4.4, 9.9), 0.2, 0.06)
    for s in (1, -1):
        with m.xf((s * 1.6, 0, 1.45), (0, s * 26, 0)):
            ring = lambda z, le, te, t: [(0, le, z), (t / 2, (le + te) / 2, z), (0, te, z), (-t / 2, (le + te) / 2, z)]
            m.loft('Grey', [ring(0, 4.2, 8.2, 0.2), ring(2.9, 6.9, 8.7, 0.08)])
            m.box('TeamColor', (0, 7.8, 2.75), (0.1, 1.6, 0.3))
        m.box('Dark', (s * 0.75, 9.35, 1.0), (1.0, 0.5, 0.65))
        m.box('Dark', (s * 1.55, -3.4, 0.85), (0.5, 0.25, 0.75), rot=(0, 0, -s * 12))
    return m


@model('fighter_multi', 'Delta-wing canard multirole fighter (Rafale/Gripen style). TeamColor tail tip.')
def fighter_multi():
    m = Model()
    st = ((-7.8, 0.04), (-6.5, 0.42), (-4.0, 0.72), (-1.0, 0.9), (3.0, 0.88), (6.5, 0.62), (7.6, 0.55))
    m.loft('GreyLt', [ring_circle(y, r, z=1.0, n=8, sx=1.15) for y, r in st])
    m.sphere('Glass', (0, -4.0, 1.72), 1.0, sub=1, scale=(0.42, 1.5, 0.42))
    m.wing('GreyLt', (0.8, -1.4, 0.85), (0.8, 6.0), (5.4, 5.0), (5.4, 6.5), 0.25, 0.06)
    m.wing('GreyLt', (0.8, -3.7, 1.3), (0.8, -2.3), (2.7, -2.8), (2.7, -2.25), 0.1, 0.04)
    ring = lambda z, le, te, t: [(0, le, z), (t / 2, (le + te) / 2, z), (0, te, z), (-t / 2, (le + te) / 2, z)]
    m.loft('GreyLt', [ring(1.6, 2.6, 7.2, 0.2), ring(4.6, 6.0, 7.5, 0.08)])
    m.box('TeamColor', (0, 6.65, 4.35), (0.12, 1.4, 0.35))
    for s in (1, -1):
        m.box('Dark', (s * 0.95, -2.6, 0.72), (0.5, 1.4, 0.65), taper=(1, 1))
    m.cyl('Dark', (0, 7.95, 1.0), 0.45, 0.8, axis='Y', seg=8, r2=0.5)
    return m


@model('heli_transport', "Utility transport helicopter (UH-60 style). Main rotor node 'Rotor' (spin about local up), tail rotor node 'TailRotor' (spin about local X).")
def heli_transport():
    m = Model()

    def prof(y, w, h, z):
        return [(w, y, z - h * 0.35), (w, y, z + h * 0.3), (w * 0.7, y, z + h * 0.5), (-w * 0.7, y, z + h * 0.5),
                (-w, y, z + h * 0.3), (-w, y, z - h * 0.35), (-w * 0.7, y, z - h * 0.5), (w * 0.7, y, z - h * 0.5)]
    st = ((-5.3, 0.35, 0.6, 1.5), (-4.4, 0.95, 1.5, 1.6), (-2.5, 1.15, 1.95, 1.7), (2.0, 1.15, 1.95, 1.7),
          (3.4, 0.55, 1.0, 2.05), (9.6, 0.22, 0.4, 2.45))
    m.loft('Olive', [prof(y, w, h, z) for y, w, h, z in st])
    m.box('Glass', (0, -4.75, 1.85), (1.5, 0.9, 0.7), rot=(-35, 0, 0))
    for s in (1, -1):
        m.box('Glass', (s * 0.9, -3.9, 1.85), (0.4, 0.9, 0.6), rot=(0, 0, s * 20))
        m.box('Dark', (s * 1.16, -0.6, 1.55), (0.04, 1.6, 1.3))     # door
        m.box('Glass', (s * 1.165, -0.6, 2.0), (0.03, 0.6, 0.4))
        team_stripe(m, (s * 1.165, 1.4, 1.6), (0.03, 0.9, 0.35))
        m.box('Dark', (s * 1.1, -3.0, 0.55), (0.12, 0.12, 0.7))
        m.wheel('Rubber', s * 1.1, -3.0, 0.3, 0.3, 0.2)
        m.box('Dark', (s * 0.7, 0.4, 2.9), (0.5, 1.2, 0.35))        # engine intakes
    m.box('OliveDk', (0, 0.3, 2.85), (1.3, 3.4, 0.55), taper=(0.8, 0.9))
    m.box('Olive', (0, 9.8, 3.2), (0.15, 1.3, 2.2), rot=(-25, 0, 0))
    m.box('Olive', (0, 9.1, 2.5), (2.8, 0.7, 0.08))
    m.wheel('Rubber', 0, 8.4, 0.2, 0.2, 0.12)
    # rotors
    m.cyl('Dark', (0, 0, 3.3), 0.12, 0.5, seg=6, node='Rotor')
    m.cyl('Dark', (0, 0, 3.55), 0.35, 0.2, seg=8, node='Rotor')
    for a in (0, 90):
        m.box('Dark', (0, 0, 3.6), (16.0, 0.5, 0.06), rot=(0, 0, a + 10), node='Rotor')
    with m.xf((0.2, 10.2, 3.9)):
        m.cyl('Dark', (0, 0, 0), 0.12, 0.2, axis='X', seg=6, node='TailRotor')
        for a in (0, 90):
            m.box('Dark', (0.08, 0, 0), (0.04, 0.22, 3.0), rot=(a, 0, 0), node='TailRotor')
    return m


@model('cca', 'Small tailless collaborative combat aircraft / loyal-wingman drone. TeamColor wing stripes.')
def cca():
    m = Model()
    st = ((-4.6, 0.08, 0.08), (-2.8, 0.8, 0.6), (0.0, 1.35, 0.75), (2.6, 1.1, 0.55), (4.0, 0.7, 0.35))
    m.loft('Grey', [fuselage_hex(y, w, h, z=0.6) for y, w, h in st])
    m.wing('Grey', (1.0, -0.6, 0.55), (1.0, 3.3), (5.2, 2.9), (5.2, 4.0), 0.22, 0.05)
    m.box('Dark', (0, -1.4, 1.0), (0.9, 0.9, 0.22), rot=(-8, 0, 0))   # top intake
    m.box('Dark', (0, 3.95, 0.6), (1.0, 0.2, 0.25))
    for s in (1, -1):
        m.box('TeamColor', (s * 4.3, 3.35, 0.56), (0.5, 0.9, 0.06))
    m.box('Lens', (0, -4.0, 0.45), (0.12, 0.3, 0.06))
    return m


@model('hypersonic_missile', 'Hypersonic missile, horizontal, nose -Y. TeamColor band, glowing nozzle.')
def hypersonic_missile():
    m = Model()
    rs = ((-4.0, 0.02), (-2.6, 0.26), (-1.0, 0.42), (3.4, 0.45), (3.95, 0.4))
    m.loft('GreyLt', [ring_circle(y, r, z=0.45, n=10) for y, r in rs])
    m.loft('Dark', [ring_circle(y, r, z=0.45, n=10) for y, r in ((-4.0, 0.02), (-3.3, 0.14))], cap=False)
    m.cyl('TeamColor', (0, -0.4, 0.45), 0.43, 0.3, axis='Y', seg=10)
    for a in (45, 135):
        with m.xf((0, 3.1, 0.45), (0, a, 0)):
            m.box('Grey', (0, 0, 0), (1.6, 1.0, 0.04), taper=(0.6, 0.7))
    m.cyl('Dark', (0, 4.05, 0.45), 0.34, 0.2, axis='Y', seg=10)
    m.cyl('GlowRed', (0, 4.16, 0.45), 0.28, 0.03, axis='Y', seg=10)
    return m


# ------------------------------------------------------------ naval
def hull_section(b, zdeck, zkeel, tumble=0.8):
    return [(b * tumble, zdeck), (b, 0.0), (b * 0.55, zkeel * 0.75), (0.0, zkeel),
            (-b * 0.55, zkeel * 0.75), (-b, 0.0), (-b * tumble, zdeck)]


@model('stealth_ship', 'Angular tumblehome stealth destroyer (Zumwalt style). Origin at waterline. TeamColor deck square + bands.', waterline=True)
def stealth_ship():
    m = Model()
    rings = []
    for y, b in ((-30.0, 0.05), (-22.0, 3.0), (-12.0, 4.5), (10.0, 4.7), (25.0, 4.4), (30.0, 4.1)):
        pts = hull_section(b, 3.2, -3.4)
        ring = []
        for (x, z) in pts:
            yy = y + (3.5 if (y == -30.0 and z > 1) else 0) + (2.0 if (y == -22.0 and z > 1) else 0)
            ring.append((x, yy, z))
        rings.append(ring)
    m.loft('Navy', rings)
    m.box('Navy', (0, 5.0, 6.7), (7.4, 18.0, 7.0), taper=(0.72, 0.85))
    m.box('Navy', (0, 3.0, 11.2), (4.6, 7.5, 2.4), taper=(0.75, 0.75))
    m.box('Dark', (0, -4.0, 8.8), (4.6, 0.08, 0.6), rot=(-25, 0, 0))   # bridge windows
    for y in (-13.0, -18.0):
        m.box('Navy', (0, y, 3.75), (2.6, 3.4, 1.1), taper=(0.7, 0.8))
        m.cyl('GreyDk', (0, y - 3.8, 3.85), 0.17, 4.6, axis='Y', seg=6)
    for s in (1, -1):
        for y in (-8.0, 15.0):
            m.box('Dark', (s * 3.1, y, 3.22), (0.9, 4.0, 0.06))      # VLS hatches
    m.box('TeamColor', (0, 24.5, 3.23), (6.0, 6.0, 0.04))             # flight deck square
    m.box('White', (0, 24.5, 3.22), (6.6, 6.6, 0.03))
    m.box('TeamColor', (0, 3.0, 12.5), (3.5, 5.6, 0.08))
    return m


@model('submarine', 'Attack submarine: cylindrical hull + sail + cruciform rudders, surfaced. Origin at waterline.', waterline=True)
def submarine():
    m = Model()
    rs = ((-20.0, 0.3), (-19.2, 1.4), (-17.0, 2.2), (-14.0, 2.5), (12.0, 2.5), (16.0, 1.8), (19.0, 0.8), (20.2, 0.25))
    m.loft('GreyDk', [ring_circle(y, r, z=-0.9, n=12) for y, r in rs])
    m.box('GreyDk', (0, -8.0, 3.0), (1.4, 6.0, 4.0), taper=(0.8, 0.85))
    m.box('GreyDk', (0, -9.3, 3.7), (5.0, 1.2, 0.14), taper=(1, 1))
    m.box('GreyDk', (0, 17.8, -0.9), (0.15, 2.0, 5.4))
    m.box('GreyDk', (0, 17.8, -0.9), (5.8, 2.0, 0.15))
    m.cyl('Dark', (0, 20.4, -0.9), 0.5, 0.4, axis='Y', seg=8)
    m.cyl('Metal', (0, -8.4, 5.6), 0.08, 1.2, seg=4)
    m.cyl('Metal', (0, -7.6, 5.4), 0.06, 0.8, seg=4)
    for s in (1, -1):
        team_stripe(m, (s * 0.62, -8.0, 3.8), (0.03, 2.2, 0.5))
    m.box('TeamColor', (0, 4.0, 1.58), (1.2, 6.0, 0.04))
    return m


@model('uuv', 'Torpedo-shaped unmanned underwater vehicle; centreline at z=0 (waterline origin).', waterline=True)
def uuv():
    m = Model()
    rs = ((-2.9, 0.08), (-2.6, 0.38), (-2.2, 0.53), (2.0, 0.53), (2.7, 0.3), (2.95, 0.12))
    m.loft('GreyDk', [ring_circle(y, r, z=0.0, n=10) for y, r in rs])
    m.cyl('TeamColor', (0, -1.1, 0.0), 0.54, 0.3, axis='Y', seg=10)
    m.cyl('Yellow', (0, -2.75, 0.0), 0.3, 0.3, axis='Y', seg=10, r2=0.09)
    for a in (0, 90):
        with m.xf((0, 2.45, 0), (0, a, 0)):
            m.box('Dark', (0, 0, 0), (1.3, 0.4, 0.03))
    m.cyl('Dark', (0, 3.05, 0), 0.32, 0.25, axis='Y', seg=10)
    return m


@model('carrier', 'Nuclear aircraft carrier (boss): flight deck with angled deck, island, parked jets. Origin at waterline. TeamColor island band + deck marks.', waterline=True)
def carrier():
    m = Model()
    rings = []
    for y, b, dz in ((-56.0, 1.5, 0), (-48.0, 8.5, 0), (-34.0, 12.5, 0), (32.0, 12.5, 0), (52.0, 11.5, 0)):
        rings.append([(x, y, z) for x, z in ((b * 1.05, 6.0), (b * 0.85, 0.0), (b * 0.5, -5.0),
                                             (-b * 0.5, -5.0), (-b * 0.85, 0.0), (-b * 1.05, 6.0))])
    m.loft('Navy', rings)
    deck = [(-4, -57), (4, -57), (14, -42), (15, 52), (-10, 53), (-19, 24), (-17, -8), (-12, -38)]
    m.plate('Deck', deck, 6.0, 7.0)
    m.plate('Navy', [(x * 0.97, y * 0.98) for x, y in deck], 4.5, 6.0)
    # island (starboard = +X)
    m.box('Navy', (11.5, 14.0, 12.0), (5.0, 17.0, 10.0))
    m.box('Navy', (11.5, 12.0, 18.5), (4.0, 9.0, 3.0), taper=(0.9, 0.9))
    m.box('Dark', (11.5, 7.3, 18.3), (4.0, 0.1, 1.0))
    m.box('TeamColor', (11.5, 14.0, 15.5), (5.06, 17.06, 1.0))
    m.cyl('GreyDk', (11.5, 13.0, 23.0), 0.4, 6.0, seg=6)
    m.box('GreyDk', (11.5, 13.0, 24.5), (3.0, 0.3, 1.2))
    m.box('GreyDk', (11.5, 15.5, 21.0), (2.4, 2.4, 0.3))
    # deck markings
    m.box('White', (-6.5, 4.0, 7.02), (0.5, 85.0, 0.03), rot=(0, 0, -9))
    m.box('White', (0, -30.0, 7.02), (0.4, 50.0, 0.03))
    m.box('Yellow', (5.0, -40.0, 7.02), (0.3, 30.0, 0.03))
    m.box('Yellow', (-4.0, -40.0, 7.02), (0.3, 30.0, 0.03))
    m.box('TeamColor', (-5.0, 38.0, 7.03), (8.0, 8.0, 0.03))
    m.box('Dark', (13.0, 34.0, 7.02), (5.0, 7.0, 0.03))
    # parked jets
    for i, (x, y, a) in enumerate(((9, -20, 30), (9, -12, 30), (9, -4, 30), (-12, 40, -150), (8, 44, 200))):
        with m.xf((x, y, 7.0), (0, 0, a)):
            m.plate('GreyLt', [(0, -2.6), (2.2, 1.6), (-2.2, 1.6)], 0.15, 0.35)
            m.box('GreyLt', (0, 0, 0.5), (0.7, 5.6, 0.6))
            m.box('GreyLt', (0, 2.2, 1.2), (0.1, 1.2, 1.2))
    return m


# ------------------------------------------------------------ structures
@model('hq', "Fortified command citadel (HQ): octagonal concrete base, keep, corner towers, antennas. Flag node 'Flag' + banners use TeamColor.", spin=())
def hq():
    m = Model()
    m.cyl('ConcDk', (0, 0, 1.5), 17.0, 3.0, seg=8, r2=15.5, rot=(0, 0, 22.5))
    m.box('Concrete', (0, 0, 7.0), (16.0, 16.0, 8.0), taper=(0.85, 0.85))
    m.box('Concrete', (0, 1.5, 13.0), (9.0, 9.0, 4.0), taper=(0.85, 0.85))
    for sx in (1, -1):
        for sy in (1, -1):
            m.cyl('Concrete', (sx * 9.5, sy * 9.5, 7.5), 2.6, 9.0, seg=8)
            m.cyl('ConcDk', (sx * 9.5, sy * 9.5, 12.5), 3.0, 1.2, seg=8)
            m.box('Dark', (sx * 9.5, sy * 9.5 - 2.62 * (1 if sy > 0 else 1), 10.0), (1.2, 0.2, 0.4))
    for x in (-4.5, 0, 4.5):
        m.box('Dark', (x, -7.6, 9.0), (2.0, 0.3, 0.45))
    m.box('Dark', (0, -8.0, 4.4), (3.0, 0.4, 2.8))          # gate
    m.box('TeamColor', (-4.8, -7.55, 7.0), (2.2, 0.1, 3.6), rot=(-8.5, 0, 0))
    m.box('TeamColor', (4.8, -7.55, 7.0), (2.2, 0.1, 3.6), rot=(-8.5, 0, 0))
    m.cyl('Metal', (2.5, 4.0, 21.0), 0.18, 12.0, seg=6)
    for z in (19.0, 23.0):
        m.box('Metal', (2.5, 4.0, z), (2.4, 0.1, 0.1))
    with m.xf((-2.5, 4.0, 15.6), (40, 0, 30)):
        m.cyl('GreyLt', (0, 0, 0.6), 1.6, 0.5, seg=12, r2=0.2, rot=(180, 0, 0))
    m.box('Dark', (2.0, -1.0, 15.3), (2.5, 2.5, 0.6))
    flag(m, (-2.0, -1.5, 15.0), 8.0, size=(3.2, 2.0))
    for i in range(6):
        a = math.radians(-60 - i * 12)
        m.box('Sandbag', (math.cos(a) * 15.5, math.sin(a) * 15.5, 3.4), (0.6, 2.8, 0.8), rot=(0, 0, math.degrees(a)))
    return m


@model('strongpoint', "Capturable strongpoint: sandbag ring with entrance (front), flag pole; flag mesh node 'Flag' (TeamColor).", spin=())
def strongpoint():
    m = Model()
    sandbag_ring(m, 4.0, layers=2, seg=16, gap=(-112, -68))
    flag(m, (0, 0, 0), 6.0, size=(1.8, 1.1))
    m.box('Wood', (1.6, 1.4, 0.3), (0.9, 0.6, 0.6))
    m.box('OliveDk', (1.6, 0.6, 0.25), (0.6, 0.45, 0.5))
    with m.xf((-1.8, -2.4, 0.9)):
        m.strut('Dark', (0, 0, 0), (0, -1.0, 0.1), 0.04, seg=4)
        m.box('Dark', (0, 0.2, 0), (0.18, 0.5, 0.18))
        for a in (0, 120, 240):
            m.strut('Dark', (0, 0, 0), (0.5 * math.cos(math.radians(a)), 0.5 * math.sin(math.radians(a)), -0.9), 0.03)
    return m


@model('bunker', 'Concrete hexagonal pillbox with firing slits and sandbags. TeamColor band at roof edge.', spin=())
def bunker():
    m = Model()
    m.cyl('Concrete', (0, 0, 0.9), 3.2, 1.8, seg=6, r2=2.7, rot=(0, 0, 30))
    m.cyl('ConcDk', (0, 0, 2.0), 3.4, 0.45, seg=6, r2=3.2, rot=(0, 0, 30))
    m.cyl('TeamColor', (0, 0, 1.73), 3.43, 0.12, seg=6, rot=(0, 0, 30))
    for a in (-90, -30, -150):
        r = 2.85
        m.box('Dark', (r * math.cos(math.radians(a)), r * math.sin(math.radians(a)), 1.35), (1.3, 0.3, 0.28),
              rot=(0, 0, a + 90))
    for i in range(9):
        a = math.radians(-160 + i * 17.5)
        m.box('Sandbag', (math.cos(a) * 4.0, math.sin(a) * 4.0, 0.35), (0.5, 1.3, 0.6), rot=(0, 0, math.degrees(a)),
              taper=(0.8, 0.95))
    m.box('Dark', (0, 3.0, 0.7), (1.0, 0.6, 1.4))
    m.cyl('Metal', (1.2, 0.8, 2.8), 0.05, 1.2, seg=4)
    return m


@model('radar_tower', "Lattice radar tower with radome; rotating antenna node 'Radar' (spin about local up). TeamColor rail band.", spin=('Radar',))
def radar_tower():
    m = Model()
    H = 16.0
    legs = [(sx, sy) for sx in (1, -1) for sy in (1, -1)]
    for sx, sy in legs:
        m.strut('Metal', (sx * 2.4, sy * 2.4, 0), (sx * 1.0, sy * 1.0, H), 0.12, seg=4)
        m.box('Concrete', (sx * 2.4, sy * 2.4, 0.25), (0.9, 0.9, 0.5))
    for k in range(4):
        z0, z1 = k * H / 4, (k + 1) * H / 4
        w0, w1 = 2.4 - 1.4 * k / 4, 2.4 - 1.4 * (k + 1) / 4
        for (ax, ay), (bx, by) in (((1, 1), (1, -1)), ((1, -1), (-1, -1)), ((-1, -1), (-1, 1)), ((-1, 1), (1, 1))):
            m.strut('Metal', (ax * w0, ay * w0, z0), (bx * w1, by * w1, z1), 0.05, seg=4)
    m.box('GreyDk', (0, 0, H + 0.2), (3.4, 3.4, 0.4))
    m.box('TeamColor', (0, 0, H + 0.75), (3.45, 3.45, 0.3))
    m.box('GreyDk', (0, 0, H + 1.1), (3.0, 3.0, 0.15))
    m.sphere('White', (1.0, 1.0, H + 1.9), 0.8, sub=2)
    m.cyl('Dark', (0, 0, H + 0.9), 0.25, 1.4, seg=6)
    m.cyl('Dark', (0, 0, H + 1.7), 0.3, 0.3, seg=6, node='Radar')
    with m.xf((0, 0, H + 2.4), (15, 0, 0)):
        m.box('GreyLt', (0, 0, 0), (5.0, 0.3, 1.4), node='Radar')
        m.box('Dark', (0, -0.16, 0), (4.6, 0.03, 1.1), node='Radar')
    return m


@model('aa_fortress', "Boss: large concrete air-defence fortress with 8 SAM launcher packs, central radar dome and radar panels. Flag node 'Flag'.", spin=())
def aa_fortress():
    m = Model()
    m.box('ConcDk', (0, 0, 3.0), (46.0, 46.0, 6.0), taper=(0.88, 0.88))
    m.box('Concrete', (0, 0, 7.0), (30.0, 30.0, 2.0))
    for sx in (1, -1):
        for sy in (1, -1):
            x, y = sx * 19.0, sy * 19.0
            m.box('Concrete', (x, y, 5.0), (11.0, 11.0, 10.0), taper=(0.85, 0.85))
            m.box('ConcDk', (x, y, 10.2), (9.6, 9.6, 0.4))
            with m.xf((x, y + 2.0, 10.4), (0, 0, 0)):
                canister_pack(m, 2, 3, 1.0, 5.5, 40, mat='Olive')
            if sy < 0:
                m.box('TeamColor', (x, y - 5.2, 5.0), (4.0, 0.1, 3.0), rot=(-5, 0, 0))
    for (x, y, a) in ((0, -12.5, 0), (12.5, 0, 90), (-12.5, 0, -90), (0, 12.5, 180)):
        with m.xf((x, y, 8.0), (0, 0, a)):
            m.box('Dark', (0, 1.5, 0.3), (3.4, 2.0, 0.6))
            with m.xf((0, 3.0, 0.6)):
                canister_pack(m, 2, 2, 0.9, 5.0, 35)
    m.cyl('Concrete', (0, 0, 12.0), 7.5, 8.0, seg=8, r2=6.2, rot=(0, 0, 22.5))
    m.sphere('White', (0, 0, 18.5), 4.6, sub=2, scale=(1, 1, 0.85))
    for a in (45, -45, 135):
        with m.xf((0, 0, 12.0), (0, 0, a)):
            m.box('OliveDk', (0, -7.0, 2.0), (4.0, 0.4, 3.0), rot=(-15, 0, 0))
            m.box('Dark', (0, -7.25, 2.0), (3.4, 0.05, 2.4), rot=(-15, 0, 0))
    flag(m, (-4.0, 4.0, 16.0), 9.0, size=(3.6, 2.2))
    m.box('Dark', (0, -21.0, 2.5), (6.0, 0.4, 4.0))
    return m


@model('ai_city_core', "Boss: futuristic AI tower rising from a hex base, glowing rings and a glowing core node 'Core' inside an open cage.", spin=('Core',))
def ai_city_core():
    m = Model()
    m.cyl('GreyDk', (0, 0, 1.5), 18.0, 3.0, seg=6, r2=16.0)
    m.cyl('Dark', (0, 0, 4.5), 12.0, 3.0, seg=6, r2=11.0)
    m.cyl('Glow', (0, 0, 3.05), 16.05, 0.15, seg=6)
    m.cyl('TeamColor', (0, 0, 6.05), 11.05, 0.2, seg=6)
    for i in range(6):
        a = math.radians(i * 60 + 30)
        with m.xf((math.cos(a) * 12.0, math.sin(a) * 12.0, 3.0), (0, 0, math.degrees(a))):
            m.box('GreyDk', (0, 0, 4.0), (6.0, 1.2, 8.0), taper=(0.2, 1.0))
    z = 6.0
    for i in range(3):
        r = 7.0 - i * 0.8
        m.cyl('GreyDk', (0, 0, z + 3.5), r, 7.0, seg=6, r2=r - 0.6, rot=(0, 0, 30 * i))
        m.cyl('Glow', (0, 0, z + 7.3), r - 0.7, 0.6, seg=6)
        z += 7.6
    zc = z
    for i in range(6):
        a = math.radians(i * 60)
        m.strut('Dark', (math.cos(a) * 4.6, math.sin(a) * 4.6, zc), (math.cos(a) * 3.8, math.sin(a) * 3.8, zc + 11.0), 0.35)
    m.sphere('Glow', (0, 0, zc + 5.5), 3.0, sub=2, node='Core')
    z = zc + 11.0
    for i in range(2):
        r = 4.6 - i * 0.9
        m.cyl('GreyDk', (0, 0, z + 2.5), r, 5.0, seg=6, r2=r - 0.6)
        m.cyl('Glow', (0, 0, z + 5.2), r - 0.6, 0.4, seg=6)
        z += 5.4
    m.cyl('Metal', (0, 0, z + 5.0), 1.6, 10.0, seg=6, r2=0.05)
    return m


# ------------------------------------------------------------ scenery
@model('tree_pine', 'Low-poly pine tree.', spin=())
def tree_pine():
    m = Model()
    m.cyl('Bark', (0, 0, 1.0), 0.25, 2.0, seg=6, r2=0.15)
    for r, h, z in ((2.0, 3.0, 3.0), (1.6, 2.6, 4.6), (1.1, 2.2, 6.1)):
        m.cyl('Pine', (0, 0, z), r, h, seg=7, r2=0.0)
    return m


@model('tree_round', 'Low-poly deciduous tree.', spin=())
def tree_round():
    m = Model()
    m.cyl('Bark', (0, 0, 1.3), 0.25, 2.6, seg=6, r2=0.17)
    m.sphere('Leaf', (0, 0, 3.8), 2.0, sub=2, scale=(1, 1, 0.9), jitter=0.12, seed=3)
    m.sphere('Leaf', (0.9, 0.5, 3.2), 1.2, sub=2, jitter=0.12, seed=5)
    return m


@model('rock', 'Low-poly boulder.', spin=())
def rock():
    m = Model()
    m.sphere('Rock', (0, 0, 0.5), 1.2, sub=2, scale=(1.3, 1.0, 0.7), jitter=0.22, seed=11)
    m.sphere('Rock', (1.1, 0.4, 0.2), 0.6, sub=1, scale=(1, 0.9, 0.7), jitter=0.2, seed=4)
    return m


def building(m, w, d, floors, wall='Concrete', glass='Glass', fh=3.2, z0=0.0):
    H = floors * fh
    m.box(wall, (0, 0, z0 + H / 2), (w, d, H))
    for i in range(floors):
        m.box(glass, (0, 0, z0 + i * fh + fh * 0.55), (w + 0.08, d + 0.08, fh * 0.42))
    m.box('Roof', (0, 0, z0 + H + 0.25), (w + 0.2, d + 0.2, 0.5))
    return z0 + H + 0.5


@model('building_a', 'Low-rise 2-storey city block (shop/house).', spin=())
def building_a():
    m = Model()
    top = building(m, 12.0, 10.0, 2, wall='Beige')
    m.box('Dark', (0, -5.05, 1.4), (2.0, 0.1, 2.6))
    m.box('Metal', (3.0, 2.0, top + 0.5), (1.6, 1.2, 1.0))
    m.box('Metal', (-3.5, -1.0, top + 0.4), (1.2, 1.2, 0.8))
    m.box('Red', (0, -5.3, 3.1), (6.0, 0.6, 0.15), rot=(-15, 0, 0))
    return m


@model('building_b', 'Mid-rise 6-storey city block with rooftop water tank.', spin=())
def building_b():
    m = Model()
    top = building(m, 14.0, 14.0, 6, wall='Brick')
    m.cyl('Wood', (3.5, 3.5, top + 1.6), 1.2, 2.4, seg=8)
    m.box('Metal', (-3.0, -2.0, top + 0.6), (3.0, 2.0, 1.2))
    m.box('Dark', (0, -7.05, 1.5), (3.0, 0.1, 3.0))
    return m


@model('building_c', 'High-rise 16-storey tower with setback and antenna.', spin=())
def building_c():
    m = Model()
    top = building(m, 16.0, 16.0, 10, wall='GreyLt')
    top = building(m, 12.0, 12.0, 6, wall='GreyLt', z0=top)
    m.box('Metal', (0, 0, top + 1.0), (5.0, 5.0, 2.0))
    m.cyl('Metal', (0, 0, top + 6.0), 0.2, 8.0, seg=4)
    m.box('Dark', (0, -8.05, 2.0), (4.0, 0.1, 4.0))
    return m


# ------------------------------------------------------------ runner
def reset():
    sc = bpy.context.scene
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)


def run(mid):
    fn, notes, waterline, spin = REG[mid]
    reset()
    m = fn()
    objs = m.build()
    objs.sort(key=lambda o: o.name != 'Body')
    L.finish(mid, objs, 'procedural', yaw_deg=0, waterline=waterline, notes=notes,
             spin_parts=tuple(spin))


ids = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if ids == ['all'] or not ids:
    ids = list(REG)
for mid in ids:
    try:
        run(mid)
    except Exception as e:
        import traceback
        traceback.print_exc()
        print('[WG] FAILED', mid, e)

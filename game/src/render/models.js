// Model library. Loads assets/models/<id>.glb (exported from the .blend files / built in Blender) listed in
// assets/models/manifest.json; falls back to a procedural low-poly model so the game always runs.
// get(id, teamColor) returns a fresh THREE.Object3D normalized to `targetSize` length, facing +X
// (sim heading 0 = +x), origin at the ground contact point.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
const cache = new Map();      // id -> { scene, animations, size }
let manifest = {};

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: 0.15, flatShading: true, ...o });
const OLIVE = 0x5d6b3e, GREY = 0x6f7a80, DARK = 0x2c3236, STEEL = 0x8c969c, NAVY = 0x5b6670;

export async function loadModels(onProgress) {
  try {
    const r = await fetch('assets/models/manifest.json', { cache: 'no-cache' });
    if (r.ok) manifest = await r.json();
  } catch { manifest = {}; }
  const ids = Object.keys(manifest);
  let done = 0;
  await Promise.all(ids.map(async id => {
    try {
      const g = await loader.loadAsync('assets/models/' + (manifest[id].file || id + '.glb'));
      prepareGLB(g.scene, id);
      cache.set(id, { scene: g.scene, animations: g.animations, glb: true });
    } catch (e) { console.warn('GLB load failed', id, e); }
    onProgress?.(++done / Math.max(1, ids.length));
  }));
}

// ---- load-time mesh merging (perf): one draw call per model part instead of one per material ----
// GLB parts are plain coloured materials (no textures), so every model is baked into vertex colours and drawn with
// one shared material. Spinning nodes (Rotor*/TailRotor/Radar) are merged separately and keep their node; Flag/Core
// keep their own materials (recoloured / glowing at runtime). TeamColor vertices are re-tinted per team colour.
export const UNIT_MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.15 });
UNIT_MATERIAL.name = 'UnitVC';
const SPIN_NODE = /^(rotor|tailrotor|radar)/i;
const KEEP_NODE = /^(flag|core)$/i;

function partColor(mat) {
  const c = mat?.color ? mat.color.clone() : new THREE.Color(1, 1, 1);
  if (mat?.emissive && (mat.emissive.r + mat.emissive.g + mat.emissive.b) > 0) {
    const k = mat.emissiveIntensity ?? 1;
    c.r = Math.min(3, c.r + mat.emissive.r * k); c.g = Math.min(3, c.g + mat.emissive.g * k); c.b = Math.min(3, c.b + mat.emissive.b * k);
  }
  return c;
}

// parts: [{ geo, matrix, mat, skinIndex? }] -> one indexed BufferGeometry (position, normal, color [, skinIndex, skinWeight]).
function mergeParts(parts, skinned) {
  let nv = 0, ni = 0;
  for (const p of parts) { const n = p.geo.attributes.position.count; nv += n; ni += p.geo.index ? p.geo.index.count : n; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), team = new Uint8Array(nv);
  const si = skinned ? new Uint16Array(nv * 4) : null, sw = skinned ? new Float32Array(nv * 4) : null;
  const idx = new Uint32Array(ni);
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  let vo = 0, io = 0, anyTeam = false;
  for (const p of parts) {
    const g = p.geo, pa = g.attributes.position, na = g.attributes.normal, n = pa.count;
    nm.getNormalMatrix(p.matrix);
    const c = partColor(p.mat), isTeam = p.mat?.name === 'TeamColor';
    if (isTeam) anyTeam = true;
    const sIa = g.attributes.skinIndex, sWa = g.attributes.skinWeight;
    for (let i = 0; i < n; i++) {
      const o = (vo + i) * 3;
      v.fromBufferAttribute(pa, i).applyMatrix4(p.matrix); pos[o] = v.x; pos[o + 1] = v.y; pos[o + 2] = v.z;
      if (na) v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); else v.set(0, 1, 0);
      nor[o] = v.x; nor[o + 1] = v.y; nor[o + 2] = v.z;
      col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
      if (isTeam) team[vo + i] = 1;
      if (skinned) {
        const q = (vo + i) * 4;
        if (p.skinIndex != null) { si[q] = p.skinIndex; sw[q] = 1; }
        else if (sIa && sWa) for (let k = 0; k < 4; k++) { si[q + k] = sIa.getComponent(i, k); sw[q + k] = sWa.getComponent(i, k); }
        else sw[q] = 1;
      }
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo;
    else for (let i = 0; i < n; i++) idx[io + i] = i + vo;
    vo += n; io += g.index ? g.index.count : n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (skinned) { out.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4)); }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  if (anyTeam) out.userData.teamMask = team;
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}

const firstMat = o => (Array.isArray(o.material) ? o.material[0] : o.material);
const _inv = new THREE.Matrix4();
function relMatrix(node, mesh) { return new THREE.Matrix4().multiplyMatrices(_inv.copy(node.matrixWorld).invert(), mesh.matrixWorld); }

function prepareGLB(root, id) {
  root.updateMatrixWorld(true);
  const keepTeam = id === 'strongpoint';            // its TeamColor parts are recoloured on capture
  const spin = [], used = new Set();
  const isKept = o => KEEP_NODE.test(o.name) || (keepTeam && o.isMesh && firstMat(o)?.name === 'TeamColor');
  // Meshes under `node`, not inside spinning/kept subtrees.
  // Inside a spinning node (inSpin) its children (Rotor_1, Rotor_LF_2...) are merged into it, not split again.
  const collect = (node, out = [], inSpin = false) => {
    for (const c of node.children) {
      if (isKept(c)) continue;
      if (!inSpin && SPIN_NODE.test(c.name)) { if (!spin.includes(c)) spin.push(c); continue; }
      if (c.isMesh) out.push(c);
      collect(c, out, inSpin);
    }
    return out;
  };
  // 1) Skinned meshes sharing one skeleton + rigid meshes parented to bones -> one SkinnedMesh.
  const skinnedList = []; root.traverse(o => { if (o.isSkinnedMesh) skinnedList.push(o); });
  if (skinnedList.length) {
    const target = skinnedList[0], sk = target.skeleton;
    const bindInv = new THREE.Matrix4().copy(target.bindMatrix).invert();
    const parts = [];
    for (const s of skinnedList) {
      if (s.skeleton.bones.length !== sk.bones.length || s.skeleton.bones.some((b, i) => b !== sk.bones[i])) continue;
      parts.push({ geo: s.geometry, matrix: new THREE.Matrix4().multiplyMatrices(bindInv, s.bindMatrix), mat: firstMat(s) }); used.add(s);
    }
    root.traverse(o => {
      if (!o.isMesh || o.isSkinnedMesh || isKept(o)) return;
      let b = o.parent; while (b && !b.isBone) b = b.parent;
      const bi = b ? sk.bones.indexOf(b) : -1;
      if (bi < 0) return;
      // Rigid attachment: v_bind = bind^-1 * boneInverse^-1 * (bone^-1 * meshWorld) * v
      const m = new THREE.Matrix4().copy(sk.boneInverses[bi]).invert().multiply(relMatrix(b, o));
      parts.push({ geo: o.geometry, matrix: new THREE.Matrix4().multiplyMatrices(bindInv, m), mat: firstMat(o), skinIndex: bi }); used.add(o);
    });
    target.geometry = mergeParts(parts, true);
    target.material = UNIT_MATERIAL;
    for (const o of used) if (o !== target) o.parent?.remove(o);
  }
  // 2) Static body -> one mesh under root; 3) each spinning node -> one mesh in its own frame.
  const bake = (node, meshes) => {
    meshes = meshes.filter(o => !used.has(o) && !o.isSkinnedMesh);
    if (!meshes.length) return;
    const geo = mergeParts(meshes.map(o => ({ geo: o.geometry, matrix: relMatrix(node, o), mat: firstMat(o) })), false);
    for (const o of meshes) { o.parent?.remove(o); used.add(o); }
    const mesh = new THREE.Mesh(geo, UNIT_MATERIAL); mesh.name = 'merged';
    node.add(mesh);
  };
  bake(root, collect(root));
  for (const s of spin) {
    if (s.isMesh) {
      // A spinning node that is itself a mesh: recolour in place (keeps its transform and name).
      s.geometry = mergeParts([{ geo: s.geometry, matrix: new THREE.Matrix4(), mat: firstMat(s) }], false);
      s.material = UNIT_MATERIAL;
    }
    bake(s, collect(s, [], true));
  }
  root.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true;
      if (firstMat(o)?.name === 'TeamColor') o.userData.team = true;
    }
  });
}

// Per-team copy of a merged geometry: shares every attribute except the colour.
const teamGeoCache = new Map();
function teamGeometry(geo, color) {
  const key = geo.uuid + ':' + color;
  let g = teamGeoCache.get(key);
  if (g) return g;
  g = new THREE.BufferGeometry();
  for (const k in geo.attributes) if (k !== 'color') g.setAttribute(k, geo.attributes[k]);
  g.setIndex(geo.index);
  const col = new Float32Array(geo.attributes.color.array), mask = geo.userData.teamMask, c = new THREE.Color(color);
  for (let i = 0; i < mask.length; i++) if (mask[i]) { col[i * 3] = Math.min(2, c.r * 1.25); col[i * 3 + 1] = Math.min(2, c.g * 1.25); col[i * 3 + 2] = Math.min(2, c.b * 1.25); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.boundingBox = geo.boundingBox; g.boundingSphere = geo.boundingSphere;
  teamGeoCache.set(key, g);
  return g;
}

export function hasGLB(id) { return cache.has(id); }

// Returns { object, mixer?, actions? } scaled so the longest horizontal side == targetSize.
export function makeModel(id, targetSize, teamColor, opts = {}) {
  let obj, animations = [];
  const c = cache.get(id);
  if (c) {
    obj = SkeletonUtils.clone(c.scene);
    animations = c.animations;
    // GLB forward is +Z; sim forward is +X.
    const wrap = new THREE.Group();
    obj.rotation.y = Math.PI / 2;
    wrap.add(obj);
    obj = wrap;
  } else obj = procedural(id);
  normalize(obj, targetSize, opts.byHeight);
  tint(obj, teamColor);
  // Shadow casting is opt-out (perf): small units / decor pass { shadow: false }.
  const cast = opts.shadow !== false;
  obj.traverse(o => { if (o.isMesh) o.castShadow = cast; });
  const out = { object: obj };
  if (animations.length) {
    out.mixer = new THREE.AnimationMixer(obj);
    out.actions = animations.map(a => out.mixer.clipAction(a));
    const loop = animations.find(a => /fly|drive|rotor|run|idle/i.test(a.name));
    if (loop) out.mixer.clipAction(loop).play();
  }
  return out;
}

function normalize(obj, targetSize, byHeight) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const len = (byHeight ? size.y : Math.max(size.x, size.z)) || 1;
  const s = targetSize / len;
  const inner = new THREE.Group();
  while (obj.children.length) inner.add(obj.children[0]);
  inner.scale.setScalar(s);
  inner.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s);
  obj.add(inner);
}

function tint(obj, color) {
  if (color == null) return;
  obj.traverse(o => {
    if (!o.isMesh) return;
    if (o.geometry?.userData.teamMask) { o.geometry = teamGeometry(o.geometry, color); return; }
    if (o.userData.team || o.userData.teamPart) {
      o.material = o.material.clone();
      o.material.color = new THREE.Color(color);
      o.material.emissive = new THREE.Color(color).multiplyScalar(0.25);
    }
  });
}

// ---------- Procedural fallbacks (low-poly, readable silhouettes) ----------
function box(w, h, d, m, x = 0, y = 0, z = 0) { const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); g.position.set(x, y, z); return g; }
function cyl(rt, rb, h, m, seg = 8) { return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); }
function team(mesh) { mesh.userData.teamPart = true; return mesh; }

function procedural(id) {
  const g = new THREE.Group();
  const add = (...m) => m.forEach(x => g.add(x));
  const T = mat(0xffffff);
  switch (id) {
    case 'tank_heavy': case 'spg': {
      add(box(4, 0.9, 2.4, mat(OLIVE), 0, 0.75), box(4.3, 0.6, 0.6, mat(DARK), 0, 0.35, 1.0), box(4.3, 0.6, 0.6, mat(DARK), 0, 0.35, -1.0));
      const tur = box(id === 'spg' ? 2.2 : 1.8, 0.7, 1.6, mat(OLIVE), id === 'spg' ? -0.6 : -0.2, 1.5);
      const barrel = cyl(0.12, 0.12, id === 'spg' ? 4 : 3, mat(DARK)); barrel.rotation.z = Math.PI / 2; barrel.position.set(id === 'spg' ? 1.7 : 1.6, 1.55, 0);
      add(tur, barrel, team(box(0.5, 0.12, 1.62, T, -0.2, 1.86)));
      break;
    }
    case 'himars': case 'apc': case 'supply_truck': case 'sam': case 'iron_dome': case 'laser': case 'ew': {
      add(box(4, 1.0, 2, mat(id === 'apc' ? OLIVE : GREY), 0, 0.9));
      for (const x of [-1.3, 0, 1.3]) for (const z of [-1, 1]) { const w = cyl(0.45, 0.45, 0.4, mat(DARK)); w.rotation.x = Math.PI / 2; w.position.set(x, 0.45, z); add(w); }
      if (id === 'apc') add(box(1, 0.5, 1, mat(OLIVE), -0.4, 1.65), team(box(3.9, 0.1, 0.1, T, 0, 1.2, 1.0)));
      if (id === 'supply_truck') add(box(1.2, 1.2, 1.9, mat(GREY), 1.3, 1.6), box(2.4, 1.5, 1.9, mat(OLIVE), -0.7, 1.8));
      if (id === 'himars' || id === 'sam' || id === 'iron_dome') {
        const pod = box(2.4, 1, 1.6, mat(id === 'sam' ? STEEL : OLIVE), -0.6, 2.1); pod.rotation.z = 0.5; add(pod);
        if (id !== 'himars') add(box(0.15, 1.2, 1.2, mat(DARK), 1.4, 2.0));
      }
      if (id === 'laser') { const d = cyl(0.6, 0.6, 0.5, mat(STEEL), 12); d.rotation.z = Math.PI / 2; d.position.set(0, 2.1, 0); add(box(0.8, 0.6, 0.8, mat(GREY), 0, 1.7), d, box(0.4, 0.4, 0.4, mat(0x9ff, { emissive: 0x2aa }), 0.3, 2.1)); }
      if (id === 'ew') { const dish = cyl(1.0, 0.2, 0.3, mat(STEEL), 12); dish.position.set(-0.5, 2.6, 0); dish.rotation.z = 0.6; add(dish, box(0.1, 2.2, 0.1, mat(DARK), 1.2, 2.3), box(0.1, 1.8, 0.1, mat(DARK), 0.6, 2.1)); }
      add(team(box(0.6, 0.6, 2.02, T, 1.4, 1.1)));
      break;
    }
    case 'ugv': add(box(2, 0.6, 1.4, mat(OLIVE), 0, 0.5), box(2.2, 0.4, 0.3, mat(DARK), 0, 0.25, 0.6), box(2.2, 0.4, 0.3, mat(DARK), 0, 0.25, -0.6), box(0.6, 0.4, 0.5, mat(GREY), 0, 1.0), team(box(0.2, 0.1, 1.42, T, -0.8, 0.82))); break;
    case 'infantry': {
      for (const [x, z] of [[0, 0], [0.9, 0.6], [0.9, -0.6], [-0.9, 0.6], [-0.9, -0.6]]) {
        add(box(0.35, 0.9, 0.35, mat(OLIVE), x, 0.45, z), team(box(0.36, 0.3, 0.36, T, x, 1.05, z)));
      }
      break;
    }
    case 'drone': case 'drone_male': case 'cca': {
      add(box(2.2, 0.35, 0.45, mat(GREY), 0, 0), box(0.5, 0.06, 4, mat(GREY), 0, 0.05), box(0.4, 0.04, 1.4, mat(GREY), -1, 0.1), team(box(0.3, 0.07, 4.02, T, 0, 0.1)));
      break;
    }
    case 'drone_kamikaze': add(box(1.4, 0.2, 0.2, mat(GREY)), box(0.3, 0.04, 1.4, mat(GREY), 0.3), box(0.3, 0.04, 1.2, mat(GREY), -0.5), team(box(0.3, 0.21, 0.21, T, 0.6))); break;
    case 'fpv': { add(team(box(0.4, 0.15, 0.4, T))); for (const [x, z] of [[0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]]) add(box(0.25, 0.03, 0.25, mat(DARK), x, 0.1, z)); break; }
    case 'fighter_stealth': case 'fighter_multi': case 'bomber': {
      const L = id === 'bomber' ? 3 : 4;
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.45, L, 6), mat(id === 'bomber' ? DARK : GREY)); body.rotation.z = -Math.PI / 2; add(body);
      const wing = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.6, 0, 0), new THREE.Vector3(-1.2, 0, 2.2), new THREE.Vector3(-1.2, 0, -2.2)]), mat(id === 'bomber' ? DARK : GREY, { side: THREE.DoubleSide }));
      if (id === 'bomber') wing.scale.set(1.6, 1, 2);
      add(wing);
      if (id !== 'bomber') add(box(0.6, 0.7, 0.06, mat(GREY), -1.6, 0.4, 0.35), box(0.6, 0.7, 0.06, mat(GREY), -1.6, 0.4, -0.35));
      add(team(box(0.5, 0.08, 0.5, T, -0.6, 0.25)));
      break;
    }
    case 'heli_attack': case 'heli_transport': {
      add(box(id === 'heli_transport' ? 3.4 : 2.6, 1.0, 1.0, mat(OLIVE), 0, 0.6), box(2.2, 0.3, 0.3, mat(OLIVE), -2.2, 0.8), box(0.1, 0.8, 0.5, mat(OLIVE), -3.3, 1.1));
      const rotor = box(5, 0.05, 0.25, mat(DARK), 0, 1.35); rotor.name = 'Rotor'; add(rotor);
      const r2 = box(0.25, 0.05, 5, mat(DARK), 0, 1.35); r2.name = 'Rotor'; add(r2);
      add(team(box(0.6, 0.3, 1.02, T, 0.6, 0.7)));
      break;
    }
    case 'destroyer': case 'stealth_ship': case 'carrier': {
      const L = id === 'carrier' ? 12 : 7.5, W = id === 'carrier' ? 2.6 : 1.4;
      const hull = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.5, W * 0.4, L, 6, 1), mat(NAVY)); hull.rotation.z = Math.PI / 2; hull.scale.set(1, 1, 0.55); hull.position.y = 0.3; add(hull);
      if (id === 'carrier') add(box(L, 0.2, W * 1.6, mat(DARK), 0, 0.8), box(1.6, 1.4, 0.8, mat(NAVY), -1, 1.6, W * 0.6));
      else add(box(1.8, id === 'stealth_ship' ? 1.4 : 1.2, 0.9, mat(NAVY), -0.6, 1.1), box(0.2, 1.4, 0.2, mat(DARK), -0.6, 2.2), box(0.8, 0.4, 0.6, mat(NAVY), 1.8, 0.8));
      add(team(box(0.8, 0.06, W * 0.6, T, -2.5, id === 'carrier' ? 0.92 : 0.62)));
      break;
    }
    case 'submarine': case 'uuv': {
      const hull = cyl(0.5, 0.5, id === 'uuv' ? 2.4 : 6, mat(DARK), 10); hull.rotation.z = Math.PI / 2; add(hull);
      if (id === 'submarine') add(box(1, 0.9, 0.3, mat(DARK), 0.8, 0.7), team(box(0.3, 0.2, 0.32, T, 0.8, 1.05)));
      else add(team(box(0.3, 0.3, 0.3, T, 1.1, 0)));
      break;
    }
    case 'hypersonic_missile': { const m = cyl(0.15, 0.3, 3, mat(STEEL)); m.rotation.z = -Math.PI / 2; add(m); break; }
    // Structures
    case 'hq': add(box(8, 3, 8, mat(0x6b6f66), 0, 1.5), box(5, 3, 5, mat(0x7a7f74), 0, 4.5), box(0.2, 5, 0.2, mat(DARK), 1.8, 8), team(box(1.6, 1, 0.05, T, 2.6, 9.6)), team(box(8.1, 0.3, 8.1, T, 0, 3))); break;
    case 'bunker': add(cyl(2.2, 2.6, 1.6, mat(0x7c7a6e), 8), team(box(1.6, 0.2, 1.6, T, 0, 1.0)), (() => { const b = cyl(0.12, 0.12, 2, mat(DARK)); b.rotation.z = Math.PI / 2; b.position.set(1.6, 1.0, 0); return b; })()); g.children[0].position.y = 0.8; break;
    case 'airfield': add(box(14, 0.1, 3, mat(0x3a3d40), 0, 0.05), box(3, 2, 3, mat(0x777a70), -3, 1, 3.4), team(box(3.05, 0.3, 3.05, T, -3, 2.1, 3.4))); break;
    case 'port': add(box(6, 0.6, 4, mat(0x777a70), 0, 0.3), box(0.4, 4, 0.4, mat(0xd8a32a), 1.5, 2.3), box(3, 0.3, 0.3, mat(0xd8a32a), 0.6, 4.2), team(box(1, 0.4, 1, T, -2, 0.8))); break;
    case 'radar_tower': { add(box(0.8, 5, 0.8, mat(GREY), 0, 2.5)); const d = cyl(1.4, 0.3, 0.3, mat(STEEL), 12); d.position.y = 5.3; d.rotation.x = 0.5; d.name = 'Rotor'; add(d, team(box(0.82, 0.4, 0.82, T, 0, 4))); break; }
    case 'strongpoint': { add(cyl(3, 3.2, 0.5, mat(0x8a7f5c), 12), box(0.12, 4.5, 0.12, mat(DARK), 0, 2.4)); const f = box(1.4, 0.8, 0.05, T, 0.75, 4.2); f.name = 'Flag'; f.userData.teamPart = true; add(f); break; }
    case 'aa_fortress': add(cyl(6, 7, 3, mat(0x6b6f66), 8), box(1.5, 1, 3, mat(STEEL), 3, 3.5), box(1.5, 1, 3, mat(STEEL), -3, 3.5), team(box(4, 0.3, 4, T, 0, 3.2))); break;
    case 'ai_city_core': add(cyl(1.5, 3, 12, mat(0x30343a), 6), new THREE.Mesh(new THREE.OctahedronGeometry(1.6), mat(0xff3355, { emissive: 0xff2244 }))); g.children[0].position.y = 6; g.children[1].position.y = 13; break;
    case 'tree_pine': { const c = new THREE.Mesh(new THREE.ConeGeometry(1, 2.6, 6), mat(0x2f5a2c)); c.position.y = 2; add(box(0.3, 1, 0.3, mat(0x5a4029), 0, 0.5), c); break; }
    case 'tree_round': { const c = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 0), mat(0x3f6d34)); c.position.y = 1.8; add(box(0.3, 1.2, 0.3, mat(0x5a4029), 0, 0.6), c); break; }
    case 'rock': add(new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), mat(0x777b78))); break;
    default: add(box(2, 1, 1, mat(0xff00ff), 0, 0.5));
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

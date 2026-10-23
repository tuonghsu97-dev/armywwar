// Builds the static world: terrain mesh, water, city blocks (per-block meshes so they can fade when they
// hide units, GDD §2 F-13), forests, bridges, decorative districts from the Blender map tiles.
import * as THREE from 'three';
import { T, CELL } from '../data/maps.js';
import { makeModel, hasGLB } from './models.js';

const PALETTE = {
  plains: { [T.LAND]: 0x7f9a4f, [T.HILL]: 0x8d8a5a, [T.FOREST]: 0x56783a, [T.ROAD]: 0xa89a76, [T.SHALLOW]: 0x6f8f8a, [T.DEEP]: 0x2f5f78, [T.BRIDGE]: 0x8a8070, [T.BUILDING]: 0x8f8f8f, outside: 0x4e6234 },
  city: { [T.LAND]: 0x6d7368, [T.HILL]: 0x7c7a70, [T.FOREST]: 0x55704a, [T.ROAD]: 0x45484c, [T.SHALLOW]: 0x4f7a86, [T.DEEP]: 0x2a5268, [T.BRIDGE]: 0x5d6064, [T.BUILDING]: 0x5c5f63, outside: 0x3c4044 },
  bay: { [T.LAND]: 0xb3a676, [T.HILL]: 0x8c8a62, [T.FOREST]: 0x5f7f42, [T.ROAD]: 0x9c9073, [T.SHALLOW]: 0x3fa3a8, [T.DEEP]: 0x1d5f86, [T.BRIDGE]: 0x7d776a, [T.BUILDING]: 0x8f8a80, outside: 0x174a6a },
};

export function buildTerrain(scene, map) {
  const pal = PALETTE[map.id];
  const root = new THREE.Group();
  root.name = 'terrain';
  scene.add(root);

  // Outer ground so the camera never sees the void.
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(map.w * 4, map.h * 5), new THREE.MeshStandardMaterial({ color: pal.outside, roughness: 1 }));
  outer.rotation.x = -Math.PI / 2; outer.position.set(map.w / 2, -0.6, map.h / 2); outer.receiveShadow = true;
  root.add(outer);

  // Terrain grid (vertex per cell corner).
  const { cols, rows } = map;
  const geo = new THREE.PlaneGeometry(map.w, map.h, cols, rows);
  geo.rotateX(-Math.PI / 2);
  geo.translate(map.w / 2, 0, map.h / 2);
  const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  const cellT = (c, r) => map.grid[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))];
  const cellH = (c, r) => map.height[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))];
  for (let i = 0; i < pos.count; i++) {
    const vc = i % (cols + 1), vr = Math.floor(i / (cols + 1));
    // Average the 4 cells touching this vertex.
    let h = 0, water = 0, rr = 0, gg = 0, bb = 0;
    for (const [dc, dr] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const t = cellT(vc + dc, vr + dr);
      h += cellH(vc + dc, vr + dr);
      if (t === T.DEEP) water += 2; else if (t === T.SHALLOW) water += 1;
      col.setHex(pal[t] ?? pal[T.LAND]); rr += col.r; gg += col.g; bb += col.b;
    }
    const jitter = ((vc * 7919 + vr * 104729) % 97) / 97 * 0.06 - 0.03;
    pos.setY(i, h / 4 - water * 0.35);
    colors[i * 3] = rr / 4 + jitter; colors[i * 3 + 1] = gg / 4 + jitter; colors[i * 3 + 2] = bb / 4 + jitter;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
  ground.receiveShadow = true;
  ground.name = 'ground';
  root.add(ground);

  // Water surface.
  if (map.grid.some(t => t === T.DEEP || t === T.SHALLOW)) {
    const wmat = new THREE.MeshStandardMaterial({ color: map.id === 'bay' ? 0x2a86b8 : 0x3a7f9c, transparent: true, opacity: 0.72, roughness: 0.2, metalness: 0.1 });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(map.w, map.h, 1, 1), wmat);
    water.rotation.x = -Math.PI / 2; water.position.set(map.w / 2, -0.18, map.h / 2);
    water.name = 'water';
    root.add(water);
    root.userData.water = water;
  }

  // Bridges.
  const bridgeMat = new THREE.MeshStandardMaterial({ color: pal[T.BRIDGE], roughness: 0.8 });
  const bridgeGeo = new THREE.BoxGeometry(CELL, 0.3, CELL);
  const bridgeCells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (map.grid[r * cols + c] === T.BRIDGE) bridgeCells.push([c, r]);
  if (bridgeCells.length) {
    const im = new THREE.InstancedMesh(bridgeGeo, bridgeMat, bridgeCells.length);
    const m = new THREE.Matrix4();
    bridgeCells.forEach(([c, r], i) => { m.makeTranslation(c * CELL + 1, 0.05, r * CELL + 1); im.setMatrixAt(i, m); });
    im.receiveShadow = true; im.castShadow = true;
    root.add(im);
  }

  // City blocks: merge building cells per 16x14 block into one mesh with its own material (for fading).
  const blocks = new Map();
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (map.grid[r * cols + c] !== T.BUILDING) continue;
    const key = Math.floor(c * CELL / 16) + ':' + Math.floor(r * CELL / 14);
    if (!blocks.has(key)) blocks.set(key, []);
    blocks.get(key).push([c, r, map.bldHeight[r * cols + c]]);
  }
  // Perf (QA #10): ALL blocks are one mesh (2 draw calls incl. shadow). Each vertex carries its block id; the
  // per-block fade (F-13) is read from a 1-row data texture. `buildings` keeps one lightweight proxy per block
  // ({userData.bounds, material.opacity}) so renderer.fadeBuildings() works unchanged; world.syncFade() uploads.
  // Readability (QA #20): lighter facades with sparse windows, solid darker roofs, heights scaled to 80 %.
  const buildings = [];
  const winTex = windowTexture();
  const H_SCALE = 0.8, blockList = [...blocks.values()];
  const bGeos = [];
  blockList.forEach((cells, bi) => {
    const wall = new THREE.Color().setHSL(0.08 + (cells[0][0] % 5) * 0.025, 0.14, 0.46 + (cells[0][1] % 4) * 0.04);
    const roof = new THREE.Color().setHSL(0.58 + (cells[0][1] % 3) * 0.02, 0.05, 0.13 + (cells[0][0] % 3) * 0.025);
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity, maxh = 0;
    for (const [c, r, h0] of cells) {
      const h = Math.max(1.5, h0 * H_SCALE);
      const g = new THREE.BoxGeometry(CELL * 0.98, h, CELL * 0.98);
      g.translate(c * CELL + 1, h / 2, r * CELL + 1);
      g.userData = { wall, roof, block: bi };
      bGeos.push(g);
      minx = Math.min(minx, c * CELL); maxx = Math.max(maxx, c * CELL + CELL); minz = Math.min(minz, r * CELL); maxz = Math.max(maxz, r * CELL + CELL); maxh = Math.max(maxh, h);
    }
    buildings.push({ userData: { bounds: { minx, maxx, minz, maxz, maxh }, block: bi }, material: { opacity: 1, depthWrite: true } });
  });
  let buildingMesh = null, syncFade = null;
  if (bGeos.length) {
    const nb = blockList.length;
    const fadeData = new Uint8Array(nb * 4).fill(255);
    const fadeTex = new THREE.DataTexture(fadeData, nb, 1, THREE.RGBAFormat);
    fadeTex.magFilter = fadeTex.minFilter = THREE.NearestFilter; fadeTex.needsUpdate = true;
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, map: winTex });
    m.onBeforeCompile = sh => {
      sh.uniforms.uFadeTex = { value: fadeTex }; sh.uniforms.uBlocks = { value: nb };
      sh.vertexShader = 'attribute float aBlock;\nuniform sampler2D uFadeTex;\nuniform float uBlocks;\nvarying float vFade;\n' +
        sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vFade = texture2D(uFadeTex, vec2((aBlock + 0.5) / uBlocks, 0.5)).r;');
      // Ordered 4x4 Bayer screen-door fade: keeps depth writes so x-ray silhouettes of hidden units work.
      sh.fragmentShader = 'varying float vFade;\n' + sh.fragmentShader.replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
  if (vFade < 0.985) {
    ivec2 bp = ivec2(mod(gl_FragCoord.xy, 4.0));
    int bi = bp.x + bp.y * 4;
    float bt = float(bi == 0 ? 0 : bi == 1 ? 8 : bi == 2 ? 2 : bi == 3 ? 10 : bi == 4 ? 12 : bi == 5 ? 4 : bi == 6 ? 14 : bi == 7 ? 6 :
      bi == 8 ? 3 : bi == 9 ? 11 : bi == 10 ? 1 : bi == 11 ? 9 : bi == 12 ? 15 : bi == 13 ? 7 : bi == 14 ? 13 : 5) / 16.0 + 0.03;
    if (vFade < bt) discard;
  }`);
    };
    m.customProgramCacheKey = () => 'bld-merged-dither';
    buildingMesh = new THREE.Mesh(mergeBoxes(bGeos), m);
    buildingMesh.castShadow = true; buildingMesh.receiveShadow = true; buildingMesh.name = 'buildings';
    root.add(buildingMesh);
    syncFade = () => {
      let dirty = false;
      for (const b of buildings) {
        const v = Math.round(Math.max(0, Math.min(1, b.material.opacity)) * 255), i = b.userData.block * 4;
        if (fadeData[i] !== v) { fadeData[i] = v; dirty = true; }
      }
      if (dirty) fadeTex.needsUpdate = true;
    };
  }

  // Forests (instanced trees).
  const treeCells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (map.grid[r * cols + c] === T.FOREST && ((c * 31 + r * 17) % 3 !== 0)) treeCells.push([c, r]);
  if (treeCells.length) {
    const cone = new THREE.ConeGeometry(0.9, 2.4, 6); cone.translate(0, 2.0, 0);
    const trunk = new THREE.CylinderGeometry(0.15, 0.2, 0.9, 5); trunk.translate(0, 0.45, 0);
    const imT = new THREE.InstancedMesh(cone, new THREE.MeshStandardMaterial({ color: 0x2f5a2c, flatShading: true }), treeCells.length);
    const imK = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x5a4029 }), treeCells.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    treeCells.forEach(([c, r], i) => {
      const k = ((c * 7 + r * 13) % 10) / 10;
      s.setScalar(0.8 + k * 0.6);
      p.set(c * CELL + 1 + (k - 0.5), map.height[r * cols + c], r * CELL + 1 + (0.5 - k));
      m.compose(p, q, s);
      imT.setMatrixAt(i, m); imK.setMatrixAt(i, m);
    });
    imT.castShadow = imK.castShadow = true;
    root.add(imT, imK);
  }

  // Decorative districts from the Blender map tiles (outside the play area).
  for (const d of map.decor) {
    if (!hasGLB(d.model)) continue;
    const { object } = makeModel(d.model, 110 * (d.scale || 1));
    object.position.set(d.x, -0.55, d.z);
    object.rotation.y = d.rot || 0;
    object.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    root.add(object);
  }

  // Play-area border.
  const border = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(map.w, 0.01, map.h)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }));
  border.position.set(map.w / 2, 0.05, map.h / 2);
  root.add(border);

  return { root, ground, buildings, buildingMesh, syncFade, water: root.userData.water };
}

function mergeBoxes(geos) {
  let total = 0; for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  const col = new Float32Array(total * 3), blk = new Float32Array(total);
  const idx = []; let off = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, off * 3);
    nor.set(g.attributes.normal.array, off * 3);
    const { wall, roof, block = 0 } = g.userData || {};
    // Walls: UVs scaled by height so the window texture repeats per ~1.5 m floor. Roofs: a solid texel (no windows).
    const uvs = g.attributes.uv.array, p = g.attributes.position.array, n = g.attributes.normal.array;
    let maxY = 0; for (let i = 1; i < p.length; i += 3) maxY = Math.max(maxY, p[i]);
    for (let i = 0; i < g.attributes.uv.count; i++) {
      const o = off + i, top = n[i * 3 + 1] > 0.5;
      if (top) { uv[o * 2] = 0.03; uv[o * 2 + 1] = 0.97; } else { uv[o * 2] = uvs[i * 2]; uv[o * 2 + 1] = uvs[i * 2 + 1] * Math.max(1, maxY / 1.5); }
      const c = top ? roof : wall;
      col[o * 3] = c ? c.r : 1; col[o * 3 + 1] = c ? c.g : 1; col[o * 3 + 2] = c ? c.b : 1;
      blk[o] = block;
    }
    for (const i of g.index.array) idx.push(i + off);
    off += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('aBlock', new THREE.BufferAttribute(blk, 1));
  out.setIndex(idx);
  return out;
}

// Light facade with 2 windows per cell width and floor (readable at strategic zoom, QA #20).
function windowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#f2efe8'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(0, 60, 64, 4);          // floor line
  g.fillStyle = '#8fa2b0';
  for (const x of [12, 40]) g.fillRect(x, 22, 12, 22);
  g.fillStyle = 'rgba(255,255,255,0.35)';
  for (const x of [12, 40]) g.fillRect(x, 22, 12, 4);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

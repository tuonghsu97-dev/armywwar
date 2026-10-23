// Batched overlays (perf, QA #10): every HP bar + intent icon of the match in ONE instanced draw call
// (camera-facing quads reading a small atlas), team rings under units in two instanced draws.
// Used by render/world.js; rebuilt each frame with begin()/push()/end().
import * as THREE from 'three';

const CELL = 64, GRID = 8;

export class BillboardBatch {
  // glyphs: { key: text } drawn into the atlas (cell 0 = solid white for bars).
  constructor(glyphs, capacity = 1024) {
    this.slots = new Map();
    this.tex = makeAtlas(glyphs, this.slots);
    this.cap = 0;
    this.mesh = null;
    this.alloc(capacity);
    this.n = 0;
  }

  alloc(cap) {
    const old = this.mesh;
    this.cap = cap;
    const g = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1);
    g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.aUV = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    for (const a of [this.aPos, this.aSize, this.aCol, this.aUV]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iSize', this.aSize); g.setAttribute('iColor', this.aCol); g.setAttribute('iUV', this.aUV);
    g.instanceCount = 0;
    const mat = old ? old.material : new THREE.ShaderMaterial({
      uniforms: { map: { value: this.tex } },
      transparent: true, depthTest: false, depthWrite: false,
      vertexShader: `attribute vec3 iPos; attribute vec2 iSize; attribute vec4 iColor; attribute vec4 iUV;
        varying vec2 vUv; varying vec4 vColor;
        void main() {
          vec4 mv = viewMatrix * vec4(iPos, 1.0);
          mv.xy += position.xy * iSize;
          vUv = mix(iUV.xy, iUV.zw, uv); vColor = iColor;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform sampler2D map; varying vec2 vUv; varying vec4 vColor;
        void main() {
          vec4 t = texture2D(map, vUv);
          gl_FragColor = vec4(t.rgb * vColor.rgb, t.a * vColor.a);
          if (gl_FragColor.a < 0.01) discard;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.mesh.name = 'hud-billboards';
    if (old) { const p = old.parent; p?.remove(old); old.geometry.dispose(); p?.add(this.mesh); }
  }

  begin() { this.n = 0; }
  // Quad centred at (x,y,z) of w×h world units; color = THREE.Color (linear), key = atlas glyph or null (solid).
  push(x, y, z, w, h, color, alpha = 1, key = null) {
    if (this.n >= this.cap) { const keep = this.snapshot(); this.alloc(this.cap * 2); this.restore(keep); }
    const i = this.n++, uv = this.slots.get(key) || this.slots.get(null);
    this.aPos.array.set([x, y, z], i * 3);
    this.aSize.array[i * 2] = w; this.aSize.array[i * 2 + 1] = h;
    const c = this.aCol.array; c[i * 4] = color.r; c[i * 4 + 1] = color.g; c[i * 4 + 2] = color.b; c[i * 4 + 3] = alpha;
    this.aUV.array.set(uv, i * 4);
  }
  snapshot() { return [this.aPos.array.slice(), this.aSize.array.slice(), this.aCol.array.slice(), this.aUV.array.slice(), this.n]; }
  restore([p, s, c, u, n]) { this.aPos.array.set(p); this.aSize.array.set(s); this.aCol.array.set(c); this.aUV.array.set(u); this.n = n; }
  end() {
    const g = this.mesh.geometry;
    g.instanceCount = this.n;
    for (const a of [this.aPos, this.aSize, this.aCol, this.aUV]) { a.clearUpdateRanges(); a.addUpdateRange(0, this.n * a.itemSize); a.needsUpdate = true; }
  }
  dispose() { this.mesh.parent?.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.tex.dispose(); }
}

function makeAtlas(glyphs, slots) {
  const c = document.createElement('canvas'); c.width = c.height = CELL * GRID;
  const g = c.getContext('2d');
  const uvOf = (i, inset = 0) => {
    const cx = i % GRID, cy = Math.floor(i / GRID);
    return [(cx + inset) / GRID, 1 - (cy + 1 - inset) / GRID, (cx + 1 - inset) / GRID, 1 - (cy + inset) / GRID];
  };
  g.fillStyle = '#fff'; g.fillRect(0, 0, CELL, CELL);
  slots.set(null, uvOf(0, 0.3));
  let i = 1;
  for (const [key, text] of Object.entries(glyphs)) {
    if (i >= GRID * GRID) break;
    const x = (i % GRID) * CELL, y = Math.floor(i / GRID) * CELL;
    g.fillStyle = 'rgba(15,20,24,0.78)'; g.beginPath(); g.arc(x + 32, y + 32, 28, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,200,90,0.9)'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#ffd27a'; g.font = 'bold 34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, x + 32, y + 34);
    slots.set(key, uvOf(i, 0.02));
    i++;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;
  return t;
}

// Flat team rings under units: one InstancedMesh per opacity level.
export class RingBatch {
  constructor(opacity, capacity = 512) {
    this.opacity = opacity;
    this.geo = new THREE.RingGeometry(0.9, 1, 40).rotateX(-Math.PI / 2);
    this.mat = new THREE.MeshBasicMaterial({ transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    this.alloc(capacity);
    this.m = new THREE.Matrix4();
  }
  alloc(cap) {
    const old = this.mesh;
    this.cap = cap;
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.name = 'team-rings';
    if (old) { const p = old.parent; p?.remove(old); old.dispose(); p?.add(this.mesh); }
    this.n = 0;
  }
  begin() { this.n = 0; }
  push(x, y, z, r, color) {
    if (this.n >= this.cap) {
      const mats = this.mesh.instanceMatrix.array.slice(), cols = this.mesh.instanceColor.array.slice(), n = this.n;
      this.alloc(this.cap * 2); this.mesh.instanceMatrix.array.set(mats); this.mesh.instanceColor.array.set(cols); this.n = n;
    }
    this.m.makeScale(r, 1, r).setPosition(x, y, z);
    this.mesh.setMatrixAt(this.n, this.m);
    this.mesh.setColorAt(this.n, color);
    this.n++;
  }
  end() { this.mesh.count = this.n; this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true; }
  dispose() { this.mesh.parent?.remove(this.mesh); this.mesh.dispose(); this.geo.dispose(); this.mat.dispose(); }
}

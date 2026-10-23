// Pooled GPU particles for battlefield effects.
// OWNER: graphics/fx agent
import * as THREE from 'three';

const VERTEX = `
uniform float uTime, uViewportH;
attribute vec3 aVel, aColor0, aColor1, aPhys;
attribute float aBirth, aLife, aShape;
attribute vec2 aSize, aAlpha;
varying vec3 vColor;
varying float vAlpha, vShape, vRot, vSeed;
float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  float age = uTime - aBirth;
  float t = age / aLife;
  vColor = vec3(0.0);
  vAlpha = 0.0;
  vShape = aShape;
  vRot = 0.0;
  vSeed = 0.0;
  if (age < 0.0 || t > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  float travel = aPhys.y > 0.0 ? (1.0 - exp(-aPhys.y * age)) / aPhys.y : age;
  vec3 pos = position + aVel * travel + vec3(0.0, -0.5 * aPhys.x * age * age, 0.0);
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float size = mix(aSize.x, aSize.y, 1.0 - (1.0 - t) * (1.0 - t));
  float pixels = size * uViewportH * projectionMatrix[1][1] * 0.5;
  if (projectionMatrix[3][3] == 0.0) pixels /= max(0.0001, -mvPosition.z);
  gl_PointSize = clamp(pixels, 0.0, 256.0);
  vColor = mix(aColor0, aColor1, t);
  vAlpha = mix(aAlpha.x, aAlpha.y, t) * smoothstep(0.0, 0.08, t);
  vRot = aPhys.z * age + hash(aBirth) * 6.28;
  vSeed = hash(aBirth + dot(position, vec3(17.13, 3.71, 9.23)));
}`;

const FRAGMENT = `
varying vec3 vColor;
varying float vAlpha, vShape, vRot, vSeed;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
}
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float c = cos(vRot), s = sin(vRot);
  vec2 q = mat2(c, -s, s, c) * p;
  float r = length(q);
  float mask;
  vec3 color = vColor;
  if (vShape < 0.5) {
    mask = pow(max(0.0, 1.0 - r * r), 2.0);
  } else if (vShape < 1.5) {
    vec2 uv = q * 2.8 + vSeed * 83.7;
    float n = noise(uv) * 0.57 + noise(uv * 2.03) * 0.29 + noise(uv * 4.07) * 0.14;
    mask = 1.0 - smoothstep(0.35 + n * 0.25, 0.7 + n * 0.29, r);
    color *= 0.78 + 0.22 * smoothstep(0.0, 0.7, r);
  } else if (vShape < 2.5) {
    mask = max(1.0 - smoothstep(0.12, 0.22, r), 0.4 * pow(max(0.0, 1.0 - r), 3.0));
  } else {
    mask = 1.0 - step(0.7, max(abs(q.x), abs(q.y)));
  }
  float alpha = vAlpha * mask;
  if (alpha < 0.01) discard;
  // AdditiveBlending already weights by src alpha (SrcAlpha, One).
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const ATTRIBUTES = {
  position: 3, aVel: 3, aBirth: 1, aLife: 1, aSize: 2,
  aColor0: 3, aColor1: 3, aAlpha: 2, aPhys: 3, aShape: 1
};

export class Particles {
  constructor(scene, opts = {}) {
    this.density = opts.quality === 'low' ? 0.5 : 1;
    this.max = Math.max(1, Math.floor((opts.max ?? 4000) * this.density));
    this.time = 0;
    this.scene = scene;
    this.color = new THREE.Color();
    this.burstParams = {};
    this.layers = {};
    for (const name of ['alpha', 'add']) {
      const geometry = new THREE.BufferGeometry();
      for (const [key, size] of Object.entries(ATTRIBUTES)) {
        const array = new Float32Array(this.max * size);
        if (key === 'aBirth') array.fill(-1e6);
        geometry.setAttribute(key, new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage));
      }
      const material = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uViewportH: { value: 800 } },
        defines: name === 'add' ? { ADDITIVE_LAYER: 1 } : {},
        vertexShader: VERTEX, fragmentShader: FRAGMENT,
        blending: name === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending,
        transparent: true, depthWrite: false, depthTest: true, toneMapped: true
      });
      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      points.renderOrder = name === 'alpha' ? 20 : 21;
      this.layers[name] = { points, geometry, material, cursor: 0, dirtyStart: 0, dirtyCount: 0 };
      scene.add(points);
    }
  }

  emit(layer, p) {
    const pool = this.layers[layer];
    if (!pool) throw new Error('Unknown particle layer: ' + layer);
    const i = pool.cursor, a = pool.geometry.attributes;
    a.position.setXYZ(i, p.x, p.y, p.z);
    a.aVel.setXYZ(i, p.vx ?? 0, p.vy ?? 0, p.vz ?? 0);
    a.aBirth.setX(i, this.time + (p.delay ?? 0));
    a.aLife.setX(i, Math.max(0.0001, p.life ?? 1));
    a.aSize.setXY(i, p.size0 ?? 1, p.size1 ?? p.size0 ?? 1);
    this.writeColor(a.aColor0, i, p.color0 ?? 0xffffff);
    this.writeColor(a.aColor1, i, p.color1 ?? p.color0 ?? 0xffffff);
    a.aAlpha.setXY(i, p.alpha0 ?? 1, p.alpha1 ?? 0);
    a.aPhys.setXYZ(i, p.gravity ?? 0, p.drag ?? 0, p.spin ?? 0);
    a.aShape.setX(i, p.shape ?? 0);
    if (pool.dirtyCount === 0) pool.dirtyStart = i;
    pool.dirtyCount = Math.min(this.max, pool.dirtyCount + 1);
    pool.cursor = (i + 1) % this.max;
  }

  writeColor(attribute, i, value) {
    const color = value.isColor ? value : this.color.setHex(value);
    attribute.setXYZ(i, color.r, color.g, color.b);
  }

  burst(layer, n, p) {
    const count = Math.max(1, Math.round(n * this.density));
    const b = this.burstParams;
    for (const key in b) delete b[key];
    Object.assign(b, p);
    for (let i = 0; i < count; i++) {
      const z = Math.random() * 2 - 1, angle = Math.random() * Math.PI * 2;
      const radial = Math.sqrt(1 - z * z);
      const radius = (p.spread ?? 0) * Math.cbrt(Math.random());
      b.x = p.x + radial * Math.cos(angle) * radius;
      b.y = p.y + z * radius;
      b.z = p.z + radial * Math.sin(angle) * radius;
      const y = typeof p.speedY === 'number' ? Math.random() : Math.random() * 2 - 1;
      const azimuth = Math.random() * Math.PI * 2;
      const horizontal = Math.sqrt(1 - y * y) * (p.speed ?? 0);
      b.vx = (p.vx ?? 0) + Math.cos(azimuth) * horizontal;
      b.vz = (p.vz ?? 0) + Math.sin(azimuth) * horizontal;
      b.vy = (p.vy ?? 0) + (typeof p.speedY === 'number'
        ? p.speedY * (0.3 + Math.random() * 0.7) : y * (p.speed ?? 0));
      b.life = (p.life ?? 1) * (1 + (Math.random() * 2 - 1) * (p.lifeJitter ?? 0.3));
      const scale = Math.max(0, 1 + (Math.random() * 2 - 1) * (p.sizeJitter ?? 0.3));
      b.size0 = (p.size0 ?? 1) * scale;
      b.size1 = (p.size1 ?? p.size0 ?? 1) * scale;
      this.emit(layer, b);
    }
  }

  update(time) {
    this.time = time;
    for (const name in this.layers) {
      const pool = this.layers[name];
      pool.material.uniforms.uTime.value = time;
      if (!pool.dirtyCount) continue;
      const first = Math.min(pool.dirtyCount, this.max - pool.dirtyStart);
      const second = pool.dirtyCount - first;
      for (const key in pool.geometry.attributes) {
        const attribute = pool.geometry.attributes[key], size = attribute.itemSize;
        attribute.clearUpdateRanges();
        attribute.addUpdateRange(pool.dirtyStart * size, first * size);
        if (second) attribute.addUpdateRange(0, second * size);
        attribute.needsUpdate = true;
      }
      pool.dirtyCount = 0;
    }
  }

  setViewport(heightPx) {
    for (const name in this.layers) this.layers[name].material.uniforms.uViewportH.value = heightPx;
  }

  dispose() {
    for (const name in this.layers) {
      const pool = this.layers[name];
      pool.points.removeFromParent();
      pool.geometry.dispose();
      pool.material.dispose();
    }
  }
}

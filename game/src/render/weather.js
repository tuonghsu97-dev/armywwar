// GPU rain, drifting fog banks and smoothly blended weather lighting.
// OWNER: graphics/fx agent
import * as THREE from 'three';

const finish = `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;
const particles = `
  attribute vec4 seed;
  uniform vec3 uCenter;
  uniform float uBox, uTime;
`;
const noise = `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float valueNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
      mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
`;

function geometry(count, lines) {
  const n = lines ? count * 2 : count;
  const positions = new Float32Array(n * 3), seeds = new Float32Array(n * 4);
  for (let i = 0; i < count; i++) {
    const x = Math.random(), y = Math.random(), z = Math.random(), w = Math.random();
    for (let j = 0; j < (lines ? 2 : 1); j++) {
      const k = lines ? i * 2 + j : i;
      positions[k * 3 + 1] = j;
      seeds.set([x, y, z, w], k * 4);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
  return g;
}

export class Weather {
  constructor(R, map, opts = {}) {
    this.R = R;
    this.map = map;
    this._kind = 'clear';
    this.wRain = 0;
    this.wFog = 0;
    this.disposed = false;
    this.base = {
      background: R.scene.background, fog: R.scene.fog,
      sun: R.sun?.intensity, hemi: R.hemi?.intensity,
      exposure: R.r.toneMappingExposure,
    };
    this.materials = [];
    const seen = new Set();
    const capture = mesh => {
      const list = Array.isArray(mesh?.material) ? mesh.material : [mesh?.material];
      for (const material of list) {
        if (!material?.isMeshStandardMaterial || seen.has(material)) continue;
        seen.add(material);
        this.materials.push({ material, roughness: material.roughness, color: material.color.clone() });
      }
    };
    capture(R.world?.ground);
    for (const mesh of R.world?.buildings || []) capture(mesh);
    capture(R.world?.buildingMesh); // merged city blocks (terrain.js)
    this.skyClear = new THREE.Color('#9fb6c6');
    this.skyRain = new THREE.Color('#66737d');
    this.skyFog = new THREE.Color('#b9c4c9');
    this.sky = this.skyClear.clone();
    this.fog = new THREE.Fog(this.sky, 1e4, 2e4);
    R.scene.background = this.sky;
    R.scene.fog = this.fog;
    this.root = new THREE.Group();
    this.root.name = 'weather';
    R.scene.add(this.root);
    this.bufferSize = new THREE.Vector2();
    this.uniforms = {
      uCenter: { value: new THREE.Vector3() }, uBox: { value: 1 },
      uTime: { value: 0 }, uAmount: { value: 0 }, uViewport: { value: 1 },
    };
    const low = opts.quality === 'low';
    const rainMaterial = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      blending: THREE.NormalBlending,
      vertexShader: `${particles}
        void main() {
          float speed = mix(22.0, 34.0, seed.w);
          float y = mod(seed.y * 40.0 - uTime * speed, 40.0);
          vec2 xz = uCenter.xz + (fract(seed.xz + vec2(-0.013, 0.006) * uTime) - 0.5) * uBox;
          vec3 p = vec3(xz.x, y, xz.y) + position.y * vec3(0.38, -1.4, -0.16);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `uniform float uAmount;
        void main() {
          gl_FragColor = vec4(0.72, 0.84, 0.95, 0.35 * uAmount);
          ${finish}
        }`,
    });
    this.rain = new THREE.LineSegments(geometry(low ? 1500 : 4000, true), rainMaterial);
    this.rain.frustumCulled = false;
    this.root.add(this.rain);
    const splashMaterial = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      blending: THREE.NormalBlending,
      vertexShader: `${particles}
        uniform float uViewport;
        varying float vAge;
        void main() {
          vAge = fract(uTime * 2.0 + seed.w);
          vec2 xz = uCenter.xz + (fract(seed.xz) - 0.5) * uBox;
          vec3 p = vec3(xz.x, 0.15, xz.y);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = max(1.0, 0.9 * uViewport * projectionMatrix[1][1] * 0.5);
        }`,
      fragmentShader: `uniform float uAmount;
        varying float vAge;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float radius = mix(0.06, 0.44, vAge);
          float ring = 1.0 - smoothstep(0.015, 0.045, abs(d - radius));
          gl_FragColor = vec4(0.72, 0.84, 0.95, ring * (1.0 - vAge) * 0.4 * uAmount);
          ${finish}
        }`,
    });
    this.splashes = new THREE.Points(geometry(low ? 200 : 600, false), splashMaterial);
    this.splashes.frustumCulled = false;
    this.root.add(this.splashes);
    this.banks = [];
    const bankGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (let i = 0; i < (low ? 1 : 3); i++) {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: this.uniforms.uTime, uAmount: { value: 0 },
          uColor: { value: this.fog.color }, uLayer: { value: i },
        },
        transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
        vertexShader: `varying vec2 vUV, vWorld;
          void main() {
            vUV = uv;
            vec4 p = modelMatrix * vec4(position, 1.0);
            vWorld = p.xz;
            gl_Position = projectionMatrix * viewMatrix * p;
          }`,
        fragmentShader: `${noise}
          uniform float uTime, uAmount, uLayer;
          uniform vec3 uColor;
          varying vec2 vUV, vWorld;
          void main() {
            vec2 drift = vec2(cos(uLayer * 2.1), sin(uLayer * 2.1 + 0.7));
            vec2 p = vWorld * 0.035 + drift * uTime * 0.025 + uLayer * 17.0;
            float f = 0.0, a = 0.5;
            for (int i = 0; i < ${low ? 2 : 4}; i++) {
              f += a * valueNoise(p);
              p = p * 2.03 + vec2(5.2, 1.3);
              a *= 0.5;
            }
            float edge = 1.0 - smoothstep(0.28, 0.5, max(abs(vUV.x - 0.5), abs(vUV.y - 0.5)));
            gl_FragColor = vec4(uColor, smoothstep(0.38, 0.8, f) * edge * 0.24 * uAmount);
            ${finish}
          }`,
      });
      const bank = new THREE.Mesh(bankGeometry, material);
      bank.position.y = [1.5, 3.5, 6][i];
      bank.renderOrder = 30;
      bank.frustumCulled = false;
      this.banks.push(bank);
      this.root.add(bank);
    }
    this.flashAge = -1;
    this.nextLightning = 8 + Math.random() * 12;
    this.set('clear', true);
  }

  get kind() { return this._kind; }

  set(kind, instant = false) {
    if (this.disposed) return;
    if (kind !== 'clear' && kind !== 'rain' && kind !== 'fog') return;
    this._kind = kind;
    if (instant) {
      this.wRain = kind === 'rain' ? 1 : 0;
      this.wFog = kind === 'fog' ? 1 : 0;
      this.flashAge = -1;
      this.update(0, this.uniforms.uTime.value);
    }
  }

  update(dt, time) {
    if (this.disposed) return;
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const ease = 1 - Math.exp(-dt * 1.6);
    this.wRain += ((this._kind === 'rain' ? 1 : 0) - this.wRain) * ease;
    this.wFog += ((this._kind === 'fog' ? 1 : 0) - this.wFog) * ease;
    const rain = this.wRain, fog = this.wFog, clear = Math.max(0, 1 - rain - fog);
    const R = this.R, h = R.viewH;
    this.uniforms.uTime.value = Number.isFinite(time) ? time : this.uniforms.uTime.value + dt;
    this.uniforms.uCenter.value.copy(R.target);
    this.uniforms.uBox.value = h * 1.6 * Math.max(1, R.aspect || 1);
    this.uniforms.uAmount.value = rain;
    R.r.getDrawingBufferSize(this.bufferSize);
    this.uniforms.uViewport.value = this.bufferSize.y;
    this.rain.visible = this.splashes.visible = rain >= 0.01;
    let flash = 0;
    if (rain > 0.5) {
      this.nextLightning -= dt;
      if (this.nextLightning <= 0) {
        this.flashAge = 0;
        this.nextLightning = 8 + Math.random() * 12;
      }
      if (this.flashAge >= 0) {
        this.flashAge += dt;
        const t = this.flashAge;
        flash = t < 0.055 ? 1 - t / 0.055 : t > 0.095 && t < 0.2 ? 0.7 * (1 - (t - 0.095) / 0.105) : 0;
        if (t >= 0.2) this.flashAge = -1;
      }
    } else this.flashAge = -1;
    this.sky.setRGB(
      this.skyClear.r * clear + this.skyRain.r * rain + this.skyFog.r * fog,
      this.skyClear.g * clear + this.skyRain.g * rain + this.skyFog.g * fog,
      this.skyClear.b * clear + this.skyRain.b * rain + this.skyFog.b * fog,
    );
    this.sky.lerpColors(this.sky, this.skyClear, flash * 0.6);
    this.sky.r += flash * 0.35;
    this.sky.g += flash * 0.35;
    this.sky.b += flash * 0.35;
    this.fog.color.copy(this.sky);
    // Keep the playfield readable: fog thickens toward the far (top) edge of the view.
    this.fog.near = clear * 1e4 + rain * (200 - h * 0.05) + fog * (200 - h * 0.35);
    this.fog.far = clear * 2e4 + rain * (200 + h * 2.2) + fog * (200 + h * 1.4);
    if (rain + fog < 0.001) { this.fog.near = 1e4; this.fog.far = 2e4; }
    if (R.sun) R.sun.intensity = this.base.sun * (1 - 0.35 * rain - 0.3 * fog);
    if (R.hemi) R.hemi.intensity = this.base.hemi * (1 - 0.2 * rain + flash * 2.5);
    R.r.toneMappingExposure = this.base.exposure * (1 - 0.04 * rain);
    for (const entry of this.materials) {
      entry.material.roughness = THREE.MathUtils.lerp(entry.roughness, 0.45, rain);
      entry.material.color.copy(entry.color).multiplyScalar(1 - 0.1 * rain);
    }
    for (const bank of this.banks) {
      bank.visible = fog >= 0.01;
      bank.position.x = R.target.x;
      bank.position.z = R.target.z;
      bank.scale.set(h * 2.4, 1, h * 2.4);
      bank.material.uniforms.uAmount.value = fog;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.rain.geometry.dispose();
    this.rain.material.dispose();
    this.splashes.geometry.dispose();
    this.splashes.material.dispose();
    this.banks[0].geometry.dispose();
    for (const bank of this.banks) bank.material.dispose();
    for (const entry of this.materials) {
      entry.material.roughness = entry.roughness;
      entry.material.color.copy(entry.color);
    }
    const R = this.R;
    R.scene.background = this.base.background;
    R.scene.fog = this.base.fog;
    if (R.sun) R.sun.intensity = this.base.sun;
    if (R.hemi) R.hemi.intensity = this.base.hemi;
    R.r.toneMappingExposure = this.base.exposure;
  }
}

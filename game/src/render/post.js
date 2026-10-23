// Adaptive HDR bloom, grading and nightfall post-processing.
// OWNER: graphics/fx agent
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const validQuality = q => q === 'high' || q === 'low';
const unit = v => Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;

export function userQuality() {
  try {
    const q = window.__app?.settings?.quality;
    if (validQuality(q)) return q;
  } catch {}
  try {
    const q = localStorage.getItem('wargrid.quality');
    if (validQuality(q)) return q;
  } catch {}
  return null;
}

export function saveQuality(q) {
  if (!validQuality(q)) return;
  try { localStorage.setItem('wargrid.quality', q); } catch {}
}

export function detectQuality(renderer) {
  const choice = userQuality();
  if (choice) return choice;
  if (renderer.capabilities.isWebGL2 === false) return 'low';
  if (typeof navigator !== 'undefined' && (navigator.hardwareConcurrency || 8) <= 4) return 'low';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    if (/swiftshader|llvmpipe|software|mali|adreno \(tm\) [1-5]|powervr|intel.*hd graphics( [0-9]{3,4})?\b(?!.*iris)/i.test(gpu)) return 'low';
  } catch {}
  return 'high';
}

const gradeShader = {
  name: 'WargridGrade',
  uniforms: {
    tDiffuse: { value: null },
    uFlash: { value: 0 },
    uDarkness: { value: 0 },
    uTime: { value: 0 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uFlash;
    uniform float uDarkness;
    uniform float uTime;
    varying vec2 vUv;
    void main() {
      vec4 source = texture2D(tDiffuse, vUv);
      vec3 color = source.rgb;
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, 1.06);
      color = (color - 0.18) * 1.04 + 0.18;
      vec2 p = (vUv - 0.5) * vec2(1.8, 2.0);
      float edge = smoothstep(0.12, 1.45, dot(p, p));
      color *= 1.0 - edge * (0.28 + uDarkness * 0.52);
      color *= 1.0 - uDarkness * 0.12;
      float grain = fract(sin(dot(gl_FragCoord.xy,
        vec2(12.9898, 78.233)) + floor(uTime * 30.0) * 37.719) * 43758.5453) - 0.5;
      color += grain * 0.018 * uDarkness;
      color += vec3(1.0, 0.65, 0.3) * uFlash * 0.65;
      // OutputPass performs tone mapping and color conversion once.
      gl_FragColor = vec4(max(color, vec3(0.0)), source.a);
    }
  `
};

export class PostFX {
  constructor(renderer, scene, camera, opts = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.auto = opts.auto ?? true;
    this._size = renderer.getSize(new THREE.Vector2());
    this._composer = null;
    this._renderPass = null;
    this._grade = null;
    this._quality = null;
    this._time = 0;
    this._flash = 0;
    this._darkness = 0;
    this._darknessTarget = 0;
    this._disposed = false;
    this.setQuality(validQuality(opts.quality) ? opts.quality : detectQuality(renderer));
  }

  get quality() { return this._quality; }

  setQuality(q) {
    if (!validQuality(q) || this._disposed) return;
    this._warmup = 0;
    this._slowTime = 0;
    this._average = 0;
    if (q === this._quality) return;
    this._destroyComposer();
    this._quality = q;
    this._flash = 0;
    if (q === 'low') return;
    const w = this._size.x, h = this._size.y;
    const pr = this.renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, {
      type: THREE.HalfFloatType, samples: 4
    });
    const composer = this._composer = new EffectComposer(this.renderer, rt);
    // Normalize CSS dimensions before adding passes to avoid DPR being applied twice.
    composer.setSize(w, h);
    this._renderPass = new RenderPass(this.scene, this.camera);
    composer.addPass(this._renderPass);
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.45, 0.35, 0.9));
    this._grade = new ShaderPass(gradeShader);
    this._grade.material.toneMapped = false;
    composer.addPass(this._grade);
    composer.addPass(new OutputPass());
    this.setSize(w, h);
  }

  setSize(w, h) {
    if (this._disposed) return;
    this._size.set(Math.max(1, w), Math.max(1, h));
    if (!this._composer) return;
    this._composer.setPixelRatio(this.renderer.getPixelRatio());
    this._composer.setSize(this._size.x, this._size.y);
  }

  setCamera(camera) {
    this.camera = camera;
    if (this._renderPass) this._renderPass.camera = camera;
  }

  setFlash(v) {
    if (this._quality === 'high') this._flash = unit(v);
  }

  setDarkness(v) { this._darknessTarget = unit(v); }

  render(dt) {
    if (this._disposed) return;
    const step = Number.isFinite(dt) && dt > 0 && dt <= 0.25 ? dt : 0;
    this._time += step;
    this._darkness += (this._darknessTarget - this._darkness) * (1 - Math.exp(-step * 7));
    if (step > 0 && this.auto && this._quality === 'high' && userQuality() === null) {
      this._average = this._average ? this._average + 0.05 * (step - this._average) : step;
      this._warmup += step;
      if (this._warmup > 5) {
        this._slowTime = this._average > 0.024 ? this._slowTime + step : 0;
        if (this._slowTime >= 4) {
          this.setQuality('low');
          console.info('WARGRID: post-processing switched to low quality to improve frame rate.');
        }
      }
    }
    if (this._composer) {
      const uniforms = this._grade.uniforms;
      uniforms.uTime.value = this._time;
      uniforms.uFlash.value = this._flash;
      uniforms.uDarkness.value = this._darkness;
      this._composer.render(step);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    this._flash = Math.max(0, this._flash - step * 4);
  }

  _destroyComposer() {
    if (!this._composer) return;
    for (const pass of this._composer.passes) {
      // r186 bloom omits its luminance filter from dispose().
      if (pass instanceof UnrealBloomPass) pass.materialHighPassFilter.dispose();
      pass.dispose();
    }
    this._composer.dispose();
    this._composer.timer?.dispose();
    this._composer = null;
    this._renderPass = null;
    this._grade = null;
  }

  dispose() {
    this._destroyComposer();
    this._disposed = true;
  }
}

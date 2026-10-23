// Shared animated unit variants and special ability effect materials.
// OWNER: graphics/fx agent
import * as THREE from 'three';

export const fxUniforms = { uTime: { value: 0 } };
const variants = new Map();
const strengths = { normal: 0.55, selected: 1.6, stealth: 1, jammed: 0.6, xray: 1 };

export function unitVariant(material, side, mode, teamColorHex) {
  const key = `${material.uuid}:${side}:${mode}`;
  if (variants.has(key)) return variants.get(key);
  if (!(mode in strengths)) throw new Error(`Unknown unit FX mode: ${mode}`);
  const clone = material.clone();
  clone.userData = { ...material.userData };
  if (mode === 'stealth' || mode === 'xray') {
    clone.transparent = true;
    clone.depthWrite = false;
    clone.alphaTest = 0;
    clone.alphaHash = false;
    clone.alphaToCoverage = false;
  }
  // X-ray: drawn only where another surface is >3 units in front of the unit (buildings, hills, trees).
  if (mode === 'xray') { clone.depthTest = true; clone.depthFunc = THREE.GreaterDepth; clone.side = THREE.FrontSide; }
  const uniforms = {
    uTime: fxUniforms.uTime,
    uRimColor: { value: new THREE.Color(teamColorHex) },
    uRimStrength: { value: strengths[mode] },
  };
  clone.customProgramCacheKey = () => 'ufx-' + mode;
  clone.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    const world = mode === 'stealth' || mode === 'jammed';
    const declarations = `uniform float uTime;
uniform vec3 uRimColor;
uniform float uRimStrength;
${world ? 'varying vec3 vUfxWorld;' : ''}\n`;
    shader.vertexShader = declarations + shader.vertexShader;
    shader.fragmentShader = declarations + shader.fragmentShader;
    let displacement = '';
    if (mode === 'stealth') displacement = `
transformed += normalize(objectNormal) * (0.03 * sin(transformed.y * 12.0 + uTime * 6.0));`;
    if (mode === 'jammed') displacement = `
float ufxTick = floor(uTime * 12.0);
float ufxBurst = step(0.7, fract(sin(ufxTick * 127.1) * 43758.5453));
vec2 ufxJitter = fract(sin(vec2(ufxTick + 1.0, ufxTick + 9.0) * vec2(71.7, 93.3)) * 43758.5453) * 2.0 - 1.0;
transformed.xz += ufxJitter * (0.15 * ufxBurst);`;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `${displacement}
#include <project_vertex>
${world ? 'vUfxWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;' : ''}
${mode === 'xray' ? 'gl_Position.z += projectionMatrix[2][2] * 3.0 * gl_Position.w;' : ''}`);
    let light = 'outgoingLight += uRimColor * ufxRim;';
    let alpha = '';
    if (mode === 'stealth') {
      light = `float ufxBand = 0.5 + 0.5 * sin(vUfxWorld.y * 12.0 + uTime * 6.0);
outgoingLight = mix(outgoingLight * 0.3, vec3(0.6, 0.9, 1.0) * 1.5, ufxRim);
outgoingLight += vec3(0.12, 0.3, 0.4) * pow(ufxBand, 8.0);`;
      alpha = 'gl_FragColor.a = 0.12 + 0.55 * ufxRim;';
    }
    if (mode === 'jammed') light += `
float ufxScan = pow(0.5 + 0.5 * sin(vUfxWorld.y * 35.0 + uTime * 24.0), 12.0);
outgoingLight += vec3(0.7, 0.3, 1.0) * ufxScan * (0.3 + 0.7 * step(0.7, fract(sin(floor(uTime * 12.0) * 127.1) * 43758.5453)));`;
    if (mode === 'xray') {
      light = 'outgoingLight = uRimColor;';
      alpha = 'gl_FragColor.a = 0.35 + 0.4 * ufxRim;';
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
vec3 ufxVd = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
float ufxRim = pow(1.0 - saturate(dot(normal, ufxVd)), 2.5) * uRimStrength;
${mode === 'selected' ? 'ufxRim *= 0.9 + 0.1 * sin(uTime * 2.0);' : ''}
${light}
#include <opaque_fragment>
${alpha}`);
    if (mode === 'xray') {
      shader.vertexShader = 'varying vec3 vUfxNormal;\n' + shader.vertexShader.replace(
        '#include <defaultnormal_vertex>',
        '#include <defaultnormal_vertex>\nvUfxNormal = transformedNormal;'
      );
      shader.fragmentShader = `${declarations}
varying vec3 vUfxNormal;
varying vec3 vViewPosition;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec3 vd = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
  float rim = pow(1.0 - saturate(dot(normalize(vUfxNormal), vd)), 2.5) * uRimStrength;
  gl_FragColor = vec4(uRimColor, 0.35 + 0.4 * rim);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
    }
  };
  variants.set(key, clone);
  return clone;
}

export function disposeVariants() {
  for (const material of variants.values()) material.dispose();
  variants.clear();
}

const vertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const domeVertex = `
varying vec2 vUv;
varying vec3 vFxNormal;
varying vec3 vFxView;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFxNormal = normalMatrix * normal;
  vFxView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const common = `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uColor;
varying vec2 vUv;
const float PI = 3.14159265359;
const float TAU = 6.28318530718;
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float line(float d, float w) { return 1.0 - smoothstep(w * 0.4, w, abs(d)); }
`;

function effect(colorHex, uniforms, body, { dome = false, normal = false } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: fxUniforms.uTime,
      uColor: { value: new THREE.Color(colorHex) },
      uOpacity: { value: 1 },
      ...uniforms,
    },
    vertexShader: dome ? domeVertex : vertexShader,
    fragmentShader: `${common}
${body}
`,
    transparent: true,
    depthWrite: false,
    blending: normal ? THREE.NormalBlending : THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: true,
  });
}

const finish = `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function ringMaterial(colorHex, opts = {}) {
  return effect(colorHex, {
    uProgress: { value: opts.progress ?? 0 },
    uWidth: { value: opts.width ?? 0.08 },
    uOpacity: { value: opts.opacity ?? 1 },
    uDash: { value: opts.dash ?? 0 },
    uFill: { value: opts.fill ?? 1 },
  }, `uniform float uProgress;
uniform float uFill;
uniform float uWidth;
uniform float uDash;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float progress = clamp(uProgress, 0.0, 1.0);
  float w = max(uWidth, 0.001);
  float d = abs(r - progress);
  float dash = uDash > 0.0 ? smoothstep(-0.2, 0.2, sin(atan(p.y, p.x) * uDash + uTime)) : 1.0;
  float ring = line(d, w) * dash;
  float glow = exp(-d * d / (w * w * 4.0)) * 0.3 * dash;
  float fill = (1.0 - smoothstep(max(0.0, progress - w), progress + 0.001, r)) * 0.07 * uFill;
  float a = (ring + glow + fill) * (1.0 - progress) * (1.0 - smoothstep(0.97, 1.0, r));
  gl_FragColor = vec4(uColor * 1.8, clamp(a * uOpacity, 0.0, 1.0));
${finish}`);
}

export function sonarMaterial(colorHex) {
  return effect(colorHex, {}, `void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float rings = 0.0;
  for (int i = 0; i < 3; i++) {
    float radius = fract(uTime * 0.5 + float(i) / 3.0);
    rings += line(r - radius, 0.025) * (1.0 - radius);
  }
  float angle = mod(atan(p.y, p.x) - uTime * 0.45 + TAU, TAU);
  float wedge = exp(-angle * 7.0) * 0.38;
  float a = (rings + wedge + line(r - 0.94, 0.015) * 0.45) * (1.0 - smoothstep(0.97, 1.0, r));
  gl_FragColor = vec4(uColor * 1.7, clamp(a * uOpacity, 0.0, 1.0));
${finish}`);
}

export function beamMaterial(colorHex) {
  return effect(colorHex, { uIntensity: { value: 3 } }, `uniform float uIntensity;
void main() {
  float y = abs(vUv.y - 0.5) * 2.0;
  float core = exp(-y * y * 180.0);
  float glow = exp(-y * y * 5.0) * (1.0 - smoothstep(0.8, 1.0, y));
  float flicker = 0.9 + 0.1 * sin(uTime * 73.0);
  float pulse = pow(0.5 + 0.5 * sin(vUv.x * 45.0 - uTime * 18.0), 10.0);
  vec3 color = mix(uColor, vec3(1.0), core) * uIntensity * flicker * (1.0 + pulse * 0.3);
  gl_FragColor = vec4(color, clamp((glow + core) * uOpacity, 0.0, 1.0));
${finish}`);
}

export function streakMaterial(colorHex) {
  return effect(colorHex, { uHead: { value: 1 } }, `uniform float uHead;
void main() {
  float head = clamp(uHead, 0.0, 1.0);
  float behind = head - vUv.x;
  float wipe = (1.0 - smoothstep(0.0, 0.015, -behind)) * smoothstep(0.0, 0.02, head);
  float tail = pow(clamp(vUv.x / max(head, 0.001), 0.0, 1.0), 2.0);
  float tip = exp(-behind * behind * 1400.0);
  float y = (vUv.y - 0.5) * 2.0;
  float width = exp(-y * y * 12.0) * (1.0 - smoothstep(0.8, 1.0, abs(y)));
  gl_FragColor = vec4(mix(uColor * 2.0, vec3(3.0), tip), clamp(width * tail * wipe * uOpacity, 0.0, 1.0));
${finish}`);
}

export function domeMaterial(colorHex) {
  return effect(colorHex, {}, `varying vec3 vFxNormal;
varying vec3 vFxView;
void main() {
  vec3 vd = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vFxView);
  float rim = pow(1.0 - abs(dot(normalize(vFxNormal), vd)), 2.5);
  vec2 p = vUv * vec2(48.0, 24.0) + vec2(uTime * 0.12, uTime * 0.18);
  vec2 scale = vec2(1.7320508, 3.0);
  vec2 a = mod(p, scale) - scale * 0.5;
  vec2 b = mod(p - scale * 0.5, scale) - scale * 0.5;
  vec2 h = dot(a, a) < dot(b, b) ? a : b;
  h = abs(h);
  float edge = max(h.x, dot(h, vec2(0.5, 0.8660254)));
  float grid = smoothstep(0.77, 0.85, edge);
  float aGlow = (0.04 + rim * 0.5 + grid * 0.14) * uOpacity;
  gl_FragColor = vec4(uColor * (1.2 + rim * 1.8 + grid * 0.5), clamp(aGlow, 0.0, 1.0));
${finish}`, { dome: true });
}

export function noiseZoneMaterial() {
  return effect(0x000000, {}, `void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float mask = 1.0 - smoothstep(0.7, 1.0, length(p));
  float tick = floor(uTime * 24.0);
  float noise = hash21(floor(vUv * 320.0) + tick);
  float glitch = step(0.97, hash21(vec2(floor(vUv.y * 90.0), tick)));
  vec3 color = vec3(noise * 0.065 + glitch * 0.11);
  float a = min(0.65, (0.53 + noise * 0.08 + glitch * 0.04) * max(uOpacity, 0.0)) * mask;
  gl_FragColor = vec4(color, a);
${finish}`, { normal: true });
}

export function warnMaterial(colorHex) {
  return effect(colorHex, { uProgress: { value: 0 } }, `uniform float uProgress;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float angle = atan(p.y, p.x);
  float progress = clamp(uProgress, 0.0, 1.0);
  float blink = 0.55 + 0.45 * pow(0.5 + 0.5 * sin(uTime * 8.0), 2.0);
  float outer = line(r - 0.91, 0.025);
  float axis = min(abs(p.x), abs(p.y));
  float ticks = line(axis, 0.025) * smoothstep(0.43, 0.46, r) * (1.0 - smoothstep(0.66, 0.69, r));
  float cross = line(axis, 0.012) * (1.0 - smoothstep(0.12, 0.16, r));
  float dashed = line(r - mix(0.8, 0.08, progress), 0.025) * smoothstep(-0.1, 0.2, sin(angle * 16.0 - uTime * 2.0));
  float fill = (1.0 - smoothstep(0.0, 0.88, r)) * (0.06 + 0.12 * blink);
  float a = (outer * blink + ticks + cross + dashed + fill) * (1.0 - smoothstep(0.97, 1.0, r));
  gl_FragColor = vec4(uColor * (1.5 + blink), clamp(a * uOpacity, 0.0, 1.0));
${finish}`);
}

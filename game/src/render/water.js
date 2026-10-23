// Animated coastal water with weather, foam and submerged silhouettes.
// OWNER: graphics/fx agent
import * as THREE from 'three';

export function bakeWaterTexture(map) {
  const { cols, rows, grid } = map;
  const count = cols * rows, bytes = new Uint8Array(count * 4);
  let depth = new Float32Array(count), land = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const water = grid[i] === 1 || grid[i] === 2;
    depth[i] = grid[i] === 1 ? 1 : grid[i] === 2 ? 0.45 : 0;
    land[i] = water ? 0 : 1;
    bytes[i * 4 + 2] = water ? 255 : 0;
    bytes[i * 4 + 3] = 255;
  }
  const blur = (source, passes) => {
    let dest = new Float32Array(count);
    for (let pass = 0; pass < passes; pass++) {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        let sum = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          sum += source[Math.max(0, Math.min(rows - 1, r + dr)) * cols + Math.max(0, Math.min(cols - 1, c + dc))];
        }
        dest[r * cols + c] = sum / 9;
      }
      const swap = source; source = dest; dest = swap;
    }
    return source;
  };
  depth = blur(depth, 2); land = blur(land, 3);
  for (let i = 0; i < count; i++) {
    bytes[i * 4] = Math.round(depth[i] * 255);
    bytes[i * 4 + 1] = Math.round(land[i] * 255);
  }
  const texture = new THREE.DataTexture(bytes, cols, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.flipY = false;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

const vertexShader = /* glsl */`
varying vec3 vWorldPos;
#include <fog_pars_vertex>
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vec4 mvPosition = viewMatrix * worldPos;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */`
uniform float uTime, uRain, uFogDim, uQuality, uDetail, uOuter;
uniform vec2 uMapSize;
uniform sampler2D uWaterTex;
uniform vec3 uSunDir, uSunColor, uSky;
uniform vec4 uSubs[16];
uniform int uSubCount;
varying vec3 vWorldPos;
#include <fog_pars_fragment>
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
    mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
// Value noise with analytic derivatives: returns (value, d/dx, d/dy).
vec3 noised(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
  float a = hash(i), b = hash(i + vec2(1, 0)), c = hash(i + vec2(0, 1)), d = hash(i + vec2(1, 1));
  return vec3(a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y,
    du * (vec2(b - a, c - a) + (a - b - c + d) * u.yx));
}
void main() {
  vec2 p = vWorldPos.xz;
  vec2 wuv = p / uMapSize;
  vec4 water = texture2D(uWaterTex, wuv);
  if (uOuter > 0.5) {
    // Open sea around the map (bay): deep water, shore foam where the map edge is land.
    vec2 uvc = clamp(wuv, 0.0, 1.0);
    float dOut = length((wuv - uvc) * uMapSize);
    if (dOut < 0.001) discard;
    vec4 edge = texture2D(uWaterTex, uvc);
    water = vec4(1.0 - 0.55 * exp(-dOut * 0.12) * (1.0 - edge.b), (1.0 - edge.b) * 0.6 * exp(-dOut * 0.3), 1.0, 1.0);
  }
  float coverage = smoothstep(0.08, 0.85, water.b) * smoothstep(0.005, 0.12, water.r);
  if (coverage < 0.002) discard;
  float t = uTime;
  // Wave slope from analytic-derivative value noise (no regular sine lattice).
  vec2 slope = noised(p * 0.33 + vec2(t * 0.11, t * 0.05)).yz * 0.33 * 0.2;
  slope += noised(p * 0.71 + vec2(-t * 0.16, t * 0.12) + 13.7).yz * 0.71 * 0.11;
  if (uQuality > 0.5) slope += uDetail * noised(mat2(0.8, -0.6, 0.6, 0.8) * p * 1.9 + vec2(t * 0.35, -t * 0.27) + 41.3).yz * 1.9 * 0.035;
  if (uRain > 0.001) {
    vec2 cell = floor(p * 2.5), f = fract(p * 2.5);
    vec2 center = vec2(hash(cell), hash(cell + 19.7)) * 0.6 + 0.2;
    vec2 delta = f - center;
    float radius = length(delta), phase = fract(t * 1.7 + hash(cell + 6.3));
    float ring = exp(-100.0 * pow(radius - phase * 0.65, 2.0)) * (1.0 - phase);
    slope += delta / max(radius, 0.01) * ring * sin(radius * 65.0 - phase * 42.0) * uRain * 0.19;
  }
  vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float depth = smoothstep(0.12, 0.96, water.r);
  // Linear equivalents of the turquoise and blue palette.
  vec3 color = mix(vec3(0.050, 0.624, 0.565), vec3(0.0034, 0.0356, 0.102), depth);
  color += vec3(0.035, 0.065, 0.055) * (1.0 - smoothstep(0.05, 0.35, water.r));
  float caustic = pow(1.0 - abs(sin(p.x * 2.2 + sin(p.y * 1.9 + t * 0.5) + t * 0.6)), 7.0);
  color += vec3(0.035, 0.075, 0.06) * caustic * (1.0 - depth);
  float wake = 0.0, subMask = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= uSubCount) break;
    vec4 sub = uSubs[i];
    vec2 d = p - sub.xy;
    float size = max(sub.w, 0.05);
    if (dot(d, d) > size * size * 9.0) continue;
    vec2 axis = vec2(cos(sub.z), sin(sub.z));
    vec2 q = vec2(dot(d, axis), dot(d, vec2(-axis.y, axis.x))) / size;
    float ellipse = length(q / vec2(0.5, 0.14));
    subMask = max(subMask, 1.0 - smoothstep(0.7, 1.2, ellipse));
    float trail = smoothstep(0.0, 0.3, -q.x) * (1.0 - smoothstep(0.5, 2.8, -q.x));
    wake = max(wake, exp(-pow((abs(q.y) + q.x * 0.32) * 30.0, 2.0)) * trail * (0.6 + 0.4 * sin(q.x * 22.0 + t * 2.0)));
  }
  float fresnel = 0.02 + 0.4 * pow(1.0 - max(dot(normal, viewDir), 0.0), 5.0);
  color = mix(color, mix(uSky, color * 1.8 + 0.02, 0.45), fresnel);
  // The sun sits roughly behind the iso camera, so glints use a flattened normal to avoid noisy glitter.
  vec3 halfDir = normalize(uSunDir + viewDir);
  vec3 specN = normalize(vec3(-slope.x * 0.45, 1.0, -slope.y * 0.45));
  float spec = pow(max(dot(specN, halfDir), 0.0), 220.0);
  float sparkle = pow(max(dot(normal, halfDir), 0.0), 900.0) * smoothstep(0.9, 0.99, hash(floor(p * 3.0)));
  color += uSunColor * (spec * 0.35 + sparkle * 0.6) * max(uSunDir.y, 0.0);
  float breakup = noise(p * 1.7 + vec2(t * 0.13, -t * 0.09));
  float bands = smoothstep(0.62, 0.95, sin(water.g * 52.0 - t * 1.7 + breakup * 3.0));
  float coast = smoothstep(0.05, 0.38, water.g);
  // Bands only in a coastal ring (narrow rivers would otherwise be all foam); crisp edge where the water mask ends.
  coast *= 1.0 - smoothstep(0.45, 0.75, water.g);
  float foam = bands * coast * smoothstep(0.4, 0.75, breakup) * 0.45;
  foam += (1.0 - smoothstep(0.4, 0.9, water.b)) * (0.55 + 0.25 * breakup);
  foam += smoothstep(0.88, 0.98, noise(p * 0.8 + t * 0.08)) * smoothstep(0.98, 1.0, sin(dot(p, vec2(2.7, 1.9)) - t)) * depth * 0.3;
  foam = clamp((foam + wake * 0.14) * water.b, 0.0, 0.9);
  float grey = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(color, vec3(grey), uFogDim * 0.45 + uRain * 0.2) * (1.0 - uFogDim * 0.18 - uRain * 0.22);
  // Submerged hulls read as dark shapes above surface glints.
  color = mix(color, vec3(0.004, 0.018, 0.03), subMask * 0.8);
  color = mix(color, vec3(0.82, 0.92, 0.92), foam);
  gl_FragColor = vec4(color, max(mix(mix(0.55, 0.82, depth), 1.0, foam), subMask * 0.85) * coverage);
  #include <fog_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function upgradeWater(mesh, map, opts = {}) {
  const depthTex = bakeWaterTexture(map), previousMaterial = mesh.material;
  const low = opts.quality === 'low', subs = Array.from({ length: 16 }, () => new THREE.Vector4());
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uMapSize: { value: new THREE.Vector2(map.w, map.h) },
    uWaterTex: { value: null }, uSunDir: { value: new THREE.Vector3(0.4, 0.85, 0.3).normalize() },
    uSunColor: { value: new THREE.Color(0xffefd4) }, uSky: { value: new THREE.Color(0x9fb6c6) },
    uSubs: { value: subs }, uSubCount: { value: 0 }, uRain: { value: 0 },
    uFogDim: { value: 0 }, uQuality: { value: low ? 0 : 1 }, uDetail: { value: 1 }, uOuter: { value: opts.outer ? 1 : 0 }
  }]);
  uniforms.uWaterTex.value = depthTex;
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, fog: true, lights: false
  });
  mesh.material = material;
  let lastTime, targetRain = 0, targetFog = 0, disposed = false;
  return {
    material, depthTex,
    setDetail(v) { uniforms.uDetail.value = v; }, // 0..1: fine ripples fade out at far zoom (anti-shimmer)
    update(time, sunDir) {
      if (disposed) return;
      const dt = lastTime === undefined ? 0 : Math.max(0, time - lastTime);
      lastTime = time;
      const ease = 1 - Math.exp(-dt / 1.5);
      uniforms.uTime.value = time;
      if (sunDir) uniforms.uSunDir.value.copy(sunDir);
      uniforms.uRain.value += (targetRain - uniforms.uRain.value) * ease;
      uniforms.uFogDim.value += (targetFog - uniforms.uFogDim.value) * ease;
    },
    setSubs(list) {
      const count = Math.min(list.length, low ? 8 : 16);
      for (let i = 0; i < count; i++) {
        const sub = list[i];
        uniforms.uSubs.value[i].set(sub.x, sub.z, sub.heading, Math.max(0.05, sub.size));
      }
      uniforms.uSubCount.value = count;
    },
    setWeather(kind) {
      targetRain = kind === 'rain' ? 1 : 0;
      targetFog = kind === 'fog' ? 0.65 : kind === 'rain' ? 0.35 : 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (mesh.material === material) mesh.material = previousMaterial;
      material.dispose();
      depthTex.dispose();
    }
  };
}

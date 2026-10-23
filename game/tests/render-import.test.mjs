// Render/FX smoke test (graphics agent): every render module parses; when the 'three' package is resolvable
// from node_modules, also exercises the pure parts (water texture bake, particle pool, shader patch targets).
// Run: node --test tests/render-import.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['fx', 'water', 'weather', 'post', 'particles', 'abilityfx', 'renderer', 'world', 'terrain'].map(f => `src/render/${f}.js`);

test('render modules pass node --check', () => {
  for (const f of FILES) execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' });
});

let THREE = null;
try { THREE = await import('three'); } catch { /* three not installed for Node: parse check only */ }

test('fx modules import and expose their API', { skip: !THREE && 'three not resolvable in Node' }, async () => {
  const fx = await import('../src/render/fx.js');
  assert.equal(typeof fx.FX, 'function');
  const w = await import('../src/render/water.js');
  assert.equal(typeof w.upgradeWater, 'function');
  assert.equal(typeof w.bakeWaterTexture, 'function');
  const we = await import('../src/render/weather.js');
  assert.equal(typeof we.Weather, 'function');
  const po = await import('../src/render/post.js');
  for (const k of ['PostFX', 'detectQuality', 'userQuality', 'saveQuality']) assert.equal(typeof po[k], 'function', k);
  const a = await import('../src/render/abilityfx.js');
  for (const k of ['unitVariant', 'ringMaterial', 'sonarMaterial', 'beamMaterial', 'streakMaterial', 'domeMaterial', 'noiseZoneMaterial', 'warnMaterial']) assert.equal(typeof a[k], 'function', k);
});

test('water texture bake matches the map grid', { skip: !THREE && 'three not resolvable in Node' }, async () => {
  const { bakeWaterTexture } = await import('../src/render/water.js');
  const { buildMap, T } = await import('../src/data/maps.js');
  const map = buildMap('bay');
  const tex = bakeWaterTexture(map);
  assert.equal(tex.image.width, map.cols);
  assert.equal(tex.image.height, map.rows);
  const d = tex.image.data;
  let deepOk = 0, deep = 0;
  for (let i = 0; i < map.grid.length; i++) {
    const water = map.grid[i] === T.DEEP || map.grid[i] === T.SHALLOW;
    assert.equal(d[i * 4 + 2], water ? 255 : 0, 'B = raw water mask');
    if (map.grid[i] === T.DEEP) { deep++; if (d[i * 4] > 128) deepOk++; }
  }
  assert.ok(deep > 0 && deepOk / deep > 0.8, 'deep cells have high depth');
});

test('particle pool emits, wraps and flushes update ranges', { skip: !THREE && 'three not resolvable in Node' }, async () => {
  const { Particles } = await import('../src/render/particles.js');
  const scene = new THREE.Scene();
  const P = new Particles(scene, { max: 64, quality: 'high' });
  assert.equal(scene.children.length, 2);
  for (let i = 0; i < 100; i++) P.emit('add', { x: i, y: 1, z: 0, life: 1 });
  P.burst('alpha', 10, { x: 0, y: 0, z: 0, speed: 3, speedY: 2, life: 2 });
  P.update(1.5);
  const add = P.layers.add.geometry.attributes.position;
  assert.ok(add.updateRanges.length >= 1, 'dirty range uploaded');
  assert.equal(P.layers.add.cursor, 100 % 64, 'ring buffer wraps');
  P.dispose();
  assert.equal(scene.children.length, 0);
});

test('unit material variants patch the standard shader', { skip: !THREE && 'three not resolvable in Node' }, async () => {
  const { unitVariant, disposeVariants, fxUniforms } = await import('../src/render/abilityfx.js');
  const base = new THREE.MeshStandardMaterial({ color: 0x888888 });
  for (const mode of ['normal', 'selected', 'stealth', 'jammed', 'xray']) {
    const m = unitVariant(base, 0, mode, 0x3f8cff);
    assert.notEqual(m, base);
    assert.equal(unitVariant(base, 0, mode, 0x3f8cff), m, 'cached');
    const sh = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    m.onBeforeCompile(sh);
    assert.equal(sh.uniforms.uTime, fxUniforms.uTime, mode + ' shares clock');
    assert.ok(sh.fragmentShader.includes('uRimColor'), mode + ' fragment patched');
    if (mode !== 'xray') assert.ok(sh.fragmentShader.includes('ufxRim'), mode + ' rim injected before opaque_fragment');
  }
  assert.equal(base.transparent, false, 'source material untouched');
  disposeVariants();
});

// Effects director: projectiles per kind, GPU particles (explosions, smoke, sparks, debris, trails, wakes, dust,
// rotor wash, burning wrecks), special systems (stealth shimmer, EW pulses, lasers, interceptions, hypersonic warning,
// ultimates, mines, capture), unit looks (team rim, selection glow, x-ray behind buildings), water, weather, post FX.
// OWNER: graphics/fx agent
import * as THREE from 'three';
import { T, CELL } from '../data/maps.js';
import { Particles } from './particles.js';
import { upgradeWater } from './water.js';
import { Weather } from './weather.js';
import { PostFX, detectQuality } from './post.js';
import {
  fxUniforms, unitVariant, ringMaterial, sonarMaterial, beamMaterial, streakMaterial, domeMaterial, noiseZoneMaterial, warnMaterial,
} from './abilityfx.js';

const TEAM_HEX = [0x3f8cff, 0xff4a3d];
const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _m = new THREE.Matrix4();
// Building fade (F-13): ordered 4x4 Bayer screen-door driven by material.opacity.
const BAYER_FADE = `#include <alphatest_fragment>
  if (opacity < 0.985) {
    ivec2 bp = ivec2(mod(gl_FragCoord.xy, 4.0));
    int bi = bp.x + bp.y * 4;
    float bt = float(bi == 0 ? 0 : bi == 1 ? 8 : bi == 2 ? 2 : bi == 3 ? 10 : bi == 4 ? 12 : bi == 5 ? 4 : bi == 6 ? 14 : bi == 7 ? 6 :
      bi == 8 ? 3 : bi == 9 ? 11 : bi == 10 ? 1 : bi == 11 ? 9 : bi == 12 ? 15 : bi == 13 ? 7 : bi == 14 ? 13 : 5) / 16.0 + 0.03;
    if (opacity < bt) discard;
  }`;
const hdr = (hex, k) =>new THREE.Color(hex).multiplyScalar(k);
const rnd = (a, b) => a + Math.random() * (b - a);
// Accepts a unit/structure/projectile/plain point and returns {x,y,z}.
function pt(o, yDef = 1) {
  if (!o) return null;
  if (typeof o === 'number') return null;
  return { x: o.x ?? 0, y: (o.alt ?? o.y ?? 0) + (o.alt != null ? yDef : 0), z: o.z ?? 0 };
}

export class FX {
  constructor(renderer, game, viewSide = 0, view = null) {
    this.R = renderer; this.game = game; this.side = viewSide; this.view = view;
    this.root = new THREE.Group(); this.root.name = 'fx';
    renderer.scene.add(this.root);
    this.time = 0;
    this.projMeshes = new Map();
    this.effects = [];       // timed mesh effects {obj, life, max, update?(e, t, dt)}
    this.burners = [];       // burning wrecks
    this.timers = [];        // delayed callbacks {at, fn}
    this.zones = [];         // ultimates / persistent areas
    this.unsub = [];

    // Quality + post (the post pipeline lives on the renderer so it survives between matches).
    if (!renderer.post) {
      renderer.post = new PostFX(renderer.r, renderer.scene, renderer.camera, { quality: detectQuality(renderer.r) });
      renderer.resize();
    }
    this.quality = renderer.post.quality;
    const hi = this.quality === 'high';
    if (!hi) { renderer.sun.shadow.mapSize.set(1024, 1024); renderer.r.setPixelRatio(Math.min(window.devicePixelRatio, 1.25)); renderer.resize(); }
    this.P = new Particles(renderer.scene, { max: 7000, quality: this.quality });
    this.water = renderer.world?.water ? upgradeWater(renderer.world.water, game.map, { quality: this.quality }) : null;
    // Open sea outside the play area on the bay map.
    if (game.map.id === 'bay') {
      const m = game.map, sea = new THREE.Mesh(new THREE.PlaneGeometry(m.w * 4, m.h * 5), new THREE.MeshBasicMaterial());
      sea.rotation.x = -Math.PI / 2; sea.position.set(m.w / 2, -0.3, m.h / 2); sea.name = 'open-sea';
      this.root.add(sea);
      this.sea = upgradeWater(sea, m, { quality: this.quality, outer: true });
    }
    this.weather = new Weather(renderer, game.map, { quality: this.quality });
    this.weather.set(game.weather || 'clear', true);
    this.water?.setWeather(game.weather || 'clear');
    this.sea?.setWeather(game.weather || 'clear');
    this.prepBuildings();
    this.xrayOn = (renderer.world?.buildings?.length || 0) > 0; // x-ray silhouettes only where buildings can hide units
    if (view) view.fxStealth = true; // world.js leaves stealth/jam looks to us

    this.geo = {
      quad: new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),   // flat ground quad, radius 1
      strip: new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0),   // beam strip, x 0..1
      shell: new THREE.SphereGeometry(0.16, 6, 4),
      missile: new THREE.CylinderGeometry(0.07, 0.11, 0.9, 6).rotateZ(-Math.PI / 2),
      rocket: new THREE.CylinderGeometry(0.1, 0.1, 0.8, 6).rotateZ(-Math.PI / 2),
      bomb: new THREE.CapsuleGeometry(0.16, 0.5, 2, 6).rotateZ(-Math.PI / 2),
      torpedo: new THREE.CapsuleGeometry(0.1, 0.8, 2, 6).rotateZ(-Math.PI / 2),
      dome: new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      vline: new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -1, 0)]),
    };
    this.mat = {
      shell: new THREE.MeshBasicMaterial({ color: hdr(0xffd890, 4) }),
      missile: new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5 }),
      rocket: new THREE.MeshStandardMaterial({ color: 0xb8a070, roughness: 0.6 }),
      bomb: new THREE.MeshStandardMaterial({ color: 0x2c3034, roughness: 0.6 }),
      torpedo: new THREE.MeshBasicMaterial({ color: 0x0b1820, transparent: true, opacity: 0.5 }),
      vline: [0, 1].map(s => new THREE.LineDashedMaterial({ color: TEAM_HEX[s], dashSize: 0.05, gapSize: 0.035, transparent: true, opacity: 0.55, depthWrite: false })),
    };
    this.shadowTex = blobTexture();

    const on = (n, fn) => this.unsub.push(game.events.on(n, e => { try { fn(e || {}); } catch (err) { console.warn('fx', n, err); } }));
    on('fire', e => this.onFire(e));
    on('explosion', e => this.explode(e.x, e.y ?? 0.3, e.z, e.r || 1, e.type));
    on('intercept', e => this.onIntercept(e));
    on('unit:death', e => this.onUnitDeath(e.unit, e));
    on('structure:destroyed', ({ structure }) => this.onStructureDeath(structure));
    on('laser', e => this.onLaser(e));
    on('jam', e => this.onJam(e));
    on('strike:warn', e => this.onStrikeWarn(e));
    on('strike:impact', e => this.onStrikeImpact(e));
    on('skill', e => this.onSkill(e));
    on('hack', e => e.unit && this.glitchBurst(e.unit));
    on('mine:remove', e => this.removeMine(e));
    on('mine:detonate', e => this.removeMine(e));
    on('ultimate:end', e => { for (const zn of this.zones) if (zn.id === e.id && zn.side === e.side) zn.end = Math.min(zn.end, this.time + 0.6); });
    on('ultimate', e => this.onUltimate(e));
    on('mine', e => this.onMine(e));
    on('capture', e => this.onCapture(e));
    on('weather', e => this.setWeather(e.weather || e.kind || e.type || game.weather));
    on('stealth', e => { const u = e.unit || e; if (u?.x != null && (u.side === viewSide || this.visible(u.x, u.z))) this.shimmerBurst(u); });
  }

  // ---------- helpers ----------
  visible(x, z) {
    const fog = this.game.fog?.[this.side];
    if (!fog) return true;
    const c = Math.floor(x / CELL), r = Math.floor(z / CELL), m = this.game.map;
    return c >= 0 && r >= 0 && c < m.cols && r < m.rows && fog.visible[r * m.cols + c] === 1;
  }
  onScreen(x, z, pad = 20) {
    const R = this.R, h = R.viewH * 0.85 + pad, w = R.viewH * R.aspect * 0.75 + pad;
    return Math.abs(x - R.target.x) < w + h && Math.abs(z - R.target.z) < w + h;
  }
  cellType(x, z) {
    const m = this.game.map, c = Math.floor(x / CELL), r = Math.floor(z / CELL);
    if (c < 0 || r < 0 || c >= m.cols || r >= m.rows) return T.LAND;
    return m.grid[r * m.cols + c];
  }
  isWater(x, z) { const t = this.cellType(x, z); return t === T.DEEP || t === T.SHALLOW; }
  ground(x, z) { const m = this.game.map, c = Math.floor(x / CELL), r = Math.floor(z / CELL); return (c >= 0 && r >= 0 && c < m.cols && r < m.rows) ? Math.max(0, m.height?.[r * m.cols + c] || 0) : 0; }
  after(sec, fn) { this.timers.push({ at: this.time + sec, fn }); }
  add(obj, life, update, extra) { this.root.add(obj); const e = { obj, life, max: life, update, ...extra }; this.effects.push(e); return e; }
  flatQuad(mat, x, y, z, r) { const m = new THREE.Mesh(this.geo.quad, mat); m.position.set(x, y, z); m.scale.setScalar(r); m.renderOrder = 22; m.frustumCulled = false; return m; }
  // Camera-facing strip from a to b (Vector3), width w.
  strip(mat, a, b, w) {
    const m = new THREE.Mesh(this.geo.strip, mat);
    const d = _c.subVectors(b, a), len = d.length() || 0.001;
    const x = d.clone().divideScalar(len);
    const camDir = _v.set(Math.cos(this.R.yaw), Math.tan(THREE.MathUtils.degToRad(50)), Math.sin(this.R.yaw)).normalize();
    const y = new THREE.Vector3().crossVectors(x, camDir).normalize();
    if (y.lengthSq() < 1e-6) y.set(0, 1, 0);
    const z = new THREE.Vector3().crossVectors(x, y);
    m.matrixAutoUpdate = false;
    m.matrix.makeBasis(x, y, z).scale(_a.set(len, w, 1)).setPosition(a);
    m.renderOrder = 23; m.frustumCulled = false;
    return m;
  }
  fadeMat(e, t, peak = 1) { const u = e.obj.material.uniforms; if (u?.uOpacity) u.uOpacity.value = peak * (1 - t); }

  // ---------- firing ----------
  onFire({ from, to, proj }) {
    if (!from || !to || !proj) return;
    if (!this.visible(from.x, from.z) && !this.visible(to.x, to.z)) return;
    if (!this.onScreen(from.x, from.z) && !this.onScreen(to.x, to.z)) return;
    const a = new THREE.Vector3(from.x, (from.alt || 0) + 1, from.z), b = new THREE.Vector3(to.x, (to.alt || 0) + 0.8, to.z);
    // Fog (QA #19): a shooter the viewer cannot see (sub, stealth, out of vision) must not be revealed by its
    // muzzle flash / tracer / beam — only the impact is drawn, and only if the target spot is visible.
    const seen = from.side === this.side || (from.visible ? !!from.visible[this.side] : this.visible(from.x, from.z));
    if (!seen) {
      if (this.visible(to.x, to.z) && (proj.kind === 'bullet' || proj.kind === 'beam')) this.P.burst('add', 3, { x: b.x, y: b.y, z: b.z, speed: 5, life: 0.15, size0: 0.15, color0: hdr(0xffe0a0, 3), alpha1: 0, shape: 2, gravity: 10 });
      return;
    }
    const k = proj.kind, size = from.def?.size || 2;
    if (k === 'beam') {
      if (proj.dmgType === 'emp') this.empBolt(a, b);
      else this.laser(a, b, 0x5ff6ff);
      return;
    }
    if (k === 'bullet') { this.muzzle(a, 0.5, 0xffd27a); this.tracer(a, b, 0xffd27a); return; }
    // Muzzle flash sized by the shooter.
    const flash = k === 'shell' ? 0.6 + size * 0.12 : 0.5;
    if (k !== 'torpedo' && k !== 'bomb') this.muzzle(a, flash, k === 'shell' ? 0xffc070 : 0xffe0a0);
    if (k === 'missile' || k === 'rocket') this.P.burst('alpha', 4, { x: a.x, y: a.y, z: a.z, spread: 0.4, speed: 1.2, life: 1.2, size0: 0.6, size1: 2.2, color0: 0xd8d4cc, color1: 0x8a8680, alpha0: 0.55, alpha1: 0, gravity: -0.6, drag: 1.5, shape: 1, spin: 1 });
    if (k === 'torpedo') this.splash(from.x, from.z, 0.8);
  }
  muzzle(p, s, color) {
    this.P.emit('add', { x: p.x, y: p.y, z: p.z, life: 0.09, size0: s * 1.6, size1: s * 2.2, color0: hdr(color, 4), color1: hdr(0xff6a20, 2), alpha0: 1, alpha1: 0, shape: 0 });
    this.P.burst('add', 3, { x: p.x, y: p.y, z: p.z, speed: 9, life: 0.18, size0: 0.18, size1: 0.05, color0: hdr(0xffe0a0, 3), alpha0: 1, alpha1: 0, drag: 6, shape: 2 });
  }
  tracer(a, b, color) {
    const d = _v.subVectors(b, a), len = d.length(), sp = 120, life = Math.max(0.04, len / sp);
    d.normalize();
    for (let i = 0; i < 3; i++) this.P.emit('add', { x: a.x - d.x * i * 0.35, y: a.y - d.y * i * 0.35, z: a.z - d.z * i * 0.35, vx: d.x * sp, vy: d.y * sp, vz: d.z * sp, life, size0: 0.32 - i * 0.07, color0: hdr(color, 3.5), alpha0: 1, alpha1: 0.8, shape: 2, delay: i * 0.004 });
    this.after(life, () => this.P.burst('add', 2, { x: b.x, y: b.y, z: b.z, speed: 5, life: 0.15, size0: 0.15, color0: hdr(0xffe0a0, 3), alpha1: 0, shape: 2, gravity: 10 }));
  }
  laser(a, b, color, life = 0.32, width = 0.7) {
    const mat = beamMaterial(color);
    const core = this.strip(mat, a, b, width);
    this.add(core, life, (e, t) => this.fadeMat(e, t * t));
    this.muzzle(a, 0.5, color);
    // Heat shimmer + sparks at the target.
    this.P.emit('add', { x: b.x, y: b.y, z: b.z, life: life + 0.1, size0: 1.6, size1: 2.4, color0: hdr(color, 2.5), color1: hdr(0xffffff, 1), alpha0: 0.9, alpha1: 0, shape: 0 });
    this.P.burst('add', 8, { x: b.x, y: b.y, z: b.z, speed: 7, speedY: 6, life: 0.45, size0: 0.22, size1: 0.05, color0: hdr(0xffffff, 3), color1: hdr(color, 2), alpha1: 0, gravity: 14, drag: 2, shape: 2 });
    this.P.burst('alpha', 2, { x: b.x, y: b.y + 0.4, z: b.z, spread: 0.3, life: 0.9, size0: 0.4, size1: 1.5, color0: 0xb8c4c8, alpha0: 0.25, alpha1: 0, gravity: -2, drag: 1, shape: 1 });
  }
  empBolt(a, b) {
    this.laser(a, b, 0xb070ff, 0.25, 0.5);
    const r = this.flatQuad(ringMaterial(0xb070ff), b.x, 0.25, b.z, 3);
    this.add(r, 0.5, (e, t) => { const u = e.obj.material.uniforms; u.uProgress.value = t; u.uOpacity.value = 1 - t; });
  }

  // ---------- explosions ----------
  explode(x, y, z, r, type) {
    if (!this.visible(x, z) || !this.onScreen(x, z, r + 10)) return;
    y = Math.max(y, 0.2);
    const water = (type === 'torpedo' || (y < 0.6 && this.isWater(x, z)));
    if (water) { this.waterBlast(x, z, r); return; }
    const P = this.P, small = r < 1.5, k = small ? 0.5 : 1;
    // Core flash.
    P.emit('add', { x, y: y + 0.3, z, life: 0.14, size0: r * 1.4, size1: r * 3, color0: hdr(0xfff2c8, 6), alpha0: 1, alpha1: 0, shape: 0 });
    // Fireball.
    P.burst('add', (6 + Math.min(10, r * 3)) * k, { x, y: y + r * 0.25, z, spread: r * 0.35, speed: r * 2.2, speedY: r * 2.5, life: 0.55, lifeJitter: 0.4, size0: r * 0.9, size1: r * 1.9, color0: hdr(0xffb347, 3.2), color1: hdr(0xc23a10, 1.2), alpha0: 1, alpha1: 0, drag: 3.5, gravity: -2, shape: 1, spin: 2 });
    // Sparks.
    P.burst('add', (10 + r * 4) * k, { x, y: y + 0.3, z, speed: 8 + r * 4, speedY: 10 + r * 3, life: 0.8, size0: 0.22, size1: 0.06, color0: hdr(0xffe6a0, 4), color1: hdr(0xff5a10, 2), alpha1: 0, gravity: 22, drag: 1.2, shape: 2 });
    // Smoke column.
    P.burst('alpha', (5 + r * 2) * k * k, { x, y: y + 0.5, z, spread: r * 0.5, speed: r * 0.8, speedY: 1.5, life: 2.6, lifeJitter: 0.4, size0: r * 0.8, size1: r * 2.8, color0: 0x3a3632, color1: 0x77726c, alpha0: 0.75, alpha1: 0, gravity: -1.6, drag: 1.1, shape: 1, spin: 0.6, delay: 0.08 });
    // Debris.
    P.burst('alpha', (4 + r * 2) * k * k, { x, y: y + 0.3, z, speed: 4 + r * 2, speedY: 8 + r * 2, life: 1.3, size0: 0.28, size1: 0.22, color0: 0x2a2622, color1: 0x1a1816, alpha0: 1, alpha1: 0.6, gravity: 26, shape: 3, spin: 9 });
    // Ground dust + shock ring on bigger blasts.
    if (y < 2 && !small) P.burst('alpha', 4 + r, { x, y: 0.4, z, spread: r * 0.4, speed: r * 3, life: 1.4, size0: r * 0.6, size1: r * 2, color0: 0x9d8e70, color1: 0xb4a88c, alpha0: 0.45, alpha1: 0, drag: 3, shape: 1, spin: 0.5 });
    if (r >= 2) {
      const ring = this.flatQuad(ringMaterial(0xffd9a0), x, 0.3, z, r * 2.6);
      this.add(ring, 0.55, (e, t) => { const u = e.obj.material.uniforms; u.uProgress.value = Math.sqrt(t); u.uOpacity.value = 1 - t; });
      this.scorch(x, z, r);
    }
    if (r >= 5) this.R.post?.setFlash(Math.min(0.6, r * 0.05));
    if (type === 'intercept') P.burst('add', 10, { x, y, z, speed: 12, life: 0.6, size0: 0.2, color0: hdr(0xbfefff, 4), alpha1: 0, gravity: 9, shape: 2 });
  }
  waterBlast(x, z, r) {
    const P = this.P;
    P.emit('add', { x, y: 0.2, z, life: 0.12, size0: r * 1.2, size1: r * 2, color0: hdr(0xd8f4ff, 3), alpha1: 0, shape: 0 });
    P.burst('alpha', 12 + r * 4, { x, y: 0.1, z, spread: r * 0.3, speed: r * 1.2, speedY: 9 + r * 3, life: 1.3, size0: 0.5 + r * 0.25, size1: 1 + r * 0.6, color0: 0xf4fbff, color1: 0xbcd8e4, alpha0: 0.9, alpha1: 0, gravity: 18, drag: 0.6, shape: 1, spin: 1 });
    this.splash(x, z, r);
  }
  splash(x, z, r) {
    const ring = this.flatQuad(ringMaterial(0xe8fbff), x, 0.05, z, r * 2.2);
    this.add(ring, 1.2, (e, t) => { const u = e.obj.material.uniforms; u.uProgress.value = t; u.uOpacity.value = (1 - t) * 0.8; });
  }
  scorch(x, z, r) {
    if (this.isWater(x, z)) return;
    const m = new THREE.Mesh(this.geo.quad, new THREE.MeshBasicMaterial({ map: this.shadowTex, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.position.set(x, this.ground(x, z) + 0.06, z); m.scale.setScalar(r * 0.9); m.renderOrder = 2;
    // Cap live scorch decals (perf): each is a draw call; the oldest fades out early.
    const sc = this.scorches || (this.scorches = []);
    sc.push(this.add(m, 25, (e, t) => { e.obj.material.opacity = 0.55 * Math.min(1, (1 - t) * 3); }));
    while (sc.length && sc[0].life <= 0) sc.shift();
    if (sc.length > 24) sc.shift().life = 0.01;
  }

  // ---------- deaths / burning wrecks ----------
  onUnitDeath(u, e = {}) {
    if (!u) return;
    // Expended/temporary/sold removals carry a reason flag (e.g. {expended:true}): no wreck.
    if (Object.keys(e).some(k => k !== 'unit' && k !== 'killer' && e[k] === true)) return;
    if (u.side !== this.side && !this.visible(u.x, u.z)) return;
    const r = Math.max(1.5, (u.def?.size || 2) * 0.6);
    this.explode(u.x, (u.alt || 0) + 0.5, u.z, r, 'death');
    if (u.layer === 'sub' || u.def?.group === 'infantry' || u.def?.swarmCount) return;
    const air = u.alt > 1;
    if (air) this.after(1.1, () => this.explode(u.x, 0.4, u.z, r * 0.8, 'crash'));
    this.burner(u.x, u.z, Math.min(3, r * 0.6), air ? 9 : 14, air ? 1.1 : 0);
  }
  onStructureDeath(s) {
    if (!s) return;
    this.explode(s.x, 2, s.z, 6, 'death');
    this.after(0.35, () => this.explode(s.x + rnd(-3, 3), 1.5, s.z + rnd(-3, 3), 3.5, 'death'));
    this.after(0.7, () => this.explode(s.x + rnd(-3, 3), 1.5, s.z + rnd(-3, 3), 3, 'death'));
    this.burner(s.x, s.z, 3.5, 45, 0);
  }
  burner(x, z, size, dur, delay) {
    if (this.burners.length > 40) this.burners.shift();
    this.burners.push({ x, z, size, start: this.time + delay, end: this.time + delay + dur, acc: 0, water: this.isWater(x, z) });
  }
  updateBurners(dt) {
    const P = this.P;
    this.burners = this.burners.filter(b => {
      if (this.time > b.end) return false;
      if (this.time < b.start || !this.visible(b.x, b.z) || !this.onScreen(b.x, b.z)) return true;
      const left = (b.end - this.time) / (b.end - b.start);
      b.acc += dt;
      const rate = 0.09 / Math.max(0.3, left);
      while (b.acc > rate) {
        b.acc -= rate;
        const y = b.water ? 0.1 : this.ground(b.x, b.z) + 0.3;
        P.emit('alpha', { x: b.x + rnd(-0.4, 0.4) * b.size, y, z: b.z + rnd(-0.4, 0.4) * b.size, vx: 0.6 + rnd(-0.3, 0.3), vy: 1.2, vz: 0.3 + rnd(-0.3, 0.3), life: 3.2, size0: b.size * 0.6, size1: b.size * 2.4, color0: 0x1e1c1a, color1: 0x5d5a56, alpha0: 0.6 * Math.min(1, left * 2), alpha1: 0, gravity: -0.5, drag: 0.4, shape: 1, spin: 0.4 });
        if (left > 0.35 && Math.random() < 0.7) P.emit('add', { x: b.x + rnd(-0.3, 0.3) * b.size, y: y + 0.1, z: b.z + rnd(-0.3, 0.3) * b.size, vy: 1.6, life: 0.55, size0: b.size * 0.55, size1: b.size * 0.15, color0: hdr(0xffa040, 3), color1: hdr(0xd03010, 1.5), alpha0: 0.9, alpha1: 0, gravity: -1, shape: 1, spin: 2 });
      }
      return true;
    });
  }

  // ---------- special systems ----------
  onIntercept({ by, proj }) {
    if (!proj) return;
    const x = proj.x, y = proj.y || 6, z = proj.z;
    if (!this.visible(x, z) && !(by && this.visible(by.x, by.z))) return;
    if (by) {
      const a = new THREE.Vector3(by.x, (by.alt || 0) + 1.5, by.z), b = new THREE.Vector3(x, y, z);
      if (by.def?.id === 'laser') this.laser(a, b, 0x5ff6ff, 0.25, 0.5);
      else {
        const s = this.strip(streakMaterial(0xffffff), a, b, 0.35);
        this.add(s, 0.35, (e, t) => { const u = e.obj.material.uniforms; u.uHead && (u.uHead.value = Math.min(1, t * 4)); u.uOpacity.value = 1 - t; });
        this.trail(a, b, 10, 0.9);
      }
    }
    this.P.emit('add', { x, y, z, life: 0.16, size0: 2, size1: 3.5, color0: hdr(0xd8f4ff, 6), alpha1: 0, shape: 0 });
    this.P.burst('add', 14, { x, y, z, speed: 10, life: 0.7, size0: 0.22, size1: 0.06, color0: hdr(0xffeecc, 4), color1: hdr(0xff7a30, 2), alpha1: 0, gravity: 12, drag: 1, shape: 2 });
    this.P.burst('alpha', 6, { x, y, z, speed: 6, life: 1.4, size0: 0.22, color0: 0x222222, alpha1: 0.3, gravity: 18, shape: 3, spin: 10 });
    this.P.burst('alpha', 3, { x, y, z, spread: 0.5, life: 2, size0: 0.8, size1: 2.5, color0: 0x8a8885, alpha0: 0.5, alpha1: 0, drag: 1, gravity: -0.4, shape: 1 });
  }
  trail(a, b, n, life) {
    for (let i = 0; i <= n; i++) { const t = i / n; this.P.emit('alpha', { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, life, size0: 0.35, size1: 1.2, color0: 0xdedad2, alpha0: 0.45, alpha1: 0, drag: 1, shape: 1, delay: t * 0.1 }); }
  }
  onLaser(e) {
    const a = pt(e.from) || { x: e.x, y: (e.y ?? 1), z: e.z }, b = pt(e.to, 0.8) || pt(e.target, 0.8) || { x: e.tx, y: e.ty ?? 1, z: e.tz };
    if (a?.x == null || b?.x == null) return;
    if (!this.visible(a.x, a.z) && !this.visible(b.x, b.z)) return;
    this.laser(new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z), e.color || 0x5ff6ff);
  }
  jamRing(x, z, r, strength = 1) {
    const ring = this.flatQuad(ringMaterial(0x7a48d8, { fill: 0, width: 0.035 }), x, 0.35, z, r);
    this.add(ring, 1.1, (e, t) => { const u = e.obj.material.uniforms; u.uProgress.value = t; u.uOpacity.value = (1 - t) * 0.35 * strength; });
  }
  // Sim emits 'jam' {unit, r} about once per second per active jammer: one soft ring each time.
  onJam(e) {
    const src = e.unit || e.by || e.from || e;
    const x = src.x ?? e.x, z = src.z ?? e.z;
    if (x == null || !this.visible(x, z) || !this.onScreen(x, z, 30)) return;
    const r = e.r || e.radius || src.def?.jamRadius || 20;
    this.jamRing(x, z, r, e.burst ? 1.6 : 0.7);
    if (e.burst) this.after(0.25, () => this.jamRing(x, z, r * 0.7, 1.2));
  }
  onSkill(e) {
    const u = e.unit, x = e.x ?? u?.x, z = e.z ?? u?.z;
    if (x == null || !this.visible(x, z)) return;
    const y = (u?.alt || 0) + 1;
    if (e.skill === 'jam') return this.onJam({ unit: u, x, z, r: (u?.def?.jamRadius || 20) * 1.5, burst: true });
    if (e.skill === 'aps') {
      const d = new THREE.Mesh(this.geo.dome, domeMaterial(0x80d8ff)); d.position.set(u?.x ?? x, u?.alt || 0, u?.z ?? z); d.scale.setScalar(Math.max(1.6, (u?.def?.size || 3) * 0.7)); d.renderOrder = 24;
      this.add(d, 0.45, (ef, t) => this.fadeMat(ef, t));
      return;
    }
    if (e.skill === 'decoy') {
      this.P.burst('add', 14, { x, y: y + 1, z, speed: 6, speedY: 7, life: 1.6, size0: 0.5, size1: 0.2, color0: hdr(0xfff0b0, 4), color1: hdr(0xff8040, 2), alpha1: 0, gravity: 4, drag: 0.8, shape: 0 });
      this.P.burst('alpha', 10, { x, y: y + 1, z, speed: 5, speedY: 6, life: 2.2, size0: 0.4, size1: 1.6, color0: 0xe8e8e8, alpha0: 0.5, alpha1: 0, gravity: 3, drag: 1, shape: 1 });
      return;
    }
    // Generic skill activation: team-coloured ring + sparkle.
    const col = this.game.sides[u?.side]?.color ?? 0xffffff;
    const ring = this.flatQuad(ringMaterial(col, { fill: 0.5 }), x, 0.35, z, Math.max(3, (u?.def?.size || 2) * 1.2));
    this.add(ring, 0.6, (ef, t) => { const k = ef.obj.material.uniforms; k.uProgress.value = t; k.uOpacity.value = 1 - t; });
  }
  shimmerBurst(u) {
    this.P.burst('add', 16, { x: u.x, y: (u.alt || 0) + 1, z: u.z, spread: (u.def?.size || 2) * 0.4, speed: 2, life: 0.6, size0: 0.4, size1: 0.1, color0: hdr(0x9fe8ff, 2.5), alpha1: 0, shape: 2 });
  }
  glitchBurst(u, color = 0xff3060) {
    this.P.burst('add', 12, { x: u.x, y: (u.alt || 0) + 1, z: u.z, spread: (u.def?.size || 2) * 0.5, speed: 3, life: 0.4, size0: 0.35, color0: hdr(color, 3), alpha1: 0, shape: 3, spin: 6 });
  }
  // 'strike:warn' {x,z,r,t,side,kind}: hypersonic missile (kind 'hypersonic') or steel-rain barrage marker.
  onStrikeWarn(e) {
    const x = e.x, z = e.z; if (x == null) return;
    const r = e.r || e.radius || 8, delay = Math.max(0.3, e.delay ?? e.t ?? e.time ?? 3);
    if (e.side !== this.side && !this.visible(x, z) && e.kind !== 'hypersonic') return;
    const col = e.side === this.side ? 0xffb020 : 0xff3030;
    const m = this.flatQuad(warnMaterial(col), x, 0.4, z, r * 1.15);
    this.add(m, delay + 0.2, (ef, t) => { const u = ef.obj.material.uniforms; u.uProgress.value = Math.min(1, t * (delay + 0.2) / delay); u.uOpacity.value = t > 0.9 ? (1 - t) * 10 : 1; });
    if (e.kind !== 'hypersonic') return;
    // Incoming hypersonic streak just before the impact (the sim emits the explosion + 'strike:impact').
    this.after(Math.max(0, delay - 0.45), () => {
      const a = new THREE.Vector3(x - 60, 70, z + 25), b = new THREE.Vector3(x, 0.5, z);
      const s = this.strip(streakMaterial(0xfff0d0), a, b, 1.2);
      this.add(s, 0.8, (ef, t) => { const u = ef.obj.material.uniforms; if (u.uHead) u.uHead.value = Math.min(1, t * 1.8); u.uOpacity.value = t < 0.6 ? 1 : (1 - t) / 0.4; });
      this.trail(a, b, 18, 2.5);
    });
  }
  onStrikeImpact(e) {
    if (e.x == null || !this.visible(e.x, e.z)) return;
    const r = e.r || e.radius || 8;
    const ring = this.flatQuad(ringMaterial(0xfff0d0), e.x, 0.5, e.z, r * 3);
    this.add(ring, 0.9, (ef, t) => { const u = ef.obj.material.uniforms; u.uProgress.value = Math.sqrt(t); u.uOpacity.value = 1 - t; });
    this.P.emit('add', { x: e.x, y: 3, z: e.z, life: 0.3, size0: r * 2, size1: r * 4, color0: hdr(0xffffff, 6), alpha1: 0, shape: 0 });
    this.R.post?.setFlash(0.7);
  }
  // Mines: 'mine' {id,x,z,side,kind} placed, 'mine:remove' {id}, 'mine:detonate' {id,x,z} (sim also emits the explosion).
  onMine(e) {
    const x = e.x ?? e.mine?.x, z = e.z ?? e.mine?.z; if (x == null) return;
    if (e.side != null && e.side !== this.side) return; // enemy mines stay hidden
    const sea = e.kind === 'sea';
    const g = new THREE.Group(); g.position.set(x, sea ? 0.05 : this.ground(x, z) + 0.08, z);
    const body = new THREE.Mesh(this.geo.mine || (this.geo.mine = new THREE.CylinderGeometry(0.45, 0.55, 0.22, 10)), this.mat.mine || (this.mat.mine = new THREE.MeshStandardMaterial({ color: 0x3a4030, roughness: 0.8 })));
    const led = new THREE.Mesh(this.geo.led || (this.geo.led = new THREE.SphereGeometry(0.12, 6, 4)), new THREE.MeshBasicMaterial({ color: hdr(0xff3020, 4) }));
    led.position.y = 0.18; g.add(body, led);
    this.root.add(g);
    (this.mines || (this.mines = new Map())).set(e.id ?? (x + ':' + z), { g, led, phase: Math.random() * 6 });
    const ring = this.flatQuad(ringMaterial(0xff4040, { fill: 0 }), x, 0.3, z, 3);
    this.add(ring, 0.8, (ef, t) => { const u = ef.obj.material.uniforms; u.uProgress.value = t; u.uOpacity.value = 1 - t; });
  }
  removeMine(e) {
    const m = this.mines?.get(e.id); if (!m) return;
    this.root.remove(m.g); m.led.material.dispose(); this.mines.delete(e.id);
  }
  onCapture(e) {
    const sp = e.sp || e; if (sp?.x == null) return;
    const col = e.side != null && e.side >= 0 ? (this.game.sides[e.side]?.color ?? TEAM_HEX[e.side]) : 0xffffff;
    const r = sp.radius || 8;
    for (let i = 0; i < 2; i++) this.after(i * 0.25, () => {
      const ring = this.flatQuad(ringMaterial(col), sp.x, 0.4, sp.z, r * 1.3);
      this.add(ring, 1.2, (ef, t) => { const u = ef.obj.material.uniforms; u.uProgress.value = t; u.uOpacity.value = 1 - t; });
    });
    this.P.burst('add', 30, { x: sp.x, y: 0.5, z: sp.z, spread: r * 0.5, speedY: 9, speed: 1, life: 1.4, size0: 0.35, size1: 0.1, color0: hdr(col, 3), alpha1: 0, gravity: 3, drag: 0.6, shape: 2 });
    this.P.emit('add', { x: sp.x, y: 3, z: sp.z, life: 0.5, size0: 4, size1: 9, color0: hdr(col, 2), alpha0: 0.8, alpha1: 0, shape: 0 });
  }

  // ---------- ultimates ----------
  onUltimate(e) {
    const id = e.id || e.ultimate || e.type; if (e.x == null && id !== 'wedge') return;
    const g = this.game, side = e.side ?? 0, dur = e.duration || 10, r = e.r || e.radius || 20;
    const col = g.sides[side]?.color ?? TEAM_HEX[side];
    const x = e.x ?? g.units.values().next().value?.x ?? 0, z = e.z ?? 0;
    const zone = { id, side, x, z, r, end: this.time + dur, dur, objs: [], acc: 0 };
    const addObj = (o) => { this.root.add(o); zone.objs.push(o); return o; };
    if (id === 'wedge') {
      const rec = (g.ultimates || []).slice().reverse().find(f => f.id === 'wedge' && f.side === side && f.unitIds);
      zone.units = rec ? rec.unitIds.map(id => g.units.get(id)).filter(Boolean).slice(0, 40) : [...g.units.values()].filter(u => u.alive && u.side === side && !u.isAir && (e.x == null || Math.hypot(u.x - x, u.z - z) < r)).slice(0, 40);
      zone.domes = zone.units.map(u => { const d = addObj(new THREE.Mesh(this.geo.dome, domeMaterial(0xffc040))); d.scale.setScalar(Math.max(1.5, (u.def.size || 2) * 0.75)); d.renderOrder = 24; return d; });
      if (e.x != null) { const ring = addObj(this.flatQuad(ringMaterial(0xffc040), x, 0.4, z, r)); zone.ring = ring; }
    } else if (id === 'steelrain') {
      zone.warn = addObj(this.flatQuad(warnMaterial(0xff6a20), x, 0.4, z, r));
      for (let i = 0; i < 4; i++) this.after(i * Math.min(1.5, dur / 5), () => this.bomberRun(x, z, r, side));
    } else if (id === 'blockade') {
      zone.sonar = addObj(this.flatQuad(sonarMaterial(0x40e0ff), x, 0.3, z, r));
    } else if (id === 'beehive') {
      zone.ring = addObj(this.flatQuad(ringMaterial(0xffd040, { dash: 12 }), x, 0.4, z, r));
      if (zone.ring.material.uniforms.uDash) zone.ring.material.uniforms.uDash.value = 12;
    } else if (id === 'nightfall') {
      zone.dark = addObj(this.flatQuad(noiseZoneMaterial(), x, 2, z, r));
      zone.dark.material.depthTest = false; zone.dark.renderOrder = 9; // under HP bars, over the battlefield
      zone.ring = addObj(this.flatQuad(ringMaterial(0x3040a0, { fill: 0, width: 0.03 }), x, 0.4, z, r));
    } else {
      zone.ring = addObj(this.flatQuad(ringMaterial(col), x, 0.4, z, r));
    }
    for (const o of zone.objs) if (o.material?.uniforms?.uOpacity) o.material.uniforms.uOpacity.value = 0;
    this.zones.push(zone);
  }
  bomberRun(x, z, r, side) {
    const ang = rnd(0, Math.PI * 2), dx = Math.cos(ang), dz = Math.sin(ang);
    const a = new THREE.Vector3(x - dx * r * 2.5, 22, z - dz * r * 2.5), b = new THREE.Vector3(x + dx * r * 2.5, 22, z + dz * r * 2.5);
    const s = this.strip(streakMaterial(0xffffff), a, b, 0.5);
    this.add(s, 1.6, (ef, t) => { const u = ef.obj.material.uniforms; if (u.uHead) u.uHead.value = Math.min(1, t * 1.5); u.uOpacity.value = t < 0.6 ? 0.9 : (1 - t) / 0.4 * 0.9; });
    // Falling bombs along the run.
    for (let i = 0; i < 6; i++) {
      const k = (i + 0.5) / 6, px = x + dx * r * (k * 2 - 1) * 0.8 + rnd(-2, 2), pz = z + dz * r * (k * 2 - 1) * 0.8 + rnd(-2, 2);
      this.P.emit('alpha', { x: px, y: 22, z: pz, vy: -4, life: 1.2, size0: 0.35, color0: 0x202020, alpha0: 1, alpha1: 1, gravity: 12, shape: 3, delay: 0.3 + k * 0.6 });
      this.after(1.5 + k * 0.6, () => { if (!this.isWater(px, pz)) this.explode(px, 0.3, pz, rnd(1.6, 2.6), 'bomb'); else this.waterBlast(px, pz, 1.8); });
    }
  }
  updateZones(dt) {
    const g = this.game;
    let dark = 0;
    this.zones = this.zones.filter(zn => {
      const left = zn.end - this.time, age = zn.dur - left;
      const fade = Math.min(1, age * 2, Math.max(0, left) * 1.5);
      const vis = zn.side === this.side || this.visible(zn.x, zn.z);
      for (const o of zn.objs) { o.visible = vis; const u = o.material?.uniforms; if (u?.uOpacity) u.uOpacity.value = fade * (o === zn.ring ? 0.6 : 1); if (u?.uProgress && o !== zn.warn) u.uProgress.value = (age * 0.5) % 1; if (o === zn.warn && u?.uProgress) u.uProgress.value = (age * 0.8) % 1; }
      zn.acc += dt;
      const P = this.P;
      if (zn.id === 'wedge') {
        zn.units.forEach((u, i) => {
          const d = zn.domes[i];
          d.visible = u.alive && vis; if (!u.alive) return;
          d.position.set(u.x, u.alt, u.z);
          if (u.moving && Math.random() < 0.5) {
            const h = u.heading, back = (u.def.size || 2) * 0.6;
            P.emit('add', { x: u.x - Math.cos(h) * back + rnd(-0.6, 0.6), y: u.alt + rnd(0.3, 1.4), z: u.z - Math.sin(h) * back + rnd(-0.6, 0.6), vx: -Math.cos(h) * 14, vz: -Math.sin(h) * 14, life: 0.22, size0: 0.25, size1: 0.05, color0: hdr(0xffd060, 3), alpha1: 0, shape: 2 });
          }
        });
      } else if (zn.id === 'blockade' && zn.acc > 0.7 && vis) {
        zn.acc = 0;
        const a0 = rnd(0, Math.PI * 2), a1 = a0 + rnd(1.5, 3);
        const p0 = new THREE.Vector3(zn.x + Math.cos(a0) * zn.r, 0.5, zn.z + Math.sin(a0) * zn.r);
        const p1 = new THREE.Vector3(zn.x + Math.cos(a1) * zn.r * 0.6, 0.5, zn.z + Math.sin(a1) * zn.r * 0.6);
        for (let i = 0; i <= 16; i++) { const t = i / 16; P.emit('alpha', { x: p0.x + (p1.x - p0.x) * t, y: 0.5 + Math.sin(t * Math.PI) * zn.r * 0.35, z: p0.z + (p1.z - p0.z) * t, life: 1.8, size0: 0.4, size1: 1.4, color0: 0xe8e8e8, alpha0: 0.5, alpha1: 0, drag: 1, shape: 1, delay: t * 0.6 }); }
        P.emit('add', { x: p1.x, y: 0.6, z: p1.z, life: 0.2, size0: 1.5, size1: 3, color0: hdr(0xffd080, 4), alpha1: 0, delay: 0.6 });
      } else if (zn.id === 'beehive' && vis) {
        while (zn.acc > 0.03) {
          zn.acc -= 0.03;
          const a = rnd(0, Math.PI * 2), rr = Math.sqrt(Math.random()) * zn.r * 0.8;
          P.emit('alpha', { x: zn.x + Math.cos(a) * rr, y: rnd(3, 8), z: zn.z + Math.sin(a) * rr, vx: rnd(-6, 6), vy: rnd(-1, 1), vz: rnd(-6, 6), life: 0.7, size0: 0.28, color0: 0x15181a, alpha0: 0.9, alpha1: 0.9, drag: 0.5, shape: 3, spin: 20 });
          if (Math.random() < 0.15) P.emit('add', { x: zn.x + Math.cos(a) * rr, y: rnd(3, 8), z: zn.z + Math.sin(a) * rr, life: 0.3, size0: 0.15, color0: hdr(0xff3030, 4), alpha1: 0, shape: 2 });
        }
      } else if (zn.id === 'nightfall') {
        if (Math.hypot(this.R.target.x - zn.x, this.R.target.z - zn.z) < zn.r + this.R.viewH * 0.5) dark = Math.max(dark, 0.55 * fade);
      }
      if (left <= 0) { for (const o of zn.objs) { this.root.remove(o); o.material?.dispose?.(); } return false; }
      return true;
    });
    this.R.post?.setDarkness(dark);
  }

  // ---------- weather ----------
  setWeather(kind) {
    if (!kind) return;
    this.weather.set(kind);
    this.water?.setWeather(kind);
    this.sea?.setWeather(kind);
  }

  // ---------- buildings (F-13): dithered fade keeps depth so x-ray silhouettes work ----------
  prepBuildings() {
    for (const b of this.R.world?.buildings || []) {
      const m = b.material;
      m.transparent = false; m.alphaHash = false; b.userData.dither = true;
      // Ordered 4x4 Bayer screen-door instead of alpha blending: clean pattern, keeps depth writes.
      m.onBeforeCompile = sh => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', BAYER_FADE);
      };
      m.customProgramCacheKey = () => 'bld-dither';
      m.needsUpdate = true;
    }
  }


  // ---------- per-unit looks: rim/selection/stealth/jam, x-ray, altitude lines, shadows, dust, wakes ----------
  updateUnits(dt) {
    const view = this.view; if (!view) return;
    const g = this.game, me = this.side, P = this.P, R = this.R;
    const close = R.zoomIndex === 2, hi = this.quality === 'high';
    const subs = this.subList || (this.subList = []); subs.length = 0;
    for (const v of view.views.values()) {
      const u = v.unit;
      if (v.dying !== undefined || !v.group.visible) { if (v.vline) v.vline.visible = false; if (v.xray) v.xray.visible = false; continue; }
      // Material mode.
      const mode = u.stealth > 0 ? 'stealth' : (u.jammed > 0 || u.hacked > 0) ? 'jammed' : view.selected.has(u.id) ? 'selected' : 'normal';
      const key = mode + u.side;
      if (v.fxKey !== key) { v.fxKey = key; this.applyMode(v, u, mode); }
      // Stealth units: enemies that see them only get the shimmer (already very faint).
      if (v.xray) v.xray.visible = mode !== 'stealth' && u.layer !== 'sub' && R.zoomIndex > 0;
      // Air: soft shadow scaled by altitude + altitude line.
      if (v.shadow) {
        if (!v.shadowSoft) { v.shadowSoft = true; v.shadow.material.map = this.shadowTex; v.shadow.material.opacity = 0.5; v.shadow.material.needsUpdate = true; v.shadow.scale.setScalar(1.4); }
        const alt = Math.max(0, v.group.position.y), gx = v.group.position.x, gz = v.group.position.z;
        v.shadow.material.opacity = Math.max(0.15, 0.55 - alt * 0.018) * (mode === 'stealth' ? 0.3 : 1);
        v.shadow.scale.setScalar(1.3 + alt * 0.035);
        v.shadow.position.y = (this.isWater(gx, gz) ? -0.1 : this.ground(gx, gz)) + 0.1;
        if (close || view.selected.has(u.id)) {
          if (!v.vline) { v.vline = new THREE.Line(this.geo.vline, this.mat.vline[u.side] || this.mat.vline[0]); v.vline.computeLineDistances(); v.vline.frustumCulled = false; this.root.add(v.vline); }
          v.vline.visible = alt > 2;
          v.vline.position.set(gx, alt, gz); v.vline.scale.set(1, alt - v.shadow.position.y, 1);
        } else if (v.vline) v.vline.visible = false;
      }
      if (!this.onScreen(u.x, u.z)) continue;
      // Movement dust / wakes / rotor wash.
      v.fxAcc = (v.fxAcc || 0) + dt;
      const step = hi ? 0.12 : 0.24;
      if (v.fxAcc < step) { if (u.layer === 'sub') subs.push(u); continue; }
      v.fxAcc = 0;
      const h = u.heading, s = u.def.size || 2, cx = Math.cos(h), sz = Math.sin(h);
      if (u.layer === 'ground' && u.moving && u.def.group !== 'infantry' && !this.isWater(u.x, u.z) && this.game.weather !== 'rain') {
        P.emit('alpha', { x: u.x - cx * s * 0.5 + rnd(-0.4, 0.4), y: this.ground(u.x, u.z) + 0.3, z: u.z - sz * s * 0.5 + rnd(-0.4, 0.4), vx: -cx * 0.8, vy: 0.5, vz: -sz * 0.8, life: 1.3, size0: s * 0.3, size1: s * 0.9, color0: 0xa89878, color1: 0xb8ad94, alpha0: 0.35, alpha1: 0, drag: 1.5, shape: 1, spin: 0.5 });
      } else if (u.layer === 'sea' && u.moving) {
        for (const sgn of [-1, 1]) P.emit('alpha', { x: u.x - cx * s * 0.45 + sz * sgn * s * 0.12, y: 0.05, z: u.z - sz * s * 0.45 - cx * sgn * s * 0.12, vx: sz * sgn * 1.2, vz: -cx * sgn * 1.2, life: 2.2, size0: s * 0.15, size1: s * 0.5, color0: 0xf2fbff, alpha0: 0.6, alpha1: 0, drag: 0.8, shape: 1 });
      } else if (u.layer === 'sub') {
        subs.push(u);
        if (u.moving) P.emit('alpha', { x: u.x - cx * s * 0.4, y: -0.05, z: u.z - sz * s * 0.4, life: 1.6, size0: s * 0.12, size1: s * 0.4, color0: 0xd8eef4, alpha0: 0.25, alpha1: 0, shape: 1 });
      } else if (u.layer === 'low' && v.rotors?.length) {
        const wy = this.isWater(u.x, u.z);
        for (let i = 0; i < 2; i++) { const a = rnd(0, Math.PI * 2); P.emit('alpha', { x: u.x + Math.cos(a) * 0.8, y: wy ? 0.05 : this.ground(u.x, u.z) + 0.2, z: u.z + Math.sin(a) * 0.8, vx: Math.cos(a) * 5, vz: Math.sin(a) * 5, life: 0.9, size0: s * 0.2, size1: s * 0.6, color0: wy ? 0xeaf6fa : 0xa89878, alpha0: wy ? 0.35 : 0.22, alpha1: 0, drag: 2.5, shape: 1 }); }
      }
      // Jammed: purple sparks.
      if (u.jammed > 0 && Math.random() < 0.4) P.emit('add', { x: u.x + rnd(-1, 1), y: u.alt + rnd(0.5, 2), z: u.z + rnd(-1, 1), life: 0.25, size0: 0.3, color0: hdr(0xb070ff, 3), alpha1: 0, shape: 2 });
    }
    this.water?.setSubs(subs.filter(u => u.side === me || u.visible[me]).map(u => ({ x: u.x, z: u.z, heading: u.heading, size: u.def.size || 5 })));
  }
  applyMode(v, u, mode) {
    const col = this.game.sides[u.side]?.color ?? TEAM_HEX[u.side] ?? 0xffffff;
    const hi = this.quality === 'high';
    v.group.traverse(o => {
      if (!o.isMesh || o.userData.fxXray || o === v.teamRing || o === v.shadow) return;
      const base = o.userData.fxBase || (o.userData.fxBase = o.material);
      if (!base || Array.isArray(base) || !(base.isMeshStandardMaterial || base.isMeshPhysicalMaterial)) return;
      o.material = unitVariant(base, u.side, mode, col);
      // X-ray silhouette (only drawn where something occludes the unit).
      if (hi && this.xrayOn && !u.isAir && !o.userData.fxXrayMesh && !o.isInstancedMesh) {
        const xm = unitVariant(base, u.side, 'xray', col);
        xm.depthTest = true; xm.depthFunc = THREE.GreaterDepth; xm.depthWrite = false; xm.transparent = true;
        const x = o.isSkinnedMesh ? new THREE.SkinnedMesh(o.geometry, xm) : new THREE.Mesh(o.geometry, xm);
        if (o.isSkinnedMesh) x.bind(o.skeleton, o.bindMatrix);
        x.userData.fxXray = true; x.renderOrder = 30; x.castShadow = false; x.raycast = () => {};
        o.add(x); o.userData.fxXrayMesh = x;
        (v.xrays || (v.xrays = [])).push(x);
      }
    });
    if (v.xrays) v.xray = { set visible(b) { for (const x of v.xrays) x.visible = b; } };
    if (mode === 'stealth') this.shimmerBurst(u);
  }

  // ---------- projectiles ----------
  updateProjectiles(dt) {
    const live = this.liveSet || (this.liveSet = new Set()); live.clear();
    const P = this.P, hi = this.quality === 'high';
    for (const p of this.game.projectiles) {
      live.add(p.id);
      let m = this.projMeshes.get(p.id);
      if (!m) {
        const k = this.geo[p.kind] ? p.kind : 'shell';
        m = new THREE.Mesh(this.geo[k], this.mat[k] || this.mat.shell);
        m.userData.last = new THREE.Vector3(p.x, p.y ?? 1, p.z);
        m.userData.acc = 0;
        this.root.add(m); this.projMeshes.set(p.id, m);
      }
      const vis = this.visible(p.x, p.z) && this.onScreen(p.x, p.z);
      m.visible = vis;
      const ny = p.y ?? 1, last = m.userData.last;
      _a.set(p.x, ny, p.z);
      _b.subVectors(_a, last);
      if (_b.lengthSq() > 1e-6) { _c.copy(_a).add(_b); m.lookAt(_c); m.rotateY(-Math.PI / 2); }
      m.position.copy(_a);
      if (vis) {
        const k = p.kind;
        if (k === 'missile' || k === 'rocket') {
          // Exhaust glow + smoke trail emitted along the travelled segment.
          const n = hi ? 3 : 1;
          for (let i = 0; i < n; i++) {
            const t = i / n;
            P.emit('alpha', { x: last.x + _b.x * t, y: last.y + _b.y * t, z: last.z + _b.z * t, vx: rnd(-0.2, 0.2), vy: 0.2, vz: rnd(-0.2, 0.2), life: k === 'rocket' ? 1.6 : 1.2, size0: 0.35, size1: k === 'rocket' ? 1.8 : 1.3, color0: 0xe2ded6, color1: 0x9a968e, alpha0: 0.55, alpha1: 0, drag: 1, gravity: -0.3, shape: 1, spin: 1 });
          }
          P.emit('add', { x: p.x - _b.x * 0.3, y: ny - _b.y * 0.3, z: p.z - _b.z * 0.3, life: 0.07, size0: k === 'rocket' ? 1.0 : 0.75, color0: hdr(0xffc070, 5), alpha1: 0, shape: 0 });
        } else if (k === 'shell') {
          P.emit('add', { x: last.x, y: last.y, z: last.z, life: 0.12, size0: 0.35, size1: 0.1, color0: hdr(0xffd090, 3), alpha0: 0.8, alpha1: 0, shape: 0 });
        } else if (k === 'torpedo') {
          m.userData.acc += dt;
          if (m.userData.acc > 0.06) { m.userData.acc = 0; P.emit('alpha', { x: p.x, y: 0.02, z: p.z, vx: rnd(-0.6, 0.6), vz: rnd(-0.6, 0.6), life: 2.4, size0: 0.4, size1: 1.6, color0: 0xf0faff, alpha0: 0.55, alpha1: 0, drag: 1, shape: 1 }); }
        } else if (k === 'bomb') {
          P.emit('alpha', { x: last.x, y: last.y, z: last.z, life: 0.35, size0: 0.2, size1: 0.4, color0: 0xd0d0d0, alpha0: 0.3, alpha1: 0, shape: 1 });
        }
      }
      last.copy(_a);
    }
    for (const [id, m] of this.projMeshes) if (!live.has(id)) { this.root.remove(m); this.projMeshes.delete(id); }
  }

  update(dt) {
    this.time += dt;
    fxUniforms.uTime.value = this.time;
    const R = this.R;
    if (this.timers.length) {
      const due = this.timers.filter(t => t.at <= this.time);
      if (due.length) { this.timers = this.timers.filter(t => t.at > this.time); for (const t of due) { try { t.fn(); } catch (e) { console.warn('fx timer', e); } } }
    }
    this.updateProjectiles(dt);
    this.updateUnits(dt);
    this.updateBurners(dt);
    this.updateZones(dt);
    if (this.mines) for (const m of this.mines.values()) m.led.visible = Math.sin(this.time * 4 + m.phase) > 0.2;
    for (const e of this.effects) {
      e.life -= dt;
      const t = Math.min(1, 1 - e.life / e.max);
      if (e.update) e.update(e, t, dt);
    }
    if (this.effects.some(e => e.life <= 0)) this.effects = this.effects.filter(e => {
      if (e.life > 0) return true;
      this.root.remove(e.obj); e.obj.material?.dispose?.();
      return false;
    });
    if (this.water && R.scene.background?.isColor) this.water.material.uniforms.uSky.value.copy(R.scene.background);
    this.water?.setDetail?.(THREE.MathUtils.clamp((120 - R.viewH) / 70, 0, 1));
    const sunDir = _sun.copy(R.sun.position).sub(R.sun.target.position).normalize();
    if (this.sea) { this.sea.material.uniforms.uSky.value.copy(this.water?.material.uniforms.uSky.value || R.scene.background); this.sea.setDetail(this.water?.material.uniforms.uDetail.value ?? 1); this.sea.update(this.time, sunDir); }
    if (this.water) this.water.update(this.time, sunDir);
    this.weather.update(dt, this.time);
    const size = R.r.getDrawingBufferSize(_v2);
    this.P.setViewport(size.y);
    this.P.update(this.time);
  }

  dispose() {
    for (const f of this.unsub) f();
    this.unsub = [];
    this.weather?.dispose();
    this.water?.dispose();
    this.sea?.dispose();
    this.P?.dispose();
    this.R.post?.setDarkness(0);
    for (const v of this.view?.views.values() || []) if (v.vline) this.root.remove(v.vline);
    this.R.scene.remove(this.root);
  }
}
const _v2 = new THREE.Vector2(), _sun = new THREE.Vector3();

function blobTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

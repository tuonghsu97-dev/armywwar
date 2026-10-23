// WorldView: keeps Three.js objects in sync with sim entities (units, structures, strongpoints),
// HP bars, intent icons (GDD §5 F-69), selection + range rings (F-183), capture bars (F-184),
// air-unit ground shadows (F-12), 5 representative soldiers per squad/transport (F-162), fog overlay (F-94).
import * as THREE from 'three';
import { makeModel } from './models.js';
import { BillboardBatch, RingBatch } from './bars.js';
import { CELL } from '../data/maps.js';
import { effRange } from '../sim/combat.js';

const INTENT_ICON = {
  idle: '·', move: '➜', attack: '✸', defend: '⛨', suppress: '≋', flank: '↷', sead: '⌖', retreat: '↩', repair: '✚',
  capture: '⚑', focus: '◎', rearm: '⟲', load: '⇪', unload: '⇩', transport: '⇄', loiter: '∞', jammed: '⚡', hacked: '☠', deploy: '⬇',
};

export class WorldView {
  constructor(renderer, game, viewSide = 0) {
    this.R = renderer; this.game = game; this.side = viewSide;
    this.scene = renderer.scene;
    this.views = new Map();
    this.structViews = new Map();
    this.spViews = [];
    this.selected = new Set();
    this.iconCache = new Map();
    this.root = new THREE.Group(); this.root.name = 'world';
    this.scene.add(this.root);
    this.rangeRing = ring(1, 0xffffff, 0.35); this.rangeRing.visible = false; this.root.add(this.rangeRing);
    // Batched HP bars / intent icons / team rings (perf QA #10).
    this.bb = new BillboardBatch(INTENT_ICON);
    this.rings = new RingBatch(0.45); this.ringsSel = new RingBatch(1);
    this.root.add(this.bb.mesh, this.rings.mesh, this.ringsSel.mesh);
    this._c = new THREE.Color(); this._team = [new THREE.Color(this.teamColor(0)), new THREE.Color(this.teamColor(1))];
    this._hpBg = new THREE.Color(0x111111); this._white = new THREE.Color(0xffffff);
    this.buildStructures();
    this.buildStrongpoints();
    this.buildTunnels();
    this.buildFog();
    this.buildDeployZone();
    game.events.on('unit:spawn', u => this.addUnit(u));
    game.events.on('unit:death', ({ unit }) => this.onDeath(unit));
    for (const u of game.units.values()) this.addUnit(u);
  }

  teamColor(side) { return this.game.sides[side].color; }

  addUnit(u) {
    if (this.views.has(u.id)) return;
    const g = new THREE.Group();
    const def = u.def;
    const v = { unit: u, group: g, mixers: [] };
    if (def.id === 'infantry' || def.id === 'at_team') {
      // Always draw max 5 representative soldiers (GDD §14).
      const n = Math.max(1, Math.min(5, Math.ceil((u.soldiers || def.squad) / 10)));
      const offs = [[0, 0], [0.9, 0.7], [0.9, -0.7], [-0.9, 0.7], [-0.9, -0.7]];
      v.soldierMeshes = [];
      for (let i = 0; i < 5; i++) {
        const m = makeModel('infantry', 1.1, this.teamColor(u.side), { byHeight: true, shadow: false });
        m.object.position.set(offs[i][0], 0, offs[i][1]);
        m.object.visible = i < n;
        if (m.mixer) v.mixers.push(m.mixer);
        g.add(m.object); v.soldierMeshes.push(m.object);
      }
    } else if (def.swarmCount) {
      // Swarm: instanced drones orbiting the unit centre (F-122).
      const m = makeModel('fpv', 0.6, this.teamColor(u.side), { shadow: false });
      const geoMesh = firstMesh(m.object);
      const im = new THREE.InstancedMesh(geoMesh.geometry, geoMesh.material, 60);
      im.count = u.swarm;
      v.swarmMesh = im; v.swarmScale = m.object.children[0]?.scale?.x || 1;
      g.add(im);
    } else {
      // Shadow casters (perf): only sizeable surface units; aircraft use the blob shadow (F-12).
      const m = makeModel(def.model, def.size * 1.0, this.teamColor(u.side), { shadow: !u.isAir && def.size >= 3 });
      v.model = m.object;
      if (m.mixer) v.mixers.push(m.mixer);
      v.rotors = [];
      m.object.traverse(o => { if (/rotor/i.test(o.name)) v.rotors.push(o); });
      g.add(m.object);
    }
    // Team ring under every unit for readability (drawn batched in update(), perf QA #10).
    v.ringR = Math.max(0.8, def.size * 0.45);
    // Ground shadow blob for aircraft (F-12) — placed in world space separately.
    if (u.isAir) {
      v.shadow = new THREE.Mesh(new THREE.CircleGeometry(def.size * 0.4, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
      v.shadow.rotation.x = -Math.PI / 2;
      this.root.add(v.shadow);
    }
    // HP bar + intent icon: batched billboards (one draw call for all units, see render/bars.js).
    v.top = def.size * 0.6 + 1.5;
    this.root.add(g);
    g.position.set(u.x, u.alt, u.z);
    this.views.set(u.id, v);
  }

  onDeath(u) {
    const v = this.views.get(u.id);
    if (!v) return;
    v.dying = 1.2;
  }

  removeView(id) {
    const v = this.views.get(id);
    if (!v) return;
    this.root.remove(v.group);
    if (v.shadow) this.root.remove(v.shadow);
    this.views.delete(id);
  }

  icon(intent) {
    if (this.iconCache.has(intent)) return this.iconCache.get(intent);
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(15,20,24,0.78)'; g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,200,90,0.9)'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#ffd27a'; g.font = 'bold 34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(INTENT_ICON[intent] || '?', 32, 34);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    this.iconCache.set(intent, t);
    return t;
  }

  buildStructures() {
    for (const s of this.game.structures) {
      const size = { hq: 9, airfield: 14, port: 7, radar_tower: 3, bunker: 4.6, boss_fortress: 16, boss_core: 8 }[s.type] || 4;
      const model = { boss_fortress: 'aa_fortress', boss_core: 'ai_city_core' }[s.type] || s.type;
      const m = makeModel(model, size, this.teamColor(s.side));
      const g = new THREE.Group();
      g.add(m.object);
      g.position.set(s.x, 0, s.z);
      if (s.side === 1) g.rotation.y = Math.PI;
      const top = size * 0.45 + 3;   // HP bar height (drawn batched in update())
      this.root.add(g);
      const rotors = []; m.object.traverse(o => { if (/rotor|radar/i.test(o.name)) rotors.push(o); });
      this.structViews.set(s.id, { s, group: g, top, rotors });
    }
  }

  buildStrongpoints() {
    for (const sp of this.game.strongpoints) {
      const g = new THREE.Group();
      g.position.set(sp.x, 0, sp.z);
      const m = makeModel('strongpoint', 5, 0xdddddd);
      g.add(m.object);
      const r = ring(sp.radius, 0xdddddd, 0.6);
      g.add(r);
      const bg = barSprite(0x111111, 0.8), bar = barSprite(0xffd27a, 1);
      bg.position.y = bar.position.y = 6.5; bg.scale.set(5, 0.5, 1); bar.scale.set(0, 0.5, 1);
      bg.renderOrder = 10; bar.renderOrder = 11;
      g.add(bg, bar);
      const flags = []; m.object.traverse(o => { if (o.isMesh && (o.name === 'Flag' || o.userData.teamPart || o.userData.team)) flags.push(o); });
      flags.forEach(f => f.material = f.material.clone());
      this.root.add(g);
      this.spViews.push({ sp, group: g, ring: r, bar, bg, flags, owner: null });
    }
  }

  // City tunnel entrances ("ngầm", F-90): small sunken bunker + dark ring at each end, matching pairs share a tint.
  buildTunnels() {
    const tints = [0xb98cff, 0x5fd3c4];
    for (const t of this.game.map.tunnels || []) {
      for (const e of [t.a, t.b]) {
        const g = new THREE.Group();
        g.position.set(e.x, 0, e.z);
        const m = makeModel('bunker', 2.2, 0x555b60);
        m.object.position.y = -0.6;
        g.add(m.object);
        g.add(ring(2.4, tints[t.id % tints.length], 0.75));
        const hole = new THREE.Mesh(new THREE.CircleGeometry(1.5, 24), new THREE.MeshBasicMaterial({ color: 0x050607, transparent: true, opacity: 0.85, depthWrite: false }));
        hole.rotation.x = -Math.PI / 2; hole.position.y = 0.1;
        g.add(hole);
        g.name = 'tunnel' + t.id;
        this.root.add(g);
      }
    }
  }

  // Deployment zone (GDD §2 step 2) shown during the 30 s deploy phase.
  buildDeployZone() {
    const z = this.game.map.deployZones[this.side];
    const extra = this.game.sides[this.side].deployBonus || 0;
    const x0 = z.x0, x1 = z.x1 + extra;
    // Clearly visible (QA #7): tinted fill + a thick pulsing border band (4 ground ribbons, one draw call).
    const fillMat = new THREE.MeshBasicMaterial({ color: 0x3f8cff, transparent: true, opacity: 0.24, depthWrite: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z.z1 - z.z0), fillMat);
    m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, 0.7, (z.z0 + z.z1) / 2); m.renderOrder = 6;
    const bw = 1.6, w = x1 - x0, h = z.z1 - z.z0, parts = [];
    for (const [cx, cz, sx, sz] of [[x0 + w / 2, z.z0 + bw / 2, w, bw], [x0 + w / 2, z.z1 - bw / 2, w, bw], [x0 + bw / 2, z.z0 + h / 2, bw, h], [x1 - bw / 2, z.z0 + h / 2, bw, h]]) {
      parts.push(new THREE.PlaneGeometry(sx, sz).rotateX(-Math.PI / 2).translate(cx, 0, cz));
    }
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0x9cc8ff, transparent: true, opacity: 0.9, depthWrite: false });
    const edge = new THREE.Mesh(mergeFlat(parts), edgeMat);
    edge.position.y = 0.8; edge.renderOrder = 7;
    this.deployZone = new THREE.Group(); this.deployZone.add(m, edge);
    this.deployZone.userData = { fillMat, edgeMat, t: 0 };
    this.root.add(this.deployZone);
  }
  updateDeployZone(dt) {
    const show = this.game.phase === 'deploy';
    this.deployZone.visible = show;
    if (!show) return;
    const d = this.deployZone.userData; d.t += dt;
    const k = 0.5 + 0.5 * Math.sin(d.t * 4);
    d.fillMat.opacity = 0.18 + 0.12 * k;
    d.edgeMat.opacity = 0.55 + 0.45 * k;
  }

  buildFog() {
    const { cols, rows } = this.game.map;
    this.fogData = new Uint8Array(cols * rows * 4);
    this.fogTex = new THREE.DataTexture(this.fogData, cols, rows, THREE.RGBAFormat);
    this.fogTex.magFilter = THREE.LinearFilter; this.fogTex.minFilter = THREE.LinearFilter;
    this.fogTex.needsUpdate = true;
    const m = new THREE.MeshBasicMaterial({ map: this.fogTex, transparent: true, depthWrite: false });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(this.game.map.w, this.game.map.h), m);
    plane.rotation.x = -Math.PI / 2; plane.position.set(this.game.map.w / 2, 0.6, this.game.map.h / 2);
    // PlaneGeometry UV v=0 is at +z after rotation; flip so row 0 maps to z=0.
    plane.scale.z = 1; plane.rotation.z = 0;
    this.fogTex.flipY = false;
    plane.renderOrder = 5;
    this.fogPlane = plane;
    this.root.add(plane);
  }

  updateFog() {
    const fog = this.game.fog?.[this.side];
    if (!fog) return;
    const d = this.fogData, { cols, rows } = this.game.map;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c, j = ((rows - 1 - r) * cols + c) * 4;
      const a = fog.visible[i] ? 0 : fog.explored[i] ? 95 : 165;
      d[j] = 8; d[j + 1] = 12; d[j + 2] = 18;
      d[j + 3] += (a - d[j + 3]) * 0.35;
    }
    this.fogTex.needsUpdate = true;
  }

  update(dt) {
    const g = this.game, me = this.side, bb = this.bb;
    bb.begin(); this.rings.begin(); this.ringsSel.begin();
    for (const [id, v] of this.views) {
      const u = v.unit;
      if (!g.units.has(id) && !v.dying) { this.removeView(id); continue; }
      if (v.dying !== undefined) {
        v.dying -= dt;
        v.group.scale.multiplyScalar(0.97);
        v.group.position.y -= dt * (u.isAir ? 6 : 0.6);
        if (v.dying <= 0) this.removeView(id);
        continue;
      }
      const vis = u.side === me || u.visible[me];
      v.group.visible = vis && !u.carriedBy && !u.tunnel;   // tunnel: underground (sim/tunnels.js)
      if (v.shadow) v.shadow.visible = v.group.visible;
      if (!v.group.visible) continue;
      // Smooth interpolation toward sim position.
      const k = Math.min(1, dt * 14);
      v.group.position.x += (u.x - v.group.position.x) * k;
      v.group.position.z += (u.z - v.group.position.z) * k;
      v.group.position.y += (u.alt - v.group.position.y) * k;
      let yaw = -u.heading, cur = v.group.rotation.y, dd = yaw - cur;
      while (dd > Math.PI) dd -= Math.PI * 2; while (dd < -Math.PI) dd += Math.PI * 2;
      v.group.rotation.y = cur + dd * Math.min(1, dt * 10);
      if (u.layer === 'air') v.group.rotation.z = Math.max(-0.5, Math.min(0.5, dd * 2)); // bank in turns
      for (const m of v.mixers) m.update(dt);
      // GLB convention: main rotors spin around local up, tail rotors around local X.
      if (v.rotors) for (const r of v.rotors) { if (/tail/i.test(r.name)) r.rotation.x += dt * 40; else r.rotation.y += dt * 30; }
      if (v.shadow) v.shadow.position.set(v.group.position.x, 0.08, v.group.position.z);
      // Submarines: sink under water and fade.
      if (u.layer === 'sub' && v.model && !v.subFaded) { v.model.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.55; } }); v.subFaded = true; }
      // Stealth shimmer.
      // fx.js sets fxStealth and draws a shimmer material instead.
      if (v.model && !this.fxStealth) { const st = u.stealth > 0; if (st !== v.stealthOn) { v.stealthOn = st; v.model.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = st; o.material.opacity = st ? 0.35 : 1; } }); } }
      // Soldiers count shown as up to 5 models.
      if (v.soldierMeshes) { const n = Math.max(1, Math.min(5, Math.ceil(u.soldiers / 10))); v.soldierMeshes.forEach((m, i) => m.visible = i < n); }
      if (v.swarmMesh) this.updateSwarm(v, u, dt);
      // Batched overlays: team ring, HP bar (bg + fill), intent icon.
      const p = v.group.position, sel = this.selected.has(id), tc = this._team[u.side] || this._white;
      (sel ? this.ringsSel : this.rings).push(p.x, p.y + 0.12, p.z, v.ringR * (sel ? 1.25 : 1), tc);
      const f = Math.max(0, u.hp / u.maxHp), top = p.y + v.top;
      bb.push(p.x, top, p.z, 2.5, 0.3, this._hpBg, 0.8);
      bb.push(p.x, top, p.z, Math.max(0.01, 2.4 * f), 0.22, this._c.setHex(f > 0.6 ? 0x55ff66 : f > 0.3 ? 0xffcc33 : 0xff4433), 1);
      if (u.side === me && g.phase !== 'deploy') {
        const intent = u.hacked > 0 ? 'hacked' : (u.jammed > 0 && u.def.remote) ? 'jammed' : u.intent;
        bb.push(p.x, top + 1.1, p.z, 1.3, 1.3, this._white, 1, INTENT_ICON[intent] ? intent : 'idle');
      }
    }
    // Range ring for the first selected unit (F-183).
    const first = [...this.selected].map(id => g.units.get(id)).find(u => u && u.alive);
    if (first && first.range > 0) {
      const r = effRange(g, first);
      this.rangeRing.visible = true;
      this.rangeRing.position.set(first.x, 0.15, first.z);
      this.rangeRing.scale.setScalar(r);
    } else this.rangeRing.visible = false;

    for (const sv of this.structViews.values()) {
      const s = sv.s;
      sv.group.visible = s.side === me || s[`seen${me}`];
      const f = s.hp / s.maxHp;
      if (sv.group.visible && s.alive) {
        const gp = sv.group.position;
        bb.push(gp.x, sv.top, gp.z, 5, 0.4, this._hpBg, 0.8);
        bb.push(gp.x, sv.top, gp.z, Math.max(0.01, 5 * f), 0.4, this._c.setHex(f > 0.5 ? 0x55ff66 : f > 0.25 ? 0xffcc33 : 0xff4433), 1);
      }
      if (!s.alive && !sv.dead) { sv.dead = true; sv.group.children[0].scale.y = 0.25; sv.group.children[0].traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.3); } }); }
      for (const r of sv.rotors) r.rotation.y += dt * 1.5;
    }
    for (const v of this.spViews) {
      const sp = v.sp;
      const col = sp.owner === -1 ? 0xdddddd : this.teamColor(sp.owner);
      if (v.owner !== sp.owner) { v.owner = sp.owner; v.ring.material.color.setHex(col); v.flags.forEach(f => { f.material.color.setHex(col); }); }
      const show = sp.progress > 0 && sp.progress < 1;
      v.bar.visible = v.bg.visible = show;
      if (show) { v.bar.scale.set(5 * sp.progress, 0.5, 1); v.bar.material.color.setHex(sp.capturer >= 0 ? this.teamColor(sp.capturer) : 0xffd27a); }
      v.ring.material.opacity = sp.contested ? 0.4 + Math.sin(g.time * 10) * 0.3 : 0.6;
    }
    bb.end(); this.rings.end(); this.ringsSel.end();
    if (g.tick % 4 === 0) this.updateFog();
    if (this.deployZone) this.updateDeployZone(dt);
  }

  updateSwarm(v, u, dt) {
    const im = v.swarmMesh, m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(v.swarmScale, v.swarmScale, v.swarmScale);
    im.count = Math.max(0, u.swarm);
    const t = this.game.time;
    for (let i = 0; i < im.count; i++) {
      const a = i * 2.39996 + t * (1.5 + (i % 5) * 0.2), r = 1 + (i % 7) * 0.35;
      m.compose(new THREE.Vector3(Math.cos(a) * r, Math.sin(t * 3 + i) * 0.4, Math.sin(a) * r), q, s);
      im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;
  }
}

function ring(r, color, opacity) {
  const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.9, r, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.12;
  if (r === 1) { m.geometry.dispose(); m.geometry = new THREE.RingGeometry(0.985, 1, 96); }
  return m;
}
function barSprite(color, opacity) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ color, transparent: true, opacity, depthTest: false }));
  s.scale.set(2.4, 0.22, 1);
  return s;
}
function firstMesh(o) { let f = null; o.traverse(x => { if (!f && x.isMesh) f = x; }); return f; }
// Concatenate non-indexed-compatible flat geometries (position + uv + normal, indexed) into one.
function mergeFlat(geos) {
  const pos = [], nor = [], uv = [], idx = []; let off = 0;
  for (const g of geos) {
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); uv.push(...g.attributes.uv.array);
    for (const i of g.index.array) idx.push(i + off);
    off += g.attributes.position.count; g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

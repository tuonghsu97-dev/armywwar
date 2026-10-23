// OWNER: agent Chỉ huy & kỹ năng
// Unit active skills (order 22): GDD §4 F-30..F-47, F-71. APS/ERA, barrage, mines, recon mark, loitering, swarm,
// stealth, ATGM, carpet bomb, CCA follow+decoy, VLS, ship drone, torpedo, sea mines, intercept, laser beam,
// EW jam (remote units jammed / missiles misdirected).
//
// Two layers:
//  - Reflexes every tick (unit-level AI, GDD §5 tầng 3): APS cuts incoming missiles, CCA takes hits for a manned
//    jet, EW aura jams remote units and misdirects missiles, kamikaze/swarm dive, mines detonate, laser auto-aims.
//  - Active skills (def.active) with cooldown u.skillCd (× u.cooldownMult, F-80): auto-used by the unit AI at the
//    right moment and triggerable by the player: command {type:'skill', unitIds, x?, z?}.
// Events: 'skill' {unit, skill, x, z}, 'jam' {unit, r}, 'laser' {from, to}, 'mine' {id,x,z,side,kind},
//   'mine:detonate' {id,x,z}, 'mine:remove' {id}, 'stealth' {unit, on}, 'intercept' {by, proj}, 'explosion'.
// Fields: u.aps (APS charges), u.swarm/u.swarmMax/u.perDrone (swarm drones), u.buffs, u.temporary/u.expire,
//   u.jamBurst, u.saturate, u.kTarget, u.kDrift, game.mines.
import { fire, computeDamage, canHit, effRange } from './combat.js';
import { losBlocked } from './vision.js';

export const SKILLS = {
  aps: { name: 'APS / ERA', desc: 'Cắt tên lửa chống tăng bay tới (T3 chặn 2 lần mỗi lượt hồi)', cd: 9 },
  barrage: { name: 'Dồn đạn', desc: 'Bắn một loạt đạn nhanh xuống điểm chỉ định (pháo tự hành: đạn nhiệt áp gây cháy)', cd: 24, target: 'point' },
  mines: { name: 'Rải mìn + mồi nhử', desc: 'Rải 3 quả mìn và thu hút hỏa lực địch', cd: 20, target: 'point' },
  mark: { name: 'Chỉ điểm', desc: 'Đánh dấu mục tiêu cho toàn đội (lộ diện 12 giây)', cd: 8 },
  loiter: { name: 'Lượn chờ', desc: 'Lượn chờ rồi lao vào mục tiêu giá trị nhất', cd: 6 },
  swarm: { name: 'Tấn công đa hướng', desc: 'Bầy drone bão hòa từ nhiều hướng: +40% sát thương, xuyên APS', cd: 16 },
  stealth: { name: 'Tàng hình', desc: 'Tàng hình tạm thời trước radar', cd: 30 },
  afterburner: { name: 'Đốt sau', desc: 'Tăng tốc 60% trong 5 giây', cd: 20 },
  atgm: { name: 'Loạt tên lửa chống tăng', desc: 'Phóng 4 tên lửa chống tăng liên tiếp', cd: 16 },
  carpet: { name: 'Thảm bom', desc: 'Rải thảm bom dọc đường bay qua điểm chỉ định (chỉ người chơi kích hoạt)', cd: 30, target: 'point', manualOnly: true },
  decoy: { name: 'Mồi nhử', desc: 'Nhận đạn thay cho máy bay có người lái gần đó', cd: 8 },
  vls: { name: 'Loạt VLS', desc: 'Phóng loạt tên lửa tầm xa vào nhiều mục tiêu', cd: 22 },
  shipdrone: { name: 'Phóng drone', desc: 'Phóng drone trinh sát từ boong tàu', cd: 40 },
  torpedo: { name: 'Ngư lôi', desc: 'Bắn loạt ngư lôi / tên lửa từ dưới nước, vẫn ẩn mình', cd: 18 },
  seamines: { name: 'Rải thủy lôi', desc: 'Rải 2 thủy lôi', cd: 24, target: 'point' },
  intercept: { name: 'Đánh chặn', desc: 'Đánh chặn tên lửa/rocket lọt lưới', cd: 2 },
  beam: { name: 'Chùm laser', desc: 'Chùm tia phá bầy drone, cần hồi năng lượng', cd: 1.4 },
  jam: { name: 'Bùng nhiễu', desc: 'Vòng nhiễu x1.5 và làm lạc 70% tên lửa trong 6 giây', cd: 25 },
  launch: { name: 'Phóng CCA', desc: 'Phóng máy bay vô nhân cộng tác', cd: 45 },
};

const MISSILE = p => p.kind === 'missile' || p.kind === 'rocket';
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function skillCooldown(u) { const s = SKILLS[u.def.active]; return s ? s.cd * (u.cooldownMult || 1) * (u.def.active === 'aps' ? (u.acc?.apsCdMult || 1) : 1) : 0; }
export function maxAps(u) { return u.acc?.apsCharges || 1; } // accessory "APS chặn 2 lần" at T3 (F-81)
export function jamRadiusOf(game, u) {
  if (!u.def.jamRadius) return 0;
  const m = game.sides[u.side].mods.jamRadius || 0;
  return u.def.jamRadius * (1 + m) * (u.acc?.jamRadiusMult || 1) * (u.rangeBoost || 1) * (u.jamBurst > game.time ? 1.5 : 1);
}

// ---- helpers shared with commanders.js ----
export function addBuff(game, u, key, val, dur, src) {
  (u.buffs ||= []).push({ key, val, until: game.time + dur, src });
  applyBuffs(game, u);
}
function applyBuffs(game, u) {
  let sp = 1, ar = 0, rg = 1;
  u.buffs = u.buffs.filter(b => b.until > game.time);
  for (const b of u.buffs) { if (b.key === 'speed') sp *= b.val; else if (b.key === 'armor') ar += b.val; else if (b.key === 'range') rg *= b.val; }
  u.speedBoost = sp; u.armorBoost = ar; u.rangeBoost = rg;
  if (!u.buffs.length) delete u.buffs;
}

// Spawn a temporary unit (ship drone, beehive swarm, CCA from carrier). Expires after opts.life seconds.
export function spawnTemp(game, side, unitId, x, z, opts = {}) {
  x = Math.max(1, Math.min(game.map.w - 1, x)); z = Math.max(1, Math.min(game.map.h - 1, z));
  const u = game.spawn(side, unitId, x, z, {
    tier: opts.tier || 1, group: opts.group ?? -1, noCrew: true, swarm: opts.swarm,
    extra: { temporary: true, expire: game.time + (opts.life || 40), ownerId: opts.ownerId ?? null },
  });
  if (opts.order) u.order = { ...opts.order, issued: game.time };
  return u;
}

// Remove a unit without counting it as a loss (expended kamikaze, expired temporary unit).
export function expend(game, u, reason = 'expended') {
  if (!u.alive) return;
  u.alive = false; u.hp = 0;
  game.events.emit('unit:death', { unit: u, killer: null, [reason]: true });
}

// Area damage used by bombs, ultimates, mines. src needs {id, side, def:{group}}.
export function areaDamage(game, src, x, z, r, dmg, dmgType = 'he', opts = {}) {
  game.events.emit('explosion', { x, z, r, type: opts.fx || 'bomb' });
  const layers = opts.layers || ['ground', 'sea', 'low'];
  let total = 0;
  for (const o of game.unitsNear(x, z, r, o => o.side !== src.side && layers.includes(o.layer) && !o.carriedBy)) {
    const f = Math.max(0.3, 1 - dist(o, { x, z }) / (r * 1.4));
    total += game.damage(o, computeDamage(game, src, o, dmg * f, dmgType), dmgType, src);
  }
  if (opts.structures !== false) for (const s of game.structuresNear(x, z, r + 3, s => s.side !== src.side)) total += game.damage(s, dmg * (opts.structMult ?? 0.8), dmgType, src);
  return total;
}
export function fakeSource(side, group = 'strike', dmgType = 'he') { return { id: -1, side, x: 0, z: 0, alt: 0, def: { group, dmgType, hits: [] } }; }

function pointTarget(x, z, side) { return { id: -1, x, z, alt: 0, alive: true, kind: 'structure', fake: true, side, layer: 'ground' }; }
function later(game, delay, fn) { (game.skillQueue ||= []).push({ at: game.time + delay, fn }); }

function addMine(game, side, x, z, kind) {
  const list = (game.mines ||= []);
  const mine = { id: game.nextId++, side, x, z, kind, armedAt: game.time + 1, dmg: kind === 'sea' ? 600 : 260, r: kind === 'sea' ? 3 : 2.2,
    layers: kind === 'sea' ? ['sea', 'sub'] : ['ground'] };
  list.push(mine);
  const mine_ = list.filter(m => m.side === side && m.kind === kind);
  if (mine_.length > (kind === 'sea' ? 12 : 16)) { const old = mine_[0]; list.splice(list.indexOf(old), 1); game.events.emit('mine:remove', { id: old.id }); }
  game.events.emit('mine', { id: mine.id, x, z, side, kind });
  return mine;
}

function enemiesNear(game, u, r, pred) {
  return game.unitsNear(u.x, u.z, r, o => o.side !== u.side && !o.carriedBy && o.visible[u.side] && (!pred || pred(o)));
}
function validTarget(game, u, t) {
  return t && t.alive && (t.kind === 'structure' || (t.visible[u.side] && canHit(u, t)));
}

// ---- skill implementations: (game, u, {x,z,manual}) => boolean ----
const IMPL = {
  aps(game, u) { u.aps = maxAps(u); return true; },

  barrage(game, u, o) {
    let x = o.x, z = o.z;
    if (x == null) { const t = u.target; if (!validTarget(game, u, t)) return false; x = t.x; z = t.z; }
    const d = Math.hypot(x - u.x, z - u.z);
    if (d > effRange(game, u) * 1.05 || d < (u.def.minRange || 0)) { if (o.manual) game.events.emit('toast', { side: u.side, text: 'Điểm bắn ngoài tầm pháo' }); return false; }
    const n = (u.def.id === 'himars' ? 8 : 6) + (u.tier - 1);
    const spread = 2 + (u.def.splash || 3) * 0.6;
    for (let i = 0; i < n; i++) later(game, i * 0.25, () => {
      if (!u.alive) return;
      const a = game.rng.next() * Math.PI * 2, r = game.rng.next() * spread;
      // SPG "Bão Lửa" fires thermobaric shells: 'fire' damage + burning (F-50).
      fire(game, u, pointTarget(x + Math.cos(a) * r, z + Math.sin(a) * r, 1 - u.side), { dmg: u.dmg * 0.75, ...(u.def.id === 'spg' ? { dmgType: 'fire' } : {}) });
      if (u.ammo !== Infinity) u.ammo++;
    });
    return true;
  },

  mines(game, u, o) {
    let x = u.x, z = u.z;
    if (o.x != null && Math.hypot(o.x - u.x, o.z - u.z) < 14) { x = o.x; z = o.z; }
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2 + game.rng.next(); addMine(game, u.side, x + Math.cos(a) * 2.5, z + Math.sin(a) * 2.5, 'land'); }
    // Decoy pulse: nearby enemies switch fire to the UGV (che chắn cho đồng đội).
    for (const e of game.unitsNear(u.x, u.z, 22, e => e.side !== u.side && !e.forcedTarget && canHit(e, u))) e.target = u;
    return true;
  },

  mark(game, u) {
    const cand = enemiesNear(game, u, u.sight).sort((a, b) => b.def.price - a.def.price).slice(0, 6 + (u.tier - 1) * 2);
    if (!cand.length) return false;
    for (const t of cand) { t.spotted = 12; t.spottedBy = u.side; }
    return true;
  },

  loiter(game, u) { u.kTarget = pickKTarget(game, u, 2); u.kDrift = null; return true; },
  swarm(game, u) { u.saturate = game.time + 6; return true; },

  stealth(game, u) {
    u.stealth = 8 + 2 * (u.tier - 1);
    u.flags.stealthFx = true;
    game.events.emit('stealth', { unit: u, on: true });
    return true;
  },

  afterburner(game, u) { addBuff(game, u, 'speed', 1.6, 5, 'afterburner'); return true; },

  atgm(game, u) {
    const t = u.target;
    if (!validTarget(game, u, t) || t.kind === 'structure' || dist(u, t) > effRange(game, u)) return false;
    for (let i = 0; i < 4; i++) later(game, i * 0.2, () => {
      if (!u.alive || !t.alive) return;
      fire(game, u, t, { dmg: u.dmg * 0.8, kind: 'missile', dmgType: 'he' });
      if (i > 0 && u.ammo !== Infinity) u.ammo++;
    });
    return true;
  },

  carpet(game, u, o) {
    if (o.x == null || u.ammo <= 0) return false;
    u.carpet = { x: o.x, z: o.z, until: game.time + 30 };
    return true;
  },

  decoy() { return false; }, // reflex only (see reflexes), button just shows readiness

  vls(game, u) {
    const r = effRange(game, u) * 1.3;
    const ts = enemiesNear(game, u, r, t => canHit(u, t)).sort((a, b) => b.def.price - a.def.price).slice(0, Math.round((4 + u.tier) * (u.acc?.vlsMult || 1)));
    if (!ts.length) return false;
    ts.forEach((t, i) => later(game, i * 0.15, () => { if (u.alive && t.alive) fire(game, u, t, { dmg: u.dmg * 0.8, kind: 'missile', dmgType: 'he' }); }));
    return true;
  },

  shipdrone(game, u) { return launchTemp(game, u, 'drone_recon', 1, 45); },
  launch(game, u) { return launchTemp(game, u, 'cca', 2, 60); },

  torpedo(game, u) {
    const t = u.target;
    if (!validTarget(game, u, t) || dist(u, t) > effRange(game, u)) return false;
    for (let i = 0; i < 2; i++) later(game, i * 0.4, () => { if (u.alive && t.alive) fire(game, u, t, { dmg: u.dmg * 0.7 }); });
    return true;
  },

  seamines(game, u, o) {
    let x = u.x, z = u.z;
    if (o.x != null && Math.hypot(o.x - u.x, o.z - u.z) < 15) { x = o.x; z = o.z; }
    addMine(game, u.side, x - 1.5, z, 'sea'); addMine(game, u.side, x + 1.5, z, 'sea');
    return true;
  },

  intercept(game, u) {
    const ps = game.projectiles.filter(p => !p.dead && p.side !== u.side && MISSILE(p) && p.interceptable !== false && Math.hypot(p.x - u.x, p.z - u.z) < 24)
      .slice(0, u.acc?.doubleIntercept ? 2 : 1);
    if (!ps.length) return false;
    for (const p of ps) { p.dead = true; game.events.emit('intercept', { by: u, proj: p }); }
    return true;
  },

  beam(game, u) {
    if (u.energy < 25) return false;
    const r = effRange(game, u);
    const ts = enemiesNear(game, u, r, t => t.def.group === 'drone' || t.isAir);
    if (!ts.length) return false;
    ts.sort((a, b) => (b.swarm || 0) - (a.swarm || 0) || (b.def.kamikaze ? 1 : 0) - (a.def.kamikaze ? 1 : 0) || dist(u, a) - dist(u, b));
    const t = ts[0];
    u.energy -= 25;
    game.events.emit('laser', { from: u, to: t });
    if (t.swarmMax) {
      const k = Math.min(t.swarm, 3 + u.tier + (u.acc?.beamExtra || 0));   // shreds several swarm drones per hit (F-45, F-81)
      game.damage(t, k * t.perDrone + 0.01, 'laser', u);
    } else game.damage(t, computeDamage(game, u, t, u.dmg * 2.5, 'laser'), 'laser', u);
    return true;
  },

  jam(game, u) { u.jamBurst = game.time + 6; return true; },
};

function launchTemp(game, u, unitId, max, life) {
  const mine = [...game.units.values()].filter(o => o.alive && o.ownerId === u.id).length;
  if (mine >= max) return false;
  const dir = u.side === 0 ? 1 : -1;
  const o = u.order && u.order.x != null && u.order.type !== 'retreat' ? u.order : { x: u.x + dir * 30, z: u.z };
  spawnTemp(game, u.side, unitId, u.x, u.z, { life, group: u.group, ownerId: u.id, tier: u.tier, order: { type: 'attack', x: o.x, z: o.z } });
  return true;
}

// Use u's active skill now. Returns true when it fired (cooldown starts, 'skill' event emitted).
export function useSkill(game, u, o = {}) {
  const id = u.def.active;
  if (!u.alive || !id || !IMPL[id] || u.skillCd > 0 || u.carriedBy) return false;
  if (u.hacked > 0 && u.side !== u.originalSide && o.manual) return false;
  if (!IMPL[id](game, u, o)) return false;
  u.skillCd = skillCooldown(u);
  game.events.emit('skill', { unit: u, skill: id, x: o.x ?? u.x, z: o.z ?? u.z });
  return true;
}

// ---- auto-use decisions (unit reflex layer). Return options object or null. ----
const AUTO = {
  barrage: (g, u) => {
    const t = u.target;
    if (!validTarget(g, u, t)) return null;
    if (u.def.needsSpotter && t.kind !== 'structure' && !(t.spotted > 0) && (dist(u, t) > u.sight || losBlocked(g, u.x, u.z, t.x, t.z))) return null;
    return dist(u, t) <= effRange(g, u) ? {} : null;
  },
  mines: (g, u) => enemiesNear(g, u, 20, e => e.isGround).length ? {} : null,
  mark: (g, u) => enemiesNear(g, u, u.sight).length ? {} : null,
  swarm: (g, u) => u.kTarget && u.kTarget.alive && dist(u, u.kTarget) < 14 ? {} : null,
  stealth: (g, u) => (g.unitsNear(u.x, u.z, 45, e => e.side !== u.side && (e.def.group === 'aa' || (e.def.detect || []).includes('radar'))).length
    || (u.hpFrac < 0.6 && g.time - u.lastHitTime < 2)) ? {} : null,
  afterburner: (g, u) => u.hpFrac < 0.5 && g.time - u.lastHitTime < 2 ? {} : null,
  atgm: (g, u) => u.target && u.target.kind !== 'structure' && (u.target.def?.group === 'tank' || u.target.isNaval) ? {} : null,
  carpet: (g, u) => { // only when the side is commanded by the AI (F-70: human-in-the-loop for players)
    if (!g.sides[u.side].ai || u.ammo <= 0) return null;
    const t = u.target; if (!t || !t.alive) return null;
    const n = t.kind === 'structure' ? 3 : g.unitsNear(t.x, t.z, 6, o => o.side !== u.side && o.isGround).length;
    return n >= 3 ? { x: t.x, z: t.z } : null;
  },
  vls: (g, u) => enemiesNear(g, u, effRange(g, u) * 1.3, t => canHit(u, t)).length ? {} : null,
  shipdrone: () => ({}), launch: () => ({}),
  torpedo: (g, u) => u.target ? {} : null,
  seamines: (g, u) => enemiesNear(g, u, 35, e => e.isNaval).length || (u.order?.type === 'defend') ? {} : null,
  intercept: () => ({}), beam: () => ({}),
  jam: (g, u) => {
    const r = jamRadiusOf(g, u) * 1.5;
    const remote = g.unitsNear(u.x, u.z, r, e => e.side !== u.side && e.def.remote).length;
    const inbound = g.projectiles.some(p => !p.dead && p.side !== u.side && MISSILE(p) && Math.hypot(p.x - u.x, p.z - u.z) < r);
    return remote >= 2 || inbound ? {} : null;
  },
};

// ---- kamikaze / swarm behaviour (F-34, F-35) ----
function pickKTarget(game, u, mult = 1.6) {
  const r = u.sight * mult;
  let best = null, bs = -Infinity;
  for (const o of game.unitsNear(u.x, u.z, r, o => o.side !== u.side && !o.carriedBy && o.visible[u.side] && canHit(u, o))) {
    const s = Math.min(60, o.def.price / 2e6) + (o.def.group === 'tank' ? 25 : 0) + (o.def.group === 'aa' ? 15 : 0) - dist(u, o) * 0.8 - (o.def.kamikaze ? 40 : 0);
    if (s > bs) { bs = s; best = o; }
  }
  if (!best) best = game.structuresNear(u.x, u.z, r, s => s.side !== u.side && s[`seen${u.side}`])[0] || null;
  return best;
}

function kamikazeTick(game, u, dt) {
  if (u.carriedBy || u.order?.type === 'retreat') return;
  let t = u.kTarget;
  if (!t || !t.alive || (t.kind !== 'structure' && !t.visible[u.side] && !u.kDrift)) {
    t = u.kTarget = (game.tick + u.id) % 4 === 0 ? pickKTarget(game, u) : null;
    u.kDrift = null;
  }
  if (!t) { loiter(game, u, dt); return; }
  u.intent = 'attack';
  if (u.jammed > 0 && !u.kDrift) {
    // "Lạc hướng khi bị nhiễu": the guidance link is jammed, the drone drifts off its target.
    const a = game.rng.next() * Math.PI * 2, r = 6 + game.rng.next() * 6;
    u.kDrift = { x: t.x + Math.cos(a) * r, z: t.z + Math.sin(a) * r };
  } else if (u.jammed <= 0 && u.kDrift && u.swarmMax) u.kDrift = null;
  if (u.kDrift) {
    u.moveTarget = { x: u.kDrift.x, z: u.kDrift.z };
    if (Math.hypot(u.kDrift.x - u.x, u.kDrift.z - u.z) < 1.6) {
      const src = u;
      areaDamage(game, src, u.x, u.z, 2, u.dmg * (u.swarmMax ? Math.min(u.swarm, 3) : 1) * 0.5, u.def.dmgType, { fx: 'kamikaze', layers: ['ground', 'sea'] });
      if (u.swarmMax) { u.swarm = Math.max(0, u.swarm - 3); u.hp = u.swarm * u.perDrone; u.kDrift = null; u.kTarget = null; if (u.swarm <= 0) expend(game, u); }
      else expend(game, u);
    }
    return;
  }
  let ax = t.x, az = t.z;
  const d = dist(u, t);
  if (u.swarmMax && d > 5) { // multi-direction approach
    const ang = (u.id * 2.39996) % (Math.PI * 2), off = Math.min(7, d * 0.35);
    ax += Math.cos(ang) * off; az += Math.sin(ang) * off;
  }
  u.moveTarget = { x: ax, z: az };
  const reach = (u.def.range || 1.2) + 1 + (t.kind === 'structure' ? 3 : (t.def.size || 1) * 0.4);
  if (d <= reach) strike(game, u, t);
}

function strike(game, u, t) {
  if (!u.swarmMax) {
    game.damage(t, t.kind === 'structure' ? u.dmg : computeDamage(game, u, t), u.def.dmgType, u);
    game.events.emit('explosion', { x: t.x, z: t.z, r: 1.8, type: 'kamikaze', y: t.alt || 0 });
    expend(game, u);
    return;
  }
  if ((u.kNext || 0) > game.time) return;
  u.kNext = game.time + 0.35;
  const sat = u.saturate > game.time;
  const k = Math.min(u.swarm, sat ? 5 : 3);
  if (!sat && t.def?.active === 'aps' && t.aps > 0) {
    blockAps(game, t, null);
  } else {
    const base = u.dmg * k * (sat ? 1.4 : 1);
    game.damage(t, t.kind === 'structure' ? base : computeDamage(game, u, t, base), u.def.dmgType, u);
    game.events.emit('explosion', { x: t.x, z: t.z, r: 1.2 + k * 0.2, type: 'kamikaze', y: t.alt || 0 });
  }
  u.swarm -= k; u.hp = Math.max(0, u.swarm * u.perDrone);
  if (u.swarm <= 0) expend(game, u);
}

function loiter(game, u, dt) {
  const o = u.order;
  const anchor = o && o.x != null && o.type !== 'idle' ? { x: o.x, z: o.z } : (u.loiterAnchor ||= { x: u.x, z: u.z });
  if (Math.hypot(anchor.x - u.x, anchor.z - u.z) > 9) return; // let the unit AI fly it there
  u.loiterAng = (u.loiterAng ?? u.id) + dt * 0.9;
  u.moveTarget = { x: anchor.x + Math.cos(u.loiterAng) * 5, z: anchor.z + Math.sin(u.loiterAng) * 5 };
  u.intent = 'loiter';
}

function blockAps(game, t, p) {
  t.aps--;
  if (t.skillCd <= 0) t.skillCd = skillCooldown(t);
  if (p) { p.dead = true; game.events.emit('intercept', { by: t, proj: p }); }
  game.events.emit('skill', { unit: t, skill: 'aps', x: t.x, z: t.z });
}

// ---- reflexes on projectiles: APS, CCA decoy, EW misdirection ----
function projectileReflexes(game, ews) {
  for (const p of game.projectiles) {
    if (p.dead || !MISSILE(p)) continue;
    const t = p.target;
    if (t && t.alive && t.kind === 'unit' && t.side !== p.side) {
      // APS (F-30, F-71, F-81): cut ATGM/missiles aimed at the tank when close.
      if (t.def.active === 'aps' && t.aps > 0 && Math.hypot(p.x - t.x, p.z - t.z) < 7) { blockAps(game, t, p); continue; }
      // CCA decoy (F-39): redirect missiles aimed at a nearby manned jet to the CCA.
      if (!p.decoyed && t.def.group === 'air' && !t.def.remote) {
        p.decoyed = true;
        const cca = game.unitsNear(t.x, t.z, 16, c => c.side === t.side && c.def.active === 'decoy' && c.skillCd <= 0 && !c.carriedBy)[0];
        if (cca) {
          p.target = cca; cca.skillCd = skillCooldown(cca);
          game.events.emit('skill', { unit: cca, skill: 'decoy', x: cca.x, z: cca.z });
        }
      }
    }
    // EW (F-47): missiles flying through an enemy jamming aura may be misdirected.
    if (!p.ewChecked) for (const e of ews) {
      if (e.u.side === p.side || Math.hypot(p.x - e.u.x, p.z - e.u.z) > e.r) continue;
      p.ewChecked = true;
      if (game.rng.chance(e.u.jamBurst > game.time ? 0.7 : 0.35)) misdirect(game, p);
      break;
    }
  }
}
export function misdirect(game, p) {
  const a = game.rng.next() * Math.PI * 2, r = 5 + game.rng.next() * 5;
  p.target = null; p.misdirected = true;
  p.tx += Math.cos(a) * r; p.tz += Math.sin(a) * r;
}

function initUnit(game, u) {
  if (u.def.swarmCount && !u.swarmMax) {
    u.swarmMax = Math.max(1, u.swarm || u.def.swarmCount);
    u.swarm = u.swarmMax;
    u.perDrone = u.maxHp;
    u.maxHp = u.perDrone * u.swarmMax; u.hp = u.maxHp;
  }
  if (u.def.active === 'aps') u.aps = maxAps(u);
}

export const skillSystem = {
  name: 'skills',
  init(game) {
    game.mines ||= [];
    game.skillQueue ||= [];
  },
  update(game, dt) {
    const t = game.time;
    for (const u of game.units.values()) {
      if (!u.alive) continue;
      if (u.skillCd > 0) u.skillCd -= dt;
      if (u.buffs) applyBuffs(game, u);
      if (u.temporary && u.expire <= t) { expend(game, u, 'expired'); continue; }
      if (u.def.active === 'aps' && u.skillCd <= 0 && u.aps < maxAps(u)) u.aps = maxAps(u);
      if (u.flags.stealthFx && !(u.stealth > 0)) { u.flags.stealthFx = false; game.events.emit('stealth', { unit: u, on: false }); }
    }
    if (game.phase !== 'battle') return;

    // Timed salvos
    if (game.skillQueue.length) {
      const due = game.skillQueue.filter(q => q.at <= t);
      if (due.length) { game.skillQueue = game.skillQueue.filter(q => q.at > t); for (const q of due) q.fn(); }
    }

    // EW auras (F-47, F-51): jam enemy remote units every tick.
    const ews = [];
    for (const u of game.units.values()) {
      if (!u.alive || !u.def.jamRadius || u.carriedBy) continue;
      const r = jamRadiusOf(game, u);
      ews.push({ u, r });
      for (const o of game.unitsNear(u.x, u.z, r, o => o.side !== u.side && o.def.remote)) {
        if (o.acc?.jamResist && Math.hypot(o.x - u.x, o.z - u.z) > r * (1 - o.acc.jamResist)) continue; // "Kháng nhiễu" (F-81)
        o.jammed = Math.max(o.jammed || 0, 0.3);
      }
      if ((u.flags.jamFxT || 0) <= t) { u.flags.jamFxT = t + 1; game.events.emit('jam', { unit: u, r }); }
    }
    projectileReflexes(game, ews);

    const auto = game.opts.autoSkills !== false;
    for (const u of game.units.values()) {
      if (!u.alive || u.carriedBy) continue;
      if (u.def.kamikaze) kamikazeTick(game, u, dt);
      if (u.carpet) carpetTick(game, u);
      if (u.def.active === 'decoy' && u.order?.type === 'idle') followLeader(game, u);
      const id = u.def.active;
      if (!auto || !id || u.skillCd > 0 || (game.tick + u.id) % 5 !== 0) continue;
      if (SKILLS[id]?.manualOnly && !game.sides[u.side].ai) continue;
      const o = AUTO[id]?.(game, u);
      if (o) useSkill(game, u, o);
    }
    if (game.tick % 2 === 0) minesTick(game);
  },
};

function carpetTick(game, u) {
  const c = u.carpet;
  if (game.time > c.until || u.ammo <= 0) { u.carpet = null; return; }
  u.moveTarget = { x: c.x, z: c.z };
  u.intent = 'attack';
  if (Math.hypot(c.x - u.x, c.z - u.z) > 5) return;
  const dx = Math.cos(u.heading), dz = Math.sin(u.heading);
  for (let k = 0; k < 10; k++) {
    const off = (k - 4.5) * 2.4;
    later(game, k * 0.12, () => areaDamage(game, u, c.x + dx * off, c.z + dz * off, 4, u.dmg * 0.8, 'he', { fx: 'bomb', layers: ['ground', 'sea'] }));
  }
  u.ammo--;
  u.carpet = null;
  u.moveTarget = null;
}

function followLeader(game, u) {
  const lead = game.unitsNear(u.x, u.z, 50, o => o.side === u.side && o.def.group === 'air' && !o.def.remote && o.layer === 'air')[0];
  if (!lead) return;
  const d = dist(u, lead);
  if (d > 6) { u.moveTarget = { x: lead.x - Math.cos(lead.heading) * 4, z: lead.z - Math.sin(lead.heading) * 4 }; u.intent = 'move'; }
}

function minesTick(game) {
  if (!game.mines.length) return;
  const keep = [];
  for (const m of game.mines) {
    if (m.armedAt > game.time) { keep.push(m); continue; }
    const hit = game.unitsNear(m.x, m.z, m.r, o => o.side !== m.side && m.layers.includes(o.layer) && !o.carriedBy)[0];
    if (!hit) { keep.push(m); continue; }
    const src = fakeSource(m.side, 'mine');
    game.events.emit('mine:detonate', { id: m.id, x: m.x, z: m.z });
    areaDamage(game, src, m.x, m.z, m.r + 1.5, m.dmg, 'he', { fx: 'mine', layers: m.layers, structures: false });
  }
  game.mines = keep;
}

export function install(game) {
  game.addSystem(skillSystem, 22);
  game.events.on('unit:spawn', u => initUnit(game, u));
  // Swarm drone count follows the swarm's HP pool (1 drone = perDrone HP).
  game.addDamageHook((g, t, dmg) => {
    if (t.swarmMax && dmg > 0) t.swarm = Math.max(0, Math.ceil((t.hp - dmg) / t.perDrone - 1e-6));
    return dmg;
  });
  game.onCommand('skill', (g, side, cmd) => {
    if (g.phase !== 'battle') return false;
    let n = 0;
    for (const id of cmd.unitIds || []) {
      const u = g.units.get(id);
      if (!u || !u.alive || u.side !== side) continue;
      if (useSkill(g, u, { x: cmd.x, z: cmd.z, manual: true })) n++;
    }
    if (!n) g.events.emit('toast', { side, text: 'Kỹ năng đang hồi chiêu hoặc chưa có mục tiêu' });
    return n > 0;
  });
}

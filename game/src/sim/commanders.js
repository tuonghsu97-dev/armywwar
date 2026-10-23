// OWNER: agent Chỉ huy & kỹ năng
// Commanders (order 20): GDD §3 F-20..F-25, hypersonic F-46/F-70.
//  - install(): applies the commander passive (COMMANDERS[id].passive.mods -> side.mods), side.tierBonus (read by
//    Unit at spawn) and side.ultimate for both sides BEFORE any unit spawns. Commander is locked for the match
//    (command 'commander' is always rejected, F-25).
//  - Passive mods implemented here: swarmRegen (swarms regrow 1 drone every N s). jamRadius is read by skills.js,
//    rearmSpeed by ai.js rearm(); the others by combat/movement/vision/game.damageStructure.
//  - Command {type:'ultimate', x, z}: costs side.cp (ultimate.cost), cooldown side.ultimateCd.
//      wedge (Miệng Chôn) / steelrain (Mưa Thép) / blockade (Phong Tỏa) / beehive (Đàn Ong) / nightfall (Màn Đêm).
//  - Command {type:'hypersonic', x, z}: costs HYPERSONIC.price money, cooldown side.hypersonicCd, 3 s warning,
//    not a projectile so it can never be intercepted. Human-in-the-loop: only issued by the player or the AI
//    commander of an AI side (never by unit AI).
//  - AI sides use ultimates/hypersonic through game.issue unless game.enemyAIHandlesAbilities = true (set it from
//    enemyAI.js if that module takes over; helpers aiUltimateCommand/aiHypersonicCommand are exported).
// Events: 'ultimate' {side, id, name, x, z, r, duration}, 'ultimate:end' {side, id}, 'strike:warn' {x,z,r,t,side},
//   'strike:impact' {x,z,r,side}, 'hack' {unit, on}, 'explosion', 'toast'.
import { COMMANDERS } from '../data/commanders.js';
import { HYPERSONIC } from '../data/units.js';
import { fire } from './combat.js';
import { addBuff, spawnTemp, areaDamage, fakeSource, misdirect } from './skills.js';
import * as weather from './weather.js';
import { nearestPassable } from './path.js';

export const HYPERSONIC_DELAY = 3;

// Gameplay parameters for each ultimate (radius r is also used by the UI aim circle).
export const ULTIMATES = {
  wedge: { r: 10, duration: 15, speed: 1.4, armor: 0.4 },
  steelrain: { r: 14, duration: 10, waves: 8, interval: 1.1, bombs: 5, dmg: 170, splash: 4.5 },
  blockade: { r: 18, duration: 12, salvo: 3, dmg: 240 },
  beehive: { r: 12, duration: 45, drones: 40, swarms: 4 },
  nightfall: { r: 40, duration: 12, hacks: 3 },
};

export function commanderOf(game, side) { return COMMANDERS[game.sides[side].commander] || COMMANDERS.steel; }
export function ultimateInfo(game, side) { const c = commanderOf(game, side); return { ...c.ultimate, ...ULTIMATES[c.ultimate.id] }; }

function mergeMods(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = v && typeof v === 'object' ? { ...(a[k] || {}), ...v } : v;
  return out;
}

export function applyCommander(game, side) {
  if (!COMMANDERS[side.commander]) side.commander = 'steel';
  const c = COMMANDERS[side.commander];
  side.mods = mergeMods(side.mods || {}, c.passive.mods);
  side.tierBonus = { ...c.tierBonus };
  side.ultimate = { ...c.ultimate, ...ULTIMATES[c.ultimate.id] };
  side.ultimateCdMax = c.ultimate.cooldown;
  side.hypersonicCdMax = HYPERSONIC.cooldown;
  side.commanderLocked = true;
}

export function rearmMultiplier(game, u) {
  return 1 + (game.sides[u.side].mods.rearmSpeed?.[u.def.group] || 0);
}

// ---------------- ultimates ----------------
const START = {
  wedge(game, side, x, z, U, fx) {
    const us = game.sideUnits(side).filter(u => u.isGround && (u.def.group === 'tank' || u.def.group === 'infantry') && u.speed > 0 && !u.carriedBy);
    if (!us.length) return 'Không có tank / bộ binh để xếp mũi chêm';
    const cx = us.reduce((a, u) => a + u.x, 0) / us.length, cz = us.reduce((a, u) => a + u.z, 0) / us.length;
    let dx = x - cx, dz = z - cz; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    const px = -dz, pz = dx;
    us.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    us.forEach((u, i) => {
      const k = Math.ceil(i / 2), s = i % 2 ? 1 : -1;
      // Wedge tip at the point, then plough 12 units beyond it.
      const tx = x + dx * (12 - k * 3) + px * k * 2.6 * s, tz = z + dz * (12 - k * 3) + pz * k * 2.6 * s;
      u.order = { type: 'move', x: tx, z: tz, wedge: true, issued: game.time, home: { x: u.x, z: u.z } };
      u.path = null; u.dest = null; u.forcedTarget = null; u.focusId = null;
      addBuff(game, u, 'speed', U.speed, U.duration, 'wedge');
      addBuff(game, u, 'armor', u.armor * U.armor, U.duration, 'wedge');
    });
    fx.unitIds = us.map(u => u.id);
    return null;
  },
  steelrain(game, side, x, z, U, fx) {
    fx.next = game.time + 1.2; fx.wave = 0;
    game.events.emit('strike:warn', { x, z, r: U.r, t: 1.2, side });
    return null;
  },
  blockade(game, side, x, z, U, fx) { fx.next = game.time + 0.5; return null; },
  beehive(game, side, x, z, U, fx) {
    const per = Math.round(U.drones / U.swarms), a0 = game.rng.next() * Math.PI;
    fx.unitIds = [];
    for (let i = 0; i < U.swarms; i++) {
      const a = a0 + i / U.swarms * Math.PI * 2, R = 26;
      const u = spawnTemp(game, side, 'swarm_fpv', x + Math.cos(a) * R, z + Math.sin(a) * R,
        { swarm: per, life: U.duration, order: { type: 'attack', x, z } });
      fx.unitIds.push(u.id);
    }
    return null;
  },
  nightfall(game, side, x, z, U, fx) {
    const victims = [...game.units.values()].filter(u => u.alive && u.side !== side && u.def.remote && !u.carriedBy && !(u.hacked > 0) && Math.hypot(u.x - x, u.z - z) <= U.r)
      .sort((a, b) => b.def.price - a.def.price || a.id - b.id).slice(0, U.hacks);
    // "Hack kéo dài" (F-81): a living T3 EW unit of this side extends the hack.
    let extra = 0;
    for (const o of game.units.values()) if (o.alive && o.side === side && o.acc?.hackExtra) extra = Math.max(extra, o.acc.hackExtra);
    for (const u of victims) hack(game, u, side, U.duration + extra);
    fx.hacked = victims.map(u => u.id);
    return null;
  },
};

const TICK_FX = {
  wedge(game, e, U) {
    // Plough through: tanks in the wedge crush enemy infantry they drive over.
    for (const id of e.unitIds) {
      const u = game.units.get(id);
      if (!u || !u.alive || u.def.group !== 'tank') continue;
      for (const o of game.unitsNear(u.x, u.z, 2.4, o => o.side !== e.side && o.def.group === 'infantry' && o.isGround)) game.damage(o, 40 * TICK_DT(game), 'kinetic', u);
    }
  },
  steelrain(game, e, U) {
    if (e.wave >= U.waves || game.time < e.next) return;
    e.next = game.time + U.interval; e.wave++;
    const src = fakeSource(e.side, 'air');
    for (let i = 0; i < U.bombs; i++) {
      const a = game.rng.next() * Math.PI * 2, r = Math.sqrt(game.rng.next()) * U.r;
      areaDamage(game, src, e.x + Math.cos(a) * r, e.z + Math.sin(a) * r, U.splash, U.dmg, 'he', { fx: 'bomb', layers: ['ground', 'sea', 'low'] });
    }
  },
  blockade(game, e, U) {
    for (const u of game.unitsNear(e.x, e.z, U.r, u => u.side !== e.side && u.layer === 'sub')) {
      (u.revealedTo ||= [0, 0])[e.side] = game.time + 1.5;  // sonar reveal for the navy side
    }
    if (game.time < e.next) return;
    e.next = game.time + 1;
    const targets = game.unitsNear(e.x, e.z, U.r, u => u.side !== e.side && (u.layer === 'ground' || u.layer === 'sea') && !u.carriedBy)
      .sort((a, b) => b.def.price - a.def.price).slice(0, U.salvo);
    if (targets.length < U.salvo) targets.push(...game.structuresNear(e.x, e.z, U.r, s => s.side !== e.side).slice(0, U.salvo - targets.length));
    const launcher = launchPoint(game, e);
    for (const t of targets) fire(game, launcher, t, { dmg: U.dmg, kind: 'missile', dmgType: 'he' });
  },
  beehive() {},
  nightfall(game, e, U) {
    const t = game.time;
    for (const u of game.unitsNear(e.x, e.z, U.r, u => u.side !== e.side)) {
      u.jammed = Math.max(u.jammed || 0, 0.3);   // comms jammed (remote units slowed/misfire; sight reduced)
      u.radarJammed = t + 0.3;                    // radar detection disabled (vision.js)
    }
    for (const s of game.structuresNear(e.x, e.z, U.r, s => s.side !== e.side)) s.radarJammed = t + 0.3;
    for (const p of game.projectiles) {
      if (p.dead || p.side === e.side || p.nfChecked || !(p.kind === 'missile' || p.kind === 'rocket')) continue;
      if (Math.hypot(p.x - e.x, p.z - e.z) > U.r) continue;
      p.nfChecked = true;
      if (game.rng.chance(0.6)) misdirect(game, p);
    }
  },
};
const TICK_DT = () => 1 / 20;

const END_FX = {
  wedge(game, e) {
    for (const id of e.unitIds) {
      const u = game.units.get(id);
      if (u && u.alive && u.order?.wedge) u.order = { type: 'attack', x: e.x, z: e.z, issued: game.time, home: u.order.home };
    }
  },
};

function launchPoint(game, e) {
  let best = null, bd = 140;
  for (const u of game.units.values()) if (u.alive && u.side === e.side && u.isNaval) { const d = Math.hypot(u.x - e.x, u.z - e.z); if (d < bd) { bd = d; best = u; } }
  const base = game.map.bases[e.side];
  let x, z;
  if (best) { x = best.x; z = best.z; } else {
    const dx = base.x - e.x, dz = base.z - e.z, d = Math.hypot(dx, dz) || 1;
    x = e.x + dx / d * Math.min(40, d); z = e.z + dz / d * Math.min(40, d);
  }
  return { id: -1, side: e.side, x, z, alt: 0, dmg: 0, ammo: Infinity, stealth: 0, cooldownMult: 1, def: { id: 'cruise', group: 'navy', dmgType: 'he', hits: ['ground', 'sea'] } };
}

export function hack(game, u, side, dur) {
  u.hacked = dur;
  u.side = side;
  u.order = { type: 'idle' }; u.target = null; u.forcedTarget = null; u.focusId = null; u.kTarget = null;
  u.path = null; u.dest = null; u.moveTarget = null;
  game.events.emit('hack', { unit: u, on: true });
}
function unhack(game, u) {
  u.hacked = 0;
  u.side = u.originalSide;
  u.order = { type: 'idle' }; u.target = null; u.forcedTarget = null; u.focusId = null; u.kTarget = null;
  u.path = null; u.dest = null; u.moveTarget = null;
  game.events.emit('hack', { unit: u, on: false });
}

// ---------------- commands ----------------
// "Gọi viện" (F-07): command points buy reinforcements at the HQ — 2 infantry squads + 1 APC. They are support
// troops (u.troop), not formation weapons, so they never take one of the 9 slots.
export const REINFORCE = { cost: 40, cooldown: 90, squads: 2, squad: 50, vehicle: 'apc' };
function reinforceCmd(game, side, cmd) {
  const s = game.sides[side];
  const say = text => game.events.emit('toast', { side, text });
  if (game.phase !== 'battle') { say('Chỉ gọi viện khi đang chiến đấu'); return false; }
  if ((s.reinforceCd || 0) > game.time) { say(`Gọi viện đang hồi (${Math.ceil(s.reinforceCd - game.time)} giây)`); return false; }
  if (s.cp < REINFORCE.cost) { say(`Không đủ điểm chỉ huy (cần ${REINFORCE.cost})`); return false; }
  const need = REINFORCE.squads * REINFORCE.squad + 3;
  if (s.troops.reserve < need) { say(`Không đủ binh lính dự bị (cần ${need})`); return false; }
  const hq = game.hq(side) || game.map.bases[side];
  const dir = side === 0 ? 1 : -1;
  const at = nearestPassable(game.map, 'ground', hq.x + dir * 9, hq.z, 20) || { x: hq.x + dir * 9, z: hq.z };
  s.cp -= REINFORCE.cost; s.reinforceCd = game.time + REINFORCE.cooldown;
  const units = [game.spawn(side, REINFORCE.vehicle, at.x, at.z, { extra: { troop: true, reinforcement: true } })];
  for (let i = 0; i < REINFORCE.squads; i++) {
    const p = nearestPassable(game.map, 'ground', at.x + dir * 2, at.z + (i ? 3 : -3), 8) || at;
    const inf = game.spawn(side, 'infantry', p.x, p.z, { soldiers: REINFORCE.squad, extra: { troop: true, reinforcement: true } });
    s.troops.reserve -= inf.soldiers; s.troops.active += inf.soldiers;
    units.push(inf);
  }
  game.events.emit('reinforce', { side, units, x: at.x, z: at.z });
  say(`Viện binh đã tới thành chỉ huy: ${REINFORCE.squads} tiểu đội bộ binh + 1 xe bọc thép (−${REINFORCE.cost} CP)`);
  return true;
}

function ultimateCmd(game, side, cmd) {
  const s = game.sides[side];
  const U = s.ultimate || ultimateInfo(game, side);
  const say = text => game.events.emit('toast', { side, text });
  if (game.phase !== 'battle') { say('Chỉ dùng lệnh tối thượng khi đang chiến đấu'); return false; }
  if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.z)) return false;
  if (s.ultimateCd > 0) { say(`${U.name} đang hồi chiêu (${Math.ceil(s.ultimateCd)} giây)`); return false; }
  if (s.cp < U.cost) { say(`Không đủ điểm chỉ huy (cần ${U.cost})`); return false; }
  const x = Math.max(1, Math.min(game.map.w - 1, cmd.x)), z = Math.max(1, Math.min(game.map.h - 1, cmd.z));
  const P = ULTIMATES[U.id];
  const fx = { id: U.id, side, x, z, r: P.r, t0: game.time, end: game.time + P.duration };
  const err = START[U.id](game, side, x, z, P, fx);
  if (err) { say(err); return false; }
  s.cp -= U.cost;
  s.ultimateCd = U.cooldown;
  s.stats.ultimates = (s.stats.ultimates || 0) + 1;
  game.ultimates.push(fx);
  game.events.emit('ultimate', { side, id: U.id, name: U.name, x, z, r: P.r, duration: P.duration });
  game.events.emit('toast', { side, text: `Lệnh tối thượng: ${U.name}!` });
  game.events.emit('toast', { side: 1 - side, text: `Địch dùng lệnh tối thượng: ${U.name}!` });
  return true;
}

function hypersonicCmd(game, side, cmd) {
  const s = game.sides[side];
  const say = text => game.events.emit('toast', { side, text });
  if (game.phase !== 'battle') { say('Chỉ phóng tên lửa khi đang chiến đấu'); return false; }
  if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.z)) return false;
  if (s.hypersonicCd > 0) { say(`Tên lửa siêu thanh đang hồi (${Math.ceil(s.hypersonicCd)} giây)`); return false; }
  if (s.money < HYPERSONIC.price) { say('Không đủ tiền mua tên lửa siêu thanh'); return false; }
  s.money -= HYPERSONIC.price;
  s.spent = (s.spent || 0) + HYPERSONIC.price;
  s.hypersonicCd = HYPERSONIC.cooldown;
  s.stats.hypersonic = (s.stats.hypersonic || 0) + 1;
  const x = Math.max(1, Math.min(game.map.w - 1, cmd.x)), z = Math.max(1, Math.min(game.map.h - 1, cmd.z));
  game.strikes.push({ side, x, z, at: game.time + HYPERSONIC_DELAY });
  game.events.emit('strike:warn', { x, z, r: HYPERSONIC.splash, t: HYPERSONIC_DELAY, side, kind: 'hypersonic' });
  say(`Đã phóng ${HYPERSONIC.name}!`);
  game.events.emit('toast', { side: 1 - side, text: 'Cảnh báo: tên lửa siêu thanh đang lao tới!' });
  return true;
}

function detonate(game, st) {
  const src = fakeSource(st.side, 'hypersonic', HYPERSONIC.dmgType);
  areaDamage(game, src, st.x, st.z, HYPERSONIC.splash, HYPERSONIC.dmg, HYPERSONIC.dmgType,
    { fx: 'hypersonic', layers: ['ground', 'sea', 'low', 'sub'], structMult: 1 });
  game.events.emit('strike:impact', { x: st.x, z: st.z, r: HYPERSONIC.splash, side: st.side, kind: 'hypersonic' });
}

// ---------------- AI commander helpers ----------------
function densestEnemy(game, side, r = 8, pred) {
  const es = [...game.units.values()].filter(u => u.alive && u.side !== side && u.visible[side] && !u.carriedBy && (!pred || pred(u)));
  let best = null, bv = 0;
  for (const e of es) {
    let v = 0;
    for (const o of es) if (Math.hypot(o.x - e.x, o.z - e.z) < r) v += 1 + o.def.price / 2e8;
    if (v > bv) { bv = v; best = e; }
  }
  return best ? { x: best.x, z: best.z, v: bv } : null;
}

export function aiUltimateCommand(game, side) {
  const s = game.sides[side], U = s.ultimate;
  if (!U || s.ultimateCd > 0 || s.cp < U.cost || game.phase !== 'battle') return null;
  let t = null;
  if (U.id === 'wedge') {
    t = densestEnemy(game, side, 10, u => u.isGround);
    if (!t) { const hq = game.hq(1 - side); if (hq && game.battleTime > 120) t = { x: hq.x, z: hq.z, v: 3 }; }
  } else if (U.id === 'nightfall') t = densestEnemy(game, side, 20, u => u.def.remote) || densestEnemy(game, side, 20);
  else if (U.id === 'blockade') t = densestEnemy(game, side, 14, u => u.isNaval || u.isGround);
  else t = densestEnemy(game, side, U.r * 0.7);
  if (!t || t.v < 3) return null;
  return { type: 'ultimate', x: t.x, z: t.z };
}

export function aiHypersonicCommand(game, side) {
  const s = game.sides[side];
  if (s.hypersonicCd > 0 || s.money < HYPERSONIC.price * 4 || game.phase !== 'battle') return null;
  const t = densestEnemy(game, side, HYPERSONIC.splash);
  if (t && t.v >= 4) return { type: 'hypersonic', x: t.x, z: t.z };
  const hq = game.hq(1 - side);
  if (hq && hq.alive && hq[`seen${side}`] && hq.hp < hq.maxHp * 0.5) return { type: 'hypersonic', x: hq.x, z: hq.z };
  return null;
}

// ---------------- system ----------------
export const commanderSystem = {
  name: 'commanders',
  init(game) {
    game.ultimates ||= [];
    game.strikes ||= [];
  },
  update(game, dt) {
    const t = game.time;
    // Hacked units return to their side when the hack expires (or on death).
    for (const u of game.units.values()) {
      if (!(u.hacked > 0)) continue;
      u.hacked -= dt;
      if (u.hacked <= 0 || !u.alive) unhack(game, u);
    }
    if (game.phase !== 'battle') return;
    for (const s of game.sides) {
      if (s.ultimateCd > 0) s.ultimateCd = Math.max(0, s.ultimateCd - dt);
      if (s.hypersonicCd > 0) s.hypersonicCd = Math.max(0, s.hypersonicCd - dt);
      // Passive: swarm regen (Dây Chuyền Sản Xuất).
      if (s.mods.swarmRegen) {
        s.swarmRegenT = (s.swarmRegenT || 0) + dt;
        if (s.swarmRegenT >= s.mods.swarmRegen) {
          s.swarmRegenT = 0;
          for (const u of game.units.values())
            if (u.alive && u.side === s.id && u.swarmMax && !u.temporary && u.swarm < u.swarmMax) { u.swarm++; u.hp = Math.min(u.maxHp, u.hp + u.perDrone); }
        }
      }
    }
    // rearmSpeed is applied by sim/ai.js rearm() (reads side.mods.rearmSpeed).
    // Active ultimates
    for (const e of game.ultimates) {
      const P = ULTIMATES[e.id];
      if (t <= e.end) TICK_FX[e.id]?.(game, e, P);
      else if (!e.done) { e.done = true; END_FX[e.id]?.(game, e, P); game.events.emit('ultimate:end', { side: e.side, id: e.id }); }
    }
    if (game.ultimates.length) game.ultimates = game.ultimates.filter(e => !e.done);
    // Hypersonic impacts
    if (game.strikes.length) {
      const due = game.strikes.filter(s => s.at <= t);
      if (due.length) { game.strikes = game.strikes.filter(s => s.at > t); for (const s of due) detonate(game, s); }
    }
    // AI commanders (only sides flagged ai).
    if (!game.enemyAIHandlesAbilities && game.opts.aiAbilities !== false && game.tick % 60 === 0) {
      for (const s of game.sides) {
        if (!s.ai) continue;
        const u = aiUltimateCommand(game, s.id); if (u) game.issue(s.id, u);
        const h = aiHypersonicCommand(game, s.id); if (h) game.issue(s.id, h);
      }
    }
  },
};

export function install(game) {
  for (const s of game.sides) applyCommander(game, s);   // before any unit spawns (deploy happens in step())
  game.addSystem(commanderSystem, 20);
  weather.install(game);
  game.onCommand('ultimate', ultimateCmd);
  game.onCommand('reinforce', reinforceCmd);
  game.onCommand('hypersonic', hypersonicCmd);
  game.onCommand('commander', (g, side) => { g.events.emit('toast', { side, text: 'Chỉ huy đã khóa khi vào trận — đổi ở màn chuẩn bị' }); return false; });
}

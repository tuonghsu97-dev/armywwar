// Combat (order 50): target acquisition (utility score), firing, projectiles, interception, splash.
// GDD §4 damage types + counter loop (F-50/F-51), §5 unit-level AI (auto target, F-71).
// Other modules may set u.target / u.forcedTarget; combat only auto-acquires when the current target is invalid.
import { COUNTERS, DMG_TYPES, counterGroup } from '../data/units.js';
import { losBlocked } from './vision.js';

// Burning damage over time from 'fire' splash (F-50).
export const BURN = { duration: 4, dpsFrac: 0.06 };

const PROJ = {
  kinetic: { kind: 'shell', speed: 70 },
  he: { kind: 'missile', speed: 34 },
  fire: { kind: 'shell', speed: 40 },
  emp: { kind: 'beam', speed: 0 },
  laser: { kind: 'beam', speed: 0 },
};

export function canHit(u, t) {
  if (!t.alive) return false;
  if (t.kind === 'structure') return (u.def.hits || []).includes('ground') || (u.def.hits || []).includes('sea');
  if (t.carriedBy || t.tunnel) return false;   // tunnel: underground (sim/tunnels.js)
  return (u.def.hits || []).includes(t.layer);
}

export function effRange(game, u) {
  const m = game.sides[u.side].mods;
  return u.range * (1 + (m.rangeGroup?.[u.def.group] || 0)) * (u.rangeBoost || 1) * (u.weatherRange || 1); // weatherRange: sim/weather.js
}

export function computeDamage(game, a, t, base = a.dmg, dmgType = a.def.dmgType) {
  let dmg = base;
  if (t.kind !== 'structure') {
    const mult = COUNTERS[a.def.group]?.[counterGroup(t.def)] || 1;
    dmg *= mult;
    if (a.def.vsManned && t.def.group === 'air' && !t.def.remote) dmg *= a.def.vsManned; // Iron Dome vs manned aircraft
    const pierce = DMG_TYPES[dmgType]?.armorPierce ?? 0.5;
    const tm = game.sides[t.side].mods;
    const armor = Math.min(0.85, t.armor + (tm.armorGroup?.[t.def.group] || 0) + (t.armorBoost || 0));
    dmg *= 1 - armor * (1 - pierce);
    if (dmgType === 'emp') dmg *= t.def.remote ? 3 : 0.4;
    if (dmgType === 'laser' && (t.def.group === 'drone' || t.def.group === 'air')) dmg *= 1.5;
    if (dmgType === 'he' && tm.missileResist) dmg *= 1 - tm.missileResist;
  }
  return dmg;
}

// Utility AI target score (GDD §5 "Utility AI chọn mục tiêu theo điểm").
export function targetScore(game, u, t) {
  const d = Math.hypot(t.x - u.x, t.z - u.z);
  let s = 100 - d;
  if (t.kind === 'structure') s += t.type === 'hq' ? 15 : t.armed ? 10 : 0;
  else {
    s += (COUNTERS[u.def.group]?.[counterGroup(t.def)] || 1) * 25;
    s += (1 - t.hp / t.maxHp) * 20;              // finish wounded
    if (t.spotted > 0) s += 15;                  // marked by recon drone
    if (u.order?.type === 'sead' && (t.def.group === 'aa' || t.def.id === 'laser')) s += 80;
    if (u.focusId && t.id === u.focusId) s += 200;
    s += Math.min(30, t.def.price / 5e7);        // high value
  }
  // Extension point (sim/ai.js registers the tactical utility terms): fn(game, u, t, score) -> score.
  if (game.targetScoreHooks) for (const fn of game.targetScoreHooks) s = fn(game, u, t, s);
  return s;
}

export function acquireTarget(game, u) {
  const r = effRange(game, u) + 2;
  let best = null, bestS = -Infinity;
  const enemySide = 1 - u.side;
  const cand = game.unitsNear(u.x, u.z, r, o => o.side !== u.side && o.visible[u.side] && canHit(u, o));
  for (const o of cand) { const s = targetScore(game, u, o); if (s > bestS) { bestS = s; best = o; } }
  for (const s of game.structuresNear(u.x, u.z, r + 3, s => s.side === enemySide && canHit(u, s))) {
    const sc = targetScore(game, u, s) - 10; if (sc > bestS) { bestS = sc; best = s; }
  }
  return best;
}

export function inRange(game, u, t) {
  const d = Math.hypot(t.x - u.x, t.z - u.z) - (t.kind === 'structure' ? 3 : 0);
  return d <= effRange(game, u) && d >= (u.def.minRange || 0);
}

export function fire(game, u, t, opts = {}) {
  const dmgType = opts.dmgType || u.def.dmgType;
  const p = PROJ[dmgType] || PROJ.kinetic;
  let kind = opts.kind || p.kind;
  if (u.def.splash && (u.def.id === 'spg' || u.def.id === 'himars')) kind = 'rocket';
  if (u.def.id === 'submarine' && t.layer && (t.layer === 'sea' || t.layer === 'sub')) kind = 'torpedo';
  if (u.def.id === 'bomber') kind = 'bomb';
  if (u.def.id === 'infantry' || u.def.id === 'apc' || u.def.id === 'ugv') kind = 'bullet';
  let base = opts.dmg ?? u.dmg;
  if (kind === 'torpedo' && u.acc?.torpedoDmg) base *= u.acc.torpedoDmg; // "Ngư lôi dẫn đường" (F-81)
  const dmg = computeDamage(game, u, t, base, dmgType);
  const proj = {
    id: game.nextId++, kind, side: u.side, from: u.id, x: u.x, z: u.z, y: u.alt + 0.8,
    tx: t.x, tz: t.z, target: t, dmg, dmgType, splash: opts.splash ?? u.def.splash ?? 0,
    speed: kind === 'rocket' ? 30 : kind === 'torpedo' ? 18 : kind === 'bomb' ? 12 : p.speed,
    interceptable: kind === 'missile' || kind === 'rocket', t: 0,
  };
  proj.dist = Math.hypot(proj.tx - proj.x, proj.tz - proj.z);
  if (kind === 'beam' || kind === 'bullet' || proj.speed === 0) { impact(game, proj); }
  else game.projectiles.push(proj);
  game.events.emit('fire', { from: u, to: t, proj });
  if (u.ammo !== Infinity) u.ammo--;
  if (u.stealth > 0 && !u.keepStealthOnFire) u.stealth = Math.min(u.stealth, 0.5);
}

function impact(game, p) {
  const src = game.units.get(p.from) || { side: p.side, id: p.from, def: {} };
  if (p.splash > 0) {
    game.events.emit('explosion', { x: p.tx, z: p.tz, r: p.splash, type: p.kind });
    for (const o of game.unitsNear(p.tx, p.tz, p.splash, o => o.side !== p.side && !o.isAir && o.layer !== 'sub')) {
      const f = 1 - Math.hypot(o.x - p.tx, o.z - p.tz) / (p.splash * 1.4);
      game.damage(o, p.dmg * f, p.dmgType, src);
      // 'fire' (thermobaric shells, F-50): ground units in the blast keep burning for a few seconds.
      if (p.dmgType === 'fire' && o.alive && o.layer === 'ground') o.burn = { until: game.time + BURN.duration, dps: p.dmg * BURN.dpsFrac * (1 - (o.armor || 0) * 0.55), side: p.side, from: p.from };
    }
    for (const s of game.structuresNear(p.tx, p.tz, p.splash + 3, s => s.side !== p.side)) game.damage(s, p.dmg * 0.8, p.dmgType, src);
  } else if (p.target && p.target.alive) {
    const t = p.target;
    const miss = t.kind !== 'structure' && Math.hypot(t.x - p.tx, t.z - p.tz) > 6 && p.kind !== 'missile' && p.kind !== 'torpedo';
    if (!miss) game.damage(t, p.dmg, p.dmgType, src);
    if (p.kind !== 'bullet') game.events.emit('explosion', { x: t.x, z: t.z, r: 1.2, type: p.kind, y: t.alt });
  }
}

export const combatSystem = {
  name: 'combat',
  update(game, dt) {
    // Projectiles
    for (const p of game.projectiles) {
      if (p.dead) continue;
      if ((p.kind === 'missile' || p.kind === 'torpedo') && p.target?.alive) { p.tx = p.target.x; p.tz = p.target.z; }
      const dx = p.tx - p.x, dz = p.tz - p.z, d = Math.hypot(dx, dz), step = p.speed * dt;
      p.t += dt;
      if (d <= step || p.t > 8) { p.x = p.tx; p.z = p.tz; p.dead = true; impact(game, p); continue; }
      p.x += dx / d * step; p.z += dz / d * step;
      const total = Math.max(1, p.dist);
      const prog = 1 - d / total;
      p.y = p.kind === 'rocket' ? 1 + Math.sin(prog * Math.PI) * total * 0.25 : p.kind === 'torpedo' ? -1 : p.kind === 'bomb' ? Math.max(0, 14 * (1 - prog)) : p.y;
    }
    game.projectiles = game.projectiles.filter(p => !p.dead);

    const battle = game.phase === 'battle';
    for (const u of game.units.values()) {
      if (u.burn && u.alive) {
        if (u.burn.until <= game.time) u.burn = null;
        else game.damage(u, u.burn.dps * dt, 'fire', game.units.get(u.burn.from) || { side: u.burn.side, id: u.burn.from, def: {} });
      }
      if (!u.alive || u.carriedBy || u.tunnel) continue;
      if (u.cooldown > 0) u.cooldown -= dt;
      if (!battle || !u.def.rof || u.def.kamikaze || !u.deployed) continue;
      if (u.jammed > 0 && u.def.remote && game.rng.chance(0.5 * dt)) continue;
      if (u.holdFire) continue;
      let t = u.forcedTarget?.alive ? u.forcedTarget : u.target;
      if (!t || !t.alive || !canHit(u, t) || (t.kind !== 'structure' && !t.visible[u.side]) || !inRange(game, u, t)) {
        t = acquireTarget(game, u);
        u.target = t;
      }
      if (!t) continue;
      // GDD §12: artillery needs a spotter; F-90: without one it cannot hit targets behind city blocks either.
      if (u.def.needsSpotter && t.kind !== 'structure' && !(t.spotted > 0) && (Math.hypot(t.x - u.x, t.z - u.z) > u.sight || losBlocked(game, u.x, u.z, t.x, t.z))) continue;
      if (u.ammo <= 0) continue;
      if (u.def.energy) { if (u.energy < 10) { u.energy = Math.min(u.maxEnergy || u.def.energy, u.energy + 8 * dt); continue; } u.energy -= 10; }
      if (u.cooldown <= 0 && inRange(game, u, t)) {
        fire(game, u, t);
        u.cooldown = (1 / u.def.rof) * u.cooldownMult;
        if (!u.moving) u.heading = Math.atan2(t.z - u.z, t.x - u.x);
      }
    }
    for (const u of game.units.values()) if (u.def.energy && u.alive) u.energy = Math.min(u.maxEnergy || u.def.energy, u.energy + 4 * dt);

    // Armed structures (bunkers, HQ) defend themselves.
    if (battle) for (const s of game.structures) {
      if (!s.alive) continue;
      const arm = s.armed || (s.type === 'hq' ? { dmg: 60, range: 24, rof: 0.6, hits: ['ground', 'low', 'air', 'sea'] } : null);
      if (!arm) continue;
      s.cooldown -= dt;
      if (s.cooldown > 0) continue;
      const tgt = game.unitsNear(s.x, s.z, arm.range, o => o.side !== s.side && o.visible[s.side] && arm.hits.includes(o.layer))[0];
      if (tgt) {
        const fake = { id: s.id, side: s.side, x: s.x, z: s.z, alt: 3, dmg: arm.dmg, def: { dmgType: 'kinetic', group: 'structure', hits: arm.hits }, ammo: Infinity, cooldownMult: 1 };
        fire(game, fake, tgt, { kind: 'shell' });
        s.cooldown = 1 / arm.rof;
      }
    }
  },
};

// Interceptors (SAM, Iron Dome, destroyer) shoot down incoming missiles/rockets; tank APS blocks ATGMs.
export const interceptSystem = {
  name: 'intercept',
  update(game, dt) {
    for (const p of game.projectiles) {
      if (p.dead || !p.interceptable || p.checked) continue;
      p.checked = true;
      const near = game.unitsNear(p.tx, p.tz, 34, o => o.side !== p.side && o.alive && o.deployed && (o.def.interceptor || o.def.id === 'destroyer') && (o.interceptCd || 0) <= game.time);
      for (const o of near) {
        if (game.rng.chance((o.def.id === 'iron_dome' ? 0.7 : 0.55) + (o.acc?.interceptBonus || 0))) {
          p.dead = true;
          // Accessory "Đánh chặn kép" (F-81): two intercepts per cooldown.
          o.icUsed = (o.icUsed || 0) + 1;
          if (o.icUsed >= (o.acc?.doubleIntercept ? 2 : 1)) { o.interceptCd = game.time + 1.2; o.icUsed = 0; }
          game.events.emit('intercept', { by: o, proj: p });
          break;
        }
      }
    }
  },
};

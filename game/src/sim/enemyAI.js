// OWNER: agent AI chiến thuật
// Opponent commander AI (order 12) for every side with side.ai. Plays the "strategic" layer the player plays:
//  - deploys by map (navy at sea, air by the airfield, artillery/AA behind, armour in front, lanes by map shape)
//  - assigns slots to lanes, pushes lane objectives (next strongpoint along the lane -> bunker -> HQ)
//  - shuttles infantry with transports to the frontier strongpoints, carries packed AA to strongpoints
//  - counters what it sees (AA/fighters vs air, drones/helis vs tanks, SEAD vs AA, destroyers vs subs, flank vs artillery)
//  - regroups weak lanes, goes all-in on the HQ when ahead, escalates difficulty over time
//  - side.difficulty (0.5–1.5) scales reaction speed and decision quality; game.opts.enemy.learned
//    = { preferredOrders, unitMix } (GDD pillar 4: "enemies get stronger from player data") biases counters.
import { unitDef } from '../data/units.js';
import { nearestPassable, domainOf } from './path.js';
import { categoryOf } from './formation.js';
import { autoAADest } from './transport.js';

const LANES = [26, 75, 124];
const AIR_CATS = new Set(['fighter', 'cca', 'heli', 'recon', 'kamikaze']);
const TRANSPORTS = new Set(['apc', 'heli_transport', 'supply_truck']);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function unitPower(u) {
  return (u.hp * (1 + u.armor)) / 120 + (u.dmg * (u.def.rof || (u.def.kamikaze ? 0.5 : 0))) / 6 * Math.max(1, (u.swarm || 1) / 6);
}

export const enemyAISystem = {
  name: 'enemyAI',
  update(game, dt) {
    for (const side of game.sides) {
      if (!side.ai) continue;
      if (!side.brain) side.brain = makeBrain(game, side);
      if (game.phase === 'deploy' && !side.autoDeployed) {
        side.autoDeployed = true;
        deploy(game, side);
        game.issue(side.id, { type: 'autodeploy' });
        game.issue(side.id, { type: 'ready' });
      }
      if (game.phase !== 'battle') continue;
      const B = side.brain;
      // Escalation over time (GDD pillar 4): up to +35% after 10 minutes, capped at 1.5.
      side.difficulty = clamp(B.baseDifficulty * (1 + 0.35 * Math.min(1, game.battleTime / 600)), 0.5, 1.5);
      B.timer -= dt;
      if (B.timer > 0) continue;
      B.timer = (B.thinks === 0 ? 1 : 7.5 / side.difficulty);
      B.thinks++;
      think(game, side, B);
    }
  },
};

function makeBrain(game, side) {
  const cfg = side.id === 0 ? game.opts.player : game.opts.enemy;
  const learned = cfg?.learned || (side.id === 1 ? game.opts.enemy?.learned : null) || {};
  const base = clamp(cfg?.difficulty ?? side.difficulty ?? 1, 0.5, 1.5);
  side.difficulty = base;
  const mix = learned.unitMix || {};
  const prefs = normPrefs(learned.preferredOrders);
  return {
    baseDifficulty: base, timer: 2, thinks: 0, laneOf: {}, laneOrders: {}, startPower: {}, counters: new Map(),
    aaSent: new Set(), learned: { mix, prefs },
    // counter weights per enemy group, biased by the player's historical army (more air -> more AA priority, ...)
    w: { air: 1 + (mix.air || 0) * 2, drone: 1 + (mix.drone || 0) * 2, tank: 1 + (mix.tank || 0) * 2, navy: 1 + (mix.navy || 0) * 2, sub: 1 + (mix.sub || 0) * 2, aa: 1 + (mix.aa || 0) * 2 },
    guardFlanks: (prefs.flank || 0) > 0.2,
    rng: game.rng,
  };
}
function normPrefs(p) {
  if (!p) return {};
  if (Array.isArray(p)) { const o = {}; for (const k of p) o[k] = (o[k] || 0) + 1; p = o; }
  const tot = Object.values(p).reduce((a, b) => a + b, 0) || 1;
  const o = {}; for (const k in p) o[k] = p[k] / tot; return o;
}

// ---------------------------------------------------------------- deployment by map
function laneSet(game) { return game.map.id === 'bay' ? { ground: [0, 2], naval: [1] } : { ground: [0, 1, 2], naval: [1] }; }

function deploy(game, side) {
  const B = side.brain, zn = game.map.deployZones[side.id], s = side.id;
  const front = s === 0 ? zn.x1 - 6 : zn.x0 + 6, rear = s === 0 ? zn.x0 + 10 : zn.x1 - 10, mid = (front + rear) / 2;
  const L = laneSet(game);
  let gi = 0;
  const counts = [0, 0, 0];
  side.formation.forEach((slot, i) => {
    if (slot.deployed) return;
    const def = unitDef(slot.unit);
    const cat = categoryOf({ def });
    let lane, x, z;
    if (def.layer === 'sea' || def.layer === 'sub') {
      lane = 1;
      const p = nearestPassable(game.map, domainOf({ layer: def.layer }), s === 0 ? 34 : 206, 75 + (counts[1]++ % 3 - 1) * 6, 40);
      if (!p) { B.laneOf[i] = 1; return; }
      x = p.x; z = p.z;
    } else if (def.layer === 'air' || def.layer === 'low') {
      lane = cat === 'kamikaze' || cat === 'recon' || cat === 'heli' ? L.ground[gi++ % L.ground.length] : 1;
      const af = game.structures.find(st => st.type === 'airfield' && st.side === s);
      x = af ? clamp(af.x + (s === 0 ? 6 : -6), zn.x0 + 2, zn.x1 - 2) : mid; z = af ? af.z + (i % 3) * 4 - 4 : LANES[lane];
      if (cat === 'kamikaze' || cat === 'recon') { x = front; z = LANES[lane]; }
    } else {
      lane = def.needsTransport ? 1 : L.ground[(cat === 'tank' || cat === 'infantry' ? gi++ : (gi + i)) % L.ground.length];
      if (game.map.id !== 'bay' && cat === 'tank' && counts[1] < 2) lane = 1; // heavy armour leads the middle first
      x = (cat === 'artillery' || cat === 'aa' || cat === 'ew' || def.needsTransport) ? (def.needsTransport ? rear : mid) : front;
      if (cat === 'transport') x = mid;
      z = LANES[lane] + ((counts[lane]++ % 3) - 1) * 5;
      const p = nearestPassable(game.map, 'ground', x, z, 30);
      if (!p) return;
      x = p.x; z = p.z;
    }
    B.laneOf[i] = lane;
    x = clamp(x, zn.x0 + 1, zn.x1 - 1); z = clamp(z, zn.z0 + 1, zn.z1 - 1);
    game.issue(s, { type: 'deploy', slot: i, x, z });
  });
}

// ---------------------------------------------------------------- strategic thinking
function think(game, side, B) {
  const s = side.id, foe = 1 - s;
  const mine = [], enemiesSeen = [];
  for (const u of game.units.values()) {
    if (!u.alive || u.carriedBy) continue;
    if (u.side === s) mine.push(u); else if (u.visible[s]) enemiesSeen.push(u);
  }
  for (const u of mine) if (B.laneOf[u.group] == null) B.laneOf[u.group] = nearestLane(u.z);
  const myPow = mine.reduce((a, u) => a + unitPower(u), 0);
  const foePow = enemiesSeen.reduce((a, u) => a + unitPower(u), 0) + 0.4 * game.sideUnits(foe).length; // fog estimate
  const owned = game.strongpoints.filter(sp => sp.owner === s).length;
  const foeOwned = game.strongpoints.filter(sp => sp.owner === foe).length;
  const quality = 0.45 + 0.4 * side.difficulty;          // chance to execute a smart counter this think
  const foeHq = game.hq(foe);
  let ahead = foeHq && ((owned >= 4 && myPow > foePow * 1.3) || (myPow > foePow * 2.2 && game.battleTime > 90) || game.battleTime > 540 && myPow > foePow); // late push from 9 min (F-16: 8–12 min matches)
  // Hysteresis: once committed to the HQ push, keep pushing ~60 s unless clearly losing the fight.
  if (ahead) B.pushUntil = game.time + 60;
  else if (B.pushUntil > game.time && myPow > foePow * 0.9) ahead = true;
  B.mode = ahead ? 'push' : 'normal';

  // Composition seen (biased by learned player mix).
  const seen = { air: 0, tank: 0, navy: 0, sub: 0, aa: 0, artillery: [], subs: [], tanks: [], aaUnits: [], airUnits: [] };
  for (const e of enemiesSeen) {
    const c = categoryOf(e);
    if (e.isAir) { seen.air += B.w.air; seen.airUnits.push(e); }
    if (c === 'tank' || c === 'transport' && e.isGround) { seen.tank += B.w.tank; seen.tanks.push(e); }
    if (c === 'ship') seen.navy += B.w.navy;
    if (e.layer === 'sub') { seen.sub += B.w.sub; seen.subs.push(e); }
    if (c === 'aa' || e.def.id === 'destroyer') { seen.aa += B.w.aa; seen.aaUnits.push(e); }
    if (c === 'artillery') seen.artillery.push(e);
  }

  // Groups by role.
  const byLane = [[], [], []], air = [], transports = [], packedAA = [], navy = [];
  for (const u of mine) {
    const c = categoryOf(u);
    if (u.def.needsTransport) { if (!u.deployed) packedAA.push(u); continue; }
    if (u.order.type === 'retreat' || u.tTask?.kind === 'aa') continue;
    if (TRANSPORTS.has(u.def.id)) { transports.push(u); continue; }
    if (AIR_CATS.has(c)) { air.push(u); continue; }
    if (u.isNaval) { navy.push(u); continue; }
    if (u.speed <= 0) continue;
    byLane[B.laneOf[u.group] ?? 1].push(u);
  }
  for (const k of [0, 1, 2]) if (B.startPower[k] == null && byLane[k].length) B.startPower[k] = byLane[k].reduce((a, u) => a + unitPower(u), 0);

  // --- 1. lanes
  const objectives = [];
  for (let lane = 0; lane < 3; lane++) {
    const force = byLane[lane].filter(u => !counterBusy(game, B, u));
    if (!force.length) continue;
    const pow = force.reduce((a, u) => a + unitPower(u), 0);
    const obj = laneObjective(game, s, lane, ahead);
    if (!obj) continue;
    objectives.push({ lane, ...obj });
    const enemyNear = enemiesSeen.filter(e => Math.hypot(e.x - obj.x, e.z - obj.z) < 28).reduce((a, e) => a + unitPower(e), 0);
    let type = 'attack';
    // Regroup a lane that has bled out (keep what's left alive, GDD "Rút lui/Tái lập").
    if (pow < (B.startPower[lane] || pow) * 0.3 && enemyNear > pow * 1.2 && !ahead) {
      const fall = lastOwnedOnLane(game, s, lane) || homePoint(game, s, lane);
      issueIfChanged(game, side, B, `lane${lane}`, force, 'defend', fall.x, fall.z, 40);
      continue;
    }
    if (enemyNear > pow * 1.1 && game.rng.chance(quality * 0.5) && force.some(u => u.speed >= 3.5) && !ahead) type = 'flank';
    else if (obj.kind === 'sp' && force.every(u => u.def.group === 'infantry')) type = 'capture';
    // Artillery of the lane suppresses the objective instead of driving into it.
    const arty = force.filter(u => categoryOf(u) === 'artillery');
    const rest = force.filter(u => categoryOf(u) !== 'artillery');
    if (arty.length) issueIfChanged(game, side, B, `lane${lane}a`, arty, enemyNear > 0 ? 'suppress' : 'attack', obj.x, obj.z, 35);
    if (rest.length) issueIfChanged(game, side, B, `lane${lane}`, rest, type, obj.x, obj.z, 35);
  }
  // Guard the flanks if the player likes flanking (learned): naval/mid units stay home if they have nothing else.
  // --- 2. navy: sea lane control / anti-sub
  if (navy.length) {
    const subs = seen.subs;
    const hunters = navy.filter(u => (u.def.hits || []).includes('sub'));
    if (subs.length && hunters.length && game.rng.chance(quality)) {
      const t = subs[0];
      issueIfChanged(game, side, B, 'navyHunt', hunters, 'attack', t.x, t.z, 20);
    }
    const others = navy.filter(u => !(subs.length && hunters.includes(u)) && !counterBusy(game, B, u));
    const coastal = game.strongpoints.filter(sp => sp.coastal && sp.owner !== s).sort((a, b) => Math.abs(a.x - homeX(game, s)) - Math.abs(b.x - homeX(game, s)))[0];
    const subsTrans = others.filter(u => u.def.id === 'submarine' || u.def.id === 'stealth_ship');
    const t = coastal && game.battleTime > 60 && subsTrans.length ? coastal : null;
    if (t) issueIfChanged(game, side, B, 'navyCap', subsTrans.slice(0, 1), 'capture', t.x, t.z, 60);
    const rest = others.filter(u => !(t && u === subsTrans[0]));
    const sea = objectives.find(o => o.lane === 1) || laneObjective(game, s, 1, ahead);
    if (rest.length && sea) issueIfChanged(game, side, B, 'navy', rest, ahead ? 'attack' : 'suppress', sea.x, sea.z, 40);
  }

  // --- 3. air wing & counters
  const fighters = air.filter(u => ['fighter', 'cca'].includes(categoryOf(u)));
  const helis = air.filter(u => categoryOf(u) === 'heli');
  const kamis = air.filter(u => categoryOf(u) === 'kamikaze');
  const recons = air.filter(u => categoryOf(u) === 'recon');
  const hot = objectives.slice().sort((a, b) => heat(enemiesSeen, b) - heat(enemiesSeen, a))[0] || laneObjective(game, s, 1, ahead);
  if (ahead && foeHq) {
    issueIfChanged(game, side, B, 'air', [...fighters, ...helis], 'focus', foeHq.x, foeHq.z, 60, foeHq.id);
    issueIfChanged(game, side, B, 'kami', kamis, 'attack', foeHq.x, foeHq.z, 60);
  } else {
    // SEAD first if enemy air defence is up and we have strike aircraft.
    const aaT = seen.aaUnits.filter(e => e.isGround)[0];
    if (aaT && fighters.length && game.rng.chance(quality)) issueIfChanged(game, side, B, 'air', fighters, 'sead', aaT.x, aaT.z, 30);
    else if (seen.airUnits.length && fighters.length) { const e = seen.airUnits[0]; issueIfChanged(game, side, B, 'air', fighters, 'attack', e.x, e.z, 25); }
    else if (fighters.length && hot) issueIfChanged(game, side, B, 'air', fighters, 'attack', hot.x, hot.z, 35);
    // Drones/helis vs armour (counter loop: drone > tank, air > tank).
    const tankT = biggest(seen.tanks);
    if (tankT && game.rng.chance(quality)) {
      if (kamis.length) issueIfChanged(game, side, B, 'kami', kamis, 'attack', tankT.x, tankT.z, 18);
      if (helis.length) issueIfChanged(game, side, B, 'heli', helis, 'focus', tankT.x, tankT.z, 25, tankT.id);
    } else if (hot) {
      if (kamis.length) issueIfChanged(game, side, B, 'kami', kamis, 'attack', hot.x, hot.z, 40);
      if (helis.length) issueIfChanged(game, side, B, 'heli', helis, 'attack', hot.x, hot.z, 40);
    }
    // Enemy artillery seen: send a fast flank group after it.
    const art = seen.artillery[0];
    if (art && game.rng.chance(quality * 0.6)) {
      const fast = mine.filter(u => (u.def.id === 'ugv' || u.def.id === 'heli_attack' || u.def.id === 'tank_heavy') && !counterBusy(game, B, u) && dist(u, art) < 90).slice(0, 2);
      if (fast.length) { issueIfChanged(game, side, B, 'flankArt', fast, 'flank', art.x, art.z, 30); for (const u of fast) B.counters.set(u.id, game.time + 30); }
    }
  }
  // Recon drones orbit the hottest objective so artillery has spotting.
  if (recons.length && hot) issueIfChanged(game, side, B, 'recon', recons, 'attack', hot.x, hot.z, 40);

  // --- 4. transports: shuttle infantry to the frontier strongpoints (F-141/F-142) and carry AA (F-136)
  const enemyAirThreat = seen.air > 1.5 || (B.learned.mix.air || 0) > 0.35;
  for (const aa of packedAA) {
    if (B.aaSent.has(aa.id) && aa.awaitCarrier) continue;
    const carrier = transports.filter(u => u.def.id === 'supply_truck' || u.def.id === 'apc').filter(u => !u.cargo || u.def.id === 'supply_truck')
      .sort((a, b) => dist(a, aa) - dist(b, aa))[0];
    if (!carrier) continue;
    let dest = autoAADest(game, s);
    if (enemyAirThreat && seen.airUnits.length) { // closer to where enemy aircraft operate
      const front = game.strongpoints.filter(sp => sp.owner === s).sort((a, b) => dist(a, seen.airUnits[0]) - dist(b, seen.airUnits[0]))[0];
      if (front) dest = { x: front.x, z: front.z };
    }
    game.issue(s, { type: 'transportAA', aaId: aa.id, carrierId: carrier.id, x: dest.x, z: dest.z });
    B.aaSent.add(aa.id);
    transports.splice(transports.indexOf(carrier), 1);
  }
  const frontier = frontierStrongpoints(game, s);
  transports.forEach((u, k) => {
    if (u.def.id === 'supply_truck' && u.def.capacity <= 0) return;
    const lane = B.laneOf[u.group] ?? 1;
    const t = frontier.filter(sp => u.isAir || nearestLane(sp.z) === lane || game.map.id === 'bay')[0] || frontier[k % Math.max(1, frontier.length)];
    if (t) issueIfChanged(game, side, B, `tr${u.id}`, [u], 'capture', t.x, t.z, 60);
  });

  // Learned: the player likes flanking -> keep the side-lane strongpoints guarded by spare infantry.
  if (B.guardFlanks) {
    const inf = mine.filter(u => u.def.id === 'infantry' && u.order.type === 'idle');
    for (const u of inf) { const sp = lastOwnedOnLane(game, s, nearestLane(u.z)); if (sp) game.issue(s, { type: 'order', unitIds: [u.id], order: 'defend', x: sp.x, z: sp.z }); }
  }
}

function counterBusy(game, B, u) { const t = B.counters.get(u.id); return t != null && t > game.time; }
function heat(enemies, o) { let h = 0; for (const e of enemies) if (Math.hypot(e.x - o.x, e.z - o.z) < 30) h += unitPower(e); return h; }
function biggest(list) { let b = null, bp = 0; for (const e of list) { const p = unitPower(e); if (p > bp) { bp = p; b = e; } } return b; }
function nearestLane(z) { let b = 0; for (let i = 1; i < 3; i++) if (Math.abs(LANES[i] - z) < Math.abs(LANES[b] - z)) b = i; return b; }
function homeX(game, s) { return game.map.bases[s].x; }
function homePoint(game, s, lane) { const b = game.map.bases[s]; return { x: b.x + (s === 0 ? 24 : -24), z: LANES[lane] }; }

// Strongpoints on a lane ordered from our base toward the enemy.
function laneStrongpoints(game, s, lane) {
  const hx = homeX(game, s);
  return game.strongpoints.filter(sp => nearestLane(sp.z) === lane || (lane === 1 && Math.abs(sp.z - 75) < 20))
    .sort((a, b) => Math.abs(a.x - hx) - Math.abs(b.x - hx));
}
function lastOwnedOnLane(game, s, lane) { const l = laneStrongpoints(game, s, lane).filter(sp => sp.owner === s); return l[l.length - 1] || null; }

function laneObjective(game, s, lane, ahead) {
  if (!ahead) {
    const sp = laneStrongpoints(game, s, lane).find(sp => sp.owner !== s);
    if (sp) return { kind: 'sp', x: sp.x, z: sp.z, sp };
  }
  const foe = 1 - s;
  const bunker = game.structures.filter(st => st.alive && st.side === foe && st.type === 'bunker' && nearestLane(st.z) === lane)[0];
  if (bunker && !ahead) return { kind: 'bunker', x: bunker.x, z: bunker.z };
  const hq = game.hq(foe);
  return hq ? { kind: 'hq', x: hq.x + (s === 0 ? -8 : 8), z: hq.z } : null;
}

function frontierStrongpoints(game, s) {
  const hx = homeX(game, s);
  return game.strongpoints.filter(sp => sp.owner !== s || sp.capturer === 1 - s).sort((a, b) => Math.abs(a.x - hx) - Math.abs(b.x - hx));
}

// Re-issue an order only when it changed meaningfully or went stale (re-issuing resets squads/paths).
function issueIfChanged(game, side, B, key, units, order, x, z, staleAfter, targetId) {
  const ids = units.filter(u => u.alive).map(u => u.id);
  if (!ids.length) return;
  const prev = B.laneOrders[key];
  const sameUnits = prev && prev.ids.length === ids.length && prev.ids.every((id, i) => id === ids[i]);
  const unitsOk = units.every(u => u.order.type === order || (u.order.auto && u.order.type === 'retreat'));
  if (prev && sameUnits && unitsOk && prev.order === order && Math.hypot(prev.x - x, prev.z - z) < 10 && game.time - prev.t < staleAfter) return;
  // reaction jitter: lower difficulty aims less precisely
  const j = (1.5 - (side.difficulty || 1)) * 6;
  const jx = x + (game.rng.next() - 0.5) * j, jz = z + (game.rng.next() - 0.5) * j;
  const cmd = { type: 'order', unitIds: ids.filter(id => { const u = game.units.get(id); return !(u.order.auto && u.order.type === 'retreat'); }), order, x: jx, z: jz };
  if (targetId != null) cmd.targetId = targetId;
  if (!cmd.unitIds.length) return;
  game.issue(side.id, cmd);
  B.laneOrders[key] = { ids, order, x, z, t: game.time };
}

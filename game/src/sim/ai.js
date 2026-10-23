// OWNER: agent AI chiến thuật
// Unit / group AI (order 10). GDD §5: player decides "what", AI decides "how". 3 layers:
//  1. strategic  = the player's order (or sim/enemyAI.js for AI sides), stored in u.order
//  2. tactical   = squads (units sharing one order): roles vanguard/support/scout, formation line/wedge/column,
//                  mutual cover (support stays behind vanguard), flank route via the influence map, group focus target
//  3. unit       = behaviour tree per category (tank, artillery, infantry, fighter, cca, heli, recon drone,
//                  kamikaze/swarm, ship, sub, uuv, aa, ew, transport) + Utility AI target scoring (hook on combat.targetScore)
// Orders (GDD §5 table, F-61..F-67): attack, defend, suppress, flank, sead, retreat, focus + move, capture.
// u.intent is kept accurate for the intent icon (F-69).
// Transports with a troop/AA task (u.tTask) are driven by sim/transport.js instead.
import { setDestination, stop } from './movement.js';
import { acquireTarget, effRange, canHit, inRange, computeDamage, targetScore } from './combat.js';
import { updateInfluence, dangerAt, flankWaypoint, saferWaypoint, retreatWaypoint } from './influence.js';
import { categoryOf, roleOf, defaultFormation, layoutSquad, slotWorld, formationSpeed, FORMATIONS } from './formation.js';
import { nearestPassable, domainOf, sameComponent } from './path.js';

export const AI = {
  retreatHp: 0.3,          // GDD: auto retreat when HP < 30%
  resumeHp: 0.95,
  repairRate: 0.06,        // share of max HP per second at home
  stripHeal: 0.04,         // aircraft repair per second while rearming
  defendRadius: 22,        // counter-attack radius around a defended point
  chaseLeash: 32,
  patternRadius: 12,       // fighter attack pattern radius
  kamikazeLoiter: 8,
  swarmHitsPerSec: 6,
  thinkEvery: 2,           // ticks between decisions (10 Hz)
  squadEvery: 10,          // ticks between squad rebuilds (2 Hz)
};

const MANNED_JETS = new Set(['fighter_stealth', 'fighter_multi', 'bomber']);
const SEAD_CAPABLE = new Set(['fighter', 'cca', 'heli', 'recon', 'kamikaze', 'ew', 'artillery']);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ---------------------------------------------------------------- home / rearm points
export function homeOf(game, u) {
  const hq = game.hq(u.side);
  const base = hq ? { x: hq.x + (u.side === 0 ? 6 : -6), z: hq.z } : game.map.bases[u.side];
  if (u.isAir) return rearmPoint(game, u) || base;
  if (u.isNaval) {
    const port = game.structures.find(s => s.type === 'port' && s.side === u.side && s.alive);
    const p = nearestPassable(game.map, domainOf(u), port ? port.x : base.x, port ? port.z : base.z, 40);
    return p || { x: u.x, z: u.z };
  }
  return base;
}

// Airfield of the side (structure 'airfield'), or a friendly carrier, else the HQ.
export function rearmPoint(game, u) {
  let best = null, bd = Infinity;
  for (const s of game.structures) if (s.alive && s.side === u.side && (s.type === 'airfield' || s.type === 'hq')) {
    const d = dist(s, u) + (s.type === 'hq' ? 40 : 0);
    if (d < bd) { bd = d; best = { x: s.x, z: s.z }; }
  }
  for (const c of game.units.values()) if (c.alive && c.side === u.side && c.def.id === 'carrier') {
    const d = dist(c, u);
    if (d < bd) { bd = d; best = { x: c.x, z: c.z }; }
  }
  return best;
}

// ---------------------------------------------------------------- movement helper (throttled re-planning)
export function goTo(game, u, x, z, tol = 2.5) {
  if (u.isAir) tol = Math.max(tol, 3); // movement drops air waypoints within 2.5
  const d = Math.hypot(x - u.x, z - u.z);
  if (d <= tol) { if (!u.isAir) stop(u); else { u.path = null; u.dest = null; u.moveTarget = null; } return true; }
  u.moveTarget = null;
  if (u.isAir) { u.dest = { x, z }; u.path = [{ x, z }]; return false; }
  // keep the current path while the goal only drifted a little relative to the distance left (moving targets)
  if (u.dest && u.path && Math.hypot(u.dest.x - x, u.dest.z - z) < Math.max(2.5, d * 0.2)) return false;
  if (u.path && (u.replanAt || 0) > game.time) return false;
  if (!u.path && (u.replanAt || 0) > game.time && u.pathFails) return false;
  u.replanAt = game.time + 0.8 + d / 40 + (u.id % 5) * 0.1;
  u.dest = null;
  if (setDestination(game, u, x, z)) u.pathFails = 0;
  else { u.pathFails = (u.pathFails || 0) + 1; u.replanAt = game.time + 2; }
  return false;
}
function hold(u) { if (!u.isAir) stop(u); else if (u.layer === 'low') stop(u); }

function liveTarget(game, u) {
  const t = u.forcedTarget?.alive ? u.forcedTarget : u.target;
  if (!t || !t.alive) return null;
  if (t.kind !== 'structure' && !t.visible[u.side]) return null;
  return t;
}

// ---------------------------------------------------------------- tactical layer: squads
function squadKey(u) { const o = u.order; return `${u.side}|${o.type}|${o.issued}|${o.x}|${o.z}`; }

function rebuildSquads(game) {
  const map = game.aiSquads;
  for (const sq of map.values()) sq.units = [];
  for (const u of game.units.values()) {
    u.squad = null;
    if (!u.alive || u.carriedBy || u.tTask || u.speed <= 0) continue;
    const o = u.order;
    if (!o || o.type === 'idle' || o.auto || o.x == null) continue;
    const key = squadKey(u);
    let sq = map.get(key);
    if (!sq) {
      sq = { key, side: u.side, type: o.type, gx: o.x, gz: o.z, units: [], created: game.time, formation: u.formationPref || defaultFormation(o.type), dir: null };
      map.set(key, sq);
    }
    if (u.formationPref) sq.formation = u.formationPref;
    sq.units.push(u); u.squad = sq;
  }
  for (const [k, sq] of map) {
    if (!sq.units.length) { map.delete(k); continue; }
    let cx = 0, cz = 0, vx = 0, vz = 0, nv = 0;
    for (const u of sq.units) { cx += u.x; cz += u.z; if (roleOf(u) === 'vanguard') { vx += u.x; vz += u.z; nv++; } }
    cx /= sq.units.length; cz /= sq.units.length;
    sq.cx = cx; sq.cz = cz;
    sq.vcx = nv ? vx / nv : cx; sq.vcz = nv ? vz / nv : cz;
    const toGoal = Math.hypot(sq.gx - sq.vcx, sq.gz - sq.vcz);
    sq.moving = toGoal > 14;
    if (!sq.dir || toGoal > 14) {
      let dx = sq.gx - sq.vcx, dz = sq.gz - sq.vcz;
      if (Math.hypot(dx, dz) < 4 || sq.type === 'defend' || sq.type === 'suppress') {
        // face the enemy base when holding
        const eh = game.hq(1 - sq.side) || game.map.bases[1 - sq.side];
        dx = eh.x - sq.gx; dz = eh.z - sq.gz;
      }
      const l = Math.hypot(dx, dz) || 1;
      sq.dir = { x: dx / l, z: dz / l };
    }
    layoutSquad(sq);
    // Flank route: chosen once per squad from the influence map.
    if (sq.type === 'flank' && !sq.via) sq.via = flankWaypoint(game, sq.units[0], sq.vcx, sq.vcz, sq.gx, sq.gz) || { x: sq.gx, z: sq.gz };
    // Safe path choice for plain moves / attacks far away.
    if ((sq.type === 'move' || sq.type === 'attack' || sq.type === 'capture') && sq.via === undefined)
      sq.via = toGoal > 50 ? saferWaypoint(game, sq.units[0], sq.gx, sq.gz) : null;
    // Focus: one target for everyone.
    if (sq.type === 'focus') sq.focusTarget = pickFocus(game, sq);
  }
}

function pickFocus(game, sq) {
  const cur = sq.focusTarget;
  if (cur && cur.alive) return cur;
  for (const u of sq.units) if (u.forcedTarget?.alive) return u.forcedTarget;
  // No explicit target: the most valuable visible enemy near the ordered point.
  let best = null, bs = -Infinity;
  for (const o of game.unitsNear(sq.gx, sq.gz, 24, o => o.side !== sq.side && o.visible[sq.side])) {
    const s = o.def.price / 1e6 + (1 - o.hpFrac) * 20 - Math.hypot(o.x - sq.gx, o.z - sq.gz);
    if (s > bs) { bs = s; best = o; }
  }
  if (!best) best = game.structuresNear(sq.gx, sq.gz, 14, s => s.side !== sq.side)[0] || null;
  return best;
}

// ---------------------------------------------------------------- Utility AI hook (extends combat.targetScore)
function utilityHook(game, u, t, s) {
  const o = u.order;
  if (t.kind === 'structure') {
    if (o?.type === 'sead' && t.type === 'radar_tower') s += 70;
    if (u.squad?.focusTarget === t) s += 200;
    return s;
  }
  if (u.squad?.focusTarget === t) s += 200;
  if (canHit(t, u)) s += 12;                                  // threats to me first
  if (o && o.x != null) {
    const dp = Math.hypot(t.x - o.x, t.z - o.z);
    if (o.type === 'suppress' || o.type === 'defend' || o.type === 'capture') s += Math.max(0, 25 - dp);
    if (o.type === 'sead' && (t.def.detect || []).includes('radar')) s += 40;
    if (o.type === 'flank') {                                 // hit from behind
      const hx = Math.cos(t.heading || 0), hz = Math.sin(t.heading || 0);
      if ((u.x - t.x) * hx + (u.z - t.z) * hz < 0) s += 15;
    }
  }
  if (u.def.needsSpotter && !(t.spotted > 0) && Math.hypot(t.x - u.x, t.z - u.z) > u.sight) s -= 120;
  const cat = categoryOf(u);
  if ((cat === 'fighter' || cat === 'cca') && t.isAir) s += 20;  // air superiority
  if (cat === 'aa' && t.def.kamikaze) s += 20;
  if (t.canCapture) for (const sp of game.strongpoints) if (sp.capturer === t.side && (t.x - sp.x) ** 2 + (t.z - sp.z) ** 2 < sp.radius * sp.radius) { s += 25; break; }
  if (t.def.needsTransport && !t.deployed) s -= 10;
  return s;
}

// ---------------------------------------------------------------- spotting (F-146, F-143)
function requestSpot(game, side, x, z) {
  const list = game.spotRequests[side];
  for (const r of list) if (Math.hypot(r.x - x, r.z - z) < 15) { r.t = game.time; return; }
  list.push({ x, z, t: game.time });
}
function markTargets(game, u) {
  const r = u.sight * 0.9;
  for (const o of game.unitsNear(u.x, u.z, r, o => o.side !== u.side)) {
    if (o.layer === 'air' || o.layer === 'sub' || o.stealth > 0) continue;
    o.spotted = 3; o.spottedBy = u.side;
  }
}

// ---------------------------------------------------------------- system
export const aiSystem = {
  name: 'ai',
  init(game) {
    game.aiSquads = new Map();
    game.spotRequests = [[], []];
    (game.targetScoreHooks ||= []).push(utilityHook);
    game.aiStats = { ms: 0, ticks: 0 };
    // Player helper command: pick a formation for selected units (line / wedge / column).
    game.onCommand('formation', (g, side, cmd) => {
      if (!FORMATIONS.includes(cmd.formation)) return false;
      let n = 0;
      for (const id of cmd.unitIds || []) { const u = g.units.get(id); if (u && u.alive && u.side === side) { u.formationPref = cmd.formation; n++; } }
      return n > 0;
    });
  },
  update(game, dt) {
    if (game.phase !== 'battle') return;
    if (game.tick % AI.thinkEvery !== 0) return;
    const step = dt * AI.thinkEvery;
    updateInfluence(game);
    if (game.tick % AI.squadEvery === 0) {
      rebuildSquads(game);
      for (const s of [0, 1]) game.spotRequests[s] = game.spotRequests[s].filter(r => game.time - r.t < 6);
    }
    for (const u of game.units.values()) {
      if (!u.alive || u.carriedBy) continue;
      if ((u.id + game.tick / AI.thinkEvery) % 2 !== 0) continue; // each unit decides at 5 Hz, staggered
      think(game, u, step * 2);
      u.formationSpeed = u.squad ? formationSpeed(u, u.squad) : 1;
    }
  },
};

function think(game, u, dt) {
  if (u.hacked > 0) { u.intent = 'hacked'; return; }
  if (u.tTask) return;                                       // sim/transport.js drives it
  const cat = categoryOf(u);
  if (u.def.needsTransport) { aaStatic(game, u); return; }
  if (u.speed <= 0) { u.intent = liveTarget(game, u) ? 'attack' : 'defend'; return; }
  stuckCheck(game, u);

  // Unit reflex: auto retreat under 30% HP (GDD §5 table "Khi HP < 30%").
  const o0 = u.order;
  if (u.hpFrac < AI.retreatHp && o0.type !== 'retreat' && !u.def.kamikaze && u.autoRetreat !== false && !u.rearming) {
    u.order = { type: 'retreat', auto: true, prev: o0, issued: game.time };
    u.path = null; u.dest = null;
  }
  // Out of ammo: fly/drive home to rearm, then return (F-140).
  if (u.maxAmmo !== Infinity && u.ammo <= 0 && !u.def.kamikaze && u.order.type !== 'retreat') u.rearming = true;
  if (u.rearming) { rearm(game, u, dt); return; }
  if (u.order.type === 'retreat') { retreat(game, u, dt); return; }
  if (u.order.type !== 'idle' && u.pathFails >= 4 && !u.isAir) { // unreachable order: hold where we are
    u.order = { type: 'defend', x: u.x, z: u.z, issued: game.time, fallback: true }; u.pathFails = 0;
  }

  switch (cat) {
    case 'kamikaze': return kamikaze(game, u, dt);
    case 'fighter': return fighter(game, u, dt);
    case 'cca': return cca(game, u, dt);
    case 'uuv': return uuv(game, u, dt);
    case 'recon': markTargets(game, u); return recon(game, u, dt);
    default: return generic(game, u, dt, cat);
  }
}

function stuckCheck(game, u) {
  if (!u.path || u.isAir) { u.stuckT = 0; return; }
  if (!u.stuckRef) u.stuckRef = { x: u.x, z: u.z, t: game.time };
  if (game.time - u.stuckRef.t > 3) {
    if (Math.hypot(u.x - u.stuckRef.x, u.z - u.stuckRef.z) < 0.6) {
      u.stuckCount = (u.stuckCount || 0) + 1;
      const d = u.dest; u.path = null; u.dest = null; u.replanAt = 0;
      if (d && u.stuckCount > 2) { // sidestep around whatever blocks us
        const a = game.rng.next() * Math.PI * 2, p = nearestPassable(game.map, domainOf(u), u.x + Math.cos(a) * 5, u.z + Math.sin(a) * 5, 8);
        if (p) { u.path = [p, d]; u.dest = d; }
        u.stuckCount = 0;
      }
    } else u.stuckCount = 0;
    u.stuckRef = { x: u.x, z: u.z, t: game.time };
  }
}

// ---------------------------------------------------------------- retreat / repair / rearm (F-66, F-140)
function retreat(game, u, dt) {
  const o = u.order;
  const h = homeOf(game, u);
  if (o.via === undefined) o.via = retreatWaypoint(game, u, h.x, h.z);
  u.intent = 'retreat';
  if (o.via && Math.hypot(o.via.x - u.x, o.via.z - u.z) > 6) { goTo(game, u, o.via.x, o.via.z, 6); return; }
  o.via = null;
  if (Math.hypot(h.x - u.x, h.z - u.z) > 6) { goTo(game, u, h.x, h.z, 6); return; }
  hold(u);
  if (u.layer === 'air') u.landed = true;
  u.intent = 'repair';
  u.hp = Math.min(u.maxHp, u.hp + u.maxHp * AI.repairRate * dt);
  if (u.maxAmmo !== Infinity) u.ammo = u.maxAmmo;
  if (u.hp >= u.maxHp * AI.resumeHp) {
    u.landed = false;
    u.order = o.auto && o.prev && o.prev.type !== 'retreat' ? o.prev : { type: 'idle' };
    u.path = null; u.dest = null;
  }
}

function rearm(game, u, dt) {
  const p = rearmPoint(game, u) || homeOf(game, u);
  u.intent = 'rearm';
  if (Math.hypot(p.x - u.x, p.z - u.z) > 7) { u.landed = false; goTo(game, u, p.x, p.z, 4); return; }
  hold(u); u.moveTarget = null; u.path = null;
  if (u.isAir) u.landed = true;
  const boost = 1 + (game.sides[u.side].mods.rearmSpeed?.[u.def.group] || 0);
  u.ammoF = (u.ammoF ?? u.ammo) + (u.maxAmmo / 6) * boost * dt;
  u.ammo = Math.min(u.maxAmmo, Math.floor(u.ammoF));
  u.hp = Math.min(u.maxHp, u.hp + u.maxHp * AI.stripHeal * dt);
  if (u.ammo >= u.maxAmmo) { u.ammo = u.maxAmmo; u.ammoF = undefined; u.rearming = false; u.landed = false; }
}

// ---------------------------------------------------------------- generic behaviour tree (ground, sea, heli, artillery, ew, infantry, transport w/o task)
function generic(game, u, dt, cat) {
  const o = u.order, sq = u.squad;
  switch (o.type) {
    case 'idle': {
      const t = liveTarget(game, u);
      u.intent = t ? 'attack' : 'idle';
      if (cat === 'artillery' && !t) requestSpot(game, u.side, u.x + (u.side === 0 ? 30 : -30), u.z);
      return;
    }
    case 'move': {
      u.intent = 'move';
      if (viaStage(game, u, sq, 'move')) return;
      const p = slotGoal(u, sq, o);
      if (goTo(game, u, p.x, p.z, 2.5)) u.intent = 'idle';
      return;
    }
    case 'capture': return capture(game, u, sq, o, cat);
    case 'defend': return defend(game, u, sq, o, cat);
    case 'suppress': return suppress(game, u, sq, o, cat);
    case 'sead': if (SEAD_CAPABLE.has(cat) && sead(game, u, sq, o, cat)) return; return attack(game, u, sq, o, cat, 'sead');
    case 'flank': return flank(game, u, sq, o, cat);
    case 'focus': return focus(game, u, sq, o, cat);
    case 'attack': default: return attack(game, u, sq, o, cat, 'attack');
  }
}

// Pass through the squad's via point (safe route) before heading to the goal.
function viaStage(game, u, sq, intent) {
  const o = u.order;
  if (o.viaDone || !sq?.via) return false;
  if (Math.hypot(sq.via.x - u.x, sq.via.z - u.z) < 8 || Math.hypot(sq.vcx - sq.via.x, sq.vcz - sq.via.z) < 10) { o.viaDone = true; return false; }
  u.intent = intent;
  goTo(game, u, sq.via.x, sq.via.z, 6);
  return true;
}

function slotGoal(u, sq, o) {
  if (!sq || !sq.dir) return { x: o.x, z: o.z };
  return slotWorld(u, o.x, o.z, sq.dir);
}

// Artillery / ships stay behind the front, at a fraction of their range from the goal (toward their own side).
function standoffPoint(game, u, sq, gx, gz, frac) {
  const dir = sq?.dir || (() => { const h = game.hq(u.side) || game.map.bases[u.side]; const dx = gx - h.x, dz = gz - h.z, l = Math.hypot(dx, dz) || 1; return { x: dx / l, z: dz / l }; })();
  const r = effRange(game, u) * frac;
  const s = u.slot || { l: 0 };
  return { x: gx - dir.x * r - dir.z * s.l * 0.5, z: gz - dir.z * r + dir.x * s.l * 0.5 };
}

function engagedHold(game, u, cat) {
  const t = liveTarget(game, u);
  if (t && inRange(game, u, t)) { hold(u); return t; }
  return null;
}

function attack(game, u, sq, o, cat, intent) {
  const t = liveTarget(game, u);
  // Artillery: never needs to stand in the line, minimum range -> back off.
  if (cat === 'artillery') return artillery(game, u, sq, o, intent);
  if (t && inRange(game, u, t)) {
    if (cat !== 'fighter') hold(u);
    u.intent = intent; return;
  }
  if (viaStage(game, u, sq, intent === 'sead' ? 'sead' : 'move')) return;
  // Attack-move: engage the nearest enemy that shows up close to us.
  if (t && dist(t, u) < effRange(game, u) + 12 && dist(t, o) < 45) { u.intent = intent; goTo(game, u, t.x, t.z, effRange(game, u) * 0.8); return; }
  const isNavalStand = cat === 'ship' || cat === 'sub';
  const p = isNavalStand ? standoffPoint(game, u, sq, o.x, o.z, 0.6) : slotGoal(u, sq, o);
  const arrived = goTo(game, u, p.x, p.z, 3);
  if (!arrived) { u.intent = sq?.moving ? 'move' : intent; return; }
  // At the point: hunt the nearest visible enemy around it, otherwise hold.
  const near = nearestEnemy(game, u, o.x, o.z, 30);
  if (near) { u.target = near; goTo(game, u, near.x, near.z, effRange(game, u) * 0.8); u.intent = intent; }
  else u.intent = 'defend';
}

function nearestEnemy(game, u, x, z, r) {
  let best = null, bd = Infinity;
  for (const e of game.unitsNear(x, z, r, e => e.side !== u.side && e.visible[u.side] && canHit(u, e))) {
    const d = (e.x - u.x) ** 2 + (e.z - u.z) ** 2; if (d < bd) { bd = d; best = e; }
  }
  if (!best) for (const s of game.structuresNear(x, z, r, s => s.side !== u.side && canHit(u, s))) { const d = dist(s, u); if (d < bd) { bd = d; best = s; } }
  return best;
}

function artillery(game, u, sq, o, intent) {
  const minR = u.def.minRange || 0;
  const close = game.unitsNear(u.x, u.z, minR + 2, e => e.side !== u.side && e.isGround && e.visible[u.side])[0];
  if (close) { // too close to fire: fall back
    const h = homeOf(game, u), dx = h.x - u.x, dz = h.z - u.z, l = Math.hypot(dx, dz) || 1;
    u.intent = 'retreat'; goTo(game, u, u.x + dx / l * 12, u.z + dz / l * 12, 2); return;
  }
  const p = standoffPoint(game, u, sq, o.x, o.z, 0.75);
  const t = liveTarget(game, u);
  const arrived = goTo(game, u, p.x, p.z, 4);
  if (t && inRange(game, u, t) && (t.spotted > 0 || dist(t, u) <= u.sight || t.kind === 'structure')) { hold(u); u.intent = intent; return; }
  requestSpot(game, u.side, o.x, o.z);
  u.intent = arrived ? intent : 'move';
  if (arrived && intent === 'attack') u.intent = 'suppress';
}

function capture(game, u, sq, o, cat) {
  if (!u.canCapture) return defend(game, u, sq, o, cat, 'defend', 14);
  const sp = game.strongpoints.find(s => Math.hypot(s.x - o.x, s.z - o.z) < 12) || { x: o.x, z: o.z, radius: 7 };
  const t = liveTarget(game, u);
  const inside = Math.hypot(u.x - sp.x, u.z - sp.z) < sp.radius * 0.8;
  if (!inside) {
    if (viaStage(game, u, sq, 'capture')) return;
    u.intent = 'capture';
    if (t && inRange(game, u, t) && dist(u, sp) < sp.radius + 6) { /* fight our way in */ }
    // spread inside the ring
    const s = u.slot || { l: 0, f: 0 }, k = sp.radius * 0.45;
    const ox = Math.max(-k, Math.min(k, -sq?.dir.z * s.l * 0.6 || 0)), oz = Math.max(-k, Math.min(k, sq?.dir.x * s.l * 0.6 || 0));
    goTo(game, u, sp.x + ox, sp.z + oz, 2);
    return;
  }
  hold(u);
  u.intent = sp.owner === u.side && !(sp.capturer >= 0 && sp.capturer !== u.side) ? (t ? 'attack' : 'defend') : 'capture';
}

function defend(game, u, sq, o, cat, intent = 'defend', radius = AI.defendRadius) {
  if (cat === 'artillery') return artillery(game, u, sq, o, 'defend');
  const threat = nearestEnemy(game, u, o.x, o.z, radius);
  const fromHome = Math.hypot(u.x - o.x, u.z - o.z);
  if (threat && fromHome < AI.chaseLeash) {
    u.target = threat.kind === 'structure' ? u.target : threat;
    if (inRange(game, u, threat)) hold(u); else goTo(game, u, threat.x, threat.z, effRange(game, u) * 0.85); // counter-attack
    u.intent = 'attack';
    return;
  }
  const p = (cat === 'ship' || cat === 'sub') ? standoffPoint(game, u, sq, o.x, o.z, 0.3) : slotGoal(u, sq, o);
  if (goTo(game, u, p.x, p.z, 3)) u.intent = intent;
  else u.intent = fromHome > 12 ? 'move' : intent;
}

function suppress(game, u, sq, o, cat) {
  // Fire to pin the area, never advance past the stand-off line (artillery + ships are the main users).
  const frac = cat === 'artillery' ? 0.8 : 0.85;
  const p = standoffPoint(game, u, sq, o.x, o.z, frac);
  const t = liveTarget(game, u);
  const dGoal = Math.hypot(u.x - o.x, u.z - o.z);
  if (t && inRange(game, u, t)) { hold(u); u.intent = 'suppress'; if (cat === 'artillery' && !(t.spotted > 0)) requestSpot(game, u.side, o.x, o.z); return; }
  if (dGoal <= effRange(game, u) * 0.95 && dGoal > (u.def.minRange || 0) + 2) { hold(u); u.intent = 'suppress'; if (cat === 'artillery') requestSpot(game, u.side, o.x, o.z); return; }
  goTo(game, u, p.x, p.z, 3);
  u.intent = 'suppress';
}

function flank(game, u, sq, o, cat) {
  if (!o.viaDone && sq?.via) {
    if (Math.hypot(sq.via.x - u.x, sq.via.z - u.z) < 8 || Math.hypot(sq.vcx - sq.via.x, sq.vcz - sq.via.z) < 10) o.viaDone = true;
    else {
      u.intent = 'flank';
      const t = liveTarget(game, u);
      if (t && inRange(game, u, t) && dist(t, u) < 10) { hold(u); u.intent = 'attack'; return; } // ambushed: fight back
      goTo(game, u, sq.via.x, sq.via.z, 6);
      return;
    }
  }
  // Strike stage: come in from the side/back toward the goal.
  const t = liveTarget(game, u);
  if (t && inRange(game, u, t)) { hold(u); u.intent = 'flank'; return; }
  if (goTo(game, u, o.x, o.z, 4)) {
    const near = nearestEnemy(game, u, o.x, o.z, 28);
    if (near) { u.target = near; goTo(game, u, near.x, near.z, effRange(game, u) * 0.8); }
    u.intent = near ? 'attack' : 'defend';
  } else u.intent = 'flank';
}

function seadTargetFor(game, u, o) {
  if (u.seadTarget?.alive && (u.seadTarget.kind === 'structure' || u.seadTarget.visible[u.side])) return u.seadTarget;
  let best = null, bd = Infinity;
  const look = (x, z, r) => {
    for (const e of game.unitsNear(x, z, r, e => e.side !== u.side && e.visible[u.side] && (e.def.group === 'aa' || e.def.id === 'laser' || e.def.id === 'destroyer'))) {
      const d = dist(e, u); if (d < bd) { bd = d; best = e; }
    }
  };
  look(o.x, o.z, 60); if (!best) look(u.x, u.z, 45);
  if (!best) for (const s of game.structures) if (s.alive && s.side !== u.side && s.type === 'radar_tower' && s[`seen${u.side}`] && Math.hypot(s.x - o.x, s.z - o.z) < 70) { best = s; break; }
  u.seadTarget = best;
  return best;
}

function sead(game, u, sq, o, cat) {
  const t = seadTargetFor(game, u, o);
  if (!t) return false;
  u.intent = 'sead';
  if (cat === 'ew') {                                     // EW blinds the AA from inside its jam radius
    const r = (u.def.jamRadius || 20) * 0.75;
    if (dist(t, u) > r) goTo(game, u, t.x, t.z, r); else hold(u);
    return true;
  }
  if (canHit(u, t)) {
    u.target = t;
    if (inRange(game, u, t)) { if (cat !== 'fighter') hold(u); return true; }
    goTo(game, u, t.x, t.z, effRange(game, u) * 0.85);
    return true;
  }
  return false;
}

function focus(game, u, sq, o, cat) {
  // Squad not built yet (order just issued): same deterministic pick every member would make.
  const t = sq?.focusTarget || (u.forcedTarget?.alive ? u.forcedTarget : null) || pickFocus(game, { units: [u], side: u.side, gx: o.x, gz: o.z });
  if (!t || !t.alive) {
    u.forcedTarget = null; u.focusId = null;
    u.order = { ...o, type: 'attack', issued: o.issued + 0.001 };
    return attack(game, u, sq, u.order, cat, 'attack');
  }
  u.intent = 'focus';
  if (canHit(u, t)) {
    u.forcedTarget = t; u.target = t; u.focusId = t.id;
    const d = dist(t, u) - (t.kind === 'structure' ? 3 : 0);
    if (d > effRange(game, u) * 0.9) goTo(game, u, t.x, t.z, effRange(game, u) * 0.8); else hold(u);
  } else {
    // cannot shoot it (wrong layer): escort the strike and cover the others around the target.
    const p = standoffPoint(game, u, sq, t.x, t.z, 0.5);
    goTo(game, u, p.x, p.z, 4);
  }
}

// ---------------------------------------------------------------- deployed AA (SAM / Iron Dome) (F-136, F-144)
function aaStatic(game, u) {
  stop(u);
  if (!u.deployed) { u.intent = u.awaitCarrier ? 'deploy' : 'idle'; return; }
  u.intent = liveTarget(game, u) ? 'attack' : 'defend';
}

// ---------------------------------------------------------------- fighters: circle / figure-8 / U patterns (F-140)
const PATTERNS = ['circle', 'eight', 'u'];
function patternPoint(kind, cx, cz, R, th, axis) {
  let lx, lz;
  if (kind === 'circle') { lx = Math.cos(th) * R; lz = Math.sin(th) * R; }
  else if (kind === 'eight') { lx = Math.sin(th) * R * 1.3; lz = Math.sin(th) * Math.cos(th) * R; }
  else { lx = Math.cos(th) * R * 1.6; lz = Math.sin(th) * R * 0.45; }   // 'u': racetrack with U-turns at both ends
  const ca = Math.cos(axis), sa = Math.sin(axis);
  return { x: cx + lx * ca - lz * sa, z: cz + lx * sa + lz * ca };
}
export function flyPattern(game, u, cx, cz, dt, kind) {
  const R = u.def.id === 'bomber' ? 7 : AI.patternRadius;
  kind ||= u.order.pattern || PATTERNS[u.id % 3];
  if (u.def.id === 'bomber' && kind === 'circle') kind = 'eight';  // bombers must pass over the target
  if (u.patC?.x !== cx || u.patC?.z !== cz) {
    const h = game.hq(u.side) || game.map.bases[u.side];
    u.patC = { x: cx, z: cz, axis: Math.atan2(cz - h.z, cx - h.x) };
    u.patT = Math.atan2(u.z - cz, u.x - cx);
  }
  u.patT += dt * u.speed / (R * 1.15);
  const p = patternPoint(kind, cx, cz, R, u.patT + 0.5, u.patC.axis);
  p.x = Math.max(1, Math.min(game.map.w - 1, p.x)); p.z = Math.max(1, Math.min(game.map.h - 1, p.z));
  u.path = null; u.dest = null; u.moveTarget = p; u.pattern = kind;
}

function fighter(game, u, dt) {
  const o = u.order;
  u.landed = false;
  if (o.type === 'idle') { u.intent = liveTarget(game, u) ? 'attack' : 'idle'; return; }
  if (o.type === 'move') { u.moveTarget = null; if (goTo(game, u, o.x, o.z, 4)) u.intent = 'idle'; else u.intent = 'move'; return; }
  let intent = { sead: 'sead', focus: 'focus', defend: 'defend', suppress: 'suppress', flank: 'flank' }[o.type] || 'attack';
  // Pattern centre: focus target > SEAD target > nearest enemy around the goal > goal itself.
  let c = null;
  if (o.type === 'focus') { const t = u.squad?.focusTarget || u.forcedTarget; if (t?.alive) { c = t; u.forcedTarget = canHit(u, t) ? t : null; } }
  if (!c && o.type === 'sead') c = seadTargetFor(game, u, o);
  if (!c) { const e = nearestEnemy(game, u, o.x, o.z, 26); if (e) { c = e; u.target = e; } }
  if (!c) c = { x: o.x, z: o.z };
  // Flank: pass through the side waypoint first.
  if (o.type === 'flank' && !o.viaDone && u.squad?.via) {
    if (Math.hypot(u.squad.via.x - u.x, u.squad.via.z - u.z) < 10) o.viaDone = true;
    else { u.moveTarget = null; goTo(game, u, u.squad.via.x, u.squad.via.z, 6); u.intent = 'flank'; return; }
  }
  const d = Math.hypot(c.x - u.x, c.z - u.z);
  if (d > AI.patternRadius + 30) { u.moveTarget = null; goTo(game, u, c.x, c.z, 4); u.intent = 'move'; return; }
  flyPattern(game, u, c.x, c.z, dt);
  u.intent = intent;
}

// ---------------------------------------------------------------- CCA wingman (F-71, F-39)
function cca(game, u, dt) {
  let lead = u.leaderId != null ? game.units.get(u.leaderId) : null;
  if (!lead || !lead.alive || lead.side !== u.side) {
    lead = null; let bd = Infinity;
    for (const o of game.units.values()) if (o.alive && o.side === u.side && MANNED_JETS.has(o.def.id)) { const d = dist(o, u); if (d < bd) { bd = d; lead = o; } }
    u.leaderId = lead ? lead.id : null;
  }
  if (!lead || u.order.type === 'retreat') return fighter(game, u, dt);
  // Wingman slot: behind and to the side of the leader.
  const side = u.id % 2 ? 1 : -1, h = lead.heading;
  const bx = -Math.cos(h) * 5, bz = -Math.sin(h) * 5, lx = -Math.sin(h) * 4 * side, lz = Math.cos(h) * 4 * side;
  u.path = null; u.dest = null; u.landed = false;
  u.moveTarget = { x: lead.x + bx + lx + Math.cos(h) * 6, z: lead.z + bz + lz + Math.sin(h) * 6 };
  const lt = lead.target;
  if (lt && lt.alive && canHit(u, lt)) u.target = lt;
  u.intent = lead.intent === 'rearm' || lead.intent === 'repair' ? 'move' : (lead.intent === 'idle' ? 'idle' : lead.intent);
  if (lead.landed) { // leader on the strip: wait overhead
    u.moveTarget = null;
  }
}

// ---------------------------------------------------------------- recon drones: orbit + mark for the team (F-143, F-33)
function recon(game, u, dt) {
  const o = u.order;
  let c = null;
  if (o.type === 'sead' && sead(game, u, u.squad, o, 'recon')) return;
  if (o.type === 'focus') { const t = u.squad?.focusTarget || u.forcedTarget; if (t?.alive) c = t; }
  if (!c && o.type !== 'idle' && o.x != null) c = { x: o.x, z: o.z };
  if (!c) { // idle: answer artillery spotting requests, else loiter where we are
    let bd = Infinity;
    for (const r of game.spotRequests[u.side]) { const d = Math.hypot(r.x - u.x, r.z - u.z); if (d < bd) { bd = d; c = r; } }
    if (!c) { u.loiterC ||= { x: u.x, z: u.z }; c = u.loiterC; }
  }
  if (o.type === 'move') { if (goTo(game, u, c.x, c.z, 4)) u.intent = 'loiter'; else u.intent = 'move'; return; }
  // Orbit farther out if the orbit is under heavy AA fire.
  const R = dangerAt(game, u.side, c.x, c.z, true) > 40 ? 18 : 10;
  const d = Math.hypot(c.x - u.x, c.z - u.z);
  if (d > R + 25) { goTo(game, u, c.x, c.z, 4); u.intent = 'move'; return; }
  u.patC = u.patC && u.patC.x === c.x && u.patC.z === c.z ? u.patC : null;
  flyPatternR(game, u, c.x, c.z, R, dt);
  u.intent = o.type === 'idle' ? 'loiter' : liveTarget(game, u) ? 'attack' : 'loiter';
}
function flyPatternR(game, u, cx, cz, R, dt) {
  if (!u.patC) { u.patC = { x: cx, z: cz, axis: 0 }; u.patT = Math.atan2(u.z - cz, u.x - cx); }
  u.patT += dt * u.speed / R;
  const p = patternPoint('circle', cx, cz, R, u.patT + 0.5, 0);
  u.path = null; u.dest = null; u.moveTarget = { x: Math.max(1, Math.min(game.map.w - 1, p.x)), z: Math.max(1, Math.min(game.map.h - 1, p.z)) };
}

// ---------------------------------------------------------------- kamikaze / swarm: loiter then dive (F-143, F-34, F-35)
function kamikaze(game, u, dt) {
  const o = u.order;
  // sim/skills.js (when installed) owns the dive/strike (kamikazeTick, u.kTarget) and the close loiter;
  // here we only fly the drone to its order point / home. Without skills, the full loop below runs.
  if (game.aiSkillsKamikaze ??= game.systems.some(s => s.name === 'skills')) {
    if (u.kTarget?.alive) return;
    const anchor = o.type === 'retreat' ? homeOf(game, u) : o.type !== 'idle' && o.x != null ? { x: o.x, z: o.z } : null;
    if (anchor && Math.hypot(anchor.x - u.x, anchor.z - u.z) > 8) { goTo(game, u, anchor.x, anchor.z, 3); u.intent = o.type === 'retreat' ? 'retreat' : 'move'; }
    else if (u.jammed > 0) u.intent = 'jammed';
    else if (u.intent !== 'attack') u.intent = 'loiter';
    return;
  }
  if (u.jammed > 0) { // jammed: loses the link and drifts (GDD "lạc hướng khi bị nhiễu")
    u.diveTarget = null; u.intent = 'jammed';
    if (!u.moveTarget || game.rng.chance(0.2)) u.moveTarget = { x: Math.max(1, Math.min(game.map.w - 1, u.x + (game.rng.next() - 0.5) * 12)), z: Math.max(1, Math.min(game.map.h - 1, u.z + (game.rng.next() - 0.5) * 12)) };
    u.path = null;
    return;
  }
  let center;
  if (o.type !== 'idle' && o.type !== 'retreat' && o.x != null) center = { x: o.x, z: o.z };
  else { u.loiterC ||= { x: u.x, z: u.z }; center = u.loiterC; }
  if (o.type === 'retreat') { const h = homeOf(game, u); center = h; }
  // choose / keep a dive target
  let t = u.diveTarget;
  if (o.type === 'focus') { const f = u.squad?.focusTarget || u.forcedTarget; if (f?.alive) t = f; }
  if (!t || !t.alive || (t.kind !== 'structure' && !t.visible[u.side])) t = null;
  if (!t && o.type !== 'move' && o.type !== 'retreat') {
    let bs = -Infinity;
    const r = u.sight + 6;
    for (const e of game.unitsNear(u.x, u.z, r, e => e.side !== u.side && e.visible[u.side] && canHit(u, e) && Math.hypot(e.x - center.x, e.z - center.z) < 40)) {
      const s = targetScore(game, u, e) + (e.def.group === 'tank' ? 25 : 0) + Math.min(40, e.def.price / 2e7);
      if (s > bs) { bs = s; t = e; }
    }
    if (!t && (o.type === 'attack' || o.type === 'focus') && Math.hypot(u.x - center.x, u.z - center.z) < 20)
      t = game.structuresNear(center.x, center.z, 16, s => s.side !== u.side)[0] || null;
  }
  u.diveTarget = t;
  if (t) {
    u.intent = o.type === 'focus' ? 'focus' : 'attack';
    u.path = null; u.dest = null; u.moveTarget = { x: t.x, z: t.z };
    const contact = (t.kind === 'structure' ? 4 : 1.2 + (t.def.size || 1) * 0.5) + (u.def.range || 1);
    if (dist(t, u) <= contact) detonate(game, u, t, dt);
    return;
  }
  // loiter around the point
  const d = Math.hypot(center.x - u.x, center.z - u.z);
  if (o.type === 'move' || o.type === 'retreat' || d > AI.kamikazeLoiter + 20) {
    goTo(game, u, center.x, center.z, 3); u.intent = o.type === 'retreat' ? 'retreat' : 'move'; return;
  }
  flyPatternR(game, u, center.x, center.z, AI.kamikazeLoiter, dt);
  u.intent = 'loiter';
}

function detonate(game, u, t, dt) {
  if (u.def.swarmCount) {
    // Swarm: drones hit one by one from several directions.
    u.swarmAcc = (u.swarmAcc || 0) + AI.swarmHitsPerSec * dt;
    while (u.swarmAcc >= 1 && u.swarm > 0 && t.alive) {
      u.swarmAcc -= 1; u.swarm--;
      const dmg = t.kind === 'structure' ? u.dmg : computeDamage(game, u, t, u.dmg, 'he');
      game.damage(t, dmg, 'he', u);
      const a = game.rng.next() * Math.PI * 2;
      game.events.emit('explosion', { x: t.x + Math.cos(a) * 0.8, z: t.z + Math.sin(a) * 0.8, r: 0.8, type: 'fpv' });
    }
    if (u.swarm <= 0) game.kill(u, null);
    return;
  }
  const dmg = t.kind === 'structure' ? u.dmg : computeDamage(game, u, t, u.dmg, 'he');
  game.damage(t, dmg, 'he', u);
  game.events.emit('explosion', { x: t.x, z: t.z, r: 2, type: 'kamikaze', y: t.alt });
  game.kill(u, null);
}

// ---------------------------------------------------------------- UUV: autonomous underwater patrol (F-71, F-43)
function uuv(game, u, dt) {
  const o = u.order;
  if (dangerAt(game, u.side, u.x, u.z) > 30 && o.type !== 'move') { const h = homeOf(game, u); goTo(game, u, h.x, h.z, 6); u.intent = 'retreat'; return; }
  const c = o.x != null && o.type !== 'idle' ? { x: o.x, z: o.z } : (u.patrolC ||= { x: u.x, z: u.z });
  if (o.type === 'move') { if (goTo(game, u, c.x, c.z, 4)) u.intent = 'idle'; else u.intent = 'move'; return; }
  if (!u.patrolWp || Math.hypot(u.patrolWp.x - u.x, u.patrolWp.z - u.z) < 4 || (u.patrolWpT || 0) < game.time) {
    const a = game.rng.next() * Math.PI * 2, r = 8 + game.rng.next() * 14;
    const wp = nearestPassable(game.map, 'sub', c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, 20);
    u.patrolWp = wp && sameComponent(game.map, 'sub', u.x, u.z, wp.x, wp.z) ? wp : { x: u.x, z: u.z };
    u.patrolWpT = game.time + 25;
  }
  goTo(game, u, u.patrolWp.x, u.patrolWp.z, 3);
  u.intent = 'loiter';
}

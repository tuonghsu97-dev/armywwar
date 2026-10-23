// OWNER: agent AI chiến thuật
// Transport loops (order 30): GDD §11/§12/§14 — F-49, F-134, F-135, F-136, F-141, F-142, F-144, F-145, F-161, F-164.
//  - APC (50), heli_transport (30), supply_truck (20), stealth_ship (50), submarine (30) carry infantry drawn from
//    side.troops.reserve at the HQ / an owned strongpoint, go to the ordered point, unload as 'infantry' squads, go back
//    and repeat while the order stands. Reinforcements only come this way (F-145, no free respawn).
//  - Heli must land (u.landed) to drop; a submarine must win underwater (no enemy ship/sub near the dock), surface, unload.
//  - Carrying a SAM / Iron Dome (or u.extraWeapons) reduces troop capacity (F-164).
//  - SAM / Iron Dome start packed: carried by an APC/supply truck (aa.carriedBy) to a strongpoint, then deployed.
// Command: { type:'transportAA', aaId, carrierId, x, z }. Events: 'transport:load', 'transport:unload', 'aa:deployed'.
import { stop } from './movement.js';
import { nearestPassable, domainOf } from './path.js';
import { goTo, homeOf } from './ai.js';

export const TRANSPORT = {
  loadTime: 2,              // seconds at the pickup point
  unloadTime: 1.5,
  heliLandTime: 1.2,
  surfaceTime: 1.5,
  dockClearRadius: 25,      // no enemy ship/sub this close to the dock point (F-135)
  enoughSoldiers: 120,      // stop shuttling when this many friendly soldiers are already at the drop point
  maxSquads: 20,            // side-wide cap on live infantry squads
  reserveFloor: 100,        // shuttles leave this many soldiers in the reserve (crews for new purchases)
  weaponWeight: 10,         // soldiers lost per extra weapon carried (F-164)
  weaponDmg: 0.3,           // +30% damage per extra weapon for the squads it drops
  maxWeapons: 2,
};
export const AA_WEIGHT = { sam: 30, iron_dome: 20 };
const DEDICATED = new Set(['apc', 'heli_transport', 'supply_truck']);
const AA_CARRIERS = new Set(['apc', 'supply_truck']);
const LOOP_ORDERS = new Set(['move', 'capture', 'attack', 'defend', 'flank']);

// Troop capacity after weapons carried (F-164).
export function troopCapacity(u) {
  let c = u.def.capacity || 0;
  if (u.aaCargo) c -= AA_WEIGHT[u.aaCargo] ?? 20;
  c -= (u.extraWeapons || 0) * TRANSPORT.weaponWeight;
  return Math.max(0, c);
}

export function spawnInfantry(game, carrier, x, z, n, order) {
  const out = [];
  while (n > 0) {
    const k = Math.min(50, n); n -= k;
    // Never drop troops into water / buildings: snap to the nearest ground cell.
    const p = nearestPassable(game.map, 'ground', x + (game.rng.next() - 0.5) * 2, z + (game.rng.next() - 0.5) * 2, 16) || { x, z };
    const inf = game.spawn(carrier.side, 'infantry', p.x, p.z,
      { soldiers: k, group: carrier.group, extra: { squadSize: k, troop: true } }); // troops, not a formation weapon (F-52)
    if (order) inf.order = { ...order, home: { x, z } };
    // Extra weapons carried instead of soldiers (F-164): the dropped squad hits harder.
    if (carrier.extraWeapons) { inf.dmg *= 1 + TRANSPORT.weaponDmg * carrier.extraWeapons; inf.heavyWeapons = carrier.extraWeapons; }
    out.push(inf);
  }
  return out;
}

function infantryOrderFrom(game, o) {
  const sp = game.strongpoints.find(s => Math.hypot(s.x - o.x, s.z - o.z) < 12);
  const type = sp || o.type === 'capture' ? 'capture' : o.type === 'attack' || o.type === 'flank' ? 'attack' : 'defend';
  return { type, x: sp ? sp.x : o.x, z: sp ? sp.z : o.z, issued: o.issued, targetId: null };
}

function pickupPoint(game, u, drop) {
  const hq = game.hq(u.side);
  const cands = [];
  if (hq) cands.push({ x: hq.x + (u.side === 0 ? 6 : -6), z: hq.z });
  if (!u.isNaval) for (const sp of game.strongpoints) if (sp.owner === u.side && !(sp.capturer >= 0 && sp.capturer !== u.side)) cands.push({ x: sp.x, z: sp.z });
  let best = null, bd = Infinity;
  for (const c of cands) {
    const d = Math.hypot(c.x - drop.x, c.z - drop.z);
    if (d < 18) continue;
    if (d < bd) { bd = d; best = c; }
  }
  best ||= cands[0] || { x: u.x, z: u.z };
  if (u.isNaval) return homeOf(game, u);
  if (u.isAir) return best;
  return nearestPassable(game.map, 'ground', best.x, best.z, 14) || best;
}

function soldiersNear(game, side, x, z, r) {
  let n = 0;
  for (const o of game.unitsNear(x, z, r, o => o.side === side && o.def.id === 'infantry')) n += o.soldiers;
  return n;
}

export const transportSystem = {
  name: 'transport',
  update(game, dt) {
    if (game.phase !== 'battle') return;
    if (game.tick % 2 !== 1) return;
    const step = dt * 2;
    for (const u of game.units.values()) {
      if (!u.alive) continue;
      if (u.carriedBy) { const c = game.units.get(u.carriedBy); if (!c || !c.alive) game.kill(u, null); continue; }
      if (u.tTask?.kind === 'aa') { aaTask(game, u, step); continue; }
      if (u.def.transport !== 'troops') continue;
      troopLoop(game, u, step);
    }
    if (game.tick % 40 === 1) for (const s of game.sides) autoPairAA(game, s.id);
  },
};

export const WEAPON_CARRIERS = new Set(['apc', 'heli_transport']);

export function install(game) {
  game.addSystem(transportSystem, 30);
  // loadWeapons: { unitIds, n } — APC / transport heli carry n (0..2) extra weapons: −10 troop capacity each,
  // +30% damage each for the squads they drop (F-164). n omitted → cycle 0→1→2→0.
  game.onCommand('loadWeapons', (g, side, cmd) => {
    let k = 0;
    for (const id of cmd.unitIds || []) {
      const u = g.units.get(id);
      if (!u || !u.alive || u.side !== side || !WEAPON_CARRIERS.has(u.def.id)) continue;
      const n = cmd.n == null ? ((u.extraWeapons || 0) + 1) % (TRANSPORT.maxWeapons + 1) : Math.max(0, Math.min(TRANSPORT.maxWeapons, Math.floor(cmd.n)));
      u.extraWeapons = n; k++;
      g.events.emit('toast', { side, text: `${u.def.name}: chở thêm ${n} vũ khí — sức chở ${troopCapacity(u)} lính, tiểu đội thả xuống +${Math.round(n * TRANSPORT.weaponDmg * 100)}% sát thương` });
    }
    return k > 0;
  });
  game.onCommand('transportAA', (g, side, cmd) => {
    const aa = g.units.get(cmd.aaId), c = g.units.get(cmd.carrierId);
    if (!aa || !c || !aa.alive || !c.alive || aa.side !== side || c.side !== side) return false;
    if (!aa.def.needsTransport || !AA_CARRIERS.has(c.def.id) || aa.carriedBy) return false;
    if (c.tTask?.kind === 'aa' && c.tTask.aaId !== aa.id) { g.events.emit('toast', { side, text: 'Xe này đang chở phòng không khác' }); return false; }
    assignAA(g, c, aa, cmd.x ?? aa.x, cmd.z ?? aa.z);
    return true;
  });
}

function assignAA(game, c, aa, x, z) {
  // Snap the destination onto a strongpoint ring when close to one (GDD §11.6).
  const sp = game.strongpoints.find(s => Math.hypot(s.x - x, s.z - z) < 14);
  const dest = sp ? { x: sp.x + (c.side === 0 ? -3 : 3), z: sp.z } : { x, z };
  if (c.tTask?.kind === 'troops') { c.landed = false; }
  c.tTask = { kind: 'aa', aaId: aa.id, x: dest.x, z: dest.z, stage: 'pickup', issued: game.time };
  aa.awaitCarrier = c.id;
}

// ---------------------------------------------------------------- troop shuttle
function troopLoop(game, u, dt) {
  const o = u.order;
  const wants = u.speed > 0 && o && o.x != null && LOOP_ORDERS.has(o.type) && (DEDICATED.has(u.def.id) || o.type === 'capture');
  if (!wants) {
    if (u.tTask) endTroopTask(u);
    // back home on retreat: soldiers go back to the reserve
    if (o?.type === 'retreat' && u.cargo > 0) {
      const h = homeOf(game, u);
      if (Math.hypot(h.x - u.x, h.z - u.z) < 10) { const t = game.sides[u.side].troops; t.reserve += u.cargo; t.active -= u.cargo; u.cargo = 0; }
    }
    return;
  }
  let T = u.tTask;
  if (!T || T.issued !== o.issued) {
    if (T) endTroopTask(u);
    T = u.tTask = { kind: 'troops', issued: o.issued, stage: u.cargo > 0 ? 'go' : 'load', timer: 0, waitT: 0 };
  }
  const drop = dropPoint(game, u, o, T);
  switch (T.stage) {
    case 'load': {
      T.pickup ||= pickupPoint(game, u, drop || o);
      if (!goTo(game, u, T.pickup.x, T.pickup.z, u.isAir ? 3 : 4) && !(u.pathFails >= 3)) { u.intent = 'transport'; return; }
      stop(u); u.moveTarget = null;
      u.intent = 'load';
      const S = game.sides[u.side], cap = troopCapacity(u);
      const enough = drop && soldiersNear(game, u.side, drop.x, drop.z, 16) >= TRANSPORT.enoughSoldiers;
      const squads = countSquads(game, u.side);
      if (enough || squads >= TRANSPORT.maxSquads || cap <= u.cargo || S.troops.reserve <= TRANSPORT.reserveFloor) {
        if (u.cargo > 0 && !enough) { T.stage = 'go'; T.pickup = null; }
        return; // wait for need / soldiers
      }
      T.timer += dt;
      if (T.timer < TRANSPORT.loadTime) return;
      const n = Math.min(cap - u.cargo, S.troops.reserve - TRANSPORT.reserveFloor);
      S.troops.reserve -= n; S.troops.active += n; u.cargo += n;
      game.events.emit('transport:load', { unit: u, n });
      T.timer = 0; T.stage = 'go'; T.pickup = null;
      return;
    }
    case 'go': {
      if (!drop) { u.intent = 'transport'; T.waitT += dt; if (T.waitT > 20) { T.stage = 'load'; T.waitT = 0; } return; }
      const tol = u.isAir ? 2 : u.isNaval ? 5 : 4;
      const there = goTo(game, u, drop.x, drop.z, tol) || (!u.path && Math.hypot(drop.x - u.x, drop.z - u.z) < 9 && !u.isAir);
      u.intent = 'transport';
      if (!there) return;
      stop(u); u.moveTarget = null;
      T.stage = 'unload'; T.timer = 0;
      return;
    }
    case 'unload': {
      stop(u); u.moveTarget = null;
      if (u.cargo <= 0) { finishUnload(game, u, T); return; }
      if (u.def.id === 'heli_transport') { // F-134: must land to drop infantry
        u.landed = true; u.intent = 'unload';
        T.timer += dt;
        if (T.timer < TRANSPORT.heliLandTime) return;
        unload(game, u, u.x, u.z);
        return;
      }
      if (u.isNaval) {                       // F-135: win underwater, surface, then land troops
        const enemyNaval = game.unitsNear(drop.x, drop.z, TRANSPORT.dockClearRadius, e => e.side !== u.side && e.isNaval);
        if (enemyNaval.length) {
          if (u.layer === 'sea' && u.surfaced) { u.layer = 'sub'; u.surfaced = false; }
          T.timer = 0; u.intent = 'attack';
          const vis = enemyNaval.find(e => e.visible[u.side] && (u.def.hits || []).includes(e.layer));
          if (vis) u.target = vis;
          return;
        }
        const shore = drop.shore;
        if (!shore) { T.stage = 'go'; T.waitT = 21; return; }
        if (u.def.id === 'submarine' && u.layer === 'sub') { u.layer = 'sea'; u.surfaced = true; }
        u.intent = 'unload';
        T.timer += dt;
        if (T.timer < TRANSPORT.surfaceTime) return;
        unload(game, u, shore.x, shore.z);
        return;
      }
      u.intent = 'unload';
      T.timer += dt;
      if (T.timer < TRANSPORT.unloadTime) return;
      unload(game, u, u.x, u.z);
      return;
    }
    case 'return':
      T.stage = 'load'; T.timer = 0;
      return;
  }
}

function unload(game, u, x, z) {
  const n = u.cargo;
  u.cargo = 0;
  const squads = spawnInfantry(game, u, x, z, n, infantryOrderFrom(game, u.order));
  game.events.emit('transport:unload', { unit: u, n, x, z, squads });
  finishUnload(game, u, u.tTask);
}
function finishUnload(game, u, T) {
  u.landed = false;
  if (u.surfaced) { u.layer = 'sub'; u.surfaced = false; }
  T.stage = 'load'; T.timer = 0; T.pickup = null;
}
function endTroopTask(u) {
  u.landed = false;
  if (u.surfaced) { u.layer = 'sub'; u.surfaced = false; }
  u.tTask = null;
}

function countSquads(game, side) {
  let n = 0;
  for (const o of game.units.values()) if (o.alive && o.side === side && o.def.id === 'infantry') n++;
  return n;
}

// Where the carrier must stop to unload (cached per order).
function dropPoint(game, u, o, T) {
  if (T.drop && T.drop.ox === o.x && T.drop.oz === o.z) return T.drop.p;
  let p = null;
  if (u.isNaval) {
    // dock: nearest water cell this hull can use, with a shore point to put troops on
    const dock = nearestPassable(game.map, domainOf(u), o.x, o.z, 36);
    if (dock) {
      let shore = nearestPassable(game.map, 'ground', o.x, o.z, 6);
      if (!shore || Math.hypot(shore.x - dock.x, shore.z - dock.z) > 26) shore = nearestPassable(game.map, 'ground', dock.x, dock.z, 16);
      p = { x: dock.x, z: dock.z, shore };
    }
  } else if (u.isAir) {
    p = nearestPassable(game.map, 'ground', o.x, o.z, 14);  // landing zone
  } else {
    p = nearestPassable(game.map, 'ground', o.x, o.z, 14);
  }
  T.drop = { ox: o.x, oz: o.z, p };
  return p;
}

// ---------------------------------------------------------------- AA carry & deploy (F-136, F-144)
function aaTask(game, c, dt) {
  const T = c.tTask, aa = game.units.get(T.aaId);
  if (!aa || !aa.alive) { if (c.aaCargo) c.aaCargo = null; c.tTask = null; return; }
  if (T.stage === 'pickup') {
    c.intent = 'transport';
    if (aa.carriedBy && aa.carriedBy !== c.id) { c.tTask = null; return; }
    if (!goTo(game, c, aa.x, aa.z, 3.5)) { if (c.pathFails >= 4) { aa.awaitCarrier = null; c.tTask = null; } return; }
    stop(c);
    aa.carriedBy = c.id; aa.deployed = false; aa.awaitCarrier = c.id; aa.intent = 'transport';
    aa.target = null;
    c.aaCargo = aa.def.id;
    // Too many soldiers for the reduced capacity: the extra ones get off here (F-164).
    const cap = troopCapacity(c);
    if (c.cargo > cap) { const extra = c.cargo - cap; c.cargo = cap; spawnInfantry(game, c, c.x, c.z, extra, { type: 'defend', x: c.x, z: c.z, issued: game.time }); }
    game.events.emit('transport:load', { unit: c, aa });
    T.stage = 'carry';
    return;
  }
  if (T.stage === 'carry') {
    c.intent = 'transport';
    const there = goTo(game, c, T.x, T.z, 3) || (!c.path && Math.hypot(T.x - c.x, T.z - c.z) < 10 && c.pathFails >= 2);
    if (!there) return;
    stop(c);
    T.stage = 'deploy'; T.timer = 0;
    return;
  }
  if (T.stage === 'deploy') {
    c.intent = 'deploy';
    T.timer += dt;
    if (T.timer < 2) return;
    const p = nearestPassable(game.map, 'ground', c.x + (c.side === 0 ? 2 : -2), c.z + 1.5, 6) || { x: c.x, z: c.z };
    aa.carriedBy = null; aa.x = p.x; aa.z = p.z; aa.alt = c.alt;
    aa.deployed = true; aa.awaitCarrier = null; aa.intent = 'defend';
    aa.order = { type: 'defend', x: p.x, z: p.z, issued: game.time };
    aa.path = null; aa.dest = null; aa.moveTarget = null;
    c.aaCargo = null; c.tTask = null;
    game.events.emit('aa:deployed', { unit: aa, by: c });
    game.events.emit('toast', { side: c.side, text: `Đã triển khai ${aa.def.name}` });
  }
}

// Default AA position: an owned strongpoint without AA (nearest our HQ), else in front of the HQ.
export function autoAADest(game, side) {
  const hq = game.hq(side) || game.map.bases[side];
  const aas = [...game.units.values()].filter(u => u.alive && u.side === side && u.def.needsTransport && u.deployed);
  const sps = game.strongpoints.filter(sp => sp.owner === side && !aas.some(a => Math.hypot(a.x - sp.x, a.z - sp.z) < 12))
    .sort((a, b) => Math.hypot(a.x - hq.x, a.z - hq.z) - Math.hypot(b.x - hq.x, b.z - hq.z));
  if (sps.length && Math.hypot(sps[0].x - hq.x, sps[0].z - hq.z) < 140) return { x: sps[0].x, z: sps[0].z };
  const k = aas.length;
  return nearestPassable(game.map, 'ground', hq.x + (side === 0 ? 20 : -20), hq.z + (k % 3 - 1) * 14, 12) || { x: hq.x, z: hq.z };
}

function autoPairAA(game, side) {
  const S = game.sides[side];
  const packed = [], carriers = [];
  for (const u of game.units.values()) {
    if (!u.alive || u.side !== side) continue;
    if (u.def.needsTransport && !u.deployed && !u.carriedBy) {
      const c = u.awaitCarrier != null ? game.units.get(u.awaitCarrier) : null;
      if (c && c.alive && c.tTask?.kind === 'aa' && c.tTask.aaId === u.id) continue;
      u.awaitCarrier = null;
      packed.push(u);
    } else if (AA_CARRIERS.has(u.def.id) && !u.tTask && (u.order.type === 'idle' || (S.ai && u.def.id === 'supply_truck'))) carriers.push(u);
  }
  if (!packed.length) return;
  const anyCarrier = [...game.units.values()].some(u => u.alive && u.side === side && AA_CARRIERS.has(u.def.id));
  for (const aa of packed) {
    let best = null, bd = 90;
    for (const c of carriers) { const d = Math.hypot(c.x - aa.x, c.z - aa.z); if (d < bd) { bd = d; best = c; } }
    if (best) {
      carriers.splice(carriers.indexOf(best), 1);
      const o = aa.order;
      const dest = o && o.x != null && o.type !== 'idle' ? { x: o.x, z: o.z } : autoAADest(game, side);
      assignAA(game, best, aa, dest.x, dest.z);
    } else if (!anyCarrier && game.battleTime > 20) {
      // No truck/APC at all on this side: the battery sets up where it stands (base defence only).
      aa.deployed = true;
      game.events.emit('aa:deployed', { unit: aa, by: null });
    }
  }
}

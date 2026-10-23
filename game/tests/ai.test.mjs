// Tactical AI, capture, transport tests (OWNER: agent AI chiến thuật). Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/index.js';
import { troopCapacity } from '../src/sim/transport.js';
import { canHit } from '../src/sim/combat.js';
import { makeGame } from './sim-harness.mjs';

function blank(mapId = 'plains') {
  const g = createGame({ mode: 'skirmish', mapId, seed: 3, player: { commander: 'steel', formation: [] }, enemy: { commander: 'air', formation: [] } });
  g.startBattle();
  return g;
}
const run = (g, sec, until) => { for (let i = 0; i < sec * 20 && !g.ended; i++) { g.step(); if (until && until()) return true; } return false; };
const troopsTotal = (g, s) => g.sides[s].troops.reserve + g.sides[s].troops.active;

test('capture takes ~15 s of continuous presence', () => {
  const g = blank();
  const sp = g.strongpoints[0];
  let ev = null; g.events.on('capture', e => { ev = e; });
  const t = g.spawn(0, 'tank_heavy', sp.x, sp.z);
  t.holdFire = true;
  run(g, 14);
  assert.equal(sp.owner, -1, 'not yet captured at 14 s');
  assert.ok(sp.progress > 0.85 && sp.progress < 1, `progress ~14/15, got ${sp.progress}`);
  assert.equal(sp.capturer, 0);
  run(g, 1.5);
  assert.equal(sp.owner, 0, 'captured after 15 s');
  assert.equal(ev?.side, 0);
  run(g, 4);
  assert.ok(sp.held[0] > 3, 'held time accrues');
});

test('capture is frozen when contested and resets when attacked or when the capturer leaves', () => {
  const g = blank();
  const sp = g.strongpoints[2];
  const t = g.spawn(0, 'tank_heavy', sp.x, sp.z); t.holdFire = true;
  run(g, 7.5);
  const p0 = sp.progress;
  assert.ok(p0 > 0.4, 'progressing');
  const e = g.spawn(1, 'infantry', sp.x + 2, sp.z + 1, { soldiers: 20, extra: { squadSize: 20 } }); e.holdFire = true;
  run(g, 3);
  assert.equal(sp.contested, true, 'contested with enemy capable unit inside');
  assert.ok(Math.abs(sp.progress - p0) < 0.02, 'progress frozen while contested');
  g.kill(e, null);
  run(g, 1);
  assert.equal(sp.contested, false);
  assert.ok(sp.progress > p0, 'resumes once the enemy is gone');
  // attacked inside the ring -> reset
  const shooter = g.spawn(1, 'drone_recon', sp.x + 30, sp.z);
  g.damage(t, 1, 'kinetic', shooter);
  run(g, 0.2);
  assert.ok(sp.progress < 0.05, `reset when attacked inside, got ${sp.progress}`);
  // capturer leaves -> reset
  run(g, 3);
  assert.ok(sp.progress > 0.1);
  t.x = sp.x + 30; t.order = { type: 'idle' };
  run(g, 0.5);
  assert.equal(sp.progress, 0);
  assert.equal(sp.capturer, -1);
});

test('aircraft and drones cannot capture', () => {
  const g = blank();
  const sp = g.strongpoints[3];
  for (const id of ['heli_attack', 'ugv', 'heli_transport']) { const u = g.spawn(0, id, sp.x, sp.z); u.holdFire = true; u.autoRetreat = false; }
  run(g, 20);
  assert.equal(sp.owner, -1);
  assert.equal(sp.progress, 0);
});

test('transport loads from reserve, unloads an infantry squad of the same group, and goes back', () => {
  const g = blank();
  const apc = g.spawn(0, 'apc', 30, 30, { group: 4 });
  const total0 = troopsTotal(g, 0), res0 = g.sides[0].troops.reserve;
  const sp = g.strongpoints[0];
  let loaded = null, unloaded = null;
  g.events.on('transport:load', e => { if (!loaded) loaded = { n: e.n, reserve: g.sides[0].troops.reserve, active: g.sides[0].troops.active }; });
  g.events.on('transport:unload', e => { if (!unloaded) unloaded = e; });
  g.issue(0, { type: 'order', unitIds: [apc.id], order: 'capture', x: sp.x, z: sp.z });
  run(g, 120, () => !!unloaded);
  assert.ok(loaded, 'loaded');
  assert.equal(loaded.n, 50, 'APC capacity 50');
  assert.equal(loaded.reserve, res0 - 50, 'reserve -> active');
  assert.ok(unloaded, 'unloaded');
  const inf = unloaded.squads[0];
  assert.equal(inf.def.id, 'infantry');
  assert.equal(inf.soldiers, 50);
  assert.equal(inf.group, 4, 'same group');
  assert.equal(apc.cargo, 0);
  assert.equal(troopsTotal(g, 0), total0, 'soldiers conserved');
  assert.ok(Math.hypot(inf.x - sp.x, inf.z - sp.z) < 16, 'dropped at the ordered point');
  assert.equal(inf.order.type, 'capture');
  run(g, 6);
  assert.ok(['load', 'transport'].includes(apc.intent), `going back to reload, got ${apc.intent}`);
  // infantry delivered by transport captures the point
  inf.holdFire = true;
  run(g, 25);
  assert.equal(sp.owner, 0, 'dropped infantry captured the strongpoint');
});

test('helicopter must land to unload', () => {
  const g = blank();
  const heli = g.spawn(0, 'heli_transport', 20, 75, { group: 2 });
  let at = null;
  g.events.on('transport:unload', e => { if (!at) at = { landed: e.unit.landed, n: e.n }; });
  const sp = g.strongpoints[3];
  g.issue(0, { type: 'order', unitIds: [heli.id], order: 'capture', x: sp.x, z: sp.z });
  run(g, 90, () => !!at);
  assert.ok(at, 'unloaded');
  assert.equal(at.landed, true, 'landed while unloading');
  assert.equal(at.n, 30, 'heli capacity 30');
  run(g, 2);
  assert.equal(heli.landed, false, 'takes off again');
});

test('SAM needs a carrier, then deploys at the strongpoint and never moves', () => {
  const g = blank();
  const sam = g.spawn(0, 'sam', 24, 60);
  assert.equal(sam.deployed, false, 'starts packed');
  const truck = g.spawn(0, 'supply_truck', 26, 66);
  g.issue(0, { type: 'order', unitIds: [truck.id], order: 'move', x: 30, z: 70 }); // keep it busy: no auto pairing
  g.issue(0, { type: 'order', unitIds: [sam.id], order: 'move', x: 90, z: 75 });
  run(g, 6);
  assert.ok(Math.hypot(sam.x - 24, sam.z - 60) < 0.01, 'packed SAM cannot move by itself');
  assert.equal(sam.deployed, false);
  const sp = g.strongpoints[2];
  let carried = false, deployedEv = null;
  g.events.on('aa:deployed', e => { deployedEv = e; });
  g.issue(0, { type: 'transportAA', aaId: sam.id, carrierId: truck.id, x: sp.x, z: sp.z });
  run(g, 3);
  assert.equal(troopCapacity(truck), 0, 'truck carrying a SAM carries no soldiers');
  run(g, 120, () => { if (sam.carriedBy === truck.id) carried = true; return sam.deployed; });
  assert.ok(carried, 'was carried by the truck');
  assert.ok(sam.deployed, 'deployed');
  assert.equal(deployedEv?.by, truck);
  assert.ok(Math.hypot(sam.x - sp.x, sam.z - sp.z) < 10, 'at the strongpoint');
  const p = { x: sam.x, z: sam.z };
  g.issue(0, { type: 'order', unitIds: [sam.id], order: 'attack', x: 200, z: 75 });
  run(g, 15);
  assert.ok(Math.hypot(sam.x - p.x, sam.z - p.z) < 0.01, 'deployed SAM never moves');
});

test('carrying weapons reduces troop capacity (APC)', () => {
  const g = blank();
  const apc = g.spawn(0, 'apc', 30, 30);
  assert.equal(troopCapacity(apc), 50);
  apc.aaCargo = 'sam';
  assert.equal(troopCapacity(apc), 20);
  apc.aaCargo = null; apc.extraWeapons = 2;
  assert.equal(troopCapacity(apc), 30);
});

test('retreat triggers automatically under 30% HP, repairs at home, then resumes', () => {
  const g = blank();
  const t = g.spawn(0, 'tank_heavy', 70, 75);
  g.issue(0, { type: 'order', unitIds: [t.id], order: 'attack', x: 120, z: 75 });
  run(g, 1);
  t.hp = t.maxHp * 0.25;
  run(g, 0.5);
  assert.equal(t.order.type, 'retreat');
  assert.equal(t.order.auto, true);
  assert.equal(t.intent, 'retreat');
  let repaired = false;
  run(g, 120, () => { if (t.intent === 'repair') repaired = true; return repaired && t.order.type === 'attack'; });
  assert.ok(repaired, 'repaired at home');
  assert.equal(t.order.type, 'attack', 'resumed previous order');
  assert.ok(t.hpFrac >= 0.94);
});

test('focus makes every unit that can hit it target the same id', () => {
  const g = blank();
  const mine = [g.spawn(0, 'tank_heavy', 100, 70), g.spawn(0, 'tank_heavy', 100, 80), g.spawn(0, 'heli_attack', 98, 75), g.spawn(0, 'at_team', 102, 75)];
  const foes = [g.spawn(1, 'apc', 112, 70), g.spawn(1, 'tank_heavy', 113, 76), g.spawn(1, 'infantry', 111, 82)];
  for (const u of [...mine, ...foes]) u.autoRetreat = false;
  for (const u of foes) u.holdFire = true;
  run(g, 0.5);
  const target = foes[1];
  g.issue(0, { type: 'order', unitIds: mine.map(u => u.id), order: 'focus', x: target.x, z: target.z, targetId: target.id });
  run(g, 1.5);
  for (const u of mine) {
    assert.ok(canHit(u, target));
    assert.equal(u.forcedTarget?.id, target.id, `${u.def.id} forced target`);
    assert.equal(u.intent, 'focus');
  }
  // focus without explicit target: the squad agrees on one target near the point
  const g2 = blank();
  const m2 = [g2.spawn(0, 'tank_heavy', 100, 70), g2.spawn(0, 'tank_heavy', 100, 80), g2.spawn(0, 'heli_attack', 98, 75)];
  g2.spawn(1, 'apc', 112, 70).holdFire = true; g2.spawn(1, 'tank_heavy', 113, 76).holdFire = true;
  run(g2, 0.5);
  g2.issue(0, { type: 'order', unitIds: m2.map(u => u.id), order: 'focus', x: 112, z: 74 });
  run(g2, 1.5);
  const ids = new Set(m2.map(u => u.forcedTarget?.id));
  assert.equal(ids.size, 1, 'one shared target');
  assert.ok([...ids][0] != null, "a target was chosen");
});

test('fighters fly an attack pattern, fly home to rearm when out of ammo, then return', () => {
  const g = blank();
  const f = g.spawn(0, 'fighter_multi', 60, 75);
  f.autoRetreat = false;
  g.issue(0, { type: 'order', unitIds: [f.id], order: 'attack', x: 130, z: 75 });
  run(g, 15);
  assert.ok(f.moveTarget, 'pattern waypoint set');
  assert.ok(Math.hypot(f.moveTarget.x - 130, f.moveTarget.z - 75) < 25, 'pattern around the target');
  assert.ok(['circle', 'eight', 'u'].includes(f.pattern));
  f.ammo = 0;
  run(g, 0.5);
  assert.equal(f.intent, 'rearm');
  let landed = false;
  run(g, 60, () => { if (f.landed) landed = true; return landed && f.ammo === f.maxAmmo && !f.rearming; });
  assert.ok(landed, 'landed at the airfield');
  const af = g.structures.find(s => s.type === 'airfield' && s.side === 0);
  assert.ok(Math.hypot(f.x - af.x, f.z - af.z) < 10, 'at own airfield');
  assert.equal(f.ammo, f.maxAmmo);
  run(g, 15);
  assert.ok(Math.hypot(f.x - 130, f.z - 75) < 60 && f.intent !== 'rearm', 'back on task');
});

test('kamikaze drone dives on a target, damages it and dies; swarm loses drones one by one', () => {
  const g = blank();
  const k = g.spawn(0, 'drone_kamikaze', 100, 75);
  const tank = g.spawn(1, 'tank_heavy', 114, 75); tank.holdFire = true; tank.autoRetreat = false;
  g.issue(0, { type: 'order', unitIds: [k.id], order: 'attack', x: 112, z: 75 });
  const hp0 = tank.hp;
  run(g, 20, () => !k.alive);
  assert.equal(k.alive, false, 'kamikaze died on impact');
  assert.ok(tank.hp < hp0, 'target damaged');
  const s = g.spawn(0, 'swarm_fpv', 100, 75);
  const n0 = s.swarm;
  g.issue(0, { type: 'order', unitIds: [s.id], order: 'attack', x: 112, z: 75 });
  run(g, 12, () => s.swarm < n0 - 2);
  assert.ok(s.swarm < n0 && s.swarm > 0, 'swarm spends drones one by one');
});

test('recon drone marks enemies for the whole team (spotted)', () => {
  const g = blank();
  const d = g.spawn(0, 'drone_recon', 100, 75);
  const e = g.spawn(1, 'tank_heavy', 108, 75); e.holdFire = true;
  g.issue(0, { type: 'order', unitIds: [d.id], order: 'attack', x: 108, z: 75 });
  run(g, 2);
  assert.ok(e.spotted > 0 && e.spottedBy === 0);
});

test('CCA flies as wingman of the nearest manned fighter', () => {
  const g = blank();
  const lead = g.spawn(0, 'fighter_stealth', 60, 75);
  const c = g.spawn(0, 'cca', 50, 60);
  g.issue(0, { type: 'order', unitIds: [lead.id], order: 'move', x: 140, z: 75 });
  run(g, 8);
  assert.equal(c.leaderId, lead.id);
  assert.ok(Math.hypot(c.x - lead.x, c.z - lead.z) < 15, 'stays close to the leader');
});

test('submarine cannot land troops while enemy ships are near the dock, then surfaces and unloads', () => {
  const g = blank('bay');
  const sp = g.strongpoints.find(s => s.coastal && s.id === 3) || g.strongpoints.find(s => s.coastal);
  const sub = g.spawn(0, 'submarine', 40, 75, { group: 1 });
  sub.holdFire = true; sub.autoRetreat = false;
  let unloaded = null; g.events.on('transport:unload', e => { unloaded = e; });
  g.issue(0, { type: 'order', unitIds: [sub.id], order: 'capture', x: sp.x, z: sp.z });
  // park an enemy destroyer near the island
  const enemy = g.spawn(1, 'destroyer', sp.x + 14, sp.z + 2); enemy.holdFire = true; enemy.speed = 0;
  run(g, 120);
  assert.equal(unloaded, null, 'blocked by enemy ship near the dock');
  g.kill(enemy, null);
  let surfaced = false;
  run(g, 60, () => { if (sub.surfaced) surfaced = true; return !!unloaded; });
  assert.ok(unloaded, 'unloaded after the area was cleared');
  assert.ok(surfaced, 'surfaced to unload');
  assert.equal(unloaded.n, 30);
  run(g, 1);
  assert.equal(sub.layer, 'sub', 'dives again');
});

test('AI matches run clean: captures, transports, rearm, no exceptions', () => {
  for (const [map, p, e] of [['plains', 'steel', 'air'], ['city', 'swarm', 'ew'], ['bay', 'navy', 'air']]) {
    const g = makeGame({ map, p, e, seed: 11 });
    const ev = { capture: 0, unload: 0 };
    g.events.on('capture', () => ev.capture++);
    g.events.on('transport:unload', () => ev.unload++);
    run(g, 300);
    assert.ok(ev.capture >= 2, `${map}: captures happen (${ev.capture})`);
    assert.ok(ev.unload >= 1, `${map}: transports unload (${ev.unload})`);
    for (const u of g.units.values()) if (u.alive) { assert.ok(Number.isFinite(u.x) && Number.isFinite(u.z), 'finite positions'); assert.ok(u.intent, 'intent set'); }
  }
});

test('AI layers stay under 2 ms per tick with 120+ units', () => {
  const g = blank();
  const kinds = ['tank_heavy', 'infantry', 'spg', 'apc', 'drone_recon', 'heli_attack', 'fighter_multi', 'at_team', 'ugv', 'laser', 'drone_male', 'ew'];
  for (let s = 0; s < 2; s++) for (let i = 0; i < 62; i++) {
    const u = g.spawn(s, kinds[i % kinds.length], s === 0 ? 30 + (i % 8) * 4 : 210 - (i % 8) * 4, 20 + Math.floor(i / 8) * 14);
    u.maxHp = u.hp = 1e7; u.autoRetreat = false;
    u.order = { type: 'attack', x: s === 0 ? 200 : 40, z: 20 + (i % 3) * 55, issued: 1 + (i % 4), home: { x: u.x, z: u.z } };
  }
  const mine = g.systems.filter(s => ['ai', 'transport', 'capture'].includes(s.name));
  let t = 0, n = 0;
  for (const s of mine) { const o = s.update.bind(s); s.update = (game, dt) => { const a = performance.now(); o(game, dt); t += performance.now() - a; }; }
  run(g, 1); t = 0;
  for (let i = 0; i < 600; i++) { g.step(); n++; }
  const per = t / n;
  assert.ok(g.sideUnits(0).length + g.sideUnits(1).length >= 100, 'still 100+ units');
  assert.ok(per < 2, `AI per tick ${per.toFixed(3)} ms`);
  console.log(`  AI per tick: ${per.toFixed(3)} ms with ${g.sideUnits(0).length + g.sideUnits(1).length} units`);
});

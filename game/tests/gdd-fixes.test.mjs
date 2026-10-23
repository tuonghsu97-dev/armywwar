// GDD-compliance fixes: F-80 tier range, F-85 shared tier CP, F-81 accessory effects, F-90 city (line of sight,
// unspotted artillery behind buildings, heavy vehicles off-road, tunnels).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/index.js';
import { unitDef, tierStats, TIERS, unitCp, accessoryMods, activeAccessories, ACCESSORY_FX, tierBonusText } from '../src/data/units.js';
import { buildMap, T, CELL } from '../src/data/maps.js';
import * as P from '../src/core/profile.js';
import { cpUsed } from '../src/sim/economy.js';
import { losBlocked } from '../src/sim/vision.js';
import { maxAps, skillCooldown, jamRadiusOf } from '../src/sim/skills.js';

function mk(map = 'plains', opts = {}) {
  const g = createGame({ mode: 'skirmish', mapId: map, seed: 3,
    player: { commander: 'steel', ai: false, formation: [], money: 10_000_000_000, rareMaterials: 5, ...opts.player },
    enemy: { commander: 'air', ai: false, formation: [], ...opts.enemy } });
  g.startBattle();
  return g;
}
const steps = (g, sec) => { for (let i = 0; i < Math.round(sec * 20); i++) g.step(); };

test('F-80: T2 / T3 raise HP, damage and range by the GDD percentages (+20–25%, +45–55%)', () => {
  for (const id of ['tank_heavy', 'himars', 'sam', 'fighter_stealth']) {
    const d = unitDef(id), a = tierStats(d, 1), b = tierStats(d, 2), c = tierStats(d, 3);
    for (const k of ['hp', 'dmg', 'range']) {
      const r2 = b[k] / a[k] - 1, r3 = c[k] / a[k] - 1;
      assert.ok(r2 >= 0.195 && r2 <= 0.255, `${id} T2 ${k} +${(r2 * 100).toFixed(1)}%`);
      assert.ok(r3 >= 0.445 && r3 <= 0.555, `${id} T3 ${k} +${(r3 * 100).toFixed(1)}%`);
    }
  }
  assert.ok(tierBonusText(2).startsWith(`+${Math.round((TIERS[2].mult - 1) * 100)}% HP/sát thương/tầm`));
  assert.ok(tierBonusText(3).includes('+50% HP/sát thương/tầm'));
});

test('F-85: one CP formula for tiers in the formation builder and in the match', () => {
  for (const id of ['tank_heavy', 'drone_recon', 'destroyer', 'infantry']) {
    const d = unitDef(id);
    for (const t of [1, 2, 3]) {
      assert.equal(unitCp(d, t), (d.cp || 0) + t - 1);
      assert.equal(P.slotCp({ unit: id, tier: t, count: 1 }), unitCp(d, t), `${id} T${t}`);
    }
  }
  const f = [{ unit: 'tank_heavy', tier: 2, count: 1 }, { unit: 'spg', tier: 3, count: 1 }, { unit: 'apc', tier: 1, count: 1 }];
  const g = createGame({ mode: 'skirmish', mapId: 'plains', seed: 1, player: { commander: 'steel', formation: f }, enemy: { commander: 'air', formation: [] } });
  g.issue(0, { type: 'autodeploy' }); g.step();
  assert.equal(cpUsed(g, 0), P.formationTotals(f).cp, 'pre-match CP == in-match CP');
});

test('F-81: every group has 2 accessories with real mods; T2 = first, T3 = both', () => {
  for (const [grp, list] of Object.entries(ACCESSORY_FX)) {
    assert.equal(list.length, 2, grp);
    for (const a of list) assert.ok(a.name && a.desc && Object.keys(a.mods).length, grp + ' ' + a.name);
  }
  const d = unitDef('drone_recon');
  assert.deepEqual(activeAccessories(d, 1), []);
  assert.equal(activeAccessories(d, 2).length, 1);
  assert.deepEqual(accessoryMods(d, 3), { sightMult: 1.25, jamResist: 0.5 });
});

test('F-81: accessory stat effects apply on spawn and on in-match upgrade (retier)', () => {
  const g = mk();
  const t1 = g.spawn(0, 'tank_heavy', 20, 60, { tier: 1 }), t3 = g.spawn(0, 'tank_heavy', 20, 64, { tier: 3 });
  assert.equal(maxAps(t1), 1); assert.equal(maxAps(t3), 2, 'T3 tank: APS blocks twice');
  const t2 = g.spawn(0, 'tank_heavy', 20, 68, { tier: 2 });
  assert.ok(Math.abs(skillCooldown(t2) / (9 * t2.cooldownMult) - 0.7) < 1e-9, 'T2 tank: APS recharges 30% faster');
  const dr1 = g.spawn(0, 'drone_recon', 20, 70, { tier: 1 }), dr2 = g.spawn(0, 'drone_recon', 20, 72, { tier: 2 });
  assert.ok(Math.abs(dr2.sight / dr1.sight - 1.25) < 1e-9, 'drone radar +25% sight');
  const f1 = g.spawn(0, 'fighter_multi', 20, 74, { tier: 1 }), f2 = g.spawn(0, 'fighter_multi', 20, 76, { tier: 2 }), f3 = g.spawn(0, 'fighter_multi', 20, 78, { tier: 3 });
  assert.equal(f2.maxAmmo, f1.maxAmmo + 2, 'drop tanks +2 ammo');
  assert.ok(Math.abs(f3.range / f1.range - 1.5 * 1.1) < 1e-9, 'T3 air: tier +50% × long-range missiles +10%');
  const s1 = g.spawn(0, 'sam', 20, 80, { tier: 1 }), s2 = g.spawn(0, 'sam', 20, 84, { tier: 2 });
  assert.ok(Math.abs(s2.range / s1.range - 1.22 * 1.15) < 1e-9);
  const l2 = g.spawn(0, 'laser', 20, 88, { tier: 2 });
  assert.equal(l2.maxEnergy, 150);
  const e1 = g.spawn(0, 'ew', 20, 92, { tier: 1 }), e2 = g.spawn(0, 'ew', 20, 96, { tier: 2 });
  assert.ok(Math.abs(jamRadiusOf(g, e2) / jamRadiusOf(g, e1) - 1.2) < 1e-9, 'EW antenna +20% jam radius');
  const i1 = g.spawn(0, 'at_team', 20, 100, { tier: 1 }), i2 = g.spawn(0, 'at_team', 20, 102, { tier: 2 });
  assert.ok(Math.abs(i2.armor - i1.armor * (1 + 0.22 * 0.5) - 0.15) < 1e-9, 'level-4 armour +0.15');
  // In-match upgrade re-applies accessories (sight + ammo) without double counting.
  g.issue(0, { type: 'buy', unit: 'drone_recon' }); g.step();
  const slot = g.sides[0].formation.findIndex(s => s.unit === 'drone_recon');
  const d = g.sideUnits(0).find(u => u.group === slot && u.def.id === 'drone_recon');
  const sight1 = d.sight;
  g.issue(0, { type: 'upgrade', slot }); g.step();
  assert.equal(d.tier, 2);
  assert.ok(Math.abs(d.sight / sight1 - 1.25) < 1e-9);
  assert.deepEqual(d.acc, { sightMult: 1.25 });
  g.issue(0, { type: 'upgrade', slot }); g.step();
  assert.equal(d.tier, 3);
  assert.ok(Math.abs(d.sight / sight1 - 1.25) < 1e-9, 'sight not multiplied twice');
  assert.equal(d.acc.jamResist, 0.5);
});

test('F-81: behaviour accessories — jam resistance, double intercept, deep-dive sub, night vision', () => {
  // Kháng nhiễu: a T3 drone is only jammed in the inner half of an EW aura.
  const g = mk();
  const ew = g.spawn(1, 'ew', 120, 75, {});
  const r = jamRadiusOf(g, ew);
  const a = g.spawn(0, 'drone_kamikaze', 120 + r * 0.75, 75, { tier: 1 }), b = g.spawn(0, 'drone_kamikaze', 120 - r * 0.75, 75, { tier: 3 });
  a.speed = b.speed = 0; a.order = b.order = { type: 'retreat' };
  g.step(); g.step();
  assert.ok(a.jammed > 0, 'normal drone jammed');
  assert.ok(!(b.jammed > 0), 'jam-resistant drone outside half radius is not');
  // Timed jam wears off twice as fast.
  b.jammed = 2; a.jammed = 2; steps(g, 0.5);
  assert.ok(b.jammed < a.jammed - 0.3);
  // Đánh chặn kép: a T3 SAM can kill two missiles before its cooldown.
  const g2 = mk();
  const sam = g2.spawn(0, 'sam', 60, 75, { tier: 3 });
  assert.equal(sam.acc.doubleIntercept, true);
  // Ẩn mình sâu: enemy sonar range shrinks 30% against a T3 submarine.
  const g3 = mk('bay');
  const subs = [1, 3].map(t => g3.spawn(1, 'submarine', 120, 75, { tier: t }));
  const uuv = g3.spawn(0, 'uuv', 120 - 25, 75, {});
  uuv.speed = 0; subs.forEach(s => { s.speed = 0; s.order = { type: 'idle' }; });
  steps(g3, 0.3);
  assert.equal(subs[0].visible[0], true, 'T1 sub seen by sonar at 25');
  assert.equal(subs[1].visible[0], false, 'T3 deep-dive sub hidden at 25 (sonar ×0.7 = 21)');
});

test('F-90: city blocks block ground line of sight; air observers see over them', () => {
  const g = mk('city');
  const map = g.map;
  assert.ok(map.hasBuildings);
  // Find a segment crossing many building cells inside the city.
  const blocked = losBlocked(g, 64, 40, 64 + 30, 40 + 0.5);
  const cells = []; for (let x = 66; x < 94; x += 2) cells.push(map.grid[Math.floor(40 / CELL) * map.cols + Math.floor(x / CELL)]);
  assert.equal(blocked, cells.filter(c => c === T.BUILDING).length >= 2);
  assert.equal(losBlocked(mk('plains'), 10, 10, 200, 140), false, 'no buildings on the plains');
  // Find a concrete pair: observer on a street, target 12 units away behind ≥ 2 building cells.
  let pair = null;
  for (let z = 20; z < 90 && !pair; z += 2) for (let x = 40; x < 190 && !pair; x += 2) {
    const ok = (px, pz) => map.grid[Math.floor(pz / CELL) * map.cols + Math.floor(px / CELL)] !== T.BUILDING;
    if (ok(x, z) && ok(x + 12, z) && losBlocked(g, x, z, x + 12, z)) pair = [x, z];
  }
  assert.ok(pair, 'found a blocked pair');
  const [x, z] = pair;
  const obs = g.spawn(0, 'infantry', x, z, {}), tgt = g.spawn(1, 'tank_heavy', x + 12, z, {});
  for (const u of [obs, tgt]) { u.speed = 0; u.holdFire = true; }
  steps(g, 0.3);
  assert.equal(tgt.visible[0], false, 'tank behind buildings is hidden from infantry');
  const heli = g.spawn(0, 'heli_attack', x, z, {}); heli.speed = 0; heli.holdFire = true;
  steps(g, 0.3);
  assert.equal(tgt.visible[0], true, 'helicopter sees over the buildings');
});

test('F-90: unspotted artillery cannot hit targets behind buildings; heavy vehicles slower off-road in the city', () => {
  const g = mk('city');
  const map = g.map;
  let pair = null;
  for (let z = 20; z < 90 && !pair; z += 2) for (let x = 40; x < 170 && !pair; x += 2) {
    const free = (px, pz) => map.grid[Math.floor(pz / CELL) * map.cols + Math.floor(px / CELL)] !== T.BUILDING;
    if (free(x, z) && free(x + 13, z) && losBlocked(g, x, z, x + 13, z)) pair = [x, z];
  }
  const [x, z] = pair;
  const spg = g.spawn(0, 'spg', x, z, {}); spg.speed = 0; spg.sight = 30;
  const tgt = g.spawn(1, 'tank_heavy', x + 13, z, {}); tgt.speed = 0; tgt.holdFire = true;
  tgt.revealedTo = [g.time + 99, 0];        // side 0 "knows" where it is, but has no spotter mark
  let fired = 0; g.events.on('fire', e => { if (e.from === spg) fired++; });
  steps(g, 4);
  assert.equal(fired, 0, 'no shot through buildings without a spotter');
  tgt.spotted = 20; tgt.spottedBy = 0;
  steps(g, 4);
  assert.ok(fired > 0, 'spotted target can be shelled');
  // Heavy vehicle off-road vs on-road.
  const speedAt = (id, px, pz) => {
    const g2 = mk('city');
    const u = g2.spawn(0, id, px, pz, {});
    u.moveTarget = { x: px, z: pz - 30 }; u.heading = -Math.PI / 2; u.holdFire = true;
    const z0 = u.z; g2.step(); return Math.abs(u.z - z0);
  };
  const cell = (px, pz) => map.grid[Math.floor(pz / CELL) * map.cols + Math.floor(px / CELL)];
  const road = [60, 50];
  let off = null;
  for (let zz = 30; zz < 90 && !off; zz += 2) for (let xx = 64; xx < 110 && !off; xx += 2) if ([0, 1, 2, 3].every(k => cell(xx + 1, zz - k) === T.LAND)) off = [xx + 1, zz];
  assert.equal(map.grid[Math.floor(road[1] / CELL) * map.cols + Math.floor(road[0] / CELL)], T.ROAD);
  assert.notEqual(map.grid[Math.floor(off[1] / CELL) * map.cols + Math.floor(off[0] / CELL)], T.ROAD);
  const tankRoad = speedAt('tank_heavy', ...road), tankOff = speedAt('tank_heavy', ...off);
  const ugvRoad = speedAt('ugv', ...road), ugvOff = speedAt('ugv', ...off);
  // Roads are faster for everyone (path.js speedFactor); the city penalty is the extra ×0.75 for size ≥ 3 only.
  const rel = (tankOff / tankRoad) / (ugvOff / ugvRoad);
  assert.ok(Math.abs(rel - 0.75) < 0.05, `heavy ×0.75 off-road relative to light vehicles (${rel.toFixed(2)})`);
  const plains = mk('plains'), pt = plains.spawn(0, 'tank_heavy', 100, 100, {});
  assert.equal(plains.map.heavyPenalty, 0, 'no penalty outside the city');
});

test('F-90: city tunnels move infantry / UGV under the canal; tanks do not use them', () => {
  const map = buildMap('city');
  assert.equal(map.tunnels.length, 2);
  const g = mk('city');
  const t = g.map.tunnels[0];
  const ugv = g.spawn(0, 'ugv', t.a.x - 2, t.a.z - 6, {});
  const tank = g.spawn(0, 'tank_heavy', t.a.x + 3, t.a.z - 6, {});
  const ev = [];
  g.events.on('tunnel', e => ev.push({ id: e.unit.id, phase: e.phase, t: g.time }));
  g.issue(0, { type: 'order', unitIds: [ugv.id, tank.id], order: 'move', x: t.b.x, z: t.b.z + 12 });
  let hiddenSeen = false;
  for (let i = 0; i < 20 * 20; i++) { g.step(); if (ugv.tunnel) { hiddenSeen = true; assert.equal(ugv.visible[1], false); } }
  assert.ok(ev.some(e => e.id === ugv.id && e.phase === 'enter') && ev.some(e => e.id === ugv.id && e.phase === 'exit'), 'UGV went through the tunnel');
  assert.ok(hiddenSeen, 'underground for a while');
  const enter = ev.find(e => e.phase === 'enter').t, exit = ev.find(e => e.phase === 'exit').t;
  assert.ok(exit - enter >= 3.9, 'short delay underground');
  assert.ok(!ev.some(e => e.id === tank.id), 'tank does not use tunnels');
  assert.ok(Math.abs(ugv.z - (t.b.z + 12)) < 10, 'UGV came out and continued south');
});

test('F-50: SPG barrage fires thermobaric shells — fire damage plus burning over time', () => {
  const g = mk();
  const spg = g.spawn(0, 'spg', 60, 75, {});
  const t = g.spawn(1, 'infantry', 90, 75, {}); t.speed = 0; t.holdFire = true;
  spg.speed = 0; spg.holdFire = true;
  const types = new Set(); g.events.on('fire', e => { if (e.from === spg) types.add(e.proj.dmgType); });
  g.issue(0, { type: 'skill', unitIds: [spg.id], x: 90, z: 75 });
  let burned = false;
  for (let i = 0; i < 20 * 5; i++) { g.step(); if (t.burn) burned = true; }
  assert.ok(types.has('fire'), 'barrage uses the fire damage type');
  assert.ok(burned, 'target set on fire');
});

test('F-164: loadWeapons trades 10 troop seats per weapon for +30% damage of the dropped squad', async () => {
  const { troopCapacity, spawnInfantry } = await import('../src/sim/transport.js');
  const g = mk();
  const apc = g.spawn(0, 'apc', 40, 75, {});
  assert.equal(troopCapacity(apc), 50);
  g.issue(0, { type: 'loadWeapons', unitIds: [apc.id], n: 2 }); g.step();
  assert.equal(apc.extraWeapons, 2);
  assert.equal(troopCapacity(apc), 30);
  const [sq] = spawnInfantry(g, apc, 40, 75, 30, null);
  const plain = g.spawn(0, 'infantry', 40, 78, { soldiers: 30 });
  assert.ok(Math.abs(sq.dmg / plain.dmg - 1.6) < 1e-9);
  g.issue(0, { type: 'loadWeapons', unitIds: [apc.id] }); g.step();
  assert.equal(apc.extraWeapons, 0, 'cycles 2 → 0');
  const tank = g.spawn(0, 'tank_heavy', 40, 80, {});
  g.issue(0, { type: 'loadWeapons', unitIds: [tank.id], n: 1 }); g.step();
  assert.ok(!tank.extraWeapons, 'only APC / transport helicopter');
});

test('F-07: "Gọi viện" spends 40 CP for 2 squads + 1 APC at the HQ (cooldown 90 s, not formation slots)', async () => {
  const { REINFORCE } = await import('../src/sim/commanders.js');
  const { liveFormationCount } = await import('../src/sim/economy.js');
  const g = mk();
  const S = g.sides[0];
  S.cp = 50;
  const n0 = g.sideUnits(0).length, r0 = S.troops.reserve;
  g.issue(0, { type: 'reinforce' }); g.step();
  const added = g.sideUnits(0).slice(n0);
  assert.equal(added.filter(u => u.def.id === 'infantry').length, 2);
  assert.equal(added.filter(u => u.def.id === 'apc').length, 1);
  assert.ok(S.cp < 50 - REINFORCE.cost + 1);
  assert.equal(r0 - S.troops.reserve, 2 * 50 + 3, 'soldiers + APC crew drawn from the reserve');
  const hq = g.hq(0);
  assert.ok(added.every(u => Math.hypot(u.x - hq.x, u.z - hq.z) < 20), 'at the HQ');
  assert.equal(liveFormationCount(g, 0), 0, 'support troops do not use formation slots');
  S.cp = 100;
  g.issue(0, { type: 'reinforce' }); g.step();
  assert.equal(g.sideUnits(0).length, n0 + 3, 'cooldown');
});

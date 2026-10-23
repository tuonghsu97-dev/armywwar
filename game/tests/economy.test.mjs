// Economy tests (GDD §9 §14 §15): buy (money, 9-slot limit, CP limit), sell, upgrade, loans (interest, due,
// liquidation, bankrupt), recruitment cap, mobilization upkeep, income per strongpoint, score, CP regen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/index.js';
import { unitDef, CP_LIMIT, TIERS } from '../src/data/units.js';
import { ECON, unitPrice, cpUsed, cpRemaining, incomePerMin, upkeepPerMin, upgradeCost } from '../src/sim/economy.js';

function mk({ formation = [], money, rare, map = 'plains' } = {}) {
  const g = createGame({ mode: 'skirmish', mapId: map, seed: 3,
    player: { commander: 'steel', ai: false, formation, money, rareMaterials: rare },
    enemy: { commander: 'air', ai: false, formation: [] } });
  g.startBattle();
  return g;
}
const steps = (g, sec) => { for (let i = 0; i < Math.round(sec * 20); i++) g.step(); };
const cmd = (g, c, side = 0) => { g.issue(side, c); g.step(); };
const mine = g => g.sideUnits(0);

test('buy: deducts money, spawns at HQ with slot group, crew drawn from troops', () => {
  const g = mk();
  const m0 = g.sides[0].money, r0 = g.sides[0].troops.reserve;
  cmd(g, { type: 'buy', unit: 'tank_heavy', count: 2 }); // legacy count is ignored: 1 slot = 1 weapon (F-52)
  const us = mine(g);
  assert.equal(us.length, 1);
  assert.ok(Math.abs(g.sides[0].money - (m0 - 10_000_000)) < 1e5, 'money deducted (plus tiny upkeep tick)');
  assert.equal(us[0].group, 0);
  assert.equal(g.sides[0].formation.length, 1);
  assert.equal(g.sides[0].formation[0].count, 1);
  assert.equal(g.sides[0].troops.reserve, r0 - 4);
  const hq = g.hq(0);
  assert.ok(Math.hypot(us[0].x - hq.x, us[0].z - hq.z) < 20, 'spawned near HQ');
  // Same type takes its own slot.
  cmd(g, { type: 'buy', unit: 'tank_heavy', count: 1 });
  assert.equal(g.sides[0].formation.length, 2);
  assert.equal(mine(g).find(u => u.group === 1)?.def.id, 'tank_heavy');
});

test('buy: aircraft spawn at the airfield', () => {
  const g = mk();
  cmd(g, { type: 'buy', unit: 'drone_recon' });
  const af = g.structures.find(s => s.type === 'airfield' && s.side === 0);
  const u = mine(g)[0];
  assert.ok(Math.hypot(u.x - af.x, u.z - af.z) < 8);
});

test('buy: rejected when money is insufficient; >1 tỷ needs a loan', () => {
  const g = mk({ money: 5_000_000 });
  cmd(g, { type: 'buy', unit: 'tank_heavy' });
  assert.equal(mine(g).length, 0);
  const g2 = mk({ map: 'bay' });
  cmd(g2, { type: 'buy', unit: 'destroyer' });
  assert.equal(mine(g2).length, 0, 'destroyer 2.2 tỷ not affordable with 1 tỷ');
  cmd(g2, { type: 'loan', amount: 1_000_000_000 });
  cmd(g2, { type: 'loan', amount: 300_000_000 });
  cmd(g2, { type: 'buy', unit: 'destroyer' });
  assert.equal(mine(g2).length, 1, 'affordable after loans');
  assert.equal(mine(g2)[0].def.id, 'destroyer');
});

test('buy: 9-slot formation limit, swarm = 1 slot, dead slot is reusable', () => {
  const g = mk({ money: 10_000_000_000 });
  const types = ['ugv', 'at_team', 'supply_truck', 'drone_kamikaze', 'swarm_fpv', 'infantry', 'apc', 'drone_recon', 'spg'];
  for (const t of types) cmd(g, { type: 'buy', unit: t });
  assert.equal(g.sides[0].formation.length, 9);
  assert.equal(mine(g).filter(u => u.def.id === 'swarm_fpv').length, 1, 'a 24-drone swarm is one unit in one slot');
  cmd(g, { type: 'buy', unit: 'swarm_fpv' });
  assert.equal(g.sides[0].formation.length, 9);
  assert.equal(mine(g).filter(u => u.def.id === 'swarm_fpv').length, 1, '10th weapon rejected even for an owned type');
  cmd(g, { type: 'buy', unit: 'tank_heavy' });
  assert.equal(mine(g).some(u => u.def.id === 'tank_heavy'), false, '10th weapon rejected');
  // Troops dropped by transports share a slot group but are not formation weapons.
  const apc = mine(g).find(u => u.def.id === 'apc');
  g.spawn(0, 'infantry', apc.x, apc.z, { group: apc.group, soldiers: 20, extra: { troop: true } });
  // Kill the UGV slot → its slot is free again.
  for (const u of mine(g)) if (u.def.id === 'ugv') g.kill(u, 1);
  cmd(g, { type: 'buy', unit: 'tank_heavy' });
  const t = mine(g).find(u => u.def.id === 'tank_heavy');
  assert.ok(t, 'bought into the freed slot');
  assert.equal(t.group, 0);
  assert.equal(g.sides[0].formation.length, 9);
});

test('buy: formation CP limit (30)', () => {
  const g = mk({ money: 10_000_000_000 });
  for (let i = 0; i < 7; i++) cmd(g, { type: 'buy', unit: 'tank_heavy' }); // 21 CP
  cmd(g, { type: 'buy', unit: 'himars' });          // +4 = 25 CP
  assert.equal(cpUsed(g, 0), 25);
  cmd(g, { type: 'buy', unit: 'fighter_stealth' });                          // +4 = 29 → fine
  assert.equal(cpUsed(g, 0), 29);
  assert.equal(cpRemaining(g, 0), 1);
  const n = mine(g).length;
  // 9 slots used now; free one, then CP still limits what fits.
  g.kill(mine(g).find(u => u.def.id === 'tank_heavy'), 1);
  assert.equal(cpRemaining(g, 0), 4, 'losses free CP');
  cmd(g, { type: 'buy', unit: 'heli_transport' }); // 3 CP fits
  assert.equal(cpRemaining(g, 0), 1);
  g.kill(mine(g).find(u => u.def.id === 'tank_heavy'), 1);
  cmd(g, { type: 'buy', unit: 'sam' }); // 4 CP: 1 + 3 freed = 4 → fits exactly
  assert.equal(cpRemaining(g, 0), 0);
  g.kill(mine(g).find(u => u.def.id === 'tank_heavy'), 1);
  cmd(g, { type: 'buy', unit: 'fighter_multi' }); // 4 CP > 3 left → rejected
  assert.equal(mine(g).filter(u => u.def.id === 'fighter_multi').length, 0, 'no CP left');
  assert.equal(mine(g).length, n - 1);
  assert.equal(CP_LIMIT, 30);
});

test('sell: 55% of purchase price, crew back to reserve', () => {
  const g = mk();
  cmd(g, { type: 'buy', unit: 'tank_heavy' });
  const u = mine(g)[0], m = g.sides[0].money, r = g.sides[0].troops.reserve;
  cmd(g, { type: 'sell', unitId: u.id });
  assert.equal(mine(g).length, 0);
  assert.ok(Math.abs(g.sides[0].money - m - 5_500_000) < 1e5);
  assert.equal(g.sides[0].troops.reserve, r + 4);
});

test('upgrade: costs money, re-applies tier stats keeping hp fraction; T3 needs rare material; max 3 T3', () => {
  const g = mk({ money: 10_000_000_000 });
  cmd(g, { type: 'buy', unit: 'tank_heavy' });
  const u = mine(g)[0];
  u.hp = u.maxHp / 2;
  const hp1 = u.maxHp, dmg1 = u.dmg, rng1 = u.range, m = g.sides[0].money, cp1 = cpUsed(g, 0);
  const cost = upgradeCost(g, 0, 0);
  assert.equal(cost, 10_000_000 * TIERS[2].costMult);
  cmd(g, { type: 'upgrade', slot: 0 });
  assert.equal(u.tier, 2);
  assert.ok(Math.abs(u.maxHp / hp1 - 1.22) < 0.01);
  assert.ok(Math.abs(u.range / rng1 - 1.22) < 0.01, 'T2 range +22% (GDD +20–25%)');
  assert.equal(cpUsed(g, 0), cp1 + 1, 'T2 costs +1 CP (F-85)');
  assert.ok(u.dmg > dmg1);
  assert.ok(Math.abs(u.hp / u.maxHp - 0.5) < 1e-6, 'hp fraction kept');
  assert.ok(Math.abs(g.sides[0].money - (m - cost)) < 2e5);
  cmd(g, { type: 'upgrade', slot: 0 });
  assert.equal(u.tier, 2, 'T3 blocked without rare material');
  // With rare materials: max 3 T3 slots.
  const g2 = mk({ money: 10_000_000_000, rare: 5 });
  for (const t of ['ugv', 'at_team', 'apc', 'spg']) { cmd(g2, { type: 'buy', unit: t, tier: 2 }); }
  for (let s = 0; s < 4; s++) cmd(g2, { type: 'upgrade', slot: s });
  assert.deepEqual(g2.sides[0].formation.map(s => s.tier), [3, 3, 3, 2]);
  assert.equal(g2.sides[0].rareMaterials, 2);
});

test('loan: interest + due time; repay', () => {
  const g = mk();
  const m = g.sides[0].money;
  cmd(g, { type: 'loan', amount: 300_000_000 });
  const L = g.sides[0].loans[0];
  assert.equal(L.owed, Math.round(300_000_000 * (1 + ECON.loanRate)));
  assert.ok(Math.abs(L.due - g.time - ECON.loanTerm) < 0.2);
  assert.ok(g.sides[0].money > m + 299_000_000);
  cmd(g, { type: 'repay' });
  assert.equal(g.sides[0].loans.length, 0);
  assert.ok(g.sides[0].money < m, 'paid interest');
});

test('loan due with insufficient money → liquidation at 55% pays it', () => {
  const g = mk({ money: 100_000_000 });
  cmd(g, { type: 'buy', unit: 'heli_attack' }); cmd(g, { type: 'buy', unit: 'heli_attack' }); // 70tr
  cmd(g, { type: 'loan', amount: 100_000_000 });            // owe 112tr
  cmd(g, { type: 'buy', unit: 'fighter_stealth' });          // 80tr
  g.sides[0].money = 50_000_000;
  g.sides[0].loans[0].due = g.time; // due now
  steps(g, 0.2);
  assert.equal(g.sides[0].loans.length, 0, 'loan settled');
  assert.equal(g.sides[0].bankrupt, false);
  assert.ok(mine(g).length < 3, 'some units sold');
  assert.ok(!g.ended);
});

test('loan due, liquidation not enough → bankrupt → defeat', () => {
  const g = mk({ money: 100_000_000 });
  cmd(g, { type: 'buy', unit: 'tank_heavy' });
  cmd(g, { type: 'loan', amount: 500_000_000 });
  g.sides[0].money = 0;
  g.sides[0].loans[0].due = g.time;
  steps(g, 0.2);
  assert.equal(mine(g).length, 0, 'everything sold');
  assert.equal(g.sides[0].bankrupt, true);
  assert.ok(g.ended);
  assert.equal(g.ended.winner, 1);
  assert.match(g.ended.reason, /phá sản/);
});

test('recruit: costs money, training time, capped per minute', () => {
  const g = mk();
  const r0 = g.sides[0].troops.reserve, m0 = g.sides[0].money;
  cmd(g, { type: 'recruit', amount: 500 });
  const q = g.sides[0].troops.recruiting;
  assert.equal(q.reduce((a, r) => a + r.n, 0), ECON.recruitCapPerMin, 'clamped to per-minute cap');
  assert.ok(Math.abs(m0 - g.sides[0].money - ECON.recruitCapPerMin * ECON.recruitCost) < 1e5, 'paid recruitment (± one tick of cash flow)');
  cmd(g, { type: 'recruit', amount: 10 });
  assert.equal(g.sides[0].troops.recruiting.length, 1, 'cap reached this minute');
  assert.equal(g.sides[0].troops.reserve, r0);
  steps(g, ECON.recruitTime + 0.5);
  assert.equal(g.sides[0].troops.reserve, r0 + ECON.recruitCapPerMin);
});

test('mobilize: big batch, raises upkeep and lowers income while active; once per match', () => {
  const g = mk();
  g.strongpoints[0].owner = 0;
  const inc0 = incomePerMin(g, 0), up0 = upkeepPerMin(g, 0);
  cmd(g, { type: 'mobilize' });
  assert.equal(g.sides[0].mobilized, true);
  assert.ok(upkeepPerMin(g, 0) > up0 * 2);
  assert.ok(Math.abs(incomePerMin(g, 0) - inc0 * ECON.mobilizeIncomeMult) < 1);
  const r0 = g.sides[0].troops.reserve;
  steps(g, ECON.mobilizeTime + 0.5);
  assert.equal(g.sides[0].troops.reserve, r0 + ECON.mobilizeAmount);
  cmd(g, { type: 'mobilize' });
  assert.equal(g.sides[0].troops.recruiting.length, 0, 'second mobilization rejected');
  g.time += ECON.mobilizeDuration; steps(g, 0.1);
  assert.equal(g.sides[0].mobilized, false);
});

test('income per held strongpoint per minute, upkeep subtracted', () => {
  const g = mk();
  const m0 = g.sides[0].money;
  steps(g, 60);
  const base = g.sides[0].money - m0;
  const g2 = mk();
  g2.strongpoints[0].owner = 0; g2.strongpoints[1].owner = 0;
  const m1 = g2.sides[0].money;
  steps(g2, 60);
  const withSp = g2.sides[0].money - m1;
  assert.ok(Math.abs(withSp - base - 2 * ECON.incomePerSp) < 1e5, `2 strongpoints = +${2 * ECON.incomePerSp}/min (got ${withSp - base})`);
  assert.ok(Math.abs(base - (ECON.baseIncome - 2000 * ECON.troopUpkeep)) < 1e5, 'base income minus troop upkeep');
});

test('kill bounty and high-value kill score', () => {
  const g = mk();
  g.issue(1, { type: 'buy', unit: 'heli_attack' }); g.step();
  const u = g.sideUnits(1)[0];
  const m = g.sides[0].money, s = g.sides[0].score;
  g.kill(u, 0);
  assert.ok(Math.abs(g.sides[0].money - m - 35_000_000 * ECON.bountyRate) < 1);
  assert.equal(g.sides[0].score - s, 35);
});

test('occupation score and command points accrue faster with strongpoints', () => {
  const g = mk();
  g.sides[0].cp = 0; g.sides[1].cp = 0;
  g.strongpoints[0].owner = 0; g.strongpoints[1].owner = 0; g.strongpoints[2].owner = 0;
  steps(g, 10);
  assert.ok(Math.abs(g.sides[0].score - 30) < 0.5, 'score = 3 sp × 10 s');
  assert.equal(Math.round(g.sides[1].score), 0);
  assert.ok(g.sides[0].cp > g.sides[1].cp * 2.5, 'CP regen faster with strongpoints');
  assert.ok(Math.abs(g.sides[1].cp - ECON.cpRegenBase * 10) < 0.1);
});

test('unitPrice: swarm priced per swarm, tiers cumulative', () => {
  assert.equal(unitPrice(unitDef('swarm_fpv')), 500 * 24);
  assert.equal(unitPrice(unitDef('tank_heavy'), 3), Math.round(10_000_000 * (1 + TIERS[2].costMult + TIERS[3].costMult)));
});

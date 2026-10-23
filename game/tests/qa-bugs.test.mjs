// QA (tester agent): regression tests for behaviour found while play-testing. Tests marked "BUG" are expected to FAIL
// until the bug is fixed (they reproduce it); the others guard rules that currently work.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/core/profile.js';
import { createGame } from '../src/sim/index.js';
import { passable } from '../src/sim/path.js';
import { spawnInfantry } from '../src/sim/transport.js';
import { MAPS } from '../src/data/maps.js';
import { CAPTURE_TIME } from '../src/sim/capture.js';

const steps = (g, sec) => { for (let i = 0; i < Math.round(sec * 20) && !g.ended; i++) g.step(); };

function emptyBattle(map = 'plains') {
  const g = createGame({ mode: 'skirmish', mapId: map, seed: 5,
    player: { commander: 'steel', formation: [] }, enemy: { commander: 'air', formation: [] } });
  g.sides[1].autoShop = false;
  g.startBattle();
  return g;
}

test('capture: ground unit alone in the ring flips a neutral strongpoint after ~15 s (F-131/F-132)', () => {
  const g = emptyBattle();
  const sp = g.strongpoints[0];
  const t = g.spawn(0, 'tank_heavy', sp.x, sp.z, { group: 0 });
  t.order = { type: 'defend', x: sp.x, z: sp.z };
  steps(g, CAPTURE_TIME - 1);
  assert.equal(sp.owner, -1, 'not yet captured at 14 s');
  steps(g, 2.5);
  assert.equal(sp.owner, 0, 'captured after 15 s');
});

test('capture: enemy unit inside the ring freezes progress (contested) (F-131)', () => {
  const g = emptyBattle();
  const sp = g.strongpoints[0];
  const a = g.spawn(0, 'tank_heavy', sp.x - 1, sp.z, { group: 0 });
  const b = g.spawn(1, 'tank_heavy', sp.x + 1, sp.z, { group: 0 });
  for (const u of [a, b]) { u.order = { type: 'defend', x: u.x, z: u.z }; u.dmg = 0; }
  steps(g, 20);
  assert.equal(sp.owner, -1);
  assert.equal(sp.contested, true);
});

test('capture: aircraft / drones cannot capture (F-133)', () => {
  const g = emptyBattle();
  const sp = g.strongpoints[0];
  const d = g.spawn(0, 'drone_recon', sp.x, sp.z, { group: 0 });
  d.order = { type: 'defend', x: sp.x, z: sp.z };
  steps(g, 20);
  assert.equal(sp.owner, -1);
});

test('BUG: tutorial first-completion reward (300 gold) is lost because the overlay sets tutorialDone before the match ends', () => {
  const p = P.defaultProfile();
  // ui/tutorial.js Tutorial.finish() runs first (on "Hoàn thành"/"Bỏ qua") and saves p.tutorialDone = true …
  p.tutorialDone = true;
  // … then the tutorial match ends and screens.js recordMatch() -> applyMatchResult():
  const r = P.applyMatchResult(p, { mode: 'tutorial', won: true, formation: [], orders: {} });
  assert.equal(r.gold, 300, 'player never receives the "Hoàn thành trận tập" reward');
});

test('BUG: "Đề xuất" for Đô đốc Hải quân auto-takes a 2 tỷ loan that it cannot repay → bankrupt at ~8:00', () => {
  const r = P.recommendWithLoan('navy', {});
  let bankrupt = 0; const runs = [];
  for (const [map, seed] of [['bay', 3], ['bay', 4], ['plains', 4], ['city', 3]]) {
    const enemy = P.recommendWithLoan('swarm', {});
    const g = createGame({ mode: 'skirmish', mapId: map, seed,
      player: { commander: 'navy', ai: true, formation: r.formation, ...P.playerEconomy(r.formation, r.loan) },
      enemy: { commander: 'swarm', ai: true, formation: enemy.formation, ...P.playerEconomy(enemy.formation, enemy.loan) } });
    steps(g, 560);
    if (g.ended && /phá sản/.test(g.ended.reason) && g.ended.winner === 1) bankrupt++;
    runs.push(`${map}/${seed}: ${g.ended ? g.ended.reason : 'running'}`);
  }
  // fix agent: the recommendation no longer takes the max loan; only repayable loans (profile.loanRepayable).
  assert.ok(r.loan < 2_000_000_000, 'navy recommendation does not take the unrepayable 2 tỷ loan');
  assert.equal(bankrupt, 0, `navy went bankrupt in ${bankrupt}/4 runs: ${runs.join(' | ')}`);
});

test('BUG: infantry dropped by a helicopter over water spawns in the water (transport.js spawnInfantry has no passability check)', () => {
  const g = emptyBattle('plains');
  // find a water cell adjacent to land (river bank)
  let spot = null;
  for (let z = 10; z < g.map.h - 10 && !spot; z += 1) for (let x = 60; x < g.map.w - 60 && !spot; x += 1)
    if (!passable(g.map, 'ground', x, z) && passable(g.map, 'ground', x + 3, z) && passable(g.map, 'sea', x, z)) spot = { x, z };
  assert.ok(spot, 'river bank found');
  const heli = g.spawn(0, 'heli_transport', spot.x, spot.z, { group: 0 });
  const inf = spawnInfantry(g, heli, spot.x, spot.z, 50, null);
  for (const u of inf) assert.ok(passable(g.map, 'ground', u.x, u.z), `infantry spawned on impassable cell at ${u.x.toFixed(1)},${u.z.toFixed(1)}`);
});

test('BUG: map hints disagree with the map text (city says "Tank nặng" is limited, bay says "bộ binh")', () => {
  assert.ok(MAPS.city.limitedGroups.includes('tank'), `city.limited="${MAPS.city.limited}" but limitedGroups=${JSON.stringify(MAPS.city.limitedGroups)}`);
  assert.ok(MAPS.bay.limitedGroups.includes('infantry'), `bay.limited="${MAPS.bay.limited}" but limitedGroups=${JSON.stringify(MAPS.bay.limitedGroups)}`);
});

test('time limit, out of soldiers, HQ, surrender all end the match (F-150..F-155) — smoke', () => {
  const g = emptyBattle();
  g.issue(0, { type: 'surrender' });
  steps(g, 0.1);
  assert.equal(g.ended.winner, 1);
});

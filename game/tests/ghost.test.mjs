// Ghost battles: snapshot save -> replay at same ticks mirrored to side 1, deviation fallback, anti-abuse (F-103..F-107).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/index.js';
import { makeSnapshot, seedPool, eligibleSnapshots, isAbnormal, ghostMatchOpts, recordGhostResult, loadPool, addSnapshot, savePool } from '../src/sim/ghost.js';
import { defaultProfile, recordGhostFight } from '../src/core/profile.js';

// 1 slot = 1 weapon (F-52): two tanks are two slots.
const formation = [{ unit: 'tank_heavy', tier: 1, count: 1 }, { unit: 'tank_heavy', tier: 1, count: 1 }, { unit: 'apc', tier: 1, count: 1 }, { unit: 'drone_recon', tier: 1, count: 1 }];
const run = (g, sec) => { for (let i = 0; i < sec * 20 && !g.ended; i++) g.step(); };

function recordedMatch() {
  const g = createGame({ mode: 'skirmish', mapId: 'plains', seed: 5,
    player: { commander: 'steel', formation }, enemy: { commander: 'air', ai: true, formation: [{ unit: 'apc', tier: 1, count: 1 }] } });
  g.issue(0, { type: 'deploy', slot: 0, x: 30, z: 40 });
  g.issue(0, { type: 'deploy', slot: 1, x: 30, z: 46 });
  run(g, 0.5);
  g.issue(0, { type: 'deploy', slot: 2, x: 30, z: 75 });
  g.issue(0, { type: 'deploy', slot: 3, x: 30, z: 110 });
  run(g, 0.5);
  g.issue(0, { type: 'ready' });
  run(g, 2);
  const tanks = g.sideUnits(0).filter(u => u.group <= 1).map(u => u.id);
  g.issue(0, { type: 'order', unitIds: tanks, order: 'capture', x: 70, z: 26 });
  run(g, 3);
  const apc = g.sideUnits(0).filter(u => u.group === 2).map(u => u.id);
  g.issue(0, { type: 'order', unitIds: apc, order: 'attack', x: 120, z: 62 });
  run(g, 1);
  return g;
}

test('recorder annotates orders with formation groups', () => {
  const g = recordedMatch();
  const orders = g.commandLog.filter(e => e.side === 0 && e.cmd.type === 'order');
  assert.equal(orders.length, 2);
  assert.deepEqual(orders[0].groups.sort(), [0, 1]);
  assert.deepEqual(orders[1].groups, [2]);
});

test('snapshot replay issues the recorded commands at the same ticks, mirrored to side 1', () => {
  const src = recordedMatch();
  const snap = makeSnapshot(src, { playerName: 'Tester', rating: 1111 });
  assert.equal(snap.commander, 'steel');
  assert.equal(snap.formation.length, 4);
  assert.ok(snap.commandLog.every(e => typeof e.tick === 'number'));
  const g = createGame(ghostMatchOpts(snap, { commander: 'air', formation: [{ unit: 'apc', tier: 1, count: 1 }] }, 9));
  g.issue(0, { type: 'autodeploy' });
  run(g, 2);                       // player readies after the recorded deploy/ready ticks
  g.issue(0, { type: 'ready' });
  run(g, 7);
  const want = snap.commandLog.filter(e => e.cmd.type !== 'surrender');
  const got = g.commandLog.filter(e => e.side === 1);
  for (const w of want) {
    const m = got.find(e => e.tick === w.tick && e.cmd.type === w.cmd.type && e.cmd.slot === w.cmd.slot);
    assert.ok(m, `replayed ${w.cmd.type} at tick ${w.tick}`);
    if (typeof w.cmd.x === 'number') assert.equal(m.cmd.x, g.map.w - w.cmd.x, 'x mirrored');
    if (typeof w.cmd.z === 'number') assert.equal(m.cmd.z, w.cmd.z, 'z kept');
    if (w.cmd.type === 'order') {
      assert.ok(m.cmd.unitIds.length > 0);
      assert.ok(m.cmd.unitIds.every(id => g.units.get(id).side === 1 && w.groups.includes(g.units.get(id).group)), 'same group on side 1');
    }
  }
  assert.ok(g.ghost.replayed >= want.length);
});

test('replay deviation: missing group is skipped and adaptive fallback takes over', () => {
  const src = recordedMatch();
  const snap = makeSnapshot(src);
  const g = createGame(ghostMatchOpts(snap, { commander: 'air', formation: [{ unit: 'apc', tier: 1, count: 1 }] }, 9));
  const devs = [];
  g.events.on('ghost:deviation', e => devs.push(e));
  g.issue(0, { type: 'autodeploy' }); g.issue(0, { type: 'ready' });
  // Kill ghost groups 0-1 (tanks) right after it deploys, before its order replays.
  g.events.on('deployed', e => { if (e.side === 1 && e.slot <= 1) for (const u of e.units) u.hp = 0, g.kill(u, 0); });
  run(g, 30);
  assert.ok(devs.some(d => d.reason === 'missing'), 'deviation reported');
  assert.ok(g.ghost.skipped >= 1);
  assert.ok(g.ghost.adapted >= 1, 'adaptive orders issued');
});

test('seed pool: ~8 AI snapshots with different commanders, all replayable', () => {
  const pool = seedPool();
  assert.ok(pool.length >= 8);
  assert.ok(new Set(pool.map(s => s.commander)).size >= 5);
  for (const s of pool) {
    assert.ok(s.formation.length > 0 && s.commandLog.length > 0, s.id);
    const g = createGame(ghostMatchOpts(s, { commander: 'steel', formation: [{ unit: 'tank_heavy', tier: 1, count: 1 }] }, 2));
    g.issue(0, { type: 'autodeploy' }); g.issue(0, { type: 'ready' });
    run(g, 20);
    assert.ok(g.ghost.replayed > 0, 'replayed something for ' + s.id);
  }
});

test('anti-abuse: abnormal win rate filtered, 3 fights per day per snapshot', () => {
  const pool = seedPool();
  pool.push({ ...pool[0], id: 'cheat', fights: 20, wins: 19 });
  pool.push({ ...pool[0], id: 'young', fights: 5, wins: 5 }); // <10 fights: not judged yet
  assert.ok(isAbnormal(pool.find(s => s.id === 'cheat')));
  const p = defaultProfile();
  const d = new Date(2026, 9, 23);
  let list = eligibleSnapshots(pool, { profile: p, date: d });
  assert.ok(!list.some(s => s.id === 'cheat'));
  assert.ok(list.some(s => s.id === 'young'));
  for (let i = 0; i < 3; i++) recordGhostFight(p, 'seed1', d);
  list = eligibleSnapshots(pool, { profile: p, date: d });
  assert.ok(!list.some(s => s.id === 'seed1'), 'limit reached');
  list = eligibleSnapshots(pool, { profile: p, date: new Date(2026, 9, 24) });
  assert.ok(list.some(s => s.id === 'seed1'), 'resets next day');
  // filters
  const byCmd = eligibleSnapshots(pool, { by: 'commander', commander: 'navy' });
  assert.ok(byCmd.length > 0 && byCmd.every(s => s.commander === 'navy'));
  const byRank = eligibleSnapshots(pool, { by: 'rank', rating: 1400 });
  assert.equal(byRank[0].rating, 1400);
});

test('ghost result: fights/wins/reputation updated, pool persists through storage', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  try {
    const pool = loadPool();
    assert.ok(pool.length >= 8);
    const s0 = { ...pool.find(x => x.id === 'seed2') };
    const s = recordGhostResult(pool, 'seed2', true);
    assert.equal(s.fights, s0.fights + 1);
    assert.equal(s.wins, s0.wins + 1);
    assert.equal(s.reputation, s0.reputation + 10, 'owner gains reputation when the ghost wins');
    recordGhostResult(pool, 'seed2', false);
    assert.equal(s.reputation, s0.reputation + 10);
    const f = s.fights;
    addSnapshot(pool, makeSnapshot(recordedMatch()));
    savePool(pool);
    const again = loadPool();
    assert.equal(again.find(x => x.id === 'seed2').fights, f);
    assert.ok(again[0].own);
  } finally { delete globalThis.localStorage; }
});

// Boss campaign: phase transitions by HP, reinforcement waves, all-out phase, win on boss death (F-100, F-101, F-08).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/index.js';
import { BOSSES, BOSS_ORDER } from '../src/data/bosses.js';

function bossGame(boss) {
  const b = BOSSES[boss];
  const g = createGame({
    mode: 'boss', mapId: b.map, seed: 3, boss,
    player: { commander: 'steel', formation: [{ unit: 'tank_heavy', tier: 1, count: 2 }, { unit: 'iron_dome', tier: 1, count: 1 }] },
    enemy: { commander: b.commander, ai: false, formation: b.escort },
  });
  g.issue(0, { type: 'autodeploy' });
  g.issue(0, { type: 'ready' });
  return g;
}
const run = (g, sec) => { for (let i = 0; i < sec * 20 && !g.ended; i++) g.step(); };

for (const id of BOSS_ORDER) {
  test(`boss ${id}: spawns, battle starts, phases 1→2→3, waves, win`, () => {
    const g = bossGame(id);
    const phases = [], waves = [];
    g.events.on('boss:phase', e => phases.push(e));
    g.events.on('boss:wave', e => waves.push(e));
    run(g, 1);
    assert.equal(g.phase, 'battle', 'battle should start once the player is ready (boss side auto-ready)');
    assert.ok(g.boss && g.boss.ref.alive, 'boss exists');
    assert.equal(g.boss.phase, 1);
    // Shield in phase 1 halves damage.
    const before = g.boss.ref.hp;
    const src = { side: 0, id: -1, def: {} };
    if (g.boss.def.rise) run(g, g.boss.def.rise + 1);
    const hp0 = g.boss.ref.hp;
    g.damage(g.boss.ref, 1000, 'kinetic', src);
    assert.ok(hp0 - g.boss.ref.hp < 1000 * 0.75, 'phase-1 shield reduces damage');
    assert.ok(before > 0);
    // Phase 2 at 60% HP
    g.boss.ref.hp = g.boss.maxHp * 0.6;
    run(g, 0.2);
    assert.equal(g.boss.phase, 2);
    assert.deepEqual(phases.map(p => p.phase), [2]);
    assert.equal(phases[0].name, 'Gọi viện');
    const unitsBefore = [...g.units.values()].filter(u => u.side === 1 && u.alive).length;
    run(g, 3);
    assert.ok(waves.length >= 1, 'a reinforcement wave spawned in phase 2');
    const waveUnits = [...g.units.values()].filter(u => u.side === 1 && u.waveUnit);
    assert.ok(waveUnits.length > 0 && waveUnits.every(u => u.group >= 100));
    assert.ok([...g.units.values()].filter(u => u.side === 1 && u.alive).length >= unitsBefore);
    // Phase 3 at 20% HP: everyone attacks the player HQ
    g.boss.ref.hp = g.boss.maxHp * 0.2;
    run(g, 0.5);
    assert.equal(g.boss.phase, 3);
    assert.equal(phases.at(-1).name, 'Ép gặp');
    const hq = g.hq(0);
    const orders = g.commandLog.filter(e => e.side === 1 && e.cmd.type === 'order' && e.cmd.order === 'attack' && e.cmd.x === hq.x && e.cmd.z === hq.z);
    assert.ok(orders.length >= 1, 'all-out attack order on player HQ');
    // Kill boss -> player wins
    g.damage(g.boss.ref, 1e9, 'he', src);
    run(g, 0.2);
    assert.ok(g.ended, 'game ended');
    assert.equal(g.ended.winner, 0);
  });
}

test('carrier launches fighters periodically', () => {
  const g = bossGame('carrier');
  const launches = [];
  g.events.on('boss:launch', e => launches.push(e));
  run(g, 60);
  assert.ok(launches.length >= 1);
  assert.ok([...g.units.values()].some(u => u.launched && u.def.id === 'fighter_multi'));
});

test('strategic sub surfaces and fires a salvo', () => {
  const g = bossGame('strategic_sub');
  const ev = [];
  g.events.on('boss:surface', e => ev.push(e.surfaced));
  run(g, 32);
  assert.ok(ev.includes(true) && ev.includes(false), 'surfaced then dived: ' + ev.join(','));
});

test('aa fortress punishes player aircraft', () => {
  const g = bossGame('aa_fortress');
  run(g, 0.5);
  const heli = g.spawn(0, 'heli_attack', 30, 75, { group: 5 });
  const tank = g.spawn(0, 'tank_heavy', 30, 80, { group: 6 });
  const h0 = heli.hp; g.damage(heli, 100, 'kinetic', { side: 1, id: -1, def: {} });
  assert.ok(Math.abs((h0 - heli.hp) - 140) < 1e-6, 'air +40%');
  const t0 = tank.hp; g.damage(tank, 100, 'kinetic', { side: 1, id: -1, def: {} });
  assert.ok(Math.abs((t0 - tank.hp) - 100) < 1e-6, 'ground unaffected');
});

test('enemy HQ is protected while the boss lives (boss is the objective, F-08)', () => {
  const g = bossGame('carrier');
  run(g, 0.5);
  const hq = g.hq(1), hp = hq.hp;
  g.damage(hq, 5000, 'he', { side: 0, id: -1, def: {} });
  assert.equal(hq.hp, hp);
  g.damage(g.boss.ref, 1e9, 'he', { side: 0, id: -1, def: {} });
  g.damage(hq, 5000, 'he', { side: 0, id: -1, def: {} });
  assert.ok(hq.hp < hp, 'damage applies once the boss is dead');
});

// Victory / defeat tests (GDD §13): HQ destroyed, surrender, 1-hour limit (score, tie → soldiers), out of soldiers,
// bankrupt (covered in economy.test.mjs too), AI surrender when hopeless.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/index.js';
import { MATCH_LIMIT } from '../src/core/game.js';

function mk(ai = false) {
  const g = createGame({ mode: 'skirmish', mapId: 'plains', seed: 5,
    player: { commander: 'steel', ai: false, formation: [] },
    enemy: { commander: 'air', ai, formation: [] } });
  g.sides[1].autoShop = false;
  g.startBattle();
  return g;
}
const step = (g, n = 1) => { for (let i = 0; i < n; i++) g.step(); };

test('HQ destroyed → the other side wins', () => {
  const g = mk();
  const hq = g.hq(1);
  g.damage(hq, 1e9, 'he', { side: 0 });
  step(g);
  assert.ok(g.ended);
  assert.equal(g.ended.winner, 0);
  assert.match(g.ended.reason, /Thành chỉ huy/);
  assert.ok(g.ended.rewards[0].usdt > g.ended.rewards[1].usdt, 'winner gets the big map reward');
});

test('own HQ destroyed → defeat', () => {
  const g = mk();
  g.damage(g.hq(0), 1e9, 'he', { side: 1 });
  step(g);
  assert.equal(g.ended.winner, 1);
});

test('surrender command → defeat for that side', () => {
  const g = mk();
  g.issue(0, { type: 'surrender' });
  step(g);
  assert.equal(g.ended.winner, 1);
  assert.match(g.ended.reason, /đầu hàng/);
});

test('time limit: higher occupation score wins', () => {
  const g = mk();
  g.sides[0].score = 500; g.sides[1].score = 800;
  g.battleStart = g.time - MATCH_LIMIT;
  step(g);
  assert.equal(g.ended.winner, 1);
  assert.match(g.ended.reason, /điểm chiếm đóng/);
});

test('time limit: tie on score → more soldiers wins', () => {
  const g = mk();
  g.sides[0].score = 700; g.sides[1].score = 700;
  g.sides[1].troops.reserve -= 300;
  g.battleStart = g.time - MATCH_LIMIT;
  step(g);
  assert.equal(g.ended.winner, 0);
  assert.match(g.ended.reason, /binh lính/);
});

test('time limit: full tie → draw', () => {
  const g = mk();
  g.battleStart = g.time - MATCH_LIMIT;
  step(g);
  assert.equal(g.ended.winner, -1);
});

test('out of soldiers → defeat (infantry/crew still alive keep you in)', () => {
  const g = mk();
  g.issue(0, { type: 'buy', unit: 'tank_heavy' }); step(g);
  g.sides[0].troops.reserve = 0;
  step(g, 5);
  assert.ok(!g.ended, 'tank crew still alive');
  g.kill(g.sideUnits(0)[0], 1);
  step(g);
  assert.ok(g.ended);
  assert.equal(g.ended.winner, 1);
  assert.match(g.ended.reason, /hết binh lính/);
});

test('soldiers in training keep the side alive', () => {
  const g = mk();
  g.issue(0, { type: 'recruit', amount: 50 }); step(g);
  g.sides[0].troops.reserve = 0;
  step(g, 5);
  assert.ok(!g.ended);
});

test('AI surrenders when its army is crushed and HQ is under 50%', () => {
  const g = mk(true);
  g.sides[1].troops.reserve = 2000;
  g.issue(0, { type: 'buy', unit: 'tank_heavy', count: 4 }); step(g);
  const hq = g.hq(1); hq.hp = hq.maxHp * 0.3;
  g.battleStart = g.time - 500;
  step(g, 20 * 25);
  assert.ok(g.ended, 'match ended');
  assert.equal(g.ended.winner, 0);
  assert.match(g.ended.reason, /đầu hàng/);
});

test('no victory during deployment except HQ / surrender', () => {
  const g = createGame({ mode: 'skirmish', mapId: 'plains', seed: 5, player: { formation: [] }, enemy: { formation: [] } });
  g.sides[0].troops.reserve = 0;
  step(g, 10);
  assert.ok(!g.ended);
});

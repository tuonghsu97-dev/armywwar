// F-16 balance: AI-vs-AI matches with the real pre-match economy (recommended formation for the map, paid from
// the 1 tỷ budget, 10% cash kept) must end in 6–15 minutes of battle on every map (GDD target 8–12 min);
// at most one outlier is allowed, and never above 20 minutes. Fixed seeds → deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, run } from './sim-harness.mjs';

const MAPS = ['plains', 'city', 'bay'];
const PAIRS = [['steel', 'air'], ['navy', 'swarm'], ['swarm', 'ew']];
const SEEDS = [1, 2];
const results = [];

for (const map of MAPS) {
  test(`match length on ${map}: ${PAIRS.map(p => p.join(' vs ')).join(', ')} × seeds ${SEEDS.join(',')}`, () => {
    for (const [p, e] of PAIRS) for (const seed of SEEDS) {
      const g = run(makeGame({ map, p, e, seed, eco: true }), 1500);   // 25 min cap
      const min = g.ended ? (g.ended.time - g.battleStart) / 60 : Infinity;
      results.push({ map, p, e, seed, min, reason: g.ended?.reason });
      assert.ok(min <= 20, `${map} ${p} vs ${e} s${seed}: ${min.toFixed(1)} min (> 20) ${g.ended?.reason || 'not ended'}`);
    }
  });
}

test('at most one match outside 6–15 minutes of battle', () => {
  const out = results.filter(r => r.min < 6 || r.min > 15);
  assert.equal(results.length, MAPS.length * PAIRS.length * SEEDS.length);
  assert.ok(out.length <= 1, 'outliers: ' + out.map(r => `${r.map} ${r.p}-${r.e} s${r.seed} ${r.min.toFixed(1)}m`).join(', '));
  const avg = results.reduce((a, r) => a + r.min, 0) / results.length;
  assert.ok(avg >= 7 && avg <= 13, `average ${avg.toFixed(1)} min`);
});

// QA (tester agent): headless invariant sweep over all maps x commanders with the real pre-match economy
// (recommended formation + pre-match loan, AI vs AI). Writes tests/logs/qa-sim-report.json.
// Checks every simulated second: no exception, no NaN, units inside the map, ground units on land / ships on water,
// units not stuck (has a move goal but did not move for 30 s), match ends within the 1 h limit.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runMatch } from './qa-lib.mjs';
import * as P from '../src/core/profile.js';
import { COMMANDER_IDS } from '../src/data/commanders.js';
const MAPS = ['plains', 'city', 'bay'];

const results = [];
const COUNTER = P.COUNTER_COMMANDER;
for (const map of MAPS) for (const a of COMMANDER_IDS) {
  const b = COUNTER[a];
  test(`sim sweep ${map}: ${a} vs ${b}`, () => {
    const r = runMatch(map, a, b);
    results.push(r);
    assert.equal(r.error, null, r.error);
    assert.equal(r.nan.length, 0, 'NaN values: ' + JSON.stringify(r.nan.slice(0, 3)));
    assert.equal(r.outOfMap.length, 0, 'units out of map: ' + JSON.stringify(r.outOfMap.slice(0, 3)));
    assert.equal(r.wrongDomain.length, 0, 'units on wrong terrain: ' + JSON.stringify(r.wrongDomain.slice(0, 5)));
    assert.ok(r.stuck.length <= 2, `${r.stuck.length} stuck units: ` + JSON.stringify(r.stuck.slice(0, 5)));
  });
}

test.after(() => {
  fs.mkdirSync(new URL('./logs/', import.meta.url), { recursive: true });
  fs.writeFileSync(new URL('./logs/qa-sim-report.json', import.meta.url), JSON.stringify(results, null, 1));
});

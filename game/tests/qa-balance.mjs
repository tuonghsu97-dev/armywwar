// QA balance sweep (script, not a test): every commander pair x map x 2 seeds, AI vs AI with recommended formation + loan.
// node tests/qa-balance.mjs > tests/logs/qa-balance.log
import { runMatch } from './qa-sim.test.mjs';
import { COMMANDER_IDS } from '../src/data/commanders.js';
const W = {}; const lines = []; const reasons = {};
for (const map of ['plains', 'city', 'bay']) for (const a of COMMANDER_IDS) for (const b of COMMANDER_IDS) if (a !== b) for (const seed of [3, 4]) {
  const r = runMatch(map, a, b, 3700, seed);
  const k = (c, m) => (W[c + '@' + m] ||= { p: 0, w: 0, d: 0 });
  k(a, map).p++; k(b, map).p++;
  const w = r.ended ? r.ended.winner : -1;
  if (w === 0) k(a, map).w++; else if (w === 1) k(b, map).w++; else { k(a, map).d++; k(b, map).d++; }
  const why = r.ended ? r.ended.reason.replace(/Phe (Xanh|Đỏ)/g, 'X') : 'không kết thúc';
  reasons[why] = (reasons[why] || 0) + 1;
  lines.push(`${map} ${a} vs ${b} s${seed}: t=${r.time}s winner=${w} (${r.ended?.reason || '-'}) err=${!!r.error} dom=${r.wrongDomain.length} stuck=${r.stuck.length}`);
}
console.log(lines.join('\n'));
console.log('\nWin rate per commander@map:');
for (const [k, v] of Object.entries(W)) console.log(k.padEnd(16), `${v.w}/${v.p}`, (v.w / v.p * 100).toFixed(0) + '%', v.d ? `draw ${v.d}` : '');
console.log('\nEnd reasons:', JSON.stringify(reasons, null, 1));

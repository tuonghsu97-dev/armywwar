// Headless match runner: node tests/sim-harness.mjs [seconds] [map] [playerCmd] [enemyCmd] [eco]
// Both sides are AI-controlled so the whole sim (AI, combat, capture, economy, victory) runs without a browser.
import { createGame } from '../src/sim/index.js';
import { COMMANDERS } from '../src/data/commanders.js';
import { formatUSD } from '../src/data/units.js';
import { recommendWithLoan, recommendedFormation, playerEconomy } from '../src/core/profile.js';

// eco: true → real pre-match economy like the skirmish AI (recommended formation that fits the 1 tỷ budget, paid from it,
// no loan); 'loan' → the builder's "Đề xuất" with an automatic pre-match loan; false → raw recommended list with a
// full 1 tỷ battle purse (legacy harness).
export function makeGame({ map = 'plains', p = 'steel', e = 'air', seed = 7, playerAI = true, eco = false } = {}) {
  const side = (c, ai) => {
    if (!eco) return { commander: c, ai, formation: COMMANDERS[c].recommended.map(u => ({ unit: u, tier: 1, count: 1 })) }; // 1 slot = 1 weapon (F-52)
    const r = eco === 'loan' ? recommendWithLoan(c, { mapId: map }) : { ...recommendedFormation(c, { mapId: map, budget: 900_000_000 }), loan: 0 };
    return { commander: c, ai, formation: r.formation, ...playerEconomy(r.formation, r.loan) };
  };
  return createGame({ mode: 'skirmish', mapId: map, seed, player: side(p, playerAI), enemy: side(e, true) });
}

export function run(game, seconds) {
  const steps = Math.round(seconds * 20);
  for (let i = 0; i < steps && !game.ended; i++) game.step();
  return game;
}

export function summary(g) {
  const s = i => { const S = g.sides[i]; return `side${i} ${S.commander}: units ${g.sideUnits(i).length}, money ${formatUSD(S.money)}, troops ${S.troops.active}/${S.troops.reserve}, score ${Math.floor(S.score)}, kills ${S.stats.kills}, lost ${S.stats.lost}, hq ${Math.round(g.hq(i)?.hp ?? 0)}`; };
  return [`t=${g.time.toFixed(0)}s phase=${g.phase} ended=${JSON.stringify(g.ended)}`, s(0), s(1),
    `strongpoints: ${g.strongpoints.map(sp => sp.owner).join(',')}`].join('\n');
}

if (process.argv[1] && /sim-harness\.mjs$/.test(process.argv[1])) {
  const [sec = 180, map = 'plains', p = 'steel', e = 'air', eco = ''] = process.argv.slice(2);
  const t0 = Date.now();
  const g = run(makeGame({ map, p, e, eco: eco === 'eco' ? true : eco === 'loan' ? 'loan' : false }), Number(sec));
  console.log(summary(g));
  console.log(`(${((Date.now() - t0) / 1000).toFixed(1)}s real time)`);
}

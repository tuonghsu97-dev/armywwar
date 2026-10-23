// QA helper (tester agent): run one AI-vs-AI match with the real pre-match economy and collect invariant issues.
import { createGame } from '../src/sim/index.js';
import { passable, domainOf } from '../src/sim/path.js';
import * as P from '../src/core/profile.js';
const MAPS = ['plains', 'city', 'bay'];
const SECONDS = Number(process.env.QA_SECONDS || 1800);

function sideCfg(commander, ai = true, mapId = null) {
  const r = P.recommendWithLoan(commander, mapId ? { mapId } : {}); // fix agent: map-aware "Đề xuất" (no ships on plains)
  return { commander, ai, formation: r.formation, ...P.playerEconomy(r.formation, r.loan), _loan: r.loan };
}

export function runMatch(map, a, b, seconds = SECONDS, seed = 11) {
  const pa = sideCfg(a, true, map), pb = sideCfg(b, true, map);
  const g = createGame({ mode: 'skirmish', mapId: map, seed, player: pa, enemy: pb });
  const issues = { error: null, nan: [], outOfMap: [], wrongDomain: [], stuck: [] };
  const last = new Map(); // id -> {x,z,t}
  const seen = new Set();
  const steps = seconds * 20;
  try {
    for (let i = 0; i < steps && !g.ended; i++) {
      g.step();
      if (i % 20) continue;
      for (const u of g.units.values()) {
        if (!u.alive) continue;
        const key = (k, extra = '') => `${k}:${u.def.id}#${u.id}${extra}`;
        if (![u.x, u.z, u.hp, u.alt].every(Number.isFinite)) { if (!seen.has(key('nan'))) { seen.add(key('nan')); issues.nan.push({ t: g.time, unit: u.def.id, id: u.id, x: u.x, z: u.z, hp: u.hp }); } continue; }
        if (u.x < 0 || u.z < 0 || u.x > g.map.w || u.z > g.map.h) { if (!seen.has(key('oom'))) { seen.add(key('oom')); issues.outOfMap.push({ t: g.time, unit: u.def.id, x: u.x, z: u.z }); } }
        const dom = domainOf(u);
        if (!u.carriedBy && dom !== 'air' && !passable(g.map, dom, u.x, u.z)) {
          if (!seen.has(key('dom'))) { seen.add(key('dom')); issues.wrongDomain.push({ t: Math.round(g.time), unit: u.def.id, side: u.side, layer: u.layer, x: +u.x.toFixed(1), z: +u.z.toFixed(1), intent: u.intent }); }
        }
        const wants = (u.path && u.path.length) || u.moveTarget;
        const l = last.get(u.id);
        // Stuck = wanted to move at every 1 s sample for 30 s without covering 1 unit of distance.
        if (!l || !wants || Math.hypot(l.x - u.x, l.z - u.z) > 1) last.set(u.id, { x: u.x, z: u.z, t: g.time });
        else if (wants && !u.carriedBy && u.speed > 0 && g.time - l.t > 30 && !seen.has(key('stuck'))) {
          seen.add(key('stuck'));
          issues.stuck.push({ t: Math.round(g.time), unit: u.def.id, side: u.side, x: +u.x.toFixed(1), z: +u.z.toFixed(1), intent: u.intent, order: u.order?.type });
        }
      }
      for (const S of g.sides) if (!Number.isFinite(S.money) || !Number.isFinite(S.score)) issues.nan.push({ t: g.time, side: S.id, money: S.money, score: S.score });
    }
  } catch (e) { issues.error = String(e && e.stack || e); }
  return {
    map, a, b, loans: [pa._loan, pb._loan], time: Math.round(g.time), battle: Math.round(g.battleTime || 0), ended: g.ended ? { winner: g.ended.winner, reason: g.ended.reason } : null,
    score: g.sides.map(s => Math.floor(s.score)), kills: g.sides.map(s => s.stats.kills), units: [g.sideUnits(0).length, g.sideUnits(1).length],
    ...issues,
  };
}


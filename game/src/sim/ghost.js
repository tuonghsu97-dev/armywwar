// OWNER: agent Meta & chế độ chơi
// Ghost battles / async PvP (GDD §8, F-102..F-107).
//  - Recorder (every mode, order 1): annotates new game.commandLog entries with the formation groups of
//    their unitIds (unit ids differ between matches, groups do not) + target info, and counts captures.
//  - Snapshot = { id, playerName, commander, formation, mapId, commandLog (side 0, tick-stamped), duration,
//    rating, fights, wins, reputation }. Saved locally on a win; pool is pre-seeded with AI-made data.
//  - Replay (mode 'ghost', order 96): side 1 re-issues the stored commands at their recorded ticks, mirrored
//    (x -> map.w - x). When the situation deviates (group dead, target gone, idle group) it falls back to an
//    adaptive enemyAI-style behaviour (F-105).
//  - Anti-abuse (F-107): hide snapshots with >90% win rate over >=10 fights, max 3 fights/day per snapshot.
import { buildMap } from '../data/maps.js';
import { UNITS } from '../data/units.js';
import { readJSON, writeJSON, recommendedFormation, recommendWithLoan, ghostFightsToday, GHOST_DAILY_LIMIT, playerEconomy } from '../core/profile.js';

const POOL_KEY = 'wargrid.ghostPool.v1';
const POOL_MAX = 40;

// ---------------------------------------------------------------- recorder
export const recorderSystem = {
  name: 'ghostRecorder',
  update(game) {
    const log = game.commandLog;
    for (let i = game._recIdx || 0; i < log.length; i++) annotate(game, log[i]);
    game._recIdx = log.length;
  },
};

function annotate(game, e) {
  const c = e.cmd;
  if (Array.isArray(c.unitIds) && !e.groups) {
    const gs = new Set();
    for (const id of c.unitIds) { const u = game.units.get(id); if (u && u.group >= 0) gs.add(u.group); }
    e.groups = [...gs];
  }
  if (c.targetId != null && !e.target) {
    const u = game.units.get(c.targetId);
    if (u) e.target = { kind: 'unit', unit: u.def.id, x: u.x, z: u.z };
    else { const s = game.structures.find(s => s.id === c.targetId); if (s) e.target = { kind: 'structure', type: s.type, x: s.x, z: s.z }; }
  }
}

// ---------------------------------------------------------------- replay
export const ghostSystem = {
  name: 'ghost',
  update(game, dt) {
    const G = game.ghost;
    if (!G) return;
    const list = G.log;
    while (G.idx < list.length && list[G.idx].tick <= game.tick) { const e = list[G.idx++]; if (!G.done.has(e)) replayEntry(game, e); }
    if (game.phase === 'battle' && !G.autoDeployed) {
      G.autoDeployed = true;
      // Battle began before the recorded deploy times (player was faster): place remaining slots now at
      // their recorded (mirrored) positions, then auto-deploy whatever is still missing.
      for (let i = G.idx; i < list.length; i++) if (list[i].cmd.type === 'deploy') { G.done.add(list[i]); replayEntry(game, list[i]); }
      if (game.sides[1].formation.some(s => !s.deployed)) game.issue(1, { type: 'autodeploy' });
    }
    if (game.phase === 'battle' && game.tick % 100 === 0) adapt(game, G);
  },
};

export function mirrorX(game, x) { return game.map.w - x; }

// Build the side-1 command for a recorded side-0 entry; null + reason if impossible now.
export function mirrorCommand(game, e) {
  const c = JSON.parse(JSON.stringify(e.cmd));
  for (const k of ['x', 'x0', 'x1', 'tx']) if (typeof c[k] === 'number') c[k] = mirrorX(game, c[k]);
  if (c.type === 'deploy' && game.phase !== 'deploy') c.reinforce = true;
  if (Array.isArray(c.unitIds)) {
    const groups = e.groups || [];
    const ids = [];
    for (const u of game.units.values()) if (u.alive && u.side === 1 && !u.carriedBy && groups.includes(u.group)) ids.push(u.id);
    if (!ids.length) return { cmd: null, reason: 'missing' };
    c.unitIds = ids;
  }
  if (c.targetId != null) {
    const t = resolveTarget(game, e, c);
    if (t) c.targetId = t.id;
    else { c.targetId = null; if (c.order === 'focus') c.order = 'attack'; return { cmd: c, reason: 'target' }; }
  }
  return { cmd: c, reason: null };
}

function resolveTarget(game, e, c) {
  const t = e.target;
  const x = c.x ?? (t ? mirrorX(game, t.x) : 0), z = c.z ?? (t ? t.z : 0);
  if (t && t.kind === 'structure') {
    let best = null, bd = Infinity;
    for (const s of game.structures) if (s.alive && s.side === 0 && s.type === t.type) { const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = s; } }
    return best;
  }
  let best = null, bd = Infinity;
  for (const u of game.units.values()) {
    if (!u.alive || u.side !== 0 || !u.visible[1]) continue;
    const d = Math.hypot(u.x - x, u.z - z) - (t && u.def.id === t.unit ? 8 : 0);
    if (d < bd && d < 20) { bd = d; best = u; }
  }
  return best;
}

function replayEntry(game, e) {
  const G = game.ghost;
  if (e.cmd.type === 'surrender') return;
  const { cmd, reason } = mirrorCommand(game, e);
  if (reason) { G.deviations++; game.events.emit('ghost:deviation', { reason, tick: game.tick, cmd: e.cmd.type }); }
  if (!cmd) { G.skipped++; return; }
  game.issue(1, cmd);
  G.replayed++;
  if (e.groups) for (const g of e.groups) G.lastCmd[g] = game.time;
}

// Adaptive fallback (F-105): groups that are idle, lost their target, or got no stored command for a while.
function adapt(game, G) {
  const groups = new Map();
  for (const u of game.units.values()) if (u.alive && u.side === 1 && !u.carriedBy && u.group >= 0) { if (!groups.has(u.group)) groups.set(u.group, []); groups.get(u.group).push(u); }
  const hq = game.hq(0);
  for (const [g, us] of groups) {
    const idle = us.every(u => !u.order || u.order.type === 'idle');
    const lostTarget = us.some(u => u.order?.type === 'focus' && !(u.forcedTarget && u.forcedTarget.alive));
    const stale = game.time - (G.lastCmd[g] ?? -999) > 45;
    if (!idle && !lostTarget && !stale) continue;
    const c = us[0];
    const near = game.unitsNear(c.x, c.z, 30, o => o.side === 0 && o.visible[1]);
    let order = 'attack', x, z;
    if (near.length) { x = near[0].x; z = near[0].z; }
    else {
      let tgt = null, bd = Infinity;
      for (const sp of game.strongpoints) if (sp.owner !== 1) { const d = Math.hypot(sp.x - c.x, sp.z - c.z); if (d < bd) { bd = d; tgt = sp; } }
      if (tgt && game.rng.chance(0.7)) { x = tgt.x; z = tgt.z; if (c.canCapture) order = 'capture'; }
      else if (hq) { x = hq.x; z = hq.z; }
      else continue;
    }
    game.issue(1, { type: 'order', unitIds: us.map(u => u.id), order, x, z });
    G.lastCmd[g] = game.time;
    G.adapted++;
  }
}

export function install(game) {
  game.metaStats = { captures: [0, 0] };
  game.events.on('capture', e => { if (e && (e.side === 0 || e.side === 1)) game.metaStats.captures[e.side]++; });
  game.addSystem(recorderSystem, 1);
  if (game.mode === 'ghost' && game.opts.ghost) {
    const snap = game.opts.ghost;
    game.ghost = {
      snap, log: (snap.commandLog || []).slice().sort((a, b) => a.tick - b.tick), idx: 0,
      replayed: 0, skipped: 0, deviations: 0, adapted: 0, lastCmd: {}, autoDeployed: false, done: new Set(),
    };
    // The ghost side is not waiting for a human: the player's "Sẵn sàng" starts the battle.
    game.sides[1].ready = true;
    game.sides[1].ghost = true;
    // Entries stamped tick 0 must enter the queue before the first step to be applied at tick 0.
    const G = game.ghost;
    while (G.idx < G.log.length && G.log[G.idx].tick <= 0) replayEntry(game, G.log[G.idx++]);
    game.addSystem(ghostSystem, 96);
  }
}

// ---------------------------------------------------------------- snapshots & pool
export function makeSnapshot(game, { playerName = 'Chỉ huy', rating = 1000, side = 0 } = {}) {
  const S = game.sides[side];
  return {
    id: 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    playerName, own: true, ai: false,
    commander: S.commander, mapId: game.map.id,
    formation: S.formation.map(s => ({ unit: s.unit, tier: s.tier || 1, count: s.count || 1 })),
    loan: ((side === 0 ? game.opts.player : game.opts.enemy)?.loans || []).reduce((a, l) => a + (l.principal || 0), 0),
    commandLog: game.commandLog.filter(e => e.side === side && e.cmd.type !== 'surrender')
      .map(e => ({ tick: e.tick, cmd: e.cmd, groups: e.groups, target: e.target })),
    duration: Math.round(game.time), rating: Math.round(rating),
    fights: 0, wins: 0, reputation: 0, created: Date.now(),
  };
}

const SEEDS = [
  { name: 'AI·Thép Bão', commander: 'steel', map: 'plains', strat: 'capture', rating: 1050 },
  { name: 'AI·Ưng Đen', commander: 'air', map: 'plains', strat: 'sead', rating: 1200 },
  { name: 'AI·Hải Long', commander: 'navy', map: 'bay', strat: 'capture', rating: 1150 },
  { name: 'AI·Bầy Ong 7', commander: 'swarm', map: 'city', strat: 'rush', rating: 1100 },
  { name: 'AI·Bóng Ma EW', commander: 'ew', map: 'city', strat: 'flank', rating: 1250 },
  { name: 'AI·Thiết Giáp X', commander: 'steel', map: 'city', strat: 'rush', rating: 950 },
  { name: 'AI·Phi Đội 9', commander: 'air', map: 'bay', strat: 'flank', rating: 1350 },
  { name: 'AI·Đô Đốc K', commander: 'navy', map: 'bay', strat: 'turtle', rating: 1400 },
];

// AI-made seed data so the pool is never empty (GDD §10 risk note). Deterministic.
export function seedPool() {
  return SEEDS.map((s, k) => {
    const map = buildMap(s.map);
    const { formation, loan } = recommendWithLoan(s.commander);
    const log = [];
    const lanesZ = [32, 75, 118];
    formation.forEach((slot, i) => {
      const naval = ['navy', 'sub'].includes(unitGroup(slot.unit));
      const x = naval ? 32 : 38, z = naval ? 75 : lanesZ[i % 3] + Math.floor(i / 3) * 6 - 6;
      log.push({ tick: 20 + i * 8, cmd: { type: 'deploy', slot: i, x, z, reinforce: false } });
    });
    const T0 = 240;
    log.push({ tick: T0, cmd: { type: 'ready' } });
    const sps = map.strongpoints.slice().sort((a, b) => a.x - b.x);
    const own = sps.filter(p => p.x < 110), mid = sps.filter(p => p.x >= 110 && p.x <= 130), far = sps.filter(p => p.x > 130);
    const hq = { x: 226, z: 75 };
    const all = formation.map((_, i) => i);
    const order = (t, groups, ord, p) => log.push({ tick: T0 + Math.round(t * 20), cmd: { type: 'order', unitIds: [], order: ord, x: p.x, z: p.z }, groups });
    const laneOf = (list, i) => list.length ? list[i % list.length] : hq;
    const air = all.filter(i => ['air', 'drone'].includes(unitGroup(formation[i].unit)));
    const ground = all.filter(i => !air.includes(i));
    if (s.strat === 'capture') {
      all.forEach(i => order(3, [i], 'capture', laneOf(own, i)));
      all.forEach(i => order(60, [i], 'capture', laneOf(mid.length ? mid : own, i)));
      all.forEach(i => order(150, [i], 'attack', laneOf(far, i)));
      order(240, all, 'attack', hq);
    } else if (s.strat === 'rush') {
      order(3, all, 'attack', { x: 120, z: 75 });
      order(60, all, 'attack', hq);
      order(140, all, 'attack', hq);
    } else if (s.strat === 'flank') {
      const half = Math.ceil(all.length / 2);
      order(3, all.slice(0, half), 'flank', { x: 175, z: 26 });
      order(3, all.slice(half), 'suppress', { x: 100, z: 75 });
      order(90, all, 'attack', hq);
    } else if (s.strat === 'turtle') {
      order(3, all, 'defend', laneOf(own, 1));
      order(200, all, 'attack', laneOf(far, 0));
      order(300, all, 'attack', hq);
    } else if (s.strat === 'sead') {
      if (air.length) order(3, air, 'sead', { x: 190, z: 75 });
      ground.forEach(i => order(3, [i], 'capture', laneOf(own, i)));
      order(120, all, 'attack', hq);
    }
    log.sort((a, b) => a.tick - b.tick);
    const fights = 4 + (k * 3) % 7, wins = Math.round(fights * (0.35 + (k % 4) * 0.1));
    return {
      id: 'seed' + (k + 1), playerName: s.name, own: false, ai: true, strategy: s.strat,
      commander: s.commander, mapId: s.map, formation, loan, commandLog: log,
      duration: 420 + k * 37, rating: s.rating, fights, wins, reputation: wins * 5, created: 0,
    };
  });
}
function unitGroup(id) { return UNITS[id]?.group; }

export function loadPool() {
  let pool = readJSON(POOL_KEY, null);
  if (!Array.isArray(pool) || !pool.length) { pool = seedPool(); savePool(pool); }
  return pool;
}
export function savePool(pool) { writeJSON(POOL_KEY, pool.slice(0, POOL_MAX + SEEDS.length)); return pool; }
export function addSnapshot(pool, snap) {
  pool.unshift(snap);
  const own = pool.filter(s => !s.ai);
  if (own.length > POOL_MAX) { const drop = own[own.length - 1]; pool.splice(pool.indexOf(drop), 1); }
  return pool;
}

export function isAbnormal(s) { return (s.fights || 0) >= 10 && (s.wins || 0) / s.fights > 0.9; }

// Anti-abuse + filters. by: 'rank' (closest rating first) | 'commander' | 'random'.
export function eligibleSnapshots(pool, { profile = null, date = new Date(), by = 'rank', commander = null, rating = 1000, seed = 1 } = {}) {
  let list = pool.filter(s => !isAbnormal(s));
  if (profile) list = list.filter(s => ghostFightsToday(profile, s.id, date) < GHOST_DAILY_LIMIT);
  if (by === 'commander' && commander) list = list.filter(s => s.commander === commander);
  if (by === 'rank') list = list.slice().sort((a, b) => Math.abs(a.rating - rating) - Math.abs(b.rating - rating));
  if (by === 'random') { let r = seed >>> 0 || 1; list = list.map(s => [s, (r = (r * 1103515245 + 12345) >>> 0)]).sort((a, b) => a[1] - b[1]).map(e => e[0]); }
  return list;
}
export function filteredOutCount(pool, opts) {
  return pool.filter(s => isAbnormal(s)).length + (opts?.profile ? pool.filter(s => !isAbnormal(s) && ghostFightsToday(opts.profile, s.id, opts.date) >= GHOST_DAILY_LIMIT).length : 0);
}

// Match options for a ghost fight against snapshot `snap`.
export function ghostMatchOpts(snap, player, seed = Date.now() % 100000) {
  return {
    mode: 'ghost', mapId: snap.mapId || 'plains', seed, ghost: snap,
    player,
    enemy: { commander: snap.commander, ai: false, name: snap.playerName, formation: snap.formation.map(s => ({ ...s })), ...playerEconomy(snap.formation, snap.loan || 0) },
  };
}

// After a ghost fight: snapshot stats + owner reputation (F-106).
export function recordGhostResult(pool, id, ghostWon) {
  const s = pool.find(p => p.id === id);
  if (!s) return null;
  s.fights = (s.fights || 0) + 1;
  if (ghostWon) { s.wins = (s.wins || 0) + 1; s.reputation = (s.reputation || 0) + 10; }
  return s;
}

// OWNER: agent AI chiến thuật
// Influence map of danger (GDD §5 "Influence Map"): per side, enemy DPS per coarse cell, refreshed ~1 Hz.
// Two layers per side: danger to surface units (ground/sea/sub) and danger to aircraft (air/low).
// Used for path choice (flank via the quieter side), retreat routes and target utility.
import { nearestPassable, domainOf } from './path.js';

export const INF_CELL = 8;

export function ensureInfluence(game) {
  if (game.influence) return game.influence;
  const cols = Math.ceil(game.map.w / INF_CELL), rows = Math.ceil(game.map.h / INF_CELL);
  const mk = () => new Float32Array(cols * rows);
  game.influence = { cols, rows, t: -99, surface: [mk(), mk()], air: [mk(), mk()], presence: [mk(), mk()] };
  return game.influence;
}

function stamp(inf, arr, x, z, r, v) {
  const { cols, rows } = inf;
  const c0 = Math.max(0, Math.floor((x - r) / INF_CELL)), c1 = Math.min(cols - 1, Math.floor((x + r) / INF_CELL));
  const r0 = Math.max(0, Math.floor((z - r) / INF_CELL)), r1 = Math.min(rows - 1, Math.floor((z + r) / INF_CELL));
  const rr = r * r;
  for (let j = r0; j <= r1; j++) {
    const cz = j * INF_CELL + INF_CELL / 2;
    for (let i = c0; i <= c1; i++) {
      const cx = i * INF_CELL + INF_CELL / 2;
      const d2 = (cx - x) ** 2 + (cz - z) ** 2;
      if (d2 <= rr) arr[j * cols + i] += v * (1 - 0.5 * d2 / rr);
    }
  }
}

// Rebuild. danger[side] = threat posed TO `side` by the other side.
export function updateInfluence(game, force = false) {
  const inf = ensureInfluence(game);
  if (!force && game.time - inf.t < 1) return inf;
  inf.t = game.time;
  for (let s = 0; s < 2; s++) { inf.surface[s].fill(0); inf.air[s].fill(0); inf.presence[s].fill(0); }
  for (const u of game.units.values()) {
    if (!u.alive || u.carriedBy) continue;
    const victim = 1 - u.side;
    stamp(inf, inf.presence[u.side], u.x, u.z, 6, u.maxHp > 0 ? 1 + u.def.price / 1e8 : 1);
    if (!u.def.rof && !u.def.kamikaze) continue;
    if (!u.deployed) continue;
    const dps = u.def.kamikaze ? u.dmg * 0.5 * Math.max(1, (u.swarm || 1) / 4) : u.dmg * u.def.rof;
    const r = Math.max(4, u.range) + 4;
    const hits = u.def.hits || [];
    if (hits.includes('ground') || hits.includes('sea') || hits.includes('sub')) stamp(inf, inf.surface[victim], u.x, u.z, u.def.kamikaze ? 18 : r, dps);
    if (hits.includes('air') || hits.includes('low')) stamp(inf, inf.air[victim], u.x, u.z, r, dps);
  }
  for (const s of game.structures) {
    if (!s.alive) continue;
    const arm = s.armed || (s.type === 'hq' ? { dmg: 60, range: 24, rof: 0.6, hits: ['ground', 'low', 'air', 'sea'] } : null);
    if (!arm) continue;
    const victim = 1 - s.side, dps = arm.dmg * arm.rof, r = arm.range + 3;
    stamp(inf, inf.surface[victim], s.x, s.z, r, dps);
    if (arm.hits.includes('air') || arm.hits.includes('low')) stamp(inf, inf.air[victim], s.x, s.z, r, dps);
  }
  return inf;
}

export function dangerAt(game, side, x, z, air = false) {
  const inf = ensureInfluence(game);
  const i = Math.floor(x / INF_CELL), j = Math.floor(z / INF_CELL);
  if (i < 0 || j < 0 || i >= inf.cols || j >= inf.rows) return 0;
  return (air ? inf.air : inf.surface)[side][j * inf.cols + i];
}
export function dangerFor(game, u) { return dangerAt(game, u.side, u.x, u.z, u.isAir); }

// Summed danger sampled along a polyline (every ~INF_CELL).
export function routeDanger(game, side, pts, air = false) {
  let sum = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1], d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(d / INF_CELL));
    for (let s = 1; s <= n; s++) sum += dangerAt(game, side, a.x + (b.x - a.x) * s / n, a.z + (b.z - a.z) * s / n, air);
  }
  return sum;
}

// Flank waypoint: lateral detours (incl. side lanes) around the danger between start and target.
// Returns {x,z} to pass through before striking, approaching the target from its side/back.
export function flankWaypoint(game, u, sx, sz, tx, tz) {
  const dx = tx - sx, dz = tz - sz, d = Math.hypot(dx, dz) || 1;
  const nx = -dz / d, nz = dx / d;
  const domain = domainOf(u);
  const cands = [];
  for (const k of [0.35, 0.55]) for (const sgn of [-1, 1]) {
    const off = Math.min(48, Math.max(16, d * k));
    cands.push({ x: sx + dx * 0.7 + nx * off * sgn, z: sz + dz * 0.7 + nz * off * sgn });
  }
  // Side lanes of the map (GDD §7: 3 lanes) as natural flanking routes.
  for (const lz of [26, 75, 124]) if (Math.abs(lz - tz) > 20 && Math.abs(lz - tz) < 60) cands.push({ x: sx + dx * 0.75, z: lz });
  let best = null, bestC = Infinity;
  for (const c0 of cands) {
    c0.x = Math.max(4, Math.min(game.map.w - 4, c0.x)); c0.z = Math.max(4, Math.min(game.map.h - 4, c0.z));
    const c = domain === 'air' ? c0 : nearestPassable(game.map, domain, c0.x, c0.z, 14);
    if (!c) continue;
    const len = Math.hypot(c.x - sx, c.z - sz) + Math.hypot(tx - c.x, tz - c.z);
    const cost = routeDanger(game, u.side, [{ x: sx, z: sz }, c, { x: tx, z: tz }], u.isAir) * 1.0 + len * 0.6;
    if (cost < bestC) { bestC = cost; best = { x: c.x, z: c.z }; }
  }
  return best;
}

// Path choice for ordinary moves: direct vs a mild detour, whichever is much safer.
export function saferWaypoint(game, u, tx, tz) {
  const direct = routeDanger(game, u.side, [{ x: u.x, z: u.z }, { x: tx, z: tz }], u.isAir);
  if (direct < 40) return null;
  const via = flankWaypoint(game, u, u.x, u.z, tx, tz);
  if (!via) return null;
  const vd = routeDanger(game, u.side, [{ x: u.x, z: u.z }, via, { x: tx, z: tz }], u.isAir);
  return vd < direct * 0.6 ? via : null;
}

// Retreat route: home point, but go through the least dangerous of a few intermediate points.
export function retreatWaypoint(game, u, hx, hz) {
  const here = dangerFor(game, u);
  if (here < 10) return null;
  return saferWaypoint(game, u, hx, hz);
}

// Grid A* pathfinding per movement domain (GDD §10: NavMesh for ground/sea units — here a cell grid).
// Domains: 'ground' (land, roads, bridges, hills, forest), 'sea' (deep + shallow), 'sub' (deep only), 'air' (free).
import { T, CELL } from '../data/maps.js';

const COST = {
  ground: { [T.LAND]: 1, [T.ROAD]: 0.7, [T.BRIDGE]: 0.7, [T.HILL]: 1.8, [T.FOREST]: 1.5 },
  sea: { [T.DEEP]: 1, [T.SHALLOW]: 1.3, [T.BRIDGE]: 1.2 },
  sub: { [T.DEEP]: 1, [T.BRIDGE]: 1.2 },
};

export function domainOf(unit) {
  if (unit.layer === 'air' || unit.layer === 'low') return 'air';
  if (unit.layer === 'sub') return 'sub';
  if (unit.layer === 'sea') return 'sea';
  return 'ground';
}

export function passable(map, domain, x, z) {
  if (domain === 'air') return x >= 0 && z >= 0 && x <= map.w && z <= map.h;
  const c = Math.floor(x / CELL), r = Math.floor(z / CELL);
  if (c < 0 || r < 0 || c >= map.cols || r >= map.rows) return false;
  return COST[domain][map.grid[r * map.cols + c]] !== undefined;
}

export function speedFactor(map, domain, x, z) {
  if (domain === 'air') return 1;
  const c = Math.floor(x / CELL), r = Math.floor(z / CELL);
  const k = COST[domain][map.grid[r * map.cols + c]];
  return k ? 1 / Math.max(0.7, k) : 0.3;
}

class Heap {
  constructor() { this.a = []; }
  push(n, f) { const a = this.a; a.push([f, n]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top[1];
  }
  get size() { return this.a.length; }
}

// Nearest passable cell (spiral search) — lets players click on a building / water and still get a sensible path.
export function nearestPassable(map, domain, x, z, maxR = 20) {
  if (passable(map, domain, x, z)) return { x, z };
  for (let r = CELL; r <= maxR; r += CELL)
    for (let a = 0; a < 16; a++) {
      const px = x + Math.cos(a / 16 * Math.PI * 2) * r, pz = z + Math.sin(a / 16 * Math.PI * 2) * r;
      if (passable(map, domain, px, pz)) return { x: px, z: pz };
    }
  return null;
}

let BUF = null;
export function findPath(map, domain, sx, sz, tx, tz, maxNodes = 12000) {
  if (domain === 'air') return [{ x: tx, z: tz }];
  const goal = nearestPassable(map, domain, tx, tz);
  const start = nearestPassable(map, domain, sx, sz, 8);
  if (!goal || !start) return null;
  const cols = map.cols, rows = map.rows, cost = COST[domain];
  const sc = Math.floor(start.x / CELL), sr = Math.floor(start.z / CELL);
  const gc = Math.floor(goal.x / CELL), gr = Math.floor(goal.z / CELL);
  const si = sr * cols + sc, gi = gr * cols + gc;
  const comp = components(map, domain);
  if (comp[si] !== comp[gi]) return null; // no route at all (island / other sea): fail fast (sim/ai)
  if (si === gi) return [{ x: goal.x, z: goal.z }];
  // Reused search buffers (no per-call allocation / GC).
  if (!BUF || BUF.n !== cols * rows) BUF = { n: cols * rows, g: new Float32Array(cols * rows), from: new Int32Array(cols * rows), closed: new Uint8Array(cols * rows) };
  const g = BUF.g.fill(Infinity), from = BUF.from.fill(-1), closed = BUF.closed.fill(0);
  const h = (i) => { const c = i % cols, r = (i / cols) | 0; const dx = Math.abs(c - gc), dz = Math.abs(r - gr); return (dx + dz + (1.414 - 2) * Math.min(dx, dz)) * 0.95; }; // 0.95 (was 0.7 = road cost): far fewer expansions, near-optimal paths
  const heap = new Heap();
  g[si] = 0; heap.push(si, h(si));
  let n = 0, found = false;
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  while (heap.size && n++ < maxNodes) {
    const cur = heap.pop();
    if (cur === gi) { found = true; break; }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cc = cur % cols, cr = (cur / cols) | 0;
    for (const [dc, dr, dl] of DIRS) {
      const nc = cc + dc, nr = cr + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = nr * cols + nc;
      const k = cost[map.grid[ni]];
      if (k === undefined || closed[ni]) continue;
      if (dl > 1 && (cost[map.grid[cr * cols + nc]] === undefined || cost[map.grid[nr * cols + cc]] === undefined)) continue; // no corner cutting
      const ng = g[cur] + dl * k;
      if (ng < g[ni]) { g[ni] = ng; from[ni] = cur; heap.push(ni, ng + h(ni)); }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let i = gi; i !== -1 && i !== si; i = from[i]) cells.push(i);
  cells.reverse();
  // Line-of-sight smoothing to drop zig-zag waypoints.
  const pts = cells.map(i => ({ x: (i % cols) * CELL + CELL / 2, z: ((i / cols) | 0) * CELL + CELL / 2 }));
  pts[pts.length - 1] = { x: goal.x, z: goal.z };
  return smooth(map, domain, { x: sx, z: sz }, pts);
}

function smooth(map, domain, start, pts) {
  const out = [];
  let anchor = start, i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !clearLine(map, domain, anchor, pts[j])) j--;
    out.push(pts[j]);
    anchor = pts[j];
    i = j + 1;
  }
  return out;
}

export function clearLine(map, domain, a, b) {
  const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(d / (CELL * 0.5));
  for (let k = 1; k < n; k++) if (!passable(map, domain, a.x + (b.x - a.x) * k / n, a.z + (b.z - a.z) * k / n)) return false;
  return true;
}

// Connected-component label per cell and domain (4-connectivity == A* moves without corner cutting).
// Lets findPath reject unreachable goals instantly. Computed lazily once per map/domain.
export function components(map, domain) {
  const cache = map._comp || (map._comp = {});
  if (cache[domain]) return cache[domain];
  const { cols, rows, grid } = map, cost = COST[domain];
  const lab = new Int32Array(cols * rows).fill(-1);
  const stack = [];
  let n = 0;
  for (let i = 0; i < lab.length; i++) {
    if (lab[i] !== -1 || cost[grid[i]] === undefined) continue;
    lab[i] = n; stack.push(i);
    while (stack.length) {
      const c = stack.pop(), cc = c % cols, cr = (c / cols) | 0;
      if (cc > 0) visit(c - 1); if (cc < cols - 1) visit(c + 1);
      if (cr > 0) visit(c - cols); if (cr < rows - 1) visit(c + cols);
    }
    n++;
  }
  function visit(j) { if (lab[j] === -1 && cost[grid[j]] !== undefined) { lab[j] = n; stack.push(j); } }
  return (cache[domain] = lab);
}
export function sameComponent(map, domain, ax, az, bx, bz) {
  if (domain === 'air') return true;
  const a = nearestPassable(map, domain, ax, az, 8), b = nearestPassable(map, domain, bx, bz);
  if (!a || !b) return false;
  const comp = components(map, domain), cols = map.cols;
  return comp[Math.floor(a.z / CELL) * cols + Math.floor(a.x / CELL)] === comp[Math.floor(b.z / CELL) * cols + Math.floor(b.x / CELL)];
}

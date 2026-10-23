// 3 maps (GDD §7): Thành phố, Đồng bằng, Vịnh biển. Each: 3 lanes + middle zone + 2 bases.
// Maps are generated on a cell grid from a seed so they are identical every match (deterministic replay, GDD §10).
import { RNG } from '../core/rng.js';

export const CELL = 2;          // world units per cell
export const MAP_W = 240, MAP_H = 150;
export const COLS = MAP_W / CELL, ROWS = MAP_H / CELL;

export const T = { LAND: 0, DEEP: 1, SHALLOW: 2, BUILDING: 3, HILL: 4, ROAD: 5, FOREST: 6, BRIDGE: 7 };

export const MAPS = {
  plains: {
    name: 'Đồng bằng', terrain: 'Rộng, ít che chắn, có đồi/sông nhỏ', tactic: 'Thế trận lớn, áp chế địa/không',
    favored: 'Tank, pháo tự hành, máy bay', limited: 'Du kích không đủ đường ẩn', seed: 101, weather: 'clear',
    favoredGroups: ['tank', 'air'], limitedGroups: [],
  },
  city: {
    name: 'Thành phố', terrain: 'Nhà cao, phố hẹp, cầu, ngầm', tactic: 'Du kích, đánh đô thị, che tầm nhìn, rào cản',
    favored: 'UGV, drone FPV, trực thăng, EW', limited: 'Tank nặng, hải quân, tên lửa tầm xa (bị nhà che)', seed: 202, weather: 'rain',
    favoredGroups: ['drone', 'ew'], limitedGroups: ['navy', 'tank'],
  },
  bay: {
    name: 'Vịnh biển', terrain: 'Đảo, eo biển, vùng cạn/sâu', tactic: 'Kiểm soát eo biển, SAM và tàu ngầm',
    favored: 'Tàu chiến, tàu ngầm, máy bay, UUV', limited: 'Tank (chỉ trên đảo), bộ binh', seed: 303, weather: 'fog',
    favoredGroups: ['navy', 'sub', 'air'], limitedGroups: ['tank', 'infantry'],
  },
};

export const LANES_Z = [26, 75, 124];

function idx(c, r) { return r * COLS + c; }

// Smooth value noise, deterministic from the RNG.
function makeNoise(rng, scale) {
  const gw = Math.ceil(COLS / scale) + 2, gh = Math.ceil(ROWS / scale) + 2;
  const g = new Float32Array(gw * gh).map(() => rng.next());
  return (c, r) => {
    const x = c / scale, y = r / scale, x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = g[y0 * gw + x0], b = g[y0 * gw + x0 + 1], c2 = g[(y0 + 1) * gw + x0], d = g[(y0 + 1) * gw + x0 + 1];
    return a + (b - a) * sx + (c2 - a) * sy + (a - b - c2 + d) * sx * sy;
  };
}

function fillRect(grid, x0, z0, x1, z1, t) {
  for (let r = Math.max(0, Math.floor(z0 / CELL)); r < Math.min(ROWS, Math.ceil(z1 / CELL)); r++)
    for (let c = Math.max(0, Math.floor(x0 / CELL)); c < Math.min(COLS, Math.ceil(x1 / CELL)); c++) grid[idx(c, r)] = t;
}
function fillCircle(grid, x, z, rad, t, onlyIf) {
  for (let r = Math.max(0, Math.floor((z - rad) / CELL)); r < Math.min(ROWS, Math.ceil((z + rad) / CELL)); r++)
    for (let c = Math.max(0, Math.floor((x - rad) / CELL)); c < Math.min(COLS, Math.ceil((x + rad) / CELL)); c++) {
      const cx = c * CELL + 1, cz = r * CELL + 1;
      if ((cx - x) ** 2 + (cz - z) ** 2 <= rad * rad && (onlyIf === undefined || onlyIf.includes(grid[idx(c, r)]))) grid[idx(c, r)] = t;
    }
}
function road(grid, pts, width, t = T.ROAD, keep = [T.DEEP, T.SHALLOW]) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 1);
    for (let k = 0; k <= n; k++) {
      const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n;
      for (let r = Math.floor((z - width) / CELL); r <= Math.floor((z + width) / CELL); r++)
        for (let c = Math.floor((x - width) / CELL); c <= Math.floor((x + width) / CELL); c++) {
          if (c < 0 || r < 0 || c >= COLS || r >= ROWS) continue;
          const cur = grid[idx(c, r)];
          grid[idx(c, r)] = keep.includes(cur) ? T.BRIDGE : t;
        }
    }
  }
}

const LANE_PATHS = {
  top: [[14, 75], [30, 40], [50, 26], [190, 26], [210, 40], [226, 75]],
  mid: [[14, 75], [226, 75]],
  bot: [[14, 75], [30, 110], [50, 124], [190, 124], [210, 110], [226, 75]],
};

export function buildMap(id) {
  const meta = MAPS[id];
  const rng = new RNG(meta.seed);
  const grid = new Uint8Array(COLS * ROWS).fill(T.LAND);
  const height = new Float32Array(COLS * ROWS);
  const bldHeight = new Float32Array(COLS * ROWS);
  const n1 = makeNoise(rng, 9), n2 = makeNoise(rng, 4);

  const strongpoints = [];
  const structures = [];
  const decor = [];
  let lanes = LANE_PATHS;
  const tunnels = [];

  if (id === 'plains') {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const v = n1(c, r) * 0.7 + n2(c, r) * 0.3;
      if (v > 0.68) { grid[idx(c, r)] = T.HILL; height[idx(c, r)] = (v - 0.62) * 9; }
      else if (v < 0.24) grid[idx(c, r)] = T.FOREST;
    }
    // Small river crossing north-south, shallow (boats cannot use it).
    for (let r = 0; r < ROWS; r++) {
      const x = 120 + Math.sin(r * 0.11) * 10;
      fillCircle(grid, x, r * CELL, 3.2, T.SHALLOW);
    }
    strongpoints.push([70, 26], [170, 26], [82, 75], [120, 62], [158, 75], [70, 124], [170, 124]);
    decor.push({ model: 'map_airbase', x: -46, z: 75, rot: 0, scale: 1, outside: true });
    decor.push({ model: 'map_airbase', x: 286, z: 75, rot: Math.PI, scale: 1, outside: true });
  }

  if (id === 'city') {
    // Canal with bridges, harbor strip at the bottom edge.
    fillRect(grid, 0, 96, MAP_W, 104, T.DEEP);
    fillRect(grid, 0, 142, MAP_W, MAP_H, T.DEEP);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const x = c * CELL, z = r * CELL;
      if (grid[idx(c, r)] !== T.LAND) continue;
      const street = (x % 16 < 4) || (z % 14 < 4);
      if (!street && x > 30 && x < 210 && rng.next() > 0.12) {
        grid[idx(c, r)] = T.BUILDING;
        // Block-level height so buildings look like towers, not noise.
        const bx = Math.floor(x / 16), bz = Math.floor(z / 14);
        bldHeight[idx(c, r)] = 3 + ((bx * 7 + bz * 13) % 9) * 1.4 + n2(c, r) * 2;
      }
    }
    strongpoints.push([66, 26], [174, 26], [84, 75], [120, 82], [156, 75], [66, 124], [174, 124]);
    // Tunnels ("ngầm", F-90): two pairs under the canal for infantry / UGV (sim/tunnels.js).
    tunnels.push({ id: 0, a: { x: 98, z: 84 }, b: { x: 98, z: 114 } }, { id: 1, a: { x: 142, z: 84 }, b: { x: 142, z: 114 } });
    decor.push({ model: 'map_city', x: 120, z: -52, rot: 0, scale: 1, outside: true });
    decor.push({ model: 'map_city', x: 120, z: 202, rot: Math.PI, scale: 1, outside: true });
  }

  if (id === 'bay') {
    // Sea in the middle; land strips along top & bottom lanes; islands carry strongpoints.
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const x = c * CELL, z = r * CELL;
      const coast = 44 + (n1(c, r) - 0.5) * 14, coast2 = 106 + (n1(c + 40, r) - 0.5) * 14;
      if (x > 34 && x < 206 && z > coast && z < coast2) {
        const depth = Math.min(z - coast, coast2 - z);
        grid[idx(c, r)] = depth < 5 ? T.SHALLOW : T.DEEP;
      }
    }
    // Sea also reaches each base so both sides have a port.
    fillRect(grid, 24, 58, 40, 92, T.DEEP);
    fillRect(grid, 200, 58, 216, 92, T.DEEP);
    fillRect(grid, 22, 56, 42, 58, T.SHALLOW); fillRect(grid, 22, 92, 42, 94, T.SHALLOW);
    for (const [x, z, rad] of [[86, 75, 7], [120, 75, 9], [154, 75, 7], [104, 58, 4], [138, 92, 4]]) {
      fillCircle(grid, x, z, rad + 2.5, T.SHALLOW, [T.DEEP]);
      fillCircle(grid, x, z, rad, T.LAND);
    }
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (grid[idx(c, r)] === T.LAND && n2(c, r) > 0.72) { grid[idx(c, r)] = T.HILL; height[idx(c, r)] = (n2(c, r) - 0.66) * 8; }
      else if (grid[idx(c, r)] === T.LAND && n2(c, r) < 0.2) grid[idx(c, r)] = T.FOREST;
    }
    strongpoints.push([70, 24], [170, 24], [86, 75], [120, 75], [154, 75], [70, 126], [170, 126]);
    // Mid lane is a sea lane for this map.
    lanes = { ...LANE_PATHS, mid: [[34, 75], [206, 75]] };
    decor.push({ model: 'map_port', x: -44, z: 75, rot: 0, scale: 1, outside: true });
    decor.push({ model: 'map_port', x: 284, z: 75, rot: Math.PI, scale: 1, outside: true });
  }

  // Roads along lanes (bridges where they cross water). Bay mid lane stays water.
  for (const [k, pts] of Object.entries(lanes)) {
    if (id === 'bay' && k === 'mid') continue;
    road(grid, pts, 2.2);
  }
  if (id === 'city') { road(grid, [[60, 20], [60, 130]], 2.2); road(grid, [[120, 20], [120, 140]], 2.2); road(grid, [[180, 20], [180, 130]], 2.2); }

  // Clear areas around bases and strongpoints.
  const bases = [{ side: 0, x: 14, z: 75 }, { side: 1, x: 226, z: 75 }];
  for (const b of bases) fillCircle(grid, b.x, b.z, 13, T.LAND, [T.BUILDING, T.FOREST, T.HILL, T.SHALLOW]);
  for (const [x, z] of strongpoints) fillCircle(grid, x, z, 6, T.LAND, [T.BUILDING, T.FOREST, T.HILL]);
  for (const t of tunnels) for (const e of [t.a, t.b]) fillCircle(grid, e.x, e.z, 3.5, T.LAND, [T.BUILDING, T.FOREST, T.HILL]);
  for (let i = 0; i < height.length; i++) if (grid[i] !== T.HILL) height[i] = 0;

  // Structures: HQ ("thành chỉ huy"), lane bunkers (destructible, armed), airfield (rearm aircraft), port (rearm ships), radar.
  for (const b of bases) {
    const dir = b.side === 0 ? 1 : -1;
    structures.push({ type: 'hq', side: b.side, x: b.x, z: b.z, hp: 12000, armor: 0.5 });
    structures.push({ type: 'airfield', side: b.side, x: b.x + dir * 2, z: b.z - 14, hp: 3000, armor: 0.3 });
    if (id !== 'plains') structures.push({ type: 'port', side: b.side, x: b.x + dir * (id === 'bay' ? 18 : 6), z: id === 'bay' ? 75 : 141, hp: 3000, armor: 0.3 });
    structures.push({ type: 'radar_tower', side: b.side, x: b.x + dir * 4, z: b.z + 14, hp: 1500, armor: 0.2 });
    for (const lz of LANES_Z) {
      const bx = b.side === 0 ? 44 : 196;
      if (id === 'bay' && lz === 75) continue;
      structures.push({ type: 'bunker', side: b.side, x: bx, z: lz, hp: 3500, armor: 0.45, armed: { dmg: 40, range: 20, rof: 0.8, hits: ['ground', 'low', 'sea'] } });
    }
  }
  for (const s of structures) if (s.type !== 'port') fillCircle(grid, s.x, s.z, 3.5, T.LAND, [T.BUILDING, T.FOREST, T.HILL]);

  // Deployment zones (GDD §2 step 2): a rectangle near each base, widened by commander (see sim/deploy).
  const deployZones = [{ side: 0, x0: 4, x1: 46, z0: 8, z1: 142 }, { side: 1, x0: 194, x1: 236, z0: 8, z1: 142 }];

  return {
    id, ...meta, cols: COLS, rows: ROWS, cell: CELL, w: MAP_W, h: MAP_H, grid, height, bldHeight,
    bases, lanes, deployZones, decor, tunnels,
    heavyPenalty: id === 'city' ? 0.75 : 0,   // F-90: heavy vehicles (size ≥ 3) move ×0.75 off-road in the city
    strongpoints: strongpoints.map(([x, z], i) => ({
      id: i, x, z, radius: 7, coastal: isCoastal(grid, x, z),
    })),
    structures: structures.map((s, i) => ({ id: 'st' + i, ...s })),
    hasSea: grid.some(t => t === T.DEEP),
    hasBuildings: grid.some(t => t === T.BUILDING),   // city blocks block line of sight (sim/vision.js losBlocked)
  };
}

function isCoastal(grid, x, z) {
  for (let a = 0; a < 16; a++) {
    const px = x + Math.cos(a / 16 * Math.PI * 2) * 12, pz = z + Math.sin(a / 16 * Math.PI * 2) * 12;
    const c = Math.floor(px / CELL), r = Math.floor(pz / CELL);
    if (c >= 0 && r >= 0 && c < COLS && r < ROWS && grid[idx(c, r)] === T.DEEP) return true;
  }
  return false;
}

export function cellAt(map, x, z) {
  const c = Math.floor(x / CELL), r = Math.floor(z / CELL);
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return -1;
  return map.grid[idx(c, r)];
}
export function heightAt(map, x, z) {
  const c = Math.floor(x / CELL), r = Math.floor(z / CELL);
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return 0;
  return map.height[idx(c, r)];
}

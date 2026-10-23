// Vision & fog of war (order 80). GDD §2 layer visibility table (F-14/F-15), §7 fog + weather (F-94/F-98).
//  - ground/sea: seen by any enemy within sight
//  - low (helis, FPV): seen by eyes within sight (fog hides drones beyond 8 units)
//  - air (high): only radar (units with detect 'radar', HQ, radar towers)
//  - sub: only sonar (detect 'sonar'), or navy commander fleet sonar
//  - stealth: only radar within 9 units; spotted (marked) units are visible to the whole side
//  - city (F-90): ground/sea/low targets are hidden from ground observers (no radar) when the sight line crosses
//    ≥ 2 building cells; air/radar observers and air targets ignore buildings. Cached per vision tick.
import { CELL, T } from '../data/maps.js';

const RADAR_RANGE = 58, SONAR_RANGE = 30, FOG_DRONE_RANGE = 8;

export const visionSystem = {
  name: 'vision',
  init(game) {
    const n = game.map.cols * game.map.rows;
    game.fog = [0, 1].map(() => ({ visible: new Uint8Array(n), explored: new Uint8Array(n) }));
  },
  update(game, dt) {
    for (const u of game.units.values()) {
      if (u.stealth > 0) u.stealth -= dt;
      if (u.jammed > 0) u.jammed -= dt / (1 - (u.acc?.jamResist || 0)); // "Kháng nhiễu": jams wear off faster (F-81)
      if (u.spotted > 0) u.spotted -= dt;
    }
    if (game.tick % 4 !== 0) return;
    if (game._los) game._los.clear();
    const weatherMul = game.weather === 'rain' ? 0.7 : game.weather === 'fog' ? 0.8 : 1;
    for (let side = 0; side < 2; side++) {
      const eyes = observers(game, side, weatherMul);
      const fog = game.fog[side];
      fog.visible.fill(0);
      for (const e of eyes) markCircle(game, fog, e.x, e.z, e.sight);
      for (const u of game.units.values()) {
        if (!u.alive) continue;
        if (u.side === side) { u.visible[side] = true; continue; }
        u.visible[side] = canSee(game, side, u, eyes);
      }
      for (const s of game.structures) s[`seen${side}`] = s.side === side || s[`seen${side}`] || cellVisible(game, fog, s.x, s.z);
    }
  },
};

function observers(game, side, weatherMul) {
  const out = [];
  for (const u of game.units.values()) {
    if (!u.alive || u.side !== side || u.carriedBy) continue;
    const det = u.def.detect || [];
    const wm = u.acc?.ignoreRain && game.weather === 'rain' ? 1 : weatherMul; // "Kính nhìn đêm" (F-81)
    out.push({ x: u.x, z: u.z, sight: u.sight * wm * (u.jammed > 0 ? 0.6 : 1), radar: det.includes('radar') && !(u.radarJammed > game.time), sonar: det.includes('sonar'), unit: u }); // radarJammed: Màn Đêm (commanders.js)
  }
  for (const s of game.structures) if (s.alive && s.side === side)
    out.push({ x: s.x, z: s.z, sight: 18 * weatherMul, radar: (s.type === 'hq' || s.type === 'radar_tower') && !(s.radarJammed > game.time), sonar: s.type === 'port' });
  for (const sp of game.strongpoints) if (sp.owner === side) out.push({ x: sp.x, z: sp.z, sight: 16 * weatherMul, radar: false, sonar: false });
  return out;
}

function canSee(game, side, u, eyes) {
  if (u.tunnel) return false;                    // underground (sim/tunnels.js)
  if (u.spotted > 0 && u.spottedBy === side) return true;
  if (u.revealedTo?.[side] > game.time) return true;
  const fleetSonar = game.sides[side].mods.fleetSonar;
  const losTarget = game.map.hasBuildings && (u.layer === 'ground' || u.layer === 'sea' || u.layer === 'low');
  for (const e of eyes) {
    const d = Math.hypot(e.x - u.x, e.z - u.z);
    if (losTarget && !e.radar && d < e.sight && (!e.unit || !e.unit.isAir) && losBlockedCached(game, e.x, e.z, u.x, u.z)) continue;
    if (u.stealth > 0) { if (e.radar && d < 9) return true; continue; }
    switch (u.layer) {
      case 'air': if (e.radar && d < RADAR_RANGE) return true; break;
      case 'sub': if ((e.sonar || (fleetSonar && e.unit?.isNaval)) && d < SONAR_RANGE * (1 - (u.acc?.sonarEvade || 0))) return true; break;
      case 'low':
        if (game.weather === 'fog' && u.def.group === 'drone') { if (d < FOG_DRONE_RANGE) return true; break; }
        if (d < e.sight || (e.radar && d < RADAR_RANGE * 0.5)) return true; break;
      default: if (d < e.sight) return true;
    }
  }
  return false;
}

function markCircle(game, fog, x, z, r) {
  const { cols, rows } = game.map;
  const c0 = Math.max(0, Math.floor((x - r) / CELL)), c1 = Math.min(cols - 1, Math.floor((x + r) / CELL));
  const r0 = Math.max(0, Math.floor((z - r) / CELL)), r1 = Math.min(rows - 1, Math.floor((z + r) / CELL));
  for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) {
    const cx = cc * CELL + 1, cz = rr * CELL + 1;
    if ((cx - x) ** 2 + (cz - z) ** 2 <= r * r) { const i = rr * cols + cc; fog.visible[i] = 1; fog.explored[i] = 1; }
  }
}
// True when the segment between two points crosses at least `need` building cells (endpoints excluded).
export function losBlocked(game, x0, z0, x1, z1, need = 2) {
  const map = game.map;
  if (!map.hasBuildings) return false;
  const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (CELL * 0.75));
  let hits = 0, last = -1;
  for (let i = 1; i < n; i++) {
    const c = Math.floor((x0 + (x1 - x0) * i / n) / CELL), r = Math.floor((z0 + (z1 - z0) * i / n) / CELL);
    if (c < 0 || r < 0 || c >= map.cols || r >= map.rows) continue;
    const k = r * map.cols + c;
    if (k === last) continue;
    last = k;
    if (map.grid[k] === T.BUILDING && ++hits >= need) return true;
  }
  return false;
}
// Same, cached per vision tick by (observer cell, target cell).
function losBlockedCached(game, x0, z0, x1, z1) {
  const m = game.map, N = m.cols * m.rows;
  const a = Math.floor(z0 / CELL) * m.cols + Math.floor(x0 / CELL), b = Math.floor(z1 / CELL) * m.cols + Math.floor(x1 / CELL);
  const key = a * N + b;
  const L = (game._los ||= new Map());
  let v = L.get(key);
  if (v === undefined) { v = losBlocked(game, x0, z0, x1, z1); L.set(key, v); }
  return v;
}

export function cellVisible(game, fog, x, z) {
  const c = Math.floor(x / CELL), r = Math.floor(z / CELL);
  if (c < 0 || r < 0 || c >= game.map.cols || r >= game.map.rows) return false;
  return !!fog.visible[r * game.map.cols + c];
}

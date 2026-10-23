// Core command handlers: deploy (GDD §2 step 2), ready (skip deploy timer), order (step 3).
// Other modules register their own commands (economy: buy/loan/recruit..., commanders: ultimate, hypersonic...).
import { unitDef } from '../data/units.js';
import { passable, domainOf, nearestPassable } from './path.js';

export const ORDER_TYPES = ['attack', 'defend', 'suppress', 'flank', 'sead', 'retreat', 'focus', 'move', 'capture'];

export function inDeployZone(game, side, x, z) {
  const zn = game.map.deployZones[side];
  const extra = game.sides[side].deployBonus || 0;
  const x0 = side === 0 ? zn.x0 : zn.x0 - extra, x1 = side === 0 ? zn.x1 + extra : zn.x1;
  return x >= x0 && x <= x1 && z >= zn.z0 && z <= zn.z1;
}

// Spawn a formation slot (count units of one type) around (x,z). Used by deploy and by reinforcements.
export function spawnSlot(game, side, slot, x, z, opts = {}) {
  const def = unitDef(slot.unit);
  const domain = domainOf({ layer: def.layer });
  const out = [];
  const n = def.swarmCount ? 1 : (slot.count || 1);
  for (let i = 0; i < n; i++) {
    const a = (i / Math.max(1, n)) * Math.PI * 2, r = n > 1 ? 2 + def.size * 0.5 : 0;
    let px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    if (domain !== 'air') { const p = nearestPassable(game.map, domain, px, pz, 24); if (!p) continue; px = p.x; pz = p.z; }
    const u = game.spawn(side, slot.unit, px, pz, { tier: slot.tier || 1, group: slot.slot, ...opts });
    out.push(u);
  }
  // Infantry come with the troop pool: each infantry unit is a squad drawn from reserve.
  return out;
}

export function deploySlotValid(game, side, slot, x, z) {
  const def = unitDef(slot.unit);
  const domain = domainOf({ layer: def.layer });
  if (!inDeployZone(game, side, x, z)) return 'Ngoài vùng triển khai';
  if (domain !== 'air' && !nearestPassable(game.map, domain, x, z, 10)) return domain === 'ground' ? 'Đơn vị mặt đất phải đặt trên đất liền' : 'Tàu phải đặt dưới nước';
  return null;
}

export function registerCoreCommands(game) {
  game.onCommand('deploy', (g, side, cmd) => {
    const s = g.sides[side];
    const slot = s.formation[cmd.slot];
    if (!slot || slot.deployed) return false;
    if (g.phase !== 'deploy' && !cmd.reinforce) return false;
    const err = deploySlotValid(g, side, slot, cmd.x, cmd.z);
    if (err) { g.events.emit('toast', { side, text: err }); return false; }
    if (slot.unit === 'infantry') {
      const need = (slot.count || 1) * 50;
      if (s.troops.reserve < need) { g.events.emit('toast', { side, text: 'Không đủ binh lính' }); return false; }
    }
    const units = spawnSlot(g, side, slot, cmd.x, cmd.z);
    if (slot.unit === 'infantry') for (const u of units) { s.troops.reserve -= u.soldiers; s.troops.active += u.soldiers; }
    slot.deployed = true;
    g.events.emit('deployed', { side, slot: cmd.slot, units });
    return true;
  });

  // Deploy everything not yet placed at default positions (used by AI and the "auto deploy" button).
  game.onCommand('autodeploy', (g, side) => {
    const s = g.sides[side];
    const zn = g.map.deployZones[side];
    s.formation.forEach((slot, i) => {
      if (slot.deployed) return;
      const def = unitDef(slot.unit);
      const lanesZ = [32, 75, 118];
      let x = side === 0 ? zn.x1 - 8 : zn.x0 + 8, z = lanesZ[i % 3] + Math.floor(i / 3) * 6 - 6;
      if (def.layer === 'sea' || def.layer === 'sub') { const p = nearestPassable(g.map, domainOf({ layer: def.layer }), side === 0 ? 32 : 208, 75, 40); if (p) { x = p.x; z = p.z; } }
      if (def.layer !== 'air' && def.layer !== 'low') { const p = nearestPassable(g.map, domainOf({ layer: def.layer }), x, z, 30); if (p) { x = p.x; z = p.z; } }
      g.commandHandlers.get('deploy')(g, side, { type: 'deploy', slot: i, x, z, reinforce: g.phase !== 'deploy' });
    });
    return true;
  });

  game.onCommand('ready', (g, side) => {
    g.sides[side].ready = true;
    if (g.sides.every(s => s.ready || s.ai)) g.startBattle();
    return true;
  });

  // order: { unitIds:[...], order: ORDER_TYPES, x, z, targetId? }
  game.onCommand('order', (g, side, cmd) => {
    if (!ORDER_TYPES.includes(cmd.order)) return false;
    const target = cmd.targetId != null ? (g.units.get(cmd.targetId) || g.structures.find(s => s.id === cmd.targetId)) : null;
    let n = 0;
    for (const id of cmd.unitIds || []) {
      const u = g.units.get(id);
      if (!u || !u.alive || u.side !== side) continue;
      u.order = { type: cmd.order, x: cmd.x, z: cmd.z, targetId: cmd.targetId ?? null, issued: g.time, home: { x: u.x, z: u.z } };
      u.focusId = cmd.order === 'focus' && target ? target.id : null;
      u.forcedTarget = cmd.order === 'focus' && target ? target : null;
      u.path = null; u.dest = null;
      n++;
    }
    if (n) g.events.emit('order', { side, order: cmd.order, n, x: cmd.x, z: cmd.z });
    return n > 0;
  });
}

// Movement system (order 40). Follows unit.path (set via setDestination) or unit.moveTarget (direct steering),
// with light separation so groups do not stack. Air units fly straight; ground/sea use A* paths.
import { findPath, domainOf, passable, speedFactor } from './path.js';
import { LAYER_HEIGHT } from '../data/units.js';
import { heightAt, cellAt, T } from '../data/maps.js';
import { tunnelPlan } from './tunnels.js';

// Ask a unit to travel to (x,z). Recomputes the path only if the goal moved noticeably.
export function setDestination(game, u, x, z) {
  if (u.tunnel) { u.tunnel.dest = { x, z }; return true; }      // underground: keep the goal for the exit (tunnels.js)
  if (u.dest && Math.hypot(u.dest.x - x, u.dest.z - z) < 1.5 && u.path) return true;
  u.dest = { x, z };
  // City tunnels (F-90): infantry/UGV walk to a tunnel entrance when the other end is much closer to the goal.
  const plan = game.map.tunnels ? tunnelPlan(game, u, x, z) : null;
  u.tunnelPlan = plan;
  if (plan) { x = plan.from.x; z = plan.from.z; }
  const p = findPath(game.map, domainOf(u), u.x, u.z, x, z);
  u.path = p && p.length ? p : null;
  return !!u.path;
}
export function stop(u) { u.path = null; u.dest = null; u.moveTarget = null; }
export function arrived(u, tol = 1.5) { return !u.path && !u.moveTarget; }

export const movementSystem = {
  name: 'movement',
  update(game, dt) {
    for (const u of game.units.values()) {
      if (!u.alive) continue;
      if (u.carriedBy) { const c = game.units.get(u.carriedBy); if (c) { u.x = c.x; u.z = c.z; u.alt = c.alt; } continue; }
      if (u.speed <= 0 || u.stunned > 0 || u.tunnel) continue;
      const domain = domainOf(u);
      let goal = u.moveTarget;
      if (!goal && u.path) {
        goal = u.path[0];
        if (Math.hypot(goal.x - u.x, goal.z - u.z) < (u.isAir ? 2.5 : 1.2)) {
          u.path.shift();
          if (!u.path.length) { u.path = null; goal = null; }
          else goal = u.path[0];
        }
      }
      let vx = 0, vz = 0;
      const mods = game.sides[u.side].mods;
      let speed = u.speed * (1 + (mods.speedGroup?.[u.def.group] || 0)) * (u.speedBoost || 1) * (u.formationSpeed ?? 1); // formationSpeed: sim/ai.js keeps squad spacing
      if (u.jammed > 0 && u.def.remote) speed *= 0.5;
      if (goal) {
        const dx = goal.x - u.x, dz = goal.z - u.z, d = Math.hypot(dx, dz);
        if (d > 0.05) {
          const want = Math.atan2(dz, dx);
          // Turn rate: aircraft bank smoothly, ground units turn fast.
          const turn = u.layer === 'air' ? 2.2 : 6;
          let diff = want - u.heading;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          u.heading += Math.max(-turn * dt, Math.min(turn * dt, diff));
          const along = u.layer === 'air' ? 1 : Math.max(0, Math.cos(diff));
          let sp = speed * speedFactor(game.map, domain, u.x, u.z) * along;
          // City (F-90): heavy vehicles are 25% slower off the roads (narrow streets, rubble).
          if (game.map.heavyPenalty && u.layer === 'ground' && u.def.size >= 3) { const c = cellAt(game.map, u.x, u.z); if (c !== T.ROAD && c !== T.BRIDGE) sp *= game.map.heavyPenalty; }
          const step = Math.min(sp * dt, u.layer === 'air' ? sp * dt : d);
          vx = Math.cos(u.heading) * step; vz = Math.sin(u.heading) * step;
        } else if (u.moveTarget) u.moveTarget = null;
      } else if (u.layer === 'air' && !u.landed) {
        // Fixed-wing aircraft cannot hover: circle around current spot.
        u.heading += 0.9 * dt;
        vx = Math.cos(u.heading) * speed * 0.6 * dt; vz = Math.sin(u.heading) * speed * 0.6 * dt;
      }
      // Separation (same domain, cheap).
      if (u.layer !== 'air') {
        let sx = 0, sz = 0;
        const rad = Math.max(1.2, u.def.size * 0.5);
        game.grid.query(u.x, u.z, rad * 2, o => {
          if (o === u || !o.alive || o.layer !== u.layer || o.carriedBy) return;
          const dx = u.x - o.x, dz = u.z - o.z, d2 = dx * dx + dz * dz, rr = (rad + Math.max(1.2, o.def.size * 0.5)) * 0.8;
          if (d2 < rr * rr && d2 > 1e-4) { const d = Math.sqrt(d2); sx += dx / d * (rr - d); sz += dz / d * (rr - d); }
        });
        vx += sx * 0.25; vz += sz * 0.25;
      }
      const nx = u.x + vx, nz = u.z + vz;
      if (passable(game.map, domain, nx, nz)) { u.x = nx; u.z = nz; }
      else if (passable(game.map, domain, nx, u.z)) u.x = nx;
      else if (passable(game.map, domain, u.x, nz)) u.z = nz;
      u.x = Math.max(0.5, Math.min(game.map.w - 0.5, u.x));
      u.z = Math.max(0.5, Math.min(game.map.h - 0.5, u.z));
      u.moving = Math.abs(vx) + Math.abs(vz) > 1e-3;
      // Altitude: terrain for ground units, fixed layer heights for others; landed helis sit on the ground.
      const base = LAYER_HEIGHT[u.layer];
      u.alt = u.layer === 'ground' ? heightAt(game.map, u.x, u.z) : u.landed ? heightAt(game.map, u.x, u.z) + 0.2 : base;
    }
  },
};

// OWNER: agent AI chiến thuật
// Strongpoint capture (order 60): GDD §11 F-130..F-137.
//  - 15 s of continuous presence of capture-capable ground units (unit.canCapture: tanks + infantry; never aircraft/drones;
//    heli/sub-delivered infantry count once dropped) inside sp.radius, with no enemy capable unit inside and no hit taken
//    inside the ring. Enemy present -> contested, progress stops; capturer leaves or is attacked inside -> reset.
//  - After 15 s sp.owner flips (renderer reads sp.owner / sp.progress / sp.capturer / sp.contested), event 'capture' + toast.
//  - Owned strongpoints slowly heal friendly units inside; sp.held[side] counts seconds held (score).
//  Income / score accrual live in sim/economy.js (reads sp.owner).
export const CAPTURE_TIME = 15;
export const CAPTURE = { healRate: 0.01, hitResetWindow: 0.6 };

export const captureSystem = {
  name: 'capture',
  update(game, dt) {
    if (game.phase !== 'battle') return;
    for (const sp of game.strongpoints) {
      if (sp.owner >= 0) sp.held[sp.owner] += dt;
      const r2 = sp.radius * sp.radius;
      const present = [0, 0], hit = [false, false];
      const inside = game.unitsNear(sp.x, sp.z, sp.radius, u => !u.carriedBy);
      for (const u of inside) {
        if (!u.canCapture || (u.x - sp.x) ** 2 + (u.z - sp.z) ** 2 > r2) continue;
        present[u.side]++;
        if (game.time - u.lastHitTime < CAPTURE.hitResetWindow && u.lastAttacker != null) {
          const a = game.units.get(u.lastAttacker);
          if (!a || a.side !== u.side) hit[u.side] = true;
        }
      }
      sp.present = present;
      const both = present[0] > 0 && present[1] > 0;
      sp.contested = both;
      if (both) continue;                             // progress frozen while contested
      const s = present[0] > 0 ? 0 : present[1] > 0 ? 1 : -1;
      if (s < 0) { sp.progress = 0; sp.capturer = -1; continue; } // capturer left -> reset
      if (sp.owner === s) {                          // owner alone: wipe any enemy progress
        if (sp.capturer >= 0 && sp.capturer !== s) { sp.progress = 0; sp.capturer = -1; }
        continue;
      }
      if (sp.capturer !== s) { sp.capturer = s; sp.progress = 0; }
      if (hit[s]) { sp.progress = 0; sp.contested = true; continue; } // attacked inside the ring -> reset
      sp.progress += dt / CAPTURE_TIME;
      if (sp.progress >= 1) {
        const prev = sp.owner;
        sp.owner = s; sp.progress = 0; sp.capturer = -1; sp.capturedAt = game.time;
        game.events.emit('capture', { sp, side: s, prev });
        game.events.emit('toast', { side: s, text: `Đã chiếm cứ điểm ${sp.id + 1}` });
        if (prev >= 0) game.events.emit('toast', { side: prev, text: `Mất cứ điểm ${sp.id + 1}` });
      }
    }
    // Slow heal for friendly units inside owned strongpoints (2 Hz).
    if (game.tick % 10 === 0) {
      const step = dt * 10;
      for (const sp of game.strongpoints) {
        if (sp.owner < 0) continue;
        for (const u of game.unitsNear(sp.x, sp.z, sp.radius, u => u.side === sp.owner && !u.carriedBy && u.hp < u.maxHp)) {
          let cap = u.maxHp;
          if (u.def.id === 'infantry') cap = u.maxHp * u.soldiers / (u.squadSize || 1); // healing never creates soldiers
          if (u.hp < cap) u.hp = Math.min(cap, u.hp + u.maxHp * CAPTURE.healRate * step);
        }
      }
    }
  },
};
export function install(game) { game.addSystem(captureSystem, 60); }

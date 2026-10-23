// City tunnels ("ngầm", GDD §7 Thành phố, F-90). map.tunnels = [{ id, a:{x,z}, b:{x,z} }].
// Infantry squads and UGVs whose destination is much closer from the other end of a tunnel route to the nearest
// entrance (movement.setDestination asks tunnelPlan), disappear underground for TUNNEL.delay seconds (invisible,
// cannot shoot or be shot), then come out at the other end and continue to their destination.
// Fields: u.tunnelPlan {id, from, to, dest}, u.tunnel {exit, until, dest}, u.tunnelCd. Events: 'tunnel' {unit, from, to, phase}.
import { setDestination } from './movement.js';

export const TUNNEL = { delay: 4, enterRadius: 2.6, minGain: 0.8, minDist: 20, cooldown: 12 };

export function canUseTunnel(u) {
  return u.layer === 'ground' && !u.def.needsTransport && (u.def.group === 'infantry' || u.def.id === 'ugv');
}
export function inTunnel(u) { return !!u.tunnel; }

// Best tunnel route for u to (x,z), or null when walking is about as short.
export function tunnelPlan(game, u, x, z) {
  const T = game.map.tunnels;
  if (!T || !T.length || !canUseTunnel(u) || (u.tunnelCd || 0) > game.time) return null;
  const direct = Math.hypot(x - u.x, z - u.z);
  if (direct < TUNNEL.minDist) return null;
  let best = null;
  for (const t of T) for (const [from, to] of [[t.a, t.b], [t.b, t.a]]) {
    const via = Math.hypot(from.x - u.x, from.z - u.z) + Math.hypot(x - to.x, z - to.z) + TUNNEL.delay * u.speed;
    if (via < direct * TUNNEL.minGain && (!best || via < best.via)) best = { id: t.id, from, to, via, dest: { x, z } };
  }
  return best;
}

export const tunnelSystem = {
  name: 'tunnels',
  update(game) {
    if (!game.map.tunnels || !game.map.tunnels.length || game.tick % 2) return;
    for (const u of game.units.values()) {
      if (!u.alive) { if (u.tunnel) u.tunnel = null; continue; }
      if (u.tunnel) {
        if (game.time < u.tunnel.until) continue;
        const { exit, dest } = u.tunnel;
        u.tunnel = null; u.x = exit.x; u.z = exit.z;
        u.tunnelCd = game.time + TUNNEL.cooldown;
        u.path = null; u.dest = null; u.moveTarget = null;
        if (dest) setDestination(game, u, dest.x, dest.z);
        game.events.emit('tunnel', { unit: u, to: exit, phase: 'exit' });
        continue;
      }
      const P = u.tunnelPlan;
      if (!P) continue;
      // Plan is stale when the unit got a new destination elsewhere.
      if (!u.dest || Math.hypot(u.dest.x - P.dest.x, u.dest.z - P.dest.z) > 3) { u.tunnelPlan = null; continue; }
      if (Math.hypot(P.from.x - u.x, P.from.z - u.z) > TUNNEL.enterRadius) continue;
      u.tunnelPlan = null;
      u.tunnel = { exit: P.to, until: game.time + TUNNEL.delay, dest: P.dest };
      u.path = null; u.moveTarget = null; u.target = null;
      game.events.emit('tunnel', { unit: u, from: P.from, to: P.to, phase: 'enter' });
    }
  },
};

export function install(game) { game.addSystem(tunnelSystem, 41); }

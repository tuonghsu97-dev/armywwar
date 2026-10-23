// OWNER: agent Meta & chế độ chơi
// Boss battles (order 95): GDD §8 F-100, F-101, F-08. Active when game.mode === 'boss' (opts.boss = boss id).
// Side 1 is driven by this module (opts.enemy.ai should be false): escorts auto-deploy, then 3 phases by boss HP:
//   >66% 'Phòng thủ' (hold position, shield -50% damage) · 33–66% 'Gọi viện' (reinforcement waves)
//   <33% 'Ép gặp' (everything attacks the player HQ).
// Events: 'boss:phase' {phase, name, boss}, 'boss:wave' {wave, units}, 'boss:launch' {units},
//         'boss:surface' {surfaced}, 'boss:defeated' {boss}. game.boss holds the live state (UI reads it).
// Win: boss destroyed -> game.end(0, ...). The enemy HQ stays on the map (victory.js may also end on it).
import { BOSSES, BOSS_PHASES } from '../data/bosses.js';
import { LAYER_HEIGHT, unitDef } from '../data/units.js';
import { fire } from './combat.js';
import { nearestPassable, domainOf } from './path.js';

export function bossHpFrac(game) {
  const B = game.boss;
  if (!B || !B.ref) return 0;
  return Math.max(0, B.ref.hp) / B.maxHp;
}
export function phaseForFrac(f) { return f > 0.66 ? 1 : f > 0.33 ? 2 : 3; }

export const bossSystem = {
  name: 'boss',
  update(game, dt) {
    const B = game.boss;
    if (!B || B.dead) return;
    const ref = B.ref;
    if (!ref.alive || ref.hp <= 0) {
      B.dead = true;
      game.events.emit('boss:defeated', { boss: B.def.id });
      game.events.emit('toast', { side: null, text: `Đã hạ ${B.def.name}!` });
      game.end(0, `Đã hạ boss ${B.def.name}`);
      return;
    }
    // Phase transitions (only forward).
    const ph = phaseForFrac(bossHpFrac(game));
    if (ph > B.phase) setPhase(game, B, ph);
    if (game.phase !== 'battle') return;
    B.t += dt;

    // Phase behaviour
    B.orderTimer -= dt;
    if (B.orderTimer <= 0) {
      B.orderTimer = B.phase === 3 ? 12 : 10;
      if (B.phase === 3) allOut(game, B);
      else holdAround(game, B);
    }
    if (B.phase === 2 && B.waves < B.def.maxWaves) {
      B.waveTimer -= dt;
      if (B.waveTimer <= 0) { B.waveTimer = B.def.waveEvery; spawnWave(game, B); }
    }
    mechanic(game, B, dt);
  },
};

function setPhase(game, B, ph) {
  B.phase = ph;
  B.shield = ph === 1;
  const name = BOSS_PHASES[ph].name;
  game.events.emit('boss:phase', { phase: ph, name, boss: B.def.id });
  game.events.emit('toast', { side: null, text: `${B.def.name} — Pha ${ph}: ${name}!` });
  if (ph === 2) B.waveTimer = 2;        // first wave almost immediately
  if (ph === 3) { B.orderTimer = 0; }
}

function sideUnits(game, side) { const out = []; for (const u of game.units.values()) if (u.alive && u.side === side && !u.carriedBy) out.push(u); return out; }

function holdAround(game, B) {
  const ids = sideUnits(game, 1).filter(u => !u.waveUnit && !u.launched).map(u => u.id);
  if (ids.length) game.issue(1, { type: 'order', unitIds: ids, order: 'defend', x: B.ref.x, z: B.ref.z });
}

function allOut(game, B) {
  const hq = game.hq(0);
  const tgt = hq && hq.alive ? hq : nearestEnemy(game, B.ref.x, B.ref.z, 999);
  if (!tgt) return;
  const ids = sideUnits(game, 1).map(u => u.id);
  if (ids.length) game.issue(1, { type: 'order', unitIds: ids, order: 'attack', x: tgt.x, z: tgt.z });
}

function nearestEnemy(game, x, z, r) {
  let best = null, bd = r;
  for (const u of game.units.values()) if (u.alive && u.side === 0 && !u.carriedBy) { const d = Math.hypot(u.x - x, u.z - z); if (d < bd) { bd = d; best = u; } }
  return best;
}

// Attack point for fresh reinforcements: nearest player unit, else nearest player-held strongpoint, else HQ.
function attackPoint(game, x, z) {
  const u = nearestEnemy(game, x, z, 140);
  if (u) return u;
  const sp = game.strongpoints.filter(s => s.owner === 0).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
  return sp || game.hq(0);
}

export function spawnNear(game, unitId, x, z, extra = {}) {
  const def = unitDef(unitId);
  const dom = domainOf({ layer: def.layer });
  let px = x + (game.rng.next() - 0.5) * 10, pz = z + (game.rng.next() - 0.5) * 10;
  if (dom !== 'air') { const p = nearestPassable(game.map, dom, px, pz, 40); if (!p) return null; px = p.x; pz = p.z; }
  return game.spawn(1, unitId, px, pz, { tier: 1, group: extra.group ?? 99, noCrew: true, extra: { deployed: true, ...extra.extra } });
}

function spawnWave(game, B) {
  const list = B.def.waves[B.waves % B.def.waves.length];
  const units = [];
  for (const id of list) { const u = spawnNear(game, id, B.ref.x - 6, B.ref.z, { group: 100 + B.waves, extra: { waveUnit: true } }); if (u) units.push(u); }
  B.waves++;
  const tgt = attackPoint(game, B.ref.x, B.ref.z);
  if (units.length && tgt) game.issue(1, { type: 'order', unitIds: units.map(u => u.id), order: 'attack', x: tgt.x, z: tgt.z });
  game.events.emit('boss:wave', { wave: B.waves, units });
  game.events.emit('toast', { side: 0, text: `Boss gọi viện binh — đợt ${B.waves}!` });
  return units;
}

function mechanic(game, B, dt) {
  const d = B.def;
  if (d.launch) {                                   // carrier: launch fighters periodically
    B.launchTimer -= dt;
    if (B.launchTimer <= 0) {
      B.launchTimer = d.launch.every[B.phase];
      const alive = sideUnits(game, 1).filter(u => u.launched).length;
      if (alive < d.launch.max + B.phase - 1) {
        const u = spawnNear(game, d.launch.unit, B.ref.x, B.ref.z, { group: 98, extra: { launched: true } });
        if (u) {
          const t = attackPoint(game, B.ref.x, B.ref.z);
          if (t) game.issue(1, { type: 'order', unitIds: [u.id], order: 'attack', x: t.x, z: t.z });
          game.events.emit('boss:launch', { units: [u] });
        }
      }
    }
  }
  if (d.surface) {                                  // strategic sub: surface, fire a missile salvo, dive
    const ref = B.ref;
    B.surfaceTimer -= dt;
    if (!B.surfaced && B.surfaceTimer <= 0) {
      B.surfaced = true; B.surfaceTimer = d.surface.duration;
      ref.layer = 'sea'; ref.alt = LAYER_HEIGHT.sea;
      game.events.emit('boss:surface', { surfaced: true });
      game.events.emit('toast', { side: 0, text: 'Tàu ngầm chiến lược nổi lên phóng tên lửa — đánh ngay!' });
      const targets = [];
      for (const u of game.units.values()) if (u.alive && u.side === 0 && !u.carriedBy && u.layer !== 'sub' && Math.hypot(u.x - ref.x, u.z - ref.z) < d.surface.range) targets.push(u);
      targets.sort((a, b) => b.def.price - a.def.price);
      const list = targets.slice(0, d.surface.salvo);
      if (!list.length) { const hq = game.hq(0); if (hq && hq.alive) list.push(hq); }
      for (const t of list) fire(game, ref, t, { kind: 'missile', dmgType: 'he', dmg: d.surface.dmg });
    } else if (B.surfaced && B.surfaceTimer <= 0) {
      B.surfaced = false; B.surfaceTimer = d.surface.every;
      ref.layer = 'sub'; ref.alt = LAYER_HEIGHT.sub;
      game.events.emit('boss:surface', { surfaced: false });
    }
  }
  if (d.drones) {                                   // AI city core: rise, then produce drones
    if (B.rising > 0) { B.rising = Math.max(0, B.rising - dt); B.ref.rise = 1 - B.rising / d.rise; return; }
    B.droneTimer -= dt;
    if (B.droneTimer <= 0) {
      B.droneTimer = d.drones.every;
      if (sideUnits(game, 1).filter(u => u.launched).length >= 6 + 3 * B.phase) return;
      const units = [];
      for (const id of d.drones.perPhase[B.phase]) { const u = spawnNear(game, id, B.ref.x - 8, B.ref.z, { group: 97, extra: { launched: true } }); if (u) units.push(u); }
      const t = attackPoint(game, B.ref.x, B.ref.z);
      if (units.length && t) game.issue(1, { type: 'order', unitIds: units.map(u => u.id), order: 'attack', x: t.x, z: t.z });
      game.events.emit('boss:launch', { units });
    }
  }
}

export function install(game) {
  if (game.mode !== 'boss') return;
  const def = BOSSES[game.opts.boss] || BOSSES.carrier;
  const side = game.sides[1];
  side.ready = true;                   // boss side never waits for a human
  side.boss = def.id;
  if (side.formation.length) game.issue(1, { type: 'autodeploy' });

  let ref;
  if (def.kind === 'unit') {
    const dom = domainOf({ layer: unitDef(def.unit).layer });
    const p = nearestPassable(game.map, dom, def.x, def.z, 40) || { x: def.x, z: def.z };
    ref = game.spawn(1, def.unit, p.x, p.z, { tier: 3, group: 90, noCrew: true,
      extra: { maxHp: def.hp, hp: def.hp, autoRetreat: false, isBoss: true, bossId: def.id, deployed: true } });
  } else {
    ref = { id: 'boss', type: def.structure, side: 1, x: def.x, z: def.z, hp: def.hp, maxHp: def.hp, armor: def.armor ?? 0.4,
      alive: true, kind: 'structure', cooldown: 0, armed: def.armed, isBoss: true, bossId: def.id, rise: def.rise ? 0 : 1 };
    game.structures.push(ref);
  }
  for (const [x, z] of def.sams || []) {
    const u = spawnNear(game, 'sam', x, z, { group: 91 });
    if (u) { u.x = x; u.z = z; }
  }
  const B = game.boss = {
    def, ref, maxHp: def.hp, phase: 1, shield: true, dead: false, t: 0,
    orderTimer: 3, waveTimer: def.waveEvery, waves: 0,
    launchTimer: def.launch ? def.launch.every[1] : 0,
    surfaceTimer: def.surface ? def.surface.every : 0, surfaced: false,
    droneTimer: def.drones ? 6 : 0, rising: def.rise || 0,
  };

  // Phase-1 shield (and immunity while the city core rises).
  const shieldMult = () => (B.rising > 0 ? 0 : B.shield ? 1 - (def.shield ?? 0.5) : 1);
  if (def.kind === 'unit') game.addDamageHook((g, t, dmg) => (t === ref ? dmg * shieldMult() : dmg));
  // The boss replaces the enemy HQ as the objective (F-08): the side-1 HQ is protected while the boss lives.
  const enemyHq = game.hq(1);
  const orig = game.damageStructure.bind(game);
  game.damageStructure = (s, amount, type, src) => {
    if (s === ref) amount *= shieldMult();
    else if (s === enemyHq && ref.alive) {
      if (!B.hqWarned && src && src.side === 0) { B.hqWarned = true; game.events.emit('toast', { side: 0, text: 'Thành địch được boss bảo vệ — hạ boss để thắng!' }); }
      amount = 0;
    }
    return orig(s, amount, type, src);
  };
  // AA fortress: player aircraft take extra damage while it stands.
  if (def.airPenalty) game.addDamageHook((g, t, dmg) => (t.side === 0 && t.isAir && ref.alive ? dmg * (1 + def.airPenalty) : dmg));

  game.addSystem(bossSystem, 95);
}

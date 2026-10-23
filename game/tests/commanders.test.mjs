// Commanders: passives (F-22), tier bonus (F-24), lock (F-25), ultimates (F-23), hypersonic (F-46/F-70), weather (F-98).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/index.js';
import { COMMANDERS } from '../src/data/commanders.js';
import { HYPERSONIC } from '../src/data/units.js';
import { ULTIMATES } from '../src/sim/commanders.js';
import { effRange } from '../src/sim/combat.js';
import { UNITS as UNITS_HP_SRC } from '../src/data/units.js';
const UNITS_HP = Object.fromEntries(Object.entries(UNITS_HP_SRC).map(([k, v]) => [k, v.hp]));

function mk(p = 'steel', e = 'air', extra = {}) {
  return createGame({ mode: 'skirmish', mapId: extra.map || 'plains', seed: 3, aiAbilities: false, autoSkills: false, ...extra,
    player: { commander: p, formation: [] }, enemy: { commander: e, formation: [] } });
}
function battle(g) { g.startBattle(); return g; }
function steps(g, sec) { for (let i = 0; i < Math.round(sec * 20); i++) g.step(); }
function events(g, name) { const out = []; g.events.on(name, d => out.push(d)); return out; }

test('passive mods + tier bonus applied at init for every commander', () => {
  for (const id of Object.keys(COMMANDERS)) {
    const g = mk(id, id);
    const s = g.sides[0], c = COMMANDERS[id];
    for (const [k, v] of Object.entries(c.passive.mods)) assert.deepEqual(s.mods[k], v, `${id}.${k}`);
    assert.deepEqual(s.tierBonus, c.tierBonus);
    assert.equal(s.ultimate.id, c.ultimate.id);
    assert.ok(s.commanderLocked);
  }
});

test('tier bonus applied to spawned units (steel tank +10% HP, air +10% range)', () => {
  const g = mk('steel', 'air');
  const t0 = g.spawn(0, 'tank_heavy', 40, 75), t1 = g.spawn(1, 'tank_heavy', 200, 75);
  const hp = UNITS_HP.tank_heavy;
  assert.equal(t0.maxHp, Math.round(hp * 1.1));
  assert.equal(t1.maxHp, hp);
  const f1 = g.spawn(1, 'fighter_multi', 200, 70), f0 = g.spawn(0, 'fighter_multi', 40, 70);
  assert.ok(Math.abs(f1.range - f0.range * 1.1) < 1e-9);
});

test('commander is locked in match (F-25)', () => {
  const g = battle(mk());
  g.issue(0, { type: 'commander', id: 'air' });
  steps(g, 0.1);
  assert.equal(g.sides[0].commander, 'steel');
  assert.equal(g.commandLog.filter(c => c.cmd.type === 'commander').length, 0);
});

test('ultimate rejected in deploy phase, without CP, during cooldown; accepted with CP', () => {
  const g = mk('air', 'steel');
  const s = g.sides[0];
  s.cp = 100;
  g.issue(0, { type: 'ultimate', x: 150, z: 75 }); steps(g, 0.1);
  assert.ok(s.cp >= 100, 'rejected during deploy');
  battle(g);
  s.cp = 10;
  g.issue(0, { type: 'ultimate', x: 150, z: 75 }); steps(g, 0.1);
  assert.ok(s.cp >= 10 && s.cp < 11, 'rejected without CP');
  assert.equal(s.ultimateCd, 0);
  s.cp = 100;
  g.issue(0, { type: 'ultimate', x: 150, z: 75 }); steps(g, 0.1);
  const cpAfter = s.cp;
  assert.ok(Math.abs(s.cp - (100 - COMMANDERS.air.ultimate.cost)) < 1);
  assert.ok(s.ultimateCd > COMMANDERS.air.ultimate.cooldown - 1);
  g.issue(0, { type: 'ultimate', x: 150, z: 75 }); steps(g, 0.1);
  assert.ok(s.cp >= cpAfter, 'rejected during cooldown');
});

test('Miệng Chôn: tanks+infantry get +40% speed & armor, wedge move, restored after 15 s', () => {
  const g = battle(mk('steel', 'air'));
  const ts = [g.spawn(0, 'tank_heavy', 40, 70), g.spawn(0, 'tank_heavy', 40, 80), g.spawn(0, 'apc', 36, 75)];
  const ev = events(g, 'ultimate');
  g.sides[0].cp = 100;
  g.issue(0, { type: 'ultimate', x: 100, z: 75 }); steps(g, 0.2);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].id, 'wedge');
  for (const u of ts) {
    assert.equal(u.order.type, 'move');
    assert.ok(Math.abs(u.speedBoost - 1.4) < 1e-9);
    assert.ok(u.armorBoost > 0);
  }
  steps(g, 16);
  for (const u of ts) if (u.alive) { assert.equal(u.speedBoost || 1, 1); assert.equal(u.armorBoost || 0, 0); assert.equal(u.order.type, 'attack'); }
});

test('Mưa Thép: 8 waves of bombing damage enemies at the point', () => {
  const g = battle(mk('air', 'steel'));
  const v = [g.spawn(1, 'apc', 150, 75), g.spawn(1, 'apc', 152, 77)];
  for (const u of v) u.speed = 0;
  const ex = events(g, 'explosion');
  g.sides[0].cp = 100;
  g.issue(0, { type: 'ultimate', x: 151, z: 76 }); steps(g, 12);
  assert.ok(ex.filter(e => e.type === 'bomb').length >= ULTIMATES.steelrain.waves * ULTIMATES.steelrain.bombs);
  for (const u of v) assert.ok(!u.alive || u.hp < u.maxHp * 0.9, 'damaged');
});

test('Phong Tỏa: reveals enemy subs to the navy side + cruise missiles hit units inside', () => {
  const g = battle(mk('navy', 'navy', { map: 'bay' }));
  // find a deep-water point near the middle of the bay
  const sub = g.spawn(1, 'submarine', 120, 75); sub.speed = 0;
  const ship = g.spawn(1, 'destroyer', 124, 75); ship.speed = 0;
  steps(g, 0.3);
  assert.equal(sub.visible[0], false, 'sub hidden before');
  const hp0 = ship.hp;
  g.sides[0].cp = 100;
  g.issue(0, { type: 'ultimate', x: 122, z: 75 }); steps(g, 8);
  assert.ok(sub.revealedTo[0] > g.time);
  assert.equal(sub.visible[0], true, 'sub revealed');
  assert.ok(ship.hp < hp0, 'cruise missiles hit');
});

test('Đàn Ong: 40 temporary kamikaze drones from several directions, expire later', () => {
  const g = battle(mk('swarm', 'steel'));
  const sp = events(g, 'unit:spawn');
  g.sides[0].cp = 100;
  g.issue(0, { type: 'ultimate', x: 150, z: 75 }); steps(g, 0.1);
  const sw = sp.filter(u => u.def.id === 'swarm_fpv');
  assert.ok(sw.length >= 3);
  assert.equal(sw.reduce((a, u) => a + u.swarm, 0), 40);
  assert.ok(sw.every(u => u.temporary && u.side === 0));
  const angles = new Set(sw.map(u => Math.round(Math.atan2(u.z - 75, u.x - 150) * 2)));
  assert.ok(angles.size >= 3, 'several directions');
  steps(g, ULTIMATES.beehive.duration + 1);
  assert.ok(sw.every(u => !u.alive));
});

test('Màn Đêm: hacks up to 3 enemy remote units, jams radar; they return after the duration', () => {
  const g = battle(mk('ew', 'swarm'));
  const r = [0, 1, 2, 3].map(i => g.spawn(1, 'ugv', 150 + i * 2, 75));
  for (const u of r) u.speed = 0;
  const radar = g.spawn(1, 'sam', 156, 80);
  const hk = events(g, 'hack');
  g.sides[0].cp = 100;
  g.issue(0, { type: 'ultimate', x: 152, z: 75 }); steps(g, 0.2);
  assert.equal(r.filter(u => u.side === 0).length, 3);
  assert.ok(r.filter(u => u.side === 0).every(u => u.hacked > 0 && u.originalSide === 1));
  assert.ok(radar.radarJammed > g.time && radar.jammed > 0);
  steps(g, ULTIMATES.nightfall.duration + 0.5);
  assert.ok(r.every(u => u.side === 1 && !(u.hacked > 0)));
  assert.equal(hk.filter(e => e.on).length, 3);
  assert.equal(hk.filter(e => !e.on).length, 3);
});

test('hypersonic: costs money, cooldown, warning, cannot be intercepted', () => {
  const g = battle(mk('steel', 'air'));
  const s = g.sides[0];
  const tgt = g.spawn(1, 'tank_heavy', 180, 75); tgt.speed = 0;
  const dome = g.spawn(1, 'iron_dome', 182, 77), sam = g.spawn(1, 'sam', 178, 73);
  const warn = events(g, 'strike:warn'), imp = events(g, 'strike:impact'), icp = events(g, 'intercept');
  const m0 = s.money;
  g.issue(0, { type: 'hypersonic', x: 180, z: 75 }); steps(g, 0.1);
  assert.ok(Math.abs(s.money - (m0 - HYPERSONIC.price)) < 1e6);
  const m1 = s.money;
  assert.equal(warn.length, 1);
  assert.ok(s.hypersonicCd > 140);
  assert.equal(g.projectiles.length, 0, 'not a projectile');
  g.issue(0, { type: 'hypersonic', x: 180, z: 75 }); steps(g, 0.1);
  assert.ok(s.money > m1 - 1e6, 'cooldown blocks a second shot');
  steps(g, 3.5);
  assert.equal(imp.length, 1);
  assert.equal(icp.length, 0);
  assert.ok(!tgt.alive || tgt.hp < tgt.maxHp * 0.5, 'big damage');
  assert.ok(!dome.alive || dome.hp < dome.maxHp);
});

test('hypersonic rejected without money', () => {
  const g = battle(mk());
  g.sides[0].money = HYPERSONIC.price - 1;
  g.issue(0, { type: 'hypersonic', x: 100, z: 75 }); steps(g, 0.1);
  assert.equal(g.sides[0].hypersonicCd, 0);
  assert.equal(g.strikes.length, 0);
});

test('rearmSpeed: air commander rearms aircraft faster (ai.js rearm reads the mod)', () => {
  const res = {};
  for (const c of ['air', 'steel']) {
    const g = battle(mk(c, 'steel'));
    const af = g.structures.find(s => s.side === 0 && s.type === 'airfield');
    const f = g.spawn(0, 'fighter_multi', af.x, af.z); f.ammo = 0;
    steps(g, 2);
    res[c] = f.ammo;
  }
  assert.ok(res.air > res.steel, JSON.stringify(res));
});

test('swarmRegen: swarm commander regrows drones', () => {
  const g = battle(mk('swarm', 'steel'));
  const sw = g.spawn(0, 'swarm_fpv', 40, 75);
  sw.swarm = 10; sw.hp = sw.perDrone * 10; sw.speed = 0;
  steps(g, 13);
  assert.ok(sw.swarm >= 12);
});

test('weather: rain reduces ground range, weather cycle changes weather', () => {
  const g = battle(mk('steel', 'air', { weather: 'rain', weatherCycle: 20 }));
  const t = g.spawn(0, 'tank_heavy', 40, 75);
  steps(g, 1);
  const r = effRange(g, t);
  assert.ok(r < t.range * 0.85);
  const ev = events(g, 'weather');
  steps(g, 30);
  assert.ok(ev.length >= 1);
});

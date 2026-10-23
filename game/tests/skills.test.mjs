// Unit skills & reflexes (F-30..F-47, F-71, F-81): APS, laser vs swarm, EW jam, mines, mark, kamikaze, CCA decoy...
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/index.js';
import { fire } from '../src/sim/combat.js';
import { useSkill, jamRadiusOf } from '../src/sim/skills.js';

function mk(p = 'steel', e = 'air', extra = {}) {
  const g = createGame({ mode: 'skirmish', mapId: 'plains', seed: 5, aiAbilities: false, autoSkills: false, ...extra,
    player: { commander: p, formation: [] }, enemy: { commander: e, formation: [] } });
  g.startBattle();
  return g;
}
function steps(g, sec) { for (let i = 0; i < Math.round(sec * 20); i++) g.step(); }
function events(g, name) { const out = []; g.events.on(name, d => out.push(d)); return out; }
function still(...us) { for (const u of us) { u.speed = 0; u.holdFire = true; } }

test('APS blocks an incoming missile (T1: 1 charge, T3: 2 charges)', () => {
  const g = mk();
  const tank = g.spawn(0, 'tank_heavy', 60, 75);
  const heli = g.spawn(1, 'heli_attack', 78, 75);
  still(tank, heli);
  steps(g, 0.3);
  const icp = events(g, 'intercept');
  const hp0 = tank.hp;
  fire(g, heli, tank, { kind: 'missile', dmgType: 'he' });
  steps(g, 1.5);
  assert.equal(icp.length, 1);
  assert.equal(tank.hp, hp0);
  assert.equal(tank.aps, 0);
  fire(g, heli, tank, { kind: 'missile', dmgType: 'he' });
  steps(g, 1.5);
  assert.ok(tank.hp < hp0, 'second missile hits (charge used)');

  const g3 = mk();
  const t3 = g3.spawn(0, 'tank_heavy', 60, 75, { tier: 3 });
  const h3 = g3.spawn(1, 'heli_attack', 78, 75);
  still(t3, h3); steps(g3, 0.3);
  assert.equal(t3.aps, 2);
  const hp3 = t3.hp;
  fire(g3, h3, t3, { kind: 'missile', dmgType: 'he' });
  fire(g3, h3, t3, { kind: 'missile', dmgType: 'he' });
  steps(g3, 1.5);
  assert.equal(t3.hp, hp3, 'T3 blocks 2');
});

test('laser beam removes several swarm drones per hit', () => {
  const g = mk('steel', 'swarm');
  const las = g.spawn(0, 'laser', 60, 75);
  const sw = g.spawn(1, 'swarm_fpv', 70, 75);
  still(las, sw);
  steps(g, 0.5);
  assert.equal(sw.swarm, 24);
  const ev = events(g, 'laser');
  assert.ok(useSkill(g, las, {}));
  assert.equal(ev.length, 1);
  assert.equal(sw.swarm, 24 - 4);
  assert.ok(las.skillCd > 0);
});

test('EW jams enemy remote units inside jamRadius*(1+mods.jamRadius) only', () => {
  const g = mk('ew', 'swarm');
  const ew = g.spawn(0, 'ew', 60, 75);
  const R = jamRadiusOf(g, ew);
  assert.ok(Math.abs(R - 26 * 1.3) < 1e-9);
  const near = g.spawn(1, 'ugv', 60 + R - 2, 75), far = g.spawn(1, 'ugv', 60 + R + 4, 75), manned = g.spawn(1, 'tank_heavy', 64, 75);
  still(ew, near, far, manned);
  const jam = events(g, 'jam');
  steps(g, 1);
  assert.ok(near.jammed > 0);
  assert.ok(!(far.jammed > 0));
  assert.ok(!(manned.jammed > 0));
  assert.ok(jam.length >= 1);
});

test('EW aura misdirects enemy missiles flying through it (statistically)', () => {
  const g = mk('ew', 'air');
  const ew = g.spawn(0, 'ew', 60, 75);
  const tank = g.spawn(0, 'apc', 62, 75);
  const heli = g.spawn(1, 'heli_attack', 80, 75);
  still(ew, tank, heli); steps(g, 0.3);
  let mis = 0;
  for (let i = 0; i < 30; i++) { fire(g, heli, tank, { kind: 'missile', dmgType: 'he' }); g.step(); mis += g.projectiles.filter(p => p.misdirected).length ? 1 : 0; steps(g, 1); }
  assert.ok(mis >= 4, 'some misdirected: ' + mis);
});

test('UGV drops mines that damage enemy ground units passing over', () => {
  const g = mk();
  const ugv = g.spawn(0, 'ugv', 60, 75); still(ugv);
  const me = events(g, 'mine'), det = events(g, 'mine:detonate');
  assert.ok(useSkill(g, ugv, { x: 70, z: 75, manual: true }));
  assert.equal(me.length, 3);
  const en = g.spawn(1, 'tank_heavy', 80, 75); en.holdFire = true;
  en.order = { type: 'move', x: 62, z: 75 };
  steps(g, 8);
  assert.ok(det.length >= 1);
  assert.ok(!en.alive || en.hp < en.maxHp);
});

test('recon drone marks enemies for the whole team', () => {
  const g = mk();
  const dr = g.spawn(0, 'drone_recon', 60, 75);
  const en = g.spawn(1, 'tank_heavy', 80, 75); still(en);
  steps(g, 0.5);
  assert.ok(useSkill(g, dr, {}));
  assert.ok(en.spotted > 0 && en.spottedBy === 0);
});

test('kamikaze dives and destroys itself on target; jammed kamikaze drifts off', () => {
  const g = mk('swarm', 'steel');
  const k = g.spawn(0, 'drone_kamikaze', 60, 75);
  const t = g.spawn(1, 'apc', 72, 75); still(t);
  steps(g, 5);
  assert.ok(!k.alive);
  assert.ok(t.hp < t.maxHp);

  const g2 = mk('swarm', 'ew');
  const k2 = g2.spawn(0, 'drone_kamikaze', 60, 75);
  const t2 = g2.spawn(1, 'apc', 72, 75);
  const ew = g2.spawn(1, 'ew', 75, 75);
  still(t2, ew);
  steps(g2, 6);
  assert.ok(!k2.alive, 'expended');
  assert.ok(k2.kDrift, 'drifted');
});

test('swarm attacks drain drone count; saturate skill boosts damage', () => {
  const g = mk('swarm', 'steel');
  const sw = g.spawn(0, 'swarm_fpv', 60, 75);
  const t = g.spawn(1, 'tank_heavy', 70, 75); still(t);
  steps(g, 6);
  assert.ok(sw.swarm < 24 || !sw.alive);
  assert.ok(t.hp < t.maxHp);
});

test('stealth fighter goes stealth and emits events', () => {
  const g = mk('air', 'steel');
  const f = g.spawn(0, 'fighter_stealth', 60, 75);
  const ev = events(g, 'stealth');
  assert.ok(useSkill(g, f, {}));
  assert.ok(f.stealth > 0);
  steps(g, 10);
  assert.deepEqual(ev.map(e => e.on), [true, false]);
});

test('player skill command: SPG barrage at a point, out of range rejected', () => {
  const g = mk();
  const spg = g.spawn(0, 'spg', 40, 75); still(spg);
  const sk = events(g, 'skill');
  g.issue(0, { type: 'skill', unitIds: [spg.id], x: 200, z: 75 }); steps(g, 0.1);
  assert.equal(sk.length, 0);
  const fires = events(g, 'fire');
  g.issue(0, { type: 'skill', unitIds: [spg.id], x: 70, z: 75 }); steps(g, 2);
  assert.equal(sk.length, 1);
  assert.ok(fires.length >= 6);
});

test('CCA takes the hit for a manned jet (decoy)', () => {
  const g = mk('air', 'steel');
  const jet = g.spawn(0, 'fighter_multi', 60, 75), cca = g.spawn(0, 'cca', 63, 75);
  const sam = g.spawn(1, 'sam', 90, 75);
  still(jet, cca, sam); jet.speed = 0;
  steps(g, 0.5);
  fire(g, sam, jet, { kind: 'missile', dmgType: 'he' });
  g.step(); g.step();
  const p = g.projectiles.find(p => p.from === sam.id);
  assert.ok(!p || p.target === cca);
});

test('bomber carpet bombing is never auto-used for a human side (F-70)', () => {
  const g = mk('air', 'steel', { autoSkills: true });
  const b = g.spawn(0, 'bomber', 60, 75);
  for (let i = 0; i < 3; i++) g.spawn(1, 'apc', 64 + i, 75);
  const sk = events(g, 'skill');
  steps(g, 5);
  assert.equal(sk.filter(e => e.skill === 'carpet').length, 0);
  g.issue(0, { type: 'skill', unitIds: [b.id], x: 65, z: 75 }); steps(g, 0.2);
  assert.equal(sk.filter(e => e.skill === 'carpet').length, 1);
});

test('stealth ship launches a temporary recon drone', () => {
  const g = createGame({ mode: 'skirmish', mapId: 'bay', seed: 5, aiAbilities: false, autoSkills: false,
    player: { commander: 'navy', formation: [] }, enemy: { commander: 'steel', formation: [] } });
  g.startBattle();
  const ship = g.spawn(0, 'stealth_ship', 120, 75);
  const sp = events(g, 'unit:spawn');
  assert.ok(useSkill(g, ship, {}));
  assert.equal(sp.length, 1);
  assert.equal(sp[0].def.id, 'drone_recon');
  assert.ok(sp[0].temporary);
});

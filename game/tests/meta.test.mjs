// Meta game: profile persistence (guarded localStorage), formation validation, missions, rewards, stats,
// skirmish enemy builder (F-04, F-52, F-82, F-83, F-110..F-114, F-170..F-172).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/core/profile.js';
import { createGame } from '../src/sim/index.js';
import { MAX_SLOTS, CP_LIMIT, UNITS } from '../src/data/units.js';
import { COMMANDER_IDS } from '../src/data/commanders.js';
import { ECON } from '../src/sim/economy.js';

function withStorage(fn) {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  try { return fn(store); } finally { delete globalThis.localStorage; P._clearCache(); }
}

test('profile works without localStorage (Node) and persists with it', () => {
  P._clearCache();
  const p0 = P.loadProfile();
  assert.equal(p0.gold, 1500);
  assert.equal(p0.missions.list.length, 3);
  withStorage(store => {
    P._clearCache();
    const p = P.loadProfile();
    p.gold = 4321; p.bossCleared.push('carrier');
    P.saveProfile(p);
    assert.ok(store.has('wargrid.profile.v1'));
    P._clearCache();
    const q = P.loadProfile();
    assert.equal(q.gold, 4321);
    assert.deepEqual(q.bossCleared, ['carrier']);
    assert.ok(q.stats && q.cosmetics, 'defaults merged');
  });
});

test('formation validation: 9 slots, CP limit, max 3 T3, budget, swarm = 1 slot', () => {
  const ok = [{ unit: 'tank_heavy', tier: 1, count: 2 }, { unit: 'apc', tier: 1, count: 1 }];
  assert.equal(P.validateFormation(ok).ok, true);
  const ten = Array.from({ length: 10 }, () => ({ unit: 'infantry', tier: 1, count: 1 }));
  assert.ok(P.validateFormation(ten).errors.some(e => e.includes('9 ô')));
  const cp = Array.from({ length: 9 }, () => ({ unit: 'heli_attack', tier: 1, count: 1 })); // 36 CP
  const v = P.validateFormation(cp);
  assert.ok(v.cp > CP_LIMIT && v.errors.some(e => e.includes('CP')));
  const t3 = Array.from({ length: 4 }, () => ({ unit: 'ugv', tier: 3, count: 1 }));
  assert.ok(P.validateFormation(t3).errors.some(e => e.includes('T3')));
  assert.equal(P.validateFormation(t3.slice(0, 3)).ok, true);
  const rich = [{ unit: 'sam', tier: 1, count: 1 }, { unit: 'iron_dome', tier: 1, count: 1 }, { unit: 'iron_dome', tier: 1, count: 1 }, { unit: 'tank_heavy', tier: 1, count: 1 }]; // 1.01 tỷ > budget
  assert.ok(P.validateFormation(rich).errors.some(e => e.includes('ngân sách')));
  assert.ok(P.addSlotReason([], { unit: 'destroyer', tier: 1, count: 1 }).includes('vay trước trận'), 'over-budget item locked with reason');
  assert.equal(P.slotCount({ unit: 'swarm_fpv', count: 5 }), 1, 'swarm is one slot');
  // F-52: 1 slot = 1 weapon for every unit; legacy counts are separate slots.
  for (const id of Object.keys(UNITS)) assert.equal(P.maxCount(id), 1, id);
  assert.equal(P.formationTotals([{ unit: 'tank_heavy', tier: 1, count: 2 }]).slots, 2);
  assert.equal(P.normalizeFormation([{ unit: 'tank_heavy', tier: 1, count: 3 }, { unit: 'swarm_fpv', count: 4 }]).length, 4);
  assert.ok(P.validateFormation(Array.from({ length: 5 }, () => ({ unit: 'ugv', tier: 1, count: 2 }))).errors.some(e => e.includes('9 ô')), '5 × 2 legacy = 10 weapons');
  assert.equal(P.slotPrice({ unit: 'swarm_fpv', tier: 1, count: 1 }), 500 * UNITS.swarm_fpv.swarmCount);
  assert.ok(P.addSlotReason(Array(MAX_SLOTS).fill({ unit: 'infantry', tier: 1, count: 1 }), { unit: 'ugv', tier: 1 }).includes('9'));
});

test('tier unlocks cost gold, T3 needs rare materials; formation tier must be unlocked', () => {
  const p = P.defaultProfile();
  const f = [{ unit: 'tank_heavy', tier: 2, count: 1 }];
  assert.ok(P.validateFormation(f, { profile: p }).errors.some(e => e.includes('T2')));
  assert.equal(P.upgradeUnitTier(p, 'tank_heavy').ok, true);
  assert.equal(P.unitTier(p, 'tank_heavy'), 2);
  assert.equal(P.validateFormation(f, { profile: p }).ok, true);
  p.gold = 99999;
  const r = P.upgradeUnitTier(p, 'tank_heavy');
  assert.equal(r.ok, false); assert.ok(r.reason.includes('vật liệu'));
  p.rareMaterials = 2;
  assert.equal(P.upgradeUnitTier(p, 'tank_heavy').ok, true);
  assert.equal(p.rareMaterials, 1);
  assert.ok(!P.isUnitUnlocked(p, 'bomber'));
  assert.equal(P.unlockUnit(p, 'bomber').ok, true);
  assert.ok(P.unlockUnitReason(p, 'carrier').includes('boss'));
});

test('recommended formations always satisfy the rules for every commander', () => {
  for (const c of COMMANDER_IDS) {
    const { formation, skipped } = P.recommendedFormation(c);
    const v = P.validateFormation(formation);
    assert.ok(v.ok, c + ': ' + v.errors.join('; '));
    assert.ok(formation.length > 0);
    if (c === 'navy') assert.ok(skipped.some(s => s.unit === 'destroyer'), 'ships over 1 tỷ are skipped');
  }
});

test('skirmish enemy counters the player and scales with rating + learned data', () => {
  const p = P.defaultProfile();
  p.learned = { matches: 3, orders: { flank: 9, capture: 4, attack: 2, sead: 1 }, unitMix: { air: 6, tank: 2 } };
  const player = { commander: 'air', formation: P.recommendedFormation('air').formation };
  const e = P.buildSkirmishEnemy(p, player, 'plains', 4);
  assert.equal(e.commander, 'ew');
  assert.equal(e.ai, true);
  assert.ok(e.formation.some(s => ['iron_dome', 'sam', 'fighter_multi'].includes(s.unit)), 'anti-air counter present');
  assert.ok(P.validateFormation(e.formation).ok);
  assert.deepEqual(e.learned.preferredOrders, ['flank', 'capture', 'attack']);
  assert.ok(e.learned.unitMix.air > e.learned.unitMix.tank);
  assert.ok(e.difficulty < P.difficultyFromRating(1600));
  p.rating = 1700;
  const hard = P.buildSkirmishEnemy(p, player, 'plains', 4);
  assert.ok(hard.formation.filter(s => s.tier === 3).length <= 3);
  assert.ok(hard.formation.some(s => s.tier > 1));
});

test('match result: rewards, stats per commander/unit, missions, learned data, boss unlocks', () => {
  const p = P.defaultProfile();
  const d = new Date(2026, 9, 23);
  P.ensureDailyMissions(p, d);
  p.missions.list = [{ id: 'cap5', progress: 3, done: false }, { id: 'win_swarm', progress: 0, done: false }, { id: 'play3', progress: 0, done: false }];
  const s = { mode: 'skirmish', mapId: 'plains', commander: 'swarm', formation: [{ unit: 'swarm_fpv', tier: 1, count: 1 }, { unit: 'ugv', tier: 1, count: 2 }],
    won: true, reason: 'x', duration: 500, kills: 10, lost: 2, structures: 1, captures: 2, orders: { flank: 2, capture: 3 } };
  const g0 = p.gold;
  const r = P.applyMatchResult(p, s, d);
  assert.ok(r.gold > 0 && p.gold === g0 + r.gold);
  assert.equal(p.stats.byCommander.swarm.won, 1);
  assert.equal(p.stats.byUnit.ugv.played, 1);
  assert.equal(P.winRate(p.stats.byUnit.ugv), 1);
  assert.ok(r.missions.find(m => m.text.startsWith('Chiếm 5')).done, 'capture mission completed');
  assert.ok(r.missions.find(m => m.text.includes('Drone')).justDone);
  assert.equal(p.learned.orders.flank, 2);
  assert.equal(p.rating, 1020);
  // Boss progress → next chapter, then ghost unlock
  assert.equal(P.ghostUnlocked(p), false);
  assert.equal(P.bossUnlocked(p, 'aa_fortress'), false);
  for (const b of ['carrier', 'aa_fortress', 'strategic_sub', 'ai_city_core']) {
    const rb = P.applyMatchResult(p, { ...s, mode: 'boss', boss: b, won: true }, d);
    assert.equal(rb.bossCleared, b);
    assert.ok(rb.rare > 0);
  }
  assert.equal(P.bossUnlocked(p, 'aa_fortress'), true);
  assert.equal(P.ghostUnlocked(p), true);
});

test('daily missions: 3 per day, deterministic, change with the day', () => {
  const p = P.defaultProfile();
  const a = P.ensureDailyMissions(p, new Date(2026, 9, 23)).map(m => m.id);
  assert.equal(a.length, 3);
  assert.equal(new Set(a).size, 3);
  const q = P.defaultProfile();
  assert.deepEqual(P.ensureDailyMissions(q, new Date(2026, 9, 23)).map(m => m.id), a);
  const b = P.ensureDailyMissions(p, new Date(2026, 9, 24)).map(m => m.id);
  assert.notDeepEqual(b, a.length ? null : []);
});

test('cosmetics bought with badges only, battle pass claims', () => {
  const p = P.defaultProfile();
  assert.equal(P.buySkin(p, 'jungle').ok, false);
  p.badges = 15;
  assert.equal(P.buySkin(p, 'jungle').ok, true);
  assert.equal(p.cosmetics.skin, 'jungle');
  assert.equal(p.gold, 1500, 'gold untouched');
  p.cosmetics.passXp = 650;
  assert.equal(P.passLevel(p), 2);
  assert.equal(P.buyPremium(p).ok, true);
  const got = P.claimPass(p);
  assert.equal(got.length, 4);
  assert.equal(P.claimPass(p).length, 0);
});

test('summarizeMatch reads a real game (commandLog orders, captures counter)', () => {
  const g = createGame({ mode: 'skirmish', mapId: 'plains', seed: 1,
    player: { commander: 'steel', formation: [{ unit: 'tank_heavy', tier: 1, count: 1 }] },
    enemy: { commander: 'air', ai: true, formation: [{ unit: 'apc', tier: 1, count: 1 }] } });
  g.issue(0, { type: 'autodeploy' }); g.issue(0, { type: 'ready' });
  for (let i = 0; i < 20; i++) g.step();
  g.issue(0, { type: 'order', unitIds: g.sideUnits(0).map(u => u.id), order: 'capture', x: 70, z: 26 });
  for (let i = 0; i < 5; i++) g.step();
  g.events.emit('capture', { sp: g.strongpoints[0], side: 0 });
  const s = P.summarizeMatch(g, 0);
  assert.equal(s.orders.capture, 1);
  assert.equal(s.captures, 1);
  assert.equal(s.commander, 'steel');
});

// ---------------------------------------------------------------- DOM-less smoke test of the screens
// A tiny DOM stub: innerHTML strings are evaluated (template errors surface), querySelector returns cached stubs
// so the test can fire the same onclick handlers the screens attach.
class Stub {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this._q = new Map(); this.dataset = {}; this.style = {}; this.isConnected = false; this.className = ''; this._html = '';
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false }; }
  set innerHTML(v) { this._html = String(v); this.children = []; this._q.clear(); }
  get innerHTML() { return this._html; }
  appendChild(c) { this.children.push(c); return c; }
  append(...c) { this.children.push(...c); }
  remove() {}
  querySelector(s) { if (!this._q.has(s)) { const q = new Stub(); q.value = ''; this._q.set(s, q); } return this._q.get(s); }
  querySelectorAll() { return []; }
  setAttribute() {}
  addEventListener() {}
}
function installDom() {
  const ids = new Map();
  globalThis.document = {
    getElementById: id => { if (!ids.has(id)) ids.set(id, new Stub()); return ids.get(id); },
    createElement: t => new Stub(t), querySelector: () => null, querySelectorAll: () => [],
  };
  globalThis.requestAnimationFrame = () => 0;
  return ids;
}

test('screens smoke: menu → commander → formation → map → startMatch opts; boss, ghost, profile, result', async () => {
  const ids = installDom();
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  P._clearCache();
  try {
    const S = await import('../src/ui/screens.js');
    const app = { startMatch(o) { this.started = o; return {}; }, leaveMatch() { this.left = true; } };
    const cur = () => ids.get('screens').children[0];
    S.showScreen(app, 'main');
    assert.ok(cur().innerHTML.includes('WARGRID: Chỉ Huy AI'));
    assert.ok(cur().innerHTML.includes('id="btn-ghost"') && cur().innerHTML.includes('ghost-lock-reason'), 'ghost locked with reason');
    cur().querySelector('#btn-quick').onclick();
    assert.equal(cur().dataset.screen, 'commander');
    assert.ok(cur().innerHTML.includes('Phó tướng — sắp ra mắt'));
    cur().querySelector('#btn-next').onclick();
    assert.equal(cur().dataset.screen, 'formation');
    assert.ok(cur().innerHTML.includes('tot-cp'));
    cur().querySelector('#btn-recommend').onclick();
    cur().querySelector('#btn-next').onclick();
    assert.equal(cur().dataset.screen, 'map');
    assert.ok(cur().innerHTML.includes('data-map="bay"'));
    cur().querySelector('#btn-start').onclick();
    const o = app.started;
    assert.equal(o.mode, 'skirmish');
    assert.ok(o.player.formation.length > 0 && o.player.formation.every(s => s.unit && s.tier && s.count));
    assert.equal(o.enemy.ai, true);
    assert.ok(typeof o.enemy.difficulty === 'number' && o.enemy.learned);
    assert.ok(P.getProfile().lastFormation.steel, 'formation persisted per commander');
    assert.equal(o.player.money, 1e9 - P.formationTotals(o.player.formation).price, 'formation paid from start money');
    assert.ok(Array.isArray(o.player.loans) && typeof o.enemy.money === 'number');
    // createGame accepts it
    const g = createGame(o);
    assert.equal(g.sides[0].formation.length, o.player.formation.length);
    // Navy: "Đề xuất" no longer borrows 2 tỷ for a destroyer it cannot repay (QA #2); a manual pre-match loan
    // still flows into opts.player.loans.
    S.showScreen(app, 'main'); cur().querySelector('#btn-quick').onclick();
    app.pre.commander = 'navy'; app.pre.formation = null;
    S.showScreen(app, 'formation');
    assert.ok(cur().innerHTML.includes('id="preloan"'));
    assert.ok(!app.pre.formation.some(s => s.unit === 'destroyer'), 'no unrepayable destroyer loan');
    app.pre.loan = 500_000_000; S.showScreen(app, 'formation');
    assert.ok(cur().innerHTML.includes('tot-debt'));
    cur().querySelector('#btn-next').onclick(); cur().querySelector('#btn-start').onclick();
    assert.equal(app.started.player.loans.length, 1);
    assert.ok(app.started.player.money >= 0);
    const gn = createGame(app.started);
    assert.equal(gn.sides[0].loans[0].principal, app.pre.loan);
    // Boss flow
    S.showScreen(app, 'boss');
    assert.ok(cur().innerHTML.includes('Tàu sân bay di động'));
    app.pre.mode = 'boss'; app.pre.bossId = 'carrier';
    S.showScreen(app, 'formation');
    cur().querySelector('#btn-next').onclick();
    assert.equal(app.started.mode, 'boss');
    assert.equal(app.started.boss, 'carrier');
    assert.equal(app.started.mapId, 'bay');
    assert.equal(app.started.enemy.ai, false);
    // Ghost (unlock first)
    const p = P.getProfile(); p.bossCleared = ['carrier', 'aa_fortress', 'strategic_sub', 'ai_city_core'];
    S.showScreen(app, 'ghost');
    assert.ok(cur().innerHTML.includes('ghost-card'));
    const { loadPool } = await import('../src/sim/ghost.js');
    app.pre.mode = 'ghost'; app.pre.ghost = loadPool()[0];
    S.showScreen(app, 'formation');
    cur().querySelector('#btn-next').onclick();
    assert.equal(app.started.mode, 'ghost');
    assert.ok(app.started.ghost.commandLog.length);
    assert.equal(P.ghostFightsToday(P.getProfile(), app.pre.ghost.id), 1);
    // Profile + settings
    S.showScreen(app, 'profile');
    assert.ok(cur().innerHTML.includes('Battle pass'));
    S.showScreen(app, 'settings');
    // Result: win a skirmish -> snapshot saved to the pool
    const g2 = createGame({ ...o, seed: 3 });
    g2.issue(0, { type: 'autodeploy' }); for (let i = 0; i < 40; i++) g2.step();
    g2.end(0, 'Thử nghiệm');
    const match = { game: g2, opts: o, side: 0 };
    const before = loadPool().length;
    S.showScreen(app, 'result', { result: g2.ended, match });
    assert.ok(cur().innerHTML.includes('CHIẾN THẮNG') && cur().innerHTML.includes('btn-replay'));
    assert.equal(loadPool().length, before + 1);
    S.showScreen(app, 'result', { result: g2.ended, match });   // idempotent
    assert.equal(loadPool().length, before + 1);
    cur().querySelector('#btn-menu').onclick();
    assert.ok(app.left);
  } finally { delete globalThis.localStorage; delete globalThis.document; delete globalThis.requestAnimationFrame; P._clearCache(); }
});

test('tutorial: steps 2–11 advance on the real player actions (deploy, ready, select, order, capture)', async () => {
  installDom();
  Stub.prototype.getBoundingClientRect = function () { return { left: 10, top: 10, width: 60, height: 40 }; };
  globalThis.document.querySelector = () => new Stub();
  globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible' });
  globalThis.window = { innerWidth: 1280, innerHeight: 720 };
  P._clearCache();
  try {
    const T = await import('../src/ui/tutorial.js');
    const opts = T.tutorialMatchOpts();
    assert.equal(opts.mode, 'tutorial'); assert.equal(opts.mapId, 'plains'); assert.equal(opts.player.commander, 'steel'); assert.equal(opts.enemy.difficulty, 0.4);
    const g = createGame(opts);
    const m = { game: g, side: 0, running: true, selected: new Set(), pendingDeploy: null, pendingOrder: null,
      R: { toScreen: (x, y, z) => ({ x: x * 4, y: z * 4, onScreen: true }), focus() {} }, hud: { toast() {} } };
    const app = { match: m };
    const tut = new T.Tutorial(app, m).start();
    const id = () => tut.steps[tut.i].id;
    const frame = () => tut.loop(performance.now());
    assert.equal(id(), 'slot');
    m.pendingDeploy = 0; frame();
    assert.equal(id(), 'zone');
    m.pendingDeploy = null;
    g.events.emit('deploy:placed', { slot: 0 });
    g.issue(0, { type: 'deploy', slot: 0, x: 30, z: 75 }); g.step();      // emits 'deployed'
    assert.equal(id(), 'ready');
    g.issue(0, { type: 'autodeploy' }); g.issue(0, { type: 'ready' }); g.step();   // emits 'phase' battle
    assert.equal(id(), 'select');
    const tank = tut.myTank(); assert.ok(tank && tank.def.id === 'tank_heavy');
    m.selected.add(tank.id); g.events.emit('selection', [tank.id]);
    assert.equal(id(), 'cmd');
    m.pendingOrder = 'capture'; g.events.emit('pending', 'capture');
    assert.equal(id(), 'sp');
    assert.ok(tut.sp && tut.sp.owner !== 0, 'nearest non-owned strongpoint picked');
    g.events.emit('order:ui', { type: 'capture', x: tut.sp.x, z: tut.sp.z });
    assert.equal(id(), 'capture');
    g.events.emit('capture', { sp: tut.sp, side: 0 });
    assert.equal(id(), 'shop');
    tut.next(); assert.equal(id(), 'camera');
    tut.next(); assert.equal(id(), 'ultimate');
    frame();
    tut.next();
    assert.equal(tut.alive, false, 'finished');
    assert.equal(P.getProfile().tutorialDone, true);
    // deploy timer is held during deploy steps
    const g2 = createGame(opts); const m2 = { ...m, game: g2, selected: new Set() }; app.match = m2;
    const t2 = new T.Tutorial(app, m2).start();
    g2.phaseTime = 3; t2.loop(performance.now());
    assert.ok(g2.phaseTime >= 15);
    t2.finish(false);
  } finally { delete globalThis.document; delete globalThis.window; delete globalThis.getComputedStyle; delete globalThis.requestAnimationFrame; P._clearCache(); }
});

// ---------------------------------------------------------------- pre-match loans + formation money (GDD §15)
test('formation is paid from the 1 tỷ start money; recommendations keep 10% cash and only take repayable loans', () => {
  const f = P.recommendedFormation('steel').formation;
  const eco = P.playerEconomy(f);
  assert.equal(eco.money, 1e9 - P.formationTotals(f).price);
  assert.deepEqual(eco.loans, []);
  for (const c of COMMANDER_IDS) {
    const r = P.recommendWithLoan(c);
    const price = P.formationTotals(r.formation).price, budget = P.budgetFor(r.loan);
    assert.ok(budget - price >= 1e9 * P.RECOMMEND.reserve - 1, `${c} keeps ≥10% cash (${budget - price})`);
    if (r.loan) assert.ok(P.loanRepayable(r.loan, budget - price, price), `${c} loan repayable`);
  }
  assert.equal(P.loanRepayable(2_000_000_000, 100_000_000, 2_900_000_000), false, '2 tỷ for a destroyer is not repayable');
  const navy = P.recommendWithLoan('navy', { mapId: 'plains' });
  assert.ok(!navy.formation.some(s => ['sea', 'sub'].includes(UNITS[s.unit].layer)), 'no ships on a map without sea');
  // Manual pre-match loan: same shape as the in-match loan.
  const e2 = P.playerEconomy(navy.formation, 500_000_000);
  assert.equal(e2.loans.length, 1);
  const L = e2.loans[0];
  assert.deepEqual(Object.keys(L).filter(k => ['principal', 'rate', 'owed', 'due'].includes(k)).sort(), ['due', 'owed', 'principal', 'rate']);
  assert.equal(L.owed, Math.round(500_000_000 * 1.12));
  assert.equal(e2.money, 1e9 + 500_000_000 - P.formationTotals(navy.formation).price);
  assert.equal(P.recommendWithLoan('steel').loan, 0, 'no loan when not needed');
  const enemy = P.buildSkirmishEnemy(P.defaultProfile(), { commander: 'steel', formation: f }, 'plains', 1);
  assert.equal(enemy.money, 1e9 - P.formationTotals(enemy.formation).price);
  assert.ok(enemy.money >= 1e8 - 1, 'AI enemy keeps battle cash too');
});

function loanGame(money, loan) {
  const f = [{ unit: 'tank_heavy', tier: 1, count: 2 }, { unit: 'apc', tier: 1, count: 1 }];
  const eco = P.playerEconomy(f, loan);
  const g = createGame({ mode: 'skirmish', mapId: 'plains', seed: 11,
    player: { commander: 'steel', formation: f, ...eco, money: money ?? eco.money },
    enemy: { commander: 'air', ai: false, formation: [], money: 1e9 } });   // passive enemy: isolate the loan logic
  g.issue(0, { type: 'autodeploy' });
  g.issue(1, { type: 'ready' }); g.issue(0, { type: 'ready' });
  return g;
}

test('pre-match loan: due at absolute game.time (deploy + 480 s), repaid when money is enough', () => {
  const g = loanGame(undefined, 500_000_000);
  const L = g.sides[0].loans[0];
  assert.equal(L.due, 30 + 480);
  const ev = [];
  g.events.on('loan:repaid', e => ev.push({ t: g.time, e }));
  while (g.time < L.due - 1 && !g.ended) g.step();
  assert.equal(ev.length, 0, 'not settled before due');
  assert.equal(g.sides[0].loans.length, 1);
  const m0 = g.sides[0].money;
  for (let i = 0; i < 60 && !g.ended; i++) g.step();
  assert.ok(ev.length === 1 && ev[0].e.forced, 'repaid at due time');
  assert.equal(g.sides[0].loans.length, 0);
  assert.ok(g.sides[0].money < m0 - 500_000_000, 'owed amount paid');
});

test('pre-match loan: not enough money at due → liquidation (and bankrupt if still short)', () => {
  const g = loanGame(0, 2_000_000_000);
  const liq = []; let bankrupt = false;
  g.events.on('liquidation', e => liq.push(e));
  g.events.on('bankrupt', () => { bankrupt = true; });
  const due = g.sides[0].loans[0].due;
  while (g.time < due + 3 && !g.ended) g.step();
  assert.ok(liq.length > 0 || g.ended, 'units liquidated to pay the debt');
  assert.ok(bankrupt || g.sides[0].bankrupt || g.ended, '2.24 tỷ debt cannot be covered → bankrupt / defeat');
});

// ---------------------------------------------------------------- F-178 / F-173: USDT + debt carried between matches
test('meta money: win reward pays debt first and the rest carries over; loss carries unpaid loans as debt', () => {
  const p = P.defaultProfile();
  assert.equal(p.usdt, 0); assert.equal(p.debt, 0);
  const d = new Date(2026, 9, 23);
  const base = { mode: 'skirmish', mapId: 'plains', commander: 'steel', formation: [{ unit: 'tank_heavy', tier: 1, count: 1 }], kills: 0, orders: {} };
  p.debt = 100_000_000;
  const r1 = P.applyMatchResult(p, { ...base, won: true, usdtReward: 500_000_000, matchDebt: 112_000_000 }, d);
  assert.equal(r1.usdt.debtPaid, 212_000_000);
  assert.equal(p.debt, 0);
  assert.equal(p.usdt, 288_000_000);
  assert.equal(P.metaBudget(p), 1_288_000_000);
  // Entering the next match moves the carried USDT into its budget.
  const m = P.commitMetaBudget(p);
  assert.equal(m.base, 1_288_000_000); assert.equal(p.usdt, 0);
  // Loss with an unpaid 500tr pre-match loan (560tr with interest): consolation pays a little, the rest is debt.
  const r2 = P.applyMatchResult(p, { ...base, won: false, usdtReward: 50_000_000, matchDebt: 560_000_000 }, d);
  assert.equal(p.debt, 510_000_000);
  assert.equal(p.usdt, 0);
  assert.equal(r2.usdt.debt, 510_000_000);
  assert.equal(P.metaBudget(p), 490_000_000, 'next budget = 1 tỷ − debt');
  assert.ok(!P.validateFormation([{ unit: 'sam', tier: 1, count: 1 }], { budget: P.budgetFor(0, P.metaBudget(p)) }).ok, 'debt shrinks the formation');
  // Debt larger than the whole budget: budget 0 (never negative), the excess stays.
  p.debt = 1_500_000_000;
  assert.equal(P.metaBudget(p), 0);
  const m2 = P.commitMetaBudget(p);
  assert.equal(m2.base, 0); assert.equal(m2.debtPaid, 1_000_000_000); assert.equal(p.debt, 500_000_000);
  assert.equal(P.playerEconomy([], 0, m2.base).money, 0);
  // Tutorial never touches meta money.
  const before = { usdt: p.usdt, debt: p.debt };
  P.applyMatchResult(p, { ...base, mode: 'tutorial', won: true }, d);
  assert.deepEqual({ usdt: p.usdt, debt: p.debt }, before);
});

test('meta money: a real match end exposes the win reward and unpaid loans to summarizeMatch', () => {
  const f = [{ unit: 'tank_heavy', tier: 1, count: 1 }];
  const g = createGame({ mode: 'skirmish', mapId: 'plains', seed: 3,
    player: { commander: 'steel', formation: f, ...P.playerEconomy(f, 200_000_000) },
    enemy: { commander: 'air', ai: false, formation: [] } });
  g.startBattle();
  g.issue(1, { type: 'surrender' });
  for (let i = 0; i < 10 && !g.ended; i++) g.step();
  assert.equal(g.ended.winner, 0);
  const s = P.summarizeMatch(g, 0);
  assert.equal(s.usdtReward, ECON.winReward);
  assert.equal(s.matchDebt, Math.round(200_000_000 * (1 + ECON.loanRate)));
  const p = P.defaultProfile();
  P.applyMatchResult(p, s, new Date(2026, 9, 23));
  assert.equal(p.usdt, ECON.winReward - s.matchDebt);
  assert.equal(p.debt, 0);
});

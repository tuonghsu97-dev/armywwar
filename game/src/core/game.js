// Game = one match. Pure simulation (no Three.js here) so it can run headless for tests and ghost replays.
//
// CONTRACT for modules (sim/*.js):
//  - A system is { name, init?(game), update(game, dt) } registered with game.addSystem(sys, order).
//    Lower order runs first. Reserved orders: 10 ai, 20 skills/commanders, 30 transport, 40 movement,
//    50 combat, 60 capture, 70 economy, 80 vision, 90 victory, 95 boss/ghost.
//  - Player/AI input never mutates state directly: call game.issue(side, cmd). Commands are applied at
//    the start of the next tick and recorded in game.commandLog (tick-stamped) for ghost battles/replays.
//  - Register a command type with game.onCommand(type, (game, side, cmd) => boolean). Return false to reject.
//  - Emit events through game.events (render/UI listen). Common events: 'unit:spawn', 'unit:death',
//    'fire' {from,to,proj}, 'explosion' {x,z,r,type}, 'capture' {sp, side}, 'toast' {side,text},
//    'phase' {phase}, 'end' {winner, reason}.
import { Events } from './events.js';
import { RNG } from './rng.js';
import { buildMap, cellAt } from '../data/maps.js';
import { Unit } from '../sim/unit.js';
import { expandFormation } from '../data/units.js';

export const TICK = 1 / 20;
export const DEPLOY_TIME = 30;      // GDD §2: 30 s deployment
export const MATCH_LIMIT = 3600;    // GDD §13: 1 hour max
export const START_MONEY = 1_000_000_000; // GDD §15
export const START_TROOPS = 2000;   // GDD §14

export class Game {
  constructor(opts) {
    this.opts = opts;
    this.mode = opts.mode || 'skirmish';          // 'skirmish' | 'boss' | 'ghost' | 'tutorial'
    this.seed = opts.seed ?? 12345;
    this.rng = new RNG(this.seed);
    this.events = new Events();
    this.map = buildMap(opts.mapId || 'plains');
    this.tick = 0;
    this.time = 0;
    this.phase = 'deploy';
    this.phaseTime = DEPLOY_TIME;
    this.timeScale = 1;
    this.paused = false;
    this.ended = null;
    this.units = new Map();
    this.nextId = 1;
    this.projectiles = [];
    this.systems = [];
    this.commandQueue = [];
    this.commandLog = [];
    this.commandHandlers = new Map();
    this.weather = opts.weather || this.map.weather || 'clear';
    this.sides = [0, 1].map(i => this.makeSide(i, i === 0 ? opts.player : opts.enemy));
    this.structures = this.map.structures.map(s => ({ ...s, maxHp: s.hp, alive: true, kind: 'structure', cooldown: 0 }));
    this.strongpoints = this.map.strongpoints.map(sp => ({ ...sp, owner: -1, progress: 0, capturer: -1, contested: false, held: [0, 0] }));
    this.grid = new SpatialHash(8);
  }

  makeSide(i, cfg = {}) {
    return {
      id: i,
      name: cfg.name || (i === 0 ? 'Phe Xanh' : 'Phe Đỏ'),
      ai: !!cfg.ai,
      commander: cfg.commander || 'steel',
      // [{unit, tier, count: 1}] — 1 slot = 1 weapon (F-52); legacy {count: n} entries are expanded into n slots.
      formation: expandFormation(cfg.formation || []).map((s, k) => ({ ...s, slot: k, deployed: false })),
      money: cfg.money ?? START_MONEY,
      loans: [],                 // [{principal, rate, due (game time s), owed}]
      troops: { reserve: cfg.troops ?? START_TROOPS, active: 0, dead: 0, recruiting: [] },
      mobilized: false,
      cp: 30, cpMax: 100,        // command points (match resource, GDD §2 step 5)
      score: 0,                  // occupation score (GDD §13)
      surrendered: false,
      ultimateCd: 0, hypersonicCd: 0,
      mods: {},                  // filled by commander passive
      stats: { kills: 0, lost: 0, damage: 0, structures: 0 },
      color: cfg.skinColor ?? (i === 0 ? 0x3f8cff : 0xff4a3d), // cosmetic skin only (F-113)
      ...(cfg.loans ? { loans: cfg.loans.map(l => ({ ...l })) } : {}), // pre-match loans (GDD §15 "vay thêm")
    };
  }

  addSystem(sys, order = 50) {
    sys.order = order;
    this.systems.push(sys);
    this.systems.sort((a, b) => a.order - b.order);
    if (sys.init) sys.init(this);
  }
  onCommand(type, fn) { this.commandHandlers.set(type, fn); }

  issue(side, cmd) { this.commandQueue.push({ side, cmd }); }

  applyCommands() {
    const q = this.commandQueue; this.commandQueue = [];
    for (const { side, cmd } of q) {
      const h = this.commandHandlers.get(cmd.type);
      if (!h) { console.warn('No handler for command', cmd.type); continue; }
      const ok = h(this, side, cmd);
      if (ok !== false) this.commandLog.push({ tick: this.tick, side, cmd: JSON.parse(JSON.stringify(cmd)) });
    }
  }

  step() {
    if (this.ended || this.paused) return;
    this.applyCommands();
    const dt = TICK;
    this.tick++;
    this.time += dt;
    if (this.phase === 'deploy') {
      this.phaseTime -= dt;
      if (this.phaseTime <= 0) this.startBattle();
    }
    this.grid.clear();
    for (const u of this.units.values()) if (u.alive) this.grid.insert(u);
    for (const s of this.systems) s.update(this, dt);
    this.cleanup();
  }

  startBattle() {
    if (this.phase !== 'deploy') return;
    this.phase = 'battle';
    this.battleStart = this.time;
    this.events.emit('phase', { phase: 'battle' });
  }

  get battleTime() { return this.phase === 'battle' ? this.time - this.battleStart : 0; }

  spawn(side, unitId, x, z, opts = {}) {
    const u = new Unit(this, this.nextId++, side, unitId, x, z, opts);
    this.units.set(u.id, u);
    if (u.def.crew && !opts.noCrew) {
      const t = this.sides[side].troops;
      const n = Math.min(u.def.crew, t.reserve);
      t.reserve -= n; t.active += n; u.crew = n;
    }
    this.events.emit('unit:spawn', u);
    return u;
  }

  kill(u, killer) {
    if (!u.alive) return;
    u.alive = false;
    u.hp = 0;
    const side = this.sides[u.side];
    side.stats.lost++;
    // Crew & carried troops die with the vehicle (most of them).
    const t = side.troops;
    const lost = (u.crew || 0) + (u.cargo || 0) + (u.def.id === 'infantry' ? u.soldiers : 0); // infantry: only the survivors left
    t.active = Math.max(0, t.active - lost);
    t.dead += lost;
    if (killer != null && killer >= 0) this.sides[killer].stats.kills++;
    this.events.emit('unit:death', { unit: u, killer });
  }

  // Central damage function. Combat, skills, ultimates all go through here so counters/armor/mods apply once.
  damage(target, amount, dmgType, source) {
    if (!target.alive) return 0;
    if (target.kind === 'structure') return this.damageStructure(target, amount, dmgType, source);
    let dmg = amount;
    const hook = this.damageHooks;
    if (hook) for (const fn of hook) dmg = fn(this, target, dmg, dmgType, source);
    if (dmg <= 0) return 0;
    target.hp -= dmg;
    target.lastHitTime = this.time;
    target.lastAttacker = source ? source.id : null;
    if (source && source.side != null) this.sides[source.side].stats.damage += dmg;
    if (target.def.id === 'infantry') {
      // Soldiers scale with HP; casualties leave the active troop count right away (F-163).
      const before = target.soldiers;
      target.soldiers = Math.max(0, Math.min(before, Math.ceil(target.squadSize * target.hp / target.maxHp)));
      const lost = before - target.soldiers;
      if (lost > 0) { const t = this.sides[target.side].troops; t.active = Math.max(0, t.active - lost); t.dead += lost; }
    }
    if (target.hp <= 0) this.kill(target, source ? source.side : null);
    return dmg;
  }
  addDamageHook(fn) { (this.damageHooks ||= []).push(fn); }

  damageStructure(s, amount, dmgType, source) {
    let dmg = amount * (1 - s.armor * 0.6) * (this.structureDmgMult || 1); // structureDmgMult: decisive phase (sim/victory.js)
    if (source && source.side != null) {
      const m = this.sides[source.side].mods.structureDmg || 0;
      dmg *= 1 + m;
    }
    s.hp -= dmg;
    if (s.hp <= 0 && s.alive) {
      s.alive = false; s.hp = 0;
      if (source && source.side != null) { this.sides[source.side].stats.structures++; this.sides[source.side].score += s.type === 'hq' ? 0 : 200; }
      this.events.emit('structure:destroyed', { structure: s, by: source ? source.side : null });
    }
    return dmg;
  }

  cleanup() {
    if (this.tick % 40 !== 0) return;
    for (const [id, u] of this.units) if (!u.alive && this.time - (u.deathTime ??= this.time) > 3) this.units.delete(id);
  }

  unitsNear(x, z, r, filter) {
    const out = [];
    this.grid.query(x, z, r, u => {
      if (!u.alive) return;
      const d2 = (u.x - x) ** 2 + (u.z - z) ** 2;
      if (d2 <= r * r && (!filter || filter(u))) out.push(u);
    });
    return out;
  }
  structuresNear(x, z, r, filter) {
    return this.structures.filter(s => s.alive && (s.x - x) ** 2 + (s.z - z) ** 2 <= r * r && (!filter || filter(s)));
  }
  hq(side) { return this.structures.find(s => s.type === 'hq' && s.side === side); }
  sideUnits(side) { return [...this.units.values()].filter(u => u.alive && u.side === side); }
  cell(x, z) { return cellAt(this.map, x, z); }
  end(winner, reason) {
    if (this.ended) return;
    this.ended = { winner, reason, time: this.time };
    this.phase = 'ended';
    this.events.emit('end', this.ended);
  }
}

class SpatialHash {
  constructor(size) { this.size = size; this.cells = new Map(); }
  clear() { this.cells.clear(); }
  key(cx, cz) { return cx * 4096 + cz; }
  insert(u) {
    const k = this.key(Math.floor(u.x / this.size), Math.floor(u.z / this.size));
    let c = this.cells.get(k); if (!c) this.cells.set(k, c = []);
    c.push(u);
  }
  query(x, z, r, fn) {
    const s = this.size;
    for (let cx = Math.floor((x - r) / s); cx <= Math.floor((x + r) / s); cx++)
      for (let cz = Math.floor((z - r) / s); cz <= Math.floor((z + r) / s); cz++) {
        const c = this.cells.get(this.key(cx, cz));
        if (c) for (const u of c) fn(u);
      }
  }
}

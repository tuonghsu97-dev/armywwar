// Unit entity. Plain data + small helpers; behaviour lives in systems (ai, movement, combat, skills...).
import { unitDef, tierStats, LAYER_HEIGHT, accessoryMods } from '../data/units.js';

// Apply the stat part of T2/T3 accessories (F-81) when a unit goes from accessory set `from` to `to`
// (constructor: {} -> mods; economy.retier: old tier mods -> new tier mods). Behaviour mods are read via u.acc.
export function applyAccessories(u, from = {}, to = {}) {
  const ratio = k => (to[k] || 1) / (from[k] || 1);
  u.sight *= ratio('sightMult');
  u.range *= ratio('rangeMult');
  const dAmmo = (to.ammoAdd || 0) - (from.ammoAdd || 0);
  if (dAmmo && u.maxAmmo !== Infinity) { u.maxAmmo += dAmmo; u.ammo = Math.max(0, u.ammo + dAmmo); }
  if (u.maxEnergy) { const r = ratio('energyMult'); u.maxEnergy *= r; u.energy *= r; }
  u.armor = Math.min(0.85, Math.max(0, u.armor + (to.armorAdd || 0) - (from.armorAdd || 0)));
  u.acc = to;
}

export class Unit {
  constructor(game, id, side, unitId, x, z, opts = {}) {
    const def = unitDef(unitId);
    const side_ = game.sides[side];
    const tier = opts.tier || 1;
    // Commander tier bonus (GDD §3 "1 chỉ số thưởng tier") is applied as an extra multiplier on one stat.
    const st = tierStats(def, tier);
    const tb = side_.tierBonus;
    if (tb && def.group === tb.group) {
      if (tb.stat === 'hp') st.hp = Math.round(st.hp * (1 + tb.value));
      if (tb.stat === 'range') st.range *= 1 + tb.value;
      if (tb.stat === 'dmg') st.dmg *= 1 + tb.value;
    }
    this.kind = 'unit';
    this.id = id;
    this.side = side;
    this.def = def;
    this.tier = tier;
    this.group = opts.group ?? -1;       // formation slot index (0..8) — the player commands groups
    this.x = x; this.z = z;
    this.layer = def.layer;
    this.alt = LAYER_HEIGHT[def.layer];
    this.heading = side === 0 ? 0 : Math.PI;   // radians, 0 = +x
    this.maxHp = st.hp; this.hp = st.hp;
    this.armor = st.armor;
    this.dmg = st.dmg;
    this.range = st.range;
    this.speed = st.speed;
    this.cooldownMult = st.cooldownMult;
    this.sight = def.sight;
    this.cooldown = 0;
    this.ammo = def.ammo ?? Infinity;
    this.maxAmmo = def.ammo ?? Infinity;
    this.energy = def.energy ?? 0;
    this.maxEnergy = def.energy ?? 0;
    this.skillCd = 0;
    this.alive = true;
    this.order = { type: 'idle' };      // high level order from the player (sim/ai.js interprets it)
    this.intent = 'idle';               // what the unit is doing right now (icon above head, GDD §5)
    this.moveTarget = null;             // {x,z} immediate goal used by movement
    this.path = null;                   // array of {x,z} waypoints
    this.target = null;                 // unit or structure being attacked
    this.visible = [side === 0, side === 1]; // visible to side 0 / side 1 (sim/vision.js)
    this.spotted = 0;                   // time until which it is "marked" by a spotter
    this.stealth = 0;                   // seconds of stealth left
    this.jammed = 0;                    // seconds jammed by EW
    this.hacked = 0;                    // seconds hacked (fights for the other side)
    this.originalSide = side;
    this.crew = 0;
    this.cargo = 0;                     // troops carried (transports)
    this.soldiers = def.id === 'infantry' ? (opts.soldiers ?? def.squad) : 0;
    this.squadSize = def.id === 'infantry' ? this.soldiers : (def.squad || 1); // a squad dropped with n soldiers never refills on hit
    this.swarm = def.swarmCount ? (opts.swarm ?? def.swarmCount) : 0;
    this.deployed = !def.needsTransport; // SAM/Iron Dome must be carried then deployed (GDD §11.6)
    this.lastHitTime = -99;
    this.flags = {};
    if (def.id === 'infantry') { this.maxHp = def.hp * this.soldiers / def.squad * 6; this.hp = this.maxHp; }
    this.acc = {};
    applyAccessories(this, {}, accessoryMods(def, tier));
    Object.assign(this, opts.extra || {});
  }

  get pos() { return { x: this.x, z: this.z }; }
  dist(o) { return Math.hypot(o.x - this.x, o.z - this.z); }
  get isAir() { return this.layer === 'air' || this.layer === 'low'; }
  get isNaval() { return this.layer === 'sea' || this.layer === 'sub'; }
  get isGround() { return this.layer === 'ground'; }
  get hpFrac() { return this.hp / this.maxHp; }
  get canCapture() { return this.layer === 'ground' && (this.def.group === 'tank' || this.def.group === 'infantry') && !this.def.remote; }
}

// OWNER: agent Kinh tế & HUD
// Economy (order 70): GDD §9 §14 §15 — F-07, F-110, F-157, F-160..F-177.
//  - Income per held strongpoint per minute (+ small HQ base income), kill bounties, win-map reward (meta, on 'end').
//  - Upkeep per minute for living units + troops; mobilization raises upkeep and lowers income.
//  - Loans with flat interest + due time (match minutes); forced liquidation at 55% when due; bankrupt flag.
//  - Recruitment (cost + training time, capped per minute) and mobilization (big batch, once per match).
//  - Command points (side.cp) regen, faster per held strongpoint. Occupation score accrual (F-157).
//  - Commands: buy, sell, upgrade, loan, repay, recruit, mobilize, surrender (see registerEconomyCommands).
import { UNITS, unitDef, tierStats, TIERS, MAX_T3, MAX_SLOTS, CP_LIMIT, formatUSD, unitCp, accessoryMods } from '../data/units.js';
import { applyAccessories } from './unit.js';
import { spawnSlot } from './commands.js';
import { COMMANDERS } from '../data/commanders.js';
import { domainOf, nearestPassable } from './path.js';

// ---- tuning (exported so UI / tests / balance can read them) ----
export const ECON = {
  incomePerSp: 30_000_000,     // USDT per held strongpoint per minute (F-173)
  baseIncome: 3_000_000,        // HQ tax per minute (keeps the economy moving before captures)
  bountyRate: 0.15,            // share of a destroyed enemy unit's value paid to the killer side
  sellRate: 0.55,              // manual sale price
  liquidationRate: 0.55,       // forced sale price when a loan is due (GDD 50–60%)
  unitUpkeep: 0.0025,           // per minute, share of unit value
  troopUpkeep: 500,            // per soldier (active + reserve) per minute
  loanRate: 0.12,              // flat interest
  loanTerm: 480,               // seconds of match time until due (8 min)
  loanMax: 2_000_000_000,      // max outstanding principal
  loanOptions: [100_000_000, 300_000_000, 500_000_000, 1_000_000_000],
  recruitCost: 20_000,         // per soldier
  recruitTime: 30,             // training seconds
  recruitCapPerMin: 200,       // soldiers per match minute
  mobilizeAmount: 600,
  mobilizeCost: 10_000,        // per soldier
  mobilizeTime: 20,
  mobilizeDuration: 300,       // seconds the mobilization penalty lasts
  mobilizeUpkeepMult: 3,       // troop upkeep multiplier while mobilized
  mobilizeIncomeMult: 0.7,
  cpRegenBase: 0.3,            // command points per second
  cpRegenPerSp: 0.2,
  scorePerSp: 1,               // occupation score per strongpoint per second
  highValueMin: 5_000_000,     // units worth at least this give kill score
  highValueScoreCap: 500,
  winReward: 500_000_000,      // "thắng map: thưởng lớn" (meta, game.ended.rewards)
  loseReward: 50_000_000,
  aiShopEvery: 20,             // seconds between AI shopping decisions (side.autoShop)
};

const isShip = def => def.layer === 'sea' || def.layer === 'sub';
const isAircraft = def => def.layer === 'air' || def.layer === 'low';

// Catalogue price of one unit at tier 1 (a swarm is bought as a whole; infantry squads cost their recruitment).
export function basePrice(def) {
  if (def.id === 'infantry') return def.squad * ECON.recruitCost;
  return def.price * (def.swarmCount || 1);
}
// Money needed to buy one unit at a tier (T2/T3 pay the cumulative upgrade cost on top).
export function unitPrice(def, tier = 1) {
  let m = 1;
  for (let t = 2; t <= tier; t++) m += TIERS[t].costMult;
  return Math.round((def.id === 'infantry' ? 0 : basePrice(def)) * m);
}
// Upgrade cost for one unit from tier-1 to tier.
export function upgradeUnitCost(def, toTier) { return Math.round(basePrice(def) * TIERS[toTier].costMult); }
// Formation CP of one unit (GDD §9 "theo loại và tier", F-85): one shared formula, see data/units.js unitCp.
export { unitCp };

// Formation weapons of a slot still alive. Troops dropped by transports (u.troop) and temporary units from
// skills/ultimates share the group index but are not formation weapons (F-52).
export function slotUnits(game, side, slotIdx) {
  const out = [];
  for (const u of game.units.values()) if (u.alive && u.originalSide === side && u.group === slotIdx && !u.troop && !u.temporary) out.push(u);
  return out;
}
// A slot is "live" if its weapon is still in the field or waiting to be deployed (1 slot = 1 weapon, F-52).
export function slotLiveCount(game, side, slot) {
  if (!slot.deployed) return slot.count || 1;
  return slotUnits(game, side, slot.slot).length;
}
// Formation weapons alive (max MAX_SLOTS).
export function liveFormationCount(game, side) {
  return game.sides[side].formation.reduce((a, s) => a + Math.min(1, slotLiveCount(game, side, s)), 0);
}
// Index of the slot a new purchase would take: a never-used slot, else one whose weapon is dead
// (same unit type preferred). -1 when 9 formation weapons are alive.
export function freeSlotIndex(game, side, unitId = null) {
  const F = game.sides[side].formation;
  const dead = F.filter(s => s.deployed && slotLiveCount(game, side, s) === 0);
  const same = unitId ? dead.find(s => s.unit === unitId) : null;
  if (same) return same.slot;
  if (F.length < MAX_SLOTS) return F.length;
  return dead.length ? dead[0].slot : -1;
}

export function cpUsed(game, side) {
  const S = game.sides[side];
  let used = 0;
  for (const slot of S.formation) {
    const def = unitDef(slot.unit);
    used += unitCp(def, slot.tier || 1) * slotLiveCount(game, side, slot);
  }
  return used;
}
export function cpLimit(game, side) { return game.sides[side].cpLimit ?? CP_LIMIT; }
export function cpRemaining(game, side) { return cpLimit(game, side) - cpUsed(game, side); }
export function t3Count(game, side) { return game.sides[side].formation.filter(s => (s.tier || 1) >= 3 && slotLiveCount(game, side, s) > 0).length; }
export function totalDebt(side) { return side.loans.reduce((a, l) => a + l.owed, 0); }
export function nextDue(side) { return side.loans.reduce((b, l) => (!b || l.due < b.due ? l : b), null); }
export function heldStrongpoints(game, side) { return game.strongpoints.filter(sp => sp.owner === side).length; }
export function isMobilized(game, side) { const S = game.sides[side]; return S.mobilized && game.time < (S.mobilizedUntil ?? Infinity); }

// Soldiers still alive for a side: reserve + training + everyone inside living units.
export function soldiersAlive(game, side) {
  const S = game.sides[side];
  let n = S.troops.reserve + S.troops.recruiting.reduce((a, r) => a + r.n, 0);
  for (const u of game.units.values()) if (u.alive && u.side === side) n += (u.crew || 0) + (u.cargo || 0) + (u.def.id === 'infantry' ? u.soldiers : 0);
  return n;
}

// Per-minute cash flow (positive = income).
export function incomePerMin(game, side) {
  const n = heldStrongpoints(game, side);
  let inc = ECON.baseIncome + n * ECON.incomePerSp;
  if (isMobilized(game, side)) inc *= ECON.mobilizeIncomeMult;
  return inc * (1 + (game.sides[side].mods.income || 0));
}
export function upkeepPerMin(game, side) {
  const S = game.sides[side];
  let v = 0;
  for (const u of game.units.values()) if (u.alive && u.side === side) v += u.value || 0;
  const troops = S.troops.active + S.troops.reserve;
  return v * ECON.unitUpkeep + troops * ECON.troopUpkeep * (isMobilized(game, side) ? ECON.mobilizeUpkeepMult : 1);
}

function toast(game, side, text) { game.events.emit('toast', { side, text }); }

// ---- spawning bought units ----
export function spawnPointFor(game, side, def) {
  const hq = game.hq(side);
  const base = hq && hq.alive ? hq : game.map.bases[side];
  const dir = side === 0 ? 1 : -1;
  if (isShip(def)) {
    const port = game.structures.find(s => s.type === 'port' && s.side === side && s.alive);
    const from = port || base;
    const p = nearestPassable(game.map, domainOf({ layer: def.layer }), from.x + dir * 4, from.z, 70);
    return p ? { x: p.x, z: p.z } : null;
  }
  if (isAircraft(def)) {
    const af = game.structures.find(s => s.type === 'airfield' && s.side === side && s.alive);
    const f = af || base;
    return { x: f.x + dir * 4, z: f.z };
  }
  const p = nearestPassable(game.map, 'ground', base.x + dir * 8, base.z, 30);
  return p ? { x: p.x, z: p.z } : { x: base.x + dir * 8, z: base.z };
}

// Called once per unit spawn: remember what it is worth (used for selling, bounties, upkeep, liquidation).
function stampValue(u) {
  if (u.value != null) return;
  u.value = unitPrice(u.def, u.tier || 1);
}

// Re-apply tier stats to a living unit, keeping hp fraction and any other multipliers (commander mods).
export function retier(u, toTier) {
  const from = u.tier || 1;
  if (toTier === from) return;
  const a = tierStats(u.def, from), b = tierStats(u.def, toTier);
  const r = k => (a[k] ? b[k] / a[k] : 1);
  const frac = u.hp / u.maxHp;
  u.maxHp *= r('hp'); u.hp = u.maxHp * frac;
  u.armor = Math.min(0.85, u.armor * r('armor'));
  u.dmg *= r('dmg'); u.range *= r('range'); u.speed *= r('speed'); u.cooldownMult *= r('cooldownMult');
  applyAccessories(u, accessoryMods(u.def, from), accessoryMods(u.def, toTier)); // T2/T3 accessories (F-81)
  u.tier = toTier;
}

// Sell a unit (manual sale or liquidation). Returns money received.
export function sellUnit(game, u, rate) {
  const S = game.sides[u.side];
  const amount = Math.round((u.value || 0) * rate);
  S.money += amount;
  // Crew & carried troops go back to the reserve.
  const people = (u.crew || 0) + (u.cargo || 0) + (u.def.id === 'infantry' ? u.soldiers : 0);
  S.troops.active = Math.max(0, S.troops.active - people);
  S.troops.reserve += people;
  u.crew = 0; u.cargo = 0;
  u.alive = false; u.hp = 0; u.sold = true;
  game.units.delete(u.id);
  S.econ.sold += amount;
  game.events.emit('unit:sold', { unit: u, amount, side: u.side });
  return amount;
}

// Liquidate units (most valuable first) until `need` money is available. Returns true if covered.
export function liquidate(game, side, need) {
  const S = game.sides[side];
  const sellable = [...game.units.values()].filter(u => u.alive && u.side === side && (u.value || 0) > 0).sort((a, b) => b.value - a.value);
  // Sell the cheapest unit that covers the shortfall if one exists, else the most valuable, repeat.
  while (S.money < need && sellable.length) {
    const short = need - S.money;
    let pick = -1;
    for (let i = sellable.length - 1; i >= 0; i--) if (sellable[i].value * ECON.liquidationRate >= short) { pick = i; break; }
    if (pick < 0) pick = 0;
    const u = sellable.splice(pick, 1)[0];
    const got = sellUnit(game, u, ECON.liquidationRate);
    game.events.emit('liquidation', { side, unit: u, amount: got });
    toast(game, side, `Thanh lý ${u.def.name} được ${formatUSD(got)} USDT để trả nợ`);
  }
  return S.money >= need;
}

function settleLoans(game, side) {
  const S = game.sides[side];
  for (const loan of S.loans) {
    if (loan.owed <= 0 || game.time < loan.due) continue;
    if (S.money < loan.owed) {
      toast(game, side, `Khoản vay đến hạn (${formatUSD(loan.owed)}) — không đủ tiền, buộc bán khí tài!`);
      liquidate(game, side, loan.owed);
    }
    if (S.money >= loan.owed) {
      S.money -= loan.owed;
      game.events.emit('loan:repaid', { side, loan, forced: true });
      toast(game, side, `Đã trả khoản vay đến hạn ${formatUSD(loan.owed)} USDT`);
      loan.owed = 0;
    } else {
      // Everything sold and still short → bankrupt (F-176). victory.js ends the match.
      loan.owed -= Math.max(0, S.money); S.money = 0;
      S.bankrupt = true;
      game.events.emit('bankrupt', { side });
    }
  }
  S.loans = S.loans.filter(l => l.owed > 0);
}

export const economySystem = {
  name: 'economy',
  init(game) {
    game.sides.forEach((S, i) => {
      const cfg = (i === 0 ? game.opts.player : game.opts.enemy) || {};
      S.rareMaterials = S.rareMaterials ?? cfg.rareMaterials ?? 0;
      S.econ = { earned: 0, bounty: 0, spent: 0, upkeep: 0, sold: 0, interest: 0 };
      S.recruitWindow = { minute: -1, used: 0 };
      S.mobilizeUsed = false;
      S.bankrupt = false;
      S.cpLimit = S.cpLimit ?? CP_LIMIT;
      S.fcp = { used: 0, limit: S.cpLimit };
      S.incomeRate = 0; S.upkeepRate = 0;
    });
    for (const u of game.units.values()) stampValue(u);
    game.events.on('unit:spawn', u => stampValue(u));
    game.events.on('unit:death', ({ unit, killer }) => onKill(game, unit, killer));
    game.events.on('end', e => { e.rewards = matchRewards(game, e.winner); });
    registerEconomyCommands(game);
  },
  update(game, dt) {
    if (game.phase !== 'battle') { if (game.tick % 10 === 0) refreshInfo(game); return; }
    for (const S of game.sides) {
      const i = S.id;
      // Training queue → reserve.
      const tr = S.troops.recruiting;
      if (tr.length) {
        for (const r of tr) if (game.time >= r.ready) { S.troops.reserve += r.n; game.events.emit('recruit:done', { side: i, n: r.n }); toast(game, i, `${r.n} tân binh đã huấn luyện xong`); }
        S.troops.recruiting = tr.filter(r => game.time < r.ready);
      }
      const n = heldStrongpoints(game, i);
      // Cash flow, applied continuously.
      const inc = incomePerMin(game, i), up = upkeepPerMin(game, i);
      S.money += (inc - up) * dt / 60;
      S.econ.earned += inc * dt / 60; S.econ.upkeep += up * dt / 60;
      S.incomeRate = inc; S.upkeepRate = up;
      // Command points (F-07): faster with more strongpoints.
      S.cp = Math.min(S.cpMax, S.cp + (ECON.cpRegenBase + ECON.cpRegenPerSp * n) * dt);
      // Occupation score (F-157).
      S.score += n * ECON.scorePerSp * dt;
      if (S.mobilized && game.time >= (S.mobilizedUntil ?? Infinity)) { S.mobilized = false; toast(game, i, 'Tổng động viên kết thúc'); }
      if (S.loans.length) settleLoans(game, i);
      if (S.autoShop ?? (S.ai && game.mode === 'skirmish')) { S.shopTimer = (S.shopTimer ?? ECON.aiShopEvery) - dt; if (S.shopTimer <= 0) { S.shopTimer = ECON.aiShopEvery; aiShopTick(game, S); } }
    }
    if (game.tick % 10 === 0) refreshInfo(game);
  },
};

// Simple AI economy (reinforcements + recruitment) for AI sides. The tactical-AI agent can take over by
// setting side.autoShop = false and issuing buy/recruit commands itself.
export function aiShopTick(game, S) {
  const i = S.id;
  if (S.troops.reserve < 300 && S.money > 30_000_000) game.issue(i, { type: 'recruit', amount: ECON.recruitCapPerMin });
  const buffer = 20_000_000 + totalDebt(S);
  // Wish list: the pre-match formation plus the commander's full recommended list (big hulls the 1 tỷ start
  // could not afford, e.g. the navy destroyer, are bought later from income).
  const wish = [...(game.opts[i === 0 ? 'player' : 'enemy']?.formation || S.formation).map(s => s.unit), ...(COMMANDERS[S.commander]?.recommended || [])];
  const cands = [...new Set([...wish, 'tank_heavy', 'at_team', 'infantry', 'drone_recon', 'heli_attack'])];
  const remaining = cpRemaining(game, i);
  const ok = cands.filter(id => {
    const def = unitDef(id);
    if (unitCp(def) > remaining) return false;
    if (freeSlotIndex(game, i, id) < 0) return false;   // 9 formation weapons alive (F-52)
    const p = unitPrice(def, 1);
    if (p > S.money - buffer) return false;
    if (p > 0.35 * S.money && S.money < 500_000_000) return false;   // poor side: no all-in on one expensive unit
    if ((def.id === 'infantry' ? def.squad : def.crew || 0) > S.troops.reserve - 100) return false;
    return !(isShip(def) && !spawnPointFor(game, i, def));
  });
  if (!ok.length) {
    // Nothing to buy (CP / slots full): spend surplus on T2 upgrades of the largest living slots.
    if (S.money - buffer < 100_000_000) return;
    const slots = S.formation.map((sl, k) => ({ k, sl, n: slotLiveCount(game, i, sl) }))
      .filter(x => x.n > 0 && (x.sl.tier || 1) < 2 && upgradeCost(game, i, x.k) <= S.money - buffer && unitCp(unitDef(x.sl.unit), 2) - unitCp(unitDef(x.sl.unit), 1) <= remaining)
      .sort((a, b) => upgradeCost(game, i, b.k) - upgradeCost(game, i, a.k));
    if (slots.length) game.issue(i, { type: 'upgrade', slot: slots[0].k });
    return;
  }
  // Prefer the commander's own doctrine (recommended list), then types it has few of alive (no 6× EW / Iron Dome
  // stacks), then the most valuable affordable option, with a bit of randomness (F-16 balance).
  const rec = COMMANDERS[S.commander]?.recommended || [];
  const alive = {};
  for (const u of game.units.values()) if (u.alive && u.side === i && !u.troop && !u.temporary) alive[u.def.id] = (alive[u.def.id] || 0) + 1;
  const want = id => rec.filter(x => x === id).length || 0;
  const key = id => (alive[id] || 0) - want(id) - (rec.includes(id) ? 1 : 0);
  ok.sort((a, b) => key(a) - key(b) || unitPrice(unitDef(b)) - unitPrice(unitDef(a)));
  // A rich side buys a small group at once instead of feeding single units into the front one by one.
  const n = Math.max(1, Math.min(3, ok.length, Math.floor((S.money - buffer) / 150_000_000)));
  for (let k = 0; k < n; k++) {
    const pick = ok.splice(Math.min(ok.length - 1, Math.floor(game.rng.next() * Math.min(2, ok.length))), 1)[0];
    game.issue(i, { type: 'buy', unit: pick, tier: 1, count: 1 });
  }
}

function refreshInfo(game) {
  for (const S of game.sides) { S.fcp.used = cpUsed(game, S.id); S.fcp.limit = cpLimit(game, S.id); }
}

function onKill(game, u, killer) {
  if (u.sold || killer == null || killer < 0 || killer === u.side) return;
  const K = game.sides[killer];
  const v = u.value || 0;
  const bounty = Math.round(v * ECON.bountyRate);
  if (bounty > 0) { K.money += bounty; K.econ.bounty += bounty; }
  if (v >= ECON.highValueMin) K.score += Math.min(ECON.highValueScoreCap, Math.round(v / 1e6));
}

// Win-map reward (meta progression reads game.ended.rewards).
export function matchRewards(game, winner) {
  return game.sides.map(S => {
    const win = S.id === winner;
    return { usdt: win ? ECON.winReward : ECON.loseReward, gold: Math.round((win ? 300 : 60) + S.score / (win ? 20 : 40)), debt: totalDebt(S) };
  });
}

// ---- commands ----
export function registerEconomyCommands(game) {
  // buy: { unit, tier=1 } — GDD F-52: 1 slot = 1 weapon (a drone swarm = 1 slot). A purchase always takes a free
  // slot (never used, or its weapon is dead); refused while 9 formation weapons are alive. Legacy cmd.count is ignored.
  game.onCommand('buy', (g, side, cmd) => {
    const S = g.sides[side];
    if (g.ended || !UNITS[cmd.unit]) return false;
    const def = unitDef(cmd.unit);
    const tier = Math.max(1, Math.min(3, cmd.tier || 1));
    const idx = freeSlotIndex(g, side, cmd.unit);
    if (idx < 0) { toast(g, side, `Đội hình đã đủ ${MAX_SLOTS} khí tài còn sống (9 ô = 9 khí tài) — bán bớt hoặc chờ mất khí tài để mua thêm`); return false; }
    if (tier >= 3) {
      if (t3Count(g, side) >= MAX_T3) { toast(g, side, `Tối đa ${MAX_T3} ô T3 trong đội hình`); return false; }
      if ((S.rareMaterials || 0) < (TIERS[3].rareMaterial || 1)) { toast(g, side, 'T3 cần vật liệu hiếm (từ boss / đấu data)'); return false; }
    }
    const slot = { unit: cmd.unit, tier, count: 1, slot: idx, deployed: g.phase !== 'deploy' };
    const price = unitPrice(def, tier);
    const cpNeed = unitCp(def, tier);
    if (cpNeed > cpRemaining(g, side)) { toast(g, side, `Vượt giới hạn điểm chỉ huy đội hình (còn ${cpRemaining(g, side)}/${cpLimit(g, side)} CP)`); return false; }
    if (price > S.money) { toast(g, side, def.price * (def.swarmCount || 1) > 1e9 ? `Khí tài trên 1 tỷ — cần thu nhập từ cứ điểm hoặc vay vốn (thiếu ${formatUSD(price - S.money)})` : `Không đủ tiền (cần ${formatUSD(price)} USDT)`); return false; }
    const people = def.id === 'infantry' ? def.squad : (def.crew || 0);
    if (people > S.troops.reserve) { toast(g, side, `Không đủ binh lính vận hành (cần ${people}, còn ${S.troops.reserve})`); return false; }
    let spawnAt = null;
    if (slot.deployed) {
      spawnAt = spawnPointFor(g, side, def);
      if (!spawnAt) { toast(g, side, isShip(def) ? 'Không có cảng / vùng nước để hạ thủy tàu' : 'Không có chỗ triển khai'); return false; }
    }
    // Commit.
    if (idx < S.formation.length) S.formation[idx] = slot; else S.formation.push(slot);
    if (tier >= 3) S.rareMaterials -= TIERS[3].rareMaterial || 1;
    S.money -= price; S.econ.spent += price;
    let units = [];
    if (spawnAt) {
      units = spawnSlot(g, side, slot, spawnAt.x, spawnAt.z);
      if (def.id === 'infantry') for (const u of units) { const n = Math.min(u.soldiers, S.troops.reserve); u.soldiers = n; S.troops.reserve -= n; S.troops.active += n; }
      for (const u of units) u.value = unitPrice(def, tier);
    } // deploy phase: placed with the deploy panel
    g.events.emit('purchase', { side, unit: cmd.unit, tier, count: 1, cost: price, slot: idx, units });
    toast(g, side, `Đã mua ${def.name} vào ô ${idx + 1}${price ? ` (${formatUSD(price)} USDT)` : ''}`);
    return true;
  });

  // sell: { unitId } — 55% of purchase value.
  game.onCommand('sell', (g, side, cmd) => {
    const u = g.units.get(cmd.unitId);
    if (!u || !u.alive || u.side !== side || u.originalSide !== side || !(u.value > 0)) { toast(g, side, 'Không bán được đơn vị này'); return false; }
    const got = sellUnit(g, u, ECON.sellRate);
    toast(g, side, `Đã bán ${u.def.name}: +${formatUSD(got)} USDT`);
    return true;
  });

  // upgrade: { slot } — T1→T2→T3, cost per living unit; T3 needs a rare material, max 3 T3 slots.
  game.onCommand('upgrade', (g, side, cmd) => {
    const S = g.sides[side];
    const slot = S.formation[cmd.slot];
    if (!slot) return false;
    const def = unitDef(slot.unit);
    const from = slot.tier || 1, to = from + 1;
    if (to > 3) { toast(g, side, 'Đã đạt tier tối đa'); return false; }
    const n = slotLiveCount(g, side, slot);
    if (!n) { toast(g, side, 'Ô này không còn đơn vị'); return false; }
    const cost = upgradeCost(g, side, cmd.slot);
    if (to === 3) {
      if (t3Count(g, side) >= MAX_T3) { toast(g, side, `Tối đa ${MAX_T3} ô T3 trong đội hình`); return false; }
      if ((S.rareMaterials || 0) < (TIERS[3].rareMaterial || 1)) { toast(g, side, 'Nâng T3 cần vật liệu hiếm (từ boss / đấu data)'); return false; }
    }
    const extraCp = (unitCp(def, to) - unitCp(def, from)) * n;   // F-85: every tier step costs CP
    if (extraCp > cpRemaining(g, side)) { toast(g, side, `Không đủ điểm chỉ huy đội hình cho T${to} (cần thêm ${extraCp} CP)`); return false; }
    if (cost > S.money) { toast(g, side, `Không đủ tiền nâng tier (cần ${formatUSD(cost)} USDT)`); return false; }
    S.money -= cost; S.econ.spent += cost;
    if (to === 3) S.rareMaterials -= TIERS[3].rareMaterial || 1;
    slot.tier = to;
    const per = upgradeUnitCost(def, to);
    for (const u of slotUnits(g, side, slot.slot)) { retier(u, to); u.value = (u.value || 0) + per; }
    g.events.emit('upgrade', { side, slot: cmd.slot, tier: to, cost });
    toast(g, side, `${def.name} đã nâng lên T${to}`);
    return true;
  });

  // loan: { amount } — flat interest, due after ECON.loanTerm seconds.
  game.onCommand('loan', (g, side, cmd) => {
    const S = g.sides[side];
    const amount = Math.floor(cmd.amount || 0);
    if (amount <= 0) return false;
    const principal = S.loans.reduce((a, l) => a + l.principal, 0);
    if (principal + amount > ECON.loanMax) { toast(g, side, `Hạn mức vay tối đa ${formatUSD(ECON.loanMax)} USDT`); return false; }
    const rate = ECON.loanRate;
    const loan = { principal: amount, rate, owed: Math.round(amount * (1 + rate)), due: g.time + ECON.loanTerm, taken: g.time };
    S.loans.push(loan);
    S.money += amount; S.econ.interest += loan.owed - amount;
    g.events.emit('loan', { side, loan });
    toast(g, side, `Đã vay ${formatUSD(amount)} USDT, lãi ${Math.round(rate * 100)}%, hạn ${Math.round(ECON.loanTerm / 60)} phút`);
    return true;
  });

  // repay: { amount? } — pays the earliest-due loans from current money (all if amount omitted).
  game.onCommand('repay', (g, side, cmd) => {
    const S = g.sides[side];
    if (!S.loans.length) { toast(g, side, 'Không có khoản nợ'); return false; }
    let budget = Math.min(S.money, cmd.amount ?? Infinity);
    if (budget <= 0) { toast(g, side, 'Không đủ tiền trả nợ'); return false; }
    let paid = 0;
    for (const l of [...S.loans].sort((a, b) => a.due - b.due)) {
      const p = Math.min(budget, l.owed);
      l.owed -= p; budget -= p; paid += p;
      if (budget <= 0) break;
    }
    S.money -= paid;
    S.loans = S.loans.filter(l => l.owed > 0.5);
    g.events.emit('loan:repaid', { side, amount: paid });
    toast(g, side, `Đã trả nợ ${formatUSD(paid)} USDT`);
    return true;
  });

  // recruit: { amount } — money + training time, capped per match minute.
  game.onCommand('recruit', (g, side, cmd) => {
    const S = g.sides[side];
    const minute = Math.floor(g.time / 60);
    if (S.recruitWindow.minute !== minute) S.recruitWindow = { minute, used: 0 };
    const left = ECON.recruitCapPerMin - S.recruitWindow.used;
    let n = Math.min(Math.floor(cmd.amount || 0), left);
    if (left <= 0) { toast(g, side, `Đã đạt giới hạn tuyển ${ECON.recruitCapPerMin} lính/phút`); return false; }
    n = Math.min(n, Math.floor(S.money / ECON.recruitCost));
    if (n <= 0) { toast(g, side, 'Không đủ tiền tuyển quân'); return false; }
    S.money -= n * ECON.recruitCost; S.econ.spent += n * ECON.recruitCost;
    S.recruitWindow.used += n;
    S.troops.recruiting.push({ n, ready: g.time + ECON.recruitTime });
    g.events.emit('recruit', { side, n });
    toast(g, side, `Đang huấn luyện ${n} tân binh (${ECON.recruitTime} giây)`);
    return true;
  });

  // mobilize: {} — once per match: big batch, upkeep ×3 and income ×0.7 for 5 minutes.
  game.onCommand('mobilize', (g, side) => {
    const S = g.sides[side];
    if (S.mobilizeUsed) { toast(g, side, 'Tổng động viên chỉ dùng được 1 lần mỗi trận'); return false; }
    const cost = ECON.mobilizeAmount * ECON.mobilizeCost;
    if (S.money < cost) { toast(g, side, `Không đủ tiền tổng động viên (cần ${formatUSD(cost)})`); return false; }
    S.money -= cost; S.econ.spent += cost;
    S.mobilizeUsed = true; S.mobilized = true; S.mobilizedUntil = g.time + ECON.mobilizeDuration;
    S.troops.recruiting.push({ n: ECON.mobilizeAmount, ready: g.time + ECON.mobilizeTime });
    g.events.emit('mobilize', { side });
    toast(g, side, `TỔNG ĐỘNG VIÊN: +${ECON.mobilizeAmount} lính sau ${ECON.mobilizeTime} giây; chi phí duy trì tăng, thu nhập giảm`);
    return true;
  });

  // surrender: {} — victory.js ends the match.
  game.onCommand('surrender', (g, side) => {
    if (g.ended) return false;
    g.sides[side].surrendered = true;
    return true;
  });
}

export function upgradeCost(game, side, slotIdx) {
  const slot = game.sides[side].formation[slotIdx];
  if (!slot || (slot.tier || 1) >= 3) return Infinity;
  const def = unitDef(slot.unit);
  return upgradeUnitCost(def, (slot.tier || 1) + 1) * slotLiveCount(game, side, slot);
}

export function install(game) { game.addSystem(economySystem, 70); }

// OWNER: agent Meta & chế độ chơi
// Persistent player profile (localStorage, guarded so it also runs in Node) + meta-game rules:
// currencies (F-111), tier unlocks (F-83), formation validation (F-52/F-82/F-110/F-170..F-172),
// boss progress (F-100..F-102), daily missions (F-112), cosmetics/battle pass (F-113),
// win-rate stats per commander/unit (F-114), learned player tendencies for the enemy AI (GDD pillar 4).
import { UNITS, TIERS, MAX_SLOTS, MAX_T3, CP_LIMIT, unitDef, unitCp, expandFormation } from '../data/units.js';
import { COMMANDERS, COMMANDER_IDS } from '../data/commanders.js';
import { START_MONEY, DEPLOY_TIME, START_TROOPS } from './game.js';
import { ECON, unitPrice } from '../sim/economy.js';
import { RNG } from './rng.js';
import { buildMap } from '../data/maps.js';
import { MISSIONS, DAILY_COUNT, missionIncrement, SKINS, PASS_LEVELS, PASS_XP_PER_LEVEL, PASS_PREMIUM_COST } from '../data/missions.js';
import { BOSSES, BOSS_ORDER } from '../data/bosses.js';

const KEY = 'wargrid.profile.v1';

// ---------- storage (localStorage in the browser, memory in Node) ----------
const mem = new Map();
const memStore = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: k => { mem.delete(k); } };
export function storage() {
  try { if (typeof localStorage !== 'undefined' && localStorage) return localStorage; } catch (e) { /* blocked */ }
  return memStore;
}
export function readJSON(key, fallback) {
  try { const v = storage().getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
}
export function writeJSON(key, val) {
  try { storage().setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
}

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- profile ----------
// Units that must be unlocked with gold (or a boss) before they can be put in a formation.
export const LOCKED_UNITS = {
  himars: { gold: 600 }, drone_male: { gold: 700 }, stealth_ship: { gold: 900 }, bomber: { gold: 1200 },
  carrier: { boss: 'carrier', gold: 2000 },
};

export function defaultProfile() {
  return {
    version: 1,
    name: 'Chỉ huy',
    gold: 1500, rareMaterials: 0, badges: 0,
    usdt: 0, debt: 0,           // meta money carried between matches (F-178): leftover win rewards / unpaid loans
    rating: 1000, rankPoints: 0, reputation: 0,
    unitTiers: {},              // unitId -> highest unlocked tier (default 1)
    unlockedUnits: [],          // ids from LOCKED_UNITS that were bought
    bossCleared: [],            // boss ids
    lastCommander: 'steel',
    lastFormation: {},          // commanderId -> [{unit, tier, count}]
    lastLoan: {},               // commanderId -> pre-match loan principal
    tutorialDone: false, tutorialRewarded: false,
    stats: { matches: 0, wins: 0, byCommander: {}, byUnit: {}, byMode: {} },
    learned: { matches: 0, orders: {}, unitMix: {} },
    missions: { day: '', list: [] },
    cosmetics: { owned: ['default'], skin: 'default', passXp: 0, premium: false, claimed: [] },
    ghostFights: { day: '', counts: {} },
    history: [],
  };
}

function merge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = Array.isArray(base) ? [] : { ...base };
  for (const k of Object.keys(over)) {
    out[k] = base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k]) ? merge(base[k], over[k]) : over[k];
  }
  return out;
}

let cached = null;
export function loadProfile() {
  cached = merge(defaultProfile(), readJSON(KEY, {}));
  ensureDailyMissions(cached);
  return cached;
}
export function getProfile() { return cached || loadProfile(); }
export function saveProfile(p = cached) { if (p) { cached = p; writeJSON(KEY, p); } return p; }
export function resetProfile() { cached = defaultProfile(); ensureDailyMissions(cached); saveProfile(cached); return cached; }
export function _clearCache() { cached = null; }

export function rankName(rating) {
  if (rating < 900) return 'Tân binh';
  if (rating < 1100) return 'Hạ sĩ';
  if (rating < 1300) return 'Trung úy';
  if (rating < 1500) return 'Đại úy';
  if (rating < 1700) return 'Thiếu tá';
  return 'Đại tá';
}

// ---------- unlocks & tiers (F-83) ----------
export function isUnitUnlocked(p, unitId) {
  const l = LOCKED_UNITS[unitId];
  if (!l) return true;
  return (p.unlockedUnits || []).includes(unitId);
}
export function unlockUnitReason(p, unitId) {
  const l = LOCKED_UNITS[unitId];
  if (!l || isUnitUnlocked(p, unitId)) return null;
  if (l.boss && !p.bossCleared.includes(l.boss)) return `Cần hạ boss ${BOSSES[l.boss].name}`;
  if (p.gold < l.gold) return `Cần ${l.gold} vàng để mở khóa`;
  return null;
}
export function unlockUnit(p, unitId) {
  const r = unlockUnitReason(p, unitId);
  if (r) return { ok: false, reason: r };
  if (isUnitUnlocked(p, unitId)) return { ok: true };
  p.gold -= LOCKED_UNITS[unitId].gold;
  p.unlockedUnits.push(unitId);
  return { ok: true };
}
export function unitTier(p, unitId) { return (p && p.unitTiers[unitId]) || 1; }
const RANK_MULT = { A: 1, S: 1.5, SR: 2, UR: 3 };
export function tierUpgradeCost(unitId, tier) {
  const d = UNITS[unitId], m = RANK_MULT[d.rank] || 1;
  if (tier === 2) return { gold: Math.round(300 * m), rare: 0 };
  if (tier === 3) return { gold: Math.round(800 * m), rare: TIERS[3].rareMaterial || 1 };
  return { gold: 0, rare: 0 };
}
export function upgradeTierReason(p, unitId) {
  const cur = unitTier(p, unitId);
  if (cur >= 3) return 'Đã đạt T3';
  const c = tierUpgradeCost(unitId, cur + 1);
  if (p.gold < c.gold) return `Cần ${c.gold} vàng`;
  if (p.rareMaterials < c.rare) return `Cần ${c.rare} vật liệu hiếm (hạ boss để nhận)`;
  return null;
}
export function upgradeUnitTier(p, unitId) {
  const r = upgradeTierReason(p, unitId);
  if (r) return { ok: false, reason: r };
  const next = unitTier(p, unitId) + 1, c = tierUpgradeCost(unitId, next);
  p.gold -= c.gold; p.rareMaterials -= c.rare;
  p.unitTiers[unitId] = next;
  return { ok: true, tier: next };
}

// ---------- formation rules ----------
// GDD §4 F-52: "tối đa 9 vũ khí/đơn vị quân sự (9 ô triển khai)... Một bầy drone tính là 1 ô" → 1 slot = 1 weapon.
export function maxCount(unitId) { return 1; }
export function slotCount(slot) { return 1; }
// Legacy saved formations ({count: n}) become n slots of one weapon each (capped at 9).
export function normalizeFormation(formation) { return expandFormation(formation || []).filter(s => UNITS[s.unit]); }
// CP of a slot = shared unitCp(def, tier) = cp + (tier − 1) (GDD §6 "nâng tier tốn điểm chỉ huy", F-85).
export function slotCp(slot) { return unitCp(unitDef(slot.unit), slot.tier || 1); }
// Money: same price rule as sim/economy.js unitPrice (cumulative tier surcharge, F-177); a swarm's price is the whole swarm.
export function slotPrice(slot) { return unitPrice(unitDef(slot.unit), slot.tier || 1); }

// ---------- pre-match loans (GDD §15 "vay thêm") ----------
// Same shape/terms as the in-match 'loan' command in sim/economy.js. economy.js compares loan.due with the
// absolute game.time, so a pre-match loan is due DEPLOY_TIME + ECON.loanTerm (≈ 8 min of battle).
export const PRELOAN_OPTIONS = [0, 500_000_000, 1_000_000_000, 2_000_000_000].filter(a => a <= ECON.loanMax);
export function makePreLoan(amount) {
  return { principal: amount, rate: ECON.loanRate, owed: Math.round(amount * (1 + ECON.loanRate)), due: DEPLOY_TIME + ECON.loanTerm, taken: 0, preMatch: true };
}
// Meta money (F-178): pre-match budget = 1 tỷ + carried USDT − carried debt, never negative.
export function metaBudget(p) { return p ? Math.max(0, START_MONEY + (p.usdt || 0) - (p.debt || 0)) : START_MONEY; }
export function budgetFor(loan = 0, base = START_MONEY) { return base + (loan || 0); }
// Money the side starts the battle with after paying for its formation (and receiving the loan).
export function startMoney(formation, loan = 0, base = START_MONEY) { return Math.max(0, budgetFor(loan, base) - formationTotals(formation).price); }
export function playerEconomy(formation, loan = 0, base = START_MONEY) {
  return { money: startMoney(formation, loan, base), loans: loan > 0 ? [makePreLoan(loan)] : [] };
}
// Entering a match moves the carried USDT into it and pays the carried debt from 1 tỷ + USDT (what is left over
// is the budget). Debt larger than that stays on the profile. Returns { base, usdt, debtPaid }.
export function commitMetaBudget(p) {
  const avail = START_MONEY + (p.usdt || 0);
  const debtPaid = Math.min(avail, p.debt || 0);
  const out = { base: avail - debtPaid, usdt: p.usdt || 0, debtPaid };
  p.usdt = 0; p.debt = (p.debt || 0) - debtPaid;
  return out;
}
// Legacy {count: n} entries count as n slots everywhere (same as Game.makeSide), so price/CP match what spawns.
export function formationTotals(formation) {
  let cp = 0, price = 0, t3 = 0;
  const slots = expandFormation(formation, Infinity);
  for (const s of slots) { cp += slotCp(s); price += slotPrice(s); if ((s.tier || 1) === 3) t3++; }
  return { cp, price, t3, slots: slots.length };
}
function fmtMoney(v) { return v >= 1e9 ? (v / 1e9).toFixed(2) + ' tỷ' : Math.round(v / 1e6) + ' tr'; }
export const FORMATION_LIMITS = { slots: MAX_SLOTS, cp: CP_LIMIT, t3: MAX_T3, budget: START_MONEY };

export function validateFormation(formation, { profile = null, cpLimit = CP_LIMIT, budget = START_MONEY } = {}) {
  const errors = [];
  const t = formationTotals(formation);
  if (!formation.length) errors.push('Đội hình trống — thêm ít nhất 1 đơn vị');
  if (t.slots > MAX_SLOTS) errors.push(`Tối đa ${MAX_SLOTS} ô đội hình (9 ô = 9 khí tài)`);
  if (t.cp > cpLimit) errors.push(`Vượt giới hạn điểm chỉ huy (${t.cp}/${cpLimit} CP)`);
  if (t.t3 > MAX_T3) errors.push(`Tối đa ${MAX_T3} đơn vị T3`);
  if (t.price > budget) errors.push(budget !== START_MONEY ? `Vượt ngân sách (${fmtMoney(budget)} USDT = 1 tỷ ± tiền/nợ mang sang + khoản vay)` : `Vượt ngân sách 1 tỷ USDT`);
  for (const s of formation) {
    if (!UNITS[s.unit]) { errors.push(`Đơn vị không tồn tại: ${s.unit}`); continue; }
    if (profile && !isUnitUnlocked(profile, s.unit)) errors.push(`${UNITS[s.unit].name} chưa mở khóa`);
    if (profile && (s.tier || 1) > unitTier(profile, s.unit)) errors.push(`${UNITS[s.unit].name} chưa mở T${s.tier}`);
  }
  return { ok: errors.length === 0, errors, ...t };
}

// Why a new slot cannot be added (null = allowed). Used to grey out catalog items (F-172).
export function addSlotReason(formation, slot, opts = {}) {
  const { profile = null, cpLimit = CP_LIMIT, budget = START_MONEY, base = START_MONEY } = opts;
  if (expandFormation(formation, Infinity).length >= MAX_SLOTS) return `Đã đủ ${MAX_SLOTS} ô (9 khí tài)`;
  if (profile && !isUnitUnlocked(profile, slot.unit)) return 'Chưa mở khóa';
  const t = formationTotals(formation);
  if (t.cp + slotCp(slot) > cpLimit) return `Vượt ${cpLimit} CP`;
  if (t.price + slotPrice(slot) > budget) return slotPrice(slot) > budget ? (budget >= budgetFor(ECON.loanMax, base) ? 'Giá vượt cả hạn mức vay — mua trong trận khi có thu nhập' : 'Giá vượt ngân sách — vay trước trận hoặc mua trong trận') : 'Không đủ ngân sách (có thể vay trước trận)';
  return null;
}

export function defaultCount(unitId) { return 1; } // 1 slot = 1 weapon (F-52)

// Greedy fill from a list of unit ids, skipping items that break slots/CP/budget/unlocks.
// Ships / subs cannot be deployed on a map without sea (plains): recommendations skip them when the map is known.
const seaCache = {};
export function mapHasSea(mapId) { return seaCache[mapId] ??= buildMap(mapId).hasSea; }
export function buildFormation(list, opts = {}) {
  const out = [], skipped = [];
  for (const unit of list) {
    if (!UNITS[unit]) continue;
    const slot = { unit, tier: 1, count: 1 };
    const r = opts.mapId && !mapHasSea(opts.mapId) && (UNITS[unit].layer === 'sea' || UNITS[unit].layer === 'sub') ? 'Bản đồ không có biển' : addSlotReason(out, slot, opts);
    if (r) { skipped.push({ unit, reason: r }); continue; }
    out.push(slot);
  }
  return { formation: out, skipped };
}
export function recommendedFormation(commander, opts = {}) {
  return buildFormation(COMMANDERS[commander].recommended, opts);
}
// "Đề xuất" with an automatic pre-match loan: smallest loan that fits the most recommended units
// (e.g. the navy gets a destroyer). Returns { formation, skipped, loan }.
export function recommendWithLoan(commander, opts = {}) {
  const list = COMMANDERS[commander].recommended, n = list.length;
  const base = opts.base ?? START_MONEY;
  const reserve = Math.round(base * RECOMMEND.reserve);   // keep battle cash (upkeep, recruits, reinforcements)
  let best = null;
  for (const loan of PRELOAN_OPTIONS) {
    const budget = budgetFor(loan, base);
    const r = buildFormation(list, { ...opts, base, budget: Math.max(0, budget - reserve) });
    // Only borrow what the side can pay back when the loan is due: cash left + projected income − upkeep.
    if (loan > 0 && !loanRepayable(loan, budget - formationTotals(r.formation).price, formationTotals(r.formation).price)) continue;
    // Score: earlier (more important) recommended items weigh more; ties keep the smaller loan.
    const skipped = new Set(r.skipped.map(x => list.indexOf(x.unit)));
    let score = 0; list.forEach((_, i) => { if (!skipped.has(i)) score += n - i; });
    if (!best || score > best.score) best = { ...r, loan, score };
  }
  return best;
}
// Recommendation rules (QA #2/#22): ≥10% of the budget stays as battle cash; a pre-match loan is taken only when
// the cash left plus projected income (base tax + ~2 strongpoints) minus upkeep over the loan term covers it.
export const RECOMMEND = { reserve: 0.1, projectedSp: 2 };
export function loanRepayable(loan, cashLeft, unitValue) {
  const min = ECON.loanTerm / 60;
  const income = (ECON.baseIncome + RECOMMEND.projectedSp * ECON.incomePerSp) * min;
  const upkeep = (unitValue * ECON.unitUpkeep + START_TROOPS * ECON.troopUpkeep) * min;
  return cashLeft + income - upkeep >= makePreLoan(loan).owed;
}

// ---------- AI opponent for skirmish (counter rules + difficulty from rating, GDD pillar 4) ----------
export const COUNTER_COMMANDER = { steel: 'swarm', air: 'ew', navy: 'air', swarm: 'ew', ew: 'steel' };

export function difficultyFromRating(rating) {
  return Math.round(Math.max(0.4, Math.min(1.6, 0.6 + (rating - 1000) / 800)) * 100) / 100;
}
export function learnedFor(p) {
  const L = p.learned || { orders: {}, unitMix: {} };
  const preferredOrders = Object.entries(L.orders).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
  const tot = Object.values(L.unitMix).reduce((a, b) => a + b, 0) || 1;
  const unitMix = {};
  for (const [g, n] of Object.entries(L.unitMix)) unitMix[g] = Math.round(n / tot * 100) / 100;
  return { preferredOrders, unitMix, matches: L.matches || 0 };
}
export function groupMix(formation) {
  const mix = {};
  for (const s of formation) { const g = UNITS[s.unit]?.group; if (g) mix[g] = (mix[g] || 0) + slotCount(s); }
  return mix;
}

export function counterUnits(mix, learnedMix = {}) {
  const want = [];
  const has = g => (mix[g] || 0) + (learnedMix[g] || 0) * 4;
  if (has('air') >= 2) want.push('iron_dome', 'sam', 'fighter_multi');
  if (has('tank') >= 3) want.push('drone_kamikaze', 'heli_attack', 'at_team');
  if (has('drone') >= 2) want.push('laser', 'ew');
  if (has('navy') + has('sub') >= 1) want.push('heli_attack', 'drone_kamikaze');
  if (has('infantry') >= 2) want.push('tank_heavy');
  return want;
}

export function buildSkirmishEnemy(p, player, mapId, seed = 1) {
  const rng = new RNG(seed);
  const commander = COUNTER_COMMANDER[player.commander] || rng.pick(COMMANDER_IDS);
  const learned = learnedFor(p);
  const counters = counterUnits(groupMix(player.formation), learned.unitMix);
  const base = COMMANDERS[commander].recommended.slice();
  // Put counters first, then the commander's own list.
  const list = [...new Set(counters)].slice(0, 3).concat(base);
  const { formation } = buildFormation(list, { mapId, budget: Math.round(START_MONEY * (1 - RECOMMEND.reserve)) });
  const difficulty = difficultyFromRating(p.rating);
  // Strong players meet tiered enemies (respecting max 3 T3).
  if (difficulty >= 1.0) formation.slice(0, 3).forEach(s => { s.tier = 2; });
  if (difficulty >= 1.3) formation.slice(0, 2).forEach(s => { s.tier = 3; });
  const f9 = formation.slice(0, MAX_SLOTS);
  return { commander, ai: true, formation: f9, money: startMoney(f9), difficulty, learned: { preferredOrders: learned.preferredOrders, unitMix: learned.unitMix } };
}

// ---------- missions (F-112) ----------
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function ensureDailyMissions(p, date = new Date()) {
  const day = todayKey(date);
  if (p.missions.day === day && p.missions.list.length) return p.missions.list;
  const rng = new RNG(hashStr(day + (p.name || '')));
  const pool = MISSIONS.slice(), list = [];
  while (list.length < DAILY_COUNT && pool.length) list.push(pool.splice(Math.floor(rng.next() * pool.length), 1)[0]);
  p.missions = { day, list: list.map(m => ({ id: m.id, progress: 0, done: false })) };
  return p.missions.list;
}
export function missionDef(id) { return MISSIONS.find(m => m.id === id); }

// ---------- cosmetics (F-113) ----------
export function buySkin(p, id) {
  const s = SKINS.find(k => k.id === id);
  if (!s) return { ok: false, reason: 'Không có skin này' };
  if (p.cosmetics.owned.includes(id)) { p.cosmetics.skin = id; return { ok: true }; }
  if (p.badges < s.cost) return { ok: false, reason: `Cần ${s.cost} huy hiệu` };
  p.badges -= s.cost; p.cosmetics.owned.push(id); p.cosmetics.skin = id;
  return { ok: true };
}
export function passLevel(p) { return Math.min(PASS_LEVELS.length, Math.floor(p.cosmetics.passXp / PASS_XP_PER_LEVEL)); }
export function buyPremium(p) {
  if (p.cosmetics.premium) return { ok: true };
  if (p.badges < PASS_PREMIUM_COST) return { ok: false, reason: `Cần ${PASS_PREMIUM_COST} huy hiệu` };
  p.badges -= PASS_PREMIUM_COST; p.cosmetics.premium = true;
  return { ok: true };
}
// Claim every reached, unclaimed pass level (free + premium if bought). Returns list of rewards.
export function claimPass(p) {
  const got = [], lvl = passLevel(p);
  for (let i = 0; i < lvl; i++) {
    const L = PASS_LEVELS[i];
    if (!p.cosmetics.claimed.includes('f' + i)) { p.cosmetics.claimed.push('f' + i); grant(p, L.free); got.push(L.free); }
    if (p.cosmetics.premium && !p.cosmetics.claimed.includes('p' + i)) {
      p.cosmetics.claimed.push('p' + i);
      if (L.premium.skin && !p.cosmetics.owned.includes(L.premium.skin)) p.cosmetics.owned.push(L.premium.skin);
      got.push(L.premium);
    }
  }
  return got;
}
function grant(p, r = {}) {
  p.gold += r.gold || 0; p.rareMaterials += r.rare || 0; p.badges += r.badges || 0;
}

// ---------- match summary & rewards ----------
export function summarizeMatch(game, side = 0) {
  const S = game.sides[side], E = game.ended || {};
  const orders = {};
  for (const e of game.commandLog) if (e.side === side && e.cmd.type === 'order') orders[e.cmd.order] = (orders[e.cmd.order] || 0) + 1;
  return {
    mode: game.mode, mapId: game.map.id, commander: S.commander,
    formation: S.formation.map(s => ({ unit: s.unit, tier: s.tier || 1, count: s.count || 1 })),
    won: E.winner === side, draw: E.winner == null || E.winner === -1, reason: E.reason || '',
    duration: game.time, battleTime: game.battleTime || Math.max(0, game.time - (game.battleStart ?? game.time)),
    kills: S.stats.kills, lost: S.stats.lost, structures: S.stats.structures, damage: Math.round(S.stats.damage || 0),
    captures: game.metaStats ? game.metaStats.captures[side] : 0,
    score: Math.floor(S.score || 0), orders,
    boss: game.opts.boss || null, ghostId: game.opts.ghost ? game.opts.ghost.id : null,
    // F-178: win-map reward and loans still unpaid at the end (sim/economy.js matchRewards).
    usdtReward: E.rewards?.[side]?.usdt ?? null, matchDebt: E.rewards?.[side]?.debt ?? 0,
  };
}

export function bossUnlocked(p, bossId) {
  const i = BOSS_ORDER.indexOf(bossId);
  return i <= 0 || p.bossCleared.includes(BOSS_ORDER[i - 1]);
}
export function ghostUnlocked(p) { return BOSS_ORDER.every(b => p.bossCleared.includes(b)); }

// Applies a finished match to the profile. Returns the rewards & mission progress for the result screen.
export function applyMatchResult(p, s, date = new Date()) {
  ensureDailyMissions(p, date);
  const r = { gold: 0, rare: 0, badges: 0, rankPoints: 0, rating: 0, passXp: 0, missions: [], bossCleared: null, unlocked: [], notes: [], usdt: null };
  const won = !!s.won;
  if (s.mode === 'tutorial') {
    // Rewarded once; tutorialDone may already be set by the overlay (ui/tutorial.js) before the match ends.
    if (!p.tutorialRewarded) { r.gold += 300; r.notes.push('Hoàn thành trận tập'); p.tutorialRewarded = true; }
    p.tutorialDone = true;
  } else {
    r.gold += won ? 300 + Math.min(200, (s.kills || 0) * 5) : 80 + Math.min(60, (s.kills || 0) * 2);
    r.passXp += won ? 100 : 40;
    if (won) r.badges += 1;
    if (s.mode === 'skirmish') r.rating += won ? 20 : -15;
    if (s.mode === 'boss' && won && s.boss && BOSSES[s.boss]) {
      const b = BOSSES[s.boss];
      r.gold += b.rewards.gold; r.rare += b.rewards.rare; r.badges += b.rewards.badges;
      if (!p.bossCleared.includes(s.boss)) {
        p.bossCleared.push(s.boss); r.bossCleared = s.boss;
        const i = BOSS_ORDER.indexOf(s.boss);
        if (BOSS_ORDER[i + 1]) r.unlocked.push(`Mở khóa chương ${i + 2}: ${BOSSES[BOSS_ORDER[i + 1]].name}`);
        else r.unlocked.push('Mở khóa chế độ Đấu data!');
      }
    }
    if (s.mode === 'ghost') {
      r.rankPoints += won ? 25 : -10; r.rating += won ? 25 : -12;
      if (won) { r.gold += 250; r.rare += 1; }
    }
    // Meta money (F-178, F-173): the win-map reward (small consolation on a loss) pays carried debt + loans still
    // unpaid at the end of the match first; the rest is carried to the next match's budget. Unpaid loans become debt.
    const reward = s.usdtReward ?? (won ? ECON.winReward : ECON.loseReward);
    const owe = (p.debt || 0) + Math.max(0, s.matchDebt || 0);
    const paid = Math.min(reward, owe);
    p.debt = owe - paid;
    p.usdt = (p.usdt || 0) + reward - paid;
    r.usdt = { reward, debtPaid: paid, kept: reward - paid, matchDebt: Math.max(0, s.matchDebt || 0), usdt: p.usdt, debt: p.debt };
    // Stats (F-114)
    const st = p.stats;
    st.matches++; if (won) st.wins++;
    const bc = st.byCommander[s.commander] ||= { played: 0, won: 0 };
    bc.played++; if (won) bc.won++;
    for (const u of new Set(s.formation.map(f => f.unit))) { const bu = st.byUnit[u] ||= { played: 0, won: 0 }; bu.played++; if (won) bu.won++; }
    const bm = st.byMode[s.mode] ||= { played: 0, won: 0 };
    bm.played++; if (won) bm.won++;
    // Learned tendencies for the adaptive enemy (pillar 4).
    const L = p.learned; L.matches++;
    for (const [o, n] of Object.entries(s.orders || {})) L.orders[o] = (L.orders[o] || 0) + n;
    for (const f of s.formation) { const g = UNITS[f.unit]?.group; if (g) L.unitMix[g] = (L.unitMix[g] || 0) + (f.count || 1); }
    // Missions
    for (const m of p.missions.list) {
      const d = missionDef(m.id); if (!d || m.done) { if (d) r.missions.push({ text: d.text, progress: m.progress, target: d.target, done: m.done, justDone: false }); continue; }
      m.progress = Math.min(d.target, m.progress + missionIncrement(d, s));
      let justDone = false;
      if (m.progress >= d.target) { m.done = true; justDone = true; r.gold += d.reward.gold || 0; r.rare += d.reward.rare || 0; r.badges += d.reward.badges || 0; }
      r.missions.push({ text: d.text, progress: m.progress, target: d.target, done: m.done, justDone, reward: d.reward });
    }
  }
  p.gold += r.gold; p.rareMaterials += r.rare; p.badges += r.badges;
  p.rankPoints = Math.max(0, p.rankPoints + r.rankPoints);
  p.rating = Math.max(100, p.rating + r.rating);
  p.cosmetics.passXp += r.passXp;
  p.history.unshift({ t: date.getTime(), mode: s.mode, won, commander: s.commander, map: s.mapId, reason: s.reason });
  p.history.length = Math.min(p.history.length, 20);
  return r;
}

// ---------- ghost-fight limits (F-107) ----------
export const GHOST_DAILY_LIMIT = 3;
export function ghostFightsToday(p, id, date = new Date()) {
  const day = todayKey(date);
  if (p.ghostFights.day !== day) return 0;
  return p.ghostFights.counts[id] || 0;
}
export function recordGhostFight(p, id, date = new Date()) {
  const day = todayKey(date);
  if (p.ghostFights.day !== day) p.ghostFights = { day, counts: {} };
  p.ghostFights.counts[id] = (p.ghostFights.counts[id] || 0) + 1;
}

export function winRate(rec) { return rec && rec.played ? rec.won / rec.played : 0; }
export { unitDef };

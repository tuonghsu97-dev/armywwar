// OWNER: agent Kinh tế & HUD
// Victory / defeat (order 90): GDD §13 F-150..F-157.
//  Win 1 / Lose 1: enemy / own HQ destroyed.   Win 2 / Lose 2: surrender ({type:'surrender'}, AI surrenders when hopeless).
//  Win 3: 1-hour limit → higher occupation score; tie → more soldiers; tie → draw (winner -1).
//  Lose 3: out of soldiers (reserve + training + everyone in living units == 0).
//  Lose 4: bankrupt (loan due, liquidation could not cover it — set by sim/economy.js).
import { MATCH_LIMIT } from '../core/game.js';
import { soldiersAlive } from './economy.js';

// Decisive phase (F-16, match length 8–12 min): from SIEGE.start seconds of battle, damage to structures ramps up
// by perMin each minute (max ×max) so stalemates break before ~15 min. Skirmish / ghost only (not boss / tutorial).
// From bombardStart, both HQs also take strategic bombardment (maxHp × bombard per second, +50% per strongpoint the
// enemy holds) so even a frozen front ends in ~4 min; the side holding more strongpoints drains the other faster.
export const SIEGE = { start: 420, perMin: 1, max: 6, bombardStart: 660, bombard: 0.0025, perSp: 0.5 };
function bombard(game, dt) {
  if (game.mode !== 'skirmish' && game.mode !== 'ghost') return;
  if (game.battleTime < SIEGE.bombardStart) return;
  if (!game.bombardAnnounced) {
    game.bombardAnnounced = true;
    for (const side of [0, 1]) game.events.emit('toast', { side, text: 'Pháo kích chiến lược: thành chỉ huy hai bên mất máu dần, càng nhanh khi địch giữ nhiều cứ điểm!' });
  }
  for (const side of [0, 1]) {
    const hq = game.hq(side);
    if (!hq || !hq.alive) continue;
    const enemySp = game.strongpoints.filter(sp => sp.owner === 1 - side).length;
    hq.hp -= hq.maxHp * SIEGE.bombard * (1 + SIEGE.perSp * enemySp) * dt;
    if (hq.hp <= 0) { hq.hp = 0; hq.alive = false; game.events.emit('structure:destroyed', { structure: hq, by: 1 - side }); }
  }
}
export function siegeMult(game) {
  if (game.phase !== 'battle' || (game.mode !== 'skirmish' && game.mode !== 'ghost')) return 1;
  const over = game.battleTime - SIEGE.start;
  return over <= 0 ? 1 : Math.min(SIEGE.max, 1 + SIEGE.perMin * over / 60);
}

// Hopeless = army crushed AND (HQ below half, or enemy holds most strongpoints with a big score lead, or broke).
export const AI_SURRENDER = { minTime: 480, armyRatio: 0.25, countRatio: 0.5, hqFrac: 0.5, spShare: 0.55, scoreLead: 1.0, broke: 30_000_000, hold: 25 };

const name = (game, i) => game.sides[i].name;

export function armyValue(game, side) {
  let v = 0;
  for (const u of game.units.values()) if (u.alive && u.side === side) v += Math.max(u.value || 0, 1_000_000) * u.hpFrac;
  return v;
}

// Returns {winner, reason} or null. Pure check so tests / UI can call it.
export function checkVictory(game) {
  const S = game.sides;
  // HQ destroyed (F-150 / F-153).
  const hqDead = [0, 1].map(i => { const h = game.hq(i); return !h || !h.alive; });
  if (hqDead[0] && hqDead[1]) return { winner: -1, reason: 'Hai thành chỉ huy cùng bị phá hủy — hòa' };
  for (const i of [0, 1]) if (hqDead[i]) return { winner: 1 - i, reason: `Thành chỉ huy của ${name(game, i)} đã bị phá hủy` };
  // Surrender (F-151 / F-154).
  for (const i of [0, 1]) if (S[i].surrendered) return { winner: 1 - i, reason: `${name(game, i)} đã đầu hàng` };
  // Bankrupt (F-156).
  for (const i of [0, 1]) if (S[i].bankrupt) return { winner: 1 - i, reason: `${name(game, i)} phá sản: không trả được nợ đến hạn dù đã bán khí tài` };
  if (game.phase !== 'battle') return null;
  // Out of soldiers (F-155).
  const sold = [0, 1].map(i => soldiersAlive(game, i));
  if (sold[0] <= 0 && sold[1] <= 0) return { winner: -1, reason: 'Cả hai phe đều hết binh lính — hòa' };
  for (const i of [0, 1]) if (sold[i] <= 0) return { winner: 1 - i, reason: `${name(game, i)} đã hết binh lính` };
  // Time limit (F-152).
  if (game.battleTime >= MATCH_LIMIT) {
    const a = Math.floor(S[0].score), b = Math.floor(S[1].score);
    if (a !== b) { const w = a > b ? 0 : 1; return { winner: w, reason: `Hết 1 giờ — ${name(game, w)} có điểm chiếm đóng cao hơn (${Math.max(a, b)} – ${Math.min(a, b)})` }; }
    if (sold[0] !== sold[1]) { const w = sold[0] > sold[1] ? 0 : 1; return { winner: w, reason: `Hết 1 giờ, hòa điểm — ${name(game, w)} còn nhiều binh lính hơn (${sold[w]} – ${sold[1 - w]})` }; }
    return { winner: -1, reason: 'Hết 1 giờ — hòa điểm và hòa quân số' };
  }
  return null;
}

// AI gives up when its army is crushed (by value and by count) and the map is lost (held for a few seconds).
function aiSurrender(game, dt) {
  if (game.battleTime < AI_SURRENDER.minTime) return;
  for (const S of game.sides) {
    if (!S.ai || S.surrendered || (S.noSurrender ?? (game.mode !== 'skirmish' && game.mode !== 'ghost'))) continue;
    const mine = armyValue(game, S.id), theirs = armyValue(game, 1 - S.id);
    const hq = game.hq(S.id);
    const A = AI_SURRENDER, E = game.sides[1 - S.id];
    const nMine = game.sideUnits(S.id).length, nTheirs = game.sideUnits(E.id).length;
    const crushed = theirs > 0 && mine < theirs * A.armyRatio && nMine < nTheirs * A.countRatio;
    const spTheirs = game.strongpoints.filter(sp => sp.owner === E.id).length / Math.max(1, game.strongpoints.length);
    const losingMap = spTheirs >= A.spShare && E.score > S.score * A.scoreLead;
    const hopeless = crushed && ((hq && hq.hp / hq.maxHp < A.hqFrac) || losingMap || S.money < A.broke);
    S.hopeless = hopeless ? (S.hopeless || 0) + dt : 0;
    if (S.hopeless >= AI_SURRENDER.hold) {
      game.issue(S.id, { type: 'surrender' });
      S.hopeless = -Infinity;
    }
  }
}

export const victorySystem = {
  name: 'victory',
  update(game, dt) {
    if (game.ended) return;
    if (game.phase === 'battle' && game.tick % 20 === 0) aiSurrender(game, 1);
    game.structureDmgMult = siegeMult(game);
    if (game.phase === 'battle') bombard(game, dt);
    if (game.structureDmgMult > 1 && !game.siegeAnnounced) {
      game.siegeAnnounced = true;
      game.events.emit('siege', { mult: game.structureDmgMult });
      for (const side of [0, 1]) game.events.emit('toast', { side, text: 'Giai đoạn quyết chiến: sát thương lên công trình tăng dần mỗi phút!' });
    }
    const r = checkVictory(game);
    if (r) game.end(r.winner, r.reason);
  },
};
export function install(game) { game.addSystem(victorySystem, 90); }

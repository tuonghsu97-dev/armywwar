// OWNER: agent Meta & chế độ chơi.
// Pre/post-match screens (GDD §2 step 1, §3, §6, §7, §8, §9):
//  main menu (F-01) · commander select (F-04/F-20..F-26) · formation builder (9 slots, CP, max 3 T3, budget,
//  tier unlocks with gold / rare materials) · map select (F-90..F-93) · boss campaign (F-100..F-102) ·
//  ghost opponent picker (F-104/F-107) · profile: missions, skins, battle pass, win-rate stats (F-111..F-114) ·
//  result screen. attachMatch() adds the in-match boss bar / ghost tag / tutorial overlay.
import { COMMANDERS, COMMANDER_IDS } from '../data/commanders.js';
import { UNITS, TIERS, MAX_SLOTS, MAX_T3, CP_LIMIT, formatUSD, tierBonusText, activeAccessories } from '../data/units.js';
import { MAPS } from '../data/maps.js';
import { START_MONEY } from '../core/game.js';
import { BOSSES, BOSS_ORDER, BOSS_PHASES } from '../data/bosses.js';
import { SKINS, PASS_LEVELS, PASS_XP_PER_LEVEL, PASS_PREMIUM_COST } from '../data/missions.js';
import * as P from '../core/profile.js';
import * as Ghost from '../sim/ghost.js';
import { Tutorial, tutorialMatchOpts, showMenuHint, hideMenuHint } from './tutorial.js';

const GROUP_LABEL = { infantry: 'Bộ binh', tank: 'Mặt đất', drone: 'Drone', air: 'Máy bay', navy: 'Tàu chiến', sub: 'Tàu ngầm', aa: 'Phòng không', energy: 'Năng lượng', ew: 'Tác chiến điện tử' };
const WEATHER = { clear: 'Quang đãng', rain: 'Mưa — giảm tầm nhìn', fog: 'Sương mù — ẩn drone' };
const MODE_LABEL = { skirmish: 'Chơi nhanh', boss: 'Chiến dịch Boss', ghost: 'Đấu data', tutorial: 'Hướng dẫn' };

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const img = (src, cls = '', ph = '') => `<span class="mimg ${cls}"><img src="${src}" alt="" onerror="this.parentNode.classList.add('noimg');this.remove()"><i>${esc(ph)}</i></span>`;
const unitImg = id => img(`assets/img/units/${id}.png`, 'unit-img', UNITS[id]?.name?.[0] || '?');
const cmdImg = id => img(`assets/img/commanders/${id}.png`, 'cmd-img', COMMANDERS[id]?.name?.split(' ').pop()?.[0] || '?');
const pct = v => Math.round(v * 100) + '%';
const fmtTime = s => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function pre(app) {
  const p = P.getProfile();
  return app.pre || (app.pre = { mode: 'skirmish', commander: p.lastCommander || 'steel', formation: null, mapId: 'plains', sel: 0 });
}

function toast(text) {
  let box = document.getElementById('meta-toasts');
  if (!box) { box = document.createElement('div'); box.id = 'meta-toasts'; document.getElementById('app').appendChild(box); }
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = text;
  box.appendChild(t); setTimeout(() => t.remove(), 3200);
}

function currencyBar(p) {
  return `<div class="meta-cur">
    <span title="Vàng — thắng trận, nhiệm vụ ngày; dùng nâng tier, mở đơn vị">🪙 <b>${p.gold}</b></span>
    <span title="Vật liệu hiếm — boss, đấu data; dùng nâng T3">◆ <b>${p.rareMaterials}</b></span>
    <span title="Huy hiệu chỉ huy — chỉ đổi skin/battle pass">✪ <b>${p.badges}</b></span>
    <span id="meta-usdt" title="USDT mang sang trận sau (dư thưởng thắng map) — cộng vào ngân sách 1 tỷ">💵 <b>${formatUSD(p.usdt || 0)}</b></span>
    ${p.debt ? `<span id="meta-debt" class="bad" title="Nợ USDT mang sang — trừ vào ngân sách trận sau">💸 Nợ <b>${formatUSD(p.debt)}</b></span>` : ''}
    <span title="Hạng">🎖 <b>${P.rankName(p.rating)}</b> <small>${p.rating}</small></span>
  </div>`;
}

export function showScreen(app, name, params = {}) {
  hideMenuHint();
  const root = document.getElementById('screens');
  root.innerHTML = '';
  if (name === 'none') return;
  const el = document.createElement('div');
  el.className = 'screen meta-screen meta-' + name;
  el.dataset.screen = name;
  root.appendChild(el);
  const fn = SCREENS[name] || SCREENS.main;
  fn(app, el, params);
}

const go = (app, name, params) => showScreen(app, name, params);

// ------------------------------------------------------------------ main menu (F-01)
function mainMenu(app, el) {
  const p = P.getProfile();
  P.ensureDailyMissions(p);
  const ghostOk = P.ghostUnlocked(p);
  const cleared = BOSS_ORDER.filter(b => p.bossCleared.includes(b)).length;
  el.innerHTML = `
    <div class="menu-wrap">
      <div class="menu-left">
        <img class="menu-logo" src="assets/img/logo.png" alt="" onerror="this.remove()">
        <h1 class="menu-title">WARGRID: Chỉ Huy AI</h1>
        <h2>MOBA chiến thuật 2.5D — bạn là chỉ huy, AI thực thi</h2>
        <div class="menu-buttons">
          <button class="primary big" id="btn-quick">▶ Chơi nhanh</button>
          <button class="big" id="btn-boss">☠ Chiến dịch Boss <small>${cleared}/${BOSS_ORDER.length}</small></button>
          <button class="big ${ghostOk ? '' : 'locked'}" id="btn-ghost" ${ghostOk ? '' : 'aria-disabled="true"'}>${ghostOk ? '⚔' : '🔒'} Đấu data</button>
          ${ghostOk ? '' : `<div class="lock-reason" id="ghost-lock-reason">Vượt hết ${BOSS_ORDER.length} ải boss để mở khóa (đã hạ ${cleared}/${BOSS_ORDER.length})</div>`}
          <button class="big" id="btn-tutorial">🎓 Hướng dẫn chơi</button>
          <button class="big" id="btn-profile">📜 Hồ sơ & Nhiệm vụ</button>
          <button class="big" id="btn-settings">⚙ Cài đặt</button>
        </div>
      </div>
      <div class="menu-right">
        <div class="panel meta-card">${currencyBar(p)}</div>
        <div class="panel meta-card">
          <h3>Nhiệm vụ hôm nay</h3>
          ${missionList(p)}
        </div>
        <div class="panel meta-card small muted">
          Chỉ huy hiện tại: <b>${esc(COMMANDERS[p.lastCommander]?.name)}</b> · Trận đã chơi: ${p.stats.matches} · Thắng: ${p.stats.wins}
        </div>
      </div>
    </div>`;
  const $ = s => el.querySelector(s);
  $('#btn-quick').onclick = () => { app.pre = null; pre(app).mode = 'skirmish'; go(app, 'commander'); };
  $('#btn-boss').onclick = () => go(app, 'boss');
  $('#btn-ghost').onclick = () => ghostOk ? go(app, 'ghost') : toast(`Đấu data bị khóa: vượt hết ${BOSS_ORDER.length} ải boss trước (đã hạ ${cleared}/${BOSS_ORDER.length}).`);
  $('#btn-tutorial').onclick = () => startTutorial(app);
  $('#btn-profile').onclick = () => go(app, 'profile');
  $('#btn-settings').onclick = () => go(app, 'settings');
  if (!p.tutorialDone && !p.menuHintSkipped) setTimeout(() => { if (el.isConnected) showMenuHint('#btn-tutorial'); }, 300);
}

function missionList(p) {
  return `<ul class="missions">${p.missions.list.map(m => {
    const d = P.missionDef(m.id); if (!d) return '';
    const rw = [d.reward.gold ? `${d.reward.gold}🪙` : '', d.reward.rare ? `${d.reward.rare}◆` : '', d.reward.badges ? `${d.reward.badges}✪` : ''].filter(Boolean).join(' ');
    return `<li class="${m.done ? 'done' : ''}"><div class="m-text">${m.done ? '✔ ' : ''}${esc(d.text)} <span class="muted">${rw}</span></div>
      <div class="bar"><i style="width:${Math.min(100, m.progress / d.target * 100)}%"></i></div><small>${m.progress}/${d.target}</small></li>`;
  }).join('')}</ul>`;
}

export function startTutorial(app) {
  app.pre = null;
  app.startMatch(tutorialMatchOpts());
}

// ------------------------------------------------------------------ commander select (F-04, F-20..F-26)
function commanderScreen(app, el) {
  const S = pre(app);
  const modeInfo = S.mode === 'boss' ? `Ải boss: <b>${esc(BOSSES[S.bossId]?.name)}</b>` : S.mode === 'ghost' ? `Đấu data với: <b>${esc(S.ghost?.playerName)}</b>` : 'Chơi nhanh';
  el.innerHTML = `
    <div class="meta-head"><button id="btn-back">◀ Quay lại</button><div><h1>Chọn chỉ huy</h1><h2>${modeInfo} · Bước 1/${S.mode === 'skirmish' ? 3 : 2} — chỉ huy khóa khi vào trận, đổi được giữa các trận</h2></div></div>
    <div class="cmd-grid">
      ${COMMANDER_IDS.map(id => { const c = COMMANDERS[id]; return `
        <div class="cmd-card panel ${S.commander === id ? 'sel' : ''}" data-cmd="${id}" style="--c:${c.color}">
          ${cmdImg(id)}
          <div class="cmd-body">
            <h3>${esc(c.name)}</h3>
            <div class="tag">${esc(c.domain)} · ${esc(c.doctrine)}</div>
            <div class="kv"><b>Thế mạnh:</b> ${esc(c.strengths)}</div>
            <div class="kv"><b>Điểm yếu:</b> ${esc(c.weaknesses)}</div>
            <div class="kv"><b>Thụ động — ${esc(c.passive.name)}:</b> ${esc(c.passive.desc)}</div>
            <div class="kv"><b>Lệnh tối thượng — ${esc(c.ultimate.name)}</b> (${c.ultimate.cost} điểm chỉ huy): ${esc(c.ultimate.desc)}</div>
            <div class="kv"><b>Thưởng tier:</b> ${esc(c.tierBonus.desc)}</div>
          </div>
        </div>`; }).join('')}
      <div class="cmd-card panel disabled" id="deputy-card" title="Ngoài MVP">
        <span class="mimg cmd-img noimg"><i>?</i></span>
        <div class="cmd-body"><h3>Phó tướng — sắp ra mắt</h3><div class="tag">Mở rộng tương lai</div><div class="kv muted">Chỉ huy phụ sẽ có trong bản cập nhật sau.</div></div>
      </div>
    </div>
    <div class="meta-foot"><button class="primary big" id="btn-next">Tiếp: Xếp đội hình ▶</button></div>`;
  el.querySelectorAll('.cmd-card[data-cmd]').forEach(c => c.onclick = () => {
    S.commander = c.dataset.cmd; S.formation = null;
    el.querySelectorAll('.cmd-card').forEach(x => x.classList.toggle('sel', x === c));
  });
  el.querySelector('#btn-back').onclick = () => go(app, S.mode === 'boss' ? 'boss' : S.mode === 'ghost' ? 'ghost' : 'main');
  el.querySelector('#btn-next').onclick = () => go(app, 'formation');
}

// ------------------------------------------------------------------ formation builder (F-04, F-52, F-82, F-83, F-110, F-170..F-172)
function loadFormation(S, p) {
  if (S.formation && S.formationFor === S.commander) return;
  const saved = p.lastFormation[S.commander];
  if (saved && saved.length) {
    const loan = (p.lastLoan || {})[S.commander] || 0;
    const f = P.normalizeFormation(saved).map(s => ({ unit: s.unit, tier: Math.min(s.tier || 1, P.unitTier(p, s.unit)), count: 1 }));
    if (P.validateFormation(f, { profile: p, budget: P.budgetFor(loan, P.metaBudget(p)) }).ok) { S.formation = f; S.loan = loan; S.formationFor = S.commander; return; }
  }
  const r = P.recommendWithLoan(S.commander, { profile: p, base: P.metaBudget(p) });
  S.formation = r.formation; S.loan = r.loan;
  S.formationFor = S.commander;
}

function mapHints(unitId, fixedMap) {
  const g = UNITS[unitId].group;
  const ids = fixedMap ? [fixedMap] : Object.keys(MAPS);
  const fav = ids.filter(m => MAPS[m].favoredGroups.includes(g)).map(m => MAPS[m].name);
  const lim = ids.filter(m => MAPS[m].limitedGroups.includes(g)).map(m => MAPS[m].name);
  return (fav.length ? `<span class="hint good" title="Bản đồ lợi thế">▲ ${fav.join(', ')}</span>` : '') + (lim.length ? `<span class="hint bad" title="Bản đồ bất lợi">▼ ${lim.join(', ')}</span>` : '');
}

function formationScreen(app, el) {
  const S = pre(app), p = P.getProfile();
  loadFormation(S, p);
  const fixedMap = S.mode === 'boss' ? BOSSES[S.bossId].map : S.mode === 'ghost' ? S.ghost.mapId : null;
  S.loan = S.loan || 0;
  const base = P.metaBudget(p);                 // 1 tỷ + USDT mang sang − nợ (F-178)
  const bud = () => P.budgetFor(S.loan, base);
  const render = () => {
    const f = S.formation;
    if (S.sel >= MAX_SLOTS) S.sel = 0;
    const B = bud();
    const v = P.validateFormation(f, { profile: p, budget: B });
    const loanObj = S.loan ? P.makePreLoan(S.loan) : null;
    const cat = Object.keys(UNITS);
    const groups = {};
    for (const id of cat) (groups[UNITS[id].group] ||= []).push(id);
    el.innerHTML = `
      <div class="meta-head"><button id="btn-back">◀ Chỉ huy</button><div><h1>Xếp đội hình — ${esc(COMMANDERS[S.commander].name)}</h1>
        <h2>Bước 2/${S.mode === 'skirmish' ? 3 : 2}${fixedMap ? ' (bản đồ cố định: ' + esc(MAPS[fixedMap]?.name) + ')' : ''} · 9 ô = 9 khí tài (mỗi ô 1 vũ khí/đơn vị, bầy drone = 1 ô) · ${CP_LIMIT} điểm chỉ huy (CP) · tối đa ${MAX_T3} đơn vị T3 · ngân sách 1 tỷ USDT ± tiền/nợ mang sang (+ vay trước trận)</h2></div>
        <div class="panel meta-card head-cur">${currencyBar(p)}</div></div>
      <div class="totals panel">
        <div class="tot ${f.length > MAX_SLOTS ? 'over' : ''}"><span>Ô</span><b id="tot-slots">${f.length}/${MAX_SLOTS}</b></div>
        <div class="tot ${v.cp > CP_LIMIT ? 'over' : ''}"><span>Điểm chỉ huy</span><b id="tot-cp">${v.cp}/${CP_LIMIT}</b><div class="bar"><i style="width:${Math.min(100, v.cp / CP_LIMIT * 100)}%"></i></div></div>
        <div class="tot ${v.price > B ? 'over' : ''}"><span>Giá khí tài / ngân sách</span><b id="tot-price">${formatUSD(v.price)} / ${formatUSD(B)} USDT</b><div class="bar"><i style="width:${Math.min(100, v.price / B * 100)}%"></i></div><small class="muted">Còn lại vào trận: <b id="tot-money">${formatUSD(Math.max(0, B - v.price))}</b> USDT</small>
          <small class="muted" id="tot-meta">Ngân sách = 1 tỷ${p.usdt ? ` + dư ${formatUSD(p.usdt)}` : ''}${p.debt ? ` − nợ ${formatUSD(p.debt)}` : ''}${S.loan ? ` + vay ${formatUSD(S.loan)}` : ''}${p.debt > START_MONEY + (p.usdt || 0) ? ' · nợ vượt ngân sách: chỉ xếp được đội hình bằng tiền vay' : ''}</small></div>
        <div class="tot loan-box" id="preloan"><span>Vay trước trận (lãi ${Math.round(P.makePreLoan(1).rate * 100)}%, hạn ~${Math.round((P.makePreLoan(1).due - 30) / 60)} phút trận)</span>
          <div class="fs-row">${P.PRELOAN_OPTIONS.map(a => `<button class="loan-btn ${S.loan === a ? 'on' : ''}" data-amount="${a}">${a ? formatUSD(a) : 'Không vay'}</button>`).join('')}</div>
          ${loanObj ? `<small class="debt" id="tot-debt">Nợ phải trả: <b>${formatUSD(loanObj.owed)}</b> USDT — đến hạn không đủ tiền sẽ bị bán khí tài 55% giá</small>` : ''}</div>
        <div class="tot ${v.t3 > MAX_T3 ? 'over' : ''}"><span>T3</span><b id="tot-t3">${v.t3}/${MAX_T3}</b></div>
        <div class="tot-btns"><button id="btn-recommend" title="Điền đội hình đề xuất của chỉ huy">★ Đề xuất</button><button id="btn-clear">Xóa hết</button></div>
      </div>
      <div class="form-wrap">
        <div class="slots">
          ${Array.from({ length: MAX_SLOTS }, (_, i) => slotHtml(f[i], i, S.sel === i, p, v.t3)).join('')}
          ${v.errors.length ? `<div class="errors">${v.errors.map(e => `<div>⚠ ${esc(e)}</div>`).join('')}</div>` : ''}
        </div>
        <div class="catalog panel">
          <div class="cat-title">Kho đơn vị — click để thêm vào ô ${S.sel + 1}${fixedMap ? ` · bản đồ: <b>${esc(MAPS[fixedMap].name)}</b>` : ''}</div>
          ${Object.entries(groups).map(([g, ids]) => `<div class="cat-group"><div class="cat-gname">${GROUP_LABEL[g] || g}</div>${ids.map(id => catItem(id, f, p, fixedMap, B)).join('')}</div>`).join('')}
        </div>
      </div>
      <div class="meta-foot"><button class="primary big" id="btn-next" ${v.ok ? '' : 'disabled'}>${S.mode === 'skirmish' ? 'Tiếp: Chọn bản đồ ▶' : '▶ Vào trận'}</button></div>`;
    bind(v);
  };
  const bind = () => {
    const $ = s => el.querySelector(s);
    $('#btn-back').onclick = () => go(app, 'commander');
    $('#btn-recommend').onclick = () => {
      const r = P.recommendWithLoan(S.commander, { profile: p, base });
      S.formation = r.formation; S.loan = r.loan;
      if (r.loan) toast(`Đề xuất kèm khoản vay ${formatUSD(r.loan)} USDT (phải trả ${formatUSD(P.makePreLoan(r.loan).owed)})`); S.sel = Math.min(r.formation.length, MAX_SLOTS - 1);
      if (r.skipped.length) toast('Bỏ qua: ' + r.skipped.map(s => `${UNITS[s.unit].name} (${s.reason})`).join(', '));
      render();
    };
    el.querySelectorAll('.loan-btn').forEach(b => b.onclick = () => {
      const a = Number(b.dataset.amount);
      if (P.formationTotals(S.formation).price > P.budgetFor(a, base)) { toast('Đội hình hiện tại vượt ngân sách khi giảm khoản vay — bỏ bớt đơn vị trước'); return; }
      S.loan = a; render();
    });
    $('#btn-clear').onclick = () => { S.formation = []; S.sel = 0; render(); };
    el.querySelectorAll('.fslot').forEach(d => d.onclick = e => { if (e.target.closest('button')) return; S.sel = Number(d.dataset.slot); render(); });
    el.querySelectorAll('.fslot .rm').forEach(b => b.onclick = () => { S.formation.splice(Number(b.dataset.slot), 1); render(); });
    el.querySelectorAll('.fslot .tier-btn').forEach(b => b.onclick = () => {
      const s = S.formation[Number(b.dataset.slot)], t = Number(b.dataset.tier);
      if (t > P.unitTier(p, s.unit)) return;
      const test = S.formation.map(x => x === s ? { ...s, tier: t } : x);
      const v2 = P.validateFormation(test);
      if (v2.t3 > MAX_T3) { toast(`Tối đa ${MAX_T3} đơn vị T3`); return; }
      if (v2.cp > CP_LIMIT && t > (s.tier || 1)) { toast('Vượt giới hạn điểm chỉ huy'); return; }
      if (v2.price > bud() && t > (s.tier || 1)) { toast('Vượt ngân sách — có thể vay trước trận'); return; }
      s.tier = t; render();
    });
    el.querySelectorAll('.btn-unlock-tier').forEach(b => b.onclick = () => {
      const r = P.upgradeUnitTier(p, b.dataset.unit);
      if (!r.ok) { toast(r.reason); return; }
      P.saveProfile(p); toast(`Đã mở T${r.tier} cho ${UNITS[b.dataset.unit].name}`); render();
    });
    el.querySelectorAll('.unit-item').forEach(d => d.onclick = e => {
      const id = d.dataset.unit;
      if (e.target.closest('.btn-unlock-unit')) {
        const r = P.unlockUnit(p, id); if (!r.ok) { toast(r.reason); return; }
        P.saveProfile(p); toast('Đã mở khóa ' + UNITS[id].name); render(); return;
      }
      const slot = { unit: id, tier: 1, count: 1 };   // 1 slot = 1 weapon (F-52)
      const others = S.formation.filter((_, i) => i !== S.sel);
      const r = P.addSlotReason(others, slot, { profile: p, budget: bud(), base });
      if (r) { toast(`${UNITS[id].name}: ${r}`); return; }
      if (S.sel < S.formation.length) S.formation[S.sel] = slot; else S.formation.push(slot);
      S.sel = Math.min(S.formation.length, MAX_SLOTS - 1);
      render();
    });
    $('#btn-next').onclick = () => {
      const v = P.validateFormation(S.formation, { profile: p, budget: bud() });
      if (!v.ok) { toast(v.errors[0]); return; }
      p.lastFormation[S.commander] = S.formation.map(s => ({ ...s }));
      (p.lastLoan ||= {})[S.commander] = S.loan;
      p.lastCommander = S.commander;
      P.saveProfile(p);
      if (S.mode === 'skirmish') go(app, 'map'); else launch(app);
    };
  };
  render();
}

function slotHtml(s, i, sel, p, t3) {
  if (!s) return `<div class="fslot empty ${sel ? 'sel' : ''}" data-slot="${i}"><div class="num">${i + 1}</div><div class="muted">Ô trống<br><small>chọn đơn vị bên phải</small></div></div>`;
  const d = UNITS[s.unit], unlocked = P.unitTier(p, s.unit);
  const tierBtns = [1, 2, 3].map(t => `<button class="tier-btn ${(s.tier || 1) === t ? 'on' : ''}" data-slot="${i}" data-tier="${t}" ${t > unlocked ? 'disabled title="Chưa mở khóa tier này"' : ''}>T${t}</button>`).join('');
  let unlock = '';
  if (unlocked < 3) {
    const c = P.tierUpgradeCost(s.unit, unlocked + 1), r = P.upgradeTierReason(p, s.unit);
    unlock = `<button class="btn-unlock-tier small" data-unit="${s.unit}" title="${esc(r || 'Mở khóa vĩnh viễn cho loại đơn vị này')}" ${r ? 'disabled' : ''}>Mở T${unlocked + 1}: ${c.gold}🪙${c.rare ? ` + ${c.rare}◆` : ''}</button>`;
  }
  return `<div class="fslot ${sel ? 'sel' : ''}" data-slot="${i}">
    <div class="num">${i + 1}</div><button class="rm" data-slot="${i}" title="Bỏ khỏi đội hình">✕</button>
    ${unitImg(s.unit)}
    <div class="fs-name">${esc(d.name)}</div>
    <div class="fs-meta">${P.slotCp(s)} CP · ${formatUSD(P.slotPrice(s))}</div>
    <div class="fs-row"><span class="muted">${d.swarmCount ? `Bầy ${d.swarmCount} drone = 1 ô` : '1 khí tài / ô'}</span></div>
    <div class="fs-row tiers">${tierBtns}</div>
    ${unlock}
    <div class="fs-acc muted">${(s.tier || 1) > 1 ? esc(tierBonusText(s.tier)) + '<br>Phụ kiện: ' + activeAccessories(d, s.tier).map(a => `<span title="${esc(a.desc)}">${esc(a.name)}</span>`).join(', ') : ''}</div>
  </div>`;
}

function catItem(id, f, p, fixedMap, budget = START_MONEY) {
  const d = UNITS[id];
  const locked = !P.isUnitUnlocked(p, id);
  const reason = locked ? (P.unlockUnitReason(p, id) || `Mở khóa: ${P.LOCKED_UNITS[id].gold}🪙`) : P.addSlotReason(f, { unit: id, tier: 1, count: 1 }, { profile: p, budget, base: P.metaBudget(p) });
  return `<div class="unit-item ${reason ? 'blocked' : ''} ${locked ? 'locked' : ''}" data-unit="${id}" title="${esc(d.role + ' — ' + d.skill)}">
    ${unitImg(id)}
    <div class="ui-body"><div class="ui-name">${esc(d.name)} <span class="rank r-${d.rank}">${d.rank}</span></div>
      <div class="ui-meta">${d.cp} CP · ${formatUSD(d.price * (d.swarmCount || 1))}${d.swarmCount ? ' / bầy' : ''} · ${esc(d.role)}</div>
      <div class="ui-hints">${mapHints(id, fixedMap)}</div>
      ${reason ? `<div class="ui-reason">🔒 ${esc(reason)}</div>` : ''}
      ${locked && !P.unlockUnitReason(p, id) ? `<button class="btn-unlock-unit small">Mở khóa ${P.LOCKED_UNITS[id].gold}🪙</button>` : ''}
    </div></div>`;
}

// ------------------------------------------------------------------ map select (F-90..F-93, F-98)
function mapScreen(app, el) {
  const S = pre(app);
  const myGroups = new Set(S.formation.map(s => UNITS[s.unit].group));
  el.innerHTML = `
    <div class="meta-head"><button id="btn-back">◀ Đội hình</button><div><h1>Chọn bản đồ</h1><h2>Bước 3/3 · mỗi bản đồ có 3 đường + vùng giữa + căn cứ hai bên</h2></div></div>
    <div class="map-grid">
      ${Object.entries(MAPS).map(([id, m]) => {
        const good = m.favoredGroups.filter(g => myGroups.has(g)).map(g => GROUP_LABEL[g]);
        const bad = m.limitedGroups.filter(g => myGroups.has(g)).map(g => GROUP_LABEL[g]);
        return `<div class="map-card panel ${S.mapId === id ? 'sel' : ''}" data-map="${id}">
          ${img(`assets/img/maps/${id}.jpg`, 'map-img', m.name)}
          <h3>${esc(m.name)}</h3>
          <div class="kv"><b>Địa hình:</b> ${esc(m.terrain)}</div>
          <div class="kv"><b>Chiến thuật:</b> ${esc(m.tactic)}</div>
          <div class="kv good"><b>Lợi thế:</b> ${esc(m.favored)}</div>
          <div class="kv bad"><b>Hạn chế:</b> ${esc(m.limited)}</div>
          <div class="kv"><b>Thời tiết:</b> ${WEATHER[m.weather] || m.weather}</div>
          ${good.length || bad.length ? `<div class="kv small">Đội hình của bạn: ${good.length ? `<span class="hint good">▲ ${good.join(', ')}</span>` : ''} ${bad.length ? `<span class="hint bad">▼ ${bad.join(', ')}</span>` : ''}</div>` : ''}
        </div>`; }).join('')}
    </div>
    <div class="meta-foot"><button class="primary big" id="btn-start">▶ Bắt đầu trận</button></div>`;
  el.querySelectorAll('.map-card').forEach(c => c.onclick = () => { S.mapId = c.dataset.map; el.querySelectorAll('.map-card').forEach(x => x.classList.toggle('sel', x === c)); });
  el.querySelector('#btn-back').onclick = () => go(app, 'formation');
  el.querySelector('#btn-start').onclick = () => launch(app);
}

// ------------------------------------------------------------------ start a match from the prepared state
// Skin colour for Game.makeSide (cfg.skinColor, a number). Default skin keeps the team colour.
function skinColorNum(id) {
  const s = SKINS.find(k => k.id === id);
  return s && id !== 'default' ? parseInt(s.color.slice(1), 16) : undefined;
}
// QA #18: the default profile name 'Chỉ huy' made end texts read 'Thành chỉ huy của Chỉ huy…' — show the team name.
export function sideName(p) { const n = (p?.name || '').trim(); return !n || n === 'Chỉ huy' ? 'Phe Xanh (bạn)' : n; }
export function buildMatchOpts(app, meta = null) {
  const S = pre(app), p = P.getProfile();
  const seed = (Date.now() % 1e6) | 0;
  const player = { commander: S.commander, formation: S.formation.map(s => ({ unit: s.unit, tier: s.tier || 1, count: s.count || 1 })),
    rareMaterials: p.rareMaterials, name: sideName(p), skin: p.cosmetics.skin, skinColor: skinColorNum(p.cosmetics.skin) };
  // GDD §15: the 1 tỷ start money (+ pre-match loan) pays for the formation; the rest is battle money.
  // F-178: the budget also carries USDT left from earlier wins minus carried debt (meta = commitMetaBudget result).
  Object.assign(player, P.playerEconomy(player.formation, S.loan || 0, meta ? meta.base : P.metaBudget(p)));
  if (meta) player.meta = meta;
  if (S.mode === 'boss') {
    const b = BOSSES[S.bossId];
    return { mode: 'boss', mapId: b.map, seed, boss: b.id, player,
      enemy: { commander: b.commander, ai: false, name: b.name, formation: b.escort.map(s => ({ ...s })), money: START_MONEY, difficulty: P.difficultyFromRating(p.rating) } };
  }
  if (S.mode === 'ghost') return Ghost.ghostMatchOpts(S.ghost, player, seed);
  return { mode: 'skirmish', mapId: S.mapId, seed, player, enemy: P.buildSkirmishEnemy(p, player, S.mapId, seed) };
}

function launch(app) {
  const S = pre(app), p = P.getProfile();
  if (S.mode === 'ghost') {
    if (P.ghostFightsToday(p, S.ghost.id) >= P.GHOST_DAILY_LIMIT) { toast(`Đã đấu data này ${P.GHOST_DAILY_LIMIT} lần hôm nay`); return; }
    P.recordGhostFight(p, S.ghost.id); P.saveProfile(p);
  }
  const meta = P.commitMetaBudget(p);  // carried USDT goes into this match, carried debt is paid from the budget
  P.saveProfile(p);
  app.startMatch(buildMatchOpts(app, meta));
}

// ------------------------------------------------------------------ boss campaign (F-100..F-102)
function bossScreen(app, el) {
  const p = P.getProfile();
  el.innerHTML = `
    <div class="meta-head"><button id="btn-back">◀ Menu</button><div><h1>Chiến dịch Boss</h1>
      <h2>4 chương · mỗi boss 3 pha: ${Object.values(BOSS_PHASES).map(x => x.name).join(' → ')} · hạ hết để mở khóa Đấu data</h2></div>
      <div class="panel meta-card head-cur">${currencyBar(p)}</div></div>
    <div class="boss-grid">
      ${BOSS_ORDER.map(id => {
        const b = BOSSES[id], done = p.bossCleared.includes(id), open = P.bossUnlocked(p, id);
        return `<div class="boss-card panel ${done ? 'done' : ''} ${open ? '' : 'locked'}" data-boss="${id}">
          ${img(`assets/img/bosses/${b.img}.png`, 'boss-img', '☠')}
          <div class="boss-body">
            <div class="tag">Chương ${b.chapter} · ${esc(MAPS[b.map].name)}</div>
            <h3>${esc(b.name)}</h3>
            <div class="kv">${esc(b.mechanic)}</div>
            <div class="kv muted">💡 ${esc(b.tip)}</div>
            <div class="kv">Thưởng: ${b.rewards.gold}🪙 · ${b.rewards.rare}◆ vật liệu hiếm · ${b.rewards.badges}✪</div>
            <div class="status">${done ? '✔ Đã hạ' : open ? '▶ Sẵn sàng' : `🔒 Hạ ${esc(BOSSES[BOSS_ORDER[b.chapter - 2]].name)} trước`}</div>
          </div></div>`;
      }).join('')}
    </div>`;
  el.querySelector('#btn-back').onclick = () => go(app, 'main');
  el.querySelectorAll('.boss-card').forEach(c => c.onclick = () => {
    const id = c.dataset.boss;
    if (!P.bossUnlocked(p, id)) { toast('Chương này chưa mở khóa'); return; }
    const S = pre(app); S.mode = 'boss'; S.bossId = id; S.ghost = null;
    go(app, 'commander');
  });
}

// ------------------------------------------------------------------ ghost picker (F-104, F-107)
function ghostScreen(app, el, params) {
  const p = P.getProfile();
  if (!P.ghostUnlocked(p)) { go(app, 'main'); return; }
  const pool = Ghost.loadPool();
  const st = app.ghostFilter || (app.ghostFilter = { by: 'rank', commander: 'steel', seed: 1 });
  const opts = { profile: p, by: st.by, commander: st.commander, rating: p.rating, seed: st.seed };
  const list = Ghost.eligibleSnapshots(pool, opts);
  const hidden = Ghost.filteredOutCount(pool, { profile: p, date: new Date() });
  el.innerHTML = `
    <div class="meta-head"><button id="btn-back">◀ Menu</button><div><h1>Đấu data</h1>
      <h2>Đối đầu đội hình + chuỗi lệnh đã lưu của người chơi khác (AI điều khiển, phản ứng khi lệch kịch bản)</h2></div>
      <div class="panel meta-card head-cur">${currencyBar(p)}</div></div>
    <div class="ghost-filters panel">
      Lọc theo:
      <button id="ghost-filter-rank" class="${st.by === 'rank' ? 'on' : ''}">Hạng gần bạn</button>
      <button id="ghost-filter-commander" class="${st.by === 'commander' ? 'on' : ''}">Chỉ huy</button>
      <select id="ghost-commander" ${st.by === 'commander' ? '' : 'disabled'}>${COMMANDER_IDS.map(c => `<option value="${c}" ${st.commander === c ? 'selected' : ''}>${esc(COMMANDERS[c].name)}</option>`).join('')}</select>
      <button id="ghost-filter-random" class="${st.by === 'random' ? 'on' : ''}">🎲 Ngẫu nhiên</button>
      <span class="muted small">${hidden ? `${hidden} data bị ẩn (tỉ lệ thắng bất thường hoặc đã đấu ${P.GHOST_DAILY_LIMIT} lần hôm nay)` : ''}</span>
    </div>
    <div class="ghost-list">
      ${list.length ? list.map(s => {
        const fights = P.ghostFightsToday(p, s.id);
        return `<div class="ghost-card panel" data-ghost="${esc(s.id)}">
          ${cmdImg(s.commander)}
          <div class="g-body"><h3>${esc(s.playerName)} ${s.own ? '<span class="tag">của bạn</span>' : s.ai ? '<span class="tag">data mồi AI</span>' : ''}</h3>
            <div class="kv">${esc(COMMANDERS[s.commander].name)} · ${esc(MAPS[s.mapId]?.name || s.mapId)} · ${P.rankName(s.rating)} (${s.rating})</div>
            <div class="kv muted">${s.formation.length} ô · ${s.commandLog.filter(e => e.cmd.type === 'order').length} lệnh · thời lượng ${fmtTime(s.duration)}</div>
            <div class="kv">Thắng ${s.wins || 0}/${s.fights || 0} · uy tín ${s.reputation || 0} · còn ${P.GHOST_DAILY_LIMIT - fights}/${P.GHOST_DAILY_LIMIT} lượt hôm nay</div>
            <div class="g-units">${s.formation.map(f => unitImg(f.unit)).join('')}</div>
          </div></div>`;
      }).join('') : '<div class="panel meta-card">Không có data phù hợp bộ lọc.</div>'}
    </div>`;
  const $ = s => el.querySelector(s);
  $('#btn-back').onclick = () => go(app, 'main');
  $('#ghost-filter-rank').onclick = () => { st.by = 'rank'; go(app, 'ghost'); };
  $('#ghost-filter-commander').onclick = () => { st.by = 'commander'; go(app, 'ghost'); };
  $('#ghost-commander').onchange = e => { st.commander = e.target.value; go(app, 'ghost'); };
  $('#ghost-filter-random').onclick = () => { st.by = 'random'; st.seed = (Date.now() & 0xffff) + 1; go(app, 'ghost'); };
  el.querySelectorAll('.ghost-card').forEach(c => c.onclick = () => {
    const s = pool.find(x => x.id === c.dataset.ghost);
    const S = pre(app); S.mode = 'ghost'; S.ghost = s; S.bossId = null;
    go(app, 'commander');
  });
}

// ------------------------------------------------------------------ profile, missions, cosmetics, stats (F-111..F-114)
function profileScreen(app, el) {
  const p = P.getProfile();
  P.ensureDailyMissions(p);
  const lvl = P.passLevel(p);
  const statRows = (obj, label) => Object.entries(obj).sort((a, b) => b[1].played - a[1].played).map(([k, r]) => {
    const wr = P.winRate(r), cls = r.played >= 5 ? (wr > 0.55 ? 'hi' : wr < 0.45 ? 'lo' : 'ok') : '';
    return `<tr><td>${esc(label(k))}</td><td>${r.played}</td><td>${r.won}</td><td class="${cls}">${pct(wr)}</td></tr>`;
  }).join('') || '<tr><td colspan="4" class="muted">Chưa có dữ liệu</td></tr>';
  el.innerHTML = `
    <div class="meta-head"><button id="btn-back">◀ Menu</button><div><h1>Hồ sơ & Nhiệm vụ</h1><h2>${esc(p.name)} · ${P.rankName(p.rating)} (${p.rating}) · điểm hạng ${p.rankPoints} · uy tín ${p.reputation}</h2></div>
      <div class="panel meta-card head-cur">${currencyBar(p)}</div></div>
    <div class="prof-grid">
      <div class="panel meta-card"><h3>Nhiệm vụ hôm nay</h3>${missionList(p)}<div class="muted small">Đổi mới mỗi ngày · thưởng tự nhận khi hoàn thành</div></div>
      <div class="panel meta-card"><h3>Tiến trình</h3>
        <div class="kv">Ải boss: ${BOSS_ORDER.map(b => `${p.bossCleared.includes(b) ? '✔' : '○'} ${esc(BOSSES[b].name)}`).join('<br>')}</div>
        <div class="kv">Đấu data: ${P.ghostUnlocked(p) ? 'đã mở khóa' : '🔒 chưa mở'}</div>
        <div class="kv">Tier đã mở: ${Object.entries(p.unitTiers).map(([u, t]) => `${esc(UNITS[u]?.name)} T${t}`).join(', ') || 'chưa có'}</div>
        <div class="kv muted small">Dữ liệu chiến thuật của bạn được AI địch học (lệnh hay dùng: ${P.learnedFor(p).preferredOrders.join(', ') || '—'})</div>
      </div>
      <div class="panel meta-card"><h3>Tỉ lệ thắng theo chỉ huy</h3><table class="stats"><tr><th>Chỉ huy</th><th>Trận</th><th>Thắng</th><th>%</th></tr>${statRows(p.stats.byCommander, k => COMMANDERS[k]?.name || k)}</table></div>
      <div class="panel meta-card"><h3>Tỉ lệ thắng theo đơn vị</h3><table class="stats"><tr><th>Đơn vị</th><th>Trận</th><th>Thắng</th><th>%</th></tr>${statRows(p.stats.byUnit, k => UNITS[k]?.name || k)}</table><div class="muted small">Ngưỡng cân bằng mục tiêu 45–55%</div></div>
      <div class="panel meta-card"><h3>Ngoại hình (chỉ thẩm mỹ)</h3>
        <div class="skins">${SKINS.map(s => { const own = p.cosmetics.owned.includes(s.id); return `<button class="skin ${p.cosmetics.skin === s.id ? 'on' : ''}" data-skin="${s.id}" style="--c:${s.color}"><i></i>${esc(s.name)}<small>${own ? (p.cosmetics.skin === s.id ? 'Đang dùng' : 'Dùng') : `${s.cost}✪`}</small></button>`; }).join('')}</div>
        <div class="muted small">Skin chỉ đổi màu phe, không tăng sức mạnh. Mua bằng huy hiệu.</div></div>
      <div class="panel meta-card"><h3>Battle pass — cấp ${lvl}/${PASS_LEVELS.length}</h3>
        <div class="bar"><i style="width:${Math.min(100, (p.cosmetics.passXp % PASS_XP_PER_LEVEL) / PASS_XP_PER_LEVEL * 100)}%"></i></div>
        <div class="pass">${PASS_LEVELS.map((L, i) => `<div class="pl ${i < lvl ? 'reached' : ''}"><b>${i + 1}</b><small>${L.free.gold ? L.free.gold + '🪙' : L.free.badges + '✪'}</small><small class="prem">${esc(L.premium.skin ? 'Skin ' + SKINS.find(s => s.id === L.premium.skin).name : L.premium.title)}</small></div>`).join('')}</div>
        <button id="btn-pass-claim">Nhận thưởng đã đạt</button>
        <button id="btn-pass-premium" ${p.cosmetics.premium ? 'disabled' : ''}>${p.cosmetics.premium ? 'Đã mở Premium' : `Mở Premium (${PASS_PREMIUM_COST}✪)`}</button></div>
    </div>`;
  el.querySelector('#btn-back').onclick = () => go(app, 'main');
  el.querySelectorAll('.skin').forEach(b => b.onclick = () => { const r = P.buySkin(p, b.dataset.skin); if (!r.ok) toast(r.reason); P.saveProfile(p); go(app, 'profile'); });
  el.querySelector('#btn-pass-claim').onclick = () => { const g = P.claimPass(p); P.saveProfile(p); toast(g.length ? `Đã nhận ${g.length} phần thưởng` : 'Chưa có thưởng mới'); go(app, 'profile'); };
  el.querySelector('#btn-pass-premium').onclick = () => { const r = P.buyPremium(p); if (!r.ok) toast(r.reason); P.saveProfile(p); go(app, 'profile'); };
}

function settingsScreen(app, el) {
  const p = P.getProfile();
  el.innerHTML = `
    <div class="meta-head"><button id="btn-back">◀ Menu</button><div><h1>Cài đặt</h1><h2>Hồ sơ lưu trên máy này (localStorage)</h2></div></div>
    <div class="panel meta-card settings">
      <label>Tên chỉ huy <input id="set-name" maxlength="20" value="${esc(p.name)}"></label>
      <button id="btn-save-name">Lưu tên</button>
      <hr>
      <button id="btn-reset-tutorial">Xem lại gợi ý hướng dẫn ở menu</button>
      <button class="danger" id="btn-reset-profile">Xóa hồ sơ & bắt đầu lại</button>
    </div>`;
  const $ = s => el.querySelector(s);
  $('#btn-back').onclick = () => go(app, 'main');
  $('#btn-save-name').onclick = () => { p.name = $('#set-name').value.trim() || 'Chỉ huy'; P.saveProfile(p); toast('Đã lưu'); };
  $('#btn-reset-tutorial').onclick = () => { p.tutorialDone = false; p.menuHintSkipped = false; P.saveProfile(p); go(app, 'main'); };
  $('#btn-reset-profile').onclick = () => { if (confirm('Xóa toàn bộ tiến trình?')) { P.resetProfile(); app.pre = null; go(app, 'main'); } };
}

// ------------------------------------------------------------------ results
export function recordMatch(match, result) {
  if (match.__meta) return match.__meta;
  const p = P.getProfile(), g = match.game;
  const s = P.summarizeMatch(g, match.side || 0);
  const rewards = P.applyMatchResult(p, s);
  try {
    if (s.mode === 'skirmish' && s.won) {
      const pool = Ghost.loadPool();
      Ghost.addSnapshot(pool, Ghost.makeSnapshot(g, { playerName: p.name, rating: p.rating }));
      Ghost.savePool(pool);
      rewards.notes.push('Đội hình + chuỗi lệnh của bạn đã được lưu vào kho Đấu data');
    }
    if (s.mode === 'ghost' && s.ghostId) {
      const pool = Ghost.loadPool();
      const snap = Ghost.recordGhostResult(pool, s.ghostId, !s.won);
      if (snap && snap.own && !s.won) p.reputation += 10;
      Ghost.savePool(pool);
      if (snap && !s.won) rewards.notes.push(`${snap.playerName} nhận +10 uy tín`);
    }
  } catch (e) { console.warn('ghost pool', e); }
  P.saveProfile(p);
  return (match.__meta = { s, rewards });
}

function resultScreen(app, el, { result = {}, match } = {}) {
  if (!match) { go(app, 'main'); return; }
  const { s, rewards: r } = recordMatch(match, result);
  const won = s.won;
  const p = P.getProfile();
  const rw = [r.gold ? `+${r.gold}🪙 vàng` : '', r.rare ? `+${r.rare}◆ vật liệu hiếm` : '', r.badges ? `+${r.badges}✪ huy hiệu` : '',
    r.rankPoints ? `${r.rankPoints > 0 ? '+' : ''}${r.rankPoints} điểm hạng` : '', r.rating ? `hạng ${r.rating > 0 ? '+' : ''}${r.rating}` : ''].filter(Boolean);
  const ghostLimit = s.mode === 'ghost' && s.ghostId && P.ghostFightsToday(p, s.ghostId) >= P.GHOST_DAILY_LIMIT;
  el.innerHTML = `
    <div class="result-wrap panel ${won ? 'win' : 'lose'}">
      <div class="res-title" id="result-title">${won ? 'CHIẾN THẮNG' : s.draw ? 'HÒA' : 'THẤT BẠI'}</div>
      <div class="res-reason">${esc(result.reason || s.reason || '')}</div>
      <div class="res-mode muted">${MODE_LABEL[s.mode] || s.mode} · ${esc(MAPS[s.mapId]?.name)} · ${esc(COMMANDERS[s.commander]?.name)}${s.boss ? ' · ' + esc(BOSSES[s.boss]?.name) : ''}</div>
      <div class="res-stats">
        <div><span>Thời gian</span><b>${fmtTime(s.duration)}</b></div>
        <div><span>Hạ địch</span><b>${s.kills}</b></div>
        <div><span>Tổn thất</span><b>${s.lost}</b></div>
        <div><span>Công trình phá</span><b>${s.structures}</b></div>
        <div><span>Cứ điểm chiếm</span><b>${s.captures}</b></div>
        <div><span>Điểm chiếm đóng</span><b>${s.score}</b></div>
      </div>
      <h3>Phần thưởng</h3>
      <div class="res-rewards">${rw.length ? rw.map(x => `<span>${x}</span>`).join('') : '<span class="muted">—</span>'}</div>
      ${r.usdt ? `<div class="res-usdt" id="result-usdt">
        <span>${won ? 'Thưởng thắng map' : 'Trợ cấp sau trận'}: <b class="amber">+${formatUSD(r.usdt.reward)}</b> USDT</span>
        ${r.usdt.matchDebt ? `<span>Nợ vay còn lại cuối trận: <b class="bad">${formatUSD(r.usdt.matchDebt)}</b></span>` : ''}
        ${r.usdt.debtPaid ? `<span>Đã trả nợ: <b>${formatUSD(r.usdt.debtPaid)}</b></span>` : ''}
        <span>Mang sang trận sau: 💵 <b>${formatUSD(r.usdt.usdt)}</b>${r.usdt.debt ? ` · 💸 nợ <b class="bad">${formatUSD(r.usdt.debt)}</b> (trừ vào ngân sách trận sau)` : ''}</span>
      </div>` : ''}
      ${r.unlocked.length ? `<div class="res-unlock">${r.unlocked.map(u => `🔓 ${esc(u)}`).join('<br>')}</div>` : ''}
      ${r.notes.length ? `<div class="muted">${r.notes.map(esc).join('<br>')}</div>` : ''}
      ${r.missions.length ? `<h3>Nhiệm vụ ngày</h3><ul class="missions">${r.missions.map(m => `<li class="${m.done ? 'done' : ''}"><div class="m-text">${m.justDone ? '🎉 ' : m.done ? '✔ ' : ''}${esc(m.text)}</div><div class="bar"><i style="width:${Math.min(100, m.progress / m.target * 100)}%"></i></div><small>${m.progress}/${m.target}</small></li>`).join('')}</ul>` : ''}
      <div class="res-btns">
        <button class="primary big" id="btn-replay" ${ghostLimit ? 'disabled title="Đã đấu data này 3 lần hôm nay"' : ''}>↻ Chơi lại</button>
        <button class="big" id="btn-menu">⌂ Về menu</button>
      </div>
    </div>`;
  el.querySelector('#btn-menu').onclick = () => app.leaveMatch();
  el.querySelector('#btn-replay').onclick = () => {
    const opts = { ...match.opts, seed: (Date.now() % 1e6) | 0 };
    if (opts.mode !== 'tutorial' && opts.player) {
      // Re-buy the same formation from the new meta budget (F-178).
      const loan = (opts.player.loans || []).reduce((a, l) => a + (l.principal || 0), 0);
      const f = opts.player.formation;
      if (P.formationTotals(f).price > P.budgetFor(loan, P.metaBudget(p))) { app.leaveMatch(); toast('Ngân sách (sau nợ mang sang) không đủ cho đội hình cũ — hãy xếp lại đội hình'); return; }
      const meta = P.commitMetaBudget(p);
      opts.player = { ...opts.player, ...P.playerEconomy(f, loan, meta.base), meta };
    }
    if (opts.mode === 'ghost' && opts.ghost) P.recordGhostFight(p, opts.ghost.id);
    P.saveProfile(p);
    if (opts.mode === 'skirmish') opts.enemy = P.buildSkirmishEnemy(p, opts.player, opts.mapId, opts.seed);
    app.startMatch(opts);
  };
}

const SCREENS = { main: mainMenu, commander: commanderScreen, formation: formationScreen, map: mapScreen, boss: bossScreen, ghost: ghostScreen, profile: profileScreen, settings: settingsScreen, result: resultScreen };

// ------------------------------------------------------------------ in-match extras (boss bar, ghost tag, tutorial)
export function attachMatch(app, match) {
  const g = match.game, made = [];
  const root = document.getElementById('app');
  if (g.mode === 'boss' && g.boss) {
    const bar = document.createElement('div');
    bar.id = 'boss-bar'; bar.className = 'panel';
    bar.innerHTML = `<div class="bb-name">☠ ${esc(g.boss.def.name)} <span class="bb-phase" id="boss-phase">Pha 1: ${BOSS_PHASES[1].name}</span></div><div class="bb-hp"><i id="boss-hp"></i></div>`;
    root.appendChild(bar); made.push(bar);
    g.events.on('boss:phase', e => {
      const b = document.createElement('div'); b.className = 'boss-banner'; b.id = 'boss-banner';
      b.innerHTML = `PHA ${e.phase}: ${esc(e.name).toUpperCase()}<small>${esc(BOSS_PHASES[e.phase].desc)}</small>`;
      root.appendChild(b); setTimeout(() => b.remove(), 3200);
    });
  }
  if (g.mode === 'ghost' && g.opts.ghost) {
    const tag = document.createElement('div');
    tag.id = 'ghost-tag'; tag.className = 'panel';
    tag.innerHTML = `⚔ Đấu data: <b>${esc(g.opts.ghost.playerName)}</b> <span class="muted">(${esc(COMMANDERS[g.opts.ghost.commander]?.name)} — replay chuỗi lệnh đã lưu)</span>`;
    root.appendChild(tag); made.push(tag);
  }
  if (g.mode === 'tutorial') new Tutorial(app, match).start();
  if (!made.length) return;
  const tick = () => {
    if (app.match !== match || !match.running || g.ended) { made.forEach(x => x.remove()); return; }
    for (const el of made) placeTopCenter(el);
    if (g.boss) {
      const f = Math.max(0, g.boss.ref.hp / g.boss.maxHp);
      const hp = document.getElementById('boss-hp'); if (hp) hp.style.width = (f * 100).toFixed(1) + '%';
      const ph = document.getElementById('boss-phase'); if (ph) ph.textContent = `Pha ${g.boss.phase}: ${BOSS_PHASES[g.boss.phase].name}${g.boss.shield ? ' · lá chắn' : ''}${g.boss.surfaced ? ' · ĐANG NỔI' : ''}`;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// QA #6: boss bar / ghost tag sit top-centre under the timer, between the two corner panels (never over them);
// when the gap is too narrow (phones) they go full width below the corner panels.
function placeTopCenter(el) {
  const L = document.getElementById('hud-left')?.getBoundingClientRect(), Rr = document.getElementById('hud-right')?.getBoundingClientRect();
  const C = document.getElementById('hud-center')?.getBoundingClientRect();
  if (!L || !Rr || !C) return;
  const gap = Rr.left - L.right - 16;
  if (gap >= 240) {
    const w = Math.min(520, gap);
    Object.assign(el.style, { left: (L.right + Rr.left) / 2 + 'px', width: w + 'px', top: (C.bottom + 6) + 'px', transform: 'translateX(-50%)' });
  } else {
    Object.assign(el.style, { left: '8px', width: (window.innerWidth - 16) + 'px', top: (Math.max(L.bottom, Rr.bottom, C.bottom) + 4) + 'px', transform: 'none' });
  }
}

// Used by ?quick=1 and the sim harness.
export function defaultMatch(commander = 'steel', mapId = 'plains') {
  const rec = COMMANDERS[commander].recommended;
  const enemyCmd = 'air';
  const toSlots = list => list.map(u => ({ unit: u, tier: 1, count: 1 })); // 9 slots = 9 weapons (F-52)
  return {
    mode: 'skirmish', mapId, seed: 1234,
    player: { commander, formation: toSlots(rec) },
    enemy: { commander: enemyCmd, ai: true, formation: toSlots(COMMANDERS[enemyCmd].recommended) },
  };
}

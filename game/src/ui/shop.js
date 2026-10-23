// OWNER: agent Kinh tế & HUD.
// Shop modal (phím S, GDD §16 F-180): mua khí tài, nâng tier T1→T3, tuyển quân / tổng động viên, vay vốn / trả nợ,
// bán khí tài. Registers match.hotkeys.s. Every action goes through match.issue({type:'buy'|'upgrade'|...}).
import { UNITS, unitDef, TIERS, ACCESSORY_FX, MAX_SLOTS, MAX_T3, formatUSD, tierBonusText } from '../data/units.js';
import { ECON, unitPrice, unitCp, cpRemaining, cpLimit, cpUsed, t3Count, upgradeCost, totalDebt, isMobilized, slotUnits, freeSlotIndex, liveFormationCount } from '../sim/economy.js';
import { openModal, closeModal, modalOwner, unitIcon, esc, fmtTime, hpColor } from './hud.js';

const TABS = [
  ['buy', 'Mua khí tài'], ['tier', 'Nâng tier'], ['troops', 'Tuyển quân'], ['loan', 'Vay vốn / Trả nợ'], ['sell', 'Bán khí tài'],
];
const FILTERS = [
  ['all', 'Tất cả', () => true],
  ['ground', 'Mặt đất', d => d.group === 'tank' || d.group === 'infantry'],
  ['drone', 'Drone', d => d.group === 'drone'],
  ['air', 'Không quân', d => d.group === 'air'],
  ['navy', 'Hải quân', d => d.group === 'navy' || d.group === 'sub'],
  ['def', 'Phòng không & EW', d => d.group === 'aa' || d.group === 'energy' || d.group === 'ew'],
];
const RANK_ORDER = { A: 0, S: 1, SR: 2, UR: 3 };

class Shop {
  constructor(match) {
    this.m = match; this.g = match.game;
    this.tab = 'buy'; this.filter = 'all';
    this.t = 0;
    match.hotkeys.s = () => this.toggle();
    let pending = 0;
    const rerender = () => { if (!this.isOpen() || pending) return; pending = setTimeout(() => { pending = 0; if (this.isOpen()) this.render(); }, 250); };
    for (const ev of ['purchase', 'upgrade', 'loan', 'loan:repaid', 'recruit', 'recruit:done', 'mobilize', 'unit:sold', 'liquidation', 'unit:death'])
      this.g.events.on(ev, e => { if (!e || e.side == null || e.side === match.side || ev === 'unit:death') rerender(); });
    // Gentle periodic refresh (money ticks up every second).
    this.timer = setInterval(() => { if (this.isOpen() && match.running) this.render(); else if (!match.running) clearInterval(this.timer); }, 1000);
  }
  isOpen() { return modalOwner() === 'shop'; }
  toggle() { if (this.isOpen()) closeModal(); else this.open(); }
  open(tab) {
    if (this.g.ended) return;
    if (tab) this.tab = tab;
    this.root = document.createElement('div');
    this.root.className = 'shop';
    openModal('shop', this.root, { wide: true });
    this.render();
  }
  get side() { return this.g.sides[this.m.side]; }
  issue(cmd) { this.m.issue(cmd); setTimeout(() => this.isOpen() && this.render(), 120); }

  render() {
    const S = this.side, g = this.g, my = this.m.side;
    const body = this.root.querySelector('.shop-body');
    const scroll = body ? body.scrollTop : 0;
    this.root.innerHTML = `
      <div class="shop-head">
        <div class="shop-title">🛒 Cửa hàng <span class="kbd">S</span></div>
        <div class="shop-stats">
          <span>💰 <b class="amber">${formatUSD(S.money)}</b> USDT</span>
          <span>CP đội hình <b>${cpUsed(g, my)}/${cpLimit(g, my)}</b></span>
          <span title="9 ô = 9 khí tài còn sống">Khí tài <b>${liveFormationCount(g, my)}/${MAX_SLOTS}</b></span>
          <span>🪖 <b>${S.troops.reserve}</b> dự bị</span>
          <span>💎 Vật liệu hiếm <b>${S.rareMaterials || 0}</b></span>
          ${totalDebt(S) ? `<span class="bad">Nợ <b>${formatUSD(totalDebt(S))}</b></span>` : ''}
        </div>
        <button class="shop-close" title="Đóng (Esc)">✕</button>
      </div>
      <div class="shop-tabs">${TABS.map(([k, l]) => `<button class="tab${k === this.tab ? ' active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div class="shop-body">${this['tab_' + this.tab]()}</div>`;
    this.root.querySelector('.shop-close').onclick = () => closeModal();
    this.root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { this.tab = b.dataset.tab; this.render(); });
    this.root.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { this.filter = b.dataset.filter; this.render(); });
    this.root.querySelectorAll('[data-cmd]').forEach(b => b.onclick = () => this.issue(JSON.parse(b.dataset.cmd)));
    const nb = this.root.querySelector('.shop-body');
    if (nb) nb.scrollTop = scroll;
  }

  btn(label, cmd, { cls = '', disabled = false, title = '' } = {}) {
    return `<button class="${cls}" ${disabled ? 'disabled' : ''} title="${esc(title)}" data-cmd='${esc(JSON.stringify(cmd))}'>${label}</button>`;
  }

  owned(id) {
    let n = 0;
    for (const u of this.g.units.values()) if (u.alive && u.side === this.m.side && u.def.id === id) n++;
    const slot = this.side.formation.find(s => s.unit === id && !s.deployed);
    return n + (slot ? slot.count || 1 : 0);
  }

  // ---- tab: buy ----
  tab_buy() {
    const S = this.side, g = this.g, my = this.m.side;
    const f = FILTERS.find(x => x[0] === this.filter)[2];
    const cpLeft = cpRemaining(g, my);
    const full = freeSlotIndex(g, my) < 0;   // 9 formation weapons alive (F-52)
    const ids = Object.keys(UNITS).map(unitDef).filter(f).sort((a, b) => unitPrice(a) - unitPrice(b) || RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
    const cards = ids.map(def => {
      const price = unitPrice(def, 1);
      const cp = unitCp(def, 1);
      const owned = this.owned(def.id);
      const big = basePriceOver(def);
      const locked = big && S.money < price;
      let why = '';
      if (price > S.money) why = locked ? 'Trên 1 tỷ — cần thu nhập cứ điểm hoặc vay vốn' : 'Không đủ tiền';
      else if (cp > cpLeft) why = `Vượt CP đội hình (còn ${cpLeft})`;
      else if (full) why = 'Đã đủ 9 khí tài (9 ô)';
      const crew = def.id === 'infantry' ? def.squad : def.crew || 0;
      if (!why && crew > S.troops.reserve) why = 'Không đủ binh lính vận hành';
      return `<div class="ucard${locked ? ' locked' : ''}${why ? ' cant' : ''}">
        <div class="ucard-img"><img src="${unitIcon(def.id)}" onerror="this.style.visibility='hidden'"><span class="rank r-${def.rank}">${def.rank}</span>${owned ? `<span class="owned">Có ${owned}</span>` : ''}${locked ? '<span class="lock">🔒</span>' : ''}</div>
        <div class="ucard-name">${esc(def.name)}</div>
        <div class="ucard-ref muted">${esc(def.ref)}</div>
        <div class="ucard-role">${esc(def.role)}</div>
        <div class="ucard-meta"><span class="amber">${def.id === 'infantry' ? `${def.squad} lính dự bị` : formatUSD(price) + ' USDT'}</span><span>CP ${cp}</span>${crew ? `<span title="Binh lính vận hành">🪖${crew}</span>` : ''}</div>
        ${def.swarmCount ? `<div class="muted small">1 bầy = ${def.swarmCount} drone = 1 ô</div>` : ''}
        <div class="ucard-btns">${this.btn('Mua', { type: 'buy', unit: def.id, tier: 1 }, { cls: 'primary', disabled: !!why, title: why })}</div>
        ${why ? `<div class="why">${esc(why)}</div>` : ''}
      </div>`;
    }).join('');
    return `<div class="filters">${FILTERS.map(([k, l]) => `<button class="chip${k === this.filter ? ' active' : ''}" data-filter="${k}">${l}</button>`).join('')}</div>
      <p class="muted small">Đơn vị mua trong trận xuất hiện ở thành chỉ huy (tàu ở cảng, máy bay ở sân bay). Mỗi khí tài chiếm 1 ô (9 ô = 9 khí tài, bầy drone = 1 ô); ô có khí tài đã mất được dùng lại. Lính do xe chở thả xuống không tính vào 9 ô.</p>
      <div class="ugrid">${cards}</div>`;
  }

  // ---- tab: tier ----
  tab_tier() {
    const S = this.side, g = this.g, my = this.m.side;
    const t3 = t3Count(g, my);
    const rows = S.formation.map((slot, i) => {
      const def = unitDef(slot.unit);
      const tier = slot.tier || 1;
      const n = slot.deployed ? slotUnits(g, my, slot.slot).length : slot.count || 1;
      const acc = ACCESSORY_FX[def.group] || [];
      const cost = upgradeCost(g, my, i);
      let why = '';
      const cpNeed = tier < 3 ? (unitCp(def, tier + 1) - unitCp(def, tier)) * n : 0;
      if (tier >= 3) why = 'Đã tối đa';
      else if (!n) why = 'Ô không còn đơn vị';
      else if (tier === 2 && t3 >= MAX_T3) why = `Đã có ${MAX_T3} ô T3`;
      else if (tier === 2 && (S.rareMaterials || 0) < (TIERS[3].rareMaterial || 1)) why = 'Cần vật liệu hiếm (boss / đấu data)';
      else if (cost > S.money) why = 'Không đủ tiền';
      else if (cpNeed > cpRemaining(g, my)) why = `Cần thêm ${cpNeed} CP đội hình`;
      return `<tr>
        <td><span class="slotno">${i + 1}</span></td>
        <td><img class="ticon" src="${unitIcon(def.id)}" onerror="this.style.visibility='hidden'"></td>
        <td><b>${esc(def.name)}</b><div class="muted small">${n} đơn vị</div></td>
        <td>${[1, 2, 3].map(t => `<span class="tierpip${t <= tier ? ' on' : ''}">T${t}</span>`).join('')}</td>
        <td class="small">${acc.map((a, k) => `<div class="${tier >= k + 2 ? 'ok' : 'muted'}" title="${esc(a.desc)}">${tier >= k + 2 ? '✔' : '○'} T${k + 2}: <b>${esc(a.name)}</b> — ${esc(a.desc)}</div>`).join('')}</td>
        <td>${tier < 3 ? `<b class="amber">${formatUSD(cost)}</b><div class="small">+${cpNeed} CP${tier === 2 ? ' + 1 💎' : ''}</div>` : '—'}</td>
        <td>${tier < 3 ? this.btn(`Nâng T${tier + 1}`, { type: 'upgrade', slot: i }, { cls: 'primary', disabled: !!why, title: why }) : ''}${why && tier < 3 ? `<div class="why">${esc(why)}</div>` : ''}</td>
      </tr>`;
    }).join('');
    return `<p class="muted small">T2: ${tierBonusText(2)}, mở phụ kiện 1 (giá ${Math.round(TIERS[2].costMult * 100)}% giá gốc mỗi đơn vị, +1 CP). T3: ${tierBonusText(3)}, phụ kiện 2 (giá ${Math.round(TIERS[3].costMult * 100)}% + 1 vật liệu hiếm, +1 CP). Tối đa ${MAX_T3} ô T3 (đang có ${t3}). Đơn vị đang sống được áp chỉ số mới ngay, giữ nguyên % máu.</p>
      <table class="etable"><thead><tr><th>Ô</th><th></th><th>Khí tài</th><th>Tier</th><th>Phụ kiện</th><th>Chi phí</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="muted">Chưa có đội hình</td></tr>'}</tbody></table>`;
  }

  // ---- tab: troops ----
  tab_troops() {
    const S = this.side, g = this.g;
    const minute = Math.floor(g.time / 60);
    const used = S.recruitWindow && S.recruitWindow.minute === minute ? S.recruitWindow.used : 0;
    const left = Math.max(0, ECON.recruitCapPerMin - used);
    const q = S.troops.recruiting;
    const mobCost = ECON.mobilizeAmount * ECON.mobilizeCost;
    const amounts = [50, 100, ECON.recruitCapPerMin];
    return `<div class="ecols">
      <div class="ebox">
        <h3>Tuyển quân</h3>
        <div class="stat"><span>Đang chiến đấu / dự bị</span><b>${S.troops.active} / ${S.troops.reserve}</b></div>
        <div class="stat"><span>Đã hy sinh</span><b>${S.troops.dead}</b></div>
        <div class="stat"><span>Chi phí</span><b>${formatUSD(ECON.recruitCost)} / lính · ${ECON.recruitTime} giây huấn luyện</b></div>
        <div class="stat"><span>Còn được tuyển phút này</span><b>${left} / ${ECON.recruitCapPerMin}</b></div>
        <div class="econ-row-btns">${amounts.map(a => this.btn(`+${a} lính (${formatUSD(a * ECON.recruitCost)})`, { type: 'recruit', amount: a }, { disabled: !left || S.money < ECON.recruitCost })).join('')}</div>
        ${q.length ? `<h4>Đang huấn luyện</h4>${q.map(r => `<div class="stat small"><span>${r.n} tân binh</span><b>${fmtTime(r.ready - g.time)}</b></div>`).join('')}` : ''}
        <p class="muted small">Bộ binh mua ở tab "Mua khí tài" (1 tiểu đội = 50 lính dự bị). Hết binh lính (kể cả người vận hành khí tài) là thua.</p>
      </div>
      <div class="ebox ${isMobilized(g, this.m.side) ? 'active-box' : ''}">
        <h3>Tổng động viên</h3>
        <p>Đợt tuyển lớn: <b>+${ECON.mobilizeAmount}</b> lính sau ${ECON.mobilizeTime} giây, giá ${formatUSD(mobCost)} USDT.</p>
        <p class="bad small">Trong ${Math.round(ECON.mobilizeDuration / 60)} phút: chi phí duy trì quân ×${ECON.mobilizeUpkeepMult}, thu nhập −${Math.round((1 - ECON.mobilizeIncomeMult) * 100)}%. Chỉ dùng 1 lần mỗi trận.</p>
        ${isMobilized(g, this.m.side) ? `<div class="tag warn">Đang tổng động viên · còn ${fmtTime(S.mobilizedUntil - g.time)}</div>` : ''}
        ${this.btn('📣 Tổng động viên', { type: 'mobilize' }, { cls: 'danger', disabled: S.mobilizeUsed || S.money < mobCost, title: S.mobilizeUsed ? 'Đã dùng' : '' })}
        <div class="stat small"><span class="muted">Chi phí duy trì hiện tại</span><b>${formatUSD(S.upkeepRate || 0)}/phút</b></div>
      </div></div>`;
  }

  // ---- tab: loans ----
  tab_loan() {
    const S = this.side, g = this.g;
    const principal = S.loans.reduce((a, l) => a + l.principal, 0);
    const room = ECON.loanMax - principal;
    const offers = ECON.loanOptions.map(a => `<div class="loan-offer">
        <div class="amber big">${formatUSD(a)}</div>
        <div class="small">Lãi ${Math.round(ECON.loanRate * 100)}% → trả <b>${formatUSD(a * (1 + ECON.loanRate))}</b></div>
        <div class="small muted">Hạn ${Math.round(ECON.loanTerm / 60)} phút trận</div>
        ${this.btn('Vay', { type: 'loan', amount: a }, { cls: 'primary', disabled: a > room, title: a > room ? 'Vượt hạn mức' : '' })}
      </div>`).join('');
    const loans = S.loans.slice().sort((a, b) => a.due - b.due).map(l => {
      const left = l.due - g.time;
      return `<tr><td>${formatUSD(l.principal)}</td><td>${Math.round(l.rate * 100)}%</td><td><b>${formatUSD(l.owed)}</b></td><td class="${left < 60 ? 'bad blink' : ''}">${fmtTime(left)}</td></tr>`;
    }).join('');
    const debt = totalDebt(S);
    return `<p class="muted small">Đến hạn mà không đủ tiền → tự động thanh lý khí tài ở ${Math.round(ECON.liquidationRate * 100)}% giá mua. Bán hết vẫn không đủ → <b class="bad">thua</b>. Hạn mức: ${formatUSD(ECON.loanMax)} (còn ${formatUSD(Math.max(0, room))}).</p>
      <div class="loan-offers">${offers}</div>
      <h3>Khoản nợ hiện tại</h3>
      ${loans ? `<table class="etable"><thead><tr><th>Gốc</th><th>Lãi</th><th>Phải trả</th><th>Đến hạn sau</th></tr></thead><tbody>${loans}</tbody></table>
        <div class="econ-row-btns">${this.btn(`Trả hết nợ (${formatUSD(debt)})`, { type: 'repay' }, { cls: 'primary', disabled: S.money < debt })}${this.btn('Trả một phần bằng tiền hiện có', { type: 'repay', amount: Math.floor(S.money * 0.9) }, { disabled: S.money <= 0 })}</div>`
        : '<p class="muted">Không có khoản nợ nào.</p>'}`;
  }

  // ---- tab: sell ----
  tab_sell() {
    const g = this.g, my = this.m.side;
    const us = [...g.units.values()].filter(u => u.alive && u.side === my && u.originalSide === my && (u.value || 0) > 0)
      .sort((a, b) => a.group - b.group || b.value - a.value);
    const rows = us.map(u => `<tr>
        <td><span class="slotno">${u.group + 1}</span></td>
        <td><img class="ticon" src="${unitIcon(u.def.id)}" onerror="this.style.visibility='hidden'"></td>
        <td><b>${esc(u.def.name)}</b> <span class="amber">T${u.tier}</span></td>
        <td><div class="hpbar"><i style="width:${Math.round(u.hpFrac * 100)}%;background:${hpColor(u.hpFrac)}"></i></div></td>
        <td class="muted">${formatUSD(u.value)}</td>
        <td><b class="amber">+${formatUSD(u.value * ECON.sellRate)}</b></td>
        <td>${this.btn('Bán', { type: 'sell', unitId: u.id }, { cls: 'danger' })}</td></tr>`).join('');
    return `<p class="muted small">Bán khí tài được ${Math.round(ECON.sellRate * 100)}% giá mua; tổ lái quay về quân dự bị.</p>
      <table class="etable"><thead><tr><th>Ô</th><th></th><th>Khí tài</th><th>HP</th><th>Giá mua</th><th>Giá bán</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="muted">Không có khí tài để bán</td></tr>'}</tbody></table>`;
  }
}

function basePriceOver(def) { return def.price * (def.swarmCount || 1) > 1_000_000_000; }

export function install(match) { match.shop = new Shop(match); }

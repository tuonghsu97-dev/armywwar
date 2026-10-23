// OWNER: agent Kinh tế & HUD.
// In-match HUD (GDD §16 F-182..F-185): corner stats (soldiers fighting/remaining, USDT + cash flow, debt due with
// countdown, occupation score both sides, command points, formation CP), phase/timer, deploy panel (30 s),
// command bar (7 MVP orders + move/capture), selection panel, minimap, toasts, on-screen buttons for S/B/surrender.
// Also exports the shared modal helpers used by ui/shop.js and ui/roster.js.
import { formatUSD, unitDef } from '../data/units.js';
import { ORDER_INFO } from '../match.js';
import { MATCH_LIMIT } from '../core/game.js';
import { totalDebt, nextDue, heldStrongpoints, isMobilized } from '../sim/economy.js';
import { saveQuality } from '../render/post.js';

const $ = id => document.getElementById(id);
const ORDER_KEYS = ['attack', 'defend', 'suppress', 'flank', 'sead', 'retreat', 'focus', 'move', 'capture'];

export function unitIcon(id) { return `assets/img/units/${id}.png`; }

export const INTENT_VI = {
  idle: 'Chờ lệnh', move: 'Di chuyển', attack: 'Tấn công', defend: 'Phòng thủ', suppress: 'Áp chế', flank: 'Vòng đánh họng',
  sead: 'Diệt phòng không', retreat: 'Rút lui', repair: 'Sửa chữa', capture: 'Chiếm cứ điểm', focus: 'Dồn hỏa lực',
  rearm: 'Nạp đạn', load: 'Đón quân', unload: 'Thả quân', transport: 'Vận chuyển', loiter: 'Lượn chờ', jammed: 'Bị nhiễu',
  hacked: 'Bị hack', deploy: 'Triển khai', deployed: 'Đã triển khai', carried: 'Đang được chở',
};
export function intentLabel(i) { return INTENT_VI[i] || i || '—'; }

export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export function fmtTime(s) { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

// ---- shared modal (#modal) ----
let modalState = null;
export function openModal(owner, el, { onClose, wide } = {}) {
  closeModal();
  const m = $('modal');
  m.innerHTML = '';
  const panel = document.createElement('div');
  panel.className = 'panel econ-modal' + (wide ? ' wide' : '');
  panel.appendChild(el);
  m.appendChild(panel);
  m.classList.remove('hidden');
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closeModal(); } };
  const onDown = e => { if (e.target === m) closeModal(); };
  window.addEventListener('keydown', onKey, true);
  m.addEventListener('pointerdown', onDown);
  modalState = { owner, onClose, off: () => { window.removeEventListener('keydown', onKey, true); m.removeEventListener('pointerdown', onDown); } };
  return panel;
}
export function closeModal() {
  if (!modalState) return;
  const s = modalState; modalState = null;
  s.off();
  const m = $('modal'); m.classList.add('hidden'); m.innerHTML = '';
  s.onClose?.();
}
export function modalOwner() { return modalState?.owner || null; }

export class Hud {
  constructor(match) {
    this.m = match;
    this.g = match.game;
    $('hud').classList.remove('hidden');
    this.resetPanels();   // QA #5: nothing from the previous match (selection panel, toasts, modal) leaks in
    this.buildCommandBar();
    this.buildButtons();
    this.buildDeployPanel();
    if (!this.m.hotkeys.p) this.m.hotkeys.p = () => this.togglePause();
    this.offs = [
      this.g.events.on('selection', () => this.renderSelection()),
      this.g.events.on('pending', t => { this.markPending(t); this.refreshDeploySlots(); }),
      // QA #16: the clicked slot must not stay highlighted after a (rejected) placement.
      this.g.events.on('deploy:placed', () => queueMicrotask(() => this.refreshDeploySlots())),
      this.g.events.on('phase', () => this.onPhase()),
      this.g.events.on('deployed', () => this.buildDeployPanel()),
      this.g.events.on('purchase', e => { if (e.side === this.m.side && this.g.phase === 'deploy') this.buildDeployPanel(); }),
      this.g.events.on('liquidation', e => { if (e.side === this.m.side) this.flash('hud-left', 'warn'); }),
      this.g.events.on('end', () => closeModal()),
    ];
    // Phones: corner panels are compact; tap to expand / collapse the extra lines (QA #1).
    for (const id of ['hud-left', 'hud-right']) $(id).onclick = () => $(id).classList.toggle('expanded');
    this.mini = $('minimap').getContext('2d');
    $('minimap').onpointerdown = e => this.minimapClick(e);
    this.t = 0;
    this.selT = 0;
  }

  dispose() { this.offs.forEach(f => f()); closeModal(); this.resetPanels(); $('hud').classList.add('hidden'); }

  resetPanels() {
    closeModal();
    const sel = $('selection-panel'); sel.classList.add('hidden'); sel.innerHTML = '';
    $('deploy-panel').innerHTML = '';
    $('toasts').innerHTML = '';
    this.hideBox?.();
  }

  // Keep the deploy tray's highlight in sync with match.pendingDeploy (cheap: only toggles classes).
  refreshDeploySlots() {
    if (this.g.phase !== 'deploy') return;
    document.querySelectorAll('#deploy-panel .slot').forEach(d => d.classList.toggle('active', Number(d.dataset.slot) === this.m.pendingDeploy));
  }

  // ---- pause menu (QA #9): ⏸ button / P / Esc (when nothing is pending) ----
  togglePause() { if (modalOwner() === 'pause') closeModal(); else this.openPause(); }
  openPause() {
    if (this.g.ended) return;
    this.g.paused = true;
    const post = this.m.R.post;
    const el = document.createElement('div');
    el.className = 'econ-confirm pause-menu';
    el.innerHTML = `<h3 class="pause-title">⏸ Tạm dừng</h3>
      <div class="pause-btns">
        <button class="primary" data-a="resume" id="btn-resume">▶ Tiếp tục</button>
        <div class="pause-q"><span>Chất lượng đồ họa</span>
          <span class="pause-q-btns"><button data-q="high">Cao</button><button data-q="low">Thấp</button></span></div>
        <button data-a="leave" id="btn-leave">⌂ Thoát ra menu</button>
        <button class="danger" data-a="surrender">🏳 Đầu hàng</button>
      </div>
      <p class="muted small">Thoát ra menu: trận bị hủy, không tính thắng/thua và không có phần thưởng.</p>`;
    const markQ = () => el.querySelectorAll('[data-q]').forEach(b => b.classList.toggle('on', b.dataset.q === post?.quality));
    el.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { post?.setQuality(b.dataset.q); saveQuality(b.dataset.q); markQ(); });
    markQ();
    el.querySelector('[data-a=resume]').onclick = () => closeModal();
    el.querySelector('[data-a=leave]').onclick = () => { closeModal(); this.m.app?.leaveMatch?.(); };
    el.querySelector('[data-a=surrender]').onclick = () => { closeModal(); this.confirmSurrender(); };
    openModal('pause', el, { onClose: () => { if (!this.g.ended) this.g.paused = false; } });
  }

  buildCommandBar() {
    const bar = $('command-bar');
    bar.innerHTML = '';
    for (const k of ORDER_KEYS) {
      const info = ORDER_INFO[k];
      const b = document.createElement('button');
      b.className = 'cmd'; b.dataset.order = k; b.title = info.desc;
      b.innerHTML = `<img src="assets/img/commands/${k}.png" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'glyph',textContent:'${info.glyph}'}))"><span>${info.label}</span>`;
      b.onclick = () => this.m.setPendingOrder(k);
      bar.appendChild(b);
    }
  }
  markPending(t) { document.querySelectorAll('.cmd').forEach(b => b.classList.toggle('active', b.dataset.order === t)); }

  buildButtons() {
    const box = $('hud-buttons');
    box.innerHTML = '';
    // Icon + label (label hidden on phones, QA #1); the title keeps the full text + hotkey.
    const add = (icon, label, key, fn, cls = '', id = '') => {
      const b = document.createElement('button'); b.className = cls; if (id) b.id = id;
      b.title = label + (key ? ` (${key})` : '');
      b.innerHTML = `<span class="hb-ico">${icon}</span><span class="hb-lbl">${label}</span>${key ? `<span class="kbd">${key}</span>` : ''}`;
      b.onclick = fn; box.appendChild(b); return b;
    };
    add('⏸', 'Tạm dừng', 'P', () => this.togglePause(), '', 'btn-pause');
    add('🛒', 'Cửa hàng', 'S', () => this.m.hotkeys.s?.(), '', 'btn-shop');
    add('📋', 'Khí tài', 'B', () => this.m.hotkeys.b?.(), '', 'btn-roster');
    add('⟲', 'Xoay trái', 'Q', () => this.m.R.rotate(-1));
    add('⟳', 'Xoay phải', 'E', () => this.m.R.rotate(1));
    add('＋', 'Zoom gần', 'Z', () => this.m.R.zoomStep(1));
    add('－', 'Zoom xa', 'X', () => this.m.R.zoomStep(-1));
    add('🏳', 'Đầu hàng', '', () => this.confirmSurrender(), 'danger', 'btn-surrender');
  }

  confirmSurrender() {
    if (this.g.ended) return;
    const el = document.createElement('div');
    el.className = 'econ-confirm';
    el.innerHTML = `<h3>Đầu hàng?</h3><p>Trận đấu sẽ kết thúc ngay và tính là <b>thua</b>. Bạn chắc chắn chứ?</p>
      <div class="econ-row-btns"><button data-a="no">Tiếp tục chiến đấu</button><button class="danger" data-a="yes" id="btn-surrender-confirm">Đầu hàng</button></div>`;
    el.querySelector('[data-a=no]').onclick = () => closeModal();
    el.querySelector('[data-a=yes]').onclick = () => { this.g.paused = false; this.m.issue({ type: 'surrender' }); closeModal(); };
    this.g.paused = true;   // the battle waits while the player decides
    openModal('surrender', el, { onClose: () => { if (!this.g.ended) this.g.paused = false; } });
  }

  buildDeployPanel() {
    const p = $('deploy-panel');
    const side = this.g.sides[this.m.side];
    if (this.g.phase !== 'deploy') { p.classList.add('hidden'); $('command-bar').classList.remove('hidden'); return; }
    p.classList.remove('hidden'); $('command-bar').classList.add('hidden');
    p.innerHTML = '';
    side.formation.forEach((slot, i) => {
      const def = unitDef(slot.unit);
      const d = document.createElement('div');
      d.className = 'slot' + (slot.deployed ? ' done' : '') + (this.m.pendingDeploy === i ? ' active' : '');
      d.dataset.slot = i;
      d.title = `${def.name} — ${def.ref}`;
      d.innerHTML = `<span class="tier">T${slot.tier || 1}</span><span class="count">x${def.swarmCount ? def.swarmCount * (slot.count || 1) : slot.count || 1}</span><img src="${unitIcon(slot.unit)}" onerror="this.style.visibility='hidden'"><div>${esc(def.name)}</div>`;
      d.onclick = () => { if (slot.deployed) return; this.m.pendingDeploy = i; this.buildDeployPanel(); this.toast('Click vào vùng triển khai (khung xanh) trên bản đồ để đặt ' + def.name); };
      p.appendChild(d);
    });
    const auto = document.createElement('button'); auto.textContent = 'Tự động triển khai'; auto.id = 'btn-autodeploy';
    auto.onclick = () => this.m.issue({ type: 'autodeploy' });
    const ready = document.createElement('button'); ready.className = 'primary'; ready.id = 'btn-ready'; ready.textContent = 'Sẵn sàng ▶';
    ready.onclick = () => { this.m.issue({ type: 'autodeploy' }); this.m.issue({ type: 'ready' }); };
    p.append(auto, ready);
  }

  onPhase() { this.buildDeployPanel(); this.toast('Bắt đầu chiến đấu! Chọn nhóm → chọn lệnh → click bản đồ.'); }

  renderSelection() {
    const p = $('selection-panel');
    const us = [...this.m.selected].map(id => this.g.units.get(id)).filter(u => u && u.alive);
    if (!us.length) { p.classList.add('hidden'); return; }
    p.classList.remove('hidden');
    const groups = new Map();
    for (const u of us) {
      const k = u.def.id;
      let gr = groups.get(k); if (!gr) groups.set(k, gr = { n: 0, hp: 0, max: 0, tier: u.tier, intents: new Map() });
      gr.n++; gr.hp += u.hp; gr.max += u.maxHp;
      gr.intents.set(u.intent, (gr.intents.get(u.intent) || 0) + 1);
    }
    p.innerHTML = `<div class="sel-head">Đã chọn <b>${us.length}</b> đơn vị</div>` + [...groups].map(([k, gr]) => {
      const def = unitDef(k), f = gr.hp / gr.max;
      const top = [...gr.intents].sort((a, b) => b[1] - a[1])[0][0];
      return `<div class="sel-row"><img src="${unitIcon(k)}" onerror="this.style.visibility='hidden'"><div class="sel-info">
        <div><b>${esc(def.name)}</b> × ${gr.n} <span class="amber">T${gr.tier}</span></div>
        <div class="hpbar"><i style="width:${Math.round(f * 100)}%;background:${hpColor(f)}"></i></div>
        <div class="muted">${intentLabel(top)}</div></div></div>`;
    }).join('');
  }

  toast(text) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = text;
    const box = $('toasts');
    box.appendChild(t);
    while (box.children.length > 5) box.firstChild.remove();
    setTimeout(() => t.remove(), 3000);
  }
  flash(id, cls) { const e = $(id); if (!e) return; e.classList.remove(cls); void e.offsetWidth; e.classList.add(cls); }
  showBox(x0, y0, x1, y1) {
    const b = $('select-box'); b.classList.remove('hidden');
    Object.assign(b.style, { left: Math.min(x0, x1) + 'px', top: Math.min(y0, y1) + 'px', width: Math.abs(x1 - x0) + 'px', height: Math.abs(y1 - y0) + 'px' });
  }
  hideBox() { $('select-box').classList.add('hidden'); }

  update(dt) {
    this.t += dt; this.selT += dt;
    if (this.selT > 0.5) { this.selT = 0; if (this.m.selected.size) this.renderSelection(); }
    if (this.t < 0.2) return;
    this.t = 0;
    const g = this.g, my = this.m.side, me = g.sides[my], en = g.sides[1 - my];
    const debt = totalDebt(me), due = nextDue(me);
    const training = me.troops.recruiting.reduce((a, r) => a + r.n, 0);
    const flow = (me.incomeRate || 0) - (me.upkeepRate || 0);
    const dueLeft = due ? due.due - g.time : 0;
    const cpF = me.cp / me.cpMax;
    const fcp = me.fcp || { used: 0, limit: 30 };
    $('hud-left').innerHTML = `
      <div class="hud-title">${esc(me.name)}${isMobilized(g, my) ? ' <span class="tag warn">TỔNG ĐỘNG VIÊN</span>' : ''}</div>
      <div class="stat"><span>🪖 Binh lính tham chiến / còn lại</span><b>${me.troops.active} / ${me.troops.reserve}${training ? ` <small class="muted">(+${training})</small>` : ''}</b></div>
      <div class="stat"><span>💰 Tiền</span><b class="amber">${formatUSD(me.money)} USDT</b></div>
      <div class="stat small"><span class="muted">Thu – chi mỗi phút</span><b class="${flow >= 0 ? 'ok' : 'bad'}">${flow >= 0 ? '+' : ''}${formatUSD(flow)}</b></div>
      <div class="stat"><span>📉 Nợ đến hạn</span><b class="${due && dueLeft < 60 ? 'bad blink' : ''}">${debt ? `${formatUSD(due.owed)} · ${fmtTime(dueLeft)}${me.loans.length > 1 ? ` <small class="muted">(tổng ${formatUSD(debt)})</small>` : ''}` : '0'}</b></div>
      <div class="stat"><span>⚡ Điểm chỉ huy</span><b>${Math.floor(me.cp)} / ${me.cpMax}</b></div>
      <div class="cpbar"><i style="width:${Math.round(cpF * 100)}%"></i></div>
      <div class="stat small"><span class="muted">CP đội hình</span><b>${fcp.used} / ${fcp.limit}</b></div>`;
    const a = Math.floor(me.score), b = Math.floor(en.score), tot = Math.max(1, a + b);
    $('hud-right').innerHTML = `
      <div class="hud-title">Điểm chiếm đóng</div>
      <div class="stat"><span style="color:var(--blue)">● Ta</span><b>${a}</b></div>
      <div class="stat"><span style="color:var(--red)">● Địch</span><b>${b}</b></div>
      <div class="scorebar"><i style="width:${(a / tot * 100).toFixed(1)}%"></i></div>
      <div class="stat small"><span class="muted">Cứ điểm ta – địch</span><b>${heldStrongpoints(g, my)} – ${heldStrongpoints(g, 1 - my)} / ${g.strongpoints.length}</b></div>
      <div class="stat small"><span class="muted">Hạ / mất</span><b>${me.stats.kills} / ${me.stats.lost}</b></div>`;
    const c = $('hud-center');
    if (g.phase === 'deploy') c.innerHTML = `<div class="panel phase-banner">TRIỂN KHAI <span class="timer">${Math.ceil(g.phaseTime)}s</span>${g.paused ? ' <span class="tag warn">TẠM DỪNG</span>' : ''}</div>`;
    else if (g.phase === 'battle') { const left = Math.max(0, MATCH_LIMIT - g.battleTime); c.innerHTML = `<div class="panel phase-banner"><span class="timer">${fmtTime(g.battleTime)}</span> <span class="muted">/ còn ${fmtTime(left)}</span>${g.paused ? ' <span class="tag warn">TẠM DỪNG</span>' : ''}</div>`; }
    else if (g.ended) c.innerHTML = `<div class="panel phase-banner">${g.ended.winner === my ? '<span class="ok">CHIẾN THẮNG</span>' : g.ended.winner === -1 ? 'HÒA' : '<span class="bad">THẤT BẠI</span>'} <span class="muted">${esc(g.ended.reason)}</span></div>`;
    this.drawMinimap();
  }

  drawMinimap() {
    const g = this.g, ctx = this.mini, W = 240, H = 150, sx = W / g.map.w, sz = H / g.map.h;
    if (!this.miniBg) {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d');
      const col = ['#6d8a46', '#245777', '#3d8a96', '#555a60', '#8d8a5a', '#9a8f70', '#41632f', '#7a7466'];
      for (let r = 0; r < g.map.rows; r++) for (let q = 0; q < g.map.cols; q++) { x.fillStyle = col[g.map.grid[r * g.map.cols + q]]; x.fillRect(q * 2 * sx, r * 2 * sz, 2 * sx + 0.5, 2 * sz + 0.5); }
      this.miniBg = c;
    }
    ctx.drawImage(this.miniBg, 0, 0);
    const fog = g.fog?.[this.m.side];
    if (fog) { ctx.fillStyle = 'rgba(5,8,12,0.55)'; for (let r = 0; r < g.map.rows; r += 1) for (let q = 0; q < g.map.cols; q += 1) if (!fog.visible[r * g.map.cols + q]) ctx.fillRect(q * 2 * sx, r * 2 * sz, 2 * sx + 0.3, 2 * sz + 0.3); }
    for (const sp of g.strongpoints) { ctx.fillStyle = sp.owner === 0 ? '#3f8cff' : sp.owner === 1 ? '#ff4a3d' : '#ddd'; ctx.fillRect(sp.x * sx - 3, sp.z * sz - 3, 6, 6); }
    for (const s of g.structures) { if (!s.alive || !(s.side === this.m.side || s[`seen${this.m.side}`])) continue; ctx.fillStyle = s.side === 0 ? '#9cc4ff' : '#ff9a90'; const k = s.type === 'hq' ? 5 : 3; ctx.fillRect(s.x * sx - k, s.z * sz - k, k * 2, k * 2); }
    for (const u of g.units.values()) { if (!u.alive || u.carriedBy || !(u.side === this.m.side || u.visible[this.m.side])) continue; ctx.fillStyle = u.side === 0 ? '#3f8cff' : '#ff4a3d'; ctx.fillRect(u.x * sx - 1.5, u.z * sz - 1.5, 3, 3); }
    // camera
    const t = this.m.R.target; ctx.strokeStyle = '#ffd27a'; ctx.strokeRect(t.x * sx - 12, t.z * sz - 8, 24, 16);
  }
  minimapClick(e) {
    const r = e.target.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * this.g.map.w, z = (e.clientY - r.top) / r.height * this.g.map.h;
    if (e.button === 2 && this.m.selected.size) this.m.orderAt('attack', x, z); else this.m.R.focus(x, z);
  }
}

export function hpColor(f) { return f > 0.6 ? '#55e07a' : f > 0.3 ? '#ffc24d' : '#ff5a4a'; }

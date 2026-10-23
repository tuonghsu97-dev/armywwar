// OWNER: agent Meta & chế độ chơi
// Guided tutorial (F-190): dims the screen except one highlighted element, draws an arrow + a short Vietnamese
// instruction bubble and advances when the player performs the real action (game events / DOM state).
// Works with mouse and touch (taps are clicks). Every step has "Bỏ qua" (end tutorial) and "Tiếp" (next step).
// Step 1 lives on the main menu (showMenuHint on #btn-tutorial); steps 2–11 run in a 'tutorial' match.
import * as P from '../core/profile.js';
import { COMMANDERS } from '../data/commanders.js';

export const TOTAL_STEPS = 11;

export function tutorialMatchOpts() {
  const o = {
    mode: 'tutorial', mapId: 'plains', seed: 777,
    player: { commander: 'steel', name: 'Học viên', formation: [
      { unit: 'tank_heavy', tier: 1, count: 1 },
      { unit: 'tank_heavy', tier: 1, count: 1 },
      { unit: 'apc', tier: 1, count: 1 },
      { unit: 'drone_recon', tier: 1, count: 1 },
      { unit: 'infantry', tier: 1, count: 1 },
    ] },
    enemy: { commander: 'air', ai: true, difficulty: 0.4, name: 'Địch tập', formation: [
      { unit: 'apc', tier: 1, count: 1 },
      { unit: 'infantry', tier: 1, count: 1 },
    ] },
  };
  Object.assign(o.player, P.playerEconomy(o.player.formation));
  Object.assign(o.enemy, P.playerEconomy(o.enemy.formation));
  return o;
}

// ---------------------------------------------------------------- overlay (shared by menu hint + match tutorial)
class Overlay {
  constructor() {
    this.root = document.getElementById('tutorial');
    this.root.classList.remove('hidden');
    this.root.innerHTML = `
      <div class="tut-dim"></div>
      <div class="tut-hole"></div>
      <div class="tut-arrow">▼</div>
      <div class="tut-bubble">
        <div class="tut-step"></div>
        <div class="tut-text"></div>
        <div class="tut-actions"><button class="tut-skip" id="tut-skip">Bỏ qua</button><button class="tut-next primary" id="tut-next">Tiếp ▶</button></div>
      </div>`;
    this.dim = this.root.querySelector('.tut-dim');
    this.hole = this.root.querySelector('.tut-hole');
    this.arrow = this.root.querySelector('.tut-arrow');
    this.bubble = this.root.querySelector('.tut-bubble');
  }
  setText(step, html, nextLabel = 'Tiếp ▶') {
    this.root.querySelector('.tut-step').textContent = step;
    this.root.querySelector('.tut-text').innerHTML = html;
    this.root.querySelector('.tut-next').textContent = nextLabel;
  }
  onSkip(fn) { this.root.querySelector('.tut-skip').onclick = fn; }
  onNext(fn) { this.root.querySelector('.tut-next').onclick = fn; }
  // rect: {x,y,w,h} in client px, or null for a centred bubble.
  // opts.side: put the bubble beside the hole (left/right) instead of above/below; opts.avoidBottom: px kept
  // free at the bottom of the screen (deploy tray) — the bubble never covers it.
  layout(rect, opts = {}) {
    const W = window.innerWidth, H = window.innerHeight, pad = 6;
    if (rect && opts.side) {
      const bw0 = Math.min(300, W - 24);
      const x = Math.max(2, rect.x - pad), y = Math.max(2, rect.y - pad);
      const w = Math.min(W - x - 2, rect.w + pad * 2), h = Math.min(H - y - 2, rect.h + pad * 2);
      const right = x + w + 46 + bw0 <= W - 8, left = x - 46 - bw0 >= 8;
      if (right || left) {
        this.dim.style.display = 'none';
        Object.assign(this.hole.style, { display: 'block', left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
        this.bubble.style.width = bw0 + 'px';
        const bh = this.bubble.offsetHeight || 120;
        const bx = right ? x + w + 40 : x - 40 - bw0;
        const maxY = H - (opts.avoidBottom || 0) - bh - 8;
        const by = Math.max(8, Math.min(maxY, y + h / 2 - bh / 2));
        Object.assign(this.bubble.style, { left: bx + 'px', top: by + 'px' });
        this.arrow.style.display = 'block'; this.arrow.classList.remove('up');
        this.arrow.textContent = right ? '◀' : '▶';
        Object.assign(this.arrow.style, { left: (right ? x + w + 6 : x - 34) + 'px', top: (y + h / 2 - 15) + 'px' });
        return;
      }
    }
    this._layout(rect, opts);
  }
  _layout(rect, opts = {}) {
    const W = window.innerWidth, H = window.innerHeight, pad = 6;
    const bw = Math.min(340, W - 24);
    this.bubble.style.width = bw + 'px';
    const bh = this.bubble.offsetHeight || 120;
    if (!rect) {
      this.hole.style.display = 'none'; this.arrow.style.display = 'none'; this.dim.style.display = 'block';
      Object.assign(this.bubble.style, { left: (W - bw) / 2 + 'px', top: Math.max(12, H * 0.3 - bh / 2) + 'px' });
      return;
    }
    this.dim.style.display = 'none';
    const x = Math.max(2, rect.x - pad), y = Math.max(2, rect.y - pad);
    const w = Math.min(W - x - 2, rect.w + pad * 2), h = Math.min(H - y - 2, rect.h + pad * 2);
    Object.assign(this.hole.style, { display: 'block', left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    const cx = x + w / 2;
    const below = y + h / 2 < H * 0.5;            // target in the upper half -> bubble below it
    let by = below ? y + h + 40 : y - bh - 40;
    by = Math.max(8, Math.min(H - (opts.avoidBottom || 0) - bh - 8, by));
    const bx = Math.max(8, Math.min(W - bw - 8, cx - bw / 2));
    Object.assign(this.bubble.style, { left: bx + 'px', top: by + 'px' });
    this.arrow.style.display = 'block';
    this.arrow.textContent = below ? '▲' : '▼';
    this.arrow.classList.toggle('up', below);
    Object.assign(this.arrow.style, { left: (cx - 14) + 'px', top: (below ? y + h + 4 : y - 34) + 'px' });
  }
  destroy() { this.root.innerHTML = ''; this.root.classList.add('hidden'); }
}

function elRect(sel) {
  const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 && r.height < 2) return null;
  const st = getComputedStyle(el);
  if (st.display === 'none' || st.visibility === 'hidden') return null;
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}
function clipRect(r) {
  const W = window.innerWidth, H = window.innerHeight;
  const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y), x1 = Math.min(W, r.x + r.w), y1 = Math.min(H, r.y + r.h);
  return x1 - x0 < 8 || y1 - y0 < 8 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ---------------------------------------------------------------- step 1: main menu hint
let menuHint = null;
export function showMenuHint(selector = '#btn-tutorial') {
  hideMenuHint();
  if (!document.querySelector(selector)) return;
  const ov = new Overlay();
  ov.root.classList.add('menu-hint');
  ov.setText(`Bước 1/${TOTAL_STEPS}`, 'Lần đầu chơi? Bấm <b>Hướng dẫn chơi</b> để vào trận tập — mình sẽ chỉ bạn <b>click vào đâu</b> từng bước. (Hoặc bấm <b>▶ Chơi nhanh</b> nếu đã quen.)', 'Vào trận tập ▶');
  const h = menuHint = { ov, alive: true };
  // QA #12: "Bỏ qua" is remembered — the menu hint does not come back on every visit.
  ov.onSkip(() => { hideMenuHint(); const p = P.getProfile(); p.menuHintSkipped = true; P.saveProfile(p); });
  ov.onNext(() => { hideMenuHint(); document.querySelector(selector)?.click(); });
  const loop = () => {
    if (!h.alive) return;
    const r = elRect(selector);
    if (!r) { hideMenuHint(); return; }
    ov.layout(r);
    requestAnimationFrame(loop);
  };
  loop();
}
export function hideMenuHint() {
  if (!menuHint) return;
  menuHint.alive = false; menuHint.ov.destroy(); menuHint = null;
}

// ---------------------------------------------------------------- steps 2–11: in-match tutorial
export class Tutorial {
  constructor(app, match) {
    this.app = app; this.m = match; this.g = match.game;
    this.i = -1; this.alive = false; this.t = 0;
    this.steps = this.buildSteps();
  }

  start() {
    hideMenuHint();
    this.ov = new Overlay();
    this.alive = true;
    this.ov.onSkip(() => this.finish(false));
    this.ov.onNext(() => this.next());
    const ev = ['deployed', 'deploy:placed', 'phase', 'selection', 'pending', 'order', 'order:ui', 'capture'];
    this.offs = ev.map(name => this.g.events.on(name, e => this.onEvent(name, e)));
    this.go(0);
    this.last = performance.now();
    requestAnimationFrame(this.loop = this.loop.bind(this));
    return this;
  }

  idx(id) { return this.steps.findIndex(s => s.id === id); }
  go(i) {
    if (typeof i === 'string') i = this.idx(i);
    if (i >= this.steps.length) { this.finish(true); return; }
    this.i = i; this.t = 0;
    const s = this.steps[i];
    s.enter?.();
    this.ov.setText(`Bước ${s.n}/${TOTAL_STEPS}`, s.text, i === this.steps.length - 1 ? 'Hoàn thành ✔' : 'Tiếp ▶');
  }
  next() { this.go(this.i + 1); }

  onEvent(name, e) {
    if (!this.alive) return;
    const s = this.steps[this.i];
    const fn = s && s.on && s.on[name];
    if (fn && fn(e)) this.next();
  }

  loop(now) {
    if (!this.alive) return;
    if (this.app.match !== this.m || !this.m.running || this.g.ended) { this.finish(!!this.g.ended); return; }
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now; this.t += dt;
    const s = this.steps[this.i];
    // Beginners get time: hold the 30 s deploy timer while the deploy steps are shown.
    if (this.g.phase === 'deploy' && this.i <= this.idx('ready') && this.g.phaseTime < 15) this.g.phaseTime = 15;
    if (s.skipIf?.()) { this.next(); requestAnimationFrame(this.loop); return; }
    const r = s.poll?.(dt);
    if (r === 'next') { this.next(); requestAnimationFrame(this.loop); return; }
    if (typeof r === 'string' && r.startsWith('back:')) { this.go(r.slice(5)); requestAnimationFrame(this.loop); return; }
    // QA #8: while a modal (shop / roster / pause menu) is open the overlay steps aside, and comes back after.
    const md = typeof document !== 'undefined' && document.getElementById ? document.getElementById('modal') : null;
    const modalOpen = !!(md && md.classList && !md.classList.contains('hidden'));
    this.ov.root.style.display = modalOpen ? 'none' : '';
    if (modalOpen) { requestAnimationFrame(this.loop); return; }
    let rect = null;
    try { rect = s.target ? s.target() : null; } catch (e) { rect = null; }
    this.ov.layout(rect, s.layout || {});
    requestAnimationFrame(this.loop);
  }

  finish(completed) {
    if (!this.alive) return;
    this.alive = false;
    this.offs?.forEach(f => f());
    this.ov?.destroy();
    const p = P.getProfile();
    if (!p.tutorialDone) { p.tutorialDone = true; P.saveProfile(p); }
    if (completed && this.m.running && !this.g.ended) this.m.hud?.toast?.('Hoàn thành hướng dẫn! Tiếp tục trận tập, hoặc bấm ⏸ Tạm dừng (Esc) → Thoát ra menu để chơi thật.');
  }

  // ---- geometry helpers
  // QA #7: the whole zone (42×134) fills the screen at tactical zoom, so the hole frames a ~26 m patch of the zone
  // next to the player's base (camera is focused on it in the step's enter), clamped above the deploy tray.
  zonePoint() {
    const z = this.g.map.deployZones[this.m.side], b = this.g.map.bases[this.m.side];
    const extra = this.g.sides[this.m.side].deployBonus || 0;
    const x0 = z.x0 + 8, x1 = z.x1 + extra - 8;
    return { x: Math.max(x0, Math.min(x1, b.x + (this.m.side === 0 ? 20 : -20))), z: Math.max(z.z0 + 8, Math.min(z.z1 - 8, b.z)) };
  }
  zoneRect() {
    const R = this.m.R, c = this.zonePt || this.zonePoint(), s = 13;
    const pts = [[c.x - s, c.z - s], [c.x + s, c.z - s], [c.x - s, c.z + s], [c.x + s, c.z + s]].map(([x, zz]) => R.toScreen(x, 0, zz));
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const r = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    const tray = elRect('#deploy-panel');
    if (tray) { const y1 = Math.min(r.y + r.h, tray.y - 8); r.h = y1 - r.y; }
    return clipRect(r);
  }
  worldRect(x, y, z, worldR) {
    const R = this.m.R, c = R.toScreen(x, y, z);
    if (!c.onScreen) return null;
    const e = R.toScreen(x + worldR, y, z), e2 = R.toScreen(x, y, z + worldR);
    const r = Math.max(22, Math.hypot(e.x - c.x, e.y - c.y), Math.hypot(e2.x - c.x, e2.y - c.y));
    return clipRect({ x: c.x - r, y: c.y - r, w: r * 2, h: r * 2 });
  }
  myTank() {
    const mine = [...this.g.units.values()].filter(u => u.alive && u.side === this.m.side && !u.carriedBy);
    return mine.find(u => u.def.id === 'tank_heavy') || mine.find(u => u.def.group === 'tank') || mine[0] || null;
  }
  selCentroid() {
    const us = [...this.m.selected].map(id => this.g.units.get(id)).filter(u => u && u.alive);
    if (!us.length) { const t = this.myTank(); return t ? { x: t.x, z: t.z } : this.g.map.bases[this.m.side]; }
    return { x: us.reduce((a, u) => a + u.x, 0) / us.length, z: us.reduce((a, u) => a + u.z, 0) / us.length };
  }
  pickStrongpoint() {
    const c = this.selCentroid();
    const sps = this.g.strongpoints.filter(s => s.owner !== this.m.side);
    sps.sort((a, b) => (a.owner === -1 ? 0 : 50) + Math.hypot(a.x - c.x, a.z - c.z) - (b.owner === -1 ? 0 : 50) - Math.hypot(b.x - c.x, b.z - c.z));
    return sps[0] || this.g.strongpoints[0];
  }

  buildSteps() {
    const m = this.m, g = this.g, me = () => m.side;
    const deploy = () => g.phase === 'deploy';
    const ultName = COMMANDERS[g.sides[me()].commander]?.ultimate?.name || 'Lệnh tối thượng';
    return [
      { id: 'slot', n: 2,
        text: 'Đây là <b>khay triển khai</b> (30 giây đầu trận). <b>Click chọn đơn vị</b> — ô đầu tiên là xe tăng.',
        target: () => elRect('.slot[data-slot="0"]:not(.done)') || elRect('.slot:not(.done)'),
        skipIf: () => !deploy(),
        poll: () => (m.pendingDeploy != null ? 'next' : null) },
      { id: 'zone', n: 3,
        text: '<b>Click vào ô sáng</b> (trong vùng xanh nhấp nháy) để đặt đơn vị. Chỉ đặt được trong vùng triển khai của bạn.',
        // Tactical zoom centred on a patch of the zone next to the base; bubble beside it, never over the tray.
        enter: () => { this.placedAt = null; this.zonePt = this.zonePoint(); m.R.setZoom?.(1); m.R.focus(this.zonePt.x, this.zonePt.z); },
        target: () => this.zoneRect(),
        layout: { side: true, avoidBottom: 150 },
        skipIf: () => !deploy(),
        on: { deployed: e => e && e.side === me(), 'deploy:placed': () => { this.placedAt = this.t; return false; } },
        // Cancelled (no click) or invalid spot (no 'deployed' shortly after the click) -> back to the slot step.
        poll: () => (m.pendingDeploy == null && (this.placedAt == null ? this.t > 0.6 : this.t - this.placedAt > 0.8) ? 'back:slot' : null) },
      { id: 'ready', n: 4,
        text: 'Tốt lắm! Đặt thêm đơn vị nếu muốn, rồi <b>bấm Sẵn sàng</b> để bắt đầu trận (các ô còn lại tự triển khai).',
        target: () => elRect('#btn-ready'),
        skipIf: () => !deploy(),
        on: { phase: e => e && e.phase === 'battle' } },
      { id: 'select', n: 5,
        text: 'Trận đã bắt đầu! <b>Click vào xe tăng</b> của bạn để chọn cả nhóm (hoặc bấm phím 1–9). Bạn ra lệnh cho nhóm, AI tự thực thi.',
        enter: () => { const t = this.myTank(); if (t) m.R.focus(t.x, t.z); },
        target: () => { const t = this.myTank(); return t ? this.worldRect(t.x, t.alt, t.z, Math.max(3, t.def.size)) : null; },
        skipIf: () => deploy() ? false : !this.myTank(),
        on: { selection: ids => ids && ids.length > 0 } },
      { id: 'cmd', n: 6,
        text: 'Giờ <b>chọn lệnh Chiếm cứ điểm</b> ⚑ trên thanh lệnh.',
        target: () => elRect('.cmd[data-order="capture"]'),
        on: { pending: t => t === 'capture' },
        poll: () => (m.selected.size === 0 && this.t > 0.3 ? 'back:select' : null) },
      { id: 'sp', n: 7,
        enter: () => { this.sp = this.pickStrongpoint(); const c = this.selCentroid(); if (this.sp) m.R.focus((c.x + this.sp.x) / 2, (c.z + this.sp.z) / 2); },
        text: '<b>Click vào cứ điểm</b> trung lập (vòng trắng) gần nhất để ra lệnh chiếm.',
        target: () => this.sp ? this.worldRect(this.sp.x, 0, this.sp.z, this.sp.radius) : null,
        on: {
          order: e => e && e.side === me() && (e.order === 'capture' || e.order === 'attack'),
          'order:ui': e => e && (e.type === 'capture' || e.type === 'attack'),
        },
        poll: () => (!m.pendingOrder && this.t > 0.5 ? (m.selected.size ? 'back:cmd' : 'back:select') : null) },
      { id: 'capture', n: 8,
        text: 'Đơn vị mặt đất phải đứng trong vòng cứ điểm <b>15 giây liên tục</b> để cắm cờ — xem <b>thanh vàng</b> phía trên. Có địch trong vòng thì thanh dừng/reset. Cứ điểm cho tiền, điểm chỉ huy, hồi máu và tầm nhìn.',
        target: () => this.sp ? this.worldRect(this.sp.x, 0, this.sp.z, this.sp.radius + 2) : null,
        on: { capture: e => e && e.side === me() } },
      { id: 'shop', n: 9,
        text: '<b>S</b> = Cửa hàng: mua khí tài, nâng tier, tuyển quân, vay vốn. <b>B</b> = Danh sách khí tài: số lượng, tier, HP, đạn, đang làm gì. Trên điện thoại bấm các nút này.',
        target: () => {
          const a = elRect('#btn-shop'), b = elRect('#btn-roster');
          if (a && b) { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; }
          return a || b || elRect('#hud-buttons');
        } },
      { id: 'camera', n: 10,
        text: 'Camera: <b>lăn chuột</b> (hoặc Z/X, chụm 2 ngón) để zoom 3 mức chiến lược/chiến thuật/cận cảnh · <b>Q/E</b> xoay 4 hướng · <b>kéo chuột phải</b>, phím mũi tên hoặc kéo 1 ngón để di chuyển · <b>click bản đồ nhỏ</b> để nhảy tới.',
        target: () => elRect('#minimap-wrap') },
      { id: 'ultimate', n: 11,
        text: `<b>${ultName}</b> — lệnh tối thượng của chỉ huy, tốn điểm chỉ huy (chiếm cứ điểm để hồi).<br><b>Thắng</b>: phá thành chỉ huy địch, địch đầu hàng, hoặc hết 1 giờ mà điểm chiếm đóng cao hơn. <b>Thua</b>: mất thành, đầu hàng, hết binh lính hoặc vỡ nợ.`,
        target: () => elRect('#ab-ult') || elRect('#hud-side button') || elRect('#hud-side') || elRect('#hud-right') },
    ];
  }
}

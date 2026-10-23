// Match controller: glues sim (Game) + renderer + world view + FX + input + HUD for one battle.
// UI modules talk to the match through this object (selection, pending order/deploy, hotkeys, issue()).
import { createGame } from './sim/index.js';
import { TICK } from './core/game.js';
import { Renderer } from './render/renderer.js';
import { WorldView } from './render/world.js';
import { FX } from './render/fx.js';
import { Input } from './ui/input.js';
import { Hud } from './ui/hud.js';
import * as Abilities from './ui/abilities.js';
import * as Shop from './ui/shop.js';
import * as Roster from './ui/roster.js';
import { ORDER_TYPES } from './sim/commands.js';

export const ORDER_INFO = {
  attack: { label: 'Tấn công điểm', glyph: '✸', desc: 'Tổng lực đánh điểm chỉ định, đánh mục tiêu gần nhất' },
  defend: { label: 'Phòng thủ vùng', glyph: '⛨', desc: 'Giữ vị trí, ưu tiên phản công' },
  suppress: { label: 'Áp chế', glyph: '≋', desc: 'Bắn giữ chân, không tiến lên' },
  flank: { label: 'Vòng đánh họng', glyph: '↷', desc: 'Đi vòng đánh sau lưng' },
  sead: { label: 'SEAD', glyph: '⌖', desc: 'Ưu tiên làm câm phòng không địch' },
  retreat: { label: 'Rút lui / Tái lập', glyph: '↩', desc: 'Về căn cứ sửa chữa, nạp đạn' },
  focus: { label: 'Ép gặp / Phá tung', glyph: '◎', desc: 'Tất cả dồn đánh một mục tiêu' },
  move: { label: 'Di chuyển', glyph: '➜', desc: 'Đi tới điểm, không dừng đánh' },
  capture: { label: 'Chiếm cứ điểm', glyph: '⚑', desc: 'Vào vòng cứ điểm cắm cờ 15 giây' },
};

export class Match {
  constructor(canvas, opts, app) {
    this.app = app;
    this.opts = opts;
    this.side = 0;
    this.game = createGame(opts);
    this.R = app.renderer || (app.renderer = new Renderer(canvas));
    this.R.scene.clear(); this.R.setupLights(); this.R.updaters = [];
    this.R.setMap(this.game.map);
    this.view = new WorldView(this.R, this.game, this.side);
    this.fx = new FX(this.R, this.game, this.side, this.view);
    this.selected = this.view.selected;
    this.pendingOrder = null;   // order type waiting for a map click
    this.pendingDeploy = null;  // slot index waiting for a map click
    this.hotkeys = {};
    this.acc = 0;
    this.running = true;
    this.input = new Input(this);
    this.hud = new Hud(this);
    Abilities.install?.(this);
    Shop.install?.(this);
    Roster.install?.(this);
    this.game.events.on('end', e => this.onEnd(e));
    this.game.events.on('toast', t => { if (t.side === this.side || t.side == null) this.hud.toast(t.text); });
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    // Debug/test hook (used by the test agent through the browser).
    window.__match = this;
  }

  issue(cmd) { this.game.issue(this.side, cmd); }

  loop(now) {
    if (!this.running) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.acc += dt * this.game.timeScale;
    let steps = 0;
    while (this.acc >= TICK && steps < 8) { this.game.step(); this.acc -= TICK; steps++; }
    if (steps === 8) this.acc = 0;
    this.input.update(dt);
    this.view.update(dt);
    this.fx.update(dt);
    const pts = [];
    for (const u of this.game.units.values()) if (u.alive && (u.side === this.side || u.visible[this.side]) && !u.isAir) pts.push(u);
    this.R.fadeBuildings(pts.slice(0, 120));
    this.R.render(dt);
    this.hud.update(dt);
    Abilities.update?.(this, dt);
    requestAnimationFrame(this.loop);
  }

  // ---- selection ----
  myUnit(u) { return u && u.alive && u.side === this.side && !u.carriedBy; }
  setSelection(ids) {
    this.selected.clear();
    for (const id of ids) this.selected.add(id);
    this.game.events.emit('selection', [...this.selected]);
  }
  selectGroup(slot, add = false) {
    const ids = [...this.game.units.values()].filter(u => this.myUnit(u) && u.group === slot).map(u => u.id);
    if (!add) this.selected.clear();
    ids.forEach(id => this.selected.add(id));
    this.game.events.emit('selection', [...this.selected]);
    if (ids.length) this.lastGroup = slot;
  }
  focusSelection() {
    const us = [...this.selected].map(id => this.game.units.get(id)).filter(Boolean);
    if (!us.length) return;
    this.R.focus(us.reduce((a, u) => a + u.x, 0) / us.length, us.reduce((a, u) => a + u.z, 0) / us.length);
  }
  unitAt(x, z, pred) {
    let best = null, bd = Infinity;
    for (const u of this.game.units.values()) {
      if (!u.alive || u.carriedBy || !pred(u)) continue;
      const d = Math.hypot(u.x - x, u.z - z) - u.def.size * 0.4 - (u.isAir ? 1.5 : 0);
      if (d < 2.2 && d < bd) { bd = d; best = u; }
    }
    return best;
  }
  enemyAt(x, z) {
    const u = this.unitAt(x, z, u => u.side !== this.side && u.visible[this.side]);
    if (u) return u;
    return this.game.structures.find(s => s.alive && s.side !== this.side && s[`seen${this.side}`] && Math.hypot(s.x - x, s.z - z) < 5) || null;
  }
  boxSelect(x0, y0, x1, y1, add) {
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)], [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    const ids = [];
    for (const u of this.game.units.values()) {
      if (!this.myUnit(u)) continue;
      const s = this.R.toScreen(u.x, u.alt, u.z);
      if (s.x >= ax && s.x <= bx && s.y >= ay && s.y <= by) ids.push(u.id);
    }
    if (!add) this.selected.clear();
    ids.forEach(id => this.selected.add(id));
    this.game.events.emit('selection', [...this.selected]);
  }

  // ---- clicks ----
  leftClick(x, z, shift) {
    const g = this.game;
    if (this.pendingDeploy != null) {
      this.issue({ type: 'deploy', slot: this.pendingDeploy, x, z, reinforce: g.phase !== 'deploy' });
      this.game.events.emit('deploy:placed', { slot: this.pendingDeploy, x, z });
      this.pendingDeploy = null;
      return;
    }
    if (this.pendingAbility) { const a = this.pendingAbility; this.pendingAbility = null; a(x, z); return; }
    if (this.pendingOrder) {
      this.orderAt(this.pendingOrder, x, z);
      this.pendingOrder = null;
      this.game.events.emit('pending', null);
      return;
    }
    const u = this.unitAt(x, z, u => this.myUnit(u));
    if (u) {
      // Clicking a unit selects its whole group (players command groups, GDD F-02); shift adds.
      if (!shift) this.selected.clear();
      this.selectGroup(u.group, true);
      return;
    }
    if (!shift) { this.selected.clear(); this.game.events.emit('selection', []); }
  }
  rightClick(x, z) {
    if (this.pendingDeploy != null || this.pendingOrder || this.pendingAbility) { this.cancel(); return; }
    if (!this.selected.size) return;
    const enemy = this.enemyAt(x, z);
    if (enemy) { this.orderAt('focus', enemy.x, enemy.z, enemy.id); return; }
    const sp = this.game.strongpoints.find(s => Math.hypot(s.x - x, s.z - z) < s.radius && s.owner !== this.side);
    this.orderAt(sp ? 'capture' : 'attack', x, z);
  }
  setPendingOrder(type) {
    if (!ORDER_TYPES.includes(type)) return;
    if (!this.selected.size) { this.hud.toast('Chọn nhóm đơn vị trước (click vào đơn vị hoặc phím 1–9)'); return; }
    if (type === 'retreat') { this.orderAt('retreat', 0, 0); return; }
    this.pendingOrder = type;
    this.game.events.emit('pending', type);
  }
  orderAt(type, x, z, targetId) {
    if (type === 'focus' && targetId == null) { const e = this.enemyAt(x, z); if (e) targetId = e.id; }
    this.issue({ type: 'order', unitIds: [...this.selected], order: type, x, z, targetId });
    this.view.markOrder?.(x, z, type);
    this.game.events.emit('order:ui', { type, x, z });
  }
  cancel() {
    this.pendingOrder = null; this.pendingDeploy = null; this.pendingAbility = null;
    this.game.events.emit('pending', null);
  }

  onEnd(e) {
    setTimeout(() => this.app.onMatchEnd?.(this, e), 1500);
  }

  destroy() {
    this.running = false;
    this.fx.dispose?.();
    this.input.dispose();
    this.hud.dispose?.();
    this.R.scene.clear();
    window.__match = null;
  }
}

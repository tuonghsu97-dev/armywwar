// Mouse / touch / keyboard input for a match. GDD §2 step 3: tap/click a group → choose order → tap map point.
//  - Left click unit: select it (double click / click again = whole group). Drag: box select. 1–9: select group.
//  - Right click on map: issue the active order (default: Tấn công điểm) at that point; on enemy: Ép gặp (focus).
//  - Command bar: pick an order, then left click the map.
//  - Camera: arrows/edge pan, right/middle drag pan, wheel = 3 zoom levels, Q/E rotate.
//  - Touch: 1 finger tap = select / place; 1 finger drag on empty ground = pan; pinch = zoom.
//  - S = shop, B = roster (handled by ui/shop.js, ui/roster.js through match.hotkeys).
export class Input {
  constructor(match) {
    this.m = match;
    this.canvas = match.R.canvas;
    this.keys = new Set();
    this.drag = null;
    this.touches = new Map();
    this.mouse = { x: 0, y: 0, inside: false, moved: false };
    this.edgePan = true;
    const c = this.canvas;
    // Every listener is stored so dispose() removes ALL of them: the canvas is shared between matches
    // (QA #3: leftover wheel listeners made one wheel notch jump several zoom levels after 2+ matches).
    this.h = {
      contextmenu: e => e.preventDefault(),
      pointerdown: e => this.down(e),
      wheel: e => { e.preventDefault(); this.m.R.zoomStep(e.deltaY > 0 ? -1 : 1); },
      // QA #17: edge-pan only after a real pointermove inside the canvas (entering alone gives stale coords).
      pointerenter: () => { this.mouse.inside = true; this.mouse.moved = false; },
      pointerleave: () => { this.mouse.inside = false; this.mouse.moved = false; },
    };
    for (const [n, f] of Object.entries(this.h)) c.addEventListener(n, f, n === 'wheel' ? { passive: false } : undefined);
    window.addEventListener('pointermove', this.onMove = e => this.move(e));
    window.addEventListener('pointerup', this.onUp = e => this.up(e));
    window.addEventListener('keydown', this.onKey = e => this.key(e, true));
    window.addEventListener('keyup', this.onKeyUp = e => this.key(e, false));
  }

  dispose() {
    for (const [n, f] of Object.entries(this.h)) this.canvas.removeEventListener(n, f, n === 'wheel' ? { passive: false } : undefined);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    this.keys.clear();
  }

  key(e, down) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    if (down) {
      this.keys.add(k);
      if (this.m.hotkeys[k] && !e.repeat) { e.preventDefault(); this.m.hotkeys[k](); return; }
      if (k === 'q') this.m.R.rotate(-1);
      if (k === 'e') this.m.R.rotate(1);
      if (k === 'z') this.m.R.zoomStep(1);
      if (k === 'x') this.m.R.zoomStep(-1);
      if (k === 'escape') {
        // Esc cancels a pending order/deploy/ability first; otherwise it opens/closes the pause menu (QA #9).
        const m = this.m, conf = document.getElementById('ab-confirm');
        const confOpen = conf && !conf.classList.contains('hidden');
        if (m.pendingOrder || m.pendingDeploy != null || m.pendingAbility || confOpen) { m.cancel(); if (confOpen) { conf.classList.add('hidden'); conf.innerHTML = ''; } }
        else m.hud?.togglePause?.();
      }
      if (k === ' ') { e.preventDefault(); this.m.focusSelection(); }
      if (/^[1-9]$/.test(k)) this.m.selectGroup(Number(k) - 1, e.shiftKey);
    } else this.keys.delete(k);
  }

  update(dt) {
    const sp = this.m.R.viewH * 0.9 * dt;
    let dx = 0, dz = 0;
    // Arrow keys only: S and B are reserved for the shop and roster (GDD §16).
    if (this.keys.has('arrowup')) dz += sp;
    if (this.keys.has('arrowdown')) dz -= sp;
    if (this.keys.has('arrowleft')) dx -= sp;
    if (this.keys.has('arrowright')) dx += sp;
    if (this.edgePan && this.mouse.inside && this.mouse.moved && !this.drag && matchMedia('(pointer:fine)').matches) {
      const w = window.innerWidth, h = window.innerHeight, e = 6;
      if (this.mouse.x < e) dx -= sp; if (this.mouse.x > w - e) dx += sp;
      if (this.mouse.y < e) dz += sp; if (this.mouse.y > h - e) dz -= sp;
    }
    if (dx || dz) this.m.R.pan(dx, dz);
  }

  down(e) {
    try { this.canvas.setPointerCapture?.(e.pointerId); } catch { /* synthetic / already released pointer */ }
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
      if (this.touches.size === 2) { const [a, b] = [...this.touches.values()]; this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; this.drag = null; }
      else this.drag = { button: 0, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, touch: true, moved: false };
      return;
    }
    this.drag = { button: e.button, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, moved: false, shift: e.shiftKey };
  }

  move(e) {
    this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    if (this.mouse.inside && e.target === this.canvas) this.mouse.moved = true;
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      const t = this.touches.get(e.pointerId); t.x = e.clientX; t.y = e.clientY;
      if (this.pinch && this.touches.size === 2) {
        const [a, b] = [...this.touches.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d / this.pinch.d > 1.35) { this.m.R.zoomStep(1); this.pinch.d = d; }
        else if (d / this.pinch.d < 0.74) { this.m.R.zoomStep(-1); this.pinch.d = d; }
        return;
      }
    }
    const d = this.drag;
    if (!d) return;
    const mx = e.clientX - d.x, my = e.clientY - d.y;
    d.x = e.clientX; d.y = e.clientY;
    if (Math.hypot(d.x - d.sx, d.y - d.sy) > 6) d.moved = true;
    if (d.button === 1 || d.button === 2 || (d.touch && d.moved && !this.m.pendingOrder && !this.m.pendingDeploy)) {
      // Pan: convert pixels to world units.
      const k = this.m.R.viewH / this.canvas.clientHeight;
      this.m.R.pan(-mx * k, my * k / Math.sin(50 * Math.PI / 180));
      return;
    }
    if (d.button === 0 && d.moved && !d.touch) this.m.hud?.showBox(d.sx, d.sy, d.x, d.y);
  }

  up(e) {
    if (e.pointerType === 'touch') {
      this.touches.delete(e.pointerId);
      if (this.touches.size < 2) this.pinch = null;
    }
    const d = this.drag; this.drag = null;
    if (!d) return;
    this.m.hud?.hideBox();
    if (e.target !== this.canvas && !d.moved) return;
    const p = this.m.R.pick(e.clientX, e.clientY);
    if (d.button === 2 && !d.moved) { if (p) this.m.rightClick(p.x, p.z); return; }
    if (d.button !== 0) return;
    if (d.moved && !d.touch) { this.m.boxSelect(d.sx, d.sy, d.x, d.y, d.shift); return; }
    if (d.moved) return;
    if (p) this.m.leftClick(p.x, p.z, e.shiftKey, e.clientX, e.clientY);
  }
}

// OWNER: agent Kinh tế & HUD.
// Roster modal (phím B, GDD §16 F-181): every weapon/vehicle owned, grouped by formation slot — count, tier, HP,
// ammo, current intent (Vietnamese). Click a row to select + focus that group. Registers match.hotkeys.b.
import { unitDef, activeAccessories } from '../data/units.js';
import { openModal, closeModal, modalOwner, unitIcon, esc, intentLabel, hpColor } from './hud.js';

class Roster {
  constructor(match) {
    this.m = match; this.g = match.game;
    match.hotkeys.b = () => this.toggle();
    this.timer = setInterval(() => { if (!match.running) clearInterval(this.timer); else if (this.isOpen()) this.render(); }, 500);
  }
  isOpen() { return modalOwner() === 'roster'; }
  toggle() { if (this.isOpen()) closeModal(); else this.open(); }
  open() {
    this.root = document.createElement('div');
    this.root.className = 'roster';
    openModal('roster', this.root, { wide: true });
    this.render();
  }

  groups() {
    const g = this.g, my = this.m.side, S = g.sides[my];
    const map = new Map();
    for (const u of g.units.values()) {
      if (!u.alive || u.originalSide !== my) continue;
      let gr = map.get(u.group);
      if (!gr) map.set(u.group, gr = { slot: u.group, units: [] });
      gr.units.push(u);
    }
    // Undeployed slots are listed too.
    S.formation.forEach((slot, i) => { if (!slot.deployed && !map.has(i)) map.set(i, { slot: i, units: [], pending: slot }); });
    return [...map.values()].sort((a, b) => a.slot - b.slot);
  }

  render() {
    const body = this.root.querySelector('.shop-body');
    const scroll = body ? body.scrollTop : 0;
    const S = this.g.sides[this.m.side];
    const gs = this.groups();
    let total = 0;
    const rows = gs.map(gr => {
      if (gr.pending) {
        const def = unitDef(gr.pending.unit);
        return `<tr class="pending"><td><span class="slotno">${gr.slot + 1}</span></td><td><img class="ticon" src="${unitIcon(def.id)}" onerror="this.style.visibility='hidden'"></td>
          <td><b>${esc(def.name)}</b></td><td>${gr.pending.count || 1}</td><td>T${gr.pending.tier || 1}</td><td class="small">${accText(def, gr.pending.tier || 1)}</td><td>—</td><td>—</td><td class="muted">Chưa triển khai</td></tr>`;
      }
      // Sub-group by unit type (a slot normally has one type; hacked/borrowed units may differ).
      const byType = new Map();
      for (const u of gr.units) { if (!byType.has(u.def.id)) byType.set(u.def.id, []); byType.get(u.def.id).push(u); }
      return [...byType].map(([id, us]) => {
        const def = unitDef(id);
        total += us.length;
        const hp = us.reduce((a, u) => a + u.hp, 0), max = us.reduce((a, u) => a + u.maxHp, 0), f = max ? hp / max : 0;
        const finite = us.filter(u => u.maxAmmo !== Infinity);
        const ammo = finite.length ? `${finite.reduce((a, u) => a + Math.max(0, Math.floor(u.ammo)), 0)} / ${finite.reduce((a, u) => a + u.maxAmmo, 0)}` : '∞';
        const intents = new Map();
        for (const u of us) {
          const it = u.hacked > 0 ? 'hacked' : u.jammed > 0 && u.def.remote ? 'jammed' : u.carriedBy ? 'carried' : u.intent;
          intents.set(it, (intents.get(it) || 0) + 1);
        }
        const extra = def.id === 'infantry' ? ` <span class="muted small">(${us.reduce((a, u) => a + u.soldiers, 0)} lính)</span>`
          : def.swarmCount ? ` <span class="muted small">(${us.reduce((a, u) => a + u.swarm, 0)} drone)</span>` : '';
        const tiers = [...new Set(us.map(u => u.tier))].map(t => 'T' + t).join('/');
        const lost = us.some(u => u.side !== this.m.side);
        return `<tr class="click" data-slot="${gr.slot}">
          <td><span class="slotno">${gr.slot + 1}</span></td>
          <td><img class="ticon" src="${unitIcon(id)}" onerror="this.style.visibility='hidden'"></td>
          <td><b>${esc(def.name)}</b>${extra}${lost ? ' <span class="bad small">bị hack</span>' : ''}</td>
          <td>${us.length}</td>
          <td class="amber">${tiers}</td>
          <td class="small">${accText(def, Math.max(...us.map(u => u.tier || 1)))}</td>
          <td><div class="hpbar"><i style="width:${Math.round(f * 100)}%;background:${hpColor(f)}"></i></div><span class="small muted">${Math.round(f * 100)}%</span></td>
          <td>${ammo}</td>
          <td>${[...intents].map(([k, n]) => `<span class="intent">${esc(intentLabel(k))}${n > 1 ? ' ×' + n : ''}</span>`).join(' ')}</td>
        </tr>`;
      }).join('');
    }).join('');
    this.root.innerHTML = `
      <div class="shop-head">
        <div class="shop-title">📋 Khí tài hiện có <span class="kbd">B</span></div>
        <div class="shop-stats"><span>Đơn vị <b>${total}</b></span><span>🪖 Tham chiến / dự bị <b>${S.troops.active} / ${S.troops.reserve}</b></span><span>CP đội hình <b>${S.fcp ? `${S.fcp.used}/${S.fcp.limit}` : '-'}</b></span></div>
        <button class="shop-close" title="Đóng (Esc)">✕</button>
      </div>
      <div class="shop-body">
        <table class="etable roster-table"><thead><tr><th>Ô</th><th></th><th>Khí tài</th><th>SL</th><th>Tier</th><th>Phụ kiện</th><th>HP</th><th>Đạn</th><th>Đang làm</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="9" class="muted">Không còn khí tài nào</td></tr>'}</tbody></table>
        <p class="muted small">Click một dòng để chọn cả nhóm và đưa camera tới đó (phím 1–9 cũng chọn nhóm).</p>
      </div>`;
    this.root.querySelector('.shop-close').onclick = () => closeModal();
    this.root.querySelectorAll('tr.click').forEach(tr => tr.onclick = () => {
      const slot = Number(tr.dataset.slot);
      this.m.selectGroup(slot);
      this.m.focusSelection();
      closeModal();
    });
    const nb = this.root.querySelector('.shop-body');
    if (nb) nb.scrollTop = scroll;
  }
}

// Active T2/T3 accessories (F-81), hover for the effect.
function accText(def, tier) {
  const a = activeAccessories(def, tier);
  return a.length ? a.map(x => `<span class="ok" title="${esc(x.desc)}">${esc(x.name)}</span>`).join(', ') : '<span class="muted">—</span>';
}

export function install(match) { match.roster = new Roster(match); }

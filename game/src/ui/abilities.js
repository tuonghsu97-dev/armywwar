// OWNER: agent Chỉ huy & kỹ năng.
// In-match ability buttons rendered into #hud-side: commander card (portrait, passive tooltip), ultimate
// (lệnh tối thượng, CP cost + cooldown sweep, hotkey R), hypersonic strike (price + cooldown + confirm, hotkey T,
// human-in-the-loop F-70), unit active skills for the current selection.
// install(match) once per match; update(match, dt) every frame. Map targeting goes through
// match.pendingAbility = (x,z)=>{...}; while aiming an HTML ring follows the mouse (#ab-aim) and the event
// 'ability:aim' {kind, r} / null is emitted so the FX agent can draw a 3D ring.
import { COMMANDERS } from '../data/commanders.js';
import { HYPERSONIC, formatUSD } from '../data/units.js';
import { SKILLS } from '../sim/skills.js';
import { ULTIMATES, REINFORCE } from '../sim/commanders.js';
import { TRANSPORT, WEAPON_CARRIERS, troopCapacity } from '../sim/transport.js';

const FORMATION_BTNS = [['line', 'Hàng ngang'], ['wedge', 'Mũi chêm'], ['column', 'Hàng dọc']];

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function install(match) {
  const root = $('hud-side');
  if (!root) return;
  const g = match.game, side = g.sides[match.side];
  const cid = COMMANDERS[side.commander] ? side.commander : 'steel', c = COMMANDERS[cid];
  const ultR = ULTIMATES[c.ultimate.id]?.r || 10;
  const st = match._abilities = { t: 1, aim: null, confirm: null, skillKey: '' };
  const tip = `${c.passive.name}: ${c.passive.desc}\nThưởng tier: ${c.tierBonus.desc}\nThế mạnh: ${c.strengths}\nĐiểm yếu: ${c.weaknesses}`;
  root.innerHTML = `
    <div class="ab-card panel">
      <div class="ab-head" title="${esc(tip)}">
        <img class="ab-portrait" src="assets/img/commanders/${cid}.png" alt="">
        <div class="ab-name"><b>${esc(c.name)}</b><span class="muted">${esc(c.doctrine)}</span></div>
      </div>
      <div class="ab-passive" title="${esc(c.passive.desc)}">◈ ${esc(c.passive.name)} <span class="muted">(thụ động)</span></div>
      <button id="ab-ult" class="ab-btn" style="--ab-col:${c.color}" title="${esc(c.ultimate.desc)}">
        <i class="ab-sweep"></i><span class="ab-label">${esc(c.ultimate.name)}</span>
        <span class="ab-sub"><span class="ab-cost">${c.ultimate.cost} CP</span><span class="ab-cd"></span></span><span class="kbd">R</span>
      </button>
      <button id="ab-hyper" class="ab-btn ab-hyper" title="${esc(HYPERSONIC.name)}: đòn kết liễu xuyên phòng không, hồi ${HYPERSONIC.cooldown} giây. Chỉ chỉ huy mới được kích hoạt.">
        <i class="ab-sweep"></i><span class="ab-label">Tên lửa siêu thanh</span>
        <span class="ab-sub"><span class="ab-cost">${formatUSD(HYPERSONIC.price)} USDT</span><span class="ab-cd"></span></span><span class="kbd">T</span>
      </button>
      <button id="ab-reinf" class="ab-btn" title="Gọi viện (F-07): ${REINFORCE.squads} tiểu đội bộ binh + 1 xe bọc thép xuất hiện ở thành chỉ huy. Tốn ${REINFORCE.cost} điểm chỉ huy, hồi ${REINFORCE.cooldown} giây.">
        <i class="ab-sweep"></i><span class="ab-label">Gọi viện</span>
        <span class="ab-sub"><span class="ab-cost">${REINFORCE.cost} CP</span><span class="ab-cd"></span></span><span class="kbd">V</span>
      </button>
      <div id="ab-confirm" class="ab-confirm hidden"></div>
      <div id="ab-skills" class="ab-skills"></div>
    </div>`;
  const img = root.querySelector('.ab-portrait');
  img.onerror = () => {
    const d = document.createElement('div');
    d.className = 'ab-portrait ab-fallback'; d.style.background = c.color; d.textContent = c.name.split(' ').map(w => w[0]).slice(-2).join('');
    img.replaceWith(d);
  };

  const toast = t => match.hud?.toast(t);
  const aim = (kind, r, fn, hint) => {
    match.cancel?.();
    st.aim = { kind, r };
    match.pendingAbility = (x, z) => { endAim(match); fn(x, z); };
    g.events.emit('ability:aim', { kind, r });
    if (hint) toast(hint);
  };

  const ult = () => {
    if (g.phase !== 'battle') return toast('Chờ hết giai đoạn triển khai');
    if (side.ultimateCd > 0) return toast(`${c.ultimate.name} đang hồi chiêu (${Math.ceil(side.ultimateCd)} giây)`);
    if (side.cp < c.ultimate.cost) return toast(`Không đủ điểm chỉ huy (cần ${c.ultimate.cost}, đang có ${Math.floor(side.cp)})`);
    aim('ultimate', ultR, (x, z) => match.issue({ type: 'ultimate', x, z }), `Chọn điểm trên bản đồ cho ${c.ultimate.name} (chuột phải / Esc để hủy)`);
  };
  const hyper = () => {
    if (g.phase !== 'battle') return toast('Chờ hết giai đoạn triển khai');
    if (side.hypersonicCd > 0) return toast(`Tên lửa siêu thanh đang hồi (${Math.ceil(side.hypersonicCd)} giây)`);
    if (side.money < HYPERSONIC.price) return toast('Không đủ tiền mua tên lửa siêu thanh');
    aim('hypersonic', HYPERSONIC.splash, (x, z) => showConfirm(match, x, z), 'Chọn mục tiêu cho tên lửa siêu thanh');
  };
  const reinf = () => {
    if (g.phase !== 'battle') return toast('Chờ hết giai đoạn triển khai');
    match.issue({ type: 'reinforce' });
  };
  $('ab-ult').onclick = ult;
  $('ab-hyper').onclick = hyper;
  $('ab-reinf').onclick = reinf;
  if (!match.hotkeys.v) match.hotkeys.v = reinf;
  match.hotkeys.r = ult;
  match.hotkeys.t = hyper;
  st.aimSkill = (id, ids) => {
    const s = SKILLS[id];
    if (s.target === 'point') aim('skill', id === 'carpet' ? 12 : 5, (x, z) => match.issue({ type: 'skill', unitIds: ids, x, z }), `Chọn điểm cho kỹ năng ${s.name}`);
    else match.issue({ type: 'skill', unitIds: ids });
  };

  document.getElementById('ab-aim')?.remove();
  const ring = document.createElement('div');
  ring.id = 'ab-aim'; ring.className = 'ab-aim hidden';
  ($('hud') || document.body).appendChild(ring);
  st.ring = ring;
  // Mobile: visible "Hủy" button while an order / deploy / ability target is pending (no right-click / Esc on touch).
  document.getElementById('ab-cancel')?.remove();
  const cancel = document.createElement('button');
  cancel.id = 'ab-cancel'; cancel.className = 'ab-cancel hidden'; cancel.textContent = '✕ Hủy';
  cancel.title = 'Hủy lệnh đang chọn (chuột phải / Esc)';
  cancel.onclick = e => { e.stopPropagation(); match.cancel?.(); endAim(match); cancel.classList.add('hidden'); };
  ($('hud') || document.body).appendChild(cancel);
  st.cancel = cancel;
  st.off = [g.events.on('selection', () => { st.skillKey = ''; renderSkills(match); }), g.events.on('end', () => endAim(match))];
  renderSkills(match);
}

function endAim(match) {
  const st = match._abilities;
  if (!st || !st.aim) return;
  st.aim = null;
  st.ring?.classList.add('hidden');
  match.game.events.emit('ability:aim', null);
}

function showConfirm(match, x, z) {
  const box = $('ab-confirm');
  if (!box) return;
  box.classList.remove('hidden');
  box.innerHTML = `<div>Phóng tên lửa siêu thanh (<b class="amber">${formatUSD(HYPERSONIC.price)} USDT</b>) vào điểm đã chọn?</div>
    <div class="ab-row"><button class="primary" id="ab-go">Phóng</button><button id="ab-no">Hủy</button></div>`;
  const close = () => { box.classList.add('hidden'); box.innerHTML = ''; };
  $('ab-go').onclick = () => { match.issue({ type: 'hypersonic', x, z }); close(); };
  $('ab-no').onclick = close;
}

function selectedBySkill(match) {
  const map = new Map();
  for (const id of match.selected) {
    const u = match.game.units.get(id);
    if (!u || !u.alive || u.side !== match.side || !u.def.active || !SKILLS[u.def.active]) continue;
    if (!map.has(u.def.active)) map.set(u.def.active, []);
    map.get(u.def.active).push(u);
  }
  return map;
}

function renderSkills(match) {
  const box = $('ab-skills');
  if (!box) return;
  const st = match._abilities, groups = selectedBySkill(match);
  const own = [...match.selected].map(i => match.game.units.get(i)).filter(u => u && u.alive && u.side === match.side);
  const carriers = own.filter(u => WEAPON_CARRIERS.has(u.def.id));
  const key = [...groups].map(([k, us]) => k + us.length).join(',') + '|' + own.length + '|' + carriers.map(u => u.extraWeapons || 0).join('');
  if (key === st.skillKey) return;
  st.skillKey = key;
  box.innerHTML = groups.size ? '<div class="ab-title muted">Kỹ năng đơn vị đã chọn</div>' : '';
  if (own.length) {
    // Group helpers: formation (F-143, uses the sim 'formation' command) and extra weapons for transports (F-164).
    const row = document.createElement('div');
    row.className = 'ab-row ab-formation';
    row.innerHTML = '<span class="muted small">Đội hình:</span>' + FORMATION_BTNS.map(([f, l]) => `<button class="small" data-formation="${f}" title="Nhóm đã chọn di chuyển theo ${l.toLowerCase()}">${l}</button>`).join('');
    row.querySelectorAll('[data-formation]').forEach(b => b.onclick = () => {
      match.issue({ type: 'formation', unitIds: own.map(u => u.id), formation: b.dataset.formation });
      match.hud?.toast(`Đội hình: ${b.textContent}`);
    });
    box.appendChild(row);
  }
  if (carriers.length) {
    const n = carriers[0].extraWeapons || 0, next = (n + 1) % (TRANSPORT.maxWeapons + 1);
    const b = document.createElement('button');
    b.className = 'ab-btn ab-weapons';
    b.title = `Mỗi vũ khí chở thêm: −${TRANSPORT.weaponWeight} chỗ lính, tiểu đội thả xuống +${Math.round(TRANSPORT.weaponDmg * 100)}% sát thương (tối đa ${TRANSPORT.maxWeapons}).`;
    b.innerHTML = `<span class="ab-label">Chở thêm vũ khí: ${n}/${TRANSPORT.maxWeapons}</span><span class="ab-sub">${troopCapacity(carriers[0])} lính · bấm → ${next}</span>`;
    b.onclick = () => match.issue({ type: 'loadWeapons', unitIds: carriers.map(u => u.id), n: next });
    box.appendChild(b);
  }
  for (const [id, us] of groups) {
    const s = SKILLS[id];
    const b = document.createElement('button');
    b.className = 'ab-btn ab-skill'; b.dataset.skill = id;
    b.title = `${s.desc}${s.manualOnly ? '' : '\nAI tự dùng khi đúng thời điểm; bấm để dùng ngay.'}`;
    b.innerHTML = `<i class="ab-sweep"></i><span class="ab-label">${esc(s.name)}</span><span class="ab-sub"><span class="ab-n"></span><span class="ab-cd"></span></span>`;
    b.onclick = () => {
      const ready = [...match.selected].map(i => match.game.units.get(i)).filter(u => u && u.alive && u.def.active === id && !(u.skillCd > 0));
      if (!ready.length) return match.hud?.toast(`${s.name} đang hồi chiêu`);
      st.aimSkill(id, ready.map(u => u.id));
    };
    box.appendChild(b);
  }
}

function setSweep(btn, frac, cdText, disabled) {
  if (!btn) return;
  btn.style.setProperty('--cd', Math.max(0, Math.min(1, frac)).toFixed(3));
  btn.classList.toggle('ab-off', !!disabled);
  const cd = btn.querySelector('.ab-cd'); if (cd) cd.textContent = cdText;
}

export function update(match, dt) {
  const st = match._abilities;
  if (!st) return;
  const g = match.game, side = g.sides[match.side];
  // Aim ring follows the mouse with the projected radius.
  if (st.aim && !match.pendingAbility) endAim(match);
  if (st.aim && match.input?.mouse) {
    const m = match.input.mouse, p = match.R.pick(m.x, m.y);
    if (p) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2, s = match.R.toScreen(p.x + Math.cos(a) * st.aim.r, 0, p.z + Math.sin(a) * st.aim.r);
        x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y);
      }
      Object.assign(st.ring.style, { left: x0 + 'px', top: y0 + 'px', width: (x1 - x0) + 'px', height: (y1 - y0) + 'px' });
      st.ring.className = 'ab-aim ab-aim-' + st.aim.kind;
    }
  }
  st.t += dt;
  if (st.t < 0.1) return;
  st.t = 0;
  const battle = g.phase === 'battle';
  const U = side.ultimate || {};
  const cdMax = side.ultimateCdMax || U.cooldown || 1;
  setSweep($('ab-ult'), side.ultimateCd / cdMax, side.ultimateCd > 0 ? `${Math.ceil(side.ultimateCd)}s` : '', !battle || side.ultimateCd > 0 || side.cp < (U.cost || 0));
  const hb = $('ab-hyper');
  setSweep(hb, side.hypersonicCd / (side.hypersonicCdMax || HYPERSONIC.cooldown), side.hypersonicCd > 0 ? `${Math.ceil(side.hypersonicCd)}s` : '', !battle || side.hypersonicCd > 0 || side.money < HYPERSONIC.price);
  const rcd = Math.max(0, (side.reinforceCd || 0) - g.time);
  setSweep($('ab-reinf'), rcd / REINFORCE.cooldown, rcd > 0 ? `${Math.ceil(rcd)}s` : '', !battle || rcd > 0 || side.cp < REINFORCE.cost);
  st.cancel?.classList.toggle('hidden', !(match.pendingOrder || match.pendingDeploy != null || match.pendingAbility));
  renderSkills(match);
  for (const b of document.querySelectorAll('#ab-skills .ab-skill')) {
    const id = b.dataset.skill;
    const us = [...match.selected].map(i => g.units.get(i)).filter(u => u && u.alive && u.def.active === id);
    if (!us.length) continue;
    const ready = us.filter(u => !(u.skillCd > 0)).length;
    const minCd = Math.min(...us.map(u => Math.max(0, u.skillCd || 0)));
    const full = SKILLS[id].cd * (us[0].cooldownMult || 1);
    setSweep(b, ready ? 0 : minCd / full, ready ? '' : `${Math.ceil(minCd)}s`, !battle || !ready);
    b.querySelector('.ab-n').textContent = `${ready}/${us.length} sẵn sàng`;
  }
}

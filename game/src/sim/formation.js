// OWNER: agent AI chiến thuật
// Group (tactical) layer helpers, GDD §5 tier 2: squads = units sharing one order; roles
// vanguard / support / scout; formations line / wedge / column with spacing kept while moving.

export const FORMATIONS = ['line', 'wedge', 'column'];

// Unit behaviour category (one behaviour tree per category).
export function categoryOf(u) {
  const id = u.def.id;
  switch (id) {
    case 'spg': case 'himars': return 'artillery';
    case 'infantry': case 'at_team': return 'infantry';
    case 'fighter_stealth': case 'fighter_multi': case 'bomber': return 'fighter';
    case 'cca': return 'cca';
    case 'heli_attack': return 'heli';
    case 'heli_transport': case 'supply_truck': return 'transport';
    case 'apc': return 'transport';
    case 'drone_recon': case 'drone_male': return 'recon';
    case 'drone_kamikaze': case 'swarm_fpv': return 'kamikaze';
    case 'destroyer': case 'stealth_ship': case 'carrier': return 'ship';
    case 'submarine': return 'sub';
    case 'uuv': return 'uuv';
    case 'sam': case 'iron_dome': case 'laser': return 'aa';
    case 'ew': return 'ew';
    default: return u.def.group === 'tank' ? 'tank' : u.def.group;
  }
}

// Role inside a squad.
export function roleOf(u) {
  const c = categoryOf(u);
  if (c === 'tank' && u.def.id !== 'ugv') return 'vanguard';
  if (c === 'infantry' && u.def.id === 'infantry') return 'vanguard';
  if (c === 'recon' || u.def.id === 'ugv') return 'scout';
  if (c === 'transport') return 'support';
  if (c === 'artillery' || c === 'aa' || c === 'ew' || u.def.id === 'at_team') return 'support';
  if (c === 'ship' || c === 'sub') return 'vanguard';
  return 'vanguard';
}

export function defaultFormation(orderType) {
  switch (orderType) {
    case 'attack': case 'focus': case 'sead': return 'wedge';
    case 'defend': case 'suppress': case 'capture': return 'line';
    default: return 'column';
  }
}

// Local slot offsets: f = forward (along dir), l = lateral. Index 0 is the lead slot.
export function slotOffset(type, i, n, spacing) {
  if (type === 'line') return { f: 0, l: (i - (n - 1) / 2) * spacing };
  if (type === 'column') return { f: -i * spacing, l: 0 };
  // wedge
  if (i === 0) return { f: 0, l: 0 };
  const k = Math.ceil(i / 2), s = i % 2 ? -1 : 1;
  return { f: -k * spacing * 0.8, l: s * k * spacing };
}

// Assign formation offsets to a squad. dir = unit vector toward the goal.
// Vanguard in front, support behind (mutual cover), scouts ahead.
export function layoutSquad(sq) {
  const type = sq.formation;
  const groups = { vanguard: [], support: [], scout: [] };
  for (const u of sq.units) groups[roleOf(u)].push(u);
  if (!groups.vanguard.length && groups.support.length) { groups.vanguard = groups.support; groups.support = []; }
  const spacingOf = arr => Math.max(3.5, ...arr.map(u => (u.def.size || 1) * 1.3));
  const place = (arr, fBase, lane) => {
    const sp = spacingOf(arr);
    arr.sort((a, b) => a.id - b.id);
    arr.forEach((u, i) => {
      const o = slotOffset(lane, i, arr.length, sp);
      u.slot = { f: o.f + fBase, l: o.l };
    });
    return arr.length && lane === 'column' ? -(arr.length - 1) * sp : arr.length ? -Math.ceil((arr.length - 1) / 2) * sp * 0.8 : 0;
  };
  const vEnd = place(groups.vanguard, 0, type);
  place(groups.support, Math.min(-8, vEnd - 8), type === 'column' ? 'column' : 'line');
  place(groups.scout, 10, 'line');
  sq.roles = groups;
}

// World position of a unit's slot around anchor (ax,az) facing dir.
export function slotWorld(u, ax, az, dir) {
  const s = u.slot || { f: 0, l: 0 };
  return { x: ax + dir.x * s.f - dir.z * s.l, z: az + dir.z * s.f + dir.x * s.l };
}

// Speed modulation that keeps spacing while moving: units ahead of their slot (relative to the
// vanguard's centroid) slow down; support never overtakes the vanguard.
export function formationSpeed(u, sq) {
  if (!sq || sq.units.length < 2 || !sq.moving) return 1;
  const dir = sq.dir, s = u.slot || { f: 0, l: 0 };
  const proj = (u.x - sq.vcx) * dir.x + (u.z - sq.vcz) * dir.z; // along-track relative to vanguard centre
  const ahead = proj - s.f;
  if (roleOf(u) === 'support' && proj > -4) return 0.35;
  if (ahead > 10) return 0.45;
  if (ahead > 5) return 0.7;
  return 1;
}

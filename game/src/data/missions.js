// OWNER: agent Meta & chế độ chơi
// Daily missions (F-112), cosmetic skins + battle pass (F-113, cosmetic only — never affects stats).

// type: 'capture' (strongpoints captured), 'win', 'play', 'kills', 'structures', 'order' (orders of a type issued).
// Optional filters: commander, map, mode.
export const MISSIONS = [
  { id: 'cap5', text: 'Chiếm 5 cứ điểm', type: 'capture', target: 5, reward: { gold: 250 } },
  { id: 'cap10', text: 'Chiếm 10 cứ điểm', type: 'capture', target: 10, reward: { gold: 450, badges: 1 } },
  { id: 'win1', text: 'Thắng 1 trận', type: 'win', target: 1, reward: { gold: 200 } },
  { id: 'win2', text: 'Thắng 2 trận', type: 'win', target: 2, reward: { gold: 400 } },
  { id: 'win_swarm', text: 'Thắng 1 trận với chỉ huy Drone', type: 'win', commander: 'swarm', target: 1, reward: { gold: 300, badges: 1 } },
  { id: 'win_steel', text: 'Thắng 1 trận với Đại tướng Thép', type: 'win', commander: 'steel', target: 1, reward: { gold: 300 } },
  { id: 'win_air', text: 'Thắng 1 trận với Tư lệnh Không quân', type: 'win', commander: 'air', target: 1, reward: { gold: 300 } },
  { id: 'win_ew', text: 'Thắng 1 trận với chỉ huy Tác chiến Điện tử', type: 'win', commander: 'ew', target: 1, reward: { gold: 300, badges: 1 } },
  { id: 'win_city', text: 'Thắng 1 trận trên bản đồ Thành phố', type: 'win', map: 'city', target: 1, reward: { gold: 300 } },
  { id: 'kill20', text: 'Hạ 20 đơn vị địch', type: 'kills', target: 20, reward: { gold: 250 } },
  { id: 'struct3', text: 'Phá 3 công trình địch', type: 'structures', target: 3, reward: { gold: 300 } },
  { id: 'play3', text: 'Chơi 3 trận', type: 'play', target: 3, reward: { gold: 150 } },
  { id: 'flank3', text: 'Ra lệnh Vòng đánh họng 3 lần', type: 'order', order: 'flank', target: 3, reward: { gold: 150 } },
  { id: 'sead2', text: 'Ra lệnh SEAD 2 lần', type: 'order', order: 'sead', target: 2, reward: { gold: 150 } },
  { id: 'boss1', text: 'Đánh 1 trận ải boss', type: 'play', mode: 'boss', target: 1, reward: { gold: 250, rare: 1 } },
  { id: 'ghost1', text: 'Đánh 1 trận Đấu data', type: 'play', mode: 'ghost', target: 1, reward: { gold: 250 } },
];
export const DAILY_COUNT = 3;

// How much a finished match advances a mission. summary: see core/profile.js summarizeMatch().
export function missionIncrement(m, s) {
  if (m.commander && s.commander !== m.commander) return 0;
  if (m.map && s.mapId !== m.map) return 0;
  if (m.mode && s.mode !== m.mode) return 0;
  if (s.mode === 'tutorial') return 0;
  switch (m.type) {
    case 'capture': return s.captures || 0;
    case 'win': return s.won ? 1 : 0;
    case 'play': return 1;
    case 'kills': return s.kills || 0;
    case 'structures': return s.structures || 0;
    case 'order': return (s.orders && s.orders[m.order]) || 0;
    default: return 0;
  }
}

// Skins only tint the team colour (F-113: no power). Bought with badges ("Huy hiệu chỉ huy").
export const SKINS = [
  { id: 'default', name: 'Tiêu chuẩn', color: '#3f8cff', cost: 0 },
  { id: 'jungle', name: 'Rằn ri rừng', color: '#5f8f3a', cost: 3 },
  { id: 'desert', name: 'Sa mạc', color: '#c9a35a', cost: 3 },
  { id: 'arctic', name: 'Bắc Cực', color: '#dfe9f3', cost: 5 },
  { id: 'night', name: 'Màn đêm', color: '#3b3f8c', cost: 6 },
  { id: 'gold', name: 'Hoàng kim', color: '#ffc24d', cost: 12 },
];

// Battle pass (simulated): 10 levels, XP from matches. Free track gives gold/badges, premium track
// (unlocked with badges) gives cosmetics only.
export const PASS_XP_PER_LEVEL = 300;
export const PASS_PREMIUM_COST = 10;
export const PASS_LEVELS = [
  { free: { gold: 100 }, premium: { title: 'Huy hiệu khung đồng' } },
  { free: { badges: 1 }, premium: { skin: 'jungle' } },
  { free: { gold: 150 }, premium: { title: 'Hiệu ứng khói xanh' } },
  { free: { badges: 1 }, premium: { skin: 'desert' } },
  { free: { gold: 200 }, premium: { title: 'Khung bạc' } },
  { free: { badges: 1 }, premium: { skin: 'arctic' } },
  { free: { gold: 250 }, premium: { title: 'Hiệu ứng tia lửa' } },
  { free: { badges: 2 }, premium: { skin: 'night' } },
  { free: { gold: 300 }, premium: { title: 'Khung vàng' } },
  { free: { badges: 3 }, premium: { skin: 'gold' } },
];

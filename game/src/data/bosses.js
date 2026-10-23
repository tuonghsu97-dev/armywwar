// OWNER: agent Meta & chế độ chơi
// Boss campaign (GDD §8, F-100/F-101/F-111): 4 chapters, each with one big boss and its own mechanic.
// kind 'unit'  -> boss is a Unit of side 1 (unit id + overridden HP).
// kind 'structure' -> boss is an armed structure added to game.structures (type = structure).
// escort = side-1 formation deployed at start (1 slot = 1 weapon, F-52); waves = reinforcement groups spawned in phase 2 ("gọi viện").

export const BOSS_PHASES = {
  1: { name: 'Phòng thủ', desc: 'Boss giữ vị trí, bật lá chắn giảm sát thương' },
  2: { name: 'Gọi viện', desc: 'Boss gọi các đợt viện binh tấn công' },
  3: { name: 'Ép gặp', desc: 'Toàn bộ lực lượng boss dồn đánh thành chỉ huy của bạn' },
};

export const BOSSES = {
  carrier: {
    id: 'carrier', chapter: 1, name: 'Tàu sân bay di động', img: 'carrier',
    map: 'bay', commander: 'navy', kind: 'unit', unit: 'carrier', hp: 16000, x: 208, z: 75,
    shield: 0.5,
    mechanic: 'Tàu sân bay khổng lồ liên tục phóng tiêm kích. Hạ nó trước khi bầu trời kín máy bay địch.',
    tip: 'Mang phòng không (Vòm Sắt, SAM) và tàu ngầm hoặc trực thăng diệt hạm.',
    launch: { unit: 'fighter_multi', every: [0, 26, 18, 11], max: 4 },
    escort: [
      { unit: 'destroyer', tier: 1, count: 1 },
      { unit: 'heli_attack', tier: 1, count: 1 },
      { unit: 'tank_heavy', tier: 1, count: 1 },
      { unit: 'tank_heavy', tier: 1, count: 1 },
      { unit: 'apc', tier: 1, count: 1 },
    ],
    waves: [['heli_attack', 'drone_kamikaze', 'drone_kamikaze'], ['fighter_multi', 'cca'], ['heli_attack', 'heli_attack']],
    waveEvery: 28, maxWaves: 5,
    rewards: { gold: 800, rare: 2, badges: 2 },
  },
  aa_fortress: {
    id: 'aa_fortress', chapter: 2, name: 'Thành đài phòng không', img: 'aa_fortress',
    map: 'plains', commander: 'ew', kind: 'structure', structure: 'boss_fortress', hp: 30000, armor: 0.5, x: 202, z: 75,
    shield: 0.5,
    armed: { dmg: 80, range: 36, rof: 0.8, hits: ['air', 'low', 'ground'] },
    airPenalty: 0.4,
    mechanic: 'Pháo đài được bao quanh bởi hàng loạt SAM. Máy bay của bạn chịu thêm 40% sát thương khi pháo đài còn đứng.',
    tip: 'Dùng xe tăng, pháo tự hành và lệnh SEAD để làm câm SAM trước khi đưa máy bay vào.',
    sams: [[192, 60], [192, 90], [212, 56], [212, 94]],
    escort: [
      { unit: 'tank_heavy', tier: 1, count: 1 },
      { unit: 'tank_heavy', tier: 1, count: 1 },
      { unit: 'spg', tier: 1, count: 1 },
      { unit: 'at_team', tier: 1, count: 1 },
      { unit: 'at_team', tier: 1, count: 1 },
      { unit: 'ew', tier: 1, count: 1 },
    ],
    waves: [['sam', 'apc'], ['tank_heavy', 'tank_heavy', 'at_team'], ['laser', 'iron_dome']],
    waveEvery: 30, maxWaves: 5,
    rewards: { gold: 1000, rare: 3, badges: 2 },
  },
  strategic_sub: {
    id: 'strategic_sub', chapter: 3, name: 'Tàu ngầm chiến lược', img: 'strategic_sub',
    map: 'bay', commander: 'navy', kind: 'unit', unit: 'submarine', hp: 14000, x: 190, z: 75,
    shield: 0.5,
    surface: { every: 22, duration: 7, salvo: 6, dmg: 200, range: 90 },
    mechanic: 'Ẩn sâu dưới nước (chỉ sonar thấy). Định kỳ nổi lên phóng loạt tên lửa — đó là lúc đánh trả.',
    tip: 'Mang khu trục / UUV có sonar, giữ phòng không để chặn loạt tên lửa.',
    escort: [
      { unit: 'submarine', tier: 1, count: 1 },
      { unit: 'uuv', tier: 1, count: 1 },
      { unit: 'heli_attack', tier: 1, count: 1 },
      { unit: 'tank_heavy', tier: 1, count: 1 },
    ],
    waves: [['uuv', 'heli_attack'], ['drone_kamikaze', 'drone_kamikaze', 'drone_kamikaze'], ['fighter_multi']],
    waveEvery: 30, maxWaves: 5,
    rewards: { gold: 1200, rare: 3, badges: 3 },
  },
  ai_city_core: {
    id: 'ai_city_core', chapter: 4, name: 'Thành phố AI', img: 'ai_city',
    map: 'city', commander: 'swarm', kind: 'structure', structure: 'boss_core', hp: 28000, armor: 0.45, x: 212, z: 75,
    shield: 0.5, rise: 12,
    armed: { dmg: 50, range: 30, rof: 1.0, hits: ['ground', 'low', 'air'] },
    drones: { every: 15, perPhase: [0, ['drone_kamikaze', 'drone_kamikaze'], ['drone_kamikaze', 'drone_kamikaze', 'drone_kamikaze'], ['swarm_fpv', 'drone_kamikaze']] },
    mechanic: 'Lõi AI trồi lên từ lòng đất giữa thành phố, liên tục sản xuất drone tự sát.',
    tip: 'EW và laser khắc chế drone; UGV và trực thăng mạnh trong phố hẹp.',
    escort: [
      { unit: 'swarm_fpv', tier: 1, count: 1 },
      { unit: 'ugv', tier: 1, count: 1 },
      { unit: 'ugv', tier: 1, count: 1 },
      { unit: 'drone_recon', tier: 1, count: 1 },
      { unit: 'ew', tier: 1, count: 1 },
      { unit: 'tank_heavy', tier: 1, count: 1 },
    ],
    waves: [['ugv', 'ugv', 'drone_kamikaze'], ['swarm_fpv'], ['heli_attack', 'drone_male']],
    waveEvery: 26, maxWaves: 6,
    rewards: { gold: 1500, rare: 4, badges: 4 },
  },
};

export const BOSS_ORDER = ['carrier', 'aa_fortress', 'strategic_sub', 'ai_city_core'];

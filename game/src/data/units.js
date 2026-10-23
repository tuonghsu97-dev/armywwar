// Unit catalog (GDD §4, §9, §15). Names are fictional; `ref` is the real-world class it is modelled on.
// World scale: 1 world unit ≈ 4 m. Map ~ 240 x 150 units.
// layer: 'air' (high), 'low' (helis, FPV), 'ground', 'sea' (surface), 'sub' (underwater). GDD §2 table.
// dmg: 'kinetic' | 'he' | 'fire' | 'emp' | 'laser'.  GDD §4 damage types.
// hits: which layers the main weapon can engage.
// detect: extra senses. 'radar' sees air, 'sonar' sees sub. Everyone sees ground/sea/low within sight.
// cp: command points per unit (GDD §9). price: USD per unit (GDD §15). rank: A/S/SR/UR.
// crew: soldiers drawn from the 2,000 troop pool to operate it (GDD §13 "Thua 3").

export const LAYERS = ['air', 'low', 'ground', 'sea', 'sub'];
export const LAYER_HEIGHT = { air: 14, low: 5, ground: 0, sea: 0, sub: -1.6 };

export const UNITS = {
  infantry: {
    name: 'Bộ binh', ref: 'Bộ binh tiêu chuẩn', group: 'infantry', role: 'Chiếm cứ điểm, vận hành vũ khí',
    skill: 'Cắm cờ chiếm cứ điểm', layer: 'ground', model: 'infantry', size: 0.7,
    hp: 60, armor: 0, dmg: 6, dmgType: 'kinetic', range: 7, rof: 1.0, speed: 2.2, sight: 14,
    hits: ['ground', 'low'], cp: 0, price: 0, rank: 'A', crew: 0, squad: 50,
  },
  at_team: {
    name: 'Tổ chống tăng Mũi Giáo', ref: 'Javelin', group: 'infantry', role: 'Diệt xe tăng',
    skill: 'Tên lửa bắn đỉnh (top-attack)', layer: 'ground', model: 'infantry', size: 0.7,
    hp: 80, armor: 0, dmg: 70, dmgType: 'he', range: 18, rof: 0.25, speed: 2.0, sight: 16,
    hits: ['ground', 'low'], cp: 1, price: 250_000, rank: 'S', crew: 4, squad: 4,
  },
  tank_heavy: {
    name: 'Thiết Hổ MBT', ref: 'M1A2 Abrams / Leopard 2A7 / K2 / T-14', group: 'tank', role: 'Tiền tuyến, chịu đòn',
    skill: 'Giáp phản ứng ERA + APS chặn đạn', layer: 'ground', model: 'tank_heavy', size: 3.2,
    hp: 780, armor: 0.5, dmg: 60, dmgType: 'kinetic', range: 16, rof: 0.5, speed: 3.2, sight: 18,
    hits: ['ground', 'sea'], cp: 3, price: 10_000_000, rank: 'S', crew: 4, active: 'aps',
  },
  spg: {
    name: 'Pháo tự hành Bão Lửa', ref: 'K9 / PzH 2000 / CV90', group: 'tank', role: 'Hỗ trợ, bắn tầm xa',
    skill: 'Bắn định hướng, dồn đạn nổ lòng chảo', layer: 'ground', model: 'spg', size: 3.2,
    hp: 450, armor: 0.3, dmg: 55, dmgType: 'he', range: 42, minRange: 8, rof: 0.3, speed: 2.8, sight: 14,
    hits: ['ground', 'sea'], splash: 4, needsSpotter: true, cp: 3, price: 5_000_000, rank: 'S', crew: 5, active: 'barrage',
  },
  himars: {
    name: 'Bệ phóng Sấm Sét HR', ref: 'HIMARS', group: 'tank', role: 'Pháo phản lực tầm xa',
    skill: 'Loạt rocket dẫn đường', layer: 'ground', model: 'himars', size: 3.0,
    hp: 320, armor: 0.15, dmg: 90, dmgType: 'he', range: 60, minRange: 12, rof: 0.12, speed: 3.4, sight: 12,
    hits: ['ground', 'sea'], splash: 5, needsSpotter: true, cp: 4, price: 5_500_000, rank: 'SR', crew: 3, active: 'barrage',
  },
  apc: {
    name: 'Xe bọc thép Bò Rừng 8x8', ref: 'Xe bọc thép chở quân 8x8', group: 'tank', role: 'Chở bộ binh, chở phòng không',
    skill: 'Chở 50 lính / kéo phòng không', layer: 'ground', model: 'apc', size: 3.0,
    hp: 420, armor: 0.35, dmg: 12, dmgType: 'kinetic', range: 11, rof: 1.2, speed: 4.2, sight: 14,
    hits: ['ground', 'low'], cp: 2, price: 3_000_000, rank: 'A', crew: 3, capacity: 50, transport: 'troops',
  },
  supply_truck: {
    name: 'Xe tải hậu cần Lạc Đà', ref: 'Xe tải quân sự', group: 'tank', role: 'Chở phòng không/tiếp đạn',
    skill: 'Chở hệ thống phòng không tới cứ điểm', layer: 'ground', model: 'supply_truck', size: 2.6,
    hp: 200, armor: 0.05, dmg: 0, dmgType: 'kinetic', range: 0, rof: 0, speed: 4.4, sight: 10,
    hits: [], cp: 1, price: 200_000, rank: 'A', crew: 2, capacity: 20, transport: 'troops',
  },
  ugv: {
    name: 'UGV Sói Sắt', ref: 'THeMIS / Milrem', group: 'tank', role: 'Dò đường, mồi nhử',
    skill: 'Rải mìn, che chắn', layer: 'ground', model: 'ugv', size: 1.6,
    hp: 220, armor: 0.2, dmg: 10, dmgType: 'kinetic', range: 10, rof: 1.5, speed: 4.0, sight: 16,
    hits: ['ground', 'low'], remote: true, cp: 1, price: 300_000, rank: 'A', crew: 0, active: 'mines',
  },
  drone_recon: {
    name: 'Diều Hâu TB', ref: 'Bayraktar TB2 / Mavic-class', group: 'drone', role: 'Trinh sát, mở sương',
    skill: 'Chỉ điểm mục tiêu cho toàn đội', layer: 'air', model: 'drone', size: 2.2,
    hp: 140, armor: 0, dmg: 25, dmgType: 'he', range: 14, rof: 0.25, speed: 6.5, sight: 34,
    hits: ['ground', 'sea'], remote: true, spotter: true, cp: 1, price: 5_000_000, rank: 'S', crew: 0, active: 'mark',
  },
  drone_male: {
    name: 'Thần Ưng MQ', ref: 'MQ-9B', group: 'drone', role: 'Trinh sát - tấn công tầm xa',
    skill: 'Tên lửa dẫn đường + chỉ điểm', layer: 'air', model: 'drone', size: 3.0,
    hp: 220, armor: 0, dmg: 60, dmgType: 'he', range: 20, rof: 0.2, speed: 6.0, sight: 38,
    hits: ['ground', 'sea'], remote: true, spotter: true, cp: 2, price: 30_000_000, rank: 'SR', crew: 0, active: 'mark',
  },
  drone_kamikaze: {
    name: 'Ong Bắp Cày LM', ref: 'Switchblade 600 / Lancet / Shahed', group: 'drone', role: 'Phá xe, đơn vị giá trị cao',
    skill: 'Lượn chờ mục tiêu, lạc hướng khi bị nhiễu', layer: 'low', model: 'drone_kamikaze', size: 1.0,
    hp: 40, armor: 0, dmg: 260, dmgType: 'he', range: 1.5, rof: 0, speed: 9.0, sight: 22,
    hits: ['ground', 'sea'], remote: true, kamikaze: true, cp: 1, price: 150_000, rank: 'S', crew: 0, active: 'loiter',
  },
  swarm_fpv: {
    name: 'Bầy Ong FPV', ref: 'FPV / chương trình swarm', group: 'drone', role: 'Bão hòa phòng không',
    skill: 'Tấn công đồng thời nhiều hướng', layer: 'low', model: 'fpv', size: 0.5,
    hp: 15, armor: 0, dmg: 45, dmgType: 'he', range: 1.2, rof: 0, speed: 10, sight: 14,
    hits: ['ground', 'sea', 'low'], remote: true, kamikaze: true, swarmCount: 24,
    cp: 1, price: 500, rank: 'A', crew: 0, active: 'swarm', priceNote: 'giá mỗi drone, 1 bầy = 1 ô',
  },
  fighter_stealth: {
    name: 'Bóng Ma F5', ref: 'F-35 / F-22 / Su-57 / J-20', group: 'air', role: 'Giành không phận, đánh sâu',
    skill: 'Tàng hình tạm thời, tên lửa tầm xa', layer: 'air', model: 'fighter_stealth', size: 4.0,
    hp: 380, armor: 0.1, dmg: 110, dmgType: 'he', range: 26, rof: 0.35, speed: 14, sight: 30,
    hits: ['air', 'low', 'ground', 'sea'], ammo: 6, cp: 4, price: 80_000_000, rank: 'SR', crew: 1, active: 'stealth',
  },
  fighter_multi: {
    name: 'Chim Cắt R', ref: 'Rafale', group: 'air', role: 'Đa nhiệm, không chiến',
    skill: 'Tên lửa không đối không', layer: 'air', model: 'fighter_multi', size: 4.0,
    hp: 420, armor: 0.1, dmg: 95, dmgType: 'he', range: 24, rof: 0.4, speed: 13, sight: 26,
    hits: ['air', 'low', 'ground', 'sea'], ammo: 8, cp: 4, price: 100_000_000, rank: 'S', crew: 1, active: 'afterburner',
  },
  heli_attack: {
    name: 'Kền Kền AH', ref: 'AH-64 Apache / Ka-52 / Mi-28', group: 'air', role: 'Diệt giáp, hỗ trợ gần',
    skill: 'Bay sát đất, tên lửa chống tăng', layer: 'low', model: 'heli_attack', size: 3.6,
    hp: 520, armor: 0.2, dmg: 75, dmgType: 'he', range: 18, rof: 0.5, speed: 7.5, sight: 20,
    hits: ['ground', 'sea', 'low'], ammo: 12, cp: 4, price: 35_000_000, rank: 'S', crew: 2, active: 'atgm',
  },
  heli_transport: {
    name: 'Ngựa Thồ UH', ref: 'Trực thăng vận tải', group: 'air', role: 'Chở bộ binh',
    skill: 'Đáp xuống thả quân chiếm cứ điểm', layer: 'low', model: 'heli_transport', size: 3.8,
    hp: 380, armor: 0.1, dmg: 0, dmgType: 'kinetic', range: 0, rof: 0, speed: 8, sight: 16,
    hits: [], cp: 3, price: 20_000_000, rank: 'A', crew: 2, capacity: 30, transport: 'troops',
  },
  bomber: {
    name: 'Thiên Thạch B', ref: 'B-21 Raider / Tu-160', group: 'air', role: 'Đánh căn cứ, phá công trình',
    skill: 'Thảm bom diện rộng', layer: 'air', model: 'bomber', size: 6.5,
    hp: 900, armor: 0.15, dmg: 220, dmgType: 'he', range: 6, rof: 0.5, speed: 10, sight: 20,
    hits: ['ground', 'sea'], splash: 7, ammo: 4, cp: 5, price: 700_000_000, rank: 'SR', crew: 3, active: 'carpet',
  },
  cca: {
    name: 'Bạn Bầy CCA', ref: 'XQ-58 Valkyrie / MQ-28 Ghost Bat', group: 'air', role: 'Đi kèm máy bay có người lái',
    skill: 'Làm mồi nhử, nhận đạn thay', layer: 'air', model: 'cca', size: 2.8,
    hp: 260, armor: 0.05, dmg: 40, dmgType: 'he', range: 18, rof: 0.4, speed: 14, sight: 24,
    hits: ['air', 'low', 'ground'], remote: true, ammo: 4, cp: 2, price: 20_000_000, rank: 'S', crew: 0, active: 'decoy',
  },
  destroyer: {
    name: 'Khu trục Hải Long', ref: 'Arleigh Burke (Aegis) / Type 055', group: 'navy', role: 'Phòng không hạm đội, tên lửa',
    skill: 'Phòng không tầm xa, VLS', layer: 'sea', model: 'destroyer', size: 7.5,
    hp: 2600, armor: 0.4, dmg: 120, dmgType: 'he', range: 48, rof: 0.25, speed: 3.6, sight: 30,
    hits: ['air', 'low', 'ground', 'sea', 'sub'], detect: ['radar', 'sonar'], cp: 6, price: 2_200_000_000, rank: 'SR', crew: 30, active: 'vls',
  },
  stealth_ship: {
    name: 'Tàu tàng hình Sóng Đen', ref: 'Zumwalt / Constellation', group: 'navy', role: 'Pháo hạm, đổ bộ',
    skill: 'Pháo tầm xa, drone đặt trên tàu', layer: 'sea', model: 'stealth_ship', size: 7.0,
    hp: 2200, armor: 0.35, dmg: 95, dmgType: 'kinetic', range: 55, rof: 0.35, speed: 3.8, sight: 26,
    hits: ['ground', 'sea'], cp: 6, price: 1_200_000_000, rank: 'SR', crew: 25, active: 'shipdrone', capacity: 50, transport: 'troops',
  },
  submarine: {
    name: 'Tàu ngầm Cá Mập', ref: 'Virginia / Yasen-M / Type 093', group: 'sub', role: 'Ám sát dưới nước',
    skill: 'Ẩn mình, ngư lôi / tên lửa từ dưới nước', layer: 'sub', model: 'submarine', size: 6.0,
    hp: 1800, armor: 0.3, dmg: 260, dmgType: 'he', range: 30, rof: 0.15, speed: 3.4, sight: 22,
    hits: ['sea', 'sub', 'ground'], detect: ['sonar'], cp: 5, price: 3_500_000_000, rank: 'SR', crew: 20, active: 'torpedo', capacity: 30, transport: 'troops',
  },
  uuv: {
    name: 'UUV Cá Đuối', ref: 'Orca / Poseidon-class', group: 'sub', role: 'Rải mìn, trinh sát ngầm',
    skill: 'Hoạt động tự động dài hạn', layer: 'sub', model: 'uuv', size: 2.6,
    hp: 300, armor: 0.1, dmg: 0, dmgType: 'he', range: 0, rof: 0, speed: 3.0, sight: 26,
    hits: [], detect: ['sonar'], remote: true, cp: 2, price: 50_000_000, rank: 'S', crew: 0, active: 'seamines',
  },
  sam: {
    name: 'Lá Chắn Thép SAM', ref: 'S-400 / Patriot / THAAD', group: 'aa', role: 'Bảo vệ căn cứ',
    skill: 'Bắn hạ tên lửa, drone, máy bay', layer: 'ground', model: 'sam', size: 3.0,
    hp: 500, armor: 0.2, dmg: 140, dmgType: 'he', range: 50, rof: 0.35, speed: 0, sight: 20,
    hits: ['air', 'low'], detect: ['radar'], interceptor: true, needsTransport: true,
    cp: 4, price: 800_000_000, rank: 'SR', crew: 8, active: 'intercept',
  },
  iron_dome: {
    name: 'Vòm Sắt', ref: 'Iron Dome', group: 'aa', role: 'Đánh chặn tầm ngắn',
    skill: 'Đánh chặn rocket, drone', layer: 'ground', model: 'iron_dome', size: 2.6,
    hp: 380, armor: 0.15, dmg: 70, dmgType: 'he', range: 30, rof: 0.6, speed: 0, sight: 18,
    hits: ['air', 'low'], detect: ['radar'], interceptor: true, needsTransport: true,
    vsManned: 0.4, // anti-rocket/drone system: ×0.4 damage vs manned jets/helicopters (balance; laser too)
    cp: 3, price: 100_000_000, rank: 'S', crew: 6, active: 'intercept',
  },
  laser: {
    name: 'Tia Sét Laser', ref: 'Iron Beam / DragonFire / HELIOS', group: 'energy', role: 'Phá bầy drone',
    skill: 'Bắn chùm, cần hồi năng lượng', layer: 'ground', model: 'laser', size: 2.6,
    hp: 350, armor: 0.15, dmg: 40, dmgType: 'laser', range: 26, rof: 2.0, speed: 2.8, sight: 20,
    hits: ['air', 'low'], detect: ['radar'], energy: 100, vsManned: 0.4, cp: 3, price: 60_000_000, rank: 'S', crew: 3, active: 'beam',
  },
  ew: {
    name: 'Bão Từ EW', ref: 'Krasukha / EA-18G Growler', group: 'ew', role: 'Nhiễu radar, cắt liên lạc',
    skill: 'Làm lạc hướng tên lửa, drone', layer: 'ground', model: 'ew', size: 2.8,
    hp: 300, armor: 0.1, dmg: 8, dmgType: 'emp', range: 28, rof: 1.0, speed: 3.0, sight: 22,
    hits: ['air', 'low', 'ground', 'sea'], detect: ['radar'], jamRadius: 26, cp: 3, price: 70_000_000, rank: 'S', crew: 4, active: 'jam',
  },
  carrier: {
    name: 'Tàu sân bay Thái Dương', ref: 'Lớp Ford', group: 'navy', role: 'Căn cứ di động',
    skill: 'Phóng tiêm kích liên tục', layer: 'sea', model: 'carrier', size: 14,
    hp: 9000, armor: 0.5, dmg: 60, dmgType: 'he', range: 34, rof: 0.5, speed: 2.4, sight: 34,
    hits: ['air', 'low', 'sea'], detect: ['radar', 'sonar'], cp: 9, price: 13_000_000_000, rank: 'UR', crew: 120, active: 'launch',
  },
};

// Commander-called strike (GDD §4 "Siêu thanh"): not a unit, bought per shot, long cooldown, human-in-the-loop.
export const HYPERSONIC = {
  name: 'Tên lửa siêu thanh Lưỡi Hái', ref: 'Kinzhal / DF-17 / Avangard / Dark Eagle',
  price: 40_000_000, cooldown: 150, dmg: 1600, splash: 7, dmgType: 'he', rank: 'SR',
};

// Counter loop (GDD §4): attacker group -> defender group multiplier.
export const COUNTERS = {
  energy: { drone: 2.2 },
  drone: { tank: 1.8 },
  tank: { infantry: 1.6, artillery: 1.6 },
  aa: { air: 2.2, drone: 1.6 },
  air: { tank: 1.6, navy: 1.5 },
  ew: {}, // EW handled as "remote units are jammed", see sim/combat.js
};

// Group used on the defending side of COUNTERS (spg/himars count as artillery).
export function counterGroup(def) {
  if (def.id === 'spg' || def.id === 'himars') return 'artillery';
  return def.group;
}

// Damage type vs armor: kinetic is the anti-armor type, HE splashes, fire ignores some armor,
// emp only hurts remote/electronic units, laser is strong vs light/air targets.
export const DMG_TYPES = {
  kinetic: { label: 'Xuyên giáp', armorPierce: 0.6 },
  he: { label: 'Nổ (HE)', armorPierce: 0.25 },
  fire: { label: 'Cháy/nhiệt', armorPierce: 0.45 },
  emp: { label: 'Điện tử (EMP)', armorPierce: 1.0 },
  laser: { label: 'Năng lượng (laser)', armorPierce: 0.35 },
};

// Tier multipliers (GDD §6).
export const TIERS = {
  1: { mult: 1.0, label: 'T1', unlock: 'Chiến thuật cơ bản', costMult: 0 },
  2: { mult: 1.22, label: 'T2', unlock: '1 phụ kiện', costMult: 0.3 },
  3: { mult: 1.5, label: 'T3', unlock: 'Phụ kiện thứ 2 + hiệu ứng riêng', costMult: 0.6, rareMaterial: 1 },
};
export const MAX_T3 = 3;
export const MAX_SLOTS = 9;
export const CP_LIMIT = 30;

// Accessories unlocked at T2 / T3 (GDD §6, F-81): [T2 accessory, T3 accessory] per group, each with a real effect.
// mods are merged by accessoryMods(def, tier) and read by sim/unit.js (stats), skills.js, vision.js, combat.js:
//  apsCdMult (APS recharge ×), apsCharges (APS blocks per recharge), sightMult, jamResist (EW aura only bites inside
//  (1-r) of its radius, timed jams wear off 1/(1-r) faster), ammoAdd, rangeMult, vlsMult (VLS salvo ×),
//  interceptBonus (+intercept chance), torpedoDmg (×), sonarEvade (enemy sonar range ×(1-v)), doubleIntercept,
//  energyMult (max energy ×), beamExtra (+swarm drones per laser hit), jamRadiusMult, hackExtra (+s of hack),
//  armorAdd, ignoreRain (no rain sight penalty).
export const ACCESSORY_FX = {
  tank: [
    { name: 'APS cải tiến', desc: 'APS hồi nhanh hơn 30%', mods: { apsCdMult: 0.7 } },
    { name: 'APS chặn 2 lần', desc: 'APS chặn 2 tên lửa mỗi lượt hồi', mods: { apsCharges: 2 } },
  ],
  drone: [
    { name: 'Radar tốt hơn', desc: '+25% tầm nhìn', mods: { sightMult: 1.25 } },
    { name: 'Kháng nhiễu', desc: 'Thời gian bị nhiễu −50%, vòng nhiễu EW chỉ tác dụng ở nửa bán kính', mods: { jamResist: 0.5 } },
  ],
  air: [
    { name: 'Thùng dầu phụ', desc: '+2 cơ số đạn mỗi lần xuất kích', mods: { ammoAdd: 2 } },
    { name: 'Tên lửa tầm xa+', desc: '+10% tầm bắn', mods: { rangeMult: 1.1 } },
  ],
  navy: [
    { name: 'VLS phụ', desc: 'Loạt VLS +50% tên lửa', mods: { vlsMult: 1.5 } },
    { name: 'Radar Aegis+', desc: '+20% tỉ lệ đánh chặn tên lửa', mods: { interceptBonus: 0.2 } },
  ],
  sub: [
    { name: 'Ngư lôi dẫn đường', desc: '+20% sát thương ngư lôi', mods: { torpedoDmg: 1.2 } },
    { name: 'Ẩn mình sâu', desc: 'Sonar địch phát hiện ở tầm ngắn hơn 30%', mods: { sonarEvade: 0.3 } },
  ],
  aa: [
    { name: 'Radar tốt hơn', desc: '+15% tầm bắn', mods: { rangeMult: 1.15 } },
    { name: 'Đánh chặn kép', desc: 'Đánh chặn 2 mục tiêu mỗi lượt hồi', mods: { doubleIntercept: true } },
  ],
  energy: [
    { name: 'Pin dung lượng cao', desc: '+50% năng lượng tối đa', mods: { energyMult: 1.5 } },
    { name: 'Chùm tia kép', desc: 'Mỗi phát laser hạ thêm 1 drone trong bầy', mods: { beamExtra: 1 } },
  ],
  ew: [
    { name: 'Ăng-ten khuếch đại', desc: '+20% bán kính nhiễu', mods: { jamRadiusMult: 1.2 } },
    { name: 'Hack kéo dài', desc: 'Lệnh Màn Đêm hack lâu thêm 4 giây', mods: { hackExtra: 4 } },
  ],
  infantry: [
    { name: 'Giáp cấp 4', desc: '+15% giáp', mods: { armorAdd: 0.15 } },
    { name: 'Kính nhìn đêm', desc: 'Không bị mưa giảm tầm nhìn', mods: { ignoreRain: true } },
  ],
};
// Names only (kept for older UI code).
export const ACCESSORIES = Object.fromEntries(Object.entries(ACCESSORY_FX).map(([g, l]) => [g, l.map(a => a.name)]));
// Accessories active at a tier: T2 -> first, T3 -> both.
export function activeAccessories(def, tier = 1) { return (ACCESSORY_FX[def.group] || []).slice(0, Math.max(0, tier - 1)); }
export function accessoryMods(def, tier = 1) {
  const out = {};
  for (const a of activeAccessories(def, tier)) Object.assign(out, a.mods);
  return out;
}

// Formation command points of one unit at a tier (GDD §6/§9 "nâng tier tốn điểm chỉ huy", F-85).
// Single formula shared by the pre-match builder (core/profile.js) and the in-match shop (sim/economy.js).
export function unitCp(def, tier = 1) { return (def.cp || 0) + (Math.max(1, tier) - 1); }

// Expand legacy formations ({unit, count: n}) into one slot per weapon (GDD §4 F-52: 1 ô = 1 khí tài, a swarm = 1 ô).
export function expandFormation(formation = [], max = MAX_SLOTS) {
  const out = [];
  for (const s of formation) {
    const n = UNITS[s.unit]?.swarmCount ? 1 : Math.max(1, Math.floor(s.count || 1));
    for (let i = 0; i < n && out.length < max; i++) out.push({ ...s, count: 1 });
  }
  return out;
}

export function unitDef(id) {
  const d = UNITS[id];
  if (!d) throw new Error('Unknown unit ' + id);
  return { id, ...d };
}

export function tierStats(def, tier = 1, bonus = 0) {
  const m = TIERS[tier].mult + bonus;
  return {
    hp: Math.round(def.hp * m),
    armor: Math.min(0.8, def.armor * (1 + (m - 1) * 0.5)),
    dmg: def.dmg * m,
    range: def.range * m,                       // GDD §6: T2 +20–25%, T3 +45–55% for HP, damage and range
    speed: def.speed * (1 + (m - 1) * 0.3),
    cooldownMult: 1 / m,
  };
}

// Truthful one-line summary of a tier's stat changes vs T1 (shop / formation builder text).
export function tierBonusText(tier) {
  const base = { hp: 1000, armor: 0.2, dmg: 100, range: 100, speed: 100 };
  const a = tierStats(base, 1), b = tierStats(base, tier);
  const p = k => Math.round((b[k] / a[k] - 1) * 100);
  const cd = Math.round((1 - b.cooldownMult / a.cooldownMult) * 100);
  return `+${p('hp')}% HP/sát thương/tầm, +${p('armor')}% giáp, +${p('speed')}% tốc độ, hồi chiêu nhanh hơn ${cd}%`;
}

export function formatUSD(v) {
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  if (a >= 1e9) return s + (a / 1e9).toFixed(a >= 1e10 ? 1 : 2) + ' tỷ';
  if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + ' tr';
  if (a >= 1e3) return s + (a / 1e3).toFixed(0) + 'k';
  return s + a.toFixed(0);
}

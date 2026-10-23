// 5 commanders (GDD §3). Each: doctrine, strengths, weaknesses, 1 passive, 1 ultimate ("lệnh tối thượng"), 1 tier bonus.
// passive.mods are read by sim/commanders.js. ultimate.cost is in Command Points (match resource, GDD §2 step 5).

export const COMMANDERS = {
  steel: {
    name: 'Đại tướng Thép', domain: 'Mặt đất', doctrine: 'Thiết giáp đột phá', color: '#9aa7b1',
    strengths: 'HP/giáp cao, phá công trình nhanh', weaknesses: 'Chậm, sợ drone và máy bay tấn công',
    passive: {
      name: 'Thép Tôi', desc: 'Xe tăng & xe bọc thép +8% giáp, +10% sát thương lên công trình.',
      mods: { armorGroup: { tank: 0.08 }, structureDmg: 0.1 },
    },
    ultimate: {
      id: 'wedge', name: 'Miệng Chôn', cost: 60, cooldown: 120,
      desc: 'Toàn bộ tank + bộ binh xếp đội hình mũi chêm, +40% tốc độ và giáp 15 giây, xuyên thẳng tuyến chỉ định.',
    },
    tierBonus: { group: 'tank', stat: 'hp', value: 0.1, desc: '+10% HP cho nhóm Tank ở mọi tier' },
    recommended: ['tank_heavy', 'tank_heavy', 'spg', 'apc', 'ugv', 'drone_recon', 'iron_dome', 'at_team', 'supply_truck'],
  },
  air: {
    name: 'Tư lệnh Không quân', domain: 'Trên không', doctrine: 'Ưu thế không chế', color: '#6fb3ff',
    strengths: 'Tốc độ, tầm đánh xa', weaknesses: 'Mỏng, phụ thuộc nhiên liệu/sân bay, sợ SAM',
    passive: {
      name: 'Phi Đội Tinh Nhuệ', desc: 'Máy bay nạp đạn ở căn cứ nhanh gấp đôi, +30% tầm bắn.',
      mods: { rearmSpeed: { air: 1.0 }, rangeGroup: { air: 0.3 } },
    },
    ultimate: {
      id: 'steelrain', name: 'Mưa Thép', cost: 70, cooldown: 140,
      desc: 'Gọi một đợt không kích diện rộng xuống vùng chỉ định (8 loạt bom).',
    },
    tierBonus: { group: 'air', stat: 'range', value: 0.1, desc: '+10% tầm cho nhóm Máy bay' },
    recommended: ['fighter_stealth', 'fighter_multi', 'cca', 'heli_attack', 'heli_transport', 'drone_recon', 'apc', 'tank_heavy', 'iron_dome'],
  },
  navy: {
    name: 'Đô đốc Hải quân', domain: 'Biển', doctrine: 'Kiểm soát biển & tên lửa', color: '#41d1c4',
    strengths: 'Mạnh ở bản đồ vịnh biển, tầm xa', weaknesses: 'Yếu trên đất liền',
    passive: {
      name: 'Mạng Aegis', desc: 'Tàu chiến +20% tầm phòng không, tàu ngầm được sonar toàn hạm đội.',
      mods: { rangeGroup: { navy: 0.2 }, fleetSonar: true },
    },
    ultimate: {
      id: 'blockade', name: 'Phong Tỏa', cost: 70, cooldown: 150,
      desc: 'Khoanh một vùng: tên lửa hành trình bắn liên tục 12 giây + lộ diện mọi tàu ngầm địch trong vùng (sonar).',
    },
    tierBonus: { group: 'navy', stat: 'dmg', value: 0.1, desc: '+10% sát thương cho Tàu chiến' },
    // Big hulls (destroyer 2.2 tỷ, stealth ship 1.2 tỷ, submarine 3.5 tỷ) are bought in-match from income (AI shop wish list).
    recommended: ['uuv', 'heli_attack', 'heli_attack', 'drone_recon', 'iron_dome', 'apc', 'tank_heavy', 'at_team', 'destroyer'],
  },
  swarm: {
    name: 'Chỉ huy Drone / Swarm', domain: 'Vô nhân', doctrine: 'Chiến tranh bầy đàn', color: '#ffb547',
    strengths: 'Rẻ, nhiều, tấn công đa hướng', weaknesses: 'Mỗi drone yếu, sợ EW và laser',
    passive: {
      name: 'Dây Chuyền Sản Xuất', desc: 'Bầy drone tự bổ sung 1 drone mỗi 6 giây; drone +15% tốc độ.',
      mods: { swarmRegen: 6, speedGroup: { drone: 0.15 } },
    },
    ultimate: {
      id: 'beehive', name: 'Đàn Ong', cost: 60, cooldown: 120,
      desc: 'Phóng 40 drone tự sát/FPV đồng loạt từ nhiều hướng vào vùng chỉ định.',
    },
    tierBonus: { group: 'drone', stat: 'hp', value: 0.15, desc: '+15% HP cho Drone' },
    recommended: ['swarm_fpv', 'swarm_fpv', 'drone_kamikaze', 'drone_recon', 'drone_male', 'ugv', 'apc', 'apc', 'tank_heavy'],
  },
  ew: {
    name: 'Chỉ huy Tác chiến Điện tử', domain: 'Hỗ trợ', doctrine: 'Chiến tranh thông tin', color: '#b58cff',
    strengths: 'Đảo ngược AI địch, vô hiệu hóa', weaknesses: 'Sát thương thấp, cần đồng đội',
    passive: {
      name: 'Bức Màn Số', desc: 'Đơn vị phe ta khó bị khóa mục tiêu (-20% sát thương từ tên lửa); vòng nhiễu EW +30%.',
      mods: { missileResist: 0.2, jamRadius: 0.3 },
    },
    ultimate: {
      id: 'nightfall', name: 'Màn Đêm', cost: 70, cooldown: 150,
      desc: 'Nhiễu radar & liên lạc toàn vùng 12 giây; hack tạm thời tối đa 3 đơn vị điều khiển từ xa của địch về phe ta.',
    },
    tierBonus: { group: 'ew', stat: 'range', value: 0.15, desc: '+15% tầm cho EW' },
    recommended: ['ew', 'laser', 'tank_heavy', 'apc', 'spg', 'drone_recon', 'heli_attack', 'iron_dome', 'at_team'],
  },
};

export const COMMANDER_IDS = Object.keys(COMMANDERS);

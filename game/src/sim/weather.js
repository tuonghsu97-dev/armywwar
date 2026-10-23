// OWNER: agent Chỉ huy & kỹ năng
// Weather gameplay (GDD §7, F-98). vision.js already cuts sight in rain/fog and hides drones beyond 8 units in fog.
// This module adds: rain/fog lower weapon range of ground & air units (u.weatherRange, read by combat.effRange),
// rain lowers accuracy of guns (damage hook), and an optional weather cycle (game.opts.weatherCycle = true |
// seconds) that changes game.weather during a match and emits 'weather' {type, name}.
// Installed by commanders.js (no edit to sim/index.js needed).

export const WEATHER_INFO = {
  clear: { name: 'Trời quang', range: 1, accuracy: 1 },
  rain: { name: 'Mưa', range: 0.78, accuracy: 0.85, desc: 'tầm nhìn và tầm bắn giảm' },
  fog: { name: 'Sương mù', range: 0.9, accuracy: 0.95, desc: 'drone ẩn ngoài 8 ô, tầm bắn giảm nhẹ' },
};
export const WEATHER_TYPES = Object.keys(WEATHER_INFO);

export function weatherRangeMult(game, u) {
  const w = WEATHER_INFO[game.weather] || WEATHER_INFO.clear;
  if (w.range === 1) return 1;
  // Ground and air units are affected; ships keep radar-guided range, subs are underwater.
  if (u.layer === 'ground' || u.layer === 'air' || u.layer === 'low') return w.range;
  return 1;
}

export function setWeather(game, type) {
  if (!WEATHER_INFO[type] || game.weather === type) return false;
  game.weather = type;
  const w = WEATHER_INFO[type];
  game.events.emit('weather', { type, name: w.name });
  game.events.emit('toast', { side: null, text: `Thời tiết: ${w.name}${w.desc ? ' — ' + w.desc : ''}` });
  return true;
}

export const weatherSystem = {
  name: 'weather',
  update(game, dt) {
    const cyc = game.opts.weatherCycle;
    if (cyc && game.phase === 'battle') {
      const period = typeof cyc === 'number' ? cyc : 120;
      if (game.weatherNext == null) game.weatherNext = game.time + period * (0.75 + game.rng.next() * 0.5);
      if (game.time >= game.weatherNext) {
        game.weatherNext = game.time + period * (0.75 + game.rng.next() * 0.5);
        const opts = WEATHER_TYPES.filter(t => t !== game.weather);
        setWeather(game, opts[Math.floor(game.rng.next() * opts.length)]);
      }
    }
    if (game.tick % 10 !== 0) return;
    for (const u of game.units.values()) if (u.alive) u.weatherRange = weatherRangeMult(game, u);
  },
};

export function install(game) {
  game.addSystem(weatherSystem, 21);
  game.addDamageHook((g, t, dmg, dmgType, src) => {
    const w = WEATHER_INFO[g.weather];
    if (!w || w.accuracy === 1 || !src || !src.def || src.def.kamikaze) return dmg;
    if (dmgType === 'kinetic' && src.kind === 'unit' && (src.layer === 'ground' || src.layer === 'air' || src.layer === 'low')) return dmg * w.accuracy;
    return dmg;
  });
}

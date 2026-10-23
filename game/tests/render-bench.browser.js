// Browser-only render benchmark (QA #10). In the dev page console:
//   const { bench } = await import('/tests/render-bench.browser.js'); await bench('city', { zoom: 0 })
// Starts a quick match, spawns ~150 mixed units in the middle of the map, steps the sim, then times
// R.render() + gl.finish() over N frames at the given zoom with every unit visible. Returns draw calls / ms.
export async function bench(mapId, opts = {}) {
  const { defaultMatch } = await import('/src/ui/screens.js');
  const { T, CELL } = await import('/src/data/maps.js');
  const app = window.__app;
  const m = app.startMatch(defaultMatch('steel', mapId));
  m.running = false;
  const g = m.game;
  if (opts.quality && m.R.post) m.R.post.setQuality(opts.quality);
  g.issue(0, { type: 'autodeploy' }); g.issue(1, { type: 'autodeploy' }); g.issue(0, { type: 'ready' }); g.issue(1, { type: 'ready' });
  for (let i = 0; i < 3; i++) g.step();
  let seed = 12345; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const ground = ['tank_heavy', 'apc', 'infantry', 'sam', 'spg', 'ugv', 'supply_truck', 'himars', 'ew', 'laser', 'iron_dome'];
  const air = ['heli_attack', 'drone_recon', 'fighter_multi', 'heli_transport', 'cca', 'swarm_fpv'];
  const sea = ['destroyer', 'submarine', 'stealth_ship'];
  const cellT = (x, z) => g.map.grid[Math.floor(z / CELL) * g.map.cols + Math.floor(x / CELL)];
  const land = (x, z) => [T.LAND, T.ROAD, T.HILL, T.FOREST].includes(cellT(x, z));
  let k = 0, guard = 0;
  while ([...g.units.values()].filter(u => u.alive).length < (opts.n || 150) && guard++ < 5000) {
    const side = k % 2, x = 50 + rnd() * 140, z = 10 + rnd() * 130;
    const r = rnd(); let id;
    if (r < 0.2) id = air[k % air.length];
    else if (r < 0.3 && cellT(x, z) === T.DEEP) id = sea[k % sea.length];
    else if (land(x, z)) id = ground[k % ground.length];
    else continue;
    g.spawn(side, id, x, z, { group: 0 }); k++;
  }
  for (let i = 0; i < (opts.steps || 60); i++) g.step();
  const R = m.R, zoom = opts.zoom ?? 0;
  R.setZoom(zoom); R.focus(opts.x ?? g.map.w / 2, opts.z ?? g.map.h / 2); R.viewH = [175, 92, 42][zoom]; R.updateCamera();
  if (opts.settle) for (let i = 0; i < 4; i++) m.fx.update(3);   // expire transient effects spawned while stepping
  const gl = R.r.getContext(); R.r.info.autoReset = false;
  const times = []; let calls = 0, tris = 0;
  const pts = () => [...g.units.values()].filter(u => u.alive && !u.isAir).slice(0, 120);
  for (let i = 0; i < (opts.frames || 20); i++) {
    for (const u of g.units.values()) if (u.visible) u.visible[0] = true;
    for (const s of g.structures) s.seen0 = true;
    m.view.update(0.016); m.fx.update(0.016); R.fadeBuildings(pts());
    R.r.info.reset();
    const t0 = performance.now(); R.render(0.016); gl.finish(); times.push(performance.now() - t0);
    calls = R.r.info.render.calls; tris = R.r.info.render.triangles;
  }
  R.r.info.autoReset = true;
  times.sort((a, b) => a - b);
  const alive = [...g.units.values()].filter(u => u.alive).length;
  return { mapId, zoom, alive, calls, tris, median: +times[times.length >> 1].toFixed(2), p90: +times[Math.floor(times.length * 0.9)].toFixed(2), quality: R.post?.quality };
}

export async function benchAll(opts = {}) {
  const out = [];
  for (const id of ['plains', 'city', 'bay']) out.push(await bench(id, opts));
  return out;
}

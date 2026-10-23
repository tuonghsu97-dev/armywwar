// App entry: loads assets, shows menus, starts/ends matches.
import { loadModels } from './render/models.js';
import { Match } from './match.js';
import { showScreen, attachMatch, startTutorial } from './ui/screens.js';

const app = {
  renderer: null,
  match: null,
  showScreen(name, params) { showScreen(app, name, params); },
  startMatch(opts) {
    if (app.match) app.match.destroy();
    showScreen(app, 'none');
    app.match = new Match(document.getElementById('view'), opts, app);
    app.onMatchStart?.(app.match);
    return app.match;
  },
  onMatchEnd(match, result) {
    app.lastResult = { result, match };
    showScreen(app, 'result', { result, match });
  },
  leaveMatch() {
    if (app.match) { app.match.destroy(); app.match = null; }
    document.getElementById('hud').classList.add('hidden');
    showScreen(app, 'main');
  },
};
window.__app = app;
// Meta agent: per-match extras (boss HP bar + phase banner, ghost opponent tag, tutorial overlay).
app.onMatchStart = m => attachMatch(app, m);

async function boot() {
  const bar = document.querySelector('.loading-bar i'), txt = document.querySelector('.loading-text');
  txt.textContent = 'Đang tải mô hình 3D...';
  await loadModels(p => { bar.style.width = Math.round(p * 100) + '%'; });
  bar.style.width = '100%';
  document.getElementById('loading').classList.add('done');
  const params = new URLSearchParams(location.search);
  if (params.has('quick')) {
    const { defaultMatch } = await import('./ui/screens.js');
    app.startMatch(defaultMatch(params.get('cmd') || 'steel', params.get('map') || 'plains'));
  } else if (params.has('tutorial')) startTutorial(app);
  else showScreen(app, 'main');
}
boot();

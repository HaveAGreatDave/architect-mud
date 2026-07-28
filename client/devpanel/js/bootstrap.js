document.getElementById('dev-password').addEventListener('keydown', e => { if(e.key==='Enter') devLogin(); });

// ── Ops mode ────────────────────────────────────────────────────────────────
// The panel is served at two URLs from ONE file. /dev is the full builder (local
// worldbuilding); /admin is the ops view for production, where world content is
// read-only (the server's CONTENT_READONLY gate) and only player/live-world
// management makes sense. Prod 302s bare /dev → /admin, so the game's Dev button
// needs no environment awareness of its own.
window.OPS_MODE = location.pathname.replace(/\/+$/, '') === '/admin';
if (window.OPS_MODE) {
  document.body.classList.add('ops-mode');
  document.title = 'Architect — Admin';
  const logoTag = document.querySelector('#header .logo span');
  if (logoTag) logoTag.textContent = '// ADMIN';
  const nav = document.getElementById('nav');
  nav.querySelectorAll('.nav-item:not([data-ops]), .nav-children').forEach(n => n.remove());
  // Section headers whose whole group just went away would otherwise be orphans.
  nav.querySelectorAll('.nav-section').forEach(s => {
    let sib = s.nextElementSibling;
    while (sib && !sib.classList.contains('nav-section')) {
      if (sib.classList.contains('nav-item')) return;
      sib = sib.nextElementSibling;
    }
    s.remove();
  });
  // Panels kept for viewing only (data-ops-ro) say so in the nav, so you know
  // before you click that nothing in there will save.
  nav.querySelectorAll('.nav-item[data-ops-ro]').forEach(n => {
    n.textContent = `${n.textContent.trim()} ·ro`;
    n.title = 'Read-only on production — edit locally and deploy';
  });
  // "World" survives (Crime/Flight/Power/Bank are live-world ops), but nothing
  // under it edits world content any more, so the label would mislead.
  nav.querySelectorAll('.nav-section').forEach(s => {
    if (s.textContent.trim() === 'World') s.textContent = 'Live World';
  });
}

// Auto-auth if a Bearer token was passed via sessionStorage (e.g. from the game client).
// Token format: base64("playerId:role:timestamp") — decode to get role without a round-trip.
(() => {
  const stored = sessionStorage.getItem('devpanel-token');
  if (!stored) return;
  let role = '', handle = '';
  try { [devPlayerId, role] = atob(stored).split(':'); } catch { return; }
  if (!['admin','dev','builder','designer'].includes(role)) return;
  token = stored;
  devRole = role;
  document.getElementById('auth-overlay').classList.add('hidden');
  document.getElementById('auth-badge').textContent = `[${role}]`;
  document.getElementById('auth-badge').className = 'auth-status ok';
  if (['admin','dev'].includes(role)) document.getElementById('ghost-btn').style.display = '';
  currentPanel = 'dashboard';
  activatePanelNav('dashboard');
  setTimeout(() => { loadPanel('dashboard'); startWorldStatePolling(); initMisToggle(); initEmailVerifyToggle(); updateStagingBadge(); showPlayButton(); initWhisperPanel(); }, 0);
})();
applyDevSettings();

// ── Mobile drawers ──────────────────────────────────────────────────────────
// On phones the nav and world-state sidebars are off-canvas; these toggle the
// classes the mobile CSS keys off of. Opening one closes the other.
function toggleMobileNav() {
  const l = document.getElementById('layout');
  l.classList.remove('ws-open');
  l.classList.toggle('nav-open');
}
function toggleMobileWorldState() {
  const l = document.getElementById('layout');
  l.classList.remove('nav-open');
  l.classList.toggle('ws-open');
}
function closeMobileDrawers() {
  document.getElementById('layout').classList.remove('nav-open', 'ws-open');
}
// Tapping a nav item navigates then closes the drawer.
document.getElementById('nav').addEventListener('click', e => {
  if (e.target.closest('.nav-item')) closeMobileDrawers();
});

window.addEventListener('storage', e => {
  if (e.key !== SHARED_SETTINGS_KEY) return;
  devSettings = loadDevSettings();
  applyDevSettings();
});

document.addEventListener('DOMContentLoaded', () => {
  populateThemeGrid();
  const themeGrid = document.getElementById('dev-opt-theme-grid');
  if (themeGrid) {
    themeGrid.addEventListener('click', (e) => {
      const chip = e.target.closest('.theme-chip');
      if (!chip || !themeGrid.contains(chip)) return;
      const val = chip.dataset.value;
      devSettings.theme = val;
      if (BUILTIN_THEME_VALUES.includes(val)) devSettings.customColors = {};
      _themeEditLoaded = false;
      saveDevSettings(devSettings);
      applyDevSettings();
    });
  }

  document.querySelectorAll('#dev-opt-fontsize .dev-settings-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      devSettings.fontSize = btn.dataset.value;
      saveDevSettings(devSettings);
      applyDevSettings();
    });
  });

  document.querySelectorAll('#dev-opt-density .dev-settings-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      devSettings.density = btn.dataset.value;
      saveDevSettings(devSettings);
      applyDevSettings();
    });
  });

  document.querySelectorAll('#dev-opt-motion .dev-settings-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      devSettings.motion = btn.dataset.value;
      saveDevSettings(devSettings);
      applyDevSettings();
    });
  });

  document.querySelectorAll('#dev-opt-tempunit .dev-settings-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      devSettings.tempUnit = btn.dataset.value;
      saveDevSettings(devSettings);
      applyDevSettings();
    });
  });

  const contrastSlider = document.getElementById('dev-opt-contrast');
  const contrastLabel  = document.getElementById('dev-contrast-label');
  const contrastSave   = document.getElementById('dev-contrast-save');
  const contrastRestore = document.getElementById('dev-contrast-restore');

  if (contrastSlider) {
    contrastSlider.addEventListener('input', () => {
      const val = parseInt(contrastSlider.value, 10);
      if (contrastLabel) contrastLabel.textContent = val === 0 ? 'Base' : `+${val}%`;
      devSettings._contrastPreview = val;
      saveDevSettings(devSettings);
      applyDevSettings();
    });
  }
  if (contrastSave) {
    contrastSave.addEventListener('click', () => {
      devSettings.contrast = parseInt(contrastSlider?.value ?? 0, 10);
      delete devSettings._contrastPreview;
      saveDevSettings(devSettings);
      applyDevSettings();
    });
  }
  if (contrastRestore) {
    contrastRestore.addEventListener('click', () => {
      devSettings.contrast = 0;
      delete devSettings._contrastPreview;
      if (contrastSlider) contrastSlider.value = 0;
      if (contrastLabel) contrastLabel.textContent = 'Base';
      saveDevSettings(devSettings);
      applyDevSettings();
    });
  }
});

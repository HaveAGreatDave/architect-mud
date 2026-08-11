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
  // The nav is 1:1 with /dev — nothing is removed. Panels the server won't accept
  // a write for (OPS_WRITABLE_PANELS in core/panels.js) are marked 🔒 so you know
  // before you click that nothing in there will save, and the toggle below hides
  // them. Default is hidden, so the ops nav opens as the short live-world list it
  // has always been; showing the rest is one click, not a different URL.
  nav.querySelectorAll('.nav-item[data-panel]').forEach(n => {
    if (!opsPanelReadOnly(n.dataset.panel)) return;
    n.dataset.opsRo = '1';
    n.textContent = `${n.textContent.trim()} 🔒`;
    n.title = 'Read-only on production — look all you like; edit locally and deploy';
  });
  // "World" keeps its live-world ops (Crime/Flight/Power/Bank); with the content
  // panels only viewable under it, the plain label would oversell what it does.
  nav.querySelectorAll('.nav-section').forEach(s => {
    if (s.textContent.trim() === 'World') s.textContent = 'Live World';
  });
  nav.insertAdjacentHTML('afterbegin',
    '<label id="ops-ro-toggle" title="Show the panels that are read-only on production">'
    + '<input type="checkbox" id="ops-ro-checkbox" onchange="setOpsShowReadonly(this.checked)"> show read-only 🔒</label>');
  const show = localStorage.getItem('devpanel-ops-show-ro') === '1';
  document.getElementById('ops-ro-checkbox').checked = show;
  applyOpsReadonlyVisibility(show);
}

function setOpsShowReadonly(show) {
  localStorage.setItem('devpanel-ops-show-ro', show ? '1' : '0');
  applyOpsReadonlyVisibility(show);
}

// Hiding the read-only entries would leave section headers standing over nothing,
// so a section goes with the last visible item under it.
function applyOpsReadonlyVisibility(show) {
  const nav = document.getElementById('nav');
  if (!nav) return;
  nav.querySelectorAll('.nav-item[data-ops-ro]').forEach(n => { n.style.display = show ? '' : 'none'; });
  nav.querySelectorAll('.nav-section').forEach(s => {
    let sib = s.nextElementSibling, any = false;
    while (sib && !sib.classList.contains('nav-section')) {
      if (sib.classList.contains('nav-item') && sib.style.display !== 'none') { any = true; break; }
      sib = sib.nextElementSibling;
    }
    s.style.display = any ? '' : 'none';
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
  setTimeout(() => { loadPanel('dashboard'); startWorldStatePolling(); initMisToggle(); initEmailVerifyToggle(); initRegistrationsToggle(); updateStagingBadge(); showPlayButton(); initWhisperPanel(); }, 0);
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

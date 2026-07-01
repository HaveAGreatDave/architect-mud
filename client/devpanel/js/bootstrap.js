document.getElementById('dev-password').addEventListener('keydown', e => { if(e.key==='Enter') devLogin(); });

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
  populateThemeDropdown();
  const themeSel = document.getElementById('dev-opt-theme');
  if (themeSel) {
    themeSel.addEventListener('change', () => {
      const val = themeSel.value;
      devSettings.theme = val;
      if (BUILTIN_THEME_VALUES.includes(val)) devSettings.customColors = {};
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

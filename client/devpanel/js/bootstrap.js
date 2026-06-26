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
  setTimeout(() => { loadPanel('dashboard'); startWorldStatePolling(); updateStagingBadge(); showPlayButton(); }, 0);
})();
applyDevSettings();

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
});

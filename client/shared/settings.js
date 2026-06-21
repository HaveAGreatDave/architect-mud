const SETTINGS_KEY = 'architect_settings';
const DEFAULT_SETTINGS = { theme: 'dark', fontSize: '14', density: 'comfortable' };

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}

export function applySettings(settings) {
  document.documentElement.setAttribute('data-theme', settings.theme);
  document.documentElement.setAttribute('data-density', settings.density);
  document.documentElement.style.setProperty('--font-size-base', settings.fontSize + 'px');

  for (const group of ['theme', 'fontsize', 'density']) {
    const container = document.getElementById(`opt-${group}`);
    if (!container) continue;
    const key = group === 'fontsize' ? 'fontSize' : group;
    container.querySelectorAll('.settings-opt').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.value === String(settings[key]));
    });
  }
}

export function initSettingsUI(settings, saveAndApply) {
  document.querySelectorAll('#opt-theme .settings-opt').forEach(btn => {
    btn.addEventListener('click', () => { settings.theme = btn.dataset.value; saveAndApply(); });
  });
  document.querySelectorAll('#opt-fontsize .settings-opt').forEach(btn => {
    btn.addEventListener('click', () => { settings.fontSize = btn.dataset.value; saveAndApply(); });
  });
  document.querySelectorAll('#opt-density .settings-opt').forEach(btn => {
    btn.addEventListener('click', () => { settings.density = btn.dataset.value; saveAndApply(); });
  });

  document.getElementById('settings-btn').addEventListener('click', () => {
    document.getElementById('settings-panel').classList.add('active');
  });
  document.getElementById('settings-close').addEventListener('click', () => {
    document.getElementById('settings-panel').classList.remove('active');
  });
  document.getElementById('settings-panel').addEventListener('click', (e) => {
    if (e.target.id === 'settings-panel') document.getElementById('settings-panel').classList.remove('active');
  });

  document.getElementById('map-close').addEventListener('click', () => {
    document.getElementById('map-panel').classList.remove('active');
  });
  document.getElementById('map-panel').addEventListener('click', (e) => {
    if (e.target.id === 'map-panel') document.getElementById('map-panel').classList.remove('active');
  });
}

export { SETTINGS_KEY };

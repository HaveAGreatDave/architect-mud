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

export function initSettingsUI(settings, saveAndApply, { getOrigin, saveOrigin, sendCmd } = {}) {
  document.querySelectorAll('#opt-theme .settings-opt').forEach(btn => {
    btn.addEventListener('click', () => { settings.theme = btn.dataset.value; saveAndApply(); });
  });
  document.querySelectorAll('#opt-fontsize .settings-opt').forEach(btn => {
    btn.addEventListener('click', () => { settings.fontSize = btn.dataset.value; saveAndApply(); });
  });
  document.querySelectorAll('#opt-density .settings-opt').forEach(btn => {
    btn.addEventListener('click', () => { settings.density = btn.dataset.value; saveAndApply(); });
  });

  const originArea = document.getElementById('settings-origin');
  const originCounter = document.getElementById('settings-origin-counter');
  const originSave = document.getElementById('settings-origin-save');
  if (originArea && originCounter) {
    originArea.addEventListener('input', () => {
      originCounter.textContent = `${originArea.value.length} / 200`;
    });
  }
  if (originSave && saveOrigin) {
    originSave.addEventListener('click', () => saveOrigin(originArea.value.trim()));
  }

  // Hidden debug field — MISON64 / MISOFF64
  const debugInput = document.getElementById('settings-debug');
  if (debugInput && sendCmd) {
    debugInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const val = debugInput.value.trim().toUpperCase();
      debugInput.value = '';
      if (val === 'MISON64') {
        localStorage.setItem('mis_client_enabled', '1');
        sendCmd('mis on');
      } else if (val === 'MISOFF64') {
        localStorage.removeItem('mis_client_enabled');
        sendCmd('mis off');
      }
    });
  }

  document.getElementById('settings-btn').addEventListener('click', () => {
    if (originArea && getOrigin) {
      const val = getOrigin();
      originArea.value = val;
      originCounter.textContent = `${val.length} / 200`;
    }
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

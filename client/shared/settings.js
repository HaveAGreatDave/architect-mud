const SETTINGS_KEY = 'architect_settings';
const DEFAULT_AUDIO_SETTINGS = { enabled: false, music: false, sfx: false, tv: false, masterVolume: 0.8, musicVolume: 0.7, sfxVolume: 0.9, ambientVolume: 0.5, tvVolume: 0.6, muteWhenHidden: true };
const DEFAULT_SETTINGS = { theme: 'dark', fontSize: '14', density: 'comfortable', sidebarPosition: 'left', motion: 'on', tempUnit: 'C', contrast: 0, audio: DEFAULT_AUDIO_SETTINGS };

export function formatTemp(tempC) {
  if (tempC === null || tempC === undefined) return null;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const unit = raw ? (JSON.parse(raw).tempUnit || 'C') : 'C';
    if (unit === 'F') return `${Math.round(tempC * 9 / 5 + 32)}°F`;
  } catch {}
  return `${tempC}°C`;
}

export function formatTempPrecise(tempC, decimals = 1) {
  if (tempC === null || tempC === undefined) return null;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const unit = raw ? (JSON.parse(raw).tempUnit || 'C') : 'C';
    if (unit === 'F') return `${(tempC * 9 / 5 + 32).toFixed(decimals)}°F`;
  } catch {}
  return `${tempC.toFixed(decimals)}°C`;
}

export { SETTINGS_KEY };

const LIGHT_THEMES = [
  ['light','Parchment'],['inkwell','Inkwell'],['studio','Studio'],
  ['arctic','Arctic'],['solar','Solar'],['mint','Mint'],['lavender','Lavender'],['fog','Fog'],
];
const DARK_THEMES = [
  ['dark','Void'],['eclipse','Eclipse'],['iron','Iron'],
  ['contrast','Terminal'],['phosphor','Phosphor Green'],['synthwave','Synthwave'],['bloodmoon','Blood Moon'],['slate','Slate'],
];
const BUILTIN_THEMES = [...LIGHT_THEMES, ...DARK_THEMES];

const THEME_COLOR_VARS = [
  { v: '--bg',          label: 'Background (deep)',      desc: 'Page / outermost background' },
  { v: '--bg2',         label: 'Background (panels)',    desc: 'Cards, modals, sidebar' },
  { v: '--bg3',         label: 'Background (inputs)',    desc: 'Inputs, tables, inner fills' },
  { v: '--border',      label: 'Border',                 desc: 'Dividers and outlines' },
  { v: '--text',        label: 'Body text',              desc: 'Default readable text' },
  { v: '--text-dim',    label: 'Muted text',             desc: 'Labels, placeholders, secondary' },
  { v: '--text-bright', label: 'Bright text',            desc: 'Headings, emphasis' },
  { v: '--accent',      label: 'Accent',                 desc: 'Primary highlight / interactive' },
  { v: '--accent-dim',  label: 'Accent (dim)',           desc: 'Accent fills and hover states' },
  { v: '--green',       label: 'Green',                  desc: 'Success, online, powered' },
  { v: '--red',         label: 'Red',                    desc: 'Danger, errors, offline' },
  { v: '--orange',      label: 'Orange',                 desc: 'Warnings, overload' },
  { v: '--yellow',      label: 'Yellow',                 desc: 'Caution, loot, highlight' },
  { v: '--purple',      label: 'Purple',                 desc: 'Special, lore, mutations' },
];

// --- Contrast boost helpers ---

function _hexToHsl(hex) {
  let r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min;
  let h=0, s=0, l=(max+min)/2;
  if (d) {
    s = d / (1-Math.abs(2*l-1));
    h = max===r ? ((g-b)/d+6)%6 : max===g ? (b-r)/d+2 : (r-g)/d+4;
    h *= 60;
  }
  return [h, s*100, l*100];
}

function _hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s*Math.min(l,1-l);
  const f = n => { const k=(n+h/30)%12; const c=l-a*Math.max(Math.min(k-3,9-k,1),-1); return Math.round(255*c).toString(16).padStart(2,'0'); };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function _isValidHex(s) { return /^#[0-9a-fA-F]{6}$/.test(s); }

const _BG_VARS  = ['--bg','--bg2','--bg3','--border'];
const _FG_VARS  = ['--text','--text-dim','--text-bright'];
const _COL_VARS = ['--accent','--accent-dim','--green','--red','--orange','--yellow','--purple'];

function _boostContrast(colors, level) {
  if (!level) return colors;
  const t = level / 100;
  const bgHex = colors['--bg'] || '#000000';
  const isDark = _isValidHex(bgHex) ? _hexToHsl(bgHex)[2] < 50 : true;
  const result = { ...colors };

  for (const v of _BG_VARS) {
    if (!result[v] || !_isValidHex(result[v])) continue;
    const [h, s, l] = _hexToHsl(result[v]);
    result[v] = _hslToHex(h, s, l + ((isDark ? 0 : 100) - l) * t * 0.75);
  }
  for (const v of _FG_VARS) {
    if (!result[v] || !_isValidHex(result[v])) continue;
    const [h, s, l] = _hexToHsl(result[v]);
    result[v] = _hslToHex(h, s, l + ((isDark ? 100 : 0) - l) * t * 0.75);
  }
  for (const v of _COL_VARS) {
    if (!result[v] || !_isValidHex(result[v])) continue;
    const [h, s, l] = _hexToHsl(result[v]);
    const newS = Math.min(100, s + (100-s) * t * 0.5);
    const targetL = isDark ? 68 : 32;
    result[v] = _hslToHex(h, newS, l + (targetL-l) * t * 0.5);
  }
  return result;
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS, audio: { ...DEFAULT_AUDIO_SETTINGS } };
    const stored = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...stored, audio: { ...DEFAULT_AUDIO_SETTINGS, ...(stored.audio || {}) } };
  } catch {
    return { ...DEFAULT_SETTINGS, audio: { ...DEFAULT_AUDIO_SETTINGS } };
  }
}

export function saveSettings(settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}

function _getBuiltinThemeColors(themeId) {
  const el = document.createElement('div');
  el.setAttribute('data-theme', themeId);
  el.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;left:-9999px';
  document.body.appendChild(el);
  const cs = getComputedStyle(el);
  const fallback = getComputedStyle(document.documentElement);
  const colors = {};
  THEME_COLOR_VARS.forEach(({ v }) => {
    colors[v] = cs.getPropertyValue(v).trim() || fallback.getPropertyValue(v).trim();
  });
  document.body.removeChild(el);
  return colors;
}

function _getThemeColors(themeId, settings) {
  const custom = (settings.customThemes || []).find(t => t.id === themeId);
  return custom ? { ...custom.colors } : _getBuiltinThemeColors(themeId);
}

function _populateThemeDropdown(settings) {
  const sel = document.getElementById('opt-theme');
  if (!sel) return;
  const custom = settings.customThemes || [];
  const lightOpts = LIGHT_THEMES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  const darkOpts = DARK_THEMES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  sel.innerHTML = `<optgroup label="Light Themes">${lightOpts}</optgroup><optgroup label="Dark Themes">${darkOpts}</optgroup>` +
    (custom.length ? `<optgroup label="Custom">${custom.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}</optgroup>` : '');
  sel.value = settings.theme || 'dark';
}

export function applySettings(settings) {
  const customTheme = (settings.customThemes || []).find(t => t.id === settings.theme);
  document.documentElement.setAttribute('data-theme', customTheme ? 'dark' : (settings.theme || 'dark'));
  document.documentElement.setAttribute('data-density', settings.density || 'comfortable');
  document.documentElement.setAttribute('data-sidebar', settings.sidebarPosition || 'left');
  document.documentElement.setAttribute('data-motion', settings.motion || 'on');
  document.documentElement.style.setProperty('--font-size-base', (settings.fontSize || '14') + 'px');

  // Apply active custom theme colors, or any in-progress editor colors, then contrast boost
  const baseColors = customTheme ? customTheme.colors : (settings.customColors || {});
  const contrastLevel = settings._contrastPreview != null ? settings._contrastPreview : (settings.contrast || 0);
  // Resolve the full color set for boosting (need all vars, not just overrides)
  let allColors = {};
  if (Object.keys(baseColors).length === THEME_COLOR_VARS.length) {
    allColors = baseColors;
  } else {
    allColors = _getThemeColors(customTheme ? customTheme.id : (settings.theme || 'dark'), settings);
    Object.assign(allColors, baseColors);
  }
  const boosted = _boostContrast(allColors, contrastLevel);
  const colors = Object.keys(baseColors).length ? boosted : (contrastLevel ? boosted : baseColors);
  THEME_COLOR_VARS.forEach(({ v }) => {
    if (colors[v]) document.documentElement.style.setProperty(v, colors[v]);
    else document.documentElement.style.removeProperty(v);
  });

  _populateThemeDropdown(settings);

  const _cs = document.getElementById('opt-contrast');
  const _cl = document.getElementById('contrast-value-label');
  const _cv = settings._contrastPreview != null ? settings._contrastPreview : (settings.contrast || 0);
  if (_cs && _cs.value !== String(_cv)) _cs.value = _cv;
  if (_cl) _cl.textContent = _cv === 0 ? 'Base' : `+${_cv}%`;

  for (const group of ['fontsize', 'density', 'sidebar', 'motion', 'tempunit']) {
    const container = document.getElementById(`opt-${group}`);
    if (!container) continue;
    const key = group === 'fontsize' ? 'fontSize' : group === 'sidebar' ? 'sidebarPosition' : group === 'tempunit' ? 'tempUnit' : group;
    container.querySelectorAll('.settings-opt').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.value === String(settings[key]));
    });
  }

  const audio = settings.audio || DEFAULT_AUDIO_SETTINGS;
  window.AudioEngine?.applyVolumeSettings(audio);
  for (const toggle of ['music', 'sfx', 'tv', 'muteWhenHidden']) {
    const container = document.getElementById(`opt-audio-${toggle}`);
    if (!container) continue;
    container.querySelectorAll('.settings-opt').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.value === String(audio[toggle]));
    });
  }
  for (const slider of ['masterVolume', 'musicVolume', 'sfxVolume', 'ambientVolume', 'tvVolume']) {
    const el = document.getElementById(`opt-${slider}`);
    const label = document.getElementById(`${slider}-label`);
    if (el && el.value !== String(audio[slider])) el.value = audio[slider];
    if (label) label.textContent = `${Math.round((audio[slider] ?? 0) * 100)}%`;
  }
}

export function initSettingsUI(settings, saveAndApply, { getOrigin, saveOrigin, sendCmd, notify } = {}) {
  const themeSelect = document.getElementById('opt-theme');
  if (themeSelect) {
    themeSelect.addEventListener('change', () => {
      settings.theme = themeSelect.value;
      settings.customColors = {};
      saveAndApply();
    });
  }

  const editBtn = document.getElementById('theme-edit-btn');
  if (editBtn) editBtn.addEventListener('click', () => openThemeEditor(settings, saveAndApply));

  document.querySelectorAll('#opt-fontsize .settings-opt').forEach(btn => {
    btn.addEventListener('click', () => { settings.fontSize = btn.dataset.value; saveAndApply(); });
  });
  document.querySelectorAll('#opt-density .settings-opt').forEach(btn => {
    btn.addEventListener('click', () => { settings.density = btn.dataset.value; saveAndApply(); });
  });
  document.querySelectorAll('#opt-sidebar .settings-opt').forEach(btn => {
    btn.addEventListener('click', () => { settings.sidebarPosition = btn.dataset.value; saveAndApply(); });
  });
  document.querySelectorAll('#opt-motion .settings-opt').forEach(btn => {
    btn.addEventListener('click', () => { settings.motion = btn.dataset.value; saveAndApply(); });
  });
  document.querySelectorAll('#opt-tempunit .settings-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      settings.tempUnit = btn.dataset.value;
      saveAndApply();
      if (notify) {
        const label = btn.dataset.value === 'F' ? 'F°reedom' : 'C°ommunism';
        notify(`${label} units enabled!`);
      }
    });
  });

  const contrastSlider = document.getElementById('opt-contrast');
  const contrastLabel  = document.getElementById('contrast-value-label');
  const contrastSave   = document.getElementById('contrast-save-btn');
  const contrastRestore = document.getElementById('contrast-restore-btn');

  function _contrastLabelText(v) { return v === 0 ? 'Base' : `+${v}%`; }

  if (contrastSlider) {
    contrastSlider.value = settings.contrast || 0;
    if (contrastLabel) contrastLabel.textContent = _contrastLabelText(settings.contrast || 0);

    contrastSlider.addEventListener('input', () => {
      const val = parseInt(contrastSlider.value, 10);
      if (contrastLabel) contrastLabel.textContent = _contrastLabelText(val);
      settings._contrastPreview = val;
      saveAndApply();
    });
  }
  if (contrastSave) {
    contrastSave.addEventListener('click', () => {
      const val = parseInt(contrastSlider?.value ?? 0, 10);
      settings.contrast = val;
      delete settings._contrastPreview;
      saveAndApply();
    });
  }
  if (contrastRestore) {
    contrastRestore.addEventListener('click', () => {
      settings.contrast = 0;
      delete settings._contrastPreview;
      if (contrastSlider) contrastSlider.value = 0;
      if (contrastLabel) contrastLabel.textContent = 'Base';
      saveAndApply();
    });
  }

  for (const toggle of ['music', 'sfx', 'tv', 'muteWhenHidden']) {
    document.querySelectorAll(`#opt-audio-${toggle} .settings-opt`).forEach(btn => {
      btn.addEventListener('click', () => {
        if (!settings.audio) settings.audio = { ...DEFAULT_AUDIO_SETTINGS };
        settings.audio[toggle] = btn.dataset.value === 'true';
        saveAndApply();
      });
    });
  }
  for (const slider of ['masterVolume', 'musicVolume', 'sfxVolume', 'ambientVolume', 'tvVolume']) {
    const el = document.getElementById(`opt-${slider}`);
    if (!el) continue;
    el.addEventListener('input', () => {
      if (!settings.audio) settings.audio = { ...DEFAULT_AUDIO_SETTINGS };
      settings.audio[slider] = parseFloat(el.value);
      saveAndApply();
    });
  }

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


  document.getElementById('settings-btn').addEventListener('click', () => {
    if (originArea && getOrigin) {
      const val = getOrigin();
      originArea.value = val;
      originCounter.textContent = `${val.length} / 200`;
    }
    applySettings(settings);
    document.getElementById('settings-panel').classList.add('active');
  });
  function closeSettings() {
    // If contrast was dragged but not saved, revert to the saved value
    if (settings._contrastPreview != null) {
      delete settings._contrastPreview;
      if (contrastSlider) contrastSlider.value = settings.contrast || 0;
      if (contrastLabel) contrastLabel.textContent = _contrastLabelText(settings.contrast || 0);
      saveAndApply();
    }
    document.getElementById('settings-panel').classList.remove('active');
    const decoy = document.getElementById('debug-decoy');
    const label = document.getElementById('debug-label');
    const input = document.getElementById('settings-debug');
    if (decoy) decoy.style.display = '';
    if (label) label.style.display = 'none';
    if (input) input.style.display = 'none';
  }
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('settings-panel').addEventListener('click', (e) => {
    if (e.target.id === 'settings-panel') closeSettings();
  });

  document.getElementById('map-close').addEventListener('click', () => {
    document.getElementById('map-panel').classList.remove('active');
  });
  document.getElementById('map-panel').addEventListener('click', (e) => {
    if (e.target.id === 'map-panel') document.getElementById('map-panel').classList.remove('active');
  });
}

export function listenForSettingsChanges(applyFn) {
  window.addEventListener('storage', e => {
    if (e.key !== SETTINGS_KEY) return;
    applyFn(loadSettings());
  });
}

// --- Theme Editor (game client) ---

let _teSettings = null;
let _teSaveAndApply = null;
let _teEditingId = null;

export function openThemeEditor(settings, saveAndApply) {
  _teSettings = settings;
  _teSaveAndApply = saveAndApply;
  const overlay = document.getElementById('theme-editor-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  _tePopulateBaseDropdown();
  const baseId = settings.theme || 'dark';
  document.getElementById('te-base-select').value = baseId;
  _teLoadBase(baseId);
}

function _tePopulateBaseDropdown() {
  const sel = document.getElementById('te-base-select');
  if (!sel) return;
  const custom = _teSettings.customThemes || [];
  const lightOpts = LIGHT_THEMES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  const darkOpts = DARK_THEMES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  sel.innerHTML = `<optgroup label="Light Themes">${lightOpts}</optgroup><optgroup label="Dark Themes">${darkOpts}</optgroup>` +
    (custom.length ? `<optgroup label="Custom Themes">${custom.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}</optgroup>` : '');
}

function _teGetCurrentColor(v) {
  const editing = (_teSettings.customColors || {})[v];
  if (editing) return editing;
  return getComputedStyle(document.documentElement).getPropertyValue(v).trim();
}

function _teLoadBase(themeId) {
  _teEditingId = themeId;
  const colors = _getThemeColors(themeId, _teSettings);
  const editColors = {};
  THEME_COLOR_VARS.forEach(({ v }) => {
    const val = colors[v] || '';
    editColors[v] = val;
    if (val) document.documentElement.style.setProperty(v, val);
    else document.documentElement.style.removeProperty(v);
  });
  _teSettings.customColors = editColors;
  _teSaveAndApply();

  const customTheme = (_teSettings.customThemes || []).find(t => t.id === themeId);
  const nameEl = document.getElementById('te-name');
  const delBtn = document.getElementById('te-delete-btn');
  if (nameEl) nameEl.value = customTheme ? customTheme.name : '';
  if (delBtn) delBtn.style.display = customTheme ? '' : 'none';

  _teRenderRows();
}

function _teRenderRows() {
  const container = document.getElementById('theme-editor-rows');
  if (!container) return;
  container.innerHTML = THEME_COLOR_VARS.map(({ v, label, desc }) => {
    const val = _teGetCurrentColor(v);
    const safe = v.replace(/[^a-z-]/g, '');
    return `<div style="display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-size:12px;color:var(--text)">${label}</div>
        <div style="font-size:10px;color:var(--text-dim)">${desc}</div>
      </div>
      <div>
        <input type="text" data-var="${v}" data-safe="${safe}" class="te-hex" value="${val}" maxlength="7"
          style="width:76px;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:4px 6px;border-radius:2px;letter-spacing:1px">
      </div>
      <div style="position:relative;width:28px;height:28px">
        <div data-safe="${safe}" class="te-swatch"
          style="width:28px;height:28px;border-radius:3px;border:1px solid var(--border);cursor:pointer;background:${val}"></div>
        <input type="color" data-var="${v}" data-safe="${safe}" class="te-picker" value="${val.startsWith('#') ? val : '#888888'}"
          style="position:absolute;opacity:0;width:0;height:0;pointer-events:none">
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.te-hex').forEach(input => {
    input.addEventListener('input', () => {
      const raw = input.value;
      const val = raw.startsWith('#') ? raw : '#' + raw;
      if (!/^#[0-9a-fA-F]{6}$/.test(val)) return;
      _teApplyColor(input.dataset.safe, input.dataset.var, val);
    });
  });
  container.querySelectorAll('.te-picker').forEach(picker => {
    picker.addEventListener('input', () => {
      const hex = container.querySelector(`.te-hex[data-safe="${picker.dataset.safe}"]`);
      if (hex) hex.value = picker.value;
      _teApplyColor(picker.dataset.safe, picker.dataset.var, picker.value);
    });
  });
  container.querySelectorAll('.te-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      const picker = container.querySelector(`.te-picker[data-safe="${swatch.dataset.safe}"]`);
      if (picker) picker.click();
    });
  });
}

function _teApplyColor(safe, varName, val) {
  document.documentElement.style.setProperty(varName, val);
  const swatch = document.querySelector(`.te-swatch[data-safe="${safe}"]`);
  if (swatch) swatch.style.background = val;
  if (!_teSettings.customColors) _teSettings.customColors = {};
  _teSettings.customColors[varName] = val;
  _teSaveAndApply();
}

function _teSaveTheme() {
  const nameEl = document.getElementById('te-name');
  const name = nameEl ? nameEl.value.trim() : '';
  if (!name) { alert('Enter a theme name first'); return; }
  const colors = {};
  THEME_COLOR_VARS.forEach(({ v }) => { colors[v] = _teGetCurrentColor(v); });
  if (!_teSettings.customThemes) _teSettings.customThemes = [];
  const existing = _teSettings.customThemes.find(t => t.id === _teEditingId);
  if (existing) {
    existing.name = name;
    existing.colors = colors;
  } else {
    const id = 'cthm_' + Date.now();
    _teSettings.customThemes.push({ id, name, colors });
    _teSettings.theme = id;
    _teEditingId = id;
  }
  _teSettings.customColors = {};
  _teSaveAndApply();
  _tePopulateBaseDropdown();
  document.getElementById('te-base-select').value = _teEditingId;
  const delBtn = document.getElementById('te-delete-btn');
  if (delBtn) delBtn.style.display = '';
}

function _teDeleteTheme() {
  const customThemes = _teSettings.customThemes || [];
  const idx = customThemes.findIndex(t => t.id === _teEditingId);
  if (idx === -1) return;
  const name = customThemes[idx].name;
  if (!confirm(`Delete custom theme "${name}"?`)) return;
  customThemes.splice(idx, 1);
  _teSettings.customThemes = customThemes;
  if (_teSettings.theme === _teEditingId) _teSettings.theme = 'dark';
  _teSettings.customColors = {};
  _teSaveAndApply();
  _teEditingId = null;
  _tePopulateBaseDropdown();
  const nextId = _teSettings.theme || 'dark';
  document.getElementById('te-base-select').value = nextId;
  _teLoadBase(nextId);
}

function _teResetToBase() {
  const baseId = document.getElementById('te-base-select')?.value || 'dark';
  _teLoadBase(baseId);
}

export function initThemeEditorOverlay() {
  const overlay = document.getElementById('theme-editor-overlay');
  if (!overlay) return;

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeThemeEditor(); });
  document.getElementById('te-close-btn')?.addEventListener('click', closeThemeEditor);
  document.getElementById('te-close-btn2')?.addEventListener('click', closeThemeEditor);
  document.getElementById('te-base-select')?.addEventListener('change', (e) => _teLoadBase(e.target.value));
  document.getElementById('te-save-btn')?.addEventListener('click', _teSaveTheme);
  document.getElementById('te-delete-btn')?.addEventListener('click', _teDeleteTheme);
  document.getElementById('te-reset-btn')?.addEventListener('click', _teResetToBase);
}

function closeThemeEditor() {
  const overlay = document.getElementById('theme-editor-overlay');
  if (overlay) overlay.style.display = 'none';
  // Discard unsaved color edits — restore to the saved theme state
  if (_teSettings) {
    _teSettings.customColors = {};
    if (_teSaveAndApply) _teSaveAndApply();
  }
}

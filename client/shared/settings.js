const SETTINGS_KEY = 'architect_settings';
const DEFAULT_AUDIO_SETTINGS = { enabled: false, music: false, sfx: false, tv: false, masterVolume: 0.8, musicVolume: 0.7, sfxVolume: 0.9, ambientVolume: 0.5, tvVolume: 0.6, muteWhenHidden: true };
const DEFAULT_SETTINGS = { theme: 'dark', fontSize: '14', density: 'comfortable', sidebarPosition: 'left', motion: 'on', weatherFx: 'on', tempUnit: 'C', contrast: 0, dpadSize: 'small', pokerFelt: 'green', pokerFeltColor: '#1a4a1a', audio: DEFAULT_AUDIO_SETTINGS };

const DEFAULT_FELT_GREEN = '#1a4a1a';

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
  ['latte','Latte'],['rose','Rosewater'],['papertape','Papertape'],['bubblegum','Bubblegum'],
];
const DARK_THEMES = [
  ['dark','Void'],['eclipse','Eclipse'],['iron','Iron'],
  ['contrast','Terminal'],['phosphor','Phosphor Green'],['synthwave','Synthwave'],['bloodmoon','Blood Moon'],['slate','Slate'],
  ['aurora','Aurora'],['neon','Neon'],['cathode','Cathode'],['grove','Grove'],
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

// Mute a colour toward a felt-friendly tone, keeping its hue. Only ever darkens
// and desaturates (caps L and S), so an already-muted colour passes through
// unchanged — bright theme accents get tamed, dark ones are left alone.
function _dampenFelt(hex) {
  if (!_isValidHex(hex)) return hex;
  const [h, s, l] = _hexToHsl(hex);
  return _hslToHex(h, Math.min(s, 60), Math.min(l, 26));
}

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

function _activeThemeName(settings) {
  const id = settings.theme || 'dark';
  const builtin = BUILTIN_THEMES.find(([v]) => v === id);
  if (builtin) return builtin[1];
  const custom = (settings.customThemes || []).find(t => t.id === id);
  return custom ? custom.name : id;
}

function _getThemeColors(themeId, settings) {
  const custom = (settings.customThemes || []).find(t => t.id === themeId);
  return custom ? { ...custom.colors } : _getBuiltinThemeColors(themeId);
}

// --- Theme swatch picker ---
// Colours shown as dots on each chip. Read live from the rendered CSS so new
// (and custom) themes get an accurate swatch with zero extra bookkeeping.
const _CHIP_DOT_VARS = ['--accent', '--green', '--red', '--orange', '--yellow', '--purple'];
const _CHIP_FRAME_VARS = ['--bg', '--border'];

// Probe a theme's actual colours off the DOM. Pass { id } for a built-in
// (renders a hidden [data-theme] node) or { colors } for a custom theme
// (applies its overrides on a dark base, then reads back).
function _probeThemeVars(theme) {
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;left:-9999px';
  if (theme.colors) {
    el.setAttribute('data-theme', 'dark');
    Object.entries(theme.colors).forEach(([k, v]) => el.style.setProperty(k, v));
  } else {
    el.setAttribute('data-theme', theme.id);
  }
  document.body.appendChild(el);
  const cs = getComputedStyle(el);
  const out = {};
  [..._CHIP_FRAME_VARS, ..._CHIP_DOT_VARS].forEach(v => { out[v] = cs.getPropertyValue(v).trim(); });
  document.body.removeChild(el);
  return out;
}

function _themeChipHTML(value, label, colors, active) {
  const dots = _CHIP_DOT_VARS.map(v => `<span class="theme-dot" style="background:${colors[v] || 'transparent'}"></span>`).join('');
  return `<button type="button" class="theme-chip${active ? ' selected' : ''}" data-value="${value}" role="option" aria-selected="${active}" title="${label}">` +
    `<span class="theme-chip-prev" style="background:${colors['--bg']};border-color:${colors['--border']}">${dots}</span>` +
    `<span class="theme-chip-name">${label}</span></button>`;
}

function _populateThemeGrid(settings) {
  const grid = document.getElementById('opt-theme-grid');
  if (!grid) return;
  const active = settings.theme || 'dark';
  const section = (title, items) =>
    `<div class="theme-grid-head">${title}</div><div class="theme-grid">` +
    items.map(([v, l]) => _themeChipHTML(v, l, _probeThemeVars({ id: v }), v === active)).join('') +
    `</div>`;
  let html = section('Dark', DARK_THEMES) + section('Light', LIGHT_THEMES);
  const custom = settings.customThemes || [];
  if (custom.length) {
    html += `<div class="theme-grid-head">Custom</div><div class="theme-grid">` +
      custom.map(t => _themeChipHTML(t.id, t.name, _probeThemeVars({ colors: t.colors }), t.id === active)).join('') +
      `</div>`;
  }
  grid.innerHTML = html;
}

export function applySettings(settings) {
  const customTheme = (settings.customThemes || []).find(t => t.id === settings.theme);
  document.documentElement.setAttribute('data-theme', customTheme ? 'dark' : (settings.theme || 'dark'));
  document.documentElement.setAttribute('data-density', settings.density || 'comfortable');
  document.documentElement.setAttribute('data-sidebar', settings.sidebarPosition || 'left');
  document.documentElement.setAttribute('data-motion', settings.motion || 'on');
  document.documentElement.setAttribute('data-dpad-size', settings.dpadSize || 'small');
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

  // Poker felt colour: classic green, the theme accent (dampened to a felt tone
  // so bright accents don't glare), or a custom pick (used exactly as chosen).
  // CSS mixes darker/lighter shades from this single base.
  const feltMode = settings.pokerFelt || 'green';
  let feltColor = DEFAULT_FELT_GREEN;
  if (feltMode === 'accent') {
    const accentRaw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    feltColor = _isValidHex(accentRaw) ? _dampenFelt(accentRaw) : 'var(--accent)';
  } else if (feltMode === 'custom' && _isValidHex(settings.pokerFeltColor || '')) {
    feltColor = settings.pokerFeltColor;
  }
  document.documentElement.style.setProperty('--poker-felt', feltColor);
  const feltGroup = document.getElementById('opt-pokerfelt');
  if (feltGroup) {
    feltGroup.querySelectorAll('.settings-opt').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.value === feltMode);
    });
  }
  const feltColorInput = document.getElementById('opt-pokerfelt-color');
  if (feltColorInput && _isValidHex(settings.pokerFeltColor || '') && feltColorInput.value !== settings.pokerFeltColor) {
    feltColorInput.value = settings.pokerFeltColor;
  }

  _populateThemeGrid(settings);

  const _tn = document.getElementById('active-theme-name');
  if (_tn) _tn.textContent = _activeThemeName(settings);

  const _cs = document.getElementById('opt-contrast');
  const _cl = document.getElementById('contrast-value-label');
  const _cv = settings._contrastPreview != null ? settings._contrastPreview : (settings.contrast || 0);
  if (_cs && _cs.value !== String(_cv)) _cs.value = _cv;
  if (_cl) _cl.textContent = _cv === 0 ? 'Base' : `+${_cv}%`;

  for (const group of ['fontsize', 'density', 'sidebar', 'motion', 'weatherfx', 'tempunit', 'dpadsize']) {
    const container = document.getElementById(`opt-${group}`);
    if (!container) continue;
    const key = group === 'fontsize' ? 'fontSize' : group === 'sidebar' ? 'sidebarPosition' : group === 'tempunit' ? 'tempUnit' : group === 'dpadsize' ? 'dpadSize' : group === 'weatherfx' ? 'weatherFx' : group;
    container.querySelectorAll('.settings-opt').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.value === String(settings[key]));
    });
  }

  // Weather FX overlay gate — off if the setting is off OR Motion is off (the FX
  // is animation). The game client registers the hook; other clients ignore it.
  window._applyWeatherFx?.((settings.weatherFx || 'on') !== 'off' && (settings.motion || 'on') !== 'off');

  const audio = settings.audio || DEFAULT_AUDIO_SETTINGS;
  window.AudioEngine?.applyVolumeSettings(audio);

  // The master Sound switch lives behind the hidden MIS-style reveal in
  // index.html (its own inline <script>, not this module) — sync its visual
  // state here too so it doesn't go stale on cross-tab updates or anything
  // else that calls applySettings() without going through that inline script.
  const soundCheckbox = document.getElementById('settings-sound-enabled');
  if (soundCheckbox && soundCheckbox.checked !== !!audio.enabled) {
    soundCheckbox.checked = !!audio.enabled;
    const track = document.getElementById('sound-slider-track');
    const thumb = document.getElementById('sound-slider-thumb');
    if (track) track.style.background = audio.enabled ? 'var(--accent)' : 'var(--border)';
    if (thumb) {
      thumb.style.left = audio.enabled ? '19px' : '3px';
      thumb.style.background = audio.enabled ? '#000' : 'var(--text-dim)';
    }
  }

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

export function initSettingsUI(settings, saveAndApply, { sendCmd, notify } = {}) {
  const themeGrid = document.getElementById('opt-theme-grid');
  if (themeGrid) {
    themeGrid.addEventListener('click', (e) => {
      const chip = e.target.closest('.theme-chip');
      if (!chip || !themeGrid.contains(chip)) return;
      settings.theme = chip.dataset.value;
      settings.customColors = {};
      _teEditLoaded = false;
      saveAndApply();
    });
  }

  const openBtn = document.getElementById('theme-open-btn');
  if (openBtn) openBtn.addEventListener('click', () => openThemeEditor(settings, saveAndApply));

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
  document.querySelectorAll('#opt-weatherfx .settings-opt').forEach(btn => {
    btn.addEventListener('click', () => { settings.weatherFx = btn.dataset.value; saveAndApply(); });
  });
  document.querySelectorAll('#opt-dpadsize .settings-opt').forEach(btn => {
    btn.addEventListener('click', () => { settings.dpadSize = btn.dataset.value; saveAndApply(); });
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

  document.querySelectorAll('#opt-pokerfelt .settings-opt').forEach(btn => {
    btn.addEventListener('click', () => { settings.pokerFelt = btn.dataset.value; saveAndApply(); });
  });
  const pokerFeltColor = document.getElementById('opt-pokerfelt-color');
  if (pokerFeltColor) {
    pokerFeltColor.addEventListener('input', () => {
      settings.pokerFeltColor = pokerFeltColor.value;
      settings.pokerFelt = 'custom';
      saveAndApply();
    });
  }

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

  document.getElementById('settings-btn').addEventListener('click', () => {
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
let _teEditLoaded = false;

export function openThemeEditor(settings, saveAndApply) {
  _teSettings = settings;
  _teSaveAndApply = saveAndApply;
  const overlay = document.getElementById('theme-editor-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  _teEditLoaded = false;
  _populateThemeGrid(settings);
  _teShowTab('swatches');
}

// Swatches (theme picker) is the default view; the Edit pane lazy-loads the
// current theme's colours the first time it's revealed this session.
function _teShowTab(name) {
  const editing = name === 'edit';
  if (editing && !_teEditLoaded) {
    _teEditLoaded = true;
    _tePopulateBaseDropdown();
    const baseId = _teSettings.theme || 'dark';
    const sel = document.getElementById('te-base-select');
    if (sel) sel.value = baseId;
    _teLoadBase(baseId);
  }
  const sw = document.getElementById('te-pane-swatches');
  const ed = document.getElementById('te-pane-edit');
  if (sw) sw.style.display = editing ? 'none' : 'block';
  if (ed) ed.style.display = editing ? 'flex' : 'none';
  const tsw = document.getElementById('te-tab-swatches');
  const ted = document.getElementById('te-tab-edit');
  if (tsw) { tsw.style.color = editing ? 'var(--text-dim)' : 'var(--accent)'; tsw.style.borderBottomColor = editing ? 'transparent' : 'var(--accent)'; }
  if (ted) { ted.style.color = editing ? 'var(--accent)' : 'var(--text-dim)'; ted.style.borderBottomColor = editing ? 'var(--accent)' : 'transparent'; }
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
    return `<div style="display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-size:12px;color:var(--text)">${label}</div>
        <div style="font-size:10px;color:var(--text-dim)">${desc}</div>
      </div>
      <div>
        <input type="text" data-var="${v}" data-safe="${safe}" class="te-hex" value="${val}" maxlength="7"
          style="width:70px;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:3px 6px;border-radius:2px;letter-spacing:1px">
      </div>
      <div style="position:relative;width:24px;height:24px">
        <div data-safe="${safe}" class="te-swatch"
          style="width:24px;height:24px;border-radius:3px;border:1px solid var(--border);cursor:pointer;background:${val}"></div>
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

// Make a floating window draggable by a handle, clamped to the viewport.
function _makeDraggable(win, handle) {
  if (!win || !handle || handle._dragBound) return;
  handle._dragBound = true;
  handle.addEventListener('mousedown', (e) => {
    if (e.target.closest('button,select,input')) return;
    e.preventDefault();
    const rect = win.getBoundingClientRect();
    const offX = e.clientX - rect.left, offY = e.clientY - rect.top;
    win.style.right = 'auto';
    const move = (ev) => {
      const x = Math.max(0, Math.min(ev.clientX - offX, window.innerWidth - 40));
      const y = Math.max(0, Math.min(ev.clientY - offY, window.innerHeight - 40));
      win.style.left = x + 'px';
      win.style.top = y + 'px';
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

export function initThemeEditorOverlay() {
  const overlay = document.getElementById('theme-editor-overlay');
  if (!overlay) return;

  _makeDraggable(document.getElementById('te-window'), document.getElementById('te-drag-header'));
  document.getElementById('te-tab-swatches')?.addEventListener('click', () => _teShowTab('swatches'));
  document.getElementById('te-tab-edit')?.addEventListener('click', () => _teShowTab('edit'));
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

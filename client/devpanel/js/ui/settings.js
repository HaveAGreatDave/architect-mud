const SHARED_SETTINGS_KEY = 'architect_settings';
function loadDevSettings() { try { return JSON.parse(localStorage.getItem(SHARED_SETTINGS_KEY) || '{}'); } catch { return {}; } }
function saveDevSettings(s) { try { const merged = { ...loadDevSettings(), ...s }; localStorage.setItem(SHARED_SETTINGS_KEY, JSON.stringify(merged)); } catch {} }
let devSettings = loadDevSettings();

const POWER_STATUS_RGBA = {
  powered:   [20,  200, 100, 0.22],
  overloaded:[255, 165, 0,   0.28],
  offline:   [220, 40,  60,  0.32],
  unpowered: [30,  30,  50,  0.65],
  plant:     [80,  160, 255, 0.28],
};

function powerTileTextColor(status) {
  const [sr, sg, sb, sa] = POWER_STATUS_RGBA[status] || POWER_STATUS_RGBA.unpowered;
  const bgCss = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const bh = bgCss.replace('#', '');
  const br = parseInt(bh.slice(0,2),16), bg = parseInt(bh.slice(2,4),16), bb = parseInt(bh.slice(4,6),16);
  const r = sr * sa + br * (1 - sa);
  const g = sg * sa + bg * (1 - sa);
  const b = sb * sa + bb * (1 - sa);
  const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
  return lum < 0.5 ? 'rgb(240,240,240)' : 'rgb(20,20,20)';
}

function repaintPowerTileColors() {
  document.querySelectorAll('.bigmap-tile[class*="bm-power-"]').forEach(tile => {
    const match = tile.className.match(/bm-power-(\w+)/);
    if (match) tile.style.color = powerTileTextColor(match[1]);
  });
}

const LIGHT_THEMES = [
  ['light','Parchment'],['inkwell','Inkwell'],['studio','Studio'],
  ['arctic','Arctic'],['solar','Solar'],['mint','Mint'],['lavender','Lavender'],['fog','Fog'],
];
const DARK_THEMES = [
  ['dark','Void'],['eclipse','Eclipse'],['iron','Iron'],
  ['contrast','Terminal'],['phosphor','Phosphor Green'],['synthwave','Synthwave'],['bloodmoon','Blood Moon'],['slate','Slate'],
];
const BUILTIN_THEME_VALUES = [...LIGHT_THEMES, ...DARK_THEMES].map(([v]) => v);

function populateThemeDropdown() {
  const sel = document.getElementById('dev-opt-theme');
  if (!sel) return;
  const custom = (devSettings.customThemes || []);
  const lightOpts = LIGHT_THEMES.map(([v,l]) => `<option value="${v}">${l}</option>`).join('');
  const darkOpts = DARK_THEMES.map(([v,l]) => `<option value="${v}">${l}</option>`).join('');
  sel.innerHTML = `<optgroup label="Light Themes">${lightOpts}</optgroup><optgroup label="Dark Themes">${darkOpts}</optgroup>` +
    (custom.length ? `<optgroup label="Custom Themes">${custom.map(t =>
      `<option value="${t.id}">${t.name}</option>`).join('')}</optgroup>` : '');
  sel.value = devSettings.theme || 'dark';
}

function applyDevSettings() {
  const themeId = devSettings.theme || 'dark';
  const fontSize = devSettings.fontSize || '14';
  const density = devSettings.density || 'comfortable';
  const motion = devSettings.motion || 'on';
  const tempUnit = devSettings.tempUnit || 'C';

  const customTheme = (devSettings.customThemes || []).find(t => t.id === themeId);
  document.documentElement.setAttribute('data-theme', customTheme ? 'dark' : themeId);
  document.documentElement.setAttribute('data-density', density);
  document.documentElement.setAttribute('data-motion', motion);
  document.documentElement.style.setProperty('--font-size-base', fontSize + 'px');

  populateThemeDropdown();

  document.querySelectorAll('#dev-opt-fontsize .dev-settings-opt').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.value === String(fontSize));
  });
  document.querySelectorAll('#dev-opt-density .dev-settings-opt').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.value === density);
  });
  document.querySelectorAll('#dev-opt-motion .dev-settings-opt').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.value === motion);
  });
  document.querySelectorAll('#dev-opt-tempunit .dev-settings-opt').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.value === tempUnit);
  });

  const contrastLevel = devSettings._contrastPreview != null ? devSettings._contrastPreview : (devSettings.contrast || 0);
  const contrastSlider = document.getElementById('dev-opt-contrast');
  const contrastLabel = document.getElementById('dev-contrast-label');
  if (contrastSlider && contrastSlider.value !== String(contrastLevel)) contrastSlider.value = contrastLevel;
  if (contrastLabel) contrastLabel.textContent = contrastLevel === 0 ? 'Base' : `+${contrastLevel}%`;

  const baseColors = customTheme ? customTheme.colors : (devSettings.customColors || {});
  let allColors = _getBuiltinThemeColors(customTheme ? customTheme.id : themeId);
  Object.assign(allColors, baseColors);
  const boosted = _boostContrast(allColors, contrastLevel);
  const colors = contrastLevel ? boosted : baseColors;
  THEME_COLOR_VARS.forEach(({ v }) => {
    if (colors[v]) document.documentElement.style.setProperty(v, colors[v]);
    else document.documentElement.style.removeProperty(v);
  });

  repaintPowerTileColors();
}
// --- Contrast boost helpers (mirrors shared/settings.js) ---
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

// Must be defined before applyDevSettings() is called (const is not hoisted)
let _themeEditorEditingId = null;

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
  { v: '--yellow',      label: 'Yellow',                 desc: 'Caution, highlights' },
  { v: '--cyan',        label: 'Cyan',                   desc: 'Info, links, window light' },
  { v: '--purple',      label: 'Purple',                 desc: 'Special, lore, mutations' },
];


// --- Theme Editor ---

function _themeEditorCurrentValue(v) {
  const custom = (devSettings.customColors || {})[v];
  if (custom) return custom;
  return getComputedStyle(document.documentElement).getPropertyValue(v).trim();
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

function _populateThemeEditorDropdown() {
  const sel = document.getElementById('theme-editor-base');
  if (!sel) return;
  const custom = devSettings.customThemes || [];
  const lightOpts = LIGHT_THEMES.map(([v,l]) => `<option value="${v}">${l}</option>`).join('');
  const darkOpts  = DARK_THEMES.map(([v,l])  => `<option value="${v}">${l}</option>`).join('');
  sel.innerHTML = `<optgroup label="Light Themes">${lightOpts}</optgroup><optgroup label="Dark Themes">${darkOpts}</optgroup>` +
    (custom.length ? `<optgroup label="Custom Themes">${custom.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}</optgroup>` : '');
}

function _loadBaseTheme(themeId) {
  _themeEditorEditingId = themeId;
  const customTheme = (devSettings.customThemes || []).find(t => t.id === themeId);
  const colors = customTheme ? { ...customTheme.colors } : _getBuiltinThemeColors(themeId);
  const editColors = {};
  THEME_COLOR_VARS.forEach(({ v }) => {
    const val = colors[v] || '';
    editColors[v] = val;
    if (val) document.documentElement.style.setProperty(v, val);
    else document.documentElement.style.removeProperty(v);
  });
  devSettings.customColors = editColors;
  saveDevSettings(devSettings);
  const nameEl = document.getElementById('theme-editor-name');
  const delBtn = document.getElementById('theme-editor-delete-btn');
  if (nameEl) nameEl.value = customTheme ? customTheme.name : '';
  if (delBtn) delBtn.style.display = customTheme ? '' : 'none';
  _renderThemeEditorRows();
}

function openThemeEditor() {
  const overlay = document.getElementById('theme-editor-overlay');
  overlay.style.display = 'flex';
  _populateThemeEditorDropdown();
  const themeId = devSettings.theme || 'dark';
  document.getElementById('theme-editor-base').value = themeId;
  _loadBaseTheme(themeId);
}

function saveAsCustomTheme() {
  const nameEl = document.getElementById('theme-editor-name');
  const name = nameEl ? nameEl.value.trim() : '';
  if (!name) { toast('Enter a theme name first', true); return; }
  const colors = {};
  THEME_COLOR_VARS.forEach(({ v }) => { colors[v] = _themeEditorCurrentValue(v); });
  if (!devSettings.customThemes) devSettings.customThemes = [];
  const existing = devSettings.customThemes.find(t => t.id === _themeEditorEditingId);
  if (existing) {
    existing.name = name;
    existing.colors = colors;
  } else {
    const id = 'cthm_' + Date.now();
    devSettings.customThemes.push({ id, name, colors });
    devSettings.theme = id;
    _themeEditorEditingId = id;
  }
  devSettings.customColors = {};
  saveDevSettings(devSettings);
  applyDevSettings();
  _populateThemeEditorDropdown();
  document.getElementById('theme-editor-base').value = _themeEditorEditingId;
  const delBtn = document.getElementById('theme-editor-delete-btn');
  if (delBtn) delBtn.style.display = '';
  toast('Theme saved: ' + name);
}

function deleteCustomTheme() {
  const customThemes = devSettings.customThemes || [];
  const idx = customThemes.findIndex(t => t.id === _themeEditorEditingId);
  if (idx === -1) return;
  const name = customThemes[idx].name;
  if (!confirm(`Delete custom theme "${name}"?`)) return;
  customThemes.splice(idx, 1);
  devSettings.customThemes = customThemes;
  if (devSettings.theme === _themeEditorEditingId) devSettings.theme = 'dark';
  devSettings.customColors = {};
  saveDevSettings(devSettings);
  applyDevSettings();
  _themeEditorEditingId = null;
  _populateThemeEditorDropdown();
  const nextId = devSettings.theme || 'dark';
  document.getElementById('theme-editor-base').value = nextId;
  _loadBaseTheme(nextId);
  toast(`Theme "${name}" deleted`);
}

function closeThemeEditor() {
  document.getElementById('theme-editor-overlay').style.display = 'none';
  devSettings.customColors = {};
  saveDevSettings(devSettings);
  applyDevSettings();
}

function _renderThemeEditorRows() {
  const container = document.getElementById('theme-editor-rows');
  container.innerHTML = THEME_COLOR_VARS.map(({ v, label, desc }) => {
    const val = _themeEditorCurrentValue(v);
    const hex = val.startsWith('#') ? val : val;
    const safe = v.replace(/[^a-z-]/g, '');
    return `<div style="display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-size:12px;color:var(--text)">${label}</div>
        <div style="font-size:10px;color:var(--text-dim)">${desc}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <input type="text" id="tce-hex-${safe}" value="${hex}" maxlength="7"
          style="width:76px;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:4px 6px;border-radius:2px;letter-spacing:1px"
          oninput="onThemeColorHexInput('${safe}','${v}',this.value)">
      </div>
      <div style="position:relative;width:28px;height:28px">
        <div id="tce-swatch-${safe}" onclick="document.getElementById('tce-picker-${safe}').click()"
          style="width:28px;height:28px;border-radius:3px;border:1px solid var(--border);cursor:pointer;background:${hex}"></div>
        <input type="color" id="tce-picker-${safe}" value="${hex.startsWith('#') ? hex : '#888888'}"
          style="position:absolute;opacity:0;width:0;height:0;pointer-events:none"
          oninput="onThemeColorPickerInput('${safe}','${v}',this.value)">
      </div>
    </div>`;
  }).join('');
}

function onThemeColorHexInput(safe, varName, raw) {
  const val = raw.startsWith('#') ? raw : '#' + raw;
  if (!/^#[0-9a-fA-F]{6}$/.test(val)) return;
  _applyThemeColorLive(safe, varName, val);
}

function onThemeColorPickerInput(safe, varName, val) {
  const hexEl = document.getElementById('tce-hex-' + safe);
  if (hexEl) hexEl.value = val;
  _applyThemeColorLive(safe, varName, val);
}

function _applyThemeColorLive(safe, varName, val) {
  document.documentElement.style.setProperty(varName, val);
  const swatch = document.getElementById('tce-swatch-' + safe);
  if (swatch) swatch.style.background = val;
  if (!devSettings.customColors) devSettings.customColors = {};
  devSettings.customColors[varName] = val;
  saveDevSettings(devSettings);
}

function resetThemeColors() {
  const baseId = document.getElementById('theme-editor-base')?.value || 'dark';
  _loadBaseTheme(baseId);
}

// --- World state ---
// --- Dashboard ---


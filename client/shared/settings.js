const SETTINGS_KEY = 'architect_settings';
const DEFAULT_SETTINGS = { theme: 'dark', fontSize: '14', density: 'comfortable', sidebarPosition: 'left' };

export { SETTINGS_KEY };

const BUILTIN_THEMES = [
  ['dark','Dark (Default)'],['light','Light'],['contrast','High Contrast'],
  ['phosphor','Phosphor Green'],['synthwave','Synthwave'],['bloodmoon','Blood Moon'],['slate','Slate'],
];

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
  sel.innerHTML = BUILTIN_THEMES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('') +
    (custom.length ? `<optgroup label="Custom">${custom.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}</optgroup>` : '');
  sel.value = settings.theme || 'dark';
}

export function applySettings(settings) {
  const customTheme = (settings.customThemes || []).find(t => t.id === settings.theme);
  document.documentElement.setAttribute('data-theme', customTheme ? 'dark' : (settings.theme || 'dark'));
  document.documentElement.setAttribute('data-density', settings.density || 'comfortable');
  document.documentElement.setAttribute('data-sidebar', settings.sidebarPosition || 'left');
  document.documentElement.style.setProperty('--font-size-base', (settings.fontSize || '14') + 'px');

  // Apply active custom theme colors, or any in-progress editor colors
  const colors = customTheme ? customTheme.colors : (settings.customColors || {});
  THEME_COLOR_VARS.forEach(({ v }) => {
    if (colors[v]) document.documentElement.style.setProperty(v, colors[v]);
    else document.documentElement.style.removeProperty(v);
  });

  _populateThemeDropdown(settings);

  for (const group of ['fontsize', 'density', 'sidebar']) {
    const container = document.getElementById(`opt-${group}`);
    if (!container) continue;
    const key = group === 'fontsize' ? 'fontSize' : group === 'sidebar' ? 'sidebarPosition' : group;
    container.querySelectorAll('.settings-opt').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.value === String(settings[key]));
    });
  }
}

export function initSettingsUI(settings, saveAndApply, { getOrigin, saveOrigin, sendCmd } = {}) {
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
  function closeSettings() {
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
  sel.innerHTML = BUILTIN_THEMES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('') +
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

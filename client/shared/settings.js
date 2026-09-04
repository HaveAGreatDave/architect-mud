const SETTINGS_KEY = 'architect_settings';
export const DEFAULT_AUDIO_SETTINGS = { enabled: true, music: true, sfx: true, tv: true, welcome: true, masterVolume: 0.40, musicVolume: 0.40, sfxVolume: 0.25, ambientVolume: 0.25, tvVolume: 0.25, muteWhenHidden: true };
// `iron` is the out-of-the-box theme — the one a player who never opens Settings
// plays the whole game in, and therefore the one the cold open, the wireframe city
// and every accent-coloured surface are composed against. Changing it changes the
// default look of the product; keep it in step with the inline boot script in
// client/game/index.html, which sets the same value before any module loads so the
// first paint isn't a different colour from the second.
const DEFAULT_SETTINGS = { theme: 'iron', fontSize: '16', density: 'comfortable', sidebarPosition: 'left', motion: 'on', weatherFx: 'on', tempUnit: 'C', contrast: 0, dpadSize: 'small', pokerFelt: 'green', pokerFeltColor: '#1a4a1a', extraLore: 'off', mapOverlay: 'labels', mapColor: 'off', minimapRender: 'smooth', uiFont: 'mono', statusGlyphs: 'off', monoAudio: 'off', dictation: 'off', logVoice: 'off', logVoiceRate: '1', audio: DEFAULT_AUDIO_SETTINGS };

// ── The accessibility surface, declared once ─────────────────────────────────
//
// This table IS the feature. Both surfaces read it and neither owns it: the
// Tablet's Accessibility page renders these rows, and the `accessibility` verb
// lists and sets these keys — so a new option is one entry here and appears in
// both, spelled the same way, with the same explanation.
//
// That matters more than it sounds. The verb is not a convenience: a player who
// cannot use the graphical tablet cannot reach the settings that would make the
// tablet usable, which is the oldest trap in accessibility design — the switch
// for the light is inside the dark room. `accessibility` is therefore a plain
// client-side verb with no tablet gate, exactly like `displaymode`.
//
// `why` is written for a player, not for us. It is what the verb prints.
//
// `def` is the value `accessibility reset` returns the option to. It is optional
// and defaults to the FIRST pill, which is true of every option here but one:
// Reading Speed is a ladder from slow to fast and its default sits in the middle,
// because reordering it to put the default first would mean printing a speed
// scale out of order. Before `def` existed that was an unwritten positional
// convention, which is the kind of thing that holds until the day it doesn't.
export const A11Y_OPTIONS = [
  {
    key: 'fontSize', label: 'Text Size', verb: 'text', def: '16',
    why: 'Scales the entire interface, not just the log. Maximum is 200%.',
    opts: [
      { v: '14', t: 'Small' }, { v: '16', t: 'Medium' }, { v: '19', t: 'Large' },
      { v: '22', t: 'X-Large' }, { v: '26', t: 'Huge' }, { v: '32', t: 'Maximum' },
    ],
  },
  {
    key: 'uiFont', label: 'Typeface', verb: 'font',
    why: 'The game is monospaced by default. Sans is easier for many readers; Readable widens letter spacing and word spacing, which helps if letters swim or crowd. Maps, minimaps and character art stay monospaced either way — they need the columns.',
    opts: [{ v: 'mono', t: 'Monospace' }, { v: 'sans', t: 'Sans' }, { v: 'readable', t: 'Readable' }],
  },
  {
    key: 'motion', label: 'Motion', verb: 'motion',
    why: 'Off stops animation everywhere it can be stopped — including the weather overlay, the cold open, the card reveal and the flight-sim view warp, not just CSS transitions.',
    opts: [{ v: 'on', t: 'On' }, { v: 'off', t: 'Off' }],
  },
  {
    key: 'statusGlyphs', label: 'Status Marks', verb: 'marks',
    why: 'Adds a symbol beside anything the game otherwise tells you with colour alone — powered/unpowered, safe/hostile, ok/hurt. Useful with any colour vision deficiency, and in bright sunlight.',
    opts: [{ v: 'off', t: 'Off' }, { v: 'on', t: 'On' }],
  },

  {
    key: 'logVoice', label: 'Read Aloud', verb: 'read',
    why: 'Speaks each new line of the log. OFF BY DEFAULT, and leave it off if you already use a screen reader — the log is a live region, so your screen reader is reading it too, and both at once is unusable. Natural uses your device\'s own voice and is the one to pick if you just want the game read to you. In-world uses the game\'s own synthetic voice, the one the broadcasts use: it fits the fiction and is harder work to listen to for a long session. Escape stops it, and entering a command interrupts it.',
    opts: [{ v: 'off', t: 'Off' }, { v: 'natural', t: 'Natural' }, { v: 'world', t: 'In-world' }],
  },
  {
    key: 'logVoiceRate', label: 'Reading Speed', verb: 'speed', def: '1',
    why: 'How fast Read Aloud speaks. Practised listeners run much faster than sounds reasonable at first; start at Normal and raise it once the voice stops being new.',
    opts: [
      { v: '0.8', t: 'Slow' }, { v: '1', t: 'Normal' }, { v: '1.3', t: 'Brisk' },
      { v: '1.7', t: 'Fast' }, { v: '2.2', t: 'Very Fast' },
    ],
  },
  {
    key: 'dictation', label: 'Voice Input', verb: 'voice',
    why: 'Adds a microphone button beside the command box, so you can speak a command instead of typing it. Off by default. Review puts what you said in the box and waits for you to press Enter; Auto-send runs it straight away — except for commands that cost you something (drop, give, attack, buy), which always wait. Needs Chrome, Edge, or Safari; Firefox has no speech recognition and the button will not appear.',
    opts: [{ v: 'off', t: 'Off' }, { v: 'review', t: 'Review' }, { v: 'send', t: 'Auto-send' }],
  },

  {
    key: 'monoAudio', label: 'Mono Audio', verb: 'mono',
    why: 'Sums both channels to one, so nothing is only in the ear you are not using.',
    opts: [{ v: 'off', t: 'Off' }, { v: 'on', t: 'On' }],
  },
  {
    // ⚠ NO `def` — TRI-STATE, for the same reason sfxDetail is (see below), and it
    // is worth spelling out because the failure mode here is nastier. Give this a
    // default and `accessibility reset` writes 'visual', which throws a screen-reader
    // player out of the readable tablet and back into the simulated one — using the
    // escape hatch that exists for when you have just made things unusable. The
    // derived answer follows the rung instead, so log mode gets the document tablet
    // with nothing configured, and reset leaves that intact.
    key: 'tabletMode', label: 'Tablet Style', verb: 'tablet',
    resolve: (settings, ctx) => tabletStyle(settings, ctx?.displayRung),
    why: 'Screen is the simulated device — tiles, pages, animation. Document replaces it with a plain dialog you move through with Tab, with real headings, lists and buttons: the same tablet, built to be read rather than looked at. Document is the default if you play in log mode. Neither is required — every tablet app also has a verb you can simply type, and `tablet verbs` lists them.',
    opts: [{ v: 'visual', t: 'Screen' }, { v: 'accessible', t: 'Document' }],
  },
  {
    // ⚠ NO `def`. This option is deliberately TRI-STATE — see sfxDetail() below.
    // Giving it a default would store a value for everybody and destroy the
    // never-chosen state the derived default depends on.
    key: 'sfxDetail', label: 'Sound Detail', verb: 'sfx',
    // The only option in the table with a `resolve`. Both renderers ask this
    // rather than reading the raw key, so neither has to know that "unset" is a
    // real state here — and neither ends up printing "currently undefined".
    resolve: (settings, ctx) => sfxDetail(settings, ctx?.displayRung),
    why: 'How much of the world you hear. Limited is the game\'s usual soundset — sound when something happens. Full adds continuous world sound: a footstep on whatever you are standing on as you enter each tile, doors opening and closing. It is meant to tell you where you are without reading. Full is the default if you play in log mode. Off silences both tiers, and changes nothing about volume — the sliders under Sound are still where you set how loud things are.',
    opts: [{ v: 'off', t: 'Off' }, { v: 'limited', t: 'Limited' }, { v: 'full', t: 'Full' }],
  },
];

// ── Sound Detail: chosen wins, never-chosen is DERIVED ───────────────────────
//
// The one place this question is answered. Every consumer calls this rather than
// reading `settings.sfxDetail`, because the raw value is absent for almost
// everybody and absent does not mean `limited`.
//
// The tri-state is the whole design, and it is the same one Display Mode's own
// rungs run on (docs/systems-display-mode.md — "keep the fourth state"). A player
// on the `log` rung has no room pane to read, so the dense tier is what they
// should get by default; everyone else should get today's game unchanged. Storing
// that as a value at login would be a WRITE, and a write cannot be told apart from
// a choice — the moment somebody at `log` pressed Limited, or somebody at `visual`
// switched to `log`, the stored value would be the wrong answer with no way to
// know it was never meant.
//
// So nothing is stored until the player presses a pill, and a pressed pill wins
// forever after, at every rung. `accessibility reset` must DELETE the key rather
// than write 'limited', or a log-rung player who resets is quietly demoted off the
// tier the reset was supposed to restore.
// Tablet Style: chosen wins, never-chosen is DERIVED — the same tri-state as
// sfxDetail below, and for the same reason. A player at the `log` rung cannot use
// a simulated touchscreen, so the readable tablet is what they should get without
// having to find a setting; everybody else gets today's tablet, unchanged. Storing
// that at login would be a WRITE, and a write cannot be told apart from a choice.
export function tabletStyle(settings, displayRung) {
  const v = settings?.tabletMode;
  if (v === 'visual' || v === 'accessible') return v;
  return displayRung === 'log' ? 'accessible' : 'visual';
}

export function sfxDetail(settings, displayRung) {
  const v = settings?.sfxDetail;
  if (v === 'off' || v === 'limited' || v === 'full') return v;
  return displayRung === 'log' ? 'full' : 'limited';
}

// What an option is CURRENTLY set to, for display. Almost every row answers this
// with its stored value; a row carrying a `resolve` answers it with a derived one.
// Both surfaces call this so the tri-state lives in exactly one place, and a
// second option that ever needs a derived default gets it by adding a `resolve`
// rather than by teaching two renderers a second special case.
export function effectiveOptionValue(opt, settings, ctx) {
  return opt?.resolve ? opt.resolve(settings || {}, ctx) : settings?.[opt.key];
}

// ── Motion, as a predicate rather than an attribute ─────────────────────────
//
// `data-motion="off"` reaches ~21 CSS rules. It did NOT reach the canvas and
// requestAnimationFrame work, which is most of the motion in this client: the
// flame, the accolades banner, the card-pack reveal, the flight-sim view warp.
// Those each tested the OS-level `prefers-reduced-motion` and stopped there — so
// the in-game Motion switch, the one a player actually finds, moved a dozen CSS
// transitions and left every animation that could make somebody ill running.
//
// Two things this fixes. It ORs the app setting with the OS preference, so
// either one is enough; and it is a FUNCTION, evaluated when asked. Three of
// those call sites read the media query into a module-scope `const` at import
// time, which meant even the OS preference only took effect if you changed it
// before the page loaded. Never cache the result of this.
export function prefersReducedMotion() {
  try {
    if (document.documentElement.getAttribute('data-motion') === 'off') return true;
  } catch { /* no DOM (tests) — fall through to the media query */ }
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch { return false; }
}



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
  ['meadow','Meadow'],['clay','Clay'],['highbeam','Highbeam'],
];
const DARK_THEMES = [
  ['dark','Void'],['eclipse','Eclipse'],['iron','Iron'],
  ['contrast','Terminal'],['phosphor','Phosphor Green'],['synthwave','Synthwave'],['bloodmoon','Blood Moon'],['slate','Slate'],
  ['aurora','Aurora'],['neon','Neon'],['cathode','Cathode'],['grove','Grove'],
  ['tide','Tide'],['dusk','Dusk'],['solarflare','Solar Flare'],
  ['abyss','Abyss'],['mulberry','Mulberry'],['umber','Umber'],
];
const BUILTIN_THEMES = [...LIGHT_THEMES, ...DARK_THEMES];

// Exported for anything that wants to build its own compact theme picker
// without pulling in the full swatch-grid/theme-editor DOM (e.g. the Tablet
// OS Settings app, which reads this to render its own list of theme buttons).
export { LIGHT_THEMES, DARK_THEMES };

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
  { v: '--cyan',        label: 'Cyan',                   desc: 'Info, links, window light' },
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

// Contrasting "ink" (near-black or white) for text/icons on a solid --accent
// fill. Bright/warm accents (amber, yellow, mint) need dark ink; deep accents
// need white — a fixed #fff washes out on light accents. Defaults to white.
function _inkOn(hex) {
  if (!_isValidHex(hex)) return '#ffffff';
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#0a0a0a' : '#ffffff';
}

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

// Minimap overlay mode, with the retired third mode folded away. 'icons' drew a
// building-type emoji over the rooftop footprint; it's been removed from the client,
// so any browser still carrying it reads as lettering rather than rendering nothing.
function _mapOverlayMode(settings) {
  const m = settings.mapOverlay;
  return m === 'none' ? 'none' : 'labels';
}

// How a room's ways in/out are drawn: 'edges' (a thin green line on every open side,
// red on every wall) or 'arrows' (the amber triangles that came first).
//
// Door style used to be a setting (arrows vs edge lines). It isn't any more: edge
// lines are the only style. The arrows only rendered where `exit_dirs` is set — ways
// out of the BUILDING — which is 72 of 500 interior tiles, so they drew nothing in
// 86% of rooms and read as a broken feature. Edges render wherever `open_dirs` is
// set: 372 of those same tiles. A stale `mapDoors` key in an old saved blob is
// simply ignored.

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS, audio: { ...DEFAULT_AUDIO_SETTINGS } };
    const stored = JSON.parse(raw);
    const merged = { ...DEFAULT_SETTINGS, ...stored, audio: { ...DEFAULT_AUDIO_SETTINGS, ...(stored.audio || {}) } };
    // Normalise here rather than at each reader, so the Settings pills highlight the
    // mode a retired value now maps to instead of showing nothing selected.
    merged.mapOverlay = _mapOverlayMode(merged);
    return merged;
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

// Exported so a panel can preview/apply a built-in theme's actual colors
// without switching the page's own active theme (e.g. Tablet OS's independent
// "unlinked" theme — client/game/js/panels/tablet-os.js).
export { _getBuiltinThemeColors as probeBuiltinThemeColors };

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
  // Both the theme-editor overlay grid and the inline settings-panel grid (if
  // present) show the same swatches.
  const grids = [document.getElementById('opt-theme-grid'), document.getElementById('settings-theme-grid')].filter(Boolean);
  if (!grids.length) return;
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
  for (const grid of grids) grid.innerHTML = html;
}

export function applySettings(settings) {
  const customTheme = (settings.customThemes || []).find(t => t.id === settings.theme);
  document.documentElement.setAttribute('data-theme', customTheme ? 'dark' : (settings.theme || 'dark'));
  document.documentElement.setAttribute('data-density', settings.density || 'comfortable');
  document.documentElement.setAttribute('data-sidebar', settings.sidebarPosition || 'left');
  document.documentElement.setAttribute('data-motion', settings.motion || 'on');
  document.documentElement.setAttribute('data-dpad-size', settings.dpadSize || 'small');
  // Accessibility attributes. Everything they drive is pure CSS, so they cost a
  // repaint and nothing else — and a surface that forgets to honour one degrades
  // to today's appearance rather than breaking.
  document.documentElement.setAttribute('data-ui-font', settings.uiFont || 'mono');
  document.documentElement.setAttribute('data-status-glyphs', settings.statusGlyphs || 'off');
  // Voice input. The attribute is what shows/hides the mic button in CSS, and it
  // carries the MODE rather than a boolean because 'review' and 'send' differ
  // only in what happens after the words land — the button is identical.
  // dictation.js reads the same key for that half.
  document.documentElement.setAttribute('data-dictation', settings.dictation || 'off');
  window._applyDictation?.(settings.dictation || 'off');
  // Read Aloud. Rate first, so a mode change never speaks its first line at the
  // old speed.
  window._applyLogVoiceRate?.(settings.logVoiceRate || '1');
  window._applyLogVoice?.(settings.logVoice || 'off');
  // Sums the stereo image to one channel for anyone with hearing in one ear, or
  // wearing one earbud. Applied to the master bus, so it catches every category.
  window.AudioEngine?.setMonoAudio?.((settings.monoAudio || 'off') === 'on');
  // The ROOT font size — client/game/styles.css hangs `html { font-size }` off it
  // and every font-size in that sheet is a rem, so this one line scales the whole
  // interface. Keep the fallback in step with DEFAULT_SETTINGS above and with the
  // pre-module boot script in client/game/index.html.
  document.documentElement.style.setProperty('--font-size-base', (settings.fontSize || '16') + 'px');
  // Smart UI: the contextual per-room action bar (#smart-bar, panels/smartbar.js)
  // is now always on, every device — it's the primary command surface (Tablet +
  // room verbs) since the quick-cmds bar was retired, so it's no longer togglable.
  document.documentElement.setAttribute('data-smart-ui', 'on');

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

  // Contrasting ink for text on solid --accent fills (buttons/pills). Read the
  // now-effective accent (theme CSS or the boosted inline value) and pick the
  // legible foreground, so accent buttons never show accent-on-accent text.
  const _accentEff = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  document.documentElement.style.setProperty('--accent-ink', _inkOn(_accentEff));

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

  // Mini swatch on the collapsed dropdown trigger — same dots as a full chip.
  const _sw = document.getElementById('theme-dd-swatch');
  if (_sw) {
    const c = _getThemeColors(settings.theme || 'dark', settings);
    _sw.style.background = c['--bg'];
    _sw.style.borderColor = c['--border'];
    _sw.innerHTML = _CHIP_DOT_VARS.map(v => `<span class="theme-dot" style="background:${c[v] || 'transparent'}"></span>`).join('');
  }

  const _cs = document.getElementById('opt-contrast');
  const _cl = document.getElementById('contrast-value-label');
  const _cv = settings._contrastPreview != null ? settings._contrastPreview : (settings.contrast || 0);
  if (_cs && _cs.value !== String(_cv)) _cs.value = _cv;
  if (_cl) _cl.textContent = _cv === 0 ? 'Base' : `+${_cv}%`;

  for (const group of ['fontsize', 'sidebar', 'motion', 'weatherfx', 'tempunit', 'dpadsize']) {
    const container = document.getElementById(`opt-${group}`);
    if (!container) continue;
    const key = group === 'fontsize' ? 'fontSize' : group === 'sidebar' ? 'sidebarPosition' : group === 'tempunit' ? 'tempUnit' : group === 'dpadsize' ? 'dpadSize' : group === 'weatherfx' ? 'weatherFx' : group;
    container.querySelectorAll('.settings-opt').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.value === String(settings[key]));
    });
  }

  // Weather FX overlay gate — off if the setting is off OR Motion is off (the FX
  // is animation). The game client registers the hook; other clients ignore it.
  window._applyWeatherFx?.((settings.weatherFx || 'off') !== 'off' && (settings.motion || 'on') !== 'off');

  // Minimap tile-overlay mode (labels | none). Same hook pattern as the weather FX
  // gate — panels/minimap.js registers it and re-renders in place, so the pill takes
  // effect without a move. Other clients have no minimap and skip it.
  window._applyMapOverlay?.(_mapOverlayMode(settings));

  // Landmark colour. OFF by default, which is the plain map: no POI tint on a building
  // footprint and a white plate under a tile’s two-letter code. On, a depot, a clinic and
  // a shop are three colours you can find without reading anything. Same hook pattern.
  window._applyMapColor?.((settings.mapColor || 'off') === 'on');

  // Minimap renderer (smooth = canvas + gliding camera, classic = the DOM grid).
  // A real setting rather than a hidden key because the fallback exists for people
  // whose machine can't run the canvas path well, and telling them to open devtools
  // is not a fallback.
  window._applyMinimapRender?.((settings.minimapRender || 'smooth') === 'smooth');

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
  // Theme swatch grids — the editor-overlay grid and the inline settings grid
  // both pick a theme on click.
  const pickTheme = (value) => {
    settings.theme = value;
    settings.customColors = {};
    _teEditLoaded = false;
    // Collapse the swatch dropdown once a theme is chosen.
    const ddPanel = document.getElementById('theme-dd-panel');
    if (ddPanel) {
      ddPanel.classList.remove('open');
      document.getElementById('theme-dd-trigger')?.setAttribute('aria-expanded', 'false');
    }
    saveAndApply();
  };
  for (const gid of ['opt-theme-grid', 'settings-theme-grid']) {
    const grid = document.getElementById(gid);
    if (!grid) continue;
    grid.addEventListener('click', (e) => {
      const chip = e.target.closest('.theme-chip');
      if (!chip || !grid.contains(chip)) return;
      pickTheme(chip.dataset.value);
    });
  }

  // The in-game settings surface now lives entirely in the Tablet OS; the old
  // #settings-panel window is retired, so the header cog just opens the app.
  document.getElementById('settings-btn')?.addEventListener('click', () => {
    if (sendCmd) sendCmd('tabletnav settings');
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
  _teCenterWindow();
  _teEditLoaded = false;
  _populateThemeGrid(settings);
  _teShowTab('swatches');
  _teScrollToSelected();
}

// Open centred over the viewport (near the settings dialog) rather than pinned
// to the corner. Runs each open, so it resets even after the window's been dragged.
function _teCenterWindow() {
  const win = document.getElementById('te-window');
  if (!win) return;
  const w = win.offsetWidth || 340;
  const h = win.offsetHeight || Math.min(window.innerHeight * 0.82, 560);
  win.style.right = 'auto';
  win.style.left = Math.max(8, (window.innerWidth - w) / 2) + 'px';
  win.style.top = Math.max(8, (window.innerHeight - h) / 2) + 'px';
}

// Bring the active theme's chip into view (centred) when the editor opens, so
// the current selection isn't hidden below the fold of the swatch list.
function _teScrollToSelected() {
  const grid = document.getElementById('opt-theme-grid');
  const sel = grid && grid.querySelector('.theme-chip.selected');
  if (!grid || !sel) return;
  const gRect = grid.getBoundingClientRect();
  const sRect = sel.getBoundingClientRect();
  grid.scrollTop += (sRect.top - gRect.top) - (grid.clientHeight - sel.clientHeight) / 2;
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

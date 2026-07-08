// ARCHITECT TABLET OS — the shared CRT-styled shell for Quests, Skills & Stats,
// Bank, Weather, Vehicles, Properties, Settings, and Corporation. Corporation
// renders natively (view: 'corp', reshaping plugins/corps' own
// buildConsolePayload()) rather than handing off to the standalone
// corp-console.js overlay — that overlay still exists for `corp console`
// typed directly, but Tablet no longer launches it.
// Built on the same minigame chassis as Circuit Breach / Corp Console
// (minigame-common.js), so it inherits the CRT look for free. Uses the page's
// own `--accent` var (the player's existing theme color, set by settings.js)
// instead of a server-supplied accent — there is no separate Tablet theme.
//
// Every screen — home or any app screen — arrives as one `tablet_panel`
// payload (plugins/tablet/index.js); the client just re-renders from it on
// every nav/action round trip, mirroring the ATM panel's full-payload-per-
// message convention rather than corp-console's separate live-patch channel
// (Tablet has no proactive multi-client push to patch against).
import { sfx, esc, mountOverlay, ensureChassisStyles, deviceHeader, bezelScrews, crtOverlays } from './minigame-common.js';
import { sendCmdSilent } from '../net.js';
import { loadSettings, saveSettings, applySettings, openThemeEditor, probeBuiltinThemeColors, DARK_THEMES, LIGHT_THEMES } from '/shared/settings.js';

// Tablet's theme can be independent of the shared UI theme ("unlinked") —
// its own tiny localStorage record, separate from architect_settings, so
// switching it never touches the player's actual page theme.
const TABLET_THEME_KEY = 'architect_tablet_theme';
function loadTabletTheme() {
  try {
    const raw = localStorage.getItem(TABLET_THEME_KEY);
    return { linked: true, theme: 'dark', ...(raw ? JSON.parse(raw) : {}) };
  } catch { return { linked: true, theme: 'dark' }; }
}
function saveTabletTheme(t) {
  try { localStorage.setItem(TABLET_THEME_KEY, JSON.stringify(t)); } catch {}
}

let _overlay = null;
let _close = null;
let _data = null; // last tablet_panel payload

function ensureStyles() {
  if (document.getElementById('tablet-os-styles')) return;
  const s = document.createElement('style');
  s.id = 'tablet-os-styles';
  s.textContent = `
    /* No backdrop scrim — this floats over the live game like the settings/theme
       windows do, not a blocking modal. pointer-events:none on the full-screen
       container lets clicks reach the game everywhere except the panel itself. */
    #tablet-os-overlay { --mg-accent: var(--accent, #35e0c8); position:fixed; inset:0; z-index:9200; pointer-events:none; font-family:'Courier New',monospace;
      /* --tos-fg is set inline by JS (luminance-contrast against --bg2, see
         applyTabletTheme); the dim tiers are derived from it in pure CSS. */
      --tos-fg-dim: color-mix(in srgb, var(--tos-fg, var(--mg-accent)) 62%, var(--bg2, #12181b));
      --tos-fg-dim2: color-mix(in srgb, var(--tos-fg, var(--mg-accent)) 40%, var(--bg2, #12181b));
      /* Every "box" surface (tiles, list rows, summary strip, theme swatches)
         used to be a flat near-black rgba — reads as dead grey against a light
         theme's cream/paper background. Instead every surface is the current
         --bg2 tinted with the live accent, light and dark ends for a pseudo-3D
         bevel gradient, plus matching highlight/shadow bevel edges — so "grey"
         is always a light tint of the accent color, in any theme. */
      --tos-surface-hi: color-mix(in srgb, var(--mg-accent) 18%, var(--bg2, #1a2226));
      --tos-surface-lo: color-mix(in srgb, var(--mg-accent) 6%, var(--bg2, #1a2226));
      --tos-surface: color-mix(in srgb, var(--mg-accent) 12%, var(--bg2, #1a2226));
      --tos-bevel-hi: color-mix(in srgb, white 55%, transparent);
      --tos-bevel-lo: color-mix(in srgb, black 45%, transparent); }
    /* Anchor handles centering/dragging; .tos-panel is scaled by the CRT boot
       animation, so the two transforms don't fight each other on the same node. */
    #tablet-os-overlay .tos-anchor { position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); pointer-events:auto; }
    /* Fixed panel size regardless of content — a long list scrolls inside
       .tos-scroll instead of growing the chassis. flex column so .tos-bezel
       (the screen) fills whatever's left under the fixed-height device header.
       Hard-plastic-shell look (not just a flat --bg2 fill) so the case reads
       as a physical device sitting over the game instead of blending into a
       dark backdrop: a raised bevel edge, an embossed inset/outset shadow
       stack, and a diagonal gloss sweep + fine grain texture via ::after/::before. */
    #tablet-os-overlay .tos-panel { width:min(760px,96vw); height:600px; max-height:90vh; display:flex; flex-direction:column;
      position:relative; overflow:hidden; color:var(--mg-accent); transform-origin:center center;
      background:
        linear-gradient(160deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.02) 14%, transparent 30%),
        var(--bg2, #1a2226);
      border:2px solid color-mix(in srgb, var(--bg2, #1a2226) 35%, #000 65%);
      box-shadow:
        0 16px 46px rgba(0,0,0,0.75),
        0 0 0 1px rgba(0,0,0,0.6),
        0 0 30px color-mix(in srgb, var(--mg-accent) 14%, transparent),
        inset 0 1px 0 rgba(255,255,255,0.14),
        inset 0 -4px 8px rgba(0,0,0,0.45);
      padding:14px 16px 16px; }
    /* Fine plastic grain — an SVG feTurbulence noise tile, low opacity, blended in. */
    #tablet-os-overlay .tos-panel::before { content:''; position:absolute; inset:0; pointer-events:none; z-index:1;
      background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
      opacity:.05; mix-blend-mode:overlay; }
    /* Diagonal gloss sweep near the top, like curved hard plastic catching light. */
    #tablet-os-overlay .tos-panel::after { content:''; position:absolute; z-index:1; pointer-events:none;
      left:4%; right:4%; top:-6%; height:34%; border-radius:50%;
      background:linear-gradient(180deg, rgba(255,255,255,0.20), rgba(255,255,255,0) 75%); opacity:.6; }
    /* .mg-head/.tos-bezel are position:static by default — a static element
       always paints below a positioned sibling regardless of z-index, so
       without this the gloss/grain layers above would cover the real content. */
    #tablet-os-overlay .tos-panel > .mg-head, #tablet-os-overlay .tos-panel > .tos-bezel { position:relative; z-index:2; }
    /* CRT power-on/off: reuses the TV's own collapse-to-a-line keyframes
       (@keyframes tv-crt-poweron / tv-crt-shutoff, styles.css) — same effect,
       no duplication. */
    #tablet-os-overlay .tos-panel.tos-powering-on { animation:tv-crt-poweron 0.6s ease-out forwards; }
    #tablet-os-overlay .tos-panel.tos-shutting-off { animation:tv-crt-shutoff 0.55s ease-in forwards; pointer-events:none; }
    #tablet-os-overlay .mg-head { cursor:grab; user-select:none; flex:0 0 auto; }
    #tablet-os-overlay .mg-head:active { cursor:grabbing; }
    #tablet-os-overlay .tos-bezel { flex:1; min-height:0; display:flex; flex-direction:column; }
    #tablet-os-overlay .tos-screen { background:var(--bg, #0c1114); position:relative; flex:1; min-height:0; overflow:hidden; }
    /* The only element that actually scrolls — CRT overlay layers are outside
       it (siblings), so scanlines/sweep/reticles stay pinned to the screen
       instead of scrolling away with the content. */
    #tablet-os-overlay .tos-scroll { position:relative; z-index:2; height:100%; overflow-y:auto; overflow-x:hidden; }
    #tablet-os-overlay .tos-scroll::-webkit-scrollbar { width:6px; }
    #tablet-os-overlay .tos-scroll::-webkit-scrollbar-track { background:var(--bg2); }
    #tablet-os-overlay .tos-scroll::-webkit-scrollbar-thumb { background:var(--border); border-radius:3px; }
    #tablet-os-overlay .tos-scroll { scrollbar-width:thin; scrollbar-color:var(--border) var(--bg2); }
    #tablet-os-overlay .tos-body { padding:14px 13px; font-size:13.5px; }

    /* Boot screen: logo + "ARCHITECT OS" hold for ~1s once the CRT has
       expanded, before the real Home/app screen renders underneath it. */
    #tablet-os-overlay .tos-boot { position:absolute; inset:0; z-index:6; display:flex; flex-direction:column;
      align-items:center; justify-content:center; gap:7px; background:var(--bg, #0c1114); }
    #tablet-os-overlay .tos-boot-logo { width:36px; height:36px; border-radius:50%; border:2px solid var(--mg-accent);
      display:flex; align-items:center; justify-content:center; font-size:19px; font-weight:bold; color:var(--mg-accent);
      text-shadow:0 0 10px color-mix(in srgb, var(--mg-accent) 70%, transparent);
      box-shadow:0 0 14px color-mix(in srgb, var(--mg-accent) 45%, transparent), inset 0 0 8px color-mix(in srgb, var(--mg-accent) 25%, transparent);
      margin-bottom:2px; animation:tos-boot-flicker .9s ease-in-out; }
    #tablet-os-overlay .tos-boot-title { font-size:20px; letter-spacing:8px; color:var(--mg-accent);
      text-shadow:0 0 14px color-mix(in srgb, var(--mg-accent) 65%, transparent); animation:tos-boot-flicker .9s ease-in-out; }
    #tablet-os-overlay .tos-boot-sub { font-size:10px; letter-spacing:3px; color:var(--mg-accent); opacity:.55; text-transform:uppercase; }
    @keyframes tos-boot-flicker { 0%{opacity:0} 10%{opacity:1} 14%{opacity:.25} 18%{opacity:1} 100%{opacity:1} }

    /* Header strip: time / location, persistent regardless of screen */
    #tablet-os-overlay .tos-hdr { display:flex; justify-content:space-between; font-size:11px; letter-spacing:1px; color:var(--tos-fg-dim); margin-bottom:8px; text-transform:uppercase; }
    #tablet-os-overlay .tos-hdr b { color:var(--mg-accent); }

    /* Player summary strip: persistent across every screen. Pseudo-3D raised
       bevel: light-accent gradient + inset highlight/shadow + a soft drop
       shadow, instead of a flat near-black box. */
    #tablet-os-overlay .tos-summary { display:flex; justify-content:space-between; gap:10px;
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo));
      border:1px solid color-mix(in srgb, var(--mg-accent) 30%, transparent); border-radius:6px; padding:9px 11px; margin-bottom:11px; font-size:12.5px; flex-wrap:wrap;
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi), inset 0 -2px 3px var(--tos-bevel-lo), 0 2px 5px rgba(0,0,0,0.2); }
    #tablet-os-overlay .tos-summary span { color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-summary b { color:var(--tos-fg); }

    /* Breadcrumb + back */
    #tablet-os-overlay .tos-crumb { display:flex; align-items:center; gap:8px; font-size:11px; letter-spacing:1px; text-transform:uppercase; color:var(--tos-fg-dim); margin-bottom:9px; }
    #tablet-os-overlay .tos-crumb .tos-back { cursor:pointer; color:var(--mg-accent); border:1px solid color-mix(in srgb, var(--mg-accent) 40%, transparent); border-radius:3px; padding:2px 8px;
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo)); box-shadow:inset 0 1px 0 var(--tos-bevel-hi), inset 0 -1px 1px var(--tos-bevel-lo); }
    #tablet-os-overlay .tos-crumb .tos-back:hover { filter:brightness(1.15); }
    #tablet-os-overlay .tos-crumb .tos-back:active { transform:translateY(1px); box-shadow:inset 0 1px 3px var(--tos-bevel-lo); }

    /* App grid (home) — raised tile: light-accent gradient + bevel edge, lifts
       on hover, presses in on click (pseudo-3D, not a flat grey fill). */
    #tablet-os-overlay .tos-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }
    #tablet-os-overlay .tos-tile { cursor:pointer; text-align:center; padding:14px 6px; border-radius:7px;
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo));
      border:1px solid color-mix(in srgb, var(--mg-accent) 32%, transparent);
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi), inset 0 -2px 3px var(--tos-bevel-lo), 0 2px 5px rgba(0,0,0,0.22);
      transition:filter .12s, box-shadow .12s, transform .05s; }
    #tablet-os-overlay .tos-tile:hover { filter:brightness(1.15);
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi), inset 0 -2px 3px var(--tos-bevel-lo), 0 3px 8px rgba(0,0,0,0.28), 0 0 14px color-mix(in srgb, var(--mg-accent) 30%, transparent); }
    #tablet-os-overlay .tos-tile:active { transform:translateY(1px); box-shadow:inset 0 2px 4px var(--tos-bevel-lo); }
    #tablet-os-overlay .tos-tile .tos-icon { font-size:24px; display:block; margin-bottom:6px; }
    #tablet-os-overlay .tos-tile .tos-name { font-size:11.5px; letter-spacing:.5px; color:var(--tos-fg); }

    /* List view — same raised-bevel treatment as tiles, just row-shaped. */
    #tablet-os-overlay .tos-list-item { display:flex; flex-direction:column; gap:3px; cursor:pointer; padding:9px 11px; border-radius:6px;
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo));
      border:1px solid color-mix(in srgb, var(--mg-accent) 26%, transparent); margin-bottom:7px;
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi), inset 0 -2px 2px var(--tos-bevel-lo), 0 1px 4px rgba(0,0,0,0.18);
      transition:filter .12s, box-shadow .12s, transform .05s; }
    #tablet-os-overlay .tos-list-item:hover { filter:brightness(1.12); box-shadow:inset 0 1px 0 var(--tos-bevel-hi), inset 0 -2px 2px var(--tos-bevel-lo), 0 2px 6px rgba(0,0,0,0.22); }
    #tablet-os-overlay .tos-list-item:active { transform:translateY(1px); box-shadow:inset 0 2px 3px var(--tos-bevel-lo); }
    #tablet-os-overlay .tos-list-item .tos-li-label { color:var(--tos-fg); font-size:13.5px; display:flex; justify-content:space-between; gap:8px; }
    #tablet-os-overlay .tos-list-item .tos-li-sub { color:var(--tos-fg-dim); font-size:12px; }
    #tablet-os-overlay .tos-badge { font-size:10.5px; letter-spacing:1px; padding:2px 6px; border-radius:3px; text-transform:uppercase; }
    #tablet-os-overlay .tos-badge.ready { color:#7bffb0; border:1px solid #244; background:#0c1a15; }
    #tablet-os-overlay .tos-badge.active { color:#ffcf4a; border:1px solid #3a3018; background:#1a150a; }
    #tablet-os-overlay .tos-badge.open, #tablet-os-overlay .tos-badge.legal { color:var(--mg-accent); border:1px solid color-mix(in srgb,var(--mg-accent) 30%,transparent); background:var(--tos-surface); }
    #tablet-os-overlay .tos-badge.illegal { color:#ff7a86; border:1px solid #4a1a1e; background:#1a0a0c; }
    #tablet-os-overlay .tos-empty { color:var(--tos-fg-dim2); font-size:12.5px; line-height:1.5; padding:20px 4px; text-align:center; }

    /* Detail view */
    #tablet-os-overlay .tos-detail-name { font-size:18px; color:var(--tos-fg); margin-bottom:4px; }
    #tablet-os-overlay .tos-detail-desc { font-size:12.5px; color:var(--tos-fg-dim); margin-bottom:11px; line-height:1.5; }
    #tablet-os-overlay .tos-row { display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid color-mix(in srgb, var(--mg-accent) 12%, transparent); font-size:13px; }
    #tablet-os-overlay .tos-row span:first-child { color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-row span:last-child { color:var(--tos-fg); }

    /* Objective checkboxes (quest detail) */
    #tablet-os-overlay .tos-obj { display:flex; gap:7px; align-items:baseline; padding:3px 0; font-size:13px; }
    #tablet-os-overlay .tos-obj .tos-check { color:#7bffb0; }
    #tablet-os-overlay .tos-obj.pending .tos-check { color:var(--tos-fg-dim2); }
    #tablet-os-overlay .tos-obj.pending { color:var(--tos-fg-dim); }

    /* Action buttons — solid accent fill, raised bevel, so they read as the
       brightest / most "pressable" thing on the screen. Text color is computed
       against the accent itself (--tos-btn-fg), not --bg2. */
    #tablet-os-overlay .tos-actions { display:flex; gap:9px; margin-top:12px; flex-wrap:wrap; }
    #tablet-os-overlay .tos-btn { padding:8px 13px; border-radius:5px; font-family:'Courier New',monospace; font-size:12px; font-weight:bold; letter-spacing:1.5px; text-transform:uppercase; cursor:pointer;
      color:var(--tos-btn-fg, #04120f); border:1px solid color-mix(in srgb, var(--mg-accent) 85%, black);
      background:linear-gradient(165deg, color-mix(in srgb, var(--mg-accent) 100%, white 20%), var(--mg-accent) 55%, color-mix(in srgb, var(--mg-accent) 100%, black 15%));
      box-shadow:0 0 10px color-mix(in srgb, var(--mg-accent) 45%, transparent), inset 0 1px 0 var(--tos-bevel-hi), inset 0 -3px 3px rgba(0,0,0,0.3), 0 2px 4px rgba(0,0,0,0.25);
      transition:filter .12s, box-shadow .12s, transform .05s; }
    #tablet-os-overlay .tos-btn:hover { filter:brightness(1.12); box-shadow:0 0 18px color-mix(in srgb, var(--mg-accent) 65%, transparent), inset 0 1px 0 var(--tos-bevel-hi), inset 0 -3px 3px rgba(0,0,0,0.3), 0 3px 6px rgba(0,0,0,0.3); }
    #tablet-os-overlay .tos-btn:active { transform:translateY(1px); box-shadow:inset 0 2px 4px rgba(0,0,0,0.35); }

    #tablet-os-overlay .tos-error { color:#ff7a86; font-size:13px; padding:16px 4px; text-align:center; }

    /* Page nav (Skills & Stats — fixed-size pages instead of a growing list) */
    #tablet-os-overlay .tos-page-nav { display:flex; justify-content:space-between; align-items:center; margin-top:10px; font-size:11px; letter-spacing:1px; color:var(--tos-fg-dim); text-transform:uppercase; }
    #tablet-os-overlay .tos-page-btn { cursor:pointer; color:var(--mg-accent); border:1px solid color-mix(in srgb, var(--mg-accent) 40%, transparent); border-radius:3px; padding:4px 10px;
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo)); box-shadow:inset 0 1px 0 var(--tos-bevel-hi), inset 0 -1px 1px var(--tos-bevel-lo); }
    #tablet-os-overlay .tos-page-btn:hover { filter:brightness(1.15); }
    #tablet-os-overlay .tos-page-btn.disabled { opacity:.35; pointer-events:none; }

    /* Settings — the Tablet's own theme picker (not the full game settings
       panel), plus a link out to the full theme editor for deep customization. */
    #tablet-os-overlay .tos-theme-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:7px; margin-top:6px; }
    #tablet-os-overlay .tos-theme-btn { cursor:pointer; text-align:center; padding:8px 5px; border-radius:6px; font-size:12px;
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo));
      border:1px solid color-mix(in srgb, var(--mg-accent) 24%, transparent); color:var(--tos-fg);
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi), inset 0 -2px 2px var(--tos-bevel-lo), 0 1px 3px rgba(0,0,0,0.18);
      transition:filter .12s, box-shadow .12s, transform .05s; }
    #tablet-os-overlay .tos-theme-btn:hover { filter:brightness(1.15); }
    #tablet-os-overlay .tos-theme-btn:active { transform:translateY(1px); box-shadow:inset 0 2px 3px var(--tos-bevel-lo); }
    #tablet-os-overlay .tos-theme-btn.selected { border-color:var(--mg-accent); box-shadow:0 0 10px color-mix(in srgb, var(--mg-accent) 40%, transparent), inset 0 1px 0 var(--tos-bevel-hi); color:var(--mg-accent); font-weight:bold; }
  `;
  document.head.appendChild(s);
}

// Client-side nav token encoding: server screenId comparisons are normalized
// (lowercase, underscores -> spaces — see plugins/tablet/registry.js normScreen)
// because the command tokenizer lowercases + whitespace-splits everything
// before it reaches a plugin. Encode any label we're about to send back as a
// screenId the same way so multi-word/mixed-case screens stay reachable.
function screenToken(label) {
  return String(label || '').trim().replace(/\s+/g, '_');
}

// Same luminance-contrast pattern used elsewhere in the client (minimap.js,
// devpanel timeweather.js) — pick pure black/white text off a background's
// perceived brightness instead of always using the accent color, which can
// wash out against some theme backgrounds.
function luminanceTextColor(hex) {
  const h = String(hex || '').trim().replace('#', '');
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return null;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const t = Math.round((1 - lum) * 255);
  return `rgb(${t},${t},${t})`;
}

// Resolves the effective --bg/--bg2/--border/--accent for this open (either
// the shared page theme, or Tablet's own independent one when unlinked), sets
// them as overrides on the overlay root, then derives the luminance-contrast
// text colors from those effective values (not always the page's). Body/label
// text (--tos-fg) is checked against --bg2; button text (--tos-btn-fg) is a
// separate check against --accent, since buttons are a solid accent fill.
function applyTabletTheme() {
  if (!_overlay) return;
  const t = loadTabletTheme();
  let bg2, accent;

  if (t.linked) {
    // Inherit the page's own theme — clear any leftover unlinked override.
    _overlay.style.removeProperty('--bg');
    _overlay.style.removeProperty('--bg2');
    _overlay.style.removeProperty('--border');
    _overlay.style.removeProperty('--accent');
    bg2 = getComputedStyle(document.documentElement).getPropertyValue('--bg2');
    accent = getComputedStyle(document.documentElement).getPropertyValue('--accent');
  } else {
    const colors = probeBuiltinThemeColors(t.theme || 'dark');
    bg2 = colors['--bg2']; accent = colors['--accent'];
    _overlay.style.setProperty('--bg', colors['--bg']);
    _overlay.style.setProperty('--bg2', colors['--bg2']);
    _overlay.style.setProperty('--border', colors['--border']);
    _overlay.style.setProperty('--accent', colors['--accent']);
  }

  _overlay.style.setProperty('--tos-fg', luminanceTextColor(bg2) || 'var(--mg-accent)');
  _overlay.style.setProperty('--tos-btn-fg', luminanceTextColor(accent) || '#04120f');
}

function nav(appId, screenLabel, params) {
  sfx('hololock-set');
  const parts = ['tabletnav', appId];
  if (screenLabel != null) parts.push(screenToken(screenLabel));
  if (params) parts.push(params);
  sendCmdSilent(parts.join(' '));
}

function act(appId, actionId, params) {
  sfx('hololock-set');
  const parts = ['tabletaction', appId, actionId];
  if (params) parts.push(params);
  sendCmdSilent(parts.join(' '));
}

function home() {
  sfx('hololock-entry');
  sendCmdSilent('tablet');
}

// ── Renderers ────────────────────────────────────────────────────────────

function renderSummary(p) {
  if (!p) return '';
  return `<div class="tos-summary">
    <span><b>${esc(p.handle || '')}</b>${p.corp ? ` · ${esc(p.corp.name)}` : ''}</span>
    <span>XP <b>${p.xp ?? 0}</b></span>
    <span>On hand <b>₵${(p.credits ?? 0).toLocaleString()}</b></span>
    <span>Banked <b>₵${(p.bank_credits ?? 0).toLocaleString()}</b></span>
  </div>`;
}

function renderHeader(d) {
  return `<div class="tos-hdr"><span>${esc(d.time?.date || '')} <b>${esc(d.time?.time || '')}</b></span><span>${esc(d.location || '')}</span></div>`;
}

function renderHomeApps(apps) {
  if (!apps || !apps.length) return '<div class="tos-empty">No applications registered.</div>';
  return `<div class="tos-grid">${apps.map(a =>
    `<div class="tos-tile" data-nav-app="${esc(a.id)}"><span class="tos-icon">${esc(a.icon || '▫')}</span><span class="tos-name">${esc(a.name)}</span></div>`
  ).join('')}</div>`;
}

function renderBreadcrumb(appId, crumb) {
  const trail = (crumb || []).filter(Boolean).map(esc).join(' / ') || 'Home';
  return `<div class="tos-crumb"><span class="tos-back" data-back="${esc(appId || '')}">&#8592; Back</span><span>${trail}</span></div>`;
}

function renderList(items) {
  if (!items || !items.length) return '<div class="tos-empty">Nothing here.</div>';
  return items.map(it => `<div class="tos-list-item" data-open-item="${esc(it.id)}">
    <div class="tos-li-label"><span>${esc(it.label)}</span>${it.badge ? `<span class="tos-badge ${esc(it.badge)}">${esc(it.badge)}</span>` : ''}</div>
    ${it.sub ? `<div class="tos-li-sub">${esc(it.sub)}</div>` : ''}
  </div>`).join('');
}

function renderCategories(items) {
  if (!items || !items.length) return '<div class="tos-empty">Nothing active.</div>';
  return items.map(it => `<div class="tos-list-item" data-open-cat="${esc(it.id)}">
    <div class="tos-li-label"><span>${esc(it.label)}</span></div>
    ${it.sub ? `<div class="tos-li-sub">${esc(it.sub)}</div>` : ''}
  </div>`).join('');
}

// Prev/Next paging for a 'list' screen that returned a `page` field (currently
// just Skills & Stats). Both buttons re-nav the same screen with a `page:N`
// params token, which the app's buildScreen interprets (skills-app.js).
function renderPageNav(appId, breadcrumb, page) {
  const screenLabel = (breadcrumb || [])[breadcrumb.length - 1] || '';
  const prevDisabled = page.current <= 0;
  const nextDisabled = page.current >= page.total - 1;
  const target = (p) => `${esc(appId)}|${esc(screenLabel)}|${p}`;
  return `<div class="tos-page-nav">
    <span class="tos-page-btn${prevDisabled ? ' disabled' : ''}" data-page-nav="${target(page.current - 1)}">&#8592; Prev</span>
    <span>Page ${page.current + 1} / ${page.total}</span>
    <span class="tos-page-btn${nextDisabled ? ' disabled' : ''}" data-page-nav="${target(page.current + 1)}">Next &#8594;</span>
  </div>`;
}

function renderDetailRows(rows) {
  return (rows || []).map(r => `<div class="tos-row"><span>${esc(r.label)}</span><span>${esc(String(r.value ?? ''))}</span></div>`).join('');
}

// Settings — scoped to what Tablet actually depends on visually (the shared
// UI theme), not the full game settings panel. First (and only, for now)
// option is the theme: a compact inline picker for quick swaps, plus a link
// out to the full theme editor (client/shared/settings.js) for custom colors.
function renderTabletSettings() {
  const tt = loadTabletTheme();
  const linked = tt.linked !== false;
  // Linked: the swatch grid picks/previews the shared page theme (settings.js
  // theme id). Unlinked: it picks Tablet's own independent theme id instead —
  // the page's actual theme is untouched either way.
  const active = linked ? (loadSettings().theme || 'dark') : (tt.theme || 'dark');
  const swatch = ([id, label]) => `<div class="tos-theme-btn${id === active ? ' selected' : ''}" data-theme-pick="${esc(id)}">${esc(label)}</div>`;

  return `
    <div class="tos-detail-name">Tablet Theme</div>
    <div class="tos-detail-desc">${linked
      ? 'Linked to the shared UI theme — picking one below applies everywhere, not just the Tablet.'
      : 'Unlinked — the Tablet has its own theme now, independent of the shared UI theme.'}</div>
    <div class="tos-actions">
      <button class="tos-btn" data-toggle-link="1">${linked ? 'Unlink from UI Theme' : 'Relink to UI Theme'}</button>
      ${linked ? '<button class="tos-btn" data-open-theme-editor="1">Full Theme Editor&hellip;</button>' : ''}
    </div>
    ${renderSection('Dark', `<div class="tos-theme-grid">${DARK_THEMES.map(swatch).join('')}</div>`)}
    ${renderSection('Light', `<div class="tos-theme-grid">${LIGHT_THEMES.map(swatch).join('')}</div>`)}
  `;
}

// Labeled section (title + arbitrary HTML) — shared by the Corp dashboard and
// Settings' theme groups.
function renderSection(title, html) {
  return `<div style="margin-top:12px;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--tos-fg-dim)">${esc(title)}</div>${html}`;
}

// Corporation dashboard — reshapes plugins/corps' own buildConsolePayload()
// (via corp-app.js) into the Tablet's row/list styling instead of the
// standalone corp-console.js overlay's bespoke chassis.

function renderCorp(corp) {
  const t = corp.treasury || {};
  const net = (t.income || 0) - (t.upkeep || 0);
  const ti = corp.tierInfo || {};

  const members = (corp.members || []).map(m =>
    `<div class="tos-row"><span>${m.online ? '●' : '○'} ${esc(m.handle)}</span><span>${esc(m.rank)}</span></div>`
  ).join('') || '<div class="tos-empty">No members.</div>';

  const territory = (corp.territory || []).map(z =>
    `<div class="tos-row"><span>${esc(z.zone)}${z.status === 'CONTESTED' ? ' ⚠' : ''}</span><span>${esc(z.status)} · ${z.influence}%</span></div>`
  ).join('') || '<div class="tos-empty">No territory yet. Claim a contestable zone with "corp claim".</div>';

  const relations = (corp.relations || []).map(r =>
    `<div class="tos-row"><span>${esc(r.name)}</span><span>${esc(r.stance)}</span></div>`
  ).join('') || '<div class="tos-empty">No standing declarations.</div>';

  return `
    <div class="tos-detail-name">${esc(corp.name || 'CORPORATION')}${corp.tag ? ` [${esc(corp.tag)}]` : ''}</div>
    <div class="tos-detail-desc">Tier ${esc(String(corp.tier ?? 1))} · ${esc(corp.rank || '—')}</div>
    <div class="tos-row"><span>Treasury</span><span>₵${(t.balance || 0).toLocaleString()}</span></div>
    <div class="tos-row"><span>Income</span><span>+${t.income || 0}/day</span></div>
    <div class="tos-row"><span>Upkeep</span><span>-${t.upkeep || 0}/day (net ${net >= 0 ? '+' : ''}${net})</span></div>
    <div class="tos-row"><span>Members</span><span>${ti.members ?? (corp.members || []).length}/${ti.memberCap ?? '—'}</span></div>
    <div class="tos-row"><span>Territory</span><span>${ti.zones ?? (corp.territory || []).length}/${ti.slots ?? '—'} zones</span></div>
    ${renderSection('Operatives', members)}
    ${renderSection('Territory · Influence', territory)}
    ${renderSection('Diplomacy', relations)}
  `;
}

function renderObjectives(objectives) {
  if (!objectives || !objectives.length) return '';
  return `<div style="margin:10px 0">${objectives.map(o =>
    `<div class="tos-obj${o.done ? '' : ' pending'}"><span class="tos-check">${o.done ? '☑' : '☐'}</span><span>${esc(o.desc)}${o.need > 1 ? ` (${o.have}/${o.need})` : ''}</span></div>`
  ).join('')}</div>`;
}

// An action can carry `prompt` (a question string) when it needs free-text
// input the server can't derive from context (e.g. a contribution amount) —
// wireBody() asks via window.prompt() (same convention as who.js's kick-reason
// prompt) before sending the action, instead of every app inventing its own
// input widget.
function renderActions(appId, actions, params) {
  if (!actions || !actions.length) return '';
  return `<div class="tos-actions">${actions.map(a =>
    `<button class="tos-btn" data-act-id="${esc(a.id)}" data-act-app="${esc(appId)}" data-act-params="${esc(params || '')}"${a.prompt ? ` data-act-prompt="${esc(a.prompt)}"` : ''}>${esc(a.label)}</button>`
  ).join('')}</div>`;
}

function renderBody() {
  const d = _data;
  if (!d) return '';
  const hdr = renderHeader(d);
  const summary = renderSummary(d.player);

  if (d.screen === 'home' || !d.appId) {
    return `<div class="tos-body">${hdr}${summary}${renderHomeApps(d.apps)}</div>`;
  }

  // App screen. view: categories | list | detail | corp | tablet_settings | error
  if (d.view === 'tablet_settings') {
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(null, [d.appName])}${renderTabletSettings()}</div>`;
  }
  if (d.view === 'corp') {
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}
      ${renderCorp(d.corp || {})}
      ${renderActions(d.appId, d.actions, '')}
    </div>`;
  }
  if (d.view === 'error') {
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb || [d.appName])}<div class="tos-error">${esc(d.message || d.error || 'Something went wrong.')}</div></div>`;
  }
  if (d.view === 'categories') {
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(null, [d.appName])}${renderCategories(d.items)}</div>`;
  }
  if (d.view === 'list') {
    const pageNav = d.page ? renderPageNav(d.appId, d.breadcrumb, d.page) : '';
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb || [d.appName])}${renderList(d.items)}${pageNav}</div>`;
  }
  if (d.view === 'detail') {
    const det = d.detail || d.quest || {};
    const params = (d.quest && d.quest.id) || '';
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb || [d.appName])}
      <div class="tos-detail-name">${esc(det.name || '')}</div>
      ${det.desc ? `<div class="tos-detail-desc">${esc(det.desc)}</div>` : ''}
      ${renderObjectives(d.quest?.objectives)}
      ${renderDetailRows(det.rows)}
      ${renderActions(d.appId, d.actions, params)}
    </div>`;
  }
  return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, [d.appName])}<div class="tos-empty">Unknown screen.</div></div>`;
}

function wireBody() {
  _overlay.querySelectorAll('[data-nav-app]').forEach(el => {
    el.addEventListener('click', () => nav(el.getAttribute('data-nav-app'), null, null));
  });
  _overlay.querySelectorAll('[data-back]').forEach(el => {
    el.addEventListener('click', () => {
      const appId = el.getAttribute('data-back');
      const crumb = _data?.breadcrumb || [];
      // More than one crumb level deep -> go up one level (root of this app).
      // At the root already (or on home) -> go all the way back to Home.
      if (appId && crumb.length > 1) nav(appId, null, null);
      else home();
    });
  });
  _overlay.querySelectorAll('[data-open-cat]').forEach(el => {
    el.addEventListener('click', () => nav(_data.appId, el.getAttribute('data-open-cat'), null));
  });
  _overlay.querySelectorAll('[data-open-item]').forEach(el => {
    el.addEventListener('click', () => {
      // Item ids are opaque server keys (quest_id / skill name / vehicle id / …),
      // passed as the params token. Always resend the screen we're currently
      // on (not just when >1 level deep) — some ids (skill names like "Faction
      // Lore") contain spaces, and without a screenId token in front of them
      // the tokenizer would misread the id's first word AS the screenId.
      const id = el.getAttribute('data-open-item');
      const currentScreen = (_data.breadcrumb && _data.breadcrumb.length) ? _data.breadcrumb[_data.breadcrumb.length - 1] : null;
      nav(_data.appId, currentScreen, id);
    });
  });
  _overlay.querySelectorAll('[data-page-nav]').forEach(el => {
    el.addEventListener('click', () => {
      const [appId, screenLabel, pageStr] = el.getAttribute('data-page-nav').split('|');
      nav(appId, screenLabel, `page:${pageStr}`);
    });
  });
  _overlay.querySelectorAll('[data-act-id]').forEach(el => {
    el.addEventListener('click', () => {
      const promptText = el.getAttribute('data-act-prompt');
      let params = el.getAttribute('data-act-params');
      if (promptText) {
        const val = window.prompt(promptText);
        if (val == null || !val.trim()) return; // cancelled or empty — don't send anything
        params = val.trim();
      }
      act(el.getAttribute('data-act-app'), el.getAttribute('data-act-id'), params);
    });
  });

  // Settings theme picking is entirely client-side — no server round trip.
  // When linked, a pick applies the shared page theme (matches the main
  // settings panel exactly). When unlinked, it only sets Tablet's own
  // independent theme record — the page's actual theme is never touched.
  _overlay.querySelectorAll('[data-theme-pick]').forEach(el => {
    el.addEventListener('click', () => {
      sfx('hololock-set');
      const id = el.getAttribute('data-theme-pick');
      const tt = loadTabletTheme();
      if (tt.linked !== false) {
        const settings = loadSettings();
        settings.theme = id;
        settings.customColors = {}; // matches the main settings panel's theme-grid click (drops any in-progress custom edit)
        saveSettings(settings);
        applySettings(settings);
      } else {
        saveTabletTheme({ ...tt, theme: id });
      }
      applyTabletTheme(); // --tos-fg/--tos-btn-fg are baked inline; recompute against the new --bg2/--accent
      render(); // re-render so the .selected highlight follows the new pick
    });
  });
  _overlay.querySelector('[data-toggle-link]')?.addEventListener('click', () => {
    sfx('hololock-set');
    const tt = loadTabletTheme();
    const linked = tt.linked !== false;
    // Relinking: drop the unlinked theme id so a future unlink starts fresh
    // from whatever the page theme is at the time, rather than an odd default.
    saveTabletTheme(linked ? { linked: false, theme: tt.theme || 'dark' } : { linked: true });
    applyTabletTheme();
    render();
  });
  _overlay.querySelector('[data-open-theme-editor]')?.addEventListener('click', () => {
    const settings = loadSettings();
    const saveAndApply = () => { saveSettings(settings); applySettings(settings); };
    shutdownTablet(); // the theme editor overlay sits at a lower z-index than Tablet's; step out of the way
    openThemeEditor(settings, saveAndApply);
  });
}

// Drag the panel by its header bar, like the theme editor's floating window
// (client/shared/settings.js _makeDraggable). Switches from centered
// (left/top:50% + transform) to an explicit pixel position on first grab.
function makeDraggable(panel, handle) {
  if (!panel || !handle) return;
  handle.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return; // let the close button work normally
    e.preventDefault();
    const rect = panel.getBoundingClientRect();
    panel.style.left = rect.left + 'px';
    panel.style.top = rect.top + 'px';
    panel.style.transform = 'none';
    const offX = e.clientX - rect.left, offY = e.clientY - rect.top;
    const move = (ev) => {
      const x = Math.max(0, Math.min(ev.clientX - offX, window.innerWidth - 40));
      const y = Math.max(0, Math.min(ev.clientY - offY, window.innerHeight - 40));
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

// One-shot CRT power-on/off sounds — same shape as the TV's local synth defs
// (client/game/js/panels/tv.js TV_POWER_ON_DEF/TV_POWER_OFF_DEF), defined
// locally rather than added to the shared sfx-catalog since they're specific
// to this one panel.
const CRT_POWER_ON_DEF = {
  id: 'tablet_crt_power_on', category: 'sfx', priority: 3,
  config: { waveform: 'triangle', freq: 60, duration: 0.4, noiseMix: 0.25, pitchBend: { to: 700, time: 0.28 }, filter: { type: 'lowpass', freq: 3400, q: 1 }, adsr: { a: 0.004, d: 0.18, s: 0.25, r: 0.18 } },
};
const CRT_POWER_OFF_DEF = {
  id: 'tablet_crt_power_off', category: 'sfx', priority: 3,
  config: { waveform: 'triangle', freq: 900, duration: 0.3, noiseMix: 0.2, pitchBend: { to: 40, time: 0.25 }, filter: { type: 'lowpass', freq: 4000, q: 1 }, adsr: { a: 0.001, d: 0.05, s: 0.2, r: 0.2 } },
};

const CRT_ANIM_MS = 600;  // matches @keyframes tv-crt-poweron's 0.6s duration
const CRT_OFF_ANIM_MS = 550; // matches @keyframes tv-crt-shutoff's 0.55s duration
const BOOT_HOLD_MS = 1000; // "ARCHITECT OS" boot screen hold, per spec

// CRT power-off, mirroring tv.js's shutdownTvPanel: play the shutoff sound,
// collapse the tube via the same tv-crt-shutoff keyframes, then actually tear
// down the overlay once the animation finishes.
function shutdownTablet() {
  if (!_overlay) return;
  const panel = _overlay.querySelector('.tos-panel');
  if (!panel) { close(); return; }
  panel.classList.remove('tos-powering-on');
  panel.classList.add('tos-shutting-off');
  window.AudioEngine?.playSfx(CRT_POWER_OFF_DEF);
  panel.addEventListener('animationend', () => close(), { once: true });
  setTimeout(() => close(), CRT_OFF_ANIM_MS + 100); // backstop if animationend never fires
}

export function openTabletPanel(msg) {
  ensureChassisStyles();
  ensureStyles();
  _data = msg;

  if (!_overlay) {
    const html = `<div class="tos-anchor"><div class="tos-panel mg-chassis tos-powering-on">
      ${deviceHeader('&#9635;', 'ARCHITECT OS', 'Tablet Interface')}
      <div class="tos-bezel mg-bezel">${bezelScrews()}<div class="tos-screen mg-screen" style="--mg-sweep-h:420px" id="tos-screen-inner">
        <div class="tos-scroll" id="tos-scroll">
          <div class="tos-boot" id="tos-boot"><div class="tos-boot-logo">A</div><div class="tos-boot-title">ARCHITECT OS</div><div class="tos-boot-sub">Booting Tablet Interface&hellip;</div></div>
        </div>
        ${crtOverlays()}
      </div></div>
    </div></div>`;
    const mounted = mountOverlay({ id: 'tablet-os-overlay', html, onClose: () => { _data = null; }, closeOnBackdrop: false });
    _overlay = mounted.overlay;
    _close = mounted.close;
    _overlay.querySelector('.mg-close').addEventListener('click', shutdownTablet);
    makeDraggable(_overlay.querySelector('.tos-anchor'), _overlay.querySelector('.mg-head'));
    applyTabletTheme();
    window.AudioEngine?.init?.();
    window.AudioEngine?.playSfx(CRT_POWER_ON_DEF);
    // CRT expands (0.6s), "ARCHITECT OS" holds for ~1s, then the real screen
    // (home, or whatever screen this open navigated straight to) renders in.
    setTimeout(render, CRT_ANIM_MS + BOOT_HOLD_MS);
    return;
  }
  render();
}

function render() {
  if (!_overlay || !_data) return;
  const scroll = _overlay.querySelector('#tos-scroll');
  if (!scroll) return;
  scroll.innerHTML = renderBody();
  scroll.scrollTop = 0; // fresh screen always starts at the top, not wherever the last one left off
  wireBody();
  applyTabletTheme();
}

export function closeTabletPanel() { shutdownTablet(); }

function close() {
  if (_close) { _close(); _close = null; }
  _overlay = null;
}

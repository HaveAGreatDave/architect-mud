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
import { toggleAutoWalk, isAutoWalking, setGpsRoute, routeBetween, getTracePath, FUNC_LEGEND, POI_LEGEND } from './minimap.js';
import { state } from '../state.js';
import { loadSettings, saveSettings, applySettings, openThemeEditor, probeBuiltinThemeColors, DARK_THEMES, LIGHT_THEMES } from '/shared/settings.js';
import { getChatTabs, getChatMessages, sendChatMessage, markChatRead, onChatUpdate, getOnlinePlayers, refreshOnlinePlayers, ensureChatConversation, leaveChatConversation, removeCorpChannels, getClosedChatTabs, reopenChatTab } from './whisper.js';
import { showPromptDialog, showConfirmDialog } from './confirm.js';
import { parseMarkup } from '../markup.js';

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
let _pollTimer = null; // live-refresh interval for the Surveillance hub screen
let _wasSurvLive = false; // was the last render a live surveillance screen (scroll-preserve)
let _keepQuestScroll = false; // one-shot: preserve scroll on the next render (a live quest refresh)
let _keepThemeScroll = false; // one-shot: preserve scroll on the next render (picking within the theme sheet)
let _chatTab = null;   // Chat app: currently selected conversation key (channel id / PM handle, or CHAT_USERS_TAB)
const CHAT_USERS_TAB = '__users__'; // Chat app: the Users hub tab (online-player directory, not a real conversation)
let _chatUnsub = null; // Chat app: whisper.js update subscription (live re-render), null when not on chat
let _tosThemePicker = null;      // Settings: which theme selector sheet is open — null | 'ui' | 'tablet'
let _tosSetPage = 'General';     // Settings: active page tab (grouped like the game's settings)
let _tosMisRevealed = false; // Settings: has the hidden Mature Content (MIS) toggle been revealed
let _tosMisClicks = 0, _tosMisTimer = null; // decoy 3-click reveal counter
let _tosMisListenerBound = false; // one-time bind of the server mis_state_update sync
let _tosCorpSel = null; // Corp Territory Map: selected zone id (client-side, no round trip)
let _tosMapSel = null; // Map app: tapped/destination zone id (client-side, drives the GPS route)
let _backReturn = null; // { appId, screen }: the list/board a detail was drilled into from, so Back
                        // returns there (e.g. Quests → Job Board → posting → Back = Job Board) instead
                        // of the app root. Set on item-open; cleared by any other explicit nav/home.

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
    #tablet-os-overlay .tos-tile .tos-icon { font-size:24px; display:block; margin-bottom:6px; color:var(--tos-fg); }
    #tablet-os-overlay .tos-tile .tos-icon svg { width:26px; height:26px; display:inline-block; vertical-align:middle; }
    /* Two-tone: primary uses currentColor (theme fg); the .dim parts pick up a muted derived tone. */
    #tablet-os-overlay .tos-tile .tos-icon svg .dim { color:var(--tos-fg-dim2); }
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
    #tablet-os-overlay .tos-btn { padding:9px 14px; border-radius:5px; font-family:'Courier New',monospace; font-size:13.5px; font-weight:bold; letter-spacing:1px; text-transform:uppercase; cursor:pointer;
      color:var(--tos-btn-fg, #04120f); border:1px solid color-mix(in srgb, var(--mg-accent) 85%, black);
      background:linear-gradient(165deg, color-mix(in srgb, var(--mg-accent) 100%, white 20%), var(--mg-accent) 55%, color-mix(in srgb, var(--mg-accent) 100%, black 15%));
      box-shadow:0 0 10px color-mix(in srgb, var(--mg-accent) 45%, transparent), inset 0 1px 0 var(--tos-bevel-hi), inset 0 -3px 3px rgba(0,0,0,0.3), 0 2px 4px rgba(0,0,0,0.25);
      transition:filter .12s, box-shadow .12s, transform .05s; }
    #tablet-os-overlay .tos-btn:hover { filter:brightness(1.12); box-shadow:0 0 18px color-mix(in srgb, var(--mg-accent) 65%, transparent), inset 0 1px 0 var(--tos-bevel-hi), inset 0 -3px 3px rgba(0,0,0,0.3), 0 3px 6px rgba(0,0,0,0.3); }
    #tablet-os-overlay .tos-btn:active { transform:translateY(1px); box-shadow:inset 0 2px 4px rgba(0,0,0,0.35); }
    #tablet-os-overlay .tos-btn.disabled { opacity:.4; cursor:default; pointer-events:none; filter:grayscale(.5); }

    #tablet-os-overlay .tos-error { color:#ff7a86; font-size:13px; padding:16px 4px; text-align:center; }

    /* Corp: founding-cost warning + colour picker swatches */
    #tablet-os-overlay .tos-founding-warn { margin:12px 0; font-size:12px; line-height:1.5; color:var(--tos-fg-dim);
      border:1px solid color-mix(in srgb, var(--mg-accent) 24%, transparent); border-radius:6px; padding:9px 11px; background:var(--tos-surface-lo); }
    #tablet-os-overlay .tos-founding-warn b { color:var(--mg-accent); }
    #tablet-os-overlay .tos-swatches { display:flex; flex-wrap:wrap; gap:8px; margin-top:7px; }
    #tablet-os-overlay .tos-swatch { width:26px; height:26px; border-radius:6px; cursor:pointer; border:2px solid rgba(255,255,255,0.15);
      box-shadow:0 0 6px rgba(0,0,0,0.4); transition:transform .08s ease, filter .08s ease; }
    #tablet-os-overlay .tos-swatch:hover { filter:brightness(1.14); transform:scale(1.08); }
    #tablet-os-overlay .tos-swatch.sel { border-color:#fff; box-shadow:0 0 0 2px var(--mg-accent), 0 0 8px var(--mg-accent); }
    /* Free colour-wheel row (corp colour) — a big native swatch + live hex readout. */
    #tablet-os-overlay .tos-color-row { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:7px; }
    #tablet-os-overlay input.tos-color-lg { width:46px; height:34px; }
    #tablet-os-overlay .tos-color-hex { font-family:'Courier New',monospace; font-size:13px; letter-spacing:1px; color:var(--tos-fg); }
    #tablet-os-overlay .tos-color-hint { flex:1 1 100%; font-size:11px; color:var(--tos-fg-dim2); }

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
    /* Theme colour swatch — the theme previews itself (own bg + accent dot). */
    #tablet-os-overlay .tos-theme-sw { display:flex; align-items:center; gap:7px; cursor:pointer; padding:7px 8px; border-radius:6px; font-size:11.5px; overflow:hidden;
      border:1px solid color-mix(in srgb, var(--mg-accent) 22%, transparent); box-shadow:inset 0 1px 0 rgba(255,255,255,.10), 0 1px 3px rgba(0,0,0,.25);
      transition:transform .05s, box-shadow .12s, filter .12s; }
    #tablet-os-overlay .tos-theme-sw:hover { filter:brightness(1.08); }
    #tablet-os-overlay .tos-theme-sw:active { transform:translateY(1px); }
    #tablet-os-overlay .tos-theme-sw.selected { border-color:var(--mg-accent); box-shadow:0 0 0 2px var(--mg-accent), 0 0 9px color-mix(in srgb, var(--mg-accent) 45%, transparent); }
    #tablet-os-overlay .tos-theme-sw .tos-sw-dots { display:flex; gap:2px; flex:0 0 auto; }
    #tablet-os-overlay .tos-theme-sw .tos-sw-dot { width:8px; height:8px; border-radius:50%; flex:0 0 auto; border:1px solid rgba(0,0,0,.4); box-shadow:0 0 3px rgba(0,0,0,.3); }
    #tablet-os-overlay .tos-theme-sw .tos-sw-name { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    /* Compact theme trigger — the active theme as a single swatch that opens the
       picker sheet, instead of laying the whole swatch list out on the page. */
    #tablet-os-overlay .tos-theme-trigger { display:flex; align-items:center; gap:7px; cursor:pointer; min-width:150px; max-width:52vw; padding:6px 9px; border-radius:6px; font-size:12px; overflow:hidden;
      border:1px solid color-mix(in srgb, var(--mg-accent) 30%, transparent); box-shadow:inset 0 1px 0 rgba(255,255,255,.10), 0 1px 3px rgba(0,0,0,.25);
      transition:transform .05s, filter .12s; }
    #tablet-os-overlay .tos-theme-trigger:hover { filter:brightness(1.1); }
    #tablet-os-overlay .tos-theme-trigger:active { transform:translateY(1px); }
    #tablet-os-overlay .tos-theme-trigger .tos-sw-ac { width:13px; height:13px; border-radius:50%; flex:0 0 auto; box-shadow:0 0 5px currentColor; border:1px solid rgba(0,0,0,.35); }
    #tablet-os-overlay .tos-theme-trigger .tos-sw-name { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    #tablet-os-overlay .tos-theme-trigger .tos-trigger-caret { flex:0 0 auto; font-size:11px; opacity:.75; }
    /* Theme-picker sheet — the scrollable list that slides up over the settings
       screen when a theme trigger is tapped. */
    #tablet-os-overlay .tos-theme-sheet { animation:tos-sheet-in .18s ease-out; }
    #tablet-os-overlay .tos-sheet-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding-bottom:8px; margin-bottom:4px;
      border-bottom:1px solid color-mix(in srgb, var(--mg-accent) 22%, transparent); font-size:13px; letter-spacing:.5px; color:var(--mg-accent); font-weight:bold; }
    @keyframes tos-sheet-in { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }

    /* Full settings app — option-pill rows, sliders, colour swatch. Mirrors the
       game settings panel's groups, restyled in the tablet's bevel language.
       Pill groups reuse the theme-btn look at a smaller scale; a selected pill
       lights up in the accent like a theme swatch. */
    /* Settings page tabs — grouped pages instead of one long scroll (mirrors the
       game settings' grouping: Appearance / Layout / Sound / Game). */
    #tablet-os-overlay .tos-set-tabs { display:flex; gap:6px; margin-bottom:4px; flex-wrap:wrap; }
    #tablet-os-overlay .tos-set-tab { cursor:pointer; padding:6px 12px; border-radius:6px 6px 0 0; font-size:12px; letter-spacing:.5px; color:var(--tos-fg-dim);
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo));
      border:1px solid color-mix(in srgb, var(--mg-accent) 22%, transparent); border-bottom:none;
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi); transition:filter .12s; }
    #tablet-os-overlay .tos-set-tab:hover { filter:brightness(1.15); }
    #tablet-os-overlay .tos-set-tab.sel { color:var(--mg-accent); font-weight:bold; border-color:var(--mg-accent); box-shadow:0 -2px 8px color-mix(in srgb, var(--mg-accent) 22%, transparent), inset 0 1px 0 var(--tos-bevel-hi); }
    #tablet-os-overlay .tos-set-page { border-top:1px solid color-mix(in srgb, var(--mg-accent) 22%, transparent); padding-top:4px; }
    #tablet-os-overlay .tos-set-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:8px 0; border-bottom:1px solid color-mix(in srgb, var(--mg-accent) 12%, transparent); }
    #tablet-os-overlay .tos-set-label { font-size:13px; color:var(--tos-fg); }
    #tablet-os-overlay .tos-set-val { font-size:11px; color:var(--tos-fg-dim); margin-left:6px; }
    #tablet-os-overlay .tos-opts { display:flex; gap:5px; flex-wrap:wrap; justify-content:flex-end; }
    #tablet-os-overlay .tos-opt { cursor:pointer; min-width:30px; text-align:center; padding:5px 9px; border-radius:5px; font-size:13px; line-height:1.1;
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo));
      border:1px solid color-mix(in srgb, var(--mg-accent) 24%, transparent); color:var(--tos-fg);
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi), inset 0 -1px 1px var(--tos-bevel-lo);
      transition:filter .12s, box-shadow .12s, transform .05s; }
    #tablet-os-overlay .tos-opt:hover { filter:brightness(1.15); }
    #tablet-os-overlay .tos-opt:active { transform:translateY(1px); box-shadow:inset 0 2px 3px var(--tos-bevel-lo); }
    #tablet-os-overlay .tos-opt.selected { border-color:var(--mg-accent); color:var(--mg-accent); font-weight:bold; box-shadow:0 0 8px color-mix(in srgb, var(--mg-accent) 35%, transparent), inset 0 1px 0 var(--tos-bevel-hi); }
    #tablet-os-overlay .tos-slider { width:160px; max-width:46vw; accent-color:var(--mg-accent); cursor:pointer; }
    #tablet-os-overlay input.tos-color { width:34px; height:26px; padding:0; border:1px solid color-mix(in srgb, var(--mg-accent) 30%, transparent); border-radius:4px; background:none; cursor:pointer; vertical-align:middle; }
    /* Smaller secondary buttons (Full Theme Editor…, Tablet Theme…) so they sit
       under a section without the full accent-fill weight of a .tos-btn. */
    #tablet-os-overlay .tos-btn-sub { display:inline-block; cursor:pointer; margin-top:8px; padding:6px 11px; border-radius:5px; font-size:12px; letter-spacing:.5px; color:var(--mg-accent);
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo));
      border:1px solid color-mix(in srgb, var(--mg-accent) 40%, transparent);
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi), inset 0 -1px 1px var(--tos-bevel-lo); }
    #tablet-os-overlay .tos-btn-sub:hover { filter:brightness(1.15); }
    #tablet-os-overlay .tos-btn-sub:active { transform:translateY(1px); box-shadow:inset 0 2px 3px var(--tos-bevel-lo); }
    /* Mature Content decoy — an unlabelled blank strip that hides the MIS toggle
       until triple-clicked (mirrors the legacy panel's hidden reveal). */
    #tablet-os-overlay .tos-mis-decoy { height:26px; margin-top:16px; border-radius:5px; background:var(--tos-surface-lo); cursor:default; }

    /* ── Surveillance (SPECTER) hub ──────────────────────────────────────────
       A green-phosphor multi-feed panel inside the tablet: network header, an
       alerts strip, a grid of live camera tiles (frame text + REC badge), and a
       focus pane with record/clip controls. Deliberately CRT/monochrome-green
       (--shub) rather than the tablet's theme accent, so a feed reads as a feed. */
    /* Phosphor-green feed colour, but adapted to the screen background so it
       stays legible on light themes (bright mint on a cream bg is unreadable) —
       --tos-shub is set by applyTabletTheme() from the effective bg luminance. */
    #tablet-os-overlay .tos-surv { --shub: var(--tos-shub, #39ff9e); }
    #tablet-os-overlay .tos-surv-hdr { display:flex; justify-content:space-between; align-items:center; font-size:12px; letter-spacing:1.5px; text-transform:uppercase; color:var(--shub); margin-bottom:8px; text-shadow:0 0 8px color-mix(in srgb, var(--shub) 55%, transparent); }
    #tablet-os-overlay .tos-surv-hdr .tos-surv-rec { color:#ff5a68; }
    #tablet-os-overlay .tos-alerts { display:flex; flex-direction:column; gap:3px; margin-bottom:9px; max-height:74px; overflow-y:auto; }
    #tablet-os-overlay .tos-alert { font-size:11px; color:color-mix(in srgb, var(--shub) 80%, #fff); background:color-mix(in srgb, var(--shub) 8%, var(--bg,#0c1114)); border-left:2px solid var(--shub); padding:2px 7px; border-radius:2px; }
    #tablet-os-overlay .tos-alert b { color:var(--shub); }
    #tablet-os-overlay .tos-cam-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:8px; }
    #tablet-os-overlay .tos-cam { cursor:pointer; border:1px solid color-mix(in srgb, var(--shub) 34%, transparent); border-radius:5px; overflow:hidden;
      background:linear-gradient(160deg, color-mix(in srgb, var(--shub) 10%, var(--bg2,#12181b)), var(--bg,#0c1114));
      transition:filter .12s, box-shadow .12s, transform .05s; }
    #tablet-os-overlay .tos-cam:hover { filter:brightness(1.12); box-shadow:0 0 10px color-mix(in srgb, var(--shub) 30%, transparent); }
    #tablet-os-overlay .tos-cam:active { transform:translateY(1px); }
    #tablet-os-overlay .tos-cam.sel { border-color:var(--shub); box-shadow:0 0 12px color-mix(in srgb, var(--shub) 42%, transparent); }
    #tablet-os-overlay .tos-cam-head { display:flex; justify-content:space-between; gap:6px; align-items:baseline; padding:5px 7px 3px; font-size:11.5px; color:color-mix(in srgb, var(--shub) 85%, #fff); }
    #tablet-os-overlay .tos-cam-head .tos-cam-kind { font-size:9.5px; letter-spacing:1px; text-transform:uppercase; color:var(--tos-fg-dim2); }
    #tablet-os-overlay .tos-cam-feed { position:relative; min-height:56px; padding:6px 8px; margin:0 6px; border-radius:3px; font-size:11px; line-height:1.35; color:color-mix(in srgb, var(--shub) 88%, #fff);
      background:var(--bg,#0a0e10); border:1px solid color-mix(in srgb, var(--shub) 18%, transparent);
      background-image:repeating-linear-gradient(0deg, transparent 0 2px, rgba(0,0,0,0.28) 2px 3px); text-shadow:0 0 5px color-mix(in srgb, var(--shub) 45%, transparent); }
    #tablet-os-overlay .tos-cam-feed.dead { color:var(--tos-fg-dim2); text-align:center; display:flex; align-items:center; justify-content:center; letter-spacing:2px; text-transform:uppercase; font-size:10.5px; text-shadow:none; }
    #tablet-os-overlay .tos-cam-foot { display:flex; justify-content:space-between; align-items:center; gap:6px; padding:4px 7px 6px; font-size:10px; color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-rec { color:#ff5a68; font-weight:bold; letter-spacing:1px; text-shadow:0 0 6px rgba(255,90,104,.6); }
    #tablet-os-overlay .tos-rec .tos-rec-dot { animation:tos-rec-blink 1.1s steps(1) infinite; }
    @keyframes tos-rec-blink { 0%,50%{opacity:1} 51%,100%{opacity:.25} }
    #tablet-os-overlay .tos-cam-focus { margin-bottom:10px; border:1px solid var(--shub); border-radius:6px; padding:8px; background:color-mix(in srgb, var(--shub) 7%, var(--bg,#0c1114)); box-shadow:0 0 14px color-mix(in srgb, var(--shub) 22%, transparent); }
    #tablet-os-overlay .tos-cam-focus .tos-cam-feed { min-height:82px; margin:0; font-size:12px; }
    #tablet-os-overlay .tos-surv-links { display:flex; gap:8px; margin:11px 0 3px; }
    #tablet-os-overlay .tos-surv-link { cursor:pointer; font-size:11px; letter-spacing:1px; text-transform:uppercase; color:var(--shub); border:1px solid color-mix(in srgb, var(--shub) 40%, transparent); border-radius:4px; padding:5px 11px;
      background:color-mix(in srgb, var(--shub) 10%, var(--bg2,#12181b)); }
    #tablet-os-overlay .tos-surv-link:hover { filter:brightness(1.15); box-shadow:0 0 10px color-mix(in srgb, var(--shub) 30%, transparent); }
    #tablet-os-overlay .tos-buf-head { margin:9px 0 4px; font-size:9.5px; letter-spacing:1.5px; text-transform:uppercase; color:color-mix(in srgb, var(--shub) 70%, #fff); }
    #tablet-os-overlay .tos-buf { max-height:120px; overflow-y:auto; border:1px solid color-mix(in srgb, var(--shub) 22%, transparent); border-radius:3px; background:var(--bg,#0a0e10); padding:5px 7px; font-size:11px; line-height:1.45;
      background-image:repeating-linear-gradient(0deg, transparent 0 2px, rgba(0,0,0,0.22) 2px 3px); }
    #tablet-os-overlay .tos-buf.empty { color:var(--tos-fg-dim2); font-size:11px; padding:8px 7px; text-align:center; }
    #tablet-os-overlay .tos-buf-line { color:color-mix(in srgb, var(--shub) 85%, #fff); padding:1px 0; }
    #tablet-os-overlay .tos-buf-t { color:var(--tos-fg-dim2); font-size:9.5px; }
    #tablet-os-overlay .tos-buf::-webkit-scrollbar { width:5px; }
    #tablet-os-overlay .tos-buf::-webkit-scrollbar-thumb { background:color-mix(in srgb, var(--shub) 30%, transparent); border-radius:3px; }

    /* ── Chat app ─────────────────────────────────────────────────────────────
       The same conversations as the floating chat window (corp #<name>, #arcnet,
       open PMs), reshaped into the tablet's bevel language. A horizontal strip of
       conversation chips, a scrolling message log, and a send row. */
    #tablet-os-overlay .tos-chat { display:flex; flex-direction:column; gap:9px; }
    #tablet-os-overlay .tos-chat-tabs { display:flex; gap:6px; overflow-x:auto; padding-bottom:3px; }
    #tablet-os-overlay .tos-chat-tab { position:relative; cursor:pointer; white-space:nowrap; padding:6px 11px; border-radius:5px; font-size:12px; letter-spacing:.5px; color:var(--tos-fg-dim);
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo));
      border:1px solid color-mix(in srgb, var(--mg-accent) 24%, transparent);
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi), inset 0 -1px 1px var(--tos-bevel-lo);
      transition:filter .12s, box-shadow .12s, transform .05s; }
    #tablet-os-overlay .tos-chat-tab:hover { filter:brightness(1.15); }
    #tablet-os-overlay .tos-chat-tab:active { transform:translateY(1px); }
    #tablet-os-overlay .tos-chat-tab.sel { border-color:var(--mg-accent); color:var(--mg-accent); font-weight:bold; box-shadow:0 0 8px color-mix(in srgb, var(--mg-accent) 35%, transparent), inset 0 1px 0 var(--tos-bevel-hi); }
    #tablet-os-overlay .tos-chat-pip { margin-left:6px; font-size:9.5px; font-weight:bold; color:#fff; background:var(--red,#e0413a); border-radius:8px; padding:0 5px; line-height:15px; display:inline-block; vertical-align:middle; }
    #tablet-os-overlay .tos-chat-x { margin-left:7px; font-size:10px; line-height:1; color:var(--tos-fg-dim2); border:1px solid color-mix(in srgb, var(--mg-accent) 22%, transparent); border-radius:3px; padding:1px 4px; vertical-align:middle; }
    #tablet-os-overlay .tos-chat-x:hover { color:#fff; border-color:var(--red,#e0413a); background:color-mix(in srgb, var(--red,#e0413a) 30%, transparent); }
    #tablet-os-overlay .tos-chat-log { height:320px; max-height:44vh; overflow-y:auto; padding:9px 10px; border-radius:6px;
      background:var(--bg, #0c1114); border:1px solid color-mix(in srgb, var(--mg-accent) 18%, transparent);
      box-shadow:inset 0 1px 3px rgba(0,0,0,0.35); font-size:13px; line-height:1.45; }
    #tablet-os-overlay .tos-chat-log::-webkit-scrollbar { width:6px; }
    #tablet-os-overlay .tos-chat-log::-webkit-scrollbar-thumb { background:var(--border); border-radius:3px; }
    #tablet-os-overlay .tos-chat-msg { padding:4px 0; border-bottom:1px solid color-mix(in srgb, var(--mg-accent) 10%, transparent); }
    #tablet-os-overlay .tos-chat-from { display:block; font-size:11px; color:var(--mg-accent); margin-bottom:2px; }
    #tablet-os-overlay .tos-chat-from.me { color:var(--tos-fg-dim); font-style:italic; }
    #tablet-os-overlay .tos-chat-text { color:var(--tos-fg); word-break:break-word; }
    #tablet-os-overlay .tos-chat-input-row { display:flex; gap:8px; align-items:center; }
    /* Input blends with the message-log background (same --bg) with a legible,
       high-contrast text colour (--tos-fg), rather than a mismatched dark box. */
    #tablet-os-overlay .tos-chat-input-row input { flex:1; min-width:0; background:var(--bg, #0c1114); border:1px solid color-mix(in srgb, var(--mg-accent) 28%, transparent);
      color:var(--tos-fg); font-family:'Courier New',monospace; font-size:13px; padding:8px 10px; border-radius:5px; outline:none; }
    #tablet-os-overlay .tos-chat-input-row input::placeholder { color:var(--tos-fg-dim2); }
    #tablet-os-overlay .tos-chat-input-row input:focus { border-color:var(--mg-accent); box-shadow:0 0 6px color-mix(in srgb, var(--mg-accent) 30%, transparent); }
    /* Users hub — a directory of players online now (its own tab), each row
       tappable to open/start a PM. Fills the same space the message log would. */
    #tablet-os-overlay .tos-chat-users { display:flex; flex-direction:column; border-radius:6px; overflow:hidden;
      background:var(--bg, #0c1114); border:1px solid color-mix(in srgb, var(--mg-accent) 18%, transparent);
      box-shadow:inset 0 1px 3px rgba(0,0,0,0.35); }
    #tablet-os-overlay .tos-chat-users-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 10px;
      font-size:9.5px; letter-spacing:1px; text-transform:uppercase; color:var(--tos-fg-dim2);
      border-bottom:1px solid color-mix(in srgb, var(--mg-accent) 14%, transparent); }
    #tablet-os-overlay .tos-chat-userlist { max-height:320px; overflow-y:auto; }
    #tablet-os-overlay .tos-chat-userlist::-webkit-scrollbar { width:6px; }
    #tablet-os-overlay .tos-chat-userlist::-webkit-scrollbar-thumb { background:var(--border); border-radius:3px; }
    #tablet-os-overlay .tos-chat-user { display:flex; align-items:center; justify-content:space-between; gap:8px; cursor:pointer;
      padding:9px 11px; font-size:13px; color:var(--tos-fg); border-bottom:1px solid color-mix(in srgb, var(--mg-accent) 10%, transparent);
      transition:background .12s; }
    #tablet-os-overlay .tos-chat-user:last-child { border-bottom:none; }
    #tablet-os-overlay .tos-chat-user:hover { background:color-mix(in srgb, var(--mg-accent) 12%, transparent); }
    #tablet-os-overlay .tos-chat-user:active { background:color-mix(in srgb, var(--mg-accent) 20%, transparent); }
    #tablet-os-overlay .tos-chat-user-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    #tablet-os-overlay .tos-chat-user-pm { flex:0 0 auto; font-size:14px; color:var(--mg-accent); }
    #tablet-os-overlay .tos-chat-none { font-size:11px; color:var(--tos-fg-dim2); }
    #tablet-os-overlay .tos-chat-refresh { flex:0 0 auto; cursor:pointer; font-size:12px; color:var(--tos-fg-dim); border:1px solid color-mix(in srgb, var(--mg-accent) 24%, transparent); border-radius:4px; padding:4px 8px;
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo)); box-shadow:inset 0 1px 0 var(--tos-bevel-hi); }
    #tablet-os-overlay .tos-chat-refresh:hover { filter:brightness(1.15); }

    /* ── Corp Territory Map ───────────────────────────────────────────────────
       The strategic grid ported from the corp-map overlay: zones on a 2n-1 grid,
       org-colour fill + glow, ascii road links, tap-to-inspect. Scrolls inside
       .tos-cm-wrap; the detail block below shows the selected zone. */
    #tablet-os-overlay .tos-cm-wrap { max-height:300px; overflow:auto; scrollbar-width:thin; scrollbar-color:color-mix(in srgb,var(--mg-accent) 40%,transparent) transparent;
      background:radial-gradient(130% 130% at 50% 40%, color-mix(in srgb, var(--mg-accent) 8%, var(--bg,#030806)) 55%, var(--bg,#01050a) 100%); border:1px solid color-mix(in srgb,var(--mg-accent) 20%,transparent); border-radius:6px; padding:8px; }
    #tablet-os-overlay .tos-cm-wrap::-webkit-scrollbar { width:7px; height:7px; }
    #tablet-os-overlay .tos-cm-wrap::-webkit-scrollbar-thumb { background:color-mix(in srgb,var(--mg-accent) 35%,transparent); border-radius:5px; }
    #tablet-os-overlay .tos-cm-grid { display:grid; }
    #tablet-os-overlay .tos-cm-tile { position:relative; border-radius:4px; border:1px solid #00000066; cursor:pointer; overflow:hidden;
      display:flex; flex-direction:column; justify-content:space-between; padding:2px 3px; background:color-mix(in srgb,var(--mg-accent) 8%,var(--bg2,#0b1116)); color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-cm-tile:hover { filter:brightness(1.18); }
    #tablet-os-overlay .tos-cm-tile.open { border:1px dashed color-mix(in srgb,var(--mg-accent) 30%,transparent); }
    #tablet-os-overlay .tos-cm-tile.safe { opacity:.7; }
    #tablet-os-overlay .tos-cm-tile.contested { animation:tos-cm-pulse 1.4s ease-in-out infinite; }
    @keyframes tos-cm-pulse { 0%,100%{box-shadow:inset 0 0 0 2px rgba(255,207,74,.25)} 50%{box-shadow:inset 0 0 0 2px rgba(255,207,74,.95),0 0 9px rgba(255,207,74,.5)} }
    #tablet-os-overlay .tos-cm-tile.sel { outline:2px solid #fff; outline-offset:-2px; z-index:3; }
    #tablet-os-overlay .tos-cm-tile .tn { font-size:8px; line-height:1.05; font-weight:700; }
    #tablet-os-overlay .tos-cm-tile .ti { font-size:8px; font-weight:700; opacity:.92; }
    #tablet-os-overlay .tos-cm-tile .b-cur { position:absolute; top:0; right:2px; font-size:9px; color:#fff; text-shadow:0 0 4px #000; }
    #tablet-os-overlay .tos-cm-tile .b-hq { position:absolute; top:0; left:2px; font-size:8px; opacity:.85; }
    #tablet-os-overlay .tos-cm-tile .b-star { position:absolute; bottom:0; right:2px; font-size:9px; color:#ffd54a; text-shadow:0 0 5px rgba(255,213,74,.8); }
    #tablet-os-overlay .tos-cm-link { display:flex; align-items:center; justify-content:center; color:color-mix(in srgb,var(--mg-accent) 40%,transparent); font-size:12px; line-height:1; pointer-events:none; }
    #tablet-os-overlay .tos-cm-link.art { color:#c9a24a; font-weight:bold; text-shadow:0 0 6px rgba(201,162,74,.55); }
    #tablet-os-overlay .tos-cm-legend { display:flex; flex-wrap:wrap; gap:6px 12px; margin:9px 0 4px; font-size:10px; color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-cm-lg { display:flex; align-items:center; gap:4px; }
    #tablet-os-overlay .tos-cm-lg .sw { width:10px; height:10px; border-radius:2px; }
    #tablet-os-overlay .tos-cm-detail { margin-top:6px; border-top:1px solid color-mix(in srgb,var(--mg-accent) 16%,transparent); padding-top:8px; }
    #tablet-os-overlay .tos-cm-note { font-size:11.5px; color:var(--tos-fg-dim); line-height:1.5; padding:6px 2px; }
    #tablet-os-overlay .tos-cm-tug { position:relative; height:12px; border-radius:6px; background:#ff5a6a; overflow:hidden; border:1px solid #000; margin-top:4px; }
    #tablet-os-overlay .tos-cm-tug i { display:block; height:100%; background:linear-gradient(90deg,var(--mg-accent),#7bffb0); box-shadow:0 0 8px var(--mg-accent); }
    #tablet-os-overlay .tos-cm-tugrow { display:flex; justify-content:space-between; font-size:10px; margin:3px 0 8px; }
    #tablet-os-overlay .tos-cm-tugrow .my { color:var(--mg-accent); } #tablet-os-overlay .tos-cm-tugrow .rv { color:#ff5a6a; } #tablet-os-overlay .tos-cm-tugrow .dim { color:var(--tos-fg-dim2); }
    #tablet-os-overlay .tos-btn.tos-btn-hot { color:#fff; border-color:#ff5a6a;
      background:linear-gradient(165deg, #ff7a86, #ff5a6a 55%, #c93a46);
      box-shadow:0 0 10px rgba(255,90,106,.5), inset 0 1px 0 var(--tos-bevel-hi), inset 0 -3px 3px rgba(0,0,0,0.3); }

    /* ── Map app ─────────────────────────────────────────────────────────────
       A tablet-native version of the full-screen city map: a mode switcher
       (interior/zone/regional), a GPS toolbar, and the same 2n-1 expanded grid
       the corp map uses — but with the full map's land-use / danger / POI look.
       Tap a tile to plot a GPS route to it (mirrored to the sidebar minimap). */
    #tablet-os-overlay .tos-map-tabs { display:flex; gap:6px; margin-bottom:8px; flex-wrap:wrap; }
    #tablet-os-overlay .tos-map-tab { cursor:pointer; padding:6px 13px; border-radius:6px; font-size:12px; letter-spacing:.5px; text-transform:uppercase; color:var(--tos-fg-dim);
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo));
      border:1px solid color-mix(in srgb, var(--mg-accent) 22%, transparent); box-shadow:inset 0 1px 0 var(--tos-bevel-hi); transition:filter .12s; }
    #tablet-os-overlay .tos-map-tab:hover { filter:brightness(1.15); }
    #tablet-os-overlay .tos-map-tab.sel { color:var(--mg-accent); font-weight:bold; border-color:var(--mg-accent); box-shadow:0 0 8px color-mix(in srgb, var(--mg-accent) 25%, transparent), inset 0 1px 0 var(--tos-bevel-hi); }
    #tablet-os-overlay .tos-map-tab.disabled { opacity:.35; pointer-events:none; }
    #tablet-os-overlay .tos-map-bar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:8px; font-size:12px; color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-map-bar .tos-map-route { flex:1 1 auto; min-width:120px; }
    #tablet-os-overlay .tos-map-bar .tos-map-route b { color:var(--mg-accent); }
    #tablet-os-overlay .tos-map-mini { cursor:pointer; padding:6px 11px; border-radius:5px; font-size:11.5px; letter-spacing:.5px; text-transform:uppercase; color:var(--mg-accent);
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo));
      border:1px solid color-mix(in srgb, var(--mg-accent) 40%, transparent); box-shadow:inset 0 1px 0 var(--tos-bevel-hi), inset 0 -1px 1px var(--tos-bevel-lo); }
    #tablet-os-overlay .tos-map-mini:hover { filter:brightness(1.15); }
    #tablet-os-overlay .tos-map-mini:active { transform:translateY(1px); }
    #tablet-os-overlay .tos-map-mini.active { color:#04120f; background:linear-gradient(165deg, color-mix(in srgb, var(--mg-accent) 100%, white 15%), var(--mg-accent)); box-shadow:0 0 10px color-mix(in srgb, var(--mg-accent) 45%, transparent); }
    #tablet-os-overlay .tos-map-mini.disabled { opacity:.35; pointer-events:none; }
    #tablet-os-overlay .tos-map-wrap { max-height:320px; overflow:auto; scrollbar-width:thin; scrollbar-color:color-mix(in srgb,var(--mg-accent) 40%,transparent) transparent;
      background:radial-gradient(130% 130% at 50% 40%, color-mix(in srgb, var(--mg-accent) 7%, var(--bg,#030806)) 55%, var(--bg,#01050a) 100%); border:1px solid color-mix(in srgb,var(--mg-accent) 20%,transparent); border-radius:6px; padding:8px; }
    #tablet-os-overlay .tos-map-wrap::-webkit-scrollbar { width:7px; height:7px; }
    #tablet-os-overlay .tos-map-wrap::-webkit-scrollbar-thumb { background:color-mix(in srgb,var(--mg-accent) 35%,transparent); border-radius:5px; }
    #tablet-os-overlay .tos-map-grid { display:grid; }
    #tablet-os-overlay .tos-map-tile { position:relative; border-radius:4px; border:1px solid #00000066; cursor:pointer; overflow:hidden;
      display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1px; padding:2px 3px; text-align:center;
      background:color-mix(in srgb,var(--mg-accent) 6%,var(--bg2,#0b1116)); color:var(--tos-fg-dim); transition:filter .12s; }
    #tablet-os-overlay .tos-map-tile:hover { filter:brightness(1.2); }
    /* Danger tint — a coloured left rail, echoing the full map's danger reading. */
    #tablet-os-overlay .tos-map-tile.d-low    { box-shadow:inset 3px 0 0 rgba(205,180,70,.65); }
    #tablet-os-overlay .tos-map-tile.d-medium { box-shadow:inset 3px 0 0 rgba(220,140,55,.7); }
    #tablet-os-overlay .tos-map-tile.d-high   { box-shadow:inset 3px 0 0 rgba(212,70,60,.8); }
    #tablet-os-overlay .tos-map-tile.d-lethal { box-shadow:inset 3px 0 0 rgba(214,55,55,.95); animation:tos-map-lethal 1.6s ease-in-out infinite; }
    @keyframes tos-map-lethal { 0%,100%{filter:none} 50%{filter:brightness(1.25)} }
    #tablet-os-overlay .tos-map-tile.unreach { opacity:.4; }
    #tablet-os-overlay .tos-map-tile.on-route { outline:2px solid #ffcf4a; outline-offset:-2px; z-index:2; }
    #tablet-os-overlay .tos-map-tile.dest { outline:2px solid #fff; }
    #tablet-os-overlay .tos-map-tile.sel { outline:2px dashed var(--mg-accent); outline-offset:-2px; z-index:3; }
    #tablet-os-overlay .tos-map-tile.cur { border-color:var(--mg-accent); box-shadow:0 0 9px color-mix(in srgb,var(--mg-accent) 60%,transparent), inset 0 0 0 1px var(--mg-accent); }
    #tablet-os-overlay .tos-map-tile .mt-icon { font-size:13px; line-height:1; }
    #tablet-os-overlay .tos-map-tile .mt-name { font-size:7.5px; line-height:1.05; font-weight:700; letter-spacing:.2px; }
    #tablet-os-overlay .tos-map-tile .mt-you { position:absolute; top:0; right:2px; font-size:9px; color:var(--mg-accent); text-shadow:0 0 4px #000; }
    #tablet-os-overlay .tos-map-tile .mt-dest { position:absolute; top:0; left:2px; font-size:9px; color:#ffcf4a; text-shadow:0 0 4px #000; }
    #tablet-os-overlay .tos-map-link { display:flex; align-items:center; justify-content:center; color:color-mix(in srgb,var(--mg-accent) 40%,transparent); font-size:12px; line-height:1; pointer-events:none; }
    #tablet-os-overlay .tos-map-link.art { color:#c9a24a; font-weight:bold; text-shadow:0 0 6px rgba(201,162,74,.55); }
    #tablet-os-overlay .tos-map-legend { display:flex; flex-wrap:wrap; gap:5px 12px; margin:9px 0 4px; font-size:10px; color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-map-detail { margin-top:6px; border-top:1px solid color-mix(in srgb,var(--mg-accent) 16%,transparent); padding-top:8px; }
    #tablet-os-overlay .tos-map-note { font-size:11.5px; color:var(--tos-fg-dim); line-height:1.5; padding:6px 2px; }

    /* ── News app ──────────────────────────────────────────────────────────────
       A stack of section cards (a "feed"). Each card is a raised bevel surface
       like the list rows, with a header strip (title + optional subtitle) over a
       type-specific widget body. */
    #tablet-os-overlay .tos-news-sec { border-radius:7px; margin-bottom:11px; overflow:hidden;
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo));
      border:1px solid color-mix(in srgb, var(--mg-accent) 26%, transparent);
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi), inset 0 -2px 3px var(--tos-bevel-lo), 0 2px 5px rgba(0,0,0,0.2); }
    #tablet-os-overlay .tos-news-head { display:flex; align-items:baseline; justify-content:space-between; gap:8px; flex-wrap:wrap;
      padding:9px 11px; border-bottom:1px solid color-mix(in srgb, var(--mg-accent) 18%, transparent);
      background:color-mix(in srgb, var(--mg-accent) 10%, transparent); }
    #tablet-os-overlay .tos-news-title { font-size:13.5px; font-weight:bold; letter-spacing:.5px; color:var(--tos-fg); }
    #tablet-os-overlay .tos-news-sub { font-size:11px; letter-spacing:.5px; text-transform:uppercase; color:var(--tos-fg-dim); }

    /* Standings widget — a compact league table. Zebra rows, leader row nudged to
       the accent, run-diff dimmed. */
    #tablet-os-overlay .tos-standings { width:100%; border-collapse:collapse; font-size:12.5px; }
    #tablet-os-overlay .tos-standings th { text-align:right; font-size:9.5px; letter-spacing:1px; text-transform:uppercase; color:var(--tos-fg-dim2);
      padding:7px 8px; border-bottom:1px solid color-mix(in srgb, var(--mg-accent) 18%, transparent); }
    #tablet-os-overlay .tos-standings td { text-align:right; padding:6px 8px; color:var(--tos-fg); border-bottom:1px solid color-mix(in srgb, var(--mg-accent) 8%, transparent); }
    #tablet-os-overlay .tos-standings tbody tr:last-child td { border-bottom:none; }
    #tablet-os-overlay .tos-standings tbody tr:nth-child(even) td { background:color-mix(in srgb, var(--mg-accent) 5%, transparent); }
    #tablet-os-overlay .tos-standings tbody tr:first-child td { color:var(--mg-accent); font-weight:bold; }
    #tablet-os-overlay .tos-standings th.tos-st-team, #tablet-os-overlay .tos-standings td.tos-st-team { text-align:left; }
    #tablet-os-overlay .tos-standings .tos-st-rank { color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-standings .tos-st-rd { color:var(--tos-fg-dim); }

    /* Headlines widget — a stack of one-liner stories with a LIVE/WIRE tag. */
    #tablet-os-overlay .tos-news-list { padding:4px 2px; }
    #tablet-os-overlay .tos-headline { display:flex; gap:8px; align-items:baseline; padding:7px 9px; font-size:12.5px; line-height:1.4;
      border-bottom:1px solid color-mix(in srgb, var(--mg-accent) 9%, transparent); }
    #tablet-os-overlay .tos-headline:last-child { border-bottom:none; }
    #tablet-os-overlay .tos-hl-tag { flex:0 0 auto; font-size:8.5px; font-weight:bold; letter-spacing:1px; padding:2px 5px; border-radius:3px; margin-top:1px; }
    #tablet-os-overlay .tos-hl-tag.live { color:#ff5a68; border:1px solid #4a1a1e; background:#1a0a0c; }
    #tablet-os-overlay .tos-hl-tag.tabloid { color:var(--tos-fg-dim); border:1px solid color-mix(in srgb, var(--mg-accent) 24%, transparent); background:var(--tos-surface); }
    #tablet-os-overlay .tos-hl-text { color:var(--tos-fg); }
    #tablet-os-overlay .tos-hl-by { color:var(--tos-fg-dim2); font-style:italic; font-size:11px; white-space:nowrap; }
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

// Perceived brightness of a hex colour, 0..1. Used to pick a legible phosphor
// green for the SPECTER hub against whatever the tablet's screen background is.
function bgLuminance(hex) {
  const h = String(hex || '').trim().replace('#', '');
  if (h.length !== 6) return 0;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return 0;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
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
  let bg, bg2, accent;

  if (t.linked) {
    // Inherit the page's own theme — clear any leftover unlinked override.
    _overlay.style.removeProperty('--bg');
    _overlay.style.removeProperty('--bg2');
    _overlay.style.removeProperty('--border');
    _overlay.style.removeProperty('--accent');
    const cs = getComputedStyle(document.documentElement);
    bg = cs.getPropertyValue('--bg');
    bg2 = cs.getPropertyValue('--bg2');
    accent = cs.getPropertyValue('--accent');
  } else {
    const colors = probeBuiltinThemeColors(t.theme || 'dark');
    bg = colors['--bg']; bg2 = colors['--bg2']; accent = colors['--accent'];
    _overlay.style.setProperty('--bg', colors['--bg']);
    _overlay.style.setProperty('--bg2', colors['--bg2']);
    _overlay.style.setProperty('--border', colors['--border']);
    _overlay.style.setProperty('--accent', colors['--accent']);
  }

  _overlay.style.setProperty('--tos-fg', luminanceTextColor(bg2) || 'var(--mg-accent)');
  // Button text sits on a SOLID accent fill — a mid-grey (what luminanceTextColor
  // returns for a mid-luminance accent like hot pink) is unreadable there. Pick a
  // hard black/white instead so accent buttons always contrast their fill.
  _overlay.style.setProperty('--tos-btn-fg', bgLuminance((accent || '').trim()) > 0.588 ? '#0a0a0a' : '#ffffff');
  // SPECTER phosphor green: bright mint on dark screens, a deep readable green
  // on light-theme screens (where #39ff9e washes out to nothing).
  _overlay.style.setProperty('--tos-shub', bgLuminance((bg || '').trim()) > 0.6 ? '#0a7d43' : '#39ff9e');
}

function nav(appId, screenLabel, params) {
  _backReturn = null; // any explicit navigation invalidates a pending drill-in return
  sfx(TOS_SELECT_DEF);
  const parts = ['tabletnav', appId];
  if (screenLabel != null) parts.push(screenToken(screenLabel));
  if (params) parts.push(params);
  sendCmdSilent(parts.join(' '));
}

function act(appId, actionId, params) {
  sfx(TOS_SELECT_DEF);
  const parts = ['tabletaction', appId, actionId];
  if (params) parts.push(params);
  sendCmdSilent(parts.join(' '));
}

function home() {
  _backReturn = null;
  sfx(TOS_ENTRY_DEF);
  sendCmdSilent('tablet');
}

// The tablet has no proactive push, so the live camera hub refreshes by re-navving
// its own screen on a timer (matched to the deck's 5s frame cadence). Silent — no
// sfx, no scroll jump (render() preserves the scroll spot across live refreshes).
function pollSurveillance() {
  if (!_overlay || !_data || _data.view !== 'surveillance' || !_data.live) {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    return;
  }
  const crumb = _data.breadcrumb || [];
  const screen = crumb.length ? crumb[crumb.length - 1] : null;
  const parts = ['tabletnav', _data.appId];
  if (screen != null) parts.push(screenToken(screen));
  if (_data.focusId) parts.push(_data.focusId);
  sendCmdSilent(parts.join(' '));
}

// Live-refresh the Quests app when the server signals a quest changed state
// (dispatch.js quest_update -> here). Silently re-navs the exact screen we're on
// (category list / quest detail / job board), preserving scroll, so the objective
// checkboxes tick in place without the player reopening the app. No-op unless the
// tablet is open on the Quests app. Mirrors pollSurveillance's silent re-nav, but
// event-driven rather than on a timer.
export function tabletQuestUpdate() {
  if (!_overlay || !_data || _data.appId !== 'quests') return;
  const crumb = _data.breadcrumb || [];
  let screen = null, params = null;
  if (_data.view === 'detail') {
    // Detail is keyed by quest_id (params); buildScreen resolves it regardless of
    // the screen token, but a token still has to precede the id so the tokenizer
    // doesn't misread the id as the screen — reuse the detail's category crumb.
    screen = crumb[0] || null;
    params = _data.quest?.id || _data.detail?.id || null;
  } else {
    screen = crumb.length ? crumb[crumb.length - 1] : null;
  }
  _keepQuestScroll = true;
  const parts = ['tabletnav', 'quests'];
  if (screen != null) parts.push(screenToken(screen));
  if (params) parts.push(params);
  sendCmdSilent(parts.join(' '));
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

/* Theme-aware app icons, keyed by app id. Primary strokes use currentColor (inherits
   the tablet's computed foreground); .dim elements pick up a muted derived tone. Falls
   back to each app's emoji when no SVG is mapped. viewBox 0 0 24 24. */
const TOS_APP_ICONS = {
  corp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path d="M4 21V6h7v15"/><path class="dim" d="M11 9h8v12h-8z" fill="currentColor" fill-opacity=".25" stroke="none"/><path d="M11 9h8v12"/><path d="M2 21h20"/><path d="M6 8h2M6 11h2M6 14h2M6 17h2M14 12h2M14 15h2M14 18h2"/></svg>`,
  bank: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path d="M12 3l9 5H3z"/><path class="dim" d="M12 3l9 5H3z" fill="currentColor" fill-opacity=".22" stroke="none"/><path d="M5 8v8M9 8v8M15 8v8M19 8v8"/><path d="M3 20h18"/><path d="M4 17h16"/></svg>`,
  properties: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path d="M3 11l9-8 9 8"/><path d="M5 10v11h14V10"/><path class="dim" d="M10 21v-6h4v6z" fill="currentColor" fill-opacity=".28" stroke="none"/><path d="M10 21v-6h4v6"/></svg>`,
  quests: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><rect x="5" y="4" width="14" height="17"/><path class="dim" d="M9 3h6v3H9z" fill="currentColor" fill-opacity=".3"/><path d="M9 3h6v3H9z"/><path d="M8 11l2 2 4-4"/><path d="M8.5 17h7"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="miter"><path d="M10.4 2.5h3.2l.5 2.6 2 1.15 2.5-.95 1.6 2.77-2 1.65V13.3l2 1.65-1.6 2.77-2.5-.95-2 1.15-.5 2.6h-3.2l-.5-2.6-2-1.15-2.5.95-1.6-2.77 2-1.65v-2.6l-2-1.65 1.6-2.77 2.5.95 2-1.15z"/><circle class="dim" cx="12" cy="12" r="3" fill="currentColor" fill-opacity=".3" stroke="none"/><circle cx="12" cy="12" r="3"/></svg>`,
  skills: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M12 2.5l2.6 5.3 5.9.9-4.25 4.15 1 5.75L12 15.9 6.75 18.6l1-5.75L3.5 8.7l5.9-.9z" fill="currentColor" fill-opacity=".22" stroke="none"/><path d="M12 2.5l2.6 5.3 5.9.9-4.25 4.15 1 5.75L12 15.9 6.75 18.6l1-5.75L3.5 8.7l5.9-.9z"/></svg>`,
  weather: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><circle class="dim" cx="8" cy="8" r="3" fill="currentColor" fill-opacity=".3"/><circle cx="8" cy="8" r="3"/><path d="M8 2.2v1.6M8 12.2v1.6M2.2 8h1.6M12.2 8h1.6M4.1 4.1l1.1 1.1M10.8 10.8l1.1 1.1M11.9 4.1l-1.1 1.1M5.2 10.8l-1.1 1.1"/><path d="M9 18a3.5 3.5 0 0 1 .5-6.96A4.5 4.5 0 0 1 18 12.5a3 3 0 0 1-.4 5.5z" fill="currentColor" fill-opacity=".12"/></svg>`,
  vehicles: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M12 2l2.5 6.5L21 12v2l-6.5-2v4l2.5 2v1.5L12 18l-5 1.5V18l2.5-2v-4L3 14v-2l6.5-3.5z" fill="currentColor" fill-opacity=".22" stroke="none"/><path d="M12 2l2.5 6.5L21 12v2l-6.5-2v4l2.5 2v1.5L12 18l-5 1.5V18l2.5-2v-4L3 14v-2l6.5-3.5z"/></svg>`,
  specter: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M3 7l13-3 1.2 4.4-13 3z" fill="currentColor" fill-opacity=".25" stroke="none"/><path d="M3 7l13-3 1.2 4.4-13 3z"/><path d="M17.6 6.2l3.4-1 .7 2.6-3.4 1"/><path d="M6 11.2V15a2 2 0 0 0 2 2h1"/><circle cx="9" cy="20" r="2"/><path d="M12.5 9.5l2.5 3.5"/></svg>`,
  chat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M4 4h16v11H8l-4 4z" fill="currentColor" fill-opacity=".22" stroke="none"/><path d="M4 4h16v11H8l-4 4z"/><path d="M8 8h8M8 11h5"/></svg>`,
};

function renderHomeApps(apps) {
  if (!apps || !apps.length) return '<div class="tos-empty">No applications registered.</div>';
  return `<div class="tos-grid">${apps.map(a => {
    const svg = TOS_APP_ICONS[a.id];
    const icon = svg ? svg : esc(a.icon || '▫');
    return `<div class="tos-tile" data-nav-app="${esc(a.id)}"><span class="tos-icon">${icon}</span><span class="tos-name">${esc(a.name)}</span></div>`;
  }).join('')}</div>`;
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

// Settings — the full game settings surface, rendered natively in the Tablet
// (mirrors client/game/index.html's settings panel + client/shared/settings.js).
// Every control reads/writes the shared `architect_settings` via loadSettings/
// saveSettings/applySettings, so the Tablet and the legacy panel stay in sync
// while both exist. Option pills re-render on change; sliders update live so
// dragging isn't interrupted. The theme "locker" (Tablet link/unlink) keeps its
// own independent record and gets an easy toggle + a separate Tablet-theme picker.

// Pill groups that map 1:1 to a key in the shared settings object. dpadSize is
// mobile-only, matching the game panel's `.mobile-only-setting` gate.
const TOS_OPT_GROUPS = [
  { key: 'fontSize', label: 'Font Size', opts: [
    { v: '14', t: 'Small', g: 'A', s: 'font-size:12px' },
    { v: '16', t: 'Medium', g: 'A', s: 'font-size:15px' },
    { v: '19', t: 'Large', g: 'A', s: 'font-size:17px' },
    { v: '22', t: 'X-Large', g: 'A', s: 'font-size:19px' } ] },
  { key: 'sidebarPosition', label: 'Sidebar', opts: [
    { v: 'left', t: 'Sidebar Left', g: '⬅️' }, { v: 'right', t: 'Sidebar Right', g: '➡️' } ] },
  { key: 'motion', label: 'Motion', opts: [
    { v: 'on', t: 'Animations On', g: '🎞️' }, { v: 'off', t: 'Motion Off', g: '⏸' } ] },
  { key: 'weatherFx', label: 'Weather FX', opts: [
    { v: 'on', t: 'Weather FX On', g: '🌧️' }, { v: 'off', t: 'Off', g: '🚫' } ] },
  { key: 'dpadSize', label: 'D-Pad Size', mobileOnly: true, opts: [
    { v: 'small', t: 'Small', g: 'S' }, { v: 'medium', t: 'Medium', g: 'M' }, { v: 'large', t: 'Large', g: 'L' } ] },
  { key: 'smartUI', label: 'Smart UI', opts: [
    { v: 'on', t: 'Contextual action bar on', g: '⚡' }, { v: 'off', t: 'Contextual action bar off', g: '🚫' } ] },
  { key: 'tempUnit', label: 'Temp Units', opts: [
    { v: 'C', t: 'Celsius', g: 'C°' }, { v: 'F', t: 'Fahrenheit', g: 'F°' } ] },
];
const TOS_AUDIO_TOGGLES = [
  { key: 'music', label: 'Music', on: '🎵', off: '🔇' },
  { key: 'sfx', label: 'SFX', on: '💥', off: '🔕' },
  { key: 'tv', label: 'TV Audio', on: '📺', off: '📵' },
  { key: 'muteWhenHidden', label: 'Mute When Hidden', on: '🙈', off: '▶️' },
];
const TOS_VOL_SLIDERS = [
  { key: 'masterVolume', label: 'Master', g: '🔊' },
  { key: 'musicVolume', label: 'Music', g: '🎵' },
  { key: 'sfxVolume', label: 'SFX', g: '💥' },
  { key: 'ambientVolume', label: 'Ambient', g: '🌫️' },
  { key: 'tvVolume', label: 'TV', g: '📺' },
];

// Mobile layout is reflected in data-density ("compact") — use it to gate the
// mobile-only D-Pad Size row, same as the legacy panel does in CSS. Note this is
// distinct from data-smart-ui, which is just the player-togglable contextual
// command bar and doesn't imply desktop/mobile layout either way.
function tosIsMobile() {
  return document.documentElement.getAttribute('data-density') === 'compact';
}

// The five theme colours previewed on each swatch — accent plus four status
// hues, so a theme's palette (not just its accent) reads at a glance.
const TOS_SW_DOT_VARS = ['--accent', '--green', '--yellow', '--red', '--purple'];

// A theme rendered as a colour swatch: its own bg2 as the chip background, a
// row of its key palette colours as dots, and a luminance-contrasted name — so
// themes are picked by look, not by reading a list of names.
function tosThemeSwatch(id, label, selected, dataAttr) {
  const c = probeBuiltinThemeColors(id) || {};
  const bg = (c['--bg2'] || '#1a2226').trim();
  const ink = luminanceTextColor(bg) || '#fff';
  const dots = TOS_SW_DOT_VARS.map(v => {
    const col = (c[v] || 'transparent').trim();
    return `<span class="tos-sw-dot" style="background:${esc(col)}"></span>`;
  }).join('');
  return `<div class="tos-theme-sw${selected ? ' selected' : ''}" ${dataAttr}="${esc(id)}" title="${esc(label)}" style="background:${esc(bg)}">
    <span class="tos-sw-dots">${dots}</span><span class="tos-sw-name" style="color:${ink}">${esc(label)}</span></div>`;
}

// Resolve a theme id to its display name from the built-in lists.
function tosThemeName(id) {
  const f = [...DARK_THEMES, ...LIGHT_THEMES].find(([v]) => v === id);
  return f ? f[1] : id;
}

// A compact trigger that shows the active theme (its own bg + accent) and opens
// the scrollable theme-picker sheet — so the full swatch list isn't spread out
// across the settings page. `kind` is 'ui' or 'tablet'.
function tosThemeTrigger(kind, activeId) {
  const c = probeBuiltinThemeColors(activeId) || {};
  const bg = (c['--bg2'] || '#1a2226').trim(), ac = (c['--accent'] || '#35e0c8').trim();
  const ink = luminanceTextColor(bg) || '#fff';
  return `<div class="tos-theme-trigger" data-open-theme-sheet="${esc(kind)}" title="Choose a theme" style="background:${esc(bg)}">
    <span class="tos-sw-ac" style="background:${esc(ac)};color:${esc(ac)}"></span>
    <span class="tos-sw-name" style="color:${ink}">${esc(tosThemeName(activeId))}</span>
    <span class="tos-trigger-caret" style="color:${ink}">&#9662;</span></div>`;
}

// The theme-picker sheet — a scrollable full list of themes that slides up over
// the settings screen. `kind` 'ui' drives the shared settings.theme (+ a link to
// the full editor); 'tablet' drives the unlinked Tablet's own theme.
function renderThemeSheet(kind) {
  const s = loadSettings();
  const tt = loadTabletTheme();
  const isTablet = kind === 'tablet';
  const active = isTablet ? (tt.theme || 'dark') : (s.theme || 'dark');
  const dataAttr = isTablet ? 'data-tablet-theme-pick' : 'data-theme-pick';
  const sw = ([id, label]) => tosThemeSwatch(id, label, id === active, dataAttr);
  return `<div class="tos-theme-sheet">
    <div class="tos-sheet-head"><span>${isTablet ? 'Tablet Theme' : 'UI Theme'}</span>
      <div class="tos-btn-sub" data-theme-sheet-close="1" style="margin:0">&#10005; Done</div></div>
    ${renderSection('Dark', `<div class="tos-theme-grid">${DARK_THEMES.map(sw).join('')}</div>`)}
    ${renderSection('Light', `<div class="tos-theme-grid">${LIGHT_THEMES.map(sw).join('')}</div>`)}
    ${isTablet ? '' : `<div class="tos-btn-sub" data-open-theme-editor="1">🎨 Full Theme Editor&hellip;</div>`}
  </div>`;
}

function tosPillRow(label, key, value, opts) {
  const pills = opts.map(o =>
    `<div class="tos-opt${String(value) === String(o.v) ? ' selected' : ''}" data-set-key="${esc(key)}" data-set-val="${esc(String(o.v))}" title="${esc(o.t)}"${o.s ? ` style="${o.s}"` : ''}>${esc(o.g)}</div>`
  ).join('');
  return `<div class="tos-set-row"><span class="tos-set-label">${esc(label)}</span><div class="tos-opts">${pills}</div></div>`;
}

function renderTabletSettings() {
  const s = loadSettings();
  const tt = loadTabletTheme();
  const linked = tt.linked !== false;
  const audio = s.audio || {};
  const pct = (v) => `${Math.round((v ?? 0) * 100)}%`;

  // A theme-picker sheet is open — show the scrollable selector instead of the
  // settings pages (it slides up over the screen; ✕ Done returns here).
  if (_tosThemePicker) return renderThemeSheet(_tosThemePicker);

  // Theme — a compact trigger that opens the scrollable picker sheet, with the
  // Match-UI-Theme lock right beneath it, and (when unlinked) the Tablet's own
  // theme trigger. The full swatch list lives in the sheet, not on the page.
  const themeActive = s.theme || 'dark';
  const tabletActive = tt.theme || 'dark';
  const contrast = s._contrastPreview != null ? s._contrastPreview : (s.contrast || 0);
  const lockRow = `<div class="tos-set-row"><span class="tos-set-label">Match UI Theme</span><div class="tos-opts">
    <div class="tos-opt${linked ? ' selected' : ''}" data-set-link="linked" title="Tablet follows the shared UI theme">🔒 Linked</div>
    <div class="tos-opt${!linked ? ' selected' : ''}" data-set-link="unlinked" title="Tablet keeps its own independent theme">🔓 Unlinked</div>
  </div></div>`;
  const themeSection =
    `<div class="tos-set-row"><span class="tos-set-label">Theme</span>${tosThemeTrigger('ui', themeActive)}</div>` +
    lockRow +
    (linked ? '' : `<div class="tos-set-row"><span class="tos-set-label">Tablet Theme</span>${tosThemeTrigger('tablet', tabletActive)}</div>`);

  const feltMode = s.pokerFelt || 'green';
  const feltRow = `<div class="tos-set-row"><span class="tos-set-label">Poker Felt</span><div class="tos-opts">
    <div class="tos-opt${feltMode === 'green' ? ' selected' : ''}" data-set-key="pokerFelt" data-set-val="green" title="Classic Green">🟢</div>
    <div class="tos-opt${feltMode === 'accent' ? ' selected' : ''}" data-set-key="pokerFelt" data-set-val="accent" title="Theme Accent">✨</div>
    <div class="tos-opt${feltMode === 'custom' ? ' selected' : ''}" data-set-key="pokerFelt" data-set-val="custom" title="Custom Colour">🖌️</div>
    <input type="color" class="tos-color" data-set-poker-color="1" value="${esc(s.pokerFeltColor || '#1a4a1a')}" title="Pick a custom felt colour">
  </div></div>`;

  const soundOn = !!audio.enabled;
  const soundRow = `<div class="tos-set-row"><span class="tos-set-label">Sound</span><div class="tos-opts">
    <div class="tos-opt${soundOn ? ' selected' : ''}" data-set-sound="on" title="Sound On">🔊 On</div>
    <div class="tos-opt${!soundOn ? ' selected' : ''}" data-set-sound="off" title="Sound Off">🔇 Off</div>
  </div></div>`;
  const audioToggleRows = TOS_AUDIO_TOGGLES.map(a => {
    const on = !!audio[a.key];
    return `<div class="tos-set-row"><span class="tos-set-label">${esc(a.label)}</span><div class="tos-opts">
      <div class="tos-opt${on ? ' selected' : ''}" data-set-audio="${esc(a.key)}" data-set-audio-val="true" title="${esc(a.label)} On">${esc(a.on)}</div>
      <div class="tos-opt${!on ? ' selected' : ''}" data-set-audio="${esc(a.key)}" data-set-audio-val="false" title="${esc(a.label)} Off">${esc(a.off)}</div>
    </div></div>`;
  }).join('');
  const volRows = TOS_VOL_SLIDERS.map(v =>
    `<div class="tos-set-row"><span class="tos-set-label">${esc(v.g)} ${esc(v.label)}</span>
      <span><input type="range" class="tos-slider" data-set-vol="${esc(v.key)}" min="0" max="1" step="0.05" value="${audio[v.key] ?? 0}">
      <span class="tos-set-val" data-vol-label="${esc(v.key)}">${pct(audio[v.key])}</span></span></div>`
  ).join('');

  const fontRow = tosPillRow('Font Size', 'fontSize', s.fontSize, TOS_OPT_GROUPS.find(g => g.key === 'fontSize').opts);
  const layoutRows = TOS_OPT_GROUPS
    .filter(gp => gp.key !== 'fontSize' && (!gp.mobileOnly || tosIsMobile()))
    .map(gp => tosPillRow(gp.label, gp.key, s[gp.key], gp.opts)).join('');

  // Grouped pages so Settings isn't one long scroll — same buckets as the game
  // settings panel (General / Layout / Sound). Poker felt + MIS live under
  // General now that the standalone Game tab is gone.
  const pages = {
    General:
      themeSection +
      `<div class="tos-set-row"><span class="tos-set-label">Contrast <span class="tos-set-val" data-contrast-label="1">${contrast === 0 ? 'Base' : '+' + contrast + '%'}</span></span>
        <span><input type="range" class="tos-slider" data-set-contrast="1" min="0" max="100" step="1" value="${contrast}">
        <span class="tos-btn-sub" data-contrast-reset="1" style="margin:0 0 0 8px;padding:4px 9px">Reset</span></span></div>` +
      fontRow +
      feltRow +
      renderMisSection(),
    Layout: layoutRows || '<div class="tos-empty">No layout options.</div>',
    Sound: soundRow + audioToggleRows + volRows,
  };
  const pageNames = Object.keys(pages);
  if (!pageNames.includes(_tosSetPage)) _tosSetPage = pageNames[0];
  const tabs = pageNames.map(n =>
    `<div class="tos-set-tab${n === _tosSetPage ? ' sel' : ''}" data-set-page="${esc(n)}">${esc(n)}</div>`).join('');

  return `<div class="tos-set-tabs">${tabs}</div><div class="tos-set-page">${pages[_tosSetPage]}</div>`;
}

// Mature Content (MIS) — server-authoritative, so it reads live off state.player
// and toggles via the raw ws hook. Hidden behind the same triple-click decoy as
// the legacy panel until revealed (per session).
function renderMisSection() {
  if (!_tosMisRevealed) return `<div class="tos-mis-decoy" data-mis-decoy="1"></div>`;
  const misOn = state.player?.mis_enabled === 1 || state.player?.mis_enabled === true;
  const blocked = !!state.player?.mis_server_disabled;
  const status = blocked ? 'MIS not enabled on server.' : (misOn ? 'Mature content enabled.' : 'Mature content disabled.');
  const misRow = `<div class="tos-set-row"><span class="tos-set-label">MIS</span><div class="tos-opts" data-mis-pills="1">
      <div class="tos-opt${misOn ? ' selected' : ''}" data-mis-set="on" title="Mature content on">On</div>
      <div class="tos-opt${!misOn ? ' selected' : ''}" data-mis-set="off" title="Mature content off">Off</div>
    </div></div>
    <div class="tos-set-val" data-mis-status style="display:block;margin-top:6px">${esc(status)}</div>`;
  return renderSection('Mature Content', misRow);
}

// Reflect MIS state in place (pills + status) without a full re-render, so a
// server sync or a toggle doesn't reset the scroll spot. No-op if the Settings
// screen (or the MIS toggle) isn't currently shown.
function tosApplyMis(enabled, serverDisabled) {
  if (!_overlay) return;
  const pills = _overlay.querySelector('[data-mis-pills]');
  if (pills) {
    pills.querySelector('[data-mis-set="on"]')?.classList.toggle('selected', !!enabled);
    pills.querySelector('[data-mis-set="off"]')?.classList.toggle('selected', !enabled);
  }
  const status = _overlay.querySelector('[data-mis-status]');
  if (status) status.textContent = serverDisabled ? 'MIS not enabled on server.' : (enabled ? 'Mature content enabled.' : 'Mature content disabled.');
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
    <div class="tos-actions"><span class="tos-btn" data-nav-screen="map">🗺 Territory Map</span></div>
    ${renderSection('Operatives', members)}
    ${renderSection('Territory · Influence', territory)}
    ${renderSection('Diplomacy', relations)}
  `;
}

// Territory Map — the `corp map` overlay's strategic grid ported into the Tablet.
// Same cmdCorpMap payload (zones on a 2n-1 expanded grid, org-colour fill, road
// links, badges). Tap a zone to inspect it (selection is client-side — no round
// trip); current-tile verbs route through the corp app's handleAction ('mapact').
function _cmSharesArtery(a, b) { return Array.isArray(a) && Array.isArray(b) && a.some(x => b.includes(x)); }

function renderCorpMap(d) {
  const tiles = d.tiles || [];
  if (!tiles.length) return `<div class="tos-empty">No mapped territory on this level.</div>`;
  if (!_tosCorpSel || !tiles.some(t => t.id === _tosCorpSel)) _tosCorpSel = tiles.find(t => t.isCurrent)?.id || null;

  const byId = new Map(tiles.map(t => [t.id, t]));
  const xs = tiles.map(t => t.x), ys = tiles.map(t => t.y);
  const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
  const gCols = (maxX - minX) * 2 + 1, gRows = (maxY - minY) * 2 + 1;
  const cell = Array.from({ length: gRows }, () => new Array(gCols).fill(null));
  for (const t of tiles) cell[(t.y - minY) * 2][(t.x - minX) * 2] = { kind: 'room', tile: t };
  for (const t of tiles) {
    const gx = (t.x - minX) * 2, gy = (t.y - minY) * 2;
    for (const tgt of Object.values(t.exits || {})) {
      const n = byId.get(tgt); if (!n) continue;
      const dx = n.x - t.x, dy = n.y - t.y;
      if (Math.abs(dx) + Math.abs(dy) !== 1) continue; // cardinal, adjacent only
      const cy = gy + dy, cx = gx + dx;
      if (cy < 0 || cy >= gRows || cx < 0 || cx >= gCols || cell[cy][cx]) continue;
      const art = _cmSharesArtery(t.artery, n.artery);
      cell[cy][cx] = { kind: 'link', ch: dx !== 0 ? (art ? '═' : '─') : (art ? '║' : '│'), art };
    }
  }
  const colT = Array.from({ length: gCols }, (_, i) => i % 2 ? '14px' : '56px').join(' ');
  const rowT = Array.from({ length: gRows }, (_, i) => i % 2 ? '12px' : '44px').join(' ');
  let grid = `<div class="tos-cm-grid" style="grid-template-columns:${colT};grid-template-rows:${rowT}">`;
  for (let r = 0; r < gRows; r++) for (let c = 0; c < gCols; c++) {
    const it = cell[r][c];
    const pos = `grid-column:${c + 1};grid-row:${r + 1}`;
    if (!it) { grid += `<span style="${pos}"></span>`; continue; }
    if (it.kind === 'link') { grid += `<span class="tos-cm-link${it.art ? ' art' : ''}" style="${pos}">${it.ch}</span>`; continue; }
    const t = it.tile, ct = t.control || {};
    const owned = !!ct.org_id;
    const cls = ['tos-cm-tile'];
    if (owned) cls.push('owned'); else if (ct.status === 'OPEN') cls.push('open'); else cls.push('safe');
    if (ct.status === 'CONTESTED') cls.push('contested');
    if (t.isCurrent) cls.push('cur');
    if (t.id === _tosCorpSel) cls.push('sel');
    let style = pos + ';';
    if (owned) style += `background:${ct.color};color:${luminanceTextColor(ct.color) || '#08110d'};box-shadow:0 0 ${ct.mine ? 7 : 11}px ${ct.color}${ct.mine ? '' : ',0 0 4px ' + ct.color};`;
    const label = owned ? `${esc(ct.tag)} ${ct.influence}%` : (ct.status === 'OPEN' ? 'open' : '');
    const badges = (t.isCurrent ? '<span class="b-cur">◉</span>' : '') + (ct.mine ? '<span class="b-hq">▣</span>' : '') + (t.isStart ? '<span class="b-star">★</span>' : '');
    grid += `<div class="${cls.join(' ')}" style="${style}" data-cm-zone="${esc(t.id)}" title="${esc(t.name)}">${badges}<span class="tn">${esc(t.name)}</span><span class="ti">${label}</span></div>`;
  }
  grid += '</div>';
  const legend = (d.orgs || []).map(o =>
    `<span class="tos-cm-lg"><span class="sw" style="background:${o.color}"></span>${esc(o.tag)} ${esc(o.name)}${o.id === d.myOrgId ? ' (you)' : ''}</span>`
  ).join('') + '<span class="tos-cm-lg">★ home · ◉ you · ▣ HQ · ═ artery</span>';
  return `<div class="tos-cm-wrap">${grid}</div><div class="tos-cm-legend">${legend}</div><div class="tos-cm-detail" id="tos-cm-detail">${renderCorpMapDetail(d)}</div>`;
}

function _cmActBtns(list, hot) {
  return `<div class="tos-actions">${list.map(([a, label]) =>
    `<button class="tos-btn${hot ? ' tos-btn-hot' : ''}" data-cm-act="${esc(a)}">${esc(label)}</button>`).join('')}</div>`;
}

function renderCorpMapDetail(d) {
  const t = (d.tiles || []).find(x => x.id === _tosCorpSel);
  if (!t) return `<div class="tos-cm-note">Tap a zone to inspect it.</div>`;
  const c = t.control || {};
  const inf = c.influence ?? (c.org_id ? 50 : 0);
  const controller = c.org_id ? `${esc(c.tag)} · ${esc(c.status)}` : (c.status === 'OPEN' ? 'UNCLAIMED' : 'not contestable');
  const home = t.isStart ? ' · ★ home' : '';
  let acts = '';
  if (t.isCurrent && d.myOrgId) {
    if (!c.org_id && c.status === 'OPEN') acts = _cmActBtns([['claim', 'Claim']]);
    else if (c.mine) acts = _cmActBtns([['reinforce', 'Reinforce'], ['build:extractor', '+Extractor'], ['build:turret', '+Turret']]);
    else if (c.org_id) acts = _cmActBtns([['contest', '⚔ Contest']], true);
  } else if (c.status === 'OPEN' || c.org_id) {
    acts = `<div class="tos-cm-note">▸ Travel to <b>${esc(t.name)}</b> to act — the verbs work where you stand.</div>`;
  }
  const tug = c.org_id
    ? `<div class="tos-cm-tug"><i style="width:${inf}%"></i></div><div class="tos-cm-tugrow"><span class="my">${esc(c.tag)} ${inf}%</span>${c.challenger ? `<span class="rv">${esc(c.challenger)} ${100 - inf}%</span>` : '<span class="dim">uncontested</span>'}</div>`
    : '';
  const econ = c.org_id
    ? `<div class="tos-row"><span>Income</span><span>+${c.income}/day</span></div><div class="tos-row"><span>Upkeep</span><span>-${c.upkeep}/day</span></div>`
    : '';
  const assets = (c.assets && c.assets.length)
    ? `<div class="tos-row"><span>Assets</span><span>${c.assets.map(a => `${a.type === 'extractor' ? '⛏' : '⌖'} ${esc(a.type)} L${a.level}`).join(' · ')}${c.defense ? ` · def ${c.defense}` : ''}</span></div>`
    : '';
  const artery = Array.isArray(t.artery) && t.artery.length ? `<div class="tos-row"><span>On</span><span>${t.artery.map(esc).join(' · ')}</span></div>` : '';
  return `<div class="tos-detail-name" style="font-size:15px">${esc(t.name)}</div><div class="tos-detail-desc">${t.isCurrent ? '◉ you are here · ' : ''}${controller}${home}</div>${tug}${econ}${assets}${artery}${acts}`;
}

// ── Map app ──────────────────────────────────────────────────────────────────
// A tablet-native version of the full-screen city map. The tiles are exactly what
// the popup gets (server buildMapPayload), rendered on the corp map's 2n-1 grid
// but with the full map's land-use colour / danger / POI reading. Tapping a tile
// selects it (client-side); its detail carries a "Route here" button that plots a
// GPS route via the popup's own route machinery (setGpsRoute → mirrors onto the
// sidebar minimap + refreshes the popup if it's open), and auto-walks it.
const MAP_MODE_LABELS = { interior: 'Interior', zone: 'Zone', regional: 'Regional' };

function _mapHexRgb(hex) {
  const h = String(hex || '').replace('#', '');
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
}
function _mapTileSym(t) {
  if (t.isCurrent) return '<span class="mt-icon">◉</span>';
  if (t.icon) return `<span class="mt-icon">${esc(t.icon)}</span>`;
  if (t.marker) return `<span class="mt-icon">${esc(t.marker)}</span>`;
  return '';
}

function renderMap(d) {
  const tiles = d.tiles || [];
  const mode = d.mode || 'zone';
  const inside = !!d.insideInterior;

  // Mode switcher — interior only exists when you're in a building (like the popup).
  const modes = inside ? ['interior', 'zone', 'regional'] : ['zone', 'regional'];
  const tabs = modes.map(m =>
    `<span class="tos-map-tab${m === mode ? ' sel' : ''}" data-map-mode="${m}">${MAP_MODE_LABELS[m]}</span>`
  ).join('');

  if (!tiles.length) {
    return `<div class="tos-map-tabs">${tabs}</div><div class="tos-empty">No map data for this level.</div>`;
  }
  if (!_tosMapSel || !tiles.some(t => t.id === _tosMapSel)) _tosMapSel = null;

  const byId = new Map(tiles.map(t => [t.id, t]));
  const route = getTracePath() || [];
  const routeSet = new Set(route);
  const dest = route.length > 1 ? route[route.length - 1] : null;

  const xs = tiles.map(t => t.x), ys = tiles.map(t => t.y);
  const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
  const gCols = (maxX - minX) * 2 + 1, gRows = (maxY - minY) * 2 + 1;
  const cell = Array.from({ length: gRows }, () => new Array(gCols).fill(null));
  for (const t of tiles) cell[(t.y - minY) * 2][(t.x - minX) * 2] = { kind: 'room', tile: t };
  for (const t of tiles) {
    const gx = (t.x - minX) * 2, gy = (t.y - minY) * 2;
    for (const tgt of Object.values(t.exits || {})) {
      const n = byId.get(tgt); if (!n) continue;
      const dx = n.x - t.x, dy = n.y - t.y;
      if (Math.abs(dx) + Math.abs(dy) !== 1) continue; // cardinal, adjacent only
      const cy = gy + dy, cx = gx + dx;
      if (cy < 0 || cy >= gRows || cx < 0 || cx >= gCols || cell[cy][cx]) continue;
      const art = _cmSharesArtery(t.artery, n.artery);
      cell[cy][cx] = { kind: 'link', ch: dx !== 0 ? (art ? '═' : '─') : (art ? '║' : '│'), art };
    }
  }

  const colT = Array.from({ length: gCols }, (_, i) => i % 2 ? '13px' : '52px').join(' ');
  const rowT = Array.from({ length: gRows }, (_, i) => i % 2 ? '11px' : '42px').join(' ');
  let grid = `<div class="tos-map-grid" style="grid-template-columns:${colT};grid-template-rows:${rowT}">`;
  for (let r = 0; r < gRows; r++) for (let c = 0; c < gCols; c++) {
    const it = cell[r][c];
    const pos = `grid-column:${c + 1};grid-row:${r + 1}`;
    if (!it) { grid += `<span style="${pos}"></span>`; continue; }
    if (it.kind === 'link') { grid += `<span class="tos-map-link${it.art ? ' art' : ''}" style="${pos}">${it.ch}</span>`; continue; }
    const t = it.tile;
    const cls = ['tos-map-tile'];
    if (t.danger && t.danger !== 'safe') cls.push('d-' + t.danger);
    if (t.reachable === false) cls.push('unreach');
    if (routeSet.has(t.id)) cls.push('on-route');
    if (t.id === dest && !t.isCurrent) cls.push('dest');
    if (t.id === _tosMapSel) cls.push('sel');
    if (t.isCurrent) cls.push('cur');
    let style = pos + ';';
    // Regional view tints each tile by land-use function, like the popup's regional map.
    if (mode === 'regional' && FUNC_LEGEND[t.func]) {
      const [rr, gg, bb] = _mapHexRgb(FUNC_LEGEND[t.func].color);
      style += `background:rgba(${rr},${gg},${bb},0.30);`;
    }
    const badges = (t.isCurrent ? '<span class="mt-you">◉</span>' : '')
      + (t.id === dest && !t.isCurrent ? '<span class="mt-dest">⚑</span>' : '');
    grid += `<div class="${cls.join(' ')}" style="${style}" data-map-zone="${esc(t.id)}" title="${esc(t.name)}">${badges}${_mapTileSym(t)}<span class="mt-name">${esc(t.name)}</span></div>`;
  }
  grid += '</div>';

  return `<div class="tos-map-tabs">${tabs}</div>${renderMapBar(d)}<div class="tos-map-wrap">${grid}</div>${renderMapLegend(mode)}<div class="tos-map-detail" id="tos-map-detail">${renderMapDetail(d)}</div>`;
}

function renderMapBar(d) {
  const route = getTracePath() || [];
  const byId = new Map((d.tiles || []).map(t => [t.id, t]));
  let status;
  if (route.length > 1) {
    const destTile = byId.get(route[route.length - 1]);
    const hops = route.length - 1;
    status = `<b>GPS:</b> ${destTile ? esc(destTile.name) : 'route'} · ${hops} stop${hops === 1 ? '' : 's'}`;
  } else {
    status = 'Tap a tile, then Route here to plot a GPS course.';
  }
  const auto = route.length > 1
    ? `<span class="tos-map-mini${isAutoWalking() ? ' active' : ''}" data-map-auto>🏃 Auto-walk</span>` : '';
  const clear = route.length > 1 ? `<span class="tos-map-mini" data-map-clear>✕ Clear</span>` : '';
  return `<div class="tos-map-bar"><span class="tos-map-route">${status}</span>${auto}${clear}</div>`;
}

function renderMapLegend(mode) {
  let items = '<span>◉ you · ⚑ dest · ═ artery</span>';
  if (mode === 'regional') {
    const keys = ['northcity', 'commercial', 'nightlife', 'docks', 'industrial', 'redline'];
    items += keys.map(k => FUNC_LEGEND[k]
      ? `<span class="tos-cm-lg"><span class="sw" style="background:${FUNC_LEGEND[k].color}"></span>${esc(FUNC_LEGEND[k].label.split(/[ /]/)[0])}</span>` : '').join('');
  }
  return `<div class="tos-map-legend">${items}</div>`;
}

function _mapActBtns(list) {
  return `<div class="tos-actions">${list.map(([a, label]) =>
    `<button class="tos-btn" data-map-act="${esc(a)}">${esc(label)}</button>`).join('')}</div>`;
}

function renderMapDetail(d) {
  const t = (d.tiles || []).find(x => x.id === _tosMapSel);
  if (!t) return `<div class="tos-map-note">Tap a tile to see what's there — then Route here to plot a course.</div>`;
  const rows = [];
  const funcLabel = FUNC_LEGEND[t.func]?.label;
  if (funcLabel) rows.push(`<div class="tos-row"><span>District</span><span>${esc(funcLabel)}</span></div>`);
  if (t.danger && t.danger !== 'safe') rows.push(`<div class="tos-row"><span>Danger</span><span>${esc(t.danger)}</span></div>`);
  const poiLabel = t.poi && POI_LEGEND[t.poi] ? POI_LEGEND[t.poi].label : null;
  if (poiLabel) rows.push(`<div class="tos-row"><span>Landmark</span><span>${esc(t.icon || '')} ${esc(poiLabel)}</span></div>`);
  if (Array.isArray(t.artery) && t.artery.length) rows.push(`<div class="tos-row"><span>On</span><span>${t.artery.map(esc).join(' · ')}</span></div>`);
  if (t.buildings?.length) rows.push(`<div class="tos-row"><span>Buildings</span><span>${t.buildings.map(esc).join(', ')}</span></div>`);
  const route = getTracePath() || [];
  const isDest = route.length > 1 && route[route.length - 1] === t.id;
  let acts;
  if (t.isCurrent) acts = `<div class="tos-map-note">◉ You are here.</div>`;
  else if (t.reachable === false) acts = `<div class="tos-map-note">No route to here from where you stand.</div>`;
  else if (isDest) acts = _mapActBtns([['auto', isAutoWalking() ? '■ Stop Auto-walk' : '🏃 Auto-walk here']]);
  else acts = _mapActBtns([['route', '🧭 Route here']]);
  return `<div class="tos-detail-name" style="font-size:15px">${esc(t.name)}</div>${t.description ? `<div class="tos-detail-desc">${esc(t.description)}</div>` : ''}${rows.join('')}${acts}`;
}

// Colour picker — a free colour wheel (any colour allowed; corps may share
// hues) plus the preset palette as quick-pick swatches. Both the wheel and a
// swatch fire the `set_color` action, so they route through the wireBody
// handlers just like the corp buttons. No "taken"/uniqueness gating.
function renderColorPicker(appId, palette, current) {
  const cur = String(current || '').toLowerCase();
  const valid = /^#[0-9a-f]{6}$/.test(cur) ? cur : '#35c95a';
  const swatches = (palette || []).map(c => {
    const sel = cur && c.hex.toLowerCase() === cur;
    return `<span class="tos-swatch${sel ? ' sel' : ''}" style="background:${esc(c.hex)}" title="${esc(c.hex)}"
      data-act-id="set_color" data-act-app="${esc(appId)}" data-act-params="${esc(c.hex)}"></span>`;
  }).join('');
  const wheel = `<div class="tos-color-row">
      <input type="color" class="tos-color tos-color-lg" data-set-corp-color="${esc(appId)}" value="${esc(valid)}" title="Pick any colour">
      <span class="tos-color-hex">${esc((cur || valid).toUpperCase())}</span>
      <span class="tos-color-hint">This colour marks your turf on the territory map.</span>
    </div>`;
  return renderSection('Corp Colour', wheel + (swatches ? `<div class="tos-swatches">${swatches}</div>` : ''));
}

// No-corp founding screen: state the one-time cost up front, then a name prompt.
function renderCorpFound(d) {
  const fee = d.foundFee || 0, credits = d.credits || 0, afford = credits >= fee;
  return `
    <div class="tos-detail-name">Found a Corporation</div>
    <div class="tos-detail-desc">Start your own outfit — a shared treasury, ranks, territory, and a private corp channel. You'll be its Founder.</div>
    <div class="tos-row"><span>Founding fee</span><span>₵${fee.toLocaleString()}</span></div>
    <div class="tos-row"><span>Your credits</span><span>₵${credits.toLocaleString()}</span></div>
    <div class="tos-founding-warn">${afford
      ? `Founding costs a one-time <b>₵${fee.toLocaleString()}</b>, debited the moment you create the corp. You can pick your corp colour right after.`
      : `You need <b>₵${fee.toLocaleString()}</b> to found a corp — you have ₵${credits.toLocaleString()}.`}</div>
    ${afford ? renderActions(d.appId, [{ id: 'found', label: `Found a Corp · ₵${fee.toLocaleString()}`, prompt: 'Name your corporation:' }], '') : ''}
  `;
}

// Surveillance (SPECTER) hub — the spy-deck's live multi-feed, rendered natively
// in the tablet. Tiles carry live `frame` text (refreshed by the poll timer while
// this screen is open); a focused tile gets a bigger feed + record/clip controls.
const SURV_STATUS = { offline: 'NO SIGNAL', damaged: 'DAMAGED', jammed: 'JAMMED', spoofed: 'SIGNAL FAULT' };

function renderCamFeed(t) {
  if (t.status === 'ok' && t.frame) return `<div class="tos-cam-feed">${esc(t.frame)}</div>`;
  if (t.status === 'ok') return `<div class="tos-cam-feed">· · ·</div>`;
  return `<div class="tos-cam-feed dead">${esc(SURV_STATUS[t.status] || 'NO FEED')}</div>`;
}

// The focused camera's rolling recording buffer — the event-lines on tape right
// now (speech, arrivals, exits, actions). "Clip → Chip" burns exactly these.
function renderBufferLog(buffer, recording) {
  const lines = Array.isArray(buffer) ? buffer : [];
  const head = `<div class="tos-buf-head">◉ ON TAPE${lines.length ? ` · ${lines.length} line${lines.length === 1 ? '' : 's'}` : ''}</div>`;
  if (!lines.length) {
    return `${head}<div class="tos-buf empty">${recording ? 'Nothing on tape yet — activity in this zone will log here.' : 'Not recording. Hit Record to start a tape.'}</div>`;
  }
  const body = lines.map(l => `<div class="tos-buf-line"><span class="tos-buf-t">${esc(l.t || '')}</span> ${esc(l.text || '')}</div>`).join('');
  return `${head}<div class="tos-buf">${body}</div>`;
}

function renderSurveillance(d) {
  const tiles = d.tiles || [];
  const rec = tiles.filter(t => t.recording).length;
  const live = tiles.filter(t => t.status === 'ok').length;
  const net = d.net || {};
  const links = (d.links || []).map(l =>
    `<span class="tos-surv-link" data-nav-screen="${esc(l.id)}">${esc(l.label)}</span>`).join('');

  const header = `<div class="tos-surv-hdr"><span>${esc(net.name || 'SPECTER')}</span>
    <span>${rec ? `<span class="tos-surv-rec">${rec}●REC</span> · ` : ''}${live}/${tiles.length} LIVE</span></div>`;

  if (d.locked || !tiles.length) {
    const msg = d.locked ? (d.message || 'No surveillance deck.') : 'No devices deployed. Plant a camera to start a feed.';
    return `<div class="tos-surv">${header}<div class="tos-empty">${esc(msg)}</div>
      ${links ? `<div class="tos-surv-links">${links}</div>` : ''}</div>`;
  }

  const alerts = (d.alerts || []).length
    ? `<div class="tos-alerts">${d.alerts.map(a => `<div class="tos-alert"><b>${esc(a.t || '')}</b> ${esc(a.text || '')}</div>`).join('')}</div>`
    : '';

  const focus = d.focusId ? tiles.find(t => t.id === d.focusId) : null;
  const focusPane = focus ? `<div class="tos-cam-focus">
      <div class="tos-cam-head"><span>${esc(focus.name)}</span><span class="tos-cam-kind">${esc(focus.kind || '')}${focus.tier ? ` · T${esc(String(focus.tier))}` : ''}</span></div>
      ${renderCamFeed(focus)}
      <div class="tos-cam-foot"><span>${esc(focus.zone || '')} · ${esc(focus.ts || '')}</span><span>${esc(focus.battery || '')}${focus.recording ? ' · <span class="tos-rec"><span class="tos-rec-dot">●</span>REC</span>' : ''}</span></div>
      ${renderBufferLog(d.focusBuffer, focus.recording)}
      ${renderActions(d.appId, [
        { id: 'record', label: focus.recording ? 'Stop Recording' : 'Record' },
        { id: 'clip', label: 'Clip → Chip' },
      ], focus.id)}
    </div>` : '';

  const grid = `<div class="tos-cam-grid">${tiles.map(t => `<div class="tos-cam${t.id === d.focusId ? ' sel' : ''}" data-nav-tile="${esc(t.id)}">
      <div class="tos-cam-head"><span>${esc(t.name)}</span><span class="tos-cam-kind">${esc(t.kind || '')}${t.tier ? ` · T${esc(String(t.tier))}` : ''}</span></div>
      ${renderCamFeed(t)}
      <div class="tos-cam-foot"><span>${esc(t.zone || '')}</span><span>${esc(t.battery || '')}${t.recording ? ' · <span class="tos-rec"><span class="tos-rec-dot">●</span>REC</span>' : ''}</span></div>
    </div>`).join('')}</div>`;

  return `<div class="tos-surv">${header}${alerts}${focusPane}${grid}
    ${links ? `<div class="tos-surv-links">${links}</div>` : ''}</div>`;
}

// ── Chat app ────────────────────────────────────────────────────────────────
// The same conversations the floating chat window owns (whisper.js), rendered
// natively in the tablet. All chat state lives in whisper.js — here we just read
// it via the exported chat API and send through it. Live updates come from the
// onChatUpdate subscription (set up/torn down in render()/close()).

function renderChatMsg(m) {
  const body = m.isHtml ? m.message : parseMarkup(m.message);
  return `<div class="tos-chat-msg"><span class="tos-chat-from${m.isMe ? ' me' : ''}">${esc(m.isMe ? 'You' : m.from)}</span><span class="tos-chat-text">${body}</span></div>`;
}

// The Users tab body — a directory of players online now, tap to start a PM.
// Mirrors the floating chat panel's hub. The data-chat-new / data-chat-refresh
// hooks are already wired in wireBody(), so no extra wiring is needed here.
function renderChatUsers() {
  const havePm = new Set(getChatTabs().filter(t => t.kind === 'pm').map(t => t.key.toLowerCase()));
  const people = getOnlinePlayers().filter(p => p.handle);
  const rows = people.length
    ? people.map(p => {
        const existing = havePm.has(p.handle.toLowerCase());
        return `<div class="tos-chat-user" data-chat-new="${esc(p.handle)}"><span class="tos-chat-user-name">${esc(p.handle)}</span><span class="tos-chat-user-pm">${existing ? '↩' : '💬'}</span></div>`;
      }).join('')
    : '<div class="tos-chat-none" style="padding:12px 10px">No one else online.</div>';
  const closed = getClosedChatTabs();
  const closedSection = closed.length ? `
    <div class="tos-chat-users-head" style="margin-top:12px"><span>Recently closed</span></div>
    <div class="tos-chat-userlist">${closed.map(t =>
      `<div class="tos-chat-user" data-chat-reopen="${esc(t.key)}"><span class="tos-chat-user-name">${esc(t.label)}</span><span class="tos-chat-user-pm" title="Re-open">↩</span></div>`
    ).join('')}</div>` : '';

  return `<div class="tos-chat-users">
    <div class="tos-chat-users-head"><span>Online now</span><span class="tos-chat-refresh" data-chat-refresh="1" title="Refresh online list">↻</span></div>
    <div class="tos-chat-userlist">${rows}</div>
    ${closedSection}
  </div>`;
}

function renderChat() {
  const tabs = getChatTabs();
  const onUsers = _chatTab === CHAT_USERS_TAB;
  // Keep the selection valid; default to the corp channel, else first channel,
  // else first tab (the Users hub is never auto-selected — it's opt-in).
  if (!onUsers && (!_chatTab || !tabs.some(t => t.key === _chatTab))) {
    const corp = tabs.find(t => t.kind === 'channel' && t.key.startsWith('#corp:'));
    _chatTab = (corp || tabs.find(t => t.kind === 'channel') || tabs[0])?.key || null;
  }
  const active = onUsers ? null : (tabs.find(t => t.key === _chatTab) || null);
  if (active) markChatRead(active.key); // we're showing it — clear its unread

  // Users hub leads the strip, then channels + PM conversations.
  const usersTab = `<div class="tos-chat-tab${onUsers ? ' sel' : ''}" data-chat-tab="${CHAT_USERS_TAB}" title="Players online now">Users</div>`;
  const convoTabs = tabs.map(t =>
    `<div class="tos-chat-tab${t.key === _chatTab ? ' sel' : ''}" data-chat-tab="${esc(t.key)}">${esc(t.label)}${t.unread ? `<span class="tos-chat-pip">${t.unread}</span>` : ''}${t.closable ? `<span class="tos-chat-x" data-chat-close="${esc(t.key)}" title="Close (or type /leave)">✕</span>` : ''}</div>`
  ).join('');
  const tabRow = `<div class="tos-chat-tabs">${usersTab}${convoTabs}</div>`;

  // Users hub: show the online-player directory instead of a message log.
  if (onUsers) return `<div class="tos-chat">${tabRow}${renderChatUsers()}</div>`;

  const msgs = active ? getChatMessages(active.key) : [];
  const logInner = !active
    ? '<div class="tos-empty">No conversations yet. Open <strong>Users</strong> to message someone, or join a corp for its channel.</div>'
    : (msgs.length ? msgs.map(renderChatMsg).join('') : '<div class="tos-empty">No messages yet.</div>');
  const log = `<div class="tos-chat-log" id="tos-chat-log">${logInner}</div>`;

  const input = active && !active.systemOnly
    ? `<div class="tos-chat-input-row"><input id="tos-chat-input" type="text" autocomplete="off" placeholder="Message ${esc(active.label)}…" /><button class="tos-btn" data-chat-send="1">Send</button></div>`
    : '';

  return `<div class="tos-chat">${tabRow}${log}${input}</div>`;
}

// ── News app ────────────────────────────────────────────────────────────────
// The feed: a stack of section cards, each rendered by its section.type. New
// section types (weather, corp wars, market) add a case to newsWidget below and
// a builder server-side (plugins/tablet/news-app.js). Unknown types degrade to
// a plain "unavailable" note rather than blanking the feed.
function renderNews(sections) {
  if (!sections || !sections.length) return '<div class="tos-empty">No news right now. Check back later.</div>';
  return sections.map(sec => `<div class="tos-news-sec">
    <div class="tos-news-head"><span class="tos-news-title">${esc(sec.title || '')}</span>${sec.subtitle ? `<span class="tos-news-sub">${esc(sec.subtitle)}</span>` : ''}</div>
    ${newsWidget(sec)}
  </div>`).join('');
}

function newsWidget(sec) {
  switch (sec.type) {
    case 'headlines': return renderHeadlinesWidget(sec.stories);
    case 'standings': return renderStandingsWidget(sec.teams);
    default: return '<div class="tos-empty" style="padding:12px 4px">This section is unavailable.</div>';
  }
}

function renderHeadlinesWidget(stories) {
  if (!stories || !stories.length) return '<div class="tos-empty" style="padding:14px 4px">Quiet news day. Too quiet.</div>';
  return `<div class="tos-news-list">${stories.map(s => `<div class="tos-headline">
    <span class="tos-hl-tag ${s.tag === 'live' ? 'live' : 'tabloid'}">${s.tag === 'live' ? 'LIVE' : 'WIRE'}</span>
    <span class="tos-hl-text">${esc(s.headline)}${s.byline ? ` <span class="tos-hl-by">— ${esc(s.byline)}</span>` : ''}</span>
  </div>`).join('')}</div>`;
}

function renderStandingsWidget(teams) {
  if (!teams || !teams.length) return '<div class="tos-empty" style="padding:14px 4px">No games have been played yet — the DEADBALL standings are empty.</div>';
  const rows = teams.map(t => `<tr>
    <td class="tos-st-rank">${t.rank}</td>
    <td class="tos-st-team">${esc(t.team)}</td>
    <td>${t.wins}</td>
    <td>${t.losses}</td>
    <td>${esc(String(t.pct))}</td>
    <td class="tos-st-rd">${esc(String(t.rd))}</td>
  </tr>`).join('');
  return `<table class="tos-standings">
    <thead><tr><th>#</th><th class="tos-st-team">Team</th><th>W</th><th>L</th><th>Pct</th><th>RDif</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
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
    a.disabled
      ? `<button class="tos-btn disabled" disabled>${esc(a.label)}</button>`
      : `<button class="tos-btn" data-act-id="${esc(a.id)}" data-act-app="${esc(appId)}" data-act-params="${esc(params || '')}"${a.prompt ? ` data-act-prompt="${esc(a.prompt)}"` : ''}${a.confirm ? ` data-act-confirm="${esc(a.confirm)}"` : ''}>${esc(a.label)}</button>`
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
      ${d.notice ? `<div class="tos-error" style="text-align:left;padding:0 0 10px">${esc(d.notice)}</div>` : ''}
      ${renderCorp(d.corp || {})}
      ${d.corp?.canEdit ? renderColorPicker(d.appId, d.palette, d.corp?.color) : ''}
      ${renderActions(d.appId, d.actions, '')}
    </div>`;
  }
  if (d.view === 'corp_found') {
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, [d.appName])}
      ${d.notice ? `<div class="tos-error" style="text-align:left;padding:0 0 10px">${esc(d.notice)}</div>` : ''}
      ${renderCorpFound(d)}
    </div>`;
  }
  if (d.view === 'corp_map') {
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}
      ${d.notice ? `<div class="tos-error" style="text-align:left;padding:0 0 10px">${esc(d.notice)}</div>` : ''}
      ${renderCorpMap(d)}
    </div>`;
  }
  if (d.view === 'map') {
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}
      <div id="tos-map-root">${renderMap(d)}</div>
    </div>`;
  }
  if (d.view === 'surveillance') {
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}
      ${renderSurveillance(d)}
    </div>`;
  }
  if (d.view === 'chat') {
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}
      ${renderChat()}
    </div>`;
  }
  if (d.view === 'news') {
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}
      ${renderNews(d.sections)}
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
    const params = det.id || '';
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb || [d.appName])}
      ${d.notice ? `<div class="tos-error" style="text-align:left;padding:0 0 10px">${esc(d.notice)}</div>` : ''}
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
      // Drilled into a detail from a specific list/board (e.g. Job Board) -> return
      // to that screen, not the app root.
      if (_backReturn && _data?.view === 'detail' && _backReturn.appId === appId) {
        nav(appId, _backReturn.screen, null);
      }
      // More than one crumb level deep -> go up one level (root of this app).
      // At the root already (or on home) -> go all the way back to Home.
      else if (appId && crumb.length > 1) nav(appId, null, null);
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
      const appId = _data.appId;
      nav(appId, currentScreen, id);
      // Remember the list/board we drilled in from so Back returns here rather than
      // the app root — the detail's own breadcrumb is rebuilt from the quest's
      // category and no longer reflects a Job Board / Pilot Contracts origin. (nav()
      // above just cleared _backReturn, so this set sticks for the detail render.)
      if (currentScreen) _backReturn = { appId, screen: currentScreen };
    });
  });
  _overlay.querySelectorAll('[data-page-nav]').forEach(el => {
    el.addEventListener('click', () => {
      const [appId, screenLabel, pageStr] = el.getAttribute('data-page-nav').split('|');
      nav(appId, screenLabel, `page:${pageStr}`);
    });
  });
  // Surveillance hub: clicking a camera tile focuses it (re-nav same screen with
  // the device id as params); a sub-screen link (e.g. Datachips) navs to it.
  _overlay.querySelectorAll('[data-nav-tile]').forEach(el => {
    el.addEventListener('click', () => {
      const crumb = _data?.breadcrumb || [];
      const currentScreen = crumb.length ? crumb[crumb.length - 1] : null;
      nav(_data.appId, currentScreen, el.getAttribute('data-nav-tile'));
    });
  });
  _overlay.querySelectorAll('[data-nav-screen]').forEach(el => {
    el.addEventListener('click', () => nav(_data.appId, el.getAttribute('data-nav-screen'), null));
  });
  _overlay.querySelectorAll('[data-act-id]').forEach(el => {
    el.addEventListener('click', () => {
      const appId = el.getAttribute('data-act-app');
      const actionId = el.getAttribute('data-act-id');
      const confirmText = el.getAttribute('data-act-confirm');
      const promptText = el.getAttribute('data-act-prompt');
      const baseParams = el.getAttribute('data-act-params');
      // Folding a corp also drops its now-dead chat channel from the list.
      const fire = (params) => { if (actionId === 'fold') removeCorpChannels(); act(appId, actionId, params); };

      // Auto-travel (Quests app) is a client-side movement toggle layered over the
      // server re-plotting the route: already auto-walking -> just stop it here, no
      // round trip; otherwise fire the server action, which plots a fresh route to
      // the tracked quest's next stop and flags the gps_route to set off (handled in
      // dispatch.js -> minimap.js startAutoWalk).
      if (actionId === 'autowalk') {
        if (isAutoWalking()) toggleAutoWalk();
        else act(appId, actionId, baseParams);
        return;
      }

      // In-browser dialogs instead of the browser's native confirm()/prompt() —
      // themed, draggable, and rendered above the tablet (confirm.js).
      if (promptText) {
        showPromptDialog({ title: 'Corporation', prompt: promptText, confirmLabel: 'Submit' }, (val) => fire(val));
        return;
      }
      if (confirmText) {
        showConfirmDialog({ title: 'Confirm', prompt: confirmText, confirmLabel: 'Confirm' }, () => fire(baseParams));
        return;
      }
      fire(baseParams);
    });
  });
  // Corp colour wheel — any colour, applied immediately via the set_color action.
  _overlay.querySelectorAll('[data-set-corp-color]').forEach(el => {
    el.addEventListener('change', () => act(el.getAttribute('data-set-corp-color'), 'set_color', el.value));
  });

  wireTabletSettings();
  wireCorpMap();
  wireMap();
}

// Map app: mode switch (server round trip — different tiles), tap-a-tile to select
// (client-side, refreshes the detail in place), and GPS route / auto-walk actions.
// No-op off the map screen.
function rebuildMap() {
  const root = _overlay.querySelector('#tos-map-root');
  if (root) { root.innerHTML = renderMap(_data); wireMap(); }
}
function wireMap() {
  _overlay.querySelectorAll('[data-map-mode]').forEach(el => {
    el.addEventListener('click', () => nav('map', el.getAttribute('data-map-mode'), null));
  });
  _overlay.querySelectorAll('[data-map-zone]').forEach(el => {
    el.addEventListener('click', () => {
      _tosMapSel = el.getAttribute('data-map-zone');
      sfx(TOS_SELECT_DEF);
      _overlay.querySelectorAll('.tos-map-tile.sel').forEach(s => s.classList.remove('sel'));
      el.classList.add('sel');
      const det = _overlay.querySelector('#tos-map-detail');
      if (det) { det.innerHTML = renderMapDetail(_data); wireMapActs(); }
    });
  });
  wireMapActs();
  const auto = _overlay.querySelector('[data-map-auto]');
  if (auto) auto.addEventListener('click', () => { toggleAutoWalk(); rebuildMap(); });
  const clear = _overlay.querySelector('[data-map-clear]');
  if (clear) clear.addEventListener('click', () => { setGpsRoute(null); rebuildMap(); });
}
function wireMapActs() {
  _overlay.querySelectorAll('[data-map-act]').forEach(el => {
    el.addEventListener('click', () => {
      const a = el.getAttribute('data-map-act');
      sfx(TOS_SELECT_DEF);
      if (a === 'route') {
        const cur = (_data.tiles || []).find(t => t.isCurrent);
        if (cur && _tosMapSel) {
          const path = routeBetween(cur.id, _tosMapSel, _data.tiles);
          if (path && path.length > 1) setGpsRoute(path);
        }
        rebuildMap();
      } else if (a === 'auto') {
        toggleAutoWalk();
        rebuildMap();
      }
    });
  });
}

// Territory Map: tap a zone to select it (client-side only — refreshes the
// highlight + detail in place so the map scroll spot survives); current-tile
// action buttons route through the corp app ('mapact'). No-op off the map screen.
function wireCorpMap() {
  _overlay.querySelectorAll('[data-cm-zone]').forEach(el => {
    el.addEventListener('click', () => {
      _tosCorpSel = el.getAttribute('data-cm-zone');
      sfx(TOS_SELECT_DEF);
      _overlay.querySelectorAll('.tos-cm-tile.sel').forEach(s => s.classList.remove('sel'));
      el.classList.add('sel');
      const det = _overlay.querySelector('#tos-cm-detail');
      if (det) { det.innerHTML = renderCorpMapDetail(_data); wireCorpMapActs(); }
    });
  });
  wireCorpMapActs();
}
function wireCorpMapActs() {
  _overlay.querySelectorAll('[data-cm-act]').forEach(el => {
    el.addEventListener('click', () => { sfx(TOS_SELECT_DEF); act('corp', 'mapact', el.getAttribute('data-cm-act')); });
  });
}

// The Settings app is rendered + driven entirely client-side (no server round
// trip): every control reads/writes the shared `architect_settings` via
// settings.js, so the Tablet stays in lock-step with the legacy panel. Option
// pills re-render on change (selection follows); sliders update live so the
// drag isn't interrupted. querySelector guards mean this is a no-op on non-
// Settings screens.
function wireTabletSettings() {
  const commit = (s) => { saveSettings(s); applySettings(s); };

  // Settings page tabs — switch grouped page (client-side only).
  _overlay.querySelectorAll('[data-set-page]').forEach(el => {
    el.addEventListener('click', () => {
      _tosSetPage = el.getAttribute('data-set-page');
      sfx(TOS_SELECT_DEF);
      render();
    });
  });

  // Shared UI theme grid — always drives settings.theme (the tablet-theme
  // picker is separate, for the unlinked Tablet theme only). Both keep the sheet
  // open and preserve its scroll spot so you can keep browsing after a pick.
  _overlay.querySelectorAll('[data-theme-pick]').forEach(el => {
    el.addEventListener('click', () => {
      sfx(TOS_SELECT_DEF);
      const s = loadSettings();
      s.theme = el.getAttribute('data-theme-pick');
      s.customColors = {}; // matches the legacy panel's theme-grid click (drops any in-progress custom edit)
      commit(s);
      _keepThemeScroll = true;
      render();
    });
  });
  // Unlinked Tablet's own independent theme — never touches the page theme.
  _overlay.querySelectorAll('[data-tablet-theme-pick]').forEach(el => {
    el.addEventListener('click', () => {
      sfx(TOS_SELECT_DEF);
      saveTabletTheme({ ...loadTabletTheme(), theme: el.getAttribute('data-tablet-theme-pick') });
      _keepThemeScroll = true;
      render();
    });
  });
  // Theme locker — easy Linked/Unlinked toggle.
  _overlay.querySelectorAll('[data-set-link]').forEach(el => {
    el.addEventListener('click', () => {
      sfx(TOS_SELECT_DEF);
      const tt = loadTabletTheme();
      if (el.getAttribute('data-set-link') === 'unlinked') saveTabletTheme({ linked: false, theme: tt.theme || 'dark' });
      else saveTabletTheme({ linked: true });
      render();
    });
  });
  // Theme trigger → open the scrollable picker sheet; ✕ Done closes it.
  _overlay.querySelectorAll('[data-open-theme-sheet]').forEach(el => {
    el.addEventListener('click', () => {
      sfx(TOS_SELECT_DEF);
      _tosThemePicker = el.getAttribute('data-open-theme-sheet');
      render();
    });
  });
  _overlay.querySelector('[data-theme-sheet-close]')?.addEventListener('click', () => {
    sfx(TOS_SELECT_DEF);
    _tosThemePicker = null;
    render();
  });
  // Chat app: pick a conversation, or send to the active one. Both operate on
  // whisper.js state; sending echoes + emits, which re-renders us via the sub.
  _overlay.querySelectorAll('[data-chat-tab]').forEach(el => {
    el.addEventListener('click', () => {
      _chatTab = el.getAttribute('data-chat-tab');
      markChatRead(_chatTab);
      sfx(TOS_SELECT_DEF);
      render();
    });
  });
  // ✕ on a tab — close/leave that conversation (channel or PM). Stop the click
  // from also switching to the tab we're closing.
  _overlay.querySelectorAll('[data-chat-close]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = el.getAttribute('data-chat-close');
      if (_chatTab === key) _chatTab = null; // let renderChat pick a new default
      leaveChatConversation(key); // emits an update → re-renders us
      sfx(TOS_SELECT_DEF);
    });
  });
  // Start a new PM with an online player (no floating panel side-effects).
  _overlay.querySelectorAll('[data-chat-new]').forEach(el => {
    el.addEventListener('click', () => {
      const h = el.getAttribute('data-chat-new');
      _chatTab = h;
      ensureChatConversation(h); // emits an update → re-renders us on the new tab
      markChatRead(h);
      sfx(TOS_SELECT_DEF);
      render();
    });
  });
  // Re-open a conversation the player closed earlier (channel or PM).
  _overlay.querySelectorAll('[data-chat-reopen]').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.getAttribute('data-chat-reopen');
      _chatTab = reopenChatTab(key); // emits an update → re-renders us on the tab
      markChatRead(_chatTab);
      sfx(TOS_SELECT_DEF);
      render();
    });
  });
  _overlay.querySelector('[data-chat-refresh]')?.addEventListener('click', () => {
    sfx(TOS_SELECT_DEF);
    refreshOnlinePlayers().then(() => { if (_data?.view === 'chat') render(); });
  });
  const chatInput = _overlay.querySelector('#tos-chat-input');
  const chatSend = _overlay.querySelector('[data-chat-send]');
  if (chatInput) {
    const doSend = () => {
      const v = chatInput.value.trim();
      if (!v) return;
      sendChatMessage(_chatTab, v);
      chatInput.value = '';
    };
    chatSend?.addEventListener('click', doSend);
    chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });
  }

  _overlay.querySelector('[data-open-theme-editor]')?.addEventListener('click', () => {
    const s = loadSettings();
    shutdownTablet(); // the theme editor overlay sits below the Tablet's z-index; step out of the way
    openThemeEditor(s, () => commit(s));
  });

  // Generic option-pill setter (fontSize, density, sidebarPosition, motion,
  // weatherFx, dpadSize, tempUnit, pokerFelt) — all string-valued.
  _overlay.querySelectorAll('[data-set-key]').forEach(el => {
    el.addEventListener('click', () => {
      sfx(TOS_SELECT_DEF);
      const s = loadSettings();
      s[el.getAttribute('data-set-key')] = el.getAttribute('data-set-val');
      commit(s);
      render();
    });
  });
  _overlay.querySelector('[data-set-poker-color]')?.addEventListener('change', (e) => {
    const s = loadSettings();
    s.pokerFeltColor = e.target.value;
    s.pokerFelt = 'custom';
    commit(s);
    render();
  });

  // Contrast — live preview on drag (not persisted), committed on release.
  const contrastSlider = _overlay.querySelector('[data-set-contrast]');
  const contrastLabel = _overlay.querySelector('[data-contrast-label]');
  const contrastText = (v) => (v === 0 ? 'Base' : `+${v}%`);
  if (contrastSlider) {
    contrastSlider.addEventListener('input', () => {
      const v = parseInt(contrastSlider.value, 10);
      const s = loadSettings();
      s._contrastPreview = v;
      applySettings(s); // preview only — not saved
      applyTabletTheme();
      if (contrastLabel) contrastLabel.textContent = contrastText(v);
    });
    contrastSlider.addEventListener('change', () => {
      const v = parseInt(contrastSlider.value, 10);
      const s = loadSettings();
      s.contrast = v;
      delete s._contrastPreview;
      commit(s);
    });
  }
  _overlay.querySelector('[data-contrast-reset]')?.addEventListener('click', () => {
    const s = loadSettings();
    s.contrast = 0;
    delete s._contrastPreview;
    commit(s);
    render();
  });

  // Sound master + per-channel toggles. Use a fresh settings copy (not main.js's
  // _setAudioEnabled, which would save its own stale snapshot and clobber volume
  // edits made here) — commit() already runs applySettings, which drives the
  // AudioEngine enable/disable, exactly as the legacy toggle does.
  _overlay.querySelectorAll('[data-set-sound]').forEach(el => {
    el.addEventListener('click', () => {
      sfx(TOS_SELECT_DEF);
      const s = loadSettings();
      (s.audio ||= {}).enabled = el.getAttribute('data-set-sound') === 'on';
      commit(s);
      render();
    });
  });
  _overlay.querySelectorAll('[data-set-audio]').forEach(el => {
    el.addEventListener('click', () => {
      sfx(TOS_SELECT_DEF);
      const s = loadSettings();
      (s.audio ||= {})[el.getAttribute('data-set-audio')] = el.getAttribute('data-set-audio-val') === 'true';
      commit(s);
      render();
    });
  });
  // Volume sliders — live, no re-render (keeps the drag alive).
  _overlay.querySelectorAll('[data-set-vol]').forEach(el => {
    el.addEventListener('input', () => {
      const key = el.getAttribute('data-set-vol');
      const s = loadSettings();
      (s.audio ||= {})[key] = parseFloat(el.value);
      commit(s);
      const label = _overlay.querySelector(`[data-vol-label="${key}"]`);
      if (label) label.textContent = `${Math.round(parseFloat(el.value) * 100)}%`;
    });
  });

  // Mature Content — hidden triple-click decoy reveal, then a server-driven toggle.
  _overlay.querySelector('[data-mis-decoy]')?.addEventListener('click', () => {
    _tosMisClicks++;
    if (_tosMisTimer) clearTimeout(_tosMisTimer);
    _tosMisTimer = setTimeout(() => { _tosMisClicks = 0; }, 400);
    if (_tosMisClicks >= 3) {
      _tosMisClicks = 0;
      _tosMisRevealed = true;
      sfx(TOS_ENTRY_DEF);
      render();
    }
  });
  _overlay.querySelectorAll('[data-mis-set]').forEach(el => {
    el.addEventListener('click', () => {
      sfx(TOS_SELECT_DEF);
      const enable = el.getAttribute('data-mis-set') === 'on';
      // Server-authoritative: send the raw ws message and update optimistically;
      // the server confirms (or corrects) via the mis_state_update event below.
      const sent = window._sendRaw && window._sendRaw({ type: 'mis_toggle', enable });
      if (sent) tosApplyMis(enable, false);
      else { const st = _overlay.querySelector('[data-mis-status]'); if (st) st.textContent = 'Not connected.'; }
    });
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
// to this one panel. Power-off stays a softer confirmation chirp; power-on is
// back to its original harsher sweep per user request.
const CRT_POWER_ON_DEF = {
  id: 'tablet_crt_power_on', category: 'sfx', priority: 3,
  config: { waveform: 'triangle', freq: 60, duration: 0.4, noiseMix: 0.25, pitchBend: { to: 700, time: 0.28 }, filter: { type: 'lowpass', freq: 3400, q: 1 }, adsr: { a: 0.004, d: 0.18, s: 0.25, r: 0.18 } },
};
const CRT_POWER_OFF_DEF = {
  id: 'tablet_crt_power_off', category: 'sfx', priority: 3,
  config: { waveform: 'sine', freq: 520, duration: 0.16, noiseMix: 0.03, pitchBend: { to: 280, time: 0.12 }, filter: { type: 'lowpass', freq: 2000, q: 0.6 }, adsr: { a: 0.01, d: 0.05, s: 0.08, r: 0.08 } },
};
const TABLET_SFX_GAIN = 0.55; // soft — a register-blip, not a chime you'd notice repeatedly

// Selection/navigation clicks. Tablet screens reused the shared hololock-set/
// hololock-entry catalog cues (tuned sharp on purpose for that hacking
// minigame's tension) for every pill click, tab switch, and zone tap — which
// gets grating fast on a device you click through constantly. These are local,
// softer stand-ins: same "yes, that registered" function, much quieter and
// shorter, and don't touch the catalog cues hololock/corp-console/corp-map/
// fishing/cockpit still rely on.
const TOS_SELECT_DEF = {
  id: 'tos_select', category: 'sfx', priority: 4,
  config: { duration: 0.06, layers: [
    { waveform: 'sine', freq: 640, pitchBend: { to: 760, time: 0.04 }, filter: { type: 'lowpass', freq: 2000, q: 0.6 }, adsr: { a: 0.003, d: 0.045, s: 0, r: 0.025 }, gain: 0.08 },
  ] },
};
const TOS_ENTRY_DEF = {
  id: 'tos_entry', category: 'sfx', priority: 4,
  config: { duration: 0.2, layers: [
    { waveform: 'sine', freq: 240, pitchBend: { to: 380, time: 0.14 }, filter: { type: 'lowpass', freq: 1600, q: 0.6 }, adsr: { a: 0.015, d: 0.1, s: 0.08, r: 0.07 }, gain: 0.09 },
  ] },
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
  window.AudioEngine?.playSfx(CRT_POWER_OFF_DEF, TABLET_SFX_GAIN);
  panel.addEventListener('animationend', () => close(), { once: true });
  setTimeout(() => close(), CRT_OFF_ANIM_MS + 100); // backstop if animationend never fires
}

export function openTabletPanel(msg) {
  ensureChassisStyles();
  ensureStyles();
  _data = msg;

  // Keep the Settings screen's MIS toggle in step with the server (player_update
  // dispatches mis_state_update). Bound once; harmless when Settings isn't shown.
  if (!_tosMisListenerBound) {
    _tosMisListenerBound = true;
    document.addEventListener('mis_state_update', (e) => tosApplyMis(e.detail?.enabled, e.detail?.server_disabled));
  }

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
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }

  const survLive = _data.view === 'surveillance' && !!_data.live;
  const isChat = _data.view === 'chat';
  // A live surveillance poll refreshes in place — keep the operator's scroll spot
  // instead of yanking to the top every 5s. A live quest refresh (an objective
  // ticking while the player reads the screen) preserves it the same way, via a
  // one-shot flag. Every other (real) nav starts at top.
  const keepScroll = (survLive && _wasSurvLive) || _keepQuestScroll || _keepThemeScroll;
  _keepQuestScroll = false;
  _keepThemeScroll = false;
  const prevTop = scroll.scrollTop;

  // Chat re-renders on every incoming/outgoing message (via the subscription).
  // Preserve the reply input's text + focus across that full rebuild so a
  // message arriving mid-typing doesn't wipe what the player is writing.
  let chatInputState = null;
  if (isChat) {
    const ci = _overlay.querySelector('#tos-chat-input');
    if (ci) chatInputState = { value: ci.value, start: ci.selectionStart, end: ci.selectionEnd, focused: document.activeElement === ci };
  }

  scroll.innerHTML = renderBody();
  scroll.scrollTop = keepScroll ? prevTop : 0;
  _wasSurvLive = survLive;
  wireBody();
  applyTabletTheme();

  if (isChat) {
    const log = _overlay.querySelector('#tos-chat-log');
    if (log) log.scrollTop = log.scrollHeight; // chat pins to the newest line
    if (chatInputState) {
      const ci = _overlay.querySelector('#tos-chat-input');
      if (ci) {
        ci.value = chatInputState.value;
        if (chatInputState.focused) { ci.focus(); try { ci.setSelectionRange(chatInputState.start, chatInputState.end); } catch {} }
      }
    }
    // Live re-render when whisper.js's chat state changes (new message, etc.).
    // First entry into chat also pulls a fresh online list for the "New" strip.
    if (!_chatUnsub) {
      _chatUnsub = onChatUpdate(() => render());
      refreshOnlinePlayers().then(() => { if (_data?.view === 'chat') render(); });
    }
  } else if (_chatUnsub) {
    _chatUnsub(); _chatUnsub = null;
  }

  if (survLive) _pollTimer = setInterval(pollSurveillance, 5000);
}

export function closeTabletPanel() { shutdownTablet(); }

// A dropped connection or a sign-out (both fire game-disconnect) leaves the
// tablet driving nothing — tear it down immediately, no CRT flourish.
window.addEventListener('game-disconnect', () => { if (_overlay) close(); });

function close() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  if (_chatUnsub) { _chatUnsub(); _chatUnsub = null; }
  _wasSurvLive = false;
  if (_close) { _close(); _close = null; }
  _overlay = null;
}

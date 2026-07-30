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
import { toggleAutoWalk, isAutoWalking, isRunning, onRunStateChange, setGpsRoute, routeBetween, getTracePath, setMapOpener, FUNC_LEGEND, POI_LEGEND, isWorldWaterVoid, districtCoord, WATER_VOID_FILL, crossingInnerHtml, isOnCrossing } from './minimap.js';
import { state } from '../state.js';
import { maybeTabletTour } from './tour.js';
import { loadSettings, saveSettings, applySettings, openThemeEditor, probeBuiltinThemeColors, DARK_THEMES, LIGHT_THEMES, DEFAULT_AUDIO_SETTINGS } from '/shared/settings.js';
import { getChatTabs, getChatMessages, sendChatMessage, markChatRead, onChatUpdate, getOnlinePlayers, refreshOnlinePlayers, ensureChatConversation, leaveChatConversation, removeCorpChannels, getClosedChatTabs, reopenChatTab, getMotdHtml } from './whisper.js';
import { showPromptDialog, showConfirmDialog, showSelectDialog } from './confirm.js';
import { parseMarkup } from '../markup.js';
import { openMusicPlayerPanel } from './musicplayer.js';
import { createTvView } from './tv.js';
import { resetOrder } from './sidebar-order.js';

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

// ── Quest action log (client-only) ──────────────────────────────────────────
// A per-quest narrative of what you actually did on that quest — the same lines
// that scroll past in the bottom pane (arrivals, objective flavour emotes) plus
// bold beat-markers (started / objective complete / quest complete) — shown on
// that quest's detail screen so you can read its whole story without watching the
// output pane. Deliberately client-side (localStorage, per-device): the server
// pushes structured `quest_log` events (plugins/quests/index.js questLogLine) that
// we bucket by quest_id. No server round trip, no DB row.
//
// Store shape: { [quest_id]: { name, done, entries: [{ kind, text, t }] } }
//   kind: 'start' | 'arrive' | 'emote' | 'objective' | 'complete'
// A quest flips `done` on its 'complete' beat; its bucket is purged the next time
// the tablet closes (purgeCompletedQuestLogs) — "clears once finished + closed".
const QLOG_KEY = 'architect_quest_log_v2';
const QLOG_ENTRY_CAP = 60; // per-quest, oldest trimmed
function loadQLog() {
  try { const o = JSON.parse(localStorage.getItem(QLOG_KEY) || '{}'); return (o && typeof o === 'object') ? o : {}; }
  catch { return {}; }
}
function saveQLog(o) { try { localStorage.setItem(QLOG_KEY, JSON.stringify(o)); } catch {} }

// Feed a structured server quest_log event into its quest's bucket.
export function noteQuestLog(msg) {
  if (!msg || !msg.quest_id || !msg.kind || !msg.text) return;
  const log = loadQLog();
  const q = log[msg.quest_id] || (log[msg.quest_id] = { name: '', done: false, entries: [] });
  if (msg.kind === 'start') q.name = msg.text;
  if (msg.kind === 'complete') q.done = true;
  const entries = q.entries;
  // Collapse an exact immediate repeat (e.g. a double-fired line).
  const last = entries[entries.length - 1];
  if (!(last && last.kind === msg.kind && last.text === msg.text)) {
    entries.push({ kind: msg.kind, text: msg.text, t: Date.now() });
    if (entries.length > QLOG_ENTRY_CAP) entries.splice(0, entries.length - QLOG_ENTRY_CAP);
  }
  saveQLog(log);
  // Live-refresh the detail screen if it's showing this very quest.
  if (_overlay && _data && _data.appId === 'quests' && _data.view === 'detail'
      && (_data.quest?.id || _data.detail?.id) === msg.quest_id) {
    _keepQuestScroll = true;
    render();
  }
}

// Drop a quest's log entirely (e.g. it was abandoned).
export function dropQuestLog(questId) {
  const log = loadQLog();
  if (log[questId]) { delete log[questId]; saveQLog(log); }
}

// On tablet close, clear the log of any quest that has finished — "after the tablet
// is closed once the quest is completed it clears the log".
function purgeCompletedQuestLogs() {
  const log = loadQLog();
  let changed = false;
  for (const id of Object.keys(log)) if (log[id]?.done) { delete log[id]; changed = true; }
  if (changed) saveQLog(log);
}

// The per-quest action log for one quest's detail screen. Bold headers for the
// beat-markers, plain narrative lines for arrivals/emotes.
function renderQuestActivityLog(questId) {
  const q = loadQLog()[questId];
  if (!q || !q.entries.length) return '';
  const rows = q.entries.map(e => {
    if (e.kind === 'start')     return `<div class="tos-qlog-beat">Started quest: ${esc(e.text)}</div>`;
    if (e.kind === 'objective') return `<div class="tos-qlog-beat">Objective complete: ${esc(e.text)}</div>`;
    if (e.kind === 'complete')  return `<div class="tos-qlog-beat tos-qlog-done">Quest complete: ${esc(e.text)}</div>`;
    return `<div class="tos-qlog-line">${esc(e.text)}</div>`;
  }).join('');
  return `<div class="tos-qlog">
    <div class="tos-qlog-hdr"><span>Action Log</span></div>
    ${rows}
  </div>`;
}

let _overlay = null;
let _close = null;
let _data = null; // last tablet_panel payload
let _pollTimer = null; // live-refresh interval for the Surveillance hub screen
let _fakeTimer = null; // Arcade app: ambient-line ticker for the fake MUD terminal
let _reelTimer = null; // Microreel viewer: playback step interval
let _reelIdx = 0;      // Microreel viewer: current frame index
let _reelPlaying = false; // Microreel viewer: play/pause state
let _wasSurvLive = false; // was the last render a live surveillance screen (scroll-preserve)
let _keepQuestScroll = false; // one-shot: preserve scroll on the next render (a live quest refresh)
let _keepThemeScroll = false; // one-shot: preserve scroll on the next render (picking within the theme sheet)
let _chatTab = null;   // Chat app: currently selected conversation key (channel id / PM handle, or CHAT_USERS_TAB)
const CHAT_USERS_TAB = '__users__'; // Chat app: the Users hub tab (online-player directory, not a real conversation)
let _chatUnsub = null; // Chat app: whisper.js update subscription (live re-render), null when not on chat
let _chatEmojiOpen = false; // Chat app: is the emoji picker popup open (persists across the frequent chat re-renders)
let _tosThemePicker = null;      // Settings: which theme selector sheet is open — null | 'ui' | 'tablet'
let _tosSetPage = 'General';     // Settings: active page tab (grouped like the game's settings)
let _tosMisRevealed = false; // Settings: has the hidden Mature Content (MIS) toggle been revealed
let _tosMisClicks = 0, _tosMisTimer = null; // decoy 3-click reveal counter
let _tosMisListenerBound = false; // one-time bind of the server mis_state_update sync
let _tosCorpSel = null; // Corp Territory Map: selected zone id (client-side, no round trip)
let _tosCorpPage = 0; // Corp dashboard: current page (Overview/Operatives/Territory/Diplomacy), client-side
let _tosIdeoPage = 0; // Ideology reader: current page (Overview / per-order / Field), client-side
let _tosMapSel = null; // Map app: tapped/destination zone id (client-side, drives the GPS route)
// Map app: label mode — stamp a two-letter code on each building tile instead of
// its icon. This is NOT its own state: it reads and writes the same `mapOverlay`
// setting the sidebar minimap runs on, so the two surfaces can never disagree.
// It used to be a module-local boolean defaulting to false, which is why the Map
// app opened in icon mode no matter what the saved setting said, and why its
// Labels chip never reached the minimap.
const mapLabelsOn = () => {
  try { return (loadSettings().mapOverlay || 'labels') === 'labels'; } catch { return true; }
};
// Void survey zoom: the off-grid "journey" map has no server tile-window ladder (it's
// drawn purely from the minimap nodes), so its −/+ is a client-only scale on the trail.
// Default sits large per the brief ("show the route big, zoom out from there").
let _tosVoidZoom = 1.35;
const VOID_ZMIN = 0.55, VOID_ZMAX = 2.3, VOID_ZSTEP = 0.35;

// ── Void boot + signal: a one-time ritual, not a running mechanic ─────────────
// Out in the void the tablet can't reach ArchitectOS at all. The FIRST time you
// bring it up on a given crossing it cold-starts on its own on-board firmware
// (runVoidFirmwareBoot): a terminal boot that tries the grid handshake, fails it,
// and comes up in VOIDLINK LOCAL instead. It then sits in a SEARCHING state — the
// screen's TEXT flickers (never the whole panel) and the header reads "NO SIGNAL ·
// SEARCHING" — until you physically move the tablet, which locks a weak carrier:
// one soft brightness swell, "WEAK SIGNAL · OFF GRID", and the flicker is done for
// the rest of the crossing no matter where you drag it afterwards. No app gating at
// any point; void theming (.tos-void-mode) rides along while isOnCrossing() holds.
let _voidTripPrimed = false;    // has the firmware boot already played for the CURRENT crossing?
let _voidSearching = false;     // in the pre-lock "no signal, searching" state?
let _voidLocked = false;        // has the weak carrier been locked this crossing? (sticky)
let _wasOnCrossingWatch = false; // last isOnCrossing() reading, polled independently of the tablet being open
let _voidIntro = null;          // { cancel() } while the firmware boot is live, else null
let _voidHunt = null;           // { cancel() } while the drag-to-lock listeners are armed, else null
// Map app zoom: one unified axis. The −/+ buttons walk the server's zoom ladder
// (movement.js MAP_ZOOM_HALVES) — each step grows the tile window and, at the far
// end, becomes the whole-region view — instead of just resizing pixels. This array
// is the tile pixel size per server zoomLevel (0 local street … maxZoom regional);
// interior (zoomLevel −1) reuses the local-street size. Index by server zoomLevel.
const TOS_ZOOM_PX = [56, 40, 30, 24, 19, 15];
const TOS_INTERIOR_PX = 56;
const tosZoomPx = (d) => d.mode === 'interior'
  ? TOS_INTERIOR_PX
  : TOS_ZOOM_PX[Math.max(0, Math.min(TOS_ZOOM_PX.length - 1, d.zoomLevel ?? 0))];
// The minimap double-click opens the city map — now the in-tablet Map app, since the
// standalone popup is retired. Injected here (minimap.js can't import us — that'd be a
// cycle) so the double-click stays decoupled from the tablet.
setMapOpener(openTabletToMap);
// Keep the Map app's Run button lit in step with the sidebar toggle (run_state echo).
onRunStateChange((running) => {
  _overlay?.querySelector('[data-map-run]')?.classList.toggle('active', running);
});
// Watch for crossing entry independently of whether the tablet is even open, so a
// trip started/finished with the tablet closed still primes/unprimes the intro
// correctly the next time it's opened. Cheap — one cached-state read a second.
setInterval(() => {
  const on = isOnCrossing();
  // Stepped into a fresh crossing — the firmware boot and the signal hunt both
  // arm again (the lock is per-crossing, not per-session).
  if (on && !_wasOnCrossingWatch) { _voidTripPrimed = false; _voidLocked = false; _voidSearching = false; }
  _wasOnCrossingWatch = on;
}, 1000);
let _gearLayer = 2; // Gear app: displayed body layer (0 skin / 1 clothes / 2 armor), client-side
let _gearTab = 'inventory';  // Gear app primary tab: 'inventory' (full paged pack) or 'loadout' (paperdoll)
let _gearTrayPage = 0;       // Gear app: current page of the loadout carried tray
let _gearInvPage = 0;        // Gear app: current page of the Inventory tab
let _gearClothingOpen = false; // Gear app: is the Inventory-tab Clothing group expanded? (collapsed by default)
let _gearArmorOpen = false;  // Gear app: is the Inventory-tab Armour group expanded? (collapsed by default)
let _gearIdp = null;         // Gear app: open item-detail modal element (Inventory tab)
let _gearTipEl = null;       // Gear app: shared hover tooltip element (quick stats)
let _gearFbTimer = null;     // Gear app: auto-clear timer for the below-feet feedback line
let _skipBoot = false;       // one-shot: open the tablet with no CRT boot animation (Smart bar "Inv")
let _keepGearScroll = false; // one-shot: preserve scroll across an equip/unequip/drop refresh
let _keepNewsScroll = false; // one-shot: preserve scroll when the News weather widget expands/collapses
let _newsWeatherOpen = false; // News app: is the weather widget's 7-day forecast expanded?
let _newsStories = [];  // News app: the current headline feed, so a tapped headline can open its full story
let _newsWin = null;    // News app: the open "browser window" story popup element, if any
// (A drill-in's "return here" used to be tracked separately; the nav history below
//  covers it — see the Back stack.)

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
    /* 820, not 680: four rows of tiles + the toolbar + a couple of widget cards has
       to fit without the home screen scrolling, which is the whole promise of a
       fixed-shape grid. max-height keeps it inside a short viewport, and the mobile
       block near the bottom of this sheet takes over on a compact layout. */
    /* The height is CONSTANT whether or not the cards are on. Widgets are off by
       default, so the common case was ~110px reserved for a dashboard that isn't there
       — a band of empty screen under the toolbar. That space now goes to the tiles
       (see the .tos-no-widgets block further down) rather than coming off the chassis:
       a shorter panel still left the grid huddled at the top, and the apps are what the
       home screen is FOR. The .tos-no-widgets class is set from widgetsEnabled()
       (_applyWidgetChrome), so turning cards on in Settings shrinks the tiles back in
       the same gesture that adds the dashboard.
       NB: this whole sheet is a TEMPLATE LITERAL — never put a backtick in a comment
       here. One in this very block closed the string early, the rest of the sheet
       parsed as JavaScript, and ensureStyles threw "no is not defined" at runtime.
       A node --check passes anyway, because the result is still valid JS — so the only
       symptom is the tablet silently refusing to open. */
    #tablet-os-overlay .tos-panel { width:min(760px,96vw); height:820px; max-height:94vh; display:flex; flex-direction:column;
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
    /* While a drag-scroll gesture is live, show the grabbing hand and kill text
       selection so dragging pans the screen instead of highlighting content. */
    #tablet-os-overlay .tos-scroll.tos-drag-scrolling { cursor:grabbing; user-select:none; }
    /* Scrollbars inside the tablet answer to the TABLET's palette, not the
       terminal's. The device has its own surface and accent (--tos-*, --mg-accent)
       and a bar drawn in the game's --border reads as the room's chrome leaking
       through the screen. Scoped to every descendant because WebKit won't inherit
       the pseudo-elements; the per-app bars below are more specific and still win. */
    #tablet-os-overlay * { scrollbar-width:thin;
      scrollbar-color:color-mix(in srgb, var(--mg-accent) 40%, transparent) transparent; }
    #tablet-os-overlay *::-webkit-scrollbar { width:6px; height:6px; }
    #tablet-os-overlay *::-webkit-scrollbar-track { background:rgba(0,0,0,.32); border-radius:3px; }
    #tablet-os-overlay *::-webkit-scrollbar-thumb {
      background:color-mix(in srgb, var(--mg-accent) 40%, transparent); border-radius:3px; }
    #tablet-os-overlay *::-webkit-scrollbar-thumb:hover {
      background:color-mix(in srgb, var(--mg-accent) 68%, transparent); }
    #tablet-os-overlay *::-webkit-scrollbar-corner { background:transparent; }
    #tablet-os-overlay .tos-body { padding:14px 13px; font-size:13.5px; }
    /* ── Sticky chrome ───────────────────────────────────────────────────────
       The status row (location · clock) and the breadcrumb (Back) live INSIDE
       the scrolling body, so on any long screen they scrolled away — you lost
       the clock and had to scroll back up to find Back. Pinning them costs no
       markup change, so every app screen gets it at once.

       Two stops, not one: the crumb sits directly under the status row rather
       than on top of it. --tos-hdr-h is that offset in one place so the two can
       never drift apart. The backgrounds are opaque because content scrolls
       UNDER them, and the negative margins + padding let each bar span the full
       panel width while the body keeps its 13px gutter. */
    #tablet-os-overlay { --tos-hdr-h:25px; }
    #tablet-os-overlay .tos-hdr {
      position:sticky; top:0; z-index:8;
      background:var(--bg, #0c1114);
      margin:-14px -13px 8px; padding:14px 13px 5px;
    }
    #tablet-os-overlay .tos-crumb {
      position:sticky; top:var(--tos-hdr-h); z-index:7;
      background:var(--bg, #0c1114);
      margin:0 -13px 9px; padding:5px 13px 7px;
      border-bottom:1px solid var(--tos-line, var(--border));
    }
    /* The clock is the one thing that must never go — it is the tablet telling
       you the time, which is half of why anyone opens it. */
    #tablet-os-overlay .tos-hdr-right { position:relative; z-index:9; }

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
    #tablet-os-overlay .tos-hdr-right { display:inline-flex; align-items:center; gap:9px; }
    #tablet-os-overlay .tos-hdr-left, #tablet-os-overlay .tos-hdr-loc { align-self:center; }
    /* The clock. Sized well above the rest of the bar so it reads at a glance, and
       tabular so the minute ticking over doesn't shift the signal bars sideways.
       It's a button because it opens the Alarm app — styled back down to look like
       part of the bar rather than a control. */
    #tablet-os-overlay .tos-hdr-clock {
      font: inherit; font-size:17px; line-height:1; letter-spacing:.5px;
      font-variant-numeric:tabular-nums; color:var(--mg-accent);
      background:none; border:0; padding:0 1px; margin:0; cursor:pointer;
      transition:opacity .15s linear, text-shadow .15s linear;
    }
    #tablet-os-overlay .tos-hdr-clock:hover { text-shadow:0 0 8px var(--mg-accent); }
    #tablet-os-overlay .tos-hdr-clock:focus-visible { outline:1px solid var(--mg-accent); outline-offset:2px; }
    /* Cell-signal bars: four ascending accent bars, bottom-aligned. On the grid only —
       off the grid the header shows the void badge below instead. */
    #tablet-os-overlay .tos-signal { display:inline-flex; align-items:center; gap:4px; height:9px; position:relative; }
    #tablet-os-overlay .tos-sig-bars { display:inline-flex; align-items:flex-end; gap:1.5px; height:9px; position:relative; }
    #tablet-os-overlay .tos-signal .tos-sig-bar { width:2.5px; border-radius:1px; background:var(--mg-accent); opacity:.22; transition:opacity .18s linear; }
    #tablet-os-overlay .tos-signal .tos-sig-bar.on { opacity:1; }

    /* ── Void badge: the header's off-grid indicator, header strip only. Two states:
       SEARCHING (before you've found a position — the badge text flickers along with
       the rest of the screen text) and, once locked, a steady WEAK SIGNAL · OFF GRID
       that stays put for the rest of the crossing. No gating either way. */
    #tablet-os-overlay .tos-void-badge { display:inline-flex; align-items:center; gap:5px; font-family:var(--font-mono,monospace);
      font-size:9px; font-weight:700; letter-spacing:1.5px; color:var(--mg-accent); text-transform:uppercase; }
    #tablet-os-overlay .tos-void-badge.searching { color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-void-badge-dot { width:6px; height:6px; border-radius:50%; background:var(--mg-accent);
      box-shadow:0 0 6px color-mix(in srgb, var(--mg-accent) 70%, transparent); animation:tos-void-badge-pulse 2.6s ease-in-out infinite; }
    #tablet-os-overlay .tos-void-badge.searching .tos-void-badge-dot { background:var(--tos-fg-dim); box-shadow:none;
      animation:tos-void-badge-pulse 1s ease-in-out infinite; }
    @keyframes tos-void-badge-pulse { 0%,100%{opacity:1} 50%{opacity:.45} }
    /* DEADHEAD live-aircraft marker: a slow radar ping under the aeroplane while she's actually
       moving, so a glance tells you airborne from parked without reading the status line. */
    @keyframes tos-dh-ping { 0%{transform:scale(.6);opacity:.85} 100%{transform:scale(1.7);opacity:0} }
    [data-motion="off"] #tablet-os-overlay .tos-void-badge-dot { animation:none; }

    /* ── Void firmware boot: the one-shot cold start on the first tablet open of a
       crossing ───────────────────────────────────────────────────────────────────
       Out here the tablet can't reach ArchitectOS at all, so it falls back to its own
       on-board firmware: a slow terminal cold-start that tries the grid handshake,
       fails it, and boots into VOIDLINK LOCAL instead. Lines type in one at a time
       (JS-driven, see runVoidFirmwareBoot) — no whole-screen strobing anywhere. */
    #tablet-os-overlay .tos-void-boot { position:absolute; inset:0; z-index:6; display:flex; flex-direction:column;
      justify-content:center; gap:2px; padding:16px 18px; background:var(--bg, #0c1114);
      font-family:var(--font-mono,monospace); font-size:10.5px; letter-spacing:.6px; }
    #tablet-os-overlay .tos-void-boot-hd { color:var(--mg-accent); font-size:11.5px; letter-spacing:2.5px; font-weight:700;
      text-shadow:0 0 12px color-mix(in srgb, var(--mg-accent) 55%, transparent); margin-bottom:2px; }
    #tablet-os-overlay .tos-void-boot-rule { border-top:1px solid color-mix(in srgb, var(--mg-accent) 35%, transparent); margin:2px 0 6px; }
    #tablet-os-overlay .tos-void-bootline { color:var(--tos-fg-dim); white-space:pre; overflow:hidden; text-overflow:ellipsis;
      animation:tos-void-linein .22s ease-out; }
    @keyframes tos-void-linein { from{opacity:0} to{opacity:1} }
    [data-motion="off"] #tablet-os-overlay .tos-void-bootline { animation:none; }
    #tablet-os-overlay .tos-void-bootline.ok b { color:var(--mg-accent); }
    #tablet-os-overlay .tos-void-bootline.fail { color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-void-bootline.fail b { color:#ff5c6b; }
    #tablet-os-overlay .tos-void-bootline.hero { color:var(--mg-accent); font-weight:700; letter-spacing:2px; margin-top:6px;
      text-shadow:0 0 10px color-mix(in srgb, var(--mg-accent) 50%, transparent); }
    #tablet-os-overlay .tos-void-bootcur { display:inline-block; width:.6em; background:var(--mg-accent);
      animation:tos-void-cursor 1s steps(2) infinite; }
    @keyframes tos-void-cursor { 0%,49%{opacity:1} 50%,100%{opacity:0} }
    [data-motion="off"] #tablet-os-overlay .tos-void-bootcur { animation:none; }

    /* Signal lock: a short, soft brightness swell the instant the antenna locks —
       a settle, not a strobe. */
    #tablet-os-overlay .tos-panel.tos-void-lock .tos-screen { animation:tos-void-lock-flash .7s ease-out; }
    @keyframes tos-void-lock-flash { 0%{filter:brightness(1.45)} 100%{filter:brightness(1)} }
    [data-motion="off"] #tablet-os-overlay .tos-panel.tos-void-lock .tos-screen { animation:none; }

    /* ── Searching for signal: the screen's TEXT flickers (the whole panel never
       does — no strobing chassis), exactly like a set hunting for a carrier. Ends
       for good the moment the antenna locks; never comes back this crossing. */
    #tablet-os-overlay .tos-panel.tos-void-searching .tos-scroll { animation:tos-void-textflicker 2.6s steps(1,end) infinite; }
    @keyframes tos-void-textflicker {
      0%,100%{opacity:1} 6%{opacity:.32} 9%{opacity:1} 34%{opacity:1} 36%{opacity:.42} 38%{opacity:1}
      63%{opacity:1} 65%{opacity:.25} 67%{opacity:.85} 69%{opacity:1} 88%{opacity:1} 90%{opacity:.5} 92%{opacity:1} }
    [data-motion="off"] #tablet-os-overlay .tos-panel.tos-void-searching .tos-scroll { animation:none; opacity:.85; }
    #tablet-os-overlay .tos-void-hunt { position:absolute; left:0; right:0; bottom:0; z-index:7; pointer-events:none;
      padding:5px 0 6px; text-align:center; font-family:var(--font-mono,monospace); font-size:9px; letter-spacing:2px;
      text-transform:uppercase; color:var(--tos-fg-dim);
      background:linear-gradient(to top, color-mix(in srgb, var(--bg, #0c1114) 92%, transparent), transparent); }
    #tablet-os-overlay .tos-panel:not(.tos-void-searching) .tos-void-hunt { display:none; }

    /* ── Void mode: persistent off-grid theming for the rest of the crossing (post-
       boot). Purely cosmetic — no app gating, no ongoing hunt. A scanline haze, a
       slow drifting interference band, and an accent-tinted vignette pulse, so every
       screen still reads as "off the grid" without ever interrupting play. */
    #tablet-os-overlay .tos-void-static { position:absolute; inset:0; z-index:5; pointer-events:none; opacity:0;
      mix-blend-mode:screen; transition:opacity .4s ease;
      background:repeating-linear-gradient(0deg, rgba(255,255,255,.05) 0 1px, transparent 1px 3px); }
    #tablet-os-overlay .tos-panel.tos-void-mode .tos-void-static { opacity:.16; }
    /* A single wide, very faint band that drifts down the screen forever — the tell
       that the picture is being carried by something that barely reaches you. */
    #tablet-os-overlay .tos-panel.tos-void-mode .tos-void-static::after { content:''; position:absolute; left:0; right:0; height:22%;
      background:linear-gradient(to bottom, transparent, rgba(255,255,255,.07), transparent);
      animation:tos-void-band 9s linear infinite; }
    @keyframes tos-void-band { from{top:-25%} to{top:105%} }
    [data-motion="off"] #tablet-os-overlay .tos-panel.tos-void-mode .tos-void-static::after { animation:none; opacity:0; }
    #tablet-os-overlay .tos-panel.tos-void-mode .tos-screen::after { content:''; position:absolute; inset:0; z-index:4; pointer-events:none;
      box-shadow:inset 0 0 46px color-mix(in srgb, var(--mg-accent) 20%, transparent); animation:tos-void-vignette 5s ease-in-out infinite; }
    @keyframes tos-void-vignette { 0%,100%{opacity:.55} 50%{opacity:1} }
    [data-motion="off"] #tablet-os-overlay .tos-panel.tos-void-mode .tos-screen::after { animation:none; opacity:.75; }
    /* Off-grid the device stops calling itself ARCHITECT OS — the chassis header and
       the home-screen wordmark both read VOIDLINK (set in JS; this just tints it). */
    #tablet-os-overlay .tos-panel.tos-void-mode .mg-head { color:var(--mg-accent); }

    /* TV app, off the grid: no station reaches out here, so the set shows dead air
       instead of a tuner (see renderTv). */
    #tablet-os-overlay .tos-tv-dead { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px;
      min-height:210px; margin:6px 0; border:1px solid var(--tos-border); border-radius:10px;
      background:repeating-linear-gradient(0deg, rgba(255,255,255,.045) 0 1px, transparent 1px 3px), #05070a; }
    #tablet-os-overlay .tos-tv-dead-bars { display:flex; gap:0; width:76%; height:46px; border-radius:3px; overflow:hidden; opacity:.5; }
    #tablet-os-overlay .tos-tv-dead-bars i { flex:1; }
    #tablet-os-overlay .tos-tv-dead-t { font-family:var(--font-mono,monospace); font-size:12px; font-weight:700; letter-spacing:4px;
      color:var(--mg-accent); text-transform:uppercase; animation:tos-void-textflicker 2.6s steps(1,end) infinite; }
    [data-motion="off"] #tablet-os-overlay .tos-tv-dead-t { animation:none; }
    #tablet-os-overlay .tos-tv-dead-s { font-family:var(--font-mono,monospace); font-size:9.5px; letter-spacing:2px;
      color:var(--tos-fg-dim); text-transform:uppercase; }

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
    /* In-app tab strip (renderTosTabs) — sits under the breadcrumb, e.g. Frontier's Routes / Map. */
    #tablet-os-overlay .tos-tabs { display:flex; gap:4px; margin-bottom:11px; border-bottom:1px solid var(--tos-border); }
    #tablet-os-overlay .tos-tab { font:inherit; font-size:12px; letter-spacing:1px; text-transform:uppercase; cursor:pointer;
      color:var(--tos-fg-dim); background:none; border:0; border-bottom:2px solid transparent; padding:6px 12px; margin-bottom:-1px; }
    #tablet-os-overlay .tos-tab:hover { color:var(--tos-fg); }
    #tablet-os-overlay .tos-tab.active { color:var(--mg-accent); border-bottom-color:var(--mg-accent);
      text-shadow:0 0 6px color-mix(in srgb, var(--mg-accent) 35%, transparent); }

    /* App grid (home) — raised tile: light-accent gradient + bevel edge, lifts
       on hover, presses in on click (pseudo-3D, not a flat grey fill). */
    #tablet-os-overlay .tos-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
    #tablet-os-overlay .tos-tile { position:relative; cursor:pointer; text-align:center; padding:9px 5px; border-radius:7px;
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo));
      border:1px solid color-mix(in srgb, var(--mg-accent) 32%, transparent);
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi), inset 0 -2px 3px var(--tos-bevel-lo), 0 2px 5px rgba(0,0,0,0.22);
      transition:filter .12s, box-shadow .12s, transform .05s; }
    /* Notification badge (e.g. SPECTER reels waiting to be clipped). */
    #tablet-os-overlay .tos-tile .tos-tile-badge { position:absolute; top:-5px; right:-5px; min-width:16px; height:16px; padding:0 4px; border-radius:9px;
      font-size:10px; font-weight:bold; line-height:16px; color:#fff; background:var(--red,#e0413a); box-shadow:0 0 7px color-mix(in srgb, var(--red,#e0413a) 60%, transparent); }
    #tablet-os-overlay .tos-tile:hover { filter:brightness(1.15);
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi), inset 0 -2px 3px var(--tos-bevel-lo), 0 3px 8px rgba(0,0,0,0.28), 0 0 14px color-mix(in srgb, var(--mg-accent) 30%, transparent); }
    #tablet-os-overlay .tos-tile:active { transform:translateY(1px); box-shadow:inset 0 2px 4px var(--tos-bevel-lo); }
    /* Drag-reorder states. The lifted tile leaves a dimmed placeholder that
       reflows through the grid; siblings glide to their new slots. */
    #tablet-os-overlay .tos-tile-ghost { opacity:.32; }
    #tablet-os-overlay .tos-grid-arranging .tos-tile { transition:transform .14s ease; }
    /* The floating clone under the finger — appended to <body>, so this rule is
       global (unscoped). Its surface/colour are copied inline from the real tile. */
    .tos-tile-drag { position:fixed; z-index:9300; pointer-events:none; box-sizing:border-box; text-align:center;
      display:flex; flex-direction:column; align-items:center; justify-content:center; margin:0;
      transform:scale(1.07); opacity:.96; box-shadow:0 8px 22px rgba(0,0,0,.5); }
    .tos-tile-drag .tos-icon { font-size:21px; display:block; margin-bottom:4px; }
    .tos-tile-drag .tos-icon svg { width:22px; height:22px; }
    .tos-tile-drag .tos-name { font-size:11px; letter-spacing:.5px; }
    /* Dragged off the tablet: the clone reddens to signal "release = remove". */
    .tos-tile-drag.tos-tile-removing { transform:scale(.92); opacity:.7;
      border-color:var(--red,#e0413a) !important; box-shadow:0 8px 22px rgba(0,0,0,.5), 0 0 16px color-mix(in srgb, var(--red,#e0413a) 60%, transparent); }
    .tos-tile-drag.tos-tile-removing .tos-name::after { content:' ✕'; color:var(--red,#e0413a); }
    /* The ⊕ "add apps" tile — dashed, dimmed, to read as a slot rather than an app. */
    #tablet-os-overlay .tos-tile-add { background:none; border-style:dashed;
      border-color:color-mix(in srgb, var(--mg-accent) 30%, transparent); box-shadow:none; opacity:.72; }
    #tablet-os-overlay .tos-tile-add:hover { opacity:1; box-shadow:0 0 12px color-mix(in srgb, var(--mg-accent) 22%, transparent); }
    #tablet-os-overlay .tos-tile-add .tos-icon { color:var(--mg-accent); }
    /* ── App groups ────────────────────────────────────────────────────────────
       A coloured box drawn around a sub-grid of tiles, with a small inline label
       as its FIRST ROW — inset within the border, not a tab notched above it, so
       forming a group never costs the box any extra outer space (a group sits in
       the flow exactly like a tile run does; see the JS "grouping is in place"
       comment). The group's colour rides one custom property (--tos-grp) set
       inline per box, so every edge/fill/glow below derives from the single
       swatch the player picked. */
    #tablet-os-overlay .tos-home-apps { position:relative; padding-bottom:34px; }
    /* The home grid packs DENSE so a small tile backfills any hole a wide box
       leaves — which is what stops a group from pushing the rest of the screen
       around instead of just sitting in it.
       It also RESERVES ALL FOUR ROWS whether or not they're full: rows are a fixed
       height and the grid keeps a four-row min-height, so the toolbar and the widget
       cards sit at the same place on every page and with any number of apps. Sized
       rows (not 1fr) are the point — 1fr rows collapse when a page is half empty,
       which slid everything below them up and made the furniture move. */
    #tablet-os-overlay { --tos-tile-h:66px; }
    #tablet-os-overlay .tos-homegrid { grid-auto-flow:row dense;
      grid-auto-rows:var(--tos-tile-h); align-content:start;
      min-height:calc(var(--tos-tile-h) * 4 + 8px * 3); }
    /* A box is a grid ITEM spanning exactly the cells its members occupied. A 2×2
       selection stays a 2×2 square with tiles beside it; a row of four is a row of
       four. The old full-width band is what flattened every shape into a line. */
    /* The wrapper itself draws NOTHING — no border, no fill. It only reserves the
       cells and positions the label. The region's look lives on the member TILES
       (below), which is what lets the outline conform to the apps: a group of five
       in a 2-wide box fills 5 of 6 cells and the sixth is simply a space, instead of
       an empty cell fenced inside a rectangle. A single element is always a
       rectangle; a set of tiles can be an L. */
    #tablet-os-overlay .tos-appgroup { position:relative; padding:0; min-width:0;
      grid-column:span var(--grp-cols, 4); grid-row:span var(--grp-rows, 1);
      display:flex; flex-direction:column; background:none; border:none; box-shadow:none; }
    /* Label: a thin strip INSIDE the box's own footprint, so grouping never asks the
       grid for extra height. The member tiles give up those few pixels, not the page. */
    #tablet-os-overlay .tos-appgroup-tab { flex:0 0 auto; display:flex; align-items:center; gap:5px; cursor:grab;
      padding:1px 3px 3px; font-size:8px; letter-spacing:1.1px; text-transform:uppercase; min-width:0; }
    #tablet-os-overlay .tos-appgroup-tab:active { cursor:grabbing; }
    /* Inner grid: as many columns as the box is wide, filling the rest of the box.
       Members sit flush (gap:0) so the tint reads as ONE region rather than five
       separately-boxed tiles — the exterior-edge classes below draw the outline. */
    #tablet-os-overlay .tos-grp-inner { flex:1; min-height:0;
      grid-template-columns:repeat(var(--grp-cols, 4), minmax(0, 1fr)); gap:0; }
    #tablet-os-overlay .tos-grp-inner .tos-tile { padding:4px 3px; border-radius:0;
      background:color-mix(in srgb, var(--tos-grp, var(--mg-accent)) 11%, var(--tos-surface-lo));
      border:1px solid color-mix(in srgb, var(--tos-grp, var(--mg-accent)) 20%, transparent);
      box-shadow:none; }
    #tablet-os-overlay .tos-grp-inner .tos-tile:hover {
      background:color-mix(in srgb, var(--tos-grp, var(--mg-accent)) 20%, var(--tos-surface-hi)); filter:none; }
    /* Exterior edges — computed per member at render time (renderHomeApps knows each
       one's row/col and whether a neighbour exists), so the outline traces the actual
       occupied cells including the notch left by a short last row. */
    #tablet-os-overlay .tos-grp-inner .ge-t { border-top-color:color-mix(in srgb, var(--tos-grp, var(--mg-accent)) 62%, transparent); }
    #tablet-os-overlay .tos-grp-inner .ge-r { border-right-color:color-mix(in srgb, var(--tos-grp, var(--mg-accent)) 62%, transparent); }
    #tablet-os-overlay .tos-grp-inner .ge-b { border-bottom-color:color-mix(in srgb, var(--tos-grp, var(--mg-accent)) 62%, transparent); }
    #tablet-os-overlay .tos-grp-inner .ge-l { border-left-color:color-mix(in srgb, var(--tos-grp, var(--mg-accent)) 62%, transparent); }
    /* Rounded only where two exterior edges actually meet — the region's real corners. */
    #tablet-os-overlay .tos-grp-inner .ge-t.ge-l { border-top-left-radius:7px; }
    #tablet-os-overlay .tos-grp-inner .ge-t.ge-r { border-top-right-radius:7px; }
    #tablet-os-overlay .tos-grp-inner .ge-b.ge-l { border-bottom-left-radius:7px; }
    #tablet-os-overlay .tos-grp-inner .ge-b.ge-r { border-bottom-right-radius:7px; }
    #tablet-os-overlay .tos-grp-inner .tos-tile .tos-icon { font-size:17px; margin-bottom:2px; }
    #tablet-os-overlay .tos-grp-inner .tos-tile .tos-icon svg { width:18px; height:18px; }
    #tablet-os-overlay .tos-grp-inner .tos-tile .tos-name { font-size:8.5px; letter-spacing:.2px;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block; }
    #tablet-os-overlay .tos-appgroup-swatch { width:6px; height:6px; border-radius:50%; flex:0 0 auto;
      background:var(--tos-grp, var(--mg-accent)); box-shadow:0 0 4px color-mix(in srgb, var(--tos-grp, var(--mg-accent)) 70%, transparent); }
    #tablet-os-overlay .tos-appgroup-nm { flex:1; min-width:0; color:var(--tos-fg-dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    #tablet-os-overlay .tos-appgroup-tab:hover .tos-appgroup-nm { color:var(--tos-fg); }
    #tablet-os-overlay .tos-appgroup-n { color:var(--tos-fg-dim2); }
    /* Lifted for a whole-group drag: the box left behind dims, same grammar as a
       single lifted tile (.tos-tile-ghost). */
    #tablet-os-overlay .tos-appgroup-ghost { opacity:.32; }
    /* DROP INDICATOR. Nothing rearranges while you drag — the grid holds still and the
       target is marked, applied once on release. Live reflow meant every tile you
       dragged past jumped out of the way, so the layout you were aiming at kept
       changing under the pointer.
       A TILE swap outlines the tile it will trade places with; a whole GROUP box still
       inserts (swapping a 2x3 box with one tile has no sensible meaning), so it keeps
       the before/after bar. */
    #tablet-os-overlay .tos-drop-swap { outline:2px dashed var(--mg-accent); outline-offset:-3px;
      box-shadow:0 0 14px color-mix(in srgb, var(--mg-accent) 45%, transparent) !important; }
    #tablet-os-overlay .tos-drop-before, #tablet-os-overlay .tos-drop-after { position:relative; }
    #tablet-os-overlay .tos-drop-before::after, #tablet-os-overlay .tos-drop-after::after {
      content:''; position:absolute; top:-2px; bottom:-2px; width:3px; border-radius:2px; z-index:5;
      background:var(--mg-accent); box-shadow:0 0 8px color-mix(in srgb, var(--mg-accent) 75%, transparent); }
    #tablet-os-overlay .tos-drop-before::after { left:-6px; }
    #tablet-os-overlay .tos-drop-after::after { right:-6px; }
    /* The floating clone under the finger while a whole group is being dragged —
       a compact chip rather than a scaled copy of the box, since dragging a full
       grid of tiles under the pointer would be both heavy and illegible. Same
       fixed/unscoped placement as .tos-tile-drag. */
    .tos-group-drag { position:fixed; z-index:9300; pointer-events:none; display:flex; align-items:center; gap:6px;
      padding:6px 12px; border-radius:7px; font-size:10.5px; letter-spacing:.6px; text-transform:uppercase;
      color:var(--tos-fg, #eee); background:color-mix(in srgb, var(--tos-grp, var(--mg-accent)) 22%, #14181b);
      border:1px solid var(--tos-grp, var(--mg-accent)); box-shadow:0 8px 22px rgba(0,0,0,.5); }
    .tos-group-drag .tos-appgroup-swatch { background:var(--tos-grp, var(--mg-accent)); }
    .tos-group-drag.tos-tile-removing { opacity:.7; border-color:var(--red,#e0413a) !important;
      box-shadow:0 8px 22px rgba(0,0,0,.5), 0 0 16px color-mix(in srgb, var(--red,#e0413a) 60%, transparent); }
    .tos-group-drag.tos-tile-removing::after { content:'✕'; color:var(--red,#e0413a); }
    /* Marquee band — drag on empty home-screen space to lasso tiles. Global (it's
       appended to <body> so its fixed coords are plain viewport pixels). */
    .tos-marquee { position:fixed; z-index:9290; pointer-events:none; border-radius:3px;
      border:1px dashed var(--mg-accent, #3fd0d8); background:color-mix(in srgb, var(--mg-accent, #3fd0d8) 14%, transparent); }
    #tablet-os-overlay .tos-tile-sel { border-color:var(--mg-accent) !important;
      box-shadow:0 0 0 2px color-mix(in srgb, var(--mg-accent) 55%, transparent),
                 0 0 14px color-mix(in srgb, var(--mg-accent) 40%, transparent) !important; }
    /* ── Animated wallpaper ────────────────────────────────────────────────────
       The live sky behind the Home grid. Sits under .tos-scroll (z-index 2) and
       over nothing, so every screen's own content still paints on top; the CRT
       overlays and void-mode haze layer above it unchanged. */
    /* Strength comes from --wall-strength (set by startWallpaper) and only applies
       while the .on class is present — that pairing is what makes turning it OFF
       work. An inline opacity here would outrank the class and strand the canvas
       visible over every app screen, which is exactly the bug this replaced. */
    #tablet-os-overlay .tos-wall { position:absolute; inset:0; z-index:1; pointer-events:none;
      opacity:0; transition:opacity .5s ease; }
    #tablet-os-overlay .tos-wall.on { opacity:var(--wall-strength, .4); }
    /* Home content gets a soft scrim so the wallpaper can't eat the text under it. */
    #tablet-os-overlay .tos-body .tos-summary, #tablet-os-overlay .tos-widgets { position:relative; }

    /* ── Home widgets ──────────────────────────────────────────────────────────
       Cards under the app grid, one per app that opted in (buildWidget). Same
       raised-surface idiom as a tile, wider and quieter — these are read, not
       pressed, even though tapping one opens its app. */
    #tablet-os-overlay .tos-widgets { display:grid; grid-template-columns:repeat(2,1fr); gap:8px; margin-top:14px; }
    #tablet-os-overlay .tos-widget { cursor:pointer; padding:9px 10px 10px; border-radius:8px; min-width:0;
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo));
      border:1px solid color-mix(in srgb, var(--mg-accent) 26%, transparent);
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi), 0 2px 5px rgba(0,0,0,.22);
      transition:filter .12s, box-shadow .12s; }
    #tablet-os-overlay .tos-widget:hover { filter:brightness(1.1);
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi), 0 3px 9px rgba(0,0,0,.3); }
    #tablet-os-overlay .tos-wg-title { font-size:8.5px; letter-spacing:1.6px; text-transform:uppercase;
      color:var(--tos-fg-dim2); margin-bottom:7px; }
    /* meters */
    #tablet-os-overlay .tos-wg-meter { display:grid; grid-template-columns:1fr auto; gap:2px 6px; margin-bottom:6px; }
    #tablet-os-overlay .tos-wg-mlabel { font-size:9.5px; letter-spacing:.4px; color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-wg-mnote { grid-column:2; grid-row:1; font-size:8.5px; color:var(--tos-fg-dim2);
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:96px; text-align:right; }
    #tablet-os-overlay .tos-wg-mbar { grid-column:1 / -1; height:4px; border-radius:2px; overflow:hidden;
      background:rgba(0,0,0,.45); box-shadow:inset 0 1px 2px rgba(0,0,0,.6); }
    #tablet-os-overlay .tos-wg-mfill { display:block; height:100%; border-radius:2px; background:var(--mg-accent); transition:width .3s ease; }
    #tablet-os-overlay .tos-wg-mfill.band-warn { background:var(--yellow, #d8c23f); }
    #tablet-os-overlay .tos-wg-mfill.band-bad  { background:var(--orange, #e08a3a); }
    #tablet-os-overlay .tos-wg-mfill.band-crit { background:var(--red, #e0413a); }
    /* Glyph-led lines: a big mark carries the meaning, the words confirm it. */
    #tablet-os-overlay .tos-wg-glyphed { display:flex; align-items:center; gap:9px; min-width:0; }
    #tablet-os-overlay .tos-wg-glyph { flex:0 0 auto; font-size:24px; line-height:1; opacity:.9;
      filter:drop-shadow(0 0 6px color-mix(in srgb, var(--mg-accent) 45%, transparent)); }
    #tablet-os-overlay .tos-wg-lstack { flex:1; min-width:0; }
    #tablet-os-overlay .tos-wg-line.lead { font-size:12.5px; color:var(--tos-fg); }
    #tablet-os-overlay .tos-wg-line.lead + .tos-wg-line { font-size:9.5px; color:var(--tos-fg-dim); }
    /* bar: a stacked proportion + a keyed legend. */
    #tablet-os-overlay .tos-wg-track { display:flex; height:9px; border-radius:5px; overflow:hidden; gap:1px;
      background:rgba(0,0,0,.45); box-shadow:inset 0 1px 2px rgba(0,0,0,.6); }
    #tablet-os-overlay .tos-wg-seg { display:block; min-width:2px; transition:flex .4s ease; }
    #tablet-os-overlay .tos-wg-seg.tone-good { background:var(--mg-accent); }
    #tablet-os-overlay .tos-wg-seg.tone-warn { background:var(--yellow, #d8c23f); }
    #tablet-os-overlay .tos-wg-seg.tone-bad  { background:var(--red, #e0413a); }
    #tablet-os-overlay .tos-wg-legend { display:flex; flex-wrap:wrap; gap:3px 10px; margin-top:7px; }
    #tablet-os-overlay .tos-wg-key { display:inline-flex; align-items:center; gap:4px; font-size:9px;
      letter-spacing:.3px; color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-wg-swatch { width:7px; height:7px; border-radius:2px; flex:0 0 auto; }
    #tablet-os-overlay .tos-wg-swatch.tone-good { background:var(--mg-accent); }
    #tablet-os-overlay .tos-wg-swatch.tone-warn { background:var(--yellow, #d8c23f); }
    #tablet-os-overlay .tos-wg-swatch.tone-bad  { background:var(--red, #e0413a); }
    /* stat */
    #tablet-os-overlay .tos-wg-stat { display:flex; align-items:baseline; gap:7px; min-width:0; }
    #tablet-os-overlay .tos-wg-icon { font-size:22px; line-height:1;
      filter:drop-shadow(0 0 6px color-mix(in srgb, var(--mg-accent) 40%, transparent)); }
    #tablet-os-overlay .tos-wg-big { font-size:19px; font-weight:bold; color:var(--tos-fg); letter-spacing:.5px; }
    #tablet-os-overlay .tos-wg-sub { flex:1; min-width:0; font-size:9.5px; color:var(--tos-fg-dim);
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-transform:capitalize; }
    #tablet-os-overlay .tos-wg-stat.tone-warn .tos-wg-big { color:var(--yellow, #d8c23f); }
    #tablet-os-overlay .tos-wg-stat.tone-bad .tos-wg-big { color:var(--red, #e0413a); }
    #tablet-os-overlay .tos-wg-note { margin-top:6px; font-size:8.5px; letter-spacing:.3px; color:var(--tos-fg-dim2);
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    /* lines */
    #tablet-os-overlay .tos-wg-line { display:flex; gap:6px; justify-content:space-between; font-size:10px;
      color:var(--tos-fg); margin-bottom:4px; min-width:0; }
    #tablet-os-overlay .tos-wg-line > span:first-child { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    #tablet-os-overlay .tos-wg-lsub { color:var(--tos-fg-dim2); white-space:nowrap; }

    /* ── Home toolbar ──────────────────────────────────────────────────────────
       One short strip under the grid holding the tools that used to be tiles, so
       they stop eating app slots. It shares the space below the grid with the
       widget cards, hence the compact height: icon over a 7px label, four of them
       on one line at any tablet width. */
    #tablet-os-overlay .tos-hbar { display:flex; align-items:center; gap:6px; margin-top:12px; }
    #tablet-os-overlay .tos-hbar-btn { flex:1 1 0; min-width:0; display:flex; flex-direction:column;
      align-items:center; gap:2px; cursor:pointer; padding:5px 4px 4px; border-radius:6px; font:inherit;
      color:var(--tos-fg-dim); background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo));
      border:1px solid color-mix(in srgb, var(--mg-accent) 22%, transparent);
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi); transition:filter .12s, color .12s; }
    #tablet-os-overlay .tos-hbar-btn:hover { filter:brightness(1.16); color:var(--tos-fg); }
    #tablet-os-overlay .tos-hbar-btn:active { transform:translateY(1px); }
    /* A toggle that's ON wears the accent, so the strip doubles as a status line. */
    #tablet-os-overlay .tos-hbar-btn.on { color:var(--mg-accent);
      border-color:color-mix(in srgb, var(--mg-accent) 55%, transparent);
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi), 0 0 10px color-mix(in srgb, var(--mg-accent) 20%, transparent); }
    #tablet-os-overlay .tos-hbar-ic { font-size:14px; line-height:1; }
    #tablet-os-overlay .tos-hbar-ic.srch { color:var(--mg-accent); padding:0 2px 0 4px; }
    #tablet-os-overlay .tos-hbar-lb { font-size:7.5px; letter-spacing:.8px; text-transform:uppercase;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
    /* Find field — takes the whole strip while it's open; Done gives the row back. */
    #tablet-os-overlay .tos-hbar-input { flex:1 1 auto; min-width:0; padding:5px 8px; font:inherit; font-size:12px;
      color:var(--tos-fg); background:var(--bg, #0c1114); border-radius:6px;
      border:1px solid color-mix(in srgb, var(--mg-accent) 34%, transparent); }
    #tablet-os-overlay .tos-hbar.searching .tos-hbar-btn { flex:0 0 auto; min-width:52px; }
    /* A stashed app turning up in a search result: dimmed, dashed, tap to restore. */
    #tablet-os-overlay .tos-tile-stashed { opacity:.5; border-style:dashed; box-shadow:none; }
    #tablet-os-overlay .tos-tile-stashed:hover { opacity:.85; }

    /* ── Mobile / short-viewport safety ────────────────────────────────────────
       The tablet is the half of the game you cannot reach by typing, so it has to
       work on a phone. Two independent triggers, because they are different
       problems: data-density="compact" is the client's own mobile layout (set by
       main.js and used by the rest of this sheet), while the max-height query
       catches a laptop in a short window, where a fixed 820px chassis would push
       the toolbar off the bottom.

       Everything here only SHRINKS — same four columns, same shapes, same code
       paths. A phone must not get a different grid geometry, or a group's saved
       cols (a 2×2 stays 2×2) would mean something different on each device. */
    html[data-density="compact"] #tablet-os-overlay .tos-panel {
      width:min(760px,100vw); height:100dvh; max-height:100dvh; border-width:1px; border-radius:0; }
    html[data-density="compact"] #tablet-os-overlay .tos-anchor { left:0; top:0; transform:none; width:100vw; }
    /* Tighter tiles: the icon carries the recognition, the label just confirms it.
       The row height shrinks with them so the reserved four-row block still fits. */
    html[data-density="compact"] #tablet-os-overlay { --tos-tile-h:56px; }
    html[data-density="compact"] #tablet-os-overlay .tos-homegrid { min-height:calc(var(--tos-tile-h) * 4 + 6px * 3); }
    html[data-density="compact"] #tablet-os-overlay .tos-grid { gap:6px; }
    html[data-density="compact"] #tablet-os-overlay .tos-tile { padding:7px 3px; }
    html[data-density="compact"] #tablet-os-overlay .tos-tile .tos-icon { font-size:18px; margin-bottom:3px; }
    html[data-density="compact"] #tablet-os-overlay .tos-tile .tos-icon svg { width:19px; height:19px; }
    html[data-density="compact"] #tablet-os-overlay .tos-tile .tos-name { font-size:9px; letter-spacing:.2px;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block; }
    html[data-density="compact"] #tablet-os-overlay .tos-grp-inner { gap:3px; }
    html[data-density="compact"] #tablet-os-overlay .tos-grp-inner .tos-tile { padding:3px 2px; }
    html[data-density="compact"] #tablet-os-overlay .tos-grp-inner .tos-tile .tos-icon { font-size:15px; }
    html[data-density="compact"] #tablet-os-overlay .tos-grp-inner .tos-tile .tos-icon svg { width:16px; height:16px; }
    html[data-density="compact"] #tablet-os-overlay .tos-grp-inner .tos-tile .tos-name { font-size:7.5px; }
    /* Toolbar keeps its labels (they are what make the icons legible to a newcomer)
       but gives up padding; the widget cards go single-file so nothing is squeezed
       to an unreadable width. */
    html[data-density="compact"] #tablet-os-overlay .tos-hbar-btn { padding:4px 2px 3px; }
    html[data-density="compact"] #tablet-os-overlay .tos-hbar-lb { font-size:7px; letter-spacing:.4px; }
    html[data-density="compact"] #tablet-os-overlay .tos-widgets { grid-template-columns:1fr; gap:6px; }
    /* Touch targets: the page dots are 6px of paint, so they keep their generous
       invisible padding and gain a little more room to be thumbed. */
    html[data-density="compact"] #tablet-os-overlay .tos-page-dot { padding:8px; }
    html[data-density="compact"] #tablet-os-overlay .tos-page-arrow { padding:4px 10px; font-size:17px; }
    /* No cards: SPEND the widget space on the tiles instead of shrinking the chassis.
       Shrinking was the first answer and it was the wrong one — the panel got shorter
       but the grid still sat in the top two-thirds with a band of nothing under it, so
       the device read as half-empty either way. The apps are the reason the home screen
       exists; with nothing else competing for the room they get to be a proper
       thumb-sized target. The grid is four fixed rows, so this is the one place bigger
       tiles cost nothing. */
    /* The knob is --tos-tile-h, NOT padding. The home grid runs on fixed-height rows
       (grid-auto-rows, see the --tos-tile-h block above) so the furniture below it can't
       move when a page is half empty — which means growing a tile's PADDING just pushes
       its label out of a 66px row, where the next row clips it. Raise the row and the
       tile fills it. 116px ≈ the leftover once the header, summary, pager and toolbar
       have taken theirs, so four rows genuinely use the screen instead of leaving a
       band of nothing under the toolbar. min-height follows automatically: it's a calc
       on this same variable. */
    #tablet-os-overlay.tos-no-widgets { --tos-tile-h:116px; }
    /* Centre the icon+label in the taller row rather than letting them sit at the top
       with the growth all below them. */
    #tablet-os-overlay.tos-no-widgets .tos-tile { display:flex; flex-direction:column;
      align-items:center; justify-content:center; padding:8px 6px; border-radius:9px; }
    #tablet-os-overlay.tos-no-widgets .tos-tile .tos-icon { font-size:30px; margin-bottom:9px; }
    #tablet-os-overlay.tos-no-widgets .tos-tile .tos-icon svg { width:31px; height:31px; }
    #tablet-os-overlay.tos-no-widgets .tos-tile .tos-name { font-size:11.5px; letter-spacing:.6px; }
    #tablet-os-overlay.tos-no-widgets .tos-grid { gap:10px; }
    /* Groups keep their proportions inside the bigger grid rather than inheriting the
       full tile size (a group is a sub-grid — its tiles are meant to read as smaller). */
    #tablet-os-overlay.tos-no-widgets .tos-grp-inner .tos-tile { padding:7px 4px; }
    #tablet-os-overlay.tos-no-widgets .tos-grp-inner .tos-tile .tos-icon { font-size:20px; margin-bottom:3px; }
    #tablet-os-overlay.tos-no-widgets .tos-grp-inner .tos-tile .tos-icon svg { width:21px; height:21px; }
    #tablet-os-overlay.tos-no-widgets .tos-grp-inner .tos-tile .tos-name { font-size:9.5px; }
    /* A short window (not a phone) — just don't let the chassis exceed the viewport. */
    @media (max-height:860px) {
      #tablet-os-overlay .tos-panel { height:94vh; }
    }
    /* Shorter windows get shorter rows, in steps, so four rows always fit without the
       home screen scrolling — the whole promise of a fixed-shape grid. Only the row
       height moves; the tile keeps its centred layout at every size, so a label can
       never end up clipped the way it did when this scaled padding instead. */
    @media (max-height:760px) {
      #tablet-os-overlay.tos-no-widgets { --tos-tile-h:96px; }
      #tablet-os-overlay.tos-no-widgets .tos-tile .tos-icon { font-size:26px; margin-bottom:7px; }
      #tablet-os-overlay.tos-no-widgets .tos-tile .tos-icon svg { width:27px; height:27px; }
    }
    @media (max-height:660px) {
      #tablet-os-overlay.tos-no-widgets { --tos-tile-h:78px; }
      #tablet-os-overlay.tos-no-widgets .tos-tile .tos-icon { font-size:22px; margin-bottom:5px; }
      #tablet-os-overlay.tos-no-widgets .tos-tile .tos-icon svg { width:23px; height:23px; }
      #tablet-os-overlay.tos-no-widgets .tos-tile .tos-name { font-size:10px; }
    }
    @media (max-height:620px) {
      #tablet-os-overlay .tos-tile { padding:6px 3px; }
      #tablet-os-overlay .tos-tile .tos-icon { font-size:18px; margin-bottom:2px; }
      #tablet-os-overlay .tos-tile .tos-name { font-size:9.5px; }
    }

    /* Page dots — only rendered past one page, so a small home screen looks exactly
       as it did before paging existed. Dots are drop targets as well as buttons
       (drag a tile onto one to send the app to that page), hence the generous hit
       padding on something that draws as a 6px dot. */
    #tablet-os-overlay .tos-home-pager { display:flex; align-items:center; justify-content:center; gap:4px; margin-top:12px; }
    #tablet-os-overlay .tos-page-dot { width:6px; height:6px; border-radius:50%; cursor:pointer;
      box-sizing:content-box; padding:6px; background-clip:content-box;
      background-color:color-mix(in srgb, var(--tos-fg) 28%, transparent); transition:background-color .15s, transform .1s; }
    #tablet-os-overlay .tos-page-dot:hover { background-color:color-mix(in srgb, var(--mg-accent) 60%, transparent); transform:scale(1.2); }
    #tablet-os-overlay .tos-page-dot.on { background-color:var(--mg-accent);
      box-shadow:0 0 8px color-mix(in srgb, var(--mg-accent) 55%, transparent); }
    #tablet-os-overlay .tos-page-arrow { cursor:pointer; padding:2px 7px; font-size:15px; line-height:1;
      color:var(--tos-fg-dim); user-select:none; }
    #tablet-os-overlay .tos-page-arrow:hover { color:var(--mg-accent); }
    #tablet-os-overlay .tos-page-arrow.off { opacity:.25; pointer-events:none; }
    /* Mid-drag, the dots read as the targets they are. */
    #tablet-os-overlay .tos-grid-arranging .tos-page-dot { background-color:color-mix(in srgb, var(--mg-accent) 45%, transparent);
      outline:1px dashed color-mix(in srgb, var(--mg-accent) 45%, transparent); outline-offset:-2px; }

    /* Selection mode (armed by the ⧉ tile): tiles pick instead of open, and a bar
       along the bottom of the grid holds the count and the commit. */
    #tablet-os-overlay .tos-selecting { user-select:none; }
    #tablet-os-overlay .tos-selecting .tos-tile { cursor:copy; }
    #tablet-os-overlay .tos-selecting .tos-tile:active { transform:none; }
    #tablet-os-overlay .tos-selbar { position:sticky; bottom:0; z-index:5; display:flex; align-items:center; gap:8px;
      margin-top:12px; padding:8px 10px; border-radius:8px;
      border:1px solid color-mix(in srgb, var(--mg-accent) 34%, transparent);
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo));
      box-shadow:0 -4px 16px rgba(0,0,0,.35), inset 0 1px 0 var(--tos-bevel-hi); }
    #tablet-os-overlay .tos-selbar-n { flex:1; font-size:10.5px; letter-spacing:1px; text-transform:uppercase; color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-selbar-n b { color:var(--mg-accent); font-size:12.5px; }
    /* Group sheet (name + colour), reusing the add-apps card chrome below. */
    #tablet-os-overlay .tos-grp-input { width:100%; box-sizing:border-box; padding:7px 9px; margin-bottom:12px;
      font:inherit; font-size:12.5px; color:var(--tos-fg); background:var(--bg, #0c1114);
      border:1px solid color-mix(in srgb, var(--mg-accent) 32%, transparent); border-radius:6px; }
    #tablet-os-overlay .tos-grp-swatches { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; }
    #tablet-os-overlay .tos-grp-sw { width:24px; height:24px; border-radius:50%; cursor:pointer;
      border:2px solid transparent; box-shadow:0 1px 4px rgba(0,0,0,.45); transition:transform .1s; }
    #tablet-os-overlay .tos-grp-sw.on { border-color:var(--tos-fg); transform:scale(1.14); }
    #tablet-os-overlay .tos-grp-btns { display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; }
    #tablet-os-overlay .tos-grp-btn { cursor:pointer; padding:6px 13px; border-radius:6px; font-size:11px;
      letter-spacing:.7px; text-transform:uppercase; color:var(--tos-fg);
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo));
      border:1px solid color-mix(in srgb, var(--mg-accent) 32%, transparent);
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi); }
    #tablet-os-overlay .tos-grp-btn:hover { filter:brightness(1.15); }
    #tablet-os-overlay .tos-grp-btn.danger { color:var(--red, #e0413a);
      border-color:color-mix(in srgb, var(--red, #e0413a) 45%, transparent); }
    /* Add-apps sheet: a scrim + card over the home screen, listing removed apps. */
    #tablet-os-overlay .tos-addsheet { position:absolute; inset:0; z-index:40; display:flex; align-items:center; justify-content:center;
      padding:9px; background:color-mix(in srgb, var(--bg,#030806) 72%, transparent); backdrop-filter:blur(2px); }
    #tablet-os-overlay .tos-addsheet-card { width:100%; max-width:340px; max-height:94%; overflow:auto; padding:14px;
      border-radius:10px; border:1px solid color-mix(in srgb, var(--mg-accent) 32%, transparent);
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo)); box-shadow:0 12px 34px rgba(0,0,0,.55); }
    /* The stash listing takes the whole screen: with the default sixteen out, there
       are ~20 apps in here, and at the home grid's 4 columns that is five rows of
       full-size tiles — guaranteed to scroll. So this card is as wide as the tablet
       and its tiles are denser, which fits the whole stash in view. The group-naming
       sheet keeps the narrow default; only this one opts in. */
    #tablet-os-overlay .tos-addsheet-card.wide { max-width:100%; padding:11px; }
    #tablet-os-overlay .tos-addsheet-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(62px,1fr)); gap:6px; }
    #tablet-os-overlay .tos-addsheet-grid .tos-tile { padding:6px 3px; border-radius:6px; }
    #tablet-os-overlay .tos-addsheet-grid .tos-tile .tos-icon { font-size:17px; margin-bottom:3px; }
    #tablet-os-overlay .tos-addsheet-grid .tos-tile .tos-icon svg { width:18px; height:18px; }
    #tablet-os-overlay .tos-addsheet-grid .tos-tile .tos-name { font-size:9px; letter-spacing:.2px;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block; }
    #tablet-os-overlay .tos-addsheet-hdr { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;
      font-size:12px; letter-spacing:1px; text-transform:uppercase; color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-addsheet-x { cursor:pointer; color:var(--mg-accent); font-size:14px; padding:0 4px; }
    #tablet-os-overlay .tos-addsheet-x:hover { filter:brightness(1.2); }
    #tablet-os-overlay .tos-tile .tos-icon { font-size:21px; display:block; margin-bottom:4px; color:var(--tos-fg); }
    #tablet-os-overlay .tos-tile .tos-icon svg { width:22px; height:22px; display:inline-block; vertical-align:middle; }
    /* Two-tone: primary uses currentColor (theme fg); the .dim parts pick up a muted derived tone. */
    #tablet-os-overlay .tos-tile .tos-icon svg .dim { color:var(--tos-fg-dim2); }
    #tablet-os-overlay .tos-tile .tos-name { font-size:11px; letter-spacing:.5px; color:var(--tos-fg); }
    /* Journey glow — the Frontier tile pulses in the accent while you're out on a
       void crossing (renderHomeApps adds .tos-tile-glow). currentColor drives the SVG. */
    #tablet-os-overlay .tos-tile-glow .tos-icon { color:var(--mg-accent);
      filter:drop-shadow(0 0 5px color-mix(in srgb, var(--mg-accent) 70%, transparent)); animation:tos-tile-glow-pulse 1.8s ease-in-out infinite; }
    #tablet-os-overlay .tos-tile-glow .tos-name { color:var(--mg-accent); }
    @keyframes tos-tile-glow-pulse { 0%,100%{opacity:1} 50%{opacity:.55} }
    [data-motion="off"] #tablet-os-overlay .tos-tile-glow .tos-icon { animation:none; }
    /* Arcade tile icon: the circled-"A" ARCHITECT logo — the same mark as the
       tablet's boot screen (.tos-boot-logo), sized to the tile icon slot. */
    #tablet-os-overlay .tos-tile .tos-icon .tos-ic-a { width:22px; height:22px; border-radius:50%; box-sizing:border-box;
      display:inline-flex; align-items:center; justify-content:center; font-size:13px; font-weight:bold; line-height:1;
      color:var(--mg-accent); border:2px solid var(--mg-accent);
      text-shadow:0 0 10px color-mix(in srgb, var(--mg-accent) 70%, transparent);
      box-shadow:0 0 12px color-mix(in srgb, var(--mg-accent) 40%, transparent), inset 0 0 7px color-mix(in srgb, var(--mg-accent) 22%, transparent); }

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
    /* Calendar app — month grid (view: 'calendar'). Monochrome like the rest of the tablet. */
    #tablet-os-overlay .tos-cal { margin-bottom:12px; }
    #tablet-os-overlay .tos-cal-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
    #tablet-os-overlay .tos-cal-title { color:var(--tos-fg); font-size:13.5px; letter-spacing:1px; text-transform:uppercase; }
    #tablet-os-overlay .tos-cal-nav { cursor:pointer; user-select:none; color:var(--tos-fg-dim); padding:1px 10px; border-radius:5px; font-size:15px; line-height:1.3;
      border:1px solid color-mix(in srgb, var(--mg-accent) 26%, transparent); background:var(--tos-surface); }
    #tablet-os-overlay .tos-cal-nav:hover { color:var(--mg-accent); filter:brightness(1.12); }
    #tablet-os-overlay .tos-cal-nav:active { transform:translateY(1px); }
    #tablet-os-overlay .tos-cal-grid { display:grid; grid-template-columns:repeat(7, 1fr); gap:3px; }
    #tablet-os-overlay .tos-cal-dow { text-align:center; font-size:10px; letter-spacing:.5px; text-transform:uppercase; color:var(--tos-fg-dim2); padding-bottom:2px; }
    #tablet-os-overlay .tos-cal-cell { position:relative; aspect-ratio:1/1; display:flex; align-items:flex-start; justify-content:center; padding-top:4px;
      border-radius:5px; font-size:12px; color:var(--tos-fg-dim);
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo)); border:1px solid var(--tos-border); }
    #tablet-os-overlay .tos-cal-cell.tos-cal-pad { background:none; border:none; }
    #tablet-os-overlay .tos-cal-cell.tos-cal-has { cursor:default; color:var(--tos-fg); border-color:color-mix(in srgb, var(--mg-accent) 34%, transparent); }
    #tablet-os-overlay .tos-cal-cell.tos-cal-today { color:var(--tos-fg); border-color:var(--mg-accent);
      box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--mg-accent) 55%, transparent); }
    #tablet-os-overlay .tos-cal-num { line-height:1; }
    /* Event text in the cell. The day number stays top-centre; this sits under it,
       centred, clipped to the cell. Two lines max — a month cell is barely two words
       wide, so shortEventText() does the heavy lifting server-side of the ellipsis. */
    #tablet-os-overlay .tos-cal-ev { position:absolute; left:2px; right:2px; top:52%;
      font-size:7.5px; line-height:1.15; letter-spacing:.1px; text-align:center; color:var(--tos-fg-dim);
      display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
    #tablet-os-overlay .tos-cal-has .tos-cal-ev { color:var(--tos-fg); }
    #tablet-os-overlay .tos-cal-more { color:var(--mg-accent); margin-left:2px; font-weight:bold; }
    /* Dots move to the TOP-RIGHT corner so the text below has the cell to itself, and
       they are twice the size with a glow — a 4px dot on a dark cell was invisible at
       a glance, which is the one thing a calendar marker has to be. */
    #tablet-os-overlay .tos-cal-dots { position:absolute; top:3px; right:3px; left:auto; display:flex; gap:2px; justify-content:flex-end; }
    #tablet-os-overlay .tos-cal-dot { width:7px; height:7px; border-radius:50%; background:var(--mg-accent);
      box-shadow:0 0 6px color-mix(in srgb, var(--mg-accent) 85%, transparent), 0 0 0 1px rgba(0,0,0,.45); }
    #tablet-os-overlay .tos-cal-dot-rent { background:var(--yellow, #d8c23f);
      box-shadow:0 0 6px color-mix(in srgb, var(--yellow, #d8c23f) 85%, transparent), 0 0 0 1px rgba(0,0,0,.45); }
    /* A day with something on it earns a tinted cell, not just a marker. */
    #tablet-os-overlay .tos-cal-cell.tos-cal-has { background:color-mix(in srgb, var(--mg-accent) 9%, var(--tos-surface-lo)); }
    /* Per-quest action log (client-only), foot of a quest's detail screen. */
    #tablet-os-overlay .tos-qlog { margin-top:14px; padding-top:10px; border-top:1px solid var(--tos-border); }
    #tablet-os-overlay .tos-qlog-hdr { font-size:11px; letter-spacing:1px; text-transform:uppercase; color:var(--tos-fg-dim2); margin-bottom:6px; }
    #tablet-os-overlay .tos-qlog-beat { font-size:12.5px; font-weight:700; color:var(--mg-accent); padding:5px 0 3px; }
    #tablet-os-overlay .tos-qlog-done { color:var(--tos-fg); }
    #tablet-os-overlay .tos-qlog-line { font-size:12px; padding:2px 0 2px 10px; color:var(--tos-fg-dim); line-height:1.45; }

    /* Detail view */
    #tablet-os-overlay .tos-detail-name { font-size:18px; color:var(--tos-fg); margin-bottom:4px; }
    #tablet-os-overlay .tos-detail-desc { font-size:12.5px; color:var(--tos-fg-dim); margin-bottom:11px; line-height:1.5; }
    /* Long-form reading. Wider leading and a capped measure — a chapter set at the
       panel's full width is a wall, and nobody finishes a wall. */
    #tablet-os-overlay .tos-detail-body { font-size:13.5px; line-height:1.72; color:var(--tos-fg); max-width:62ch; margin-bottom:12px; }
    #tablet-os-overlay .tos-detail-body p { margin:0 0 0.95em; }

    /* ── The book (library chapters) ────────────────────────────────────────────
       These are pre-collapse artifacts, and they should read like one: aged paper,
       a serif face, an illuminated initial, and the shadow of a spine down the left
       edge. All of it derives from the theme — the paper is the theme's own surface
       warmed toward parchment, so a green terminal gets a green-tinged vellum rather
       than a beige rectangle nobody asked for. */
    #tablet-os-overlay .tos-book { position:relative; max-width:60ch; padding:20px 22px 18px 30px;
      border-radius:3px 8px 8px 3px; font-size:14px; line-height:1.78; letter-spacing:.1px;
      font-family:Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', serif;
      color:color-mix(in srgb, var(--tos-fg) 92%, #d9c39a);
      background:
        /* the faintest foxing, so the page isn't a flat fill */
        radial-gradient(120% 80% at 12% 8%, color-mix(in srgb, #d9c39a 9%, transparent), transparent 60%),
        radial-gradient(90% 70% at 88% 92%, color-mix(in srgb, #a8875a 8%, transparent), transparent 55%),
        linear-gradient(100deg, color-mix(in srgb, var(--tos-surface-hi) 82%, #c9ab7d),
                                color-mix(in srgb, var(--tos-surface-lo) 88%, #b9975f));
      border:1px solid color-mix(in srgb, #6b5433 40%, var(--tos-border));
      box-shadow:inset 22px 0 26px -22px rgba(0,0,0,.55),   /* the gutter, page curving into the spine */
                 inset 0 0 40px color-mix(in srgb, #4a3a22 16%, transparent),
                 0 3px 12px rgba(0,0,0,.35); }
    /* The spine itself: a dark band down the binding edge. */
    #tablet-os-overlay .tos-book::before { content:''; position:absolute; left:0; top:0; bottom:0; width:7px;
      border-radius:3px 0 0 3px; pointer-events:none;
      background:linear-gradient(90deg, color-mix(in srgb, #4a3a22 55%, transparent), transparent); }
    /* ILLUMINATED INITIAL, via ::first-letter — no markup, no extra element. That
       matters: the narration splits this text into character-aligned sentence spans
       and the glossary matches word runs, so inserting a <span> for the capital would
       shift both. ::first-letter styles the glyph where it already is. */
    #tablet-os-overlay .tos-book p:first-of-type::first-letter {
      float:left; font-size:3.5em; line-height:.82; margin:2px 8px 0 0; padding:4px 8px 2px;
      font-family:'Trajan Pro', Georgia, serif; font-weight:bold;
      color:color-mix(in srgb, var(--mg-accent) 70%, #7a5c2a);
      background:linear-gradient(160deg, color-mix(in srgb, var(--mg-accent) 15%, transparent), transparent);
      border:1px solid color-mix(in srgb, var(--mg-accent) 34%, transparent);
      text-shadow:0 1px 0 rgba(255,255,255,.14); }
    /* Book paragraphs indent and close up, the way a set page does — the blank line
       between paragraphs is a screen convention, not a book one. The first one after
       an illuminated capital is never indented. */
    #tablet-os-overlay .tos-book p { margin:0 0 .35em; text-indent:1.6em; }
    #tablet-os-overlay .tos-book p:first-of-type { text-indent:0; }
    /* Narration highlight and glossed words have to survive the serif setting. */
    #tablet-os-overlay .tos-book .tos-gloss { border-bottom-color:color-mix(in srgb, var(--mg-accent) 55%, transparent); }
    /* The title above a chapter reads as a title page, not a UI label. */
    #tablet-os-overlay .tos-book-title { font-family:Georgia, 'Palatino Linotype', serif;
      font-size:16px; letter-spacing:2px; text-transform:none; }
    /* ── The shelf, a cover, a table of contents ────────────────────────────────
       Every colour here is derived: --bk-hue comes from a hash of the book's id
       (see bookHue), and the cloth mixes that hue into the THEME's own surface, so
       a green-terminal tablet gets eight distinguishable bindings rather than eight
       stock jacket colours fighting the palette. */
    #tablet-os-overlay .tos-lib-shelf { display:grid; grid-template-columns:repeat(auto-fill, minmax(190px, 1fr)); gap:10px; }
    /* The board the row stands on — a lit edge and a shadow under it, nothing more. */
    #tablet-os-overlay .tos-lib-board { height:9px; margin:2px 0 12px; border-radius:2px;
      background:linear-gradient(180deg, color-mix(in srgb, var(--tos-border) 80%, transparent), transparent);
      box-shadow:0 6px 14px -6px rgba(0,0,0,.6); }
    #tablet-os-overlay .tos-lib-card { display:flex; gap:11px; align-items:center; cursor:pointer;
      padding:9px 11px 9px 9px; border-radius:4px; border:1px solid var(--tos-border);
      background:linear-gradient(180deg, var(--tos-surface-hi), var(--tos-surface-lo));
      transition:transform .14s ease, border-color .14s ease, box-shadow .14s ease; }
    /* A book you pull out tilts up off the shelf. */
    #tablet-os-overlay .tos-lib-card:hover { transform:translateY(-2px);
      border-color:color-mix(in srgb, var(--mg-accent) 45%, var(--tos-border));
      box-shadow:0 6px 16px -8px rgba(0,0,0,.7); }
    #tablet-os-overlay .tos-lib-card-txt { min-width:0; flex:1; }
    #tablet-os-overlay .tos-lib-card-title { font-family:Georgia,'Palatino Linotype',serif; font-size:13.5px;
      color:var(--tos-fg); line-height:1.25; }
    #tablet-os-overlay .tos-lib-card-by { font-size:11px; color:var(--tos-fg-dim); margin-top:2px; font-style:italic; }
    #tablet-os-overlay .tos-lib-card-meta { font-size:10.5px; color:var(--tos-fg-dim); margin-top:3px; opacity:.8; }

    /* The plate. Cloth, a foil rule, a stamped monogram, and the spine's shadow. */
    #tablet-os-overlay .tos-lib-plate { position:relative; flex:none; border-radius:2px 4px 4px 2px;
      display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px;
      background:
        linear-gradient(150deg, hsl(var(--bk-hue) 34% 34% / .85), hsl(var(--bk-hue) 40% 18% / .92)),
        linear-gradient(180deg, var(--tos-surface-hi), var(--tos-surface-lo));
      border:1px solid hsl(var(--bk-hue) 30% 12% / .8);
      box-shadow:inset 0 0 18px rgba(0,0,0,.35), 0 2px 6px rgba(0,0,0,.45); }
    #tablet-os-overlay .tos-lib-plate-sm { width:44px; height:62px; }
    #tablet-os-overlay .tos-lib-plate-lg { width:104px; height:148px; gap:9px; }
    #tablet-os-overlay .tos-lib-plate-spine { position:absolute; left:0; top:0; bottom:0; width:6px;
      border-radius:2px 0 0 2px; background:linear-gradient(90deg, rgba(0,0,0,.5), transparent); }
    #tablet-os-overlay .tos-lib-plate-mono { font-family:'Trajan Pro', Georgia, serif; font-weight:bold;
      letter-spacing:1px; font-size:14px; color:color-mix(in srgb, var(--mg-accent) 62%, #e8d8ae);
      text-shadow:0 1px 0 rgba(0,0,0,.5); }
    #tablet-os-overlay .tos-lib-plate-lg .tos-lib-plate-mono { font-size:28px; letter-spacing:2px; }
    #tablet-os-overlay .tos-lib-plate-rule { width:56%; height:1px;
      background:color-mix(in srgb, var(--mg-accent) 45%, transparent); }
    #tablet-os-overlay .tos-lib-plate-year { font-size:8.5px; letter-spacing:1.5px;
      color:color-mix(in srgb, #e8d8ae 55%, transparent); }
    #tablet-os-overlay .tos-lib-plate-lg .tos-lib-plate-year { font-size:11px; }

    /* Progress. Thin, accent-coloured, and only ever drawn for a book you started —
       an empty bar on every unopened title reads as a chore list. */
    #tablet-os-overlay .tos-lib-bar { height:3px; margin-top:5px; border-radius:2px; overflow:hidden;
      background:color-mix(in srgb, var(--tos-border) 70%, transparent); }
    #tablet-os-overlay .tos-lib-bar span { display:block; height:100%;
      background:linear-gradient(90deg, color-mix(in srgb, var(--mg-accent) 55%, transparent), var(--mg-accent)); }
    #tablet-os-overlay .tos-lib-bar-wide { margin:10px 0 0; height:4px; }

    /* Cover page: the plate beside the blurb, set on the same parchment as a page. */
    #tablet-os-overlay .tos-lib-cover { display:flex; gap:16px; align-items:flex-start; margin-bottom:12px; }
    #tablet-os-overlay .tos-lib-cover-txt { min-width:0; flex:1; }
    #tablet-os-overlay .tos-lib-cover-title { font-family:Georgia,'Palatino Linotype',serif; font-size:18px;
      color:var(--tos-fg); line-height:1.2; }
    #tablet-os-overlay .tos-lib-cover-by { font-size:12px; font-style:italic; color:var(--tos-fg-dim); margin-top:3px; }
    #tablet-os-overlay .tos-lib-blurb { margin-top:9px; font-size:13px; line-height:1.66; max-width:56ch;
      font-family:Georgia,'Palatino Linotype',serif;
      color:color-mix(in srgb, var(--tos-fg) 92%, #d9c39a);
      padding:11px 13px; border-radius:3px 6px 6px 3px;
      background:linear-gradient(100deg, color-mix(in srgb, var(--tos-surface-hi) 82%, #c9ab7d),
                                         color-mix(in srgb, var(--tos-surface-lo) 88%, #b9975f));
      border:1px solid color-mix(in srgb, #6b5433 40%, var(--tos-border)); }
    #tablet-os-overlay .tos-lib-facts { display:flex; flex-wrap:wrap; gap:6px 14px; margin-top:9px;
      font-size:11px; letter-spacing:.4px; color:var(--tos-fg-dim); text-transform:uppercase; }
    #tablet-os-overlay .tos-lib-prov { margin-top:8px; font-size:10.5px; line-height:1.5; opacity:.65;
      color:var(--tos-fg-dim); max-width:56ch; }

    /* Table of contents: leader dots out to a reading time, the way a printed one
       runs out to a page number. Chapters behind the bookmark dim; the bookmark
       itself gets the ribbon. */
    #tablet-os-overlay .tos-lib-toc { margin-bottom:12px; }
    #tablet-os-overlay .tos-lib-toc-head { font-family:Georgia,'Palatino Linotype',serif; font-size:12px;
      letter-spacing:3px; text-transform:uppercase; color:var(--tos-fg-dim);
      padding-bottom:6px; margin-bottom:4px; border-bottom:1px solid var(--tos-border); }
    #tablet-os-overlay .tos-lib-toc-row { display:flex; align-items:baseline; gap:8px; cursor:pointer;
      padding:7px 8px; border-radius:3px; border-left:2px solid transparent;
      font-family:Georgia,'Palatino Linotype',serif; font-size:13px; color:var(--tos-fg); }
    #tablet-os-overlay .tos-lib-toc-row:hover { background:color-mix(in srgb, var(--mg-accent) 12%, transparent);
      border-left-color:color-mix(in srgb, var(--mg-accent) 60%, transparent); }
    #tablet-os-overlay .tos-lib-toc-n { flex:none; width:2.1em; text-align:right; font-size:11px;
      color:var(--tos-fg-dim); font-variant-numeric:tabular-nums; }
    #tablet-os-overlay .tos-lib-toc-t { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:60%; }
    /* The leaders. A repeating dot gradient rather than a row of literal periods,
       so it stretches to whatever space is left instead of wrapping. */
    #tablet-os-overlay .tos-lib-toc-dots { flex:1; min-width:12px; height:1em; align-self:flex-end;
      background-image:radial-gradient(circle, color-mix(in srgb, var(--tos-fg-dim) 55%, transparent) 1px, transparent 1px);
      background-size:5px 5px; background-position:0 .72em; background-repeat:repeat-x; opacity:.6; }
    #tablet-os-overlay .tos-lib-toc-len { flex:none; font-size:10.5px; color:var(--tos-fg-dim);
      font-variant-numeric:tabular-nums; }
    #tablet-os-overlay .tos-lib-toc-read { opacity:.55; }
    #tablet-os-overlay .tos-lib-toc-at { border-left-color:var(--mg-accent);
      background:color-mix(in srgb, var(--mg-accent) 10%, transparent); }
    #tablet-os-overlay .tos-lib-toc-at .tos-lib-toc-t::after { content:' ⌖'; color:var(--mg-accent); }
    html[data-density="compact"] #tablet-os-overlay .tos-lib-shelf { grid-template-columns:repeat(auto-fill, minmax(160px, 1fr)); }
    html[data-density="compact"] #tablet-os-overlay .tos-lib-plate-lg { width:82px; height:118px; }

    html[data-density="compact"] #tablet-os-overlay .tos-book { padding:14px 14px 12px 20px; font-size:13.5px; }
    html[data-density="compact"] #tablet-os-overlay .tos-book p:first-of-type::first-letter { font-size:3em; }
    /* The sentence the voice is on. Background rather than colour, so the
       highlight survives every theme without fighting the palette. */
    #tablet-os-overlay .tos-narr-s { transition:background-color .18s ease; border-radius:2px; }
    #tablet-os-overlay .tos-narr-on { background:color-mix(in srgb, var(--mg-accent) 26%, transparent); box-shadow:0 0 0 2px color-mix(in srgb, var(--mg-accent) 26%, transparent); }
    /* Glossed word: a dotted underline, not a colour — a chapter with forty
       highlighted words reads like a ransom note. */
    #tablet-os-overlay .tos-gloss { font-weight:inherit; border-bottom:1px dotted color-mix(in srgb, var(--mg-accent) 65%, transparent); cursor:help; position:relative; }
    #tablet-os-overlay .tos-gloss-open::after {
      content:attr(data-gloss); position:absolute; left:0; top:1.55em; z-index:5;
      width:max-content; max-width:min(30ch,70vw); padding:6px 9px;
      background:var(--bg); border:1px solid var(--mg-accent); border-radius:4px;
      font-size:11.5px; font-weight:400; line-height:1.45; color:var(--tos-fg);
      box-shadow:0 4px 14px rgba(0,0,0,.5); white-space:normal;
    }
    #tablet-os-overlay .tos-narrate { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin:0 0 10px; }
    #tablet-os-overlay .tos-narrate-hint { font-size:11px; color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-narrate-min[disabled] { opacity:.4; cursor:default; }
    #tablet-os-overlay .tos-row { display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid color-mix(in srgb, var(--mg-accent) 12%, transparent); font-size:13px; }
    #tablet-os-overlay .tos-row span:first-child { color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-row span:last-child { color:var(--tos-fg); }

    /* Help reader (Help app chapter view) */
    #tablet-os-overlay .tos-help-blurb { font-size:12.5px; color:var(--tos-fg-dim); line-height:1.5; margin-bottom:13px; }
    #tablet-os-overlay .tos-help-sec { margin-bottom:13px; }
    #tablet-os-overlay .tos-help-head { font-size:11px; letter-spacing:1.5px; text-transform:uppercase; color:var(--mg-accent); margin-bottom:5px; padding-bottom:3px;
      border-bottom:1px solid color-mix(in srgb, var(--mg-accent) 20%, transparent); }
    #tablet-os-overlay .tos-help-p { font-size:13px; color:var(--tos-fg); line-height:1.55; margin-bottom:5px; }
    #tablet-os-overlay .tos-help-p.mono { color:var(--tos-fg-dim); background:var(--tos-surface-lo);
      border:1px solid color-mix(in srgb, var(--mg-accent) 16%, transparent); border-radius:4px; padding:6px 9px; white-space:pre-wrap; word-break:break-word; }

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

    /* Corp dashboard: centred name header + boxed sections ("cards"). */
    #tablet-os-overlay .tos-corp-head { text-align:center; margin:8px 0 4px; }
    #tablet-os-overlay .tos-corp-name { font-size:19px; letter-spacing:1px; color:var(--tos-fg); }
    #tablet-os-overlay .tos-corp-sub { font-size:12px; color:var(--tos-fg-dim); margin-top:3px; }
    #tablet-os-overlay .tos-card { margin-top:11px; padding:9px 11px; border-radius:7px;
      border:1px solid color-mix(in srgb, var(--mg-accent) 22%, transparent); background:var(--tos-surface-lo); }
    #tablet-os-overlay .tos-card-h { font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:var(--mg-accent); opacity:.9; margin-bottom:5px; }
    #tablet-os-overlay .tos-card .tos-row:last-child { border-bottom:none; }
    /* Corp view: full-height flex column so the page nav always pins to the
       bottom of the screen (fixed location on every corp page). */
    #tablet-os-overlay .tos-corp-view { display:flex; flex-direction:column; min-height:100%; }
    #tablet-os-overlay .tos-corp-scroll { flex:1 1 auto; }

    /* Corp: founding-cost warning */
    #tablet-os-overlay .tos-founding-warn { margin:12px 0; font-size:12px; line-height:1.5; color:var(--tos-fg-dim);
      border:1px solid color-mix(in srgb, var(--mg-accent) 24%, transparent); border-radius:6px; padding:9px 11px; background:var(--tos-surface-lo); }
    #tablet-os-overlay .tos-founding-warn b { color:var(--mg-accent); }
    /* Free colour-wheel row (corp colour) — a big native swatch + live hex readout. */
    #tablet-os-overlay .tos-color-row { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:7px; }
    #tablet-os-overlay input.tos-color-lg { width:46px; height:34px; }
    #tablet-os-overlay .tos-color-hex { font-family:'Courier New',monospace; font-size:13px; letter-spacing:1px; color:var(--tos-fg); }
    #tablet-os-overlay .tos-color-hint { flex:1 1 100%; font-size:11px; color:var(--tos-fg-dim2); }

    /* ── Codex ───────────────────────────────────────────────────────────────
       A reading surface, so it deliberately breaks the tablet's instrument look:
       a measured column, generous leading, a serif face for prose only. The
       chrome around it (shelf, contents, locks) stays in the tablet's own
       monospace/caps idiom so the app still reads as part of the device. */
    #tablet-os-overlay .tos-cx-root { --cx-serif: Georgia,'Times New Roman',serif; animation:tos-fade .28s ease; }
    #tablet-os-overlay .tos-cx-hero { text-align:center; padding:16px 0 20px; border-bottom:1px solid var(--tos-border); margin-bottom:16px; }
    #tablet-os-overlay .tos-cx-hero-eyebrow { font-size:10px; letter-spacing:3px; text-transform:uppercase; color:var(--tos-fg-dim2); }
    #tablet-os-overlay .tos-cx-hero-title { font-size:31px; letter-spacing:12px; margin:7px 0 5px; color:var(--tos-fg); text-indent:12px;
      text-shadow:0 0 22px color-mix(in srgb,var(--mg-accent) 40%,transparent); }
    #tablet-os-overlay .tos-cx-hero-title.small { font-size:20px; letter-spacing:5px; text-indent:5px; }
    #tablet-os-overlay .tos-cx-hero-sub { font-family:var(--cx-serif); font-style:italic; font-size:13px; color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-cx-shelf { display:flex; flex-direction:column; gap:9px; }
    #tablet-os-overlay .tos-cx-shelf-row { display:flex; align-items:center; gap:12px; cursor:pointer; padding:12px 13px; border-radius:7px;
      border:1px solid var(--tos-border); background:linear-gradient(165deg,var(--tos-surface-hi),var(--tos-surface-lo));
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi),inset 0 -2px 3px var(--tos-bevel-lo); transition:border-color .16s,transform .16s; }
    #tablet-os-overlay .tos-cx-shelf-row:hover { border-color:color-mix(in srgb,var(--mg-accent) 55%,transparent); transform:translateX(2px); }
    #tablet-os-overlay .tos-cx-glyph { font-size:21px; color:var(--mg-accent); text-shadow:0 0 12px color-mix(in srgb,var(--mg-accent) 55%,transparent); }
    #tablet-os-overlay .tos-cx-shelf-txt { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
    #tablet-os-overlay .tos-cx-shelf-title { font-size:14px; letter-spacing:1.6px; text-transform:uppercase; color:var(--tos-fg); }
    #tablet-os-overlay .tos-cx-shelf-sub { font-family:var(--cx-serif); font-size:12.5px; font-style:italic; color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-cx-shelf-meta { font-size:10.5px; letter-spacing:1.4px; text-transform:uppercase; color:var(--tos-fg-dim2); white-space:nowrap; }
    #tablet-os-overlay .tos-cx-shelf-meta b { color:var(--mg-accent); margin-left:8px; font-size:14px; }
    #tablet-os-overlay .tos-cx-prog { display:block; height:2px; margin-top:4px; background:var(--tos-surface-lo); border-radius:2px; overflow:hidden; max-width:190px; }
    #tablet-os-overlay .tos-cx-prog.wide { max-width:none; flex:1; height:3px; }
    #tablet-os-overlay .tos-cx-prog i { display:block; height:100%; background:var(--mg-accent); box-shadow:0 0 8px var(--mg-accent); }
    #tablet-os-overlay .tos-cx-foot { font-family:var(--cx-serif); font-style:italic; font-size:12px; color:var(--tos-fg-dim2); text-align:center; margin:18px 0 4px; }
    /* Volume contents */
    #tablet-os-overlay .tos-cx-volhead { padding-bottom:13px; border-bottom:1px solid var(--tos-border); margin-bottom:13px; text-align:center; }
    #tablet-os-overlay .tos-cx-note { font-family:var(--cx-serif); font-style:italic; font-size:12px; color:var(--tos-fg-dim2); max-width:44ch; margin:0 auto; }
    #tablet-os-overlay .tos-cx-progline { display:flex; align-items:center; gap:9px; margin-top:11px; font-size:10.5px; letter-spacing:1.4px;
      text-transform:uppercase; color:var(--tos-fg-dim2); }
    #tablet-os-overlay .tos-cx-progline b { color:var(--mg-accent); }
    #tablet-os-overlay .tos-cx-index { display:flex; flex-direction:column; }
    #tablet-os-overlay .tos-cx-entry { display:flex; align-items:flex-start; gap:13px; padding:13px 4px; border-bottom:1px solid var(--tos-border); cursor:pointer; }
    #tablet-os-overlay .tos-cx-entry:hover:not(.locked) .tos-cx-etitle { color:var(--mg-accent); }
    #tablet-os-overlay .tos-cx-entry.locked { cursor:default; opacity:.72; }
    #tablet-os-overlay .tos-cx-n { font-family:var(--cx-serif); font-size:16px; color:var(--tos-fg-dim2); min-width:30px; text-align:right; padding-top:1px; }
    #tablet-os-overlay .tos-cx-etxt { flex:1; min-width:0; display:flex; flex-direction:column; gap:5px; }
    #tablet-os-overlay .tos-cx-etitle { font-size:14px; letter-spacing:1.2px; color:var(--tos-fg); transition:color .16s; }
    #tablet-os-overlay .tos-cx-elede { font-family:var(--cx-serif); font-size:12.5px; font-style:italic; color:var(--tos-fg-dim); line-height:1.45; }
    /* A sealed entry shows its shape and nothing else — bars, not text. The body
       never leaves the server for a locked chapter, so this is honest, not a mask. */
    #tablet-os-overlay .tos-cx-redact { display:flex; flex-direction:column; gap:4px; margin:1px 0 2px; }
    #tablet-os-overlay .tos-cx-redact i { display:block; height:7px; border-radius:2px; background:repeating-linear-gradient(90deg,
      color-mix(in srgb,var(--tos-fg) 22%,transparent) 0 9px, transparent 9px 13px); }
    #tablet-os-overlay .tos-cx-hint { font-family:var(--cx-serif); font-size:12px; font-style:italic; color:color-mix(in srgb,var(--mg-accent) 70%,var(--tos-fg-dim2)); }
    #tablet-os-overlay .tos-cx-lock { font-size:9.5px; letter-spacing:2px; text-transform:uppercase; color:var(--tos-fg-dim2);
      border:1px solid var(--tos-border); border-radius:3px; padding:3px 6px; white-space:nowrap; }
    #tablet-os-overlay .tos-cx-open { font-size:10px; letter-spacing:1.6px; text-transform:uppercase; color:var(--mg-accent); white-space:nowrap; padding-top:2px; }
    /* The read */
    #tablet-os-overlay .tos-cx-readbar { margin-bottom:9px; }
    #tablet-os-overlay .tos-cx-back { cursor:pointer; font-size:10.5px; letter-spacing:1.6px; text-transform:uppercase; color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-cx-back:hover { color:var(--mg-accent); }
    #tablet-os-overlay .tos-cx-read { max-width:60ch; margin:0 auto; padding:6px 2px 4px; }
    #tablet-os-overlay .tos-cx-num { font-family:var(--cx-serif); font-size:13px; letter-spacing:5px; color:var(--mg-accent); text-align:center; }
    #tablet-os-overlay .tos-cx-eyebrow { font-size:9.5px; letter-spacing:3px; text-transform:uppercase; color:var(--tos-fg-dim2); text-align:center; margin-top:7px; }
    #tablet-os-overlay .tos-cx-title { font-family:var(--cx-serif); font-size:27px; font-weight:400; line-height:1.15; text-align:center;
      margin:9px 0 11px; color:var(--tos-fg); }
    #tablet-os-overlay .tos-cx-lede { font-family:var(--cx-serif); font-style:italic; font-size:14px; line-height:1.6; text-align:center;
      color:var(--tos-fg-dim); margin:0 auto; max-width:46ch; }
    #tablet-os-overlay .tos-cx-rule { text-align:center; letter-spacing:9px; font-size:8px; color:var(--tos-fg-dim2); margin:19px 0; }
    #tablet-os-overlay .tos-cx-rule.top { margin:17px 0 15px; }
    #tablet-os-overlay .tos-cx-p { font-family:var(--cx-serif); font-size:15px; line-height:1.72; color:var(--tos-fg); margin:0 0 15px; }
    #tablet-os-overlay .tos-cx-drop { float:left; font-size:44px; line-height:.86; padding:3px 9px 0 0; color:var(--mg-accent);
      text-shadow:0 0 18px color-mix(in srgb,var(--mg-accent) 45%,transparent); }
    #tablet-os-overlay .tos-cx-pull { font-family:var(--cx-serif); font-size:17px; font-style:italic; line-height:1.5; text-align:center;
      color:var(--mg-accent); margin:22px 0; padding:14px 12px; border-top:1px solid color-mix(in srgb,var(--mg-accent) 30%,transparent);
      border-bottom:1px solid color-mix(in srgb,var(--mg-accent) 30%,transparent);
      text-shadow:0 0 20px color-mix(in srgb,var(--mg-accent) 30%,transparent); }
    #tablet-os-overlay .tos-cx-end { text-align:center; font-size:13px; color:var(--tos-fg-dim2); margin:6px 0 2px; }
    #tablet-os-overlay .tos-cx-nav { display:flex; justify-content:space-between; gap:10px; margin-top:15px; padding-top:13px; border-top:1px solid var(--tos-border); }
    #tablet-os-overlay .tos-cx-step { cursor:pointer; font-size:10.5px; letter-spacing:1.4px; text-transform:uppercase; color:var(--tos-fg-dim);
      max-width:46%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    #tablet-os-overlay .tos-cx-step:hover { color:var(--mg-accent); }
    #tablet-os-overlay .tos-cx-step.off { opacity:.35; cursor:default; }
    /* The chapter nav and the back link are 10.5px text with no box of their own —
       a mouse target, not a thumb one. Under a coarse pointer they get real height
       via padding, pulled back out with a matching negative margin so the reader's
       spacing is unchanged; only the hit area grows. */
    @media (hover:none), (pointer:coarse) {
      #tablet-os-overlay .tos-cx-step { padding:12px 2px; margin:-12px 0; }
      #tablet-os-overlay .tos-cx-back { display:inline-block; padding:11px 8px; margin:-11px -8px; }
    }
    @media (max-width:560px) {
      #tablet-os-overlay .tos-cx-hero-title { font-size:25px; letter-spacing:8px; }
      #tablet-os-overlay .tos-cx-title { font-size:22px; }
      #tablet-os-overlay .tos-cx-p { font-size:14.5px; }
    }

    /* ── Ideology reader ─────────────────────────────────────────────────────
       Paged: a tab strip + one page at a time (Overview / per-order / Field).
       Beveled panels + glow, per-order identity colour carried in --ic. */
    /* Pin the breadcrumb + tab strip + swipe row to the top of the scroll so
       you can switch orders without scrolling back up, and the chart below
       always lands in view. Horizontal bleed covers the .tos-body padding. */
    /* Scope brighter dim tiers to the reader — the global dim2 (40% fg) reads as
       near-invisible grey for the tier labels/mottos/ladder here. */
    #tablet-os-overlay .tos-ideo-root { --tos-fg-dim: color-mix(in srgb, var(--tos-fg, var(--mg-accent)) 80%, var(--bg2, #12181b));
      --tos-fg-dim2: color-mix(in srgb, var(--tos-fg, var(--mg-accent)) 60%, var(--bg2, #12181b)); }
    #tablet-os-overlay .tos-ideo-sticky { position:sticky; top:0; z-index:6; margin:0 -13px; padding:6px 13px 0;
      background:var(--bg, #0c1114); box-shadow:0 7px 11px -7px rgba(0,0,0,0.6); }
    /* The order strip overflows past ~5 tabs — give it a visible themed rail so
       it reads as scrollable instead of needing a middle-mouse drag. */
    #tablet-os-overlay .tos-ideo-nav { display:flex; gap:5px; overflow-x:auto; overflow-y:hidden; padding-bottom:7px; margin-bottom:11px; border-bottom:1px solid var(--tos-border);
      scrollbar-width:thin; scrollbar-color:color-mix(in srgb,var(--ic,var(--mg-accent)) 45%,transparent) transparent; }
    #tablet-os-overlay .tos-ideo-nav::-webkit-scrollbar { height:7px; }
    #tablet-os-overlay .tos-ideo-nav::-webkit-scrollbar-track { background:rgba(0,0,0,.35); border-radius:4px; }
    #tablet-os-overlay .tos-ideo-nav::-webkit-scrollbar-thumb { background:color-mix(in srgb,var(--ic,var(--mg-accent)) 40%,transparent); border-radius:4px;
      box-shadow:0 0 7px color-mix(in srgb,var(--ic,var(--mg-accent)) 25%,transparent); }
    #tablet-os-overlay .tos-ideo-nav::-webkit-scrollbar-thumb:hover { background:color-mix(in srgb,var(--ic,var(--mg-accent)) 65%,transparent); }
    #tablet-os-overlay .tos-ideo-navsep { flex:0 0 auto; align-self:stretch; width:1px; margin:2px 6px 0; background:linear-gradient(180deg,transparent,var(--tos-border) 30%,var(--tos-border) 70%,transparent); }
    #tablet-os-overlay .tos-ideo-tab { flex:0 0 auto; cursor:pointer; user-select:none; font-size:11px; letter-spacing:1.3px; text-transform:uppercase;
      color:var(--tos-fg-dim); padding:6px 9px; border-radius:6px; white-space:nowrap; border:1px solid var(--tos-border);
      background:linear-gradient(165deg,var(--tos-surface-hi),var(--tos-surface-lo)); box-shadow:inset 0 1px 0 var(--tos-bevel-hi),inset 0 -2px 3px var(--tos-bevel-lo); }
    #tablet-os-overlay .tos-ideo-tab b { color:var(--ic,var(--mg-accent)); }
    #tablet-os-overlay .tos-ideo-tab:hover { filter:brightness(1.15); color:var(--tos-fg); }
    #tablet-os-overlay .tos-ideo-tab.on { color:var(--ic,var(--tos-fg)); border-color:var(--ic,var(--mg-accent));
      text-shadow:0 0 10px color-mix(in srgb,var(--ic,var(--mg-accent)) 55%,transparent);
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi),0 0 14px color-mix(in srgb,var(--ic,var(--mg-accent)) 26%,transparent); }
    #tablet-os-overlay .tos-ideo-page { animation:tos-fade .28s ease; }
    #tablet-os-overlay .tos-ideo-lbl { font-size:11px; letter-spacing:2px; text-transform:uppercase; color:var(--tos-fg-dim); display:flex; align-items:center; gap:8px; margin:0 0 9px; }
    #tablet-os-overlay .tos-ideo-lbl::after { content:""; flex:1; height:1px; background:linear-gradient(90deg,var(--tos-border),transparent); }
    #tablet-os-overlay .tos-ideo-panel { border-radius:9px; padding:12px 13px; margin-bottom:15px;
      background:linear-gradient(165deg,var(--tos-surface-hi),var(--tos-surface-lo));
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi),inset 0 -2px 4px var(--tos-bevel-lo),0 3px 8px rgba(0,0,0,0.3); border:1px solid var(--tos-border); }
    #tablet-os-overlay .tos-ideo-chart { display:block; width:100%; max-width:420px; margin-inline:auto; height:auto; max-height:52vh; font-family:'Courier New',monospace; }
    #tablet-os-overlay .tos-ideo-lean { text-align:center; font-size:13.5px; letter-spacing:.4px; color:var(--tos-fg-dim); margin-top:9px; }
    #tablet-os-overlay .tos-ideo-note { font-size:13.5px; line-height:1.6; color:var(--tos-fg-dim); margin:0; }
    #tablet-os-overlay .tos-ideo-note b { color:var(--tos-fg); }
    #tablet-os-overlay .tos-ideo-dim { color:var(--tos-fg-dim2); }
    #tablet-os-overlay .tos-ideo-bar { height:6px; border-radius:3px; background:rgba(0,0,0,.45); overflow:hidden; box-shadow:inset 0 1px 2px rgba(0,0,0,.6); }
    #tablet-os-overlay .tos-ideo-bar i { display:block; height:100%; border-radius:3px; }
    /* Overview: ranked standing rows (tap to open that order's page) */
    #tablet-os-overlay .tos-ideo-stand { display:flex; align-items:center; gap:9px; margin:7px 0; cursor:pointer; transition:transform .12s; }
    #tablet-os-overlay .tos-ideo-stand:hover { transform:translateX(2px); }
    #tablet-os-overlay .tos-ideo-sigwrap { flex:0 0 26px; display:flex; }
    #tablet-os-overlay .tos-ideo-sigwrap.big { flex:0 0 44px; }
    #tablet-os-overlay .tos-ideo-sig { width:100%; height:auto; }
    #tablet-os-overlay .tos-ideo-sname { flex:0 0 116px; font-size:13px; letter-spacing:1px; text-transform:uppercase; color:var(--ic); }
    #tablet-os-overlay .tos-ideo-stand .tos-ideo-bar { flex:1 1 auto; }
    #tablet-os-overlay .tos-ideo-tv { flex:0 0 68px; text-align:right; font-size:11px; letter-spacing:1px; text-transform:uppercase; }
    /* Emerging (expansion) orders — a preview, not yet live */
    #tablet-os-overlay .tos-ideo-stand.emerging { opacity:.62; }
    #tablet-os-overlay .tos-ideo-stand.emerging:hover { opacity:.82; }
    #tablet-os-overlay .tos-ideo-bar.emerging i { opacity:.7; box-shadow:none; }
    #tablet-os-overlay .tos-ideo-substand { font-size:10px; letter-spacing:2px; text-transform:uppercase; color:var(--tos-fg-dim2);
      margin:16px 0 8px; padding-top:11px; border-top:1px dashed var(--tos-line, rgba(255,255,255,.12)); }
    #tablet-os-overlay .tos-ideo-tab.emerging { opacity:.6; }
    #tablet-os-overlay .tos-ideo-tab.emerging.on { opacity:1; }
    #tablet-os-overlay .tos-ideo-emerge { font-size:10px; letter-spacing:2px; text-transform:uppercase; margin-top:5px;
      color:var(--ic,var(--tos-fg-dim2)); opacity:.85; }
    /* Order page */
    #tablet-os-overlay .tos-ideo-ohead { display:flex; align-items:center; gap:12px; margin-bottom:4px; }
    #tablet-os-overlay .tos-ideo-oname { font-size:22px; letter-spacing:1.5px; text-transform:uppercase; line-height:1.1; }
    #tablet-os-overlay .tos-ideo-motto { font-size:11px; letter-spacing:3px; text-transform:uppercase; color:var(--tos-fg-dim2); margin-top:3px; }
    #tablet-os-overlay .tos-ideo-tags { display:flex; gap:6px; flex-wrap:wrap; margin:11px 0 14px; }
    #tablet-os-overlay .tos-ideo-tag { font-size:11px; letter-spacing:1.3px; text-transform:uppercase; padding:5px 10px; border-radius:5px;
      color:var(--ic); border:1px solid color-mix(in srgb,var(--ic) 40%,transparent); background:color-mix(in srgb,var(--ic) 12%,transparent); }
    #tablet-os-overlay .tos-ideo-lore { font-family:Georgia,serif; font-size:14.5px; line-height:1.6; color:var(--tos-fg); margin:0 0 4px; }
    #tablet-os-overlay .tos-ideo-lore .drop { float:left; font-size:38px; line-height:.82; padding:2px 8px 0 0; font-family:Georgia,serif; }
    /* Second paragraph — the second-person "what aligning does for you" pitch. */
    #tablet-os-overlay .tos-ideo-exp { font-family:Georgia,serif; font-size:14.5px; line-height:1.6; color:var(--tos-fg); margin:12px 0 4px; }
    #tablet-os-overlay .tos-ideo-pull { font-family:Georgia,serif; font-style:italic; font-size:14.5px; line-height:1.5; border-left:2px solid; padding:2px 0 2px 12px; margin:13px 0; }
    #tablet-os-overlay .tos-ideo-tenets { list-style:none; padding:0; margin:0; }
    #tablet-os-overlay .tos-ideo-tenets li { position:relative; padding:7px 0 7px 21px; font-size:13.5px; line-height:1.45; color:var(--tos-fg-dim);
      border-bottom:1px solid color-mix(in srgb,var(--mg-accent) 10%,transparent); }
    #tablet-os-overlay .tos-ideo-tenets li:last-child { border-bottom:0; }
    #tablet-os-overlay .tos-ideo-tenets li::before { content:"◆"; position:absolute; left:2px; top:8px; font-size:8px; color:var(--ic); }
    #tablet-os-overlay .tos-ideo-pathbox { display:flex; align-items:center; gap:12px; }
    #tablet-os-overlay .tos-ideo-pathbox .pm { flex:0 0 80px; }
    #tablet-os-overlay .tos-ideo-pathbox .pml { font-size:10px; letter-spacing:1.3px; text-transform:uppercase; color:var(--tos-fg-dim2); margin-top:5px; }
    #tablet-os-overlay .tos-ideo-pathbox .pt { font-size:13px; line-height:1.5; color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-ideo-shead { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:10px; }
    #tablet-os-overlay .tos-ideo-shead .rp { font-size:19px; letter-spacing:1px; font-variant-numeric:tabular-nums; }
    #tablet-os-overlay .tos-ideo-shead .nx { font-size:11px; letter-spacing:1px; text-transform:uppercase; color:var(--tos-fg-dim2); }
    #tablet-os-overlay .tos-ideo-ladder { display:flex; flex-direction:column; }
    #tablet-os-overlay .tos-ideo-rung { display:flex; align-items:center; gap:10px; padding:5px 0; font-size:12px; letter-spacing:1px; text-transform:uppercase; color:var(--tos-fg-dim2); }
    #tablet-os-overlay .tos-ideo-rung .pip { flex:0 0 10px; height:10px; border-radius:50%; border:1px solid var(--tos-fg-dim2); background:transparent; }
    #tablet-os-overlay .tos-ideo-rung .rl { flex:1 1 auto; }
    #tablet-os-overlay .tos-ideo-rung .pk { font-size:10px; color:var(--tos-fg-dim2); }
    #tablet-os-overlay .tos-ideo-rung.done { color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-ideo-rung.done .pip { background:var(--ic); border-color:var(--ic); box-shadow:0 0 8px var(--ic); }
    #tablet-os-overlay .tos-ideo-rung.here { color:var(--ic); text-shadow:0 0 8px color-mix(in srgb,var(--ic) 45%,transparent); }
    #tablet-os-overlay .tos-ideo-rung.here .pip { background:var(--ic); border-color:#fff; box-shadow:0 0 12px var(--ic); }
    #tablet-os-overlay .tos-ideo-rung.here .pk { color:var(--ic); }
    #tablet-os-overlay .tos-ideo-chips { display:flex; flex-wrap:wrap; gap:6px; }
    #tablet-os-overlay .tos-ideo-chip { font-size:11.5px; letter-spacing:.8px; padding:6px 10px; border-radius:5px; border:1px solid var(--tos-border);
      background:linear-gradient(165deg,var(--tos-surface-hi),var(--tos-surface-lo)); color:var(--tos-fg-dim); box-shadow:inset 0 1px 0 var(--tos-bevel-hi); }
    #tablet-os-overlay .tos-ideo-chip em { font-style:normal; color:var(--tos-fg-dim2); font-size:10px; letter-spacing:1.3px; text-transform:uppercase; margin-right:5px; }
    #tablet-os-overlay .tos-ideo-chip.foe { border-color:color-mix(in srgb,#e05555 45%,transparent); color:#eba0a0; }
    #tablet-os-overlay .tos-ideo-chip.warn { border-color:color-mix(in srgb,#E0A030 40%,transparent); color:#e6c98f; }
    #tablet-os-overlay .tos-ideo-empty { font-size:13px; line-height:1.5; color:var(--tos-fg-dim2); font-style:italic; font-family:Georgia,serif; padding:2px 0; margin:0; }
    #tablet-os-overlay .tos-ideo-legend { display:flex; flex-wrap:wrap; gap:9px; margin-top:11px; }
    #tablet-os-overlay .tos-ideo-legend span { display:flex; align-items:center; gap:6px; font-size:11px; letter-spacing:.8px; text-transform:uppercase; color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-ideo-legend i { width:9px; height:9px; border-radius:50%; box-shadow:0 0 7px currentColor; }
    @keyframes tos-fade { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:none; } }

    /* Corp colour picker chromed as a tiny in-tablet browser window. */
    #tablet-os-overlay .tos-browserwin { margin-top:8px; border-radius:8px; overflow:hidden;
      border:1px solid color-mix(in srgb, var(--mg-accent) 24%, transparent);
      background:var(--tos-surface-lo); box-shadow:0 4px 14px rgba(0,0,0,0.28), inset 0 1px 0 var(--tos-bevel-hi); }
    #tablet-os-overlay .tos-bw-bar { display:flex; align-items:center; gap:9px; padding:6px 9px;
      background:linear-gradient(180deg, var(--tos-surface-hi), var(--tos-surface-lo));
      border-bottom:1px solid color-mix(in srgb, var(--mg-accent) 20%, transparent); }
    #tablet-os-overlay .tos-bw-dots { display:flex; gap:5px; flex:0 0 auto; }
    #tablet-os-overlay .tos-bw-dots i { width:10px; height:10px; border-radius:50%; display:block; box-shadow:inset 0 0 2px rgba(0,0,0,0.4); }
    #tablet-os-overlay .tos-bw-dots i.r { background:#ff5f57; } #tablet-os-overlay .tos-bw-dots i.y { background:#febc2e; } #tablet-os-overlay .tos-bw-dots i.g { background:#28c840; }
    #tablet-os-overlay .tos-bw-url { flex:1; font-family:'Courier New',monospace; font-size:11px; letter-spacing:.5px; color:var(--tos-fg-dim);
      background:var(--tos-surface-hi); border:1px solid var(--tos-bevel-lo); border-radius:4px; padding:3px 8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    #tablet-os-overlay .tos-bw-body { padding:11px 12px; }
    #tablet-os-overlay .tos-bw-body .tos-color-row { margin-top:0; }

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
    /* Label-less audio toggles: the on/off icons carry the meaning (tooltip'd),
       so the row is a centered pair of larger buttons instead of a labelled row. */
    #tablet-os-overlay .tos-set-row.tos-iconrow { justify-content:center; gap:22px; flex-wrap:wrap; }
    #tablet-os-overlay .tos-set-row.tos-iconrow .tos-opts { justify-content:center; flex:0 0 auto; }
    #tablet-os-overlay .tos-set-row.tos-iconrow .tos-opt { min-width:44px; font-size:16px; padding:6px 12px; }
    #tablet-os-overlay .tos-opt { cursor:pointer; min-width:30px; text-align:center; padding:5px 9px; border-radius:5px; font-size:13px; line-height:1.1;
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo));
      border:1px solid color-mix(in srgb, var(--mg-accent) 24%, transparent); color:var(--tos-fg);
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi), inset 0 -1px 1px var(--tos-bevel-lo);
      transition:filter .12s, box-shadow .12s, transform .05s; }
    #tablet-os-overlay .tos-opt:hover { filter:brightness(1.15); }
    #tablet-os-overlay .tos-opt:active { transform:translateY(1px); box-shadow:inset 0 2px 3px var(--tos-bevel-lo); }
    #tablet-os-overlay .tos-opt.selected { border-color:var(--mg-accent); color:var(--mg-accent); font-weight:bold; box-shadow:0 0 8px color-mix(in srgb, var(--mg-accent) 35%, transparent), inset 0 1px 0 var(--tos-bevel-hi); }
    #tablet-os-overlay .tos-slider { width:160px; max-width:46vw; accent-color:var(--mg-accent); cursor:pointer; }
    /* About page — a centered colophon: wordmark, byline, then the support link.
       Deliberately airy (no .tos-set-row dividers) so it reads as a title card
       rather than another list of controls. */
    #tablet-os-overlay .tos-about { display:flex; flex-direction:column; align-items:center; justify-content:center;
      gap:14px; text-align:center; padding:26px 14px 22px; }
    #tablet-os-overlay .tos-about-mark { font-size:26px; letter-spacing:6px; text-transform:uppercase; font-weight:bold;
      color:var(--mg-accent); text-shadow:0 0 14px color-mix(in srgb, var(--mg-accent) 45%, transparent); }
    #tablet-os-overlay .tos-about-rule { width:132px; height:1px; background:linear-gradient(90deg, transparent, var(--mg-accent), transparent); opacity:.7; }
    #tablet-os-overlay .tos-about-by { font-size:11px; letter-spacing:2.5px; text-transform:uppercase; color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-about-names { font-size:14px; line-height:1.7; color:var(--tos-fg); }
    /* Was a one-line italic tagline (a quote about the city); it now carries the
       support ask, which is body copy rather than a quotation — so no italic,
       and a little more width to breathe over two or three lines. */
    #tablet-os-overlay .tos-about-tag { font-size:11px; color:var(--tos-fg-dim); max-width:300px; line-height:1.65; }
    #tablet-os-overlay .tos-about-bmc { display:inline-flex; align-items:center; gap:9px; margin-top:4px; cursor:pointer;
      padding:9px 16px; border-radius:7px; font-size:12.5px; letter-spacing:.6px; text-decoration:none; color:var(--tos-fg);
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo));
      border:1px solid color-mix(in srgb, var(--mg-accent) 34%, transparent);
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi), inset 0 -2px 2px var(--tos-bevel-lo), 0 2px 6px rgba(0,0,0,.25);
      transition:filter .12s, box-shadow .12s, transform .05s; }
    #tablet-os-overlay .tos-about-bmc:hover { filter:brightness(1.15); box-shadow:0 0 12px color-mix(in srgb, var(--mg-accent) 38%, transparent), inset 0 1px 0 var(--tos-bevel-hi); }
    #tablet-os-overlay .tos-about-bmc:active { transform:translateY(1px); }
    #tablet-os-overlay .tos-about-bmc .tos-about-cup { font-size:16px; line-height:1; }
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
    #tablet-os-overlay .tos-rec .tos-acc-dot { animation:tos-acc-blink 1.1s steps(1) infinite; }
    @keyframes tos-acc-blink { 0%,50%{opacity:1} 51%,100%{opacity:.25} }
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
    #tablet-os-overlay .tos-buf-line { padding:1px 0; }
    #tablet-os-overlay .tos-buf-t { color:var(--tos-fg-dim2); font-size:9.5px; }
    /* Speech vs. narration/emote colour apart, and both key off theme tokens so the
       split re-skins per theme: speech = the tablet accent, narration = phosphor. */
    #tablet-os-overlay .tos-buf-line.say .tos-buf-txt { color:color-mix(in srgb, var(--mg-accent) 78%, #fff); }
    #tablet-os-overlay .tos-buf-line.event .tos-buf-txt { color:color-mix(in srgb, var(--shub) 82%, #fff); font-style:italic; }
    #tablet-os-overlay .tos-buf::-webkit-scrollbar { width:5px; }
    #tablet-os-overlay .tos-buf::-webkit-scrollbar-thumb { background:color-mix(in srgb, var(--shub) 30%, transparent); border-radius:3px; }
    #tablet-os-overlay .tos-buf-full { color:#ff5a68; font-weight:bold; letter-spacing:1px; }
    #tablet-os-overlay .tos-cam-live { color:#ff5a68; font-weight:bold; letter-spacing:1px; }
    #tablet-os-overlay .tos-cam-fullbar { margin:7px 0 2px; padding:4px 7px; font-size:10px; letter-spacing:.5px; text-align:center; color:#ffd0d4; background:color-mix(in srgb, #ff5a68 16%, var(--bg,#0c1114)); border:1px solid color-mix(in srgb, #ff5a68 40%, transparent); border-radius:3px; }

    /* ── Microreel viewer (SPECTER's own inline replay — no separate deck) ────────
       A CRT screen playing back a saved recording: header (zone/date/evidence), a
       framed screen with a HUD, transport controls, and a colour-coded transcript. */
    #tablet-os-overlay .tos-reel { --shub: var(--tos-shub, #39ff9e); display:flex; flex-direction:column; gap:9px; }
    #tablet-os-overlay .tos-reel-hdr { display:flex; justify-content:space-between; align-items:baseline; font-size:12px; letter-spacing:1px; text-transform:uppercase; color:var(--shub); text-shadow:0 0 8px color-mix(in srgb, var(--shub) 50%, transparent); }
    #tablet-os-overlay .tos-reel-date { font-size:10px; color:var(--tos-fg-dim); letter-spacing:.5px; text-transform:none; }
    #tablet-os-overlay .tos-reel-evi { font-size:10.5px; letter-spacing:1px; color:#ff7a86; border:1px solid #4a1a1e; background:#1a0a0c; border-radius:3px; padding:3px 8px; }
    #tablet-os-overlay .tos-reel-screen { position:relative; border:1px solid var(--shub); border-radius:6px; padding:12px 12px 26px; min-height:70px; background:var(--bg,#0a0e10);
      background-image:repeating-linear-gradient(0deg, transparent 0 2px, rgba(0,0,0,0.28) 2px 3px); box-shadow:inset 0 0 22px color-mix(in srgb, var(--shub) 14%, transparent); }
    #tablet-os-overlay .tos-reel-frame { font-size:13px; line-height:1.4; min-height:34px; text-shadow:0 0 5px color-mix(in srgb, var(--shub) 40%, transparent); }
    #tablet-os-overlay .tos-reel-frame.say { color:color-mix(in srgb, var(--mg-accent) 82%, #fff); }
    #tablet-os-overlay .tos-reel-frame.event { color:color-mix(in srgb, var(--shub) 88%, #fff); font-style:italic; }
    #tablet-os-overlay .tos-reel-hud { position:absolute; left:12px; right:12px; bottom:6px; display:flex; justify-content:space-between; font-size:9.5px; letter-spacing:1px; color:color-mix(in srgb, var(--shub) 70%, #fff); }
    #tablet-os-overlay .tos-reel-transport { display:flex; align-items:center; gap:6px; }
    #tablet-os-overlay .tos-reel-btn { cursor:pointer; font-size:12px; padding:5px 10px; border-radius:4px; color:var(--shub); background:color-mix(in srgb, var(--shub) 10%, var(--bg2,#12181b)); border:1px solid color-mix(in srgb, var(--shub) 34%, transparent); }
    #tablet-os-overlay .tos-reel-btn:hover { filter:brightness(1.16); }
    #tablet-os-overlay .tos-reel-btn.tos-reel-play { font-weight:bold; }
    #tablet-os-overlay .tos-reel-scrub { flex:1; accent-color:var(--shub); }
    #tablet-os-overlay .tos-reel-transcript { max-height:150px; overflow-y:auto; border:1px solid color-mix(in srgb, var(--shub) 20%, transparent); border-radius:3px; background:var(--bg,#0a0e10); padding:5px 7px; font-size:11px; line-height:1.45; }
    #tablet-os-overlay .tos-reel-line { padding:2px 4px; border-radius:2px; cursor:pointer; }
    #tablet-os-overlay .tos-reel-line.say .tos-buf-txt { color:color-mix(in srgb, var(--mg-accent) 78%, #fff); }
    #tablet-os-overlay .tos-reel-line.event .tos-buf-txt { color:color-mix(in srgb, var(--shub) 82%, #fff); font-style:italic; }
    #tablet-os-overlay .tos-reel-line.cur { background:color-mix(in srgb, var(--shub) 16%, transparent); box-shadow:inset 2px 0 0 var(--shub); }
    #tablet-os-overlay .tos-reel-tc { color:var(--tos-fg-dim2); font-size:9.5px; }
    #tablet-os-overlay .tos-reel-empty { color:var(--tos-fg-dim2); text-align:center; padding:10px; letter-spacing:2px; }
    #tablet-os-overlay .tos-reel-transcript::-webkit-scrollbar { width:5px; }
    #tablet-os-overlay .tos-reel-transcript::-webkit-scrollbar-thumb { background:color-mix(in srgb, var(--shub) 30%, transparent); border-radius:3px; }

    /* ── Gear app ─────────────────────────────────────────────────────────────
       A Vitruvian paperdoll: slot boxes anchored over each body part of an
       arms-out / legs-spread silhouette, whose regions light up for every covered
       slot. A layer selector swaps which layer the body boxes show; the soak table
       + effect chips sit below. Uses the shared tos theme tokens so it re-skins. */
    #tablet-os-overlay .tos-gear { display:flex; flex-direction:column; gap:9px; }
    #tablet-os-overlay .tos-gear-head { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
    #tablet-os-overlay .tos-gl-group { display:inline-flex; border-radius:6px; overflow:hidden; border:1px solid color-mix(in srgb, var(--mg-accent) 26%, transparent); box-shadow:inset 0 1px 0 var(--tos-bevel-hi); }
    #tablet-os-overlay .tos-gl { cursor:pointer; padding:5px 10px; font-size:10.5px; letter-spacing:.5px; text-transform:uppercase; color:var(--tos-fg-dim); background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo)); border:none; border-right:1px solid color-mix(in srgb, var(--mg-accent) 18%, transparent); }
    #tablet-os-overlay .tos-gl:last-child { border-right:none; }
    #tablet-os-overlay .tos-gl:hover { filter:brightness(1.14); }
    #tablet-os-overlay .tos-gl.active { color:var(--mg-accent); font-weight:bold; background:color-mix(in srgb, var(--mg-accent) 16%, var(--tos-surface-lo)); box-shadow:inset 0 0 11px color-mix(in srgb, var(--mg-accent) 26%, transparent); }
    #tablet-os-overlay .tos-gear-carry { display:flex; flex-direction:column; gap:3px; align-items:flex-end; }
    #tablet-os-overlay .tos-gear-bar { width:118px; height:5px; border-radius:3px; overflow:hidden; background:var(--bg, #0c1114); border:1px solid color-mix(in srgb, var(--mg-accent) 20%, transparent); }
    #tablet-os-overlay .tos-gear-bar span { display:block; height:100%; background:var(--mg-accent); box-shadow:0 0 6px var(--mg-accent); }
    #tablet-os-overlay .tos-gear-carry-txt { font-size:10px; letter-spacing:.5px; color:var(--tos-fg-dim); }

    /* The doll is a fixed-aspect stage matching the silhouette PNG, so the masked
       figure fills it edge-to-edge and each slot box's percentage anchor lands over
       the right body part. The figure is the alpha mask tinted to the live accent
       colour (body → accent, background → transparent), with a soft accent glow.
       Default (female) matches femsil (500×708); .male matches paperdoll (242×540). */
    /* Height-driven so the whole figure (incl. the feet box at 94%) always fits the
       screen without scrolling — width derives from the aspect. */
    /* A little taller than it was (46vh/336px): the crowding is vertical — seven boxes
       sharing one figure — and height is the cheapest room there is. The aspect ratio is
       unchanged, so the silhouette keeps its shape and every anchor stays on its body
       part; there's simply more space between them. */
    #tablet-os-overlay .tos-doll { position:relative; height:min(52vh, 392px); width:auto; max-width:46vw; margin:0 auto; aspect-ratio:500 / 708; }
    #tablet-os-overlay .tos-doll.male { aspect-ratio:242 / 540; }
    /* Loadout: inventory list on the LEFT (col 1), the layer selector + paperdoll
       centred in the middle (col 2), an empty right spacer (col 3) balancing the left
       so the doll stays centred. Both list and doll are on one screen for drag/drop;
       the whole left column is the unequip drop-zone. */
    #tablet-os-overlay .tos-gload { display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); gap:10px; align-items:start; margin-top:2px; }
    /* 186px cut "nyra synthleather jacket" in half. 230 fits the long tail of real
       item names on one line and still leaves the doll its centred column, since the
       right-hand readout cluster is narrower than the tray. */
    #tablet-os-overlay .tos-gload-side { grid-column:1; justify-self:start; width:100%; max-width:230px; min-width:0; display:flex; flex-direction:column; gap:7px; }
    #tablet-os-overlay .tos-gload-doll { grid-column:2; display:flex; flex-direction:column; align-items:center; gap:4px; }
    /* Below-feet feedback line (equip errors), accent, hidden until it has a message. */
    #tablet-os-overlay .tos-gload-fb { min-height:15px; font-size:11px; letter-spacing:.4px; text-align:center; color:var(--mg-accent); opacity:0; transition:opacity .15s; text-shadow:0 0 6px color-mix(in srgb, var(--mg-accent) 45%, transparent); }
    #tablet-os-overlay .tos-gload-fb.show { opacity:1; }
    /* Top-right cluster (col 3): layer selector + carry + total-armor + insulation. */
    #tablet-os-overlay .tos-gload-far { grid-column:3; justify-self:end; align-self:start; display:flex; flex-direction:column; align-items:flex-end; gap:9px; padding-top:2px; }
    #tablet-os-overlay .tos-gstat { display:flex; align-items:center; gap:5px; color:var(--mg-accent); font-size:14px; font-variant-numeric:tabular-nums; }
    #tablet-os-overlay .tos-gstat svg { width:17px; height:17px; flex:0 0 auto; filter:drop-shadow(0 0 3px color-mix(in srgb, var(--mg-accent) 40%, transparent)); }
    #tablet-os-overlay .tos-gstat-armor { cursor:pointer; border-radius:5px; padding:2px 4px; margin:-2px -4px; transition:background .12s; }
    #tablet-os-overlay .tos-gstat-armor:hover { background:color-mix(in srgb, var(--mg-accent) 16%, transparent); }

    /* Hover quick-stats tooltip — monochrome accent, floats above everything. */
    #tablet-os-overlay .tos-gtip { position:fixed; z-index:9500; pointer-events:none; min-width:132px; max-width:220px; padding:9px 11px; border-radius:8px;
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo)); border:1px solid color-mix(in srgb, var(--mg-accent) 45%, transparent);
      box-shadow:0 6px 22px rgba(0,0,0,0.5), inset 0 1px 0 var(--tos-bevel-hi); color:var(--mg-accent); }
    #tablet-os-overlay .tos-gtip-name { font-size:12.5px; color:var(--mg-accent); }
    #tablet-os-overlay .tos-gtip-slot { font-size:8.5px; letter-spacing:1px; text-transform:uppercase; color:color-mix(in srgb, var(--mg-accent) 60%, transparent); margin-bottom:4px; }
    #tablet-os-overlay .tos-gtip-sec { font-size:8.5px; letter-spacing:1.5px; text-transform:uppercase; color:color-mix(in srgb, var(--mg-accent) 62%, transparent); margin:4px 0 2px; }
    #tablet-os-overlay .tos-gtip-row { display:flex; justify-content:space-between; gap:12px; font-size:11px; padding:1.5px 0; }
    #tablet-os-overlay .tos-gtip-row > span:first-child { color:color-mix(in srgb, var(--mg-accent) 66%, transparent); }
    #tablet-os-overlay .tos-gtip-row.tos-gtip-dim { color:color-mix(in srgb, var(--mg-accent) 55%, transparent); }
    #tablet-os-overlay .tos-gtip-type { display:inline-flex; align-items:center; gap:4px; }
    #tablet-os-overlay .tos-gtip-type svg { width:13px; height:13px; }
    #tablet-os-overlay .tos-gtip-soak { display:flex; align-items:center; gap:6px; font-size:11px; padding:1.5px 0; }
    #tablet-os-overlay .tos-gtip-ico { display:inline-flex; }
    #tablet-os-overlay .tos-gtip-ico svg { width:14px; height:14px; }
    #tablet-os-overlay .tos-gtip-soak .tos-gtip-val { margin-left:auto; font-variant-numeric:tabular-nums; }
    #tablet-os-overlay .tos-gtip-hint { margin-top:6px; padding-top:5px; border-top:1px solid color-mix(in srgb, var(--mg-accent) 20%, transparent); font-size:9px; letter-spacing:.4px; color:color-mix(in srgb, var(--mg-accent) 55%, transparent); }

    /* Armor breakdown popup — reuses the .tos-idp shell; per-type rows with icons. */
    #tablet-os-overlay .tos-gbrk { max-width:250px; }
    #tablet-os-overlay .tos-gbrk-list { display:flex; flex-direction:column; gap:2px; }
    #tablet-os-overlay .tos-gbrk-row { display:flex; align-items:center; gap:9px; font-size:13px; padding:5px 4px; border-top:1px solid color-mix(in srgb, var(--mg-accent) 14%, transparent); color:var(--mg-accent); }
    #tablet-os-overlay .tos-gbrk-row.zero { color:color-mix(in srgb, var(--mg-accent) 40%, transparent); }
    #tablet-os-overlay .tos-gbrk-ico { display:inline-flex; flex:0 0 auto; }
    #tablet-os-overlay .tos-gbrk-ico svg { width:19px; height:19px; }
    #tablet-os-overlay .tos-gbrk-name { flex:1; }
    #tablet-os-overlay .tos-gbrk-val { font-size:15px; font-variant-numeric:tabular-nums; display:flex; align-items:baseline; gap:6px; }
    /* The weakest slot, beside the total. A big total hides a bare head, and the bare
       head is what actually kills you. */
    #tablet-os-overlay .tos-gbrk-worst { font-style:normal; font-size:9px; letter-spacing:1px; text-transform:uppercase; color:var(--tos-fg-dim2); }
    #tablet-os-overlay .tos-gbrk-foot { margin-top:8px; font-size:10.5px; color:color-mix(in srgb, var(--mg-accent) 62%, transparent); }
    #tablet-os-overlay .tos-doll-fig { position:absolute; inset:0; background:var(--mg-accent);
      -webkit-mask:url('/assets/femsil-mask.png') center / contain no-repeat;
      mask:url('/assets/femsil-mask.png') center / contain no-repeat;
      filter:drop-shadow(0 0 6px color-mix(in srgb, var(--mg-accent) 38%, transparent)); }
    #tablet-os-overlay .tos-doll.male .tos-doll-fig {
      -webkit-mask-image:url('/assets/paperdoll-mask.png');
      mask-image:url('/assets/paperdoll-mask.png'); }

    /* Sized for real item names ("hooded acid slicker", "cyber track pants") without
       the boxes colliding. The earlier 88px/64% was too greedy in BOTH axes: hands and
       weapon are anchored to opposite edges of the same row, so 2 × 88px met in the
       middle of the figure, and a wrapped two-line name grew the box downward into the
       row beneath it. 76px/44% keeps a pair clear of each other with the stage's width
       to spare, and the wrap is capped at two lines (below). */
    #tablet-os-overlay .tos-gslot { position:absolute; z-index:2; display:flex; flex-direction:column; gap:0; padding:3px 6px; min-width:76px; max-width:44%; border-radius:5px; user-select:none; touch-action:none;
      background:color-mix(in srgb, var(--tos-surface-lo) 88%, transparent); border:1px solid color-mix(in srgb, var(--mg-accent) 22%, transparent);
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi), inset 0 -1px 1px var(--tos-bevel-lo), 0 2px 6px rgba(0,0,0,0.35); backdrop-filter:blur(1px); transition:border-color .15s, box-shadow .15s; }
    #tablet-os-overlay .tos-gslot-label { font-size:8px; letter-spacing:1px; text-transform:uppercase; color:var(--tos-fg-dim2); }
    /* Two lines before it gives up, so a long name wraps instead of vanishing. */
    #tablet-os-overlay .tos-gslot-item { font-size:10px; line-height:1.2; color:var(--tos-fg-dim);
      display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; overflow-wrap:anywhere; }
    /* An EMPTY slot is just a label — the em-dash placeholder was making every bare
       box as tall as a filled one, which is most of the crowding on a half-dressed
       body. Collapse it to the label alone; the box still reads as a slot and is still
       the same drop target. */
    #tablet-os-overlay .tos-gslot:not(.filled) .tos-gslot-item { display:none; }
    #tablet-os-overlay .tos-gslot:not(.filled) { min-width:62px; opacity:.72; }
    #tablet-os-overlay .tos-gslot.filled { border-color:color-mix(in srgb, var(--mg-accent) 50%, transparent); box-shadow:0 0 10px color-mix(in srgb, var(--mg-accent) 22%, transparent), inset 0 1px 0 var(--tos-bevel-hi), 0 2px 6px rgba(0,0,0,0.35); }
    #tablet-os-overlay .tos-gslot.filled .tos-gslot-item { color:var(--tos-fg); }
    #tablet-os-overlay .tos-gslot.filled .tos-gslot-label { color:var(--mg-accent); }
    /* Worn, but not on the layer you're looking at: faded and un-glowed, so the doll
       shows at a glance which boxes are actually the layer you selected. Still fully
       interactive (tap = unequip) — dimmed means elsewhere, not disabled — and it
       brightens on hover to say so. */
    #tablet-os-overlay .tos-gslot.off-layer { opacity:.46; box-shadow:inset 0 1px 0 var(--tos-bevel-hi), 0 2px 6px rgba(0,0,0,0.35);
      border-color:color-mix(in srgb, var(--mg-accent) 22%, transparent); border-style:dashed; }
    #tablet-os-overlay .tos-gslot.off-layer:hover { opacity:.92; }
    /* Anchor each box over its body part (percentages of the doll stage). */
    /* Anchors re-spaced to stop the boxes stacking on each other. The three centred
       ones (head/torso/legs/feet) each own a band of the figure, and the hands/weapon
       pair sits in the GAP between torso and legs rather than level with the top of the
       legs box — which is what put three boxes in one horizontal strip. */
    #tablet-os-overlay .tos-gslot--head { left:50%; top:7%; transform:translate(-50%,-50%); text-align:center; }
    #tablet-os-overlay .tos-gslot--torso { left:50%; top:31%; transform:translate(-50%,-50%); text-align:center; }
    #tablet-os-overlay .tos-gslot--legs { left:50%; top:69%; transform:translate(-50%,-50%); text-align:center; }
    #tablet-os-overlay .tos-gslot--feet { left:50%; top:97%; transform:translate(-50%,-50%); text-align:center; }
    #tablet-os-overlay .tos-gslot--hands { left:0; top:50%; transform:translateY(-50%); text-align:left; }
    #tablet-os-overlay .tos-gslot--weapon_hand { right:0; top:50%; transform:translateY(-50%); text-align:right; }
    /* Inside the stage, not hanging off it: at right:-56px this overlapped whatever sat
       in the next grid column, which on a narrow panel is the readout cluster. */
    #tablet-os-overlay .tos-gslot--accessory { right:0; top:16%; transform:translateY(-50%); text-align:right; }
    /* Filled boxes are tap-to-unequip; every box is a drag-to-equip target. */
    #tablet-os-overlay .tos-gslot.filled { cursor:pointer; }
    #tablet-os-overlay .tos-gslot.filled:hover { border-color:var(--mg-accent); }
    #tablet-os-overlay .tos-gslot-over { border-color:var(--mg-accent) !important; box-shadow:0 0 12px color-mix(in srgb, var(--mg-accent) 55%, transparent) !important; }

    #tablet-os-overlay .tos-gear-stats { display:flex; flex-direction:column; gap:5px; }
    #tablet-os-overlay .tos-gear-sec { font-size:10px; letter-spacing:2px; text-transform:uppercase; color:var(--mg-accent); margin-top:5px; opacity:.85; }
    #tablet-os-overlay .tos-gear-soak { width:100%; border-collapse:collapse; font-size:11.5px; }
    #tablet-os-overlay .tos-gear-soak th { font-weight:normal; font-size:9px; letter-spacing:1px; text-transform:uppercase; color:var(--tos-fg-dim2); padding:3px 4px; text-align:center; }
    #tablet-os-overlay .tos-gear-soak th:first-child, #tablet-os-overlay .tos-gear-soak td:first-child { text-align:left; color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-gear-soak td { padding:4px; text-align:center; color:var(--tos-fg-dim2); border-top:1px solid color-mix(in srgb, var(--mg-accent) 10%, transparent); }
    #tablet-os-overlay .tos-gear-soak td.has { color:var(--mg-accent); font-weight:bold; }
    #tablet-os-overlay .tos-gear-fx { display:flex; flex-wrap:wrap; gap:6px; }
    #tablet-os-overlay .tos-gear-fx span { font-size:11px; padding:3px 10px; border-radius:11px; color:var(--tos-fg); background:color-mix(in srgb, var(--mg-accent) 14%, transparent); border:1px solid color-mix(in srgb, var(--mg-accent) 30%, transparent); }
    #tablet-os-overlay .tos-gear-fx.empty { color:var(--tos-fg-dim2); font-size:11.5px; }

    /* Carried tray + the drag-to-ground zone. Cards drag onto the doll to equip or
       onto the zone to drop; the per-card ⤓ button moved to the Inventory tab
       (.tos-ginv-drop), so .tos-gcard-drop below is now unused by the tray and kept
       only so a card rendered with one still styles correctly. */
    #tablet-os-overlay .tos-gtray { display:flex; flex-direction:column; gap:5px; min-height:72px; padding:4px; border-radius:6px; border:1px dashed color-mix(in srgb, var(--mg-accent) 16%, transparent); }
    #tablet-os-overlay .tos-gtray-empty { color:var(--tos-fg-dim2); font-size:11.5px; padding:4px 2px; display:flex; align-items:center; justify-content:center; min-height:60px; text-align:center; }
    #tablet-os-overlay .tos-gcard { display:flex; align-items:center; gap:8px; padding:6px 9px; border-radius:5px; user-select:none; touch-action:none;
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo)); border:1px solid color-mix(in srgb, var(--mg-accent) 18%, transparent);
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi), inset 0 -1px 1px var(--tos-bevel-lo); transition:filter .12s, border-color .12s, opacity .12s; }
    #tablet-os-overlay .tos-gcard.equippable { cursor:pointer; }
    #tablet-os-overlay .tos-gcard.equippable:hover { border-color:color-mix(in srgb, var(--mg-accent) 50%, transparent); filter:brightness(1.08); }
    #tablet-os-overlay .tos-gcard.dragging { opacity:.45; }
    /* Wraps to two lines rather than ellipsising — the tray is a column, so vertical
       room is the one thing it has plenty of. */
    #tablet-os-overlay .tos-gcard-name { flex:1; min-width:0; font-size:12.5px; line-height:1.3; color:var(--tos-fg);
      display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; overflow-wrap:anywhere; }
    #tablet-os-overlay .tos-gcard-meta { font-size:9px; letter-spacing:1px; text-transform:uppercase; color:var(--tos-fg-dim2); white-space:nowrap; }
    #tablet-os-overlay .tos-gcard-drop { flex:0 0 auto; cursor:pointer; font-size:14px; line-height:1; color:color-mix(in srgb, var(--mg-accent) 60%, transparent); background:transparent; border:1px solid color-mix(in srgb, var(--mg-accent) 22%, transparent); border-radius:4px; padding:2px 7px; transition:color .12s, border-color .12s, background .12s; }
    #tablet-os-overlay .tos-gcard-drop:hover { color:var(--mg-accent); border-color:var(--mg-accent); background:color-mix(in srgb, var(--mg-accent) 20%, transparent); }
    #tablet-os-overlay .tos-gear-drop { margin-top:2px; text-align:center; font-size:11px; letter-spacing:1.5px; text-transform:uppercase; color:color-mix(in srgb, var(--mg-accent) 55%, transparent); padding:8px; border-radius:6px;
      border:1px dashed color-mix(in srgb, var(--mg-accent) 30%, transparent); background:color-mix(in srgb, var(--tos-surface-lo) 60%, transparent); transition:border-color .12s, color .12s, background .12s; }
    #tablet-os-overlay .tos-gear-drop-over { border-color:var(--mg-accent); border-style:solid; color:var(--mg-accent); background:color-mix(in srgb, var(--mg-accent) 18%, transparent); }
    /* Tray highlights when a worn slot box is dragged over it (unequip target). */
    #tablet-os-overlay .tos-gtray-over { outline:1px dashed var(--mg-accent); outline-offset:3px; border-radius:6px; }

    /* Gear tabs (Loadout / Inventory). */
    #tablet-os-overlay .tos-gtabs { display:inline-flex; align-self:flex-end; border-radius:7px; overflow:hidden; border:1px solid color-mix(in srgb, var(--mg-accent) 26%, transparent); box-shadow:inset 0 1px 0 var(--tos-bevel-hi); }
    #tablet-os-overlay .tos-gtab { cursor:pointer; padding:7px 20px; font-size:11px; letter-spacing:1.5px; text-transform:uppercase; color:var(--tos-fg-dim); background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo)); border:none; border-right:1px solid color-mix(in srgb, var(--mg-accent) 18%, transparent); }
    #tablet-os-overlay .tos-gtab:last-child { border-right:none; }
    #tablet-os-overlay .tos-gtab:hover { filter:brightness(1.14); }
    #tablet-os-overlay .tos-gtab.active { color:var(--mg-accent); font-weight:bold; background:color-mix(in srgb, var(--mg-accent) 16%, var(--tos-surface-lo)); box-shadow:inset 0 0 11px color-mix(in srgb, var(--mg-accent) 26%, transparent); }

    /* Pager (◂ n/m ▸), shared by the loadout tray + Inventory tab. */
    #tablet-os-overlay .tos-gpager { display:flex; align-items:center; justify-content:center; gap:14px; padding:4px 0 2px; font-size:11px; letter-spacing:1px; color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-gpg { cursor:pointer; min-width:30px; padding:3px 9px; font-size:13px; line-height:1; color:var(--mg-accent); background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo)); border:1px solid color-mix(in srgb, var(--mg-accent) 26%, transparent); border-radius:5px; box-shadow:inset 0 1px 0 var(--tos-bevel-hi); }
    #tablet-os-overlay .tos-gpg:hover:not([disabled]) { filter:brightness(1.16); }
    #tablet-os-overlay .tos-gpg[disabled] { opacity:.35; cursor:default; }

    /* Inventory tab: full paged pack, one tappable row per item. */
    #tablet-os-overlay .tos-ginv-title { font-size:12px; letter-spacing:2px; text-transform:uppercase; color:var(--mg-accent); }
    #tablet-os-overlay .tos-ginv-list { display:flex; flex-direction:column; gap:4px; margin-top:4px; }
    #tablet-os-overlay .tos-ginv-row { display:flex; align-items:center; gap:8px; cursor:pointer; padding:8px 10px; border-radius:5px;
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo)); border:1px solid color-mix(in srgb, var(--mg-accent) 18%, transparent);
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi), inset 0 -1px 1px var(--tos-bevel-lo); transition:filter .12s, border-color .12s; }
    #tablet-os-overlay .tos-ginv-row:hover { border-color:color-mix(in srgb, var(--mg-accent) 48%, transparent); filter:brightness(1.08); }
    #tablet-os-overlay .tos-ginv-name { flex:1; min-width:0; font-size:12.5px; color:var(--tos-fg); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    #tablet-os-overlay .tos-ginv-slot { font-size:9px; letter-spacing:1px; text-transform:uppercase; color:var(--tos-fg-dim2); white-space:nowrap; }
    /* Per-row weight — tabular so the column reads as a column, and dim enough that
       the name still wins the row. */
    #tablet-os-overlay .tos-ginv-wt { flex:0 0 auto; font-size:10px; font-variant-numeric:tabular-nums; color:var(--tos-fg-dim2); white-space:nowrap; }
    /* ⤓, moved here off the Gear tab. Sits quiet until the row is hovered so a list of
       twenty things isn't twenty invitations to throw them away. */
    #tablet-os-overlay .tos-ginv-drop { flex:0 0 auto; cursor:pointer; font-size:13px; line-height:1; padding:2px 6px; border-radius:4px;
      color:color-mix(in srgb, var(--mg-accent) 42%, transparent); background:transparent;
      border:1px solid color-mix(in srgb, var(--mg-accent) 16%, transparent); opacity:.5; transition:opacity .12s, color .12s, border-color .12s, background .12s; }
    #tablet-os-overlay .tos-ginv-row:hover .tos-ginv-drop { opacity:1; }
    #tablet-os-overlay .tos-ginv-drop:hover { color:var(--mg-accent); border-color:var(--mg-accent); background:color-mix(in srgb, var(--mg-accent) 20%, transparent); }
    /* ⇧ wear/wield · ⇩ take off. Brighter than ⤓ and always legible rather than
       hover-revealed, because putting kit ON is the thing you came to this list to do —
       dropping it is the destructive one that should stay quiet. */
    #tablet-os-overlay .tos-ginv-eqbtn { flex:0 0 auto; cursor:pointer; font-size:13px; line-height:1; padding:2px 6px; border-radius:4px;
      color:color-mix(in srgb, var(--mg-accent) 82%, #fff); background:color-mix(in srgb, var(--mg-accent) 10%, transparent);
      border:1px solid color-mix(in srgb, var(--mg-accent) 32%, transparent); transition:color .12s, border-color .12s, background .12s; }
    #tablet-os-overlay .tos-ginv-eqbtn:hover { border-color:var(--mg-accent); background:color-mix(in srgb, var(--mg-accent) 26%, transparent); }
    /* Taking something off is the quieter half of the same control. */
    #tablet-os-overlay .tos-ginv-eqbtn.off { color:var(--tos-fg-dim); background:transparent; border-color:color-mix(in srgb, var(--mg-accent) 18%, transparent); }
    #tablet-os-overlay .tos-ginv-eqbtn.off:hover { color:var(--mg-accent); border-color:color-mix(in srgb, var(--mg-accent) 45%, transparent); }
    #tablet-os-overlay .tos-ginv-eq { font-size:9px; letter-spacing:1px; text-transform:uppercase; color:var(--mg-accent); white-space:nowrap; }
    /* ── What's in your hand ────────────────────────────────────────────────────
       The wielded weapon, pinned above the paged list. It gets a real block with a
       label rather than just being sorted first, because an unlabelled pinned row
       reads as a sorting bug. Its badge is brighter and heavier than "equipped" —
       in a fight this is the one line on the screen you're looking for. */
    #tablet-os-overlay .tos-ginv-hand { margin:6px 0 2px; padding:6px 7px 4px; border-radius:6px;
      background:color-mix(in srgb, var(--mg-accent) 7%, transparent);
      border:1px solid color-mix(in srgb, var(--mg-accent) 24%, transparent); }
    #tablet-os-overlay .tos-ginv-handlab { font-size:8.5px; letter-spacing:1.6px; text-transform:uppercase;
      color:color-mix(in srgb, var(--mg-accent) 66%, transparent); margin-bottom:4px; }
    /* The row itself, held: a lit left edge so it reads as "active" at a glance even
       with the badge text unread. */
    #tablet-os-overlay .tos-ginv-row.wielding { border-color:color-mix(in srgb, var(--mg-accent) 55%, transparent);
      box-shadow:inset 3px 0 0 var(--mg-accent), 0 0 10px color-mix(in srgb, var(--mg-accent) 14%, transparent); }
    #tablet-os-overlay .tos-ginv-row.wielding .tos-ginv-name { color:color-mix(in srgb, var(--mg-accent) 30%, var(--tos-fg)); font-weight:bold; }
    #tablet-os-overlay .tos-ginv-eq.wielding { font-weight:bold;
      color:color-mix(in srgb, var(--mg-accent) 80%, #fff);
      text-shadow:0 0 7px color-mix(in srgb, var(--mg-accent) 45%, transparent); }
    #tablet-os-overlay .tos-ginv-chev { flex:0 0 auto; font-size:15px; color:var(--tos-fg-dim2); }
    /* The primary-verb chip: the one thing this item is FOR (Use / Read / Eat / …),
       shown on the row itself and tappable straight through, so a player never has
       to guess which verb an object wants. It shimmers on a slow loop — the same
       "this is the next move" language as the prose's .verb-teach. */
    #tablet-os-overlay .tos-ginv-verb { flex:0 0 auto; cursor:pointer; font-size:9px; letter-spacing:1.5px; text-transform:uppercase;
      padding:3px 9px; border-radius:3px; white-space:nowrap; color:var(--mg-accent); position:relative; overflow:hidden;
      background:color-mix(in srgb, var(--mg-accent) 14%, transparent);
      border:1px solid color-mix(in srgb, var(--mg-accent) 45%, transparent); }
    #tablet-os-overlay .tos-ginv-verb:hover { background:color-mix(in srgb, var(--mg-accent) 30%, transparent); }
    #tablet-os-overlay .tos-ginv-verb::after, #tablet-os-overlay .tos-idp-verb.primary::after {
      content:''; position:absolute; inset:0; pointer-events:none;
      background:linear-gradient(105deg, transparent 35%, color-mix(in srgb, var(--mg-accent) 55%, transparent) 50%, transparent 65%);
      transform:translateX(-120%); animation:tos-verb-shimmer 3.4s ease-in-out infinite; }
    #tablet-os-overlay .tos-idp-verb.primary { position:relative; overflow:hidden;
      border-color:color-mix(in srgb, var(--mg-accent) 85%, transparent); }
    @keyframes tos-verb-shimmer { 0%{transform:translateX(-120%)} 55%,100%{transform:translateX(120%)} }
    [data-motion="off"] #tablet-os-overlay .tos-ginv-verb::after,
    [data-motion="off"] #tablet-os-overlay .tos-idp-verb.primary::after { animation:none; opacity:0; }
    /* Collapsible Clothing group header on the Inventory tab. */
    #tablet-os-overlay .tos-ginv-grouphead { display:flex; align-items:center; gap:8px; cursor:pointer; margin-top:8px; padding:7px 10px;
      border-radius:5px; background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo));
      border:1px solid color-mix(in srgb, var(--mg-accent) 24%, transparent);
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi), inset 0 -1px 1px var(--tos-bevel-lo); transition:filter .12s, border-color .12s; }
    #tablet-os-overlay .tos-ginv-grouphead:hover { border-color:color-mix(in srgb, var(--mg-accent) 48%, transparent); filter:brightness(1.08); }
    #tablet-os-overlay .tos-ginv-groupname { flex:1; min-width:0; font-size:11px; letter-spacing:1px; text-transform:uppercase; color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-ginv-groupcount { flex:0 0 auto; font-size:10px; padding:1px 7px; border-radius:9px;
      background:color-mix(in srgb, var(--mg-accent) 16%, transparent); color:var(--tos-fg-dim2); }

    /* Item-detail sheet (tap a row on the Inventory tab). */
    /* pointer-events:auto — the overlay container is pointer-events:none (clicks pass
       through to the game); the popup must re-enable them or its X/backdrop do nothing.
       z-index above the chassis (9300) so it sits on top, not behind the glass. */
    #tablet-os-overlay .tos-idp-overlay { position:absolute; inset:0; z-index:9400; pointer-events:auto; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(0,0,0,0.6); backdrop-filter:blur(2px); }
    #tablet-os-overlay .tos-idp { width:100%; max-width:300px; display:flex; flex-direction:column; gap:10px; padding:15px; border-radius:9px;
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo)); border:1px solid color-mix(in srgb, var(--mg-accent) 40%, transparent);
      box-shadow:0 8px 30px rgba(0,0,0,0.55), inset 0 1px 0 var(--tos-bevel-hi); }
    /* Monochrome: everything is a tint of the accent (no grays, no red). */
    #tablet-os-overlay .tos-idp-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
    #tablet-os-overlay .tos-idp-name { font-size:14px; color:var(--mg-accent); }
    #tablet-os-overlay .tos-idp-qty { color:color-mix(in srgb, var(--mg-accent) 60%, transparent); font-size:12px; }
    #tablet-os-overlay .tos-idp-x { cursor:pointer; font-size:13px; line-height:1; color:var(--mg-accent); background:transparent; border:1px solid color-mix(in srgb, var(--mg-accent) 45%, transparent); border-radius:4px; padding:3px 8px; }
    #tablet-os-overlay .tos-idp-x:hover { background:color-mix(in srgb, var(--mg-accent) 20%, transparent); border-color:var(--mg-accent); }
    #tablet-os-overlay .tos-idp-desc { font-size:11.5px; line-height:1.45; color:color-mix(in srgb, var(--mg-accent) 72%, transparent); }
    #tablet-os-overlay .tos-idp-stats { display:flex; flex-direction:column; gap:2px; }
    #tablet-os-overlay .tos-idp-stat { display:flex; justify-content:space-between; gap:10px; font-size:11.5px; padding:3px 0; border-top:1px solid color-mix(in srgb, var(--mg-accent) 16%, transparent); }
    #tablet-os-overlay .tos-idp-stat span:first-child { color:color-mix(in srgb, var(--mg-accent) 58%, transparent); text-transform:uppercase; letter-spacing:.5px; font-size:9.5px; align-self:center; }
    #tablet-os-overlay .tos-idp-stat span:last-child { color:var(--mg-accent); text-align:right; }
    #tablet-os-overlay .tos-idp-verbs { display:flex; flex-wrap:wrap; gap:7px; margin-top:2px; }
    #tablet-os-overlay .tos-idp-verb { cursor:pointer; flex:1 1 auto; padding:8px 12px; font-size:11px; letter-spacing:1px; text-transform:uppercase; color:var(--mg-accent);
      background:color-mix(in srgb, var(--mg-accent) 14%, var(--tos-surface-lo)); border:1px solid color-mix(in srgb, var(--mg-accent) 34%, transparent); border-radius:6px; }
    #tablet-os-overlay .tos-idp-verb:hover { filter:brightness(1.15); }
    /* Drop stays monochrome but reads as the "outer" action — hollow, brighter border. */
    #tablet-os-overlay .tos-idp-verb.danger { background:transparent; border-color:color-mix(in srgb, var(--mg-accent) 60%, transparent); }

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
    #tablet-os-overlay .tos-chat-x:hover { color:var(--accent-ink,#fff); border-color:var(--mg-accent); background:color-mix(in srgb, var(--mg-accent) 30%, transparent); }
    #tablet-os-overlay .tos-chat-log { height:320px; max-height:44vh; overflow-y:auto; padding:9px 10px; border-radius:6px;
      background:var(--bg, #0c1114); border:1px solid color-mix(in srgb, var(--mg-accent) 18%, transparent);
      box-shadow:inset 0 1px 3px rgba(0,0,0,0.35); font-size:13px; line-height:1.45; }
    #tablet-os-overlay .tos-chat-log::-webkit-scrollbar { width:6px; }
    #tablet-os-overlay .tos-chat-log::-webkit-scrollbar-thumb { background:var(--border); border-radius:3px; }
    /* MOTD view: the ascii-art <pre> is far wider than the tablet, so hide the
       horizontal overflow and let fitMotd() shrink the <pre> (transform scale,
       top-left origin) to exactly the log's content width. */
    #tablet-os-overlay .tos-motd-log { overflow-x:hidden; }
    #tablet-os-overlay .tos-motd { overflow:hidden; }
    #tablet-os-overlay .tos-motd pre { display:inline-block; margin:0; transform-origin:top left;
      font-family:var(--font-mono); white-space:pre; line-height:1.3; color:var(--tos-fg); }
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
    /* Emoji picker: a ☺ button that opens a grid popup above the input. */
    #tablet-os-overlay .tos-chat-emoji-wrap { position:relative; flex:0 0 auto; }
    #tablet-os-overlay .tos-chat-emoji-btn { cursor:pointer; background:var(--bg, #0c1114); border:1px solid color-mix(in srgb, var(--mg-accent) 28%, transparent);
      color:var(--tos-fg-dim); font-size:16px; line-height:1; padding:7px 9px; border-radius:5px; }
    #tablet-os-overlay .tos-chat-emoji-btn:hover { color:var(--mg-accent); border-color:var(--mg-accent); }
    #tablet-os-overlay .tos-chat-emoji-pop { display:none; position:absolute; bottom:calc(100% + 6px); left:0; z-index:5; width:248px; max-height:184px; overflow-y:auto;
      background:var(--bg, #0c1114); border:1px solid color-mix(in srgb, var(--mg-accent) 40%, transparent); border-radius:6px; padding:6px; box-shadow:0 6px 18px rgba(0,0,0,.5);
      grid-template-columns:repeat(8, 1fr); gap:2px; }
    #tablet-os-overlay .tos-chat-emoji-pop.open { display:grid; }
    #tablet-os-overlay .tos-chat-emoji-pop::-webkit-scrollbar { width:6px; }
    #tablet-os-overlay .tos-chat-emoji-pop::-webkit-scrollbar-thumb { background:var(--border); border-radius:3px; }
    #tablet-os-overlay .tos-chat-emoji { cursor:pointer; text-align:center; font-size:18px; line-height:1; padding:4px 0; border-radius:4px; }
    #tablet-os-overlay .tos-chat-emoji:hover { background:color-mix(in srgb, var(--mg-accent) 22%, transparent); }
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
    #tablet-os-overlay .tos-map-ctl { display:flex; align-items:center; gap:7px; flex-wrap:wrap; margin:6px 0; }
    #tablet-os-overlay .tos-map-zoom { display:inline-flex; margin-left:auto; gap:0; border-radius:6px; overflow:hidden;
      border:1px solid color-mix(in srgb, var(--mg-accent) 40%, transparent); }
    #tablet-os-overlay .tos-mz { cursor:pointer; width:32px; height:30px; font-size:18px; line-height:1; color:var(--mg-accent);
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo)); border:none; border-left:1px solid color-mix(in srgb, var(--mg-accent) 30%, transparent);
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi); }
    #tablet-os-overlay .tos-mz:first-child { border-left:none; }
    #tablet-os-overlay .tos-mz:hover:not(:disabled) { filter:brightness(1.18); }
    #tablet-os-overlay .tos-mz:active:not(:disabled) { transform:translateY(1px); }
    #tablet-os-overlay .tos-mz:disabled { opacity:.35; cursor:default; }
    #tablet-os-overlay .tos-map-wrap { max-height:440px; overflow:auto; scrollbar-width:thin; scrollbar-color:color-mix(in srgb,var(--mg-accent) 40%,transparent) transparent;
      cursor:grab; touch-action:none;
      display:grid; place-content:safe center;
      background:radial-gradient(130% 130% at 50% 40%, color-mix(in srgb, var(--mg-accent) 7%, var(--bg,#030806)) 55%, var(--bg,#01050a) 100%); border:1px solid color-mix(in srgb,var(--mg-accent) 20%,transparent); border-radius:6px; padding:8px; }
    #tablet-os-overlay .tos-map-wrap.grabbing { cursor:grabbing; }
    #tablet-os-overlay .tos-map-wrap::-webkit-scrollbar { width:7px; height:7px; }
    #tablet-os-overlay .tos-map-wrap::-webkit-scrollbar-thumb { background:color-mix(in srgb,var(--mg-accent) 35%,transparent); border-radius:5px; }
    #tablet-os-overlay .tos-map-grid { display:grid; position:relative; --tos-tile:48px; }
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
    /* Perimeter wall (mirrors the sidebar minimap .mm-curtain/.mm-gate/.mm-glacis): the
       Architect's Curtain shimmers, the glacis kill-zone gets a hazard edge, the one gate pulses. */
    #tablet-os-overlay .tos-map-tile.tos-curtain { box-shadow:inset 0 0 0 1px rgba(122,196,255,.5), inset 0 0 4px rgba(122,196,255,.32); }
    #tablet-os-overlay .tos-map-tile.tos-glacis { box-shadow:inset 0 0 0 1px rgba(224,120,90,.5); }
    #tablet-os-overlay .tos-map-tile.tos-gate { color:#d6f4ff; font-weight:bold; z-index:2; animation:tos-gate-pulse 2.4s ease-in-out infinite; }
    @keyframes tos-gate-pulse { 0%,100%{ box-shadow:inset 0 0 0 1px #7fe0ff, 0 0 5px rgba(127,224,255,.55); } 50%{ box-shadow:inset 0 0 0 1px #aef0ff, 0 0 10px rgba(127,224,255,.95); } }
    #tablet-os-overlay .tos-gps-svg { position:absolute; grid-column:1/-1; grid-row:1/-1; width:100%; height:100%; pointer-events:none; z-index:2; }
    #tablet-os-overlay .tos-gps-line { fill:none; stroke:var(--mg-accent); stroke-width:0.18; stroke-linecap:round; stroke-linejoin:round; }
    #tablet-os-overlay .tos-map-tile.dest { outline:2px solid #fff; }
    #tablet-os-overlay .tos-map-tile.sel { outline:2px dashed var(--mg-accent); outline-offset:-2px; z-index:3; }
    #tablet-os-overlay .tos-map-tile.cur { border-color:var(--mg-accent); box-shadow:0 0 9px color-mix(in srgb,var(--mg-accent) 60%,transparent), inset 0 0 0 1px var(--mg-accent); }
    #tablet-os-overlay .tos-map-tile .mt-icon { font-size:16px; line-height:1; }
    /* Edge-to-edge 1:1 tiles render their zone-icon SVG (road connector / building
       rooftop / runway / statue) as a mask filled with the tile's colour, like the
       full map's mm-icon. */
    #tablet-os-overlay .tos-map-tile .mt-svg { width:82%; height:82%; background:currentColor;
      -webkit-mask:var(--zi) center/contain no-repeat; mask:var(--zi) center/contain no-repeat; }
    /* Label mode — a two-letter building code centred on its tile, over a dark
       plate so it reads on any land-use colour. */
    #tablet-os-overlay .tos-map-tile .mt-code { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
      font-size:13px; font-weight:700; letter-spacing:.5px; color:#fff; text-shadow:0 0 3px #000,0 1px 2px #000;
      background:radial-gradient(closest-side, rgba(0,0,0,.55), rgba(0,0,0,.15)); pointer-events:none; z-index:2; }
    #tablet-os-overlay .tos-map-tile .mt-you { position:absolute; top:0; right:2px; font-size:9px; color:var(--mg-accent); text-shadow:0 0 4px #000; }
    #tablet-os-overlay .tos-map-tile .mt-dest { position:absolute; top:0; left:2px; font-size:9px; color:#ffcf4a; text-shadow:0 0 4px #000; }
    /* Journey map — an off-grid "survey terminal" shown in place of the city map when
       out in the void. Reuses the shared .mm-x-* trail markup (crossingInnerHtml) as the
       hero: a big vertical "core sample" of the route, client-zoomable (--tos-void-scale),
       flanked by dead-signal instrument rails (scrambled coords, ground/depth readout,
       live status chips) with a scanning beam + corner brackets to fill the space. */
    #tablet-os-overlay .tos-journey { position:relative; overflow:hidden; min-height:60vh; display:flex; flex-direction:column; --tos-void-scale:1.35; }
    /* Full-panel void backdrop: a faint hot horizon low, ash specks drifting across. */
    #tablet-os-overlay .tos-journey::before { content:''; position:absolute; inset:0; z-index:0; pointer-events:none; opacity:.6;
      background:
        radial-gradient(120% 60% at 50% 118%, color-mix(in srgb, var(--red) 14%, transparent), transparent 70%),
        radial-gradient(1px 1px at 12% 22%, color-mix(in srgb, var(--tos-fg-dim) 55%, transparent) 50%, transparent),
        radial-gradient(1px 1px at 68% 40%, color-mix(in srgb, var(--tos-fg-dim) 45%, transparent) 50%, transparent),
        radial-gradient(1px 1px at 38% 74%, color-mix(in srgb, var(--tos-fg-dim) 40%, transparent) 50%, transparent),
        radial-gradient(1px 1px at 86% 62%, color-mix(in srgb, var(--tos-fg-dim) 48%, transparent) 50%, transparent),
        radial-gradient(1px 1px at 55% 12%, color-mix(in srgb, var(--tos-fg-dim) 42%, transparent) 50%, transparent);
      background-size:100% 100%, 160px 160px, 130px 130px, 190px 190px, 150px 150px, 170px 170px;
      animation:tos-journey-ash 14s linear infinite; }
    @keyframes tos-journey-ash { from{background-position:0 0,0 0,0 0,0 0,0 0,0 0} to{background-position:0 0,-40px 160px,30px 130px,-25px 190px,20px 150px,-15px 170px} }
    [data-motion="off"] #tablet-os-overlay .tos-journey::before { animation:none; }
    #tablet-os-overlay .tos-journey > * { position:relative; z-index:1; }
    #tablet-os-overlay .tos-journey-hdr { display:flex; justify-content:space-between; align-items:center; gap:8px 14px; flex-wrap:wrap; padding:10px 14px; border-bottom:1px solid var(--tos-border); }
    #tablet-os-overlay .tos-journey-hdr-r { display:flex; align-items:center; gap:12px; }
    #tablet-os-overlay .tos-journey-nosig { font-size:12px; letter-spacing:3px; color:var(--red); opacity:.85;
      text-shadow:0 0 8px color-mix(in srgb, var(--red) 45%, transparent); animation:tos-nosig-flicker 2.4s steps(1) infinite; }
    @keyframes tos-nosig-flicker { 0%,92%,100%{opacity:.85} 94%{opacity:.3} 96%{opacity:.85} 98%{opacity:.4} }
    [data-motion="off"] #tablet-os-overlay .tos-journey-nosig { animation:none; }
    #tablet-os-overlay .tos-journey-coord { font-family:var(--font-mono,monospace); font-size:11px; letter-spacing:1.5px; color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-journey-coord b { color:var(--tos-fg); letter-spacing:2px; font-weight:600; }
    /* Void zoom stepper — client-only scale on the trail (no server round trip). */
    #tablet-os-overlay .tos-void-zoom { display:inline-flex; border:1px solid var(--tos-border); border-radius:6px; overflow:hidden; }
    #tablet-os-overlay .tos-vz { font-family:var(--font-mono,monospace); font-size:14px; line-height:1; width:26px; height:24px; border:0; cursor:pointer;
      background:color-mix(in srgb, var(--tos-fg) 6%, transparent); color:var(--tos-fg); }
    #tablet-os-overlay .tos-vz + .tos-vz { border-left:1px solid var(--tos-border); }
    #tablet-os-overlay .tos-vz:hover:not(:disabled) { background:color-mix(in srgb, var(--mg-accent) 22%, transparent); }
    #tablet-os-overlay .tos-vz:disabled { opacity:.32; cursor:default; }
    /* Stage: the route is the hero, centred, flanked by two instrument rails. */
    #tablet-os-overlay .tos-journey-stage { position:relative; flex:1; display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);
      align-items:center; gap:clamp(10px,3vw,36px); padding:20px clamp(12px,3vw,30px); overflow:hidden; }
    /* Faint survey grid + a horizontal scanline crawling up the stage. */
    #tablet-os-overlay .tos-journey-stage::before { content:''; position:absolute; inset:0; z-index:0; pointer-events:none; opacity:.5;
      background:linear-gradient(color-mix(in srgb, var(--tos-fg-dim) 12%, transparent) 1px, transparent 1px),
                linear-gradient(90deg, color-mix(in srgb, var(--tos-fg-dim) 12%, transparent) 1px, transparent 1px);
      background-size:34px 34px, 34px 34px;
      -webkit-mask-image:radial-gradient(80% 70% at 50% 50%, #000, transparent); mask-image:radial-gradient(80% 70% at 50% 50%, #000, transparent); }
    #tablet-os-overlay .tos-journey-stage::after { content:''; position:absolute; left:0; right:0; height:2px; z-index:0; pointer-events:none;
      background:linear-gradient(90deg, transparent, color-mix(in srgb, var(--mg-accent) 55%, transparent), transparent);
      animation:tos-void-scan 6s linear infinite; }
    @keyframes tos-void-scan { from{top:100%} to{top:-2%} }
    [data-motion="off"] #tablet-os-overlay .tos-journey-stage::after { animation:none; opacity:.35; top:50%; }
    #tablet-os-overlay .tos-journey-stage > * { position:relative; z-index:1; }
    /* Corner brackets frame the survey window. */
    #tablet-os-overlay .tos-journey-bracket { position:absolute; width:18px; height:18px; z-index:1; pointer-events:none;
      border:1px solid color-mix(in srgb, var(--mg-accent) 50%, transparent); }
    #tablet-os-overlay .tos-journey-bracket.tl { top:8px; left:8px; border-right:0; border-bottom:0; }
    #tablet-os-overlay .tos-journey-bracket.tr { top:8px; right:8px; border-left:0; border-bottom:0; }
    #tablet-os-overlay .tos-journey-bracket.bl { bottom:8px; left:8px; border-right:0; border-top:0; }
    #tablet-os-overlay .tos-journey-bracket.br { bottom:8px; right:8px; border-left:0; border-top:0; }
    /* The route, blown up. font-size = base × client zoom scale; scrolls when large. */
    #tablet-os-overlay .tos-journey-trailwrap { position:relative; justify-self:center; max-height:52vh; overflow:auto;
      padding:14px clamp(16px,3vw,40px); border-left:1px solid color-mix(in srgb, var(--tos-fg-dim) 22%, transparent);
      border-right:1px solid color-mix(in srgb, var(--tos-fg-dim) 22%, transparent);
      background:linear-gradient(color-mix(in srgb, var(--mg-accent) 5%, transparent), transparent); }
    #tablet-os-overlay .tos-journey-trail { font-size:calc(clamp(28px,6.5vw,50px) * var(--tos-void-scale,1)); padding:8px 0; transition:font-size .18s ease; }
    /* A soft beam sweeping down the core sample. */
    #tablet-os-overlay .tos-journey-sweep { position:absolute; inset:0; z-index:0; pointer-events:none; overflow:hidden; }
    #tablet-os-overlay .tos-journey-sweep::before { content:''; position:absolute; left:0; right:0; height:40%;
      background:linear-gradient(color-mix(in srgb, var(--mg-accent) 20%, transparent), transparent);
      animation:tos-void-sweep 4.5s ease-in-out infinite; }
    @keyframes tos-void-sweep { 0%{top:-40%} 100%{top:100%} }
    [data-motion="off"] #tablet-os-overlay .tos-journey-sweep { display:none; }
    #tablet-os-overlay .tos-journey-trailwrap > .mm-crossing { position:relative; z-index:1; }
    /* Rails flanking the trail. */
    #tablet-os-overlay .tos-journey-rail { display:flex; flex-direction:column; gap:12px; }
    #tablet-os-overlay .tos-journey-rail.left { align-items:flex-end; text-align:right; }
    #tablet-os-overlay .tos-journey-rail.right { align-items:flex-start; }
    #tablet-os-overlay .tos-journey-readout { font-family:var(--font-mono,monospace); display:flex; flex-direction:column; gap:2px; }
    #tablet-os-overlay .tos-journey-readout span { font-size:9px; letter-spacing:2px; color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-journey-readout b { font-size:13px; letter-spacing:1px; color:var(--tos-fg); font-weight:600; }
    #tablet-os-overlay .tos-journey-readout b.nofix { color:var(--red); opacity:.85; }
    #tablet-os-overlay .tos-journey-chips { display:flex; flex-direction:column; gap:6px; }
    #tablet-os-overlay .tos-journey-quiet { font-family:var(--font-mono,monospace); font-size:9px; letter-spacing:2px; color:var(--tos-fg-dim); opacity:.7; }
    @media (max-width:640px) {
      #tablet-os-overlay .tos-journey-stage { grid-template-columns:1fr; justify-items:center; gap:16px; }
      #tablet-os-overlay .tos-journey-rail, #tablet-os-overlay .tos-journey-rail.left { align-items:center; text-align:center; flex-direction:row; flex-wrap:wrap; justify-content:center; }
    }
    #tablet-os-overlay .tos-jchip { font-family:var(--font-mono,monospace); font-size:9px; letter-spacing:1px; padding:3px 8px; border-radius:4px; border:1px solid var(--tos-border); color:var(--tos-fg-dim); white-space:nowrap; }
    #tablet-os-overlay .tos-jchip.hazard { color:var(--red); border-color:color-mix(in srgb, var(--red) 55%, transparent); background:color-mix(in srgb, var(--red) 12%, transparent); }
    #tablet-os-overlay .tos-jchip.dead { color:var(--red); border-color:color-mix(in srgb, var(--red) 45%, transparent); }
    #tablet-os-overlay .tos-jchip.gate { color:var(--green); border-color:color-mix(in srgb, var(--green) 50%, transparent); background:color-mix(in srgb, var(--green) 10%, transparent); }
    #tablet-os-overlay .tos-journey-hint { font-size:12px; font-style:italic; color:var(--tos-fg-dim); text-align:center; padding:10px 14px 20px; }
    /* Tileable terrain: drop the border/rounding so water & parkland read as one
       expanse, and lay a subtle connecting texture (one period per tile). Fill colour
       is set inline (grey asphalt for roads, authored blue/green for water/grass). */
    #tablet-os-overlay .tos-map-tile.terr { border-radius:0; border-color:transparent; }
    #tablet-os-overlay .tos-map-tile.terr-water, #tablet-os-overlay .tos-map-tile.terr-grass, #tablet-os-overlay .tos-map-tile.terr-dock,
    #tablet-os-overlay .tos-map-tile.terr-scrub, #tablet-os-overlay .tos-map-tile.terr-redrock, #tablet-os-overlay .tos-map-tile.terr-ash, #tablet-os-overlay .tos-map-tile.terr-marsh { background-repeat:no-repeat; background-size:100% 100%; }
    #tablet-os-overlay .tos-map-tile.terr-water { background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><g fill='none' stroke='%23ffffff' stroke-opacity='0.30' stroke-width='1.1' stroke-linecap='round'><path d='M0 7q6 -3 12 0t12 0'/><path d='M0 14q6 -3 12 0t12 0'/><path d='M0 21q6 -3 12 0t12 0'/></g></svg>"); }
    #tablet-os-overlay .tos-map-tile.terr-grass { background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><g fill='none' stroke='%237fc95a' stroke-opacity='0.40' stroke-width='1' stroke-linecap='round'><path d='M4 21v-5'/><path d='M9 22v-6'/><path d='M14 21v-5'/><path d='M19 22v-6'/><path d='M6 13v-4'/><path d='M12 12v-4'/><path d='M18 13v-4'/></g></svg>"); }
    #tablet-os-overlay .tos-map-tile.terr-dock { background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><g fill='none' stroke='%233b2c19' stroke-opacity='0.55' stroke-width='1'><path d='M0 6h24M0 12h24M0 18h24'/><path d='M8 0v6M16 6v6M8 12v6M16 18v6'/></g><g fill='none' stroke='%23987444' stroke-opacity='0.30' stroke-width='0.6'><path d='M0 3h24M0 9h24M0 15h24M0 21h24'/></g></svg>"); }
    /* Wildlands surfaces — mirror the sidebar minimap (.mm-*/.map-*) so the tablet reads the same. */
    #tablet-os-overlay .tos-map-tile.terr-scrub { background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><g fill='none' stroke='%23b5b06a' stroke-opacity='0.45' stroke-width='0.9' stroke-linecap='round'><path d='M5 20l-1.5-4M5 20l1.5-4M5 20v-5'/><path d='M17 22l-1.5-4M17 22l1.5-4M17 22v-5'/><path d='M11 14l-1-3M11 14l1-3'/></g><g fill='%23807a40' fill-opacity='0.4'><circle cx='9' cy='20' r='0.9'/><circle cx='20' cy='11' r='0.8'/><circle cx='3' cy='8' r='0.7'/></g></svg>"); }
    #tablet-os-overlay .tos-map-tile.terr-redrock { background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><g fill='none' stroke='%23431c10' stroke-opacity='0.42' stroke-width='0.9'><path d='M0 9l7 3 6-4 5 4 6-2'/><path d='M4 24l3-8 6 2 4-6'/></g><g fill='%233a170c' fill-opacity='0.45'><circle cx='3' cy='19' r='1.2'/><circle cx='15' cy='7' r='1'/><circle cx='20' cy='18' r='0.9'/><circle cx='9' cy='4' r='0.7'/><circle cx='22' cy='3' r='0.6'/></g></svg>"); }
    #tablet-os-overlay .tos-map-tile.terr-ash { background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><g fill='%23cfcac4' fill-opacity='0.35'><circle cx='4' cy='6' r='0.8'/><circle cx='12' cy='10' r='0.7'/><circle cx='19' cy='5' r='0.9'/><circle cx='8' cy='17' r='0.7'/><circle cx='16' cy='19' r='0.8'/><circle cx='21' cy='14' r='0.6'/></g><path d='M2 21q6 -3 11 0t9 -1' fill='none' stroke='%23b8b2ac' stroke-opacity='0.2' stroke-width='0.8'/></svg>"); }
    #tablet-os-overlay .tos-map-tile.terr-marsh { background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><g fill='none' stroke='%23aeca7e' stroke-opacity='0.28' stroke-width='1' stroke-linecap='round'><path d='M0 8q6 -3 12 0t12 0'/><path d='M0 16q6 -3 12 0t12 0'/></g><g fill='none' stroke='%236f8a3e' stroke-opacity='0.5' stroke-width='0.9' stroke-linecap='round'><path d='M7 20v-7M9 20l-1-6'/><path d='M18 21v-8'/></g></svg>"); }
    /* Edge-line door style — hairline per side of an interior room: green open, red wall. */
    #tablet-os-overlay .tos-map-tile .tos-edge { position:absolute; z-index:4; pointer-events:none; border-radius:1px; }
    #tablet-os-overlay .tos-map-tile .tos-edge.open { background:#3fd07a; }
    #tablet-os-overlay .tos-map-tile .tos-edge.shut { background:#d0453f; opacity:0.55; }
    #tablet-os-overlay .tos-map-tile .tos-edge-north { top:0; left:20%; right:20%; height:2px; }
    #tablet-os-overlay .tos-map-tile .tos-edge-south { bottom:0; left:20%; right:20%; height:2px; }
    #tablet-os-overlay .tos-map-tile .tos-edge-east { right:0; top:20%; bottom:20%; width:2px; }
    #tablet-os-overlay .tos-map-tile .tos-edge-west { left:0; top:20%; bottom:20%; width:2px; }
    #tablet-os-overlay .tos-map-link { display:flex; align-items:center; justify-content:center; color:color-mix(in srgb,var(--mg-accent) 40%,transparent); font-size:12px; line-height:1; pointer-events:none; }
    #tablet-os-overlay .tos-map-link.art { color:#c9a24a; font-weight:bold; text-shadow:0 0 6px rgba(201,162,74,.55); }
    #tablet-os-overlay .tos-map-legend { display:flex; flex-wrap:wrap; gap:5px 12px; margin:9px 0 4px; font-size:10px; color:var(--tos-fg-dim); }
    /* Building-name legend — clickable chips tied to their map tiles. */
    #tablet-os-overlay .tos-map-bldgs { margin:8px 0 2px; }
    #tablet-os-overlay .tos-map-bldgs-t { font-size:10px; text-transform:uppercase; letter-spacing:.6px; color:var(--tos-fg-dim); opacity:.8; margin-bottom:5px; }
    #tablet-os-overlay .tos-map-bldgs-list { display:flex; flex-wrap:wrap; gap:5px 6px; }
    #tablet-os-overlay .tos-map-bldg { cursor:pointer; font-size:11px; padding:3px 8px; border-radius:11px; color:var(--tos-fg-dim); transition:filter .12s;
      background:color-mix(in srgb,var(--mg-accent) 8%,transparent); border:1px solid color-mix(in srgb,var(--mg-accent) 22%,transparent); }
    #tablet-os-overlay .tos-map-bldg:hover { filter:brightness(1.25); }
    #tablet-os-overlay .tos-map-bldg.sel { color:#04120f; background:var(--mg-accent); border-color:var(--mg-accent); box-shadow:0 0 8px color-mix(in srgb,var(--mg-accent) 45%,transparent); }
    #tablet-os-overlay .tos-map-detail { margin-top:6px; border-top:1px solid color-mix(in srgb,var(--mg-accent) 16%,transparent); padding-top:8px; }
    #tablet-os-overlay .tos-map-note { font-size:11.5px; color:var(--tos-fg-dim); line-height:1.5; padding:6px 2px; }
    /* Map app fills the screen so the panel itself never scrolls: the body is a
       flex column pinned to 100% height, the map + rail take the slack, and all
       scrolling/panning happens inside them (drag = pan the map, not the page). */
    #tablet-os-overlay .tos-body.tos-map-view { box-sizing:border-box; height:100%; display:flex; flex-direction:column; }
    #tablet-os-overlay .tos-map-view #tos-map-root { flex:1; min-height:0; display:flex; flex-direction:column; }
    /* Map ↔ legend rail, side by side, filling the remaining height. */
    #tablet-os-overlay .tos-map-main { flex:1; min-height:0; display:flex; gap:9px; margin-top:2px; }
    #tablet-os-overlay .tos-map-main .tos-map-wrap { flex:1 1 auto; min-width:0; max-height:none; }
    /* Right rail: legend pinned at the top, buildings + detail scroll beneath it. */
    #tablet-os-overlay .tos-map-side { flex:0 0 158px; display:flex; flex-direction:column; min-height:0; }
    #tablet-os-overlay .tos-map-side .tos-map-legend { flex:0 0 auto; flex-direction:column; gap:4px; margin:0 0 8px; }
    #tablet-os-overlay .tos-map-side-scroll { flex:1; min-height:0; overflow-y:auto; scrollbar-width:thin;
      scrollbar-color:color-mix(in srgb,var(--mg-accent) 40%,transparent) transparent; }
    #tablet-os-overlay .tos-map-side-scroll::-webkit-scrollbar { width:6px; }
    #tablet-os-overlay .tos-map-side-scroll::-webkit-scrollbar-thumb { background:color-mix(in srgb,var(--mg-accent) 35%,transparent); border-radius:5px; }
    #tablet-os-overlay .tos-map-side .tos-map-bldgs { margin-top:0; }
    #tablet-os-overlay .tos-map-side .tos-map-bldgs-list { gap:5px; }
    #tablet-os-overlay .tos-map-side .tos-map-bldg { width:100%; }
    /* Mobile: stack the rail under the map so the map gets the full panel width
       (a fixed side rail pinches the map to ~half on a phone). The rail becomes a
       short, self-scrolling strip beneath the map; buildings wrap horizontally. */
    html[data-density="compact"] #tablet-os-overlay .tos-map-main { flex-direction:column; gap:6px; }
    html[data-density="compact"] #tablet-os-overlay .tos-map-side { flex:0 0 auto; max-height:34%; }
    html[data-density="compact"] #tablet-os-overlay .tos-map-side .tos-map-bldgs-list { flex-direction:row; }
    html[data-density="compact"] #tablet-os-overlay .tos-map-side .tos-map-bldg { width:auto; }

    /* ── Accolades app — your permanent file ───────────────────────────────────────
       Surfaces ride the shared --tos-surface bevel tokens, so the app follows
       every theme without a palette of its own. Entry copy is 13.5px roman, NOT
       italic: Courier has no true italic and the browser's synthetic oblique
       smears badly at small sizes, which is what made the first pass unreadable. */
    /* B.L.I.S.S. — deliberately cold and catalogue-like. Monochrome like the rest
       of the tablet; the only warmth in the whole app is the ♡ on its tile. */
    #tablet-os-overlay .tos-bliss-head { display:flex; align-items:flex-end; justify-content:space-between;
      gap:12px; padding-bottom:8px; border-bottom:1px solid var(--tos-line); margin-bottom:10px; }
    #tablet-os-overlay .tos-bliss-app { font-size:1.35em; letter-spacing:.18em; font-weight:700; }
    #tablet-os-overlay .tos-bliss-expand { font-size:.78em; opacity:.75; letter-spacing:.04em; margin-top:2px; }
    #tablet-os-overlay .tos-bliss-sub { font-size:.85em; opacity:.87; white-space:nowrap; }
    #tablet-os-overlay .tos-bliss-strap { font-size:.78em; opacity:.72; font-style:italic; margin-bottom:10px; }
    #tablet-os-overlay .tos-bliss-notice { font-size:.85em; padding:7px 9px; margin-bottom:10px;
      border:1px solid var(--tos-line); background:rgba(255,255,255,.04); }
    #tablet-os-overlay .tos-bliss-grid { display:flex; flex-direction:column; gap:9px; }
    #tablet-os-overlay .tos-bliss-card { border:1px solid var(--tos-line); padding:9px 11px; cursor:pointer; }
    #tablet-os-overlay .tos-bliss-card:hover { background:rgba(255,255,255,.05); }
    #tablet-os-overlay .tos-bliss-who + .tos-bliss-who { margin-top:8px; padding-top:8px;
      border-top:1px dashed var(--tos-line); }
    #tablet-os-overlay .tos-bliss-name { font-weight:700; letter-spacing:.05em; }
    #tablet-os-overlay .tos-bliss-name .sex { opacity:.72; font-weight:400; margin-left:3px; }
    #tablet-os-overlay .tos-bliss-name .dim,
    #tablet-os-overlay .tos-bliss-card .dim,
    #tablet-os-overlay .tos-actions .dim { opacity:.72; font-weight:400; font-size:.85em; }
    #tablet-os-overlay .tos-bliss-says { font-size:.86em; opacity:.95; font-style:italic; margin-top:2px; }
    #tablet-os-overlay .tos-bliss-phys { font-size:.8em; opacity:.75; margin-top:3px; }
    #tablet-os-overlay .tos-bliss-note { font-size:.78em; opacity:.75; margin-top:4px; }
    #tablet-os-overlay .tos-bliss-rate { text-align:right; margin-top:6px; font-size:.85em; }
    #tablet-os-overlay .tos-bliss-pairtag { font-size:.74em; letter-spacing:.14em; text-transform:uppercase;
      opacity:.87; margin-bottom:5px; }
    #tablet-os-overlay .tos-bliss-pairbox { border:1px solid var(--tos-line); padding:9px 11px; margin-bottom:10px;
      font-size:.86em; background:rgba(255,255,255,.03); }
    #tablet-os-overlay .tos-bliss-detailwho { border:1px solid var(--tos-line); padding:9px 11px; }
    #tablet-os-overlay .tos-bliss-spec { width:100%; border-collapse:collapse; margin-top:7px; font-size:.8em; }
    #tablet-os-overlay .tos-bliss-spec th { text-align:left; opacity:.72; font-weight:400; width:5.5em;
      vertical-align:top; padding:2px 8px 2px 0; }
    #tablet-os-overlay .tos-bliss-spec td { padding:2px 0; opacity:.95; }
    #tablet-os-overlay .tos-bliss-proj { width:100%; border-collapse:collapse; font-size:.76em; margin-top:6px; }
    #tablet-os-overlay .tos-bliss-proj th { text-align:left; opacity:.72; font-weight:400; padding:3px 0;
      border-bottom:1px solid var(--tos-line); }
    #tablet-os-overlay .tos-bliss-proj td { padding:3px 0; opacity:.95; }
    #tablet-os-overlay .tos-bliss-secthead { font-size:.7em; letter-spacing:.16em; text-transform:uppercase;
      opacity:.78; margin:14px 0 4px; }
    #tablet-os-overlay .tos-bliss-housetag { font-size:.68em; letter-spacing:.14em; text-transform:uppercase;
      padding:2px 6px; margin-left:6px; border:1px solid var(--tos-line); border-radius:10px;
      color:var(--mg-accent); vertical-align:1px; }
    #tablet-os-overlay .tos-bliss-held.house { border-left:2px solid var(--mg-accent); padding-left:9px; }
    #tablet-os-overlay .tos-bliss-blocked { font-size:.85em; opacity:.84; padding:10px; border:1px dashed var(--tos-line); }
    #tablet-os-overlay .tos-bliss-held { border:1px solid var(--tos-line); padding:9px 11px; }
    #tablet-os-overlay .tos-bliss-heldline { display:flex; justify-content:space-between; gap:10px;
      font-size:.8em; opacity:.85; margin-top:3px; }
    #tablet-os-overlay .tos-bliss-heldline .save { opacity:.6; }
    #tablet-os-overlay .tos-bliss-warn { font-size:.75em; color:var(--yellow); margin-top:5px; }

    /* ── Vitals app ──────────────────────────────────────────────────────────
       Bars first, words second. The four bands are the only colour vocabulary
       in the app; everything (meters, drug load, affliction rails) reuses them,
       so "red" always means the same thing wherever it appears on the screen. */
    #tablet-os-overlay .tos-vt-sect { font-size:10.5px; letter-spacing:1.8px; text-transform:uppercase;
      color:var(--tos-fg-dim); font-weight:bold; margin:14px 0 7px; }
    #tablet-os-overlay .tos-vt-sect:first-child { margin-top:4px; }
    #tablet-os-overlay .tos-vt-notice { font-size:12.5px; color:var(--tos-fg); font-weight:bold; line-height:1.5;
      border:1px solid var(--border); border-left:3px solid var(--mg-accent); padding:9px 11px; margin-bottom:12px;
      background:var(--tos-surface-lo); white-space:pre-line; }
    #tablet-os-overlay .tos-vt-meters { display:grid; grid-template-columns:repeat(auto-fit,minmax(165px,1fr)); gap:11px 16px; }
    /* Word readouts (hunger/thirst) — a phrase, not a track. Same label idiom as a
       meter so they read as part of the same instrument, with no bar to play. */
    #tablet-os-overlay .tos-vt-readouts { display:grid; grid-template-columns:repeat(auto-fit,minmax(165px,1fr));
      gap:9px 16px; margin-top:12px; }
    #tablet-os-overlay .tos-vt-readout { display:flex; flex-direction:column; gap:2px; min-width:0; }
    #tablet-os-overlay .tos-vt-rlbl { font-size:8.5px; letter-spacing:1.4px; text-transform:uppercase; color:var(--tos-fg-dim2); }
    #tablet-os-overlay .tos-vt-rval { font-size:12.5px; color:var(--tos-fg); line-height:1.35; }
    #tablet-os-overlay .tos-vt-rval.warn { color:var(--yellow, #d8c23f); }
    #tablet-os-overlay .tos-vt-rval.bad { color:var(--orange, #e08a3a); }
    #tablet-os-overlay .tos-vt-rval.crit { color:var(--red, #e0413a); font-weight:bold; }
    /* Vitals tab: body column beside the readings column. The doll is tall and
       narrow, the meters short and wide — stacked, the doll wasted a panel-wide
       strip of empty box and shoved the numbers off screen. */
    #tablet-os-overlay .tos-vt-cols { display:grid; grid-template-columns:minmax(150px,0.75fr) minmax(0,2fr);
      gap:0 18px; align-items:start; }
    #tablet-os-overlay .tos-vt-cols .tos-vt-sect:first-child { margin-top:4px; }
    /* In-column the doll stacks: figure, then its detail line under it. */
    #tablet-os-overlay .tos-vt-cols .tos-vt-doll { flex-direction:column; align-items:center; gap:9px;
      padding:12px 10px; }
    #tablet-os-overlay .tos-vt-cols .tos-vt-dollstage { width:100%; max-width:158px; }
    #tablet-os-overlay .tos-vt-cols .tos-vt-dolldet { flex:0 0 auto; width:100%; text-align:center; font-size:11.5px; }
    @media (max-width:620px) {
      #tablet-os-overlay .tos-vt-cols { grid-template-columns:minmax(0,1fr); gap:0; }
      #tablet-os-overlay .tos-vt-cols .tos-vt-doll { flex-direction:row; align-items:center; gap:16px; padding:6px 4px 10px; }
      #tablet-os-overlay .tos-vt-cols .tos-vt-dollstage { width:104px; }
      #tablet-os-overlay .tos-vt-cols .tos-vt-dolldet { flex:1 1 auto; text-align:left; }
    }
    #tablet-os-overlay .tos-vt-mlbl { display:flex; justify-content:space-between; align-items:baseline; gap:8px;
      font-size:10.5px; letter-spacing:1.6px; text-transform:uppercase; color:var(--tos-fg-dim); font-weight:bold; margin-bottom:5px; }
    #tablet-os-overlay .tos-vt-mlbl .v { letter-spacing:.6px; text-transform:none; font-variant-numeric:tabular-nums;
      white-space:nowrap; opacity:.9; }
    #tablet-os-overlay .tos-vt-track { height:10px; position:relative; overflow:hidden; background:var(--tos-surface-lo);
      border:1px solid var(--border); box-shadow:inset 0 1px 3px var(--tos-bevel-lo); }
    #tablet-os-overlay .tos-vt-track.sm { height:7px; margin-top:8px; }
    #tablet-os-overlay .tos-vt-fill { position:absolute; left:0; top:0; bottom:0; transition:width .2s linear; }
    #tablet-os-overlay .tos-vt-fill.good { background:linear-gradient(180deg,#8fe39a,#4fae63); box-shadow:0 0 9px rgba(79,174,99,.5); }
    #tablet-os-overlay .tos-vt-fill.warn { background:linear-gradient(180deg,#f4dd8a,#d3a72e); box-shadow:0 0 9px rgba(211,167,46,.45); }
    #tablet-os-overlay .tos-vt-fill.bad  { background:linear-gradient(180deg,#f0a870,#d16a25); box-shadow:0 0 9px rgba(209,106,37,.45); }
    #tablet-os-overlay .tos-vt-fill.crit { background:linear-gradient(180deg,#f08c8c,#c0342e); box-shadow:0 0 11px rgba(192,52,46,.6); }
    #tablet-os-overlay .tos-vt-quickbar { margin-bottom:4px; }
    #tablet-os-overlay .tos-vt-quickrow { display:flex; flex-wrap:wrap; gap:8px; }
    #tablet-os-overlay .tos-vt-quick { display:flex; flex-direction:column; align-items:flex-start; gap:3px;
      padding:8px 13px; cursor:pointer; font:inherit; text-align:left;
      background:linear-gradient(180deg, var(--tos-surface-hi), var(--tos-surface-lo));
      border:1px solid var(--border); border-left:3px solid var(--mg-accent); color:var(--tos-fg);
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi), inset 0 -2px 4px var(--tos-bevel-lo); }
    #tablet-os-overlay .tos-vt-quick:hover { border-color:var(--mg-accent); }
    #tablet-os-overlay .tos-vt-quick .act { font-size:13px; font-weight:bold; letter-spacing:.4px; }
    #tablet-os-overlay .tos-vt-quick .itm { font-size:10.5px; letter-spacing:1.2px; color:var(--tos-fg-dim); font-weight:bold; }
    #tablet-os-overlay .tos-vt-affs { display:flex; flex-direction:column; gap:7px; }
    #tablet-os-overlay .tos-vt-aff { position:relative; padding:8px 11px 8px 14px; border:1px solid var(--border);
      background:linear-gradient(180deg, var(--tos-surface-hi), var(--tos-surface-lo));
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi); }
    #tablet-os-overlay .tos-vt-aff::before { content:''; position:absolute; left:0; top:0; bottom:0; width:3px; background:#d3a72e; }
    #tablet-os-overlay .tos-vt-aff.good::before { background:#4fae63; }
    #tablet-os-overlay .tos-vt-aff.bad::before  { background:#c0342e; }
    #tablet-os-overlay .tos-vt-aff.drug::before { background:#8f6fd0; }
    #tablet-os-overlay .tos-vt-affname { font-size:13px; color:var(--tos-fg); font-weight:bold; letter-spacing:.3px; }
    #tablet-os-overlay .tos-vt-affdet { font-size:11.5px; color:var(--tos-fg-dim); font-weight:bold; margin-top:3px; line-height:1.5; }
    /* Paper doll. The figure is deliberately crude — it is a diagnostic readout
       on a cheap medical suite, not an anatomy plate. Colour carries everything. */
    #tablet-os-overlay .tos-vt-doll { display:flex; align-items:center; gap:16px; padding:6px 4px 10px;
      border:1px solid var(--border); background:var(--tos-surface-lo); margin-bottom:10px; }
    #tablet-os-overlay .tos-vt-dollsvg { width:104px; height:auto; flex:0 0 auto; overflow:visible; }
    /* The scan ghost: the same two alpha masks the Gear and wardrobe dolls use,
       so one character is one body across all three screens. Sits behind the
       schematic at low opacity and never takes a pointer event, so every part
       stays clickable exactly as before. */
    /* ── Alarm ──
       Everything here is drawn from tokens the OS already defines — --tos-fg,
       --tos-surface-hi, --mg-accent, --border — so the clock changes colour with
       the tablet theme instead of pinning its own. The only bespoke thing is the
       shape: a readout, two reels, and a selection band across them. */
    #tablet-os-overlay .tos-alarm { padding:4px 6px 12px; }
    #tablet-os-overlay .tos-al-face { text-align:center; padding:6px 0 10px; }
    #tablet-os-overlay .tos-al-now { font-family:var(--font-mono,monospace); font-size:44px; line-height:1;
      letter-spacing:3px; color:var(--tos-fg); text-shadow:0 0 18px color-mix(in srgb, var(--mg-accent) 55%, transparent); }
    #tablet-os-overlay .tos-al-nowlab { font-size:9px; letter-spacing:2px; text-transform:uppercase;
      color:var(--tos-fg-dim,var(--text-dim)); margin-top:3px; }

    /* The setter. Fixed height with the band pinned across the middle — the reels
       scroll UNDER it, which is the whole illusion. */
    /* Police Blotter — newsprint incident column. Warrants read hotter than
       incidents because one is a live problem and the other is a closed one. */
    #tablet-os-overlay .tos-blotter { display:flex; flex-direction:column; gap:0; }
    #tablet-os-overlay .tos-blot-row { display:flex; align-items:baseline; gap:7px;
      padding:5px 2px; border-bottom:1px dotted var(--border); font-size:12px; line-height:1.45; }
    #tablet-os-overlay .tos-blot-row:last-child { border-bottom:none; }
    #tablet-os-overlay .tos-blot-body { flex:1; }
    #tablet-os-overlay .tos-blot-mark { color:var(--tos-fg-dim,var(--text-dim)); opacity:.7; }
    #tablet-os-overlay .tos-blot-when { font-size:10px; color:var(--tos-fg-dim,var(--text-dim)); opacity:.75; flex:0 0 auto; }
    #tablet-os-overlay .tos-blot-row.warrant { background:rgba(255,59,92,0.06); }
    #tablet-os-overlay .tos-blot-stars { color:var(--red,#ff3b5c); letter-spacing:1px; flex:0 0 auto; }
    #tablet-os-overlay .tos-blot-quiet { padding:12px 4px; font-style:italic;
      color:var(--tos-fg-dim,var(--text-dim)); }
    #tablet-os-overlay .tos-al-setter { position:relative; display:flex; align-items:stretch; justify-content:center;
      gap:4px; height:132px; margin:2px 0 8px;
      background:linear-gradient(180deg, rgba(0,0,0,0.34), rgba(0,0,0,0.08) 30%, rgba(0,0,0,0.08) 70%, rgba(0,0,0,0.34));
      border:1px solid var(--border); border-radius:8px; overflow:hidden; }
    #tablet-os-overlay .tos-al-band { position:absolute; left:6px; right:6px; top:50%; height:38px;
      transform:translateY(-50%); border-top:1px solid color-mix(in srgb, var(--mg-accent) 60%, transparent);
      border-bottom:1px solid color-mix(in srgb, var(--mg-accent) 60%, transparent);
      background:color-mix(in srgb, var(--mg-accent) 10%, transparent); pointer-events:none; z-index:2; }
    #tablet-os-overlay .tos-al-reel { flex:0 0 78px; overflow-y:auto; scroll-snap-type:y mandatory;
      scrollbar-width:none; -ms-overflow-style:none; cursor:grab;
      /* A mouse drag scrubs the reel (see the pointer handlers) — tell the browser
         not to also start a text selection or a native pan from the same gesture. */
      touch-action:pan-y; }
    #tablet-os-overlay .tos-al-reel::-webkit-scrollbar { display:none; }
    /* While a drag is live the snap has to come OFF, or every scrollTop we write is
       yanked back to the nearest cell and the band judders instead of tracking the
       hand. It goes back on at pointerup, which is what lands the reel on a value. */
    #tablet-os-overlay .tos-al-reel.dragging { scroll-snap-type:none; cursor:grabbing;
      scroll-behavior:auto; }
    #tablet-os-overlay .tos-al-reel.dragging .tos-al-cell { cursor:grabbing; transition:none; }
    #tablet-os-overlay .tos-al-pad { height:47px; }
    #tablet-os-overlay .tos-al-cell { height:38px; line-height:38px; text-align:center; scroll-snap-align:center;
      font-family:var(--font-mono,monospace); font-size:26px; letter-spacing:2px;
      color:var(--tos-fg-dim,var(--text-dim)); opacity:0.45; cursor:pointer; user-select:none;
      transition:opacity 0.12s ease, color 0.12s ease, text-shadow 0.12s ease; }
    #tablet-os-overlay .tos-al-cell:hover { opacity:0.8; }
    #tablet-os-overlay .tos-al-cell.sel { opacity:1; color:var(--tos-fg);
      text-shadow:0 0 14px color-mix(in srgb, var(--mg-accent) 60%, transparent); }
    #tablet-os-overlay .tos-al-cell:focus { outline:none; }
    #tablet-os-overlay .tos-al-colon { align-self:center; font-family:var(--font-mono,monospace); font-size:26px;
      color:var(--tos-fg); opacity:0.7; z-index:3; }

    #tablet-os-overlay .tos-al-preview { text-align:center; font-size:12px; color:var(--tos-fg-dim,var(--text-dim)); }
    #tablet-os-overlay .tos-al-preview b { font-family:var(--font-mono,monospace); font-size:15px; color:var(--tos-fg); }
    #tablet-os-overlay .tos-al-btns { display:flex; gap:8px; justify-content:center; margin:10px 0 6px; }
    #tablet-os-overlay .tos-al-status { text-align:center; font-size:11px; color:var(--tos-fg); opacity:0.85; }
    #tablet-os-overlay .tos-al-status-off { opacity:0.55; }
    #tablet-os-overlay .tos-al-note { margin-top:8px; text-align:center; font-size:10px; line-height:1.5;
      color:var(--tos-fg-dim,var(--text-dim)); opacity:0.6; }
    @media (prefers-reduced-motion: reduce) {
      #tablet-os-overlay .tos-al-cell { transition:none; }
    }
    #tablet-os-overlay .tos-vt-dollstage { position:relative; flex:0 0 auto; width:104px; }
    #tablet-os-overlay .tos-vt-dollstage .tos-vt-dollsvg { position:relative; z-index:1; width:100%; display:block; }
    #tablet-os-overlay .tos-vt-dollsil { position:absolute; inset:0; opacity:0.16; pointer-events:none;
      background:var(--tos-fg);
      -webkit-mask:url('/assets/paperdoll-mask.png') center / contain no-repeat;
      mask:url('/assets/paperdoll-mask.png') center / contain no-repeat; }
    #tablet-os-overlay .tos-vt-sil-female .tos-vt-dollsil {
      -webkit-mask-image:url('/assets/femsil-mask.png'); mask-image:url('/assets/femsil-mask.png'); }
    #tablet-os-overlay .tos-vt-doll-part { cursor:pointer; }
    #tablet-os-overlay .tos-vt-doll-part > * { fill:var(--tos-surface-hi); stroke:var(--border); stroke-width:1.2;
      transition:fill .18s linear, filter .18s linear; }
    #tablet-os-overlay .tos-vt-doll-part.warn > * { fill:#d3a72e; stroke:#f4dd8a; }
    #tablet-os-overlay .tos-vt-doll-part.bad  > * { fill:#d16a25; stroke:#f0a870; }
    #tablet-os-overlay .tos-vt-doll-part.crit > * { fill:#c0342e; stroke:#f08c8c;
      filter:drop-shadow(0 0 5px rgba(192,52,46,.75)); }
    /* Only a Maimed part pulses. If everything moves, nothing reads as urgent. */
    #tablet-os-overlay .tos-vt-doll-part.crit { animation:tos-doll-pulse 1.9s ease-in-out infinite; }
    @keyframes tos-doll-pulse { 0%,100% { opacity:1; } 50% { opacity:.62; } }
    #tablet-os-overlay .tos-vt-doll-part.sel > * { stroke:var(--tos-fg); stroke-width:2.2; }
    #tablet-os-overlay .tos-vt-doll-part:focus { outline:none; }
    #tablet-os-overlay .tos-vt-doll-part:focus > * { stroke:var(--tos-fg); stroke-width:2.2; }
    #tablet-os-overlay .tos-vt-dolldet { flex:1 1 auto; min-width:0; font-size:12px; font-weight:bold;
      line-height:1.6; color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-vt-clear { padding:26px 8px; text-align:center; font-size:14px; color:var(--tos-fg);
      font-weight:bold; line-height:1.8; }
    #tablet-os-overlay .tos-vt-clear span { color:var(--tos-fg-dim); font-size:12.5px; }
    #tablet-os-overlay .tos-vt-item { display:flex; align-items:center; justify-content:space-between; gap:12px;
      padding:9px 11px; margin-bottom:7px; border:1px solid var(--border);
      background:linear-gradient(180deg, var(--tos-surface-hi), var(--tos-surface-lo));
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi); }
    #tablet-os-overlay .tos-vt-itemtxt { min-width:0; }
    #tablet-os-overlay .tos-vt-itemname { font-size:13.5px; color:var(--tos-fg); font-weight:bold; letter-spacing:.3px; }
    #tablet-os-overlay .tos-vt-itemname .qty { color:var(--tos-fg-dim); margin-left:6px; font-size:11.5px; }
    #tablet-os-overlay .tos-vt-itemeff { font-size:11.5px; color:var(--tos-fg-dim); font-weight:bold; margin-top:3px; line-height:1.5; }
    #tablet-os-overlay .tos-vt-flag { display:inline-block; margin-left:7px; padding:1px 6px; font-size:9.5px;
      letter-spacing:1.2px; text-transform:uppercase; border:1px solid var(--border); color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-vt-flag.bad { color:#e08a84; border-color:#8d3c37; }
    #tablet-os-overlay .tos-vt-sub { padding:11px 12px; margin-bottom:8px; border:1px solid var(--border);
      background:linear-gradient(180deg, var(--tos-surface-hi), var(--tos-surface-lo));
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi); }
    #tablet-os-overlay .tos-vt-subhead { display:flex; align-items:baseline; justify-content:space-between; gap:10px; }
    #tablet-os-overlay .tos-vt-subhead .n { font-size:14px; color:var(--tos-fg); font-weight:bold; letter-spacing:.3px; }
    #tablet-os-overlay .tos-vt-subgrid { display:grid; grid-template-columns:auto 1fr auto 1fr; gap:3px 10px; margin-top:8px;
      font-size:11px; letter-spacing:1.1px; color:var(--tos-fg-dim); font-weight:bold; }
    #tablet-os-overlay .tos-vt-subgrid b { color:var(--tos-fg); font-variant-numeric:tabular-nums; letter-spacing:.4px; }
    #tablet-os-overlay .tos-vt-subload { font-size:10.5px; letter-spacing:1.1px; color:var(--tos-fg-dim);
      font-weight:bold; margin-top:5px; }
    #tablet-os-overlay .tos-vt-subwd { font-size:11.5px; color:var(--tos-fg-dim); font-weight:bold; margin-top:7px; }
    #tablet-os-overlay .tos-vt-subwd.bad { color:#e08a84; }
    @media (max-width:520px) {
      #tablet-os-overlay .tos-vt-subgrid { grid-template-columns:auto 1fr; }
    }

    #tablet-os-overlay .tos-acc-head { display:flex; align-items:flex-end; justify-content:space-between; gap:12px;
      padding-bottom:11px; border-bottom:1px solid var(--border); }
    #tablet-os-overlay .tos-acc-app { font-size:16px; letter-spacing:5px; text-transform:uppercase; color:var(--tos-fg); font-weight:bold; }
    #tablet-os-overlay .tos-acc-sub { font-size:11px; letter-spacing:1.6px; color:var(--tos-fg-dim); font-weight:bold; margin-top:3px; }
    #tablet-os-overlay .tos-acc-count { font-size:10.5px; letter-spacing:1.4px; color:var(--tos-fg-dim); font-weight:bold;
      text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
    #tablet-os-overlay .tos-acc-count b { display:block; font-size:23px; color:var(--mg-accent); letter-spacing:1px; }
    #tablet-os-overlay .tos-acc-meter { margin:13px 0 15px; }
    #tablet-os-overlay .tos-acc-meter-lbl { display:flex; justify-content:space-between; align-items:baseline;
      font-size:10.5px; letter-spacing:1.8px; text-transform:uppercase; color:var(--tos-fg-dim); font-weight:bold; margin-bottom:6px; }
    #tablet-os-overlay .tos-acc-meter-lbl .v { color:var(--tos-fg-dim); letter-spacing:1px; font-variant-numeric:tabular-nums; }
    #tablet-os-overlay .tos-acc-track { height:11px; position:relative; overflow:hidden; background:var(--tos-surface-lo);
      border:1px solid var(--border); box-shadow:inset 0 1px 3px var(--tos-bevel-lo); }
    #tablet-os-overlay .tos-acc-fill { position:absolute; left:0; top:0; bottom:0;
      background:linear-gradient(180deg, color-mix(in srgb, var(--mg-accent) 88%, white), var(--mg-accent));
      box-shadow:0 0 10px color-mix(in srgb, var(--mg-accent) 55%, transparent); }
    #tablet-os-overlay .tos-acc-rows { display:flex; flex-direction:column; gap:8px; }
    #tablet-os-overlay .tos-acc-row { position:relative; padding:12px 13px 11px 16px;
      background:linear-gradient(180deg, var(--tos-surface-hi), var(--tos-surface-lo));
      border:1px solid var(--border);
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi), inset 0 -2px 4px var(--tos-bevel-lo); }
    #tablet-os-overlay .tos-acc-row::before { content:''; position:absolute; left:0; top:0; bottom:0; width:2px;
      background:var(--mg-accent); opacity:.5; }
    #tablet-os-overlay .tos-acc-row.first::before { opacity:1; box-shadow:0 0 9px var(--mg-accent); }
    #tablet-os-overlay .tos-acc-title { font-size:15px; color:var(--tos-fg); font-weight:bold; letter-spacing:.3px; }
    #tablet-os-overlay .tos-acc-line { font-size:14px; color:var(--tos-fg); font-weight:bold; margin-top:5px; line-height:1.6; max-width:54ch; }
    #tablet-os-overlay .tos-acc-foot { display:flex; justify-content:space-between; align-items:baseline; margin-top:9px;
      font-size:10.5px; letter-spacing:1.4px; color:var(--tos-fg-dim); font-weight:bold; font-variant-numeric:tabular-nums; }
    #tablet-os-overlay .tos-acc-foot .xp { color:var(--mg-accent); }
    #tablet-os-overlay .tos-acc-empty { padding:26px 8px; text-align:center; font-size:14px; color:var(--tos-fg); font-weight:bold; line-height:1.8; }
    #tablet-os-overlay .tos-acc-empty span { color:var(--tos-fg-dim); font-size:12.5px; }
    #tablet-os-overlay .tos-acc-endfile { margin-top:13px; padding-top:11px; border-top:1px dashed var(--border);
      font-size:10.5px; letter-spacing:1.6px; color:var(--tos-fg-dim); font-weight:bold; text-align:center; }

    /* ── News app — "The Coldwater Sentinel" ────────────────────────────────────
       The feed is dressed as a newsprint sheet. The paper look is done by
       re-pointing the theme variables to ink-on-paper tones on the container, so
       every widget inside (headlines, standings, weather) inherits newsprint for
       free. On top of that: a serif masthead, double rules, and per-section
       "article" blocks with kicker headers. */
    #tablet-os-overlay .tos-newspaper {
      --tos-fg:#1c1811; --tos-fg-dim:#4b4237; --tos-fg-dim2:#7a7060;
      --mg-accent:color-mix(in srgb, var(--accent, #7d1c12) 45%, #1c1811); --tos-surface:#efe8d5; --tos-surface-hi:#f6f0e0; --tos-surface-lo:#e8e0ca;
      --tos-bevel-hi:rgba(255,255,255,0.55); --tos-bevel-lo:rgba(0,0,0,0.05);
      padding:15px 15px 6px; border-radius:4px; color:var(--tos-fg);
      font-family:Georgia,'Times New Roman','Times',serif;
      background:#f4eede;
      background-image:linear-gradient(0deg, rgba(120,100,60,0.05), rgba(120,100,60,0.05));
      box-shadow:0 3px 10px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(0,0,0,0.06); }

    /* Masthead — the grand serif nameplate between double rules. */
    #tablet-os-overlay .tos-mast { text-align:center; margin-bottom:12px; }
    #tablet-os-overlay .tos-mast-rule { border-top:3px double var(--tos-fg); }
    #tablet-os-overlay .tos-mast-rule.top { margin-bottom:8px; }
    #tablet-os-overlay .tos-mast-rule.bot { margin-top:8px; }
    #tablet-os-overlay .tos-mast-name { font-size:30px; line-height:1.02; font-weight:bold; letter-spacing:1px;
      margin:0; color:var(--tos-fg); text-shadow:0 1px 0 rgba(255,255,255,0.4); font-variant:small-caps; }
    #tablet-os-overlay .tos-mast-motto { font-size:11px; font-style:italic; color:var(--tos-fg-dim); margin-top:3px; }
    #tablet-os-overlay .tos-mast-line { display:flex; justify-content:space-between; gap:8px;
      font-size:9.5px; letter-spacing:1px; text-transform:uppercase; color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-mast-line span:nth-child(2) { flex:1; text-align:center; }
    #tablet-os-overlay .tos-mast-line span:last-child { text-align:right; }

    /* Article block — one per section, split by a hairline rule. Kicker header is
       a centred small-caps section label under a fine rule. */
    #tablet-os-overlay .tos-art { padding:11px 0; border-top:1px solid color-mix(in srgb, var(--tos-fg) 22%, transparent); }
    #tablet-os-overlay .tos-art:first-of-type { border-top:none; padding-top:2px; }
    #tablet-os-overlay .tos-art-kicker { text-align:center; margin-bottom:8px; }
    #tablet-os-overlay .tos-art-title { display:inline-block; font-size:12px; font-weight:bold; letter-spacing:2px;
      text-transform:uppercase; color:var(--tos-fg); border-bottom:2px solid var(--mg-accent); padding-bottom:2px; }
    #tablet-os-overlay .tos-art-sub { display:block; font-size:11px; font-style:italic; color:var(--tos-fg-dim); margin-top:4px; }

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

    /* Weather widget — a tappable "now" card (glyph + big temp + a stat rail),
       with a 7-day forecast strip that expands beneath it. */
    #tablet-os-overlay .tos-wx-now { display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:12px;
      padding:11px 13px; cursor:pointer; }
    #tablet-os-overlay .tos-wx-now:hover { background:color-mix(in srgb, var(--mg-accent) 6%, transparent); }
    #tablet-os-overlay .tos-wx-glyph { font-size:30px; line-height:1; }
    #tablet-os-overlay .tos-wx-main { min-width:0; }
    #tablet-os-overlay .tos-wx-temp { font-size:22px; font-weight:bold; color:var(--tos-fg); letter-spacing:.5px; }
    #tablet-os-overlay .tos-wx-tempf { font-size:12px; font-weight:normal; color:var(--tos-fg-dim2); }
    #tablet-os-overlay .tos-wx-cond { font-size:11.5px; text-transform:capitalize; color:var(--tos-fg-dim); margin-top:1px; }
    #tablet-os-overlay .tos-wx-stats { display:flex; gap:14px; }
    #tablet-os-overlay .tos-wx-stat { display:flex; flex-direction:column; align-items:flex-end; }
    #tablet-os-overlay .tos-wx-k { font-size:8.5px; letter-spacing:1px; text-transform:uppercase; color:var(--tos-fg-dim2); }
    #tablet-os-overlay .tos-wx-v { font-size:13px; color:var(--tos-fg); }
    #tablet-os-overlay .tos-wx-toggle { grid-column:1 / -1; font-size:10px; letter-spacing:1px; text-transform:uppercase;
      color:var(--mg-accent); text-align:right; }
    #tablet-os-overlay .tos-wx-forecast { border-top:1px solid color-mix(in srgb, var(--mg-accent) 18%, transparent); padding:2px 2px 4px; }
    #tablet-os-overlay .tos-wx-day { display:grid; grid-template-columns:44px 22px 1fr auto auto auto; align-items:center; gap:8px;
      padding:6px 11px; font-size:12px; color:var(--tos-fg);
      border-bottom:1px solid color-mix(in srgb, var(--mg-accent) 9%, transparent); }
    #tablet-os-overlay .tos-wx-day:last-child { border-bottom:none; }
    #tablet-os-overlay .tos-wx-day:first-child { color:var(--mg-accent); }
    /* Scheduled hero event (acid rain, ion storm) — outranks the first-child
       accent, because the day that kills you matters more than today. */
    #tablet-os-overlay .tos-wx-day.tos-wx-hero,
    #tablet-os-overlay .tos-wx-day.tos-wx-hero:first-child { color:var(--red, #e05252); font-weight:600;
      background:color-mix(in srgb, var(--red, #e05252) 8%, transparent); }
    #tablet-os-overlay .tos-wx-dow { color:var(--tos-fg-dim); }
    #tablet-os-overlay .tos-wx-dico { text-align:center; }
    #tablet-os-overlay .tos-wx-dcond { text-transform:capitalize; color:var(--tos-fg-dim); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    #tablet-os-overlay .tos-wx-dtemp { text-align:right; font-variant-numeric:tabular-nums; }
    #tablet-os-overlay .tos-wx-dwind, #tablet-os-overlay .tos-wx-dhum { text-align:right; font-variant-numeric:tabular-nums; color:var(--tos-fg-dim2); font-size:11px; }

    /* Newsprint overrides — how the widgets read once inside the paper. The LIVE/
       WIRE chips become inky serif labels; the lead story gets a drop-capped,
       stacked treatment like a front-page splash. */
    #tablet-os-overlay .tos-newspaper .tos-news-list { padding:2px 0; }
    #tablet-os-overlay .tos-newspaper .tos-headline { padding:6px 2px; font-size:12.5px; }
    #tablet-os-overlay .tos-newspaper .tos-hl-tag { border-radius:0; padding:1px 4px; letter-spacing:1.5px; }
    #tablet-os-overlay .tos-newspaper .tos-hl-tag.live { color:var(--mg-accent); border:1px solid var(--mg-accent); background:transparent; }
    #tablet-os-overlay .tos-newspaper .tos-hl-tag.tabloid { color:var(--tos-fg-dim); border:1px solid color-mix(in srgb, var(--tos-fg) 30%, transparent); background:transparent; }
    /* Every wire/live story reads at the front-page splash size, not just the
       lead — stacked, large serif, and tappable. The drop-cap stays exclusive to
       the very first story so the page still has one clear lead. */
    #tablet-os-overlay .tos-newspaper .tos-art.lead .tos-headline { display:block; font-size:16px; line-height:1.42; cursor:pointer; }
    #tablet-os-overlay .tos-newspaper .tos-art.lead .tos-headline:hover .tos-hl-text { color:var(--mg-accent); }
    #tablet-os-overlay .tos-newspaper .tos-art.lead .tos-headline:first-child { padding-top:0; }
    #tablet-os-overlay .tos-newspaper .tos-art.lead .tos-headline .tos-hl-tag { margin-bottom:5px; }
    #tablet-os-overlay .tos-newspaper .tos-art.lead .tos-headline:first-child .tos-hl-text::first-letter {
      float:left; font-size:40px; line-height:0.72; font-weight:bold; padding:4px 7px 0 0; color:var(--mg-accent); }
    #tablet-os-overlay .tos-newspaper .tos-art.lead .tos-headline .tos-hl-by { display:inline; white-space:normal; }

    /* Story popup — a little reader window that opens over the tablet when a
       headline is tapped: a tablet-OS chrome bar (accent app-mark + a padlocked
       address pill + accent close button) atop a newsprint page carrying the full
       mini-story. The bar wears the OS's own surface/bevel/accent skin, not a Mac
       title bar, so the popup reads as part of the tablet. */
    #tablet-os-overlay .tos-newswin-back { position:absolute; inset:0; z-index:40; display:flex; align-items:center; justify-content:center;
      padding:18px; background:rgba(10,8,6,0.55); backdrop-filter:blur(1.5px); pointer-events:auto; }
    #tablet-os-overlay .tos-newswin { width:min(340px, 94%); max-height:88%; display:flex; flex-direction:column; overflow:hidden;
      border-radius:8px; border:1px solid color-mix(in srgb, var(--mg-accent) 45%, transparent);
      box-shadow:0 14px 40px rgba(0,0,0,0.6), 0 0 20px color-mix(in srgb, var(--mg-accent) 22%, transparent);
      font-family:Georgia,'Times New Roman','Times',serif; animation:tos-nw-in 140ms ease-out; }
    @keyframes tos-nw-in { from { opacity:0; transform:translateY(8px) scale(0.97); } to { opacity:1; transform:none; } }
    #tablet-os-overlay .tos-nw-chrome { display:flex; align-items:center; gap:9px; padding:7px 9px;
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo));
      border-bottom:1px solid color-mix(in srgb, var(--mg-accent) 32%, transparent);
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi), inset 0 -2px 3px var(--tos-bevel-lo); }
    #tablet-os-overlay .tos-nw-mark { flex:0 0 auto; font-size:13px; line-height:1; color:var(--mg-accent);
      text-shadow:0 0 8px color-mix(in srgb, var(--mg-accent) 60%, transparent); }
    #tablet-os-overlay .tos-nw-url { flex:1; min-width:0; text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
      font-family:var(--font-mono,monospace); font-size:10.5px; letter-spacing:.3px; color:var(--tos-fg);
      background:linear-gradient(165deg, var(--tos-surface-lo), var(--tos-surface));
      border:1px solid color-mix(in srgb, var(--mg-accent) 26%, transparent); border-radius:11px; padding:3px 10px;
      box-shadow:inset 0 1px 2px var(--tos-bevel-lo); }
    #tablet-os-overlay .tos-nw-x { flex:0 0 auto; width:22px; height:22px; line-height:1; cursor:pointer;
      border:1px solid color-mix(in srgb, var(--mg-accent) 40%, transparent); border-radius:4px;
      background:linear-gradient(165deg, var(--tos-surface-hi), var(--tos-surface-lo)); color:var(--mg-accent); font-size:12px;
      box-shadow:inset 0 1px 0 var(--tos-bevel-hi), inset 0 -1px 1px var(--tos-bevel-lo); }
    #tablet-os-overlay .tos-nw-x:hover { color:var(--tos-fg); box-shadow:inset 0 1px 0 var(--tos-bevel-hi), 0 0 10px color-mix(in srgb, var(--mg-accent) 40%, transparent); }
    #tablet-os-overlay .tos-nw-x:active { transform:translateY(1px); box-shadow:inset 0 2px 4px var(--tos-bevel-lo); }
    #tablet-os-overlay .tos-nw-page { overflow-y:auto; padding:16px 18px 18px; color:#1c1811;
      background:#f4eede; background-image:linear-gradient(0deg, rgba(120,100,60,0.05), rgba(120,100,60,0.05)); }
    #tablet-os-overlay .tos-nw-kicker { display:flex; align-items:center; gap:9px; margin-bottom:9px; }
    #tablet-os-overlay .tos-nw-tag { font-size:8.5px; font-weight:bold; letter-spacing:1.5px; padding:1px 5px;
      color:#4b4237; border:1px solid rgba(0,0,0,0.35); }
    #tablet-os-overlay .tos-nw-tag.live { color:#7d1c12; border-color:#7d1c12; }
    #tablet-os-overlay .tos-nw-by { font-size:11px; font-style:italic; color:#7a7060; }
    #tablet-os-overlay .tos-nw-headline { margin:0 0 10px; font-size:21px; line-height:1.24; font-weight:bold; color:#1c1811;
      border-bottom:2px solid #7d1c12; padding-bottom:9px; }
    #tablet-os-overlay .tos-nw-story { margin:0; font-size:14px; line-height:1.62; color:#2a251c; }
    #tablet-os-overlay .tos-nw-story::first-letter { float:left; font-size:38px; line-height:0.74; font-weight:bold; padding:3px 7px 0 0; color:#7d1c12; }
    #tablet-os-overlay .tos-nw-foot { margin-top:14px; padding-top:9px; border-top:1px solid rgba(0,0,0,0.18);
      font-size:9.5px; font-style:italic; letter-spacing:.4px; color:#7a7060; text-align:center; }
    /* Boxed items — weather and sports read as ruled front-page boxes. */
    #tablet-os-overlay .tos-newspaper .tos-wx-now,
    #tablet-os-overlay .tos-newspaper .tos-standings { border:1px solid color-mix(in srgb, var(--tos-fg) 22%, transparent); }
    #tablet-os-overlay .tos-newspaper .tos-wx-forecast { border:1px solid color-mix(in srgb, var(--tos-fg) 22%, transparent); border-top:none; }
    #tablet-os-overlay .tos-newspaper .tos-standings { border-collapse:separate; border-spacing:0; }

    /* ── Arcade app: "ARCHITECT" (a fake game inside the game) ──────────────────
       A little in-tablet emulator — login → boot → a tiny live MUD terminal with
       a tablet you can tap, which pops a shrunk recreation of this tablet. Styled
       to mirror the REAL game look pane: dark bg, --font-mono, and the same
       syntax palette (--cyan exits, --orange furniture, --green NPCs, --purple
       buildings, --text/--text-dim body) so it reads as an actual game screen.
       All colours are the page's own theme vars, so it tracks the player theme. */
    #tablet-os-overlay .tos-fake { position:relative; border-radius:6px; overflow:hidden;
      border:1px solid var(--border, #2a2a40); background:var(--bg, #05050a); color:var(--text, #e8e8f5);
      font-family:var(--font-mono, 'Courier New', monospace); box-shadow:inset 0 0 30px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.4); }
    #tablet-os-overlay .tos-fake ::selection { background:color-mix(in srgb, var(--accent) 35%, transparent); }

    /* Login screen — a spare terminal splash on the game bg. */
    #tablet-os-overlay .tos-fk-login { display:flex; flex-direction:column; align-items:center; gap:11px; padding:34px 22px 42px; text-align:center; }
    #tablet-os-overlay .tos-fk-logo { font-size:22px; letter-spacing:11px; font-weight:bold; color:var(--accent);
      text-shadow:0 0 16px color-mix(in srgb, var(--accent) 60%, transparent); }
    #tablet-os-overlay .tos-fk-tag { font-size:10px; letter-spacing:2px; color:var(--text-dim); text-transform:uppercase; margin-bottom:10px; }
    #tablet-os-overlay .tos-fk-field { display:flex; align-items:center; gap:8px; width:min(280px,88%); font-size:13px; }
    #tablet-os-overlay .tos-fk-field label { flex:0 0 74px; text-align:right; color:var(--text-dim); font-size:11px; letter-spacing:1px; text-transform:uppercase; }
    #tablet-os-overlay .tos-fk-field input { flex:1; min-width:0; background:var(--bg2, #0d0d16); border:1px solid var(--border, #2a2a40);
      color:var(--text); font-family:var(--font-mono,'Courier New',monospace); font-size:13px; padding:7px 9px; border-radius:4px; outline:none; }
    #tablet-os-overlay .tos-fk-field input:focus { border-color:var(--accent); box-shadow:0 0 7px color-mix(in srgb, var(--accent) 35%, transparent); }
    #tablet-os-overlay .tos-fk-jack { margin-top:12px; cursor:pointer; padding:9px 24px; border-radius:4px; font-family:var(--font-mono,'Courier New',monospace); font-weight:bold; letter-spacing:2px; font-size:13px;
      color:var(--accent); background:transparent; border:1px solid var(--accent);
      box-shadow:0 0 12px color-mix(in srgb, var(--accent) 30%, transparent); transition:background .12s, color .12s, transform .05s; }
    #tablet-os-overlay .tos-fk-jack:hover { background:var(--accent); color:var(--accent-ink, #05050a); }
    #tablet-os-overlay .tos-fk-jack:active { transform:translateY(1px); }
    #tablet-os-overlay .tos-fk-cur { animation:tos-fk-blink 1s steps(1) infinite; }
    @keyframes tos-fk-blink { 0%,50%{opacity:1} 51%,100%{opacity:0} }

    /* Boot lines (login → play transition) */
    #tablet-os-overlay .tos-fk-boot { padding:20px 18px; font-size:12.5px; line-height:1.7; min-height:210px; color:var(--text-dim); }
    #tablet-os-overlay .tos-fk-boot .ok { color:var(--green, #39ff8f); }

    /* Play: terminal — mirrors the game's look pane. */
    #tablet-os-overlay .tos-fk-term { position:relative; display:flex; flex-direction:column; height:410px; max-height:54vh; }
    /* Slim vitals strip (compresses the game's sidebar VITALS to one row). */
    #tablet-os-overlay .tos-fk-hud { display:flex; gap:14px; flex-wrap:wrap; padding:7px 12px; font-size:11px; letter-spacing:.5px;
      border-bottom:1px solid var(--border, #2a2a40); color:var(--text-dim); }
    #tablet-os-overlay .tos-fk-hud b { font-weight:bold; }
    #tablet-os-overlay .tos-fk-hud .hp { color:var(--green, #39ff8f); }
    #tablet-os-overlay .tos-fk-hud .cr { color:var(--accent); }
    #tablet-os-overlay .tos-fk-hud .wt { color:var(--yellow, #f5e642); }
    #tablet-os-overlay .tos-fk-log { flex:1; min-height:0; overflow-y:auto; padding:11px 13px; font-size:13px; line-height:1.55; }
    #tablet-os-overlay .tos-fk-log::-webkit-scrollbar { width:6px; }
    #tablet-os-overlay .tos-fk-log::-webkit-scrollbar-thumb { background:var(--border, #2a2a40); border-radius:3px; }
    #tablet-os-overlay .tos-fk-line { padding:1px 0; white-space:pre-wrap; word-break:break-word; }
    /* Room header: bold accent name + [SAFE] danger badge (mirrors .zone-name / .zone-danger-safe). */
    #tablet-os-overlay .tos-fk-room { color:var(--accent); font-weight:bold; letter-spacing:1.5px; text-transform:uppercase; }
    #tablet-os-overlay .tos-fk-safe { margin-left:7px; font-size:10px; letter-spacing:0; padding:1px 5px; border-radius:2px; vertical-align:middle;
      color:var(--green, #39ff8f); border:1px solid var(--green, #39ff8f); }
    #tablet-os-overlay .tos-fk-dist { color:var(--text-dim); font-style:italic; letter-spacing:1px; font-size:12px; }
    #tablet-os-overlay .tos-fk-desc { color:var(--text, #e8e8f5); }
    #tablet-os-overlay .tos-fk-label { color:var(--text-dim); }
    /* Interactive nouns — exact game link palette, underlined like .action-link. */
    #tablet-os-overlay .tos-fk-furn, #tablet-os-overlay .tos-fk-npc, #tablet-os-overlay .tos-fk-exit,
    #tablet-os-overlay .tos-fk-build, #tablet-os-overlay .tos-fk-buzz { font-weight:600; text-decoration:underline; text-underline-offset:2px; cursor:pointer; }
    #tablet-os-overlay .tos-fk-furn  { color:var(--orange, #ff9a3c); }
    #tablet-os-overlay .tos-fk-npc   { color:var(--green, #39ff8f); }
    #tablet-os-overlay .tos-fk-exit  { color:var(--cyan, #28e5ff); }
    #tablet-os-overlay .tos-fk-build { color:var(--purple, #b86bff); }
    #tablet-os-overlay .tos-fk-buzz  { color:var(--cyan, #28e5ff); }
    #tablet-os-overlay .tos-fk-dir { color:var(--text-dim); font-weight:bold; margin-right:2px; }
    #tablet-os-overlay .tos-fk-amb { color:var(--text-dim); font-style:italic; }
    #tablet-os-overlay .tos-fk-echo { color:var(--accent); }
    #tablet-os-overlay .tos-fk-sys { color:var(--yellow, #f5e642); }
    /* Quick-command chips row (mirrors #quick-cmds) — flavour, all local. */
    #tablet-os-overlay .tos-fk-chips { display:flex; gap:5px; flex-wrap:wrap; padding:7px 12px 0; }
    #tablet-os-overlay .tos-fk-chip { cursor:pointer; font-size:11px; color:var(--text-dim); padding:3px 8px; border-radius:3px;
      background:var(--bg2, #0d0d16); border:1px solid var(--border, #2a2a40); transition:color .12s, border-color .12s; }
    #tablet-os-overlay .tos-fk-chip:hover { color:var(--accent); border-color:var(--accent); }
    #tablet-os-overlay .tos-fk-inrow { display:flex; align-items:center; gap:7px; padding:9px 12px; border-top:1px solid var(--border, #2a2a40); }
    #tablet-os-overlay .tos-fk-prompt { color:var(--accent); font-weight:bold; }
    #tablet-os-overlay .tos-fk-in { flex:1; min-width:0; background:transparent; border:none; outline:none; color:var(--text); font-family:var(--font-mono,'Courier New',monospace); font-size:13px; }
    #tablet-os-overlay .tos-fk-in::placeholder { color:var(--text-dim); }
    /* Floating tablet-buzz button in the corner of the terminal */
    #tablet-os-overlay .tos-fk-tabbtn { position:absolute; right:12px; bottom:96px; z-index:4; cursor:pointer; user-select:none;
      font-size:11px; letter-spacing:1px; padding:6px 11px; border-radius:4px; color:var(--accent); font-weight:bold;
      background:var(--bg2, #0d0d16); border:1px solid var(--accent);
      box-shadow:0 0 12px color-mix(in srgb, var(--accent) 30%, transparent); animation:tos-fk-pulse 1.8s ease-in-out infinite; }
    #tablet-os-overlay .tos-fk-tabbtn:hover { background:var(--accent); color:var(--accent-ink, #05050a); }
    @keyframes tos-fk-pulse { 0%,100%{box-shadow:0 0 8px color-mix(in srgb, var(--accent) 25%, transparent)} 50%{box-shadow:0 0 18px color-mix(in srgb, var(--accent) 60%, transparent)} }

    /* Mini tablet — a shrunk recreation floating over the fake game (theme-tinted). */
    #tablet-os-overlay .tos-fk-mini-scrim { position:absolute; inset:0; z-index:8;
      background:rgba(0,0,0,.55); animation:tos-fk-fade .18s ease-out; }
    @keyframes tos-fk-fade { from{opacity:0} to{opacity:1} }
    /* Shaky "oh no" banner across the top of the REAL tablet, once you've gone one
       ARCHITECT-tap deep. Sits on the (unscaled) scrim so it stays put and legible. */
    #tablet-os-overlay .tos-fk-caption { position:absolute; top:9px; left:0; right:0; z-index:12; text-align:center; pointer-events:none;
      padding:0 14px; line-height:1.25; font-family:var(--font-mono,'Courier New',monospace); font-size:15px; font-weight:bold; font-style:italic;
      animation:tos-fk-shake .17s infinite, tos-fk-fade .25s ease-out; }
    /* Text sits on its own dark pill so it stays legible on every theme (a light/white
       theme has no dark backdrop of its own, and accent-on-accent used to bleed together). */
    #tablet-os-overlay .tos-fk-caption span { display:inline-block; max-width:100%; padding:3px 12px; border-radius:8px;
      background:rgba(6,10,16,.9); border:1px solid color-mix(in srgb, var(--accent) 60%, transparent);
      letter-spacing:.5px; color:#fff; text-shadow:0 0 6px #000, 0 0 12px color-mix(in srgb, var(--accent) 80%, transparent);
      box-shadow:0 2px 10px rgba(0,0,0,.5); }
    @keyframes tos-fk-shake {
      0%   { transform:translate(0,0) rotate(0deg); }
      20%  { transform:translate(-2px,1px) rotate(-.7deg); }
      40%  { transform:translate(2px,-1px) rotate(.6deg); }
      60%  { transform:translate(-1px,-2px) rotate(.5deg); }
      80%  { transform:translate(1px,2px) rotate(-.6deg); }
      100% { transform:translate(0,0) rotate(0deg); }
    }
    /* Each nested tablet lives in a full-scrim centring layer, scaled down per depth
       (inline transform). pointer-events:none lets taps fall through the empty space
       to the tablet (or backdrop) below; the tablet re-enables them. */
    #tablet-os-overlay .tos-fk-mini-layer { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
      transform-origin:center center; pointer-events:none; }
    /* Wide, landscape tablet (matches the desktop tablet's rectangular shape). */
    #tablet-os-overlay .tos-fk-mini { position:relative; pointer-events:auto; width:360px; border-radius:16px; padding:12px 14px 14px; color:var(--accent);
      background:linear-gradient(160deg, rgba(255,255,255,0.07), transparent 30%), var(--bg2, #0d0d16);
      border:2px solid #000; box-shadow:0 12px 30px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.12), 0 0 18px color-mix(in srgb, var(--accent) 20%, transparent);
      animation:tos-fk-pop .22s cubic-bezier(.2,1.3,.5,1); }
    @keyframes tos-fk-pop { from{transform:scale(.6); opacity:0} to{transform:scale(1); opacity:1} }
    /* A fake game screen (the terminal look pane) that a tablet pops up over — the
       recurring backdrop each ARCHITECT tap drops you into. Sized landscape; the
       tablet centres on top of it (flex), game text peeking around the edges. */
    #tablet-os-overlay .tos-fk-gamewrap { position:relative; pointer-events:auto; width:440px; height:274px;
      display:flex; align-items:center; justify-content:center; animation:tos-fk-pop .22s cubic-bezier(.2,1.3,.5,1); }
    #tablet-os-overlay .tos-fk-gamewrap .tos-fk-mini { position:relative; z-index:1; animation:none; }
    #tablet-os-overlay .tos-fk-gamescreen { position:absolute; inset:0; box-sizing:border-box; overflow:hidden;
      border-radius:8px; border:1px solid var(--border, #2a2a40); background:var(--bg, #05050a);
      font-family:var(--font-mono,'Courier New',monospace); font-size:9px; line-height:1.5; padding:10px 12px;
      box-shadow:inset 0 0 26px rgba(0,0,0,.6); }
    #tablet-os-overlay .tos-fk-gs-hud { display:flex; gap:9px; flex-wrap:wrap; color:var(--text-dim); border-bottom:1px solid var(--border, #2a2a40); padding-bottom:5px; margin-bottom:6px; }
    #tablet-os-overlay .tos-fk-gs-hud .hp { color:var(--green, #39ff8f); }
    #tablet-os-overlay .tos-fk-gs-hud .cr { color:var(--accent); }
    #tablet-os-overlay .tos-fk-gs-room { color:var(--accent); font-weight:bold; letter-spacing:1px; text-transform:uppercase; }
    #tablet-os-overlay .tos-fk-gs-safe { margin-left:5px; font-size:8px; padding:0 4px; border-radius:2px; color:var(--green, #39ff8f); border:1px solid var(--green, #39ff8f); }
    #tablet-os-overlay .tos-fk-gs-dist { color:var(--text-dim); font-style:italic; }
    #tablet-os-overlay .tos-fk-gs-desc { color:var(--text, #e8e8f5); margin-top:3px; }
    #tablet-os-overlay .tos-fk-gs-exits { margin-top:3px; }
    #tablet-os-overlay .tos-fk-gs-exits .l { color:var(--text-dim); }
    #tablet-os-overlay .tos-fk-gs-exits .ex { color:var(--cyan, #28e5ff); }
    #tablet-os-overlay .tos-fk-mini-hd { display:flex; justify-content:space-between; align-items:center; font-size:8.5px; letter-spacing:2px; text-transform:uppercase; color:var(--accent); opacity:.85; margin-bottom:8px; padding:0 3px; }
    #tablet-os-overlay .tos-fk-mini-x { cursor:pointer; font-size:12px; opacity:.8; line-height:1; }
    #tablet-os-overlay .tos-fk-mini-x:hover { opacity:1; color:var(--text-bright, #fff); }
    #tablet-os-overlay .tos-fk-mini-screen { position:relative; background:var(--bg, #05050a); border-radius:8px; padding:9px 8px; box-shadow:inset 0 0 12px rgba(0,0,0,.6); }
    #tablet-os-overlay .tos-fk-mini-time { display:flex; justify-content:space-between; font-size:7px; letter-spacing:1px; text-transform:uppercase; color:var(--accent); opacity:.6; margin-bottom:7px; }
    #tablet-os-overlay .tos-fk-mini-grid { display:grid; grid-template-columns:repeat(6,1fr); gap:6px; }
    #tablet-os-overlay .tos-fk-app { cursor:pointer; text-align:center; padding:7px 2px; border-radius:6px;
      background:color-mix(in srgb, var(--accent) 12%, var(--bg2, #0d0d16));
      border:1px solid color-mix(in srgb, var(--accent) 28%, transparent); box-shadow:inset 0 1px 0 rgba(255,255,255,.18);
      transition:transform .06s, filter .12s; }
    #tablet-os-overlay .tos-fk-app:hover { filter:brightness(1.18); }
    #tablet-os-overlay .tos-fk-app:active { transform:scale(.9); }
    #tablet-os-overlay .tos-fk-app.tap { animation:tos-fk-tap .4s ease; }
    @keyframes tos-fk-tap { 0%{filter:brightness(2.2)} 100%{filter:brightness(1)} }
    #tablet-os-overlay .tos-fk-app .ic { font-size:16px; display:block; line-height:1; }
    #tablet-os-overlay .tos-fk-app .nm { font-size:7px; letter-spacing:.3px; color:color-mix(in srgb, var(--accent) 70%, #fff); margin-top:3px; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    #tablet-os-overlay .tos-fk-mini-toast { min-height:13px; text-align:center; font-size:8.5px; letter-spacing:1px; text-transform:uppercase; color:var(--accent); margin-top:9px; opacity:0; transition:opacity .15s; }
    #tablet-os-overlay .tos-fk-mini-toast.show { opacity:.9; }
    #tablet-os-overlay .tos-fk-mini-home { width:26px; height:26px; border-radius:50%; margin:9px auto 0; border:2px solid color-mix(in srgb, var(--accent) 40%, transparent); cursor:pointer; }
    #tablet-os-overlay .tos-fk-mini-home:hover { border-color:var(--accent); box-shadow:0 0 8px color-mix(in srgb, var(--accent) 50%, transparent); }

    /* ── TV app ───────────────────────────────────────────────────────────────
       A portable television inside the tablet. The SCREEN is driven by the shared
       broadcast renderer (panels/tv.js createTvView) through the same data-tv hooks
       the wall set uses, so all the content classes it emits (.tv-msg, .tv-sb-*,
       .tv-st-*, .tv-fx-*, .tv-sched-*, .tv-overlay-*) come from styles.css for free.
       What's defined here is only the tablet's own chassis + the overlay hosts,
       which on the standalone set are positioned against the CRT cabinet. */
    /* TV app fills the screen (same trick as the map app above): the body is a flex
       column pinned to 100% height, and the set takes all the slack the header/dial
       leave — so the picture is as big as the tablet allows instead of a fixed box. */
    #tablet-os-overlay .tos-body.tos-tv-view { box-sizing:border-box; height:100%; display:flex; flex-direction:column; }
    /* NB no flex:1 here — .tos-body is a plain BLOCK, so a flex item's grow factor
       would be inert and the whole column would size to content instead. The picture
       gets its height from an explicit aspect-ratio below. */
    #tablet-os-overlay .tos-tv { display:flex; flex-direction:column; gap:10px; }
    /* Theme vars land on this element (tv.js _writeTvTheme) — defaults keep the
       viewport legible on a channel with no theme of its own. */
    #tablet-os-overlay .tos-tv-set {
      --tv-bg:var(--bg, #05050a); --tv-border:var(--border, #2a2a40); --tv-text:var(--tos-fg, #e8e8f5);
      --tv-header-color:var(--accent); --tv-live-color:#ff4d4d; --tv-ticker-color:var(--accent);
      display:flex; flex-direction:column; border-radius:8px; overflow:hidden;
      border:1px solid var(--tv-border); background:var(--tv-bg);
      box-shadow:inset 0 0 22px rgba(0,0,0,.55);
      transition:background .5s, border-color .5s; }
    #tablet-os-overlay .tos-tv-bar { display:flex; align-items:center; gap:8px; padding:6px 10px;
      border-bottom:1px solid var(--tv-border); font-size:10px; letter-spacing:1px; text-transform:uppercase;
      color:var(--tv-header-color); transition:color .5s, border-color .5s; }
    #tablet-os-overlay .tos-tv-station { font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    #tablet-os-overlay .tos-tv-ch { opacity:.8; flex:none; }
    #tablet-os-overlay .tos-tv-prog { flex:1; min-width:0; text-align:right; opacity:.75; font-style:italic;
      text-transform:none; letter-spacing:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    #tablet-os-overlay .tos-tv-live { flex:none; color:var(--tv-live-color); font-size:8px; }
    /* The picture. position:relative is what every overlay host below anchors to. */
    /* The picture needs a DEFINITE height: every layer inside it (content, static,
       gameday, the bugs) is position:absolute and so contributes no content height —
       sized by flex alone this box collapses to 0px and the whole screen renders
       blank. An aspect-ratio scales it with the tablet's width; the min-height keeps
       DEADBALL's Gameday sub-screen (ballpark + line score + pitch tracker) legible
       on a narrow tablet. Roughly the wall set's 760x520 proportion. */
    #tablet-os-overlay .tos-tv-screen { position:relative; width:100%; aspect-ratio:3/2;
      min-height:230px; overflow:hidden; background:var(--tv-bg); }
    #tablet-os-overlay .tos-tv-screen [data-tv="content"] { position:absolute; inset:0; overflow:hidden; padding:12px 14px;
      transition:opacity .25s; }
    #tablet-os-overlay .tos-tv-screen [data-tv="content"].tv-hidden { opacity:0; }
    #tablet-os-overlay .tos-tv-screen [data-tv="messages"] { display:flex; flex-direction:column; gap:5px; }
    /* Static: the same rolling-noise look the CRT set uses, scaled to the viewport. */
    #tablet-os-overlay .tos-tv-screen [data-tv="static"] { position:absolute; inset:0; z-index:40; opacity:0; pointer-events:none;
      background-image:repeating-linear-gradient(0deg, rgba(255,255,255,.06) 0 1px, transparent 1px 3px),
        repeating-linear-gradient(90deg, rgba(255,255,255,.05) 0 1px, transparent 1px 2px); }
    #tablet-os-overlay .tos-tv-screen [data-tv="static"].tv-static-on { opacity:1; }
    #tablet-os-overlay .tos-tv-screen [data-tv="static"].tv-static-loop { animation:tos-tv-static 0.28s steps(2) infinite; }
    #tablet-os-overlay .tos-tv-screen [data-tv="static"].tv-static-fade { animation:tos-tv-staticout .45s ease-out forwards; }
    @keyframes tos-tv-static { 0%{background-position:0 0,0 0} 100%{background-position:0 4px,3px 0} }
    @keyframes tos-tv-staticout { to { opacity:0; } }
    /* Overlay hosts — on the wall set these are positioned against the CRT cabinet;
       here they anchor to the tablet's screen box instead. */
    #tablet-os-overlay .tos-tv-screen [data-tv="overlay-container"] { position:absolute; inset:0; z-index:47; pointer-events:none; }
    #tablet-os-overlay .tos-tv-screen [data-tv="schedule"],
    #tablet-os-overlay .tos-tv-screen [data-tv="standings-panel"],
    #tablet-os-overlay .tos-tv-screen [data-tv="gameday"] { position:absolute; inset:0; z-index:48; display:none;
      flex-direction:column; overflow:auto; background:var(--tv-bg); color:var(--tv-text);
      font-family:var(--font-mono,'Courier New',monospace); padding:7px 9px; }
    #tablet-os-overlay .tos-tv-screen [data-tv="schedule"].on,
    #tablet-os-overlay .tos-tv-screen [data-tv="standings-panel"].on,
    #tablet-os-overlay .tos-tv-screen [data-tv="gameday"].on { display:flex; }
    #tablet-os-overlay .tos-tv-screen [data-tv="scorebug"] { position:absolute; right:8px; bottom:8px; z-index:45; display:none;
      pointer-events:none; background:rgba(0,0,0,.82); border:1px solid var(--tv-border);
      border-left:3px solid var(--tv-header-color); border-radius:2px; padding:4px 7px; font-size:10px; }
    #tablet-os-overlay .tos-tv-screen [data-tv="scorebug"].on { display:flex; gap:9px; align-items:center; }
    #tablet-os-overlay .tos-tv-screen [data-tv="standings"] { position:absolute; top:8px; right:8px; z-index:46; display:none;
      flex-direction:column; min-width:190px; pointer-events:none; background:rgba(0,0,0,.85);
      border:1px solid var(--tv-border); border-radius:2px; padding:4px 7px; font-size:9px; }
    #tablet-os-overlay .tos-tv-screen [data-tv="standings"].on { display:flex; }
    #tablet-os-overlay .tos-tv-screen [data-tv="fx"] { position:absolute; inset:0; z-index:49; display:none; pointer-events:none; }
    #tablet-os-overlay .tos-tv-screen [data-tv="fx"].on { display:block; }

    /* ── Legibility on a hand-held picture ─────────────────────────────────────
       The shared broadcast styles are sized for a WALL SET a few feet wide; on a
       tablet screen a third that size the same 13px/9px type at 0.55 opacity is a
       smudge behind the scanlines. Everything below only raises weight, size and
       contrast INSIDE the tablet's picture — the standalone CRT set is untouched,
       and no layout/positioning is changed, so the renderer's own metrics (the
       ascii auto-fit, the overlay hosts) still hold.
       Weight comes from a real 600/700 plus a hard 1px dark shadow rather than a
       glow: a glow would make it thicker AND blurrier, which is the opposite of
       the point. */
    #tablet-os-overlay .tos-tv-screen { font-weight:600; }
    #tablet-os-overlay .tos-tv-screen [data-tv="content"] {
      text-shadow:0 1px 0 rgba(0,0,0,.95), 0 0 3px rgba(0,0,0,.85), -1px 0 0 rgba(0,0,0,.55), 1px 0 0 rgba(0,0,0,.55); }
    #tablet-os-overlay .tos-tv-screen .tv-msg { font-size:15px; line-height:1.42; font-weight:700; letter-spacing:.2px; }
    /* The dim italics carry TONE (an aside, a stage direction) — keep them dimmer than
       the dialogue, but nowhere near invisible: 0.6/0.55 was unreadable at this size. */
    #tablet-os-overlay .tos-tv-screen .tv-msg-ambient { opacity:.82; }
    #tablet-os-overlay .tos-tv-screen .tv-msg-stage_direction { opacity:.8; font-size:.94em; }
    /* ASCII art is auto-fitted per-frame by tv.js, so it sets its own size — just stop
       the bold from closing up the character cells. */
    #tablet-os-overlay .tos-tv-screen .tv-msg-ascii-art,
    #tablet-os-overlay .tos-tv-screen .tv-msg-ascii_art { font-weight:400; text-shadow:0 0 2px rgba(0,0,0,.9); }
    /* The bugs: small standing panels over the picture, so they need the size floor most. */
    #tablet-os-overlay .tos-tv-screen [data-tv="scorebug"] { font-size:12px; font-weight:700; }
    #tablet-os-overlay .tos-tv-screen [data-tv="standings"] { font-size:11px; }
    /* Guide/standings full-screen panels: their greys are 0.35–0.5 alpha for a big CRT. */
    #tablet-os-overlay .tos-tv-screen .tv-sched-dur { color:rgba(220,240,235,.62); font-size:11.5px; }
    #tablet-os-overlay .tos-tv-screen .tv-sched-foot { color:rgba(220,240,235,.55); font-size:11px; }
    #tablet-os-overlay .tos-tv-screen .tv-sched-empty { color:rgba(220,240,235,.75); }
    #tablet-os-overlay .tos-tv-screen .tv-overlay-lt-name { font-size:15px; font-weight:800; letter-spacing:.4px; }
    #tablet-os-overlay .tos-tv-screen .tv-overlay-lt-sub { font-size:11.5px; font-weight:600; opacity:.9; }
    /* Chassis type around the picture — the station bar and the ticker read as labels,
       so they gain weight and a little size without losing their all-caps tracking. */
    #tablet-os-overlay .tos-tv-bar { font-size:11px; font-weight:700; }
    #tablet-os-overlay .tos-tv-prog { opacity:.9; font-weight:600; }
    #tablet-os-overlay .tos-tv-live { font-size:9px; font-weight:800; }
    #tablet-os-overlay .tos-tv-ticker { font-size:11.5px; font-weight:700; }
    /* Ticker strip */
    #tablet-os-overlay .tos-tv-ticker { overflow:hidden; white-space:nowrap; padding:4px 0; min-height:18px;
      border-top:1px solid var(--tv-border); color:var(--tv-ticker-color); font-size:10px; }
    #tablet-os-overlay .tos-tv-ticker span { display:inline-block; will-change:transform; }
    /* Controls — tablet buttons, not the CRT cabinet's knob cluster (the knob is
       kept because tv.js drives its rotation as the dial's position readout). */
    #tablet-os-overlay .tos-tv-ctl { display:flex; align-items:center; gap:6px; flex-wrap:wrap;
      padding:7px 9px; border-top:1px solid var(--tv-border); }
    #tablet-os-overlay .tos-tv-ctl button { cursor:pointer; font-family:inherit; font-size:11px; line-height:1;
      padding:5px 9px; border-radius:4px; background:var(--bg2, #0d0d16);
      border:1px solid var(--border, #2a2a40); color:var(--tos-fg); transition:color .12s, border-color .12s, box-shadow .12s; }
    #tablet-os-overlay .tos-tv-ctl button:hover { color:var(--accent); border-color:var(--accent); }
    #tablet-os-overlay .tos-tv-ctl button.on { color:var(--accent); border-color:var(--accent);
      box-shadow:0 0 8px color-mix(in srgb, var(--accent) 40%, transparent); }
    /* Gameday + Standings toggles stay hidden until a sports broadcast reveals them
       (.avail — gameday on its first at-bat payload, standings on the first score-bug). */
    #tablet-os-overlay .tos-tv-ctl button[data-tv="gameday-btn"],
    #tablet-os-overlay .tos-tv-ctl button[data-tv="standings-btn"] { display:none; }
    #tablet-os-overlay .tos-tv-ctl button[data-tv="gameday-btn"].avail,
    #tablet-os-overlay .tos-tv-ctl button[data-tv="standings-btn"].avail { display:inline-block; }
    /* CH up/down — the tablet's digital tuner. No rotary knob and no analogue
       frequency readout here (both are wall-set idioms); the tuned channel already
       reads out in the header bar. */
    #tablet-os-overlay .tos-tv-ctl button.tos-tv-ch-btn { display:inline-flex; align-items:center; gap:5px; padding:5px 10px; }
    #tablet-os-overlay .tos-tv-ch-btn .l { font-size:9px; letter-spacing:1px; opacity:.7; }
    #tablet-os-overlay .tos-tv-ch-btn .c { font-size:9px; line-height:1; }
    #tablet-os-overlay .tos-tv-ch-btn:active { transform:scale(.94); }
    /* Tuned-channel readout — the digital stand-in for the wall set's frequency dial.
       Tabular figures so the number doesn't jitter width as it changes. */
    #tablet-os-overlay .tos-tv-num { font-size:13px; font-weight:bold; letter-spacing:1px;
      color:var(--accent); font-variant-numeric:tabular-nums; min-width:56px; text-align:center;
      padding:4px 8px; border-radius:4px; background:var(--bg, #05050a);
      border:1px solid color-mix(in srgb, var(--accent) 45%, transparent);
      box-shadow:inset 0 0 8px color-mix(in srgb, var(--accent) 18%, transparent); }
    #tablet-os-overlay .tos-tv-spacer { flex:1; }
    /* Direct channel chips — the tablet-native way to jump the dial. */
    /* The dial never eats the picture: it keeps its natural height, but a long channel
       list caps out and scrolls instead of squeezing the screen above it. */
    #tablet-os-overlay .tos-tv-dial { display:flex; flex-wrap:wrap; gap:6px; flex:0 1 auto; max-height:30%; overflow-y:auto; }
    #tablet-os-overlay .tos-tv-chip { cursor:pointer; font-size:10px; padding:5px 9px; border-radius:4px;
      background:var(--bg2, #0d0d16); border:1px solid var(--border, #2a2a40); color:var(--tos-fg);
      transition:color .12s, border-color .12s; }
    #tablet-os-overlay .tos-tv-chip:hover { color:var(--accent); border-color:var(--accent); }
    #tablet-os-overlay .tos-tv-chip.on { color:var(--accent-ink, #05050a); background:var(--accent); border-color:var(--accent); }
    #tablet-os-overlay .tos-tv-chip .n { opacity:.65; margin-right:5px; }
    #tablet-os-overlay .tos-tv-chip.on .n { opacity:.8; }

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

// ── Narration ────────────────────────────────────────────────────────────────
// Reading a book aloud, using the same formant synth the TV uses
// (AudioEngine.speak / cancelSpeech, gated on the same TV-voice setting — if you
// muted the televisions you don't want a novel talking at you either).
//
// The synth has NO completion callback: TV drives it by pushing a line whenever
// one arrives and passing a `budget` so the voice fits the window. A book has no
// such external clock, so narration has to keep its own — split the chapter into
// sentences, estimate each one's duration from its word count, and schedule the
// next off a timer. `budget` is passed too, so the synth compresses rather than
// overrunning into the following sentence.
//
// A chapter can be 25k characters, which is why this never hands the whole text
// to speak() at once — one sentence per utterance keeps each one legible and
// makes Stop instant.
const NARRATE_WPS = 2.6;          // words/sec — matches the synth's natural pace
let _narrate = null;              // { parts, i, timer, seed, title }
let _narrateKeepOnClose = false;  // set by Minimize, consumed by close()

// The ONE place a chapter is cut into utterances. The renderer wraps each part in
// a span carrying its index and the narrator walks the same array, so the
// highlight can never drift out of step with the voice — two separate splits
// would desynchronise the moment either regex changed.
function narrateSplit(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    // A Victorian clause-pile can run 400 characters; break those on commas so no
    // single utterance is a 40-second sprint.
    .flatMap(s => s.length > 220 ? s.split(/(?<=,)\s+/) : [s])
    .map(s => s.trim())
    .filter(s => /[a-z0-9]/i.test(s));
}

function narrateStop() {
  if (_narrate?.timer) clearTimeout(_narrate.timer);
  _narrate = null;
  try { window.AudioEngine?.cancelSpeech?.(); } catch { /* audio may not be up */ }
  clearNarrateHighlight();
  syncNarrateBar();
  syncNarratePill();
}

// `onEnd` — an optional callback returning `{ text, title }` for whatever comes
// after this chapter, or nothing to stop. It is captured on the narration state
// for the same reason the lexicon is: narration outlives a minimize, and by then
// _data is null, so anything read at speak time would be gone.
function narrateStart(text, seed, title, lex, onEnd) {
  narrateStop();
  // `text` may be a pre-split array of utterances. A caller that has already
  // NUMBERED its spans must hand over that exact array — see codexNarrationParts
  // for why re-splitting a rejoined string can silently shift every index.
  const parts = Array.isArray(text) ? text.slice() : narrateSplit(text);
  if (!parts.length) return;
  // The lexicon is captured HERE rather than read from _data at speak time:
  // narration deliberately outlives a minimize, by which point _data is null.
  _narrate = { parts, i: 0, timer: null, seed: seed || 'library', title: title || 'Reading', lex: lex || null, onEnd: onEnd || null };
  narrateNext();
  syncNarrateBar();
}

function clearNarrateHighlight() {
  _overlay?.querySelectorAll('.tos-narr-on').forEach(el => el.classList.remove('tos-narr-on'));
}

function narrateNext() {
  if (!_narrate) return;
  const { parts, i, seed } = _narrate;
  if (i >= parts.length) {
    // End of the chapter. If the reader supplied a way on, take it rather than
    // going silent — being made to walk back to the tablet and press play every
    // few minutes is the thing that stops anyone finishing a book. Deliberately
    // asked for LAZILY (a callback, not a precomputed next) so it sees the state
    // as it is now, and can decline by returning nothing at the end of a volume.
    const advance = _narrate.onEnd;
    if (advance) {
      const nextUp = advance();
      if (nextUp?.text) {
        // A beat longer than the between-sentence pause: a chapter break should
        // be audible as a break.
        const { text, title } = nextUp;
        _narrate.timer = setTimeout(() => {
          if (!_narrate) return;                  // stopped during the gap
          narrateStart(text, _narrate.seed, title || _narrate.title, _narrate.lex, advance);
        }, 1000);
        return;
      }
    }
    narrateStop();
    return;
  }
  const line = parts[i];
  const words = line.split(/\s+/).length;
  const budget = Math.max(1.0, words / NARRATE_WPS);
  // RP for the library. The shelf is Forster, Wells, Swift, London and two
  // translations into Edwardian English — an American newsreader voice reading
  // "The Machine Stops" fights the prose. Non-rhotic is the whole trick.
  // speak() reports what it actually scheduled. Pacing off that instead of the
  // word-count estimate removes the dead air a generous guess used to leave
  // between sentences — the reason the old delivery dragged.
  let spoken = 0;
  try {
    const r = window.AudioEngine?.speak?.(line, { seed, budget, accent: 'rp', lex: _narrate.lex });
    spoken = Number(r?.duration) || 0;
  } catch { /* keep reading */ }

  // Follow the voice. Guarded on _overlay because narration deliberately outlives
  // a minimize — with the tablet closed there is simply nothing to light up.
  clearNarrateHighlight();
  const span = _overlay?.querySelector(`.tos-narr-s[data-s="${i}"]`);
  if (span) {
    span.classList.add('tos-narr-on');
    // Keep the spoken line on screen, but only nudge — `center` would yank the
    // page on every sentence and make it unreadable for anyone following along.
    try { span.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* older engines */ }
  }

  _narrate.i = i + 1;
  syncNarratePill();
  // A beat of air between sentences, so it reads rather than gabbles. Measured
  // from the real length where we have it (muted voice → 0 → fall back to the
  // estimate, so a silent read still turns the page).
  const NARRATE_GAP_MS = 200;
  _narrate.timer = setTimeout(narrateNext, (spoken || budget) * 1000 + NARRATE_GAP_MS);
}

// Body prose with every utterance individually addressable, so the narrator can
// light the sentence it's on. Indices come from narrateSplit — the SAME call the
// voice walks — so span N is always the text of utterance N.
//
// Paragraphs are preserved by splitting on blank lines first and only then
// numbering sentences continuously across them; numbering per-paragraph would
// restart the index and break the mapping.
function renderNarratableBody(body, glossary) {
  let n = 0;
  return String(body).split(/\n{2,}/).map(para => {
    const spans = narrateSplit(para).map(s =>
      `<span class="tos-narr-s" data-s="${n++}">${glossWords(esc(s), glossary)}</span>`).join(' ');
    // A paragraph with no speakable sentence (a rule, a row of asterisks) still
    // has to render, or the page silently loses it.
    return `<p>${spans || glossWords(esc(para), glossary)}</p>`;
  }).join('');
}

// Underline the archaic words this chapter actually contains. Runs AFTER esc(),
// on already-escaped text, and only ever matches [A-Za-z'-] runs — so it cannot
// land inside an entity (`&amp;`) or invent a tag. The gloss itself goes in a
// data- attribute rather than the markup, so nothing user-visible changes length
// and the narration split above stays character-aligned.
function glossWords(escaped, glossary) {
  if (!glossary) return escaped;
  return escaped.replace(/[A-Za-z][A-Za-z'-]*/g, (w) => {
    const g = glossary[w.toLowerCase()];
    if (!g) return w;
    return `<b class="tos-gloss" data-gloss="${esc(g)}" data-term="${esc(w)}">${w}</b>`;
  });
}

function renderNarrateBar() {
  const on = !!_narrate;
  return `<div class="tos-narrate">
    <button class="tos-btn tos-narrate-btn" data-narrate="${on ? 'stop' : 'start'}">${on ? '■ Stop' : '▶ Read Aloud'}</button>
    <button class="tos-btn tos-narrate-min" data-narrate="min"${on ? '' : ' disabled'}>▾ Minimize</button>
    <span class="tos-narrate-hint">${on ? 'Narrating…' : 'Uses the TV voice setting'}</span>
  </div>`;
}

// Reflect narration state without a re-render — a full redraw would scroll the
// reader back to the top mid-paragraph and lose the highlight.
function syncNarrateBar() {
  const btn = _overlay?.querySelector('.tos-narrate-btn');
  if (!btn) return;
  const on = !!_narrate;
  btn.setAttribute('data-narrate', on ? 'stop' : 'start');
  btn.textContent = on ? '■ Stop' : '▶ Read Aloud';
  const min = _overlay.querySelector('.tos-narrate-min');
  if (min) min.disabled = !on;
  const hint = _overlay.querySelector('.tos-narrate-hint');
  if (hint) hint.textContent = on ? 'Narrating…' : 'Uses the TV voice setting';
}

// ── The minimized pill ───────────────────────────────────────────────────────
// Narration outliving the tablet needs a visible owner — something that says what
// is talking and can stop it without reopening the app. Lives outside the overlay
// entirely, because the overlay is exactly what just went away.
function syncNarratePill() {
  let pill = document.getElementById('tos-narrate-pill');
  const showing = !!_narrate && !_overlay;
  if (!showing) { pill?.remove(); return; }
  if (!pill) {
    pill = document.createElement('div');
    pill.id = 'tos-narrate-pill';
    pill.innerHTML = `<span class="tnp-title"></span><span class="tnp-prog"></span>
      <button class="tnp-stop" title="Stop narration">■</button>`;
    pill.querySelector('.tnp-stop').addEventListener('click', () => narrateStop());
    // Tapping the pill itself reopens the tablet where you left off.
    pill.addEventListener('click', (e) => {
      if (e.target.closest('.tnp-stop')) return;
      sendCmdSilent('tablet');
    });
    document.body.appendChild(pill);
  }
  pill.querySelector('.tnp-title').textContent = `▶ ${_narrate.title}`;
  pill.querySelector('.tnp-prog').textContent = `${Math.min(_narrate.i, _narrate.parts.length)}/${_narrate.parts.length}`;
}

// ── Back stack ───────────────────────────────────────────────────────────────
// Back used to be computed from the breadcrumb, which could only ever answer
// "app root or Home" — so three levels into an app it skipped the level you came
// from. This is a real history instead: every nav() records the screen you were
// ON before it moved you, and Back pops one entry. Home clears it.
//
// Entries are the nav ARGUMENTS (appId/screen/params), not the rendered payload,
// because those are the only thing that can be replayed to the server verbatim.
// `null` is a legal entry and means the home screen.
//
// Some screens are reached by an ACTION rather than a nav (a Job Board posting, a
// bliss listing, a reel) — those can't be replayed as `tabletnav`, so they aren't
// stack entries. Instead we count how many action-screens deep we've gone since the
// last real nav (_actDepth, incremented in render() when an action actually changed
// the screen) and Back returns to that nav rather than popping past it. Without this
// an action-reached screen popped a level it never occupied — from an app root, Home.
const NAV_STACK_MAX = 24;   // a back stack, not an audit log
let _navStack = [];
let _navHere = null;        // the nav that produced the current screen (null = home)
let _navSig = null;         // signature of the screen currently rendered
let _lastWasAct = false;    // the pending round trip was an action, not a nav
let _actDepth = 0;          // action-driven screen changes since the last nav

// Identity of a rendered screen, used only to notice that an action moved us.
function screenSig(d) {
  if (!d) return null;
  return [d.appId || '', d.view || '', (d.breadcrumb || []).join('>'),
          d.focusId || d.quest?.id || d.detail?.id || ''].join('|');
}

const navSame = (a, b) =>
  (a === null || b === null) ? a === b
    : a.appId === b.appId && a.screen === b.screen && a.params === b.params;

// Replay a recorded entry WITHOUT pushing it back onto the stack.
function navTo(entry) {
  if (!entry) { home(); return; }
  narrateStop();
  _lastWasAct = false; _actDepth = 0;
  _tosCorpPage = 0; _tosIdeoPage = 0; _tosCodexCh = null;
  sfx(TOS_SELECT_DEF);
  _navHere = entry;
  const parts = ['tabletnav', entry.appId];
  if (entry.screen != null) parts.push(screenToken(entry.screen));
  if (entry.params) parts.push(entry.params);
  sendCmdSilent(parts.join(' '));
}

// One level up. Falls back to Home when there's nothing left to pop.
function navBack() {
  // Standing on an action-reached screen: step back onto the nav that led here
  // (collapsing any chain of actions), without consuming a stack entry.
  if (_actDepth > 0) { _actDepth = 0; navTo(_navHere); return; }
  if (!_navStack.length) { home(); return; }
  navTo(_navStack.pop());
}

// `replace` swaps the current history entry instead of pushing a new one. Used by
// the in-app tab strip: tabs are lateral moves within one screen, not a drill-in,
// so Back must leave the app the way it came rather than walking the tabs you tried.
function nav(appId, screenLabel, params, replace) {
  narrateStop();   // turning the page stops the previous page reading
  _tosSelectMode = false;  // leaving Home disarms the home-grid selection mode
  // Remember where we were, unless it's where we're already going (re-navving the
  // same screen — the surveillance poller does this every 5s — must not stack up).
  const next = { appId, screen: screenLabel ?? null, params: params ?? null };
  if (!replace && !navSame(_navHere, next)) {
    _navStack.push(_navHere);
    if (_navStack.length > NAV_STACK_MAX) _navStack.shift();
  }
  _navHere = next;
  _lastWasAct = false; _actDepth = 0; // a real nav is the new floor for action depth
  _tosCorpPage = 0;  // land on the corp Overview page on any server-side navigation
  _tosIdeoPage = 0;   // land on the Orders Overview page on any server-side navigation
  _tosCodexCh = null; // …and on a volume's contents, not whatever was last read
  sfx(TOS_SELECT_DEF);
  const parts = ['tabletnav', appId];
  if (screenLabel != null) parts.push(screenToken(screenLabel));
  if (params) parts.push(params);
  sendCmdSilent(parts.join(' '));
}

function act(appId, actionId, params) {
  narrateStop();   // Next/Back/Contents all leave this page
  // If this action turns out to change the screen, render() counts it as a level.
  _lastWasAct = true;
  sfx(TOS_SELECT_DEF);
  const parts = ['tabletaction', appId, actionId];
  if (params) parts.push(params);
  sendCmdSilent(parts.join(' '));
}

function home() {
  _lastWasAct = false; _actDepth = 0;
  _navStack = [];    // home is the floor — nothing above it to go back to
  _navHere = null;
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

// DEADHEAD live tracking: while she's actually moving, re-pull the app so the aeroplane marker
// walks the map instead of freezing wherever it was when you opened it. Same silent re-nav as
// pollSurveillance. 2s is deliberately slower than the crew tick (2.5s) is fast — the CSS transition
// on the marker covers the gap between pushes, so this buys smooth motion without a chatty poll.
// Self-cancelling: the moment the view changes or she stops moving, the timer tears itself down.
let _dhTimer = null;
function pollDeadhead() {
  if (!_overlay || !_data || _data.view !== 'deadhead' || !_data.deadhead?.moving) {
    if (_dhTimer) { clearInterval(_dhTimer); _dhTimer = null; }
    return;
  }
  sendCmdSilent('tabletnav deadhead');
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

// A cell-signal indicator in the header. Full bars on the grid; a steady "VOIDLINK"
// badge once out on a crossing — see the module banner above, this no longer tracks
// live hunting state, just whether you're currently off the grid at all.
function buildSignal() {
  const bars = [1, 2, 3, 4].map(i => `<span class="tos-sig-bar on" style="height:${i * 2 + 1}px"></span>`).join('');
  return `<span class="tos-signal" id="tos-signal-live" title="Signal"><span class="tos-sig-bars">${bars}</span></span>`;
}
function renderSignal() {
  if (!isOnCrossing()) return buildSignal();
  if (_voidSearching) {
    return `<span class="tos-void-badge searching" id="tos-signal-live" title="No signal — move the tablet to search">`
      + `<span class="tos-void-badge-dot"></span>No signal · searching</span>`;
  }
  return `<span class="tos-void-badge" id="tos-signal-live" title="Weak carrier — voidlink, off the grid">`
    + `<span class="tos-void-badge-dot"></span>Weak signal · off grid</span>`;
}

// Persistent off-grid theming for the rest of a crossing, reapplied on every render
// (cheap: classList toggles). Purely cosmetic — the CSS (.tos-void-mode) drives the
// scanline haze, drift band and vignette pulse, and .tos-void-searching drives the
// text-only flicker before the carrier locks; nothing here gates an app.
function applyVoidMode() {
  const on = isOnCrossing();
  const panel = _overlay?.querySelector('.tos-panel');
  if (!panel) return;
  panel.classList.toggle('tos-void-mode', on);
  panel.classList.toggle('tos-void-searching', on && _voidSearching);
  // Off the grid the device isn't ArchitectOS any more — it's running its own
  // firmware, and the chassis header says so.
  const title = _overlay.querySelector('.mg-head .mg-brand-name');
  if (title) title.textContent = on ? 'VOIDLINK' : 'ARCHITECT OS';
  const sub = _overlay.querySelector('.mg-head .mg-subtitle');
  if (sub) sub.textContent = on ? 'Local Firmware · Off Grid' : 'Tablet Interface';
  if (on && _voidSearching) armVoidHunt();
}

// The one-shot void cold start: swaps the normal ARCHITECT OS boot screen for the
// tablet's own firmware terminal, which fails the grid handshake and falls back to
// VOIDLINK LOCAL, then hands off to the SEARCHING state. Only ever called once per
// crossing (see _voidTripPrimed / openTabletPanel).
const VOID_BOOT_LINES = [
  { cls: 'hd', text: 'VOIDLINK FIRMWARE 3.1.7-w' },
  { cls: 'rule' },
  { text: 'cold start ................. ', tail: 'OK', ok: true },
  { text: 'antenna array .............. ', tail: 'OK', ok: true },
  { text: 'uplink architectOS ......... ', tail: 'NO CARRIER', fail: true, wait: 700 },
  { text: 'retry 1/2 .................. ', tail: 'NO CARRIER', fail: true, wait: 620 },
  { text: 'retry 2/2 .................. ', tail: 'NO CARRIER', fail: true, wait: 620 },
  { text: 'grid services .............. ', tail: 'UNREACHABLE', fail: true },
  { text: 'fallback ................... ', tail: 'VOIDLINK LOCAL', ok: true, wait: 500 },
  { text: 'mounting cached apps ....... ', tail: 'OK', ok: true },
  { cls: 'hero', text: '◈ VOIDLINK LOCAL — NO GRID', wait: 900 },
];
const VOID_BOOT_STEP_MS = 260;
function runVoidFirmwareBoot() {
  const boot = _overlay?.querySelector('#tos-boot');
  if (!boot) { finishVoidBoot(); return; }
  boot.outerHTML = `<div class="tos-void-boot" id="tos-boot"></div>`;
  const host = _overlay.querySelector('#tos-boot');
  let i = 0, timer = null;
  const step = () => {
    if (!host?.isConnected) { cleanup(); return; }
    if (i >= VOID_BOOT_LINES.length) { cleanup(); finishVoidBoot(); return; }
    const l = VOID_BOOT_LINES[i++];
    if (l.cls === 'rule') host.insertAdjacentHTML('beforeend', `<div class="tos-void-boot-rule"></div>`);
    else if (l.cls === 'hd') host.insertAdjacentHTML('beforeend', `<div class="tos-void-boot-hd">${esc(l.text)}</div>`);
    else if (l.cls === 'hero') host.insertAdjacentHTML('beforeend', `<div class="tos-void-bootline hero">${esc(l.text)}<span class="tos-void-bootcur"></span></div>`);
    else {
      host.insertAdjacentHTML('beforeend',
        `<div class="tos-void-bootline ${l.fail ? 'fail' : 'ok'}">&gt; ${esc(l.text)}<b>${esc(l.tail)}</b></div>`);
      window.AudioEngine?.playSfx(l.fail ? VOID_CRACKLE_DEF : VOID_BOOT_TICK_DEF, TABLET_SFX_GAIN);
    }
    timer = setTimeout(step, l.wait || VOID_BOOT_STEP_MS);
  };
  function cleanup() { clearTimeout(timer); _voidIntro = null; }
  _voidIntro = { cancel: cleanup };
  timer = setTimeout(step, 220);
}

// Firmware boot done → the OS comes up in the SEARCHING state (unless this crossing
// already locked a carrier), which renders the real screen with flickering text and
// arms the drag-to-lock hunt.
function finishVoidBoot() {
  if (!_voidLocked) _voidSearching = true;
  render();
}

// "Move the tablet into the right position": while SEARCHING, actually dragging the
// tablet (not merely grabbing it) is what finds the carrier. One real drag locks it
// for the rest of the crossing — moving it again afterwards changes nothing.
const VOID_HUNT_PX = 60; // drag distance that counts as having found the position
function armVoidHunt() {
  if (_voidHunt || !_overlay) return;
  const head = _overlay.querySelector('.mg-head');
  if (!head) return;
  let from = null;
  const pt = e => (e.touches?.[0] || e);
  const down = (e) => { if (e.target.closest('button')) return; const p = pt(e); from = { x: p.clientX, y: p.clientY }; };
  const move = (e) => {
    if (!from) return;
    const p = pt(e);
    if (Math.hypot(p.clientX - from.x, p.clientY - from.y) >= VOID_HUNT_PX) lockVoidSignal();
  };
  const up = () => { from = null; };
  head.addEventListener('mousedown', down);
  head.addEventListener('touchstart', down, { passive: true });
  document.addEventListener('mousemove', move);
  document.addEventListener('touchmove', move, { passive: true });
  document.addEventListener('mouseup', up);
  document.addEventListener('touchend', up);
  const cancel = () => {
    head.removeEventListener('mousedown', down);
    head.removeEventListener('touchstart', down);
    document.removeEventListener('mousemove', move);
    document.removeEventListener('touchmove', move);
    document.removeEventListener('mouseup', up);
    document.removeEventListener('touchend', up);
    _voidHunt = null;
  };
  _voidHunt = { cancel };
}

function lockVoidSignal() {
  if (_voidLocked) return;
  _voidLocked = true;
  _voidSearching = false;
  _voidHunt?.cancel();
  const panel = _overlay?.querySelector('.tos-panel');
  window.AudioEngine?.playSfx(VOID_SIGNAL_FOUND_DEF, TABLET_SFX_GAIN);
  panel?.classList.add('tos-void-lock');
  setTimeout(() => panel?.classList.remove('tos-void-lock'), 720);
  render();
}

// Header: date and place on the left, then the CLOCK and the signal bars together
// on the right — the corner every phone has trained people to look at for the time.
// The clock is deliberately the largest thing in the bar; it was previously the same
// 11px as everything else and got lost next to the location string.
//
// It also opens the Alarm app, because a clock you can't set an alarm on is just a
// label. The generic [data-nav-app] handler does the navigation, so this needs no
// wiring of its own.
function renderHeader(d) {
  const time = esc(d.time?.time || '');
  return `<div class="tos-hdr">`
    + `<span class="tos-hdr-left">${esc(d.time?.date || '')}</span>`
    + `<span class="tos-hdr-right">`
      + `<span class="tos-hdr-loc">${esc(d.location || '')}</span>`
      + `<button type="button" class="tos-hdr-clock" data-nav-app="alarm"`
      + ` title="${time} — set an alarm">${time}</button>`
      + renderSignal()
    + `</span></div>`;
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
  // Gear = the equipment/paperdoll app: a vest silhouette (matches the doll
  // theme), monochrome like every other tile so it drops the off-palette 🧥 emoji.
  gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M9 3l3 2.5L15 3l4 3-2.5 3.5V21H7.5V9.5L5 6z" fill="currentColor" fill-opacity=".22" stroke="none"/><path d="M9 3l3 2.5L15 3l4 3-2.5 3.5V21H7.5V9.5L5 6z"/><path d="M12 5.5V21"/></svg>`,
  skills: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M12 2.5l2.6 5.3 5.9.9-4.25 4.15 1 5.75L12 15.9 6.75 18.6l1-5.75L3.5 8.7l5.9-.9z" fill="currentColor" fill-opacity=".22" stroke="none"/><path d="M12 2.5l2.6 5.3 5.9.9-4.25 4.15 1 5.75L12 15.9 6.75 18.6l1-5.75L3.5 8.7l5.9-.9z"/></svg>`,
  weather: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><circle class="dim" cx="8" cy="8" r="3" fill="currentColor" fill-opacity=".3"/><circle cx="8" cy="8" r="3"/><path d="M8 2.2v1.6M8 12.2v1.6M2.2 8h1.6M12.2 8h1.6M4.1 4.1l1.1 1.1M10.8 10.8l1.1 1.1M11.9 4.1l-1.1 1.1M5.2 10.8l-1.1 1.1"/><path d="M9 18a3.5 3.5 0 0 1 .5-6.96A4.5 4.5 0 0 1 18 12.5a3 3 0 0 1-.4 5.5z" fill="currentColor" fill-opacity=".12"/></svg>`,
  vehicles: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M12 2l2.5 6.5L21 12v2l-6.5-2v4l2.5 2v1.5L12 18l-5 1.5V18l2.5-2v-4L3 14v-2l6.5-3.5z" fill="currentColor" fill-opacity=".22" stroke="none"/><path d="M12 2l2.5 6.5L21 12v2l-6.5-2v4l2.5 2v1.5L12 18l-5 1.5V18l2.5-2v-4L3 14v-2l6.5-3.5z"/></svg>`,
  specter: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M3 7l13-3 1.2 4.4-13 3z" fill="currentColor" fill-opacity=".25" stroke="none"/><path d="M3 7l13-3 1.2 4.4-13 3z"/><path d="M17.6 6.2l3.4-1 .7 2.6-3.4 1"/><path d="M6 11.2V15a2 2 0 0 0 2 2h1"/><circle cx="9" cy="20" r="2"/><path d="M12.5 9.5l2.5 3.5"/></svg>`,
  chat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M4 4h16v11H8l-4 4z" fill="currentColor" fill-opacity=".22" stroke="none"/><path d="M4 4h16v11H8l-4 4z"/><path d="M8 8h8M8 11h5"/></svg>`,
  // News = "The Coldwater Sentinel" newsprint sheet: a folded broadsheet with a
  // masthead band and columns, monochrome like the rest so it drops the 📰 emoji.
  news: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M4 4h16v16l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2z" fill="currentColor" fill-opacity=".2" stroke="none"/><path d="M4 4h16v16l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2z"/><path d="M7 7h10"/><path d="M7 10.5h4.5v4H7z"/><path d="M13.5 10.5H17M13.5 13H17M7 16.5h10"/></svg>`,
  // Codex = an open record: two leaves off a centre spine, ruled text on the
  // left, and on the right the crosshair-and-marker of the Orders compass — the
  // two halves of the app in one mark (the world, and where you stand in it).
  // Monochrome, same stroke weight and .dim fill convention as the rest.
  // Mixology (app id is still 'bar'). Without this the tile fell through to the
  // app's own `icon: '🥃'` — a colour emoji, which cannot take `currentColor` and
  // so ignored the theme entirely while every other tile re-skinned around it.
  bar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M5.6 6.6h12.8L12 13.9z" fill="currentColor" fill-opacity=".16" stroke="none"/><path d="M4.2 5.4h15.6L12 14.4z"/><path d="M12 14.4v5"/><path d="M8.3 19.8h7.4"/><path d="M15.6 3.1l-2.2 4.4" stroke-opacity=".55"/><circle cx="13.4" cy="7.5" r="1.15" fill="currentColor" stroke="none"/></svg>`,
  // Sports. A trophy would read as "achievements"; a pennant on a staff is
  // unambiguously a league table, and it holds its shape at tile size.
  sports: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M7 4.4h12.2l-3.4 3.5 3.4 3.5H7z" fill="currentColor" fill-opacity=".16" stroke="none"/><path d="M7 4.4h12.2l-3.4 3.5 3.4 3.5H7z"/><path d="M7 2.8v18.4"/><path d="M4.6 21.2h4.8"/><path d="M10.4 7.9h4.2" stroke-opacity=".5"/></svg>`,
  codex: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M12 6.2C10.2 4.6 7.6 4 3.5 4.4v14C7.6 18 10.2 18.6 12 20.2c1.8-1.6 4.4-2.2 8.5-1.8v-14C16.4 4 13.8 4.6 12 6.2z" fill="currentColor" fill-opacity=".16" stroke="none"/><path d="M12 6.2C10.2 4.6 7.6 4 3.5 4.4v14C7.6 18 10.2 18.6 12 20.2c1.8-1.6 4.4-2.2 8.5-1.8v-14C16.4 4 13.8 4.6 12 6.2z"/><path d="M12 6.2v14"/><path d="M6 8.4h3.5M6 11.2h3.5M6 14h2.4" stroke-opacity=".75"/><circle cx="16.4" cy="11.4" r="3.1" stroke-opacity=".8"/><path d="M16.4 8.3v6.2M13.3 11.4h6.2" stroke-opacity=".45"/><circle cx="17.7" cy="10.1" r="1.15" fill="currentColor" stroke="none"/></svg>`,
  // Ideology = an alignment compass: crosshair axes + a plotted marker, the same
  // "where you stand" motif the app's charts use. Monochrome like the rest.
  // (Kept: the Ideology reader now lives as the Codex's Orders section, but this
  // mark still fronts it in any surface that keys off the old id.)
  ideology: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><circle class="dim" cx="12" cy="12" r="9" fill="currentColor" fill-opacity=".14" stroke="none"/><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18" stroke-opacity=".55"/><circle cx="15" cy="9" r="2.4" fill="currentColor" stroke="none"/></svg>`,
  // Not an SVG glyph — the circled-"A" ARCHITECT logo (same mark as the tablet's
  // own boot screen, .tos-boot-logo), so the tile reads as the game itself.
  arcade: `<span class="tos-ic-a">A</span>`,
  music: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path d="M9 18V5l11-2v13"/><circle class="dim" cx="6" cy="18" r="3" fill="currentColor" fill-opacity=".25" stroke="none"/><circle cx="6" cy="18" r="3"/><circle class="dim" cx="17" cy="16" r="3" fill="currentColor" fill-opacity=".25" stroke="none"/><circle cx="17" cy="16" r="3"/></svg>`,
  help: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><circle class="dim" cx="12" cy="12" r="9" fill="currentColor" fill-opacity=".18" stroke="none"/><circle cx="12" cy="12" r="9"/><path d="M9.1 9.3a2.9 2.9 0 0 1 5.6 1c0 1.9-2.7 2.3-2.7 4"/><circle cx="12" cy="17.3" r=".6" fill="currentColor" stroke="none"/></svg>`,
  // Calendar = a wall-calendar sheet: torn-off binding tabs, a header band, and a
  // grid of day cells, monochrome like the rest so it drops the off-palette 📅 emoji.
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path d="M8 2v3M16 2v3"/><rect x="3.5" y="5" width="17" height="16" rx="1.5"/><path class="dim" d="M3.5 9h17V6.5A1.5 1.5 0 0 0 19 5H5A1.5 1.5 0 0 0 3.5 6.5z" fill="currentColor" fill-opacity=".28" stroke="none"/><path d="M3.5 9h17"/><path d="M7.5 12.5h3M13.5 12.5h3M7.5 16.5h3M13.5 16.5h3"/></svg>`,
  // Map = a folded paper map (two creased panels), monochrome like the rest so it
  // drops the off-palette 🗺 emoji.
  map: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z" fill="currentColor" fill-opacity=".18" stroke="none"/><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/></svg>`,
  // Frontier = a compass rose: a ringed dial with a canted needle, the void-travel
  // wayfinding motif (drops the 🧭 emoji; glows via .tos-tile-glow while mid-journey).
  frontier: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><circle class="dim" cx="12" cy="12" r="9" fill="currentColor" fill-opacity=".14" stroke="none"/><circle cx="12" cy="12" r="9"/><path class="dim" d="M15 5l-7 3-3 7 7-3z" fill="currentColor" fill-opacity=".28" stroke="none"/><path d="M15 5l-7 3-3 7 7-3z"/><circle cx="12" cy="12" r=".9" fill="currentColor" stroke="none"/></svg>`,
  // Crafting = a wrench, distinct from the Settings cog (which shares the ⚙ emoji).
  crafting: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M14.6 5.4a4 4 0 0 0-5.2 5.2l-6 6 3 3 6-6a4 4 0 0 0 5.2-5.2l-2.6 2.6-2.6-.4-.4-2.6z" fill="currentColor" fill-opacity=".2" stroke="none"/><path d="M14.6 5.4a4 4 0 0 0-5.2 5.2l-6 6 3 3 6-6a4 4 0 0 0 5.2-5.2l-2.6 2.6-2.6-.4-.4-2.6z"/></svg>`,
  // Party = two figures, monochrome like the rest so it drops the 👥 emoji.
  party: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><circle cx="9" cy="8" r="3"/><path class="dim" d="M3.5 20a5.5 5.5 0 0 1 11 0z" fill="currentColor" fill-opacity=".22" stroke="none"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><circle cx="16.5" cy="8.5" r="2.5"/><path d="M14.6 15.2A5 5 0 0 1 21 20"/></svg>`,
  // DEADHEAD = an aircraft in a dashed holding orbit — the crew flying/loitering your base.
  // Monochrome (currentColor) like the rest, so it drops the off-palette ✈ emoji.
  deadhead: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><ellipse class="dim" cx="12" cy="13" rx="10" ry="6.2" fill="currentColor" fill-opacity=".12" stroke="none"/><ellipse cx="12" cy="13" rx="10" ry="6.2" stroke-opacity=".5" stroke-dasharray="2.4 2.6"/><path d="M12 4.6l1.05 5.7 4.9 2.5-4.9.7v2.2l1.7 1.6-2.75-.85-2.75.85 1.7-1.6v-2.2l-4.9-.7 4.9-2.5z" fill="currentColor" stroke="none"/></svg>`,
  // Vitals = a heart with the trace running through it: the app is meters, and
  // the meter everything else hangs off is whether you're still beating.
  health: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.4a4.7 4.7 0 0 1 8.5 2.8c0 5.8-8.5 11.3-8.5 11.3z" fill="currentColor" fill-opacity=".18" stroke="none"/><path d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.4a4.7 4.7 0 0 1 8.5 2.8c0 5.8-8.5 11.3-8.5 11.3z"/><path d="M4.6 12.4h3l1.6-3.2 2.2 5.4 1.7-3.4 1.2 1.2h4.1"/></svg>`,
  // Library = shelved spines, deliberately NOT the Codex's open book: the Codex is
  // one record you read, the Library is a shelf you choose from.
  library: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M4 5h4v14H4zM9 5h4v14H9z" fill="currentColor" fill-opacity=".2" stroke="none"/><path d="M4 5h4v14H4zM9 5h4v14H9z"/><path d="M14.4 6.3l4 1-2.6 11.4-4-1z"/><path d="M5 8.6h2M10 8.6h2"/><path d="M3 21h18"/></svg>`,
  // TV = the set, not the screen content: a CRT box with rabbit ears, matching the
  // broadcast system's own deliberately obsolete hardware.
  tv: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path d="M8.4 7L5 3M15.6 7L19 3"/><rect x="2.5" y="7" width="19" height="12" rx="1.4"/><path class="dim" d="M4.5 9h11.5v8H4.5z" fill="currentColor" fill-opacity=".24" stroke="none"/><path d="M4.5 9h11.5v8H4.5z"/><path d="M18.6 11v.01M18.6 14.4v.01" stroke-linecap="round" stroke-width="2"/><path d="M7 21h10"/></svg>`,
  // Cookbook = the pan, which is the part of cooking the app is actually about.
  cookbook: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M3 11h13v3.5a5.5 5.5 0 0 1-11 0z" fill="currentColor" fill-opacity=".22" stroke="none"/><path d="M3 11h13v3.5a5.5 5.5 0 0 1-11 0z"/><path d="M16 12.4h4.5"/><path d="M7 8.2c0-1.4 1.4-1.4 1.4-2.8S7 2.6 7 2.6M11.5 8.2c0-1.4 1.4-1.4 1.4-2.8s-1.4-2.8-1.4-2.8" stroke-opacity=".55"/></svg>`,
  // Storefront = the awning and the shutter: a shop seen from the pavement, which
  // is how a player meets one.
  storefront: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M2.5 4.5h19L20 10H4z" fill="currentColor" fill-opacity=".24" stroke="none"/><path d="M2.5 4.5h19L20 10H4z"/><path d="M4 10v10.5h16V10"/><path d="M8.5 20.5V14h7v6.5"/><path d="M8.5 4.5L8 10M15.5 4.5l.5 5.5" stroke-opacity=".5"/></svg>`,
  // Alarm = the twin-bell clock, the one shape that reads as "wakes you up" at 22px.
  alarm: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><circle class="dim" cx="12" cy="13.5" r="7.5" fill="currentColor" fill-opacity=".16" stroke="none"/><circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.6 1.7"/><path d="M4.6 4.2A4 4 0 0 0 3 7.4M19.4 4.2A4 4 0 0 1 21 7.4"/><path d="M6.2 19.8L4.6 21.6M17.8 19.8l1.6 1.8"/></svg>`,
  // Accolades = a rosette: award ribbon with a struck centre. Replaces the ▓ block,
  // which was monochrome but carried no meaning.
  accolades: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><circle class="dim" cx="12" cy="9" r="6" fill="currentColor" fill-opacity=".2" stroke="none"/><circle cx="12" cy="9" r="6"/><path d="M12 6.2l1.15 2.35 2.6.38-1.88 1.83.44 2.58L12 12.1l-2.31 1.22.44-2.58L8.25 8.9l2.6-.38z" fill="currentColor" stroke="none"/><path d="M8.4 14.3L7 21.5l5-2.4 5 2.4-1.4-7.2"/></svg>`,
  // BLISS = the heart, kept from the ♡ it replaces, redrawn at the same stroke
  // weight as every other tile so it stops reading as a text character.
  bliss: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.4a4.7 4.7 0 0 1 8.5 2.8c0 5.8-8.5 11.3-8.5 11.3z" fill="currentColor" fill-opacity=".28" stroke="none"/><path d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.4a4.7 4.7 0 0 1 8.5 2.8c0 5.8-8.5 11.3-8.5 11.3z"/><path d="M7.6 9.4a2.6 2.6 0 0 1 2.3-1.7" stroke-opacity=".55"/></svg>`,
};

// Client-only tablet apps — appended to the server-registered roster. Unlike the
// other apps (which round-trip a tablet_panel screen), Music launches the AMP
// walkman overlay (openMusicPlayerPanel), a native panel that lives outside the
// tablet chassis, so its tile is handled client-side in wireBody().
const CLIENT_APPS = [{ id: 'music', name: 'Music', category: 'Media' }];

// The player's custom home-grid arrangement is a client-only preference — a list
// of app ids in display order, cached in localStorage. It never touches the
// server; a fresh device simply falls back to registration order.
const TABLET_APP_ORDER_KEY = 'architect_tablet_app_order';
// Apps the player has flung off the home grid. Client-only, like the order — a list
// of ids; anything here is dropped from the grid and offered back under the ⊕ tile.
const TABLET_APP_HIDDEN_KEY = 'architect_tablet_hidden_apps';
// The out-of-the-box home screen: three rows of four, then the ⧉/⊕ tiles. Every
// OTHER registered app starts stashed under ⊕ — a fresh tablet shows 30-odd tiles
// otherwise, and the ones you reach for hourly (where am I, what am I wearing, am
// I dying, how wanted am I) get lost among the ones you open twice a character.
//
// The bar for a slot here is "you open it without being prompted to". Apps that
// only matter once you OWN something (properties, storefront, vehicles, corp) or
// once you're DOING something specific (crafting, cookbook, bar, frontier, sports,
// arcade, specter) are one tap away under ⊕ and stay put once added.
//
// SIXTEEN IS ONE PAGE — four rows of four (see paginateHome). It isn't a ceiling:
// a seventeenth app simply starts page 2, and a player can keep as many out as they
// like. But the DEFAULT should land on a single page, so a first login isn't handed
// a home screen it has to swipe. Adding one here means dropping one, or accepting a
// page 2 with a single tile on it.
// ORDER IS THE POINT, not just the membership: reading order, most-reached-for
// first. Row 1 is the four you open without thinking (where am I, what am I
// carrying, how am I, what am I doing). Row 2 is the day's business — people,
// money, heat, progress. Row 3 is the things you do when you have a minute. Row 4
// is reference and housekeeping, the stuff you open on purpose and rarely.
const TABLET_DEFAULT_HOME_APPS = [
  'map', 'gear', 'health', 'quests',
  'chat', 'bank', 'crime', 'skills',
  'crafting', 'news', 'music', 'calendar',
  'tv', 'codex', 'help', 'settings',
];
// Bump when TABLET_DEFAULT_HOME_APPS changes. A device that seeded its stash under
// an older default set re-seeds ONCE to the new one — without this, a player who
// first logged in when the default was twelve apps keeps that twelve forever, plus
// whatever registered afterwards, and reports (correctly) that the home screen
// doesn't match the default at all. Re-seeding does discard a custom arrangement,
// which is why it's tied to a deliberate version bump and not to the list's length.
const TABLET_HOME_SEED_VERSION = 2;
const TABLET_HOME_SEED_KEY = 'architect_tablet_home_seed_v';
let _suppressTileClick = false; // swallow the click that fires right after a drag-drop
// Home-grid selection mode (armed by the ⧉ tile). While it's on, a tile tap picks
// rather than opens, a drag anywhere over the grid lassoes, and the long-press
// reorder stands down — so nothing is competing for the same gesture.
let _tosSelectMode = false;
// True from the moment a home tile is LIFTED for reorder until the next press. The
// page-swipe handler checks it: a tile dragged sideways across the grid is a
// reorder that happens to move horizontally, not a request to turn the page, and
// the two listeners are on the same element with no other way to tell them apart.
let _homeDragLifted = false;

function loadAppOrder() {
  try { const a = JSON.parse(localStorage.getItem(TABLET_APP_ORDER_KEY)); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
function saveAppOrder(ids) {
  try { if (ids?.length) localStorage.setItem(TABLET_APP_ORDER_KEY, JSON.stringify(ids)); } catch {}
}
function loadHiddenApps() {
  try { const a = JSON.parse(localStorage.getItem(TABLET_APP_HIDDEN_KEY)); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
// Stash everything outside the default set and write it down — on first run, and
// again once whenever TABLET_HOME_SEED_VERSION moves. Materializing it rather than
// deriving it on every render is what makes a LATER-registered app appear on the
// home grid instead of silently landing in the stash: it isn't in the saved list,
// so it shows up at the end of the last page.
function seedDefaultHiddenApps(all) {
  if (!all.length) return;   // roster not in yet — don't seed an empty default
  let seeded = null;
  try { seeded = localStorage.getItem(TABLET_HOME_SEED_KEY); } catch { return; }
  // Devices from before the version key existed: treat a stash with no version as
  // version 1, so they re-seed to the current default exactly once.
  if (seeded !== null && Number(seeded) >= TABLET_HOME_SEED_VERSION) return;
  saveHiddenApps(all.filter(a => !TABLET_DEFAULT_HOME_APPS.includes(a.id)).map(a => a.id));
  // Seed the order too, so the sixteen land in the reading order above rather than
  // in whatever order the plugins happened to register.
  saveAppOrder(TABLET_DEFAULT_HOME_APPS.filter(id => all.some(a => a.id === id)));
  saveAppGroups([]);   // a re-seed can't leave a box holding apps that are now stashed
  try { localStorage.setItem(TABLET_HOME_SEED_KEY, String(TABLET_HOME_SEED_VERSION)); } catch {}
}
function saveHiddenApps(ids) {
  try { localStorage.setItem(TABLET_APP_HIDDEN_KEY, JSON.stringify(ids || [])); } catch {}
}
function hideApp(id) {
  const h = loadHiddenApps();
  if (!h.includes(id)) { h.push(id); saveHiddenApps(h); }
}
function unhideApp(id) {
  saveHiddenApps(loadHiddenApps().filter(x => x !== id));
  saveAppGroups(loadAppGroups().map(g => ({ ...g, apps: g.apps.filter(x => x !== id) })));
}

// Home-grid app groups — the same client-only, per-device preference shape as the
// order and hidden lists above: `[{ id, name, color, apps:[appId] }]`. A group is
// purely presentational (a coloured box with a name tab around a sub-grid); it
// never changes what an app IS, so the server neither knows nor cares about it.
const TABLET_APP_GROUPS_KEY = 'architect_tablet_app_groups';
// Swatches offered when naming a group. Picked to stay legible against the tab's
// dark text on every tablet theme (all are mid-to-bright, none near-black).
const TOS_GROUP_COLORS = ['#3fd0d8', '#5ad07a', '#d8c23f', '#e08a3a', '#e0413a', '#c76ad8', '#6a8fe0', '#a9b4bd'];
function loadAppGroups() {
  try {
    const a = JSON.parse(localStorage.getItem(TABLET_APP_GROUPS_KEY));
    return Array.isArray(a) ? a.filter(g => g && g.id && Array.isArray(g.apps)) : [];
  } catch { return []; }
}
function saveAppGroups(groups) {
  // Drop emptied groups on the way out — a box with nothing in it renders as a
  // floating tab and can never be repopulated except by lassoing into it.
  try { localStorage.setItem(TABLET_APP_GROUPS_KEY, JSON.stringify((groups || []).filter(g => g.apps.length))); } catch {}
}
// Put `ids` in a group, taking them out of whatever group they were in before —
// an app belongs to exactly one box. Pass a null groupId to create a new one.
//
// `cols` is THE SHAPE YOU SELECTED, and it is the whole point. Lasso a 2×2 square
// of apps and the box is 2 wide and 2 tall, sitting in those four cells; lasso a row
// of four and it's 4×1. The box was previously always full-width, which flattened
// every selection into a line — a 2×2 pick came back as 1×4, shoved the row above it
// into a ragged half-row, and pushed apps off the page. A box now spans exactly the
// cells its members occupied.
function assignAppsToGroup(ids, name, color, groupId, cols) {
  const set = new Set(ids);
  const groups = loadAppGroups().map(g => ({ ...g, apps: g.apps.filter(x => !set.has(x)) }));
  const existing = groupId ? groups.find(g => g.id === groupId) : null;
  if (existing) {
    existing.name = name; existing.color = color;
    existing.apps = [...existing.apps, ...ids];
    if (cols) existing.cols = cols;
  } else {
    groups.push({ id: 'g' + Date.now().toString(36), name, color, apps: [...ids], cols: cols || Math.min(HOME_COLS, ids.length) });
  }
  saveAppGroups(groups);
}

// How many columns a box should be, clamped to what the grid actually has.
//
// A group saved before shapes existed has no `cols`, and the fallback is SQUARE-ISH
// (ceil√n) rather than full-width: four apps become 2×2, six become 3×2, nine 3×3.
// Full-width would faithfully reproduce the old look, but the old look is the bug
// being fixed — a legacy group would keep rendering as a line until the player
// deleted and re-made it, which is a fix nobody can find. A deliberately-picked row
// of four still records cols:4 at creation and stays a row.
function groupCols(g) {
  const n = (g.apps || []).length || 1;
  const want = Number(g.cols) || Math.ceil(Math.sqrt(n));
  return Math.max(1, Math.min(HOME_COLS, want));
}

// The column count a SELECTION occupied on screen, read off the tiles' own geometry
// (distinct x-centres, snapped to tolerate sub-pixel grid maths). This is what makes
// the box remember the shape you drew rather than a shape we chose for you.
function selectionCols(tiles) {
  const xs = new Set(tiles.map(t => {
    const b = t.getBoundingClientRect();
    return Math.round((b.left + b.width / 2) / 8);   // 8px buckets — a column is far wider
  }));
  return Math.max(1, Math.min(HOME_COLS, xs.size));
}

// Reorder apps to the cached arrangement: saved-order apps first (in saved order),
// then any not yet placed (new/unsaved apps) in their natural order.
function applyAppOrder(apps) {
  const order = loadAppOrder();
  if (!order.length) return apps;
  const byId = new Map(apps.map(a => [a.id, a]));
  const ordered = [];
  for (const id of order) { if (byId.has(id)) { ordered.push(byId.get(id)); byId.delete(id); } }
  for (const a of apps) { if (byId.has(a.id)) ordered.push(a); }
  return ordered;
}

// One home-screen tile. `stashed` is only ever true in search results — an app you
// removed still turns up when you look for it by name, dimmed, and tapping it puts
// it back rather than pretending it isn't there.
function homeTile(a, stashed, extra) {
  const svg = TOS_APP_ICONS[a.id];
  const icon = svg ? svg : esc(a.icon || '▫');
  // A positive `notify` count (e.g. SPECTER reels waiting to be clipped) lights a
  // red badge on the tile.
  const n = Number(a.notify) || 0;
  const badge = n > 0 ? `<span class="tos-tile-badge">${n > 9 ? '9+' : n}</span>` : '';
  const glow = (a.id === 'frontier' && isOnCrossing()) ? ' tos-tile-glow' : '';
  const attr = stashed ? `data-search-restore="${esc(a.id)}"` : `data-nav-app="${esc(a.id)}"`;
  return `<div class="tos-tile${glow}${stashed ? ' tos-tile-stashed' : ''}${extra ? ' ' + extra : ''}" ${attr}`
    + `${stashed ? ' title="Stashed — tap to put it back"' : ''}>`
    + `${badge}<span class="tos-icon">${icon}</span><span class="tos-name">${esc(a.name)}</span></div>`;
}

function renderHomeApps(apps) {
  const roster = [...(apps || []), ...CLIENT_APPS];
  seedDefaultHiddenApps(roster);
  const hidden = new Set(loadHiddenApps());
  const all = applyAppOrder(roster).filter(a => !hidden.has(a.id));
  if (!all.length && !hidden.size) return '<div class="tos-empty">No applications registered.</div>';
  // Searching flattens everything: no pages, no boxes, no arranging — just the apps
  // that match, in order. With thirty-odd registered, typing three letters is faster
  // than remembering which page you put a thing on.
  if (_homeSearchOpen) {
    const q = _homeSearch.trim().toLowerCase();
    const hits = [...all, ...[...hidden].map(id => roster.find(a => a.id === id)).filter(Boolean)]
      .filter(a => !q || String(a.name).toLowerCase().includes(q) || a.id.includes(q));
    const grid = hits.length
      ? `<div class="tos-grid">${hits.map(a => homeTile(a, hidden.has(a.id))).join('')}</div>`
      : `<div class="tos-empty">Nothing matches “${esc(_homeSearch.trim())}”.</div>`;
    return `<div class="tos-home-apps tos-searching">${grid}${renderHomeToolbar(true)}</div>`;
  }
  const tile = (a) => homeTile(a, false);
  // Grouping draws a box around apps WHERE THEY ALREADY ARE — it never moves them.
  // Walk the saved order once; the moment we meet any member of a group we haven't
  // drawn yet, draw the whole box right there (using the members' own relative
  // order) and skip the rest of its members when we reach them later. So a group's
  // position is simply wherever its earliest member already sat — never the top of
  // the screen, never anywhere the player didn't put an app. Membership is by id,
  // so an app the server stopped registering (or one the player stashed under ⊕)
  // just drops out of its box.
  const groupOf = new Map();
  for (const g of loadAppGroups()) for (const id of g.apps) if (!groupOf.has(id)) groupOf.set(id, g);
  const drawn = new Set();
  const blocks = [];
  for (const a of all) {
    const g = groupOf.get(a.id);
    if (!g) { blocks.push({ kind: 'tile', app: a }); continue; }
    if (drawn.has(g.id)) continue;              // a later member of an already-drawn group
    drawn.add(g.id);
    const members = all.filter(x => groupOf.get(x.id)?.id === g.id);
    if (members.length) blocks.push({ kind: 'group', g, members });
  }

  const pages = paginateHome(blocks);
  if (_homePage >= pages.length) _homePage = pages.length - 1;   // pages shrank under us
  if (_homePage < 0) _homePage = 0;
  const page = pages[_homePage] || { blocks: [] };

  // ONE grid holds everything. A group box is a grid ITEM that spans the cells its
  // members occupied (cols × rows), sitting inline among the tiles — not a
  // full-width band between them. That's what keeps a 2×2 selection a 2×2 square
  // with two loose tiles beside it, instead of flattening it into a line and
  // reflowing the whole screen around the break.
  const body = page.blocks.map(b => {
    if (b.kind === 'tile') return tile(b.app);
    const { g, members } = b;
    const color = /^#[0-9a-f]{3,8}$/i.test(g.color || '') ? g.color : TOS_GROUP_COLORS[0];
    const cols = groupCols(g);
    const n = members.length;
    const rows = Math.ceil(n / cols);
    // Which of each member's four sides is on the OUTSIDE of the region. A cell's
    // right edge is exterior if it's in the last column OR nothing follows it; its
    // bottom edge is exterior if it's in the last row OR the cell below is past the
    // end. That second clause is what traces the notch of a short final row, so the
    // outline hugs the apps and the leftover cell reads as a space.
    const inner = members.map((a, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const edges = [
        row === 0 ? 'ge-t' : '',
        (col === cols - 1 || i === n - 1) ? 'ge-r' : '',
        (row === rows - 1 || i + cols >= n) ? 'ge-b' : '',
        col === 0 ? 'ge-l' : '',
      ].filter(Boolean).join(' ');
      return homeTile(a, false, edges);
    }).join('');
    return `<div class="tos-appgroup" data-group-id="${esc(g.id)}"`
      + ` style="--tos-grp:${esc(color)};--grp-cols:${cols};--grp-rows:${rows}">`
      + `<div class="tos-appgroup-tab" data-group-menu="${esc(g.id)}" title="Hold to move the group · tap to edit it">`
      + `<span class="tos-appgroup-swatch"></span><span class="tos-appgroup-nm">${esc(g.name || 'Group')}</span></div>`
      + `<div class="tos-grid tos-appgrid tos-grp-inner" data-group-grid="${esc(g.id)}">${inner}</div></div>`;
  }).join('');
  // Selection mode: tiles toggle instead of opening, dragging anywhere lassoes, and
  // a bar along the bottom holds the count and the commit.
  const bar = _tosSelectMode ? `<div class="tos-selbar">
      <span class="tos-selbar-n"><b data-sel-count>0</b> selected</span>
      <button type="button" class="tos-grp-btn" data-sel-cancel>Cancel</button>
      <button type="button" class="tos-grp-btn" data-sel-group>Group</button>
    </div>` : '';
  return `<div class="tos-home-apps${_tosSelectMode ? ' tos-selecting' : ''}" data-home-page-now="${_homePage}">`
    + `<div class="tos-grid tos-appgrid tos-homegrid" data-group-grid="">${body}</div>`
    + renderHomePager(pages.length)
    + renderHomeToolbar(false)
    + `${bar}</div>`;
}

// ── The home toolbar ─────────────────────────────────────────────────────────
// Select and Add used to be tiles, which cost two app slots and made the grid read
// as fifteen-of-sixteen. They're not apps — they're tools for arranging apps — so
// they live in one short strip under the grid instead, sharing that space with the
// widget cards below it. Everything here is an icon with a label, sized to sit on
// one line at tablet width.
//
// Search earns its place at thirty-odd registered apps: typing three letters beats
// remembering which page you put a thing on, and it looks in the stash too.
let _homeSearchOpen = false;   // is the find field showing
let _homeSearch = '';          // what's typed in it
function renderHomeToolbar(searching) {
  const btn = (attr, icon, label, title, on) =>
    `<button type="button" class="tos-hbar-btn${on ? ' on' : ''}" ${attr} title="${esc(title)}">`
    + `<span class="tos-hbar-ic">${icon}</span><span class="tos-hbar-lb">${esc(label)}</span></button>`;
  if (searching) {
    return `<div class="tos-hbar searching">
      <span class="tos-hbar-ic srch">⌕</span>
      <input class="tos-hbar-input" data-home-search-input value="${esc(_homeSearch)}" placeholder="Find an app…" spellcheck="false">
      ${btn('data-home-search-clear="1"', '✕', 'Done', 'Stop searching')}
    </div>`;
  }
  if (_tosSelectMode) return '';   // the selection bar owns the strip while picking
  return `<div class="tos-hbar">
    ${btn('data-tos-select="1"', '⧉', 'Select', 'Select apps to group')}
    ${btn('data-tos-addapps="1"', '⊕', 'Add', 'Add a stashed app back')}
    ${btn('data-home-search="1"', '⌕', 'Find', 'Search your apps')}
    ${btn('data-toggle-widgets="1"', '▤', 'Cards', 'Show or hide the home widgets', widgetsEnabled())}
  </div>`;
}

// ── Home paging ──────────────────────────────────────────────────────────────
// The grid is a fixed 4 rows of 4 — sixteen tiles to a page. Past that it doesn't
// grow, it pages, so the screen keeps one shape however many apps you keep out and
// there is no ceiling on how many that is.
//
// Packing is by whole ROWS, not by tile: a group box occupies the rows it needs
// (its label is its own first row, costing nothing extra beyond that), and loose
// tiles fill what's left, splitting across the page break wherever they land. A
// group too tall for one page gets its own and is allowed to run over — clamping
// it would silently hide apps, which is the one outcome worse than an odd page.
//
// Nothing here is stored: pages are derived from the saved order + groups every
// render, so reordering re-flows them the way a phone home screen does. `blocks`
// arrives already interleaved in reading order (see renderHomeApps) — a group and
// a run of loose tiles alternate exactly as the player's own arrangement has them;
// this function only decides where the PAGE BREAKS fall across that sequence.
//
// Select and Add are NOT in here at all — they're in the toolbar under the grid
// (renderHomeToolbar), which is what lets a page hold a full sixteen apps. As tiles
// they ate two slots and the default set read as fifteen-of-sixteen.
const HOME_COLS = 4;
const HOME_ROWS = 4;
const HOME_SLOTS = HOME_COLS * HOME_ROWS;   // 16
let _homePage = 0;   // which page is showing; survives re-renders, reset on close

// Accounting is in CELLS, and can be again now that a group box is an inline grid
// item rather than a full-width band: a tile costs 1, a box costs the block of cells
// it spans (cols × rows). The earlier fractional-row maths existed only to pay for a
// band's forced line break and its label row — neither of which happens any more, so
// the honest simple count is back. The grid packs `dense`, so a small tile backfills
// any hole a wide box leaves, which keeps the visual and this count in step.
function paginateHome(blocks) {
  const pages = [];
  let cur = { blocks: [], left: HOME_SLOTS };
  const push = () => { pages.push(cur); cur = { blocks: [], left: HOME_SLOTS }; };

  for (const b of blocks) {
    const cost = b.kind === 'group'
      ? groupCols(b.g) * Math.ceil(b.members.length / groupCols(b.g))
      : 1;
    // A box too big for a page of its own still gets one and is allowed to run over —
    // clamping it would silently hide apps, which is worse than an odd-looking page.
    if (cost > cur.left && cur.blocks.length) push();
    cur.blocks.push(b);
    cur.left = Math.max(0, cur.left - cost);
  }
  pages.push(cur);   // the trailing page (empty when there are no apps at all)
  return pages;
}

// The page dots. Hidden entirely at one page — a lone dot is noise, and the whole
// point is that a twelve-app home screen looks exactly as it did before paging
// existed. Dots are also drop targets: drag a tile onto one to send it to that
// page, which is the only way to move an app between pages.
function renderHomePager(count) {
  if (count <= 1) return '';
  const dots = Array.from({ length: count }, (_, i) =>
    `<span class="tos-page-dot${i === _homePage ? ' on' : ''}" data-home-page="${i}" title="Page ${i + 1}"></span>`).join('');
  return `<div class="tos-home-pager">
    <span class="tos-page-arrow${_homePage === 0 ? ' off' : ''}" data-home-page="${Math.max(0, _homePage - 1)}">‹</span>
    ${dots}
    <span class="tos-page-arrow${_homePage >= count - 1 ? ' off' : ''}" data-home-page="${Math.min(count - 1, _homePage + 1)}">›</span>
  </div>`;
}

// ── Home widgets ─────────────────────────────────────────────────────────────
// Cards under the app grid, contributed by the apps themselves (buildWidget on the
// server appDef — see the contract in plugins/tablet/index.js). Three kinds, and a
// card whose kind this client doesn't know is skipped rather than drawn wrong, so
// an older client meeting a newer widget degrades quietly.
// Home widgets are opt-in, per device, and OFF by default — the home screen is a
// launcher first, and a fresh player should meet a grid of apps, not a dashboard.
// Turned on under Settings → Layout → Home Widgets. Off means off: even the Wanted
// alarm stays down, because a feature you switched off should not be switchable
// back on by the game.
const TABLET_WIDGETS_KEY = 'architect_tablet_widgets';
function widgetsEnabled() {
  try { return localStorage.getItem(TABLET_WIDGETS_KEY) === 'on'; } catch { return false; }
}
function setWidgetsEnabled(on) {
  try { localStorage.setItem(TABLET_WIDGETS_KEY, on ? 'on' : 'off'); } catch {}
  _applyWidgetChrome();
}

// The chassis is sized for what's actually on the home screen: with cards off it
// sheds the height it was only holding for them. Called on open and on every toggle,
// so the device resizes in the same gesture that switches the cards.
function _applyWidgetChrome() {
  if (!_overlay) return;
  _overlay.classList.toggle('tos-no-widgets', !widgetsEnabled());
}

function renderHomeWidgets(widgets) {
  if (!widgetsEnabled()) return '';
  // A card belongs to its app: stash the app under ⊕ and its card goes with it,
  // add the app back and the card returns. The home screen you arranged is the one
  // you get. (This runs after renderHomeApps in the same template, so the first-run
  // default stash is already seeded by the time we read it.)
  //
  // The exception is a card that declares `alwaysOn` — an ALARM, whose entire job
  // is to appear uninvited. The app it opens may well be stashed; that's the point.
  // The server owns that call (see the buildWidget contract), not this list.
  const hidden = new Set(loadHiddenApps());
  const cards = (widgets || []).filter(w => w.alwaysOn || !hidden.has(w.nav)).map(w => {
    let body = '';
    if (w.kind === 'meters') {
      body = (w.rows || []).map(r => `<div class="tos-wg-meter">
        <span class="tos-wg-mlabel">${esc(r.label)}</span>
        <span class="tos-wg-mbar"><span class="tos-wg-mfill band-${esc(r.band || 'good')}" style="width:${Math.max(0, Math.min(100, Number(r.pct) || 0))}%"></span></span>
        <span class="tos-wg-mnote">${esc(r.note || '')}</span>
      </div>`).join('');
    } else if (w.kind === 'stat') {
      body = `<div class="tos-wg-stat${w.tone ? ' tone-' + esc(w.tone) : ''}">
        ${w.icon ? `<span class="tos-wg-icon">${esc(w.icon)}</span>` : ''}
        <span class="tos-wg-big">${esc(w.big ?? '')}</span>
        <span class="tos-wg-sub">${esc(w.sub || '')}</span>
      </div>${w.note ? `<div class="tos-wg-note">${esc(w.note)}</div>` : ''}`;
    } else if (w.kind === 'lines') {
      // A card should be readable at a GLANCE, so an optional glyph carries the
      // meaning and the text just confirms it. The first line is promoted to a
      // headline; the rest are quiet supporting detail.
      const ls = w.lines || [];
      const rows = ls.map((l, i) => `<div class="tos-wg-line${i === 0 ? ' lead' : ''}">`
        + `<span>${esc(l.text)}</span>${l.sub ? `<span class="tos-wg-lsub">${esc(l.sub)}</span>` : ''}</div>`).join('');
      body = w.icon
        ? `<div class="tos-wg-glyphed"><span class="tos-wg-glyph">${esc(w.icon)}</span><div class="tos-wg-lstack">${rows}</div></div>`
        : rows;
    } else if (w.kind === 'bar') {
      // A proportion, drawn. One stacked bar plus a small keyed legend — the shape
      // of the split lands before you've read a single number, which is the whole
      // reason to draw it instead of printing two figures.
      const segs = (w.segments || []).filter(s => Number(s.pct) > 0);
      const legend = (w.segments || []).map(s => `<span class="tos-wg-key">`
        + `<i class="tos-wg-swatch tone-${esc(s.tone || 'good')}"></i>${esc(s.label || '')}</span>`).join('');
      body = `<div class="tos-wg-track">${segs.map(s =>
        `<span class="tos-wg-seg tone-${esc(s.tone || 'good')}" style="flex:${Math.max(0.001, Number(s.pct) || 0)}"></span>`).join('')}</div>`
        + `<div class="tos-wg-legend">${legend}</div>`
        + (w.note ? `<div class="tos-wg-note">${esc(w.note)}</div>` : '');
    } else {
      return '';   // unknown kind — say nothing rather than something wrong
    }
    const nav = w.nav ? ` data-widget-nav="${esc(w.nav)}"` : '';
    return `<div class="tos-widget"${nav}><div class="tos-wg-title">${esc(w.title || '')}</div>${body}</div>`;
  }).filter(Boolean).join('');
  return cards ? `<div class="tos-widgets">${cards}</div>` : '';
}

// The "add removed apps" sheet — a client-side card over the home screen listing every
// app the player has flung off the grid. Tap one to put it back. No server round trip.
function openAddAppsSheet() {
  if (!_overlay) return;
  const screen = _overlay.querySelector('#tos-screen-inner');
  if (!screen) return;
  screen.querySelector('.tos-addsheet')?.remove();
  const hidden = loadHiddenApps();
  const byId = new Map([...(_data?.apps || []), ...CLIENT_APPS].map(a => [a.id, a]));
  // Alphabetical, not stash order: this list is 20-odd tiles on a fresh tablet
  // (everything outside the default sixteen), so it's a thing you scan by name.
  const apps = hidden.map(id => byId.get(id)).filter(Boolean)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  // Its own denser grid (.tos-addsheet-grid), not the home screen's 4-column one —
  // that's what keeps the whole stash on screen without a scrollbar.
  const body = apps.length
    ? `<div class="tos-addsheet-grid">${apps.map(a => {
        const svg = TOS_APP_ICONS[a.id];
        const icon = svg ? svg : esc(a.icon || '▫');
        return `<div class="tos-tile" data-readd-app="${esc(a.id)}" title="${esc(a.name)}"><span class="tos-icon">${icon}</span><span class="tos-name">${esc(a.name)}</span></div>`;
      }).join('')}</div>`
    : '<div class="tos-empty">Everything is on your home screen. Drag an app off the tablet to stash it here.</div>';
  const sheet = document.createElement('div');
  sheet.className = 'tos-addsheet';
  sheet.innerHTML = `<div class="tos-addsheet-card wide">
    <div class="tos-addsheet-hdr"><span>Add apps · ${apps.length}</span><span class="tos-addsheet-x" data-addsheet-close title="Close">✕</span></div>
    ${body}
  </div>`;
  screen.appendChild(sheet);
  sfx(TOS_SELECT_DEF);
  const close = () => sheet.remove();
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  sheet.querySelector('[data-addsheet-close]')?.addEventListener('click', close);
  sheet.querySelectorAll('[data-readd-app]').forEach(el => el.addEventListener('click', () => {
    unhideApp(el.getAttribute('data-readd-app'));
    close();
    render();  // rebuild home from _data with the app restored
  }));
}

// Long-press-to-lift drag reorder for the home app grid (the mobile home-screen
// metaphor, so it works with touch and mouse and never fights a tap-to-open or a
// scroll-swipe). Wired fresh on each home render; window listeners live only for
// the duration of a press, so re-wiring can't leak them.
function wireAppGridDrag(container) {
  const LIFT_MS = 300;   // hold this long (finger still) to pick a tile up
  const CANCEL_MOVE = 10; // moving more than this before the lift = a tap/scroll, not a pickup
  let press = null; // { tile, x, y, timer }
  let drag = null;  // { tile, clone, offX, offY }

  // AIM, don't rearrange. This only marks where the tile WOULD land; the actual
  // insert happens once, on release (see `end`). Live reflow made every tile you
  // dragged past leap out of the way, so the arrangement you were aiming at kept
  // changing under the pointer — and each insert re-flowed the grid, which flipped
  // which neighbour was "nearest" and made the placeholder flicker between slots.
  const clearDropMark = () => {
    container.querySelectorAll('.tos-drop-before, .tos-drop-after, .tos-drop-swap')
      .forEach(n => n.classList.remove('tos-drop-before', 'tos-drop-after', 'tos-drop-swap'));
  };
  const aim = (px, py) => {
    // The sweep spans EVERY app grid on the home screen (the outer one plus one per
    // group box), which is what lets a tile be aimed into or out of a group.
    const tiles = [...container.querySelectorAll('.tos-appgrid .tos-tile:not(.tos-tile-add)')];
    let target = null, best = Infinity;
    for (const t of tiles) {
      if (t === drag.tile) continue;
      const b = t.getBoundingClientRect();
      const d = Math.hypot(px - (b.left + b.width / 2), py - (b.top + b.height / 2));
      if (d < best) { best = d; target = t; }
    }
    clearDropMark();
    drag.dropTarget = target || null;
    // A SWAP, not an insert — so there's no "which side" to read. The tile you drop
    // on takes the slot you dragged from, and nothing else on the screen moves.
    // Inserting shuffled every tile after the drop point along by one, which is why
    // a small correction rearranged half the grid.
    if (target) target.classList.add('tos-drop-swap');
  };

  const begin = () => {
    const tile = press.tile;
    const r = tile.getBoundingClientRect();
    // The clone (the thing under the finger) lives on document.body so its fixed
    // coords are plain viewport pixels — but that puts it outside the tablet's
    // themed scope, so copy the resolved look across from the real tile.
    const clone = tile.cloneNode(true);
    clone.className = 'tos-tile-drag';
    const cs = getComputedStyle(tile);
    for (const p of ['backgroundColor', 'backgroundImage', 'border', 'borderRadius', 'color', 'fontFamily', 'padding']) clone.style[p] = cs[p];
    Object.assign(clone.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    document.body.appendChild(clone);
    tile.classList.add('tos-tile-ghost');
    container.classList.add('tos-grid-arranging');
    _homeDragLifted = true;   // this gesture belongs to the reorder, not to the pager
    drag = { tile, clone, offX: press.x - r.left, offY: press.y - r.top, fromGrid: tile.parentElement };
    press = null;
    sfx(TOS_SELECT_DEF);
  };

  // True when the pointer has strayed outside the tablet's screen — dropping here
  // flings the app off the grid (into the ⊕ stash) rather than reordering it.
  const offTablet = (x, y) => {
    const screen = _overlay?.querySelector('#tos-screen-inner');
    if (!screen) return false;
    const b = screen.getBoundingClientRect();
    return x < b.left || x > b.right || y < b.top || y > b.bottom;
  };

  const onMove = (e) => {
    if (drag) {
      e.preventDefault();
      drag.clone.style.left = (e.clientX - drag.offX) + 'px';
      drag.clone.style.top = (e.clientY - drag.offY) + 'px';
      drag.lastX = e.clientX; drag.lastY = e.clientY;
      const off = offTablet(e.clientX, e.clientY);
      drag.clone.classList.toggle('tos-tile-removing', off);
      if (off) { clearDropMark(); drag.dropTarget = null; } else aim(e.clientX, e.clientY);
      return;
    }
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > CANCEL_MOVE) {
      clearTimeout(press.timer); press = null; // moved before the lift → let it tap/scroll
    }
  };

  const end = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    if (press) { clearTimeout(press.timer); press = null; }
    if (drag) {
      const dropOff = offTablet(drag.lastX, drag.lastY);
      const appId = drag.tile.getAttribute('data-nav-app');
      drag.clone.remove();
      drag.tile.classList.remove('tos-tile-ghost');
      container.classList.remove('tos-grid-arranging');
      _suppressTileClick = true;                       // the drop's trailing click must not open an app
      setTimeout(() => { _suppressTileClick = false; }, 0);
      if (dropOff && appId) {
        // Flung off the tablet → stash it under ⊕ and rebuild home.
        hideApp(appId);
        drag = null;
        render();
        return;
      }
      // Dropped on a page dot → send the app to that page. Pages are derived from
      // the flat order, so "moving to page N" means splicing the id to the front of
      // the run of ids that page starts with — and since the drop point is a dot,
      // not a slot, this is the one gesture that can cross a page boundary.
      const dot = document.elementFromPoint(drag.lastX, drag.lastY)?.closest?.('[data-home-page]');
      if (dot && appId) {
        drag = null;
        moveAppToPage(container, appId, Number(dot.getAttribute('data-home-page')) || 0);
        return;
      }
      // THE ONE AND ONLY MOVE, and it's a straight SWAP: the two tiles trade places
      // and nothing else on the screen budges. Done with a marker so it's safe when
      // the two are already neighbours (the naive two-insert version collapses in
      // that case). Swapping rather than inserting is what stops a one-slot
      // correction from shunting every tile after it along by one.
      const target = drag.dropTarget;
      clearDropMark();
      if (target && target !== drag.tile) {
        const marker = document.createElement('span');
        drag.tile.parentElement.insertBefore(marker, drag.tile);
        target.parentElement.insertBefore(drag.tile, target);
        marker.parentElement.insertBefore(target, marker);
        marker.remove();
      }
      const movedBox = drag.tile.parentElement !== drag.fromGrid;
      drag = null;
      persistHomeArrangement(container);
      // Crossing between a group box and the outer grid changes a box's membership
      // (and can empty one out of existence), so that drop needs a real rebuild.
      if (movedBox) render();
    }
  };

  container.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || _tosSelectMode) return;                   // selection mode owns the gesture
    const tile = e.target.closest('.tos-tile');
    if (!tile || tile.classList.contains('tos-tile-add')) return; // ⧉/⊕ tiles aren't draggable
    press = { tile, x: e.clientX, y: e.clientY, timer: setTimeout(begin, LIFT_MS) };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });
}

// Whole-group drag: press-hold a group's LABEL (never a member tile) to lift the
// entire box and set it down next to another top-level block — another group, or a
// run of loose tiles — on the same page. A member tile keeps its own ordinary
// per-tile drag (wireAppGridDrag, above); this is a second, independent gesture
// bound to a different element, so the two can never compete for the same press.
//
// Precision is ITEM-level: the box lands beside another item in the home grid — a
// loose tile or another box — never inside one, because dropping "into" another
// group would mean picking a merge behaviour nobody asked for. Like the tile drag,
// nothing moves until you let go. Reuses persistHomeArrangement to save, because
// once the box has been moved among its DOM siblings that function's document-order
// read already sees it there.
function wireGroupDrag(container) {
  const LIFT_MS = 300;
  const CANCEL_MOVE = 10;
  let press = null;   // { box, x, y, timer }
  let drag = null;    // { box, clone, offX, offY, lastX, lastY, dropTarget, dropAfter }

  // Candidate neighbours: the home grid's own children — top-level tiles and other
  // boxes. Scoped to that one grid, so a tile living INSIDE another group is never a
  // target (that would be a merge, not a move).
  const siblings = () => {
    const grid = container.querySelector('.tos-homegrid');
    return grid ? [...grid.children].filter(el => el !== drag.box) : [];
  };

  const clearDropMark = () => {
    container.querySelectorAll('.tos-drop-before, .tos-drop-after, .tos-drop-swap')
      .forEach(n => n.classList.remove('tos-drop-before', 'tos-drop-after', 'tos-drop-swap'));
  };
  const aim = (px, py) => {
    let target = null, best = Infinity;
    for (const el of siblings()) {
      const b = el.getBoundingClientRect();
      const d = Math.hypot(px - (b.left + b.width / 2), py - (b.top + b.height / 2));
      if (d < best) { best = d; target = el; }
    }
    clearDropMark();
    drag.dropTarget = target || null;
    if (!target) { drag.dropAfter = false; return; }
    const b = target.getBoundingClientRect();
    drag.dropAfter = px > b.left + b.width / 2;
    target.classList.add(drag.dropAfter ? 'tos-drop-after' : 'tos-drop-before');
  };

  const begin = () => {
    const box = press.box;
    const r = box.getBoundingClientRect();
    const tab = box.querySelector('.tos-appgroup-tab');
    const clone = document.createElement('div');
    clone.className = 'tos-group-drag';
    clone.style.setProperty('--tos-grp', box.style.getPropertyValue('--tos-grp'));
    clone.innerHTML = `<span class="tos-appgroup-swatch"></span>`
      + `<span>${esc(tab?.querySelector('.tos-appgroup-nm')?.textContent || 'Group')}</span>`
      + `<span class="tos-appgroup-n">${esc(tab?.querySelector('.tos-appgroup-n')?.textContent || '')}</span>`;
    Object.assign(clone.style, { left: r.left + 'px', top: r.top + 'px' });
    document.body.appendChild(clone);
    box.classList.add('tos-appgroup-ghost');
    container.classList.add('tos-grid-arranging');
    drag = { box, clone, offX: press.x - r.left, offY: press.y - r.top };
    press = null;
    sfx(TOS_SELECT_DEF);
  };

  // Same "flung off the screen" test as the tile drag — dropping the box past the
  // tablet's edge stashes every app in it.
  const offTablet = (x, y) => {
    const screen = _overlay?.querySelector('#tos-screen-inner');
    if (!screen) return false;
    const b = screen.getBoundingClientRect();
    return x < b.left || x > b.right || y < b.top || y > b.bottom;
  };

  const onMove = (e) => {
    if (drag) {
      e.preventDefault();
      drag.clone.style.left = (e.clientX - drag.offX) + 'px';
      drag.clone.style.top = (e.clientY - drag.offY) + 'px';
      drag.lastX = e.clientX; drag.lastY = e.clientY;
      const off = offTablet(e.clientX, e.clientY);
      drag.clone.classList.toggle('tos-tile-removing', off);
      if (off) { clearDropMark(); drag.dropTarget = null; } else aim(e.clientX, e.clientY);
      return;
    }
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > CANCEL_MOVE) {
      clearTimeout(press.timer); press = null;
    }
  };

  const end = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    if (press) { clearTimeout(press.timer); press = null; }
    if (drag) {
      const dropOff = offTablet(drag.lastX, drag.lastY);
      const groupId = drag.box.getAttribute('data-group-id');
      drag.clone.remove();
      drag.box.classList.remove('tos-appgroup-ghost');
      container.classList.remove('tos-grid-arranging');
      _suppressTileClick = true;   // the drop's trailing click must not open the edit sheet
      setTimeout(() => { _suppressTileClick = false; }, 0);
      const group = groupId ? loadAppGroups().find(x => x.id === groupId) : null;
      if (dropOff && group) {
        // Flung the whole box off the tablet → stash every member. The group
        // definition itself is left alone (it's pruned once empty, same as a
        // single app's last member leaving), so a re-added app can rejoin it.
        group.apps.forEach(hideApp);
        drag = null;
        render();
        return;
      }
      const dot = document.elementFromPoint(drag.lastX, drag.lastY)?.closest?.('[data-home-page]');
      if (dot && group) {
        drag = null;
        moveGroupToPage(container, group.apps, Number(dot.getAttribute('data-home-page')) || 0);
        return;
      }
      // The single move, on release — same contract as the tile drag.
      const target = drag.dropTarget;
      clearDropMark();
      if (target && target !== drag.box) {
        target.parentElement.insertBefore(drag.box, drag.dropAfter ? target.nextSibling : target);
      }
      drag = null;
      persistHomeArrangement(container);   // the box's new sibling position IS the new order
    }
  };

  container.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || _tosSelectMode) return;
    const tab = e.target.closest('.tos-appgroup-tab');
    const box = tab?.closest('.tos-appgroup');
    if (!box) return;   // a press anywhere else (a member tile, empty space) isn't this gesture
    press = { box, x: e.clientX, y: e.clientY, timer: setTimeout(begin, LIFT_MS) };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });
}

// Read the home screen back out of the DOM and cache it: one flat display order
// across every grid, plus each box's membership. Called after any drop, so the
// arrangement the player sees is exactly the one that survives a re-render.
function persistHomeArrangement(container) {
  // Direct children only, so a box's members are read from the box (below) and not
  // counted twice by the outer grid's sweep.
  const idsOf = (grid) => [...grid.children]
    .filter(el => el.classList.contains('tos-tile'))
    .map(t => t.getAttribute('data-nav-app')).filter(Boolean);
  const grids = [...container.querySelectorAll('.tos-appgrid')];
  // Reading order across the whole page: walk the home grid's children in order, and
  // where a child is a box, splice its members in at that point. That's what makes a
  // group's saved position "wherever it sits", which is what the renderer reads back.
  const home = container.querySelector('.tos-homegrid');
  const visible = [];
  for (const el of (home ? [...home.children] : [])) {
    if (el.classList.contains('tos-tile')) {
      const id = el.getAttribute('data-nav-app');
      if (id) visible.push(id);
    } else if (el.classList.contains('tos-appgroup')) {
      const inner = el.querySelector('.tos-grp-inner');
      if (inner) visible.push(...idsOf(inner));
    }
  }

  // ONLY THE CURRENT PAGE IS IN THE DOM. Saving the visible ids as the whole order
  // would erase every app on every other page, so splice them back into the saved
  // order at the position the page already occupied instead of replacing it.
  const prev = loadAppOrder();
  if (prev.length) {
    const vis = new Set(visible);
    const at = prev.findIndex(id => vis.has(id));
    const rest = prev.filter(id => !vis.has(id));
    const cut = at < 0 ? rest.length : Math.min(at, rest.length);
    saveAppOrder([...rest.slice(0, cut), ...visible, ...rest.slice(cut)]);
  } else {
    saveAppOrder(visible);
  }
  // Group membership: only boxes actually on screen can have changed.
  const live = new Map(grids.map(g => [g.getAttribute('data-group-grid'), idsOf(g)]));
  saveAppGroups(loadAppGroups().map(g => live.has(g.id) ? { ...g, apps: live.get(g.id) } : g));
}

// Currently-picked tiles, and the live count on the selection bar.
function selectedAppTiles(container) {
  return [...(container || _overlay || document).querySelectorAll('.tos-tile-sel')];
}
function refreshSelCount(container) {
  const n = selectedAppTiles(container).length;
  const el = container.querySelector('[data-sel-count]');
  if (el) el.textContent = String(n);
}
// Leave selection mode and rebuild the home screen (which puts ⧉/⊕ back and drops
// the bar). Every exit route — Cancel, committing a group, navigating away — goes
// through here so the mode can never outlive the screen that shows it.
function exitAppSelectMode() {
  if (!_tosSelectMode) return;
  _tosSelectMode = false;
  render();
}

// Shared splice for both page-dot drops below: pull `ids` (in their existing
// relative order) out of the saved order and reinsert them as one run at the
// boundary the target page starts on. `HOME_SLOTS * targetPage` is an
// APPROXIMATION of where that boundary actually falls once groups are interleaved
// (a group can push the real boundary earlier or later) — close enough that the
// drop lands on the right page, and any further nudge is an ordinary drag from there.
function moveIdsToPage(container, ids, targetPage) {
  const order = [...container.querySelectorAll('.tos-appgrid .tos-tile')]
    .map(t => t.getAttribute('data-nav-app')).filter(Boolean);
  // The DOM only holds the CURRENT page, so start from the saved order (which spans
  // all of them) and fall back to the visible one if nothing has been saved yet.
  const full = loadAppOrder().length ? loadAppOrder() : order;
  const set = new Set(ids);
  const moving = full.filter(id => set.has(id));   // preserve their relative order
  const rest = full.filter(id => !set.has(id));
  const at = Math.max(0, Math.min(rest.length, targetPage * HOME_SLOTS));
  saveAppOrder([...rest.slice(0, at), ...moving, ...rest.slice(at)]);
}

// Send one app to another page. Grouped apps leave their group in the process — a
// box is laid out as a unit and can't straddle a page, so the lone app has to come
// out of it first (see moveGroupToPage for moving the whole box instead).
function moveAppToPage(container, appId, targetPage) {
  moveIdsToPage(container, [appId], targetPage);
  saveAppGroups(loadAppGroups().map(g => ({ ...g, apps: g.apps.filter(x => x !== appId) })));
  _homePage = targetPage;
  render();
}

// Send an entire GROUP to another page — every member moves together and is still
// a group when it lands, which is the whole point of dragging the box.
function moveGroupToPage(container, ids, targetPage) {
  moveIdsToPage(container, ids, targetPage);
  _homePage = targetPage;
  render();
}

// Rectangular lasso, live only while selection mode is armed: drag anywhere over
// the grid — including across tiles — and every tile the band touches joins the
// picture. It's additive, so several sweeps build one selection, and a plain tap
// toggles a single tile. Nothing here competes with the long-press reorder,
// because that stands down entirely while the mode is on.
function wireAppMarquee(container) {
  const ENGAGE = 6; // pixels of travel before a press becomes a lasso
  let sel = null;   // { x, y, band, base:Set }

  const paint = (x, y) => {
    const left = Math.min(sel.x, x), top = Math.min(sel.y, y);
    const w = Math.abs(x - sel.x), h = Math.abs(y - sel.y);
    Object.assign(sel.band.style, { left: left + 'px', top: top + 'px', width: w + 'px', height: h + 'px' });
    for (const t of container.querySelectorAll('.tos-appgrid .tos-tile:not(.tos-tile-add)')) {
      const b = t.getBoundingClientRect();
      const hit = b.right > left && b.left < left + w && b.bottom > top && b.top < top + h;
      t.classList.toggle('tos-tile-sel', hit || sel.base.has(t));
    }
    refreshSelCount(container);
  };

  const onMove = (e) => {
    if (!sel.band) {
      if (Math.hypot(e.clientX - sel.x, e.clientY - sel.y) < ENGAGE) return;
      sel.band = document.createElement('div');
      sel.band.className = 'tos-marquee';
      // The band lives on <body> (like the drag clone) so its fixed coordinates are
      // plain viewport pixels; the accent is copied across from the themed overlay.
      sel.band.style.setProperty('--mg-accent', getComputedStyle(container).getPropertyValue('--mg-accent') || '#3fd0d8');
      document.body.appendChild(sel.band);
    }
    e.preventDefault();
    paint(e.clientX, e.clientY);
  };

  const end = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    const band = sel?.band;
    sel = null;
    if (!band) return;               // never engaged — that press was a plain tap
    band.remove();
    _suppressTileClick = true;       // the lasso's trailing click must not toggle a tile
    setTimeout(() => { _suppressTileClick = false; }, 0);
    refreshSelCount(container);
  };

  container.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || !_tosSelectMode) return;
    if (e.target.closest('.tos-selbar')) return;  // the bar's own buttons
    sel = { x: e.clientX, y: e.clientY, band: null, base: new Set(selectedAppTiles(container)) };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });
}

// The group sheet — name + colour for a new box (`{ ids }`) or an existing one
// (`{ groupId }`, which also offers Ungroup). Same scrim/card chrome as the ⊕
// add-apps sheet, and like it, purely client-side.
function openGroupSheet({ ids = null, groupId = null, cols = 0 }) {
  if (!_overlay) return;
  const screen = _overlay.querySelector('#tos-screen-inner');
  if (!screen) return;
  screen.querySelector('.tos-addsheet')?.remove();
  const existing = groupId ? loadAppGroups().find(g => g.id === groupId) : null;
  if (groupId && !existing) return;
  let color = existing?.color || TOS_GROUP_COLORS[0];
  const count = existing ? existing.apps.length : ids.length;

  const sheet = document.createElement('div');
  sheet.className = 'tos-addsheet';
  sheet.innerHTML = `<div class="tos-addsheet-card">
    <div class="tos-addsheet-hdr"><span>${existing ? 'Edit group' : `New group · ${count} app${count === 1 ? '' : 's'}`}</span><span class="tos-addsheet-x" data-addsheet-close title="Close">✕</span></div>
    <input class="tos-grp-input" data-grp-name maxlength="24" placeholder="Group name" value="${esc(existing?.name || '')}">
    <div class="tos-grp-swatches">${TOS_GROUP_COLORS.map(c =>
      `<div class="tos-grp-sw${c === color ? ' on' : ''}" data-grp-color="${c}" style="background:${c}"></div>`).join('')}</div>
    <div class="tos-grp-btns">
      ${existing ? '<button type="button" class="tos-grp-btn danger" data-grp-ungroup>Ungroup</button>' : ''}
      <button type="button" class="tos-grp-btn" data-addsheet-close>Cancel</button>
      <button type="button" class="tos-grp-btn" data-grp-save>${existing ? 'Save' : 'Create'}</button>
    </div>
  </div>`;
  screen.appendChild(sheet);
  sfx(TOS_SELECT_DEF);
  const close = () => sheet.remove();
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  sheet.querySelectorAll('[data-addsheet-close]').forEach(el => el.addEventListener('click', close));
  sheet.querySelectorAll('[data-grp-color]').forEach(el => el.addEventListener('click', () => {
    color = el.getAttribute('data-grp-color');
    sheet.querySelectorAll('[data-grp-color]').forEach(s => s.classList.toggle('on', s === el));
  }));
  const input = sheet.querySelector('[data-grp-name]');
  input?.focus();
  const save = () => {
    const name = (input?.value || '').trim() || 'Group';
    assignAppsToGroup(existing ? [] : ids, name, color, existing ? existing.id : null, cols);
    close();
    _tosSelectMode = false;   // the pick is spent; the rebuild below drops the bar
    render();
  };
  sheet.querySelector('[data-grp-save]')?.addEventListener('click', save);
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  sheet.querySelector('[data-grp-ungroup]')?.addEventListener('click', () => {
    saveAppGroups(loadAppGroups().filter(g => g.id !== existing.id));
    close();
    render();  // the freed apps fall back into the loose grid in their saved order
  });
}

// Drag-to-scroll (grab-and-pan) for any tablet screen that overflows. Wired once
// on the persistent #tos-scroll container (only its innerHTML swaps per render).
// A press that starts on an interactive control — an input the player is typing
// in, or a home tile that owns its own long-press reorder — is left alone; the
// gesture only engages once the finger moves past a threshold, and it suppresses
// the trailing click so a drag never doubles as a tap-open.
function wireDragScroll(scroll) {
  const THRESH = 6;      // px of movement before a press becomes a gesture (below = a tap)
  const SWIPE_MIN = 45;  // px of horizontal travel to commit a page change
  let start = null;      // { x, y, top, dragging, axis, dx }
  // Horizontal swipe pages the alignment reader — now reached as the Codex's
  // Orders section, so the test is the section kind, not the view name.
  const ideoActive = () => _data?.view === 'codex' && _data?.sectionKind === 'orders';

  // `.tos-al-reel` is here because the alarm reels run their OWN grab-and-pull
  // (see the alarm wiring). Without this the same press would scrub the reel and
  // pan the screen behind it at once, and the time you let go on wouldn't be the
  // time you dragged to.
  const isInteractive = (el) =>
    el.closest('input, textarea, select, button, [contenteditable], .tos-tile, .tos-color, input[type=range], .tos-al-reel');

  const onMove = (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!start.dragging) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < THRESH) return;
      start.dragging = true;
      // Lock the axis at the threshold. Only the Ideology reader claims the
      // horizontal axis (to page); everywhere else a gesture is vertical pan.
      start.axis = (ideoActive() && Math.abs(dx) > Math.abs(dy) * 1.2) ? 'x' : 'y';
      if (start.axis === 'y') scroll.classList.add('tos-drag-scrolling');
    }
    if (start.axis === 'x') { start.dx = dx; e.preventDefault(); return; } // swipe: commit on release
    e.preventDefault();
    scroll.scrollTop = start.top - dy;
  };

  const end = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    if (start?.dragging) {
      scroll.classList.remove('tos-drag-scrolling');
      if (start.axis === 'x' && Math.abs(start.dx || 0) > SWIPE_MIN) changeIdeoPage(start.dx < 0 ? 1 : -1);
      // Swallow the click that fires at the end of the drag so the gesture doesn't
      // also open whatever list item / tile / tab the finger lifted over.
      const kill = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      scroll.addEventListener('click', kill, { capture: true, once: true });
      setTimeout(() => scroll.removeEventListener('click', kill, { capture: true }), 0);
    }
    start = null;
  };

  scroll.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    if (_data?.view === 'gear') return;                       // gear uses drag-and-drop equip; don't hijack the press
    const canPan = scroll.scrollHeight > scroll.clientHeight; // vertical pan needs overflow
    if (!canPan && !ideoActive()) return;                     // nothing to pan and no swipe target
    if (isInteractive(e.target)) return;                      // let controls/tiles handle it
    // While the home grid is in selection mode the lasso owns every press over it;
    // out of that mode the pan works exactly as it always did.
    if (_tosSelectMode && e.target.closest('.tos-home-apps')) return;
    start = { x: e.clientX, y: e.clientY, top: scroll.scrollTop, dragging: false, axis: null, dx: 0 };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });

  // Trackpad / horizontal wheel — a two-finger sideways flick pages the reader.
  // Debounced so one flick = one page, and only when the horizontal intent is
  // clear (so ordinary vertical scrolling is never hijacked).
  let wheelLock = 0;
  scroll.addEventListener('wheel', (e) => {
    if (!ideoActive()) return;
    if (Math.abs(e.deltaX) < 24 || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    if (e.timeStamp - wheelLock < 450) return;
    wheelLock = e.timeStamp;
    changeIdeoPage(e.deltaX > 0 ? 1 : -1);
  }, { passive: false });
}

function renderBreadcrumb(appId, crumb) {
  const trail = (crumb || []).filter(Boolean).map(esc).join(' / ') || 'Home';
  return `<div class="tos-crumb"><span class="tos-back" data-back="${esc(appId || '')}">&#8592; Back</span><span>${trail}</span></div>`;
}

// A generic in-app tab strip: any screen payload carrying `tabs` (array of {id,label})
// + `activeTab` gets one below the breadcrumb. Clicking a tab navigates the current
// app to that screen id (server buildScreen keys off it). No-op payload → returns ''.
function renderTosTabs(d) {
  if (!d?.tabs?.length) return '';
  const tabs = d.tabs.map(t =>
    `<button class="tos-tab${t.id === d.activeTab ? ' active' : ''}" data-tos-tab="${esc(t.id)}">${esc(t.label)}</button>`
  ).join('');
  return `<div class="tos-tabs" role="tablist">${tabs}</div>`;
}

function renderList(items) {
  if (!items || !items.length) return '<div class="tos-empty">Nothing here.</div>';
  return items.map(it => `<div class="tos-list-item" data-open-item="${esc(it.id)}">
    <div class="tos-li-label"><span>${esc(it.label)}</span>${it.badge ? `<span class="tos-badge ${esc(it.badge)}">${esc(it.badgeLabel || it.badge)}</span>` : ''}</div>
    ${it.sub ? `<div class="tos-li-sub">${esc(it.sub)}</div>` : ''}
  </div>`).join('');
}

// Month-grid calendar (Calendar app). A 7-column grid — weekday header row then the
// weeks from the server's monthGrid — with a marker dot on any day that carries an
// event and a native multi-line tooltip listing them. The prev/next arrows re-nav
// the app with screenId 'month' + a 'YYYY-MM' token (wired in wireBody).
// Squeeze an event title into a calendar cell. A month cell is barely wider than
// two words, so this drops the noise words a scheduled thing always carries ("rent
// due at…", "shift starts"), keeps the part that identifies it, and hard-truncates
// what's left. The untouched text is still in the cell's hover title.
function shortEventText(s) {
  let t = String(s || '').trim()
    .replace(/^(rent|payment)\s+(due|owed)\s*(at|for|on)?\s*/i, '')   // "Rent due at The Kettle" → "The Kettle"
    .replace(/\s+(starts|begins|opens|due|scheduled)\b.*$/i, '')      // trailing verb clauses
    .replace(/^the\s+/i, '')
    .replace(/\s+/g, ' ');
  if (!t) t = String(s || '').trim();
  return t.length > 13 ? t.slice(0, 12).trimEnd() + '…' : t;
}

function renderCalendar(d) {
  const dow = (d.weekdays || []).map(w => `<div class="tos-cal-dow">${esc(w)}</div>`).join('');
  const cells = (d.weeks || []).map(week => week.map(cell => {
    if (cell.day == null) return '<div class="tos-cal-cell tos-cal-pad"></div>';
    const evs = cell.evs || [];
    const has = evs.length > 0;
    // Escape each event's text before joining with the literal newline entity — the
    // whole title can't be esc()'d wholesale or the &#10; would be double-encoded.
    const tip = evs.map(e => `${e.kind === 'rent' ? '🏠 ' : '• '}${esc(e.text)}${e.detail ? ` (${esc(e.detail)})` : ''}`).join('&#10;');
    const kinds = [...new Set(evs.map(e => e.kind))];
    const dots = has ? `<div class="tos-cal-dots">${kinds.map(k => `<span class="tos-cal-dot tos-cal-dot-${esc(k)}"></span>`).join('')}</div>` : '';
    // A dot alone only ever said "something happens" — you had to hover to find out
    // what, which a touch screen can't do at all. So the first event's text rides in
    // the cell, shortened to fit, with a +N when the day holds more. The full list
    // stays in the hover title.
    const label = has
      ? `<span class="tos-cal-ev">${esc(shortEventText(evs[0].text))}${evs.length > 1 ? `<span class="tos-cal-more">+${evs.length - 1}</span>` : ''}</span>`
      : '';
    const cls = ['tos-cal-cell'];
    if (cell.isToday) cls.push('tos-cal-today');
    if (has) cls.push('tos-cal-has');
    return `<div class="${cls.join(' ')}"${has ? ` title="${tip}"` : ''}><span class="tos-cal-num">${cell.day}</span>${label}${dots}</div>`;
  }).join('')).join('');
  return `<div class="tos-cal">
    <div class="tos-cal-head">
      <span class="tos-cal-nav" data-cal-month="${esc(d.prevMonth || '')}" title="Previous month">&#8592;</span>
      <span class="tos-cal-title">${esc(d.monthLabel || '')}</span>
      <span class="tos-cal-nav" data-cal-month="${esc(d.nextMonth || '')}" title="Next month">&#8594;</span>
    </div>
    <div class="tos-cal-grid">${dow}${cells}</div>
  </div>`;
}

// ── Library: the shelf, a cover, a table of contents ─────────────────────────
// The chapter READER was already set as a book (.tos-book); these are the three
// screens that lead to it, and they used to be the generic list/detail furniture —
// eight identical grey rows for eight objects that are meant to be the most
// physical things on the tablet. A shelf should look like a shelf.
//
// Every cover is generated from the book's own id: one hash, one hue. No art to
// author, no asset to ship, and the same book is always the same colour, which is
// what lets you find it by colour on the second visit.
function bookHue(id) {
  let h = 0;
  for (let i = 0; i < String(id).length; i++) h = (h * 31 + String(id).charCodeAt(i)) % 360;
  return h;
}

// The cloth-and-foil plate a book is represented by. `size` picks the shelf tile
// or the bigger one on the cover page; both are the same object at two scales.
function renderBookPlate(b, size) {
  const hue = bookHue(b.id);
  // Initials rather than a truncated title: at shelf size a title wraps to mush,
  // and a stamped monogram is what a real spine does with the same problem.
  const initials = String(b.title || '?').replace(/[^A-Za-z ]/g, '').split(/\s+/)
    .filter(w => w && !/^(a|an|the|of|and|to)$/i.test(w)).slice(0, 3).map(w => w[0].toUpperCase()).join('');
  return `<div class="tos-lib-plate tos-lib-plate-${size}" style="--bk-hue:${hue}">
    <div class="tos-lib-plate-spine"></div>
    <div class="tos-lib-plate-mono">${esc(initials || '§')}</div>
    <div class="tos-lib-plate-rule"></div>
    <div class="tos-lib-plate-year">${esc(String(b.year || ''))}</div>
  </div>`;
}

function renderLibraryShelf(d) {
  const books = d.books || [];
  if (!books.length) return '<div class="tos-empty">Nothing here.</div>';
  const cards = books.map(b => {
    const total = b.chapters || 0;
    // Progress is deliberately the bookmark, not "chapters finished" — there is no
    // finished flag, and pretending otherwise would show 100% on a book you opened
    // to its last chapter and bounced off.
    const pct = total > 1 ? Math.round((b.at / (total - 1)) * 100) : (b.at ? 100 : 0);
    const started = b.at > 0;
    return `<div class="tos-lib-card" data-open-item="${esc(b.id)}">
      ${renderBookPlate(b, 'sm')}
      <div class="tos-lib-card-txt">
        <div class="tos-lib-card-title">${esc(b.title)}</div>
        <div class="tos-lib-card-by">${esc(b.author)}</div>
        <div class="tos-lib-card-meta">${total} chapter${total === 1 ? '' : 's'}${started ? ` · ${pct}%` : ''}</div>
        ${started ? `<div class="tos-lib-bar"><span style="width:${Math.max(3, pct)}%"></span></div>` : ''}
      </div>
    </div>`;
  }).join('');
  // The shelf board under the row of books. Pure decoration, and worth it — it is
  // the thing that says "these are objects" before you read a single title.
  return `<div class="tos-lib-shelf">${cards}</div><div class="tos-lib-board"></div>`;
}

function renderLibraryCover(d) {
  const b = d.book || {};
  const total = b.chapters || 0;
  const pct = total > 1 ? Math.round((b.at / (total - 1)) * 100) : (b.at ? 100 : 0);
  return `<div class="tos-lib-cover">
    <div class="tos-lib-cover-plate">${renderBookPlate(b, 'lg')}</div>
    <div class="tos-lib-cover-txt">
      <div class="tos-lib-cover-title">${esc(b.title || '')}</div>
      <div class="tos-lib-cover-by">${esc(b.author || '')} · ${esc(String(b.year || ''))}</div>
      <div class="tos-lib-blurb">${esc(b.blurb || '')}</div>
      <div class="tos-lib-facts">
        <span>${total} chapter${total === 1 ? '' : 's'}</span>
        <span>${b.at > 0 ? `Bookmarked at ${b.at + 1} of ${total}` : 'Unopened'}</span>
      </div>
      ${b.at > 0 ? `<div class="tos-lib-bar tos-lib-bar-wide"><span style="width:${Math.max(3, pct)}%"></span></div>` : ''}
      ${b.source ? `<div class="tos-lib-prov">${esc(b.source)}</div>` : ''}
    </div>
  </div>`;
}

function renderLibraryContents(d) {
  const chs = d.chapters || [];
  const at = d.at || 0;
  const rows = chs.map((c, i) => {
    const cls = ['tos-lib-toc-row'];
    if (i < at) cls.push('tos-lib-toc-read');
    if (i === at) cls.push('tos-lib-toc-at');
    return `<div class="${cls.join(' ')}" data-open-item="${esc(c.id)}">
      <span class="tos-lib-toc-n">${i + 1}</span>
      <span class="tos-lib-toc-t">${esc(c.title)}</span>
      <span class="tos-lib-toc-dots"></span>
      <span class="tos-lib-toc-len">${c.mins} min</span>
    </div>`;
  }).join('');
  return `<div class="tos-lib-toc">
    <div class="tos-lib-toc-head">Contents</div>
    ${rows || '<div class="tos-empty">No chapters.</div>'}
  </div>`;
}

function renderCategories(items) {
  if (!items || !items.length) return '<div class="tos-empty">Nothing active.</div>';
  return items.map(it => `<div class="tos-list-item" data-open-cat="${esc(it.id)}">
    <div class="tos-li-label"><span>${esc(it.label)}</span></div>
    ${it.sub ? `<div class="tos-li-sub">${esc(it.sub)}</div>` : ''}
  </div>`).join('');
}

// Help-app reader: a chapter's blurb + sections. A section is either a headless
// prose block (paragraphs) or a headed command group; `mono` sections render the
// command line in a highlighted monospace block. Read-only — the breadcrumb Back
// returns to the chapter index.
function renderHelp(ch) {
  if (!ch) return '<div class="tos-empty">No help here.</div>';
  const secs = (ch.sections || []).map(sec => `
    <div class="tos-help-sec">
      ${sec.heading ? `<div class="tos-help-head">${esc(sec.heading)}</div>` : ''}
      ${(sec.body || []).map(p => `<div class="tos-help-p${sec.mono ? ' mono' : ''}">${esc(p)}</div>`).join('')}
    </div>`).join('');
  return `<div class="tos-help">
    ${ch.blurb ? `<div class="tos-help-blurb">${esc(ch.blurb)}</div>` : ''}
    ${secs}
  </div>`;
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
  { key: 'tempUnit', label: 'Temp Units', opts: [
    { v: 'C', t: 'Celsius', g: 'C°' }, { v: 'F', t: 'Fahrenheit', g: 'F°' } ] },
  // Sidebar minimap tile overlay — panels/minimap.js reads this via the
  // window._applyMapOverlay hook in applySettings and re-renders in place.
  { key: 'mapOverlay', label: 'Map Labels', opts: [
    { v: 'labels', t: 'Lettering — the building’s 2-letter code', g: 'AB', s: 'font-size:11px;letter-spacing:1px' },
    { v: 'none', t: 'Plain tiles — no lettering', g: '▫' } ] },
];
const TOS_AUDIO_TOGGLES = [
  { key: 'music', label: 'Music', on: '🎵', off: '🔇' },
  { key: 'sfx', label: 'SFX', on: '💥', off: '🔕' },
  { key: 'tv', label: 'TV Audio', on: '📺', off: '📵' },
  { key: 'welcome', label: 'Welcome Voice', on: '👋', off: '🔕' },
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

  // Extra Lore — reuse the first-visit lore feature, but show a zone's intro block
  // every visit instead of only the first. Server-side preference; the pill just
  // mirrors it into `lorealways on|off` (pushed again at login, see dispatch.js).
  const loreOn = (s.extraLore || 'off') === 'on';
  const loreRow = `<div class="tos-set-row"><span class="tos-set-label">Extra Lore<span class="tos-set-val">Show zone lore every visit</span></span><div class="tos-opts">
    <div class="tos-opt${loreOn ? ' selected' : ''}" data-set-lore="on" title="Lore on every visit">On</div>
    <div class="tos-opt${!loreOn ? ' selected' : ''}" data-set-lore="off" title="Lore on first visit only">Off</div>
  </div></div>`;

  const soundOn = !!audio.enabled;
  const soundRow = `<div class="tos-set-row"><span class="tos-set-label">Sound</span><div class="tos-opts">
    <div class="tos-opt${soundOn ? ' selected' : ''}" data-set-sound="on" title="Sound On">🔊 On</div>
    <div class="tos-opt${!soundOn ? ' selected' : ''}" data-set-sound="off" title="Sound Off">🔇 Off</div>
  </div></div>`;
  // Compact rows of paired audio toggles above the sliders — icons only (meaning
  // carried by the tooltip): Music / SFX, TV / Welcome Voice, Mute-When-Hidden.
  const audioToggleCell = a => {
    const on = !!audio[a.key];
    return `<div class="tos-opts" title="${esc(a.label)}">
      <div class="tos-opt${on ? ' selected' : ''}" data-set-audio="${esc(a.key)}" data-set-audio-val="true" title="${esc(a.label)} On">${esc(a.on)}</div>
      <div class="tos-opt${!on ? ' selected' : ''}" data-set-audio="${esc(a.key)}" data-set-audio-val="false" title="${esc(a.label)} Off">${esc(a.off)}</div>
    </div>`;
  };
  const audioToggleRows = [[0, 1], [2, 3], [4]]
    .map(pair => `<div class="tos-set-row tos-iconrow">${pair.map(i => audioToggleCell(TOS_AUDIO_TOGGLES[i])).join('')}</div>`)
    .join('');
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
  // Wallpaper lives beside the theme, because it IS part of the theme — every option
  // derives its colours from the active one. Default None; the rest are opt-in.
  const wpNow = loadWallpaper();
  const wallpaperRow = `<div class="tos-set-row"><span class="tos-set-label">Wallpaper<span class="tos-set-val">Behind the home screen</span></span><div class="tos-opts">
    ${TABLET_WALLPAPERS.map(wp => `<div class="tos-opt${wp.id === wpNow ? ' selected' : ''}" data-set-wallpaper="${esc(wp.id)}" title="${esc(wp.label)}">${esc(wp.label)}</div>`).join('')}
  </div></div>`;

  const pages = {
    General:
      themeSection +
      wallpaperRow +
      `<div class="tos-set-row"><span class="tos-set-label">Contrast <span class="tos-set-val" data-contrast-label="1">${contrast === 0 ? 'Base' : '+' + contrast + '%'}</span></span>
        <span><input type="range" class="tos-slider" data-set-contrast="1" min="0" max="100" step="1" value="${contrast}">
        <span class="tos-btn-sub" data-contrast-reset="1" style="margin:0 0 0 8px;padding:4px 9px">Reset</span></span></div>` +
      fontRow +
      feltRow +
      loreRow +
      renderMisSection(),
    Layout: (layoutRows || '') +
      // Home widgets are OFF until you ask for them. The home screen's job is to
      // launch apps; cards under the grid are a second thing it does, and a first
      // login shouldn't have to read them to find the tile it wants.
      `<div class="tos-set-row"><span class="tos-set-label">Home Widgets<span class="tos-set-val">Info cards under the app grid</span></span><div class="tos-opts">
        <div class="tos-opt${widgetsEnabled() ? ' selected' : ''}" data-set-widgets="on" title="Show home widgets">On</div>
        <div class="tos-opt${!widgetsEnabled() ? ' selected' : ''}" data-set-widgets="off" title="Hide home widgets">Off</div>
      </div></div>` +
      `<div class="tos-set-row"><span class="tos-set-label">Sidebar Order<span class="tos-set-val">Drag order &amp; hidden panels</span></span>
        <span class="tos-btn-sub" data-reset-sidebar="1" style="margin:0">Reset to Default</span></div>` +
      `<div class="tos-set-row"><span class="tos-set-label">Home App Layout<span class="tos-set-val">Tile order, groups &amp; stashed apps</span></span>
        <span class="tos-btn-sub" data-reset-apps="1" style="margin:0">Reset to Default</span></div>`,
    Sound: soundRow + audioToggleRows + volRows +
      `<div class="tos-set-row"><span class="tos-set-label">Sound Settings<span class="tos-set-val">Toggles &amp; volumes</span></span>
        <span class="tos-btn-sub" data-reset-sound="1" style="margin:0">Reset to Default</span></div>`,
    About: renderAboutPage(),
  };
  const pageNames = Object.keys(pages);
  if (!pageNames.includes(_tosSetPage)) _tosSetPage = pageNames[0];
  const tabs = pageNames.map(n =>
    `<div class="tos-set-tab${n === _tosSetPage ? ' sel' : ''}" data-set-page="${esc(n)}">${esc(n)}</div>`).join('');

  return `<div class="tos-set-tabs">${tabs}</div><div class="tos-set-page">${pages[_tosSetPage]}</div>`;
}

// About — the colophon page. Static markup: wordmark, byline, and the support
// link (same URL the login screen carries, kept in sync by hand — there's only
// the one). The line above the button still says exactly what a donation buys —
// server bills, and the time not spent earning them — because the honest ask is
// the only one worth making. It just says it in the game's voice and in half the
// words; a paragraph of earnest explanation was reading like a charity mailer in
// the middle of a city that would mug you. Opens in a new tab, so no wiring.
function renderAboutPage() {
  return `<div class="tos-about">
    <div class="tos-about-mark">Architect</div>
    <div class="tos-about-rule"></div>
    <div class="tos-about-by">Built by</div>
    <div class="tos-about-names">David Lacey<br>John Akerson</div>
    <div class="tos-about-rule"></div>
    <div class="tos-about-tag">We build this because we want to. The servers just insist on being paid. Chip in if you feel like it — thanks either way.</div>
    <a class="tos-about-bmc" href="https://buymeacoffee.com/haveagreatdave" target="_blank" rel="noopener noreferrer" title="Support Us">
      <span class="tos-about-cup">☕</span><span>Support Us</span>
    </a>
  </div>`;
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

// A titled box (the "cards" the original corp console used) — one boxed section
// per corp page so each screen reads as a discrete panel, no long scroll.
function renderCorpCard(title, html) {
  return `<div class="tos-card"><div class="tos-card-h">${esc(title)}</div>${html}</div>`;
}

const CORP_PAGES = ['Overview', 'Operatives', 'Territory', 'Diplomacy'];

function renderCorpPageNav(page) {
  const prevD = page <= 0;
  const nextD = page >= CORP_PAGES.length - 1;
  return `<div class="tos-page-nav">
    <span class="tos-page-btn${prevD ? ' disabled' : ''}" data-corp-page="${page - 1}">&#8592; Prev</span>
    <span>${esc(CORP_PAGES[page])} · ${page + 1}/${CORP_PAGES.length}</span>
    <span class="tos-page-btn${nextD ? ' disabled' : ''}" data-corp-page="${page + 1}">Next &#8594;</span>
  </div>`;
}

// The corp dashboard — boxed sections, one page at a time (paged, not scrolled),
// with the corp name centred at the top. Actions + colour picker live on the
// Overview page; the other pages are the roster / territory / diplomacy panels.
function renderCorpScreen(d) {
  const corp = d.corp || {};
  const t = corp.treasury || {};
  const net = (t.income || 0) - (t.upkeep || 0);
  const ti = corp.tierInfo || {};
  if (_tosCorpPage < 0 || _tosCorpPage >= CORP_PAGES.length) _tosCorpPage = 0;
  const page = _tosCorpPage;

  let body = '';
  if (page === 0) {
    const treasury = `
      <div class="tos-row"><span>Balance</span><span>₵${(t.balance || 0).toLocaleString()}</span></div>
      <div class="tos-row"><span>Income</span><span>+${t.income || 0}/day</span></div>
      <div class="tos-row"><span>Upkeep</span><span>-${t.upkeep || 0}/day</span></div>
      <div class="tos-row"><span>Net</span><span>${net >= 0 ? '+' : ''}${net}/day</span></div>`;
    const standing = `
      <div class="tos-row"><span>Members</span><span>${ti.members ?? (corp.members || []).length}/${ti.memberCap ?? '—'}</span></div>
      <div class="tos-row"><span>Territory</span><span>${ti.zones ?? (corp.territory || []).length}/${ti.slots ?? '—'} zones</span></div>`;
    body = `
      <div class="tos-corp-head">
        <div class="tos-corp-name">${esc(corp.name || 'CORPORATION')}${corp.tag ? ` [${esc(corp.tag)}]` : ''}</div>
        <div class="tos-corp-sub">Tier ${esc(String(corp.tier ?? 1))} · ${esc(corp.rank || '—')}</div>
      </div>
      ${renderCorpCard('Treasury', treasury)}
      ${renderCorpCard('Standing', standing)}
      <div class="tos-actions"><span class="tos-btn" data-nav-screen="map">🗺 Territory Map</span></div>
      ${corp.canEdit ? renderColorPicker(d.appId, corp.color) : ''}
      ${renderActions(d.appId, d.actions, '')}`;
  } else if (page === 1) {
    const members = (corp.members || []).map(m =>
      `<div class="tos-row"><span>${m.online ? '●' : '○'} ${esc(m.handle)}</span><span>${esc(m.rank)}</span></div>`
    ).join('') || '<div class="tos-empty">No members.</div>';
    body = renderCorpCard('Operatives', members);
  } else if (page === 2) {
    const territory = (corp.territory || []).map(z =>
      `<div class="tos-row"><span>${esc(z.zone)}${z.status === 'CONTESTED' ? ' ⚠' : ''}</span><span>${esc(z.status)} · ${z.influence}%</span></div>`
    ).join('') || '<div class="tos-empty">No territory yet. Claim a contestable zone with "corp claim".</div>';
    body = renderCorpCard('Territory · Influence', territory);
  } else {
    const relations = (corp.relations || []).map(r =>
      `<div class="tos-row"><span>${esc(r.name)}</span><span>${esc(r.stance)}</span></div>`
    ).join('') || '<div class="tos-empty">No standing declarations.</div>';
    body = renderCorpCard('Diplomacy', relations);
  }

  // Wrap the page body in a flex:1 region so the Prev/Next nav is pinned to the
  // bottom of the tablet screen — same location on every page, regardless of how
  // much (or little) content that page holds.
  return `<div class="tos-corp-scroll">${body}</div>${renderCorpPageNav(page)}`;
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

function _mapHexRgb(hex) {
  const h = String(hex || '').replace('#', '');
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
}
// A tile counts as a building for label mode if it carries a building identity
// (same test the Buildings legend uses, minus the standalone-POI landmarks).
function _mapIsBldg(t) {
  return !!(t.building_type || t.building_name);
}
// The code a building tile wears in Labels mode: the AUTHORED zones.marker, and
// nothing else. That column exists to be the tile's map glyph; deriving one here meant
// the authored value rendered nowhere while this map and the sidebar minimap derived
// two DIFFERENT codes from the same name ("Hall of Records" → "HO" here, "HA" there,
// authored "HR" on neither).
//
// Derivation now happens ONCE at authoring time (the dev panel stamps a suggested
// acronym when it converts a tile into a facade), so a building with no marker
// deliberately draws no letters — a gap the map audit reports (MARK-2/MARK-4) rather
// than a code that differs per screen. An unmarked room inside a building draws
// nothing for the same reason it always should have: it inherits flags.building_name
// from its parent, so a derived code stamped the parent's acronym on every room.
function _mapBldgCode(t) {
  return String(t.marker || '').trim() || null;
}
function _mapTileSym(t) {
  if (t.isCurrent) return '<span class="mt-icon">◉</span>';
  // A named zone-icon SVG (road/building/runway) is the tile's own footprint — it
  // wins over the POI glyph, which is a landmark hint for the adjacent street.
  if (t.svg) return `<span class="mt-icon mt-svg" style="--zi:url(/assets/zone-icons/${esc(t.svg)}.svg)"></span>`;
  if (t.icon) return `<span class="mt-icon">${esc(t.icon)}</span>`;
  return ''; // bare tile — no marker glyph (#, ⸪., …)
}

// ── Codex app (native view: 'codex') ─────────────────────────────────────────
// A shelf of sections. Two kinds render here — 'chapters' (a lore volume: an
// index of entries, then one entry read full-bleed) — while kind 'orders' falls
// through to the alignment reader below, which is the same instrument it always
// was, just reached through the Codex now.
//
// Reading state is client-side (_tosCodexCh), like the ideology paging: the whole
// volume rides in one payload, so opening a chapter is not a round trip.
let _tosCodexCh = null;   // chapter id currently being read, or null for the index

function renderCodexShelf(d) {
  const tiles = (d.sections || []).map(s => {
    const prog = s.progress
      ? `<span class="tos-cx-prog"><i style="width:${s.progress.total ? Math.round(s.progress.have / s.progress.total * 100) : 0}%"></i></span>`
      : '';
    return `<div class="tos-cx-shelf-row" data-codex-section="${esc(s.id)}">
      <span class="tos-cx-glyph">${esc(s.glyph || '◆')}</span>
      <span class="tos-cx-shelf-txt">
        <span class="tos-cx-shelf-title">${esc(s.title)}</span>
        <span class="tos-cx-shelf-sub">${esc(s.subtitle || '')}</span>
        ${prog}
      </span>
      <span class="tos-cx-shelf-meta">${esc(s.line || '')}<b>›</b></span>
    </div>`;
  }).join('');
  return `<div class="tos-cx-root">
    <div class="tos-cx-hero">
      <div class="tos-cx-hero-eyebrow">Architect Public Record</div>
      <div class="tos-cx-hero-title">CODEX</div>
      <div class="tos-cx-hero-sub">What the world is. What you are becoming in it.</div>
    </div>
    <div class="tos-cx-shelf">${tiles}</div>
    <p class="tos-cx-foot">Entries accrue as you learn them. The record is not complete, and has never claimed to be.</p>
  </div>`;
}

// One chapter's prose. `body` is the authored array: strings are paragraphs,
// { pull } is a pull quote, { break: true } is a rule. A locked chapter never
// ships a body at all (see codex/section-chapters.js), so this can't leak one.
// The chapter's speakable prose as UTTERANCES, in reading order — paragraphs and
// pull quotes, never the rules.
//
// It returns the split array rather than a joined string on purpose. Joining and
// re-splitting is not lossless: a block that doesn't end in sentence punctuation
// (a pull quote, a fragment) would fuse with the first sentence of the next block
// on the re-split, while the renderer — which splits block by block — would keep
// them apart. One extra span, every index after it off by one, and the highlight
// silently follows the wrong line for the rest of the chapter. Splitting once, in
// the order the renderer walks, makes that impossible.
function codexNarrationParts(body) {
  return (body || [])
    .map(p => (typeof p === 'string' ? p : (p?.pull || '')))
    .filter(Boolean)
    .flatMap(s => narrateSplit(s));
}

function renderCodexBody(body, narratable) {
  // When narration is available the prose is rendered sentence-addressably, so
  // the voice can light the line it's on — the same treatment the Library gets.
  // The running index must span the WHOLE chapter (not restart per paragraph),
  // and must count exactly the blocks codexNarrationParts contributes, in order.
  let n = 0;
  const speak = (s) => narratable
    ? narrateSplit(s).map(t => `<span class="tos-narr-s" data-s="${n++}">${esc(t)}</span>`).join(' ')
    : esc(s);
  return (body || []).map((p, i) => {
    if (typeof p === 'string') {
      // Drop cap on the opening paragraph only — the reader's one flourish. The
      // cap is peeled off the raw string BEFORE the sentence split so the split
      // still sees whole sentences and the indices stay aligned with the voice.
      if (i === 0 && !narratable) return `<p class="tos-cx-p"><span class="tos-cx-drop">${esc(p.charAt(0))}</span>${esc(p.slice(1))}</p>`;
      return `<p class="tos-cx-p">${speak(p)}</p>`;
    }
    if (p?.pull) return `<blockquote class="tos-cx-pull">${speak(p.pull)}</blockquote>`;
    if (p?.break) return `<div class="tos-cx-rule" aria-hidden="true">◆ ◆ ◆</div>`;
    return '';
  }).join('');
}

// Read a Codex chapter aloud, and keep going into the next UNLOCKED one.
//
// Sealed chapters ship no body at all (the server never sends one), so they are
// skipped rather than read as silence — and when the volume runs out the narrator
// simply stops. The whole volume already rides in one payload, which is why this
// can walk it without a round trip.
//
// The on-screen chapter is NOT turned as the voice moves on: `_tosCodexCh` is
// left alone deliberately, because auto-advance exists precisely for when you are
// not looking at the tablet. The pill title says which chapter is being read.
function narrateCodexFrom(chapterId) {
  const chapters = _data?.chapters || [];
  const startAt = chapters.findIndex(c => c.id === chapterId && c.unlocked);
  if (startAt < 0) return;
  const volume = _data?.sectionTitle || _data?.appName || 'CODEX';
  const titleOf = (c) => `${volume} — ${c.title || ''}`.trim();

  let cursor = startAt;
  // Lazy: re-read the payload each time, so a chapter unlocked mid-read counts.
  const advance = () => {
    const list = _data?.chapters || chapters;
    for (let k = cursor + 1; k < list.length; k++) {
      const c = list[k];
      if (!c?.unlocked) continue;                  // sealed prose was never sent
      const parts = codexNarrationParts(c.body);
      if (!parts.length) continue;                 // nothing speakable — skip, don't stall
      cursor = k;
      return { text: parts, title: titleOf(c) };
    }
    return null;                                   // end of the record
  };

  const first = chapters[startAt];
  const parts = codexNarrationParts(first.body);
  if (!parts.length) return;
  // Seed on the VOLUME so one narrator reads the whole record, exactly as the
  // Library seeds on the book rather than the chapter.
  narrateStart(parts, volume, titleOf(first), _data?.lex, advance);
}

function renderCodexVolume(d) {
  const chapters = d.chapters || [];
  const reading = _tosCodexCh ? chapters.find(c => c.id === _tosCodexCh && c.unlocked) : null;

  if (reading) {
    const idx = chapters.indexOf(reading);
    const prev = chapters.slice(0, idx).reverse().find(c => c.unlocked);
    const next = chapters.slice(idx + 1).find(c => c.unlocked);
    const step = (c, label, dir) => c
      ? `<span class="tos-cx-step" data-codex-ch="${esc(c.id)}">${dir < 0 ? '‹ ' : ''}${esc(label)}${dir > 0 ? ' ›' : ''}</span>`
      : `<span class="tos-cx-step off">${dir < 0 ? '‹ ' : ''}${esc(label)}${dir > 0 ? ' ›' : ''}</span>`;
    return `<div class="tos-cx-root">
      <div class="tos-cx-readbar"><span class="tos-cx-back" data-codex-ch="">‹ ${esc(d.sectionTitle || 'Contents')}</span></div>
      <article class="tos-cx-read">
        <div class="tos-cx-num">${esc(reading.n || '')}</div>
        <div class="tos-cx-eyebrow">${esc(reading.eyebrow || '')}</div>
        <h1 class="tos-cx-title">${esc(reading.title)}</h1>
        <p class="tos-cx-lede">${esc(reading.lede || '')}</p>
        <div class="tos-cx-rule top" aria-hidden="true">◆ ◆ ◆</div>
        ${renderCodexBody(reading.body, true)}
        <div class="tos-cx-end" aria-hidden="true">◈</div>
      </article>
      ${renderNarrateBar()}
      <div class="tos-cx-nav">${step(prev, prev ? prev.title : 'Beginning', -1)}${step(next, next ? next.title : 'End of record', 1)}</div>
    </div>`;
  }

  const rows = chapters.map(c => c.unlocked
    ? `<div class="tos-cx-entry" data-codex-ch="${esc(c.id)}">
         <span class="tos-cx-n">${esc(c.n || '')}</span>
         <span class="tos-cx-etxt"><span class="tos-cx-etitle">${esc(c.title)}</span><span class="tos-cx-elede">${esc(c.lede || '')}</span></span>
         <span class="tos-cx-open">read ›</span>
       </div>`
    : `<div class="tos-cx-entry locked">
         <span class="tos-cx-n">${esc(c.n || '')}</span>
         <span class="tos-cx-etxt">
           <span class="tos-cx-etitle">${esc(c.title)}</span>
           <span class="tos-cx-redact" aria-hidden="true"><i style="width:94%"></i><i style="width:71%"></i><i style="width:86%"></i></span>
           <span class="tos-cx-hint">${esc(c.hint || 'Not yet recovered.')}</span>
         </span>
         <span class="tos-cx-lock">sealed</span>
       </div>`).join('');

  const p = d.progress || { have: 0, total: chapters.length };
  return `<div class="tos-cx-root">
    <div class="tos-cx-volhead">
      <div class="tos-cx-hero-title small">${esc(d.sectionTitle || '')}</div>
      <div class="tos-cx-note">${esc(d.note || '')}</div>
      <div class="tos-cx-progline"><span class="tos-cx-prog wide"><i style="width:${p.total ? Math.round(p.have / p.total * 100) : 0}%"></i></span><b>${p.have}/${p.total}</b> recovered</div>
    </div>
    <div class="tos-cx-index">${rows}</div>
  </div>`;
}

// ── Ideology reader (Codex section 'orders') ──────────────────────────────
// Paged reader: Overview (radial 4-path field + ranked standing), one deep-dive
// page per order (lore/creed/path/standing ladder/relations/agents), and the
// Field (two-axis compass). All data rides in one payload; pages switch
// client-side via _tosIdeoPage (like the corp dashboard), no round trip.
function _ideoAccent() {
  const a = getComputedStyle(_overlay || document.documentElement).getPropertyValue('--accent').trim();
  return a || '#35e0c8';
}

// Procedural order sigils, stroked in each order's identity colour.
const IDEO_SIGILS = {
  ideology_ascendants: c => `<svg viewBox="0 0 40 40" class="tos-ideo-sig"><g fill="none" stroke="${c}" stroke-width="1.6"><path d="M20 6 L31 26 H9 Z"/><path d="M20 14 L26 26 H14 Z" stroke-opacity=".6"/><circle cx="20" cy="31" r="2.4" fill="${c}"/><path d="M20 22 V28 M14 31 H9 M26 31 H31" stroke-opacity=".7"/></g></svg>`,
  ideology_long_watch: c => `<svg viewBox="0 0 40 40" class="tos-ideo-sig"><g fill="none" stroke="${c}" stroke-width="1.6"><path d="M6 20 Q20 8 34 20 Q20 32 6 20 Z"/><circle cx="20" cy="20" r="4.5"/><circle cx="20" cy="20" r="1.6" fill="${c}"/><path d="M20 4 V8 M20 32 V36" stroke-opacity=".6"/></g></svg>`,
  ideology_wildblood: c => `<svg viewBox="0 0 40 40" class="tos-ideo-sig"><g fill="none" stroke="${c}" stroke-width="1.6"><path d="M20 34 V20"/><path d="M20 20 C20 12 13 12 10 6 M20 20 C20 12 27 12 30 6"/><path d="M20 26 C20 22 15 21 12 18 M20 26 C20 22 25 21 28 18" stroke-opacity=".6"/><circle cx="10" cy="6" r="2" fill="${c}"/><circle cx="30" cy="6" r="2" fill="${c}"/></g></svg>`,
  ideology_exodus: c => `<svg viewBox="0 0 40 40" class="tos-ideo-sig"><g fill="none" stroke="${c}" stroke-width="1.6"><circle cx="20" cy="20" r="4" fill="${c}"/><g stroke-opacity=".85"><path d="M20 20 L20 5 M20 20 L33 12 M20 20 L35 20 M20 20 L33 28 M20 20 L20 35 M20 20 L7 28 M20 20 L5 20 M20 20 L7 12"/></g><circle cx="20" cy="20" r="9" stroke-opacity=".4" stroke-dasharray="2 3"/></g></svg>`,
  // Expansion orders — sigils staged so flipping the flags.expansion gate is the
  // only activation step. The torch (Prometheans), the bloom (Synthesis), the cut
  // signal (Null), the rising sun (Pioneers).
  ideology_prometheans: c => `<svg viewBox="0 0 40 40" class="tos-ideo-sig"><g fill="none" stroke="${c}" stroke-width="1.6"><path d="M20 6 C24 12 24 15 20 20 C16 15 16 12 20 6 Z"/><path d="M20 20 V34"/><path d="M14 31 H9 M26 31 H31" stroke-opacity=".6"/><circle cx="9" cy="31" r="1.6" fill="${c}"/><circle cx="31" cy="31" r="1.6" fill="${c}"/></g></svg>`,
  ideology_synthesis: c => `<svg viewBox="0 0 40 40" class="tos-ideo-sig"><g fill="none" stroke="${c}" stroke-width="1.6"><path d="M20 34 V16"/><path d="M20 22 C12 20 10 12 12 8 C18 10 20 16 20 22 Z" stroke-opacity=".85"/><path d="M20 18 C28 16 30 10 28 7 C23 9 20 13 20 18 Z" stroke-opacity=".6"/><circle cx="20" cy="13" r="2" fill="${c}"/></g></svg>`,
  ideology_null: c => `<svg viewBox="0 0 40 40" class="tos-ideo-sig"><g fill="none" stroke="${c}" stroke-width="1.6"><path d="M8 24 Q20 8 32 24" stroke-opacity=".5"/><path d="M13 26 Q20 16 27 26" stroke-opacity=".7"/><circle cx="20" cy="30" r="2" fill="${c}"/><path d="M10 10 L30 34" stroke-width="2"/></g></svg>`,
  ideology_pioneers: c => `<svg viewBox="0 0 40 40" class="tos-ideo-sig"><g fill="none" stroke="${c}" stroke-width="1.6"><path d="M6 28 H34"/><path d="M13 28 A7 7 0 0 1 27 28"/><g stroke-opacity=".7"><path d="M20 12 V7 M11 16 L8 13 M29 16 L32 13 M6 22 H3 M34 22 H37"/></g></g></svg>`,
};
function ideoSigil(id, color) { return (IDEO_SIGILS[id] || (c => `<svg viewBox="0 0 40 40" class="tos-ideo-sig"><circle cx="20" cy="20" r="7" fill="${c}"/></svg>`))(color); }

// Fixed field coordinates for the canon four (x: renounce→redeem 0..100,
// y: human→transcend 0..100). Unknown ids derive from stance/path.
const IDEO_FIELD_XY = {
  ideology_ascendants: [72, 82], ideology_long_watch: [76, 12],
  ideology_wildblood: [26, 80], ideology_exodus: [18, 90],
  // Expansion orders (staged; gated out of the payload until activated). Placed
  // by hand rather than left to the stance/path fallback, which would stack the
  // Null (renounce·machine) on the transcend row it philosophically rejects.
  ideology_prometheans: [88, 66], ideology_synthesis: [60, 74],
  ideology_null: [16, 30], ideology_pioneers: [34, 12],
};
function ideoFieldXY(o) {
  if (IDEO_FIELD_XY[o.id]) return IDEO_FIELD_XY[o.id];
  const x = o.stance === 'redeem' ? 74 : 22;
  const y = o.path === 'human' ? 14 : 84;
  return [x, y];
}
function ideoPlayerXY(overview) {
  const p = overview.paths || {};
  const tot = (p.machine || 0) + (p.flesh || 0) + (p.mind || 0) + (p.human || 0);
  const transcend = tot ? Math.round((1 - (p.human || 0) / tot) * 100) : 50;
  return [Math.round((overview.stance + 100) / 2), transcend];
}

// Two-axis compass: civilization (x) × the body (y). highlightId dims the rest.
function renderIdeoField(d, highlightId, accent) {
  const X0 = 48, X1 = 336, Y0 = 46, Y1 = 250;
  const sx = s => X0 + s / 100 * (X1 - X0);
  const sy = t => Y1 - t / 100 * (Y1 - Y0);
  const nodes = d.orders.map(o => {
    const [gx, gy] = ideoFieldXY(o);
    const on = !highlightId || o.id === highlightId;
    const em = o.expansion;
    const op = (on ? 1 : .26) * (em ? .55 : 1), r = on ? 7 : 5, gr = on ? 17 : 9;
    const lbl = o.name.replace('The ', '').toUpperCase();
    const dot = em
      ? `<circle cx="${sx(gx)}" cy="${sy(gy)}" r="${r}" fill="none" stroke="${o.color}" stroke-width="1.5" stroke-dasharray="2 2.4"/>`
      : `<circle cx="${sx(gx)}" cy="${sy(gy)}" r="${r}" fill="${o.color}"/><circle cx="${sx(gx)}" cy="${sy(gy)}" r="${r}" fill="none" stroke="#fff" stroke-opacity="${on ? .5 : 0}"/>`;
    return `<g opacity="${op}">
      <circle cx="${sx(gx)}" cy="${sy(gy)}" r="${gr}" fill="${o.color}" opacity="${em ? .1 : .2}"/>
      ${dot}
      ${on ? `<text x="${sx(gx)}" y="${sy(gy) + (gy > 55 ? -13 : 21)}" text-anchor="middle" fill="${o.color}" font-size="10.5" letter-spacing="1">${lbl}</text>` : ''}
    </g>`;
  }).join('');
  const [px0, py0] = ideoPlayerXY(d.overview);
  const px = sx(px0), py = sy(py0);
  return `<svg viewBox="0 0 380 288" class="tos-ideo-chart" role="img" aria-label="Two-axis alignment field: civilization on the horizontal, the body on the vertical.">
    <rect x="${X0}" y="${Y0}" width="${X1 - X0}" height="${Y1 - Y0}" fill="none" stroke="${accent}" stroke-opacity=".14" rx="6"/>
    <line x1="${(X0 + X1) / 2}" y1="${Y0}" x2="${(X0 + X1) / 2}" y2="${Y1}" stroke="${accent}" stroke-opacity=".16" stroke-dasharray="3 5"/>
    <line x1="${X0}" y1="${(Y0 + Y1) / 2}" x2="${X1}" y2="${(Y0 + Y1) / 2}" stroke="${accent}" stroke-opacity=".16" stroke-dasharray="3 5"/>
    <text x="${X0}" y="36" fill="${accent}" fill-opacity=".9" font-size="10.5" letter-spacing="1.5">◄ RENOUNCE</text>
    <text x="${X1}" y="36" text-anchor="end" fill="${accent}" fill-opacity=".9" font-size="10.5" letter-spacing="1.5">REDEEM ►</text>
    <text x="${(X0 + X1) / 2}" y="22" text-anchor="middle" fill="${accent}" fill-opacity=".7" font-size="9.5" letter-spacing="2">CIVILIZATION</text>
    <text x="${(X0 + X1) / 2}" y="266" text-anchor="middle" fill="${accent}" fill-opacity=".9" font-size="10.5" letter-spacing="1.5">STAY HUMAN</text>
    <text x="${(X0 + X1) / 2}" y="282" text-anchor="middle" fill="${accent}" fill-opacity=".7" font-size="9.5" letter-spacing="2">THE BODY · TRANSCEND ▲</text>
    ${nodes}
    <circle cx="${px}" cy="${py}" r="18" fill="${accent}" opacity=".2"><animate attributeName="r" values="14;22;14" dur="3.2s" repeatCount="indefinite"/></circle>
    <circle cx="${px}" cy="${py}" r="8.5" fill="var(--tos-fg)"/><circle cx="${px}" cy="${py}" r="13" fill="none" stroke="${accent}" stroke-width="1.5"/>
    <text x="${px}" y="${py - 17}" text-anchor="middle" fill="var(--tos-fg)" font-size="10" letter-spacing="2">YOU</text>
  </svg>`;
}

// Radial four-path field — stance (x) × ascend/stay (y), each order at its
// (stance, path) corner. The Overview's headline chart.
function renderIdeoRadial(d, accent) {
  // Overview headline chart: the canon four only, one per quadrant. Emerging
  // orders are deliberately kept off it (they still show in Standing below and
  // on the Field page) — plotting all eight here crushed it into noise.
  const POS = { ideology_exodus: [96, 100], ideology_wildblood: [96, 204], ideology_ascendants: [288, 100], ideology_long_watch: [288, 204] };
  const nodes = d.orders.filter(o => !o.expansion).map(o => {
    const [x, y] = POS[o.id] || [190, 152];
    const lbl = o.name.replace('The ', '').toUpperCase();
    return `<g><circle cx="${x}" cy="${y}" r="20" fill="${o.color}" opacity=".2"/>
      <circle cx="${x}" cy="${y}" r="7.5" fill="${o.color}"/><circle cx="${x}" cy="${y}" r="7.5" fill="none" stroke="#fff" stroke-opacity=".55"/>
      <text x="${x}" y="${y + 28}" text-anchor="middle" fill="${o.color}" font-size="11.5" letter-spacing="1.2">${lbl}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 380 288" class="tos-ideo-chart" role="img" aria-label="Four-path alignment field with your position marked.">
    <line x1="190" y1="34" x2="190" y2="256" stroke="${accent}" stroke-opacity=".18" stroke-dasharray="3 5"/>
    <line x1="42" y1="145" x2="338" y2="145" stroke="${accent}" stroke-opacity=".18" stroke-dasharray="3 5"/>
    <rect x="42" y="34" width="296" height="222" fill="none" stroke="${accent}" stroke-opacity=".16" rx="6"/>
    <text x="48" y="24" fill="${accent}" fill-opacity=".9" font-size="10.5" letter-spacing="1.5">◄ RENOUNCE</text>
    <text x="332" y="24" text-anchor="end" fill="${accent}" fill-opacity=".9" font-size="10.5" letter-spacing="1.5">REDEEM ►</text>
    <text x="190" y="278" text-anchor="middle" fill="${accent}" fill-opacity=".75" font-size="10" letter-spacing="2">STAY · HUMAN</text>
    <text x="190" y="48" text-anchor="middle" fill="${accent}" fill-opacity=".75" font-size="10" letter-spacing="2">ASCEND</text>
    ${nodes}
    <circle cx="150" cy="172" r="18" fill="${accent}" opacity=".2"><animate attributeName="r" values="14;22;14" dur="3.2s" repeatCount="indefinite"/></circle>
    <circle cx="150" cy="172" r="8.5" fill="var(--tos-fg)"/><circle cx="150" cy="172" r="13" fill="none" stroke="${accent}" stroke-width="1.5"/>
    <text x="150" y="148" text-anchor="middle" fill="var(--tos-fg)" font-size="10" letter-spacing="2">YOU</text>
  </svg>`;
}

// Rep bar fill %: -200 (bottom of Unknown) .. 900 (Inner Circle) mapped to 4..100.
function ideoRepPct(rep) { return Math.max(4, Math.min(100, Math.round((rep + 200) / 1100 * 100))); }
function ideoFormPct(path) { return path === 'human' ? 12 : (path === 'mind' ? 90 : 82); }

const IDEO_PAGES_KEY = d => ['overview', ...d.orders.map(o => o.id), 'field'];

function renderIdeoNav(d, page) {
  const accent = _ideoAccent();
  const tabs = [{ k: 'overview', label: '◆ OVERVIEW', c: accent }];
  d.orders.forEach(o => tabs.push({ k: o.id, label: o.name.replace('The ', '').toUpperCase(), c: o.color, em: o.expansion }));
  tabs.push({ k: 'field', label: '◈ FIELD', c: accent });
  // Divider between the live group and the first emerging tab, so the four
  // being-implemented orders read as one block and the previews sit to the right.
  let sepDone = false;
  const strip = tabs.map((t, i) => {
    let sep = '';
    if (t.em && !sepDone) { sep = '<span class="tos-ideo-navsep" aria-hidden="true"></span>'; sepDone = true; }
    return sep + `<span class="tos-ideo-tab${i === page ? ' on' : ''}${t.em ? ' emerging' : ''}" data-ideo-page="${i}" style="--ic:${t.c}"><b>${t.em ? '◇' : '▪'}</b> ${esc(t.label)}</span>`;
  }).join('');
  return `<div class="tos-ideo-nav">${strip}</div>`;
}

function renderIdeoOverview(d, accent) {
  const live = d.orders.filter(o => !o.expansion).sort((a, b) => b.rep - a.rep);
  const emerging = d.orders.filter(o => o.expansion);
  const row = o => `
    <div class="tos-ideo-stand${o.expansion ? ' emerging' : ''}" data-ideo-go="${o.id}" style="--ic:${o.color}">
      <span class="tos-ideo-sigwrap">${ideoSigil(o.id, o.color)}</span>
      <span class="tos-ideo-sname">${esc(o.name.replace('The ', ''))}</span>
      ${o.expansion
        ? `<span class="tos-ideo-bar emerging"><i style="width:100%;background:repeating-linear-gradient(90deg,${o.color} 0 3px,transparent 3px 6px)"></i></span>`
        : `<span class="tos-ideo-bar"><i style="width:${ideoRepPct(o.rep)}%;background:${o.color};box-shadow:0 0 8px ${o.color}"></i></span>`}
      <span class="tos-ideo-tv" style="color:${o.color}">${o.expansion ? 'Emerging' : esc(o.tier)}</span>
    </div>`;
  const rows = live.map(row).join('')
    + (emerging.length ? `<div class="tos-ideo-substand">Emerging orders · not yet active in the Basin</div>${emerging.map(row).join('')}` : '');
  const lean = d.overview.leanName
    ? `You lean toward <b style="color:${d.overview.leanColor};text-shadow:0 0 12px ${d.overview.leanColor}80">${esc(d.overview.leanName)}</b>.`
    : 'You have not yet taken a side.';
  return `<div class="tos-ideo-page">
    <div class="tos-ideo-lbl">Alignment field</div>
    <div class="tos-ideo-panel">${renderIdeoRadial(d, accent)}<div class="tos-ideo-lean">${lean}</div></div>
    <div class="tos-ideo-lbl">Standing</div>
    <div class="tos-ideo-panel">${rows}</div>
    <div class="tos-ideo-lbl">The two questions</div>
    <div class="tos-ideo-panel"><p class="tos-ideo-note"><b>Civilization</b> — is the Basin worth saving? Renounce it, or redeem it.<br><br><b>The body</b> — do we stay human, or transcend the form? And by which path — machine, flesh, or mind? <span class="tos-ideo-dim">Open the Field to see them all plotted.</span></p></div>
  </div>`;
}

function renderIdeoOrder(o, d, accent) {
  const foes = (o.opposed || []).map(n => `<span class="tos-ideo-chip foe"><em>opposed</em>${esc(n)}</span>`).join('');
  const wary = (o.neutral || []).map(n => `<span class="tos-ideo-chip warn"><em>no quarrel</em>${esc(n)}</span>`).join('');
  const npcs = (o.npcs && o.npcs.length)
    ? `<div class="tos-ideo-chips">${o.npcs.map(n => `<span class="tos-ideo-chip"><em>agent</em>${esc(n)}</span>`).join('')}</div>`
    : `<p class="tos-ideo-empty">No agents have surfaced in the Basin. You'll know them by their work, not their faces.</p>`;
  const ladder = d.tiers.map(t => {
    const cls = o.rep >= 0 && t.label === o.tier ? 'here' : '';
    const done = d.tiers.findIndex(x => x.label === o.tier) > d.tiers.indexOf(t);
    return `<div class="tos-ideo-rung ${cls || (done ? 'done' : '')}"><span class="pip" style="--ic:${o.color}"></span><span class="rl">${esc(t.label)}</span><span class="pk">${esc(t.perk)}</span></div>`;
  }).join('');
  const nxt = o.nextTier ? `${o.nextAt} to ${esc(o.nextTier)}` : 'max tier';
  const lore = esc(o.lore);
  const drop = lore.charAt(0), rest = lore.slice(1);
  return `<div class="tos-ideo-page" style="--ic:${o.color}">
    <div class="tos-ideo-ohead">
      <span class="tos-ideo-sigwrap big">${ideoSigil(o.id, o.color)}</span>
      <div><div class="tos-ideo-oname" style="color:${o.color};text-shadow:0 0 14px ${o.color}66">${esc(o.name)}</div>
      ${o.motto ? `<div class="tos-ideo-motto">› ${esc(o.motto)}</div>` : ''}
      ${o.expansion ? `<div class="tos-ideo-emerge" style="--ic:${o.color}">◇ Emerging · not yet active</div>` : ''}</div>
    </div>
    <div class="tos-ideo-tags">
      ${o.stance ? `<span class="tos-ideo-tag" style="--ic:${o.color}">${esc(o.stance)}</span>` : ''}
      ${o.path ? `<span class="tos-ideo-tag" style="--ic:${o.color}">path · ${esc(o.pathLabel || o.path)}</span>` : ''}
      ${o.expansion ? `<span class="tos-ideo-tag" style="--ic:${o.color}">emerging</span>` : `<span class="tos-ideo-tag" style="--ic:${o.color}">${esc(o.tier)} · ${o.rep >= 0 ? '+' : ''}${o.rep}</span>`}
    </div>
    <p class="tos-ideo-lore"><span class="drop" style="color:${o.color};text-shadow:0 0 16px ${o.color}55">${drop}</span>${rest}</p>
    ${o.experience ? `<p class="tos-ideo-exp">${esc(o.experience)}</p>` : ''}
    ${o.pull ? `<p class="tos-ideo-pull" style="border-color:${o.color};color:${o.color}">${esc(o.pull)}</p>` : ''}
    ${o.tenets.length ? `<div class="tos-ideo-lbl">Creed</div><div class="tos-ideo-panel"><ul class="tos-ideo-tenets">${o.tenets.map(t => `<li style="--ic:${o.color}">${esc(t)}</li>`).join('')}</ul></div>` : ''}
    ${o.pathText ? `<div class="tos-ideo-lbl">Their path</div><div class="tos-ideo-panel"><div class="tos-ideo-pathbox">
      <div class="pm"><div class="tos-ideo-bar" style="height:8px"><i style="width:${ideoFormPct(o.path)}%;background:${o.color};box-shadow:0 0 10px ${o.color}"></i></div><div class="pml">form change</div></div>
      <div class="pt">${esc(o.pathText)}</div></div></div>` : ''}
    <div class="tos-ideo-lbl">Their place in the field</div>
    <div class="tos-ideo-panel">${renderIdeoField(d, o.id, accent)}</div>
    ${o.expansion
      ? `<div class="tos-ideo-lbl">Standing</div>
    <div class="tos-ideo-panel"><p class="tos-ideo-note tos-ideo-dim">This order has not yet surfaced in the Basin — you cannot take up standing with it yet. Consider this a preview of a road that is coming.</p></div>`
      : `<div class="tos-ideo-lbl">Your standing</div>
    <div class="tos-ideo-panel">
      <div class="tos-ideo-shead"><span class="rp" style="color:${o.color}">${o.rep >= 0 ? '+' : ''}${o.rep}</span><span class="nx">${nxt}</span></div>
      <div class="tos-ideo-bar" style="margin-bottom:13px"><i style="width:${ideoRepPct(o.rep)}%;background:${o.color};box-shadow:0 0 10px ${o.color}"></i></div>
      <div class="tos-ideo-ladder">${ladder}</div>
    </div>`}
    <div class="tos-ideo-lbl">Relations</div>
    <div class="tos-ideo-panel"><div class="tos-ideo-chips">${foes}${wary}</div>${o.relnote ? `<p class="tos-ideo-note tos-ideo-dim" style="margin-top:10px">${esc(o.relnote)}</p>` : ''}</div>
    <div class="tos-ideo-lbl">In the world</div>
    <div class="tos-ideo-panel">${npcs}</div>
  </div>`;
}

function renderIdeoFieldPage(d, accent) {
  const legend = d.orders.map(o => `<span><i style="background:${o.color};color:${o.color}"></i>${esc(o.name.replace('The ', ''))} · ${esc(o.path || '')}</span>`).join('');
  return `<div class="tos-ideo-page">
    <div class="tos-ideo-panel">${renderIdeoField(d, null, accent)}</div>
    <div class="tos-ideo-lbl">The two axes</div>
    <div class="tos-ideo-panel">
      <p class="tos-ideo-note"><b>Civilization</b> (↔) — the Basin and its Architect. <b>Renounce</b> it and leave, or <b>redeem</b> it and stay.<br><br><b>The body</b> (↕) — <b>stay human</b>, or <b>transcend</b> the form. The ascending orders climb by different means — that third choice of <em>path</em> is what the Overview's field unfolds.</p>
      <div class="tos-ideo-legend">${legend}<span><i style="background:#fff;color:${accent}"></i>You</span></div>
    </div>
  </div>`;
}

// Step the reader one page (−1 prev / +1 next), clamped. Shared by the tab
// strip, the horizontal swipe/drag, and the trackpad horizontal wheel.
function changeIdeoPage(dir) {
  if (!_data || _data.view !== 'codex' || _data.sectionKind !== 'orders') return;
  const count = (_data.orders?.length || 0) + 2; // Overview + orders + Field
  const next = Math.min(count - 1, Math.max(0, _tosIdeoPage + dir));
  if (next === _tosIdeoPage) return;
  _tosIdeoPage = next;
  sfx(TOS_SELECT_DEF);
  render();
}

/**
 * The Accolades app — your file, newest entry first.
 *
 * Two deliberate absences, both load-bearing (see plugins/accolades):
 *   • The entry count has NO denominator. Accolades is discovery-only, so
 *     "11 of 40" would convert a set of jokes into a checklist and spoil every
 *     unearned punchline by naming it.
 *   • The contribution meter is scaled against ONE stat point (100 XP) and can
 *     therefore never fill, because entries are worth 1 XP each and the catalog
 *     is a dozen strong. That is the answer to "what is 1 XP actually worth",
 *     drawn precisely and left without comment.
 */
// ── Vitals ────────────────────────────────────────────────────────────────────
// A cheap medical suite's read-out of the body. Three tabs, all server-built
// (plugins/tablet/health-app.js): the meters + what's dragging on you, the
// medical subset of your inventory with one-tap use, and the substance ledger.
//
// The colour is the whole interface: a player should be able to open this, see
// one red bar, and close it again without reading a word. Bands come from the
// server (good/warn/bad/crit) so the client never decides what "bad" means.

function renderHealthMeter(m) {
  return `
    <div class="tos-vt-meter">
      <div class="tos-vt-mlbl">
        <span>${esc(m.label)}</span>
        <span class="v">${esc(String(m.note || ''))}</span>
      </div>
      <div class="tos-vt-track"><div class="tos-vt-fill ${esc(m.band)}" style="width:${Math.max(0, Math.min(100, m.pct || 0))}%"></div></div>
    </div>`;
}

// Readouts — the vitals the body reports in WORDS. Hunger and thirst come through
// here rather than as bars: a bar invites you to play the number (top up at 80%,
// panic at 30%), and you don't know your hydration as a fraction, you know you're
// thirsty. Band still carries the colour; there is deliberately no track and no
// figure. The server owns the phrasing (health-app buildReadouts).
function renderHealthReadouts(readouts) {
  if (!readouts?.length) return '';
  return `<div class="tos-vt-readouts">${readouts.map(r => `
    <div class="tos-vt-readout">
      <span class="tos-vt-rlbl">${esc(r.label)}</span>
      <span class="tos-vt-rval ${esc(r.band || 'good')}">${esc(r.text || '')}</span>
    </div>`).join('')}</div>`;
}

// ── The paper doll ───────────────────────────────────────────────────────────
//
// Injuries are the first data in this game that is genuinely SPATIAL, and a list
// of seven wounds is worse than a picture of a body in every way. Bands come off
// the server like every other colour here, so this decides nothing — it only
// draws. Absent `d.body` (nothing wrong, or the injury plugin disabled) it
// renders nothing at all and Vitals is exactly the screen it always was.
//
// Sides are drawn from the VIEWER's perspective — your left arm is on the left —
// because this is a HUD, not an anatomical chart.
// Injury hotspots, drawn IN THE SILHOUETTE'S OWN COORDINATE SPACE — one set per
// body, each viewBox matching its mask's pixel dimensions exactly (male
// 242×540, female 500×708). That is what makes the registration exact rather
// than approximate: the mask is `contain`-fitted into a box of its own aspect,
// so an SVG unit here IS a mask pixel, and a rect over the left arm is over the
// left arm on both figures.
//
// The old single 120×178 set was a compromise between two very differently
// proportioned bodies and therefore fitted neither — noticeably so on the male
// figure, which is far narrower relative to its height (0.45 vs 0.71).
const DOLL_GEOM = {
  male: {
    viewBox: '0 0 242 540',
    shapes: {
      head:      '<circle cx="121" cy="40" r="26"/>',
      torso:     '<rect x="74" y="76" width="94" height="212" rx="24"/>',
      left_arm:  '<rect x="36" y="84" width="32" height="208" rx="16"/>',
      right_arm: '<rect x="174" y="84" width="32" height="208" rx="16"/>',
      left_leg:  '<rect x="83" y="288" width="37" height="214" rx="17"/>',
      right_leg: '<rect x="122" y="288" width="37" height="214" rx="17"/>',
      feet:      '<rect x="78" y="500" width="42" height="28" rx="12"/><rect x="122" y="500" width="42" height="28" rx="12"/>',
    },
  },
  female: {
    viewBox: '0 0 500 708',
    shapes: {
      head:      '<circle cx="250" cy="62" r="45"/>',
      torso:     '<rect x="184" y="116" width="132" height="248" rx="36"/>',
      left_arm:  '<rect x="118" y="128" width="54" height="238" rx="26"/>',
      right_arm: '<rect x="328" y="128" width="54" height="238" rx="26"/>',
      left_leg:  '<rect x="190" y="364" width="58" height="278" rx="27"/>',
      right_leg: '<rect x="252" y="364" width="58" height="278" rx="27"/>',
      feet:      '<rect x="176" y="634" width="66" height="36" rx="15"/><rect x="258" y="634" width="66" height="36" rx="15"/>',
    },
  },
};

// ── Alarm ────────────────────────────────────────────────────────────────────
// A digital clock you set by rolling digits, the way a phone does — replacing a
// text prompt that asked you to type "0730" and parsed three formats to be kind
// about it. Parsing input is not the same as offering a control.
//
// Two scroll-snap reels (hours, minutes) over the OS's own palette: the readout
// borrows the seven-segment cast the rest of the tablet uses for live numbers,
// and the selection band is the same accent that marks selection everywhere
// else. No new colours, no new type — the theming is entirely inherited.
//
// The reels are plain overflow-scroll with `scroll-snap-type: y mandatory`, so
// touch flick, trackpad, wheel and keyboard all work for free.
//
// A MOUSE, though, gets none of that: you can't drag a scroll container with a
// pointer, so on desktop the reel could only be clicked or wheeled, and grabbing
// a band and pulling it — the obvious thing to try — did nothing. So the pointer
// drag is added by hand, and ONLY for mouse/pen: touch already has native
// momentum and taking it over would be strictly worse. See the handlers in the
// wiring pass for why the snap has to be switched off mid-drag.
let _alarmPick = null;   // { h, m } while the player is choosing

function alarmReel(kind, values, selected) {
  const cells = values.map(v => {
    const label = String(v).padStart(2, '0');
    return `<div class="tos-al-cell${v === selected ? ' sel' : ''}" data-al-${kind}="${v}" role="option"
      aria-selected="${v === selected}" tabindex="0">${label}</div>`;
  }).join('');
  return `<div class="tos-al-reel" data-al-reel="${kind}" role="listbox" aria-label="${kind}">
    <div class="tos-al-pad"></div>${cells}<div class="tos-al-pad"></div>
  </div>`;
}

function renderAlarm(d) {
  const set = d.alarmMins != null;
  const pick = _alarmPick || (set
    ? { h: Math.floor(d.alarmMins / 60), m: d.alarmMins % 60 }
    // Default to an hour ahead of the game clock rather than to midnight: a
    // fresh alarm should open somewhere you might plausibly want it.
    : { h: (Math.floor(d.nowMins / 60) + 1) % 24, m: 0 });

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const mins = Array.from({ length: 12 }, (_, i) => i * 5);   // 5-min steps: a nap is not a stopwatch
  const pad = n => String(n).padStart(2, '0');

  return `
    <div class="tos-alarm">
      <div class="tos-al-face">
        <div class="tos-al-now">${esc(d.nowLabel)}</div>
        <div class="tos-al-nowlab">Local time</div>
      </div>

      <div class="tos-al-setter">
        <div class="tos-al-band" aria-hidden="true"></div>
        ${alarmReel('h', hours, pick.h)}
        <div class="tos-al-colon">:</div>
        ${alarmReel('m', mins, pick.m)}
      </div>

      <div class="tos-al-preview">Alarm at <b>${pad(pick.h)}:${pad(pick.m)}</b></div>

      <div class="tos-al-btns">
        <button class="tos-btn tos-al-set" data-al-commit="1">${set ? 'Change alarm' : 'Set alarm'}</button>
        ${set ? `<button class="tos-btn tos-al-clear" data-al-clear="1">Clear</button>` : ''}
      </div>

      ${set ? `<div class="tos-al-status">Ringing in ${esc(d.untilLabel || '')}</div>`
            : `<div class="tos-al-status tos-al-status-off">${esc(d.subtitle || '')}</div>`}

      <div class="tos-al-note">${esc(d.body || '').split('\n').join(' ')}</div>
    </div>`;
}

function renderHealthDoll(d) {
  if (!d.body?.length) return '';
  const geom = DOLL_GEOM[d.sex === 'female' ? 'female' : 'male'];
  const DOLL_SHAPES = geom.shapes;
  const parts = d.body.map(p => `
    <g class="tos-vt-doll-part ${esc(p.band)}${p.severity > 0 ? ' hurt' : ''}"
       data-doll-part="${esc(p.part)}"
       data-doll-detail="${esc(p.detail || `${p.partLabel}: no injury.`)}"
       role="button" tabindex="0"
       aria-label="${esc(p.partLabel)}${p.name ? `: ${esc(p.name)}` : ''}"
       title="${esc(p.detail || `${p.partLabel} — fine.`)}">
      ${DOLL_SHAPES[p.part] || ''}
    </g>`).join('');

  const worst = d.body.filter(p => p.severity > 0).sort((a, b) => b.severity - a.severity)[0];
  // The silhouette sits BEHIND the schematic rather than replacing it. The
  // boxes-and-circles are load-bearing here in a way the wardrobe's dummy never
  // was — each one is a click target and carries its own injury colour — so
  // this adds the body without costing the diagram. On a medical suite a scan
  // ghost under a schematic is exactly the right register anyway.
  const sil = (d.sex === 'female' || d.sex === 'male') ? d.sex : 'male';
  return `
    <div class="tos-vt-sect">Body</div>
    <div class="tos-vt-doll">
      <div class="tos-vt-dollstage tos-vt-sil-${sil}">
        <div class="tos-vt-dollsil" aria-hidden="true"></div>
        <svg viewBox="${geom.viewBox}" class="tos-vt-dollsvg" aria-label="Body diagram">${parts}</svg>
      </div>
      <div class="tos-vt-dolldet" data-doll-detail-slot>${esc(worst?.detail || 'No injuries. Tap a part for detail.')}</div>
    </div>`;
}

function renderHealthQuick(d) {
  if (!d.quick?.length) return '';
  const btns = d.quick.map(q => `
    <button class="tos-vt-quick" data-act-id="use" data-act-app="health" data-act-params="${esc(d.tab)} ${esc(q.id)}">
      <span class="act">${esc(q.label)}</span>
      <span class="itm">${esc(q.name)}${q.qty > 1 ? ` ×${q.qty}` : ''}</span>
    </button>`).join('');
  return `<div class="tos-vt-quickbar"><div class="tos-vt-sect">Immediate</div><div class="tos-vt-quickrow">${btns}</div></div>`;
}

function renderHealthAfflictions(list) {
  if (!list?.length) {
    return `<div class="tos-vt-clear">Nothing is currently wrong with you.<br><span>Enjoy it.</span></div>`;
  }
  return list.map(a => `
    <div class="tos-vt-aff ${esc(a.tone || 'warn')}">
      <div class="tos-vt-affname">${esc(a.label)}</div>
      <div class="tos-vt-affdet">${esc(a.detail || '')}</div>
    </div>`).join('');
}

function renderHealthApothecary(d) {
  const items = d.remedies || [];
  if (!items.length) {
    return `<div class="tos-vt-clear">You are carrying nothing medicinal.<br><span>The city does not hand it out.</span></div>`;
  }
  const SECTIONS = [
    ['medical', 'Medical'],
    ['compound', 'Compounds'],
    ['sustenance', 'Food &amp; water'],
  ];
  return SECTIONS.map(([kind, title]) => {
    const rows = items.filter(i => i.kind === kind).map(i => `
      <div class="tos-vt-item">
        <div class="tos-vt-itemtxt">
          <div class="tos-vt-itemname">${esc(i.name)}${i.qty > 1 ? `<span class="qty">×${i.qty}</span>` : ''}${
            i.addictive ? `<span class="tos-vt-flag">${esc(i.drugClass || 'habit-forming')}</span>` : ''}</div>
          <div class="tos-vt-itemeff">${esc(i.effect)}</div>
        </div>
        <button class="tos-btn" data-act-id="use" data-act-app="health" data-act-params="apothecary ${esc(i.id)}">Use</button>
      </div>`).join('');
    return rows ? `<div class="tos-vt-sect">${title}</div>${rows}` : '';
  }).join('');
}

function renderHealthSubstances(d) {
  const subs = d.substances || [];
  if (!subs.length) {
    return `<div class="tos-vt-clear">Your bloodwork is boring.<br><span>No compound has ever been through you.</span></div>`;
  }
  return subs.map(s => {
    const flags = [];
    if (s.addicted) flags.push('<span class="tos-vt-flag bad">dependent</span>');
    if (s.substituted) flags.push('<span class="tos-vt-flag">substituted</span>');
    const wd = s.withdrawalPct > 0
      ? `<div class="tos-vt-subwd bad">Withdrawal biting at ${s.withdrawalPct}%.</div>`
      : s.withdrawalIn
        ? `<div class="tos-vt-subwd">Starts asking in about ${esc(s.withdrawalIn)}.</div>`
        : '';
    const loadBand = s.loadPct >= 75 ? 'crit' : s.loadPct >= 50 ? 'bad' : s.loadPct >= 25 ? 'warn' : 'good';
    return `
      <div class="tos-vt-sub">
        <div class="tos-vt-subhead">
          <span class="n">${esc(s.name)}</span>
          <span class="f">${flags.join('')}</span>
        </div>
        <div class="tos-vt-subgrid">
          <span>Tolerance</span><b>${s.tolerancePct}%</b>
          <span>Doses in system</span><b>${s.doses} / ${s.ceiling}</b>
          <span>Times used</span><b>${s.timesUsed}</b>
          <span>Last dose</span><b>${esc(s.lastUse || '—')}</b>
        </div>
        <div class="tos-vt-track sm"><div class="tos-vt-fill ${loadBand}" style="width:${Math.max(0, Math.min(100, s.loadPct))}%"></div></div>
        <div class="tos-vt-subload">System load against this compound's overdose ceiling.</div>
        ${wd}
      </div>`;
  }).join('');
}

function renderHealth(d) {
  const notice = d.notice ? `<div class="tos-vt-notice">${esc(d.notice)}</div>` : '';
  if (d.tab === 'apothecary') return `${notice}${renderHealthApothecary(d)}`;
  if (d.tab === 'substances') return `${notice}${renderHealthSubstances(d)}`;
  // Two columns where there's room: the body is a tall narrow thing and the
  // readings are a stack of short wide ones, so side by side they finish at
  // roughly the same depth. Stacked (the old layout) the doll left a
  // panel-wide band of empty box beside it and pushed every meter below the
  // fold. Below 620px the grid collapses back to one column.
  const readings = `
    <div class="tos-vt-sect">Readings</div>
    <div class="tos-vt-meters">${(d.meters || []).map(renderHealthMeter).join('')}</div>
    ${renderHealthReadouts(d.readouts)}
    <div class="tos-vt-sect">Presenting</div>
    <div class="tos-vt-affs">${renderHealthAfflictions(d.afflictions)}</div>`;
  const doll = renderHealthDoll(d);
  if (!doll) return `${notice}${renderHealthQuick(d)}${readings}`;
  return `
    ${notice}
    ${renderHealthQuick(d)}
    <div class="tos-vt-cols">
      <div class="tos-vt-col-body">${doll}</div>
      <div class="tos-vt-col-read">${readings}</div>
    </div>`;
}

function renderAccolades(d) {
  const rows = (d.entries || []).map((e, i) => `
    <div class="tos-acc-row${i === (d.entries.length - 1) ? ' first' : ''}">
      <div class="tos-acc-title">${esc(e.title)}</div>
      <div class="tos-acc-line">${esc(e.line)}</div>
      <div class="tos-acc-foot"><span>${e.at ? esc(tosStamp(e.at)) : ''}</span><span class="xp">+1 XP</span></div>
    </div>`).join('');

  const empty = `<div class="tos-acc-empty">Your file is empty.<br><span>That is not the same as clean.</span></div>`;

  return `
    <div class="tos-acc-head">
      <div>
        <div class="tos-acc-app">Accolades</div>
        <div class="tos-acc-sub">Observations on file</div>
      </div>
      <div class="tos-acc-count"><b>${d.count || 0}</b>${d.count === 1 ? 'entry' : 'entries'} on file</div>
    </div>
    <div class="tos-acc-meter">
      <div class="tos-acc-meter-lbl">
        <span>Lifetime contribution</span>
        <span class="v">${esc(String(d.statPoints || '0.00'))} stat points &middot; ${d.xp || 0} / 100 XP</span>
      </div>
      <div class="tos-acc-track"><div class="tos-acc-fill" style="width:${Math.max(0, Math.min(100, d.meterPct || 0))}%"></div></div>
    </div>
    <div class="tos-acc-rows">${rows || empty}</div>
    ${rows ? `<div class="tos-acc-endfile">&#9642; End of file &#9642; Further entries at our discretion</div>` : ''}
  `;
}

// ── B.L.I.S.S. ────────────────────────────────────────────────────────────────
// Bonded Live-In Intimacy Subscription Service. The app is MIS-gated server-side
// (the tile doesn't exist without MIS on), so these renderers never run for a
// player who hasn't opted in. Three screens: the rotating catalogue, one
// placement in full, and whatever you currently keep.
//
// The voice throughout is the Syndicate's — procedural, clinical, entirely
// untroubled by what it's selling. That contrast IS the joke; don't warm it up.

function blissChrome(sub) {
  return `<div class="tos-bliss-head">
    <div>
      <div class="tos-bliss-app">B.L.I.S.S.</div>
      <div class="tos-bliss-expand">Bonded Live-In Intimacy Subscription Service</div>
    </div>
    <div class="tos-bliss-sub">${esc(sub || '')}</div>
  </div>`;
}

function renderBlissListings(d) {
  const cards = (d.listings || []).map(l => {
    const pairTag = l.pairing
      ? `<div class="tos-bliss-pairtag">${esc(l.pairing.label)} &middot; non-severable</div>` : '';
    const who = (l.members || []).map(m => `
      <div class="tos-bliss-who">
        <div class="tos-bliss-name">${esc(m.name)} <span class="sex">${m.sex === 'male' ? '♂' : '♀'}</span></div>
        <div class="tos-bliss-says">${esc(m.says)}</div>
        <div class="tos-bliss-phys">${esc(m.summary)}</div>
      </div>`).join('');
    return `<div class="tos-bliss-card" data-act-id="open" data-act-app="bliss" data-act-params="${esc(l.id)}">
      ${pairTag}${who}
      <div class="tos-bliss-rate"><b>${l.rate}c</b> / day</div>
    </div>`;
  }).join('');

  const rr = d.reroll || {};
  const rerollBtn = rr.ready
    ? `<button class="tos-btn" data-act-id="reroll" data-act-app="bliss" data-act-params="">↻ Refresh the register</button>`
    : `<button class="tos-btn disabled" disabled>↻ Refreshes in ${esc(rr.remainingLabel || '')}</button>`;

  return `
    ${blissChrome(`${(d.listings || []).length} placements available`)}
    <div class="tos-bliss-strap">${esc(d.smallprint || '')}</div>
    <div class="tos-bliss-grid">${cards}</div>
    <div class="tos-actions">
      ${rerollBtn}
      <button class="tos-btn" data-act-id="arrangement" data-act-app="bliss" data-act-params="">Your arrangement${d.heldCount ? ` (${d.heldCount})` : ''}</button>
    </div>`;
}

function renderBlissDetail(d) {
  const l = d.listing || {};
  const who = (l.members || []).map(m => `
    <div class="tos-bliss-detailwho">
      <div class="tos-bliss-name">${esc(m.name)} <span class="sex">${m.sex === 'male' ? '♂' : '♀'}</span></div>
      <div class="tos-bliss-says">${esc(m.says)}</div>
      <div class="tos-bliss-note">${esc(m.note)}</div>
      <table class="tos-bliss-spec">${(m.physical || []).map(([k, v]) =>
        `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
    </div>`).join('');

  const pair = l.pairing ? `<div class="tos-bliss-pairbox">
      <div class="tos-bliss-pairtag">${esc(l.pairing.label)}</div>
      <div>${esc(l.pairing.blurb)}</div>
      <div class="tos-bliss-note">${esc(l.pairing.note)}</div>
    </div>` : '';

  const proj = `<table class="tos-bliss-proj"><tr><th>Tenure</th><th>Rate</th><th></th></tr>
    ${(l.projection || []).map(p =>
      `<tr><td>${p.days} days</td><td><b>${p.rate}c</b></td><td>${esc(p.label)}</td></tr>`).join('')}</table>`;

  // Where to put them. No private address on file → no placement.
  const places = d.blocked
    ? `<div class="tos-bliss-blocked">${esc(d.blocked)}</div>`
    : `<div class="tos-actions">${(d.spaces || []).map(s =>
        `<button class="tos-btn" data-act-id="place" data-act-app="bliss" data-act-params="${esc(l.id)}|${esc(s.id)}"
           data-act-confirm="Place at ${esc(s.name)}? The first day's retainer of ${l.rate}c is drawn immediately.">
           ${esc(s.name)} <span class="dim">${esc(s.label)}</span></button>`).join('')}</div>`;

  return `
    ${blissChrome(`${l.rate}c / day`)}
    ${pair}
    <div class="tos-bliss-grid detail">${who}</div>
    <div class="tos-bliss-secthead">Retainer &amp; tenure</div>
    <div class="tos-bliss-note">The rate falls the longer a placement stays. Loyalty is cheaper than novelty.</div>
    ${proj}
    <div class="tos-bliss-secthead">Deliver to</div>
    ${places}
    <div class="tos-actions"><button class="tos-btn" data-act-id="listings" data-act-app="bliss" data-act-params="">← Back to the register</button></div>`;
}

function renderBlissArrangement(d) {
  if (d.empty) {
    return `${blissChrome('No active placement')}
      <div class="tos-bliss-blocked">You keep nobody. The Syndicate notes this without judgement and with some disappointment.</div>
      <div class="tos-actions"><button class="tos-btn" data-act-id="listings" data-act-app="bliss" data-act-params="">Browse the register</button></div>`;
  }
  // A HOUSE placement is somebody's own staff, not a Syndicate rental: it is
  // listed exactly like the rest (that's the point — they're yours and should be
  // on your account), but it bills nothing, has no tenure ladder to climb, and
  // shows no Release button, because B.L.I.S.S. cannot collect what it never placed.
  const rows = (d.entries || []).map(e => `
    <div class="tos-bliss-held${e.house ? ' house' : ''}">
      <div class="tos-bliss-name">${esc(e.names.join(' &amp; '))}${e.pairing ? ` <span class="dim">${esc(e.pairing)}</span>` : ''}${e.house ? ' <span class="tos-bliss-housetag">House</span>' : ''}</div>
      ${e.house ? `
      <div class="tos-bliss-heldline">
        <span>Retained by the house</span>
        <span><b>No retainer</b></span>
      </div>
      <div class="tos-bliss-note">Yours outright. The Syndicate bills nothing and arranges nothing.</div>`
      : `
      <div class="tos-bliss-heldline">
        <span>${e.daysKept} day${e.daysKept === 1 ? '' : 's'} &middot; ${esc(e.tier.label)}</span>
        <span><b>${e.todayRate}c</b>/day${e.saving ? ` <span class="save">(−${e.saving}c)</span>` : ''}</span>
      </div>
      <div class="tos-bliss-note">${esc(e.tier.note)}</div>
      ${e.missed ? `<div class="tos-bliss-warn">${e.missed} missed payment — one more and the placement is collected.</div>` : ''}
      <div class="tos-actions"><button class="tos-btn" data-act-id="release" data-act-app="bliss" data-act-params="${esc(e.id)}"
        data-act-confirm="Release ${esc(e.names.join(' and '))}? ${e.names.length > 1 ? 'A matched pair goes together. ' : ''}This cannot be undone.">Release</button></div>`}
    </div>`).join('');

  return `${blissChrome(`${d.dailyTotal}c / day total`)}
    <div class="tos-bliss-grid held">${rows}</div>
    <div class="tos-actions"><button class="tos-btn" data-act-id="listings" data-act-app="bliss" data-act-params="">Browse the register</button></div>`;
}

// Entry timestamps are epoch seconds from the DB; the file wants a date, not a clock.
function tosStamp(sec) {
  try {
    const dt = new Date(Number(sec) * 1000);
    if (!Number.isFinite(dt.getTime())) return '';
    return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
           dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function renderIdeology(d, crumb) {
  const accent = _ideoAccent();
  const keys = IDEO_PAGES_KEY(d);
  if (_tosIdeoPage < 0 || _tosIdeoPage >= keys.length) _tosIdeoPage = 0;
  const key = keys[_tosIdeoPage];
  let body;
  if (key === 'overview') body = renderIdeoOverview(d, accent);
  else if (key === 'field') body = renderIdeoFieldPage(d, accent);
  else body = renderIdeoOrder(d.orders.find(o => o.id === key), d, accent);
  return `<div class="tos-ideo-root"><div class="tos-ideo-sticky">${crumb || ''}${renderIdeoNav(d, _tosIdeoPage)}</div>${body}</div>`;
}

// Off the grid: the Map app has no city signal out in the void, so instead of the
// city tile-map it becomes an "off-grid survey terminal" — the shared trail chart
// (crossingInnerHtml, same source as the minimap) blown up as the hero (client-
// zoomable) and framed with dead-signal instruments: scrambled coords, depth/ground
// readout with no bearing fix, and live status chips. Fills the space and sells the
// void; carries no data the minimap doesn't (payload is just `nodes`). Short-circuits
// the tile path.
const JOURNEY_SUBSTRATE = { scrub: 'SCRUBLAND', ash: 'ASH FLATS', redrock: 'RED ROCK', marsh: 'DEAD MARSH', road: 'OLD ROADBED', dirt_road: 'DIRT TRACK' };
function journeyAhead(nodes, cur) {
  if (cur.void_detour) return 'dead';
  const sId = cur.exits?.south;
  if (!sId) return 'none';
  return nodes.some(n => n.id === sId) ? 'fog' : 'gate';
}
// How many void rooms sit behind you on the charted window (the walked trail depth),
// following the "back" exit (north, or east on a dead-end detour) room to room.
function journeyDepth(nodes, cur) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  let depth = 0, n = cur, guard = 0;
  while (guard++ < 40) {
    const b = byId.get(n.exits?.[n.void_detour ? 'east' : 'north']);
    if (!b || !b.void_crossing) break;
    depth++; n = b;
  }
  return depth;
}
function renderJourneyMap(d) {
  const nodes = d.nodes || [];
  const cur = nodes.find(n => n.is_current);
  if (!cur) return `<div class="tos-empty">◈ NO SIGNAL — you are off the grid, out in the void.</div>`;
  const ahead = journeyAhead(nodes, cur);
  const substrate = JOURNEY_SUBSTRATE[cur.terrain] || 'TRACKLESS WASTE';
  const back = cur.void_detour ? 'east' : 'north', fwd = cur.void_detour ? null : 'south';
  const ways = Object.keys(cur.exits || {}).filter(dir => dir !== back && dir !== fwd).length;
  const depth = journeyDepth(nodes, cur);
  const chips = [];
  if (cur.void_hard) chips.push(`<span class="tos-jchip hazard">⚠ HARD GROUND</span>`);
  if (cur.void_detour) chips.push(`<span class="tos-jchip dead">▚ DEAD END</span>`);
  if (ahead === 'gate') chips.push(`<span class="tos-jchip gate">⌂ GATE IN SIGHT</span>`);
  else if (ahead === 'fog') chips.push(`<span class="tos-jchip fog">⋯ TRAIL UNKNOWN</span>`);
  if (ways > 0) chips.push(`<span class="tos-jchip fork">⋔ ${ways} WAY${ways > 1 ? 'S' : ''} OFF</span>`);

  const zoutOff = _tosVoidZoom <= VOID_ZMIN + 0.001 ? ' disabled' : '';
  const zinOff = _tosVoidZoom >= VOID_ZMAX - 0.001 ? ' disabled' : '';
  return `<div class="tos-journey" style="--tos-void-scale:${_tosVoidZoom}">
    <div class="tos-journey-hdr">
      <span class="tos-journey-nosig">▚ NO SIGNAL · OFF THE GRID ▚</span>
      <span class="tos-journey-hdr-r">
        <span class="tos-journey-coord">POS <b>██·██ / ██·██</b> · UNCHARTED</span>
        <span class="tos-void-zoom">
          <button class="tos-vz" data-void-zoom="out" title="Zoom out"${zoutOff}>−</button>
          <button class="tos-vz" data-void-zoom="in" title="Zoom in"${zinOff}>+</button>
        </span>
      </span>
    </div>
    <div class="tos-journey-stage">
      <span class="tos-journey-bracket tl"></span><span class="tos-journey-bracket tr"></span>
      <span class="tos-journey-bracket bl"></span><span class="tos-journey-bracket br"></span>
      <div class="tos-journey-rail left">
        <div class="tos-journey-readout"><span>DEPTH</span><b>${depth ? depth + ' DEEP' : 'THRESHOLD'}</b></div>
        <div class="tos-journey-readout"><span>SUBSTRATE</span><b>${substrate}</b></div>
        <div class="tos-journey-readout"><span>BEARING</span><b class="nofix">NO FIX · DRIFT</b></div>
      </div>
      <div class="tos-journey-trailwrap">
        <div class="tos-journey-sweep" aria-hidden="true"></div>
        <div class="mm-crossing tos-journey-trail">${crossingInnerHtml(nodes, cur)}</div>
      </div>
      <div class="tos-journey-rail right">
        ${chips.length ? `<div class="tos-journey-chips">${chips.join('')}</div>` : `<div class="tos-journey-quiet">TRAIL QUIET</div>`}
      </div>
    </div>
    <div class="tos-journey-hint">No city map out here. The only way through the void is through it.</div>
  </div>`;
}

function renderMap(d) {
  if (d.mode === 'crossing') return renderJourneyMap(d);
  let tiles = d.tiles || [];
  // Regional: show the whole contiguous landmass (server landmassTiles already scopes
  // it to your cluster), like the full map. We no longer filter to a single land-use
  // category, which shredded multi-func regions into blank cells.
  const mode = d.mode || 'zone';

  if (!tiles.length) {
    return `<div class="tos-empty">No map data for this level.</div>`;
  }
  if (!_tosMapSel || !tiles.some(t => t.id === _tosMapSel)) _tosMapSel = null;

  const route = getTracePath() || [];
  const dest = route.length > 1 ? route[route.length - 1] : null;

  // Edge-to-edge 1:1 grid: one cell per zone, tiles touch (roads/buildings render
  // their own SVG footprint), mirroring the full-map popup — no connector/gap cells.
  // Regional packs every distinct occupied coord to a dense index (so a far-flung
  // district can't blow the grid up); zone/interior stay 1:1 on the raw local window.
  const xs = tiles.map(t => t.x), ys = tiles.map(t => t.y);
  const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
  let colOf, rowOf, gCols, gRows;
  // absAt(c,r) → the absolute world grid [x,y] of grid cell (c,r), used to tint empty
  // corner cells as the cosmetic Coldwater Bay. Set per mode below (null if we can't
  // resolve absolute coords — e.g. an interior with no district tiles — so no fill).
  let absAt = null;
  if (mode === 'regional') {
    const ux = [...new Set(xs)].sort((a, b) => a - b), uy = [...new Set(ys)].sort((a, b) => a - b);
    const xi = new Map(ux.map((x, i) => [x, i])), yi = new Map(uy.map((y, i) => [y, i]));
    colOf = t => xi.get(t.x); rowOf = t => yi.get(t.y);
    gCols = ux.length; gRows = uy.length;
    // Regional tiles carry absolute grid coords, packed to dense indices — so a cell's
    // absolute coord is just the unique value at that column/row.
    absAt = (c, r) => [ux[c], uy[r]];
  } else {
    colOf = t => t.x - minX; rowOf = t => t.y - minY;
    gCols = maxX - minX + 1; gRows = maxY - minY + 1;
    // Zone/interior tiles are center-relative; recover the absolute origin from any
    // district tile (id = zone_district_<x>_<y>), then offset by the cell's column/row.
    for (const t of tiles) {
      const co = districtCoord(t.id);
      if (co) { const ax0 = co[0] - colOf(t), ay0 = co[1] - rowOf(t); absAt = (c, r) => [ax0 + c, ay0 + r]; break; }
    }
  }
  const cell = Array.from({ length: gRows }, () => new Array(gCols).fill(null));
  const tById = new Map();
  for (const t of tiles) { cell[rowOf(t)][colOf(t)] = t; tById.set(t.id, t); }

  let grid = `<div class="tos-map-grid" style="--tos-tile:${tosZoomPx(d)}px;grid-template-columns:repeat(${gCols},var(--tos-tile));grid-template-rows:repeat(${gRows},var(--tos-tile))">`;
  // Canonical terrain fills (mirror minimap.js TERRAIN_FILL). 'road' is handled separately.
  const TOS_TERRAIN_FILL = {
    water: '#3f7fb0', grass: '#5a9e57', park: '#46a24e', asphalt: '#45484d', concrete: '#8a8d91',
    dirt: '#6b5138', sand: '#c2b280', gravel: '#7d7a73', dock: '#6e5636', dirt_road: '#7d6236',
    scrub: '#6f7248', redrock: '#6f3524', ash: '#4f4b47', marsh: '#4d5a30',
  };
  for (let r = 0; r < gRows; r++) for (let c = 0; c < gCols; c++) {
    const t = cell[r][c];
    const pos = `grid-column:${c + 1};grid-row:${r + 1}`;
    if (!t) {
      const wc = absAt && absAt(c, r);
      if (wc && isWorldWaterVoid('map_world', wc[0], wc[1]))
        grid += `<span class="tos-map-tile terr terr-water" style="${pos};background-color:${WATER_VOID_FILL};pointer-events:none;" title="Coldwater Bay"></span>`;
      else grid += `<span style="${pos}"></span>`;
      continue;
    }
    const cls = ['tos-map-tile'];
    if (t.danger && t.danger !== 'safe') cls.push('d-' + t.danger);
    if (t.reachable === false) cls.push('unreach');
    if (t.id === dest && !t.isCurrent) cls.push('dest');
    if (t.id === _tosMapSel) cls.push('sel');
    if (t.isCurrent) cls.push('cur');
    // Tileable terrain (mirrors the sidebar/full-map minimap): roads → grey asphalt +
    // yellow markings; every other ground type → a seamless coloured expanse (marker
    // dropped). water/grass keep authored bg priority; newer types use their canonical fill.
    const terrain = (t.terrain === 'road' || TOS_TERRAIN_FILL[t.terrain]) ? t.terrain : null;
    let sym = _mapTileSym(t);
    let style = pos + ';';
    if (terrain === 'road') { style += 'background-color:#4c5157;color:#f2c53d;'; cls.push('terr', 'terr-road'); }
    // dirt_road: same auto-tiled connector, recoloured to a packed-dirt track (keep the symbol).
    else if (terrain === 'dirt_road') { style += 'background-color:#7d6236;color:#c9a86a;'; cls.push('terr', 'terr-dirt_road'); }
    else if (terrain) {
      const fill = (terrain === 'water' || terrain === 'grass') ? (t.bg_color || TOS_TERRAIN_FILL[terrain]) : TOS_TERRAIN_FILL[terrain];
      style += `background-color:${fill};`;
      cls.push('terr', 'terr-' + terrain);
      // Terrain paints the GROUND, so an authored zone-icon SVG standing on it (a
      // statue, a helipad, an AA nest) survives the fill — only the POI glyph, which
      // is a landmark hint for the adjacent street rather than this tile's own
      // footprint, drops for a clean expanse.
      if (!t.isCurrent && !t.svg) sym = '';
    }
    // Regional view tints each non-terrain tile by land-use function, like the popup.
    else if (mode === 'regional' && FUNC_LEGEND[t.func]) {
      const [rr, gg, bb] = _mapHexRgb(FUNC_LEGEND[t.func].color);
      style += `background:rgba(${rr},${gg},${bb},0.30);`;
    }
    const badges = (t.isCurrent ? '<span class="mt-you">◉</span>' : '')
      + (t.id === dest && !t.isCurrent ? '<span class="mt-dest">⚑</span>' : '');
    // Doors as edge lines: an interior room gets a hairline on all four sides — green
    // where it opens through, red where it's wall (server `open_dirs`); a facade out on
    // the street gets the green door edge alone, no red.
    let ent = '', exits = '';
    if (Array.isArray(t.open_dirs)) {
      exits = ['north', 'south', 'east', 'west'].map(dr =>
        `<span class="tos-edge tos-edge-${dr} ${t.open_dirs.includes(dr) ? 'open' : 'shut'}"></span>`).join('');
    } else {
      // Out on the street: the door edge goes green and the other three stay bare. The
      // red "wall" half is a floorplan idea — outside it would just outline everything.
      ent = ['north', 'south', 'east', 'west'].includes(t.entrance)
        ? `<span class="tos-edge tos-edge-${t.entrance} open"></span>` : '';
    }
    // Perimeter wall (mirrors the sidebar minimap): gate tiles get a highlighted
    // opening, other curtain tiles a shimmer-edge, the glacis kill-zone a hazard tint.
    if (t.perimeter_gate) cls.push('tos-gate');
    else if (t.curtain) cls.push('tos-curtain');
    else if (t.glacis) cls.push('tos-glacis');
    // Label mode: stamp the building's two-letter code over its tile (hides the icon).
    const _bc = mapLabelsOn() && _mapIsBldg(t) ? _mapBldgCode(t) : null;
    const code = _bc ? `<span class="mt-code">${esc(_bc)}</span>` : '';
    grid += `<div class="${cls.join(' ')}" style="${style}" data-map-zone="${esc(t.id)}" title="${esc(t.name)}">${badges}${code || sym}${ent}${exits}</div>`;
  }
  // GPS route line: an accent polyline through route tile centres, laid over the grid
  // as an SVG spanning every track (viewBox in tile units), mirroring the minimap.
  const gpsPts = [];
  for (const id of route) {
    const t = tById.get(id);
    if (!t) continue;
    gpsPts.push(`${(colOf(t) + 0.5).toFixed(2)},${(rowOf(t) + 0.5).toFixed(2)}`);
  }
  if (gpsPts.length > 1)
    grid += `<svg class="tos-gps-svg" viewBox="0 0 ${gCols} ${gRows}" preserveAspectRatio="none"><polyline class="tos-gps-line" points="${gpsPts.join(' ')}"/></svg>`;
  grid += '</div>';

  // Map + right rail: the map pans on its own inside .tos-map-wrap, and the legend
  // stays pinned to the top of the rail while the buildings list + detail scroll
  // under it — so the tablet panel itself never has to scroll (drag = pan, always).
  return `${renderMapCtl(d)}${renderMapBar(d)}<div class="tos-map-main">`
    + `<div class="tos-map-wrap">${grid}</div>`
    + `<div class="tos-map-side">${tosIsMobile() ? '' : renderMapLegend(mode)}`
    + `<div class="tos-map-side-scroll">${renderMapBuildings(d)}`
    + `<div class="tos-map-detail" id="tos-map-detail">${renderMapDetail(d)}</div></div></div>`
    + `</div>`;
}

// Persistent map controls (mirroring the sidebar minimap): Run + Auto-walk toggles,
// a recenter-on-you button, and a −/+ zoom stepper. Run/Auto reflect the shared
// minimap state so they light up wherever it's driven from.
function renderMapCtl(d) {
  const run = isRunning() ? ' active' : '';
  const auto = isAutoWalking() ? ' active' : '';
  // One zoom axis: out grows the tile window until it's the whole region; in tightens
  // it back to the local street, then into the interior when you're in a building.
  const zoutOff = _mapCanZoom(d, -1) ? '' : ' disabled';
  const zinOff = _mapCanZoom(d, 1) ? '' : ' disabled';
  const noRoute = (getTracePath() || []).length < 2 ? ' disabled' : '';
  return `<div class="tos-map-ctl">
    <span class="tos-map-mini${run}" data-map-run title="Toggle running">🏃 Run</span>
    <span class="tos-map-mini${auto}" data-map-autotoggle title="Toggle auto-walk to the plotted route">➤ Auto</span>
    <span class="tos-map-mini" data-map-recenter title="Recenter on you">◎ Center</span>
    <span class="tos-map-mini${noRoute}" data-map-clear title="Clear the plotted GPS route">🧭 Clear</span>
    <span class="tos-map-mini${mapLabelsOn() ? ' active' : ''}" data-map-labels title="Toggle two-letter building labels — also switches the sidebar minimap">🏷 Labels</span>
    <span class="tos-map-zoom">
      <button class="tos-mz" data-map-zoom="out" title="Zoom out"${zoutOff}>−</button>
      <button class="tos-mz" data-map-zoom="in" title="Zoom in"${zinOff}>+</button>
    </span>
  </div>`;
}

// The map arg one zoom step from the current payload, or null at an end of the axis.
// dir −1 = zoom out (wider window → region), +1 = zoom in (→ interior when inside).
function _mapZoomArg(d, dir) {
  const mode = d.mode || 'zone', level = d.zoomLevel ?? 0, max = d.maxZoom ?? 0;
  if (dir < 0) {
    if (mode === 'interior') return 'z0';
    if (level < max) return 'z' + (level + 1);
    return null; // already regional
  }
  if (mode === 'interior') return null; // already innermost
  if (level === 0) return d.insideInterior ? 'interior' : null;
  return 'z' + (level - 1);
}
const _mapCanZoom = (d, dir) => _mapZoomArg(d, dir) !== null;

// The server zoom arg for the payload's *current* stop — interior / regional / z<n> —
// so a refresh (player moved) re-requests the same window width, not the default.
function _tosMapZoomArg(d) {
  if (d.mode === 'interior') return 'interior';
  if (d.mode === 'regional') return 'regional';
  return 'z' + (d.zoomLevel ?? 0);
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
  return `<div class="tos-map-bar"><span class="tos-map-route">${status}</span></div>`;
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

// Named buildings/landmarks present in the current view. Each entry is tied to its
// tile by zone id: clicking it selects + centres that building, and clicking a
// building tile lights up its legend name — the two stay in sync (mapSyncSelection).
function mapBuildingTiles(d) {
  const seen = new Set();
  return (d.tiles || [])
    .filter(t => (t.building_type || t.building_name || t.poi) && !seen.has(t.id) && seen.add(t.id))
    .sort((a, b) => (a.building_name || a.name).localeCompare(b.building_name || b.name));
}
function renderMapBuildings(d) {
  const bldgs = mapBuildingTiles(d);
  if (!bldgs.length) return '';
  const items = bldgs.map(t => {
    const label = t.building_name || t.name;
    const icon = t.icon ? `${esc(t.icon)} ` : '';
    return `<span class="tos-map-bldg${t.id === _tosMapSel ? ' sel' : ''}" data-map-bldg="${esc(t.id)}" title="${esc(label)}">${icon}${esc(label)}</span>`;
  }).join('');
  return `<div class="tos-map-bldgs"><div class="tos-map-bldgs-t">Buildings</div><div class="tos-map-bldgs-list">${items}</div></div>`;
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
// hues), presented as a little in-tablet "browser window" (title bar + traffic
// lights + address bar). No preset palette: the wheel is the only input. It
// fires `set_corp-color`, routed through the wireBody handlers like the corp
// buttons. No "taken"/uniqueness gating.
function renderColorPicker(appId, current) {
  const cur = String(current || '').toLowerCase();
  const valid = /^#[0-9a-f]{6}$/.test(cur) ? cur : '#35c95a';
  const hex = (cur || valid).toUpperCase();
  const win = `<div class="tos-browserwin">
      <div class="tos-bw-bar">
        <span class="tos-bw-dots"><i class="r"></i><i class="y"></i><i class="g"></i></span>
        <span class="tos-bw-url">corp://colour/picker</span>
      </div>
      <div class="tos-bw-body">
        <div class="tos-color-row">
          <input type="color" class="tos-color tos-color-lg" data-set-corp-color="${esc(appId)}" value="${esc(valid)}" title="Pick any colour">
          <span class="tos-color-hex">${esc(hex)}</span>
          <span class="tos-color-hint">This colour marks your turf on the territory map.</span>
        </div>
      </div>
    </div>`;
  return renderSection('Corp Colour', win);
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
// now (speech, arrivals, exits, actions). "Clip → Reel" saves exactly these.
// Speech (say) and narration/emote (event) lines are class-tagged so the theme
// can colour them apart.
function renderBufferLog(buffer, recording, full) {
  const lines = Array.isArray(buffer) ? buffer : [];
  const cap = full ? ' <span class="tos-buf-full">FULL</span>' : '';
  const head = `<div class="tos-buf-head">◉ ON TAPE${lines.length ? ` · ${lines.length} line${lines.length === 1 ? '' : 's'}` : ''}${cap}</div>`;
  if (!lines.length) {
    return `${head}<div class="tos-buf empty">${recording ? 'Nothing on tape yet — activity in this zone will log here.' : 'Not recording. Hit Record to start a tape.'}</div>`;
  }
  const body = lines.map(l => `<div class="tos-buf-line ${l.kind === 'say' ? 'say' : 'event'}"><span class="tos-buf-t">${esc(l.t || '')}</span> <span class="tos-buf-txt">${esc(l.text || '')}</span></div>`).join('');
  return `${head}<div class="tos-buf">${body}</div>`;
}

// ── Gear app ─────────────────────────────────────────────────────────────
// A paperdoll over a human silhouette (the stored PNG, accent-tinted): five body
// slots (each showing the piece worn in the selected layer), plus weapon and
// accessory, anchored over the figure. Below sits the per-region soak table and the
// summed passive effects — the same data the desktop Gear panel shows, reformatted
// for the tablet.
const GEAR_LAYER_DEFS = [{ n: 1, label: 'Under' }, { n: 2, label: 'Over' }, { n: 3, label: 'Armor' }];
const GEAR_SLOT_LABEL = { head: 'Head', torso: 'Torso', hands: 'Hands', legs: 'Legs', feet: 'Feet', weapon_hand: 'Weapon', accessory: 'Accessory' };
const GEAR_DMG = ['kinetic', 'edged', 'energy', 'fire', 'radiation'];
const GEAR_ARMOR_SLOTS = ['head', 'torso', 'hands', 'legs', 'feet'];
// Slots that fold into the Inventory tab's two WORN groups (Clothing / Armour). The
// body slots plus accessories — deliberately not weapon_hand, which stays in the main
// list where you can see it next to the rest of your kit. Kept separate from
// GEAR_ARMOR_SLOTS because that one drives the paperdoll and the soak table, where an
// accessory has no body region to protect.
const WORN_GROUP_SLOTS = [...GEAR_ARMOR_SLOTS, 'accessory'];
// Monochrome line icons (stroke = currentColor → tinted to the theme accent) for
// the far-right loadout readouts: total worn armor + insulation temperature.
const GEAR_SHIELD_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 2.5v5.6c0 4.4-3 7.4-7 9.4-4-2-7-5-7-9.4V5.5z"/></svg>`;
const GEAR_THERMO_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a3.5 3.5 0 1 0 4 0z"/><path d="M12 9v6.2"/></svg>`;
// One monochrome line-icon per damage type (stroke/fill = currentColor → theme accent),
// shared by the hover tooltips and the armor-breakdown popup.
const GEAR_DMG_ICON = {
  kinetic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M18 6l-2 2M6 18l2-2"/></svg>`,
  edged: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l10-10"/><path d="M14 10l5-6 1 1-5 6z"/><path d="M4.5 17.5l2 2"/></svg>`,
  energy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M13 2L5 13h5l-1 9 9-12h-5z"/></svg>`,
  fire: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c3 4 4.5 6 4.5 9a4.5 4.5 0 0 1-9 0c0-1.6.6-2.9 1.7-3.9.1 1 .8 1.9 1.8 2.2-.7-2.3-.4-4.7 1-7.3z"/></svg>`,
  radiation: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><circle cx="12" cy="12" r="2.1"/><path d="M12 9.6 16.4 4 7.6 4Z"/><path d="M13.5 12.8 18.4 15.8 15.4 20.5Z"/><path d="M10.5 12.8 8.6 20.5 5.6 15.8Z"/></svg>`,
};

// Insulation is a fractional °C offset (a t-shirt is 0.5), so rounding it to whole
// degrees turned three light layers into "2°" and a scarf into nothing at all.
const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

function gearWeight(g) {
  g = Number(g) || 0;
  return g < 1000 ? `${Math.round(g)}g` : `${(Math.round(g / 100) / 10)}kg`;
}

// Layer name → stored integer, so an item's single allowed `layer` tag can be
// compared against the layer the doll is currently showing (a body-slot drop only
// takes when the piece's layer matches the chosen one). Mirrors the engine's LAYERS.
const GEAR_LAYER_N = { underwear: 1, outerwear: 2, armor: 3 };
const GEAR_VERB_LABELS = { eat: 'Eat', drink: 'Drink', use: 'Use', open: 'Open', read: 'Read' };
// The verb an item most wants, in priority order. Equip/unequip/drop are excluded
// deliberately — the doll and the Drop button already teach those; this is for the
// verbs a player would otherwise have to guess at (a holocaster is for USING).
const GEAR_PRIMARY_VERBS = ['use', 'read', 'eat', 'drink', 'smoke', 'open', 'play', 'light'];
function primaryVerb(it) {
  const acts = it?.actions || [];
  return GEAR_PRIMARY_VERBS.find(v => acts.includes(v)) || null;
}
// What you DO with a piece, named off its slot. "Equip" is engine vocabulary; a
// player wears a coat, wields a bat and puts on a ring, and the tooltip on a
// one-tap control is the only place the game gets to say which.
function wearVerb(it) {
  const slot = it?.tags?.slot;
  if (slot === 'weapon_hand') return 'Wield';
  if (slot === 'accessory') return 'Put on';
  return 'Wear';
}
function takeOffVerb(it) {
  return it?.tags?.slot === 'weapon_hand' ? 'Put away' : 'Take off';
}

const GEAR_TRAY_PAGE = 6;   // loadout carried-tray page size
const GEAR_INV_PAGE = 8;    // Inventory-tab page size
const gcap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// The silhouette — the stored femsil PNG (client/game/assets/femsil.png),
// baked once into a transparent-background alpha mask (femsil-mask.png via
// scripts/build-femsil-mask.mjs) and tinted to the live accent colour by CSS: body →
// accent, background → transparent. A single figure (per-part coverage lighting isn't possible from one
// flat image — the slot boxes carry which piece sits where), anchored so the
// .tos-gslot--<slot> boxes land over its head/torso/hands/legs/feet.
function gearDoll() {
  return `<div class="tos-doll-fig" role="img" aria-label="Body silhouette"></div>`;
}

// A ◂ n/m ▸ pager, client-side. `kind` ('tray'|'inv') tells wireGear which page
// counter to step. Renders nothing when a single page holds everything.
function gearPager(kind, page, pages) {
  if (pages <= 1) return '';
  return `<div class="tos-gpager" data-gpager="${kind}">
    <button class="tos-gpg" data-gpg="prev"${page <= 0 ? ' disabled' : ''}>◂</button>
    <span>${page + 1} / ${pages}</span>
    <button class="tos-gpg" data-gpg="next"${page >= pages - 1 ? ' disabled' : ''}>▸</button></div>`;
}

// A draggable carried-item card for the Gear tab's tray. Equippable cards drag onto
// their body slot (or tap) to equip.
//
// No ⤓ here any more. The Gear tab is the KIT-BUILDING screen — its whole job is
// getting things onto the body — and a drop-on-the-ground button one thumb-width from
// the equip target is a way to lose a jacket, not a feature. Dropping lives on the
// Inventory tab, next to everything else you can do to a thing you're carrying.
function gearCard(it) {
  const slot = it.tags?.slot || '';
  const qty = it.quantity > 1 ? ` ×${it.quantity}` : '';
  const meta = slot ? esc(slot.replace('_', ' ')) : (it.tags?.container != null ? 'container' : '');
  return `<div class="tos-gcard${slot ? ' equippable' : ''}" data-gid="${it.id}" data-gslot="${slot}">` +
    `<span class="tos-gcard-name">${esc(it.name)}${qty}</span>` +
    (meta ? `<span class="tos-gcard-meta">${meta}</span>` : '') + `</div>`;
}

// The KIT app is two tabs: Inventory (the full paged pack, the primary tab, mirroring
// the game's inventory — tap a row for the detail sheet with its actions) and Gear (the
// paperdoll + carried tray). The tab KEY is still `loadout` — it's persisted in
// `_gearTab` and referenced by wireGear's `data-gtab` handler; only the label changed.
function renderGear(d) {
  const tabs =
    `<div class="tos-gtabs">
       <button class="tos-gtab${_gearTab === 'inventory' ? ' active' : ''}" data-gtab="inventory">Inventory</button>
       <button class="tos-gtab${_gearTab === 'loadout' ? ' active' : ''}" data-gtab="loadout">Gear</button>
     </div>`;
  return `<div class="tos-gear">${tabs}${_gearTab === 'inventory' ? renderGearInventory(d) : renderGearLoadout(d)}</div>`;
}

function renderGearLoadout(d) {
  const items = d.items || [];
  const equipped = items.filter(i => i.is_equipped);
  const layerN = GEAR_LAYER_DEFS[_gearLayer].n;
  // A garment occupies its own slot plus every slot in its `covers` tag (a jumpsuit
  // worn on the torso also fills the legs), so one piece reads as worn on both body
  // parts on the doll and in the per-region soak.
  const occupies = (i, slot) => i.slot === slot || (Array.isArray(i.tags?.covers) && i.tags.covers.includes(slot));
  const bodyItem = (slot) => equipped.find(i => occupies(i, slot) && (i.layer || 1) === layerN);
  // Body-slot pieces worn on a layer OTHER than the one on show — hidden from the
  // doll right now. An empty box whose slot has such gear becomes a "reveal" control
  // (tap → jump the doll to that layer) so every layer's piece stays reachable, and
  // thus unequippable, without hunting the stepper. Outermost hidden layer first.
  const hiddenPieces = (slot) => GEAR_ARMOR_SLOTS.includes(slot)
    ? equipped.filter(i => occupies(i, slot) && (i.layer || 1) !== layerN).sort((a, b) => (b.layer || 1) - (a.layer || 1))
    : [];

  // Each box is absolutely positioned (via .tos-gslot--<slot> in CSS) over the body
  // part it protects. It shows the piece on the selected layer; if that layer is
  // empty but the slot has gear on ANOTHER layer, it falls back to the outermost worn
  // piece so an equipped item ALWAYS reads as a filled panel on the body. Either way a
  // filled box is a drop target (equip) AND a drag/tap-to-unequip source (data-geq),
  // so any layer's piece can be taken off straight into the carried list.
  const box = (slot, it) => {
    // Whether what's in this box belongs to the layer you're looking at. A fallback
    // piece from another layer is drawn DIMMED (.off-layer) — without that the doll
    // read as if every box were on the selected layer, so switching Under/Over/Armor
    // appeared to do nothing and you couldn't tell what you were actually looking at.
    // The dimming is the WHOLE signal: this used to also stamp the layer name and a
    // "+N" hidden count in 8px under the item, which read as a stat on a box that is
    // otherwise all stats. Still a live unequip target, just visibly not-here.
    let offLayer = false;
    if (!it) {
      const hidden = hiddenPieces(slot);
      if (hidden.length) {
        it = hidden[0];
        offLayer = true;
      }
    }
    return `<div class="tos-gslot tos-gslot--${slot}${it ? ' filled' : ''}${offLayer ? ' off-layer' : ''}" data-gslot="${slot}"` +
      `${it ? ` data-geq="${it.id}"` : ''}>` +
      `<span class="tos-gslot-label">${esc(GEAR_SLOT_LABEL[slot] || slot)}</span>` +
      `<span class="tos-gslot-item">${it ? esc(it.name) : '—'}</span></div>`;
  };

  const acc = equipped.filter(i => i.slot === 'accessory').sort((a, b) => (a.layer || 0) - (b.layer || 0))[0];
  const doll =
    `<div class="tos-doll${d.sex === 'female' ? '' : ' male'}">${gearDoll()}` +
      box('head', bodyItem('head')) +
      box('accessory', acc) +
      box('hands', bodyItem('hands')) +
      box('torso', bodyItem('torso')) +
      box('weapon_hand', equipped.find(i => i.slot === 'weapon_hand')) +
      box('legs', bodyItem('legs')) +
      box('feet', bodyItem('feet')) +
    `</div>`;

  // Layer selector (Under/Over/Armor) + carry weight — live in the top-right cluster
  // (with the armor/insulation readouts) so the doll gets the whole middle.
  const layers = GEAR_LAYER_DEFS.map((l, i) =>
    `<button class="tos-gl${i === _gearLayer ? ' active' : ''}" data-glayer="${i}">${l.label}</button>`).join('');
  const wPct = d.capacity ? Math.min(100, Math.round((d.weight / d.capacity) * 100)) : 0;
  const carry =
    `<div class="tos-gear-carry" title="Carried weight">
       <div class="tos-gear-bar"><span style="width:${wPct}%"></span></div>
       <span class="tos-gear-carry-txt">${gearWeight(d.weight)} / ${gearWeight(d.capacity)}</span>
     </div>`;

  // Per-region soak — READ, not derived. `d.soak` is the server's `player.soak`,
  // the same structure combat routes a hit through, so what this table says is what
  // a swing actually meets. Summing `tags.armor_soak` here instead (which is what
  // this did) silently missed a `covers` garment's extra slots and every armor
  // contributor that isn't a worn item at all, e.g. subdermal plating.
  const slotSoak = (slot) => d.soak?.[slot]?.soak || {};
  let soak = `<table class="tos-gear-soak"><thead><tr><th></th>${GEAR_DMG.map(t => `<th>${esc(gcap(t).slice(0, 3))}</th>`).join('')}</tr></thead><tbody>`;
  for (const slot of GEAR_ARMOR_SLOTS) {
    const t = slotSoak(slot);
    soak += `<tr><td>${esc(GEAR_SLOT_LABEL[slot])}</td>${GEAR_DMG.map(dt => `<td class="${t[dt] ? 'has' : ''}">${t[dt] || 0}</td>`).join('')}</tr>`;
  }
  soak += '</tbody></table>';

  // Passive effects.
  const fx = d.effects || {};
  const parts = [];
  for (const [k, v] of Object.entries(fx.stat_bonus || {})) parts.push(`${k.replace('stat_', '')} ${v > 0 ? '+' : ''}${v}`);
  if (fx.insulation) parts.push(`insulation ${fx.insulation}°C`);
  if (fx.sealed) parts.push('sealed airway');
  if (fx.exposurePenalty) parts.push(`exposure ${fx.exposurePenalty}`);
  const fxHtml = parts.length
    ? `<div class="tos-gear-fx">${parts.map(p => `<span>${esc(p)}</span>`).join('')}</div>`
    : '<div class="tos-gear-fx empty">No passive effects.</div>';

  // Top-right cluster: layer selector, carry weight, then the cumulative-soak (shield)
  // + insulation (thermometer) readouts. All monochrome; icons stroke in the accent.
  // Same source as the table: every slot's typed soak, added up. A hit only ever
  // meets ONE slot's share of this, which is what the title says and what the
  // breakdown popup shows per damage type.
  const totalSoak = GEAR_ARMOR_SLOTS.reduce((s, slot) =>
    s + Object.values(slotSoak(slot)).reduce((a, v) => a + (Number(v) || 0), 0), 0);
  const far =
    `<div class="tos-gload-far">
       <div class="tos-gl-group">${layers}</div>
       ${carry}
       <div class="tos-gstat tos-gstat-armor" data-armor-break title="Soak across all five body slots. A hit only meets its own slot's share — click for the per-type breakdown, and see the Protection table for where you're bare.">${GEAR_SHIELD_SVG}<span>${totalSoak}</span></div>
       <div class="tos-gstat" title="Insulation from what you're wearing: +${round1(fx.insulation || 0)}°C of effective ambient, dry. This is NOT your body temperature — that's in Vitals — and soaked clothing keeps far less of it.">${GEAR_THERMO_SVG}<span>+${round1(fx.insulation || 0)}° insul</span></div>
     </div>`;

  // Carried-item tray, paged. Only equippable pieces (a `slot` tag) — this is the
  // kit-building drag source, so loose non-gear (food, etc.) stays out (it's still on
  // the Inventory tab). Drag a card onto a slot to equip, a filled slot onto this tray
  // to unequip, or a card onto the zone below to leave it on the ground.
  //
  // The per-card ⤓ BUTTON is what moved to the Inventory tab — a one-tap discard
  // sitting a thumb-width from the equip target is how you lose a jacket. The drag
  // ZONE stays: it takes a deliberate press-and-drag across the panel, it's the only
  // way to get a piece out of a full tray without leaving the screen, and it costs the
  // tray nothing (it sits under the pager, so no card is any narrower for it).
  const tray = (d.inventory || []).filter(i => !i.is_equipped && i.tags?.slot);
  const pages = Math.max(1, Math.ceil(tray.length / GEAR_TRAY_PAGE));
  _gearTrayPage = Math.min(Math.max(0, _gearTrayPage), pages - 1);
  const slice = tray.slice(_gearTrayPage * GEAR_TRAY_PAGE, _gearTrayPage * GEAR_TRAY_PAGE + GEAR_TRAY_PAGE);
  const trayHtml =
    `<div class="tos-gtray">${slice.length ? slice.map(gearCard).join('') : '<div class="tos-gtray-empty">Nothing loose in your pack.</div>'}</div>
     ${gearPager('tray', _gearTrayPage, pages)}
     <div class="tos-gear-drop" data-gdropzone title="Drag an item here to leave it on the ground">⤓ Drop to ground</div>`;

  // Inventory list left, big centred doll in the middle, controls/readouts top-right.
  // The whole left column is the unequip drop-zone. A feedback line sits below the
  // doll's feet (equip errors show there). Soak/effects full-width below.
  return `
    <div class="tos-gload">
      <div class="tos-gload-side" data-gtray-zone>${trayHtml}</div>
      <div class="tos-gload-doll">${doll}<div class="tos-gload-fb" id="tos-gear-fb"></div></div>
      ${far}
    </div>
    <div class="tos-gear-stats"><div class="tos-gear-sec">Protection</div>${soak}
      <div class="tos-gear-sec">Effects</div>${fxHtml}</div>`;
}

// The Inventory tab: the whole pack (worn pieces included), paged, mirroring the
// game's inventory. A tap opens the item-detail sheet with the piece's actions.
function renderGearInventory(d) {
  const all = d.inventory || [];
  // Worn body-slot gear folds into two collapsed-by-default groups so the pack
  // list isn't buried: Clothing (underwear/outerwear) and Armour (the `armor`
  // layer). Weapons, accessories, and loose gear stay in the main paged list.
  // Armour means PROTECTIVE, not "worn on the armor layer". Grouping by layer put a
  // kevlar raincoat, a padded jacket and steel-toe boots under Clothing and left the
  // Armour group missing entirely, so a player wearing real protection was told they
  // had none. Layer still decides where a piece sits on the doll; here what matters is
  // whether it stops anything. `armor_soak` is the only armor mechanism (see
  // docs/items.md), so it's the only honest test.
  const hasSoak = (it) => Object.values(it.tags?.armor_soak || {}).some(v => (Number(v) || 0) > 0);
  // Armour is a BODY-slot piece that stops something. Accessories are excluded on
  // purpose even when they carry soak (the cobalt scarf does): a scarf is something you
  // wear, not armour you kit up in, and putting it under Armour makes that group a lie
  // about how protected you are.
  const isArmor = (it) => GEAR_ARMOR_SLOTS.includes(it.tags?.slot) && hasSoak(it);
  // ...and accessories group WITH clothing. They were falling through to the main paged
  // list, which is the loose-kit list — a ring sitting between a ration and a crowbar.
  // Everything you wear belongs in the two worn groups; the main list is for everything
  // else you're carrying.
  const isClothing = (it) => WORN_GROUP_SLOTS.includes(it.tags?.slot) && !isArmor(it);
  const clothing = all.filter(isClothing);
  const armor = all.filter(isArmor);
  const main = all.filter(it => !isClothing(it) && !isArmor(it));
  // What you're actually holding, PINNED above the paged list and outside the paging.
  // A wielded weapon used to be an ordinary row wearing the same small "equipped" badge
  // as a sock, eight rows to a page — so the one question this screen gets asked in a
  // fight ("what am I swinging?") needed a page-hunt to answer. Now it's the first thing
  // on the tab, it can never be paged away, and it says WIELDED rather than equipped.
  const isWeapon = (it) => it.tags?.slot === 'weapon_hand';
  const wielded = main.filter(it => it.is_equipped && isWeapon(it));
  const loose = main.filter(it => !(it.is_equipped && isWeapon(it)));
  const pages = Math.max(1, Math.ceil(loose.length / GEAR_INV_PAGE));
  _gearInvPage = Math.min(Math.max(0, _gearInvPage), pages - 1);
  const slice = loose.slice(_gearInvPage * GEAR_INV_PAGE, _gearInvPage * GEAR_INV_PAGE + GEAR_INV_PAGE);
  const wPct = d.capacity ? Math.min(100, Math.round((d.weight / d.capacity) * 100)) : 0;
  const head =
    `<div class="tos-gear-head">
       <div class="tos-ginv-title">Inventory</div>
       <div class="tos-gear-carry" title="Carried weight">
         <div class="tos-gear-bar"><span style="width:${wPct}%"></span></div>
         <span class="tos-gear-carry-txt">${gearWeight(d.weight)} / ${gearWeight(d.capacity)}</span>
       </div>
     </div>`;
  const row = (it) => {
    const qty = it.quantity > 1 ? ` ×${it.quantity}` : '';
    const slot = it.tags?.slot || '';
    // A held weapon says WIELDED, not "equipped" — it's the one piece of kit whose state
    // you need to read at a glance, and "equipped" is what the socks say too.
    const badge = it.is_equipped
      ? (isWeapon(it) ? '<span class="tos-ginv-eq wielding">⚔ wielded</span>' : '<span class="tos-ginv-eq">equipped</span>')
      : (slot ? `<span class="tos-ginv-slot">${esc(slot.replace('_', ' '))}</span>` : '');
    const pv = primaryVerb(it);
    const verbChip = pv
      ? `<span class="tos-ginv-verb" data-ginv-verb="${esc(pv)}" title="${esc(GEAR_VERB_LABELS[pv] || gcap(pv))} ${esc(it.name)}">${esc(GEAR_VERB_LABELS[pv] || gcap(pv))}</span>`
      : '';
    // Weight on the row, not two taps down in the detail sheet. Carry capacity is a
    // live constraint — the whole reason you open this list is to decide what to leave
    // behind — and you can't make that call against a bar that only shows the total.
    // ×quantity, because a row is what it actually costs you: 5 rations weigh 5.
    const w = Number(it.weight) || 0;
    const wt = w ? `<span class="tos-ginv-wt" title="${esc(gearWeight(w))} each">${esc(gearWeight(w * (it.quantity || 1)))}</span>` : '';
    // ⤓ moved here off the Gear tab (see gearCard). Equipped pieces don't get one —
    // dropping what you're wearing is a two-step on purpose.
    const drop = it.is_equipped ? ''
      : `<button class="tos-ginv-drop" data-gdrop="${it.id}" title="Drop ${esc(it.name)} on the ground">⤓</button>`;
    // ⇧ / ⇩ — put it on, take it off, from the list. Anything with a `slot` tag is
    // wearable or wieldable, and the whole point of the Inventory tab is that it's the
    // list you're already looking at: making the player cross to the Gear tab and drag
    // a doll to put a hat on is a chore, not a decision. The verb NAMES itself off the
    // slot (wield a weapon, wear everything else) rather than saying "equip", because
    // nobody equips a jacket. Same one-round-trip action the doll uses, so the
    // paperdoll, the tray and this list can't disagree about what's worn.
    const body = it.tags?.slot
      ? (it.is_equipped
        ? `<button class="tos-ginv-eqbtn off" data-gunequip="${it.id}" title="${esc(takeOffVerb(it))} ${esc(it.name)}">⇩</button>`
        : `<button class="tos-ginv-eqbtn" data-gequip="${it.id}" title="${esc(wearVerb(it))} ${esc(it.name)}">⇧</button>`)
      : '';
    const held = it.is_equipped && isWeapon(it) ? ' wielding' : '';
    return `<div class="tos-ginv-row${held}" data-ginv="${it.id}">
      <span class="tos-ginv-name">${esc(it.name)}${qty}</span>${badge}${wt}${verbChip}${body}${drop}
      <span class="tos-ginv-chev">›</span></div>`;
  };
  // The pinned in-hand block. Labelled, because an unlabelled pinned row just looks like
  // the list is badly sorted. Absent entirely when your hands are empty — a "Nothing
  // wielded" placeholder would cost a line on every screen to say nothing.
  const inHand = wielded.length
    ? `<div class="tos-ginv-hand"><div class="tos-ginv-handlab">In hand</div>${wielded.map(row).join('')}</div>`
    : '';
  const list = loose.length
    ? `<div class="tos-ginv-list">${slice.map(row).join('')}</div>`
    : ((clothing.length || armor.length || wielded.length) ? '' : '<div class="tos-gtray-empty">Your pack is empty.</div>');
  // A collapsible group: header with count + expanded row list. `key` is the
  // data attribute the click handler toggles.
  const group = (items, label, key, open) => items.length
    ? `<div class="tos-ginv-grouphead${open ? ' open' : ''}" data-${key}>
         <span class="tos-ginv-chev">${open ? '⌄' : '›'}</span>
         <span class="tos-ginv-groupname">${label}</span>
         <span class="tos-ginv-groupcount">${items.length}</span>
       </div>
       ${open ? `<div class="tos-ginv-list">${items.map(row).join('')}</div>` : ''}`
    : '';
  const groups = group(clothing, 'Clothing', 'gclothing', _gearClothingOpen)
    + group(armor, 'Armour', 'garmor', _gearArmorOpen);
  return `${head}${inHand}${list}${gearPager('inv', _gearInvPage, pages)}${groups}`;
}

// A tablet-native item-detail sheet — the tap target from the Inventory tab. Shows
// the piece's stats and its verb buttons (equip/unequip, consumable actions, drop),
// mirroring the desktop inventory's detail modal.
function showGearItemDetail(it) {
  closeGearItemDetail();
  const t = it.tags || {};
  const rows = [];
  rows.push(['Weight', gearWeight(it.weight) + (it.quantity > 1 ? ' (each)' : '')]);
  if (it.sell_value != null) rows.push(['Sell value', `₵${it.sell_value}${it.quantity > 1 ? ' each' : ''}`]);
  if (t.slot) rows.push(['Slot', GEAR_SLOT_LABEL[t.slot] || t.slot.replace('_', ' ')]);
  if (t.layer && GEAR_ARMOR_SLOTS.includes(t.slot)) rows.push(['Layer', gcap(t.layer)]);
  if (t.armor_soak && typeof t.armor_soak === 'object') {
    const p = Object.entries(t.armor_soak).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${k} ${v}`);
    if (p.length) rows.push(['Soak', p.join(', ')]);
  }
  if (t.container != null) rows.push(['Capacity', gearWeight(t.container)]);
  if (t.stat_bonus && typeof t.stat_bonus === 'object') {
    const p = Object.entries(t.stat_bonus).map(([k, v]) => `${k.replace('stat_', '')} ${v > 0 ? '+' : ''}${v}`);
    if (p.length) rows.push(['Bonus', p.join(', ')]);
  }
  if (t.requires && typeof t.requires === 'object') {
    const p = Object.entries(t.requires).map(([k, v]) => `${k.replace('stat_', '')} ${v}`);
    if (p.length) rows.push(['Requires', p.join(', ')]);
  }

  const verbs = [];
  const pv = primaryVerb(it);
  if (t.slot && !it.is_equipped) verbs.push({ label: 'Equip', kind: 'equip' });
  if (t.slot && it.is_equipped) verbs.push({ label: 'Unequip', kind: 'unequip' });
  for (const v of (it.actions || [])) {
    if (['drop', 'equip', 'unequip', 'wear', 'wield'].includes(v)) continue;
    verbs.push({ label: GEAR_VERB_LABELS[v] || gcap(v), kind: 'verb', verb: v, primary: v === pv });
  }
  verbs.push({ label: 'Drop', kind: 'drop' });

  const el = document.createElement('div');
  el.className = 'tos-idp-overlay';
  el.innerHTML = `<div class="tos-idp">
    <div class="tos-idp-head"><span class="tos-idp-name">${esc(it.name)}${it.quantity > 1 ? ` <span class="tos-idp-qty">×${it.quantity}</span>` : ''}</span>
      <button class="tos-idp-x" title="Close">✕</button></div>
    ${t.description ? `<div class="tos-idp-desc">${esc(t.description)}</div>` : ''}
    <div class="tos-idp-stats">${rows.map(([k, v]) => `<div class="tos-idp-stat"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div>
    <div class="tos-idp-verbs">${verbs.map((v, i) => `<button class="tos-idp-verb${v.kind === 'drop' ? ' danger' : ''}${v.primary ? ' primary' : ''}" data-vi="${i}">${esc(v.label)}</button>`).join('')}</div>
  </div>`;
  el.addEventListener('click', (e) => { if (e.target === el) closeGearItemDetail(); });
  el.querySelector('.tos-idp-x').addEventListener('click', closeGearItemDetail);
  el.querySelectorAll('.tos-idp-verb').forEach(b => {
    b.addEventListener('click', () => {
      const v = verbs[+b.getAttribute('data-vi')];
      closeGearItemDetail();
      if (v.kind === 'equip') gearEquipShowLayer(it.id);
      else if (v.kind === 'unequip') gearAct('unequip', it.id);
      else if (v.kind === 'drop') gearDrop(it);
      else gearVerb(v.verb, it.name);
    });
  });
  _overlay.appendChild(el);
  _gearIdp = el;
}

function closeGearItemDetail() { _gearIdp?.remove(); _gearIdp = null; }

// ── Hover tooltip (fast kit-building) ────────────────────────────────────────
// A monochrome quick-stats card shown on hover over a tray item or a worn slot:
// armor → per-type soak (0s excluded) + insulation; weapon → damage
// range + type. Only equippable items (a `slot` tag) get one.
function gearTipHtml(it, hint) {
  const t = it.tags || {};
  const rows = [];
  const isWeapon = !!t.weapon || t.slot === 'weapon_hand' || (t.damage && (t.damage.min != null || t.damage.max != null));
  if (isWeapon) {
    const d = t.damage || {};
    if (d.min != null || d.max != null) rows.push(`<div class="tos-gtip-row"><span>Damage</span><span>${d.min ?? '?'}–${d.max ?? '?'}</span></div>`);
    const dt = t.damage_type || 'kinetic';
    rows.push(`<div class="tos-gtip-row"><span>Type</span><span class="tos-gtip-type">${GEAR_DMG_ICON[dt] || ''}${esc(gcap(dt))}</span></div>`);
    if (t.weapon_skill) rows.push(`<div class="tos-gtip-row"><span>Skill</span><span>${esc(gcap(t.weapon_skill))}</span></div>`);
  } else {
    const soak = t.armor_soak || {};
    const soakRows = GEAR_DMG.filter(k => Number(soak[k]) > 0)
      .map(k => `<div class="tos-gtip-soak"><span class="tos-gtip-ico">${GEAR_DMG_ICON[k] || ''}</span><span>${esc(gcap(k))}</span><span class="tos-gtip-val">${soak[k]}</span></div>`);
    if (soakRows.length) rows.push(`<div class="tos-gtip-sec">Soak</div>${soakRows.join('')}`);
    if (t.insulation) rows.push(`<div class="tos-gtip-row"><span>Insulation</span><span>${t.insulation}°</span></div>`);
    if (t.sealed) rows.push(`<div class="tos-gtip-row"><span>Sealed airway</span><span>✓</span></div>`);
    if (!rows.length) rows.push(`<div class="tos-gtip-row tos-gtip-dim"><span>No protection</span></div>`);
  }
  if (t.stat_bonus && typeof t.stat_bonus === 'object') {
    const p = Object.entries(t.stat_bonus).map(([k, v]) => `${k.replace('stat_', '')} ${v > 0 ? '+' : ''}${v}`);
    if (p.length) rows.push(`<div class="tos-gtip-row"><span>Bonus</span><span>${esc(p.join(', '))}</span></div>`);
  }
  if (it.weight != null) rows.push(`<div class="tos-gtip-row"><span>Weight</span><span>${gearWeight(it.weight)}</span></div>`);
  const slotLbl = t.slot
    ? `<div class="tos-gtip-slot">${esc(GEAR_SLOT_LABEL[t.slot] || t.slot)}${t.layer && GEAR_ARMOR_SLOTS.includes(t.slot) ? ` · ${esc(gcap(t.layer))}` : ''}</div>`
    : '';
  return `<div class="tos-gtip-name">${esc(it.name)}</div>${slotLbl}${rows.join('')}${hint ? `<div class="tos-gtip-hint">${esc(hint)}</div>` : ''}`;
}

function ensureGearTip() {
  if (_gearTipEl && _gearTipEl.isConnected) return _gearTipEl;
  const el = document.createElement('div');
  el.className = 'tos-gtip';
  el.style.display = 'none';
  _overlay.appendChild(el);
  _gearTipEl = el;
  return el;
}

function showGearTip(anchor, it, hint) {
  if (!it?.tags?.slot) return; // only equippable pieces get the stats card
  const el = ensureGearTip();
  el.innerHTML = gearTipHtml(it, hint);
  el.style.display = 'block';
  const r = anchor.getBoundingClientRect();
  const tw = el.offsetWidth, th = el.offsetHeight;
  let left = r.right + 10;
  if (left + tw > globalThis.innerWidth - 8) left = r.left - tw - 10; // flip to the left
  left = Math.max(8, Math.min(left, globalThis.innerWidth - tw - 8));
  let top = r.top + r.height / 2 - th / 2;
  top = Math.max(8, Math.min(top, globalThis.innerHeight - th - 8));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function hideGearTip() { if (_gearTipEl) _gearTipEl.style.display = 'none'; }

// Transient feedback line under the doll's feet (accent) — e.g. an equip that
// landed on the wrong body part. Written directly (no re-render), auto-clears.
function gearFeedback(msg) {
  const el = _overlay?.querySelector('#tos-gear-fb');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  if (_gearFbTimer) clearTimeout(_gearFbTimer);
  _gearFbTimer = setTimeout(() => { el.classList.remove('show'); }, 2600);
}

// The soak readout's click-through: total soak per damage type across all worn
// gear, each with its icon (monochrome). Shows every type so gaps read as clearly
// as coverage.
function showArmorBreakdown() {
  closeGearItemDetail();
  // Read from the server's per-slot soak (see slotSoak in renderGearLoadout) rather
  // than re-summing item tags, so a `covers` garment and a soak-granting augment both
  // show up here. Per type: the total, and the WEAKEST slot — the number that decides
  // whether a hit hurts, since a hit lands somewhere specific.
  const bySlot = _data?.soak || {};
  const soak = {}; const worst = {};
  for (const k of GEAR_DMG) {
    soak[k] = 0;
    worst[k] = Infinity;
    for (const slot of GEAR_ARMOR_SLOTS) {
      const v = Number(bySlot[slot]?.soak?.[k]) || 0;
      soak[k] += v;
      worst[k] = Math.min(worst[k], v);
    }
  }
  const rows = GEAR_DMG.map(k =>
    `<div class="tos-gbrk-row${soak[k] ? '' : ' zero'}"><span class="tos-gbrk-ico">${GEAR_DMG_ICON[k]}</span><span class="tos-gbrk-name">${esc(gcap(k))}</span>` +
    `<span class="tos-gbrk-val" title="Total across the five body slots; weakest slot stops ${worst[k] === Infinity ? 0 : worst[k]}">${soak[k]}` +
    `<i class="tos-gbrk-worst">min ${worst[k] === Infinity ? 0 : worst[k]}</i></span></div>`).join('');
  const el = document.createElement('div');
  el.className = 'tos-idp-overlay';
  el.innerHTML = `<div class="tos-idp tos-gbrk">
    <div class="tos-idp-head"><span class="tos-idp-name">Protection</span><button class="tos-idp-x" title="Close">✕</button></div>
    <div class="tos-gbrk-list">${rows}</div></div>`;
  el.addEventListener('click', (e) => { if (e.target === el) closeGearItemDetail(); });
  el.querySelector('.tos-idp-x').addEventListener('click', closeGearItemDetail);
  _overlay.appendChild(el);
  _gearIdp = el;
}

// Layer/tab/page changes are client-side — re-render the gear root without a round trip.
function rebuildGear() {
  hideGearTip();
  const root = _overlay?.querySelector('#tos-gear-root');
  if (root && _data) { root.innerHTML = renderGear(_data); wireGear(); }
}

function gearTrayItem(id) {
  return (_data?.inventory || []).find(i => i.id == id);
}

// Every mutating gear action goes through the tablet action pipeline (one round
// trip: mutate + return the refreshed screen), preserving scroll so the tray
// doesn't jump on equip/drop.
function gearAct(actionId, params) {
  _keepGearScroll = true;
  act('gear', actionId, String(params));
}

// Equip a piece and, when it's a body-slot item, switch the doll to that piece's
// layer so the newly-worn item is the one shown.
function gearEquipShowLayer(id) {
  const it = gearTrayItem(id);
  const slot = it?.tags?.slot;
  if (it && GEAR_ARMOR_SLOTS.includes(slot)) {
    const n = GEAR_LAYER_N[it.tags?.layer] || GEAR_LAYER_N.outerwear;
    const idx = GEAR_LAYER_DEFS.findIndex(l => l.n === n);
    if (idx >= 0) _gearLayer = idx;
  }
  gearAct('equip', id);
}

// A consumable/readable verb (eat/drink/use/read/open) — run the real game command
// by name, then silently re-open the Gear app so its tray reflects the change.
function gearVerb(verb, name) {
  _keepGearScroll = true;
  sendCmdSilent(`${verb} ${name}`);
  sendCmdSilent('tabletnav gear');
}

// Drop-off. Stacks prompt for a quantity (mirrors the desktop drop dialog).
function gearDrop(item) {
  if (!item) return;
  if (item.quantity > 1) {
    showPromptDialog({ title: 'Drop Item', prompt: `Drop how many of ${item.name}? (1–${item.quantity})`, confirmLabel: 'Drop' }, (val) => {
      const qty = Math.min(Math.max(1, parseInt(val, 10) || 1), item.quantity);
      gearAct('drop', `${item.id} ${qty}`);
    });
  } else {
    gearAct('drop', item.id);
  }
}

function wireGear() {
  if (!_overlay || _data?.view !== 'gear') return;

  // Tabs (client-side, no round trip).
  _overlay.querySelectorAll('[data-gtab]').forEach(el => {
    el.addEventListener('click', () => {
      const t = el.getAttribute('data-gtab');
      if (t === _gearTab) return;
      _gearTab = t; sfx(TOS_SELECT_DEF); rebuildGear();
    });
  });

  // Pagers (client-side).
  _overlay.querySelectorAll('.tos-gpager').forEach(pg => {
    const kind = pg.getAttribute('data-gpager');
    pg.querySelectorAll('[data-gpg]').forEach(b => {
      b.addEventListener('click', () => {
        if (b.disabled) return;
        const dir = b.getAttribute('data-gpg') === 'next' ? 1 : -1;
        if (kind === 'inv') _gearInvPage += dir; else _gearTrayPage += dir;
        sfx(TOS_SELECT_DEF); rebuildGear();
      });
    });
  });

  // Inventory-tab rows → item-detail sheet. The shimmering verb chip on the row
  // short-circuits that: one tap fires the verb, no sheet, no guessing.
  _overlay.querySelectorAll('[data-ginv]').forEach(el => {
    el.addEventListener('click', (e) => {
      const it = gearTrayItem(el.getAttribute('data-ginv'));
      if (!it) return;
      const chip = e.target.closest?.('[data-ginv-verb]');
      if (chip) { e.stopPropagation(); hideGearTip(); gearVerb(chip.getAttribute('data-ginv-verb'), it.name); return; }
      showGearItemDetail(it);
    });
  });

  // Clothing / Armour group headers toggle their collapsed/expanded state (client-side).
  _overlay.querySelector('[data-gclothing]')?.addEventListener('click', () => {
    _gearClothingOpen = !_gearClothingOpen;
    sfx(TOS_SELECT_DEF); rebuildGear();
  });
  _overlay.querySelector('[data-garmor]')?.addEventListener('click', () => {
    _gearArmorOpen = !_gearArmorOpen;
    sfx(TOS_SELECT_DEF); rebuildGear();
  });

  // Hover quick-stats tooltip on tray items (data-gid) and worn slots (data-geq),
  // plus the Inventory-tab rows (data-ginv) — fast kit-building without opening.
  _overlay.querySelectorAll('.tos-gcard[data-gid], .tos-gslot[data-geq], [data-ginv]').forEach(el => {
    const id = el.getAttribute('data-gid') || el.getAttribute('data-geq') || el.getAttribute('data-ginv');
    const hint = el.hasAttribute('data-geq') ? 'Tap or drag to the list to unequip'
      : el.hasAttribute('data-gid') ? 'Tap or drag onto the doll to equip' : '';
    el.addEventListener('mouseenter', () => showGearTip(el, gearTrayItem(id), hint));
    el.addEventListener('mouseleave', hideGearTip);
    el.addEventListener('dragstart', hideGearTip);
  });

  // Armor readout → per-type protection breakdown.
  const armorStat = _overlay.querySelector('[data-armor-break]');
  if (armorStat) armorStat.addEventListener('click', showArmorBreakdown);

  // Layer selector (client-side, no round trip).
  _overlay.querySelectorAll('[data-glayer]').forEach(el => {
    el.addEventListener('click', () => {
      const i = +el.getAttribute('data-glayer');
      if (i === _gearLayer) return;
      _gearLayer = i; sfx(TOS_SELECT_DEF); rebuildGear();
    });
  });

  // Tap a filled slot box → unequip the piece shown there (any layer → into the list).
  _overlay.querySelectorAll('.tos-gslot[data-geq]').forEach(el => {
    el.addEventListener('click', () => gearAct('unequip', el.getAttribute('data-geq')));
  });

  // Tap an equippable tray card → equip it (touch-friendly path).
  _overlay.querySelectorAll('.tos-gcard.equippable').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-gdrop]')) return; // drop button handles itself
      gearEquipShowLayer(el.getAttribute('data-gid'));
    });
  });

  // Per-card ⤓ → drop on the ground.
  _overlay.querySelectorAll('[data-gdrop]').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); gearDrop(gearTrayItem(el.getAttribute('data-gdrop'))); });
  });

  // Inventory-row ⇧ / ⇩ → wear/wield it, or take it off. stopPropagation because the
  // row itself opens the item-detail sheet, and a quick-equip that also popped a modal
  // would make the fast path slower than the slow one. gearAct is the same
  // mutate-and-return-the-screen round trip the paperdoll uses, so the list, the tray
  // and the doll all redraw from one authoritative payload.
  _overlay.querySelectorAll('[data-gequip]').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); gearAct('equip', el.getAttribute('data-gequip')); });
  });
  _overlay.querySelectorAll('[data-gunequip]').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); gearAct('unequip', el.getAttribute('data-gunequip')); });
  });

  // ── Drag/drop (pointer-based) ──────────────────────────────────────────────
  // Native HTML5 drag-and-drop is swallowed inside this fixed + transformed CRT
  // overlay (dragstart/drop never fire reliably), so we hand-roll it with pointer
  // events, mirroring the home-screen tile rearrange. Drag a tray card onto its
  // body slot (or anywhere on the doll) to equip; drag a worn slot box onto the
  // list to unequip; drop a card on the ⤓ zone to leave it on the ground. A press
  // that never moves past LIFT falls through to the tap-to-equip/unequip clicks.
  const gload = _overlay.querySelector('.tos-gload');
  if (gload) {
    const LIFT = 6;   // px of travel before a press becomes a drag (below = a tap)
    let press = null; // { kind:'equip'|'unequip', id, slot, srcEl, x, y }
    let drag = null;  // { ghost, offX, offY } once the press lifts into a real drag

    const clearHi = () => _overlay.querySelectorAll('.tos-gslot-over, .tos-gtray-over, .tos-gear-drop-over')
      .forEach(el => el.classList.remove('tos-gslot-over', 'tos-gtray-over', 'tos-gear-drop-over'));

    // Highlight the drop target under the pointer (the ghost is pointer-events:none,
    // so elementFromPoint sees through it to the real target).
    const hover = (x, y) => {
      clearHi();
      const t = document.elementFromPoint(x, y);
      if (!t) return;
      if (press.kind === 'equip') {
        const slotEl = t.closest('.tos-gslot[data-gslot]');
        const zone = t.closest('[data-gdropzone]');
        if (slotEl && slotEl.getAttribute('data-gslot') === press.slot) slotEl.classList.add('tos-gslot-over');
        else if (zone) zone.classList.add('tos-gear-drop-over');
      } else {
        const z = t.closest('[data-gtray-zone]');
        if (z) z.classList.add('tos-gtray-over');
      }
    };

    const begin = () => {
      const r = press.srcEl.getBoundingClientRect();
      const ghost = press.srcEl.cloneNode(true);
      Object.assign(ghost.style, {
        position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px',
        height: r.height + 'px', margin: '0', pointerEvents: 'none', zIndex: '9300',
        opacity: '0.9', transform: 'scale(1.04)', boxShadow: '0 8px 22px rgba(0,0,0,.5)',
      });
      // Append inside the overlay, NOT document.body — the gear styles are scoped as
      // `#tablet-os-overlay .tos-gcard/.tos-gslot`, so a ghost outside that subtree loses
      // every rule and collapses to bare text. The overlay root has no transform, so the
      // ghost's position:fixed still maps to viewport clientX/Y. z-index 9300 keeps it above
      // the panel (9200) but under the item-detail modal (9400).
      _overlay.appendChild(ghost);
      press.srcEl.classList.add('dragging');
      drag = { ghost, offX: press.x - r.left, offY: press.y - r.top };
      sfx(TOS_SELECT_DEF);
    };

    const onMove = (e) => {
      if (!press) return;
      if (!drag && Math.hypot(e.clientX - press.x, e.clientY - press.y) > LIFT) begin();
      if (drag) {
        e.preventDefault();
        drag.ghost.style.left = (e.clientX - drag.offX) + 'px';
        drag.ghost.style.top = (e.clientY - drag.offY) + 'px';
        hover(e.clientX, e.clientY);
      }
    };

    const end = (e) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      const wasDrag = !!drag;
      if (drag) {
        drag.ghost.remove();
        press.srcEl.classList.remove('dragging');
        clearHi();
        const t = document.elementFromPoint(e.clientX, e.clientY);
        if (press.kind === 'equip') {
          const slotEl = t && t.closest('.tos-gslot[data-gslot]');
          if (slotEl || (t && t.closest('.tos-gload-doll'))) {
            // Each piece equips on its own inherent slot/layer; landing on the wrong
            // box still equips it correctly, with a note about where it actually went.
            if (slotEl && slotEl.getAttribute('data-gslot') !== press.slot) {
              const s = slotEl.getAttribute('data-gslot');
              const it = gearTrayItem(press.id);
              gearFeedback(`${it?.name || 'That'} goes on ${GEAR_SLOT_LABEL[press.slot] || press.slot}, not ${GEAR_SLOT_LABEL[s] || s}`);
            }
            gearEquipShowLayer(press.id);
          } else if (t && t.closest('[data-gdropzone]')) {
            gearDrop(gearTrayItem(press.id));
          }
          // Released off every target → no-op; the piece stays in the pack.
        } else if (t && t.closest('[data-gtray-zone]')) {
          gearAct('unequip', press.id);
        }
        // Unequip released off the list → no-op; the piece stays worn.
      }
      press = null; drag = null;
      // A completed drag can emit a trailing click on the source — swallow the next
      // one so tap-to-equip/unequip doesn't fire a duplicate action.
      if (wasDrag) {
        const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      }
    };

    gload.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      if (e.target.closest('[data-gdrop]')) return; // the per-card ⤓ button handles itself
      const card = e.target.closest('.tos-gcard[data-gid]');
      const slotBox = e.target.closest('.tos-gslot[data-geq]');
      if (card) press = { kind: 'equip', id: card.getAttribute('data-gid'), slot: card.getAttribute('data-gslot') || null, srcEl: card, x: e.clientX, y: e.clientY };
      else if (slotBox) press = { kind: 'unequip', id: slotBox.getAttribute('data-geq'), srcEl: slotBox, x: e.clientX, y: e.clientY };
      else return;
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    });
  }
}

// Sticky cams burn out 24h after planting — show the time left beside the battery.
function camExpiry(t) {
  if (t.expiresIn == null) return '';
  if (t.expiresIn <= 0) return ' · <span class="tos-cam-fullbar">BURNOUT</span>';
  return t.expiresIn < 60 ? ` · ⏻ ${t.expiresIn}m` : ` · ⏻ ${Math.floor(t.expiresIn / 60)}h`;
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
  const hasBuffer = Array.isArray(d.focusBuffer) && d.focusBuffer.length > 0;
  const focusPane = focus ? `<div class="tos-cam-focus">
      <div class="tos-cam-head"><span>${esc(focus.name)}</span><span class="tos-cam-kind">${focus.status === 'ok' ? '<span class="tos-cam-live">◉ LIVE</span> · ' : ''}${esc(focus.kind || '')}${focus.tier ? ` · T${esc(String(focus.tier))}` : ''}</span></div>
      ${renderCamFeed(focus)}
      <div class="tos-cam-foot"><span>${esc(focus.zone || '')} · ${esc(focus.ts || '')}</span><span>${esc(focus.battery || '')}${camExpiry(focus)}${focus.recording ? ' · <span class="tos-rec"><span class="tos-acc-dot">●</span>REC</span>' : ''}</span></div>
      ${focus.full ? '<div class="tos-cam-fullbar">⚠ BUFFER FULL — clip or clear to record again</div>' : ''}
      ${renderBufferLog(d.focusBuffer, focus.recording, focus.full)}
      ${renderActions(d.appId, [
        { id: 'record', label: focus.recording ? 'Stop Recording' : 'Record' },
        { id: 'clip', label: 'Clip → Reel', disabled: !hasBuffer },
        { id: 'clear', label: 'Clear', disabled: !hasBuffer, confirm: 'Discard this buffer without saving a reel?' },
        { id: 'destruct', label: 'Self-Destruct', confirm: 'Fry this device where it sits? It is destroyed, not recovered.' },
      ], focus.id)}
    </div>` : '';

  const grid = `<div class="tos-cam-grid">${tiles.map(t => `<div class="tos-cam${t.id === d.focusId ? ' sel' : ''}" data-nav-tile="${esc(t.id)}">
      <div class="tos-cam-head"><span>${esc(t.name)}</span><span class="tos-cam-kind">${esc(t.kind || '')}${t.tier ? ` · T${esc(String(t.tier))}` : ''}</span></div>
      ${renderCamFeed(t)}
      <div class="tos-cam-foot"><span>${esc(t.zone || '')}</span><span>${esc(t.battery || '')}${camExpiry(t)}${t.recording ?' · <span class="tos-rec"><span class="tos-acc-dot">●</span>REC</span>' : ''}</span></div>
    </div>`).join('')}</div>`;

  return `<div class="tos-surv">${header}${alerts}${focusPane}${grid}
    ${links ? `<div class="tos-surv-links">${links}</div>` : ''}</div>`;
}

// ── Microreel viewer ─────────────────────────────────────────────────────────
// The app's OWN inline playback of a saved recording — no separate replay-deck
// overlay. A CRT screen shows the current frame; a transcript below highlights
// the play head; speech vs. narration/emote lines colour apart by theme. Playback
// state is module-local (see _reel* vars); wireReel() drives it via direct DOM
// writes (like datachipreplay.js) so a full re-render isn't needed per frame.
const REEL_FRAME_MS = 850;   // playback pace
const REEL_FRAME_SECS = 5;   // capture cadence (server tick) → timecode

function reelTimecode(i) {
  const s = i * REEL_FRAME_SECS;
  const p = n => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}
function reelDate(sec) {
  if (!sec) return '--·--·--';
  const d = new Date(sec * 1000);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}·${p(d.getDate())}·${String(d.getFullYear()).slice(2)}  ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function renderReel(d) {
  const reel = d.reel || {};
  const frames = Array.isArray(reel.frames) ? reel.frames : [];
  const n = frames.length;
  const evidence = reel.crimeTags?.length
    ? `<div class="tos-reel-evi">⚠ EVIDENCE · ${esc(reel.crimeTags.join(' · ').toUpperCase())}</div>` : '';
  const transcript = n
    ? frames.map((f, i) => `<div class="tos-reel-line ${f.kind === 'say' ? 'say' : 'event'}" data-reel-i="${i}"><span class="tos-reel-tc">${reelTimecode(i)}</span> <span class="tos-buf-txt">${esc(f.text || '')}</span></div>`).join('')
    : '<div class="tos-reel-empty">NO FOOTAGE</div>';

  return `<div class="tos-reel" id="tos-reel">
    <div class="tos-reel-hdr">
      <span class="tos-reel-zone">${esc(reel.zone || 'UNKNOWN')}</span>
      <span class="tos-reel-date">${esc(reelDate(reel.capturedAt))}</span>
    </div>
    ${evidence}
    <div class="tos-reel-screen">
      <div class="tos-reel-frame" id="tos-reel-frame">${n ? '' : 'NO FOOTAGE'}</div>
      <div class="tos-reel-hud"><span id="tos-reel-mode">❚❚ PAUSE</span><span id="tos-reel-counter">000 / ${String(n).padStart(3, '0')}</span></div>
    </div>
    <div class="tos-reel-transport">
      <button class="tos-reel-btn" id="tos-reel-rew" title="Start">⏮</button>
      <button class="tos-reel-btn" id="tos-reel-prev" title="Previous">◀</button>
      <button class="tos-reel-btn tos-reel-play" id="tos-reel-play" title="Play/Pause">▶</button>
      <button class="tos-reel-btn" id="tos-reel-next" title="Next">▶</button>
      <button class="tos-reel-btn" id="tos-reel-ff" title="End">⏭</button>
      <input type="range" class="tos-reel-scrub" id="tos-reel-scrub" min="0" max="${Math.max(0, n - 1)}" value="0">
    </div>
    <div class="tos-reel-transcript">${transcript}</div>
  </div>`;
}

// Live DOM playback for the microreel viewer. Reads frames straight off _data.reel;
// updates the screen frame, HUD, scrubber, and transcript highlight in place.
function reelFrames() { return (_data?.reel?.frames) || []; }

function reelRender() {
  if (!_overlay || _data?.view !== 'reel') return;
  const frames = reelFrames();
  const n = frames.length;
  const frameEl = _overlay.querySelector('#tos-reel-frame');
  if (!frameEl) return;
  _reelIdx = Math.max(0, Math.min(n - 1, _reelIdx));
  const f = frames[_reelIdx];
  frameEl.textContent = n ? (f?.text || '') : 'NO FOOTAGE';
  frameEl.className = 'tos-reel-frame' + (f?.kind === 'say' ? ' say' : ' event');
  const atEnd = _reelIdx >= n - 1;
  _overlay.querySelector('#tos-reel-mode').textContent = _reelPlaying ? '▶ PLAY' : (atEnd ? '■ END' : '❚❚ PAUSE');
  _overlay.querySelector('#tos-reel-counter').textContent = `${String(Math.min(_reelIdx + 1, n)).padStart(3, '0')} / ${String(n).padStart(3, '0')}`;
  _overlay.querySelector('#tos-reel-play').textContent = _reelPlaying ? '❚❚' : '▶';
  const scrub = _overlay.querySelector('#tos-reel-scrub');
  if (scrub) scrub.value = _reelIdx;
  _overlay.querySelectorAll('.tos-reel-line').forEach(el => {
    el.classList.toggle('cur', +el.getAttribute('data-reel-i') === _reelIdx);
  });
  const cur = _overlay.querySelector('.tos-reel-line.cur');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}

function reelStop() { _reelPlaying = false; if (_reelTimer) { clearInterval(_reelTimer); _reelTimer = null; } }

function reelPlay() {
  const n = reelFrames().length;
  if (!n) return;
  if (_reelIdx >= n - 1) _reelIdx = 0;   // replay from the top if parked at the end
  _reelPlaying = true;
  reelRender();
  if (_reelTimer) clearInterval(_reelTimer);
  _reelTimer = setInterval(() => {
    if (_reelIdx >= reelFrames().length - 1) { reelStop(); reelRender(); return; }
    _reelIdx++; reelRender();
  }, REEL_FRAME_MS);
}

function reelSeek(to) { reelStop(); _reelIdx = to; reelRender(); }

function wireReel() {
  if (!_overlay || _data?.view !== 'reel') return;
  _reelIdx = 0; _reelPlaying = false;
  const q = id => _overlay.querySelector(id);
  q('#tos-reel-play')?.addEventListener('click', () => { _reelPlaying ? (reelStop(), reelRender()) : reelPlay(); sfx(TOS_SELECT_DEF); });
  q('#tos-reel-rew')?.addEventListener('click', () => reelSeek(0));
  q('#tos-reel-ff')?.addEventListener('click', () => reelSeek(reelFrames().length - 1));
  q('#tos-reel-prev')?.addEventListener('click', () => reelSeek(_reelIdx - 1));
  q('#tos-reel-next')?.addEventListener('click', () => reelSeek(_reelIdx + 1));
  q('#tos-reel-scrub')?.addEventListener('input', e => reelSeek(parseInt(e.target.value, 10) || 0));
  _overlay.querySelectorAll('.tos-reel-line').forEach(el => {
    el.addEventListener('click', () => reelSeek(+el.getAttribute('data-reel-i')));
  });
  reelRender();
}

// ── Chat app ────────────────────────────────────────────────────────────────
// The same conversations the floating chat window owns (whisper.js), rendered
// natively in the tablet. All chat state lives in whisper.js — here we just read
// it via the exported chat API and send through it. Live updates come from the
// onChatUpdate subscription (set up/torn down in render()/close()).

// Emoji palette for the picker (tap to insert at the caret). Ordered for an 8-col grid.
const CHAT_EMOJI = ['😀','😂','🙂','😉','😎','😍','😘','🤨','😴','🙄','😬','😳','😭','😢','😡','🤔','🤢','😱','💀','☠️','👍','👎','👌','🙏','👏','💪','🤞','👀','🔥','💯','✨','⭐','❤️','💔','🎉','💰','🍺','🚬','💊','⚠️','🚁','✈️','🔫','⚡','🌧️','🩸','🤖','💥'];
// Automatic emoji: :shortcode: names and plain-text emoticons converted on send.
const EMOJI_SHORTCODES = { fire:'🔥', skull:'💀', heart:'❤️', joy:'😂', lol:'😂', cry:'😭', sob:'😭', rage:'😡', angry:'😡', beer:'🍺', smoke:'🚬', pill:'💊', money:'💰', gun:'🔫', boom:'💥', robot:'🤖', eyes:'👀', pray:'🙏', clap:'👏', muscle:'💪', ok:'👌', star:'⭐', tada:'🎉', party:'🎉', wave:'👋', smile:'🙂', wink:'😉', cool:'😎', '100':'💯', '+1':'👍', '-1':'👎', thumbsup:'👍', thumbsdown:'👎' };
const EMOJI_EMOTICONS = [
  [/(?<=^|\s):-?\)(?=\s|$)/g, '🙂'],
  [/(?<=^|\s):-?D(?=\s|$)/g, '😀'],
  [/(?<=^|\s):-?\((?=\s|$)/g, '🙁'],
  [/(?<=^|\s):-?[Pp](?=\s|$)/g, '😛'],
  [/(?<=^|\s);-?\)(?=\s|$)/g, '😉'],
  [/(?<=^|\s):-?[Oo](?=\s|$)/g, '😮'],
  [/(?<=^|\s):['’]\((?=\s|$)/g, '😢'],
  [/(?<=^|\s)<\/3(?=\s|$)/g, '💔'],
  [/(?<=^|\s)<3(?=\s|$)/g, '❤️'],
  [/(?<=^|\s)[xX]D(?=\s|$)/g, '😆'],
];
// Convert :shortcodes: and emoticons in an outgoing message to emoji.
function emojifyChat(text) {
  text = text.replace(/:([a-z0-9_+-]+):/gi, (m, name) => EMOJI_SHORTCODES[name.toLowerCase()] || m);
  for (const [re, rep] of EMOJI_EMOTICONS) text = text.replace(re, rep);
  return text;
}

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
  // Keep the selection valid; default to the #system MOTD tab, else first
  // channel, else first tab (the Users hub is never auto-selected — it's opt-in).
  if (!onUsers && (!_chatTab || !tabs.some(t => t.key === _chatTab))) {
    const sys = tabs.find(t => t.key === '#system');
    _chatTab = (sys || tabs.find(t => t.kind === 'channel') || tabs[0])?.key || null;
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
  // #system holds only the MOTD (one ascii-art <pre>). Render it bare inside a
  // .tos-motd wrapper — no chat-bubble chrome — so fitMotd() can scale the full
  // border down to the tablet's width after layout (render()).
  const isSystem = active && active.key === '#system';
  // Always show the full Large ("big") MOTD in the tablet, whatever size the
  // floating chat panel is set to; fitMotd() scales it to the tablet's width.
  // Fall back to the stored #system message if the MOTD data isn't loaded yet.
  const motdMsg = isSystem ? (msgs.find(m => m.isHtml) || msgs[0]) : null;
  const motdHtml = isSystem ? (getMotdHtml('big') || motdMsg?.message) : null;
  const logInner = !active
    ? '<div class="tos-empty">No conversations yet. Open <strong>Users</strong> to message someone, or join a corp for its channel.</div>'
    : isSystem
      ? (motdHtml ? `<div class="tos-motd">${motdHtml}</div>` : '<div class="tos-empty">No message of the day.</div>')
      : (msgs.length ? msgs.map(renderChatMsg).join('') : '<div class="tos-empty">No messages yet.</div>');
  const log = `<div class="tos-chat-log${isSystem ? ' tos-motd-log' : ''}" id="tos-chat-log">${logInner}</div>`;

  const emojiPop = `<div class="tos-chat-emoji-wrap"><button class="tos-chat-emoji-btn" data-chat-emoji-toggle="1" type="button" title="Emoji">☺</button><div class="tos-chat-emoji-pop${_chatEmojiOpen ? ' open' : ''}">${CHAT_EMOJI.map(e => `<span class="tos-chat-emoji" data-chat-emoji="${e}">${e}</span>`).join('')}</div></div>`;
  const input = active && !active.systemOnly
    ? `<div class="tos-chat-input-row">${emojiPop}<input id="tos-chat-input" type="text" autocomplete="off" placeholder="Message ${esc(active.label)}…" /><button class="tos-btn" data-chat-send="1">Send</button></div>`
    : '';

  return `<div class="tos-chat">${tabRow}${log}${input}</div>`;
}

// Shrink the MOTD's ascii-art <pre> to fit the tablet's chat-log width. The art
// is authored ~100 chars wide (far past the tablet), so we scale it down by the
// exact width ratio (transform, top-left origin) and collapse the wrapper to the
// scaled height so no dead space is left below. Runs after layout, from render().
function fitMotd() {
  const wrap = _overlay?.querySelector('.tos-motd');
  const pre = wrap?.querySelector('pre');
  if (!wrap || !pre) return;
  pre.style.transform = '';
  wrap.style.height = '';
  const avail = wrap.clientWidth;
  const natural = pre.scrollWidth;
  if (avail > 0 && natural > avail) {
    const scale = avail / natural;
    pre.style.transform = `scale(${scale})`;
    wrap.style.height = Math.ceil(pre.scrollHeight * scale) + 'px';
  }
}

// ── News app ────────────────────────────────────────────────────────────────
// The feed: a stack of section cards, each rendered by its section.type. New
// section types (weather, corp wars, market) add a case to newsWidget below and
// a builder server-side (plugins/tablet/news-app.js). Unknown types degrade to
// a plain "unavailable" note rather than blanking the feed.
// The News feed is dressed as a newsprint sheet — a masthead over a stack of
// "articles" (one per section), each with a serif kicker header. The paper look
// comes mostly from re-pointing the theme's CSS variables to newsprint tones on
// the .tos-newspaper container (see the style block), so every widget inside
// inherits ink-on-paper without being rewritten.
function renderNews(sections, masthead) {
  if (!sections || !sections.length) return '<div class="tos-empty">No news right now. Check back later.</div>';
  const articles = sections.map((sec, i) => `<article class="tos-art${i === 0 ? ' lead' : ''}">
    <div class="tos-art-kicker"><span class="tos-art-title">${esc(sec.title || '')}</span>${sec.subtitle ? `<span class="tos-art-sub">${esc(sec.subtitle)}</span>` : ''}</div>
    ${newsWidget(sec)}
  </article>`).join('');
  return `<div class="tos-newspaper">${renderMasthead(masthead)}${articles}</div>`;
}

// Front-page masthead: grand serif nameplate between double rules, motto, and a
// dateline row (date · edition · price). Reads the live game date off the payload.
function renderMasthead(m) {
  if (!m || !m.name) return '';
  const dateStr = fmtNewsDate(m.date);
  const left = [m.dayOfWeek, dateStr].filter(Boolean).join(', ');
  return `<header class="tos-mast">
    <div class="tos-mast-rule top"></div>
    <h1 class="tos-mast-name">${esc(m.name)}</h1>
    ${m.motto ? `<div class="tos-mast-motto">“${esc(m.motto)}”</div>` : ''}
    <div class="tos-mast-rule bot"></div>
    <div class="tos-mast-line">
      <span>${esc(left)}</span>
      <span>${esc(m.edition || '')}</span>
      <span>${esc(m.price || '')}</span>
    </div>
  </header>`;
}

function fmtNewsDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return isNaN(dt) ? String(d) : dt.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function newsWidget(sec) {
  switch (sec.type) {
    case 'weather': return renderWeatherWidget(sec);
    case 'headlines': return renderHeadlinesWidget(sec.stories);
    case 'standings': return renderStandingsWidget(sec.teams);
    case 'blotter': return renderBlotterWidget(sec);
    default: return '<div class="tos-empty" style="padding:12px 4px">This section is unavailable.</div>';
  }
}

// The Police Blotter. Two kinds of line, deliberately styled apart: a WARRANT is
// live and about someone who is still out there, an INCIDENT already happened.
// Stars are drawn rather than counted, because "★★★" reads at a glance and
// "3 stars" has to be parsed.
function renderBlotterWidget(sec) {
  if (sec.quiet && !(sec.entries || []).length) {
    return `<div class="tos-blotter"><div class="tos-blot-quiet">${esc(sec.quiet)}</div></div>`;
  }
  const rows = (sec.entries || []).map(e => {
    if (e.kind === 'warrant') {
      const stars = '★'.repeat(Math.max(1, Math.min(5, e.stars || 1)));
      return `<div class="tos-blot-row warrant">
        <span class="tos-blot-stars" title="${esc(String(e.stars || 0))} star">${stars}</span>
        <span class="tos-blot-body"><b>${esc(e.who)}</b> — wanted for ${esc(e.what)}</span>
      </div>`;
    }
    const where = e.where ? ` at ${esc(e.where)}` : '';
    const when = e.when ? `<span class="tos-blot-when">${esc(e.when)}</span>` : '';
    return `<div class="tos-blot-row">
      <span class="tos-blot-mark" aria-hidden="true">†</span>
      <span class="tos-blot-body"><b>${esc(e.who)}</b> — ${esc(e.what)}${where}</span>
      ${when}
    </div>`;
  }).join('');
  return `<div class="tos-blotter">${rows}</div>`;
}

// Weather widget — today's conditions as a tappable card; tapping expands the
// 7-day strip in place (client-side toggle, no server round trip). Self-contained:
// everything it draws comes from the section's own `now`/`days` payload.
function renderWeatherWidget(sec) {
  const n = sec.now;
  if (!n) return '<div class="tos-empty" style="padding:14px 4px">Weather is offline.</div>';
  const open = _newsWeatherOpen;
  const stat = (label, value) => `<div class="tos-wx-stat"><span class="tos-wx-k">${esc(label)}</span><span class="tos-wx-v">${esc(String(value))}</span></div>`;
  const now = `<div class="tos-wx-now" data-weather-toggle role="button" tabindex="0" aria-expanded="${open}">
    <div class="tos-wx-glyph">${esc(n.icon || '')}</div>
    <div class="tos-wx-main">
      <div class="tos-wx-temp">${n.tempC}°C <span class="tos-wx-tempf">/ ${n.tempF}°F</span></div>
      <div class="tos-wx-cond">${esc(n.conditions || '')}${n.intensity ? ` · ${esc(n.intensity)}` : ''}</div>
    </div>
    <div class="tos-wx-stats">
      ${stat('Feels', `${n.feelsLikeC}°C`)}
      ${n.humidityPct != null ? stat('Humidity', `${n.humidityPct}%`) : ''}
      ${stat('Wind', `${n.windKph} kph`)}
    </div>
    <div class="tos-wx-toggle">7-day ${open ? '▾' : '▸'}</div>
  </div>`;
  if (!open) return now;
  // A hero-event day is flagged so it can't be skimmed past — this widget is
  // where most players will actually see the week's warning.
  const days = (sec.days || []).map(f => `<div class="tos-wx-day${f.heroEvent ? ' tos-wx-hero' : ''}">
    <span class="tos-wx-dow">${esc(dayLabel(f))}</span>
    <span class="tos-wx-dico">${esc(f.icon || '')}</span>
    <span class="tos-wx-dcond">${esc(f.weatherType || '')}${f.heroEvent ? ' ⚠⚠' : ''}</span>
    <span class="tos-wx-dtemp">${f.tempC}°C</span>
    <span class="tos-wx-dwind">${f.windKph}kph</span>
    <span class="tos-wx-dhum">${f.humidityPct}%</span>
  </div>`).join('');
  return `${now}<div class="tos-wx-forecast">${days || '<div class="tos-empty" style="padding:12px 4px">No forecast.</div>'}</div>`;
}

// "Today" for day 0, otherwise a short weekday from the ISO date.
function dayLabel(f) {
  if (f.day === 0) return 'Today';
  if (!f.date) return `Day ${f.day}`;
  const d = new Date(f.date);
  return isNaN(d) ? `Day ${f.day}` : d.toLocaleDateString(undefined, { weekday: 'short' });
}

function renderHeadlinesWidget(stories) {
  if (!stories || !stories.length) return '<div class="tos-empty" style="padding:14px 4px">Quiet news day. Too quiet.</div>';
  // Stash the feed so a tapped headline can open its full mini-story client-side
  // (the body rides in the payload — no round trip). Index-keyed so no per-story
  // attribute escaping is needed.
  _newsStories = stories;
  return `<div class="tos-news-list">${stories.map((s, i) => `<div class="tos-headline" data-news-idx="${i}" role="button" tabindex="0">
    <span class="tos-hl-tag ${s.tag === 'live' ? 'live' : 'tabloid'}">${s.tag === 'live' ? 'LIVE' : 'WIRE'}</span>
    <span class="tos-hl-text">${esc(s.headline)}${s.byline ? ` <span class="tos-hl-by">— ${esc(s.byline)}</span>` : ''}</span>
  </div>`).join('')}</div>`;
}

// Tapping a headline opens its full story in a little "browser window" popup —
// the paper's website, mid-collapse. All client-side: the body rode down in the
// News payload, so there's no round trip. Rendered above the tablet inside the
// overlay; a re-render (or a second tap) dismisses it.
function openNewsStory(story) {
  closeNewsStory();
  if (!story) return;
  const live = story.tag === 'live';
  const url = live ? 'sentinel.cw/wire/live' : 'sentinel.cw/edition/today';
  const win = document.createElement('div');
  win.className = 'tos-newswin-back';
  win.innerHTML = `<div class="tos-newswin" role="dialog" aria-modal="true">
    <div class="tos-nw-chrome">
      <span class="tos-nw-mark">📰</span>
      <span class="tos-nw-url">🔒 ${esc(url)}</span>
      <button class="tos-nw-x" type="button" aria-label="Close">✕</button>
    </div>
    <div class="tos-nw-page">
      <div class="tos-nw-kicker">
        <span class="tos-nw-tag ${live ? 'live' : ''}">${live ? 'LIVE WIRE' : 'THE WIRE'}</span>
        ${story.byline ? `<span class="tos-nw-by">${esc(story.byline)}</span>` : ''}
      </div>
      <h2 class="tos-nw-headline">${esc(story.headline || '')}</h2>
      <p class="tos-nw-story">${esc(story.body || 'The story ends here. The rest was classified, redacted, or never true to begin with.')}</p>
      <div class="tos-nw-foot">The Coldwater Sentinel — all the truth the Architect permits.</div>
    </div>
  </div>`;
  win.addEventListener('click', (e) => { if (e.target === win) closeNewsStory(); });
  win.querySelector('.tos-nw-x').addEventListener('click', closeNewsStory);
  _overlay.appendChild(win);
  _newsWin = win;
}
function closeNewsStory() {
  if (_newsWin) { _newsWin.remove(); _newsWin = null; }
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
      : `<button class="tos-btn" data-act-id="${esc(a.id)}" data-act-app="${esc(appId)}" data-act-params="${esc(params || '')}"${a.prompt ? ` data-act-prompt="${esc(a.prompt)}"` : ''}${a.pick ? ` data-act-pick="${esc(JSON.stringify(a.pick)).replace(/"/g, '&quot;')}"` : ''}${a.confirm ? ` data-act-confirm="${esc(a.confirm)}"` : ''}${a.launch ? ` data-act-launch="${esc(a.launch)}"` : ''}>${esc(a.label)}</button>`
  ).join('')}</div>`;
}

// DEADHEAD — the Leviathan crew-dispatch console: a normalized map of the base + every airfield
// (tap one to chart a course to land there, or tap ANYWHERE to set a hold point), a status line
// with fuel, and contextual crew controls. Airfield tiles carry data-act-id="chart"; the map box
// itself (id tos-dh-map) is wired to fire a 'loiter' action at the tapped tile — see the binding
// in the render-events pass. _dhBox stashes the last bounding box so that click can invert to a tile.
let _dhBox = null;
let _dhRegions = false;   // DEADHEAD map: is the labelled region overlay drawn over the terrain?
// Terrain palette for the DEADHEAD world map, keyed by the one-char codes worldTerrainMap() packs.
// Muted and low-contrast on purpose: this is the GROUND the markers sit on, and the moment it
// competes with the airfield pips or the aircraft it stops being a map and becomes wallpaper.
const TOS_DH_TERRAIN = {
  '.': [10, 15, 20, 255],     // unmapped — the void beyond the grid
  w: [26, 52, 78, 255],       // water
  g: [46, 66, 44, 255],       // grass
  f: [32, 54, 36, 255],       // forest
  s: [82, 74, 52, 255],       // sand
  k: [62, 60, 58, 255],       // rock
  n: [110, 118, 126, 255],    // snow
  x: [58, 50, 42, 255],       // wasteland
  u: [64, 64, 72, 255],       // urban
  i: [70, 58, 48, 255],       // industrial
  r: [58, 60, 66, 255],       // residential
  a: [58, 56, 60, 255],       // airport apron
  B: [92, 92, 102, 255],      // buildings — the city reads as a lighter mass
  R: [120, 112, 96, 255],     // roads/runways — brightest, so the arteries are the shape you read
  A: [242, 176, 30, 255],     // airfields, in the app's own accent
};
function renderDeadhead(d) {
  const dh = d.deadhead || {};
  if (dh.none) return `<div style="padding:26px 16px;text-align:center;color:var(--tos-dim,#8aa)">Board a <b>Leviathan</b> to run its crew from here.</div>`;
  const fields = (dh.fields || []).slice().sort((a, b) => a.dist - b.dist);
  const loiter = dh.charted?.loiter ? { gx: dh.charted.tx, gy: dh.charted.ty } : null;
  const acX = dh.fx ?? dh.gx, acY = dh.fy ?? dh.gy;   // fractional live position (see buildDeadhead)
  // REGION mode zooms out from "airfields I can reach" to "places there are". It's a client-side
  // toggle — the region rectangles ride every push — so switching is instant and costs no round trip.
  const regions = dh.regions || [];
  const regionMode = _dhRegions && regions.length > 0;
  const world = dh.world || null;
  // ONE frame for everything. With a real terrain map underneath, the extent has to be the WORLD —
  // terrain, regions, airfields and the ship all have to agree on the same coordinate box or the
  // painted ground slides out from under the markers on it. (Before the terrain existed the box was
  // fitted to whatever was being shown, which is why the two modes used to normalise differently.)
  const pts = world
    ? [{ gx: world.x0, gy: world.y0 }, { gx: world.x0 + world.w * world.cell - 1, gy: world.y0 + world.h * world.cell - 1 }]
    : regionMode
      ? [{ gx: acX, gy: acY }, ...regions.flatMap(r => [{ gx: r.minX, gy: r.minY }, { gx: r.maxX, gy: r.maxY }])]
      : [{ gx: acX, gy: acY }, ...fields, ...(loiter ? [loiter] : [])];
  let minX = Math.min(...pts.map(p => p.gx)), maxX = Math.max(...pts.map(p => p.gx));
  let minY = Math.min(...pts.map(p => p.gy)), maxY = Math.max(...pts.map(p => p.gy));
  if (maxX === minX) { minX -= 1; maxX += 1; }
  if (maxY === minY) { minY -= 1; maxY += 1; }
  _dhBox = { minX, maxX, minY, maxY };
  const P = 0.1, nx = (g) => (P + (1 - 2 * P) * (g - minX) / (maxX - minX)) * 100, ny = (g) => (P + (1 - 2 * P) * (g - minY) / (maxY - minY)) * 100;
  const acc = 'var(--tos-accent,#f2b01e)';
  // Region rectangles: a translucent box per region with its name in the corner. Deliberately plain —
  // this is the "where in the world am I" view, not a second tactical map, so no terrain art, no
  // per-tile detail. Tapping one holds over its centre, reusing the same loiter dispatch a bare-tile
  // tap already uses, so the zoomed-out view is dispatchable rather than decorative.
  const REG_HUE = ['#5ad1ff', '#7dffb0', '#ffb43a', '#ff8ad1', '#b48aff', '#59e0d0'];
  const boxes = !regionMode ? '' : regions.map((r, i) => {
    const col = REG_HUE[i % REG_HUE.length];
    const x0 = Math.min(nx(r.minX), nx(r.maxX)), x1 = Math.max(nx(r.minX), nx(r.maxX));
    const y0 = Math.min(ny(r.minY), ny(r.maxY)), y1 = Math.max(ny(r.minY), ny(r.maxY));
    return `<button type="button" title="${esc(r.name)} — hold over it"
      data-act-id="loiter" data-act-app="deadhead" data-act-params="${Math.round(r.cx)} ${Math.round(r.cy)}"
      style="position:absolute;left:${x0.toFixed(1)}%;top:${y0.toFixed(1)}%;width:${Math.max(1.5, x1 - x0).toFixed(1)}%;height:${Math.max(1.5, y1 - y0).toFixed(1)}%;
        background:${col}14;border:1px solid ${col}66;border-radius:4px;cursor:pointer;padding:0;font-family:inherit;text-align:left">
      <span style="position:absolute;left:4px;top:2px;font-size:8.5px;letter-spacing:.4px;color:${col};text-shadow:0 1px 2px #000;white-space:nowrap;max-width:96%;overflow:hidden;text-overflow:ellipsis">${esc(r.name)}</span>
    </button>`;
  }).join('');
  // Airfield pips stay visible in BOTH modes — the request was to combine the two maps, not to swap
  // between them, and a region overlay you can't see your destinations through is half a map.
  const dots = fields.map(f => {
    const charted = !dh.charted?.loiter && dh.charted?.id === f.id;
    return `<button type="button" style="position:absolute;left:${nx(f.gx).toFixed(1)}%;top:${ny(f.gy).toFixed(1)}%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:1px;background:none;border:none;cursor:pointer;padding:2px;font-family:inherit"
      data-act-id="chart" data-act-app="deadhead" data-act-params="${esc(f.id)}" title="${esc(f.name)} — ${f.dist} tiles">
      <span style="font-size:13px;line-height:1;color:${charted ? '#7dffb0' : acc};filter:drop-shadow(0 0 3px ${charted ? '#2f8' : 'transparent'})">✈</span>
      <span style="font-size:8.5px;letter-spacing:.3px;color:${charted ? '#7dffb0' : 'var(--tos-dim,#9ab)'};white-space:nowrap;max-width:76px;overflow:hidden;text-overflow:ellipsis">${esc(f.name)}</span>
    </button>`;
  }).join('');
  const loiterMk = loiter ? `<div style="position:absolute;left:${nx(loiter.gx).toFixed(1)}%;top:${ny(loiter.gy).toFixed(1)}%;transform:translate(-50%,-50%);color:#7dffb0;font-size:15px;line-height:1;text-shadow:0 0 7px #2f8;pointer-events:none" title="hold point">◎</div>` : '';
  // THE SHIP HERSELF — an aeroplane, nose pointed down her heading, sitting on the live fractional
  // position. The glyph ✈ is drawn pointing north-EAST, so the rotation carries a −45° correction;
  // without it every heading reads 45° off, which is just close enough to look right and be wrong.
  // A CSS transition on the transform smooths the step between server pushes so she glides rather
  // than jumping, and a soft ring underneath keeps her findable against the airfield dots.
  const hdg = ((dh.hdg || 0) % 360 + 360) % 360;
  const here = `<div style="position:absolute;left:${nx(acX).toFixed(2)}%;top:${ny(acY).toFixed(2)}%;transform:translate(-50%,-50%);pointer-events:none;transition:left .9s linear,top .9s linear" title="${esc(dh.name || 'your aircraft')} — heading ${Math.round(hdg)}°">
    <div style="position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:1px solid rgba(255,90,106,.45);box-shadow:0 0 8px rgba(255,90,106,.35)${dh.moving ? ';animation:tos-dh-ping 2s ease-out infinite' : ''}"></div>
    <div style="transform:rotate(${(hdg - 45).toFixed(1)}deg);transition:transform .9s linear;color:#ff5a6a;font-size:17px;line-height:1;text-shadow:0 0 7px #ff5a6a">✈</div>
  </div>`;
  const st = dh.status || {};
  const stateColor = st.state === 'crew' ? '#5ad1ff' : st.state === 'parked' ? 'var(--tos-dim,#9ab)' : acc;
  const fuel = typeof dh.fuel === 'number' ? `<span style="font-size:11px;color:${dh.fuel < 25 ? '#ff7a86' : 'var(--tos-dim,#9ab)'}">⛽ ${dh.fuel}%</span>` : '';
  const notice = d.notice ? `<div style="margin:6px 0;padding:6px 9px;border-left:2px solid ${acc};background:rgba(255,255,255,.04);font-size:12px">${esc(d.notice)}</div>` : '';
  const clearBtn = `<button type="button" class="tos-btn" style="padding:1px 8px;font-size:11px;margin-left:6px" data-act-id="clear" data-act-app="deadhead" data-act-params="">clear</button>`;
  const hint = dh.remote
    ? `Tap a <b>field</b> to send her there, or <b>anywhere</b> to hold — the crew fly her. Board her to walk the decks.`
    : `Tap an <b>airfield</b> to land there, or <b>anywhere</b> to hold that spot.`;
  const charted = dh.charted
    ? (dh.charted.loiter
      ? `<div style="margin-top:8px;font-size:12px">Holding over <b style="color:#7dffb0">${esc(dh.charted.name)}</b> until bingo fuel, then divert to land ${clearBtn}</div>`
      : `<div style="margin-top:8px;font-size:12px">${dh.remote ? 'Bound for' : 'Course set:'} <b style="color:#7dffb0">${esc(dh.charted.name)}</b>${(!dh.remote && !dh.airborne && !dh.crew && dh.seat !== 'pilot') ? ' <span style="color:var(--tos-dim,#8aa)">— hit <b>Depart</b> and the crew take her up.</span>' : ''} ${dh.remote ? '' : clearBtn}</div>`)
    : `<div style="margin-top:8px;font-size:12px;color:var(--tos-dim,#8aa)">${hint}</div>`;
  const btns = [];
  if (dh.remote) btns.push(`<button type="button" class="tos-btn" data-act-id="circlehere" data-act-app="deadhead" data-act-params="" title="send the crew to hold a lazy orbit over her current spot">Circle here</button>`);
  else if (dh.crew || (dh.seat === 'pilot' && dh.airborne)) btns.push(`<button type="button" class="tos-btn" data-act-id="circlehere" data-act-app="deadhead" data-act-params="" title="hold a gentle orbit over her current position">Circle here</button>`);
  // DEPART — the go button. Aboard, parked, not at the controls, with a course charted: this is the
  // step that was missing, and without it charting from the cabin set a destination nothing acted on.
  if (!dh.remote && !dh.airborne && !dh.crew && dh.seat !== 'pilot' && dh.charted) {
    btns.push(`<button type="button" class="tos-btn" data-act-id="depart" data-act-app="deadhead" data-act-params="" style="border-color:#7dffb0;color:#7dffb0" title="the crew spin her up and fly the charted course">▶ Depart</button>`);
  }
  if (!dh.remote && dh.seat === 'pilot') btns.push(`<button type="button" class="tos-btn" data-act-id="hand" data-act-app="deadhead" data-act-params="">Hand off to the crew</button>`);
  else if (!dh.remote && dh.atDeck && !dh.airborne && !dh.crew) btns.push(`<button type="button" class="tos-btn" data-act-id="take" data-act-app="deadhead" data-act-params="">Take the controls</button>`);
  const controls = btns.length ? `<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">${btns.join('')}</div>` : '';
  return `<div style="padding:4px 2px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:8px 10px;border:1px solid var(--border,#2a3a44);border-radius:8px;background:rgba(255,255,255,.03)">
      <span style="font-weight:bold;letter-spacing:.5px;color:${acc}">✈ ${esc(dh.name || 'Leviathan')}</span>
      <span style="display:flex;gap:10px;align-items:baseline"><span style="font-size:12px;color:${stateColor}">${esc(st.text || '')}</span>${fuel}</span>
    </div>
    ${notice}
    ${regions.length ? `<div style="display:flex;gap:6px;margin:10px 0 -4px;align-items:center">
      <button type="button" class="tos-btn" data-dh-view="${regionMode ? 'fields' : 'regions'}" style="padding:1px 9px;font-size:11px;${regionMode ? `border-color:${acc};color:${acc}` : ''}" title="overlay the named regions on the map">▦ REGIONS</button>
      <span style="font-size:10px;color:var(--tos-dim,#8aa)">${regionMode ? 'tap a region to hold over it' : 'tap a field to chart · anywhere to hold'}</span>
    </div>` : ''}
    <div id="tos-dh-map" style="position:relative;height:210px;margin:10px 0;border:1px solid var(--border,#2a3a44);border-radius:9px;cursor:crosshair;background:${world ? '#0a0f14' : 'repeating-linear-gradient(0deg,transparent,transparent 23px,rgba(255,255,255,.03) 24px),repeating-linear-gradient(90deg,transparent,transparent 23px,rgba(255,255,255,.03) 24px),radial-gradient(circle at 50% 50%,rgba(90,120,150,.10),transparent 70%)'};overflow:hidden">
      ${world ? `<canvas id="tos-dh-canvas" style="position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;opacity:.92"></canvas>` : ''}
      ${boxes}${dots}${loiterMk}${here}</div>
    ${charted}
    ${controls}
  </div>`;
}

// ── TV app ───────────────────────────────────────────────────────────────────
// The tablet's television. The viewport below carries the same `data-tv="…"` hooks
// as the standalone set's markup in index.html, so the SHARED renderer
// (panels/tv.js createTvView) drives it unchanged — that's what gives the app full
// parity (tuner, guide, gameday, score-bug, sports FX, themes, ticker, read-aloud)
// without a second copy of the broadcast rendering logic.
let _tvView = null;

function renderTv(d) {
  // Off the grid there is no broadcast to receive at all — no station, no tuner,
  // just dead air. Short-circuits before the shared TV view is ever built, so
  // mountTabletTv finds no .tos-tv-set and never opens a portable tuner out here.
  if (isOnCrossing()) {
    const bars = ['#c0c0c0', '#c8c800', '#00c8c8', '#00c800', '#c800c8', '#c80000', '#0000c8', '#101010']
      .map(c => `<i style="background:${c}"></i>`).join('');
    return `<div class="tos-tv-dead">
      <div class="tos-tv-dead-bars">${bars}</div>
      <div class="tos-tv-dead-t">No signal</div>
      <div class="tos-tv-dead-s">No broadcast reaches the void</div>
    </div>`;
  }
  const channels = Array.isArray(d.channels) ? d.channels : [];
  const chips = channels.length
    ? channels.map(c =>
        `<div class="tos-tv-chip${c.channelId === d.tuned ? ' on' : ''}" data-tv-ch="${c.number}">` +
          `<span class="n">${c.number}</span>${esc(c.name || '')}</div>`).join('')
    : `<div class="tos-empty">No channels are broadcasting.</div>`;

  return `<div class="tos-tv">
    <div class="tos-tv-set" data-tv="window">
      <div class="tos-tv-bar" data-tv="header">
        <span class="tos-tv-station" data-tv="station-name">——</span>
        <span class="tos-tv-ch" data-tv="channel-num">——</span>
        <span class="tos-tv-prog" data-tv="program-name"></span>
        <span class="tos-tv-live" data-tv="live-badge">&#x25CF; LIVE</span>
      </div>
      <div class="tos-tv-screen">
        <div data-tv="content"><div data-tv="messages"></div></div>
        <div data-tv="static"></div>
        <div data-tv="overlay-container"></div>
        <div data-tv="schedule"></div>
        <div data-tv="standings-panel"></div>
        <div data-tv="gameday"></div>
        <div data-tv="scorebug"></div>
        <div data-tv="standings"></div>
        <div class="tv-fx-host" data-tv="fx"></div>
      </div>
      <div class="tos-tv-ticker" data-tv="ticker-track"><span data-tv="ticker-inner"></span></div>
      <div class="tos-tv-ctl">
        <button class="tos-tv-ch-btn" data-tv="tune-up" title="Channel up" aria-label="Channel up">
          <span class="l">CH</span><span class="c">&#x25B2;</span>
        </button>
        <button class="tos-tv-ch-btn" data-tv="tune-down" title="Channel down" aria-label="Channel down">
          <span class="l">CH</span><span class="c">&#x25BC;</span>
        </button>
        <span class="tos-tv-num" data-tv="channel-num" aria-live="polite">——</span>
        <span class="tos-tv-spacer"></span>
        <button data-tv="schedule-btn" title="TV guide — what's on and when">&#x1F5D3;</button>
        <button data-tv="gameday-btn" title="Gameday — animated play-by-play">&#x26BE;</button>
        <button data-tv="standings-btn" title="Standings — the DEADBALL league table">&#x1F3C6;</button>
        <button data-tv="read-btn" title="Read broadcast aloud">&#x1F508;</button>
        <button data-tv="close-btn" title="Switch the screen off">&#x23FB;</button>
      </div>
    </div>
    <div class="tos-tv-dial">${chips}</div>
  </div>`;
}

// Bind the shared renderer to the freshly-rendered viewport. render() rebuilds the
// whole body on every nav, so the old instance is always torn down first.
function mountTabletTv() {
  unmountTabletTv();
  const host = _overlay?.querySelector('.tos-tv-set');
  if (!host) return;
  _tvView = createTvView(host, {
    key: 'tablet',
    chassis: 'tablet',
    tuneCmd: 'tablettune',
    watchMsg: 'tablet_tv_watch',
    unwatchMsg: 'tablet_tv_unwatch',
  });
  _tvView.init();
  // Open with the picture centred rather than parked at the top of the body, where
  // the clock/summary/Back row would eat the first ~80px of the screen.
  requestAnimationFrame(() => {
    const scroll = _overlay?.querySelector('.tos-scroll');
    if (!scroll || !host.isConnected) return;
    const top = host.offsetTop - Math.max(0, (scroll.clientHeight - host.offsetHeight) / 2);
    scroll.scrollTop = Math.max(0, top);
  });
  const channels = _data?.channels || [];
  const ch = channels.find(c => c.channelId === _data?.tuned);
  if (ch) {
    // Re-entering the app lands back on the channel you were watching rather than a
    // dead screen; the server answers with a dest:'tablet' tv_panel.
    sendCmdSilent(`tablettune ${ch.number}`);
  } else {
    // Nothing tuned yet — power the screen up dark, on static, exactly like walking
    // up to a set that's switched off. Tapping a channel chip lights it.
    _tvView.open({ channelId: null, channelNumber: 0, stationName: '', channelName: '', channelList: channels });
  }
}

function unmountTabletTv() {
  if (!_tvView) return;
  _tvView.destroy();   // closes the view, which drops the portable tuner server-side
  _tvView = null;
}

// A `tv_panel` addressed to the tablet (dest:'tablet') — the portable tuner
// answering a `tablettune`. Routed here from dispatch.js.
export function openTabletTvPanel(msg) {
  _tvView?.open(msg);
  // Repaint the channel chips so the tuned one highlights, without a server round
  // trip. The renderer owns the screen; this only updates the dial strip.
  if (_data && _data.view === 'tv') {
    _data.tuned = msg.channelId || null;
    const dial = _overlay?.querySelector('.tos-tv-dial');
    if (dial) {
      const num = msg.channelNumber;
      dial.querySelectorAll('[data-tv-ch]').forEach(chip =>
        chip.classList.toggle('on', Number(chip.getAttribute('data-tv-ch')) === num));
    }
  }
}

function renderBody() {
  const d = _data;
  if (!d) return '';
  const hdr = renderHeader(d);
  const summary = renderSummary(d.player);

  if (d.screen === 'home' || !d.appId) {
    return `<div class="tos-body">${hdr}${summary}${renderHomeApps(d.apps)}${renderHomeWidgets(d.widgets)}</div>`;
  }

  // App screen. view: categories | list | detail | corp | tablet_settings | error
  if (d.view === 'tablet_settings') {
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(null, [d.appName])}${renderTabletSettings()}</div>`;
  }
  if (d.view === 'corp') {
    return `<div class="tos-body tos-corp-view">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}
      ${d.notice ? `<div class="tos-error" style="text-align:left;padding:0 0 10px">${esc(d.notice)}</div>` : ''}
      ${renderCorpScreen(d)}
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
    return `<div class="tos-body tos-map-view">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}${renderTosTabs(d)}
      <div id="tos-map-root">${renderMap(d)}</div>
    </div>`;
  }
  if (d.view === 'deadhead') {
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}${renderDeadhead(d)}</div>`;
  }
  if (d.view === 'gear') {
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}
      <div id="tos-gear-root">${renderGear(d)}</div>
    </div>`;
  }
  if (d.view === 'surveillance') {
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}
      ${renderSurveillance(d)}
    </div>`;
  }
  if (d.view === 'codex') {
    const crumb = renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName]);
    // The Orders section keeps its own sticky tab strip (it carries the crumb
    // itself); every other surface takes the ordinary breadcrumb above the body.
    if (d.sectionKind === 'orders') {
      return `<div class="tos-body">${hdr}${summary}${renderIdeology(d, crumb)}</div>`;
    }
    return `<div class="tos-body">${hdr}${summary}${crumb}
      ${d.section ? renderCodexVolume(d) : renderCodexShelf(d)}
    </div>`;
  }
  if (d.view === 'library') {
    const body = d.libKind === 'cover' ? renderLibraryCover(d)
               : d.libKind === 'contents' ? renderLibraryContents(d)
               : renderLibraryShelf(d);
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}
      ${body}
      ${renderActions(d.appId, d.actions, d.book?.id || '')}
    </div>`;
  }
  if (d.view === 'alarm') {
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}
      ${renderAlarm(d)}
    </div>`;
  }
  if (d.view === 'health') {
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}${renderTosTabs(d)}
      ${renderHealth(d)}
    </div>`;
  }
  if (d.view === 'accolades') {
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}
      ${renderAccolades(d)}
    </div>`;
  }
  if (d.view === 'bliss_listings' || d.view === 'bliss_detail' || d.view === 'bliss_arrangement') {
    const body = d.view === 'bliss_detail' ? renderBlissDetail(d)
               : d.view === 'bliss_arrangement' ? renderBlissArrangement(d)
               : renderBlissListings(d);
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}
      ${d.notice ? `<div class="tos-bliss-notice">${esc(d.notice)}</div>` : ''}
      ${body}
    </div>`;
  }
  if (d.view === 'reel') {
    const reelActions = d.reel?.id
      ? renderActions(d.appId, [{ id: 'delete', label: '🗑 Destroy Reel', confirm: 'Permanently destroy this microreel? This cannot be undone.' }], d.reel.id)
      : '';
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}
      ${renderReel(d)}
      ${reelActions}
    </div>`;
  }
  if (d.view === 'chat') {
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}
      ${renderChat()}
    </div>`;
  }
  if (d.view === 'news') {
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}
      ${renderNews(d.sections, d.masthead)}
    </div>`;
  }
  if (d.view === 'tv') {
    return `<div class="tos-body tos-tv-view">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}
      ${renderTv(d)}
    </div>`;
  }
  if (d.view === 'fakeplay') {
    // Self-contained novelty — the breadcrumb Back exits the whole app; the fake
    // game (login → terminal → mini tablet) is mounted into #tos-fake-root by
    // mountFakePlay() after render, and runs entirely client-side.
    return `<div class="tos-body">${renderBreadcrumb(d.appId, [d.appName])}<div id="tos-fake-root" class="tos-fake"></div></div>`;
  }
  if (d.view === 'error') {
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb || [d.appName])}<div class="tos-error">${esc(d.message || d.error || 'Something went wrong.')}</div></div>`;
  }
  if (d.view === 'categories') {
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(null, [d.appName])}${renderCategories(d.items)}</div>`;
  }
  if (d.view === 'help') {
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb || [d.appName])}${renderHelp(d.chapter)}</div>`;
  }
  if (d.view === 'calendar') {
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb || [d.appName])}${renderCalendar(d)}${renderList(d.items)}${renderActions(d.appId, d.actions, '')}</div>`;
  }
  if (d.view === 'list') {
    const pageNav = d.page ? renderPageNav(d.appId, d.breadcrumb, d.page) : '';
    // Tabs and rows were `detail`-only, which silently swallowed both on any list
    // screen that sent them: the Sports app's league tabs never drew (so Cluster
    // Puck was unreachable — there was no second tab to press) and its leader
    // races vanished with them. Both renderers no-op on a payload that omits
    // them, so every existing list screen is unaffected.
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb || [d.appName])}${renderTosTabs(d)}${renderList(d.items)}${d.rows ? `<div class="tos-detail-rows">${renderDetailRows(d.rows)}</div>` : ''}${pageNav}${renderActions(d.appId, d.actions, '')}</div>`;
  }
  if (d.view === 'detail') {
    const det = d.detail || d.quest || {};
    const params = det.id || '';
    // A quest's detail carries its own action log — the narrative of what you did
    // on this quest, built from the server's structured quest_log beats.
    const qlog = d.appId === 'quests' && det.id ? renderQuestActivityLog(det.id) : '';
    // A library chapter is set as a BOOK — aged paper, serif, an illuminated initial.
    // These are pre-collapse artifacts (docs/systems-library.md: the bar is US public
    // domain), and reading one on a scavenged tablet should feel like handling
    // something much older than the tablet.
    const isBook = d.appId === 'library';
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb || [d.appName])}${renderTosTabs(d)}
      ${d.notice ? `<div class="tos-error" style="text-align:left;padding:0 0 10px">${esc(d.notice)}</div>` : ''}
      <div class="tos-detail-name${isBook ? ' tos-book-title' : ''}">${esc(det.name || '')}</div>
      ${det.desc ? `<div class="tos-detail-desc">${esc(det.desc)}</div>` : ''}
      ${renderObjectives(d.quest?.objectives)}
      ${d.narratable ? renderNarrateBar() : ''}
      ${det.body ? `<div class="tos-detail-body${isBook ? ' tos-book' : ''}">${d.narratable ? renderNarratableBody(det.body, d.glossary) : `<p>${esc(det.body).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p>`}</div>` : ''}
      ${renderDetailRows(det.rows)}
      ${renderActions(d.appId, d.actions, params)}
      ${qlog}
    </div>`;
  }
  return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, [d.appName])}<div class="tos-empty">Unknown screen.</div></div>`;
}

function wireBody() {
  // Read Aloud / Stop. The text comes off the payload rather than the DOM so the
  // synth gets clean prose, not the paragraph markup we just wrapped it in.
  _overlay.querySelectorAll('[data-narrate]').forEach(el => {
    el.addEventListener('click', () => {
      sfx(TOS_SELECT_DEF);
      const mode = el.getAttribute('data-narrate');
      if (mode === 'stop') { narrateStop(); return; }
      if (mode === 'min') {
        // Close the shell but let the voice run on. The flag is consumed by
        // close(), which otherwise stops narration like any other teardown.
        if (_narrate) { _narrateKeepOnClose = true; close(); syncNarratePill(); }
        return;
      }
      // CODEX renders its own reader (view 'codex'), so its prose lives on the
      // chapter rather than on `detail`. Same narrator, same bar, same minimize.
      if (_data?.view === 'codex') { narrateCodexFrom(_tosCodexCh); return; }
      const det = _data?.detail || {};
      // Seed on the BOOK, not the chapter, so a novel keeps one narrator's voice
      // the whole way through instead of recasting every page.
      const book = (_data?.breadcrumb && _data.breadcrumb[0]) || _data?.appName || 'library';
      // Auto-advance through the book: at the end of a chapter, read the next.
      // Resolved lazily off the live payload, so a chapter that hasn't loaded (or
      // the last one) simply stops.
      // SNAPSHOT the shelf and our place in it, right now, and walk that.
      //
      // This used to read `_data` inside advance(), which broke it twice over.
      // Minimize calls close(), and close() nulls `_data` — so the moment you
      // minimized, the next chapter resolved to null and the book stopped dead at
      // the end of the one you were on, which is the whole thing minimize exists to
      // prevent. And with the tablet OPEN it was no better: `_data.detail.id` is the
      // chapter you pressed play on and never moves, so every advance re-derived the
      // same index and handed back chapter N+1 for ever.
      //
      // Capturing the list and holding our own cursor fixes both — the reader walks
      // forward on its own and needs nothing from a screen that may be long gone.
      const chapterList = _data?.detail?.chapters || _data?.chapters || null;
      let atIdx = Array.isArray(chapterList)
        ? chapterList.findIndex(c => (c.id ?? c) === (_data?.detail?.id))
        : -1;
      const advance = () => {
        if (!Array.isArray(chapterList) || atIdx < 0) return null;
        const nxt = chapterList[++atIdx];
        return nxt?.body ? { text: nxt.body, title: `${book} — ${nxt.name || nxt.title || ''}`.trim() } : null;
      };
      narrateStart(det.body || '', book, `${book} — ${det.name || ''}`.trim(), _data?.lex, advance);
    });
  });

  // Glossed words. Tap-to-reveal rather than hover-only, because the tablet is
  // used on touch as much as with a mouse and `title=` never fires there.
  _overlay.querySelectorAll('.tos-gloss').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();   // don't let a gloss double as a page tap
      const open = _overlay.querySelector('.tos-gloss-open');
      if (open && open !== el) open.classList.remove('tos-gloss-open');
      el.classList.toggle('tos-gloss-open');
    });
  });

  // Paper-doll parts. Tap-to-reveal for the same reason the glosses above are:
  // `title=` never fires on touch, and this tablet is used with a thumb as often
  // as a mouse. Purely local — no round trip, the detail is already on the payload.

  // ── Alarm reels ──
  // Tap a digit or flick the reel; the centre band is the selection. Scroll is
  // debounced into a snap read so a flick lands on whatever it settles over,
  // which is what makes it feel like a phone rather than a listbox.
  const alarmReels = _overlay.querySelectorAll('[data-al-reel]');
  if (alarmReels.length) {
    const pickFrom = (el) => ({
      h: Number(_overlay.querySelector('[data-al-reel="h"] .tos-al-cell.sel')?.getAttribute('data-al-h') ?? 0),
      m: Number(_overlay.querySelector('[data-al-reel="m"] .tos-al-cell.sel')?.getAttribute('data-al-m') ?? 0),
    });
    const syncPreview = () => {
      const p = pickFrom();
      _alarmPick = p;
      const out = _overlay.querySelector('.tos-al-preview b');
      if (out) out.textContent = `${String(p.h).padStart(2, '0')}:${String(p.m).padStart(2, '0')}`;
    };
    const select = (cell, reel) => {
      reel.querySelectorAll('.tos-al-cell.sel').forEach(o => { o.classList.remove('sel'); o.setAttribute('aria-selected', 'false'); });
      cell.classList.add('sel');
      cell.setAttribute('aria-selected', 'true');
      cell.scrollIntoView({ block: 'center', behavior: 'smooth' });
      sfx(TOS_SELECT_DEF);
      syncPreview();
    };
    for (const reel of alarmReels) {
      // Centre the current selection on first paint, so the reel opens showing
      // the value it holds instead of scrolled to midnight.
      const cur = reel.querySelector('.tos-al-cell.sel');
      if (cur) cur.scrollIntoView({ block: 'center', behavior: 'instant' });

      reel.addEventListener('click', (e) => {
        // A drag ends in a click on whatever cell the pointer came to rest over.
        // Honouring it would yank the reel to that cell and undo the drag, so the
        // first click after a real drag is swallowed.
        if (reel._alDragged) { reel._alDragged = false; return; }
        const cell = e.target.closest('.tos-al-cell');
        if (cell) select(cell, reel);
      });

      // ── Grab and pull the band ──
      // Mouse/pen only (touch already scrolls natively, with better momentum than
      // anything reimplemented here). The snap comes off for the duration, because
      // with `scroll-snap-type: y mandatory` live every scrollTop we write is
      // immediately re-snapped and the reel fights the hand instead of following
      // it. Releasing puts snap back and throws the reel a little further along its
      // last velocity — the browser's own snap catches it and lands it on a value,
      // so there's no easing curve of ours to get wrong.
      let dragY = 0, dragTop = 0, lastY = 0, lastT = 0, vel = 0, dragging = false;
      reel.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch' || e.button !== 0) return;
        dragging = true; reel._alDragged = false;
        dragY = lastY = e.clientY; dragTop = reel.scrollTop;
        lastT = e.timeStamp; vel = 0;
        reel.classList.add('dragging');
        reel.setPointerCapture(e.pointerId);
        e.preventDefault();          // no text selection dragged out of the cells
      });
      reel.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dy = e.clientY - dragY;
        // 3px of slop, so a click with a shaky hand is still a click.
        if (!reel._alDragged && Math.abs(dy) > 3) reel._alDragged = true;
        reel.scrollTop = dragTop - dy;
        const dt = e.timeStamp - lastT;
        if (dt > 0) vel = (e.clientY - lastY) / dt;   // px per ms, sign = drag direction
        lastY = e.clientY; lastT = e.timeStamp;
      });
      const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        reel.classList.remove('dragging');
        if (reel.hasPointerCapture?.(e.pointerId)) reel.releasePointerCapture(e.pointerId);
        // A stale velocity from a drag that stopped and held shouldn't fling.
        const idle = e.timeStamp - lastT > 90;
        const throw_ = (idle || !reel._alDragged) ? 0 : Math.max(-220, Math.min(220, -vel * 110));
        reel.scrollTo({ top: reel.scrollTop + throw_, behavior: 'smooth' });
      };
      reel.addEventListener('pointerup', endDrag);
      reel.addEventListener('pointercancel', endDrag);
      reel.addEventListener('keydown', (e) => {
        const cell = e.target.closest('.tos-al-cell');
        if (!cell) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(cell, reel); }
        if (e.key === 'ArrowDown' && cell.nextElementSibling?.classList.contains('tos-al-cell')) {
          e.preventDefault(); cell.nextElementSibling.focus(); select(cell.nextElementSibling, reel);
        }
        if (e.key === 'ArrowUp' && cell.previousElementSibling?.classList.contains('tos-al-cell')) {
          e.preventDefault(); cell.previousElementSibling.focus(); select(cell.previousElementSibling, reel);
        }
      });
      // Free-scroll: whatever ends up under the band wins.
      let t = null;
      reel.addEventListener('scroll', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const box = reel.getBoundingClientRect();
          const midY = box.top + box.height / 2;
          let best = null, bestD = Infinity;
          for (const c of reel.querySelectorAll('.tos-al-cell')) {
            const r = c.getBoundingClientRect();
            const d2 = Math.abs((r.top + r.height / 2) - midY);
            if (d2 < bestD) { bestD = d2; best = c; }
          }
          if (best && !best.classList.contains('sel')) {
            reel.querySelectorAll('.tos-al-cell.sel').forEach(o => { o.classList.remove('sel'); o.setAttribute('aria-selected', 'false'); });
            best.classList.add('sel');
            best.setAttribute('aria-selected', 'true');
            syncPreview();
          }
        }, 90);
      }, { passive: true });
    }
    const commit = _overlay.querySelector('[data-al-commit]');
    if (commit) commit.addEventListener('click', () => {
      const p = pickFrom();
      _alarmPick = null;   // the server's answer becomes the truth again
      act('alarm', 'set', `${String(p.h).padStart(2, '0')}${String(p.m).padStart(2, '0')}`);
    });
    const clear = _overlay.querySelector('[data-al-clear]');
    if (clear) clear.addEventListener('click', () => { _alarmPick = null; act('alarm', 'clear'); });
  }

  _overlay.querySelectorAll('[data-doll-part]').forEach(el => {
    const show = () => {
      sfx(TOS_SELECT_DEF);
      _overlay.querySelectorAll('.tos-vt-doll-part.sel').forEach(o => o.classList.remove('sel'));
      el.classList.add('sel');
      const slot = _overlay.querySelector('[data-doll-detail-slot]');
      if (slot) slot.textContent = el.getAttribute('data-doll-detail') || '';
    };
    el.addEventListener('click', show);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); }
    });
  });

  // TV channel chips — jump the dial straight to a station. The renderer picks the
  // change up through the `tv_panel` echo, same as the +/- sweep buttons.
  _overlay.querySelectorAll('[data-tv-ch]').forEach(el => {
    el.addEventListener('click', () => {
      sfx(TOS_SELECT_DEF);
      sendCmdSilent(`tablettune ${el.getAttribute('data-tv-ch')}`);
    });
  });

  _overlay.querySelectorAll('[data-nav-app]').forEach(el => {
    el.addEventListener('click', () => {
      if (_suppressTileClick) return; // a drag-reorder just ended; don't also open the app
      // Selection mode: a tap picks the tile instead of opening it.
      if (_tosSelectMode && el.classList.contains('tos-tile')) {
        el.classList.toggle('tos-tile-sel');
        const home = _overlay.querySelector('.tos-home-apps');
        if (home) refreshSelCount(home);
        sfx(TOS_SELECT_DEF);
        return;
      }
      const appId = el.getAttribute('data-nav-app');
      // Music is a native overlay (AMP walkman), not an in-tablet screen. It opens
      // over the still-running tablet (its z-index sits above the chassis — see
      // #musicplayer-panel in styles.css), so the tablet stays put behind it.
      if (appId === 'music') { sfx(TOS_SELECT_DEF); openMusicPlayerPanel(); return; }
      // Map renders inside the tablet again — the standalone bigmap popup is retired,
      // so the Map app IS the city map (one surface, shared with the minimap
      // double-click, which opens the tablet here too — see openTabletToMap).
      if (appId === 'map') { nav('map', null, null); return; }
      nav(appId, null, null);
    });
  });
  // Home-grid tiles are drag-reorderable, and empty space lassoes them into groups
  // (order, membership and colours all cached locally — never sent up).
  const appHome = _overlay.querySelector('.tos-home-apps');
  // A search result is a FILTERED, flattened view — arranging it would splice a
  // partial list back over the saved order and lose apps, so the drag machinery
  // stays out of it entirely.
  if (appHome && !_homeSearchOpen) { wireAppGridDrag(appHome); wireGroupDrag(appHome); wireAppMarquee(appHome); }
  _overlay.querySelectorAll('[data-group-menu]').forEach(el => {
    el.addEventListener('click', () => {
      if (_suppressTileClick || _tosSelectMode) return; // a drag/lasso just ended, or we're picking
      openGroupSheet({ groupId: el.getAttribute('data-group-menu') });
    });
  });
  // ⧉ arms selection mode; the bar it puts up commits or backs out.
  _overlay.querySelector('[data-tos-select]')?.addEventListener('click', () => {
    if (_suppressTileClick) return;
    _tosSelectMode = true;
    sfx(TOS_SELECT_DEF);
    render();
  });
  _overlay.querySelector('[data-sel-cancel]')?.addEventListener('click', () => exitAppSelectMode());
  _overlay.querySelector('[data-sel-group]')?.addEventListener('click', () => {
    const picked = selectedAppTiles(appHome);
    const ids = picked.map(t => t.getAttribute('data-nav-app')).filter(Boolean);
    if (!ids.length) return;   // nothing picked yet — the bar stays up
    // Read the SHAPE off the tiles while they're still on screen — a 2×2 selection
    // has to come back as a 2×2 box, and after the re-render the geometry is gone.
    openGroupSheet({ ids, cols: selectionCols(picked) });
  });
  // Page dots + arrows. Also the drop target that moves an app between pages (see
  // the drag `end` handler), which is why they're live in selection mode too.
  _overlay.querySelectorAll('[data-home-page]').forEach(el => {
    el.addEventListener('click', () => {
      if (_suppressTileClick) return;
      const n = Number(el.getAttribute('data-home-page')) || 0;
      if (n === _homePage) return;
      _homePage = n;
      sfx(TOS_SELECT_DEF);
      render();
    });
  });
  // Horizontal swipe over the grid turns the page — the gesture a paged home screen
  // trains you to expect. Vertical movement wins the tie so this can't hijack a
  // scroll, and a long-press lift (drag-reorder) claims the press before it starts.
  if (appHome) {
    let sw = null;
    appHome.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || _tosSelectMode) return;
      _homeDragLifted = false;
      sw = { x: e.clientX, y: e.clientY, t: Date.now() };
    });
    appHome.addEventListener('pointerup', (e) => {
      if (!sw) return;
      const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
      const fast = Date.now() - sw.t < 600;
      const lifted = _homeDragLifted;
      sw = null;
      if (lifted) return;   // a tile is being rearranged; the pager keeps out of it
      if (!fast || Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      const dots = _overlay.querySelectorAll('.tos-page-dot').length;
      const next = Math.max(0, Math.min(dots - 1, _homePage + (dx < 0 ? 1 : -1)));
      if (next === _homePage || !dots) return;
      _homePage = next;
      sfx(TOS_SELECT_DEF);
      render();
    });
  }
  // A home widget is a shortcut into the app that contributed it.
  _overlay.querySelectorAll('[data-widget-nav]').forEach(el => {
    el.addEventListener('click', () => nav(el.getAttribute('data-widget-nav'), null, null));
  });
  _overlay.querySelector('[data-tos-addapps]')?.addEventListener('click', () => {
    if (_suppressTileClick) return; // a drag just ended; don't also open the sheet
    openAddAppsSheet();
  });
  // Toolbar: find, the widgets toggle, and restoring a stashed app straight out of
  // a search result.
  _overlay.querySelector('[data-home-search]')?.addEventListener('click', () => {
    _homeSearchOpen = true;
    _homeSearch = '';
    sfx(TOS_SELECT_DEF);
    render();
    _overlay.querySelector('[data-home-search-input]')?.focus();
  });
  _overlay.querySelector('[data-home-search-clear]')?.addEventListener('click', () => {
    _homeSearchOpen = false; _homeSearch = '';
    sfx(TOS_SELECT_DEF);
    render();
  });
  const searchInput = _overlay.querySelector('[data-home-search-input]');
  if (searchInput) {
    // Re-render per keystroke (the grid is small and this is all local), keeping the
    // caret because render() rebuilds the node underneath us.
    searchInput.addEventListener('input', () => {
      _homeSearch = searchInput.value || '';
      const pos = searchInput.selectionStart;
      render();
      const again = _overlay.querySelector('[data-home-search-input]');
      if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch {} }
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { _homeSearchOpen = false; _homeSearch = ''; render(); }
    });
  }
  _overlay.querySelector('[data-toggle-widgets]')?.addEventListener('click', () => {
    setWidgetsEnabled(!widgetsEnabled());
    sfx(TOS_SELECT_DEF);
    render();
  });
  _overlay.querySelectorAll('[data-search-restore]').forEach(el => {
    el.addEventListener('click', () => {
      unhideApp(el.getAttribute('data-search-restore'));
      _homeSearch = '';
      sfx(TOS_SELECT_DEF);
      render();
    });
  });
  _overlay.querySelectorAll('[data-back]').forEach(el => {
    // Exactly one level up the history, whatever that was. This is what stops a
    // third-level screen throwing you back to the app root (or, from the root, to
    // Home) instead of to the screen you actually came from.
    el.addEventListener('click', () => navBack());
  });
  _overlay.querySelectorAll('[data-open-cat]').forEach(el => {
    el.addEventListener('click', () => nav(_data.appId, el.getAttribute('data-open-cat'), null));
  });
  // In-app tab strip (renderTosTabs): switch the current app to the tab's screen id.
  _overlay.querySelectorAll('[data-tos-tab]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-tos-tab');
      // Replace, don't push: a tab is a lateral move inside the same screen, so
      // Back should exit the app, not rewind through the tabs you flipped through.
      if (id !== _data?.activeTab) nav(_data.appId, id, null, true);
    });
  });
  // Calendar month arrows: re-nav the app to a specific 'YYYY-MM' via screenId 'month'.
  _overlay.querySelectorAll('[data-cal-month]').forEach(el => {
    el.addEventListener('click', () => nav(_data.appId, 'month', el.getAttribute('data-cal-month')));
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
      // nav() records the list/board we drilled in from, so Back returns THERE and
      // not to the app root — the detail's own breadcrumb is rebuilt from the quest's
      // category and no longer reflects a Job Board / Pilot Contracts origin.
      nav(appId, currentScreen, id);
    });
  });
  _overlay.querySelectorAll('[data-page-nav]').forEach(el => {
    el.addEventListener('click', () => {
      const [appId, screenLabel, pageStr] = el.getAttribute('data-page-nav').split('|');
      nav(appId, screenLabel, `page:${pageStr}`);
    });
  });
  // Corp dashboard paging — client-side (all pages ride in one payload), so just
  // switch the page index and re-render, no round trip.
  _overlay.querySelectorAll('[data-corp-page]').forEach(el => {
    el.addEventListener('click', () => {
      if (el.classList.contains('disabled')) return;
      _tosCorpPage = parseInt(el.getAttribute('data-corp-page'), 10) || 0;
      sfx(TOS_SELECT_DEF);
      render();
    });
  });
  // Codex — opening a section is a nav (each volume is its own payload); opening
  // a chapter is not (the whole volume already arrived), so it's a local switch.
  _overlay.querySelectorAll('[data-codex-section]').forEach(el => {
    el.addEventListener('click', () => nav(_data.appId, el.getAttribute('data-codex-section')));
  });
  _overlay.querySelectorAll('[data-codex-ch]').forEach(el => {
    el.addEventListener('click', () => {
      _tosCodexCh = el.getAttribute('data-codex-ch') || null;
      sfx(TOS_SELECT_DEF);
      render();
      // A chapter is a page of prose: start it at the top, not wherever the
      // contents list happened to be scrolled to.
      _overlay.querySelector('.tos-body')?.scrollTo?.({ top: 0 });
    });
  });
  // Ideology reader paging — client-side (all pages ride in one payload): tab
  // strip switches the page index, a standing row jumps to that order's page.
  _overlay.querySelectorAll('[data-ideo-page]').forEach(el => {
    el.addEventListener('click', () => {
      _tosIdeoPage = parseInt(el.getAttribute('data-ideo-page'), 10) || 0;
      sfx(TOS_SELECT_DEF);
      render();
    });
  });
  _overlay.querySelectorAll('[data-ideo-go]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-ideo-go');
      const idx = (_data?.orders || []).findIndex(o => o.id === id);
      if (idx >= 0) _tosIdeoPage = idx + 1; // +1 past the Overview tab
      sfx(TOS_SELECT_DEF);
      render();
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
  // News weather widget — tap to expand/collapse the 7-day strip in place.
  _overlay.querySelectorAll('[data-weather-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      _newsWeatherOpen = !_newsWeatherOpen;
      sfx(TOS_SELECT_DEF);
      _keepNewsScroll = true;
      render();
    });
  });
  // News headline — tap to pop its full mini-story in a little browser window.
  _overlay.querySelectorAll('[data-news-idx]').forEach(el => {
    el.addEventListener('click', () => {
      sfx(TOS_SELECT_DEF);
      openNewsStory(_newsStories[+el.getAttribute('data-news-idx')]);
    });
  });
  // DEADHEAD terrain: paint the coarse world grid into the canvas underlay. Drawn at ONE PIXEL PER
  // CELL and stretched by CSS (image-rendering:pixelated) — the browser's own scaler does the work,
  // so this stays a few thousand putImageData bytes instead of a few thousand fillRect calls on a
  // 2s poll. The 10% padding matches nx()/ny() so the painted ground lines up with the markers.
  const dhCv = _overlay.querySelector('#tos-dh-canvas');
  if (dhCv && _data?.deadhead?.world) {
    const W = _data.deadhead.world, P = 0.1;
    // Pad the buffer so the map occupies the same inset box the markers are positioned into.
    const pad = (n) => Math.max(1, Math.round(n * P / (1 - 2 * P)));
    const px = pad(W.w), py = pad(W.h);
    dhCv.width = W.w + px * 2; dhCv.height = W.h + py * 2;
    const g = dhCv.getContext('2d');
    const img = g.createImageData(dhCv.width, dhCv.height);
    const put = (x, y, [r, gg, b, a]) => { const i = (y * dhCv.width + x) * 4; img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = a; };
    for (let y = 0; y < W.h; y++) {
      const row = W.rows[y] || '';
      for (let x = 0; x < W.w; x++) put(x + px, y + py, TOS_DH_TERRAIN[row[x]] || TOS_DH_TERRAIN['.']);
    }
    g.putImageData(img, 0, 0);
  }
  // DEADHEAD FIELDS/REGIONS toggle — purely local: the region rectangles are already in the payload,
  // so this flips a flag and re-renders rather than round-tripping to the server for a view change.
  _overlay.querySelectorAll('[data-dh-view]').forEach(el => el.addEventListener('click', () => {
    _dhRegions = el.getAttribute('data-dh-view') === 'regions';
    sfx(TOS_SELECT_DEF); render();
  }));
  // DEADHEAD map — tapping empty space sets a hold point (airfield pips fire their own 'chart'
  // action and are skipped here). Invert the click position back to a world tile via _dhBox.
  const dhMap = _overlay.querySelector('#tos-dh-map');
  if (dhMap && _dhBox) dhMap.addEventListener('click', (e) => {
    if (e.target.closest('[data-act-id]')) return;
    const r = dhMap.getBoundingClientRect(), P = 0.1;
    const inv = (frac, mn, mx) => Math.round(mn + ((frac - P) / (1 - 2 * P)) * (mx - mn));
    const gx = Math.max(_dhBox.minX, Math.min(_dhBox.maxX, inv((e.clientX - r.left) / r.width, _dhBox.minX, _dhBox.maxX)));
    const gy = Math.max(_dhBox.minY, Math.min(_dhBox.maxY, inv((e.clientY - r.top) / r.height, _dhBox.minY, _dhBox.maxY)));
    sfx(TOS_SELECT_DEF);
    act('deadhead', 'loiter', `${gx} ${gy}`);
  });
  _overlay.querySelectorAll('[data-act-id]').forEach(el => {
    el.addEventListener('click', () => {
      const appId = el.getAttribute('data-act-app');
      const actionId = el.getAttribute('data-act-id');
      const confirmText = el.getAttribute('data-act-confirm');
      const promptText = el.getAttribute('data-act-prompt');
      const pickJson = el.getAttribute('data-act-pick');
      const baseParams = el.getAttribute('data-act-params');
      const launchCmd = el.getAttribute('data-act-launch');
      // Folding a corp also drops its now-dead chat channel from the list.
      // Abandoning a quest tosses its action log — it's off the board now.
      const fire = (params) => {
        if (actionId === 'fold') removeCorpChannels();
        if (appId === 'quests' && actionId === 'abandon' && _data?.quest?.id) dropQuestLog(_data.quest.id);
        act(appId, actionId, params);
      };

      // A launch action (Crafting app) hands off to a real game command — the
      // cook/splice minigame or an instant craft — instead of round-tripping the
      // tablet. Close the tablet so the minigame overlay owns the screen, then
      // fire the verb exactly as if the player had typed it.
      if (launchCmd) {
        sfx(TOS_SELECT_DEF);
        close();
        sendCmdSilent(launchCmd);
        return;
      }

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

      // A pick action (corp Invite) offers a list to choose from instead of
      // typing — e.g. the online players you can invite.
      if (pickJson) {
        let options = [];
        try { options = JSON.parse(pickJson); } catch { options = []; }
        showSelectDialog({
          title: 'Invite Player',
          prompt: options.length ? 'Choose a player to invite:' : undefined,
          options,
          empty: 'No other players are online to invite.',
        }, (val) => fire(val));
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
  wireGear();
}

// Map app: one zoom axis (−/+ walk the server tile-window ladder), tap-a-tile to
// select (client-side, refreshes the detail in place), and GPS route / auto-walk
// actions. No-op off the map screen.
function rebuildMap() {
  const root = _overlay.querySelector('#tos-map-root');
  if (root) { root.innerHTML = renderMap(_data); wireMap(); }
}
// Sync the current selection (_tosMapSel) across the map: highlight the matching
// tile and its building-legend name so the two read as one thing, refresh the detail
// panel, and (from a legend click) scroll the tile into the centre of the viewport.
function mapSyncSelection(center) {
  let selTile = null;
  _overlay.querySelectorAll('.tos-map-tile').forEach(el => {
    const on = el.getAttribute('data-map-zone') === _tosMapSel;
    el.classList.toggle('sel', on);
    if (on) selTile = el;
  });
  _overlay.querySelectorAll('.tos-map-bldg').forEach(el =>
    el.classList.toggle('sel', el.getAttribute('data-map-bldg') === _tosMapSel));
  if (center && selTile) _scrollMapTo(selTile);
  const det = _overlay.querySelector('#tos-map-detail');
  if (det) { det.innerHTML = renderMapDetail(_data); wireMapActs(); }
}

// Plot a GPS route from where you stand to a reachable tile (double-click / Route here).
function mapRouteTo(id) {
  const cur = (_data.tiles || []).find(t => t.isCurrent);
  const t = (_data.tiles || []).find(x => x.id === id);
  if (!cur || !t || t.isCurrent || t.reachable === false) return;
  const path = routeBetween(cur.id, id, _data.tiles);
  if (path && path.length > 1) { setGpsRoute(path); rebuildMap(); }
}

// Scroll the map viewport so a given tile element sits centred (mirrors centerMapOnPlayer).
function _scrollMapTo(el) {
  const wrap = _overlay?.querySelector('.tos-map-wrap');
  if (!wrap || !el) return;
  const wr = wrap.getBoundingClientRect(), cr = el.getBoundingClientRect();
  wrap.scrollLeft += (cr.left + cr.width / 2) - (wr.left + wrap.clientWidth / 2);
  wrap.scrollTop += (cr.top + cr.height / 2) - (wr.top + wrap.clientHeight / 2);
}

function wireMap() {
  _overlay.querySelectorAll('[data-map-zone]').forEach(el => {
    // Single tap selects the tile (and lights up its legend name — mapSyncSelection).
    el.addEventListener('click', () => {
      _tosMapSel = el.getAttribute('data-map-zone');
      sfx(TOS_SELECT_DEF);
      mapSyncSelection(false);
    });
    // Double-click a reachable tile to plot a GPS route straight to it, no Route-here trip.
    el.addEventListener('dblclick', () => {
      _tosMapSel = el.getAttribute('data-map-zone');
      mapRouteTo(_tosMapSel);
    });
  });
  // Building legend ↔ tile: clicking a name selects + centres that building.
  _overlay.querySelectorAll('[data-map-bldg]').forEach(el => {
    el.addEventListener('click', () => {
      _tosMapSel = el.getAttribute('data-map-bldg');
      sfx(TOS_SELECT_DEF);
      mapSyncSelection(true);
    });
  });
  wireMapActs();
  const clear = _overlay.querySelector('[data-map-clear]');
  if (clear) clear.addEventListener('click', () => { setGpsRoute(null); rebuildMap(); });
  // Persistent controls: Run (server round-trip, echoes run_state), Auto-walk toggle,
  // recenter-on-you, and the −/+ zoom stepper. Zoom now walks the server ladder (each
  // step = a wider/narrower tile window), so it's a round trip that re-renders the map.
  _overlay.querySelector('[data-map-run]')?.addEventListener('click', () => sendCmdSilent('run'));
  _overlay.querySelector('[data-map-autotoggle]')?.addEventListener('click', () => { toggleAutoWalk(); rebuildMap(); });
  _overlay.querySelector('[data-map-recenter]')?.addEventListener('click', centerMapOnPlayer);
  // Writes the shared `mapOverlay` setting rather than a local flag: applySettings
  // drives window._applyMapOverlay, so the sidebar minimap re-renders in the same
  // beat and the choice survives a reload.
  _overlay.querySelector('[data-map-labels]')?.addEventListener('click', () => {
    const s = loadSettings();
    s.mapOverlay = mapLabelsOn() ? 'none' : 'labels';
    saveSettings(s);
    applySettings(s);
    rebuildMap();
  });
  _overlay.querySelectorAll('[data-map-zoom]').forEach((b) => b.addEventListener('click', () => {
    const arg = _mapZoomArg(_data, b.getAttribute('data-map-zoom') === 'in' ? 1 : -1);
    if (arg) nav('map', arg, null);
  }));
  // Void survey zoom: client-only trail scale (no server round trip), re-render in place.
  _overlay.querySelectorAll('[data-void-zoom]').forEach((b) => b.addEventListener('click', () => {
    const dir = b.getAttribute('data-void-zoom') === 'in' ? 1 : -1;
    _tosVoidZoom = Math.min(VOID_ZMAX, Math.max(VOID_ZMIN, +(_tosVoidZoom + dir * VOID_ZSTEP).toFixed(2)));
    sfx(TOS_SELECT_DEF);
    rebuildMap();
  }));
  // Drag anywhere on the map to scroll it; default to the player centred on (re)build.
  wireMapDrag(_overlay.querySelector('.tos-map-wrap'));
  centerMapOnPlayer();
}

// Scroll the map so the tile you're standing on sits in the middle of the viewport.
// getBoundingClientRect keeps it correct whether the grid is centred (fits) or
// scrolling (overflows). No-op if the current tile isn't rendered.
function centerMapOnPlayer() {
  const wrap = _overlay?.querySelector('.tos-map-wrap');
  const cur = wrap?.querySelector('.tos-map-tile.cur');
  if (!wrap || !cur) return;
  const wr = wrap.getBoundingClientRect(), cr = cur.getBoundingClientRect();
  wrap.scrollLeft += (cr.left + cr.width / 2) - (wr.left + wrap.clientWidth / 2);
  wrap.scrollTop += (cr.top + cr.height / 2) - (wr.top + wrap.clientHeight / 2);
}

// Drag-to-scroll the map viewport. A movement threshold defers the "drag" so a plain
// tap still selects a tile; once dragging, the click that follows pointerup is
// swallowed (capture-phase) so it doesn't also fire a tile selection.
function wireMapDrag(wrap) {
  if (!wrap) return;
  let on = false, moved = false, sx = 0, sy = 0, sl = 0, st = 0, pid = null;
  wrap.addEventListener('pointerdown', (e) => {
    if (e.button && e.button !== 0) return;
    on = true; moved = false; sx = e.clientX; sy = e.clientY;
    sl = wrap.scrollLeft; st = wrap.scrollTop; pid = e.pointerId;
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!on) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!moved && Math.abs(dx) + Math.abs(dy) > 4) {
      moved = true; wrap.classList.add('grabbing');
      try { wrap.setPointerCapture(pid); } catch {}
    }
    if (!moved) return;
    wrap.scrollLeft = sl - dx;
    wrap.scrollTop = st - dy;
  });
  const end = (e) => {
    if (!on) return;
    on = false; wrap.classList.remove('grabbing');
    if (moved) { wrap._suppressClick = true; setTimeout(() => { wrap._suppressClick = false; }, 0); }
    try { wrap.releasePointerCapture(e.pointerId); } catch {}
  };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);
  wrap.addEventListener('click', (e) => {
    if (wrap._suppressClick) { e.stopPropagation(); e.preventDefault(); }
  }, true);
}
function wireMapActs() {
  _overlay.querySelectorAll('[data-map-act]').forEach(el => {
    el.addEventListener('click', () => {
      const a = el.getAttribute('data-map-act');
      sfx(TOS_SELECT_DEF);
      if (a === 'route') {
        mapRouteTo(_tosMapSel);
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
  // Extra Lore — local pref + a silent push to the server, which owns the actual
  // per-player flag the lore plugin reads.
  // Wallpaper choice — per device, on the tablet theme record. Re-renders, which is
  // what restarts the canvas with the new mode and the theme's current colours.
  _overlay.querySelectorAll('[data-set-wallpaper]').forEach(el => {
    el.addEventListener('click', () => {
      sfx(TOS_SELECT_DEF);
      saveWallpaper(el.getAttribute('data-set-wallpaper'));
      render();
    });
  });
  // Home widgets on/off — a per-device preference like the tile order, not a
  // server setting, so it commits to localStorage and re-renders in place.
  _overlay.querySelectorAll('[data-set-widgets]').forEach(el => {
    el.addEventListener('click', () => {
      sfx(TOS_SELECT_DEF);
      setWidgetsEnabled(el.getAttribute('data-set-widgets') === 'on');
      render();
    });
  });
  _overlay.querySelectorAll('[data-set-lore]').forEach(el => {
    el.addEventListener('click', () => {
      sfx(TOS_SELECT_DEF);
      const val = el.getAttribute('data-set-lore');
      const s = loadSettings();
      s.extraLore = val;
      commit(s);
      sendCmdSilent(`lorealways ${val}`);
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
      _chatEmojiOpen = false; // fresh conversation → close the emoji picker
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
      const v = emojifyChat(chatInput.value.trim());
      if (!v) return;
      chatInput.value = ''; // clear before send — sendChatMessage triggers a re-render that snapshots/restores the input value
      sendChatMessage(_chatTab, v);
    };
    chatSend?.addEventListener('click', doSend);
    chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });

    // Live emoji: convert the completed :shortcode:/emoticon just before the caret
    // as you type, in the bar itself. Only touch text up to the caret so text the
    // user hasn't finished typing (and the caret) stay put.
    chatInput.addEventListener('input', () => {
      const caret = chatInput.selectionStart ?? chatInput.value.length;
      const before = chatInput.value.slice(0, caret);
      const after = chatInput.value.slice(caret);
      const conv = emojifyChat(before);
      if (conv === before) return;
      chatInput.value = conv + after;
      const pos = conv.length;
      try { chatInput.setSelectionRange(pos, pos); } catch {}
    });

    // Emoji picker: ☺ toggles the popup; tapping an emoji inserts it at the caret.
    const emojiToggle = _overlay.querySelector('[data-chat-emoji-toggle]');
    const emojiPop = _overlay.querySelector('.tos-chat-emoji-pop');
    emojiToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      _chatEmojiOpen = !_chatEmojiOpen;
      emojiPop?.classList.toggle('open', _chatEmojiOpen);
    });
    _overlay.querySelectorAll('[data-chat-emoji]').forEach(el => {
      el.addEventListener('click', () => {
        const em = el.getAttribute('data-chat-emoji');
        const s = chatInput.selectionStart ?? chatInput.value.length;
        const e2 = chatInput.selectionEnd ?? chatInput.value.length;
        chatInput.value = chatInput.value.slice(0, s) + em + chatInput.value.slice(e2);
        const pos = s + em.length;
        chatInput.focus();
        try { chatInput.setSelectionRange(pos, pos); } catch {}
      });
    });
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

  // Reset the local home-grid arrangement — clears the cached order, groups and
  // stash, so the Home screen re-seeds to the default twelve on its next render.
  // Client-only; brief in-place confirmation rather than a re-render (the grid
  // isn't on this screen).
  _overlay.querySelector('[data-reset-apps]')?.addEventListener('click', (e) => {
    sfx(TOS_SELECT_DEF);
    try {
      localStorage.removeItem(TABLET_APP_ORDER_KEY);
      localStorage.removeItem(TABLET_APP_HIDDEN_KEY);
      localStorage.removeItem(TABLET_APP_GROUPS_KEY);
      localStorage.removeItem(TABLET_HOME_SEED_KEY);   // …so the next render re-seeds the default set
    } catch {}
    const btn = e.currentTarget;
    btn.textContent = '✓ Reset';
    setTimeout(() => { if (btn.isConnected) btn.textContent = 'Reset to Default'; }, 1400);
  });

  // Reset the desktop sidebar's drag order / hidden / collapsed / sized state
  // back to default. resetOrder() operates on the live #sidebar behind the
  // Tablet overlay, so it works while Settings is open. (Ported from the retired
  // settings-panel's ↺ button.)
  _overlay.querySelector('[data-reset-sidebar]')?.addEventListener('click', (e) => {
    sfx(TOS_SELECT_DEF);
    resetOrder();
    const btn = e.currentTarget;
    btn.textContent = '✓ Reset';
    setTimeout(() => { if (btn.isConnected) btn.textContent = 'Reset to Default'; }, 1400);
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
  // Reset all sound settings (toggles + volumes) back to their defaults.
  _overlay.querySelector('[data-reset-sound]')?.addEventListener('click', () => {
    sfx(TOS_SELECT_DEF);
    const s = loadSettings();
    s.audio = { ...DEFAULT_AUDIO_SETTINGS };
    commit(s);
    render();
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

// Void-trip boot cues — only ever heard on the first tablet open of a crossing
// (runVoidFindingSignal / openTabletPanel). VOID_POWER_ON is the "weird different"
// power-on: heavier noise, a slower/uglier sweep than the normal CRT_POWER_ON.
const VOID_POWER_ON_DEF = {
  id: 'tablet_void_power_on', category: 'sfx', priority: 3,
  config: { waveform: 'sawtooth', freq: 44, duration: 0.6, noiseMix: 0.55, pitchBend: { to: 260, time: 0.5 }, filter: { type: 'lowpass', freq: 1800, q: 1.4 }, adsr: { a: 0.01, d: 0.3, s: 0.3, r: 0.28 } },
};
const VOID_CRACKLE_DEF = { // a short noisy burst, timed at random through FINDING SIGNAL
  id: 'tablet_void_crackle', category: 'sfx', priority: 3,
  config: { duration: 0.13, noiseMix: 0.85, waveform: 'square', freq: 220, filter: { type: 'bandpass', freq: 1200, q: 1.4 }, adsr: { a: 0.002, d: 0.05, s: 0.05, r: 0.05 }, gain: 0.09 },
};
const VOID_BOOT_TICK_DEF = { // a dry click per firmware boot line that didn't fail
  id: 'tablet_void_boot_tick', category: 'sfx', priority: 2,
  config: { duration: 0.05, waveform: 'square', freq: 180, noiseMix: 0.3, filter: { type: 'bandpass', freq: 900, q: 1.1 }, adsr: { a: 0.001, d: 0.02, s: 0.02, r: 0.02 }, gain: 0.05 },
};
const VOID_SIGNAL_FOUND_DEF = { // the "lock" chime the instant the weak carrier locks
  id: 'tablet_void_signal_found', category: 'sfx', priority: 4,
  config: { duration: 0.24, layers: [
    { waveform: 'sine', freq: 340, pitchBend: { to: 880, time: 0.16 }, filter: { type: 'lowpass', freq: 2600, q: 0.7 }, adsr: { a: 0.005, d: 0.15, s: 0.1, r: 0.09 }, gain: 0.09 },
  ] },
};

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

// ── FM-synth cues for the fake ARCHITECT arcade app ──────────────────────────
// A metallic little voice for the "game inside the game": every layer drives a
// modulator into the carrier's frequency (fm:{rate,depth}) for that DX-era
// inharmonic clang the plain UI beeps deliberately avoid. Kept low-gain so the
// toy stays a toy under the real tablet chrome.
const FK_JACK_DEF = { // JACK IN → uplink handshake: a rising FM zap that "connects"
  id: 'fk_jack', category: 'sfx', priority: 4,
  config: { duration: 0.34, layers: [
    { waveform: 'sine', freq: 170, pitchBend: { to: 420, time: 0.22 }, fm: { rate: 43, depth: 220 },
      filter: { type: 'lowpass', freq: 2600, q: 0.7 }, adsr: { a: 0.006, d: 0.16, s: 0.25, r: 0.12 }, gain: 0.085 },
  ] },
};
const FK_BOOT_DEF = { // one per boot line: a short bright FM data-blip
  id: 'fk_boot', category: 'sfx', priority: 3,
  config: { duration: 0.06, layers: [
    { waveform: 'sine', freq: 880, fm: { rate: 1760, depth: 340 },
      filter: { type: 'bandpass', freq: 1800, q: 1.2 }, adsr: { a: 0.002, d: 0.05, s: 0, r: 0.02 }, gain: 0.06 },
  ] },
};
const FK_KEY_DEF = { // command chip / Enter: a crisp FM keyclick
  id: 'fk_key', category: 'sfx', priority: 3,
  config: { duration: 0.045, layers: [
    { waveform: 'square', freq: 1250, fm: { rate: 3100, depth: 420 },
      filter: { type: 'lowpass', freq: 3200, q: 0.5 }, adsr: { a: 0.001, d: 0.04, s: 0, r: 0.015 }, gain: 0.05 },
  ] },
};
const FK_OPEN_DEF = { // pop the mini-tablet: a bell-ish FM swell up
  id: 'fk_open', category: 'sfx', priority: 4,
  config: { duration: 0.22, layers: [
    { waveform: 'sine', freq: 300, pitchBend: { to: 620, time: 0.16 }, fm: { rate: 210, depth: 150 },
      filter: { type: 'lowpass', freq: 2400, q: 0.7 }, adsr: { a: 0.01, d: 0.14, s: 0.1, r: 0.08 }, gain: 0.075 },
  ] },
};
const FK_DENY_DEF = { // "not installed": a sour, dissonant FM buzz-down
  id: 'fk_deny', category: 'sfx', priority: 4,
  config: { duration: 0.2, layers: [
    { waveform: 'square', freq: 300, pitchBend: { to: 150, time: 0.16 }, fm: { rate: 450, depth: 300 },
      filter: { type: 'lowpass', freq: 1400, q: 0.9 }, adsr: { a: 0.004, d: 0.12, s: 0.2, r: 0.07 }, gain: 0.07 },
  ] },
};
const FK_DIVE_DEF = { // ARCHITECT-into-ARCHITECT: the "all the way down" fall — an
  id: 'fk_dive', category: 'sfx', priority: 5, // echoing FM tone sliding into the well
  config: { duration: 0.5, layers: [
    { waveform: 'sine', freq: 560, pitchBend: { to: 110, time: 0.42 }, fm: { rate: 280, depth: 260 },
      filter: { type: 'lowpass', freq: 2200, q: 0.8 }, echo: { mix: 0.28, delay: 0.11, feedback: 0.42 },
      adsr: { a: 0.005, d: 0.3, s: 0.15, r: 0.18 }, gain: 0.085 },
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
  // Consume the one-shot boot-skip flag on every open so it can't leak into a
  // later normal open (it only actually changes anything on a first/fresh open).
  const skip = _skipBoot; _skipBoot = false;
  // First tablet open of a void crossing gets the FINDING SIGNAL ritual instead of
  // the normal boot-and-done; every later open this same crossing (or any open
  // while already on the grid) is a normal open. Consumed unconditionally the
  // moment we're off-grid — even a skip-open "arrives" and uses up the trip's intro,
  // so a later full open doesn't suddenly surprise-fire it mid-crossing.
  const voidIntro = !skip && isOnCrossing() && !_voidTripPrimed;
  if (isOnCrossing()) {
    _voidTripPrimed = true;
    // Off-grid and no carrier locked yet (fresh crossing, or a skip-open that never
    // played the firmware boot) → the OS comes up SEARCHING until you move it.
    if (!_voidLocked) _voidSearching = true;
  }

  // Keep the Settings screen's MIS toggle in step with the server (player_update
  // dispatches mis_state_update). Bound once; harmless when Settings isn't shown.
  if (!_tosMisListenerBound) {
    _tosMisListenerBound = true;
    document.addEventListener('mis_state_update', (e) => tosApplyMis(e.detail?.enabled, e.detail?.server_disabled));
  }

  // Reuse the live overlay only if it's still in the DOM. mountOverlay's own ESC
  // handler can tear the node out (calling our onClose) without our close() path
  // running — if we didn't also null _overlay there, a stale detached reference
  // would make every later open render into nothing until a page refresh. Guard
  // on isConnected so a detached _overlay is treated as closed and rebuilt.
  if (_overlay && !_overlay.isConnected) { close(); }

  if (!_overlay) {
    // "Inv" shortcut (and any other fast-open path) skips the CRT power-on + boot
    // hold: no powering-on animation, no boot screen, render the real screen at once.
    const html = `<div class="tos-anchor"><div class="tos-panel mg-chassis${skip ? '' : ' tos-powering-on'}">
      ${deviceHeader('&#9635;', 'ARCHITECT OS', 'Tablet Interface')}
      <div class="tos-bezel mg-bezel">${bezelScrews()}<div class="tos-screen mg-screen" style="--mg-sweep-h:420px" id="tos-screen-inner">
        <canvas class="tos-wall" id="tos-wall"></canvas>
        <div class="tos-scroll" id="tos-scroll">
          ${skip ? '' : '<div class="tos-boot" id="tos-boot"><div class="tos-boot-logo">A</div><div class="tos-boot-title">ARCHITECT OS</div><div class="tos-boot-sub">Booting Tablet Interface&hellip;</div></div>'}
        </div>
        ${crtOverlays()}
        <div class="tos-void-static"></div>
        <div class="tos-void-hunt">◈ Searching for signal — move the tablet</div>
      </div></div>
    </div></div>`;
    // onClose runs whenever the overlay is torn down by ANY path (including
    // mountOverlay's ESC handler, which bypasses our shutdownTablet/close). Route
    // it through close() so _overlay is always nulled — otherwise the next open
    // reuses a dead reference and the tablet silently fails to appear.
    const mounted = mountOverlay({ id: 'tablet-os-overlay', html, onClose: () => { close(); }, closeOnBackdrop: false });
    _overlay = mounted.overlay;
    _close = mounted.close;
    _overlay.querySelector('.mg-close').addEventListener('click', shutdownTablet);
    makeDraggable(_overlay.querySelector('.tos-anchor'), _overlay.querySelector('.mg-head'));
    wireDragScroll(_overlay.querySelector('#tos-scroll'));
    applyTabletTheme();
    _applyWidgetChrome();
    window.AudioEngine?.init?.();
    if (skip) {
      render(); // straight to content, no boot ceremony
    } else if (voidIntro) {
      // Weird, harsher power-on this once, then straight into FINDING SIGNAL
      // instead of the usual boot-and-done — see runVoidFindingSignal.
      window.AudioEngine?.playSfx(VOID_POWER_ON_DEF);
      setTimeout(runVoidFirmwareBoot, CRT_ANIM_MS);
    } else {
      window.AudioEngine?.playSfx(CRT_POWER_ON_DEF);
      // CRT expands (0.6s), "ARCHITECT OS" holds for ~1s, then the real screen
      // (home, or whatever screen this open navigated straight to) renders in.
      setTimeout(render, CRT_ANIM_MS + BOOT_HOLD_MS);
    }
    return;
  }
  render();
}

// Smart bar "Inv" shortcut: open the tablet straight to the Gear app's Inventory
// tab with no CRT boot delay. Sets the client-side tab + boot-skip flag, then asks
// the server for the gear screen (a tablet_panel message, which opens the shell).
export function openTabletToInventory() {
  _gearTab = 'inventory';
  _skipBoot = true;
  sendCmdSilent('tabletnav gear');
}

// Open the tablet Gear app on the Loadout tab (the paperdoll) — the replacement
// for the retired desktop `#gear-panel`. Same skip-boot fast-path as Inventory.
export function openTabletToLoadout() {
  _gearTab = 'loadout';
  _skipBoot = true;
  sendCmdSilent('tabletnav gear');
}

// Open the tablet straight to the Map app — the single city-map surface now that
// the standalone bigmap popup is retired. The minimap double-click routes here (via
// the injected opener in minimap.js) and the typed `map` command lands here too (see
// dispatch.js). Skip-boot for a snappy open. `arg` carries an optional zoom stop.
export function openTabletToMap(arg) {
  _skipBoot = true;
  sendCmdSilent('tabletnav map' + (arg ? ' ' + arg : ''));
}

// If the tablet is open on the Map app, silently re-fetch it at the current zoom so
// the "you are here" marker + window follow the player as they move (the replacement
// for the retired popup's refreshMapIfOpen). Returns whether it refreshed.
export function refreshTabletMapIfOpen() {
  if (_overlay && _overlay.isConnected && _data?.appId === 'map' && _data?.view === 'map') {
    sendCmdSilent('tabletnav map ' + _tosMapZoomArg(_data));
    return true;
  }
  return false;
}

// Open the tablet Quests app straight to a specific quest's detail screen — used
// when a locked ("finish the job first") turn-in option in an NPC dialogue is
// tapped, so the player lands on the objectives instead of a dead button. The
// quest detail is keyed purely by the id param (quests-app buildScreen), so any
// non-board screen token works ('active' keeps the normal category breadcrumb).
export function openTabletToQuest(questId) {
  if (!questId) return;
  _skipBoot = true;
  sendCmdSilent(`tabletnav quests active ${questId}`);
}

// Open the tablet straight to the Quests app root (the category/quest list) — the
// smartbar "Quests" anchor beside "Inv". Skip-boot for a snappy open, same as the
// other deep-links.
export function openTabletToQuests() {
  _skipBoot = true;
  sendCmdSilent('tabletnav quests');
}

// If the tablet is open on the Gear app, silently re-fetch it so an equip/unequip
// that happened elsewhere (a typed command, a macro, a script) reflects on the
// paperdoll. Returns whether it refreshed, so the caller can fall back to printing
// the feedback line when the Gear screen isn't up.
export function refreshTabletGearIfOpen() {
  if (_overlay && _overlay.isConnected && _data?.appId === 'gear') {
    sendCmdSilent('tabletnav gear');
    return true;
  }
  return false;
}

// Open the tablet straight to the Chat app — the replacement for toggling the
// floating whisper window. The sidebar 💬 bubble routes here. Skip-boot for a
// snappy open, same as the other deep-links.
export function openTabletToChat() {
  _skipBoot = true;
  sendCmdSilent('tabletnav chat');
}

// ── SPECTER entry points (replace the retired surveillancehub.js / datachipreplay.js
// / specterinstall.js popups; the surveillance plugin is untouched) ─────────────

// Open the tablet Surveillance (SPECTER) app on its live hub — the replacement for
// the standalone `#shub-panel`. Fired when the server would have pushed a
// surveillance_hub (i.e. on `hub` / `use spy_deck`).
export function openTabletToSpecter() {
  _skipBoot = true;
  sendCmdSilent('tabletnav specter');
}

// Play a datachip clip in the tablet's own reel viewer. The server already
// authorised this (the player is carrying the chip) and hands us the full frames,
// so we render the payload directly rather than re-fetching through the owner-gated
// Microreels path — that keeps replay working for traded/found evidence chips whose
// clip the viewer doesn't own. Mirrors the retired datachipreplay.js overlay.
export function openTabletToReel(clip) {
  if (!clip) return;
  _skipBoot = true;
  openTabletPanel({
    type: 'tablet_panel', screen: 'app',
    appId: 'specter', appName: 'Surveillance',
    view: 'reel',
    breadcrumb: ['Surveillance', 'Microreels', clip.zone || 'UNKNOWN'],
    reel: clip,
  });
}

// The SPECTER firmware-install ceremony, folded into the tablet shell. The install
// already happened server-side (the flag is set, the program burned) before the
// `specter_install` push arrives; this is purely the cosmetic flash. We open the
// tablet straight to Surveillance and overlay a firmware-flasher inside the CRT
// screen, then fade it to reveal the (now-installed) hub underneath. Ported from
// the retired specterinstall.js, retinted to the tablet's own accent tokens.
export function openTabletSpecterInstall(msg) {
  openTabletToSpecter();          // tablet → Surveillance (installed) underneath
  mountSpecterInstallFlash(msg, 0);
}

const SI_LOG_LINES = [
  { t: '> mounting firmware image … SPECTER-6.rom', c: '' },
  { t: '> handshake … vendor:GHOST  sig:0x9F3A-BADC0DE', c: '' },
  { t: '> bypassing tablet signature check', c: 'warn' },
  { t: '  [OK] bootloader unlocked', c: 'ok' },
  { t: '> erasing partition tos.specter …', c: '' },
  { t: '  wiping blocks 0x0000 … 0x7FFF', c: '' },
  { t: '> writing firmware image', c: '' },
  { t: '  ####################  hash verify … PASS', c: 'ok' },
  { t: '> patching Tablet OS app registry', c: '' },
  { t: '  + specter.app  + hooks:surveillance', c: '' },
  { t: '> injecting counter-forensics stub', c: 'warn' },
  { t: '  scrubbing install trace …', c: '' },
  { t: '> sealing firmware … reboot daemon', c: '' },
  { t: '  [OK] SPECTER online', c: 'ok' },
];
const SI_STAGES = ['ERASING', 'WRITING BLOCKS', 'VERIFYING', 'PATCHING TABLET OS', 'FINALIZING'];

function ensureSpecterInstallStyles() {
  if (document.getElementById('tos-si-styles')) return;
  const s = document.createElement('style');
  s.id = 'tos-si-styles';
  s.textContent = `
    #tablet-os-overlay .tos-si { position:absolute; inset:0; z-index:60; display:flex; flex-direction:column; padding:16px 17px;
      background:radial-gradient(120% 120% at 50% 35%, color-mix(in srgb, var(--mg-accent) 12%, #03070a), #02050700 140%), #03070a;
      color:var(--mg-accent); font-family:var(--font-mono,'Courier New',monospace); text-shadow:0 0 5px color-mix(in srgb,var(--mg-accent) 45%,transparent);
      opacity:0; transition:opacity .3s; }
    #tablet-os-overlay .tos-si.on { opacity:1; }
    #tablet-os-overlay .tos-si.si-glitch { animation:tos-si-glitch .18s steps(2) 3; }
    @keyframes tos-si-glitch { 0%{transform:translate(0,0)} 25%{transform:translate(-2px,1px)} 50%{transform:translate(2px,-1px)} 75%{transform:translate(-1px,0)} 100%{transform:translate(0,0)} }
    #tablet-os-overlay .tos-si-hdr { display:flex; justify-content:space-between; align-items:baseline; font-size:11px; letter-spacing:2px; text-transform:uppercase;
      border-bottom:1px solid color-mix(in srgb,var(--mg-accent) 30%,transparent); padding-bottom:6px; margin-bottom:8px; }
    #tablet-os-overlay .tos-si-hdr b { font-size:13px; }
    #tablet-os-overlay .tos-si-log { flex:1; overflow:hidden; font-size:11px; line-height:1.42; white-space:pre-wrap; }
    #tablet-os-overlay .tos-si-log .warn { color:#ffd85a; text-shadow:0 0 5px rgba(255,216,90,0.4); }
    #tablet-os-overlay .tos-si-log .ok { color:color-mix(in srgb,var(--mg-accent) 70%,#fff); }
    #tablet-os-overlay .tos-si-stage { margin-top:8px; font-size:10px; letter-spacing:2px; text-transform:uppercase; opacity:.8; min-height:13px; }
    #tablet-os-overlay .tos-si-barwrap { margin-top:6px; height:14px; border:1px solid color-mix(in srgb,var(--mg-accent) 40%,transparent); border-radius:3px; overflow:hidden; }
    #tablet-os-overlay .tos-si-bar { height:100%; width:0%; background:var(--mg-accent); box-shadow:0 0 12px color-mix(in srgb,var(--mg-accent) 70%,transparent); transition:width .18s linear; }
    #tablet-os-overlay .tos-si-pct { text-align:right; font-size:10px; margin-top:3px; letter-spacing:1px; opacity:.85; }
    #tablet-os-overlay .tos-si-done { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px;
      background:radial-gradient(80% 80% at 50% 45%, color-mix(in srgb,var(--mg-accent) 16%,#02110b), rgba(2,8,6,0.97)); opacity:0; pointer-events:none; transition:opacity .4s; }
    #tablet-os-overlay .tos-si.done .tos-si-done { opacity:1; pointer-events:auto; }
    #tablet-os-overlay .tos-si-check { font-size:40px; text-shadow:0 0 18px color-mix(in srgb,var(--mg-accent) 80%,transparent); animation:tos-si-pop .5s cubic-bezier(.2,1.4,.4,1); }
    @keyframes tos-si-pop { 0%{transform:scale(0.3);opacity:0} 100%{transform:scale(1);opacity:1} }
    #tablet-os-overlay .tos-si-title { font-size:16px; letter-spacing:3px; }
    #tablet-os-overlay .tos-si-sub { font-size:11px; letter-spacing:1px; opacity:.75; }
    #tablet-os-overlay .tos-si-close { margin-top:6px; cursor:pointer; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#03110b;
      background:var(--mg-accent); border:none; border-radius:4px; padding:8px 18px; }
    #tablet-os-overlay .tos-si-skip { position:absolute; bottom:9px; right:14px; font-size:9px; letter-spacing:1px; opacity:.4; }
  `;
  document.head.appendChild(s);
}

// Mount the flasher inside the tablet's CRT screen once the shell exists (the
// tabletnav open is async, so retry briefly). Self-removes when done or dismissed.
function mountSpecterInstallFlash(msg, tries) {
  const screen = _overlay?.querySelector('#tos-screen-inner');
  if (!screen) {
    if (tries > 40) return;   // ~2s — give up quietly; the install already succeeded
    setTimeout(() => mountSpecterInstallFlash(msg, tries + 1), 50);
    return;
  }
  if (screen.querySelector('.tos-si')) return;   // already flashing
  ensureSpecterInstallStyles();

  const item = (msg && msg.item) ? String(msg.item).replace(/[<>&]/g, '') : 'FIRMWARE DRIVE';
  const layer = document.createElement('div');
  layer.className = 'tos-si';
  layer.innerHTML = `
    <div class="tos-si-hdr"><b>SPECTER FLASHER</b><span>fw 6.0 · ${item}</span></div>
    <div class="tos-si-log"></div>
    <div class="tos-si-stage">AWAITING MEDIA…</div>
    <div class="tos-si-barwrap"><div class="tos-si-bar"></div></div>
    <div class="tos-si-pct">0%</div>
    <div class="tos-si-skip">esc / tap to skip</div>
    <div class="tos-si-done">
      <div class="tos-si-check">✓</div>
      <div class="tos-si-title">SPECTER INSTALLED</div>
      <div class="tos-si-sub">Surveillance is now on your tablet.</div>
      <button class="tos-si-close">Done</button>
    </div>`;
  screen.appendChild(layer);

  const logEl = layer.querySelector('.tos-si-log');
  const barEl = layer.querySelector('.tos-si-bar');
  const pctEl = layer.querySelector('.tos-si-pct');
  const stageEl = layer.querySelector('.tos-si-stage');

  const timers = [];
  const after = (ms, fn) => timers.push(setTimeout(fn, ms));
  const done = () => { timers.forEach(clearTimeout); layer.remove(); };   // fade already showed the hub
  layer.querySelector('.tos-si-close').addEventListener('click', done);
  layer.addEventListener('click', e => { if (e.target === layer) done(); });

  requestAnimationFrame(() => layer.classList.add('on'));
  after(120, () => layer.classList.add('si-glitch'));
  window.AudioEngine?.init?.();

  const flashStart = 350, flashDur = 2800;
  SI_LOG_LINES.forEach((ln, i) => {
    after(flashStart + Math.round((i / SI_LOG_LINES.length) * flashDur), () => {
      const div = document.createElement('div');
      if (ln.c) div.className = ln.c;
      div.textContent = ln.t;
      logEl.appendChild(div);
      logEl.scrollTop = logEl.scrollHeight;
    });
  });
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    after(flashStart + Math.round((i / steps) * flashDur), () => {
      const pct = Math.round((i / steps) * 100);
      barEl.style.width = pct + '%';
      pctEl.textContent = pct + '%';
      stageEl.textContent = SI_STAGES[Math.min(SI_STAGES.length - 1, Math.floor((i / steps) * SI_STAGES.length))];
    });
  }
  after(flashStart + flashDur + 220, () => layer.classList.add('done'));
  after(flashStart + flashDur + 4200, done);   // auto-dismiss backstop
}

// Read-only snapshot of the last-loaded inventory payload (populated when the
// player opens their Gear/Inventory). Used by smartbar macros for item-action
// hints and "do I have X" checks. It's a snapshot, not a live mirror — empty
// until the tablet gear screen has been fetched at least once this session.
export function getTabletInventory() {
  return _data?.inventory || [];
}

// ── Arcade app: "ARCHITECT" (a fake game inside the game) ────────────────────
// Everything below runs client-side against #tos-fake-root. Login → boot lines
// → a tiny live MUD terminal (canned room + ambient ticker + local command
// echo), with a tablet you can tap that pops a shrunk recreation of this very
// tablet (a tappable-but-inert home grid). No server round trips.

const FK_AMBIENT = [
  'Rain ticks off the corrugated awning overhead.',
  'A delivery drone whines past, low and overloaded.',
  'Somewhere below, a bassline thuds through the pavement.',
  'A vendor two stalls down screams the price of synth-noodles.',
  'The neon sign above you flickers: OPE— —PEN — OPEN.',
  'A stray dog eyes your boots, thinks better of it, moves on.',
  'Static crackles from a dead payphone. It almost sounds like a name.',
  'Your breath fogs. The Architect is watching, probably.',
  'A cop-drone sweeps the alley mouth with a red eye, then loses interest.',
];

// Mini-tablet home grid — a recreation of the real app roster (labels + icons).
const FK_MINI_APPS = [
  { ic: '📋', nm: 'Quests' }, { ic: '📊', nm: 'Skills' }, { ic: '💰', nm: 'Bank' },
  { ic: '⛅', nm: 'Weather' }, { ic: '🗺️', nm: 'Map' }, { ic: '🚗', nm: 'Vehicles' },
  { ic: '🏠', nm: 'Property' }, { ic: '💬', nm: 'Chat' }, { ic: '📡', nm: 'SPECTER' },
  { ic: '📰', nm: 'News' }, { ic: '🏢', nm: 'Corp' }, { ic: '🎮', nm: 'ARCHITECT' },
];

function mountFakePlay() {
  const root = _overlay && _overlay.querySelector('#tos-fake-root');
  if (!root) return;
  if (_fakeTimer) { clearInterval(_fakeTimer); _fakeTimer = null; }
  const handle = (_data && _data.handle) || 'operative';
  fkShowLogin(root, handle);
}

function fkShowLogin(root, handle) {
  root.innerHTML = `
    <div class="tos-fk-login">
      <div class="tos-fk-logo">ARCHITECT</div>
      <div class="tos-fk-tag">a post-singularity MUD</div>
      <div class="tos-fk-field"><label>Handle</label><input id="tos-fk-handle" type="text" value="${esc(handle)}" spellcheck="false" autocomplete="off"></div>
      <div class="tos-fk-field"><label>Passkey</label><input id="tos-fk-pass" type="password" value="hunter2" spellcheck="false" autocomplete="off"></div>
      <div class="tos-fk-jack" id="tos-fk-jack">JACK IN <span class="tos-fk-cur">▊</span></div>
    </div>`;
  const jack = root.querySelector('#tos-fk-jack');
  const pass = root.querySelector('#tos-fk-pass');
  const go = () => { sfx(FK_JACK_DEF); fkBoot(root, root.querySelector('#tos-fk-handle').value.trim() || handle); };
  jack.addEventListener('click', go);
  pass.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}

function fkBoot(root, handle) {
  const lines = [
    'Establishing uplink to grid node 7…',
    'Handshake … <span class="ok">OK</span>',
    'Authenticating operative … <span class="ok">OK</span>',
    'Decrypting neural profile …',
    'Loading world state … 41,982 rooms',
    'Reticulating splines …',
    `Welcome back, <span class="ok">${esc(handle)}</span>.`,
  ];
  root.innerHTML = `<div class="tos-fk-boot" id="tos-fk-boot"></div>`;
  const box = root.querySelector('#tos-fk-boot');
  let i = 0;
  const tick = () => {
    if (!_overlay || !_overlay.contains(box)) return; // torn down mid-boot
    if (i < lines.length) {
      const div = document.createElement('div');
      div.innerHTML = '&gt; ' + lines[i++];
      box.appendChild(div);
      sfx(FK_BOOT_DEF);
      setTimeout(tick, 260 + Math.floor(Math.random() * 220));
    } else {
      setTimeout(() => { if (_overlay && _overlay.contains(box)) fkShowTerm(root, handle); }, 520);
    }
  };
  tick();
}

function fkShowTerm(root, handle) {
  const chips = ['inv','gear','stats','skills','who','help','tablet','map','music']
    .map(c => `<span class="tos-fk-chip" data-fk-chip="${c}">${c}</span>`).join('');
  root.innerHTML = `
    <div class="tos-fk-term">
      <div class="tos-fk-hud">
        <span class="hp">HP <b>178/178</b></span><span>SAN <b>100</b></span>
        <span>STA <b>100</b></span><span class="cr">₵ <b>10,555</b></span><span class="wt">WANTED <b>✦✦</b></span>
      </div>
      <div class="tos-fk-log" id="tos-fk-log"></div>
      <div class="tos-fk-tabbtn" id="tos-fk-tabbtn">📱 TABLET</div>
      <div class="tos-fk-chips">${chips}</div>
      <div class="tos-fk-inrow">
        <span class="tos-fk-prompt">&gt;</span>
        <input class="tos-fk-in" id="tos-fk-in" type="text" spellcheck="false" autocomplete="off" placeholder="Type a command...">
      </div>
    </div>`;
  const log = root.querySelector('#tos-fk-log');
  const push = (html, cls) => {
    const div = document.createElement('div');
    div.className = 'tos-fk-line' + (cls ? ' ' + cls : '');
    div.innerHTML = html;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  };
  const openMini = () => fkOpenMini(root);

  fkRoomLook(push);

  const ambient = () => {
    if (!_overlay || !_overlay.contains(log)) { clearInterval(_fakeTimer); _fakeTimer = null; return; }
    push(FK_AMBIENT[Math.floor(Math.random() * FK_AMBIENT.length)], 'tos-fk-amb');
  };
  if (_fakeTimer) clearInterval(_fakeTimer);
  _fakeTimer = setInterval(ambient, 6500);

  root.querySelector('#tos-fk-tabbtn').addEventListener('click', openMini);
  // Any underlined noun tagged data-fk-buzz opens the tablet; chips run as commands.
  const wireLinks = () => root.querySelectorAll('[data-fk-buzz]').forEach(el => {
    if (el._wired) return; el._wired = true;
    el.addEventListener('click', openMini);
  });
  wireLinks();
  root.querySelectorAll('[data-fk-chip]').forEach(el => {
    el.addEventListener('click', () => {
      const c = el.getAttribute('data-fk-chip');
      sfx(FK_KEY_DEF);
      push('&gt; ' + c, 'tos-fk-echo');
      fkRespond(c, push, openMini);
    });
  });

  const input = root.querySelector('#tos-fk-in');
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const cmd = input.value.trim();
    input.value = '';
    if (!cmd) return;
    sfx(FK_KEY_DEF);
    push('&gt; ' + esc(cmd), 'tos-fk-echo');
    fkRespond(cmd, push, openMini);
    wireLinks();
  });
  setTimeout(() => { if (_overlay && _overlay.contains(input)) input.focus(); }, 30);
}

// The opening room look — mirrors the real game's look-pane structure: bold
// accent room name + [SAFE] badge, italic district line, description with inline
// nouns, then Furniture / NPCs / Exits / Buildings lines in the game palette.
function fkRoomLook(push) {
  push('RUST ALLEY<span class="tos-fk-safe">SAFE</span>', 'tos-fk-room');
  push('· the Neon Quarter ·', 'tos-fk-dist');
  push('A knife-thin gap between two data-towers, floored in wet concrete and older promises. '
     + 'Steam breathes up from a grate. A cracked ad-panel loops a smiling face that hasn\'t existed '
     + 'in years. A <span class="tos-fk-furn" data-fk-buzz>camera</span> watches, unblinking.', 'tos-fk-desc');
  push('<span class="tos-fk-label">Furniture:</span> <span class="tos-fk-furn">A Dead Ad-Panel</span>, '
     + '<span class="tos-fk-furn">A Steam Grate</span>, <span class="tos-fk-furn">Street Lights</span> '
     + '<span class="tos-fk-label">(off)</span>');
  push('<span class="tos-fk-label">NPCs here:</span> <span class="tos-fk-npc">Sully</span>, '
     + '<span class="tos-fk-npc">A Twitching Junkie</span>');
  push('<span class="tos-fk-label">Exits:</span> <span class="tos-fk-dir">[North]</span> '
     + '<span class="tos-fk-exit">The Loading Bay</span>, <span class="tos-fk-dir">[East]</span> '
     + '<span class="tos-fk-exit">The Threshold</span>, <span class="tos-fk-dir">[Down]</span> '
     + '<span class="tos-fk-exit">Drainage Sub-Level</span>');
  push('<span class="tos-fk-label">Buildings:</span> <span class="tos-fk-dir">[In]</span> '
     + '<span class="tos-fk-build">Embassy Hotel &amp; Bar</span>');
  push('Your tablet buzzes in your pocket. <span class="tos-fk-buzz" data-fk-buzz>[check it]</span>', 'tos-fk-sys');
}

function fkRespond(cmd, push, openMini) {
  const c = cmd.toLowerCase();
  const first = c.split(/\s+/)[0];
  if (['n','s','e','w','north','south','east','west','u','d','up','down','go'].includes(first)) {
    push('You slip deeper into the Quarter. The walls lean closer.', 'tos-fk-desc');
    push('DRAINAGE SUB-LEVEL', 'tos-fk-room');
    push('· the Neon Quarter ·', 'tos-fk-dist');
    push('Ankle-deep runoff. Something with too many legs skitters away from your light.', 'tos-fk-desc');
    push('<span class="tos-fk-label">Exits:</span> <span class="tos-fk-dir">[Up]</span> '
       + '<span class="tos-fk-exit">Rust Alley</span>');
  } else if (first === 'look' || first === 'l') {
    fkRoomLook(push);
  } else if (first === 'inventory' || first === 'i' || first === 'inv') {
    push('<span class="tos-fk-label">You are carrying:</span> a dented tablet, half a synth-noodle, '
       + '<span class="tos-fk-furn">a rusted pipe</span>, ₵10,555, and a bad feeling.', 'tos-fk-desc');
  } else if (first === 'gear') {
    push('<span class="tos-fk-label">Worn:</span> a stained longcoat, cracked goggles, one good boot.', 'tos-fk-desc');
  } else if (first === 'stats' || first === 'skills') {
    push('<span class="tos-fk-label">Brawn</span> 4 · <span class="tos-fk-label">Reflexes</span> 6 · '
       + '<span class="tos-fk-label">Brains</span> 5 · <span class="tos-fk-label">Cool</span> 7. Good enough for government work.', 'tos-fk-desc');
  } else if (first === 'who') {
    push('<span class="tos-fk-label">Online:</span> <span class="tos-fk-npc">you</span>, and the machine, always.', 'tos-fk-desc');
  } else if (first === 'map') {
    push('The map is a rumour. Open your tablet for the real one — oh, wait.', 'tos-fk-amb');
  } else if (first === 'music') {
    push('A synth drone fades up from nowhere. It knows what you did.', 'tos-fk-amb');
  } else if (first === 'tablet' || first === 'os') {
    push('You pull out your tablet.', 'tos-fk-sys');
    openMini();
  } else if (first === 'help') {
    push('Try: look, north, inv, gear, stats, who, tablet, quit. (It\'s a demo. Be gentle.)', 'tos-fk-sys');
  } else if (first === 'quit' || first === 'logout' || first === 'exit') {
    push('There is no escape. You are already inside the tablet, inside the game, inside the tablet.', 'tos-fk-sys');
  } else {
    push(`You can't "${esc(first)}" here — and honestly, this is a game inside a tablet inside a game. Cut it some slack.`, 'tos-fk-amb');
  }
}



function fkOpenMini(root) {
  if (root.querySelector('.tos-fk-mini-scrim')) return; // already open
  sfx(FK_OPEN_DEF);
  const scrim = document.createElement('div');
  scrim.className = 'tos-fk-mini-scrim';
  root.appendChild(scrim);
  // Tapping the dim backdrop closes the whole nested stack.
  scrim.addEventListener('click', e => { if (e.target === scrim) scrim.remove(); });
  fkSpawnNest(scrim, 0);
}

// The wide landscape tablet (matches the desktop shape).
function fkTabletHTML() {
  const grid = FK_MINI_APPS.map((a, idx) =>
    `<div class="tos-fk-app" data-fk-app="${idx}"><span class="ic">${a.ic}</span><span class="nm">${esc(a.nm)}</span></div>`).join('');
  return `<div class="tos-fk-mini">
      <div class="tos-fk-mini-hd"><span>ARCHITECT&nbsp;OS</span><span class="tos-fk-mini-x">✕</span></div>
      <div class="tos-fk-mini-screen">
        <div class="tos-fk-mini-time"><span>08:14</span><span>▮▮▮▯ 74%</span></div>
        <div class="tos-fk-mini-grid">${grid}</div>
        <div class="tos-fk-mini-toast"></div>
        <div class="tos-fk-mini-home"></div>
      </div>
    </div>`;
}

// A compact fake game screen (the terminal look pane) that a tablet pops up over.
function fkGameScreenHTML() {
  return `<div class="tos-fk-gamescreen">
      <div class="tos-fk-gs-hud"><span class="hp">HP 178/178</span><span>SAN 100</span><span>STA 100</span><span class="cr">₵ 10,555</span><span>WANTED ✦✦</span></div>
      <div class="tos-fk-gs-room">RUST ALLEY<span class="tos-fk-gs-safe">SAFE</span></div>
      <div class="tos-fk-gs-dist">· the Neon Quarter ·</div>
      <div class="tos-fk-gs-desc">A knife-thin gap between two data-towers, floored in wet concrete and older promises. A cracked ad-panel loops a smiling face that hasn't existed in years.</div>
      <div class="tos-fk-gs-exits"><span class="l">Exits:</span> <span class="ex">[North]</span> The Loading Bay, <span class="ex">[East]</span> The Threshold, <span class="ex">[Down]</span> Drainage Sub-Level</div>
    </div>`;
}

// One nested level inside the fake ARCHITECT window, scaled down 0.72× per level.
// Level 0 is just the tablet (over the real terminal). Every deeper level is the
// whole GAME SCREEN with a tablet popping up on it — so tapping ARCHITECT drops you
// "into the game", and its tablet's ARCHITECT drops you into the game again, smaller
// and smaller until the tiles are too small to click. Each level sits in a
// pointer-events:none centring layer so taps fall through empty space to the level
// (or backdrop) below; ✕/home (or a backdrop tap) closes the whole stack at once.
function fkSpawnNest(scrim, depth) {
  const scale = Math.pow(0.72, depth);
  if (scale < 0.1) return; // past here it's too small to bother clicking
  // First tap into the game → a shaky banner on the real tablet's top bar.
  if (depth === 1 && !scrim.querySelector('.tos-fk-caption')) {
    const cap = document.createElement('div');
    cap.className = 'tos-fk-caption';
    cap.innerHTML = '<span>Ohhhh shit...It\'s Architect all the way down....</span>';
    scrim.appendChild(cap);
  }
  const layer = document.createElement('div');
  layer.className = 'tos-fk-mini-layer';
  layer.style.transform = `scale(${scale.toFixed(4)})`;
  layer.innerHTML = depth === 0
    ? fkTabletHTML()
    : `<div class="tos-fk-gamewrap">${fkGameScreenHTML()}${fkTabletHTML()}</div>`;
  scrim.appendChild(layer);

  // ✕ / home closes the ENTIRE nested stack at once — the whole scrim (every layer
  // + the caption) goes together, so nothing lingers behind the closing window.
  const closeStack = () => scrim.remove();
  layer.querySelector('.tos-fk-mini-x').addEventListener('click', closeStack);
  layer.querySelector('.tos-fk-mini-home').addEventListener('click', closeStack);

  const toast = layer.querySelector('.tos-fk-mini-toast');
  let toastT = null;
  layer.querySelectorAll('[data-fk-app]').forEach(el => {
    el.addEventListener('click', () => {
      el.classList.remove('tap'); void el.offsetWidth; el.classList.add('tap'); // restart flash
      const nm = FK_MINI_APPS[+el.getAttribute('data-fk-app')].nm;
      if (nm === 'ARCHITECT') { sfx(FK_DIVE_DEF); fkSpawnNest(scrim, depth + 1); return; } // into the game, smaller
      sfx(FK_DENY_DEF);
      toast.textContent = `${nm} — not installed`;
      toast.classList.add('show');
      if (toastT) clearTimeout(toastT);
      toastT = setTimeout(() => toast.classList.remove('show'), 1400);
    });
  });
}

function render() {
  if (!_overlay || !_data) return;
  const scroll = _overlay.querySelector('#tos-scroll');
  if (!scroll) return;
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  if (_dhTimer) { clearInterval(_dhTimer); _dhTimer = null; }   // DEADHEAD live tracking must never outlive the overlay
  if (_fakeTimer) { clearInterval(_fakeTimer); _fakeTimer = null; } // fakeplay remounts its own ticker
  if (_reelTimer) { clearInterval(_reelTimer); _reelTimer = null; _reelPlaying = false; } // leaving/re-rendering stops reel playback

  // An action that actually landed us on a different screen counts as a level for
  // Back (see the Back stack). One that just toggled something in place does not.
  const sig = screenSig(_data);
  if (_lastWasAct && sig !== _navSig) _actDepth++;
  _lastWasAct = false;
  _navSig = sig;

  const survLive = _data.view === 'surveillance' && !!_data.live;
  const isChat = _data.view === 'chat';
  // A live surveillance poll refreshes in place — keep the operator's scroll spot
  // instead of yanking to the top every 5s. A live quest refresh (an objective
  // ticking while the player reads the screen) preserves it the same way, via a
  // one-shot flag. Every other (real) nav starts at top.
  const keepScroll = (survLive && _wasSurvLive) || _keepQuestScroll || _keepThemeScroll || _keepGearScroll || _keepNewsScroll;
  _keepQuestScroll = false;
  _keepThemeScroll = false;
  _keepGearScroll = false;
  _keepNewsScroll = false;
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

  if (_data.view === 'fakeplay') mountFakePlay();
  if (_data.view === 'reel') wireReel();
  // The TV app mounts the shared broadcast renderer into its viewport (and tears it
  // down whenever we navigate away, so the portable tuner is dropped server-side).
  if (_data.view === 'tv') mountTabletTv(); else unmountTabletTv();

  if (isChat) {
    const log = _overlay.querySelector('#tos-chat-log');
    if (_chatTab === '#system') { fitMotd(); if (log) log.scrollTop = 0; } // MOTD reads from the top
    else if (log) log.scrollTop = log.scrollHeight; // chat pins to the newest line
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
    _chatEmojiOpen = false; // left chat → don't reopen the picker next time
  }

  if (survLive) _pollTimer = setInterval(pollSurveillance, 5000);
  if (_dhTimer) { clearInterval(_dhTimer); _dhTimer = null; }
  if (_data?.view === 'deadhead' && _data.deadhead?.moving) _dhTimer = setInterval(pollDeadhead, 2000);

  applyVoidMode(); // cosmetic off-grid theming, re-applied on every render
  // The home screen shows the live sky behind the grid; every other screen is a
  // document and gets the flat background it always had.
  if (_data.screen === 'home' || !_data.appId) startWallpaper(_data.sky); else stopWallpaper();

  // First home screen a player ever sees gets the short tablet walkthrough. It
  // no-ops on every subsequent open (localStorage), and it waits for the boot to
  // settle, so this costs one flag read per render.
  if (_data.screen === 'home' || !_data.appId) maybeTabletTour();
}

// ── Animated wallpaper ───────────────────────────────────────────────────────
// The home screen's backdrop: the sky as it actually is outside, drawn from the
// `sky` snapshot the home payload carries (in-memory engine state — see
// buildHomePayload). Sun/moon position comes from the game clock, the palette from
// the time phase, and the particles from the live weather, so opening the tablet
// during an acid storm at 3am looks nothing like opening it at noon.
//
// It is deliberately cheap and deliberately optional: one canvas, no images, a
// single rAF that only runs while Home is on screen, and with motion off it paints
// exactly one static frame. Indoors it dims right down — you can't see the weather
// through a wall, but the device still knows the hour.
let _wallRaf = null;
let _wallState = null;   // { sky, drops:[], stars:[], w, h }

// ── The wallpaper catalog ────────────────────────────────────────────────────
// OFF BY DEFAULT. A wallpaper is a thing you choose, not a thing the device does
// at you — and the home screen's job is to launch apps, so the honest default is
// a flat themed screen. Chosen under Settings → General → Wallpaper; the choice
// lives on the tablet theme record (per device, like the theme itself).
//
// EVERY ONE IS DERIVED FROM THE THEME. Nothing here hardcodes a colour: each
// painter is handed `st.c` — the live --bg / --bg2 / --mg-accent / --tos-fg read
// off the overlay — and mixes from those, so switching theme moves the wallpaper
// with it instead of leaving a blue sky over a green terminal. The sky's
// time-of-day tone is a *cast* blended into the theme's own background rather
// than a palette of its own, which is what keeps it recognisably your theme at
// 3am and at noon.
//
// And they stay QUIET: contrast is capped in CSS (.tos-wall.on), the accent is
// used at single-digit alpha, and every painter is a no-op with motion off after
// its first static frame. If you can read the tile labels without effort, it's
// working.
const TABLET_WALLPAPERS = [
  { id: 'none',     label: 'None' },
  { id: 'sky',      label: 'Sky' },       // live weather + game clock
  { id: 'grid',     label: 'Grid' },      // drifting blueprint lattice
  { id: 'contours', label: 'Contours' },  // slow interference lines
  { id: 'drift',    label: 'Drift' },     // sparse floating motes
  { id: 'scan',     label: 'Scan' },      // a single slow radar sweep
];
const TABLET_WALLPAPER_DEFAULT = 'none';
function loadWallpaper() {
  const t = loadTabletTheme();
  const id = t?.wallpaper;
  return TABLET_WALLPAPERS.some(w => w.id === id) ? id : TABLET_WALLPAPER_DEFAULT;
}
function saveWallpaper(id) {
  const t = loadTabletTheme() || {};
  t.wallpaper = TABLET_WALLPAPERS.some(w => w.id === id) ? id : TABLET_WALLPAPER_DEFAULT;
  saveTabletTheme(t);
}

// The theme's live colours, resolved once per start (cheap, and they only change
// on a re-render, which restarts the wallpaper anyway).
function wallColors(el) {
  const cs = getComputedStyle(el);
  const pick = (v, fb) => (cs.getPropertyValue(v) || '').trim() || fb;
  return {
    bg: pick('--bg', '#0c1114'),
    bg2: pick('--bg2', '#1a2226'),
    accent: pick('--mg-accent', pick('--accent', '#3fd0d8')),
    fg: pick('--tos-fg', '#dfe9f5'),
  };
}

// A time-of-day CAST, expressed as an accent-independent tint plus a weight. The
// painter blends this INTO the theme background, so the result is the player's own
// palette leaning warm at dusk and cold at 3am — not a stock blue sky.
const WALL_CASTS = {
  night:   ['#0a1020', 0.55],
  dawn:    ['#6a4250', 0.30],
  morning: ['#5b7f95', 0.22],
  day:     ['#7d9fb2', 0.26],
  evening: ['#8a5246', 0.30],
  dusk:    ['#3a2c4a', 0.42],
};
function wallPhase(sky) {
  const m = sky?.minutes ?? 720;
  return m < 270 ? 'night' : m < 390 ? 'dawn' : m < 630 ? 'morning'
    : m < 1020 ? 'day' : m < 1140 ? 'evening' : m < 1290 ? 'dusk' : 'night';
}
// Mix two CSS colours the cheap way — through a canvas-friendly rgb tuple. Only
// hex and rgb() ever reach this (theme vars are one or the other); anything else
// falls back to the base so a wallpaper can never render as transparent nothing.
function wallRgb(c) {
  const s = String(c || '').trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return m[1].split('').map(h => parseInt(h + h, 16));
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) return m[1].split(',').slice(0, 3).map(n => Math.max(0, Math.min(255, parseFloat(n) || 0)));
  return null;
}
function wallMix(a, b, t) {
  const A = wallRgb(a), B = wallRgb(b);
  if (!A) return b; if (!B) return a;
  const k = Math.max(0, Math.min(1, t));
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(',')})`;
}
function wallAlpha(c, a) {
  const A = wallRgb(c);
  return A ? `rgba(${A[0]},${A[1]},${A[2]},${a})` : c;
}
// Which particle system the weather calls for. Anything unrecognised falls through
// to 'none', so a new weather type degrades to a plain sky rather than an error.
function wallPrecip(type) {
  const t = String(type || '').toLowerCase();
  if (t.includes('acid')) return 'acid';
  if (t.includes('snow') || t.includes('sleet') || t.includes('hail')) return 'snow';
  if (t.includes('rain') || t.includes('storm') || t.includes('drizzle')) return 'rain';
  if (t.includes('fog') || t.includes('mist') || t.includes('smog')) return 'fog';
  if (t.includes('dust') || t.includes('sand') || t.includes('ash')) return 'dust';
  return 'none';
}

function initWallState(sky, w, h, mode, c) {
  const precip = wallPrecip(sky?.weather);
  const heavy = /heavy|torrential|severe/i.test(sky?.intensity || '');
  const n = precip === 'none' || precip === 'fog' ? 0
    : Math.round((precip === 'snow' || precip === 'dust' ? 40 : 70) * (heavy ? 1.6 : 1));
  const rnd = (a, b) => a + Math.random() * (b - a);
  return {
    sky, w, h, precip, mode, c,
    // Drift's motes. Sparse on purpose — 26 across a whole screen reads as air, not
    // as snow; a dozen more and it becomes weather you didn't ask for.
    motes: Array.from({ length: 26 }, () => ({
      x: rnd(0, w), y: rnd(0, h), v: rnd(.08, .28), r: rnd(.8, 2.1), o: rnd(.2, .6), big: Math.random() < 0.25,
    })),
    // Wind shears the fall; a still day drops straight down.
    shear: Math.max(-1.4, Math.min(1.4, (sky?.windKph || 0) / 40)),
    drops: Array.from({ length: n }, () => ({ x: rnd(0, w), y: rnd(0, h), v: rnd(.5, 1.4), len: rnd(4, 14), o: rnd(.25, .8) })),
    // Stars only exist at night and only outdoors; drawn once into the state so
    // they don't twinkle their way across the sky between frames.
    stars: Array.from({ length: 46 }, () => ({ x: Math.random(), y: Math.random() * .62, r: rnd(.4, 1.1), o: rnd(.2, .9) })),
  };
}

// Each wallpaper is one painter, all handed the same state. `st.c` is the LIVE
// theme (see wallColors) — no painter may hardcode a colour, which is what makes
// every one of these follow the theme instead of sitting on top of it.
const WALL_PAINTERS = {
  // ── Sky: the live weather and the game clock, cast over your theme ──────────
  sky(ctx, st, t) {
    const { w, h, sky, c } = st;
    const [castCol, castW] = WALL_CASTS[wallPhase(sky)] || WALL_CASTS.day;
    // The theme's own two backgrounds, leaned toward the hour. Your palette at 3am
    // and your palette at noon — never a stock blue over a green terminal.
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, wallMix(c.bg, castCol, castW));
    g.addColorStop(1, wallMix(c.bg2, castCol, castW * 0.72));
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const m = sky?.minutes ?? 720;
    const night = m < 330 || m > 1200;

    if (night) {
      ctx.fillStyle = wallAlpha(c.fg, 0.55);
      for (const s2 of st.stars) {
        ctx.globalAlpha = s2.o * (0.6 + 0.4 * Math.sin(t / 900 + s2.x * 40));
        ctx.beginPath(); ctx.arc(s2.x * w, s2.y * h, s2.r, 0, 6.284); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Sun/moon: a straight arc from 06:00 to 18:00, mirrored overnight. The disc is
    // the theme's foreground at night and its accent by day — even the sun is yours.
    const dayFrac = night ? ((m + 360) % 1440) / 720 : (m - 360) / 720;
    const cx = w * Math.max(-0.1, Math.min(1.1, dayFrac));
    const cy = h * (0.78 - 0.52 * Math.sin(Math.PI * Math.max(0, Math.min(1, dayFrac))));
    ctx.globalAlpha = night ? 0.42 : 0.34;
    ctx.fillStyle = night ? c.fg : c.accent;
    ctx.beginPath(); ctx.arc(cx, cy, night ? 9 : 13, 0, 6.284); ctx.fill();
    ctx.globalAlpha = 1;

    // Skyline: deterministic (seeded off x, not random) so it doesn't reshuffle every
    // re-render. A darkening of the theme, not a black cut-out over it.
    const silhouette = wallMix(c.bg, '#000000', 0.45);
    const lit = wallAlpha(c.accent, 0.5);
    ctx.fillStyle = silhouette;
    const base = h * 0.82;
    for (let x = -10; x < w + 10; x += 17) {
      const sd = Math.abs(Math.sin(x * 0.7) * 43758.5453) % 1;
      const bh = 16 + sd * 62;
      ctx.fillRect(x, base - bh, 15, bh + 30);
      // A few lit windows, same seed, so the city looks inhabited without a texture.
      if (!night && sd < 0.5) continue;
      ctx.fillStyle = lit;
      for (let wy = base - bh + 6; wy < base - 6; wy += 11) {
        if ((Math.abs(Math.sin((x + wy) * 1.3) * 4375.54)) % 1 > 0.62) ctx.fillRect(x + 4, wy, 3, 4);
      }
      ctx.fillStyle = silhouette;
    }

    if (st.precip === 'fog') {
      ctx.fillStyle = wallAlpha(c.fg, 0.09);
      for (let i = 0; i < 3; i++) ctx.fillRect(0, h * (0.35 + i * 0.2) + Math.sin(t / 2600 + i) * 8, w, 26);
    } else if (st.drops.length) {
      const flake = st.precip === 'snow' || st.precip === 'dust';
      // Acid rain is the one case that earns a hue of its own — it's a warning, and a
      // warning that matched the wallpaper would not be one.
      ctx.strokeStyle = st.precip === 'acid' ? 'rgba(150,220,110,.7)' : wallAlpha(c.fg, 0.5);
      ctx.fillStyle = wallAlpha(c.fg, 0.6);
      ctx.lineWidth = 1;
      for (const d of st.drops) {
        d.y += d.v * (flake ? 1.1 : 5.2);
        d.x += st.shear * (flake ? 1.1 : 2.2) + (flake ? Math.sin((t + d.y * 9) / 700) * 0.6 : 0);
        if (d.y > h) { d.y = -10; d.x = Math.random() * w; }
        if (d.x < -12) d.x = w + 6; else if (d.x > w + 12) d.x = -6;
        ctx.globalAlpha = d.o;
        if (flake) { ctx.beginPath(); ctx.arc(d.x, d.y, 1.3, 0, 6.284); ctx.fill(); }
        else { ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + st.shear * d.len, d.y + d.len); ctx.stroke(); }
      }
      ctx.globalAlpha = 1;
    }
  },

  // ── Grid: a blueprint lattice, drifting one slow direction ─────────────────
  grid(ctx, st, t) {
    const { w, h, c } = st;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = wallMix(c.bg, c.bg2, 0.5);
    ctx.fillRect(0, 0, w, h);
    const step = 34;
    const drift = (t / 90) % step;
    ctx.lineWidth = 1;
    ctx.strokeStyle = wallAlpha(c.accent, 0.16);
    ctx.beginPath();
    for (let x = -step + drift; x < w + step; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = -step + drift; y < h + step; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    // Every fourth line heavier — gives the lattice a scale without more lines.
    ctx.strokeStyle = wallAlpha(c.accent, 0.26);
    ctx.beginPath();
    for (let x = -step * 4 + drift; x < w + step * 4; x += step * 4) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = -step * 4 + drift; y < h + step * 4; y += step * 4) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  },

  // ── Contours: slow interference lines, a depth map breathing ───────────────
  contours(ctx, st, t) {
    const { w, h, c } = st;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = wallMix(c.bg, c.bg2, 0.35);
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 1;
    const bands = 9;
    for (let i = 0; i < bands; i++) {
      const phase = t / 5200 + i * 0.55;
      ctx.strokeStyle = wallAlpha(c.accent, 0.07 + (i / bands) * 0.1);
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const k = x / w;
        const y = h * (0.12 + (i / bands) * 0.82)
          + Math.sin(phase + k * 5.2) * 11 + Math.sin(phase * 1.7 + k * 2.1) * 7;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  },

  // ── Drift: sparse motes rising. The quietest of the set. ───────────────────
  drift(ctx, st, t) {
    const { w, h, c } = st;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = wallMix(c.bg, c.bg2, 0.28);
    ctx.fillRect(0, 0, w, h);
    for (const d of st.motes) {
      d.y -= d.v;
      d.x += Math.sin((t + d.y * 6) / 1400) * 0.25;
      if (d.y < -6) { d.y = h + 6; d.x = Math.random() * w; }
      ctx.globalAlpha = d.o * (0.55 + 0.45 * Math.sin(t / 1600 + d.x));
      ctx.fillStyle = d.big ? wallAlpha(c.accent, 0.7) : wallAlpha(c.fg, 0.5);
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 6.284); ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  // ── Scan: static rings, one slow sweep. Only one thing moves. ─────────────
  scan(ctx, st, t) {
    const { w, h, c } = st;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = wallMix(c.bg, c.bg2, 0.35);
    ctx.fillRect(0, 0, w, h);
    const cx = w * 0.5, cy = h * 0.62, maxR = Math.hypot(w, h) * 0.55;
    ctx.strokeStyle = wallAlpha(c.accent, 0.1);
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) { ctx.beginPath(); ctx.arc(cx, cy, (maxR / 4) * i, 0, 6.284); ctx.stroke(); }
    const ang = ((t / 4200) % 1) * 6.283 - 1.571;   // ~4s a revolution
    const grad = ctx.createLinearGradient(cx, cy, cx + Math.cos(ang) * maxR, cy + Math.sin(ang) * maxR);
    grad.addColorStop(0, wallAlpha(c.accent, 0.24));
    grad.addColorStop(1, wallAlpha(c.accent, 0));
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang) * maxR, cy + Math.sin(ang) * maxR); ctx.stroke();
  },
};

function paintWall(ctx, st, t) {
  (WALL_PAINTERS[st.mode] || WALL_PAINTERS.sky)(ctx, st, t);
}

function startWallpaper(sky) {
  const cv = _overlay?.querySelector('#tos-wall');
  if (!cv) return;
  stopWallpaper();
  const mode = loadWallpaper();
  if (mode === 'none') return;   // the default: a flat themed screen, nothing drawn
  const box = cv.parentElement.getBoundingClientRect();
  const w = Math.max(1, Math.round(box.width)), h = Math.max(1, Math.round(box.height));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Strength rides a CUSTOM PROPERTY, never inline `opacity`. It used to set opacity
  // directly, which beat the `.on` class in the cascade — so stopWallpaper's class
  // removal did nothing and the sky stayed painted over every app screen for the
  // rest of the session. The var only takes effect while `.on` is present.
  //
  // The patterns sit lower than the sky: the sky IS a picture and can carry itself,
  // whereas a lattice or a sweep at the same strength stops being a backdrop and
  // starts competing with the tile labels. Indoors knocks the sky back again —
  // you can't see the weather through a wall, though the hour still reads.
  const strength = mode === 'sky' ? (sky?.indoors ? 0.26 : 0.5) : 0.34;
  cv.style.setProperty('--wall-strength', String(strength));
  cv.classList.add('on');
  _wallState = initWallState(sky, w, h, mode, wallColors(_overlay));
  paintWall(ctx, _wallState, 0);
  if (document.documentElement.getAttribute('data-motion') === 'off') return; // one static frame and stop
  const loop = (t) => {
    if (!_wallState || !cv.isConnected) return;
    paintWall(ctx, _wallState, t);
    _wallRaf = requestAnimationFrame(loop);
  };
  _wallRaf = requestAnimationFrame(loop);
}

function stopWallpaper() {
  if (_wallRaf) { cancelAnimationFrame(_wallRaf); _wallRaf = null; }
  _wallState = null;
  const cv = _overlay?.querySelector('#tos-wall');
  if (!cv) return;
  cv.classList.remove('on');
  // Belt and braces: drop the strength var too, so nothing an older build (or a
  // future edit) left inline can keep the canvas visible off the home screen.
  cv.style.removeProperty('--wall-strength');
  cv.style.removeProperty('opacity');
}

export function closeTabletPanel() { shutdownTablet(); }

// A dropped connection or a sign-out (both fire game-disconnect) leaves the
// tablet driving nothing — tear it down immediately, no CRT flourish.
window.addEventListener('game-disconnect', () => { if (_overlay) close(); });

function close() {
  // Narration normally dies with the shell — closing the tablet should silence it.
  // The one exception is an explicit Minimize, which sets this flag precisely so
  // the book keeps reading while you go and do something else.
  if (_narrateKeepOnClose) _narrateKeepOnClose = false;
  else narrateStop();
  purgeCompletedQuestLogs(); // finished quests' action logs clear once you close the tablet
  if (_voidIntro) { _voidIntro.cancel(); _voidIntro = null; } // torn down mid-firmware-boot — don't let its timers outlive the overlay
  if (_voidHunt) { _voidHunt.cancel(); } // drag-to-lock listeners are document-level; never leave them behind
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  if (_dhTimer) { clearInterval(_dhTimer); _dhTimer = null; }   // DEADHEAD live tracking must never outlive the overlay
  if (_fakeTimer) { clearInterval(_fakeTimer); _fakeTimer = null; }
  if (_reelTimer) { clearInterval(_reelTimer); _reelTimer = null; _reelPlaying = false; }
  if (_chatUnsub) { _chatUnsub(); _chatUnsub = null; }
  _homePage = 0;     // the tablet always opens on the first page of the home screen
  _tosSelectMode = false;
  _homeSearchOpen = false; _homeSearch = '';
  stopWallpaper();   // the rAF must never outlive the overlay it draws into
  unmountTabletTv();
  _wasSurvLive = false;
  // The back stack dies with the shell. A tablet reopened later starts at Home,
  // so a stale history from the last session must not make Back walk backwards
  // into screens the player has since left.
  _navStack = [];
  _navHere = null;
  _navSig = null; _lastWasAct = false; _actDepth = 0;
  document.querySelectorAll('.tos-tile-drag').forEach(el => el.remove()); // stray lift clone, if torn down mid-drag
  if (_close) { _close(); _close = null; }
  _overlay = null;
  _data = null;
}

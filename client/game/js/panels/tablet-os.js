// ARCHITECT TABLET OS: the shared CRT-styled shell for every tablet app, on the
// minigame chassis (minigame-common.js). Colours come from the page's --accent.
// Every screen arrives as one full 'tablet_panel' payload (plugins/tablet/index.js)
// and is re-rendered from it on each nav/action round trip; there's no live patching.
import { sfx, esc, mountOverlay, ensureChassisStyles, deviceHeader, bezelScrews, crtOverlays } from './minigame-common.js';
import { sendCmdSilent } from '../net.js';
import { toggleAutoWalk, isAutoWalking, isRunning, onRunStateChange, setGpsRoute, routeBetween, getTracePath, setMapOpener, FUNC_LEGEND, POI_LEGEND, poiInk, isWorldWaterVoid, districtCoord, WATER_VOID_FILL, crossingInnerHtml, isOnCrossing } from './minimap.js';
import { state } from '../state.js';
import { maybeTabletTour } from './tour.js';
import { loadSettings, saveSettings, applySettings, openThemeEditor, probeBuiltinThemeColors, DARK_THEMES, LIGHT_THEMES, DEFAULT_AUDIO_SETTINGS, A11Y_OPTIONS, effectiveOptionValue } from '/shared/settings.js';
import { getChatTabs, getChatMessages, sendChatMessage, markChatRead, onChatUpdate, getOnlinePlayers, refreshOnlinePlayers, ensureChatConversation, leaveChatConversation, removeCorpChannels, getClosedChatTabs, reopenChatTab, getMotdHtml } from './whisper.js';
import { showPromptDialog, showConfirmDialog, showSelectDialog } from './confirm.js';
import { parseMarkup } from '../markup.js';
import { openMusicPlayerPanel } from './musicplayer.js';
import { createTvView } from './tv.js';
import { resetOrder } from './sidebar-order.js';
import { loadQLog, saveQLog, recordQuestLog } from './quest-log.js';
import { DISCORD_INVITE } from './links.js';
import { loadCss } from '../../../shared/dom.js';

// tablet-os.css is fetched at module load so ensureStyles can apply it synchronously.
const TABLET_CSS = await loadCss(new URL('./tablet-os.css', import.meta.url));
export { DISCORD_INVITE };

// Tablet's own theme when "unlinked": a separate localStorage record, so it never
// touches the page theme.
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

// ── Quest action log (client-only, per device) ──────────────────────────────
// Store: { [quest_id]: { name, done, entries: [{ kind, text, t }] } },
//   kind: 'start' | 'arrive' | 'emote' | 'objective' | 'complete'.
// Fed by the server's 'quest_log' events; storage is in quest-log.js so lazy-views.js
// can record without loading this file. A done quest's log is purged on tablet close.
export function noteQuestLog(msg) {
  if (recordQuestLog(msg)) questLogChanged(msg.quest_id);
}

// Live-refresh the detail screen if it's showing this very quest.
export function questLogChanged(questId) {
  if (_overlay && _data && _data.appId === 'quests' && _data.view === 'detail'
      && (_data.quest?.id || _data.detail?.id) === questId) {
    _keepQuestScroll = true;
    render();
  }
}

export function dropQuestLog(questId) {
  const log = loadQLog();
  if (log[questId]) { delete log[questId]; saveQLog(log); }
}

function purgeCompletedQuestLogs() {
  const log = loadQLog();
  let changed = false;
  for (const id of Object.keys(log)) if (log[id]?.done) { delete log[id]; changed = true; }
  if (changed) saveQLog(log);
}

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
// Map app: tile id -> absolute world [x,y], filled from the grid builder's absAt().
// A miss (interiors, mainly) just omits 'Target here'.
const _tosMapAbs = new Map();
// Map label mode isn't its own state: it reads and writes the shared 'mapOverlay'
// setting, so the Map app and the sidebar minimap can't disagree.
const mapLabelsOn = () => {
  try { return (loadSettings().mapOverlay || 'labels') === 'labels'; } catch { return true; }
};
// Landmark colour: same idea, the shared 'mapColor' setting is the state.
const mapColorOn = () => {
  try { return (loadSettings().mapColor || 'off') === 'on'; } catch { return false; }
};
// Void survey zoom: client-only scale on the trail (no server tile ladder off-grid).
let _tosVoidZoom = 1.35;
const VOID_ZMIN = 0.55, VOID_ZMAX = 2.3, VOID_ZSTEP = 0.35;

// ── Void boot + signal: a one-time ritual per crossing ──────────────────────
// First open on a crossing runs the firmware boot (runVoidFirmwareBoot), which fails
// the grid handshake and comes up SEARCHING: text flickers (never the whole panel)
// until the player drags the tablet, which locks a weak carrier for the rest of the
// crossing. Never gates an app; .tos-void-mode applies while isOnCrossing() holds.
let _voidTripPrimed = false;    // has the firmware boot already played for the CURRENT crossing?
let _voidSearching = false;     // in the pre-lock "no signal, searching" state?
let _voidLocked = false;        // has the weak carrier been locked this crossing? (sticky)
let _wasOnCrossingWatch = false; // last isOnCrossing() reading, polled independently of the tablet being open
let _voidIntro = null;          // { cancel() } while the firmware boot is live, else null
let _voidHunt = null;           // { cancel() } while the drag-to-lock listeners are armed, else null
// Map zoom: −/+ walk the server's zoom ladder (movement.js MAP_ZOOM_HALVES). This is
// tile pixel size indexed by server zoomLevel; interior (−1) reuses the street size.
const TOS_ZOOM_PX = [56, 40, 30, 24, 19, 15];
const TOS_INTERIOR_PX = 56;
const tosZoomPx = (d) => d.mode === 'interior'
  ? TOS_INTERIOR_PX
  : TOS_ZOOM_PX[Math.max(0, Math.min(TOS_ZOOM_PX.length - 1, d.zoomLevel ?? 0))];
// Minimap double-click opens the Map app. Injected here because minimap.js
// importing us would be a cycle.
setMapOpener(openTabletToMap);
// Keep the Map app's Run button lit in step with the sidebar toggle (run_state echo).
onRunStateChange((running) => {
  _overlay?.querySelector('[data-map-run]')?.classList.toggle('active', running);
});
// Watch for crossing entry even with the tablet shut, so the intro primes correctly.
setInterval(() => {
  const on = isOnCrossing();
  // Fresh crossing: boot and signal hunt re-arm (the lock is per crossing).
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

function ensureStyles() {
  if (document.getElementById('tablet-os-styles')) return;
  const s = document.createElement('style');
  s.id = 'tablet-os-styles';
  s.textContent = TABLET_CSS;
  document.head.appendChild(s);
}

// Encode a label as a screenId the way the server normalizes it (lowercase,
// underscores -> spaces; plugins/tablet/registry.js normScreen), since the command
// tokenizer lowercases and splits on whitespace.
function screenToken(label) {
  return String(label || '').trim().replace(/\s+/g, '_');
}

// Pick black/white text off a background's brightness (same as minimap.js).
function luminanceTextColor(hex) {
  const h = String(hex || '').trim().replace('#', '');
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return null;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const t = Math.round((1 - lum) * 255);
  return `rgb(${t},${t},${t})`;
}

// Perceived brightness of a hex colour, 0..1.
function bgLuminance(hex) {
  const h = String(hex || '').trim().replace('#', '');
  if (h.length !== 6) return 0;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return 0;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// Sets the effective --bg/--bg2/--border/--accent on the overlay (page theme, or the
// tablet's own when unlinked), then derives text colours from those values:
// --tos-fg against --bg2, --tos-btn-fg against --accent (buttons are solid accent).
function applyTabletTheme() {
  if (!_overlay) return;
  const t = loadTabletTheme();
  let bg, bg2, accent;

  if (t.linked) {
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
  // Buttons sit on a solid accent fill, where a mid-grey is unreadable: force black/white.
  _overlay.style.setProperty('--tos-btn-fg', bgLuminance((accent || '').trim()) > 0.588 ? '#0a0a0a' : '#ffffff');
  // SPECTER green: mint on dark screens, deep green on light ones.
  _overlay.style.setProperty('--tos-shub', bgLuminance((bg || '').trim()) > 0.6 ? '#0a7d43' : '#39ff9e');
}

// ── Narration ────────────────────────────────────────────────────────────────
// Reads a book aloud through AudioEngine.speak, gated on the TV-voice setting.
// The synth has no completion callback, so narration keeps its own clock: one
// sentence per utterance, scheduled off a timer, with 'budget' so the synth
// compresses rather than overruns. Never hand a whole chapter (up to 25k chars) to speak().
const NARRATE_WPS = 2.6;          // words/sec — matches the synth's natural pace
let _narrate = null;              // { parts, i, timer, seed, title }
let _narrateKeepOnClose = false;  // set by Minimize, consumed by close()

// The ONE place a chapter is cut into utterances: the renderer numbers spans from it
// and the narrator walks the same array, so the highlight can't drift.
// ⚠ Split paragraphs first, the same way renderNarratableBody does, or a paragraph
// without end punctuation joins across the break and the highlight is off by one
// for the rest of the chapter. 'paraEnd' on the returned array marks paragraph ends
// (a longer pause); comic arrays have no such property.
function narrateSplit(text) {
  const parts = [];
  const paraEnd = new Set();
  for (const para of String(text || '').split(/\n{2,}/)) {
    const sentences = para
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      // Break a 400-char clause-pile on commas so no utterance runs 40 seconds.
      .flatMap(s => s.length > 220 ? s.split(/(?<=,)\s+/) : [s])
      .map(s => s.trim())
      .filter(s => /[a-z0-9]/i.test(s));
    if (!sentences.length) continue;
    parts.push(...sentences);
    paraEnd.add(parts.length - 1);
  }
  parts.paraEnd = paraEnd;
  return parts;
}

function narrateStop() {
  if (_narrate?.timer) clearTimeout(_narrate.timer);
  _narrate = null;
  try { window.AudioEngine?.cancelSpeech?.('tv'); } catch { /* audio may not be up */ }
  clearNarrateHighlight();
  syncNarrateBar();
  syncNarratePill();
}

// 'onEnd': optional callback returning { text, title } for what follows, or nothing
// to stop. Captured now because narration outlives a minimize, when _data is null.
function narrateStart(text, seed, title, lex, onEnd) {
  narrateStop();
  // 'text' may be a pre-split array. A caller that already numbered its spans must
  // pass that exact array (see codexNarrationParts).
  const parts = Array.isArray(text) ? text.slice() : narrateSplit(text);
  if (!parts.length) return;
  // Captured here, not at speak time: narration outlives a minimize (_data is null then).
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
    // End of chapter: ask the reader for what's next (lazily, so it sees current
    // state and can decline at the end of a volume) rather than going silent.
    const advance = _narrate.onEnd;
    if (advance) {
      const nextUp = advance();
      if (nextUp?.text) {
        // Longer than a sentence pause, so a chapter break is audible.
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
  // RP for the library: the shelf is Edwardian English and a rhotic voice fights it.
  // Pace off what speak() actually scheduled, not the word-count estimate.
  let spoken = 0;
  try {
    const r = window.AudioEngine?.speak?.(line, { seed, budget, accent: 'rp', lex: _narrate.lex });
    spoken = Number(r?.duration) || 0;
  } catch { /* keep reading */ }

  // Guarded on _overlay: narration outlives a minimize.
  clearNarrateHighlight();
  const span = _overlay?.querySelector(`.tos-narr-s[data-s="${i}"]`);
  if (span) {
    span.classList.add('tos-narr-on');
  // Nudge, never 'center': centering every sentence makes the page unreadable.
    try { span.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* older engines */ }
  }

  _narrate.i = i + 1;
  syncNarratePill();
  // Gap after an utterance: measured length where we have it (muted → 0 → estimate,
  // so a silent read still turns the page). A paragraph end gets a longer beat,
  // between the sentence gap and the 1 s chapter break.
  const NARRATE_GAP_MS = 200;
  const PARA_GAP_MS = 650;
  const gap = parts.paraEnd?.has(i) ? PARA_GAP_MS : NARRATE_GAP_MS;
  _narrate.timer = setTimeout(narrateNext, (spoken || budget) * 1000 + gap);
}

// Body prose with each utterance in a numbered span (indices from narrateSplit, the
// same call the voice walks). Sentences are numbered continuously across paragraphs;
// restarting per paragraph would break the mapping.
function renderNarratableBody(body, glossary) {
  let n = 0;
  return String(body).split(/\n{2,}/).map(para => {
    const spans = narrateSplit(para).map(s =>
      `<span class="tos-narr-s" data-s="${n++}">${glossWords(esc(s), glossary)}</span>`).join(' ');
    // A paragraph with no speakable sentence (a rule, asterisks) must still render.
    return `<p>${spans || glossWords(esc(para), glossary)}</p>`;
  }).join('');
}

// ── The comic reader ─────────────────────────────────────────────────────────
// A comic arrives as BLOCKS (parsed only in plugins/library/books.js). Rendering
// returns its narration parts from the same walk, so span N is utterance N by
// construction.
let _comicParts = null;

function renderComicBody(blocks, glossary) {
  const parts = [];
  let n = 0;
  // Every speakable string goes through here so numbering and parts stay in step.
  const say = (s) => narrateSplit(s)
    .map(t => { parts.push(t); return `<span class="tos-narr-s" data-s="${n++}">${glossWords(esc(t), glossary)}</span>`; })
    .join(' ');

  const html = (blocks || []).map(b => {
    if (b.kind === 'turn') return `<div class="tos-cm-turn"></div>`;
    if (b.kind === 'sfx') return `<div class="tos-cm-sfx">${say(b.text)}</div>`;
    if (b.kind === 'caption') return `<div class="tos-cm-cap">${say(b.text)}</div>`;
    if (b.kind === 'balloons') {
      // Balloons alternate sides. The speaker's name rides inside the spoken span,
      // or a listener loses track of who's talking.
      const bal = (b.lines || []).map((l, i) =>
        `<div class="tos-cm-bal tos-cm-bal-${i % 2 ? 'b' : 'a'}">${say(`${l.speaker}: ${l.text}`)}</div>`).join('');
      return `<div class="tos-cm-beat">${bal}</div>`;
    }
    return `<p class="tos-cm-panel">${say(b.text || '')}</p>`;
  }).join('');

  _comicParts = parts;
  return html;
}

// Underline archaic words. Runs AFTER esc() and only matches [A-Za-z'-] runs, so it
// can't land inside an entity or invent a tag; the gloss goes in a data- attribute
// so the text stays character-aligned with the narration split.
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

// Reflect narration state without a re-render (a redraw scrolls to the top).
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
// Shows what's narrating and stops it while the tablet is shut. Lives outside the overlay.
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
// Every nav() records the screen you were on; Back pops one. Home clears it.
// Entries are nav ARGUMENTS (appId/screen/params), replayable verbatim; null = home.
// Action-reached screens (a posting, a reel) can't be replayed, so they aren't
// entries: _actDepth counts them since the last nav, and Back returns to that nav.
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

// Replay an entry WITHOUT pushing it back onto the stack.
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

// One level up; Home when the stack is empty.
function navBack() {
  // On an action-reached screen: return to the nav that led here, without popping.
  if (_actDepth > 0) { _actDepth = 0; navTo(_navHere); return; }
  if (!_navStack.length) { home(); return; }
  navTo(_navStack.pop());
}

// 'replace' swaps the current entry: in-app tabs are lateral moves, so Back must
// not walk the tabs you tried.
function nav(appId, screenLabel, params, replace) {
  narrateStop();   // turning the page stops the previous page reading
  _tosSelectMode = false;  // leaving Home disarms the home-grid selection mode
  // Don't push a re-nav of the same screen (the surveillance poller does this every 5s).
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
  // render() counts this as a level if it changes the screen.
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

// Live camera hub: no server push, so re-nav silently every 5s (the deck's frame cadence).
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

// DEADHEAD live tracking: silent re-nav every 2s while she's moving; the marker's CSS
// transition covers the gap. Tears itself down when the view changes or she stops.
let _dhTimer = null;
function pollDeadhead() {
  if (!_overlay || !_data || _data.view !== 'deadhead' || !_data.deadhead?.moving) {
    if (_dhTimer) { clearInterval(_dhTimer); _dhTimer = null; }
    return;
  }
  sendCmdSilent('tabletnav deadhead');
}

// Server says a quest changed (dispatch.js quest_update): silently re-nav the exact
// Quests screen we're on so objectives tick in place. No-op unless Quests is open.
export function tabletQuestUpdate() {
  if (!_overlay || !_data || _data.appId !== 'quests') return;
  const crumb = _data.breadcrumb || [];
  let screen = null, params = null;
  if (_data.view === 'detail') {
    // A screen token must precede the quest_id or the tokenizer reads the id as the
    // screen; reuse the detail's category crumb.
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

function renderSummary(p) {
  if (!p) return '';
  return `<div class="tos-summary">
    <span><b>${esc(p.handle || '')}</b>${p.corp ? ` · ${esc(p.corp.name)}` : ''}</span>
    <span>XP <b>${p.xp ?? 0}</b></span>
    <span>On hand <b>₵${(p.credits ?? 0).toLocaleString()}</b></span>
    <span>Banked <b>₵${(p.bank_credits ?? 0).toLocaleString()}</b></span>
  </div>`;
}

// Header signal: full bars on the grid, a steady "VOIDLINK" badge on a crossing.
function buildSignal() {
  const bars = [1, 2, 3, 4].map(i => `<span class="tos-sig-bar on" style="height:${i * 2 + 1}px"></span>`).join('');
  return `<span class="tos-signal" id="tos-signal-live" title="Signal"><span class="tos-sig-bars">${bars}</span></span>`;
}
function renderSignal() {
  if (!isOnCrossing()) return buildSignal();
  if (_voidSearching) {
    return `<span class="tos-void-badge searching" id="tos-signal-live" title="No signal, move the tablet to search">`
      + `<span class="tos-void-badge-dot"></span>No signal · searching</span>`;
  }
  return `<span class="tos-void-badge" id="tos-signal-live" title="Weak carrier, voidlink, off the grid">`
    + `<span class="tos-void-badge-dot"></span>Weak signal · off grid</span>`;
}

// Off-grid theming, reapplied each render. Cosmetic only: .tos-void-mode and
// .tos-void-searching (text-only flicker before lock) are CSS; nothing gates an app.
function applyVoidMode() {
  const on = isOnCrossing();
  const panel = _overlay?.querySelector('.tos-panel');
  if (!panel) return;
  panel.classList.toggle('tos-void-mode', on);
  panel.classList.toggle('tos-void-searching', on && _voidSearching);
  const title = _overlay.querySelector('.mg-head .mg-brand-name');
  if (title) title.textContent = on ? 'VOIDLINK' : 'ARCHITECT OS';
  const sub = _overlay.querySelector('.mg-head .mg-subtitle');
  if (sub) sub.textContent = on ? 'Local Firmware · Off Grid' : 'Tablet Interface';
  if (on && _voidSearching) armVoidHunt();
}

// The one-shot void cold start: firmware terminal fails the grid handshake, then
// hands off to SEARCHING. Once per crossing (see _voidTripPrimed / openTabletPanel).
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
  { cls: 'hero', text: '◈ VOIDLINK LOCAL: NO GRID', wait: 900 },
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

// Boot done → SEARCHING (unless this crossing already locked), arming the drag hunt.
function finishVoidBoot() {
  if (!_voidLocked) _voidSearching = true;
  render();
}

// While SEARCHING, one real drag (not a grab) locks the carrier for the crossing.
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

// Header: date and place left, clock and signal right. The clock is the largest thing
// in the bar and opens the Alarm app via the generic [data-nav-app] handler.
function renderHeader(d) {
  const time = esc(d.time?.time || '');
  return `<div class="tos-hdr">`
    + `<span class="tos-hdr-left">${esc(d.time?.date || '')}</span>`
    + `<span class="tos-hdr-right">`
      + `<span class="tos-hdr-loc">${esc(d.location || '')}</span>`
      + `<button type="button" class="tos-hdr-clock" data-nav-app="alarm"`
      + ` title="${time}, set an alarm">${time}</button>`
      + renderSignal()
    + `</span></div>`;
}

// Theme-aware app icons by app id, viewBox 0 0 24 24. Strokes use currentColor; .dim
// takes a muted tone. Apps without an entry fall back to their emoji.
const TOS_APP_ICONS = {
  corp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path d="M4 21V6h7v15"/><path class="dim" d="M11 9h8v12h-8z" fill="currentColor" fill-opacity=".25" stroke="none"/><path d="M11 9h8v12"/><path d="M2 21h20"/><path d="M6 8h2M6 11h2M6 14h2M6 17h2M14 12h2M14 15h2M14 18h2"/></svg>`,
  bank: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path d="M12 3l9 5H3z"/><path class="dim" d="M12 3l9 5H3z" fill="currentColor" fill-opacity=".22" stroke="none"/><path d="M5 8v8M9 8v8M15 8v8M19 8v8"/><path d="M3 20h18"/><path d="M4 17h16"/></svg>`,
  properties: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path d="M3 11l9-8 9 8"/><path d="M5 10v11h14V10"/><path class="dim" d="M10 21v-6h4v6z" fill="currentColor" fill-opacity=".28" stroke="none"/><path d="M10 21v-6h4v6"/></svg>`,
  quests: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><rect x="5" y="4" width="14" height="17"/><path class="dim" d="M9 3h6v3H9z" fill="currentColor" fill-opacity=".3"/><path d="M9 3h6v3H9z"/><path d="M8 11l2 2 4-4"/><path d="M8.5 17h7"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="miter"><path d="M10.4 2.5h3.2l.5 2.6 2 1.15 2.5-.95 1.6 2.77-2 1.65V13.3l2 1.65-1.6 2.77-2.5-.95-2 1.15-.5 2.6h-3.2l-.5-2.6-2-1.15-2.5.95-1.6-2.77 2-1.65v-2.6l-2-1.65 1.6-2.77 2.5.95 2-1.15z"/><circle class="dim" cx="12" cy="12" r="3" fill="currentColor" fill-opacity=".3" stroke="none"/><circle cx="12" cy="12" r="3"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M9 3l3 2.5L15 3l4 3-2.5 3.5V21H7.5V9.5L5 6z" fill="currentColor" fill-opacity=".22" stroke="none"/><path d="M9 3l3 2.5L15 3l4 3-2.5 3.5V21H7.5V9.5L5 6z"/><path d="M12 5.5V21"/></svg>`,
  skills: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M12 2.5l2.6 5.3 5.9.9-4.25 4.15 1 5.75L12 15.9 6.75 18.6l1-5.75L3.5 8.7l5.9-.9z" fill="currentColor" fill-opacity=".22" stroke="none"/><path d="M12 2.5l2.6 5.3 5.9.9-4.25 4.15 1 5.75L12 15.9 6.75 18.6l1-5.75L3.5 8.7l5.9-.9z"/></svg>`,
  weather: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><circle class="dim" cx="8" cy="8" r="3" fill="currentColor" fill-opacity=".3"/><circle cx="8" cy="8" r="3"/><path d="M8 2.2v1.6M8 12.2v1.6M2.2 8h1.6M12.2 8h1.6M4.1 4.1l1.1 1.1M10.8 10.8l1.1 1.1M11.9 4.1l-1.1 1.1M5.2 10.8l-1.1 1.1"/><path d="M9 18a3.5 3.5 0 0 1 .5-6.96A4.5 4.5 0 0 1 18 12.5a3 3 0 0 1-.4 5.5z" fill="currentColor" fill-opacity=".12"/></svg>`,
  vehicles: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M12 2l2.5 6.5L21 12v2l-6.5-2v4l2.5 2v1.5L12 18l-5 1.5V18l2.5-2v-4L3 14v-2l6.5-3.5z" fill="currentColor" fill-opacity=".22" stroke="none"/><path d="M12 2l2.5 6.5L21 12v2l-6.5-2v4l2.5 2v1.5L12 18l-5 1.5V18l2.5-2v-4L3 14v-2l6.5-3.5z"/></svg>`,
  specter: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M3 7l13-3 1.2 4.4-13 3z" fill="currentColor" fill-opacity=".25" stroke="none"/><path d="M3 7l13-3 1.2 4.4-13 3z"/><path d="M17.6 6.2l3.4-1 .7 2.6-3.4 1"/><path d="M6 11.2V15a2 2 0 0 0 2 2h1"/><circle cx="9" cy="20" r="2"/><path d="M12.5 9.5l2.5 3.5"/></svg>`,
  chat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M4 4h16v11H8l-4 4z" fill="currentColor" fill-opacity=".22" stroke="none"/><path d="M4 4h16v11H8l-4 4z"/><path d="M8 8h8M8 11h5"/></svg>`,
  news: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M4 4h16v16l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2z" fill="currentColor" fill-opacity=".2" stroke="none"/><path d="M4 4h16v16l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2z"/><path d="M7 7h10"/><path d="M7 10.5h4.5v4H7z"/><path d="M13.5 10.5H17M13.5 13H17M7 16.5h10"/></svg>`,
  // Mixology (app id is still 'bar'): without this the emoji tile ignores the theme.
  bar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M5.6 6.6h12.8L12 13.9z" fill="currentColor" fill-opacity=".16" stroke="none"/><path d="M4.2 5.4h15.6L12 14.4z"/><path d="M12 14.4v5"/><path d="M8.3 19.8h7.4"/><path d="M15.6 3.1l-2.2 4.4" stroke-opacity=".55"/><circle cx="13.4" cy="7.5" r="1.15" fill="currentColor" stroke="none"/></svg>`,
  sports: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><circle class="dim" cx="12" cy="12" r="8.2" fill="currentColor" fill-opacity=".16" stroke="none"/><circle cx="12" cy="12" r="8.2"/><path d="M6.9 5.9C9.5 8.7 9.5 15.3 6.9 18.1"/><path d="M17.1 5.9C14.5 8.7 14.5 15.3 17.1 18.1"/><path d="M8.6 8.4l1.6-.5M9.2 11.9h1.7M8.6 15.4l1.6.5" stroke-opacity=".6" stroke-width="1.3"/><path d="M15.4 8.4l-1.6-.5M14.8 11.9h-1.7M15.4 15.4l-1.6.5" stroke-opacity=".6" stroke-width="1.3"/></svg>`,
  codex: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M12 6.2C10.2 4.6 7.6 4 3.5 4.4v14C7.6 18 10.2 18.6 12 20.2c1.8-1.6 4.4-2.2 8.5-1.8v-14C16.4 4 13.8 4.6 12 6.2z" fill="currentColor" fill-opacity=".16" stroke="none"/><path d="M12 6.2C10.2 4.6 7.6 4 3.5 4.4v14C7.6 18 10.2 18.6 12 20.2c1.8-1.6 4.4-2.2 8.5-1.8v-14C16.4 4 13.8 4.6 12 6.2z"/><path d="M12 6.2v14"/><path d="M6 8.4h3.5M6 11.2h3.5M6 14h2.4" stroke-opacity=".75"/><circle cx="16.4" cy="11.4" r="3.1" stroke-opacity=".8"/><path d="M16.4 8.3v6.2M13.3 11.4h6.2" stroke-opacity=".45"/><circle cx="17.7" cy="10.1" r="1.15" fill="currentColor" stroke="none"/></svg>`,
  // Kept for any surface keyed off the old 'ideology' id (now the Codex's Orders).
  ideology: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><circle class="dim" cx="12" cy="12" r="9" fill="currentColor" fill-opacity=".14" stroke="none"/><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18" stroke-opacity=".55"/><circle cx="15" cy="9" r="2.4" fill="currentColor" stroke="none"/></svg>`,
  // Not an SVG: the circled-"A" logo, same as .tos-boot-logo.
  arcade: `<span class="tos-ic-a">A</span>`,
  music: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path d="M9 18V5l11-2v13"/><circle class="dim" cx="6" cy="18" r="3" fill="currentColor" fill-opacity=".25" stroke="none"/><circle cx="6" cy="18" r="3"/><circle class="dim" cx="17" cy="16" r="3" fill="currentColor" fill-opacity=".25" stroke="none"/><circle cx="17" cy="16" r="3"/></svg>`,
  help: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><circle class="dim" cx="12" cy="12" r="9" fill="currentColor" fill-opacity=".18" stroke="none"/><circle cx="12" cy="12" r="9"/><path d="M9.1 9.3a2.9 2.9 0 0 1 5.6 1c0 1.9-2.7 2.3-2.7 4"/><circle cx="12" cy="17.3" r=".6" fill="currentColor" stroke="none"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path d="M8 2v3M16 2v3"/><rect x="3.5" y="5" width="17" height="16" rx="1.5"/><path class="dim" d="M3.5 9h17V6.5A1.5 1.5 0 0 0 19 5H5A1.5 1.5 0 0 0 3.5 6.5z" fill="currentColor" fill-opacity=".28" stroke="none"/><path d="M3.5 9h17"/><path d="M7.5 12.5h3M13.5 12.5h3M7.5 16.5h3M13.5 16.5h3"/></svg>`,
  map: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z" fill="currentColor" fill-opacity=".18" stroke="none"/><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/></svg>`,
  frontier: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><circle class="dim" cx="12" cy="12" r="9" fill="currentColor" fill-opacity=".14" stroke="none"/><circle cx="12" cy="12" r="9"/><path class="dim" d="M15 5l-7 3-3 7 7-3z" fill="currentColor" fill-opacity=".28" stroke="none"/><path d="M15 5l-7 3-3 7 7-3z"/><circle cx="12" cy="12" r=".9" fill="currentColor" stroke="none"/></svg>`,
  crafting: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M14.6 5.4a4 4 0 0 0-5.2 5.2l-6 6 3 3 6-6a4 4 0 0 0 5.2-5.2l-2.6 2.6-2.6-.4-.4-2.6z" fill="currentColor" fill-opacity=".2" stroke="none"/><path d="M14.6 5.4a4 4 0 0 0-5.2 5.2l-6 6 3 3 6-6a4 4 0 0 0 5.2-5.2l-2.6 2.6-2.6-.4-.4-2.6z"/></svg>`,
  party: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><circle cx="9" cy="8" r="3"/><path class="dim" d="M3.5 20a5.5 5.5 0 0 1 11 0z" fill="currentColor" fill-opacity=".22" stroke="none"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><circle cx="16.5" cy="8.5" r="2.5"/><path d="M14.6 15.2A5 5 0 0 1 21 20"/></svg>`,
  deadhead: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><ellipse class="dim" cx="12" cy="13" rx="10" ry="6.2" fill="currentColor" fill-opacity=".12" stroke="none"/><ellipse cx="12" cy="13" rx="10" ry="6.2" stroke-opacity=".5" stroke-dasharray="2.4 2.6"/><path d="M12 4.6l1.05 5.7 4.9 2.5-4.9.7v2.2l1.7 1.6-2.75-.85-2.75.85 1.7-1.6v-2.2l-4.9-.7 4.9-2.5z" fill="currentColor" stroke="none"/></svg>`,
  health: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.4a4.7 4.7 0 0 1 8.5 2.8c0 5.8-8.5 11.3-8.5 11.3z" fill="currentColor" fill-opacity=".18" stroke="none"/><path d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.4a4.7 4.7 0 0 1 8.5 2.8c0 5.8-8.5 11.3-8.5 11.3z"/><path d="M4.6 12.4h3l1.6-3.2 2.2 5.4 1.7-3.4 1.2 1.2h4.1"/></svg>`,
  library: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M4 5h4v14H4zM9 5h4v14H9z" fill="currentColor" fill-opacity=".2" stroke="none"/><path d="M4 5h4v14H4zM9 5h4v14H9z"/><path d="M14.4 6.3l4 1-2.6 11.4-4-1z"/><path d="M5 8.6h2M10 8.6h2"/><path d="M3 21h18"/></svg>`,
  tv: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path d="M8.4 7L5 3M15.6 7L19 3"/><rect x="2.5" y="7" width="19" height="12" rx="1.4"/><path class="dim" d="M4.5 9h11.5v8H4.5z" fill="currentColor" fill-opacity=".24" stroke="none"/><path d="M4.5 9h11.5v8H4.5z"/><path d="M18.6 11v.01M18.6 14.4v.01" stroke-linecap="round" stroke-width="2"/><path d="M7 21h10"/></svg>`,
  cookbook: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M3 11h13v3.5a5.5 5.5 0 0 1-11 0z" fill="currentColor" fill-opacity=".22" stroke="none"/><path d="M3 11h13v3.5a5.5 5.5 0 0 1-11 0z"/><path d="M16 12.4h4.5"/><path d="M7 8.2c0-1.4 1.4-1.4 1.4-2.8S7 2.6 7 2.6M11.5 8.2c0-1.4 1.4-1.4 1.4-2.8s-1.4-2.8-1.4-2.8" stroke-opacity=".55"/></svg>`,
  storefront: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M2.5 4.5h19L20 10H4z" fill="currentColor" fill-opacity=".24" stroke="none"/><path d="M2.5 4.5h19L20 10H4z"/><path d="M4 10v10.5h16V10"/><path d="M8.5 20.5V14h7v6.5"/><path d="M8.5 4.5L8 10M15.5 4.5l.5 5.5" stroke-opacity=".5"/></svg>`,
  alarm: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><circle class="dim" cx="12" cy="13.5" r="7.5" fill="currentColor" fill-opacity=".16" stroke="none"/><circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.6 1.7"/><path d="M4.6 4.2A4 4 0 0 0 3 7.4M19.4 4.2A4 4 0 0 1 21 7.4"/><path d="M6.2 19.8L4.6 21.6M17.8 19.8l1.6 1.8"/></svg>`,
  binder: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><rect class="dim" x="3.2" y="7" width="8.6" height="12.4" rx="1.4" transform="rotate(-16 7.5 13.2)" fill="currentColor" fill-opacity=".18"/><rect class="dim" x="3.2" y="7" width="8.6" height="12.4" rx="1.4" transform="rotate(-16 7.5 13.2)"/><rect x="8" y="4.6" width="9" height="13.2" rx="1.4" transform="rotate(-4 12.5 11.2)" fill="currentColor" fill-opacity=".12"/><rect x="8" y="4.6" width="9" height="13.2" rx="1.4" transform="rotate(-4 12.5 11.2)"/><path d="M12.9 9.3l1 2.05 2.26.33-1.63 1.6.38 2.25-2.01-1.06-2.02 1.06.39-2.25-1.64-1.6 2.27-.33z" fill="currentColor" stroke="none"/></svg>`,
  accolades: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><circle class="dim" cx="12" cy="9" r="6" fill="currentColor" fill-opacity=".2" stroke="none"/><circle cx="12" cy="9" r="6"/><path d="M12 6.2l1.15 2.35 2.6.38-1.88 1.83.44 2.58L12 12.1l-2.31 1.22.44-2.58L8.25 8.9l2.6-.38z" fill="currentColor" stroke="none"/><path d="M8.4 14.3L7 21.5l5-2.4 5 2.4-1.4-7.2"/></svg>`,
  bliss: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"><path class="dim" d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.4a4.7 4.7 0 0 1 8.5 2.8c0 5.8-8.5 11.3-8.5 11.3z" fill="currentColor" fill-opacity=".28" stroke="none"/><path d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.4a4.7 4.7 0 0 1 8.5 2.8c0 5.8-8.5 11.3-8.5 11.3z"/><path d="M7.6 9.4a2.6 2.6 0 0 1 2.3-1.7" stroke-opacity=".55"/></svg>`,
};

// Tile plate hue (OKLCH degrees) by what the app is about. An app with no entry gets
// a hue hashed from its id.
const TOS_APP_HUES = {
  corp: 250, bank: 85, properties: 150, quests: 60, settings: 260, gear: 40, skills: 75,
  weather: 220, vehicles: 230, specter: 0, chat: 245, news: 30, bar: 330, sports: 140,
  codex: 280, ideology: 300, music: 310, help: 200, calendar: 20, map: 160, frontier: 190,
  crafting: 50, party: 235, deadhead: 210, health: 15, library: 55, tv: 295, cookbook: 45,
  storefront: 120, alarm: 25, binder: 270, accolades: 80, bliss: 350,
};
function tosAppHue(id) {
  if (TOS_APP_HUES[id] != null) return TOS_APP_HUES[id];
  let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}
// Icon Colours → Theme: groups are a step (0-4) off the accent, 28° and a little
// lightness per step.
function tosAppShade(id) {
  return Math.floor(tosAppHue(id) / 72) % 5;
}
function tosTileIcon(a) {
  const svg = TOS_APP_ICONS[a.id];
  const inner = svg ? svg : `<span class="tos-ic-emoji">${esc(a.icon || '▫')}</span>`;
  return `<span class="tos-icon${a.id === 'arcade' ? ' tos-icon-bare' : ''}" aria-hidden="true" style="--ic-h:${tosAppHue(a.id)};--ic-s:${tosAppShade(a.id)}">${inner}</span>`;
}

// Client-only apps appended to the server roster. Music opens the walkman overlay
// (openMusicPlayerPanel), handled in wireBody().
const CLIENT_APPS = [{ id: 'music', name: 'Music', category: 'Media' }];

// Home-grid order: client-only, per device, a list of app ids. See
// plugins/tablet/README.md#home-screen-client for the home grid's design.
const TABLET_APP_ORDER_KEY = 'architect_tablet_app_order';
// Apps flung off the grid (offered back under ⊕). Client-only.
const TABLET_APP_HIDDEN_KEY = 'architect_tablet_hidden_apps';
// Default home: sixteen apps (one page), in reading order. Everything else starts
// stashed under ⊕. Adding one here means dropping one.
const TABLET_DEFAULT_HOME_APPS = [
  'map', 'gear', 'health', 'quests',
  'chat', 'bank', 'crime', 'skills',
  'crafting', 'news', 'music', 'calendar',
  'tv', 'codex', 'help', 'settings',
];
// Bump when TABLET_DEFAULT_HOME_APPS changes: each device re-seeds once (which
// discards a custom arrangement, so only on a deliberate bump).
const TABLET_HOME_SEED_VERSION = 2;
const TABLET_HOME_SEED_KEY = 'architect_tablet_home_seed_v';
let _suppressTileClick = false; // swallow the click that fires right after a drag-drop
// Selection mode (⧉): tap picks, drag lassoes, long-press reorder stands down.
let _tosSelectMode = false;
// True from a tile LIFT until the next press, so the page-swipe handler (same
// element) treats a sideways tile drag as a reorder, not a page turn.
let _homeDragLifted = false;

function loadAppOrder() {
  try { const a = JSON.parse(localStorage.getItem(TABLET_APP_ORDER_KEY)); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
function saveAppOrder(ids) {
  try { const t = trimHomeGaps(ids || []); if (t.length) localStorage.setItem(TABLET_APP_ORDER_KEY, JSON.stringify(t)); } catch {}
}

// ── Empty slots ──────────────────────────────────────────────────────────────
// A hole is a real entry in the order, so a page keeps its shape. Tokens are UNIQUE
// ('~gap' + suffix) because the save path splices pages back by id. Trailing holes
// are trimmed on save.
const HOME_GAP_PREFIX = '~gap';
const isHomeGap = (id) => typeof id === 'string' && id.startsWith(HOME_GAP_PREFIX);
const newHomeGap = () => HOME_GAP_PREFIX + Math.random().toString(36).slice(2, 8);
function trimHomeGaps(order) {
  let end = order.length;
  while (end > 0 && isHomeGap(order[end - 1])) end--;
  return order.slice(0, end);
}
// Leave a hole where a flung-off app was, so the page doesn't re-pack.
function replaceOrderIdWithGap(id) {
  const order = loadAppOrder();
  if (!order.includes(id)) return;
  saveAppOrder(order.map(x => (x === id ? newHomeGap() : x)));
}
function loadHiddenApps() {
  try { const a = JSON.parse(localStorage.getItem(TABLET_APP_HIDDEN_KEY)); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
// Stash everything outside the default set, on first run and once per
// TABLET_HOME_SEED_VERSION. Materialized so a later-registered app lands on the grid.
function seedDefaultHiddenApps(all) {
  if (!all.length) return;   // roster not in yet — don't seed an empty default
  let seeded = null;
  try { seeded = localStorage.getItem(TABLET_HOME_SEED_KEY); } catch { return; }
  // No version key yet: treat as version 1 so it re-seeds once.
  if (seeded !== null && Number(seeded) >= TABLET_HOME_SEED_VERSION) return;
  saveHiddenApps(all.filter(a => !TABLET_DEFAULT_HOME_APPS.includes(a.id)).map(a => a.id));
  // Seed the order too, so the sixteen land in reading order.
  saveAppOrder(TABLET_DEFAULT_HOME_APPS.filter(id => all.some(a => a.id === id)));
  saveAppGroups([]);   // a re-seed can't leave a box holding apps that are now stashed
  saveRemovedApps([]); // …nor a removal recorded against an arrangement that's gone
  try { localStorage.setItem(TABLET_HOME_SEED_KEY, String(TABLET_HOME_SEED_VERSION)); } catch {}
}
function saveHiddenApps(ids) {
  try { localStorage.setItem(TABLET_APP_HIDDEN_KEY, JSON.stringify(ids || [])); } catch {}
}
function hideApp(id) {
  const h = loadHiddenApps();
  if (!h.includes(id)) { h.push(id); saveHiddenApps(h); }
  markAppRemoved(id);
}
function unhideApp(id) {
  saveHiddenApps(loadHiddenApps().filter(x => x !== id));
  saveRemovedApps(loadRemovedApps().filter(x => x !== id));
  saveAppGroups(loadAppGroups().map(g => ({ ...g, apps: g.apps.filter(x => x !== id) })));
}

// ── Removed vs merely stashed ────────────────────────────────────────────────
// Seed-stashed isn't removed. Home cards show for any app except one the player
// explicitly removed; the grid still uses the hidden list.
const TABLET_APP_REMOVED_KEY = 'architect_tablet_removed_apps';
function loadRemovedApps() {
  let raw = null;
  try { raw = localStorage.getItem(TABLET_APP_REMOVED_KEY); } catch { return []; }
  if (raw === null) {
    // No key yet: the only provable removals are default apps that are stashed anyway.
    // A stashed non-default app is ambiguous and counts as not removed.
    const derived = loadHiddenApps().filter(id => TABLET_DEFAULT_HOME_APPS.includes(id));
    saveRemovedApps(derived);
    return derived;
  }
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return []; }
}
function saveRemovedApps(ids) {
  try { localStorage.setItem(TABLET_APP_REMOVED_KEY, JSON.stringify(ids || [])); } catch {}
}
function markAppRemoved(id) {
  const r = loadRemovedApps();
  if (!r.includes(id)) { r.push(id); saveRemovedApps(r); }
}

// Home-grid groups: client-only, '[{ id, name, color, apps:[appId] }]'. Presentational only.
const TABLET_APP_GROUPS_KEY = 'architect_tablet_app_groups';
// Group swatches, all legible against the tab's dark text.
const TOS_GROUP_COLORS = ['#3fd0d8', '#5ad07a', '#d8c23f', '#e08a3a', '#e0413a', '#c76ad8', '#6a8fe0', '#a9b4bd'];
function loadAppGroups() {
  try {
    const a = JSON.parse(localStorage.getItem(TABLET_APP_GROUPS_KEY));
    return Array.isArray(a) ? a.filter(g => g && g.id && Array.isArray(g.apps)) : [];
  } catch { return []; }
}
function saveAppGroups(groups) {
  // Drop empty groups: an empty box can't be repopulated except by lasso.
  try { localStorage.setItem(TABLET_APP_GROUPS_KEY, JSON.stringify((groups || []).filter(g => g.apps.length))); } catch {}
}
// Put 'ids' in a group (an app is in exactly one); null groupId makes a new one.
// 'cols' is the shape you selected: a 2×2 lasso makes a 2×2 box.
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

// Box column count, clamped to the grid. A group without 'cols' falls back to
// square-ish (ceil√n), not full-width.
function groupCols(g) {
  const n = (g.apps || []).length || 1;
  const want = Number(g.cols) || Math.ceil(Math.sqrt(n));
  return Math.max(1, Math.min(HOME_COLS, want));
}

// Columns a selection occupied on screen (distinct x-centres, snapped for sub-pixel maths).
function selectionCols(tiles) {
  const xs = new Set(tiles.map(t => {
    const b = t.getBoundingClientRect();
    return Math.round((b.left + b.width / 2) / 8);   // 8px buckets — a column is far wider
  }));
  return Math.max(1, Math.min(HOME_COLS, xs.size));
}

// Saved-order apps first, then unplaced ones in natural order.
function applyAppOrder(apps) {
  const order = loadAppOrder();
  if (!order.length) return apps;
  const byId = new Map(apps.map(a => [a.id, a]));
  const ordered = [];
  for (const id of order) {
    if (isHomeGap(id)) { ordered.push({ id, gap: true, name: '' }); continue; }
    if (byId.has(id)) { ordered.push(byId.get(id)); byId.delete(id); }
  }
  for (const a of apps) { if (byId.has(a.id)) ordered.push(a); }
  return ordered;
}

// One home tile. 'stashed' is only true in search results: dimmed, and tapping it
// restores the app.
function homeTile(a, stashed, extra) {
  // A hole: shows only while arranging (.tos-tile-gap), and is a drop target.
  if (a.gap) return `<div class="tos-tile tos-tile-gap${extra ? ' ' + extra : ''}" data-home-gap="${esc(a.id)}"></div>`;
  const n = Number(a.notify) || 0;
  const badge = n > 0 ? `<span class="tos-tile-badge">${n > 9 ? '9+' : n}</span>` : '';
  const glow = (a.id === 'frontier' && isOnCrossing()) ? ' tos-tile-glow' : '';
  const attr = stashed ? `data-search-restore="${esc(a.id)}"` : `data-nav-app="${esc(a.id)}"`;
  // A <button> so the home screen is keyboard-reachable; drag is hand-rolled on
  // pointer events, which buttons fire too. The badge count goes in the accessible name.
  const aria = n > 0 ? ` aria-label="${esc(a.name)}, ${n} waiting"` : '';
  return `<button type="button" class="tos-tile${glow}${stashed ? ' tos-tile-stashed' : ''}${extra ? ' ' + extra : ''}" ${attr}`
    + `${aria}${stashed ? ' title="Stashed: tap to put it back"' : ''}>`
    + `${badge}${tosTileIcon(a)}<span class="tos-name">${esc(a.name)}</span></button>`;
}

function renderHomeApps(apps) {
  const roster = [...(apps || []), ...CLIENT_APPS];
  seedDefaultHiddenApps(roster);
  const hidden = new Set(loadHiddenApps());
  const all = applyAppOrder(roster).filter(a => a.gap || !hidden.has(a.id));
  if (!all.some(a => !a.gap) && !hidden.size) return '<div class="tos-empty">No applications registered.</div>';
  // ⚠ Every visible app must be in the saved order: cross-page moves compute page
  // boundaries from the saved order alone. APPEND the missing ones, never rewrite from
  // 'all' (it lacks stashed apps and would erase their slots).
  if (all.some(a => !a.gap)) {
    const saved = loadAppOrder();
    const missing = all.filter(a => !a.gap && !saved.includes(a.id)).map(a => a.id);
    if (missing.length) saveAppOrder(saved.length ? [...saved, ...missing] : all.map(a => a.id));
  }
  // Search flattens: no pages, no boxes, just matches in order.
  if (_homeSearchOpen) {
    const q = _homeSearch.trim().toLowerCase();
    const hits = [...all.filter(a => !a.gap), ...[...hidden].map(id => roster.find(a => a.id === id)).filter(Boolean)]
      .filter(a => !q || String(a.name).toLowerCase().includes(q) || a.id.includes(q));
    const grid = hits.length
      ? `<div class="tos-grid">${hits.map(a => homeTile(a, hidden.has(a.id))).join('')}</div>`
      : `<div class="tos-empty">Nothing matches “${esc(_homeSearch.trim())}”.</div>`;
    return `<div class="tos-home-apps tos-searching">${grid}${renderHomeToolbar(true)}</div>`;
  }
  const tile = (a) => homeTile(a, false);
  // A group box is drawn where its earliest member sits in the saved order; it never
  // moves apps. Membership is by id, so a missing app just drops out.
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

  // One grid: a group box is an item spanning its members' cells (cols × rows).
  const body = page.blocks.map(b => {
    if (b.kind === 'tile') return tile(b.app);
    const { g, members } = b;
    const color = /^#[0-9a-f]{3,8}$/i.test(g.color || '') ? g.color : TOS_GROUP_COLORS[0];
    const cols = groupCols(g);
    const n = members.length;
    const rows = Math.ceil(n / cols);
    // Which sides of each member are on the outside of the region; the "past the end"
    // clause traces the notch of a short final row.
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
  // Pad the page to sixteen cells with throwaway holes so every empty cell is a drop
  // target. 'data-home-pad' tells persistHomeArrangement to skip trailing ones.
  const used = page.blocks.reduce((n, b) => n + homeBlockCost(b), 0);
  const pads = Array.from({ length: Math.max(0, HOME_SLOTS - used) },
    () => `<div class="tos-tile tos-tile-gap" data-home-gap="${newHomeGap()}" data-home-pad="1"></div>`).join('');
  const bar = _tosSelectMode ? `<div class="tos-selbar">
      <span class="tos-selbar-n"><b data-sel-count>0</b> selected</span>
      <button type="button" class="tos-grp-btn" data-sel-cancel>Cancel</button>
      <button type="button" class="tos-grp-btn" data-sel-group>Group</button>
    </div>` : '';
  return `<div class="tos-home-apps${_tosSelectMode ? ' tos-selecting' : ''}" data-home-page-now="${_homePage}">`
    + `<div class="tos-grid tos-appgrid tos-homegrid" data-group-grid="">${body}${pads}</div>`
    + renderHomePager(pages.length)
    + renderHomeToolbar(false)
    + `${bar}</div>`;
}

// ── The home toolbar ─────────────────────────────────────────────────────────
// Select, Add and Search live in a strip under the grid, not as tiles, so a page holds sixteen apps.
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
// 4×4 per page. Packed by whole rows; a group too tall for a page runs over rather
// than hiding apps. Derived each render from order + groups, never stored.
const HOME_COLS = 4;
const HOME_ROWS = 4;
const HOME_SLOTS = HOME_COLS * HOME_ROWS;   // 16
let _homePage = 0;   // which page is showing; survives re-renders, reset on close

// ── Installing a new app ─────────────────────────────────────────────────────
// An arriving app (library unlock, or pulled back from ⊕) opens the tablet on its
// page and fills its tile to 100% before it opens. Slow on purpose: it's a ceremony.
const INSTALL_MS = 3200;
let _install = null;      // { id, t0 } while a tile is filling
let _installRaf = 0;
let _installSeek = 0;     // pages walked looking for the tile — bounds the render loop

// 'unhideApp' first: an install always lands on the grid, even if the id is stashed.
function beginInstall(appId) {
  if (!appId) return;
  unhideApp(appId);
  cancelInstall();
  // An arriving app shouldn't land mid-search or mid-selection.
  _homeSearchOpen = false; _homeSearch = ''; _tosSelectMode = false;
  _install = { id: appId, t0: 0 };
  _installSeek = 0;
}

function cancelInstall() {
  if (_installRaf) { cancelAnimationFrame(_installRaf); _installRaf = 0; }
  _install = null;
}

function installTile() {
  return _overlay?.querySelector(`.tos-tile[data-nav-app="${CSS.escape(_install.id)}"]`) || null;
}

// Called after every render while an install is armed. Re-query the tile each frame:
// a re-render replaces it, and a held node would paint into a detached element.
function tickInstall() {
  if (!_install || !_overlay) return;
  let tile = installTile();
  if (!tile) {
    // Not on this page: walk forward (usually one hop); _installSeek stops it if the
    // tile isn't anywhere.
    const pages = _overlay.querySelectorAll('.tos-page-dot').length;
    if (_installSeek < pages && _homePage < pages - 1) { _installSeek++; _homePage++; render(); return; }
    cancelInstall();
    return;
  }
  if (!tile.classList.contains('tos-tile-installing')) {
    tile.classList.add('tos-tile-installing');
    const ring = document.createElement('span'); ring.className = 'tos-install-ring';
    const pct = document.createElement('span'); pct.className = 'tos-install-pct'; pct.textContent = '0%';
    tile.append(ring, pct);
    // Placed over the icon and name wherever this tile put them (a tall tile centres
    // its content). Placed once per dressing; a re-render re-dresses.
    const icon = tile.querySelector('.tos-icon'), name = tile.querySelector('.tos-name');
    if (icon) ring.style.top = `${Math.round(icon.offsetTop + icon.offsetHeight / 2 - 16)}px`;
    if (name) { pct.style.top = `${name.offsetTop}px`; pct.style.bottom = 'auto'; }
  }
  if (_installRaf) return;   // already running; the re-render just re-dressed the tile
  const step = (now) => {
    _installRaf = 0;
    if (!_install || !_overlay?.isConnected) { cancelInstall(); return; }
    if (!_install.t0) _install.t0 = now;
    const t = Math.min(1, (now - _install.t0) / INSTALL_MS);
    const live = installTile();
    if (!live) { tickInstall(); return; }   // re-rendered away — re-dress and carry on
    if (!live.classList.contains('tos-tile-installing')) { tickInstall(); return; }
    // Ease out so the last few percent take visibly longer.
    const p = Math.round((1 - Math.pow(1 - t, 1.7)) * 100);
    live.style.setProperty('--ipct', String(p));
    const label = live.querySelector('.tos-install-pct');
    if (label) label.textContent = `${p}%`;
    if (t < 1) { _installRaf = requestAnimationFrame(step); return; }
    live.classList.remove('tos-tile-installing');
    live.style.removeProperty('--ipct');
    live.querySelector('.tos-install-ring')?.remove();
    live.querySelector('.tos-install-pct')?.remove();
    live.classList.add('tos-tile-installed');
    setTimeout(() => live.classList.remove('tos-tile-installed'), 700);
    sfx(TOS_ENTRY_DEF);
    _install = null;
  };
  _installRaf = requestAnimationFrame(step);
}

// Counted in CELLS: a tile costs 1, a box costs cols × rows. The grid packs 'dense',
// so small tiles backfill holes and this count matches what's drawn.
function homeBlockCost(b) {
  return b.kind === 'group' ? groupCols(b.g) * Math.ceil(b.members.length / groupCols(b.g)) : 1;
}
function paginateHome(blocks) {
  const pages = [];
  let cur = { blocks: [], left: HOME_SLOTS };
  const push = () => { pages.push(cur); cur = { blocks: [], left: HOME_SLOTS }; };

  for (const b of blocks) {
    const cost = homeBlockCost(b);
    // An oversized box still gets a page and runs over; clamping would hide apps.
    if (cost > cur.left && cur.blocks.length) push();
    cur.blocks.push(b);
    cur.left = Math.max(0, cur.left - cost);
  }
  pages.push(cur);   // the trailing page (empty when there are no apps at all)
  return pages;
}

// Page dots, hidden at one page. Dots are also drop targets; the other cross-page
// route is holding a tile against an edge (HOME_EDGE_MS).
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
// Cards under the grid from each app's server buildWidget (contract in
// plugins/tablet/index.js). An unknown card kind is skipped. Opt-in per device, off
// by default; off means off, even for the Wanted alarm.
const TABLET_WIDGETS_KEY = 'architect_tablet_widgets';
function widgetsEnabled() {
  try { return localStorage.getItem(TABLET_WIDGETS_KEY) === 'on'; } catch { return false; }
}
function setWidgetsEnabled(on) {
  try { localStorage.setItem(TABLET_WIDGETS_KEY, on ? 'on' : 'off'); } catch {}
  _applyWidgetChrome();
}

// Icon colours: 'app' tints by TOS_APP_HUES, 'theme' by the accent. Set on <html> so
// the drag clone on <body> follows it.
const TABLET_ICON_COLOR_KEY = 'architect_tablet_icon_color';
function iconsThemed() {
  try { return localStorage.getItem(TABLET_ICON_COLOR_KEY) === 'theme'; } catch { return false; }
}
function setIconsThemed(on) {
  try { localStorage.setItem(TABLET_ICON_COLOR_KEY, on ? 'theme' : 'app'); } catch {}
  _applyWidgetChrome();
}

// ── Per-card off switch ──────────────────────────────────────────────────────
// Press and hold a card to put it away. Its own list, not 'removed', so the app keeps
// its tile; it beats 'alwaysOn'. Restored under Settings → Layout → Home Widgets.
const TABLET_WIDGETS_OFF_KEY = 'architect_tablet_widgets_off';
// The press-held card awaiting confirm. Module state because home re-renders on every payload.
let _tosWidgetArm = null;
// Swallow the click from the pointerup that ends a press-hold.
let _suppressWidgetClick = false;
function loadWidgetsOff() {
  try { const a = JSON.parse(localStorage.getItem(TABLET_WIDGETS_OFF_KEY)); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
function saveWidgetsOff(ids) {
  try { localStorage.setItem(TABLET_WIDGETS_OFF_KEY, JSON.stringify(ids || [])); } catch {}
}
function setWidgetOff(id, off) {
  const cur = loadWidgetsOff().filter(x => x !== id);
  saveWidgetsOff(off ? [...cur, id] : cur);
}
// The restore row, named by APP (the server's card title changes by the hour).
// Absent when nothing is switched off.
function renderHiddenCardsRow() {
  const offIds = loadWidgetsOff();
  if (!offIds.length) return '';
  const byId = new Map([...(_data?.apps || []), ...CLIENT_APPS].map(a => [a.id, a]));
  const chips = offIds.map(id =>
    `<span class="tos-btn-sub" data-widget-on="${esc(id)}" style="margin:0 4px 4px 0">${esc(byId.get(id)?.name || id)}</span>`).join('');
  return `<div class="tos-set-row"><span class="tos-set-label">Hidden Cards<span class="tos-set-val">Press-held off the home screen</span></span>
    <span style="display:flex;flex-wrap:wrap;justify-content:flex-end;max-width:60%">${chips}</span></div>`;
}

// Size the chassis for what's on the home screen; called on open and every toggle.
function _applyWidgetChrome() {
  document.documentElement.classList.toggle('tos-icons-theme', iconsThemed());
  if (!_overlay) return;
  _overlay.classList.toggle('tos-no-widgets', !widgetsEnabled());
}

function renderHomeWidgets(widgets) {
  if (!widgetsEnabled()) return '';
  // A card shows unless its app was REMOVED (seed-stashed doesn't count; see
  // loadRemovedApps). 'alwaysOn' cards (alarms) show regardless; the server decides that.
  const removed = new Set(loadRemovedApps());
  const off = new Set(loadWidgetsOff());
  const cards = (widgets || []).filter(w => !off.has(w.nav) && (w.alwaysOn || !removed.has(w.nav))).map(w => {
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
      // Optional glyph carries the meaning; the first line is the headline.
      const ls = w.lines || [];
      const rows = ls.map((l, i) => `<div class="tos-wg-line${i === 0 ? ' lead' : ''}">`
        + `<span>${esc(l.text)}</span>${l.sub ? `<span class="tos-wg-lsub">${esc(l.sub)}</span>` : ''}</div>`).join('');
      body = w.icon
        ? `<div class="tos-wg-glyphed"><span class="tos-wg-glyph">${esc(w.icon)}</span><div class="tos-wg-lstack">${rows}</div></div>`
        : rows;
    } else if (w.kind === 'bar') {
      // A proportion: one stacked bar plus a keyed legend.
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
    // The held card shows its own confirm; a tap elsewhere disarms. Two taps to lose a card.
    const armed = w.nav && _tosWidgetArm === w.nav
      ? `<div class="tos-wg-arm"><span class="tos-wg-armq">Hide this card?</span>
         <span class="tos-wg-armbtn" data-widget-off="${esc(w.nav)}">Hide</span>
         <span class="tos-wg-armbtn alt" data-widget-keep="1">Keep</span></div>`
      : '';
    return `<div class="tos-widget${armed ? ' armed' : ''}"${nav}><div class="tos-wg-title">${esc(w.title || '')}</div>${body}${armed}</div>`;
  }).filter(Boolean).join('');
  return cards ? `<div class="tos-widgets">${cards}</div>` : '';
}

// The "add removed apps" sheet, client-side. 'intoGap' is the hole tile it was opened
// from: the chosen app lands in that cell, not at the end of the last page.
function openAddAppsSheet(intoGap) {
  if (!_overlay) return;
  const screen = _overlay.querySelector('#tos-screen-inner');
  if (!screen) return;
  screen.querySelector('.tos-addsheet')?.remove();
  const hidden = loadHiddenApps();
  const byId = new Map([...(_data?.apps || []), ...CLIENT_APPS].map(a => [a.id, a]));
  // Alphabetical: it's scanned by name.
  const apps = hidden.map(id => byId.get(id)).filter(Boolean)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  // Denser grid than home so the whole stash fits without a scrollbar.
  const body = apps.length
    ? `<div class="tos-addsheet-grid">${apps.map(a => {
        return `<div class="tos-tile" data-readd-app="${esc(a.id)}" title="${esc(a.name)}">${tosTileIcon(a)}<span class="tos-name">${esc(a.name)}</span></div>`;
      }).join('')}</div>`
    : '<div class="tos-empty">Everything is on your home screen. Drag an app off the tablet to stash it here.</div>';
  const sheet = document.createElement('div');
  sheet.className = 'tos-addsheet';
  sheet.innerHTML = `<div class="tos-addsheet-card wide">
    <div class="tos-addsheet-hdr"><span>${intoGap ? 'Add app here' : 'Add apps'} · ${apps.length}</span><span class="tos-addsheet-x" data-addsheet-close title="Close">✕</span></div>
    ${body}
  </div>`;
  screen.appendChild(sheet);
  sfx(TOS_SELECT_DEF);
  const close = () => sheet.remove();
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  sheet.querySelector('[data-addsheet-close]')?.addEventListener('click', close);
  sheet.querySelectorAll('[data-readd-app]').forEach(el => el.addEventListener('click', () => {
    // Same install ceremony as an unlock (beginInstall unhides and pages to it).
    const appId = el.getAttribute('data-readd-app');
    // Claim the hole BEFORE beginInstall so the animation plays in the tapped cell.
    if (intoGap) {
      const order = loadAppOrder();
      if (order.includes(intoGap)) saveAppOrder(order.map(x => (x === intoGap ? appId : x)));
      else {
        // A padding cell isn't in the saved order yet: place the app and save the
        // page, which writes the cells in front of it as holes.
        const pad = _overlay.querySelector(`[data-home-gap="${CSS.escape(intoGap)}"]`);
        const home = _overlay.querySelector('.tos-home-apps');
        if (pad && home) {
          pad.removeAttribute('data-home-gap');
          pad.removeAttribute('data-home-pad');
          pad.setAttribute('data-nav-app', appId);
          persistHomeArrangement(home);
        }
      }
    }
    beginInstall(appId);
    close();
    render();  // rebuild home from _data with the app restored
  }));
}

// ── Carrying an app to another page ──────────────────────────────────────────
// Hold a lifted tile against a screen edge and the page turns under it; past the
// last page it makes a new one. A second route alongside the page dots.
const HOME_EDGE_MS = 430;  // dwell before the page turns (and between repeats); the
                           // band's width is the .tos-page-edge rule's, not a number here
function showPageEdges() {
  const home = _overlay?.querySelector('.tos-home-apps');
  if (!home || home.querySelector('.tos-page-edge')) return;
  for (const side of ['left', 'right']) {
    const el = document.createElement('div');
    el.className = 'tos-page-edge ' + side;
    el.innerHTML = `<span class="tos-page-edge-ar">${side === 'left' ? '‹' : '›'}</span>`;
    home.appendChild(el);
  }
}
function hidePageEdges() {
  _overlay?.querySelectorAll('.tos-page-edge').forEach(e => e.remove());
}
// Hit-test the painted edge bands themselves, so it stays right under the CRT scale transform.
function pageEdgeSide(x, y) {
  for (const el of (_overlay?.querySelectorAll('.tos-page-edge') || [])) {
    const b = el.getBoundingClientRect();
    if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) {
      return el.classList.contains('left') ? 'left' : 'right';
    }
  }
  return '';
}
function markPageEdge(side) {
  _overlay?.querySelectorAll('.tos-page-edge').forEach(e =>
    e.classList.toggle('hot', !!side && e.classList.contains(side)));
}
// Page count read off the dots last drawn (one page draws none, hence the floor of 1).
function homePageCount() {
  return Math.max(1, _overlay?.querySelectorAll('.tos-page-dot').length || 1);
}

// Long-press-to-lift drag reorder for the home grid. Wired each home render; window
// listeners live only for a press, so re-wiring can't leak them.
function wireAppGridDrag(container) {
  const LIFT_MS = 300;   // hold this long (finger still) to pick a tile up
  const CANCEL_MOVE = 10; // moving more than this before the lift = a tap/scroll, not a pickup
  let press = null; // { tile, x, y, timer }
  let drag = null;  // { tile, clone, offX, offY }

  // ⚠ The home container is REPLACED on a mid-drag page flip, so never hold the node;
  // read through this. The window listeners survive, carrying the gesture across pages.
  const grid = () => _overlay?.querySelector('.tos-home-apps') || container;

  // AIM only: mark where the tile would land. The move happens once, on release;
  // live reflow made the target flicker.
  const clearDropMark = () => {
    grid().querySelectorAll('.tos-drop-before, .tos-drop-after, .tos-drop-swap')
      .forEach(n => n.classList.remove('tos-drop-before', 'tos-drop-after', 'tos-drop-swap'));
  };
  const aim = (px, py) => {
    // Sweeps every grid (outer plus each group box), holes included: a hole is how
    // you drop into an empty slot.
    const tiles = [...grid().querySelectorAll('.tos-appgrid .tos-tile:not(.tos-tile-add)')];
    let target = null, best = Infinity;
    for (const t of tiles) {
      if (t === drag.tile) continue;
      const b = t.getBoundingClientRect();
      const d = Math.hypot(px - (b.left + b.width / 2), py - (b.top + b.height / 2));
      if (d < best) { best = d; target = t; }
    }
    clearDropMark();
    drag.dropTarget = target || null;
    // A SWAP, not an insert: the target takes the dragged tile's slot, nothing else moves.
    if (target) target.classList.add('tos-drop-swap');
  };

  const begin = () => {
    const tile = press.tile;
    const r = tile.getBoundingClientRect();
    // The clone lives on <body> for plain viewport coords, outside the themed scope,
    // so copy the look across.
    const clone = tile.cloneNode(true);
    clone.className = 'tos-tile-drag';
    const cs = getComputedStyle(tile);
    for (const p of ['backgroundColor', 'backgroundImage', 'border', 'borderRadius', 'color', 'fontFamily', 'padding']) clone.style[p] = cs[p];
    Object.assign(clone.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    document.body.appendChild(clone);
    tile.classList.add('tos-tile-ghost');
    grid().classList.add('tos-grid-arranging');
    showPageEdges();
    _homeDragLifted = true;   // this gesture belongs to the reorder, not to the pager
    drag = { tile, clone, offX: press.x - r.left, offY: press.y - r.top, fromGrid: tile.parentElement };
    press = null;
    sfx(TOS_SELECT_DEF);
  };

  // Pointer outside the screen: dropping flings the app into the ⊕ stash.
  const offTablet = (x, y) => {
    const screen = _overlay?.querySelector('#tos-screen-inner');
    if (!screen) return false;
    const b = screen.getBoundingClientRect();
    return x < b.left || x > b.right || y < b.top || y > b.bottom;
  };

  // Edge dwell: commit the app to the new page (pages derive from the saved order),
  // rebuild, re-attach to the new node and re-arm, so holding walks several pages.
  const armEdge = (side) => {
    if (!drag || drag.edgeSide === side) return;
    clearTimeout(drag.edgeTimer);
    drag.edgeSide = side;
    markPageEdge(side);
    if (side) drag.edgeTimer = setTimeout(() => flipPage(side), HOME_EDGE_MS);
  };
  const flipPage = (side) => {
    if (!drag) return;
    const appId = drag.tile.getAttribute('data-nav-app');
    const dir = side === 'left' ? -1 : 1;
    const target = _homePage + dir;
    // One past the last page makes a new page, unless the tile is already alone here
    // (or holding the edge would spawn empty pages forever).
    const alone = grid().querySelectorAll('.tos-appgrid .tos-tile:not(.tos-tile-gap):not(.tos-tile-add)').length <= 1;
    if (!appId || target < 0 || target > homePageCount() || (target >= homePageCount() && alone)) {
      markPageEdge('');
      drag.edgeSide = null;
      return;
    }
    moveIdsToPage(grid(), [appId], target);
    // A group can't straddle a page, so leaving the page leaves the box.
    saveAppGroups(loadAppGroups().map(g => ({ ...g, apps: g.apps.filter(x => x !== appId) })));
    _homePage = target;
    render();
    let live = _overlay?.querySelector(`.tos-tile[data-nav-app="${CSS.escape(appId)}"]`);
    if (!live) {
    // Didn't land where we turned to: turn back and stay in the gesture.
      _homePage = target - dir;
      render();
      live = _overlay?.querySelector(`.tos-tile[data-nav-app="${CSS.escape(appId)}"]`);
      if (!live) { drag.clone.remove(); drag = null; hidePageEdges(); return; }
    }
    drag.tile = live;
    drag.fromGrid = live.parentElement;
    live.classList.add('tos-tile-ghost');
    grid().classList.add('tos-grid-arranging');
    showPageEdges();
    clearDropMark();
    drag.dropTarget = null;
    sfx(TOS_SELECT_DEF);
    drag.edgeSide = null;
    armEdge(side);   // still holding → keep turning
  };

  const onMove = (e) => {
    if (drag) {
      e.preventDefault();
      drag.clone.style.left = (e.clientX - drag.offX) + 'px';
      drag.clone.style.top = (e.clientY - drag.offY) + 'px';
      drag.lastX = e.clientX; drag.lastY = e.clientY;
      const off = offTablet(e.clientX, e.clientY);
      drag.clone.classList.toggle('tos-tile-removing', off);
      if (off) { clearDropMark(); drag.dropTarget = null; armEdge(''); }
      else { armEdge(pageEdgeSide(e.clientX, e.clientY)); aim(e.clientX, e.clientY); }
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
      clearTimeout(drag.edgeTimer);
      hidePageEdges();
      const dropOff = offTablet(drag.lastX, drag.lastY);
      const appId = drag.tile.getAttribute('data-nav-app');
      drag.clone.remove();
      drag.tile.classList.remove('tos-tile-ghost');
      grid().classList.remove('tos-grid-arranging');
      _suppressTileClick = true;                       // the drop's trailing click must not open an app
      setTimeout(() => { _suppressTileClick = false; }, 0);
      if (dropOff && appId) {
        // Flung off → stash under ⊕. The slot stays open; the page doesn't re-pack.
        replaceOrderIdWithGap(appId);
        hideApp(appId);
        drag = null;
        render();
        return;
      }
      // Dropped on a page dot → send the app to that page.
      const dot = document.elementFromPoint(drag.lastX, drag.lastY)?.closest?.('[data-home-page]');
      if (dot && appId) {
        const g = grid();
        drag = null;
        moveAppToPage(g, appId, Number(dot.getAttribute('data-home-page')) || 0);
        return;
      }
      // The one move, a straight SWAP. Done with a marker so it's safe for neighbours
      // (two naive inserts collapse there).
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
      persistHomeArrangement(grid());
      // Crossing a box boundary changes membership (and can empty a box): full rebuild.
      if (movedBox) render();
    }
  };

  container.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || _tosSelectMode) return;                   // selection mode owns the gesture
    const tile = e.target.closest('.tos-tile');
    // ⧉/⊕ and holes aren't draggable; a press on a hole falls through to the pager swipe.
    if (!tile || tile.classList.contains('tos-tile-add') || tile.classList.contains('tos-tile-gap')) return;
    press = { tile, x: e.clientX, y: e.clientY, timer: setTimeout(begin, LIFT_MS) };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });
}

// Whole-group drag: press-hold a group's LABEL to move the box beside another
// top-level item on the page, never inside one (that would be a merge). Separate
// from the tile drag so the two can't compete. Nothing moves until release.
function wireGroupDrag(container) {
  const LIFT_MS = 300;
  const CANCEL_MOVE = 10;
  let press = null;   // { box, x, y, timer }
  let drag = null;    // { box, clone, offX, offY, lastX, lastY, dropTarget, dropAfter }

  // Targets are the home grid's direct children only (a tile inside another group
  // would be a merge). Never hold the container: a page flip replaces it.
  const grid = () => _overlay?.querySelector('.tos-home-apps') || container;
  const siblings = () => {
    const g = grid().querySelector('.tos-homegrid');
    return g ? [...g.children].filter(el => el !== drag.box) : [];
  };

  const clearDropMark = () => {
    grid().querySelectorAll('.tos-drop-before, .tos-drop-after, .tos-drop-swap')
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
    grid().classList.add('tos-grid-arranging');
    showPageEdges();
    _homeDragLifted = true;
    drag = { box, clone, offX: press.x - r.left, offY: press.y - r.top };
    press = null;
    sfx(TOS_SELECT_DEF);
  };

  // Past the tablet edge: stash every app in the box.
  const offTablet = (x, y) => {
    const screen = _overlay?.querySelector('#tos-screen-inner');
    if (!screen) return false;
    const b = screen.getBoundingClientRect();
    return x < b.left || x > b.right || y < b.top || y > b.bottom;
  };

  const armEdge = (side) => {
    if (!drag || drag.edgeSide === side) return;
    clearTimeout(drag.edgeTimer);
    drag.edgeSide = side;
    markPageEdge(side);
    if (side) drag.edgeTimer = setTimeout(() => flipPage(side), HOME_EDGE_MS);
  };
  const flipPage = (side) => {
    if (!drag) return;
    const groupId = drag.box.getAttribute('data-group-id');
    const group = groupId ? loadAppGroups().find(x => x.id === groupId) : null;
    const dir = side === 'left' ? -1 : 1;
    const target = _homePage + dir;
    // A box alone on its page has nowhere new to go.
    const alone = grid().querySelectorAll('.tos-homegrid > :not(.tos-tile-gap)').length <= 1;
    if (!group || target < 0 || target > homePageCount() || (target >= homePageCount() && alone)) {
      markPageEdge(''); drag.edgeSide = null; return;
    }
    moveIdsToPage(grid(), group.apps, target);
    _homePage = target;
    render();
    const live = _overlay?.querySelector(`.tos-appgroup[data-group-id="${CSS.escape(groupId)}"]`);
    if (!live) { drag.clone.remove(); drag = null; hidePageEdges(); return; }
    drag.box = live;
    live.classList.add('tos-appgroup-ghost');
    grid().classList.add('tos-grid-arranging');
    showPageEdges();
    clearDropMark();
    drag.dropTarget = null;
    sfx(TOS_SELECT_DEF);
    drag.edgeSide = null;
    armEdge(side);
  };

  const onMove = (e) => {
    if (drag) {
      e.preventDefault();
      drag.clone.style.left = (e.clientX - drag.offX) + 'px';
      drag.clone.style.top = (e.clientY - drag.offY) + 'px';
      drag.lastX = e.clientX; drag.lastY = e.clientY;
      const off = offTablet(e.clientX, e.clientY);
      drag.clone.classList.toggle('tos-tile-removing', off);
      if (off) { clearDropMark(); drag.dropTarget = null; armEdge(''); }
      else { armEdge(pageEdgeSide(e.clientX, e.clientY)); aim(e.clientX, e.clientY); }
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
      clearTimeout(drag.edgeTimer);
      hidePageEdges();
      const dropOff = offTablet(drag.lastX, drag.lastY);
      const groupId = drag.box.getAttribute('data-group-id');
      drag.clone.remove();
      drag.box.classList.remove('tos-appgroup-ghost');
      grid().classList.remove('tos-grid-arranging');
      _suppressTileClick = true;   // the drop's trailing click must not open the edit sheet
      setTimeout(() => { _suppressTileClick = false; }, 0);
      const group = groupId ? loadAppGroups().find(x => x.id === groupId) : null;
      if (dropOff && group) {
        // Flung off → stash every member. The group def stays (pruned once empty),
        // so a re-added app can rejoin it.
        group.apps.forEach(id => { replaceOrderIdWithGap(id); hideApp(id); });
        drag = null;
        render();
        return;
      }
      const dot = document.elementFromPoint(drag.lastX, drag.lastY)?.closest?.('[data-home-page]');
      if (dot && group) {
        const g = grid();
        drag = null;
        moveGroupToPage(g, group.apps, Number(dot.getAttribute('data-home-page')) || 0);
        return;
      }
      const target = drag.dropTarget;
      clearDropMark();
      if (target && target !== drag.box) {
        target.parentElement.insertBefore(drag.box, drag.dropAfter ? target.nextSibling : target);
      }
      drag = null;
      persistHomeArrangement(grid());   // the box's new sibling position IS the new order
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

// Read the home screen back out of the DOM and cache it (order plus group membership).
function persistHomeArrangement(container) {
  // Direct children only, so box members aren't counted twice. Membership is apps
  // only: a stored hole would render a phantom app.
  const idsOf = (grid) => [...grid.children]
    .filter(el => el.classList.contains('tos-tile'))
    .map(t => t.getAttribute('data-nav-app')).filter(Boolean);
  const grids = [...container.querySelectorAll('.tos-appgrid')];
  // Reading order: walk the grid's children, splicing each box's members in place.
  const home = container.querySelector('.tos-homegrid');
  const visible = [];
  // Padding cells are saved as holes only if an app follows them; trailing ones drop.
  let pads = [];
  for (const el of (home ? [...home.children] : [])) {
    if (el.classList.contains('tos-tile')) {
      const id = el.getAttribute('data-nav-app') || el.getAttribute('data-home-gap');
      if (!id) continue;
      if (el.hasAttribute('data-home-pad')) { pads.push(id); continue; }
      visible.push(...pads, id); pads = [];
    } else if (el.classList.contains('tos-appgroup')) {
      const inner = el.querySelector('.tos-grp-inner');
      if (inner) { visible.push(...pads, ...idsOf(inner)); pads = []; }
    }
  }

  // ⚠ Only the current page is in the DOM: splice its ids back into the saved order
  // at its position, never replace the order (that erases every other page).
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
  const live = new Map(grids.map(g => [g.getAttribute('data-group-grid'), idsOf(g)]));
  saveAppGroups(loadAppGroups().map(g => live.has(g.id) ? { ...g, apps: live.get(g.id) } : g));
}

function selectedAppTiles(container) {
  return [...(container || _overlay || document).querySelectorAll('.tos-tile-sel')];
}
function refreshSelCount(container) {
  const n = selectedAppTiles(container).length;
  const el = container.querySelector('[data-sel-count]');
  if (el) el.textContent = String(n);
}
// Leave selection mode and rebuild home. Every exit route comes through here.
function exitAppSelectMode() {
  if (!_tosSelectMode) return;
  _tosSelectMode = false;
  render();
}

// Where each page STARTS in the flat order, using paginateHome's cost rule (tile 1,
// box its block, paid by its first member). ⚠ A stashed app costs nothing:
// renderHomeApps filters them before paginating, so counting them shifts boundaries.
function homePageStarts(order) {
  const hidden = new Set(loadHiddenApps());
  const groupOf = new Map();
  for (const g of loadAppGroups()) for (const id of g.apps) if (!groupOf.has(id)) groupOf.set(id, g);
  const counts = new Map();
  for (const id of order) {
    if (hidden.has(id)) continue;
    const g = groupOf.get(id); if (g) counts.set(g.id, (counts.get(g.id) || 0) + 1);
  }
  const drawn = new Set();
  const starts = [0];
  let left = HOME_SLOTS, any = false;
  for (let i = 0; i < order.length; i++) {
    if (hidden.has(order[i])) continue;   // not drawn, so it occupies no cell
    const g = groupOf.get(order[i]);
    let cost = 1;
    if (g) {
      if (drawn.has(g.id)) continue;   // a later member rides along in the same box
      drawn.add(g.id);
      const cols = groupCols(g);
      cost = cols * Math.ceil((counts.get(g.id) || 1) / cols);
    }
    if (cost > left && any) { starts.push(i); left = HOME_SLOTS; any = false; }
    left = Math.max(0, left - cost);
    any = true;
  }
  return starts;
}

// Shared move for cross-page drops (dots and edge-hold). The app leaves a HOLE
// behind, and lands in the target page's first hole, else appends, so moving back
// and forth is stable. targetPage one past the last means a new page.
function moveIdsToPage(container, ids, targetPage) {
  const visible = [...(container?.querySelectorAll('.tos-appgrid .tos-tile:not([data-home-pad])') || [])]
    .map(t => t.getAttribute('data-nav-app') || t.getAttribute('data-home-gap')).filter(Boolean);
  // The DOM has only this page: start from the saved order, else the visible one.
  const saved = loadAppOrder();
  const full = saved.length ? saved : visible;
  const set = new Set(ids);
  const moving = full.filter(id => set.has(id));   // preserve their relative order
  for (const id of ids) if (!moving.includes(id)) moving.push(id);   // never saved yet (a brand-new app)
  const out = full.map(id => (set.has(id) ? newHomeGap() : id));
  const starts = homePageStarts(out);
  const from = starts[targetPage] ?? out.length;
  let to = starts[targetPage + 1] ?? out.length;
  for (const id of moving) {
    let slot = -1;
    for (let i = from; i < Math.min(to, out.length); i++) if (isHomeGap(out[i])) { slot = i; break; }
    if (slot >= 0) out[slot] = id;
    else {
      // Target page full: walk the insert back until the tile lands ON the target
      // page (splicing at its end paginated it onto the next one), and let the
      // displaced block overflow.
      let at = to;
      out.splice(at, 0, id);
      while (at > from && at >= (homePageStarts(out)[targetPage + 1] ?? out.length)) {
        out.splice(at, 1); at--; out.splice(at, 0, id);
      }
      to++;
    }
  }
  saveAppOrder(out);
}

// Send one app to another page. A grouped app leaves its group (a box can't
// straddle a page; moveGroupToPage moves the whole box).
function moveAppToPage(container, appId, targetPage) {
  moveIdsToPage(container, [appId], targetPage);
  saveAppGroups(loadAppGroups().map(g => ({ ...g, apps: g.apps.filter(x => x !== appId) })));
  _homePage = targetPage;
  render();
}

function moveGroupToPage(container, ids, targetPage) {
  moveIdsToPage(container, ids, targetPage);
  _homePage = targetPage;
  render();
}

// Rectangular lasso while selection mode is armed. Additive; a tap toggles one tile.
function wireAppMarquee(container) {
  const ENGAGE = 6; // pixels of travel before a press becomes a lasso
  let sel = null;   // { x, y, band, base:Set }

  const paint = (x, y) => {
    const left = Math.min(sel.x, x), top = Math.min(sel.y, y);
    const w = Math.abs(x - sel.x), h = Math.abs(y - sel.y);
    Object.assign(sel.band.style, { left: left + 'px', top: top + 'px', width: w + 'px', height: h + 'px' });
    for (const t of container.querySelectorAll('.tos-appgrid .tos-tile:not(.tos-tile-add):not(.tos-tile-gap)')) {
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
      // The band lives on <body> like the drag clone; copy the accent across.
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

// The group sheet: name + colour for a new box ({ ids }) or an existing one
// ({ groupId }, which also offers Ungroup). Client-side.
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

// Drag-to-scroll for any overflowing screen, wired once on #tos-scroll. Presses on
// inputs or home tiles are left alone; engages past a threshold and swallows the
// trailing click.
function wireDragScroll(scroll) {
  const THRESH = 6;      // px of movement before a press becomes a gesture (below = a tap)
  const SWIPE_MIN = 45;  // px of horizontal travel to commit a page change
  let start = null;      // { x, y, top, dragging, axis, dx }
  // Horizontal swipe pages the Codex's Orders section (test the section kind).
  const ideoActive = () => _data?.view === 'codex' && _data?.sectionKind === 'orders';

  // '.tos-al-reel' runs its own grab-and-pull; panning too would desync the time.
  // '.tos-fake' (ARCHITECT's fake game) is spans and divs, so a 6px wobble would eat taps.
  const isInteractive = (el) =>
    el.closest('input, textarea, select, button, [contenteditable], .tos-tile, .tos-color, input[type=range], .tos-al-reel, #tos-worldmap, .tos-fake');

  const onMove = (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!start.dragging) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < THRESH) return;
      start.dragging = true;
      // Lock the axis at the threshold; only the Orders reader claims horizontal.
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
    // In selection mode the lasso owns every press over the home grid.
    if (_tosSelectMode && e.target.closest('.tos-home-apps')) return;
    start = { x: e.clientX, y: e.clientY, top: scroll.scrollTop, dragging: false, axis: null, dx: 0 };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });

  // Horizontal wheel pages the reader, debounced, only on clear horizontal intent.
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

// In-app tab strip: a payload with 'tabs' ([{id,label}]) + 'activeTab' gets one
// under the breadcrumb; a tab navigates to that screen id.
function renderTosTabs(d) {
  if (!d?.tabs?.length) return '';
  const tabs = d.tabs.map(t =>
    `<button class="tos-tab${t.id === d.activeTab ? ' active' : ''}" data-tos-tab="${esc(t.id)}">${esc(t.label)}</button>`
  ).join('');
  return `<div class="tos-tabs" role="tablist">${tabs}</div>`;
}

function renderList(items) {
  if (!items || !items.length) return '<div class="tos-empty">Nothing here.</div>';
  // Nesting is opt-in per row: 'group' heads a set, 'child' sits under it, 'option'
  // is one of several ANSWERS (no checkbox, "OR" after the first), 'part' is one of
  // several COMPONENTS (keeps checkbox and badge). The Cookbook shopping list uses all.
  // A row that navigates is a <button type="button">; others stay <div> so headings
  // aren't tab stops. Only rows WITH an id get data-open-item: an empty one navigates
  // to the app root.
  return items.map(it => {
    const oid = it.id == null ? '' : String(it.id);
    const cls = `tos-list-item${it.group ? ' tos-li-group' : ''}${it.child ? ' tos-li-child' : ''}${it.option ? ' tos-li-option' : ''}${it.part ? ' tos-li-part' : ''}${oid ? '' : ' tos-li-static'}`;
    const inner = `<div class="tos-li-label"><span>${it.or ? '<span class="tos-li-or">or</span>' : ''}${esc(it.label)}</span>${it.badge && !it.option ? `<span class="tos-badge ${esc(it.badge)}">${esc(it.badgeLabel || it.badge)}</span>` : ''}</div>
    ${it.sub ? `<div class="tos-li-sub">${esc(it.sub)}</div>` : ''}`;
    return oid
      ? `<button type="button" class="${cls}" data-open-item="${esc(oid)}">${inner}</button>`
      : `<div class="${cls}">${inner}</div>`;
  }).join('');
}

// Calendar month grid. Prev/next re-nav with screenId 'month' + a 'YYYY-MM' token
// (wired in wireBody). This helper squeezes an event title into a cell by dropping
// noise words and truncating; the full text stays in the hover title.
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
    // Escape each event before joining with &#10;, or the entity gets double-encoded.
    const tip = evs.map(e => `${e.kind === 'rent' ? '🏠 ' : '• '}${esc(e.text)}${e.detail ? ` (${esc(e.detail)})` : ''}`).join('&#10;');
    const kinds = [...new Set(evs.map(e => e.kind))];
    const dots = has ? `<div class="tos-cal-dots">${kinds.map(k => `<span class="tos-cal-dot tos-cal-dot-${esc(k)}"></span>`).join('')}</div>` : '';
    // Touch can't hover, so the first event's text rides in the cell (+N for more).
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
// Every cover is generated from the book's id (one hash, one hue), so a book is
// always the same colour and needs no art.
function bookHue(id) {
  let h = 0;
  for (let i = 0; i < String(id).length; i++) h = (h * 31 + String(id).charCodeAt(i)) % 360;
  return h;
}

// A book's cloth-and-foil plate; 'size' picks the shelf tile or the cover page.
function renderBookPlate(b, size) {
  const hue = bookHue(b.id);
  // Initials, not a truncated title: a title wraps to mush at shelf size.
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
    // Progress is the bookmark: there's no finished flag.
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
  return `<div class="tos-lib-shelf">${cards}</div><div class="tos-lib-board"></div>`;
}

// The longbox: comics filed face-out in bags, not a relabelled shelf.
function renderLongbox(d) {
  const comics = d.books || [];
  if (!comics.length) return '<div class="tos-empty">Nothing here.</div>';
  const cards = comics.map((b, i) => {
    const total = b.chapters || 0;
    const pct = total > 1 ? Math.round((b.at / (total - 1)) * 100) : (b.at ? 100 : 0);
    // Cover date: what's printed on a comic and what a longbox sorts by.
    return `<div class="tos-cm-slot" data-open-item="${esc(b.id)}" style="--bk-hue:${bookHue(b.id)};--tilt:${(i % 3) - 1}deg">
      <div class="tos-cm-bag">
        <div class="tos-cm-cover">
          <div class="tos-cm-cover-date">${esc(String(b.year || ''))}</div>
          <div class="tos-cm-cover-title">${esc(b.title)}</div>
          <div class="tos-cm-cover-by">${esc(b.author)}</div>
          ${b.at > 0 ? `<div class="tos-cm-cover-read">READ</div>` : ''}
        </div>
      </div>
      <div class="tos-cm-slot-meta">${total} part${total === 1 ? '' : 's'}${b.at > 0 ? ` · ${pct}%` : ''}</div>
    </div>`;
  }).join('');
  return `<div class="tos-cm-box">${cards}</div><div class="tos-lib-board"></div>`;
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

// Help-app reader: blurb + sections, each a prose block or a headed command group
// ('mono' renders the command line monospace).
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

// Prev/Next for a 'list' screen with a 'page' field; re-navs with a 'page:N' token.
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

// A detail row picks its own layout:
//   "—" + nothing   → a divider
//   no label        → continuation of the row above
//   long value      → stacked label over full-width text
//   otherwise       → label/value pair
const TOS_PROSE_CHARS = 44;

function renderDetailRows(rows) {
  return (rows || []).map(r => {
    const label = String(r.label ?? '');
    const value = String(r.value ?? '');
    if (!value && (label === '—' || label === '-' || label === '')) return '<div class="tos-row-sep"></div>';
    // An opt-in section heading inside a card.
    if (r.heading) return `<div class="tos-row-head">${esc(label)}</div>`;
    if (!label) return `<div class="tos-row tos-row-cont"><span></span><span>${esc(value)}</span></div>`;
    if (value.length > TOS_PROSE_CHARS) {
      return `<div class="tos-row tos-row-block"><span class="tos-row-k">${esc(label)}</span><span class="tos-row-v">${esc(value)}</span></div>`;
    }
    return `<div class="tos-row"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;
  }).join('');
}

// Settings, rendered natively. Every control goes through loadSettings/saveSettings/
// applySettings on the shared 'architect_settings', so it stays in sync with the
// game panel. Sliders update live so dragging isn't interrupted.

// Pill groups mapping 1:1 to a settings key. dpadSize is mobile-only.
const TOS_OPT_GROUPS = [
  // Access settings live in A11Y_OPTIONS (Accessibility page); this list is taste only.
  { key: 'sidebarPosition', label: 'Sidebar', opts: [
    { v: 'left', t: 'Sidebar Left', g: '⬅️' }, { v: 'right', t: 'Sidebar Right', g: '➡️' } ] },
  { key: 'weatherFx', label: 'Weather FX', opts: [
    { v: 'on', t: 'Weather FX On', g: '🌧️' }, { v: 'off', t: 'Off', g: '🚫' } ] },
  // Cel shading for the 3-D views (main.js _applyCelShade). GLASS 2 only.
  { key: 'celShade', label: 'Cel Shading', opts: [
    { v: 'off', t: 'Off: the city as it is lit now', g: '◐' },
    { v: 'on', t: 'On: flat light and ink outlines', g: '✎' } ] },
  // GLASS 2 or GLASS 1 (main.js _applyGlass). GLASS 1 is the fallback, without cel shading.
  { key: 'glass', label: 'Renderer', opts: [
    { v: '2', t: 'GLASS 2: the GPU renderer, lit and shadowed', g: 'G2', s: 'font-size:0.6875rem;letter-spacing:1px' },
    { v: '1', t: 'GLASS 1: the 2-D painter, lighter on a slow machine', g: 'G1', s: 'font-size:0.6875rem;letter-spacing:1px' } ] },
  { key: 'dpadSize', label: 'D-Pad Size', mobileOnly: true, opts: [
    { v: 'small', t: 'Small', g: 'S' }, { v: 'medium', t: 'Medium', g: 'M' }, { v: 'large', t: 'Large', g: 'L' } ] },
  { key: 'tempUnit', label: 'Temp Units', opts: [
    { v: 'C', t: 'Celsius', g: 'C°' }, { v: 'F', t: 'Fahrenheit', g: 'F°' } ] },
  // Minimap overlay: minimap.js reads it via window._applyMapOverlay.
  { key: 'mapOverlay', label: 'Map Labels', opts: [
    { v: 'labels', t: 'Lettering: the building’s 2-letter code', g: 'AB', s: 'font-size:0.6875rem;letter-spacing:1px' },
    { v: 'none', t: 'Plain tiles: no lettering', g: '▫' } ] },
  // Landmark colour: minimap.js reads it via window._applyMapColor. Off is the plain map.
  { key: 'mapColor', label: 'Map Colour', opts: [
    { v: 'off', t: 'Plain: white labels, untinted buildings', g: '▫' },
    { v: 'on', t: 'Colour: a colour per landmark kind', g: '◼', s: 'color:#8b46c7' } ] },
  // Minimap renderer. Classic is a real fallback for when the canvas path misbehaves,
  // so it must be reachable without devtools.
  { key: 'minimapRender', label: 'Minimap', opts: [
    { v: 'smooth', t: 'Smooth: the map glides as you walk', g: '🌊' },
    { v: 'classic', t: 'Classic: tiles snap into place', g: '▦' } ] },
];
const TOS_AUDIO_TOGGLES = [
  { key: 'music', label: 'Music', on: '🎵', off: '🔇' },
  { key: 'sfx', label: 'SFX', on: '💥', off: '🔕' },
  { key: 'tv', label: 'TV Audio', on: '📺', off: '📵' },
  { key: 'welcome', label: 'Welcome Voice', on: '👋', off: '🔕' },
  { key: 'muteWhenHidden', label: 'Mute When Hidden', on: '🙈', off: '▶️' },
];
// How a vehicle seat places sound around you (AudioEngine's spatialAudio, applied in settings.js).
const TOS_SPATIAL_OPTS = [
  { v: 'auto', t: 'Auto: headphone 3D for the nearest few, simpler panning past them (fewer on a phone)', g: 'Auto' },
  { v: 'hrtf', t: 'Headphone 3D for the nearest few on any device', g: 'HRTF' },
  { v: 'equalpower', t: 'Simple 3D panning: cheapest on a slow device', g: 'Simple' },
  { v: 'stereo', t: 'Left and right only, no pitch shift as things pass', g: 'Stereo' },
];
const TOS_VOL_SLIDERS = [
  { key: 'masterVolume', label: 'Master', g: '🔊' },
  { key: 'musicVolume', label: 'Music', g: '🎵' },
  { key: 'sfxVolume', label: 'SFX', g: '💥' },
  { key: 'ambientVolume', label: 'Ambient', g: '🌫️' },
  { key: 'tvVolume', label: 'TV', g: '📺' },
];

// data-density "compact" gates the mobile-only D-Pad row. data-smart-ui is unrelated.
function tosIsMobile() {
  return document.documentElement.getAttribute('data-density') === 'compact';
}

// Five colours previewed per swatch: accent plus four status hues.
const TOS_SW_DOT_VARS = ['--accent', '--green', '--yellow', '--red', '--purple'];

// A theme as a swatch: its bg2, key palette dots, contrasted name.
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

// Compact trigger showing the active theme; opens the picker sheet. 'kind' is 'ui' or 'tablet'.
function tosThemeTrigger(kind, activeId) {
  const c = probeBuiltinThemeColors(activeId) || {};
  const bg = (c['--bg2'] || '#1a2226').trim(), ac = (c['--accent'] || '#35e0c8').trim();
  const ink = luminanceTextColor(bg) || '#fff';
  return `<div class="tos-theme-trigger" data-open-theme-sheet="${esc(kind)}" title="Choose a theme" style="background:${esc(bg)}">
    <span class="tos-sw-ac" style="background:${esc(ac)};color:${esc(ac)}"></span>
    <span class="tos-sw-name" style="color:${ink}">${esc(tosThemeName(activeId))}</span>
    <span class="tos-trigger-caret" style="color:${ink}">&#9662;</span></div>`;
}

// The theme-picker sheet. 'ui' drives settings.theme; 'tablet' drives the unlinked tablet theme.
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

function renderTabletSettings(d) {
  const s = loadSettings();
  const tt = loadTabletTheme();
  const linked = tt.linked !== false;
  const audio = s.audio || {};
  const pct = (v) => `${Math.round((v ?? 0) * 100)}%`;

  if (_tosThemePicker) return renderThemeSheet(_tosThemePicker);

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

  // Display Mode: a three-rung ladder, and SERVER state (flight reads it at board
  // time). Rendered from the payload's 'displayRung', changed via 'displaymode'.
  // The middle rung isn't a downgrade; keep the sublabels.
  const rungNow = (d && d.displayRung) || 'visual';
  const RUNGS = [
    ['visual', 'Visual', 'Graphics wherever a system has them, the cockpit, the cabin window, the poker felt.'],
    ['textgames', 'Text', 'The games come to you as characters, fly her by command, play cards in the log. Maps and hangars stay on screen.'],
    ['log', 'Log', 'Everything written out where you can scroll back. No panels at all.'],
  ];
  const displayRow = `<div class="tos-set-row"><span class="tos-set-label">Display Mode<span class="tos-set-val">How much of the game is drawn for you</span></span><div class="tos-opts">
    ${RUNGS.map(([id, label, hint]) =>
    `<div class="tos-opt${rungNow === id ? ' selected' : ''}" data-set-display="${id}" title="${esc(hint)}">${esc(label)}</div>`).join('')}
  </div></div>`;

  const feltMode = s.pokerFelt || 'green';
  const feltRow = `<div class="tos-set-row"><span class="tos-set-label">Poker Felt</span><div class="tos-opts">
    <div class="tos-opt${feltMode === 'green' ? ' selected' : ''}" data-set-key="pokerFelt" data-set-val="green" title="Classic Green">🟢</div>
    <div class="tos-opt${feltMode === 'accent' ? ' selected' : ''}" data-set-key="pokerFelt" data-set-val="accent" title="Theme Accent">✨</div>
    <div class="tos-opt${feltMode === 'custom' ? ' selected' : ''}" data-set-key="pokerFelt" data-set-val="custom" title="Custom Colour">🖌️</div>
    <input type="color" class="tos-color" data-set-poker-color="1" value="${esc(s.pokerFeltColor || '#1a4a1a')}" title="Pick a custom felt colour">
  </div></div>`;

  // Extra Lore: server-side preference, mirrored via 'lorealways on|off'.
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
  // Paired audio toggles, icons only (meaning is in the tooltip).
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

  const layoutRows = TOS_OPT_GROUPS
    .filter(gp => !A11Y_OPTIONS.some(a => a.key === gp.key) && (!gp.mobileOnly || tosIsMobile()))
    .map(gp => tosPillRow(gp.label, gp.key, s[gp.key], gp.opts)).join('');

  const wpNow = loadWallpaper();
  const wallpaperRow = `<div class="tos-set-row"><span class="tos-set-label">Wallpaper<span class="tos-set-val">Behind the home screen</span></span><div class="tos-opts">
    ${TABLET_WALLPAPERS.map(wp => `<div class="tos-opt${wp.id === wpNow ? ' selected' : ''}" data-set-wallpaper="${esc(wp.id)}" title="${esc(wp.label)}">${esc(wp.label)}</div>`).join('')}
  </div></div>`;

  // ── Accessibility ─────────────────────────────────────────────────────────
  // One page, each control with ONE home. Rows come from A11Y_OPTIONS (shared with
  // the 'accessibility' verb). Read via effectiveOptionValue: Sound Detail is
  // tri-state with a derived default, so the raw key would show nothing selected.
  const a11yCtx = { displayRung: rungNow };
  const a11yRows = A11Y_OPTIONS.map(o => {
    const eff = String(effectiveOptionValue(o, s, a11yCtx));
    // Pills are <button aria-pressed> in a labelled group, so the page works by
    // keyboard. Not role="radio": that obliges arrow-key navigation.
    return `<div class="tos-set-row tos-a11y-row"><span class="tos-set-label" id="tos-a11y-lbl-${esc(o.key)}">${esc(o.label)}<span class="tos-set-val">${esc(o.why)}</span></span>
      <div class="tos-opts" role="group" aria-labelledby="tos-a11y-lbl-${esc(o.key)}">${o.opts.map(v =>
      `<button type="button" class="tos-opt${eff === String(v.v) ? ' selected' : ''}" aria-pressed="${eff === String(v.v) ? 'true' : 'false'}" data-set-key="${esc(o.key)}" data-set-val="${esc(String(v.v))}" title="${esc(v.t)}">${esc(v.t)}</button>`).join('')}</div></div>`;
  }).join('');

  const pages = {
    General:
      themeSection +
      wallpaperRow +
      feltRow +
      loreRow +
      renderMisSection(),
    Accessibility:
      // Display Mode first and alone: it's server state and changes what the game is.
      displayRow +
      `<div class="tos-set-row"><span class="tos-set-label">Contrast <span class="tos-set-val" data-contrast-label="1">${contrast === 0 ? 'Base' : '+' + contrast + '%'}</span></span>
        <span><input type="range" class="tos-slider" data-set-contrast="1" min="0" max="100" step="1" value="${contrast}">
        <span class="tos-btn-sub" data-contrast-reset="1" style="margin:0 0 0 8px;padding:4px 9px">Reset</span></span></div>` +
      a11yRows +
      `<div class="tos-set-row"><span class="tos-set-label">All of this works as a command<span class="tos-set-val">Type <b>accessibility</b> anywhere: no tablet needed. <b>accessibility reset</b> puts everything back.</span></span></div>`,
    Layout: (layoutRows || '') +
      `<div class="tos-set-row"><span class="tos-set-label">Home Widgets<span class="tos-set-val">Info cards under the app grid</span></span><div class="tos-opts">
        <div class="tos-opt${widgetsEnabled() ? ' selected' : ''}" data-set-widgets="on" title="Show home widgets">On</div>
        <div class="tos-opt${!widgetsEnabled() ? ' selected' : ''}" data-set-widgets="off" title="Hide home widgets">Off</div>
      </div></div>` +
      renderHiddenCardsRow() +
      `<div class="tos-set-row"><span class="tos-set-label">Icon Colours<span class="tos-set-val">Per app, or the tablet theme's accent</span></span><div class="tos-opts">
        <div class="tos-opt${!iconsThemed() ? ' selected' : ''}" data-set-iconcolor="app" title="Each app its own colour">App</div>
        <div class="tos-opt${iconsThemed() ? ' selected' : ''}" data-set-iconcolor="theme" title="Match the tablet theme">Theme</div>
      </div></div>` +
      `<div class="tos-set-row"><span class="tos-set-label">Sidebar Order<span class="tos-set-val">Drag order &amp; hidden panels</span></span>
        <span class="tos-btn-sub" data-reset-sidebar="1" style="margin:0">Reset to Default</span></div>` +
      `<div class="tos-set-row"><span class="tos-set-label">Home App Layout<span class="tos-set-val">Tile order, groups &amp; stashed apps</span></span>
        <span class="tos-btn-sub" data-reset-apps="1" style="margin:0">Reset to Default</span></div>`,
    Sound: soundRow + audioToggleRows + volRows + tosPillRow('3D Sound', 'spatialAudio', s.spatialAudio || 'auto', TOS_SPATIAL_OPTS) +
      `<div class="tos-set-row"><span class="tos-set-label">Sound Settings<span class="tos-set-val">Toggles &amp; volumes</span></span>
        <span class="tos-btn-sub" data-reset-sound="1" style="margin:0">Reset to Default</span></div>`,
    Discord: renderDiscordPage(),
    About: renderAboutPage(),
  };
  const pageNames = Object.keys(pages);
  if (!pageNames.includes(_tosSetPage)) _tosSetPage = pageNames[0];
  const tabs = pageNames.map(n =>
    `<div class="tos-set-tab${n === _tosSetPage ? ' sel' : ''}" data-set-page="${esc(n)}">${esc(n)}</div>`).join('');

  return `<div class="tos-set-tabs">${tabs}</div><div class="tos-set-page">${pages[_tosSetPage]}</div>`;
}

// ── Discord ──────────────────────────────────────────────────────────────────
// The one Settings page that loads from outside the game:
//  • The frame is sandboxed to what the widget needs (scripts, same-origin, pop-ups).
//    Without allow-same-origin it shows nobody online; no forms, no top navigation.
//  • Always with a plain link: a third-party iframe can render nothing.
//  • loading="lazy", so only people who open this page contact discord.com.
const DISCORD_SERVER_ID = '1537202670451040316';
// The invite, deliberately not the widget URL: it works when the widget is off.
// DISCORD_INVITE lives in links.js so input.js's 'discord' verb shares it.
function renderDiscordPage() {
  // Match the tablet theme. LIGHT_THEMES is [value, label] pairs, so this must be a
  // 'some' on the first element; 'includes' is always false.
  const t = loadTabletTheme();
  const name = t.linked ? (loadSettings().theme || 'dark') : (t.theme || 'dark');
  const dark = !LIGHT_THEMES.some(([v]) => v === name);
  const src = `https://discord.com/widget?id=${encodeURIComponent(DISCORD_SERVER_ID)}&theme=${dark ? 'dark' : 'light'}`;
  return `<div class="tos-dis">
    <div class="tos-dis-lede">Who is about, right now. The Basin has a bar and this is it.</div>
    <iframe class="tos-dis-frame" src="${esc(src)}" title="Architect on Discord" loading="lazy"
      sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"></iframe>
    <a class="tos-dis-open" href="${esc(DISCORD_INVITE)}" target="_blank" rel="noopener noreferrer">Join the Discord</a>
  </div>`;
}

// About. Game, then people, then platform: the THOMAS credit sits last. The mark is
// the dev panel boot logo, stroked in currentColor.
function renderAboutPage() {
  return `<div class="tos-about">
    <div class="tos-about-mark">Architect</div>
    <div class="tos-about-rule"></div>
    <div class="tos-about-by">Built by</div>
    <div class="tos-about-names">David Lacey<br>John Akerson</div>
    <div class="tos-about-rule"></div>
    <div class="tos-about-tag">We build this because we want to. The servers just insist on being paid. Chip in if you feel like it, thanks either way.</div>
    <a class="tos-about-bmc" href="https://buymeacoffee.com/haveagreatdave" target="_blank" rel="noopener noreferrer" title="Support Us">
      <span class="tos-about-cup">☕</span><span>Support Us</span>
    </a>
    <div class="tos-about-rule"></div>
    <a class="tos-about-thomas" href="/thomas-client-guide.html" target="_blank" rel="noopener noreferrer" title="THOMAS Client, Power User Guide">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <g fill="none" stroke="currentColor" stroke-width="7" stroke-linejoin="round">
          <path d="M60 8 L112 37 L60 66 L8 37 Z"/>
          <path d="M38 46 L60 58 L82 46 L82 84 L60 96 L38 84 Z"/>
        </g>
      </svg><span>Powered by THOMAS</span>
    </a>
  </div>`;
}

// Mature Content (MIS): server-authoritative (state.player, toggled over raw ws),
// behind the triple-click decoy until revealed per session.
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

// Reflect MIS state in place so a sync doesn't reset scroll. No-op if not shown.
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

// Labeled section (title + HTML), shared by Corp and Settings.
function renderSection(title, html) {
  return `<div style="margin-top:12px;font-size:0.625rem;letter-spacing:1px;text-transform:uppercase;color:var(--tos-fg-dim)">${esc(title)}</div>${html}`;
}

// Corp dashboard: reshapes plugins/corps buildConsolePayload() (via corp-app.js).

// A titled box, one per corp page.
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

// Corp dashboard: boxed sections, paged. Actions and colour picker on Overview.
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

  // flex:1 body keeps Prev/Next pinned to the bottom on every page.
  return `<div class="tos-corp-scroll">${body}</div>${renderCorpPageNav(page)}`;
}

// Territory Map: the 'corp map' grid (cmdCorpMap payload, 2n-1 grid). Selection is
// client-side; tile verbs go through the corp app's handleAction ('mapact').
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
    acts = `<div class="tos-cm-note">▸ Travel to <b>${esc(t.name)}</b> to act: the verbs work where you stand.</div>`;
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
  return `<div class="tos-detail-name" style="font-size:0.9375rem">${esc(t.name)}</div><div class="tos-detail-desc">${t.isCurrent ? "◉ you're here · " : ''}${controller}${home}</div>${tug}${econ}${assets}${artery}${acts}`;
}

// ── Map app ──────────────────────────────────────────────────────────────────
// The city map in the tablet: server buildMapPayload tiles on the 2n-1 grid.
// Selection is client-side; "Route here" plots via setGpsRoute and auto-walks.

function _mapHexRgb(hex) {
  const h = String(hex || '').replace('#', '');
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
}
// A tile's code is 'spec.label', derived once by the build (derive.mjs deriveLabel)
// and read the same here and on the minimap. 'kind': a 'building'/'room' code follows
// the Labels toggle; a 'mark' (zones.marker) always shows.
function _mapLabel(t) {
  return t.spec?.label || null;
}
function _mapTileSym(t) {
  if (t.isCurrent) return '<span class="mt-icon">◉</span>';
  // A named zone-icon SVG beats the POI glyph; the build picks which (spec.feature).
  const feat = t.spec?.feature;
  if (feat) return `<span class="mt-icon mt-svg" style="--zi:url(/assets/zone-icons/${esc(feat)}.svg)"></span>`;
  if (t.icon) return `<span class="mt-icon">${esc(t.icon)}</span>`;
  return ''; // bare tile — no marker glyph (#, ⸪., …)
}

// ── Codex app (native view: 'codex') ─────────────────────────────────────────
// Sections of kind 'chapters' render here; 'orders' falls through to the alignment
// reader. Reading state is client-side (_tosCodexCh): the volume is one payload.
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
      <div class="tos-cx-hero-sub">What the world is. What you're becoming in it.</div>
    </div>
    <div class="tos-cx-shelf">${tiles}</div>
    <p class="tos-cx-foot">Entries accrue as you learn them. The record isn't complete, and has never claimed to be.</p>
  </div>`;
}

// One chapter's prose: 'body' strings are paragraphs, { pull } a pull quote,
// { break: true } a rule. Locked chapters ship no body.
// codexNarrationParts returns the split array, never a joined string: re-splitting
// fuses a block without end punctuation into the next and shifts every index.
function codexNarrationParts(body) {
  return (body || [])
    .map(p => (typeof p === 'string' ? p : (p?.pull || '')))
    .filter(Boolean)
    .flatMap(s => narrateSplit(s));
}

function renderCodexBody(body, narratable) {
  // The running index spans the whole chapter and must count exactly what
  // codexNarrationParts contributes, in order.
  let n = 0;
  const speak = (s) => narratable
    ? narrateSplit(s).map(t => `<span class="tos-narr-s" data-s="${n++}">${esc(t)}</span>`).join(' ')
    : esc(s);
  return (body || []).map((p, i) => {
    if (typeof p === 'string') {
      // Drop cap peeled off BEFORE the sentence split, so indices stay aligned.
      if (i === 0 && !narratable) return `<p class="tos-cx-p"><span class="tos-cx-drop">${esc(p.charAt(0))}</span>${esc(p.slice(1))}</p>`;
      return `<p class="tos-cx-p">${speak(p)}</p>`;
    }
    if (p?.pull) return `<blockquote class="tos-cx-pull">${speak(p.pull)}</blockquote>`;
    if (p?.break) return `<div class="tos-cx-rule" aria-hidden="true">◆ ◆ ◆</div>`;
    return '';
  }).join('');
}

// Read a Codex chapter aloud and continue into the next UNLOCKED one (sealed ones
// have no body and are skipped). _tosCodexCh is left alone on purpose: auto-advance
// is for when you're not looking.
function narrateCodexFrom(chapterId) {
  const chapters = _data?.chapters || [];
  const startAt = chapters.findIndex(c => c.id === chapterId && c.unlocked);
  if (startAt < 0) return;
  const volume = _data?.sectionTitle || _data?.appName || 'CODEX';
  const titleOf = (c) => `${volume}: ${c.title || ''}`.trim();

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
  // Seed on the volume so one narrator reads the whole record.
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
// Pages: Overview, one per order, and the Field compass. Client-side via _tosIdeoPage.
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
  // Expansion orders, staged: flipping flags.expansion is the only activation step.
  ideology_prometheans: c => `<svg viewBox="0 0 40 40" class="tos-ideo-sig"><g fill="none" stroke="${c}" stroke-width="1.6"><path d="M20 6 C24 12 24 15 20 20 C16 15 16 12 20 6 Z"/><path d="M20 20 V34"/><path d="M14 31 H9 M26 31 H31" stroke-opacity=".6"/><circle cx="9" cy="31" r="1.6" fill="${c}"/><circle cx="31" cy="31" r="1.6" fill="${c}"/></g></svg>`,
  ideology_synthesis: c => `<svg viewBox="0 0 40 40" class="tos-ideo-sig"><g fill="none" stroke="${c}" stroke-width="1.6"><path d="M20 34 V16"/><path d="M20 22 C12 20 10 12 12 8 C18 10 20 16 20 22 Z" stroke-opacity=".85"/><path d="M20 18 C28 16 30 10 28 7 C23 9 20 13 20 18 Z" stroke-opacity=".6"/><circle cx="20" cy="13" r="2" fill="${c}"/></g></svg>`,
  ideology_null: c => `<svg viewBox="0 0 40 40" class="tos-ideo-sig"><g fill="none" stroke="${c}" stroke-width="1.6"><path d="M8 24 Q20 8 32 24" stroke-opacity=".5"/><path d="M13 26 Q20 16 27 26" stroke-opacity=".7"/><circle cx="20" cy="30" r="2" fill="${c}"/><path d="M10 10 L30 34" stroke-width="2"/></g></svg>`,
  ideology_pioneers: c => `<svg viewBox="0 0 40 40" class="tos-ideo-sig"><g fill="none" stroke="${c}" stroke-width="1.6"><path d="M6 28 H34"/><path d="M13 28 A7 7 0 0 1 27 28"/><g stroke-opacity=".7"><path d="M20 12 V7 M11 16 L8 13 M29 16 L32 13 M6 22 H3 M34 22 H37"/></g></g></svg>`,
};
function ideoSigil(id, color) { return (IDEO_SIGILS[id] || (c => `<svg viewBox="0 0 40 40" class="tos-ideo-sig"><circle cx="20" cy="20" r="7" fill="${c}"/></svg>`))(color); }

// Field coordinates for the canon four (x renounce→redeem, y human→transcend, 0..100).
// Unknown ids derive from stance/path.
const IDEO_FIELD_XY = {
  ideology_ascendants: [72, 82], ideology_long_watch: [76, 12],
  ideology_wildblood: [26, 80], ideology_exodus: [18, 90],
  // Expansion orders placed by hand; the fallback would put the Null on the transcend row.
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

// Radial four-path field: stance (x) × ascend/stay (y).
function renderIdeoRadial(d, accent) {
  // Canon four only; emerging orders crush it into noise.
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
  // Divider between the live four and the emerging previews.
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
    : "You haven't yet taken a side.";
  return `<div class="tos-ideo-page">
    <div class="tos-ideo-lbl">Alignment field</div>
    <div class="tos-ideo-panel">${renderIdeoRadial(d, accent)}<div class="tos-ideo-lean">${lean}</div></div>
    <div class="tos-ideo-lbl">Standing</div>
    <div class="tos-ideo-panel">${rows}</div>
    <div class="tos-ideo-lbl">The two questions</div>
    <div class="tos-ideo-panel"><p class="tos-ideo-note"><b>Civilization</b>: is the Basin worth saving? Renounce it, or redeem it.<br><br><b>The body</b>: do we stay human, or transcend the form? And by which path, machine, flesh, or mind? <span class="tos-ideo-dim">Open the Field to see them all plotted.</span></p></div>
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
    <div class="tos-ideo-panel"><p class="tos-ideo-note tos-ideo-dim">This order hasn't yet surfaced in the Basin. You can't take up standing with it yet. Consider this a preview of a road that's coming.</p></div>`
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
      <p class="tos-ideo-note"><b>Civilization</b> (↔): the Basin and its Architect. <b>Renounce</b> it and leave, or <b>redeem</b> it and stay.<br><br><b>The body</b> (↕): <b>stay human</b>, or <b>transcend</b> the form. The ascending orders climb by different means, that third choice of <em>path</em> is what the Overview's field unfolds.</p>
      <div class="tos-ideo-legend">${legend}<span><i style="background:#fff;color:${accent}"></i>You</span></div>
    </div>
  </div>`;
}

// Step the reader one page (−1/+1), clamped.
function changeIdeoPage(dir) {
  if (!_data || _data.view !== 'codex' || _data.sectionKind !== 'orders') return;
  const count = (_data.orders?.length || 0) + 2; // Overview + orders + Field
  const next = Math.min(count - 1, Math.max(0, _tosIdeoPage + dir));
  if (next === _tosIdeoPage) return;
  _tosIdeoPage = next;
  sfx(TOS_SELECT_DEF);
  render();
}

// Accolades: the entry count never has a denominator (discovery-only), and the meter
// is scaled against one stat point so it can't fill. Both on purpose (plugins/accolades).
// ── Vitals ────────────────────────────────────────────────────────────────────
// Three server-built tabs (plugins/tablet/health-app.js). Colour bands come from the
// server (good/warn/bad/crit); the client never decides what "bad" means.

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

// Readouts: vitals reported in WORDS (hunger, thirst), with no bar or figure on
// purpose. The server owns the phrasing (health-app buildReadouts).
function renderHealthReadouts(readouts) {
  if (!readouts?.length) return '';
  return `<div class="tos-vt-readouts">${readouts.map(r => `
    <div class="tos-vt-readout">
      <span class="tos-vt-rlbl">${esc(r.label)}</span>
      <span class="tos-vt-rval ${esc(r.band || 'good')}">${esc(r.text || '')}</span>
    </div>`).join('')}</div>`;
}

// ── The paper doll ───────────────────────────────────────────────────────────
// Draws only; bands come from the server. No 'd.body' → renders nothing. Sides are
// from the viewer's perspective (your left arm on the left).
// Hotspots are in each silhouette's own pixel space (male 242×540, female 500×708):
// the mask is contain-fitted into a box of its aspect, so an SVG unit is a mask pixel.
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
// Two scroll-snap reels (hours, minutes), themed entirely from the OS palette. Touch,
// wheel and keyboard work natively; the pointer drag is added by hand for mouse/pen
// only (see the wiring pass for why snap is switched off mid-drag).
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
    // Default to an hour ahead of the game clock.
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
       title="${esc(p.detail || `${p.partLabel}: fine.`)}">
      ${DOLL_SHAPES[p.part] || ''}
    </g>`).join('');

  const worst = d.body.filter(p => p.severity > 0).sort((a, b) => b.severity - a.severity)[0];
  const sil = (d.sex === 'female' || d.sex === 'male') ? d.sex : 'male';

  // The silhouette is the body. The primitives are INVISIBLE hit-areas; a wound is the
  // silhouette mask in the injury colour, clipped to that region's box.
  const wounded = d.body.filter(p => p.severity > 0).map(p => {
    const box = regionInset(DOLL_SHAPES[p.part], geom.viewBox);
    return box ? `<div class="tos-vt-dollhurt ${esc(p.band)}" aria-hidden="true" style="clip-path:${box};-webkit-clip-path:${box}"></div>` : '';
  }).join('');

  return `
    <div class="tos-vt-sect">Body</div>
    <div class="tos-vt-doll">
      <div class="tos-vt-dollstage tos-vt-sil-${sil}">
        <div class="tos-vt-dollsil" aria-hidden="true"></div>
        ${wounded}
        <svg viewBox="${geom.viewBox}" class="tos-vt-dollsvg" aria-label="Body diagram">${parts}</svg>
      </div>
      <div class="tos-vt-dolldet" data-doll-detail-slot>${esc(worst?.detail || 'No injuries. Tap a part for detail.')}</div>
    </div>`;
}

// A region's bounding box as a CSS inset() in viewBox percentages, measured off the
// same shape strings as the hit-areas so a wound tint can't drift from its limb.
function regionInset(shapeStr, viewBox) {
  if (!shapeStr) return null;
  const [, , vw, vh] = String(viewBox).split(/\s+/).map(Number);
  if (!(vw > 0) || !(vh > 0)) return null;
  const num = (s, k) => { const m = s.match(new RegExp(`${k}="(-?[\\d.]+)"`)); return m ? parseFloat(m[1]) : null; };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;

  for (const tag of shapeStr.match(/<(rect|circle)[^>]*>/g) || []) {
    if (tag.startsWith('<rect')) {
      const x = num(tag, 'x'), y = num(tag, 'y'), w = num(tag, 'width'), h = num(tag, 'height');
      if (x == null || y == null) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
    } else {
      const cx = num(tag, 'cx'), cy = num(tag, 'cy'), r = num(tag, 'r');
      if (cx == null || cy == null || r == null) continue;
      x0 = Math.min(x0, cx - r); y0 = Math.min(y0, cy - r); x1 = Math.max(x1, cx + r); y1 = Math.max(y1, cy + r);
    }
  }
  if (!isFinite(x0)) return null;
  // A hair of bleed so neighbouring regions meet without a seam.
  const pad = 0.6;
  const pc = (v) => `${Math.max(0, Math.min(100, v)).toFixed(2)}%`;
  return `inset(${pc(y0 / vh * 100 - pad)} ${pc(100 - x1 / vw * 100 - pad)} ${pc(100 - y1 / vh * 100 - pad)} ${pc(x0 / vw * 100 - pad)})`;
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
    return `<div class="tos-vt-clear">You're carrying nothing medicinal.<br><span>The city doesn't hand it out.</span></div>`;
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

// What you've learned about a compound. Unlearned values arrive as null from the
// server, never a number the client hides.
function renderLearned(l) {
  if (!l || !l.mask) return '<div class="tos-vt-subload">You took it. You couldn\'t tell you what it did.</div>';
  const rows = [];
  if (l.effects && Object.keys(l.effects).length) {
    const mods = Object.entries(l.effects)
      .filter(([, v]) => typeof v === 'number' && v !== 0)
      .map(([k, v]) => `${esc(k.replace(/^stat_/, '').replace(/_/g, ' '))} ${v > 0 ? '+' : ''}${v}`);
    if (mods.length) rows.push(['What it does', mods.join(', ')]);
  }
  if (l.durationSeconds != null) rows.push(['How long', `${Math.round(l.durationSeconds / 60)} min`]);
  if (l.overdoseCeiling != null) rows.push(['Too much is', `${l.overdoseCeiling} doses`]);
  if (l.addictive) rows.push(['Hooks', 'It gets them in.']);
  if (!rows.length) return '<div class="tos-vt-subload">You know how it feels. Nothing else, yet.</div>';
  return `<div class="tos-vt-subgrid">${rows.map(([k, v]) => `<span>${esc(k)}</span><b>${esc(v)}</b>`).join('')}</div>`;
}

function renderHealthOnHand(list) {
  if (!list?.length) return '';
  const rows = list.map(o => `
    <div class="tos-vt-item">
      <div class="tos-vt-itemtxt"><b>${esc(o.name)}</b>${o.qty > 1 ? ` <span class="text-dim">×${o.qty}</span>` : ''}</div>
      <span class="tos-vt-flag${o.known ? '' : ' bad'}">${o.known ? 'known' : 'unidentified'}</span>
    </div>`).join('');
  return `<div class="tos-vt-sect">On hand</div>${rows}`;
}

function renderHealthSubstances(d) {
  const subs = d.substances || [];
  const onHand = renderHealthOnHand(d.onHand);
  if (!subs.length) {
    return `${onHand}<div class="tos-vt-clear">Your bloodwork is boring.<br><span>No compound has ever been through you.</span></div>`;
  }
  return `${onHand}<div class="tos-vt-sect">Experience</div>` + subs.map(s => {
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
        ${renderLearned(s.learned)}
        ${wd}
      </div>`;
  }).join('');
}

function renderHealth(d) {
  const notice = d.notice ? `<div class="tos-vt-notice">${esc(d.notice)}</div>` : '';
  if (d.tab === 'apothecary') return `${notice}${renderHealthApothecary(d)}`;
  if (d.tab === 'substances') return `${notice}${renderHealthSubstances(d)}`;
  // Two columns where there's room (doll beside readings); one column below 620px.
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

// ── Binder ───────────────────────────────────────────────────────────────────
// Each rank is a shelf: cards held, then empty sleeves for the rest. The gaps are
// ANONYMOUS by contract (plugins/tablet/binder-app.js): a count, never names.
const TOS_BINDER_COLORS = {
  common: '#8b98a8', uncommon: '#57d47c', rare: '#4aa8ff',
  epic: '#b374ff', legendary: '#ffc23d', architect: '#ff5470',
};

function renderBinder(d) {
  const shelves = (d.ranks || []).map(r => {
    const c = TOS_BINDER_COLORS[r.rarity] || '#8b98a8';
    const held = (r.cards || []).map(card => `
      <div class="tos-bnd-card" data-binder-card="${esc(String(card.id))}" style="--c:${c}" title="Read ${esc(card.name)}">
        ${card.qty > 1 ? `<span class="tos-bnd-qty">×${card.qty}</span>` : ''}
        <div class="tos-bnd-name">${esc(card.name)}</div>
        <div class="tos-bnd-type">${esc(card.type)}</div>
        ${card.marks ? `<div class="tos-bnd-marks">${esc(card.marks)}</div>` : ''}
      </div>`).join('');
    // Capped at 24 drawn slots.
    const drawGaps = Math.min(24, r.gaps || 0);
    const gaps = Array.from({ length: drawGaps }, () => `<div class="tos-bnd-slot" style="--c:${c}">◈</div>`).join('');
    const over = (r.gaps || 0) - drawGaps;
    return `
      <div class="tos-bnd-shelf">
        <div class="tos-bnd-shelf-head" style="--c:${c}">
          <span class="tos-bnd-rank">${esc(r.label)}</span>
          <span class="tos-bnd-ratio">${r.total ? `${r.owned} / ${r.total}` : `${r.owned} held`}</span>
        </div>
        ${r.total ? `<div class="tos-bnd-bar" style="--c:${c}"><i style="width:${Math.round((r.owned / Math.max(1, r.total)) * 100)}%"></i></div>` : ''}
        <div class="tos-bnd-grid">${held}${gaps}${over > 0 ? `<div class="tos-bnd-more">+${over} more<br>unfilled</div>` : ''}</div>
      </div>`;
  }).join('');

  const empty = `<div class="tos-bnd-empty">The binder is empty.<br><span>Sleeves come out of an ARCHITECT DRAFT machine.</span></div>`;

  return `
    <div class="tos-bnd-head">
      <div>
        <div class="tos-bnd-app">Binder</div>
        <div class="tos-bnd-sub">Collected Works &middot; Series 1</div>
      </div>
      <div class="tos-bnd-count"><b>${d.distinct || 0}</b>of ${d.setTotal || 0} faces</div>
    </div>
    <div class="tos-bnd-meter">
      <div class="tos-bnd-meter-lbl">
        <span>Set completion</span>
        <span class="v">${d.pct || 0}%${d.dupes ? ` &middot; ${d.dupes} doubled up` : ''}</span>
      </div>
      <div class="tos-bnd-meter-bar"><i style="width:${Math.min(100, d.pct || 0)}%"></i></div>
    </div>
    ${(d.ranks || []).length ? shelves : empty}`;
}

// One card at size, using the same server-rendered face as the reveal and 'cards' verb.
function renderBinderCard(d) {
  const c = d.card || {};
  const col = TOS_BINDER_COLORS[c.rarity] || '#8b98a8';
  return `
    <div class="tos-bnd-detail" style="--c:${col}">
      <div class="tos-bnd-face">${c.face || ''}</div>
      <div class="tos-bnd-foot">
        <span>Series ${esc(String(c.series ?? 1))} &middot; № ${String(c.serial ?? 0).padStart(4, '0')}</span>
        ${c.qty > 1 ? `<span class="tos-bnd-dupe">${c.qty} copies &middot; scrap the spares at a mint</span>` : ''}
      </div>
    </div>`;
}

function renderAccolades(d) {
  const rows = (d.entries || []).map((e, i) => `
    <div class="tos-acc-row${i === (d.entries.length - 1) ? ' first' : ''}">
      <div class="tos-acc-title">${esc(e.title)}</div>
      <div class="tos-acc-line">${esc(e.line)}</div>
      <div class="tos-acc-foot"><span>${e.at ? esc(tosStamp(e.at)) : ''}</span><span class="xp">+1 XP</span></div>
    </div>`).join('');

  const empty = `<div class="tos-acc-empty">Your file is empty.<br><span>That isn't the same as clean.</span></div>`;

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
// MIS-gated server-side, so these never run for a player who hasn't opted in.
// The voice is the Syndicate's: clinical and untroubled. Don't warm it up.

// The trade-register masthead. Cold on purpose.
function blissChrome(sub, note) {
  return `<div class="tos-bliss-head">
    <div class="tos-bliss-mark">
      <div class="tos-bliss-app">B.L.I.S.S.</div>
      <div class="tos-bliss-expand">Bonded Live-In Intimacy Subscription Service</div>
    </div>
    <div class="tos-bliss-plate">
      <div class="tos-bliss-sub">${esc(sub || '')}</div>
      ${note ? `<div class="tos-bliss-platenote">${esc(note)}</div>` : ''}
    </div>
  </div>`;
}

// The specimen plate: initial, sex glyph, hairline frame (no portrait exists).
function blissPlate(m, idx) {
  const initial = (m.name || '?').trim().charAt(0).toUpperCase();
  return `<div class="tos-bliss-plate-fig">
    <span class="tos-bliss-initial">${esc(initial)}</span>
    <span class="tos-bliss-glyph">${m.sex === 'male' ? '♂' : '♀'}</span>
    ${idx != null ? `<span class="tos-bliss-idx">${String(idx).padStart(2, '0')}</span>` : ''}
  </div>`;
}

// A ruled row (label, dotted leader, value), used for every spec table in the app.
function blissRows(rows, cls = '') {
  return `<dl class="tos-bliss-spec ${cls}">${(rows || []).map(([k, v]) =>
    `<div class="tos-bliss-specrow"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}

function renderBlissListings(d) {
  let plateNo = 0;
  const cardFor = (l) => {
    const pairTag = l.pairing
      ? `<div class="tos-bliss-pairtag">${esc(l.pairing.label)} &middot; non-severable</div>` : '';
    const who = (l.members || []).map(m => `
      <div class="tos-bliss-who">
        ${blissPlate(m, ++plateNo)}
        <div class="tos-bliss-whobody">
          <div class="tos-bliss-name">${esc(m.name)}</div>
          <div class="tos-bliss-says">${esc(m.says)}</div>
          ${(m.traits || []).length ? `<div class="tos-bliss-traits">${m.traits.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
          <div class="tos-bliss-phys">${esc(m.summary)}</div>
          ${m.headline ? `<div class="tos-bliss-headline">${esc(m.headline)}</div>` : ''}
        </div>
      </div>`).join('');
    return `<div class="tos-bliss-card" data-act-id="open" data-act-app="bliss" data-act-params="${esc(l.id)}">
      ${pairTag}${who}
      <div class="tos-bliss-rate"><span class="tos-bliss-ratefig">${l.rate}₵</span><span class="tos-bliss-rateunit">per day</span></div>
    </div>`;
  };

  // Sectioned server-side; no sections renders one flat grid.
  const byId = new Map((d.listings || []).map(l => [l.id, l]));
  const cards = (d.sections || []).length
    ? d.sections.map(s => `
        <div class="tos-bliss-secthead"><span>${esc(s.label)}</span><i class="tos-bliss-rule"></i><b>${s.ids.length}</b></div>
        <div class="tos-bliss-grid">${s.ids.map(id => byId.get(id)).filter(Boolean).map(cardFor).join('')}</div>`).join('')
    : `<div class="tos-bliss-grid">${(d.listings || []).map(cardFor).join('')}</div>`;

  const rr = d.reroll || {};
  const rerollBtn = rr.ready
    ? `<button class="tos-btn" data-act-id="reroll" data-act-app="bliss" data-act-params=""
         data-act-confirm="Refresh the register? The current placements are gone and the next refresh is a day away.">↻ Refresh the register</button>`
    : `<button class="tos-btn disabled" disabled>↻ Refreshes in ${esc(rr.remainingLabel || '')}</button>`;

  return `
    ${blissChrome(`${(d.listings || []).length} placements`, 'on the register today')}
    <div class="tos-bliss-strap">${esc(d.smallprint || '')}</div>
    ${cards}
    <div class="tos-actions">
      ${rerollBtn}
      <button class="tos-btn" data-act-id="arrangement" data-act-app="bliss" data-act-params="">Your arrangement${d.heldCount ? ` (${d.heldCount})` : ''}</button>
    </div>`;
}

function renderBlissDetail(d) {
  const l = d.listing || {};
  const who = (l.members || []).map(m => {
    const t = m.temperament || {};
    // Temperament sits ABOVE measurements on purpose. The warning row keeps its own class.
    const person = t.traits ? `
      <div class="tos-bliss-traits">${(t.traits || []).map(x => `<span>${esc(x)}</span>`).join('')}</div>
      ${blissRows([['Warmth', t.warmth || ''], ['Wants', t.wants || '']])}
      ${t.warned ? `<div class="tos-bliss-warned"><span>Be warned</span><p>${esc(t.warned)}</p></div>` : ''}` : '';
    const voice = (m.voice || []).length ? `
      <div class="tos-bliss-subhead">In their own words</div>
      <div class="tos-bliss-voice">${m.voice.map(v => `<p>${esc(v)}</p>`).join('')}</div>` : '';
    const intimate = (m.intimate || []).length ? `
      <div class="tos-bliss-subhead">Specification</div>
      ${blissRows(m.intimate, 'intimate')}` : '';
    return `
    <div class="tos-bliss-detailwho">
      <div class="tos-bliss-who">
        ${blissPlate(m, null)}
        <div class="tos-bliss-whobody">
          <div class="tos-bliss-name">${esc(m.name)}</div>
          <div class="tos-bliss-says">${esc(m.says)}</div>
          <div class="tos-bliss-note">${esc(m.note)}</div>
        </div>
      </div>
      ${person}
      ${voice}
      <div class="tos-bliss-subhead">Appearance</div>
      ${blissRows(m.physical)}
      ${intimate}
    </div>`;
  }).join('');

  const pair = l.pairing ? `<div class="tos-bliss-pairbox">
      <div class="tos-bliss-pairtag">${esc(l.pairing.label)}</div>
      <div>${esc(l.pairing.blurb)}</div>
      <div class="tos-bliss-note">${esc(l.pairing.note)}</div>
    </div>` : '';

  // Tenure ladder: each bar is its rate as a fraction of today's (rung zero, full width).
  const rungs = [{ days: 0, rate: l.rate, label: 'Today' }, ...(l.projection || [])];
  const proj = `<div class="tos-bliss-ladder">${rungs.map(p => {
    const pct = l.rate > 0 ? Math.max(6, Math.round((p.rate / l.rate) * 100)) : 100;
    const off = l.rate > 0 ? Math.round(100 - (p.rate / l.rate) * 100) : 0;
    return `<div class="tos-bliss-rung${p.days === 0 ? ' now' : ''}">
      <span class="tos-bliss-rungday">${p.days === 0 ? 'Day one' : `${p.days} days`}</span>
      <span class="tos-bliss-rungbar"><i style="width:${pct}%"></i></span>
      <span class="tos-bliss-rungrate">${p.rate}₵${off ? ` <em>−${off}%</em>` : ''}</span>
      <span class="tos-bliss-runglabel">${esc(p.label)}</span>
    </div>`;
  }).join('')}</div>`;

  const places = d.blocked
    ? `<div class="tos-bliss-blocked">${esc(d.blocked)}</div>`
    : `<div class="tos-actions">${(d.spaces || []).map(s =>
        `<button class="tos-btn" data-act-id="place" data-act-app="bliss" data-act-params="${esc(l.id)}|${esc(s.id)}"
           data-act-confirm="Place at ${esc(s.name)}? The first day's retainer of ${l.rate}₵ is drawn immediately.">
           ${esc(s.name)} <span class="dim">${esc(s.label)}</span></button>`).join('')}</div>`;

  return `
    ${blissChrome(`${l.rate}₵`, 'per day, first day up front')}
    ${pair}
    <div class="tos-bliss-grid detail">${who}</div>
    <div class="tos-bliss-secthead"><span>Retainer &amp; tenure</span><i class="tos-bliss-rule"></i></div>
    <div class="tos-bliss-note">The rate falls the longer a placement stays. Loyalty is cheaper than novelty.</div>
    ${proj}
    <div class="tos-bliss-secthead"><span>Deliver to</span><i class="tos-bliss-rule"></i></div>
    ${places}
    <div class="tos-actions"><button class="tos-btn" data-act-id="listings" data-act-app="bliss" data-act-params="">← Back to the register</button></div>`;
}

function renderBlissArrangement(d) {
  if (d.empty) {
    return `${blissChrome('None', 'placements on account')}
      <div class="tos-bliss-blocked">You keep nobody. The Syndicate notes this without judgement and with some disappointment.</div>
      <div class="tos-actions"><button class="tos-btn" data-act-id="listings" data-act-app="bliss" data-act-params="">Browse the register</button></div>`;
  }
  // A HOUSE placement is the player's own staff: listed the same, but no bill, no
  // tenure ladder and no Release button.
  const rows = (d.entries || []).map(e => {
    // Track toward the next rung; at the top it goes solid rather than showing 0%.
    const nt = e.nextTier;
    const tenure = `<div class="tos-bliss-tenure">
      <div class="tos-bliss-tenurehead">
        <span>${esc(e.tier.label)}</span>
        <span class="dim">${nt ? `${nt.daysAway} day${nt.daysAway === 1 ? '' : 's'} to ${esc(nt.label)}` : 'Floor rate reached'}</span>
      </div>
      <span class="tos-bliss-track${nt ? '' : ' full'}"><i style="width:${nt ? Math.max(2, Math.min(100, nt.pct)) : 100}%"></i></span>
    </div>`;
    return `
    <div class="tos-bliss-held${e.house ? ' house' : ''}">
      <div class="tos-bliss-heldtop">
        <div class="tos-bliss-name">${esc(e.names.join(' &amp; '))}${e.pairing ? ` <span class="dim">${esc(e.pairing)}</span>` : ''}${e.house ? ' <span class="tos-bliss-housetag">House</span>' : ''}</div>
        <div class="tos-bliss-rate">${e.house
          ? '<span class="tos-bliss-ratefig">—</span><span class="tos-bliss-rateunit">no retainer</span>'
          : `<span class="tos-bliss-ratefig">${e.todayRate}₵</span><span class="tos-bliss-rateunit">per day${e.saving ? ` · −${e.saving}₵` : ''}</span>`}</div>
      </div>
      ${e.house ? `
      <div class="tos-bliss-note">Yours outright. The Syndicate bills nothing and arranges nothing.</div>`
      : `
      <div class="tos-bliss-heldline"><span>${e.daysKept} day${e.daysKept === 1 ? '' : 's'} kept</span></div>
      ${tenure}
      <div class="tos-bliss-note">${esc(e.tier.note)}</div>
      ${e.missed ? `<div class="tos-bliss-warn">${e.missed} missed payment: one more and the placement is collected.</div>` : ''}
      <div class="tos-actions"><button class="tos-btn" data-act-id="release" data-act-app="bliss" data-act-params="${esc(e.id)}"
        data-act-confirm="Release ${esc(e.names.join(' and '))}? ${e.names.length > 1 ? 'A matched pair goes together. ' : ''}This can't be undone.">Release</button></div>`}
    </div>`;
  }).join('');

  return `${blissChrome(`${d.dailyTotal}₵`, 'per day, drawn nightly')}
    <div class="tos-bliss-grid held">${rows}</div>
    <div class="tos-actions"><button class="tos-btn" data-act-id="listings" data-act-app="bliss" data-act-params="">Browse the register</button></div>`;
}

// Entry timestamps are epoch seconds.
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

// Off the grid the Map app becomes a survey terminal: the shared trail chart
// (crossingInnerHtml) blown up, with dead-signal instruments. Payload is just 'nodes'.
const JOURNEY_SUBSTRATE = { scrub: 'SCRUBLAND', ash: 'ASH FLATS', redrock: 'RED ROCK', marsh: 'DEAD MARSH', road: 'OLD ROADBED', dirt_road: 'DIRT TRACK', hardpan: 'CRACKED HARDPAN', alkali: 'ALKALI FLAT', cliff: 'CLIFF FACE', plateau: 'CAPROCK PLATEAU' };
function journeyAhead(nodes, cur) {
  if (cur.void_detour) return 'dead';
  const sId = cur.exits?.south;
  if (!sId) return 'none';
  return nodes.some(n => n.id === sId) ? 'fog' : 'gate';
}
// Void rooms behind you on the charted window, following the "back" exit (north, or
// east on a dead-end detour).
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
  if (!cur) return `<div class="tos-empty">◈ NO SIGNAL: you're off the grid, out in the void.</div>`;
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
  // Regional: the whole contiguous landmass (server landmassTiles scopes it).
  const mode = d.mode || 'zone';

  if (!tiles.length) {
    return `<div class="tos-empty">No map data for this level.</div>`;
  }
  if (!_tosMapSel || !tiles.some(t => t.id === _tosMapSel)) _tosMapSel = null;

  const route = getTracePath() || [];
  const dest = route.length > 1 ? route[route.length - 1] : null;

  // Edge-to-edge 1:1 grid. Regional packs occupied coords to dense indices; zone and
  // interior stay 1:1 on the local window.
  const xs = tiles.map(t => t.x), ys = tiles.map(t => t.y);
  const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
  let colOf, rowOf, gCols, gRows;
  // absAt(c,r) → absolute world [x,y] of a cell, for the cosmetic bay fill; null when
  // unresolvable (an interior with no district tiles).
  let absAt = null;
  if (mode === 'regional') {
    const ux = [...new Set(xs)].sort((a, b) => a - b), uy = [...new Set(ys)].sort((a, b) => a - b);
    const xi = new Map(ux.map((x, i) => [x, i])), yi = new Map(uy.map((y, i) => [y, i]));
    colOf = t => xi.get(t.x); rowOf = t => yi.get(t.y);
    gCols = ux.length; gRows = uy.length;
    absAt = (c, r) => [ux[c], uy[r]];
  } else {
    colOf = t => t.x - minX; rowOf = t => t.y - minY;
    gCols = maxX - minX + 1; gRows = maxY - minY + 1;
    // Zone tiles are centre-relative: recover the origin from any district tile
    // (zone_district_<x>_<y>).
    for (const t of tiles) {
      const co = districtCoord(t.id);
      if (co) { const ax0 = co[0] - colOf(t), ay0 = co[1] - rowOf(t); absAt = (c, r) => [ax0 + c, ay0 + r]; break; }
    }
  }
  const cell = Array.from({ length: gRows }, () => new Array(gCols).fill(null));
  const tById = new Map();
  for (const t of tiles) { cell[rowOf(t)][colOf(t)] = t; tById.set(t.id, t); }
  // Rebuild the tile → absolute index from absAt; empty when absAt is null, which is
  // exactly when 'Target here' must not be offered.
  _tosMapAbs.clear();
  if (absAt) for (const t of tiles) _tosMapAbs.set(t.id, absAt(colOf(t), rowOf(t)));

  let grid = `<div class="tos-map-grid" style="--tos-tile:${tosZoomPx(d)}px;grid-template-columns:repeat(${gCols},var(--tos-tile));grid-template-rows:repeat(${gRows},var(--tos-tile))">`;
  // Colours arrive resolved in t.spec (derive.mjs, content/map/terrain.json).
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
    // No 'd-<tier>' class: nothing styles it, and an unread class invites the rail back.
    if (t.reachable === false) cls.push('unreach');
    if (t.id === dest && !t.isCurrent) cls.push('dest');
    if (t.id === _tosMapSel) cls.push('sel');
    if (t.isCurrent) cls.push('cur');
    // Tileable terrain, as the minimap: roads get asphalt and markings, other ground a
    // seamless fill. water/grass keep authored bg priority.
    const terrain = t.spec?.minimap_class || null;
    let sym = _mapTileSym(t);
    let style = pos + ';';
    if (terrain) {
      style += `background-color:${t.spec.fill};color:${t.spec.text};`;
      cls.push('terr', 'terr-' + terrain);
      // Terrain keeps an authored zone-icon SVG (statue, helipad) and drops only the
      // POI glyph. Roads keep theirs: the auto-tiled connector is the symbol (spec.auto_tile).
      if (!t.spec.auto_tile && !t.isCurrent && !t.spec.feature) sym = '';
    }
    else if (mode === 'regional' && FUNC_LEGEND[t.func]) {
      const [rr, gg, bb] = _mapHexRgb(FUNC_LEGEND[t.func].color);
      style += `background:rgba(${rr},${gg},${bb},0.30);`;
    }
    // Landmark ink from the same poiInk() as the minimap.
    const pInk = poiInk(t);
    if (pInk) style += `color:${pInk};--poi-ink:${pInk};`; // the var is the Labels-mode half (see .mt-code)
    const badges = (t.isCurrent ? '<span class="mt-you">◉</span>' : '')
      + (t.id === dest && !t.isCurrent ? '<span class="mt-dest">⚑</span>' : '');
    // Door edges: green open, red wall ('open_dirs'), brighter red locked ('locked_dirs'),
    // orange unlockable by you ('unlockable_dirs'). A law holding a facade shut reddens its door.
    let ent = '', exits = '';
    if (Array.isArray(t.open_dirs)) {
      const locked = Array.isArray(t.locked_dirs) ? t.locked_dirs : [];
      const mine = Array.isArray(t.unlockable_dirs) ? t.unlockable_dirs : [];
      exits = ['north', 'south', 'east', 'west'].map(dr => {
        const lk = locked.includes(dr) || (t.shut && dr === t.entrance);
        const st = lk ? (mine.includes(dr) ? 'unlockable' : 'locked')
          : (t.open_dirs.includes(dr) ? 'open' : 'shut');
        return `<span class="tos-edge tos-edge-${dr} ${st}"></span>`;
      }).join('');
    }
    // Perimeter wall on spec.curtain's outward faces; no faces ⇒ the shimmer ring.
    const cwFaces = t.spec?.curtain || '';
    if (cwFaces) {
      cls.push('tos-cw');
      if (t.perimeter_gate) cls.push('tos-gate', 'tos-cw-gate');
      for (const d of cwFaces) cls.push('tos-cw-' + d);
    } else if (t.perimeter_gate) cls.push('tos-gate', 'tos-curtain');
    else if (t.curtain) cls.push('tos-curtain');
    else if (t.glacis) cls.push('tos-glacis');
    // A derived code replaces the footprint, in Labels mode only; an authored marker
    // shows on top in every mode.
    const _lb = _mapLabel(t);
    const body = _lb?.kind === 'mark'
      ? sym + `<span class="mt-code mt-mark">${esc(_lb.text)}</span>`
      : (mapLabelsOn() && _lb ? `<span class="mt-code">${esc(_lb.text)}</span>` : sym);
    grid += `<div class="${cls.join(' ')}" style="${style}" data-map-zone="${esc(t.id)}" title="${esc(t.name)}">${badges}${body}${ent}${exits}</div>`;
  }
  // GPS route: an accent polyline in tile units over the grid, as on the minimap.
  const gpsPts = [];
  for (const id of route) {
    const t = tById.get(id);
    if (!t) continue;
    gpsPts.push(`${(colOf(t) + 0.5).toFixed(2)},${(rowOf(t) + 0.5).toFixed(2)}`);
  }
  if (gpsPts.length > 1)
    grid += `<svg class="tos-gps-svg" viewBox="0 0 ${gCols} ${gRows}" preserveAspectRatio="none"><polyline class="tos-gps-line" points="${gpsPts.join(' ')}"/></svg>`;
  grid += '</div>';

  // The map pans inside .tos-map-wrap and the rail scrolls under a pinned legend, so
  // the panel never scrolls. Phones re-lay the same markup by CSS alone (so rotation
  // is safe): rail under the map, floating zoom cluster replaces the control row's.
  return `${renderMapCtl(d)}${renderMapBar(d)}<div class="tos-map-main">`
    + `<div class="tos-map-stage"><div class="tos-map-wrap">${grid}</div>${renderMapFloat(d)}</div>`
    + `<div class="tos-map-side">${renderMapLegend(d, mode)}`
    + `<div class="tos-map-side-scroll">${renderMapBuildings(d)}`
    + `<div class="tos-map-detail" id="tos-map-detail">${renderMapDetail(d)}</div></div></div>`
    + `</div>`;
}

// Phone zoom cluster (Center, −/+). Always rendered, shown only when compact; same
// data attributes as the control row, so wireMap wires both.
function renderMapFloat(d) {
  const zoutOff = _mapCanZoom(d, -1) ? '' : ' disabled';
  const zinOff = _mapCanZoom(d, 1) ? '' : ' disabled';
  return `<div class="tos-map-float">
    <button class="tos-mf" data-map-recenter aria-label="Recenter on you">◎</button>
    <button class="tos-mf" data-map-zoom="in" aria-label="Zoom in"${zinOff}>+</button>
    <button class="tos-mf" data-map-zoom="out" aria-label="Zoom out"${zoutOff}>−</button>
  </div>`;
}

// Map controls: Run/Auto-walk (shared minimap state), recenter and zoom.
function renderMapCtl(d) {
  const run = isRunning() ? ' active' : '';
  const auto = isAutoWalking() ? ' active' : '';
  const zoutOff = _mapCanZoom(d, -1) ? '' : ' disabled';
  const zinOff = _mapCanZoom(d, 1) ? '' : ' disabled';
  const noRoute = (getTracePath() || []).length < 2 ? ' disabled' : '';
  return `<div class="tos-map-ctl">
    <span class="tos-map-mini${run}" data-map-run title="Toggle running">🏃 Run</span>
    <span class="tos-map-mini${auto}" data-map-autotoggle title="Toggle auto-walk to the plotted route">➤ Auto</span>
    <span class="tos-map-mini" data-map-recenter title="Recenter on you">◎ Center</span>
    <span class="tos-map-mini${noRoute}" data-map-clear title="Clear the plotted GPS route">🧭 Clear</span>
    <span class="tos-map-mini${mapLabelsOn() ? ' active' : ''}" data-map-labels title="Toggle two-letter building labels, also switches the sidebar minimap">🏷 Labels</span>
    <span class="tos-map-mini${mapColorOn() ? ' active' : ''}" data-map-color title="Colour buildings by what they are, also switches the sidebar minimap">🎨 Colour</span>
    <span class="tos-map-zoom">
      <button class="tos-mz" data-map-zoom="out" title="Zoom out"${zoutOff}>−</button>
      <button class="tos-mz" data-map-zoom="in" title="Zoom in"${zinOff}>+</button>
    </span>
  </div>`;
}

// Map arg one zoom step away, or null at an end. −1 out (→ region), +1 in (→ interior).
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

// Server zoom arg for the current stop, so a refresh keeps the same window width.
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

// The regional district key. ⚠ The label is the WHOLE name (most districts start
// with "the"). ⚠ Rows are counted off the tiles in view, never a fixed list, biggest
// first, so the district you stand in leads.
function renderMapLegend(d, mode) {
  let items = '<span>◉ you · ⚑ dest · ═ artery</span>';
  // Landmarks in view by footprint colour, counted off the tiles for the same reason.
  const poiN = new Map();
  for (const t of d.tiles || []) { const k = poiInk(t) ? t.poi : null; if (k && POI_LEGEND[k]) poiN.set(k, (poiN.get(k) || 0) + 1); }
  items += [...poiN.entries()]
    .sort((a, b) => b[1] - a[1] || POI_LEGEND[a[0]].label.localeCompare(POI_LEGEND[b[0]].label))
    .map(([k]) => `<span class="tos-cm-lg"><span class="sw" style="background:${POI_LEGEND[k].color}"></span>${esc(POI_LEGEND[k].label)}</span>`)
    .join('');
  if (mode === 'regional') {
    const n = new Map();
    for (const t of d.tiles || []) if (t.func && FUNC_LEGEND[t.func]) n.set(t.func, (n.get(t.func) || 0) + 1);
    items += [...n.entries()]
      .sort((a, b) => b[1] - a[1] || FUNC_LEGEND[a[0]].label.localeCompare(FUNC_LEGEND[b[0]].label))
      .map(([k]) => `<span class="tos-cm-lg"><span class="sw" style="background:${FUNC_LEGEND[k].color}"></span>${esc(FUNC_LEGEND[k].label)}</span>`)
      .join('');
  }
  return `<div class="tos-map-legend">${items}</div>`;
}

// Named buildings in view, tied to tiles by zone id; mapSyncSelection keeps list and
// map selection in step.
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
  if (!t) return `<div class="tos-map-note">Tap a tile to see what's there, then Route here to plot a course.</div>`;
  const rows = [];
  const funcLabel = FUNC_LEGEND[t.func]?.label;
  if (funcLabel) rows.push(`<div class="tos-row"><span>District</span><span>${esc(funcLabel)}</span></div>`);
  // No Danger row on purpose: zoneDanger is the spawn table in disguise.
  const poiLabel = t.poi && POI_LEGEND[t.poi] ? POI_LEGEND[t.poi].label : null;
  if (poiLabel) rows.push(`<div class="tos-row"><span>Landmark</span><span>${esc(t.icon || '')} ${esc(poiLabel)}</span></div>`);
  if (Array.isArray(t.artery) && t.artery.length) rows.push(`<div class="tos-row"><span>On</span><span>${t.artery.map(esc).join(' · ')}</span></div>`);
  if (t.buildings?.length) rows.push(`<div class="tos-row"><span>Buildings</span><span>${t.buildings.map(esc).join(', ')}</span></div>`);
  const route = getTracePath() || [];
  const isDest = route.length > 1 && route[route.length - 1] === t.id;
  // Walking and targeting are separate: a tile you can't walk to is still a fine
  // aircraft target.
  let note = '';
  const walk = [];
  if (t.isCurrent) note = `<div class="tos-map-note">◉ You're here.</div>`;
  else if (t.reachable === false) note = `<div class="tos-map-note">No route to here from where you stand.</div>`;
  else if (isDest) walk.push(['auto', isAutoWalking() ? '■ Stop Auto-walk' : '🏃 Auto-walk here']);
  else walk.push(['route', '🧭 Route here']);
  const wc = _tosMapAbs.get(t.id);
  if (wc) walk.push(['target', '✜ Target here']);
  const acts = note + (walk.length ? _mapActBtns(walk) : '');
  return `<div class="tos-detail-name" style="font-size:0.9375rem">${esc(t.name)}</div>${t.description ? `<div class="tos-detail-desc">${esc(t.description)}</div>` : ''}${rows.join('')}${acts}`;
}

// Corp colour picker: a free wheel in a little "browser window". Fires
// 'set_corp-color' via wireBody. No uniqueness gating.
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
    <div class="tos-detail-desc">Start your own outfit, a shared treasury, ranks, territory, and a private corp channel. You'll be its Founder.</div>
    <div class="tos-row"><span>Founding fee</span><span>₵${fee.toLocaleString()}</span></div>
    <div class="tos-row"><span>Your credits</span><span>₵${credits.toLocaleString()}</span></div>
    <div class="tos-founding-warn">${afford
      ? `Founding costs a one-time <b>₵${fee.toLocaleString()}</b>, debited the moment you create the corp. You can pick your corp colour right after.`
      : `You need <b>₵${fee.toLocaleString()}</b> to found a corp. You have ₵${credits.toLocaleString()}.`}</div>
    ${afford ? renderActions(d.appId, [{ id: 'found', label: `Found a Corp · ₵${fee.toLocaleString()}`, prompt: 'Name your corporation:' }], '') : ''}
  `;
}

// SPECTER hub: tiles carry live 'frame' text (refreshed by the poll); a focused tile
// gets a bigger feed and record/clip controls.
const SURV_STATUS = { offline: 'NO SIGNAL', damaged: 'DAMAGED', jammed: 'JAMMED', spoofed: 'SIGNAL FAULT' };

function renderCamFeed(t) {
  if (t.status === 'ok' && t.frame) return `<div class="tos-cam-feed">${esc(t.frame)}</div>`;
  if (t.status === 'ok') return `<div class="tos-cam-feed">· · ·</div>`;
  return `<div class="tos-cam-feed dead">${esc(SURV_STATUS[t.status] || 'NO FEED')}</div>`;
}

// The focused camera's recording buffer; "Clip → Reel" saves exactly these lines.
function renderBufferLog(buffer, recording, full) {
  const lines = Array.isArray(buffer) ? buffer : [];
  const cap = full ? ' <span class="tos-buf-full">FULL</span>' : '';
  const head = `<div class="tos-buf-head">◉ ON TAPE${lines.length ? ` · ${lines.length} line${lines.length === 1 ? '' : 's'}` : ''}${cap}</div>`;
  if (!lines.length) {
    return `${head}<div class="tos-buf empty">${recording ? 'Nothing on tape yet, activity in this zone will log here.' : 'Not recording. Hit Record to start a tape.'}</div>`;
  }
  const body = lines.map(l => `<div class="tos-buf-line ${l.kind === 'say' ? 'say' : 'event'}"><span class="tos-buf-t">${esc(l.t || '')}</span> <span class="tos-buf-txt">${esc(l.text || '')}</span></div>`).join('');
  return `${head}<div class="tos-buf">${body}</div>`;
}

// ── Gear app ─────────────────────────────────────────────────────────────
// A paperdoll over the silhouette, the soak table and passive effects.
const GEAR_LAYER_DEFS = [{ n: 1, label: 'Under' }, { n: 2, label: 'Over' }, { n: 3, label: 'Armor' }];
const GEAR_SLOT_LABEL = { head: 'Head', torso: 'Torso', hands: 'Hands', legs: 'Legs', feet: 'Feet', weapon_hand: 'Weapon', accessory: 'Accessory' };
const GEAR_DMG = ['kinetic', 'edged', 'energy', 'fire', 'radiation'];
const GEAR_ARMOR_SLOTS = ['head', 'torso', 'hands', 'legs', 'feet'];
// Slots that fold into the Inventory tab's WORN groups. Not weapon_hand. Separate from
// GEAR_ARMOR_SLOTS, which drives the doll and soak table.
const WORN_GROUP_SLOTS = [...GEAR_ARMOR_SLOTS, 'accessory'];
const GEAR_SHIELD_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 2.5v5.6c0 4.4-3 7.4-7 9.4-4-2-7-5-7-9.4V5.5z"/></svg>`;
const GEAR_THERMO_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a3.5 3.5 0 1 0 4 0z"/><path d="M12 9v6.2"/></svg>`;
// One line icon per damage type (currentColor).
const GEAR_DMG_ICON = {
  kinetic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M18 6l-2 2M6 18l2-2"/></svg>`,
  edged: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l10-10"/><path d="M14 10l5-6 1 1-5 6z"/><path d="M4.5 17.5l2 2"/></svg>`,
  energy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M13 2L5 13h5l-1 9 9-12h-5z"/></svg>`,
  fire: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c3 4 4.5 6 4.5 9a4.5 4.5 0 0 1-9 0c0-1.6.6-2.9 1.7-3.9.1 1 .8 1.9 1.8 2.2-.7-2.3-.4-4.7 1-7.3z"/></svg>`,
  radiation: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><circle cx="12" cy="12" r="2.1"/><path d="M12 9.6 16.4 4 7.6 4Z"/><path d="M13.5 12.8 18.4 15.8 15.4 20.5Z"/><path d="M10.5 12.8 8.6 20.5 5.6 15.8Z"/></svg>`,
};

// Insulation is a fractional °C (a t-shirt is 0.5): don't round to whole degrees.
const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

function gearWeight(g) {
  g = Number(g) || 0;
  return g < 1000 ? `${Math.round(g)}g` : `${(Math.round(g / 100) / 10)}kg`;
}

// Layer name → stored integer (mirrors the engine's LAYERS). A body-slot drop only
// takes when the piece's layer matches the one shown.
const GEAR_LAYER_N = { underwear: 1, outerwear: 2, armor: 3 };
const GEAR_VERB_LABELS = { eat: 'Eat', drink: 'Drink', use: 'Use', open: 'Open', read: 'Read' };
// The verb an item most wants. Equip/unequip/drop are excluded: the doll teaches those.
const GEAR_PRIMARY_VERBS = ['use', 'read', 'eat', 'drink', 'smoke', 'open', 'play', 'light'];
function primaryVerb(it) {
  const acts = it?.actions || [];
  return GEAR_PRIMARY_VERBS.find(v => acts.includes(v)) || null;
}
// Wear, wield or put on, named off the slot. "Equip" is engine vocabulary.
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

// The silhouette: femsil.png baked to an alpha mask (scripts/build-femsil-mask.mjs),
// tinted by CSS. The .tos-gslot--<slot> boxes are placed over it.
function gearDoll() {
  return `<div class="tos-doll-fig" role="img" aria-label="Body silhouette"></div>`;
}

// A ◂ n/m ▸ pager. 'kind' ('tray'|'inv') picks the counter. Empty at one page.
function gearPager(kind, page, pages) {
  if (pages <= 1) return '';
  return `<div class="tos-gpager" data-gpager="${kind}">
    <button class="tos-gpg" data-gpg="prev"${page <= 0 ? ' disabled' : ''}>◂</button>
    <span>${page + 1} / ${pages}</span>
    <button class="tos-gpg" data-gpg="next"${page >= pages - 1 ? ' disabled' : ''}>▸</button></div>`;
}

// A draggable tray card; drag onto its slot (or tap) to equip. No ⤓ here on purpose:
// a drop button beside the equip target loses jackets. Drop lives on Inventory.
function gearCard(it) {
  const slot = it.tags?.slot || '';
  const qty = it.quantity > 1 ? ` ×${it.quantity}` : '';
  const meta = slot ? esc(slot.replace('_', ' ')) : (it.tags?.container != null ? 'container' : '');
  return `<div class="tos-gcard${slot ? ' equippable' : ''}" data-gid="${it.id}" data-gslot="${slot}">` +
    `<span class="tos-gcard-name">${esc(it.name)}${qty}</span>` +
    (meta ? `<span class="tos-gcard-meta">${meta}</span>` : '') + `</div>`;
}

// KIT app: Inventory (primary) and Gear tabs. The Gear tab KEY is still 'loadout'
// (persisted in _gearTab, read by wireGear's data-gtab).
function renderGear(d) {
  const tabs =
    `<div class="tos-gtabs">
       <button class="tos-gtab${_gearTab === 'inventory' ? ' active' : ''}" data-gtab="inventory">Inventory</button>
       <button class="tos-gtab${_gearTab === 'loadout' ? ' active' : ''}" data-gtab="loadout">Gear</button>
     </div>`;
  const title = `<div class="tos-inv-title"><b>INV</b>Inventory: Necessities &amp; Vestments</div>`;
  return `<div class="tos-gear">${title}${tabs}${_gearTab === 'inventory' ? renderGearInventory(d) : renderGearLoadout(d)}</div>`;
}

function renderGearLoadout(d) {
  const items = d.items || [];
  const equipped = items.filter(i => i.is_equipped);
  const layerN = GEAR_LAYER_DEFS[_gearLayer].n;
  // A garment fills its own slot plus every slot in its 'covers' tag.
  const occupies = (i, slot) => i.slot === slot || (Array.isArray(i.tags?.covers) && i.tags.covers.includes(slot));
  const bodyItem = (slot) => equipped.find(i => occupies(i, slot) && (i.layer || 1) === layerN);
  // Body-slot pieces on a layer other than the one shown. An empty box with such gear
  // becomes a "reveal" control, so every layer's piece stays reachable.
  const hiddenPieces = (slot) => GEAR_ARMOR_SLOTS.includes(slot)
    ? equipped.filter(i => occupies(i, slot) && (i.layer || 1) !== layerN).sort((a, b) => (b.layer || 1) - (a.layer || 1))
    : [];

  // Each box sits over its body part (.tos-gslot--<slot>). It shows the selected layer's
  // piece, else the outermost worn one. A filled box is both a drop target and an unequip source.
  const box = (slot, it) => {
    // A piece from another layer is drawn DIMMED (.off-layer); that's the whole signal.
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

  const layers = GEAR_LAYER_DEFS.map((l, i) =>
    `<button class="tos-gl${i === _gearLayer ? ' active' : ''}" data-glayer="${i}">${l.label}</button>`).join('');
  const wPct = d.capacity ? Math.min(100, Math.round((d.weight / d.capacity) * 100)) : 0;
  const carry =
    `<div class="tos-gear-carry" title="Carried weight">
       <div class="tos-gear-bar"><span style="width:${wPct}%"></span></div>
       <span class="tos-gear-carry-txt">${gearWeight(d.weight)} / ${gearWeight(d.capacity)}</span>
     </div>`;

  // Per-region soak is READ from the server's player.soak (what combat uses), never
  // summed from tags, which misses 'covers' slots and non-item armour.
  const slotSoak = (slot) => d.soak?.[slot]?.soak || {};
  let soak = `<table class="tos-gear-soak"><thead><tr><th></th>${GEAR_DMG.map(t => `<th>${esc(gcap(t).slice(0, 3))}</th>`).join('')}</tr></thead><tbody>`;
  for (const slot of GEAR_ARMOR_SLOTS) {
    const t = slotSoak(slot);
    soak += `<tr><td>${esc(GEAR_SLOT_LABEL[slot])}</td>${GEAR_DMG.map(dt => `<td class="${t[dt] ? 'has' : ''}">${t[dt] || 0}</td>`).join('')}</tr>`;
  }
  soak += '</tbody></table>';

  const fx = d.effects || {};
  const parts = [];
  for (const [k, v] of Object.entries(fx.stat_bonus || {})) parts.push(`${k.replace('stat_', '')} ${v > 0 ? '+' : ''}${v}`);
  if (fx.insulation) parts.push(`insulation ${fx.insulation}°C`);
  if (fx.sealed) parts.push('sealed airway');
  if (fx.exposurePenalty) parts.push(`exposure ${fx.exposurePenalty}`);
  const fxHtml = parts.length
    ? `<div class="tos-gear-fx">${parts.map(p => `<span>${esc(p)}</span>`).join('')}</div>`
    : '<div class="tos-gear-fx empty">No passive effects.</div>';

  // Top-right: layer selector, carry weight, total soak and insulation. A hit meets
  // only ONE slot's share of the total.
  const totalSoak = GEAR_ARMOR_SLOTS.reduce((s, slot) =>
    s + Object.values(slotSoak(slot)).reduce((a, v) => a + (Number(v) || 0), 0), 0);
  const far =
    `<div class="tos-gload-far">
       <div class="tos-gl-group">${layers}</div>
       ${carry}
       <div class="tos-gstat tos-gstat-armor" data-armor-break title="Soak across all five body slots. A hit only meets its own slot's share, click for the per-type breakdown, and see the Protection table for where you're bare.">${GEAR_SHIELD_SVG}<span>${totalSoak}</span></div>
       <div class="tos-gstat" title="Insulation from what you're wearing: +${round1(fx.insulation || 0)}°C of effective ambient, dry. This is NOT your body temperature (that's in Vitals), and soaked clothing keeps far less of it.">${GEAR_THERMO_SVG}<span>+${round1(fx.insulation || 0)}° insul</span></div>
     </div>`;

  // Tray: equippable pieces only. The drop ZONE stays (a deliberate drag, and the way
  // out of a full tray); the per-card ⤓ moved to Inventory.
  const tray = (d.inventory || []).filter(i => !i.is_equipped && i.tags?.slot);
  const pages = Math.max(1, Math.ceil(tray.length / GEAR_TRAY_PAGE));
  _gearTrayPage = Math.min(Math.max(0, _gearTrayPage), pages - 1);
  const slice = tray.slice(_gearTrayPage * GEAR_TRAY_PAGE, _gearTrayPage * GEAR_TRAY_PAGE + GEAR_TRAY_PAGE);
  const trayHtml =
    `<div class="tos-gtray">${slice.length ? slice.map(gearCard).join('') : '<div class="tos-gtray-empty">Nothing loose in your pack.</div>'}</div>
     ${gearPager('tray', _gearTrayPage, pages)}
     <div class="tos-gear-drop" data-gdropzone title="Drag an item here to leave it on the ground">⤓ Drop to ground</div>`;

  return `
    <div class="tos-gload">
      <div class="tos-gload-side" data-gtray-zone>${trayHtml}</div>
      <div class="tos-gload-doll">${doll}<div class="tos-gload-fb" id="tos-gear-fb"></div></div>
      ${far}
    </div>
    <div class="tos-gear-stats"><div class="tos-gear-sec">Protection</div>${soak}
      <div class="tos-gear-sec">Effects</div>${fxHtml}</div>`;
}

// Inventory tab: the whole pack, paged; a tap opens the item-detail sheet.
function renderGearInventory(d) {
  const all = d.inventory || [];
  // Worn gear folds into Clothing and Armour groups. Armour means PROTECTIVE
  // ('armor_soak', the only armour mechanism; docs/items.md), not the armor layer.
  const hasSoak = (it) => Object.values(it.tags?.armor_soak || {}).some(v => (Number(v) || 0) > 0);
  // Armour is body-slot only: an accessory with soak (the cobalt scarf) isn't armour.
  const isArmor = (it) => GEAR_ARMOR_SLOTS.includes(it.tags?.slot) && hasSoak(it);
  // Accessories group with clothing; the main list is for everything not worn.
  const isClothing = (it) => WORN_GROUP_SLOTS.includes(it.tags?.slot) && !isArmor(it);
  const clothing = all.filter(isClothing);
  const armor = all.filter(isArmor);
  const main = all.filter(it => !isClothing(it) && !isArmor(it));
  // What you're holding is PINNED above the paged list, outside the paging.
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
    // A held weapon says WIELDED, not "equipped".
    const badge = it.is_equipped
      ? (isWeapon(it) ? '<span class="tos-ginv-eq wielding">⚔ wielded</span>' : '<span class="tos-ginv-eq">equipped</span>')
      : (slot ? `<span class="tos-ginv-slot">${esc(slot.replace('_', ' '))}</span>` : '');
    const pv = primaryVerb(it);
    const verbChip = pv
      ? `<span class="tos-ginv-verb" data-ginv-verb="${esc(pv)}" title="${esc(GEAR_VERB_LABELS[pv] || gcap(pv))} ${esc(it.name)}">${esc(GEAR_VERB_LABELS[pv] || gcap(pv))}</span>`
      : '';
    // Weight on the row, × quantity.
    const w = Number(it.weight) || 0;
    const wt = w ? `<span class="tos-ginv-wt" title="${esc(gearWeight(w))} each">${esc(gearWeight(w * (it.quantity || 1)))}</span>` : '';
    // Worn pieces get no ⤓: dropping what you wear is two steps on purpose.
    const drop = it.is_equipped ? ''
      : `<button class="tos-ginv-drop" data-gdrop="${it.id}" title="Drop ${esc(it.name)} on the ground">⤓</button>`;
    // ⇧ / ⇩ wear/wield or remove straight from the list (anything with a 'slot' tag),
    // named off the slot. Same action as the doll, so the views can't disagree.
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
  // The pinned in-hand block, labelled; absent when your hands are empty.
  const inHand = wielded.length
    ? `<div class="tos-ginv-hand"><div class="tos-ginv-handlab">In hand</div>${wielded.map(row).join('')}</div>`
    : '';
  const list = loose.length
    ? `<div class="tos-ginv-list">${slice.map(row).join('')}</div>`
    : ((clothing.length || armor.length || wielded.length) ? '' : '<div class="tos-gtray-empty">Your pack is empty.</div>');
  // A collapsible group; 'key' is the data attribute the click handler toggles.
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

// The item-detail sheet: stats and verb buttons.
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

// ── Hover tooltip ────────────────────────────────────────────────────────────
// Quick stats for equippable items: armour soak per type (0s excluded) + insulation,
// or weapon damage range + type.
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

// Transient feedback under the doll; written directly, auto-clears.
function gearFeedback(msg) {
  const el = _overlay?.querySelector('#tos-gear-fb');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  if (_gearFbTimer) clearTimeout(_gearFbTimer);
  _gearFbTimer = setTimeout(() => { el.classList.remove('show'); }, 2600);
}

// Soak breakdown: every damage type, so gaps read as clearly as coverage.
function showArmorBreakdown() {
  closeGearItemDetail();
  // From the server's per-slot soak. Per type: the total and the WEAKEST slot, since a
  // hit lands somewhere specific.
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

// Layer/tab/page changes are client-side.
function rebuildGear() {
  hideGearTip();
  const root = _overlay?.querySelector('#tos-gear-root');
  if (root && _data) { root.innerHTML = renderGear(_data); wireGear(); }
}

function gearTrayItem(id) {
  return (_data?.inventory || []).find(i => i.id == id);
}

// Every mutating gear action is one round trip (mutate + refreshed screen), keeping scroll.
function gearAct(actionId, params) {
  _keepGearScroll = true;
  act('gear', actionId, String(params));
}

// Equip, then switch the doll to the piece's layer.
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

// Run a consumable verb by name, then silently re-open the app.
function gearVerb(verb, name) {
  _keepGearScroll = true;
  sendCmdSilent(`${verb} ${name}`);
  sendCmdSilent('tabletnav gear');
}

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

  _overlay.querySelectorAll('[data-gtab]').forEach(el => {
    el.addEventListener('click', () => {
      const t = el.getAttribute('data-gtab');
      if (t === _gearTab) return;
      _gearTab = t; sfx(TOS_SELECT_DEF); rebuildGear();
    });
  });

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

  // Inventory rows → detail sheet; the verb chip fires its verb directly.
  _overlay.querySelectorAll('[data-ginv]').forEach(el => {
    el.addEventListener('click', (e) => {
      const it = gearTrayItem(el.getAttribute('data-ginv'));
      if (!it) return;
      const chip = e.target.closest?.('[data-ginv-verb]');
      if (chip) { e.stopPropagation(); hideGearTip(); gearVerb(chip.getAttribute('data-ginv-verb'), it.name); return; }
      showGearItemDetail(it);
    });
  });

  _overlay.querySelector('[data-gclothing]')?.addEventListener('click', () => {
    _gearClothingOpen = !_gearClothingOpen;
    sfx(TOS_SELECT_DEF); rebuildGear();
  });
  _overlay.querySelector('[data-garmor]')?.addEventListener('click', () => {
    _gearArmorOpen = !_gearArmorOpen;
    sfx(TOS_SELECT_DEF); rebuildGear();
  });

  _overlay.querySelectorAll('.tos-gcard[data-gid], .tos-gslot[data-geq], [data-ginv]').forEach(el => {
    const id = el.getAttribute('data-gid') || el.getAttribute('data-geq') || el.getAttribute('data-ginv');
    const hint = el.hasAttribute('data-geq') ? 'Tap or drag to the list to unequip'
      : el.hasAttribute('data-gid') ? 'Tap or drag onto the doll to equip' : '';
    el.addEventListener('mouseenter', () => showGearTip(el, gearTrayItem(id), hint));
    el.addEventListener('mouseleave', hideGearTip);
    el.addEventListener('dragstart', hideGearTip);
  });

  const armorStat = _overlay.querySelector('[data-armor-break]');
  if (armorStat) armorStat.addEventListener('click', showArmorBreakdown);

  _overlay.querySelectorAll('[data-glayer]').forEach(el => {
    el.addEventListener('click', () => {
      const i = +el.getAttribute('data-glayer');
      if (i === _gearLayer) return;
      _gearLayer = i; sfx(TOS_SELECT_DEF); rebuildGear();
    });
  });

  _overlay.querySelectorAll('.tos-gslot[data-geq]').forEach(el => {
    el.addEventListener('click', () => gearAct('unequip', el.getAttribute('data-geq')));
  });

  _overlay.querySelectorAll('.tos-gcard.equippable').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-gdrop]')) return; // drop button handles itself
      gearEquipShowLayer(el.getAttribute('data-gid'));
    });
  });

  _overlay.querySelectorAll('[data-gdrop]').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); gearDrop(gearTrayItem(el.getAttribute('data-gdrop'))); });
  });

  // Inventory ⇧ / ⇩. stopPropagation: the row opens the detail sheet.
  _overlay.querySelectorAll('[data-gequip]').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); gearAct('equip', el.getAttribute('data-gequip')); });
  });
  _overlay.querySelectorAll('[data-gunequip]').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); gearAct('unequip', el.getAttribute('data-gunequip')); });
  });

  // ── Drag/drop (pointer-based) ──────────────────────────────────────────────
  // HTML5 drag-and-drop doesn't fire reliably in this fixed + transformed overlay, so
  // it's hand-rolled. A press that never passes LIFT falls through to the tap clicks.
  const gload = _overlay.querySelector('.tos-gload');
  if (gload) {
    const LIFT = 6;   // px of travel before a press becomes a drag (below = a tap)
    let press = null; // { kind:'equip'|'unequip', id, slot, srcEl, x, y }
    let drag = null;  // { ghost, offX, offY } once the press lifts into a real drag

    const clearHi = () => _overlay.querySelectorAll('.tos-gslot-over, .tos-gtray-over, .tos-gear-drop-over')
      .forEach(el => el.classList.remove('tos-gslot-over', 'tos-gtray-over', 'tos-gear-drop-over'));

    // The ghost is pointer-events:none, so elementFromPoint sees through it.
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
      // ⚠ Append inside the overlay, not body: gear styles are scoped to
      // #tablet-os-overlay. z-index 9300: above the panel (9200), under the detail modal (9400).
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
            // A piece equips on its own slot/layer; a wrong box gets a note.
            if (slotEl && slotEl.getAttribute('data-gslot') !== press.slot) {
              const s = slotEl.getAttribute('data-gslot');
              const it = gearTrayItem(press.id);
              gearFeedback(`${it?.name || 'That'} goes on ${GEAR_SLOT_LABEL[press.slot] || press.slot}, not ${GEAR_SLOT_LABEL[s] || s}`);
            }
            gearEquipShowLayer(press.id);
          } else if (t && t.closest('[data-gdropzone]')) {
            gearDrop(gearTrayItem(press.id));
          }
        } else if (t && t.closest('[data-gtray-zone]')) {
          gearAct('unequip', press.id);
        }
      }
      press = null; drag = null;
      // Swallow the trailing click so tap-to-equip doesn't fire twice.
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

// Sticky cams burn out 24h after planting.
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
      ${focus.full ? '<div class="tos-cam-fullbar">⚠ BUFFER FULL: clip or clear to record again</div>' : ''}
      ${renderBufferLog(d.focusBuffer, focus.recording, focus.full)}
      ${renderActions(d.appId, [
        { id: 'record', label: focus.recording ? 'Stop Recording' : 'Record' },
        { id: 'clip', label: 'Clip → Reel', disabled: !hasBuffer },
        { id: 'clear', label: 'Clear', disabled: !hasBuffer, confirm: 'Discard this buffer without saving a reel?' },
        // Only offered when a consumer deck in the room can take the feed.
        ...(d.deckHere ? [{ id: 'cast', label: d.deckCam === focus.id ? `Unpatch ${d.deckHere}` : `Patch → ${d.deckHere}` }] : []),
        { id: 'destruct', label: 'Self-Destruct', confirm: "Fry this device where it sits? It's destroyed, not recovered." },
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
// Inline playback of a saved recording. State is module-local (_reel*); wireReel()
// writes the DOM directly so frames don't need a re-render.
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
// Renders whisper.js's conversations; all chat state lives there. Live updates via
// onChatUpdate (subscribed in render(), dropped in close()).

// Emoji palette, ordered for an 8-column grid.
const CHAT_EMOJI = ['😀','😂','🙂','😉','😎','😍','😘','🤨','😴','🙄','😬','😳','😭','😢','😡','🤔','🤢','😱','💀','☠️','👍','👎','👌','🙏','👏','💪','🤞','👀','🔥','💯','✨','⭐','❤️','💔','🎉','💰','🍺','🚬','💊','⚠️','🚁','✈️','🔫','⚡','🌧️','🩸','🤖','💥'];
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
function emojifyChat(text) {
  text = text.replace(/:([a-z0-9_+-]+):/gi, (m, name) => EMOJI_SHORTCODES[name.toLowerCase()] || m);
  for (const [re, rep] of EMOJI_EMOTICONS) text = text.replace(re, rep);
  return text;
}

function renderChatMsg(m) {
  const body = m.isHtml ? m.message : parseMarkup(m.message);
  return `<div class="tos-chat-msg"><span class="tos-chat-from${m.isMe ? ' me' : ''}">${esc(m.isMe ? 'You' : m.from)}</span><span class="tos-chat-text">${body}</span></div>`;
}

// Users tab: players online now, tap to PM. Wired in wireBody().
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
  // Default to #system, else first channel, else first tab. Users is never auto-selected.
  if (!onUsers && (!_chatTab || !tabs.some(t => t.key === _chatTab))) {
    const sys = tabs.find(t => t.key === '#system');
    _chatTab = (sys || tabs.find(t => t.kind === 'channel') || tabs[0])?.key || null;
  }
  const active = onUsers ? null : (tabs.find(t => t.key === _chatTab) || null);
  if (active) markChatRead(active.key); // we're showing it — clear its unread

  const usersTab = `<div class="tos-chat-tab${onUsers ? ' sel' : ''}" data-chat-tab="${CHAT_USERS_TAB}" title="Players online now">Users</div>`;
  const convoTabs = tabs.map(t =>
    `<div class="tos-chat-tab${t.key === _chatTab ? ' sel' : ''}" data-chat-tab="${esc(t.key)}">${esc(t.label)}${t.unread ? `<span class="tos-chat-pip">${t.unread}</span>` : ''}${t.closable ? `<span class="tos-chat-x" data-chat-close="${esc(t.key)}" title="Close (or type /leave)">✕</span>` : ''}</div>`
  ).join('');
  const tabRow = `<div class="tos-chat-tabs">${usersTab}${convoTabs}</div>`;

  if (onUsers) return `<div class="tos-chat">${tabRow}${renderChatUsers()}</div>`;

  const msgs = active ? getChatMessages(active.key) : [];
  // #system holds only the MOTD <pre>, rendered bare so fitMotd() can scale it.
  const isSystem = active && active.key === '#system';
  // Always the "big" MOTD, scaled by fitMotd(); falls back to the stored #system message.
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

// Scale the ~100-char MOTD art to the chat width (transform) and collapse the wrapper
// to the scaled height. Runs after layout.
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
// A stack of section cards by section.type. A new type adds a case to newsWidget and a
// builder in plugins/tablet/news-app.js; unknown types show "unavailable". The paper
// look re-points theme variables on .tos-newspaper.
function renderNews(sections, masthead) {
  if (!sections || !sections.length) return '<div class="tos-empty">No news right now. Check back later.</div>';
  const articles = sections.map((sec, i) => `<article class="tos-art${i === 0 ? ' lead' : ''}">
    <div class="tos-art-kicker"><span class="tos-art-title">${esc(sec.title || '')}</span>${sec.subtitle ? `<span class="tos-art-sub">${esc(sec.subtitle)}</span>` : ''}</div>
    ${newsWidget(sec)}
  </article>`).join('');
  return `<div class="tos-newspaper">${renderMasthead(masthead)}${articles}</div>`;
}

// Masthead: nameplate, motto, dateline from the payload's game date.
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

// Police Blotter: a WARRANT (live) and an INCIDENT (past) are styled apart.
function renderBlotterWidget(sec) {
  if (sec.quiet && !(sec.entries || []).length) {
    return `<div class="tos-blotter"><div class="tos-blot-quiet">${esc(sec.quiet)}</div></div>`;
  }
  const rows = (sec.entries || []).map(e => {
    if (e.kind === 'warrant') {
      const stars = '★'.repeat(Math.max(1, Math.min(5, e.stars || 1)));
      return `<div class="tos-blot-row warrant">
        <span class="tos-blot-stars" title="${esc(String(e.stars || 0))} star">${stars}</span>
        <span class="tos-blot-body"><b>${esc(e.who)}</b>: wanted for ${esc(e.what)}</span>
      </div>`;
    }
    const where = e.where ? ` at ${esc(e.where)}` : '';
    const when = e.when ? `<span class="tos-blot-when">${esc(e.when)}</span>` : '';
    return `<div class="tos-blot-row">
      <span class="tos-blot-mark" aria-hidden="true">†</span>
      <span class="tos-blot-body"><b>${esc(e.who)}</b>: ${esc(e.what)}${where}</span>
      ${when}
    </div>`;
  }).join('');
  return `<div class="tos-blotter">${rows}</div>`;
}

// Weather card; tapping toggles the 7-day strip client-side. Uses only 'now'/'days'.
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
  // Flag a hero-event day: this is where most players see the week's warning.
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

function dayLabel(f) {
  if (f.day === 0) return 'Today';
  if (!f.date) return `Day ${f.day}`;
  const d = new Date(f.date);
  return isNaN(d) ? `Day ${f.day}` : d.toLocaleDateString(undefined, { weekday: 'short' });
}

function renderHeadlinesWidget(stories) {
  if (!stories || !stories.length) return '<div class="tos-empty" style="padding:14px 4px">Quiet news day. Too quiet.</div>';
  // Stash the feed so a tapped headline opens client-side (index-keyed, no escaping).
  _newsStories = stories;
  return `<div class="tos-news-list">${stories.map((s, i) => `<div class="tos-headline" data-news-idx="${i}" role="button" tabindex="0">
    <span class="tos-hl-tag ${s.tag === 'live' ? 'live' : 'tabloid'}">${s.tag === 'live' ? 'LIVE' : 'WIRE'}</span>
    <span class="tos-hl-text">${esc(s.headline)}${s.byline ? ` <span class="tos-hl-by">(${esc(s.byline)})</span>` : ''}</span>
  </div>`).join('')}</div>`;
}

// A tapped headline opens in a "browser window" popup inside the overlay; a re-render
// or second tap dismisses it.
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
      <div class="tos-nw-foot">The Coldwater Sentinel: all the truth the Architect permits.</div>
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
  if (!teams || !teams.length) return '<div class="tos-empty" style="padding:14px 4px">No games have been played yet, the DEADBALL standings are empty.</div>';
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
    `<div class="tos-obj${o.done ? '' : ' pending'}"><span class="tos-check">${o.done ? '☑' : '☐'}</span><span>${esc(o.desc)}${o.need > 1 ? ` (${o.have}/${o.need})` : ''}${o.optional ? ' <span class="tos-dim">(optional)</span>' : ''}</span></div>`
  ).join('')}</div>`;
}

// An action with 'prompt' asks for free text via window.prompt() in wireBody().
// A 'slider' action ({ slider: { min, max, step, value, unit } }) fires on change,
// not input, so a drag sends one command.
function renderSlider(appId, a) {
  const sl = a.slider || {};
  const v = sl.value ?? sl.min ?? 0;
  const unit = esc(sl.unit || '');
  return `<label class="tos-slider"><span class="tos-slider-hd"><span>${esc(a.label)}</span><b data-slider-out>${esc(String(v))}${unit}</b></span>`
    + `<input type="range" min="${esc(String(sl.min ?? 0))}" max="${esc(String(sl.max ?? 100))}" step="${esc(String(sl.step ?? 1))}" value="${esc(String(v))}"`
    + ` data-slider-act="${esc(a.id)}" data-slider-app="${esc(appId)}" data-slider-unit="${unit}"${a.disabled ? ' disabled' : ''} aria-label="${esc(a.label)}"></label>`;
}

// A detail's optional status card: { icon, title, sub, badge, badgeKind }.
// badgeKind 'warn' is amber, anything else is the accent.
function renderHero(h) {
  if (!h) return '';
  return `<div class="tos-hero">${h.icon ? `<div class="tos-hero-icon" aria-hidden="true">${esc(h.icon)}</div>` : ''}`
    + `<div class="tos-hero-txt"><div class="tos-hero-title">${esc(h.title || '')}</div>${h.sub ? `<div class="tos-hero-sub">${esc(h.sub)}</div>` : ''}</div>`
    + `${h.badge ? `<span class="tos-hero-badge${h.badgeKind === 'warn' ? ' warn' : ''}">${esc(h.badge)}</span>` : ''}</div>`;
}

// A grid of small read-outs: [{ label, value }].
function renderTiles(tiles) {
  if (!tiles?.length) return '';
  return `<div class="tos-tiles">${tiles.map(t => `<div class="tos-tile-stat"><span>${esc(t.label)}</span><b>${esc(String(t.value ?? ''))}</b></div>`).join('')}</div>`;
}

// A 'chips' action ({ chips: { options: [{ value, label, icon? }], active } }): one
// button per option, fires with its value.
function renderChips(appId, a) {
  const ch = a.chips || {};
  const opts = (ch.options || []).map(o => {
    const on = o.value === ch.active;
    return `<button type="button" class="tos-chip${on ? ' on' : ''}" data-chip-act="${esc(a.id)}" data-chip-app="${esc(appId)}" data-chip-val="${esc(o.value)}" aria-pressed="${on}">${o.icon ? `<span aria-hidden="true">${esc(o.icon)}</span> ` : ''}${esc(o.label)}</button>`;
  }).join('');
  return `<div class="tos-chips-row"><div class="tos-section-hd">${esc(a.label)}</div><div class="tos-chips">${opts}</div></div>`;
}

function renderActions(appId, actions, params) {
  if (!actions || !actions.length) return '';
  const sliders = actions.filter(a => a.slider);
  const chips = actions.filter(a => a.chips);
  actions = actions.filter(a => !a.slider && !a.chips);
  return `${sliders.length ? `<div class="tos-sliders">${sliders.map(a => renderSlider(appId, a)).join('')}</div>` : ''}${chips.map(a => renderChips(appId, a)).join('')}${actions.length ? `<div class="tos-actions">${actions.map(a =>
    a.disabled
      ? `<button class="tos-btn disabled" disabled>${esc(a.label)}</button>`
      : `<button class="tos-btn${a.kind ? ` tos-btn-${esc(a.kind)}` : ''}" data-act-id="${esc(a.id)}" data-act-app="${esc(appId)}" data-act-params="${esc(params || '')}"${a.prompt ? ` data-act-prompt="${esc(a.prompt)}"` : ''}${a.pick ? ` data-act-pick="${esc(JSON.stringify(a.pick)).replace(/"/g, '&quot;')}"` : ''}${a.confirm ? ` data-act-confirm="${esc(a.confirm)}"` : ''}${a.title ? ` data-act-title="${esc(a.title)}"` : ''}${a.launch ? ` data-act-launch="${esc(a.launch)}"` : ''}>${esc(a.label)}</button>`
  ).join('')}</div>` : ''}`;
}

// DEADHEAD crew console: tap an airfield (data-act-id="chart") to chart a course, or
// anywhere on #tos-dh-map to 'loiter' there. _dhBox keeps the last bounding box so
// that click can invert to a tile.
let _dhBox = null;
let _dhRegions = false;   // DEADHEAD map: is the labelled region overlay drawn over the terrain?
// DEADHEAD terrain palette keyed by worldTerrainMap() codes. Muted so markers stay readable.
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
  // REGION mode is a client-side toggle; region rects ride every push.
  const regions = dh.regions || [];
  const regionMode = _dhRegions && regions.length > 0;
  const world = dh.world || null;
  // One frame: the extent is the WORLD, so terrain, regions, airfields and ship agree.
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
  // Region rects: plain boxes; a tap holds over the centre via the same loiter dispatch.
  const REG_HUE = ['#5ad1ff', '#7dffb0', '#ffb43a', '#ff8ad1', '#b48aff', '#59e0d0'];
  const boxes = !regionMode ? '' : regions.map((r, i) => {
    const col = REG_HUE[i % REG_HUE.length];
    const x0 = Math.min(nx(r.minX), nx(r.maxX)), x1 = Math.max(nx(r.minX), nx(r.maxX));
    const y0 = Math.min(ny(r.minY), ny(r.maxY)), y1 = Math.max(ny(r.minY), ny(r.maxY));
    return `<button type="button" title="${esc(r.name)}, hold over it"
      data-act-id="loiter" data-act-app="deadhead" data-act-params="${Math.round(r.cx)} ${Math.round(r.cy)}"
      style="position:absolute;left:${x0.toFixed(1)}%;top:${y0.toFixed(1)}%;width:${Math.max(1.5, x1 - x0).toFixed(1)}%;height:${Math.max(1.5, y1 - y0).toFixed(1)}%;
        background:${col}14;border:1px solid ${col}66;border-radius:4px;cursor:pointer;padding:0;font-family:inherit;text-align:left">
      <span style="position:absolute;left:4px;top:2px;font-size:0.5313rem;letter-spacing:.4px;color:${col};text-shadow:0 1px 2px #000;white-space:nowrap;max-width:96%;overflow:hidden;text-overflow:ellipsis">${esc(r.name)}</span>
    </button>`;
  }).join('');
  // Airfield pips show in both modes.
  const dots = fields.map(f => {
    const charted = !dh.charted?.loiter && dh.charted?.id === f.id;
    return `<button type="button" style="position:absolute;left:${nx(f.gx).toFixed(1)}%;top:${ny(f.gy).toFixed(1)}%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:1px;background:none;border:none;cursor:pointer;padding:2px;font-family:inherit"
      data-act-id="chart" data-act-app="deadhead" data-act-params="${esc(f.id)}" title="${esc(f.name)}: ${f.dist} tiles">
      <span style="font-size:0.8125rem;line-height:1;color:${charted ? '#7dffb0' : acc};filter:drop-shadow(0 0 3px ${charted ? '#2f8' : 'transparent'})">✈</span>
      <span style="font-size:0.5313rem;letter-spacing:.3px;color:${charted ? '#7dffb0' : 'var(--tos-dim,#9ab)'};white-space:nowrap;max-width:76px;overflow:hidden;text-overflow:ellipsis">${esc(f.name)}</span>
    </button>`;
  }).join('');
  const loiterMk = loiter ? `<div style="position:absolute;left:${nx(loiter.gx).toFixed(1)}%;top:${ny(loiter.gy).toFixed(1)}%;transform:translate(-50%,-50%);color:#7dffb0;font-size:0.9375rem;line-height:1;text-shadow:0 0 7px #2f8;pointer-events:none" title="hold point">◎</div>` : '';
  // The ship. ✈ points north-EAST, so rotation carries a −45° correction. A CSS
  // transition glides her between pushes.
  const hdg = ((dh.hdg || 0) % 360 + 360) % 360;
  const here = `<div style="position:absolute;left:${nx(acX).toFixed(2)}%;top:${ny(acY).toFixed(2)}%;transform:translate(-50%,-50%);pointer-events:none;transition:left .9s linear,top .9s linear" title="${esc(dh.name || 'your aircraft')}, heading ${Math.round(hdg)}°">
    <div style="position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:1px solid rgba(255,90,106,.45);box-shadow:0 0 8px rgba(255,90,106,.35)${dh.moving ? ';animation:tos-dh-ping 2s ease-out infinite' : ''}"></div>
    <div style="transform:rotate(${(hdg - 45).toFixed(1)}deg);transition:transform .9s linear;color:#ff5a6a;font-size:1.0625rem;line-height:1;text-shadow:0 0 7px #ff5a6a">✈</div>
  </div>`;
  const st = dh.status || {};
  const stateColor = st.state === 'crew' ? '#5ad1ff' : st.state === 'parked' ? 'var(--tos-dim,#9ab)' : acc;
  const fuel = typeof dh.fuel === 'number' ? `<span style="font-size:0.6875rem;color:${dh.fuel < 25 ? '#ff7a86' : 'var(--tos-dim,#9ab)'}">⛽ ${dh.fuel}%</span>` : '';
  const notice = d.notice ? `<div style="margin:6px 0;padding:6px 9px;border-left:2px solid ${acc};background:rgba(255,255,255,.04);font-size:0.75rem">${esc(d.notice)}</div>` : '';
  const clearBtn = `<button type="button" class="tos-btn" style="padding:1px 8px;font-size:0.6875rem;margin-left:6px" data-act-id="clear" data-act-app="deadhead" data-act-params="">clear</button>`;
  const hint = dh.remote
    ? `Tap a <b>field</b> to send her there, or <b>anywhere</b> to hold: the crew fly her. Board her to walk the decks.`
    : `Tap an <b>airfield</b> to land there, or <b>anywhere</b> to hold that spot.`;
  const charted = dh.charted
    ? (dh.charted.loiter
      ? `<div style="margin-top:8px;font-size:0.75rem">Holding over <b style="color:#7dffb0">${esc(dh.charted.name)}</b> until bingo fuel, then divert to land ${clearBtn}</div>`
      : `<div style="margin-top:8px;font-size:0.75rem">${dh.remote ? 'Bound for' : 'Course set:'} <b style="color:#7dffb0">${esc(dh.charted.name)}</b>${(!dh.remote && !dh.airborne && !dh.crew && dh.seat !== 'pilot') ? ' <span style="color:var(--tos-dim,#8aa)">: hit <b>Depart</b> and the crew take her up.</span>' : ''} ${dh.remote ? '' : clearBtn}</div>`)
    : `<div style="margin-top:8px;font-size:0.75rem;color:var(--tos-dim,#8aa)">${hint}</div>`;
  const btns = [];
  if (dh.remote) btns.push(`<button type="button" class="tos-btn" data-act-id="circlehere" data-act-app="deadhead" data-act-params="" title="send the crew to hold a lazy orbit over her current spot">Circle here</button>`);
  else if (dh.crew || (dh.seat === 'pilot' && dh.airborne)) btns.push(`<button type="button" class="tos-btn" data-act-id="circlehere" data-act-app="deadhead" data-act-params="" title="hold a gentle orbit over her current position">Circle here</button>`);
  // DEPART: aboard, parked, not at the controls, course charted.
  if (!dh.remote && !dh.airborne && !dh.crew && dh.seat !== 'pilot' && dh.charted) {
    btns.push(`<button type="button" class="tos-btn" data-act-id="depart" data-act-app="deadhead" data-act-params="" style="border-color:#7dffb0;color:#7dffb0" title="the crew spin her up and fly the charted course">▶ Depart</button>`);
  }
  if (!dh.remote && dh.seat === 'pilot') btns.push(`<button type="button" class="tos-btn" data-act-id="hand" data-act-app="deadhead" data-act-params="">Hand off to the crew</button>`);
  else if (!dh.remote && dh.atDeck && !dh.airborne && !dh.crew) btns.push(`<button type="button" class="tos-btn" data-act-id="take" data-act-app="deadhead" data-act-params="">Take the controls</button>`);
  const controls = btns.length ? `<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">${btns.join('')}</div>` : '';
  return `<div style="padding:4px 2px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:8px 10px;border:1px solid var(--border,#2a3a44);border-radius:8px;background:rgba(255,255,255,.03)">
      <span style="font-weight:bold;letter-spacing:.5px;color:${acc}">✈ ${esc(dh.name || 'Leviathan')}</span>
      <span style="display:flex;gap:10px;align-items:baseline"><span style="font-size:0.75rem;color:${stateColor}">${esc(st.text || '')}</span>${fuel}</span>
    </div>
    ${notice}
    ${regions.length ? `<div style="display:flex;gap:6px;margin:10px 0 -4px;align-items:center">
      <button type="button" class="tos-btn" data-dh-view="${regionMode ? 'fields' : 'regions'}" style="padding:1px 9px;font-size:0.6875rem;${regionMode ? `border-color:${acc};color:${acc}` : ''}" title="overlay the named regions on the map">▦ REGIONS</button>
      <span style="font-size:0.625rem;color:var(--tos-dim,#8aa)">${regionMode ? 'tap a region to hold over it' : 'tap a field to chart · anywhere to hold'}</span>
    </div>` : ''}
    <div id="tos-dh-map" style="position:relative;height:210px;margin:10px 0;border:1px solid var(--border,#2a3a44);border-radius:9px;cursor:crosshair;background:${world ? '#0a0f14' : 'repeating-linear-gradient(0deg,transparent,transparent 23px,rgba(255,255,255,.03) 24px),repeating-linear-gradient(90deg,transparent,transparent 23px,rgba(255,255,255,.03) 24px),radial-gradient(circle at 50% 50%,rgba(90,120,150,.10),transparent 70%)'};overflow:hidden">
      ${world ? `<canvas id="tos-dh-canvas" style="position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;opacity:.92"></canvas>` : ''}
      ${boxes}${dots}${loiterMk}${here}</div>
    ${charted}
    ${controls}
  </div>`;
}

// ── TV app ───────────────────────────────────────────────────────────────────
// The viewport carries the same data-tv hooks as index.html's set, so the shared
// renderer (panels/tv.js createTvView) drives it unchanged.
let _tvView = null;

function renderTv(d) {
  // Off the grid: dead air. Returns before the TV view is built, so mountTabletTv
  // never opens a tuner out here.
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
        <button data-tv="schedule-btn" title="TV guide, what's on and when">&#x1F5D3;</button>
        <button data-tv="gameday-btn" title="Gameday: animated play-by-play">&#x26BE;</button>
        <button data-tv="standings-btn" title="Standings: the DEADBALL league table">&#x1F3C6;</button>
        <button data-tv="read-btn" title="Read broadcast aloud">&#x1F508;</button>
        <button data-tv="close-btn" title="Switch the screen off">&#x23FB;</button>
      </div>
    </div>
    <div class="tos-tv-dial">${chips}</div>
  </div>`;
}

// Bind the shared renderer to the fresh viewport; the old instance is torn down first.
// ── World Map ────────────────────────────────────────────────────────────────
let _worldmap = null, _worldmapGen = 0;
function mountWorldmap() {
  const host = _overlay?.querySelector('#tos-worldmap');
  if (!host) return;
  unmountWorldmap();
  const gen = ++_worldmapGen, data = _data;
  import('/shared/worldmap-render.js').then(({ mountWorldMap }) => {
    if (gen !== _worldmapGen || !host.isConnected) return;   // navigated away while it loaded
    _worldmap = mountWorldMap(host, data, { tablet: true });
  }).catch((e) => { host.textContent = 'The map would not load.'; console.warn('worldmap', e); });
}
function unmountWorldmap() { _worldmapGen++; _worldmap?.destroy(); _worldmap = null; }

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
  // Open with the picture centred, not under the clock/summary row.
  requestAnimationFrame(() => {
    const scroll = _overlay?.querySelector('.tos-scroll');
    if (!scroll || !host.isConnected) return;
    const top = host.offsetTop - Math.max(0, (scroll.clientHeight - host.offsetHeight) / 2);
    scroll.scrollTop = Math.max(0, top);
  });
  const channels = _data?.channels || [];
  const ch = channels.find(c => c.channelId === _data?.tuned);
  if (ch) {
    // Re-entering resumes your channel; the server answers with a dest:'tablet' tv_panel.
    sendCmdSilent(`tablettune ${ch.number}`);
  } else {
    // Nothing tuned: power up dark on static, like a set that's off.
    _tvView.open({ channelId: null, channelNumber: 0, stationName: '', channelName: '', channelList: channels });
  }
}

function unmountTabletTv() {
  if (!_tvView) return;
  _tvView.destroy();   // closes the view, which drops the portable tuner server-side
  _tvView = null;
}

// A dest:'tablet' tv_panel answering 'tablettune'. Routed here from dispatch.js.
export function openTabletTvPanel(msg) {
  _tvView?.open(msg);
  // Repaint the channel chips only; the renderer owns the screen.
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
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(null, [d.appName])}${renderTabletSettings(d)}</div>`;
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
  if (d.view === 'worldmap') {
    // Canvas mounted after the HTML (mountWorldmap), lazily, so the wildlands field is
    // fetched only on open. One of two hints shows (.tos-wm-hint).
    return `<div class="tos-body tos-worldmap-view">${hdr}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}
      <div id="tos-worldmap" class="tos-worldmap"></div>
      <div class="tos-wm-hint"><span class="tos-wm-mouse">Scroll to zoom, drag to pan, hover for detail.</span><span class="tos-wm-touch">Pinch to zoom, drag to pan, tap for detail.</span> Numbered shields are this week's highways.</div>
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
    // The Orders section carries its own crumb in its sticky tab strip.
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
               : d.libKind === 'longbox' ? renderLongbox(d)
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
  // Bounty board (plugins/bounty/tablet-app.js). Rendered as the same characters the
  // log gets (posterLines(), padded to WIDTH), hence <pre> and monospace: don't
  // re-word or re-lay it out (docs/systems-bounties.md).
  if (d.view === 'bounties') {
    const money = (n) => `₵${Number(n || 0).toLocaleString('en-US')}`;
    const sheet = d.sheet
      ? `<pre class="tos-poster">${esc((d.sheet.lines || []).join('\n'))}</pre>`
      : '';
    // Paper out on YOU leads.
    const alarm = (!d.sheet && d.onMe)
      ? `<div class="tos-error" style="text-align:left;padding:0 0 10px">✱ ${d.onMe === 1 ? 'A contract is' : `${d.onMe} contracts are`} out on you, worth ${money(d.onMeTotal)}. No name on the sheet.</div>`
      : '';
    // Underscored token: normScreen() turns underscores into spaces, and a bare
    // "Vex Mordant" would tokenize as a screen plus a stray word.
    const items = (d.contracts || []).map(c => ({
      id: String(c.target || '').replace(/\s+/g, '_'),
      label: c.target,
      badge: c.isTarget ? 'bad' : c.isBacker ? 'good' : (c.band || ''),
      badgeLabel: c.isTarget ? 'ON YOU' : c.isBacker ? 'YOURS' : (c.band || ''),
      sub: `${money(c.reward)}${c.deadline ? ` · ${c.deadline}` : ''}`,
    }));
    const body = d.sheet ? sheet
      : (items.length ? renderList(items) : '<div class="tos-empty">No paper up. Quiet week.</div>');
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}
      ${alarm}${body}
      ${d.hint ? `<div class="tos-li-sub" style="padding-top:10px;opacity:.75">${esc(d.hint)}</div>` : ''}
    </div>`;
  }
  if (d.view === 'accolades') {
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}
      ${renderAccolades(d)}
    </div>`;
  }
  if (d.view === 'binder' || d.view === 'binder_card') {
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}
      ${d.view === 'binder_card' ? renderBinderCard(d) : renderBinder(d)}
    </div>`;
  }
  if (d.view === 'bliss_listings' || d.view === 'bliss_detail' || d.view === 'bliss_arrangement') {
    const body = d.view === 'bliss_detail' ? renderBlissDetail(d)
               : d.view === 'bliss_arrangement' ? renderBlissArrangement(d)
               : renderBlissListings(d);
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}
      <div class="tos-bliss-view">
        ${d.notice ? `<div class="tos-bliss-notice">${esc(d.notice)}</div>` : ''}
        ${body}
      </div>
    </div>`;
  }
  if (d.view === 'reel') {
    const reelActions = d.reel?.id
      ? renderActions(d.appId, [{ id: 'delete', label: '🗑 Destroy Reel', confirm: "Permanently destroy this microreel? This can't be undone." }], d.reel.id)
      : '';
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}
      ${renderReel(d)}
      ${reelActions}
    </div>`;
  }
  if (d.view === 'chat') {
    return `<div class="tos-body tos-chat-view">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb?.length ? d.breadcrumb : [d.appName])}
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
    // The fake game is mounted into #tos-fake-root by mountFakePlay() after render,
    // entirely client-side.
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
    // Tabs and rows on list screens too (Sports' league tabs need them). Both no-op
    // when the payload omits them.
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb || [d.appName])}${renderTosTabs(d)}${d.notice ? `<div class="tos-error" style="text-align:left;padding:0 0 10px">${esc(d.notice)}</div>` : ''}${renderList(d.items)}${d.rows ? `<div class="tos-detail-rows">${renderDetailRows(d.rows)}</div>` : ''}${pageNav}${renderActions(d.appId, d.actions, '')}</div>`;
  }
  if (d.view === 'detail') {
    const det = d.detail || d.quest || {};
    const params = det.id || '';
    const qlog = d.appId === 'quests' && det.id ? renderQuestActivityLog(det.id) : '';
    // A library chapter is set as a BOOK (aged paper, serif, illuminated initial).
    const isBook = d.appId === 'library';
    return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, d.breadcrumb || [d.appName])}${renderTosTabs(d)}
      ${d.notice ? (d.noticeKind === 'ok' ? `<div class="tos-notice-ok" role="status">${esc(d.notice)}</div>` : `<div class="tos-error" style="text-align:left;padding:0 0 10px">${esc(d.notice)}</div>`) : ''}
      ${det.name ? `<div class="tos-detail-name${isBook ? ' tos-book-title' : ''}">${esc(det.name)}</div>` : ''}
      ${det.desc ? `<div class="tos-detail-desc">${esc(det.desc)}</div>` : ''}
      ${renderHero(det.hero)}
      ${renderTiles(det.tiles)}
      ${renderObjectives(d.quest?.objectives)}
      ${d.narratable ? renderNarrateBar() : ''}
      ${det.body ? `<div class="tos-detail-body${isBook ? ' tos-book' : ''}${d.comic ? ' tos-comic' : ''}">${
        // A comic renders from its blocks; 'd.comic' is absent on prose books.
        d.comic ? renderComicBody(d.comic, d.glossary)
          : d.narratable ? renderNarratableBody(det.body, d.glossary)
            : `<p>${esc(det.body).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p>`
      }</div>` : ''}
      ${renderDetailRows(det.rows)}
      ${renderActions(d.appId, d.actions, params)}
      ${qlog}
    </div>`;
  }
  return `<div class="tos-body">${hdr}${summary}${renderBreadcrumb(d.appId, [d.appName])}<div class="tos-empty">Unknown screen.</div></div>`;
}

function wireBody() {
  // Read Aloud / Stop. Text comes off the payload, not the DOM, so the synth gets clean prose.
  _overlay.querySelectorAll('[data-narrate]').forEach(el => {
    el.addEventListener('click', () => {
      sfx(TOS_SELECT_DEF);
      const mode = el.getAttribute('data-narrate');
      if (mode === 'stop') { narrateStop(); return; }
      if (mode === 'min') {
        // Close the shell but keep the voice; close() consumes the flag.
        if (_narrate) { _narrateKeepOnClose = true; close(); syncNarratePill(); }
        return;
      }
      // CODEX keeps its prose on the chapter, not 'detail'.
      if (_data?.view === 'codex') { narrateCodexFrom(_tosCodexCh); return; }
      const det = _data?.detail || {};
      // Seed on the BOOK so one narrator reads the whole novel.
      const book = (_data?.breadcrumb && _data.breadcrumb[0]) || _data?.appName || 'library';
      // Auto-advance: SNAPSHOT the shelf and hold our own cursor. ⚠ Don't read _data in
      // advance(): close() nulls it on minimize, and its detail.id never moves.
      const chapterList = _data?.detail?.chapters || _data?.chapters || null;
      let atIdx = Array.isArray(chapterList)
        ? chapterList.findIndex(c => (c.id ?? c) === (_data?.detail?.id))
        : -1;
      const advance = () => {
        if (!Array.isArray(chapterList) || atIdx < 0) return null;
        const nxt = chapterList[++atIdx];
        return nxt?.body ? { text: nxt.body, title: `${book}: ${nxt.name || nxt.title || ''}`.trim() } : null;
      };
      // A comic hands over the EXACT array its spans were numbered from.
      narrateStart(_data?.comic && _comicParts ? _comicParts : (det.body || ''),
        book, `${book}: ${det.name || ''}`.trim(), _data?.lex, advance);
    });
  });

  // Glosses are tap-to-reveal: title= never fires on touch.
  _overlay.querySelectorAll('.tos-gloss').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();   // don't let a gloss double as a page tap
      const open = _overlay.querySelector('.tos-gloss-open');
      if (open && open !== el) open.classList.remove('tos-gloss-open');
      el.classList.toggle('tos-gloss-open');
    });
  });

  // Paper-doll parts: tap-to-reveal, local only.

  // ── Alarm reels ──
  // Scroll is debounced into a snap read, so a flick lands where it settles.
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
      // Centre the current value on first paint.
      const cur = reel.querySelector('.tos-al-cell.sel');
      if (cur) cur.scrollIntoView({ block: 'center', behavior: 'instant' });

      reel.addEventListener('click', (e) => {
        // Swallow the first click after a real drag, or it yanks the reel to that cell.
        if (reel._alDragged) { reel._alDragged = false; return; }
        const cell = e.target.closest('.tos-al-cell');
        if (cell) select(cell, reel);
      });

      // ── Grab and pull the band ──
      // Mouse/pen only (touch scrolls natively). Snap is off during the drag, or every
      // scrollTop we write is re-snapped; release restores it and flings a little so
      // the browser's snap lands it.
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

  // TV channel chips; the renderer picks the change up from the 'tv_panel' echo.
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
      // Music is a native overlay above the chassis (#musicplayer-panel); the tablet stays behind it.
      if (appId === 'music') { sfx(TOS_SELECT_DEF); openMusicPlayerPanel(); return; }
      // The Map app is the city map (also opened by the minimap double-click; openTabletToMap).
      if (appId === 'map') { nav('map', null, null); return; }
      nav(appId, null, null);
    });
  });
  // Home tiles drag-reorder and lasso into groups; all cached locally, never sent up.
  const appHome = _overlay.querySelector('.tos-home-apps');
  // No dragging in search results: arranging a filtered list would lose apps on save.
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
    // Read the selection's shape while it's still on screen.
    openGroupSheet({ ids, cols: selectionCols(picked) });
  });
  // Page dots + arrows; also cross-page drop targets, so live in selection mode too.
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
  // Horizontal swipe turns the page. Vertical wins the tie; a long-press lift claims
  // the press first.
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
  // A widget opens its app; a press-hold puts the card away (timer cancelled by
  // movement or early release).
  _overlay.querySelectorAll('[data-widget-nav]').forEach(el => {
    const id = el.getAttribute('data-widget-nav');
    let press = null;
    const clear = () => {
      if (press) { clearTimeout(press.timer); press = null; }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', clear);
      window.removeEventListener('pointercancel', clear);
    };
    const onMove = (ev) => {
      if (press && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > 10) clear();
    };
    el.addEventListener('pointerdown', (ev) => {
      if (ev.button > 0) return;
      press = { x: ev.clientX, y: ev.clientY, timer: setTimeout(() => {
        press = null;
        _tosWidgetArm = id;
        _suppressWidgetClick = true;   // the pointerup after a hold must not also open the app
        sfx(TOS_SELECT_DEF);
        render();
      }, 450) };
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerup', clear);
      window.addEventListener('pointercancel', clear);
    });
    el.addEventListener('click', (ev) => {
      if (_suppressWidgetClick) { _suppressWidgetClick = false; return; }
      if (ev.target.closest('.tos-wg-arm')) return;   // the confirm owns its own taps
      // Tapping another card while one is armed just disarms.
      if (_tosWidgetArm) { _tosWidgetArm = null; render(); return; }
      nav(id, null, null);
    });
  });
  _overlay.querySelectorAll('[data-widget-off]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      setWidgetOff(el.getAttribute('data-widget-off'), true);
      _tosWidgetArm = null;
      sfx(TOS_SELECT_DEF);
      render();
    });
  });
  _overlay.querySelector('[data-widget-keep]')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    _tosWidgetArm = null;
    render();
  });
  _overlay.querySelector('[data-tos-addapps]')?.addEventListener('click', () => {
    if (_suppressTileClick) return; // a drag just ended; don't also open the sheet
    openAddAppsSheet();
  });
  // Tapping an empty cell opens the add sheet for it. Only a completed click does, so
  // drop and swipe still work.
  _overlay.querySelectorAll('[data-home-gap]').forEach(el => {
    el.addEventListener('click', () => {
      if (_suppressTileClick || _tosSelectMode) return;
      openAddAppsSheet(el.getAttribute('data-home-gap'));
    });
  });
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
    // Re-render per keystroke, restoring the caret (render() replaces the node).
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
    // Exactly one level up the history.
    el.addEventListener('click', () => navBack());
  });
  // nav's third argument is a separate token, so the id survives as 'binder card 12'.
  _overlay.querySelectorAll('[data-binder-card]').forEach(el => {
    el.addEventListener('click', () => nav(_data.appId, 'card', el.getAttribute('data-binder-card')));
  });
  _overlay.querySelectorAll('[data-open-cat]').forEach(el => {
    el.addEventListener('click', () => nav(_data.appId, el.getAttribute('data-open-cat'), null));
  });
  _overlay.querySelectorAll('[data-tos-tab]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-tos-tab');
      // Replace, don't push: tabs are lateral moves.
      if (id !== _data?.activeTab) nav(_data.appId, id, null, true);
    });
  });
  _overlay.querySelectorAll('[data-cal-month]').forEach(el => {
    el.addEventListener('click', () => nav(_data.appId, 'month', el.getAttribute('data-cal-month')));
  });
  _overlay.querySelectorAll('[data-open-item]').forEach(el => {
    el.addEventListener('click', () => {
      // Item ids are opaque server keys. Always resend the current screen in front:
      // ids can contain spaces ("Faction Lore") and would otherwise be read as the screenId.
      const id = el.getAttribute('data-open-item');
      const currentScreen = (_data.breadcrumb && _data.breadcrumb.length) ? _data.breadcrumb[_data.breadcrumb.length - 1] : null;
      const appId = _data.appId;
      // nav() records where we drilled in from, so Back returns there.
      nav(appId, currentScreen, id);
    });
  });
  _overlay.querySelectorAll('[data-page-nav]').forEach(el => {
    el.addEventListener('click', () => {
      const [appId, screenLabel, pageStr] = el.getAttribute('data-page-nav').split('|');
      nav(appId, screenLabel, `page:${pageStr}`);
    });
  });
  // Corp paging is client-side (all pages in one payload).
  _overlay.querySelectorAll('[data-corp-page]').forEach(el => {
    el.addEventListener('click', () => {
      if (el.classList.contains('disabled')) return;
      _tosCorpPage = parseInt(el.getAttribute('data-corp-page'), 10) || 0;
      sfx(TOS_SELECT_DEF);
      render();
    });
  });
  // Codex: a section is a nav (own payload); a chapter is a local switch.
  _overlay.querySelectorAll('[data-codex-section]').forEach(el => {
    el.addEventListener('click', () => nav(_data.appId, el.getAttribute('data-codex-section')));
  });
  _overlay.querySelectorAll('[data-codex-ch]').forEach(el => {
    el.addEventListener('click', () => {
      _tosCodexCh = el.getAttribute('data-codex-ch') || null;
      sfx(TOS_SELECT_DEF);
      render();
      // Start a chapter at the top.
      _overlay.querySelector('.tos-body')?.scrollTo?.({ top: 0 });
    });
  });
  // Ideology paging is client-side; a standing row jumps to that order's page.
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
  // SPECTER hub: a camera tile re-navs with the device id; sub-screen links nav to them.
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
  _overlay.querySelectorAll('[data-weather-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      _newsWeatherOpen = !_newsWeatherOpen;
      sfx(TOS_SELECT_DEF);
      _keepNewsScroll = true;
      render();
    });
  });
  _overlay.querySelectorAll('[data-news-idx]').forEach(el => {
    el.addEventListener('click', () => {
      sfx(TOS_SELECT_DEF);
      openNewsStory(_newsStories[+el.getAttribute('data-news-idx')]);
    });
  });
  // DEADHEAD terrain: one pixel per cell, stretched by CSS (pixelated), so a 2s poll
  // costs a putImageData, not thousands of fillRects. The 10% pad matches nx()/ny().
  const dhCv = _overlay.querySelector('#tos-dh-canvas');
  if (dhCv && _data?.deadhead?.world) {
    const W = _data.deadhead.world, P = 0.1;
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
  // DEADHEAD FIELDS/REGIONS toggle is local; region rects are already in the payload.
  _overlay.querySelectorAll('[data-dh-view]').forEach(el => el.addEventListener('click', () => {
    _dhRegions = el.getAttribute('data-dh-view') === 'regions';
    sfx(TOS_SELECT_DEF); render();
  }));
  // DEADHEAD map: tapping empty space sets a hold point (pips fire 'chart' themselves).
  // Invert the click to a world tile via _dhBox.
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
  _overlay.querySelectorAll('[data-chip-act]').forEach(el => {
    el.addEventListener('click', () => { if (el.classList.contains('on')) return; sfx(TOS_SELECT_DEF); act(el.getAttribute('data-chip-app'), el.getAttribute('data-chip-act'), el.getAttribute('data-chip-val')); });
  });
  _overlay.querySelectorAll('[data-slider-act]').forEach(el => {
    const out = el.closest('.tos-slider')?.querySelector('[data-slider-out]');
    el.addEventListener('input', () => { if (out) out.textContent = el.value + (el.getAttribute('data-slider-unit') || ''); });
    el.addEventListener('change', () => { sfx(TOS_SELECT_DEF); act(el.getAttribute('data-slider-app'), el.getAttribute('data-slider-act'), el.value); });
  });
  _overlay.querySelectorAll('[data-act-id]').forEach(el => {
    el.addEventListener('click', () => {
      const actTitle = el.getAttribute('data-act-title');
      const appId = el.getAttribute('data-act-app');
      const actionId = el.getAttribute('data-act-id');
      const confirmText = el.getAttribute('data-act-confirm');
      const promptText = el.getAttribute('data-act-prompt');
      const pickJson = el.getAttribute('data-act-pick');
      const baseParams = el.getAttribute('data-act-params');
      const launchCmd = el.getAttribute('data-act-launch');
      // Folding a corp drops its chat channel; abandoning a quest drops its action log.
      const fire = (params) => {
        if (actionId === 'fold') removeCorpChannels();
        if (appId === 'quests' && actionId === 'abandon' && _data?.quest?.id) dropQuestLog(_data.quest.id);
        act(appId, actionId, params);
      };

      // A launch action (Crafting) closes the tablet and fires the real verb, so the
      // minigame overlay owns the screen.
      if (launchCmd) {
        sfx(TOS_SELECT_DEF);
        close();
        sendCmdSilent(launchCmd);
        return;
      }

      // Auto-travel: already walking → stop locally; otherwise the server plots a route
      // to the next stop and flags gps_route to start (dispatch.js → minimap startAutoWalk).
      if (actionId === 'autowalk') {
        if (isAutoWalking()) toggleAutoWalk();
        else act(appId, actionId, baseParams);
        return;
      }

      // A pick action (corp Invite) offers a list instead of typing.
      if (pickJson) {
        let options = [];
        try { options = JSON.parse(pickJson); } catch { options = []; }
        showSelectDialog({
          title: actTitle || 'Invite Player',
          prompt: options.length ? (actTitle ? undefined : 'Choose a player to invite:') : undefined,
          options,
          empty: 'No other players are online to invite.',
        }, (val) => fire(val));
        return;
      }

      // Themed dialogs from confirm.js, not native confirm()/prompt().
      if (promptText) {
        showPromptDialog({ title: actTitle || 'Corporation', prompt: promptText, confirmLabel: 'Submit' }, (val) => fire(val));
        return;
      }
      if (confirmText) {
        showConfirmDialog({ title: 'Confirm', prompt: confirmText, confirmLabel: 'Confirm' }, () => fire(baseParams));
        return;
      }
      fire(baseParams);
    });
  });
  _overlay.querySelectorAll('[data-set-corp-color]').forEach(el => {
    el.addEventListener('change', () => act(el.getAttribute('data-set-corp-color'), 'set_color', el.value));
  });

  wireTabletSettings();
  wireCorpMap();
  wireMap();
  wireGear();
}

// Map app wiring: zoom, tap-to-select, GPS route / auto-walk. No-op off the map screen.
function rebuildMap() {
  const root = _overlay.querySelector('#tos-map-root');
  if (root) { root.innerHTML = renderMap(_data); wireMap(); }
}
// Sync _tosMapSel across tile and legend name, refresh the detail and (from a legend
// click) centre the tile.
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
  // On a phone the detail heads the sheet; scroll it into view (no-op on desktop).
  if (tosIsMobile()) _overlay.querySelector('.tos-map-side')?.scrollTo({ top: 0 });
}

function mapRouteTo(id) {
  const cur = (_data.tiles || []).find(t => t.isCurrent);
  const t = (_data.tiles || []).find(x => x.id === id);
  if (!cur || !t || t.isCurrent || t.reachable === false) return;
  const path = routeBetween(cur.id, id, _data.tiles);
  if (path && path.length > 1) { setGpsRoute(path); rebuildMap(); }
}

function _scrollMapTo(el) {
  const wrap = _overlay?.querySelector('.tos-map-wrap');
  if (!wrap || !el) return;
  const wr = wrap.getBoundingClientRect(), cr = el.getBoundingClientRect();
  wrap.scrollLeft += (cr.left + cr.width / 2) - (wr.left + wrap.clientWidth / 2);
  wrap.scrollTop += (cr.top + cr.height / 2) - (wr.top + wrap.clientHeight / 2);
}

function wireMap() {
  _overlay.querySelectorAll('[data-map-zone]').forEach(el => {
    el.addEventListener('click', () => {
      _tosMapSel = el.getAttribute('data-map-zone');
      sfx(TOS_SELECT_DEF);
      mapSyncSelection(false);
    });
    el.addEventListener('dblclick', () => {
      _tosMapSel = el.getAttribute('data-map-zone');
      mapRouteTo(_tosMapSel);
    });
  });
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
  // Controls: Run (echoes run_state), Auto-walk, recenter and zoom (a server round trip).
  _overlay.querySelector('[data-map-run]')?.addEventListener('click', () => sendCmdSilent('run'));
  _overlay.querySelector('[data-map-autotoggle]')?.addEventListener('click', () => { toggleAutoWalk(); rebuildMap(); });
  _overlay.querySelectorAll('[data-map-recenter]').forEach(b => b.addEventListener('click', centerMapOnPlayer));
  // Writes the shared 'mapOverlay' setting, so the minimap updates and it survives reload.
  _overlay.querySelector('[data-map-labels]')?.addEventListener('click', () => {
    const s = loadSettings();
    s.mapOverlay = mapLabelsOn() ? 'none' : 'labels';
    saveSettings(s);
    applySettings(s);
    rebuildMap();
  });
  _overlay.querySelector('[data-map-color]')?.addEventListener('click', () => {
    const s = loadSettings();
    s.mapColor = mapColorOn() ? 'off' : 'on';
    saveSettings(s);
    applySettings(s);
    rebuildMap();
  });
  _overlay.querySelectorAll('[data-map-zoom]').forEach((b) => b.addEventListener('click', () => {
    const arg = _mapZoomArg(_data, b.getAttribute('data-map-zoom') === 'in' ? 1 : -1);
    if (arg) nav('map', arg, null);
  }));
  _overlay.querySelectorAll('[data-void-zoom]').forEach((b) => b.addEventListener('click', () => {
    const dir = b.getAttribute('data-void-zoom') === 'in' ? 1 : -1;
    _tosVoidZoom = Math.min(VOID_ZMAX, Math.max(VOID_ZMIN, +(_tosVoidZoom + dir * VOID_ZSTEP).toFixed(2)));
    sfx(TOS_SELECT_DEF);
    rebuildMap();
  }));
  wireMapDrag(_overlay.querySelector('.tos-map-wrap'));
  centerMapOnPlayer();
}

// Scroll the map so your tile is centred. No-op if it isn't rendered.
function centerMapOnPlayer() {
  const wrap = _overlay?.querySelector('.tos-map-wrap');
  const cur = wrap?.querySelector('.tos-map-tile.cur');
  if (!wrap || !cur) return;
  const wr = wrap.getBoundingClientRect(), cr = cur.getBoundingClientRect();
  wrap.scrollLeft += (cr.left + cr.width / 2) - (wr.left + wrap.clientWidth / 2);
  wrap.scrollTop += (cr.top + cr.height / 2) - (wr.top + wrap.clientHeight / 2);
}

// Drag-to-scroll the map. A threshold keeps taps as taps; after a drag the next click is
// swallowed in capture phase.
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
      } else if (a === 'target') {
        // Target for the flight sim; held against the pilot, so no aircraft needed.
        const wc = _tosMapAbs.get(_tosMapSel);
        if (wc) sendCmdSilent('flightwaypoint ' + wc[0] + ' ' + wc[1]);
      }
    });
  });
}

// Territory Map: tap selects client-side (keeping scroll); tile actions go through 'mapact'.
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

// Settings is client-side only, through settings.js. No-op off the Settings screen.
function wireTabletSettings() {
  const commit = (s) => { saveSettings(s); applySettings(s); };

  _overlay.querySelectorAll('[data-set-page]').forEach(el => {
    el.addEventListener('click', () => {
      _tosSetPage = el.getAttribute('data-set-page');
      sfx(TOS_SELECT_DEF);
      render();
    });
  });

  // Shared UI theme grid drives settings.theme; the sheet stays open and keeps its scroll.
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
  _overlay.querySelectorAll('[data-tablet-theme-pick]').forEach(el => {
    el.addEventListener('click', () => {
      sfx(TOS_SELECT_DEF);
      saveTabletTheme({ ...loadTabletTheme(), theme: el.getAttribute('data-tablet-theme-pick') });
      _keepThemeScroll = true;
      render();
    });
  });
  // Wallpaper is per device on the tablet theme record; re-render restarts the canvas.
  _overlay.querySelectorAll('[data-set-wallpaper]').forEach(el => {
    el.addEventListener('click', () => {
      sfx(TOS_SELECT_DEF);
      saveWallpaper(el.getAttribute('data-set-wallpaper'));
      render();
    });
  });
  // Home widgets on/off: per device, localStorage.
  _overlay.querySelectorAll('[data-set-widgets]').forEach(el => {
    el.addEventListener('click', () => {
      sfx(TOS_SELECT_DEF);
      setWidgetsEnabled(el.getAttribute('data-set-widgets') === 'on');
      render();
    });
  });
  _overlay.querySelectorAll('[data-set-iconcolor]').forEach(el => {
    el.addEventListener('click', () => {
      sfx(TOS_SELECT_DEF);
      setIconsThemed(el.getAttribute('data-set-iconcolor') === 'theme');
      render();
    });
  });
  _overlay.querySelectorAll('[data-widget-on]').forEach(el => {
    el.addEventListener('click', () => {
      sfx(TOS_SELECT_DEF);
      setWidgetOff(el.getAttribute('data-widget-on'), false);
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
  // Display Mode: flip the cached payload for an instant pill; the server stays the truth.
  _overlay.querySelectorAll('[data-set-display]').forEach(el => {
    el.addEventListener('click', () => {
      sfx(TOS_SELECT_DEF);
      const val = el.getAttribute('data-set-display');
      if (_data) _data.displayRung = val;
      sendCmdSilent(`displaymode ${val}`);
      render();
    });
  });
  _overlay.querySelectorAll('[data-set-link]').forEach(el => {
    el.addEventListener('click', () => {
      sfx(TOS_SELECT_DEF);
      const tt = loadTabletTheme();
      if (el.getAttribute('data-set-link') === 'unlinked') saveTabletTheme({ linked: false, theme: tt.theme || 'dark' });
      else saveTabletTheme({ linked: true });
      render();
    });
  });
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
  // Chat: both act on whisper.js state; sending re-renders us via the subscription.
  _overlay.querySelectorAll('[data-chat-tab]').forEach(el => {
    el.addEventListener('click', () => {
      _chatTab = el.getAttribute('data-chat-tab');
      _chatEmojiOpen = false; // fresh conversation → close the emoji picker
      markChatRead(_chatTab);
      sfx(TOS_SELECT_DEF);
      render();
    });
  });
  // ✕ closes a conversation; stop the click from also switching to it.
  _overlay.querySelectorAll('[data-chat-close]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = el.getAttribute('data-chat-close');
      if (_chatTab === key) _chatTab = null; // let renderChat pick a new default
      leaveChatConversation(key); // emits an update → re-renders us
      sfx(TOS_SELECT_DEF);
    });
  });
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

    // Convert a completed shortcode/emoticon before the caret as you type; only text
    // up to the caret is touched.
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

  // Generic option-pill setter (all string-valued).
  _overlay.querySelectorAll('[data-set-key]').forEach(el => {
    el.addEventListener('click', () => {
      sfx(TOS_SELECT_DEF);
      const s = loadSettings();
      const key = el.getAttribute('data-set-key');
      s[key] = el.getAttribute('data-set-val');
      // A pressed font size outranks the phone auto-fit (applyMobileScale in main.js),
      // which otherwise overwrites --font-size-base on every compact device.
      if (key === 'fontSize') s.fontSizeChosen = true;
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

  // Contrast: live preview on drag, committed on release.
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

  // Reset the local home-grid arrangement (order, groups, stash) so Home re-seeds.
  _overlay.querySelector('[data-reset-apps]')?.addEventListener('click', (e) => {
    sfx(TOS_SELECT_DEF);
    try {
      localStorage.removeItem(TABLET_APP_ORDER_KEY);
      localStorage.removeItem(TABLET_APP_HIDDEN_KEY);
      localStorage.removeItem(TABLET_APP_GROUPS_KEY);
      localStorage.removeItem(TABLET_APP_REMOVED_KEY);
      localStorage.removeItem(TABLET_HOME_SEED_KEY);   // …so the next render re-seeds the default set
    } catch {}
    const btn = e.currentTarget;
    btn.textContent = '✓ Reset';
    setTimeout(() => { if (btn.isConnected) btn.textContent = 'Reset to Default'; }, 1400);
  });

  // Reset the desktop sidebar's layout; resetOrder() works on the live #sidebar behind us.
  _overlay.querySelector('[data-reset-sidebar]')?.addEventListener('click', (e) => {
    sfx(TOS_SELECT_DEF);
    resetOrder();
    const btn = e.currentTarget;
    btn.textContent = '✓ Reset';
    setTimeout(() => { if (btn.isConnected) btn.textContent = 'Reset to Default'; }, 1400);
  });

  // Use a fresh settings copy, not main.js's _setAudioEnabled (its stale snapshot
  // clobbers volume edits). commit() runs applySettings, which drives AudioEngine.
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
  // Volume sliders: live, no re-render (keeps the drag alive).
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
  _overlay.querySelector('[data-reset-sound]')?.addEventListener('click', () => {
    sfx(TOS_SELECT_DEF);
    const s = loadSettings();
    s.audio = { ...DEFAULT_AUDIO_SETTINGS };
    commit(s);
    render();
  });

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
      // Optimistic; the server confirms or corrects via mis_state_update.
      const sent = window._sendRaw && window._sendRaw({ type: 'mis_toggle', enable });
      if (sent) tosApplyMis(enable, false);
      else { const st = _overlay.querySelector('[data-mis-status]'); if (st) st.textContent = 'Not connected.'; }
    });
  });
}

// Drag the panel by its header (like settings.js _makeDraggable); switches from
// centred transform to pixel position on first grab.
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

// CRT power-on/off sounds, local to this panel (shaped like tv.js TV_POWER_ON_DEF).
const CRT_POWER_ON_DEF = {
  id: 'tablet_crt_power_on', category: 'sfx', priority: 3,
  config: { waveform: 'triangle', freq: 60, duration: 0.4, noiseMix: 0.25, pitchBend: { to: 700, time: 0.28 }, filter: { type: 'lowpass', freq: 3400, q: 1 }, adsr: { a: 0.004, d: 0.18, s: 0.25, r: 0.18 } },
};
const CRT_POWER_OFF_DEF = {
  id: 'tablet_crt_power_off', category: 'sfx', priority: 3,
  config: { waveform: 'sine', freq: 520, duration: 0.16, noiseMix: 0.03, pitchBend: { to: 280, time: 0.12 }, filter: { type: 'lowpass', freq: 2000, q: 0.6 }, adsr: { a: 0.01, d: 0.05, s: 0.08, r: 0.08 } },
};
const TABLET_SFX_GAIN = 0.55; // soft — a register-blip, not a chime you'd notice repeatedly

// Void-trip boot cues, first open of a crossing only. VOID_POWER_ON is the uglier one.
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

// Soft local selection clicks. The shared hololock cues are too sharp for a device you
// click constantly, and other panels still rely on them.
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
// Every layer FMs its carrier for a DX-era clang. Kept low-gain.
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

// CRT power-off, like tv.js shutdownTvPanel: sound, collapse, then tear down.
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
  // 'install: <appId>': an app just arrived (installTabletApp). Arm it before the
  // first render so the tile is dressed at once.
  if (msg.install) beginInstall(msg.install);
  // Consume the boot-skip flag on every open so it can't leak into a later one.
  const skip = _skipBoot; _skipBoot = false;
  // First open of a void crossing gets the firmware ritual. Consumed the moment we're
  // off-grid, even by a skip-open, so it can't fire mid-crossing later.
  const voidIntro = !skip && isOnCrossing() && !_voidTripPrimed;
  if (isOnCrossing()) {
    _voidTripPrimed = true;
    // Off-grid, no carrier yet → SEARCHING until you move it.
    if (!_voidLocked) _voidSearching = true;
  }

  // Keep the MIS toggle in step with the server; bound once.
  if (!_tosMisListenerBound) {
    _tosMisListenerBound = true;
    document.addEventListener('mis_state_update', (e) => tosApplyMis(e.detail?.enabled, e.detail?.server_disabled));
  }

  // ⚠ Reuse the overlay only if isConnected: mountOverlay's ESC can detach it without
  // our close(), and a stale node renders into nothing until refresh.
  if (_overlay && !_overlay.isConnected) { close(); }

  if (!_overlay) {
    // Fast-open paths (the "Inv" shortcut) skip the power-on and boot screen.
    const html = `<div class="tos-anchor"><div class="tos-panel mg-chassis${skip ? '' : ' tos-powering-on'}">
      ${deviceHeader('&#9635;', 'ARCHITECT OS', 'Tablet Interface')}
      <div class="tos-bezel mg-bezel">${bezelScrews()}<div class="tos-screen mg-screen" id="tos-screen-inner">
        <canvas class="tos-wall" id="tos-wall"></canvas>
        <div class="tos-scroll" id="tos-scroll">
          ${skip ? '' : '<div class="tos-boot" id="tos-boot"><div class="tos-boot-logo">A</div><div class="tos-boot-title">ARCHITECT OS</div><div class="tos-boot-sub">Booting Tablet Interface&hellip;</div></div>'}
        </div>
        ${crtOverlays()}
        <div class="tos-void-static"></div>
        <div class="tos-void-hunt">◈ Searching for signal, move the tablet</div>
      </div></div>
    </div></div>`;
    // ⚠ onClose fires on ANY teardown (including mountOverlay's ESC). Route through
    // close() so _overlay is always nulled.
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
      // The void power-on, then the firmware boot (runVoidFindingSignal).
      window.AudioEngine?.playSfx(VOID_POWER_ON_DEF);
      setTimeout(runVoidFirmwareBoot, CRT_ANIM_MS);
    } else {
      window.AudioEngine?.playSfx(CRT_POWER_ON_DEF);
      // CRT expands (0.6s), "ARCHITECT OS" holds ~1s, then the screen renders.
      setTimeout(render, CRT_ANIM_MS + BOOT_HOLD_MS);
    }
    return;
  }
  render();
}

// Smart bar "Inv": open straight to the Gear app's Inventory tab, no boot delay.
export function openTabletToInventory() {
  _gearTab = 'inventory';
  _skipBoot = true;
  sendCmdSilent('tabletnav gear');
}

// Open Gear on the Loadout tab (the paperdoll), skip-boot.
export function openTabletToLoadout() {
  _gearTab = 'loadout';
  _skipBoot = true;
  sendCmdSilent('tabletnav gear');
}

// Open straight to the Map app (minimap double-click and the typed 'map' command).
// 'arg' is an optional zoom stop.
export function openTabletToMap(arg) {
  _skipBoot = true;
  sendCmdSilent('tabletnav map' + (arg ? ' ' + arg : ''));
}

// If open on the Map app, silently re-fetch at the current zoom so the marker follows
// the player. Returns whether it refreshed.
export function refreshTabletMapIfOpen() {
  if (_overlay && _overlay.isConnected && _data?.appId === 'map' && _data?.view === 'map') {
    sendCmdSilent('tabletnav map ' + _tosMapZoomArg(_data));
    return true;
  }
  return false;
}

// Open Quests on one quest's detail (a locked dialogue turn-in links here). Detail is
// keyed by the id param, so any non-board token works; 'active' keeps the crumb.
export function openTabletToQuest(questId) {
  if (!questId) return;
  _skipBoot = true;
  sendCmdSilent(`tabletnav quests active ${questId}`);
}

// Open the Quests root (the smartbar "Quests" anchor), skip-boot.
export function openTabletToQuests() {
  _skipBoot = true;
  sendCmdSilent('tabletnav quests');
}

// If open on Gear, silently re-fetch so an equip done elsewhere shows. Returns whether
// it refreshed, so the caller can print feedback otherwise.
export function refreshTabletGearIfOpen() {
  if (_overlay && _overlay.isConnected && _data?.appId === 'gear') {
    sendCmdSilent('tabletnav gear');
    return true;
  }
  return false;
}

// Open straight to the Chat app (the sidebar 💬 bubble), skip-boot.
export function openTabletToChat() {
  _skipBoot = true;
  sendCmdSilent('tabletnav chat');
}

// Open Chat on one conversation (the CB set's channel). '_chatTab' is set before the
// nav because renderChat only picks a default when the selection is missing or stale.
export function openTabletToChatTab(key) {
  if (key) _chatTab = key;
  openTabletToChat();
}

// ── SPECTER entry points ─────────────────────────────────────────────────────

// Open SPECTER on its live hub (on 'hub' / 'use spy_deck').
export function openTabletToSpecter() {
  _skipBoot = true;
  sendCmdSilent('tabletnav specter');
}

// Open on the Binder (the pack reveal's "SEE THE SHELF"). Not 'cards': that's the
// typed reading and prints the whole shelf into the log.
export function openTabletToBinder() {
  _skipBoot = true;
  sendCmdSilent('tabletnav binder');
}

// Play a datachip clip in the reel viewer straight from the payload. The server
// already authorised it, and the Microreels path is owner-gated (traded chips).
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

// SPECTER firmware-install ceremony: purely cosmetic (the install already happened
// server-side). Opens Surveillance and flashes a firmware overlay inside the CRT.
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
    #tablet-os-overlay .tos-si-hdr { display:flex; justify-content:space-between; align-items:baseline; font-size:0.6875rem; letter-spacing:2px; text-transform:uppercase;
      border-bottom:1px solid color-mix(in srgb,var(--mg-accent) 30%,transparent); padding-bottom:6px; margin-bottom:8px; }
    #tablet-os-overlay .tos-si-hdr b { font-size:0.8125rem; }
    #tablet-os-overlay .tos-si-log { flex:1; overflow:hidden; font-size:0.6875rem; line-height:1.42; white-space:pre-wrap; }
    #tablet-os-overlay .tos-si-log .warn { color:#ffd85a; text-shadow:0 0 5px rgba(255,216,90,0.4); }
    #tablet-os-overlay .tos-si-log .ok { color:color-mix(in srgb,var(--mg-accent) 70%,#fff); }
    #tablet-os-overlay .tos-si-stage { margin-top:8px; font-size:0.625rem; letter-spacing:2px; text-transform:uppercase; opacity:.8; min-height:1.3em; }
    #tablet-os-overlay .tos-si-barwrap { margin-top:6px; height:14px; border:1px solid color-mix(in srgb,var(--mg-accent) 40%,transparent); border-radius:3px; overflow:hidden; }
    #tablet-os-overlay .tos-si-bar { height:100%; width:0%; background:var(--mg-accent); box-shadow:0 0 12px color-mix(in srgb,var(--mg-accent) 70%,transparent); transition:width .18s linear; }
    #tablet-os-overlay .tos-si-pct { text-align:right; font-size:0.625rem; margin-top:3px; letter-spacing:1px; opacity:.85; }
    #tablet-os-overlay .tos-si-done { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px;
      background:radial-gradient(80% 80% at 50% 45%, color-mix(in srgb,var(--mg-accent) 16%,#02110b), rgba(2,8,6,0.97)); opacity:0; pointer-events:none; transition:opacity .4s; }
    #tablet-os-overlay .tos-si.done .tos-si-done { opacity:1; pointer-events:auto; }
    #tablet-os-overlay .tos-si-check { font-size:2.5rem; text-shadow:0 0 18px color-mix(in srgb,var(--mg-accent) 80%,transparent); animation:tos-si-pop .5s cubic-bezier(.2,1.4,.4,1); }
    @keyframes tos-si-pop { 0%{transform:scale(0.3);opacity:0} 100%{transform:scale(1);opacity:1} }
    #tablet-os-overlay .tos-si-title { font-size:1rem; letter-spacing:3px; }
    #tablet-os-overlay .tos-si-sub { font-size:0.6875rem; letter-spacing:1px; opacity:.75; }
    #tablet-os-overlay .tos-si-close { margin-top:6px; cursor:pointer; font-size:0.6875rem; letter-spacing:2px; text-transform:uppercase; color:#03110b;
      background:var(--mg-accent); border:none; border-radius:4px; padding:8px 18px; }
    #tablet-os-overlay .tos-si-skip { position:absolute; bottom:9px; right:14px; font-size:0.5625rem; letter-spacing:1px; opacity:.4; }
  `;
  document.head.appendChild(s);
}

// Mount the flasher once the shell exists (tabletnav is async, so retry briefly).
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

// Read-only snapshot of the last inventory payload, for smartbar macro hints. Empty
// until the Gear screen has been fetched this session.
export function getTabletInventory() {
  return _data?.inventory || [];
}

// ── Arcade app: "ARCHITECT" (a fake game inside the game) ────────────────────
// All client-side in #tos-fake-root: login, boot, a canned MUD terminal, and a
// mini-tablet that nests.

const FK_AMBIENT = [
  'Rain ticks off the corrugated awning overhead.',
  'A delivery drone whines past, low and overloaded.',
  'Somewhere below, a bassline thuds through the pavement.',
  'A vendor two stalls down screams the price of synth-noodles.',
  'The neon sign above you flickers: OPE... ...PEN... OPEN.',
  'A stray dog eyes your boots, thinks better of it, moves on.',
  'Static crackles from a dead payphone. It almost sounds like a name.',
  'Your breath fogs. The Architect is watching, probably.',
  'A cop-drone sweeps the alley mouth with a red eye, then loses interest.',
];

// Mini-tablet home grid: a copy of the real roster.
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

// The opening room look, in the real look-pane structure.
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
    push('<span class="tos-fk-label">You\'re carrying:</span> a dented tablet, half a synth-noodle, '
       + '<span class="tos-fk-furn">a rusted pipe</span>, ₵10,555, and a bad feeling.', 'tos-fk-desc');
  } else if (first === 'gear') {
    push('<span class="tos-fk-label">Worn:</span> a stained longcoat, cracked goggles, one good boot.', 'tos-fk-desc');
  } else if (first === 'stats' || first === 'skills') {
    push('<span class="tos-fk-label">Brawn</span> 4 · <span class="tos-fk-label">Reflexes</span> 6 · '
       + '<span class="tos-fk-label">Brains</span> 5 · <span class="tos-fk-label">Cool</span> 7. Good enough for government work.', 'tos-fk-desc');
  } else if (first === 'who') {
    push('<span class="tos-fk-label">Online:</span> <span class="tos-fk-npc">you</span>, and the machine, always.', 'tos-fk-desc');
  } else if (first === 'map') {
    push('The map is a rumour. Open your tablet for the real one, oh, wait.', 'tos-fk-amb');
  } else if (first === 'music') {
    push('A synth drone fades up from nowhere. It knows what you did.', 'tos-fk-amb');
  } else if (first === 'tablet' || first === 'os') {
    push('You pull out your tablet.', 'tos-fk-sys');
    openMini();
  } else if (first === 'help') {
    push('Try: look, north, inv, gear, stats, who, tablet, quit. (It\'s a demo. Be gentle.)', 'tos-fk-sys');
  } else if (first === 'quit' || first === 'logout' || first === 'exit') {
    push("There's no escape. You're already inside the tablet, inside the game, inside the tablet.", 'tos-fk-sys');
  } else {
    push(`You can't "${esc(first)}" here: and honestly, this is a game inside a tablet inside a game. Cut it some slack.`, 'tos-fk-amb');
  }
}



function fkOpenMini(root) {
  if (root.querySelector('.tos-fk-mini-scrim')) return; // already open
  sfx(FK_OPEN_DEF);
  const scrim = document.createElement('div');
  scrim.className = 'tos-fk-mini-scrim';
  root.appendChild(scrim);
  scrim.addEventListener('click', e => { if (e.target === scrim) scrim.remove(); });
  fkSpawnNest(scrim, 0);
}

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

function fkGameScreenHTML() {
  return `<div class="tos-fk-gamescreen">
      <div class="tos-fk-gs-hud"><span class="hp">HP 178/178</span><span>SAN 100</span><span>STA 100</span><span class="cr">₵ 10,555</span><span>WANTED ✦✦</span></div>
      <div class="tos-fk-gs-room">RUST ALLEY<span class="tos-fk-gs-safe">SAFE</span></div>
      <div class="tos-fk-gs-dist">· the Neon Quarter ·</div>
      <div class="tos-fk-gs-desc">A knife-thin gap between two data-towers, floored in wet concrete and older promises. A cracked ad-panel loops a smiling face that hasn't existed in years.</div>
      <div class="tos-fk-gs-exits"><span class="l">Exits:</span> <span class="ex">[North]</span> The Loading Bay, <span class="ex">[East]</span> The Threshold, <span class="ex">[Down]</span> Drainage Sub-Level</div>
    </div>`;
}

// One nested level, scaled 0.72× per level: each deeper level is the whole game screen
// with a tablet on it. Levels sit in pointer-events:none layers so taps fall through;
// ✕/home or a backdrop tap closes the whole stack.
function fkSpawnNest(scrim, depth) {
  const scale = Math.pow(0.72, depth);
  if (scale < 0.1) return; // past here it's too small to bother clicking
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

  // ✕ / home closes the whole stack at once.
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
      toast.textContent = `${nm}, not installed`;
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

  // An action that changed the screen counts as a Back level.
  const sig = screenSig(_data);
  if (_lastWasAct && sig !== _navSig) _actDepth++;
  _lastWasAct = false;
  _navSig = sig;

  const survLive = _data.view === 'surveillance' && !!_data.live;
  const isChat = _data.view === 'chat';
  // Live refreshes (surveillance poll, quest update via a one-shot flag) keep scroll;
  // every other nav starts at top.
  const keepScroll = (survLive && _wasSurvLive) || _keepQuestScroll || _keepThemeScroll || _keepGearScroll || _keepNewsScroll;
  _keepQuestScroll = false;
  _keepThemeScroll = false;
  _keepGearScroll = false;
  _keepNewsScroll = false;
  const prevTop = scroll.scrollTop;

  // Chat re-renders on every message: keep the reply text and focus.
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

  // Install fill runs only on Home; elsewhere it stays armed.
  if (_install && (_data.screen === 'home' || !_data.appId)) tickInstall();

  if (_data.view === 'fakeplay') mountFakePlay();
  if (_data.view === 'reel') wireReel();
  // TV mounts the shared renderer; leaving tears it down (dropping the portable tuner server-side).
  if (_data.view === 'tv') mountTabletTv(); else unmountTabletTv();
  if (_data.view === 'worldmap') mountWorldmap(); else unmountWorldmap();

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
    // Re-render on whisper.js changes; first entry pulls a fresh online list.
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
  // Wallpaper on Home only.
  if (_data.screen === 'home' || !_data.appId) startWallpaper(_data.sky); else stopWallpaper();

  // First home screen ever gets the tablet walkthrough (localStorage flag).
  if (_data.screen === 'home' || !_data.appId) maybeTabletTour();
}

// ── Animated wallpaper ───────────────────────────────────────────────────────
// Off by default; chosen per device under Settings → General → Wallpaper. One canvas,
// one rAF only while Home is shown, one static frame with motion off. Sky reads the
// home payload's 'sky' snapshot (buildHomePayload) and dims indoors.
let _wallRaf = null;
let _wallState = null;   // { sky, drops:[], stars:[], w, h }

// Every painter derives colour from the theme (st.c, see wallColors); never hardcode
// one. Strength is per wallpaper ('s'): a hairline lattice and a full-screen aurora
// need different opacities to land equally quiet.
const TABLET_WALLPAPERS = [
  { id: 'none',     label: 'None' },
  { id: 'sky',      label: 'Sky',      s: 0.50 },  // live weather + game clock
  { id: 'grid',     label: 'Grid',     s: 0.55 },  // drifting blueprint lattice
  { id: 'contours', label: 'Contours', s: 0.55 },  // slow interference lines
  { id: 'drift',    label: 'Drift',    s: 0.56 },  // sparse floating motes
  { id: 'scan',     label: 'Scan',     s: 0.54 },  // a single slow radar sweep
  { id: 'circuit',  label: 'Circuit',  s: 0.56 },  // etched traces with charge running them
  { id: 'aurora',   label: 'Aurora',   s: 0.44 },  // slow colour fronts
  { id: 'hex',      label: 'Hex',      s: 0.52 },  // honeycomb with a lighting wave
  { id: 'code',     label: 'Code',     s: 0.46 },  // glyph rain
  { id: 'warp',     label: 'Warp',     s: 0.56 },  // starfield running past you
  { id: 'tide',     label: 'Tide',     s: 0.52 },  // stacked wave fronts
  { id: 'static',   label: 'Static',   s: 0.40 },  // dead channel + a rolling bar
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

// The theme's live colours, resolved once per start. The accent is ROTATED into a
// small palette (complement, neighbour, one warm); saturation is floored and capped.
function wallColors(el) {
  const cs = getComputedStyle(el);
  const pick = (v, fb) => (cs.getPropertyValue(v) || '').trim() || fb;
  const accent = pick('--mg-accent', pick('--accent', '#3fd0d8'));
  return {
    bg: pick('--bg', '#0c1114'),
    bg2: pick('--bg2', '#1a2226'),
    accent,
    fg: pick('--tos-fg', '#dfe9f5'),
    // The complement, used least.
    hot: wallShift(accent, 152, { sat: 1.18, lift: 0.03 }),
    // A neighbour: does most of the colour work.
    cool: wallShift(accent, 38, { sat: 1.08 }),
    // One warm, sparingly.
    amber: wallShift(accent, -145, { sat: 1.15, lift: 0.05 }),
  };
}

// Rotate a hue with saturation floored and capped.
function wallShift(col, deg, opts = {}) {
  const A = wallRgb(col);
  if (!A) return col;
  const [r, g, b] = A.map(v => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let l = (mx + mn) / 2;
  let s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  // A greyscale theme has no hue to rotate from, so it borrows one.
  let hdeg = !d ? 195
    : mx === r ? 60 * (((g - b) / d) % 6)
    : mx === g ? 60 * (((b - r) / d) + 2)
    : 60 * (((r - g) / d) + 4);
  hdeg = (hdeg + deg + 720) % 360;
  s = Math.max(opts.satMin ?? 0.34, Math.min(opts.satMax ?? 0.76, s * (opts.sat ?? 1)));
  l = Math.max(0.30, Math.min(0.70, l + (opts.lift ?? 0)));
  const cc = (1 - Math.abs(2 * l - 1)) * s;
  const x = cc * (1 - Math.abs(((hdeg / 60) % 2) - 1));
  const m = l - cc / 2;
  const seg = Math.floor(hdeg / 60) % 6;
  const trio = [[cc, x, 0], [x, cc, 0], [0, cc, x], [0, x, cc], [x, 0, cc], [cc, 0, x]][seg];
  return `rgb(${trio.map(v => Math.round((v + m) * 255)).join(',')})`;
}

// A soft point of light. Use this, never shadowBlur (the one costly canvas feature here).
function wallGlow(ctx, x, y, r, col, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, wallAlpha(col, a));
  g.addColorStop(0.45, wallAlpha(col, a * 0.28));
  g.addColorStop(1, wallAlpha(col, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

// The vignette every painter finishes on.
function wallVignette(ctx, w, h, a = 0.34) {
  const g = ctx.createRadialGradient(w / 2, h * 0.46, Math.min(w, h) * 0.26, w / 2, h * 0.5, Math.hypot(w, h) * 0.6);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// A time-of-day CAST (tint + weight) blended into the theme background.
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
// Mix two CSS colours. Only hex and rgb() reach this; anything else falls back to the base.
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
// Weather → particle system; unknown types fall to 'none'.
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
    // Drift motes: 26, sparse on purpose. 'hue' is fixed for life (per frame strobes).
    motes: Array.from({ length: 30 }, () => ({
      x: rnd(0, w), y: rnd(0, h), v: rnd(.08, .28), r: rnd(.8, 2.1), o: rnd(.2, .6), big: Math.random() < 0.25,
      hue: Math.random() < 0.42 ? 0 : Math.random() < 0.6 ? 1 : Math.random() < 0.5 ? 2 : 3,
    })),
    // Scan contacts: fixed positions, lit by the beam.
    blips: Array.from({ length: 9 }, () => ({ a: rnd(0, 6.283), r: rnd(.16, .92), hot: Math.random() < 0.3 })),
    shear: Math.max(-1.4, Math.min(1.4, (sky?.windKph || 0) / 40)),
    drops: Array.from({ length: n }, () => ({ x: rnd(0, w), y: rnd(0, h), v: rnd(.5, 1.4), len: rnd(4, 14), o: rnd(.25, .8) })),
    // Stars: night and outdoors only, built once into the state.
    stars: Array.from({ length: 46 }, () => ({ x: Math.random(), y: Math.random() * .62, r: rnd(.4, 1.1), o: rnd(.2, .9) })),
  };
}

// One painter per wallpaper, all handed the same state. No painter may hardcode a colour.
const WALL_PAINTERS = {
  // ── Sky: the live weather and the game clock, cast over your theme ──────────
  sky(ctx, st, t) {
    const { w, h, sky, c } = st;
    const [castCol, castW] = WALL_CASTS[wallPhase(sky)] || WALL_CASTS.day;
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

    // Sun/moon on a straight arc 06:00-18:00, mirrored overnight.
    const dayFrac = night ? ((m + 360) % 1440) / 720 : (m - 360) / 720;
    const cx = w * Math.max(-0.1, Math.min(1.1, dayFrac));
    const cy = h * (0.78 - 0.52 * Math.sin(Math.PI * Math.max(0, Math.min(1, dayFrac))));
    wallGlow(ctx, cx, cy, night ? 46 : 78, night ? c.cool : c.amber, night ? 0.2 : 0.3);
    ctx.globalAlpha = night ? 0.5 : 0.42;
    ctx.fillStyle = night ? c.fg : wallMix(c.accent, c.amber, 0.5);
    ctx.beginPath(); ctx.arc(cx, cy, night ? 9 : 13, 0, 6.284); ctx.fill();
    ctx.globalAlpha = 1;

    // Skyline seeded off x, so it doesn't reshuffle per render.
    const base = h * 0.82;
    const haze = ctx.createLinearGradient(0, base - 70, 0, base + 8);
    haze.addColorStop(0, wallAlpha(night ? c.hot : c.amber, 0));
    haze.addColorStop(1, wallAlpha(night ? c.hot : c.amber, night ? 0.16 : 0.2));
    ctx.fillStyle = haze;
    ctx.fillRect(0, base - 70, w, 78);
    const silhouette = wallMix(c.bg, '#000000', 0.5);
    const litA = wallAlpha(c.amber, 0.75), litB = wallAlpha(c.hot, 0.6), litC = wallAlpha(c.accent, 0.6);
    ctx.fillStyle = silhouette;
    for (let x = -10; x < w + 10; x += 17) {
      const sd = Math.abs(Math.sin(x * 0.7) * 43758.5453) % 1;
      const bh = 16 + sd * 62;
      ctx.fillRect(x, base - bh, 15, bh + 30);
      if (sd > 0.72) {
        ctx.fillRect(x + 7, base - bh - 7, 1, 7);
        ctx.fillStyle = wallAlpha(c.hot, 0.4 + 0.4 * Math.abs(Math.sin(t / 900 + x)));
        ctx.beginPath(); ctx.arc(x + 7.5, base - bh - 8, 1.5, 0, 6.284); ctx.fill();
        ctx.fillStyle = silhouette;
      }
      if (!night && sd < 0.5) continue;
      ctx.fillStyle = sd > 0.66 ? litA : sd > 0.33 ? litC : litB;
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
      // Acid rain gets its own hue: it's a warning.
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
    wallVignette(ctx, w, h, 0.3);
  },

  // ── Grid: a blueprint lattice, drifting one slow direction ─────────────────
  grid(ctx, st, t) {
    const { w, h, c } = st;
    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, wallMix(wallMix(c.bg, c.bg2, 0.5), c.cool, 0.14));
    bg.addColorStop(1, wallMix(wallMix(c.bg, c.bg2, 0.5), c.hot, 0.11));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    const step = 34;
    const drift = (t / 90) % step;
    ctx.lineWidth = 1;
    ctx.strokeStyle = wallAlpha(c.cool, 0.15);
    ctx.beginPath();
    for (let x = -step + drift; x < w + step; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = -step + drift; y < h + step; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    const maj = step * 4;
    ctx.strokeStyle = wallAlpha(c.accent, 0.3);
    ctx.beginPath();
    for (let x = -maj + drift; x < w + maj; x += maj) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = -maj + drift; y < h + maj; y += maj) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    ctx.strokeStyle = wallAlpha(c.fg, 0.22);
    ctx.beginPath();
    for (let x = -maj + drift; x < w + maj; x += maj) {
      for (let y = -maj + drift; y < h + maj; y += maj) {
        ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y);
        ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 3);
      }
    }
    ctx.stroke();
    const mx = ((t / 46) % (w + 160)) - 80;
    const my = h * (0.5 + Math.sin(t / 7300) * 0.34);
    ctx.strokeStyle = wallAlpha(c.hot, 0.3);
    ctx.beginPath();
    ctx.moveTo(mx, 0); ctx.lineTo(mx, h);
    ctx.moveTo(0, my); ctx.lineTo(w, my);
    ctx.stroke();
    wallGlow(ctx, mx, my, 26, c.amber, 0.5);
    ctx.fillStyle = wallAlpha(c.fg, 0.85);
    ctx.beginPath(); ctx.arc(mx, my, 1.9, 0, 6.284); ctx.fill();
    wallVignette(ctx, w, h, 0.3);
  },

  // ── Contours: interference bands, each with a filled shelf for depth ───────
  contours(ctx, st, t) {
    const { w, h, c } = st;
    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, wallMix(c.bg, c.cool, 0.16));
    bg.addColorStop(1, wallMix(c.bg2, c.hot, 0.14));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    const bands = 11;
    const line = [];
    for (let i = 0; i < bands; i++) {
      const k = i / (bands - 1);
      const col = wallMix(c.cool, c.hot, k);
      const phase = t / 5200 + i * 0.55;
      line.length = 0;
      for (let x = 0; x <= w; x += 8) {
        const u = x / w;
        line.push(h * (0.08 + k * 0.88)
          + Math.sin(phase + u * 5.2) * 11 + Math.sin(phase * 1.7 + u * 2.1) * 7);
      }
      ctx.beginPath();
      line.forEach((y, j) => (j ? ctx.lineTo(j * 8, y) : ctx.moveTo(0, y)));
      for (let j = line.length - 1; j >= 0; j--) ctx.lineTo(j * 8, line[j] + 9);
      ctx.closePath();
      ctx.fillStyle = wallAlpha(col, 0.055 + k * 0.05);
      ctx.fill();
      ctx.beginPath();
      line.forEach((y, j) => (j ? ctx.lineTo(j * 8, y) : ctx.moveTo(0, y)));
      ctx.lineWidth = 1;
      ctx.strokeStyle = wallAlpha(col, 0.16 + k * 0.22);
      ctx.stroke();
    }
    wallVignette(ctx, w, h, 0.32);
  },

  // ── Drift: sparse motes rising. The quietest of the set. ───────────────────
  drift(ctx, st, t) {
    const { w, h, c } = st;
    const hues = [c.accent, c.cool, c.hot, c.fg];
    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createRadialGradient(w * 0.5, h * 0.85, 0, w * 0.5, h * 0.85, Math.hypot(w, h) * 0.8);
    bg.addColorStop(0, wallMix(c.bg2, c.cool, 0.22));
    bg.addColorStop(1, wallMix(c.bg, '#000000', 0.2));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    for (const d of st.motes) {
      d.y -= d.v;
      d.x += Math.sin((t + d.y * 6) / 1400) * 0.25;
      if (d.y < -6) { d.y = h + 6; d.x = Math.random() * w; }
      const col = hues[d.hue ?? 0];
      const a = d.o * (0.55 + 0.45 * Math.sin(t / 1600 + d.x));
      if (d.big) wallGlow(ctx, d.x, d.y, d.r * 9, col, a * 0.5);
      ctx.globalAlpha = a;
      ctx.fillStyle = wallAlpha(col, 0.8);
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 6.284); ctx.fill();
    }
    ctx.globalAlpha = 1;
    wallVignette(ctx, w, h, 0.26);
  },

  // ── Scan: static rings, one slow sweep ───────────────────────────────────
  // Blip brightness is a pure function of time since the beam passed: no timers.
  scan(ctx, st, t) {
    const { w, h, c } = st;
    ctx.clearRect(0, 0, w, h);
    const cx = w * 0.5, cy = h * 0.62, maxR = Math.hypot(w, h) * 0.55;
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
    bg.addColorStop(0, wallMix(c.bg2, c.cool, 0.26));
    bg.addColorStop(1, wallMix(c.bg, '#000000', 0.34));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = wallAlpha(c.cool, 0.16);
    for (let i = 1; i <= 4; i++) { ctx.beginPath(); ctx.arc(cx, cy, (maxR / 4) * i, 0, 6.284); ctx.stroke(); }
    ctx.strokeStyle = wallAlpha(c.accent, 0.24);
    ctx.beginPath();
    for (let a = 0; a < 360; a += 15) {
      const rad = a * Math.PI / 180, len = a % 90 ? 5 : 11;
      const co = Math.cos(rad), si = Math.sin(rad);
      ctx.moveTo(cx + co * (maxR - len), cy + si * (maxR - len));
      ctx.lineTo(cx + co * maxR, cy + si * maxR);
    }
    ctx.stroke();
    const ang = ((t / 4200) % 1) * 6.283 - 1.571;   // ~4s a revolution
    for (const b of st.blips) {
      let dd = (ang - b.a) % 6.283; if (dd < 0) dd += 6.283;
      const life = Math.exp(-dd * 1.9);
      if (life < 0.02) continue;
      const bx = cx + Math.cos(b.a) * b.r * maxR, by = cy + Math.sin(b.a) * b.r * maxR;
      const col = b.hot ? c.hot : c.accent;
      wallGlow(ctx, bx, by, 13, col, life * 0.6);
      ctx.fillStyle = wallAlpha(col, life * 0.9);
      ctx.beginPath(); ctx.arc(bx, by, 2, 0, 6.284); ctx.fill();
    }
    const wedge = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
    wedge.addColorStop(0, wallAlpha(c.accent, 0.16));
    wedge.addColorStop(1, wallAlpha(c.accent, 0));
    ctx.fillStyle = wedge;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, maxR, ang - 0.5, ang); ctx.closePath(); ctx.fill();
    const grad = ctx.createLinearGradient(cx, cy, cx + Math.cos(ang) * maxR, cy + Math.sin(ang) * maxR);
    grad.addColorStop(0, wallAlpha(c.fg, 0.3));
    grad.addColorStop(1, wallAlpha(c.accent, 0));
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang) * maxR, cy + Math.sin(ang) * maxR); ctx.stroke();
    wallGlow(ctx, cx, cy, 18, c.fg, 0.3);
    wallVignette(ctx, w, h, 0.36);
  },

  // ── Circuit: etched traces with charge running down them ───────────────────
  // The board is seeded once into the state; only the charge moves.
  circuit(ctx, st, t) {
    const { w, h, c } = st;
    const traces = (st.circuit ||= buildCircuitTraces(w, h));
    const lane = [c.accent, c.cool, c.hot];
    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, wallMix(wallMix(c.bg, '#000000', 0.2), c.cool, 0.12));
    bg.addColorStop(1, wallMix(wallMix(c.bg, '#000000', 0.24), c.hot, 0.09));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = wallAlpha(c.cool, 0.06);
    ctx.beginPath();
    for (let x = -h; x < w; x += 9) { ctx.moveTo(x, 0); ctx.lineTo(x + h, h); }
    ctx.stroke();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const tr of traces) {
      const col = lane[tr.lane];
      ctx.beginPath();
      tr.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.lineWidth = 3.4; ctx.strokeStyle = wallAlpha(col, 0.07); ctx.stroke();
      ctx.lineWidth = 1.4; ctx.strokeStyle = wallAlpha(col, 0.26); ctx.stroke();
    }
    for (const tr of traces) {
      const col = lane[tr.lane];
      for (const p of tr.pts) {
        ctx.fillStyle = wallAlpha(col, 0.3);
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, 6.284); ctx.fill();
        ctx.fillStyle = wallAlpha(c.bg, 0.85);
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.1, 0, 6.284); ctx.fill();
      }
    }
    for (const tr of traces) {
      const col = lane[tr.lane];
      const d = ((t / tr.speed + tr.phase) % 1) * tr.len;
      const head = wallAlongPolyline(tr, d);
      if (head) wallGlow(ctx, head.x, head.y, 14, col, 0.55);
      for (let k = 0; k < 8; k++) {
        const p = wallAlongPolyline(tr, d - k * 5);
        if (!p) continue;
        ctx.globalAlpha = (1 - k / 8) * 0.9;
        ctx.fillStyle = k ? wallAlpha(col, 0.6) : c.fg;
        ctx.beginPath(); ctx.arc(p.x, p.y, k ? 1.5 : 2.2, 0, 6.284); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    wallVignette(ctx, w, h, 0.34);
  },

  // ── Aurora: slow fronts of colour. The only painter with no line in it. ────
  aurora(ctx, st, t) {
    const { w, h, c } = st;
    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, wallMix(c.bg, '#000000', 0.25));
    bg.addColorStop(1, wallMix(c.bg2, c.accent, 0.12));
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    // Stars first, so the fronts wash over them (reuses the sky's field).
    ctx.fillStyle = wallAlpha(c.fg, 0.4);
    for (const s2 of st.stars) {
      ctx.globalAlpha = s2.o * 0.5;
      ctx.beginPath(); ctx.arc(s2.x * w, s2.y * h * 1.2, s2.r, 0, 6.284); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const blobs = [
      { col: c.accent, ax: 0.30, ay: 0.24, sx: 5200, sy: 8100, r: 0.62, a: 0.30 },
      { col: c.cool, ax: 0.34, ay: 0.20, sx: -6900, sy: 7300, r: 0.52, a: 0.26 },
      { col: c.hot, ax: 0.26, ay: 0.30, sx: 9400, sy: -5600, r: 0.45, a: 0.22 },
      { col: c.amber, ax: 0.38, ay: 0.26, sx: -11000, sy: 6200, r: 0.40, a: 0.13 },
      { col: wallMix(c.accent, '#ffffff', 0.4), ax: 0.20, ay: 0.34, sx: 13500, sy: 9900, r: 0.34, a: 0.14 },
    ];
    for (const b of blobs) {
      const cx = w * (0.5 + Math.sin(t / b.sx) * b.ax);
      const cy = h * (0.5 + Math.cos(t / b.sy) * b.ay);
      const rad = Math.max(w, h) * b.r;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, wallAlpha(b.col, b.a));
      g.addColorStop(0.55, wallAlpha(b.col, b.a * 0.32));
      g.addColorStop(1, wallAlpha(b.col, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = 'source-over';
    const hz = ctx.createLinearGradient(0, h * 0.72, 0, h);
    hz.addColorStop(0, wallAlpha(c.bg, 0));
    hz.addColorStop(1, wallAlpha(wallMix(c.bg, '#000000', 0.4), 0.9));
    ctx.fillStyle = hz; ctx.fillRect(0, h * 0.72, w, h * 0.28);
    wallVignette(ctx, w, h, 0.3);
  },

  // ── Hex: a honeycomb with a lighting wave crossing it ──────────────────────
  hex(ctx, st, t) {
    const { w, h, c } = st;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = wallMix(c.bg, c.bg2, 0.4);
    ctx.fillRect(0, 0, w, h);
    const R = 19, dx = R * 1.732, dy = R * 1.5;
    const wave = (t / 1400), wave2 = (t / 3300);
    ctx.lineWidth = 1;
    for (let row = -1; row * dy < h + R; row++) {
      for (let col = -1; col * dx < w + dx; col++) {
        const cx = col * dx + (row % 2 ? dx / 2 : 0), cy = row * dy;
        // A diagonal wave decides which cells are lit; a slower cross wave picks hue.
        const k = Math.sin(wave - (cx * 0.012 + cy * 0.018));
        const lit = Math.max(0, k) ** 3;
        const tint = 0.5 + 0.5 * Math.sin(wave2 + (cx * 0.009 - cy * 0.014));
        const col2 = wallMix(c.cool, c.hot, tint);
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 180 * (60 * i - 30);
          const x = cx + R * 0.92 * Math.cos(a), y = cy + R * 0.92 * Math.sin(a);
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.closePath();
        if (lit > 0.02) { ctx.fillStyle = wallAlpha(col2, lit * 0.26); ctx.fill(); }
        ctx.strokeStyle = wallAlpha(lit > 0.3 ? col2 : c.accent, 0.1 + lit * 0.42);
        ctx.stroke();
        if (lit > 0.86) {
          ctx.fillStyle = wallAlpha(c.amber, (lit - 0.86) * 3.4);
          ctx.beginPath(); ctx.arc(cx, cy, 2.4, 0, 6.284); ctx.fill();
        }
      }
    }
    wallVignette(ctx, w, h, 0.3);
  },

  // ── Code: glyph rain. The loudest of the set, and deliberately so. ─────────
  code(ctx, st, t) {
    const { w, h, c } = st;
    const cols = (st.code ||= buildCodeColumns(w, h));
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = wallMix(c.bg, '#000000', 0.3);
    ctx.fillRect(0, 0, w, h);
    ctx.font = '12px "Courier New", monospace';
    ctx.textBaseline = 'top';
    const G = 'ABCDEFGH0123456789#$%&@*+=<>/\\|—▓▒░';
    const lane = [c.accent, c.cool, c.hot, c.amber];
    ctx.fillStyle = wallAlpha(c.cool, 0.09);
    for (const col of cols) {
      for (let y = (col.seed % 14); y < h; y += 14) {
        ctx.fillText(G[(col.seed + y) % G.length], col.x, y);
      }
    }
    for (const col of cols) {
      const colr = lane[col.lane];
      const head = ((t * col.v + col.off) % (h + col.n * 14)) - col.n * 14;
      if (head > -14 && head < h) wallGlow(ctx, col.x + 4, head + 6, 16, colr, 0.4);
      for (let i = 0; i < col.n; i++) {
        const y = head - i * 14;
        if (y < -14 || y > h) continue;
        const ch = G[(col.seed + i * 7 + Math.floor(t / 260 + i)) % G.length];
        ctx.fillStyle = i === 0 ? c.fg : wallAlpha(colr, 0.8 * (1 - i / col.n));
        ctx.globalAlpha = i === 0 ? 0.95 : 1;
        ctx.fillText(ch, col.x, y);
      }
    }
    ctx.globalAlpha = 1;
    wallVignette(ctx, w, h, 0.36);
  },

  // ── Warp: a starfield running past the hull ────────────────────────────────
  warp(ctx, st, t) {
    const { w, h, c } = st;
    const stars = (st.warp ||= Array.from({ length: 90 }, () => ({
      a: Math.random() * 6.284, r: Math.random(), z: Math.random(),
    })));
    const cx = w / 2, cy = h * 0.46, maxR = Math.hypot(w, h) * 0.62;
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w, h) / 2);
    g.addColorStop(0, wallMix(c.bg, c.accent, 0.14));
    g.addColorStop(1, wallMix(c.bg, '#000000', 0.45));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    wallGlow(ctx, cx + Math.sin(t / 14000) * w * 0.3, cy - h * 0.24, Math.max(w, h) * 0.5, c.hot, 0.1);
    wallGlow(ctx, cx - Math.sin(t / 17000) * w * 0.3, cy + h * 0.3, Math.max(w, h) * 0.5, c.cool, 0.11);
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    for (const s of stars) {
      s.z += 0.0018 + s.r * 0.0032;
      if (s.z > 1) { s.z = 0; s.a = Math.random() * 6.284; s.r = Math.random(); }
      // Cubed: crawl near the middle, tear past at the edge.
      const d = Math.pow(s.z, 3) * maxR, d0 = Math.pow(Math.max(0, s.z - 0.05), 3) * maxR;
      const co = Math.cos(s.a), si = Math.sin(s.a);
      ctx.globalAlpha = Math.min(1, s.z * 2.2);
      // Hue belongs to the star ('r'), not its distance.
      ctx.strokeStyle = s.r > 0.9 ? c.fg
        : s.r > 0.74 ? wallAlpha(c.hot, 0.85)
        : s.r > 0.44 ? wallAlpha(c.accent, 0.85)
        : wallAlpha(c.cool, 0.8);
      ctx.lineWidth = 0.6 + s.z * 1.8;
      ctx.beginPath();
      ctx.moveTo(cx + co * d0, cy + si * d0);
      ctx.lineTo(cx + co * d, cy + si * d);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    wallGlow(ctx, cx, cy, 40, c.fg, 0.12);
    wallVignette(ctx, w, h, 0.34);
  },

  // ── Tide: stacked wave fronts, filled. Reads as depth, not as lines. ───────
  tide(ctx, st, t) {
    const { w, h, c } = st;
    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, wallMix(c.bg, c.hot, 0.16));
    bg.addColorStop(0.42, wallMix(c.bg, '#000000', 0.2));
    bg.addColorStop(1, wallMix(c.bg2, c.cool, 0.2));
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    wallGlow(ctx, w * 0.5, h * 0.29, Math.min(w, h) * 0.42, c.amber, 0.22);
    const layers = 6;
    for (let i = 0; i < layers; i++) {
      const k = i / (layers - 1);
      const base = h * (0.30 + k * 0.62);
      const amp = 26 - i * 3.4;
      const ph = t / (3400 - i * 380) + i * 1.3;
      const col = wallMix(c.hot, c.cool, k);   // far fronts warm, near fronts cold
      const crest = [];
      for (let x = 0; x <= w; x += 6) {
        const u = x / w;
        crest.push(base + Math.sin(ph + u * 6.1) * amp + Math.sin(ph * 1.6 + u * 2.7) * amp * 0.45);
      }
      ctx.beginPath();
      ctx.moveTo(0, h);
      crest.forEach((y, j) => ctx.lineTo(j * 6, y));
      ctx.lineTo(w, h); ctx.closePath();
      const g = ctx.createLinearGradient(0, base - amp, 0, h);
      g.addColorStop(0, wallAlpha(col, 0.16 + k * 0.14));
      g.addColorStop(1, wallAlpha(wallMix(c.bg2, c.cool, 0.3), 0.6));
      ctx.fillStyle = g; ctx.fill();
      ctx.beginPath();
      crest.forEach((y, j) => (j ? ctx.lineTo(j * 6, y) : ctx.moveTo(0, y)));
      ctx.strokeStyle = wallAlpha(col, 0.26 + k * 0.22);
      ctx.lineWidth = 1.6; ctx.stroke();
      ctx.beginPath();
      crest.forEach((y, j) => (j ? ctx.lineTo(j * 6, y - 1.6) : ctx.moveTo(0, y - 1.6)));
      ctx.strokeStyle = wallAlpha(c.fg, 0.06 + k * 0.1);
      ctx.lineWidth = 1; ctx.stroke();
    }
    wallVignette(ctx, w, h, 0.3);
  },

  // ── Static: a dead channel. Noise is cached; regenerating per frame is costly. ─
  static(ctx, st, t) {
    const { w, h, c } = st;
    const noise = (st.noise ||= buildNoiseTiles(c));
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = wallMix(c.bg, '#000000', 0.3);
    ctx.fillRect(0, 0, w, h);
    // Chroma split: the grain drawn three times, offset per channel, additive.
    const frame = noise[Math.floor(t / 90) % noise.length];
    const jit = Math.sin(t / 140) * 1.6;
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.4;
    ctx.drawImage(frame, -1.5 - jit, 0, w, h);
    ctx.globalAlpha = 0.34;
    ctx.drawImage(frame, 1.5 + jit, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.34;
    ctx.drawImage(frame, 0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = wallAlpha(c.hot, 0.05); ctx.fillRect(0, 0, w, h * 0.5);
    ctx.fillStyle = wallAlpha(c.cool, 0.05); ctx.fillRect(0, h * 0.5, w, h * 0.5);
    ctx.globalCompositeOperation = 'source-over';
    const barY = ((t / 12) % (h + 120)) - 60;
    const g = ctx.createLinearGradient(0, barY - 40, 0, barY + 40);
    g.addColorStop(0, wallAlpha(c.hot, 0));
    g.addColorStop(0.42, wallAlpha(c.hot, 0.14));
    g.addColorStop(0.5, wallAlpha(c.fg, 0.16));
    g.addColorStop(0.58, wallAlpha(c.cool, 0.14));
    g.addColorStop(1, wallAlpha(c.cool, 0));
    ctx.fillStyle = g; ctx.fillRect(0, barY - 40, w, 80);
    const gy = ((t / 900) % 1) * h;
    ctx.globalAlpha = 0.5;
    ctx.drawImage(frame, 0, 0, 48, 6, Math.sin(t / 300) * 14, gy, w, 7);
    ctx.globalAlpha = 1;
    ctx.fillStyle = wallAlpha('#000000', 0.22);
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    wallVignette(ctx, w, h, 0.4);
  },
};

// Circuit's board, built once: walks on a 16px pitch, each with cumulative length so a
// pulse is placed by distance.
function buildCircuitTraces(w, h) {
  const P = 16, out = [];
  const rnd = wallSeeded(0x5eed);
  for (let i = 0; i < 16; i++) {
    let x = Math.round((rnd() * w) / P) * P, y = Math.round((rnd() * h) / P) * P;
    let horiz = rnd() < 0.5;
    const pts = [{ x, y }];
    for (let k = 0; k < 7; k++) {
      const step = (1 + Math.floor(rnd() * 4)) * P * (rnd() < 0.5 ? -1 : 1);
      if (horiz) x = Math.max(-P, Math.min(w + P, x + step)); else y = Math.max(-P, Math.min(h + P, y + step));
      horiz = !horiz;
      pts.push({ x, y });
    }
    let len = 0; const segs = [];
    for (let k = 1; k < pts.length; k++) {
      const d = Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
      segs.push({ at: len, d }); len += d;
    }
    if (len < 20) continue;
    out.push({ pts, segs, len, speed: 2600 + rnd() * 5200, phase: rnd(), lane: Math.floor(rnd() * 3) });
  }
  return out;
}
function wallAlongPolyline(tr, dist) {
  if (dist < 0 || dist > tr.len) return null;
  for (let i = 0; i < tr.segs.length; i++) {
    const s = tr.segs[i];
    if (dist <= s.at + s.d) {
      const f = s.d ? (dist - s.at) / s.d : 0;
      const a = tr.pts[i], b = tr.pts[i + 1];
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
  }
  return null;
}
function buildCodeColumns(w, h) {
  const step = 13, out = [];
  for (let x = 2; x < w; x += step) {
    // 'lane' is the column's hue for life, weighted hard toward the accent.
    const r = Math.random();
    out.push({ x, n: 6 + Math.floor(Math.random() * 10), v: 0.02 + Math.random() * 0.055,
      off: Math.random() * (h + 200), seed: Math.floor(Math.random() * 97),
      lane: r < 0.62 ? 0 : r < 0.86 ? 1 : r < 0.97 ? 2 : 3 });
  }
  return out;
}
// Four 48×48 noise tiles, cycled.
function buildNoiseTiles(c) {
  const N = 48;
  const base = wallRgb(c.fg) || [220, 230, 240];
  return Array.from({ length: 4 }, () => {
    const cv = document.createElement('canvas');
    cv.width = N; cv.height = N;
    const cx = cv.getContext('2d');
    const img = cx.createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
      const v = Math.random();
      img.data[i * 4] = base[0]; img.data[i * 4 + 1] = base[1]; img.data[i * 4 + 2] = base[2];
      img.data[i * 4 + 3] = v > 0.72 ? Math.round(v * 190) : 0;
    }
    cx.putImageData(img, 0, 0);
    return cv;
  });
}
// A small deterministic PRNG: seeded layouts must come back the same each render.
function wallSeeded(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

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
  // ⚠ Strength rides a CUSTOM PROPERTY, never inline opacity: inline opacity beats the
  // '.on' class, so stopWallpaper couldn't hide it. Sky dims indoors.
  const strength = mode === 'sky'
    ? (sky?.indoors ? 0.26 : 0.5)
    : (TABLET_WALLPAPERS.find(w2 => w2.id === mode)?.s ?? 0.34);
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
  // Drop the strength var too, so nothing inline can keep the canvas visible.
  cv.style.removeProperty('--wall-strength');
  cv.style.removeProperty('opacity');
}

export function closeTabletPanel() { shutdownTablet(); }

// game-disconnect (dropped connection or sign-out): tear down at once, no CRT flourish.
window.addEventListener('game-disconnect', () => { if (_overlay) close(); });

function close() {
  // Narration dies with the shell, except after an explicit Minimize (this flag).
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
  cancelInstall();   // the fill's rAF must never outlive the overlay it paints into
  _homePage = 0;     // the tablet always opens on the first page of the home screen
  _tosSelectMode = false;
  _homeSearchOpen = false; _homeSearch = '';
  stopWallpaper();   // the rAF must never outlive the overlay it draws into
  unmountTabletTv();
  _wasSurvLive = false;
  // The back stack dies with the shell; a reopened tablet starts at Home.
  _navStack = [];
  _navHere = null;
  _navSig = null; _lastWasAct = false; _actDepth = 0;
  // Stray lift clones from a mid-drag teardown live on body, so sweep them here.
  document.querySelectorAll('.tos-tile-drag, .tos-group-drag').forEach(el => el.remove());
  if (_close) { _close(); _close = null; }
  _overlay = null;
  _data = null;
}

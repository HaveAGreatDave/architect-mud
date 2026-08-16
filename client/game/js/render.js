import { state } from './state.js';
import { updateBodyTempHUD, refreshWetnessHUD } from './panels/environment.js';
import { refreshCustomPanels } from './panels/custom/manager.js';
import { registerList, mountScopeToggle, hiddenKeys } from './panels/list-reorder.js';
import { renderSmartBar } from './panels/smartbar.js';
import { burnBehind } from './flame.js';
import { paintHighlights } from './highlights.js';

// ── The line observer ───────────────────────────────────────────────────────
//
// Triggers (automation.js) need every line the client prints. They arrive by
// REGISTRATION rather than by import, because automation.js needs appendMsg and
// the macro runner, and the macro runner needs appendMsg — importing it from here
// would put render at the bottom of a cycle with two modules that are much bigger
// than it is. Render should not know automation exists; it just says what it
// printed, to whoever asked.
// The observer is asked about every line BEFORE the node is mounted, never after.
// So a gagged line was never in the document at all, and the find bar, the
// transcript, Read Aloud and the scrollback cap all agree without any of them
// being told that gagging exists. Removing a mounted node instead would leave
// four readers with four ideas of what the log contains, and Read Aloud would
// already have queued the line it can no longer see.
//
// The CLASS goes over with the text. This client has no ANSI colour and never
// will — it has ~30 semantic classes (`msg-combat-incoming`, `msg-loot`,
// `msg-say`, `msg-death`), which is the thing colour is a lossy proxy for on a
// traditional MUD. A rule that can say "loot lines only" beats one matching a
// colour somebody chose to stand for it, and costs one argument.
let _lineObserver = null;
export function setLineObserver(fn) { _lineObserver = fn; }

// The verdict: `gag` hides the line, `panes` names windows to copy it into.
//
// `true` is still accepted and still means gag — that is what the contract was
// before routing existed, and nothing gains by breaking it.
//
// ⚠ msg-system is NEVER gaggable, whatever a pattern says. That class is the
// client talking to the player — including the message saying all their triggers
// just got switched off for looping. A pattern broad enough to hide the game's own
// explanation of what went wrong makes the client unsupportable.
function verdict(text, cls) {
  if (!_lineObserver) return { gag: false, panes: null };
  if (cls === 'system') return { gag: false, panes: null };
  // ⚠ Never let an observer throw on the append path. A bad pattern taking the
  // whole log down — every line, until a reload — is the failure this catch
  // exists for, and it is a failure a player can cause by typing.
  let v;
  try { v = _lineObserver(text, cls); }
  catch { return { gag: false, panes: null }; }   // an observer's problem is not the log's
  if (v === true) return { gag: true, panes: null };
  if (v && typeof v === 'object') return { gag: !!v.gag, panes: v.panes || null };
  return { gag: false, panes: null };
}

// Where a routed copy goes. Registered rather than imported, same reasoning as
// the observer: panes.js is UI and render.js should not know it exists.
let _paneWriter = null;
export function setPaneWriter(fn) { _paneWriter = fn; }

function routeCopy(panes, text, cls) {
  if (!panes || !_paneWriter) return;
  try { _paneWriter(panes, text, cls); } catch { /* a pane's problem is not the log's */ }
}

// ── The state observer ──────────────────────────────────────────────────────
//
// State triggers ("when my HP drops below 30") fire from here rather than by
// parsing text. On a traditional MUD this is done by regex-matching a prompt
// line, because the prompt is all a third-party client gets; here the vitals
// arrive as structured data and `updateVitals` is the single funnel every
// `player_update` in dispatch.js goes through. Reading numbers instead of
// scraping them is the whole advantage of owning both ends.
let _stateObserver = null;
export function setStateObserver(fn) { _stateObserver = fn; }

// Make the Vitals list reorderable. Call after initSidebarOrder, which reparents
// the section's rows into a .sidebar-section-body (the real row container).
// HUNGER, THIRST AND SANITY ARE OFF BY DEFAULT.
//
// SANITY IS HIDDEN FOR A DIFFERENT REASON THAN THE OTHER TWO, and the difference is the
// whole point. Hunger and thirst lost their bars and GAINED honest prose — banded lines that
// tell you plainly how hungry you are. Sanity gets no such replacement, deliberately: people
// losing their minds do not get a readout, and a reliable narrator would defeat the system it
// is narrating. The symptoms ARE the interface, and they are meant to be deniable — a whisper
// you could have imagined, a person who might have been there, a line somebody might actually
// have said. A number would let you check, and checking is exactly what a mind coming apart
// cannot do.
//
// `condition` still reports the Cool penalty ("rattled"), which is honest without being a
// gauge — the same deal temperature has always had.
//
// Body temperature has never had a bar — you read it from `condition` and from banded prose —
// and hunger and thirst were the inconsistency, not the rule. They now have proper banded
// messages (server/engine/appetite.js: unequal bands, a cadence that tightens as it worsens,
// crossing treated as an event) plus a satiation line when you eat, which is the one thing a
// bar could never tell you: how FULL you are, rather than how empty.
//
// A number invites you to top up at 79 because you can see 79. Prose makes eating a response
// to your own body instead of a chore against a gauge. Both are still one click away in the
// vitals edit mode for anyone who wants the instrument back — and `condition` remains the
// precise read for everyone, exactly as it already is for temperature.
export const DEFAULT_HIDDEN_VITALS = ['hun', 'thi', 'san', 'hor'];

export function initVitalsReorder() {
  const body = document.querySelector('#vitals-section .sidebar-section-body')
    || document.getElementById('vitals-section');
  if (!body) return;
  mountScopeToggle('vitals', document.getElementById('vitals-edit-host'));
  registerList(body, { scope: 'vitals', key: 'vitals', rowSelector: '.vital', defaultHidden: DEFAULT_HIDDEN_VITALS });
}

// ── Quoted speech is ONE colour, everywhere ────────────────────────────────
// Dialogue is dialogue no matter how it reaches the log: a `say`, an NPC line,
// a battle cry, or a quote buried inside an emote ("Marla shrugs. 'Suit
// yourself.'"). Rather than asking every writer on the server to tag its own
// speech — which they'd forget, and which content authors can't do at all —
// the client paints it at the last possible moment: any run of text between
// double quotes becomes .speech.
//
// Ambient texture is deliberately EXEMPT (see QUIET_CLASSES). What's on the TV
// or muttered by the room is not somebody talking to you, and if it glowed the
// same colour the whole point — actions and dialogue standing out from noise —
// would be lost.
const QUIET_CLASSES = /^msg-(ambient|broadcast|broadcast-ticker|broadcast-ambient|broadcast-ascii-art|echo)$/;
const QUOTE_RE = /(["“”])([^"“”]+)(["“”])/g;

// Not every pair of quotes is somebody talking. A nickname or a scare-quoted
// label — Nine-Fingers "Two-Cell" Marsh, a bar called "The Pit" — is a NAME,
// and colouring it like dialogue makes the log lie about who's speaking.
// Speech earns the colour by looking like an utterance: it carries sentence
// punctuation, or it runs long enough that no name would. Anything shorter and
// unpunctuated is left plain.
function isSpeech(inner) {
  const s = inner.trim();
  if (/[.!?,;:…]/.test(s)) return true;
  return s.split(/\s+/).length >= 4;
}

function paintSpeech(el) {
  if ([...el.classList].some(c => QUIET_CLASSES.test(c))) return el;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const targets = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement?.closest('.speech')) continue;   // already painted
    if (n.nodeValue && /["“”]/.test(n.nodeValue)) targets.push(n);
  }
  for (const node of targets) {
    const text = node.nodeValue;
    QUOTE_RE.lastIndex = 0;
    let last = 0, m;
    const frag = document.createDocumentFragment();
    while ((m = QUOTE_RE.exec(text))) {
      if (!isSpeech(m[2])) continue;                      // a name in quotes, not a line
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const span = document.createElement('span');
      span.className = 'speech';
      span.textContent = m[0];
      frag.appendChild(span);
      last = m.index + m[0].length;
    }
    if (!last) continue;                                  // an unpaired quote — leave it be
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }
  return el;
}

export function appendMsg(text, cls = '') {
  const el = document.createElement('div');
  el.className = `msg msg-${cls}`;
  el.textContent = text;
  // The transcript is recorded even when the line is gagged: gagging is about not
  // wanting to READ something, and a log you saved to work out what happened
  // should not have holes in it where your own filters were.
  recordLine(text);
  const v = verdict(text, cls);
  // A routed copy is written even when the line is gagged from the main log —
  // that combination ("send chat to its own window and keep it out of here") is
  // the single commonest thing anybody wants routing FOR.
  routeCopy(v.panes, text, cls);
  if (v.gag) return el;                    // never mounted — see verdict()
  paintSpeech(el);
  paintHighlights(el);
  document.getElementById('output').appendChild(el);
  scrollOutput();
  return el;
}

export function appendHtml(html, cls = '') {
  const el = document.createElement('div');
  el.className = `msg msg-${cls}`;
  el.innerHTML = html;
  // Triggers and the transcript see the TEXT of a rich line, never its markup — a
  // pattern should match what the player read, not the span soup it arrived in.
  recordLine(el.textContent);
  const v = verdict(el.textContent, cls);
  routeCopy(v.panes, el.textContent, cls);
  if (v.gag) return el;
  paintSpeech(el);
  paintHighlights(el);
  document.getElementById('output').appendChild(el);
  // Hero-poster mural reveal: the CSS burns the glyphs, this puts real fire
  // behind them. Mounted after the node is in the document so it can be measured.
  el.querySelectorAll('.mural-word').forEach(w => burnBehind(w));
  scrollOutput();
  return el;
}

// A transient "aircraft overhead" banner pinned to the top of the room pane. It lives
// in #output-container (which doesn't scroll and survives room-look refreshes), fades in
// on arrival, and auto-clears. The server already rate-limits these per zone.
let _skyTimer = null;
export function showSkyBanner(html) {
  const host = document.getElementById('output-container');
  if (!host) return;
  let el = document.getElementById('sky-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sky-banner';
    host.appendChild(el);
  }
  el.innerHTML = `<span class="sky-glyph">✈</span> ${html}`;
  // Restart the entrance animation even if a prior banner is still showing.
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(_skyTimer);
  _skyTimer = setTimeout(() => el.classList.remove('show'), 7000);
}

export function appendPre(text, cls = '') {
  const el = document.createElement('pre');
  el.className = `msg msg-${cls}`;
  el.textContent = text;
  // Recorded, but deliberately NOT offered to triggers or gagging. A <pre> is a
  // glyph-art block — a poster, a card, a chess board — and matching a pattern
  // against box-drawing characters is not a thing anyone means to do.
  recordLine(text);
  document.getElementById('output').appendChild(el);
  scrollOutput();
}

// New room text enters in the direction of travel so a move reads as a step.
const AREA_SLIDE = { north:[0,-1], south:[0,1], east:[1,0], west:[-1,0] };

// Description collapse is a compact-view preference: the room prose clamps to
// a few lines with a toggle, and the choice persists across room changes.
function applyDescCollapse(el) {
  if (document.documentElement.getAttribute('data-density') !== 'compact') return;
  const desc = el.querySelector('.room-desc');
  if (!desc) return;
  const expanded = localStorage.getItem('areaDescExpanded') === '1';
  desc.classList.toggle('collapsed', !expanded);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'room-desc-toggle';
  toggle.textContent = expanded ? '− less' : '+ more';
  toggle.addEventListener('click', () => {
    const expand = desc.classList.contains('collapsed'); // collapsed → expand
    desc.classList.toggle('collapsed', !expand);
    localStorage.setItem('areaDescExpanded', expand ? '1' : '0');
    toggle.textContent = expand ? '− less' : '+ more';
  });
  desc.after(toggle);
}

// ── Names that are not the name any more ────────────────────────────────────
//
// While a psychedelic is running, the server sends the room with things named
// as the tripper SEES them, and tags each one with what it really is
// (`data-morph`). The pane plays the change rather than just printing it: the
// old name comes apart letter by letter and the new one settles in its place,
// so you watch the bed become a lion instead of finding a lion where you left a
// bed.
//
// Played once per (from → to) pair per MORPH_TTL — a re-look must not restage
// the whole room every time you pick something up, but stepping back in after
// the drug re-rolls the room should read as new.
const MORPH_GLYPHS = '▚▞░▒▓#%&@*+=~/\\|<>—';
const MORPH_TTL = 45000;
const morphPlayed = new Map();   // `${from}→${to}` -> timestamp

function playNameMorph(el) {
  const to = el.textContent;
  const from = el.dataset.morph || '';
  if (!from || from === to) return;
  const key = `${from}→${to}`;
  const now = Date.now();
  if (now - (morphPlayed.get(key) || 0) < MORPH_TTL) return;
  morphPlayed.set(key, now);
  if (morphPlayed.size > 200) morphPlayed.clear();
  if (document.documentElement.getAttribute('data-motion') === 'off') return;

  // Each slot settles at its own frame, left to right, and shows noise until it
  // does. Slots past the end of the old name start as noise rather than blank,
  // so a longer new name grows into place instead of appearing all at once.
  const len = Math.max(from.length, to.length);
  const settleAt = Array.from({ length: len }, (_, i) => 3 + Math.floor(i * 1.4) + Math.floor(Math.random() * 4));
  const total = Math.max(...settleAt) + 2;
  const rnd = () => MORPH_GLYPHS[Math.floor(Math.random() * MORPH_GLYPHS.length)];
  el.classList.add('name-morphing');
  let frame = 0;
  const tick = () => {
    let out = '';
    for (let i = 0; i < len; i++) {
      if (frame >= settleAt[i]) out += to[i] ?? '';
      else if (to[i] === ' ' || (from[i] === ' ' && frame < 3)) out += ' ';
      else out += rnd();
    }
    el.textContent = out;
    if (frame++ < total) setTimeout(tick, 45);
    else { el.textContent = to; el.classList.remove('name-morphing'); }
  };
  tick();
}

function playNameMorphs(root) {
  const els = root.querySelectorAll('[data-morph]');
  for (const el of els) playNameMorph(el);
}

// Display Mode `log` — put the top pane away entirely.
//
// At that rung everything the pane would show also reaches #output (server/index.js
// stamps `toLog`), so the pane is a duplicate of what you just read: it is hidden
// from assistive tech AND collapsed visually, and the log takes the whole window.
// That is the point of the rung — one chronological stream, nothing else.
//
// Both halves matter and neither is enough alone. `aria-hidden` without the
// collapse leaves a sighted log-rung player staring at a redundant panel;
// `display:none` without the aria-hidden would be fine today, but the attribute
// states the intent and survives someone changing how the collapse is done.
//
// ⚠ ONLY CALL THIS WITH `silent` TRUE WHEN THE PANE IS ACTUALLY FREE. The text
// cockpit and all five character minigame boards mount in this same pane; hiding
// it while one is up would black out a pilot's instruments or a breach board
// mid-run. dispatch.js gates on paneFreeForRoom() for exactly this.
//
// The pane must never become a live region instead: it is replaced wholesale on
// every look, so `aria-live` here would re-read the whole thing on every move and
// queue ahead of the log.
export function setPaneSilent(silent) {
  const pane = document.getElementById('area-content');
  const container = document.getElementById('output-container');
  if (pane) {
    if (silent) pane.setAttribute('aria-hidden', 'true');
    else pane.removeAttribute('aria-hidden');
  }
  // The collapse is a class, not an inline style — the layout belongs in
  // styles.css (docs/audits/ui-presentation-standard-audit.md). It hides the pane
  // AND its resize handle, or the handle is left floating over nothing.
  if (container) container.classList.toggle('log-rung', !!silent);
}

export function setAreaPane(html, direction) {
  const el = document.getElementById('area-content');
  el.innerHTML = html;
  applyDescCollapse(el);
  applyBeacons();
  playNameMorphs(el);
  // Only a location change (move) plays the slide transition. Silent refreshes
  // from kills, loot, look, etc. pass no direction and update in place.
  if (direction && el.animate && document.documentElement.getAttribute('data-motion') !== 'off') {
    const off = AREA_SLIDE[direction] || [0, 1];
    el.animate(
      [{ opacity: 0, transform: `translate(${off[0] * 10}px, ${off[1] * 10}px)` },
       { opacity: 1, transform: 'translate(0, 0)' }],
      { duration: 220, easing: 'ease-out' }
    );
  }
  document.getElementById('area-pane').dispatchEvent(new CustomEvent('contentupdate'));
}

// Is the room pane actually on screen right now? Desktop always: true. Mobile
// starts collapsed (`mob-pane-hidden`) and the player toggles it. Server messages
// flagged `paneFallback` are LOG COPIES of something already drawn into the room
// pane — they exist for the collapsed-mobile case only, and appending them while
// the pane is open is pure duplication (the elevator's floor panel three times
// over). Anything that can't find the pane errs toward showing the copy.
export function isAreaPaneVisible() {
  const pane = document.getElementById('area-pane');
  if (!pane) return false;
  if (pane.classList.contains('mob-pane-hidden')) return false;
  return pane.offsetParent !== null && pane.getBoundingClientRect().height > 4;
}

// Ripple the room-pane link for `action`+`target` (server `pointAt()`), telling
// the player where to click. The pane may not carry the link yet — a look can
// still be in flight behind the message that pointed — so retry briefly.
export function pointAtRoomTarget(action, target, tries = 6) {
  if (!action || !target) return;
  if (document.documentElement.getAttribute('data-motion') === 'off') return;
  const pane = document.getElementById('area-content');
  const el = pane && [...pane.querySelectorAll(`[data-action="${action}"][data-target]`)]
    .find((n) => n.dataset.target.toLowerCase() === String(target).toLowerCase());
  if (!el) {
    if (tries > 0) setTimeout(() => pointAtRoomTarget(action, target, tries - 1), 400);
    return;
  }
  el.classList.remove('point-ripple');
  void el.offsetWidth; // restart the animation if it's already been pointed at
  el.classList.add('point-ripple');
  setTimeout(() => el.classList.remove('point-ripple'), 3600);
}

// ── Sticky beacons ───────────────────────────────────────────────────────────
// The object the tutorial is steering you toward keeps shimmering until the
// server clears it (server `pointAt(..., { sticky: true })` / `clearPointAt()`).
// Held here as a list rather than painted once, because the room pane is
// rebuilt wholesale on every look, move, take and kill — a class stamped onto
// the old DOM would be gone within seconds.
let _beacons = [];   // [{ action, target }]

function beaconEls() {
  const pane = document.getElementById('area-content');
  if (!pane || !_beacons.length) return [];
  const out = [];
  for (const { action, target } of _beacons) {
    const t = String(target).toLowerCase();
    for (const n of pane.querySelectorAll(`[data-action="${action}"][data-target]`)) {
      if (n.dataset.target.toLowerCase() === t) out.push(n);
    }
  }
  return out;
}

// Re-stamp the live beacons onto the freshly rendered pane. Called from
// setAreaPane, and again on a short retry when a beacon is first set (the look
// carrying the link can still be in flight behind the message that set it).
export function applyBeacons() {
  for (const el of beaconEls()) el.classList.add('point-beacon');
}

export function setRoomBeacon(action, target, on, tries = 6) {
  if (!action || !target) return;
  const key = (b) => `${b.action} ${String(b.target).toLowerCase()}`;
  const me = key({ action, target });
  _beacons = _beacons.filter(b => key(b) !== me);
  if (!on) {
    const pane = document.getElementById('area-content');
    pane?.querySelectorAll('.point-beacon').forEach(n => {
      if (n.dataset.action === action && n.dataset.target?.toLowerCase() === String(target).toLowerCase()) n.classList.remove('point-beacon');
    });
    return;
  }
  _beacons.push({ action, target });
  if (!beaconEls().length && tries > 0) { setTimeout(() => setRoomBeacon(action, target, true, tries - 1), 400); return; }
  applyBeacons();
}

// Drop every beacon (leaving the prologue, or a server-side reset).
export function clearRoomBeacons() {
  _beacons = [];
  document.getElementById('area-content')?.querySelectorAll('.point-beacon').forEach(n => n.classList.remove('point-beacon'));
}

// ── Scroll lock ─────────────────────────────────────────────────────────────
//
// The log used to jam itself to the bottom on EVERY appended line, so scrolling
// up to re-read what an NPC just said was impossible during a fight: the next
// combat tick yanked you back down mid-sentence. Reading back is not an edge
// case in a game that says everything in prose.
//
// The rule is the one every terminal uses: follow the tail only if the reader
// was ALREADY at the tail. Scroll up and the log holds still until you come
// back — either by scrolling down yourself, or by tapping the chip below, which
// is also what tells you the game hasn't stopped talking.
//
// Deliberately NOT reset on new lines, room changes or panels: a reader who has
// scrolled up has said what they want, and the one thing worse than a log that
// won't hold still is one that holds still only until something interesting
// happens. `submitCommand` releases it (input.js) — acting says you are done
// reading, the same reasoning that makes acting stop the read-aloud queue.
const TAIL_SLACK = 48;   // px from the bottom still counted as "at the tail"

function atTail(out) {
  return out.scrollHeight - out.scrollTop - out.clientHeight <= TAIL_SLACK;
}

// ⚠ `_following` is sampled from the SCROLL EVENT, never measured at append
// time. By the time an append helper calls scrollOutput() the node is already in
// the document, so scrollHeight has already grown by its height — measuring
// there reads a reader who was at the tail as being one long room description
// away from it, and the lock engages on its own. The scroll event is the only
// moment the measurement means what it says.
let _following = true;
let _held = 0;           // lines appended while the reader was scrolled up

// ⚠ #output is `scroll-behavior: smooth`, so setting scrollTop ANIMATES and
// fires a run of scroll events on the way down — every one of them measuring
// short of the tail. Without this flag the log locks itself the instant it
// scrolls, which looks exactly like the bug this whole thing fixes. While a
// programmatic snap is in flight we ignore what the reader's position says and
// only clear the flag when it lands.
let _auto = false;

function snap(out) {
  _auto = true;
  out.scrollTop = out.scrollHeight;
}

function chip() {
  const host = document.getElementById('output-container');
  if (!host) return null;
  let el = document.getElementById('scroll-resume');
  if (!el) {
    el = document.createElement('button');
    el.id = 'scroll-resume';
    el.type = 'button';
    el.addEventListener('click', () => releaseScrollLock());
    host.appendChild(el);
  }
  return el;
}

function paintChip() {
  const el = chip();
  if (!el) return;
  if (_held > 0) {
    el.textContent = `${_held} new line${_held === 1 ? '' : 's'} ↓`;
    el.classList.add('show');
  } else {
    el.classList.remove('show');
  }
}

// Snap to the bottom and start following again. Called by the chip and by every
// submitted command.
export function releaseScrollLock() {
  const out = document.getElementById('output');
  if (out) snap(out);
  _following = true;
  _held = 0;
  paintChip();
}

export function initScrollLock() {
  const out = document.getElementById('output');
  if (!out) return;
  // Scrolling back down by hand resumes following without needing the chip.
  out.addEventListener('scroll', () => {
    const tail = atTail(out);
    if (_auto) { if (tail) _auto = false; return; }
    _following = tail;
    if (_following && _held) { _held = 0; paintChip(); }
  }, { passive: true });
}

// ── Scrollback cap ──────────────────────────────────────────────────────────
//
// Nothing used to remove a log line, ever. A long session is a DOM that grows
// without bound, and it isn't only memory: Read Aloud's observer, the find bar
// and the transcript export all walk this list, so every one of them gets slower
// for as long as somebody stays logged in — the exact shape of bug that never
// reproduces in a ten-minute test.
//
// ⚠ Only ever trims while FOLLOWING. Removing nodes above the viewport shifts
// everything the reader is looking at up by the height of what went, which is
// indistinguishable from the log scrolling itself while they read. A reader who
// has scrolled back gets an uncapped log until they come down, which is the
// right trade: they asked for the backlog.
const MAX_LINES = 1500;

// ── The session transcript ──────────────────────────────────────────────────
//
// Every line the client prints, kept independently of the DOM. `.savelog` used to
// read the log out of the document, which meant the transcript silently began
// wherever the scrollback cap happened to have trimmed to — so the one thing you
// save a log FOR (working out what happened earlier) was the one thing it could
// not tell you.
//
// Held in memory rather than streamed to disk: writing continuously needs the
// File System Access API, which is Chromium-only and asks for a folder
// permission the first time. A buffer this size covers a long session, and what
// it cannot do is survive a refresh — which is stated plainly in the saved file's
// own header rather than left to be discovered.
//
// Gagged lines ARE recorded (see appendMsg). Trimmed lines are not recoverable
// once past the cap, which is the same honest limit, one order of magnitude out.
const TRANSCRIPT_MAX = 20000;
const _transcript = [];
let _transcriptLost = 0;      // dropped off the front — the file says how many

function recordLine(text) {
  _transcript.push(String(text ?? ''));
  if (_transcript.length > TRANSCRIPT_MAX) {
    const over = _transcript.length - TRANSCRIPT_MAX;
    _transcript.splice(0, over);
    _transcriptLost += over;
  }
}

export function getTranscript() {
  return { lines: [..._transcript], lost: _transcriptLost, cap: TRANSCRIPT_MAX };
}

function trimScrollback(out) {
  if (!_following) return;
  let over = out.childElementCount - MAX_LINES;
  while (over-- > 0 && out.firstElementChild) out.removeChild(out.firstElementChild);
}

export function scrollOutput() {
  const out = document.getElementById('output');
  if (!out) return;
  trimScrollback(out);
  if (_following) { snap(out); return; }
  _held++;
  paintChip();
}

export function updateVitals(p) {
  setBar('hp', p.hp, p.hp_max || 100);
  setBar('san', p.sanity, p.sanity_max || 100);
  setBar('hun', p.hunger, 100);
  setBar('thi', p.thirst, 100);
  setBar('sta', p.stamina, p.stamina_max || 100);
  setBar('rad', p.radiation, 100, true);
  refreshWetnessHUD();   // wetness and fatigue ride the environment HUD, not the vitals bars
  // Mobile hunger/thirst mirror whatever the sidebar is hiding. The compact bars carry no
  // `data-lr-key`, so list-reorder cannot manage them; hiding them here keeps one decision
  // driving both layouts instead of letting the phone disagree with the desktop.
  {
    const hidden = hiddenKeys('vitals', DEFAULT_HIDDEN_VITALS);
    for (const key of ['hun', 'thi', 'san']) {   // not 'hor': it has its own MIS-gated wrapper
      const row = document.getElementById(`${key}-bar-m`)?.closest('.mob-bar-row');
      if (row) row.style.display = hidden.has(key) ? 'none' : '';
    }
  }
  // Radiation bar — only visible when the player is actually irradiated
  if (p.radiation !== undefined) {
    const showRad = (p.radiation || 0) > 0;
    const desktop = document.getElementById('rad-bar-wrap');
    if (desktop) desktop.style.display = showRad ? '' : 'none';
    const mobileInner = document.getElementById('rad-bar-wrap-m');
    const mobileRow = mobileInner && mobileInner.closest('.mob-bar-row');
    if (mobileRow) mobileRow.style.display = showRad ? '' : 'none';
  }
  // Combat stance chip. Stance is persistent state, so it lives in the HUD
  // rather than being re-announced in the output pane every swing — the pane
  // already prints a line every attack cycle. `normal` is the default and the
  // no-op, so it stays hidden: the chip only appears when you've actually
  // committed to something.
  if (p.combat_stance !== undefined) {
    const stance = p.combat_stance || 'normal';
    for (const id of ['stance-chip', 'stance-chip-m']) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.textContent = `⚔ ${stance.toUpperCase()}`;
      el.className = `stance-chip stance-${stance}`;
      // The mobile chip sits inside its own bar row — hide the row, or an empty
      // one is left behind.
      const host = el.closest('.mob-bar-row') || el;
      host.style.display = stance === 'normal' ? 'none' : '';
    }
  }
  if (p.credits !== undefined) {
    const el = document.getElementById('header-credits-val');
    if (el) el.textContent = p.credits;
    const m = document.getElementById('mob-credits');
    if (m) m.textContent = `₵ ${p.credits}`;
  }
  // Horniness bar — MIS-gated AND hidden by default like the other body meters. It is a
  // feeling, not a dial: the mis plugin narrates it in bands on the way up, holds a cadence
  // while it sits high, and says so on the way back down. Two gates, both of which must pass
  // before it appears: MIS active (consent) and the player having deliberately re-added the
  // row (preference).
  if (p.mis_enabled !== undefined) {
    const misOn = p.mis_enabled === 1 || p.mis_enabled === true;
    const show = misOn && !hiddenKeys('vitals', DEFAULT_HIDDEN_VITALS).has('hor');
    for (const id of ['horny-bar-wrap', 'horny-bar-wrap-m']) {
      const el = document.getElementById(id);
      if (el) el.style.display = show ? '' : 'none';
    }
  }
  if (p.horniness !== undefined) {
    setBar('hor', p.horniness, 100);
  }
  if (p.body_temp_c !== undefined) {
    updateBodyTempHUD(p.body_temp_c);
  }
  // Player-bound custom panels track the built-in vitals in lockstep.
  refreshCustomPanels();
  // ⚠ State triggers fire LAST, after the HUD is fully painted. A trigger can
  // print a line and run commands, and doing that from the middle of this
  // function would leave the bars half-updated while it ran. Wrapped, because a
  // state trigger's expression is player-written and this is the per-update path.
  try { _stateObserver?.(p); } catch { /* an observer's problem is not the HUD's */ }
}

function setBar(id, val, max, inverse = false) {
  const pct = Math.max(0, Math.min(100, (val / max) * 100));
  const low = inverse ? pct > 60 : pct < 25;
  for (const suffix of ['', '-m']) {
    const bar = document.getElementById(`${id}-bar${suffix}`);
    const valEl = document.getElementById(`${id}-val${suffix}`);
    if (bar) { bar.style.width = pct + '%'; bar.classList.toggle('low', low); }
    if (valEl) valEl.textContent = Math.round(val);
  }
}

// Maps dpad data-cmd abbreviations to full direction names used in exit data-target
const _DPAD_DIR = { n:'north', s:'south', e:'east', w:'west', u:'up', d:'down', in:'in', out:'out' };

export function parseZoneInfo(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const zoneName = tmp.querySelector('.zone-name')?.textContent;
  if (zoneName) {
    document.getElementById('zone-name-display').textContent = zoneName;
    const bar = document.getElementById('mob-room-name-bar');
    if (bar) bar.textContent = zoneName;
  }

  const exitLinks = tmp.querySelectorAll('.action-link.exit-link, .action-link.building-link, .action-link.room-nav-link, .action-link.door-link');
  const availDirs = new Set();
  const lockByDir = {}; // direction -> 'locked' | 'owned' (door-links only)
  for (const link of exitLinks) {
    if (!link.dataset.target) continue;
    // door-links carry "door <dir>"; plain exits carry the raw direction
    const dir = link.dataset.target.replace(/^door /, '');
    availDirs.add(dir);
    if (link.dataset.lock) lockByDir[dir] = link.dataset.lock;
  }

  // Light up dpad buttons for available exits, tinting locked/owned doors
  for (const btn of document.querySelectorAll('#mob-dpad .dpad-btn[data-cmd], #loc-dpad .dpad-btn[data-cmd]')) {
    const dir = _DPAD_DIR[btn.dataset.cmd] || btn.dataset.cmd;
    btn.classList.toggle('dpad-available', availDirs.has(dir));
    btn.classList.toggle('dpad-locked', lockByDir[dir] === 'locked');
    btn.classList.toggle('dpad-owned', lockByDir[dir] === 'owned');
  }

  // Rebuild the mobile smart action bar from the same room refresh.
  renderSmartBar();
}

export function showDevPanelButton() {
  const btn = document.getElementById('dev-panel-btn');
  if (btn) btn.style.display = '';
  const dbg = document.getElementById('debug-whisper-btn');
  if (dbg) dbg.style.display = '';
}

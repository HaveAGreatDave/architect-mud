/**
 * PIANO — the playable keyboard.
 *
 * A docked two-octave keyboard you actually play, on your own keys, in real time.
 *
 * THE ONE RULE: THE NOTE YOU PLAY SOUNDS LOCALLY, IMMEDIATELY.
 * `strike()` builds the voice and plays it in the same tick as the keydown, and
 * only THEN tells the server, which relays the semantics to everyone else in the
 * room. Waiting for the server to hand your own note back would put a round trip
 * between pressing a key and hearing it, and an instrument with 80ms of latency
 * is not an instrument. The server is authoritative over who may play and how
 * fast — never over what the player hears from their own hands.
 *
 * THE KEYBOARD FIGHT. This game's command box grabs focus the moment you type a
 * letter anywhere (input.js), which would turn a performance into command spam.
 * So the panel takes focus explicitly and listens on ITSELF, not on window, and
 * exports `isPianoKeysLive()` for input.js to check — the same treatment the
 * flight sim and the hangar walk-around already get. Escape hands the keyboard
 * back. The state is shown, always, because a surface that silently owns your
 * keyboard is a bug report.
 *
 * Layout is the tracker layout every music tool has used for thirty years: the
 * bottom letter row is the lower octave, the row above it holds that octave's
 * black keys, and the QWERTY row is the octave above. Someone who has touched a
 * DAW already knows it, and someone who hasn't can read it off the keycaps drawn
 * on the keys.
 */
import { sendRaw, sendCmdSilent } from '../net.js';
import { makeDraggable } from './confirm.js';

// Where the player last dragged it to. Remembered across sessions, because a
// panel you have to reposition every time you sit down is a panel you resent.
// Double-clicking the header throws it away and re-docks.
const POS_KEY = 'pianoPanelPos';

const SEMITONES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const IS_WHITE = [true, false, true, false, true, true, false, true, false, true, false, true];

// Offsets in semitones from the panel's base octave. Two full octaves plus the
// tail of a third, which is what the two letter rows physically reach.
const KEYMAP = {
  z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11, ',': 12,
  q: 12, 2: 13, w: 14, 3: 15, e: 16, r: 17, 5: 18, t: 19, 6: 20, y: 21, 7: 22, u: 23,
  i: 24, 9: 25, o: 26, 0: 27, p: 28,
};
const SPAN = 29; // semitones drawn, C(base) .. E(base+2)

// The label drawn on each key. Built from KEYMAP so the two can never disagree;
// where two keys reach the same note (`,` and `q` are both the middle C of the
// layout) the lower row wins, because that is the one your left hand is on.
const KEYCAP = (() => {
  const caps = {};
  for (const [k, off] of Object.entries(KEYMAP)) if (caps[off] === undefined) caps[off] = k;
  return caps;
})();

const MIN_OCTAVE = 1, MAX_OCTAVE = 6;

let el = null;          // the panel root
let keyEls = new Map(); // semitone offset -> key element
let held = new Set();   // offsets currently down, so key repeat doesn't retrigger
let live = false;       // do we own the keyboard right now
let octave = 3;
let voice = 'piano';
let furnName = 'piano';

// input.js asks this before yanking focus into the command box on a keystroke.
export function isPianoKeysLive() { return live; }

// ── Sound ────────────────────────────────────────────────────────────────────

function noteName(offset) {
  return SEMITONES[offset % 12] + (octave + Math.floor(offset / 12));
}

// Build and play a voice locally. The SAME call the room makes when it receives
// somebody else's note — one path, so what you hear yourself play is exactly
// what everyone else hears.
export function playNoteLocal(v, note, velocity) {
  const P = window.ProceduralSFX;
  if (!P) return;
  const cue = P.buildNoteCue({ instrument: v, note, velocity });
  if (cue) window.AudioEngine?.playSfx(cue);
}

function strike(offset, velocity) {
  const note = noteName(offset);
  window.AudioEngine?.init?.();
  playNoteLocal(voice, note, velocity);   // first, and without waiting for anyone
  flash(keyEls.get(offset), 'self');
  sendRaw({ type: 'instrument_note', note, velocity: Math.round(velocity * 100) / 100 });
}

// ── Someone else in the room ─────────────────────────────────────────────────
// Their note arrives already validated and rate-limited. If their panel is open
// too, the key lights up under their name — which is the only way to tell a duet
// from a very fast soloist.
export function onRoomNote(msg) {
  playNoteLocal(msg.voice || 'piano', msg.note, msg.velocity ?? 0.75);
  if (!el) return;
  const off = offsetOf(msg.note);
  if (off != null) flash(keyEls.get(off), 'other');
}

// Reverse of noteName — where does an absolute note sit on the drawn keyboard?
// Returns null when it's off the end, which is normal: the other player may be
// two octaves away from where your own panel is transposed.
function offsetOf(note) {
  const m = /^([A-G]#?)(-?\d)$/.exec(String(note || ''));
  if (!m) return null;
  const idx = SEMITONES.indexOf(m[1]);
  if (idx < 0) return null;
  const off = (parseInt(m[2], 10) - octave) * 12 + idx;
  return off >= 0 && off < SPAN ? off : null;
}

function flash(node, cls) {
  if (!node) return;
  node.classList.add(cls === 'other' ? 'pk-other' : 'pk-down');
  // Timed rather than tied to keyup: the note decays on its own schedule and the
  // key lighting up is feedback for the STRIKE, not for how long a finger sat there.
  clearTimeout(node._pkT);
  node._pkT = setTimeout(() => node.classList.remove('pk-down', 'pk-other'), 160);
}

// ── Keyboard ─────────────────────────────────────────────────────────────────

function onKeyDown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape') { setLive(false); return; }
  if (e.key === 'ArrowLeft')  { shiftOctave(-1); e.preventDefault(); return; }
  if (e.key === 'ArrowRight') { shiftOctave(1);  e.preventDefault(); return; }

  const off = KEYMAP[e.key.toLowerCase()];
  if (off === undefined) return;
  e.preventDefault();
  // Auto-repeat would machine-gun a held key. A piano key held down is one note.
  if (e.repeat || held.has(off)) return;
  held.add(off);
  strike(off, e.shiftKey ? 0.95 : 0.72);
}

function onKeyUp(e) {
  const off = KEYMAP[e.key.toLowerCase()];
  if (off !== undefined) held.delete(off);
}

function shiftOctave(d) {
  const next = Math.max(MIN_OCTAVE, Math.min(MAX_OCTAVE, octave + d));
  if (next === octave) return;
  octave = next;
  relabel();
}

function setLive(on) {
  live = on;
  if (!el) return;
  el.classList.toggle('pk-live', on);
  el.querySelector('.pk-status').textContent = on
    ? 'KEYS LIVE — Esc to type'
    : 'click the keys to play';
  if (on) el.querySelector('.pk-keys').focus();
  else { held.clear(); document.getElementById('cmd-input')?.focus(); }
}

// ── Render ───────────────────────────────────────────────────────────────────

function relabel() {
  el.querySelector('.pk-octave').textContent = `C${octave} – E${octave + 2}`;
  for (const [off, node] of keyEls) node.title = noteName(off);
}

function build() {
  el = document.createElement('div');
  el.id = 'piano-panel';
  el.innerHTML = `
    <div class="pk-head">
      <span class="pk-name"></span>
      <span class="pk-octave"></span>
      <span class="pk-status"></span>
      <span class="pk-close" title="Get up">✕</span>
    </div>
    <div class="pk-keys" tabindex="0"></div>`;
  document.body.appendChild(el);

  const keys = el.querySelector('.pk-keys');

  // Whites laid out in flow, blacks absolutely positioned over the seam between
  // them — which is what a keyboard is, and the only layout that survives being
  // resized, because the blacks are placed as a percentage of the white count.
  const whites = [];
  for (let off = 0; off < SPAN; off++) if (IS_WHITE[off % 12]) whites.push(off);

  for (const off of whites) {
    const k = document.createElement('div');
    k.className = 'pk-key pk-white';
    k.dataset.off = off;
    k.innerHTML = `<span class="pk-cap">${capLabel(off)}</span>`;
    keys.appendChild(k);
    keyEls.set(off, k);
  }
  for (let off = 0; off < SPAN; off++) {
    if (IS_WHITE[off % 12]) continue;
    // Sits on the boundary after the white key below it.
    const whitesBelow = whites.filter(w => w < off).length;
    const k = document.createElement('div');
    k.className = 'pk-key pk-black';
    k.dataset.off = off;
    k.style.left = `calc(${(whitesBelow / whites.length) * 100}% - ${100 / whites.length / 3.2}%)`;
    k.style.width = `calc(${100 / whites.length}% / 1.6)`;
    k.innerHTML = `<span class="pk-cap">${capLabel(off)}</span>`;
    keys.appendChild(k);
    keyEls.set(off, k);
  }

  // Pointer play. Velocity from how far down the key you hit it, which is the
  // closest a mouse gets to touch — and it means the panel is genuinely playable
  // on a phone, where there is no keyboard to be live in the first place.
  keys.addEventListener('pointerdown', (ev) => {
    const k = ev.target.closest('.pk-key');
    if (!k) return;
    ev.preventDefault();
    setLive(true);
    const r = k.getBoundingClientRect();
    const depth = Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height));
    strike(Number(k.dataset.off), 0.45 + depth * 0.5);
  });

  keys.addEventListener('keydown', onKeyDown);
  keys.addEventListener('keyup', onKeyUp);
  keys.addEventListener('focus', () => setLive(true));
  keys.addEventListener('blur', () => setLive(false));
  el.querySelector('.pk-close').addEventListener('click', () => { sendCmdSilent('play stop'); closePianoPanel(); });

  // ── Dragging ──────────────────────────────────────────────────────────────
  const head = el.querySelector('.pk-head');

  // Registered BEFORE makeDraggable so it runs first: the panel is docked with
  // `bottom: 0` and a centring transform, and a fixed box pinned at both top and
  // bottom stretches to fill the gap rather than moving. Undock, then drag.
  head.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('pk-close')) return;
    undock();
    // Dragging the header blurs the keys, which drops keyboard ownership. Put it
    // back when the drag ends if they were live when it started — otherwise
    // nudging the panel silently costs you the keyboard, with no way to tell.
    const wasLive = live;
    head.addEventListener('pointerup', () => { if (wasLive) setLive(true); }, { once: true });
  });

  makeDraggable(el, head);

  head.addEventListener('pointerup', () => savePos());
  // Escape hatch: put it back where it came from.
  head.addEventListener('dblclick', () => { redock(); if (live) setLive(true); });
}

function undock() {
  if (el.classList.contains('pk-loose')) return;
  const r = el.getBoundingClientRect();
  el.classList.add('pk-loose');
  el.style.bottom = 'auto';
  el.style.transform = 'none';
  el.style.left = r.left + 'px';
  el.style.top = r.top + 'px';
}

function redock() {
  el.classList.remove('pk-loose');
  el.style.left = el.style.top = el.style.bottom = el.style.transform = '';
  try { localStorage.removeItem(POS_KEY); } catch { /* private mode */ }
}

function savePos() {
  if (!el.classList.contains('pk-loose')) return;
  try { localStorage.setItem(POS_KEY, JSON.stringify({ left: el.style.left, top: el.style.top })); } catch { /* private mode */ }
}

// Restoring is clamped to the CURRENT viewport, not the one it was saved from —
// a position remembered on a wide monitor must not park the keyboard off the
// edge of a laptop, where it can't be dragged back.
function restorePos() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch { /* ignore */ }
  if (!p?.left) return;
  el.classList.add('pk-loose');
  el.style.bottom = 'auto';
  el.style.transform = 'none';
  el.style.left = `${Math.max(0, Math.min(innerWidth - el.offsetWidth, parseInt(p.left, 10) || 0))}px`;
  el.style.top = `${Math.max(0, Math.min(innerHeight - el.offsetHeight, parseInt(p.top, 10) || 0))}px`;
}

// The keycap glyph, uppercased for legibility. `,` stays as it is.
function capLabel(off) {
  const c = KEYCAP[off];
  return c === undefined ? '' : c.length === 1 ? c.toUpperCase() : c;
}

// ── Open / close ─────────────────────────────────────────────────────────────

export function openPianoPanel(msg) {
  // The textgames rung never gets the keyboard — it plays with `play c4 e4 g4`,
  // and the server has already told the player so. Opening a visual surface for
  // someone who asked not to have one is the whole thing that rung exists to stop.
  if (msg.text) return;
  if (!el) build();
  voice = msg.voice || 'piano';
  furnName = msg.name || 'piano';
  el.querySelector('.pk-name').textContent = furnName;
  el.classList.add('active');
  relabel();
  // After `active`, so the panel has a measurable size to clamp against.
  restorePos();
  setLive(true);
}

export function closePianoPanel() {
  if (!el) return;
  setLive(false);
  el.classList.remove('active');
  held.clear();
}

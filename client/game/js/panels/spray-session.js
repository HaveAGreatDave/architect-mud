// THE SPRAY SESSION: putting a piece up, one section at a time, over a 3-D view (ROOM, or the street
// on foot in GLASS).
//
// The can's dialog (spraycan.js) is where the piece is designed. Over a 3-D view, its SPRAY IT
// starts this instead of sending at once: the piece is cut into sections by how long it is (one for
// a short tag, up to six for a full 48 characters), and each section is a short pattern of strokes
// to work with the can: up, down, left, right, and a spin round either way. Drag them with the mouse
// or a finger, or press them on the arrows or WASD. Get one wrong and the can sputters and that
// section starts again; get it right and the section goes on the wall with a hiss.
//
// ⚠ NO WINDOW. Nothing here sits in a box: the strokes, the shake ring, the keys and the piece float
// over the view with a shadow under them, so the wall stays in sight. The strokes are drawn as
// arrows of paint on one canvas (`drawGuide`) that fill in the player's own colour as the drag goes
// along them, and drain if the hand comes off; the keys light the one wanted.
//
// ⚠ THE PICTURE'S, AND IT DECIDES NOTHING. Finishing sends the very `sprayapply` the dialog always
// sent, and the server checks the wall, the can and the paint as it always did; walking away (Esc,
// or the lid) sends nothing and spends nothing. A miss costs time, not paint: how you did is only
// the line at the end.
//
// ⚠ SHAKE IT FIRST. Before the first section the can wants shaking: drag up and down, or press the
// arrows (or WASD) back and forth, until the bearing has done its SHAKES. Each shake is a clack
// (spray-shake), every good one a note up the ring, and the ring runs down if you stop. The can is a
// 3-D one (spray-can-3d.js) with the item's own label on it; it sits in the ring while you shake it
// and goes under the pointer after.
//
// SOUND all the way through, tuned to spray-done's G: a puff each quarter of a stroke (spray-trace,
// brighter as it fills), a ping as it lands (spray-step, the next note of TUNE: the tune is
// spelled out a stroke at a time, as Jet Set Radio does it), a chord root as a section goes on
// (spray-section, I V vi IV), the whistle when it's shaken (spray-ready), and the tune played whole
// with drums, bass and chords when it's done (spray-done, in G major). `cue` moves them; the catalog keeps them in G.
//
// The host is the 3-D view that's up (spray-aim.js): its `preview(canvas)` puts the paint on the
// real wall as it goes (ROOM does; the street shows it here, in the close-up), and `label` names
// the wall.

import { bakeTagText } from './tag-bake.js';
import { sfx } from './minigame-common.js';
import { loadCss } from '../../../shared/dom.js';
import { createCanView } from './spray-can-3d.js';
import { SecondOrder } from '../../../shared/second-order.js';

const CSS = await loadCss(new URL('./spray-session.css', import.meta.url));

const DIRS = ['U', 'R', 'D', 'L'];                   // clockwise on the screen
const GLYPH = { U: '↑', R: '→', D: '↓', L: '←', CW: '↻', CCW: '↺' };
const VEC = { U: [0, -1], R: [1, 0], D: [0, 1], L: [-1, 0] };
const KEY_DIR = { arrowup: 'U', w: 'U', arrowright: 'R', d: 'R', arrowdown: 'D', s: 'D', arrowleft: 'L', a: 'L' };
const STROKE_PX = 56;        // how far a drag goes before it counts as a stroke
const SETTLE_MS = 110;       // a wrong stroke this soon after a right one is the drag overshooting, not a miss
const FILL_MS = 520;         // how long a section takes to go on

const LETTERS_PER = 4;       // a section for every four letters…
const MAX_SECTIONS = 6;      // …up to six

const SHAKES = 10;           // a stroke each way counts one: five good shakes
const SHAKE_PX = 22;         // how far a drag goes before it's a stroke of the shake
const SHAKE_REST_MS = 700;   // stop for longer than this and the ring starts running down…
const SHAKE_DECAY = 1.2;     // …at this many shakes a second

// The tune, in semitones over the catalog's G4. Every stroke that lands plays the next note, so a
// piece spells it out as it goes up, and spray-done plays it back with the band. G major: the call
// (A), the answer up to F# and left hanging (B), the call again, then the turn home (D), which
// spray-done finishes on the high G.
const TUNE = [
  7, 4, 7, 9, 7, 4, 2, 4,      // A  D B D E | D B A B
  2, 4, 7, 4, 9, 7, 11, 7,     // B  A B D B | E D F# D
  7, 4, 7, 9, 7, 4, 2, 4,      // A
  0, 2, 4, 7, 9, 7, 4, 2,      // D  G A B D | E D B A
];
// A section lands on the next chord of I V vi IV (G D Em C): its root in semitones over the G.
const CHORDS = [0, -5, -3, -7];
// The shake climbs the G major arpeggio.
const ARP = [0, 4, 7, 12, 16];

let live = null;

// How many sections a piece of this many letters takes: spaces are free.
export const sectionsFor = (text) => Math.max(1, Math.min(MAX_SECTIONS, Math.ceil(String(text || '').replace(/\s+/g, '').length / LETTERS_PER)));

// The strokes for section `i` of `n`: two to four, the later ones longer, with a spin in some from the
// second on. Never the same arrow twice running, since a drag can't tell two ups from one long one.
export function patternFor(i, n, rnd = Math.random) {
  const len = 2 + Math.min(2, Math.floor((i * 3) / Math.max(1, n)));
  const out = [];
  const spinAt = i > 0 && rnd() < 0.4 ? Math.floor(rnd() * len) : -1;
  for (let k = 0; k < len; k++) {
    if (k === spinAt) { out.push(rnd() < 0.5 ? 'CW' : 'CCW'); continue; }
    let d;
    do d = DIRS[Math.floor(rnd() * 4)]; while (d === out[out.length - 1]);
    out.push(d);
  }
  return out;
}

const turn = (d, by) => DIRS[(DIRS.indexOf(d) + by + 4) % 4];

// A catalog cue moved: `semis` up (its tones only; noise stays put), `bright` octaves on its noise
// filters, `gain` on the whole. Sounds nothing without an audio engine.
function cue(id, { semis = 0, bright = 0, gain = 1 } = {}) {
  try {
    const def = window.SFXCatalog?.get?.(id);
    if (!def?.config) return;
    const r = 2 ** (semis / 12), b = 2 ** bright;
    const move = (l) => {
      if (l.waveform === 'noise') return bright && l.filter ? { ...l, filter: { ...l.filter, freq: Math.min(16000, l.filter.freq * b) } } : l;
      if (!l.freq) return l;
      return { ...l, freq: l.freq * r, ...(l.pitchBend ? { pitchBend: { ...l.pitchBend, to: l.pitchBend.to * r } } : {}) };
    };
    const config = { ...def.config, layers: (def.config.layers || []).map(move) };
    window.AudioEngine?.playSfx({ ...def, config }, gain);
  } catch { /* no audio */ }
}

// A small seeded roll, so a stroke's speckles and drips stay put from frame to frame.
function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

/**
 * Put a piece up. `text`, `runs` and `face` are the dialog's; `host` is the 3-D view's spray stage
 * (spray-aim.js); `can` is the dialog's (`can.label` dresses the 3-D can); `onDone` sends the tag,
 * `onCancel` is told when the lid goes back on.
 */
export function runSpraySession({ text, runs = null, face = null, host = null, can = null, onDone, onCancel }) {
  endSpraySession();
  ensureStyles();
  // as the host's wall will have it if it says (ROOM rolls the letterform off the room, as the server's variant
  // does); else as the can's preview has it
  let piece = null;
  try { piece = host?.bake?.(text, runs, face) || null; } catch { piece = null; }
  piece ||= bakeTagText(text, runs, '#b8f03a', 0, 0, 0, 'throw', face || 'bubble', false);
  if (!piece) { onDone?.(); return; }
  const N = sectionsFor(text);
  const patterns = Array.from({ length: N }, (_, i) => patternFor(i, N));
  const ink = inkOf(runs), glow = uiInk(ink);

  const root = document.createElement('div');
  root.id = 'spray-session';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Spraying the piece');
  root.style.setProperty('--ss-ink', glow);
  root.innerHTML = `<canvas class="ss-mist"></canvas>
    <div class="ss-stage">
      <div class="ss-head"><b>PUTTING IT UP</b><span class="ss-where"></span></div>
      <canvas class="ss-wall"></canvas>
      <div class="ss-pips"></div>
      <div class="ss-shake" role="progressbar" aria-label="shaken" aria-valuemin="0" aria-valuemax="100">
        <canvas class="ss-ring"></canvas>
        <canvas class="ss-can3d" aria-label="the can"></canvas>
        <i class="ss-chev up"></i><i class="ss-chev down"></i>
      </div>
      <canvas class="ss-guide" aria-hidden="true"></canvas>
      <div class="ss-steps" aria-live="polite"></div>
      <div class="ss-say"></div>
      <div class="ss-hint" aria-hidden="true">
        <span class="ss-drag"><i></i></span>
        <span class="ss-or">or</span>
        <span class="ss-keys"><b data-d="U">W</b><b data-d="L">A</b><b data-d="D">S</b><b data-d="R">D</b></span>
        <span class="ss-spin">round once</span>
      </div>
    </div>
    <button type="button" class="ss-lid"><b>Esc</b>lid on</button>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  $('.ss-where').textContent = host?.label ? host.label : '';
  // a host that paints the real wall as it goes (ROOM) keeps that wall in sight: the close-up is only the ghost
  if (host?.preview) root.classList.add('live');
  const keyEl = Object.fromEntries([...root.querySelectorAll('.ss-keys b')].map((b) => [b.dataset.d, b]));

  // the close-up: the piece as a ghost, and what's gone on so far (on the wall's own ground off ROOM)
  const wallC = $('.ss-wall'), W = piece.width, H = piece.height;
  const isLive = !!host?.preview;
  wallC.width = W + 80; wallC.height = H + 60;
  const wg = wallC.getContext('2d');
  const ground = isLive ? null : paintGround(wallC.width, wallC.height, host?.ground || 'plaster');
  const mask = document.createElement('canvas'); mask.width = W; mask.height = H;
  const mg = mask.getContext('2d');
  const shown = document.createElement('canvas'); shown.width = W; shown.height = H;
  const sg = shown.getContext('2d');
  const bounds = Array.from({ length: N + 1 }, (_, i) => Math.round((i / N) * W));

  // the mist over the whole screen, round the can as it moves
  const mist = $('.ss-mist'), mctx = mist.getContext('2d');
  const sizeMist = () => { mist.width = innerWidth; mist.height = innerHeight; };
  sizeMist();
  const motes = [];

  const S = { sec: 0, step: 0, spin: null, misses: 0, lastOk: 0, filling: null, done: false, held: null, raf: 0, pointer: null, consumed: new Set(),
    phase: 'shake', cx: innerWidth / 2, cy: innerHeight * 0.42, kx: 0, ky: 0, last: performance.now(),
    prog: 0, q: 0, note: 0, missAt: -1e9, sayT: 0, cells: [], enterAt: 0, doneAt: 0 };
  // the shake: `n` shakes so far (it runs down), the stroke under way and where it's got to, and
  // where the drag took hold (`grab`) so the can moves with the hand; `lvl` is good shakes, for the notes
  const K = { n: 0, dir: 0, ext: 0, lastKey: null, lastAt: 0, kick: 0, grab: null, pull: 0, lvl: 0, shown: 0 };
  root.classList.add('shaking');
  live = { root, close: (sent) => finish(sent) };

  // ── the close-up ──
  function compose(now = performance.now()) {
    sg.clearRect(0, 0, W, H);
    sg.globalCompositeOperation = 'source-over';
    sg.drawImage(piece, 0, 0);
    sg.globalCompositeOperation = 'destination-in';
    sg.drawImage(mask, 0, 0);
    sg.globalCompositeOperation = 'source-over';
    wg.clearRect(0, 0, wallC.width, wallC.height);
    if (ground) wg.drawImage(ground, 0, 0);
    // the ghost: a stencil of the piece, pale on a real wall, a glow line over the room
    wg.save(); wg.globalAlpha = isLive ? 0.3 : 0.16; wg.filter = 'grayscale(1) brightness(1.8)'; wg.drawImage(piece, 40, 30); wg.restore();
    // the section being worked: a band of light behind it and a bar of paint under it
    if (!S.done && S.phase === 'spray') {
      const x0 = 40 + bounds[S.sec], x1 = 40 + bounds[S.sec + 1];
      const pulse = 0.5 + 0.5 * Math.sin(now / 260);
      const band = wg.createLinearGradient(0, 20, 0, H + 44);
      band.addColorStop(0, 'rgba(255,255,255,0)'); band.addColorStop(0.5, hexA(glow, 0.12 + 0.08 * pulse)); band.addColorStop(1, 'rgba(255,255,255,0)');
      wg.fillStyle = band; wg.fillRect(x0, 20, x1 - x0, H + 24);
      wg.save(); wg.strokeStyle = glow; wg.lineCap = 'round'; wg.lineWidth = 5; wg.shadowColor = glow; wg.shadowBlur = 10 + 8 * pulse;
      wg.beginPath(); wg.moveTo(x0 + 8, H + 46); wg.lineTo(x1 - 8, H + 46); wg.stroke(); wg.restore();
    }
    wg.drawImage(shown, 40, 30);
  }

  function pips() {
    $('.ss-pips').innerHTML = patterns.map((_, i) => `<i class="${i < S.sec || S.done ? 'on' : i === S.sec && S.phase === 'spray' ? 'now' : ''}"></i>`).join('');
  }
  // the strokes in words, for a screen reader; the guide is the picture of them
  function steps() {
    const p = patterns[S.sec] || [];
    $('.ss-steps').textContent = S.done || S.phase !== 'spray' ? '' : `Section ${S.sec + 1} of ${N}: ${p.map((d, i) => (i < S.step ? '✓' : GLYPH[d])).join(' ')}`;
    hint();
  }
  // the keys: the one wanted lit; a spin goes round them; the shake rocks W and S
  function hint() {
    const want = S.phase === 'spray' && !S.done && !S.filling ? patterns[S.sec]?.[S.step] : null;
    const keys = $('.ss-keys'), drag = $('.ss-drag');
    keys.classList.toggle('cw', want === 'CW'); keys.classList.toggle('ccw', want === 'CCW');
    root.classList.toggle('spinning', want === 'CW' || want === 'CCW');
    for (const [d, b] of Object.entries(keyEl)) b.classList.toggle('want', want === d);
    const [mx, my] = VEC[want] || [0, 0];
    drag.style.setProperty('--mx', mx); drag.style.setProperty('--my', my);
    drag.dataset.spin = want === 'CW' ? 'cw' : want === 'CCW' ? 'ccw' : '';
  }
  function say(t, cls = '') {
    const el = $('.ss-say'); el.textContent = t; el.className = 'ss-say ' + cls;
    el.classList.remove('in'); void el.offsetWidth; if (t) el.classList.add('in');
    clearTimeout(S.sayT);
    if (t && cls !== 'good') S.sayT = setTimeout(() => el.classList.remove('in'), 1900);
  }
  function flashKey(d, cls) {
    const b = keyEl[d]; if (!b) return;
    b.classList.remove('hit', 'bad'); void b.offsetWidth; b.classList.add(cls);
  }

  // ── the strokes ──
  function miss() {
    S.misses++; S.step = 0; S.spin = null; S.prog = 0; S.q = 0; S.missAt = performance.now();
    for (const c of S.cells) c.doneAt = 0;     // the paint drains back off the strokes
    sfx('spray-sputter');
    say(['It spits. Again.', 'Wrong way. From the top.', 'Drips. Go again.', 'The nozzle coughs.'][S.misses % 4], 'bad');
    steps();
  }

  function stepDone() {
    const at = S.step;
    const c = S.cells[at];
    if (c) { c.doneAt = performance.now(); c.pop = 1; }
    S.step++; S.spin = null; S.lastOk = performance.now(); S.prog = 0; S.q = 0;
    cellBurst(at, 16);
    const semis = TUNE[S.note++ % TUNE.length];
    if (S.step >= patterns[S.sec].length) { cue('spray-step', { semis, gain: 0.7 }); fillSection(); return; }
    cue('spray-step', { semis });
    steps();
  }

  // a quarter more of the stroke under way: a puff, brighter the further it's got
  function progressed(p) {
    const q = Math.max(0, Math.min(3, Math.floor(p * 4)));
    if (q > S.q) { cue('spray-trace', { bright: q * 0.3, gain: 0.55 + q * 0.15 }); S.q = q; }
  }

  function input(d, from) {
    if (S.done || S.filling || S.phase !== 'spray' || performance.now() < (S.calm || 0)) return;
    const want = patterns[S.sec][S.step], now = performance.now();
    if (want === 'CW' || want === 'CCW') {
      const by = want === 'CW' ? 1 : -1;
      if (!S.spin) { S.spin = { last: d, n: 1 }; S.lastOk = now; cue('spray-trace', { gain: 0.7 }); flashKey(d, 'hit'); steps(); return; }
      if (d === turn(S.spin.last, by)) {
        S.spin.last = d; S.spin.n++; S.lastOk = now; flashKey(d, 'hit');
        if (S.spin.n >= 4) { stepDone(); return; }
        cue('spray-trace', { bright: S.spin.n * 0.3, gain: 0.7 + S.spin.n * 0.1 });
        steps(); return;
      }
      if (d === S.spin.last || (from === 'drag' && now - S.lastOk < SETTLE_MS)) return;
      flashKey(d, 'bad'); miss(); return;
    }
    if (d === want) { flashKey(d, 'hit'); stepDone(); return; }
    if (from === 'drag' && now - S.lastOk < SETTLE_MS) return;
    flashKey(d, 'bad'); miss();
  }

  // a section going on: blobs of paint swept across it, back and forth like an arm
  function fillSection() {
    const x0 = bounds[S.sec], x1 = bounds[S.sec + 1];
    S.filling = { x0, x1, t0: performance.now() };
    sfx('spray-fill');
    cue('spray-section', { semis: CHORDS[S.sec % CHORDS.length] });
    steps();
    say('');
  }
  function fillTick(now) {
    const F = S.filling;
    const k = Math.min(1, (now - F.t0) / FILL_MS);
    const r = H * 0.16;
    for (let i = 0; i < 26; i++) {
      const x = F.x0 + (F.x1 - F.x0) * Math.min(1, k * 1.15) * Math.random() + (Math.random() - 0.5) * r;
      const y = H * (0.5 + 0.55 * Math.sin(now / 70 + i) * Math.random());
      const g = mg.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,0.9)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      mg.fillStyle = g; mg.fillRect(x - r, y - r, r * 2, r * 2);
    }
    if (k >= 1) {
      mg.fillStyle = '#000'; mg.fillRect(F.x0, 0, F.x1 - F.x0, H);
      S.filling = null;
      S.sec++; S.step = 0; S.spin = null; S.prog = 0; S.q = 0;
      host?.preview?.(shownFor(), true, text.length);
      if (S.sec >= N) { done(); return; }
      newCells();
      pips(); steps();
    }
  }
  // the painted canvas as it stands, for the host's wall
  const shownFor = () => { compose(); return shown; };

  function done() {
    S.done = true; S.doneAt = performance.now();
    compose(); pips(); steps();
    sfx('spray-done');
    say(S.misses === 0 ? 'Clean. Not a drip on it.' : S.misses <= 2 ? 'A bit of drip. It reads.' : "It'll do. Nobody's grading.", 'good');
    root.classList.add('finished');
    const r = wallC.getBoundingClientRect();
    for (let i = 0; i < 5; i++) burst(r.left + r.width * (0.15 + 0.7 * Math.random()), r.top + r.height * (0.3 + 0.4 * Math.random()), 14);
    setTimeout(() => finish(true), 1100);
  }

  function finish(sent) {
    if (!live || live.root !== root) return;
    live = null;
    cancelAnimationFrame(S.raf);
    clearTimeout(S.sayT);
    S.held?.release?.();
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('resize', sizeMist);
    view.dispose();
    root.remove();
    if (sent) { host?.done?.(); onDone?.(); } else { host?.preview?.(null); onCancel?.(); }
  }

  // ── the shake ──
  // A stroke of the shake is a drag of SHAKE_PX one way after going the other; the first counts too.
  function shakeMove(y) {
    if (K.dir === 0) { if (Math.abs(y - K.ext) >= SHAKE_PX) { K.dir = Math.sign(y - K.ext); K.ext = y; shook(K.dir); } return; }
    if ((y - K.ext) * K.dir > 0) { K.ext = y; return; }            // still going the same way
    if (Math.abs(y - K.ext) >= SHAKE_PX) { K.dir = -K.dir; K.ext = y; shook(K.dir); }
  }
  // from the keys it's back and forth: a key that isn't the last one pressed
  function shakeKey(d) {
    if (d === K.lastKey) return;
    K.lastKey = d;
    shook(d === 'U' || d === 'L' ? -1 : 1);
  }
  function shook(dir) {
    if (S.phase !== 'shake') return;
    K.n = Math.min(SHAKES, K.n + 1); K.lastAt = performance.now(); K.kick = -dir;
    sfx('spray-shake');
    const chev = $(dir < 0 ? '.ss-chev.up' : '.ss-chev.down');
    chev.classList.remove('hit'); void chev.offsetWidth; chev.classList.add('hit');
    // a good shake (one each way) is a note up the ring
    const lvl = Math.floor(K.n / 2);
    if (lvl > K.lvl && K.n < SHAKES) cue('spray-step', { semis: ARP[Math.min(ARP.length - 1, lvl - 1)], gain: 0.4 });
    K.lvl = lvl;
    meter();
    if (K.n >= SHAKES) shaken();
  }
  function meter() {
    $('.ss-shake').setAttribute('aria-valuenow', String(Math.round((K.n / SHAKES) * 100)));
  }
  // shaken enough: a squirt to clear the nozzle, and the can goes in your hand
  function shaken() {
    S.phase = 'spray';
    // the hand still shaking isn't a stroke: the drag under way ends here, and the next third of a second is ignored
    S.pointer = null; K.grab = null; S.calm = performance.now() + 350;
    const rr = $('.ss-shake').getBoundingClientRect();
    root.classList.remove('shaking');
    root.classList.add('spraying');
    if (view.ok) { canC.classList.add('cursor'); root.appendChild(canC); }
    cue('spray-ready');
    burst(rr.left + rr.width / 2, rr.top + rr.height / 2, 40);
    say(N > 1 ? `That'll do. ${N} sections. Go.` : "That'll do. Go.", 'go');
    newCells();
    pips(); steps();
  }

  // ── input ──
  function onKey(e) {
    const k = String(e.key || '').toLowerCase();
    // (once it's finished it's going up: the lid can't go back on a piece that's on the wall)
    if (k === 'escape') { e.preventDefault(); e.stopImmediatePropagation(); if (!S.done) finish(false); return; }
    const d = KEY_DIR[k];
    // the arrows and WASD are this panel's while it's up, and so is everything else: the room behind
    // mustn't walk while you're at the wall
    e.preventDefault(); e.stopImmediatePropagation();
    if (!d || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    S.consumed.add(k);
    if (S.phase === 'shake') { flashKey(d, 'hit'); shakeKey(d); return; }
    // a stroke from the keys: the can jumps the way it went, and the paint comes out of the nozzle
    S.kx = d === 'L' ? -26 : d === 'R' ? 26 : 0; S.ky = d === 'U' ? -26 : d === 'D' ? 26 : 0;
    burst(S.cx + S.kx, S.cy + S.ky, 18);
    input(d, 'key');
  }
  // a key let go that this panel took is this panel's; one held from before goes through, or the walk behind
  // never hears it come up and keeps walking
  function onKeyUp(e) {
    const k = String(e.key || '').toLowerCase();
    if (S.consumed.delete(k)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('resize', sizeMist);
  $('.ss-lid').addEventListener('click', () => finish(false));

  root.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    root.setPointerCapture?.(e.pointerId);
    S.pointer = { x: e.clientX, y: e.clientY, last: null, id: e.pointerId };
    if (S.phase === 'shake') { K.dir = 0; K.ext = e.clientY; K.grab = e.clientY; K.pull = 0; return; }
    const def = window.SFXCatalog?.get?.('spray-hold');
    try { S.held = def ? window.AudioEngine?.playSfx(def, 1, { sustain: true, maxHold: 20 }) : null; } catch { S.held = null; }
  });
  root.addEventListener('pointermove', (e) => {
    canAt(e.clientX, e.clientY);
    const P = S.pointer;
    if (!P || P.id !== e.pointerId) return;
    if (S.phase === 'shake') { if (K.grab != null) K.pull = (K.grab - e.clientY) / 45; shakeMove(e.clientY); return; }
    burst(e.clientX, e.clientY, 4);
    const dx = e.clientX - P.x, dy = e.clientY - P.y;
    // how far along the wanted stroke the drag has got, for the fill and the puffs
    S.prog = alongWant(dx, dy);
    // (a spin puffs a quarter at a time, in `input`)
    if (!/^C/.test(patterns[S.sec]?.[S.step] || '')) progressed(S.prog);
    if (Math.max(Math.abs(dx), Math.abs(dy)) < STROKE_PX) return;
    const d = Math.abs(dx) > Math.abs(dy) * 1.2 ? (dx > 0 ? 'R' : 'L') : Math.abs(dy) > Math.abs(dx) * 1.2 ? (dy > 0 ? 'D' : 'U') : null;
    P.x = e.clientX; P.y = e.clientY;
    S.prog = 0;
    // one long drag is one stroke: the same way again only counts after a turn or a lift
    if (!d || d === P.last) return;
    P.last = d;
    input(d, 'drag');
  });
  const lift = (e) => { if (S.pointer?.id === e.pointerId) { S.pointer = null; K.grab = null; S.prog = 0; S.q = 0; S.held?.release?.(); S.held = null; } };
  root.addEventListener('pointerup', lift);
  root.addEventListener('pointercancel', lift);

  // A drag's progress along the stroke wanted, 0 to 1. A spin's next quarter is any turn the right way
  // round, or any way at all for its first.
  function alongWant(dx, dy) {
    if (S.phase !== 'spray' || S.done || S.filling) return 0;
    const want = patterns[S.sec]?.[S.step];
    const part = (d) => {
      const [vx, vy] = VEC[d];
      const along = dx * vx + dy * vy, across = Math.abs(dx * vy - dy * vx);
      return along > 0 && along > across * 0.8 ? Math.min(1, along / STROKE_PX) : 0;
    };
    if (want === 'CW' || want === 'CCW') {
      const f = S.spin ? part(turn(S.spin.last, want === 'CW' ? 1 : -1)) : Math.max(...DIRS.map(part));
      return ((S.spin?.n || 0) + f) / 4;
    }
    return want ? part(want) : 0;
  }

  // ── the guide: the section's strokes as arrows of paint ──
  const guide = $('.ss-guide'), gg = guide.getContext('2d');
  let gW = 0, gH = 0, dpr = 1;
  function newCells() {
    const p = patterns[S.sec] || [];
    S.cells = p.map((d, i) => {
      const roll = rng(S.sec * 31 + i * 7 + 3);
      return { d, x: 0, s: 0, p: 0, pop: 0, doneAt: 0,
        dots: Array.from({ length: 30 }, () => ({ t: roll(), off: roll() * 2 - 1, r: 0.3 + roll() * 0.9 })),
        drips: Array.from({ length: 2 }, () => ({ t: 0.2 + roll() * 0.6, len: 0.08 + roll() * 0.12 })) };
    });
    S.enterAt = performance.now();
  }
  // where a cell is on the screen, for the mist
  function cellBurst(i, n) {
    const c = S.cells[i]; if (!c) return;
    const r = guide.getBoundingClientRect();
    burst(r.left + c.x, r.top + gH / 2, n);
  }

  function drawGuide(now, dt) {
    const w = guide.clientWidth, h = guide.clientHeight;
    if (!w || !h) return;
    if (w !== gW || h !== gH) {
      dpr = Math.min(2, globalThis.devicePixelRatio || 1); gW = w; gH = h;
      guide.width = Math.round(w * dpr); guide.height = Math.round(h * dpr);
    }
    gg.setTransform(dpr, 0, 0, dpr, 0, 0);
    gg.clearRect(0, 0, w, h);
    if (S.phase !== 'spray' || !S.cells.length) return;
    const big = Math.min(h * 0.94, 124), small = big * 0.58, gap = small * 0.22;
    const ease = 1 - Math.exp(-dt * 16);
    const target = (i) => (S.filling || S.done ? small * 1.05 : i === S.step ? big : small);
    for (const [i, c] of S.cells.entries()) c.s = c.s ? c.s + (target(i) - c.s) * ease : target(i);
    const total = S.cells.reduce((a, c) => a + c.s, 0) + gap * (S.cells.length - 1);
    // a miss shakes the row and turns the stroke under way red
    const mk = Math.min(1, (now - S.missAt) / 340);
    let x = (w - total) / 2 + (mk < 1 && !still ? Math.sin((now - S.missAt) / 17) * 11 * (1 - mk) : 0);
    // a new section drops in; one going on fades up and out
    const enter = still ? 1 : Math.min(1, (now - S.enterAt) / 260);
    const leave = S.filling ? Math.min(1, (now - S.filling.t0) / FILL_MS) : S.done ? 1 : 0;
    for (const [i, c] of S.cells.entries()) {
      c.x = x + c.s / 2; x += c.s + gap;
      const doneStep = i < S.step || !!S.filling || S.done;
      const want = doneStep ? 1 : i === S.step ? (S.spin ? alongSpin() : S.prog) : 0;
      c.p += (want - c.p) * (1 - Math.exp(-dt * (doneStep ? 22 : 14)));
      c.pop *= Math.exp(-dt * 7);
      const state = doneStep ? 'done' : i === S.step ? 'now' : 'next';
      const a = enter * (1 - leave) * (state === 'next' ? 0.55 : 1);
      if (a <= 0.01) continue;
      const y = h / 2 + (1 - enter) * -14 - leave * 10;
      const s = c.s * (1 + 0.16 * c.pop + 0.12 * leave);
      drawStroke(c, c.x, y, s, state, a, now, state === 'now' && mk < 1);
    }
  }
  // a spin by keys has no drag under way: its progress is just its quarters
  const alongSpin = () => Math.max(S.prog, (S.spin?.n || 0) / 4);

  function drawStroke(c, cx, cy, s, state, alpha, now, bad) {
    const g = gg;
    const lw = s * 0.13;
    const col = bad ? '#ff3b5c' : glow;
    const spin = c.d === 'CW' || c.d === 'CCW';
    const dir = c.d === 'CCW' ? -1 : 1;
    const R = s * 0.27, a0 = -Math.PI / 2 + dir * 0.35, sweep = Math.PI * 1.55;
    const [vx, vy] = VEC[c.d] || [0, 0];
    const half = s * 0.3;
    const tail = [cx - vx * half, cy - vy * half], head = [cx + vx * half * 0.62, cy + vy * half * 0.62];
    // a point along the stroke and the normal there
    const at = (t) => {
      if (spin) { const a = a0 + dir * sweep * t; return [cx + R * Math.cos(a), cy + R * Math.sin(a), Math.cos(a), Math.sin(a)]; }
      return [tail[0] + (head[0] - tail[0]) * t, tail[1] + (head[1] - tail[1]) * t, -vy, vx];
    };
    const trace = (t) => {
      g.beginPath();
      if (spin) g.arc(cx, cy, R, a0, a0 + dir * sweep * t, dir < 0);
      else { g.moveTo(tail[0], tail[1]); const [px, py] = at(t); g.lineTo(px, py); }
    };
    g.save();
    g.globalAlpha = alpha;
    g.lineCap = 'round'; g.lineJoin = 'round';
    // the track: a shadow under it so it reads on any wall, then the stencil
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = lw + 6; trace(1); g.stroke();
    g.strokeStyle = state === 'next' ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.2)'; g.lineWidth = lw; trace(1); g.stroke();
    // the way to go: dashes running along the track
    if (state === 'now') {
      g.save(); g.setLineDash([lw * 0.25, lw * 0.9]); g.lineDashOffset = still ? 0 : -now / 28;
      g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = lw * 0.28; trace(1); g.stroke(); g.restore();
    }
    // the paint, as far as it's got
    const p = Math.max(0, Math.min(1, c.p));
    if (p > 0.005) {
      g.save(); g.strokeStyle = col; g.lineWidth = lw; g.shadowColor = col; g.shadowBlur = lw * (state === 'done' ? 0.9 : 1.4);
      trace(p); g.stroke(); g.restore();
      // the overspray: speckles either side of the line, only as far as the paint
      g.fillStyle = col;
      for (const d of c.dots) {
        if (d.t > p) continue;
        const [px, py, nx, ny] = at(d.t);
        g.globalAlpha = alpha * 0.55;
        g.beginPath(); g.arc(px + nx * d.off * lw * 1.15, py + ny * d.off * lw * 1.15, d.r * lw * 0.16, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = alpha;
      // the wet head of it while it's still going
      if (state === 'now' && p < 1) {
        const [px, py] = at(p);
        const hr = lw * 1.9;
        const hg = g.createRadialGradient(px, py, 0, px, py, hr);
        hg.addColorStop(0, hexA(col, 0.85)); hg.addColorStop(1, hexA(col, 0));
        g.fillStyle = hg; g.beginPath(); g.arc(px, py, hr, 0, Math.PI * 2); g.fill();
      }
    }
    // a stroke that's on runs: drips grow down from it
    if (state === 'done' && c.doneAt && !still) {
      const k = Math.min(1, (now - c.doneAt) / 700);
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = lw * 0.32;
      for (const d of c.drips) {
        const [px, py] = at(d.t), L = s * d.len * k;
        g.beginPath(); g.moveTo(px, py); g.lineTo(px, py + L); g.stroke();
        g.beginPath(); g.arc(px, py + L, lw * 0.24, 0, Math.PI * 2); g.fill();
      }
    }
    // the arrowhead: an outline until the stroke's done, then solid paint
    const [ex, ey] = spin ? at(1) : [cx + vx * half, cy + vy * half];
    let ux, uy;
    if (spin) { const a = a0 + dir * sweep; ux = -Math.sin(a) * dir; uy = Math.cos(a) * dir; } else { ux = vx; uy = vy; }
    const ah = lw * 1.25, tip = [ex + ux * ah * 0.55, ey + uy * ah * 0.55];
    g.beginPath();
    g.moveTo(tip[0], tip[1]);
    g.lineTo(tip[0] - ux * ah * 1.5 - uy * ah, tip[1] - uy * ah * 1.5 + ux * ah);
    g.lineTo(tip[0] - ux * ah * 1.5 + uy * ah, tip[1] - uy * ah * 1.5 - ux * ah);
    g.closePath();
    if (p >= 0.98 || state === 'done') { g.fillStyle = col; g.shadowColor = col; g.shadowBlur = lw; g.fill(); }
    else { g.lineWidth = Math.max(2, lw * 0.22); g.strokeStyle = state === 'next' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.8)'; g.stroke(); }
    g.restore();
  }

  // ── the ring round the can while it's shaken: five arcs, one a good shake, draining if you stop ──
  const ring = $('.ss-ring'), rg = ring.getContext('2d');
  let rW = 0;
  function drawRing(now, dt) {
    const w = ring.clientWidth;
    if (!w) return;
    if (w !== rW) { rW = w; const d = Math.min(2, globalThis.devicePixelRatio || 1); ring.width = ring.height = Math.round(w * d); rg.setTransform(d, 0, 0, d, 0, 0); }
    K.shown += (K.n - K.shown) * (1 - Math.exp(-dt * 14));
    rg.clearRect(0, 0, w, w);
    const c = w / 2, R = w * 0.42, lw = Math.max(5, w * 0.045), segs = SHAKES / 2, gapA = 0.16;
    const span = (Math.PI * 2) / segs;
    rg.lineCap = 'round';
    for (let i = 0; i < segs; i++) {
      const s0 = -Math.PI / 2 + i * span + gapA / 2, s1 = s0 + span - gapA;
      rg.strokeStyle = 'rgba(0,0,0,0.4)'; rg.lineWidth = lw + 5; rg.beginPath(); rg.arc(c, c, R, s0, s1); rg.stroke();
      rg.strokeStyle = 'rgba(255,255,255,0.16)'; rg.lineWidth = lw; rg.beginPath(); rg.arc(c, c, R, s0, s1); rg.stroke();
      const f = Math.max(0, Math.min(1, K.shown / 2 - i));
      if (f > 0.01) {
        rg.save(); rg.strokeStyle = glow; rg.shadowColor = glow; rg.shadowBlur = lw * (f >= 1 ? 1.6 : 1);
        rg.beginPath(); rg.arc(c, c, R, s0, s0 + (s1 - s0) * f); rg.stroke(); rg.restore();
      }
    }
    // the bearing, as a dot going round inside the ring with the last shake
    if (!still && K.n > 0) {
      const a = -Math.PI / 2 + ((K.shown / SHAKES) * Math.PI * 2);
      rg.fillStyle = 'rgba(255,255,255,0.85)';
      rg.beginPath(); rg.arc(c + Math.cos(a) * (R - lw * 1.6), c + Math.sin(a) * (R - lw * 1.6), lw * 0.32, 0, Math.PI * 2); rg.fill();
    }
  }

  // the can: the 3-D one, in the ring while you shake it and under the pointer after; the flat CSS one
  // where there's no WebGL
  const canC = $('.ss-can3d');
  const view = createCanView(canC, can?.label);
  if (!view.ok) root.classList.add('flatcan');
  const canEl = document.createElement('div');
  canEl.className = 'ss-can';
  root.appendChild(canEl);
  canEl.hidden = true;
  function canAt(x, y) {
    S.cx = x; S.cy = y;
    if (view.ok) return;
    canEl.style.transform = `translate(${x}px, ${y}px)`; canEl.hidden = S.phase === 'shake';
  }
  // how it's held: bobbing on a spring while it's shaken, tipped toward the wall in the hand
  const bob = new SecondOrder(5.5, 0.32, 1.8, 0);
  const sway = new SecondOrder(3, 0.5, 0, 0);
  const still = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  let nozzle = [0, 0];
  function drawCan(now, dt) {
    if (!view.ok) return;
    if (S.phase === 'shake') {
      // a drag moves it with the hand; a key flicks it and it springs back
      const want = K.grab != null ? Math.max(-1.4, Math.min(1.4, K.pull)) : now - K.lastAt < 110 ? K.kick * 0.9 : 0;
      const y = bob.update(dt, want);
      view.render({ yaw: still ? 0 : 0.85 * Math.sin(now / 1400), roll: y * 0.06, lift: y });
      return;
    }
    S.kx *= 0.85; S.ky *= 0.85;
    const r = sway.update(dt, Math.max(-0.4, Math.min(0.4, S.kx / 90)));
    nozzle = view.render({ yaw: 2.55, roll: 0.5 - r, pitch: -0.3 }) || nozzle;
    canC.style.transform = `translate(${S.cx + S.kx - nozzle[0]}px, ${S.cy + S.ky - nozzle[1]}px)`;
  }

  function burst(x, y, n) {
    for (let i = 0; i < n; i++) motes.push({ x, y, vx: (Math.random() - 0.5) * 2.4, vy: (Math.random() - 0.5) * 2.4 - 0.4, r: 2 + Math.random() * 7, a: 0.5, c: ink });
    if (motes.length > 600) motes.splice(0, motes.length - 600);
  }

  function frame(now) {
    S.raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - S.last) / 1000)); S.last = now;
    if (S.filling) fillTick(now);
    if (S.phase === 'shake' && K.n > 0 && now - K.lastAt > SHAKE_REST_MS) {
      K.n = Math.max(0, K.n - SHAKE_DECAY * dt); K.lvl = Math.floor(K.n / 2); meter();
    }
    drawCan(now, dt);
    if (S.phase === 'shake') drawRing(now, dt); else drawGuide(now, dt);
    compose(now);
    mctx.clearRect(0, 0, mist.width, mist.height);
    for (let i = motes.length - 1; i >= 0; i--) {
      const m = motes[i];
      m.x += m.vx; m.y += m.vy; m.r += 0.35; m.a *= 0.94;
      if (m.a < 0.02) { motes.splice(i, 1); continue; }
      mctx.globalAlpha = m.a; mctx.fillStyle = m.c;
      mctx.beginPath(); mctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); mctx.fill();
    }
    mctx.globalAlpha = 1;
  }

  say('Shake it first.', 'go');
  meter(); pips(); steps(); compose();
  host?.preview?.(shown, true, text.length);
  S.raf = requestAnimationFrame(frame);
}

/** Put the lid back on whatever session is up: nothing is sent. */
export function endSpraySession() { live?.close(false); }
export const spraySessionUp = () => !!live;

// The colour of the mist: the first colour the player painted, or the can's own green.
function inkOf(runs) {
  for (const r of runs || []) if (/^#[0-9a-f]{6}$/i.test(r?.c || '')) return r.c;
  return '#b8f03a';
}
const rgbOf = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const hexA = (hex, a) => { const [r, g, b] = rgbOf(hex); return `rgba(${r},${g},${b},${a})`; };
// The paint as the guide draws it: the player's colour, lifted toward white if it's too dark to see
// glowing over a dim room.
function uiInk(hex) {
  const [r, g, b] = rgbOf(hex);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum >= 0.35) return hex;
  const k = Math.min(0.75, (0.35 - lum) / 0.35 + 0.15);
  const mix = (v) => Math.round(v + (255 - v) * k).toString(16).padStart(2, '0');
  return `#${mix(r)}${mix(g)}${mix(b)}`;
}

// The wall behind the close-up: plaster indoors, brick on the street. Painted once, noise and a few lines.
function paintGround(w, h, kind) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const brick = kind === 'brick';
  g.fillStyle = brick ? '#5a3a30' : '#a9a49a';
  g.fillRect(0, 0, w, h);
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * (brick ? 26 : 16); d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  if (brick) {
    g.strokeStyle = 'rgba(40,30,26,0.75)'; g.lineWidth = 3;
    const bh = 22, bw = 58;
    for (let y = 0, row = 0; y < h; y += bh, row++) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      for (let x = (row % 2) * bw / 2; x < w; x += bw) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + bh); g.stroke(); }
    }
  } else {
    g.fillStyle = 'rgba(0,0,0,0.06)';
    for (let i = 0; i < 18; i++) g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 60, 1);
  }
  // light from above, as a wall in a room has it
  const sh = g.createLinearGradient(0, 0, 0, h);
  sh.addColorStop(0, 'rgba(255,255,255,0.06)'); sh.addColorStop(1, 'rgba(0,0,0,0.22)');
  g.fillStyle = sh; g.fillRect(0, 0, w, h);
  return c;
}

function ensureStyles() {
  if (document.getElementById('spray-session-styles')) return;
  const st = document.createElement('style');
  st.id = 'spray-session-styles';
  st.textContent = CSS;
  document.head.appendChild(st);
}

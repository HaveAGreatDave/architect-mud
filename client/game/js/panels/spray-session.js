// THE SPRAY SESSION: putting a piece up, one section at a time, over a 3-D view (ROOM, or the street
// on foot in GLASS).
//
// The can's dialog (spraycan.js) is where the piece is designed. Over a 3-D view, its SPRAY IT
// starts this instead of sending at once: the piece is cut into sections by how long it is (one for
// a short tag, up to six for a full 48 characters), and each section is a short pattern of strokes
// to work with the can, shown as arrows: up, down, left, right, and a spin round either way. Drag
// them with the mouse or a finger, or press them on the arrows or WASD. Get one wrong and the can
// sputters and that section starts again; get it right and the section goes on the wall with a hiss.
//
// ⚠ THE PICTURE'S, AND IT DECIDES NOTHING. Finishing sends the very `sprayapply` the dialog always
// sent, and the server checks the wall, the can and the paint as it always did; walking away (Esc,
// or the lid) sends nothing and spends nothing. A miss costs time, not paint: how you did is only
// the line at the end.
//
// The host is the 3-D view that's up (spray-aim.js): its `preview(canvas)` puts the paint on the
// real wall as it goes (ROOM does; the street shows it here, in the close-up), and `label` names
// the wall in the corner.

import { bakeTagText } from './tag-bake.js';
import { sfx } from './minigame-common.js';
import { loadCss } from '../../../shared/dom.js';

const CSS = await loadCss(new URL('./spray-session.css', import.meta.url));

const DIRS = ['U', 'R', 'D', 'L'];                   // clockwise on the screen
const GLYPH = { U: '↑', R: '→', D: '↓', L: '←', CW: '↻', CCW: '↺' };
const KEY_DIR = { arrowup: 'U', w: 'U', arrowright: 'R', d: 'R', arrowdown: 'D', s: 'D', arrowleft: 'L', a: 'L' };
const STROKE_PX = 34;        // how far a drag goes before it counts as a stroke
const SETTLE_MS = 110;       // a wrong stroke this soon after a right one is the drag overshooting, not a miss
const FILL_MS = 520;         // how long a section takes to go on

const LETTERS_PER = 4;       // a section for every four letters…
const MAX_SECTIONS = 6;      // …up to six

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

/**
 * Put a piece up. `text`, `runs` and `face` are the dialog's; `host` is the 3-D view's spray stage
 * (spray-aim.js); `onDone` sends the tag, `onCancel` is told when the lid goes back on.
 */
export function runSpraySession({ text, runs = null, face = null, host = null, onDone, onCancel }) {
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

  const root = document.createElement('div');
  root.id = 'spray-session';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Spraying the piece');
  root.innerHTML = `<div class="ss-panel">
      <div class="ss-head"><b>◗ PUTTING IT UP</b><span class="ss-where"></span><span class="ss-pips"></span></div>
      <canvas class="ss-wall"></canvas>
      <div class="ss-steps" aria-live="polite"></div>
      <div class="ss-say"></div>
      <div class="ss-foot"><span>Drag the strokes, or press them on the arrows or WASD. A ↻ is a spin: round once, any start.</span>
        <button type="button" class="ss-lid">put the lid back on (Esc)</button></div>
    </div>
    <canvas class="ss-mist"></canvas>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  $('.ss-where').textContent = host?.label ? ` · ${host.label}` : '';
  // a host that paints the real wall as it goes (ROOM) keeps that wall in sight: the close-up shrinks to a guide
  if (host?.preview) root.classList.add('live');

  // the close-up: the wall, the piece as a ghost, and what's gone on so far
  const wallC = $('.ss-wall'), W = piece.width, H = piece.height;
  wallC.width = W + 80; wallC.height = H + 60;
  const wg = wallC.getContext('2d');
  const ground = paintGround(wallC.width, wallC.height, host?.ground || 'plaster');
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

  const S = { sec: 0, step: 0, spin: null, misses: 0, lastOk: 0, filling: null, done: false, held: null, raf: 0, pointer: null, consumed: new Set() };
  live = { root, close: (sent) => finish(sent) };

  function compose() {
    sg.clearRect(0, 0, W, H);
    sg.globalCompositeOperation = 'source-over';
    sg.drawImage(piece, 0, 0);
    sg.globalCompositeOperation = 'destination-in';
    sg.drawImage(mask, 0, 0);
    sg.globalCompositeOperation = 'source-over';
    wg.clearRect(0, 0, wallC.width, wallC.height);
    wg.drawImage(ground, 0, 0);
    wg.save(); wg.globalAlpha = 0.16; wg.filter = 'grayscale(1) brightness(1.6)'; wg.drawImage(piece, 40, 30); wg.restore();
    // the section being worked, outlined
    if (!S.done) {
      const x0 = 40 + bounds[S.sec], x1 = 40 + bounds[S.sec + 1];
      wg.save(); wg.strokeStyle = 'rgba(184,240,58,0.55)'; wg.setLineDash([6, 5]); wg.lineWidth = 2;
      wg.strokeRect(x0 + 1, 24, x1 - x0 - 2, H + 12); wg.restore();
    }
    wg.drawImage(shown, 40, 30);
  }

  function pips() {
    $('.ss-pips').innerHTML = patterns.map((_, i) => `<i class="${i < S.sec || S.done ? 'on' : i === S.sec ? 'now' : ''}"></i>`).join('');
  }
  function steps() {
    const p = patterns[S.sec] || [];
    $('.ss-steps').innerHTML = S.done ? '' : p.map((d, i) => {
      const cls = i < S.step ? 'done' : i === S.step ? 'now' : '';
      const prog = i === S.step && S.spin ? ` style="--p:${S.spin.n / 4}"` : '';
      return `<span class="ss-step ${cls} ${d.length > 1 ? 'spin' : ''}"${prog}>${GLYPH[d]}</span>`;
    }).join('');
  }
  const say = (t, cls = '') => { const el = $('.ss-say'); el.textContent = t; el.className = 'ss-say ' + cls; };

  function miss() {
    S.misses++; S.step = 0; S.spin = null;
    sfx('spray-sputter');
    const el = $('.ss-steps');
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
    clearTimeout(S.shakeT); S.shakeT = setTimeout(() => el.classList.remove('shake'), 420);
    say(['It spits. Again.', 'Wrong way. From the top.', 'Drips. Go again.', 'The nozzle coughs.'][S.misses % 4], 'bad');
    steps();
  }

  function stepDone() {
    S.step++; S.spin = null; S.lastOk = performance.now();
    if (S.step >= patterns[S.sec].length) { fillSection(); return; }
    sfx('spray-tick');
    steps();
  }

  function input(d, from) {
    if (S.done || S.filling) return;
    const want = patterns[S.sec][S.step], now = performance.now();
    if (want === 'CW' || want === 'CCW') {
      const by = want === 'CW' ? 1 : -1;
      if (!S.spin) { S.spin = { last: d, n: 1 }; S.lastOk = now; sfx('spray-tick'); steps(); return; }
      if (d === turn(S.spin.last, by)) {
        S.spin.last = d; S.spin.n++; S.lastOk = now;
        if (S.spin.n >= 4) { stepDone(); return; }
        steps(); return;
      }
      if (d === S.spin.last || (from === 'drag' && now - S.lastOk < SETTLE_MS)) return;
      miss(); return;
    }
    if (d === want) { stepDone(); return; }
    if (from === 'drag' && now - S.lastOk < SETTLE_MS) return;
    miss();
  }

  // a section going on: blobs of paint swept across it, back and forth like an arm
  function fillSection() {
    const x0 = bounds[S.sec], x1 = bounds[S.sec + 1];
    S.filling = { x0, x1, t0: performance.now() };
    sfx('spray-fill');
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
      S.sec++; S.step = 0; S.spin = null;
      host?.preview?.(shownFor(), true, text.length);
      if (S.sec >= N) { done(); return; }
      pips(); steps();
    }
  }
  // the painted canvas as it stands, for the host's wall
  const shownFor = () => { compose(); return shown; };

  function done() {
    S.done = true;
    compose(); pips(); steps();
    sfx('spray-done');
    say(S.misses === 0 ? 'Clean. Not a drip on it.' : S.misses <= 2 ? 'A bit of drip. It reads.' : "It'll do. Nobody's grading.", 'good');
    root.classList.add('finished');
    setTimeout(() => finish(true), 1100);
  }

  function finish(sent) {
    if (!live || live.root !== root) return;
    live = null;
    cancelAnimationFrame(S.raf);
    S.held?.release?.();
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('resize', sizeMist);
    root.remove();
    if (sent) { host?.done?.(); onDone?.(); } else { host?.preview?.(null); onCancel?.(); }
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
    burst(innerWidth / 2, innerHeight * 0.42, 18);
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
    const def = window.SFXCatalog?.get?.('spray-hold');
    try { S.held = def ? window.AudioEngine?.playSfx(def, 1, { sustain: true, maxHold: 20 }) : null; } catch { S.held = null; }
  });
  root.addEventListener('pointermove', (e) => {
    can(e.clientX, e.clientY);
    const P = S.pointer;
    if (!P || P.id !== e.pointerId) return;
    burst(e.clientX, e.clientY, 4);
    const dx = e.clientX - P.x, dy = e.clientY - P.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < STROKE_PX) return;
    const d = Math.abs(dx) > Math.abs(dy) * 1.2 ? (dx > 0 ? 'R' : 'L') : Math.abs(dy) > Math.abs(dx) * 1.2 ? (dy > 0 ? 'D' : 'U') : null;
    P.x = e.clientX; P.y = e.clientY;
    // one long drag is one stroke: the same way again only counts after a turn or a lift
    if (!d || d === P.last) return;
    P.last = d;
    input(d, 'drag');
  });
  const lift = (e) => { if (S.pointer?.id === e.pointerId) { S.pointer = null; S.held?.release?.(); S.held = null; } };
  root.addEventListener('pointerup', lift);
  root.addEventListener('pointercancel', lift);

  // the can on the screen where the pointer is
  const canEl = document.createElement('div');
  canEl.className = 'ss-can';
  root.appendChild(canEl);
  function can(x, y) { canEl.style.transform = `translate(${x}px, ${y}px)`; canEl.hidden = false; }
  canEl.hidden = true;

  function burst(x, y, n) {
    const ink = pieceInk;
    for (let i = 0; i < n; i++) motes.push({ x, y, vx: (Math.random() - 0.5) * 2.4, vy: (Math.random() - 0.5) * 2.4 - 0.4, r: 2 + Math.random() * 7, a: 0.5, c: ink });
    if (motes.length > 600) motes.splice(0, motes.length - 600);
  }
  const pieceInk = inkOf(runs);

  function frame(now) {
    S.raf = requestAnimationFrame(frame);
    if (S.filling) fillTick(now);
    compose();
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

  sfx('spray-rattle');
  say(N > 1 ? `${N} sections. Shake it and go.` : 'Shake it and go.');
  pips(); steps(); compose();
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

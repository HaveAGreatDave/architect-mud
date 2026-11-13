// THE MICROWAVE, PLAYED: the parts of the Kitchen Stage's microwave that need no scene.
//
// kitchen-stage.js runs it (docs/proposals/kitchen-stage.md, "At the microwave"): you open the door,
// put something in, type a time on its keypad and press START, and a comic-book sequence plays (the
// door slams, the camera cuts to the keypad on a hard tilt, a finger creeps in and jabs START) before
// it cooks for exactly the time you set. Here are the keypad's arithmetic, that sequence as a pure
// function of time, and the 2-D lettering drawn over the picture.
//
// ⚠ Nothing here reads the clock, the DOM or the scene: the timeline takes the seconds since START,
// and the drawing takes a 2-D context. scripts/client/microwave-smoke.mjs checks it in node.

export const MAX_SECS = 600;          // the server's own cap (plugins/cooking/index.js microwaveSecs)
const MAX_DIGITS = 4;

// ── the keypad ───────────────────────────────────────────────────────────────────────────────────
// Digits go in from the right, as a microwave's do: 1, 3, 0 reads 1:30. The last two are seconds and
// the rest minutes, so 90 is ninety seconds, as it is on the real thing.
export function padPress(digits, key) {
  const d = String(digits || '');
  if (key === 'C' || key === 'clear') return '';
  if (key === 'back') return d.slice(0, -1);
  if (key === '+30') return toDigits(Math.min(MAX_SECS, padSecs(d) + 30));
  if (/^[0-9]$/.test(key)) {
    if (!d && key === '0') return '';
    return d.length >= MAX_DIGITS ? d : d + key;
  }
  return d;
}
export function padSecs(digits) {
  const d = String(digits || '').replace(/\D/g, '');
  if (!d) return 0;
  return Number(d.slice(-2)) + 60 * Number(d.slice(0, -2) || 0);
}
// As the display shows it: '130' is 1:30, '' is 0:00.
export function padText(digits) {
  const d = String(digits || '').replace(/\D/g, '').padStart(3, '0');
  return `${Number(d.slice(0, -2))}:${d.slice(-2)}`;
}
// Seconds as the keypad would have them typed: 90 is 1:30, so +30 on 1:00 reads 1:30, not 0:90.
export function toDigits(secs) {
  const s = Math.max(0, Math.round(secs)), m = Math.floor(s / 60), r = s % 60;
  return m ? `${m}${String(r).padStart(2, '0')}` : r ? String(r) : '';
}
// A countdown as the display shows it.
export function clockText(secs) {
  const s = Math.max(0, Math.ceil(secs)), m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// ── the sequence ─────────────────────────────────────────────────────────────────────────────────
// Seconds since START. With the door already shut it starts at the cut to the keypad (FROM_SHUT).
export const SEQ = { slam: 0.28, cut: 0.62, creep: 0.65, wind: 1.25, jab: 1.31, back: 1.62, end: 2.6 };
export const FROM_SHUT = 0.6;
// What fires as the sequence passes each beat; kitchen-stage.js plays the sound and does the deed.
export const SEQ_EVENTS = [
  { at: 0, id: 'whoosh' },
  { at: SEQ.slam, id: 'slam' },
  { at: SEQ.cut, id: 'cut' },
  { at: SEQ.jab, id: 'jab' },
  { at: SEQ.back, id: 'back' },
  { at: SEQ.end, id: 'end' },
];
// The events crossed going from t0 (exclusive) to t1 (inclusive). A first call with t0 < 0 takes in 0.
export function eventsBetween(t0, t1) {
  return SEQ_EVENTS.filter((e) => e.at > t0 && e.at <= t1).map((e) => e.id);
}
const ease = (k) => k * k * (3 - 2 * k);
const clamp01 = (k) => Math.max(0, Math.min(1, k));
// Where the sequence is at t: which shot, how open the door is (a share of how open it was), how far
// the finger is out (0 gone, 1 on the key) and whether it trembles, and the lettering on screen.
export function seqAt(t) {
  const shot = t < SEQ.cut ? 'slam' : t < SEQ.back ? 'pad' : 'wide';
  // the door swings shut faster and faster, and bounces once in its frame
  const door = t < SEQ.slam ? 1 - (t / SEQ.slam) ** 2 : t < SEQ.slam + 0.18 ? 0.04 * Math.sin(((t - SEQ.slam) / 0.18) * Math.PI) : 0;
  let finger = 0;
  if (t >= SEQ.creep && t < SEQ.wind) finger = 0.72 * ease(clamp01((t - SEQ.creep) / (SEQ.wind - SEQ.creep)));
  else if (t >= SEQ.wind && t < SEQ.jab) finger = 0.72 + 0.28 * ((t - SEQ.wind) / (SEQ.jab - SEQ.wind));
  else if (t >= SEQ.jab && t < SEQ.back) finger = 1;
  const words = [];
  const span = (from, to) => t >= from && t < to;
  if (span(SEQ.slam, SEQ.slam + 0.62)) words.push({ kind: 'burst', text: 'SLAM!', at: 'door', age: t - SEQ.slam, life: 0.62 });
  if (span(SEQ.creep, SEQ.jab + 0.1)) words.push({ kind: 'caption', text: 'THE MOMENT HAS COME.', age: t - SEQ.creep, life: SEQ.jab + 0.1 - SEQ.creep });
  if (span(SEQ.jab, SEQ.jab + 0.62)) words.push({ kind: 'burst', text: 'BEEP!', at: 'key', age: t - SEQ.jab, life: 0.62, big: true });
  if (span(SEQ.back, SEQ.end)) words.push({ kind: 'hum', text: 'MMMMMMMMM', at: 'top', age: t - SEQ.back, life: SEQ.end - SEQ.back });
  return { shot, door, finger, tremble: t >= SEQ.creep && t < SEQ.jab, words, done: t >= SEQ.end };
}

// What you open the door on, by how the time you set worked out (cook.js finishMicrowave end_state).
export const VERDICT = {
  raw: { text: 'STILL COLD!', fill: '#bfe3ff', ink: '#2b3a63' },
  peak: { text: 'DONE!', fill: '#ffe14a', ink: '#c8323a' },
  over: { text: 'OVERDONE!', fill: '#ffb14a', ink: '#8a3a12' },
  burnt: { text: 'BURNT!!', fill: '#3a3434', ink: '#ff5a1f', smoke: true },
};

// ── the lettering ────────────────────────────────────────────────────────────────────────────────
const FONT = '"Bangers", Impact, "Arial Black", "Saira Condensed", sans-serif';
const INK = '#141018';
// A pop: overshoot in, hold, fade out over the last fifth.
function popOf(age, life) {
  const k = clamp01(age / 0.14), s = k < 1 ? 1.25 * Math.sin(k * Math.PI * 0.5) + (k > 0.8 ? (1 - k) * 0.4 : 0) : 1;
  const a = age > life * 0.8 ? clamp01((life - age) / (life * 0.2)) : 1;
  return { s: Math.max(0.01, s), a };
}

// A jagged starburst behind heavy lettering, popping in. (x, y) in pixels, `size` its radius.
export function drawBurst(g, x, y, size, text, { age = 1, life = 1, fill = '#ffe14a', ink = '#c8323a', seed = 1, rot = -0.12 } = {}) {
  const { s, a } = popOf(age, life);
  if (a <= 0) return;
  g.save();
  g.globalAlpha = a;
  g.translate(x, y);
  g.rotate(rot);
  g.scale(s, s);
  const n = 16;
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const ang = (i / (n * 2)) * Math.PI * 2, j = Math.sin(seed * 12.9898 + i * 78.233) * 0.5 + 0.5;
    const r = i % 2 ? size * (0.62 + 0.08 * j) : size * (0.92 + 0.22 * j);
    g.lineTo(Math.cos(ang) * r * 1.25, Math.sin(ang) * r * 0.85);
  }
  g.closePath();
  g.fillStyle = fill; g.fill();
  g.lineWidth = Math.max(3, size * 0.06); g.strokeStyle = INK; g.lineJoin = 'round'; g.stroke();
  letters(g, text, 0, 0, size * 0.62, ink);
  g.restore();
}

// Outlined, slanted capitals, sized down to fit `w` when given.
function letters(g, text, x, y, px, fill, w = null) {
  let size = px;
  g.font = `900 italic ${size}px ${FONT}`;
  if (w) { const m = g.measureText(text).width; if (m > w) { size *= w / m; g.font = `900 italic ${size}px ${FONT}`; } }
  else { const m = g.measureText(text).width; if (m > px * 4.2) { size *= (px * 4.2) / m; g.font = `900 italic ${size}px ${FONT}`; } }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = Math.max(4, size * 0.16); g.strokeStyle = INK; g.strokeText(text, x, y);
  g.fillStyle = fill; g.fillText(text, x, y);
}

// The narrator's box, top left, as a comic sets the scene: yellow, inked, typed out a letter at a time.
export function drawCaption(g, w, h, text, { age = 1, life = 1 } = {}) {
  const shown = text.slice(0, Math.max(1, Math.floor(age * 40)));
  const px = Math.max(14, Math.round(h * 0.04)), pad = px * 0.6;
  g.save();
  g.globalAlpha = age > life * 0.85 ? clamp01((life - age) / (life * 0.15)) : 1;
  g.font = `700 ${px}px ${FONT}`;
  const tw = g.measureText(text).width, bx = w * 0.04, by = h * 0.1;
  g.fillStyle = '#f6e27a'; g.strokeStyle = INK; g.lineWidth = 3;
  g.fillRect(bx, by, tw + pad * 2, px + pad * 2);
  g.strokeRect(bx, by, tw + pad * 2, px + pad * 2);
  g.fillStyle = INK; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText(shown, bx + pad, by + pad + px / 2);
  g.restore();
}

// The hum: a row of letters bobbing out of step, small and pale over the microwave.
export function drawHum(g, x, y, px, text, { age = 1, life = 1, t = 0 } = {}) {
  const a = Math.min(clamp01(age / 0.2), age > life * 0.7 ? clamp01((life - age) / (life * 0.3)) : 1);
  if (a <= 0) return;
  g.save();
  g.globalAlpha = a * 0.9;
  g.font = `900 italic ${px}px ${FONT}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const step = px * 0.85, x0 = x - (text.length - 1) * step / 2;
  for (let i = 0; i < text.length; i++) {
    const yy = y + Math.sin(t * 22 + i * 1.3) * px * 0.12, xx = x0 + i * step + Math.sin(t * 31 + i) * px * 0.04;
    g.lineWidth = Math.max(3, px * 0.14); g.strokeStyle = INK; g.strokeText(text[i], xx, yy);
    g.fillStyle = '#f6efe0'; g.fillText(text[i], xx, yy);
  }
  g.restore();
}

// Speed lines converging on a point: the sequence's lines go to the key, not the middle of the screen.
export function drawFocusLines(g, w, h, cx, cy, k, t = 0) {
  if (k <= 0.02) return;
  g.save();
  g.strokeStyle = `rgba(20,16,24,${0.55 * k})`;
  g.lineCap = 'round';
  const R0 = Math.min(w, h) * 0.2, R1 = Math.hypot(w, h);
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2 + Math.sin(i * 7.3 + t * 40) * 0.02, r0 = R0 * (1 + 0.5 * (0.5 + 0.5 * Math.sin(i * 3.7 + t * 60)));
    g.lineWidth = 1 + (i % 4);
    g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * R1, cy + Math.sin(a) * R1); g.stroke();
  }
  g.restore();
}

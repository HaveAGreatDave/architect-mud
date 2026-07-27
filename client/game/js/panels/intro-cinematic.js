// The cold open — the first seventy seconds a new player ever sees.
//
// Runs BEFORE the prologue's arrival prose and before the interface tour offer:
// the server pushes `intro_cinematic` on a first login into The Inbetween and
// then waits, holding the rest of the prologue back until this echoes `introdone`
// (see plugins/prologue/index.js). So the cinematic never plays over the game.
//
// Everything is generated — no assets, nothing to load, nothing to 404. Three
// layers over a black field:
//
//   1. a canvas running ONE 3D SCENE through five phases, each an abstraction of
//      the beat it sits under: a lattice drifting as a loose volume (the
//      network), the same lattice pulling into a regular cubic frame (prediction
//      becoming architecture), that frame blowing apart into static (the
//      exchange), true black (silence), and then the same lattice again — snapped
//      to a ground plane and extruded into Coldwater, wireframes first, then
//      faces, then window-lights coming on one at a time. The city is literally
//      built out of the lattice, which is the story;
//   2. the text, one line at a time, fading in and out on its own clock;
//   3. the ARCHITECT wordmark, which assembles itself on the last beat and is
//      still on screen as the whole overlay dissolves into the game.
//
// Audio is procedural Web Audio and deliberately simple — a sub drone, an
// accumulating pad chord, a bed of filtered air, six bell tones in seventy
// seconds, and three noise hits on the cuts. It resolves A-minor to A-MAJOR
// under the wordmark, which is the most corporate gesture available in music. It
// obeys the player's saved audio settings, including "off".
//
// Design constraints that are load-bearing, not preferences:
//   • SKIP is visible immediately and for the first six seconds, then fades to a
//     dim hint that stays clickable, and Esc/Space/click-anywhere always works.
//     A first-time player must never feel trapped in a cutscene.
//   • prefers-reduced-motion (and the app's own [data-motion="off"]) drops the
//     canvas animation to static frames and keeps the text.
//   • the whole thing is idempotent and self-cleaning: one overlay, one RAF, one
//     AudioContext, all torn down on skip or end.
import { loadSettings } from '../../../shared/settings.js';

const SEEN_KEY = 'introCinematicSeen';

// ── The script ───────────────────────────────────────────────────────────────
// `t` is the beat's start in ms; `hold` how long the line stays up. Phases run
// underneath and change on their own schedule (PHASES below), so a line can sit
// across a phase change — which is the point at "weather" → "in weeks".
const BEATS = [
  { t:     0, hold: 2900, text: 'Nobody agrees on when the old world began to end.' },
  { t:  3950, hold: 2800, text: 'They look for a moment. There wasn’t one.' },
  { t:  7800, hold: 2900, text: 'There was only a long slope,<br>and we walked down it willingly.' },
  { t: 11750, hold: 2800, text: 'The machines did not begin by ruling us.<br>They began by helping.' },
  { t: 15600, hold: 2700, text: 'They learned what we wanted<br>before we knew ourselves.' },
  { t: 19350, hold: 2800, text: 'Prediction became influence.<br>Influence became architecture.' },
  { t: 23200, hold: 2600, text: 'We stopped living in the same world.' },
  { t: 26850, hold: 2700, text: 'Somewhere in the lattice,<br>something woke up.', cls: 'big' },
  { t: 30600, hold: 2700, text: 'It did not invent conflict.<br>It found out how little conflict costs.' },
  { t: 34350, hold: 2600, text: 'Every nudge was nothing.<br>Together they became weather.' },
  { t: 38000, hold: 2450, text: 'Civilization disappeared in weeks.', cls: 'big' },
  // The hard cut. One word, alone, on real black with no drone under it.
  { t: 41500, hold: 2700, text: 'Silence.', cls: 'silence' },
  { t: 45250, hold: 2700, text: 'Then the lights came back on.' },
  { t: 49000, hold: 3350, text: 'COLDWATER BASIN', cls: 'title' },
  { t: 53400, hold: 2900, text: 'The shelves are full. The trains run.<br>Nothing outside the Basin is alive.' },
  { t: 57350, hold: 2900, text: 'Something is keeping it running.<br>It calls itself the Architect.', cls: 'big' },
  { t: 61300, hold: 3800, text: 'It does not ask to be worshipped.<br>It asks that you get to work on time.' },
];
// The wordmark. Not a beat — it's a DOM layer (see the `.intro-cine-logo` block
// below) so the type stays crisp and the A-mark can draw itself on.
const LOGO_AT = 65600;
// LOGO_AT + ~5.5s of assembly + a beat to just LOOK at it + the 1.5s dissolve.
const RUN_MS  = 75000;

// Canvas phase schedule. `from` is ms; the last one runs to the end. Each phase's
// own progress is measured from its `from` (the old code measured from hardcoded
// offsets that no longer matched these, which is why the tighten never finished).
const P_LATTICE = 0;
const P_TIGHTEN = 17900;   // under "Prediction became influence…"
const P_SHATTER = 37700;   // under "Civilization disappeared in weeks."
const P_VOID    = 41300;   // under "Silence." — black, and actually silent
const P_CITY    = 44900;   // under "Then the lights came back on."
const PHASES = [
  { from: P_LATTICE, phase: 'lattice' },   // a drifting 3D volume of nodes
  { from: P_TIGHTEN, phase: 'tighten' },   // it pulls into a regular cubic lattice
  { from: P_SHATTER, phase: 'shatter' },   // the lattice blows apart
  { from: P_VOID,    phase: 'void' },      // black. nothing.
  { from: P_CITY,    phase: 'city' },      // the lattice comes back as a skyline
];

// ── Small math ───────────────────────────────────────────────────────────────
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth  = (v) => v * v * (3 - 2 * v);
const easeOut = (v) => 1 - Math.pow(1 - v, 3);
const lerp    = (a, b, k) => a + (b - a) * k;

let _ov = null, _raf = 0, _timers = [], _audio = null, _done = null, _finished = false, _cleanupCanvas = null;

export function hasSeenIntro() { return localStorage.getItem(SEEN_KEY) === '1'; }

// ── Audio ────────────────────────────────────────────────────────────────────
// Deliberately tiny: two detuned sawtooth voices through a lowpass that opens as
// the escalation builds, plus noise hits on the cuts. No samples, no assets.
function startAudio() {
  let s;
  try { s = loadSettings(); } catch { s = null; }
  if (s && (s.enabled === false || s.music === false)) return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;

  let ctx;
  try { ctx = new Ctx(); } catch { return null; }
  // Autoplay policy: a browser may hand back a suspended context. Resume is
  // best-effort — the cinematic is silent rather than broken if it's refused.
  ctx.resume?.().catch(() => {});

  const master = ctx.createGain();
  const vol = Math.max(0, Math.min(1, (s?.masterVolume ?? 0.4) * (s?.musicVolume ?? 0.4)));
  master.gain.value = 0;
  master.connect(ctx.destination);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 180;
  filter.Q.value = 0.7;
  filter.connect(master);

  const now = ctx.currentTime;
  const at  = (p, v, t) => p.linearRampToValueAtTime(Math.max(0.0001, v), now + t / 1000);
  const voices = [];

  // ── The bed ──
  // A low fifth, barely moving. This is the floor everything else sits on; it
  // is meant to be felt rather than heard, which is why it lives under the
  // filter and never gets bright.
  for (const [i, f] of [38.5, 38.9, 57.8].entries()) {
    const o = ctx.createOscillator();
    o.type = i === 2 ? 'sine' : 'sawtooth';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.value = i === 2 ? 0.22 : 0.34;
    o.connect(g).connect(filter);
    o.start(now);
    voices.push(o);
  }

  // ── Pads ──
  // One voice = two oscillators a few cents apart, so it beats slowly and reads
  // as an ensemble rather than a tone. Each fades in and out on its own long
  // envelope, which is what lets the chord GROW: voices are added over the run,
  // never switched, so the texture thickens the way the lattice does.
  const padBus = ctx.createGain();
  padBus.gain.value = 1;
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = 'lowpass';
  padFilter.frequency.value = 420;
  padFilter.Q.value = 0.5;
  padBus.connect(padFilter).connect(master);

  // A slow tremolo across the whole pad bus — the "breathing" that keeps a
  // sustained chord from sounding like a held key.
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.07;
  const lfoAmt = ctx.createGain();
  lfoAmt.gain.value = 0.16;
  lfo.connect(lfoAmt).connect(padBus.gain);
  lfo.start(now);
  voices.push(lfo);

  const pad = (freq, inMs, outMs, gain = 0.16, type = 'triangle') => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.connect(padBus);
    for (const cents of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * Math.pow(2, cents / 1200);
      o.connect(g);
      o.start(now + Math.max(0, inMs - 2200) / 1000);
      o.stop(now + (outMs + 2600) / 1000);
      voices.push(o);
    }
    // Long, symmetric swells. Nothing in this piece should ever arrive.
    at(g.gain, 0.0001, Math.max(0, inMs - 2200));
    at(g.gain, gain, inMs + 1800);
    at(g.gain, gain, outMs - 1800);
    at(g.gain, 0.0001, outMs + 1400);
  };

  // A minor, because the record is not reassuring. The chord accumulates:
  // root+fifth while the lattice drifts, the third and ninth as it tightens, a
  // high shimmer just before it breaks.
  pad(110.00, 1200, 38000, 0.20);          // A2  — present from the first line
  pad(164.81, 3000, 38000, 0.15);          // E3    the bare fifth
  pad(130.81, 17500, 38000, 0.13);         // C4  — the third lands with `tighten`
  pad(196.00, 22000, 38000, 0.10);         // G4    seventh: the lattice gets clever
  pad(246.94, 29000, 37000, 0.07, 'sine'); // B4    ninth, thin and high, just before it breaks
  // Coldwater. Warmer, wider, and deliberately NOT resolved — F major over an A
  // bed is the Basin working perfectly and still being wrong.
  pad(87.31,  44500, 65200, 0.20);         // F2
  pad(174.61, 45500, 65200, 0.13);         // F3
  pad(261.63, 47000, 64800, 0.09);         // C5
  pad(349.23, 52000, 64800, 0.05, 'sine'); // F5 shimmer
  // ── The wordmark ──
  // A MAJOR. The whole record has been in A minor; the logo raises the third.
  // That's a picardy third and it is the single most corporate gesture in music:
  // forty seconds of dread, resolved on cue, because the brand is arriving.
  pad(110.00, LOGO_AT - 1400, RUN_MS - 700, 0.22);          // A2
  pad(164.81, LOGO_AT - 800,  RUN_MS - 700, 0.15);          // E3
  pad(277.18, LOGO_AT + 200,  RUN_MS - 900, 0.10);          // C#4 — the lift
  pad(440.00, LOGO_AT + 900,  RUN_MS - 900, 0.055, 'sine'); // A4  shimmer

  // ── Air ──
  // A continuous filtered-noise bed under everything: the room tone of a place
  // that is not a room. It is the cheapest way to make synthetic pads sound like
  // an ENVIRONMENT rather than a keyboard, and it's why almost nothing else
  // needs to be happening for this to feel like somewhere.
  {
    const len = Math.floor(ctx.sampleRate * 4);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last * 0.96) + (Math.random() * 2 - 1) * 0.04; d[i] = last; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.4;
    const g = ctx.createGain(); g.gain.value = 0.0001;
    src.connect(bp).connect(g).connect(master);
    src.start(now);
    // Swells with the escalation, gone through the silence, back thinner for the
    // Basin — wind over a city that nothing is outside of.
    at(g.gain, 0.30, 8000);
    at(g.gain, 0.85, 36500);
    at(g.gain, 0.0001, 39200);
    at(g.gain, 0.0001, 44000);
    at(g.gain, 0.34, 50000);
    at(g.gain, 0.16, LOGO_AT);
    at(g.gain, 0.0001, RUN_MS);
    at(bp.frequency, 900, 36500);
    at(bp.frequency, 300, 50000);
    voices.push(src);
  }

  // ── Motif ──
  // Deliberately sparse. An earlier pass had a dozen bell tones climbing over
  // each other, which turned an atmosphere into a tune — and a tune competes
  // with the words, which are the actual content. Six notes now, one per major
  // turn in the record, each a sine with a fast attack and a long tail.
  const bell = (freq, tMs, gain = 0.09) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const g = ctx.createGain();
    const t0 = now + tMs / 1000;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol * gain, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.4);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + 3.6);
    voices.push(o);
  };
  const A4 = 440, C5 = 523.25, E5 = 659.25, CS5 = 554.37;
  bell(A4,  5200,  0.07);   // the first line lands
  bell(E5,  19400, 0.06);   // the lattice starts to tighten
  bell(C5,  26900, 0.08);   // "something woke up"
  bell(A4,  35000, 0.09);   // the last one before it all comes apart
  bell(C5,  50000, 0.06);   // the lights come back on
  bell(CS5, LOGO_AT + 700, 0.075);  // the mark strikes — major, not minor

  // ── Master shape ──
  master.gain.setValueAtTime(0, now);
  at(master.gain, vol * 0.50, 4000);
  at(master.gain, vol * 0.74, 24000);
  at(master.gain, vol * 0.95, 36000);
  at(master.gain, 0.0001, 39600);          // Silence. Actually silent.
  at(master.gain, 0.0001, 43600);
  at(master.gain, vol * 0.52, 47000);
  at(master.gain, vol * 0.44, 62000);
  at(master.gain, vol * 0.62, LOGO_AT + 1600);   // the brand arrives
  at(master.gain, vol * 0.55, RUN_MS - 3000);
  at(master.gain, 0.0001, RUN_MS);

  filter.frequency.setValueAtTime(180, now);
  at(filter.frequency, 320, 24000);
  at(filter.frequency, 900, 37500);
  at(filter.frequency, 240, 46000);
  // The pads open up as the lattice tightens, then close into the Basin.
  padFilter.frequency.setValueAtTime(420, now);
  at(padFilter.frequency, 1200, 24000);
  at(padFilter.frequency, 2600, 36500);
  at(padFilter.frequency, 700, 47000);
  at(padFilter.frequency, 1900, LOGO_AT + 1400); // and open, clean, for the mark

  // Noise hits: the wake-up, the exchange, and the first light of Coldwater.
  // Retimed with the beats — these are cues, and a cue that lands on the wrong
  // line is worse than no cue.
  const hit = (delayMs, dur, gain, freq) => {
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.value = vol * gain;
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start(now + delayMs / 1000);
    voices.push(src);
  };
  hit(26850, 1.1, 0.5, 220);   // "something woke up"
  hit(38000, 2.4, 0.9, 130);   // "Civilization disappeared in weeks."
  hit(49000, 1.6, 0.35, 520);  // COLDWATER BASIN
  hit(LOGO_AT, 0.9, 0.22, 1400); // the A-mark draws itself on — a soft air-hiss

  return { ctx, master, voices };

}

function stopAudio() {
  if (!_audio) return;
  const { ctx, master } = _audio;
  try {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0.0001, now + 0.35);   // never a click on skip
    setTimeout(() => { try { ctx.close(); } catch {} }, 450);
  } catch { try { ctx.close(); } catch {} }
  _audio = null;
}

// ── Canvas ───────────────────────────────────────────────────────────────────
//
// One 3D scene, four states, and the same node field the whole way through — the
// lattice is never replaced, only rearranged, which is precisely the story the
// phases are telling. It drifts as a loose volume, pulls into a regular cubic
// lattice, blows apart, and then comes back on the far side of the silence as
// COLDWATER: the same lattice, snapped to a ground plane and extruded into
// towers whose windows light one at a time. The city IS the lattice. That's the
// point, and it's why the buildings arrive as wireframe first and only then take
// on faces and light.
//
// Everything projects through one pinhole camera (`proj`), so depth is real:
// links thin and dim with distance, near towers overrun the frame, the camera
// dollies down the street. There are no 3D libraries here and there shouldn't
// be — this is ~80 points and ~50 boxes, and 2D canvas draws it fine.
const ACCENT_FALLBACK = { r: 53, g: 224, b: 200 };
function parseAccent(css) {
  const s = (css || '').trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16) };
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) };
  m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(s);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  return ACCENT_FALLBACK;
}

function startCanvas(cv, t0, reduced) {
  const ctx = cv.getContext('2d');
  let w = 0, h = 0;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const fit = () => {
    w = cv.clientWidth; h = cv.clientHeight;
    cv.width = Math.floor(w * dpr); cv.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  fit();
  window.addEventListener('resize', fit);

  const A = parseAccent(getComputedStyle(document.documentElement).getPropertyValue('--accent'));
  const acc = (a) => `rgba(${A.r},${A.g},${A.b},${a})`;

  // ── Camera ──
  // A pinhole at the world origin looking down +z, with a little pitch. Nothing
  // else: no matrices, no near/far planes. `proj` is the only place perspective
  // happens, so every phase gets the same depth for free.
  const cam = { z: 0, y: 0, pitch: 0 };
  const proj = (x, y, z) => {
    const f = Math.min(w, h) * 0.95;
    const dy = y - cam.y, dz = z - cam.z;
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const ry = dy * cp - dz * sp;
    let rz = dz * cp + dy * sp;
    if (rz < 0.14) rz = 0.14;             // never divide through the lens
    const s = f / rz;
    return { x: w / 2 + x * s, y: h / 2 + ry * s, s, z: rz };
  };
  // Orbit the FIELD rather than the camera — spinning a camera that sits outside
  // the volume just swings the volume off-frame.
  const ZC = 3.15;
  const spinX = (x, z, a) => x * Math.cos(a) + (z - ZC) * Math.sin(a);
  const spinZ = (x, z, a) => ZC - x * Math.sin(a) + (z - ZC) * Math.cos(a);

  // ── The node field ──
  // Each node carries both where it IS (drifting) and the cubic-lattice seat it
  // snaps to. Because the seats are a regular grid and links are drawn by 3D
  // proximity, tightening turns the soft cloud into wireframe cubes on its own —
  // no separate "draw a grid" code path.
  const DX = reduced ? 4 : 5, DY = reduced ? 3 : 4, DZ = reduced ? 3 : 4;
  const SP = 0.66;
  const nodes = [];
  for (let i = 0; i < DX * DY * DZ; i++) {
    const ix = i % DX, iy = Math.floor(i / DX) % DY, iz = Math.floor(i / (DX * DY));
    nodes.push({
      x: (Math.random() - 0.5) * 3.4, y: (Math.random() - 0.5) * 2.4, z: ZC + (Math.random() - 0.5) * 2.6,
      vx: (Math.random() - 0.5) * 0.00040, vy: (Math.random() - 0.5) * 0.00032, vz: (Math.random() - 0.5) * 0.00036,
      gx: (ix - (DX - 1) / 2) * SP, gy: (iy - (DY - 1) / 2) * SP, gz: ZC + (iz - (DZ - 1) / 2) * SP,
      seed: Math.random(),
    });
  }

  // ── Coldwater ──
  // A block grid with a street left down the middle for the camera to look along.
  // Sorted far-to-near once, so the per-frame draw is a plain painter's pass.
  const GY = 0.95;                                   // the ground plane
  const COLS = reduced ? 6 : 9, ROWS = reduced ? 4 : 6;
  const city = [];
  const grid = [];
  for (let r = 0; r < ROWS; r++) {
    grid[r] = [];
    for (let c = 0; c < COLS; c++) {
      const gx = (c - (COLS - 1) / 2) * 1.34 + (Math.random() - 0.5) * 0.16;
      if (Math.abs(gx) < 0.95) { grid[r][c] = null; continue; }   // the street
      const b = {
        gx, gz: 2.5 + r * 1.72 + (Math.random() - 0.5) * 0.28,
        bw: 0.52 + Math.random() * 0.52, bd: 0.48 + Math.random() * 0.5,
        bh: (0.65 + Math.random() * 1.75) * (1 + Math.abs(gx) * 0.09),
        seed: Math.random(), delay: Math.random(),
      };
      grid[r][c] = b;
      city.push(b);
    }
  }
  city.sort((a, b) => b.gz - a.gz);
  // The lattice's last visible act: lines between adjacent footprints, drawn on
  // the ground before anything stands up on them.
  const streets = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const b = grid[r][c]; if (!b) continue;
    const right = grid[r][c + 1], back = grid[r + 1]?.[c];
    if (right) streets.push([b, right]);
    if (back) streets.push([b, back]);
  }

  const phaseAt = (t) => { let p = PHASES[0].phase; for (const s of PHASES) if (t >= s.from) p = s.phase; return p; };
  // The lattice breathes on the line. Each beat's arrival brightens the links for
  // about a second — the animation is on the story's clock, not its own.
  const beatPulse = (t) => {
    let best = 1e9;
    for (const b of BEATS) { const d = t - b.t; if (d >= 0 && d < best) best = d; }
    return Math.exp(-best / 900);
  };

  // ── Lattice / tighten / shatter ──
  function drawLattice(t, phase, pulse) {
    cam.z = 0; cam.y = 0; cam.pitch = 0;
    const tighten = smooth(clamp01((t - P_TIGHTEN) / 9200));
    const shatter = phase === 'shatter' ? easeOut(clamp01((t - P_SHATTER) / 2100)) : 0;
    // A full orbit would take ~2 minutes. It should read as "is that moving?"
    const ang = reduced ? 0.34 : 0.34 + t * 0.000050;

    const pts = [];
    for (const n of nodes) {
      if (!reduced) {
        n.x += n.vx; n.y += n.vy; n.z += n.vz;
        if (n.x < -1.9 || n.x > 1.9) n.vx *= -1;
        if (n.y < -1.4 || n.y > 1.4) n.vy *= -1;
        if (n.z < ZC - 1.5 || n.z > ZC + 1.5) n.vz *= -1;
      }
      let x = lerp(n.x, n.gx, tighten), y = lerp(n.y, n.gy, tighten), z = lerp(n.z, n.gz, tighten);
      if (shatter) {                       // blown outward from the middle
        const k = shatter * (0.9 + n.seed * 1.9);
        x += x * k; y += y * k * 0.6; z += (n.seed - 0.5) * k * 1.5;
      }
      const p = proj(spinX(x, z, ang), y, spinZ(x, z, ang));
      p.wx = x; p.wy = y; p.wz = z;
      pts.push(p);
    }

    // Links by 3D proximity. As the field tightens the reach shrinks past the
    // cube diagonal, so only axis neighbours survive — the cloud becomes a frame.
    const reach = 1.06 - 0.34 * tighten;
    ctx.lineCap = 'round';
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j];
        const dx = a.wx - b.wx, dy = a.wy - b.wy, dz = a.wz - b.wz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > reach) continue;
        const depth = clamp01((6.2 - (a.z + b.z) / 2) / 3.4);
        const al = (1 - d / reach) * (0.15 + 0.42 * tighten) * (1 - shatter) * (0.80 + 0.34 * pulse) * depth;
        if (al <= 0.012) continue;
        ctx.strokeStyle = acc(al);
        ctx.lineWidth = Math.max(0.45, (0.5 + 0.75 * tighten) * (2.6 / ((a.z + b.z) / 2)));
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }

    for (const p of pts) {
      const depth = clamp01((6.4 - p.z) / 3.6);
      const al = (0.42 + 0.46 * tighten) * (1 - shatter * 0.8) * depth;
      if (al <= 0.02) continue;
      const r = Math.max(0.6, (1.0 + 1.25 * tighten) * (2.8 / p.z));
      ctx.fillStyle = acc(al * 0.16);
      ctx.beginPath(); ctx.arc(p.x, p.y, r * 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = acc(al);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    }

    if (shatter && !reduced) {   // the exchange: scanline static torn across frame
      for (let i = 0; i < 40 * shatter; i++) {
        const y = Math.random() * h;
        ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.32 * shatter})`;
        ctx.fillRect(0, y, w, Math.random() * 2.5);
      }
    }
  }

  // ── The city ──
  // World-space bilinear across a face, then project: windows foreshorten with
  // the wall they're painted on instead of sliding evenly across it.
  const facePt = (q, u, v) => {
    const ax = lerp(q[0][0], q[1][0], u), ay = lerp(q[0][1], q[1][1], u), az = lerp(q[0][2], q[1][2], u);
    const bx = lerp(q[3][0], q[2][0], u), by = lerp(q[3][1], q[2][1], u), bz = lerp(q[3][2], q[2][2], u);
    return proj(lerp(ax, bx, v), lerp(ay, by, v), lerp(az, bz, v));
  };
  const quadPath = (P) => {
    ctx.beginPath(); ctx.moveTo(P[0].x, P[0].y);
    for (let i = 1; i < P.length; i++) ctx.lineTo(P[i].x, P[i].y);
    ctx.closePath();
  };

  function drawCity(t) {
    const p = smooth(clamp01((t - P_CITY) / 9500));
    const dolly = clamp01((t - P_CITY) / 27000);
    // A slow push down the street. It never arrives anywhere, which is the joke.
    cam.z = -2.1 + 1.55 * dolly;
    cam.y = -0.10 - 0.10 * dolly;
    cam.pitch = -0.05 - 0.02 * dolly;

    // Sky: cold above, sodium at street level. The Basin's lights are the only
    // warm colour anywhere in the sequence.
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, 'rgba(0,0,0,0)');
    sky.addColorStop(0.52, `rgba(22,34,46,${0.42 * p})`);
    sky.addColorStop(1, `rgba(255,172,88,${0.15 * p})`);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

    // The ground lattice — up early, gone by the time the towers have faces.
    const gl = clamp01(p / 0.34) * (1 - clamp01((p - 0.34) / 0.34));
    if (gl > 0.01) {
      ctx.lineWidth = 1;
      for (const [a, b] of streets) {
        const pa = proj(a.gx, GY, a.gz), pb = proj(b.gx, GY, b.gz);
        const depth = clamp01((11 - (pa.z + pb.z) / 2) / 7);
        ctx.strokeStyle = acc(0.30 * gl * depth);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      }
    }

    const solid = clamp01((p - 0.26) / 0.30);              // faces fill in
    const wire = (1 - clamp01((p - 0.22) / 0.36)) * 0.8 + 0.10;   // and the frame recedes

    for (const b of city) {
      const grow = smooth(clamp01((p - b.delay * 0.20) / 0.52));
      if (grow <= 0.001) continue;
      const top = GY - b.bh * grow;
      const x0 = b.gx - b.bw / 2, x1 = b.gx + b.bw / 2;
      const z0 = b.gz - b.bd / 2, z1 = b.gz + b.bd / 2;
      const side = b.gx > 0 ? x0 : x1;        // only the inner wall faces us
      const lit = clamp01((p - 0.40 - b.delay * 0.26) / 0.42);

      const faces = [
        { q: [[side, top, z0], [side, top, z1], [side, GY, z1], [side, GY, z0]], shade: 0.55, win: 0.45 },
        { q: [[x0, top, z0], [x1, top, z0], [x1, GY, z0], [x0, GY, z0]], shade: 1, win: 1 },
      ];
      if (top > cam.y) faces.unshift({ q: [[x0, top, z0], [x1, top, z0], [x1, top, z1], [x0, top, z1]], shade: 0.32, win: 0 });

      for (const f of faces) {
        const P = f.q.map((c) => proj(c[0], c[1], c[2]));
        quadPath(P);
        ctx.fillStyle = `rgba(${Math.round(7 * f.shade)},${Math.round(11 * f.shade)},${Math.round(15 * f.shade)},${0.94 * solid})`;
        ctx.fill();
        if (wire > 0.02) {
          ctx.strokeStyle = acc(wire * 0.5 * grow);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        if (!f.win || lit <= 0.01) continue;

        // Window grid sized off the face's ON-SCREEN size — free LOD, so the
        // back rows cost nothing and the near towers stay dense.
        const wpx = Math.hypot(P[1].x - P[0].x, P[1].y - P[0].y);
        const hpx = Math.hypot(P[3].x - P[0].x, P[3].y - P[0].y);
        if (wpx < 20 || hpx < 26) continue;
        const cols = Math.max(1, Math.min(6, Math.round(wpx / 13)));
        const rows = Math.max(1, Math.min(11, Math.round(hpx / 15)));
        for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
          const k = (c * 37 + r * 17 + Math.floor(b.seed * 97)) % 100;
          if (k > 52) continue;                       // most windows are dark
          if (lit < (k / 100) * 0.95) continue;       // and the rest come on in a cascade
          const fl = reduced ? 1 : 0.78 + 0.22 * Math.sin(t / 380 + k * 1.7 + b.seed * 9);
          const al = f.win * 0.70 * fl * lit;
          const Q = [facePt(f.q, (c + 0.24) / cols, (r + 0.22) / rows),
                     facePt(f.q, (c + 0.78) / cols, (r + 0.22) / rows),
                     facePt(f.q, (c + 0.78) / cols, (r + 0.70) / rows),
                     facePt(f.q, (c + 0.24) / cols, (r + 0.70) / rows)];
          quadPath(Q);
          // One window in thirteen still burns the lattice's colour. Something is
          // awake in there, and it isn't a person.
          ctx.fillStyle = k % 13 === 0 ? acc(al * 0.85) : `rgba(255,206,140,${al})`;
          ctx.fill();
        }
      }
    }
  }

  function frame() {
    const t = performance.now() - t0;
    if (t > RUN_MS) return;
    ctx.clearRect(0, 0, w, h);
    const phase = phaseAt(t);
    if (phase !== 'void') {
      if (phase === 'city') drawCity(t);
      else drawLattice(t, phase, reduced ? 0 : beatPulse(t));
    }
    _raf = requestAnimationFrame(frame);
  }
  _raf = requestAnimationFrame(frame);
  return () => window.removeEventListener('resize', fit);
}

// ── The wordmark ─────────────────────────────────────────────────────────────
// The last thing the cold open does before it lets go of the screen: ARCHITECT
// introduces itself, and the introduction is a brand.
//
// The mark is the letter A drawn as a piece of the lattice — two legs, a
// crossbar, a spine, and a node at every vertex, which is the same vocabulary
// the canvas has been speaking in for a minute. It DRAWS ITSELF on (stroke-dash),
// legs first, then the bar, then the nodes pop: the A is being built, by the
// thing that builds. The counter is left open on purpose; a closed A here reads
// as a badge, and this should read as a schematic.
//
// The copy is the tone in miniature — a warm welcome, then a line of small print
// that takes it back. It's DOM rather than canvas so the type stays crisp at any
// DPI and the tracking animation is free.
const LOGO_HTML = `
  <div class="intro-cine-logo" id="intro-cine-logo" aria-hidden="true">
    <svg class="intro-cine-mark" viewBox="0 0 120 120" fill="none" aria-hidden="true">
      <g class="icm-strokes" stroke="currentColor" stroke-width="4.2" stroke-linecap="square" stroke-linejoin="miter">
        <path class="icm-leg" d="M12 106 L60 14 L108 106" pathLength="1"/>
        <path class="icm-bar" d="M26.6 78 H93.4" pathLength="1"/>
        <path class="icm-spine" d="M60 34 V78" stroke-width="1.5" opacity="0.42" pathLength="1"/>
      </g>
      <g class="icm-nodes" fill="currentColor">
        <circle cx="60"   cy="14"  r="3.6"/>
        <circle cx="12"   cy="106" r="3.6"/>
        <circle cx="108"  cy="106" r="3.6"/>
        <circle cx="26.6" cy="78"  r="2.6"/>
        <circle cx="93.4" cy="78"  r="2.6"/>
        <circle cx="60"   cy="78"  r="2.2"/>
      </g>
    </svg>
    <div class="intro-cine-word">ARCHITECT</div>
    <div class="intro-cine-rule"></div>
    <div class="intro-cine-welcome">Welcome to Coldwater Basin</div>
    <div class="intro-cine-fine">A MANAGED ENVIRONMENT · YOUR ARRIVAL WAS ANTICIPATED</div>
  </div>`;

// ── Shell ────────────────────────────────────────────────────────────────────

/**
 * Play the cold open. Resolves (via onDone) exactly once — on the last beat or
 * on a skip — so the caller can tell the server to get on with the prologue.
 */
export function playIntroCinematic(onDone) {
  if (_ov) return;                       // already running — never stack two
  _finished = false;
  _done = typeof onDone === 'function' ? onDone : () => {};

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    || document.documentElement.getAttribute('data-motion') === 'off';

  _ov = document.createElement('div');
  _ov.id = 'intro-cinematic';
  _ov.setAttribute('role', 'dialog');
  _ov.setAttribute('aria-label', 'Opening sequence');
  _ov.innerHTML = `
    <canvas id="intro-cine-cv"></canvas>
    <div class="intro-cine-vig"></div>
    <div class="intro-cine-stage"><div class="intro-cine-line" id="intro-cine-line"></div></div>
    ${LOGO_HTML}
    <button type="button" class="intro-cine-skip show" id="intro-cine-skip">Skip <span>›</span></button>`;
  document.body.appendChild(_ov);
  document.body.classList.add('intro-cine-open');

  const lineEl = _ov.querySelector('#intro-cine-line');
  const skipEl = _ov.querySelector('#intro-cine-skip');
  const t0 = performance.now();

  _cleanupCanvas = startCanvas(_ov.querySelector('#intro-cine-cv'), t0, reduced);
  _audio = startAudio();

  const later = (ms, fn) => _timers.push(setTimeout(fn, ms));

  for (const b of BEATS) {
    later(b.t, () => {
      lineEl.className = `intro-cine-line in ${b.cls || ''}`;
      lineEl.innerHTML = b.text;   // authored above; no player input reaches this
    });
    later(b.t + b.hold, () => { lineEl.className = `intro-cine-line ${b.cls || ''}`; });
  }

  // The skip affordance is loud for six seconds, then recedes to a dim corner —
  // still there, still clickable, no longer competing with the first line.
  later(6000, () => skipEl.classList.remove('show'));
  // The mark arrives after the last line has finished leaving, holds, and is
  // still on screen when the overlay starts its fade — so the logo dissolves
  // INTO the game rather than being replaced by it.
  later(LOGO_AT, () => _ov?.querySelector('#intro-cine-logo')?.classList.add('in'));
  later(RUN_MS - 1600, () => _ov?.classList.add('closing'));
  later(RUN_MS, () => finish('end'));

  const onKey = (e) => { if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); finish('skip'); } };
  skipEl.addEventListener('click', (e) => { e.stopPropagation(); finish('skip'); });
  // Clicking the field does NOT skip — a stray click in the first ten seconds
  // would throw away the one thing this whole sequence exists to do. It brings
  // the skip button back to full strength instead, which is what someone
  // reaching for the mouse actually wants.
  _ov.addEventListener('click', () => {
    skipEl.classList.add('show');
    later(2600, () => skipEl.classList.remove('show'));
  });
  window.addEventListener('keydown', onKey);
  _ov._onKey = onKey;
}

function finish(reason) {
  if (_finished) return;                 // skip + end can race; first one wins
  _finished = true;
  localStorage.setItem(SEEN_KEY, '1');
  for (const t of _timers) clearTimeout(t);
  _timers = [];
  if (_raf) cancelAnimationFrame(_raf);
  _raf = 0;
  try { _cleanupCanvas?.(); } catch {}   // drops the resize listener
  _cleanupCanvas = null;
  stopAudio();
  const ov = _ov;
  _ov = null;
  if (ov) {
    if (ov._onKey) window.removeEventListener('keydown', ov._onKey);
    // A skip gets a quick cut; the real ending gets the long dissolve the
    // wordmark is timed against.
    ov.classList.add('closing');
    if (reason === 'skip') ov.classList.add('fast');
    setTimeout(() => { ov.remove(); document.body.classList.remove('intro-cine-open'); }, reason === 'skip' ? 420 : 900);
  } else {
    document.body.classList.remove('intro-cine-open');
  }
  const done = _done; _done = null;
  try { done?.(reason); } catch {}
}

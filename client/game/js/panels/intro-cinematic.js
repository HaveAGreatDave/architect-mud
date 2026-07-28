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
// The SAME height/footprint numbers the flight sim extrudes Coldwater with, so
// the skyline you fly through here is the skyline you fly over later.
import { FLOOR_Z, BUILDING_FOOT, floorsFor } from '../../../shared/skyline-scale.js';

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
  // The title card deliberately does NOT name the city. The cold open is history,
  // and the player's first room is the void — the name is held back until they're
  // standing in the place, where it's stencilled on the clone-lab wall.
  { t: 49000, hold: 3350, text: 'ONE CITY LEFT', cls: 'title' },
  { t: 53400, hold: 2900, text: 'The shelves are full. The trains run.<br>Nothing outside it is alive.' },
  { t: 57350, hold: 2900, text: 'Something is keeping it running.<br>It calls itself the Architect.', cls: 'big' },
  { t: 61300, hold: 3800, text: 'It does not ask to be worshipped.<br>It asks that you get to work on time.' },
];
// The wordmark. Not a beat — it's a DOM layer (see the `.intro-cine-logo` block
// below) so the type stays crisp and the A-mark can draw itself on.
const LOGO_AT = 71500;
// LOGO_AT + ~5.5s of assembly + a beat to just LOOK at it + the 1.5s dissolve.
const RUN_MS  = 80900;

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
  pad(87.31,  44500, LOGO_AT - 400, 0.20);         // F2
  pad(174.61, 45500, LOGO_AT - 400, 0.13);         // F3
  pad(261.63, 47000, LOGO_AT - 800, 0.09);         // C5
  pad(349.23, 52000, LOGO_AT - 800, 0.05, 'sine'); // F5 shimmer
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
    at(g.gain, 0.42, LOGO_AT - 4000);   // rises as we drop into the streets
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
  at(master.gain, vol * 0.40, LOGO_AT - 2500);   // the long quiet run through the city
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
  hit(49000, 1.6, 0.35, 520);  // the title card
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

function startCanvas(cv, t0, reduced, skyline, shore) {
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
  const cam = { x: 0, y: 0, z: 0, pitch: 0 };
  const proj = (x0, y, z) => {
    const f = Math.min(w, h) * 0.95;
    const x = x0 - cam.x;
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
  //
  // THIS IS THE REAL CITY. `skyline` is the actual building tiles off the world
  // map (see coldwaterSkyline in plugins/prologue/index.js), and the footprints
  // and floor counts are the same ones the flight sim extrudes out of a cockpit
  // windshield — same `client/shared/skyline-scale.js`, same numbers. A player
  // who watches this and then, hours later, flies over Marrow Street is looking
  // at the same block from the other side. That's the whole reason to pay the
  // cost of shipping the manifest on a login.
  //
  // Two art liberties, both deliberate:
  //   • STRETCH — the flight sim's storeys are short because its camera is a
  //     thousand feet up. At street level, flying between them, they need to be
  //     tall. Nothing else about the geometry is touched.
  //   • the city is rotated 90° into the scene (tile-x becomes DEPTH), because
  //     Coldwater is a wide shallow band and the long axis is the only one you
  //     can actually fly down.
  //
  // ORIENTATION. The run goes EAST TO WEST, so scene-forward (+z) is tile −x.
  // Facing west, your right hand points north, and north is tile −y — so
  // scene-right (+x) is tile −y. BOTH axes are negated, together; negating one
  // and not the other silently mirrors the whole city, which looks fine and is
  // wrong, and you would only ever catch it by flying the same street for real.
  const GY = 0;              // the ground plane; up is -y
  const SPACING = 1.0;       // one world tile → one scene unit
  const STRETCH = 6.4;       // storey height multiplier — see above
  const BASE_H = 0.14;       // so a single-storey shop is still a box, not a mark
  // Tile → scene, the single place the rotation lives. Used by the buildings and
  // by the coastline, which must land on exactly the same ground.
  const T2X = (ty, cy) => -(ty - cy) * SPACING;
  const T2Z = (tx, cx) => -(tx - cx) * SPACING;

  // No manifest (an old server, or a replay before one arrives) → a plausible
  // block grid in the SAME shape, so there is exactly one renderer below.
  const rawSkyline = (Array.isArray(skyline) && skyline.length >= 8) ? skyline : (() => {
    const f = [];
    for (let gy = 0; gy < 12; gy++) for (let gx = 0; gx < 26; gx++) {
      if (Math.random() > 0.3) continue;
      f.push({ x: gx, y: gy, t: 'default', f: 2 + Math.floor(Math.random() * 14) });
    }
    return f;
  })();

  // The city's own centre, in tile coords — the origin everything else is
  // measured from, the coastline included.
  const CX = rawSkyline.reduce((s, b) => s + b.x, 0) / rawSkyline.length;
  const CY = rawSkyline.reduce((s, b) => s + b.y, 0) / rawSkyline.length;

  const city = (() => {
    const src = rawSkyline.slice(0, 240);
    const out = src.map((b, i) => {
      const seed = ((b.x + 512) * 73 + (b.y + 512) * 149) % 1000 / 1000;
      const floors = floorsFor(b.t, b.f);
      const sx = T2X(b.y, CY), sz = T2Z(b.x, CX);
      return {
        sx, sz, i,
        half: (BUILDING_FOOT + seed * 0.05) * SPACING,
        h: BASE_H + floors * FLOOR_Z * STRETCH * (0.9 + seed * 0.2),
        floors, seed,
        // Downtown lands first and the edges of the map last, so the city
        // assembles from its middle outward rather than in a flat wipe.
        delay: clamp01(Math.hypot(sx, sz) / 22) * 0.55 + seed * 0.22,
        // Where this building's node comes IN from: high, wide, and scattered —
        // the lattice arriving from everywhere at once.
        ox: (seed - 0.5) * 46, oy: -14 - seed * 22, oz: sz + (seed - 0.5) * 30,
      };
    });
    out.sort((a, b) => b.sz - a.sz);   // far → near, a plain painter's pass
    return out;
  })();

  // ── The roofline the camera flies over ──
  // Nothing in this scene has collision, and the run used to end a third of a unit
  // off the deck — which is BELOW the roof of every tower on the street (a twenty
  // storey block tops out around 3.7). So the camera drove through the buildings
  // rather than down the street, and you saw the inside of a wall.
  //
  // Rather than lift the whole run (height is the enemy of scale — see the note on
  // cam.y), the camera keeps its descent and is clamped, per frame, to stay just
  // ABOVE whatever is actually in front of it. Over a gap it drops into the gap;
  // over a tower it rides the roof. That's the "between and above" read: you are
  // skimming the skyline, not diagramming it from a thousand feet.
  //
  // Bucketed by z so the per-frame cost is a couple of array lookups rather than a
  // sweep over 240 boxes.
  const ROOF_BUCKET = 1.0;                 // scene units per bucket
  const ROOF_CORRIDOR = 1.7;               // how wide either side of the lens counts
  const ROOF_AHEAD = 6.0;                  // how far forward to start climbing for it
  const ROOF_BEHIND = 1.2;                 // …and how long to keep holding it
  const roofBuckets = (() => {
    if (!city.length) return { z0: 0, rows: [] };
    const z0 = Math.floor(Math.min(...city.map(b => b.sz - b.half)) / ROOF_BUCKET) - 1;
    const z1 = Math.ceil(Math.max(...city.map(b => b.sz + b.half)) / ROOF_BUCKET) + 1;
    const rows = [];
    for (let i = 0; i <= z1 - z0; i++) rows.push([]);
    for (const b of city) {
      const lo = Math.floor((b.sz - b.half) / ROOF_BUCKET) - z0;
      const hi = Math.floor((b.sz + b.half) / ROOF_BUCKET) - z0;
      for (let i = Math.max(0, lo); i <= Math.min(rows.length - 1, hi); i++) rows[i].push(b);
    }
    return { z0, rows };
  })();
  // Tallest thing within the corridor around (x), between z−behind and z+ahead.
  // Returns a HEIGHT (positive, up from GY) — the caller negates it, since up is -y.
  function roofAhead(x, z) {
    const { z0, rows } = roofBuckets;
    if (!rows.length) return 0;
    const lo = Math.max(0, Math.floor((z - ROOF_BEHIND) / ROOF_BUCKET) - z0);
    const hi = Math.min(rows.length - 1, Math.floor((z + ROOF_AHEAD) / ROOF_BUCKET) - z0);
    let top = 0;
    for (let i = lo; i <= hi; i++) {
      for (const b of rows[i]) {
        if (Math.abs(b.sx - x) > ROOF_CORRIDOR + b.half) continue;
        if (b.h > top) top = b.h;
      }
    }
    return top;
  }
  // Smoothed so a tower entering the corridor is a climb, not a jump. Seeded on
  // the first frame of the run so the camera doesn't visibly snap up at the start.
  let roofHold = null;

  // ── The coastline ──
  // `[x, y, dir, len]` runs in tile-CORNER coords (see coldwaterShore in
  // plugins/prologue/index.js). A corner is half a tile off a tile centre, hence
  // the -0.5. Held as scene-space endpoints so the per-frame cost is two lookups
  // and a stroke.
  const coast = (Array.isArray(shore) ? shore : []).map(([x, y, dir, n]) => {
    const x2 = dir ? x : x + n, y2 = dir ? y + n : y;
    return {
      a: [T2X(y - 0.5, CY), GY, T2Z(x - 0.5, CX)],
      b: [T2X(y2 - 0.5, CY), GY, T2Z(x2 - 0.5, CX)],
    };
  });

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
    cam.x = 0; cam.z = 0; cam.y = 0; cam.pitch = 0;
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
  //
  // Coldwater as a WIREFRAME, and we fly through it. Three overlapping movements:
  //
  //   1. ARRIVAL. Every building gets one node, which comes in from high and far
  //      and lands on the building's ROOFTOP. That is the lattice transforming
  //      into the city — literally the same vocabulary of drifting bright points
  //      the first forty seconds were made of, except now each point has an
  //      address.
  //   2. EXTRUSION. Where a node lands, a wireframe box grows DOWNWARD from it to
  //      the ground. The building hangs itself off the node rather than rising to
  //      meet it, because the node is the thing that decided it should exist.
  //   3. IGNITION. Then the lights come on inside, floor by floor.
  //
  // It stays a wireframe the whole way — no filled walls — so you can see the far
  // side of every tower and every light behind every other light. A solid city is
  // a place; a wireframe city is a MODEL of a place, held by something that is
  // still deciding. That reading is the point.
  const stroke3 = (a, b, al, lw, tint) => {
    if (al <= 0.012) return;
    // Either end past the lens drops the whole edge rather than clipping it — the
    // only time it matters is a tower sliding out of the frame corner, where two
    // missing edges for half a second cost nothing and a smear costs everything.
    if (behind(a[2]) || behind(b[2])) return;
    const pa = proj(a[0], a[1], a[2]), pb = proj(b[0], b[1], b[2]);
    ctx.strokeStyle = tint ? `rgba(${tint},${al})` : acc(al);
    ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
  };
  // Distance haze. Without it seventy see-through boxes read as wire wool.
  const haze = (z) => clamp01((28 - z) / 20) * clamp01(z / 0.9);
  // Near-plane cull. `proj` clamps rz so it never divides by zero, which means a
  // point BEHIND the camera comes back mirrored and smeared instead of absent —
  // invisible while the camera was parked, and constant once it started flying
  // through the city. So anything level with or behind the lens is dropped here,
  // at the frame edge where the vignette is already black.
  const behind = (z) => z - cam.z < 0.6;

  function drawCity(t) {
    const ct = t - P_CITY;
    // Deliberately allowed past 1: the per-building stagger subtracts up to 0.32
    // from it, so a clamp at 1 would leave the last-arriving buildings on the rim
    // of the map permanently half-lit.
    const assemble = Math.min(1.7, ct / 9000);
    // The run. Held back until the city has mostly landed, then eased the whole
    // way through it and out the far side — the camera never stops, which is why
    // the wordmark can land over it without anything having to "finish".
    // Twenty-one seconds to cross forty-odd tiles, eased at both ends. Slow
    // enough to read a skyline off, and it never comes to rest — the run is
    // still going when the wordmark lands on top of it.
    const fly = smooth(clamp01((ct - 4600) / 21000));
    cam.x = reduced ? 0 : Math.sin(ct / 7600) * 1.7;       // a lazy weave down the street
    // Starts out over open water east of the Basin and flies WEST along the
    // waterfront (see the ORIENTATION note above; the coast is off to starboard).
    cam.z = lerp(-34, 18, fly);
    // Wants to end LOW — a third of a unit off the deck, with towers going ten
    // times that high on both sides. Height is the enemy of scale: from up there
    // Coldwater is a diagram, and from down here it's a canyon. But the run has no
    // collision, so this is only ever the FLOOR of the shot; the roofline clamp
    // below is what stops it being flown through a building.
    const wantY = lerp(-9.2, -0.34, fly);
    // Ride the skyline: never below the roof of anything in the corridor ahead,
    // with a little clearance so you skim rather than clip. Over a gap this frees
    // the camera to drop back toward wantY and dive between the blocks.
    const ROOF_CLEAR = 0.62;
    const target = roofAhead(cam.x, cam.z) + ROOF_CLEAR;
    roofHold = roofHold === null ? target : lerp(roofHold, target, reduced ? 1 : 0.055);
    cam.y = Math.min(wantY, -roofHold);                    // up is -y, so min = higher
    // Level off looking slightly up in the canyon; when the roofline has pushed the
    // lens well above the deck, tip back down so the city stays in frame.
    const over = clamp01((-cam.y - 1.2) / 4);
    cam.pitch = lerp(lerp(0.32, -0.05, fly), 0.16, over);

    // Sky: cold above, sodium at street level. The Basin's lights are the only
    // warm colour anywhere in the sequence.
    const p = smooth(clamp01(assemble));
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, 'rgba(0,0,0,0)');
    sky.addColorStop(0.52, `rgba(20,32,44,${0.40 * p})`);
    sky.addColorStop(1, `rgba(255,168,84,${0.13 * p})`);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

    // A bank, applied to the whole frame. Two degrees of roll is the difference
    // between a camera move and a FLIGHT.
    const bank = reduced ? 0 : Math.sin(ct / 6200) * 0.035 * fly;
    if (bank) { ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(bank); ctx.translate(-w / 2, -h / 2); }

    // ── The coast ──
    // Where land meets water, traced BEFORE anything is built on it: the Basin
    // arrives as an outline, the way a plan is drawn before a city is. Coldwater
    // sits on the south shore of a body that also runs east of it, so the run
    // opens out over open water and comes ashore — the coastline is the first
    // thing in the frame and stays off to starboard the whole way in.
    // It dims once the towers are up; by then it's the horizon, not the subject.
    const shoreA = clamp01(ct / 2800) * (0.60 - 0.26 * clamp01((ct - 6000) / 7000));
    if (shoreA > 0.02) {
      for (const s of coast) {
        const mz = (s.a[2] + s.b[2]) / 2;
        const hz = haze(proj(0, GY, mz).z);
        if (hz <= 0.03) continue;
        stroke3(s.a, s.b, shoreA * hz, 1.35, '150,205,255');
      }
    }

    for (const b of city) {
      // Each building runs its own little three-act clock off its stagger.
      const local = clamp01((assemble - b.delay * 0.42) / 0.30);
      if (local <= 0) continue;
      const land = smooth(local);                                   // node flies in
      const grow = smooth(clamp01((assemble - b.delay * 0.42 - 0.20) / 0.26));  // box extrudes down
      const lit  = clamp01((assemble - b.delay * 0.42 - 0.40) / 0.34);          // lights come on

      const top = GY - b.h;
      // The node: from somewhere out there to exactly this rooftop.
      const nx = lerp(b.ox, b.sx, land), ny = lerp(b.oy, top, land), nz = lerp(b.oz, b.sz, land);
      const np = proj(nx, ny, nz);
      const nhz = behind(nz) ? 0 : haze(np.z);
      if (nhz > 0.02) {
        // Bright while travelling, settling to a rooftop beacon once it's home.
        const na = (0.85 - 0.45 * land) * nhz + 0.25 * land * nhz;
        const nr = Math.max(0.8, (2.4 - 1.2 * land) * (9 / np.z));
        ctx.fillStyle = acc(na * 0.18);
        ctx.beginPath(); ctx.arc(np.x, np.y, nr * 3.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = acc(na);
        ctx.beginPath(); ctx.arc(np.x, np.y, nr, 0, Math.PI * 2); ctx.fill();
      }
      if (grow <= 0.002) continue;

      const bot = lerp(top, GY, grow);      // hangs down from the roof
      const x0 = b.sx - b.half, x1 = b.sx + b.half;
      const z0 = b.sz - b.half, z1 = b.sz + b.half;
      if (behind(z1)) continue;             // fully past the lens
      const hz = haze(proj(b.sx, top, b.sz).z);
      if (hz <= 0.02) continue;
      const al = 0.42 * hz, lw = Math.max(0.5, 1.15 * clamp01(9 / Math.max(0.6, b.sz - cam.z)));

      // The roof, drawn brightest — it's the part the node made.
      stroke3([x0, top, z0], [x1, top, z0], al * 1.5, lw);
      stroke3([x1, top, z0], [x1, top, z1], al * 1.5, lw);
      stroke3([x1, top, z1], [x0, top, z1], al * 1.5, lw);
      stroke3([x0, top, z1], [x0, top, z0], al * 1.5, lw);
      // Four corner posts, growing toward the ground.
      stroke3([x0, top, z0], [x0, bot, z0], al, lw);
      stroke3([x1, top, z0], [x1, bot, z0], al, lw);
      stroke3([x1, top, z1], [x1, bot, z1], al, lw);
      stroke3([x0, top, z1], [x0, bot, z1], al, lw);
      // And the footprint, only once it has actually reached the ground.
      if (grow > 0.97) {
        stroke3([x0, GY, z0], [x1, GY, z0], al * 0.85, lw);
        stroke3([x1, GY, z0], [x1, GY, z1], al * 0.85, lw);
        stroke3([x1, GY, z1], [x0, GY, z1], al * 0.85, lw);
        stroke3([x0, GY, z1], [x0, GY, z0], al * 0.85, lw);
      }

      // ── Lights ──
      // Points on the wall planes at storey heights, not textured quads: inside a
      // see-through box you want floating sparks, and you want to see the ones on
      // the far wall through the near one. Two walls only — the one facing the
      // camera in z and the one facing it in x — which halves the cost and looks
      // identical, because the box is transparent anyway.
      if (lit <= 0.01) continue;
      const dist = Math.max(0.6, Math.hypot(b.sx - cam.x, b.sz - cam.z));
      if (dist > 26) continue;
      const rows = Math.min(14, Math.max(1, Math.round(b.floors * 0.8)));
      const wz = b.sz > cam.z ? z0 : z1;         // the z-wall we can see
      const wx = b.sx > cam.x ? x0 : x1;         // and the x-wall
      const rad = Math.max(0.7, 30 / dist);
      for (let r = 0; r < rows; r++) {
        const fy = top + (b.h * (r + 0.55)) / rows;
        if (fy > GY - 0.02) continue;
        for (let c = 0; c < 3; c++) {
          for (const wall of [0, 1]) {
            const k = (r * 31 + c * 17 + wall * 53 + Math.floor(b.seed * 97)) % 100;
            if (k > 46) continue;                       // most windows are dark
            if (lit < (k / 100) * 0.95) continue;       // the rest come on in a cascade
            const u = (c + 0.5) / 3;
            const px = wall ? wx : lerp(x0, x1, u);
            const pz = wall ? lerp(z0, z1, u) : wz;
            if (behind(pz)) continue;
            const q = proj(px, fy, pz);
            const qh = haze(q.z);
            if (qh <= 0.03) continue;
            const fl = reduced ? 1 : 0.74 + 0.26 * Math.sin(t / 380 + k * 1.7 + b.seed * 9);
            const a = 0.78 * fl * lit * qh * (wall ? 0.7 : 1);
            // One light in thirteen still burns the lattice's own colour.
            // Something is awake in there, and it isn't a person.
            ctx.fillStyle = k % 13 === 0 ? acc(a) : `rgba(255,206,140,${a})`;
            ctx.beginPath(); ctx.arc(q.x, q.y, rad * 0.9, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = k % 13 === 0 ? acc(a * 0.16) : `rgba(255,196,120,${a * 0.16})`;
            ctx.beginPath(); ctx.arc(q.x, q.y, rad * 3.2, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
    }

    if (bank) ctx.restore();
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
    <div class="intro-cine-markwrap">
      <svg class="intro-cine-mark" viewBox="0 0 120 120" fill="none" aria-hidden="true">
        <!-- Containment frame. Four corner brackets, snapping in FIRST: the mark
             arrives already inside a box that something else drew. -->
        <g class="icm-frame" stroke="currentColor" stroke-width="1.5" fill="none">
          <path d="M6 24 V6 H24"     pathLength="1"/>
          <path d="M96 6 H114 V24"   pathLength="1"/>
          <path d="M114 96 V114 H96" pathLength="1"/>
          <path d="M24 114 H6 V96"   pathLength="1"/>
        </g>
        <!-- Chromatic split: two offset copies under the real strokes, drawing on
             the same clock. It is a printing misregistration, which is the most
             expensive-looking accident there is. Kept faint — at full strength it
             stops being a logo and starts being a 1990s music video. -->
        <g class="icm-ghost icm-ghost-a" stroke="#ff2e6e" stroke-width="4.2" stroke-linecap="square" fill="none">
          <path class="icm-leg" d="M12 106 L60 14 L108 106" pathLength="1"/>
          <path class="icm-bar" d="M26.6 78 H93.4" pathLength="1"/>
        </g>
        <g class="icm-ghost icm-ghost-b" stroke="#4ea8ff" stroke-width="4.2" stroke-linecap="square" fill="none">
          <path class="icm-leg" d="M12 106 L60 14 L108 106" pathLength="1"/>
          <path class="icm-bar" d="M26.6 78 H93.4" pathLength="1"/>
        </g>
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
        <!-- One ring, out from the middle, as the last node lands. -->
        <circle class="icm-pulse" cx="60" cy="64" r="26" stroke="currentColor" stroke-width="1.2" fill="none"/>
      </svg>
      <!-- The scan. A bar of light sweeping down over the finished mark — the
           gesture of a thing being READ rather than displayed. -->
      <div class="icm-scan"></div>
    </div>
    <!-- The ™ is doing more work than anything else on this screen. -->
    <div class="intro-cine-word"><span class="icm-wordtext">ARCHITECT</span><sup class="icm-tm">™</sup></div>
    <div class="intro-cine-rule"><i></i></div>
    <!-- Deliberately NOT "Welcome to Coldwater Basin". The cold open never names
         the city at all — it SHOWS it (the flythrough is the real skyline) and
         calls it "one city left". The name is held back until the player climbs
         out of the vat and reads it stencilled on the clone-lab wall. -->
    <div class="intro-cine-welcome">Welcome</div>
    <!-- The mask slips for one fifth of a second. Two stacked lines, the second
         swapped in mid-animation and swapped straight back out: the small print
         briefly says what it means, and you are not sure you saw it. That flicker
         is the whole difference between a corporate logo and a SINISTER one. -->
    <div class="intro-cine-fine">
      <span class="icm-fine-a">A MANAGED ENVIRONMENT · YOUR ARRIVAL WAS ANTICIPATED</span>
      <span class="icm-fine-b">A MANAGED ENVIRONMENT · YOUR COMPLIANCE IS ALREADY ON FILE</span>
    </div>
  </div>`;

// ── Shell ────────────────────────────────────────────────────────────────────

/**
 * Play the cold open. Resolves (via onDone) exactly once — on the last beat or
 * on a skip — so the caller can tell the server to get on with the prologue.
 */
export function playIntroCinematic(onDone, skyline, shore) {
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
    <div class="intro-cine-gate" id="intro-cine-gate">
      <div class="intro-cine-gate-card">
        <div class="intro-cine-gate-eyebrow">Architect</div>
        <div class="intro-cine-gate-title">Before we begin</div>
        <div class="intro-cine-gate-sub">This opens with sound. Turn it up, or don't — it plays either way.</div>
        <button type="button" class="intro-cine-gate-btn" id="intro-cine-begin">Begin <span>›</span></button>
        <div class="intro-cine-gate-fine">About ninety seconds. You can skip at any point.</div>
      </div>
    </div>
    <button type="button" class="intro-cine-skip show" id="intro-cine-skip">Skip <span>›</span></button>`;
  document.body.appendChild(_ov);
  document.body.classList.add('intro-cine-open');

  const lineEl = _ov.querySelector('#intro-cine-line');
  const skipEl = _ov.querySelector('#intro-cine-skip');
  const gateEl = _ov.querySelector('#intro-cine-gate');

  const later = (ms, fn) => _timers.push(setTimeout(fn, ms));

  // ── The start gate ─────────────────────────────────────────────────────────
  // Nothing runs until the player clicks. This is not politeness — it is the
  // only way the sound plays at all. Every browser suspends an AudioContext
  // created without a user gesture, so a cinematic that auto-started came up
  // silent for most first-time players, which is exactly the one impression you
  // don't get a second go at. The click is the gesture; the context is created
  // on the far side of it, already permitted to make noise.
  //
  // It auto-starts after AUTO_BEGIN_MS regardless, because a sequence that can
  // wait forever is a sequence that can strand someone who tabbed away — and
  // the server's own fallback (INTRO_FALLBACK_MS in plugins/prologue) is sized
  // to cover this wait plus the full run.
  const AUTO_BEGIN_MS = 20000;
  let begun = false;
  const begin = () => {
    if (begun) return;
    begun = true;
    gateEl.classList.add('gone');
    setTimeout(() => gateEl.remove(), 520);
    runSequence();
  };
  _ov.querySelector('#intro-cine-begin').addEventListener('click', (e) => { e.stopPropagation(); begin(); });
  gateEl.addEventListener('click', begin);        // anywhere on the card works
  _timers.push(setTimeout(begin, AUTO_BEGIN_MS));

  // Everything from here runs on the far side of the gate — the canvas, the
  // audio context, and every beat timer. t0 is taken here rather than at mount
  // so the flythrough's clock starts when the sequence does, not when the gate
  // went up.
  function runSequence() {
    const t0 = performance.now();

    _cleanupCanvas = startCanvas(_ov.querySelector('#intro-cine-cv'), t0, reduced, skyline, shore);
    _audio = startAudio();

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
  }

  // Enter/Space START it while the gate is up (the same gesture the button
  // wants) and only SKIP once it's running — otherwise the keyboard route to
  // "begin" would throw the whole sequence away. Escape always skips.
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); finish('skip'); return; }
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (!begun) begin(); else finish('skip');
  };
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

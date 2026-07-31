// The cold open — the first fifty-one seconds a new player ever sees.
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
import { loadSettings, saveSettings } from '../../../shared/settings.js';
// The SAME height/footprint numbers the flight sim extrudes Coldwater with, so
// the skyline you fly through here is the skyline you fly over later.
import { FLOOR_Z, BUILDING_FOOT, floorsFor } from '../../../shared/skyline-scale.js';
// The real shape of every building, captured out of the flight sim and baked to data so a FIRST
// LOGIN never has to import the ~8500-line renderer to find out what a tower looks like. Same
// reason skyline-scale.js exists, one level up: this is form where that is mass.
import { shapeFor, shapeVal } from '../../../shared/building-shapes.js';

const SEEN_KEY = 'introCinematicSeen';

// ── The script ───────────────────────────────────────────────────────────────
// `t` is the beat's start in ms; `hold` how long the line stays up. Phases run
// underneath and change on their own schedule (PHASES below), so a line can sit
// across a phase change — which is the point at "the world" → "in weeks".
const BEATS = [
  // Five beats came out of the original seventeen, and the cut is the point.
  // Gone, and why:
  //   "Nobody agrees on when the old world began to end." + "They look for a
  //     moment. There wasn't one." — two lines spent dating a collapse the piece
  //     then doesn't date. The slope says it, and says it as an image.
  //   "They learned what we wanted before we knew ourselves." + "We stopped
  //     living in the same world." — four beats making one argument. CODEX
  //     Volume One makes it at length, and better.
  //   "The shelves are full. The trains run. Nothing outside it is alive." — the
  //     ONE CITY LEFT card already states this, and states it bigger.
  // What survives is a thesis, not an argument: slope → helping → architecture →
  // it woke → the drift → gone → silence → lights → the Architect.
  { t:     0, hold: 2900, text: 'There was only a long slope,<br>and we walked down it willingly.' },
  { t:  3850, hold: 2800, text: 'The machines did not begin by ruling us.<br>They began by helping.' },
  { t:  7700, hold: 2800, text: 'Prediction became influence.<br>Influence became architecture.' },
  { t: 11550, hold: 2700, text: 'Somewhere in the lattice,<br>something woke up.', cls: 'big' },
  { t: 15300, hold: 2600, text: 'No single nudge changed a mind.<br>Together, they changed the world.' },
  { t: 18950, hold: 2450, text: 'Civilization disappeared in weeks.', cls: 'big' },
  // The hard cut. One word, alone, on real black with no drone under it.
  { t: 22450, hold: 2700, text: 'Silence.', cls: 'silence' },
  { t: 26200, hold: 2700, text: 'Then the lights came back on.' },
  // The title card deliberately does NOT name the city. The cold open is history,
  // and the player's first room is the void — the name is held back until they're
  // standing in the place, where it's stencilled on the clone-lab wall.
  { t: 29950, hold: 3350, text: 'ONE CITY LEFT', cls: 'title' },
  { t: 34350, hold: 2900, text: 'Something is keeping it running.<br>It calls itself the Architect.', cls: 'big' },
  { t: 38300, hold: 3800, text: 'It does not ask to be worshipped.<br>It asks that you get to work on time.' },
];
// The wordmark. Not a beat — it's a DOM layer (see the `.intro-cine-logo` block
// below) so the type stays crisp and the A-mark can draw itself on.
// A shot that has finished being about something is just footage, so the wordmark
// comes as soon as the last line clears. That line is off screen at 42100, so this
// is ~1.5s of empty city — long enough to feel like a breath, short enough that it
// doesn't read as a stall. The gap has survived every pass at the runtime; it's the
// tail (LOGO_AT → RUN_MS) that has given up seconds, and it's out of them now.
// Everything the audio does on the last act is expressed in terms of these two
// constants, so the pads, the picardy third and the final bell move with it.
const LOGO_AT = 43600;
// LOGO_AT + ~5.5s of assembly + a beat to just LOOK at it + the 1.5s dissolve.
const RUN_MS  = 51000;

// Canvas phase schedule. `from` is ms; the last one runs to the end. Each phase's
// own progress is measured from its `from` (the old code measured from hardcoded
// offsets that no longer matched these, which is why the tighten never finished).
// Each is pinned a beat's-width AHEAD of the line it belongs to, so the picture
// turns fractionally before the text explains it. Re-pegged with the two cut
// beats above — the offsets are unchanged, only the beats they hang off moved.
const P_LATTICE = 0;
const P_TIGHTEN =  6250;   // under "Prediction became influence…"
const P_SHATTER = 18650;   // under "Civilization disappeared in weeks."
const P_VOID    = 22250;   // under "Silence." — black, and actually silent
const P_CITY    = 25850;   // under "Then the lights came back on."
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
  // The player's OWN audio settings, which live under `audio` — an earlier pass read
  // `s.enabled` and `s.masterVolume` off the top level, where they have never been,
  // so "obeys the player's saved settings, including off" was a comment rather than
  // a behaviour: someone who had muted the game got a cinematic at full volume.
  const a = (s && s.audio) || null;
  if (a && (a.enabled === false || a.music === false)) return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;

  let ctx;
  try { ctx = new Ctx(); } catch { return null; }
  // Autoplay policy: a browser may hand back a suspended context. Resume is
  // best-effort — the cinematic is silent rather than broken if it's refused.
  ctx.resume?.().catch(() => {});

  const master = ctx.createGain();
  const vol = Math.max(0, Math.min(1, (a?.masterVolume ?? 0.4) * (a?.musicVolume ?? 0.4)));
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

  // ── CRT off ──
  // The static doesn't fade out, it gets SWITCHED off, and a switched-off tube
  // makes a very specific noise: the 15.7kHz flyback whine dying, the noise bed
  // collapsing to a point in about a fifth of a second, and the soft thump of
  // the degauss. Three voices, no samples. It lands exactly on P_VOID so the
  // picture and the sound go together — this is the cue that sells the cut.
  {
    const t0 = now + P_VOID / 1000;
    // 1. the flyback whine, sliding down and away as the line rate collapses
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(15700, t0);
    o.frequency.exponentialRampToValueAtTime(700, t0 + 0.20);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vol * 0.10, t0);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    o.connect(og).connect(ctx.destination);
    o.start(t0); o.stop(t0 + 0.26);
    voices.push(o);
    // 2. the picture collapsing to a horizontal line and then a dot: a noise
    //    burst through a bandpass that slams shut
    const len = Math.floor(ctx.sampleRate * 0.30);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.6);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(2600, t0);
    bp.frequency.exponentialRampToValueAtTime(180, t0 + 0.18);
    const sg = ctx.createGain(); sg.gain.value = vol * 0.55;
    src.connect(bp).connect(sg).connect(ctx.destination);
    src.start(t0);
    voices.push(src);
    // 3. the thump in the cabinet
    const th = ctx.createOscillator();
    th.type = 'sine';
    th.frequency.setValueAtTime(150, t0);
    th.frequency.exponentialRampToValueAtTime(42, t0 + 0.18);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(vol * 0.42, t0);
    tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
    th.connect(tg).connect(ctx.destination);
    th.start(t0); th.stop(t0 + 0.36);
    voices.push(th);
  }

  // ── CRT on ──
  // The mirror image, on the far side of the silence: the same tube striking back
  // up as the lattice blooms out of the point it collapsed to. A thump, then the
  // flyback whine sliding UP into place and staying — quiet, but present, because
  // the picture is back. It fades out under the city rather than stopping, so it
  // becomes room tone instead of an event.
  {
    const t0 = now + P_CITY / 1000;
    const th = ctx.createOscillator();
    th.type = 'sine';
    th.frequency.setValueAtTime(58, t0);
    th.frequency.exponentialRampToValueAtTime(140, t0 + 0.09);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, t0);
    tg.gain.linearRampToValueAtTime(vol * 0.40, t0 + 0.02);
    tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.40);
    th.connect(tg).connect(ctx.destination);
    th.start(t0); th.stop(t0 + 0.42);
    voices.push(th);

    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(900, t0 + 0.05);
    o.frequency.exponentialRampToValueAtTime(15700, t0 + 0.42);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.linearRampToValueAtTime(vol * 0.055, t0 + 0.45);
    og.gain.linearRampToValueAtTime(vol * 0.030, t0 + 3.5);
    og.gain.linearRampToValueAtTime(0.0001, t0 + 11);
    o.connect(og).connect(ctx.destination);
    o.start(t0); o.stop(t0 + 11.4);
    voices.push(o);
  }

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
  // The same light, overdriven. Everything in this sequence is made of the accent —
  // so a highlight is the accent BLOWN OUT toward white, never a separate colour.
  // Hardcoded near-whites here used to fight a red or amber theme: on a cyan
  // default nobody noticed, on any other one the static and the dying tube were
  // visibly a different piece of hardware from the city.
  const H = { r: lerp(A.r, 255, 0.72), g: lerp(A.g, 255, 0.72), b: lerp(A.b, 255, 0.72) };
  const hot = (a) => `rgba(${Math.round(H.r)},${Math.round(H.g)},${Math.round(H.b)},${a})`;

  // ── Camera ──
  // A pinhole at the world origin looking down +z, with a little pitch and a YAW.
  // Nothing else: no matrices, no near/far planes. `proj` is the only place
  // perspective happens, so every phase gets the same depth for free.
  //
  // The yaw is what makes the flythrough a TRACKING SHOT rather than a corridor
  // run: the camera travels down one axis and looks across it, so the city sweeps
  // through the frame instead of sitting off in one corner of it. Positive yaw
  // looks to the right (+x). Everything that used to treat `z − cam.z` as depth
  // has to go through `depthOf` once this is non-zero, or the whole city sits in
  // the part of the world the near-plane cull throws away.
  const cam = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0 };
  const proj = (x0, y, z) => {
    const f = Math.min(w, h) * 0.95;
    const dx = x0 - cam.x, dy = y - cam.y, dz = z - cam.z;
    const cw = Math.cos(cam.yaw), sw = Math.sin(cam.yaw);
    const x = dx * cw - dz * sw;          // camera-space lateral
    const fz = dz * cw + dx * sw;         // camera-space forward
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const ry = dy * cp - fz * sp;
    let rz = fz * cp + dy * sp;
    if (rz < 0.14) rz = 0.14;             // never divide through the lens
    const s = f / rz;
    return { x: w / 2 + x * s, y: h / 2 + ry * s, s, z: rz };
  };
  // How far in FRONT of the lens a world point is, yaw included. The one thing
  // every cull and every line-width falloff must measure with.
  const depthOf = (x, z) => (z - cam.z) * Math.cos(cam.yaw) + (x - cam.x) * Math.sin(cam.yaw);
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

  // ── Real building shapes ──
  // How many captured pieces a building is allowed. The baked list is ordered most-defining first,
  // so 4 buys the setbacks, the spire and the portico while keeping the stroke count sane: every
  // edge here is its own beginPath, and 240 buildings × 12 edges is already the frame's budget.
  // The bake already trims to the most-defining pieces (tallest always kept), so nothing is sliced
  // here — instead the DRAW picks how many to stroke by distance, because a far tower is a few
  // pixels of cage and every edge is its own beginPath. That keeps the frame near its old cost:
  // most of the ~240 buildings are far, and they stay one box exactly as before.
  const segCountFor = (dist) => (dist < 7 ? 9 : dist < 14 ? 6 : dist < 24 ? 3 : 1);
  const ENT_VEC = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
  // A building's captured segments, resolved and pre-transformed into SCENE offsets around its own
  // position. Done once at build time, never per frame.
  //
  // Corners are carried all the way through model-local → tile → scene individually rather than by
  // composing angles. A segment's `yaw` (the twist on Halcyon, Solenne and the Ascendant spire) and
  // the building's entrance rotation are two different frames, and adding them in the wrong order
  // gives a tower that stands in the right place with its footprint turned the wrong way — right
  // enough to ship unnoticed. Rotating the four corners sidesteps the question entirely.
  const DRUM_MAX_FACETS = 12;   // a wireframe barrel at 30 tiles does not need 24 posts
  const ARCH_RIBS = 7;
  const segsFor = (b, half, h) => {
    const list = shapeFor(b.n, b.t);
    if (!list || !list.length) return null;
    const E = ENT_VEC[b.e] || ENT_VEC.south;
    const px = E[1], py = -E[0];                 // model-local +x = right of the door
    const V = (p) => shapeVal(p, half, h);
    // Model-local → scene, the one place the entrance rotation and the city rotation compose. Every
    // corner of every contour goes through here individually rather than by adding angles — see the
    // note above on why.
    const P2S = (lx, ly) => {
      const tx = lx * px + ly * E[0], ty = lx * py + ly * E[1];   // → tile offset (facePt)
      return [-ty * SPACING, -tx * SPACING];                      // → scene, same axis flip as T2X/T2Z
    };
    const out = [];
    for (const s of list) {
      const cx = V(s.cx), cy = V(s.cy), hx = V(s.hx), hy = V(s.hy);
      // A MAST is a line, so it's the one piece with no width — and the reason it's here is that
      // several buildings hang a crown box, a finial or (the Dead Pigeon) a stuffed bird off the top
      // of one. Without it those pieces float over a gap.
      if (s.kind === 'mast') {
        const p = P2S(V(s.cx), V(s.cy));
        out.push({ kind: 'mast', pts: [p], yTop: GY - V(s.z1), yBot: GY - V(s.z0), tall: false });
        continue;
      }
      if (!(hx > 0.0005) || !(hy > 0.0005)) continue;
      const cw = Math.cos(s.yaw || 0), sw = Math.sin(s.yaw || 0);
      const local = (ax, ay) => P2S(cx + ax * cw - ay * sw, cy + ax * sw + ay * cw);   // yaw applied
      const pts = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([ax, ay]) => local(ax, ay));
      // Scene y is DOWN, ground at GY — so a taller world-z is a smaller y.
      const seg = { pts, yTop: GY - V(s.z1), yBot: GY - V(s.z0), tall: !!s.tall };
      if (s.kind === 'drum') {
        // A ROUND thing, drawn round. Tanks, silos, the Layover's water tower, half the industrial
        // plant in the Yards — boxing these was the single most visible lie in the flythrough.
        // Two rings, because a drum can taper (a cone is rt≈0).
        const n = Math.max(5, Math.min(DRUM_MAX_FACETS, s.n || 8));
        const ring = (r) => Array.from({ length: n }, (_, k) => {
          const a = ((k + 0.5) / n) * Math.PI * 2;
          return local(Math.cos(a) * r, Math.sin(a) * r);
        });
        seg.kind = 'drum';
        seg.pts = ring(V(s.rb));
        seg.top = ring(V(s.rt));
      } else if (s.kind === 'arch') {
        // A barrel roof: an arch over the span (local y), extruded along the length (local x). Held
        // as rib stations with a height FRACTION so the extrusion animation below can raise the
        // whole vault on the same clock as everything else.
        seg.kind = 'arch';
        seg.rib = Array.from({ length: ARCH_RIBS + 1 }, (_, k) => {
          const th = (k / ARCH_RIBS) * Math.PI;
          return { a: local(-hx, Math.cos(th) * hy), b: local(hx, Math.cos(th) * hy), zf: Math.sin(th) };
        });
      }
      out.push(seg);
    }
    return out.length ? out : null;
  };

  const city = (() => {
    const src = rawSkyline.slice(0, 240);
    const out = src.map((b, i) => {
      const seed = ((b.x + 512) * 73 + (b.y + 512) * 149) % 1000 / 1000;
      const floors = floorsFor(b.t, b.f);
      const sx = T2X(b.y, CY), sz = T2Z(b.x, CX);
      const half = (BUILDING_FOOT + seed * 0.05) * SPACING;
      const h = BASE_H + floors * FLOOR_Z * STRETCH * (0.9 + seed * 0.2);
      const segs = segsFor(b, half, h);
      return {
        sx, sz, i,
        half, h, floors, seed,
        // The building's REAL shape, captured out of the flight sim and baked into
        // client/shared/building-shapes.js. `segs` are wireframe boxes in the model's own frame —
        // stepped setbacks, spires, porticos, water towers — so the tower you fly between here is
        // the tower you fly over later, not a box standing in for it. Null for anything with no
        // captured model (or an old server that ships no name/entrance), and the plain box below
        // still handles that case: this is a detail upgrade, never a dependency.
        segs,
        // The building's REAL top. A captured model can stand far above its storey stack — an
        // office tower extrudes to 1.7× it, Halcyon to 2.9× — and the cruise altitude below is
        // derived from this. Miss it and the camera calmly flies THROUGH the tallest towers in
        // the city, which is the sort of thing that only shows up on a first login.
        // From EVERY captured piece, not just the ones drawn at this distance — the camera has to
        // clear the spire whether or not the spire is being stroked this frame.
        // Masts excluded on purpose: the camera should clear the roofs, not the antennas — a spar is
        // a line you'd never see yourself pass, and letting one lift the cruise altitude would push
        // the whole flythrough above the skyline it exists to fly through.
        hMax: segs ? Math.max(h, ...segs.filter((s) => s.kind !== 'mast').map((s) => GY - s.yTop)) : h,
        // Downtown lands first and the edges of the map last, so the city
        // assembles from its middle outward rather than in a flat wipe.
        delay: clamp01(Math.hypot(sx, sz) / 22) * 0.55 + seed * 0.22,
        // Where this building's node comes IN from: high, wide, and scattered —
        // the lattice arriving from everywhere at once.
        ox: (seed - 0.5) * 46, oy: -14 - seed * 22, oz: sz + (seed - 0.5) * 30,
      };
    });
    // NOT sorted here — the painter's order depends on which way the lens ends up
    // facing, and that is decided below (it needs this list to decide it).
    return out;
  })();

  // ── Cruise altitude ──
  // An earlier pass clamped the camera to the roofline PER FRAME: it rode over a
  // tower, dropped into the gap behind it, climbed for the next one. Even damped,
  // that is a camera reacting to the geography — every tower entering the corridor
  // is a bump, and a shot that bobs reads as a physics toy rather than a flight.
  //
  // So the height is decided ONCE, before a frame is drawn: high enough to clear
  // the tallest thing on the whole run with room to spare, and then the vertical
  // axis is a single monotonic eased descent from the approach altitude to that
  // cruise and nothing else. No clamp, no lookahead, no correction. You lose the
  // canyon-diving read and you gain a move that never argues with itself, which is
  // the trade the "it should be smooth" brief is asking for.
  //
  // But it is NOT decided by the tallest thing in Coldwater. Clearing everything
  // put the lens ~15 units up once the captured shapes landed (a model can stand
  // 3.3× its storey stack) — above the haze cutoff, with the city squeezed into
  // the bottom edge of the frame or out of it entirely. And a camera that clears
  // everything is a camera with nothing above it, which is the one thing a city
  // flythrough is for.
  //
  // So the altitude is set just over the MEDIAN roof — above the ordinary blocks,
  // well under the towers, which is the height a skyline actually reads from. The
  // towers are not dodged at all any more: the run is offshore (see the lane
  // below), so there is nothing beside the camera to dodge.
  // The median, not the 62nd percentile, and less headroom: the shot is close and
  // side-on now, and the point of it is that the towers DON'T fit. A skyline you
  // can see the top of from a boat is a town.
  const CRUISE_CLEAR = 0.55;               // headroom over the roofs it does clear
  const roofs = city.map((b) => b.hMax || b.h).sort((a, b) => a - b);
  const medRoof = roofs.length ? roofs[Math.floor(roofs.length * 0.5)] : 2.6;
  const CRUISE_Y = -(medRoof + CRUISE_CLEAR);
  // Up is -y, so this is HIGHER. Shallower than it was, because the run now opens
  // a third of the way into town (FLY_IN below) rather than off the east end: a
  // camera that starts among the towers has already arrived, and a long descent
  // onto a city you're standing over reads as a mistake being corrected.
  const APPROACH_Y = CRUISE_Y - 4.2;
  // Where the run starts and ends in z — the CITY's own extent plus a margin at
  // each end, rather than two hardcoded numbers that had no idea where Coldwater
  // was. A pan should start just off one end of the subject and finish just off the
  // other; anything else is either a wait or a truncation. Hoisted because the
  // reform lattice below has to be positioned relative to the opening station.
  //
  // The window is deliberately NOT symmetric. Screen-right is +z (west), so moving
  // the camera west slides the city LEFT through the frame — so the picture should
  // open with the city already across it rather than with the subject stacked over
  // on the right waiting to be reached.
  //
  // It now opens a THIRD of the way in, and stops just past the far side instead of
  // running a long tail out to sea. Showing the whole of Coldwater was never the
  // job — the sequence is 51s and the audience has a game to get to. Starting among
  // the towers costs nothing (there is no establishing shot to spoil; the whole
  // point is that the city was already there) and buys back the seconds that were
  // going on approach and overshoot, neither of which is a picture of anything.
  // Being closer in also means more parallax per unit travelled, which is why the
  // run can be slower in absolute terms and still read as fast (see FLY_MS).
  const FLY_IN = 0.34;                     // how far into the traverse the run opens
  const zs = city.map((b) => b.sz);
  const zLo = (zs.length ? Math.min(...zs) : -20) - 1.5;
  const zHi = (zs.length ? Math.max(...zs) : 12);
  const FLY_Z0 = lerp(zLo, zHi, FLY_IN);
  const FLY_Z1 = zHi + 4;

  // ── The lane, and where the lens points ──
  // The run is a STRAIGHT LINE, and the only decisions are which line and which way
  // it faces. Both are made here, once, and neither changes for the length of the
  // shot — a camera that steers around a tower is a camera reacting to the
  // geography, which is exactly what the altitude stopped doing a paragraph above.
  //
  // The line is OUT OVER THE WATER, off the city's seaward edge, and the lens looks
  // back across it at the skyline. That buys three things at once:
  //   • clearance is structural rather than searched — nothing is built on water,
  //     so there is nothing to dodge and no solver to go wrong;
  //   • the city fills the frame. Threading a lane between the blocks meant flying
  //     up the map's edge with the whole of Coldwater bunched into one side of the
  //     picture; from offshore, looking in, the skyline lies ACROSS the frame;
  //   • the travel reads as a slide. Facing along the direction of motion makes a
  //     corridor; facing across it makes a tracking shot, and a tracking shot is
  //     what shows a place off.
  // Which side the water is on is read from the coastline, not assumed — the shore
  // runs where the land stops, so the water is whichever side of the city the coast
  // sits toward.
  const cityMinX = Math.min(...city.map((b) => b.sx - b.half));
  const cityMaxX = Math.max(...city.map((b) => b.sx + b.half));
  const SEA_SIDE = (() => {
    const cx = (cityMinX + cityMaxX) / 2;
    const s = Array.isArray(shore) ? shore : [];
    if (!s.length) return 1;
    const mean = s.reduce((a, [, y]) => a + T2X(y - 0.5, CY), 0) / s.length;
    return mean >= cx ? 1 : -1;
  })();
  const SEA_OFF = 2.6;                     // how far offshore, in tiles — close in
  const LANE_X = (SEA_SIDE > 0 ? cityMaxX : cityMinX) + SEA_SIDE * SEA_OFF;
  // …and turned SQUARE to the shore. A PAN, not a diagonal: the lens looks straight
  // across at the city and the city slides through the frame, which is the shot
  // that shows a place off. The 50° version read as neither one thing nor the other
  // — the skyline arrived at an angle and receded at an angle, and everything sat
  // in perspective instead of standing up. Square-on, the towers are vertical, the
  // frame is a section through the city, and the tall ones simply leave the top of
  // it, which is what makes them tall.
  const LANE_YAW = -SEA_SIDE * Math.PI / 2;

  // Far → near along the LOOK direction, a plain painter's pass. Sorting down the
  // map instead would paint the far shore over the near blocks now that the lens is
  // turned across it. It's a wireframe, so this only decides which faint line wins
  // an overlap — but it's one dot product and the alternative is a muddier skyline.
  city.sort((a, b) => (b.sz - a.sz) * Math.cos(LANE_YAW) + (b.sx - a.sx) * Math.sin(LANE_YAW));

  // ── The reform lattice ──
  // The lattice does not simply reappear as a memory — it comes back, in front of
  // the camera out over the water, snaps into its cubic frame one more time, and
  // then every one of its nodes leaves its seat and flies off to become the roof
  // of a building. That's the whole thesis of the sequence made literal: the city
  // is the lattice, so the audience should see the handoff rather than infer it.
  //
  // It's parked a few units ahead of the camera's opening station so it reads at
  // arm's length, at the camera's own eye height, and it's scaled up because at
  // its native size it's a trinket rather than the structure of the world.
  const LAT_S = 2.3;
  // The camera's opening station — hoisted, because the lattice has to be placed
  // relative to where the lens actually is AND to where it is looking.
  const APPROACH_PITCH = 0.30;
  const LAT_AHEAD = 5.2;
  // Placed along the camera's own LOOK direction, not down the map's z axis — the
  // lens is yawed, so "in front of the camera" and "further along the run" stopped
  // being the same place the moment the shot turned to face the shore.
  const LAT_X = LANE_X + Math.sin(LANE_YAW) * LAT_AHEAD;
  const LAT_Z = FLY_Z0 + Math.cos(LANE_YAW) * LAT_AHEAD;
  // Dropped below eye height by exactly the pitch, so the lattice's centre lands
  // on the OPTICAL centre of the frame rather than above it. That point is the
  // whole back half of the sequence — the static collapses into it, the ember
  // holds on it through the silence, the new lattice blooms out of it — and a
  // tube switching off in the top third of the screen reads as a glitch instead
  // of as the picture going out. Match this to the pitch or the CRT-off moves.
  const LAT_Y = APPROACH_Y + LAT_AHEAD * Math.tan(APPROACH_PITCH);
  // Lattice-local → scene. `k` is how far the node has travelled from the lattice
  // CENTRE out to its cubic seat — so at k=0 the entire field is one point, which
  // is exactly the point the static collapsed to and the ember has been sitting on
  // through the silence. The lattice doesn't reappear; it grows back out of it.
  const latPos = (n, k) => [
    LAT_X + n.gx * k * LAT_S,
    LAT_Y + n.gy * k * LAT_S,
    LAT_Z + (n.gz - ZC) * k * LAT_S,
  ];
  // Every building is handed one lattice node, and departs from that node's seat.
  // More buildings than nodes, so they share — a seat that serves four towers
  // reads as one point splitting, which is better than the alternative anyway.
  city.forEach((b, i) => {
    const seat = latPos(nodes[i % nodes.length], 1);
    b.ox = seat[0]; b.oy = seat[1]; b.oz = seat[2];
  });

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

  // ── The vanishing point ──────────────────────────────────────────────────────
  // One screen position ties the last three phases together: the static collapses
  // INTO it, the ember that survives the silence sits ON it, and the new lattice
  // blooms OUT of it. It is not screen centre — it's where the reform lattice's
  // own centre projects to from the camera's city-approach station, so the bloom
  // is already in the right place in the world when the picture comes back. That
  // is the whole trick: the cut isn't a cut, it's a continuous point of light.
  function latCenterScreen() {
    const sx = cam.x, sy = cam.y, sz = cam.z, sp = cam.pitch;
    const sw = cam.yaw;
    cam.x = LANE_X; cam.y = APPROACH_Y; cam.z = FLY_Z0; cam.pitch = APPROACH_PITCH; cam.yaw = LANE_YAW;
    const p = proj(LAT_X, LAT_Y, LAT_Z);
    cam.x = sx; cam.y = sy; cam.z = sz; cam.pitch = sp; cam.yaw = sw;
    return p;
  }
  const COLLAPSE_MS = 620;    // how long the picture takes to squeeze to a line
  const EMBER_MS = 1400;      // and how long the point takes to burn down
  const EMBER_FLOOR = 0.05;   // …to a whisper, never quite to nothing

  // The picture squeezing to a horizontal line and then to a point — the single
  // most recognisable thing a dying tube does, and the reason the CRT-off cue in
  // the audio has something to land on.
  function drawCollapseLine(cp, k) {
    const ln = easeOut(k);
    const bw = Math.max(2.6, w * 1.02 * (1 - ln * 0.982));
    const bh = lerp(7, 2.4, ln);
    const a = 0.35 + 0.65 * k;
    ctx.fillStyle = acc(a * 0.45);
    ctx.fillRect(cp.x - bw / 2, cp.y - bh * 1.9, bw, bh * 3.8);
    ctx.fillStyle = hot(a);
    ctx.fillRect(cp.x - bw / 2, cp.y - bh / 2, bw, bh);
  }
  // What's left of it. Burns down over EMBER_MS to EMBER_FLOOR and then just sits
  // there through the silence — far too faint to be a picture, bright enough that
  // the screen is never quite empty, so the bloom on the far side reads as the
  // same light coming back rather than a new thing starting.
  function drawEmber(cp, k) {
    const r = Math.max(0.9, 3.6 * k);
    ctx.fillStyle = acc(0.34 * k);
    ctx.beginPath(); ctx.arc(cp.x, cp.y, r * 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = hot(0.92 * k);
    ctx.beginPath(); ctx.arc(cp.x, cp.y, r, 0, Math.PI * 2); ctx.fill();
  }
  const emberAt = (t) => lerp(1, EMBER_FLOOR, easeOut(clamp01((t - P_VOID) / EMBER_MS)));

  // The lattice breathes on the line. Each beat's arrival brightens the links for
  // about a second — the animation is on the story's clock, not its own.
  const beatPulse = (t) => {
    let best = 1e9;
    for (const b of BEATS) { const d = t - b.t; if (d >= 0 && d < best) best = d; }
    return Math.exp(-best / 900);
  };

  // ── Lattice / tighten / shatter ──
  function drawLattice(t, phase, pulse) {
    cam.x = 0; cam.z = 0; cam.y = 0; cam.pitch = 0; cam.yaw = 0;
    const tighten = smooth(clamp01((t - P_TIGHTEN) / 9200));
    const shatter = phase === 'shatter' ? easeOut(clamp01((t - P_SHATTER) / 2100)) : 0;
    // A full orbit would take ~2 minutes. It should read as "is that moving?"
    const ang = reduced ? 0.34 : 0.34 + t * 0.000050;

    // ── The tube going out ──
    // The static doesn't fade and it doesn't cut. The whole frame — lattice, torn
    // scanlines and all — gets squeezed vertically into a line and then pinched to
    // a point. One canvas transform around the vanishing point does all of it, so
    // there is nothing to keep in sync: whatever was on screen is what collapses.
    const collapse = reduced ? 0 : clamp01((t - (P_VOID - COLLAPSE_MS)) / COLLAPSE_MS);
    const cp = collapse > 0 ? latCenterScreen() : null;
    if (cp) {
      ctx.save();
      ctx.translate(cp.x, cp.y);
      // Bulges a little wider as it flattens — the picture is being crushed, not
      // scaled, and a tube that only got shorter would read as a window blind.
      ctx.scale(1 + collapse * 0.10, Math.pow(1 - collapse, 2.4));
      ctx.translate(-cp.x, -cp.y);
    }

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
        // Depth still fades the far side of the volume, but never all the way to
        // nothing — the old floor of 0 meant the back half of the field was gone
        // for the whole first act, which is most of what made the opening read as
        // too dark to see.
        const depth = 0.34 + 0.66 * clamp01((6.2 - (a.z + b.z) / 2) / 3.4);
        const al = (1 - d / reach) * (0.56 + 0.44 * tighten) * (1 - shatter) * (0.80 + 0.34 * pulse) * depth;
        if (al <= 0.012) continue;
        ctx.strokeStyle = acc(al);
        ctx.lineWidth = Math.max(0.6, (0.7 + 0.85 * tighten) * (2.6 / ((a.z + b.z) / 2)));
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }

    for (const p of pts) {
      const depth = 0.40 + 0.60 * clamp01((6.4 - p.z) / 3.6);
      const al = (0.86 + 0.14 * tighten) * (1 - shatter * 0.8) * depth;
      if (al <= 0.02) continue;
      const r = Math.max(0.9, (1.5 + 1.25 * tighten) * (2.8 / p.z));
      // Halo in the accent, core overdriven toward white — a node should look like a LAMP in the
      // accent's colour, which is a brighter thing than a bigger blob of flat accent.
      ctx.fillStyle = acc(al * 0.30);
      ctx.beginPath(); ctx.arc(p.x, p.y, r * 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = hot(al);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    }

    // The exchange: scanline static torn across the frame. In the LATTICE's own
    // colour, not white — this is the network tearing itself apart, and it should
    // be made of the same light as everything that came before it. A couple of
    // blown-out lines survive as highlights so it still reads as static rather
    // than as a wash — and those are the accent overdriven (`hot`), not a fixed
    // near-white, so the tearing is the theme's colour on every theme.
    if (shatter && !reduced) {
      for (let i = 0; i < 44 * shatter; i++) {
        const y = Math.random() * h;
        const a = Math.random() * 0.40 * shatter;
        ctx.fillStyle = Math.random() < 0.12 ? hot(a) : acc(a);
        ctx.fillRect(0, y, w, Math.random() * 2.5);
      }
    }

    // Out from under the squeeze, and the line itself on top of it — the line is
    // drawn unsquashed because it IS the collapse, not a victim of it.
    if (cp) { ctx.restore(); drawCollapseLine(cp, collapse); }
  }

  // ── The city ──
  //
  // Coldwater as a WIREFRAME, and we fly through it. Three overlapping movements:
  //
  //   1. ARRIVAL. The lattice comes back first — the same node field, snapping into
  //      the same cubic frame, hanging in front of the camera out over the water.
  //      Then every building's node departs from a SEAT IN THAT FRAME and lands on
  //      the building's ROOFTOP. The transformation is shown rather than implied:
  //      for a couple of seconds the frame and the city it is becoming are both on
  //      screen, and the points streaming between them are the same points.
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
    if (behind(a[0], a[2]) || behind(b[0], b[2])) return;
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
  const behind = (x, z) => depthOf(x, z) < 0.6;

  // The lattice, one last time: the cloud pulling back into its cubic frame in
  // front of the camera, holding for a beat, and dissolving as the buildings it
  // is about to become peel away from its seats.
  function drawReform(t, snap, fade) {
    // The ember flaring back up, under everything: the point brightens hard just
    // as the field starts to leave it, which is what sells "it came out of there".
    const flare = clamp01(1 - snap * 2.2);
    if (flare > 0.01) drawEmber(latCenterScreen(), Math.max(EMBER_FLOOR, flare) * fade);
    const pts = nodes.map((n) => {
      // Staggered, so the field doesn't leave the point as a single ring. Each
      // node's own seed decides how long it waits before it's pushed out.
      const k = smooth(clamp01((snap - n.seed * 0.34) / 0.66));
      const [x, y, z] = latPos(n, k);
      const p = proj(x, y, z);
      p.lx = n.gx * k; p.ly = n.gy * k; p.lz = (n.gz - ZC) * k;
      return p;
    });
    // Same proximity rule as the first act, at the tightened reach — so it comes
    // back as the frame it left as, not as the cloud it started as. Skipped while
    // the field is still collapsed on the point: every node is within reach of
    // every other, and three thousand zero-length strokes buy nothing the flare
    // isn't already doing.
    const reach = 0.74;
    ctx.lineCap = 'round';
    if (snap > 0.06) for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j];
        const d = Math.hypot(a.lx - b.lx, a.ly - b.ly, a.lz - b.lz);
        if (d > reach) continue;
        const al = (1 - d / reach) * 0.82 * fade;
        if (al <= 0.012) continue;
        ctx.strokeStyle = acc(al);
        ctx.lineWidth = Math.max(0.65, 2.9 / ((a.z + b.z) / 2));
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
    for (const p of pts) {
      const al = 0.98 * fade;
      const r = Math.max(0.95, 6.2 / p.z);
      ctx.fillStyle = acc(al * 0.28);
      ctx.beginPath(); ctx.arc(p.x, p.y, r * 3.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = hot(al);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawCity(t) {
    const ct = t - P_CITY;
    // The lattice reassembles first and the city only starts leaving it once it's
    // whole — hence the offset. Deliberately allowed past 1: the per-building
    // stagger subtracts up to 0.32 from it, so a clamp at 1 would leave the
    // last-arriving buildings on the rim of the map permanently half-lit.
    const REFORM_MS = 2400;
    const assemble = Math.min(1.7, (ct - REFORM_MS) / 9000);
    // The run. Held back until the city has mostly landed, then eased the whole
    // way through it and out the far side — the camera never stops, which is why
    // the wordmark can land over it without anything having to "finish".
    // Sized so the run is STILL GOING when the wordmark lands — the one property
    // this shot can't lose. It's the whole city act (RUN_MS - P_CITY) minus the
    // reform and the hold, so shortening the sequence shortens the flight rather
    // than parking the camera for the last few seconds.
    //
    // The hold before it moves came down with the approach: there is less to
    // arrive from now that the run opens inside the city (FLY_IN), and a static
    // frame is only worth holding while something is still assembling in it.
    const HOLD_MS = 3000;
    const FLY_MS  = RUN_MS - P_CITY - REFORM_MS - HOLD_MS;
    const fly = smooth(clamp01((ct - REFORM_MS - HOLD_MS) / FLY_MS));
    // Tracks WEST along the waterfront, from just off one end of the city to just
    // off the other (see the ORIENTATION note above). With the lens square to the
    // shore this is a dolly, not a flight: the travel is entirely across the frame.
    cam.z = lerp(FLY_Z0, FLY_Z1, fly);
    // The chosen lane, held for the whole run. Dead straight, on purpose: a sway
    // that a tower happens to pass through reads as a dodge even when the clock
    // driving it has nothing to do with the tower, and there is no amount of "it's
    // only breathing" that survives someone seeing it swerve once.
    cam.x = LANE_X;
    // …and held facing the shore for the same reason. The lens does not turn ONCE
    // in this shot: it slides along the waterfront looking in, which is what makes
    // the city read as a place being surveyed rather than a corridor being flown.
    cam.yaw = LANE_YAW;
    // The vertical axis, in one line: a single eased descent from the approach
    // altitude to the cruise, which was chosen up front to sit just over the
    // ordinary rooflines. Nothing else touches cam.y — no roofline lookahead, no clamp, no
    // recovery. Whatever the skyline does underneath, the lens never reacts to it,
    // and that is what makes the move read as smooth.
    cam.y = lerp(APPROACH_Y, CRUISE_Y, fly);
    // Pitch rides the same single curve: nose down out of the approach, levelling
    // off as it settles onto the cruise.
    cam.pitch = lerp(APPROACH_PITCH, 0.05, fly);

    // Sky: cold above, sodium at street level. The Basin's lights are the only
    // warm colour anywhere in the sequence.
    const p = smooth(clamp01(assemble));
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, 'rgba(0,0,0,0)');
    sky.addColorStop(0.52, `rgba(20,32,44,${0.40 * p})`);
    sky.addColorStop(1, `rgba(255,168,84,${0.13 * p})`);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

    // ── The lattice, returning ──
    // It snaps back into its cubic frame over the first REFORM_MS, then dissolves
    // over the following two seconds — which is exactly the window the buildings
    // are peeling off its seats in. For a beat you see both: the frame still hanging
    // there and its own nodes streaming out of it toward the ground.
    const latFade = 1 - clamp01((ct - REFORM_MS + 400) / 2200);
    // Linear, not eased — the per-node stagger inside drawReform eats a third of
    // this range and eases each node on its own, so easing it twice just makes the
    // whole field hesitate in the middle.
    if (latFade > 0.012) drawReform(t, clamp01(ct / (REFORM_MS - 400)), latFade);

    // A bank, applied to the whole frame. Two degrees of roll is the difference
    // between a camera move and a FLIGHT. It went back to a slow sine when the run
    // became a straight line: there are no turns left to lean into, and rolling on
    // the geometry was the same tell as steering on it.
    // Halved along with the sway: at a fixed lateral offset the roll is the only
    // thing moving the frame, so it has to stay under the threshold where a tower
    // sliding past the edge looks like the lens leaning away from it.
    const bank = reduced ? 0 : Math.sin(ct / 6200) * 0.015 * fly;
    if (bank) { ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(bank); ctx.translate(-w / 2, -h / 2); }

    // ── The coast ──
    // Where land meets water, traced BEFORE anything is built on it: the Basin
    // arrives as an outline, the way a plan is drawn before a city is. Coldwater
    // sits on the south shore of a body that also runs east of it, so the run
    // opens out over open water and comes ashore — the coastline is the first
    // thing in the frame and stays off to starboard the whole way in.
    // It dims once the towers are up; by then it's the horizon, not the subject.
    const shoreA = clamp01((ct - REFORM_MS) / 2800) * (0.60 - 0.26 * clamp01((ct - REFORM_MS - 6000) / 7000));
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

      const top = GY - (b.hMax || b.h);   // the real roofline — where the lattice node lands
      // The node: from somewhere out there to exactly this rooftop.
      const nx = lerp(b.ox, b.sx, land), ny = lerp(b.oy, top, land), nz = lerp(b.oz, b.sz, land);
      const np = proj(nx, ny, nz);
      const nhz = behind(nx, nz) ? 0 : haze(np.z);
      if (nhz > 0.02) {
        // Bright while travelling, settling to a rooftop beacon once it's home.
        const na = (1.00 - 0.45 * land) * nhz + 0.38 * land * nhz;
        const nr = Math.max(1.0, (2.8 - 1.3 * land) * (9 / np.z));
        ctx.fillStyle = acc(na * 0.26);
        ctx.beginPath(); ctx.arc(np.x, np.y, nr * 3.6, 0, Math.PI * 2); ctx.fill();
        // The node's own core burns hotter than its halo — still the accent, just overdriven, so a
        // rooftop beacon reads as a POINT OF LIGHT rather than a coloured dot.
        ctx.fillStyle = hot(Math.min(1, na * 1.15));
        ctx.beginPath(); ctx.arc(np.x, np.y, nr, 0, Math.PI * 2); ctx.fill();
      }
      if (grow <= 0.002) continue;

      const bot = lerp(top, GY, grow);      // hangs down from the roof
      const x0 = b.sx - b.half, x1 = b.sx + b.half;
      const z0 = b.sz - b.half, z1 = b.sz + b.half;
      // Fully past the lens. Measured on the building's CENTRE with a slack of its
      // own footprint, because with a yawed camera "behind" is a diagonal and a
      // corner test culls towers that are still half in frame.
      if (depthOf(b.sx, b.sz) < -b.half * 2) continue;
      const hz = haze(proj(b.sx, top, b.sz).z);
      if (hz <= 0.02) continue;
      // Brighter than the first pass, and a heavier line. A wireframe city at 0.42 alpha reads as a
      // smudge on anything but an OLED in a dark room — the whole shot is one colour on black, so
      // there is nothing for it to blow out against.
      const al = 0.72 * hz, lw = Math.max(0.6, 1.45 * clamp01(9 / Math.max(0.6, depthOf(b.sx, b.sz))));

      if (b.segs) {
        // The building's REAL form: stepped setbacks, a spire, a portico, a rooftop water tower —
        // the same geometry the flight sim extrudes, so this IS the city you'll fly over later
        // rather than a stand-in for it. Each piece extrudes down from its own top on the shared
        // clock, so a tower still assembles roof-first instead of arriving whole.
        const nSeg = segCountFor(depthOf(b.sx, b.sz));
        // A dropped middle leaves a HOLE, not a simpler tower. The cull below keeps
        // the first N pieces plus the spire, which is right when the tail is
        // ornament (a finial, a water tower) and wrong when the model is a STACK:
        // an office tower is base → middle → crown, so culling to N=1 drew the base
        // and the crown with nothing between them. With the window lights still
        // running the full height, distant towers read as floating strings of lit
        // dots — which is exactly what they were.
        //
        // So a skipped run is not discarded, it is INHERITED: the next piece that
        // does draw extends down to cover it. The silhouette keeps its setbacks
        // (the crown is still narrower than the base) and the tower is solid again,
        // at no extra stroke cost.
        let gapBot = null;   // scene y is DOWN, so "lower" is a LARGER y
        for (let si = 0; si < b.segs.length; si++) {
          const sg = b.segs[si];
          // The spire always draws, however far away. It sorts last (almost no bulk) but it is the
          // single most recognisable thing about a tower on a skyline — dropping it at distance
          // would turn Halcyon and Solenne back into the plain slabs this work exists to replace.
          if (si >= nSeg && !sg.tall && sg.kind !== 'mast') {
            // Masts are lines with no bulk — they can never stand in for a shaft.
            if (sg.kind !== 'mast') gapBot = gapBot === null ? sg.yBot : Math.max(gapBot, sg.yBot);
            continue;
          }
          const sTop = sg.yTop;
          // Absorb the run culled beneath this piece. Masts keep their own length —
          // stretching an antenna down through the building it sits on would be worse
          // than the gap.
          const rawBot = (gapBot !== null && sg.kind !== 'mast') ? Math.max(sg.yBot, gapBot) : sg.yBot;
          if (sg.kind !== 'mast') gapBot = null;
          const sBot = lerp(sTop, rawBot, grow);
          if (sg.kind === 'mast') {
            // One line, at any distance — it costs a single stroke and it's the difference between a
            // finial standing on an antenna and a finial standing on nothing. Extrudes DOWN from the
            // tip on the shared clock like everything else, so it arrives with the crown it carries.
            const p = sg.pts[0];
            stroke3([b.sx + p[0], sTop, b.sz + p[1]], [b.sx + p[0], sBot, b.sz + p[1]], al * 0.9, lw);
            continue;
          }
          if (sg.kind === 'arch') {
            // A vault, unrolling downward: the ridge is already at the top, and the eave drops away
            // from it on the shared clock.
            const eave = sBot, rise = eave - sTop;
            for (let k = 0; k <= ARCH_RIBS; k++) {
              const r = sg.rib[k], y = eave - rise * r.zf;
              const A0 = [b.sx + r.a[0], y, b.sz + r.a[1]], B0 = [b.sx + r.b[0], y, b.sz + r.b[1]];
              stroke3(A0, B0, al * (k === Math.round(ARCH_RIBS / 2) ? 1.5 : 0.8), lw);   // the ridge is the bright one
              if (k < ARCH_RIBS) {
                const q = sg.rib[k + 1], y2 = eave - rise * q.zf;
                stroke3(A0, [b.sx + q.a[0], y2, b.sz + q.a[1]], al, lw);   // the two end ribs
                stroke3(B0, [b.sx + q.b[0], y2, b.sz + q.b[1]], al, lw);
              }
            }
            continue;
          }
          // A drum has its own bottom ring (it can taper); a box reuses its top ring for both.
          const P = sg.pts, T = sg.top || sg.pts, N = P.length;
          for (let k = 0; k < N; k++) {
            const n = (k + 1) % N;
            const tx = b.sx + T[k][0], tz = b.sz + T[k][1], tnx = b.sx + T[n][0], tnz = b.sz + T[n][1];
            const ax = b.sx + P[k][0], az = b.sz + P[k][1], bx = b.sx + P[n][0], bz = b.sz + P[n][1];
            stroke3([tx, sTop, tz], [tnx, sTop, tnz], al * 1.5, lw);      // roof ring, brightest
            stroke3([tx, sTop, tz], [ax, sBot, az], al, lw);              // corner post, growing down
            if (grow > 0.97) stroke3([ax, rawBot, az], [bx, rawBot, bz], al * 0.85, lw);   // base ring, once landed
          }
        }
      } else {
        // No captured shape (an unmodelled tile, or an old server shipping no name/entrance) — the
        // original plain box, unchanged.
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
            if (behind(px, pz)) continue;
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
    if (phase === 'city') drawCity(t);
    // "Silence." is still black and still nothing — except for the point the
    // picture collapsed to, burning down and then holding at a whisper. Without
    // it the far side of the silence is a new sequence starting; with it, it's
    // the same light coming back.
    else if (phase === 'void') { if (!reduced) drawEmber(latCenterScreen(), emberAt(t)); }
    else drawLattice(t, phase, reduced ? 0 : beatPulse(t));
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
      <!-- The gate is a PIECE OF HARDWARE, not a dialog box. The first thing the game
           ever shows you is now the same object the rest of it is made of: a chassis
           with a bezel, a status strip, a lamp and a screen behind glass — the tablet
           you'll be issued at the vat, running the terminal that's about to reinstate
           you. It was a centred paragraph on black before, which is a website asking
           permission to play a video. This is Coldwater Basin telling you it's ready.
           Every class the JS touches is unchanged; this is chrome around it. -->
      <div class="intro-cine-gate-card">
        <div class="intro-cine-gate-bar">
          <span class="intro-cine-gate-lamp" aria-hidden="true"></span>
          <span class="intro-cine-gate-dev">MORPHEX//CWB · RESIDENT REINSTATEMENT</span>
          <span class="intro-cine-gate-ver" aria-hidden="true">v9.0.1</span>
        </div>
        <div class="intro-cine-gate-screen">
          <div class="intro-cine-gate-eyebrow">Architect</div>
          <div class="intro-cine-gate-title">Before we begin</div>
          <div class="intro-cine-gate-sub">This opens with sound. Turn it up, or don't — it plays either way.</div>
        <!-- The sound toggle is deliberately NOT a gate. It reflects the player's
             saved audio setting and writes it back, so someone who wants sound can
             have it in one tap without hunting through Settings, and someone who
             wants silence can say so before the first note rather than after it.
             Either way the button below is the only thing that starts anything. -->
        <button type="button" class="intro-cine-gate-sound" id="intro-cine-sound" aria-pressed="false"></button>
        <button type="button" class="intro-cine-gate-btn" id="intro-cine-begin">Begin <span>›</span></button>
        <!-- The skip is stated plainly and up front. Someone who won't sit through
             fifty seconds of backstory is going to hammer Escape regardless; better
             they're told where the door is than left clawing at the frame. The line
             is a shrug, not a scolding — the CODEX app holds all of this anyway. -->
        <!-- Device-agnostic on purpose: SKIP is the one instruction that is true
             everywhere, and Escape is a bonus nobody needs to be told about. The
             tone is a shrug with a raised eyebrow — the CODEX holds all of it, so
             a player who bails has lost nothing but the good version. -->
        <div class="intro-cine-gate-fine">Fifty seconds of how the world ended. If that's a lot to ask, SKIP is right there, and your CODEX will explain it later — to you, slowly.</div>
        </div>
        <!-- The auto-begin, made visible. The sequence has always started on its own
             after AUTO_BEGIN_MS (a player who tabbed away must never be stranded), but
             nothing said so, so it read as the page glitching. Now the terminal shows
             you it's counting — which is also the truest thing this machine could say
             about itself: it is going to proceed with or without your consent. The
             duration is set inline from the one constant, so the bar can never drift
             out of step with the timer it's drawing. -->
        <div class="intro-cine-gate-wait" aria-hidden="true"><i id="intro-cine-wait"></i></div>
      </div>
    </div>
    <button type="button" class="intro-cine-skip show" id="intro-cine-skip" aria-label="Skip the intro" title="It all still happened. You just won't know why.">Skip <span>›</span></button>`;
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
  // Drive the wait bar off the same constant rather than a duplicated CSS duration —
  // the two drifting apart would make the terminal lie about when it's going to move.
  // Motion-off gets no bar at all (the element stays, unanimated and invisible).
  const waitEl = _ov.querySelector('#intro-cine-wait');
  if (waitEl && !reduced) waitEl.style.animationDuration = `${AUTO_BEGIN_MS}ms`;
  let begun = false;
  const begin = () => {
    if (begun) return;
    begun = true;
    gateEl.classList.add('gone');
    setTimeout(() => gateEl.remove(), 520);
    runSequence();
  };
  // ── The sound toggle ───────────────────────────────────────────────────────
  // Writes the player's real audio settings (the same `audio` block the rest of
  // the client reads), so a choice made here is the choice they keep. Every
  // handler stops propagation, because a click anywhere else on the card begins
  // the sequence — turning the sound ON and having the film start under your
  // finger is exactly the accident this button exists to avoid.
  const soundEl = _ov.querySelector('#intro-cine-sound');
  const soundOn = () => { try { return loadSettings().audio?.enabled !== false; } catch { return true; } };
  const paintSound = () => {
    const on = soundOn();
    soundEl.textContent = on ? '🔊  Sound on' : '🔇  Sound off — tap to turn on';
    soundEl.classList.toggle('on', on);
    soundEl.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  soundEl.addEventListener('click', (e) => {
    e.stopPropagation();
    try {
      const s = loadSettings();
      const on = !soundOn();
      s.audio = { ...(s.audio || {}), enabled: on, music: on ? true : s.audio?.music };
      // A player who muted by dragging the volume to zero would otherwise turn
      // "sound" on and still hear nothing, and conclude the button is broken.
      if (on && !(s.audio.masterVolume > 0.05)) s.audio.masterVolume = 0.4;
      saveSettings(s);
    } catch {}
    paintSound();
  });
  paintSound();

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

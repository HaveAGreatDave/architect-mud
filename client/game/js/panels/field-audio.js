// FIELD AUDIO: the recorded sea and the recorded birds, placed where they are in a GLASS view.
//
// The recordings are client/shared/field-recordings.js (CC0, built by
// scripts/audio/build-field-recordings.mjs). They reach SIREN as `sample` layers inside an ordinary
// cue, so they take the same positioned path as everything else in a seat: seatSpot() turns a world
// tile into the seat's frame, and the panner and doppler do the rest. Free look is the case this is
// for: no vehicle, so the camera is all there is, and the shore and the birds have to be where the
// picture says they are.
//
// THE SHORE. One voice: the nearest stretch of water that touches land within SHORE_R of the eye,
// positioned on that water. Which recording depends on what's there: a quay (water against a
// building or a road) laps; open shore breaks, harder as the wind gets up. It's a loop that moves
// with the eye and is let go when there's no shore in range or the view stops painting.
//
// THE BIRDS. birdCue() wraps the FM call procedural-sfx.js makes (unchanged, and still the cue the
// server's seeded events agree with) round a recorded call of the species: the recording plays when
// it's decoded, the FM call is its stand-in until then. The peregrine has no CC0 recording, so it
// keeps its FM call.
//
// ⚠ NEVER LOAD-BEARING. Every call here is wrapped by its caller; a missing engine, a failed fetch
// or a seat that isn't live means silence or the synth, never a thrown frame.

import { FIELD, fieldBed, fieldCall, fieldIds } from '../../../shared/field-recordings.js';
import { seatSpot, seatLive } from './seat-audio.js';
import { seaClock, seaSurfPhaseAt } from '../../../shared/sea-swell.js';

const AE = () => (typeof window !== 'undefined' ? window.AudioEngine : null);

// Which recordings each species calls with. Several each, so a flock isn't one bird on repeat.
export const BIRD_FIELD = {
  goose: ['goose', 'goose', 'goose_chatter'],
  gull: ['gull', 'gull_single', 'gull_trill', 'gulls'],
  pigeon: ['pigeon'],
  songbird: ['sparrow', 'robin'],
  hawk: ['hawk'],
  vulture: ['vulture'],
};
// LUFS a call is levelled to (momentary max), the same as the FM call it stands beside
const CALL_LUFS = -16;
// Off: birds sound only through their CC0 recordings, never the FM synth.
const FM_BIRDS = false;

let _preloaded = false;
function preload() {
  if (_preloaded) return;
  const ae = AE();
  if (!ae?.preloadSamples) return;
  _preloaded = true;
  const keys = new Set([...Object.values(BIRD_FIELD).flat(), ...Object.values(SHORE_FIELD).map((s) => s[0])]);
  ae.preloadSamples(fieldIds([...keys].filter((k) => FIELD[k])));
}

// A bird's FM cue with a recorded call of its species beside it as the main voice. `seed` picks the
// recording and the call, so the same burst picks the same one. Returns the cue as it was for a
// species with no recording.
export function birdCue(cue, sp, seed = 0) {
  preload();
  const keys = BIRD_FIELD[sp];
  // For now only CC0 recordings sound: a species with no recording is silent, and the FM call
  // is dropped rather than standing in (set FM_BIRDS true to bring the synth calls back).
  if (!cue?.config || !keys?.length) return FM_BIRDS ? cue : null;
  const h = Math.abs(seed | 0);
  const call = fieldCall(keys[h % keys.length], h >> 3, CALL_LUFS, { rate: 0.94 + ((h >> 7) % 13) / 100 });
  if (!call) return FM_BIRDS ? cue : null;
  if (!FM_BIRDS) return { ...cue, config: { ...cue.config, layers: [call], duration: call.length / call.rate } };
  const layers = (cue.config.layers || [cue.config]).map((l) => ({ ...l, alt: true }));
  return { ...cue, config: { ...cue.config, layers: [...layers, call], duration: Math.max(cue.config.duration ?? 0.4, call.length / call.rate) } };
}

// ── the shore ──────────────────────────────────────────────────────────────────────────────────
const SHORE_R = 7;           // tiles: about 125 m, past which surf is under the city
const SHORE_ID = 'field:shore';
const SHORE_MS = 400;        // how often the nearest shore is looked for
const STALE_MS = 1500;       // no frame for this long and the voice goes
// kind -> [recording, LUFS]
const SHORE_FIELD = { quay: ['harbour_lap', -22], calm: ['surf_beach', -20], fresh: ['ocean', -19], rough: ['surf_rocks', -17] };
const SH = { at: 0, last: 0, kind: null, pos: null, dog: null, best: null, fp: null };

// ── THE WAVES BREAKING ─────────────────────────────────────────────────────────────────────────
// The loop above is the surf as a bed. On top of it, each wave that breaks on the nearest open shore
// is heard as it goes over: a crash when the lip falls (the swell's phase at that shore crossing
// LIP_PH, where gl/sea-lip.js draws the lip), then the hiss of the wash running up the sand and
// draining back. Timed off the same swell the picture draws, so the sound lands with the wave.
const LIP_PH = -0.2;
// How hard the waves break, from the wind in kph: none on a flat calm, full in a gale.
const surfK = (wind) => Math.max(0, Math.min(1, (wind - 6) / 45));
const crashCue = (k, seed) => ({ category: 'ambient', priority: 3, config: { duration: 3.2 + 1.2 * k, layers: [
  // The lip landing: a broad noise thump that opens and closes as the water hits.
  { waveform: 'noise', noise: 'pink', noiseMix: 1, filter: { type: 'lowpass', freq: 400 + 500 * k, q: 0.7, to: 2400 + 1800 * k, time: 0.18 },
    adsr: { a: 0.03, d: 0.9 + 0.5 * k, s: 0.25, r: 1.6 }, gain: 0.55 + 0.35 * k },
  // Its weight: low and short, more of it in a big sea.
  { waveform: 'noise', noise: 'brown', noiseMix: 1, filter: { type: 'lowpass', freq: 160, q: 0.9 }, adsr: { a: 0.02, d: 0.6, s: 0, r: 0.4 }, gain: 0.45 * k },
  // The white water churning after it: bright noise that tumbles (a slow tremolo) and fades.
  { waveform: 'noise', noise: 'white', noiseMix: 1, filter: { type: 'bandpass', freq: 2600, q: 0.6 }, tremolo: { rate: 7 + (seed % 5), depth: 0.35 },
    adsr: { a: 0.15, d: 1.6 + k, s: 0.1, r: 1.2 }, gain: 0.22 + 0.18 * k },
] } });
// The wash running up the beach and draining back: a hiss that swells and falls over a few seconds.
const washCue = (k) => ({ category: 'ambient', priority: 2, config: { duration: 5, layers: [
  { waveform: 'noise', noise: 'white', noiseMix: 1, filter: { type: 'highpass', freq: 1800, q: 0.5, to: 3400, time: 2.5 },
    adsr: { a: 1.4, d: 1.2, s: 0.45, r: 2.2 }, gain: 0.16 + 0.14 * k },
] } });
let _seed = 1;
function surfBreakFrame(wcx, wcy, wind) {
  const ae = AE(), b = SH.best;
  if (!ae?.playSfx || !b || b.quay) { SH.fp = null; return; }
  const k = surfK(wind);
  if (k <= 0) { SH.fp = null; return; }
  const fp = seaSurfPhaseAt(b.x + 0.5 - wcx, b.y + 0.5 - wcy, seaClock(Date.now()));
  const was = SH.fp;
  SH.fp = fp;
  // The phase rises through the wave at a fixed point; a crossing of LIP_PH from below is a break.
  // A jump of more than a radian (a new shore, a recentre) isn't a crossing.
  if (was == null || !(was < LIP_PH && fp >= LIP_PH) || fp - was > 1) return;
  const pos = seatSpot(b.x, b.y, 0);
  if (!pos) return;
  const at = { position: pos, ref: 1.2, rolloff: 1.1, maxDistance: SHORE_R * 3 };
  try {
    ae.playSfx(crashCue(k, _seed++), 1, at);
    setTimeout(() => { try { ae.playSfx(washCue(k), 1, at); } catch { /* no audio */ } }, 700);
  } catch { /* no audio */ }
}

const isWater = (c) => !!c && (c.kind === 'water' || c.biome === 'water');
const isQuay = (c) => !!c && (!!c.bt || !!c.road);

// The nearest water tile that touches land within `r` tiles of (ex, ey), as { x, y, d2, quay }, or
// null. `cell(x, y)` reads the map. Shared with the Room Stage (room-outdoors.js).
export function nearestShore(cell, ex, ey, r = SHORE_R) {
  ex = Math.round(ex); ey = Math.round(ey);
  let best = null;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > r * r || (best && d2 >= best.d2)) continue;
      const x = ex + dx, y = ey + dy, c = cell(x, y);
      if (!isWater(c)) continue;
      let land = 0, quay = 0;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = cell(x + ox, y + oy);
        if (n && !isWater(n)) { land++; if (isQuay(n)) quay++; }
      }
      if (land) best = { x, y, d2, quay: quay > 0 };
    }
  }
  return best;
}
// Which surf a shore makes in a wind (kph): a quay laps, open shore breaks harder as it gets up.
export const shoreKind = (best, wind) => (best.quay ? 'quay' : wind >= 40 ? 'rough' : wind >= 20 ? 'fresh' : 'calm');
// The surf for a kind: the recording and its stand-in (a slow wash of pink noise), or null.
export function shoreLayers(kind) {
  const s = SHORE_FIELD[kind], bed = s && fieldBed(s[0], s[1]);
  if (!bed) return null;
  preload();
  return [{ waveform: 'noise', noise: 'pink', noiseMix: 1, alt: true, filter: { type: 'lowpass', freq: 900, q: 0.5 }, tremolo: { rate: 0.12, depth: 0.6 }, adsr: { a: 2, d: 0, s: 1, r: 2 }, gain: 0.25 }, bed];
}

function stopShore() {
  try { AE()?.stopLoop?.(SHORE_ID); } catch { /* no audio */ }
  SH.kind = null; SH.pos = null; SH.best = null; SH.fp = null;
  if (SH.dog) { clearInterval(SH.dog); SH.dog = null; }
}

// Once a frame from the GLASS paint. `map` is the view's tile window (rows of cells, centred on
// wcx, wcy, radius R); eyeX/eyeY the eye's world tile; `wind` the view's wind in kph.
export function shoreAudioFrame(map, R, wcx, wcy, eyeX, eyeY, wind = 0, now = performance.now()) {
  const ae = AE();
  if (!ae?.loopSound || !map || !seatLive()) return;
  SH.last = now;
  if (!SH.dog) SH.dog = setInterval(() => { if (performance.now() - SH.last > STALE_MS) stopShore(); }, 500);
  try { surfBreakFrame(wcx, wcy, wind); } catch { /* never load-bearing */ }
  if (now - SH.at < SHORE_MS) return;
  SH.at = now;
  preload();
  const cell = (x, y) => map[y - wcy + R]?.[x - wcx + R] || null;
  const best = nearestShore(cell, eyeX, eyeY);
  if (!SH.best || !best || best.x !== SH.best.x || best.y !== SH.best.y) SH.fp = null;
  SH.best = best;
  if (!best) { if (SH.kind) stopShore(); return; }
  const kind = shoreKind(best, wind);
  const pos = seatSpot(best.x, best.y, 0);
  if (!pos) return;
  if (kind !== SH.kind || !ae.isLooping?.(SHORE_ID)) {
    try { ae.stopLoop?.(SHORE_ID); } catch { /* no audio */ }
    const layers = shoreLayers(kind);
    if (!layers) return;
    try {
      ae.loopSound({ id: SHORE_ID, category: 'ambient', priority: 1, config: { gain: 1, layers } },
        { position: pos, ref: 1.2, rolloff: 1.1, maxDistance: SHORE_R * 3 });
    } catch { return; }
    SH.kind = kind;
  } else {
    try { ae.moveLoop?.(SHORE_ID, pos); } catch { /* no audio */ }
  }
  SH.pos = pos;
}

export { stopShore as shoreAudioStop };

// For a console check.
if (typeof window !== 'undefined') window.__fieldAudio = { shore: () => ({ ...SH, dog: !!SH.dog }), BIRD_FIELD, SHORE_FIELD };

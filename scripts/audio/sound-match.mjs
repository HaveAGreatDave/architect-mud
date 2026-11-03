// SOUND MATCH: fit a SIREN cue to a recording, through the real audio-engine.js.
//
//   node scripts/audio/sound-match.mjs door-slam.wav                     fit a new cue
//   node scripts/audio/sound-match.mjs door-slam.wav --name door_slam    ...named
//   node scripts/audio/sound-match.mjs bell.wav --start my-bell.json     refine a cue you wrote
//   node scripts/audio/sound-match.mjs --cue sfx_cphl_goal_horn           target = a shipped cue's render (a test)
//   node scripts/audio/sound-match.mjs x.wav --only fm,modes --budget 4000 --seconds 1.5
//   node scripts/audio/sound-match.mjs x.wav --analyse                   print the analysis and stop
//
// Writes into sound-match-out/<name>/ (gitignored): <name>.json, a cue in the .amp shape ready for
// content/audio_sfx or the Audio tab's Load button; target.wav and match.wav at 48 kHz to listen
// to side by side; report.txt, the analysis and the fit.
//
// How it works (the why is in docs/reference/fm-sound-matching.md):
//   1. ANALYSE the recording: envelope (attack, T60, sustain, hold), pitch (YIN, with a bend if the
//      f0 moves), the partials just after the attack and each one's own decay, harmonicity
//      (how much energy sits on multiples of f0) and noisiness (spectral flatness).
//   2. PROPOSE templates from that. Each is a cue shape with its discrete choices already made:
//        fm      a sine (or triangle) carrier on f0 with a ratio-locked modulator, op2 when the
//                spectrum is dense; ratios are read off the partial spacing, never searched
//        modes   the measured partials as a struck object, each with its own decay (inharmonic
//                and decaying: bells, glass, metal, wood)
//        sub     a saw or square through a swept low-pass (buzzy, harmonic, held)
//        drum    a sine or triangle body dropping onto its pitch under filtered noise (kicks, toms, snares)
//        noise   filtered noise with an envelope on the cutoff (whooshes, hiss, impacts, steam), and a
//                clap: one burst per onset measured in the first 60 ms
//      plus a filtered-noise transient layer on any of them when the recording is noisy.
//   3. SEARCH the smooth parameters of every template with CMA-ES for a short run, then give the
//      best three the rest of the budget. The distance is multi-resolution log spectra + spectral
//      convergence + the loudness envelope (match-lib.mjs).
//   4. LEVEL the winner to the recording's peak (never over -1 dBFS) and write it out.
//
// A match is a starting point to edit by ear, not a finished cue. For scale: the same patch a
// quarter-tone off is 0.37, a semitone off 1.05, and two takes of one noise patch 0.47 (noise
// never agrees bin for bin). Under 0.7 is close; under 1.2 recognisable; over that, the template
// couldn't make it and you're hearing the nearest thing it could. Synthetic speech, music and long evolving textures won't fit: one cue is one event.

import { writeFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installAudioGlobals, wav } from './offline-audio.mjs';
import { readWav, resample, trim, analyse, Distance, cmaes, decode, encode, apply } from './match-lib.mjs';
import { momentaryMax } from './loudness-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SR = 22050;   // the search renders at this; partials above 10 kHz don't decide a match

// ── engine ───────────────────────────────────────────────────────────────────
let AE = null;
export function engine() {
  if (AE) return AE;
  installAudioGlobals();
  if (!globalThis.AudioEngine) new Function(readFileSync(join(ROOT, 'client/shared/audio-engine.js'), 'utf8'))();
  AE = globalThis.AudioEngine;
  AE._setRetroUrl?.(join(ROOT, 'client/shared/audio-retro-worklet.js'));
  return AE;
}
export async function render(config, seconds, sampleRate = SR) {
  const buf = await engine().renderSfx({ name: 'match', config }, { sampleRate, seconds });
  return buf.getChannelData(0);
}

// ── templates ────────────────────────────────────────────────────────────────
// Each returns { kind, label, config, space, x0 } with x0 in the unit box.
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const P = (path, lo, hi, log = false, init) => ({ path, lo, hi, log, init });

function envSpace(an, prefix, len) {
  // held: the level after the attack falls slower than 10 dB a second (an organ, a hum); anything
  // faster is a decay, however loud its middle reads
  const t60 = an.env.t60, held = an.env.held;
  return [
    P(`${prefix}.adsr.a`, 0.0005, clamp(len * 0.8, 0.002, 2), true, clamp(an.env.attack, 0.0005, len * 0.8)),
    P(`${prefix}.adsr.d`, 0.005, clamp(len * 3, 0.05, 12), true, clamp(t60 * 0.43, 0.006, len * 3)),
    P(`${prefix}.adsr.s`, 0, 1, false, held ? clamp(Math.pow(10, an.env.sustainDb / 20), 0, 1) : 0.02),
    P(`${prefix}.adsr.r`, 0.01, clamp(len, 0.05, 4), true, clamp((an.length - an.env.holdEnd) * 0.5, 0.012, len)),
  ];
}
function noiseLayer(an, len, idx) {
  const c = an.centroid.length ? an.centroid.reduce((s, f) => s + f.hz, 0) / an.centroid.length : 2000;
  return {
    layer: { waveform: 'noise', noiseMix: 1, noise: 'white', gain: 0.3, filter: { type: 'bandpass', freq: 2000, q: 1 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.05, curve: 'exp' } },
    space: [
      P(`layers.${idx}.gain`, 0.005, 2, true, 0.25),
      P(`layers.${idx}.filter.freq`, 120, SR * 0.45, true, clamp(c, 150, SR * 0.4)),
      P(`layers.${idx}.filter.q`, 0.3, 10, true, 0.8),
      P(`layers.${idx}.adsr.a`, 0.0005, clamp(len * 0.5, 0.002, 1), true, 0.001),
      P(`layers.${idx}.adsr.d`, 0.004, clamp(len * 2, 0.02, 8), true, clamp(an.env.t60 * 0.2, 0.005, len)),
      P(`layers.${idx}.adsr.s`, 0, 1, false, an.noisiness > 0.3 ? 0.3 : 0.02),
    ],
  };
}
const pickHold = (an, len) => P('duration', 0.005, len, true, clamp(an.env.holdEnd || len * 0.5, 0.006, len));

function fmTemplate(an, len, { wave = 'sine', carrier, ratio, ratio2 = null, noise = false }) {
  const f0 = carrier, bend = an.pitch.f0Start && an.pitch.f0End && Math.abs(an.pitch.f0End / an.pitch.f0Start - 1) > 0.03;
  const layer = {
    waveform: wave, freq: +(bend ? an.pitch.f0Start : f0).toPrecision(5), gain: 0.6,
    fm: { ratio, index: 2, indexEnd: 0.5, time: 0.3 },
    adsr: { a: 0.002, d: 0.3, s: 0, r: 0.2, curve: 'exp' },
    filter: { type: 'lowpass', freq: 8000, q: 0.7 },
  };
  // the centroid's fall from the attack to the tail is what the index sweep has to make
  const c0 = an.centroid[0]?.hz || f0 * 3, c1 = an.centroid[an.centroid.length - 1]?.hz || f0 * 1.5;
  const idx = (c) => clamp((c / f0 - 1) / Math.max(0.5, ratio), 0.05, 10);
  const space = [
    pickHold(an, len),
    P('layers.0.fm.index', 0, 12, false, idx(c0)),
    P('layers.0.fm.indexEnd', 0, 12, false, idx(c1) * 0.6),
    P('layers.0.fm.time', 0.005, clamp(len * 2, 0.05, 6), true, clamp(an.env.t60 * 0.3, 0.006, len)),
    ...envSpace(an, 'layers.0', len),
    P('layers.0.filter.freq', 150, SR * 0.45, true, SR * 0.4),
    P('layers.0.detune', -30, 30, false, 0),
  ];
  if (bend) {
    layer.pitchBend = { to: an.pitch.f0End, time: len * 0.5 };
    space.push(P('layers.0.pitchBend.to', an.pitch.f0End * 0.85, an.pitch.f0End * 1.15, true, an.pitch.f0End));
    space.push(P('layers.0.pitchBend.time', 0.005, clamp(len * 2, 0.05, 6), true, clamp(len * 0.4, 0.006, len)));
  }
  if (ratio2) {
    layer.fm.op2 = { ratio: ratio2, index: 0.5, indexEnd: 0.1 };
    space.push(P('layers.0.fm.op2.index', 0, 6, false, 0.6), P('layers.0.fm.op2.indexEnd', 0, 6, false, 0.1));
  }
  const config = { duration: len * 0.5, layers: [layer] };
  if (noise) { const n = noiseLayer(an, len, 1); config.layers.push(n.layer); space.push(...n.space); }
  return { kind: 'fm', label: `fm ${wave} c=${f0.toFixed(1)} r=${ratio}${ratio2 ? ` op2=${ratio2}` : ''}${bend ? ' bend' : ''}${noise ? ' +noise' : ''}`, config, space };
}

function modesTemplate(an, len, { noise = false } = {}) {
  const ps = an.partials.filter((p) => p.amp > 0.01).slice(0, 8);
  if (!ps.length) return null;
  const layer = { modes: { hardness: 0.7, strike: clamp(an.noisiness * 2, 0, 0.8), partials: ps.map((p) => ({ freq: +p.freq.toPrecision(5), decay: +clamp(p.t60, 0.02, 20).toPrecision(3), gain: +p.amp.toPrecision(3) })) }, gain: 0.5 };
  const space = [
    P('layers.0.modes.hardness', 0, 1, false, 0.7),
    P('layers.0.modes.strike', 0, 1, false, layer.modes.strike),
  ];
  ps.forEach((p, i) => {
    space.push(P(`layers.0.modes.partials.${i}.gain`, 0.003, 1.5, true, clamp(p.amp, 0.004, 1.4)));
    space.push(P(`layers.0.modes.partials.${i}.decay`, 0.02, 20, true, clamp(p.t60, 0.021, 19)));
  });
  const config = { duration: 0.05, layers: [layer] };
  if (noise) { const n = noiseLayer(an, len, 1); config.layers.push(n.layer); space.push(...n.space); }
  return { kind: 'modes', label: `modes ×${ps.length}${noise ? ' +noise' : ''}`, config, space };
}

function subTemplate(an, len, { wave = 'sawtooth' } = {}) {
  const f0 = an.pitch.f0;
  const layer = {
    waveform: wave, freq: +f0.toPrecision(5), gain: 0.5,
    filter: { type: 'lowpass', freq: 2000, q: 1 },
    adsr: { a: 0.005, d: 0.3, s: 0.5, r: 0.2, curve: 'exp' },
    mods: [{ id: 'env1', type: 'env', a: 0.002, d: 0.3, s: 0, r: 0.2, curve: 'exp', to: [{ param: 'filter.cutoff', amount: 1200 }] }],
  };
  const space = [
    pickHold(an, len), ...envSpace(an, 'layers.0', len),
    P('layers.0.filter.freq', 80, SR * 0.45, true, clamp((an.centroid[an.centroid.length - 1]?.hz || 2000) * 1.5, 90, SR * 0.4)),
    P('layers.0.filter.q', 0.3, 12, true, 1),
    P('layers.0.mods.0.d', 0.005, clamp(len * 2, 0.05, 6), true, clamp(an.env.t60 * 0.3, 0.006, len)),
    P('layers.0.mods.0.to.0.amount', -2400, 4800, false, 1200),
    P('layers.0.detune', -30, 30, false, 0),
  ];
  return { kind: 'sub', label: `sub ${wave}`, config: { duration: len * 0.5, layers: [layer] }, space };
}

function noiseTemplate(an, len, { type = 'bandpass', colour = 'white' } = {}) {
  const c = an.centroid.length ? an.centroid.reduce((s, f) => s + f.hz, 0) / an.centroid.length : 2000;
  const layer = {
    waveform: 'noise', noiseMix: 1, noise: colour, gain: 0.6,
    filter: { type, freq: clamp(c, 150, SR * 0.4), q: 1 },
    adsr: { a: 0.002, d: 0.2, s: 0.3, r: 0.2, curve: 'exp' },
    mods: [{ id: 'env1', type: 'env', a: 0.002, d: 0.3, s: 0, r: 0.2, curve: 'exp', to: [{ param: 'filter.cutoff', amount: 0 }] }],
  };
  const space = [
    pickHold(an, len), ...envSpace(an, 'layers.0', len),
    P('layers.0.filter.freq', 60, SR * 0.45, true, layer.filter.freq),
    P('layers.0.filter.q', 0.3, 12, true, 1),
    P('layers.0.mods.0.a', 0.0005, clamp(len, 0.01, 3), true, 0.002),
    P('layers.0.mods.0.d', 0.005, clamp(len * 2, 0.05, 6), true, clamp(len * 0.4, 0.006, len)),
    P('layers.0.mods.0.to.0.amount', -4800, 4800, false, 0),
  ];
  return { kind: 'noise', label: `noise ${colour} ${type}`, config: { duration: len * 0.5, layers: [layer] }, space };
}

// A drum: a sine (or triangle) body that drops onto its pitch, under filtered noise. The body is
// the strongest partial under 400 Hz, or the lowest strong one; the drop's start is searched,
// because a kick's sweep is over before YIN can see it.
function drumTemplate(an, len, { noise = true, wave = 'sine' } = {}) {
  const strong = an.partials.filter((p) => p.amp > 0.1);
  const low = strong.filter((p) => p.freq < 400).sort((a, b) => b.amp - a.amp)[0] || [...strong].sort((a, b) => a.freq - b.freq)[0];
  if (!low) return null;
  const f = low.freq;
  const layer = {
    waveform: wave, freq: +(f * 1.6).toPrecision(4), gain: 0.6,
    pitchBend: { to: +f.toPrecision(4), time: 0.04 },
    adsr: { a: 0.001, d: 0.2, s: 0, r: 0.05, curve: 'exp' },
  };
  const space = [
    P('duration', 0.005, len, true, clamp(an.env.holdEnd || 0.02, 0.006, len)),
    P('layers.0.freq', f * 0.95, f * 6, true, f * 1.6),
    P('layers.0.pitchBend.to', f * 0.85, f * 1.15, true, f),
    P('layers.0.pitchBend.time', 0.003, clamp(len, 0.02, 1), true, 0.04),
    P('layers.0.adsr.a', 0.0005, 0.03, true, 0.001),
    P('layers.0.adsr.d', 0.01, clamp(len * 3, 0.05, 6), true, clamp(low.t60 * 0.43, 0.011, len * 3)),
    P('layers.0.adsr.r', 0.01, clamp(len, 0.05, 2), true, 0.05),
    P('layers.0.gain', 0.02, 2, true, 0.6),
  ];
  const config = { duration: 0.02, layers: [layer] };
  if (noise) { const n = noiseLayer(an, len, 1); config.layers.push(n.layer); space.push(...n.space); }
  return { kind: 'drum', label: `drum ${wave} ${f.toFixed(0)}Hz${noise ? ' +noise' : ''}`, config, space };
}

// A clap: one filtered-noise burst per measured onset, one shared filter, each burst its own level,
// and a longer tail on the last (the room).
function clapTemplate(an, len) {
  const b = an.env.bursts, n = b.length;
  const c = an.centroid.length ? an.centroid.reduce((s, f) => s + f.hz, 0) / an.centroid.length : 1200;
  const layers = b.map((t, i) => ({
    waveform: 'noise', noiseMix: 1, noise: 'white', noiseSeed: 7 + i * 13, delay: t, gain: 0.5,
    filter: { type: 'bandpass', freq: clamp(c, 300, 6000), q: 1.2 },
    adsr: { a: 0.0005, d: i === n - 1 ? 0.15 : 0.012, s: 0, r: 0.03, curve: 'exp' },
  }));
  const all = (k) => b.map((_, i) => `layers.${i}.${k}`);
  const space = [
    P(all('filter.freq'), 200, SR * 0.45, true, clamp(c, 300, 6000)),
    P(all('filter.q'), 0.3, 8, true, 1.2),
    P(b.slice(0, -1).map((_, i) => `layers.${i}.adsr.d`), 0.002, 0.05, true, 0.012),
    P(`layers.${n - 1}.adsr.d`, 0.02, clamp(len * 3, 0.1, 4), true, clamp(an.env.t60 * 0.43, 0.021, len * 3)),
    ...b.map((_, i) => P(`layers.${i}.gain`, 0.02, 2, true, 0.5)),
  ];
  return { kind: 'clap', label: `clap ×${n}`, config: { duration: 0.005, layers }, space };
}

// A config you wrote: every number at a key the search knows is free to move within a factor of
// three (a level within 0..1). Discrete things stay put: waves, types, ratios, partial frequencies.
const LOG_KEYS = new Set(['a', 'd', 'r', 'time', 'decay', 'duration', 'q', 'gain', 'delay']);
const LIN_KEYS = new Set(['s', 'index', 'indexEnd', 'noiseMix', 'drive', 'hardness', 'strike', 'amount', 'mix', 'feedback', 'depth']);
function refineTemplate(config, len) {
  const space = [];
  const walk = (o, path) => {
    for (const [k, v] of Object.entries(o)) {
      const p = path ? `${path}.${k}` : k;
      if (v && typeof v === 'object') { walk(v, p); continue; }
      if (typeof v !== 'number' || k === 'freq' && /\.partials\./.test(p)) continue;
      if (k === 'freq' && /filter|formants/.test(p)) space.push(P(p, Math.max(40, v / 3), Math.min(SR * 0.45, v * 3), true, v));
      else if (k === 'to' && /pitchBend/.test(p)) space.push(P(p, v / 1.3, v * 1.3, true, v));
      else if (k === 'detune') space.push(P(p, v - 50, v + 50, false, v));
      else if (k === 'amount') space.push(P(p, Math.min(v * 2, -Math.abs(v) - 100), Math.max(v * 2, Math.abs(v) + 100), false, v));
      else if (LOG_KEYS.has(k) && v > 0) space.push(P(p, v / 3, k === 'duration' ? Math.max(v, len) : v * 3, true, v));
      else if (LIN_KEYS.has(k) && k !== 'amount') {
        const hi = ['s', 'noiseMix', 'drive', 'hardness', 'strike', 'mix', 'feedback'].includes(k) ? 1 : Math.max(1, v * 3);
        space.push(P(p, 0, hi, false, v));
      }
    }
  };
  walk(config, '');
  return { kind: 'refine', label: 'refine --start', config, space };
}

// Carrier and modulator, read off the partials. FM puts its lines at |c + k·m| for every integer k
// (the ones below zero reflect), so a pair (c, m) is scored by how much of the measured energy sits
// on one of its lines, less a little for each line it predicts inside the measured band that isn't
// there. Candidate modulators are the spacings between strong partials; candidate carriers are
// the partials themselves and f0. This is what fixes the matcher's worst miss: a 330 Hz carrier
// under a 3.5 ratio makes a spectrum whose strongest line is 1980 Hz and whose f0 is 165 Hz, and
// neither of those is the carrier. Returns up to six { c, ratio, score }, best first.
export function fmPairs(an, max = 6) {
  const ps = an.partials.slice(0, 12), nyq = SR * 0.45;
  if (!ps.length) return [];
  const top = Math.max(...ps.map((p) => p.freq)), total = ps.reduce((s, p) => s + p.amp * p.amp, 0);
  const near = (a, b) => Math.abs(a - b) <= Math.max(4, 0.012 * b);
  const cs = new Set(ps.map((p) => +p.freq.toFixed(1)));
  if (an.pitch.f0) cs.add(+an.pitch.f0.toFixed(1));
  const ms = new Set();
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) ms.add(+Math.abs(ps[i].freq - ps[j].freq).toFixed(1));
  for (const p of ps) ms.add(+p.freq.toFixed(1));
  const scored = [];
  for (const c of cs) for (const m of ms) {
    const ratio = m / c;
    if (ratio < 0.1 || ratio > 16 || m < 20) continue;
    const lines = [];
    for (let k = -12; k <= 12; k++) { const f = Math.abs(c + k * m); if (f > 20 && f < Math.min(nyq, top * 1.05)) lines.push(f); }
    let hit = 0;
    for (const p of ps) if (lines.some((f) => near(p.freq, f))) hit += p.amp * p.amp;
    const missing = lines.filter((f) => !ps.some((p) => near(p.freq, f))).length;
    // the carrier has to be one of the lines that's there
    if (!ps.some((p) => near(p.freq, c))) continue;
    scored.push({ c, ratio: +ratio.toFixed(3), score: hit / total - 0.03 * missing });
  }
  // Every carrier on one lattice makes the same lines (c and c ± m are the same set), so a lattice
  // is one candidate, tried at its lowest carrier: c folded into [0, m/2]. That's the DX habit
  // (a carrier under a higher modulator) and the place a collapsing index settles. Ties go to the
  // simpler ratio.
  const fold = (c, m) => { const r = c % m; return Math.min(r, m - r); };
  for (const s of scored) {
    const m = s.c * s.ratio;
    let f = fold(s.c, m);
    if (f < Math.max(4, 0.012 * m)) f = m;      // a carrier on a multiple of m: the lattice of c = m
    const at = ps.find((p) => near(p.freq, f));
    s.c = +(at ? at.freq : f).toFixed(1); s.ratio = +(m / s.c).toFixed(3);
  }
  // A carrier within 3% of a multiple of a confident f0 is that multiple (YIN is finer than a peak
  // bin), and a ratio within 1.5% of a whole or half number is that number: real FM patches sit on
  // them, and a hair off one is a slow beat the search would otherwise spend its budget chasing.
  const f0 = an.pitch.periodic > 0.4 ? an.pitch.f0 : null;
  for (const s of scored) {
    const m = s.c * s.ratio;
    if (f0) { const k = Math.round(s.c / f0); if (k >= 1 && Math.abs(s.c / (k * f0) - 1) < 0.03) s.c = +(k * f0).toFixed(2); }
    let r = m / s.c;
    const half = Math.round(r * 2) / 2;
    if (half > 0 && Math.abs(r / half - 1) < 0.015) r = half;
    s.ratio = +r.toFixed(3);
  }
  const simple = (r) => Math.min(...[1, 2, 3, 4].map((d) => Math.abs(r * d - Math.round(r * d)) + d * 0.001));
  scored.sort((a, b) => b.score - a.score || simple(a.ratio) - simple(b.ratio));
  const out = [];
  for (const s of scored) {
    if (s.c < 20 || s.ratio < 0.1 || s.ratio > 16) continue;
    if (out.some((o) => Math.abs(o.c / s.c - 1) < 0.02 && Math.abs(o.ratio / s.ratio - 1) < 0.03)) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

// The discrete choices, read off the analysis.
export function propose(an, len, only) {
  const out = [], want = (k) => !only || only.includes(k);
  const tonal = an.pitch.f0 && an.pitch.periodic > 0.4;
  const noisy = an.noisiness > 0.12;
  const decaying = !an.env.held;
  if (want('fm') && an.partials.length) {
    const pairs = fmPairs(an);
    for (const [i, p] of pairs.entries()) {
      out.push(fmTemplate(an, len, { carrier: p.c, ratio: p.ratio, noise: noisy }));
      // the next-best modulator on the same carrier, in series, for the two best pairs
      const second = pairs.find((q, j) => j !== i && Math.abs(q.c / p.c - 1) < 0.01 && Math.abs(q.ratio / p.ratio - 1) > 0.05);
      if (i < 2 && an.partials.length >= 5) out.push(fmTemplate(an, len, { carrier: p.c, ratio: p.ratio, ratio2: second ? second.ratio : +(p.ratio * 2).toFixed(3), noise: noisy }));
    }
    if (tonal && an.harmonicity > 0.7) out.push(fmTemplate(an, len, { wave: 'triangle', carrier: an.pitch.f0, ratio: 1, noise: noisy }));
  }
  // (a short clip is a struck thing whatever its sustain reads: it never got to sustain)
  if (want('modes') && (decaying || len < 1) && an.partials.length) {
    out.push(modesTemplate(an, len, { noise: false }));
    if (noisy || an.env.attack < 0.004) out.push(modesTemplate(an, len, { noise: true }));
  }
  if (want('sub') && tonal && an.harmonicity > 0.6 && an.partials.length >= 4) {
    out.push(subTemplate(an, len, { wave: 'sawtooth' }), subTemplate(an, len, { wave: 'square' }));
  }
  if (want('drum') && decaying) {
    const body = drumTemplate(an, len, { noise: true });
    if (body) out.push(body, drumTemplate(an, len, { noise: true, wave: 'triangle' }));
  }
  if (want('noise') && an.env.bursts.length >= 3) out.push(clapTemplate(an, len));
  if (want('noise') && (noisy || !tonal)) {
    for (const type of ['bandpass', 'lowpass', 'highpass']) out.push(noiseTemplate(an, len, { type }));
    out.push(noiseTemplate(an, len, { type: 'lowpass', colour: 'pink' }));
  }
  return out.filter(Boolean).map((t) => ({ ...t, x0: Float64Array.from(encode(t.space, t.space.map((p) => p.init ?? (p.lo + p.hi) / 2))) }));
}

// ── the search ───────────────────────────────────────────────────────────────
export async function match(target, { only = null, budget = 2500, start = null, log = () => {}, seed = 1 } = {}) {
  const x = trim(target, SR), len = x.length / SR;
  const an = analyse(x, SR);
  const dist = new Distance(x, SR);
  const cands = start ? [refineTemplate(start, len)].map((t) => ({ ...t, x0: Float64Array.from(encode(t.space, t.space.map((p) => p.init))) })) : propose(an, len, only);
  if (!cands.length) throw new Error('no template fits this recording (try --only noise, or --start with a cue of your own)');
  let evals = 0;
  const scorer = (t) => async (z) => {
    evals++;
    const cfg = apply(t.config, t.space, decode(t.space, z));
    const y = await render(cfg, len);
    const d = dist.of(y).total;
    return Number.isFinite(d) ? d : 99;
  };
  // screen: every template at its analysed starting point, and keep the best eight, at least the
  // best of each kind; stage 1: a short run each; stage 2: the best three share what's left
  let pool = cands;
  if (!start && cands.length > 8) {
    const screened = [];
    for (const t of cands) screened.push({ t, f: await scorer(t)(t.x0) });
    screened.sort((a, b) => a.f - b.f);
    const keep = new Set();
    for (const k of new Set(screened.map((r) => r.t.kind))) keep.add(screened.find((r) => r.t.kind === k));
    for (const r of screened) { if (keep.size >= 8) break; keep.add(r); }
    pool = [...keep].map((r) => r.t);
  }
  const first = start ? budget : Math.max(40, Math.floor((budget - evals) * 0.45 / pool.length));
  const results = [];
  for (const [i, t] of pool.entries()) {
    const r = await cmaes(scorer(t), t.x0, { sigma: start ? 0.12 : 0.3, evals: first, seed: seed + i });
    results.push({ t, x: r.x, f: r.f });
    log(`  ${t.label.padEnd(34)} ${r.f.toFixed(3)}`);
  }
  results.sort((a, b) => a.f - b.f);
  if (!start) {
    const top = results.slice(0, 3), each = Math.max(60, Math.floor((budget - evals) / top.length));
    for (const [i, r] of top.entries()) {
      const s = await cmaes(scorer(r.t), r.x, { sigma: 0.1, evals: each, seed: seed + 100 + i });
      if (s.f < r.f) { r.x = s.x; r.f = s.f; }
      log(`  refined ${r.t.label.padEnd(26)} ${r.f.toFixed(3)}`);
    }
    results.sort((a, b) => a.f - b.f);
  }
  const best = results[0];
  const config = apply(best.t.config, best.t.space, decode(best.t.space, best.x));
  const parts = dist.of(await render(config, len));
  return { an, len, config, label: best.t.label, kind: best.t.kind, distance: parts, evals, ranking: results.map((r) => ({ label: r.t.label, f: r.f })), trimmed: x };
}

// Scale every layer's gain so the cue peaks where the recording did, never over -1 dBFS.
export async function level(config, seconds, wantPeak) {
  const y = await render(config, seconds, 48000);
  let peak = 0; for (const v of y) peak = Math.max(peak, Math.abs(v));
  if (!peak) return config;
  const g = Math.min(wantPeak, 0.891) / peak, c = structuredClone(config);
  for (const l of c.layers) l.gain = +((l.gain ?? 1) * g).toPrecision(3);
  return c;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const file = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !['--analyse'].includes(argv[i - 1])));
  const cueId = arg('--cue', null);
  if (!file && !cueId) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 30).join('\n')); process.exit(1); }
  let target, srIn;
  if (cueId) {
    const dir = join(ROOT, 'content', 'audio_sfx');
    const def = readdirSync(dir).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))).find((d) => d.id === cueId || d.name === cueId);
    if (!def) throw new Error(`no cue ${cueId} under content/audio_sfx`);
    target = await render(def.config, +arg('--seconds', 0) || undefined, SR); srIn = SR;
  } else {
    const w = readWav(resolve(file)); target = w.samples; srIn = w.sampleRate;
  }
  const maxS = +arg('--seconds', 2);
  let x = resample(target, srIn, SR);
  x = trim(x, SR);
  if (x.length > maxS * SR) x = x.subarray(0, Math.round(maxS * SR));
  const name = arg('--name', cueId || basename(file || 'match').replace(/\.[^.]+$/, '')).replace(/[^\w-]+/g, '_');
  const out = resolve(arg('--out', join(ROOT, 'sound-match-out', name)));

  const an = analyse(x, SR);
  const summary = [
    `length ${an.length.toFixed(3)} s   peak ${(20 * Math.log10(an.peak || 1e-9)).toFixed(1)} dBFS`,
    `envelope: attack ${(an.env.attack * 1000).toFixed(1)} ms, peak at ${(an.env.peakAt * 1000).toFixed(0)} ms, T60 ${an.env.t60.toFixed(2)} s, sustain ${an.env.sustainDb.toFixed(1)} dB, held to ${an.env.holdEnd.toFixed(2)} s`,
    `pitch: ${an.pitch.f0 ? `${an.pitch.f0.toFixed(1)} Hz (start ${an.pitch.f0Start?.toFixed(1)}, end ${an.pitch.f0End?.toFixed(1)})` : 'none'}, periodic ${(an.pitch.periodic * 100).toFixed(0)}% of frames`,
    `harmonicity ${an.harmonicity.toFixed(2)}   noisiness ${an.noisiness.toFixed(2)}`,
    `partials: ${an.partials.map((p) => `${p.freq.toFixed(0)}Hz ${(20 * Math.log10(p.amp)).toFixed(0)}dB T60 ${p.t60.toFixed(2)}s`).join(' · ')}`,
  ];
  console.log(summary.join('\n'));
  if (argv.includes('--analyse')) return;

  const only = arg('--only', null)?.split(',');
  const start = arg('--start', null) ? JSON.parse(readFileSync(resolve(arg('--start')), 'utf8')) : null;
  const t0 = performance.now();
  console.log('\nsearching:');
  const r = await match(x, { only, budget: +arg('--budget', 2500), start: start ? (start.config || start) : null, log: (s) => console.log(s) });
  const config = await level(r.config, r.len, an.peak);
  const def = { name, category: start?.category || 'misc', priority: start?.priority ?? 5, enabled: 1, config };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${name}.json`), JSON.stringify(def, null, 2) + '\n');
  const tgt48 = resample(r.trimmed, SR, 48000), got48 = await render(config, r.len, 48000);
  if (!cueId) { const w = readWav(resolve(file)); writeFileSync(join(out, 'target.wav'), wav(trim(resample(w.samples, w.sampleRate, 48000), 48000), 48000)); }
  else writeFileSync(join(out, 'target.wav'), wav(tgt48, 48000));
  writeFileSync(join(out, 'match.wav'), wav(got48, 48000));
  const lu = momentaryMax(got48, 48000);
  const verdict = r.distance.total < 0.7 ? 'close' : r.distance.total < 1.2 ? 'recognisable, edit by ear' : 'the nearest this template could get';
  const report = [
    ...summary, '',
    `best: ${r.label}   distance ${r.distance.total.toFixed(3)} (${verdict})`,
    `  spectra ${r.distance.spec.toFixed(3)}  convergence ${r.distance.conv.toFixed(3)}  envelope ${r.distance.env.toFixed(3)}`,
    `  ${r.evals} renders in ${((performance.now() - t0) / 1000).toFixed(1)} s; the cue's max momentary loudness is ${lu.toFixed(1)} LUFS`,
    '', 'every template:', ...r.ranking.map((k) => `  ${k.f.toFixed(3)}  ${k.label}`),
  ];
  writeFileSync(join(out, 'report.txt'), report.join('\n') + '\n');
  console.log('\n' + report.slice(summary.length + 1, summary.length + 4).join('\n'));
  console.log(`\nwrote ${out}/{${name}.json, target.wav, match.wav, report.txt}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}

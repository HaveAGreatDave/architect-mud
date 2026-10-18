// LOUDNESS: how loud every SIREN cue preset is, against a target for its kind and category.
//
// The limiter catches peaks, but nothing measured one cue against the next: each preset's level
// was set by ear, alone, so a cue could sit 15 LU hotter than its neighbours and nobody would
// know until it played beside them. This renders every row under content/audio_sfx and
// content/audio_ambient through the real audio-engine.js on the offline renderer
// (./offline-audio.mjs), measures it, and compares it with the TARGETS table below.
//
//   node scripts/audio/loudness-smoke.mjs            the gate: fails on a new outlier or a cue that moved
//   node scripts/audio/loudness-smoke.mjs --report   every cue's loudness and peak, outliers marked
//   node scripts/audio/loudness-smoke.mjs --update   rewrite loudness-baseline.json from this render
//
// The measure (ITU-R BS.1770-4, K-weighted, mono, channel weight 1):
//   - a one-shot (no `loop`) is its MAXIMUM MOMENTARY loudness: the loudest 400 ms window, 100 ms
//     hop. Integrated loudness is meaningless on a 30 ms click; momentary max is what an ear
//     hears as "how loud was that". A cue shorter than 400 ms is padded with silence, so a
//     short tick reads quieter than a long tone at the same amplitude, as it sounds.
//   - a loop is its INTEGRATED loudness (absolute gate -70 LUFS, relative gate -10 LU) over
//     HOLD seconds of sustain, after its attack and decay. Sparkles aren't rendered: they're
//     random and live-only, and a bed is judged without them.
//   - peak is the sample peak in dBFS at 48 kHz, not true peak. Over 0 dBFS is an outlier.
// All of it is the cue alone at gain 1: no bus gain, no limiter, no reverb, no server-side
// distance gain. Those are the mix; this is the preset.
//
// A cue is an OUTLIER when its loudness is more than TOL LU from its target, or its peak is
// over 0 dBFS. The baseline records every cue's numbers as of the last --update. The gate fails
// when a cue is an outlier and its baseline numbers weren't (a new outlier), or when a cue's
// loudness moved more than MOVE LU from its baseline. Changing a cue's level on purpose is fine:
// run --update and say why in the commit. Writes nothing unless --update.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installAudioGlobals } from './offline-audio.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE = join(ROOT, 'scripts', 'audio', 'loudness-baseline.json');
const REPORT = process.argv.includes('--report');
const UPDATE = process.argv.includes('--update');
const SR = 48000;
const HOLD = 3;      // seconds of a loop's sustain that are measured
const TOL = 4;       // LU either side of a target before a cue is an outlier
const MOVE = 1;      // LU a cue may drift from its baseline (the renderer is deterministic; this is slack)

// Targets in LUFS, by `kind:category`, then by kind. Starting points: the median of each group as
// of 2026-10-18, rounded. They're a judgement, not a measurement; move one deliberately, then
// --update.
const TARGETS = {
  'sfx:ui': -20,
  'sfx:combat': -16,
  'sfx:cyberpunk': -11,
  'sfx:tv': -19,
  'loop:environment': -20,
  'loop:tv': -35,
  sfx: -16,
  loop: -20,
};
const targetOf = (kind, category) => TARGETS[`${kind}:${category}`] ?? TARGETS[kind];

// ── K-weighting and the gating blocks ────────────────────────────────────────
// The two BS.1770 stages (a +4 dB high shelf and a 38 Hz high-pass) designed from their analog
// prototypes, so the coefficients are right at any rate, not only 48 kHz.
function kWeight(d, fs) {
  let K = Math.tan(Math.PI * 1681.974450955533 / fs), Q = 0.7071752369554196;
  const Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
  K = Math.tan(Math.PI * 38.13547087602444 / fs); Q = 0.5003270373238773; a0 = 1 + K / Q + K * K;
  const hp = [1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
  const y = Float64Array.from(d);
  for (const [b0, b1, b2, a1, a2] of [shelf, hp]) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const x = y[i], v = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = v; y[i] = v;
    }
  }
  return y;
}
const lufs = (meanSquare) => -0.691 + 10 * Math.log10(meanSquare);
// Mean square of every 400 ms block, 100 ms apart, from sample `from`.
function blocks(y, fs, from = 0) {
  const n = Math.round(0.4 * fs), hop = Math.round(0.1 * fs), out = [];
  for (let i = from; i + n <= y.length; i += hop) { let s = 0; for (let j = i; j < i + n; j++) s += y[j] * y[j]; out.push(s / n); }
  return out;
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
function integrated(z) {
  let g = z.filter((m) => lufs(m) > -70);
  if (!g.length) return -Infinity;
  const rel = lufs(mean(g)) - 10;
  g = g.filter((m) => lufs(m) > rel);
  return lufs(mean(g));
}

// ── render and measure ───────────────────────────────────────────────────────
installAudioGlobals();
new Function(readFileSync(join(ROOT, 'client/shared/audio-engine.js'), 'utf8'))();
const AE = globalThis.AudioEngine;
AE._setRetroUrl(join(ROOT, 'client/shared/audio-retro-worklet.js'));

async function measureCue(def) {
  const loop = !!def.loop;
  let render = def, seconds, from = 0;
  if (loop) {
    // held for its attack, decay and HOLD seconds; the release isn't measured
    const a = def.config.adsr || {}, settle = (a.a ?? 0.01) + (a.d ?? 0.05);
    seconds = settle + HOLD;
    from = Math.ceil(settle * SR);
    render = { ...def, config: { ...def.config, duration: seconds } };
  }
  const buf = await AE.renderSfx(render, { sampleRate: SR, seconds });
  let d = buf.getChannelData(0);
  if (d.length < 0.4 * SR) { const pad = new Float32Array(Math.ceil(0.4 * SR)); pad.set(d); d = pad; }
  let peak = 0, finite = true;
  for (const x of d) { if (!Number.isFinite(x)) finite = false; else if (Math.abs(x) > peak) peak = Math.abs(x); }
  const z = blocks(kWeight(d, SR), SR, from);
  const lu = loop ? integrated(z) : (z.length ? lufs(Math.max(...z)) : -Infinity);
  return { kind: loop ? 'loop' : 'sfx', finite, lufs: round(lu), peak: round(peak > 0 ? 20 * Math.log10(peak) : -Infinity) };
}
const round = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : -99);

const cues = [];
for (const dir of ['audio_sfx', 'audio_ambient']) {
  for (const f of readdirSync(join(ROOT, 'content', dir)).filter((n) => n.endsWith('.json')).sort()) {
    const def = JSON.parse(readFileSync(join(ROOT, 'content', dir, f), 'utf8'));
    if (!def.config || def.enabled === 0) continue;
    const m = await measureCue(def);
    const target = targetOf(m.kind, def.category);
    cues.push({ id: def.id, category: def.category, ...m, target });
  }
}

const offBy = (lu, target) => Math.round((lu - target) * 10) / 10;
const isOutlier = (lu, peak, target) => Math.abs(lu - target) > TOL || peak > 0;
const why = (c) => [
  Math.abs(c.lufs - c.target) > TOL ? `${offBy(c.lufs, c.target) > 0 ? '+' : ''}${offBy(c.lufs, c.target)} LU` : null,
  c.peak > 0 ? `peak +${c.peak} dBFS` : null,
].filter(Boolean).join(', ');

if (UPDATE) {
  const out = {};
  for (const c of cues) out[c.id] = { lufs: c.lufs, peak: c.peak };
  writeFileSync(BASELINE, JSON.stringify(out, null, 2) + '\n');
  console.log(`audio loudness baseline written: ${cues.length} cues, ${cues.filter((c) => isOutlier(c.lufs, c.peak, c.target)).length} outliers.`);
  process.exit(0);
}

if (REPORT) {
  console.log('SIREN cue loudness. One-shots: max momentary LUFS. Loops: integrated LUFS over the sustain. Peak: sample dBFS.');
  console.log(`An outlier is more than ${TOL} LU from its target, or peaks over 0 dBFS.\n`);
  console.log(['cue'.padEnd(24), 'kind'.padEnd(5), 'category'.padEnd(12), 'LUFS'.padStart(6), 'target'.padStart(7), 'peak'.padStart(6), '  outlier'].join(' '));
  for (const c of cues) {
    console.log([c.id.padEnd(24), c.kind.padEnd(5), String(c.category).padEnd(12), String(c.lufs).padStart(6), String(c.target).padStart(7), String(c.peak).padStart(6), '  ' + why(c)].join(' '));
  }
  const outliers = cues.filter((c) => isOutlier(c.lufs, c.peak, c.target));
  console.log(`\n${outliers.length} of ${cues.length} cues are outliers.`);
  process.exit(0);
}

// ── the gate ─────────────────────────────────────────────────────────────────
let base = {};
try { base = JSON.parse(readFileSync(BASELINE, 'utf8')); } catch { /* no baseline: every outlier is new */ }
const fails = [];
for (const c of cues) {
  if (!c.finite) { fails.push(`${c.id}: renders a non-finite sample`); continue; }
  const b = base[c.id];
  if (b && Math.abs(c.lufs - b.lufs) > MOVE) fails.push(`${c.id}: moved from ${b.lufs} to ${c.lufs} LUFS (target ${c.target})`);
  else if (isOutlier(c.lufs, c.peak, c.target) && !(b && isOutlier(b.lufs, b.peak, c.target))) fails.push(`${c.id}: a new outlier, ${c.lufs} LUFS against ${c.target} (${why(c)})`);
}
if (fails.length) {
  console.error('audio loudness: these cues changed against scripts/audio/loudness-baseline.json');
  for (const f of fails) console.error('  ' + f);
  console.error('\nIf the change is meant, run `node scripts/audio/loudness-smoke.mjs --update` and say why in the commit.');
  console.error('`--report` prints every cue.');
  process.exit(1);
}
console.log(`audio loudness ok (${cues.length} cues).`);

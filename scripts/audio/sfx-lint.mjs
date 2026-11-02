// SFX LINT: render every non-music sound effect through the real engine and say what's wrong with
// it the way a sound designer would.
//
//   node scripts/audio/sfx-lint.mjs                 every preset (audio_sfx, audio_ambient) and a
//                                                   sweep of the procedural generators
//   node scripts/audio/sfx-lint.mjs --only presets  | procedural | ambient
//   node scripts/audio/sfx-lint.mjs combat_hit      one cue, by id or name, or a generator action
//   node scripts/audio/sfx-lint.mjs --module scripts/content/build-sfx.mjs   the cues a script writes
//   --json                                          the numbers
//
// Report only. Loudness against category targets is loudness-smoke.mjs's job and isn't repeated
// here; this is everything else. The thresholds and the reasons for them are in
// docs/reference/sfx-craft.md#the-critic. Per cue:
//   click      its first millisecond steps to one side of zero and stays there (a noise burst or a
//              strike starting at full level averages out and is a transient, not a click), or
//              the level jumps faster than any envelope could on a steady signal
//   cut        it falls from -20 dB to -60 dB in 3 ms or less at its end: chopped, not released
//   hot        it peaks over -1 dBFS on its own, so the master limiter squashes it
//   dc         a mean offset over 1% of the peak, on a cue over 0.6 s (it thumps the cone on and off)
//   alias      its octave-band spectrum at 48 kHz is over 1.5 dB per octave off a 192 kHz render
//              of the same cue: FM sidebands or harmonics folding back off Nyquist
//   beep       one tonal partial and nothing else: a test tone, not a thing happening
//   thin       a single layer outside the ui category (real sounds are a transient, a body
//              and a tail, rarely one of them)
//   small      over 10 LU quieter through a laptop-sized speaker (a 250 Hz 4th-order high-pass):
//              most of it is below what a laptop or a phone plays
//   soft       no transient: its peak is under 1.5x the level of the 100 ms after it, on a cue
//              whose category is an impact (combat). Measured where it peaks, so a cue that leads
//              in with a swing or a fall is judged where it lands
// A bit-crushed cue (`retro`) isn't checked for clicks or a cut: it steps, and stops at its
// quantisation floor, on purpose.
//   same       a procedural cue whose two seeds render identically (no variation on a sound
//              that repeats)
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installAudioGlobals } from './offline-audio.mjs';
import { magSpectrum } from './match-lib.mjs';
import { momentaryMax } from './loudness-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let AE = null, PS = null;
export function engines() {
  if (!AE) {
    installAudioGlobals();
    if (!globalThis.AudioEngine) new Function(readFileSync(join(ROOT, 'client/shared/audio-engine.js'), 'utf8'))();
    AE = globalThis.AudioEngine;
    AE._setRetroUrl?.(join(ROOT, 'client/shared/audio-retro-worklet.js'));
  }
  if (!PS) { new Function(readFileSync(join(ROOT, 'client/shared/procedural-sfx.js'), 'utf8'))(); PS = globalThis.ProceduralSFX; }
  return { AE, PS };
}
export async function render(def, sampleRate = 48000, seconds) {
  const { AE } = engines();
  const loop = !!def.loop;
  const cfg = loop ? { ...def.config, duration: Math.max(def.config.duration ?? 0, 3) } : def.config;
  const buf = await AE.renderSfx({ ...def, config: cfg }, { sampleRate, ...(seconds ? { seconds } : {}) });
  return buf ? buf.getChannelData(0) : new Float32Array(0);
}

const db = (v) => 20 * Math.log10(Math.max(1e-12, v));
const rms = (x, a, n) => { let s = 0, c = 0; for (let i = Math.max(0, a); i < a + n && i < x.length; i++) { s += x[i] * x[i]; c++; } return c ? Math.sqrt(s / c) : 0; };

// Band energy (linear power) of x between lo and hi Hz, averaged over 4096-point frames.
function bandPower(x, sr, lo, hi, n = 4096) {
  let p = 0, frames = 0;
  const a = Math.ceil(lo * n / sr), b = Math.min(n / 2, Math.floor(hi * n / sr));
  for (let i = 0; i + n / 2 < x.length; i += n / 2) {
    const m = magSpectrum(x, i, n);
    for (let k = a; k <= b; k++) p += m[k] * m[k];
    frames++;
  }
  return frames ? p / frames : 0;
}

// The measures, on a 48 kHz render (and a 192 kHz one for aliasing).
export async function measure(def, { seeds = null, alias = true } = {}) {
  const sr = 48000;
  const x = await render(def, sr);
  const out = { finite: x.every(Number.isFinite), seconds: +(x.length / sr).toFixed(3) };
  let peak = 0, sum = 0;
  for (const v of x) { peak = Math.max(peak, Math.abs(v)); sum += v; }
  out.peakDb = +db(peak).toFixed(1);
  if (!peak) return { ...out, silent: true };
  out.dc = +(Math.abs(sum / x.length) / peak).toFixed(4);
  // clicks: the first audible sample (a sound that starts at full level steps from silence), and
  // the largest sample-to-sample jump on a steady signal (a step the envelope didn't make)
  // (a noise burst or a struck thing starting at full level is a transient and averages out to
  // nothing; a click is the signal stepping to one side and staying there)
  const first = x.findIndex((v) => Math.abs(v) > peak * 1e-3);
  const ms1 = Math.round(sr * 0.001);
  let side = 0; for (let i = first; i < first + ms1 && i < x.length; i++) side += x[i];
  // (and a low sine starting from its zero crossing sits to one side for a millisecond too, but
  // starts at zero: a click has to start high AND stay to one side)
  const startHigh = Math.max(...Array.from(x.subarray(first, first + 3), Math.abs)) / peak;
  const onset = Math.min(startHigh, Math.abs(side / ms1) / peak);
  let jump = 0;
  const w = Math.round(sr * 0.002);
  for (let i = w; i < x.length - w; i++) {
    const d = Math.abs(x[i] - x[i - 1]);
    if (d / peak < 0.25) continue;
    const before = rms(x, i - w, w), after = rms(x, i, w);
    if (before > 0.05 * peak && after > 0.05 * peak) jump = Math.max(jump, d / (before + after));
  }
  out.onset = +onset.toFixed(3); out.jump = +jump.toFixed(2);
  // a cut: how long the sound takes to fall from 20 dB down to 60 dB down at its end, on 1 ms
  // windows. A release takes tens of milliseconds; a chop takes one or two.
  const t1 = Math.round(sr * 0.001), env = [];
  for (let i = 0; i + t1 <= x.length; i += t1) env.push(rms(x, i, t1));
  let pkE = 0; for (const v of env) pkE = Math.max(pkE, v);
  let k20 = env.length - 1; while (k20 > 0 && env[k20] < pkE * 0.1) k20--;
  let k60 = k20; while (k60 < env.length - 1 && env[k60] > pkE * 0.001) k60++;
  out.fallMs = k60 - k20;
  out.soundSeconds = +(k60 / 1000).toFixed(3);   // how long it actually sounds, to -60 dB
  // transient: the loudest moment's peak against the RMS of the 100 ms that follow it (a cue may
  // lead in with a swing or a fall before it lands, so this looks where it lands, not at 0)
  let at = 0; for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) === peak) { at = i; break; }
  const body = rms(x, at + Math.round(sr * 0.03), Math.round(sr * 0.1));
  out.crest = +(body ? peak / (body * Math.SQRT2) : 99).toFixed(2);
  // the low end: how much quieter it is through a small speaker (a 4th-order high-pass at 250 Hz,
  // about a laptop's), in loudness units. Over 10 LU lost and it's barely there on one.
  const hp = Float64Array.from(x);
  for (let pass = 0; pass < 2; pass++) {
    const K = Math.tan(Math.PI * 250 / sr), Q = Math.SQRT1_2, n = 1 / (1 + K / Q + K * K);
    const b0 = n, b1 = -2 * n, b2 = n, a1 = 2 * (K * K - 1) * n, a2 = (1 - K / Q + K * K) * n;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < hp.length; i++) { const v = hp[i], o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = o; hp[i] = o; }
  }
  out.laptopLoss = +(momentaryMax(x, sr) - momentaryMax(Float32Array.from(hp), sr)).toFixed(1);
  // tonal content: strong peaks in the long-term spectrum, and flatness
  const N = 8192, acc = new Float64Array(N / 2 + 1);
  let frames = 0;
  for (let i = 0; i + N / 2 < x.length || frames === 0; i += N / 2) { const m = magSpectrum(x, i, N); for (let k = 0; k < acc.length; k++) acc[k] += m[k] * m[k]; frames++; if (i + N / 2 >= x.length) break; }
  let top = 0; for (const v of acc) top = Math.max(top, v);
  let partials = 0;
  for (let k = 3; k < acc.length - 3; k++) if (acc[k] > top * 0.01 && acc[k] >= acc[k - 1] && acc[k] >= acc[k + 1] && acc[k] > 4 * Math.min(acc[k - 3], acc[k + 3])) partials++;
  let lg = 0, ar = 0, nb = 0;
  const a = Math.ceil(100 * N / sr), b = Math.floor(10000 * N / sr);
  for (let k = a; k <= b; k++) { lg += Math.log(acc[k] + 1e-30); ar += acc[k]; nb++; }
  out.flatness = +(Math.exp(lg / nb) / (ar / nb)).toFixed(4);
  out.partials = partials;
  // aliasing: the octave-band shape of the 48 kHz render against a 192 kHz render of the same cue.
  // Aliases fold anywhere below Nyquist, so it's the whole band that's compared: the mean
  // difference per octave from 125 Hz to 16 kHz, in dB, each render normalised to its own total.
  // (tonal layers only: noise is generated per sample rate, and pink and brown are filters tuned
  // for 48 kHz, so a noise layer's spectrum differs at 192 kHz without anything aliasing)
  const tonal = (d) => { const L = d.config.layers?.length ? d.config.layers : [d.config]; const t = L.map((l) => ((l.noiseMix ?? (l.waveform === 'noise' ? 1 : 0)) >= 1 ? { ...l, mute: true } : { ...l, noiseMix: 0 })); return d.config.layers?.length ? { ...d, config: { ...d.config, layers: t } } : { ...d, config: t[0] }; };
  const td = tonal(def);
  const tonalLayers = (td.config.layers || [td.config]).filter((l) => !l.mute).length;
  // (`alias: false` skips this, the costliest measure: four times the samples, for the gate)
  const xt = tonalLayers && alias ? await render(td, sr) : null;
  const y = tonalLayers && alias ? await render(td, 192000) : null;
  const shape = (z, rate, n) => { const bands = []; for (let f = 125; f < 16000; f *= 2) bands.push(bandPower(z, rate, f, f * 2, n)); const t = bands.reduce((p, q) => p + q, 0) || 1; return bands.map((v) => v / t); };
  out.aliasDb = 0;
  if (tonalLayers && alias) {
    const A = shape(xt, sr, 4096), B = shape(y, 192000, 16384);
    let err = 0, wsum = 0;
    // weighted by how much is there, so an octave with nothing in it can't dominate
    for (let k = 0; k < A.length; k++) { const wgt = Math.max(A[k], B[k]); err += wgt * Math.abs(10 * Math.log10((A[k] + 1e-9) / (B[k] + 1e-9))); wsum += wgt; }
    out.aliasDb = +(err / (wsum || 1)).toFixed(2);
  }
  if (seeds) {
    const [s1, s2] = seeds;
    const r1 = await render(s1, sr), r2 = await render(s2, sr);
    let d = 0, n = Math.min(r1.length, r2.length);
    for (let i = 0; i < n; i++) d += Math.abs(r1[i] - r2[i]);
    out.variation = +(d / Math.max(1, n) / (peak || 1)).toFixed(4);
  }
  return out;
}

// What the measures add up to.
export function findings(def, m) {
  const f = [];
  const say = (code, msg) => f.push({ code, msg });
  const cat = def.category || 'misc';
  const layers = def.config?.layers?.length ? def.config.layers : [def.config || {}];
  if (!m.finite) say('broken', 'renders a non-finite sample');
  if (m.silent) { say('broken', 'renders silence'); return f; }
  // (a bit-crushed cue steps and stops at its quantisation floor on purpose)
  const crushed = !!def.config?.retro;
  if (m.onset > 0.25 && !crushed) say('click', `steps to ${Math.round(m.onset * 100)}% of its peak from silence and stays to one side`);
  if (m.jump > 3 && !crushed) say('click', `a step in the level ${m.jump}x the local signal`);
  if (m.fallMs <= 3 && !def.loop && !crushed) say('cut', `falls from -20 dB to -60 dB in ${m.fallMs} ms at its end: chopped, not released`);
  if (m.peakDb > -1) say('hot', `peaks at ${m.peakDb} dBFS on its own: the master limiter has to squash it`);
  // (only on something that lasts: a short low-passed noise burst averages off zero over its
  // own length without any offset in it)
  if (m.dc > 0.01 && m.soundSeconds > 0.6) say('dc', `DC offset ${(m.dc * 100).toFixed(1)}% of peak`);
  if (m.aliasDb > 1.5) say('alias', `its spectrum at 48 kHz is ${m.aliasDb} dB an octave off its 192 kHz render: something folds back off Nyquist`);
  if (m.partials <= 1 && m.flatness < 0.01 && layers.length === 1) say('beep', 'one tonal partial and nothing else');
  if (layers.length === 1 && cat !== 'ui' && !def.loop && !layers[0].modes) say('thin', 'a single layer: no transient, body and tail working together');
  if (m.laptopLoss > 10) say('small', `${m.laptopLoss} LU quieter through a laptop-sized speaker: most of it is below what one plays`);
  if (cat === 'combat' && m.crest < 1.5) say('soft', `no transient (attack crest ${m.crest}) on an impact`);
  if (m.variation != null && m.variation < 1e-4) say('same', 'two seeds render the same samples');
  return f;
}

// The procedural sweep: the generators as the game fires them, a few points each.
export function proceduralCases() {
  const { PS } = engines();
  const cases = [];
  const add = (label, params, category = 'combat') => cases.push({ label, params, category });
  // (at the detail most players hear: 'limited' unless they chose otherwise or play in the log)
  for (const s of Object.keys(PS.FOOTSTEPS)) add(`footstep ${s}`, { action: 'footstep', surface: s, intensity: 0.5, detail: 'limited' }, 'environment');
  for (const d of Object.keys(PS.DOORS)) for (const st of ['open', 'close']) add(`door ${d} ${st}`, { action: 'door', surface: d, state: st, intensity: 0.6 }, 'environment');
  for (const l of Object.keys(PS.LOCKS)) for (const st of ['unlock', 'denied']) add(`lock ${l} ${st}`, { action: 'lock', surface: l, state: st, intensity: 0.6 }, 'environment');
  for (const w of [0.22, 0.6, 0.85]) add(`impact flesh w${w}`, { action: 'impact', surface: 'none', weight: w, intensity: 0.6 });
  for (const s of ['metal', 'wood', 'glass', 'stone']) add(`impact ${s}`, { action: 'impact', surface: s, intensity: 0.6, detail: 'limited' }, 'environment');
  for (const m of ['wet_meat', 'bone']) add(`chop ${m}`, { action: 'chop', material: m, intensity: 0.6 });
  for (const w of [0.22, 0.85]) add(`whiff w${w}`, { action: 'whiff', weight: w, intensity: 0.5 });
  for (const c of [0.1, 0.5, 0.9]) add(`gunshot c${c}`, { action: 'gunshot', calibre: c, intensity: 0.7 });
  add('gunshot suppressed', { action: 'gunshot', calibre: 0.4, intensity: 0.7, state: 'suppressed' });
  add('sizzle energy hit', { action: 'sizzle', material: 'wet_meat', duration: 0.26, intensity: 0.6 });
  add('break glass', { action: 'break', surface: 'glass', intensity: 0.7 }, 'environment');
  return cases;
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const only = arg('--only');
  const names = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--only', '--module'].includes(argv[i - 1])));
  const { PS } = engines();
  const rows = [];
  const want = (k) => !only || only === k;
  let presets = [];
  if (arg('--module')) {
    const m = await import(pathToFileURL(resolve(ROOT, arg('--module'))).href);
    presets = [...(m.sfx || []), ...(m.ambient || [])];
  } else {
    if (want('presets')) for (const f of readdirSync(join(ROOT, 'content/audio_sfx')).sort()) presets.push(JSON.parse(readFileSync(join(ROOT, 'content/audio_sfx', f), 'utf8')));
    if (want('ambient')) for (const f of readdirSync(join(ROOT, 'content/audio_ambient')).sort()) presets.push(JSON.parse(readFileSync(join(ROOT, 'content/audio_ambient', f), 'utf8')));
  }
  for (const def of presets) {
    if (names.length && !names.includes(def.id) && !names.includes(def.name)) continue;
    const m = await measure(def);
    rows.push({ id: def.id || def.name, kind: def.loop ? 'loop' : 'sfx', category: def.category, layers: (def.config.layers || [def.config]).length, ...m, findings: findings(def, m) });
  }
  if (!arg('--module') && want('procedural')) {
    for (const c of proceduralCases()) {
      if (names.length && !names.some((n) => c.label.startsWith(n))) continue;
      const a = PS.buildActionCue({ ...c.params, seed: 11 }), b = PS.buildActionCue({ ...c.params, seed: 12345 });
      if (!a) continue;
      const def = { ...a, category: c.category };
      const m = await measure(def, { seeds: [def, { ...b, category: c.category }] });
      rows.push({ id: c.label, kind: 'proc', category: c.category, layers: (def.config.layers || [def.config]).length, ...m, findings: findings(def, m) });
    }
  }
  if (argv.includes('--json')) { console.log(JSON.stringify(rows, null, 2)); return; }
  for (const r of rows) {
    const flags = r.findings.map((f) => f.code).join(' ');
    console.log(`${r.id.padEnd(30)} ${String(r.layers).padStart(2)}L  pk ${String(r.peakDb).padStart(5)}  crest ${String(r.crest).padStart(5)}  laptop -${String(r.laptopLoss).padStart(4)}  partials ${String(r.partials).padStart(3)}  alias ${String(r.aliasDb).padStart(5)}  ${flags}`);
    if (argv.includes('--why')) for (const f of r.findings) console.log(`    ${f.code}: ${f.msg}`);
  }
  const by = {};
  for (const r of rows) for (const f of r.findings) by[f.code] = (by[f.code] || 0) + 1;
  const flagged = rows.filter((r) => r.findings.length).length;
  console.log(`\n${rows.length} cues, ${flagged} with findings: ${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });

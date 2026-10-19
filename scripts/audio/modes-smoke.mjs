// MODES SMOKE: struck surfaces, rendered. A hit on metal rings, on wood it knocks.
//
//   node scripts/audio/modes-smoke.mjs
//
// Builds `impact` and `footstep` cues from client/shared/procedural-sfx.js with and without a
// Sound Detail rung, renders them through the real audio-engine.js on the offline renderer
// (./offline-audio.mjs) and reads the samples. About 10 s of CPU.
//
// WHAT IT GUARDS:
//   • without `detail` (the server, regress, every caller that never asked) no cue is modal
//   • a surface with no MODES row (flesh) keeps the filtered-noise path at every rung
//   • the same seed builds the same hit, and two seeds build two different hits
//   • `limited` builds at most 4 modes, `full` at most 8, a footstep at most 4 at any rung
//   • a modal hit builds at most 2 × 8 + 4 nodes, however many partials a layer asks for
//   • every sample is finite, and no hit at full intensity peaks above -1 dBFS at gain 1
//   • a metal hit takes far longer to fall 40 dB than a wood hit, and glass longer than stone
//   • the rendered spectrum peaks at each loud mode's frequency, and those sit within the
//     table's spread of the preset's own f0 × ratio
//   • a modal hit is as loud as the filtered-noise hit it replaces, within TOL LU, measured
//     with the meter loudness-smoke.mjs uses (./loudness-lib.mjs)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installAudioGlobals } from './offline-audio.mjs';
import { momentaryMax } from './loudness-lib.mjs';
import { tally } from './stub-context.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SR = 32000;
const TOL = 2.5;          // LU a modal hit may sit from the path it replaced, averaged over seeds
const PEAK = -1;          // dBFS, the loudest a single hit may be at intensity 1 and gain 1
const NODE_CAP = 2 * 8 + 4;

const { check, done } = tally('audio:modes');
installAudioGlobals();
let lastCtx = null;
const Base = globalThis.OfflineAudioContext;
globalThis.OfflineAudioContext = class extends Base { constructor(...a) { super(...a); lastCtx = this; } };
new Function(readFileSync(join(ROOT, 'client/shared/audio-engine.js'), 'utf8'))();
new Function(readFileSync(join(ROOT, 'client/shared/procedural-sfx.js'), 'utf8'))();
const AE = globalThis.AudioEngine, P = globalThis.ProceduralSFX;

const SURFACES = Object.keys(P.MODES);
const FOOTINGS = Object.keys(P.FOOT_MODES);
const cue = (o) => P.buildActionCue(o);
const modal = (def) => def.config.layers.find((l) => l.modes);

async function render(def) {
  const buf = await AE.renderSfx(def, { sampleRate: SR });
  return { d: buf.getChannelData(0), nodes: lastCtx._nodes.length - 1 };   // less the destination
}
const peakDb = (d) => { let p = 0; for (const x of d) p = Math.max(p, Math.abs(x)); return 20 * Math.log10(p || 1e-9); };

// ── which path ───────────────────────────────────────────────────────────────
for (const surface of SURFACES) {
  check(`${surface}: an impact without detail is not modal`, !modal(cue({ action: 'impact', surface, seed: 1 })));
  for (const detail of ['limited', 'full']) {
    const l = modal(cue({ action: 'impact', surface, seed: 1, detail }));
    check(`${surface}: an impact at ${detail} is modal`, !!l);
    check(`${surface}: ${detail} builds at most ${P.MODE_LIMIT[detail]} modes`, l && l.modes.partials.length <= P.MODE_LIMIT[detail]);
  }
}
for (const surface of FOOTINGS) {
  check(`${surface} step: not modal without detail`, !modal(cue({ action: 'footstep', surface, seed: 1 })));
  const l = modal(cue({ action: 'footstep', surface, seed: 1, detail: 'full' }));
  check(`${surface} step: modal at full, at most 4 modes`, l && l.modes.partials.length <= 4);
}
check('a club on flesh keeps the old path at full', !modal(cue({ action: 'impact', surface: 'none', seed: 1, detail: 'full' })));
check('gravel underfoot keeps the old path at full', !modal(cue({ action: 'footstep', surface: 'gravel', seed: 1, detail: 'full' })));

// ── seeds ────────────────────────────────────────────────────────────────────
const same = JSON.stringify(cue({ action: 'impact', surface: 'metal', seed: 42, detail: 'full' }));
check('the same seed builds the same hit', same === JSON.stringify(cue({ action: 'impact', surface: 'metal', seed: 42, detail: 'full' })));
const f = (seed) => modal(cue({ action: 'impact', surface: 'metal', seed, detail: 'full' })).modes.partials.map((p) => p.freq);
check('two seeds build two different hits', JSON.stringify(f(42)) !== JSON.stringify(f(43)));

// ── nodes ────────────────────────────────────────────────────────────────────
{
  const { nodes } = await render(cue({ action: 'impact', surface: 'metal', intensity: 1, seed: 3, detail: 'full' }));
  check(`a full metal hit builds at most ${NODE_CAP} nodes`, nodes <= NODE_CAP, `built ${nodes}`);
  const greedy = { id: 'greedy', category: 'sfx', config: { duration: 0.5, layers: [{
    modes: { hardness: 1, strike: 0.2, partials: Array.from({ length: 30 }, (_, k) => ({ freq: 200 + 150 * k, decay: 0.4, gain: 0.03 })) },
    adsr: { a: 0, d: 0.4, s: 0, r: 0.05 }, gain: 0.5 }] } };
  const g = await render(greedy);
  check(`a layer asking for 30 modes still builds at most ${NODE_CAP} nodes`, g.nodes <= NODE_CAP, `built ${g.nodes}`);
}

// ── finite, and headroom ─────────────────────────────────────────────────────
for (const [action, list] of [['impact', SURFACES], ['footstep', FOOTINGS]]) {
  for (const surface of list) {
    let worst = -Infinity, finite = true;
    for (let seed = 1; seed <= 4; seed++) {
      const { d } = await render(cue({ action, surface, intensity: 1, seed, detail: 'full' }));
      for (const x of d) if (!Number.isFinite(x)) { finite = false; break; }
      worst = Math.max(worst, peakDb(d));
    }
    check(`${action} ${surface}: every sample is finite`, finite);
    check(`${action} ${surface}: peaks at or under ${PEAK} dBFS at full intensity`, worst <= PEAK, `peaked at ${worst.toFixed(1)} dBFS`);
  }
}

// ── decay: time to fall 40 dB from the loudest 10 ms ─────────────────────────
async function fall40(surface) {
  const { d } = await render(cue({ action: 'impact', surface, intensity: 0.6, weight: 0.5, seed: 11, detail: 'full' }));
  const n = Math.round(0.01 * SR), rms = [];
  for (let i = 0; i + n <= d.length; i += n) { let s = 0; for (let j = i; j < i + n; j++) s += d[j] * d[j]; rms.push(Math.sqrt(s / n)); }
  const top = rms.indexOf(Math.max(...rms));
  let k = top;
  while (k < rms.length && rms[k] > rms[top] * 0.01) k++;
  return (k - top) * 0.01;
}
{
  const [metal, wood, glass, stone] = [await fall40('metal'), await fall40('wood'), await fall40('glass'), await fall40('stone')];
  check('a metal hit rings more than three times as long as a wood hit', metal > 3 * wood, `metal ${metal.toFixed(2)} s, wood ${wood.toFixed(2)} s`);
  check('a glass hit rings longer than a stone one', glass > 2 * stone, `glass ${glass.toFixed(2)} s, stone ${stone.toFixed(2)} s`);
}

// ── spectrum: the loud modes are where the table says ────────────────────────
// Goertzel magnitude of the first `len` samples, Hann-windowed, at frequency `hz`.
function mag(d, hz, len) {
  const w = 2 * Math.PI * hz / SR, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < len; i++) {
    const s0 = d[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (len - 1))) + c * s1 - s2;
    s2 = s1; s1 = s0;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2);
}
for (const surface of ['metal', 'glass', 'ceramic']) {
  const m = P.MODES[surface], weight = 0.5;
  const def = cue({ action: 'impact', surface, intensity: 0.8, weight, seed: 7, detail: 'full' });
  const parts = modal(def).modes.partials;
  const size = 1.25 + (0.7 - 1.25) * weight;
  const nearPreset = parts.every((p, k) => Math.abs(p.freq / (m.f0 * size * m.ratios[k]) - 1) <= m.spread + 1e-9);
  check(`${surface}: every mode sits within ${m.spread * 100}% of the preset's f0 × ratio`, nearPreset);
  const { d } = await render(def);
  const len = Math.min(d.length, Math.round(0.25 * SR));
  const loud = parts.map((p, k) => ({ ...p, k })).sort((a, b) => b.gain - a.gain).slice(0, 3);
  for (const p of loud) {
    let best = 0, at = 0;
    for (let hz = p.freq * 0.92; hz <= p.freq * 1.08; hz += p.freq * 0.002) { const v = mag(d, hz, len); if (v > best) { best = v; at = hz; } }
    check(`${surface}: the spectrum peaks at mode ${p.k + 1} (${Math.round(p.freq)} Hz)`, Math.abs(at / p.freq - 1) <= 0.01, `the peak near it is at ${Math.round(at)} Hz`);
  }
}

// ── break: pieces on the modal path, capped ──────────────────────────────────
const BREAK_CAP = { full: 60, limited: 36 };
for (const surface of ['glass', 'ceramic', 'wood']) {
  check(`${surface} break: not modal without detail`, !modal(cue({ action: 'break', surface, seed: 1 })));
  const a = JSON.stringify(cue({ action: 'break', surface, seed: 9, detail: 'full' }));
  check(`${surface} break: the same seed builds the same break`, a === JSON.stringify(cue({ action: 'break', surface, seed: 9, detail: 'full' })));
  check(`${surface} break: two seeds build two different breaks`, a !== JSON.stringify(cue({ action: 'break', surface, seed: 10, detail: 'full' })));
  for (const detail of [undefined, 'limited', 'full']) {
    let worst = -Infinity, finite = true, most = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { d, nodes } = await render(cue({ action: 'break', surface, intensity: 1, seed, detail }));
      for (const x of d) if (!Number.isFinite(x)) { finite = false; break; }
      worst = Math.max(worst, peakDb(d));
      most = Math.max(most, nodes);
    }
    const tag = detail || 'no detail';
    check(`${surface} break at ${tag}: every sample is finite`, finite);
    check(`${surface} break at ${tag}: peaks at or under ${PEAK} dBFS`, worst <= PEAK, `peaked at ${worst.toFixed(1)} dBFS`);
    if (detail) check(`${surface} break at ${detail}: at most ${BREAK_CAP[detail]} nodes`, most <= BREAK_CAP[detail], `built ${most}`);
  }
}

// ── loudness against the old path ────────────────────────────────────────────
for (const [action, list] of [['impact', SURFACES], ['footstep', FOOTINGS]]) {
  for (const surface of list) {
    let diff = 0, n = 0;
    for (const intensity of [0.3, 0.8]) {
      for (let seed = 1; seed <= 3; seed++) {
        const old = momentaryMax((await render(cue({ action, surface, intensity, seed }))).d, SR);
        const now = momentaryMax((await render(cue({ action, surface, intensity, seed, detail: 'full' }))).d, SR);
        diff += now - old; n++;
      }
    }
    diff /= n;
    check(`${action} ${surface}: as loud as the path it replaced, within ${TOL} LU`, Math.abs(diff) <= TOL, `modal is ${diff > 0 ? '+' : ''}${diff.toFixed(1)} LU`);
  }
}

done();

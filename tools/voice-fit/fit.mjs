// fit.mjs: fit ORACLE's vowel targets, vowel drift and locus equations to measurements.
//
//   node tools/voice-fit/fit.mjs <measures.json> <voice.json>
//
// Each vowel's readings (three in h_d, two each after b/p, d/t and g/k) are pooled. A
// reading whose F1 or F2 at its middle sits more than 2.5 median absolute deviations from
// the vowel's median is dropped (a misread word, or a tracker that locked on a harmonic),
// then each target is the median of what's left:
//   f   the vowel at 20% of its length, as PH's `f` is the start
//   to  the vowel at 80%, for the diphthongs (PH `to`)
//   vs  80% over 20% as ratios, for the monophthongs (PH `vs`); only where it's over 3%
// The locus equations are fitted per place by least squares on F2 at the vowel's onset
// against F2 at its middle, over the CVC words. Prints a table against ORACLE's own.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [, , MEAS, OUT] = process.argv;
const M = JSON.parse(readFileSync(MEAS, 'utf8'));

const VOWEL_OF = {
  IY: 'heed beat deep keen', IH: 'hid bit dip kid', EH: 'head bet deck get', AE: 'had bat dad gap',
  AA: 'hod pot dock got', AO: 'hawed bought dawn caught', UH: 'hood book took good', UW: "who'd boot dune cool",
  AH: 'hud but dug gut', ER: 'heard bird dirt curt', EY: 'hayed bait date gate', AY: 'hide bite dine kite',
  OW: 'hoed boat dote goat', AW: "how'd bout doubt gown", OY: 'hoyed boy toy coin',
};
const DIPH = new Set(['EY', 'AY', 'OY', 'OW', 'AW']);
const PLACE = { b: 'LAB', p: 'LAB', d: 'ALV', t: 'ALV', g: 'VEL', k: 'VEL', c: 'VEL' };
const word = (t) => t.replace(/^Say /, '').replace(/ (aloud|again)\.$/, '').toLowerCase();
// Part 5's words: K and G before front and back vowels, for the velar loci only.
const P5 = { keen: 'IY', kit: 'IH', cake: 'EY', kettle: 'EH', cat: 'AE', geese: 'IY', give: 'IH', gate: 'EY', get: 'EH', gap: 'AE',
  cool: 'UW', coat: 'OW', caught: 'AO', car: 'AA', goose: 'UW', goat: 'OW', gone: 'AA' };
const byWord = new Map();
for (const [v, ws] of Object.entries(VOWEL_OF)) for (const w of ws.split(' ')) byWord.set(w, v);

const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); if (!s.length) return NaN; const m = s.length >> 1; return s.length & 1 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mad = (a) => { const m = med(a); return med(a.map(x => Math.abs(x - m))); };

// The engine's current tables, for the comparison.
globalThis.window = globalThis;
new Function(readFileSync(join(ROOT, 'client/shared/formant-cmudict.js'), 'utf8'))();
new Function(readFileSync(join(ROOT, 'client/shared/audio-engine.js'), 'utf8'))();
const PHT = globalThis.AudioEngine._phTable?.() || {};

const groups = new Map();
for (const l of M.lines) {
  const w = word(l.text), v = byWord.get(w);
  if (!v || P5[w] && / again.$/.test(l.text) || !l.f20?.[1] || !l.f50?.[1] || !l.f80?.[1]) continue;
  if (!groups.has(v)) groups.set(v, []);
  groups.get(v).push({ ...l, w });
}
const vowels = {}, report = [], loci = { LAB: [], ALV: [], VEL: [], VEL_F: [], VEL_B: [] };
for (const v of Object.keys(VOWEL_OF)) {
  const all = groups.get(v) || [];
  const f1 = all.map(r => r.f50[0]), f2 = all.map(r => r.f50[1]);
  const m1 = med(f1), m2 = med(f2), d1 = mad(f1) || 1, d2 = mad(f2) || 1;
  const keep = all.filter(r => Math.abs(r.f50[0] - m1) <= 2.5 * d1 && Math.abs(r.f50[1] - m2) <= 2.5 * d2);
  const at = (k) => [0, 1, 2].map(i => Math.round(med(keep.map(r => r[k][i]))));
  const f = at('f20'), mid = at('f50'), end = at('f80');
  const e = { f };
  if (DIPH.has(v)) e.to = end;
  else {
    const vs = end.map((x, i) => +(x / f[i]).toFixed(3));
    if (vs.some(r => Math.abs(r - 1) > 0.03)) e.vs = vs;
  }
  e.n = keep.length; e.dropped = all.filter(r => !keep.includes(r)).map(r => r.n);
  e.dur = +med(keep.map(r => r.dur)).toFixed(3);
  vowels[v] = e;
  report.push([v, keep.length + '/' + all.length, f.join(' '), (e.to || mid).join(' '), PHT[v]?.f?.join(' ') ?? '?', e.vs ? e.vs.join(' ') : '', e.dropped.join(',')]);
  if (!DIPH.has(v)) for (const r of keep) {
    const p = PLACE[r.w[0]];
    if (p && Number.isFinite(r.f2on)) {
      loci[p].push([mid[1], r.f2on]);
      // the velar line split by frontness, as locusEq reads it (VEL_SPLIT)
      if (p === 'VEL') loci[mid[1] >= 1500 ? 'VEL_F' : 'VEL_B'].push([mid[1], r.f2on]);
    }
  }
}
// Part 5 against each vowel's pooled middle; a reading 400 Hz off it caught "again".
for (const l of M.lines) {
  const v = P5[word(l.text)], mid = vowels[v] && (vowels[v].to || vowels[v].f);
  if (!v || !Number.isFinite(l.f2on) || !l.f50?.[1]) continue;
  const m2 = groups.get(v) ? med(groups.get(v).map(r => r.f50[1])) : mid[1];
  if (Math.abs(l.f50[1] - m2) > 400) { console.log(`part 5: dropped "${word(l.text)}" (F2 ${l.f50[1]} against ${Math.round(m2)})`); continue; }
  loci.VEL.push([m2, l.f2on]);
  loci[m2 >= 1500 ? 'VEL_F' : 'VEL_B'].push([m2, l.f2on]);
}
const eq = {};
for (const [p, pts] of Object.entries(loci)) {
  if (pts.length < (p.startsWith('VEL_') ? 4 : 6)) continue;
  const n = pts.length, sx = pts.reduce((s, [x]) => s + x, 0), sy = pts.reduce((s, [, y]) => s + y, 0);
  const sxx = pts.reduce((s, [x]) => s + x * x, 0), sxy = pts.reduce((s, [x, y]) => s + x * y, 0);
  const k = (n * sxy - sx * sy) / (n * sxx - sx * sx), c = (sy - k * sx) / n;
  const ss = pts.reduce((s, [x, y]) => s + (y - k * x - c) ** 2, 0), st = pts.reduce((s, [, y]) => s + (y - sy / n) ** 2, 0);
  eq[p] = { k: +k.toFixed(3), c: Math.round(c), r2: +(1 - ss / st).toFixed(2), n };
}

console.log(`speaker: median F0 ${Math.round(M.f0)} Hz (pitch detector), formant ceiling ${M.ceiling} Hz\n`);
console.log('vowel  kept   start (F1 F2 F3)   end or middle      ORACLE now        drift (vs)        dropped lines');
for (const r of report) console.log(r[0].padEnd(6), r[1].padEnd(6), r[2].padEnd(18), r[3].padEnd(18), r[4].padEnd(17), r[5].padEnd(17), r[6]);
console.log('\nlocus equations  F2onset = k * F2vowel + c');
for (const [p, e] of Object.entries(eq)) console.log(`  ${p}: k ${e.k}, c ${e.c} (r² ${e.r2}, ${e.n} readings)`);

// The speaking voice: F0 off the test vowels (the whole-clip detector jumps octaves on a
// creaky voice), fshift 1 because the targets are this speaker's own Hz.
const f0 = Math.round(med(M.lines.map(l => l.f0).filter(x => x >= 55 && x <= 260)));
const own = {};
// F1 and F2 are the speaker's; F3 stays the engine's. The measured F3s ran 2500-3300 Hz
// (a deep voice's F3 is weak, and LPC slides up to F4), and with them the voice sounded
// hollow and nasal; with the tables' F3 it didn't (David's A/B, 2026-11-23).
const f3 = (v, end) => (end ? (PHT[v]?.to || PHT[v]?.f) : PHT[v]?.f)?.[2];
for (const [v, e] of Object.entries(vowels)) own[v] = {
  f: [e.f[0], e.f[1], f3(v) ?? e.f[2]],
  ...(e.to ? { to: [e.to[0], e.to[1], f3(v, true) ?? e.to[2]] } : {}),
  ...(e.vs ? { vs: [e.vs[0], e.vs[1], 1] } : {}),
};
// A place's equation is only used where it fits (r² 0.3 or better, a slope a locus can
// have); elsewhere the voice keeps the engine's LOCUS_EQ.
// trach 0: the tracheal pole-zero pairs added peaks at 600 and 1550 Hz this speaker
// doesn't have, and read as nasal on a voice this low and lax.
const voice = { f0, fshift: 1, trach: 0, vowels: own, locus: Object.fromEntries(Object.entries(eq).filter(([, e]) => e.r2 >= 0.3 && e.k >= 0.2 && e.k <= 1.1).map(([p, e]) => [p, { k: e.k, c: e.c }])) };
console.log(`
voice F0 ${f0} Hz (median over the test vowels)`);
writeFileSync(OUT, JSON.stringify({ source: 'tools/voice-fit', measured: { vowels, locus: eq, ceiling: M.ceiling }, voice }, null, 1));

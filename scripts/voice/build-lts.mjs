// build-lts — train ORACLE's letter-to-sound trees from the lexicon it already ships.
//
//   node scripts/voice/build-lts.mjs            measure, then write client/shared/oracle-lts.js
//   node scripts/voice/build-lts.mjs --measure  measure only: trees vs the g2p rules on held-out words
//
// The method is Flite's (Black, Lenzo & Pagel 1998): align each word's letters to its
// phones, one letter to nothing, one phone or two (x is K S), then grow one decision tree
// per letter that picks its phone from the four letters either side. No neural net:
// ID3 on letter identity, as CART letter-to-sound always was.
//
// It trains on formant-cmudict.js, the 28k-word subset the game already loads, so
// there's nothing to download. The trees only ever see words that subset lacks, so the
// held-out score (words the trees never saw) is the one that matters.
//
// Stress is a second set of trees, one per letter, asked only of letters that came out
// as a vowel: how likely that vowel is the word's main stress, from the letters around
// and how many vowels come before and after it. The likeliest vowel takes the '*'.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'client', 'shared', 'oracle-lts.js');
const MEASURE_ONLY = process.argv.includes('--measure');
const W = 4;              // letters of context either side (3 gets 62.8% of held-out words, 4 gets 64.0%)
const MIN_LEAF = 1;       // examples a branch needs (2 drops held-out words to 57.8%, 3 to 54.8%)

globalThis.window = globalThis;
new Function(readFileSync(join(ROOT, 'client/shared/formant-cmudict.js'), 'utf8'))();
const D = globalThis.CMUDICT;

// ── The lexicon, stress stripped (AH0 is AX, as cmuLook makes it) ────────────────
const words = [];
for (const line of D.blob.split('\n')) {
  const sp = line.indexOf(' '); if (sp < 0) continue;
  const w = line.slice(0, sp);
  if (!/^[a-z']+$/.test(w) || w.length < 2) continue;
  const raw = [...line.slice(sp + 1)].map(ch => D.phones[D.alpha.indexOf(ch)]);
  const ph = raw.map(t => t === 'AH0' ? 'AX' : t.replace(/[012]$/, ''));
  words.push([w, ph, raw.map(t => t.endsWith('1'))]);
}

// ── Alignment by EM ──────────────────────────────────────────────────────────────
// Each letter emits '_' (silent), one phone, or two joined with '|'. Start every pair
// alike, align by the best path, count, and go again.
const EPS = '_';
let P = new Map();   // "letter phone" -> log-prob
const lp = (l, o) => P.get(l + ' ' + o) ?? (o.includes('|') ? -12 : o === EPS ? -4 : -6);
function align(w, ph) {
  const n = w.length, m = ph.length;
  const best = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(-Infinity));
  const back = Array.from({ length: n + 1 }, () => new Array(m + 1));
  best[0][0] = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j <= m; j++) {
    const b = best[i][j]; if (b === -Infinity) continue;
    const l = w[i];
    const opts = [[EPS, 0]];
    if (j < m) opts.push([ph[j], 1]);
    if (j + 1 < m) opts.push([ph[j] + '|' + ph[j + 1], 2]);
    for (const [o, k] of opts) {
      const s = b + lp(l, o);
      if (s > best[i + 1][j + k]) { best[i + 1][j + k] = s; back[i + 1][j + k] = [o, k]; }
    }
  }
  if (best[n][m] === -Infinity) return null;
  const out = []; let j = m;
  for (let i = n; i > 0; i--) { const [o, k] = back[i][j]; out.unshift(o); j -= k; }
  return out;
}
let aligned = [];
for (let it = 0; it < 6; it++) {
  const cnt = new Map(), tot = new Map();
  aligned = [];
  for (const [w, ph] of words) {
    const a = align(w, ph); if (!a) continue;
    aligned.push([w, a]);
    for (let i = 0; i < w.length; i++) {
      const key = w[i] + ' ' + a[i];
      cnt.set(key, (cnt.get(key) || 0) + 1); tot.set(w[i], (tot.get(w[i]) || 0) + 1);
    }
  }
  P = new Map();
  for (const [key, c] of cnt) P.set(key, Math.log(c / tot.get(key[0])));
}
// Which letter carries the main stress: the one whose phones hold the stressed vowel.
const STRESS_OF = new Map(words.map(([w, , st]) => [w, st]));
for (const e of aligned) {
  const st = STRESS_OF.get(e[0]); let j = 0;
  e[2] = e[1].map(o => { const k = o === EPS ? 0 : o.split('|').length; const hit = st.slice(j, j + k).some(Boolean); j += k; return hit; });
}
const VOWEL = new Set(['AA','AE','AH','AO','AW','AX','AY','EH','ER','EY','IH','IY','OW','OY','UH','UW']);
const isV = (o) => o !== EPS && o.split('|').some(x => VOWEL.has(x));

// ── Trees: ID3 on the letters around ─────────────────────────────────────────────
const feats = (w, i) => {
  const f = [];
  for (let d = -W; d <= W; d++) if (d) f.push(w[i + d] ?? '#');
  return f;
};
function entropy(counts, n) {
  let h = 0; for (const c of counts.values()) { const p = c / n; h -= p * Math.log2(p); }
  return h;
}
function majority(ex) {
  const c = new Map(); for (const e of ex) c.set(e.y, (c.get(e.y) || 0) + 1);
  let best = null, bc = -1; for (const [k, v] of c) if (v > bc) { best = k; bc = v; }
  return [best, c];
}
// Nearest context first, so equal gains split on the closer letter.
const ORDER = [3, 4, 2, 5, 1, 6, 0, 7];   // feature index: -1, +1, -2, +2, -3, +3, -4, +4
// `leaf` turns a node's examples into its answer (the majority phone, or for stress the
// share that are stressed); `order` and `minLeaf` as for the phone trees unless given.
function grow(ex, used, order = ORDER, leaf = null, minLeaf = MIN_LEAF) {
  const [m0, counts] = majority(ex);
  const maj = leaf ? leaf(ex) : m0;
  if (counts.size === 1 || ex.length < 2 * minLeaf) return maj;
  const h0 = entropy(counts, ex.length);
  let bestF = -1, bestGain = 1e-9, bestParts = null;
  for (const f of order) {
    if (used & (1 << f)) continue;
    const parts = new Map();
    for (const e of ex) { const v = e.x[f]; if (!parts.has(v)) parts.set(v, []); parts.get(v).push(e); }
    if (parts.size < 2) continue;
    let h = 0;
    for (const p of parts.values()) h += p.length / ex.length * entropy(majority(p)[1], p.length);
    if (h0 - h > bestGain) { bestGain = h0 - h; bestF = f; bestParts = parts; }
  }
  if (bestF < 0) return maj;
  const kids = {};
  for (const [v, p] of bestParts) {
    if (p.length < minLeaf) continue;   // too few to trust: the default takes it
    const k = grow(p, used | (1 << bestF), order, leaf, minLeaf);
    kids[v] = k;
  }
  // collapse a split whose every branch says the default
  if (Object.values(kids).every(k => k === maj)) return maj;
  return [bestF, kids, maj];
}
function train(set) {
  const by = new Map();
  for (const [w, a] of set) for (let i = 0; i < w.length; i++) {
    if (!by.has(w[i])) by.set(w[i], []);
    by.get(w[i]).push({ x: feats(w, i), y: a[i] });
  }
  const trees = {};
  for (const [l, ex] of by) trees[l] = grow(ex, 0);
  return trees;
}
function predict(trees, w) {
  const out = [];
  for (let i = 0; i < w.length; i++) {
    let t = trees[w[i]]; if (t == null) continue;
    const x = feats(w, i);
    while (Array.isArray(t)) { const k = t[1][x[t[0]]]; t = k === undefined ? t[2] : k; }
    if (t !== EPS) out.push(...t.split('|'));
  }
  return out;
}

// ── Stress trees ─────────────────────────────────────────────────────────────────
// Features: the eight letters, then vowels before and after this one (capped at 4).
// (Adding the word's last letters and its vowel count did worse, 77.9% against 85.8%:
// ID3 favours features with many values and splits the examples into scraps.)
const SORDER = [8, 9, 3, 4, 2, 5, 1, 6, 0, 7];
const SMIN = 2;
const sfeats = (w, i, vb, va) => [...feats(w, i), String(Math.min(4, vb)), String(Math.min(4, va))];
const share = (ex) => Math.round(100 * ex.filter(e => e.y).length / ex.length) / 100;
function vowelLetters(a) { const v = []; for (let i = 0; i < a.length; i++) if (isV(a[i])) v.push(i); return v; }
function trainStress(set) {
  const by = new Map();
  for (const [w, a, ls] of set) {
    const v = vowelLetters(a); if (v.length < 2 || !v.some(i => ls[i])) continue;
    v.forEach((i, k) => {
      if (!by.has(w[i])) by.set(w[i], []);
      by.get(w[i]).push({ x: sfeats(w, i, k, v.length - 1 - k), y: ls[i] ? 1 : 0 });
    });
  }
  const t = {};
  for (const [l, ex] of by) t[l] = grow(ex, 0, SORDER, share, SMIN);
  return t;
}
// The letter index the trees stress, given the letters' outputs `a`.
function predictStress(st, w, a) {
  const v = vowelLetters(a); let best = -1, bp = -1;
  v.forEach((i, k) => {
    let t = st[w[i]]; if (t == null) return;
    const x = sfeats(w, i, k, v.length - 1 - k);
    while (Array.isArray(t)) { const c = t[1][x[t[0]]]; t = c === undefined ? t[2] : c; }
    if (t > bp) { bp = t; best = i; }
  });
  return best;
}

// ── Measure: every tenth word held out, scored against the rules ─────────────────
function edits(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// Schwa and unstressed AH are one sound to the ear here; so is ER against AX R.
const norm = (ph) => ph.filter(p => p !== '*' && p !== '!').map(p => p === 'AH' ? 'AX' : p).join(' ').replace(/AX R/g, 'ER').split(' ').filter(Boolean);
const test = aligned.filter((_, k) => k % 10 === 0), trainSet = aligned.filter((_, k) => k % 10 !== 0);
const truth = new Map(words);
const held = train(trainSet);
new Function(readFileSync(join(ROOT, 'client/shared/audio-engine.js'), 'utf8'))();
const rules = (w) => globalThis.AudioEngine._g2p(w);
const score = (fn) => {
  let ok = 0, err = 0, len = 0;
  for (const [w] of test) {
    const t = norm(truth.get(w)), p = norm(fn(w));
    if (t.join() === p.join()) ok++;
    err += edits(t, p); len += t.length;
  }
  return { words: ok / test.length, phones: 1 - err / len };
};
const sT = score(w => predict(held, w)), sR = score(rules);
const pct = (x) => (100 * x).toFixed(1) + '%';
console.log(`held out: ${test.length} words the trees never saw`);
console.log(`  trees: ${pct(sT.words)} words right, ${pct(sT.phones)} phones right`);
console.log(`  rules: ${pct(sR.words)} words right, ${pct(sR.phones)} phones right`);
// Stress, on the true phones so only the stress is scored: which vowel (by count) is it?
const heldS = trainStress(trainSet);
let sOk = 0, gOk = 0, sN = 0;
for (const [w, a, ls] of test) {
  const v = vowelLetters(a); const truthK = v.findIndex(i => ls[i]);
  if (v.length < 2 || truthK < 0) continue;
  sN++;
  if (v.indexOf(predictStress(heldS, w, a)) === truthK) sOk++;
  const g = globalThis.AudioEngine._guessStress(truth.get(w), w);
  let k = -1, n = 0; for (let i = 0; i < g.length; i++) { if (g[i] === '*') { k = n; break; } if (VOWEL.has(g[i])) n++; }
  if (k === truthK) gOk++;
}
console.log(`stress, held out: ${sN} words of two or more vowels`);
console.log(`  trees: ${pct(sOk / sN)} on the right vowel`);
console.log(`  guess: ${pct(gOk / sN)} on the right vowel`);
if (MEASURE_ONLY) process.exit(0);

// ── Write: trained on everything ─────────────────────────────────────────────────
const trees = train(aligned), stress = trainStress(aligned);
const body = JSON.stringify({ w: W, trees, stress });
writeFileSync(OUT,
  '// GENERATED — do not edit by hand. Rebuild with:\n' +
  '//   node scripts/voice/build-lts.mjs\n' +
  '//\n' +
  "// ORACLE's letter-to-sound trees, one per letter, trained on formant-cmudict.js's words\n" +
  `// (held out, ${pct(sT.words)} of words right against the rules' ${pct(sR.words)}). A node is\n` +
  '// [feature, {letter: child}, default]; features are the letters at -4..-1, +1..+4; a\n' +
  "// leaf is a phone, '_' for silent, or two phones joined by '|'. Used by g2p in\n" +
  '// audio-engine.js for words the lexicon lacks. `stress` is the same shape over ten\n' +
  '// features (the letters, then vowels before and after, capped at 4), each leaf the share\n' +
  `// stressed; the likeliest vowel takes it (held out, ${pct(sOk / sN)} right against the guess's ${pct(gOk / sN)}).\n` +
  '//\n' +
  '// Derived from CMUdict, Copyright (C) 1993-2015 Carnegie Mellon University, under its\n' +
  '// BSD-style licence: use in source and binary forms, with or without modification, is\n' +
  '// permitted provided this notice is retained.\n' +
  'window.ORACLE_LTS = ' + body + ';\n');
console.log(`wrote ${OUT} (${(body.length / 1024).toFixed(0)} KB)`);

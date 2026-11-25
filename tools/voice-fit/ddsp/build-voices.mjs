// build-voices.mjs: a natural man's and woman's voice from VCTK's North American speakers
// (docs/proposals/oracle-teacher.md, "Two voices").
//
//   node tools/voice-fit/ddsp/build-voices.mjs <group-M.json> <group-F.json>
//
// group-voice.py measures each group's vowels (F1 to F3 at 20% and 80%) and pitch. Everything
// else a voice carries is taken from the fitted voice (data/voice/fitted-voice.json): its
// timing, durations, intonation, loci and liquids were fitted to a real speaker, and they're the
// most natural part of any voice ORACLE has. For the woman, the loci's intercepts and the
// liquids' formants are scaled by the women's formants over the men's, her open quotient is
// the breathier one women's voices have, and her sibilants are centred where VCTK's women's are.
// Writes data/voice/natural-male.json and data/voice/natural-female.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const [, , GM, GF] = process.argv;
const fitted = JSON.parse(readFileSync(join(ROOT, 'data/voice/fitted-voice.json'), 'utf8')).voice;
const M = JSON.parse(readFileSync(GM, 'utf8')), F = JSON.parse(readFileSync(GF, 'utf8'));

// The render's sibilant centre comes out a little under the band's `nf` (measured over VCTK's
// lines: /s/ 0.915, /z/ 0.925, /sh/ 0.974, /ch/ 0.954), so a target centre is divided by that.
const NF_RATIO = { S: 0.915, Z: 0.925, SH: 0.974, CH: 0.954 };
const SIB = { M: { S: 5648, Z: 5514, SH: 3541, CH: 3459 }, F: { S: 7882, Z: 7637, SH: 4199, CH: 4260 } };
const consFor = (sex) => {
  const c = JSON.parse(JSON.stringify(fitted.cons || {}));
  for (const [p, hz] of Object.entries(SIB[sex])) c[p] = { ...(c[p] || {}), nf: Math.round(hz / NF_RATIO[p]) };
  return c;
};

// Women's formants over men's, per formant, from the vowels both groups have.
const ratio = [0, 1, 2].map(k => {
  const r = Object.keys(M.vowels).filter(v => F.vowels[v]).map(v => F.vowels[v].f[k] / M.vowels[v].f[k]).sort((a, b) => a - b);
  return r[r.length >> 1];
});
const scaleF = (f) => f.map((v, k) => Math.round(v * ratio[Math.min(k, 2)]));

// formantNet 0: the formant controller corrects the fitted voice's rule vowels; on measured
// vowels it corrects them twice (word error +8 points for the man, +5 for the woman).
const base = { ...fitted, formantNet: 0 };
const male = {
  ...base, f0: M.f0, vowels: M.vowels, cons: consFor('M'),
  // the fitted voice's 0.4 is the floor: H1-A3 8.7 dB against VCTK's men's 17.4, the buzz;
  // 0.62 puts H1-H2, H1-A3 and HNR on theirs
  oq: 0.62,
};
const female = {
  ...base, f0: F.f0, vowels: F.vowels, cons: consFor('F'),
  // H1-H2 and HNR on VCTK's women's at 0.75. Her F3 sits where the men's top-end shelf
  // starts (2.8 kHz), so hers starts 15% higher and lifts less: H1-A3 14.5 against 16.7.
  oq: 0.75, hpcHz: 3300, hpcDb: 11,
  locus: Object.fromEntries(Object.entries(fitted.locus || {}).map(([k, v]) => [k, { ...v, c: Math.round(v.c * ratio[1]) }])),
  liquids: Object.fromEntries(Object.entries(fitted.liquids || {}).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([q, f]) => [q, Array.isArray(f) ? scaleF(f) : f]))])),
};
const about = (who, g) => `tools/voice-fit/ddsp/build-voices.mjs: vowels and pitch from VCTK 0.92's North American ${who} (${g.speakers.length} speakers, CC BY 4.0); timing, durations, intonation and liquids from the fitted voice`;
writeFileSync(join(ROOT, 'data/voice/natural-male.json'), JSON.stringify({ source: about('men', M), voice: male }, null, 1) + '\n');
writeFileSync(join(ROOT, 'data/voice/natural-female.json'), JSON.stringify({ source: about('women', F), voice: female }, null, 1) + '\n');
console.log('women over men, F1 F2 F3:', ratio.map(r => r.toFixed(3)).join(' '));
console.log('male f0', M.f0, 'female f0', F.f0);

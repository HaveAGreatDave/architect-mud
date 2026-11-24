// fit-consonants.mjs: fit a voice's fricative bands and stop aspiration to the speaker's.
//
//   node tools/voice-fit/fit-consonants.mjs <voice.json> <segs.json> <speaker cons.json> [rounds]
//
// The speaker's numbers come from measure-cons.py on align.py's boundaries. Each round
// renders the lines (render-trace.mjs), measures the render on its own trace the same
// way, and moves each consonant toward the speaker: a fricative's band `nf` by the ratio
// of the centres of gravity, a stop's `asp` by the ratio of the VOTs. Written to the
// voice as `cons`. A consonant with fewer than 8 readings either side is left alone.
//
// Only the sibilants' bands are fitted. /f v θ ð/ are weak and flat, and their centre of
// gravity is set by the voicing and the vowels around them, not the band: moving `nf`
// drove it to its limits on the first voice while the measure barely moved.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..', '..');
const [, , VOICE, SEGS, YOU, ROUNDS = '4'] = process.argv;
const PY = join(homedir(), 'Hunyuan3D-2/.venv/Scripts/python.exe');
const MIN_N = 8;
globalThis.window = globalThis;
for (const f of ['formant-cmudict', 'oracle-lts', 'audio-engine']) new Function(readFileSync(join(ROOT, `client/shared/${f}.js`), 'utf8'))();
const PH = globalThis.AudioEngine._phTable();
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const you = JSON.parse(readFileSync(YOU, 'utf8'));
const file = JSON.parse(readFileSync(VOICE, 'utf8'));
const cons = file.voice.cons || {};
const dir = join(HERE, 'out', 'cons-fit');
const tmpVoice = join(HERE, 'out', 'cons-fit-voice.json'), tmpMeas = join(HERE, 'out', 'cons-fit.json');

for (let r = 0; r <= +ROUNDS; r++) {
  writeFileSync(tmpVoice, JSON.stringify({ voice: { ...file.voice, cons } }));
  execFileSync('node', [join(HERE, 'render-trace.mjs'), tmpVoice, SEGS, dir], { stdio: 'ignore' });
  execFileSync(PY, ['measure-cons.py', '--trace', dir, tmpMeas], { cwd: HERE, stdio: 'ignore' });
  const syn = JSON.parse(readFileSync(tmpMeas, 'utf8'));
  const rows = [];
  for (const [kind, key, lo, hi] of [['cog', 'nf', 1200, 9000], ['vot', 'asp', 5, 120]]) {
    for (const [p, a] of Object.entries(you[kind])) {
      const b = syn[kind][p];
      if (!b || a.length < MIN_N || b.length < MIN_N || !PH[p]) continue;
      if (kind === 'cog' && !PH[p].sib) continue;   // see the header: a weak fricative's band doesn't set its centre
      const want = med(a), got = med(b);
      rows.push(`${p} ${kind} ${want} vs ${got} (${(100 * (got / want - 1)).toFixed(0)}%)`);
      if (r === +ROUNDS) continue;
      const cur = (cons[p] && cons[p][key]) ?? PH[p][key];
      const next = Math.max(lo, Math.min(hi, cur * (want / got)));
      cons[p] = { ...(cons[p] || {}), [key]: key === 'nf' ? Math.round(next) : +next.toFixed(1) };
    }
  }
  console.log(`round ${r}: ${rows.join(', ')}`);
}
file.voice.cons = cons;
writeFileSync(VOICE, JSON.stringify(file, null, 1));
console.log('cons', JSON.stringify(cons));

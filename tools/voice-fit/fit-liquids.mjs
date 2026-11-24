// fit-liquids.mjs: fit a voice's vowels before r and l to the speaker's (Part 2).
//
//   node tools/voice-fit/fit-liquids.mjs <voice.json> <lines.json> <part2.wav>
//
// Renders Part 2's lines with their trace (render-trace.mjs), aligns them onto the
// speaker (align.py), and measures F1 and F2 at the vowel's 20% and 80% and the liquid's
// middle on both (measure-liquids.py). Each pair ('AY|ER', 'IY|L') gets the speaker's
// three points, as the voice's `liquids`, with F3 kept from the tables, as fit.mjs keeps
// it. Then renders again with them and prints how far each point is from the speaker's,
// before and after, so a pair the measure got wrong shows up.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..', '..');
const [, , VOICE, LINES, WAV] = process.argv;
const PY = join(homedir(), 'Hunyuan3D-2/.venv/Scripts/python.exe');
globalThis.window = globalThis;
for (const f of ['formant-cmudict', 'oracle-lts', 'audio-engine']) new Function(readFileSync(join(ROOT, `client/shared/${f}.js`), 'utf8'))();
const PH = globalThis.AudioEngine._phTable();
const LIQ = new Set(['R', 'L', 'ER']);
const out = (f) => join(HERE, 'out', f);
const file = JSON.parse(readFileSync(VOICE, 'utf8'));
const segs = JSON.parse(readFileSync(LINES, 'utf8')).filter(l => l.part === 'part2')
  .map(l => ({ id: l.n, t0: Math.max(0, l.t0 - 0.05), t1: l.t1 + 0.1, text: l.text }));
writeFileSync(out('p2seg.json'), JSON.stringify(segs));
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

function renderAndMeasure(voice, tag) {
  const vf = out(`p2voice-${tag}.json`), dir = out(`p2trace-${tag}`);
  writeFileSync(vf, JSON.stringify({ voice }));
  execFileSync('node', [join(HERE, 'render-trace.mjs'), vf, out('p2seg.json'), dir], { stdio: 'ignore' });
  // the vowel and liquid of the test word: the first vowel+liquid after "say"'s EY
  const tr = JSON.parse(readFileSync(join(dir, 'trace.json'), 'utf8')), pairs = {};
  for (const [id, t] of Object.entries(tr)) {
    const ps = t.map(x => x.p), s = ps.indexOf('EY');
    for (let k = s + 1; k < ps.length - 1; k++) {
      if (PH[ps[k]]?.t === 'V' && LIQ.has(ps[k + 1]) && ps[k] !== 'ER' || (ps[k] === 'ER' && ps[k + 1] === 'L')) { pairs[id] = { key: ps[k] + '|' + ps[k + 1], v: k, l: k + 1 }; break; }
    }
  }
  writeFileSync(out(`p2pairs-${tag}.json`), JSON.stringify(pairs));
  execFileSync(PY, ['measure-liquids.py', '--trace', dir, out(`p2pairs-${tag}.json`), out(`p2liq-${tag}.json`)], { cwd: HERE, stdio: 'ignore' });
  return { dir, pairs, syn: JSON.parse(readFileSync(out(`p2liq-${tag}.json`), 'utf8')) };
}
const summarise = (rows) => Object.fromEntries(Object.entries(rows).map(([k, r]) =>
  [k, Object.fromEntries(['f', 'to', 'liq'].map(q => [q, [0, 1].map(i => med(r.map(x => x[q][i])))]))]));

// 1. render as the voice is, align onto the speaker, measure the speaker
const voice0 = { ...file.voice }; delete voice0.liquids;
const a = renderAndMeasure(voice0, 'before');
execFileSync(PY, ['align.py', WAV, out('p2seg.json'), a.dir, out('p2align.json')], { cwd: HERE, stdio: 'ignore' });
execFileSync(PY, ['measure-liquids.py', WAV, out('p2align.json'), out('p2pairs-before.json'), out('p2liq-you.json')], { cwd: HERE, stdio: 'ignore' });
const you = summarise(JSON.parse(readFileSync(out('p2liq-you.json'), 'utf8')));

// 2. the speaker's points as the voice's, F3 from the tables
const f3 = (c) => PH[c]?.f?.[2] ?? 2500;
// A point no vowel could have (the start of "fire" read 3077/4288 Hz: the /f/'s hiss,
// where the alignment ran the vowel early) falls back to the voice's own vowel.
const sane = (p) => p[0] >= 200 && p[0] <= 1000 && p[1] >= 500 && p[1] <= 2800;
const own = (v, end) => { const o = file.voice.vowels?.[v] || PH[v]; return ((end && o.to) || o.f).slice(0, 2); };
const liquids = {};
for (const [k, m] of Object.entries(you)) {
  const [v, l] = k.split('|');
  const f = sane(m.f) ? m.f : own(v), to = sane(m.to) ? m.to : own(v, true);
  liquids[k] = { f: [...f, f3(v)], to: [...to, (PH[v]?.to || PH[v]?.f)[2]], liq: [...m.liq, f3(l)] };
}
const b = renderAndMeasure({ ...voice0, liquids }, 'after');

// 3. how far each is from the speaker, in Hz of F2 (F1 in brackets)
const before = summarise(a.syn), after = summarise(b.syn);
const dist = (p, q) => q ? `${Math.abs(p[1] - q[1])} (${Math.abs(p[0] - q[0])})` : '-';
console.log('pair      point   you (F1 F2)    before: |dF2| (|dF1|)   after');
let tb = 0, ta = 0, n = 0;
for (const [k, m] of Object.entries(you)) for (const q of ['f', 'to', 'liq']) {
  console.log(`${k.padEnd(9)} ${q.padEnd(6)} ${m[q].join(' ').padEnd(14)} ${dist(m[q], before[k]?.[q]).padEnd(22)} ${dist(m[q], after[k]?.[q])}`);
  if (before[k] && after[k]) { tb += Math.abs(m[q][1] - before[k][q][1]); ta += Math.abs(m[q][1] - after[k][q][1]); n++; }
}
console.log(`mean |dF2| ${Math.round(tb / n)} Hz before, ${Math.round(ta / n)} after (${n} points)`);
file.voice.liquids = liquids;
writeFileSync(VOICE, JSON.stringify(file, null, 1));

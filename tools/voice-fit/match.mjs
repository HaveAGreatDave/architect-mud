// match.mjs: match cut clips to the recording script's numbered lines.
//
//   node tools/voice-fit/match.mjs <clips.json> <lines.json>
//
// The clips are in reading order, so this is an alignment, not a search: dynamic
// programming over (clip, line) where a line takes one clip or two merged (a line cut in
// half at a stray hiss or pause), a clip can be skipped (a false start, a cough, a reading
// redone), and a line can be missed. A match costs 1 - similarity, scored on the words
// that tell lines apart: in Parts 1 and 2 the test word alone, since "say" and "aloud"
// are on every line (and Whisper hears "aloud" as "allowed" or "alone" half the time).
// Ties go to the later clip, so a reading done again keeps the second go.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [, , CLIPS, OUT] = process.argv;
const clips = JSON.parse(readFileSync(CLIPS, 'utf8'));
const script = readFileSync(join(ROOT, 'data/voice/oracle-recording-script.txt'), 'utf8')
  .split(/\r?\n/).map(l => /^(\d{3})\t(.*?)(\s*\[.*\])?$/.exec(l)).filter(Boolean)
  .map(m => ({ n: +m[1], text: m[2] }));
const PARTS = { part1: [1, 135], part2: [136, 175], part3: [176, 275], part4: [276, 286], part5: [287, 306] };

const norm = (s) => s.toLowerCase().replace(/[^a-z' ]/g, ' ').split(/\s+/).filter(Boolean);
const FRAME = new Set(['say', 'aloud', 'allowed', 'alone', 'so', 'see', 'a', 'again', 'again.']);
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const strSim = (a, b) => 1 - lev(a, b) / Math.max(1, a.length, b.length);
// Parts 1 and 2: the test word against the best-matching word heard (frame words aside).
function wordSim(line, heard) {
  const want = norm(line).filter(w => !FRAME.has(w)).join('');
  const got = norm(heard).filter(w => !FRAME.has(w));
  if (!got.length) return 0;
  let best = strSim(want, got.join(''));
  for (const g of got) best = Math.max(best, strSim(want, g));
  return best;
}
// Part 3: word overlap.
function sentSim(line, heard) {
  const a = norm(line), b = new Set(norm(heard));
  if (!a.length) return 0;
  return a.filter(w => b.has(w)).length / Math.max(a.length, b.size);
}

const SKIP_CLIP = 0.75, SKIP_LINE = 1.2, MERGE = 0.1;
const out = [];
for (const [part, [lo, hi]] of Object.entries(PARTS)) {
  const P = clips[part]; if (!P) continue;
  const lines = script.filter(l => l.n >= lo && l.n <= hi);
  const C = P.clips;
  if (part === 'part4') {   // one passage, kept whole
    out.push({ part, n: lo, to: hi, text: lines.map(l => l.text).join(' '), t0: C[0].t0, t1: C[0].t1, heard: C[0].text, words: C[0].words, sim: 1 });
    continue;
  }
  const sim = part === 'part3' ? sentSim : wordSim;
  const I = C.length, J = lines.length;
  const cost = Array.from({ length: I + 1 }, () => new Float64Array(J + 1).fill(Infinity));
  const back = Array.from({ length: I + 1 }, () => new Array(J + 1));
  cost[0][0] = 0;
  const join2 = (i) => ({ text: C[i].text + ' ' + C[i + 1].text, t0: C[i].t0, t1: C[i + 1].t1, words: [...C[i].words, ...C[i + 1].words] });
  for (let i = 0; i <= I; i++) for (let j = 0; j <= J; j++) {
    const c = cost[i][j]; if (c === Infinity) continue;
    const go = (ni, nj, add, how) => {
      // `<=`: on a tie the path reached later (the later clip) wins
      if (c + add <= cost[ni][nj]) { cost[ni][nj] = c + add; back[ni][nj] = [i, j, how]; }
    };
    if (i < I) go(i + 1, j, SKIP_CLIP, 'skip');
    if (j < J) go(i, j + 1, SKIP_LINE, 'miss');
    if (i < I && j < J) go(i + 1, j + 1, 1 - sim(lines[j].text, C[i].text), 'one');
    if (i + 1 < I && j < J) go(i + 2, j + 1, 1 - sim(lines[j].text, join2(i).text) + MERGE, 'two');
  }
  const got = [];
  let i = I, j = J, skipped = 0, missed = 0, merged = 0;
  while (i > 0 || j > 0) {
    const [pi, pj, how] = back[i][j];
    if (how === 'one') got.push({ line: lines[pj], clip: C[pi] });
    else if (how === 'two') { got.push({ line: lines[pj], clip: join2(pi) }); merged++; }
    else if (how === 'skip') skipped++;
    else missed++;
    i = pi; j = pj;
  }
  got.reverse();
  for (const { line, clip } of got) out.push({ part, n: line.n, text: line.text, t0: clip.t0, t1: clip.t1, heard: clip.text, words: clip.words, sim: +sim(line.text, clip.text).toFixed(2) });
  console.log(`${part}: ${got.length} of ${J} lines matched, ${merged} from two clips, ${skipped} clips dropped, ${missed} lines missed`);
}
writeFileSync(OUT, JSON.stringify(out, null, 1));

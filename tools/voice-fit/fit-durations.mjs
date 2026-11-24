// fit-durations.mjs: fit a voice's per-phone lengths to the speaker's, from an alignment.
//
//   node tools/voice-fit/fit-durations.mjs <voice.json> <align.json> <trace.json>
//
// Every phone in the aligned lines has two lengths: ORACLE's (the render's trace) and the
// speaker's (align.py). Each phone's factor is the median of speaker over ORACLE, in logs,
// shrunk toward 1 by how few examples it has (n / (n + SHRINK)) and held to 0.5..2. The
// factors are then shifted together so the lines' total length doesn't change: the rate is
// fitted already (fit-prosody.mjs), and these move only how it's shared out.
//
// Scored by halves: fitted on the even-numbered lines and tested on the odd ones, as the
// median error per phone, |log(speaker / predicted)|, before and after. The factors written
// to the voice (`durs`) are then refitted on every line.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , VOICE, ALIGN, TRACE] = process.argv;
const SHRINK = 5;
const file = JSON.parse(readFileSync(VOICE, 'utf8'));
const align = JSON.parse(readFileSync(ALIGN, 'utf8')), trace = JSON.parse(readFileSync(TRACE, 'utf8'));

// Pairs of (phone, ORACLE's length, the speaker's length), pauses and collapsed phones left out.
const pairs = [];
for (const [id, line] of Object.entries(align)) {
  const tr = trace[id]; if (!tr) continue;
  line.phones.forEach((p, k) => {
    const mine = tr[k + 1].at - tr[k].at, theirs = p.end - p.start;
    if (p.p.startsWith('_') || p.p !== tr[k].p || mine < 0.01 || theirs < 0.01) return;
    pairs.push({ id: +id, p: p.p, mine, theirs });
  });
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
function fit(set) {
  const by = new Map();
  for (const r of set) { if (!by.has(r.p)) by.set(r.p, []); by.get(r.p).push(Math.log(r.theirs / r.mine)); }
  const k = {};
  for (const [p, l] of by) k[p] = Math.max(Math.log(0.5), Math.min(Math.log(2), med(l) * l.length / (l.length + SHRINK)));
  // keep the total: the length-weighted mean log factor goes to zero
  const tot = set.reduce((s, r) => s + r.mine, 0), mean = set.reduce((s, r) => s + r.mine * k[r.p], 0) / tot;
  for (const p of Object.keys(k)) k[p] -= mean;
  return k;
}
const err = (set, k) => med(set.map(r => Math.abs(Math.log(r.theirs / (r.mine * Math.exp(k[r.p] || 0))))));
const train = pairs.filter(r => r.id % 2 === 0), test = pairs.filter(r => r.id % 2 === 1);
const kHalf = fit(train);
const before = err(test, {}), after = err(test, kHalf);
console.log(`${pairs.length} phones; held out ${test.length}: median error ${(100 * (Math.exp(before) - 1)).toFixed(0)}% before, ${(100 * (Math.exp(after) - 1)).toFixed(0)}% after`);
const k = fit(pairs);
const durs = Object.fromEntries(Object.entries(k).map(([p, v]) => [p, +Math.exp(v).toFixed(3)]).sort());
const counts = {}; for (const r of pairs) counts[r.p] = (counts[r.p] || 0) + 1;
console.log('longest against ORACLE:', Object.entries(durs).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([p, v]) => `${p} ${v} (${counts[p]})`).join(', '));
console.log('shortest:', Object.entries(durs).sort((a, b) => a[1] - b[1]).slice(0, 6).map(([p, v]) => `${p} ${v} (${counts[p]})`).join(', '));
file.voice.durs = durs;
file.durations = { phones: pairs.length, heldOutErrorBefore: +before.toFixed(3), heldOutErrorAfter: +after.toFixed(3) };
writeFileSync(VOICE, JSON.stringify(file, null, 1));

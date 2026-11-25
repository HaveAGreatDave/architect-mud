#!/usr/bin/env node
// Builds the controller's gate set: 200 lines no candidate is ever trained on, and the VCTK
// speakers held out whole (docs/proposals/oracle-teacher.md, "Held out").
//
//   node tools/voice-fit/ddsp/gate-set.mjs <harvard.html> <vctk dir>
//
// Writes tools/voice-fit/ddsp/gate-set.json:
//   { lines: [{ id, src, text }], heldOutSpeakers: [...] }
//
// The lines: 100 Harvard sentences, 60 lines from NPC banter (content/npc_banter_threads) and
// 40 spoken lines from the broadcast scripts (data/scripts/*.bsm). Picked by a fixed hash, so
// the set is the same every run. A line VCTK also reads is skipped. The held-out speakers are
// one man and one woman from each of the five biggest accent groups, the lowest id in each.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [HARVARD, VCTK] = process.argv.slice(2);
if (!HARVARD || !VCTK) { console.error('usage: gate-set.mjs <harvard.html> <vctk dir>'); process.exit(2); }
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

// FNV-1a with murmur3's finaliser, so neighbouring strings don't cluster.
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
const pick = (arr, n, salt) => [...new Set(arr)].sort((a, b) => hash(salt + a) - hash(salt + b)).slice(0, n);

const words = (s) => s.trim().split(/\s+/).length;
// Speakable by ORACLE without special handling: plain letters and ordinary punctuation, 3 to 20 words.
const plain = (s) => /^[A-Za-z][A-Za-z ,.'?!;:-]*$/.test(s) && words(s) >= 3 && words(s) <= 20;
// Straight quotes and apostrophes, and no quote marks round the whole line.
const norm = (s) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/^"|"$/g, '').trim();
const key = (s) => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

const vctkText = new Set();
const txt = join(VCTK, 'txt');
for (const spk of readdirSync(txt))
  for (const f of readdirSync(join(txt, spk))) vctkText.add(key(readFileSync(join(txt, spk, f), 'utf8')));
const fresh = (s) => !vctkText.has(key(s));

const harvard = [...readFileSync(HARVARD, 'utf8').matchAll(/<li>([^<\n]+)/g)].map(m => m[1].trim()).filter(plain).filter(fresh);

const banter = [];
for (const f of readdirSync(join(ROOT, 'content', 'npc_banter_threads'))) {
  const t = JSON.parse(readFileSync(join(ROOT, 'content', 'npc_banter_threads', f), 'utf8'));
  for (const l of t.lines || []) {
    const s = norm(String(typeof l === 'string' ? l : l.text || ''));
    if (!s.includes('"') && plain(s) && fresh(s)) banter.push(s);
  }
}

const booth = [];
const scripts = join(ROOT, 'data', 'scripts');
for (const f of readdirSync(scripts).filter(f => f.endsWith('.bsm'))) {
  // A speaker's label is a line of its own ("TUG:", "Captain Nguyen:"); what they say follows
  // until a blank line, a directive (a first word in capitals: SHOT, ACTION, MUSIC) or markup.
  let speaking = false;
  for (const raw of readFileSync(join(scripts, f), 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (/^(?:[A-Z][A-Z_ .']*|[A-Z][a-z]+(?: [A-Z][a-z]+)+):$/.test(line)) { speaking = true; continue; }
    if (!line || /^[A-Z_]{2,}\b/.test(line) || /^[<@:#{]/.test(line)) { speaking = false; continue; }
    if (!speaking) continue;
    const s = norm(line);
    if (plain(s) && fresh(s)) booth.push(s);
  }
}

const lines = [
  ...pick(harvard, 100, 'h').map(text => ({ src: 'harvard', text })),
  ...pick(banter, 60, 'b').map(text => ({ src: 'banter', text })),
  ...pick(booth, 40, 's').map(text => ({ src: 'booth', text })),
].map((l, i) => ({ id: i + 1, ...l }));

// Held-out speakers: the five biggest accent groups, a man and a woman from each.
const info = readFileSync(join(VCTK, 'speaker-info.txt'), 'utf8').split(/\r?\n/).slice(1)
  .map(l => l.trim().split(/\s+/)).filter(r => r.length >= 4).map(([id, age, sex, accent]) => ({ id, sex, accent }));
const SKIP = new Set(['p280', 'p315']);
const counts = {};
for (const s of info) counts[s.accent] = (counts[s.accent] || 0) + 1;
const groups = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 5);
const heldOutSpeakers = [];
for (const g of groups) for (const sex of ['F', 'M']) {
  const s = info.filter(r => r.accent === g && r.sex === sex && !SKIP.has(r.id)).sort((a, b) => a.id.localeCompare(b.id))[0];
  if (s) heldOutSpeakers.push(s.id);
}

const out = join(HERE, 'gate-set.json');
writeFileSync(out, JSON.stringify({ lines, heldOutSpeakers }, null, 1) + '\n');
const n = lines.reduce((a, l) => a + words(l.text), 0);
console.log(`${lines.length} lines, ${n} words (harvard ${harvard.length}, banter ${banter.length}, booth ${booth.length} to pick from); held out: ${heldOutSpeakers.join(' ')} from ${groups.join(', ')}`);

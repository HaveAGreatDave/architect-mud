/**
 * dialogue-audit.mjs — reports NPC dialogue against the Dialogue section of
 * docs/reference/plain-writing.md. A REPORTER, not a gate: every pattern here
 * has legitimate uses, and the point is to rank who needs reading, not to fail
 * a build.
 *
 *   node scripts/docs/dialogue-audit.mjs            top offenders
 *   node scripts/docs/dialogue-audit.mjs --all      every NPC with a score
 *   node scripts/docs/dialogue-audit.mjs <npc_id>   one NPC, with the lines
 *
 * The score is deliberately crude. It is a reading order, not a verdict.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NPCS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content', 'npcs');
const args = process.argv.slice(2);
const ALL = args.includes('--all');
const ONE = args.find(a => !a.startsWith('--'));

// Quoted speech inside a dialogue tree, unescaped back to plain text.
const speechOf = tree => (JSON.stringify(tree || {}).match(/\\"[^\\]{2,600}?\\"/g) || [])
  .map(s => s.replace(/\\"/g, '').trim());

const CHECKS = [
  { key: 'coda', weight: 2,
    why: 'generalisation with nothing to answer',
    re: /\b(people do|everybody does|everyone does|nobody does)\b\s*[.!]/i },
  { key: 'antithesis', weight: 1,
    why: 'that is not X, it is Y',
    re: /\bthat is not\b[^.!?]{2,60}[.!]|\bis not the same as\b/i },
  { key: 'closer', weight: 2,
    why: 'aphoristic summary closing the turn',
    re: /\bthat is the (whole|point|cost|entire)\b|\bwhich is (the|how you|what makes)\b/i },
  { key: 'simile', weight: 1,
    why: 'explanatory "the way a ..." simile',
    re: /\bthe way (a|an|you|somebody) [a-z]{2,14} [a-z]{2,14}/i },
  { key: 'unnamed', weight: 3,
    why: 'definite article on a thing never named',
    re: /\bthe (unit|arrangement|piece|business|situation|matter)\b/i },
  { key: 'hedge', weight: 2,
    why: 'hedging with no motive to conceal',
    re: /\b(perhaps|somewhat|in a sense|more or less|as it were|of a kind|one might)\b/i },
];

function audit(file) {
  const d = JSON.parse(fs.readFileSync(path.join(NPCS, file), 'utf8'));
  const speech = speechOf(d.dialogue_tree);
  const chars = speech.join(' ').length;
  if (chars < 400) return null;

  const found = {}; const lines = [];
  for (const line of speech) {
    for (const c of CHECKS) {
      if (!c.re.test(line)) continue;
      found[c.key] = (found[c.key] || 0) + 1;
      lines.push({ key: c.key, why: c.why, line });
    }
  }
  const words = speech.join(' ').split(/\s+/).length;
  const turns = speech.length;
  const shortTurns = speech.filter(s => s.split(/\s+/).length <= 6).length;
  const asks = speech.filter(s => s.includes('?')).length;

  // Weighted tic density per 1k words, plus a flat penalty for never asking.
  let score = 0;
  for (const c of CHECKS) score += (found[c.key] || 0) * c.weight;
  score = score / (words / 1000);
  if (!asks) score += 6;

  return {
    id: d.id || file.replace('.json', ''), name: d.name, file,
    words, turns, asks, found, lines,
    shortPct: Math.round((shortTurns / turns) * 100),
    score: Math.round(score * 10) / 10,
  };
}

const rows = fs.readdirSync(NPCS).filter(f => f.endsWith('.json'))
  .map(audit).filter(Boolean).sort((a, b) => b.score - a.score);

if (ONE) {
  const r = rows.find(x => x.id === ONE || x.file.includes(ONE));
  if (!r) { console.log('no NPC matching ' + ONE); process.exit(1); }
  console.log(r.name + '  [' + r.file + ']');
  console.log('  ' + r.words + ' words · ' + r.turns + ' turns · ' + r.shortPct
    + '% short · ' + r.asks + ' question(s) · score ' + r.score + '\n');
  for (const l of r.lines) console.log('  [' + l.key + '] ' + l.why + '\n      ' + l.line + '\n');
  process.exit(0);
}

console.log('DIALOGUE AUDIT — ' + rows.length + ' NPCs with a real speaking part\n');
console.log('  score  asks  short  words  who');
for (const r of (ALL ? rows : rows.slice(0, 25))) {
  console.log('  ' + String(r.score).padStart(5)
    + '  ' + String(r.asks).padStart(4)
    + '  ' + String(r.shortPct + '%').padStart(5)
    + '  ' + String(r.words).padStart(5)
    + '  ' + r.name + '  (' + Object.keys(r.found).join(',') + ')');
}
const mute = rows.filter(r => !r.asks).length;
const clean = rows.filter(r => !Object.keys(r.found).length && r.asks).length;
console.log('\n  never ask a question: ' + mute + '/' + rows.length);
console.log('  no flagged tics and they ask: ' + clean + '/' + rows.length);
console.log('\n  one NPC in detail:  node scripts/docs/dialogue-audit.mjs <npc_id>');

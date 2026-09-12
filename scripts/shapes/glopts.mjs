// THE GL OPTION ALLOWLIST, CHECKED — the gate for the failure mode install.js already documents.
//
// `installGL()` hands `glWorldPass` an object literal that is an ALLOWLIST, not a spread. An
// option added at the windshield end and not added there is silently dropped one hop before the
// shader that reads it, and the result is indistinguishable from a feature that does nothing: the
// tune key exists, the slider moves, the uniform is declared, the bench reports 0.0% at every
// strength. Contact occlusion shipped that way for an afternoon. The baked per-vertex AO term
// shipped that way immediately afterwards, having been wired at both ends, gated, measured and
// swept first. The puddle field would have been the third, on this same commit — the window
// centre was threaded from windshield.js to world.js to the ground shader and dropped in the
// middle, which would have left the puddles crawling along the road as the window recentred.
//
// Three occurrences is where a comment stops being enough. So: every `opts.X` world.js reads must
// be a key install.js actually passes.
//
// ⚠ AN EXCEPTION IS A REASON, NEVER A NAME. A bare list of tolerated keys passes the next real
// drop the moment somebody adds to it; a key here has to say why nothing sends it.
//
// ⚠ AND IT BLANKS COMMENTS FIRST, with scripts/lib/blank-scanner.mjs rather than a second scanner.
// This file is mostly prose and the prose is full of `word:` — a plain regex over raw source
// collected 'afternoon', 'ONE', 'produces' and 'other' as option names, which is harmless in this
// direction and would not stay harmless.
import { readFileSync } from 'node:fs';
import { blank } from '../lib/blank-scanner.mjs';

const INSTALL = 'client/game/js/panels/gl/install.js';
const WORLD = 'client/game/js/panels/gl/world.js';

// key → why world.js may read it while install.js never sends it.
const NOT_SENT = {
  eyeH: 'world.js falls back to `cam.eh`, the camera\'s own eye height, and nothing at the '
      + 'windshield end has a better answer to give it.',
};

// The second object literal argument to glWorldPass(...): the first is the deps bundle.
function allowlistKeys(src) {
  const at = src.indexOf('glWorldPass(');
  if (at < 0) throw new Error('glopts: no glWorldPass( call in ' + INSTALL);
  let depth = 0, objs = 0, start = -1, end = -1;
  for (let i = at; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') { if (depth === 0) { objs++; if (objs === 2) start = i; } depth++; }
    else if (ch === '}') { depth--; if (depth === 0 && objs === 2 && start >= 0) { end = i; break; } }
    else if (ch === ')' && depth === 0) break;
  }
  if (start < 0 || end < 0) throw new Error('glopts: could not brace-match the allowlist literal');
  const lit = src.slice(start, end + 1);
  const keys = new Set();
  let d = 0, m;
  const re = /([A-Za-z_$][\w$]*)\s*:|[{}[\]]/g;
  while ((m = re.exec(lit))) {
    if (m[0] === '{' || m[0] === '[') { d++; continue; }
    if (m[0] === '}' || m[0] === ']') { d--; continue; }
    if (d === 1) keys.add(m[1]);   // depth 1 is the literal's own top level
  }
  return keys;
}

const install = blank(readFileSync(INSTALL, 'utf8'));
const world = blank(readFileSync(WORLD, 'utf8'));

const given = allowlistKeys(install);
const read = new Map();
for (const m of world.matchAll(/\bopts\.([A-Za-z_$][\w$]*)/g)) {
  if (!read.has(m[1])) read.set(m[1], world.slice(0, m.index).split('\n').length);
}

const fails = [];
for (const [key, line] of read) {
  if (given.has(key)) continue;
  if (NOT_SENT[key]) continue;
  fails.push(`  world.js:${line} reads opts.${key}, which install.js's allowlist never passes — `
           + 'add it there, or give it a reason in NOT_SENT.');
}
// The other direction is dead plumbing rather than a silent feature, so it is a warning.
const unread = [...given].filter(k => !read.has(k) && k !== 'draw');

if (fails.length) {
  console.error(`✗ glopts — ${fails.length} option(s) dropped between windshield.js and the shader:`);
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log(`✓ glopts: ${given.size} allowlist keys, ${read.size} read by world.js, `
  + `${Object.keys(NOT_SENT).length} with a reason not to be sent`
  + (unread.length ? ` — ${unread.length} passed but unread (${unread.join(', ')})` : ''));

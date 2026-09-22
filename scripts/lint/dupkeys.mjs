// A KEY WRITTEN TWICE IN ONE TABLE IS A ROW NOBODY WILL EVER SEE.
//
// JavaScript does not complain about a duplicate key in an object literal. The later one wins and
// the earlier one is gone — no error, no warning, and the file still reads as if both are there.
//
// WHY THIS EXISTS. `CRIME_DEFAULTS` in server/engine/crimes.js carried `public_intoxication` twice:
// a placeholder from 2026-07-02 and the real row from 2026-07-21, nineteen lines apart, the second
// written as part of "drugs you can see" by somebody who had no reason to scroll down and check.
// Because the placeholder sits LOWER in the literal it won, so the deliberate row — the one whose
// description explains the five-minute cooldown that `PUBLIC_INTOX_COOLDOWN` really implements —
// was dead from the day it landed, and the dev panel and the crime list showed the placeholder for
// two months. Nothing caught it because nothing was looking. The stars and the witness rule
// happened to match, so this one cost only prose; the next one changes what a crime is worth.
//
// ⚠ SCOPED TO TOP-LEVEL TABLES, DELIBERATELY. It reads `const NAME = { … }` / `export const NAME =
// { … }` declared at column 0, and only the keys at the literal's own top level. That is the shape
// every registry in this repo is written in — CRIME_DEFAULTS, CLOTHING, WEATHER_TYPES, the palette
// sets, the tag catalog — and it is where a duplicate is both most likely and most expensive.
// A broader sweep over every brace in the tree was tried first and is not worth having: object
// literals, destructuring, blocks, labels, ternaries and `case` clauses are not distinguishable by
// brace-matching alone, and the first cut reported 81 findings of which 3 were real. A lint nobody
// trusts gets switched off, which is how the bug above survived in the first place.
//
// ESCAPE HATCH: `// dupkeys-ok: <reason>` on the offending line or the line above it. The reason is
// required — a bare disable is how a lint dies.
//
//   npm run lint:dupkeys      # also runs inside pretest:regress
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { blank } from '../lib/blank-scanner.mjs';

const ROOTS = ['server', 'plugins', 'client', 'scripts', 'tools'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'worktrees', 'temp']);

const files = [];
(function walk(d) {
  let e; try { e = readdirSync(d); } catch { return; }
  for (const name of e) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(d, name);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p);
    else if (/\.(js|mjs)$/.test(name)) files.push(p);
  }
})('.');
for (const r of ROOTS) { /* roots walked above from '.' */ void r; }

// ⚠ ORDINARY STRINGS COME OUT TOO. `blank()` deliberately keeps them, because the one scanner in
// this repo exists to find module specifiers and those live in a string. Here a kept string is
// nothing but noise: this codebase's prose is full of `word:` and of braces inside quotes, and
// both desynchronise a brace count. Same reasoning, opposite need.
const BS = String.fromCharCode(92);
function stripStrings(s) {
  const a = [...s];
  let i = 0, q = null;
  while (i < a.length) {
    const c = a[i];
    if (q) {
      if (c === BS) { a[i] = ' '; if (a[i + 1] !== '\n') a[i + 1] = ' '; i += 2; continue; }
      if (c === q) { q = null; a[i] = ' '; i++; continue; }
      if (c !== '\n') a[i] = ' ';
      i++; continue;
    }
    if (c === '"' || c === "'") { q = c; a[i] = ' '; i++; continue; }
    i++;
  }
  return a.join('');
}

const DECL = /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*\{/;
const KEY = /^\s*(?:([A-Za-z_$][\w$]*)|'([^']*)'|"([^"]*)")\s*:/;

const findings = [];
for (const file of files) {
  let raw; try { raw = readFileSync(file, 'utf8'); } catch { continue; }
  if (!/\bconst\s+[A-Za-z_$][\w$]*\s*=\s*\{/.test(raw)) continue;
  const rawLines = raw.split(/\r?\n/);
  const lines = stripStrings(blank(raw)).split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const m = DECL.exec(lines[i]);
    if (!m) continue;
    const table = m[1];
    // walk to the matching close, tracking depth; collect keys seen at depth 1
    let depth = 0, started = false;
    const seen = new Map();
    let j = i;
    for (; j < lines.length; j++) {
      const before = depth;
      for (const c of lines[j]) { if (c === '{' || c === '[' || c === '(') depth++; else if (c === '}' || c === ']' || c === ')') depth--; }
      if (!started && depth > 0) started = true;
      // a key belongs to THIS literal only when the line opened at depth 1
      if (started && before === 1) {
        const k = KEY.exec(lines[j]);
        if (k) {
          const name = k[1] ?? k[2] ?? k[3];
          if (!seen.has(name)) seen.set(name, []);
          seen.get(name).push(j);
        }
      }
      if (started && depth <= 0) break;
    }
    for (const [name, at] of seen) {
      if (at.length < 2) continue;
      const excused = at.some((ln) =>
        /\/\/\s*dupkeys-ok:\s*\S/.test(rawLines[ln] || '') || /\/\/\s*dupkeys-ok:\s*\S/.test(rawLines[ln - 1] || ''));
      if (excused) continue;
      findings.push({
        file, table, name,
        lines: at.map((n) => n + 1),
        wins: at[at.length - 1] + 1,
        text: (rawLines[at[at.length - 1]] || '').trim().slice(0, 90),
      });
    }
    i = j;
  }
}

if (!findings.length) {
  console.log(`✓ dupkeys: no duplicate key in any top-level table across ${files.length} files`);
  process.exit(0);
}
console.log(`\n✗ dupkeys — ${findings.length} duplicate key(s):`);
for (const f of findings) {
  console.log(`  ${f.file.replace(/\\/g, '/')}  ${f.table}.${f.name} declared on line(s) ${f.lines.join(', ')}`);
  console.log(`      line ${f.wins} wins; every earlier one is unreachable — ${f.text}`);
}
console.log(`
  Keep one row. If two really are wanted, they are two keys with two names.
  If this is a false positive, put \`// dupkeys-ok: <reason>\` on the line.
`);
process.exit(1);

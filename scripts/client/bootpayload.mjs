// WHAT A COLD BROWSER ACTUALLY PULLS BEFORE THE GAME IS PLAYABLE.
//
// docs/ops-usage-watch.md states the rule the whole budget rests on: egress is
// `boot payload × world loads per day`, and its own headline finding is that nothing was
// watching the FIRST factor while a doc header said "~4.7MB" months after it was ~30MB. The
// usage report measures the product from prod once a day. This measures the payload itself,
// from source, on every push — because a payload regression is committed weeks before it shows
// up in a bandwidth number, and by then nobody can say which commit did it.
//
// It walks the ESM graph from `client/game/js/main.js` exactly as the browser does, follows the
// shell's own <script>/<link> tags, and brotlis every file at the quality `server/index.js`
// actually serves (5, not the default 11). The number it prints is bytes on the wire for one
// cold load with an empty cache.
//
// ⚠ IT IS A BUDGET, NOT A TARGET. A gate that fails the moment somebody adds a panel is a gate
// that gets raised without being read, so the ceiling is set a little above where the tree sits
// and moving it is a deliberate edit with a reason beside it. What it catches is the class that
// actually happens here: one import line, added for one predicate, that drags a megabyte behind
// it. `client/game/js/input.js` needs a boolean from `cockpit.js`, `cab-view.js` and
// `freelook-view.js`, and all three statically import the 3.8 MB renderer — so every player who
// has never flown downloads and parses the whole flight sim before they can type `look`.
//
// ⚠ AND THE PER-FILE TABLE IS THE POINT, not the total. A total that moved tells you something
// got bigger; the table tells you what, which is the only version of this anybody can act on.
//
//   npm run client:bootpayload            # the table
//   npm run client:bootpayload -- --json  # machine-readable
import fs from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { blank } from '../lib/blank-scanner.mjs';

const ROOT = process.cwd();
const GAME = path.join(ROOT, 'client/game');
const CLIENT = path.join(ROOT, 'client');
const REPORT = !process.argv.includes('--quiet');
const JSON_OUT = process.argv.includes('--json');

// ── the budget ───────────────────────────────────────────────────────────────
// Measured 2026-09-20 at 3.68 MB over 199 files. The ceiling is ~5% above that: enough that an
// ordinary feature lands without an argument, tight enough that a megabyte cannot.
//
// ⚠ DYNAMIC IMPORTS COUNT, which is why this reads higher than a hand count of the static graph
// (3.39 MB over 190 files the first time it was measured by eye). See the note on SPEC below.
const CEILING_MB = 3.85;
const CEILING_FILES = 215;

// ⚠ `[^;'"]*?` RATHER THAN `[\s\S]*?`, AND A SIDE-EFFECT IMPORT IS WHY. The obvious spelling of
// the optional `… from` clause is a lazy any-character run, and `(?:X)?` PREFERS to match X — so
// on `import './a.js';` followed anywhere below by `import { b } from './b.js';` the run happily
// crosses the semicolon and the newline to reach that later `from`, matches once, and reports
// only `./b.js`. The side-effect import is swallowed whole, silently. That is not an edge case
// here: `plugins/tablet/index.js` registers fourteen apps that way and so does `tools/modelshop`,
// and a payload gate that cannot see them is a payload gate that under-reports exactly the files
// somebody added without thinking about weight. Excluding `;` and the quote characters keeps the
// clause inside one statement, which still allows a multi-line `import {\n a,\n b\n} from …`.
const SPEC = /(?:^|[^\w$.])(?:import|export)\s*(?:[^;'"]*?\sfrom\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveSpec(fromFile, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null;
  // The client serves `client/` as the web root, so a leading slash is client-relative.
  let p = spec.startsWith('/') ? path.join(CLIENT, spec) : path.resolve(path.dirname(fromFile), spec);
  p = p.split('?')[0];
  if (!/\.(js|mjs|json)$/.test(p)) p += '.js';
  return fs.existsSync(p) ? p : null;
}

// ⚠ STATIC AND DYNAMIC BOTH COUNT, and that is not a rounding decision. A dynamic import is not
// on the critical path, but it is still a file this client will fetch to be playable, and the
// whole reason to move something behind one is to take it OUT of this number. Counting only
// static imports would score a lazy-loaded megabyte as a saving on the day it is still shipped.
const files = new Set();
const stack = [path.join(GAME, 'js/main.js')];
while (stack.length) {
  const f = stack.pop();
  if (files.has(f)) continue;
  files.add(f);
  let s; try { s = blank(fs.readFileSync(f, 'utf8')); } catch { continue; }
  SPEC.lastIndex = 0;
  let m;
  while ((m = SPEC.exec(s))) {
    const p = resolveSpec(f, m[1] || m[2]);
    if (p) stack.push(p);
  }
}

// the shell and anything it names directly
const shellPath = path.join(GAME, 'index.html');
files.add(shellPath);
const shell = fs.readFileSync(shellPath, 'utf8');
for (const m of shell.matchAll(/(?:href|src)="([^"]+\.(?:css|js|json))"/g)) {
  const p = m[1].startsWith('/') ? path.join(CLIENT, m[1]) : path.resolve(GAME, m[1]);
  if (fs.existsSync(p)) files.add(p);
}

// ── weigh it the way the server sends it ────────────────────────────────────
// server/index.js: brotli quality 5, and nothing under 1 KB is compressed at all.
const MIN = 1024;
const br = (b) => brotliCompressSync(b, {
  params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_SIZE_HINT]: b.length },
}).length;

const rows = [];
let raw = 0, wire = 0;
for (const f of files) {
  let b; try { b = fs.readFileSync(f); } catch { continue; }
  const c = b.length >= MIN ? br(b) : b.length;
  raw += b.length; wire += c;
  rows.push({ file: path.relative(ROOT, f).split(path.sep).join('/'), raw: b.length, wire: c });
}
rows.sort((a, b) => b.wire - a.wire);
const mb = wire / 1048576;

if (JSON_OUT) {
  console.log(JSON.stringify({ files: rows.length, rawBytes: raw, wireBytes: wire, ceilingMB: CEILING_MB, rows: rows.slice(0, 30) }, null, 2));
} else if (REPORT) {
  console.log(`\n  cold boot payload — ${rows.length} files, ${(raw / 1048576).toFixed(2)} MB raw, ${mb.toFixed(2)} MB brotli on the wire\n`);
  for (const r of rows.slice(0, 12)) {
    const share = (r.wire / wire * 100).toFixed(1).padStart(4);
    console.log(`  ${(r.wire / 1024).toFixed(0).padStart(6)} KB  ${share}%   ${r.file}`);
  }
  console.log(`\n  at ${mb.toFixed(2)} MB per cold load:`);
  for (const n of [50, 200, 1000]) {
    console.log(`     ${String(n).padStart(4)} loads/day  ->  ${(wire * n * 30 / 1073741824).toFixed(1)} GB / 30 days`);
  }
}

const problems = [];
if (mb > CEILING_MB) problems.push(`payload is ${mb.toFixed(2)} MB against a ceiling of ${CEILING_MB} MB`);
if (rows.length > CEILING_FILES) problems.push(`${rows.length} files against a ceiling of ${CEILING_FILES}`);

if (problems.length) {
  console.log('\n✗ bootpayload:');
  for (const p of problems) console.log('  ' + p);
  console.log(`
  Every byte here is fetched before a player can type \`look\`. The usual cause is one
  import added for one symbol: check the table above against what actually changed, and
  move the big one behind a dynamic import rather than raising the ceiling. If the growth
  is genuinely wanted, raise CEILING_MB in this file and say why on the line above it.
`);
  process.exit(1);
}
if (!JSON_OUT) console.log(`\n✓ bootpayload: ${mb.toFixed(2)} MB of a ${CEILING_MB} MB ceiling, ${rows.length} of ${CEILING_FILES} files\n`);

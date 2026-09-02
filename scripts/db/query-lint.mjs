// The round-trip rules from docs/architecture.md → Read Tiers, as a gate.
//
// WHY THIS EXISTS. The rules below have been written down for months, in a doc
// everyone reads. On 2026-08-15 an efficiency review found EIGHT live instances
// of one of them (`flags::text LIKE` against `furniture`, which is a boot-loaded
// Map) sitting in plugin code. Prose does not stay fixed; the project already
// turns its rules into gates (docs:lint, content:lint, shapes:smoke,
// client:smoke) and this is that treatment for the DB rules.
//
// It is deliberately GREP-LEVEL, not an AST pass. Every rule here is a textual
// pattern with a specific fix, and a false positive is cheap to silence with the
// escape hatch below. A cleverer checker that nobody trusts would be worse.
//
// ESCAPE HATCH: put `// query-lint-ok: <reason>` on the offending line or the
// line above it. The reason is required — a bare disable is how a lint dies.
//
// Run: node scripts/db/query-lint.mjs   (wired into pretest:regress)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['server', 'plugins'];

// Directories whose contents are not runtime game code: one-shots and test
// harnesses may do whatever they like — they run once, by hand, off the hot path.
const SKIP_DIRS = new Set(['node_modules', 'temp', '.git']);
const SKIP_FILE = /(regress|smoke|\.test)\.js$/;

// Tables that are boot-loaded into a world Map with a hard write funnel. A query
// against these in runtime code is usually a read that RAM could have answered.
const CACHED_TABLES = 'furniture|npcs|zones|doors|orgs';

// Tables carrying fat JSONB / blob columns where SELECT * is real egress.
// audio_songs is here for its per-row weight, not its row count: 17 rows of
// tracker pattern JSON are 2.7MB, heavier than all 717 items put together.
const WIDE_TABLES = 'items|npcs|zones|audio_samples|audio_songs';

// TWO SEVERITIES, and the split is the whole reason this lint survives.
//
// `gate: true` rules FAIL the build. They are the ones where every current hit
// is a bug and the fix is mechanical — so the tree can be clean today, and
// clean is the only state a gate can hold.
//
// `gate: false` rules are ADVISORY: printed as a count, never fatal. The first
// run of this script found 109 hits, ~95 of them "a plugin reads a boot-loaded
// table" — a real backlog (a `use` verb should not query `furniture`), but one
// mixed with legitimate aggregates, map-derivation sweeps and dev-panel routes.
// A gate that fails with 109 items on the day it lands is a gate somebody
// deletes. Work the advisory list down with `--all`; promote the rule to
// `gate: true` when it reaches zero.
const RULES = [
  {
    id: 'flags-text-like',
    gate: true,
    // `flags::text LIKE '%…%'` casts every row's JSONB to text: unindexable, a
    // guaranteed full scan, and it matches KEYS and VALUES alike.
    re: /flags::text\s+LIKE/i,
    msg: 'flags::text LIKE — unindexable full scan, and it matches keys and values alike.',
    fix: `For a boot-loaded table filter the world Map by key presence ('media_deck' in f.flags) — getZoneFurniture(zoneId) for furniture. For a query-fresh table use the JSONB operator: flags ? 'key'.`,
  },
  {
    // Gated on the FULL-TABLE form only (`SELECT * FROM npcs` with no WHERE):
    // that is the one that pulls every dialogue_tree and behaviour_graph across
    // the wire, and it is the shape that killed the egress budget. A single-row
    // `SELECT * FROM zones WHERE id=$1` is one row and lands in the advisory
    // rule below instead.
    id: 'select-star-wide-fulltable',
    gate: true,
    re: new RegExp(`SELECT\\s+\\*\\s+FROM\\s+(${WIDE_TABLES})\\s*(?:\\)|'|\`|;|$)`, 'i'),
    msg: 'SELECT * over a WHOLE wide table — every row\'s fat JSONB (dialogue_tree, behaviour_graph, tag bags) or base64 audio, across the wire.',
    fix: 'Read the boot-loaded Map (world.npcs / world.zones / getItemCache()). If this IS the loader that fills that Map, say so with `// query-lint-ok: <reason>`.',
  },
  {
    id: 'select-star-wide-row',
    gate: false,
    re: new RegExp(`SELECT\\s+\\*\\s+FROM\\s+(${WIDE_TABLES})\\b`, 'i'),
    msg: 'SELECT * on a wide table — carries fat JSONB even for one row.',
    fix: 'Name the columns you need, or read the boot-loaded Map.',
    // NOT server/api/. The dev panel is cold-path admin traffic from one or two
    // humans, and — the load-bearing half — a `world.zones` entry is a DECORATED
    // copy of the row: the Map hangs live players/enemies/npcs Sets off it. An
    // endpoint that returned the Map entry would serialise those Sets into its
    // JSON as `{}`, changing the API's contract to save one round trip per
    // button press. Flagging routes here would train everyone to ignore the
    // rule, which is the failure mode this whole lint is built to avoid.
    skip: /^server[\\/]api[\\/]/,
  },
  {
    id: 'cached-table-read',
    gate: false,
    // A plain SELECT against a table the process already holds in RAM.
    re: new RegExp(`SELECT\\s+(?!\\*\\s+FROM\\s+(?:${WIDE_TABLES})\\b)[\\w\\s,*.()]+\\s+FROM\\s+(${CACHED_TABLES})\\b`, 'i'),
    msg: 'read from a boot-loaded table — world.{furniture,npcs,zones,doors,orgs} already hold these rows in memory.',
    fix: 'Use the Map (getZoneFurniture / world.npcs.get / getZone). If this genuinely needs the DB — an aggregate, a full scan at boot, a dev-panel report — say so with `// query-lint-ok: <reason>`.',
    // Loud but low-stakes: the world loader itself and the API layer legitimately
    // read these. Scoped to plugins, where the pattern is nearly always a mistake.
    only: /^plugins[\\/]/,
  },
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js') || p.endsWith('.mjs')) { if (!SKIP_FILE.test(p)) out.push(p); }
  }
  return out;
}

// A line is exempt if it (or the line above it) carries a reasoned opt-out. The
// line above matters because the house style puts the explanation in a comment
// over the statement, which is where somebody will naturally write the reason.
function exempt(lines, i) {
  const re = /query-lint-ok:\s*\S/;
  if (re.test(lines[i] || '')) return true;
  // Walk up through the contiguous comment block above the statement. The
  // reason usually needs two or three lines to be worth reading, and requiring
  // it on exactly the line above would push authors to write a worse one.
  for (let j = i - 1; j >= 0; j--) {
    const l = (lines[j] || '').trim();
    if (!/^(\/\/|\*|\/\*)/.test(l)) break;
    if (re.test(l)) return true;
  }
  return false;
}

// Strip line comments before matching, so the many places that DESCRIBE these
// patterns in prose ("this was a flags::text LIKE scan") aren't flagged for
// documenting the fix.
function code(line) {
  return line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
}

export function lintQueries() {
  const problems = [];
  const files = ROOTS.flatMap(r => walk(r));
  for (const f of files) {
    const rel = f.replace(/\\/g, '/');
    // Split on CRLF-or-LF, never bare '\n'. A trailing '\r' survives that split
    // and `.` in code()'s `//.*$` does NOT match a carriage return — so on this
    // repo's CRLF files every comment line reached the rules unstripped, and a
    // comment EXPLAINING a removed query ("this was a `SELECT * FROM npcs`")
    // failed the gate. That took the whole pretest:regress chain down with it.
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const src = code(lines[i]);
      if (!src.trim()) continue;
      for (const rule of RULES) {
        if (rule.only && !rule.only.test(f)) continue;
        if (rule.skip && rule.skip.test(f)) continue;
        if (!rule.re.test(src)) continue;
        if (exempt(lines, i)) continue;
        problems.push({ file: rel, line: i + 1, rule, snippet: src.trim().slice(0, 100) });
      }
    }
  }
  return problems;
}

function group(problems) {
  const byRule = new Map();
  for (const p of problems) {
    if (!byRule.has(p.rule.id)) byRule.set(p.rule.id, []);
    byRule.get(p.rule.id).push(p);
  }
  return byRule;
}

function report(list, out) {
  out(`  [${list[0].rule.id}] ${list[0].rule.msg}`);
  for (const p of list) out(`    ${p.file}:${p.line}  ${p.snippet}`);
  out(`    → ${list[0].rule.fix}\n`);
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const showAll = process.argv.includes('--all');
  const problems = lintQueries();
  const failing = problems.filter(p => p.rule.gate);
  const advisory = problems.filter(p => !p.rule.gate);

  if (failing.length) {
    console.error(`✗ db:query-lint — ${failing.length} quer${failing.length === 1 ? 'y' : 'ies'} breaking the read-tier rules:\n`);
    for (const [, list] of group(failing)) report(list, console.error);
    console.error('  See docs/architecture.md → Read Tiers. Genuine exceptions: `// query-lint-ok: <reason>`.');
    process.exit(1);
  }

  if (showAll && advisory.length) {
    console.log(`db:query-lint advisory — ${advisory.length} non-blocking finding(s):\n`);
    for (const [, list] of group(advisory)) report(list, console.log);
  }
  console.log(`✓ db:query-lint clean — no banned query shapes in server/ or plugins/.`
    + (advisory.length && !showAll ? ` (${advisory.length} advisory findings — run with --all)` : ''));
  process.exit(0);
}

// Every hook that is FIRED is named in docs/server.md's hook reference.
//
// That page says, in the sentence the whole reference rests on: "A name in neither table is not a
// hook — subscribing to one costs nothing and does nothing, silently." A reader is entitled to use
// it that way, which means an absent hook is not a thin doc, it is a WRONG one: the page actively
// tells you a load-bearing seam does not exist.
//
// Run: node scripts/docs/hooks.mjs   (wired into pretest:regress via docs:lint)
//
// Found on 2026-09-19 by sweeping the call sites: 29 of 59 live hooks were missing. Nineteen were
// engine-fired — the whole cooking set, `item.checkFreshness`, `shop.stock`, `zone.smells`,
// `zone.sounds`, `sense.acuity`, `tech.targets` — and ten were fired by one plugin for another, a
// class the page had no section for at all. Every one was documented in its OWN system doc and
// absent from the index, which is why no per-commit habit caught it: the commit that adds a hook is
// the one that writes the system doc and thinks the job is done.
//
// ⚠ IT SCANS FOR THREE SHAPES, NOT TWO. `gatherHookSync` is a real third caller (the flight
// window's per-cell gather) and a first cut of this sweep looked for `fireHook`/`gatherHook` only,
// which silently under-reported: `wall.tags` came back as "declared in a manifest, never fired",
// i.e. as a stale manifest entry rather than as an undocumented hook. A scanner that misses a
// calling convention invents the wrong finding rather than none.
//
// ⚠ AND IT IGNORES regress.js. A plugin's own suite fires hooks to test them, and a hook that only
// a test fires is not part of the contract this page documents.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const DOC = 'docs/server.md';

// A hook name that is deliberately absent from the reference. Each needs a reason here, so
// omitting one stays a decision rather than an oversight.
const NOT_DOCUMENTED = new Set([
  // (empty — every fired hook is currently in the reference)
]);

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
    return /\.(js|mjs)$/.test(e.name) ? [p] : [];
  });
}

// ⚠ A ROW, NEVER THE FILE. The obvious test — does the page contain this string — passes on the
// page's own PROSE, and this page's prose names hooks constantly (the note explaining why the
// reference must stay complete lists seven of them). Mutation-tested at the time: deleting the
// `shop.stock`, `wall.tags` and `sense.acuity` ROWS left the gate green, because each name still
// appeared a few paragraphs up. So the check is for a table row — a line beginning `|` that carries
// the name in backticks — which is the thing a reader actually looks the hook up in.
function documentedRows(doc) {
  const rows = new Set();
  for (const line of doc.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue;
    for (const m of line.matchAll(/`([a-zA-Z0-9_.:-]+)`/g)) rows.add(m[1]);
  }
  return rows;
}

export function lintHookDocs() {
  const doc = readFileSync(DOC, 'utf8');
  const documented = documentedRows(doc);
  const fired = new Map();

  for (const file of [...walk('server'), ...walk('plugins')]) {
    const rel = file.split(sep).join('/');
    if (/\/regress\.js$/.test(rel)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((ln, i) => {
      const m = ln.match(
        /\b(fireHookSync|gatherHookSync|fireHookFirst|gatherHook|fireHook)\(\s*['"]([a-zA-Z0-9_.:-]+)['"]/,
      );
      if (!m) return;
      if (!fired.has(m[2])) fired.set(m[2], []);
      fired.get(m[2]).push(`${rel}:${i + 1}`);
    });
  }

  const problems = [];
  for (const [name, sites] of [...fired].sort()) {
    if (NOT_DOCUMENTED.has(name)) continue;
    if (!documented.has(name)) problems.push(`\`${name}\` — fired at ${sites[0]}`);
  }
  return { problems, total: fired.size };
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { problems, total } = lintHookDocs();
  if (problems.length) {
    console.error(`✗ docs:hooks — ${problems.length} fired hook(s) missing from ${DOC}:`);
    for (const p of problems) console.error(`  ${p}`);
    console.error(`\n  Add a row to the hook reference in ${DOC} — the engine table if the`);
    console.error('  engine fires it, the "Hooks plugins fire" table if a plugin does. If it is');
    console.error('  deliberately undocumented, add it to NOT_DOCUMENTED in this file with a reason.');
    process.exit(1);
  }
  console.log(`✓ docs:hooks clean — all ${total} fired hooks are in the reference.`);
  process.exit(0);
}

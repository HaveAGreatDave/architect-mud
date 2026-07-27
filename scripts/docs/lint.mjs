// docs:lint — catch documentation whose STATUS HEADER contradicts its own body.
//
//   npm run docs:lint
//
// Why this exists. On 2026-07-27 a state-of-the-game audit reported five shipped
// systems as outstanding work. Every one of those errors came from the same place:
// a status line at the top of a doc that nobody updated while the body underneath
// it filled with ✅ marks and implementation notes.
//
//   systems-weather-extreme.md   titled "Design — Not Yet Built", said "Nothing here
//                                is implemented", and sat directly above a roadmap
//                                marked complete through step 7d.
//   the void-travel memo         opened "DESIGN ONLY, nothing built" above fourteen
//                                shipped slices.
//
// Code is gated on every push and content is gated on every import; a status line
// was the one claim in this repo with no test behind it. This is that test.
//
// THE RULE, deliberately narrow: flag a doc only when its header asserts that
// NOTHING is built while its body is full of built markers. A header that says
// "phases 0–2 built, rest design" or "STATUS: BUILT (design intent below)" is an
// honest compound statement and must NOT be flagged — mixed status is the normal
// case for a living system, and a linter that cries about it gets switched off.
//
// False negatives are fine here. False positives are not.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DOCS_ROOT = new URL('../../docs/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO_ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// What counts as "the header": everything above the first `##` section heading —
// the title, the status blockquote, and any framing prose. This is SEMANTIC rather
// than a fixed line count, which matters: a fixed window swallowed the first few
// roadmap entries of a long doc, and a ✅ landing inside the header made the file
// look like an honest compound status and silently exempted it. Capped so a doc
// with no `##` at all still gets a header/body split instead of being all header.
const HEADER_CAP = 40;

function splitHeaderBody(lines) {
  let end = lines.findIndex((l, i) => i > 0 && /^##\s/.test(l));
  if (end < 0) end = Math.min(HEADER_CAP, lines.length);
  end = Math.min(end, HEADER_CAP);
  return { header: lines.slice(0, end).join('\n'), body: lines.slice(end).join('\n') };
}

// Phrases that assert nothing (or nearly nothing) is built. Deliberately specific —
// a bare "design" is not on this list, because half the docs in this repo are titled
// "X (Design)" while describing something partially shipped, which is honest.
const NOTHING_BUILT = [
  /not\s+yet\s+built/i,
  /\bnot\s+built\b/i,
  /nothing\s+(here\s+)?is\s+implemented/i,
  /nothing\s+(here\s+)?(has\s+been\s+)?built/i,
  /\bdesign\s+only\b/i,
  /\bunbuilt\b/i,
  /none\s+of\s+this\s+(is|has\s+been)\s+built/i,
];

// Markers that mean "this part shipped". Counted in the BODY only.
const BUILT_MARKER = /✅|\*\*?built\b|\bstatus:\s*built\b|\(built\b|\bshipped\b|\bas\s+built\b/gi;

// A header that ALSO claims something is built is a compound statement, not a lie.
// Checked after the NOTHING_BUILT phrases are stripped out, so the "built" inside
// "Not Yet Built" can't rescue the very header it belongs to.
const CLAIMS_SOMETHING_BUILT = /✅|\bbuilt\b|\bshipped\b/i;

// How many built markers in the body before a "nothing is built" header is a
// contradiction rather than a stray word. Three keeps one-off prose ("the built
// environment") from tripping it.
const BODY_MARKER_THRESHOLD = 3;

function markdownFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...markdownFiles(full));
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

export function lintDocsTree(root = DOCS_ROOT) {
  const problems = [];

  for (const file of markdownFiles(root)) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    const { header, body } = splitHeaderBody(lines);

    const denials = NOTHING_BUILT.filter(re => re.test(header));
    if (!denials.length) continue;

    // Strip the denial phrases before asking whether the header claims anything
    // IS built — otherwise "Not Yet Built" reads as a positive.
    let stripped = header;
    for (const re of NOTHING_BUILT) stripped = stripped.replace(new RegExp(re.source, 'gi'), '');
    if (CLAIMS_SOMETHING_BUILT.test(stripped)) continue;   // honest compound status

    const hits = body.match(BUILT_MARKER) || [];
    if (hits.length < BODY_MARKER_THRESHOLD) continue;

    const quote = header.match(denials[0])?.[0] ?? '';
    const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
    problems.push(
      `${rel}: header says "${quote.trim()}" but the body carries ${hits.length} built markers ` +
      `(e.g. ${[...new Set(hits.map(h => h.trim()))].slice(0, 3).join(', ')}). ` +
      `Update the status line, or narrow it to what is actually unbuilt.`
    );
  }

  return problems;
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = lintDocsTree();
  if (problems.length) {
    console.error(`✗ docs:lint — ${problems.length} doc(s) whose status header contradicts the body:`);
    for (const p of problems) console.error(`  ${p}`);
    console.error('\n  A status line is a claim. Make it true, or make it specific.');
    process.exit(1);
  }
  console.log('✓ docs:lint clean.');
  process.exit(0);
}

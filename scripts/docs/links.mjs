// Every markdown link between docs resolves to a file that exists.
//
// A broken link is unambiguously a bug: a reader clicks it and gets nothing.
// That is different from a doc PATH in backticks — historical prose legitimately
// names files that are gone ("`factions.js` → `ideologies.js`", "until it was
// folded into the CODEX"), and flagging those would train everyone to ignore the
// check. So this lints links only, and deliberately not paths.
//
// Found on 2026-08-02:
//   docs/combat.md              → combat-and-stats-plan.md   (never existed)
//   docs/systems-macros.md      → project_custom_sidebar_panels.md
//                                 (a MEMORY filename that leaked into a repo doc —
//                                  the memory directory is not in the repo at all)
//   docs/systems-overland-void-travel.md → systems-map.md    (never existed)
//
// The combat.md one is the reason this is a lint and not a one-off sweep: the
// July 2026 docs audit already found it, recorded it as a "ghost link", and it
// was still there today. A finding that isn't executable doesn't stay fixed.
//
// Run: node scripts/docs/links.mjs   (wired into pretest:regress via docs:lint)
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';

const LINK_RE = /\]\(([^)\s]+?)(?:#[^)]*)?\)/g;

export function lintDocLinks(roots = ['docs', 'README.md', 'CLAUDE.md']) {
  const files = [];
  for (const r of roots) {
    if (!existsSync(r)) continue;
    if (statSync(r).isFile()) { files.push(r); continue; }
    (function walk(d) {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (n.endsWith('.md')) files.push(p);
      }
    })(r);
  }

  const problems = [];
  for (const f of files) {
    // Strip fenced blocks and code spans BEFORE looking for links. A doc that
    // quotes a broken link in backticks — which the audit records do, by their
    // nature — is documenting it, not committing it. Without this the audit that
    // found a bad link can never be made to pass.
    const src = readFileSync(f, 'utf8')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`\n]*`/g, '');
    for (const m of src.matchAll(LINK_RE)) {
      const t = m[1];
      // External, anchors-only, and templated targets are not ours to resolve.
      if (/^(https?:|mailto:|#)/.test(t) || t.includes('<') || t.includes('*')) continue;
      // `path/to/file.js:942` is this repo's clickable file:line convention, not
      // part of the filename. Strip it before resolving.
      const target = t.replace(/:\d+(?:-\d+)?$/, '');
      // Relative to the linking doc first, then repo root — both are used.
      if (existsSync(join(dirname(f), target)) || existsSync(target)) continue;
      problems.push(`${f.replace(/\\/g, '/')} → ${t}`);
    }
  }
  return problems;
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = lintDocLinks();
  if (problems.length) {
    console.error(`✗ docs:links — ${problems.length} link(s) pointing at nothing:`);
    for (const p of problems) console.error(`  ${p}`);
    console.error('\n  Fix the target, or drop the link. A link that 404s is worse than no link.');
    process.exit(1);
  }
  console.log('✓ docs:links clean — every doc link resolves.');
  process.exit(0);
}

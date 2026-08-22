// docs:readmes — the same test docs/ already gets, pointed at plugin READMEs.
//
//   npm run docs:readmes   (and, via `docs:lint`, on every `npm run test:regress` and every push)
//
// WHY THIS EXISTS. `docs/` has been gated on a status line since 2026-07-27: a header that says
// nothing is built, sitting over a body full of shipped markers, fails the build. Plugin READMEs had
// no such gate, and on 2026-08-21 voidwalking's said this, in a section titled "Not yet built (later
// slices)":
//
//     Branching map + encounters (2), ghost-traces (3), parties (4), loot/scavenging +
//     claim ledger (5), frontier map + gate readout (6).
//
// Every one of those had shipped. `plugin.json` declared `loot`, `frontier`, `scrawl`, `camp`, `flag`
// and `ready` in the same directory, three lines from the claim. The manifest is the one thing in a
// plugin folder that cannot lie about what exists — the loader registers exactly what it lists — so
// it is the fact to check a README against.
//
// TWO CHECKS.
//
//   1. THE STATUS HEADER, reusing `lintDocsTree` unchanged. Same rule, same thresholds, same
//      deliberate narrowness: only a header that asserts NOTHING is built, over a body full of built
//      markers. A compound status ("phases 0-2 built, rest design") passes, here as there.
//
//   2. A DECLARED VERB NAMED IN AN UNBUILT SECTION. This is the one that catches the case above, and
//      it is sharper than check 1 because it does not depend on how the README is worded elsewhere:
//      a verb the loader has registered cannot be in the "later" pile. Scoped to the plugin's OWN
//      manifest, so a README discussing somebody else's verb is not its problem.
//
// ⚠ THE SECTION IS FOUND BY ITS HEADING, NOT BY PROXIMITY. An "unbuilt" region runs from a heading
// that promises future work to the next heading of the same or higher level. Scanning a fixed number
// of lines after the phrase would either miss the tail of a long list (the voidwalking one is one
// line, but the storefront one is twelve) or swallow the built section underneath it.
//
// ⚠ AND IT IS HEADINGS ONLY, WHICH COST A DRAFT TO LEARN. The first cut also swept running prose for
// a "no … yet" sentence, on the reasoning that voidwalking's other lie was one of those. Across 89
// plugin READMEs it found the one real case and three inventions: graffiti's "the verb is
// `spraycan`, not `spray` … the later loader would have eaten one", mis's "you may not act on them),
// a named `revoke` still", sneak's "no random knockout mid-brawl … a second later". English puts
// "not" and "later" in the same sentence constantly and means nothing by it. A HEADING is a
// deliberate act of filing something under work-not-done, and it is the only signal here strong
// enough to gate a push on.
//
// False negatives are fine here. False positives are not — same contract as docs:lint. A gate that
// cries about honest prose is a gate somebody switches off.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { lintDocsTree } from './lint.mjs';

const REPO_ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const PLUGINS = join(REPO_ROOT, 'plugins');

// Headings that open a region about work that has not been done. Deliberately narrow: a bare
// "Roadmap" is not here, because half of these READMEs use it for a mix of shipped and unshipped.
const FUTURE_HEADING = /^(#{1,6})\s*(.*(not\s+(yet\s+)?(built|implemented|done)|unbuilt|still\s+to\s+(do|build)|later\s+slices?|future\s+(work|slices?|phases?)|todo|deferred|design\s+only).*)$/i;

function headingLevel(line) {
  const m = /^(#{1,6})\s/.exec(line);
  return m ? m[1].length : 0;
}

// Every stretch of a README that talks about work not yet done.
function unbuiltRegions(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = FUTURE_HEADING.exec(lines[i]);
    if (!m) continue;
    const level = m[1].length;
    let j = i + 1;
    for (; j < lines.length; j++) {
      const l = headingLevel(lines[j]);
      if (l > 0 && l <= level) break;
    }
    out.push({ label: m[2].trim(), text: lines.slice(i + 1, j).join('\n'), line: i + 1 });
    i = j - 1;
  }
  return out;
}

export function lintPluginReadmes(root = PLUGINS) {
  const problems = [];
  if (!existsSync(root)) return problems;

  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    if (!statSync(dir).isDirectory()) continue;
    const readmePath = join(dir, 'README.md');
    const manifestPath = join(dir, 'plugin.json');
    if (!existsSync(readmePath) || !existsSync(manifestPath)) continue;

    let commands = [];
    try { commands = JSON.parse(readFileSync(manifestPath, 'utf8')).commands || []; }
    catch (e) { problems.push(`plugins/${name}/plugin.json does not parse: ${e.message}`); continue; }
    if (!commands.length) continue;

    const text = readFileSync(readmePath, 'utf8');
    const rel = relative(REPO_ROOT, readmePath).replace(/\\/g, '/');

    for (const region of unbuiltRegions(text)) {
      // Strip code fences: a snippet is an example, not a claim about what ships.
      const prose = region.text.replace(/```[\s\S]*?```/g, ' ');
      const named = commands.filter(v => new RegExp(`\\b${v.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i').test(prose));
      if (!named.length) continue;
      problems.push(
        `${rel}${region.line ? `:${region.line}` : ''}: "${region.label}" names ${named.map(v => `\`${v}\``).join(', ')}, ` +
        `which plugin.json DECLARES — the loader registers those verbs, so they are not future work. ` +
        `Move them out of that section, or drop them from the manifest.`
      );
    }
  }
  return problems;
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const stale = lintDocsTree(PLUGINS);
  const contradicted = lintPluginReadmes();
  const problems = [...stale, ...contradicted];
  if (problems.length) {
    console.error(`✗ docs:readmes — ${problems.length} plugin README(s) claiming something that ships is unbuilt:`);
    for (const p of problems) console.error(`  ${p}`);
    console.error('\n  A README is a claim, and plugin.json is the fact. Make them agree.');
    process.exit(1);
  }
  console.log('✓ docs:readmes clean.');
  process.exit(0);
}

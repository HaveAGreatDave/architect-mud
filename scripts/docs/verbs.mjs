// Every plugin, and every verb it declares, is named in docs/plugins.md.
//
// plugins.md bills itself as "the fast lookup: which plugin owns a given verb or
// mechanic". That promise is only worth anything if it is COMPLETE — a verb the
// index doesn't name is a verb the next person re-implements, or an engine
// builtin they edit for an hour before discovering a plugin was shadowing it all
// along (which is the precedence trap the doc's own opening section is about).
//
// Run: node scripts/docs/verbs.mjs   (wired into pretest:regress via docs:lint)
//
// Found on 2026-08-02: three plugins with NO ROW AT ALL (sneak, preservation,
// appliances — `knockout` is the headline verb of a whole shipped system) plus 21
// unnamed verbs. Nobody removed them; the rows were never written. A per-commit
// docs habit cannot catch that, because the commit that adds a plugin is exactly
// the one that thinks the plugin is obvious.
import { readFileSync, readdirSync, existsSync } from 'node:fs';

// Verbs that are deliberately not in the index. Each needs a reason here, so
// omitting one stays a decision rather than an oversight.
//
// The bar: a player can never type it. These are resolve/handshake verbs the
// CLIENT emits — a minigame reporting its result, a panel button firing an id —
// and listing them beside `cook` or `knockout` would make the player-verb column
// useless for finding out what a player can actually do. Where a family of them
// exists, plugins.md still names the family ("panel-fired, not typed"), so the
// mechanism is documented even though each member isn't.
const NOT_PLAYER_TYPED = new Set([
  // Minigame result handshakes — the server hands out {skill, difficulty}, the
  // client plays it and reports back through these. See systems-display-mode.md.
  'jackresolve', 'hackresolve', 'safecrackresolve', 'pirateresolve', 'fishresolve',
  'spliceresolve', 'synthresolve', 'strafresolve', 'hijackresolve', 'concealresolve',
  'apprehendresolve', 'tillcrackresolve', 'hackrigresolve', 'splicebegin', 'splicepreview',
  // Client/session handshakes.
  'introdone', 'tabletdone', 'flightsync', 'flightevent', 'tabletnav', 'tabletaction',
  'selectcassette', 'tablettune', 'sprayapply', 'spraysave', 'spraydel',
  'outfitsetid', 'outfitwearid', 'outfitwearnowid', 'outfitdelid',
  'undressid', 'hangwornid', 'takeoffid',
  // Dev-only entry points, prefixed with a dot in the manifest.
  'hackpreview', 'createsound', 'playsound', 'cooktest', 'splicetest',
]);

export function lintPluginDocs(docPath = 'docs/plugins.md', root = 'plugins') {
  const docs = readFileSync(docPath, 'utf8');
  const problems = [];
  for (const d of readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const manifest = `${root}/${d.name}/plugin.json`;
    if (!existsSync(manifest)) continue;
    let j;
    try { j = JSON.parse(readFileSync(manifest, 'utf8')); } catch { continue; }

    // A row is `| **name**` at the start of a line — the table's own shape.
    if (!new RegExp(`^\\|\\s*\\*\\*${d.name}\\*\\*`, 'm').test(docs)) {
      problems.push(`${d.name}: no row in ${docPath} at all — the index does not know this plugin exists`);
      continue;   // its verbs are all missing too; one problem, not twenty
    }
    for (const c of j.commands || []) {
      const v = (typeof c === 'string' ? c : c?.name || '').replace(/^[./]/, '');
      if (!v || NOT_PLAYER_TYPED.has(v)) continue;
      if (!new RegExp(`\\b${v}\\b`, 'i').test(docs)) {
        problems.push(`${d.name}: verb \`${v}\` is not named in ${docPath}`);
      }
    }
  }
  return problems;
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = lintPluginDocs();
  if (problems.length) {
    console.error(`✗ docs:verbs — ${problems.length} undocumented plugin/verb(s):`);
    for (const p of problems) console.error(`  ${p}`);
    console.error('\n  Add it to the table in docs/plugins.md, or — if a player can never');
    console.error('  type it — to NOT_PLAYER_TYPED in scripts/docs/verbs.mjs with a reason.');
    process.exit(1);
  }
  console.log('✓ docs:verbs clean — every plugin and player verb is in the index.');
  process.exit(0);
}

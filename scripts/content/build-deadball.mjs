// Recompile data/scripts/baseball.bsm into the Deadball content rows, in place.
//
// WHY THIS EXISTS. Deadball was imported once through the dev panel's .bsm import and
// never regenerated, so the shipped row and the file in git drifted apart in silence.
// The cost was visible on air: an older baseball.bsm was missing the `::endlines` that
// closes the `chatter` pool, so the compiler ran straight on and swallowed the next
// block — `chatter` ended up holding the literal string "::lines atbat.strikeout" plus
// that pool's three calls, and `atbat.strikeout` didn't exist at all. Roughly one
// chatter roll in twenty-two, Chip Vega read a compiler directive out loud.
//
// The .bsm is the source of the show. Re-run this after editing it, exactly as
// build-cluster-puck.mjs does for hockey.
//
//   node scripts/content/build-deadball.mjs
//
// UNLIKE build-cluster-puck.mjs this is NOT additive — the rows already exist. It reads
// each one, overwrites only the fields the .bsm actually derives, and leaves everything
// else (id, channel, created_by, description, tags, the playlist row) untouched. So it
// stays a no-op diff when the file and the row already agree.
//
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalJson } from './lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// The compiler is a browser script that drops `compileBsm` into global scope; the repo
// is "type": "module", so it's evaluated here rather than imported.
const compileBsm = new Function(`${rd('client/devpanel/js/bsm-compiler.js')}; return compileBsm;`)();
const compiled = compileBsm(rd('data/scripts/baseball.bsm'));
const { meta, sportsScript, assets } = compiled;

if (meta.type !== 'sports' || meta.sport !== 'baseball') {
  console.error(`✗ baseball.bsm is not a baseball sports script (@type ${meta.type}, @sport ${meta.sport})`);
  process.exit(1);
}
if (compiled._debug.unknownDirectives.length) {
  console.error(`✗ unknown directives in baseball.bsm: ${compiled._debug.unknownDirectives.join(', ')}`);
  process.exit(1);
}
// The failure this script was written for: a pool that never closed swallows the next
// pool's HEADER as one of its own lines. Nothing downstream would ever notice — it's a
// valid string in a valid pool — so check for it here rather than on air.
for (const [key, lines] of Object.entries(sportsScript.pools)) {
  const stray = lines.find((l) => l.startsWith('::'));
  if (stray) {
    console.error(`✗ pool "${key}" contains a raw directive (${stray}) — a ::lines block above it is missing its ::endlines`);
    process.exit(1);
  }
}

// Existing rows, written by the original dev-panel import. Ids are stable and hand-held
// here so this never mints a second Deadball.
const BROADCAST_FILE = 'content/media_broadcasts/bc_1783289744953.json';
const GRAPHIC_FILE = `content/media_graphics/${meta.titlecard}.json`;

const patch = (rel, fields) => {
  const p = path.join(ROOT, rel);
  const raw = fs.readFileSync(p, 'utf8');
  const row = JSON.parse(raw);
  Object.assign(row, fields);
  // The export's own serialization (sorted keys, 2-space indent, LF), so a rebuild of an
  // unchanged script writes the bytes the export wrote. With plain JSON.stringify every
  // rebuild reordered the whole row into the compiler's key order.
  const after = canonicalJson(row);
  if (after !== raw) fs.writeFileSync(p, after, 'utf8');
  console.log(`  ${after === raw ? 'unchanged' : 'updated  '} ${rel}`);
};

// The park (sports_pools.venue: its site, and later the venue data the GLASS 2 park is
// built from) and the clubs' identities (sports_pools.clubs, build-deadball-clubs.mjs)
// aren't in the .bsm, so a rebuild carries them over, as build-cluster-puck.mjs does for
// hockey's clubs.
{
  const kept = JSON.parse(fs.readFileSync(path.join(ROOT, BROADCAST_FILE), 'utf8')).sports_pools || {};
  if (kept.venue) sportsScript.venue = kept.venue;
  if (kept.clubs) sportsScript.clubs = kept.clubs;
}

patch(BROADCAST_FILE, {
  name: meta.broadcast || meta.name,
  category: meta.category || 'sport',
  playback_mode: 'sports',
  override_duration: meta.length || 300,
  sports_pools: sportsScript,
  messages: compiled.messages,
});

// Only `content` is regenerated. `type` is left as the row already has it: the runner
// content-sniffs the <svg> tag at render time, and the sibling Cluster Puck card ships
// as "ascii" too — rewriting it here would be a behaviour change dressed as a rebuild.
const titleAsset = assets.find((a) => a.id === meta.titlecard);
if (!titleAsset) { console.error(`✗ baseball.bsm has no ::asset ${meta.titlecard}`); process.exit(1); }
// Line endings are normalized: the .bsm is CRLF on disk here and the asset block is the
// one place the compiler preserves them verbatim, so without this every rebuild on
// Windows reports the card as changed when only the newlines moved.
patch(GRAPHIC_FILE, { content: titleAsset.content.replace(/\r\n/g, '\n') });

console.log(`\n✓ Deadball rebuilt from baseball.bsm`);
console.log(`  ${sportsScript.teams.length} clubs · ${sportsScript.players.length} players · ${Object.keys(sportsScript.pools).length} line pools · airSlots ${JSON.stringify(sportsScript.airSlots)}`);
console.log('  Airing is the KSAB5 slate row (content/media_channel_playlist/ksab5-slate.json), not the script.');

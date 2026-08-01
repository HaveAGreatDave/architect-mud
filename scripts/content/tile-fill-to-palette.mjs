// Give the terrain painter back the three terrains it could not paint.
//
//   node scripts/content/tile-fill-to-palette.mjs [--dry-run]
//
// IDEMPOTENT — a second run writes nothing. Files only; there is no database in
// this process. The companion to tile-override-cleanup.mjs, and the second half
// of docs/proposals/tile-presentation-overrides.md.
//
// THE PROBLEM. tile-override-cleanup.mjs cleared 3,484 fills that derive had
// always discarded, and spared 1,374 on grass/water/underwater because those
// WERE rendering — its warranty was zero pixel delta, and a value the map is
// currently drawing cannot be cleared under that warranty. Correct, and it left
// a hole: once authored beat the palette everywhere, those 1,374 tiles were the
// tiles where the terrain painter did nothing you could see. Repaint the bay as
// sand and the fill would not move, because the tile's own colour was answering
// the question. Same for the Studio's Terrain dropdown, which is where this was
// reported from — it changed `flags.terrain`, and therefore swimmability,
// routing, pacing and the minimap class, while the tile sat there looking
// identical. A knob that silently governs gameplay and visibly governs nothing
// is worse than no knob.
//
// THE ARGUMENT THIS SCRIPT RESTS ON is the palette file's own, applied a second
// time: THE VALUE PLAYERS SEE IS THE CANONICAL ONE. Every water tile in the
// world draws #1d3b52 or a deliberate variant of it; not one has ever drawn the
// palette's #3f7fb0. So the palette was wrong about what water looks like, and
// the fix is to correct the palette rather than to repaint the world. Once it
// says #1d3b52, a tile ALSO saying #1d3b52 is not an override of anything — it
// is the default written out longhand, in 1,038 places, and clearing it changes
// no pixel while handing the terrain back its authority.
//
// WHAT IS DELIBERATELY LEFT ALONE.
//   · The shading variants — 258 water tiles on a second blue, 66 grass on a
//     paler strand, 12 deeper underwater. A colour that differs from its terrain
//     ON PURPOSE is precisely what the override column is for, and those tiles
//     keep it. They are still fill-locked against the terrain painter; that is
//     now a decision somebody made rather than a rule nobody could see.
//   · `color`, on every tile. The glyph colours are real authorship and they do
//     not agree within a terrain (605 tiles share one fill under TWO different
//     glyph colours, #3f7fb0 and #7fd3ff), so there is no palette value to fold
//     them into. The palette's `text` stays null for all three and the renderer
//     keeps picking by luminance where a tile says nothing.
//
// THE RULES ARE FROZEN HERE, same as in the predecessor: the expected fills are
// literals below, not a read of terrain.json, so this script is a standing
// statement of what it did even after the palette moves again.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';

const DRY = process.argv.includes('--dry-run');
const ZONES = join(CONTENT_DIR, 'zones');

// terrain → the fill it adopted, frozen. A tile whose bg_color is exactly this
// is saying what its terrain already says.
const ADOPTED = new Map([
  ['water', '#1d3b52'],
  ['grass', '#2f3a26'],
  ['underwater', '#14283a'],
]);

const files = readdirSync(ZONES).filter((n) => n.endsWith('.json'));
const cleared = new Map([...ADOPTED.keys()].map((t) => [t, 0]));
const kept = new Map([...ADOPTED.keys()].map((t) => [t, 0]));
let written = 0;

for (const name of files) {
  const path = join(ZONES, name);
  const zone = JSON.parse(readFileSync(path, 'utf8'));
  // `flags.terrain` only. The legacy inference rungs (pier, road_ icons, the
  // green-background reading) cannot produce these three, and the green rung is
  // gone anyway — tile-override-cleanup wrote it into the flag.
  const terrain = zone.flags?.terrain;
  const adopted = ADOPTED.get(terrain);
  if (!adopted || zone.bg_color == null) continue;

  if (zone.bg_color.toLowerCase() !== adopted) { kept.set(terrain, kept.get(terrain) + 1); continue; }

  // `bg_color` is omitWhenNull, so the key LEAVES the file rather than becoming
  // null — content:lint errors on a null override.
  delete zone.bg_color;
  cleared.set(terrain, cleared.get(terrain) + 1);
  if (!DRY) writeFileSync(path, canonicalJson(zone), 'utf8');
  written++;
}

const total = (m) => [...m.values()].reduce((a, b) => a + b, 0);
console.log(`${DRY ? '[dry run] ' : ''}tile-fill-to-palette — ${files.length} zone files`);
for (const [terrain, fill] of ADOPTED) {
  console.log(`  ${terrain.padEnd(11)} ${String(cleared.get(terrain)).padStart(4)} cleared (${fill})`
    + `, ${kept.get(terrain)} kept as deliberate overrides`);
}
console.log(`  ${total(cleared)} fills given back to the palette, ${written} files ${DRY ? 'would be ' : ''}written`);

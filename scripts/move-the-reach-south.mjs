// MOVE The Reach south — and undo the extension that was built instead of it.
//
// scripts/extend-the-reach-south.mjs STRETCHED the region: it kept the 20x20 block where it was and
// grew 1,120 new rows off the bottom, making a 20x76 corridor. The intent was to MOVE the block, not
// to stretch it. This is the corrective one-shot: it deletes the extension and relocates the original
// 400 tiles.
//
// THE MOVE. The block was x903-922, y976-995. It goes to y1032-1051 — the row the extension's
// southern edge reached, so the Reach ends up as far out as the stretched map made it feel. That is
// +56 rows. Coldwater's south rim is y947, so the void gap between Basin and Reach goes from 28 rows
// to 84.
//
// THE IDS DO NOT MOVE, and that is the whole reason this is cheap. Reach ids carry a legacy offset
// (`zone_the_reach_<x-40>_<y+972>`), so they never matched the grid in the first place — an id here
// is a NAME, not a coordinate. Keeping them means the two hardcoded voidwalking destinations
// (plugins/voidwalking/index.js), Buzzard Field, every NPC home_zone and every quest reference keep
// working with no edit at all: the region genuinely just moves. Renumbering would fix a cosmetic
// wart and put every one of those references in play.
//
// So after this runs the ids read 1948-1967 while the tiles sit at y1032-1051, and the offset is
// wronger than it was. That is the trade, made deliberately: a wrong-looking id breaks nothing, and
// a missed reference breaks a region.
//
// WHAT THE EXTENSION LEFT BEHIND. The old southern row (y995, ids _1967) grew a `south` exit into
// the first extension row. Deleting the extension without clearing those 20 exits leaves the block
// pointing at 20 zones that no longer exist.
//
//   node scripts/move-the-reach-south.mjs
//   npm run content:import && npm run map:derive

import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const ZONES = join(ROOT, 'content', 'zones');
const POWER = join(ROOT, 'content', 'power_zones');

const OLD_Y0 = 976, OLD_Y1 = 995;   // the real block, the part that moves
const NEW_Y0 = 1032;                // where it lands
const SHIFT = NEW_Y0 - OLD_Y0;      // +56

// Canonical JSON: keys sorted, two-space indent, trailing newline — what content:export emits, so a
// later export produces no spurious diff. (A sorted-key REPLACER silently empties nested objects;
// sorting the KEYS during stringify does not.)
function canonical(obj) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = sort(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(obj), null, 2) + '\n';
}

function main() {
  const files = readdirSync(ZONES).filter(n => /^zone_the_reach_.*\.json$/.test(n));
  const zones = files.map(n => ({ file: n, z: JSON.parse(readFileSync(join(ZONES, n), 'utf8')) }));

  const keep = zones.filter(e => e.z.grid_y >= OLD_Y0 && e.z.grid_y <= OLD_Y1);
  const drop = zones.filter(e => e.z.grid_y > OLD_Y1);
  const dropIds = new Set(drop.map(e => e.z.id));

  // 1. The extension goes. Zone AND power_zone: the generator wrote both, and a power row pointing
  //    at a zone that no longer exists is exactly the kind of orphan content:lint cannot see,
  //    because it is a valid row about a missing thing.
  let removed = 0, removedPower = 0;
  for (const e of drop) {
    unlinkSync(join(ZONES, e.file));
    removed++;
    const p = join(POWER, `${e.z.id}.json`);
    if (existsSync(p)) { unlinkSync(p); removedPower++; }
  }

  // 2. The block moves. grid_y only — grid_x, the id, the name, the prose, the flags and every exit
  //    TARGET stay exactly as they are, because the exits point at ids and the ids did not move.
  let moved = 0, severed = 0;
  for (const e of keep) {
    const z = e.z;
    z.grid_y += SHIFT;
    // 3. Sever the exits into deleted ground. This is the only edge the extension actually added to
    //    the original block: one `south` per tile on the old bottom row.
    for (const [dir, target] of Object.entries(z.exits || {})) {
      if (dropIds.has(target)) { delete z.exits[dir]; severed++; }
    }
    writeFileSync(join(ZONES, e.file), canonical(z), 'utf8');
    moved++;
  }

  console.log(`the reach: moved ${moved} tiles +${SHIFT} rows → y${NEW_Y0}-${NEW_Y0 + (OLD_Y1 - OLD_Y0)}`);
  console.log(`  deleted   ${removed} extension zone(s), ${removedPower} power_zone(s)`);
  console.log(`  severed   ${severed} exit(s) that pointed into the deleted rows`);
  console.log(`  ids       unchanged (legacy offset kept — an id here is a name, not a coordinate)`);
}

main();

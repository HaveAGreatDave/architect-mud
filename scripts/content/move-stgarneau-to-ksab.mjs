/**
 * "Cooking Shit With Neil McManistan" moves from the unlicensed feed to KSAB 7.
 *
 * TWO PLACES RECORD THE CHANNEL and both have to move, or the integrity sweep
 * and the schedule disagree about where the show lives:
 *   • media_broadcasts.channel_id      — the show's home channel
 *   • media_channel_playlist.channel_id — the slot it actually airs in
 *
 * ── THE SLOT DOES NOT MOVE, AND DOES NOT NEED TO ────────────────────────────
 *
 * KSAB's Tuesday is a solid block with no gaps, and 11:00–12:00 is already
 * DOOMCAST (days 127, every day). That is NOT a collision — it is the authoring
 * pattern the scheduler was built for. From plugins/broadcast/index.js:
 *
 *     "Where two rows both cover the current second, the MORE SPECIFIC one wins
 *      — fewest days set. That's what lets an author lay down a normal week and
 *      then drop a Thursday-only slot on 20:00 without touching, duplicating, or
 *      gapping the everyday row underneath it."
 *
 * and the comparator does exactly that (`di < db` on `_dayCount`). This show is
 * `days: 2` — Tuesday alone, one bit — against DOOMCAST's seven, so it wins the
 * hour on Tuesdays and DOOMCAST is untouched the other six days. No slot was
 * moved, no priority hack, nothing displaced.
 *
 * ── THE CAST IS KEPT, AND THE ENGINE HAD TO LEARN WHY ───────────────────────
 *
 * The reconciler's rule reads "only LIVE channels, WEATHER, TALK SHOWS, MORNING
 * SHOWS and GAME SHOWS physically staff the studio; for a scripted show
 * npc_anchor is speaker attribution only". By that rule this show — scripted,
 * now on a `playlist` channel — loses its `conditions.npc_staff` at boot.
 *
 * That would have been wrong, and the regress suite says so in as many words:
 *
 *     "THE DROIDS BEING ON THIS LIST IS THE ONLY REASON THE BASEMENT HAS A
 *      PICTURE. Drop them and the show airs to a dark room and resolves as
 *      technical difficulties, which looks like an engine fault and is a casting
 *      mistake."
 *
 * Because this is the only broadcast in the game with a `location_zone_id`: it
 * is a LOCATION SHOOT. A crew goes to a church basement and films in it, there
 * is a stage, a call state, a preshow act and a keyholder who tells you they
 * film on a Tuesday. None of that is a fact about who broadcasts it.
 *
 * So `plugins/broadcast/index.js` now staffs a location shoot whatever channel
 * carries it, and sends the crew to `location_zone_id` in preference to the
 * channel's `studio_zone_id` — without which KSAB's real studio would have
 * pulled the cast across town and their lines would have come out of an empty
 * room. Both halves are the failures that suite already pins by name.
 *
 * The row id `stgarneau-tue-1100` is deliberately KEPT: it names where the show
 * is SHOT (`location_zone_id: zone_stgarneau_basement`, a church basement), not
 * what it airs on, so it is still true and it is a stable primary key.
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const ROOT = path.resolve(process.cwd(), 'content');
const KSAB = 'ch_7_1782953079593';

const load = (dir, id) => JSON.parse(fs.readFileSync(path.join(ROOT, dir, `${id}.json`), 'utf8'));
const save = (dir, obj, file) => {
  fs.writeFileSync(path.join(ROOT, dir, `${file || obj.id}.json`), canonicalJson(obj), 'utf8');
  console.log(`  updated content/${dir}/${file || obj.id}.json`);
};

// 1. The show's home channel.
const bc = load('media_broadcasts', 'bc_cooking_shit_neil');
bc.channel_id = KSAB;
save('media_broadcasts', bc);

// 2. The slot it airs in — same day, same hour, new network.
const slot = load('media_channel_playlist', 'stgarneau-tue-1100');
slot.channel_id = KSAB;
// conditions.npc_staff is KEPT — see the corrected note above.
save('media_channel_playlist', slot);

// 3. Channel 11 goes.
//
// It existed to carry exactly one programme — its whole description was "dead air
// since public access folded… not dead air on a Tuesday", a line with no meaning
// once the Tuesday moved. An enabled channel with an empty playlist is not
// atmosphere, it is a number on the dial that resolves to nothing whichever way a
// viewer reaches it.
//
// Deleting the FILE is the whole operation: the importer's deletion pass is
// git-diff driven, so the row goes on the next import, prod included. Nothing
// else in content referenced it, and the broadcast plugin's own integrity sweep
// already covers the shapes that could have — it NULLs any `media_broadcasts`
// row pointing at a deleted channel and removes orphaned playlist slots — so the
// order of operations above (move the show first) is belt and braces rather than
// the only thing standing between this and a dangling reference.
const dead = path.join(ROOT, 'media_channels', 'ch_11_stgarneau_stream.json');
if (fs.existsSync(dead)) {
  fs.unlinkSync(dead);
  console.log('  deleted content/media_channels/ch_11_stgarneau_stream.json');
}

console.log('done.');

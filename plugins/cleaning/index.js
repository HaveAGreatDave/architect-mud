/**
 * Cleaning — the mop half of hygiene.
 *
 * The engine could already make a room filthy (`stainZone` in bodily.js) and could
 * describe the filth (describe.js), but nothing could remove it except the nightly
 * sweep. Now that owned rooms keep their stains for a rent cycle
 * (server/engine/zone-filth.js), somebody has to do the work, and that somebody is
 * you.
 *
 * Deliberately a leaf plugin: no table, no tick, no state. The filth itself lives
 * in RAM on the zone, so a clean is a synchronous Map mutation — this whole plugin
 * is a verb, a gate, and some prose about the smell.
 *
 * Design notes worth keeping:
 *  - A tool is not required, it is REWARDED. Bare hands work, clear one mark at a
 *    time, and leave you needing a shower — which is the joke and also the reason
 *    a mop is worth carrying. Requiring a tool would just mean players never clean.
 *  - Cleaning makes you dirty. It routes through the hygiene substrate's sweat
 *    meter rather than inventing a second filth axis, so a long scrub genuinely
 *    costs you a wash afterwards.
 *  - No skill and no IP. This is a chore, not a career.
 */
import { getZoneFurniture } from '../../server/engine/world.js';
import { cleanZone, filthCount, filthTypes, isOwnedZone } from '../../server/engine/zone-filth.js';
import { addSweat } from '../../server/engine/hygiene.js';
import { hasTag } from '../../server/engine/tags.js';
import { query } from '../../server/models/db.js';

// Marks removed per action. A proper tool clears the room; hands do one mark and
// make you regret it.
const TOOL_MARKS = Infinity;
const BARE_MARKS = 1;

// Sweat is the price of the work — a full scrub is real effort.
const TOOL_SWEAT = 6;
const BARE_SWEAT = 14;

// A carried mop/brush/rag, or a fixed utility sink/basin in the room. Either is
// enough to do the job properly; the tag is the contract, never an item id.
async function carriedTool(player) {
  const { rows } = await query(
    `SELECT pi.id, i.name, i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id
      WHERE pi.player_id=$1 AND pi.container_id IS NULL
      ORDER BY i.name`,
    [player.id]
  );
  return rows.find(r => r.tags?.cleaning_tool) || rows.find(r => r.tags?.soap) || null;
}

function fixtureTool(zoneId) {
  return getZoneFurniture(zoneId).find(f => hasTag(f, 'cleaning_tool')) || null;
}

// Prose picked off the worst thing on the floor, so mopping blood doesn't read
// like mopping mud. Falls through to a generic line for anything unlisted.
const CLEAN_LINES = {
  blood:     `You work the blood off the floor. It goes brown before it goes away.`,
  feces:     `You deal with it. There is no dignified way to write this sentence and there wasn't a dignified way to do it either.`,
  urine:     `You mop up the puddle and try not to think about whose it was.`,
  vomit:     `You scrape up the sick. The smell outlasts the stain by a wide margin.`,
  ejaculate: `You clean the floor and resolve, privately, to have a word with somebody.`,
  dirt:      `You sweep the worst of the grit into a corner and then out the door.`,
};

function cleanLine(types) {
  for (const t of ['feces', 'vomit', 'blood', 'urine', 'ejaculate', 'dirt']) {
    if (types.includes(t)) return CLEAN_LINES[t];
  }
  return `You scrub the floor down until it stops being a problem.`;
}

async function doClean(args, raw, player) {
  const zoneId = player.current_zone;
  const before = filthCount(zoneId);

  if (!before) {
    // Not an error — "there's nothing to clean" is information, and answering it
    // here stops `clean` falling through to an unhelpful "Unknown command".
    return { type: 'output', message: `There's nothing here worth cleaning. Small mercies.` };
  }

  const types = filthTypes(zoneId);
  const tool = (await carriedTool(player)) || fixtureTool(zoneId);
  const removed = cleanZone(zoneId, tool ? TOOL_MARKS : BARE_MARKS);
  addSweat(player, tool ? TOOL_SWEAT : BARE_SWEAT);

  const left = filthCount(zoneId);
  let msg = cleanLine(types);
  if (tool) {
    msg += ` <span class="text-dim">(${tool.name})</span>`;
  } else {
    msg += ` Bare-handed, so it's one patch at a time, and now it's on you as well.`;
  }
  if (left) {
    msg += `\n<span class="text-dim">Still filthy: ${left} more patch${left === 1 ? '' : 'es'} to go.</span>`;
  } else {
    msg += `\n<span class="ambient">The room is clean. It even smells like nothing.</span>`;
    // Worth saying only where it means something — a clean street is swept nightly
    // anyway, but a clean home is a thing the player chose to have.
    if (isOwnedZone(zoneId)) {
      msg += ` <span class="text-dim">It'll stay that way as long as you keep it that way.</span>`;
    }
  }
  return { type: 'output', message: msg, refresh: true };
}

export const commands = {
  clean: doClean,
  mop: doClean,
};

export const _test = { doClean, cleanLine, CLEAN_LINES, TOOL_MARKS, BARE_MARKS };

console.log('[cleaning] Plugin loaded.');

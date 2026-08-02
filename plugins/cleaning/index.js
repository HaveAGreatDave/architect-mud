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
// The wall half of "make this room right". One verb covers the floor and the
// brickwork; the graffiti plugin owns the tag itself and this only removes it.
import { tagAt, removeTag } from '../graffiti/index.js';
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
//
// A `consumable_cleaner` (a bottle of acetone, say) does the same job and is
// spent doing it, so it is picked LAST — never while a mop is in the bag. That
// ordering is the whole safety property: a chemical you also cook with must
// never be quietly burned because it sorted earlier alphabetically.
async function carriedTool(player) {
  const { rows } = await query(
    `SELECT pi.id, pi.quantity, i.name, i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id
      WHERE pi.player_id=$1 AND pi.container_id IS NULL
      ORDER BY i.name`,
    [player.id]
  );
  return rows.find(r => r.tags?.cleaning_tool && !r.tags?.consumable_cleaner)
    || rows.find(r => r.tags?.soap)
    || rows.find(r => r.tags?.consumable_cleaner)
    || null;
}

// Spending one of a stack, or dropping the row when that was the last of it.
async function spendCleaner(tool) {
  if ((tool.quantity ?? 1) > 1) {
    await query('UPDATE player_inventory SET quantity = quantity - 1 WHERE id=$1', [tool.id]);
  } else {
    await query('DELETE FROM player_inventory WHERE id=$1', [tool.id]);
  }
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
  const paint = tagAt(zoneId);

  if (!before && !paint) {
    // Not an error — "there's nothing to clean" is information, and answering it
    // here stops `clean` falling through to an unhelpful "Unknown command".
    return { type: 'output', message: `There's nothing here worth cleaning. Small mercies.` };
  }

  const types = filthTypes(zoneId);
  const tool = (await carriedTool(player)) || fixtureTool(zoneId);

  // Paint on brick is the one thing bare hands can't fix. That asymmetry is
  // deliberate: floor filth yields to a determined scrub because requiring a tool
  // would mean nobody ever cleans, but a tag has to have TEETH or defacing a
  // shopfront costs the owner nothing to undo. You go and buy a solvent.
  let paintMsg = '';
  if (paint) {
    if (tool) {
      await removeTag(zoneId);
      paintMsg = `\nYou take ${tool.name} to the wall. <span class="text-dim">"${paint.text}"</span> goes grey, then goes.`;
    } else {
      paintMsg = `\n<span class="text-dim">The paint on the wall doesn't care about your hands. That needs solvent and a brush.</span>`;
    }
  }

  // The wall was the only job here, and it's done (or refused) — don't run the
  // floor arithmetic over a clean floor and report "0 patches".
  if (!before) {
    return { type: 'output', message: paintMsg.trim(), refresh: true };
  }
  const removed = cleanZone(zoneId, tool ? TOOL_MARKS : BARE_MARKS);
  addSweat(player, tool ? TOOL_SWEAT : BARE_SWEAT);

  const left = filthCount(zoneId);
  let msg = cleanLine(types);
  if (tool) {
    msg += ` <span class="text-dim">(${tool.name})</span>`;
    // Only a carried row can be spent — a fixture in the room has no inventory id.
    if (tool.tags?.consumable_cleaner && tool.quantity !== undefined) {
      await spendCleaner(tool);
      msg += `\n<span class="text-dim">The ${tool.name} goes into the floor along with the mess. You won't be cooking with that one.</span>`;
    }
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
  return { type: 'output', message: msg + paintMsg, refresh: true };
}

export const commands = {
  clean: doClean,
  mop: doClean,
};

export const _test = { doClean, cleanLine, carriedTool, CLEAN_LINES, TOOL_MARKS, BARE_MARKS };

console.log('[cleaning] Plugin loaded.');

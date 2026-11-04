// What the street kit means to somebody on foot: the prices, what a tile offers and the room text.
// Pure, so scripts/shapes/street-systems.mjs checks it with no world and no database.
//
// Where a block's parts stand is `kitPlace`, the same answer the paint and the street figures read,
// so a toll gate a player can use is one they can see.
import { LEVEL, kitPlace } from '../../client/game/js/panels/glass/street-kit.js';

// Whole credits (docs/proposals/coldwater-streets.md).
export const PRICE = Object.freeze({ strip: 1 });

// A tile's place, or null. `at(x, y)` is the derived surface cell. A road two tiles wide takes no kit.
export function placeOf(at, x, y) {
  const wide = (rx, ry, axis) => {
    const ox = axis === 'ns' ? 1 : 0, oy = axis === 'ns' ? 0 : 1;
    return !!(at(rx - ox, ry - oy)?.road || at(rx + ox, ry + oy)?.road);
  };
  return kitPlace(at, x, y, wide);
}

const AXIS_OF = { north: 'ns', south: 'ns', east: 'ew', west: 'ew' };
// What a strip does from this tile going `dir`, or { no } saying why it can't. `steps` is how many
// tiles it carries you: to the junction when the belt runs, and one when it has stopped, because a
// stopped belt is a walk you've paid for. Every paved level charges.
export function stripRide(place, dir) {
  if (!place || LEVEL[place.level].dirt) return { no: 'none' };
  if (!place.axis) return { no: 'junction' };
  if (AXIS_OF[dir] !== place.axis) return { no: 'across' };
  const running = LEVEL[place.level].speed > 0;
  const toEnd = dir === 'north' || dir === 'west' ? place.run.i + 1 : place.run.n - place.run.i;
  return { running, steps: running ? toEnd : 1 };
}

// ── THE ROOM TEXT ──
// One voice a level: smug, tired, resigned, abandoned, then bleak. A room keeps its line, picked from
// its coordinates. The first in each pool is the brief's.
export const ROOM_TEXT = Object.freeze([
  [
    'Your reflection in the chrome is wearing a better jacket than you are, courtesy of the ad layer.',
    'The walkway panels were polished this morning. A notice thanks you for not leaving footprints.',
    'A cleaning drone is working round a dropped glove. It has logged the glove.',
    'The bollards light up in order as you pass, in case you were wondering where you are.',
    'The planters are watered on a schedule. The trees in them are under contract.',
  ],
  [
    'The strip is moving, technically. A man on it is being overtaken by a woman walking.',
    'One panel in five doesn\'t match. Somebody has tried to make the patches look deliberate.',
    'A status panel on the toll gate drops out, comes back and apologises for the inconvenience.',
    'The chrome here has been polished as far as the budget reached, which stops at the bollards.',
    'A notice says the walkway is being upgraded. The notice has faded.',
  ],
  [
    'The strip stopped years ago. Someone has chalked the price back on in case you forget.',
    'A panel is missing from the walkway. A door has been laid in the gap, handle up.',
    'The planter tree is brown and hasn\'t been told.',
    'Steel plate, scratched by everybody who ever dragged anything along here.',
    'Every eighth bollard is gone. The bolts are still in the ground, and so is one bollard\'s foot.',
  ],
  [
    'A bollard lies across the walkway like it gave up mid-shift. The camera above it is still recording.',
    'Weeds have come up through the place the panels were.',
    'The crossing pole leans out over nothing. Its fee sign has faded to a suggestion.',
    'The plates have rusted to the colour of the ground. A stump stands in a planter.',
    'Nobody has paid for this street in years. The toll gate still has its hand out.',
  ],
  [
    'The street was never built. A hauler grinds past through the mud, and a camera swivels to watch you step aside.',
    'Two ruts and a puddle. Somebody\'s drum is rusting in the verge.',
    'Mud, then more mud. The bridge overhead has better lighting than anywhere you can reach.',
    'A burnt-out pod sits nose down at the edge of the track. Nobody has charged anybody for it.',
    'Weeds along the verge, and a crate nobody came back for.',
  ],
]);
const pick = (pool, x, y) => pool[Math.abs((x * 73856093) ^ (y * 19349663)) % pool.length];
export const roomLine = (place, x, y) => pick(ROOM_TEXT[place.level], x, y);

// What a tile has to offer, said once at the end of its text. Nothing on the dirt.
export function offerLine(place) {
  const parts = [];
  if (place.axis && !LEVEL[place.level].dirt) parts.push(`A strip runs along the walkway, ₵${PRICE.strip} a ride (<strong>belt north</strong> or whichever way it goes).`);
  return parts.join(' ');
}

// A vehicle going by, a room event at every level, dirt included.
export const PASSING = Object.freeze([
  'A hydrogen hauler comes through. People step back from the kerb without looking up.',
  'A licensed pod goes by a little above the lane. Everyone on the kerb moves back half a pace.',
  'A hauler\'s air brakes hiss at the junction. People step back and go on with their calls.',
]);
export const PASSING_DIRT = Object.freeze([
  'A hauler grinds through the mud. Everyone steps aside and watches the ruts fill back up.',
  'A pod goes over the ruts with its lights on. Nobody here has ever been in one.',
]);
export const passingLine = (place, r) => {
  const pool = LEVEL[place.level].dirt ? PASSING_DIRT : PASSING;
  return pool[Math.floor(r * pool.length) % pool.length];
};

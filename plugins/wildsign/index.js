// SIGNS OF WILDLIFE THAT `search` CAN TURN UP.
//
// The first is a red-tail's kill site. The hawk's strikes on voles, jackrabbits and lizards are
// arithmetic in client/shared/birds.js (groundStrike, groundKillsSince): a pure function of the
// tiles and the clock, so this process can derive the same strikes the windscreen drew and say that
// something died on this tile in the last hour. Nothing is stored, and nothing needs to be.
//
// ⚠ THE PREY LIST IS BUILT THE WAY THE RENDERER BUILDS IT — critter ground by the flight biome, not a
// building, not a road — because the hawk picks its target by hashing over that list. Build it
// differently and the server names a kill the picture never showed.
//
// ⚠ KNOWLEDGE ONLY. `search` never pays out (plugins/search/README.md); this returns a line and
// nothing else, and a failed search is indistinguishable from an empty tile.
import { getZone, tileSurroundings, zoneAtTile } from '../../server/engine/world.js';
import { getEnvironmentState, getGameHour } from '../../server/engine/environment.js';
import { speciesAt, placeOf, flockAt, crittersAt, critterGround, groundKillsSince, birdDaylight } from '../../client/shared/birds.js';
import { biomeOf } from '../flight/biomes.js';
import { isRoadCell } from '../flight/state.js';

const HAWK_REACH = 3;                 // tiles: the red-tail's GROUND_REACH in birds.js
const FRESH_MS = 10 * 60 * 1000;      // under this the blood is still wet
const SIGN_MS = 60 * 60 * 1000;       // past this there is nothing left worth finding
const MARGIN = 2;                     // a careful look, not a lucky one

// The game hour, behind a seam because regress never boots the environment (it would always be night).
let hourNow = getGameHour;

const isBuilt = (z) => !!(z?.flags?.building_type || z?.flags?.is_building);

// The red-tails anchored within reach of this tile, found the way the windscreen anchors flocks.
function hawksNear(zone, weather) {
  const out = [];
  const R = HAWK_REACH * 2;           // a hawk up to 3 away can strike a critter up to 3 beyond it
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const z = zoneAtTile(zone.map_id, zone.grid_x + dx, zone.grid_y + dy, zone.grid_z ?? 0);
    if (!z || isBuilt(z)) continue;
    const sur = tileSurroundings(z);
    const ground = placeOf(biomeOf(z), sur.bld, sur.shore);
    const x = z.grid_x, y = z.grid_y;
    if (speciesAt(ground, x, y, { weather, road: isRoadCell(z) }) !== 'hawk') continue;
    const f = flockAt(x, y, 1, 'hawk', ground);
    if (f) out.push(f);
  }
  return out;
}

function preyFor(zone, h, now) {
  const out = [];
  for (let y = h.ay - HAWK_REACH; y <= h.ay + HAWK_REACH; y++) for (let x = h.ax - HAWK_REACH; x <= h.ax + HAWK_REACH; x++) {
    const z = zoneAtTile(zone.map_id, x, y, zone.grid_z ?? 0);
    if (!z || isBuilt(z) || isRoadCell(z) || !critterGround(biomeOf(z))) continue;
    out.push(...crittersAt(x, y, now));
  }
  return out;
}

// What a kill leaves, by what was killed and how long ago. Matter-of-fact; the hawk is never named
// as a certainty below the fresh line, because by then all you have is what is on the ground.
const LINES = {
  jackrabbit: [
    'A tuft of grey-brown fur is caught on the stones here, and beside it a smear of blood that hasn\'t dried. Something came down on a jackrabbit, not long ago, and took it with it.',
    'There\'s a scatter of dry fur in the scrub and two scuffed marks where something was pinned. A jackrabbit ended here earlier on.',
  ],
  vole: [
    'Grass-coloured fur, a few drops of blood, and a scrape in the dirt the size of a thumb. Something small was picked up off this spot a few minutes ago.',
    'A little flattened patch in the dirt and a few wisps of fur. Something small was caught here, a while back.',
  ],
  lizard: [
    'A lizard\'s tail lies in the dirt on its own, still twitching. The rest of the lizard went up.',
    'A lizard\'s tail lies in the dirt on its own. The rest of it is somewhere else, and has been for a while.',
  ],
};

export async function searchForKill({ zoneId, zone, margin, success }) {
  if (!success || margin < MARGIN) return null;
  const z = zone || getZone(zoneId);
  if (!z || z.grid_x == null || z.grid_y == null || (z.grid_x === 0 && z.grid_y === 0)) return null;
  if (isBuilt(z)) return null;
  // ⚠ BY DAY ONLY, because the windscreen only draws the hunt while the hawk is up (birdDaylight). The
  // strikes are keyed on the wall clock and the hour is the game's, so this is the nearest honest test.
  if (!birdDaylight('hawk', hourNow())) return null;
  const now = Date.now();
  const weather = getEnvironmentState()?.weatherType || '';
  let best = null;
  for (const h of hawksNear(z, weather)) {
    for (const k of groundKillsSince(h, now, SIGN_MS, preyFor(z, h, now))) {
      if (Math.round(k.x) !== z.grid_x || Math.round(k.y) !== z.grid_y) continue;
      if (!best || k.at > best.at) best = k;
    }
  }
  if (!best) return null;
  const pair = LINES[best.kind] || LINES.vole;
  return { found: true, priority: 150, message: now - best.at < FRESH_MS ? pair[0] : pair[1] };
}

export const hooks = {
  'search.provider': searchForKill,
};

export const _test = { searchForKill, hawksNear, preyFor, LINES, FRESH_MS, SIGN_MS,
  setHour(fn) { hourNow = fn || getGameHour; } };

console.log('[wildsign] Plugin loaded.');

// Coldwater Streets, phases 4 and 5 (docs/proposals/coldwater-streets.md): the metered strip,
// passing vehicles and each street room's text.
//
// ⚠ OFF UNTIL DAVID SAYS. STREET_SYSTEMS=1 in the server's environment turns it on, and it waits for
// RENDER_TUNE.streetKit: nobody should be charged for a street they can't see. Off, the verbs answer
// as if there's nothing here, no room changes and no vehicle goes by.
import { adjustCredits } from '../../server/engine/economy.js';
import { getZone, hasActivePlayers, world } from '../../server/engine/world.js';
import { sendToZone } from '../../server/engine/messaging.js';
import { schedule } from '../../server/engine/scheduler.js';
import { cmdMove } from '../../server/engine/commands/movement.js';
import { surfaceAt, deriveSurfaceCell } from '../flight/state.js';
import { PRICE, offerLine, passingLine, placeOf, roomLine, stripRide } from './rules.js';

let on = process.env.STREET_SYSTEMS === '1';
export const streetSystems = () => on;

const DIRS = { n: 'north', s: 'south', e: 'east', w: 'west', north: 'north', south: 'south', east: 'east', west: 'west' };

// Derived cells, kept by coordinate: kitPlace remembers its answer per cell object, and a street
// doesn't change between deploys.
const cells = new Map();
const at = (x, y) => {
  const k = x + ',' + y;
  if (!cells.has(k)) {
    const c = surfaceAt(x, y);
    cells.set(k, c ? deriveSurfaceCell(c, x, y, surfaceAt, false) : null);
  }
  return cells.get(k);
};
const placeIn = (zone) => (zone?.map_id === 'map_world' && !zone.grid_z && zone.grid_x != null ? placeOf(at, zone.grid_x, zone.grid_y) : null);

const NOT_HERE = { type: 'error', message: 'There\'s nothing like that here.' };

async function cmdBelt(args, raw, player, broadcast) {
  if (!on) return NOT_HERE;
  const dir = DIRS[(args?.[0] || '').toLowerCase()];
  if (!dir) return { type: 'error', message: 'Which way? (belt north, south, east or west)' };
  const ride = stripRide(placeIn(getZone(player.current_zone)), dir);
  if (ride.no === 'none') return NOT_HERE;
  if (ride.no === 'junction') return { type: 'error', message: 'The strips stop at the junction. Walk to the next block.' };
  if (ride.no === 'across') return { type: 'error', message: 'The strip doesn\'t run that way.' };
  if (!(await adjustCredits(player, -PRICE.strip, undefined, 'streets:strip'))) {
    return { type: 'error', message: `The gate wants ₵${PRICE.strip}. You don't have it. The edge of the walkway is free.` };
  }
  let last = null, moved = 0;
  for (let i = 0; i < ride.steps; i++) {
    const r = await cmdMove(dir, player, broadcast);
    if (r?.type === 'error') { if (!moved) last = r; break; }
    last = r; moved++;
  }
  // Blocked before the first step, nobody rode anywhere, so the fare goes back.
  if (!moved) { await adjustCredits(player, PRICE.strip, undefined, 'streets:strip-refund'); return last; }
  const note = ride.running ? `The gate takes ₵${PRICE.strip}. The strip carries you along the block.` : `The gate takes ₵${PRICE.strip}. The strip doesn't move. You walk.`;
  return { ...last, message: `${note}\n${last?.message || ''}` };
}

function describeRoom(zone) {
  if (!on) return undefined;
  const place = placeIn(zone);
  if (!place) return undefined;
  return [roomLine(place, zone.grid_x, zone.grid_y), offerLine(place)].filter(Boolean).join(' ');
}

// About one street in five with somebody on it hears something go by each minute. RAM only.
schedule('1m', () => {
  if (!on || !hasActivePlayers()) return;
  const seen = new Set();
  for (const p of world.players.values()) {
    if (seen.has(p.current_zone)) continue;
    seen.add(p.current_zone);
    const zone = getZone(p.current_zone), place = placeIn(zone);
    if (place && Math.random() < 0.2) sendToZone(zone.id, { type: 'zone_event', message: passingLine(place, Math.random()) });
  }
});

export const commands = { belt: cmdBelt };
export const hooks = { 'zone.describeRoom': describeRoom };
export const _test = { setOn: (v) => { on = !!v; }, placeIn };

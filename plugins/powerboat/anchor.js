// THE ANCHOR: `boat anchor` and `boat anchor up`.
//
// A subverb of `boat` (yard.js), not a verb of its own: `cast` is surveillance's and `haul` is
// trucking's, and a plugin verb silently beats everything else. `conn anchor` on the text helm and
// the seat's anchor key and cleat all come here.
//
// ⚠ THE BOTTOM DECIDES, AND THE SERVER OWNS THE POINT. She has to be stopped, out of gear, off any
// berth, on a hull that carries a rode (`rode_m` on her TYPES row; a hull without one has no
// anchor), and the seabed under her (client/shared/seabed.js, the submersible's own reading) has to
// be within the rode. Then `{ x, y, at }` goes on the RAM rig (and the text helm's record), and on
// the row's `custom_data.anchored`. `cmdBoatSync` clamps any report outside the swing circle back
// onto it (client/shared/boat-anchor.js), so the seat holding her there is a courtesy and not the
// rule. Anchoring cuts the engine: a boat left at anchor drinks nothing.
//
// ⚠ AND A BOAT LEFT AT ANCHOR STAYS THERE. Going over the side leaves `berth_zone` on her water
// tile (adrift.js) and the point on the row; the next helm adopts it only while it's within a tile
// of where she's lying (`anchorFromRow`), so a tow or a move never drags an old anchor along.

import { query } from '../../server/models/db.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { getZone } from '../../server/engine/world.js';
import { TYPES } from '../../client/game/js/panels/flight-model.js';
import { seabedDepth } from '../../client/shared/seabed.js';
import { wildlandsAt } from '../../client/shared/wildlands.js';
import { anchorNear, numberWords } from '../../client/shared/boat-anchor.js';
import { surfaceAt, bounds } from '../flight/state.js';
import { biomeOf } from '../flight/biomes.js';
import { aboard, recoverAboard, berthKind, coveredRoomAtTile, isOpenWater } from './yard.js';
import { livePosition, zoneUnder, STEP_OFF_MPH } from './adrift.js';
import { rigs } from './index.js';
import { conning } from './texthelm.js';

const say = (message) => ({ type: 'output', message });
const dim = (m) => say(`<span class="text-dim">${m}</span>`);

// Land, for the seabed: the submersible's rule (plugins/submersible/index.js `isLandTile`), restated
// rather than imported so neither plugin needs the other. A zone is water by its biome; a gap
// between regions is sea where the Wildlands floor paints it so.
const isWaterZone = (z) => { const bi = biomeOf(z); return bi === 'water' || bi === 'hotspring'; };
const landCache = new Map();
let landFor = null;
export function isLandTile(ix, iy) {
  const b = bounds();
  if (b !== landFor) { landCache.clear(); landFor = b; }
  const k = ix + ',' + iy;
  let v = landCache.get(k);
  if (v === undefined) {
    const s = surfaceAt(ix, iy);
    v = s ? !isWaterZone(getZone(s.id)) : !wildlandsAt(ix, iy).sea;
    if (landCache.size > 20000) landCache.clear();
    landCache.set(k, v);
  }
  return v;
}
/**
 * Metres of water under a boat at (x, y). ⚠ Half a tile added: a boat's tile has its centre on the
 * integer, and seabed.js has tile i spanning [i, i+1) (the submersible's `posOf` makes the same move).
 */
export const depthUnder = (x, y) => seabedDepth(x + 0.5, y + 0.5, isLandTile);

/** The anchor this player's boat is lying to, or null. The text helm's record first, then the rig. */
export function anchorOf(playerId) {
  return conning.get(playerId)?.anchored || rigs.get(playerId)?.anchored || null;
}

function setAnchor(playerId, a) {
  const rig = rigs.get(playerId);
  if (rig) rig.anchored = a;
  const c = conning.get(playerId);
  if (c) c.anchored = a;
}

/** A row's stored anchor, if she's still lying where it went down (see the header), else null. */
export function anchorFromRow(boat) {
  const a = boat?.custom_data?.anchored;
  const z = boat?.berth_zone ? getZone(boat.berth_zone) : null;
  if (!a || !z || !isOpenWater(z)) return null;
  return anchorNear(a, z.grid_x, z.grid_y) ? { x: a.x, y: a.y, at: a.at || Date.now() } : null;
}

/** The SQL that puts `$n` (a jsonb anchor, or null) into `custom_data`, or takes it out. */
export const anchorSql = (n, base = "COALESCE(custom_data, '{}'::jsonb)") =>
  `(CASE WHEN $${n}::jsonb IS NULL THEN ${base} - 'anchored' ELSE jsonb_set(${base}, '{anchored}', $${n}::jsonb, true) END)`;
export const anchorParam = (a) => (a ? JSON.stringify({ x: a.x, y: a.y, at: a.at }) : null);

async function persist(boatId, a) {
  await query(`UPDATE boats SET custom_data = ${anchorSql(2)} WHERE id = $1`, [boatId, anchorParam(a)]).catch(() => {});
}

/** Metres in words for the log: "eleven metres", "less than a metre". */
const metres = (m) => (m < 1 ? 'less than a metre' : numberWords(Math.round(m)) + ' metres');

/**
 * `boat anchor` / `boat anchor up`. `args` is what follows `anchor`.
 * ⚠ THE CHECKS RUN IN THE ORDER A SKIPPER WOULD MEET THEM: is there an anchor, is she stopped, is
 * she somewhere you may anchor, and does the rope reach.
 */
export async function boatAnchor(player, args = []) {
  const word = String(args[0] || '').toLowerCase();
  const up = ['up', 'weigh', 'raise', 'in', 'aweigh'].includes(word);
  const boatId = aboard.get(player.id) || await recoverAboard(player);
  if (!boatId) return dim("You're not in a boat.");
  const at = livePosition(player.id);
  const c = conning.get(player.id);
  const rig = rigs.get(player.id);
  const typeId = c?.typeId || rig?.typeId || null;
  const type = typeId ? TYPES[typeId] : null;
  const down = anchorOf(player.id);

  if (up) {
    if (!down) return dim("The anchor isn't down.");
    setAnchor(player.id, null);
    await persist(boatId, null);
    sendToPlayer(player.id, { type: 'boat_ctx', anchored: null });
    return say("You haul the anchor in hand over hand and drop it in the bow with a fistful of weed. She's drifting.");
  }

  if (!at) return dim("Take her out first. You anchor on open water, not tied up alongside.");
  if (!(Number(type?.rode_m) > 0)) return dim("She doesn't carry an anchor.");
  if (down) return dim("The anchor's already down.");
  if (at.speed >= STEP_OFF_MPH) return dim('Not with way on her. Let her stop first.');
  const pedal = c ? c.s.pedal : rig?.pedal;
  if ((pedal || 0) > 0.08) return dim('Bring the throttle back to idle first.');
  const zone = zoneUnder(at.x, at.y);
  if (zone && (berthKind(zone) || coveredRoomAtTile(zone.id))) {
    return dim("Not on a berth. Tie her up instead: <b>disembark</b>.");
  }
  const depth = depthUnder(at.x, at.y);
  if (!(depth > 0)) return dim("She's on the bottom already. There's nothing to anchor in.");
  if (depth > type.rode_m) {
    return say(`The anchor goes down and keeps going. Nothing at the bottom of ${numberWords(type.rode_m)} metres of rope.`);
  }

  const a = { x: +at.x.toFixed(3), y: +at.y.toFixed(3), at: Date.now() };
  setAnchor(player.id, a);
  await persist(boatId, a);
  // The engine is cut on both rungs: the text helm's record here, the seat by the push. Only the
  // text helm's engine is known here, so only that rung is told it was running.
  const running = c ? c.s.running !== false : false;
  if (c) { c.s.running = false; c.starting = false; c.want.bell = 'stop'; c.want.bottle = false; }
  sendToPlayer(player.id, { type: 'boat_ctx', anchored: a, cut: true });
  return say(`${running ? 'You cut the engine and put' : 'You put'} the anchor over the bow. `
    + `The rope goes slack at ${metres(depth)}, then she drifts back on it and holds.`);
}

export const _test = { isLandTile, depthUnder, anchorOf, setAnchor, anchorFromRow, metres };

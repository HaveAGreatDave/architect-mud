// OVER THE SIDE, AND WHAT IS LEFT FLOATING THERE.
//
// `yard.js` owns where a hull lives between runs and `helm.js` owns the twenty seconds after you
// step down into her. This owns the one thing neither of them could express: **stopping in the
// middle of the Basin**.
//
// Before it, `disembark` at speed cleared the seat, closed the pane and left you standing exactly
// where you had been standing all along — which for a helmsman is the room they embarked from, a
// mile away, indoors. The boat simply stopped existing: `rigs` was dropped, so she vanished from
// every other pilot's windscreen, and `berth_zone` still said she was tied up in a shed she was
// nowhere near. Two rungs of one act were missing and neither said so.
//
// ── ⚠ THE BOAT IS A ROW AND THE WATER IS A ZONE, SO NOTHING NEW IS INVENTED ─
//
// A hull left on the water is `berth_zone` pointing at an ordinary swimmable tile, and that is the
// whole representation. The schema has said so since the line was written (`berth_zone TEXT —
// where she is tied up; null = out on the water`); what was missing was anything that could put
// her there. Everything downstream is then free: `boats` prints where she is, `embark` climbs into
// her because she is a boat of yours in the zone you are standing in, `helm` gets under way
// because `berthGrid` reads any zone's coordinates, and a restart brings her back exactly where
// you left her because the row says where.
//
// ⚠ AND SHE IS DELIBERATELY NOT A `flags.vessel` ZONE. That is the Echelon's arrangement — a boat
// that IS a room, with a deck you walk about on — and it is content, authored in git, one per
// hull. A race boat is a cockpit and a row, there can be any number of them, and minting a zone
// per boat would give the world a second representation of a boat to keep in step with the first.
//
// ── ⚠ AND GOING OVER THE SIDE PUTS YOU IN THE WATER, WHICH IS THE POINT ─────
//
// Not on a pontoon, not back where you started: in the Basin, on her tile, treading. The swimming
// plugin needs to be told nothing at all about boats for that to work — `zone.entered` fires off
// the teleport, it recomputes what you are carrying, and the stamina drain, the wetness, the cold
// and the drowning all arrive on their own. What it DOES need telling is the opposite fact, and
// that is the `swim.afloat` hook: somebody sitting in a boat is not swimming, however wet the tile
// under them is.

import { registerAction, dispatchAction } from '../../server/engine/actions.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { query } from '../../server/models/db.js';
import { getZone, getMinimapData } from '../../server/engine/world.js';
import { describeZone } from '../../server/engine/commands/describe.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { surfaceAt } from '../flight/state.js';
import { TYPES } from '../../client/game/js/panels/flight-model.js';
import { aboard, isOpenWater, berthKind, myBoats, pickBoat, zonesNear } from './yard.js';
import { conning, stopTextHelm } from './texthelm.js';
import { rigs } from './index.js';

const say = (message) => ({ type: 'output', message });
const pct = (v) => Math.max(0, Math.min(100, Math.round((v ?? 0) * 100)));

// ── WHERE SHE IS, RIGHT NOW ──────────────────────────────────────────────────

/**
 * The live position of a boat this player is driving, from whichever rung is driving her.
 *
 * ⚠ BOTH RUNGS OR NEITHER. `rigs` is filled by the panel's sync AND by the text helm's tick — that
 * is this plugin's own stated invariant, because it is the map `vehicle.contacts` publishes — so
 * reading it alone is correct for both today. `conning` is checked as well because the text rung's
 * `c.s` is the authoritative copy on that rung and `rigs` is a projection of it: a helm that had
 * not ticked yet has a `conning` entry and no `rigs` record, and that window is exactly the moment
 * somebody who has thought better of it types `disembark`.
 */
export function livePosition(playerId) {
  const c = conning.get(playerId);
  if (c?.s && Number.isFinite(c.s.x)) return { x: c.s.x, y: c.s.y, speed: Math.abs(c.s.speed || 0), boatId: c.boatId };
  const rig = rigs.get(playerId);
  if (rig && Number.isFinite(rig.x)) return { x: rig.x, y: rig.y, speed: Math.abs(rig.speed || 0), boatId: rig.boatId };
  return null;
}

/** The zone under a point on the water, or null. */
export function zoneUnder(x, y) {
  const cell = surfaceAt(Math.round(x), Math.round(y));
  return cell?.zoneId ? getZone(cell.zoneId) : null;
}

// How much way she may still have on before stepping off the side of her is a thing a person does
// rather than a thing that happens to them. Not zero: the model reports a float and a hull lying
// stopped in a seaway still reports a whisper of it, so an exact test refuses a boat that has
// visibly stopped. The same number, and the same reasoning, as trucking's PARK_STOPPED_MPH.
const STEP_OFF_MPH = 2;

// ── GOING OVER THE SIDE ──────────────────────────────────────────────────────

/**
 * Leave her where she floats and get in the water beside her.
 *
 * Returns null when there is no passage to end — the caller then falls through to the ordinary
 * climb-out in `yard.js`, which is the right answer for somebody sitting in a boat at a pontoon.
 */
export async function overboard(player, broadcast) {
  const at = livePosition(player.id);
  if (!at) return null;                                   // not under way — an ordinary climb-out
  const boatId = aboard.get(player.id);
  if (!boatId) return null;

  if (at.speed > STEP_OFF_MPH) {
    return { type: 'error', message: 'Not at this speed. Shut the throttle and let her come off the plane first.' };
  }
  const here = zoneUnder(at.x, at.y);
  if (!here) {
    return { type: 'error', message: 'There is nothing under you the map has a name for. Get her back over charted water.' };
  }
  // ⚠ A BERTH UNDER HER IS A MOORING, NOT AN ABANDONMENT, and it has to be caught here rather than
  // left to read as one. Coming alongside the fuel float and typing `disembark` is tying up — the
  // tile is a deck you stand on, not water you fall into — so she is berthed and you step off onto
  // it. Without this branch the one manoeuvre the whole system is built around ends with a player
  // treading water on a pontoon.
  const kind = berthKind(here);
  const water = isOpenWater(here);
  if (!kind && !water) {
    return { type: 'error', message: 'She is hard aground. You are not stepping off her here.' };
  }

  // The row, before anything moves. ⚠ FLUSHED RATHER THAN DROPPED: the sync writes the hull and
  // the tank on a ten-second clock and the text tick on its own, so simply clearing the registries
  // loses up to ten seconds of a run — which a player reads as their boat being mysteriously
  // better off than they left her.
  const rig = rigs.get(player.id);
  const c = conning.get(player.id);
  const hull = c ? c.s.hull : rig?.hull;
  const fuel = c ? c.fuel : rig?.fuel;
  const nitro = c ? c.s.nitro : rig?.nitro;
  const heading = c ? c.s.heading : rig?.heading;
  await query(
    `UPDATE boats SET berth_zone = $2,
       condition = COALESCE($3, condition), fuel = COALESCE($4, fuel),
       custom_data = jsonb_set(jsonb_set(COALESCE(custom_data, '{}'::jsonb),
         '{nitro}', to_jsonb(COALESCE($5, (custom_data->>'nitro')::real, 1)::real), true),
         '{heading}', to_jsonb(COALESCE($6, 0)::real), true)
     WHERE id = $1`,
    [boatId, here.id, hull ?? null, fuel ?? null, nitro ?? null, heading ?? null]);

  aboard.delete(player.id);
  stopTextHelm(player.id);
  rigs.delete(player.id);
  sendToPlayer(player.id, { type: 'boat_sim_close' });

  const r = await query('SELECT * FROM boats WHERE id = $1', [boatId]);
  const boat = r.rows[0] || {};
  const name = boat.name || TYPES[boat.type_id]?.name || 'her';

  if (kind) {
    // Alongside. `berth_zone` is set; `home_berth` deliberately is NOT — moving in somewhere is a
    // decision with a fee on it, and tying up at a fuel float for ten minutes is not that.
    return { type: 'emote', message: `You put a line on and step off onto the ${here.name}.\n`
      + `<span class="text-dim">${name} lies here. Hull ${pct(boat.condition)}%, fuel ${pct(boat.fuel)}%.</span>` };
  }

  // And into the water. The teleport is what arms swimming: `zone.entered` does the rest.
  const line = 'You cut the engine, and in the quiet she just sits there rocking. You go over the side. '
    + 'The cold gets into you before the water does.';
  broadcast?.(here.id, { type: 'zone_event', message: `${player.handle} goes over the side of the ${name}.` }, player.id);
  await dispatchAction({ type: 'TELEPORT', actor: player, params: { zone_id: here.id }, context: { broadcast } });
  const zone = getZone(here.id);
  const tail = `\n<span class="text-dim">${name} floats alongside, going nowhere. <b>embark</b> when you want her back.</span>`;
  if (!zone) return { type: 'emote', message: line + tail };
  return {
    type: 'move',
    message: `<span class="text-cyan">${line}</span>${tail}\n${await describeZone(zone, player)}`,
    zone: here.id,
    minimap: getMinimapData(here.id, 8, player),
  };
}

// ── WHAT THE ROOM SAYS ───────────────────────────────────────────────────────
//
// A thing in a place that the room does not mention is a thing nobody will ever find again —
// trucking's own sentence about a dropped trailer, and it is worse here, because the place is a
// square of open water that looks exactly like the four squares around it.
//
// ⚠ GATED ON THE TILE BEFORE ANY QUERY, WHICH IS THE WHOLE COST STORY. `zone.describeRoom` is
// gathered on every look in the game; `isOpenWater` is a resolved-property read out of the render
// map with no await in it, and it is false for all but 932 tiles in the world. So the query below
// runs on a look at open water and nowhere else.
//
// ⚠ AND SOMEBODY ELSE'S HULL IS NAMED AND NOT LINKED. It is still in the room — a 14,500₵ object
// floating in a public bay is a fact about the place, and it is also the whole reason to swim out
// to one — but offering a stranger a button that can only refuse is an affordance that lies. That
// is the parked-truck line's rule, quoted.
export async function describeAdrift(zone, player) {
  if (!isOpenWater(zone)) return undefined;
  const { rows } = await query(
    'SELECT id, name, type_id, owner_id, condition FROM boats WHERE berth_zone = $1 LIMIT 6', [zone.id],
  ).catch(() => ({ rows: [] }));
  if (!rows.length) return undefined;

  const names = rows.map((b) => {
    const label = b.name || TYPES[b.type_id]?.name || 'a boat';
    const low = (b.condition ?? 1) < 0.3 ? ' <span class="text-red">(down by the head)</span>' : '';
    return (player && b.owner_id === player.id
      ? `<span class="action-link" data-action="cmd" data-cmd="embark" title="climb aboard">${label}</span>`
      : `<span class="text-dim">${label}</span>`) + low;
  });
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `<span class="furniture-label">Lying out here:</span> <span class="text-dim">${list}`
    + `${rows.length === 1 ? ', rocking on her own wake long after it should have gone' : ', nose to the weather'}.</span>`;
}

// ── THE TOW ──────────────────────────────────────────────────────────────────
//
// A hull out of fuel in the middle of the Basin is not a hard choice, it is an errand with a known
// answer — the same sentence trucking's recovery is written under, and the same answer: somebody
// will come out for it, for a price that is deliberately worse than getting there yourself.
//
// ⚠ AND SHE COMES HOME WHETHER OR NOT YOU CAN PAY. The fee rides on the row as a debt instead,
// because the alternative is a player with no credits, no fuel and no boat within reach of any
// way to earn either — which is not a difficulty, it is a dead session. `impound_fee` is
// trucking's column for exactly this; `boats` has no such column and does not need one, because
// nothing but this file reads the number and `custom_data` is where this table already keeps the
// things only one reader wants (the bottle, the livery, the heading).

const TOW_CALLOUT = 240;
const TOW_PER_TILE = 3.4;
// ⚠ A RECOVERY CAN NEVER COST MORE THAN A FRACTION OF THE BOAT, and that is a correctness
// invariant rather than a kindness — trucking's own, and it was written there after a measurement
// bug quoted 10,038₵ to fetch a 1,300₵ truck. The distance term below reads coordinates off
// content, and content can always grow a row whose coordinates are not where the thing is.
const TOW_MAX_FRAC = 0.35;

/** Where a zone actually is, for the purpose of sending a boat out to it. */
function towGrid(zoneId) {
  const z = getZone(zoneId);
  if (!z) return null;
  // A covered dock is INDOORS and carries no coordinates of its own — `grid_x` is 0 on every
  // interior in the world, which is not a position, it is the absence of one. The building's tile
  // is the water a launch actually comes to, and `parent_zone` is what names it. Same move, and
  // the same reasoning, as `berthGrid` in helm.js.
  for (const cand of [z, getZone(z.parent_zone)]) {
    if (cand && cand.grid_x != null && cand.grid_y != null && !(cand.grid_x === 0 && cand.grid_y === 0)) {
      return { x: cand.grid_x, y: cand.grid_y };
    }
  }
  return null;
}

export function towFee(typeId, fromZoneId, toZoneId) {
  const a = towGrid(fromZoneId), b = towGrid(toZoneId);
  const tiles = (a && b) ? Math.hypot(a.x - b.x, a.y - b.y) : 30;
  const price = TYPES[typeId]?.price || 14500;
  const fee = Math.round(TOW_CALLOUT + tiles * TOW_PER_TILE);
  return Math.max(1, Math.min(fee, Math.round(price * TOW_MAX_FRAC)));
}

export const recoveryOwed = (boat) => Math.max(0, Math.round(Number(boat?.custom_data?.recovery_fee) || 0));

/**
 * Where a recovered hull is taken.
 *
 * ⚠ HER OWN BERTH, FULL OR NOT. Capacity is a LETTING rule — how many the yard will rent out —
 * and a recovery driver with a boat on the hook is not asking to rent anything; refusing on a
 * count would leave a hull adrift because somebody else moved in while you were out. The
 * over-occupancy self-corrects the next time anybody looks at the board.
 */
function homeOf(boat) {
  const home = boat?.custom_data?.home_berth;
  if (home && getZone(home)) return getZone(home);
  return null;
}

registerAction({
  type: 'BOAT_TOW',
  validate: ({ actor }) => (actor ? null : 'nobody there'),
  // ⚠ `null` IS "NOT MY QUESTION". The router in trucking reads it as permission to answer about
  // trucks, so every refusal that is genuinely about a boat has to be a real reply.
  handler: async ({ actor: player, params = {} }) => {
    const rows = await myBoats(player.id);
    if (!rows.length) return null;

    const seatedId = aboard.get(player.id);
    const pick = seatedId ? { boat: rows.find((b) => b.id === seatedId) } : pickBoat(rows, String(params.want || '').trim());
    // ⚠ WITH NO ARGUMENT AND NOTHING UNDER YOU, THE ONE STRANDED HULL IS THE ONE YOU MEAN. A fleet
    // is small and only a boat lying in open water can be towed at all, so asking "which one" when
    // exactly one of them qualifies is a puzzle rather than a disambiguation.
    let boat = pick?.boat || null;
    if (!boat) {
      const stranded = rows.filter((b) => isOpenWater(getZone(b.berth_zone)) || recoveryOwed(b) > 0);
      if (stranded.length === 1) boat = stranded[0];
      else if (stranded.length > 1) {
        return say(`<span class="text-dim">Which one? ${stranded.map((b) => b.name || TYPES[b.type_id]?.name).join(', ')}.</span>`);
      }
    }
    if (!boat) return null;
    const name = boat.name || TYPES[boat.type_id]?.name || 'she';

    // Settling an old bill. The hull is already home; what is outstanding is the money.
    const owed = recoveryOwed(boat);
    const atHome = !isOpenWater(getZone(boat.berth_zone)) && !seatedId;
    if (owed && atHome) {
      if ((player.credits ?? 0) < owed) {
        return say(`<span class="text-red">₵${owed.toLocaleString()}</span> <span class="text-dim">is still owed on ${name}'s recovery. You have ₵${(player.credits ?? 0).toLocaleString()}.</span>`);
      }
      await adjustCredits(player, -owed, query, 'boat recovery');
      await query(`UPDATE boats SET custom_data = custom_data - 'recovery_fee' WHERE id = $1`, [boat.id]);
      return say(`<span class="text-green">Settled.</span> <span class="text-dim">₵${owed.toLocaleString()}, and they give you the key back without a word about it.</span>`);
    }

    const at = seatedId === boat.id ? livePosition(player.id) : null;
    const fromZone = at ? zoneUnder(at.x, at.y) : getZone(boat.berth_zone);
    if (!fromZone || !isOpenWater(fromZone)) {
      return say(`<span class="text-dim">${name} is not adrift anywhere. Nobody is going to come out and put a rope on a boat that is tied up.</span>`);
    }
    const home = homeOf(boat) || zonesNear(player.current_zone).find(berthKind);
    if (!home) {
      return say(`<span class="text-dim">${name} has no yard to be taken to. Buy her a berth first — a launch has to be given an address.</span>`);
    }

    const fee = towFee(boat.type_id, fromZone.id, home.id);
    const canPay = (player.credits ?? 0) >= fee;

    // The boat comes off the water either way — one statement rather than two branches, because
    // where she ends up is the same and only who holds the debt changes.
    await query(
      `UPDATE boats SET berth_zone = $2,
         custom_data = jsonb_set(COALESCE(custom_data, '{}'::jsonb), '{recovery_fee}',
           to_jsonb((COALESCE((custom_data->>'recovery_fee')::int, 0) + $3)::int), true)
       WHERE id = $1`,
      [boat.id, home.id, canPay ? 0 : fee]);

    // ⚠ THE SEAT GOES WITH HER. Towed out from under a helmsman, `aboard` would still say they are
    // sitting in a boat that is now in a shed on the other side of the bay — and `helm` would
    // cheerfully get under way from it.
    if (seatedId === boat.id) {
      aboard.delete(player.id);
      stopTextHelm(player.id);
      rigs.delete(player.id);
      sendToPlayer(player.id, { type: 'boat_sim_close' });
    }
    if (canPay) await adjustCredits(player, -fee, query, 'boat recovery');

    const ride = seatedId === boat.id
      ? 'They come out in something with a tyre on the bow, take your line without being asked for it, and give you a seat in the wet.'
      : 'They go out for her on the next tide and nobody tells you when.';
    return say(`<span class="text-green">A launch comes out.</span> <span class="text-dim">${ride}</span>\n`
      + `<span class="text-dim">${name} is at ${home.name}. `
      + (canPay
        ? `<span class="item-loss">₵${fee.toLocaleString()}</span>.</span>`
        : `<span class="text-red">₵${fee.toLocaleString()}</span> owed on her before she goes out again — <b>tow</b> again to settle it.</span>`));
  },
});

export const _test = { towFee, recoveryOwed, livePosition, zoneUnder, describeAdrift, STEP_OFF_MPH };

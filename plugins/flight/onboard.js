// WALKING ONTO AN AIRFIELD FOR THE FIRST TIME.
//
// The hangar bay already opens itself on the way in (index.js's `zone.entered`), and that solved
// discovery of the SHOP and nothing else. A first-timer got a 3D floor with four sub-screens on it
// and no sentence anywhere saying that the seat is licence-gated, that the licence is free, or that
// the examiner is standing at Coldwater Regional waiting to hand it over. The commonest way to meet
// the gate was to buy an aircraft and then be refused the seat.
//
// One short briefing, once, the first time you stand on a field. Same three rules as the depot's
// (plugins/trucking/onboard.js), and for the same reasons: it is prose in the LOG so all three
// display rungs get it, every line ends in a verb handed over through `teachVerb`, and it is ONE
// player flag rather than one per field — the second airfield is the same airfield.
//
// It is also STATE-AWARE in the one way that matters: a licensed pilot is told the shop and not the
// school. Telling somebody who already flies to go and learn to fly is how a tutorial teaches
// people to ignore it.
import { on } from '../../server/engine/events.js';
import { getZone } from '../../server/engine/world.js';
import { sendToPlayer, teachVerb } from '../../server/engine/messaging.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { isPilotLicensed } from './checkride.js';

const BRIEF_FLAG = 'air_field_brief';

const isField = (z) => !!(z?.flags?.airfield_id || z?.flags?.hangar_interior);

export async function maybeBriefField(player, zoneId) {
  if (!player) return;
  // Aboard something already? Then this is a landing, not an arrival, and whoever is flying it does
  // not need to be told what an airfield is.
  if (player.aircraftId) return;
  if (!isField(getZone(zoneId))) return;
  const seen = await getFlag('player', BRIEF_FLAG, player).catch(() => null);
  if (seen === '1' || seen === 1 || seen === true) return;
  await setFlag('player', BRIEF_FLAG, '1', player).catch(() => {});

  const rated = await isPilotLicensed(player).catch(() => false);
  sendToPlayer(player.id, {
    type: 'emote',
    message: '<span class="text-green">Somebody in ear defenders waves you off the painted line without breaking stride.</span>'
      + '\n<span class="text-dim">This is an airfield, and there are three things on it:</span>'
      + '\n<span class="text-dim">· ' + teachVerb('hangar', 'hangar') + ' — the bay. Your aircraft up close: buy or rent one, '
      + 'charter a ride with somebody else flying, or put one on the maintenance bench.</span>'
      + '\n<span class="text-dim">· ' + teachVerb('contracts', 'contracts') + ' — the board. Cargo and passengers that need moving, '
      + 'and what they pay.</span>'
      + '\n<span class="text-dim">· ' + teachVerb('embark', 'embark') + " — climb into one. Then it's the throttle, the yoke "
      + 'and the runway; ' + teachVerb('land', 'land') + ' brings you back down.</span>'
      + (rated
        ? '\n<span class="text-dim">You\'re already rated, so the seat is yours. Anything with an empty one will do.</span>'
        : '\n<span class="text-amber">You aren\'t rated, and nobody will let you into the left-hand seat until you are. '
          + teachVerb('checkride', 'checkride') + '</span> <span class="text-dim">takes a free trainer out with an examiner '
          + 'beside you — engine, take-off, a circuit through the rings, and a landing. Nothing to buy, nothing to lose, '
          + 'and a licence at the end of it.</span>'),
  });
}

on('zone.entered', async ({ actor, zone: zoneId }) => {
  try { await maybeBriefField(actor, zoneId); }
  catch (e) { console.error('[flight] field brief:', e.message); }
});

export const _test = { BRIEF_FLAG, isField };

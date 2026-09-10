// WALKING INTO A DEPOT FOR THE FIRST TIME.
//
// The yard already opens itself — the depot panel blows open on `zone.entered` (index.js) — and
// that solved discovery of the SHOP and nothing else. A first-timer got a screen with four tabs, a
// dealer's line and a commodities board on it, and no sentence anywhere saying what any of it was
// for, that a truck is a thing you buy rather than borrow, or that there is a free lesson standing
// in the shed.
//
// So: one short briefing, once, the first time you stand in a yard. Three rules shape it.
//
//  · IT IS PROSE IN THE LOG, not a panel. A tour card would be a fourth surface to maintain and
//    would only exist on the visual rung; the log is the one place all three rungs read
//    (docs/systems-display-mode.md).
//  · IT NAMES VERBS, NOT FEATURES. Every line ends in something you can type, through `teachVerb`
//    so the first mention shimmers and the room-pane link ripples — the house standard for teaching
//    a verb. A briefing that describes a system without handing over its verb is scenery.
//  · AND IT IS ONE FLAG, ONCE. `truck_depot_brief` on the player, so it follows the account rather
//    than the browser and never fires twice. Not a per-depot flag: the second yard is the same
//    yard, and being told again is being nagged.
//
// ⚠ AND IT FIRES INSIDE THE SHED, NOT ON THE STREET. A depot is three tiles — bay, apron, facade —
// and every VERB answers from all three, which is right: you can buy a truck standing on the
// hardstand. The briefing is not a verb. It is somebody in a hi-vis vest pointing at a board on a
// wall, and the wall is inside. Handed `depotFrom` it went off on the public road outside, with the
// panel it describes not open, because that panel auto-opens on the bay alone.
import { on } from '../../server/engine/events.js';
import { getZone } from '../../server/engine/world.js';
import { sendToPlayer, teachVerb } from '../../server/engine/messaging.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';

const BRIEF_FLAG = 'truck_depot_brief';

// Exported so index.js can hand it the same test the PANEL uses — the bay, and only the bay.
export async function maybeBriefDepot(player, zoneId, { depotIn, isDriving }) {
  if (!player) return;
  // Not from the cab. Rolling through a yard on the way somewhere is not arriving at one, and the
  // panel skips a driver for exactly the same reason (index.js) — a briefing over the windscreen
  // would be the one moment it is least wanted.
  if (isDriving?.(player.id)) return;
  const here = depotIn(zoneId);
  if (!here?.depot) return;
  const seen = await getFlag('player', BRIEF_FLAG, player).catch(() => null);
  if (seen === '1' || seen === 1 || seen === true) return;
  await setFlag('player', BRIEF_FLAG, '1', player).catch(() => {});

  const name = here.depot.name || getZone(zoneId)?.name || 'the depot';
  sendToPlayer(player.id, {
    type: 'emote',
    message: '<span class="text-green">Somebody in a hi-vis vest three sizes too big points at the board without looking up. '
      + '"First time? Panel on the wall. Everything in this yard is on it."</span>'
      + '\n<span class="text-dim">' + name + ' is a freight depot, and there are four things in it:</span>'
      + '\n<span class="text-dim">· ' + teachVerb('yard', 'yard') + ' — the dealer\'s line. Trucks are BOUGHT here, not borrowed; '
      + 'the cheapest is under fifteen hundred. Trailers and paint too.</span>'
      + '\n<span class="text-dim">· ' + teachVerb('haul', 'haul') + ' — the freight board. Loads that need moving, and what they pay.</span>'
      + '\n<span class="text-dim">· ' + teachVerb('market', 'market') + ' — what this town is paying for what. Buy low here, sell high there.</span>'
      + '\n<span class="text-dim">· ' + teachVerb('drive', 'drive') + ' — climb into one of yours. '
      + "Then it's the wheel, the gears and the road; " + teachVerb('park', 'park') + ' gets you back out.</span>'
      + '\n<span class="text-amber">Nobody hands over forty tonnes on trust, so you need a licence first — and the school '
      + 'rig in the shed is free. ' + teachVerb('roadtest', 'roadtest') + '</span> <span class="text-dim">takes it out with '
      + 'the foreman talking you through it: out of the yard, some road, back, park. Nothing of yours to lose, and they pay '
      + 'you at the end of it.</span>',
  });
}

// Registered here rather than in index.js's own handler so the briefing is one thing in one file.
// It runs AFTER that handler for the same zone (both are ordinary subscribers on the same event, in
// registration order), which is the order that reads right: the panel opens, then somebody tells
// you what you are looking at.
export function registerDepotBrief({ depotIn, isDriving }) {
  on('zone.entered', async ({ actor, zone: zoneId }) => {
    try { await maybeBriefDepot(actor, zoneId, { depotIn, isDriving }); }
    catch (e) { console.error('[trucking] depot brief:', e.message); }
  });
}

export const _test = { BRIEF_FLAG };

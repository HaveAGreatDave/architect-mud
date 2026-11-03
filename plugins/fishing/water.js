// `look water` FROM A BOAT, and the signs on the surface in the room prose
// (docs/proposals/boat-fishing.md §4 "Signs on the surface", §5 "Typed and text versions").
//
//   · `look water` (also `look sea`, `look over the side`, `examine water`) names up to three
//     schools, nearest first: what the shadow looks like, how far and which way off her, how deep.
//     Then rings where a school is feeding at the top, and a swirl where a runner turns hard.
//   · The room prose (`zone.describeRoom`) gets the rings and the swirl only, one line.
//
// What's seen and the words are water-view.js, which is pure. This file is who's looking: the boat
// they're aboard, asked on the same clock, water and take the bite uses (boat.js), and the env the
// reel was opened on when it's open, so the prose names the fish that can take the lure.
//
// ⚠ AN INPUT MATCHER, NOT A `look` HANDLER. `look` is owned in a chain (flight, then gametable, then
// the engine), and no look or senses hook takes a target. A matcher sees the raw line first and
// returns undefined for anyone not aboard a boat, so a shore player's `look water` is untouched.
//
// ⚠ IN MEMORY. fishNear over 10 tiles is hashes and cached seabed lookups; nothing here queries.

import { daylightOfNight } from '../../client/shared/fish.js';
import { skyAt } from '../../client/shared/sky-keys.js';
import { TYPES } from '../../client/game/js/panels/flight-model.js';
import { aboard } from '../powerboat/yard.js';
import { rigs } from '../powerboat/index.js';
import { conning } from '../powerboat/texthelm.js';
import { livePosition } from '../powerboat/adrift.js';
import { seaNow, seaHabitat, headingOf, boatState } from './boat.js';
import { seaEnv, thinnedNow } from './sea.js';
import { waterView, describeWater, schoolLine, signLines, sideOf, SEEN, MAX_SCHOOLS, RING_M } from './water-view.js';

/**
 * The boat a player is aboard, as `waterView` wants it, or null when they aren't afloat. RAM only.
 * ⚠ THE LAMP IS THE SEAT'S SWITCH (boatsync bit 1). The text helm has no switch, so a hull that
 * carries a lamp has it lit there.
 */
export function lookerOf(player) {
  if (!player || !aboard.has(player.id)) return null;
  const at = livePosition(player.id);
  if (!at) return null;
  const st = boatState(player);
  const t = seaNow();
  const env = st?.env || seaEnv();
  const c = conning.get(player.id), rig = rigs.get(player.id);
  const typeId = c?.typeId || rig?.typeId || null;
  const lamp = !!TYPES[typeId]?.lamp && (c ? true : !!rig?.lamp);
  return {
    x: at.x, y: at.y, heading: headingOf(player.id), now: t, env, habitat: seaHabitat(),
    thinned: st?.thinned || thinnedNow(t), daylight: daylightOfNight(skyAt(env.hour ?? 12).night),
    lamp, anchored: !!(c?.anchored || rig?.anchored), speedMph: at.speed,
  };
}

// The last view `look water` answered from, for the suite.
let lastView = null;

/** The input matcher: `look water` aboard a boat. Undefined for anyone else, so it falls through. */
export function cmdLookWater(args, raw, player) {
  const q = lookerOf(player);
  if (!q) return undefined;
  const view = waterView(q);
  lastView = { q, view };
  return { type: 'examine', message: describeWater(q, view) };
}
export const LOOK_WATER_RE = /^(?:look|examine)\s+(?:(?:at|in|into|over)\s+)?(?:the\s+)?(?:water|sea|surface|side)\s*$/i;

/** `zone.describeRoom`: the rings and the swirl, for somebody aboard a boat that's stopped. */
export function describeWaterRoom(zone, player) {
  const q = lookerOf(player);
  if (!q) return undefined;
  const lines = signLines(q, waterView(q));
  return lines.length ? `<span class="text-dim">${lines.join(' ')}</span>` : undefined;
}

export const _test = { waterView, describeWater, schoolLine, signLines, sideOf, lookerOf, lastView: () => lastView, SEEN, MAX_SCHOOLS, RING_M };

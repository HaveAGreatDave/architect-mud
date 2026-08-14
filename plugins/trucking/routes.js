// THE ROAD'S OWN ANSWER TO "WHERE CAN I GO FROM HERE", IN ONE PLACE.
//
// This module exists because two surfaces now ask that question — the `route` verb, which prints
// it, and the cab's GPS screen, which draws it — and the moment they each worked it out for
// themselves they would disagree. Not hypothetically: the interesting part of the answer is not
// the list of destinations, it is **whether your tank reaches** and **whether the fork is still
// ahead of you**, and both are derived from things that move (a truck's tank changes with its
// tune, the fork passes behind you as you drive). A screen carrying a stale copy of "you can get
// there" is worse than a screen carrying nothing.
//
// So the verb and the HUD read this, and neither computes any of it. That is the same rule the
// preparation workspace runs on: the HUD proposes, the verb decides — and here they are literally
// proposing and deciding off one function.
//
// It lives in its own file rather than in index.js because `state.js` (which builds the cab
// payload) is imported BY index.js, so a helper in index.js could not reach the cab without a
// cycle. Nothing here imports either of them.

// ⚠ THIS MODULE IMPORTS NOTHING FROM state.js, DELIBERATELY. state.js builds the cab payload and so
// has to import THIS, and a cycle between the two is exactly the load-order tangle the plugin loader
// punishes (see the same note in resume.js). So the two facts that live over there — which zone you
// are standing in, and whether the fork is still ahead — are passed IN by the caller. Both callers
// pass them from the same single implementations, so nothing is duplicated by doing it this way.
import { getZone } from '../../server/engine/world.js';
import { crossingInfo, VOIDS } from '../voidwalking/index.js';
import { TILES_PER_ROOM } from './corridor.js';

// Which destination a rig is CURRENTLY pointed at. A contracted load outranks the aim, because a
// run knows where it is going and asking twice would be ceremony.
export function aimedDest(info, rig) {
  const dests = info?.dests || [];
  if (!dests.length) return null;
  if (rig?.cargo?.to) {
    const zone = getZone(rig.cargo.to);
    const region = zone?.flags?.region_id;
    const byLoad = region && dests.find((d) => d.region === region);
    if (byLoad) return byLoad;
  }
  return dests.find((d) => d.key === rig?.aim) || null;
}

// Match what somebody typed against a void's destination table — by key, by the heading it is
// named for, or by a prefix of either. The same shape voidwalking's own `destByHeading` uses,
// because a driver and a walker should not have to learn two ways to name the same fork.
export function destByWord(dests, word) {
  const w = String(word || '').trim().toLowerCase();
  if (!w) return null;
  return dests.find((d) => d.key.toLowerCase() === w || d.heading.toLowerCase() === w)
    || dests.find((d) => d.key.toLowerCase().startsWith(w) || d.heading.toLowerCase().startsWith(w))
    || dests.find((d) => d.heading.toLowerCase().includes(w)) || null;
}

// The whole answer, for whoever is asking.
//
// `reach` is a THREE-STATE and not a boolean on purpose: "further than your tank one way" is a run
// you can absolutely make if you are willing to arrive dry or to have thought about fuel, and
// collapsing it into "no" would turn a judgement call into a locked door. The verb prints those
// three as three different sentences; the screen paints them as three colours.
//
//   { origin, dests: [{ key, heading, tiles, reach: 'ok'|'thin'|'far', current }], forkAhead, onRoad }
//
// `forkAhead` is the one fact that makes the difference between a live choice and a read-only
// display, and it is deliberately reported rather than acted on — a caller that hides the list
// once the fork is behind you is hiding the reason, and the reason is the interesting part.
export function routeOptions(rig, { zoneId = null, forkAhead = true } = {}) {
  if (!rig) return null;
  const onRoad = rig.leg === 'corridor';
  const info = onRoad && rig.instanceId ? crossingInfo(rig.instanceId) : null;
  const here = getZone(zoneId);
  const vdef = onRoad ? null : VOIDS[here?.flags?.region_id];
  const dests = info?.dests || vdef?.dests || [];
  if (!dests.length) return null;

  const current = onRoad ? dests.find((d) => d.key === rig.destKey) : aimedDest({ dests }, rig);
  const tank = rig.params?.tank || rig.type?.tank || 0;
  return {
    origin: info?.origin || vdef?.origin || null,
    onRoad,
    // In a yard the fork has not been reached, let alone passed, so the choice is always live.
    forkAhead: onRoad ? !!forkAhead : true,
    dests: dests.map((d) => {
      const tiles = (d.length || 0) * TILES_PER_ROOM;
      return {
        key: d.key,
        heading: d.heading,
        tiles,
        reach: !tank ? 'ok' : tiles <= tank ? 'ok' : tiles <= tank * 2 ? 'thin' : 'far',
        current: d.key === current?.key,
      };
    }),
  };
}

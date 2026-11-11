// What an NPC is doing right now, read off the state the behaviour graph already keeps.
//
// One reader so that anything which says what somebody is up to (the smalltalk plugin's
// "What are you up to?") agrees with what they then go and do. Nothing is stored for it:
// the answer is worked out from the blackboard (`_ai`), the schedule and where they stand.
//
// Sync and query-free, like isNpcAtWork under it, so it's safe on a dialogue render.
//
// → { kind, work, nextShift, place?, haunt? }
//   kind       'asleep' | 'banking' | 'working' | 'to_work' | 'at_home' | 'heading_home' | 'out' | 'idle'
//   work       where they work, as a name a person would say, or null
//   nextShift  "about 3 hours" until they're next on, or '' (on shift now, or no job)
//   place      for 'out': the name of where they're walking to, or null
//   haunt      for 'out': true when that place is one of their `flags.haunt_zone(s)`

import { getZone, resolveLanding, buildingNameOf } from './world.js';
import { getEnvironmentState } from './environment.js';
import { isNpcScheduledNow, getNpcStudioZone, npcNextShiftInMins } from './broadcast-bridge.js';
import { isNpcAtWork, isNpcAsleep, isVendorWorkTime, openInPhrase } from './ai-behaviour.js';

const atZone = (here, zoneId) => !!zoneId && (here === zoneId || here === resolveLanding(zoneId));

// A name for a zone that makes sense said aloud. A room inside a building is called by the
// building ("the window" and "VIP" are room names, not places you'd say you work at).
function placeName(zoneId) {
  const z = getZone(zoneId);
  if (!z) return null;
  return buildingNameOf(z) || z.flags?.building_name || (z.map_id === 'map_world' ? z.name : null) || null;
}

function aboutMinutes(mins) {
  if (!(mins > 0)) return '';
  if (mins < 60) { const m = Math.max(1, Math.round(mins)); return `about ${m} minute${m === 1 ? '' : 's'}`; }
  const h = Math.round(mins / 60);
  return `about ${h} hour${h === 1 ? '' : 's'}`;
}

export function npcDoingNow(npc) {
  if (!npc) return { kind: 'idle', work: null, nextShift: '' };
  const ai = npc._ai || {};
  const here = npc.zoneId ?? npc.zone_id;
  const studio = npc.studio_zone_id || getNpcStudioZone(npc.id) || null;
  const workZone = studio || npc.work_zone_id || null;
  const hasSchedule = !!npc.vendor_schedule && Object.keys(npc.vendor_schedule).length > 0;

  const base = {
    work: npc.vendor_shop_name || placeName(workZone),
    nextShift: studio ? aboutMinutes(npcNextShiftInMins(npc.id)) : openInPhrase(npc),
  };

  if (isNpcAsleep(npc)) return { kind: 'asleep', ...base };
  // Carrying the day's takings to the bank (VENDOR_COLLECT_SAFE → VENDOR_DEPOSIT).
  if ((ai.vendor_carrying || 0) > 0) return { kind: 'banking', ...base };
  if (isNpcAtWork(npc)) return { kind: 'working', ...base };

  const onShift = studio
    ? !!isNpcScheduledNow(npc.id)
    : hasSchedule && !!isVendorWorkTime(npc, getEnvironmentState()).working;
  if (onShift && workZone && !atZone(here, workZone)) return { kind: 'to_work', ...base };

  const home = npc.home_zone || null;
  if (atZone(here, home)) return { kind: 'at_home', ...base };

  // GO_HOME and HAVE_LIFE both walk a `patrolTarget`; a target they're standing on is a finished walk.
  const target = ai.patrolTarget && ai.patrolTarget !== here ? ai.patrolTarget : null;
  if (home && (atZone(target, home) || ai._lifeActivity === 'home')) return { kind: 'heading_home', ...base };
  if (target) {
    const haunts = Array.isArray(npc.flags?.haunt_zones) ? npc.flags.haunt_zones : [npc.flags?.haunt_zone];
    return { kind: 'out', place: placeName(target), haunt: haunts.includes(target), ...base };
  }
  return { kind: 'idle', ...base };
}

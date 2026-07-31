// Thin bridge so AI conditions can query broadcast state without circular imports.
// Populated by the broadcast plugin at startup via registerXxx().
let _viewerChecker = null;
export function registerViewerChecker(fn) { _viewerChecker = fn; }
export function hasChannelViewers(channelId) { return _viewerChecker ? _viewerChecker(channelId) : false; }

let _npcScheduleChecker = null;
export function registerNpcScheduleChecker(fn) { _npcScheduleChecker = fn; }
export function isNpcScheduledNow(npcId) { return _npcScheduleChecker ? _npcScheduleChecker(npcId) : false; }

// How many GAME minutes until this NPC's next scheduled slot begins, or null if
// they have no upcoming shift (or aren't staffed on anything). Returns 0 while a
// shift is already running.
//
// Game minutes, not real ones: the broadcast timetable is keyed to the in-game
// clock, so anything reasoning about "two hours before the show" has to be on the
// same clock or it drifts with the time scale.
let _npcNextShiftLookup = null;
export function registerNpcNextShiftLookup(fn) { _npcNextShiftLookup = fn; }
export function npcNextShiftInMins(npcId) {
  return _npcNextShiftLookup ? _npcNextShiftLookup(npcId) : null;
}

let _npcStudioZoneLookup = null;
export function registerNpcStudioZoneLookup(fn) { _npcStudioZoneLookup = fn; }
export function getNpcStudioZone(npcId) { return _npcStudioZoneLookup ? _npcStudioZoneLookup(npcId) : null; }

let _zoneWatchedChecker = null;
export function registerZoneWatchedChecker(fn) { _zoneWatchedChecker = fn; }
export function isZoneWatched(zoneId) { return _zoneWatchedChecker ? _zoneWatchedChecker(zoneId) : false; }

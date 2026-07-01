// Thin bridge so AI conditions can query broadcast state without circular imports.
// Populated by the broadcast plugin at startup via registerXxx().
let _viewerChecker = null;
export function registerViewerChecker(fn) { _viewerChecker = fn; }
export function hasChannelViewers(channelId) { return _viewerChecker ? _viewerChecker(channelId) : false; }

let _npcScheduleChecker = null;
export function registerNpcScheduleChecker(fn) { _npcScheduleChecker = fn; }
export function isNpcScheduledNow(npcId) { return _npcScheduleChecker ? _npcScheduleChecker(npcId) : false; }

let _npcStudioZoneLookup = null;
export function registerNpcStudioZoneLookup(fn) { _npcStudioZoneLookup = fn; }
export function getNpcStudioZone(npcId) { return _npcStudioZoneLookup ? _npcStudioZoneLookup(npcId) : null; }

let _zoneWatchedChecker = null;
export function registerZoneWatchedChecker(fn) { _zoneWatchedChecker = fn; }
export function isZoneWatched(zoneId) { return _zoneWatchedChecker ? _zoneWatchedChecker(zoneId) : false; }

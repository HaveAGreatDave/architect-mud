// LAZY 3-D VIEWS. The cockpit, cab, boat, truck depot, hangar bay and spray can
// all pull in GLASS (windshield.js), about 12 MB raw and 3 MB brotli of the
// 4 MB the game used to download at boot, for views most sessions never open.
// Core files (dispatch, input, main) import from here instead, under the same
// names, and the real module is fetched the first time it's needed.
//
// Two kinds of export:
//   open/update/telemetry  load the module, then call. Calls made while it's
//                          loading chain on one promise, so they keep their order.
//   isXActive / close*     answer from the module only if it's loaded. A view
//                          that was never loaded can't be open, so false (or a
//                          no-op) is the right answer, and a status check never
//                          triggers a 5 MB download.
//
// ⚠ Don't add a static import of a heavy view to a core file. It pulls the view
// and everything under it back into the boot graph, and the server preloads the
// whole static graph (server/modulegraph.js). Import it from here.

import { recordQuestLog } from './quest-log.js';

// A view with GLASS in its static graph has already fetched windshield.js by the
// time it resolves, so this import is a module-map hit, not a download. It hands
// GLASS the bird season and weather environment.js has been keeping.
function wireGlass() {
  Promise.all([import('./windshield.js'), import('./environment.js')])
    .then(([glass, env]) => env.wireGlass(glass)).catch(() => {});
}

function lazy(name, loader, { glass = true } = {}) {
  let mod = null, pending = null;
  return {
    get: () => mod,
    pending: () => (mod ? null : pending),
    load: () => (pending ??= loader().then((m) => { mod = m; if (glass) wireGlass(); return m; }).catch((e) => {
      pending = null;   // let the next call retry
      console.error(`[lazy-views] ${name} failed to load:`, e);
      throw e;
    })),
  };
}

const call = (L, fn) => (...args) => {
  const m = L.get();
  if (m) return m[fn](...args);
  L.load().then((mm) => mm[fn](...args)).catch(() => {});
};
// ⚠ While the module is still LOADING, the call is queued behind the load
// rather than dropped: a close (or a helm/freelook update) that arrives between
// an open and the module landing has to run after that open, or the view opens
// anyway. It is a no-op only when nothing has asked for the module at all. The
// caller gets the fallback either way, since the answer isn't known yet.
const ifLoaded = (L, fn, fallback) => (...args) => {
  const m = L.get();
  if (m) return m[fn](...args);
  const p = L.pending();
  if (p) p.then((mm) => mm[fn](...args)).catch(() => {});
  return fallback;
};

const cockpit = lazy('cockpit', () => import('./cockpit.js'));
const cab = lazy('cab-view', () => import('./cab-view.js'));
const boat = lazy('boat-view', () => import('./boat-view.js'));
const depot = lazy('truck-depot', () => import('./truck-depot.js'));
const spray = lazy('spraycan', () => import('./spraycan.js'));
// hangar-bay reaches GLASS through windshield-lazy.js, only when a view opens, so
// wiring on its load would fetch the renderer for a menu. It stays unwired.
const hangar = lazy('hangar-bay', () => import('./hangar-bay.js'), { glass: false });

// cockpit.js
export const isFlightSimActive = ifLoaded(cockpit, 'isFlightSimActive', false);
export const isCockpitHudActive = ifLoaded(cockpit, 'isCockpitHudActive', false);
export const closeCockpit = ifLoaded(cockpit, 'closeCockpit');
// Everything below that is ifLoaded only feeds an OPEN view (each returns at once// with no view), so none of it may download one. Only updateCockpit, openTargeting// and the open* calls mount something, so only they load. Checked against each// function's first line; add a new feed as ifLoaded unless it opens a view.
export const updateCockpit = call(cockpit, 'updateCockpit');
// Sent to walkable-cabin passengers whose HUD never opens, every flight tick, so
// it must not download the cockpit (about 3 MB with GLASS). With the cockpit
// loaded, its own cabinAudio checks the pilot's view isn't already driving the
// bus; without it, no cockpit view can be open, so engine audio (28 KB) plays it.
export function cabinAudio(s) {
  const c = cockpit.get() || null;
  if (c) return c.cabinAudio(s);
  engineAudio.load().then((m) => m.playCabinAudio(s)).catch(() => {});
}
export const openTargeting = call(cockpit, 'openTargeting');
export const openFlightSim = call(cockpit, 'openFlightSim');
export const flightSimContext = ifLoaded(cockpit, 'flightSimContext');
export const drakeSubmerged = ifLoaded(cockpit, 'drakeSubmerged');
export const flightBurst = ifLoaded(cockpit, 'flightBurst');
export const flightSimContacts = ifLoaded(cockpit, 'flightSimContacts');
export const flightSimAASites = ifLoaded(cockpit, 'flightSimAASites');
export const flightSimHopper = ifLoaded(cockpit, 'flightSimHopper');
export const flightSimAirHit = ifLoaded(cockpit, 'flightSimAirHit');
export const flightSimKill = ifLoaded(cockpit, 'flightSimKill');
export const flightSimAaTracer = ifLoaded(cockpit, 'flightSimAaTracer');
export const flightSimAirThreat = ifLoaded(cockpit, 'flightSimAirThreat');
export const flightSimFireworks = ifLoaded(cockpit, 'flightSimFireworks');   // sent to every airborne occupant
export const flightSimLightning = ifLoaded(cockpit, 'flightSimLightning');   // sent to every airborne occupant, passengers included

// cab-view.js
export const isCabActive = ifLoaded(cab, 'isCabActive', false);
export const closeCab = ifLoaded(cab, 'closeCab');
export const openCab = call(cab, 'openCab');
export const cabContext = ifLoaded(cab, 'cabContext');
export const cabGalley = ifLoaded(cab, 'cabGalley');

// boat-view.js
export const isBoatActive = ifLoaded(boat, 'isBoatActive', false);
export const closeBoat = ifLoaded(boat, 'closeBoat');
export const openBoat = call(boat, 'openBoat');
export const boatSetWorld = ifLoaded(boat, 'boatSetWorld');   // boat_fuel arrives on every refuel, text rung included; a no-op with no boat view open

// truck-depot.js
export const isTruckDepotActive = ifLoaded(depot, 'isTruckDepotActive', false);
export const closeTruckDepot = ifLoaded(depot, 'closeTruckDepot');
export const closeBayService = ifLoaded(depot, 'closeBayService');
export const openTruckDepot = call(depot, 'openTruckDepot');

// spraycan.js
export const openSprayCan = call(spray, 'openSprayCan');
export const updateSprayShelf = call(spray, 'updateSprayShelf');

// hangar-bay.js
export const isHangarBayActive = ifLoaded(hangar, 'isHangarBayActive', false);
export const isHangarBayWalkActive = ifLoaded(hangar, 'isHangarBayWalkActive', false);
export const closeHangarBay = ifLoaded(hangar, 'closeHangarBay');
export const openHangarBay = call(hangar, 'openHangarBay');
export const openCharterScreen = call(hangar, 'openCharterScreen');

// helm-mode.js (the Echelon chase view, via helm-view.js). Every helmSet* is a
// no-op until a helm is open, so they only run once the module is loaded.
const helm = lazy('helm-mode', () => import('./helm-mode.js'));
export const isHelmActive = ifLoaded(helm, 'isHelmActive', false);
export const closeHelm = ifLoaded(helm, 'closeHelm');
export const helmSetSky = ifLoaded(helm, 'helmSetSky');
export const helmSetWorld = ifLoaded(helm, 'helmSetWorld');
export const helmSetContacts = ifLoaded(helm, 'helmSetContacts');
export const helmEndTransit = ifLoaded(helm, 'helmEndTransit');
export const helmBeginTransit = ifLoaded(helm, 'helmBeginTransit');
export const openHelm = call(helm, 'openHelm');

// marina-panel.js (the berth, with a boat preview from boat-view.js).
const marina = lazy('marina-panel', () => import('./marina-panel.js'));
export const isMarinaActive = ifLoaded(marina, 'isMarinaActive', false);
export const closeMarina = ifLoaded(marina, 'closeMarina');
export const closeMarinaService = ifLoaded(marina, 'closeMarinaService');
export const marinaSetData = call(marina, 'marinaSetData');   // opens the marina when none is open
export const openMarina = call(marina, 'openMarina');
export const openMarinaService = call(marina, 'openMarinaService');

// tablet-os.js (894 KB raw). Quest lines are recorded in quest-log.js whether or
// not the tablet is loaded; the tablet only hears about them to refresh a screen.
const tablet = lazy('tablet-os', () => import('./tablet-os.js'), { glass: false });
export const closeTabletPanel = ifLoaded(tablet, 'closeTabletPanel');
export const tabletQuestUpdate = ifLoaded(tablet, 'tabletQuestUpdate');
export const refreshTabletGearIfOpen = ifLoaded(tablet, 'refreshTabletGearIfOpen', false);
export const refreshTabletMapIfOpen = ifLoaded(tablet, 'refreshTabletMapIfOpen', false);
export const getTabletInventory = () => tablet.get()?.getTabletInventory() ?? [];
export const openTabletPanel = call(tablet, 'openTabletPanel');
export const openTabletToSpecter = call(tablet, 'openTabletToSpecter');
export const openTabletToReel = call(tablet, 'openTabletToReel');
export const openTabletSpecterInstall = call(tablet, 'openTabletSpecterInstall');
export const openTabletToMap = call(tablet, 'openTabletToMap');
export const openTabletTvPanel = call(tablet, 'openTabletTvPanel');
export const openTabletToBinder = call(tablet, 'openTabletToBinder');
export function noteQuestLog(msg) {
  if (recordQuestLog(msg)) tablet.get()?.questLogChanged(msg.quest_id);
}

// Smaller views that core files used to import statically. None of them has
// GLASS in its static graph, so none wires it.
const freelook = lazy('freelook-view', () => import('./freelook-view.js'), { glass: false });
export const isFreelookActive = ifLoaded(freelook, 'isFreelookActive', false);
export const closeFreelook = ifLoaded(freelook, 'closeFreelook');
export const freelookSetSky = ifLoaded(freelook, 'freelookSetSky');
export const freelookSetActors = ifLoaded(freelook, 'freelookSetActors');
export const openFreelook = call(freelook, 'openFreelook');

const chess3d = lazy('chess3d', () => import('./chess3d.js'), { glass: false });
export const mountChess3D = call(chess3d, 'mountChess3D');

const intro = lazy('intro-cinematic', () => import('./intro-cinematic.js'), { glass: false });
export const playIntroCinematic = call(intro, 'playIntroCinematic');

const splice = lazy('splicelab', () => import('./splicelab.js'), { glass: false });
export const applySplicePreview = ifLoaded(splice, 'applySplicePreview');
export const openSpliceSelect = call(splice, 'openSpliceSelect');
export const openSpliceStages = call(splice, 'openSpliceStages');

const engineAudio = lazy('engine-audio', () => import('./engine-audio.js'), { glass: false });
export const stopEngineAudio = ifLoaded(engineAudio, 'stopEngineAudio');
export const airHorn = call(engineAudio, 'airHorn');

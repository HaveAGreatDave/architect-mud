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
import { loadClassicScript } from '../classic-script.js';

// A view with GLASS in its static graph has already fetched windshield.js by the
// time it resolves, so this import is a module-map hit, not a download. It hands
// GLASS the bird season and weather environment.js has been keeping.
function wireGlass() {
  Promise.all([import('./windshield.js'), import('./environment.js')])
    .then(([glass, env]) => env.wireGlass(glass)).catch(() => {});
}

// ⚠ Only gl/install.js turns on GLASS's GL pass. cockpit.js runs it on import, and
// while the cockpit was in the boot graph that covered every seat. Lazy, a boat, cab
// or depot opened before any cockpit ran on the 2-D renderer, and the 3-D interior
// only draws in GL, so the helm came up with no cockpit at all. It's awaited before
// the view opens, so the first frame is already GL. If the install fails the view
// stays on the 2-D renderer, as it does in windshield-lazy.js.
let glInstall = null;
function installGlass() {
  return (glInstall ??= import('./gl/install.js')
    .then((g) => { g.installGL(); })
    .catch((e) => console.error('[lazy-views] GL install failed, staying on the 2-D renderer:', e?.message)));
}

function lazy(name, loader, { glass = true } = {}) {
  let mod = null, pending = null;
  return {
    get: () => mod,
    pending: () => (mod ? null : pending),
    load: () => (pending ??= loader().then(async (m) => { if (glass) { await installGlass(); wireGlass(); } mod = m; return m; }).catch((e) => {
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
const podracer = lazy('podracer-view', () => import('./podracer-view.js'));
const podDepot = lazy('podracer-depot', () => import('./podracer-depot.js'));
const depot = lazy('truck-depot', () => import('./truck-depot.js'));
const spray = lazy('spraycan', () => import('./spraycan.js'));
// hangar-bay reaches GLASS through windshield-lazy.js, only when a view opens, so
// wiring on its load would fetch the renderer for a menu. It stays unwired.
const hangar = lazy('hangar-bay', () => import('./hangar-bay.js'), { glass: false });

// cockpit.js
export const isFlightSimActive = ifLoaded(cockpit, 'isFlightSimActive', false);
export const resumeFlightAfterLogin = ifLoaded(cockpit, 'resumeFlightAfterLogin');
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
export const flightSimGps = ifLoaded(cockpit, 'flightSimGps');
export const drakeSubmerged = ifLoaded(cockpit, 'drakeSubmerged');
export const drakeChampagne = ifLoaded(cockpit, 'drakeChampagne');
export const flightBurst = ifLoaded(cockpit, 'flightBurst');
export const flightSimContacts = ifLoaded(cockpit, 'flightSimContacts');
export const flightSimHopper = ifLoaded(cockpit, 'flightSimHopper');
export const flightSimAirHit = ifLoaded(cockpit, 'flightSimAirHit');
export const flightSimKill = ifLoaded(cockpit, 'flightSimKill');
export const flightSimAaTracer = ifLoaded(cockpit, 'flightSimAaTracer');
export const flightSimAirThreat = ifLoaded(cockpit, 'flightSimAirThreat');
export const flightSimFireworks = ifLoaded(cockpit, 'flightSimFireworks');   // the boom, for an airborne occupant; the burst itself is world-feed.js
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

// podracer-view.js
export const isPodracerActive = ifLoaded(podracer, 'isPodracerActive', false);
export const closePodracer = ifLoaded(podracer, 'closePodracer');
export const openPodracer = call(podracer, 'openPodracer');
export const podracerSetWorld = ifLoaded(podracer, 'podracerSetWorld');

// podracer-depot.js (the racer bay's counter, and its overlay on the seat)
export const isPodracerDepotActive = ifLoaded(podDepot, 'isPodracerDepotActive', false);
export const openPodracerDepot = call(podDepot, 'openPodracerDepot');
export const closePodracerDepot = ifLoaded(podDepot, 'closePodracerDepot');
export const closePodracerBay = ifLoaded(podDepot, 'closePodracerBay');

// truck-depot.js
export const isTruckDepotActive = ifLoaded(depot, 'isTruckDepotActive', false);
export const closeTruckDepot = ifLoaded(depot, 'closeTruckDepot');
export const closeBayService = ifLoaded(depot, 'closeBayService');
export const openTruckDepot = call(depot, 'openTruckDepot');

// spraycan.js
export const openSprayCan = call(spray, 'openSprayCan');
export const updateSprayShelf = ifLoaded(spray, 'updateSprayShelf');   // returns at once with no spray view open

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
export const helmSetFar = ifLoaded(helm, 'helmSetFar');
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
// ⚠ The tablet imports tv.js and musicplayer.js itself, so it settles both wrappers below
// before it resolves. Without that its TV app's view would sit in a tv.js the wrapper had
// never seen (tvViewsForChannel would answer [] and the app would never get a broadcast),
// and its music app would open with none of the player's unlocks.
const tablet = lazy('tablet-os', () => import('./tablet-os.js').then(async (m) => {
  await Promise.all([tv.load(), music.load()]);
  return m;
}), { glass: false });
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
export const freelookSetContacts = ifLoaded(freelook, 'freelookSetContacts');
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

// ── ACTIVITY PANELS ─────────────────────────────────────────────────────────────
//
// The minigames, the machines and the furniture panels: each one opens because the
// player did something, so none belongs in the boot graph. About a megabyte of source
// came off it with these. None has GLASS under it.
//
// ⚠ IF A MODULE IS ALSO REACHED SOME OTHER WAY, ITS FEEDS ARE call, NOT ifLoaded. A
// text rung imports its board (textfishing.js → fishing.js), the cab imports the CB
// radio, the tablet imports tv.js and the music player. A module that arrived that way
// is live, but its wrapper here still reads as never loaded, so ifLoaded would drop a
// feed it needed. call() gets the same instance from the module map.
const panel = (name, loader) => lazy(name, loader, { glass: false });

// A text rung's open answers whether it could open, and when it can't the caller falls
// back UP to the graphical board, because a rung with no implementation is never a dead
// end. Lazy, that answer comes later, so the fallback is handed in. A rung that fails to
// load, or throws opening, falls back the same way.
const openOr = (L, fn) => (args, fallback) => {
  L.load().then((m) => m[fn](args)).then((ok) => { if (!ok) fallback(); }, (e) => {
    console.error(`[lazy-views] ${fn} failed, opening the graphical board:`, e);
    fallback();
  });
};

// The text rungs. Each is active only once loaded, so its keyboard command and its
// is-active guard answer false until then, synchronously, as main.js and
// paneFreeForRoom need.
const tBreach = panel('textbreach', () => import('./textbreach.js'));
const tNull = panel('textnullboard', () => import('./textnullboard.js'));
const tCal = panel('textcalibration', () => import('./textcalibration.js'));
const tHolo = panel('texthololock', () => import('./texthololock.js'));
const tVault = panel('textvault', () => import('./textvault.js'));
const tDemo = panel('textdemolition', () => import('./textdemolition.js'));
const tSignal = panel('textsignal', () => import('./textsignal.js'));
const tFish = panel('textfishing', () => import('./textfishing.js'));
// The log rung's hololock. It writes to the log and draws nothing, so it needs
// no is-active guard in paneFreeForRoom, only a place in TEXT_RUNGS for its words.
const tLogHolo = panel('loghololock', () => import('./loghololock.js'));
export const openLogHololock = openOr(tLogHolo, 'openLogHololock');
export const openTextBreach = openOr(tBreach, 'openTextBreach');
export const openTextNullBoard = openOr(tNull, 'openTextNullBoard');
export const openTextCalibration = openOr(tCal, 'openTextCalibration');
export const openTextHololock = openOr(tHolo, 'openTextHololock');
export const openTextVault = openOr(tVault, 'openTextVault');
export const openTextBombRig = openOr(tDemo, 'openTextBombRig');
export const openTextBombDefuse = openOr(tDemo, 'openTextBombDefuse');
export const openTextSignal = openOr(tSignal, 'openTextSignal');
export const openTextFishing = openOr(tFish, 'openTextFishing');
export const isTextBreachActive = () => !!tBreach.get()?.isTextBreachActive();
export const isTextNullActive = () => !!tNull.get()?.isTextNullActive();
export const isTextCalibrationActive = () => !!tCal.get()?.isTextCalibrationActive();
export const isTextHololockActive = () => !!tHolo.get()?.isTextHololockActive();
export const isTextVaultActive = () => !!tVault.get()?.isTextVaultActive();
export const isTextDemolitionActive = () => !!tDemo.get()?.isTextDemolitionActive();
export const isTextSignalActive = () => !!tSignal.get()?.isTextSignalActive();
export const isTextFishingActive = () => !!tFish.get()?.isTextFishingActive();
// One handler for main.js's setMinigameCommandHandler: the first loaded rung that takes
// the word. Order as it was when main.js chained them.
const TEXT_RUNGS = [tBreach, tHolo, tLogHolo, tVault, tSignal, tFish, tCal, tNull, tDemo];
export function textRungCommand(word) {
  for (const L of TEXT_RUNGS) if (L.get()?.command(word)) return true;
  return false;
}

// The graphical boards.
const circuit = panel('circuithack', () => import('./circuithack.js'));
const nullBoard = panel('nullboard', () => import('./nullboard.js'));
const calib = panel('calibration', () => import('./calibration.js'));
const holo = panel('hololock', () => import('./hololock.js'));
const signal = panel('signalhijack', () => import('./signalhijack.js'));
const vault = panel('vaultcrack', () => import('./vaultcrack.js'));
const demo = panel('demolition', () => import('./demolition.js'));
const fishing = panel('fishing', () => import('./fishing.js'));
const synth = panel('synthlab', () => import('./synthlab.js'));
export const openCircuitHack = call(circuit, 'openCircuitHack');
export const openNullBoard = call(nullBoard, 'openNullBoard');
export const openCalibration = call(calib, 'openCalibration');
export const openHololock = call(holo, 'openHololock');
export const openSignalHijack = call(signal, 'openSignalHijack');
export const openVaultCrack = call(vault, 'openVaultCrack');
export const openBombRig = call(demo, 'openBombRig');
export const openBombDefuse = call(demo, 'openBombDefuse');
export const openFishing = call(fishing, 'openFishing');
export const armFishFight = call(fishing, 'armFishFight');   // the text rung's fish is in fishing.js too
export const openSynthMinigame = call(synth, 'openSynthMinigame');
export const openCookMenu = call(synth, 'openCookMenu');

// The casino and the card machines.
const cardpack = panel('cardpack', () => import('./cardpack.js'));
const cardmint = panel('cardmint', () => import('./cardmint.js'));
const slots = panel('slots', () => import('./slots.js'));
export const openCardMachinePanel = call(cardpack, 'openCardMachinePanel');
export const cardMachineVend = call(cardpack, 'cardMachineVend');   // plays the vend even with no machine open
export const openPackReveal = call(cardpack, 'openPackReveal');
export const openCardMintPanel = call(cardmint, 'openCardMintPanel');
export const cardMintStruck = ifLoaded(cardmint, 'cardMintStruck');
export const openSlotsPanel = call(slots, 'openSlotsPanel');

// Machines and consoles. The ones with an init wire their index.html markup, which
// only matters once they open, so init runs on load instead of at boot.
const atm = panel('atm', () => import('./atm.js').then((m) => { m.initAtmPanel(); return m; }));
export const openAtmPanel = call(atm, 'openAtmPanel');
export const closeAtmPanel = ifLoaded(atm, 'closeAtmPanel');
export const updateAtmPanel = ifLoaded(atm, 'updateAtmPanel');
export const playAtmDrainSfx = call(atm, 'playAtmDrainSfx');

const morphex = panel('morphex', () => import('./morphex.js'));
export const openMorphexPanel = call(morphex, 'openMorphexPanel');
export const closeMorphexPanel = ifLoaded(morphex, 'closeMorphexPanel');

const pirate = panel('piratedeck', () => import('./piratedeck.js'));
export const openPirateConsole = call(pirate, 'openPirateConsole');
export const closePirateConsole = ifLoaded(pirate, 'closePirateConsole');

const corpConsole = panel('corp-console', () => import('./corp-console.js'));
export const openCorpConsole = call(corpConsole, 'openCorpConsole');
export const updateCorpConsole = ifLoaded(corpConsole, 'updateCorpConsole');
const corpMap = panel('corp-map', () => import('./corp-map.js'));
export const openCorpMap = call(corpMap, 'openCorpMap');

const inspect = panel('deviceinspect', () => import('./deviceinspect.js'));
export const openDeviceInspectPanel = call(inspect, 'openDeviceInspectPanel');
export const consumeExamineLogSuppression = ifLoaded(inspect, 'consumeExamineLogSuppression', false);

const lightview = panel('lightview', () => import('./lightview.js'));
export const openLightViewDialog = call(lightview, 'openLightViewDialog');

const wardrobe = panel('wardrobe', () => import('./wardrobe.js').then((m) => { m.initWardrobePanel(); return m; }));
export const openWardrobePanel = call(wardrobe, 'openWardrobePanel');
export const refreshWardrobePanel = ifLoaded(wardrobe, 'refreshWardrobePanel');
export const getActiveWardrobeId = () => wardrobe.get()?.getActiveWardrobeId() ?? null;
export const showWardrobeNotify = ifLoaded(wardrobe, 'showWardrobeNotify');

const mediadeck = panel('mediadeck', () => import('./mediadeck.js').then((m) => { m.initMediaDeckPanel(); return m; }));
export const openMediaDeckPanel = call(mediadeck, 'openMediaDeckPanel');
export const updateMediaDeckBroadcast = ifLoaded(mediadeck, 'updateMediaDeckBroadcast');
export const applyMediaDeckOverlay = ifLoaded(mediadeck, 'applyMediaDeckOverlay');

// Instruments. Another player's notes are heard whether or not your own keyboard is
// open, so a note loads the module; a release for notes this client never heard doesn't.
const piano = panel('piano', () => import('./piano.js'));
export const openPianoPanel = call(piano, 'openPianoPanel');
export const closePianoPanel = ifLoaded(piano, 'closePianoPanel');
export const onRoomNote = (msg) => (msg?.allNotes ? ifLoaded : call)(piano, 'onRoomNote')(msg);
export const onVoiceConfig = call(piano, 'onVoiceConfig');
export const isPianoKeysLive = () => !!piano.get()?.isPianoKeysLive();

// The CB radio. The cab imports it too, so every feed is call (see the ⚠ above).
const cb = panel('cb-radio', () => import('./cb-radio.js'));
export const receiveCbMsg = call(cb, 'receiveCbMsg');
export const applyCbContext = call(cb, 'applyCbContext');
export const clearCbContext = call(cb, 'clearCbContext');

// The yacht's harbour and engine beds. Every move sends `ambience`, null almost
// everywhere, so only a real one loads them (sea-audio and the shared swell come too).
const yacht = panel('yacht-ambience', () => import('./yacht-ambience.js'));
export const setYachtAmbience = (a) => (a ? call : ifLoaded)(yacht, 'setYachtAmbience')(a);
export const yachtUnderway = call(yacht, 'yachtUnderway');
export const yachtSettled = ifLoaded(yacht, 'yachtSettled');

// The wall TV. Its exports already reach a panel() that's built on first use.
const tv = panel('tv', () => import('./tv.js').then((m) => { m.initTvPanel(); return m; }));
export const openTvPanel = call(tv, 'openTvPanel');
export const isTvOpen = () => !!tv.get()?.isTvOpen();
export const shutdownTvPanel = ifLoaded(tv, 'shutdownTvPanel');
export const renderTvDeck = ifLoaded(tv, 'renderTvDeck');
export const tvViewsForChannel = (id) => tv.get()?.tvViewsForChannel(id) ?? [];
export const tvOpenViews = () => tv.get()?.tvOpenViews() ?? [];

// The cassette player. Unlocks arrive at login, long before anyone opens it, so they
// wait here and are handed over on load. mod-parser.js (window.ModParser, a classic
// script) is only for its .MOD tapes, so it comes with it rather than at boot, and it
// has to be in before the player opens: opening re-parses the stored tapes. A parser
// that won't load costs the tapes ("IMPORT UNAVAILABLE"), never the player.
let ampUnlocks = null;
const music = panel('musicplayer', () => Promise.all([
  import('./musicplayer.js'),
  loadClassicScript('/shared/mod-parser.js').catch((e) => console.error('[lazy-views]', e.message)),
]).then(([m]) => {
  m.initMusicPlayerPanel();
  if (ampUnlocks) m.applyAmpUnlocks(ampUnlocks);
  ampUnlocks = null;
  return m;
}));
export const openMusicPlayerPanel = call(music, 'openMusicPlayerPanel');
export const stopMusicPlayer = ifLoaded(music, 'stopMusicPlayer');
export function applyAmpUnlocks(ids) {
  const m = music.get();
  if (m) m.applyAmpUnlocks(ids);
  else ampUnlocks = Array.isArray(ids) ? ids.slice() : [];
}
export function addAmpUnlock(id) {
  const m = music.get();
  if (m) m.addAmpUnlock(id);
  else if (id) (ampUnlocks ??= []).push(id);
}

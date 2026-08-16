import { state } from './state.js';
import { appendMsg, appendHtml, appendPre, updateVitals, parseZoneInfo, showDevPanelButton, setAreaPane, setPaneSilent, showSkyBanner, pointAtRoomTarget, setRoomBeacon, clearRoomBeacons, isAreaPaneVisible } from './render.js';
import { sendCmd, sendCmdSilent, sendRaw, closeConnection, attemptAutoReauth, showVerifyScreen, rememberDisplayRung } from './net.js';
import { setVerbs } from './complete.js';
import { renderMinimap, setGpsRoute, setRunState, startAutoWalk, resumeAutoWalkIfArmed, setAutoWalkPersist, isAutoWalking, isManualAutoWalkInProgress, cancelAutoWalk, autoWalkBlocked, resolveAutoWalkPicker, armAutoWalkPrompt, notifyElevatorDoors } from './panels/minimap.js';
import { updateEnvironmentHUD, updateZoneTempHUD, refreshZoneVisibility, signalPowerOut, isFxIndoors, setEnvUnreal } from './panels/environment.js';
import { setWeatherEventFx, setFireworksGlow, launchFirework } from './panels/weather-fx.js';
import { setDreamFx } from './panels/environment.js';
import { openDialogue, closeDialogue, openShop, notifyZoneChanged } from './panels/dialogue.js';
import { updateInventoryCache, consumeSilentInventory, refreshWeaponChip } from './panels/inventory-state.js';
import { renderRecipesPanel } from './panels/recipes.js';
import { renderStatsPanel } from './panels/stats.js';
import { renderSkillsPanel } from './panels/skills.js';
import { receiveWhisper, sentWhisper, receiveChannelMsg, initChannels, initChannelHistory, receiveMOTD, refreshOnlinePlayers, rollbackSelfEcho, removeCorpChannels } from './panels/whisper.js';
import { openContainerPanel, refreshContainerPanel, getActiveContainerId, showContainerNotify } from './panels/container.js';
import { openWardrobePanel, refreshWardrobePanel, getActiveWardrobeId, showWardrobeNotify } from './panels/wardrobe.js';
import { openLootPanel, closeLootPanel } from './panels/loot.js';
import { openWorkspacePanel, refreshWorkspacePanel, isWorkspaceOpen } from './panels/workspace.js';
import { openLightViewDialog } from './panels/lightview.js';
import { openMorphexPanel, closeMorphexPanel } from './panels/morphex.js';
import { updateForecast } from './panels/forecast.js';
import { openAtmPanel, closeAtmPanel, updateAtmPanel, playAtmDrainSfx } from './panels/atm.js';
import { openPianoPanel, closePianoPanel, onRoomNote } from './panels/piano.js';
import { openCardMachinePanel, cardMachineVend, openPackReveal } from './panels/cardpack.js';
import { openSlotsPanel } from './panels/slots.js';
import { openCardMintPanel, cardMintStruck } from './panels/cardmint.js';
import { openInsurancePanel, updateInsurancePanel } from './panels/insurance.js';
import { openWantedPoster } from './panels/wantedposter.js';
import { openCorpConsole, updateCorpConsole } from './panels/corp-console.js';
import { isA11yTablet, renderA11yTablet, close as closeA11yTablet, initA11yTablet } from './panels/tablet-a11y.js';
import { openListDialog, closeListDialog, initListDialog } from './panels/listdialog.js';
import { openTabletPanel, closeTabletPanel, tabletQuestUpdate, noteQuestLog, openTabletToSpecter, openTabletToReel, openTabletSpecterInstall, refreshTabletGearIfOpen, openTabletToMap, refreshTabletMapIfOpen, openTabletTvPanel } from './panels/tablet-os.js';
import { openCorpMap } from './panels/corp-map.js';
import { openVoidwalkStaging, appendVoidwalkChat } from './panels/voidwalk-staging.js';
import { openMediaDeckPanel, updateMediaDeckBroadcast, applyMediaDeckOverlay } from './panels/mediadeck.js';
import { openDeviceInspectPanel, consumeExamineLogSuppression } from './panels/deviceinspect.js';
import { openCircuitHack } from './panels/circuithack.js';
import { mountChess3D } from './panels/chess3d.js';
import { openTextBreach, isTextBreachActive, command as textBreachCommand } from './panels/textbreach.js';
import { openNullBoard } from './panels/nullboard.js';
import { openTextNullBoard, isTextNullActive } from './panels/textnullboard.js';
import { openCalibration } from './panels/calibration.js';
import { openTextCalibration, isTextCalibrationActive, command as textCalibrationCommand } from './panels/textcalibration.js';
import { openTextHololock, isTextHololockActive, command as textHololockCommand } from './panels/texthololock.js';
import { openTextVault, isTextVaultActive, command as textVaultCommand } from './panels/textvault.js';
import { openTextSignal, isTextSignalActive, command as textSignalCommand } from './panels/textsignal.js';
import { openTextFishing, isTextFishingActive, command as textFishingCommand } from './panels/textfishing.js';
import { openTextRead, isTextReadActive } from './panels/textread.js';
import { openReadWindow } from './panels/readwindow.js';
import { openHololock } from './panels/hololock.js';
import { openSignalHijack } from './panels/signalhijack.js';
import { openPirateConsole, closePirateConsole } from './panels/piratedeck.js';
import { openFishing, armFishFight } from './panels/fishing.js';
import { openPsychometry } from './panels/psychometry.js';
import { abortMacros, receiveMacros } from './panels/smartbar-macros.js';
import { pullConfig, receiveConfig } from './configsync.js';
import { setTabletAccess, showTabletOffer } from './panels/smartbar.js';
import { offerInterfaceTour, startInterfaceTour, startTabletTour, consumeTourHandoff } from './panels/tour.js';
import { playIntroCinematic } from './panels/intro-cinematic.js';
import { updateCockpit, closeCockpit, cabinAudio, openTargeting, openFlightSim, flightSimContext, flightSimContacts, flightSimAASites, flightSimAirHit, flightSimKill, flightSimAaTracer, flightSimAirThreat, flightSimFireworks, flightSimLightning, isFlightSimActive, isCockpitHudActive } from './panels/cockpit.js';
import { openTextCockpit, updateTextCockpit, closeTextCockpit, isTextCockpitActive } from './panels/textcockpit.js';
import { openHelm, closeHelm, isHelmActive, helmSetSky, helmSetWorld, helmSetContacts, helmEndTransit, helmBeginTransit } from './panels/helm-mode.js';
import { openCab, closeCab, cabContext, isCabActive } from './panels/cab-view.js';
import { receiveCbMsg, applyCbContext, clearCbContext } from './panels/cb-radio.js';
import { airHorn } from './panels/engine-audio.js';
import { openTruckDepot, closeTruckDepot, isTruckDepotActive } from './panels/truck-depot.js';
import { setYachtAmbience, yachtUnderway, yachtSettled } from './panels/yacht-ambience.js';
import { setDrugFx, clearDrugFx } from './panels/flight-drugfx.js';
import { openVaultCrack } from './panels/vaultcrack.js';
import { openConcealKeypad } from './panels/keypad.js';
import { openSprayCan, updateSprayShelf } from './panels/spraycan.js';
import { openSynthMinigame, openCookMenu } from './panels/synthlab.js';
import { openSpliceSelect, openSpliceStages, applySplicePreview } from './panels/splicelab.js';
import { showSpliceReport } from './panels/spliceReport.js';
import { updateWantedHud, setWantedHeat } from './panels/wanted.js';
import { showAccoladeUnlock } from './panels/accolades-banner.js';
import { openTvPanel, isTvOpen, getTvActiveChannelId, appendTvMessage, updateTvTicker, applyTvOverlay, clearTvMessages, showTvOffAir, showTvOnAir, shutdownTvPanel, tvSpeak, renderTvSchedule, renderTvDeck, tvViewsForChannel, tvOpenViews } from './panels/tv.js';
import { applyAmpUnlocks, addAmpUnlock } from './panels/musicplayer.js';
import { applyEspState, handleEspWarning } from './esp.js';
import { playPokerSfx } from './poker-sfx.js';
import { showConfirmDialog, showAmountDialog } from './panels/confirm.js';
import { openSiftPanel, closeSiftPanel } from './panels/sift-select.js';
import { showArrestNotice } from './panels/arrest.js';
import { openApprehendPrompt } from './panels/apprehend.js';
import { openConcealSearch } from './panels/conceal.js';
import { updateTrade, closeTrade } from './panels/trade.js';
import { openHangarBay, openCharterScreen, closeHangarBay, isHangarBayActive } from './panels/hangar-bay.js';
import { openAdminPanel } from './panels/admin.js';
import { renderMarkup } from './markup.js';
import { onPanelData, onPanelFeed, onPanelCatalog, syncPanels, refreshCustomPanels } from './panels/custom/manager.js';
import { loadSettings, sfxDetail } from '/shared/settings.js';


const DEV_ROLES = ['admin', 'dev', 'builder', 'designer'];

// The station's spoken login greeting — the formant voice (seeded to a single
// steady "Architect" machine voice) welcomes the player by name. Mostly the plain
// line; ~1 in 4 logins something quieter and more ominous — but always their name.
// It's a TV-narrator voice, so it obeys TV Audio and, on top of that, its own
// dedicated switch (Sound → Welcome Voice) so it can be silenced independently.
const WELCOME_PLAIN = n => `Welcome to Architect, ${n}.`;
const WELCOME_OMINOUS = [
  n => `Welcome back, ${n}. We kept your seat warm.`,
  n => `${n}. You returned. They said you wouldn't.`,
  n => `The city remembers you, ${n}. It always does.`,
  n => `Welcome to Architect, ${n}. Do try to last longer this time.`,
  n => `We have been waiting for you, ${n}.`,
  n => `${n}. Reconnection confirmed. Compliance appreciated.`,
  n => `You were logged as absent, ${n}. The absence has been amended.`,
  n => `Good. You are breathing. That simplifies the paperwork, ${n}.`,
  n => `${n}. Your file was open the whole time. Nobody closed it.`,
  n => `The Basin did not miss you, ${n}. It doesn't do that. But it noticed.`,
  n => `Resume, ${n}. Everything continued without you.`,
  n => `${n}. Somebody asked about you while you were away. We told them nothing.`,
  n => `Session restored, ${n}. Your prior session ended in a manner we found instructive.`,
  n => `Welcome to Architect, ${n}. Statistically, most of you comes back.`,
  n => `${n}. We had almost finished reassigning your name.`,
  n => `Step in, ${n}. The city has been rearranged slightly. You'll adapt or you won't.`,
  n => `We kept watching after you left, ${n}. There wasn't much to watch.`,
  n => `${n}. Identity accepted. Provisionally.`,
  n => `You are late, ${n}. Nothing was scheduled. You are still late.`,
  n => `Welcome home, ${n}. That word is used loosely here.`,
];
// State-aware ominous lines. Each reads a field already present on the auth
// payload (server/index.js livePlayer) — no extra query — and only qualifies
// when its `when` predicate matches, so the Architect sounds like it watched
// your last session. Mutations draw disapproval (bionics-approval is a later
// hook). Fires ~60% of the time an ominous roll lands AND ≥1 line qualifies —
// so the Architect reacts to what you did roughly one login in seven.
const WELCOME_STATE = [
  { when: p => p.died_offline,        line: (n) => `You died in your sleep, ${n}. We watched.` },
  { when: p => p.covered_in_blood,    line: (n) => `You came back still wearing someone else's blood, ${n}.` },
  { when: p => p.current_zone === 'zone_mq_precinct_holding', line: (n) => `Precinct 9 kept your cell warm, ${n}.` },
  { when: p => p.radiation >= 60,     line: (n) => `You still glow, ${n}. We can see you in the dark.` },
  { when: p => p.visibly_mutated,     line: (n) => `You're less human than last time, ${n}. Correct that.` },
  { when: p => (p.player_kills || 0) > 0, line: (n) => `We still count the ones you left behind, ${n}.` },
  { when: p => p.credits === 0 && (p.bank_credits || 0) === 0, line: (n) => `Broke again, ${n}. The city keeps its ledger.` },
  { when: p => (p.bank_credits || 0) >= 100000, line: (n) => `The vault noticed your balance, ${n}. So did we.` },
  { when: p => !p.home_zone,          line: (n) => `No fixed address, ${n}. The city notes it.` },

  // Wounds & wear
  { when: p => p.hp_max && p.hp / p.hp_max <= 0.25, line: (n) => `You logged off bleeding, ${n}, and you have come back bleeding. Nothing heals while you're gone.` },
  { when: p => p.hp_max && p.hp >= p.hp_max, line: (n) => `Unmarked, ${n}. Either you were careful or you did nothing at all.` },
  { when: p => (p.deaths || 0) >= 10, line: (n) => `Death number ${'' + (p.deaths || 0)} is behind you, ${n}. We have stopped filing them individually.` },
  { when: p => (p.deaths || 0) === 0 && (p.total_xp || 0) > 500, line: (n) => `Still no deaths on your record, ${n}. Records like that are a kind of debt.` },
  { when: p => p.body_temp_c != null && p.body_temp_c <= 35, line: (n) => `You are colder than you should be, ${n}. The Basin will finish that job if you let it.` },
  { when: p => p.body_temp_c != null && p.body_temp_c >= 39, line: (n) => `You're running hot, ${n}. Something in you is burning fuel it doesn't have.` },
  { when: p => (p.wetness || 0) > 40, line: (n) => `You came back wet, ${n}. We would rather not know from what.` },

  // Mind
  { when: p => p.sanity_max && p.sanity / p.sanity_max <= 0.3, line: (n) => `Your readings are wrong, ${n}. Not low. Wrong. Whatever you saw down there, it saw the paperwork too.` },
  { when: p => p.sanity_max && p.sanity / p.sanity_max <= 0.55, line: (n) => `You are thinking a little sideways today, ${n}. We have noted it. We note everything.` },
  { when: p => p.sanity_max && p.sanity >= p.sanity_max, line: (n) => `Perfectly lucid, ${n}. That is the least interesting way to be in Coldwater.` },

  // Appetite
  { when: p => (p.hunger ?? 100) <= 15, line: (n) => `You haven't eaten, ${n}. The Basin is patient about that. It waits.` },
  { when: p => (p.thirst ?? 100) <= 15, line: (n) => `Dry, ${n}. Thirst kills faster than anything you're afraid of.` },
  { when: p => (p.digestive_load || 0) > 60, line: (n) => `You logged off full, ${n}. Somebody's rations are unaccounted for.` },

  // Body & chemistry
  { when: p => (p.radiation || 0) >= 30 && (p.radiation || 0) < 60, line: (n) => `The count on you is climbing, ${n}. Slowly. Slow is still climbing.` },
  { when: p => (p.radiation || 0) === 0 && (p.total_xp || 0) > 1000, line: (n) => `Clean as scrubbed pipe, ${n}. Somebody has been paying for filters.` },
  { when: p => p.visibly_mutated && (p.player_kills || 0) > 0, line: (n) => `Less human and less careful, ${n}. Those two figures usually move together.` },

  // Violence & the ledger
  { when: p => (p.mob_kills || 0) >= 100, line: (n) => `${'' + (p.mob_kills || 0)} confirmed on your ledger, ${n}. The Basin thanks you for the sanitation work.` },
  { when: p => (p.mob_kills || 0) === 0 && (p.total_xp || 0) > 200, line: (n) => `You have killed nothing, ${n}. Admirable. Temporary.` },
  { when: p => (p.player_kills || 0) >= 5, line: (n) => `Other people's names end where you begin, ${n}. Five of them now.` },
  { when: p => p.combat_stance === 'aggressive', line: (n) => `You went offline with your guard down and your fists up, ${n}. Bold, for a body that only has one of itself.` },

  // Money & standing
  { when: p => (p.credits || 0) > 20000, line: (n) => `You are carrying too much of it on your person, ${n}. So is everyone who has ever been robbed.` },
  { when: p => (p.bank_credits || 0) === 0 && (p.credits || 0) > 5000, line: (n) => `Nothing banked, ${n}. You don't trust the vault. The vault has noticed.` },
  { when: p => p.home_zone && !p.died_offline, line: (n) => `Your door was undisturbed while you slept, ${n}. This time.` },

  // Where you left yourself
  { when: p => p.current_zone === p.anchor_zone, line: (n) => `You never left your anchor, ${n}. Some people call that caution.` },
  { when: p => p.home_zone && p.current_zone === p.home_zone, line: (n) => `You logged off at home, ${n}. It's still standing. Try not to read anything into that.` },
  // Transient void rooms are `xing_<leader>_<seq>` (plugins/voidwalking), not real zone ids.
  { when: p => p.current_zone && /^xing_/.test(p.current_zone), line: (n) => `You went out past the map, ${n}, and the map did not follow you back.` },

  // Career
  { when: p => (p.total_xp || 0) < 100, line: (n) => `You are new, ${n}. The Basin has a word for new. It isn't a kind one.` },
  { when: p => (p.total_xp || 0) > 50000, line: (n) => `You have outlasted your cohort, ${n}. All of it.` },
  { when: p => !p.archetype, line: (n) => `You still haven't decided what you are, ${n}. The city will decide for you eventually.` },

  // Sleep debt — last_slept_at is real time, so this reads a genuinely long gap
  { when: p => p.last_slept_at && (Date.now() - p.last_slept_at) > 36e5 * 12, line: (n) => `You have not slept in a long time, ${n}. We can hear it in the way you move.` },
];
// Choose the greeting. Split out from playWelcomeVoice so the MOTD banner can
// carry the same line even when the voice itself is muted.
function pickWelcomeLine(handle, player) {
    const name = (handle || 'operator').trim();
    let line = WELCOME_PLAIN;
    if (Math.random() < 0.25) {
      // Ominous roll landed. If any state line qualifies, ~60% chance to speak
      // a personalized one; otherwise fall back to the generic pool. Never
      // repeat the immediately-previous ominous line (localStorage-tracked).
      const last = (() => { try { return localStorage.getItem('welcome-voice-last'); } catch { return null; } })();
      const qualifying = player ? WELCOME_STATE.filter(s => s.when(player)) : [];
      let pool;
      if (qualifying.length && Math.random() < 0.6) pool = qualifying.map(s => s.line);
      else pool = WELCOME_OMINOUS;
      const fresh = pool.length > 1 ? pool.filter(l => l(name) !== last) : pool;
      line = (fresh.length ? fresh : pool)[Math.floor(Math.random() * (fresh.length ? fresh : pool).length)];
      try { localStorage.setItem('welcome-voice-last', line(name)); } catch { /* ignore */ }
    }
    return line(name);
}

function playWelcomeVoice(handle, player) {
  let text = null;
  try { text = pickWelcomeLine(handle, player); } catch { /* fall through */ }
  // The game log's welcome line is the same words the voice speaks — and it's
  // written whether or not the voice is audible (muted, or gesture-blocked).
  appendMsg(text || 'Welcome to ARCHITECT.', 'system');
  try {
    if (!text) return;
    const audio = loadSettings().audio || {};
    if (audio.welcome === false) return;   // dedicated opt-out (TV Audio still gates it in speak())
    // An auto-login connects with no click behind it, so the context is still
    // gesture-blocked here. Waiting means the greeting plays on first input
    // instead of being dropped (and no autoplay warning on the way out).
    window.AudioEngine?.onUnlock?.(() => window.AudioEngine.speak(text, { seed: 'architect' }));
  } catch { /* audio unavailable — no greeting */ }
}

// Keep the synthesized game SFX mellow — they sit under speech, music and
// ambience and shouldn't jump out. Scales every server-pushed SFX on top of
// whatever per-event gain the server already set. (Poker SFX have their own
// softening in poker-sfx.js.)
const GAME_SFX_GAIN = 0.6;

// ── A cadence, scheduled here rather than sent as N messages ─────────────────
//
// The server describes a series (`{count, interval, key}`) and the client lays it
// out in time. Two things make this worth its own function:
//
//   THE FEET ALTERNATE. `foot` flips per footfall, which is the difference between
//   a walk and a repeated sample — the generator's own comment is explicit that
//   random jitter reads as noise while an alternating pair reads as WALKING, so an
//   unvaried repeat would undo the thing the parameter exists for.
//
//   A NEW SERIES REPLACES THE OLD, keyed by `key`. This is the load-bearing half.
//   Steps are sent per room transition and a series deliberately outlasts one
//   crossing, so without cancellation a walking player accumulates overlapping
//   cadences and ends up sounding like a crowd. With it, walking is one unbroken
//   cadence, and the leftover footfalls only ever play when you actually stopped —
//   which is what makes them read as arriving somewhere rather than as an echo.
const _series = new Map();   // key -> pending timer id
function playSeries({ count = 1, interval = 300, key }, params, play) {
  if (key && _series.has(key)) { clearTimeout(_series.get(key)); _series.delete(key); }
  let n = 0;
  const step = () => {
    // A distinct seed per footfall, DERIVED rather than random, so the copy the
    // room hears is the same performance the walker hears — both sides were sent
    // the same base seed and run the same derivation.
    play({ ...params, foot: ((params.foot ?? 0) + n) & 1,
           seed: Number.isFinite(params.seed) ? (params.seed + n * 0x9e3779b1) >>> 0 : undefined });
    if (++n >= count) { if (key) _series.delete(key); return; }
    const t = setTimeout(step, interval);
    if (key) _series.set(key, t);
  };
  step();
}

// The sleep bar: a label plus the wake button, shown only while asleep. Driven
// solely by the server's sleep_state (see handlers below) so it can never get
// stuck on after a wake path the client didn't recognise.
let _dreamClearTimer = null;

function setSleepBar(sleeping, dreaming) {
  const bar = document.getElementById('sleep-bar');
  if (!bar) return;
  bar.hidden = !sleeping;
  // Dreamless sleep blacks the room out. The server already refuses to deliver
  // the room to a sleeper (receivesZoneMessage), so this is the visual half of
  // the same rule — the transcript you were reading before you dozed off
  // shouldn't stay legible behind your eyelids. A DREAMER is exempt: the dream
  // is the only room they're in, and it's meant to be read.
  document.body.classList.toggle('asleep', !!sleeping && !dreaming);
  if (!sleeping) {
    clearTimeout(_dreamClearTimer);
    document.body.classList.remove('dreaming-line');
    return;
  }
  const label = document.getElementById('sleep-bar-label');
  if (label) {
    label.textContent = dreaming
      ? 'You are dreaming. You can walk, look and speak here.'
      : 'You are asleep. Any command will wake you.';
  }
}

// Display Mode `log` — the server already resolved this minigame with a skill
// check and told us the outcome, because a character board repaints at frame rate
// and is unreadable by a screen reader. Print its line and fire the SAME resolve
// verb the board would have fired, so the authoritative path is identical.
// Returns true when it handled the message, so each handler reads as one guard.
// Is the top pane free to hold the room description right now?
//
// Twelve things can be mounted in it — the flight sim, the passenger HUD, the
// hangar bay, the helm, THE TRUCK CAB, THE DEPOT, and the six character panels —
// and each replaces the room with its own app. This was written out twice, once
// per room-painting handler, which is how the fishing board nearly got clobbered
// by a look before it was added to both copies.
//
// It answers TWO questions, and that is why it's worth a name: whether to paint
// the room here, and whether the `log` rung may hide the pane. Hiding it while a
// text cockpit is mounted would black out a pilot's instruments.
//
// THE CAB WAS NEVER ON THIS LIST, and that is the whole reason nobody has ever
// driven a truck from the cockpit. `openCab` writes straight into #area-content —
// the same element setAreaPane overwrites — so the cab was destroyed by the very
// next room description. And `drive` CAUSES one: it pulls you out of the shed onto
// the apron, which is a move, which paints the room. So the windshield existed for
// a fraction of a second, every single time, and what you were left looking at was
// the yard you had just left. It was never a rendering bug; it was an omission
// from this line.
//
// The depot belongs here for the same reason now that it mounts in the pane rather
// than floating over it — a `look` while you are standing at the dealer's line
// would otherwise wipe the whole application mid-purchase.
function paneFreeForRoom() {
  return !isFlightSimActive() && !isCockpitHudActive() && !isHangarBayActive() && !isHelmActive()
    && !isCabActive() && !isTruckDepotActive()
    && !isTextCockpitActive() && !isTextBreachActive() && !isTextHololockActive()
    && !isTextVaultActive() && !isTextSignalActive() && !isTextFishingActive()
    && !isTextCalibrationActive() && !isTextNullActive() && !isTextReadActive();
}

function autoResolved(msg, onResult) {
  if (msg.render !== 'resolve') return false;
  if (msg.message) appendHtml(msg.message, 'system');
  // Both shapes, so a family whose callback reads {score} and one that reads
  // {won} are each satisfied without the helper knowing which is which.
  onResult({ won: !!msg.autoWon, score: msg.autoScore ?? (msg.autoWon ? 100 : 0) });
  return true;
}
const handlers = {
  connected: () => {},
  pong: () => {},

  auth_success: (msg) => {
    sessionStorage.removeItem('signed-out');
    const wasReconnect = !!state.player;
    clearTimeout(state.authTimeout);
    state.authPending = false;
    state.player = msg.player;
    document.getElementById('auth-screen').style.display = 'none';
    const bmcBtn = document.getElementById('bmc-btn');
    if (bmcBtn) bmcBtn.style.display = 'none';
    document.getElementById('handle-display').textContent = state.player.handle;
    updateVitals(state.player);
    refreshWeaponChip();   // seed the mobile weapon chip; no-op on desktop
    if (msg.env) updateEnvironmentHUD(msg.env);
    else fetch('/api/environment/state').then(r => r.json()).then(updateEnvironmentHUD).catch(() => {});
    // The dev token encodes playerId:role:timestamp and no name, so the handle
    // rides alongside it — otherwise the auto-authed panel knows WHAT you are
    // and never WHO (its auth badge said just "[admin]" for that reason).
    if (msg.apiToken) {
      sessionStorage.setItem('devpanel-token', msg.apiToken);
      sessionStorage.setItem('devpanel-handle', state.player.handle || '');
    }
    if (msg.reconnectToken) sessionStorage.setItem('reconnect-token', msg.reconnectToken);
    state.myRole = state.player.role;
    // Mirror the rung the SERVER settled on back into the auth screen's local
    // memory. Note the direction: the server is the authority here, so a player
    // who set `log` from their phone sees the auth screen agree with it on this
    // machine next visit. Undefined (never chosen) clears the local pref, which
    // is what keeps an untouched account untouched.
    rememberDisplayRung(state.player.displayRung);
    // The accessible tablet needs a way to send nav/actions back. Injected rather
    // than imported so that module pulls in nothing from the socket layer and can
    // be exercised headlessly (scripts/a11y/tablet-smoke.mjs).
    initA11yTablet(sendCmdSilent, state.player.displayRung);
    // The generic list dialog sends real verbs (`buy X`), not silent ones — the
    // player should see what their click did, exactly as if they had typed it.
    initListDialog(sendCmd);
    initChannels(msg.channels || []);
    if (DEV_ROLES.includes(state.player.role)) showDevPanelButton();
    if (wasReconnect) appendMsg('Reconnected.', 'system');
    else playWelcomeVoice(state.player.handle, state.player);   // spoken login greeting (fresh logins only)
    // Push this device's Extra Lore preference — the server keeps the per-player
    // flag, but the Settings toggle is local, so re-assert it each login.
    sendCmdSilent(`lorealways ${(loadSettings().extraLore || 'off') === 'on' ? 'on' : 'off'}`);
    syncPanels(); // request data + cam catalog for any custom panels
    // Tab completion's verb half. Asked for once per session because it describes
    // the BUILD, not the player — nothing in it changes while they play.
    sendRaw({ type: 'verbs' });
    // …and the macro bar, which follows the account rather than the browser.
    sendRaw({ type: 'macros_pull' });
    // …and the rest of the client setup: triggers, aliases, timers, state rules,
    // highlights, variables. One round trip for the lot.
    pullConfig();
  },

  // The account's macros. See receiveMacros() for the three arrival states and
  // why adopting is not unconditional.
  macros: (msg) => receiveMacros(msg),
  // The server acknowledging a push. Nothing to do with it — the local copy is
  // already the truth this client is rendering — but a handler has to exist or
  // the unknown-message path logs a warning on every macro edit.
  macros_saved: () => {},
  // The account's client setup. receiveConfig owns the arrival rule for every
  // key — see configsync.js for why that lives in one place.
  config: (msg) => receiveConfig(msg.config),
  config_saved: () => {},

  // The verb vocabulary for Tab completion (see complete.js). Deliberately does
  // nothing else: an unknown verb here is not an error, it is a verb this client
  // will not complete, and every one of them still works when typed in full.
  verbs: (msg) => setVerbs(msg.verbs),

  auth_fail: (msg) => {
    clearTimeout(state.authTimeout);
    state.authPending = false;
    state.player = null;
    sessionStorage.removeItem('reconnect-token');
    if (msg.needsVerification) {
      showVerifyScreen('', msg.message);
      return;
    }
    const submitBtn = document.getElementById('auth-submit');
    submitBtn.disabled = false;
    submitBtn.textContent = state.isRegister ? 'Register' : 'Enter';
    document.getElementById('auth-screen').style.display = 'flex';
    const errEl = document.getElementById('auth-error');
    errEl.textContent = msg.message;
    errEl.style.color = 'var(--red)';
  },

  look: (msg) => {
    if (msg.notify) appendMsg(msg.notify, 'system');
    // Don't clobber the live cockpit (either the continuous sim or the discrete
    // passenger HUD) or an open hangar bay panel — all replace the plain-text room
    // description with their own app in the same area-pane.
    const free = paneFreeForRoom();
    if (free) setAreaPane(msg.message);
    // Display Mode `log` — the room goes to the scrolling log as well. The pane is
    // aria-hidden at that rung, so this duplication is inaudible to a screen
    // reader and is the ONLY way the room reaches them; a sighted player on this
    // rung gets the room in their scrollback, which is what they chose it for.
    if (msg.toLog) appendHtml(msg.logMessage || msg.message, 'look');
    setPaneSilent(!!msg.toLog && free);
    if (state.echoNextLook) { appendMsg('You look around.', 'system'); state.echoNextLook = false; }
    if (msg.zone) { notifyZoneChanged(msg.zone); state.currentZone = msg.zone; }
    setYachtAmbience(msg.ambience);   // naval on deck / engine below / null elsewhere
    parseZoneInfo(msg.message);
    if (msg.minimap) renderMinimap(msg.minimap);
    refreshZoneVisibility();
  },

  // THE ROOM CHANGED UNDER YOU AND YOU DIDN'T ASK. Waking from a dream, an
  // eviction, a trip ending — the server moves you and then says "look again".
  //
  // It carries no payload deliberately: what a `look` means depends on who you
  // are by the time it lands (flight overrides the verb mid-air), so re-asking
  // gets the right one rather than a room description composed for whoever the
  // server thought you were. The reply comes back through `look` above.
  //
  // This existed on the server from the start and had NO handler here — six send
  // sites firing into `if (!handler) return;`. The wake-from-dream path printed
  // "the room reassembles itself around you" and then sent the one message that
  // would have made that true.
  force_look: () => sendCmdSilent('look'),

  move: (msg) => {
    // Walking into a walk-in hangar races the server's `hangar_bay_open` push
    // against this plain-text room description — whichever lands second wins.
    // If the bay panel already won that race, don't stomp it; it owns the pane
    // until the player actually leaves (hangar_close triggers a fresh look).
    const free = paneFreeForRoom();
    if (free) setAreaPane(msg.message, msg.direction);
    if (msg.narration) appendHtml(msg.narration, 'move');
    if (msg.toLog) appendHtml(msg.logMessage || msg.message, 'look');   // see the `look` handler
    setPaneSilent(!!msg.toLog && free);
    notifyZoneChanged(msg.zone);
    state.currentZone = msg.zone;
    setYachtAmbience(msg.ambience);   // naval on deck / engine below / null elsewhere
    parseZoneInfo(msg.message);
    if (msg.minimap) renderMinimap(msg.minimap, msg.direction);
    if (msg.tempC !== undefined) updateZoneTempHUD(msg.tempC);
    refreshZoneVisibility(msg.visibility);   // absent on an old server ⇒ falls back to fetching
    refreshTabletMapIfOpen();
  },

  combat: (() => {
    let _lookTimer = null;
    return (msg) => {
      const el = appendHtml(msg.message, msg.killed ? 'loot' : 'combat');
      if (msg.killed && msg.corpseLink) appendHtml(`${msg.corpseLink}`, 'loot');
      // Timed combat lines (a dodge window, the wait for the next flee attempt)
      // carry their own countdown bar, the same way a butchering emote does.
      if (msg.progressMs && el) attachInlineProgress(el, msg.progressMs);
      // Stance rides the canonical vitals path so the HUD chip tracks it.
      if (state.player && msg.player_update) { Object.assign(state.player, msg.player_update); updateVitals(state.player); }
      // Kill refreshes the area pane immediately; a non-kill hit refreshes it
      // (debounced) so the top pane shows the enemy's updated HP totals. Lines
      // that changed nobody's HP (stance, dodge, a failed break-away) set
      // noRefresh — repainting the area pane for them is pure churn.
      if (msg.noRefresh) return;
      if (msg.killed) { clearTimeout(_lookTimer); sendCmdSilent('look'); }
      else { clearTimeout(_lookTimer); _lookTimer = setTimeout(() => sendCmdSilent('look'), 300); }
    };
  })(),

  combat_incoming: (msg) => {
    appendHtml(msg.message, 'combat-incoming');
    if (state.player && msg.player_update) { Object.assign(state.player, msg.player_update); updateVitals(state.player); }
  },

  combat_miss: (msg) => { appendHtml(msg.message, 'system'); },

  player_death: (msg) => {
    appendHtml(msg.message, 'death');
    if (state.player && msg.player_update) { Object.assign(state.player, msg.player_update); updateVitals(state.player); }
    // Death can land while any sticky area-pane app is open (flight cockpit, truck cab,
    // hangar bay) or a modal overlay is up (dialogue/shop, trade, ATM, loot) — none of these
    // tear themselves down on their own for a death from an unrelated cause (combat,
    // radiation, seppuku, ...), and the flight/hangar panes explicitly block the
    // room `look` below from repainting over them. Force them all closed so death
    // always hands the screen back to the room.
    closeCockpit();
    closeCab();
    closeHangarBay();
    closeDialogue();
    closeTrade();
    closeAtmPanel();
    closeLootPanel();
    setTimeout(() => { sendCmd('look'); }, 1500);
  },

  // A player can have the wall set open on one channel AND the Tablet TV app open
  // on another, so every broadcast/overlay is fanned out to whichever surface(s)
  // are actually tuned to that channel rather than to a single global panel.
  broadcast: (msg) => {
    // Display Mode `log` — the broadcast IS the log line. Before this, a viewer on
    // that rung got nothing: the early return below drops every line when no TV
    // view is open, and at that rung no panel opens. Television was the one system
    // with no written form at all.
    if (msg.toLog) {
      appendHtml(msg.message, 'broadcast');
      return;
    }
    const views = tvViewsForChannel(msg.channel);
    if (!views.length) return;
    if (msg.style === 'off_air') {
      for (const v of views) v.showOffAir(msg.offlineGraphicContent || null, msg.offlineGraphicType || 'ascii');
      return;
    }
    for (const v of views) {
      v.showOnAir();
      if (msg.style === 'ticker') v.updateTicker(msg.message);
      else {
        // catchUp = the beat that was ALREADY on air when you tuned in, replayed so
        // the screen isn't blank until the next one. Show it, don't narrate it —
        // its read-aloud is part-way through airing to everyone else. It's passed
        // through so the panel knows never to hold it back for the voice either.
        v.appendMessage(msg.message, msg.style, msg.duration, msg.hasGameday, msg.catchUp);
        if (!msg.catchUp) v.speak(msg.message, msg.style, msg.duration);
      }
      if (msg.programName !== undefined) v.setProgramName(msg.programName);
    }
  },
  broadcast_ambient: (msg) => {
    if (msg.speechText) appendMsg(`[TV] "${msg.speechText}"`, 'broadcast-ambient');
  },
  // `dest: 'tablet'` is the portable tuner answering — it feeds the Tablet TV app's
  // viewport instead of popping the standalone CRT set open over the game.
  tv_panel: (msg) => {
    if (msg.dest === 'tablet') { openTabletTvPanel(msg); return; }
    openTvPanel(msg);
  },
  tv_off:   ()    => { if (isTvOpen()) shutdownTvPanel(); },
  tv_overlay: (msg) => {
    for (const v of tvViewsForChannel(msg.channelId)) v.applyOverlay(msg.overlay);
  },
  // The tape deck absorbed into the wall set. Panel-only: the tablet TV app has no
  // furniture under it, so the server never sends this for the tablet surface.
  tv_deck: (msg) => { renderTvDeck(msg); },
  tv_schedule: (msg) => { for (const v of tvOpenViews()) v.renderSchedule(msg); },
  tv_standings: (msg) => { for (const v of tvOpenViews()) v.renderStandings(msg); },
  system: (msg) => { appendHtml(msg.message, 'system'); },
  ambient: (msg) => { appendHtml(msg.message, 'ambient'); },
  // Cosmetic nudge: ripple a room-pane link so the player sees where to click.
  point_at: (msg) => { pointAtRoomTarget(msg.action, msg.target); },
  // Sticky version of the above: the object the tutorial is steering you toward
  // shimmers until the server says it's done with it (messaging.js beaconOn/Off).
  beacon: (msg) => { if (msg.clear) clearRoomBeacons(); else setRoomBeacon(msg.action, msg.target, !!msg.on); },
  // Onboarding (prologue plugin): ask a first-time player whether they've played
  // a text game before, and — if not — walk them round the interface.
  // The cold open, before anything else the prologue has to say. The server is
  // deliberately holding the arrival prose and the tour offer until we echo back
  // `introdone` — on the last beat OR on a skip, whichever comes first.
  // `msg.skyline` is Coldwater's real building tiles (see coldwaterSkyline in
  // plugins/prologue/index.js) — the closing flythrough is the actual city. An
  // old server that doesn't send it falls back to a procedural block grid.
  // `msg.mode === 'log'` is the bottom rung of Display Mode: same beats, same
  // music, no picture — the server decides, because it owns the rung.
  intro_cinematic: (msg) => { playIntroCinematic(() => sendCmdSilent('introdone'), msg?.skyline, msg?.shore, { mode: msg?.mode }); },
  // Whether the player owns a tablet at all. Only the prologue ever says no — its
  // corridor has no device in it, and the clone vat on the far side issues one.
  tablet_access: (msg) => { setTabletAccess(msg?.has !== false); },
  // …and the moment it's issued: a chip in the smart bar that animates for attention,
  // opens the tablet and its walkthrough when tapped, and gives up after 25s.
  tablet_offer: () => { showTabletOffer(); },
  tour_offer: () => { offerInterfaceTour(); },
  tour_start: () => { startInterfaceTour(); },
  // `tutorial tablet`. The tour needs the device actually on screen, so if it
  // isn't we open it first and let the shell finish booting — startTabletTour
  // returns false rather than spotlighting nothing, and we try again once the
  // CRT ceremony is over. Gives up after that instead of polling forever.
  tour_tablet: () => {
    if (startTabletTour()) return;
    sendCmdSilent('tablet');
    setTimeout(() => startTabletTour(), 2200);
  },
  // The prologue's arrival monologue has finished landing in the log — safe now to
  // run whatever the interface tour's last step handed off (opening the tablet).
  // See tour.js armTourHandoff/consumeTourHandoff for why this is a server signal
  // and not a client-guessed delay: the monologue's length is scripted server-side
  // and can change without this file knowing.
  tutorial_prose_done: () => { consumeTourHandoff(); },
  sleep: (msg) => { appendHtml(msg.message, 'system'); setSleepBar(true, false); },

  // Authoritative sleep state, stamped on every command reply by the server (and
  // pushed when a dreamscape opens). The bar is driven from here ONLY — no client
  // guessing about whether a given message means you woke up.
  sleep_state: (msg) => setSleepBar(!!msg.sleeping, !!msg.dreaming),

  // A dream, mid-sleep. The blur exists so the room you dozed off in isn't
  // readable behind your eyelids — but the dream IS the thing you're meant to
  // read, so it surfaces the log while it lands and lets it sink back after.
  sleep_dream: (msg) => {
    appendHtml(`<span class="dream-line">${msg.message}</span>`, 'system');
    document.body.classList.add('dreaming-line');
    clearTimeout(_dreamClearTimer);
    _dreamClearTimer = setTimeout(() => document.body.classList.remove('dreaming-line'), 14000);
  },
  rent:         (msg) => { appendHtml(msg.message, 'help'); },
  unrent:       (msg) => { appendHtml(msg.message, 'help'); },
  lock:         (msg) => { appendMsg(msg.message, 'system'); },
  unlock:       (msg) => { appendMsg(msg.message, 'system'); },
  upgrade:      (msg) => { appendMsg(msg.message, 'system'); },
  pick_success: (msg) => { appendMsg(msg.message, 'system'); },
  pick_fail:    (msg) => { appendMsg(msg.message, 'system'); },

  sleep_tick: (msg) => {
    appendMsg(msg.message, 'system');
    if (state.player && msg.player_update) { Object.assign(state.player, msg.player_update); updateVitals(state.player); }
  },

  sleep_end: (msg) => {
    appendMsg(msg.message, 'system');
    setSleepBar(false, false);
    if (state.player && msg.player_update) { Object.assign(state.player, msg.player_update); updateVitals(state.player); }
  },

  zone_event: (() => {
    let _lookTimer = null;
    return (msg) => {
      // A refresh-only event (no message) just re-looks the room — don't print a blank line.
      if (msg.message) appendHtml(msg.message, 'zone-event');
      // Grid power cut: the server tags the cutout line with class="power-out".
      // Arm the flicker + pop and refresh brightness now, don't wait for the look debounce.
      if (msg.message && msg.message.includes('power-out')) { signalPowerOut(); refreshZoneVisibility(); }
      if (msg.refresh) { clearTimeout(_lookTimer); _lookTimer = setTimeout(() => sendCmdSilent('look'), 800); }
    };
  })(),
  // Aircraft overhead: a transient banner pinned to the top of the room pane (auto-fades),
  // not a scrollback line. Server rate-limits these per zone, so they don't accumulate.
  sky: (msg) => { showSkyBanner(msg.message); },
  // A new accolade logged against you. Corner stack, never scrollback — the
  // banner is the whole payoff of a system that is otherwise entirely private.
  accolade_unlocked: (msg) => { showAccoladeUnlock(msg); },
  emote: (msg) => {
    const el = appendHtml(msg.message, 'emote');
    // `butcherMs` also closes the loot panel (you're carving the corpse it was
    // showing); `progressMs` is the generic countdown any timed activity can
    // ask for — crafting uses it, and combat already sends it on its own type.
    if (msg.butcherMs) { closeLootPanel(); attachInlineProgress(el, msg.butcherMs); }
    else if (msg.progressMs && el) attachInlineProgress(el, msg.progressMs);
  },
  say: (msg) => { appendMsg(msg.message, 'say'); },
  // A player-authored /me. Its own type (not `emote`) purely so it can be tinted
  // apart — the server sends nothing else different about it. Rendered as TEXT,
  // never HTML: this is the one emote line whose words come from a player.
  emote_custom: (msg) => { appendMsg(msg.message, 'emote-me'); },

  inventory: (msg) => {
    updateInventoryCache(msg.items || [], msg.weight, msg.capacity);
    // A silent macro-driven refresh updates the cache only; a real `inventory`
    // (typed, or the quick-cmd) opens the tablet Gear app on its Inventory tab.
    if (!consumeSilentInventory()) import('./panels/tablet-os.js').then(m => m.openTabletToInventory());
  },

  gear: () => {
    // The gear payload carries only the equippable subset, not the full carried list,
    // so it must NOT feed the shared inventory cache (that's the `inventory` payload's
    // job — it backs smartbar has/lacks). Just open the tablet Gear loadout.
    import('./panels/tablet-os.js').then(m => m.openTabletToLoadout());
  },

  container_view: (msg) => {
    if (msg.mainMsg) appendHtml(msg.mainMsg, 'help');
    openContainerPanel(msg);
  },

  // A wardrobe is a container that answers with its own view. Refresh rather
  // than re-open when the panel is already up, so a hang/take/save doesn't wipe
  // the look the player is composing on the doll.
  wardrobe_view: (msg) => {
    if (msg.mainMsg) appendHtml(msg.mainMsg, 'help');
    if (getActiveWardrobeId()) refreshWardrobePanel(msg);
    else openWardrobePanel(msg);
  },

  // The Preparation Workspace. Refresh rather than re-open when it's already
  // up, so the panel doesn't flicker on every self-issued `workspace`.
  workspace_view: (msg) => {
    if (msg.mainMsg) appendHtml(msg.mainMsg, 'help');
    if (isWorkspaceOpen()) refreshWorkspacePanel(msg);
    else openWorkspacePanel(msg);
  },

  loot_view: (msg) => {
    if (msg.mainMsg) appendHtml(msg.mainMsg, 'help');
    openLootPanel(msg);
    // Looting a body puts its gear in your pack — the loot panel redraws itself, but
    // the Kit app behind it was left a corpse out of date.
    refreshTabletGearIfOpen();
  },

  container_error: (msg) => {
    if (getActiveWardrobeId()) showWardrobeNotify(msg.message);
    else showContainerNotify(msg.message);
  },

  stow: (msg) => {
    appendHtml(msg.message, 'help');
    const cid = getActiveContainerId() || getActiveWardrobeId();
    if (cid) sendCmdSilent(`opencontainer ${cid}`);
    else refreshTabletGearIfOpen();
  },

  pull: (msg) => {
    appendHtml(msg.message, 'help');
    const cid = getActiveContainerId() || getActiveWardrobeId();
    if (cid) sendCmdSilent(`opencontainer ${cid}`);
    else refreshTabletGearIfOpen();
  },

  stats: (msg) => {
    // At the bottom Display Mode rung the sheet is WRITTEN rather than opened.
    // `stats` used to have no log presence whatsoever, so the command silently
    // did nothing there — see the note in cmdStats.
    if (msg.render === 'log') { appendHtml(msg.message, 'help'); if (msg.player) updateVitals(msg.player); return; }
    renderStatsPanel(msg.stats);
    document.getElementById('stats-panel').classList.add('active');
    if (msg.player) updateVitals(msg.player);
  },

  skills: (msg) => {
    renderSkillsPanel(msg);
    document.getElementById('skills-panel').classList.add('active');
  },

  panel_data: (msg) => onPanelData(msg),
  panel_feed: (msg) => onPanelFeed(msg),
  panel_catalog: (msg) => onPanelCatalog(msg),
  who: (msg) => { appendHtml(msg.message, 'help'); },
  help: (msg) => { appendHtml(msg.message, 'help'); },
  examine: (msg) => { if (consumeExamineLogSuppression()) return; appendHtml(msg.message, 'help'); },
  // `take` adds the row and `drop` below already refreshes — the pair have to agree, or
  // the Kit app grows items it can never be seen losing.
  take: (msg) => { appendHtml(msg.message, 'help'); sendCmdSilent('look'); refreshTabletGearIfOpen(); },
  drop: (msg) => {
    appendHtml(msg.message, 'help');
    sendCmdSilent('look');
    refreshTabletGearIfOpen();
  },
  action: (msg) => {
    appendHtml(msg.message, 'help');
    if (msg.triggerLook) sendCmdSilent('look');
  },
  balance: (msg) => { appendHtml(msg.message, 'help'); },
  recipes: (msg) => {
    renderRecipesPanel(msg.recipes || []);
    document.getElementById('recipes-panel').classList.add('active');
  },
  mutations: (msg) => { appendHtml(msg.message, 'help'); },
  ideologies: (msg) => { appendHtml(msg.message, 'help'); },
  shop: (msg) => { appendHtml(msg.message, 'help'); },

  // Architect Tablet OS — one shared shell for Quests/Skills/Bank/Weather/
  // Vehicles/Properties/Settings (+ a pass-through tile to Corporation below).
  // One inbound message, two possible surfaces. The accessible tablet is a real
  // dialog rendered from the SAME payload rather than a parallel feature — so
  // every app that works in one works in the other, and a new app needs nothing
  // written here. See client/game/js/panels/tablet-a11y.js.
  tablet_panel: (msg) => { isA11yTablet() ? renderA11yTablet(msg) : openTabletPanel(msg); },
  // An app handed off to another UI (e.g. quests-app.js "Turn In" opening the
  // turn-in NPC's dialogue) — close the shell instead of re-rendering it.
  tablet_close: () => { closeTabletPanel(); closeA11yTablet(); },
  // The generic pick-one-of-N dialog (docs/audits/log-vs-dialog-audit.md).
  list_dialog: (msg) => { openListDialog(msg); },
  list_dialog_close: () => { closeListDialog(); },
  // Voidwalk staging (voidwalking) — the pre-crossing muster overlay.
  voidwalk_staging: (msg) => { openVoidwalkStaging(msg); },
  // A live line in the muster's private party comms — append without rebuilding
  // the overlay (keeps a half-typed message + scroll intact).
  voidwalk_staging_chat: (msg) => { appendVoidwalkChat(msg.line); },
  // A quest changed state server-side (objective ticked / completed / turned in) —
  // live-refresh the Tablet OS Quests app if it's open on that app (no-op otherwise).
  quest_update: () => { tabletQuestUpdate(); },
  // A structured beat for a quest's per-quest action log in the Tablet (start /
  // arrive / emote / objective / complete, tagged with quest_id). Bucketed by
  // quest and rendered on that quest's detail screen.
  quest_log: (msg) => { noteQuestLog(msg); },
  // Timed tile-task state (begin / finished / interrupted) — rendered with a
  // standout style so the 15s work window's start/end is obvious in the log.
  quest_task: (msg) => { appendHtml(msg.message, 'quest-task'); },

  // Corps (org) command results. Most just render text; the ones that move the
  // player's own credits also refresh the vitals HUD.
  corp_console:       (msg) => { openCorpConsole(msg); },
  corp_console_patch: (msg) => { updateCorpConsole(msg); },
  corp_map:           (msg) => { openCorpMap(msg); },
  corp_territory:     (msg) => { appendHtml(msg.message, 'help'); },
  corp_invest:        (msg) => { appendHtml(msg.message, 'help'); },
  corp_info:        (msg) => { appendHtml(msg.message, 'help'); },
  corp_roster:      (msg) => { appendHtml(msg.message, 'help'); },
  corp_invite:      (msg) => { appendHtml(msg.message, 'help'); },
  corp_joined:      (msg) => { appendHtml(msg.message, 'help'); },
  corp_left:        (msg) => { appendHtml(msg.message, 'help'); },
  corp_kick:        (msg) => { appendHtml(msg.message, 'help'); },
  corp_edit:        (msg) => { appendHtml(msg.message, 'help'); },
  corp_rank_update: (msg) => { appendHtml(msg.message, 'help'); },
  corp_hq_claim:    (msg) => { appendHtml(msg.message, 'help'); },
  corp_founded:     (msg) => { appendHtml(msg.message, 'help'); if (msg.player_update && state.player) { Object.assign(state.player, msg.player_update); updateVitals(state.player); } },
  corp_contribute:  (msg) => { appendHtml(msg.message, 'help'); if (msg.player_update && state.player) { Object.assign(state.player, msg.player_update); updateVitals(state.player); } },
  corp_withdraw:    (msg) => { appendHtml(msg.message, 'help'); if (msg.player_update && state.player) { Object.assign(state.player, msg.player_update); updateVitals(state.player); } },
  corp_disband:     (msg) => { appendHtml(msg.message, 'help'); removeCorpChannels(); if (msg.player_update && state.player) { Object.assign(state.player, msg.player_update); updateVitals(state.player); } },

  // The city map is the tablet Map app now — the standalone popup is retired. The
  // typed `map` command (server still returns a type:'map' payload) just opens the
  // tablet there; the minimap double-click routes through the same opener.
  map: () => { openTabletToMap(); },

  equip: (msg) => {
    // Desktop inventory/gear popups are retired. If the tablet Gear app is open,
    // refresh it so the change shows on the paperdoll; otherwise print the feedback.
    if (!refreshTabletGearIfOpen()) appendHtml(msg.message, 'help');
    refreshWeaponChip();
  },

  // The server's canonical "your inventory changed" ping (emitted on
  // `inventory.changed`). No payload — the Kit app refetches itself, and only if it's
  // open, so this is free when the tablet is closed.
  inventory_dirty: () => { refreshTabletGearIfOpen(); refreshWeaponChip(); },

  use: (msg) => {
    appendHtml(msg.message, 'loot');
    if (msg.player_update) updateVitals(msg.player_update);
    // Eating, drinking, mixing, filling, reloading, unpacking — every one of these
    // comes back as `use` and every one of them consumes or transforms a row. The
    // Kit app was left showing the ration you just ate. Not covered by the
    // `inventory_dirty` ping above because the consumption paths mutate directly and
    // don't emit; refreshing here is the belt to that braces.
    refreshTabletGearIfOpen();
  },

  dialogue: (msg) => { openDialogue(msg); },
  dialogue_shop: (msg) => { openShop(msg); },

  dialogue_end: (msg) => {
    closeDialogue();
    // END_CONVERSATION carries no message of its own (engine/graph.js), and an
    // empty one is a blank line in the log — which on the bottom Display Mode
    // rung, where the log is the whole game, a screen reader reads as nothing at
    // all happening.
    if (msg.message) appendMsg(msg.message, 'system');
  },

  status_tick: (msg) => {
    // Status messages (drug phases, withdrawal, effects) are server-authored and
    // carry HTML spans (msg-system, withdrawal-warning, …) — render, don't escape.
    for (const m of msg.messages) appendHtml(m, 'combat-incoming');
  },

  run_state: (msg) => {
    if (msg.message) appendMsg(msg.message, 'system');
    setRunState(msg.running);
  },

  resource_tick: (msg) => {
    for (const m of msg.messages) appendHtml(m, 'system');
    if (msg.player_update && state.player) {
      Object.assign(state.player, msg.player_update);
      updateVitals(state.player);
    }
  },

  player_update: (msg) => {
    if (state.player) { Object.assign(state.player, msg); updateVitals(state.player); }
    if (msg.mis_enabled !== undefined) {
      document.dispatchEvent(new CustomEvent('mis_state_update', { detail: { enabled: msg.mis_enabled, server_disabled: !!msg.mis_server_disabled } }));
    }
  },

  error: (msg) => {
    if (msg.message === 'Session lost. Refresh and reconnect.') {
      appendMsg('Session lost — reconnecting...', 'system');
      attemptAutoReauth();
      return;
    }
    // The server dropped a command for exceeding its rate limit — a macro loop
    // outran the throttle. Abort running macros so the loop stops rather than
    // keep firing commands the server will only keep rejecting.
    if (msg.code === 'rate_limit') abortMacros();
    // A `leave` issued from the poker bar when the server has no table for us:
    // the pane is stale, so drop it and re-show the room instead of the error.
    if (msg.closePoker) { sendCmdSilent('look'); return; }
    // A whisper we already echoed optimistically was rejected — pull it back out.
    if (msg.whisperFailed) rollbackSelfEcho(msg.whisperFailed);
    if (msg.player_update && state.player) { Object.assign(state.player, msg.player_update); updateVitals(state.player); }
    if (msg.html) appendHtml(msg.message, 'error'); else appendMsg(msg.message, 'error');
    // A blocked auto-walk step (locked door, encumbrance, water — anything the
    // move gates veto) comes back as an error. Route AROUND the blocked tile and
    // resume rather than hammer the wall; only dead-stop when there's no way past.
    if (isAutoWalking()) autoWalkBlocked('Auto-walk stopped — the way ahead is blocked.');
    if (document.getElementById('recipes-panel').classList.contains('active')) sendCmdSilent('recipes');
  },

  craft: (msg) => {
    appendHtml(msg.message, 'loot');
    if (msg.player_update && state.player) { Object.assign(state.player, msg.player_update); updateVitals(state.player); }
    if (document.getElementById('recipes-panel').classList.contains('active')) sendCmdSilent('recipes');
  },

  // Server-directed request to open a client UI (dialogue "Open Bank/Storage/
  // Crafting" Actions). Known panels run their own command; otherwise note it.
  open_ui: (msg) => {
    closeDialogue();
    const cmd = { bank: 'balance', crafting: 'recipes' }[msg.ui];
    if (cmd) sendCmd(cmd);
    else appendMsg(`(${msg.ui} interface requested)`, 'system');
  },

  // Both sides of a counter move an item between you and the vendor, so the Kit app has
  // to follow. Same reason as `use` above: commerce writes player_inventory directly
  // rather than through the emitting helpers.
  buy: (msg) => {
    appendHtml(msg.message, 'loot');
    if (msg.player_update && state.player) { Object.assign(state.player, msg.player_update); updateVitals(state.player); }
    refreshTabletGearIfOpen();
  },

  sell: (msg) => {
    appendHtml(msg.message, 'loot');
    if (msg.player_update && state.player) { Object.assign(state.player, msg.player_update); updateVitals(state.player); }
    refreshTabletGearIfOpen();
  },

  deposit: (msg) => {
    appendHtml(msg.message, 'loot');
    if (msg.player_update && state.player) { Object.assign(state.player, msg.player_update); updateVitals(state.player); }
    if (msg.atm_cash_stock != null) updateAtmPanel({ cashStock: msg.atm_cash_stock, allowance: msg.atm_allowance, ...msg.player_update });
  },

  withdraw: (msg) => {
    appendHtml(msg.message, 'loot');
    if (msg.player_update && state.player) { Object.assign(state.player, msg.player_update); updateVitals(state.player); }
    if (msg.atm_cash_stock != null) updateAtmPanel({ cashStock: msg.atm_cash_stock, allowance: msg.atm_allowance, ...msg.player_update });
  },

  jack: (msg) => {
    appendHtml(msg.message, 'loot');
    if (msg.atm_maintenance != null) updateAtmPanel({ maintenanceUnlocked: msg.atm_maintenance });
  },

  drain: (msg) => {
    appendHtml(msg.message, 'loot');
    playAtmDrainSfx();
    if (msg.player_update && state.player) { Object.assign(state.player, msg.player_update); updateVitals(state.player); }
    if (msg.atm_maintenance != null) updateAtmPanel({ maintenanceUnlocked: msg.atm_maintenance });
    if (msg.atm_cash_stock != null) updateAtmPanel({ cashStock: msg.atm_cash_stock, ...msg.player_update });
  },

  steal: (msg) => {
    appendHtml(msg.message, 'loot');
    if (msg.player_update && state.player) { Object.assign(state.player, msg.player_update); updateVitals(state.player); }
  },

  raise: (msg) => {
    appendHtml(msg.message, 'help');
    if (msg.player_update && state.player) { Object.assign(state.player, msg.player_update); updateVitals(state.player); }
  },

  loot: (msg) => {
    appendHtml(msg.message, 'loot');
    if (msg.closeLoot) { closeLootPanel(); sendCmdSilent('look'); }
  },
  mutation_gained: (msg) => { appendHtml(msg.message, 'combat-incoming'); },

  kicked: (msg) => {
    appendMsg(msg.message, 'error');
    closeConnection();
  },

  'environment.clockTick': (msg) => { updateEnvironmentHUD(msg); },
  'environment.zoneTempTick': (msg) => { updateZoneTempHUD(msg.tempC, msg); },
  'environment.sync': (msg) => { updateEnvironmentHUD(msg); updateForecast(msg.forecast); },
  'environment.daily': (msg) => { updateEnvironmentHUD(msg); updateForecast(msg.forecast); },
  'environment.weatherOverride': (msg) => { updateEnvironmentHUD(msg); },
  'weather_event': (msg) => { setWeatherEventFx(msg.eventType, msg.phase); setRainbowSky(msg.eventType, msg.phase); },
  'lightning': () => { triggerLightningFlash(); },
  'lightning_strike': (msg) => { flightSimLightning(msg); },

  output: (msg) => {
    // A GPS auto-walk that hit a numbered exit picker answers it itself (matching
    // its known target zone) — swallow the picker text rather than spam the log.
    if (msg.movePicker && resolveAutoWalkPicker(msg.movePicker)) return;
    // paneFallback: a log copy of something the room pane already shows. Only
    // worth printing when the pane isn't on screen (collapsed mobile).
    if (msg.paneFallback && isAreaPaneVisible()) return;
    appendHtml(msg.message, 'help');
  },
  // The lift has come to rest with its doors open on a floor. Nothing to show — the
  // rider already got the chime, the panel and the prose. This is purely so an
  // auto-walk riding the car knows the moment to step out.
  elevator_doors: (msg) => { notifyElevatorDoors(msg); },

  gps_route: (msg) => {
    // A background quest re-plot (routeToObjective/routeToTurnIn: continueOnArrival,
    // no prompt, no autostart) must not hijack a manual `gps` walk already in progress.
    // Replacing the route mid-walk would sail the player past their chosen one-shot
    // destination toward the quest objective — and, being a "continuing" leg, never
    // stop. Let the manual walk reach its target; the quest route re-plots on the next
    // quest event, by which point the player is standing still.
    const questReplot = msg.continueOnArrival === true && !msg.promptAutoWalk && !msg.autostart;
    if (questReplot && isManualAutoWalkInProgress()) return;
    if (msg.path) setGpsRoute(msg.path, msg.dirs);
    // Whether arriving should keep auto-walk armed for a following leg. Only routes
    // that declare it change the setting — an in-progress reroute omits it, so a quest
    // walk stays "continuing" across an off-course re-plot.
    if ('continueOnArrival' in msg) setAutoWalkPersist(msg.continueOnArrival);
    // A manual `gps` plot asks whether to auto-walk now (unless one's already in
    // flight, where resumeAuto quietly re-routes the walk in progress). In-progress
    // reroutes carry an empty message and promptAutoWalk:false — they just re-arm.
    if (msg.promptAutoWalk && !isAutoWalking()) {
      // Clickable, not just typeable. These are data-client-cmd links, answered
      // inside handleClientCommand and never sent to the server — see the note
      // in main.js's handleActionLinkClick. The typed y/n route still works and
      // is still advertised, because the whole point of a MUD is that you can
      // type it.
      const group = `autowalk-${Date.now()}`;
      appendHtml(`${msg.message} Auto-walk there now? `
        + `<span class="action-link prompt-link" data-client-cmd="y" data-client-group="${group}">Yes</span> `
        + `<span class="action-link prompt-link prompt-link-ghost" data-client-cmd="n" data-client-group="${group}">No</span> `
        + `<span class="hint">(or type y / n)</span>`, 'help');
      armAutoWalkPrompt();
      return;
    }
    if (msg.message) appendHtml(msg.message, 'help');
    if (msg.autostart) startAutoWalk(); else if (msg.resumeAuto) resumeAutoWalkIfArmed();
  },

  // `.debug` reveal — state lives only in localStorage. debug_toggle flips it;
  // debug_roll lines are always sent by the server but rendered only when on.
  debug_toggle: () => {
    const next = localStorage.getItem('mud_debug') !== '1';
    localStorage.setItem('mud_debug', next ? '1' : '0');
    appendHtml(`<span class="debug-roll">[debug] Roll reveal ${next ? 'ENABLED' : 'disabled'}.</span>`, 'system');
  },
  debug_roll: (msg) => {
    if (localStorage.getItem('mud_debug') === '1') appendHtml(msg.message, 'system');
  },
  // AMP cassette unlocks: full set at login, single new track on insert. These
  // only update the (possibly open) music panel's library — the insert command's
  // own system message carries the player-facing feedback.
  amp_unlocks: (msg) => applyAmpUnlocks(msg.songIds),
  amp_unlock:  (msg) => addAmpUnlock(msg.songId),
  progress: (msg) => { if (msg.done) clearInlineProgress(); },
  confirm: (msg) => { showConfirmDialog(msg); },

  // The SIFT disambiguation picker. `close` is its own message rather than an
  // absence, because a picker that has been answered has to take its dialog with
  // it — see panels/sift-select.js.
  sift_select: (msg) => { if (msg.close) closeSiftPanel(); else openSiftPanel(msg); },
  // Server asks the player to pick a quantity (e.g. dropping part of a stack).
  // Confirming appends the chosen number to the supplied command.
  qty_prompt: (msg) => {
    showAmountDialog(
      { title: msg.confirmLabel || 'Quantity', prompt: msg.prompt, confirmLabel: msg.confirmLabel || 'Confirm', min: 1, value: msg.max },
      (n) => sendCmd(`${msg.command} ${n}`, `${msg.command} ${n}`),
    );
  },
  arrest_notice: (msg) => { showArrestNotice(msg); },
  apprehend_prompt: (msg) => { openApprehendPrompt(msg); },
  conceal_search: (msg) => { openConcealSearch(msg); },

  // The rattle-can (plugins/graffiti `spray`) — per-letter paint over the shared
  // colour wheel, plus the player's shelf of saved designs. Everything it sends is
  // re-validated server-side; the panel decides nothing.
  spray_editor: (msg) => {
    if (msg.message) appendHtml(msg.message, 'system');
    openSprayCan(msg);
  },
  // The answer to a save or a bin: the whole shelf, never a delta, so the open panel
  // can't drift from the table. Ignored if the can is already shut.
  spray_shelf: (msg) => { updateSprayShelf(msg); },
  poker_update: (msg) => { setAreaPane(msg.html); },
  poker_sfx: (msg) => { playPokerSfx(msg.cue); },
  // The generic seated-table pane (chess today). Same treatment as the felt —
  // the server renders it whole and the client just hangs it up. Buttons and
  // squares inside carry .poker-cmd, so main.js's delegated listener drives it
  // with no code of its own.
  // …and chess then upgrades that flat pane in place: mountChess3D reads the
  // board back out of the markup the server just sent and redraws it as a real
  // 3D scene. If it can't (no canvas, a pane that isn't chess), the server's
  // own board is what stays on screen — which is why this runs AFTER, never
  // instead of, setAreaPane.
  table_update: (msg) => { setAreaPane(msg.html); mountChess3D(); },
  trade_update: (msg) => { updateTrade(msg.html); },
  trade_close: () => { closeTrade(); },
  // The unified 3D hangar-bay app (flight/hangars.js pushHangarBay) — floor +
  // charter/buy-rent/maintenance sub-screens, replacing the old paint modal +
  // fleet carousel.
  hangar_bay_open: (msg) => { openHangarBay(msg.data); },
  charter_open: (msg) => { if (msg.message) appendHtml(msg.message, 'system'); openCharterScreen(msg.data); },
  // Fires when the player walks out of a walk-in hangar (server-side zone.entered
  // listener). closeHangarBay() only tears down JS state — it doesn't repaint the
  // pane — so follow up with a silent look now that isHangarBayActive() is false.
  hangar_close: () => { closeHangarBay(); sendCmdSilent('look'); },
  admin_panel: (msg) => { openAdminPanel(msg.commands, msg.role); },

  online_change: () => { refreshOnlinePlayers(); },
  whisper: (msg) => { receiveWhisper(msg.from || 'Admin', msg.message); },
  whisper_sent: (msg) => { sentWhisper(msg.to, msg.message); },
  channel_msg: (msg) => { receiveChannelMsg(msg.channel, msg.from, msg.message); },

  channel_history: (msg) => { initChannelHistory(msg.history || {}); },
  motd: (msg) => { receiveMOTD(msg); },
  lightview: (msg) => { openLightViewDialog(msg); refreshZoneVisibility(); },
  morphex_panel: (msg) => { openMorphexPanel(msg.data); },
  // Server-side dismissal — the prologue's chargen terminal releases you the
  // moment the attendant accepts your shape, so its reaction isn't delivered to
  // the back of a modal the player is still standing in front of.
  morphex_close: () => { closeMorphexPanel(); },
  atm_panel: (msg) => { openAtmPanel(msg); },
  // The piano. `instrument_note` is somebody ELSE playing — the server excludes
  // the player from their own broadcast, because their client already sounded
  // that note the instant the key went down rather than waiting for a round trip.
  instrument_panel: (msg) => { openPianoPanel(msg); },
  instrument_note: (msg) => { onRoomNote(msg); },
  instrument_close: () => { closePianoPanel(); },
  // The card machine's face, its vend, and the pack-opening cinematic. All three
  // still echo `message` into the log — the overlay is the show, never the record,
  // so closing it (or an audio-off client) loses nothing but the presentation.
  cardmach_panel: (msg) => { openCardMachinePanel(msg); if (msg.message) appendHtml(msg.message, 'system'); },
  cardmach_vend: (msg) => {
    cardMachineVend(msg);
    if (msg.message) appendHtml(msg.message, 'loot');
    if (msg.credits != null && state.player) { state.player.credits = msg.credits; updateVitals(state.player); }
  },
  // The reveal is the show; `message` is the record and always prints. At the
  // bottom Display Mode rung the cinematic is suppressed and the record is all
  // you get — which this file's own note says loses nothing.
  cardpack_open: (msg) => { if (msg.render !== 'log') openPackReveal(msg); if (msg.message) appendHtml(msg.message, 'loot'); },
  // Same contract again: the cabinet is the show, the character box is the
  // record and always prints, so the bottom rung losing the panel loses nothing.
  slots_spin: (msg) => { if (msg.render !== 'log') openSlotsPanel(msg); if (msg.message) appendHtml(msg.message, 'loot'); },
  // The press is the show; `message` is the record and always prints, so the
  // bottom Display Mode rung keeps the whole two-step (mint / mintquote / mint
  // confirm) as text with nothing lost.
  card_mint_open: (msg) => { if (msg.render !== 'log') openCardMintPanel(msg); if (msg.message) appendHtml(msg.message, 'loot'); },
  card_mint_struck: (msg) => { cardMintStruck(msg); if (msg.message) appendHtml(msg.message, 'loot'); if (msg.credits != null && state.player) { state.player.credits = msg.credits; updateVitals(state.player); } },
  // Same shape as cardpack_open, and for the same reason: `message` carries the
  // whole sheet as characters and always prints, so the paper overlay is pure
  // theatre. The server stamps render:'log' at the bottom Display Mode rung.
  wanted_poster: (msg) => { if (msg.message) appendHtml(msg.message, 'loot'); if (msg.render !== 'log') openWantedPoster(msg); },
  insurance_panel: (msg) => { openInsurancePanel(msg); },
  insurance_action: (msg) => {
    appendHtml(msg.message, 'loot');
    if (msg.player_update && state.player) { Object.assign(state.player, msg.player_update); updateVitals(state.player); }
    if (msg.panel) updateInsurancePanel(msg.panel);
  },
  mediadeck_panel: (msg) => { openMediaDeckPanel(msg); },
  device_inspect_panel: (msg) => { openDeviceInspectPanel(msg); },
  deck_broadcast:  (msg) => { updateMediaDeckBroadcast(msg); },
  deck_overlay:    (msg) => { applyMediaDeckOverlay(msg.overlay); },
  // SPECTER's live hub, datachip replay, and firmware-install now open the tablet
  // Surveillance app (the standalone popups were retired). The server plugin is
  // unchanged, so `hub` / `use spy_deck` / `use datachip` still push these — we just
  // redirect them into the tablet. `hubclose` stops the server's 5s update stream
  // (the tablet self-polls), so the follow-up hub_update pushes are ignored.
  surveillance_hub: () => { openTabletToSpecter(); import('./net.js').then(m => m.sendCmdSilent('hubclose')); },
  surveillance_hub_update: () => { /* tablet self-polls; server push ignored */ },
  datachip_replay: (msg) => { openTabletToReel(msg.clip); },
  specter_install: (msg) => { openTabletSpecterInstall(msg); },
  wanted_level: (msg) => { updateWantedHud(msg.stars || 0); if (msg.heat != null) setWantedHeat(msg.heat); refreshCustomPanels(); },
  heat_level: (msg) => setWantedHeat(msg.heat || 0),
  camera_flash: () => {
    // A camera in the room caught a crime — flash the screen red. The room also
    // receives a zone_event line naming the suspect ("locking focus on …").
    let el = document.getElementById('camera-flash-overlay');
    if (!el) { el = document.createElement('div'); el.id = 'camera-flash-overlay'; document.body.appendChild(el); }
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  },
  crime_alert: () => {
    // A crime was charged nearby — a soft, low red pulse (not the hard camera
    // flash, not the full ESP lockdown). Paired with a short server-sent siren
    // one-shot (audio_sfx) that pitches faster than the ESP/tornado siren.
    let el = document.getElementById('crime-alert-overlay');
    if (!el) { el = document.createElement('div'); el.id = 'crime-alert-overlay'; document.body.appendChild(el); }
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  },
  circuit_hack: (msg) => {
    const resolveCmd = msg.resolveCmd || 'hijackresolve';
    const onResult = ({ won }) => sendCmdSilent(`${resolveCmd} ${msg.deviceId} ${won ? 1 : 0}`);
    const args = {
      skill: msg.skill ?? 4,
      difficulty: msg.difficulty ?? 5,
      onResult,
    };
    // Display Mode `textgames`/`log` — the same board drawn in characters. It is
    // the SAME game: same generator, same difficulty scaling, same guaranteed-
    // solvable route (see textbreach.js). If it can't open (generation failed),
    // fall back UP to the graphical one rather than leaving the player unable to
    // act — a rung with no implementation is never a dead end.
    if (autoResolved(msg, onResult)) return;
    if (msg.render === 'text' && openTextBreach({ ...args, deviceName: msg.deviceName || 'DEVICE' })) return;
    openCircuitHack({ ...args, atmName: msg.deviceName || 'DEVICE' });
  },

  // Tuning an implant. Reports a 0-100 SCORE rather than a win, like the synth
  // family — calibration is a graded quantity and a boolean would collapse it
  // into a coin flip. The score is worth at most ±15 against the server's own
  // electronics check, so this is advisory and the server decides.
  aug_calibration: (msg) => {
    const resolveCmd = msg.resolveCmd || 'calibrateresolve';
    const onResult = ({ score }) =>
      sendCmdSilent(`${resolveCmd} ${msg.augmentId} ${Math.round(score ?? 0)} ${msg.nonce}`);
    const args = {
      skill: msg.skill ?? 4,
      difficulty: msg.difficulty ?? 5,
      deviceName: msg.deviceName || 'IMPLANT',
      onResult,
    };
    if (autoResolved(msg, onResult)) return;
    if (msg.render === 'text' && openTextCalibration(args)) return;
    openCalibration(args);
  },

  signal_hijack: (msg) => {
    const resolveCmd = msg.resolveCmd || 'pirateresolve';
    const args = {
      skill: msg.skill ?? 4,
      difficulty: msg.difficulty ?? 5,
      stationName: msg.stationName || msg.deckName || 'STATION',
      onResult: ({ won }) => sendCmdSilent(`${resolveCmd} ${msg.deckId} ${won ? 1 : 0}`),
    };
    // Same capture — same carrier drift and hops, same decoys, same lock window.
    if (autoResolved(msg, args.onResult)) return;
    if (msg.render === 'text' && openTextSignal(args)) return;
    openSignalHijack(args);
  },

  // Nullcraft's intrusion board. Unlike every other family here it is TURN-BASED
  // — nothing moves unless the player moves it — so the middle rung is a true
  // equivalent rather than a reflex game rendered in characters.
  null_intrusion: (msg) => {
    const resolveCmd = msg.resolveCmd || 'nullresolve';
    const onResult = ({ won }) => sendCmdSilent(`${resolveCmd} ${msg.opId} ${won ? 1 : 0}`);
    const args = {
      skill: msg.skill ?? 4,
      difficulty: msg.difficulty ?? 5,
      targetName: msg.deviceName || 'DEVICE',
      subsystem: msg.subsystem || '',
      operation: msg.operation || '',
      onResult,
    };
    if (autoResolved(msg, onResult)) return;
    if (msg.render === 'text' && openTextNullBoard(args)) return;
    openNullBoard(args);
  },

  // The Long Watch's reaction beat (plugins/mastery). Unlike every other family
  // here it is armed by the game rather than requested by the player, and
  // LETTING IT LAPSE COSTS NOTHING — so there is no failure path to report when
  // the window simply closes.
  //
  // Note the client sends the CHOSEN WORD, not a verdict: the server holds which
  // answer was right. The `0|1` shape only appears at the log rung, where the
  // server produced the bit itself and `autoResolved` echoes it straight back.
  read_window: (msg) => {
    const resolveCmd = msg.resolveCmd || 'readresolve';
    const onResult = ({ won }) => sendCmdSilent(`${resolveCmd} ${msg.token} ${won ? 1 : 0}`);
    const args = {
      targetName: msg.deviceName || 'IT',
      tells: msg.tells || [],
      options: msg.options || [],
      ttlMs: msg.ttlMs ?? 2500,
      token: msg.token,
      resolveCmd,
      onChoice: (cmd) => sendCmdSilent(cmd),
    };
    if (autoResolved(msg, onResult)) return;
    if (msg.render === 'text' && openTextRead(args)) return;
    openReadWindow(args);
  },

  pirate_console: (msg) => openPirateConsole(msg),
  pirate_console_close: () => closePirateConsole(),

  hololock_game: (msg) => {
    const resolveCmd = msg.resolveCmd || 'hackresolve';
    const args = {
      skill: msg.skill ?? 4,
      difficulty: msg.difficulty ?? 5,
      deviceName: msg.deviceName || 'HOLOLOCK',
      onResult: ({ won }) => sendCmdSilent(`${resolveCmd} ${msg.doorId} ${won ? 1 : 0}`),
    };
    // Same lock, drawn in characters — same sweep speed, same sweet-zone width,
    // same miss penalty, because it is the same loop with the drawing swapped.
    if (autoResolved(msg, args.onResult)) return;
    if (msg.render === 'text' && openTextHololock(args)) return;
    openHololock(args);
  },

  // ── Psionics ─────────────────────────────────────────────────────────────
  // Four fragment meters, pick one, done in about four seconds. The strengths
  // were computed server-side before this arrived, so the board only chooses
  // WHICH authorised fragment to reveal. `autoResolved` covers the log rung, and
  // the text and graphical rungs are deliberately the same board — this surface
  // is four bars and a keypress, and a second skin would differ only in font.
  psychometry: (msg) => {
    const args = {
      itemId: msg.itemId,
      itemName: msg.itemName,
      fragments: msg.fragments || {},
      resolveCmd: msg.resolveCmd || 'psiresolve',
    };
    if (autoResolved(msg, () => {})) return;
    openPsychometry(args);
  },

  // A bite arms the CAST overlay (charge a power meter for depth, aim an angle).
  // The cast is reported via `fishcast`, which chooses the catch server-side and
  // replies with `fishing_fight`. The win/lose result still flows through the
  // same token via `fishresolve`.
  fishing_game: (msg) => {
    const castCmd = msg.castCmd || 'fishcast';
    const resolveCmd = msg.resolveCmd || 'fishresolve';
    const args = {
      skill: msg.skill ?? 4,
      difficulty: msg.castDifficulty ?? 5,   // nominal — just tunes the cast-stage feel
      deviceName: msg.deviceName || 'THE LINE',
      onCast: ({ power, angle }) => sendCmdSilent(`${castCmd} ${msg.zoneId} ${power.toFixed(3)} ${angle.toFixed(3)} ${msg.token}`),
      onResult: ({ won }) => sendCmdSilent(`${resolveCmd} ${msg.zoneId} ${won ? 1 : 0} ${msg.token}`),
    };
    // Same water, drawn in characters — same sweep, same gaff physics, same
    // creel-vs-tension race. Note this family is TWO-STAGE: the server picks the
    // catch from the cast and arms the fight through `fishing_fight` below, which
    // is why the skin has to stay mounted between the two.
    if (autoResolved(msg, args.onResult)) return;
    if (msg.render === 'text' && openTextFishing(args)) return;
    openFishing(args);
  },
  // The server picked the catch from the cast and armed the fight — continue the
  // open overlay into the reel stage tuned to the real catch difficulty.
  fishing_fight: (msg) => {
    armFishFight({ skill: msg.skill ?? 4, difficulty: msg.difficulty ?? 5 });
  },

  // ── Flight (cockpit HUD + takeoff/landing minigames) ─────────────────────
  cockpit_update: (msg) => { updateCockpit(msg.state); },
  cockpit_close: () => { closeCockpit(); closeTextCockpit(); sendCmdSilent('look'); },   // hand the area pane back to the room view
  // Text cockpit — the same top pane, drawn in characters for a text-mode pilot.
  // No canvas in this path at all; `cockpit_close` above hands the pane back.
  text_cockpit_open: (msg) => { openTextCockpit(msg); },
  text_cockpit: (msg) => { updateTextCockpit(msg); },
  cabin_audio: (msg) => { cabinAudio(msg.audio); },   // walkable-cabin occupants HEAR the engines without the HUD taking over the room
  // Continuous cockpit (client-sim + server-reconcile) — the Mayfly slice.
  flight_sim: (msg) => { openFlightSim(msg); },
  // Echelon helm console — takes over the client like the flight sim. Engaging the telegraph fires
  // the real `sail`; the ✕/Esc exit closes it and re-looks so the room description comes back cleanly.
  // `sky` seeds the real sim weather field; `transitMs` restores the lock if opened mid-passage.
  // ✕/Esc exit → `helm` toggles the server-side console closed (drops us from the viewer set), so a
  // later `helm` re-opens cleanly; the server's helm_close hands the pane back with a `look`.
  helm_open: (msg) => { openHelm({ gx: msg.gx, gy: msg.gy, heading: msg.heading, sky: msg.sky, map: msg.map, transitMs: msg.transitMs, transitTotal: msg.transitTotal, transitTiles: msg.transitTiles, cruise: msg.cruise, onSail: (dir, bell) => sendCmdSilent('sail ' + dir + (bell != null ? ' ' + bell : '')), onSailTo: (gx, gy, bell) => sendCmdSilent('sailto ' + gx + ' ' + gy + (bell != null ? ' ' + bell : '')), onStop: () => sendCmdSilent('stop'), onExit: () => sendCmdSilent('helm close') }); },
  helm_close: () => { closeHelm(); sendCmdSilent('look'); },
  helm_sky: (msg) => { if (isHelmActive()) helmSetSky(msg.sky); },   // live sim weather field, streamed like the flight sim's
  helm_contacts: (msg) => { if (isHelmActive()) helmSetContacts(msg.contacts); },   // planes over the Basin, drawn in the chase view
  // Passage complete → re-centre the chase view on the new tile's real world window, then unlock.
  helm_underway: (msg) => { if (isHelmActive()) helmBeginTransit(msg.dir, msg.tiles, msg.ms, msg.cruise, msg.path); },   // authoritative passage vector (+ bell + charted path) → chase view glides the full distance at the right speed
  helm_hold: (msg) => { if (isHelmActive()) helmEndTransit(msg.gx, msg.gy); },   // order refused (land ahead) → cancel the optimistic local glide, she stays put
  helm_arrived: (msg) => { if (!isHelmActive()) return; if (msg.map) helmSetWorld(msg.map, msg.gx, msg.gy); helmEndTransit(msg.gx, msg.gy); },
  yacht_underway: (msg) => { yachtUnderway(msg.level, msg.durationMs); },   // roar to life for the passage, at this zone's loudness
  yacht_settled: () => { yachtSettled(); },   // she's arrived — let the engine roar fall away
  // THE LONG HAUL. `truck_sim` opens the cab over the area pane (the same slot the cockpit and the
  // helm take); `truck_ctx` is the authoritative per-tick push (world window, odometer, surface).
  // The cab and the depot are both PANE OWNERS, so climbing into one has to hand the pane over
  // explicitly. `openCab` writes #area-content directly, which would tear the depot's DOM out from
  // under it while `isTruckDepotActive()` still answered true — and that flag is now what tells a
  // room description to keep its hands off the pane, so the room would never have painted again.
  truck_sim: (msg) => { closeTruckDepot(); openCab(msg); },
  truck_ctx: (msg) => { cabContext(msg); applyCbContext(msg.cb); },
  // THE CB. Handled here rather than inside the cab panel because the radio has to work at every
  // rung of Display Mode: a driver reading the text run has the same set, on the same channel, and
  // hears the same people. The panel is one of three sinks (see cb-radio.js), never the owner.
  cb_msg: (msg) => { receiveCbMsg(msg); },
  // The air horn. Pushed to everyone in the zone (plugins/trucking cmdHorn), so you hear somebody
  // else's rig go off in the yard as well as your own — which is the only reason a horn is a verb.
  truck_horn: (msg) => { airHorn(msg.typeId); },
  // Dismounting takes the set with it — the Deadhead window closes because the radio is gone,
  // not because anybody pressed anything on it.
  truck_sim_close: () => { closeCab(); clearCbContext(); },
  // The depot: fleet, dealer, freight board and exchange on one screen. Opens when you walk into
  // a yard and closes when you leave, exactly as the hangar bay does.
  // ⚠ NEVER OVER THE CAB. `drive` mounts the cab and, a beat later, the yard's own auto-open (or a
  // repush that was already in flight when you turned the key) lands and mounts the depot straight
  // back over the top of it. The player is behind the wheel — rig mounted, `drive` answering "you
  // are already behind the wheel" — and looking at a shop window. The cab is the pane owner from
  // the moment it opens, so a late depot push is dropped rather than raced against.
  truck_depot: (msg) => { if (isCabActive()) return; openTruckDepot(msg); },
  // …and it re-looks on the way out, the same as `hangar_close` does. Walking out of a yard fires
  // the move FIRST (which this panel, being a pane owner, correctly told to keep off the pane) and
  // the close SECOND — so without a fresh look the player is left staring at an empty pane. Skipped
  // when the cab has taken the pane over, because then you did not walk out, you drove.
  truck_depot_close: () => { closeTruckDepot(); if (!isCabActive()) sendCmdSilent('look'); },
  flight_ctx: (msg) => { flightSimContext(msg); },
  flight_contacts: (msg) => { flightSimContacts(msg); },   // air-to-air traffic (Phase A: see other craft)
  flight_aasites: (msg) => { flightSimAASites(msg); },     // active ground AA emplacements → 3D turret models
  air_hit: (msg) => { flightSimAirHit(msg); },             // air-to-air gun hit feedback (Phase B)
  flight_kill: (msg) => { flightSimKill(msg); },           // confirmed kill → big top-of-glass banner
  air_threat: (msg) => { flightSimAirThreat(msg); },       // RWR: missile lock/launch warnings + flare confirm (Phase C)
  aa_tracer: (msg) => { flightSimAaTracer(msg); },         // incoming ground-AA tracer streak
  // Admin fireworks show. Airborne viewers get the real 3D burst in the windshield;
  // on-foot players get a coloured sky-flash (skipped while the cockpit owns the pane —
  // they get the 3D burst instead) plus the weather-FX sky glow for the show's duration.
  fireworks_sim:   (msg) => { flightSimFireworks(msg); },
  // A shell climbing before it bursts: one tile away (or on the launch tile) on-foot players see
  // a streaking trail rise and detonate at its apex — the whistle is tuned to peak there. Farther
  // out there's no trail, just the sky-flash at detonation (fireworks_flash below).
  fireworks_launch: (msg) => {
    if (isFlightSimActive() || isFxIndoors()) return;   // airborne → 3D burst; indoors → heard only
    if ((msg.dist ?? 99) <= 1) launchFirework(msg.rgb, msg.lead);
  },
  fireworks_flash: (msg) => {
    if (isFlightSimActive()) return;   // airborne viewers get the real 3D windshield burst instead
    if (isFxIndoors()) return;         // indoors you only hear it — no sky-flash or bloom through the walls
    flashFirework(msg.rgb, msg.intensity);   // the concussion bloom at detonation (the particle burst rides the climbing shell)
  },
  fireworks_sky:   (msg) => { setFireworksGlow(!!msg.on); },
  flight_target: (msg) => {
    openTargeting({
      skill: msg.skill ?? 4,
      difficulty: msg.difficulty ?? 6,
      deviceName: msg.deviceName || 'TARGET',
      onResult: ({ won }) => sendCmdSilent(`strafresolve ${msg.token} ${won ? 1 : 0}`),
    });
  },

  // A concealment cabinet's passcode pad (plugins/concealment). The digits are
  // submitted with sendCmdSilent from inside the overlay, never echoed — that
  // privacy is the feature, not a nicety.
  conceal_keypad: (msg) => {
    if (msg.message) appendHtml(msg.message, 'system');
    openConcealKeypad(msg);
  },

  vault_crack: (msg) => {
    const resolveCmd = msg.resolveCmd || 'safecrackresolve';
    const args = {
      skill: msg.skill ?? 4,
      difficulty: msg.difficulty ?? 5,
      deviceName: msg.deviceName || 'VENDOR SAFE',
      onResult: ({ won }) => sendCmdSilent(`${resolveCmd} ${msg.safeId} ${won ? 1 : 0}`),
    };
    // Same safe — same contact points, same tolerance, same noisy gauge. The dial
    // just becomes a number you step rather than a wheel you drag, which also
    // makes it playable without a pointing device at all.
    if (autoResolved(msg, args.onResult)) return;
    if (msg.render === 'text' && openTextVault(args)) return;
    openVaultCrack(args);
  },

  synth_minigame: (msg) => {
    // This family has no character board, so at `textgames` it falls back UP to the
    // graphical one — correct, that rung's audience can see it. At `log` the server
    // resolved it with a skill check, because opening a canvas for a screen-reader
    // player is a dead end. It reports a SCORE, not a boolean, which is why the
    // helper hands both shapes to the callback.
    if (autoResolved(msg, ({ score }) => sendCmdSilent(msg.kind === 'splice'
      ? `spliceresolve ${msg.token} ${score}`
      : `synthresolve ${msg.recipeId} ${score} ${msg.nonce || ''}`.trim()))) return;
    if (msg.kind === 'splice') {
      // the master-tier orchestra (mix→pour→stir→stabilize→set)
      openSpliceStages({
        difficulty: msg.difficulty ?? 8,
        instability: msg.instability ?? 0,
        recipeName: msg.recipeName || 'COMPOUND',
        automated: msg.automated || [],
        autoScore: msg.autoScore ?? 70,
        onResult: ({ score }) => sendCmdSilent(`spliceresolve ${msg.token} ${score}`),
      });
    } else {
      // the cook game — family (from the drug's form) picks the single-stage minigame
      openSynthMinigame({
        family: msg.family || 'wet',
        form: msg.form || null,
        difficulty: msg.difficulty ?? 5,
        recipeName: msg.recipeName || 'COMPOUND',
        workspace: msg.workspace || '',
        test: msg.kind === 'test',   // dev cooktest → show the form-changer toolbar + loop
        onResult: ({ score }) => {
          if (msg.kind === 'test') return; // dev feel-test — verdict on-screen, no server resolve
          sendCmdSilent(`synthresolve ${msg.recipeId} ${score} ${msg.nonce || ''}`); // nonce: server rejects a resolve that wasn't armed
        },
      });
    }
  },

  cook_menu: (msg) => { openCookMenu(msg); },

  splice_designer: (msg) => { openSpliceSelect(msg); },

  splice_preview: (msg) => { applySplicePreview(msg); },
  splice_report: (msg) => { showSpliceReport(msg); },

  esp_state:   (msg) => { applyEspState(msg); },
  esp_warning: (msg) => { handleEspWarning(msg); },

  // `owner` (set by the broadcast plugin on TV playback) says which surface asked
  // for this song, so closing that surface can stop it without silencing a zone
  // theme or the player's own AMP tape — they all share one music player.
  audio_music: (msg) => { window.AudioEngine?.playMusic(msg.def, { restartIfSame: false, owner: msg.owner }); },
  audio_sfx: (msg) => { console.log('[audio] sfx received', msg.def?.id, msg.def?.name, 'gain', msg.gain ?? 1); window.AudioEngine?.playSfx(msg.def, (msg.gain ?? 1) * GAME_SFX_GAIN); },
  // Procedural cue: the server sent PARAMETERS and a seed, not layers. We build
  // the sound here from the shared generator — same seed, same field, ~100 bytes
  // on the wire instead of the several KB a serialised burst field costs.
  audio_sfx_proc: (msg) => {
    // ── The Sound Detail ladder, enforced in one place ──────────────────────
    //
    // `off` silences this whole layer. `full` is the dense tier — footsteps,
    // doors, locks — and a cue marked for it is DROPPED at any lower rung.
    //
    // The load-bearing half is what is NOT here: an unmarked cue is untouched,
    // so `limited` (what everybody who has never chosen gets, unless they play
    // at the log rung) is a provable no-op against every cue that shipped
    // before this existed. That is why the gate is a stamp on the new sounds
    // rather than a category on all of them.
    //
    // Client-side because the setting is localStorage and the server holds no
    // copy — a footstep is ~70 bytes, so sending one that gets dropped is far
    // cheaper than a new settings message and a server-side latch. If this tier
    // ever grows dense enough for that to stop being true, the growth path is
    // the one Display Mode already uses: latch it on the live player at login.
    const detail = sfxDetail(loadSettings(), state.player?.displayRung);
    if (detail === 'off') return;
    if (msg.tier === 'full' && detail !== 'full') return;
    const play = p => {
      const def = window.ProceduralSFX?.buildCookingCue(p);
      if (def) window.AudioEngine?.playSfx(def, (msg.gain ?? 1) * GAME_SFX_GAIN);
    };
    if (msg.series) { playSeries(msg.series, msg.params || {}, play); return; }
    play(msg.params || {});
  },
  audio_sample: (msg) => { console.log('[audio] sample received', msg.def?.id, msg.def?.name); window.AudioEngine?.playSample(msg.def); },
  audio_ambience: (msg) => { window.AudioEngine?.loopSound(msg.def); },
  audio_loop_gain: (msg) => { window.AudioEngine?.setLoopGain(msg.id, msg.gain, msg.ramp ?? 0.4); },
  audio_duck: (msg) => { window.AudioEngine?.duckLoop?.(msg.id, msg.fraction, msg.hold); },
  audio_stop: (msg) => { window.AudioEngine?.stop(msg.scope, msg.id); },
  audio_echo: (msg) => { window.AudioEngine?.setEcho?.(!!msg.on, msg); },

  sound_picker: (msg) => { openSoundPicker(msg.sfx || []); },

  device_power_flash: (msg) => { flashPowerChange(msg.mode, msg.deviceType); },

  trip_start: (msg) => { startTripFx(msg); setDrugFx('trip', msg.profile || 'psychedelic', msg.intensity ?? 0.6); },
  trip_event: (msg) => { appendHtml(renderMarkup(msg.text || ''), 'trip'); if (msg.palette || msg.intensity != null) { updateTripFx(msg); if (msg.intensity != null) setDrugFx('trip', msg.profile || 'psychedelic', msg.intensity); } },
  trip_fx:    (msg) => { updateTripFx(msg); if (msg.intensity != null) setDrugFx('trip', msg.profile || 'psychedelic', msg.intensity); },
  trip_end:   () => { endTripFx(); clearDrugFx('trip'); },

  // Sanity dread stream (sanity plugin). Its own FX channel so it composes with
  // a drug trip rather than fighting #trip-overlay: a dark creeping vignette
  // whose depth scales with intensity, plus body classes at the hallucination
  // and insane bands. band 'clear' / intensity 0 tears it all down.
  sanity_fx:  (msg) => { setSanityFx(msg); },

  // Dream / hallucination particle field. Drives the weather FX canvas directly,
  // ignoring the real weather and the indoor gate — ash falling in a windowless
  // corridor is the point. { effect: rain|snow|ash|fog|wind|none, intensity }.
  dream_fx:   (msg) => { setDreamFx(msg); },

  // "This room has no weather and no clock" (plugins/prologue, off flags.prologue).
  // Strips the weather readout from the HUD and scrambles the time — Coldwater's
  // forecast has no business showing over a corridor with no floor.
  env_unreal: (msg) => { setEnvUnreal(!!msg.unreal); },

  // Drunkenness level stream (intoxication plugin) → drives the drunk flight-view warp.
  intox_fx:   (msg) => { const lvl = Math.max(0, Math.min(100, Number(msg.level) || 0)); if (lvl <= 0) clearDrugFx('intox'); else setDrugFx('intox', 'drunk', lvl / 100); },

  blackout_start: () => { startBlackoutFx(); },
  blackout_end:   () => { endBlackoutFx(); },
};

// ── Blackout FX ──────────────────────────────────────────────────────────────
// Heavy intoxication drops a full-screen opaque black curtain: you can't see the
// room and the server refuses every command until it lifts (10–30s). Inline-styled
// like flashPowerChange so it needs no CSS. Fades in fast, out slow.
function startBlackoutFx() {
  let el = document.getElementById('blackout-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'blackout-overlay';
    el.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none;background:#000;opacity:0;transition:opacity .6s ease-in';
    document.body.appendChild(el);
  }
  requestAnimationFrame(() => { el.style.opacity = '1'; });
}

function endBlackoutFx() {
  const el = document.getElementById('blackout-overlay');
  if (!el) return;
  el.style.transition = 'opacity 1.4s ease-out';
  el.style.opacity = '0';
  setTimeout(() => el.remove(), 1500);
}

// ── Drug "trip" visual FX ────────────────────────────────────────────────────
// A persistent full-screen overlay (hue drift + pulse) plus a `tripping` body
// class that drives CSS blur/shake/glitch. Intensity + palette are live-tunable
// so the server can push peak/comedown changes. Palette → base hue.
const TRIP_PALETTES = { green: 120, purple: 280, red: 0, gold: 45, cyan: 190, magenta: 320, blue: 220 };

function updateTripFx(msg) {
  const hue = TRIP_PALETTES[msg.palette] ?? TRIP_PALETTES.green;
  const intensity = Math.max(0, Math.min(1, msg.intensity ?? 0.6));
  document.documentElement.style.setProperty('--trip-hue', String(hue));
  document.documentElement.style.setProperty('--trip-intensity', String(intensity));
}

function startTripFx(msg) {
  updateTripFx(msg);
  if (!document.getElementById('trip-overlay')) {
    const el = document.createElement('div');
    el.id = 'trip-overlay';
    document.body.appendChild(el);
  }
  document.body.classList.add('tripping');
}

// ── Rainbow light, in the room ───────────────────────────────────────────────
//
// The rainbow events are the only hero weather whose payload is the ROOM PROSE
// rather than an overlay: for the couple of minutes the arc stands, the text
// itself carries the colour. Three body classes and nothing else, because the
// shimmer belongs in CSS — that is where prefers-reduced-motion is honoured, in
// one place, for everybody, without this file knowing about it.
//
// Cleared on any other event type and on null, so a storm can never roll in over
// a still-shimmering room. Like every other weather-FX signal this is global
// rather than vantage-keyed: only the PROSE knows whether you can see the sky
// (server side, skyVantage), exactly as the ion storm's overlay already works.
function setRainbowSky(type, phase) {
  const bow = type === 'rainbow' || type === 'triple_rainbow';
  document.body.classList.toggle('rainbow-sky', bow);
  document.body.classList.toggle('rainbow-triple', type === 'triple_rainbow');
  document.body.classList.toggle('rainbow-peak', bow && phase === 'peak');
}

function endTripFx() {
  document.body.classList.remove('tripping');
  document.getElementById('trip-overlay')?.remove();
  window.AudioEngine?.stop('ambience', 'amb_trip_bed');
}

// ── Sanity "dread" visual FX ─────────────────────────────────────────────────
// A dark, desaturating creep — the scary cousin of the psychedelic trip FX. A
// #sanity-overlay vignette (edges close in, cold at the creep band, sick-red as
// it deepens) plus `unhinged` (hallucination band: slow uneasy sway + drain of
// colour) and `insane` (full breakdown) body classes. Intensity is live-tunable.
function setSanityFx(msg) {
  const intensity = Math.max(0, Math.min(1, msg?.intensity ?? 0));
  const band = msg?.band || 'clear';
  if (band === 'clear' || intensity <= 0) {
    document.body.classList.remove('unhinged', 'insane');
    document.getElementById('sanity-overlay')?.remove();
    window.AudioEngine?.stop('ambience', 'amb_dread_bed');
    return;
  }
  document.documentElement.style.setProperty('--sanity-intensity', String(intensity));
  if (!document.getElementById('sanity-overlay')) {
    const el = document.createElement('div');
    el.id = 'sanity-overlay';
    document.body.appendChild(el);
  }
  document.body.classList.toggle('unhinged', band === 'halluc' || band === 'insane');
  document.body.classList.toggle('insane', band === 'insane');
}

// Room-wide flash when a generator / junction box loses or regains power.
// Red stutter on power-down, a clean teal pulse on power-up; generators hit
// harder than junction boxes.
function flashPowerChange(mode, deviceType) {
  const down = mode === 'down';
  const tint = down ? 'rgba(255,42,52,' : 'rgba(42,236,212,';
  const peak = (deviceType === 'generator' ? 0.42 : 0.26).toFixed(2);
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;inset:0;z-index:9998;pointer-events:none;mix-blend-mode:screen;background:${tint}${peak});opacity:0;transition:opacity .08s ease-out`;
  document.body.appendChild(el);
  const blink = (on, after, dur) => setTimeout(() => { el.style.transition = `opacity ${dur}s ease-out`; el.style.opacity = on ? '1' : '0'; }, after);
  if (down) {
    // struggling stutter, then die to black
    blink(true, 0, 0.06); blink(false, 90, 0.05); blink(true, 150, 0.06); blink(false, 260, 0.5);
    setTimeout(() => el.remove(), 820);
  } else {
    blink(true, 0, 0.08); blink(false, 110, 0.55);
    setTimeout(() => el.remove(), 720);
  }
}

// A single fireworks burst as seen from the ground: a brief coloured flash blooming from
// the upper-middle of the view (where the sky is), using the same inline-styled screen-blend
// overlay trick as flashPowerChange so it needs no CSS. `intensity` (0..1, server-scaled by
// distance) drives the peak brightness — near the launch it's a full flash, rooms away it's a
// dim glow on the horizon.
function flashFirework(rgb, intensity) {
  const [r, g, b] = Array.isArray(rgb) ? rgb : [255, 220, 120];
  const peak = Math.max(0.05, Math.min(0.5, intensity ?? 0.4));
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;inset:0;z-index:9997;pointer-events:none;mix-blend-mode:screen;background:radial-gradient(circle at 50% 34%, rgba(${r},${g},${b},${peak}) 0%, rgba(${r},${g},${b},0) 62%);opacity:0;transition:opacity .09s ease-out`;
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  setTimeout(() => { el.style.transition = 'opacity .55s ease-out'; el.style.opacity = '0'; }, 110);
  setTimeout(() => el.remove(), 720);
}

export function handleServerMsg(msg) {
  const handler = handlers[msg.type];
  // A message with no handler is DROPPED SILENTLY, and that silence is why
  // `force_look` went six call sites and an entire project history without
  // anyone noticing it did nothing. Still a drop — an unknown type must never
  // break the stream — but it says so now, to the console, once per message.
  if (!handler) { console.debug(`[dispatch] no handler for '${msg.type}' — message dropped`); return; }
  // Never let one bad message (e.g. a malformed broadcast graphic) throw and break
  // the message stream — log it and carry on with the next server message.
  try {
    handler(msg);
  } catch (err) {
    console.error(`[dispatch] handler error for '${msg.type}':`, err);
  }
}

// Inline countdown bar appended to a timed-action line (e.g. butchering),
// styled like the combat HP indicators: " [████░░░░░░] 3s". It fills 0→full over
// durationMs and shows the remaining whole seconds, then removes itself — or a
// `progress done` message (interruption/early completion) tears it down first.
// Only one runs at a time; a new one clears any leftover.
const INLINE_PROGRESS_SEGMENTS = 10;
let inlineProgress = null;

function attachInlineProgress(lineEl, durationMs) {
  clearInlineProgress();
  const bar = document.createElement('span');
  bar.className = 'hpbar hp-high';
  const time = document.createElement('span');
  time.className = 'hp-count';
  lineEl.append(document.createTextNode(' '), bar, document.createTextNode(' '), time);

  const start = Date.now();
  const render = () => {
    const elapsed = Date.now() - start;
    const ratio = Math.min(1, elapsed / durationMs);
    const filled = Math.round(INLINE_PROGRESS_SEGMENTS * ratio);
    bar.textContent = `[${'█'.repeat(filled)}${'░'.repeat(INLINE_PROGRESS_SEGMENTS - filled)}]`;
    time.textContent = `${Math.max(0, Math.ceil((durationMs - elapsed) / 1000))}s`;
    if (ratio >= 1) clearInlineProgress();
  };
  const timer = setInterval(render, 200);
  inlineProgress = { bar, time, timer };
  render();
}

function clearInlineProgress() {
  if (!inlineProgress) return;
  clearInterval(inlineProgress.timer);
  inlineProgress.bar.remove();
  inlineProgress.time.remove();
  inlineProgress = null;
}

function openSoundPicker(sfxList) {
  const existing = document.getElementById('sound-picker-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'sound-picker-overlay';
  overlay.classList.add('modal-overlay'); overlay.style.cssText = 'background:rgba(0,0,0,0.7);display:flex;z-index:9999';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:var(--bg-panel,#1a1a1a);border:1px solid var(--border,#444);padding:20px;min-width:320px;display:flex;flex-direction:column;gap:12px;font-family:monospace';

  const title = document.createElement('div');
  title.textContent = 'Create Sound';
  title.style.cssText = 'color:var(--text-bright,#fff);font-size:0.875rem;font-weight:bold;letter-spacing:1px';

  const selectLabel = document.createElement('label');
  selectLabel.textContent = 'Sound FX:';
  selectLabel.style.cssText = 'color:var(--text-dim,#aaa);font-size:0.75rem';

  const select = document.createElement('select');
  select.style.cssText = 'background:var(--bg,#111);color:var(--text,#ccc);border:1px solid var(--border,#444);padding:4px 8px;font-family:monospace;font-size:0.75rem;width:100%';
  for (const s of sfxList) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    select.appendChild(opt);
  }

  const loudnessLabel = document.createElement('label');
  loudnessLabel.style.cssText = 'color:var(--text-dim,#aaa);font-size:0.75rem;display:flex;justify-content:space-between';
  const loudnessText = document.createElement('span');
  loudnessText.textContent = 'Loudness:';
  const loudnessVal = document.createElement('span');
  loudnessVal.textContent = '1.0';
  loudnessLabel.appendChild(loudnessText);
  loudnessLabel.appendChild(loudnessVal);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0.1';
  slider.max = '5';
  slider.step = '0.1';
  slider.value = '1.0';
  slider.style.cssText = 'width:100%;accent-color:var(--accent,#0af)';
  slider.addEventListener('input', () => { loudnessVal.textContent = parseFloat(slider.value).toFixed(1); });

  const buttons = document.createElement('div');
  buttons.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'background:transparent;color:var(--text-dim,#aaa);border:1px solid var(--border,#444);padding:4px 12px;font-family:monospace;cursor:pointer';
  cancelBtn.addEventListener('click', () => overlay.remove());

  const playBtn = document.createElement('button');
  playBtn.textContent = 'Play';
  playBtn.style.cssText = 'background:var(--accent,#0af);color:#000;border:none;padding:4px 12px;font-family:monospace;cursor:pointer;font-weight:bold';
  playBtn.addEventListener('click', () => {
    const id = select.value;
    const loudness = slider.value;
    if (id) sendCmd(`.playsound ${id} ${loudness}`);
    overlay.remove();
  });

  buttons.appendChild(cancelBtn);
  buttons.appendChild(playBtn);
  modal.appendChild(title);
  modal.appendChild(selectLabel);
  modal.appendChild(select);
  modal.appendChild(loudnessLabel);
  modal.appendChild(slider);
  modal.appendChild(buttons);
  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

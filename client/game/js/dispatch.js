import { state } from './state.js';
import { appendMsg, appendHtml, appendPre, updateVitals, parseZoneInfo, showDevPanelButton, setAreaPane, showSkyBanner } from './render.js';
import { sendCmd, sendCmdSilent, closeConnection, attemptAutoReauth, showVerifyScreen } from './net.js';
import { renderMinimap, setGpsRoute, setRunState, startAutoWalk, resumeAutoWalkIfArmed, setAutoWalkPersist, isAutoWalking, isManualAutoWalkInProgress, cancelAutoWalk, autoWalkBlocked, resolveAutoWalkPicker, armAutoWalkPrompt } from './panels/minimap.js';
import { updateEnvironmentHUD, updateZoneTempHUD, refreshZoneVisibility, signalPowerOut, isFxIndoors } from './panels/environment.js';
import { setWeatherEventFx, setFireworksGlow, launchFirework } from './panels/weather-fx.js';
import { openDialogue, closeDialogue, openShop, flashShopResult } from './panels/dialogue.js';
import { updateInventoryCache, consumeSilentInventory } from './panels/inventory-state.js';
import { renderRecipesPanel } from './panels/recipes.js';
import { renderStatsPanel } from './panels/stats.js';
import { renderSkillsPanel } from './panels/skills.js';
import { receiveWhisper, sentWhisper, receiveChannelMsg, initChannels, initChannelHistory, receiveMOTD, refreshOnlinePlayers, rollbackSelfEcho, removeCorpChannels } from './panels/whisper.js';
import { openContainerPanel, refreshContainerPanel, getActiveContainerId, showContainerNotify } from './panels/container.js';
import { openLootPanel, closeLootPanel } from './panels/loot.js';
import { openLightViewDialog } from './panels/lightview.js';
import { openMorphexPanel } from './panels/morphex.js';
import { updateForecast } from './panels/forecast.js';
import { openAtmPanel, closeAtmPanel, updateAtmPanel, playAtmDrainSfx } from './panels/atm.js';
import { openInsurancePanel, updateInsurancePanel } from './panels/insurance.js';
import { openCorpConsole, updateCorpConsole } from './panels/corp-console.js';
import { openTabletPanel, closeTabletPanel, tabletQuestUpdate, noteQuestLog, openTabletToSpecter, openTabletToReel, openTabletSpecterInstall, refreshTabletGearIfOpen, openTabletToMap, refreshTabletMapIfOpen } from './panels/tablet-os.js';
import { openCorpMap } from './panels/corp-map.js';
import { openMediaDeckPanel, updateMediaDeckBroadcast, applyMediaDeckOverlay } from './panels/mediadeck.js';
import { openDeviceInspectPanel, consumeExamineLogSuppression } from './panels/deviceinspect.js';
import { openCircuitHack } from './panels/circuithack.js';
import { openHololock } from './panels/hololock.js';
import { openSignalHijack } from './panels/signalhijack.js';
import { openPirateConsole, closePirateConsole } from './panels/piratedeck.js';
import { openFishing, armFishFight } from './panels/fishing.js';
import { abortMacros } from './panels/smartbar-macros.js';
import { updateCockpit, closeCockpit, openTakeoff, openGlideslope, openTargeting, openFlightSim, flightSimContext, flightSimContacts, flightSimAASites, flightSimAirHit, flightSimKill, flightSimAaTracer, flightSimAirThreat, flightSimFireworks, flightSimLightning, isFlightSimActive, isCockpitHudActive } from './panels/cockpit.js';
import { openHelm, closeHelm, isHelmActive, helmSetSky, helmSetWorld, helmSetContacts, helmEndTransit, helmBeginTransit } from './panels/helm-mode.js';
import { setYachtAmbience, yachtUnderway, yachtSettled } from './panels/yacht-ambience.js';
import { setDrugFx, clearDrugFx } from './panels/flight-drugfx.js';
import { openVaultCrack } from './panels/vaultcrack.js';
import { openSynthMinigame, openCookMenu } from './panels/synthlab.js';
import { openSpliceSelect, openSpliceStages, applySplicePreview } from './panels/splicelab.js';
import { showSpliceReport } from './panels/spliceReport.js';
import { updateWantedHud, setWantedHeat } from './panels/wanted.js';
import { openTvPanel, isTvOpen, getTvActiveChannelId, appendTvMessage, updateTvTicker, applyTvOverlay, clearTvMessages, showTvOffAir, showTvOnAir, shutdownTvPanel, tvSpeak, renderTvSchedule } from './panels/tv.js';
import { applyAmpUnlocks, addAmpUnlock } from './panels/musicplayer.js';
import { applyEspState, handleEspWarning } from './esp.js';
import { playPokerSfx } from './poker-sfx.js';
import { showConfirmDialog, showAmountDialog } from './panels/confirm.js';
import { showArrestNotice } from './panels/arrest.js';
import { openApprehendPrompt } from './panels/apprehend.js';
import { openConcealSearch } from './panels/conceal.js';
import { updateTrade, closeTrade } from './panels/trade.js';
import { openHangarBay, openCharterScreen, closeHangarBay, isHangarBayActive } from './panels/hangar-bay.js';
import { openAdminPanel } from './panels/admin.js';
import { renderMarkup } from './markup.js';
import { onPanelData, onPanelFeed, onPanelCatalog, syncPanels, refreshCustomPanels } from './panels/custom/manager.js';
import { loadSettings } from '/shared/settings.js';


const DEV_ROLES = ['admin', 'dev', 'builder', 'designer'];

// The station's spoken login greeting — the formant voice (seeded to a single
// steady "Architect" machine voice) welcomes the player by name. Mostly the plain
// line; rarely (~1 in 8) something quieter and more ominous — but always their name.
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
];
// State-aware ominous lines. Each reads a field already present on the auth
// payload (server/index.js livePlayer) — no extra query — and only qualifies
// when its `when` predicate matches, so the Architect sounds like it watched
// your last session. Mutations draw disapproval (bionics-approval is a later
// hook). Fires ~25% of the time an ominous roll lands AND ≥1 line qualifies.
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
];
function playWelcomeVoice(handle, player) {
  try {
    const audio = loadSettings().audio || {};
    if (audio.welcome === false) return;   // dedicated opt-out (TV Audio still gates it in speak())
    const name = (handle || 'operator').trim();
    let line = WELCOME_PLAIN;
    if (Math.random() < 0.125) {
      // Ominous roll landed. If any state line qualifies, ~25% chance to speak
      // a personalized one; otherwise fall back to the generic pool. Never
      // repeat the immediately-previous ominous line (localStorage-tracked).
      const last = (() => { try { return localStorage.getItem('welcome-voice-last'); } catch { return null; } })();
      const qualifying = player ? WELCOME_STATE.filter(s => s.when(player)) : [];
      let pool;
      if (qualifying.length && Math.random() < 0.25) pool = qualifying.map(s => s.line);
      else pool = WELCOME_OMINOUS;
      const fresh = pool.length > 1 ? pool.filter(l => l(name) !== last) : pool;
      line = (fresh.length ? fresh : pool)[Math.floor(Math.random() * (fresh.length ? fresh : pool).length)];
      try { localStorage.setItem('welcome-voice-last', line(name)); } catch { /* ignore */ }
    }
    // An auto-login connects with no click behind it, so the context is still
    // gesture-blocked here. Waiting means the greeting plays on first input
    // instead of being dropped (and no autoplay warning on the way out).
    window.AudioEngine?.onUnlock?.(() => window.AudioEngine.speak(line(name), { seed: 'architect' }));
  } catch { /* audio unavailable — no greeting */ }
}

// Keep the synthesized game SFX mellow — they sit under speech, music and
// ambience and shouldn't jump out. Scales every server-pushed SFX on top of
// whatever per-event gain the server already set. (Poker SFX have their own
// softening in poker-sfx.js.)
const GAME_SFX_GAIN = 0.6;

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
    if (msg.env) updateEnvironmentHUD(msg.env);
    else fetch('/api/environment/state').then(r => r.json()).then(updateEnvironmentHUD).catch(() => {});
    if (msg.apiToken) sessionStorage.setItem('devpanel-token', msg.apiToken);
    if (msg.reconnectToken) sessionStorage.setItem('reconnect-token', msg.reconnectToken);
    state.myRole = state.player.role;
    initChannels(msg.channels || []);
    if (DEV_ROLES.includes(state.player.role)) showDevPanelButton();
    if (wasReconnect) appendMsg('Reconnected.', 'system');
    else playWelcomeVoice(state.player.handle, state.player);   // spoken login greeting (fresh logins only)
    syncPanels(); // request data + cam catalog for any custom panels
  },

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
    if (!isFlightSimActive() && !isCockpitHudActive() && !isHangarBayActive() && !isHelmActive()) setAreaPane(msg.message);
    if (state.echoNextLook) { appendMsg('You look around.', 'system'); state.echoNextLook = false; }
    if (msg.zone) state.currentZone = msg.zone;
    setYachtAmbience(msg.ambience);   // naval on deck / engine below / null elsewhere
    parseZoneInfo(msg.message);
    if (msg.minimap) renderMinimap(msg.minimap);
    refreshZoneVisibility();
  },

  move: (msg) => {
    // Walking into a walk-in hangar races the server's `hangar_bay_open` push
    // against this plain-text room description — whichever lands second wins.
    // If the bay panel already won that race, don't stomp it; it owns the pane
    // until the player actually leaves (hangar_close triggers a fresh look).
    if (!isFlightSimActive() && !isCockpitHudActive() && !isHangarBayActive() && !isHelmActive()) setAreaPane(msg.message, msg.direction);
    if (msg.narration) appendHtml(msg.narration, 'move');
    state.currentZone = msg.zone;
    setYachtAmbience(msg.ambience);   // naval on deck / engine below / null elsewhere
    parseZoneInfo(msg.message);
    if (msg.radiation_gain > 0) appendMsg(`☢ +${msg.radiation_gain} radiation absorbed.`, 'system');
    if (state.player) { state.player.radiation = Math.min(100, (state.player.radiation || 0) + (msg.radiation_gain || 0)); updateVitals(state.player); }
    if (msg.minimap) renderMinimap(msg.minimap, msg.direction);
    if (msg.tempC !== undefined) updateZoneTempHUD(msg.tempC);
    refreshZoneVisibility(msg.visibility);   // absent on an old server ⇒ falls back to fetching
    refreshTabletMapIfOpen();
  },

  combat: (() => {
    let _lookTimer = null;
    return (msg) => {
      appendHtml(msg.message, msg.killed ? 'loot' : 'combat');
      if (msg.killed && msg.corpseLink) appendHtml(`${msg.corpseLink}`, 'loot');
      // Kill refreshes the area pane immediately; a non-kill hit refreshes it
      // (debounced) so the top pane shows the enemy's updated HP totals.
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
    // Death can land while any sticky area-pane app is open (flight cockpit, hangar
    // bay) or a modal overlay is up (dialogue/shop, trade, ATM, loot) — none of these
    // tear themselves down on their own for a death from an unrelated cause (combat,
    // radiation, seppuku, ...), and the flight/hangar panes explicitly block the
    // room `look` below from repainting over them. Force them all closed so death
    // always hands the screen back to the room.
    closeCockpit();
    closeHangarBay();
    closeDialogue();
    closeTrade();
    closeAtmPanel();
    closeLootPanel();
    setTimeout(() => { sendCmd('look'); }, 1500);
  },

  broadcast: (msg) => {
    if (msg.style === 'off_air') {
      if (isTvOpen() && getTvActiveChannelId() === msg.channel)
        showTvOffAir(msg.offlineGraphicContent || null, msg.offlineGraphicType || 'ascii');
      return;
    }
    if (isTvOpen() && getTvActiveChannelId() === msg.channel) {
      showTvOnAir();
      if (msg.style === 'ticker') updateTvTicker(msg.message);
      else { appendTvMessage(msg.message, msg.style, msg.duration, msg.hasGameday); tvSpeak(msg.message, msg.style, msg.duration); }
      if (msg.programName !== undefined) {
        const el = document.getElementById('tv-program-name');
        if (el) el.textContent = msg.programName || '';
      }
    }
  },
  broadcast_ambient: (msg) => {
    if (msg.speechText) appendMsg(`[TV] "${msg.speechText}"`, 'broadcast-ambient');
  },
  tv_panel: (msg) => { openTvPanel(msg); },
  tv_off:   ()    => { if (isTvOpen()) shutdownTvPanel(); },
  tv_overlay: (msg) => {
    if (isTvOpen() && getTvActiveChannelId() === msg.channelId) {
      applyTvOverlay(msg.overlay);
    }
  },
  tv_schedule: (msg) => { if (isTvOpen()) renderTvSchedule(msg); },
  system: (msg) => { appendHtml(msg.message, 'system'); },
  ambient: (msg) => { appendHtml(msg.message, 'ambient'); },
  sleep: (msg) => { appendHtml(msg.message, 'system'); },
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
  emote: (msg) => {
    const el = appendHtml(msg.message, 'zone-event');
    if (msg.butcherMs) { closeLootPanel(); attachInlineProgress(el, msg.butcherMs); }
  },
  say: (msg) => { appendMsg(msg.message, 'say'); },

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

  loot_view: (msg) => {
    if (msg.mainMsg) appendHtml(msg.mainMsg, 'help');
    openLootPanel(msg);
  },

  container_error: (msg) => {
    showContainerNotify(msg.message);
  },

  stow: (msg) => {
    appendHtml(msg.message, 'help');
    const cid = getActiveContainerId();
    if (cid) sendCmdSilent(`opencontainer ${cid}`);
    else refreshTabletGearIfOpen();
  },

  pull: (msg) => {
    appendHtml(msg.message, 'help');
    const cid = getActiveContainerId();
    if (cid) sendCmdSilent(`opencontainer ${cid}`);
    else refreshTabletGearIfOpen();
  },

  stats: (msg) => {
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
  take: (msg) => { appendHtml(msg.message, 'help'); sendCmdSilent('look'); },
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
  tablet_panel: (msg) => { openTabletPanel(msg); },
  // An app handed off to another UI (e.g. quests-app.js "Turn In" opening the
  // turn-in NPC's dialogue) — close the shell instead of re-rendering it.
  tablet_close: () => { closeTabletPanel(); },
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
  },

  use: (msg) => {
    appendHtml(msg.message, 'loot');
    if (msg.player_update) updateVitals(msg.player_update);
  },

  dialogue: (msg) => { openDialogue(msg); },
  dialogue_shop: (msg) => {
    openShop(msg);
    // A fresh server result (buy/sell) carries a *Result string — pulse the panel
    // green on success, shake it red on failure. Bare re-opens have no result.
    if (msg.buyResult) flashShopResult(!!msg.buySuccess);
    else if (msg.sellResult) flashShopResult(!!msg.sellSuccess);
  },

  dialogue_end: (msg) => {
    closeDialogue();
    appendMsg(msg.message, 'system');
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

  buy: (msg) => {
    appendHtml(msg.message, 'loot');
    if (msg.player_update && state.player) { Object.assign(state.player, msg.player_update); updateVitals(state.player); }
  },

  sell: (msg) => {
    appendHtml(msg.message, 'loot');
    if (msg.player_update && state.player) { Object.assign(state.player, msg.player_update); updateVitals(state.player); }
  },

  deposit: (msg) => {
    appendHtml(msg.message, 'loot');
    if (msg.player_update && state.player) { Object.assign(state.player, msg.player_update); updateVitals(state.player); }
    if (msg.atm_cash_stock != null) updateAtmPanel({ cashStock: msg.atm_cash_stock, ...msg.player_update });
  },

  withdraw: (msg) => {
    appendHtml(msg.message, 'loot');
    if (msg.player_update && state.player) { Object.assign(state.player, msg.player_update); updateVitals(state.player); }
    if (msg.atm_cash_stock != null) updateAtmPanel({ cashStock: msg.atm_cash_stock, ...msg.player_update });
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
  'weather_event': (msg) => { setWeatherEventFx(msg.eventType, msg.phase); },
  'lightning': () => { triggerLightningFlash(); },
  'lightning_strike': (msg) => { flightSimLightning(msg); },

  output: (msg) => {
    // A GPS auto-walk that hit a numbered exit picker answers it itself (matching
    // its known target zone) — swallow the picker text rather than spam the log.
    if (msg.movePicker && resolveAutoWalkPicker(msg.movePicker)) return;
    appendHtml(msg.message, 'help');
  },
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
      appendHtml(`${msg.message} Do you want to auto-walk there now? (y/n)`, 'help');
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
  poker_update: (msg) => { setAreaPane(msg.html); },
  poker_sfx: (msg) => { playPokerSfx(msg.cue); },
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
  atm_panel: (msg) => { openAtmPanel(msg); },
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
    openCircuitHack({
      skill: msg.skill ?? 4,
      difficulty: msg.difficulty ?? 5,
      atmName: msg.deviceName || 'DEVICE',
      onResult: ({ won }) => sendCmdSilent(`${resolveCmd} ${msg.deviceId} ${won ? 1 : 0}`),
    });
  },

  signal_hijack: (msg) => {
    const resolveCmd = msg.resolveCmd || 'pirateresolve';
    openSignalHijack({
      skill: msg.skill ?? 4,
      difficulty: msg.difficulty ?? 5,
      stationName: msg.stationName || msg.deckName || 'STATION',
      onResult: ({ won }) => sendCmdSilent(`${resolveCmd} ${msg.deckId} ${won ? 1 : 0}`),
    });
  },

  pirate_console: (msg) => openPirateConsole(msg),
  pirate_console_close: () => closePirateConsole(),

  hololock_game: (msg) => {
    const resolveCmd = msg.resolveCmd || 'hackresolve';
    openHololock({
      skill: msg.skill ?? 4,
      difficulty: msg.difficulty ?? 5,
      deviceName: msg.deviceName || 'HOLOLOCK',
      onResult: ({ won }) => sendCmdSilent(`${resolveCmd} ${msg.doorId} ${won ? 1 : 0}`),
    });
  },

  // A bite arms the CAST overlay (charge a power meter for depth, aim an angle).
  // The cast is reported via `fishcast`, which chooses the catch server-side and
  // replies with `fishing_fight`. The win/lose result still flows through the
  // same token via `fishresolve`.
  fishing_game: (msg) => {
    const castCmd = msg.castCmd || 'fishcast';
    const resolveCmd = msg.resolveCmd || 'fishresolve';
    openFishing({
      skill: msg.skill ?? 4,
      difficulty: msg.castDifficulty ?? 5,   // nominal — just tunes the cast-stage feel
      deviceName: msg.deviceName || 'THE LINE',
      onCast: ({ power, angle }) => sendCmdSilent(`${castCmd} ${msg.zoneId} ${power.toFixed(3)} ${angle.toFixed(3)} ${msg.token}`),
      onResult: ({ won }) => sendCmdSilent(`${resolveCmd} ${msg.zoneId} ${won ? 1 : 0} ${msg.token}`),
    });
  },
  // The server picked the catch from the cast and armed the fight — continue the
  // open overlay into the reel stage tuned to the real catch difficulty.
  fishing_fight: (msg) => {
    armFishFight({ skill: msg.skill ?? 4, difficulty: msg.difficulty ?? 5 });
  },

  // ── Flight (cockpit HUD + takeoff/landing minigames) ─────────────────────
  cockpit_update: (msg) => { updateCockpit(msg.state); },
  cockpit_close: () => { closeCockpit(); sendCmdSilent('look'); },   // hand the area pane back to the room view
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
  flight_takeoff: (msg) => {
    openTakeoff({
      skill: msg.skill ?? 4,
      difficulty: msg.difficulty ?? 5,
      vtol: !!msg.vtol,
      deviceName: msg.deviceName || 'CRAFT',
      airport: msg.airport,
      onResult: ({ won }) => sendCmdSilent(`takeoffresolve ${msg.token} ${won ? 1 : 0}`),
    });
  },
  flight_land: (msg) => {
    openGlideslope({
      skill: msg.skill ?? 4,
      difficulty: msg.difficulty ?? 5,
      emergency: !!msg.emergency,
      vtol: !!msg.vtol,
      deviceName: msg.deviceName || 'FIELD',
      airport: msg.airport,
      onResult: ({ won }) => sendCmdSilent(`landresolve ${msg.token} ${won ? 1 : 0}`),
    });
  },
  flight_target: (msg) => {
    openTargeting({
      skill: msg.skill ?? 4,
      difficulty: msg.difficulty ?? 6,
      deviceName: msg.deviceName || 'TARGET',
      onResult: ({ won }) => sendCmdSilent(`strafresolve ${msg.token} ${won ? 1 : 0}`),
    });
  },

  vault_crack: (msg) => {
    const resolveCmd = msg.resolveCmd || 'safecrackresolve';
    openVaultCrack({
      skill: msg.skill ?? 4,
      difficulty: msg.difficulty ?? 5,
      deviceName: msg.deviceName || 'VENDOR SAFE',
      onResult: ({ won }) => sendCmdSilent(`${resolveCmd} ${msg.safeId} ${won ? 1 : 0}`),
    });
  },

  synth_minigame: (msg) => {
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

  audio_music: (msg) => { window.AudioEngine?.playMusic(msg.def, { restartIfSame: false }); },
  audio_sfx: (msg) => { console.log('[audio] sfx received', msg.def?.id, msg.def?.name, 'gain', msg.gain ?? 1); window.AudioEngine?.playSfx(msg.def, (msg.gain ?? 1) * GAME_SFX_GAIN); },
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
  if (!handler) return;
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
  title.style.cssText = 'color:var(--text-bright,#fff);font-size:14px;font-weight:bold;letter-spacing:1px';

  const selectLabel = document.createElement('label');
  selectLabel.textContent = 'Sound FX:';
  selectLabel.style.cssText = 'color:var(--text-dim,#aaa);font-size:12px';

  const select = document.createElement('select');
  select.style.cssText = 'background:var(--bg,#111);color:var(--text,#ccc);border:1px solid var(--border,#444);padding:4px 8px;font-family:monospace;font-size:12px;width:100%';
  for (const s of sfxList) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    select.appendChild(opt);
  }

  const loudnessLabel = document.createElement('label');
  loudnessLabel.style.cssText = 'color:var(--text-dim,#aaa);font-size:12px;display:flex;justify-content:space-between';
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

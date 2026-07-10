import { state } from './state.js';
import { appendMsg, appendHtml, appendPre, updateVitals, parseZoneInfo, showDevPanelButton, setAreaPane } from './render.js';
import { sendCmd, sendCmdSilent, closeConnection, attemptAutoReauth, showVerifyScreen } from './net.js';
import { renderMinimap, openMapPopup, refreshMapIfOpen, setMapTerritory, setGpsRoute, setRunState, startAutoWalk } from './panels/minimap.js';
import { updateEnvironmentHUD, updateZoneTempHUD, refreshZoneVisibility, signalPowerOut } from './panels/environment.js';
import { setWeatherEventFx } from './panels/weather-fx.js';
import { openDialogue, closeDialogue, openShop, flashShopResult } from './panels/dialogue.js';
import { renderEquipPanel, renderGearPanel } from './panels/equipment.js';
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
import { openTabletPanel, closeTabletPanel, tabletQuestUpdate } from './panels/tablet-os.js';
import { openCorpMap } from './panels/corp-map.js';
import { openMediaDeckPanel, updateMediaDeckBroadcast, applyMediaDeckOverlay } from './panels/mediadeck.js';
import { openDeviceInspectPanel, consumeExamineLogSuppression } from './panels/deviceinspect.js';
import { openSurveillanceHub, updateSurveillanceHub } from './panels/surveillancehub.js';
import { openDatachipReplay } from './panels/datachipreplay.js';
import { openCircuitHack } from './panels/circuithack.js';
import { openHololock } from './panels/hololock.js';
import { openFishing } from './panels/fishing.js';
import { updateCockpit, closeCockpit, openTakeoff, openGlideslope, openTargeting, openFlightSim, flightSimContext, flightSimContacts, flightSimAirHit, flightSimAaTracer, isFlightSimActive, isCockpitHudActive } from './panels/cockpit.js';
import { setDrugFx, clearDrugFx } from './panels/flight-drugfx.js';
import { openVaultCrack } from './panels/vaultcrack.js';
import { openSynthMinigame, openCookMenu } from './panels/synthlab.js';
import { openSpliceSelect, openSpliceStages, applySplicePreview } from './panels/splicelab.js';
import { showSpliceReport } from './panels/spliceReport.js';
import { updateWantedHud, setWantedHeat } from './panels/wanted.js';
import { openTvPanel, isTvOpen, getTvActiveChannelId, appendTvMessage, updateTvTicker, applyTvOverlay, clearTvMessages, showTvOffAir, showTvOnAir, shutdownTvPanel } from './panels/tv.js';
import { applyAmpUnlocks, addAmpUnlock } from './panels/musicplayer.js';
import { applyEspState, handleEspWarning } from './esp.js';
import { playPokerSfx } from './poker-sfx.js';
import { showConfirmDialog } from './panels/confirm.js';
import { showArrestNotice } from './panels/arrest.js';
import { openApprehendPrompt } from './panels/apprehend.js';
import { openConcealSearch } from './panels/conceal.js';
import { updateTrade, closeTrade } from './panels/trade.js';
import { openHangarBay, openCharterScreen, closeHangarBay, isHangarBayActive } from './panels/hangar-bay.js';
import { openAdminPanel } from './panels/admin.js';
import { renderMarkup } from './markup.js';
import { onPanelData, onPanelFeed, onPanelCatalog, syncPanels, refreshCustomPanels } from './panels/custom/manager.js';


const DEV_ROLES = ['admin', 'dev', 'builder', 'designer'];

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
    if (!isFlightSimActive() && !isCockpitHudActive() && !isHangarBayActive()) setAreaPane(msg.message);
    if (state.echoNextLook) { appendMsg('You look around.', 'system'); state.echoNextLook = false; }
    if (msg.zone) state.currentZone = msg.zone;
    parseZoneInfo(msg.message);
    if (msg.minimap) renderMinimap(msg.minimap);
    refreshZoneVisibility();
  },

  move: (msg) => {
    // Walking into a walk-in hangar races the server's `hangar_bay_open` push
    // against this plain-text room description — whichever lands second wins.
    // If the bay panel already won that race, don't stomp it; it owns the pane
    // until the player actually leaves (hangar_close triggers a fresh look).
    if (!isFlightSimActive() && !isCockpitHudActive() && !isHangarBayActive()) setAreaPane(msg.message, msg.direction);
    if (msg.narration) appendHtml(msg.narration, 'move');
    state.currentZone = msg.zone;
    parseZoneInfo(msg.message);
    if (msg.radiation_gain > 0) appendMsg(`☢ +${msg.radiation_gain} radiation absorbed.`, 'system');
    if (state.player) { state.player.radiation = Math.min(100, (state.player.radiation || 0) + (msg.radiation_gain || 0)); updateVitals(state.player); }
    if (msg.minimap) renderMinimap(msg.minimap, msg.direction);
    if (msg.tempC !== undefined) updateZoneTempHUD(msg.tempC);
    refreshZoneVisibility();
    refreshMapIfOpen();
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
      else appendTvMessage(msg.message, msg.style, msg.duration);
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
      appendHtml(msg.message, 'zone-event');
      // Grid power cut: the server tags the cutout line with class="power-out".
      // Arm the flicker + pop and refresh brightness now, don't wait for the look debounce.
      if (msg.message && msg.message.includes('power-out')) { signalPowerOut(); refreshZoneVisibility(); }
      if (msg.refresh) { clearTimeout(_lookTimer); _lookTimer = setTimeout(() => sendCmdSilent('look'), 800); }
    };
  })(),
  emote: (msg) => {
    const el = appendHtml(msg.message, 'zone-event');
    if (msg.butcherMs) { closeLootPanel(); attachInlineProgress(el, msg.butcherMs); }
  },
  say: (msg) => { appendMsg(msg.message, 'say'); },

  inventory: (msg) => {
    renderEquipPanel(msg.items || [], msg.weight, msg.capacity);
    document.getElementById('equip-panel').classList.add('active');
  },

  gear: (msg) => {
    renderGearPanel(msg);
    document.getElementById('gear-panel').classList.add('active');
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
    else if (document.getElementById('equip-panel').classList.contains('active')) sendCmdSilent('inventory');
  },

  pull: (msg) => {
    appendHtml(msg.message, 'help');
    const cid = getActiveContainerId();
    if (cid) sendCmdSilent(`opencontainer ${cid}`);
    else if (document.getElementById('equip-panel').classList.contains('active')) sendCmdSilent('inventory');
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
    if (document.getElementById('equip-panel').classList.contains('active')) {
      sendCmdSilent('inventory');
    }
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
  factions: (msg) => { appendHtml(msg.message, 'help'); },
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

  map: (msg) => { openMapPopup(msg.tiles || [], msg.mode || 'zone', !!msg.insideInterior); },
  map_territory:      (msg) => { setMapTerritory(msg); },

  equip: (msg) => {
    const invOpen = document.getElementById('equip-panel').classList.contains('active');
    const gearOpen = document.getElementById('gear-panel').classList.contains('active');
    if (gearOpen) sendCmdSilent('gear');
    if (invOpen) sendCmdSilent('inventory');
    if (!invOpen && !gearOpen) appendHtml(msg.message, 'help');
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
    for (const m of msg.messages) appendMsg(m, 'system');
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
    // A `leave` issued from the poker bar when the server has no table for us:
    // the pane is stale, so drop it and re-show the room instead of the error.
    if (msg.closePoker) { sendCmdSilent('look'); return; }
    // A whisper we already echoed optimistically was rejected — pull it back out.
    if (msg.whisperFailed) rollbackSelfEcho(msg.whisperFailed);
    if (msg.player_update && state.player) { Object.assign(state.player, msg.player_update); updateVitals(state.player); }
    if (msg.html) appendHtml(msg.message, 'error'); else appendMsg(msg.message, 'error');
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

  output: (msg) => { appendHtml(msg.message, 'help'); },
  gps_route: (msg) => { appendHtml(msg.message, 'help'); if (msg.path) setGpsRoute(msg.path); if (msg.autostart) startAutoWalk(); },

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
  surveillance_hub: (msg) => { openSurveillanceHub(msg); },
  surveillance_hub_update: (msg) => { updateSurveillanceHub(msg); },
  datachip_replay: (msg) => { openDatachipReplay(msg); },
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

  hololock_game: (msg) => {
    const resolveCmd = msg.resolveCmd || 'hackresolve';
    openHololock({
      skill: msg.skill ?? 4,
      difficulty: msg.difficulty ?? 5,
      deviceName: msg.deviceName || 'HOLOLOCK',
      onResult: ({ won }) => sendCmdSilent(`${resolveCmd} ${msg.doorId} ${won ? 1 : 0}`),
    });
  },

  fishing_game: (msg) => {
    const resolveCmd = msg.resolveCmd || 'fishresolve';
    openFishing({
      skill: msg.skill ?? 4,
      difficulty: msg.difficulty ?? 5,
      deviceName: msg.deviceName || 'THE LINE',
      onResult: ({ won }) => sendCmdSilent(`${resolveCmd} ${msg.zoneId} ${won ? 1 : 0} ${msg.token}`),
    });
  },

  // ── Flight (cockpit HUD + takeoff/landing minigames) ─────────────────────
  cockpit_update: (msg) => { updateCockpit(msg.state); },
  cockpit_close: () => { closeCockpit(); sendCmdSilent('look'); },   // hand the area pane back to the room view
  // Continuous cockpit (client-sim + server-reconcile) — the Mayfly slice.
  flight_sim: (msg) => { openFlightSim(msg); },
  flight_ctx: (msg) => { flightSimContext(msg); },
  flight_contacts: (msg) => { flightSimContacts(msg); },   // air-to-air traffic (Phase A: see other craft)
  air_hit: (msg) => { flightSimAirHit(msg); },             // air-to-air gun hit feedback (Phase B)
  aa_tracer: (msg) => { flightSimAaTracer(msg); },         // incoming ground-AA tracer streak
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

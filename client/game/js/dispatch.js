import { state } from './state.js';
import { appendMsg, appendHtml, appendPre, updateVitals, parseZoneInfo, showDevPanelButton, setAreaPane } from './render.js';
import { sendCmd, sendCmdSilent, closeConnection, attemptAutoReauth, showVerifyScreen } from './net.js';
import { renderMinimap, openMapPopup } from './panels/minimap.js';
import { updateEnvironmentHUD, updateZoneTempHUD, refreshZoneVisibility } from './panels/environment.js';
import { openDialogue, closeDialogue, openShop } from './panels/dialogue.js';
import { renderEquipPanel } from './panels/equipment.js';
import { renderRecipesPanel } from './panels/recipes.js';
import { renderStatsPanel } from './panels/stats.js';
import { renderSkillsPanel } from './panels/skills.js';
import { receiveWhisper, sentWhisper, receiveChannelMsg, initChannels, initChannelHistory, receiveMOTD, refreshOnlinePlayers } from './panels/whisper.js';
import { openContainerPanel, refreshContainerPanel, getActiveContainerId, showContainerNotify } from './panels/container.js';
import { openLootPanel, closeLootPanel } from './panels/loot.js';
import { openLightViewDialog } from './panels/lightview.js';
import { openMorphexPanel } from './panels/morphex.js';
import { updateForecast } from './panels/forecast.js';
import { openAtmPanel, closeAtmPanel, updateAtmPanel } from './panels/atm.js';
import { openMediaDeckPanel } from './panels/mediadeck.js';
import { openTvPanel, isTvOpen, getTvActiveChannelId, appendTvMessage, updateTvTicker, applyTvOverlay, clearTvMessages, showTvOffAir, shutdownTvPanel } from './panels/tv.js';


const DEV_ROLES = ['admin', 'dev', 'builder', 'designer'];

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
    setAreaPane(msg.message);
    if (state.echoNextLook) { appendMsg('You look around.', 'system'); state.echoNextLook = false; }
    if (msg.zone) state.currentZone = msg.zone;
    parseZoneInfo(msg.message);
    if (msg.minimap) renderMinimap(msg.minimap);
    refreshZoneVisibility();
  },

  move: (msg) => {
    setAreaPane(msg.message, msg.direction);
    if (msg.narration) appendHtml(msg.narration, 'move');
    state.currentZone = msg.zone;
    parseZoneInfo(msg.message);
    if (msg.radiation_gain > 0) appendMsg(`☢ +${msg.radiation_gain} radiation absorbed.`, 'system');
    if (state.player) { state.player.radiation = Math.min(100, (state.player.radiation || 0) + (msg.radiation_gain || 0)); updateVitals(state.player); }
    if (msg.minimap) renderMinimap(msg.minimap, msg.direction);
    if (msg.tempC !== undefined) updateZoneTempHUD(msg.tempC);
    refreshZoneVisibility();
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
    setTimeout(() => { sendCmd('look'); }, 1500);
  },

  broadcast: (msg) => {
    if (msg.style === 'off_air') {
      if (isTvOpen() && getTvActiveChannelId() === msg.channel)
        showTvOffAir(msg.offlineGraphicContent || null, msg.offlineGraphicType || 'ascii');
      return;
    }
    if (isTvOpen() && getTvActiveChannelId() === msg.channel) {
      if (msg.style === 'ticker') updateTvTicker(msg.message);
      else appendTvMessage(msg.message, msg.style);
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
  system: (msg) => { appendMsg(msg.message, 'system'); },
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
      if (msg.refresh) { clearTimeout(_lookTimer); _lookTimer = setTimeout(() => sendCmdSilent('look'), 800); }
    };
  })(),
  emote: (msg) => { appendMsg(msg.message, 'zone-event'); },
  say: (msg) => { appendMsg(msg.message, 'say'); },

  inventory: (msg) => {
    renderEquipPanel(msg.items || [], msg.weight, msg.capacity);
    document.getElementById('equip-panel').classList.add('active');
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
  who: (msg) => { appendHtml(msg.message, 'help'); },
  help: (msg) => { appendHtml(msg.message, 'help'); },
  examine: (msg) => { appendHtml(msg.message, 'help'); },
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

  map: (msg) => { openMapPopup(msg.tiles || []); },

  equip: (msg) => {
    if (document.getElementById('equip-panel').classList.contains('active')) {
      sendCmdSilent('inventory');
    } else {
      appendHtml(msg.message, 'help');
    }
  },

  use: (msg) => {
    appendHtml(msg.message, 'loot');
    if (msg.player_update) updateVitals(msg.player_update);
  },

  dialogue: (msg) => { openDialogue(msg); },
  dialogue_shop: (msg) => { openShop(msg); },

  dialogue_end: (msg) => {
    closeDialogue();
    appendMsg(msg.message, 'system');
  },

  status_tick: (msg) => {
    for (const m of msg.messages) appendMsg(m, 'combat-incoming');
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
    appendMsg(msg.message, 'error');
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
  'environment.zoneTempTick': (msg) => { updateZoneTempHUD(msg.tempC); },
  'environment.sync': (msg) => { updateEnvironmentHUD(msg); updateForecast(msg.forecast); },
  'environment.daily': (msg) => { updateEnvironmentHUD(msg); updateForecast(msg.forecast); },
  'environment.weatherOverride': (msg) => { updateEnvironmentHUD(msg); },
  'lightning': () => { triggerLightningFlash(); },

  output: (msg) => { appendHtml(msg.message, 'help'); },

  online_change: () => { refreshOnlinePlayers(); },
  whisper: (msg) => { receiveWhisper(msg.from || 'Admin', msg.message); },
  whisper_sent: (msg) => { sentWhisper(msg.to, msg.message); },
  channel_msg: (msg) => { receiveChannelMsg(msg.channel, msg.from, msg.message); },

  channel_history: (msg) => { initChannelHistory(msg.history || {}); },
  motd: (msg) => { receiveMOTD(msg); },
  lightview: (msg) => { openLightViewDialog(msg); refreshZoneVisibility(); },
  morphex_panel: (msg) => { openMorphexPanel(msg.data); },
  atm_panel: (msg) => { openAtmPanel(msg); },
  mediadeck_panel: (msg) => { openMediaDeckPanel(msg); },

  audio_music: (msg) => { window.AudioEngine?.playMusic(msg.def); },
  audio_sfx: (msg) => { console.log('[audio] sfx received', msg.def?.id, msg.def?.name); window.AudioEngine?.playSfx(msg.def); },
  audio_sample: (msg) => { console.log('[audio] sample received', msg.def?.id, msg.def?.name); window.AudioEngine?.playSample(msg.def); },
  audio_ambience: (msg) => { window.AudioEngine?.loopSound(msg.def); },
  audio_stop: (msg) => { window.AudioEngine?.stop(msg.scope, msg.id); },
};

export function handleServerMsg(msg) {
  const handler = handlers[msg.type];
  if (handler) handler(msg);
}

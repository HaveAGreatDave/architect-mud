import { state } from './state.js';
import { appendMsg, appendHtml, appendPre, updateVitals, parseZoneInfo, showDevPanelButton, setAreaPane } from './render.js';
import { sendCmd, sendCmdSilent, closeConnection, attemptAutoReauth, showVerifyScreen } from './net.js';
import { renderMinimap, openMapPopup } from './panels/minimap.js';
import { updateEnvironmentHUD, updateZoneTempHUD, refreshZoneVisibility, signalPowerOut } from './panels/environment.js';
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
import { openMediaDeckPanel, updateMediaDeckBroadcast } from './panels/mediadeck.js';
import { openDeviceInspectPanel, consumeExamineLogSuppression } from './panels/deviceinspect.js';
import { openSurveillanceHub, updateSurveillanceHub } from './panels/surveillancehub.js';
import { openDatachipReplay } from './panels/datachipreplay.js';
import { openCircuitHack } from './panels/circuithack.js';
import { openSynthMinigame } from './panels/synthlab.js';
import { openSpliceDesigner, updateSplicePreview } from './panels/splicelab.js';
import { updateWantedHud } from './panels/wanted.js';
import { openTvPanel, isTvOpen, getTvActiveChannelId, appendTvMessage, updateTvTicker, applyTvOverlay, clearTvMessages, showTvOffAir, showTvOnAir, shutdownTvPanel } from './panels/tv.js';
import { applyEspState, handleEspWarning } from './esp.js';
import { playPokerSfx } from './poker-sfx.js';
import { showConfirmDialog } from './panels/confirm.js';
import { renderMarkup } from './markup.js';
import { onPanelData, onPanelFeed, onPanelCatalog, syncPanels } from './panels/custom/manager.js';


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
      // Grid power cut: the server tags the cutout line with class="power-out".
      // Arm the flicker + pop and refresh brightness now, don't wait for the look debounce.
      if (msg.message && msg.message.includes('power-out')) { signalPowerOut(); refreshZoneVisibility(); }
      if (msg.refresh) { clearTimeout(_lookTimer); _lookTimer = setTimeout(() => sendCmdSilent('look'), 800); }
    };
  })(),
  emote: (msg) => {
    const el = appendMsg(msg.message, 'zone-event');
    if (msg.butcherMs) { closeLootPanel(); attachInlineProgress(el, msg.butcherMs); }
  },
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

  // Corps (org) command results. Most just render text; the ones that move the
  // player's own credits also refresh the vitals HUD.
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
  corp_disband:     (msg) => { appendHtml(msg.message, 'help'); if (msg.player_update && state.player) { Object.assign(state.player, msg.player_update); updateVitals(state.player); } },

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
    // A `leave` issued from the poker bar when the server has no table for us:
    // the pane is stale, so drop it and re-show the room instead of the error.
    if (msg.closePoker) { sendCmdSilent('look'); return; }
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
  'environment.zoneTempTick': (msg) => { updateZoneTempHUD(msg.tempC, msg); },
  'environment.sync': (msg) => { updateEnvironmentHUD(msg); updateForecast(msg.forecast); },
  'environment.daily': (msg) => { updateEnvironmentHUD(msg); updateForecast(msg.forecast); },
  'environment.weatherOverride': (msg) => { updateEnvironmentHUD(msg); },
  'lightning': () => { triggerLightningFlash(); },

  output: (msg) => { appendHtml(msg.message, 'help'); },
  progress: (msg) => { if (msg.done) clearInlineProgress(); },
  confirm: (msg) => { showConfirmDialog(msg); },
  poker_update: (msg) => { setAreaPane(msg.html); },
  poker_sfx: (msg) => { playPokerSfx(msg.cue); },

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
  device_inspect_panel: (msg) => { openDeviceInspectPanel(msg); },
  deck_broadcast:  (msg) => { updateMediaDeckBroadcast(msg); },
  surveillance_hub: (msg) => { openSurveillanceHub(msg); },
  surveillance_hub_update: (msg) => { updateSurveillanceHub(msg); },
  datachip_replay: (msg) => { openDatachipReplay(msg); },
  wanted_level: (msg) => { updateWantedHud(msg.stars || 0); },
  circuit_hack: (msg) => {
    openCircuitHack({
      skill: msg.skill ?? 4,
      difficulty: msg.difficulty ?? 5,
      atmName: msg.deviceName || 'DEVICE',
      onResult: ({ won }) => sendCmdSilent(`hijackresolve ${msg.deviceId} ${won ? 1 : 0}`),
    });
  },

  synth_minigame: (msg) => {
    openSynthMinigame({
      difficulty: msg.difficulty ?? 5,
      recipeName: msg.recipeName || 'COMPOUND',
      workspace: msg.workspace || '',
      hard: !!msg.hard,
      instability: msg.instability,
      onResult: ({ score }) => sendCmdSilent(
        msg.kind === 'splice' ? `spliceresolve ${msg.token} ${score}` : `synthresolve ${msg.recipeId} ${score}`
      ),
    });
  },

  splice_designer: (msg) => { openSpliceDesigner(msg); },
  splice_preview:  (msg) => { updateSplicePreview(msg); },

  esp_state:   (msg) => { applyEspState(msg); },
  esp_warning: (msg) => { handleEspWarning(msg); },

  audio_music: (msg) => { window.AudioEngine?.playMusic(msg.def, { restartIfSame: false }); },
  audio_sfx: (msg) => { console.log('[audio] sfx received', msg.def?.id, msg.def?.name, 'gain', msg.gain ?? 1); window.AudioEngine?.playSfx(msg.def, (msg.gain ?? 1) * GAME_SFX_GAIN); },
  audio_sample: (msg) => { console.log('[audio] sample received', msg.def?.id, msg.def?.name); window.AudioEngine?.playSample(msg.def); },
  audio_ambience: (msg) => { window.AudioEngine?.loopSound(msg.def); },
  audio_loop_gain: (msg) => { window.AudioEngine?.setLoopGain(msg.id, msg.gain, msg.ramp ?? 0.4); },
  audio_duck: (msg) => { window.AudioEngine?.duckLoop?.(msg.id, msg.fraction, msg.hold); },
  audio_stop: (msg) => { window.AudioEngine?.stop(msg.scope, msg.id); },

  sound_picker: (msg) => { openSoundPicker(msg.sfx || []); },

  device_power_flash: (msg) => { flashPowerChange(msg.mode, msg.deviceType); },

  trip_start: (msg) => { startTripFx(msg); },
  trip_event: (msg) => { appendHtml(renderMarkup(msg.text || ''), 'trip'); if (msg.palette || msg.intensity != null) updateTripFx(msg); },
  trip_fx:    (msg) => { updateTripFx(msg); },
  trip_end:   () => { endTripFx(); },
};

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
  if (handler) handler(msg);
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

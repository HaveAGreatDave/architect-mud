import { state } from './state.js';
import { appendMsg, appendHtml, updateVitals, parseZoneInfo, showDevPanelButton } from './render.js';
import { sendCmd, sendCmdSilent, closeConnection } from './net.js';
import { renderMinimap, openMapPopup } from './panels/minimap.js';
import { updateEnvironmentHUD, refreshZoneVisibility } from './panels/environment.js';
import { openDialogue, closeDialogue } from './panels/dialogue.js';
import { renderEquipPanel } from './panels/equipment.js';
import { receiveWhisper } from './panels/whisper.js';
import { openLightViewDialog } from './panels/lightview.js';

const DEV_ROLES = ['admin', 'dev', 'builder', 'designer'];

const handlers = {
  connected: () => {},
  pong: () => {},

  auth_success: (msg) => {
    clearTimeout(state.authTimeout);
    state.authPending = false;
    state.player = msg.player;
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('handle-display').textContent = state.player.handle;
    updateVitals(state.player);
    if (msg.env) updateEnvironmentHUD(msg.env);
    else fetch('/api/environment/state').then(r => r.json()).then(updateEnvironmentHUD).catch(() => {});
    if (msg.apiToken) sessionStorage.setItem('devpanel-token', msg.apiToken);
    state.myRole = state.player.role;
    if (DEV_ROLES.includes(state.player.role)) showDevPanelButton();
  },

  auth_fail: (msg) => {
    clearTimeout(state.authTimeout);
    state.authPending = false;
    const submitBtn = document.getElementById('auth-submit');
    submitBtn.disabled = false;
    submitBtn.textContent = state.isRegister ? 'Register' : 'Enter';
    const errEl = document.getElementById('auth-error');
    errEl.textContent = msg.message;
    errEl.style.color = 'var(--red)';
  },

  look: (msg) => {
    appendMsg('─'.repeat(50), 'separator');
    appendHtml(msg.message, 'look');
    if (msg.zone) state.currentZone = msg.zone;
    parseZoneInfo(msg.message);
    if (msg.minimap) renderMinimap(msg.minimap);
    refreshZoneVisibility();
  },

  move: (msg) => {
    appendHtml(msg.message, 'look');
    state.currentZone = msg.zone;
    parseZoneInfo(msg.message);
    if (msg.radiation_gain > 0) appendMsg(`☢ +${msg.radiation_gain} radiation absorbed.`, 'system');
    if (state.player) { state.player.radiation = Math.min(100, (state.player.radiation || 0) + (msg.radiation_gain || 0)); updateVitals(state.player); }
    if (msg.minimap) renderMinimap(msg.minimap);
    refreshZoneVisibility();
  },

  combat: (msg) => {
    appendHtml(msg.message, msg.killed ? 'loot' : 'combat');
    if (msg.killed && msg.loot?.length) {
      appendMsg(`Loot: ${msg.loot.map(l => `${l.item_id} x${l.quantity}`).join(', ')}`, 'loot');
    }
  },

  combat_incoming: (msg) => {
    appendHtml(msg.message, 'combat-incoming');
    if (state.player) { state.player.hp = msg.hp; updateVitals(state.player); }
  },

  combat_miss: (msg) => { appendHtml(msg.message, 'system'); },

  player_death: (msg) => {
    appendHtml(msg.message, 'death');
    if (state.player && msg.player_update) { Object.assign(state.player, msg.player_update); updateVitals(state.player); }
    setTimeout(() => { sendCmd('look'); }, 1500);
  },

  ambient: (msg) => { appendHtml(msg.message, 'ambient'); },
  sleep: (msg) => { appendMsg(msg.message, 'system'); },

  sleep_tick: (msg) => {
    appendMsg(msg.message, 'system');
    if (state.player && msg.player_update) { Object.assign(state.player, msg.player_update); updateVitals(state.player); }
  },

  sleep_end: (msg) => {
    appendMsg(msg.message, 'system');
    if (state.player && msg.player_update) { Object.assign(state.player, msg.player_update); updateVitals(state.player); }
  },

  zone_event: (msg) => { appendMsg(msg.message, 'zone-event'); },
  emote: (msg) => { appendMsg(msg.message, 'zone-event'); },
  say: (msg) => { appendMsg(msg.message, 'say'); },

  inventory: (msg) => {
    renderEquipPanel(msg.items || []);
    document.getElementById('equip-panel').classList.add('active');
  },

  stats: (msg) => {
    appendHtml(msg.message, 'help');
    if (msg.player) updateVitals(msg.player);
  },

  skills: (msg) => { appendHtml(msg.message, 'help'); },
  who: (msg) => { appendHtml(msg.message, 'help'); },
  help: (msg) => { appendHtml(msg.message, 'help'); },
  examine: (msg) => { appendHtml(msg.message, 'help'); },
  take: (msg) => { appendHtml(msg.message, 'help'); },
  drop: (msg) => { appendHtml(msg.message, 'help'); },
  action: (msg) => { appendHtml(msg.message, 'help'); },
  balance: (msg) => { appendHtml(msg.message, 'help'); },
  recipes: (msg) => { appendHtml(msg.message, 'help'); },
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
  },

  error: (msg) => { appendMsg(msg.message, 'error'); },

  craft: (msg) => {
    appendHtml(msg.message, 'loot');
    if (msg.player_update && state.player) { Object.assign(state.player, msg.player_update); updateVitals(state.player); }
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
  },

  withdraw: (msg) => {
    appendHtml(msg.message, 'loot');
    if (msg.player_update && state.player) { Object.assign(state.player, msg.player_update); updateVitals(state.player); }
  },

  steal: (msg) => {
    appendHtml(msg.message, 'loot');
    if (msg.player_update && state.player) { Object.assign(state.player, msg.player_update); updateVitals(state.player); }
  },

  loot: (msg) => { appendHtml(msg.message, 'loot'); },
  mutation_gained: (msg) => { appendHtml(msg.message, 'combat-incoming'); },

  kicked: (msg) => {
    appendMsg(msg.message, 'error');
    closeConnection();
  },

  'environment.clockTick': (msg) => { updateEnvironmentHUD(msg, true); },
  'environment.sync': (msg) => { updateEnvironmentHUD(msg); },
  'environment.daily': (msg) => { updateEnvironmentHUD(msg); },
  'environment.weatherOverride': (msg) => { updateEnvironmentHUD(msg); },

  whisper: (msg) => { receiveWhisper(msg.from || 'Admin', msg.message); },
  lightview: (msg) => { openLightViewDialog(msg); },
};

export function handleServerMsg(msg) {
  const handler = handlers[msg.type];
  if (handler) handler(msg);
}

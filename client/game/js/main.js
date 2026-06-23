import { loadSettings, saveSettings, applySettings, initSettingsUI, SETTINGS_KEY } from '/shared/settings.js';
import { initNet, setWhoModalHandler, sendCmd, doAuth, closeConnection } from './net.js';
import { handleServerMsg } from './dispatch.js';
import { state } from './state.js';
import { initInput } from './input.js';
import { initEquipPanel } from './panels/equipment.js';
import { initDialogue } from './panels/dialogue.js';
import { initForecast } from './panels/forecast.js';
import { initWhisperPanel, debugFakeWhisper, toggleWhisperPanel } from './panels/whisper.js';
import { initWho, openWhoModal } from './panels/who.js';

// Settings
const settings = loadSettings();
if (!localStorage.getItem(SETTINGS_KEY) && window.innerWidth < 720) {
  settings.density = 'compact';
  settings.fontSize = '16';
}

applySettings(settings);
// saveAndApply is called after settings.js mutates the settings object in-place
initSettingsUI(settings, () => { saveSettings(settings); applySettings(settings); });

// Net / WebSocket
initNet(handleServerMsg);
setWhoModalHandler(openWhoModal);

// Auth form
document.getElementById('auth-submit').addEventListener('click', doAuth);
document.getElementById('auth-password').addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(); });
document.getElementById('auth-username').addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(); });
document.getElementById('auth-handle').addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(); });

document.getElementById('auth-toggle-link').addEventListener('click', () => {
  state.isRegister = !state.isRegister;
  document.getElementById('handle-field').classList.toggle('visible', state.isRegister);
  document.getElementById('auth-toggle-text').textContent = state.isRegister ? 'Have an account?' : 'No account?';
  document.getElementById('auth-toggle-link').textContent = state.isRegister ? 'Login' : 'Register';
  document.getElementById('auth-submit').textContent = state.isRegister ? 'Register' : 'Enter';
});

// Command input
initInput();

// Panels
initEquipPanel();
initDialogue();
initForecast();
initWhisperPanel();
initWho();

// Wire signout
document.getElementById('signout-btn').addEventListener('click', () => {
  const confirmed = confirm(
    "Sign out?\n\nYour body stays asleep exactly where you log out — it will remain in the world, vulnerable to anyone who finds it, until you return.\n\nMake sure you're somewhere safe (your apartment, locked) before signing out."
  );
  if (!confirmed) return;
  closeConnection();
  location.reload();
});

// Quick-cmd buttons
document.querySelectorAll('.qcmd[data-cmd]').forEach(btn => {
  btn.addEventListener('click', () => sendCmd(btn.dataset.cmd));
});
document.querySelector('.qcmd[data-open-equip]')?.addEventListener('click', () => {
  import('./panels/equipment.js').then(m => m.openEquipPanel());
});
document.getElementById('debug-whisper-btn')?.addEventListener('click', debugFakeWhisper);

// Mobile minimap tab
const mobileMapTab = document.getElementById('mobile-map-tab');
const mobileMapPanel = document.getElementById('mobile-minimap-panel');
const mobileMapClose = document.getElementById('mobile-map-close');
mobileMapTab?.addEventListener('click', () => {
  mobileMapPanel.classList.add('open');
  mobileMapPanel.setAttribute('aria-hidden', 'false');
});
mobileMapClose?.addEventListener('click', () => {
  mobileMapPanel.classList.remove('open');
  mobileMapPanel.setAttribute('aria-hidden', 'true');
});

// Mobile chat button
document.getElementById('mobile-chat-btn')?.addEventListener('click', toggleWhisperPanel);

// Output: click .action-link nodes to auto-run command
document.getElementById('output').addEventListener('click', (e) => {
  const el = e.target.closest('.action-link');
  if (!el) return;
  const action = el.dataset.action;
  const target = el.dataset.target;
  if (!action || !target) return;
  sendCmd(`${action} ${target.toLowerCase()}`);
});

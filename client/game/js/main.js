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

// Mobile minimap tab + drag
const mobileMapTab = document.getElementById('mobile-map-tab');
const mobileMapPanel = document.getElementById('mobile-minimap-panel');
const mobileMapClose = document.getElementById('mobile-map-close');

mobileMapTab?.addEventListener('click', () => {
  mobileMapPanel.classList.add('open');
  mobileMapPanel.setAttribute('aria-hidden', 'false');
  // Place near right edge on first open (needs to be visible to measure)
  if (!mobileMapPanel._placed) {
    mobileMapPanel._placed = true;
    requestAnimationFrame(() => {
      const r = mobileMapPanel.getBoundingClientRect();
      mobileMapPanel.style.left = (window.innerWidth - r.width - 2) + 'px';
      mobileMapPanel.style.top = Math.round((window.innerHeight - r.height) / 2) + 'px';
    });
  }
});

mobileMapClose?.addEventListener('click', () => {
  mobileMapPanel.classList.remove('open');
  mobileMapPanel.setAttribute('aria-hidden', 'true');
});

// Drag
if (mobileMapPanel) {
  let dragOffsetX = 0, dragOffsetY = 0;

  mobileMapPanel.addEventListener('pointerdown', (e) => {
    if (e.target === mobileMapClose) return;
    const r = mobileMapPanel.getBoundingClientRect();
    dragOffsetX = e.clientX - r.left;
    dragOffsetY = e.clientY - r.top;
    mobileMapPanel.setPointerCapture(e.pointerId);
  });

  mobileMapPanel.addEventListener('pointermove', (e) => {
    if (!mobileMapPanel.hasPointerCapture(e.pointerId)) return;
    const r = mobileMapPanel.getBoundingClientRect();
    const newLeft = Math.max(0, Math.min(window.innerWidth - r.width, e.clientX - dragOffsetX));
    const newTop = Math.max(0, Math.min(window.innerHeight - r.height, e.clientY - dragOffsetY));
    mobileMapPanel.style.left = newLeft + 'px';
    mobileMapPanel.style.top = newTop + 'px';
  });
}

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

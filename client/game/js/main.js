import { loadSettings, saveSettings, applySettings, initSettingsUI, SETTINGS_KEY } from '/shared/settings.js';
import { initNet, setWhoModalHandler, sendCmd, doAuth, doForgotPassword, doResetPassword, closeConnection } from './net.js';
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
const _isMobile = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 720;
if (!localStorage.getItem(SETTINGS_KEY) && _isMobile) {
  settings.density = 'compact';
  settings.fontSize = '16';
}

applySettings(settings);
// saveAndApply is called after settings.js mutates the settings object in-place
initSettingsUI(settings, () => { saveSettings(settings); applySettings(settings); }, {
  sendCmd,
  getOrigin: () => state.player?.origin_fragment || '',
  saveOrigin: async (text) => {
    const token = sessionStorage.getItem('devpanel-token');
    const res = await fetch('/api/players/me/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ origin_fragment: text }),
    }).then(r => r.json()).catch(() => ({ error: 'Request failed' }));
    if (res.error) { alert(res.error); return; }
    if (state.player) state.player.origin_fragment = text || 'A survivor. Still standing, somehow.';
  },
});

// Net / WebSocket
initNet(handleServerMsg);
setWhoModalHandler(openWhoModal);

// Auth form — restore remembered credentials
const _savedUser = localStorage.getItem('mud_remember_user');
const _savedPass = localStorage.getItem('mud_remember_pass');
if (_savedUser && _savedPass) {
  document.getElementById('auth-username').value = _savedUser;
  document.getElementById('auth-password').value = _savedPass;
  document.getElementById('auth-remember').checked = true;
}

document.getElementById('auth-submit').addEventListener('click', doAuth);
document.getElementById('auth-password').addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(); });
document.getElementById('auth-username').addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(); });
document.getElementById('auth-handle').addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(); });

document.getElementById('auth-toggle-link').addEventListener('click', () => {
  state.isRegister = !state.isRegister;
  document.getElementById('handle-field').classList.toggle('visible', state.isRegister);
  document.getElementById('sex-field').style.display = state.isRegister ? '' : 'none';
  document.getElementById('email-field').style.display = state.isRegister ? '' : 'none';
  document.getElementById('forgot-link-wrap').style.display = state.isRegister ? 'none' : '';
  document.getElementById('auth-toggle-text').textContent = state.isRegister ? 'Have an account?' : 'No account?';
  document.getElementById('auth-toggle-link').textContent = state.isRegister ? 'Login' : 'Register';
  document.getElementById('auth-submit').textContent = state.isRegister ? 'Register' : 'Enter';
});

// Forgot password — draggable window
const _forgotWindow = document.getElementById('forgot-window');
const _forgotHandle = document.getElementById('forgot-drag-handle');
let _fwOx = 0, _fwOy = 0;
_forgotHandle.addEventListener('pointerdown', e => {
  if (e.target.tagName === 'BUTTON') return;
  const r = _forgotWindow.getBoundingClientRect();
  _fwOx = e.clientX - r.left; _fwOy = e.clientY - r.top;
  _forgotWindow.style.transform = 'none';
  _forgotHandle.setPointerCapture(e.pointerId);
  _forgotHandle.style.cursor = 'grabbing';
  e.preventDefault();
});
_forgotHandle.addEventListener('pointermove', e => {
  if (!_forgotHandle.hasPointerCapture(e.pointerId)) return;
  const x = Math.max(0, Math.min(window.innerWidth  - _forgotWindow.offsetWidth,  e.clientX - _fwOx));
  const y = Math.max(0, Math.min(window.innerHeight - _forgotWindow.offsetHeight, e.clientY - _fwOy));
  _forgotWindow.style.left = x + 'px'; _forgotWindow.style.top = y + 'px';
});
_forgotHandle.addEventListener('pointerup', e => { _forgotHandle.style.cursor = 'grab'; });

function openForgotWindow() {
  document.getElementById('forgot-message').textContent = '';
  document.getElementById('forgot-email').value = '';
  _forgotWindow.style.display = '';
  _forgotWindow.style.transform = 'translateX(-50%)';
  _forgotWindow.style.left = '50%';
  _forgotWindow.style.top = '20%';
  const username = document.getElementById('auth-username').value.trim();
  document.getElementById('forgot-username').value = username;
  if (username) {
    fetch(`/api/auth/email-hint?username=${encodeURIComponent(username)}`)
      .then(r => r.json())
      .then(data => { document.getElementById('forgot-email').value = data.email || ''; })
      .catch(() => {});
  }
}

document.getElementById('auth-forgot-link').addEventListener('click', openForgotWindow);
document.getElementById('forgot-close-btn').addEventListener('click', () => { _forgotWindow.style.display = 'none'; });
document.getElementById('forgot-submit').addEventListener('click', doForgotPassword);
document.getElementById('forgot-email').addEventListener('keydown', e => { if (e.key === 'Enter') doForgotPassword(); });

// Reset password flow — detect token in URL
const _resetToken = new URLSearchParams(location.search).get('reset_token');
if (_resetToken) {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('reset-screen').style.display = '';
}
document.getElementById('reset-submit').addEventListener('click', () => doResetPassword(_resetToken));
document.getElementById('reset-back-link').addEventListener('click', () => {
  document.getElementById('reset-screen').style.display = 'none';
  document.getElementById('auth-screen').style.display = '';
  history.replaceState({}, '', location.pathname);
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
document.getElementById('open-map-btn')?.addEventListener('click', () => sendCmd('map'));

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
    e.preventDefault();
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

// Mobile output scroll — touchstart/move on #output scrolls it, ignoring
// touches that begin on the map tab button or the minimap panel.
{
  const output = document.getElementById('output');
  let scrollTouchId = null;
  let scrollStartY = 0;
  let scrollStartTop = 0;

  output.addEventListener('touchstart', (e) => {
    const touch = e.changedTouches[0];
    const hit = document.elementFromPoint(touch.clientX, touch.clientY);
    if (mobileMapTab?.contains(hit) || mobileMapPanel?.contains(hit)) return;
    scrollTouchId = touch.identifier;
    scrollStartY = touch.clientY;
    scrollStartTop = output.scrollTop;
  }, { passive: true });

  output.addEventListener('touchmove', (e) => {
    if (scrollTouchId === null) return;
    const touch = [...e.changedTouches].find(t => t.identifier === scrollTouchId);
    if (!touch) return;
    output.scrollTop = scrollStartTop - (touch.clientY - scrollStartY);
  }, { passive: true });

  output.addEventListener('touchend', (e) => {
    if ([...e.changedTouches].some(t => t.identifier === scrollTouchId)) {
      scrollTouchId = null;
    }
  }, { passive: true });
}

// Output: click .action-link nodes to auto-run command
document.getElementById('output').addEventListener('click', (e) => {
  const el = e.target.closest('.action-link');
  if (!el) return;
  const action = el.dataset.action;
  const target = el.dataset.target;
  if (!action || !target) return;
  sendCmd(`${action} ${target.toLowerCase()}`);
});

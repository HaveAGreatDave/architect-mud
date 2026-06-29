import { loadSettings, saveSettings, applySettings, initSettingsUI, initThemeEditorOverlay, listenForSettingsChanges, SETTINGS_KEY } from '/shared/settings.js';
import { appendMsg } from './render.js';
import { initNet, setWhoModalHandler, sendCmd, doAuth, doForgotPassword, doResetPassword, closeConnection, sendRaw } from './net.js';
import { handleServerMsg } from './dispatch.js';
import { state } from './state.js';
import { initInput } from './input.js';
import { initEquipPanel } from './panels/equipment.js';
import { initRecipesPanel } from './panels/recipes.js';
import { initContainerPanel } from './panels/container.js';
import { initLootPanel } from './panels/loot.js';
import { initDialogue } from './panels/dialogue.js';
import { initForecast } from './panels/forecast.js';
import { initWhisperPanel, debugFakeWhisper, toggleWhisperPanel } from './panels/whisper.js';
import { initWho, openWhoModal } from './panels/who.js';
import { initSidebarOrder } from './panels/sidebar-order.js';
import { refreshTempDisplay } from './panels/environment.js';
import { initAtmPanel } from './panels/atm.js';
import { initTvPanel } from './panels/tv.js';

// Settings
const settings = loadSettings();
const _isMobile = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 720;
if (!localStorage.getItem(SETTINGS_KEY) && _isMobile) {
  settings.density = 'compact';
  settings.fontSize = '16';
}

// In compact mode, override --font-size-base to fit the actual viewport rather than
// using the stored fontSize value (which was picked for a different screen size).
function applyMobileScale() {
  if (settings.density !== 'compact') return;
  // ~28px of content per character column fits comfortably; clamp between 10–18px.
  const byWidth = Math.floor(window.innerWidth / 28);
  const sz = Math.max(10, Math.min(18, byWidth));
  document.documentElement.style.setProperty('--font-size-base', sz + 'px');
}

applySettings(settings);
applyMobileScale();
window.addEventListener('resize', applyMobileScale);

// Collapse the room-description pane when the software keyboard opens so the
// output log and input bar get the full remaining viewport height.
if (window.visualViewport && _isMobile) {
  const _areaPane = document.getElementById('area-pane');
  let _fullVH = window.visualViewport.height;
  window.visualViewport.addEventListener('resize', () => {
    const keyboardUp = window.visualViewport.height < _fullVH * 0.75;
    _areaPane.style.maxHeight = keyboardUp ? '0' : '';
    _areaPane.style.overflow = keyboardUp ? 'hidden' : '';
    if (!keyboardUp) _fullVH = window.visualViewport.height;
  });
}

listenForSettingsChanges((s) => { applySettings(s); applyMobileScale(); });
// saveAndApply is called after settings.js mutates the settings object in-place
initSettingsUI(settings, () => { saveSettings(settings); applySettings(settings); applyMobileScale(); refreshTempDisplay(); }, {
  sendCmd,
  notify: (msg) => appendMsg(msg, 'system'),
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

initThemeEditorOverlay();
initSidebarOrder();

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
  // Auto-login is in flight (see net.js onOpen) — hide the form to avoid a flash
  document.getElementById('auth-screen').style.display = 'none';
}

document.getElementById('auth-submit').addEventListener('click', doAuth);
document.getElementById('auth-password').addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(); });
document.getElementById('auth-username').addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(); });
document.getElementById('auth-handle').addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(); });

document.getElementById('auth-toggle-link').addEventListener('click', () => {
  state.isRegister = !state.isRegister;
  document.getElementById('handle-field').classList.toggle('visible', state.isRegister);
  const misOn = !!localStorage.getItem('mis_client_enabled');
  document.getElementById('sex-field').style.display = state.isRegister ? '' : 'none';
  document.getElementById('sexuality-field').style.display = (state.isRegister && misOn) ? '' : 'none';
  document.getElementById('email-field').style.display = state.isRegister ? '' : 'none';
  document.getElementById('forgot-link-wrap').style.display = state.isRegister ? 'none' : '';
  document.getElementById('auth-toggle-text').textContent = state.isRegister ? 'Have an account?' : 'No account?';
  document.getElementById('auth-toggle-link').textContent = state.isRegister ? 'Login' : 'Register';
  document.getElementById('auth-submit').textContent = state.isRegister ? 'Register' : 'Enter';
});

function _makeDraggable(window, handle) {
  let ox = 0, oy = 0;
  handle.addEventListener('pointerdown', e => {
    if (e.target.tagName === 'BUTTON') return;
    const r = window.getBoundingClientRect();
    ox = e.clientX - r.left; oy = e.clientY - r.top;
    window.style.transform = 'none';
    handle.setPointerCapture(e.pointerId);
    handle.style.cursor = 'grabbing';
    e.preventDefault();
  });
  handle.addEventListener('pointermove', e => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    const x = Math.max(0, Math.min(globalThis.innerWidth  - window.offsetWidth,  e.clientX - ox));
    const y = Math.max(0, Math.min(globalThis.innerHeight - window.offsetHeight, e.clientY - oy));
    window.style.left = x + 'px'; window.style.top = y + 'px';
  });
  handle.addEventListener('pointerup', () => { handle.style.cursor = 'grab'; });
}

// Forgot password window
const _forgotWindow = document.getElementById('forgot-window');
_makeDraggable(_forgotWindow, document.getElementById('forgot-drag-handle'));

function fetchEmailForUsername(username) {
  const errEl = document.getElementById('forgot-username-error');
  const btn = document.getElementById('forgot-submit');
  if (!username) {
    document.getElementById('forgot-email').value = '';
    state.send_password = '';
    errEl.style.display = 'none';
    btn.disabled = true;
    return;
  }
  fetch(`/api/auth/email-hint?username=${encodeURIComponent(username)}`)
    .then(r => r.json())
    .then(data => {
      if (data.email) {
        state.send_password = data.email;
        document.getElementById('forgot-email').value = data.hint || '';
        errEl.style.display = 'none';
        btn.disabled = false;
      } else {
        state.send_password = '';
        document.getElementById('forgot-email').value = '';
        errEl.textContent = 'Username not found.';
        errEl.style.display = '';
        btn.disabled = true;
      }
    })
    .catch(() => {});
}

function openForgotWindow() {
  document.getElementById('forgot-message').textContent = '';
  document.getElementById('forgot-email').value = '';
  state.send_password = '';
  document.getElementById('forgot-username-error').style.display = 'none';
  document.getElementById('forgot-submit').disabled = true;
  _forgotWindow.style.display = '';
  _forgotWindow.style.transform = 'translateX(-50%)';
  _forgotWindow.style.left = '50%';
  _forgotWindow.style.top = '20%';
  const username = document.getElementById('auth-username').value.trim();
  document.getElementById('forgot-username').value = username;
  fetchEmailForUsername(username);
}

document.getElementById('auth-forgot-link').addEventListener('click', openForgotWindow);
document.getElementById('forgot-close-btn').addEventListener('click', () => { _forgotWindow.style.display = 'none'; });
document.getElementById('forgot-submit').addEventListener('click', doForgotPassword);
document.getElementById('forgot-email').addEventListener('keydown', e => { if (e.key === 'Enter') doForgotPassword(); });

// Look up email whenever username is typed in the forgot window
let _forgotUsernameTimer = null;
document.getElementById('forgot-username').addEventListener('input', e => {
  clearTimeout(_forgotUsernameTimer);
  _forgotUsernameTimer = setTimeout(() => fetchEmailForUsername(e.target.value.trim()), 400);
});

// Reset password window
const _resetWindow = document.getElementById('reset-screen');
_makeDraggable(_resetWindow, document.getElementById('reset-drag-handle'));
document.getElementById('reset-close-btn').addEventListener('click', () => {
  _resetWindow.style.display = 'none';
  history.replaceState({}, '', location.pathname);
});

// Detect reset token in URL
const _resetToken = new URLSearchParams(location.search).get('reset_token');
if (_resetToken) {
  document.getElementById('auth-screen').style.display = 'none';
  _resetWindow.style.display = '';
}
document.getElementById('reset-submit').addEventListener('click', () => doResetPassword(_resetToken));

// Command input
initInput();

// Panels
initEquipPanel();
initRecipesPanel();
initContainerPanel();
initLootPanel();
initDialogue();
initForecast();
initWhisperPanel();
initWho();
initAtmPanel();
initTvPanel();

// Wire signout
document.getElementById('signout-btn').addEventListener('click', () => {
  const confirmed = confirm(
    "Sign out?\n\nYour body stays asleep exactly where you log out — it will remain in the world, vulnerable to anyone who finds it, until you return.\n\nMake sure you're somewhere safe (your apartment, locked) before signing out."
  );
  if (!confirmed) return;
  // Flag to prevent auto-login on next page load
  sessionStorage.setItem('signed-out', '1');
  sessionStorage.removeItem('reconnect-token');
  sessionStorage.removeItem('game-switch-token');
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
window._sendRaw = sendRaw;
document.getElementById('open-map-btn')?.addEventListener('click', () => sendCmd('map'));

// HUD minimap tap → open full map popup
document.getElementById('minimap-grid-hud')?.addEventListener('click', () => {
  sendCmd('map');
});

// Mobile chat button
document.getElementById('mobile-chat-btn')?.addEventListener('click', toggleWhisperPanel);

// Mobile dpad — send movement commands without opening the keyboard
document.getElementById('mob-dpad')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.dpad-btn');
  if (btn?.dataset.cmd) sendCmd(btn.dataset.cmd);
});

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

// Output / area pane: click .action-link nodes to auto-run command
function handleActionLinkClick(e) {
  const el = e.target.closest('.action-link');
  if (!el) return;
  const action = el.dataset.action;
  const target = el.dataset.target;
  if (!action || !target) return;
  const cmd = `${action} ${target.toLowerCase()}`;
  const label = el.dataset.label;
  sendCmd(cmd, label ? `${action} ${label}` : undefined);
}
document.getElementById('output').addEventListener('click', handleActionLinkClick);
document.getElementById('area-pane').addEventListener('click', handleActionLinkClick);

// Look pane / output pane resize handle
(function () {
  const handle = document.getElementById('look-resize-handle');
  const resetBtn = document.getElementById('look-resize-reset');
  const pane = document.getElementById('area-pane');
  const container = document.getElementById('output-container');
  const STORAGE_KEY = 'lookPaneHeight';

  function setManual(heightPx) {
    pane.style.height = heightPx + 'px';
    pane.style.maxHeight = '';
    handle.classList.add('manual');
    localStorage.setItem(STORAGE_KEY, heightPx + 'px');
  }

  function setAuto() {
    pane.style.height = '';
    pane.style.maxHeight = '';
    handle.classList.remove('manual');
    localStorage.removeItem(STORAGE_KEY);
  }

  // Restore saved manual height, or start in auto mode
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    pane.style.height = saved;
    handle.classList.add('manual');
  }

  // In auto mode, reset to auto on each content update so the pane re-fits
  pane.addEventListener('contentupdate', () => {
    if (!handle.classList.contains('manual')) {
      pane.style.height = '';
    }
  });

  resetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setAuto();
  });

  handle.addEventListener('dblclick', () => setAuto());

  let startY, startH;

  handle.addEventListener('mousedown', (e) => {
    if (e.target === resetBtn) return;
    startY = e.clientY;
    startH = pane.getBoundingClientRect().height;
    handle.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ns-resize';

    function onMove(e) {
      const delta = e.clientY - startY;
      const containerH = container.getBoundingClientRect().height;
      const newH = Math.min(containerH - 80, Math.max(40, startH + delta));
      pane.style.height = newH + 'px';
      pane.style.maxHeight = '';
    }

    function onUp() {
      handle.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      handle.classList.add('manual');
      localStorage.setItem(STORAGE_KEY, pane.style.height);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Touch support
  handle.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    startY = t.clientY;
    startH = pane.getBoundingClientRect().height;
    handle.classList.add('dragging');

    function onMove(e) {
      const t = e.touches[0];
      const delta = t.clientY - startY;
      const containerH = container.getBoundingClientRect().height;
      const newH = Math.min(containerH - 80, Math.max(40, startH + delta));
      pane.style.height = newH + 'px';
      pane.style.maxHeight = '';
    }

    function onEnd() {
      handle.classList.remove('dragging');
      handle.classList.add('manual');
      localStorage.setItem(STORAGE_KEY, pane.style.height);
      handle.removeEventListener('touchmove', onMove);
      handle.removeEventListener('touchend', onEnd);
    }

    handle.addEventListener('touchmove', onMove, { passive: true });
    handle.addEventListener('touchend', onEnd);
  }, { passive: true });
})();
